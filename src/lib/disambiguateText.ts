// D121 纯文本辅助（零依赖，node 测试经 stripTypeScriptTypes 直接加载；cards.ts 再导出）
// - normalizeQualifier：§2.6 AI qualifier 字段归一
// - needsAttribution：§4.3 观点性措辞归属判定（L18 与 AIPanel 复用）
// - formatRelatedCardLine：§2.4 相关已有卡单行格式

export type QualifierStance = "author" | "reported" | "criticized" | "consensus" | "unknown";
export interface CardQualifier {
  stance: QualifierStance;
  holder: string | null;
  note: string | null;
}

const STANCES: readonly string[] = ["author", "reported", "criticized", "consensus", "unknown"];
const QUALIFIER_FIELD_MAX = 60;

/** §2.6：非法 stance → null（视为缺失）；holder/note 非字符串或空 → null；各 ≤60 字 */
export function normalizeQualifier(raw: unknown): CardQualifier | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const stance = typeof r.stance === "string" ? r.stance.trim().toLowerCase() : "";
  if (!STANCES.includes(stance)) return null;
  const field = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t || t === "null") return null;
    return [...t].slice(0, QUALIFIER_FIELD_MAX).join("");
  };
  return { stance: stance as QualifierStance, holder: field(r.holder), note: field(r.note) };
}

const OPINION_RE = /认为|主张|观点|学派|流派|声称|提出|倡导|批判/;
const GENERIC_SUBJECT_RE = /^(?:这|该|其|他|她|他们|她们|有人|一些人|某些人|人们|作者|材料)+$/;

/** §4.3：front 含观点词、contextPrefix 仅为领域词（或空）、观点词前主语为空/泛指 → true（应报 L18） */
export function needsAttribution(front: string, contextPrefix?: string | null): boolean {
  const text = String(front ?? "").replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");
  const m = OPINION_RE.exec(text);
  if (!m) return false;
  const prefix = String(contextPrefix ?? "").trim().replace(/[:：]\s*$/, "").trim();
  // 领域词判定（D121 审查收紧）：≤2 字（「统计」「线代」）或以学科后缀收尾（「政治哲学」「社会思想」）才算领域词；
  // 「桑德尔:」「罗尔斯:」这类人名前缀＝已带归属锚，不报。
  const plen = [...prefix].length;
  const domainOnly = prefix === "" || (plen <= 4 && !/[·（(]/.test(prefix) && (plen <= 2 || /(?:学|论|史|法|术|理|课|想|治|济|计|代|数|语|文)$/.test(prefix)));
  if (!domainOnly) return false;
  // 观点词之前的主语：取最近一个分句边界之后的文本
  const before = text.slice(0, m.index);
  const clause = before.split(/[，,；;。？?！!、:：]/).pop() ?? "";
  const subject = clause.replace(/\s+/g, "");
  // 「材料中的作者认为」视为已按 R19 处理，不报
  if (/^(?:材料|文中|本文|原文)(?:中|里)?的?作者$/.test(subject)) return false;
  if (subject === "") return true;
  return GENERIC_SUBJECT_RE.test(subject);
}

interface RelatedCardLike {
  cardType?: string | null;
  frontMarkdown?: string | null;
  backMarkdown?: string | null;
  noteText?: string | null;
  sourceRef?: { title?: string; author?: string } | null;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  const a = [...t];
  return a.length > n ? a.slice(0, n).join("") + "…" : t;
};
const stripCloze = (s: string) => s.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");

/** §2.4：`Q：{front≤80} ｜ A：{back≤60} ｜ 来源：《书名》 · 作者` */
export function formatRelatedCardLine(card: RelatedCardLike, docTitle?: string | null): string {
  const isCloze = String(card.cardType ?? "").toLowerCase().includes("cloze");
  const frontRaw = isCloze ? card.noteText || card.frontMarkdown || "" : card.frontMarkdown || card.noteText || "";
  const q = clip(stripCloze(frontRaw), 80);
  const a = clip(stripCloze(card.backMarkdown || ""), 60);
  const title = card.sourceRef?.title || docTitle || "未知";
  const author = card.sourceRef?.author ? ` · ${card.sourceRef.author}` : "";
  return `Q：${q} ｜ A：${a} ｜ 来源：《${title}》${author}`;
}
