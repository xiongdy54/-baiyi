// v48.80（D124 / 设计稿 §11.4）：单元重读对话框（K10）。
// 「读完了」= unit_reread 学习事件（记一次通读）→ learner/changed 广播 → 关闭。
import { useEffect, useState } from "react";
import { learnerApi } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { eventBus } from "../../lib/eventbus";
import { useDialogA11y } from "../../lib/dialogA11y";
import { useOverlayBackdrop } from "../../lib/overlayDismiss";

type UnitTextResult = NonNullable<Awaited<ReturnType<typeof learnerApi.unitText>>>;

export default function UnitReaderDialog({ unitId, libraryItemId, onClose }: { unitId: string; libraryItemId?: string; onClose: () => void }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const backdrop = useOverlayBackdrop(ref, onClose);
  const [data, setData] = useState<UnitTextResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .unitText(unitId)
      .then((r) => {
        if (!cancelled) {
          if (r) setData(r);
          else setError(S.panel.empty);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  async function markDone() {
    try {
      await learnerApi.logEvent({
        kind: "unit_reread",
        unitId,
        libraryItemId: libraryItemId || data?.unitId,
        lang: data?.lang || "",
        payload: {}
      });
      eventBus.emit("learner/changed");
    } finally {
      onClose();
    }
  }

  // learning 词用下划线标出（learningSpans 为 [start,end][]，按序合并渲染）
  function renderText() {
    if (!data) return null;
    const spans = (data.learningSpans || []).slice().sort((a, b) => a[0] - b[0]);
    const out: React.ReactNode[] = [];
    let pos = 0;
    spans.forEach(([s, e], i) => {
      if (s < pos) return;
      if (s > pos) out.push(<span key={`t${i}`}>{data.text.slice(pos, s)}</span>);
      out.push(
        <u key={`u${i}`} className="learner-lw">
          {data.text.slice(s, e)}
        </u>
      );
      pos = e;
    });
    out.push(<span key="tail">{data.text.slice(pos)}</span>);
    return out;
  }

  return (
    <div className="modal-backdrop" data-show="in" {...backdrop}>
      <div className="modal-panel modal-panel-reading" ref={ref} role="dialog" aria-modal="true" aria-label={S.unitReader.title}>
        <div className="modal-header">
          <h3>
            {S.unitReader.title}
            {data ? <span className="learner-meta-inline">{data.title ? ` · ${data.title}` : ""}</span> : null}
          </h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          {error && <p className="learner-error">{error}</p>}
          {data && (
            <>
              <div className="learner-unit-text" dir="auto">
                {renderText()}
              </div>
              <div className="learner-row-actions">
                <button
                  className="btn-link"
                  onClick={() =>
                    eventBus.emit("learner/navigate", {
                      type: "jump",
                      documentId: data.documentId,
                      anchor: data.anchor
                    })
                  }
                >
                  {S.unitReader.openInReader}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="learner-dialog-footer">
          <button className="btn btn-primary" disabled={!data} onClick={() => void markDone()}>
            {S.unitReader.markDone}
          </button>
        </div>
      </div>
    </div>
  );
}
