// 提示词测试台基线（M1.3）。
//
// 历史：原「v4 候选补丁」（G1–G9 + card-literature 文学模板）已于 v31（2026-09-13）经用户确认并回主软件
// （主软件播种 card-generation 族 v6 + card-literature 专用模板 v6；见 electron/prompts.js 头注）。
// 同批用户拍板取消 G9「退出红线」、完善 G5/G6/G7 并与新增的本地 CardLint L15/L16 对齐。
//
// v46-v48.62：基线直引阶段（无候选）。v48.60-D101 落地标签系统（cards.tags_json 第四组织轴）后，
// 批 F（AI 建议标签，D94 设计稿 §0-⑥/§7；用户 2026-10-06 指令「我现在就想做」）启动：下方恢复
// 「显式覆盖候选」模式——在主提示词上打两处字面锚点补丁（输出 schema 增 suggestedTags 字段 +
// 建议标签契约段），待用户在测试台实测确认后，主软件侧播种 v8（ensurePromptTemplates 制卡族
// TARGET_VERSION 升 8）并实现确认面板勾选 UI（勾选写入、默认不勾选断言，D94 §7 批 F）。
//
// 后续调优：按调优闭环「AI 改测试台」把改动写成本文件的显式覆盖，并同步 bump DRAFT_TAG。
const P = require("../electron/prompts");

// ---------- v8 候选（2026-10-06，批 F：AI 建议标签 suggestedTags） ----------
// 两处补丁＝显式字面锚点替换；制卡族 10 个 card-* scope 全部内嵌主提示词正文，
// 对每个 family scope 独立 applyCandidate 即全族一致（card-occlusion 独立模板不在测试台候选范围）。
// 非 card 族 scope（journal-insight / knowledge-* / extract-rerank / user-memory）保持基线直引不动。

// 锚点①：输出 schema 的 cards[] 对象——prioritySuggestion 行后插入 suggestedTags 字段
const ANCHOR_SCHEMA = `    "prioritySuggestion": 0,`;
const PATCH_SCHEMA = `    "prioritySuggestion": 0,
    "suggestedTags": ["组织用标签（0-3 个；没有合适的就输出空数组）"],`;

// 锚点②：输出格式段标题前插入建议标签契约段
const ANCHOR_STEP4 = `【第四步：输出格式】`;
const PATCH_STEP4 = `【建议标签（suggestedTags，v8 候选新增段）】
- 标签是「用户自造的组织与筛选词」（例：考研、错题、口试、待重读）——用户拿它把自己的卡归拢成
  清单、标记阶段或用途。它不是学科分类、也不是知识点：学科归 domain 字段、概念归 knowledgePoints，
  禁止用标签重复这两者的职能。
- 判据：只有当你能想象「用户会在什么场景下用这个词来筛卡」时才建议；想象不出就输出空数组——
  空数组是合法且常见的输出，宁缺毋滥。
- 硬约束：每卡 0-3 个；单个 ≤12 字；可用「::」表达层级（例：考研::英语），最多 2 层；段内禁止半角冒号。
- 禁止空泛与复述：「概念」「重要」「名词解释」「知识点」这类空泛词，以及与 front/back 或材料标题
  同义的词，一律不给。

【第四步：输出格式】`;

function applyCandidate(base) {
  if (typeof base !== "string" || !base.includes(ANCHOR_SCHEMA) || !base.includes(ANCHOR_STEP4)) {
    return base; // 锚点失配（主软件提示词结构变化）→ 原样返回，测试台「与主软件一致」状态即如实可见
  }
  return base.replace(ANCHOR_SCHEMA, PATCH_SCHEMA).replace(ANCHOR_STEP4, PATCH_STEP4);
}

const DRAFT_TAG = "v8-candidate-suggestedTags-20261006";

const DRAFT_SCOPES = {
  // ---- v8 候选族：card-* scope 全部打补丁（内嵌主提示词，两处锚点各命中一次） ----
  "card-generation": { name: "主制卡", content: applyCandidate(P.CARD_GEN_PROMPT) },
  "card-formula": { name: "公式分解", content: applyCandidate(P.CARD_FORMULA_PROMPT) },
  "card-seq": { name: "序列/背诵", content: applyCandidate(P.CARD_SEQ_PROMPT) },
  "card-enum": { name: "枚举拆解", content: applyCandidate(P.CARD_ENUM_PROMPT) },
  "card-literature": { name: "文学/诗歌背诵", content: applyCandidate(P.CARD_LITERATURE_PROMPT) },
  "card-mnemonic": { name: "助记双卡", content: applyCandidate(P.CARD_MNEMONIC_PROMPT) },
  "card-contrast": { name: "对比卡", content: applyCandidate(P.CARD_CONTRAST_PROMPT) },
  "card-wording": { name: "措辞优化", content: applyCandidate(P.CARD_WORDING_PROMPT) },
  "card-basic": { name: "前置知识卡", content: applyCandidate(P.CARD_BASIC_PROMPT) },
  "card-vocab": { name: "单词制卡", content: applyCandidate(P.CARD_VOCAB_PROMPT) },
  // ---- 基线直引（非制卡族，批 F 不涉及） ----
  // v40（M8-B，D37）：日记洞察 scope（基线直引，主软件 journal-insight v1）
  "journal-insight": { name: "日记洞察", content: P.JOURNAL_INSIGHT_PROMPT },
  // v41（K2-A，D38）+ v43（K2-B）：知识抽取/关系/LKM 三 scope（基线直引）
  "knowledge-extraction": { name: "知识点抽取归一", content: P.KNOWLEDGE_EXTRACTION_PROMPT },
  "knowledge-relation": { name: "知识关系抽取", content: P.KNOWLEDGE_RELATION_PROMPT },
  "material-difficulty": { name: "材料难度画像", content: P.MATERIAL_DIFFICULTY_PROMPT },
  "knowledge-probe": { name: "维度探针", content: P.KNOWLEDGE_PROBE_PROMPT },
  "frontier-explain": { name: "推荐解释", content: P.FRONTIER_EXPLAIN_PROMPT },
  "structure-analogy": { name: "结构类比", content: P.STRUCTURE_ANALOGY_PROMPT },
  // v48.22（M16 / D58，E1）：摘录重排 v1（基线直引）
  "extract-rerank": { name: "摘录重排", content: P.EXTRACT_RERANK_PROMPT },
  // v45（M14-UM1，D39）：用户记忆整理（基线直引）
  "user-memory": { name: "用户记忆整理", content: P.USER_MEMORY_PROMPT }
};

module.exports = { DRAFT_TAG, DRAFT_SCOPES };
