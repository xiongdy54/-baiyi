// @runtime: node
// 结构画布 · 宿主几何 API 回归（v49.29 / D203 · T2；node 直跑）。
// 覆盖：MindmapCanvasV2 的 getBounds / getNodeRect / setViewScale / autoFit / autoFit=false / onLayout；
//       并锁定「完整图谱页签默认自动适配行为不变」（autoFit 缺省＝true）。
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
const graph = createGraph({
  meta: { schemaVersion: 2, mapId: "m-api", documentId: "d-api", title: "API 测试" },
  nodes: [
    node("t1", null, 1000, "根节点", "open"),
    node("t1.1", "t1", 1100, "第一个子节点", "floor"),
    node("t1.2", "t1", 1200, "第二个子节点", "floor"),
    node("t1.3", "t1", 1300, "第三个子节点", "floor"),
  ],
  edges: [],
  view: null,
}, "m-api");

function mountCanvas(autoFit) {
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const box = { ref: null, layout: null, transforms: [] };
  function H() {
    const ref = React.useRef(null);
    React.useEffect(() => { box.ref = ref; }, []);
    return React.createElement(Canvas, {
      ref, graph, rootTitle: "API 测试", selectedId: null, anchorId: ROOT_ID,
      relAll: false, focus: false,
      onSelect() {}, onDeepen() {}, onToggleCollapse() {},
      autoFit, onLayout: (b) => { box.layout = b; },
    });
  }
  const r = createRoot(host);
  r.render(React.createElement(React.StrictMode, null, React.createElement(H)));
  return { host, box, root: r };
}
const transform = (host) => {
  const g = host.querySelector("svg.mm2-svg > g");
  return g ? g.getAttribute("transform") : null;
};
const scaleOf = (tr) => {
  const m = /scale\(([\d.]+)\)/.exec(tr || "");
  return m ? Number(m[1]) : null;
};
const translateOf = (tr) => {
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(tr || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
};

(async () => {
  console.log("---- 缺省 autoFit=true：完整图谱页签行为不变 ----");
  const a = mountCanvas(undefined);
  const h = () => a.box.ref && a.box.ref.current;
  check("布局就位后 onLayout 回调（bounds > 0）", await until(() => a.box.layout && a.box.layout.w > 0 && a.box.layout.h > 0), a.box.layout);
  const bounds = await until(() => h() && h().getBounds());
  check("getBounds = 布局内容边界", !!bounds && bounds.w === a.box.layout.w && bounds.h === a.box.layout.h, { bounds, layout: a.box.layout });
  const rr = await until(() => h() && h().getNodeRect(ROOT_ID));
  check("getNodeRect(根)：内容坐标矩形在 bounds 内", !!rr && rr.w > 0 && rr.h > 0 && rr.x >= 0 && rr.y >= 0 && rr.x + rr.w <= bounds.w + 0.5 && rr.y + rr.h <= bounds.h + 0.5, { rr, bounds });
  check("getNodeRect(子节点) 非空；未知 id → null", !!h().getNodeRect("t1.2") && h().getNodeRect("no-such") === null);
  const fitted = await until(() => transform(a.host));
  const fitK = scaleOf(fitted), fitT = translateOf(fitted);
  check("缺省仍自行适配（48px 内边距口径：k=1 / 顶部 24px）", fitK === 1 && fitT && fitT[1] === 24, { fitted, fitK, fitT });
  const b0 = h().getBounds();
  h().setViewScale(0.5);
  const scaled = await until(() => transform(a.host) === "translate(0,0) scale(0.5)");
  check("setViewScale(0.5)：内容原点贴容器左上（translate(0,0) scale(0.5)）", scaled, transform(a.host));
  const b1 = h().getBounds();
  check("改比例不改内容边界（选中 / 缩放不得触发窗口 resize）", b0.w === b1.w && b0.h === b1.h, { b0, b1 });
  await sleep(100);
  check("setViewScale 后不会被过渡帧回冲（仍是 0.5）", scaleOf(transform(a.host)) === 0.5, transform(a.host));
  h().autoFit();
  const refit = await until(() => scaleOf(transform(a.host)) === 1 && translateOf(transform(a.host))?.[1] === 24);
  check("autoFit() 显式恢复画布自行适配", refit, transform(a.host));
  a.root.unmount();

  console.log("---- autoFit=false：宿主决定比例 ----");
  const b = mountCanvas(false);
  const hb = () => b.box.ref && b.box.ref.current;
  await until(() => hb() && hb().getBounds());
  const raw = await until(() => transform(b.host));
  check("autoFit=false：首帧不抢 fit（translate(0,0) scale(1)）", raw === "translate(0,0) scale(1)", raw);
  hb().setViewScale(0.639);
  check("宿主设比例 0.639", await until(() => transform(b.host) === "translate(0,0) scale(0.639)"), transform(b.host));
  const rb = hb().getNodeRect("t1.1");
  check("autoFit=false 下 getNodeRect 仍可用（供锚点换算）", !!rb && rb.w > 0 && rb.h > 0, rb);
  b.root.unmount();

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
