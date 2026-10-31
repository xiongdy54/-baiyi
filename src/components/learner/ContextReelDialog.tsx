// v48.80（D124 / 设计稿 §11.4）：语境串对话框（K11）。
// 3–5 个句子卡片，句中目标词加粗；底部「都读懂了」/「还不太懂」→ reel_done 学习事件。
import { useEffect, useState } from "react";
import { learnerApi } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { eventBus } from "../../lib/eventbus";
import { useDialogA11y } from "../../lib/dialogA11y";
import { useOverlayBackdrop } from "../../lib/overlayDismiss";

type ReelResult = NonNullable<Awaited<ReturnType<typeof learnerApi.contextReel>>>;

export default function ContextReelDialog({ lang, lexKey, onClose }: { lang: string; lexKey: string; onClose: () => void }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const backdrop = useOverlayBackdrop(ref, onClose);
  const [data, setData] = useState<ReelResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .contextReel(lang, lexKey)
      .then((r) => !cancelled && (r ? setData(r) : setError(S.contextReel.empty)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, lexKey]);

  async function finish(result: "clear" | "unclear") {
    try {
      await learnerApi.logEvent({ kind: "reel_done", lang, payload: { keys: [lexKey], result } });
      eventBus.emit("learner/changed");
    } finally {
      onClose();
    }
  }

  function renderSentence(text: string, start: number, end: number) {
    return (
      <>
        {text.slice(0, start)}
        <strong dir="auto">{text.slice(start, end)}</strong>
        {text.slice(end)}
      </>
    );
  }

  return (
    <div className="modal-backdrop" data-show="in" {...backdrop}>
      <div className="modal-panel modal-panel-content" ref={ref} role="dialog" aria-modal="true" aria-label={S.contextReel.title}>
        <div className="modal-header">
          <h3 dir="auto">{data ? data.word : S.contextReel.title}</h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          {error && <p className="learner-error">{error}</p>}
          {data &&
            data.sentences.map((s, i) => (
              <div className="learner-reel-sentence" key={i}>
                <p className="learner-reel-text" dir="auto">
                  {renderSentence(s.text, s.start, s.end)}
                </p>
                <div className="learner-reel-meta">
                  <span dir="auto">{s.material}</span>
                  <button
                    className="btn-link"
                    onClick={() => eventBus.emit("learner/navigate", { type: "jump", documentId: s.documentId, anchor: s.anchor })}
                  >
                    {S.contextReel.openSource}
                  </button>
                </div>
              </div>
            ))}
        </div>
        <div className="learner-dialog-footer">
          <button className="btn btn-secondary" disabled={!data || !data.sentences.length} onClick={() => void finish("unclear")}>
            {S.contextReel.stillUnclear}
          </button>
          <button className="btn btn-primary" disabled={!data || !data.sentences.length} onClick={() => void finish("clear")}>
            {S.contextReel.allClear}
          </button>
        </div>
      </div>
    </div>
  );
}
