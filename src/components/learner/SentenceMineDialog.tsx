// v48.80（D124 / 设计稿 §11.4）：挖句子对话框（K12）。
// 每行一个 i+1 句子（目标词加粗）：打开原文制卡 / 这个词我认识（lexeme_mark known）/ 不认识（unknown）/ 跳过。
import { useEffect, useState } from "react";
import { learnerApi } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { eventBus } from "../../lib/eventbus";
import { useDialogA11y } from "../../lib/dialogA11y";

type MineResult = NonNullable<Awaited<ReturnType<typeof learnerApi.sentenceMine>>>;
type MineItem = MineResult["items"][number];

export default function SentenceMineDialog({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const [items, setItems] = useState<MineItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .sentenceMine(trackId, 10)
      .then((r) => !cancelled && setItems(r ? r.items : []))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  async function mark(item: MineItem, markValue: "known" | "unknown") {
    try {
      await learnerApi.logEvent({
        kind: "lexeme_mark",
        lang: "",
        payload: { keys: [item.target.key], mark: markValue, via: "mine" }
      });
      eventBus.emit("learner/changed");
    } catch {
      /* 埋点失败静默 */
    }
    setItems((list) => (list ? list.filter((x) => x !== item) : list));
  }

  return (
    <div className="modal-backdrop" data-show="in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" ref={ref} role="dialog" aria-modal="true" aria-label={S.sentenceMine.title}>
        <div className="modal-header">
          <h3>{S.sentenceMine.title}</h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          {error && <p className="learner-error">{error}</p>}
          {items && items.length === 0 && <p className="learner-error">{S.sentenceMine.empty}</p>}
          {items &&
            items.map((item, i) => (
              <div className="learner-mine-row" key={`${item.unitId}:${i}`}>
                <p className="learner-reel-text" dir="auto">
                  {item.sentence.slice(0, item.target.start)}
                  <strong dir="auto">{item.sentence.slice(item.target.start, item.target.end)}</strong>
                  {item.sentence.slice(item.target.end)}
                </p>
                <div className="learner-reel-meta">
                  <span dir="auto">{item.material}</span>
                  <button
                    className="btn-link"
                    onClick={() => {
                      eventBus.emit("learner/navigate", { type: "jump", documentId: item.documentId, anchor: item.anchor });
                      onClose();
                    }}
                  >
                    {S.sentenceMine.openToCard}
                  </button>
                </div>
                <div className="learner-mine-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => void mark(item, "known")}>
                    {S.sentenceMine.markKnown}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => void mark(item, "unknown")}>
                    {S.sentenceMine.markUnknown}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setItems((list) => (list ? list.filter((x) => x !== item) : list))}>
                    {S.sentenceMine.skip}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
