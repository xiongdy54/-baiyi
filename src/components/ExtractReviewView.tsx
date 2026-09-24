import { useCallback, useEffect, useMemo, useState } from "react";
import ExtractCardFace from "./ExtractCardFace";
import { cardsApi } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { readingWorkflow, undoApi, type DueTopic } from "../lib/readingWorkflow";
import { extractSettings, fetchSessionQueue, type ExtractEngine, type ScopeFilter } from "../lib/sessionQueue";

interface Props {
  onOpen: (extractId: string) => void;
  onJumpToDoc?: (
    docId: string,
    anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number; pageIndex?: number },
    returnTo?: "review" | "queue" | "browse"
  ) => void;
  /** 本书范围（阅读器入口）；缺省＝全部到期摘录（顶栏「摘录」入口） */
  bookItemIds?: string[];
  /** 顶部一行上下文（如「集中复习：《书名》」） */
  header?: string;
  onExit?: () => void;
}

/**
 * 沉浸式摘录连续处理页（v48.22 / D58 §6.8）：一屏一条、连续推进，正文可就地编辑。
 * 与复习页共用同一张卡面组件；调度语义＝SuperMemo（下一条＝读后推进、推迟＝指定天数）。
 * 只消费 §4.2-26 的会话队列（禁止自行归并）。
 */
export default function ExtractReviewView({ onOpen, onJumpToDoc, bookItemIds, header, onExit }: Props) {
  const [items, setItems] = useState<DueTopic[]>([]);
  const [engine, setEngine] = useState<ExtractEngine>("sm19-default");
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);

  const scope = useMemo<ScopeFilter>(
    () => ({ kinds: ["extract"], bookItemIds: bookItemIds && bookItemIds.length ? bookItemIds : undefined }),
    [bookItemIds]
  );

  const refresh = useCallback(async () => {
    const [q, prefs] = await Promise.all([fetchSessionQueue({ scope }), extractSettings.read()]);
    setItems((q?.extracts ?? []) as DueTopic[]);
    setEngine(prefs.engine);
    setLoaded(true);
    // 撤销可用性：**空态也必须可达**（处理完最后一条后仍要能 Ctrl+Z / 点「撤销最近一次操作」）
    try {
      const info = await undoApi.info();
      setUndoAvailable(Boolean(info?.available));
    } catch {
      setUndoAvailable(false);
    }
    // 派生信息：这条摘录已经制过几张卡（按 contextRef.extractId 关联，§4.2-16 上下文引用）
    try {
      const all = await cardsApi.listAll();
      const counts: Record<string, number> = {};
      for (const c of all as Array<{ contextRef?: { extractId?: string } | null; isDeleted?: number }>) {
        const id = c?.contextRef?.extractId;
        if (id) counts[id] = (counts[id] || 0) + 1;
      }
      setCardCounts(counts);
    } catch {
      /* 计数是增强信息，失败不影响处理 */
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
    return eventBus.on("workflow/changed", () => void refresh());
  }, [refresh]);

  const current = items[0] || null;

  const run = useCallback(
    async (fn: () => Promise<unknown>, note?: string) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        await fn();
        eventBus.emit("workflow/changed");
        await refresh();
        if (note) {
          setFlash(note);
          window.setTimeout(() => setFlash(null), 1800);
        }
      } finally {
        setBusy(false);
      }
    },
    [current, busy, refresh]
  );

  const advance = useCallback(() => run(() => readingWorkflow.advance(current!.id)), [current, run]);
  const undo = useCallback(async () => {
    const r = await undoApi.last();
    if (r.ok) {
      setFlash("已撤销最近一次操作");
      window.setTimeout(() => setFlash(null), 1800);
      await refresh();
    } else {
      setFlash(r.reason || "没有可撤销的操作");
      window.setTimeout(() => setFlash(null), 1800);
    }
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void advance();
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, undo]);

  if (!loaded) return <div className="extract-page" />;

  if (!current) {
    return (
      <div className="extract-page">
        <div className="review-count mono">0 条待处理</div>
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            {bookItemIds && bookItemIds.length
              ? "这本书没有待处理的摘录。在阅读时选中一段文字点「摘录」，新摘录会在下一个学习日进队。"
              : "队列是空的。在阅读时选中一段文字点「摘录」，它会在下一个学习日出现在这里。"}
          </p>
          {/* 空态也要能撤销上一次操作（用户要求 Ctrl+Z 配置好：处理完最后一条后撤销入口不得消失） */}
          {undoAvailable && (
            <button className="primary" data-undo-empty onClick={() => void undo()}>
              撤销最近一次操作（Z）
            </button>
          )}
          {onExit && (
            <button onClick={onExit} style={{ marginLeft: 8 }}>
              返回阅读
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="extract-page">
      <div className="extract-page-head">
        <span className="review-count mono">{items.length} 条待处理</span>
        {header ? <span className="mono extract-page-header">{header}</span> : null}
        {flash ? <span className="extract-flash mono">{flash}</span> : null}
        <span className="extract-page-hint mono">空格＝下一条 · Z＝撤销 · 正文可直接编辑</span>
        {onExit && (
          <button className="extract-exit" onClick={onExit}>
            返回阅读
          </button>
        )}
      </div>

      <ExtractCardFace
        key={current.id}
        extract={current}
        madeCardCount={cardCounts[current.id]}
        engine={engine}
        busy={busy}
        handlers={{
          onAdvance: () => void advance(),
          onPostpone: (days) => void run(() => readingWorkflow.postponeDays(current.id, days), `已推迟 ${days} 天`),
          onPriority: (p) => void run(() => readingWorkflow.setPriority(current.id, p), `优先级改为 ${p}`),
          onGraduate: () => void run(() => readingWorkflow.graduate(current.id), "已毕业：不再推送，仍保留在卡片浏览器"),
          onEdit: (text) => void run(() => readingWorkflow.updateContent(current.id, text), "正文已保存"),
          onOpenExtract: () => onOpen(current.id),
          onJumpToSource:
            onJumpToDoc && current.contextRef?.documentId
              ? () =>
                  onJumpToDoc(
                    current.contextRef!.documentId!,
                    {
                      anchorText: current.contextRef!.anchorText || current.contentMarkdown,
                      anchorRatio: current.contextRef!.anchorRatio
                    },
                    "queue"
                  )
              : undefined,
          onUndo: () => void undo()
        }}
      />
    </div>
  );
}
