// @runtime: node
// 材料导图 v2 画布纯模块 III · 关系路由回归（node 直跑：node tests/m15v2.route.test.cjs）。
// 契约：docs/design/MINDMAP-V2-IMPL-PLAN.md §5.1 route.ts / §6 T7 ①–④；设计稿 §15.6 / §15.7。
// Display 一律由 layoutGraph 真实生成；所有组手动锁定 tree / chain（不依赖其余版式的实现进度）。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const V2 = path.join(__dirname, "..", "src", "lib", "mindmap", "v2");
const T = require(path.join(V2, "types.ts"));
const G = require(path.join(V2, "graph.ts"));
const L = require(path.join(V2, "layout.ts"));
const R = require(path.join(V2, "route.ts"));
const A = require(path.join(V2, "animate.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 800)}`); }
}
const ROOT = T.ROOT_ID;

// ───────────── 夹具 ─────────────
let ordSeq = 0;
function mk(id, parentId, type, title, extra = {}) {
  ordSeq += 1;
  return {
    id, parentId, ord: extra.ord ?? ordSeq * 1000, title, type,
    timeText: extra.time ?? null, patternHint: null,
    blockStart: null, blockEnd: null, spans: null,
    state: extra.state ?? "floor", source: "ai", warnings: null, jobId: extra.jobId ?? null,
  };
}
/** 每个有子的节点都手动锁版式（tree / chain） */
function lockPatterns(nodes, pick) {
  const parents = new Set(nodes.map((n) => n.parentId ?? ROOT));
  const patterns = {};
  for (const p of [...parents].sort()) patterns[p] = pick(p);
  return patterns;
}
function sampleLoad(extraEdges = []) {
  ordSeq = 0;
  const nodes = [
    mk("A", null, "背景", "「万物皆数」的信念与破裂", { state: "open" }),
    mk("A1", "A", "叙事", "学派确立「万物皆数」"),
    mk("A2", "A", "叙事", "希帕索斯发现不可公度", { state: "more" }),
    mk("A3", "A", "叙事", "欧多克索斯建立比例论"),
    mk("B", null, "命题", "√2 不是有理数", { state: "open" }),
    mk("B1", "B", "定义", "有理数＝两整数之比"),
    mk("B2", "B", "前提", "反设 √2＝p/q，p、q 互素"),
    mk("B3", "B", "推导", "p²＝2q²，故 p² 为偶数"),
    mk("B4", "B", "引理", "平方为偶 ⇒ 本身为偶", { state: "more" }),
    mk("B5", "B", "推导", "p 为偶，代回得 q 也为偶"),
    mk("B6", "B", "结论", "与互素矛盾，命题得证"),
    mk("C", null, "论点", "危机推动了数学的严格化", { state: "open" }),
    mk("C1", "C", "理由", "几何量取代算术数", { state: "open" }),
    mk("C1a", "C1", "证据", "《原本》第五卷比例论"),
    mk("C1b", "C1", "证据", "比例论处理连续量"),
    mk("C2", "C", "理由", "催生连续量的精确理论", { state: "more" }),
    mk("C3", "C", "反方观点", "「危机」是后世的夸大"),
    mk("C4", "C", "反驳", "不可公度确实改写了证明"),
    mk("D", null, "对比", "有理数与无理数", { state: "open" }),
    mk("D1", "D", "分类", "有理数", { state: "open" }),
    mk("D1a", "D1", "要点", "可以写成 p/q"),
    mk("D1b", "D1", "要点", "小数有限或循环"),
    mk("D2", "D", "分类", "无理数", { state: "open" }),
    mk("D2a", "D2", "要点", "不能写成 p/q"),
    mk("D2b", "D2", "要点", "小数无限不循环"),
  ];
  const edges = [
    { from: "A2", to: "C", code: "因" },
    { from: "B2", to: "B1", code: "据" }, { from: "B3", to: "B2", code: "据" },
    { from: "B5", to: "B4", code: "据" }, { from: "B6", to: "B5", code: "据" },
    { from: "C1", to: "A3", code: "据" }, { from: "C4", to: "C3", code: "驳" }, { from: "C4", to: "B", code: "据" },
    { from: "D2", to: "D1", code: "比" }, { from: "D1a", to: "C1a", code: "例" },
    { from: "B5", to: "B", code: "支" },
    ...extraEdges,
  ];
  const chainSet = new Set(["A", "B", "C1", "D1", "D2"]);
  const patterns = lockPatterns(nodes, (p) => (chainSet.has(p) ? "chain" : "tree"));
  return { meta: { mapId: "m1", title: "√2 与第一次数学危机" }, nodes, edges, view: { patterns, collapsed: [] } };
}
const sample = (extra) => G.createGraph(sampleLoad(extra));

// 大图：root → 6 章（tree）→ 8 节（偶数节 chain 带框、奇数节 tree）→ 6 点 → 部分 2 叶；500 条确定性伪随机关系
function bigLoad(nEdges = 500) {
  ordSeq = 0;
  const nodes = [];
  for (let c = 0; c < 6; c++) {
    const cid = `t${c}`;
    nodes.push(mk(cid, null, "引言", `第 ${c + 1} 章 结构导图的渐进展开`, { state: "open" }));
    for (let s = 0; s < 8; s++) {
      const sid = `${cid}.${s}`;
      nodes.push(mk(sid, cid, "步骤", `第 ${s + 1} 节 Section ${s}`, { state: "open" }));
      for (let u = 0; u < 6; u++) {
        const uid = `${sid}.${u}`;
        nodes.push(mk(uid, sid, u % 2 ? "要点" : "推导", `要点 ${c}-${s}-${u}`, { state: u % 3 === 0 ? "open" : "floor" }));
        if (u % 3 === 0) for (let l = 0; l < 2; l++) nodes.push(mk(`${uid}.${l}`, uid, "例证", `叶 ${c}.${s}.${u}.${l}`));
      }
    }
  }
  const ids = nodes.map((n) => n.id);
  let seed = 20261017;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const codes = T.REL_CODES;
  const edges = [];
  const seen = new Set();
  while (edges.length < nEdges) {
    const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)];
    const code = codes[Math.floor(rnd() * codes.length)];
    const k = a + "|" + b + "|" + code;
    if (a === b || seen.has(k)) continue;
    seen.add(k);
    edges.push({ from: a, to: b, code });
  }
  const patterns = lockPatterns(nodes, (p) => {
    const m = /^t\d+\.(\d+)$/.exec(p);
    return m && Number(m[1]) % 2 === 0 ? "chain" : "tree";
  });
  return { meta: { mapId: "big", title: "大图" }, nodes, edges, view: { patterns, collapsed: [] } };
}

// ───────────── 几何断言工具 ─────────────
/** 把采样折线细分到 ≤1px */
function dense(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const strictlyIn = (p, r) => p[0] > r.x + 0.01 && p[0] < r.x + r.w - 0.01 && p[1] > r.y + 0.01 && p[1] < r.y + r.h - 0.01;
/** 返回 [{edge, item}]：关系线穿过的非端点卡片 / 不含任一端点的组框 */
function crossings(d, routed) {
  const bad = [];
  const cards = d.items.filter((it) => it.kind === "card" || it.kind === "more");
  const frames = d.items.filter((it) => it.kind === "frame");
  for (const e of routed.edges) {
    if (!e.d) continue;
    const P = dense(R.sampleEdge(e));
    const allow = new Set([...A.frameChain(d, e.from), ...A.frameChain(d, e.to)]);
    for (const c of cards) {
      if (c.id === e.from || c.id === e.to) continue;
      if (P.some((p) => strictlyIn(p, c))) { bad.push([e.id, c.id]); break; }
    }
    for (const f of frames) {
      if (allow.has(f.nid) || f.nid === e.from || f.nid === e.to) continue;
      if (P.some((p) => strictlyIn(p, f))) { bad.push([e.id, f.id]); break; }
    }
  }
  return bad;
}
/** 通道段两两：同轴、区间重叠、距离 <4px 的不同边 */
function laneViolations(routed) {
  const segs = [];
  for (const e of routed.edges) {
    if (!e.poly) continue;
    for (let i = 1; i < e.poly.length - 2; i++) {
      const a = e.poly[i], b = e.poly[i + 1];
      const axis = a[1] === b[1] ? 0 : 1;
      const c = axis === 0 ? a[1] : a[0];
      const lo = Math.min(axis ? a[1] : a[0], axis ? b[1] : b[0]), hi = Math.max(axis ? a[1] : a[0], axis ? b[1] : b[0]);
      segs.push({ e: e.id, axis, c, lo, hi });
    }
  }
  const bad = [];
  let pairs = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if (s.e === t.e || s.axis !== t.axis) continue;
    if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 0) continue;
    if (Math.abs(s.c - t.c) < 12) pairs++;
    if (Math.abs(s.c - t.c) < R.ROUTE.LANE - 1e-9) bad.push([s, t]);
  }
  return { bad, pairs, segs: segs.length };
}
const E = (routed, pred) => routed.edges.filter(pred);

// ════════════════════════════════════════════════════════════
console.log("---- 跨组判定 / 显示策略 ----");
{
  const s = sample();
  const d = L.layoutGraph(s);
  check("夹具：组全部为 tree / chain（无回落）", Object.values(d.groups).every((g) => (g.pattern === "tree" || g.pattern === "chain") && !g.fallbackFrom));
  const r0 = R.routeRelations(s, d);
  const crossIds = E(r0, (e) => e.kind === "cross").map((e) => e.id);
  check("未被 consumed 的关系全部成为跨组关系（11 条，无组内 rel）", crossIds.length === 11 && r0.stats.intra === 0, crossIds);
  check("「据」画成目标 → 本节点", !!r0.byId["x:A3>C1:据"] && !r0.byId["x:C1>A3:据"]);
  check("默认：跨组关系不画线、不算几何", E(r0, (e) => e.kind === "cross").every((e) => !e.visible && e.d === null));
  check("↗N：C4 = 2（驳 C3、据 B），A3 = 1", r0.crossCount.C4 === 2 && r0.crossCount.A3 === 1, r0.crossCount);
  const rh = R.routeRelations(s, d, { hovered: "C4" });
  const hotIds = E(rh, (e) => e.hot).map((e) => e.id).sort();
  check("hover：与悬停节点相连的关系 hot + 可见 + 全亮", hotIds.join() === "x:B>C4:据,x:C4>C3:驳" && E(rh, (e) => e.hot).every((e) => e.visible && e.opacity === 1 && e.d), hotIds);
  check("hover：其余跨组仍不画", E(rh, (e) => !e.hot).every((e) => !e.visible));
  const ra = R.routeRelations(s, d, { relAll: true });
  check("全部关系：全部可见，非高亮淡色 0.55", ra.edges.every((e) => e.visible && e.d && e.opacity === R.ROUTE.DIM_CROSS));
  const rf = R.routeRelations(s, d, { relAll: true, selected: "C4", focus: true });
  check("关系透视：focus 集＝自身 + 对端 + 祖先链", [...rf.focus].sort().join() === [ROOT, "B", "C", "C3", "C4"].sort().join(), [...rf.focus]);
  check("关系透视：非相关关系 0.15，相关全亮", E(rf, (e) => !e.hot).every((e) => e.opacity === R.ROUTE.DIM_FOCUS) && E(rf, (e) => e.hot).every((e) => e.opacity === 1));
  check("透视未开 → focus null", ra.focus === null && R.routeRelations(s, d, { focus: true }).focus === null);
  { const ra6 = R.routeRelations(s, d, { relAll: true, zoom: 0.6 }); check("标签：hot 显示关系名；「比」常显 vs；zoom<0.8 非 hot 无名", rh.byId["x:C4>C3:驳"].label.text === "反驳" && ra6.byId["x:D2>D1:比"].label.text === "vs" && ra6.byId["x:A2>C:因"].label === null); }
  check("标签：zoom≥0.8 常显关系名", R.routeRelations(s, d, { relAll: true, zoom: 1 }).byId["x:A2>C:因"].label.text === "导致");
  check("relName（i18n）生效", R.routeRelations(s, d, { hovered: "C4", relName: (c) => "R" + c }).byId["x:C4>C3:驳"].label.text === "R驳");
}

console.log("---- 端点提升 / ×N 合并 / 挂框边 ----");
{
  // 折叠 C：C1→A3、D1a→C1a、C4→C3 …提升到 C
  let s = sample([{ from: "C4", to: "B2", code: "据" }, { from: "C4", to: "B3", code: "据" }, { from: "A1", to: "B4.2", code: "答" }]);
  let d = L.layoutGraph(s);
  let r = R.routeRelations(s, d, { relAll: true });
  check("×0：未折叠时 C4 → B / B2 / B3 是三条", ["x:B>C4:据", "x:B2>C4:据", "x:B3>C4:据"].every((k) => r.byId[k] && r.byId[k].count === 1));
  check("尚未生成的端点按路径式 id 提升（B4.2 → B4）", !!r.byId["x:A1>B4:答"] && r.byId["x:A1>B4:答"].orig[0].to === "B4.2");
  // 挂框边：B 已展开成框（chain），C4 在框外 → 挂框；B5 → B（组内父子）仍连卡片
  const eB = r.byId["x:B>C4:据"];
  const fB = d.byId["F:B"];
  const p0 = R.sampleEdge(eB)[0];
  const onBorder = (p, f) => (Math.abs(p[0] - f.x) < 0.01 || Math.abs(p[0] - f.x - f.w) < 0.01 || Math.abs(p[1] - f.y) < 0.01 || Math.abs(p[1] - f.y - f.h) < 0.01)
    && p[0] >= f.x - 0.01 && p[0] <= f.x + f.w + 0.01 && p[1] >= f.y - 0.01 && p[1] <= f.y + f.h + 0.01;
  check("挂框边：端点已展开为组框 → 起点在框边上", eB.fromFrame && !eB.toFrame && onBorder(p0, fB), { p0, fB });
  const eIn = r.byId["x:B5>B:支"];
  const cB = d.byId.B;
  check("组内父子之间：仍连卡片（不挂框）", eIn && !eIn.toFrame && !eIn.fromFrame && onBorder(R.sampleEdge(eIn).slice(-1)[0], cB), eIn && R.sampleEdge(eIn).slice(-1));
  // 折叠 B → 三条同向「据」合并为 ×3
  s = G.setCollapsed(s, "B", true);
  d = L.layoutGraph(s);
  r = R.routeRelations(s, d, { relAll: true });
  const m = r.byId["x:B>C4:据"];
  check("端点提升：B 折叠后 B2 / B3 → B", !r.byId["x:B2>C4:据"] && !r.byId["x:B3>C4:据"] && !!m);
  check("×N：同一对端点同向同码合并 ×3，orig 保留原关系", m.count === 3 && m.orig.map((o) => o.to).sort().join() === "B,B2,B3", m.orig);
  check("×N 标签（非 hot、zoom<0.8）只显示 ×3", R.routeRelations(s, d, { relAll: true, zoom: 0.6 }).byId["x:B>C4:据"].label.text === "×3");
  check("×N hot 标签：关系名 + ×3", R.routeRelations(s, d, { hovered: "C4" }).byId["x:B>C4:据"].label.text === "依据 ×3");
  check("折叠后 B 不再挂框（无框）", !m.fromFrame && !d.byId["F:B"]);
  check("提升后两端相同的组内关系丢弃（B2→B1 等）", !r.edges.some((e) => e.from === e.to));
  check("↗N 按原关系计：B = 3（C4×3）+ 1（B4.2 答）", r.crossCount.B === 4, r.crossCount);
  // 折叠 C：子孙全部提升到 C
  const sc = G.setCollapsed(sample(), "C", true);
  const dc = L.layoutGraph(sc);
  const rc = R.routeRelations(sc, dc, { relAll: true });
  check("折叠 C：C1→A3 提升为 A3→C；D1a→C1a 提升为 D1a→C", !!rc.byId["x:A3>C:据"] && !!rc.byId["x:D1a>C:例"] && !rc.edges.some((e) => e.from.startsWith("C1") || e.to.startsWith("C1")));
  check("折叠 C：C4→C3 两端同提升到 C → 丢弃", !rc.edges.some((e) => e.code === "驳"));
}

console.log("---- LOD 摘要卡端点提升 ----");
{
  const s = sample();
  const d = L.layoutGraph(s);
  check("lodFrames：zoom ≥0.5 不收", A.lodFrames(d, 0.6).length === 0);
  const deep = A.lodFrames(d, 0.4);
  check("lodFrames：0.25≤zoom<0.5 收深层框（C1 / D1 / D2：level≥2）", deep.join() === "C1,D1,D2", deep);
  check("lodFrames：zoom<0.25 收全部最外层框", A.lodFrames(d, 0.2).join() === "A,B,C1,D1,D2", A.lodFrames(d, 0.2));
  const r = R.routeRelations(s, d, { relAll: true, lodCollapsed: deep });
  check("收进摘要卡的端点提升到框头：D1a→C1a ⇒ D1→C1（挂框）", !!r.byId["x:D1>C1:例"] && r.byId["x:D1>C1:例"].fromFrame && r.byId["x:D1>C1:例"].toFrame);
  const hid = A.lodHidden(d, deep);
  check("lodHidden：框内卡片隐藏，框与框头可见", hid.has("C1a") && hid.has("D1b") && !hid.has("C1") && !hid.has("F:C1") && !hid.has("C"));
  const sm = A.lodSummary(d, deep);
  check("lodSummary：C1 收起 2 张卡", sm.C1.cards === 2 && sm.C1.pattern === "chain", sm);
}

console.log("---- ① 跨组边穿卡 0（密采样）/ ② 平行分道 ≥4px / ③ 确定性 / ④ 500 边耗时 ----");
{
  const s = sample();
  const d = L.layoutGraph(s);
  const r = R.routeRelations(s, d, { relAll: true });
  const bad = crossings(d, r);
  check("① 样张：全部关系线不穿非端点卡片、不穿不含端点的组框", bad.length === 0 && r.stats.blocked === 0, bad);

  const big = G.createGraph(bigLoad(500));
  const db = L.layoutGraph(big);
  check("大图夹具：节点数 / 框数", Object.keys(big.nodes).length === 6 + 48 + 288 + 192 && db.items.filter((i) => i.kind === "frame").length === 24, { n: Object.keys(big.nodes).length });
  const rb = R.routeRelations(big, db, { relAll: true });
  const badB = crossings(db, rb);
  check(`① 大图 ${rb.stats.cross} 条跨组（原 ${rb.stats.crossRaw}）：穿卡 / 穿框 0，blocked 0（直连 ${rb.stats.direct} / 通道 ${rb.stats.channel} / 搜索 ${rb.stats.search}）`, badB.length === 0 && rb.stats.blocked === 0 && rb.stats.channel + rb.stats.search > 20, { bad: badB.slice(0, 5), stats: rb.stats });
  const lv = laneViolations(rb);
  check(`② 同通道平行边 ≥4px（近邻同轴重叠段 ${lv.pairs} 对，违例 ${lv.bad.length}）`, lv.pairs > 0 && lv.bad.length === 0, lv.bad.slice(0, 3));
  const r2 = R.routeRelations(G.createGraph(bigLoad(500)), L.layoutGraph(G.createGraph(bigLoad(500))), { relAll: true });
  const strip = (x) => JSON.stringify({ edges: x.edges, crossCount: x.crossCount, stats: x.stats });
  check("③ 路由确定性：独立重建图 + 布局 + 路由逐字节一致", strip(rb) === strip(r2));
  check("③ 同输入重复路由一致", strip(R.routeRelations(big, db, { relAll: true })) === strip(rb));
  // ④ 耗时：预热 1 次，取 7 次中位数
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t0 = process.hrtime.bigint();
    R.routeRelations(big, db, { relAll: true });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (i) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  console.log(`      ④ 500 边全量路由（relAll，${db.items.length} 元素）：中位 ${med.toFixed(1)}ms，最快 ${times[0].toFixed(1)}ms，最慢 ${times[times.length - 1].toFixed(1)}ms`);
  check("④ 500 边路由 ≤30ms（中位）", med <= 30, times);
  const t1 = process.hrtime.bigint();
  R.routeRelations(big, db, {});
  const msDefault = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`      默认策略（只算 hot 几何）：${msDefault.toFixed(1)}ms`);
  check("默认策略（只统计 ↗N）≤10ms", msDefault <= 10, msDefault);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
