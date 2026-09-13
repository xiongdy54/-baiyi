// 连续刷题复习界面（v11.1 连续模式；v12.2 去页内重复标题 + 跳转原文 + 删除按钮）：
// 进入即开始；评分后自动展示下一张到期卡。每张卡都重新拉取 due 队列取队首，
// 排序 = FSRS due 升序 + 同 due 优先级降序（electron/db.js listDueCards），学习中新到期卡实时进入队列。
import { useCallback, useEffect, useRef, useState } from "react";
import { fsrsEngine, type Rating } from "../lib/fsrs";
import { cardsApi, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { useCommandActions } from "../lib/useCommands";
import { CardFace } from "./CardBrowser";
import ContrastCardModal from "./ContrastCardModal";

export default function ReviewView({
  onJumpToDoc
}: {
  onJumpToDoc?: (docId: string, anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number }) => void;
} = {}) {
  const [current, setCurrent] = useState<(CardRecord & { docTitle?: string }) | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  // v23（§4.4.9）：persist 失败态——停留当前卡、封锁评分/跳过/删除，提供「重试保存」
  const [saveError, setSaveError] = useState(false);
  // v23（§4.4.3）：预览携带源卡状态引用，评分提交时判废（防复用过期预览）
  const [previews, setPreviews] = useState<{
    sourceCardId: string;
    sourceFsrs: CardRecord["fsrs"];
    items: ReturnType<typeof fsrsEngine.preview>;
  } | null>(null);
  // M4 快捷键防连发：动作进行中（评分/暂停/跳过/删除落库+取下一张）when() 一律拒绝新的按键触发
  const actionBusyRef = useRef(false);
  // v22 撤销评分：最近一条可撤销评分（有评分前快照且卡未删），null=当前不可撤销
  const [undoInfo, setUndoInfo] = useState<{ logId: string; cardId: string; rating: string; reviewedAt: number } | null>(null);
  // v30（D29）：易混对比卡确认框（以当前卡为基准生成对比三件套）
  const [contrastOpen, setContrastOpen] = useState(false);

  // 查询最近可撤销评分（评分/撤销后刷新；挂起/跳过/删除不产生日志无需刷新，删除他人卡由撤销时服务端兜底）
  const refreshUndo = useCallback(async () => {
    setUndoInfo((await cardsApi.lastUndoableReview()) ?? null);
  }, []);

  useEffect(() => {
    void refreshUndo();
  }, [refreshUndo]);

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

  // 当前卡四档预览（§4.4.3 同源：评分复用，预览=落库）
  useEffect(() => {
    setPreviews(
      current
        ? { sourceCardId: current.id, sourceFsrs: current.fsrs, items: fsrsEngine.preview(current.fsrs) }
        : null
    );
  }, [current]);

  // 内联编辑落库（§8.2.7 渐进措辞优化）：只改文案，不动 FSRS 状态（updateCard 保留 fsrs 字段）
  async function handleEdit(patch: { frontMarkdown?: string; backMarkdown?: string; noteText?: string }) {
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
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      // 过期判废（§4.4.3 v23）：源卡状态与预览生成时不一致 → 现场重算，绝不复用过期预览
      const bundle = previews && previews.sourceCardId === current.id && previews.sourceFsrs === current.fsrs ? previews : null;
      const previewItem = bundle?.items.find((p) => p.rating === rating);
      const fsrsState = previewItem?.fsrsState ?? fsrsEngine.next(current.fsrs, rating).fsrsState;
      const lapses = fsrsState.lapses ?? 0;
      // v22：第 5 参传评分前快照，该次评分才可撤销（§4.4.4）
      // v23（§4.4.9）：persist 失败 → 停留当前卡、封锁动作、提供重试保存（review 成功边界=COMMIT+persist+IPC）
      try {
        await cardsApi.review(current.id, fsrsState, rating, Date.now() - startedAt, current.fsrs);
      } catch {
        setSaveError(true);
        return;
      }
      // Leech 检测（§8.7 + §11.4 字段级更新）
      if (fsrsEngine.isLeech(lapses, 8) && !(current.leech?.isLeech)) {
        try {
          await cardsApi.addIssue({
            cardId: current.id,
            ruleId: "LEECH",
            severity: "warn",
            message: `连续遗忘 ${lapses} 次，已自动暂停`,
            source: "lint"
          });
          await cardsApi.updateLeech(current.id, { isLeech: true, suspended: true, suspendedAt: Date.now() });
        } catch {
          setSaveError(true);
          return;
        }
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
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  async function markAndSuspend() {
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      try {
        await cardsApi.addIssue({
          cardId: current.id,
          ruleId: "MARK",
          severity: "warn",
          message: "复习中标记待改",
          source: "review-mark"
        });
        await cardsApi.setSuspended(current.id, true, "review-mark");
      } catch {
        setSaveError(true);
        return;
      }
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
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  async function skip() {
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      // 跳过：不评分、不写 review_log（保持 FSRS 历史纯净），仅把 due 后移 10 分钟使其沉底
      const c = current;
      // 统计埋点：记录跳过事件（队列水位瀑布的「跳过」档数据源）
      void cardsApi.skip(c.id);
      const fsrs = { ...(c.fsrs ?? {}), due: Date.now() + 10 * 60_000 };
      try {
        await cardsApi.update({ ...c, fsrs });
      } catch {
        setSaveError(true);
        return;
      }
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
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // 需求3：删除当前卡（确认后软删），继续下一张
  async function handleDelete() {
    if (!current || actionBusyRef.current || saveError) return;
    if (!window.confirm(`确定删除这张卡片？\n\n${current.frontMarkdown || current.noteText}`)) return;
    actionBusyRef.current = true;
    try {
      try {
        await cardsApi.remove(current.id);
      } catch {
        setSaveError(true);
        return;
      }
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
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // v22 撤销评分：恢复最近一次评分前状态（服务端回退 leech+移除该条日志），回到该卡背面可立即重评
  async function undoLastGrade() {
    if (actionBusyRef.current || !undoInfo || saveError) return;
    actionBusyRef.current = true;
    try {
      let r: Awaited<ReturnType<typeof cardsApi.undoReview>>;
      try {
        r = await cardsApi.undoReview();
      } catch {
        setSaveError(true);
        return;
      }
      if (r.ok && r.card) {
        setCurrent(r.card);
        setShowBack(true);
        setStartedAt(Date.now());
        setSessionDone(false);
        setDoneCount((n) => Math.max(0, n - 1));
        eventBus.emit("cards/changed");
      }
      setUndoInfo((await cardsApi.lastUndoableReview()) ?? null);
    } finally {
      actionBusyRef.current = false;
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
      anchorRatio: c.contextRef.anchorRatio,
      cfi: c.contextRef.cfi,
      chapterIndex: c.contextRef.chapterIndex
    });
  }

  // ---------- M4 复习快捷键（§9.1 M4）：空格翻面 / 1-4 评分 / z 撤销评分 / q 标记暂停 / w 跳过 / d 删除 ----------
  // 口径：翻面只对正面生效；评分只对背面（评分按钮在场时）生效；z 需存在可撤销评分；
  // q/w/d 与翻面状态无关，只要当前有卡即可触发（删除仍走 confirm 确认）。
  const hasCard = !!current;
  const canGrade = hasCard && showBack;
  useCommandActions("review", {
    "review.showAnswer": { when: () => hasCard && !showBack && !actionBusyRef.current, run: () => setShowBack(true) },
    "review.again": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Again") },
    "review.hard": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Hard") },
    "review.good": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Good") },
    "review.easy": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Easy") },
    "review.undo": { when: () => !!undoInfo && !actionBusyRef.current && !saveError, run: () => void undoLastGrade() },
    "review.markSuspend": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void markAndSuspend() },
    "review.skip": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void skip() },
    "review.delete": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void handleDelete() }
  });

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
            <div className="settings-row">
              {undoInfo && (
                <button className="btn btn-secondary btn-sm" onClick={undoLastGrade}>
                  撤销评分{undoInfo.rating ? `（${undoInfo.rating}）` : ""}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
                刷新
              </button>
            </div>
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

        {/* v23（§4.4.9）：persist 失败横幅——停留当前卡、封锁动作，重试成功后自动恢复 */}
        {saveError && (
          <div className="save-error" role="alert">
            <span>保存失败：刚才的操作尚未写入磁盘，已停留在本卡。</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  await cardsApi.persistNow();
                  setSaveError(false);
                } catch { /* 仍失败则保持错误态 */ }
              }}
            >
              重试保存
            </button>
          </div>
        )}

        <CardFace
          card={current!}
          showBack={showBack}
          onReveal={() => setShowBack(true)}
          onEdit={handleEdit}
        />
        <div className="review-meta">
          {/* v22 撤销评分：误评后一键回退（快捷键 Z），标签展示被撤销的评分档位 */}
          {undoInfo && (
            <button className="review-jump" onClick={undoLastGrade}>
              撤销评分{undoInfo.rating ? `（${undoInfo.rating}）` : ""}
            </button>
          )}
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
              {(previews?.items ?? fsrsEngine.preview(current!.fsrs)).map((p) => (
                <button key={p.rating} className={`btn grade-${p.rating.toLowerCase()}`} disabled={saveError} onClick={() => grade(p.rating)}>
                  {p.rating}
                  <span className="grade-due mono">{p.dueText}</span>
                </button>
              ))}
            </div>
            <div className="review-tools">
              {/* v30（D29）：以当前卡为基准生成易混对比卡三件套 */}
              <button className="btn btn-outline btn-sm" onClick={() => setContrastOpen(true)}>对比卡</button>
              <button className="btn btn-outline btn-sm" onClick={markAndSuspend}>标记并暂停</button>
              <button className="btn btn-outline btn-sm" onClick={skip}>跳过</button>
              <button className="btn btn-outline btn-sm review-delete" onClick={handleDelete}>删除</button>
            </div>
          </>
        )}
        {contrastOpen && current && (
          <ContrastCardModal card={current} onClose={() => setContrastOpen(false)} />
        )}
      </div>
    </div>
  );
}
