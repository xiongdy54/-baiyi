"use strict";
// 导图 v2 内存版 store（node 可测；T3 引擎测试用它代替 better-sqlite3）。
//
// ── 与 electron/db.js 的对应关系（同名、同签名、同返回形态；IMPL-PLAN §3.2）──────────────────────────────
//   v2 新增  createMaterialMapV2 / commitMaterialMapJob / listMaterialMapNodes / listMaterialMapEdges /
//            setMaterialMapNodeExplain / setMaterialMapView / countMaterialMapCallsSince
//   版本行   saveMaterialMap / listMaterialMaps / getMaterialMap / getActiveMaterialMap / setActiveMaterialMap / deleteMaterialMap
//            （只实现 db.js 同名函数的引擎所需子集；getMaterialMap 额外返回 view、schemaVersion）
//   账本/缓存/运行  saveMaterialMapCall / listMaterialMapCalls / saveMaterialMapShard / getMaterialMapShard /
//            createMaterialMapRun / updateMaterialMapRun / getMaterialMapRun（返回字段与 db.js 一致，缺省 null）
//   工厂     createMemoryStore({ now? }) —— now 可注入假时钟（默认 Date.now）；另有 _dump() 仅供调试。
//
// ── 契约语义（会被 tests/m15v2.store.contract.cjs 锁定；真实 db 必须同样满足）──────────────────────────────
//   C1 createMaterialMapV2 不激活；返回 { mapId }；骨架节点入库；版本行 schemaVersion=2、structure 仅含元信息（无 nodes）。
//   C2 commitMaterialMapJob 原子：任一行非法（缺字段/非法 state/source）整体回滚，nodes/edges/node_count/激活均不变；
//      upsert 以 (mapId,nodeId) 为键，undefined 字段保持原值；jobId 缺省盖本次 jobId；edges 以 (from,to,code) 为键幂等。
//      返回 { nodeCount }（未删除节点数）；activate:true 才激活，且同 document+scope 其他激活版本降为历史（互斥）。
//   C3 listMaterialMapNodes 按 parent_id（NULL 在前）、ord、nodeId 升序；NodeRow 缺省字段为 null，spans/warnings/explain 为解析后的值。
//   C4 setMaterialMapNodeExplain / setMaterialMapView：对象存在返回 true、不存在返回 false；view 经 getMaterialMap 读回。
//   C5 deleteMaterialMap：物理删除该版本 nodes/edges，不触碰其它版本；删激活版本则同 scope 最新剩余版本顺延激活（沿用 v1 语义）。
//   C6 saveMaterialMapCall 新列（model/ttfnMs/lines/linesDropped/dropJson/relsDropped/reasoningChars/trigger）读回一致；
//      dropJson 以字符串存取（对象入参会 JSON.stringify）；countMaterialMapCallsSince 的 sinceMs 为绝对毫秒时间戳（created_at >= sinceMs）。
//   非契约（实现细节，不要在引擎里依赖）：id 的具体值、created_at 的取值、边列表在同毫秒下的稳定顺序（两者均按插入序）。
const crypto = require("crypto");

const STATES = new Set(["more", "open", "floor", "stub"]);
const SOURCES = new Set(["toc", "ai", "local", "v1ext"]);
const V2_GENERATOR = "m15v2-engine-1";

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const jsonOrNull = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };
const num = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const strOrNull = (v) => (v == null ? null : String(v));

function createMemoryStore({ now = () => Date.now() } = {}) {
  let seq = 0;
  let maps = [];   // 版本行（snake_case，与 db 列一一对应）
  let nodes = [];  // material_map_nodes 行
  let edges = [];
  const calls = [];
  const shards = new Map();
  const runs = new Map();

  function tx(fn) {
    const snap = { maps: clone(maps), nodes: clone(nodes), edges: clone(edges) };
    try { return fn(); } catch (e) { maps = snap.maps; nodes = snap.nodes; edges = snap.edges; throw e; }
  }

  // ---------- 版本行 ----------
  function mapRow(r, includeStructure) {
    const base = {
      id: r.id, documentId: r.document_id, scopeAnchor: r.scope_anchor, scopeKind: r.scope_kind,
      granularity: r.granularity, title: r.title, nodeCount: r.node_count,
      sourceRevisionHash: r.source_revision_hash, promptVersion: r.prompt_version,
      generatorVersion: r.generator_version, provider: r.provider, model: r.model,
      modelConfigHash: r.model_config_hash, nodeRemap: r.node_remap_json ? JSON.parse(r.node_remap_json) : null,
      isActive: !!r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
      schemaVersion: r.structure_json.startsWith('{"schemaVersion":2') ? 2 : 1,
      view: jsonOrNull(r.view_json)
    };
    if (includeStructure) base.structure = jsonOrNull(r.structure_json);
    return base;
  }
  const byNewest = (a, b) => b.created_at - a.created_at || b._seq - a._seq;
  const findMap = (id) => maps.find((m) => m.id === String(id));

  function insertMap(f) {
    const t = now();
    const row = {
      id: crypto.randomUUID(), _seq: ++seq, document_id: String(f.documentId),
      scope_anchor: f.scopeAnchor ?? "book", scope_kind: f.scopeKind ?? "book", granularity: f.granularity ?? "standard",
      title: f.title ?? null, structure_json: f.structureJson, node_count: f.nodeCount ?? 0,
      source_revision_hash: f.sourceRevisionHash ?? null,
      prompt_version: f.promptVersion !== null && f.promptVersion !== undefined && Number.isFinite(Number(f.promptVersion)) ? Number(f.promptVersion) : null,
      generator_version: f.generatorVersion ?? null, provider: f.provider ?? null, model: f.model ?? null,
      model_config_hash: f.modelConfigHash ?? null, node_remap_json: f.nodeRemap ? JSON.stringify(f.nodeRemap) : null,
      view_json: null, is_active: f.isActive ? 1 : 0, created_at: t, updated_at: t
    };
    maps.push(row);
    return row;
  }
  function deactivateOthers(row) {
    for (const m of maps) {
      if (m.id !== row.id && m.document_id === row.document_id && m.scope_anchor === row.scope_anchor && m.is_active) {
        m.is_active = 0; m.updated_at = now();
      }
    }
  }

  function saveMaterialMap({ documentId, scopeAnchor = "book", scopeKind = "book", granularity = "standard", title = null,
    structure, sourceRevisionHash = null, promptVersion = null, generatorVersion = null, provider = null, model = null,
    modelConfigHash = null, nodeRemap = null, isActive = true } = {}) {
    const st = structure ?? { nodes: [], edges: [] };
    const row = insertMap({
      documentId, scopeAnchor, scopeKind, granularity, title, structureJson: JSON.stringify(st),
      nodeCount: Array.isArray(st.nodes) ? st.nodes.length : 0, sourceRevisionHash, promptVersion, generatorVersion,
      provider, model, modelConfigHash, nodeRemap, isActive
    });
    if (isActive) deactivateOthers(row);
    return mapRow(row, true);
  }
  function listMaterialMaps(documentId, opts = {}) {
    return maps.filter((m) => m.document_id === String(documentId)).sort(byNewest).map((r) => mapRow(r, !!opts.includeStructure));
  }
  function getMaterialMap(id, opts = {}) {
    const r = findMap(id);
    return r ? mapRow(r, opts.includeStructure !== false) : null;
  }
  function getActiveMaterialMap(documentId, scopeAnchor) {
    const r = maps.filter((m) => m.document_id === String(documentId) && m.scope_anchor === String(scopeAnchor || "book") && m.is_active).sort(byNewest)[0];
    return r ? mapRow(r, true) : null;
  }
  function setActiveMaterialMap(id) {
    const r = findMap(id);
    if (!r) return null;
    deactivateOthers(r);
    r.is_active = 1; r.updated_at = now();
    return mapRow(r, false);
  }
  function deleteMaterialMap(id) {
    return tx(() => {
      const r = findMap(id);
      if (!r) return false;
      maps = maps.filter((m) => m.id !== r.id);
      nodes = nodes.filter((n) => n.map_id !== r.id);
      edges = edges.filter((e) => e.map_id !== r.id);
      if (r.is_active) {
        for (const m of maps) if (m.document_id === r.document_id && m.scope_anchor === r.scope_anchor) m.is_active = 0;
        const next = maps.filter((m) => m.document_id === r.document_id && m.scope_anchor === r.scope_anchor).sort(byNewest)[0];
        if (next) next.is_active = 1;
      }
      return true;
    });
  }

  // ---------- v2 节点/边 ----------
  function nodeRow(r) {
    return {
      nodeId: r.node_id, parentId: r.parent_id ?? null, ord: r.ord, title: r.title, type: r.type,
      time: r.time_text ?? null, pattern: r.pattern_hint ?? null, blockStart: r.block_start ?? null, blockEnd: r.block_end ?? null,
      spans: jsonOrNull(r.spans_json), state: r.state, source: r.source,
      warnings: jsonOrNull(r.warnings_json), explain: jsonOrNull(r.explain_json), jobId: r.job_id ?? null
    };
  }
  function upsertNode(mapId, row, jobId, t) {
    if (!row || row.nodeId == null || String(row.nodeId) === "") throw new Error("节点缺 nodeId");
    const nodeId = String(row.nodeId);
    const ex = nodes.find((n) => n.map_id === mapId && n.node_id === nodeId);
    const base = ex ? nodeRow(ex) : {
      nodeId, parentId: null, ord: undefined, title: undefined, type: undefined, time: null, pattern: null,
      blockStart: null, blockEnd: null, spans: null, state: undefined, source: undefined, warnings: null, explain: null, jobId: null
    };
    for (const k of Object.keys(base)) if (k !== "nodeId" && row[k] !== undefined) base[k] = row[k];
    if (row.jobId === undefined && jobId != null) base.jobId = String(jobId);
    if (!Number.isFinite(Number(base.ord))) throw new Error("节点 " + nodeId + " 缺有限 ord");
    if (typeof base.title !== "string" || typeof base.type !== "string" || !base.type) throw new Error("节点 " + nodeId + " 缺 title/type");
    if (!STATES.has(base.state)) throw new Error("节点 " + nodeId + " state 非法: " + base.state);
    if (!SOURCES.has(base.source)) throw new Error("节点 " + nodeId + " source 非法: " + base.source);
    const vals = {
      parent_id: strOrNull(base.parentId), ord: Number(base.ord), title: base.title, type: base.type,
      time_text: strOrNull(base.time), pattern_hint: strOrNull(base.pattern),
      block_start: num(base.blockStart), block_end: num(base.blockEnd),
      spans_json: base.spans == null ? null : JSON.stringify(base.spans), state: base.state, source: base.source,
      warnings_json: base.warnings == null ? null : JSON.stringify(base.warnings),
      explain_json: base.explain == null ? null : JSON.stringify(base.explain), job_id: strOrNull(base.jobId)
    };
    if (ex) Object.assign(ex, vals, { updated_at: t, is_deleted: 0 });
    else nodes.push({ map_id: mapId, node_id: nodeId, _seq: ++seq, ...vals, created_at: t, updated_at: t, is_deleted: 0 });
  }
  function upsertEdge(mapId, e, jobId, t) {
    if (!e || e.fromId == null || e.toId == null || !e.code) throw new Error("边缺 fromId/toId/code");
    const from = String(e.fromId), to = String(e.toId), code = String(e.code);
    const origin = e.origin ? String(e.origin) : "text";
    const jid = e.jobId !== undefined ? strOrNull(e.jobId) : strOrNull(jobId);
    const ex = edges.find((x) => x.map_id === mapId && x.from_id === from && x.to_id === to && x.code === code);
    if (ex) Object.assign(ex, { origin, job_id: jid, is_deleted: 0 });
    else edges.push({ map_id: mapId, from_id: from, to_id: to, code, origin, job_id: jid, created_at: t, _seq: ++seq, is_deleted: 0 });
  }
  const liveCount = (mapId) => nodes.filter((n) => n.map_id === mapId && !n.is_deleted).length;

  function createMaterialMapV2({ documentId, title = null, meta = {}, skeleton = [], sourceRevisionHash = null,
    provider = null, model = null, modelConfigHash = null, promptVersion = null } = {}) {
    if (documentId == null || String(documentId) === "") throw new Error("createMaterialMapV2 缺 documentId");
    return tx(() => {
      const structure = Object.assign({ schemaVersion: 2 }, meta || {}, { schemaVersion: 2 });
      const row = insertMap({
        documentId, scopeAnchor: "book", scopeKind: "book", granularity: "v2", title: title ?? structure.title ?? null,
        structureJson: JSON.stringify(structure), sourceRevisionHash, promptVersion, generatorVersion: V2_GENERATOR,
        provider, model, modelConfigHash, isActive: false
      });
      const t = now();
      for (const r of Array.isArray(skeleton) ? skeleton : []) upsertNode(row.id, r, null, t);
      row.node_count = liveCount(row.id);
      return { mapId: row.id };
    });
  }
  function commitMaterialMapJob({ mapId, jobId = null, upserts = [], states = [], edges: edgeRows = [], activate = false } = {}) {
    const id = String(mapId);
    return tx(() => {
      const m = findMap(id);
      if (!m) throw new Error("commitMaterialMapJob：版本不存在 " + id);
      const t = now();
      for (const r of upserts || []) upsertNode(id, r, jobId, t);
      for (const st of states || []) {
        if (!st || st.nodeId == null) continue;
        if (!STATES.has(st.state)) throw new Error("state 非法: " + st.state);
        const n = nodes.find((x) => x.map_id === id && x.node_id === String(st.nodeId) && !x.is_deleted);
        if (n) { n.state = st.state; n.updated_at = t; }
      }
      for (const e of edgeRows || []) upsertEdge(id, e, jobId, t);
      m.node_count = liveCount(id);
      m.updated_at = t;
      if (activate) { deactivateOthers(m); m.is_active = 1; }
      return { nodeCount: m.node_count };
    });
  }
  function listMaterialMapNodes(mapId) {
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return nodes.filter((n) => n.map_id === String(mapId) && !n.is_deleted)
      .sort((a, b) => {
        if ((a.parent_id == null) !== (b.parent_id == null)) return a.parent_id == null ? -1 : 1;
        return (a.parent_id == null ? 0 : cmp(a.parent_id, b.parent_id)) || a.ord - b.ord || cmp(a.node_id, b.node_id);
      }).map(nodeRow);
  }
  function listMaterialMapEdges(mapId) {
    return edges.filter((e) => e.map_id === String(mapId) && !e.is_deleted).sort((a, b) => a.created_at - b.created_at || a._seq - b._seq)
      .map((e) => ({ fromId: e.from_id, toId: e.to_id, code: e.code, origin: e.origin, jobId: e.job_id ?? null }));
  }
  function setMaterialMapNodeExplain(mapId, nodeId, explain) {
    const n = nodes.find((x) => x.map_id === String(mapId) && x.node_id === String(nodeId) && !x.is_deleted);
    if (!n) return false;
    n.explain_json = explain == null ? null : JSON.stringify(explain);
    n.updated_at = now();
    return true;
  }
  function setMaterialMapView(mapId, view) {
    const m = findMap(mapId);
    if (!m) return false;
    m.view_json = view == null ? null : JSON.stringify(view);
    m.updated_at = now();
    return true;
  }

  // ---------- 账本 / 缓存 / 运行 ----------
  function saveMaterialMapCall(p = {}) {
    const id = crypto.randomUUID();
    const dj = p.dropJson;
    calls.push({
      id, _seq: ++seq, runId: String(p.runId), documentId: String(p.documentId), runKind: String(p.runKind ?? "other"),
      nodeAnchor: String(p.nodeAnchor || ""), spanHash: p.spanHash ? String(p.spanHash) : null, chars: num(p.chars),
      outcome: String(p.outcome ?? "completed"), errorCode: p.errorCode ? String(p.errorCode) : null,
      finishReason: p.finishReason ? String(p.finishReason) : null, attempt: Number.isFinite(Number(p.attempt)) ? Number(p.attempt) : 1,
      wallMs: num(p.wallMs), ttftMs: num(p.ttftMs), firstByteMs: num(p.firstByteMs), depth: num(p.depth),
      parentNodeId: p.parentNodeId ? String(p.parentNodeId) : null, spanChars: num(p.spanChars),
      promptTokens: num(p.promptTokens), completionTokens: num(p.completionTokens), createdAt: now(),
      model: p.model ? String(p.model) : null, ttfnMs: num(p.ttfnMs), lines: num(p.lines), linesDropped: num(p.linesDropped),
      dropJson: dj == null ? null : typeof dj === "string" ? dj : JSON.stringify(dj),
      relsDropped: num(p.relsDropped), reasoningChars: num(p.reasoningChars), trigger: p.trigger ? String(p.trigger) : null
    });
    return id;
  }
  function listMaterialMapCalls(runId, limit = 2000) {
    return calls.filter((c) => c.runId === String(runId)).sort((a, b) => a.createdAt - b.createdAt || a._seq - b._seq)
      .slice(0, Math.max(1, Number(limit) || 2000)).map(({ _seq, ...c }) => ({ ...c }));
  }
  function countMaterialMapCallsSince(documentId, { trigger, sinceMs } = {}) {
    return calls.filter((c) => c.documentId === String(documentId)
      && (trigger == null || c.trigger === String(trigger))
      && (!Number.isFinite(Number(sinceMs)) || c.createdAt >= Number(sinceMs))).length;
  }
  const shardKey = (k) => JSON.stringify([String(k.documentId), String(k.unitAnchor), String(k.runKind), String(k.granularity),
    String(k.promptScope), Number(k.promptVersion) || 0, String(k.textHash), String(k.provider), String(k.model), String(k.modelConfigHash)]);
  function getMaterialMapShard(key = {}) {
    const s = shards.get(shardKey(key));
    return s ? clone(s) : null;
  }
  function saveMaterialMapShard(p = {}) {
    const k = shardKey(p);
    const ex = shards.get(k);
    shards.set(k, {
      id: ex ? ex.id : crypto.randomUUID(), documentId: String(p.documentId), unitAnchor: String(p.unitAnchor), runKind: String(p.runKind),
      granularity: String(p.granularity), promptScope: String(p.promptScope), promptVersion: Number(p.promptVersion) || 0,
      textHash: String(p.textHash), provider: String(p.provider), model: String(p.model), modelConfigHash: String(p.modelConfigHash),
      content: clone(p.content ?? null), chars: num(p.chars) ?? (ex ? ex.chars : null), tokenUsed: num(p.tokenUsed) ?? (ex ? ex.tokenUsed : null),
      updatedAt: now()
    });
    return getMaterialMapShard(p);
  }
  function createMaterialMapRun({ documentId, scopeAnchor = "book", scopeKind = "book", granularity = "standard", input = null } = {}) {
    const t = now();
    const r = {
      id: crypto.randomUUID(), documentId: String(documentId), scopeAnchor: String(scopeAnchor), scopeKind: String(scopeKind),
      granularity: String(granularity), status: "pending", stage: null, callsPlanned: null, callsDone: null, chars: null,
      estInputTokens: null, estOutputTokens: null, estCost: null, currency: null, actualPromptTokens: null,
      actualCompletionTokens: null, actualCost: null, repairCount: 0, provider: null, model: null, modelConfigHash: null,
      promptVersion: null, errorCode: null, errorText: null, input: clone(input ?? null), output: null, createdAt: t, updatedAt: t
    };
    runs.set(r.id, r);
    return clone(r);
  }
  function updateMaterialMapRun(id, patch = {}) {
    const r = runs.get(String(id));
    if (!r) return null;
    let touched = false;
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined || !(k in r) || k === "id" || k === "documentId" || k === "createdAt" || k === "updatedAt") continue;
      r[k] = (k === "input" || k === "output") ? clone(patch[k] ?? null) : patch[k];
      touched = true;
    }
    if (touched) r.updatedAt = now();
    return clone(r);
  }
  function getMaterialMapRun(id) {
    const r = runs.get(String(id));
    return r ? clone(r) : null;
  }

  return {
    createMaterialMapV2, commitMaterialMapJob, listMaterialMapNodes, listMaterialMapEdges,
    setMaterialMapNodeExplain, setMaterialMapView, countMaterialMapCallsSince,
    saveMaterialMap, listMaterialMaps, getMaterialMap, getActiveMaterialMap, setActiveMaterialMap, deleteMaterialMap,
    saveMaterialMapCall, listMaterialMapCalls, saveMaterialMapShard, getMaterialMapShard,
    createMaterialMapRun, updateMaterialMapRun, getMaterialMapRun,
    _dump: () => clone({ maps, nodes, edges, calls }),
  };
}

module.exports = { createMemoryStore };
