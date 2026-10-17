// @runtime: node
// 材料导图 v2 主进程引擎回归（node tests/m15v2.engine.test.cjs）。
// 依据：docs/design/MINDMAP-V2-IMPL-PLAN.md §6 T3「引擎」验收 ①–⑩ + 交接要点（再深挖整枝替换 / 首批前失败删除未激活版本）。
// 假 chatStream：按用户消息里的【原文块号】【目标层数】确定性地分块吐行协议文本；内存版 store（tests/lib/mindmapMemoryStore.cjs）。
const path = require("path");
const fs = require("fs");
const root = path.join(__dirname, "..");
const { createMindmapEngineV2, normalizeMindmapSettings } = require(path.join(root, "electron", "mindmapEngineV2.js"));
const { createMemoryStore } = require(path.join(root, "tests", "lib", "mindmapMemoryStore.cjs"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const J = (x) => JSON.stringify(x);
const tick = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------- 夹具：目录书（与 m15v2.core.test 同形态）
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SENT = ["知识是经过检验的信念。", "这个定义解释了记忆的机制。", "作者先提出问题再给出回答。", "反方认为机会平等就够了。", "然而平等的起点也会固化等级。", "Short line.", "数据显示两组差异显著；"];
function para(rnd, n) { let s = ""; for (let i = 0; i < n; i++) s += SENT[Math.floor(rnd() * SENT.length)]; return s; }
function unitText(rnd, chars) {
  const lines = [];
  let len = 0;
  while (len < chars) {
    const l = para(rnd, 8 + Math.floor(rnd() * 20));
    lines.push(l);
    len += l.length + 1;
  }
  return lines.join("\n\n");
}
function makeBook(seed) {
  const rnd = lcg(seed);
  const tocItems = [
    { anchor: "u0.xhtml", label: "前言" },
    { anchor: "u1.xhtml", label: "第一章 问题", children: [
      { anchor: "u2.xhtml", label: "1.1 背景" },
      { anchor: "u3.xhtml", label: "1.2 论证" },
    ] },
    { anchor: "u4.xhtml", label: "第二章 短章" },
    { anchor: "u5.xhtml", label: "第三章 终章" },
  ];
  const units = ["u0.xhtml", "u1.xhtml", "u2.xhtml", "u3.xhtml", "u4.xhtml", "u5.xhtml"];
  const sizes = [2000, 900, 3500, 14000, 0, 2200]; // 1.2 论证 >1.2 万字 → 目标 2 层，末层产出可深挖的 more 节点
  const tb = {};
  units.forEach((u, i) => { tb[u] = unitText(rnd, sizes[i]); });
  tb["u4.xhtml"] = "第二章 短章\n这一章只有很短的一段正文，用来检验作用域低于四百字时直接封顶、零调用。";
  return { documentId: "doc-1", title: "测试材料", tocItems, units, tb };
}
const BOOK = makeBook(5);

// ---------------------------------------------------------------- 假模型
// 生成规则：区间 [lo,hi] 切成 ≤3 段；未到目标层数且段 ≥2 块 → 递归；最末层 ≥2 块的段标 '+'，其余 '.'；
// 每个第 2 个兄弟带一条 &支 指向第 1 个兄弟（检验关系落库）。
function genLines(lo, hi, levels) {
  const out = [];
  (function rec(prefix, a, b, lvl) {
    const n = b - a + 1;
    const k = Math.min(3, n);
    if (k < 2) return;
    let start = a;
    for (let i = 1; i <= k; i++) {
      const size = Math.floor(n / k) + (i <= n % k ? 1 : 0);
      const from = start, to = start + size - 1;
      start = to + 1;
      const p = prefix ? `${prefix}.${i}` : String(i);
      const last = lvl >= levels;
      const mark = last && size >= 2 ? "+" : ".";
      const deeper = !last && size >= 2;
      const rel = i === 2 ? ` &支${prefix ? prefix + "." : ""}1` : "";
      out.push(`${p} [论点] 节${from}至${to} @${from}-${to} ${deeper ? "+" : mark}${rel}`);
      if (deeper) rec(p, from, to, lvl + 1);
    }
  })("", lo, hi, 1);
  return out;
}
function parseUser(u) {
  const m = /【原文块号】\[(\d+)\](?:–\[(\d+)\])?/.exec(u);
  const lv = /【目标层数】(\d+)/.exec(u);
  const lo = Number(m[1]);
  return { lo, hi: m[2] ? Number(m[2]) : lo, levels: lv ? Number(lv[1]) : 1 };
}
const kindOf = (opts) => (opts.maxTokens === 3000 ? "outline" : opts.maxTokens === 1500 ? "expand" : "explain");

/** behave(kind, info, opts) -> { lines?, text?, finishReason?, error?, hangAfter?, raw? } 可改写默认行为 */
function makeChat(log, behave) {
  return async function chatStream(opts, send) {
    const user = opts.messages[1].content;
    const kind = kindOf(opts);
    const info = kind === "explain" ? null : parseUser(user);
    const plan = Object.assign({ finishReason: "stop" }, (behave && behave(kind, info, opts)) || {});
    const entry = { kind, info, opts, startedAt: log.seq++, endedAt: null };
    log.calls.push(entry);
    if (plan.error && !plan.hangAfter) { await tick(); throw plan.error; }
    let raw = plan.raw != null ? plan.raw
      : kind === "explain" ? (plan.text || "这一节先提出问题，再给出回答。")
        : (plan.lines || genLines(info.lo, info.hi, info.levels)).map((l) => l + "\n").join("");
    send({ thinking: 0 });
    let emitted = 0;
    for (let i = 0; i < raw.length; i += 7) {
      if (opts.abortSignal && opts.abortSignal.aborted) break;
      send({ delta: raw.slice(i, i + 7) });
      emitted++;
      if (plan.hangAfter && emitted * 7 >= plan.hangAfter) {
        await new Promise((res) => {
          if (opts.abortSignal.aborted) return res();
          opts.abortSignal.addEventListener("abort", res, { once: true });
        });
        break;
      }
      if (i % 35 === 0) await tick();
    }
    send({ thinking: 12 });
    entry.endedAt = log.seq++;
    if (opts.abortSignal && opts.abortSignal.aborted) { const e = new Error("已取消"); e.code = "cancelled"; e.streamStarted = true; throw e; }
    if (plan.error) throw plan.error;
    return { usage: { prompt_tokens: 100, completion_tokens: 50 }, finishReason: plan.finishReason, ttftMs: 5, firstByteMs: 3 };
  };
}

function mkEnv(o) {
  const opt = o || {};
  const log = { seq: 0, calls: [] };
  const store = opt.store || createMemoryStore();
  const ledger = [];
  const rawSave = store.saveMaterialMapCall;
  store.saveMaterialMapCall = (p) => { ledger.push(JSON.parse(J(p))); return rawSave(p); };
  const deltas = [];
  const changes = [];
  let behave = opt.behave || null;
  const settings = { app: Object.assign({ mindmapConcurrency: 2 }, opt.app || {}) };
  const engine = createMindmapEngineV2({
    store,
    chatStream: makeChat(log, (k, i, op) => (behave ? behave(k, i, op) : null)),
    readSettings: () => settings,
    getAIConfig: () => ({ preset: "siliconflow", model: "deepseek-ai/DeepSeek-V4.1-Flash", reasoningEffort: "low" }),
    getPromptTemplate: () => null,
    broadcastChanged: (p) => { changes.push(JSON.parse(J(p))); },
    broadcastDelta: (p) => { deltas.push(Object.assign({ seq: log.seq++ }, JSON.parse(J(p)))); },
  });
  return { engine, store, log, deltas, changes, settings, ledger, setBehave: (b) => { behave = b; } };
}
function feedAll(engine, book) {
  let r;
  book.units.forEach((u, i) => {
    r = engine.graphFeed({ documentId: book.documentId, title: book.title, tocItems: book.tocItems, unitAnchors: book.units, index: i, text: book.tb[u], last: i === book.units.length - 1 });
  });
  return r;
}
const strip = (rows) => rows.map(({ jobId, ...r }) => r);
const nodesOf = (store, mapId) => store.listMaterialMapNodes(mapId);
async function settle(engine) { await engine.idle(); for (let i = 0; i < 5; i++) await tick(); }

const KNOWN = (() => {
  const src = fs.readFileSync(path.join(root, "src", "lib", "activity.ts"), "utf8");
  const m = /const KNOWN_PHASES[^=]*=\s*\[([\s\S]*?)\]/.exec(src);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
})();

(async () => {
  console.log("---- 设置归一 ----");
  {
    const s = normalizeMindmapSettings({ app: { mindmapConcurrency: 99, mindmapPrefetch: { enabled: false, dailyLimit: "7" }, mindmapExplainAuto: "true", mindmapModel: "  m  " } });
    check("并发夹 1–8、预取对象、explainAuto 仅严格 true、模型 trim", s.concurrency === 8 && s.prefetch.enabled === false && s.prefetch.dailyLimit === 7 && s.explainAuto === false && s.model === "m", s);
    const d = normalizeMindmapSettings(null);
    check("缺省：并发 4 / 预取开 30 / maxCalls 300 / retry 3", d.concurrency === 4 && d.prefetch.enabled && d.prefetch.dailyLimit === 30 && d.maxCalls === 300 && d.retryMax === 3, d);
  }

  // ======================================================== ①②⑨⑩ 整图生成
  console.log("---- ① 整图生成：完整树、delta 递增 ----");
  const A = mkEnv();
  const fr = feedAll(A.engine, BOOK);
  check("graphFeed 放出作用域", fr.blocksReady > 10 && fr.scopesReady >= 5, fr);
  const est = A.engine.graphEstimate({ documentId: BOOK.documentId });
  check("graphEstimate：段数/字数/模型/并发，短章计 floor", est.scopes >= 4 && est.floorScopes >= 1 && est.chars > 5000 && est.model === "deepseek-ai/DeepSeek-V4.1-Flash" && est.concurrency === 2 && est.textReady, est);
  const g1 = A.engine.graphGenerate({ documentId: BOOK.documentId, title: BOOK.title });
  check("graphGenerate 立即返回 runId/mapId", g1 && g1.runId && g1.mapId);
  const again = A.engine.graphGenerate({ documentId: BOOK.documentId });
  check("同文档生成中再次调用返回同一 run", again.runId === g1.runId && again.mapId === g1.mapId);
  await settle(A.engine);
  const rows1 = nodesOf(A.store, g1.mapId);
  const ids1 = new Set(rows1.map((r) => r.nodeId));
  const ai1 = rows1.filter((r) => r.source === "ai");
  check("产出 AI 节点", ai1.length > 20, ai1.length);
  check("树完整：每个非根节点的父都在", rows1.every((r) => r.parentId == null || ids1.has(r.parentId)), rows1.filter((r) => r.parentId != null && !ids1.has(r.parentId)).map((r) => r.nodeId));
  check("单根", rows1.filter((r) => r.parentId == null).length === 1);
  const outlineCalls = A.log.calls.filter((c) => c.kind === "outline").length;
  check("调用数＝非 floor 作用域数（短章零调用）", outlineCalls === est.scopes, { outlineCalls, est: est.scopes });
  const shortRow = rows1.find((r) => r.source === "toc" && /短章/.test(r.title));
  check("短章（<400 字）目录节点 floor 且无 AI 子节点", shortRow && shortRow.state === "floor" && !rows1.some((r) => r.parentId === shortRow.nodeId), shortRow);
  const scopeRows = rows1.filter((r) => r.source === "toc" && r.state !== "floor" && r.parentId != null && !rows1.some((k) => k.parentId === r.nodeId && k.source === "toc"));
  check("每个非 floor 叶目录节点都已 open 且有 AI 子节点", scopeRows.length >= 3 && scopeRows.every((r) => r.state === "open" && rows1.some((k) => k.parentId === r.nodeId && k.source === "ai")), scopeRows.map((r) => [r.nodeId, r.state]));
  check("AI 节点 id 为路径式（作用域 id + 层级号）", ai1.every((r) => /^t\d+(p\d+)?(\.\d+)+$/.test(r.nodeId)), ai1.slice(0, 3).map((r) => r.nodeId));
  const edges1 = A.store.listMaterialMapEdges(g1.mapId);
  check("关系落库（&支 → 前一兄弟）", edges1.length > 5 && edges1.every((e) => e.code === "支" && ids1.has(e.fromId) && ids1.has(e.toId)), edges1.length);
  const map1 = A.store.getMaterialMap(g1.mapId);
  check("首个 AI 批次后版本激活、schemaVersion=2", map1.isActive && map1.schemaVersion === 2, { isActive: map1.isActive, sv: map1.schemaVersion });
  // delta 节点数递增（累计不同节点 id 单调增长，且最终覆盖全部 AI 节点）
  {
    const seen = new Set();
    const counts = [];
    for (const d of A.deltas) if (d.mapId === g1.mapId && (d.kind === "outline") && d.nodes && d.nodes.length) { for (const n of d.nodes) seen.add(n.id); counts.push(seen.size); }
    check("outline delta 批次 >1 且累计节点数单调递增", counts.length > 3 && counts.every((c, i) => i === 0 || c >= counts[i - 1]) && counts[counts.length - 1] > counts[0], counts.slice(0, 10));
    check("delta 覆盖全部 AI 节点", ai1.every((r) => seen.has(r.nodeId)), ai1.filter((r) => !seen.has(r.nodeId)).map((r) => r.nodeId));
  }
  console.log("---- ② 首个节点 delta 早于流结束 ----");
  {
    const c0 = A.log.calls.find((c) => c.kind === "outline");
    const jobDeltas = A.deltas.filter((d) => d.kind === "outline" && d.nodes && d.nodes.length && !d.jobDone);
    const first = jobDeltas.length ? jobDeltas[0].seq : Infinity;
    check("首个节点批次 seq < 第一次调用流结束 seq", first < c0.endedAt, { first, end: c0.endedAt });
    const stream = A.deltas.find((d) => d.kind === "outline" && d.states && d.states.some((s) => s.state === "streaming"));
    check("任务开始先发目标 streaming 态", !!stream);
    const done = A.deltas.filter((d) => d.kind === "outline" && d.jobDone);
    check("每个 outline 任务一条 jobDone（ok、非缓存）", done.length === outlineCalls && done.every((d) => d.jobDone.ok && !d.jobDone.cached), done.map((d) => d.jobDone));
    check("jobDone 携带 metrics", done.every((d) => d.metrics && d.metrics.model === "deepseek-ai/DeepSeek-V4.1-Flash"));
  }
  console.log("---- ⑨ 账本：每调用一行、字段齐 ----");
  {
    const genCalls = A.store.listMaterialMapCalls(g1.runId);
    check("账本行数＝真实调用数", genCalls.length === outlineCalls, { rows: genCalls.length, outlineCalls });
    const keys = ["runKind", "nodeAnchor", "chars", "spanChars", "depth", "parentNodeId", "outcome", "finishReason", "wallMs", "ttftMs", "firstByteMs", "promptTokens", "completionTokens", "model", "ttfnMs", "lines", "linesDropped", "relsDropped", "reasoningChars", "trigger"];
    const bad = genCalls.filter((c) => keys.some((k) => c[k] === undefined || c[k] === null));
    check("字段齐（含 model/ttfnMs/lines/linesDropped/relsDropped/reasoningChars/trigger）", !bad.length, bad[0]);
    check("outcome=completed、trigger=auto、reasoningChars=12、nodeAnchor=blk:a-b", genCalls.every((c) => c.outcome === "completed" && c.trigger === "auto" && c.reasoningChars === 12 && /^blk:\d+-\d+$/.test(c.nodeAnchor)), genCalls[0]);
    const m = A.engine.graphMetrics({ mapId: g1.mapId });
    check("RunMetrics 字段齐、calls/tokens 累计", m.calls === outlineCalls && m.promptTokens === 100 * outlineCalls && m.completionTokens === 50 * outlineCalls && m.ttfnMs != null && m.frameworkMs != null && m.firstTtftMs === 5 && m.reasoningChars === 12 * outlineCalls && typeof m.concurrencyNow === "number", m);
  }

  // ======================================================== ③ 二次生成零调用
  console.log("---- ③ 同输入二次生成：零调用、节点逐字节同 ----");
  {
    const before = A.log.calls.length;
    const g2 = A.engine.graphGenerate({ documentId: BOOK.documentId });
    await settle(A.engine);
    check("零新调用", A.log.calls.length === before, A.log.calls.length - before);
    check("新版本行、已激活，旧版本降为历史", g2.mapId !== g1.mapId && A.store.getMaterialMap(g2.mapId).isActive && !A.store.getMaterialMap(g1.mapId).isActive);
    const rows2 = nodesOf(A.store, g2.mapId);
    check("节点逐字节相同（除 jobId）", J(strip(rows2)) === J(strip(nodesOf(A.store, g1.mapId))));
    const ek = (id) => A.store.listMaterialMapEdges(id).map((e) => `${e.fromId}>${e.toId}:${e.code}`).sort();
    check("边相同（集合）", J(ek(g2.mapId)) === J(ek(g1.mapId)) && ek(g1.mapId).length > 0);
    const m2 = A.engine.graphMetrics({ mapId: g2.mapId });
    check("cacheHits＝作用域数、calls=0、账本无新行", m2.cacheHits === outlineCalls && m2.calls === 0 && A.store.listMaterialMapCalls(g2.runId).length === 0, m2);
    const ld = A.engine.graphLoad({ documentId: BOOK.documentId });
    check("graphLoad({documentId}) 取当前激活版本、textReady", ld.meta.mapId === g2.mapId && ld.nodes.length === rows2.length && ld.textReady && ld.meta.schemaVersion === 2, ld.meta);
  }

  // ======================================================== ④ floor 零调用
  console.log("---- ④ floor 节点 expand：skipped:'floor' 零调用 ----");
  const mapA = A.engine.graphLoad({ documentId: BOOK.documentId }).meta.mapId;
  {
    const rows = nodesOf(A.store, mapA);
    const floorAi = rows.find((r) => r.source === "ai" && r.state === "floor");
    const shortRow = rows.find((r) => r.source === "toc" && /短章/.test(r.title));
    const before = A.log.calls.length;
    const r1 = A.engine.graphExpand({ mapId: mapA, nodeId: floorAi.nodeId, trigger: "click" });
    const r2 = A.engine.graphExpand({ mapId: mapA, nodeId: shortRow.nodeId, trigger: "click" });
    await settle(A.engine);
    check("AI floor 节点 → skipped floor", r1.skipped === "floor", r1);
    check("目录 floor（短章）→ skipped floor", r2.skipped === "floor", r2);
    const open = rows.find((r) => r.source === "toc" && r.state === "open" && r.parentId != null);
    const r3 = A.engine.graphExpand({ mapId: mapA, nodeId: open.nodeId, trigger: "click" });
    check("已 open 节点 → skipped cached", r3.skipped === "cached", r3);
    check("以上零调用", A.log.calls.length === before);
  }

  // ======================================================== 深挖（点击）+ 第 3 门 + 整枝替换
  console.log("---- 深挖：点击、第 3 门、length 回标后再深挖整枝替换 ----");
  {
    const rows = nodesOf(A.store, mapA);
    const mores = rows.filter((r) => r.source === "ai" && r.state === "more").sort((a, b) => a.ord - b.ord);
    check("夹具中存在可深挖的 more 节点 ≥4", mores.length >= 4, mores.length);
    const T = mores[0];
    const before = A.log.calls.length;
    const r = A.engine.graphExpand({ mapId: mapA, nodeId: T.nodeId, trigger: "click" });
    const dup = A.engine.graphExpand({ mapId: mapA, nodeId: T.nodeId, trigger: "click" });
    check("点击深挖返回 jobId；同节点重复 → busy", r.jobId && !r.skipped && dup.skipped === "busy", { r, dup });
    await settle(A.engine);
    const after = nodesOf(A.store, mapA);
    const kids = after.filter((k) => k.parentId === T.nodeId);
    check("一次调用、子节点挂到目标、目标 open", A.log.calls.length === before + 1 && kids.length >= 2 && after.find((k) => k.nodeId === T.nodeId).state === "open" && kids.every((k) => k.nodeId.startsWith(T.nodeId + ".")), kids.map((k) => k.nodeId));

    // 第 3 门：模型只给 1 个子节点 → 目标 floor、唯一子被丢、照常写缓存（再点零调用）
    const T2 = mores[1];
    A.setBehave((k, info) => (k === "expand" ? { lines: [`1 [论点] 唯一子 @${info.lo}-${info.hi} .`] } : null));
    const seenBefore = A.deltas.length;
    A.engine.graphExpand({ mapId: mapA, nodeId: T2.nodeId, trigger: "click" });
    await settle(A.engine);
    const r2 = nodesOf(A.store, mapA);
    check("第 3 门：目标 floor、唯一子不入库", r2.find((k) => k.nodeId === T2.nodeId).state === "floor" && !r2.some((k) => k.parentId === T2.nodeId));
    const leaked = A.deltas.slice(seenBefore).some((d) => d.nodes && d.nodes.some((n) => n.parentId === T2.nodeId));
    check("被第 3 门丢弃的子节点从不下发", !leaked);
    const c3 = A.log.calls.length;
    const r2b = A.engine.graphExpand({ mapId: mapA, nodeId: T2.nodeId, trigger: "click" });
    check("再点 → skipped floor 零调用", r2b.skipped === "floor" && A.log.calls.length === c3, r2b);
    // force 逃生口：跳过第 2/3 门
    A.setBehave(null);
    const rf = A.engine.graphExpand({ mapId: mapA, nodeId: T2.nodeId, trigger: "click", force: true });
    await settle(A.engine);
    // 同输入命中第 3 门写下的缓存（零调用）：force 跳过第 3 门，唯一子节点得以保留
    check("force 深挖 floor 节点：不被拒收、零调用回放缓存并保留子节点", rf.jobId && !rf.skipped && A.log.calls.length === c3 && nodesOf(A.store, mapA).some((k) => k.parentId === T2.nodeId), { rf, calls: A.log.calls.length - c3 });

    // ⑥ length 回标 + 交接要点 2：再深挖整枝替换
    console.log("---- ⑥ length 回标 / 再深挖整枝替换 ----");
    const T3 = mores[2];
    A.setBehave((k, info) => {
      if (k !== "expand") return null;
      const mid = Math.floor((info.lo + info.hi) / 2);
      return { raw: `1 [论点] 前半 @${info.lo}-${mid} +\n1.1 [证据] 孙 @${info.lo}-${info.lo} .\n2 [论点] 被截`, finishReason: "length" };
    });
    const d0 = A.deltas.length;
    A.engine.graphExpand({ mapId: mapA, nodeId: T3.nodeId, trigger: "click" });
    await settle(A.engine);
    const r3 = nodesOf(A.store, mapA);
    const st = (id) => (r3.find((k) => k.nodeId === id) || {}).state;
    check("length：最后接受节点的祖先链（孙→子）与目标回标 more", st(`${T3.nodeId}.1.1`) === "more" && st(`${T3.nodeId}.1`) === "more" && st(T3.nodeId) === "more", [st(`${T3.nodeId}.1.1`), st(`${T3.nodeId}.1`), st(T3.nodeId)]);
    const jd = A.deltas.slice(d0).find((d) => d.jobDone);
    check("jobDone.finishReason=length、metrics 计入 truncated 丢弃", jd && jd.jobDone.finishReason === "length" && jd.metrics.byReason.truncated >= 1, jd && jd.jobDone);
    A.setBehave(null);
    const d1 = A.deltas.length;
    const rr = A.engine.graphExpand({ mapId: mapA, nodeId: T3.nodeId, trigger: "click" });
    await settle(A.engine);
    const r4 = nodesOf(A.store, mapA);
    const kids4 = r4.filter((k) => k.parentId === T3.nodeId);
    check("再深挖发起（目标 more）", rr.jobId && !rr.skipped, rr);
    check("截断结果不入缓存：再深挖为真实调用", A.log.calls.filter((c) => c.kind === "expand").length >= 4);
    check("整枝替换：旧孙节点（新结果未产出）从库中消失", !r4.some((k) => k.nodeId === `${T3.nodeId}.1.1`) && kids4.length >= 2, kids4.map((k) => k.nodeId));
    const rmd = A.deltas.slice(d1).find((d) => d.jobDone && d.removed);
    check("jobDone 批次带 removed 列出被替换的旧节点", rmd && rmd.removed.includes(`${T3.nodeId}.1.1`), rmd && rmd.removed);
    check("目标最终 open", r4.find((k) => k.nodeId === T3.nodeId).state === "open");
  }

  // ======================================================== ⑦ 取消
  console.log("---- ⑦ 取消：已校验行落库、账本 cancelled ----");
  {
    const rows = nodesOf(A.store, mapA);
    const T = rows.filter((r) => r.source === "ai" && r.state === "more").sort((a, b) => a.ord - b.ord)[0];
    let lines = null;
    A.setBehave((k, info) => {
      if (k !== "expand") return null;
      lines = genLines(info.lo, info.hi, 1);
      const raw = lines.map((l) => l + "\n").join("");
      const cut = raw.indexOf("\n", raw.indexOf("\n") + 1) + 1; // 前两行完整送出后挂起
      return { raw, hangAfter: cut };
    });
    const r = A.engine.graphExpand({ mapId: mapA, nodeId: T.nodeId, trigger: "click" });
    for (let i = 0; i < 50; i++) await tick();
    check("任务运行中", A.engine.scheduler.stats().running === 1, A.engine.scheduler.stats());
    A.engine.graphCancel({ jobId: r.jobId });
    await settle(A.engine);
    const after = nodesOf(A.store, mapA);
    const kids = after.filter((k) => k.parentId === T.nodeId);
    check("已校验的前两行落库", kids.length >= 2 && kids.length < lines.length, { kids: kids.length, all: lines.length });
    const jd = A.deltas.filter((d) => d.jobId === r.jobId && d.jobDone).pop();
    check("jobDone aborted、ok=false", jd && jd.jobDone.aborted === true && jd.jobDone.ok === false, jd && jd.jobDone);
    const lr = A.ledger[A.ledger.length - 1];
    check("账本记 outcome=cancelled、trigger=click、runKind=expand", lr && lr.outcome === "cancelled" && lr.trigger === "click" && lr.runKind === "expand" && lr.parentNodeId === T.nodeId, lr);
    check("A 环境全程：账本行数＝真实调用数（每调用一行）", A.ledger.length === A.log.calls.length, { ledger: A.ledger.length, calls: A.log.calls.length });
    A.setBehave(null);
  }

  // ======================================================== ⑧ 预取同意与配额
  console.log("---- ⑧ 预取：X4 同意、每日上限 quota ----");
  {
    const B2 = mkEnv({ app: { mindmapPrefetch: { enabled: true, dailyLimit: 1 } } });
    feedAll(B2.engine, BOOK);
    const g = B2.engine.graphGenerate({ documentId: BOOK.documentId });
    await settle(B2.engine);
    const mores = nodesOf(B2.store, g.mapId).filter((r) => r.source === "ai" && r.state === "more");
    // 新引擎实例（模拟重启）：未获同意 → disabled
    const B3 = createMindmapEngineV2({ store: B2.store, chatStream: makeChat({ seq: 0, calls: [] }), readSettings: () => B2.settings, getAIConfig: () => ({ model: "x" }) });
    feedAll(B3, BOOK);
    check("本会话未主动请求过 → prefetch disabled", B3.graphExpand({ mapId: g.mapId, nodeId: mores[0].nodeId, trigger: "prefetch" }).skipped === "disabled");
    const before = B2.log.calls.length;
    const p1 = B2.engine.graphExpand({ mapId: g.mapId, nodeId: mores[0].nodeId, trigger: "prefetch" });
    await settle(B2.engine);
    check("生成过（已同意）→ 预取发起一次调用", p1.jobId && !p1.skipped && B2.log.calls.length === before + 1, p1);
    const p2 = B2.engine.graphExpand({ mapId: g.mapId, nodeId: mores[1].nodeId, trigger: "prefetch" });
    check("当日预取达上限 → quota、零调用", p2.skipped === "quota" && B2.log.calls.length === before + 1, p2);
    const c = B2.store.countMaterialMapCallsSince(BOOK.documentId, { trigger: "prefetch", sinceMs: 0 });
    check("账本 trigger=prefetch 计 1", c === 1, c);
    B2.settings.app.mindmapPrefetch = { enabled: false, dailyLimit: 30 };
    check("预取关闭 → disabled", B2.engine.graphExpand({ mapId: g.mapId, nodeId: mores[1].nodeId, trigger: "prefetch" }).skipped === "disabled");
    check("点击不受预取配额限制", !B2.engine.graphExpand({ mapId: g.mapId, nodeId: mores[1].nodeId, trigger: "click" }).skipped);
    await settle(B2.engine);
  }

  // ======================================================== ⑤ 首批前失败：旧激活版本不变、新版本删除
  console.log("---- ⑤ 首个 AI 批次前失败 ----");
  {
    const C = mkEnv();
    feedAll(C.engine, BOOK);
    const g0 = C.engine.graphGenerate({ documentId: BOOK.documentId });
    await settle(C.engine);
    const snap = J(nodesOf(C.store, g0.mapId));
    C.setBehave(() => { const e = new Error("network down"); e.code = "network"; return { error: e }; });
    const ch0 = C.changes.length;
    const gf = C.engine.graphGenerate({ documentId: BOOK.documentId, force: true });
    await settle(C.engine);
    check("force 不读缓存：发起了真实调用", C.log.calls.filter((c) => c.opts && c.kind === "outline").length > 0 && C.log.calls.length > 0);
    check("旧激活版本仍激活且节点不变", C.store.getMaterialMap(g0.mapId).isActive && J(nodesOf(C.store, g0.mapId)) === snap);
    check("未激活的新版本行被删除（不留空壳）", !C.store.getMaterialMap(gf.mapId) && nodesOf(C.store, gf.mapId).length === 0);
    const last = C.changes.slice(ch0).pop();
    check("changed 终态 failed、mapId=null、code=no_commit", last && last.stage === "failed" && last.mapId === null && last.code === "no_commit" && last.runId === gf.runId, last);
    const run = C.store.getMaterialMapRun(gf.runId);
    check("run 记录 failed、output.deleted", run && run.status === "failed" && run.output && run.output.deleted === true, run && { status: run.status, output: run.output });
    const fcalls = C.store.listMaterialMapCalls(gf.runId);
    check("失败调用照样记账（outcome=failed、errorCode=network）", fcalls.length > 0 && fcalls.every((c) => c.outcome === "failed" && c.errorCode === "network"), fcalls[0]);
    const ld = C.engine.graphLoad({ documentId: BOOK.documentId });
    check("graphLoad 仍返回旧图", ld.meta && ld.meta.mapId === g0.mapId);

    // 取消（首批前）：同样删除新版本、终态 cancelled
    C.setBehave(() => ({ raw: "x", hangAfter: 1 }));
    const gc = C.engine.graphGenerate({ documentId: BOOK.documentId, force: true });
    for (let i = 0; i < 30; i++) await tick();
    C.engine.graphCancel({ runId: gc.runId });
    await settle(C.engine);
    const lc = C.changes.filter((c) => c.runId === gc.runId).pop();
    check("首批前取消：changed cancelled、新版本删除、旧版本仍激活", lc && lc.stage === "cancelled" && !C.store.getMaterialMap(gc.mapId) && C.store.getMaterialMap(g0.mapId).isActive, lc);
    C.setBehave(null);
  }

  // ======================================================== 深挖全部 + ⑩ 指示器
  console.log("---- 深挖全部 / ⑩ 仅两类 run 发 changed、阶段 ∈ KNOWN_PHASES ----");
  {
    const D = mkEnv({ app: { mindmapMaxCalls: 3 } });
    feedAll(D.engine, BOOK);
    const g = D.engine.graphGenerate({ documentId: BOOK.documentId });
    await settle(D.engine);
    const before = D.log.calls.length;
    const ea = D.engine.graphExpandAll({ mapId: g.mapId });
    check("graphExpandAll 返回 runId，按预算排队", ea.runId && ea.queued >= 1 && ea.queued <= 3, ea);
    await settle(D.engine);
    check("深挖全部总调用 ≤ 预算 3", D.log.calls.length - before <= 3 && D.log.calls.length - before >= 1, D.log.calls.length - before);
    const ex = D.engine.graphExplain({ mapId: g.mapId, nodeId: nodesOf(D.store, g.mapId).find((r) => r.source === "ai").nodeId });
    await settle(D.engine);
    check("explain 返回 jobId", ex.jobId, ex);
    const runIds = new Set(D.changes.map((c) => c.runId));
    check("changed 只来自生成与深挖全部两个 run", runIds.size === 2 && runIds.has(g.runId) && runIds.has(ea.runId), [...runIds]);
    check("KNOWN_PHASES 已从 activity.ts 读出", KNOWN.includes("running") && KNOWN.includes("completed"), KNOWN);
    check("所有 changed 阶段 ∈ KNOWN_PHASES", D.changes.every((c) => KNOWN.includes(c.stage)), [...new Set(D.changes.map((c) => c.stage))]);
    const lastGen = D.changes.filter((c) => c.runId === g.runId).pop();
    const lastAll = D.changes.filter((c) => c.runId === ea.runId).pop();
    check("生成终态 completed、label「框架 n/n 段」、published", lastGen.stage === "completed" && /^框架 (\d+)\/\1 段$/.test(lastGen.label) && lastGen.published, lastGen);
    check("深挖全部终态 completed、label「深挖 n/n 段」、budget=3", lastAll.stage === "completed" && /^深挖 (\d+)\/\1 段$/.test(lastAll.label) && lastAll.budget === 3, lastAll);
    // ⑩ 补：A 环境里交互深挖 / 预取 / explain 不进指示器
    const aRuns = new Set(A.changes.map((c) => c.runId));
    const aRunKinds = [...aRuns].map((id) => (A.store.getMaterialMapRun(id).input || {}).kind);
    check("A 环境：changed 的 run 均为 generate（交互深挖不进指示器）", aRunKinds.every((k) => k === "generate"), aRunKinds);
  }

  // ======================================================== explain / 原文 / 视图
  console.log("---- explain / graphNodeText / graphSetView ----");
  {
    const rows = nodesOf(A.store, mapA);
    const n = rows.find((r) => r.source === "ai" && r.state === "open");
    const before = A.log.calls.length;
    const d0 = A.deltas.length;
    const r1 = A.engine.graphExplain({ mapId: mapA, nodeId: n.nodeId });
    await settle(A.engine);
    const ds = A.deltas.slice(d0).filter((d) => d.kind === "explain");
    const streamed = ds.filter((d) => d.explainDelta).map((d) => d.explainDelta.text).join("");
    check("explain 一次调用、流式 explainDelta 拼成全文", r1.jobId && A.log.calls.length === before + 1 && streamed === "这一节先提出问题，再给出回答。", streamed);
    check("explain 落库并在 jobDone 节点里带回", nodesOf(A.store, mapA).find((r) => r.nodeId === n.nodeId).explain.text === streamed && ds.find((d) => d.jobDone).nodes[0].explain === streamed);
    const r2 = A.engine.graphExplain({ mapId: mapA, nodeId: n.nodeId });
    check("二次 explain → cached 零调用", r2.cached && r2.explain.text === streamed && A.log.calls.length === before + 1);
    const t = A.engine.graphNodeText({ mapId: mapA, nodeId: n.nodeId });
    check("graphNodeText 返回区间原文与单元锚点", typeof t.text === "string" && t.text.length > 50 && BOOK.units.includes(t.unitAnchor), t.unitAnchor);
    A.engine.graphSetView({ mapId: mapA, view: { patterns: { [n.nodeId]: "chain" }, collapsed: [n.nodeId], junk: 1 } });
    const v = A.engine.graphLoad(mapA).view;
    check("graphSetView 归一后读回", v && v.patterns[n.nodeId] === "chain" && J(v.collapsed) === J([n.nodeId]), v);
  }

  // ======================================================== graphFeed 守卫
  console.log("---- graphFeed：顺序 / 幂等 / 未送原文 ----");
  {
    const E = mkEnv();
    let code = null;
    try { E.engine.graphFeed({ documentId: "d2", tocItems: BOOK.tocItems, unitAnchors: BOOK.units, index: 1, text: "x" }); } catch (e) { code = e.code; }
    check("非 0 起送 → out_of_order", code === "out_of_order", code);
    E.engine.graphFeed({ documentId: "d2", tocItems: BOOK.tocItems, unitAnchors: BOOK.units, index: 0, text: BOOK.tb["u0.xhtml"] });
    const r = E.engine.graphFeed({ documentId: "d2", tocItems: BOOK.tocItems, unitAnchors: BOOK.units, index: 0, text: BOOK.tb["u0.xhtml"] });
    check("同 index 同文本重送幂等", r.blocksReady > 0);
    code = null;
    try { E.engine.graphFeed({ documentId: "d2", tocItems: BOOK.tocItems, unitAnchors: BOOK.units, index: 3, text: "x" }); } catch (e) { code = e.code; }
    check("跳号 → out_of_order", code === "out_of_order", code);
    code = null;
    try { E.engine.graphGenerate({ documentId: "nope" }); } catch (e) { code = e.code; }
    check("未送原文生成 → no_text", code === "no_text", code);
    // 部分原文即可开始生成：已定型作用域先排，余下随 graphFeed 放出
    const g = E.engine.graphGenerate({ documentId: "d2", title: "部分" });
    await settle(E.engine);
    const n1 = E.log.calls.length;
    check("仅第 0 单元已送入：只跑已放出的作用域", n1 === 1, n1);
    check("原文未送完时 run 不结束", !E.changes.some((c) => c.runId === g.runId && c.stage !== "running"));
    BOOK.units.forEach((u, i) => { if (i > 0) E.engine.graphFeed({ documentId: "d2", tocItems: BOOK.tocItems, unitAnchors: BOOK.units, index: i, text: BOOK.tb[u], last: i === BOOK.units.length - 1 }); });
    await settle(E.engine);
    const last = E.changes.filter((c) => c.runId === g.runId).pop();
    check("送完后其余作用域跑完、run completed", last && last.stage === "completed" && E.log.calls.length === est.scopes, { last, calls: E.log.calls.length });
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
