// v48.80（D124 / 设计稿 §11.4）：词汇快测对话框（K14）。
// 每频段 10 个确定性抽样词，点选「认识」；提交 = placement 学习事件
// （knownKeys = 点选 key；extrapolatedKeys = ratio ≥ 0.9 频段的全部词项 key，上限 8000）。
import { useEffect, useMemo, useState } from "react";
import { learnerApi, type PlacementBand } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { eventBus } from "../../lib/eventbus";
import { useDialogA11y } from "../../lib/dialogA11y";
import { useOverlayBackdrop } from "../../lib/overlayDismiss";

export default function PlacementDialog({ lang, onClose }: { lang: string; onClose: () => void }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const backdrop = useOverlayBackdrop(ref, onClose);
  const [bands, setBands] = useState<PlacementBand[] | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .placementSample(lang)
      .then((r) => !cancelled && (r ? setBands(r.bands) : setError(S.placement.empty)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const allKeys = useMemo(() => (bands ? bands.flatMap((b) => b.words.map((w) => w.key)) : []), [bands]);

  const toggle = (key: string) => {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setBand = (band: PlacementBand, all: boolean) => {
    setKnown((prev) => {
      const next = new Set(prev);
      for (const w of band.words) {
        if (all) next.add(w.key);
        else next.delete(w.key);
      }
      return next;
    });
  };

  async function submit() {
    const knownKeys = [...known];
    const bandRatios = (bands || []).map((b) => {
      const shown = b.words.map((w) => w.key);
      const picked = shown.filter((k) => known.has(k)).length;
      return { band: b, ratio: shown.length ? picked / shown.length : 0 };
    });
    // ratio ≥ 0.9 的频段整段外推（allKeys = 主进程按排名返回的该频段全部词项 key）
    const extrapolated = new Set<string>();
    for (const { band, ratio } of bandRatios) {
      if (ratio >= 0.9) {
        for (const key of (band as PlacementBand & { allKeys?: string[] }).allKeys || band.words.map((w) => w.key)) {
          extrapolated.add(key);
          if (extrapolated.size >= 8000) break;
        }
      }
      if (extrapolated.size >= 8000) break;
    }
    try {
      await learnerApi.logEvent({
        kind: "placement",
        lang,
        payload: {
          knownKeys,
          extrapolatedKeys: [...extrapolated].slice(0, 8000),
          bands: bandRatios.map(({ band, ratio }) => ({ from: band.from, to: band.to, ratio }))
        }
      });
      eventBus.emit("learner/changed");
    } finally {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" data-show="in" {...backdrop}>
      <div className="modal-panel modal-panel-content" ref={ref} role="dialog" aria-modal="true" aria-label={S.placement.title}>
        <div className="modal-header">
          <h3>{S.placement.title}</h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          <p className="learner-dialog-prompt">{S.placement.intro}</p>
          {error && <p className="learner-error">{error}</p>}
          {bands &&
            bands.map((b) => (
              <div className="learner-placement-band" key={b.from}>
                <div className="learner-placement-head">
                  <span>{S.placement.bandLabel(b.from, b.to)}</span>
                  <span className="learner-placement-bandops">
                    <button className="btn-link" onClick={() => setBand(b, true)}>
                      {S.placement.knowAll}
                    </button>
                    <button className="btn-link" onClick={() => setBand(b, false)}>
                      {S.placement.knowNone}
                    </button>
                  </span>
                </div>
                <div className="learner-native-list">
                  {b.words.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className={`learner-tag${known.has(w.key) ? " is-on" : ""}`}
                      aria-pressed={known.has(w.key)}
                      dir="auto"
                      onClick={() => toggle(w.key)}
                    >
                      {w.sample}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
        <div className="learner-dialog-footer">
          <button className="btn btn-primary" disabled={!bands || allKeys.length === 0} onClick={() => void submit()}>
            {S.placement.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
