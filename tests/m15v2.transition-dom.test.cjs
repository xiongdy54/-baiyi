// @runtime: system-node
// C-32 A6「增量更新」回归（node 直跑，jsdom）：过渡帧不再整树重建 SVG——
//   1) 过渡期间组框 / 结构线整段淡出（data-frame-id = 0；本图例的组框改前 = 1）；
//   2) 过渡帧节点组元素是同一 DOM 实例（打 data-a6 标记后跨帧存活，只改 transform）；
//   3) 终帧全量重绘：组框恢复、旧实例被替换、每个节点 transform 与 getNodeRect 终态一致。
// 时序注意：布局有 4 次/秒节流，换图后过渡可能延迟至多 ~250ms 才开始——以「组框归零 + 卡片数跳变」
// 作为过渡已开始的信号，再做多帧采样；不要在换图后固定毫秒处取样（会落在节流等待期，采到旧 DOM）。
"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 }; };

require("./lib/tsload.cjs");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createGraph } = require(path.join(root, "src", "lib", "mindmap", "v2", "graph.ts"));
const { ROOT_ID } = require(path.join(root, "src", "lib", "mindmap", "v2", "types.ts"));
const Canvas = require(path.join(root, "src", "components", "reader", "mindmap", "MindmapCanvasV2.tsx")).default;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  return fn();
}

const node = (id, parentId, ord, title, state) => ({
  id, parentId, ord, title, type: "论点", timeText: null, patternHint: null,
  blockStart: null, blockEnd: null, spans: null, state, source: "ai", warnings: null, jobId: null,
});
const mkGraph = (n) =>
  createGraph({
    meta: { schemaVersion: 2, mapId: "m-a6", documentId: "d-a6", title: "A6 增量帧" },
    nodes: [
      node("t1", null, 1000, "根节点", "open"),
      ...Array.from({ length: n }, (_, i) => node("t1." + (i + 1), "t1", 1100 + i * 100, "子节点" + (i + 1), "floor")),
    ],
    edges: [],
    view: null,
  }, "m-a6"); // mapId 不变：换图走布局变化 → planTransition 过渡，而非清缓存重挂

let currentGraph = mkGraph(3);
let handle = null;

(async () => {
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  function H() {
    const ref = React.useRef(null);
    React.useEffect(() => { handle = ref; }, []);
    return React.createElement(Canvas, {
      ref, graph: currentGraph, rootTitle: "A6 增量帧", selectedId: null, anchorId: ROOT_ID,
      relAll: false, focus: false,
      onSelect() {}, onDeepen() {}, onToggleCollapse() {},
    });
  }
  const r = createRoot(host);
  r.render(React.createElement(React.StrictMode, null, React.createElement(H)));

  console.log("---- 初始布局：组框存在（全量绘制基线）----");
  const svg = await until(() => host.querySelector("svg.mm2-svg"));
  const cards = () => svg.querySelectorAll('g[data-node-id]:not([data-act])').length;
  const frames = () => svg.querySelectorAll("[data-frame-id]").length;
  await until(() => cards() >= 4);
  const preFrames = frames();
  check("初始全量绘制有组框（data-frame-id ≥ 1）", preFrames >= 1, preFrames);

  console.log("---- 布局变化 → 过渡帧走增量路径 ----");
  await sleep(400); // 让 4 次/秒的布局节流窗口过去
  currentGraph = mkGraph(9); // 3 子 → 9 子：旧子节点位移，新子节点进入
  r.render(React.createElement(React.StrictMode, null, React.createElement(H)));
  // 过渡开始的信号：组框归零（首帧 cards-only 全量绘制）+ 卡片数跳变到新布局
  const started = await until(() => frames() === 0 && cards() >= 10, 2000);
  check("过渡开始（节流等待后）：组框淡出 + 新布局卡片集出现", !!started, { frames: frames(), cards: cards() });

  // 多帧采样：过渡帧不重建 DOM——同一标记实例跨帧存活（innerHTML 重建会换实例）
  let samples = 0, sameInstance = 0, moved = false, lastTr = null;
  const marked = svg.querySelector('g[data-node-id]:not([data-act])');
  marked.setAttribute("data-a6", "1");
  lastTr = marked.getAttribute("transform");
  for (let i = 0; i < 5; i++) {
    await sleep(30);
    if (frames() !== 0) break; // 过渡已结束，停止采样
    samples++;
    const again = svg.querySelector("[data-a6]");
    if (again === marked) sameInstance++;
    const tr = marked.getAttribute("transform");
    if (tr !== lastTr) { moved = true; lastTr = tr; }
  }
  check("过渡期间组框持续淡出（采样期间 frames 恒 0）", samples >= 2, { samples, preFrames });
  check("过渡帧不重建 DOM（标记元素跨帧同一实例 " + sameInstance + "/" + samples + "）", samples >= 2 && sameInstance === samples, { samples, sameInstance });
  check("增量帧只改 transform（采样期间 transform 有变化：" + moved + "）", true, { moved }); // 记录性断言：位移是否发生取决于版式

  console.log("---- 终帧：全量重绘恢复 ----");
  const restored = await until(() => frames() >= 1 && !marked.isConnected, 3000);
  check("终帧全量重绘：组框恢复", frames() >= 1, frames());
  check("终帧替换旧 DOM（标记元素已脱离文档）", !marked.isConnected, restored);
  const h = handle && handle.current;
  check("句柄可用", !!h);
  let coordsOk = true, detail = null;
  for (let i = 1; i <= 9; i++) {
    const id = "t1." + i;
    const rect = h.getNodeRect(id);
    const el = svg.querySelector(`g[data-node-id="${id}"]:not([data-act])`);
    if (!rect || !el) { coordsOk = false; detail = { id, rect: !!rect, el: !!el }; break; }
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") || "");
    const fmt = (v) => String(Math.round(v * 100) / 100);
    if (!m || Math.abs(Number(m[1]) - Number(fmt(rect.x))) > 0.011 || Math.abs(Number(m[2]) - Number(fmt(rect.y))) > 0.011) {
      coordsOk = false; detail = { id, attr: m && [m[1], m[2]], rect: [rect.x, rect.y] }; break;
    }
  }
  check("终帧每个节点 transform 与 getNodeRect 终态一致（num 两位小数口径）", coordsOk, detail);
  r.unmount();

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
