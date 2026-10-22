// @runtime: node
// 结构图纸片窗口 · 聚焦 N 的布局证据（v49.29 / D203 · T3；node 直跑）。
// 锁定：maxChildren=N → 前 N 个子项 + 一张「另有 (total-N) 项」卡（112×32）；noLod → 全部子项；完整图谱默认 LOD 不变。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const { createGraph } = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "graph.ts"));
const { ROOT_ID } = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "types.ts"));
const { layoutGraph, LAYOUT } = require(path.join(__dirname, "..", "src", "lib", "mindmap", "v2", "layout.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 700)}`); }
}
const node = (id, parentId, ord, title) => ({
  id, parentId, ord, title, type: "论点", timeText: null, patternHint: null,
  blockStart: null, blockEnd: null, spans: null, state: "floor", source: "ai", warnings: null, jobId: null,
});
const kids = Array.from({ length: 20 }, (_, i) => node(`c${i + 1}`, null, 1000 + i * 10, `子项 ${i + 1}`));
// 顶层节点 parentId=null；createGraph 会把它们挂到 ROOT_ID 下。
const g = createGraph({
  meta: { schemaVersion: 2, mapId: "m-focus", documentId: "d-focus", title: "聚焦布局" },
  nodes: kids,
  edges: [],
  view: null,
}, "m-focus");
const cards = (d) => d.items.filter((i) => i.kind === "card" && i.id !== ROOT_ID).map((i) => i.id);
const mores = (d) => d.items.filter((i) => i.kind === "more");
const layout = (opts) => layoutGraph(g, { ...opts, rootTitle: "聚焦布局" });

console.log("---- 聚焦 N：前 N 子项 + 另有 (total-N) 项 ----");
{
  const d = layout({ maxChildren: { [ROOT_ID]: 8 } });
  const ids = cards(d);
  const m = mores(d);
  check("N=8：只画前 8 个子项（c1…c8），其余 12 个不进图", ids.length === 8 && ids.every((id) => /^c[1-8]$/.test(id)), ids);
  check("「另有 12 项」卡存在，且是布局的 more 卡（112×32）", m.length === 1 && m[0].count === 12 && m[0].w === 112 && m[0].h === 32, m);
  check("more 卡挂在顶组下（data-group-id 用 ROOT_ID）", m.length === 1 && m[0].nid === ROOT_ID, m[0]);
}
{
  const d = layout({ maxChildren: { [ROOT_ID]: 12 } });
  const ids = cards(d);
  const m = mores(d);
  check("N=12：12 个子项 + 「另有 8 项」", ids.length === 12 && m.length === 1 && m[0].count === 8, { n: ids.length, more: m.map((x) => x.count) });
}

console.log("---- 显式全图：跳过 LOD，一张不少 ----");
{
  const d = layout({ noLod: true });
  const ids = cards(d);
  check("noLod：20 个子项全部画出来，无 more 卡", ids.length === 20 && mores(d).length === 0, { n: ids.length, mores: mores(d).length });
}
console.log("---- 完整图谱默认 LOD 不变（12→7 + more） ----");
{
  const d = layout({});
  const ids = cards(d);
  const m = mores(d);
  check(`默认 LOD：${LAYOUT.LOD_SHOW} 个子项 + 「另有 ${20 - LAYOUT.LOD_SHOW} 项」`, ids.length === LAYOUT.LOD_SHOW && m.length === 1 && m[0].count === 20 - LAYOUT.LOD_SHOW, { n: ids.length, more: m.map((x) => x.count) });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
