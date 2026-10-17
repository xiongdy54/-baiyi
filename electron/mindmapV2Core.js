"use strict";
// 材料导图 v2 · 主进程纯核心（D192 / MINDMAP-V2-IMPL-PLAN §4.1 T1）。
// 纯函数、CommonJS、零外部依赖（仅 node 内置 crypto 做 sha256）、无随机源、不做 IO、不调用 AI、不碰数据库。
// 依据：IMPL-PLAN §0（X1/X3/X6）、§2、§3.1、§4.5、§4.7、§5.3-7；设计稿 §6.1、§7、§8、§9.2。
//
// ===================== 导出清单（T3 引擎使用） =====================
// 常量
//   ENGINE_VERSION = 'm15v2-engine-1'; SCOPE_FLOOR_CHARS = 400; SCOPE_SPLIT_CHARS = 20000; SCOPE_PART_MAX = 12000
//   STATES = ['more','open','floor','stub']; SOURCES = ['toc','ai','local','v1ext']
//   V1_ROLE_TO_TYPE: {authorialRole → v2 类型}；TYPE_TO_V1_ROLE: {v2 类型 → authorialRole|null}
// 原文
//   extendUnitBlocks(blocks, linear) -> Block[]
//       已有块 + 线性化里尚未切分的单元 → 新的完整块数组（增量 segmentUnits，结果 ≡ segmentUnits(linear)）
// 骨架与作用域（X1 / X3）
//   buildSkeleton({ title, tocItems, unitAnchors }) -> Skeleton
//       Skeleton = { title, units: string[], rootId, nodes: SkelNode[] /* 先序 */, byId: Map }
//       SkelNode = { nodeId:'t<i>', parentId, title, depth, seq, childIds, unitFrom, unitTo /* 子树单元 [from,to) */,
//                    runs: [[uFrom,uTo)] /* 本节点唯一拥有的连续单元段 */ }
//   planScopes(skeleton, blocks, unitsReady) -> Scope[]（按 blockFrom 升序；只含「已定型」作用域：其单元段已全部送入）
//       Scope = { scopeId, nodeId, part /* 0=唯一 */, blockFrom, blockTo, unitFrom, unitTo, chars, floor /* <400 */,
//                 depth /* 目标节点深度 */, path: string[] /* 根以下至目标节点的标题 */ }
//   skeletonRows(skeleton, blocks, unitsReady, scopes?) -> NodeRow[]（source='toc'；state open|more|floor）
// 别名表与可引用清单（X6）
//   buildAliasTable(candidates: {nodeId,title}[]) -> AliasTable
//       AliasTable = { refs: [{id:'#k1',title}], refSet: Set<'#kN'>, aliasToNode: {[#kN]:nodeId}, nodeToAlias, text }
//   outlineRefCandidates(rows, targetId, opts?) -> {nodeId,title}[]（骨架 toc 行，去根与目标；opts.extra 追加）
//   expandRefCandidates(rows, edges, targetId, opts?) -> {nodeId,title}[]（祖先/兄弟/已有关系/本章前两层）
// 封顶三门（§4.7）
//   nodeStateOf(parsed, blocks, depth) -> 'floor'|'more'          第 1 门（isLocalFloor）+ 第 2 门（'.'→floor）
//   recheckAfterExpand(target, children) -> { floor: boolean, discard: nodeId[] }   第 3 门
//   expandGate(row, blocks, depth, { force }?) -> null | 'floor' | 'no_text'        深挖前判定（force 只跳过 ②③）
// 任务装配（解析节点 → NodeRow；覆盖桩；length 回标）
//   createJobAssembler(opts) -> { onNode(node) -> Delta, onRel(rel) -> Delta, finish({finishReason, aborted}) -> JobResult, rows() }
//       opts = { kind:'outline'|'expand', jobId, basePath, target: { nodeId, depth, blockFrom, blockTo, hadChildren },
//                levels, blocks, linear?, aliases?: AliasTable, force? }
//       Delta = { nodes: NodeRow[], states: {nodeId,state}[], edges: EdgeRow[] }
//       JobResult = { upserts: NodeRow[], states: {nodeId,state}[], edges: EdgeRow[], discarded: nodeId[], stubs: NodeRow[], targetState }
//   coverageStubs(parentId, range: {blockFrom,blockTo}, childRanges, opts?) -> NodeRow[]（连续 ≥2 块未覆盖才生成）
//   markTruncated(rows, lastNodeId, stopId) -> nodeId[]（finish_reason=length 祖先链）
// v1 适配（§2）
//   adaptV1Structure(structure, blocks?) -> { rows: NodeRow[], edges: [], rootId }
//   overlayRows(baseRows, extraRows) -> NodeRow[]（同 nodeId 后者覆盖；成为叠加行父节点的基础行 → open）
//   v1RoleToType(role) -> 类型；typeToV1Role(type) -> role|null
// 结构语义包字段（§5.3-7）
//   deriveCardFields({ row, rows, blocks, linear, mapId }) -> CardFields
//       CardFields = { mindmapNodeId:'v2:<mapId>:<nodeId>', title, type, authorialRole, explainText, parentChain:[{title,type,authorialRole}],
//                      children:[{title,type,authorialRole}], evidence: string[] /* ≤3 段 ≤60 字 */, unitAnchors: string[] }
// 缓存键（§4.5）
//   modelConfigHash({ model, reasoningEffort?, maxTokens }) -> sha256 hex
//   cacheKeyOf({ documentId, kind, blockFrom, blockTo, nodeId?, promptScope, promptVersion, userText, provider, model,
//                reasoningEffort?, maxTokens }) -> material_map_shards 键 { documentId, unitAnchor, runKind, granularity:'v2',
//                promptScope, promptVersion, textHash, provider, model, modelConfigHash }
// 工具
//   sha256(s) -> hex；blockRangeOfSpans(blocks, spans) -> {blockFrom,blockTo}|null；rowDepth(rowsById, nodeId) -> number
//
// NodeRow（§3.2）= { nodeId, parentId, ord, title, type, time, pattern, blockStart, blockEnd, spans, state, source, warnings, explain, jobId }
// EdgeRow = { fromId, toId, code, origin:'text', jobId }
// id 约定（X6）：目录节点 t<先序号>（根 t0）；outline 节点＝作用域 id + 层级号（t3.2.1；子作用域 t3p1.2）；
//   expand 节点＝目标 id + 相对层级号；覆盖桩＝父 id + '.g' + 起始块号（t3.2.g15）。

const crypto = require("crypto");
const core = require("./mindmapCore.js");
const blocksMod = require("./mindmapBlocks.js");
const outline = require("./mindmapOutline.js");

const { segmentUnits, blockRangeToSpan, blockTextLength, UNIT_BLOCKS_VERSION } = blocksMod;
const { isLocalFloor, OUTLINE_VERSION } = outline;

const ENGINE_VERSION = "m15v2-engine-1";
const SCOPE_FLOOR_CHARS = 400;
const SCOPE_SPLIT_CHARS = 20000;
const SCOPE_PART_MAX = 12000;
const STATES = ["more", "open", "floor", "stub"];
const SOURCES = ["toc", "ai", "local", "v1ext"];
const REF_CAP = 120;
const EXPAND_REF_CAP = 60;

// ---------- 类型映射（设计稿 §8.1 末段；旧 17 值 authorialRole ↔ v2 类型） ----------
const V1_ROLE_TO_TYPE = Object.freeze({
  introduce: "引言", distinguish: "对比", decompose: "分类", sequence: "步骤", cause_effect: "因果",
  problem_solution: "问题", claim_evidence: "论点", question_answer: "问题", general_specific: "分类",
  contrast: "对比", example: "例证", application: "案例", critique: "反驳", synthesis: "总结",
  extension: "其他", parallel: "分类", summary: "总结",
});
const TYPE_TO_V1_ROLE = Object.freeze({
  论点: "claim_evidence", 理由: "claim_evidence", 证据: "claim_evidence", 例证: "example", 反方观点: "critique",
  反驳: "critique", 让步: "contrast", 结论: "synthesis", 命题: "claim_evidence", 前提: "claim_evidence",
  定义: "introduce", 引理: "claim_evidence", 推导: "sequence", 分情形: "decompose", 引言: "introduce",
  背景: "introduce", 问题: "question_answer", 方案: "problem_solution", 分类: "decompose", 对比: "contrast",
  因果: "cause_effect", 步骤: "sequence", 总结: "summary", 叙事: "sequence", 案例: "example", 其他: null,
});
function v1RoleToType(role) {
  return Object.prototype.hasOwnProperty.call(V1_ROLE_TO_TYPE, role) ? V1_ROLE_TO_TYPE[role] : "其他";
}
function typeToV1Role(type) {
  return Object.prototype.hasOwnProperty.call(TYPE_TO_V1_ROLE, type) ? TYPE_TO_V1_ROLE[type] : null;
}

// ---------- 工具 ----------
function sha256(s) { return crypto.createHash("sha256").update(String(s), "utf8").digest("hex"); }

function makeRow(p) {
  return {
    nodeId: p.nodeId, parentId: p.parentId == null ? null : p.parentId, ord: p.ord || 0,
    title: p.title, type: p.type || "其他", time: p.time == null ? null : p.time, pattern: p.pattern == null ? null : p.pattern,
    blockStart: p.blockStart == null ? null : p.blockStart, blockEnd: p.blockEnd == null ? null : p.blockEnd,
    spans: p.spans || [], state: p.state, source: p.source,
    warnings: p.warnings || [], explain: p.explain == null ? null : p.explain, jobId: p.jobId == null ? null : p.jobId,
  };
}

function spansOfRange(blocks, from, to) {
  if (from == null || to == null || !blocks || !blocks.length) return [];
  const sp = blockRangeToSpan(blocks, from, to);
  return sp[1] > sp[0] ? [[sp[0], sp[1]]] : [];
}

/** 区间集合 → 相交块号闭区间（块 [start,end) 与任一区间有交即算） */
function blockRangeOfSpans(blocks, spans) {
  const list = core.normalizeSpans(spans || []);
  if (!list.length || !blocks || !blocks.length) return null;
  let lo = null, hi = null;
  for (const b of blocks) {
    for (const [s, e] of list) {
      if (b.start < e && b.end > s) {
        if (lo == null || b.no < lo) lo = b.no;
        if (hi == null || b.no > hi) hi = b.no;
        break;
      }
    }
  }
  return lo == null ? null : { blockFrom: lo, blockTo: hi };
}

function rowDepth(rowsById, nodeId) {
  let d = 0;
  let cur = rowsById.get(nodeId);
  const guard = new Set();
  while (cur && cur.parentId != null && !guard.has(cur.nodeId)) {
    guard.add(cur.nodeId);
    d++;
    cur = rowsById.get(cur.parentId);
  }
  return d;
}

// ---------- 原文增量切块（X1） ----------
function extendUnitBlocks(blocks, linear) {
  const prev = Array.isArray(blocks) ? blocks : [];
  const last = prev[prev.length - 1];
  // 下一个未切单元：最后一块所在单元 + 1；但空单元不产块，故按「已覆盖单元数」由调用方保证——
  // 此处以最后一块的 unit 为界，之后的单元全部（重新）切分；空尾单元重复切分结果仍为空，幂等。
  const fromUnit = last ? last.unit + 1 : 0;
  const startNo = last ? last.no + 1 : 1;
  return prev.concat(segmentUnits(linear, { fromUnit, startNo }));
}

// ---------- 骨架（复用 core 的 TOC 归一与「正文」伪节点修复） ----------
function buildSkeleton({ title, tocItems, unitAnchors } = {}) {
  const label = String(title || "").trim() || "材料知识导图";
  const tree = core.normalizeTocTree(core.buildTocTree(tocItems || [], label), label);
  const model = core.buildExtractionModel(tree, unitAnchors || []);
  const flat = model.flat;
  const ids = flat.map((_, i) => `t${i}`);
  const idxOf = new Map(flat.map((f, i) => [f, i]));
  const ranges = flat.map((f) => model.nodeRange.get(model.nodeKeyOf(f)) || [0, 0]);
  // 唯一归属：单元归「包含它的最深节点」，同深度并列取文档序最先者；不在任何节点区间内的单元不归属（封面等，与 v1 一致）
  const owner = new Array(model.units.length).fill(-1);
  for (let u = 0; u < model.units.length; u++) {
    let best = -1;
    for (let i = 0; i < flat.length; i++) {
      const [s, e] = ranges[i];
      if (u >= s && u < e && (best < 0 || flat[i].depth > flat[best].depth)) best = i;
    }
    owner[u] = best;
  }
  const nodes = flat.map((f, i) => {
    const runs = [];
    for (let u = 0; u < owner.length; u++) {
      if (owner[u] !== i) continue;
      const lastRun = runs[runs.length - 1];
      if (lastRun && lastRun[1] === u) lastRun[1] = u + 1;
      else runs.push([u, u + 1]);
    }
    return {
      nodeId: ids[i],
      parentId: f.parent ? ids[idxOf.get(f.parent)] : null,
      title: i === 0 ? label : f.node.label,
      depth: f.depth,
      seq: 0,
      childIds: [],
      unitFrom: ranges[i][0],
      unitTo: ranges[i][1],
      runs,
    };
  });
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  for (const n of nodes) {
    if (n.parentId == null) continue;
    const p = byId.get(n.parentId);
    n.seq = p.childIds.length;
    p.childIds.push(n.nodeId);
  }
  return { title: label, units: model.units.slice(), rootId: ids[0], nodes, byId };
}

// 块按 unit 升序（segmentUnits 产物）→ 二分取 [uFrom,uTo) 单元内的块
function blocksOfUnits(blocks, uFrom, uTo) {
  const bs = blocks || [];
  let lo = 0, hi = bs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bs[mid].unit < uFrom) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo; i < bs.length && bs[i].unit < uTo; i++) out.push(bs[i]);
  return out;
}

// 连续块按 ≤SCOPE_PART_MAX 均衡切分（块边界；总长 >SCOPE_SPLIT_CHARS 才切）
function splitChunks(bs) {
  const total = bs.reduce((n, b) => n + (b.end - b.start), 0);
  if (total <= SCOPE_SPLIT_CHARS) return [bs];
  const parts = Math.ceil(total / SCOPE_PART_MAX);
  const target = total / parts;
  const chunks = [];
  let cur = [];
  let curLen = 0;
  let acc = 0; // 已关闭分片的累计长度
  for (const b of bs) {
    const len = b.end - b.start;
    const boundary = target * (chunks.length + 1);
    const overHard = curLen + len > SCOPE_PART_MAX;
    const pastSoft = acc + curLen + len / 2 > boundary && chunks.length < parts - 1;
    if (cur.length && (overHard || pastSoft)) {
      chunks.push(cur);
      acc += curLen;
      cur = [];
      curLen = 0;
    }
    cur.push(b);
    curLen += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function pathTitles(skeleton, nodeId) {
  const out = [];
  let cur = skeleton.byId.get(nodeId);
  while (cur && cur.parentId != null) {
    out.unshift(cur.title);
    cur = skeleton.byId.get(cur.parentId);
  }
  return out;
}

/** X3 作用域规划：每个拥有原文的目录节点（每个连续拥有段）一个作用域；<400 字 floor；>2 万字按块切 ≤1.2 万字子作用域挂同一节点。
 *  前缀稳定：只放出单元段已全部送入（uTo ≤ unitsReady）的作用域；其 id/区间与全量规划逐字节一致。 */
function planScopes(skeleton, blocks, unitsReady) {
  const ready = unitsReady == null ? Infinity : unitsReady;
  const scopes = [];
  for (const n of skeleton.nodes) {
    const all = [];
    let complete = true;
    for (const [uFrom, uTo] of n.runs) {
      if (uTo > ready) { complete = false; break; }
      for (const ch of splitChunks(blocksOfUnits(blocks, uFrom, uTo))) {
        if (ch.length) all.push({ ch, uFrom, uTo });
      }
    }
    // 唯一作用域（单段且未切）→ scopeId=nodeId；否则 nodeId+'p'+k。单段节点在段完成前不放出，计数确定。
    const single = complete && n.runs.length === 1 && all.length === 1;
    all.forEach(({ ch, uFrom, uTo }, k) => {
      const chars = ch.reduce((m, b) => m + (b.end - b.start), 0);
      scopes.push({
        scopeId: single ? n.nodeId : `${n.nodeId}p${k + 1}`,
        nodeId: n.nodeId,
        part: single ? 0 : k + 1,
        blockFrom: ch[0].no,
        blockTo: ch[ch.length - 1].no,
        unitFrom: uFrom,
        unitTo: uTo,
        chars,
        floor: chars < SCOPE_FLOOR_CHARS,
        depth: n.depth,
        path: pathTitles(skeleton, n.nodeId),
      });
    });
    // 单段节点：段未完成时 all 为空，不放出；多段节点：已完成段先放出（k 只依赖之前的段，稳定）
  }
  scopes.sort((a, b) => a.blockFrom - b.blockFrom);
  return scopes;
}

/** 骨架 → NodeRow（source='toc'）。块区间＝子树「唯一拥有」块的并（并列落选的节点为空区间）。 */
function skeletonRows(skeleton, blocks, unitsReady, scopes) {
  const ready = unitsReady == null ? Infinity : unitsReady;
  const sc = scopes || planScopes(skeleton, blocks, ready);
  const scopesByNode = new Map();
  for (const s of sc) {
    if (!scopesByNode.has(s.nodeId)) scopesByNode.set(s.nodeId, []);
    scopesByNode.get(s.nodeId).push(s);
  }
  const ownLo = new Map(), ownHi = new Map();
  for (const n of skeleton.nodes) {
    for (const [uFrom, uTo] of n.runs) {
      for (const b of blocksOfUnits(blocks, uFrom, uTo)) {
        if (!ownLo.has(n.nodeId) || b.no < ownLo.get(n.nodeId)) ownLo.set(n.nodeId, b.no);
        if (!ownHi.has(n.nodeId) || b.no > ownHi.get(n.nodeId)) ownHi.set(n.nodeId, b.no);
      }
    }
  }
  // 自底向上并子树区间（先序逆序）
  const lo = new Map(ownLo), hi = new Map(ownHi);
  for (let i = skeleton.nodes.length - 1; i >= 0; i--) {
    const n = skeleton.nodes[i];
    if (n.parentId == null || !lo.has(n.nodeId)) continue;
    const p = n.parentId;
    if (!lo.has(p) || lo.get(n.nodeId) < lo.get(p)) lo.set(p, lo.get(n.nodeId));
    if (!hi.has(p) || hi.get(n.nodeId) > hi.get(p)) hi.set(p, hi.get(n.nodeId));
  }
  return skeleton.nodes.map((n) => {
    const bs = lo.has(n.nodeId) ? lo.get(n.nodeId) : null;
    const be = hi.has(n.nodeId) ? hi.get(n.nodeId) : null;
    let state;
    if (n.childIds.length) state = "open";
    else if (!n.runs.length) state = "floor";
    else if (n.runs.some(([, uTo]) => uTo > ready)) state = "more"; // 原文未送完，待定
    else {
      const mine = scopesByNode.get(n.nodeId) || [];
      state = mine.some((s) => !s.floor) ? "more" : "floor";
    }
    return makeRow({
      nodeId: n.nodeId, parentId: n.parentId, ord: (bs || 0) * 1000 + n.seq, title: n.title, type: "其他",
      blockStart: bs, blockEnd: be, spans: spansOfRange(blocks, bs, be), state, source: "toc",
    });
  });
}

// ---------- 别名表与可引用清单（X6） ----------
function buildAliasTable(candidates) {
  const refs = [];
  const aliasToNode = {};
  const nodeToAlias = {};
  for (const c of candidates || []) {
    if (!c || c.nodeId == null || Object.prototype.hasOwnProperty.call(nodeToAlias, c.nodeId)) continue;
    const id = `#k${refs.length + 1}`;
    const t = String(c.title == null ? "" : c.title).replace(/\s+/g, " ").trim();
    refs.push({ id, title: t });
    aliasToNode[id] = c.nodeId;
    nodeToAlias[c.nodeId] = id;
  }
  const text = refs.map((r) => `${r.id} ${r.title}`).join("\n");
  return { refs, refSet: new Set(refs.map((r) => r.id)), aliasToNode, nodeToAlias, text };
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => (a.ord - b.ord) || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
}

// 文档序（先序；同父按 ord、nodeId）
function preorder(rows) {
  const kids = new Map();
  const ids = new Set(rows.map((r) => r.nodeId));
  const roots = [];
  for (const r of sortRows(rows)) {
    if (r.parentId == null || !ids.has(r.parentId)) roots.push(r);
    else {
      if (!kids.has(r.parentId)) kids.set(r.parentId, []);
      kids.get(r.parentId).push(r);
    }
  }
  const out = [];
  const seen = new Set();
  const walk = (r) => {
    if (seen.has(r.nodeId)) return;
    seen.add(r.nodeId);
    out.push(r);
    for (const k of kids.get(r.nodeId) || []) walk(k);
  };
  roots.forEach(walk);
  return out;
}

function capByProximity(list, targetIdx, cap) {
  if (list.length <= cap) return list;
  const withIdx = list.map((x, i) => ({ x, i }));
  withIdx.sort((a, b) => (Math.abs(a.x.idx - targetIdx) - Math.abs(b.x.idx - targetIdx)) || (a.x.idx - b.x.idx));
  return withIdx.slice(0, cap).sort((a, b) => a.i - b.i).map((y) => y.x);
}

/** outline 可引用清单：骨架目录节点（文档序，去根与目标；>120 项按与目标的文档距离取最近者）；opts.extra 追加（如已完成章节前两层） */
function outlineRefCandidates(rows, targetId, opts) {
  const ord = preorder(rows || []);
  const tIdx = ord.findIndex((r) => r.nodeId === targetId);
  const list = ord
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.source === "toc" && r.parentId != null && r.nodeId !== targetId)
    .map(({ r, idx }) => ({ nodeId: r.nodeId, title: r.title, idx }));
  const capped = capByProximity(list, tIdx < 0 ? 0 : tIdx, (opts && opts.cap) || REF_CAP);
  const out = capped.map(({ nodeId, title }) => ({ nodeId, title }));
  for (const e of (opts && opts.extra) || []) out.push({ nodeId: e.nodeId, title: e.title });
  return out;
}

/** expand 可引用清单（设计稿 §15.5）：祖先（根除外，自上而下）→ 兄弟（ord）→ 与目标已有关系的节点 → 本章（最近目录祖先）前两层；去重、去目标及其后代 */
function expandRefCandidates(rows, edges, targetId, opts) {
  const byId = new Map((rows || []).map((r) => [r.nodeId, r]));
  const target = byId.get(targetId);
  if (!target) return [];
  const isDesc = (id) => {
    let cur = byId.get(id);
    const guard = new Set();
    while (cur && !guard.has(cur.nodeId)) {
      if (cur.nodeId === targetId) return true;
      guard.add(cur.nodeId);
      cur = cur.parentId != null ? byId.get(cur.parentId) : null;
    }
    return false;
  };
  const out = [];
  const used = new Set();
  const add = (r) => {
    if (!r || used.has(r.nodeId) || r.parentId == null || isDesc(r.nodeId)) return;
    used.add(r.nodeId);
    out.push({ nodeId: r.nodeId, title: r.title });
  };
  const anc = [];
  let cur = target.parentId != null ? byId.get(target.parentId) : null;
  const guard = new Set();
  while (cur && !guard.has(cur.nodeId)) { guard.add(cur.nodeId); anc.unshift(cur); cur = cur.parentId != null ? byId.get(cur.parentId) : null; }
  anc.forEach(add);
  sortRows((rows || []).filter((r) => r.parentId === target.parentId && r.nodeId !== targetId)).forEach(add);
  const rel = [];
  for (const e of edges || []) {
    if (e.fromId === targetId) rel.push(e.toId);
    else if (e.toId === targetId) rel.push(e.fromId);
  }
  sortRows(rel.map((id) => byId.get(id)).filter(Boolean)).forEach(add);
  // 本章：最近的目录祖先（不含根）；无则取根下的顶层祖先
  let chapter = null;
  for (let i = anc.length - 1; i >= 0; i--) if (anc[i].source === "toc" && anc[i].parentId != null) { chapter = anc[i]; break; }
  if (!chapter && anc.length > 1) chapter = anc[1];
  if (chapter) {
    const lvl1 = sortRows((rows || []).filter((r) => r.parentId === chapter.nodeId));
    for (const a of lvl1) {
      add(a);
      sortRows((rows || []).filter((r) => r.parentId === a.nodeId)).forEach(add);
    }
  }
  const cap = (opts && opts.cap) || EXPAND_REF_CAP;
  return out.slice(0, cap);
}

// ---------- 封顶三门（§4.7） ----------
/** 第 1 门（本地确定性下限）+ 第 2 门（模型 '.'）。parsed＝解析器 node（blockFrom/blockTo/more）。 */
function nodeStateOf(parsed, blocks, depth) {
  if (isLocalFloor({ blockFrom: parsed.blockFrom, blockTo: parsed.blockTo }, blocks || [], depth)) return "floor";
  return parsed.more ? "more" : "floor";
}

/** 第 3 门：直接子 <2，或全部子落在同一块 → 目标 floor，丢弃这些子节点（调用方连同其后代一起丢）。 */
function recheckAfterExpand(target, children) {
  const kids = children || [];
  if (kids.length < 2) return { floor: true, discard: kids.map((k) => k.nodeId) };
  const b0 = kids[0].blockStart;
  const sameBlock = kids.every((k) => k.blockStart === b0 && k.blockEnd === b0);
  if (sameBlock) return { floor: true, discard: kids.map((k) => k.nodeId) };
  return { floor: false, discard: [] };
}

/** 深挖前判定：第 1 门恒生效；非 force 时 floor 节点拒收；区间未知（原文未送入）→ 'no_text'。 */
function expandGate(row, blocks, depth, opts) {
  if (!row) return "floor";
  const force = !!(opts && opts.force);
  if (!force && row.state === "floor") return "floor";
  if (row.blockStart == null || row.blockEnd == null) return "no_text";
  if (!blocks || !blocks.length || blocks[blocks.length - 1].no < row.blockEnd) return "no_text";
  if (isLocalFloor({ blockFrom: row.blockStart, blockTo: row.blockEnd }, blocks, depth)) return "floor";
  return null;
}

// ---------- 覆盖桩（设计稿 §9.2 覆盖账） ----------
/** 父区间内未被任何子区间覆盖、且连续 ≥2 块的缺口 → 灰色「其余 N 段」桩（source='local'，state='stub'）。 */
function coverageStubs(parentId, range, childRanges, opts) {
  if (!range || range.blockFrom == null || range.blockTo == null) return [];
  const covered = new Set();
  for (const c of childRanges || []) {
    if (c.blockFrom == null || c.blockTo == null) continue;
    for (let b = Math.max(c.blockFrom, range.blockFrom); b <= Math.min(c.blockTo, range.blockTo); b++) covered.add(b);
  }
  const out = [];
  const blocks = (opts && opts.blocks) || null;
  const jobId = (opts && opts.jobId) || null;
  let gs = null;
  const flush = (end) => {
    if (gs != null && end - gs + 1 >= 2) {
      const n = end - gs + 1;
      out.push(makeRow({
        nodeId: `${parentId}.g${gs}`, parentId, ord: gs * 1000 + 999, title: `其余 ${n} 段`, type: "其他",
        blockStart: gs, blockEnd: end, spans: spansOfRange(blocks, gs, end), state: "stub", source: "local", jobId,
      }));
    }
    gs = null;
  };
  for (let b = range.blockFrom; b <= range.blockTo; b++) {
    if (covered.has(b)) flush(b - 1);
    else if (gs == null) gs = b;
  }
  flush(range.blockTo);
  return out;
}

/** length 回标：最后接受节点的祖先链（含其自身，止于 stopId 之前；stopId 为 null 则到无父为止）。 */
function markTruncated(rows, lastNodeId, stopId) {
  const byId = rows instanceof Map ? rows : new Map((rows || []).map((r) => [r.nodeId, r]));
  const out = [];
  let cur = byId.get(lastNodeId);
  const guard = new Set();
  while (cur && !guard.has(cur.nodeId) && cur.nodeId !== stopId) {
    guard.add(cur.nodeId);
    out.push(cur.nodeId);
    cur = cur.parentId != null ? byId.get(cur.parentId) : null;
  }
  return out;
}

// ---------- 任务装配 ----------
function createJobAssembler(opts) {
  const o = opts || {};
  const kind = o.kind === "expand" ? "expand" : "outline";
  const jobId = o.jobId == null ? null : o.jobId;
  const target = o.target || {};
  const targetId = target.nodeId;
  const basePath = o.basePath != null ? String(o.basePath) : String(targetId);
  const baseSegs = basePath.split(".").length;
  const levels = Math.max(1, Number(o.levels) || 1);
  const blocks = o.blocks || [];
  const aliases = o.aliases || null;
  const force = !!o.force;

  const rows = new Map(); // nodeId → row（本任务产出，接受顺序）
  const order = [];
  const relLevel = new Map();
  const seqOf = new Map(); // parentId → 已接受子数
  const edges = new Map(); // key → EdgeRow
  let targetHasKids = false;
  let lastId = null;
  let done = false;

  const parentOf = (pp) => (pp == null || pp === basePath ? targetId : pp);
  const resolve = (t) => {
    if (typeof t !== "string") return null;
    if (t[0] === "#") return aliases && Object.prototype.hasOwnProperty.call(aliases.aliasToNode, t) ? aliases.aliasToNode[t] : null;
    return t;
  };
  const addEdge = (fromId, code, rawTarget) => {
    const toId = resolve(rawTarget);
    if (toId == null || toId === fromId) return null;
    const key = `${fromId}\u0001${toId}\u0001${code}`;
    if (edges.has(key)) return null;
    const e = { fromId, toId, code, origin: "text", jobId };
    edges.set(key, e);
    return e;
  };

  function onNode(node) {
    if (done || !node) return { nodes: [], states: [], edges: [] };
    const parentId = parentOf(node.parentPath);
    const lvl = String(node.path).split(".").length - baseSegs;
    const depth = (Number(target.depth) || 0) + lvl;
    const seq = seqOf.get(parentId) || 0;
    seqOf.set(parentId, seq + 1);
    const row = makeRow({
      nodeId: node.path, parentId, ord: node.blockFrom * 1000 + Math.min(seq, 998), title: node.title, type: node.type,
      time: node.time, pattern: node.pattern, blockStart: node.blockFrom, blockEnd: node.blockTo,
      spans: spansOfRange(blocks, node.blockFrom, node.blockTo), state: nodeStateOf(node, blocks, depth),
      source: "ai", warnings: (node.warnings || []).slice(), jobId,
    });
    rows.set(row.nodeId, row);
    order.push(row.nodeId);
    relLevel.set(row.nodeId, lvl);
    lastId = row.nodeId;
    const states = [];
    const p = rows.get(parentId);
    if (p) {
      if (p.state !== "open") { p.state = "open"; states.push({ nodeId: p.nodeId, state: "open" }); }
    } else if (parentId === targetId && !targetHasKids) {
      targetHasKids = true;
      states.push({ nodeId: targetId, state: "open" });
    }
    const es = [];
    for (const r of node.rels || []) {
      const e = addEdge(row.nodeId, r.code, r.target);
      if (e) es.push(e);
    }
    return { nodes: [Object.assign({}, row)], states, edges: es };
  }

  function onRel(rel) {
    if (done || !rel) return { nodes: [], states: [], edges: [] };
    const e = addEdge(rel.from, rel.code, rel.target);
    return { nodes: [], states: [], edges: e ? [e] : [] };
  }

  function subtreeIds(rootIds) {
    const set = new Set(rootIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of order) {
        const r = rows.get(id);
        if (!set.has(id) && set.has(r.parentId)) { set.add(id); grew = true; }
      }
    }
    return set;
  }

  function finish(arg) {
    const a = arg || {};
    done = true;
    const aborted = !!a.aborted;
    const truncated = !aborted && a.finishReason === "length";
    const hasKids = (id) => order.some((x) => rows.get(x).parentId === id);
    const discarded = new Set();
    let targetState = null;

    // length：最后接受节点的祖先链（任务内节点；目标仅当它没有任务外的子节点）回标 more
    const chain = new Set(truncated && lastId ? markTruncated(rows, lastId, targetId) : []);
    const targetOnChain = truncated && !target.hadChildren;

    if (!aborted) {
      // 第 2 门细则：非最末层的 '+' 叶（模型本可在本次给出子节点却没给）→ floor；截断链上的保持 more
      for (const id of order) {
        const r = rows.get(id);
        if (chain.has(id)) { r.state = "more"; continue; }
        if (hasKids(id)) r.state = "open";
        else if (r.state === "more" && relLevel.get(id) < levels) r.state = "floor";
      }
      // 第 3 门（仅 expand，非 force）
      if (kind === "expand" && !force && !truncated) {
        const direct = order.filter((x) => rows.get(x).parentId === targetId).map((x) => rows.get(x));
        const rc = recheckAfterExpand(target, direct);
        if (rc.floor) {
          for (const id of subtreeIds(rc.discard)) discarded.add(id);
          targetState = "floor";
        }
      }
    }

    const live = order.filter((id) => !discarded.has(id));
    const liveKidsOfTarget = live.filter((id) => rows.get(id).parentId === targetId);
    if (targetState == null) {
      if (targetOnChain) targetState = "more";
      else if (liveKidsOfTarget.length) targetState = "open";
      else if (aborted) targetState = target.hadChildren ? null : "more";
      else targetState = null; // outline 零产出：保持原状（more），由引擎决定是否提示
    }

    // 覆盖桩：非中断时，对目标（本任务区间）与本任务内每个有子节点的父，计算 ≥2 块连续缺口
    const stubs = [];
    if (!aborted) {
      const parents = [{ id: targetId, range: { blockFrom: target.blockFrom, blockTo: target.blockTo } }];
      for (const id of live) {
        const r = rows.get(id);
        parents.push({ id, range: { blockFrom: r.blockStart, blockTo: r.blockEnd } });
      }
      for (const p of parents) {
        if (chain.has(p.id) || (p.id === targetId && targetOnChain)) continue;
        const kids = live.filter((id) => rows.get(id).parentId === p.id).map((id) => rows.get(id));
        if (!kids.length) continue;
        stubs.push(...coverageStubs(p.id, p.range, kids.map((k) => ({ blockFrom: k.blockStart, blockTo: k.blockEnd })), { blocks, jobId }));
      }
    }

    const upserts = live.map((id) => Object.assign({}, rows.get(id))).concat(stubs);
    const states = targetState ? [{ nodeId: targetId, state: targetState }] : [];
    const edgeList = [...edges.values()].filter((e) => !discarded.has(e.fromId) && !discarded.has(e.toId));
    return { upserts, states, edges: edgeList, discarded: order.filter((id) => discarded.has(id)), stubs, targetState };
  }

  return { onNode, onRel, finish, rows: () => order.map((id) => Object.assign({}, rows.get(id))) };
}

// ---------- v1 适配（§2-2） ----------
function synthExplain(n) {
  const parts = [];
  if (n.centralQuestion) parts.push(`核心问题：${n.centralQuestion}`);
  if (n.mainMove) parts.push(`作者动作：${n.mainMove}`);
  if (n.progression) parts.push(`推进：${n.progression}`);
  if (n.relationToParent) parts.push(`与上级：${n.relationToParent}`);
  if (n.relationToSiblings) parts.push(`与同级：${n.relationToSiblings}`);
  return parts.length ? { text: parts.join("\n"), model: "v1", promptVersion: 0, at: null } : null;
}

function adaptV1Structure(structure, blocks) {
  const nodes = structure && Array.isArray(structure.nodes) ? structure.nodes : [];
  const valid = nodes.filter((n) => n && typeof n.id === "string" && n.id);
  const byId = new Map();
  for (const n of valid) if (!byId.has(n.id)) byId.set(n.id, n);
  const list = [...byId.values()];
  if (!list.length) return { rows: [], edges: [], rootId: null };
  let root = (structure.rootNodeId && byId.get(structure.rootNodeId)) || list.find((n) => !n.parentId || !byId.has(n.parentId)) || list[0];
  const rootId = root.id;
  // 父关系：parentId 为准；缺失/成环 → 挂根并加 warning
  const parent = new Map();
  const warn = new Map();
  for (const n of list) {
    if (n.id === rootId) { parent.set(n.id, null); continue; }
    if (n.parentId && byId.has(n.parentId) && n.parentId !== n.id) parent.set(n.id, n.parentId);
    else { parent.set(n.id, rootId); warn.set(n.id, "v1_orphan"); }
  }
  for (const n of list) {
    const seen = new Set();
    let cur = n.id;
    while (cur != null && !seen.has(cur)) { seen.add(cur); cur = parent.get(cur); }
    if (cur != null) { parent.set(n.id, rootId); warn.set(n.id, "v1_cycle"); }
  }
  const kids = new Map();
  for (const n of list) {
    const p = parent.get(n.id);
    if (p == null) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n.id);
  }
  // 同父顺序：先按父 childIds 出现序，再按原数组序
  const posInParent = new Map();
  for (const [p, arr] of kids) {
    const ci = (byId.get(p).childIds || []).map(String);
    const idx = (id) => { const k = ci.indexOf(id); return k < 0 ? ci.length + list.findIndex((x) => x.id === id) : k; };
    arr.sort((a, b) => idx(a) - idx(b));
    arr.forEach((id, i) => posInParent.set(id, i));
  }
  const rows = list.map((n) => {
    const spans = core.normalizeSpans(n.sourceSpans || []);
    const br = blocks && blocks.length ? blockRangeOfSpans(blocks, spans) : null;
    const hasKids = (kids.get(n.id) || []).length > 0;
    let state;
    if (hasKids) state = "open";
    else if (n.expandable !== false && spans.length) state = "more";
    else state = "floor";
    const warnings = Array.isArray(n.flags) ? n.flags.map(String) : [];
    if (warn.has(n.id)) warnings.push(warn.get(n.id));
    return makeRow({
      nodeId: n.id, parentId: parent.get(n.id), ord: posInParent.get(n.id) || 0,
      title: String(n.title || "（未命名）"), type: v1RoleToType(n.authorialRole),
      blockStart: br ? br.blockFrom : null, blockEnd: br ? br.blockTo : null, spans,
      state, source: "v1ext", warnings, explain: synthExplain(n),
    });
  });
  return { rows: preorder(rows), edges: [], rootId };
}

/** 叠加（v1 图 + 同 mapId 的 v2 深挖产物）：同 nodeId 后者覆盖；未被覆盖的基础行若成为叠加行的父 → open。
 *  叠加行自身状态原样保留（如 length 回标的 more）。 */
function overlayRows(baseRows, extraRows) {
  const map = new Map();
  for (const r of baseRows || []) map.set(r.nodeId, Object.assign({}, r));
  const overridden = new Set();
  for (const r of extraRows || []) { map.set(r.nodeId, Object.assign({}, r)); overridden.add(r.nodeId); }
  const extraParents = new Set();
  for (const r of extraRows || []) if (r.parentId != null) extraParents.add(r.parentId);
  for (const r of map.values()) if (!overridden.has(r.nodeId) && extraParents.has(r.nodeId)) r.state = "open";
  return preorder([...map.values()]);
}

// ---------- 结构语义包字段（§5.3-7） ----------
function deriveCardFields({ row, rows, blocks, linear, mapId } = {}) {
  if (!row) return null;
  const byId = new Map((rows || []).map((r) => [r.nodeId, r]));
  const chain = [];
  let cur = row.parentId != null ? byId.get(row.parentId) : null;
  const guard = new Set([row.nodeId]);
  while (cur && !guard.has(cur.nodeId)) {
    guard.add(cur.nodeId);
    chain.unshift({ title: cur.title, type: cur.type, authorialRole: typeToV1Role(cur.type) });
    cur = cur.parentId != null ? byId.get(cur.parentId) : null;
  }
  const children = sortRows((rows || []).filter((r) => r.parentId === row.nodeId && r.source !== "local"))
    .map((k) => ({ title: k.title, type: k.type, authorialRole: typeToV1Role(k.type) }));
  const evidence = [];
  const anchors = [];
  if (row.blockStart != null && row.blockEnd != null && blocks && blocks.length) {
    const inRange = blocks.filter((b) => b.no >= row.blockStart && b.no <= row.blockEnd);
    const text = linear && typeof linear.text === "string" ? linear.text : null;
    if (text) {
      for (const b of inRange) {
        if (evidence.length >= 3) break;
        if (b.heading) continue;
        evidence.push([...text.slice(b.start, b.end).replace(/\s+/g, " ").trim()].slice(0, 60).join(""));
      }
    }
    const units = linear && Array.isArray(linear.units) ? linear.units : [];
    for (const b of inRange) {
      const a = units[b.unit];
      if (a != null && !anchors.includes(a)) anchors.push(a);
    }
  }
  return {
    mindmapNodeId: `v2:${mapId}:${row.nodeId}`,
    title: row.title,
    type: row.type,
    authorialRole: typeToV1Role(row.type),
    explainText: row.explain && typeof row.explain.text === "string" ? row.explain.text : null,
    parentChain: chain,
    children,
    evidence,
    unitAnchors: anchors,
  };
}

// ---------- 缓存键（§4.5） ----------
function modelConfigHash({ model, reasoningEffort, maxTokens } = {}) {
  return sha256(JSON.stringify([
    String(model || ""), reasoningEffort == null ? null : String(reasoningEffort), ENGINE_VERSION,
    UNIT_BLOCKS_VERSION, OUTLINE_VERSION, maxTokens == null ? null : Number(maxTokens),
  ]));
}

function cacheKeyOf(p) {
  const o = p || {};
  const kind = o.kind === "expand" ? "expand" : "outline";
  let unitAnchor = `blk:${o.blockFrom}-${o.blockTo}`;
  if (kind === "expand") unitAnchor += `#${o.nodeId}`;
  return {
    documentId: o.documentId,
    unitAnchor,
    runKind: kind,
    granularity: "v2",
    promptScope: o.promptScope,
    promptVersion: o.promptVersion,
    textHash: sha256(o.userText == null ? "" : o.userText),
    provider: o.provider,
    model: o.model,
    modelConfigHash: modelConfigHash({ model: o.model, reasoningEffort: o.reasoningEffort, maxTokens: o.maxTokens }),
  };
}

module.exports = {
  ENGINE_VERSION, SCOPE_FLOOR_CHARS, SCOPE_SPLIT_CHARS, SCOPE_PART_MAX, STATES, SOURCES,
  V1_ROLE_TO_TYPE, TYPE_TO_V1_ROLE, v1RoleToType, typeToV1Role,
  extendUnitBlocks,
  buildSkeleton, planScopes, skeletonRows,
  buildAliasTable, outlineRefCandidates, expandRefCandidates,
  nodeStateOf, recheckAfterExpand, expandGate,
  createJobAssembler, coverageStubs, markTruncated,
  adaptV1Structure, overlayRows,
  deriveCardFields,
  modelConfigHash, cacheKeyOf,
  sha256, blockRangeOfSpans, rowDepth,
};
