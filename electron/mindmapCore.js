// 材料知识导图核心（v48 批1，M15，D41/D42 / §4.19）——纯函数、零依赖。
// 主进程编排引擎（批2）、渲染层预览、测试三方共用（memoryRetrieve/kpScopes 同款纪律：单一真源，禁止复制）。
// 职责（§4.19 v48）：TOC → 提取单元模型 / 文档线性化 / parentOwnedText 区间集合差（禁字符串减法）/
// 段落边界分片 / 证据命中数裁决 / 结构 JSON 本地校验 / 粒度选择 / 重生成 remap / 结构摘要有界派生。
// 边界：本模块不做 IO、不调用 AI、不碰数据库；hash（sha256）由引擎侧（node crypto）计算后传入。

"use strict";

// ---------- 常量（封闭枚举，AI 不得自造；§4.19-3） ----------

const AUTHORIAL_ROLES = [
  "introduce", "distinguish", "decompose", "sequence", "cause_effect", "problem_solution",
  "claim_evidence", "question_answer", "general_specific", "contrast", "example",
  "application", "critique", "synthesis", "extension", "parallel", "summary"
];

const GROUPING_TYPES = [
  "sequence", "causal", "contrast", "hierarchy", "problem_solution",
  "claim_evidence", "general_specific", "parallel", "synthesis"
];

// 笼统空盒标题（§4.19-6 警告清单；材料本身确实如此时由人工判断，故只警告不拒绝）
const UMBRELLA_TITLES = new Set([
  "介绍", "内容", "相关知识", "其他", "总结", "基础", "核心", "重要概念", "知识", "主要内容",
  "引言", "概述", "前言", "附录", "参考文献", "目录"
]);

// 覆盖粒度 → 分析深度上限（节点 depth ≤ cap 才有独立 AI 调用；更深层目录的文本并入最近已分析祖先的 owned text）
const GRANULARITY_CAP = { overview: 1, standard: 2, detailed: Infinity };

// ---------- TOC → 结构树 ----------

/** 渲染层把内核 TOC（{anchor,label,children}）规整为导图结构树；根 anchor 固定 "book"（level 0） */
function buildTocTree(items, rootLabel) {
  const mapNode = (it, level) => ({
    anchor: String((it && it.anchor) ?? "").trim(),
    label: String((it && it.label) ?? "").trim() || "（未命名）",
    level,
    children: Array.isArray(it && it.children) ? it.children.map((c) => mapNode(c, level + 1)) : []
  });
  const roots = (items || []).map((it) => mapNode(it, 1));
  return { anchor: "book", label: String(rootLabel || "").trim() || "整书", level: 0, children: roots };
}

/** 文档序展平（含根；parent 引用指向 flat 元素） */
function flattenToc(tree) {
  const out = [];
  const walk = (node, parent, depth) => {
    const entry = { node, parent, depth, id: nodeAnchorId(node) };
    out.push(entry);
    for (const c of node.children || []) walk(c, entry, depth + 1);
  };
  walk(tree, null, 0);
  return out;
}

function nodeAnchorId(node) {
  // 结构树内唯一键：anchor + 出现序（同 anchor 多节点时由调用方按序区分，此处用 label 兜底）
  return node.anchor || `@${node.label}`;
}

// ---------- 提取单元模型（D41-②：文档线性化坐标系） ----------

/**
 * 构建提取单元模型。
 * @param tree    buildTocTree 产物
 * @param unitAnchors string[] 文档序提取单元锚（内核 getSectionAnchors() 输出）
 * @returns 模型；nodeRange 值为 [start, end) 单元下标区间（end 独占）
 */
function buildExtractionModel(tree, unitAnchors) {
  const units = (unitAnchors || []).map(String);
  const baseOf = (h) => {
    const raw = String(h ?? "").split("#")[0];
    try {
      return decodeURI(raw);
    } catch {
      return raw;
    }
  };
  // 锚 → 单元下标（base 归一后首个命中；同 base 多单元不可能——单元锚本身即 base）
  const unitIndexByBase = new Map();
  units.forEach((a, i) => {
    const b = baseOf(a);
    if (!unitIndexByBase.has(b)) unitIndexByBase.set(b, i);
  });
  const unitIndexOf = (anchor) => {
    if (anchor === "book") return 0;
    const idx = unitIndexByBase.get(baseOf(anchor));
    return idx == null ? -1 : idx;
  };

  const flat = flattenToc(tree);
  const n = units.length;
  // 第一遍：next-boundary 扫描（文档序下一个「单元起点严格更大」的节点为界；同单元多节点不算界）
  const starts = flat.map((f) => unitIndexOf(f.node.anchor));
  const ranges = flat.map(() => null);
  for (let i = 0; i < flat.length; i++) {
    const s = starts[i];
    if (s < 0) {
      ranges[i] = { start: 0, end: 0 }; // 无可解析锚的节点（封面等）：区间为空，不参与边界
      continue;
    }
    let end = n;
    for (let j = i + 1; j < flat.length; j++) {
      // 边界 = 文档序下一个「单元起点严格更大 且 层级 ≤ 本节点」的节点（兄弟或更高层）——
      // 后代节点（depth 更大）不终结父节点的覆盖区间（§4.19-4：子树文本归属父范围）
      if (starts[j] > s && flat[j].depth <= flat[i].depth) {
        end = starts[j];
        break;
      }
    }
    ranges[i] = { start: s, end: Math.max(end, s + 1) }; // 至少覆盖自身所在单元
  }
  // 第二遍：层级钳制（子区间必须嵌套于父区间内；flat 为先序，父先于子处理）
  for (let i = 0; i < flat.length; i++) {
    const f = flat[i];
    if (!f.parent) continue;
    const pi = flat.indexOf(f.parent);
    if (pi < 0) continue;
    const pr = ranges[pi];
    const r = ranges[i];
    if (r.end <= r.start) continue; // 空区间不钳
    r.start = Math.max(r.start, pr.start);
    r.end = Math.min(r.end, pr.end);
    if (r.end < r.start) {
      r.start = pr.start;
      r.end = pr.start;
    }
  }
  const nodeRange = new Map();
  const childrenOf = new Map();
  const idOf = new Map();
  flat.forEach((f, i) => {
    const key = `${i}\u0000${f.node.anchor}\u0000${f.node.label}`;
    idOf.set(f, key);
    nodeRange.set(key, [ranges[i].start, ranges[i].end]);
    const pk = f.parent ? idOf.get(f.parent) : null;
    childrenOf.set(key, []);
    if (pk) childrenOf.get(pk).push(key);
  });
  return {
    units,
    unitIndexOf,
    flat,
    nodeKeyOf: (f) => idOf.get(f),
    nodeRange, // key → [start,end)
    childrenOf, // key → [child keys]
    rootKey: idOf.get(flat[0])
  };
}

/**
 * 区间集合差（整数单元下标区间）：nodeRange − subtractRanges。
 * D41-②：parentOwnedText 一律经本函数（区间算术）得出，严禁字符串减法。
 * @returns [[s,e),...] 升序不重叠
 */
function subtractRanges(baseRange, subtractRangesList) {
  const base = { start: baseRange[0], end: baseRange[1] };
  if (base.end <= base.start) return [];
  const cuts = (subtractRangesList || [])
    .map((r) => ({ start: Math.max(r[0], base.start), end: Math.min(r[1], base.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  const out = [];
  let cursor = base.start;
  for (const m of merged) {
    if (m.start > cursor) out.push([cursor, m.start]);
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < base.end) out.push([cursor, base.end]);
  return out;
}

/**
 * 节点的自有（parent-owned）单元区间：nodeRange 减去指定子节点的区间。
 * @param model     buildExtractionModel 产物
 * @param nodeKey   节点 key（model.nodeKeyOf(flatEntry)）
 * @param opts.skipChildKeys 需要减去的直接子节点 key 数组；缺省=全部直接子节点。
 *   粒度裁剪（D41-① 深层并入父）时传「已分析子节点」——未分析子节点的文本自动并入父。
 */
function ownedRanges(model, nodeKey, opts) {
  const range = model.nodeRange.get(nodeKey);
  if (!range) return [];
  const skip = opts && opts.skipChildKeys;
  const kids = skip ? skip : model.childrenOf.get(nodeKey) || [];
  return subtractRanges(range, kids.map((k) => model.nodeRange.get(k) || [0, 0]));
}

/** 自有区间的文本（单元文本按 \n 连接——与内核 getSectionText 跨单元拼接同一约定） */
function ownedText(model, nodeKey, textByUnit, opts) {
  const gaps = ownedRanges(model, nodeKey, opts);
  const parts = [];
  for (const [s, e] of gaps) {
    for (let u = s; u < e; u++) {
      const t = textByUnit.get(model.units[u]);
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

/** 节点覆盖的全部单元文本（区间内所有单元，不减子节点） */
function rangeText(model, nodeKey, textByUnit) {
  const range = model.nodeRange.get(nodeKey);
  if (!range || range.end <= range.start) return "";
  const parts = [];
  for (let u = range[0]; u < range[1] && u < model.units.length; u++) {
    const t = textByUnit.get(model.units[u]);
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

// ---------- 粒度选择（§4.19-2④：控制语义分析深度，永不删原文） ----------

/** 深度 ≤ cap 的节点进入 AI 分析；更深层目录的文本经 ownedRanges 的 skip 语义并入最近已分析祖先 */
function selectAnalysisNodes(model, granularity) {
  const cap = GRANULARITY_CAP[granularity] != null ? GRANULARITY_CAP[granularity] : 2;
  const analyzed = new Set();
  for (const f of model.flat) {
    if (f.depth <= cap) analyzed.add(model.nodeKeyOf(f));
  }
  return { cap, analyzed };
}

// ---------- 证据命中数裁决（D41-④：offset 仅提示，quote 逐字为硬约束） ----------

/**
 * 在 text 中定位 quote 的全部命中。
 * 消歧规则：0 命中 → reject；1 命中 → accept；多命中 → 用 hintOffset 消歧
 *（命中区间包含 hint 距离记 0，否则取到区间两端的最近距离；唯一最小者胜，并列 → ambiguous）。
 */
function locateEvidence(text, quote, hintOffset) {
  const q = String(quote ?? "");
  if (!q || !text) return { status: "reject", hits: 0, matchStart: -1, matchEnd: -1 };
  const hits = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(q, from);
    if (i < 0) break;
    hits.push([i, i + q.length]);
    from = i + 1;
    if (hits.length >= 1000) break; // 防御性上限（正常引用不会重复千次）
  }
  if (!hits.length) return { status: "reject", hits: 0, matchStart: -1, matchEnd: -1 };
  if (hits.length === 1) return { status: "accept", hits: 1, matchStart: hits[0][0], matchEnd: hits[0][1] };
  if (typeof hintOffset !== "number" || !Number.isFinite(hintOffset)) {
    return { status: "ambiguous", hits: hits.length, matchStart: -1, matchEnd: -1 };
  }
  let best = [];
  let bestDist = Infinity;
  for (const [s, e] of hits) {
    const d = hintOffset >= s && hintOffset <= e ? 0 : Math.min(Math.abs(hintOffset - s), Math.abs(hintOffset - e));
    if (d < bestDist) {
      bestDist = d;
      best = [[s, e]];
    } else if (d === bestDist) best.push([s, e]);
  }
  if (best.length !== 1) return { status: "ambiguous", hits: hits.length, matchStart: -1, matchEnd: -1 };
  return { status: "accept", hits: hits.length, matchStart: best[0][0], matchEnd: best[0][1] };
}

// ---------- 段落边界分片（超长单元；禁字符硬切） ----------

/**
 * 按 canonical 文本的 \n（块/段边界）分片；单片 ≤ maxChars。
 * 单段超过 maxChars 时整段独立成片（永不截断——§4.19-2④ 红线）。
 * @returns [{start, end, text}] offset 相对完整文本（UTF-16 码元）
 */
function splitByParagraphs(text, maxChars) {
  const cap = Math.max(1, maxChars || 6000);
  const t = String(text ?? "");
  if (!t) return [];
  // 行区间（不含 \n 本身；尾随空行忽略）
  const lines = [];
  let pos = 0;
  while (pos < t.length) {
    const nl = t.indexOf("\n", pos);
    const end = nl < 0 ? t.length : nl;
    lines.push([pos, end]);
    pos = end + 1;
  }
  const chunks = [];
  let curStart = -1;
  let curEnd = -1;
  const flush = () => {
    if (curStart >= 0 && curEnd > curStart) chunks.push({ start: curStart, end: curEnd, text: t.slice(curStart, curEnd) });
    curStart = -1;
    curEnd = -1;
  };
  for (const [s, e] of lines) {
    const len = e - s;
    if (len === 0) continue; // 空行
    if (len > cap) {
      flush();
      chunks.push({ start: s, end: e, text: t.slice(s, e) }); // 超长段独立成片，永不截断（§4.19-2④ 红线）
      continue;
    }
    if (curStart < 0) {
      curStart = s;
      curEnd = e;
      continue;
    }
    if (e - curStart + 1 > cap) {
      // 加上本行（含分隔符）超限 → 先落已成片
      flush();
      curStart = s;
      curEnd = e;
    } else {
      curEnd = e;
    }
  }
  flush();
  return chunks;
}

// ---------- 结构 JSON 本地校验（§4.19-6：校验先于一切 AI 评审） ----------

/**
 * @param raw  AI 输出的结构（未信任）：{ title?, nodes: [...] }
 *   节点：{ id?, parentId?, title?, authorialRole?, relationToParent?, relationToSiblings?,
 *           groupingBasis?（{type,explanation,evidenceRefs?} 或 type 字符串）, summary?,
 *           unitAnchors?（本节点证据可定位的单元锚）, evidence?（[{quote,startOffset?,endOffset?}]）,
 *           compositionalEvidence?（[nodeId,...] 引用后代节点证据） }
 * @param ctx { textByUnit: Map<anchor,text>；rootId?: 引擎指定的根（其证据豁免） }
 * 校验规则（违反即拒渲染或丢弃对应节点，drops 全部留痕）：
 *   schema（id/title 缺失丢弃、id 重复保留首个）/ 编造锚拒绝 / 证据逐字 + 命中数裁决 /
 *   非根无任何有效证据（direct+compositional）REJECT / 父引用缺失 REJECT / 成环 REJECT /
 *   root 不可达 REJECT / 同层重复标题警告 / 笼统空盒标题警告 / role·grouping 枚举越界警告。
 */
function validateMapStructure(raw, ctx) {
  const dropped = [];
  const warnings = [];
  const textByUnit = (ctx && ctx.textByUnit) || new Map();
  const rootId = ctx && ctx.rootId;
  const rawNodes = raw && Array.isArray(raw.nodes) ? raw.nodes : [];
  const knownUnits = new Set(textByUnit.keys());

  // 第一遍：schema + 锚 + 证据
  const kept = [];
  const seenIds = new Set();
  rawNodes.forEach((n, index) => {
    const id = typeof n?.id === "string" ? n.id.trim() : "";
    const title = typeof n?.title === "string" ? n.title.trim().slice(0, 80) : "";
    if (!id || !title) {
      dropped.push({ index, id, reason: !id ? "缺 id" : "缺 title" });
      return;
    }
    if (seenIds.has(id)) {
      dropped.push({ index, id, reason: "id 重复" });
      return;
    }
    seenIds.add(id);
    const flags = [];
    const role = AUTHORIAL_ROLES.includes(n?.authorialRole) ? n.authorialRole : null;
    if (n?.authorialRole != null && n.authorialRole !== "" && !role) {
      flags.push(`authorialRole 越界：${String(n.authorialRole)}`);
      warnings.push(`节点「${title}」authorialRole 越界（${String(n.authorialRole)}），已置空`);
    }
    let grouping = null;
    if (n?.groupingBasis) {
      const g = typeof n.groupingBasis === "string" ? { type: n.groupingBasis } : n.groupingBasis;
      if (g && GROUPING_TYPES.includes(g.type)) {
        grouping = {
          type: g.type,
          explanation: typeof g.explanation === "string" ? g.explanation.slice(0, 500) : "",
          evidenceRefs: Array.isArray(g.evidenceRefs) ? g.evidenceRefs.map(String).slice(0, 20) : []
        };
      } else {
        flags.push(`groupingBasis 越界：${String(g && g.type)}`);
        warnings.push(`节点「${title}」groupingBasis 越界（${String(g && g.type)}），已置空`);
      }
    }
    const anchorsRaw = Array.isArray(n?.unitAnchors) ? n.unitAnchors.map(String) : [];
    const anchors = anchorsRaw.filter((a) => knownUnits.has(a));
    if (anchorsRaw.length && !anchors.length) {
      dropped.push({ index, id, reason: `编造单元锚（${anchorsRaw.slice(0, 3).join("、")} 不在输入范围）` });
      return;
    }
    // direct 证据：逐条在声明单元文本中做命中数裁决
    const evidence = [];
    const evRaw = Array.isArray(n?.evidence) ? n.evidence : [];
    for (const e of evRaw.slice(0, 20)) {
      const quote = typeof e?.quote === "string" ? e.quote.trim().slice(0, 500) : "";
      if (!quote) continue;
      let unit = typeof e?.unitAnchor === "string" && anchors.includes(e.unitAnchor) ? e.unitAnchor : null;
      const candidates = unit ? [unit] : anchors;
      let located = null;
      for (const a of candidates) {
        const host = textByUnit.get(a) || "";
        const r = locateEvidence(host, quote, typeof e?.startOffset === "number" ? e.startOffset : undefined);
        if (r.status === "accept") {
          located = { ...r, unit };
          break;
        }
        if (r.status === "ambiguous" && !located) {
          located = { ...r, unit };
        }
      }
      if (!located) {
        flags.push("evidence 未命中原文，已丢弃该条");
        continue;
      }
      evidence.push({
        id: `e${evidence.length + 1}`,
        quote,
        unitAnchor: located.unit,
        matchStart: located.matchStart,
        matchEnd: located.matchEnd,
        positionAmbiguous: located.status === "ambiguous"
      });
    }
    const compositional = Array.isArray(n?.compositionalEvidence) ? n.compositionalEvidence.map(String).slice(0, 30) : [];
    kept.push({
      raw: n,
      index,
      node: {
        id,
        parentId: typeof n?.parentId === "string" && n.parentId.trim() ? n.parentId.trim() : null,
        title,
        authorialRole: role,
        centralQuestion: typeof n?.centralQuestion === "string" ? n.centralQuestion.trim().slice(0, 300) : null,
        mainMove: typeof n?.mainMove === "string" ? n.mainMove.trim().slice(0, 300) : null,
        progression: typeof n?.progression === "string" ? n.progression.trim().slice(0, 500) : null,
        relationToParent: typeof n?.relationToParent === "string" ? n.relationToParent.trim().slice(0, 500) : null,
        relationToSiblings: typeof n?.relationToSiblings === "string" ? n.relationToSiblings.trim().slice(0, 500) : null,
        groupingBasis: grouping,
        summary: typeof n?.summary === "string" ? n.summary.trim().slice(0, 1000) : null,
        unitAnchors: anchors,
        evidence,
        compositionalEvidence: compositional,
        childIds: [],
        flags
      }
    });
  });

  const byId = new Map(kept.map((k) => [k.node.id, k]));
  const alive = new Map(byId);
  const isRootNode = (n) => (rootId ? n.id === rootId : false);
  const hasValidDirect = (n) => n.evidence.length > 0;
  const hasValidCompositional = (n, visiting) => {
    if (visiting.has(n.id)) return false;
    visiting.add(n.id);
    for (const ref of n.compositionalEvidence) {
      const t = alive.get(ref);
      if (t && (hasValidDirect(t.node) || hasValidCompositional(t.node, visiting))) {
        visiting.delete(n.id);
        return true;
      }
    }
    visiting.delete(n.id);
    return false;
  };
  const dropNode = (k, reason) => {
    if (!alive.has(k.node.id)) return;
    alive.delete(k.node.id);
    dropped.push({ index: k.index, id: k.node.id, reason });
  };

  // 第二遍：迭代至稳定——证据完备性 / 孤儿 / 成环互相级联（任一淘汰都可能使其他节点失据或失父）。
  // 根豁免仅限引擎指定的 rootId；AI 顶层节点一律须有证据（direct 或 compositional）。
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...alive.values()]) {
      if (!isRootNode(k.node) && !hasValidDirect(k.node) && !hasValidCompositional(k.node, new Set())) {
        dropNode(k, "非根节点无有效证据（direct 与 compositional 均为空或已失效）");
        changed = true;
      }
    }
    for (const k of [...alive.values()]) {
      if (k.node.parentId && !alive.has(k.node.parentId)) {
        dropNode(k, `孤儿节点：父引用 ${k.node.parentId} 不存在或已被拒绝`);
        changed = true;
      }
    }
    for (const k of [...alive.values()]) {
      const seen = new Set();
      let cur = k.node.id;
      let steps = 0;
      let cyclic = false;
      while (cur && steps <= alive.size + 1) {
        if (seen.has(cur)) {
          cyclic = true;
          break;
        }
        seen.add(cur);
        const nk = alive.get(cur);
        cur = nk && nk.node.parentId ? nk.node.parentId : null;
        steps++;
      }
      if (cyclic) {
        for (const id of seen) {
          const kk = alive.get(id);
          if (kk) dropNode(kk, "父链成环");
        }
        changed = true;
      }
    }
  }

  // 第三遍：可达性（从 parentId=null 的存活节点出发）+ childIds 回填
  const reachable = new Set();
  const stack = [];
  for (const k of alive.values()) {
    if (!k.node.parentId) {
      reachable.add(k.node.id);
      stack.push(k.node.id);
    }
  }
  while (stack.length) {
    const cur = stack.pop();
    for (const k of alive.values()) {
      if (k.node.parentId === cur && !reachable.has(k.node.id)) {
        reachable.add(k.node.id);
        stack.push(k.node.id);
      }
    }
  }
  for (const k of [...alive.values()]) {
    if (!reachable.has(k.node.id)) dropNode(k, "root 不可达");
  }
  const out = [...alive.values()].map((k) => k.node);
  const nodeById = new Map(out.map((n) => [n.id, n]));
  for (const n of out) n.childIds = [];
  for (const n of out) {
    if (n.parentId && nodeById.has(n.parentId)) nodeById.get(n.parentId).childIds.push(n.id);
  }
  // 同层重复标题 / 笼统空盒
  const byParent = new Map();
  for (const n of out) {
    const key = n.parentId || "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const [, arr] of byParent) {
    const counts = new Map();
    for (const n of arr) counts.set(n.title, (counts.get(n.title) || 0) + 1);
    for (const n of arr) {
      if ((counts.get(n.title) || 0) >= 3) {
        n.flags.push("同层重复标题");
        warnings.push(`节点「${n.title}」在同层出现 ${counts.get(n.title)} 次`);
        break; // 每组只警告一次
      }
    }
  }
  for (const n of out) {
    if (UMBRELLA_TITLES.has(n.title) && n.childIds.length > 0) {
      n.flags.push("笼统空盒标题（请人工确认）");
      warnings.push(`节点「${n.title}」为笼统标题且带子节点，请人工确认是否空洞`);
    }
    if (n.parentId && !n.groupingBasis) {
      warnings.push(`节点「${n.title}」缺 grouping_basis（归并节点应说明为何同属一个高级结构）`);
    }
  }
  const title = raw && typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 120) : "材料知识导图";
  return { ok: out.length > 0, title, nodes: out, dropped, warnings };
}

// ---------- 重生成 remap（D41-⑥：旧卡沿 remap 链解析，卡片永不改写） ----------

/**
 * 新旧节点确定性匹配：① 提取单元覆盖重叠 → ② evidence quoteHash 重叠 → ③ 标题精确相等。
 * 得分 = anchorOverlap*100 + hashOverlap*10 + titleEqual；全体候选对按分贪心一对一。
 * @param oldNodes [{id, unitAnchors[], quoteHashes[], title}]
 * @param newNodes 同构
 * @returns Map oldId → newId
 */
function remapNodes(oldNodes, newNodes) {
  const pairs = [];
  const inter = (a, b) => {
    const sb = new Set(b);
    let n = 0;
    for (const x of a) if (sb.has(x)) n++;
    return n;
  };
  for (const o of oldNodes || []) {
    for (const w of newNodes || []) {
      const ao = inter(o.unitAnchors || [], w.unitAnchors || []);
      const ho = inter(o.quoteHashes || [], w.quoteHashes || []);
      const te = o.title && o.title === w.title ? 1 : 0;
      const aNorm = Math.min(1, ao / Math.max(1, Math.min((o.unitAnchors || [1]).length, (w.unitAnchors || [1]).length)));
      const hNorm = Math.min(1, ho / Math.max(1, Math.min(Math.max(1, (o.quoteHashes || [1]).length), Math.max(1, (w.quoteHashes || [1]).length))));
      const score = aNorm * 100 + hNorm * 10 + te;
      if (score > 0) pairs.push({ o: o.id, w: w.id, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.o.localeCompare(b.o) || a.w.localeCompare(b.w));
  const usedOld = new Set();
  const usedNew = new Set();
  const remap = new Map();
  for (const p of pairs) {
    if (usedOld.has(p.o) || usedNew.has(p.w)) continue;
    usedOld.add(p.o);
    usedNew.add(p.w);
    remap.set(p.o, p.w);
  }
  return remap;
}

// ---------- 结构摘要有界派生（制卡整书把握，§4.19-10） ----------

/** 结构 JSON → 有界大纲（≤maxChars，超长截断并标注；只含标题层级，不含证据原文） */
function deriveStructureSummary(map, maxChars) {
  const cap = Math.max(200, maxChars || 1200);
  const nodes = (map && map.nodes) || [];
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentId && nodes.some((x) => x.id === n.parentId) ? n.parentId : "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  const lines = [`【${(map && map.title) || "材料知识导图"} · 结构摘要】`];
  const emit = (parentId, depth) => {
    for (const n of byParent.get(parentId) || []) {
      if (lines.join("\n").length > cap) return;
      const role = n.authorialRole ? `（${n.authorialRole}）` : "";
      lines.push(`${"  ".repeat(depth)}- ${n.title}${role}`);
      emit(n.id, depth + 1);
    }
  };
  emit("", 0);
  let text = lines.join("\n");
  if (text.length > cap) text = text.slice(0, cap) + "\n（超长截断）";
  return text;
}

module.exports = {
  AUTHORIAL_ROLES,
  GROUPING_TYPES,
  UMBRELLA_TITLES,
  GRANULARITY_CAP,
  buildTocTree,
  flattenToc,
  buildExtractionModel,
  subtractRanges,
  ownedRanges,
  ownedText,
  rangeText,
  selectAnalysisNodes,
  locateEvidence,
  splitByParagraphs,
  validateMapStructure,
  remapNodes,
  deriveStructureSummary
};
