// D121 §3 辨析弹窗的纯逻辑（零依赖，node 测试经 stripTypeScriptTypes 直接加载；组件与 cards.ts 复用）
// - diffSegments：公共前后缀之外的差异段（fixes 的「原值 → 新值」高亮）
// - applyCardTextEdit：编辑落库的字段语义（与复习页内联编辑一致：front 同写 frontMarkdown 与 noteText）
// - searchCards：第一步搜索框（front/back/来源书名，不区分大小写子串，≤20 条）
// - 其余为展示文案/判定的小函数

export interface DiffSegments {
  prefix: string;
  beforeMid: string;
  afterMid: string;
  suffix: string;
}

/** 公共前缀 + 公共后缀之外即差异段（按 code point 比较，不拆代理对）。前后缀互不重叠。 */
export function diffSegments(before: string, after: string): DiffSegments {
  const a = Array.from(String(before ?? ""));
  const b = Array.from(String(after ?? ""));
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return {
    prefix: a.slice(0, p).join(""),
    beforeMid: a.slice(p, a.length - s).join(""),
    afterMid: b.slice(p, b.length - s).join(""),
    suffix: a.slice(a.length - s).join("")
  };
}

export interface EditableFields {
  contextPrefix: string;
  front: string;
  back: string;
}

interface CardTextLike {
  contextPrefix?: string | null;
  frontMarkdown?: string | null;
  noteText?: string | null;
  backMarkdown?: string | null;
}

/** 卡 → 编辑框初值（挖空卡 front 即 cloze 原文；与 CardFace 的 frontText 同口径） */
export function fieldsOfCard(card: CardTextLike): EditableFields {
  return {
    contextPrefix: card.contextPrefix ?? "",
    front: card.frontMarkdown || card.noteText || "",
    back: card.backMarkdown ?? ""
  };
}

export function fieldsChanged(orig: EditableFields, cur: EditableFields): boolean {
  return orig.contextPrefix !== cur.contextPrefix || orig.front !== cur.front || orig.back !== cur.back;
}

/**
 * 把编辑框内容并回整行卡记录（cards:update 是全行更新，调用方传回整张卡）。
 * 语义与复习页内联编辑一致：front 改动 → frontMarkdown 与 noteText 同写（挖空卡存 cloze 原文）；
 * back → backMarkdown；contextPrefix 空串 → null。未改动的字段原样保留（不顺手改 noteText）。
 * 绝不碰 fsrs / 调度状态。
 */
export function applyCardTextEdit<T extends CardTextLike>(card: T, next: EditableFields): T {
  const orig = fieldsOfCard(card);
  const out: T = { ...card };
  if (next.front !== orig.front) {
    out.frontMarkdown = next.front;
    out.noteText = next.front;
  }
  if (next.back !== orig.back) out.backMarkdown = next.back;
  if (next.contextPrefix !== orig.contextPrefix) {
    out.contextPrefix = next.contextPrefix.trim() === "" ? null : next.contextPrefix;
  }
  return out;
}

/** §3.2：front 与原 front 的 bigram 相似度低于此值，保存提示追加「改动较大」 */
export const BIG_CHANGE_SIMILARITY = 0.5;
export function isBigFrontChange(similarity: number): boolean {
  return similarity < BIG_CHANGE_SIMILARITY;
}

const CLOZE_RE = /\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;

/** 截断（按 code point）并折叠空白；挖空语法渲染为答案文本 */
export function clipText(s: string | null | undefined, n: number): string {
  const t = String(s ?? "").replace(CLOZE_RE, "$1").replace(/\s+/g, " ").trim();
  const a = Array.from(t);
  return a.length > n ? a.slice(0, n).join("") + "…" : t;
}

export interface SearchableCard {
  id: string;
  cardType?: string;
  frontMarkdown?: string | null;
  noteText?: string | null;
  backMarkdown?: string | null;
  sourceRef?: { title?: string | null } | null;
  docTitle?: string | null;
  isDeleted?: boolean | number | null;
}

export const SEARCH_LIMIT = 20;

/** §3.2 搜索：对 front/back/来源书名做不区分大小写子串匹配；排除自身与软删除；最多 20 条；空查询返回 [] */
export function searchCards<T extends SearchableCard>(all: T[], query: string, selfId: string, limit = SEARCH_LIMIT): T[] {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const out: T[] = [];
  for (const c of all) {
    if (c.id === selfId || c.isDeleted) continue;
    const hay = [c.frontMarkdown, c.noteText, c.backMarkdown, c.sourceRef?.title, c.docTitle]
      .map((x) => String(x ?? "").toLowerCase())
      .join("\n");
    if (hay.includes(q)) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export type Side = "A" | "B";

export interface HeadingResultLike {
  verdict: string;
  wrongCard: Side | null;
}

/** §3.3 UI 表：各 verdict 的标题；单卡模式的 missing-qualifier 不存在「两张」，改写为单卡措辞。
 *  tr 为可选翻译回调（默认恒等）：zh-CN 输出不变（供 node 零依赖测试），UI 调用方传 T。 */
export function verdictHeading(res: HeadingResultLike, labels: Record<string, string>, single: boolean, tr: (s: string) => string = (s) => s): string {
  if (res.verdict === "one-wrong") return tr("卡 {side} 可能有误").replace("{side}", res.wrongCard ?? "A");
  if (res.verdict === "missing-qualifier" && single) return tr("问题缺少限定条件");
  return labels[res.verdict] ?? res.verdict;
}

/** duplicate：默认建议归档「非 keepCard」那张 */
export function duplicateArchiveSuggestion(keepCard: Side | null): Side {
  return (keepCard ?? "A") === "A" ? "B" : "A";
}

/** §3.5：复习页背面「已辨析」提示文案；单卡链接（other 为 null）显示「已辨析（单卡）」。tr 同 verdictHeading。 */
export function disambHintText(other: { front: string } | null, verdictLabel: string | null, tr: (s: string) => string = (s) => s): string {
  if (!other) return tr("已辨析（单卡）");
  const base = tr("已与「{front}」辨析").replace("{front}", clipText(other.front, 30));
  return verdictLabel ? `${base} · ${verdictLabel}` : base;
}

export interface LinkLike {
  updatedAt?: number;
  createdAt?: number;
}
/** 多条链接时取最近更新的一条 */
export function latestLink<T extends LinkLike>(links: T[]): T | null {
  let best: T | null = null;
  for (const l of links) {
    const t = Number(l.updatedAt ?? l.createdAt ?? 0);
    if (!best || t > Number(best.updatedAt ?? best.createdAt ?? 0)) best = l;
  }
  return best;
}

export const ORIGIN_MAX = 1500;
export const NOTE_MAX = 500;

// ---- D121 §4.1 手动制卡保存前相似卡预检（纯逻辑） ----
/** 某相似卡答案与本卡 back 的 bigram Jaccard 低于此值 → 标「答案不同」 */
export const ANSWER_DIFF_THRESHOLD = 0.3;
/** 预检最多展示几条相似卡 */
export const PRECHECK_K = 3;

/** 「答案不同」判定（jaccard 由调用方用 disambiguateCore.bigramJaccard 算出）；任一侧答案为空（如挖空卡）不下结论 */
export function answerDiffers(back: string | null | undefined, otherBack: string | null | undefined, jaccard: number): boolean {
  if (!String(back ?? "").trim() || !String(otherBack ?? "").trim()) return false;
  return jaccard < ANSWER_DIFF_THRESHOLD;
}

/** 预检用文本 = 将被保存为 front 的文本；图片挖空不预检（返回 null）；挖空模式用转换后的 cloze 文本 */
export function manualPrecheckText(mode: string, front: string, clozeText?: string | null): string | null {
  if (mode === "imageOcclusion") return null;
  const t = String(mode === "cloze" ? clozeText ?? front : front ?? "").trim();
  return t ? t : null;
}

const normPrecheck = (s: string) => s.replace(/\s+/g, " ").trim();

/** 面板只出现一次：仅当文本非空且与上次已检索文本（空白归一后）不同才重新检索 */
export function shouldRunPrecheck(text: string | null, lastChecked: string | null): boolean {
  if (!text) return false;
  if (lastChecked === null) return true;
  return normPrecheck(text) !== normPrecheck(lastChecked);
}
