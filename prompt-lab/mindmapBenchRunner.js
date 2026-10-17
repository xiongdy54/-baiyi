"use strict";
// 导图 v2 基准页 · 运行编排（无 Electron 依赖：chatStream / getAIConfig / emit / persist 全部注入，便于用假模型流模拟）。
// 负责：线性化 → 全局块号 → 作用域规划 → 并发 outline → 深挖 expand → explain → 指标账本与汇总。
// 渲染层只接收 emit 出去的事件，不碰模型输出的 HTML（渲染层一律 textContent）。

const path = require("path");
const Blocks = require(path.join(__dirname, "..", "electron", "mindmapBlocks.js"));
const Outline = require(path.join(__dirname, "..", "electron", "mindmapOutline.js"));
const Prompts = require(path.join(__dirname, "mindmapV2Prompts.js"));
const Core = require(path.join(__dirname, "mindmapBenchCore.js"));

const TEMPERATURE = 0.3;

function clampConcurrency(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(8, v)) : 4;
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
const depthOf = (p) => String(p).split(".").length;

function createBenchRunner(deps) {
  const { chatStream, getAIConfig } = deps;
  const emit = deps.emit || (() => {});
  const persist = deps.persist || (() => {});
  const now = deps.now || (() => Date.now());
  const runs = new Map();

  function modelInfo() {
    const c = getAIConfig() || {};
    return { preset: c.preset || "", presetName: c.presetName || c.preset || "", model: c.model || "" };
  }

  // 一次流式调用：content 增量给 onDelta，reasoning 只丢弃；返回 { meta, error, totalMs }
  async function streamOnce(messages, signal, onDelta) {
    const t0 = now();
    let meta = null, error = null;
    try {
      meta = await chatStream({ messages, temperature: TEMPERATURE, abortSignal: signal }, (m) => {
        if (m && m.delta) onDelta(String(m.delta));
      });
    } catch (e) {
      error = e && e.code === "cancelled" ? "已取消" : (e && e.message) || String(e);
    }
    return { meta: meta || {}, error, totalMs: now() - t0 };
  }

  function makeCallRecord(run, kind, key, f) {
    const u = (f.meta && f.meta.usage) || {};
    const st = f.stats || {};
    const mi = run.model;
    return {
      type: "call", runId: run.id, ts: f.startedAt, kind, key,
      preset: mi.preset, model: mi.model,
      sentChars: f.sentChars, blocks: f.blocks,
      startOffsetMs: f.startedAt - run.startedAt,
      firstByteMs: num(f.meta && f.meta.firstByteMs), ttftMs: num(f.meta && f.meta.ttftMs), ttfnMs: f.ttfnMs == null ? null : f.ttfnMs,
      totalMs: f.totalMs,
      promptTokens: num(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens),
      completionTokens: num(u.completion_tokens != null ? u.completion_tokens : u.output_tokens),
      finishReason: (f.meta && f.meta.finishReason) || null,
      lines: st.lines == null ? null : st.lines, accepted: st.accepted == null ? null : st.accepted, dropped: st.dropped == null ? null : st.dropped,
      byReason: st.byReason || null, relsDropped: st.relsDropped == null ? null : st.relsDropped, clamped: st.clamped == null ? null : st.clamped,
      error: f.error || null,
    };
  }
  function num(v) { return Number.isFinite(v) ? v : null; }

  function treeCounts(run) {
    let total = 0, plus = 0;
    for (const n of run.nodes.values()) {
      if (n.source !== "ai") continue;
      total++;
      if (n.plusShown) plus++;
    }
    return { total, plus };
  }

  function publicNode(n) {
    return { path: n.path, parentPath: n.parentPath, type: n.type, title: n.title, time: n.time, blockFrom: n.blockFrom, blockTo: n.blockTo, more: n.more, pattern: n.pattern, rels: n.rels.slice(), warnings: n.warnings, state: n.state, source: n.source, depth: depthOf(n.path) };
  }

  function summaryOf(run) {
    const summary = Core.summarizeRun(run.calls, { wallMs: run.wallMs, outlineComplete: run.outlineComplete, tree: treeCounts(run) });
    return { summary, kpi: Core.judgeKpi(summary, { chars: run.chars }) };
  }

  function flushRun(run) {
    const { summary, kpi } = summaryOf(run);
    persist({
      type: "run", runId: run.id, ts: run.startedAt, material: run.title, chars: run.chars, blocks: run.blocks.length,
      scopes: run.scopes.length, concurrency: run.concurrency, preset: run.model.preset, model: run.model.model, summary, kpi,
    });
    emit({ t: "summary", runId: run.id, summary, kpi });
  }

  // parser 回调：接受节点 → 建记录 + 通知；onRel 补关系
  function makeParser(run, scope, basePath, onFirstNode, collect) {
    return Outline.createLineParser({
      scope, basePath,
      onNode: (n) => {
        const depth = depthOf(n.path);
        const floor = Outline.isLocalFloor({ blockFrom: n.blockFrom, blockTo: n.blockTo }, run.blocks, depth);
        const rec = Object.assign({}, n, { source: "ai", state: floor ? "floor" : n.more ? "open" : "leaf", plusShown: !floor && n.more });
        run.nodes.set(n.path, rec);
        // 已有子节点的 + 节点不再给「+」（避免对同一节点重复深挖、路径冲突）
        const par = run.nodes.get(n.parentPath);
        if (par && par.source === "ai" && par.state === "open") { par.state = "expanded"; emit({ t: "state", runId: run.id, path: par.path, state: "expanded" }); }
        if (collect) collect.push(rec);
        if (onFirstNode) onFirstNode();
        emit({ t: "node", runId: run.id, node: publicNode(rec) });
      },
      onRel: (r) => {
        const from = run.nodes.get(r.from);
        if (!from) return;
        from.rels.push({ code: r.code, target: r.target });
        emit({ t: "rel", runId: run.id, from: r.from, code: r.code, target: r.target });
      },
      onDrop: () => {},
    });
  }

  async function runOutlineScope(run, sc) {
    const numbered = Blocks.renderNumbered(run.linear, run.blocks, sc.blockFrom, sc.blockTo);
    const depth = Prompts.targetDepth(sc.chars);
    const messages = [
      { role: "system", content: Prompts.OUTLINE_SYSTEM },
      { role: "user", content: Prompts.buildOutlineUser({ title: run.title, path: [run.title, sc.title], numberedText: numbered, depth }) },
    ];
    emit({ t: "scope", runId: run.id, id: sc.id, status: "running" });
    const startedAt = now();
    let ttfnMs = null;
    const parser = makeParser(run, { blockFrom: sc.blockFrom, blockTo: sc.blockTo }, sc.id, () => { if (ttfnMs == null) ttfnMs = now() - startedAt; });
    const f = await streamOnce(messages, run.controller.signal, (d) => parser.push(d));
    const stats = parser.end();
    const rec = makeCallRecord(run, "outline", sc.id, { meta: f.meta, error: f.error, totalMs: f.totalMs, startedAt, sentChars: sc.chars, blocks: sc.blocks, stats, ttfnMs });
    run.calls.push(rec);
    persist(rec);
    emit({ t: "call", runId: run.id, record: rec });
    emit({ t: "scope", runId: run.id, id: sc.id, status: f.error ? (run.controller.signal.aborted ? "cancelled" : "error") : "done", error: f.error });
  }

  // 材料 → 启动一次 run。返回 { runId, done: Promise<void> }。
  function startRun({ title, chapters, concurrency }) {
    const cleanTitle = String(title || "").trim() || "未命名材料";
    const lin = Core.linearize((chapters || []).map((c) => ({ title: c.title, text: c.text })));
    if (!lin.linear.trim()) throw new Error("材料为空");
    const blocks = Blocks.segmentBlocks(lin.linear);
    if (!blocks.length) throw new Error("材料无法切出文本块");
    const scopes = Core.planScopes(chapters, blocks, lin);
    const run = {
      id: newId(), title: cleanTitle, linear: lin.linear, blocks, scopes, chars: blocks.reduce((n, b) => n + b.end - b.start, 0),
      concurrency: clampConcurrency(concurrency), model: modelInfo(), startedAt: now(), wallMs: null, outlineComplete: false,
      nodes: new Map(), calls: [], controller: new AbortController(), active: new Set(),
    };
    runs.set(run.id, run);
    for (const sc of scopes) {
      run.nodes.set(sc.id, { path: sc.id, parentPath: null, type: "章", title: sc.title, time: null, blockFrom: sc.blockFrom, blockTo: sc.blockTo, more: false, pattern: null, rels: [], warnings: [], source: "local", state: "local" });
    }
    emit({
      t: "run-start", runId: run.id, title: run.title, chars: run.chars, concurrency: run.concurrency, model: run.model,
      blocks: blocks.map((b) => run.linear.slice(b.start, b.end).replace(/\s*[\r\n]+\s*/g, " ")), headings: blocks.map((b) => b.heading),
      scopes: scopes.map((s) => ({ id: s.id, title: s.title, blockFrom: s.blockFrom, blockTo: s.blockTo, chars: s.chars })),
    });
    const queue = scopes.slice();
    const worker = async () => {
      while (queue.length && !run.controller.signal.aborted) await runOutlineScope(run, queue.shift());
    };
    const done = Promise.all(Array.from({ length: Math.min(run.concurrency, scopes.length) }, worker)).then(() => {
      run.wallMs = now() - run.startedAt;
      run.outlineComplete = !run.controller.signal.aborted && run.calls.filter((c) => c.kind === "outline").length === scopes.length && run.calls.every((c) => !c.error);
      emit({ t: "run-done", runId: run.id, cancelled: run.controller.signal.aborted });
      flushRun(run);
    });
    return { runId: run.id, done };
  }

  function cancel(runId) {
    const run = runs.get(runId);
    if (!run) return;
    run.controller.abort();
    for (const c of run.active) c.abort();
  }

  // 运行后的深挖/explain 各用独立的取消器（outline 被取消后仍可单独深挖）
  async function withCtrl(run, fn) {
    const c = new AbortController();
    run.active.add(c);
    try { return await fn(c.signal); } finally { run.active.delete(c); }
  }

  function ancestorsOf(run, node) {
    const chain = [];
    let p = node.parentPath;
    while (p) {
      const n = run.nodes.get(p);
      if (!n) break;
      chain.unshift(n.title);
      p = n.parentPath;
    }
    return [run.title].concat(chain);
  }
  function siblingsOf(run, node) {
    const out = [];
    for (const n of run.nodes.values()) if (n.parentPath === node.parentPath && n.path !== node.path) out.push(n.title);
    return out;
  }
  const setState = (run, n, state) => { n.state = state; emit({ t: "state", runId: run.id, path: n.path, state }); };

  async function expand(runId, nodePath) {
    const run = runs.get(runId);
    const node = run && run.nodes.get(nodePath);
    if (!node || node.source !== "ai") throw new Error("找不到该节点");
    if (node.state !== "open") return { skipped: true, state: node.state };
    setState(run, node, "expanding");
    const numbered = Blocks.renderNumbered(run.linear, run.blocks, node.blockFrom, node.blockTo);
    const span = node.blockTo - node.blockFrom + 1;
    const depth = span <= 8 ? 1 : 2;
    const messages = [
      { role: "system", content: Prompts.EXPAND_SYSTEM },
      { role: "user", content: Prompts.buildExpandUser({ title: run.title, ancestors: ancestorsOf(run, node), siblings: siblingsOf(run, node), node: { title: node.title, type: node.type }, numberedText: numbered, depth }) },
    ];
    const startedAt = now();
    let ttfnMs = null;
    const fresh = [];
    const parser = makeParser(run, { blockFrom: node.blockFrom, blockTo: node.blockTo }, node.path, () => { if (ttfnMs == null) ttfnMs = now() - startedAt; }, fresh);
    const f = await withCtrl(run, (sig) => streamOnce(messages, sig, (d) => parser.push(d)));
    const stats = parser.end();
    const rec = makeCallRecord(run, "expand", node.path, { meta: f.meta, error: f.error, totalMs: f.totalMs, startedAt, sentChars: Core.blockChars(run.blocks, node.blockFrom, node.blockTo), blocks: span, stats, ttfnMs });
    run.calls.push(rec);
    persist(rec);
    emit({ t: "call", runId: run.id, record: rec });
    const direct = fresh.filter((n) => n.parentPath === node.path).length; // 本次 expand 新增的直接子节点
    // 第 3 道门：出错则回到可重试的「+」；返回 <2 个子节点 → 回判触底
    setState(run, node, f.error ? "open" : direct >= 2 ? "expanded" : "recheck");
    flushRun(run);
    return { children: direct, error: f.error };
  }

  async function explain(runId, nodePath) {
    const run = runs.get(runId);
    const node = run && run.nodes.get(nodePath);
    if (!node) throw new Error("找不到该节点");
    const numbered = Blocks.renderNumbered(run.linear, run.blocks, node.blockFrom, node.blockTo);
    const messages = [
      { role: "system", content: Prompts.EXPLAIN_SYSTEM },
      { role: "user", content: Prompts.buildExplainUser({ title: run.title, ancestors: ancestorsOf(run, node), node: { title: node.title, type: node.type }, numberedText: numbered, siblings: siblingsOf(run, node) }) },
    ];
    const startedAt = now();
    let text = "";
    emit({ t: "explain-start", runId, path: nodePath });
    const f = await withCtrl(run, (sig) => streamOnce(messages, sig, (d) => { text += d; emit({ t: "explain-delta", runId, path: nodePath, delta: d }); }));
    const rec = makeCallRecord(run, "explain", node.path, { meta: f.meta, error: f.error, totalMs: f.totalMs, startedAt, sentChars: Core.blockChars(run.blocks, node.blockFrom, node.blockTo), blocks: node.blockTo - node.blockFrom + 1, stats: null, ttfnMs: null });
    run.calls.push(rec);
    persist(rec);
    emit({ t: "call", runId, record: rec });
    emit({ t: "explain-done", runId, path: nodePath, error: f.error });
    flushRun(run);
    return { text, error: f.error };
  }

  return { startRun, cancel, expand, explain, getRun: (id) => runs.get(id), summaryOf };
}

module.exports = { createBenchRunner, clampConcurrency, TEMPERATURE };
