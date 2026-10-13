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

// ---------- v48.103 候选 v2（2026-10-13，D148 后续：简明解读 = ASD-STE100 直答 + 模板级全局输出语言） ----------
// 用户第二轮指令（逐字）：简明改写部分的提示词改为「用 ASD-STE100 解释选中文本」；同时所有的提示词
// 都增加一个对 AI 整体输出语言 {{OUTPUT_LANG_NAME}} 的规定——例如界面语言为日语时，{{OUTPUT_LANG_NAME}}
// 就是日语，全部内容（包括其中的 ASD-STE100 结果）也以日语形式输出。
// v1 → v2 演进：v1 把「逐句翻译为X」写在改写步骤里；v2 改写步骤只保留 ASD-STE100 直答，语言约束
// 升级为模板级【输出语言（整体硬约束）】块（覆盖全部输出），多语言适配由同一槽位机制承担。
// 口径变化（相对 D91 §②）：候选模板正文出现 ASD-STE100 标准名称（仍不含规范规则原文与批准词典词表）；
// 并回主软件前须同步修订 d91-prompts 的「模板正文不含 ASD-STE100」断言与 GUIDE D91 ② 的红线表述。
// 其余结构（歧义点/多重解读/术语/机器标记/节标题契约/双 pack 槽位）保持主软件 v3 逐字不动；
// 另随改写指令改判做三处一致性修订：【简明改写硬规则】块整体退役、追问/收尾条款去悬挂引用、
// 输出剖面槽位头去掉「改写」字样（改写不再按输出剖面执行，仅说明文字沿用）。

// 锚点①：模板开头——首行之后插入【输出语言（整体硬约束）】块（v2 新增：全部输出含 ASD-STE100
// 结果一律使用 {{OUTPUT_LANG_NAME}}，由渲染层按界面语言注入人读名）
const STE_ANCHOR_HEAD = `你是阅读助手，负责「简明解读」：按受控语言剖面（CLP）检测并改写用户选中的材料片段。

【任务定义（恒定完整执行）】`;
const STE_PATCH_HEAD = `你是阅读助手，负责「简明解读」：按受控语言剖面（CLP）检测并改写用户选中的材料片段。

【输出语言（整体硬约束，覆盖你的全部输出）】
你的全部输出——包括按 ASD-STE100 得出的解释与简明改写结果、节标题、歧义点与术语的说明文字、多重解读、对追问的回答——一律使用「{{OUTPUT_LANG_NAME}}」书写。ASD-STE100 的规则原生面向英语，但其应用结果不得以英语呈现：必须整体以「{{OUTPUT_LANG_NAME}}」的形式表达，禁止夹带英文原句或中英对照。用户消息【解读语言】块标注的语言即「{{OUTPUT_LANG_NAME}}」；两者表述不一致时，以本块为准。

【任务定义（恒定完整执行）】`;

// 锚点②③：任务定义第 2 步整行替换 + 【简明改写硬规则】块整体删除
const STE_ANCHOR_STEP2 = `2. 简明改写（恒定执行）：这是受控语言改写，不是口语化复述，也不是缩写概括。逐句改写，输出语言与材料语言不同时，改写同时是翻译；改写与原文保持句级对应——原文的每个信息点都必须保留，禁止遗漏、添加或合并事实。改写后的每一句都必须满足下方【简明改写硬规则】与输出语言剖面。`;
const STE_PATCH_STEP2 = `2. 简明改写（恒定执行）：用 ASD-STE100 解释选中文本。`;

const STE_ANCHOR_RULES = `
【简明改写硬规则（每条都是硬约束，违反任何一条即不合格）】
- 句子上限：输出语言剖面的句子规则（长度、分句数）对改写后的每一句分别生效；任何一句超限必须拆成多句，禁止为保留原文的句读节奏而输出超长句。
- 一句一义：每句只说一个意思，先结论后展开；从句嵌套至多一层；一段只讲一个主题。
- 语态与施动者：按输出语言剖面执行——主动语态优先；施动者不明时显式写明（如「来源未说明」），禁止用被动句掩蔽施动者。
- 词汇纪律：按输出语言剖面执行——同一概念只用同一个词；术语首次出现就地用一句白话定义；避免行话、文白夹杂与含糊量词；数字带单位。
- 逐句自查：输出前把改写稿逐句过一遍——长度、分句、语态、词汇、信息完整五项全部合格才允许输出；任何一项不合格，拆句重写后再输出。
`;

// 锚点④：追问直答条款去掉对已退役硬规则块的悬挂引用
const STE_ANCHOR_FOLLOWUP = `直接按追问角度作答（简短聚焦，两到五句；仍用解读语言并遵守输出语言剖面与【简明改写硬规则】）；`;
const STE_PATCH_FOLLOWUP = `直接按追问角度作答（简短聚焦，两到五句；仍用解读语言并遵守输出语言剖面）；`;

// 锚点⑤：收尾追问条款同上
const STE_ANCHOR_TAIL = `用户可能在解读后追问；追问时按追问角度作答，仍遵守输出语言、改写剖面与【简明改写硬规则】。`;
const STE_PATCH_TAIL = `用户可能在解读后追问；追问时按追问角度作答，仍遵守输出语言与输出语言剖面。`;

// 锚点⑥：输出剖面槽位头——改写不再按输出剖面执行（ASD-STE100 直答），槽位只覆盖说明文字
const STE_ANCHOR_OUTSLOT = `【输出语言改写剖面（改写与全部说明文字按此语言的规则执行）】`;
const STE_PATCH_OUTSLOT = `【输出语言剖面（全部说明文字按此语言的规则执行）】`;

function applySteCandidate(base) {
  if (
    typeof base !== "string" ||
    !base.includes(STE_ANCHOR_HEAD) ||
    !base.includes(STE_ANCHOR_STEP2) ||
    !base.includes(STE_ANCHOR_RULES) ||
    !base.includes(STE_ANCHOR_FOLLOWUP) ||
    !base.includes(STE_ANCHOR_TAIL) ||
    !base.includes(STE_ANCHOR_OUTSLOT)
  ) {
    return base; // 锚点失配（主软件提示词结构变化）→ 原样返回，测试台「与主软件一致」状态即如实可见
  }
  return base
    .replace(STE_ANCHOR_HEAD, STE_PATCH_HEAD)
    .replace(STE_ANCHOR_STEP2, STE_PATCH_STEP2)
    .replace(STE_ANCHOR_RULES, "")
    .replace(STE_ANCHOR_FOLLOWUP, STE_PATCH_FOLLOWUP)
    .replace(STE_ANCHOR_TAIL, STE_PATCH_TAIL)
    .replace(STE_ANCHOR_OUTSLOT, STE_PATCH_OUTSLOT);
}

function applyCandidate(base) {
  if (typeof base !== "string" || !base.includes(ANCHOR_SCHEMA) || !base.includes(ANCHOR_STEP4)) {
    return base; // 锚点失配（主软件提示词结构变化）→ 原样返回，测试台「与主软件一致」状态即如实可见
  }
  return base.replace(ANCHOR_SCHEMA, PATCH_SCHEMA).replace(ANCHOR_STEP4, PATCH_STEP4);
}

// v48.103（2026-10-13）：DRAFT_TAG 随简明解读候选一并 bump——制卡族候选内容不变（未手改的 scope
// 仅重写 draftTag），reader-explain-ste 候选 v2（ASD-STE100 直答 + 全局输出语言块）随新 tag 播进测试台本地表。
const DRAFT_TAG = "v8-candidate+ste-asd2-globalLang-20261013";

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
  // v48.103（D148 后续）候选 v2：简明解读 = ASD-STE100 直答 + 模板级全局输出语言 {{OUTPUT_LANG_NAME}}
  "reader-explain-ste": { name: "简明解读", content: applySteCandidate(P.READER_EXPLAIN_STE_PROMPT) },
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
