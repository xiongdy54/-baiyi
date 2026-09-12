import { useCallback, useEffect, useState } from "react";
import { readingWorkflow, type DueTopic } from "../lib/readingWorkflow";
import { eventBus } from "../lib/eventbus";

interface Props {
  onOpen: (extractId: string) => void;
  onJumpToDoc?: (docId: string, anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number }, returnTo?: "review" | "queue" | "browse") => void;
}

export default function QueueView({ onOpen, onJumpToDoc }: Props) {
  const [topics, setTopics] = useState<DueTopic[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setTopics(await readingWorkflow.getDueTopics());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("workflow/changed", refresh);
  }, [refresh]);

  async function handlePostpone(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await readingWorkflow.postpone(id);
    eventBus.emit("workflow/changed");
  }

  return (
    <div className="queue-wrap">
      <div className="review-count mono">{topics.length} 条待读</div>
      {loaded && topics.length === 0 && (
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            队列是空的。在阅读时选中一段文字点「摘录」，它就会出现在这里。
          </p>
        </div>
      )}
      <div className="queue-list">
        {topics.map((t) => (
          <div key={t.id} className="queue-row" onClick={() => onOpen(t.id)}>
            <div className="queue-row-head">
              <span>
                来自《{t.docTitle}》
                {t.depth > 1 ? ` · 第${t.depth}层摘录` : ""}
              </span>
              <span>优先级 {t.priority}</span>
            </div>
            <div className="queue-row-text">{t.contentMarkdown}</div>
            <div className="queue-actions">
              <button onClick={(e) => handlePostpone(e, t.id)}>
                推迟（下次 {Math.round(t.intervalDays * 1.6)} 天后）
              </button>
              {onJumpToDoc && t.contextRef?.documentId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // 保存摘录队列现场：返回时恢复滚动位置
                    try {
                      sessionStorage.setItem("queueSession", JSON.stringify({ scrollTop: window.scrollY }));
                    } catch { /* 忽略 */ }
                    onJumpToDoc(t.contextRef!.documentId!, {
                      anchorText: t.contextRef!.anchorText || t.contentMarkdown,
                      anchorRatio: t.contextRef!.anchorRatio
                    }, "queue");
                  }}
                >
                  跳转原文 →
                </button>
              )}
              <button className="primary" onClick={() => onOpen(t.id)}>
                打开阅读
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
