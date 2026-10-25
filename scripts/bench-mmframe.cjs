// C-32 A6 基准：结构画布过渡帧的两种绘制路径对比（只读，不碰真实数据目录）。
//   (a) 全量重建：每帧 buildCanvasSvg（拼整张 SVG 串）+ svg.innerHTML（整棵 DOM 重建）——A6 增量更新前的做法
//       （A6 主步骤已把过渡期关系路由换为空结果，这里同样喂空路由，两组只差「整树重建 vs 设属性」）。
//   (b) 增量更新：过渡首帧全量绘制一次（仅卡片、edges:[]），后续帧只对 g[data-node-id]:not([data-act])
//       设 transform / opacity + 视口 transform——当前实现。
// 用法：node scripts/bench-mmframe.cjs [N1 N2 ...]（缺省 100 400 1000）。运行时：系统 Node + jsdom。
"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "HTMLElement", "Element", "getComputedStyle", "requestAnimationFrame"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}
require(path.join(root, "tests", "lib", "tsload.cjs"));
const { createGraph } = require(path.join(root, "src", "lib", "mindmap", "v2", "graph.ts"));
const { createLayoutCache, layoutGraph } = require(path.join(root, "src", "lib", "mindmap", "v2", "layout.ts"));
const { planTransition, transitionFrame } = require(path.join(root, "src", "lib", "mindmap", "v2", "animate.ts"));
const { buildCanvasSvg } = require(path.join(root, "src", "lib", "mindmap", "v2", "svg.ts"));

const EMPTY_ROUTE = {
  edges: [], byId: {}, crossCount: {}, focus: null,
  policy: { relAll: false, hovered: null, selected: null, focus: false, zoom: 1 },
  stats: { intra: 0, cross: 0, crossRaw: 0, routed: 0, direct: 0, channel: 0, search: 0, blocked: 0 },
};

const node = (id, parentId, ord) => ({ id, parentId, ord, title: "节点" + id, type: "论点", timeText: null, patternHint: null, blockStart: null, blockEnd: null, spans: null, state: "floor", source: "ai", warnings: null, jobId: null });
const graphWith = (n) => createGraph({
  meta: { schemaVersion: 2, mapId: "bench-a6", documentId: "d-bench", title: "bench" },
  nodes: [{ ...node("t1", null, 0), state: "open" }, ...Array.from({ length: n }, (_, i) => node("t1." + (i + 1), "t1", 100 + i))],
  edges: [], view: null,
}, "bench-a6");
const layoutOf = (g) => layoutGraph(g, { cache: createLayoutCache(), lodExpanded: new Set(), noLod: true, frameLabel: () => "tree · 列" }); // noLod＝结构图纸片「展开全部」口径：宽树不被 LOD 折叠，才能测到目标卡片规模

const svg = w.document.createElementNS("http://www.w3.org/2000/svg", "svg");
w.document.body.appendChild(svg);

const frameState = (f) => ({ view: { tx: 0, ty: 0, k: 1 }, selected: null, hovered: null, opacity: f.opacity, leaving: f.leaving, lodCollapsed: [] });
const opts = { fragment: true, graph: graphWith(3), rootTitle: "bench", labels: {}, idPrefix: "b-" };
const num = (v) => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

function bench(n) {
  const d1 = layoutOf(graphWith(Math.max(1, Math.floor(n / 2))));
  const d2 = layoutOf(graphWith(n));
  const tr = planTransition(d1, d2, { view: { tx: 24, ty: 24, k: 1 } });
  const frames = [];
  for (let t = 0; t < 260; t += 16) frames.push(transitionFrame(tr, t));
  const cards2 = d2.items.filter((it) => it.kind !== "frame");

  // (a) 全量重建（改前做法；过渡期空路由 + 每帧整树 innerHTML）
  const full = () => {
    for (const f of frames) {
      const inner = buildCanvasSvg(f.display, EMPTY_ROUTE, frameState(f), opts);
      svg.innerHTML = `<g class="mm2-viewport" transform="translate(0,0) scale(1)">${inner}</g>`;
    }
  };
  // (b) 增量更新（当前实现：首帧全量（仅卡片、无结构线）一次，后续帧只设属性）
  const buildIndex = () => {
    const f0 = frames[0];
    const draw = { ...f0.display, items: f0.display.items.filter((it) => it.kind !== "frame"), edges: [] };
    svg.innerHTML = `<g class="mm2-viewport" transform="translate(0,0) scale(1)">${buildCanvasSvg(draw, EMPTY_ROUTE, frameState(f0), opts)}</g>`;
    const nodes = new Map();
    for (const el of svg.querySelectorAll("g[data-node-id]:not([data-act])")) nodes.set(el.getAttribute("data-node-id"), el);
    return { nodes, viewport: svg.firstElementChild };
  };
  const incr = () => {
    const idx = buildIndex(); // 首帧全量一次（计入，即改后每过渡多出的一次全量）
    for (const f of frames) {
      idx.viewport.setAttribute("transform", "translate(0,0) scale(1)");
      for (const it of f.display.items) {
        const el = idx.nodes.get(it.id);
        if (!el) continue;
        el.setAttribute("transform", `translate(${num(it.x)},${num(it.y)})`);
        const o = f.opacity[it.id] ?? 1;
        if (o < 1) el.setAttribute("opacity", num(Math.max(0, o)));
        else el.removeAttribute("opacity");
      }
    }
  };

  full(); incr(); // 预热（JIT / 缓存）
  const time = (fn, reps) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const reps = 5;
  const a = time(full, reps) / reps / frames.length;
  const b = time(incr, reps) / reps / frames.length;
  return { n, cards: cards2.length, frames: frames.length, fullMsPerFrame: +a.toFixed(3), incrMsPerFrame: +b.toFixed(3), speedup: +(a / b).toFixed(1) };
}

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite);
console.log("C-32 A6 过渡帧基准（jsdom；每帧均值 = 一次完整过渡 ÷ 帧数；含增量路径首帧的一次全量）");
for (const n of sizes.length ? sizes : [100, 400, 1000]) {
  const r = bench(n);
  console.log(`  N=${String(r.n).padStart(5)}（卡片 ${r.cards}，${r.frames} 帧）  全量重建 ${r.fullMsPerFrame} ms/帧  →  增量 ${r.incrMsPerFrame} ms/帧  （${r.speedup}×）`);
}
