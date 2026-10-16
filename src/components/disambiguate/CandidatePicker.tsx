// D121 §3.2 第一步：选定另一张卡（纯本地，无任何网络/AI 调用）
// 顶部搜索框（front/back/来源书名子串，≤20 条）→ 默认本地候选 Top 5 → 末项固定「这题本身问得不清」（单卡模式）。
import { useMemo, useState } from "react";
import { clipText, searchCards } from "../../lib/disambiguateUi";
import { isArchived, sourceLabel, sourceOf, type CardWithTitle } from "./shared";
import { useT } from "../../lib/i18n";

function frontOf(c: CardWithTitle): string {
  // 图片卡 front 无区分度，改用 back（与候选打分口径一致）
  if (c.cardType === "imageOcclusion") return c.backMarkdown || "";
  return c.frontMarkdown || c.noteText || "";
}

function CandidateRow({ card, onPick }: { card: CardWithTitle; onPick: (c: CardWithTitle) => void }) {
  const T = useT();
  const archived = isArchived(card);
  const suspended = !!card.leech?.suspended;
  return (
    <button type="button" className="disamb-candidate" data-testid="disamb-candidate" onClick={() => onPick(card)}>
      <span className="disamb-candidate-q">{clipText(frontOf(card), 80)}</span>
      <span className="disamb-candidate-a">{clipText(card.cardType === "imageOcclusion" ? "" : card.backMarkdown, 60) || T("（无答案文本）")}</span>
      <span className="disamb-candidate-meta">
        <span>{sourceLabel(sourceOf(card))}</span>
        {archived && <span className="disamb-tag">{T("已归档")}</span>}
        {suspended && <span className="disamb-tag">{T("已暂停")}</span>}
      </span>
    </button>
  );
}

export default function CandidatePicker({
  selfId,
  all,
  ranked,
  loading,
  onPick,
  onSingle
}: {
  selfId: string;
  all: CardWithTitle[];
  /** 已按分数降序的本地候选（rankDisambiguationCandidates 输出） */
  ranked: { id: string; score: number; archived: boolean }[];
  loading: boolean;
  onPick: (c: CardWithTitle) => void;
  onSingle: () => void;
}) {
  const [query, setQuery] = useState("");
  const T = useT();
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  const searching = query.trim() !== "";
  const found = useMemo(() => (searching ? searchCards(all, query, selfId) : []), [all, query, selfId, searching]);
  const defaults = useMemo(
    () => ranked.map((r) => byId.get(r.id)).filter((c): c is CardWithTitle => !!c),
    [ranked, byId]
  );
  const list = searching ? found : defaults;

  return (
    <div className="disamb-picker">
      <p className="form-hint">{T("选择与这张卡「问题相近但答案看起来矛盾」的另一张卡；也可以直接说明这题本身问得不清。")}</p>
      <input
        type="search"
        className="disamb-search"
        data-testid="disamb-search"
        placeholder={T("搜索全部卡片（问题 / 答案 / 来源书名）")}
        aria-label={T("搜索卡片")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <p className="form-hint">{T("正在读取卡片…")}</p>}
      {!loading && list.length === 0 && (
        <p className="form-hint">{searching ? T("没有匹配的卡片。") : T("没找到相近卡，可用搜索。")}</p>
      )}
      <div className="disamb-list">
        {list.map((c) => (
          <CandidateRow key={c.id} card={c} onPick={onPick} />
        ))}
        <button type="button" className="disamb-candidate disamb-single" data-testid="disamb-single" onClick={onSingle}>
          <span className="disamb-candidate-q">{T("不是另一张，是这题本身问得不清")}</span>
          <span className="disamb-candidate-a">{T("单卡模式：不选对照卡，只诊断这一张。")}</span>
        </button>
      </div>
    </div>
  );
}
