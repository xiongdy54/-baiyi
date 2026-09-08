// 连续刷题复习界面（v11.1 连续模式；v12.2 去页内重复标题 + 跳转原文 + 删除按钮）：
// 进入即开始；评分后自动展示下一张到期卡。每张卡都重新拉取 due 队列取队首，
// 排序 = FSRS due 升序 + 同 due 优先级降序（electron/db.js listDueCards），学习中新到期卡实时进入队列。
import { useCallback, useEffect, useState } from "react";
import { fsrsEngine, type Rating } from "../lib/fsrs";
import { cardsApi, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { CardFace } from "./CardBrowser";

export default function ReviewView({
  onJumpToDoc
}: {
  onJumpToDoc?: (docId: string, anchor: { anchorText: string; anchorRatio?: number }) => void;
} = {}) {
  const [current, setCurrent] = useState<(CardRecord & { docTitle?: string }) | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [previews, setPreviews] = useState<ReturnType<typeof fsrsEngine.preview> | null>(null);

  // 拉取到期队列队首（FSRS due 升序）
  const nextCard = useCallback(async (): Promise<(CardRecord & { docTitle?: string }) | null> => {
    const due = await cardsApi.listDue();
    return due[0] ?? null;
  }, []);

  // 开场拉第一张；若 sessionStorage 有跳转前的复习现场（从阅读器返回）则恢复该卡
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resumeCard: (CardRecord & { docTitle?: string }) | null = null;
      let resumeShowBack = false;
      try {
        const saved = sessionStorage.getItem("reviewSession");
        if (saved) {
          sessionStorage.removeItem("reviewSession");
          const parsed = JSON.parse(saved) as { cardId?: string; showBack?: boolean };
          if (parsed.cardId) {
            const got = await cardsApi.get(parsed.cardId);
            if (got) {
              resumeCard = got;
              resumeShowBack = Boolean(parsed.showBack);
            }
          }
        }
      } catch { /* 无现场则正常开新轮 */ }
      if (cancelled) return;
      if (resumeCard) {
        setCurrent(resumeCard);
        setShowBack(resumeShowBack);
        setStartedAt(Date.now());
        setLoading(false);
        return;
      }
      const c = await nextCard();
      if (cancelled) return;
      if (c) {
        setCurrent(c);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setSessionDone(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nextCard]);

  // 当前卡四档预览（§11.3 同源：评分复用，预览=落库）
  useEffect(() => {
    setPreviews(current ? fsrsEngine.preview(current.fsrs) : null);
  }, [current]);

  // 内联编辑落库（§8.2.7 渐进措辞优化）：只改文案，不动 FSRS 状态（updateCard 保留 fsrs 字段）
  async function handleEdit(patch: { frontMarkdown?: string; backMarkdown?: string }) {
    if (!current) return;
    const next = { ...current, ...patch };
    setCurrent(next);
    await cardsApi.update({
      ...next,
      frontMarkdown: patch.frontMarkdown ?? current.frontMarkdown,
      backMarkdown: patch.backMarkdown ?? current.backMarkdown
    });
    eventBus.emit("cards/changed");
  }

  async function grade(rating: Rating) {
    if (!current) return;
    const previewItem = previews?.find((p) => p.rating === rating);
    const fsrsState = previewItem?.fsrsState ?? fsrsEngine.next(current.fsrs, rating).fsrsState;
    const lapses = fsrsState.lapses ?? 0;
    await cardsApi.review(current.id, fsrsState, rating, Date.now() - startedAt);
    // Leech 检测（§8.7 + §11.4 字段级更新）
    if (fsrsEngine.isLeech(lapses, 8) && !(current.leech?.isLeech)) {
      await cardsApi.addIssue({
        cardId: current.id,
        ruleId: "LEECH",
        severity: "warn",
        message: `连续遗忘 ${lapses} 次，已自动暂停`,
        source: "lint"
      });
      await cardsApi.updateLeech(current.id, { isLeech: true, suspended: true, suspendedAt: Date.now() });
      eventBus.emit("leech/detected", current.id);
    }
    eventBus.emit("cards/changed");
    setDoneCount((n) => n + 1);
    // 连续模式：直接取下一张（评分后该卡 due 已在未来，不会重复出现）
    const next = await nextCard();
    if (next) {
      setCurrent(next);
      setShowBack(false);
      setStartedAt(Date.now());
    } else {
      setCurrent(null);
      setSessionDone(true);
    }
  }

  async function markAndSuspend() {
    if (!current) return;
    await cardsApi.addIssue({
      cardId: current.id,
      ruleId: "MARK",
      severity: "warn",
      message: "复习中标记待改",
      source: "review-mark"
    });
    await cardsApi.setSuspended(current.id, true, "review-mark");
    eventBus.emit("cards/changed");
    setDoneCount((n) => n + 1);
    const next = await nextCard();
    if (next) {
      setCurrent(next);
      setShowBack(false);
      setStartedAt(Date.now());
    } else {
      setCurrent(null);
      setSessionDone(true);
    }
  }

  async function skip() {
    if (!current) return;
    // 跳过：不评分、不写 review_log（保持 FSRS 历史纯净），仅把 due 后移 10 分钟使其沉底
    const c = current;
    // 统计埋点：记录跳过事件（队列水位瀑布的「跳过」档数据源）
    void cardsApi.skip(c.id);
    const fsrs = { ...(c.fsrs ?? {}), due: Date.now() + 10 * 60_000 };
    await cardsApi.update({ ...c, fsrs });
    const next = await nextCard();
    if (next && next.id !== c.id) {
      setCurrent(next);
      setShowBack(false);
      setStartedAt(Date.now());
    } else if (next) {
      // 队首仍是自己（只有这一张到期），留在原卡
      setShowBack(false);
      setStartedAt(Date.now());
    } else {
      setCurrent(null);
      setSessionDone(true);
    }
  }

  // 需求3：删除当前卡（确认后软删），继续下一张
  async function handleDelete() {
    if (!current) return;
    if (!window.confirm(`确定删除这张卡片？\n\n${current.frontMarkdown || current.noteText}`)) return;
    await cardsApi.remove(current.id);
    eventBus.emit("cards/changed");
    setDoneCount((n) => n + 1);
    const next = await nextCard();
    if (next) {
      setCurrent(next);
      setShowBack(false);
      setStartedAt(Date.now());
    } else {
      setCurrent(null);
      setSessionDone(true);
    }
  }

  // 需求2：跳转原文（保存复习现场，从阅读器返回时恢复）
  function handleJumpToSource() {
    const c = current;
    if (!c?.contextRef?.documentId || !onJumpToDoc) return;
    try {
      sessionStorage.setItem(
        "reviewSession",
        JSON.stringify({ cardId: c.id, showBack })
      );
    } catch { /* 忽略存储失败 */ }
    onJumpToDoc(c.contextRef.documentId, {
      anchorText: c.contextRef.anchorText || c.frontMarkdown || c.noteText,
      anchorRatio: c.contextRef.anchorRatio
    });
  }

  if (loading) {
    return (
      <div className="review-wrap">
        <div className="empty-state"><p className="empty-text">加载中…</p></div>
      </div>
    );
  }

  if (!current && sessionDone) {
    return (
      <div className="review-wrap">
        <div className="review-session">
          <div className="review-count mono">{doneCount} 张已复习</div>
          <div className="empty-state">
            <div className="empty-deco">
              <span className="empty-sq empty-sq-accent" />
              <span className="empty-sq" />
              <span className="empty-sq" />
            </div>
            <p className="empty-text">
              {doneCount > 0 ? "到期卡片已清空，休息一下。" : "今日到期卡片已清空。"}
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
              刷新
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="review-wrap">
      <div className="review-session">
        {/* 页内不再重复导航文字（v12.2）：标题由顶栏高亮项表达；右上角仅剩本轮计数 */}
        <div className="review-count mono">本轮 {doneCount} 张</div>

        <CardFace
          card={current!}
          showBack={showBack}
          onReveal={() => setShowBack(true)}
          onEdit={handleEdit}
        />
        <div className="review-meta">
          {current!.contextRef?.documentId && onJumpToDoc && (
            <button className="review-jump" onClick={handleJumpToSource}>
              跳转原文 →
            </button>
          )}
          {current!.sourceRef?.title ? `来源:${current!.sourceRef.title}` : ""}
          {current!.dateStamp ? ` · ${current!.dateStamp}` : ""}
        </div>
        {showBack && current!.mnemonic && (
          <div className="review-mnemonic">
            <span className="book-card-label">助记</span>
            {current!.mnemonic}
          </div>
        )}
        {showBack && (
          <>
            <div className="grade-row">
              {(previews ?? fsrsEngine.preview(current!.fsrs)).map((p) => (
                <button key={p.rating} className={`btn grade-${p.rating.toLowerCase()}`} onClick={() => grade(p.rating)}>
                  {p.rating}
                  <span className="grade-due mono">{p.dueText}</span>
                </button>
              ))}
            </div>
            <div className="review-tools">
              <button className="btn btn-outline btn-sm" onClick={markAndSuspend}>标记并暂停</button>
              <button className="btn btn-outline btn-sm" onClick={skip}>跳过</button>
              <button className="btn btn-outline btn-sm review-delete" onClick={handleDelete}>删除</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
