// @runtime: node
// 聚焦档二分查找等价性（审计 C-32 A3 合入前置；node 直跑：node tests/lensWindowFit.binary.test.cjs）。
// 报告 C-32 步骤 3：chooseFocusBinary 与线性 chooseFocus 的结果必须完全一致（n 全等）才允许替换；
// 任何不一致 → 保留线性版本并回报。数据：①仓库现成的 12 卡论证样张（tests/lensWindowFit.test.cjs 同款
// 量测夹具，五档工作区）②50 张随机树（确定性种子）× 3 档工作区，用真实 layoutGraph 量测。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const F = require(path.join(__dirname, "..", "src", "lib", "lensWindowFit.ts"));
const V2 = path.join(__dirname, "..", "src", "lib", "mindmap", "v2");
const T = require(path.join(V2, "types.ts"));
const G = require(path.join(V2, "graph.ts"));
const L = require(path.join(V2, "layout.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 900)}`); }
}
const ROOT = T.ROOT_ID;
const AREAS = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 0, y: 0, width: 1228, height: 811 },
  { x: 0, y: 0, width: 760, height: 715 },
];
const near = (a, b) => Math.abs(a - b) <= 1e-9;

// ── ① 现成测试图：12 卡论证（与 tests/lensWindowFit.test.cjs 的聚焦段同款量测夹具） ──
console.log("---- ① 12 卡论证样张（线性版正向对照的五个工作区） ----");
{
  const WIDTHS = [154, 154, 154, 155, 155, 192, 192, 192, 192, 192, 192, 192];
  const measure = (n, more) => ({ w: WIDTHS.slice(0, n).reduce((a, b) => a + b, 0) + n * 32 + (more > 0 ? 112 : 0), h: 152 });
  let all = true;
  const bad = [];
  for (const area of AREAS.concat([{ x: 0, y: 0, width: 1366, height: 728 }, { x: 0, y: 0, width: 480, height: 320 }])) {
    for (const floor of [undefined, 0.62, 0.5, 0.8]) {
      const a = F.chooseFocus({ total: 12, measure, workArea: area, floor });
      const b = F.chooseFocusBinary({ total: 12, measure, workArea: area, floor });
      const ok = a.n === b.n && a.more === b.more && a.fits === b.fits && near(a.scale, b.scale) && a.content.w === b.content.w && a.content.h === b.content.h;
      if (!ok) bad.push({ area: area.width, floor, a, b });
      all = all && ok;
    }
  }
  check("12 卡样张 × 5 工作区 × 4 档 floor：n/more/fits/scale/content 全等", all, bad.slice(0, 3));
  // 正向对照：与线性基准同值（1228→8 / 760→5 / 1366→9）
  const at = (w, h) => F.chooseFocusBinary({ total: 12, measure, workArea: { x: 0, y: 0, width: w, height: h } });
  check("二分正向对照：1228→8 / 760→5 / 1366→9", at(1228, 811).n === 8 && at(760, 715).n === 5 && at(1366, 728).n === 9, [at(1228, 811).n, at(760, 715).n, at(1366, 728).n]);
}

// ── ② 50 张随机树 × 3 工作区：真实 layoutGraph 量测 ──
console.log("---- ② 50 张随机树（确定性种子）× 3 档工作区，真实 layout 量测 ----");
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const TYPES = ["论点", "理由", "证据", "要点", "步骤", "分类", "反方观点", "结论"];
const HINTS = [null, "tree", "chain", "timeline", "layered", "argument", "compare", "grid"];
let ordSeq = 0;
function mk(id, parentId, type, title, extra = {}) {
  ordSeq += 1;
  return {
    id, parentId, ord: extra.ord ?? ordSeq * 1000, title, type,
    timeText: extra.time ?? null, patternHint: extra.hint ?? null,
    blockStart: null, blockEnd: null, spans: null,
    state: extra.state ?? "floor", source: "ai", warnings: null, jobId: null,
  };
}
function randomTreeLoad(seed, topCount, fanout, leaves, depth2) {
  const rnd = lcg(seed);
  ordSeq = 0;
  const nodes = [];
  for (let i = 1; i <= topCount; i++) {
    nodes.push(mk(`t${i}`, null, TYPES[Math.floor(rnd() * TYPES.length)], `论点 ${i} ${"内容".repeat(1 + Math.floor(rnd() * 9))}`, { state: "open", hint: HINTS[Math.floor(rnd() * HINTS.length)] }));
    for (let j = 1; j <= fanout; j++) {
      const id = `t${i}.${j}`;
      const hasKids = depth2 > 0 && rnd() < 0.5;
      nodes.push(mk(id, `t${i}`, TYPES[Math.floor(rnd() * TYPES.length)], `要点 ${i}.${j} ${"细节".repeat(1 + Math.floor(rnd() * 10))}`, { state: hasKids ? "open" : "floor" }));
      if (hasKids) {
        for (let k = 1; k <= depth2; k++) nodes.push(mk(`${id}.${k}`, id, TYPES[Math.floor(rnd() * TYPES.length)], `细节 ${i}.${j}.${k}`, {}));
      } else if (rnd() < 0.5) {
        for (let k = 1; k <= 1 + Math.floor(rnd() * leaves); k++) nodes.push(mk(`${id}.${k}`, id, TYPES[Math.floor(rnd() * TYPES.length)], `细节 ${i}.${j}.${k}`, {}));
      }
    }
  }
  return { meta: { mapId: `b${seed}`, title: `二分随机树 ${seed}` }, nodes, edges: [], view: { patterns: {}, collapsed: [] } };
}
{
  let mismatch = 0;
  const firstBad = [];
  let totalMeasures = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const topCount = 3 + (seed % 30); // 3…32 个顶层子项
    const fanout = 1 + (seed % 4);
    const load = randomTreeLoad(seed, topCount, fanout, 3, seed % 3);
    const state = G.createGraph(load);
    const total = (state.children[ROOT] ?? []).length;
    if (total < 2) continue;
    for (const area of AREAS) {
      const measure = (n) => {
        totalMeasures++;
        const d = L.layoutGraph(state, { cache: L.createLayoutCache(), maxChildren: n == null ? undefined : { [ROOT]: n } });
        return { w: d.bounds.w, h: d.bounds.h };
      };
      const a = F.chooseFocus({ total, measure, workArea: area });
      const b = F.chooseFocusBinary({ total, measure, workArea: area });
      const ok = a.n === b.n && a.more === b.more && a.fits === b.fits && near(a.scale, b.scale) && a.content.w === b.content.w && a.content.h === b.content.h;
      if (!ok) {
        mismatch++;
        if (!firstBad.length) firstBad.push({ seed, area: area.width, total, linear: a, binary: b });
      }
    }
  }
  check("50 张随机树 × 3 工作区：二分与线性 n/content/fits/scale 全等", mismatch === 0, { mismatch, firstBad: firstBad[0] });
  console.log(`    （layoutGraph 量测调用 ${totalMeasures} 次）`);
}

// ── ③ 边界与防御：total=1 / total=2 / 测量次数上界 ──
console.log("---- ③ 边界：total 1/2、单调不满足时的行为一致 ----");
{
  const c1 = F.chooseFocus({ total: 1, measure: (n) => ({ w: n * 100, h: 50 }), workArea: AREAS[1] });
  const b1 = F.chooseFocusBinary({ total: 1, measure: (n) => ({ w: n * 100, h: 50 }), workArea: AREAS[1] });
  check("total=1：两者同值", c1.n === b1.n && c1.fits === b1.fits && c1.content.w === b1.content.w, { c1, b1 });
  let count = 0;
  const m = (n) => { count++; return { w: 3200 + n * 100, h: 152 }; };
  const big = F.chooseFocusBinary({ total: 9, measure: m, workArea: AREAS[1] });
  const bigLin = F.chooseFocus({ total: 9, measure: m, workArea: AREAS[1] });
  check("全部放不下（N=1 兜底）：与线性同值", big.n === 1 && big.fits === false && big.n === bigLin.n && big.fits === bigLin.fits, { big, bigLin });
  // 测量次数：n=9 全放不下 → 快路径①②后即返回（2 次）；线性要 9 次
  count = 0;
  F.chooseFocusBinary({ total: 9, measure: m, workArea: AREAS[1] });
  const binaryCalls = count;
  count = 0;
  F.chooseFocus({ total: 9, measure: m, workArea: AREAS[1] });
  check(`全放不下时二分测量次数（${binaryCalls}）少于线性`, binaryCalls < count, { binaryCalls, linearCalls: count });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
