"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tests/d91.entry.ts
var d91_entry_exports = {};
__export(d91_entry_exports, {
  EXPLAIN_ROUTER_MIN_CHARS: () => EXPLAIN_ROUTER_MIN_CHARS,
  EXPLAIN_ROUTER_THRESHOLD: () => EXPLAIN_ROUTER_THRESHOLD,
  EXPLAIN_ROUTER_WEIGHTS: () => EXPLAIN_ROUTER_WEIGHTS,
  EXPLAIN_SAME_TEXT_MIN_CHARS: () => EXPLAIN_SAME_TEXT_MIN_CHARS,
  EXPLAIN_SAME_TEXT_RATIO: () => EXPLAIN_SAME_TEXT_RATIO,
  STE_CATEGORIES: () => STE_CATEGORIES,
  STE_OUTPUT_LANG: () => STE_OUTPUT_LANG,
  STE_PROFILES: () => STE_PROFILES,
  formatProfile: () => formatProfile,
  isLikelySameText: () => isLikelySameText,
  parseSteMarkers: () => parseSteMarkers,
  resolveProfile: () => resolveProfile,
  routeExplainMode: () => routeExplainMode,
  stripSteMarkers: () => stripSteMarkers
});
module.exports = __toCommonJS(d91_entry_exports);

// src/lib/explainRouter.ts
var STE_CATEGORIES = [
  { key: "polysemy", zh: "\u4E00\u8BCD\u591A\u4E49" },
  { key: "pronoun-ref", zh: "\u6307\u4EE3\u4E0D\u660E" },
  { key: "long-nesting", zh: "\u957F\u53E5\u5D4C\u5957" },
  { key: "hidden-agent", zh: "\u65BD\u52A8\u8005\u9690\u85CF" },
  { key: "negation-stack", zh: "\u5426\u5B9A\u53E0\u52A0" },
  { key: "undefined-term", zh: "\u672F\u8BED\u672A\u5B9A\u4E49" },
  { key: "register-mix", zh: "\u8BED\u57DF\u6DF7\u6742" },
  { key: "quantity-vague", zh: "\u6570\u91CF\u542B\u7CCA" },
  { key: "idiom-figurative", zh: "\u6BD4\u55BB\u6210\u8BED" },
  { key: "missing-condition", zh: "\u9690\u542B\u524D\u63D0" }
];
var EXPLAIN_ROUTER_WEIGHTS = {
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
};
var EXPLAIN_ROUTER_THRESHOLD = 2.2;
var EXPLAIN_ROUTER_MIN_CHARS = 20;
var SENTENCE_SPLIT = /[。！？!?；;\n]+/;
var CLAUSE_SPLIT = /[,，、;；]/g;
var NEGATION = /不|没|无|非|未|莫|勿|别|not\b|no\b|never\b|n't/gi;
var PASSIVE_ZH = /被|由[^，。；]{0,8}所|为[^，。；]{0,6}所/g;
var PASSIVE_EN = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi;
function summarize(text) {
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
function bracketDepth(s) {
  const pairs = [
    ["\uFF08", "\uFF09"],
    ["(", ")"],
    ["\u3010", "\u3011"],
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
function routeExplainMode(text) {
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
function parseSteMarkers(answer) {
  const out = {};
  const re = /<!--ste:([a-zA-Z]+)=([^>-]*)-->/g;
  let m;
  while (m = re.exec(String(answer ?? ""))) {
    const key = m[1];
    const raw = m[2].trim();
    if (key === "matLang") out.matLang = raw || void 0;
    else if (key === "points") out.points = Number.isFinite(Number(raw)) ? Number(raw) : void 0;
    else if (key === "readings") out.readings = Number.isFinite(Number(raw)) ? Number(raw) : void 0;
  }
  return out;
}
function stripSteMarkers(answer) {
  return String(answer ?? "").replace(/<!--ste:[a-zA-Z]+=[^>-]*-->/g, "");
}
var EXPLAIN_SAME_TEXT_RATIO = 0.6;
var EXPLAIN_SAME_TEXT_MIN_CHARS = 12;
function normalizeForOverlap(s) {
  return stripSteMarkers(s).toLowerCase().replace(/[\s`*_~>#|\-–—'"「」『』【】（）(){}[\]、，。；：！？.,;:!?"'`]/g, "");
}
function isLikelySameText(source, answer) {
  const a = normalizeForOverlap(source);
  const b = normalizeForOverlap(answer);
  if (a.length < EXPLAIN_SAME_TEXT_MIN_CHARS || b.length < a.length / 2) return false;
  const srcBigrams = /* @__PURE__ */ new Set();
  for (let i = 0; i < a.length - 1; i++) srcBigrams.add(a.slice(i, i + 2));
  if (srcBigrams.size === 0) return false;
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    if (srcBigrams.has(g)) hit += 1;
  }
  const total = a.length - 1;
  return hit / total >= EXPLAIN_SAME_TEXT_RATIO;
}

// electron/ste-profiles/zh-Hans.json
var zh_Hans_default = {
  lang: "zh-Hans",
  name: "\u7B80\u660E\u4E2D\u6587\u5256\u9762 v1",
  derivedFrom: ["ISO 24495-1:2023", "ASD-STE100 Issue 9\uFF08\u4EC5\u7ED3\u6784\u53C2\u7167\uFF0C\u89C4\u5219\u6587\u5B57\u5168\u90E8\u81EA\u5199\u84B8\u998F\uFF09"],
  licenseNote: "original-wording: \u672C\u6587\u4EF6\u5168\u90E8\u89C4\u5219\u6587\u5B57\u4E3A\u81EA\u5199\uFF0C\u4E0D\u542B\u4EFB\u4F55\u53D7\u7248\u6743\u4FDD\u62A4\u7684\u89C4\u8303\u539F\u6587\u4E0E\u8BCD\u5178\u8BCD\u8868",
  sentence: {
    maxChars: 40,
    maxClauses: 2,
    note: "\u4E00\u53E5\u4E00\u4E49\uFF1B\u8D85\u8FC7\u7EA6 40 \u5B57\u6216\u542B\u4E24\u4E2A\u4EE5\u4E0A\u5206\u53E5\u7684\u957F\u53E5\u5FC5\u987B\u62C6\u5206\uFF1B\u4ECE\u53E5\u5D4C\u5957\u81F3\u591A\u4E00\u5C42\uFF1B\u4E00\u6BB5\u53EA\u8BF4\u4E00\u4E2A\u4E3B\u9898\uFF0C\u5148\u7ED3\u8BBA\u540E\u5C55\u5F00"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148\uFF1B\u65BD\u52A8\u8005\u4E0D\u660E\u65F6\u663E\u5F0F\u5199\u300C\u6765\u6E90\u672A\u8BF4\u660E\u300D\uFF0C\u4E0D\u5F97\u7528\u88AB\u52A8\u53E5\u63A9\u853D\u65BD\u52A8\u8005"
  },
  lexicon: [
    "\u4E00\u8BCD\u4E00\u4E49\uFF1A\u540C\u4E00\u6982\u5FF5\u4ECE\u5934\u5230\u5C3E\u53EA\u7528\u540C\u4E00\u4E2A\u8BCD\uFF0C\u4E0D\u6362\u8FD1\u4E49\u8BCD",
    "\u907F\u514D\u6587\u767D\u5939\u6742\uFF08\u5982\u300C\u4E4B\u300D\u300C\u5176\u300D\u300C\u8005\u300D\u6DF7\u5728\u767D\u8BDD\u91CC\uFF09\u4E0E\u591A\u4E49\u6210\u8BED",
    "\u672F\u8BED\u9996\u6B21\u51FA\u73B0\u5C31\u7528\u4E00\u53E5\u767D\u8BDD\u5C31\u5730\u5B9A\u4E49\uFF0C\u4E4B\u540E\u518D\u76F4\u63A5\u4F7F\u7528\u8BE5\u672F\u8BED",
    "\u907F\u514D\u884C\u8BDD\u3001\u7F51\u7EDC\u8BED\u4E0E\u5916\u6587\u7F29\u5199\uFF1B\u786E\u9700\u7F29\u5199\u65F6\u9996\u6B21\u51FA\u73B0\u7ED9\u51FA\u5168\u79F0",
    "\u6570\u91CF\u4E0E\u6761\u4EF6\u5199\u660E\u786E\uFF1A\u6570\u5B57\u5E26\u5355\u4F4D\uFF0C\u91CF\u7EA7\u4E0D\u5199\u300C\u82E5\u5E72\u300D\u300C\u4E00\u4E9B\u300D\u8FD9\u7C7B\u542B\u7CCA\u8BCD"
  ],
  avoid: [
    { bad: "\u88AB\u2026\u2026\u6240\u2026\u2026\uFF08\u65BD\u52A8\u8005\u7F3A\u5931\u7684\u88AB\u52A8\u957F\u53E5\uFF09", why: "\u65BD\u52A8\u8005\u88AB\u9690\u85CF\uFF0C\u8BFB\u8005\u65E0\u6CD5\u5224\u65AD\u662F\u8C01\u505A\u7684" },
    { bad: "\u591A\u5C42\u300C\u7684\u300D\u5B57\u957F\u5B9A\u8BED\uFF08\u5982\u300C\u7531\u90E8\u95E8\u5236\u5B9A\u7684\u5173\u4E8E\u89C4\u8303\u6240\u5C5E\u673A\u6784\u884C\u4E3A\u7684\u529E\u6CD5\u300D\uFF09", why: "\u5B9A\u8BED\u5C42\u5C42\u53E0\u52A0\uFF0C\u4E2D\u5FC3\u8BED\u88AB\u63A8\u8FDC\uFF0C\u8BFB\u4E09\u904D\u624D\u6562\u65AD\u53E5" },
    { bad: "\u5BF9\u300C\u5176\u300D\u300C\u8BE5\u300D\u300C\u6B64\u300D\u7684\u8FDC\u8DDD\u79BB\u6307\u4EE3", why: "\u6307\u4EE3\u5BF9\u8C61\u9694\u53E5\u4E4B\u540E\uFF0C\u8BFB\u8005\u9700\u8981\u56DE\u6EAF\u731C\u6D4B" },
    { bad: "\u6587\u767D\u6DF7\u6742\u7684\u4E66\u9762\u8154\uFF08\u300C\u4E1A\u5DF2\u300D\u300C\u5982\u4E0A\u6240\u8FF0\u300D\u300C\u5179\u300D\uFF09", why: "\u8BED\u57DF\u6DF7\u6742\uFF0C\u666E\u901A\u8BFB\u8005\u4E0D\u719F\u6089\u65E7\u5F0F\u4E66\u9762\u8BCD" }
  ],
  rewriteExample: [
    {
      before: "\u672C\u65B9\u6CD5\u4E4B\u6240\u4EE5\u80FD\u591F\u88AB\u5E7F\u6CDB\u91C7\u7528\uFF0C\u4E43\u56E0\u5176\u7531\u4E1A\u754C\u6240\u516C\u8BA4\u4E4B\u6280\u672F\u8DEF\u7EBF\u6240\u652F\u6301\u3002",
      after: "\u4E1A\u754C\u516C\u8BA4\u8FD9\u6761\u6280\u672F\u8DEF\u7EBF\uFF0C\u6240\u4EE5\u672C\u65B9\u6CD5\u88AB\u5E7F\u6CDB\u91C7\u7528\u3002\uFF08\u6765\u6E90\u672A\u8BF4\u660E\u662F\u8C01\u516C\u8BA4\uFF09"
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// electron/ste-profiles/en.json
var en_default = {
  lang: "en",
  name: "Plain English Profile v1 (controlled-language distillation)",
  derivedFrom: ["ISO 24495-1:2023", "ASD-STE100 Issue 9 (structure reference only; all rule wording originally written)"],
  licenseNote: "original-wording: every rule sentence in this file is originally written; no copyrighted specification text or its word lists is reproduced",
  sentence: {
    maxWords: 20,
    maxSentencesPerParagraph: 6,
    note: "One instruction per sentence; one topic per paragraph (with a conclusion first); split sentences longer than about 20 words; keep relative clauses to at most one per sentence"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "Prefer the active voice and name the doer; when the doer is unknown, say so explicitly (for example 'the source does not state who approved this'); use the passive only when the doer is unknown or unimportant"
  },
  lexicon: [
    "One term, one meaning: use the same word for the same concept throughout the text",
    "Prefer everyday words; explain a technical term in plain words where it first appears",
    "Keep noun phrases short (about three words at most); do not stack nouns",
    "Use verbs in simple finite forms; do not reuse one word with several grammatical functions",
    "Make quantities and conditions explicit: give units with numbers and write ranges precisely"
  ],
  avoid: [
    { bad: "Long noun chains such as 'system configuration item version verification procedure'", why: "Stacked nouns hide who does what to what" },
    { bad: "Sentences where several things happen with only 'and' or 'which' to hold them together", why: "Readers lose track of the main statement" },
    { bad: "Vague quantifiers such as 'several', 'some', 'appropriate'", why: "The reader cannot act on an unspecified amount or condition" },
    { bad: "Idioms and figurative verbs (for example 'the market tanked')", why: "Figurative language does not survive translation and puzzles non-native readers" }
  ],
  rewriteExample: [
    {
      before: "The implementation of the utilization of this procedure is performed by the operator.",
      after: "The operator uses this procedure."
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// electron/ste-profiles/universal.json
var universal_default = {
  lang: "universal",
  name: "Universal plain-language profile v1 (four principles)",
  derivedFrom: ["ISO 24495-1:2023"],
  licenseNote: "original-wording: \u672C\u6587\u4EF6\u5168\u90E8\u89C4\u5219\u6587\u5B57\u4E3A\u81EA\u5199\uFF0C\u4E0D\u542B\u4EFB\u4F55\u53D7\u7248\u6743\u4FDD\u62A4\u7684\u89C4\u8303\u539F\u6587\u4E0E\u8BCD\u8868",
  sentence: {
    note: "\u6309\u8BE5\u8BED\u8A00\u81EA\u5DF1\u7684\u4E60\u60EF\u5199\u77ED\u53E5\u3001\u76F4\u9648\u53E5\uFF1A\u4E00\u53E5\u53EA\u8BF4\u4E00\u4EF6\u4E8B\uFF0C\u5148\u7ED3\u8BBA\u540E\u5C55\u5F00\uFF0C\u4E00\u6BB5\u4E00\u4E2A\u4E3B\u9898\uFF08ISO \u56DB\u539F\u5219\u4E0D\u8BBE\u91CF\u5316\u53E5\u957F\uFF0C\u7531\u5404\u8BED\u8A00 pack \u7ED9\u51FA\u8FD1\u4F3C\u4E0A\u9650\uFF09"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148\uFF0C\u5199\u660E\u300C\u8C01\u505A\u4E86\u4EC0\u4E48\u300D\uFF1B\u65BD\u52A8\u8005\u4E0D\u660E\u65F6\u660E\u8BF4\u300C\u6765\u6E90\u672A\u8BF4\u660E\u300D\uFF0C\u4E0D\u9760\u8BED\u6001\u63A9\u853D"
  },
  lexicon: [
    "\u8BFB\u8005\u80FD\u627E\u5230\uFF1A\u91CD\u8981\u5185\u5BB9\u653E\u524D\u9762\uFF0C\u6807\u9898\u4E0E\u8282\u5E8F\u7A33\u5B9A\uFF0C\u4E0D\u57CB\u5173\u952E\u4FE1\u606F",
    "\u8BFB\u8005\u80FD\u7406\u89E3\uFF1A\u7528\u8BE5\u8BED\u8A00\u7684\u5E38\u7528\u8BCD\uFF1B\u672F\u8BED\u9996\u73B0\u5C31\u5730\u7ED9\u4E00\u53E5\u5E73\u5B9E\u5B9A\u4E49\uFF1B\u4E00\u8BCD\u4E00\u4E49",
    "\u8BFB\u8005\u80FD\u4F7F\u7528\uFF1A\u6570\u91CF\u3001\u5355\u4F4D\u3001\u6761\u4EF6\u3001\u524D\u63D0\u5199\u660E\u786E\uFF0C\u4E0D\u5199\u542B\u7CCA\u91CF\u8BCD\uFF1B\u9690\u542B\u524D\u63D0\u663E\u5F0F\u5316",
    "\u76F8\u5173\uFF1A\u53EA\u5199\u4E0E\u8BFB\u8005\u4EFB\u52A1\u6709\u5173\u7684\u5185\u5BB9\uFF0C\u5220\u6389\u88C5\u9970\u6027\u94FA\u57AB"
  ],
  avoid: [
    { bad: "\u6307\u4EE3\u8DDD\u79BB\u8FC7\u8FDC\u7684\u4EE3\u8BCD\u4E0E\u7701\u7565\u4E3B\u8BED\u7684\u8FDE\u7EED\u5206\u53E5", why: "\u8BFB\u8005\u9700\u8981\u56DE\u6EAF\u4E0E\u731C\u6D4B\uFF0C\u8FDD\u53CD\u300C\u80FD\u7406\u89E3\u300D\u539F\u5219" },
    { bad: "\u6CA1\u6709\u5355\u4F4D\u6216\u754C\u9650\u7684\u6570\u91CF\u8BCD\uFF08\u82E5\u5E72\u3001\u4E00\u4E9B\u3001\u9002\u5F53\uFF09", why: "\u8BFB\u8005\u65E0\u6CD5\u636E\u6B64\u884C\u52A8\uFF0C\u8FDD\u53CD\u300C\u80FD\u4F7F\u7528\u300D\u539F\u5219" }
  ],
  rewriteExample: [
    {
      before: "\u7CFB\u7EDF\u5728\u7279\u5B9A\u6761\u4EF6\u4E0B\u53EF\u80FD\u4F1A\u51FA\u73B0\u4E00\u5B9A\u7A0B\u5EA6\u7684\u6027\u80FD\u6CE2\u52A8\u3002",
      after: "\u5F53\u5E76\u53D1\u7528\u6237\u8D85\u8FC7 200 \u65F6\uFF0C\u7CFB\u7EDF\u54CD\u5E94\u4F1A\u53D8\u6162\u7EA6 2 \u79D2\u3002\uFF08\u6765\u6E90\u672A\u8BF4\u660E\u8BE5\u9608\u503C\u7684\u6D4B\u5B9A\u6761\u4EF6\uFF09"
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// src/lib/steProfiles.ts
var STE_PROFILES = {
  "zh-Hans": zh_Hans_default,
  en: en_default,
  universal: universal_default
};
var STE_OUTPUT_LANG = "zh-Hans";
function resolveProfile(lang) {
  const raw = String(lang ?? "").trim();
  if (raw) {
    const lower = raw.toLowerCase();
    const base = lower.split(/[-_]/)[0];
    for (const key of Object.keys(STE_PROFILES)) {
      if (key.toLowerCase() === lower) return STE_PROFILES[key];
    }
    if (base === "zh") return STE_PROFILES["zh-Hans"];
    if (STE_PROFILES[base]) return STE_PROFILES[base];
    return STE_PROFILES.en;
  }
  return STE_PROFILES.universal;
}
function formatProfile(p) {
  const lines = [`\u3010${p.name}\uFF08${p.lang}\uFF09\u3011`];
  const s = p.sentence ?? {};
  const sentenceBits = [
    s.maxChars ? `\u4E00\u53E5 \u2264 ${s.maxChars} \u5B57` : "",
    s.maxWords ? `\u4E00\u53E5 \u2264 ${s.maxWords} words` : "",
    s.maxClauses ? `\u5206\u53E5 \u2264 ${s.maxClauses}` : "",
    s.maxSentencesPerParagraph ? `\u4E00\u6BB5 \u2264 ${s.maxSentencesPerParagraph} \u53E5` : "",
    s.note ?? ""
  ].filter(Boolean);
  if (sentenceBits.length) lines.push(`- \u53E5\u5B50\uFF1A${sentenceBits.join("\uFF1B")}`);
  if (p.voice?.preferActive !== void 0) {
    lines.push(`- \u8BED\u6001\uFF1A${p.voice.preferActive ? "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148" : "\u4E0D\u5F3A\u5236\u4E3B\u52A8\u8BED\u6001"}${p.voice.agentUnknownNote ? `\uFF1B${p.voice.agentUnknownNote}` : ""}`);
  }
  for (const rule of p.lexicon ?? []) lines.push(`- \u8BCD\u6C47\uFF1A${rule}`);
  for (const a of p.avoid ?? []) lines.push(`- \u907F\u514D\uFF1A${a.bad}\u2014\u2014${a.why}`);
  for (const ex of p.rewriteExample ?? []) lines.push(`- \u6539\u5199\u793A\u4F8B\uFF1A\u539F\u300C${ex.before}\u300D\u2192 \u6539\u300C${ex.after}\u300D`);
  return lines.join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPLAIN_ROUTER_MIN_CHARS,
  EXPLAIN_ROUTER_THRESHOLD,
  EXPLAIN_ROUTER_WEIGHTS,
  EXPLAIN_SAME_TEXT_MIN_CHARS,
  EXPLAIN_SAME_TEXT_RATIO,
  STE_CATEGORIES,
  STE_OUTPUT_LANG,
  STE_PROFILES,
  formatProfile,
  isLikelySameText,
  parseSteMarkers,
  resolveProfile,
  routeExplainMode,
  stripSteMarkers
});
