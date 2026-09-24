// 提示词测试台基线（M1.3）。
//
// 历史：原「v4 候选补丁」（G1–G9 + card-literature 文学模板）已于 v31（2026-09-13）经用户确认并回主软件
// （主软件播种 card-generation 族 v6 + card-literature 专用模板 v6；见 electron/prompts.js 头注）。
// 同批用户拍板取消 G9「退出红线」、完善 G5/G6/G7 并与新增的本地 CardLint L15/L16 对齐。
//
// 现状：本文件不再承载候选文本，**直接引用主软件当前基线**——DRAFT_SCOPES 与 main.js 的 BASELINE_SCOPES
// 一致，测试台里看到的就是主软件现行提示词。
//
// 后续调优：按调优闭环「AI 改测试台」把改动写成本文件的**显式字面覆盖**（把对应 scope 的 content 换成
// 具体文本），并同步 bump DRAFT_TAG；用户下次打开测试台时会自动载入新候选（main.js 按 draftTag 判断）。
const P = require("../electron/prompts");

// v31 起：基线直引。card-occlusion / reader-explain / leech-rescue 不在此表（测试台沿用主软件版本）。
// v46（M14-UM2）：基线升 v7——prompts.js 导出的制卡族常量已组装 R20 记忆接地段，直引即 v7 内容。
const DRAFT_TAG = "v46-baseline-20260917";

const DRAFT_SCOPES = {
  "card-generation": { name: "主制卡", content: P.CARD_GEN_PROMPT },
  "card-formula": { name: "公式分解", content: P.CARD_FORMULA_PROMPT },
  "card-seq": { name: "序列/背诵", content: P.CARD_SEQ_PROMPT },
  "card-enum": { name: "枚举拆解", content: P.CARD_ENUM_PROMPT },
  "card-literature": { name: "文学/诗歌背诵", content: P.CARD_LITERATURE_PROMPT },
  "card-mnemonic": { name: "助记双卡", content: P.CARD_MNEMONIC_PROMPT },
  "card-contrast": { name: "对比卡", content: P.CARD_CONTRAST_PROMPT },
  "card-wording": { name: "措辞优化", content: P.CARD_WORDING_PROMPT },
  "card-basic": { name: "前置知识卡", content: P.CARD_BASIC_PROMPT },
  // v32（M7）：单词制卡 scope（基线直引，主软件 card-vocab v1）
  "card-vocab": { name: "单词制卡", content: P.CARD_VOCAB_PROMPT },
  // v40（M8-B，D37）：日记洞察 scope（基线直引，主软件 journal-insight v1；
  // 结构分支独立模板 structure-analogy 随 K2-B 播种后再入此表）
  "journal-insight": { name: "日记洞察", content: P.JOURNAL_INSIGHT_PROMPT },
  // v41（K2-A，D38）：知识抽取归一与关系抽取（基线直引，主软件 v1）
  "knowledge-extraction": { name: "知识点抽取归一", content: P.KNOWLEDGE_EXTRACTION_PROMPT },
  "knowledge-relation": { name: "知识关系抽取", content: P.KNOWLEDGE_RELATION_PROMPT },
  // v43（K2-B）：LKM 余下 4 scope（基线直引，主软件 v1；消费引擎分属 K3/K4-K5/K9，
  // 测试台先承担调优与「×N 次离散度」守门——AI 返回结果经 kpScopes.js 契约校验显示）
  "material-difficulty": { name: "材料难度画像", content: P.MATERIAL_DIFFICULTY_PROMPT },
  "knowledge-probe": { name: "维度探针", content: P.KNOWLEDGE_PROBE_PROMPT },
  "frontier-explain": { name: "推荐解释", content: P.FRONTIER_EXPLAIN_PROMPT },
  "structure-analogy": { name: "结构类比", content: P.STRUCTURE_ANALOGY_PROMPT },
  // v48.22（M16 / D58，E1）：摘录重排 v1（基线直引，主软件 v1）
  "extract-rerank": { name: "摘录重排", content: P.EXTRACT_RERANK_PROMPT },
  // v45（M14-UM1，D39）：用户记忆整理（摄入轮 + 周期整理轮共用一套契约；基线直引，主软件 v1）
  "user-memory": { name: "用户记忆整理", content: P.USER_MEMORY_PROMPT }
};

module.exports = { DRAFT_TAG, DRAFT_SCOPES };
