// @runtime: node
"use strict";
// 材料导图 v2 · 主进程引擎（D192 / MINDMAP-V2-IMPL-PLAN §2、§4.2、§4.5–4.10；T3）。
// 依赖全部注入（store / chatStream / 设置 / AI 配置 / 提示词 / 广播 / 时钟），node 可测；不 require electron / db.js / ai.js。
// T4 接线：main.js 以 createMindmapEngineV2(deps) 建一个单例，每个方法外包一层 ipcMain.handle(`mindmap:<方法名>`, (_e, p) => engine.<方法名>(p))。
//
// ===================== deps =====================
//   store                 db.js 子集（同名同签名；内存版 tests/lib/mindmapMemoryStore.cjs）：
//                         createMaterialMapV2 / commitMaterialMapJob（含 replaceSubtrees，见 C7）/ listMaterialMapNodes /
//                         listMaterialMapEdges / setMaterialMapNodeExplain / setMaterialMapView / countMaterialMapCallsSince /
//                         getMaterialMap / getActiveMaterialMap / deleteMaterialMap / saveMaterialMapCall / listMaterialMapCalls /
//                         getMaterialMapShard / saveMaterialMapShard / createMaterialMapRun / updateMaterialMapRun / getMaterialMapRun /
//                         listMaterialMapRuns?（可选；仅 graphMetrics 重启后重聚合用）
//   chatStream(opts, send) ai.js 同形态：opts={ messages, temperature, abortSignal, retry:{maxAttempts,onRetry}, model, maxTokens }；
//                         send({delta?, thinking?(累计字数)})；resolve { usage, finishReason, ttftMs, firstByteMs }；
//                         reject Error{code:'cancelled'|'rate_limit'|'network'|…, streamStarted?}
//   readSettings() -> { app: {...} }        原始设置对象（main.js readSettings）；统一经 readMindmapSettings() 归一
//   getAIConfig() -> { preset, model, reasoningEffort }
//   getPromptTemplate(scope) -> { content, version } | null   scope ∈ material-map-outline / -expand / -explain；缺省回退 prompts.js 常量
//   broadcastChanged(payload)              → 'mindmap:changed'（仅「生成整图」「深挖全部」两类 run）
//   broadcastDelta(payload)                → 'mindmap:delta'
//   now?() / setTimeout? / clearTimeout?   默认全局；增量批次节流用
//   supportsReasoningEffort?(model)        默认与 ai.js 同正则（仅 GLM-5.2+ 计入缓存键）
//   scheduler?                             默认 createScheduler({ maxConcurrency: 设置值, now })
//
// ===================== 方法（与 §4.2 IPC 一一对应） =====================
//   graphLoad(mapId | {documentId} | {mapId}) -> { meta, nodes: V2Node[], edges: V2Edge[], view, textReady }
//   graphFeed({ documentId, title, tocItems, unitAnchors, index, text, last }) -> { blocksReady, scopesReady }
//       严格文档顺序；同 index 同文本重送＝幂等（页签重挂载）；index 0 且目录变化＝重建会话；乱序抛 code 'out_of_order'
//   graphEstimate({ documentId }) -> { scopes, chars, estPromptTokens, estCompletionTokens, model, concurrency, textReady, floorScopes }
//   graphGenerate({ documentId, title?, force? }) -> { runId, mapId }     立即返回；force＝不读缓存（整图重算）；同文档已在生成＝返回该 run
//   graphExpand({ mapId, nodeId, trigger:'click'|'prefetch'|'all', force? })
//       -> { jobId, skipped?: 'floor'|'cached'|'quota'|'busy'|'disabled'|'no_text', waiting?: true }
//       floor＝封顶（零调用）；cached＝已展开（open）；busy＝同节点已在排队/运行；disabled＝预取关闭或未获同意（X4）；
//       no_text＝预取时原文未到；waiting＝点击时原文未到（graphFeed 送到后自动放行，沿用该 jobId 若未被去重）
//       目录作用域节点尚未 outline → 改排其 outline（P0 提档）；force 跳过第 ②③ 门（第 ① 门恒生效）
//   graphExpandAll({ mapId }) -> { runId, queued }                        预算 app.mindmapMaxCalls（按任务数）；逐波推进
//   graphExplain({ mapId, nodeId }) -> { jobId, waiting? } | { cached: true, explain }
//   graphCancel({ jobId?, runId?, mapId? }) -> true
//   graphResume({ runId }) -> { queued }                                  仅 input_json.engine==='v2' 的 run；生成：重排尚未 outline 的作用域
//   graphSetView({ mapId, view }) -> true
//   graphMetrics({ mapId }) -> RunMetrics                                 内存优先；重启后由账本 + run.output 重聚合
//   graphNodeText({ mapId, nodeId }) -> { text, unitAnchor }              区间原文，零 AI；原文未到 → { text:null, unitAnchor:null }
//   另：readMindmapSettings() -> MindmapSettings；idle() -> Promise（测试用：调度器排空）；scheduler（只读引用）
//
// ===================== 广播 =====================
//   mindmap:delta  { documentId, mapId, jobId, kind:'outline'|'expand'|'explain'|'skeleton'|'run',
//                    nodes?: V2Node[], states?: {id,state}[], edges?: V2Edge[], explainDelta?: {nodeId,text(增量)},
//                    removed?: string[]（扩展：整枝替换残留 / 提交失败的流式节点，渲染层须删除）,
//                    jobDone?: { ok, error?, finishReason, cached, aborted, skipped?, activated? },
//                    runDone?: { stage, deleted }（扩展：kind='run'）, metrics?: RunMetrics }
//                  流式期间 ≤100ms 一批（首批立即发）；任务开始先发目标 state='streaming'；jobDone 批携带本任务权威全集
//                  （nodes＝已提交 upserts，states 含目标最终态）。expand（非 force）在第 3 门确定不触发前暂扣节点，
//                  故被第 3 门丢弃的子节点从不下发。
//   mindmap:changed { runId, documentId, title, stage: running|completed|partial|cancelled|failed, done, total, calls,
//                    budget?, mapId（生成失败且版本被删除时为 null）, published, label（「框架 3/12 段」/「深挖 3/12 段」）, code? }
//
// V2Node = { id, parentId, ord, title, type, timeText, patternHint, blockStart, blockEnd, spans, state, source, warnings, explain(string|null), jobId }
// V2Edge = { from, to, code, origin, jobId }
// RunMetrics = { model, startedAt, ttfnMs, firstTtftMs, frameworkMs, calls, cacheHits, promptTokens, completionTokens,
//                reasoningChars, lines, linesDropped, byReason, relsDropped, concurrencyNow, rateLimitDowngrades }

const Core = require("./mindmapCore.js");
const V = require("./mindmapV2Core.js");
const B = require("./mindmapBlocks.js");
const O = require("./mindmapOutline.js");
const P = require("./mindmapV2Prompts.js");
const { createScheduler, PRIORITY } = require("./mindmapScheduler.js");

const SCOPE = Object.freeze({ outline: "material-map-outline", expand: "material-map-expand", explain: "material-map-explain" });
const MAX_TOKENS = Object.freeze({ outline: 3000, expand: 1500, explain: 1200 });
const TEMPERATURE = 0.3;
const DELTA_MS = 100;
const MAX_SESSIONS = 3;
const TRIGGERS = new Set(["click", "prefetch", "all"]);

// ---------- 设置归一（§5.5） ----------
function normalizeMindmapSettings(settings) {
  const app = settings && typeof settings === "object" && settings.app && typeof settings.app === "object" ? settings.app : {};
  const int = (v, lo, hi, d) => {
    if (v === null || v === "" || typeof v === "boolean" || v === undefined) return d;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : d;
  };
  const pf = app.mindmapPrefetch && typeof app.mindmapPrefetch === "object" && !Array.isArray(app.mindmapPrefetch) ? app.mindmapPrefetch : {};
  const mc = Number(app.mindmapMaxCalls);
  return {
    model: typeof app.mindmapModel === "string" ? app.mindmapModel.trim() : "", // 空＝跟随全局
    concurrency: int(app.mindmapConcurrency, 1, 8, 4),
    maxCalls: app.mindmapMaxCalls !== null && Number.isFinite(mc) && mc > 0 ? Math.floor(mc) : 300,
    retryMax: int(app.mindmapRetryMax, 0, 5, 3),
    prefetch: { enabled: pf.enabled !== false, dailyLimit: int(pf.dailyLimit, 0, 100000, 30) },
    explainAuto: app.mindmapExplainAuto === true,
  };
}

function defaultSupportsRE(model) {
  const m = String(model || "").toLowerCase();
  return /(^|\/)z-ai\/glm-5\.[2-9]/.test(m) || /(^|\/)glm-5\.[2-9]/.test(m) || /(^|\/)zai-org\/glm-5\.[2-9]/.test(m);
}

// ---------- DTO ----------
function toV2Node(r) {
  return {
    id: r.nodeId, parentId: r.parentId == null ? null : r.parentId, ord: r.ord, title: r.title, type: r.type,
    timeText: r.time == null ? null : r.time, patternHint: r.pattern == null ? null : r.pattern,
    blockStart: r.blockStart == null ? null : r.blockStart, blockEnd: r.blockEnd == null ? null : r.blockEnd,
    spans: r.spans == null ? null : r.spans, state: r.state, source: r.source, warnings: r.warnings == null ? null : r.warnings,
    explain: r.explain && typeof r.explain.text === "string" ? r.explain.text : null, jobId: r.jobId == null ? null : r.jobId,
  };
}
function toV2Edge(e) {
  return { from: e.fromId, to: e.toId, code: e.code, origin: e.origin || "text", jobId: e.jobId == null ? null : e.jobId };
}

function codeErr(code, msg) {
  const e = new Error(msg || code);
  e.code = code;
  return e;
}
const numOrNull = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function estimateTokens(text) {
  let cjk = 0, ascii = 0;
  for (const ch of String(text || "")) {
    if (/[一-鿿぀-ヿ가-힯]/.test(ch)) cjk++;
    else if (/\S/.test(ch)) ascii++;
  }
  return Math.ceil(cjk * 0.7 + ascii * 0.25);
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sortByOrd(rows) {
  return rows.slice().sort((a, b) => (a.ord - b.ord) || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
}

/** 已接受原始行（缓存回放用）：全文按行切，去掉空行与被解析器丢弃的行（多重集合相减）。回放产出与首次逐节点一致。 */
function acceptedLines(raw, droppedRaws) {
  const bag = new Map();
  for (const d of droppedRaws) bag.set(d, (bag.get(d) || 0) + 1);
  const out = [];
  for (const line of String(raw || "").split("\n")) {
    if (!line.trim()) continue;
    const n = bag.get(line) || 0;
    if (n > 0) { bag.set(line, n - 1); continue; }
    out.push(line);
  }
  return out;
}

/** 某节点在给定行集中的后代（谓词筛选；遇不满足者停止下探） */
function descendantsOf(rows, rootId, pred) {
  const kids = new Map();
  for (const r of rows) {
    if (r.parentId == null) continue;
    if (!kids.has(r.parentId)) kids.set(r.parentId, []);
    kids.get(r.parentId).push(r);
  }
  const out = [];
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const p = stack.pop();
    for (const k of kids.get(p) || []) {
      if (seen.has(k.nodeId) || !pred(k)) continue;
      seen.add(k.nodeId);
      out.push(k.nodeId);
      stack.push(k.nodeId);
    }
  }
  return out;
}

/** 已 outline 过的作用域 id：AI 节点路径首段（t3 / t3p2）。 */
function outlinedScopeIds(rows) {
  const s = new Set();
  for (const r of rows) if (r.source === "ai") s.add(String(r.nodeId).split(".")[0]);
  return s;
}

function createMindmapEngineV2(deps) {
  const d = deps || {};
  const store = d.store;
  const chatStream = d.chatStream;
  if (!store || typeof chatStream !== "function") throw new Error("createMindmapEngineV2 需要 store 与 chatStream");
  const now = typeof d.now === "function" ? d.now : () => Date.now();
  const setT = typeof d.setTimeout === "function" ? d.setTimeout : setTimeout;
  const clearT = typeof d.clearTimeout === "function" ? d.clearTimeout : clearTimeout;
  const supportsRE = typeof d.supportsReasoningEffort === "function" ? d.supportsReasoningEffort : defaultSupportsRE;
  const emitChanged = (p) => { try { if (d.broadcastChanged) d.broadcastChanged(p); } catch { /* 广播失败不影响任务 */ } };
  const emitDelta = (p) => { try { if (d.broadcastDelta) d.broadcastDelta(p); } catch { /* 同上 */ } };

  function readMindmapSettings() {
    let raw = null;
    try { raw = d.readSettings ? d.readSettings() : null; } catch { raw = null; }
    return normalizeMindmapSettings(raw);
  }

  const scheduler = d.scheduler || createScheduler({ maxConcurrency: readMindmapSettings().concurrency, now });

  const sessions = new Map(); // documentId → Session（LRU：Map 插入序）
  const waiters = new Map(); // documentId → [{ id, mapId, fn }]（等待原文）
  const gens = new Map(); // runId → 生成整图 run
  const alls = new Map(); // runId → 深挖全部 run
  const jobs = new Map(); // jobId → { key, kind, mapId, nodeId, runId }
  const interactiveRuns = new Map(); // mapId → runId（交互容器 run）
  const metricsByMap = new Map();
  const consent = new Set(); // X4：本会话用户主动发过 AI 请求的 mapId
  let jobSeq = 0;
  const newJobId = () => `j${now().toString(36)}${(++jobSeq).toString(36)}`;

  // ---------- AI 配置 / 提示词 ----------
  function aiInfo() {
    const settings = readMindmapSettings();
    let cfg = {};
    try { cfg = (d.getAIConfig && d.getAIConfig()) || {}; } catch { cfg = {}; }
    const model = settings.model || String(cfg.model || "");
    return {
      settings, provider: String(cfg.preset || "custom"), model,
      reasoningEffort: supportsRE(model) ? String(cfg.reasoningEffort || "low") : null,
    };
  }
  function promptOf(kind) {
    const scope = SCOPE[kind];
    let row = null;
    try { row = d.getPromptTemplate ? d.getPromptTemplate(scope) : null; } catch { row = null; }
    const fallback = kind === "outline" ? P.OUTLINE_SYSTEM : kind === "expand" ? P.EXPAND_SYSTEM : P.EXPLAIN_SYSTEM;
    const content = row && typeof row.content === "string" && row.content.trim() ? row.content : fallback;
    const version = row && Number.isFinite(Number(row.version)) ? Number(row.version) : P.PROMPT_VERSION;
    return { scope, content, version };
  }

  // ---------- 指标 ----------
  function newMetrics(model) {
    const st = scheduler.stats();
    return {
      model: model || "", startedAt: now(), ttfnMs: null, firstTtftMs: null, frameworkMs: null, calls: 0, cacheHits: 0,
      promptTokens: 0, completionTokens: 0, reasoningChars: 0, lines: 0, linesDropped: 0, byReason: {}, relsDropped: 0,
      concurrencyNow: st.concurrencyNow, rateLimitDowngrades: st.rateLimitDowngrades,
    };
  }
  function metricsFor(mapId, model) {
    let m = metricsByMap.get(mapId);
    if (!m) { m = newMetrics(model); metricsByMap.set(mapId, m); }
    if (model) m.model = model;
    return m;
  }
  function metricsSnap(m) {
    const st = scheduler.stats();
    return Object.assign(JSON.parse(JSON.stringify(m)), { concurrencyNow: st.concurrencyNow, rateLimitDowngrades: st.rateLimitDowngrades });
  }

  // ---------- 会话（原文常驻内存，LRU 3 文档；原文不入库） ----------
  const tocKeyOf = (p) => V.sha256(JSON.stringify([p.tocItems || [], (p.unitAnchors || []).map(String)]));
  function newSession(p) {
    const skeleton = V.buildSkeleton({ title: p.title, tocItems: p.tocItems || [], unitAnchors: p.unitAnchors || [] });
    return {
      documentId: String(p.documentId), title: String(p.title || "").trim() || skeleton.title, tocKey: tocKeyOf(p), skeleton,
      units: skeleton.units, texts: [], unitsReady: 0, complete: skeleton.units.length === 0,
      linear: Core.buildLinearization([], new Map()), blocks: [], scopes: [], revisionHash: null,
      // outline 可引用清单只取骨架目录节点，按目录先序（确定性，与原文送入进度无关——交接要点 3）
      refRows: skeleton.nodes.map((n, i) => ({ nodeId: n.nodeId, parentId: n.parentId, ord: i, title: n.title, source: "toc" })),
    };
  }
  function docBusy(docId) {
    for (const G of gens.values()) if (G.documentId === docId) return true;
    for (const E of alls.values()) if (E.documentId === docId) return true;
    if ((waiters.get(docId) || []).length) return true;
    return scheduler.entries().some((e) => e.meta && e.meta.documentId === docId);
  }
  function touch(S) {
    sessions.delete(S.documentId);
    sessions.set(S.documentId, S);
    if (sessions.size <= MAX_SESSIONS) return;
    for (const [id] of sessions) {
      if (sessions.size <= MAX_SESSIONS) break;
      if (id !== S.documentId && !docBusy(id)) sessions.delete(id);
    }
  }

  function addWaiter(docId, mapId, id, fn) {
    if (!waiters.has(docId)) waiters.set(docId, []);
    waiters.get(docId).push({ id, mapId, fn });
  }
  function runWaiters(docId) {
    const list = waiters.get(docId);
    if (!list || !list.length) return;
    waiters.set(docId, []);
    const keep = [];
    for (const w of list) {
      let done = true;
      try { done = !!w.fn(); } catch { done = true; }
      if (!done) keep.push(w);
    }
    waiters.set(docId, keep.concat(waiters.get(docId) || []));
  }
  function dropWaiters(pred) {
    for (const [doc, list] of waiters) waiters.set(doc, list.filter((w) => !pred(w)));
  }

  function graphFeed(p) {
    const o = p || {};
    if (o.documentId == null || String(o.documentId) === "") throw codeErr("bad_args", "graphFeed 缺 documentId");
    const docId = String(o.documentId);
    const index = Number(o.index);
    if (!Number.isInteger(index) || index < 0) throw codeErr("bad_index", "graphFeed index 非法");
    const text = String(o.text == null ? "" : o.text);
    let S = sessions.get(docId);
    if (S && S.tocKey !== tocKeyOf(o)) {
      if (index !== 0) throw codeErr("feed_conflict", "目录已变化，须从第 0 个单元重新送入");
      S = null;
    }
    if (S && index < S.unitsReady) {
      if (S.texts[index] === text) { touch(S); return feedResult(S); } // 重挂载重送：幂等
      if (index !== 0) throw codeErr("feed_conflict", "同一单元原文不一致，须从第 0 个单元重新送入");
      S = null;
    }
    if (!S) {
      if (index !== 0) throw codeErr("out_of_order", "原文须按文档顺序从第 0 个单元送入");
      S = newSession(o);
    }
    touch(S);
    if (o.title && String(o.title).trim()) S.title = String(o.title).trim();
    if (index > S.unitsReady) throw codeErr("out_of_order", `原文须按文档顺序送入（期待 ${S.unitsReady}，收到 ${index}）`);
    if (index >= S.units.length) throw codeErr("bad_index", "graphFeed index 超出单元数");
    S.texts[index] = text;
    S.unitsReady = index + 1;
    const tb = new Map();
    for (let i = 0; i < S.unitsReady; i++) tb.set(S.units[i], S.texts[i]);
    S.linear = Core.buildLinearization(S.units.slice(0, S.unitsReady), tb);
    S.blocks = V.extendUnitBlocks(S.blocks, S.linear);
    const becameComplete = !S.complete && (!!o.last || S.unitsReady >= S.units.length);
    if (becameComplete) {
      S.complete = true;
      S.revisionHash = V.sha256(JSON.stringify([S.units, S.linear.text]));
    }
    const prev = new Set(S.scopes.map((s) => s.scopeId));
    S.scopes = V.planScopes(S.skeleton, S.blocks, S.complete ? Infinity : S.unitsReady);
    const fresh = S.scopes.filter((s) => !prev.has(s.scopeId));
    for (const G of [...gens.values()]) {
      if (G.S !== S || G.finished) continue;
      genRelease(G, fresh);
      if (S.complete && !G.skeletonFinal) { G.skeletonFinal = true; refreshSkeleton(G.mapId, S); }
      genMaybeFinish(G);
    }
    runWaiters(docId);
    return feedResult(S);
  }
  const feedResult = (S) => ({ blocksReady: S.blocks.length, scopesReady: S.scopes.length });

  /** 交接要点 4：原文送完后重算骨架行（blockStart/ord/state）并按同 id upsert；有 AI 子节点的目录行保留其状态。 */
  function refreshSkeleton(mapId, S) {
    let stored;
    try { stored = store.listMaterialMapNodes(mapId); } catch { return; }
    const aiParents = new Set(stored.filter((r) => r.source !== "toc").map((r) => r.parentId));
    const rows = V.skeletonRows(S.skeleton, S.blocks, Infinity, S.scopes);
    const upserts = rows.map((r) => Object.assign({}, r, { explain: undefined, jobId: undefined, state: aiParents.has(r.nodeId) ? undefined : r.state }));
    try { store.commitMaterialMapJob({ mapId, jobId: null, upserts }); } catch { return; }
    const busy = new Set(scheduler.entries().filter((e) => e.status === "running" && e.meta && e.meta.mapId === mapId).map((e) => e.meta.nodeId));
    const after = store.listMaterialMapNodes(mapId).filter((r) => r.source === "toc" && !busy.has(r.nodeId));
    emitDelta({ documentId: S.documentId, mapId, jobId: null, kind: "skeleton", nodes: after.map(toV2Node) });
  }

  // ---------- 读图 ----------
  function loadGraph(mapId) {
    const map = store.getMaterialMap(String(mapId));
    if (!map) return null;
    const S = sessions.get(String(map.documentId)) || null;
    const stored = store.listMaterialMapNodes(map.id);
    const edges = store.listMaterialMapEdges(map.id);
    const v1 = map.schemaVersion !== 2;
    let rows;
    if (!v1) rows = stored;
    else {
      const blocks = S && S.complete ? S.blocks : null;
      rows = V.overlayRows(V.adaptV1Structure(map.structure, blocks).rows, stored);
    }
    return { map, S, rows, edges, v1, stored, byId: new Map(rows.map((r) => [r.nodeId, r])) };
  }
  function blocksFor(g) {
    if (!g.S) return null;
    if (g.v1) return g.S.complete ? g.S.blocks : null;
    return g.S.blocks;
  }
  function metaOf(map) {
    const st = map.schemaVersion === 2 && map.structure && typeof map.structure === "object" ? map.structure : {};
    return Object.assign({}, st, {
      schemaVersion: map.schemaVersion, mapId: map.id, documentId: map.documentId,
      title: map.title || st.title || "", model: st.model || map.model || "", isActive: !!map.isActive,
      generating: !!genByMap(map.id),
    });
  }

  function graphLoad(arg) {
    let map = null;
    if (typeof arg === "string" || typeof arg === "number") map = store.getMaterialMap(String(arg));
    else if (arg && arg.mapId != null) map = store.getMaterialMap(String(arg.mapId));
    else if (arg && arg.documentId != null) map = store.getActiveMaterialMap(String(arg.documentId), "book");
    const docId = map ? String(map.documentId) : arg && arg.documentId != null ? String(arg.documentId) : null;
    const S = docId != null ? sessions.get(docId) : null;
    const textReady = !!(S && S.complete);
    if (!map) return { meta: null, nodes: [], edges: [], view: null, textReady };
    const g = loadGraph(map.id);
    return { meta: metaOf(g.map), nodes: g.rows.map(toV2Node), edges: g.edges.map(toV2Edge), view: g.map.view || null, textReady };
  }

  // ---------- 增量广播批次 ----------
  function createSink(base) {
    let nodes = new Map(), states = new Map(), edges = [];
    let timer = null, lastFlush = -Infinity, held = false;
    const sent = new Set();
    const empty = () => !nodes.size && !states.size && !edges.length;
    function flush() {
      if (timer) { clearT(timer); timer = null; }
      if (held || empty()) return;
      const payload = Object.assign({}, base, {
        nodes: [...nodes.values()].map(toV2Node),
        states: [...states].map(([id, state]) => ({ id, state })),
        edges: edges.map(toV2Edge),
      });
      for (const id of nodes.keys()) sent.add(id);
      nodes = new Map(); states = new Map(); edges = [];
      lastFlush = now();
      emitDelta(payload);
    }
    function schedule() {
      if (held || timer) return;
      const wait = DELTA_MS - (now() - lastFlush);
      if (wait <= 0) flush();
      else timer = setT(flush, wait);
    }
    return {
      add(dl) {
        for (const r of (dl && dl.nodes) || []) nodes.set(r.nodeId, r);
        for (const s of (dl && dl.states) || []) states.set(s.nodeId, s.state);
        for (const e of (dl && dl.edges) || []) edges.push(e);
        schedule();
      },
      hold(v) { held = !!v; if (!held) schedule(); },
      isHeld: () => held,
      sentIds: () => sent,
      discard() { if (timer) clearT(timer); timer = null; nodes = new Map(); states = new Map(); edges = []; },
      // 状态 / 收尾消息不计入节流窗口：任务开始的 streaming 态之后，首个节点批次仍须立即下发（首节点时延）
      emit(extra) { emitDelta(Object.assign({}, base, extra)); },
    };
  }

  function interactiveRunOf(mapId, documentId) {
    let id = interactiveRuns.get(mapId);
    if (id) return id;
    const run = store.createMaterialMapRun({ documentId, granularity: "v2", input: { engine: "v2", kind: "interactive", mapId } });
    store.updateMaterialMapRun(run.id, { status: "completed" });
    interactiveRuns.set(mapId, run.id);
    return run.id;
  }

  // ---------- 结构任务（outline / expand 共用） ----------
  function gatePassed(kids) {
    if (kids.length < 2) return false;
    const b0 = kids[0].blockStart;
    return !kids.every((k) => k.blockStart === b0 && k.blockEnd === b0);
  }

  async function runStructJob(J, signal, ctl) {
    const M = metricsFor(J.mapId, J.ai.model);
    const sink = createSink({ documentId: J.documentId, mapId: J.mapId, jobId: J.jobId, kind: J.kind });
    const targetId = J.target.nodeId;
    sink.emit({ states: [{ id: targetId, state: "streaming" }] });
    const hold = J.kind === "expand" && !J.force;
    if (hold) sink.hold(true);
    const assembler = V.createJobAssembler({
      kind: J.kind, jobId: J.jobId, basePath: J.basePath, target: J.target, levels: J.levels,
      blocks: J.blocks, linear: J.linear, aliases: J.aliases, force: J.force,
    });
    const startedAt = now();
    let firstNodeAt = null;
    const directKids = [];
    const streamedAll = new Set();
    const dropped = [];
    const parser = O.createLineParser({
      scope: J.scopeRange, basePath: J.basePath, refs: J.aliases.refSet, maxRelsPerNode: 3,
      onNode: (n) => {
        const dl = assembler.onNode(n);
        if (firstNodeAt == null) {
          firstNodeAt = now();
          if (M.ttfnMs == null) M.ttfnMs = firstNodeAt - M.startedAt;
        }
        for (const r of dl.nodes) {
          streamedAll.add(r.nodeId);
          if (r.parentId === targetId) directKids.push(r);
        }
        sink.add(dl);
        if (hold && sink.isHeld() && gatePassed(directKids)) sink.hold(false);
      },
      onRel: (r) => sink.add(assembler.onRel(r)),
      onDrop: (x) => dropped.push(x.raw),
    });
    const key = V.cacheKeyOf({
      documentId: J.documentId, kind: J.kind, blockFrom: J.scopeRange.blockFrom, blockTo: J.scopeRange.blockTo, nodeId: targetId,
      promptScope: J.prompt.scope, promptVersion: J.prompt.version,
      // 文本哈希＝用户消息全文（含带号原文 / 层数 / 别名表）；另并入 system 文本，用户改写模板后不误复用
      userText: J.prompt.content + "\u0000" + J.userText,
      provider: J.ai.provider, model: J.ai.model, reasoningEffort: J.ai.reasoningEffort, maxTokens: J.maxTokens,
    });
    let shard = null;
    if (!J.noCache) { try { shard = store.getMaterialMapShard(key); } catch { shard = null; } }
    let cached = false, finishReason = null, error = null, meta = null, raw = "", reasoningChars = 0;
    if (shard && shard.content && Array.isArray(shard.content.lines)) {
      cached = true;
      for (const line of shard.content.lines) parser.push(String(line) + "\n");
      finishReason = shard.content.finishReason || null;
    } else {
      try {
        meta = await chatStream({
          messages: [{ role: "system", content: J.prompt.content }, { role: "user", content: J.userText }],
          temperature: TEMPERATURE, abortSignal: signal,
          retry: { maxAttempts: Math.max(1, J.ai.settings.retryMax), onRetry: (r) => { if (r && r.code === "rate_limit") ctl.reportRateLimit(); } },
          model: J.ai.model || undefined, maxTokens: J.maxTokens,
        }, (m) => {
          if (!m) return;
          if (typeof m.delta === "string" && m.delta) { raw += m.delta; parser.push(m.delta); }
          if (Number.isFinite(m.thinking)) reasoningChars = Math.max(reasoningChars, Number(m.thinking));
        });
        finishReason = (meta && meta.finishReason) || null;
      } catch (e) {
        error = e || new Error("unknown");
        if (error.code === "rate_limit") ctl.reportRateLimit();
      }
    }
    const stats = parser.end();
    const cancelled = !!(error && (error.code === "cancelled" || (signal && signal.aborted)));
    // 出错（含取消）按中断装配：已校验行照样落库；目标无子节点时保持 more
    const res = assembler.finish({ finishReason, aborted: !!error });
    const hasLiveAi = res.upserts.some((r) => r.source === "ai");
    const oldDesc = J.oldDescendants || [];
    const replace = oldDesc.length && hasLiveAi ? [targetId] : null;
    let targetState = res.targetState;
    if (oldDesc.length && !replace) targetState = null; // 新结果为空：旧子孙保留，目标状态不动
    const upserts = res.upserts.slice();
    const states = res.states.filter((s) => s.nodeId !== targetId);
    if (targetState) {
      if (J.v1Target) upserts.unshift(Object.assign({}, J.v1Target, { state: targetState, jobId: undefined }));
      else states.push({ nodeId: targetId, state: targetState });
    }
    let committed = false, commitError = null, activated = false;
    const removed = [];
    if (upserts.length || states.length || res.edges.length) {
      const activate = !!(J.gen && !J.gen.activated && hasLiveAi);
      try {
        store.commitMaterialMapJob({ mapId: J.mapId, jobId: J.jobId, upserts, states, edges: res.edges, activate, replaceSubtrees: replace || undefined });
        committed = true;
        if (activate) { J.gen.activated = true; activated = true; }
        if (replace) {
          const keep = new Set(upserts.map((r) => r.nodeId));
          for (const id of oldDesc) if (!keep.has(id)) removed.push(id);
        }
      } catch (e) {
        commitError = e;
        for (const id of streamedAll) removed.push(id);
      }
    }
    const usage = (meta && meta.usage) || {};
    const pt = numOrNull(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
    const ct = numOrNull(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
    // 截断（length）结果不入缓存：目标被回标 more 后再深挖须真实重试，否则会原样回放截断产物、永远补不全
    if (!cached && !error && finishReason !== "length") {
      try {
        store.saveMaterialMapShard(Object.assign({}, key, {
          content: { lines: acceptedLines(raw, dropped), finishReason }, chars: J.userText.length, tokenUsed: ct,
        }));
      } catch { /* 缓存写失败不影响结果 */ }
    }
    if (!cached) {
      const outcome = !error ? "completed" : cancelled ? "cancelled" : error.streamStarted ? "unknown_outcome" : "failed";
      try {
        store.saveMaterialMapCall({
          runId: J.runId, documentId: J.documentId, runKind: J.kind, nodeAnchor: J.nodeAnchor, spanHash: key.textHash,
          chars: J.userText.length, outcome, errorCode: error ? String(error.code || "error") : null, finishReason,
          attempt: 1, wallMs: now() - startedAt, ttftMs: meta ? numOrNull(meta.ttftMs) : null, firstByteMs: meta ? numOrNull(meta.firstByteMs) : null,
          depth: J.target.depth, parentNodeId: targetId,
          spanChars: B.blockTextLength(J.blocks, J.scopeRange.blockFrom, J.scopeRange.blockTo),
          promptTokens: pt, completionTokens: ct, model: J.ai.model, ttfnMs: firstNodeAt == null ? null : firstNodeAt - startedAt,
          lines: stats.lines, linesDropped: stats.dropped, dropJson: stats.byReason, relsDropped: stats.relsDropped,
          reasoningChars, trigger: J.trigger,
        });
      } catch { /* 账本写失败不影响结果 */ }
    }
    if (cached) M.cacheHits++;
    else {
      M.calls++;
      M.promptTokens += pt || 0;
      M.completionTokens += ct || 0;
      if (M.firstTtftMs == null && meta && Number.isFinite(meta.ttftMs)) M.firstTtftMs = meta.ttftMs;
    }
    M.reasoningChars += reasoningChars;
    M.lines += stats.lines;
    M.linesDropped += stats.dropped;
    for (const [k, v] of Object.entries(stats.byReason || {})) M.byReason[k] = (M.byReason[k] || 0) + v;
    M.relsDropped += stats.relsDropped;

    // 收尾：清掉暂扣/未发的批次，发本任务权威全集
    sink.discard();
    sink.hold(false);
    const finalState = (committed && targetState) || J.prevTargetState || null;
    const ok = !error && !commitError;
    const otherStates = committed ? states.filter((s) => s.nodeId !== targetId).map((s) => ({ id: s.nodeId, state: s.state })) : [];
    sink.emit({
      nodes: committed ? upserts.map(toV2Node) : [],
      states: (finalState ? [{ id: targetId, state: finalState }] : []).concat(otherStates),
      edges: committed ? res.edges.map(toV2Edge) : [],
      removed: removed.length ? removed : undefined,
      jobDone: {
        ok, error: error ? String(error.message || error.code) : commitError ? String(commitError.message) : undefined,
        finishReason, cached, aborted: cancelled, activated: activated || undefined,
      },
      metrics: metricsSnap(M),
    });
    return {
      ok, aborted: cancelled, cached, called: cached ? 0 : 1, committed, error: error ? String(error.code || "error") : commitError ? "commit" : null,
      finishReason, targetState: finalState,
    };
  }

  // ---------- outline ----------
  function enqueueOutline(mapId, S, sc, opts) {
    const key = `outline:${mapId}:${sc.scopeId}`;
    const jobId = opts.jobId || newJobId();
    const meta = { jobId, kind: "outline", mapId, documentId: S.documentId, nodeId: sc.nodeId, runId: opts.runId };
    const r = scheduler.enqueue({
      key, priority: opts.priority, lockKey: `${mapId}|${sc.scopeId}`, meta,
      run: (signal, ctl) => runOutline(mapId, S, sc, Object.assign({}, opts, { jobId }), signal, ctl),
    });
    if (r.status === "queued") jobs.set(jobId, { key, kind: "outline", mapId, nodeId: sc.nodeId, runId: opts.runId });
    return { jobId: r.meta.jobId, status: r.status, promise: r.promise };
  }

  function runOutline(mapId, S, sc, opts, signal, ctl) {
    const ai = aiInfo();
    const prompt = promptOf("outline");
    const aliases = V.buildAliasTable(V.outlineRefCandidates(S.refRows, sc.nodeId));
    const numberedText = B.renderNumbered(S.linear.text, S.blocks, sc.blockFrom, sc.blockTo);
    const levels = P.targetDepth(sc.chars);
    const userText = P.buildOutlineUser({ title: S.title, path: sc.path, numberedText, depth: levels, refs: aliases.refs });
    const sk = S.skeleton.byId.get(sc.nodeId);
    let prev = "more";
    try {
      const row = store.listMaterialMapNodes(mapId).find((r) => r.nodeId === sc.nodeId);
      if (row) prev = row.state;
    } catch { /* 用默认 */ }
    return runStructJob({
      kind: "outline", jobId: opts.jobId, mapId, documentId: S.documentId, runId: opts.runId, gen: opts.gen || null,
      trigger: opts.trigger || "auto", force: false, noCache: !!opts.noCache,
      scopeRange: { blockFrom: sc.blockFrom, blockTo: sc.blockTo }, basePath: sc.scopeId,
      // 多作用域节点的各分片互不覆盖目标状态（hadChildren=true），截断只回标分片内链
      target: { nodeId: sc.nodeId, depth: sc.depth, blockFrom: sc.blockFrom, blockTo: sc.blockTo, hadChildren: (sk && sk.childIds.length > 0) || sc.part > 0 },
      levels, aliases, userText, prompt, ai, maxTokens: MAX_TOKENS.outline, nodeAnchor: `blk:${sc.blockFrom}-${sc.blockTo}`,
      blocks: S.blocks, linear: S.linear, oldDescendants: [], v1Target: null, prevTargetState: prev,
    }, signal, ctl);
  }

  // ---------- 生成整图 run ----------
  function genByMap(mapId) {
    for (const G of gens.values()) if (G.mapId === mapId && !G.finished) return G;
    return null;
  }
  function newGen(o) {
    const G = {
      runId: o.runId, mapId: o.mapId, documentId: o.S.documentId, S: o.S, title: o.S.title, noCache: !!o.noCache,
      activated: !!o.activated, filter: o.filter || null, skeletonFinal: !!o.skeletonFinal, startedAt: now(),
      released: new Set(), total: 0, pending: 0, done: 0, ok: 0, failed: 0, cancelledJobs: 0, calls: 0,
      cancelled: false, finished: false,
    };
    gens.set(G.runId, G);
    return G;
  }
  const genLabel = (G) => `框架 ${G.done}/${G.total} 段`;
  function genProgress(G) {
    emitChanged({
      runId: G.runId, documentId: G.documentId, title: G.title, stage: "running", done: G.done, total: G.total, calls: G.calls,
      mapId: G.mapId, published: G.activated, label: genLabel(G),
    });
  }
  function genTrack(G, sc, r) {
    G.released.add(sc.scopeId);
    G.total++;
    G.pending++;
    r.promise.then((v) => genJobDone(G, v, null), (e) => genJobDone(G, null, e));
  }
  function genRelease(G, scopes) {
    let any = false;
    for (const sc of scopes) {
      if (G.cancelled || G.finished) break;
      if (G.released.has(sc.scopeId)) continue;
      if (G.filter && !G.filter(sc)) continue;
      if (sc.floor) { G.released.add(sc.scopeId); continue; } // 第 1 门：<400 字作用域零调用
      const r = enqueueOutline(G.mapId, G.S, sc, { priority: PRIORITY.OUTLINE, runId: G.runId, gen: G, trigger: "auto", noCache: G.noCache });
      genTrack(G, sc, r);
      any = true;
    }
    if (any) genProgress(G);
  }
  function genJobDone(G, v, e) {
    G.pending--;
    G.done++;
    if (e) { if (e.code === "cancelled") G.cancelledJobs++; else G.failed++; }
    else if (v && v.ok) G.ok++;
    else if (v && v.aborted) G.cancelledJobs++;
    else G.failed++;
    if (v && v.called) G.calls += v.called;
    if (G.finished) return;
    genProgress(G);
    genMaybeFinish(G);
  }
  function genMaybeFinish(G) {
    if (G.finished || G.pending > 0) return;
    if (!G.cancelled && !G.S.complete) return;
    finalizeGen(G);
  }
  function finalizeGen(G) {
    G.finished = true;
    gens.delete(G.runId);
    let stage, code = null;
    if (G.cancelled) stage = "cancelled";
    else if (G.failed > 0 && G.ok === 0) stage = "failed";
    else if (G.failed > 0 || G.cancelledJobs > 0) stage = "partial";
    else stage = "completed";
    let deleted = false;
    if (!G.activated) {
      if (stage === "completed" && G.total === 0) {
        // 全部作用域封顶（零调用）：骨架即成品，照常激活
        try { store.commitMaterialMapJob({ mapId: G.mapId, jobId: null, upserts: [], activate: true }); G.activated = true; } catch { /* 下面按失败处理 */ }
      } else if (stage === "completed") { stage = "failed"; code = "empty"; }
      if (!G.activated) {
        // 交接要点 5：首个 AI 批次提交前失败/取消 → 直接删除未激活的新版本行（不留空壳；旧激活版本不受影响）
        try { deleted = !!store.deleteMaterialMap(G.mapId); } catch { deleted = false; }
        if (!code && stage !== "cancelled") code = "no_commit";
      }
    }
    const M = metricsByMap.get(G.mapId);
    if (M && stage !== "cancelled" && M.frameworkMs == null) M.frameworkMs = now() - G.startedAt;
    const snap = M ? metricsSnap(M) : null;
    if (deleted) metricsByMap.delete(G.mapId);
    try {
      store.updateMaterialMapRun(G.runId, {
        status: stage, stage, callsPlanned: G.total, callsDone: G.calls, errorCode: code,
        actualPromptTokens: snap ? snap.promptTokens : null, actualCompletionTokens: snap ? snap.completionTokens : null,
        output: { mapId: deleted ? null : G.mapId, deleted, metrics: snap },
      });
    } catch { /* 记录失败不影响广播 */ }
    emitChanged({
      runId: G.runId, documentId: G.documentId, title: G.title, stage, done: G.done, total: G.total, calls: G.calls,
      mapId: deleted ? null : G.mapId, published: G.activated && !deleted, label: genLabel(G), code: code || undefined,
    });
    emitDelta({ documentId: G.documentId, mapId: G.mapId, jobId: null, kind: "run", runDone: { stage, deleted }, metrics: snap || undefined });
  }

  function graphGenerate(p) {
    const o = p || {};
    const docId = String(o.documentId);
    const S = sessions.get(docId);
    if (!S) throw codeErr("no_text", "原文尚未送入（先 graphFeed）");
    touch(S);
    for (const G of gens.values()) if (G.documentId === docId && !G.finished) return { runId: G.runId, mapId: G.mapId };
    if (o.title && String(o.title).trim()) S.title = String(o.title).trim();
    const ai = aiInfo();
    scheduler.setMaxConcurrency(ai.settings.concurrency);
    const pv = { outline: promptOf("outline").version, expand: promptOf("expand").version, explain: promptOf("explain").version };
    const skeleton = V.skeletonRows(S.skeleton, S.blocks, S.complete ? Infinity : S.unitsReady, S.scopes);
    const { mapId } = store.createMaterialMapV2({
      documentId: docId, title: S.title,
      meta: { title: S.title, blocksVersion: B.UNIT_BLOCKS_VERSION, outlineVersion: O.OUTLINE_VERSION, promptVersions: pv, model: ai.model },
      skeleton, sourceRevisionHash: S.revisionHash, provider: ai.provider, model: ai.model,
      modelConfigHash: V.modelConfigHash({ model: ai.model, reasoningEffort: ai.reasoningEffort, maxTokens: MAX_TOKENS.outline }),
      promptVersion: pv.outline,
    });
    const run = store.createMaterialMapRun({ documentId: docId, granularity: "v2", input: { engine: "v2", kind: "generate", mapId } });
    store.updateMaterialMapRun(run.id, { status: "running", stage: "running", provider: ai.provider, model: ai.model, promptVersion: pv.outline });
    consent.add(mapId);
    metricsByMap.set(mapId, newMetrics(ai.model));
    const G = newGen({ runId: run.id, mapId, S, noCache: !!o.force, activated: false, skeletonFinal: S.complete });
    emitDelta({ documentId: docId, mapId, jobId: null, kind: "skeleton", nodes: skeleton.map(toV2Node) });
    genProgress(G);
    genRelease(G, S.scopes);
    queueMicrotask(() => genMaybeFinish(G));
    return { runId: run.id, mapId };
  }

  function graphResume(p) {
    const runId = String((p && p.runId) || "");
    if (gens.has(runId)) return { queued: gens.get(runId).pending };
    if (alls.has(runId)) return { queued: alls.get(runId).pending };
    const run = store.getMaterialMapRun(runId);
    const input = run && run.input;
    if (!run || !input || input.engine !== "v2" || !input.mapId) return { queued: 0 };
    const map = store.getMaterialMap(String(input.mapId));
    if (!map) {
      try { store.updateMaterialMapRun(runId, { status: "failed", stage: "failed", errorCode: "map_missing" }); } catch { /* 忽略 */ }
      return { queued: 0 };
    }
    if (input.kind === "expandAll") {
      store.updateMaterialMapRun(runId, { status: "running", stage: "running" });
      const E = startExpandAll(runId, map, readMindmapSettings().maxCalls);
      return { queued: E.planned };
    }
    if (input.kind !== "generate") return { queued: 0 };
    const S = sessions.get(String(map.documentId));
    if (!S) throw codeErr("no_text", "原文尚未送入（先 graphFeed）");
    touch(S);
    const rows = store.listMaterialMapNodes(map.id);
    const done = outlinedScopeIds(rows);
    store.updateMaterialMapRun(runId, { status: "running", stage: "running" });
    if (!metricsByMap.has(map.id)) metricsByMap.set(map.id, newMetrics(aiInfo().model));
    const G = newGen({
      runId, mapId: map.id, S, activated: !!map.isActive || rows.some((r) => r.source === "ai"),
      filter: (sc) => !done.has(sc.scopeId), skeletonFinal: false,
    });
    if (S.complete) { G.skeletonFinal = true; refreshSkeleton(map.id, S); }
    genProgress(G);
    genRelease(G, S.scopes);
    queueMicrotask(() => genMaybeFinish(G));
    return { queued: G.pending };
  }

  // ---------- expand ----------
  function ancestorsTitles(g, row) {
    const out = [];
    const guard = new Set();
    let cur = row.parentId != null ? g.byId.get(row.parentId) : null;
    while (cur && !guard.has(cur.nodeId)) {
      guard.add(cur.nodeId);
      if (cur.parentId != null) out.unshift(cur.title); // 根（材料名）已在【材料】行
      cur = cur.parentId != null ? g.byId.get(cur.parentId) : null;
    }
    return out;
  }
  function siblingTitles(g, row) {
    return sortByOrd(g.rows.filter((r) => r.parentId === row.parentId && r.nodeId !== row.nodeId && r.source !== "local")).map((r) => r.title);
  }

  /** 深挖规划（点击 / 预取 / 深挖全部共用）。返回 { jobId, status?, promise?, skipped?, waiting? } */
  function planExpand(mapId, nodeId, o) {
    const g = loadGraph(mapId);
    if (!g) throw codeErr("not_found", "导图版本不存在");
    const row = g.byId.get(String(nodeId));
    if (!row) throw codeErr("not_found", "节点不存在");
    const docId = String(g.map.documentId);
    const S = g.S;
    const wait = () => {
      if (o.fromWaiter) return { jobId: o.jobId, waiting: true };
      if (!o.allowWait) return { jobId: null, skipped: "no_text" };
      const jobId = o.jobId || newJobId();
      addWaiter(docId, mapId, jobId, () => {
        if (!sessions.get(docId)) return false;
        const r = planExpand(mapId, nodeId, Object.assign({}, o, { jobId, fromWaiter: true }));
        return !r.waiting;
      });
      return { jobId, waiting: true };
    };
    // 目录作用域节点：尚未 outline 的分片 → 排 outline（同 key 已在排队则提档）
    if (!g.v1 && row.source === "toc") {
      if (row.state === "floor" && !o.force) return { jobId: null, skipped: "floor" };
      if (!S) return wait();
      const done = outlinedScopeIds(g.rows);
      const mine = S.scopes.filter((sc) => sc.nodeId === row.nodeId && !sc.floor && !done.has(sc.scopeId));
      if (mine.length) {
        const G = genByMap(mapId);
        const runId = G ? G.runId : interactiveRunOf(mapId, docId);
        let first = null;
        const proms = [];
        for (const sc of mine) {
          const r = enqueueOutline(mapId, S, sc, { priority: o.priority, runId, gen: G, trigger: o.trigger, jobId: first ? undefined : o.jobId });
          if (G && !G.released.has(sc.scopeId)) genTrack(G, sc, r);
          first = first || r;
          proms.push(r.promise);
        }
        const promise = Promise.all(proms).then((rs) => ({
          ok: rs.every((x) => x && x.ok), aborted: rs.some((x) => x && x.aborted), called: rs.reduce((n, x) => n + ((x && x.called) || 0), 0),
        }));
        promise.catch(() => {});
        return { jobId: first.jobId, status: first.status, promise };
      }
      const sk = S.skeleton.byId.get(row.nodeId);
      if (!S.complete && sk && sk.runs.some(([, uTo]) => uTo > S.unitsReady) && !g.rows.some((r) => r.parentId === row.nodeId && r.source === "ai")) return wait();
    }
    if (row.state === "open" && !o.force) return { jobId: null, skipped: "cached" };
    const depth = V.rowDepth(g.byId, row.nodeId);
    const gate = V.expandGate(row, blocksFor(g), depth, { force: !!o.force });
    if (gate === "floor") return { jobId: null, skipped: "floor" };
    if (gate === "no_text") return wait();
    const key = `expand:${mapId}:${row.nodeId}`;
    const jobId = o.jobId || newJobId();
    const runId = o.runId || interactiveRunOf(mapId, docId);
    const r = scheduler.enqueue({
      key, priority: o.priority, lockKey: `${mapId}|${row.nodeId}`,
      meta: { jobId, kind: "expand", mapId, documentId: docId, nodeId: row.nodeId, runId },
      run: (signal, ctl) => runExpand(mapId, row.nodeId, { jobId, runId, trigger: o.trigger, force: !!o.force }, signal, ctl),
    });
    if (r.status === "queued") jobs.set(jobId, { key, kind: "expand", mapId, nodeId: row.nodeId, runId });
    return { jobId: r.meta.jobId, status: r.status, promise: r.promise };
  }

  function runExpand(mapId, nodeId, o, signal, ctl) {
    const g = loadGraph(mapId);
    const row = g && g.byId.get(nodeId);
    const blocks = g ? blocksFor(g) : null;
    if (!g || !row || !g.S || !blocks) return Promise.resolve({ ok: false, called: 0, error: "not_found" });
    const S = g.S;
    const depth = V.rowDepth(g.byId, nodeId);
    const gate = V.expandGate(row, blocks, depth, { force: o.force });
    if (gate) {
      emitDelta({ documentId: S.documentId, mapId, jobId: o.jobId, kind: "expand", jobDone: { ok: gate === "floor", skipped: gate, cached: false, aborted: false, finishReason: null } });
      return Promise.resolve({ ok: gate === "floor", called: 0, skipped: gate });
    }
    const ai = aiInfo();
    const prompt = promptOf("expand");
    const levels = row.blockEnd - row.blockStart + 1 <= 8 ? 1 : 2;
    const aliases = V.buildAliasTable(V.expandRefCandidates(g.rows, g.edges, nodeId));
    const numberedText = B.renderNumbered(S.linear.text, blocks, row.blockStart, row.blockEnd);
    const userText = P.buildExpandUser({
      title: S.title || g.map.title || "", ancestors: ancestorsTitles(g, row), siblings: siblingTitles(g, row),
      node: { title: row.title, type: row.type }, numberedText, depth: levels, refs: aliases.refs,
    });
    // 交接要点 2：该节点已有的 AI 子孙（length 回标后再深挖）→ 整枝替换
    const oldDescendants = descendantsOf(g.stored, nodeId, (r) => r.source === "ai" || r.source === "local");
    const oldSet = new Set(oldDescendants);
    const hadChildren = g.rows.some((r) => r.parentId === nodeId && !oldSet.has(r.nodeId));
    return runStructJob({
      kind: "expand", jobId: o.jobId, mapId, documentId: S.documentId, runId: o.runId, gen: null, trigger: o.trigger, force: !!o.force,
      noCache: false, scopeRange: { blockFrom: row.blockStart, blockTo: row.blockEnd }, basePath: nodeId,
      target: { nodeId, depth, blockFrom: row.blockStart, blockTo: row.blockEnd, hadChildren },
      levels, aliases, userText, prompt, ai, maxTokens: MAX_TOKENS.expand, nodeAnchor: `blk:${row.blockStart}-${row.blockEnd}#${nodeId}`,
      blocks, linear: S.linear, oldDescendants, v1Target: g.v1 && row.source === "v1ext" ? row : null, prevTargetState: row.state,
    }, signal, ctl);
  }

  function graphExpand(p) {
    const o = p || {};
    const trigger = TRIGGERS.has(o.trigger) ? o.trigger : "click";
    const mapId = String(o.mapId);
    const map = store.getMaterialMap(mapId);
    if (!map) throw codeErr("not_found", "导图版本不存在");
    const docId = String(map.documentId);
    const ai = aiInfo();
    scheduler.setMaxConcurrency(ai.settings.concurrency);
    if (trigger === "prefetch") {
      // X4：只在用户本会话已对该图主动发过 AI 请求后生效；每日上限按账本 trigger='prefetch' 计
      if (!ai.settings.prefetch.enabled || !consent.has(mapId)) return { jobId: null, skipped: "disabled" };
      const used = store.countMaterialMapCallsSince(docId, { trigger: "prefetch", sinceMs: startOfDay(now()) });
      if (used >= ai.settings.prefetch.dailyLimit) return { jobId: null, skipped: "quota" };
    } else consent.add(mapId);
    const priority = trigger === "prefetch" ? PRIORITY.PREFETCH : trigger === "all" ? PRIORITY.ALL : PRIORITY.CLICK;
    const r = planExpand(mapId, String(o.nodeId), { trigger, force: !!o.force, priority, allowWait: trigger === "click" });
    if (r.skipped) return { jobId: r.jobId || null, skipped: r.skipped };
    if (r.waiting) return { jobId: r.jobId, waiting: true };
    if (r.status === "deduped") return { jobId: r.jobId, skipped: "busy" };
    return { jobId: r.jobId };
  }

  // ---------- 深挖全部 run ----------
  const allLabel = (E) => `深挖 ${E.done}/${E.planned} 段`;
  function allProgress(E) {
    emitChanged({
      runId: E.runId, documentId: E.documentId, title: E.title, stage: "running", done: E.done, total: E.planned, calls: E.calls,
      budget: E.budget, mapId: E.mapId, published: true, label: allLabel(E),
    });
  }
  function startExpandAll(runId, map, budget) {
    const S = sessions.get(String(map.documentId));
    const E = {
      runId, mapId: map.id, documentId: String(map.documentId), title: (S && S.title) || map.title || "", budget: Math.max(1, Number(budget) || 1),
      planned: 0, pending: 0, done: 0, ok: 0, failed: 0, cancelledJobs: 0, calls: 0, cancelled: false, finished: false, seen: new Set(),
    };
    alls.set(runId, E);
    consent.add(map.id);
    allWave(E);
    allProgress(E);
    queueMicrotask(() => allMaybeFinish(E));
    return E;
  }
  function allWave(E) {
    if (E.cancelled || E.finished) return;
    const g = loadGraph(E.mapId);
    if (!g) return;
    const depthOf = (r) => V.rowDepth(g.byId, r.nodeId);
    const cands = g.rows.filter((r) => r.state === "more" && !E.seen.has(r.nodeId))
      .map((r) => ({ r, dep: depthOf(r) }))
      .sort((a, b) => (a.dep - b.dep) || (a.r.ord - b.r.ord) || (a.r.nodeId < b.r.nodeId ? -1 : 1));
    for (const { r } of cands) {
      if (E.planned >= E.budget) break;
      E.seen.add(r.nodeId);
      let res;
      try { res = planExpand(E.mapId, r.nodeId, { trigger: "all", force: false, priority: PRIORITY.ALL, runId: E.runId, allowWait: false }); } catch { continue; }
      if (!res || res.skipped || res.waiting || !res.promise) continue;
      E.planned++;
      E.pending++;
      res.promise.then((v) => allJobDone(E, v, null), (e) => allJobDone(E, null, e));
    }
  }
  function allJobDone(E, v, e) {
    E.pending--;
    E.done++;
    if (e) { if (e.code === "cancelled") E.cancelledJobs++; else E.failed++; }
    else if (v && v.ok) E.ok++;
    else if (v && v.aborted) E.cancelledJobs++;
    else E.failed++;
    if (v && v.called) E.calls += v.called;
    if (E.finished) return;
    if (!E.cancelled) allWave(E);
    allProgress(E);
    allMaybeFinish(E);
  }
  function allMaybeFinish(E) {
    if (E.finished || E.pending > 0) return;
    E.finished = true;
    alls.delete(E.runId);
    let stage;
    if (E.cancelled) stage = "cancelled";
    else if (E.failed > 0 && E.ok === 0) stage = "failed";
    else if (E.failed > 0 || E.cancelledJobs > 0) stage = "partial";
    else stage = "completed";
    const M = metricsByMap.get(E.mapId);
    try {
      store.updateMaterialMapRun(E.runId, { status: stage, stage, callsPlanned: E.planned, callsDone: E.calls, output: { mapId: E.mapId, metrics: M ? metricsSnap(M) : null } });
    } catch { /* 忽略 */ }
    emitChanged({
      runId: E.runId, documentId: E.documentId, title: E.title, stage, done: E.done, total: E.planned, calls: E.calls,
      budget: E.budget, mapId: E.mapId, published: true, label: allLabel(E),
    });
  }
  function graphExpandAll(p) {
    const mapId = String((p && p.mapId) || "");
    const map = store.getMaterialMap(mapId);
    if (!map) throw codeErr("not_found", "导图版本不存在");
    for (const E of alls.values()) if (E.mapId === mapId && !E.finished) return { runId: E.runId, queued: E.planned };
    const ai = aiInfo();
    scheduler.setMaxConcurrency(ai.settings.concurrency);
    const run = store.createMaterialMapRun({ documentId: map.documentId, granularity: "v2", input: { engine: "v2", kind: "expandAll", mapId } });
    store.updateMaterialMapRun(run.id, { status: "running", stage: "running", provider: ai.provider, model: ai.model });
    const E = startExpandAll(run.id, map, ai.settings.maxCalls);
    return { runId: run.id, queued: E.planned };
  }

  // ---------- explain ----------
  function graphExplain(p) {
    const o = p || {};
    const mapId = String(o.mapId);
    const g = loadGraph(mapId);
    if (!g) throw codeErr("not_found", "导图版本不存在");
    const row = g.byId.get(String(o.nodeId));
    if (!row) throw codeErr("not_found", "节点不存在");
    if (row.explain && typeof row.explain.text === "string" && row.explain.text) return { cached: true, explain: row.explain };
    consent.add(mapId);
    return planExplain(g, row, o.jobId);
  }
  function planExplain(g, row, presetJobId, fromWaiter) {
    const mapId = g.map.id;
    const docId = String(g.map.documentId);
    const blocks = blocksFor(g);
    const jobId = presetJobId || newJobId();
    if (row.blockStart == null || row.blockEnd == null || !blocks || !blocks.length || blocks[blocks.length - 1].no < row.blockEnd) {
      if (fromWaiter) return { jobId, waiting: true };
      addWaiter(docId, mapId, jobId, () => {
        const g2 = loadGraph(mapId);
        const row2 = g2 && g2.byId.get(row.nodeId);
        if (!row2) return true;
        return !planExplain(g2, row2, jobId, true).waiting;
      });
      return { jobId, waiting: true };
    }
    const key = `explain:${mapId}:${row.nodeId}`;
    const runId = interactiveRunOf(mapId, docId);
    const r = scheduler.enqueue({
      key, priority: PRIORITY.EXPLAIN, lockKey: `${mapId}|${row.nodeId}|explain`,
      meta: { jobId, kind: "explain", mapId, documentId: docId, nodeId: row.nodeId, runId },
      run: (signal) => runExplain(mapId, row.nodeId, { jobId, runId }, signal),
    });
    if (r.status === "queued") jobs.set(jobId, { key, kind: "explain", mapId, nodeId: row.nodeId, runId });
    return { jobId: r.meta.jobId };
  }

  async function runExplain(mapId, nodeId, o, signal) {
    const g = loadGraph(mapId);
    const row = g && g.byId.get(nodeId);
    const blocks = g ? blocksFor(g) : null;
    if (!g || !row || !blocks) return { ok: false, called: 0 };
    const S = g.S;
    const ai = aiInfo();
    const prompt = promptOf("explain");
    const M = metricsFor(mapId, ai.model);
    const numberedText = B.renderNumbered(S.linear.text, blocks, row.blockStart, row.blockEnd);
    const userText = P.buildExplainUser({
      title: S.title || g.map.title || "", ancestors: ancestorsTitles(g, row), node: { title: row.title, type: row.type },
      numberedText, siblings: siblingTitles(g, row),
    });
    const base = { documentId: S.documentId, mapId, jobId: o.jobId, kind: "explain" };
    let text = "", pending = "", timer = null, lastFlush = -Infinity;
    const flush = () => {
      if (timer) { clearT(timer); timer = null; }
      if (!pending) return;
      const t = pending;
      pending = "";
      lastFlush = now();
      emitDelta(Object.assign({}, base, { explainDelta: { nodeId, text: t } }));
    };
    const startedAt = now();
    let meta = null, error = null, reasoningChars = 0;
    try {
      meta = await chatStream({
        messages: [{ role: "system", content: prompt.content }, { role: "user", content: userText }],
        temperature: TEMPERATURE, abortSignal: signal, retry: { maxAttempts: Math.max(1, ai.settings.retryMax) },
        model: ai.model || undefined, maxTokens: MAX_TOKENS.explain,
      }, (m) => {
        if (!m) return;
        if (typeof m.delta === "string" && m.delta) {
          text += m.delta;
          pending += m.delta;
          const wait = DELTA_MS - (now() - lastFlush);
          if (wait <= 0) flush();
          else if (!timer) timer = setT(flush, wait);
        }
        if (Number.isFinite(m.thinking)) reasoningChars = Math.max(reasoningChars, Number(m.thinking));
      });
    } catch (e) { error = e || new Error("unknown"); }
    flush();
    const cancelled = !!(error && (error.code === "cancelled" || (signal && signal.aborted)));
    let saved = null;
    if (!error && text.trim()) {
      const explain = { text: text.trim(), model: ai.model, promptVersion: prompt.version, at: now() };
      try {
        let okSet = store.setMaterialMapNodeExplain(mapId, nodeId, explain);
        if (!okSet && g.v1 && row.source === "v1ext") {
          store.commitMaterialMapJob({ mapId, jobId: o.jobId, upserts: [Object.assign({}, row, { jobId: undefined })] });
          okSet = store.setMaterialMapNodeExplain(mapId, nodeId, explain);
        }
        if (okSet) saved = Object.assign({}, row, { explain });
      } catch { saved = null; }
    }
    const usage = (meta && meta.usage) || {};
    const pt = numOrNull(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
    const ct = numOrNull(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
    try {
      store.saveMaterialMapCall({
        runId: o.runId, documentId: S.documentId, runKind: "explain", nodeAnchor: `blk:${row.blockStart}-${row.blockEnd}#${nodeId}`,
        spanHash: V.sha256(userText), chars: userText.length,
        outcome: !error ? "completed" : cancelled ? "cancelled" : error.streamStarted ? "unknown_outcome" : "failed",
        errorCode: error ? String(error.code || "error") : null, finishReason: (meta && meta.finishReason) || null, attempt: 1,
        wallMs: now() - startedAt, ttftMs: meta ? numOrNull(meta.ttftMs) : null, firstByteMs: meta ? numOrNull(meta.firstByteMs) : null,
        depth: V.rowDepth(g.byId, nodeId), parentNodeId: nodeId, spanChars: B.blockTextLength(blocks, row.blockStart, row.blockEnd),
        promptTokens: pt, completionTokens: ct, model: ai.model, ttfnMs: null, lines: null, linesDropped: null, dropJson: null,
        relsDropped: null, reasoningChars, trigger: "click",
      });
    } catch { /* 忽略 */ }
    M.calls++;
    M.promptTokens += pt || 0;
    M.completionTokens += ct || 0;
    M.reasoningChars += reasoningChars;
    const ok = !error && !!saved;
    emitDelta(Object.assign({}, base, {
      nodes: saved ? [toV2Node(saved)] : [],
      jobDone: { ok, error: error ? String(error.message || error.code) : ok ? undefined : "empty", finishReason: (meta && meta.finishReason) || null, cached: false, aborted: cancelled },
      metrics: metricsSnap(M),
    }));
    return { ok, aborted: cancelled, called: 1 };
  }

  // ---------- 取消 / 视图 / 指标 / 原文 ----------
  function graphCancel(p) {
    const o = p || {};
    if (o.jobId != null) {
      const id = String(o.jobId);
      const j = jobs.get(id);
      if (j) scheduler.cancel(j.key);
      dropWaiters((w) => w.id === id);
    }
    const touched = [];
    if (o.runId != null) {
      const id = String(o.runId);
      const G = gens.get(id);
      const E = alls.get(id);
      if (G) { G.cancelled = true; touched.push(G); }
      if (E) { E.cancelled = true; touched.push(E); }
      scheduler.cancelWhere((i) => i.meta && i.meta.runId === id);
    }
    if (o.mapId != null) {
      const id = String(o.mapId);
      for (const G of gens.values()) if (G.mapId === id) { G.cancelled = true; touched.push(G); }
      for (const E of alls.values()) if (E.mapId === id) { E.cancelled = true; touched.push(E); }
      scheduler.cancelWhere((i) => i.meta && i.meta.mapId === id);
      dropWaiters((w) => w.mapId === id);
    }
    for (const x of touched) {
      if (gens.get(x.runId) === x) genMaybeFinish(x);
      else if (alls.get(x.runId) === x) allMaybeFinish(x);
    }
    return true;
  }

  function graphSetView(p) {
    const o = p || {};
    let view = o.view == null ? null : o.view;
    if (view) {
      const patterns = view.patterns && typeof view.patterns === "object" && !Array.isArray(view.patterns) ? view.patterns : {};
      const collapsed = Array.isArray(view.collapsed) ? view.collapsed.map(String) : [];
      view = Object.assign({}, view, { patterns, collapsed });
    }
    store.setMaterialMapView(String(o.mapId), view);
    return true;
  }

  function graphMetrics(p) {
    const mapId = String((p && p.mapId) || "");
    const live = metricsByMap.get(mapId);
    if (live) return metricsSnap(live);
    // 重启后：由账本（+ run.output 里的缓存命中/框架耗时）重新聚合
    const map = store.getMaterialMap(mapId);
    const M = newMetrics(map ? (map.structure && map.structure.model) || map.model || "" : "");
    if (!map || typeof store.listMaterialMapRuns !== "function") return metricsSnap(M);
    let runs = [];
    try { runs = store.listMaterialMapRuns(map.documentId, 200) || []; } catch { runs = []; }
    const mine = runs.filter((r) => r && r.input && r.input.engine === "v2" && String(r.input.mapId) === mapId);
    const gen = mine.filter((r) => r.input.kind === "generate").sort((a, b) => a.createdAt - b.createdAt)[0] || null;
    M.startedAt = gen ? gen.createdAt : mine.length ? Math.min(...mine.map((r) => r.createdAt)) : M.startedAt;
    let ttfn = null, framework = null;
    for (const r of mine) {
      const out = r.output && r.output.metrics;
      if (out && Number.isFinite(out.cacheHits)) M.cacheHits += out.cacheHits;
      if (r === gen && out && Number.isFinite(out.frameworkMs)) framework = out.frameworkMs;
      for (const c of store.listMaterialMapCalls(r.id) || []) {
        M.calls++;
        M.promptTokens += c.promptTokens || 0;
        M.completionTokens += c.completionTokens || 0;
        M.reasoningChars += c.reasoningChars || 0;
        M.lines += c.lines || 0;
        M.linesDropped += c.linesDropped || 0;
        M.relsDropped += c.relsDropped || 0;
        if (c.dropJson) { try { for (const [k, v] of Object.entries(JSON.parse(c.dropJson))) M.byReason[k] = (M.byReason[k] || 0) + (Number(v) || 0); } catch { /* 忽略 */ } }
        if (M.firstTtftMs == null && Number.isFinite(c.ttftMs) && r === gen) M.firstTtftMs = c.ttftMs;
        if (r === gen && c.runKind === "outline" && Number.isFinite(c.ttfnMs)) {
          const startOff = c.createdAt - (c.wallMs || 0) - M.startedAt;
          const t = Math.max(0, startOff + c.ttfnMs);
          if (ttfn == null || t < ttfn) ttfn = t;
          const end = c.createdAt - M.startedAt;
          if (framework == null || (!(gen.output && gen.output.metrics) && end > framework)) framework = end;
        }
      }
    }
    M.ttfnMs = ttfn;
    M.frameworkMs = framework;
    return metricsSnap(M);
  }

  function graphNodeText(p) {
    const o = p || {};
    const g = loadGraph(String(o.mapId));
    const row = g && g.byId.get(String(o.nodeId));
    const none = { text: null, unitAnchor: null };
    if (!row || !g.S) return none;
    const S = g.S;
    const blocks = blocksFor(g);
    if (row.blockStart != null && row.blockEnd != null && blocks && blocks.length && blocks[blocks.length - 1].no >= row.blockEnd) {
      const b0 = blocks[row.blockStart - 1], b1 = blocks[row.blockEnd - 1];
      if (b0 && b1) return { text: S.linear.text.slice(b0.start, b1.end), unitAnchor: S.units[b0.unit] == null ? null : S.units[b0.unit] };
    }
    if (S.complete && Array.isArray(row.spans) && row.spans.length) {
      const [s, e] = row.spans[0];
      const idx = S.linear.unitBase.reduce((k, base, i) => (base <= s ? i : k), 0);
      return { text: S.linear.text.slice(s, e), unitAnchor: S.units[idx] == null ? null : S.units[idx] };
    }
    return none;
  }

  function graphEstimate(p) {
    const docId = String((p && p.documentId) || "");
    const S = sessions.get(docId);
    const ai = aiInfo();
    const out = { scopes: 0, chars: 0, estPromptTokens: 0, estCompletionTokens: 0, model: ai.model, concurrency: ai.settings.concurrency, textReady: !!(S && S.complete), floorScopes: 0 };
    if (!S) return out;
    const sys = estimateTokens(promptOf("outline").content);
    for (const sc of S.scopes) {
      if (sc.floor) { out.floorScopes++; continue; }
      out.scopes++;
      out.chars += sc.chars;
      out.estPromptTokens += sys + estimateTokens(B.renderNumbered(S.linear.text, S.blocks, sc.blockFrom, sc.blockTo)) + 200;
      out.estCompletionTokens += Math.min(MAX_TOKENS.outline, 150 + Math.ceil(sc.chars / 10));
    }
    return out;
  }

  async function idle() {
    for (let i = 0; i < 200; i++) {
      await scheduler.idle();
      await new Promise((r) => setImmediate(r));
      const st = scheduler.stats();
      if (!st.running && !st.queued) return;
    }
  }

  return {
    graphLoad, graphFeed, graphEstimate, graphGenerate, graphExpand, graphExpandAll, graphExplain, graphCancel,
    graphResume, graphSetView, graphMetrics, graphNodeText,
    readMindmapSettings, idle, scheduler,
  };
}

module.exports = { createMindmapEngineV2, normalizeMindmapSettings, toV2Node, toV2Edge, SCOPE, MAX_TOKENS };
