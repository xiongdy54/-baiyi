// v48.80（D124 / 设计稿 §11.9）：学习者模型渲染层界面文字表（{ zh, en }，两套键必须完全相同）。
// 代码中不得出现硬编码的用户可见文字——面板 / 对话框 / 设置子块 / 知识点页等级标签只从这里取。
// learnerLocale() 是界面语言唯一取值点：v1 恒 "zh"，全局 i18n 落地时只改这一个函数。

export type LearnerStrings = typeof zh;

export function learnerLocale(): "zh" | "en" {
  return "zh";
}

const zh = {
  panel: {
    title: "下一步",
    tab: "推荐",
    headerMeta: (generatedAt: string, count: number) => `${generatedAt} · 从 ${count} 个候选中选出`,
    refresh: "刷新",
    tracks: "学习轨道…",
    countSuffix: "条",
    nativeConfirm: (langs: string) => `你的母语是 ${langs} 吗？`,
    nativeConfirmYes: "是",
    nativeConfirmChange: "更改…",
    nativeEmpty: "请先设置你的母语，以便区分哪些是外语材料。",
    nativeEmptySet: "设置…",
    usingProposals: "这些推荐基于从书架推断的学习轨道。",
    confirmTracks: "确认轨道",
    indexing: (phase: string, done: number, total: number) => `正在建立学习索引…（${phase} ${done}/${total}）`,
    empty: "暂时没有推荐。去书架添加材料，或在阅读中摘录、制卡。",
    retry: "重试",
    menuSnooze: "稍后",
    menuDismiss: "不用了",
    menuNotInterested: "不感兴趣",
    menuTooHard: "太难",
    menuTooEasy: "太简单",
    // 主按钮文案（kind → 文案；reinforce 按 action.type 分流 review / jump）
    primaryButton: {
      continue: "继续",
      start: "开始",
      "extract-batch": "去处理",
      "extract-to-card": "打开原文",
      "cross-material": "去看看",
      "self-explain": "写一写",
      practice: "去练习",
      "find-material": "复制搜索词",
      reread: "重读",
      "context-reel": "读一读",
      "sentence-mine": "挑句子",
      placement: "开始"
    } as Record<string, string>,
    reinforceReview: "复习",
    reinforceReread: "重读原文",
    copied: "已复制搜索词"
  },
  kinds: {
    continue: "继续读",
    start: "开始读",
    "extract-batch": "处理摘录",
    "extract-to-card": "摘录制卡",
    reinforce: "巩固",
    "cross-material": "换个讲法",
    "self-explain": "自我解释",
    practice: "练习",
    "find-material": "缺少材料",
    reread: "重读",
    "context-reel": "语境串",
    "sentence-mine": "挖句子",
    placement: "词汇快测"
  } as Record<string, string>,
  tracks: {
    dialogTitle: "学习轨道",
    myTracks: "我的轨道",
    modeLabel: "处理方式",
    modeNames: {
      language: "语言习得",
      concept: "理解建构",
      procedural: "技能练习",
      factual: "事实记忆",
      narrative: "阅读体验"
    } as Record<string, string>,
    statusLabel: "状态",
    statusActive: "进行中",
    statusPaused: "暂停",
    pinnedLabel: "置顶",
    priorityLabel: "优先级",
    delete: "删除",
    addTrack: "新建轨道",
    nameLabel: "名称",
    langLabel: "语言",
    udcLabel: "领域",
    modeLangUnavailable: "无语言信息",
    proposals: "建议的轨道",
    proposalsEmptyHint: "设置书籍语言或在阅读中制卡后，这里会按书架推断可建的轨道。",
    proposalTag: "建议",
    adopt: "采纳",
    tracksEmptyHint: "还没有轨道：从「建议的轨道」采纳一条，或新建。",
    done: "完成",
    unassigned: "未归类的材料",
    assignTo: "归入…",
    remove: "移出",
    unknownLangHint: "语言未知，请在书籍属性中设置",
    nativeLangs: "我的母语",
    nativeLangsHint: "决定哪些语言算外语；可多选。",
    nativePlaceholder: "选择母语…",
    otherLangPlaceholder: "其他语言代码",
    add: "添加",
    rebuild: "重建学习索引",
    rebuilding: "重建中…",
    saved: "已保存",
    confirmDelete: "删除这条轨道？",
    materialsCount: (n: number) => `${n} 份材料`,
    expandMaterials: "归属材料",
    trackNamePlaceholder: "轨道名称"
  },
  settings: {
    title: "学习者知识模型",
    enabledLabel: "启用学习者知识模型",
    enabledInfo:
      "根据你的阅读、摘录、制卡与复习记录估计掌握水平，并在数据页给出「下一步」建议。全部在本机计算，不联网、不调用 AI。关闭后停止计算与记录，已有数据保留，重新开启即恢复。",
    on: "开",
    off: "关",
    nativeLangs: "我的母语",
    recCount: "推荐条数",
    manageTracks: "管理学习轨道…",
    rebuild: "重建学习索引",
    frontierReady: "知识点就绪度已接入（学习推荐刷新后生效）",
    frontierOff: "知识点就绪度未启用（学习者知识模型已关闭）"
  },
  selfExplain: {
    title: "自我解释",
    prompt: (kpName: string, relatedName: string, relationLabel: string) =>
      `不看材料，用自己的话解释「${kpName}」，并说明它与「${relatedName}」的关系（${relationLabel}）。写完再对照原文。`,
    inputPlaceholder: "用你自己的话写下来…",
    openSource: "对照原文",
    ratingClear: "讲清楚了",
    ratingPartial: "部分清楚",
    ratingStuck: "卡住了",
    save: "保存",
    saved: "已记录，下次复习见。"
  },
  unitReader: {
    title: "重读",
    markDone: "读完了",
    openInReader: "在阅读器中打开",
    passes: (n: number) => `已读 ${n} 遍`
  },
  contextReel: {
    title: "语境串",
    allClear: "都读懂了",
    stillUnclear: "还不太懂",
    openSource: "原文",
    empty: "暂时没有找到含这个词的句子。"
  },
  sentenceMine: {
    title: "挖句子",
    openToCard: "打开原文制卡",
    markKnown: "这个词我认识",
    markUnknown: "这个词不认识",
    skip: "跳过",
    empty: "最近读过的内容里暂时没有只差一个生词的句子。"
  },
  placement: {
    title: "词汇快测",
    intro: "勾选你认识的词，估计词汇量。约 2 分钟。",
    bandLabel: (from: number, to: number) => `第 ${from}–${to} 常用词`,
    knowAll: "全认识",
    knowNone: "全不认识",
    submit: "提交",
    empty: "词项索引还没建立，先去读一点材料再来。"
  },
  km: {
    levelNames: ["未接触", "接触过", "学习中", "巩固中", "牢固"] as string[],
    fadingSuffix: "· 在遗忘",
    metricsLine: (n: number, meanRPct: number, stablePct: number, hasDeep: boolean) =>
      `${n} 张卡已复习，平均回忆率 ${meanRPct}%，${stablePct}% 已稳定；${hasDeep ? "有" : "无"}应用题或自我解释`
  },
  relations: {
    prerequisite: "先修",
    part_of: "组成部分",
    related_to: "相关",
    contrasts_with: "对比",
    example_of: "例子",
    application_of: "应用",
    generalization_of: "概括",
    specialization_of: "特例"
  } as Record<string, string>
};

const en: typeof zh = {
  panel: {
    title: "Next steps",
    tab: "Recommended",
    headerMeta: (generatedAt: string, count: number) => `${generatedAt} · picked from ${count} candidates`,
    refresh: "Refresh",
    tracks: "Learning tracks…",
    countSuffix: "",
    nativeConfirm: (langs: string) => `Are ${langs} your native language(s)?`,
    nativeConfirmYes: "Yes",
    nativeConfirmChange: "Change…",
    nativeEmpty: "Set your native language(s) first, so the app knows which materials are foreign-language.",
    nativeEmptySet: "Set…",
    usingProposals: "These recommendations are based on tracks inferred from your shelf.",
    confirmTracks: "Confirm tracks",
    indexing: (phase: string, done: number, total: number) => `Building the learning index… (${phase} ${done}/${total})`,
    empty: "Nothing to recommend yet. Add materials on the shelf, or extract and make cards while reading.",
    retry: "Retry",
    menuSnooze: "Later",
    menuDismiss: "Not now",
    menuNotInterested: "Not interested",
    menuTooHard: "Too hard",
    menuTooEasy: "Too easy",
    primaryButton: {
      continue: "Continue",
      start: "Start",
      "extract-batch": "Process",
      "extract-to-card": "Open source",
      "cross-material": "Take a look",
      "self-explain": "Write",
      practice: "Practice",
      "find-material": "Copy query",
      reread: "Reread",
      "context-reel": "Read",
      "sentence-mine": "Pick",
      placement: "Start"
    },
    reinforceReview: "Review",
    reinforceReread: "Reread source",
    copied: "Query copied"
  },
  kinds: {
    continue: "Continue",
    start: "Start",
    "extract-batch": "Process extracts",
    "extract-to-card": "Extract to card",
    reinforce: "Reinforce",
    "cross-material": "Another take",
    "self-explain": "Self-explain",
    practice: "Practice",
    "find-material": "Missing material",
    reread: "Reread",
    "context-reel": "Context reel",
    "sentence-mine": "Sentence mine",
    placement: "Vocabulary check"
  },
  tracks: {
    dialogTitle: "Learning tracks",
    myTracks: "My tracks",
    modeLabel: "Mode",
    modeNames: {
      language: "Language acquisition",
      concept: "Concept building",
      procedural: "Skill practice",
      factual: "Factual memory",
      narrative: "Reading experience"
    },
    statusLabel: "Status",
    statusActive: "Active",
    statusPaused: "Paused",
    pinnedLabel: "Pinned",
    priorityLabel: "Priority",
    delete: "Delete",
    addTrack: "New track",
    nameLabel: "Name",
    langLabel: "Language",
    udcLabel: "Domain",
    modeLangUnavailable: "no language set",
    proposals: "Suggested tracks",
    proposalsEmptyHint: "Set a book's language or make some cards while reading — suggested tracks will appear here.",
    proposalTag: "suggested",
    adopt: "Adopt",
    tracksEmptyHint: "No tracks yet: adopt one from \"Suggested tracks\", or create one.",
    done: "Done",
    unassigned: "Unassigned materials",
    assignTo: "Assign to…",
    remove: "Remove",
    unknownLangHint: "Language unknown — set it in the book properties",
    nativeLangs: "My native language(s)",
    nativeLangsHint: "Determines which languages count as foreign. Multi-select.",
    nativePlaceholder: "Select native language(s)…",
    otherLangPlaceholder: "Other language code",
    add: "Add",
    rebuild: "Rebuild learning index",
    rebuilding: "Rebuilding…",
    saved: "Saved",
    confirmDelete: "Delete this track?",
    materialsCount: (n: number) => `${n} material(s)`,
    expandMaterials: "Materials",
    trackNamePlaceholder: "Track name"
  },
  settings: {
    title: "Learner model",
    enabledLabel: "Enable learner model",
    enabledInfo:
      "Estimates your mastery from reading, extracts, cards and reviews, and suggests next steps on the stats page. All computed locally, no network, no AI. Turning it off stops computing and recording; existing data is kept and restored when re-enabled.",
    on: "On",
    off: "Off",
    nativeLangs: "My native language(s)",
    recCount: "Recommendation count",
    manageTracks: "Manage learning tracks…",
    rebuild: "Rebuild learning index",
    frontierReady: "Knowledge-point readiness connected (takes effect after a learning refresh)",
    frontierOff: "Knowledge-point readiness not enabled (learner model is off)"
  },
  selfExplain: {
    title: "Self-explain",
    prompt: (kpName: string, relatedName: string, relationLabel: string) =>
      `Without looking at the material, explain "${kpName}" in your own words and how it relates to "${relatedName}" (${relationLabel}). Then check the source.`,
    inputPlaceholder: "Write it in your own words…",
    openSource: "Check source",
    ratingClear: "Got it",
    ratingPartial: "Partially",
    ratingStuck: "Stuck",
    save: "Save",
    saved: "Recorded. See you at the next review."
  },
  unitReader: {
    title: "Reread",
    markDone: "Done reading",
    openInReader: "Open in reader",
    passes: (n: number) => `Read ${n} time(s)`
  },
  contextReel: {
    title: "Context reel",
    allClear: "All clear",
    stillUnclear: "Still unclear",
    openSource: "Source",
    empty: "No sentences with this word found yet."
  },
  sentenceMine: {
    title: "Sentence mine",
    openToCard: "Open source to make a card",
    markKnown: "I know this word",
    markUnknown: "I don't know this word",
    skip: "Skip",
    empty: "No one-word-away sentences in recently read content yet."
  },
  placement: {
    title: "Vocabulary check",
    intro: "Tick the words you know to estimate your vocabulary. About 2 minutes.",
    bandLabel: (from: number, to: number) => `Words ${from}–${to}`,
    knowAll: "All known",
    knowNone: "All unknown",
    submit: "Submit",
    empty: "The word index is not built yet — read some material first."
  },
  km: {
    levelNames: ["Untouched", "Exposed", "Learning", "Consolidating", "Solid"],
    fadingSuffix: "· fading",
    metricsLine: (n: number, meanRPct: number, stablePct: number, hasDeep: boolean) =>
      `${n} card(s) reviewed, average recall ${meanRPct}%, ${stablePct}% stable; ${hasDeep ? "has" : "no"} application cards or self-explanations`
  },
  relations: {
    prerequisite: "prerequisite",
    part_of: "part of",
    related_to: "related to",
    contrasts_with: "contrasts with",
    example_of: "example of",
    application_of: "application of",
    generalization_of: "generalization of",
    specialization_of: "specialization of"
  }
};

const STRINGS: Record<"zh" | "en", LearnerStrings> = { zh, en };

/** 界面文字唯一取值点：learnerLocale() 决定语言 */
export function learnerStrings(): LearnerStrings {
  return STRINGS[learnerLocale()];
}
