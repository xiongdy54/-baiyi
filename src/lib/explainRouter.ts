// v48.51（D91 §5.4/§5.5/§4.3）：「简明解读」纯函数集——本地路由器 + 机器标记解析 + 事后建议相似性。
// 渲染层本地执行、不发任何请求（纯本地优先）；node 单测经 tests/d91.bundle.cjs（esbuild 打包）直跑。
// 路由是表面特征判断：判错代价不对称且小（误入简明仍得改写、误入通用一键重跑），语义级纠偏由
// 事后建议承接（D91 §5.5）——因此权重与阈值按金样例校准，不追求高精度。

/** 解读方式三态（D91 §5.3.1）：auto=本地路由器；显式选择会话内记忆，切回 auto 即恢复自动 */
export type ExplainModePref = "auto" | "general" | "ste";

/** 路由结果（解析后的实际方式） */
export type RoutedExplainMode = "general" | "ste";

/**
 * 歧义类别封闭集（D91 §4.3）：语言中立 key，展示名按 locale 渲染。
 * prompt 只枚举 key，模型只能从中选；新增类别 = 契约变更（bump 版本 + 决策号）。
 */
export const STE_CATEGORIES: ReadonlyArray<{ key: string; zh: string }> = [
  { key: "polysemy", zh: "一词多义" },
  { key: "pronoun-ref", zh: "指代不明" },
  { key: "long-nesting", zh: "长句嵌套" },
  { key: "hidden-agent", zh: "施动者隐藏" },
  { key: "negation-stack", zh: "否定叠加" },
  { key: "undefined-term", zh: "术语未定义" },
  { key: "register-mix", zh: "语域混杂" },
  { key: "quantity-vague", zh: "数量含糊" },
  { key: "idiom-figurative", zh: "比喻成语" },
  { key: "missing-condition", zh: "隐含前提" }
];

/**
 * 路由权重与阈值（导出常量承载，金样例校准——D91 §5.4：
 * 结构平直的长句不应触发 ste：句长仅作低权重因子，嵌套/否定/被动密度为主因子）。
 */
export const EXPLAIN_ROUTER_WEIGHTS = {
  /** 括号嵌套深度 ≥ 2（强结构嵌套信号） */
  nestingDeep: 2.2,
  /** 同一句内否定词 ≥ 2（否定叠加） */
  negationStack: 2.2,
  /** 被动标记 ≥ 2 处 */
  passiveMany: 1.6,
  /** 被动标记 = 1 处 */
  passiveOne: 0.8,
  /** 平均每句逗号/顿号/分号 ≥ 3（分句密集） */
  clauseDense: 1.2,
  /** 平均每句分句 ≥ 2（弱信号，需与其他特征叠加） */
  clauseSome: 0.6,
  /** 平均句长 ≥ 50 字符 */
  lengthAvg: 0.6,
  /** 最长句 ≥ 100 字符 */
  lengthMax: 0.6
} as const;

/** 加权分 ≥ 阈值 → ste，否则 general */
export const EXPLAIN_ROUTER_THRESHOLD = 2.2;

/** 文本短于该长度不路由（短语/单词没有「结构」可言，恒 general） */
export const EXPLAIN_ROUTER_MIN_CHARS = 20;

const SENTENCE_SPLIT = /[。！？!?；;\n]+/;
const CLAUSE_SPLIT = /[,，、;；]/g;
const NEGATION = /不|没|无|非|未|莫|勿|别|not\b|no\b|never\b|n't/gi;
const PASSIVE_ZH = /被|由[^，。；]{0,8}所|为[^，。；]{0,6}所/g;
const PASSIVE_EN = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi;

interface FeatureSummary {
  sentences: string[];
  avgLen: number;
  maxLen: number;
  clauseDensity: number;
  maxBracketDepth: number;
  maxNegPerSentence: number;
  passiveCount: number;
}

function summarize(text: string): FeatureSummary {
  const sentences = text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const n = Math.max(1, sentences.length);
  let totalLen = 0;
  let maxLen = 0;
  let clauses = 0;
  let maxBracketDepth = 0;
  let maxNegPerSentence = 0;
  let passiveCount = 0;
  for (const s of sentences) {
    totalLen += s.length;
    if (s.length > maxLen) maxLen = s.length;
    clauses += (s.match(CLAUSE_SPLIT) ?? []).length;
    maxBracketDepth = Math.max(maxBracketDepth, bracketDepth(s));
    maxNegPerSentence = Math.max(maxNegPerSentence, (s.match(NEGATION) ?? []).length);
    passiveCount += (s.match(PASSIVE_ZH) ?? []).length + (s.match(PASSIVE_EN) ?? []).length;
  }
  return {
    sentences,
    avgLen: totalLen / n,
    maxLen,
    clauseDensity: clauses / n,
    maxBracketDepth,
    maxNegPerSentence,
    passiveCount
  };
}

/** 括号嵌套深度（全角/半角圆括号、方括号分开计数取最大） */
function bracketDepth(s: string): number {
  const pairs: Array<[string, string]> = [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"]
  ];
  let max = 0;
  for (const [open, close] of pairs) {
    let depth = 0;
    let deepest = 0;
    for (const ch of s) {
      if (ch === open) {
        depth += 1;
        if (depth > deepest) deepest = depth;
      } else if (ch === close && depth > 0) {
        depth -= 1;
      }
    }
    max = Math.max(max, deepest);
  }
  return max;
}

/**
 * 本地路由器（D91 §5.4）：纯函数 `routeExplainMode(text) → "general" | "ste"`。
 * 特征 = 材料语言不敏感的表面特征：句长 / 每句分句密度 / 括号嵌套 / 否定计数 / 被动标记。
 */
export function routeExplainMode(text: string): RoutedExplainMode {
  const src = String(text ?? "").trim();
  if (src.length < EXPLAIN_ROUTER_MIN_CHARS) return "general";
  const f = summarize(src);
  const w = EXPLAIN_ROUTER_WEIGHTS;
  let score = 0;
  if (f.maxBracketDepth >= 2) score += w.nestingDeep;
  if (f.maxNegPerSentence >= 2) score += w.negationStack;
  if (f.passiveCount >= 2) score += w.passiveMany;
  else if (f.passiveCount === 1) score += w.passiveOne;
  if (f.clauseDensity >= 3) score += w.clauseDense;
  else if (f.clauseDensity >= 2) score += w.clauseSome;
  if (f.avgLen >= 50) score += w.lengthAvg;
  if (f.maxLen >= 100) score += w.lengthMax;
  return score >= EXPLAIN_ROUTER_THRESHOLD ? "ste" : "general";
}

// ---------- 机器标记契约（D91 §4.2）：<!--ste:matLang=xx--> / <!--ste:points=N--> / <!--ste:readings=N--> ----------

export interface SteMarkers {
  matLang?: string;
  points?: number;
  readings?: number;
}

/** 从答案原文解析 ste 机器标记（HTML 注释，Markdown 渲染不可见） */
export function parseSteMarkers(answer: string): SteMarkers {
  const out: SteMarkers = {};
  // v48.74（D118 追加）：值字符集放宽为 [^>]*——原 [^>-]* 把连字符排除在外，
  // BCP-47 语言代码（zh-Hans / en-US）含连字符 ⇒ matLang 标记既解析不出也剥不掉（界面露出代码）
  const re = /<!--ste:([a-zA-Z]+)=([^>]*)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(answer ?? "")))) {
    const key = m[1];
    const raw = m[2].trim();
    if (key === "matLang") out.matLang = raw || undefined;
    else if (key === "points") out.points = Number.isFinite(Number(raw)) ? Number(raw) : undefined;
    else if (key === "readings") out.readings = Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  }
  return out;
}

/** 剥掉机器标记后的正文（渲染层不需要——HTML 注释本身不渲染；供相似性比较用） */
export function stripSteMarkers(answer: string): string {
  return String(answer ?? "").replace(/<!--ste:[a-zA-Z]+=[^>]*-->/g, "");
}

// ---------- 事后建议的「改写≈原文」判定（D91 §5.5） ----------

/**
 * 轻量 containment 相似性：源文本归一化后的字符 bigram 有多少出现在答案里。
 * 仅用于「路由进了 ste 但改写与原文几乎一致」的事后建议（§5.5），不是通用相似检索。
 */
export const EXPLAIN_SAME_TEXT_RATIO = 0.6;
/** 源文本归一化后低于该长度不判（太短的文本 incidental 命中率过高，宁可不建议） */
export const EXPLAIN_SAME_TEXT_MIN_CHARS = 12;

function normalizeForOverlap(s: string): string {
  return stripSteMarkers(s)
    .toLowerCase()
    .replace(/[\s`*_~>#|\-–—'"「」『』【】（）(){}[\]、，。；：！？.,;:!?"'`]/g, "");
}

export function isLikelySameText(source: string, answer: string): boolean {
  const a = normalizeForOverlap(source);
  const b = normalizeForOverlap(answer);
  if (a.length < EXPLAIN_SAME_TEXT_MIN_CHARS || b.length < a.length / 2) return false;
  const srcBigrams = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) srcBigrams.add(a.slice(i, i + 2));
  if (srcBigrams.size === 0) return false;
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    if (srcBigrams.has(g)) hit += 1;
  }
  // 分母用源 bigram 总出现数（重复片段按出现计数），答案覆盖率 ≥ 阈值即视为「几乎一致」
  const total = a.length - 1;
  return hit / total >= EXPLAIN_SAME_TEXT_RATIO;
}
