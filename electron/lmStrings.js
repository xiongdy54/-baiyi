// D124 学习者模型 LM-1（设计稿 §11.9）：主进程侧用户可见文字表（纯常量）。
// 结构 { zh, en }，两种语言的键必须完全相同（tests/lm-recommend.test.cjs 断言）。
// 代码中不得出现硬编码的用户可见文字——推荐标题/理由/种类名/等级名/覆盖带名/mode 名只从这里取。
"use strict";

const zh = {
  kindNames: {
    "continue": "继续读",
    "start": "开始读",
    "extract-batch": "处理摘录",
    "extract-to-card": "摘录制卡",
    "reinforce": "巩固",
    "cross-material": "换个讲法",
    "self-explain": "自我解释",
    "practice": "练习",
    "find-material": "缺少材料",
    "reread": "重读",
    "context-reel": "语境串",
    "sentence-mine": "挖句子",
    "placement": "词汇快测"
  },
  modeNames: {
    language: "语言习得",
    concept: "理解建构",
    procedural: "技能练习",
    factual: "事实记忆",
    narrative: "阅读体验"
  },
  levelNames: ["未接触", "接触过", "学习中", "巩固中", "牢固"],
  fadingSuffix: "· 在遗忘",
  bandNames: { easy: "轻松", optimal: "最适合", intensive: "需要查词", hard: "太难" },
  relationNames: {
    prerequisite: "先修",
    part_of: "组成部分",
    related_to: "相关",
    contrasts_with: "对比",
    example_of: "例子",
    application_of: "应用",
    generalization_of: "概括",
    specialization_of: "特例"
  },
  kpNamesSep: "、",
  copyQuerySuffix: "入门",
  titles: {
    "continue": "继续读《{material}》：{unitTitle}",
    "start": "开始读《{material}》",
    "extract-batch": "处理 {count} 条到期摘录",
    "extract-to-card": "为摘录制卡：「{snippet}…」",
    "reinforce": "巩固「{kpName}」",
    "cross-material": "换个讲法：《{material}》{unitTitle}",
    "self-explain": "用自己的话讲「{kpName}」",
    "practice-unit": "练习：《{material}》{unitTitle}",
    "practice-card": "为「{kpName}」做一张应用题卡",
    "find-material": "找一份讲「{prereqName}」的材料",
    "reread": "重读：《{material}》{unitTitle}",
    "context-reel": "语境串：{word}",
    "sentence-mine": "挑 {count} 个句子",
    "placement": "词汇快测（{trackLabel}）"
  },
  reasons: {
    continueConcept: "上次读到这里是 {daysAgo} 天前。下一节约 {minutes} 分钟，涉及你正在学的「{kpNames}」。",
    continueConceptPlain: "上次读到这里是 {daysAgo} 天前。下一节约 {minutes} 分钟。",
    continueLanguage: "下一节已知词覆盖约 {coveragePct}%（{bandLabel}），含 {learningCount} 个你正在学的词，约 {minutes} 分钟。",
    continueOther: "上次读到这里是 {daysAgo} 天前，下一节约 {minutes} 分钟。",
    startConcept: "第一节约 {minutes} 分钟。",
    startLanguage: "开头一节已知词覆盖约 {coveragePct}%（{bandLabel}）。",
    "extract-batch": "{count} 条摘录到期，最久的已逾期 {maxOverdueDays} 天。第一条：「{topSnippet}…」",
    "extract-to-card": "这条摘录你已经读过 {processCount} 遍，还没有制卡。",
    reinforceFading: "「{kpName}」曾经记得很牢，现在平均回忆率降到 {meanRPct}%，重读一下原文。",
    reinforceStuck: "「{kpName}」的卡最近反复忘记（平均回忆率 {meanRPct}%）。",
    "cross-material": "你正在学「{kpName}」，《{material}》的「{unitTitle}」也讲到了它，换个角度看一遍。",
    "self-explain": "「{kpName}」已经巩固中。试着不看材料讲清它与「{relatedName}」的关系。",
    "practice-unit": "这是一节练习，涉及你正在学的知识点。",
    "practice-card": "「{kpName}」还没有应用题卡，会做比会背更重要。",
    "find-material": "学「{kpName}」需要先懂「{prereqName}」，但书架上没有讲它的材料。",
    reread: "这一节你读过 {passCount} 遍，里面有 {learningCount} 个正在学的词，到了重读的时候。",
    "context-reel": "「{word}」在你的材料里出现在 {sentenceCount} 个句子中，连着读一遍。",
    "sentence-mine": "最近读过的内容里有 {count} 个只差一个生词的句子。",
    placement: "先花 {minutes} 分钟估一下词汇量，推荐会更准。"
  }
};

const en = {
  kindNames: {
    "continue": "Continue",
    "start": "Start",
    "extract-batch": "Process extracts",
    "extract-to-card": "Extract to card",
    "reinforce": "Reinforce",
    "cross-material": "Another take",
    "self-explain": "Self-explain",
    "practice": "Practice",
    "find-material": "Missing material",
    "reread": "Reread",
    "context-reel": "Context reel",
    "sentence-mine": "Sentence mine",
    "placement": "Vocabulary check"
  },
  modeNames: {
    language: "Language acquisition",
    concept: "Concept building",
    procedural: "Skill practice",
    factual: "Factual memory",
    narrative: "Reading experience"
  },
  levelNames: ["Untouched", "Exposed", "Learning", "Consolidating", "Solid"],
  fadingSuffix: "· fading",
  bandNames: { easy: "easy", optimal: "optimal", intensive: "intensive", hard: "too hard" },
  relationNames: {
    prerequisite: "prerequisite",
    part_of: "part of",
    related_to: "related to",
    contrasts_with: "contrasts with",
    example_of: "example of",
    application_of: "application of",
    generalization_of: "generalization of",
    specialization_of: "specialization of"
  },
  kpNamesSep: ", ",
  copyQuerySuffix: " intro",
  titles: {
    "continue": "Continue \"{material}\": {unitTitle}",
    "start": "Start reading \"{material}\"",
    "extract-batch": "Process {count} due extracts",
    "extract-to-card": "Make cards from extract: \"{snippet}…\"",
    "reinforce": "Reinforce \"{kpName}\"",
    "cross-material": "Another take: \"{material}\" {unitTitle}",
    "self-explain": "Explain \"{kpName}\" in your own words",
    "practice-unit": "Practice: \"{material}\" {unitTitle}",
    "practice-card": "Write an application card for \"{kpName}\"",
    "find-material": "Find material covering \"{prereqName}\"",
    "reread": "Reread: \"{material}\" {unitTitle}",
    "context-reel": "Context reel: {word}",
    "sentence-mine": "Pick {count} sentences",
    "placement": "Vocabulary check ({trackLabel})"
  },
  reasons: {
    continueConcept: "You were here {daysAgo} day(s) ago. The next section takes about {minutes} min and involves {kpNames} you are learning.",
    continueConceptPlain: "You were here {daysAgo} day(s) ago. The next section takes about {minutes} min.",
    continueLanguage: "The next section covers about {coveragePct}% known words ({bandLabel}), including {learningCount} words you are learning; about {minutes} min.",
    continueOther: "You were here {daysAgo} day(s) ago; the next section takes about {minutes} min.",
    startConcept: "The first section takes about {minutes} min.",
    startLanguage: "The opening section covers about {coveragePct}% known words ({bandLabel}).",
    "extract-batch": "{count} extracts are due; the oldest has been waiting {maxOverdueDays} day(s). First: \"{topSnippet}…\"",
    "extract-to-card": "You have read this extract {processCount} time(s) without making a card.",
    reinforceFading: "\"{kpName}\" used to be solid, but average recall has dropped to {meanRPct}%. Reread the source text.",
    reinforceStuck: "Cards for \"{kpName}\" keep slipping lately (average recall {meanRPct}%).",
    "cross-material": "You are learning \"{kpName}\"; \"{unitTitle}\" in \"{material}\" also covers it. See it from another angle.",
    "self-explain": "\"{kpName}\" is consolidating. Try to explain how it relates to \"{relatedName}\" without looking.",
    "practice-unit": "This is an exercise section involving knowledge points you are learning.",
    "practice-card": "\"{kpName}\" has no application card yet. Doing matters more than reciting.",
    "find-material": "Learning \"{kpName}\" requires \"{prereqName}\" first, but no material on your shelf covers it.",
    reread: "You have read this section {passCount} time(s); it contains {learningCount} words you are learning. Time for another pass.",
    "context-reel": "\"{word}\" appears in {sentenceCount} sentences across your materials. Read them in a row.",
    "sentence-mine": "Recently read content has {count} sentences that are exactly one word away.",
    placement: "Spend {minutes} minutes estimating your vocabulary first; recommendations will be more accurate."
  }
};

module.exports = { zh, en };
