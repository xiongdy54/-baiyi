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

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
