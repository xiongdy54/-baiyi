// @runtime: system-node
// 结构图谱动效 Token 读取（审计 C-32 A4；node 直跑：node tests/m15v2.motion.test.cjs）。
// 覆盖：①无 DOM（node 环境）回落 MOTION 常量 ②:root 上的 --mm-move/--mm-enter/--mm-exit 被
// readMotion 读到（皮肤/主题覆盖生效面）③planTransition 把 Token 档带进 Transition（duration 取三者最大，
// transitionFrame 按档推进）④非法值 / 0 / 负数回落常量。
"use strict";
const path = require("path");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "getComputedStyle"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}

require("./lib/tsload.cjs");
const A = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "animate.ts"));
const R = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "route.ts"));
const S = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "svg.ts"));
const G = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "graph.ts"));
const L = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "layout.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}

console.log("---- ① 常量回落 ----");
{
  // 本文件顶部已注入 document——先验证 Token 未设置时回落常量（数值相同即可视作回落）
  const m = A.readMotion();
  check("Token 未设置时回落 MOTION 常量", m.move === A.MOTION.move && m.enter === A.MOTION.enter && m.exit === A.MOTION.exit, m);
}

console.log("---- ② :root Token 被读取 ----");
{
  w.document.documentElement.style.setProperty("--mm-move", "120ms");
  const m = A.readMotion();
  check("--mm-move: 120ms 被读到", m.move === 120 && m.enter === A.MOTION.enter && m.exit === A.MOTION.exit, m);
  w.document.documentElement.style.setProperty("--mm-enter", "100ms");
  w.document.documentElement.style.setProperty("--mm-exit", "60ms");
  const m2 = A.readMotion();
  check("三档全部读到（皮肤覆盖面）", m2.move === 120 && m2.enter === 100 && m2.exit === 60, m2);
}

console.log("---- ②b s 单位换算（CSS 产物压缩会把 260ms 归一成 .26s） ----");
{
  w.document.documentElement.style.setProperty("--mm-move", ".26s");
  w.document.documentElement.style.setProperty("--mm-enter", "0.24s");
  w.document.documentElement.style.setProperty("--mm-exit", "200ms");
  const m = A.readMotion();
  check(".26s / 0.24s 换算成 ms，ms 原样", m.move === 260 && m.enter === 240 && m.exit === 200, m);
  w.document.documentElement.style.setProperty("--mm-move", "120ms");
  w.document.documentElement.style.setProperty("--mm-enter", "100ms");
  w.document.documentElement.style.setProperty("--mm-exit", "60ms");
}

console.log("---- ③ planTransition 摄取 Token 档 ----");
{
  // 最小 Display 夹具：两个 item（一个复用一个新增），view 不补偿
  const disp = (ids) => ({
    rootId: "R", items: ids.map((id) => ({ id, kind: "card", x: 10, y: 10, w: 40, h: 24, nid: id, group: null, level: 0 })),
    byId: Object.fromEntries(ids.map((id) => [id, { id, kind: "card", x: 10, y: 10, w: 40, h: 24, nid: id, group: null, level: 0 }])),
    edges: [], consumed: [], groups: {}, bounds: { w: 100, h: 100 }, material: { items: 0, ai: 0 }, stats: { visited: 0, recomputed: 0, reused: 0 },
  });
  const prev = disp(["a"]);
  const next = disp(["a", "b"]);
  const tr = A.planTransition(prev, next, { view: { tx: 0, ty: 0, k: 1 } });
  check("duration = Token 三档最大值（120/100/60 → 120）", tr.duration === 120, tr.duration);
  check("tr.motion 携带 Token 档", tr.motion && tr.motion.move === 120 && tr.motion.enter === 100 && tr.motion.exit === 60, tr.motion);
  const mid = A.transitionFrame(tr, 59);
  check("transitionFrame 按档推进（t=59 < 120 未完成；离场档 60ms 已尽）", mid.done === false, { done: mid.done, t: 59 });
  const nearEnd = A.transitionFrame(tr, 119);
  check("t=119 仍在过渡（旧档 120ms）", nearEnd.done === false, { done: nearEnd.done });
  check("t=120 完成", A.transitionFrame(tr, 120).done === true);
}

console.log("---- ④ 非法值回落 ----");
{
  w.document.documentElement.style.setProperty("--mm-move", "abc");
  w.document.documentElement.style.setProperty("--mm-enter", "0ms");
  w.document.documentElement.style.setProperty("--mm-exit", "-5ms");
  const m = A.readMotion();
  check("非法 / 0 / 负数全部回落常量", m.move === A.MOTION.move && m.enter === A.MOTION.enter && m.exit === A.MOTION.exit, m);
  w.document.documentElement.style.removeProperty("--mm-move");
  w.document.documentElement.style.removeProperty("--mm-enter");
  w.document.documentElement.style.removeProperty("--mm-exit");
}

console.log("---- ⑤ 应用动效三态（C-32 A5 motionPreference） ----");
{
  const mp = A.motionPreference();
  check("无 body 类、无 matchMedia → full", mp === "full", mp);
  w.document.body.classList.add("motion-off");
  check("body.motion-off → off（直接跳终态）", A.motionPreference() === "off");
  w.document.body.classList.remove("motion-off");
  w.document.body.classList.add("motion-reduced");
  check("body.motion-reduced → reduced（时长减半、只做透明度过渡）", A.motionPreference() === "reduced");
  w.document.body.classList.remove("motion-reduced");
  // 系统 prefers-reduced-motion：命中 → off（与既有行为一致）；未命中 → full
  const realMatch = w.matchMedia;
  w.matchMedia = (q) => ({ matches: /reduce/.test(String(q)) });
  globalThis.window = w;
  check("系统 prefers-reduced-motion 命中 → off", A.motionPreference() === "off");
  w.matchMedia = () => ({ matches: false });
  check("系统未命中 → full", A.motionPreference() === "full");
  if (realMatch) w.matchMedia = realMatch; else delete w.matchMedia;
}

console.log("---- ⑥ planTransition 的 motionMode（off / reduced） ----");
{
  const disp = (ids) => ({
    rootId: "R", items: ids.map((id) => ({ id, kind: "card", x: 10, y: 10, w: 40, h: 24, nid: id, group: null, level: 0 })),
    byId: Object.fromEntries(ids.map((id) => [id, { id, kind: "card", x: 10, y: 10, w: 40, h: 24, nid: id, group: null, level: 0 }])),
    edges: [], consumed: [], groups: {}, bounds: { w: 100, h: 100 }, material: { items: 0, ai: 0 }, stats: { visited: 0, recomputed: 0, reused: 0 },
  });
  const prev = disp(["a"]);
  const next = disp(["a", "b"]);
  const off = A.planTransition(prev, next, { view: { tx: 0, ty: 0, k: 1 }, motionMode: "off" });
  check("motionMode=off：duration 0（首帧即终态，无过渡帧）", off.duration === 0 && A.transitionFrame(off, 0).done === true, off.duration);
  const view = { tx: 5, ty: 6, k: 2 };
  const red = A.planTransition(prev, next, { view, anchorId: null, motionMode: "reduced" });
  const fullDur = Math.ceil(Math.max(A.readMotion().move, A.readMotion().enter, A.readMotion().exit) / 2);
  check(`motionMode=reduced：时长减半（${red.duration} = ceil(max/2)=${fullDur}）`, red.duration === fullDur, { duration: red.duration, fullDur });
  const fromB = red.from.b;
  check("reduced：入场几何即终态、只从透明淡入（无位移）", fromB.x === 10 && fromB.y === 10 && fromB.w === 40 && fromB.h === 24 && fromB.o === 0, fromB);
  check("reduced：视图不动画（viewTo == viewFrom）", red.viewTo.tx === view.tx && red.viewTo.ty === view.ty && red.viewTo.k === view.k, { from: red.viewFrom, to: red.viewTo });
  const mid = A.transitionFrame(red, Math.max(1, red.duration - 1));
  check("reduced：中帧新元素半透明、位置已是终态", mid.opacity.b > 0 && mid.opacity.b < 1 && mid.display.byId.b.x === 10, { o: mid.opacity.b });
  // full vs reduced 的真正分野：既有元素是否做位移过渡（reduced 只做透明度）
  const moved = {
    rootId: "R", items: [{ id: "a", kind: "card", x: 50, y: 10, w: 40, h: 24, nid: "a", group: null, level: 0 }],
    byId: { a: { id: "a", kind: "card", x: 50, y: 10, w: 40, h: 24, nid: "a", group: null, level: 0 } },
    edges: [], consumed: [], groups: {}, bounds: { w: 100, h: 100 }, material: { items: 0, ai: 0 }, stats: { visited: 0, recomputed: 0, reused: 0 },
  };
  const redM = A.planTransition(prev, moved, { view, anchorId: null, motionMode: "reduced" });
  const fullM = A.planTransition(prev, moved, { view, anchorId: null });
  check("reduced：既有元素几何直接到终态（from == to，不位移）", redM.from.a.x === 50 && redM.from.a.o === 1, redM.from.a);
  check("full：既有元素从旧位置位移过渡（既有行为不变）", fullM.from.a.x === 10 && fullM.from.a.o === 1, fullM.from.a);
}

console.log("---- ⑦ 过渡帧减负：空路由结果（C-32 A6 画布行为的纯函数面） ----");
{
  let ord = 0;
  const mk = (id, parentId, type, title, extra = {}) => {
    ord += 1;
    return { id, parentId, ord: ord * 1000, title, type, timeText: null, patternHint: extra.hint ?? null, blockStart: null, blockEnd: null, spans: null, state: extra.state ?? "floor", source: "ai", warnings: null, jobId: null };
  };
  // 带关系边的图：B3→B2 据（组内 rel）+ A2→C 因（跨组 rel）
  const load = {
    meta: { mapId: "m-a6", title: "A6" },
    nodes: [
      mk("A", null, "背景", "背景", { state: "open" }), mk("A1", "A", "叙事", "叙事一"), mk("A2", "A", "叙事", "叙事二"),
      mk("C", null, "论点", "论点", { state: "open" }), mk("C1", "C", "理由", "理由一"),
      mk("B", null, "命题", "命题", { state: "open" }), mk("B1", "B", "定义", "定义"), mk("B2", "B", "前提", "前提"), mk("B3", "B", "推导", "推导"),
    ],
    edges: [{ from: "B3", to: "B2", code: "据" }, { from: "A2", to: "C", code: "因" }],
    view: { patterns: {}, collapsed: [] },
  };
  const state = G.createGraph(load);
  const d = L.layoutGraph(state, {});
  const full = R.routeRelations(state, d, { relAll: true, geometry: "all" });
  const svgFull = S.buildCanvasSvg(d, full, { view: { tx: 0, ty: 0, k: 1 } });
  const emptyRoute = { edges: [], byId: {}, crossCount: {}, focus: null, policy: { relAll: false, hovered: null, selected: null, focus: false, zoom: 1 }, stats: { intra: 0, cross: 0, crossRaw: 0, routed: 0, direct: 0, channel: 0, search: 0, blocked: 0 } };
  const svgEmpty = S.buildCanvasSvg(d, emptyRoute, { view: { tx: 0, ty: 0, k: 1 } });
  const relPaths = (s) => (s.match(/data-edge-id=/g) || []).length;
  check("完整路由：关系线绘制（data-edge-id > 0）", relPaths(svgFull) > 0, relPaths(svgFull));
  check("空路由（过渡帧）：关系线不绘制", relPaths(svgEmpty) === 0, relPaths(svgEmpty));
  check("空路由：结构线保留（border-strong 结构路径仍在）", svgEmpty.includes('stroke="var(--border-strong)"'), null);
  check("空路由：节点卡片仍绘制（画布不是空白帧）", svgEmpty.includes("data-node-id"), null);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
