// D121 §3.2 第二屏的单栏：卡 A / 卡 B 的可编辑字段 + 来源 + 「原文」折叠区
import type { EditableFields, Side } from "../../lib/disambiguateUi";
import { isArchived, sourceLabel, sourceOf, type CardWithTitle } from "./shared";

export default function CardPane({
  side,
  card,
  fields,
  changed,
  adopted,
  archived,
  origin,
  onChange
}: {
  side: Side;
  card: CardWithTitle;
  fields: EditableFields;
  /** 该栏有未保存修改 */
  changed: boolean;
  /** 本栏被「采纳」写入过的字段（标为已改，仍可再手改） */
  adopted: Set<keyof EditableFields>;
  /** 本次弹窗会话中已归档 */
  archived: boolean;
  /** undefined=尚在加载；null=无原文记录 */
  origin: string | null | undefined;
  onChange: (patch: Partial<EditableFields>) => void;
}) {
  const src = sourceOf(card);
  const wasArchived = archived || isArchived(card);
  const isCloze = card.cardType === "cloze";
  const mark = (k: keyof EditableFields) => (adopted.has(k) ? " · 已采纳" : "");
  return (
    <section className={`disamb-pane${changed ? " is-changed" : ""}`} aria-label={`卡 ${side}`} data-testid={`disamb-pane-${side}`}>
      <h3 className="disamb-pane-title">
        卡 {side}
        {wasArchived && <span className="disamb-tag">已归档</span>}
        {changed && <span className="disamb-tag disamb-tag-changed">已修改</span>}
      </h3>
      <label className="disamb-field">
        <span>前缀（contextPrefix）{mark("contextPrefix")}</span>
        <input type="text" value={fields.contextPrefix} onChange={(e) => onChange({ contextPrefix: e.target.value })} />
      </label>
      <label className="disamb-field">
        <span>问题{isCloze ? "（挖空原文）" : ""}{mark("front")}</span>
        <textarea rows={3} value={fields.front} onChange={(e) => onChange({ front: e.target.value })} />
      </label>
      <label className="disamb-field">
        <span>答案{mark("back")}</span>
        <textarea rows={3} value={fields.back} onChange={(e) => onChange({ back: e.target.value })} />
      </label>
      <p className="disamb-source">
        {sourceLabel(src)}
        {src.anchor ? ` · ${src.anchor}` : ""}
      </p>
      <details className="disamb-origin">
        <summary>原文</summary>
        {origin === undefined ? (
          <p className="form-hint">读取中…</p>
        ) : origin ? (
          <div className="disamb-origin-text">{origin}</div>
        ) : (
          <p className="form-hint">无原文记录</p>
        )}
      </details>
    </section>
  );
}
