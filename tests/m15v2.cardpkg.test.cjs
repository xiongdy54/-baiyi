// @runtime: node
// 材料导图 v2 · T8 渲染层纯逻辑回归（node tests/m15v2.cardpkg.test.cjs；TS 经 tests/lib/tsload.cjs 转译，不依赖 esbuild）。
// 依据 MINDMAP-V2-IMPL-PLAN §6 T8 验收：② v2 结构语义包 ≤1200、字段齐、无超长原文；③ MindmapTab 不再调用 v1 生成链路；
// ④ 读数条字段与 RunMetrics 一一对应。另：材料根抬升、delta.removed 合入、目录骨架预览。
const path = require("path");
const fs = require("fs");
require("./lib/tsload.cjs");
const root = path.join(__dirname, "..");
const M = require(path.join(root, "src", "lib", "mindmapV2.ts"));
const G = require(path.join(root, "src", "lib", "mindmap", "v2", "graph.ts"));
const { ROOT_ID } = require(path.join(root, "src", "lib", "mindmap", "v2", "types.ts"));
const { createMindmapEngineV2 } = require(path.join(root, "electron", "mindmapEngineV2.js"));
const { createMemoryStore } = require(path.join(root, "tests", "lib", "mindmapMemoryStore.cjs"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 500)}`); }
}
const J = (x) => JSON.stringify(x);
const node = (id, parentId, ord, title, type, extra) => Object.assign({
  id, parentId, ord, title, type, timeText: null, patternHint: null, blockStart: 1, blockEnd: 4, spans: null,
  state: "open", source: "ai", warnings: null, explain: null, jobId: null,
}, extra || {});

// ---------------------------------------------------------------- 材料根抬升
console.log("---- 材料根抬升 / 目录预览 ----");
const rawNodes = [
  node("t0", null, 0, "测试材料", "其他", { source: "toc" }),
  node("t1", "t0", 1000, "第一章", "其他", { source: "toc" }),
  node("t1.1", "t1", 1000, "核心论点", "论点"),
  node("t1.2", "t1", 3000, "支持理由", "理由"),
  node("t2", "t0", 5000, "第二章", "其他", { source: "toc", state: "more" }),
];
const load = { meta: { title: "测试材料", mapId: "m1", schemaVersion: 2 }, nodes: rawNodes, edges: [{ from: "t1.2", to: "t1.1", code: "支" }, { from: "t1", to: "t0", code: "答" }], view: null, textReady: true };
const lifted = M.liftLoad(load);
check("findRootId = 唯一 parentId=null 行", lifted.rootId === "t0" && lifted.rootNode.title === "测试材料");
check("根行移除、其子挂顶层（parentId=null）", !lifted.load.nodes.some((n) => n.id === "t0") && lifted.load.nodes.filter((n) => n.parentId == null).map((n) => n.id).join() === "t1,t2");
check("与根相连的关系被略去", lifted.load.edges.length === 1 && lifted.load.edges[0].from === "t1.2");
check("无图 → null", M.liftLoad({ meta: null, nodes: [], edges: [], view: null, textReady: false }) === null);
const ld = M.liftDelta({ mapId: "m1", kind: "skeleton", nodes: [rawNodes[0], rawNodes[1]], states: [{ id: "t0", state: "open" }, { id: "t1", state: "open" }], removed: ["t0", "x"] }, "t0");
check("liftDelta：节点/状态/删除列表都去根", J(ld.nodes.map((n) => [n.id, n.parentId])) === J([["t1", null]]) && J(ld.states) === J([{ id: "t1", state: "open" }]) && J(ld.removed) === J(["x"]));
const pv = M.tocPreviewNodes([{ anchor: "a", label: "甲", children: [{ anchor: "b", label: "乙" }] }, { anchor: "c", label: "  " }]);
check("目录预览：先序、父子、空标题兜底、state=more/source=toc", J(pv.map((n) => [n.id, n.parentId, n.title, n.state, n.source])) === J([["p0", null, "甲", "more", "toc"], ["p1", "p0", "乙", "more", "toc"], ["p2", null, "—", "more", "toc"]]));

// ---------------------------------------------------------------- delta.removed
console.log("---- applyDelta：removed ----");
{
  let g = G.createGraph(lifted.load, "m1");
  g = G.applyDelta(g, { mapId: "m1", kind: "expand", nodes: [node("t1.1.1", "t1.1", 1000, "孙一", "证据"), node("t1.1.2", "t1.1", 2000, "孙二", "证据")], edges: [{ from: "t1.1.2", to: "t1.1.1", code: "据" }, { from: "t1.2", to: "t1.1.2", code: "支" }] });
  const e0 = g.edgeCount;
  const g2 = G.applyDelta(g, { mapId: "m1", kind: "expand", removed: ["t1.1.2"] });
  check("节点删除、父子列表更新", !g2.nodes["t1.1.2"] && J(g2.children["t1.1"]) === J(["t1.1.1"]));
  check("相连关系两向删除、edgeCount 递减", g2.edgeCount === e0 - 2 && !(g2.outEdges["t1.2"] || []).some((e) => e.to === "t1.1.2") && !(g2.inEdges["t1.1.1"] || []).length, { e0, e: g2.edgeCount });
  check("原状态不可变（结构共享不污染旧状态）", !!g.nodes["t1.1.2"] && g.edgeCount === e0);
  check("祖先 rev 被打新", g2.rev["t1.1"] > g.rev["t1.1"] && g2.rev["t1"] > g.rev["t1"]);
  const g3 = G.applyDelta(g, { mapId: "m1", kind: "expand", removed: ["t1.1.2"], nodes: [node("t1.1.2", "t1.1", 2000, "孙二新", "证据")] });
  check("同批既删又发 → 以合入为准", g3.nodes["t1.1.2"] && g3.nodes["t1.1.2"].title === "孙二新");
  check("删除未知 id 无副作用（返回原状态）", G.applyDelta(g, { mapId: "m1", kind: "x", removed: ["nope"] }) === g);
}

// ---------------------------------------------------------------- ② 结构语义包
console.log("---- ② buildStructureCardPackageV2 ----");
{
  const g = G.createGraph(lifted.load, "m1");
  const long = "知识是经过检验的信念。".repeat(500);
  const nodeText = ["第一段" + long, "第二段很短。", "第三段" + long, "第四段不该出现"].join("\n");
  const n = g.nodes["t1.1"];
  const pkg = M.buildStructureCardPackageV2(n, { ...g, explain: { "t1.1": "作者先立论，再给出两条理由。" } }, { mapId: "m1", nodeText, unitAnchors: ["u1.xhtml"] });
  check("返回 text / mindmapNodeId / unitAnchors / authorialRole", typeof pkg.text === "string" && pkg.mindmapNodeId === "v2:m1:t1.1" && J(pkg.unitAnchors) === J(["u1.xhtml"]) && pkg.authorialRole === "claim_evidence", pkg);
  check("总长 ≤1200", pkg.text.length <= 1200, pkg.text.length);
  check("与 v1 同形：【结构语义包】 + JSON", pkg.text.startsWith("【结构语义包】\n"));
  const obj = JSON.parse(pkg.text.slice("【结构语义包】\n".length));
  check("字段齐：本节点/父链/直接子结构/证据引文/材料级结构摘要", ["本节点", "父链", "直接子结构", "证据引文", "材料级结构摘要"].every((k) => k in obj), Object.keys(obj));
  check("本节点含 title/type/authorialRole/作者动作/mindmapNodeId/unitAnchors", obj.本节点.title === "核心论点" && obj.本节点.type === "论点" && obj.本节点.作者动作 === "作者先立论，再给出两条理由。" && obj.本节点.mindmapNodeId === "v2:m1:t1.1");
  check("父链（根已抬升 → 只含第一章）", J(obj.父链.map((x) => x.title)) === J(["第一章"]), obj.父链);
  check("证据 ≤3 段、每段 ≤60 字", obj.证据引文.length >= 1 && obj.证据引文.length <= 3 && obj.证据引文.every((s) => [...s].length <= 60), obj.证据引文);
  check("无超长原文（不含原文任意 61 字片段）", !pkg.text.includes(long.slice(0, 61)));
  // 极端：超长 explain / 大量子节点 / 长父链 → 仍 ≤1200 且是合法 JSON 或截断
  const many = [];
  for (let i = 0; i < 60; i++) many.push(node(`t1.1.${i + 1}`, "t1.1", 1000 + i, `子节点标题很长很长很长很长${i}`, "证据"));
  let g2 = G.applyDelta(g, { mapId: "m1", kind: "expand", nodes: many });
  g2 = { ...g2, explain: { "t1.1": "讲解".repeat(2000) } };
  const pk2 = M.buildStructureCardPackageV2(g2.nodes["t1.1"], g2, { mapId: "m1", nodeText });
  check("极端输入仍 ≤1200", pk2.text.length <= 1200, pk2.text.length);
  check("stub（source=local）不进直接子结构", (() => {
    const g3 = G.applyDelta(g, { mapId: "m1", kind: "expand", nodes: [node("t1.1.s", "t1.1", 9000, "其余 3 段", "其他", { source: "local", state: "stub" })] });
    return !M.buildStructureCardPackageV2(g3.nodes["t1.1"], g3, {}).text.includes("其余 3 段");
  })());
  check("typeToV1Role：其他→null、未知→null", M.typeToV1Role("其他") === null && M.typeToV1Role("???") === null && M.typeToV1Role("步骤") === "sequence");
  // 与主进程表同步
  const V = require(path.join(root, "electron", "mindmapV2Core.js"));
  check("TYPE_TO_V1_ROLE 与 electron/mindmapV2Core.js 同表", J(Object.entries(M.TYPE_TO_V1_ROLE).sort()) === J(Object.entries(V.TYPE_TO_V1_ROLE).sort()));
}

// ---------------------------------------------------------------- ③ MindmapTab 不再走 v1 生成链路
console.log("---- ③ MindmapTab 不再引用 v1 生成 / 深化 / 修复 / 预览 ----");
{
  const src = fs.readFileSync(path.join(root, "src", "components", "reader", "MindmapTab.tsx"), "utf8");
  const banned = ["mindmapApi.generate", "mindmapApi.deepen", "mindmapApi.repairConfirm", "mindmapApi.preview", "buildMapSvg", "layoutMap", "dangerouslySetInnerHTML"];
  const hit = banned.filter((b) => src.includes(b));
  check("无 v1 生成/深化/修复/预览/旧渲染调用", !hit.length, hit);
  check("使用 v2 客户端（load/feed/estimate/generate/expand/expandAll/explain/cancel/resume/setView/metrics）",
    ["mindmapV2Api.load", "mindmapV2Api.feed", "mindmapV2Api.estimate", "mindmapV2Api.generate", "mindmapV2Api.expand(", "mindmapV2Api.expandAll", "mindmapV2Api.explain", "mindmapV2Api.cancel", "mindmapV2Api.resume", "mindmapV2Api.setView", "mindmapV2Api.metrics"].every((k) => src.includes(k)));
  check("订阅 EventBus mindmap/delta 与 mindmap/changed", src.includes('"mindmap/delta"') && src.includes('"mindmap/changed"'));
  check("宿主契约 Props 未变（kernel/documentId/title/canvasHost/onJumpToText/onMakeCardsFromNode/initialMapId/initialResumeRunId）",
    ["kernel:", "documentId:", "title:", "canvasHost:", "onJumpToText:", "onMakeCardsFromNode?:", "initialMapId?:", "initialResumeRunId?:"].every((k) => src.includes(k)));
  const canvas = fs.readFileSync(path.join(root, "src", "components", "reader", "mindmap", "MindmapCanvasV2.tsx"), "utf8");
  check("画布：交互帧 buildCanvasSvg 不过 DOMPurify，仅导出过（X5）", /exportSvg\(\)[\s\S]*DOMPurify\.sanitize/.test(canvas) && (canvas.match(/DOMPurify\.sanitize/g) || []).length === 1);
}

// ---------------------------------------------------------------- ④ 读数条 ↔ RunMetrics
console.log("---- ④ 读数条字段与 RunMetrics 一一对应 ----");
{
  const engine = createMindmapEngineV2({ store: createMemoryStore(), chatStream: async () => ({}) });
  const snap = engine.graphMetrics({ mapId: "none" });
  const engineKeys = Object.keys(snap).sort();
  const typesSrc = fs.readFileSync(path.join(root, "src", "lib", "mindmap", "v2", "types.ts"), "utf8");
  const body = /export interface RunMetrics \{([\s\S]*?)\n\}/.exec(typesSrc)[1];
  const typeKeys = [...body.matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map((m) => m[1]).sort();
  check("types.ts RunMetrics 键 ≡ 引擎 RunMetrics 键", J(typeKeys) === J(engineKeys), { typeKeys, engineKeys });
  check("METRICS_FIELDS ≡ RunMetrics 键（无多无少）", J([...M.METRICS_FIELDS].sort()) === J(engineKeys));
  const T = (k, p) => (p ? k.replace(/\{(\w+)\}/g, (_, x) => String(p[x])) : k);
  const m = Object.assign({}, snap, { model: "deepseek-ai/DeepSeek-V4.1-Flash", ttfnMs: 820, firstTtftMs: 640, frameworkMs: 12400, calls: 12, cacheHits: 3, promptTokens: 30000, completionTokens: 4200, reasoningChars: 0, lines: 200, linesDropped: 5, byReason: { duplicate: 2, truncated: 3 }, relsDropped: 4, concurrencyNow: 2, rateLimitDowngrades: 1, startedAt: Date.UTC(2026, 9, 18) });
  const segs = M.metricsSegments(m, T);
  const shown = new Set(segs.flatMap((s) => s.fields));
  check("读数条覆盖除 startedAt 外全部字段", engineKeys.filter((k) => k !== "startedAt").every((k) => shown.has(k)), engineKeys.filter((k) => !shown.has(k)));
  const line = segs.map((s) => s.text).join(" · ");
  check("读数条文本：模型 · 首节点 0.8s · 框架完成 12.4s · 调用 12（缓存 3）· token · 思考 · 丢弃（按原因）· 关系丢弃 · 并发（降档）",
    line.startsWith("deepseek-ai/DeepSeek-V4.1-Flash · 首节点 0.8s · 首字 0.6s · 框架完成 12.4s · 调用 12（缓存 3） · token 入 30000 / 出 4200 · 思考 0 字 · 丢弃行 5/200（重复 2 / 截断 3） · 关系丢弃 4 · 并发 2（降档 1）"), line);
  const copy = M.metricsCopyText(m, T);
  check("复制读数：多行、含开始时间 ISO", copy.split("\n").length === segs.length + 2 && copy.includes("2026-10-18T00:00:00.000Z"), copy);
  check("缺值显示 —", M.metricsSegments(Object.assign({}, m, { ttfnMs: null }), T)[1].text === "首节点 —");
}

// ---------------------------------------------------------------- ⑤ 画布管线冒烟（MindmapCanvasV2 每帧做的事，纯函数部分）
console.log("---- ⑤ 画布管线冒烟：抬根后的引擎形态 → layout → route → svg → transition ----");
{
  const L = require(path.join(root, "src", "lib", "mindmap", "v2", "layout.ts"));
  const R = require(path.join(root, "src", "lib", "mindmap", "v2", "route.ts"));
  const S = require(path.join(root, "src", "lib", "mindmap", "v2", "svg.ts"));
  const A = require(path.join(root, "src", "lib", "mindmap", "v2", "animate.ts"));
  const rows = [
    node("t0", null, 0, "测试材料", "其他", { source: "toc", blockStart: null, blockEnd: null }),
    node("t1", "t0", 1000, "第一章 <script>", "其他", { source: "toc" }),
    node("t1.1", "t1", 1000, "论点 & \"引号\"", "论点", { state: "more" }),
    node("t1.2", "t1", 2000, "理由", "理由", { state: "floor" }),
    node("t1.s", "t1", 3000, "其余 2 段", "其他", { source: "local", state: "stub" }),
    node("t2", "t0", 4000, "第二章", "其他", { source: "toc", state: "more", blockStart: null, blockEnd: null }),
    node("t3", "t0", 5000, "第三章", "其他", { source: "toc", state: "floor" }),
  ];
  const lf = M.liftLoad({ meta: { title: "测试材料", mapId: "m9", schemaVersion: 2 }, nodes: rows, edges: [{ from: "t1.2", to: "t1.1", code: "支" }, { from: "t3", to: "t1.1", code: "驳" }], view: null, textReady: true });
  let g = G.createGraph(lf.load, "m9");
  const cache = L.createLayoutCache();
  let locks = {};
  let ok = true, err = null, svg = "";
  let prev = null;
  try {
    for (let step = 0; step < 4; step++) {
      if (step === 1) g = G.applyDelta(g, { mapId: "m9", kind: "outline", states: [{ id: "t2", state: "streaming" }], nodes: [node("t2.1", "t2", 4000, "流式子一", "背景")] });
      if (step === 2) g = G.applyDelta(g, { mapId: "m9", kind: "outline", states: [{ id: "t2", state: "open" }], nodes: [node("t2.2", "t2", 4100, "流式子二", "问题")], edges: [{ from: "t2.2", to: "t1.1", code: "答" }] });
      if (step === 3) g = G.setCollapsed(g, "t1", true);
      let d = L.layoutGraph(g, { cache, locks, rootTitle: "测试材料" });
      if (d.locks) locks = d.locks;
      d = A.monotoneFrames(d, {}, A.growthScope(g)).display;
      const tr = A.planTransition(prev, d, { view: { tx: 0, ty: 0, k: 1 }, anchorId: ROOT_ID, reducedMotion: false });
      for (const t of [0, 80, 160, 400]) {
        const f = A.transitionFrame(tr, t);
        const lod = A.lodFrames(f.display, 0.4);
        const routed = R.routeRelations(g, f.display, { relAll: true, zoom: 0.4, lodCollapsed: lod, selected: "t1.1", focus: true });
        svg = S.buildCanvasSvg(f.display, routed, { view: f.view, opacity: f.opacity, leaving: f.leaving, lodCollapsed: lod, selected: "t1.1" }, { fragment: true, graph: g, rootTitle: "测试材料" });
      }
      prev = d;
    }
  } catch (e) { ok = false; err = String(e && e.stack || e).slice(0, 400); }
  check("四步（流式 / 落定 / 新关系 / 折叠）× 每步 4 帧 无异常", ok, err);
  check("帧内无原样标签、标题已转义", !/<script>/.test(svg) && svg.includes("&lt;script&gt;"), svg.slice(0, 200));
  check("合成根卡出现一次（材料名不重复成两层）", (svg.match(/测试材料/g) || []).length === 1, (svg.match(/测试材料/g) || []).length);
  const d0 = L.layoutGraph(G.createGraph(lf.load, "m9"), { rootTitle: "测试材料" });
  const html = S.buildCanvasSvg(d0, R.routeRelations(G.createGraph(lf.load, "m9"), d0, {}), {}, { fragment: true, graph: G.createGraph(lf.load, "m9"), rootTitle: "测试材料" });
  check("交互钩子：data-node-id / data-act=deepen（more 与 stub 节点）", html.includes('data-node-id="t1.1"') && /data-act="deepen" data-node-id="t1\.1"/.test(html) && /data-act="deepen" data-node-id="t1\.s"/.test(html));
  check("floor 节点无深挖钩子", !/data-act="deepen" data-node-id="t1\.2"/.test(html) && !/data-act="deepen" data-node-id="t3"/.test(html));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
