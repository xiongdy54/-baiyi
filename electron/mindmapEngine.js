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

const GENERATOR_VERSION = "m15r-engine-2"; // v48.5 批B：expand 深挖管线（版本变更即整体缓存失效，宁重算不误复用）
const EXPAND_VARIANT = "expand-1"; // 深挖调用变体（折入 modelConfigHash——变体或模板改动整体失效）
const MAX_EXPAND_DEPTH = 8; // 安全上限（非正常终止；触达即 stopReason=max_depth 留痕）
const REVIEW_SHARD_NODES = 120; // 语义评审分片阈值（>120 节点按顶层分支递归分片，不截断树不删证据）
// 输出 token 估算（每类调用常数；估算口径，实际以 provider usage 为准，§4.19-8）
const EST_OUTPUT_TOKENS = { section: 900, merge: 700, global: 1000, editorial: 800, review: 600 };
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

// ---------- 计划装配（preview 与 send 共用；§4.19-8 同一 payload builder） ----------

/**
 * @param params { title, tocItems:[{anchor,label,children}], unitAnchors:[], textByUnit:{anchor:text},
 *                 scopeAnchor("book"|锚), granularity("overview"|"standard"|"detailed"), force? }
 * @returns { plan, model, error? } plan.calls = [{ runKind, nodeKey, label, system, user, chars, cacheKey }]
 */
function buildCallPayloads(params, promptOf) {
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
  const nodeTempId = new Map(); // 分析节点 key → 临时编号 n1..（merge 输入用；跨调用一致）
  let tempSeq = 0;
  // v48.8：超长单元按段落边界分片（Task 06 契约）——整本无章节书不再一次塞全文（模型长时挂起根因）
  const SECTION_CHUNK_CHARS = 8000;
  for (const g of groups.values()) {
    tempSeq += 1;
    const gTempId = `n${tempSeq}`;
    for (const k of g.nodeKeys) nodeTempId.set(k, gTempId);
    const fullText = g.units.map((u) => textByUnit.get(u) || "").join("\n");
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
    plan: { calls, scopeKey, nodeTempId, model, textByUnit, analyzedKeys },
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
  const { plan, error } = buildCallPayloads(params, (scope) => templateText(ctx, scope));
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
    model
  };
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
  const usageAcc = { prompt: 0, completion: 0 };
  const cacheContent = new Map(); // nodeKey → 调用产出（组调用每成员共享）
  let callsMade = 0;
  let budgetHit = false;

  // 单次调用执行（缓存命中跳过；坏 JSON 一次 STRUCTURE_FORMAT_REPAIR；usage 累计；取消/预算检查）
  const executeCall = async (call) => {
    const hit = !params.force && ctx.db.getMaterialMapShard(call.cacheKey);
    if (hit) return { content: hit.content, cached: true };
    if (cancelled()) return { cancelled: true };
    ctx.broadcast({ runId: run.id, stage: "waiting_model", label: call.label || call.runKind, calls: callsMade, budget });
    let { text, usage } = await chatOnce(ctx, call.system, call.user, run.id);
    usageAcc.prompt += usage.prompt;
    usageAcc.completion += usage.completion;
    let parsed = parseJsonLoose(text);
    if (!parsed) {
      const repairUser = `【格式修复】\n下面的内容不是合法 JSON。请只把它转换为合法 JSON：不得增加或删除任何节点与字段，不得修改任何语义内容。\n\n【原输出】\n${text.slice(0, 20000)}`;
      const rep = await chatOnce(ctx, call.system + "\n\n【格式修复模式】收到【格式修复】块时：只转换格式，不得增删改语义。", repairUser, run.id);
      usageAcc.prompt += rep.usage.prompt;
      usageAcc.completion += rep.usage.completion;
      parsed = parseJsonLoose(rep.text);
      if (!parsed) return { jsonFail: true };
    }
    callsMade += 1;
    const content = normalizeCallOutput(call.runKind, parsed);
    ctx.db.saveMaterialMapShard({ ...call.cacheKey, content, chars: call.chars || null, tokenUsed: usage.prompt + usage.completion });
    return { content };
  };

  try {
    ctx.db.updateMaterialMapRun(run.id, { status: "estimating", provider, model, modelConfigHash: cfgHash });
    const prep = buildCallPayloads(params, (scope) => templateText(ctx, scope));
    if (prep.error) {
      ctx.db.updateMaterialMapRun(run.id, { status: "failed_validation", errorCode: "prepare", errorText: prep.error });
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
    ctx.broadcast({ runId: run.id, stage: "running", done: 0, total: est.newCalls, calls: 0, budget });

    // ---------- 阶段 1：section 首层（expandable/stopReason 由此产生；仅 expandable=true 的叶入深挖队） ----------
    for (const call of sectionCalls) {
      const r = await executeCall(call);
      if (r.cancelled) return finishCancelled(run.id);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      // v48.8：按调用键写（分片各自独立）；阶段 1.5 再按组合并展开到 nodeKeys
      cacheContent.set(call.nodeKey, r.content);
      ctx.db.updateMaterialMapRun(run.id, { callsDone: callsMade });
      ctx.broadcast({ runId: run.id, stage: "running", done: callsMade, total: est.newCalls, calls: callsMade, budget });
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

    // ---------- 阶段 2：初装 TOC 层（TOC 节点 + section 单层 children） ----------
    const assembled = assembleTocLayer(params, plan, sectionCalls, cacheContent);
    const nodeById = new Map(assembled.raw.nodes.map((n) => [n.id, n]));
    nodeByIdLookup = (id) => nodeById.get(id) || null;

    // ---------- 阶段 3：expand 逐节点深挖（仅 expandable=true 的叶入队；max_depth/call_budget 为非正常终止） ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "expand" });
    const metrics = { expandCalls: 0, stopReasons: {} };
    const bumpStop = (reason) => {
      const k = reason || "unexamined";
      metrics.stopReasons[k] = (metrics.stopReasons[k] || 0) + 1;
    };
    const queue = [];
    const queued = new Set();
    const enqueue = (node, depth) => {
      const fp = expandFingerprint(node, depth);
      if (queued.has(fp)) return;
      queued.add(fp);
      queue.push({ fp, node, depth });
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
      // 仅深挖「无子节点的叶」：section 已给出 children 的节点以该层为准（其子各自按 expandable 入队），
      // 否则 expand 输出与 section children 双挂树（重复节点——实测抓到）
      if (n.expandable === true && (n.childIds || []).length === 0) {
        if (d >= MAX_EXPAND_DEPTH) { n.stopReason = "max_depth"; bumpStop("max_depth"); }
        else enqueue(n, d);
      } else if (d > 0) bumpStop(n.stopReason || "atomic_structure");
    }
    while (queue.length) {
      if (cancelled()) return finishCancelled(run.id);
      if (callsMade >= budget) {
        budgetHit = true;
        for (const q of queue) { q.node.stopReason = "call_budget"; bumpStop("call_budget"); }
        queue.length = 0;
        break;
      }
      const job = queue.shift();
      const text = (job.node.unitAnchors || []).map((a) => assembled.textByUnit.get(a) || "").filter(Boolean).join("\n");
      if (!text) {
        job.node.stopReason = "textually_trivial";
        bumpStop("textually_trivial");
        continue;
      }
      const upper = ancestorTitles(nodeById, job.node);
      // v48.8：深挖同样分片——超长节点每片一调，children 拼接、expandable=any
      const chunks = text.length > 8000 ? core.splitByParagraphs(text, 8000) : [{ text }];
      const childAcc = [];
      let anyExpandable = false;
      let stopAcc = null;
      let expandFailed = false;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const chunkHeader = chunks.length > 1 ? `【原文分片】第 ${ci + 1} / ${chunks.length} 片（同一节点按段落边界切分；本片只依据本片文本）\n` : "";
        const user =
          `【材料】${params.title || "材料知识导图"}\n` +
          `【覆盖粒度】detailed（详细）——逐节点深挖模式\n` +
          `【结构路径】${upper}\n` +
          `【深挖】以下文本属于节点「${job.node.title}」。已有上层结构如【结构路径】所示、本节点之下暂无更细结构。请给出它的直接子结构（单层 children），并按原子性判断规则给出输出的 expandable/stopReason。避免复述上层已表达的内容。\n\n` +
          chunkHeader +
          `【原文·${(job.node.unitAnchors || ["deep"])[0]}】\n${chunk.text}\n【/原文】`;
        const fpCi = sha256(job.fp + "|" + ci + "|" + chunk.text);
        const call = {
          runKind: "section",
          nodeKey: `exp:${fpCi.slice(0, 16)}`,
          label: chunks.length > 1 ? `深挖 · ${job.node.title}（片 ${ci + 1}/${chunks.length}）` : `深挖 · ${job.node.title}`,
          nodeKeys: [job.node.id],
          system: templateText(ctx, RUN_KIND_SCOPE.section),
          user,
          chars: user.length,
          sourceChars: chunk.text.length,
          cacheKey: {
            ...common,
            unitAnchor: `exp:${fpCi.slice(0, 16)}`,
            runKind: "expand",
            promptScope: RUN_KIND_SCOPE.section,
            promptVersion: promptVersion(ctx, RUN_KIND_SCOPE.section),
            textHash: sha256(job.fp + "|" + ci + "|" + chunk.text)
          }
        };
        const r = await executeCall(call);
        if (r.cancelled) return finishCancelled(run.id);
        if (r.budget) {
          budgetHit = true;
          job.node.stopReason = "call_budget";
          bumpStop("call_budget");
          for (const q of queue) { q.node.stopReason = "call_budget"; bumpStop("call_budget"); }
          queue.length = 0;
          expandFailed = true;
          break;
        }
        if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
        metrics.expandCalls += 1;
        const out = r.content && Array.isArray(r.content.nodes) ? r.content.nodes : [r.content];
        const own = out[0] || {};
        childAcc.push(...(Array.isArray(own.children) ? own.children : []));
        if (own.expandable === true) anyExpandable = true;
        else stopAcc = stopAcc || own.stopReason || "atomic_structure";
      }
      if (expandFailed) break;
      job.node.expandable = anyExpandable;
      job.node.stopReason = job.node.expandable ? null : stopAcc || "atomic_structure";
      bumpStop(job.node.expandable ? null : job.node.stopReason);
      for (const ch of childAcc) {
        const child = {
          id: `x${assembled.raw.nodes.length + 1}`,
          parentId: job.node.id,
          title: String(ch.title || "（未命名）").slice(0, 80),
          authorialRole: ch.authorialRole || null,
          centralQuestion: ch.centralQuestion || null,
          mainMove: ch.mainMove || null,
          progression: ch.progression || null,
          relationToParent: ch.relationToParent || null,
          relationToSiblings: ch.relationToSiblings || null,
          groupingBasis: ch.groupingBasis || null,
          unitAnchors: job.node.unitAnchors || [],
          evidence: Array.isArray(ch.evidence) ? ch.evidence : [],
          compositionalEvidence: [],
          childIds: [],
          expandable: ch.expandable === true,
          stopReason: ch.expandable === true ? null : ch.stopReason || null,
          sourceKind: "expanded"
        };
        nodeById.set(child.id, child);
        assembled.raw.nodes.push(child);
        job.node.childIds.push(child.id);
        depthOfNode.set(child.id, job.depth + 1);
        if (child.expandable && job.depth + 1 < MAX_EXPAND_DEPTH) enqueue(child, job.depth + 1);
        else if (job.depth + 1 >= MAX_EXPAND_DEPTH && child.expandable) { child.stopReason = "max_depth"; bumpStop("max_depth"); }
        else bumpStop(child.stopReason || "atomic_structure");
      }
      ctx.db.updateMaterialMapRun(run.id, { callsDone: callsMade });
      ctx.broadcast({ runId: run.id, stage: "expand", done: callsMade, total: est.newCalls + queue.length + 1, calls: callsMade, budget });
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
      if (r.cancelled) return finishCancelled(run.id);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      cacheContent.set(call.nodeKey, r.content);
      ctx.db.updateMaterialMapRun(run.id, { callsDone: callsMade });
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
      if (r.cancelled) return finishCancelled(run.id);
      if (r.budget) { budgetHit = true; break; }
      if (r.jsonFail) return finishJsonFail(ctx, run.id, usageAcc);
      cacheContent.set(call.nodeKey, r.content);
    }

    // ---------- 阶段 6：装配 + 本地校验 ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "validate" });
    attachMergeGlobal(assembled, mergeCalls, globalCalls, cacheContent);
    const validation = core.validateMapStructure(assembled.raw, { textByUnit: assembled.textByUnit, rootId: "root" });
    const aiNodeCount = validation.nodes.filter((n) => n.id !== "root").length;
    if (!validation.ok || aiNodeCount === 0) {
      ctx.db.updateMaterialMapRun(run.id, {
        status: "failed_validation",
        errorCode: "validation",
        errorText: `结构校验未通过：${validation.dropped.length} 个节点被拒（${(validation.dropped[0] || {}).reason || ""}）`,
        actualPromptTokens: usageAcc.prompt,
        actualCompletionTokens: usageAcc.completion,
        output: { dropped: validation.dropped, metrics }
      });
      return { status: "failed", code: "validation", dropped: validation.dropped, runId: run.id };
    }

    // ---------- editorial 终编辑（本地应用 ops；零变更合法） ----------
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
    if (editorialContent) {
      const applied = applyEditorialOps(nodes, editorialContent.ops || []);
      const revalidation = core.validateMapStructure({ title: assembled.raw.title, nodes: applied.nodes.map(toRawNode) }, { textByUnit: assembled.textByUnit, rootId: "root" });
      if (revalidation.ok) nodes = revalidation.nodes;
    } else if (!cancelled()) {
      const user =
        `【材料】${params.title || "材料知识导图"}\n【目录】\n${renderTocText(core.buildTocTree(params.tocItems || [], params.title))}\n\n【结构 JSON】\n` +
        JSON.stringify(nodes.map(stripEvidenceForPrompt));
      const { text, usage } = await chatOnce(ctx, templateText(ctx, RUN_KIND_SCOPE.editorial), user, run.id);
      usageAcc.prompt += usage.prompt;
      usageAcc.completion += usage.completion;
      const parsed = parseJsonLoose(text);
      const ed = parsed || { ops: [], changeLog: ["终编辑输出不可解析，已跳过（不影响结构正确性）"] };
      ctx.db.saveMaterialMapShard({ ...editorialShardKey, content: ed, tokenUsed: usage.prompt + usage.completion });
      const applied = applyEditorialOps(nodes, ed.ops || []);
      const revalidation = core.validateMapStructure({ title: assembled.raw.title, nodes: applied.nodes.map(toRawNode) }, { textByUnit: assembled.textByUnit, rootId: "root" });
      if (revalidation.ok) nodes = revalidation.nodes;
    }

    // ---------- 语义评审（>120 节点按顶层分支递归分片 + 根一致性复审；不截断树不删证据） ----------
    ctx.db.updateMaterialMapRun(run.id, { stage: "review" });
    const issues = await runReview(ctx, run, params, nodes, usageAcc, common);

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
      return { status: "review_failed", issues: issues.list, summary: issues.summary || "", runId: run.id };
    }

    // ---------- 完成落库（预算触顶 → partial：存为未激活版本，旧 active 保持，不伪装完整生成） ----------
    return finalizeMap(ctx, run.id, params, nodes, assembled.raw.title, usageAcc, { budgetHit, metrics });
  } catch (err) {
    const code = err && err.code ? err.code : err && /超时/.test(err.message || "") ? "timeout" : "network";
    const status = code === "cancelled" ? "cancelled" : code === "rate_limit" ? "failed_rate_limit" : code === "timeout" ? "failed_timeout" : "failed_network";
    ctx.db.updateMaterialMapRun(run.id, {
      status,
      errorCode: code,
      errorText: String((err && err.message) || err).slice(0, 500),
      actualPromptTokens: usageAcc.prompt,
      actualCompletionTokens: usageAcc.completion
    });
    return { status: code === "cancelled" ? "cancelled" : "failed", code, error: String((err && err.message) || err), runId: run.id };
  }
}

function finishCancelled(runId) {
  cancelledRuns.delete(runId);
  return { status: "cancelled", runId };
}
function finishJsonFail(ctx, runId, usageAcc) {
  ctx.db.updateMaterialMapRun(runId, {
    status: "failed_json",
    errorCode: "json",
    errorText: "模型输出两次均无法解析为合法 JSON（含一次格式修复）",
    actualPromptTokens: usageAcc.prompt,
    actualCompletionTokens: usageAcc.completion
  });
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
function expandFingerprint(node, depth) {
  return sha256([(node.unitAnchors || []).join("|"), node.title, depth].join("\u0001"));
}

/** 语义评审：≤120 节点一次评审；超出按顶层分支递归分片 + 根一致性复审（跨分支重复/冲突） */
async function runReview(ctx, run, params, nodes, usageAcc, common) {
  const reviewOnce = async (user, cacheKey) => {
    const hit = !params.force && cacheKey && ctx.db.getMaterialMapShard(cacheKey);
    if (hit) return hit.content;
    const { text, usage } = await chatOnce(ctx, templateText(ctx, RUN_KIND_SCOPE.review), user, run.id);
    usageAcc.prompt += usage.prompt;
    usageAcc.completion += usage.completion;
    const parsed = parseJsonLoose(text) || { status: "review", issues: [], summary: "评审输出不可解析，按待审处理" };
    if (cacheKey) ctx.db.saveMaterialMapShard({ ...cacheKey, content: parsed, tokenUsed: usage.prompt + usage.completion });
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
  if (nodes.length <= REVIEW_SHARD_NODES) {
    if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
    const user =
      `【材料】${params.title || "材料知识导图"}\n【目录】\n${renderTocText(core.buildTocTree(params.tocItems || [], params.title))}\n\n【结构 JSON】\n` +
      JSON.stringify(nodes.map(stripEvidenceForPrompt));
    const r = await reviewOnce(user, shardKeyFor(nodes, "whole"));
    issues = r.issues || [];
    summary = r.summary || "";
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
          issues = issues.concat(r.issues || []);
          summary = (summary ? summary + " " : "") + (r.summary || "");
        }
      } else {
        if (cancelledRuns.has(run.id)) return { status: "cancelled", list: [] };
        const input = sub.map((n) => ({ ...stripEvidenceForPrompt(n), parentPath: pathOf(n) }));
        const user = `【材料】${params.title || "材料知识导图"}\n【结构 JSON（分支分片：${t.title}）】\n` + JSON.stringify(input);
        const r = await reviewOnce(user, shardKeyFor(sub, `branch:${t.id}`));
        issues = issues.concat(r.issues || []);
        summary = (summary ? summary + " " : "") + (r.summary || "");
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
    issues = issues.concat(r2.issues || []);
    summary = (summary ? summary + " " : "") + (r2.summary || "");
  }
  const status = issues.some((i) => i.type === "topic_list" || i.type === "hollow_parent" || i.severity === "high") ? "fail" : issues.length ? "review" : "pass";
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
  const { plan } = buildCallPayloads(staging.params, () => "");
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

async function chatOnce(ctx, system, user, runId) {
  const controller = new AbortController();
  activeControllers.set(runId, controller);
  // 墙钟看门狗（v48.8）：120s 无数据超时会被推理流持续输出规避——单调用超过 8 分钟强制中止并给出明确失败
  const watchdog = setTimeout(() => {
    const err = new Error("单次调用超过 8 分钟未完成，已中止（长材料请确认网络与模型服务状态；系统已按段落分片控制单次输入规模）");
    err.code = "timeout";
    try {
      controller.abort(err);
    } catch {
      /* ignore */
    }
  }, 8 * 60 * 1000);
  try {
    const r = await ctx.chat({ system, user, abortSignal: controller.signal, temperature: 0.3 });
    const usage = (r && r.usage) || {};
    return {
      text: (r && r.text) || "",
      usage: { prompt: Number(usage.prompt_tokens) || 0, completion: Number(usage.completion_tokens) || 0 }
    };
  } finally {
    clearTimeout(watchdog);
    activeControllers.delete(runId);
  }
}

const activeControllers = new Map(); // runId → AbortController
const cancelledRuns = new Set();

function cancelRun(runId) {
  cancelledRuns.add(String(runId));
  const c = activeControllers.get(String(runId));
  if (c) {
    try {
      c.abort();
    } catch {
      /* 已结束则忽略 */
    }
  }
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

/** 阶段 2：初装 TOC 层——TOC 分析节点（含 section 单层 children 递归容错）；merge/global 稍后 attach */
function assembleTocLayer(params, plan, sectionCalls, cacheContent) {
  const rawNodes = [];
  const mapIdOf = new Map();
  let seq = 0;
  const nextId = () => `n${++seq}`;
  const mkNode = (id, parentId, analysis, unitAnchors) => {
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
    mkNode(id, parentId, analysis, []);
  }
  for (const call of sectionCalls) {
    const content = cacheContent.get(call.nodeKeys[0]);
    const arr = content && Array.isArray(content.nodes) ? content.nodes : [];
    const anchors = callBlocksAnchors(call, plan);
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
        node.evidence = Array.isArray(own.evidence) ? own.evidence : [];
        node.unitAnchors = anchors;
        node.expandable = own.expandable === true;
        node.stopReason = own.stopReason || null;
      }
      if (own) {
        const expand = (pid, list) => {
          for (const ch of Array.isArray(list) ? list : []) {
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
              unitAnchors: anchors,
              evidence: Array.isArray(ch.evidence) ? ch.evidence : [],
              compositionalEvidence: [],
              childIds: [],
              expandable: ch.expandable === true,
              stopReason: ch.stopReason || null
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
  return { raw: { title: params.title || "材料知识导图", nodes: rawNodes }, mapIdOf, textByUnit: plan.textByUnit };
}

/** 阶段 6 前置：merge/global 产出回填（compositional 引用 + merge 证据与可选 children 细化） */
function attachMergeGlobal(assembled, mergeCalls, globalCalls, cacheContent) {
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
      node.evidence = Array.isArray(content.evidence) ? content.evidence : [];
      node.unitAnchors = Array.isArray(call.blocks) ? call.blocks : [];
      const anchors = node.unitAnchors;
      const expand = (pid, list) => {
        for (const ch of Array.isArray(list) ? list : []) {
          const cid = `m${raw.nodes.length + 1}`;
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
            unitAnchors: anchors,
            evidence: Array.isArray(ch.evidence) ? ch.evidence : [],
            compositionalEvidence: [],
            childIds: [],
            expandable: ch.expandable === true,
            stopReason: ch.stopReason || null
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

function callBlocksAnchors(call, plan) {
  if (call.runKind === "merge") return Array.isArray(call.blocks) ? call.blocks : [];
  // section：组覆盖的单元锚
  void plan;
  const m = /【原文·([^】]+)】/g;
  const out = [];
  let mm;
  while ((mm = m.exec(call.user))) out.push(mm[1]);
  return out;
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
    nodes: nodes.map((n) => ({ ...n, quoteHashes: undefined })),
    edges: [],
    // 制卡整书把握（§4.19-10）：引擎在落库时派生有界结构摘要（≤1200 字），渲染层直读无需引入 core
    summaryText: core.deriveStructureSummary({ title: title || params.title || "材料知识导图", nodes }, 1200)
  };
  const partial = !!opts.budgetHit;
  const saved = ctx.db.saveMaterialMap({
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
    isActive: !partial
  });
  ctx.db.updateMaterialMapRun(runId, {
    status: partial ? "partial" : "completed",
    stage: "done",
    actualPromptTokens: usageAcc.prompt,
    actualCompletionTokens: usageAcc.completion,
    output: {
      mapId: saved.id,
      nodeCount: nodes.length,
      remapped: remap ? Object.keys(remap).length : 0,
      completeness: partial ? "partial:call_budget" : "complete",
      metrics: opts.metrics || null
    }
  });
  ctx.broadcast({ runId, stage: partial ? "partial" : "completed", mapId: saved.id });
  return {
    status: partial ? "partial" : "completed",
    mapId: saved.id,
    nodeCount: nodes.length,
    remap,
    runId,
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
