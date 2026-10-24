// @runtime: node
// 结构图谱 · 布局缓存跨调用共享等价性（审计 C-32 A2 合入前置；node 直跑：node tests/m15v2.lensfit-cache.test.cjs）。
// 报告 C-32 步骤 2：requestFit 内所有 measureGraph 调用共用一个 layoutGraph 缓存（同一张图、maxChildren 取
// 1…total 的每个值）。合入前置＝「共享缓存」与「每次新缓存」的布局结果完全相等；不相等说明缓存的 deps
// 漏了与 maxChildren 有关的项，必须停下回报（本测试就是那道闸门）。
// 覆盖：①原型样张降序/升序扫描 ②随机树（确定性种子）×10 ③noLod 混合序列（base=true → 探测=undefined → 终态）
//       ④同节点 id 的两个视图状态交替（reorder 变体，rev 只在根上变化）⑤共享缓存的逐次清理不产生跨调用污染。
// 另附计时对照（只打印不断言）：聚焦档扫描形态（48 子项、n 从 47 线性降到界）下共享 vs 新缓存的 layoutMs。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
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

/** 原型样张（与 tests/m15v2.layout.test.cjs 的 sample 同构：说明+证明+论证+对比+叙事，29 节点 11 条关系） */
function sampleLoad() {
  ordSeq = 0;
  const nodes = [
    mk("A", null, "背景", "「万物皆数」的信念与破裂", { hint: "timeline", state: "open" }),
    mk("A1", "A", "叙事", "学派确立「万物皆数」", { time: "约前 530" }),
    mk("A2", "A", "叙事", "希帕索斯发现不可公度", { time: "约前 470", state: "more" }),
    mk("A3", "A", "叙事", "欧多克索斯建立比例论", { time: "约前 370" }),
    mk("A4", "A", "叙事", "戴德金分割奠基实数", { time: "1872" }),
    mk("B", null, "命题", "√2 不是有理数", { hint: "chain", state: "open" }),
    mk("B1", "B", "定义", "有理数＝两整数之比"),
    mk("B2", "B", "前提", "反设 √2＝p/q，p、q 互素"),
    mk("B3", "B", "推导", "p²＝2q²，故 p² 为偶数"),
    mk("B4", "B", "引理", "平方为偶 ⇒ 本身为偶", { state: "more" }),
    mk("B5", "B", "推导", "p 为偶，代回得 q 也为偶"),
    mk("B6", "B", "结论", "与互素矛盾，命题得证"),
    mk("C", null, "论点", "危机推动了数学的严格化", { hint: "argument", state: "open" }),
    mk("C1", "C", "理由", "几何量取代算术数", { state: "open" }),
    mk("C1a", "C1", "证据", "《原本》第五卷比例论"),
    mk("C2", "C", "理由", "催生连续量的精确理论", { state: "more" }),
    mk("C3", "C", "反方观点", "「危机」是后世的夸大"),
    mk("C4", "C", "反驳", "不可公度确实改写了证明"),
    mk("D", null, "对比", "有理数与无理数", { hint: "compare", state: "open" }),
    mk("D1", "D", "分类", "有理数", { state: "open" }),
    mk("D1a", "D1", "要点", "可以写成 p/q"),
    mk("D1b", "D1", "要点", "小数有限或循环"),
    mk("D2", "D", "分类", "无理数", { state: "open" }),
    mk("D2a", "D2", "要点", "不能写成 p/q"),
    mk("D2b", "D2", "要点", "小数无限不循环"),
    mk("E", null, "步骤", "从比例论到实数", { state: "open" }),
    mk("E1", "E", "步骤", "比例论处理不可公度量"),
    mk("E2", "E", "步骤", "极限思想逐步成形"),
    mk("E3", "E", "推导", "实数完备性"),
  ];
  const edges = [
    { from: "A2", to: "C", code: "因" },
    { from: "B2", to: "B1", code: "据" }, { from: "B3", to: "B2", code: "据" },
    { from: "B5", to: "B3", code: "据" }, { from: "B5", to: "B4", code: "据" },
    { from: "B6", to: "B5", code: "据" }, { from: "B6", to: "B2", code: "据" },
    { from: "C1", to: "A3", code: "据" }, { from: "C4", to: "C3", code: "驳" }, { from: "C4", to: "B", code: "据" },
    { from: "D2", to: "D1", code: "比" },
  ];
  return { meta: { mapId: "m1", title: "√2 与第一次数学危机" }, nodes, edges, view: { patterns: {}, collapsed: [] } };
}

/** 确定性伪随机（LCG；种子固定 → 结果可复现） */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TYPES = ["论点", "理由", "证据", "要点", "步骤", "分类", "反方观点", "结论"];
const HINTS = [null, "tree", "chain", "timeline", "layered", "argument", "compare", "grid"];

/** 随机树：topCount 个顶层节点（parentId null，与样张同构——合成根 ROOT_ID 下 maxChildren 扫描才有意义） */
function randomTreeLoad(seed, { topCount, fanout, leaves, depth2 = 0 }) {
  const rnd = lcg(seed);
  ordSeq = 0;
  const nodes = [];
  for (let i = 1; i <= topCount; i++) {
    nodes.push(mk(`t${i}`, null, TYPES[Math.floor(rnd() * TYPES.length)], `论点 ${i} ${"内容".repeat(1 + Math.floor(rnd() * 6))}`, { state: "open", hint: HINTS[Math.floor(rnd() * HINTS.length)] }));
    for (let j = 1; j <= fanout; j++) {
      const id = `t${i}.${j}`;
      const hasKids = depth2 > 0 && rnd() < 0.5;
      nodes.push(mk(id, `t${i}`, TYPES[Math.floor(rnd() * TYPES.length)], `要点 ${i}.${j} ${"细节".repeat(1 + Math.floor(rnd() * 8))}`, { state: hasKids ? "open" : leaves > 0 && rnd() < 0.5 ? "open" : "floor" }));
      if (hasKids) {
        for (let k = 1; k <= depth2; k++) nodes.push(mk(`${id}.${k}`, id, TYPES[Math.floor(rnd() * TYPES.length)], `细节 ${i}.${j}.${k}`, {}));
      } else if (leaves > 0 && rnd() < 0.5) {
        for (let k = 1; k <= 1 + Math.floor(rnd() * leaves); k++) nodes.push(mk(`${id}.${k}`, id, TYPES[Math.floor(rnd() * TYPES.length)], `细节 ${i}.${j}.${k}`, {}));
      }
    }
  }
  return { meta: { mapId: `r${seed}`, title: `随机树 ${seed}` }, nodes, edges: [], view: { patterns: {}, collapsed: [] } };
}

/** 随机折叠若干分叉点（模拟透镜的折叠覆盖） */
function withRandomCollapse(load, seed) {
  const rnd = lcg(seed);
  const forkIds = load.nodes.filter((n) => load.nodes.some((m) => m.parentId === n.id)).map((n) => n.id);
  const collapsed = forkIds.filter(() => rnd() < 0.6);
  return { ...load, view: { patterns: {}, collapsed } };
}

/** reorder 变体：把最后一个顶层节点挪到最前（模拟 MindmapLens.reorderRoot——节点 id 不变、只动根的 rev/顺序） */
function reorderVariant(load) {
  const kids = load.nodes.filter((n) => n.parentId === null).map((n) => n.id);
  if (kids.length < 2) return load;
  const first = kids[kids.length - 1];
  const order = [first, ...kids.filter((id) => id !== first)];
  const nodes = load.nodes.map((n) => {
    if (n.parentId !== null) return n;
    const idx = order.indexOf(n.id);
    return { ...n, ord: -(idx + 1) * 1000 };
  });
  return { ...load, nodes };
}

const snapshotOf = (d) =>
  JSON.stringify({ bounds: d.bounds, items: d.items, edges: d.edges, groups: d.groups, consumed: d.consumed, rootId: d.rootId, material: d.material });

function maxN(state) {
  let n = 0;
  for (const c of state.children[ROOT] ?? []) n++;
  return Math.max(1, n);
}

/** 一次扫描等价性：order 给出 maxChildren 序列；共享缓存逐次复用，对照每次全新缓存 */
function scanEquivalence(name, state, order, opts = {}) {
  const shared = L.createLayoutCache();
  let mismatch = null;
  const sharedResults = [];
  for (const step of order) {
    const mc = step.n == null ? undefined : { [ROOT]: step.n };
    const d = L.layoutGraph(state, { cache: shared, maxChildren: mc, noLod: step.noLod, locks: opts.locks ? {} : undefined });
    sharedResults.push({ step, snap: snapshotOf(d) });
  }
  for (let i = 0; i < order.length; i++) {
    const step = order[i];
    const mc = step.n == null ? undefined : { [ROOT]: step.n };
    const fresh = L.layoutGraph(state, { cache: L.createLayoutCache(), maxChildren: mc, noLod: step.noLod, locks: opts.locks ? {} : undefined });
    if (sharedResults[i].snap !== snapshotOf(fresh)) {
      mismatch = { i, step, shared: JSON.parse(sharedResults[i].snap).bounds, fresh: fresh.bounds };
      break;
    }
  }
  check(name, !mismatch, mismatch || undefined);
}

console.log("---- ① 原型样张：maxChildren 1…total（降序＝chooseFocus 扫描序 / 升序） ----");
{
  const state = G.createGraph(sampleLoad());
  const total = maxN(state);
  check("样张顶层子项数 = 5", total === 5, total);
  const desc = [];
  for (let n = total - 1; n >= 1; n--) desc.push({ n });
  scanEquivalence("样张降序扫描（4→1）共享 vs 新缓存全等", state, desc);
  const asc = [];
  for (let n = 1; n < total; n++) asc.push({ n });
  scanEquivalence("样张升序扫描（1→4）共享 vs 新缓存全等", state, asc);
  scanEquivalence("样章全序列（含 noLod 混合与 null=不限制）共享 vs 新缓存全等", state, [
    { n: null, noLod: true }, { n: total - 1 }, { n: 3 }, { n: 1 }, { n: null, noLod: true }, { n: 2 }, { n: total - 1 },
  ]);
}

console.log("---- ② 随机树 ×10：maxChildren 1…total 降序扫描 ----");
{
  const seeds = [11, 23, 37, 52, 68, 74, 89, 101, 137, 155];
  for (const seed of seeds) {
    const load = withRandomCollapse(randomTreeLoad(seed, { topCount: 6 + (seed % 5), fanout: 3 + (seed % 3), leaves: 2, depth2: seed % 3 }), seed + 1);
    const state = G.createGraph(load);
    const total = maxN(state);
    const order = [];
    for (let n = total - 1; n >= 1; n--) order.push({ n });
    scanEquivalence(`随机树 seed=${seed}（顶层 ${total}）降序扫描全等`, state, order);
  }
}

console.log("---- ③ 同节点 id 的两个视图状态交替（reorder 变体；缓存按 id 存、deps 含 rev） ----");
{
  const load = randomTreeLoad(777, { topCount: 7, fanout: 4, leaves: 2, depth2: 2 });
  const a = G.createGraph(load);
  const b = G.createGraph(reorderVariant(load));
  const totalA = maxN(a);
  const order = [];
  for (let n = totalA - 1; n >= 1; n--) order.push({ n, state: "a" });
  // 交替：a 与 b 共享同一个缓存（requestFit 内 base 用 lensGraph、探测用 focusGraph 的形态）
  const shared = L.createLayoutCache();
  let mismatch = null;
  const snaps = [];
  for (const step of order) {
    const st = step.state === "a" ? a : b;
    const d = L.layoutGraph(st, { cache: shared, maxChildren: { [ROOT]: step.n } });
    snaps.push(snapshotOf(d));
  }
  for (let i = 0; i < order.length; i++) {
    const step = order[i];
    const st = step.state === "a" ? a : b;
    const fresh = L.layoutGraph(st, { cache: L.createLayoutCache(), maxChildren: { [ROOT]: step.n } });
    if (snaps[i] !== snapshotOf(fresh)) { mismatch = { i, step }; break; }
  }
  check("两状态交替扫描共享 vs 新缓存全等", !mismatch, mismatch || undefined);
}

console.log("---- ④ 计时对照（只打印不断言）：聚焦档扫描形态 48 子项 ----");
{
  const load = randomTreeLoad(2024, { topCount: 48, fanout: 2, leaves: 1, depth2: 0 });
  const state = G.createGraph(load);
  const total = maxN(state);
  // 线性扫描到 n≈19（与实机探针观察到的边界一致）
  const order = [];
  for (let n = total - 1; n >= 19; n--) order.push({ n });
  const t0f = process.hrtime.bigint();
  for (const step of order) L.layoutGraph(state, { cache: L.createLayoutCache(), maxChildren: { [ROOT]: step.n } });
  const freshMs = Number(process.hrtime.bigint() - t0f) / 1e6;
  const shared = L.createLayoutCache();
  const t0s = process.hrtime.bigint();
  for (const step of order) L.layoutGraph(state, { cache: shared, maxChildren: { [ROOT]: step.n } });
  const sharedMs = Number(process.hrtime.bigint() - t0s) / 1e6;
  console.log(`    新缓存 ×${order.length} 次布局 = ${freshMs.toFixed(2)}ms；共享缓存 = ${sharedMs.toFixed(2)}ms（${((1 - sharedMs / freshMs) * 100).toFixed(1)}% 下降）`);
  check("共享缓存耗时不高于新缓存", sharedMs <= freshMs, { freshMs, sharedMs });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
