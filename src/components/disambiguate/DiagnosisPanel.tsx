// D121 §3.3 第二步：AI 诊断结果面板（按 verdict 分流：采纳修改 / 归档 / 生成对比卡 / 仅显示解释）
// 纯展示 + 回调：「采纳」只写第二屏编辑框（不落库）；归档走父组件 cardsApi.batch("archive")；
// 对比卡生成状态由父组件持有，列表内嵌 ContrastDraftList。
import { useState } from "react";
import { VERDICT_LABELS, type DisambiguateFix, type DisambiguateResult } from "../../lib/disambiguateCore.mjs";
import { diffSegments, duplicateArchiveSuggestion, verdictHeading, type EditableFields, type Side } from "../../lib/disambiguateUi";
import type { CardDraft, CardRecord } from "../../lib/cards";
import ContrastDraftList from "../ContrastDraftList";
import { IconAlert } from "../icons";
import { useT } from "../../lib/i18n";

const FIELD_LABEL: Record<keyof EditableFields, string> = { contextPrefix: "前缀", front: "问题", back: "答案" };

export interface ContrastState {
  running: boolean;
  progress: number;
  thinking: boolean;
  error: string;
  drafts: CardDraft[] | null;
}

export const fixKey = (f: { card: Side; field: string }) => `${f.card}:${f.field}`;

function FixRow({ fix, before, adopted, onAdopt }: { fix: DisambiguateFix; before: string; adopted: boolean; onAdopt: () => void }) {
  const T = useT();
  const d = diffSegments(before, fix.after);
  return (
    <div className="disamb-fix card-outlined" data-testid="disamb-fix">
      <div className="disamb-fix-head">
        <span className="mono">{T("卡 {side} · {field}", { side: fix.card, field: T(FIELD_LABEL[fix.field]) })}</span>
        {adopted ? (
          <span className="form-hint state-ok">{T("已采纳（待保存）")}</span>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={onAdopt}>{T("采纳")}</button>
        )}
      </div>
      <div className="disamb-diff" aria-label={T("原值")}>
        <span className="disamb-diff-tag">{T("原值")}</span>
        {d.prefix}
        {d.beforeMid && <mark className="disamb-del">{d.beforeMid}</mark>}
        {d.suffix}
      </div>
      <div className="disamb-diff" aria-label={T("新值")}>
        <span className="disamb-diff-tag">{T("新值")}</span>
        {d.prefix}
        {d.afterMid && <mark className="disamb-add">{d.afterMid}</mark>}
        {d.suffix}
      </div>
    </div>
  );
}

function ArchiveButton({
  side,
  already,
  busy,
  primary,
  onArchive
}: {
  side: Side;
  already: boolean;
  busy: boolean;
  primary: boolean;
  onArchive: (side: Side) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const T = useT();
  if (already) return <span className="form-hint state-ok">{T("卡 {side} 已归档", { side })}</span>;
  if (confirming) {
    return (
      <span className="disamb-confirm" role="group" aria-label={T("确认归档卡 {side}", { side })}>
        <span className="form-hint">{T("确认归档卡 {side}？（不再复习，可在卡片浏览中恢复）", { side })}</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void onArchive(side).finally(() => setConfirming(false))}
        >
          {T("确认归档")}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setConfirming(false)}>{T("取消")}</button>
      </span>
    );
  }
  return (
    <button type="button" className={`btn ${primary ? "btn-primary" : "btn-outline"} btn-sm`} disabled={busy} onClick={() => setConfirming(true)}>
      {T("归档卡 {side}", { side })}
    </button>
  );
}

export default function DiagnosisPanel({
  result,
  snapshot,
  single,
  adopted,
  archivedSides,
  archiveBusy,
  contrast,
  contrastSource,
  onAdopt,
  onArchive,
  onGenerateContrast
}: {
  result: DisambiguateResult;
  /** 诊断发起时两栏的字段快照（diff 的「原值」，不随后续手改漂移） */
  snapshot: { A: EditableFields; B: EditableFields | null };
  single: boolean;
  adopted: Set<string>;
  archivedSides: Set<Side>;
  archiveBusy: boolean;
  contrast: ContrastState;
  contrastSource: { title: string; author: string; contextRef: CardRecord["contextRef"] };
  onAdopt: (fix: DisambiguateFix) => void;
  onArchive: (side: Side) => Promise<void>;
  onGenerateContrast: () => void;
}) {
  const v = result.verdict;
  const T = useT();
  const T_LABELS = Object.fromEntries(Object.entries(VERDICT_LABELS).map(([k, val]) => [k, T(val)]));
  const heading = verdictHeading(result, T_LABELS, single, T);
  const showFixes = (v === "missing-qualifier" || v === "one-wrong") && result.fixes.length > 0;
  const suggested = duplicateArchiveSuggestion(result.keepCard);
  const other: Side = suggested === "A" ? "B" : "A";
  return (
    <div className="disamb-result" data-testid="disamb-result">
      <span className={`judge-verdict disamb-verdict v-${v}`} data-testid="disamb-verdict" data-verdict={v}>
        {heading}
      </span>
      <div className="judge-explanation">{result.explanation || T("（模型未给出说明）")}</div>

      {result.evidence.length > 0 && (
        <ul className="disamb-evidence" aria-label={T("依据")}>
          {result.evidence.map((e, i) => (
            <li key={i} className={e.verified ? "" : "is-unverified"}>
              <span className="mono">{T("卡 {side}", { side: e.card })}</span>「{e.quote}」
              {!e.verified && <span className="disamb-tag">{T("未能在原文中核实")}</span>}
            </li>
          ))}
        </ul>
      )}

      {showFixes && (
        <div className="disamb-fixes">
          {result.fixes.map((f) => (
            <FixRow
              key={fixKey(f)}
              fix={f}
              before={(f.card === "A" ? snapshot.A : snapshot.B ?? snapshot.A)[f.field]}
              adopted={adopted.has(fixKey(f))}
              onAdopt={() => onAdopt(f)}
            />
          ))}
        </div>
      )}

      {v === "one-wrong" && result.wrongCard && (
        <div className="ai-actions">
          <ArchiveButton side={result.wrongCard} already={archivedSides.has(result.wrongCard)} busy={archiveBusy} primary={false} onArchive={onArchive} />
        </div>
      )}

      {v === "duplicate" && !single && (
        <div className="ai-actions">
          <ArchiveButton side={suggested} already={archivedSides.has(suggested)} busy={archiveBusy} primary onArchive={onArchive} />
          <ArchiveButton side={other} already={archivedSides.has(other)} busy={archiveBusy} primary={false} onArchive={onArchive} />
        </div>
      )}

      {v === "confusable" && !single && (
        <div className="disamb-contrast">
          {contrast.drafts === null && (
            <div className="ai-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={contrast.running} onClick={onGenerateContrast}>
                {contrast.running ? T("生成中…") : T("生成对比卡")}
              </button>
            </div>
          )}
          {contrast.running && (
            <p className="form-hint">
              {T("AI 正在为这两张卡生成对比卡…（{n} 字）", { n: contrast.progress })}
              {contrast.thinking && T("（模型思考中，静默数十秒属正常）")}
            </p>
          )}
          {contrast.error && <p className="ai-draft-warnings"><IconAlert size={14} /> {contrast.error}</p>}
          {contrast.drafts !== null && (
            <ContrastDraftList
              drafts={contrast.drafts}
              sourceTitle={contrastSource.title || null}
              sourceAuthor={contrastSource.author || null}
              contextRef={contrastSource.contextRef}
            />
          )}
        </div>
      )}

      {v === "insufficient" && <p className="form-hint">{T("依据不足，请对照原文手动修改。")}</p>}
      <p className="form-hint">{T("AI 判断仅供参考，不会自动修改任何卡片；采纳的修改需点「保存修改」才会落库。")}</p>
    </div>
  );
}
