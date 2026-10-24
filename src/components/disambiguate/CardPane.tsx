// D121 §3.2 第二屏的单栏：卡 A / 卡 B 的可编辑字段 + 来源 + 「原文」折叠区
import type { EditableFields, Side } from "../../lib/disambiguateUi";
import { isArchived, sourceLabel, sourceOf, type CardWithTitle } from "./shared";
// C-34d：辨析字段统一卡片字段编辑器（docs/EDIT-CONTRACT.md）
import { MdField } from "../editor/CardFields";
import { useT } from "../../lib/i18n";

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
  const T = useT();
  const mark = (k: keyof EditableFields) => (adopted.has(k) ? T(" · 已采纳") : "");
  return (
    <section className={`disamb-pane${changed ? " is-changed" : ""}`} aria-label={T("卡 {side}", { side })} data-testid={`disamb-pane-${side}`}>
      <h3 className="disamb-pane-title">
        {T("卡 {side}", { side })}
        {wasArchived && <span className="disamb-tag">{T("已归档")}</span>}
        {changed && <span className="disamb-tag disamb-tag-changed">{T("已修改")}</span>}
      </h3>
      <label className="disamb-field">
        <span>{T("前缀（contextPrefix）")}{mark("contextPrefix")}</span>
        <input type="text" value={fields.contextPrefix} onChange={(e) => onChange({ contextPrefix: e.target.value })} />
      </label>
      <label className="disamb-field">
        <span>{T("问题")}{isCloze ? T("（挖空原文）") : ""}{mark("front")}</span>
        {/* C-34d：辨析改写卡面正反面统一用 MdField（所见即所得紧凑档）——此前裸 textarea 纯文本，
            markdown 源码/挖空语法在辨析时被当成纯文字；受控 onChange 语义不变（宿主保存链不动）。 */}
        <MdField value={fields.front} onChange={(v) => onChange({ front: v })} minRows={3} />
      </label>
      <label className="disamb-field">
        <span>{T("答案")}{mark("back")}</span>
        <MdField value={fields.back} onChange={(v) => onChange({ back: v })} minRows={3} />
      </label>
      <p className="disamb-source">
        {sourceLabel(src)}
        {src.anchor ? ` · ${src.anchor}` : ""}
      </p>
      <details className="disamb-origin">
        <summary>{T("原文")}</summary>
        {origin === undefined ? (
          <p className="form-hint">{T("读取中…")}</p>
        ) : origin ? (
          <div className="disamb-origin-text">{origin}</div>
        ) : (
          <p className="form-hint">{T("无原文记录")}</p>
        )}
      </details>
    </section>
  );
}
