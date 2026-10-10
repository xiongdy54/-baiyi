// v48.80（D124 / 设计稿 §11.4）：自我解释对话框（K7）。
// 保存 = self_explain 学习事件（payload：text/relatedKpId/selfRating）→ learner/changed 广播 → 关闭。
// 「对照原文」= 跳该 KP 第一张有来源的卡的原文（learner:kpLevels 返回 firstSourceCard）。
import { useEffect, useRef, useState } from "react";
import { learnerApi } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { eventBus } from "../../lib/eventbus";
import { growTextarea } from "../../lib/autoGrow";
import { useDialogA11y } from "../../lib/dialogA11y";

type JumpAction = { type: "jump"; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number; cfi?: string } };

export default function SelfExplainDialog({
  kpId,
  kpName,
  relatedKpId,
  relatedName,
  relationLabel,
  onClose,
}: {
  kpId: string;
  kpName: string;
  relatedKpId: string | null;
  relatedName: string;
  relationLabel: string;
  onClose: () => void;
}) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<JumpAction | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .kpLevels([kpId])
      .then((r) => {
        const row = r.rows?.find((x) => x.kpId === kpId);
        const src = (row as unknown as { firstSourceCard?: JumpAction["anchor"] & { documentId: string } } | undefined)?.firstSourceCard;
        if (!cancelled && src && src.documentId) {
          const { documentId, ...anchor } = src;
          setSource({ type: "jump", documentId, anchor });
        }
      })
      .catch(() => {
        /* 取不到来源就不显示对照原文 */
      });
    return () => {
      cancelled = true;
    };
  }, [kpId]);

  async function save(selfRating: "clear" | "partial" | "stuck") {
    if (saving) return;
    setSaving(true);
    try {
      await learnerApi.logEvent({
        kind: "self_explain",
        kpId,
        payload: { text: text.slice(0, 4000), relatedKpId: relatedKpId || null, selfRating }
      });
      eventBus.emit("learner/changed");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" data-show="in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" ref={ref} role="dialog" aria-modal="true" aria-label={S.selfExplain.title}>
        <div className="modal-header">
          <h3>{S.selfExplain.title}</h3>
          <button className="icon-btn" aria-label={S.panel.refresh} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          <p className="learner-dialog-prompt">{S.selfExplain.prompt(kpName, relatedName, relationLabel)}</p>
          <textarea
            ref={taRef}
            className="learner-explain-input"
            value={text}
            placeholder={S.selfExplain.inputPlaceholder}
            dir="auto"
            rows={2}
            onChange={(e) => {
              setText(e.target.value);
              growTextarea(e.target, 240);
            }}
          />
          <div className="learner-row-actions">
            {source && (
              <button className="btn-link" onClick={() => eventBus.emit("learner/navigate", source)}>
                {S.selfExplain.openSource}
              </button>
            )}
          </div>
        </div>
        <div className="learner-dialog-footer">
          <button className="btn btn-secondary" disabled={saving} onClick={() => void save("partial")}>
            {S.selfExplain.ratingPartial}
          </button>
          <button className="btn btn-secondary" disabled={saving} onClick={() => void save("stuck")}>
            {S.selfExplain.ratingStuck}
          </button>
          <button className="btn btn-primary" disabled={saving || !text.trim()} onClick={() => void save("clear")}>
            {S.selfExplain.ratingClear}
          </button>
        </div>
      </div>
    </div>
  );
}
