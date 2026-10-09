// 卡片辨析核心（D121 / v48.77，§3.2-§3.4）——纯函数、零依赖。
// 主进程、渲染层（DisambiguateModal）、node 测试三方共用（mindmapCore 同款纪律：单一真源，禁止复制）。
// 职责：候选打分 rankDisambiguationCandidates / 输入构造 buildDisambiguateInput /
//       出层校验 validateDisambiguateOutput。
// 边界：不做 IO、不调用 AI、不碰数据库。

export const VERDICTS = ["missing-qualifier", "one-wrong", "duplicate", "confusable", "no-conflict", "insufficient", "manual"];

export const VERDICT_LABELS = {
  "missing-qualifier": "两张都对，前提不同",
  "one-wrong": "有一张可能有误",
  duplicate: "重复，只是说法不同",
  confusable: "两个概念确实易混",
  "no-conflict": "没有冲突",
  insufficient: "依据不足，无法判断",
  manual: "手动处理"
};

// 模型可输出的 verdict（'manual' 仅用于用户手动处理，不接受模型给出）
const MODEL_VERDICTS = VERDICTS.filter((v) => v !== "manual");

// ---------- 文本归一与相似度 ----------

/** cloze 渲染 → 空白归一 → 去 CJK/ASCII 标点与符号 → 小写 */
export function normalizeText(s) {
  if (s == null) return "";
  let t = String(s).replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[\p{P}\p{S}]/gu, "");
  t = t.replace(/\s+/g, " ").trim();
  return t.toLowerCase();
}

function bigramSet(t) {
  const set = new Set();
  const chars = Array.from(t);
  if (chars.length === 0) return set;
  if (chars.length === 1) {
    set.add(chars[0]);
    return set;
  }
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
  return set;
}

/** 字符 bigram Jaccard（在 normalizeText 输出上）；单字符串视为一个 gram；双空 → 0 */
export function bigramJaccard(a, b) {
  const sa = bigramSet(normalizeText(a));
  const sb = bigramSet(normalizeText(b));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------- 候选打分（§3.2） ----------

const nonEmpty = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : "");

function cardFront(c) {
  if (c.cardType === "imageOcclusion") return c.backMarkdown || "";
  return c.frontMarkdown || c.noteText || "";
}
function cardBack(c) {
  if (c.cardType === "imageOcclusion") return "";
  return c.backMarkdown || "";
}
function docIdOf(c) {
  return nonEmpty(c.contextRef && c.contextRef.documentId);
}
function bookKeyOf(c) {
  return nonEmpty(c.sourceRef && c.sourceRef.title) || nonEmpty(c.docTitle);
}

function sameBook(a, b) {
  const da = docIdOf(a), db = docIdOf(b);
  if (da && db) return da === db;
  const ta = bookKeyOf(a), tb = bookKeyOf(b);
  return !!ta && ta === tb;
}

function sameCluster(a, b) {
  const ka = nonEmpty(a.knowledgePointId);
  if (!ka || ka !== nonEmpty(b.knowledgePointId)) return false;
  const ga = nonEmpty(a.genBatchId);
  if (ga && ga === nonEmpty(b.genBatchId)) return true;
  const da = docIdOf(a);
  return !!da && da === docIdOf(b);
}

function mainDomain(c) {
  return Array.isArray(c.domain) ? nonEmpty(c.domain[0]) : "";
}

/**
 * score = 0.55·J(front) + 0.2·J(back) + 0.15·[同 kp 且（同 genBatch 或同 documentId）] + 0.05·[同主 domain] + 0.05·[同来源书]
 * 排除自身与软删除；归档保留并标 archived；score<0.08 丢弃；降序，同分保持输入顺序。
 */
export function rankDisambiguationCandidates(base, all, k = 5) {
  if (!base || !Array.isArray(all)) return [];
  const bf = cardFront(base), bb = cardBack(base);
  const bd = mainDomain(base);
  const scored = [];
  all.forEach((c, idx) => {
    if (!c || c.id === base.id || c.isDeleted) return;
    let score = 0.55 * bigramJaccard(bf, cardFront(c)) + 0.2 * bigramJaccard(bb, cardBack(c));
    if (sameCluster(base, c)) score += 0.15;
    const cd = mainDomain(c);
    if (bd && bd === cd) score += 0.05;
    if (sameBook(base, c)) score += 0.05;
    if (score < 0.08) return;
    scored.push({ id: c.id, raw: score, idx, archived: c.status === "archived" });
  });
  scored.sort((x, y) => (y.raw !== x.raw ? y.raw - x.raw : x.idx - y.idx));
  return scored.slice(0, k).map((s) => ({ id: s.id, score: Math.round(s.raw * 1000) / 1000, archived: s.archived }));
}

// ---------- 输入构造（§3.3） ----------

const ORIGIN_MAX = 1500;

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

function questionLine(side) {
  const prefix = str(side.prefix);
  let front = str(side.front);
  if (prefix && /[:：]$/.test(prefix)) front = front.replace(/^[:：]\s*/, "");
  return prefix + front;
}

function sourceLine(side) {
  const title = str(side.sourceTitle);
  if (!title) return "来源：未知";
  const parts = ["《" + title + "》"];
  const author = str(side.author);
  const anchor = str(side.anchor);
  if (author) parts.push(author);
  if (anchor) parts.push(anchor);
  return "来源：" + parts.join(" · ");
}

function cardBlock(label, side) {
  const s = side || {};
  const original = str(s.original);
  return [
    "【卡 " + label + "】",
    "问题：" + questionLine(s),
    "答案：" + str(s.back),
    sourceLine(s),
    label + " 的原文：" + (original ? original.slice(0, ORIGIN_MAX) : "（无原文记录）")
  ].join("\n");
}

export function buildDisambiguateInput({ a, b }) {
  const first = cardBlock("A", a);
  if (!b) return first + "\n\n【模式】单卡：用户认为卡 A 本身问得不清，没有对照卡。";
  return first + "\n\n" + cardBlock("B", b);
}

// ---------- 出层校验（§3.3） ----------

const EXPLAIN_MAX = 150;
const AFTER_MAX = 500;
const FIELDS = ["contextPrefix", "front", "back"];

/** balanced-brace 提取：逐个 `{` 起点，按字符串/转义感知找配平的 `}`，首个可解析为对象者胜出 */
function extractJsonObject(raw) {
  if (typeof raw !== "string") return null;
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(raw.slice(start, i + 1));
            if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
          } catch {
            /* 试下一个起点 */
          }
          break;
        }
      }
    }
  }
  return null;
}

const normWs = (s) => String(s).replace(/\s+/g, " ").trim();

export function validateDisambiguateOutput(raw, opts) {
  const { hasB, originA, originB, current } = opts || {};
  const insufficient = (explanation) => ({
    verdict: "insufficient",
    explanation,
    evidence: [],
    fixes: [],
    wrongCard: null,
    keepCard: null
  });

  const obj = extractJsonObject(raw);
  if (!obj) return insufficient(String(raw == null ? "" : raw).trim().slice(0, EXPLAIN_MAX));

  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim().slice(0, EXPLAIN_MAX) : "";

  let verdict = MODEL_VERDICTS.includes(obj.verdict) ? obj.verdict : "insufficient";
  if (!hasB && (verdict === "duplicate" || verdict === "confusable")) verdict = "insufficient";

  const cardOk = (c) => c === "A" || (c === "B" && !!hasB);

  // evidence
  const evidence = [];
  if (Array.isArray(obj.evidence)) {
    for (const e of obj.evidence) {
      if (!e || !cardOk(e.card) || typeof e.quote !== "string") continue;
      const quote = e.quote.trim();
      if (!quote) continue;
      const origin = e.card === "A" ? originA : originB;
      const o = typeof origin === "string" ? normWs(origin) : "";
      const verified = o !== "" && o.includes(normWs(quote));
      evidence.push({ card: e.card, quote, verified });
    }
  }

  // fixes
  const fixes = [];
  if (Array.isArray(obj.fixes)) {
    for (const f of obj.fixes) {
      if (!f || !cardOk(f.card) || !FIELDS.includes(f.field)) continue;
      if (typeof f.after !== "string") continue;
      const after = f.after.trim();
      if (!after || after.length > AFTER_MAX) continue;
      const cur = current && current[f.card] ? current[f.card][f.field] : undefined;
      if (typeof cur === "string" && cur.trim() === after) continue;
      fixes.push({ card: f.card, field: f.field, after });
    }
  }

  let wrongCard = obj.wrongCard === "A" || (obj.wrongCard === "B" && hasB) ? obj.wrongCard : null;
  let keepCard = obj.keepCard === "A" || (obj.keepCard === "B" && hasB) ? obj.keepCard : null;

  if (verdict === "one-wrong" && wrongCard === null) verdict = "insufficient";
  if (verdict === "duplicate" && keepCard === null) keepCard = "A";

  // 这三类 verdict 不应带修改方案（提示词约定 fixes 为空）
  const noFix = verdict === "insufficient" || verdict === "confusable" || verdict === "no-conflict";
  return { verdict, explanation, evidence, fixes: noFix ? [] : fixes, wrongCard, keepCard };
}
