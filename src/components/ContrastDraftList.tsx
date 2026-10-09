// D121 §3.3 ④：对比卡草稿逐张入库/放弃列表（由 v30 ContrastCardModal 抽出，供 DisambiguateModal 的 confusable 结论内嵌）。
// 建卡走 createAcceptedCard（与 Reader 确认面板同链路，lint + S1 相似检索一致）；
// 同一次对比动作入库的对比卡互为同源（siblingKey = act:contrast-<uuid>，显式键优先于锚点推导；M12 §4.16）。
import { useEffect, useRef, useState } from "react";
import { createAcceptedCard, type CardDraft, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { IconAlert } from "./icons";

export default function ContrastDraftList({
  drafts,
  sourceTitle,
  sourceAuthor,
  contextRef
}: {
  drafts: CardDraft[];
  sourceTitle?: string | null;
  sourceAuthor?: string | null;
  contextRef?: CardRecord["contextRef"];
}) {
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  // v34（M12，§4.16）：同一次对比动作入库的对比卡互为同源（act 键）；
  // 对比卡不与基准卡同组（消歧用途，与基准卡同日出现有益，D29）
  const contrastKey = useRef(`act:contrast-${crypto.randomUUID()}`);
  useEffect(() => () => { mounted.current = false; }, []);

  async function acceptOne(d: CardDraft, i: number) {
    setSaving(true);
    setError("");
    try {
      await createAcceptedCard(d, { sourceTitle: sourceTitle ?? null, sourceAuthor: sourceAuthor ?? null, contextRef: contextRef ?? null, siblingKey: contrastKey.current });
      if (!mounted.current) return;
      setAccepted((prev) => new Set([...prev, i]));
      eventBus.emit("cards/changed");
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const pendingCount = drafts.length - accepted.size - skipped.size;
  return (
    <div className="contrast-drafts" data-testid="contrast-drafts">
      {drafts.length === 0 && (
        <p className="form-hint">AI 认为这两张卡之间没有真实的混淆风险，未产对比卡。</p>
      )}
      {error && <p className="ai-draft-warnings"><IconAlert size={14} /> {error}</p>}
      {drafts.map((d, i) => (
        /* 已处理态走既有 .ai-draft-accepted（opacity .6 + grey-1 底） */
        <div key={i} className={`ai-draft ${accepted.has(i) || skipped.has(i) ? "card-fill ai-draft-accepted" : "card-outlined"}`}>
          <div className="ai-draft-front">
            <span className="ai-draft-type mono">{d.cardType}</span>
            {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
            <div className="ai-draft-text">{d.front}</div>
          </div>
          <div className="ai-draft-back">{d.back}</div>
          <div className="ai-actions">
            {accepted.has(i) ? (
              <span className="form-hint state-ok">已入库</span>
            ) : skipped.has(i) ? (
              <span className="form-hint">已放弃</span>
            ) : (
              <>
                <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void acceptOne(d, i)}>入库</button>
                <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setSkipped((prev) => new Set([...prev, i]))}>放弃</button>
              </>
            )}
          </div>
        </div>
      ))}
      {drafts.length > 0 && pendingCount === 0 && <p className="form-hint">全部处理完毕。</p>}
    </div>
  );
}
