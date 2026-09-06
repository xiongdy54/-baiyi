// 连续刷题复习界面（v11.1 用户需求调整）：
// 进入即开始；评分后自动展示下一张到期卡。每张卡都重新拉取 due 队列取队首，
// 排序 = FSRS due 升序 + 同 due 优先级降序（electron/db.js listDueCards），学习中新到期卡实时进入队列。
import { useCallback, useEffect, useState } from "react";
import { fsrsEngine, type Rating } from "../lib/fsrs";
import { cardsApi, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { CardFace } from "./CardBrowser";

export default function ReviewView() {
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

  // 开场拉第一张
  useEffect(() => {
    let cancelled = false;
    nextCard().then((c) => {
      if (cancelled) return;
      if (c) {
        setCurrent(c);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setSessionDone(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [nextCard]);

  // 当前卡四档预览（§11.3 同源：评分复用，预览=落库）
  useEffect(() => {
    setPreviews(current ? fsrsEngine.preview(current.fsrs) : null);
  }, [current]);

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
        <header className="page-header">
          <div>
            <div className="page-kicker">Review</div>
            <h1 className="page-title">{doneCount > 0 ? "本轮完成" : "复习"}</h1>
          </div>
          <span className="page-count mono">{doneCount} 张已复习</span>
        </header>
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            {doneCount > 0 ? "到期卡片已清空，休息一下。" : "今日到期卡片已清空。去阅读器里制几张卡吧。"}
          </p>
          <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
            刷新
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-wrap">
      <header className="page-header">
        <div>
          <div className="page-kicker">Review</div>
          <h1 className="page-title">连续复习</h1>
        </div>
        <span className="page-count mono">本轮 {doneCount} 张</span>
      </header>

      <CardFace card={current!} showBack={showBack} onReveal={() => setShowBack(true)} />
      <div className="review-meta mono">
        优先级 {current!.priority}
        {current!.sourceRef?.title ? ` · 来源:${current!.sourceRef.title}` : ""}
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
            <button className="btn btn-outline btn-sm" onClick={skip}>跳过（10 分钟后再现）</button>
          </div>
        </>
      )}
    </div>
  );
}
