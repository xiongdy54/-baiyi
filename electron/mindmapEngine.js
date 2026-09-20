// 材料知识导图编排引擎（v48 批2，M15，D41/D42 / §4.19）——主进程 AI 编排（memoryTidy 同款纪律）。
// 自底向上递归归并：section 组（共享文本区间的叶子分析节点合一次调用）→ 逐级 merge → global（整书根，
// 不带原文）→ editorial（本地应用 ops）→ 本地校验（mindmapCore.validateMapStructure）→ 语义评审（确认制）。
// 硬契约：① 发送前预览与实际发送使用同一个 buildCallPayloads（§4.19-8 禁两套拼接）；
// ② 分片缓存逻辑键含 provider+model+modelConfigHash+granularity+promptVersion+textHash（换模型/参数/原文不复用）；
// ③ 抽取快照文本不入库，只存 sha256；④ 失败永不触碰旧 active 图；⑤ 语义评审 FAIL → waiting_user 等确认，
// 一次 repair（重跑对应阶段+复审），仍 fail 即停；主动重新生成属新运行。
// 文本来源：渲染层经内核 getSectionText 收集后经 IPC 传入（引擎不做 IO）。

"use strict";

const crypto = require("crypto");
const core = require("./mindmapCore");

const GENERATOR_VERSION = "m15r-engine-3"; // v48.11：sourceSpans 深挖管线（版本变更即整体缓存失效，宁重算不误复用）
const EXPAND_VARIANT = "expand-2"; // 深挖调用变体（折入 modelConfigHash——变体或模板改动整体失效）；
// expand-1 → expand-2：深挖输入由「父级全部单元锚」改为「节点自身 sourceSpans」（作用域修复，D44）
const MAX_EXPAND_DEPTH = 8; // 安全上限（非正常终止；触达即 stopReason=max_depth 留痕）
const REVIEW_SHARD_NODES = 120; // 语义评审分片阈值（>120 节点按顶层分支递归分片，不截断树不删证据）
// 输出 token 估算（每类调用常数；估算口径，实际以 provider usage 为准，§4.19-8）
const EST_OUTPUT_TOKENS = { section: 900, merge: 700, global: 1000, editorial: 800, review: 600 };
// ---- v48.11（D44）作用域与预算常量 ----
const MAX_PAYLOAD_CHARS = 6000; // 单次 request payload 上限：只切不删（§3.3）
const HARD_SPLIT_OVERLAP = 200; // 极端硬切时的重叠窗口（code unit）
const CLUSTER_GAP = 400; // evidence 候选区间聚类间隔（§3.1 ②）
const CONTEXT_CAP = 1500; // evidence 扩边单侧上限（§3.1 ③）
const GAP_MIN_CHARS = 150; // v48.12 P1：**审计可行动阈值**——结构性残余 ≥ 此值才值得为它发一次补漏调用；
// 低于此值的结构性碎片记 structuralLeftoverChars（可见但不强制 partial，属于「不值得花一次调用」的政策性处置）
const GAP_MIN_RATIO = 0.15; // 残余占父作用域比例阈值（§3.2）
const GAP_FILL_MAX_ROUNDS = 2; // 同一节点 gap-fill 轮次上限（防反复认作 gap）
const TRANSITION_MAX_CHARS = 120; // v48.12 P1：残余 < 此长度且无结构线索 → 视为过渡文本（不建节点）
// 结构线索（出现即视为「结构性文本」，不得当过渡丢掉）：序号/列举/冒号引导/多句
const STRUCTURE_CUE_RE = /(^|s)(第[一二三四五六七八九十d]+|[d]+[、.)）]|[一二三四五六七八九十]+[、）]|其次|再者|另外|另一方面|一方面|最后|总之|例如|比如|包括|分为|如下|：)/;
const SIBLING_OVERLAP_RATIO = 0.6; // v48.12 P2：兄弟 ownedSpans 重叠率超此值 → 触发本地细分（诊断信号，不删节点）
const ATOMIC_MAX_CHARS = 80; // v48.12 P2：高置信原子判定——实读短于此值且无任何结构线索
const MAX_OUTPUT_NODES = { 1: 8, 2: 25, 3: 60 }; // 单次输出节点上限（按递归深度）
const MAX_OUTPUT_TOKENS = 12000; // 单次输出 token 上限（实测 completion 中位 ≈8 千，留 1.5 倍余量）
const RUN_KIND_SCOPE = {
  section: "material-map-section",
  merge: "material-map-merge",
  global: "material-map-global",
  editorial: "material-map-editorial",
  review: "material-map-review"
};

// ---------- 小工具 ----------

function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
}

/** 括号平衡容错 JSON 解析（剥 markdown 围栏；memoryTidy/extractJson 同思路，引擎自含） */
function parseJsonLoose(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  s = s.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readPricing(ctx) {
  try {
    const settings = ctx.readSettings();
    const p = settings && settings.app && settings.app.mindmapPricing;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function modelConfigHashOf(ctx) {
  // 关键生成参数指纹：模型档 + 编排器版本 + 深挖变体（prompt/变体任何改动即整体缓存失效——宁重算不误复用）
  try {
    const cfg = require("./ai").getAIConfig();
    return sha256([cfg.model, cfg.reasoningEffort || "low", GENERATOR_VERSION, EXPAND_VARIANT].join("|"));
  } catch {
    return sha256([GENERATOR_VERSION, EXPAND_VARIANT].join("|"));
  }
}

function maxCallsOf(ctx) {
  try {
    const settings = ctx.readSettings();
    const v = Number(settings && settings.app && settings.app.mindmapMaxCalls);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 300;
  } catch {
    return 300;
  }
}

function providerModelOf() {
  try {
    const cfg = require("./ai").getAIConfig();
    return { provider: cfg.preset || "custom", model: cfg.model || "" };
  } catch {
    return { provider: "custom", model: "" };
  }
}

function estimateTokensOf(text) {
  // 与 db.estimateTokens 同口径（CJK×0.7 + ASCII×0.25，非计费口径）；引擎不依赖 db 实例时也可靠
  const t = String(text ?? "");
  let cjk = 0;
  let ascii = 0;
  for (const ch of t) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk++;
    else if (/\S/.test(ch)) ascii++;
  }
  return Math.ceil(cjk * 0.7 + ascii * 0.25);
}

// ---------- v48.11 作用域作业（§3.1-§3.3：深挖只读节点自身 sourceSpans） ----------

/** 单次请求输入上限 / 扩边上限 / 聚类间隔等可由设置覆盖（默认值见文件头常量） */
function scopeTuningOf(ctx) {
  try {
    const app = (ctx.readSettings() || {}).app || {};
    const int = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
    return {
      maxPayloadChars: int(app.mindmapMaxPayloadChars, MAX_PAYLOAD_CHARS),
      hardSplitOverlap: int(app.mindmapHardSplitOverlap, HARD_SPLIT_OVERLAP),
      clusterGap: int(app.mindmapClusterGap, CLUSTER_GAP),
      contextCap: int(app.mindmapContextCap, CONTEXT_CAP),
      gapMinChars: int(app.mindmapGapMinChars, GAP_MIN_CHARS),
      gapMinRatio: Number.isFinite(Number(app.mindmapGapMinRatio)) && Number(app.mindmapGapMinRatio) >= 0 ? Number(app.mindmapGapMinRatio) : GAP_MIN_RATIO,
      // 允许显式 0（关闭补漏）：不能用 int() 的 >0 规则，否则 0 会被回退成默认值
      gapFillMaxRounds: Math.max(
        0,
        Number.isFinite(Number(app.mindmapGapFillMaxRounds)) ? Math.floor(Number(app.mindmapGapFillMaxRounds)) : GAP_FILL_MAX_ROUNDS
      ),
      expandDepth: Math.max(1, Math.min(3, int(app.mindmapExpandDepth, 1))),
      // v48.12 P2：高置信原子启发式（默认关——实测两类分布重叠，误杀率必须由 benchmark 验证后再开）
      atomicHeuristic: app.mindmapAtomicHeuristic === true,
      // v48.12 P3：批量深挖（默认 1 = 关闭；>1 时按此档合并同层独立作业）
      expandBatch: int(app.mindmapExpandBatch, 1)
    };
  } catch {
    return {
      maxPayloadChars: MAX_PAYLOAD_CHARS,
      hardSplitOverlap: HARD_SPLIT_OVERLAP,
      clusterGap: CLUSTER_GAP,
      contextCap: CONTEXT_CAP,
      gapMinChars: GAP_MIN_CHARS,
      gapMinRatio: GAP_MIN_RATIO,
      gapFillMaxRounds: GAP_FILL_MAX_ROUNDS,
      expandDepth: 1,
      atomicHeuristic: false,
      expandBatch: 1
    };
  }
}

const spanKeyOf = (spans) => JSON.stringify(core.normalizeSpans(spans || []));
const spanHashOf = (spans) => sha256(spanKeyOf(spans));

/** span 覆盖到的单元锚（证据定位与验证的搜索范围＝该 span 内的单元） */
function unitAnchorsOfSpans(linear, spans) {
  const idx = new Set();
  for (const [s, e] of core.normalizeSpans(spans)) {
    for (let i = 0; i < linear.units.length; i++) {
      const us = linear.unitBase[i];
      const ue = i + 1 < linear.units.length ? linear.unitBase[i + 1] - core.LINEARIZATION_SEPARATOR.length : linear.length;
      if (ue > s && us < e) idx.add(i);
    }
  }
  return [...idx].sort((a, b) => a - b).map((i) => linear.units[i]);
}

/**
 * 把一个节点的 sourceSpans 变成若干「深挖作业」：
 * - 总长 ≤ 上限 → 单作业（多片段用显式片段标记，保留「非连续结构」语义）
 * - 超限 → 按 §3.3 切分阶梯拆片，每片一个作业（只切不删）
 * @returns [{ spans, text, shardIndex, shardCount, hard }]
 */
function spanJobsFor(linear, spans, tune) {
  const list = core.normalizeSpans(spans);
  if (!list.length) return [];
  const total = core.spanLengthOf(list);
  if (total <= tune.maxPayloadChars) {
    return [{ spans: list, text: core.spanTextOf(linear, list), shardIndex: 0, shardCount: 1, hard: false }];
  }
  const shards = core.splitSpansForPayload(list, linear, tune.maxPayloadChars, tune.hardSplitOverlap);
  return shards.map((sh, i) => ({
    spans: [[sh.start, sh.end]],
    text: core.spanTextOf(linear, [[sh.start, sh.end]]),
    shardIndex: i,
    shardCount: shards.length,
    hard: !!sh.hard
  }));
}

/** 深挖/补漏调用的 user 消息（作用域 = 所给片段，禁止引用片段之外的内容） */
function buildScopeUser({ title, upper, nodeTitle, text, index, count, purpose }) {
  const head =
    `【材料】${title || "材料知识导图"}\n` +
    `【覆盖粒度】detailed（详细）——逐节点深挖模式\n` +
    `【结构路径】${upper}\n`;
  const ask =
    purpose === "gapfill"
      ? `【补漏】下列原文片段位于节点「${nodeTitle}」的作用域内，但尚未被它的任何子结构覆盖。请判断：这些片段是连接性/过渡文字（返回空 children 并给 stopReason），还是含有被遗漏的作者组织结构（给出直接子结构）。\n\n`
      : `【深挖】下列文本是节点「${nodeTitle}」的原文作用域。已有上层结构如【结构路径】所示、本节点之下暂无更细结构。请只依据所给文本给出它的直接子结构（单层 children），并按原子性判断规则给出 expandable/stopReason。避免复述上层已表达的内容；若所给片段只是过渡/补充文字，返回空 children 并给 stopReason。\n\n`;
  const shardHead = count > 1 ? `【原文分片】第 ${index + 1} / ${count} 片（同一作用域按边界切分；本片只依据本片文本）\n` : "";
  const body = text.startsWith("【原文片段 ") ? text : `【原文片段 1/1】\n${text}\n【/原文片段】`;
  return head + ask + shardHead + body;
}

/** 子节点 span 推导（§3.1；父级钳制在 core 内完成：span ⊆ callSpan，绝不泄漏调用范围之外） */
function deriveChildSpans(linear, child, callSpan, textByUnit, tune) {
  const anchors = unitAnchorsOfSpans(linear, callSpan);
  const located = core.locateNodeEvidence({ unitAnchors: anchors, evidence: Array.isArray(child && child.evidence) ? child.evidence : [] }, textByUnit);
  const r = core.deriveSourceSpans({
    linear,
    evidence: located,
    parentSpans: callSpan,
    clusterGap: tune.clusterGap,
    contextCap: tune.contextCap
  });
  return { spans: r.spans, conflicts: r.conflicts, evidence: located, anchors };
}

/** 子节点 span 推导 + 去重（§3.3：硬切重叠区的重复结构按 canonical span 合并） */
function attachScopeChildren({ parentNode, jobSpans, children, linear, textByUnit, tune, metrics, parentDepth, nextId, depthLeft }) {
  const created = [];
  let dedupeHits = 0;
  // v48.12 P4：有界递归（架构 C）——depthLeft>1 时把模型返回的嵌套 children 一并落地（逐层按各自 evidence 钳制）
  const budget = MAX_OUTPUT_NODES[tune.expandDepth] || 8;
  const recurse = (parentN, list, spans, dLeft) => {
    if (!(dLeft > 1) || !Array.isArray(list) || !list.length) return;
    for (const ch of list) {
      const derived = deriveChildSpans(linear, ch, spans, textByUnit, tune);
      const key = spanKeyOf(derived.spans);
      const title = String((ch && ch.title) || "（未命名）").slice(0, 80);
      const dup = derived.spans.length && created.some((c) => spanKeyOf(c.sourceSpans) === key && c.title === title);
      if (dup) {
        dedupeHits += 1;
        continue;
      }
      if (created.length >= budget) {
        metrics.outputOverflow += 1;
        break;
      }
      const node = mkScopedNode({ parentN, ch, title, key, derived, parentDepth, nextId });
      created.push(node);
      recurse(node, ch && ch.children, derived.spans, dLeft - 1);
    }
  };
  const mkScopedNode = ({ parentN, ch, title, derived, parentDepth: pd, nextId: nid }) => ({
    id: nid(),
    parentId: parentN.id,
    title,
    authorialRole: ch.authorialRole || null,
    centralQuestion: ch.centralQuestion || null,
    mainMove: ch.mainMove || null,
    progression: ch.progression || null,
    relationToParent: ch.relationToParent || null,
    relationToSiblings: ch.relationToSiblings || null,
    groupingBasis: ch.groupingBasis || null,
    unitAnchors: derived.anchors,
    sourceSpans: derived.spans,
    spanOrigin: "evidence",
    evidence: derived.evidence,
    compositionalEvidence: [],
    childIds: [],
    expandable: derived.spans.length ? ch.expandable === true : false,
    stopReason: derived.spans.length ? (ch.expandable === true ? null : ch.stopReason || null) : "scope_conflict",
    sourceKind: "expanded",
    spanStats: { conflicts: derived.conflicts, depth: pd + 1 }
  });
  for (const ch of Array.isArray(children) ? children : []) {
    const derived = deriveChildSpans(linear, ch, jobSpans, textByUnit, tune);
    const key = spanKeyOf(derived.spans);
    const title = String((ch && ch.title) || "（未命名）").slice(0, 80);
    // 去重：同一作业内 span 相同（硬切重叠区常见）且标题相同 → 合并（§3.3）
    const dup = derived.spans.length && created.some((c) => spanKeyOf(c.sourceSpans) === key && c.title === title);
    if (dup) {
      dedupeHits += 1;
      continue;
    }
    if (created.length >= budget) {
      metrics.outputOverflow += 1;
      break;
    }
    const node = mkScopedNode({ parentN: parentNode, ch, title, derived, parentDepth, nextId });
    if (!derived.spans.length && derived.conflicts) metrics.scopeConflicts = (metrics.scopeConflicts || 0) + 1;
    created.push(node);
    recurse(node, ch.children, derived.spans, (tune.expandDepth || 1));
  }
  if (dedupeHits) metrics.dedupeHits = (metrics.dedupeHits || 0) + dedupeHits;
  return created;
}

// ---------- 计划装配（preview 与 send 共用；§4.19-8 同一 payload builder） ----------

/**
 * @param params { title, tocItems:[{anchor,label,children}], unitAnchors:[], textByUnit:{anchor:text},
 *                 scopeAnchor("book"|锚), granularity("overview"|"standard"|"detailed"), force? }
 * @returns { plan, model, error? } plan.calls = [{ runKind, nodeKey, label, system, user, chars, cacheKey }]
 */
function buildCallPayloads(params, promptOf, settings) {
  const textByUnit = new Map(Object.entries(params.textByUnit || {}));
  // v48.5：TOC 归一唯一权威（顶层仅一项 → 塌缩为根，消除合成书「正文」包装层）
  const tree = core.normalizeTocTree(core.buildTocTree(params.tocItems || [], params.title || "材料知识导图"), params.title || "材料知识导图");
  const model = core.buildExtractionModel(tree, params.unitAnchors || []);
  if (!model.units.length) return { error: "材料没有可提取的文本单元（无目录且无章节结构）" };

  // scope 子树根
  let scopeKey = model.rootKey;
  if (params.scopeAnchor && params.scopeAnchor !== "book") {
    const f = model.flat.find((x) => {
      const b = String(x.node.anchor || "").split("#")[0];
      const t = String(params.scopeAnchor || "").split("#")[0];
      return b && (b === t || decodeURIComponent(b) === decodeURIComponent(t));
    });
    if (!f) return { error: `范围锚 ${params.scopeAnchor} 不在目录树中` };
    scopeKey = model.nodeKeyOf(f);
  }
  const scopeDepth = model.flat.find((x) => model.nodeKeyOf(x) === scopeKey).depth;
  const { analyzed } = core.selectAnalysisNodes(model, params.granularity || "standard");
  // scope 内分析节点（文档序 = flat 序）
  const inScope = model.flat.filter((x) => {
    if (x.depth < scopeDepth) return false;
    let cur = x;
    while (cur) {
      if (model.nodeKeyOf(cur) === scopeKey) return true;
      const pf = cur.parent;
      if (!pf) return false;
      cur = pf;
    }
    return false;
  });
  const analyzedInScope = inScope.filter((x) => analyzed.has(model.nodeKeyOf(x)) && model.nodeKeyOf(x) !== scopeKey);
  const keyOf = (x) => model.nodeKeyOf(x);
  const labelOf = (x) => {
    const parts = [];
    let cur = x;
    while (cur) {
      parts.unshift(cur.node.label);
      cur = cur.parent;
      if (parts.length > 6) break;
    }
    return parts.join(" › ");
  };
  const blocksOf = (anchors) =>
    anchors
      .map((a) => `【原文·${a}】\n${textByUnit.get(a) || ""}\n【/原文】`)
      .filter((b) => b.length > 20);

  const calls = [];
  const header = `【材料】${params.title || "材料知识导图"}\n`;

  // 1) section 组：叶子分析节点按覆盖区间文本分组（同 range 兄弟一次调用，杜绝同文重复计费）。
  // v48.6（用户实测：单章书零调用）——TOC 顶层塌缩后分析树可能只剩 scope 根自己（无子节点），
  // 此时根由一次 section 调用负责全文首层分析（global 需有已分析子节点才触发，单章书不满足）。
  const scopeRootEntry = model.flat.find((x) => keyOf(x) === scopeKey);
  const leafNodes = analyzedInScope.filter((x) => {
    const kids = (model.childrenOf.get(keyOf(x)) || []).filter((k) => analyzed.has(k));
    return kids.length === 0;
  });
  const isSingleRootScope = leafNodes.length === 0 && scopeRootEntry && analyzed.has(scopeKey);
  if (isSingleRootScope) {
    // 单根 scope：把根自身当作唯一叶（覆盖其全部区间）
    leafNodes.push(scopeRootEntry);
  }
  const groups = new Map(); // rangeSignature → {nodeKeys:[], units:[]}
  for (const x of leafNodes) {
    const k = keyOf(x);
    const r = model.nodeRange.get(k) || [0, 0];
    const units = [];
    for (let u = r[0]; u < r[1]; u++) units.push(model.units[u]);
    const sig = units.join("|");
    if (!groups.has(sig)) groups.set(sig, { nodeKeys: [], units, range: r });
    groups.get(sig).nodeKeys.push(k);
  }
  // v48.11：文档线性化（canonicalDocOffset = UTF-16 code unit）；section 分片据此携带精确字符区间
  const linear = core.buildLinearization(model.units, textByUnit);
  const nodeTempId = new Map(); // 分析节点 key → 临时编号 n1..（merge 输入用；跨调用一致）
  let tempSeq = 0;
  // v48.8：超长单元按段落边界分片（Task 06 契约）——整本无章节书不再一次塞全文（模型长时挂起根因）
  // 注意：分片粒度是**独立可调参数**（settings.app.mindmapSectionChunkChars），改动会使 section 缓存整体失效
  let SECTION_CHUNK_CHARS = 8000;
  try {
    const v = Number((settings && settings.app && settings.app.mindmapSectionChunkChars) || 0);
    if (Number.isFinite(v) && v > 0) SECTION_CHUNK_CHARS = Math.floor(v);
  } catch {
    /* 保留默认 */
  }
  for (const g of groups.values()) {
    tempSeq += 1;
    const gTempId = `n${tempSeq}`;
    for (const k of g.nodeKeys) nodeTempId.set(k, gTempId);
    const fullText = g.units.map((u) => textByUnit.get(u) || "").join("\n");
    const groupSpan = core.spanOfUnitRange(linear, g.range ? g.range[0] : 0, g.range ? g.range[1] : 0);
    const base = groupSpan ? groupSpan[0] : 0;
    const label = g.nodeKeys.map((k) => {
      const f = model.flat.find((x) => keyOf(x) === k);
      return f.node.label;
    }).join(" + ");
    const pathLine = g.nodeKeys
      .map((k) => {
        const f = model.flat.find((x) => keyOf(x) === k);
        return `【结构路径】${labelOf(f)}（编号 n${tempSeq}）`;
      })
      .join("\n");
    const chunks = fullText.length > SECTION_CHUNK_CHARS
      ? core.splitByParagraphs(fullText, SECTION_CHUNK_CHARS)
      : [{ start: 0, end: fullText.length, text: fullText }];
    chunks.forEach((chunk, ci) => {
      const chunkHeader = chunks.length > 1 ? `【原文分片】第 ${ci + 1} / ${chunks.length} 片（同一单元按段落边界切分；本片只依据本片文本，勿引用其他片）\n` : "";
      const user =
        header +
        chunkHeader +
        pathLine +
        "\n\n" +
        `【原文·${g.units[0] || "src"}】\n${chunk.text}\n【/原文】`;
      // 分片的精确字符区间（= 线性化切片；文本与 chunk.text 逐字相同，section 缓存键不变）
      const span = [[base + chunk.start, base + chunk.end]]; // v48.12 P0：区间列表（此前单区间致 span_hash 恒为 "[]"）
      calls.push({
        runKind: "section",
        nodeKey: chunks.length > 1 ? `grp:${sha256(g.nodeKeys.join("|")).slice(0, 8)}:c${ci}` : `grp:${sha256(g.nodeKeys.join("|")).slice(0, 12)}`,
        label: chunks.length > 1 ? `${label}（片 ${ci + 1}/${chunks.length}）` : label,
        nodeKeys: g.nodeKeys,
        groupKey: `grp:${sha256(g.nodeKeys.join("|")).slice(0, 12)}`,
        system: promptOf("material-map-section"),
        user,
        chars: user.length,
        sourceChars: chunk.text.length,
        span,
        unitAnchors: unitAnchorsOfSpans(linear, [span]),
        cacheKey: { textHash: sha256(chunk.text) }
      });
    });
  }
  // 2) merge：由底向上（depth 降序）；输入 = 自有原文（skip=已分析子）+ 直接子节点的已完成分析摘要。
  //    子树 scope 的根也走 merge（可用自有原文）；全书 scope 的根由 3) global 接管。
  const analyzedKeys = new Set(analyzedInScope.map(keyOf));
  analyzedKeys.add(scopeKey); // scope 根同样是分析节点（内容来自 global 或自身 merge），assembleMap 需为其建节点
  const kidsAnalyzedOf = (x) => (model.childrenOf.get(keyOf(x)) || []).filter((c) => analyzed.has(c));
  const mergeOrder = analyzedInScope
    .filter((x) => kidsAnalyzedOf(x).length > 0)
    .sort((a, b) => b.depth - a.depth);
  const isBookScopeEarly = !params.scopeAnchor || params.scopeAnchor === "book";
  if (!isBookScopeEarly) {
    const sr = model.flat.find((x) => keyOf(x) === scopeKey);
    if (sr && kidsAnalyzedOf(sr).length > 0) mergeOrder.push(sr), mergeOrder.sort((a, b) => b.depth - a.depth);
  }
  for (const x of mergeOrder) {
    const k = keyOf(x);
    tempSeq += 1;
    nodeTempId.set(k, `n${tempSeq}`);
    const kids = (model.childrenOf.get(k) || []).filter((c) => analyzedKeys.has(c));
    const owned = core.ownedText(model, k, textByUnit, { skipChildKeys: kids });
    const blocks = owned ? blocksOf(ownedRangeAnchors(model, k, kids)) : [];
    const childSummaries = kids.map((ck) => {
      // 子节点摘要来自其调用产出（运行期填充；此处仅占位结构，send 时回填）
      return { key: ck, tempId: nodeTempId.get(ck) };
    });
    const user =
      header +
      `【结构路径】${labelOf(x)}（编号 n${tempSeq}）\n\n` +
      (blocks.length ? blocks.join("\n\n") + "\n\n" : "") +
      "【子节点分析】（编号将在运行期回填）";
    calls.push({
      runKind: "merge",
      nodeKey: k,
      label: labelOf(x),
      nodeKeys: [k],
      system: promptOf("material-map-merge"),
      user,
      chars: user.length,
      childKeys: childSummaries.map((c) => c.key),
      blocks: blocks.length ? ownedRangeAnchors(model, k, kids) : [],
      cacheKey: { textHash: "" } // 运行期=sha256(ownedText+子产出JSON)
    });
  }

  // 3) global（仅 scope=全书根时用 global scope；子树根的 merge 已在上面）
  const rootEntry = model.flat.find((x) => keyOf(x) === scopeKey);
  const isBookScope = isBookScopeEarly;
  const topAnalysed = inScope.filter((x) => x.depth === scopeDepth + 1 && analyzed.has(keyOf(x)));
  if (isBookScope && topAnalysed.length > 0) {
    tempSeq += 1;
    nodeTempId.set(scopeKey, `n${tempSeq}`);
    const tocText = renderTocText(tree);
    const user =
      header +
      `【目录】\n${tocText}\n\n【部分分析】（顶层各部分的分析摘要，编号 n1.. 运行期回填）`;
    calls.push({
      runKind: "global",
      nodeKey: scopeKey,
      label: labelOf(rootEntry),
      nodeKeys: [scopeKey],
      system: promptOf("material-map-global"),
      user,
      chars: user.length,
      childKeys: topAnalysed.map(keyOf),
      cacheKey: { textHash: "" }
    });
  }

  return {
    plan: { calls, scopeKey, nodeTempId, model, textByUnit, analyzedKeys, linear },
    model,
    scopeKey
  };
}

/** 递归缓存指纹：叶子=组文本 hash；merge=自有文本+子键+子指纹；global=目录+子指纹。
 *  preview 与 send 用同一函数计算 → 缓存命中预估与实际执行完全一致（§4.19-8）；
 *  子分片内容变化必然使父指纹变化（父输入含子产出，同键同产出）。 */
function callTextHash(call, plan, hashMemo) {
  if (call.runKind === "section") return call.cacheKey.textHash;
  if (hashMemo.has(call.nodeKey)) return hashMemo.get(call.nodeKey);
  const childHashes = (call.childKeys || []).map((ck) => {
    const childCall = plan.calls.find((c) => c.nodeKeys && c.nodeKeys.includes(ck));
    return childCall ? callTextHash(childCall, plan, hashMemo) : ck;
  });
  let base;
  if (call.runKind === "merge") {
    const owned = core.ownedText(plan.model, call.nodeKey, plan.textByUnit, { skipChildKeys: call.childKeys });
    base = owned + "|children|" + (call.childKeys || []).join(",") + "|" + childHashes.join(",");
  } else {
    base = "global|" + (call.childKeys || []).join(",") + "|" + childHashes.join(",");
  }
  const h = sha256(base);
  hashMemo.set(call.nodeKey, h);
  return h;
}

function ownedRangeAnchors(model, nodeKey, skipChildKeys) {
  const gaps = core.ownedRanges(model, nodeKey, { skipChildKeys });
  const anchors = [];
  for (const [s, e] of gaps) {
    for (let u = s; u < e; u++) anchors.push(model.units[u]);
  }
  return anchors;
}

function renderTocText(tree, depth = 0, out = []) {
  for (const c of tree.children || []) {
    out.push(`${"  ".repeat(depth)}- ${c.label}`);
    renderTocText(c, depth + 1, out);
  }
  return out.join("\n");
}

/** 组装某次调用的最终 user 消息（merge/global 的子节点摘要在运行期回填后调用） */
function finalizeUser(call, childSummaries) {
  if (call.runKind === "merge") {
    const lines = (childSummaries || []).map(
      (c, i) =>
        `【子节点分析 ${i + 1}｜编号 ${c.tempId}】\n` +
        JSON.stringify({ title: c.title, authorialRole: c.authorialRole, progression: c.progression, evidence: (c.evidence || []).map((e) => e.quote).slice(0, 3) })
    );
    return call.user.replace("【子节点分析】（编号将在运行期回填）", lines.join("\n\n"));
  }
  if (call.runKind === "global") {
    const lines = (childSummaries || []).map(
      (c, i) =>
        `【部分分析 ${i + 1}｜编号 ${c.tempId}】\n` +
        JSON.stringify({ title: c.title, authorialRole: c.authorialRole, groupingBasis: c.groupingBasis, progression: c.progression })
    );
    return call.user.replace("【部分分析】（顶层各部分的分析摘要，编号 n1.. 运行期回填）", lines.join("\n\n"));
  }
  return call.user;
}

// ---------- 预览（零 AI 调用） ----------

function preview(ctx, params) {
  const { plan, error } = buildCallPayloads(params, (scope) => templateText(ctx, scope), safeSettings(ctx));
  if (error) return { error };
  const hashMemo = new Map();
  const { provider, model } = providerModelOf();
  const cfgHash = modelConfigHashOf(ctx);
  let newCalls = 0;
  let cacheHits = 0;
  let charsNew = 0;
  let estInput = 0;
  let estOutput = 0;
  let sourceCharsExact = 0; // v48.7：待发送原文字数只统计 section 实际原文（merge/global 发送的是派生摘要，非原文）
  const callViews = [];
  for (const call of plan.calls) {
    const scope = RUN_KIND_SCOPE[call.runKind];
    const key = {
      documentId: params.documentId,
      unitAnchor: call.nodeKey,
      runKind: call.runKind,
      granularity: params.granularity,
      promptScope: scope,
      promptVersion: promptVersion(ctx, scope),
      textHash: callTextHash(call, plan, hashMemo),
      provider,
      model,
      modelConfigHash: cfgHash
    };
    const hit = !params.force && ctx.db.getMaterialMapShard(key);
    if (hit) cacheHits++;
    else {
      newCalls++;
      charsNew += call.chars;
      estInput += estimateTokensOf(call.user);
      estOutput += EST_OUTPUT_TOKENS[call.runKind] || 700;
    }
    if (call.runKind === "section") sourceCharsExact += call.sourceChars || 0;
    callViews.push({ runKind: call.runKind, label: call.label, chars: call.chars, cached: !!hit });
  }
  // 终编辑与语义评审是管线的固定尾调用（缓存键依赖最终结构 JSON，preview 阶段无法精确预估命中）——
  // 按保守口径恒计入 2 次输出估算，UI 明示「随缓存变动」（§4.19-8 诚实预览，禁低估）
  const fixedCalls = 2;
  estOutput += EST_OUTPUT_TOKENS.editorial + EST_OUTPUT_TOKENS.review;
  // v48.5 批B：expand 首波预估 = section 组成员叶数（模型逐节点判定 expandable，实际随深度动态；
  // 仅作费用预期锚点，UI 明示「动态追加」——禁伪装精确值）
  let expandFirstWave = 0;
  {
    const seenGroups = new Set();
    for (const c of plan.calls) {
      if (c.runKind !== "section") continue;
      const gk = c.groupKey || c.nodeKey;
      if (seenGroups.has(gk)) continue;
      seenGroups.add(gk);
      expandFirstWave += (c.nodeKeys || []).length;
    }
  }
  estOutput += expandFirstWave * (EST_OUTPUT_TOKENS.section || 900);
  const pricing = readPricing(ctx)[model] || null;
  const estCost =
    pricing && Number(pricing.input) >= 0 && Number(pricing.output) >= 0
      ? Math.round(((estInput / 1e6) * Number(pricing.input) + (estOutput / 1e6) * Number(pricing.output)) * 100) / 100
      : null;
  return {
    calls: callViews,
    callsTotal: plan.calls.length,
    newCalls,
    cacheHits,
    fixedCalls,
    expandFirstWave,
    budget: maxCallsOf(ctx),
    sourceCharsExact,
    charsExact: plan.calls.reduce((s, c) => s + c.chars, 0),
    estInputTokens: estInput,
    estOutputTokens: estOutput,
    estCost,
    currency: pricing ? pricing.currency || "CNY" : null,
    hasPricing: !!pricing,
    provider,
    model,
    // v48.12：当前生效策略（benchmark 与 UI 透明化用；不改变任何行为）
    strategy: (() => {
      const t = scopeTuningOf(ctx);
      return {
        expandBatch: t.expandBatch,
        expandDepth: t.expandDepth,
        atomicHeuristic: t.atomicHeuristic,
        maxPayloadChars: t.maxPayloadChars,
        gapFillMaxRounds: t.gapFillMaxRounds,
        gapMinChars: t.gapMinChars
      };
    })()
  };
}

function safeSettings(ctx) {
  try {
    return ctx.readSettings() || {};
  } catch {
    return {};
  }
}

function templateText(ctx, scope) {
  const t = ctx.db.getPromptTemplate(scope);
  return t ? t.content : "";
}

function promptVersion(ctx, scope) {
  const t = ctx.db.getPromptTemplate(scope);
  return t ? t.version : 1;
}

// ---------- 生成 ----------

async function generate(ctx, params, runId) {
  const { provider, model } = providerModelOf();
  const cfgHash = modelConfigHashOf(ctx);
  const common = { documentId: params.documentId, granularity: params.granularity, provider, model, modelConfigHash: cfgHash };
  const budget = maxCallsOf(ctx);

  const run =
    (runId && ctx.db.getMaterialMapRun(runId)) ||
    ctx.db.createMaterialMapRun({
      documentId: params.documentId,
      scopeAnchor: params.scopeAnchor || "book",
      scopeKind: params.scopeAnchor && params.scopeAnchor !== "book" ? "chapter" : "book",
      granularity: params.granularity,
      input: { scope: params.scopeAnchor || "book", granularity: params.granularity, budget }
    });
  const cancelled = () => cancelledRuns.has(run.id);
  // v48.12 P0：跨阶段合并（首层 stopAfterSection + 续跑两段各自 generate()，此前账本/用量只覆盖最后一段）
  const prevLedger = (run.output && run.output.ledger) || null;
  const priorCalls = prevLedger ? Number(prevLedger.successfulCalls) || 0 : 0;
  const priorRequests = prevLedger ? Number(prevLedger.requestedCalls) || 0 : 0;
  const usageAcc = {
    prompt: prevLedger ? Number(run.actualPromptTokens) || 0 : 0,
    completion: prevLedger ? Number(run.actualCompletionTokens) || 0 : 0
  };
  const cacheContent = new Map(); // nodeKey → 调用产出（组调用每成员共享）
  let callsMade = 0;
  let budgetHit = false;
  // v48.11 Run 审计总账（§3.8）：真源是调用日志，不在 run 行里猜
  const runStats = { requested: 0, cacheHits: 0, repairCalls: 0, failed: 0, cancelled: 0, unknownOutcome: 0, retries: 0, byKind: {} };
  const bumpKind = (kind, field) => {
    const k = kind || "other";
    if (!runStats.byKind[k]) runStats.byKind[k] = { requested: 0, cacheHits: 0, calls: 0 };
    runStats.byKind[k][field] += 1;
  };
  const logCall = (call, info) => {
    try {
      if (typeof ctx.db.saveMaterialMapCall === "function") {
        ctx.db.saveMaterialMapCall({
          runId: run.id,
          documentId: params.documentId,
          runKind: call && call.runKind ? call.runKind : "other",
          nodeAnchor: (call && call.nodeKey) || "",
          spanHash: call && call.span ? spanHashOf(call.span) : null,
          chars: (call && call.chars) || null,
          spanChars: call && call.span ? core.spanLengthOf(call.span) : (call && call.sourceChars) || null,
          depth: call && Number.isFinite(call.depth) ? call.depth : null,
          parentNodeId: (call && call.parentNodeId) || null,
          ...info
        });
      }
    } catch {
      /* 账本失败不影响生成 */
    }
  };
  const budgetLeft = () => budget - priorRequests - runStats.requested; // run 级：跨阶段累计请求数

  // 单次调用执行（缓存命中跳过；坏 JSON 一次 STRUCTURE_FORMAT_REPAIR；usage 累计；取消/预算检查）
  // v48.11：预算改为**全 run 统一**（section/expand/gapfill/merge/global 全部计入，含格式修复尝试）
  const executeCall = async (call) => {
    const hit = !params.force && ctx.db.getMaterialMapShard(call.cacheKey);
    if (hit) {
      runStats.cacheHits += 1;
      bumpKind(call.runKind, "cacheHits");
      logCall(call, { outcome: "cache_hit", attempt: 0 });
      return { content: hit.content, cached: true };
    }
    if (cancelled()) return { cancelled: true };
    if (budgetLeft() <= 0) {
      budgetHit = true;
      return { budget: true };
    }
    ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "waiting_model", label: call.label || call.runKind, calls: callsMade, budget });
    const t0 = Date.now();
    runStats.requested += 1;
    bumpKind(call.runKind, "requested");
    let text;
    let usage;
    let finishReason = null;
    let ttftMs = null;
    let firstByteMs = null;
    try {
      const r = await chatOnce(ctx, call.system, call.user, run.id, runStats);
      text = r.text;
      usage = r.usage;
      finishReason = r.finishReason || null;
      ttftMs = r.ttftMs ?? null;
      firstByteMs = r.firstByteMs ?? null;
    } catch (err) {
      const code = (err && err.code) || "network";
      if (code === "cancelled") {
        runStats.cancelled += 1;
        logCall(call, { outcome: "cancelled", wallMs: Date.now() - t0, ttftMs, firstByteMs });
      } else {
        runStats.failed += 1;
        logCall(call, { outcome: code === "timeout" ? "unknown_outcome" : "failed", errorCode: code, wallMs: Date.now() - t0, ttftMs, firstByteMs });
      }
      throw err;
    }
    usageAcc.prompt += usage.prompt;
    usageAcc.completion += usage.completion;
    let parsed = parseJsonLoose(text);
    if (!parsed) {
      // 截断与「不是 JSON」区分开：finish_reason=length ⇒ 输出被 provider 截断（§3.4 溢出路径）
      if (finishReason === "length") {
        runStats.outputOverflow = (runStats.outputOverflow || 0) + 1;
        logCall(call, { outcome: "output_overflow", finishReason, wallMs: Date.now() - t0, ttftMs, firstByteMs, completionTokens: usage.completion });
        return { outputOverflow: true, truncated: true, rawText: text };
      }
      runStats.repairCalls += 1;
      const repairUser = `【格式修复】\n下面的内容不是合法 JSON。请只把它转换为合法 JSON：不得增加或删除任何节点与字段，不得修改任何语义内容。\n\n【原输出】\n${text.slice(0, 20000)}`;
      const rep = await chatOnce(ctx, call.system + "\n\n【格式修复模式】收到【格式修复】块时：只转换格式，不得增删改语义。", repairUser, run.id, runStats);
      usageAcc.prompt += rep.usage.prompt;
      usageAcc.completion += rep.usage.completion;
      parsed = parseJsonLoose(rep.text);
      if (!parsed) {
        logCall(call, { outcome: "failed", errorCode: "json", wallMs: Date.now() - t0, ttftMs, firstByteMs, completionTokens: usage.completion });
        return { jsonFail: true };
      }
    }
    if (finishReason === "length") runStats.outputOverflow = (runStats.outputOverflow || 0) + 1;
    callsMade += 1;
    bumpKind(call.runKind, "calls");
    const content = normalizeCallOutput(call.runKind, parsed);
    ctx.db.saveMaterialMapShard({ ...call.cacheKey, content, chars: call.chars || null, tokenUsed: usage.prompt + usage.completion });
    logCall(call, {
      outcome: "completed",
      finishReason,
      wallMs: Date.now() - t0,
      ttftMs,
      firstByteMs,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      attempt: 1
    });
    return { content, finishReason };
  };

  try {
    ctx.db.updateMaterialMapRun(run.id, { status: "estimating", provider, model, modelConfigHash: cfgHash });
    const prep = buildCallPayloads(params, (scope) => templateText(ctx, scope), safeSettings(ctx));
    if (prep.error) {
      ctx.db.updateMaterialMapRun(run.id, { status: "failed_validation", errorCode: "prepare", errorText: prep.error });
      ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "failed", code: "prepare" });
      return { status: "failed", code: "prepare", error: prep.error };
    }
    const plan = prep.plan;

    // 预解析管线调用（section/merge/global）的最终 user 消息与确定性缓存键（指纹与 preview 一致）
    const hashMemo = new Map();
    const resolved = [];
    for (const call of plan.calls) {
      let user = call.user;
      if (call.runKind === "merge" || call.runKind === "global") {
        const childSummaries = (call.childKeys || []).map((ck) => {
          const c = cacheContent.get(ck);
          return {
            tempId: plan.nodeTempId.get(ck) || "n?",
            title: c ? c.title || c.nodeTitle || "" : "",
            authorialRole: c ? c.authorialRole || null : null,
            groupingBasis: c ? c.groupingBasis || null : null,
            progression: c ? c.progression || "" : "",
            evidence: c ? c.evidence || [] : []
          };
        });
        user = finalizeUser(call, childSummaries);
      }
      const scope2 = RUN_KIND_SCOPE[call.runKind];
      resolved.push({
        ...call,
        user,
        cacheKey: {
          ...common,
          unitAnchor: call.nodeKey,
          runKind: call.runKind,
          promptScope: scope2,
          promptVersion: promptVersion(ctx, scope2),
          textHash: callTextHash(call, plan, hashMemo)
        }
      });
    }
    const sectionCalls = resolved.filter((c) => c.runKind === "section");
    const mergeCalls = resolved.filter((c) => c.runKind === "merge");
    const globalCalls = resolved.filter((c) => c.runKind === "global");

    const est = preview(ctx, params);
    ctx.db.updateMaterialMapRun(run.id, {
      status: "running",
      stage: "analyze",
      callsPlanned: est.newCalls,
      chars: est.charsExact,
      estInputTokens: est.estInputTokens,
      estOutputTokens: est.estOutputTokens,
      estCost: est.estCost,
      currency: est.currency,
      promptVersion: promptVersion(ctx, "material-map-section")
    });
    ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "running", done: priorCalls, total: priorCalls + est.newCalls, calls: priorCalls, budget });

    // ---------- 阶段 1：section 首层（expandable/stopReason 由此产生；仅 expandable=true 的叶入深挖队） ----------
    for (const call of sectionCalls) {
      const r = await executeCall(call);
      if (r.cancelled) return finishCancelled(ctx, run.id, runStats, prevLedger);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      // v48.8：按调用键写（分片各自独立）；阶段 1.5 再按组合并展开到 nodeKeys
      cacheContent.set(call.nodeKey, r.content);
      ctx.db.updateMaterialMapRun(run.id, { callsDone: priorCalls + callsMade });
      ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "running", done: priorCalls + callsMade, total: priorCalls + est.newCalls, calls: priorCalls + callsMade, budget });
    }

    // ---------- 阶段 1.5：跨片合并（同组各片的 children 顺序拼接；expandable=any） ----------
    {
      const groupContents = new Map(); // groupKey → contents[]
      for (const call of sectionCalls) {
        const gk = call.groupKey || call.nodeKey;
        const c = cacheContent.get(call.nodeKey);
        if (c) {
          if (!groupContents.has(gk)) groupContents.set(gk, []);
          groupContents.get(gk).push(c);
        }
      }
      for (const [gk, list] of groupContents) {
        const first = sectionCalls.find((c) => (c.groupKey || c.nodeKey) === gk);
        if (list.length === 1) {
          cacheContent.set(gk, list[0]);
          if (first) for (const k of first.nodeKeys || []) cacheContent.set(k, list[0]);
        } else {
          const mergedNodes = [];
          for (const c of list) {
            const arr = Array.isArray(c.nodes) ? c.nodes : [c];
            mergedNodes.push(...arr);
          }
          const anyExpandable = mergedNodes.some((n) => n && n.expandable === true);
          const merged = {
            nodes: mergedNodes,
            expandable: anyExpandable,
            stopReason: anyExpandable ? null : "atomic_structure"
          };
          cacheContent.set(gk, merged);
          if (first) for (const k of first.nodeKeys || []) cacheContent.set(k, merged);
        }
      }
    }

    // 指标（阶段 2.5 与阶段 3 共用）
    const metrics = {
      expandCalls: 0,
      expandCacheHit: 0,
      gapFillCalls: 0,
      gapFillCacheHit: 0,
      dedupeHits: 0,
      scopeConflicts: 0,
      hardSplits: 0,
      outputOverflow: 0,
      coverageGapChars: 0,
      coverageGapCount: 0,
      structuralLeftoverChars: 0,
      structuralLeftoverCount: 0,
      siblingSpanOverlapGroups: 0,
      batchCalls: 0,
      batchMembers: 0,
      batchFallbacks: 0,
      siblingSpanSubdivided: 0,
      atomicSkipped: 0,
      gapFillStalled: 0,
      stopReasons: {}
    };
    const bumpStop = (reason) => {
      const k = reason || "unexamined";
      metrics.stopReasons[k] = (metrics.stopReasons[k] || 0) + 1;
    };
    // ---------- 阶段 2：初装 TOC 层（TOC 节点 + section 单层 children；每个节点携带 sourceSpans） ----------
    const tune = scopeTuningOf(ctx);
    const assembled = assembleTocLayer(params, plan, sectionCalls, cacheContent, tune, metrics);
    const nodeById = new Map(assembled.raw.nodes.map((n) => [n.id, n]));
    nodeByIdLookup = (id) => nodeById.get(id) || null;
    const linear = plan.linear;

    // ---------- 阶段 2.5（v48.11 §3.10）：首层就绪即落一版可看的图 ----------
    // 「详细生成」是产品承诺，但首层 17 次调用 ≈ 10 分钟就已产出有价值的结构；深挖改为**可续跑的第二阶段**：
    // stopAfterSection=true 时到此为止（状态 section_ready ≠ completed；v48.13 起：**仅在无已发布版本时**
    // 才作为 provisional 发布激活，否则只作候选，不顶掉旧图），
    // 用户点「继续详细展开」或自动续跑时，用同一 params + 同一 runId 再次调用 generate —— section 全部命中缓存，
    // 直接从深挖开始（零重复计费、重启后亦可用）。
    if (params.stopAfterSection) {
      const validation0 = core.validateMapStructure(assembled.raw, { textByUnit: assembled.textByUnit, rootId: "root" });
      const kept0 = validation0.nodes.filter((n) => n.id !== "root").length;
      if (kept0 === 0) {
        ctx.db.updateMaterialMapRun(run.id, {
          status: "failed_validation",
          errorCode: "validation",
          errorText: `首层结构校验未通过：${validation0.dropped.length} 个节点被拒`,
          actualPromptTokens: usageAcc.prompt,
          actualCompletionTokens: usageAcc.completion,
          output: { dropped: validation0.dropped, metrics }
        });
        ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "failed", code: "validation" });
        return { status: "failed", code: "validation", dropped: validation0.dropped, runId: run.id };
      }
      const expandPlan = firstWavePlan(assembled, tune);
      const saved0 = finalizeMap(ctx, run.id, params, validation0.nodes, assembled.raw.title, usageAcc, {
        budgetHit: false,
        metrics,
        stats: runStats,
        prevLedger,
        spanIndex: buildSpanIndex(assembled),
        coverageSummary: coverageSummaryOf(assembled),
        tune,
        statusOverride: "section_ready"
      });
      const prevOut = (ctx.db.getMaterialMapRun(run.id) || {}).output || {};
      ctx.db.updateMaterialMapRun(run.id, { stage: "section_ready", output: { ...prevOut, expandPlan, metrics } });
      ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "section_ready", mapId: saved0.mapId, expandPlan, published: saved0.published });
      return {
        status: "section_ready",
        mapId: saved0.mapId,
        nodeCount: saved0.nodeCount,
        // v48.13：published=false 表示这只是候选（旧图仍是当前发布版本），UI 必须如实呈现
        published: saved0.published,
        expandPlan,
        runId: run.id
      };
    }

    // ---------- 阶段 3：深挖（作用域＝节点自身 sourceSpans；超长按 §3.3 切片；残余走 gap-fill） ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "expand" });
    let allocSeq = assembled.raw.nodes.length;
    const nextNodeId = () => `x${++allocSeq}`;
    const queue = [];
    const queued = new Set();
    const enqueue = (node, depth, kind, spans) => {
      const list = core.normalizeSpans(spans || node.sourceSpans || []);
      if (!list.length) return false;
      const fp = expandFingerprint(node, depth, kind, list);
      if (queued.has(fp)) return false;
      queued.add(fp);
      queue.push({ fp, node, depth, kind: kind || "expand", spans: list });
      return true;
    };
    const depthOfNode = new Map();
    const depthWalk = (id, d) => {
      depthOfNode.set(id, d);
      const n = nodeById.get(id);
      for (const c of (n && n.childIds) || []) depthWalk(c, d + 1);
    };
    depthWalk("root", 0);
    for (const n of assembled.raw.nodes) {
      if (n.id === "root") continue;
      n.sourceKind = n.sourceKind || ((n.unitAnchors && n.unitAnchors.length) ? "toc_owned" : "derived_group");
      const d = depthOfNode.get(n.id) || 0;
      // 仅深挖「无子节点的叶」且**必须有作用域**（无作用域＝证据无法定位，绝不退化为重读父级全文）
      if (n.expandable === true && (n.childIds || []).length === 0) {
        if (tune.atomicHeuristic && isHighConfidenceAtomic(linear, n)) {
          // 高置信原子：本地判定为终态，不发调用（metrics 留痕，便于 benchmark 统计误杀）
          n.stopReason = "atomic_heuristic";
          metrics.atomicSkipped += 1;
        } else if (!(n.sourceSpans || []).length) {
          n.expandable = false;
          n.stopReason = "scope_conflict";
          bumpStop("scope_conflict");
          metrics.scopeConflicts += 1;
        } else if (d >= MAX_EXPAND_DEPTH) {
          n.stopReason = "max_depth";
          bumpStop("max_depth");
        } else enqueue(n, d, "expand");
      } else if (d > 0) bumpStop(n.stopReason || "atomic_structure");
    }
    const enqueueGapFill = (node, depth, explicitSpans) => {
      const residual = (explicitSpans && explicitSpans.length ? explicitSpans : node.gapSpans) || [];
      if (!residual.length) return;
      const fp = expandFingerprint(node, depth, "gapfill", residual);
      if (queued.has(fp)) return;
      queued.add(fp);
      // 同层补漏优先于更深展开（§3.5：覆盖完整性优先于深度）
      queue.unshift({ fp, node, depth, kind: "gapfill", spans: core.normalizeSpans(residual) });
    };
    // v48.11（§3.6）：并发阶梯——每批取同层「互不依赖」的作业并行跑（队列按 BFS 入队、子作业只在本作业完成后入队，
    // 故同一批快照内不存在父子依赖）；默认 concurrency=1（等价串行，行为与旧实现一致）。
    // 失败隔离：单作业失败不杀整批；429 冷却窗口内不升档。
    let jobFailure = false;
    let coverageGapRemaining = false; // P1：仍有未处置的结构性残余 → completeness 记 coverage_gap（不伪装 complete）
    const laneSetting = concurrencyOf(ctx);
    let lanes = 1;
    let cooldownUntil = 0;
    let okStreak = 0;
    const noteRetry = (info) => {
      if (info && info.code === "rate_limit") {
        lanes = Math.max(1, Math.floor(lanes / 2));
        cooldownUntil = Date.now() + 60000;
        okStreak = 0;
      }
    };
    /** v48.12 P3：批量成员产出采用（与单节点路径同语义：附着 → 细分 → 入队 → 记账） */
    const ingestMemberChildren = (m, entry, kids) => {
      const created = attachScopeChildren({
        parentNode: m.node,
        jobSpans: m.spans,
        children: kids,
        linear,
        textByUnit: assembled.textByUnit,
        tune,
        metrics,
        parentDepth: m.job.depth,
        nextId: nextNodeId
      });
      for (const child of created) {
        nodeById.set(child.id, child);
        assembled.raw.nodes.push(child);
        m.node.childIds.push(child.id);
        depthOfNode.set(child.id, m.job.depth + 1);
      }
      if (created.length > 1) subdivideOverlappingSiblings(m.node, created, linear, assembled.textByUnit, tune, metrics);
      if (entry && entry.expandable === true) m.anyExpandable = true;
      else m.stopAcc = m.stopAcc || (entry && entry.stopReason) || "atomic_structure";
      m.node.residualChars = core.spanLengthOf(core.subtractSpans(m.spans, created.flatMap((c) => c.sourceSpans || [])));
      if (created.length > MAX_OUTPUT_NODES[tune.expandDepth]) {
        metrics.outputOverflow += 1;
        m.node.stopReason = "output_overflow";
        bumpStop("output_overflow");
        return;
      }
      for (const child of created) {
        if (child.expandable && (child.sourceSpans || []).length && (child.childIds || []).length === 0) {
          if (tune.atomicHeuristic && isHighConfidenceAtomic(linear, child)) {
            child.stopReason = "atomic_heuristic";
            metrics.atomicSkipped += 1;
          } else if (m.job.depth + 1 >= MAX_EXPAND_DEPTH) {
            child.stopReason = "max_depth";
            bumpStop("max_depth");
          } else enqueue(child, m.job.depth + 1, "expand");
        } else if (!(child.sourceSpans || []).length) bumpStop("scope_conflict");
        else bumpStop(child.stopReason || "atomic_structure");
      }
      m.node.expandable = !!m.anyExpandable;
      m.node.stopReason = m.node.expandable ? null : m.stopAcc || "atomic_structure";
      bumpStop(m.node.expandable ? null : m.node.stopReason);
    };

    const runJob = async (job) => {
      const fatal = await runExpandJob(job, {
        ctx,
        params,
        run,
        linear,
        assembled,
        nodeById,
        depthOfNode,
        tune,
        metrics,
        bumpStop,
        queue,
        queued,
        enqueue,
        enqueueGapFill,
        nextNodeId,
        executeCall,
        usageAcc,
        cancelled,
        getCallsMade: () => callsMade,
        budget,
        est,
        stats: runStats,
        priorCalls
      });
      if (fatal) return fatal;
      okStreak += 1;
      if (Date.now() > cooldownUntil && lanes < laneSetting && okStreak >= 3) {
        lanes += 1;
        okStreak = 0;
      }
      return null;
    };
    let auditDone = false;
    while (queue.length || !auditDone) {
      if (!queue.length) {
        // ---------- 阶段 3.5（v48.12 P1）：覆盖审计（含 root；分类 transition/structural；structural → 补漏） ----------
        auditDone = true;
        const audit = runCoverageAudit(assembled, nodeById, metrics, tune, {
          enqueueGapFill,
          depthOf: (id) => depthOfNode.get(id) || 0
        });
        metrics.coverageAudit = { transitionChars: audit.transitionChars, structuralChars: audit.structuralChars, tasks: audit.tasks };
        if (metrics.coverageGapChars > 0) coverageGapRemaining = true;
        ctx.broadcast({
          runId: run.id,
          documentId: params.documentId,
          title: params.title || null,
          stage: "coverage_audit",
          transitionChars: audit.transitionChars,
          structuralChars: audit.structuralChars,
          tasks: audit.tasks,
          gapChars: metrics.coverageGapChars || 0
        });
        if (!queue.length) break;
        continue;
      }
      if (cancelled()) return finishCancelled(ctx, run.id, runStats, prevLedger);
      if (budgetLeft() <= 0) {
        budgetHit = true;
        for (const q of queue) {
          q.node.stopReason = "call_budget";
          bumpStop("call_budget");
        }
        queue.length = 0;
        break;
      }
      // v48.12 P3：先编组（碰撞组优先 + 顺序打包到 tune.expandBatch），再按并发车道并行；
      // expandBatch=1 时每组恰为一个作业 → 与旧行为逐字节一致
      const laneGroups = planExpandBatches([...queue], Math.max(1, tune.expandBatch)).slice(0, Math.max(1, lanes));
      const takenJobs = new Set();
      for (const g of laneGroups) for (const j of g) takenJobs.add(j);
      for (let qi = queue.length - 1; qi >= 0; qi -= 1) if (takenJobs.has(queue[qi])) queue.splice(qi, 1);
      const batchDeps = {
        params,
        linear,
        assembled,
        tune,
        metrics,
        bumpStop,
        queue,
        enqueue,
        executeCall,
        common,
        templateTextFn: () => templateText(ctx, RUN_KIND_SCOPE.section),
        promptVersionFn: () => promptVersion(ctx, RUN_KIND_SCOPE.section),
        ancestorTitlesOf: (n) => ancestorTitles(nodeById, n),
        ingestMemberChildren
      };
      const results = await Promise.all(
        laneGroups.map((g) =>
          (g.length > 1 ? runExpandBatchJob(g, batchDeps) : runJob(g[0])).catch((err) => ({
            fatal: (err && err.code) === "cancelled" ? "cancelled" : "error",
            err
          }))
        )
      );
      for (const r of results) {
        if (!r) continue;
        if (r.fatal === "cancelled") return finishCancelled(ctx, run.id, runStats, prevLedger);
        if (r.fatal === "json") return finishJsonFail(ctx, run.id, usageAcc);
        if (r.fatal === "budget") {
          budgetHit = true;
          break;
        }
        if (r.fatal === "error") {
          // 单作业失败隔离（§3.6）：记失败、留痕、继续整批；整轮降级为 partial（不伪装完整）
          runStats.failed += 1;
          metrics.jobFailures = (metrics.jobFailures || 0) + 1;
          jobFailure = true;
        }
      }
      if (budgetHit) break;
    }

/** v48.11：单个深挖/补漏作业的执行体（从 generate 抽出以支持并发批次；无副作用泄漏到外层）
 *  @returns {null | {fatal:"budget"|"cancelled"|"json"}} */
async function runExpandJob(job, deps) {
  const {
    ctx, params, run, linear, assembled, nodeById, depthOfNode, tune, metrics, bumpStop,
    queue, queued, enqueue, enqueueGapFill, nextNodeId, executeCall, usageAcc, cancelled,
    getCallsMade, budget, est, stats, priorCalls
  } = deps;
  void depthOfNode;
  void queued;
      const upper = ancestorTitles(nodeById, job.node);
      const shards = spanJobsFor(linear, job.spans, tune);
      if (!shards.length) {
        job.node.stopReason = "textually_trivial";
        bumpStop("textually_trivial");
        return null;
      }
      let anyExpandable = false;
      let stopAcc = null;
      let expandFailed = false;
      let nodeStopped = false;
      const pushShardJob = (spans) => {
        const fp = sha256(spanKeyOf(spans) + "|" + job.fp + "|resplit|" + job.depth);
        if (queued.has(fp)) return;
        queued.add(fp);
        queue.unshift({ fp, node: job.node, depth: job.depth, kind: job.kind, spans: core.normalizeSpans(spans) });
      };
      for (const sh of shards) {
        if (sh.hard) metrics.hardSplits += 1;
        const user = buildScopeUser({
          title: params.title,
          upper,
          nodeTitle: job.node.title,
          text: sh.text,
          index: sh.shardIndex,
          count: sh.shardCount,
          purpose: job.kind
        });
        const kindKey = job.kind === "gapfill" ? "gapfill" : "expand";
        const fpCi = sha256(job.fp + "|" + sh.shardIndex + "|" + sh.text);
        const anchor = `${kindKey === "gapfill" ? "gap" : "exp"}:${fpCi.slice(0, 16)}`;
        const call = {
          runKind: kindKey,
          nodeKey: anchor,
          label: `${job.kind === "gapfill" ? "补漏" : "深挖"} · ${job.node.title}${sh.shardCount > 1 ? `（片 ${sh.shardIndex + 1}/${sh.shardCount}）` : ""}`,
          nodeKeys: [job.node.id],
          system: templateText(ctx, RUN_KIND_SCOPE.section),
          user,
          chars: user.length,
          sourceChars: core.spanLengthOf(sh.spans),
          span: sh.spans,
          depth: job.depth,
          parentNodeId: job.node.parentId || null,
          cacheKey: {
            ...common,
            unitAnchor: anchor,
            runKind: kindKey,
            promptScope: RUN_KIND_SCOPE.section,
            promptVersion: promptVersion(ctx, RUN_KIND_SCOPE.section),
            textHash: sha256(job.fp + "|" + sh.shardIndex + "|" + sh.text)
          }
        };
        const r = await executeCall(call);
        if (r.cancelled) return { fatal: "cancelled" };
        if (r.budget) {
          return { fatal: "budget" };
        }
        if (r.jsonFail) return { fatal: "json" };
        if (r.cached) {
          if (kindKey === "gapfill") metrics.gapFillCacheHit += 1;
          else metrics.expandCacheHit += 1;
        } else if (kindKey === "gapfill") metrics.gapFillCalls += 1;
        else metrics.expandCalls += 1;
        // §3.4 输出溢出降级阶梯：① 再拆 scope 重试 → ② 标记留待续跑（禁截断）
        if (r.outputOverflow && r.truncated) {
          metrics.outputOverflow += 1;
          const len = core.spanLengthOf(sh.spans);
          if (len > 1000) {
            const halves = core.splitSpansForPayload(sh.spans, linear, Math.max(600, Math.floor(len / 2)), tune.hardSplitOverlap);
            for (const h of halves) pushShardJob([[h.start, h.end]]);
          } else {
            job.node.stopReason = "output_overflow";
            nodeStopped = true;
            bumpStop("output_overflow");
          }
        return null;
        }
        const out = r.content && Array.isArray(r.content.nodes) ? r.content.nodes : [r.content];
        const own = out[0] || {};
        const created = attachScopeChildren({
          parentNode: job.node,
          jobSpans: sh.spans,
          children: Array.isArray(own.children) ? own.children : [],
          linear,
          textByUnit: assembled.textByUnit,
          tune,
          metrics,
          parentDepth: job.depth,
          nextId: nextNodeId
        });
        for (const child of created) {
          nodeById.set(child.id, child);
          assembled.raw.nodes.push(child);
          job.node.childIds.push(child.id);
          depthOfNode.set(child.id, job.depth + 1);
        }
        if (created.length > 1) {
          subdivideOverlappingSiblings(job.node, created, linear, assembled.textByUnit, tune, metrics);
        }
        if (own.expandable === true) anyExpandable = true;
        else stopAcc = stopAcc || own.stopReason || "atomic_structure";
        // 输出节点数超上限：已解析内容全部保留（禁截断），但停止该节点继续下钻并留痕
        if (created.length > MAX_OUTPUT_NODES[tune.expandDepth]) {
          metrics.outputOverflow += 1;
          nodeStopped = true;
          job.node.stopReason = "output_overflow";
          bumpStop("output_overflow");
        }
        if (!nodeStopped) {
          for (const child of created) {
            if (child.expandable && (child.sourceSpans || []).length && (child.childIds || []).length === 0) {
              if (tune.atomicHeuristic && isHighConfidenceAtomic(linear, child)) {
                child.stopReason = "atomic_heuristic";
                metrics.atomicSkipped += 1;
              } else if (job.depth + 1 >= MAX_EXPAND_DEPTH) {
                child.stopReason = "max_depth";
                bumpStop("max_depth");
              } else enqueue(child, job.depth + 1, "expand");
            } else if (!(child.sourceSpans || []).length) {
              bumpStop("scope_conflict");
            } else bumpStop(child.stopReason || "atomic_structure");
          }
        }
      }
      if (expandFailed) return { fatal: "budget" };
      if (!nodeStopped) {
        job.node.expandable = anyExpandable;
        job.node.stopReason = job.node.expandable ? null : stopAcc || "atomic_structure";
        bumpStop(job.node.expandable ? null : job.node.stopReason);
      }
      // 残余账改由阶段末的覆盖审计统一处理（§3.2：含 root，且带不变检测）——此处只记账每节点残余
      {
        const childSpans = (job.node.childIds || [])
          .map((id) => nodeById.get(id))
          .filter(Boolean)
          .map((n) => n.sourceSpans || []);
        job.node.residualChars = core.spanLengthOf(core.subtractSpans(job.spans, childSpans));
      }
      ctx.db.updateMaterialMapRun(run.id, { callsDone: priorCalls + getCallsMade() });
      ctx.broadcast({
        runId: run.id,
        documentId: params.documentId,
        title: params.title || null,
        stage: "expand",
        done: priorCalls + getCallsMade(),
        total: priorCalls + est.newCalls + queue.length + 1,
        calls: priorCalls + getCallsMade(),
        budget,
        kind: job.kind
      });

  return null;
}

/** 并发度设置（§3.6）：默认 1（等价串行）；上限 8 */
function concurrencyOf(ctx) {
  try {
    const v = Number((ctx.readSettings() || {}).app?.mindmapConcurrency);
    if (Number.isFinite(v) && v >= 1) return Math.max(1, Math.min(8, Math.floor(v)));
  } catch {
    /* 默认 1 */
  }
  return 1;
}


    // ---------- 阶段 4：merge（TOC 内部节点；细节已先扩张，此处恢复更高一级组织逻辑） ----------
    // 执行时回填子摘要（section 产出此时已在 cacheContent；预解析阶段为空属时序必然）
    for (const call of mergeCalls) {
      call.user = finalizeUser(call, (call.childKeys || []).map((ck) => {
        const c = cacheContent.get(ck);
        return {
          tempId: plan.nodeTempId.get(ck) || "n?",
          title: c ? c.title || c.nodeTitle || "" : "",
          authorialRole: c ? c.authorialRole || null : null,
          groupingBasis: c ? c.groupingBasis || null : null,
          progression: c ? c.progression || "" : "",
          evidence: c ? c.evidence || [] : []
        };
      }));
      const r = await executeCall(call);
      if (r.cancelled) return finishCancelled(ctx, run.id, runStats, prevLedger);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      cacheContent.set(call.nodeKey, r.content);
      ctx.db.updateMaterialMapRun(run.id, { callsDone: priorCalls + callsMade });
    }

    // ---------- 阶段 5：global（全书根；不带原文） ----------
    for (const call of globalCalls) {
      call.user = finalizeUser(call, (call.childKeys || []).map((ck) => {
        const c = cacheContent.get(ck);
        return {
          tempId: plan.nodeTempId.get(ck) || "n?",
          title: c ? c.title || c.nodeTitle || "" : "",
          authorialRole: c ? c.authorialRole || null : null,
          groupingBasis: c ? c.groupingBasis || null : null,
          progression: c ? c.progression || "" : "",
          evidence: c ? c.evidence || [] : []
        };
      }));
      const r = await executeCall(call);
      if (r.cancelled) return finishCancelled(ctx, run.id, runStats, prevLedger);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      cacheContent.set(call.nodeKey, r.content);
    }

    // ---------- 阶段 6：装配 + 本地校验 ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "validate" });
    attachMergeGlobal(assembled, mergeCalls, globalCalls, cacheContent, { linear, textByUnit: plan.textByUnit, tune });
    const validation = core.validateMapStructure(assembled.raw, { textByUnit: assembled.textByUnit, rootId: "root" });
    const aiNodeCount = validation.nodes.filter((n) => n.id !== "root").length;
    // v48.11：预算触顶导致的「树不完整」不判失败——按 §3.5 落 partial（有多少收多少，绝不伪装完整）；
    // 只有「一个节点都没通过校验」才是真失败。
    if (aiNodeCount === 0 || (!validation.ok && !budgetHit)) {
      ctx.db.updateMaterialMapRun(run.id, {
        status: "failed_validation",
        errorCode: "validation",
        errorText: `结构校验未通过：${validation.dropped.length} 个节点被拒（${(validation.dropped[0] || {}).reason || ""}）`,
        actualPromptTokens: usageAcc.prompt,
        actualCompletionTokens: usageAcc.completion,
        output: { dropped: validation.dropped, metrics }
      });
      ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "failed", code: "validation" });
      return { status: "failed", code: "validation", dropped: validation.dropped, runId: run.id };
    }

    // ---------- editorial 终编辑（本地应用 ops；零变更合法；预算/取消下跳过并留痕） ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "editorial" });
    let nodes = validation.nodes;
    const editorialShardKey = {
      ...common,
      unitAnchor: "editorial",
      runKind: "editorial",
      promptScope: RUN_KIND_SCOPE.editorial,
      promptVersion: promptVersion(ctx, RUN_KIND_SCOPE.editorial),
      textHash: sha256(JSON.stringify(nodes.map(stripEvidenceForPrompt)))
    };
    const editorialHit = !params.force && ctx.db.getMaterialMapShard(editorialShardKey);
    const editorialContent = editorialHit ? editorialHit.content : null;
    if (editorialHit) {
      runStats.cacheHits += 1;
      bumpKind("editorial", "cacheHits");
      logCall({ runKind: "editorial", nodeKey: "editorial" }, { outcome: "cache_hit", attempt: 0 });
    }
    if (editorialContent) {
      const applied = applyEditorialOps(nodes, editorialContent.ops || []);
      const revalidation = core.validateMapStructure({ title: assembled.raw.title, nodes: applied.nodes.map(toRawNode) }, { textByUnit: assembled.textByUnit, rootId: "root" });
      if (revalidation.ok) nodes = revalidation.nodes;
    } else if (budgetLeft() <= 0) {
      budgetHit = true;
      metrics.stopReasons.call_budget = (metrics.stopReasons.call_budget || 0) + 1;
    } else if (!cancelled()) {
      runStats.requested += 1;
      bumpKind("editorial", "requested");
      const tEd = Date.now();
      const user =
        `【材料】${params.title || "材料知识导图"}\n【目录】\n${renderTocText(core.buildTocTree(params.tocItems || [], params.title))}\n\n【结构 JSON】\n` +
        JSON.stringify(nodes.map(stripEvidenceForPrompt));
      const { text, usage } = await chatOnce(ctx, templateText(ctx, RUN_KIND_SCOPE.editorial), user, run.id, runStats);
      usageAcc.prompt += usage.prompt;
      usageAcc.completion += usage.completion;
      const parsed = parseJsonLoose(text);
      const ed = parsed || { ops: [], changeLog: ["终编辑输出不可解析，已跳过（不影响结构正确性）"] };
      ctx.db.saveMaterialMapShard({ ...editorialShardKey, content: ed, tokenUsed: usage.prompt + usage.completion });
      bumpKind("editorial", "calls");
      logCall({ runKind: "editorial", nodeKey: "editorial" }, { outcome: "completed", wallMs: Date.now() - tEd, promptTokens: usage.prompt, completionTokens: usage.completion, attempt: 1 });
      const applied = applyEditorialOps(nodes, ed.ops || []);
      const revalidation = core.validateMapStructure({ title: assembled.raw.title, nodes: applied.nodes.map(toRawNode) }, { textByUnit: assembled.textByUnit, rootId: "root" });
      if (revalidation.ok) nodes = revalidation.nodes;
    }

    // ---------- 语义评审（>120 节点按顶层分支递归分片 + 根一致性复审；不截断树不删证据） ----------
    // v48.11：评审同受 run 预算约束——预算耗尽则跳过评审并按 partial 落库（不伪装「已评审」）
    ctx.db.updateMaterialMapRun(run.id, { stage: "review" });
    let issues = { status: "skipped", list: [], summary: "" };
    if (budgetLeft() <= 0) {
      budgetHit = true;
      metrics.stopReasons.call_budget = (metrics.stopReasons.call_budget || 0) + 1;
    } else {
      issues = await runReview(ctx, run, params, nodes, usageAcc, common, { stats: runStats, log: logCall, bump: bumpKind });
    }

    if (issues.status === "fail") {
      ctx.db.updateMaterialMapRun(run.id, {
        status: "waiting_user",
        stage: "review_failed",
        actualPromptTokens: usageAcc.prompt,
        actualCompletionTokens: usageAcc.completion,
        output: {
          staging: { params, nodes, title: assembled.raw.title },
          issues: issues.list,
          summary: issues.summary || "",
          metrics
        }
      });
      ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: "review_failed", issues: issues.list.length });
      return { status: "review_failed", issues: issues.list, summary: issues.summary || "", runId: run.id };
    }

    // v48.13：**非阻断**的评审意见必须留痕——此前只有 fail 才记录 issues，轻微的评审观察
    // （severity=low/medium）在通过路径上被直接丢弃，用户与后续局部修复都看不到。
    // 口径：不阻断、但记录（进 run.output.metrics，随账本可查）。
    metrics.reviewStatus = issues.status;
    metrics.reviewIssues = Array.isArray(issues.list) ? issues.list : [];

    // ---------- 完成落库（预算触顶 → partial：存为未激活版本，旧 active 保持，不伪装完整生成） ----------
    return finalizeMap(ctx, run.id, params, nodes, assembled.raw.title, usageAcc, {
      budgetHit,
      partialReason: jobFailure ? "call_failed" : coverageGapRemaining ? "coverage_gap" : null,
      metrics,
      stats: runStats,
      prevLedger,
      spanIndex: buildSpanIndex(assembled),
      coverageSummary: coverageSummaryOf(assembled),
      reuseMapId: (run.output && run.output.mapId) || null,
      tune
    });
  } catch (err) {
    const code = err && err.code ? err.code : err && /超时/.test(err.message || "") ? "timeout" : "network";
    if (code === "cancelled") cancelledRuns.delete(run.id);
    const status = code === "cancelled" ? "cancelled" : code === "rate_limit" ? "failed_rate_limit" : code === "timeout" ? "failed_timeout" : "failed_network";
    ctx.db.updateMaterialMapRun(run.id, {
      status,
      errorCode: code,
      errorText: String((err && err.message) || err).slice(0, 500),
      actualPromptTokens: usageAcc.prompt,
      actualCompletionTokens: usageAcc.completion
    });
    ctx.broadcast({ runId: run.id, documentId: params.documentId, title: params.title || null, stage: code === "cancelled" ? "cancelled" : "failed", code });
    return { status: code === "cancelled" ? "cancelled" : "failed", code, error: String((err && err.message) || err), runId: run.id };
  }
}

function finishCancelled(ctx, runId, stats, prev) {
  cancelledRuns.delete(runId);
  let docId = null;
  try {
    const r0 = ctx && ctx.db && ctx.db.getMaterialMapRun ? ctx.db.getMaterialMapRun(runId) : null;
    docId = (r0 && r0.documentId) || null;
  } catch {
    /* 取不到就不带 documentId */
  }
  // v48.11：取消必须写 run 行——此前只清内存 Set，导致 run 永久停在 running（实测两条僵尸）
  try {
    if (ctx && ctx.db && typeof ctx.db.updateMaterialMapRun === "function") {
      ctx.db.updateMaterialMapRun(runId, {
        status: "cancelled",
        errorCode: "cancelled",
        errorText: "用户取消（已完成的分片保留在缓存，重新生成将自动续跑）",
        output: { ledger: ledgerOf(stats, prev) }
      });
    }
  } catch {
    /* 账本写入失败不影响取消语义 */
  }
  try {
    if (ctx && typeof ctx.broadcast === "function") ctx.broadcast({ runId, documentId: docId, stage: "cancelled", code: "cancelled" });
  } catch {
    /* 广播失败不影响取消语义 */
  }
  return { status: "cancelled", runId };
}

/** Run 审计总账（§3.8）：以调用日志为真源，落 output_json.ledger */
function ledgerOf(stats, prev) {
  if (!stats) return null;
  const add = (n, p) => (Number(p) || 0) + n;
  const byKind = {};
  const mergeByKind = (src) => {
    for (const [k, v] of Object.entries(src || {})) {
      byKind[k] = byKind[k] || { requested: 0, cacheHits: 0, calls: 0 };
      byKind[k].requested += Number(v && v.requested) || 0;
      byKind[k].cacheHits += Number(v && v.cacheHits) || 0;
      byKind[k].calls += Number(v && v.calls) || 0;
    }
  };
  mergeByKind(prev && prev.byKind);
  mergeByKind(stats && stats.byKind);
  const successfulCalls = Object.values(byKind).reduce((a, v) => a + (v.calls || 0), 0);
  return {
    requestedCalls: add(stats ? stats.requested : 0, prev && prev.requestedCalls),
    cacheHits: add(stats ? stats.cacheHits : 0, prev && prev.cacheHits),
    repairCalls: add(stats ? stats.repairCalls : 0, prev && prev.repairCalls),
    retries: add(stats ? stats.retries : 0, prev && prev.retries),
    failedCalls: add(stats ? stats.failed : 0, prev && prev.failedCalls),
    cancelledCalls: add(stats ? stats.cancelled : 0, prev && prev.cancelledCalls),
    unknownOutcomeCalls: add(stats ? stats.unknownOutcome : 0, prev && prev.unknownOutcomeCalls),
    outputOverflow: add(stats ? stats.outputOverflow || 0 : 0, prev && prev.outputOverflow),
    successfulCalls,
    byKind
  };
}
function finishJsonFail(ctx, runId, usageAcc) {
  ctx.db.updateMaterialMapRun(runId, {
    status: "failed_json",
    errorCode: "json",
    errorText: "模型输出两次均无法解析为合法 JSON（含一次格式修复）",
    actualPromptTokens: usageAcc.prompt,
    actualCompletionTokens: usageAcc.completion
  });
  try {
    const r0 = ctx && ctx.db && ctx.db.getMaterialMapRun ? ctx.db.getMaterialMapRun(runId) : null;
    ctx.broadcast({ runId, documentId: (r0 && r0.documentId) || null, stage: "failed", code: "json" });
  } catch {
    /* 广播失败不影响失败语义 */
  }
  return { status: "failed", code: "json", runId };
}
let nodeByIdLookup = () => null;
function ancestorTitles(nodeById, node) {
  const parts = [node.title];
  let cur = nodeById.get(node.parentId);
  const guard = new Set([node.id]);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.title);
    cur = nodeById.get(cur.parentId);
  }
  return parts.join(" › ");
}
function expandFingerprint(node, depth, kind, spans) {
  // v48.11：指纹含作用域（span）与作业类型——作用域不同即不同作业；同作用域+同标题+同深度 → 去重
  return sha256([spanKeyOf(spans || node.sourceSpans || []), node.title, depth, kind || "expand"].join("\u0001"));
}

/** 语义评审：≤120 节点一次评审；超出按顶层分支递归分片 + 根一致性复审（跨分支重复/冲突） */
async function runReview(ctx, run, params, nodes, usageAcc, common, hooks) {
  const stats = (hooks && hooks.stats) || null;
  const log = (hooks && hooks.log) || null;
  const bump = (hooks && hooks.bump) || null;
  const reviewOnce = async (user, cacheKey) => {
    const hit = !params.force && cacheKey && ctx.db.getMaterialMapShard(cacheKey);
    if (hit) {
      if (stats) stats.cacheHits += 1;
      if (bump) bump("review", "cacheHits");
      if (log) log({ runKind: "review", nodeKey: (cacheKey && cacheKey.unitAnchor) || "review" }, { outcome: "cache_hit", attempt: 0 });
      return hit.content;
    }
    if (stats) stats.requested += 1;
    if (bump) bump("review", "requested");
    const t0 = Date.now();
    const { text, usage } = await chatOnce(ctx, templateText(ctx, RUN_KIND_SCOPE.review), user, run.id, stats);
    usageAcc.prompt += usage.prompt;
    usageAcc.completion += usage.completion;
    const parsed = parseJsonLoose(text) || { status: "review", issues: [], summary: "评审输出不可解析，按待审处理" };
    if (cacheKey) ctx.db.saveMaterialMapShard({ ...cacheKey, content: parsed, tokenUsed: usage.prompt + usage.completion });
    if (bump) bump("review", "calls");
    if (log) log({ runKind: "review", nodeKey: (cacheKey && cacheKey.unitAnchor) || "review" }, { outcome: "completed", wallMs: Date.now() - t0, promptTokens: usage.prompt, completionTokens: usage.completion, attempt: 1 });
    return parsed;
  };
  const shardKeyFor = (nodesSubset, tag) => ({
    ...common,
    unitAnchor: `review:${tag}`,
    runKind: "review",
    promptScope: RUN_KIND_SCOPE.review,
    promptVersion: promptVersion(ctx, RUN_KIND_SCOPE.review),
    textHash: sha256(JSON.stringify(nodesSubset.map(stripEvidenceForPrompt)))
  });
  const rootId = "root";
  const tops = nodes.filter((n) => n.parentId === rootId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const subtreeOf = (id) => {
    const out = [];
    const walk = (x) => { out.push(x); for (const c of nodes.filter((y) => y.parentId === x.id)) walk(c); };
    const t = byId.get(id);
    if (t) walk(t);
    return out;
  };
  const pathOf = (n) => {
    const parts = [n.title];
    let cur = byId.get(n.parentId);
    const guard = new Set([n.id]);
    while (cur && !guard.has(cur.id)) { guard.add(cur.id); parts.unshift(cur.title); cur = byId.get(cur.parentId); }
    return parts.join(" › ");
  };
  let issues = [];
  let summary = "";
  // v48.13：模型**显式**判 fail（且给出了 issue）视为一次单向棘轮——模型说 fail 就 fail；
  // 反过来不成立（模型说 pass 不能抵消 high 级 issue）。见下方 status 判定注释。
  let modelFail = false;
  const collect = (r) => {
    issues = issues.concat(r.issues || []);
    summary = (summary ? summary + " " : "") + (r.summary || "");
    if (r && r.status === "fail") modelFail = true;
  };
  if (nodes.length <= REVIEW_SHARD_NODES) {
    if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
    const user =
      `【材料】${params.title || "材料知识导图"}\n【目录】\n${renderTocText(core.buildTocTree(params.tocItems || [], params.title))}\n\n【结构 JSON】\n` +
      JSON.stringify(nodes.map(stripEvidenceForPrompt));
    const r = await reviewOnce(user, shardKeyFor(nodes, "whole"));
    collect(r);
  } else {
    for (const t of tops) {
      const sub = subtreeOf(t.id);
      if (sub.length > REVIEW_SHARD_NODES) {
        for (const c of nodes.filter((y) => y.parentId === t.id)) {
          const piece = [t, ...subtreeOf(c.id)].slice(0, REVIEW_SHARD_NODES);
          if (piece.length <= 1) continue;
          if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
          const input = piece.map((n) => ({ ...stripEvidenceForPrompt(n), parentPath: pathOf(n) }));
          const user = `【材料】${params.title || "材料知识导图"}\n【结构 JSON（分支分片：${t.title} › ${c.title}）】\n` + JSON.stringify(input);
          const r = await reviewOnce(user, shardKeyFor(piece, `branch:${c.id}`));
          collect(r);
        }
      } else {
        if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
        const input = sub.map((n) => ({ ...stripEvidenceForPrompt(n), parentPath: pathOf(n) }));
        const user = `【材料】${params.title || "材料知识导图"}\n【结构 JSON（分支分片：${t.title}）】\n` + JSON.stringify(input);
        const r = await reviewOnce(user, shardKeyFor(sub, `branch:${t.id}`));
        collect(r);
      }
    }
    if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
    const coherence = tops.map((t) => ({
      title: t.title,
      authorialRole: t.authorialRole,
      groupingBasis: t.groupingBasis,
      children: nodes.filter((y) => y.parentId === t.id).map((y) => y.title).slice(0, 20)
    }));
    const user2 =
      `【材料】${params.title || "材料知识导图"}\n【全书顶层结构】\n` +
      JSON.stringify(coherence) +
      `\n\n除常规维度外，请特别检查：跨分支重复（不同分支把同一结构重复拆为核心节点）、顶层结构冲突、层级不一致。`;
    const r2 = await reviewOnce(user2, shardKeyFor(tops, "coherence"));
    collect(r2);
  }
  // v48.13 修复「评审误判导致整图不可用」（真实 run ea70cad5 法医结论，见 docs/m15-v48.13-*）：
  // issue.type 是**描述标签**不是严重度——评审提示词【纪律】第 1 条要求「fail 仅用于明确缺陷
  // （空洞父节点泛滥、纯主题列表）；轻微问题用 review 并列 issues」。模型据此把「子节点只是并列
  // 复述」填成 type=topic_list + severity=low（甚至再配 status=pass），而旧实现让 type 无条件
  // 触发 fail，把引擎判得比它自己的提示词更严，并改写了模型 status。现改为：
  //   ① severity === "high" → fail（唯一的标签无关闸门，也是「高严重度结构缺陷」的唯一入口）；
  //   ② 模型显式 status=fail 且给了 issue → fail（单向棘轮：模型说 fail 不作废）；
  //   ③ 其余有 issue → review（记录不阻断）；无 issue → pass。
  const hasHigh = issues.some((i) => i && i.severity === "high");
  const status = hasHigh || (modelFail && issues.length) ? "fail" : issues.length ? "review" : "pass";
  return { status, list: issues, summary };
}

/** 评审 FAIL 后的用户确认修复：仅重跑对应归并阶段 + 本地校验 + 语义复审（一次，§4.19-11） */
async function repairConfirm(ctx, runId) {
  const run = ctx.db.getMaterialMapRun(runId);
  if (!run || run.status !== "waiting_user") return { status: "invalid", error: "运行不在待确认状态" };
  const staging = run.output && run.output.staging;
  if (!staging || !staging.params) return { status: "invalid", error: "缺少待修复结构" };
  const issues = (run.output && run.output.issues) || [];
  const scopes = new Set(issues.map((i) => i.repairScope).filter((s) => s && s !== "none"));
  ctx.db.updateMaterialMapRun(runId, { status: "running", stage: "repair", repairCount: (run.repairCount || 0) + 1 });
  // v1 修复语义：使对应阶段的缓存分片失效（软删），重跑受影响阶段的调用。
  // scope 归属：section_analysis → section 组分片；chapter_merge → merge 分片；global_merge → global；
  // editorial → 重跑终编辑。受影响节点集 → 只软删相关 nodeKey 的分片（其余分支继续用缓存 = 增量重跑）。
  const targetNodes = new Set(issues.map((i) => i.nodeId).filter(Boolean));
  const affectedNodeKeys = collectAffectedNodeKeys(staging, targetNodes, scopes);
  for (const nk of affectedNodeKeys) {
    for (const kind of ["section", "merge", "global"]) {
      const shards = ctx.db.listMaterialMapShards(staging.params.documentId, {
        run_kind: kind,
        granularity: staging.params.granularity
      });
      for (const sh of shards) {
        if (sh.unitAnchor === nk || (kind === "section" && String(nk).startsWith("grp:") && sh.unitAnchor === nk)) {
          softDeleteShard(ctx, sh.id);
        }
      }
    }
  }
  // 语义评审分片必须失效重判（否则缓存里旧的 fail 会立刻再次触发 review_failed）
  for (const sh of ctx.db.listMaterialMapShards(staging.params.documentId, { run_kind: "review" })) {
    softDeleteShard(ctx, sh.id);
  }
  const result = await generate(ctx, staging.params, runId);
  if (result.status === "review_failed") {
    // 二次评审仍 fail → 停（一次 repair 上限），旧有效地图保留
    ctx.db.updateMaterialMapRun(runId, {
      status: "failed_validation",
      errorCode: "review_fail_final",
      errorText: `语义评审修复后仍未通过（一次 repair 上限）：${result.issues.length} 个问题`
    });
    return { status: "failed_final", issues: result.issues, runId };
  }
  return result;
}

function collectAffectedNodeKeys(staging, targetNodeIds, scopes) {
  // 评审 issues 的 nodeId 是导图节点 id；映射回调用 nodeKey：section 组按 grp 前缀、merge 按 TOC nodeKey。
  // v1 保守策略：无法精确归属时重跑该 scope 的全部分片（scope 正确性 > 成本，质量优先）。
  void targetNodeIds;
  const keys = new Set();
  const params = staging.params;
  const prompts = null;
  void prompts;
  const { plan } = buildCallPayloads(staging.params, () => "", null);
  if (scopes.has("section_analysis")) {
    for (const c of plan.calls) if (c.runKind === "section") keys.add(c.nodeKey);
  }
  if (scopes.has("chapter_merge")) {
    for (const c of plan.calls) if (c.runKind === "merge") keys.add(c.nodeKey);
  }
  if (scopes.has("global_merge")) {
    for (const c of plan.calls) if (c.runKind === "global") keys.add(c.nodeKey);
    for (const c of plan.calls) if (c.runKind === "merge") keys.add(c.nodeKey); // global 依赖全部 merge
  }
  if (scopes.size === 0 || scopes.has("editorial")) {
    for (const c of plan.calls) keys.add(c.nodeKey);
  }
  void params;
  return keys;
}

function softDeleteShard(ctx, id) {
  try {
    ctx.db.execRawSql("UPDATE material_map_shards SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), id]);
  } catch {
    /* 已删则忽略 */
  }
}

async function chatOnce(ctx, system, user, runId, stats) {
  const controller = new AbortController();
  registerController(runId, controller);
  // 墙钟看门狗（v48.8）：120s 无数据超时会被推理流持续输出规避——单调用超过 8 分钟强制中止并给出明确失败
  const watchdog = setTimeout(() => {
    const err = new Error("单次调用超过 8 分钟未完成，已中止（长材料请确认网络与模型服务状态；系统已按段落分片控制单次输入规模）");
    err.code = "timeout";
    err.fromWatchdog = true;
    try {
      controller.abort(err);
    } catch {
      /* ignore */
    }
  }, 8 * 60 * 1000);
  try {
    const retryCfg = retryConfigOf(ctx, stats, runId);
    const r = await ctx.chat({
      system,
      user,
      abortSignal: controller.signal,
      temperature: 0.3,
      retry: retryCfg
    });
    const usage = (r && r.usage) || {};
    return {
      text: (r && r.text) || "",
      finishReason: (r && r.finishReason) || null,
      ttftMs: Number.isFinite(Number(r && r.ttftMs)) ? Number(r.ttftMs) : null,
      firstByteMs: Number.isFinite(Number(r && r.firstByteMs)) ? Number(r.firstByteMs) : null,
      usage: { prompt: Number(usage.prompt_tokens) || 0, completion: Number(usage.completion_tokens) || 0 }
    };
  } finally {
    clearTimeout(watchdog);
    unregisterController(runId, controller);
  }
}

/** 重试配置（§3.7）：仅对「未开始产出」的失败重试；流已开始 → unknown_outcome 不重试 */
function retryConfigOf(ctx, stats, runId) {
  // v48.13：重试也是这个 run 的事件——带上归属，全局指示器才不会把它当孤儿事件丢掉
  let retryDocId = null;
  try {
    const r0 = runId && ctx && ctx.db && ctx.db.getMaterialMapRun ? ctx.db.getMaterialMapRun(runId) : null;
    retryDocId = (r0 && r0.documentId) || null;
  } catch {
    /* 取不到就不带 */
  }
  let max = 3;
  try {
    const v = Number((ctx.readSettings() || {}).app?.mindmapRetryMax);
    if (Number.isFinite(v) && v >= 0) max = Math.min(5, Math.floor(v));
  } catch {
    /* 默认 3 */
  }
  return {
    maxAttempts: max,
    onRetry: (info) => {
      // v48.12 P0：重试必须计数（此前 retries 恒为 0，是账本口径缺口）
      if (stats) stats.retries = (stats.retries || 0) + 1;
      try {
        ctx.broadcast({ runId: runId || null, documentId: retryDocId, stage: "retry", ...info });
      } catch {
        /* ignore */
      }
    }
  };
}

// v48.11：每 run 一组控制器（并发下不再互相覆盖——旧实现每 run 只留最后一个，取消不到在飞的调用）
const activeControllers = new Map(); // runId → Set<AbortController>
const cancelledRuns = new Set();

function registerController(runId, controller) {
  const key = String(runId);
  if (!activeControllers.has(key)) activeControllers.set(key, new Set());
  activeControllers.get(key).add(controller);
}

function unregisterController(runId, controller) {
  const key = String(runId);
  const set = activeControllers.get(key);
  if (!set) return;
  set.delete(controller);
  if (!set.size) activeControllers.delete(key);
}

function cancelRun(runId) {
  const key = String(runId);
  cancelledRuns.add(key);
  const set = activeControllers.get(key);
  if (set) {
    for (const c of set) {
      try {
        c.abort();
      } catch {
        /* 已结束则忽略 */
      }
    }
  }
}

// ==================== v48.12 P3：批量深挖（架构 B）+ 碰撞合批 + 逐块恢复/回退 ====================

/**
 * 把队列中的作业编组（确定性）：
 * ① 碰撞组优先——同一 kind 且 span 键相同的作业（≥2）必须先合并成一批（§4.1 修法2：绝不静默丢弃成员）
 * ② 其余按队列顺序打包，只与相邻同 kind 成员合并（expand 与 gapfill 的指令不同，不混批）
 * @returns {Array<Array<job>>}
 */
function planExpandBatches(jobs, batchSize) {
  if (!(batchSize > 1)) return (jobs || []).map((j) => [j]);
  // 已从批量回退过的作业**不再参与合批**（只走单作业）：否则可能反复与被回退的成员合批，回退省下的调用又赔回去
  const eligible = (jobs || []).filter((j) => !j.batchRetried);
  const solo = new Set((jobs || []).filter((j) => j.batchRetried));
  const byKey = new Map();
  for (const j of eligible) {
    const k = `${j.kind}|${spanKeyOf(j.spans)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(j);
  }
  const groups = [];
  const used = new Set();
  for (const [, list] of byKey) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i += batchSize) groups.push(list.slice(i, i + batchSize));
    for (const j of list) used.add(j);
  }
  let cur = [];
  for (const j of jobs || []) {
    if (used.has(j)) continue;
    if (solo.has(j)) {
      if (cur.length) {
        groups.push(cur);
        cur = [];
      }
      groups.push([j]); // 回退成员：独占一组（单作业）
      continue;
    }
    if (cur.length && (cur[0].kind !== j.kind || cur.length >= batchSize)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(j);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** 批量深挖的 user 消息：N 个成员各自独立块，要求按序返回 {nodes:[...]}（每成员一份分析） */
function buildBatchScopeUser({ title, members }) {
  const head =
    `【材料】${title || "材料知识导图"}\n` +
    `【覆盖粒度】detailed（详细）——逐节点深挖模式（**批量**：本次共 ${members.length} 个节点）\n` +
    `【批量说明】下列 ${members.length} 个节点彼此独立，**每个节点只能依据它自己的【原文片段】块**给出直接子结构（单层 children），` +
    `并按原子性判断规则给出该节点的 expandable/stopReason；不得让某节点的子结构引用其他节点的片段。\n` +
    `【输出要求】只输出 {"nodes":[ … ]}，数组顺序与下列节点顺序严格一致（第 i 项对应【深挖·节点 i/${members.length}】）；` +
    `每个元素形如 {"title":…,"authorialRole":…,"expandable":…,"stopReason":…,"children":[…]}\n\n`;
  const blocks = members.map((m, i) => {
    const shardHead = m.count > 1 ? `【原文分片】第 ${m.index + 1} / ${m.count} 片（本片只依据本片文本）\n` : "";
    const body = String(m.text).startsWith("【原文片段 ") ? m.text : `【原文片段 1/1】\n${m.text}\n【/原文片段】`;
    return (
      `【深挖·节点 ${i + 1}/${members.length}】\n` +
      `【结构路径】${m.upper}\n` +
      `【本节点标题】${m.nodeTitle}\n` +
      `【深挖】以下文本是节点「${m.nodeTitle}」的原文作用域，请只依据它给出该节点的直接子结构。\n` +
      shardHead +
      body
    );
  });
  return head + blocks.join("\n\n");
}

/**
 * 截断救援：从被截断的批量输出里，把数组中**已完整的对象**逐个取出（括号平衡前缀扫描）。
 * 用于「整批 JSON 解析失败但前几项完整」的场景——救出的成员正常采用，其余成员逐块回退。
 * @returns {Array<object>} 已完整解析的对象（按出现顺序）
 */
function salvageObjectsFromArray(text) {
  const s = String(text || "");
  const start = s.indexOf("[");
  if (start < 0) return [];
  const out = [];
  let i = start + 1;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length || s[i] !== "{") break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    let done = false;
    for (; j < s.length; j += 1) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          done = true;
          break;
        }
      }
    }
    if (!done) break;
    try {
      out.push(JSON.parse(s.slice(i, j + 1)));
    } catch {
      break;
    }
    i = j + 1;
  }
  return out;
}

/**
 * 执行一个「批量深挖作业组」：一次请求覆盖 N 个成员。
 * - 成员各自独立块与独立上限；输出按序对应
 * - 解析失败 → 括号平衡救援；救出的采用，缺失/失败的成员**逐块回退为单节点作业**（绝不因合批丢节点）
 * - 整批网络失败 → 全部成员回退单节点（只回退一次，之后按单作业的失败隔离处理）
 * @returns {null | {fatal:"budget"|"cancelled"|"json"}}
 */
async function runExpandBatchJob(group, deps) {
  const {
    params,
    linear,
    assembled,
    tune,
    metrics,
    bumpStop,
    queue,
    enqueue,
    executeCall,
    common,
    templateTextFn,
    promptVersionFn,
    ancestorTitlesOf,
    ingestMemberChildren
  } = deps;

  // 成员准备：只接受「单分片」成员（需要切分的成员退回单作业，避免批量里再嵌分片语义）
  const members = [];
  const requeueSingle = [];
  for (const job of group) {
    const shards = spanJobsFor(linear, job.spans, tune);
    if (shards.length !== 1) {
      requeueSingle.push(job);
      continue;
    }
    members.push({
      job,
      node: job.node,
      spans: shards[0].spans,
      text: shards[0].text,
      upper: ancestorTitlesOf(job.node),
      index: 0,
      count: 1
    });
  }
  for (const j of requeueSingle) queue.unshift(j);
  if (!members.length) return null;
  if (members.length === 1) {
    // 退化：只剩一个成员 → 走单节点作业
    queue.unshift(members[0].job);
    return null;
  }

  const signature = members.map((m) => `${m.job.fp}|${m.index}|${m.text}`).join("\u0002");
  const batchHash = sha256(signature);
  const anchor = `bat:${batchHash.slice(0, 16)}`;
  const user = buildBatchScopeUser({ title: params.title, members });
  const call = {
    runKind: "expand",
    nodeKey: anchor,
    label: `深挖 · 批量 ${members.length} 个节点`,
    nodeKeys: members.map((m) => m.node.id),
    system: templateTextFn(),
    user,
    chars: user.length,
    sourceChars: members.reduce((a, m) => a + core.spanLengthOf(m.spans), 0),
    span: null, // 批量没有单一作用域；每成员各自钳制
    depth: members[0].job.depth,
    parentNodeId: members[0].node.parentId || null,
    cacheKey: {
      ...common,
      unitAnchor: anchor,
      runKind: "expand",
      promptScope: RUN_KIND_SCOPE.section,
      promptVersion: promptVersionFn(),
      textHash: sha256(signature)
    }
  };
  metrics.batchCalls = (metrics.batchCalls || 0) + 1;
  metrics.batchMembers = (metrics.batchMembers || 0) + members.length;

  let r;
  try {
    r = await executeCall(call);
  } catch (err) {
    // 整批失败：全部成员回退单节点（只回退一次）
    for (const m of members) {
      if (!m.job.batchRetried) {
        m.job.batchRetried = true;
        queue.unshift(m.job);
        metrics.batchFallbacks = (metrics.batchFallbacks || 0) + 1;
      }
    }
    throw err;
  }
  if (r.cancelled) return { fatal: "cancelled" };
  if (r.budget) return { fatal: "budget" };
  if (r.jsonFail) {
    // 整批无法解析：逐块回退
    for (const m of members) {
      if (!m.job.batchRetried) {
        m.job.batchRetried = true;
        queue.unshift(m.job);
        metrics.batchFallbacks = (metrics.batchFallbacks || 0) + 1;
      }
    }
    return null;
  }

  // 逐块取用：整体解析成功 → 按序对应；截断 → 救援已完整的前缀项
  let entries = [];
  let truncated = false;
  if (r.outputOverflow && r.truncated) {
    truncated = true;
    entries = salvageObjectsFromArray(r.rawText || "");
  } else {
    const content = r.content && Array.isArray(r.content.nodes) ? r.content.nodes : [r.content];
    entries = content;
  }
  if (truncated) metrics.outputOverflow = (metrics.outputOverflow || 0) + 1;

  for (let i = 0; i < members.length; i += 1) {
    const m = members[i];
    const entry = entries[i];
    if (!entry) {
      // 缺失成员：逐块回退（绝不丢节点）
      if (!m.job.batchRetried) {
        m.job.batchRetried = true;
        queue.unshift(m.job);
        metrics.batchFallbacks = (metrics.batchFallbacks || 0) + 1;
      }
      continue;
    }
    const kids = Array.isArray(entry.children) ? entry.children : [];
    ingestMemberChildren(m, entry, kids);
  }
  return null;
}

// ---------- 输出归一 / 组装 / editorial ops ----------

function normalizeCallOutput(runKind, parsed) {
  if (runKind === "section") {
    // 组调用（多结构路径）→ { nodes: [...] }；单路径 → 单对象（归一为数组包装）
    if (parsed && Array.isArray(parsed.nodes)) return parsed;
    return { nodes: [parsed] };
  }
  return parsed;
}

/** v48.12 P1：残余分段分类（transition / structural） */
function classifyResidual(spans, linear) {
  const out = { transition: [], structural: [] };
  for (const seg of core.normalizeSpans(spans)) {
    const text = String(linear.text || "").slice(seg[0], seg[1]);
    const len = seg[1] - seg[0];
    const sentences = (text.match(/[。！？；!?;]/g) || []).length;
    const structural = len >= TRANSITION_MAX_CHARS || STRUCTURE_CUE_RE.test(text) || sentences >= 3;
    (structural ? out.structural : out.transition).push(seg);
  }
  return out;
}

/**
 /**
 * v48.12 P2：高置信原子判定（本地、零成本；**只在多特征同时成立时**才跳过调用）
 * 依据实测：零产出调用实读 52–77 字、有产出调用实读 69–439 字——区间重叠，单靠字数会误杀，
 * 故要求「极短 ∧ 单句 ∧ 无列举标记 ∧ 证据条数少」四条同时成立。默认由设置开关控制（默认关）。
 */
function isHighConfidenceAtomic(linear, node) {
  const spans = core.normalizeSpans(node.sourceSpans || []);
  const len = core.spanLengthOf(spans);
  if (!len || len >= ATOMIC_MAX_CHARS) return false;
  const text = core.spanTextOf(linear, spans);
  const sentences = (text.match(/[。！？；!?;]/g) || []).length;
  if (sentences > 1) return false;
  if (STRUCTURE_CUE_RE.test(text)) return false;
  if ((node.evidence || []).length > 2) return false;
  return true;
}

/**
 * v48.12 P2 修法1：兄弟 span 重叠 → 本地细分（确定性、零成本、**绝不删节点**）
 * 触发：同一父节点下某成员的 ownedSpans 与「其余兄弟的并集」重叠率 > 60%
 * 处置：该成员按**自身 evidence 命中区间**重新推导（contextCap=0，不再向外扩边）并钳制在父范围内。
 * 目的：把「多个并列项一起继承同一整段」膨胀的作用域收回各自片段，从源头减少重复读取。
 */
function subdivideOverlappingSiblings(parentNode, children, linear, textByUnit, tune, metrics) {
  if (!linear || !children || children.length < 2) return 0;
  const spansOf = (n) => core.normalizeSpans(n.sourceSpans || []);
  const parentSpans = parentNode ? spansOf(parentNode) : null;
  let changed = 0;
  let groups = 0;
  for (const n of children) {
    const mine = spansOf(n);
    const mineLen = core.spanLengthOf(mine);
    if (!mineLen) continue;
    const otherUnion = core.normalizeSpans(children.filter((x) => x !== n).flatMap((x) => spansOf(x)));
    const overlap = core.spanLengthOf(core.intersectSpans(mine, otherUnion));
    if (overlap / mineLen <= SIBLING_OVERLAP_RATIO) continue;
    groups += 1;
    const derived = deriveChildSpans(linear, { evidence: n.evidence || [] }, parentSpans, textByUnit, { ...tune, contextCap: 0 });
    if (derived.spans.length && core.spanLengthOf(derived.spans) < mineLen) {
      n.sourceSpans = derived.spans;
      n.unitAnchors = derived.anchors;
      n.spanStats = { ...(n.spanStats || {}), siblingSubdivided: true, spanBeforeSubdivide: mineLen };
      changed += 1;
    }
  }
  if (groups) metrics.siblingSpanOverlapGroups = (metrics.siblingSpanOverlapGroups || 0) + groups;
  if (changed) metrics.siblingSpanSubdivided = (metrics.siblingSpanSubdivided || 0) + changed;
  return changed;
}

/**
 * v48.12 P1：覆盖审计（对**每个已分析节点含 scope root**）
 * - root：审计面 = coverageUniverse − ⋃ownedSpans(一级已分析节点)（§3.2；root 自身不 expand）
 * - 其他：residual = node.sourceSpans − ⋃children ownedSpans
 * - 残余分类：transition（不建节点）/ structural（入 gap-fill，受预算与不变检测约束）
 * @returns {{ structural: string[][], transitionChars: number, structuralChars: number, tasks: number }}
 */
function runCoverageAudit(assembled, nodeById, metrics, tune, hooks) {
  const linear = assembled.linear;
  if (!linear) return { structural: [], transitionChars: 0, structuralChars: 0, tasks: 0 };
  const nodes = assembled.raw.nodes;
  const byParent = new Map();
  for (const n of nodes) {
    const k = n.parentId || "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  const owned = (n) => (n.spanOrigin === "evidence" ? core.normalizeSpans(n.sourceSpans || []) : []);
  const structural = [];
  let transitionChars = 0;
  let structuralChars = 0;
  let tasks = 0;
  const scopes = [];
  for (const n of nodes) {
    const kids = byParent.get(n.id) || [];
    if (n.id === "root") {
      // 根：审计面 = 全文 − 一级已分析节点（含播种分析的 TOC 节点）的覆盖
      scopes.push({ node: n, spans: [[0, linear.length]], kids, isRoot: true });
    } else if (kids.length) {
      // **只审计有子节点的内部节点**（v48.12 P1 修正）：叶的自身 span 就是它的内容（已是终态），
      // 把叶的 span 当残余会让每个叶都多发一次补漏调用——审计要问的是「父节点的孩子覆盖住了父吗」
      scopes.push({ node: n, spans: core.normalizeSpans(n.sourceSpans || []), kids, isRoot: false });
    }
  }
  for (const sc of scopes) {
    const kidSpans = sc.kids.flatMap((k) => (sc.isRoot ? core.normalizeSpans(k.sourceSpans || []) : k.sourceSpans || []));
    const residual = core.subtractSpans(sc.spans, kidSpans);
    if (!residual.length) continue;
    const cls = classifyResidual(residual, linear);
    transitionChars += core.spanLengthOf(cls.transition);
    const stLen = core.spanLengthOf(cls.structural);
    if (!stLen) continue;
    // 不变检测（§3.2 rev.2）：输入与产出都没变 → 立即止损，不再发第 N 轮
    const sig = sha256(spanKeyOf(cls.structural) + "|" + spanKeyOf(core.normalizeSpans(kidSpans)));
    if (sc.node.coverageAuditSig === sig) {
      // 输入与产出都没变 → 该区段已被证明「再补也不变」，属已处置（只留痕，不强制 partial）
      metrics.gapFillStalled = (metrics.gapFillStalled || 0) + 1;
      continue;
    }
    sc.node.coverageAuditSig = sig;
    const rounds = (sc.node.spanStats && sc.node.spanStats.gapFillRounds) || 0;
    if (stLen < tune.gapMinChars) {
      // 低于可行动阈值：记账但不发调用、不强制 partial（碎片不值得一次调用）
      metrics.structuralLeftoverChars = (metrics.structuralLeftoverChars || 0) + stLen;
      metrics.structuralLeftoverCount = (metrics.structuralLeftoverCount || 0) + cls.structural.length;
      continue;
    }
    if (rounds >= tune.gapFillMaxRounds) {
      // 已试满轮次仍有结构性残余 → 未处置缺口（诚实记 partial，不伪装 complete）
      metrics.coverageGapChars += stLen;
      metrics.coverageGapCount = (metrics.coverageGapCount || 0) + cls.structural.length;
      if (!sc.node.stopReason && !sc.isRoot) sc.node.stopReason = "coverage_gap";
      continue;
    }
    structural.push(cls.structural);
    structuralChars += stLen;
    tasks += 1;
    sc.node.spanStats = { ...(sc.node.spanStats || {}), gapFillRounds: rounds + 1 };
    hooks.enqueueGapFill(sc.node, sc.isRoot ? 0 : (hooks.depthOf(sc.node.id) || 0), cls.structural);
  }
  return { structural, transitionChars, structuralChars, tasks };
}

/** v48.12 P0：落库用 span 索引（含来源标记/停止原因/残余），与覆盖摘要一起写进 structure_json */
function buildSpanIndex(assembled) {
  const index = new Map();
  for (const n of assembled.raw.nodes) {
    index.set(n.id, {
      sourceSpans: core.normalizeSpans(n.sourceSpans || []),
      spanOrigin: n.spanOrigin || null,
      stopReason: n.stopReason || null,
      sourceKind: n.sourceKind || null,
      expandable: n.expandable === true,
      residualChars: Number.isFinite(n.residualChars) ? n.residualChars : null,
      gapFillRounds: (n.spanStats && n.spanStats.gapFillRounds) || 0
    });
  }
  return index;
}

/** v48.12 P0：覆盖摘要（三口径，§3.1 rev.3）——只测量，不影响生成 */
function coverageSummaryOf(assembled) {
  const linear = assembled.linear;
  if (!linear) return null;
  const U = linear.length;
  const owned = (n) => (n.spanOrigin === "evidence" ? n.sourceSpans || [] : []);
  const allUnion = core.normalizeSpans(assembled.raw.nodes.flatMap((n) => owned(n)));
  const byParent = new Map();
  for (const n of assembled.raw.nodes) {
    const k = n.parentId || "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  const leaves = assembled.raw.nodes.filter((n) => n.id !== "root" && !(byParent.get(n.id) || []).length);
  const leafUnion = core.normalizeSpans(leaves.flatMap((n) => owned(n)));
  const evUnion = core.normalizeSpans(
    assembled.raw.nodes.flatMap((n) => (n.evidence || []).map((e) => core.evidenceSpanOf(linear, e)).filter(Boolean))
  );
  const pct = (x) => Math.round((x / Math.max(1, U)) * 1000) / 1000;
  return {
    universeChars: U,
    structureCoverage: pct(core.spanLengthOf(allUnion)),
    leafCoverage: pct(core.spanLengthOf(leafUnion)),
    evidenceTextCoverage: pct(core.spanLengthOf(evUnion)),
    unassignedChars: U - core.spanLengthOf(allUnion),
    linearizationVersion: core.LINEARIZATION_VERSION
  };
}

/** 首波深挖计划（§3.9 阶段 B 预览）：**精确**统计第 1 层待深挖节点数与计划调用数（不预测第 2 层以后） */
function firstWavePlan(assembled, tune) {
  const nodes = assembled.raw.nodes;
  const byParent = new Map();
  for (const n of nodes) {
    const pk = n.parentId || "";
    if (!byParent.has(pk)) byParent.set(pk, []);
    byParent.get(pk).push(n);
  }
  let firstWave = 0;
  let plannedCalls = 0;
  let spanChars = 0;
  for (const n of nodes) {
    if (n.id === "root") continue;
    const kids = byParent.get(n.id) || [];
    if (n.expandable !== true || kids.length) continue;
    const spans = core.normalizeSpans(n.sourceSpans || []);
    if (!spans.length) continue;
    firstWave += 1;
    spanChars += core.spanLengthOf(spans);
    plannedCalls += Math.max(1, spanJobsFor(assembled.linear, spans, tune).length);
  }
  return { firstWaveNodes: firstWave, plannedCalls, spanChars, maxPayloadChars: tune.maxPayloadChars, expandDepth: tune.expandDepth };
}

/** 阶段 2：初装 TOC 层——TOC 分析节点（含 section 单层 children 递归容错）；merge/global 稍后 attach
 *  v48.11：每个节点带 spanSeed（TOC 覆盖区间）或由自身证据推导 sourceSpans（钳制到产生它的调用区间内）。 */
function assembleTocLayer(params, plan, sectionCalls, cacheContent, tune, metrics) {
  const rawNodes = [];
  const mapIdOf = new Map();
  let seq = 0;
  const nextId = () => `n${++seq}`;
  const linear = plan.linear;
  const byId = () => new Map(rawNodes.map((n) => [n.id, n]));
  const mkNode = (id, parentId, analysis, unitAnchors, spanSeed) => {
    rawNodes.push({
      id,
      parentId: parentId || null,
      title: String(analysis.title || "（未命名）").slice(0, 80),
      authorialRole: analysis.authorialRole || null,
      centralQuestion: analysis.centralQuestion || null,
      mainMove: analysis.mainMove || null,
      progression: analysis.progression || null,
      relationToParent: analysis.relationToParent || null,
      relationToSiblings: analysis.relationToSiblings || null,
      groupingBasis: analysis.groupingBasis || null,
      unitAnchors: unitAnchors || [],
      sourceSpans: spanSeed ? core.normalizeSpans([spanSeed]) : [],
      spanOrigin: spanSeed ? "analysis" : "evidence", // v48.12 P0：覆盖统计只认 evidence 推导的 span
      evidence: Array.isArray(analysis.evidence) ? analysis.evidence : [],
      compositionalEvidence: Array.isArray(analysis.compositionalEvidence) ? analysis.compositionalEvidence : [],
      childIds: [],
      expandable: analysis.expandable === true,
      stopReason: analysis.stopReason || null
    });
    return id;
  };
  rawNodes.push({
    id: "root",
    parentId: null,
    title: params.title || "材料知识导图",
    authorialRole: null,
    unitAnchors: [],
    // 根的作用域 = 全文（其覆盖正确性由残余账/gap-fill 检验；root 自身不参与深挖）
    sourceSpans: linear ? [[0, linear.length]] : [],
    spanOrigin: "analysis",
    evidence: [],
    compositionalEvidence: [],
    childIds: [],
    expandable: false,
    stopReason: null
  });
  const keyToEntry = new Map(plan.model.flat.map((f) => [plan.model.nodeKeyOf(f), f]));
  const analyzedFlat = plan.model.flat.filter((f) => plan.analyzedKeys.has(plan.model.nodeKeyOf(f)));
  for (const f of analyzedFlat) mapIdOf.set(plan.model.nodeKeyOf(f), nextId());
  for (const f of analyzedFlat) {
    const k = plan.model.nodeKeyOf(f);
    const id = mapIdOf.get(k);
    const parentKey = f.parent ? plan.model.nodeKeyOf(f.parent) : null;
    const parentId = parentKey && plan.analyzedKeys.has(parentKey) ? mapIdOf.get(parentKey) : "root";
    const entry = keyToEntry.get(k);
    const content = cacheContent.get(k);
    const isGroupWrap = content && Array.isArray(content.nodes);
    const analysis = isGroupWrap ? { title: entry.node.label } : content || { title: entry.node.label };
    const range = plan.model.nodeRange.get(k) || [0, 0];
    const seed = linear ? core.spanOfUnitRange(linear, range[0], range[1]) : null;
    mkNode(id, parentId, analysis, [], seed);
  }
  for (const call of sectionCalls) {
    const content = cacheContent.get(call.nodeKeys[0]);
    const arr = content && Array.isArray(content.nodes) ? content.nodes : [];
    const callSpan = call.span && call.span.length ? call.span : linear ? [core.spanOfUnitRange(linear, 0, linear.units.length)] : [];
    const anchors = unitAnchorsOfSpans(linear, callSpan);
    call.nodeKeys.forEach((k, i) => {
      const own = arr[i] || null;
      const mapId = mapIdOf.get(k);
      if (!mapId) return;
      const node = rawNodes.find((n) => n.id === mapId);
      if (own && node) {
        if (own.title) node.title = String(own.title).slice(0, 80);
        if (own.authorialRole) node.authorialRole = own.authorialRole;
        if (own.centralQuestion) node.centralQuestion = own.centralQuestion;
        if (own.mainMove) node.mainMove = own.mainMove;
        if (own.progression) node.progression = own.progression;
        if (own.relationToParent) node.relationToParent = own.relationToParent;
        node.evidence = core.locateNodeEvidence({ unitAnchors: anchors, evidence: Array.isArray(own.evidence) ? own.evidence : [] }, plan.textByUnit);
        node.unitAnchors = anchors;
        // 该调用分析过的区间并入节点作用域（分片多次调用 → 逐片累积）
        node.sourceSpans = core.normalizeSpans([...(node.sourceSpans || []), ...callSpan]);
        node.expandable = own.expandable === true;
        node.stopReason = own.stopReason || null;
      }
      if (own) {
        const expand = (pid, list) => {
          for (const ch of Array.isArray(list) ? list : []) {
            const derived = deriveChildSpans(linear, ch, callSpan, plan.textByUnit, tune);
            const cid = nextId();
            rawNodes.push({
              id: cid,
              parentId: pid || null,
              title: String(ch.title || "（未命名）").slice(0, 80),
              authorialRole: ch.authorialRole || null,
              centralQuestion: ch.centralQuestion || null,
              mainMove: ch.mainMove || null,
              progression: ch.progression || null,
              relationToParent: ch.relationToParent || null,
              relationToSiblings: ch.relationToSiblings || null,
              groupingBasis: ch.groupingBasis || null,
              unitAnchors: derived.anchors,
              sourceSpans: derived.spans,
              spanOrigin: "evidence",
              evidence: derived.evidence,
              compositionalEvidence: [],
              childIds: [],
              expandable: derived.spans.length ? ch.expandable === true : false,
              stopReason: derived.spans.length ? ch.stopReason || null : "scope_conflict",
              sourceKind: "section_child"
            });
            const p = rawNodes.find((n) => n.id === pid);
            if (p) p.childIds.push(cid);
            expand(cid, ch.children);
          }
        };
        expand(mapId, own.children);
      }
    });
  }
  // 先序钳制：子节点作用域不得越出父节点（§3.1 ④；root 之外一切节点都在此收敛）
  // 注意：此阶段 childIds 尚为空（校验器才回填），故按 parentId 建索引遍历
  const byParent = new Map();
  for (const n of rawNodes) {
    const pk = n.parentId || "";
    if (!byParent.has(pk)) byParent.set(pk, []);
    byParent.get(pk).push(n);
  }
  const rootNode = rawNodes.find((n) => n.id === "root");
  const walk = (n, parentSpans) => {
    if (n.id !== "root") {
      const clipped = parentSpans && parentSpans.length ? core.intersectSpans(n.sourceSpans || [], parentSpans) : core.normalizeSpans(n.sourceSpans || []);
      n.sourceSpans = clipped;
      if (!clipped.length) {
        n.expandable = false;
        if (!n.stopReason) n.stopReason = "scope_conflict";
      }
    }
    const kids = byParent.get(n.id) || [];
    for (const cn of kids) walk(cn, n.sourceSpans);
    // 父节点主张由子节点证据组合支撑（§4.19-5）：TOC 中间节点即便 merge/global 未跑（预算/取消/跳过），
    // 也不因「无直接证据」被校验器删除而级联带走整棵子树
    if (!(n.evidence || []).length && !(n.compositionalEvidence || []).length && kids.length) {
      n.compositionalEvidence = kids.map((k) => k.id);
    }
  };
  if (rootNode) walk(rootNode, null);
  // v48.12 P2 修法1：章节层兄弟 span 重叠 → 本地细分（不收窄就删除，只把膨胀的作用域收回各自片段）
  if (metrics) {
    for (const p2 of rawNodes) {
      const kids = byParent.get(p2.id) || [];
      if (kids.length > 1) subdivideOverlappingSiblings(p2, kids, linear, plan.textByUnit, tune, metrics);
    }
  }
  return {
    raw: { title: params.title || "材料知识导图", nodes: rawNodes },
    mapIdOf,
    textByUnit: plan.textByUnit,
    linear,
    nextId,
    seqOf: () => seq
  };
}

/** 阶段 6 前置：merge/global 产出回填（compositional 引用 + merge 证据与可选 children 细化） */
function attachMergeGlobal(assembled, mergeCalls, globalCalls, cacheContent, scopeCtx) {
  const { raw, mapIdOf } = assembled;
  for (const call of [...mergeCalls, ...globalCalls]) {
    const mapId = mapIdOf.get(call.nodeKey);
    const node = raw.nodes.find((n) => n.id === mapId);
    const content = cacheContent.get(call.nodeKey);
    if (!node || !content) continue;
    const compositional = (call.childKeys || []).map((ck) => mapIdOf.get(ck)).filter(Boolean);
    if (compositional.length) node.compositionalEvidence = compositional;
    if (content.title) node.title = String(content.title).slice(0, 80);
    if (content.authorialRole) node.authorialRole = content.authorialRole;
    if (content.centralQuestion) node.centralQuestion = content.centralQuestion;
    if (content.progression) node.progression = content.progression;
    if (content.groupingBasis) node.groupingBasis = content.groupingBasis;
    if (content.relationToParent) node.relationToParent = content.relationToParent;
    if (call.runKind === "merge") {
      const anchors = Array.isArray(call.blocks) ? call.blocks : [];
      node.unitAnchors = anchors;
      node.evidence = scopeCtx && scopeCtx.linear
        ? core.locateNodeEvidence({ unitAnchors: anchors, evidence: Array.isArray(content.evidence) ? content.evidence : [] }, scopeCtx.textByUnit)
        : Array.isArray(content.evidence) ? content.evidence : [];
      // v48.11：merge 细化 children 也按证据推导 span（钳制在父节点作用域内）
      const parentSpans = (node.sourceSpans && node.sourceSpans.length ? node.sourceSpans : node.sourceSpans) || [];
      const callSpan = parentSpans.length ? parentSpans : scopeCtx && scopeCtx.linear ? [[0, scopeCtx.linear.length]] : [];
      let mSeq = raw.nodes.length;
      const expand = (pid, list) => {
        for (const ch of Array.isArray(list) ? list : []) {
          const derived = scopeCtx && scopeCtx.linear && scopeCtx.tune
            ? deriveChildSpans(scopeCtx.linear, ch, callSpan, scopeCtx.textByUnit, scopeCtx.tune)
            : { spans: [], conflicts: 0, evidence: Array.isArray(ch.evidence) ? ch.evidence : [], anchors };
          const cid = `m${++mSeq}`;
          raw.nodes.push({
            id: cid,
            parentId: pid || null,
            title: String(ch.title || "（未命名）").slice(0, 80),
            authorialRole: ch.authorialRole || null,
            centralQuestion: ch.centralQuestion || null,
            mainMove: ch.mainMove || null,
            progression: ch.progression || null,
            relationToParent: ch.relationToParent || null,
            relationToSiblings: ch.relationToSiblings || null,
            groupingBasis: ch.groupingBasis || null,
            unitAnchors: derived.anchors && derived.anchors.length ? derived.anchors : anchors,
            sourceSpans: derived.spans,
            spanOrigin: "evidence",
            evidence: derived.evidence,
            compositionalEvidence: [],
            childIds: [],
            expandable: derived.spans.length ? ch.expandable === true : false,
            stopReason: derived.spans.length ? ch.stopReason || null : "scope_conflict"
          });
          const p = raw.nodes.find((n) => n.id === pid);
          if (p) p.childIds.push(cid);
          expand(cid, ch.children);
        }
      };
      expand(mapId, content.children);
    }
  }
}

function stripEvidenceForPrompt(node) {
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    authorialRole: node.authorialRole,
    groupingBasis: node.groupingBasis,
    progression: node.progression,
    evidence: (node.evidence || []).map((e) => e.quote).slice(0, 3)
  };
}

function toRawNode(node) {
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    authorialRole: node.authorialRole,
    centralQuestion: node.centralQuestion,
    mainMove: node.mainMove,
    progression: node.progression,
    relationToParent: node.relationToParent,
    relationToSiblings: node.relationToSiblings,
    groupingBasis: node.groupingBasis,
    unitAnchors: node.unitAnchors,
    evidence: node.evidence,
    compositionalEvidence: node.compositionalEvidence
  };
}

function applyEditorialOps(nodes, ops) {
  const warnings = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const op of ops || []) {
    try {
      if (op.op === "rename" && byId.has(op.id) && typeof op.title === "string" && op.title.trim()) {
        byId.get(op.id).title = op.title.trim().slice(0, 80);
      } else if (op.op === "delete" && byId.has(op.id)) {
        const n = byId.get(op.id);
        const kids = nodes.filter((x) => x.parentId === n.id);
        if (!kids.length) {
          nodes = nodes.filter((x) => x.id !== n.id);
          byId.delete(n.id);
        } else warnings.push(`delete ${n.id} 跳过：非叶子`);
      } else if (op.op === "merge" && byId.has(op.keepId) && byId.has(op.dropId)) {
        const keep = byId.get(op.keepId);
        const drop = byId.get(op.dropId);
        if (keep.parentId === drop.parentId && keep.id !== drop.id) {
          for (const x of nodes) {
            if (x.parentId === drop.id) x.parentId = keep.id;
          }
          keep.evidence = [...(keep.evidence || []), ...(drop.evidence || [])];
          nodes = nodes.filter((x) => x.id !== drop.id);
          byId.delete(drop.id);
        } else warnings.push(`merge ${op.keepId}/${op.dropId} 跳过：非同级同父`);
      } else if (op.op === "reparent" && byId.has(op.id) && byId.has(op.newParentId)) {
        // 成环检查
        let cur = byId.get(op.newParentId);
        let ok = true;
        while (cur) {
          if (cur.id === op.id) {
            ok = false;
            break;
          }
          cur = byId.get(cur.parentId);
        }
        if (ok) byId.get(op.id).parentId = op.newParentId;
        else warnings.push(`reparent ${op.id} 跳过：会成环`);
      }
    } catch {
      /* 单条 op 失败不影响整体 */
    }
  }
  return { nodes, warnings };
}

// ---------- 完成落库（含 remap） ----------

function finalizeMap(ctx, runId, params, nodes, title, usageAcc, opts = {}) {
  const stats = opts.stats || null;
  const prevLedgerForOutput = opts.prevLedger || null;
  const spanIndex = opts.spanIndex || null;
  const coverageSummary = opts.coverageSummary || null;
  const sha = (s) => sha256(s);
  for (const n of nodes) {
    // 逐条证据落 quoteHash（D41-④：quoteHash + matchStart/matchEnd 随图入库，快照文本不入库）
    n.evidence = (n.evidence || []).map((e) => ({ ...e, quoteHash: sha(e.quote) }));
    n.quoteHashes = n.evidence.map((e) => e.quoteHash);
  }
  const prevActive = ctx.db.getActiveMaterialMap(params.documentId, params.scopeAnchor || "book");
  let remap = null;
  if (prevActive && prevActive.structure && Array.isArray(prevActive.structure.nodes)) {
    const oldNodes = prevActive.structure.nodes.map((n) => ({
      id: n.id,
      unitAnchors: n.unitAnchors || [],
      quoteHashes: n.quoteHashes || (n.evidence || []).map((e) => e.quoteHash).filter(Boolean),
      title: n.title
    }));
    remap = Object.fromEntries(core.remapNodes(oldNodes, nodes));
  }
  const structure = {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    title: title || params.title || "材料知识导图",
    rootNodeId: "root",
    // v48.12 P0：节点作用域落库（sourceSpans 此前不落库，导致离线审计只能反推）
    nodes: nodes.map((n) => {
      const sp = spanIndex ? spanIndex.get(n.id) : null;
      return {
        ...n,
        quoteHashes: undefined,
        sourceSpans: sp ? sp.sourceSpans : undefined,
        spanOrigin: sp ? sp.spanOrigin : undefined,
        expandable: sp ? sp.expandable : undefined,
        stopReason: sp ? sp.stopReason : n.stopReason,
        residualChars: sp ? sp.residualChars : undefined,
        gapFillRounds: sp ? sp.gapFillRounds : undefined
      };
    }),
    // v48.12 P0：覆盖摘要（三口径；structureCoverage 只计 evidence 推导 span，排除播种的分析范围）
    coverageSummary,
    edges: [],
    // 制卡整书把握（§4.19-10）：引擎在落库时派生有界结构摘要（≤1200 字），渲染层直读无需引入 core
    summaryText: core.deriveStructureSummary({ title: title || params.title || "材料知识导图", nodes }, 1200)
  };
  const statusOverride = opts.statusOverride || null; // v48.11：section_ready（首层就绪，深挖待续跑）
  const partialReason = opts.partialReason || null; // v48.11：partial 归因（call_budget / call_failed）
  const partial = !!(opts.budgetHit || partialReason);
  // v48.12 修复：续跑/深挖完成时**更新**本 run 早先落下的那一行（首层就绪时插入的那行），
  // 而不是再插一行同标题版本——否则每次生成都在历史版本里留两条，删一条后另一条看着像「复活」。
  const reuseId = (opts.reuseMapId && ctx.db.getMaterialMap(opts.reuseMapId)) ? opts.reuseMapId : null;
  // v48.13 发布模型（Published / Candidate）——候选不得顶掉已发布版本。
  // 旧行为 `isActive = statusOverride === "section_ready" ? true : !partial` 让首层中间态无条件激活。
  // 真实库现场（2026-09-19）：85 节点 complete 版本被本次 run 的 10 节点首层顶成 inactive，
  // 而本次 run 随后 review_failed —— 用户看到「图从 85 个节点缩回 10 个 + 语义评审未通过」。
  // 新规则：① 已有**别处**发布的版本 → section_ready 只作候选（不激活），待续跑完成才发布；
  //         ② 无任何已发布版本 → 首个 section_ready 作 provisional 发布（状态由 run.status 可辨）；
  //         ③ partial（预算触顶/失败）→ 永不发布（保持旧行为：不伪装完整）。
  const publishedElsewhere = !!(prevActive && prevActive.id !== reuseId);
  const publishNow = statusOverride === "section_ready" ? !publishedElsewhere : !partial;
  const saved = (reuseId ? ctx.db.updateMaterialMap(reuseId, {
    documentId: params.documentId,
    scopeAnchor: params.scopeAnchor || "book",
    scopeKind: params.scopeAnchor && params.scopeAnchor !== "book" ? "chapter" : "book",
    granularity: params.granularity,
    title: structure.title,
    structure,
    sourceRevisionHash: sha(JSON.stringify(nodes.map((n) => n.unitAnchors || []).flat())),
    promptVersion: promptVersion(ctx, "material-map-section"),
    generatorVersion: GENERATOR_VERSION,
    nodeRemap: remap,
    // 预算触顶 → 存为未激活版本（旧 active 保持，不伪装完整生成）；用户可在历史版本手动激活
    // v48.13：首层候选不再无条件激活；只有「无别处已发布版本」或续跑完成才发布（见 publishNow）
    isActive: publishNow
  }) : ctx.db.saveMaterialMap({
    documentId: params.documentId,
    scopeAnchor: params.scopeAnchor || "book",
    scopeKind: params.scopeAnchor && params.scopeAnchor !== "book" ? "chapter" : "book",
    granularity: params.granularity,
    title: structure.title,
    structure,
    sourceRevisionHash: sha(JSON.stringify(nodes.map((n) => n.unitAnchors || []).flat())),
    promptVersion: promptVersion(ctx, "material-map-section"),
    generatorVersion: GENERATOR_VERSION,
    nodeRemap: remap,
    isActive: publishNow
  }));
  const finalLedger = ledgerOf(stats, prevLedgerForOutput);
  ctx.db.updateMaterialMapRun(runId, {
    status: statusOverride || (partial ? "partial" : "completed"),
    callsDone: finalLedger.successfulCalls || undefined,
    stage: "done",
    actualPromptTokens: usageAcc.prompt,
    actualCompletionTokens: usageAcc.completion,
    output: {
      mapId: saved.id,
      nodeCount: nodes.length,
      remapped: remap ? Object.keys(remap).length : 0,
      // v48.13：本次产物是「已发布」还是「候选」（候选=未顶掉旧图，等续跑完成再发布）
      published: publishNow,
      ...(publishNow ? {} : { candidate: true, heldByPublishedMapId: publishedElsewhere ? prevActive.id : null }),
      completeness:
        statusOverride === "section_ready"
          ? "section_ready"
          : partial
            ? partialReason
              ? `partial:${partialReason}`
              : "partial:call_budget"
            : "complete",
      metrics: opts.metrics || null,
      ledger: finalLedger,
      scopeTuning: opts.tune ? { maxPayloadChars: opts.tune.maxPayloadChars, expandDepth: opts.tune.expandDepth, gapFillMaxRounds: opts.tune.gapFillMaxRounds } : null
    }
  });
  ctx.broadcast({
    runId,
    documentId: params.documentId,
    title: params.title || structure.title || null,
    stage: statusOverride || (partial ? "partial" : "completed"),
    mapId: saved.id,
    published: publishNow
  });
  return {
    status: statusOverride || (partial ? "partial" : "completed"),
    mapId: saved.id,
    nodeCount: nodes.length,
    remap,
    runId,
    published: publishNow,
    metrics: opts.metrics || null
  };
}

module.exports = {
  GENERATOR_VERSION,
  RUN_KIND_SCOPE,
  EST_OUTPUT_TOKENS,
  buildCallPayloads,
  finalizeUser,
  preview,
  generate,
  repairConfirm,
  cancelRun,
  parseJsonLoose,
  applyEditorialOps,
  normalizeCallOutput,
  assembleTocLayer,
  attachMergeGlobal
};
