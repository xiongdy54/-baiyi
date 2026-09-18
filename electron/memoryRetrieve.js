// 用户记忆检索（v46，M14-UM2，D39 / §4.18-6/7/8 + R20 v44 原则制）——纯函数、零依赖，
// 主进程（memory:retrieve）与测试（esbuild 打包）共用。两条硬性：
// ① Stage A 只做**宽召回**（确定性、可测）：材料信号 → 封闭映射表落候选生活域 → 主题文件打分选 1-2 篇；
//    **不做语义否决、不设硬门槛**（用户拍板：本地门槛成本高且易过严，会让功能失效，§4.18-7）。
// ② 目录（index.md）与 core 恒定注入：即使命中为空也注入，模型可据此在 warnings 点名缺失主题（可观测、不静默）。
// 生命周期/检索键说明：知识域用在书那一侧——**不要求模型给日记内容猜 UDC**，用「书侧 UDC → 记忆侧生活域」
// 封闭反向映射作检索键（映射表封闭，改动须先改文档 §4.18-6）。

// 封闭映射表（§4.18-6：WHOQOL 六域 / 个人幸福指数七域 / DISE 压力事件清单 / PERMA 并集收敛）。
// 匹配规则 = 最长前缀（"159.9" 优先于 "1"，防心理学被哲学吃掉）。
const DOMAIN_TO_LIFE_MAP = [
  { prefixes: ["004", "62", "51"], lifeDomains: ["工作与学业", "成长与目标"] },
  { prefixes: ["159.9"], lifeDomains: ["情绪与状态", "人际与家庭"] },
  { prefixes: ["316", "32"], lifeDomains: ["人际与家庭", "观念与价值", "兴趣与见闻"] },
  { prefixes: ["33"], lifeDomains: ["财务与生活", "工作与学业", "兴趣与见闻"] },
  { prefixes: ["37"], lifeDomains: ["成长与目标", "人际与家庭"] },
  { prefixes: ["61", "796"], lifeDomains: ["健康与作息", "兴趣与见闻"] },
  { prefixes: ["1", "2"], lifeDomains: ["观念与价值", "成长与目标"] },
  { prefixes: ["7", "78", "79", "8", "91", "93"], lifeDomains: ["兴趣与见闻", "观念与价值"] },
  { prefixes: ["53", "54", "55", "57", "63"], lifeDomains: ["兴趣与见闻", "成长与目标"] }
  // other 其他：不映射，仅靠词面召回（§4.18-6 表末行）
];

const DEFAULT_BUDGETS = { core: 800, index: 1200, topics: 2400 }; // §4.18-8 三段字数预算（injectBudget=4400 的缺省配比）
const MAX_TOPICS = 2; // 每次至多注入 2 篇主题文件（宁多勿少，§4.18-7）
const TERMS_CAP = 80;

// UDC 域 → 候选生活域（最长前缀匹配；无命中返回空数组=仅靠词面召回）
function lifeDomainsForUdc(domainCodes) {
  const hits = new Set();
  for (const raw of Array.isArray(domainCodes) ? domainCodes : []) {
    const d = String(raw || "").trim();
    if (!d) continue;
    let best = null;
    for (const row of DOMAIN_TO_LIFE_MAP) {
      for (const p of row.prefixes) {
        if (d === p || d.startsWith(p)) {
          if (!best || p.length > best.len) best = { len: p.length, domains: row.lifeDomains };
        }
      }
    }
    if (best) for (const x of best.domains) hits.add(x);
  }
  return [...hits];
}

// 材料信号词面：标题/章节标题全量 + 正文 CJK 2-gram 采样 + ASCII 词（宽召回用，宁滥勿漏）。
// v47.1（质量优先）：正文扫描窗口 4000→20000 字——宽召回不应因采样窗口漏掉后文主题
// （纯子串匹配成本可忽略，加大窗口无成本代价）。
function extractSignalTerms({ title = "", section = "", text = "" } = {}) {
  const terms = [];
  const push = (s) => {
    const t = String(s || "").trim();
    if (t && t.length >= 2 && t.length <= 40) terms.push(t);
  };
  push(title);
  push(section);
  const body = String(text || "").slice(0, 20000);
  // ASCII 词（≥3 字母）
  for (const w of body.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []) {
    if (terms.length >= TERMS_CAP) break;
    terms.push(w);
  }
  // CJK 2-gram 采样（步进 3，控制规模）
  const cjkRuns = body.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length && terms.length < TERMS_CAP; i += 3) {
      terms.push(run.slice(i, i + 2));
    }
    if (terms.length >= TERMS_CAP) break;
  }
  return [...new Set(terms)].slice(0, TERMS_CAP);
}

// Stage A 打分：域命中（映射表）×2 + 主题名词面 ×2 + 主题内容词面 ×1；分数 >0 才入选，取前 2（宁多勿少）
function pickTopics(candidateTopics, { lifeDomains = [], terms = [] } = {}) {
  const scored = [];
  for (const t of Array.isArray(candidateTopics) ? candidateTopics : []) {
    const rel = String(t.rel || "");
    const name = String(t.topic || "");
    const content = String(t.content || "");
    let score = 0;
    if (t.domain && lifeDomains.includes(t.domain)) score += 2;
    const nameHit = terms.some((term) => name.includes(term));
    if (nameHit) score += 2;
    const contentHit = terms.some((term) => content.includes(term));
    if (contentHit) score += 1;
    if (score > 0) scored.push({ rel, domain: t.domain || "", topic: name, score, content });
  }
  scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel, "zh"));
  return scored.slice(0, MAX_TOPICS);
}

// 超预算截断：按行边界切，末尾留痕标记（预算只约束单次注入量，文件本身永不因预算改动）
function capText(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  let acc = "";
  for (const line of t.split(/\r?\n/)) {
    if (acc.length + line.length + 1 > maxChars) break;
    acc += (acc ? "\n" : "") + line;
  }
  return acc + "\n（超预算截断）";
}

// 注入块组装（§4.18-8）：core + 目录恒定注入 + 命中主题；带用量头与 R20 用途声明。
// 返回 null 仅当输入为 null（调用方保证 enabled 检查在前）；命中为空仍返回块（目录恒定注入）。
function buildMemoryBlock({ coreText, indexText, topicPicks = [], budgets = DEFAULT_BUDGETS } = {}) {
  const b = { ...DEFAULT_BUDGETS, ...(budgets || {}) };
  if (coreText == null && indexText == null) return null;
  const parts = [
    "【用户记忆（仅用于情境接地——R20：只作应用卡情境与助记生活线索；不得作为答案或事实来源；无贴合处境必须省略并输出 memoryRef: null）】"
  ];
  let used = 0;
  const core = capText(coreText ?? "", b.core);
  parts.push("----- core.md（长期稳定事实）-----", core.trim() || "（空）");
  used += core.length;
  const index = capText(indexText ?? "", b.index);
  parts.push("----- index.md（生活域 → 主题目录）-----", index.trim() || "（空）");
  used += index.length;
  let topicChars = 0;
  const hitNames = [];
  for (const pick of topicPicks) {
    const quota = Math.max(200, b.topics - topicChars);
    if (quota <= 200) break;
    const body = capText(pick.content ?? "", quota);
    parts.push(`----- ${pick.rel} -----`, body.trim() || "（空）");
    topicChars += body.length;
    hitNames.push(pick.rel);
    if (topicChars >= b.topics) break;
  }
  if (!hitNames.length) {
    parts.push("----- 命中主题 -----（无——若材料与目录中某主题相关但内容未提供，请在 warnings 中点名该主题）");
  }
  parts.push(`【用量】core ${core.length} 字 · 目录 ${index.length} 字 · 主题 ${topicChars} 字 / 注入预算 ${b.core + b.index + b.topics} 字；命中主题：${hitNames.length ? hitNames.join("、") : "无"}`);
  return { block: parts.join("\n"), usedChars: used + topicChars, hitTopics: hitNames };
}

// memoryRef 本地校验（§4.18-10）：逐字抄录行必须真的出现在注入块里（子串存在性——非相关性判定）
function validateMemoryRef(block, ref) {
  const r = String(ref || "").trim();
  if (!r) return false;
  return String(block || "").includes(r);
}

module.exports = {
  DOMAIN_TO_LIFE_MAP,
  DEFAULT_BUDGETS,
  MAX_TOPICS,
  lifeDomainsForUdc,
  extractSignalTerms,
  pickTopics,
  capText,
  buildMemoryBlock,
  validateMemoryRef
};
