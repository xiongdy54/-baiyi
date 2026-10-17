// @runtime: node
// 材料导图 v2 画布纯模块 I 回归（node 直跑：node tests/m15v2.layout.test.cjs）。
// 契约：docs/design/MINDMAP-V2-IMPL-PLAN.md §5.1 / §6 T5 ①–⑧；设计稿 §15.4 / §15.6 / §15.8 S1 S2 S5 S7。
// 经 tests/lib/tsload.cjs 直接加载 TS（不依赖 esbuild）。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const V2 = path.join(__dirname, "..", "src", "lib", "mindmap", "v2");
const T = require(path.join(V2, "types.ts"));
const G = require(path.join(V2, "graph.ts"));
const M = require(path.join(V2, "measure.ts"));
const P = require(path.join(V2, "pattern.ts"));
const L = require(path.join(V2, "layout.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const ROOT = T.ROOT_ID;

// ───────────── 夹具 ─────────────
let ordSeq = 0;
function mk(id, parentId, type, title, extra = {}) {
  ordSeq += 1;
  return {
    id, parentId, ord: extra.ord ?? ordSeq * 1000, title, type,
    timeText: extra.time ?? null, patternHint: extra.hint ?? null,
    blockStart: null, blockEnd: null, spans: null,
    state: extra.state ?? "floor", source: "ai", warnings: null, jobId: extra.jobId ?? null,
  };
}
// 原型样张（design-samples/mindmap-v2-canvas.html 的 D）：说明 + 证明 + 论证 + 对比 + 叙事
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
const sample = () => G.createGraph(sampleLoad());

// 宽图：root → 8 章 → 10 节 → 12 小节 → 各 1 叶（共 2,008 节点）；部分章带链提示（带框）
function bigLoad() {
  ordSeq = 0;
  const nodes = [];
  for (let c = 0; c < 8; c++) {
    const cid = `t${c}`;
    nodes.push(mk(cid, null, "引言", `第 ${c + 1} 章 结构导图的渐进展开`, { state: "open" }));
    for (let s = 0; s < 10; s++) {
      const sid = `${cid}.${s}`;
      nodes.push(mk(sid, cid, s % 3 === 0 ? "步骤" : "分类", `第 ${s + 1} 节 Section ${s}`, { state: "open", hint: s % 4 === 1 ? "chain" : null }));
      for (let u = 0; u < 12; u++) {
        const uid = `${sid}.${u}`;
        nodes.push(mk(uid, sid, u % 2 ? "要点" : "推导", `小节 ${u} 要点 ${c}-${s}-${u}`, { state: "open" }));
        nodes.push(mk(`${uid}.0`, uid, "例证", `叶 ${c}.${s}.${u}`, { state: u % 5 ? "floor" : "more" }));
      }
    }
  }
  return { meta: { mapId: "big", title: "大图" }, nodes, edges: [], view: { patterns: {}, collapsed: [] } };
}

// ───────────── 几何工具 ─────────────
const cards = (d) => d.items.filter((it) => it.kind === "card" || it.kind === "more");
const frames = (d) => d.items.filter((it) => it.kind === "frame");
const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, o) => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;
function overlapIssues(d) {
  const out = [];
  const cs = cards(d);
  // 按 x 排序扫描，避免 O(n²) 全量
  const sorted = cs.slice().sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].x < sorted[i].x + sorted[i].w; j++) {
      if (inter(sorted[i], sorted[j])) out.push(["card", sorted[i].id, sorted[j].id]);
    }
  }
  const fs = frames(d);
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const a = fs[i], b = fs[j];
    if (inter(a, b) && !inside(a, b) && !inside(b, a)) out.push(["frame", a.id, b.id]);
  }
  for (const c of cs) {
    if (c.group) { const f = d.byId["F:" + c.group]; if (!f || !inside(c, f)) out.push(["outside", c.id, c.group]); }
    for (const f of fs) if (inter(c, f) && !isAncestorFrame(d, f.nid, c)) out.push(["card-in-foreign-frame", c.id, f.id]);
  }
  return out;
}
function isAncestorFrame(d, frameNid, item) {
  // item 的 group 链上是否含 frameNid
  let g = item.group;
  let guard = 0;
  while (g && guard++ < 100) {
    if (g === frameNid) return true;
    const f = d.byId["F:" + g];
    g = f ? f.group : null;
  }
  return false;
}
const onGrid = (d) => d.items.every((it) => [it.x, it.y, it.w, it.h].every((v) => Number.isInteger(v) && v % 4 === 0));
const pos = (d, id) => d.byId[id] && { x: d.byId[id].x, y: d.byId[id].y };
const stable = (d) => { const { stats, ...rest } = d; return JSON.stringify(rest); };

// ════════════════════════════════════════════════════════════
console.log("---- tsload / measure ----");
{
  check("tsload：无扩展名相对导入可解析（layout → patterns/tree）", typeof L.layoutGraph === "function" && L.implementedPatterns().join() === "argument,chain,compare,grid,layered,timeline,tree");
  check("CJK 1em / ASCII 0.55em / 空格 0.3em", M.textWidth("中文", 10) === 20 && Math.abs(M.textWidth("ab", 10) - 11) < 1e-9 && Math.abs(M.textWidth(" ", 10) - 3) < 1e-9);
  const s1 = M.cardSize({ title: "有理数＝两整数之比", type: "定义" });
  check("卡片尺寸 4px 整数、高 48", s1.w % 4 === 0 && s1.h === 48 && s1.w >= M.CARD.minW, s1);
  check("超长标题封顶 maxW + fitText 截断", M.cardSize({ title: "长".repeat(80), type: "其他" }).w === M.CARD.maxW && M.fitText("长".repeat(80), 13, 100).endsWith("…") && M.textWidth(M.fitText("长".repeat(80), 13, 100), 13) <= 100);
  check("r4 / g4", M.r4(13) === 16 && M.r4(16) === 16 && M.g4(14) === 16 && M.g4(13) === 12);
}

console.log("---- graph reducer ----");
{
  let s = sample();
  check("顶层子按 ord", G.childrenOf(s, ROOT).join() === "A,B,C,D,E");
  const s2 = G.applyDelta(s, { mapId: "other", kind: "nodes", nodes: [mk("X", null, "其他", "x")] });
  check("mapId 不匹配原样返回", s2 === s);
  const before = s.nodes.B1;
  const s3 = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [{ ...before, title: "改名" }] });
  check("同节点后到覆盖", s3.nodes.B1.title === "改名" && s.nodes.B1.title !== "改名");
  check("结构共享：无关子列表引用不变", s3.children.A === s.children.A && s3.children.B === s.children.B);
  check("rev 只打变化节点 + 祖先链", s3.rev.B1 > s.rev.B1 && s3.rev.B > s.rev.B && s3.rev[ROOT] > s.rev[ROOT] && s3.rev.A === s.rev.A && s3.rev.C1 === s.rev.C1);
  const s4 = G.applyDelta(s, { mapId: "m1", kind: "edges", edges: [{ from: "B2", to: "B1", code: "据" }, { from: "B2", to: "B1", code: "据" }] });
  check("关系去重", s4.edgeCount === s.edgeCount);
  const s5 = G.applyDelta(s, { mapId: "m1", kind: "states", states: [{ id: "A2", state: "streaming" }] });
  check("states 增量", s5.nodes.A2.state === "streaming" && s.nodes.A2.state === "more");
  const s6 = G.applyDelta(s, { mapId: "m1", kind: "explain", explainDelta: { nodeId: "B", text: "第一段" } });
  const s7 = G.applyDelta(s6, { mapId: "m1", kind: "explain", explainDelta: { nodeId: "B", text: "，第二段" } });
  check("explain 流式累加、不打 rev", s7.explain.B === "第一段，第二段" && s7.rev === s.rev);
  const sc = G.setCollapsed(s, "C", true);
  check("折叠：可见性 / 端点提升 / 祖先", !G.isVisible(sc, "C1a") && G.visibleRep(sc, "C1a") === "C" && G.ancestors(s, "C1a").join() === "C,C1" && G.visibleRep(s, "C1a") === "C1a");
  check("related：自身 + 对端 + 祖先", [...G.related(s, "C4")].sort().join() === "B,C,C3,C4");
  check("orphan（父未到）不可达", (() => { const o = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [mk("Z1", "Z", "其他", "孤儿")] }); return !G.isReachable(o, "Z1") && !L.layoutGraph(o).byId.Z1; })());
}

console.log("---- ① 确定性（×100 逐字节一致；缓存增量 ≡ 全量） ----");
{
  const s = sample();
  const ref = JSON.stringify(L.layoutGraph(s));
  let same = true;
  for (let i = 0; i < 100; i++) if (JSON.stringify(L.layoutGraph(G.createGraph(sampleLoad()))) !== ref) { same = false; break; }
  check("样张 ×100 逐字节一致", same);
  const big = G.createGraph(bigLoad());
  const refB = JSON.stringify(L.layoutGraph(big));
  let sameB = true;
  for (let i = 0; i < 5; i++) if (JSON.stringify(L.layoutGraph(big)) !== refB) sameB = false;
  check("2,008 节点图重复布局一致", sameB);
  // 缓存增量与全量逐字节一致（经历多次 delta / 视图变化）
  const cache = L.createLayoutCache();
  let st = s;
  L.layoutGraph(st, { cache });
  const steps = [
    (x) => G.applyDelta(x, { mapId: "m1", kind: "nodes", nodes: [mk("B4a", "B4", "前提", "反设 p 为奇数 2k+1"), mk("B4b", "B4", "推导", "p²＝4k²+4k+1 为奇数")] }),
    (x) => G.applyDelta(x, { mapId: "m1", kind: "states", states: [{ id: "B4", state: "open" }] }),
    (x) => G.setCollapsed(x, "D", true),
    (x) => G.setManualPattern(x, "A", "chain"),
    (x) => G.applyDelta(x, { mapId: "m1", kind: "edges", edges: [{ from: "E3", to: "E2", code: "据" }] }),
    (x) => G.setCollapsed(x, "D", false),
    (x) => G.applyDelta(x, { mapId: "m1", kind: "nodes", nodes: [{ ...x.nodes.C1a, title: "《几何原本》第五卷" }] }),
  ];
  let allEq = true;
  for (const f of steps) {
    st = f(st);
    const inc = stable(L.layoutGraph(st, { cache }));
    const full = stable(L.layoutGraph(st));
    if (inc !== full) { allEq = false; break; }
  }
  check("缓存增量结果 ≡ 无缓存全量（7 步 delta/视图）", allEq);
}

console.log("---- ② S1 顺序不变 ----");
{
  let s = sample();
  // 乱序到达：新子 ord 交错插入 B 组
  const arrivals = [
    mk("Bx3", "B", "推导", "插入 3", { ord: s.nodes.B5.ord + 1 }),
    mk("Bx1", "B", "推导", "插入 1", { ord: s.nodes.B1.ord + 1 }),
    mk("Bx2", "B", "推导", "插入 2", { ord: s.nodes.B3.ord + 1 }),
  ];
  const oldOrder = L.layoutGraph(s).groups.B.kids.slice();
  let ok = true;
  for (const n of arrivals) {
    s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [n] });
    const d = L.layoutGraph(s);
    const kids = d.groups.B.kids;
    const olds = kids.filter((k) => oldOrder.includes(k));
    if (olds.join() !== oldOrder.join()) ok = false;
    const ords = kids.map((k) => s.nodes[k].ord);
    if (ords.some((o, i) => i && o < ords[i - 1])) ok = false;
    // 链为纵向：y 顺序与 ord 顺序一致
    const ys = kids.map((k) => d.byId[k].y);
    if (ys.some((y, i) => i && y <= ys[i - 1])) ok = false;
  }
  check("乱序到达：旧节点相对次序不变、组内按 ord、画面 y 序一致", ok);
  const d = L.layoutGraph(s);
  check("Display.groups.B.kids 原文顺序", d.groups.B.kids.join() === "B1,Bx1,B2,B3,Bx2,B4,B5,Bx3,B6", d.groups.B.kids);
}

console.log("---- ③ S2 块外刚性平移 ----");
function subtreeRel(d, s, root) {
  // root 子树内全部 item 相对 root 卡片的坐标
  const r = d.byId[root];
  const out = [];
  for (const it of d.items) {
    const anc = G.ancestors(s, it.nid);
    if (it.nid === root ? it.kind !== "card" || it.id === root : anc.includes(root)) {
      if (it.nid === root || anc.includes(root)) out.push([it.id, it.x - r.x, it.y - r.y, it.w, it.h, it.kind]);
    }
  }
  return JSON.stringify(out);
}
{
  const cases = [
    ["深挖中段叶 B4（链组内）", "B4", [mk("B4a", "B4", "前提", "反设 p 为奇数"), mk("B4b", "B4", "推导", "p² 为奇数"), mk("B4c", "B4", "结论", "引理成立")]],
    ["深挖首组叶 A2", "A2", [mk("A2a", "A2", "叙事", "希帕索斯之死传说")]],
    ["论证组子 C2 深挖", "C2", [mk("C2a", "C2", "证据", "穷竭法"), mk("C2b", "C2", "证据", "比例论")]],
  ];
  for (const [name, target, add] of cases) {
    const s0 = sample();
    const cache = L.createLayoutCache();
    const d0 = L.layoutGraph(s0, { cache });
    const s1 = G.applyDelta(s0, { mapId: "m1", kind: "nodes", nodes: add, states: [{ id: target, state: "open" }] });
    const d1 = L.layoutGraph(s1, { cache });
    const chain = new Set([ROOT, target, ...G.ancestors(s1, target)]);
    let bad = [];
    for (const id of G.visibleIds(s0)) {
      if (id === ROOT || chain.has(id)) continue;
      if (subtreeRel(d0, s0, id) !== subtreeRel(d1, s1, id)) bad.push(id);
    }
    check(`${name}：链外 ${G.visibleIds(s0).length - chain.size} 棵子树相对坐标逐字节不变`, bad.length === 0, bad);
    const expect = chain.size + add.length;
    check(`${name}：只重算脏链（重算 ${d1.stats.recomputed} ≤ 链长 ${chain.size} + 新叶 ${add.length}）`, d1.stats.recomputed <= expect, d1.stats);
  }
}

console.log("---- ④ S7 生长方向一致 ----");
{
  const scenarios = [
    ["B4 深挖（中段）", "B4", ["B4a", "B4b"]],
    ["A1 深挖（首组首叶）", "A1", ["A1a"]],
    ["E1 深挖为链框", "E1", ["E1a", "E1b", "E1c"], "chain"],
    ["D1b 新增兄弟", null, ["D1c"]],
  ];
  for (const [name, target, ids, hint] of scenarios) {
    let s0 = sample();
    if (hint) s0 = G.applyDelta(s0, { mapId: "m1", kind: "nodes", nodes: [{ ...s0.nodes[target], patternHint: hint }] });
    const d0 = L.layoutGraph(s0);
    const parent = target ?? "D1";
    const add = ids.map((id) => mk(id, parent, "步骤", "新增 " + id));
    const s1 = G.applyDelta(s0, { mapId: "m1", kind: "nodes", nodes: add });
    const d1 = L.layoutGraph(s1);
    const bad = [];
    for (const c of cards(d0)) {
      const b = d1.byId[c.id];
      if (!b) continue;
      if (b.x - c.x < 0 || b.y - c.y < 0) bad.push([c.id, b.x - c.x, b.y - c.y]);
    }
    check(`${name}：全部已有卡片 Δx ≥ 0、Δy ≥ 0`, bad.length === 0, bad);
  }
  // S6 前提：叶在树中被深挖为框时，框头卡片在其兄弟间的次序与左缘不变
  const s0 = sample();
  const s1 = G.applyDelta(s0, { mapId: "m1", kind: "nodes", nodes: [{ ...s0.nodes.E1, patternHint: "chain" }, mk("E1a", "E1", "步骤", "a"), mk("E1b", "E1", "步骤", "b")] });
  const d1 = L.layoutGraph(s1);
  check("叶长成框：框头卡片位于框左上（PAD 内缩）", d1.byId["F:E1"] && d1.byId.E1.x === d1.byId["F:E1"].x + L.LAYOUT.PAD && d1.byId.E1.y === d1.byId["F:E1"].y + L.LAYOUT.PAD);
}

console.log("---- ⑤ 不重叠 / 网格 / id 唯一 ----");
{
  const variants = [
    ["样张", sample()],
    ["样张（全部手动链）", ["A", "B", "C", "D", "E", "C1", "D1", "D2"].reduce((s, id) => G.setManualPattern(s, id, "chain"), sample())],
    ["样张（折叠 B、C）", G.setCollapsed(G.setCollapsed(sample(), "B", true), "C", true)],
    ["2,008 节点", G.createGraph(bigLoad())],
  ];
  for (const [name, s] of variants) {
    const d = L.layoutGraph(s);
    const iss = overlapIssues(d);
    check(`${name}：卡片两两不重叠、框嵌套或相离、卡片在所属框内`, iss.length === 0, iss.slice(0, 5));
    check(`${name}：全部坐标 4px 网格整数`, onGrid(d));
    check(`${name}：item id 唯一`, new Set(d.items.map((i) => i.id)).size === d.items.length);
    const edgeOk = d.edges.every((e) => d.byId[e.from] && d.byId[e.to]);
    check(`${name}：组内边端点均在画面`, edgeOk);
  }
  const d = L.layoutGraph(sample());
  check("Display 结构：根卡 / 组信息 / 框归属 / 结构线 / 先后线", d.byId[ROOT].state === "root" && d.groups.B.framed && d.byId["F:B"].nid === "B" && d.byId.B1.group === "B"
    && d.edges.some((e) => e.kind === "tree" && e.from === ROOT && e.to === "A") && d.edges.some((e) => e.kind === "seq" && e.from === "B1" && e.to === "B2"), d.groups.B);
  check("四态：more / floor / open / collapsed(+N)", d.byId.A2.state === "more" && d.byId.A1.state === "floor" && d.byId.B.state === "open"
    && L.layoutGraph(G.setCollapsed(sample(), "D", true)).byId.D.state === "collapsed" && L.layoutGraph(G.setCollapsed(sample(), "D", true)).byId.D.count === 6);
  check("框标注「版式 · 来源」", d.byId["F:B"].text === "链 · 模型提示" && d.byId["F:B"].pattern === "chain" && d.byId["F:B"].how === "hint");
  check("T6：五个版式均已实现，样张无回落", d.groups.A.pattern === "timeline" && d.groups.C.pattern === "argument" && d.groups.D.pattern === "compare" && Object.values(d.groups).every((g) => g.fallbackFrom === null));
  check("材料级标签", d.material.key === "mixed" || typeof d.material.label === "string");
}

console.log("---- LOD（>12 显示前 7 +「另有 N 项」） ----");
{
  ordSeq = 0;
  const nodes = [mk("P", null, "分类", "多子组", { state: "open" })];
  for (let i = 0; i < 15; i++) nodes.push(mk("P" + String(i).padStart(2, "0"), "P", "要点", "项 " + i));
  const s = G.createGraph({ meta: { mapId: "l", title: "LOD" }, nodes, edges: [], view: null });
  const d = L.layoutGraph(s);
  check("前 7 项 + MORE:P(count 8)", d.groups.P.kids.length === 8 && d.groups.P.kids[7] === "MORE:P" && d.byId["MORE:P"].count === 8 && d.groups.P.hidden === 8 && !d.byId.P07);
  const d2 = L.layoutGraph(s, { lodExpanded: ["P"] });
  check("lodExpanded 显示全部", d2.groups.P.kids.length === 15 && !d2.byId["MORE:P"]);
}

console.log("---- ⑥ §15.4 选择规则表（每行正例 + 反例） ----");
{
  const F = (kids, extra = {}) => ({
    parentType: extra.parentType ?? "其他", patternHint: extra.hint ?? null, manual: extra.manual ?? null,
    kids: kids.map((k, i) => ({ id: "k" + i, type: k.t ?? k, timeText: k.time ?? null, hasChildren: !!k.has })),
    siblingEdges: (extra.edges ?? []).map(([a, b, c]) => ({ from: "k" + a, to: "k" + b, code: c })),
  });
  const R = (f) => P.ruleOf(f);
  // 1 时间线
  check("规则1 正：子全部带时间", R(F([{ t: "背景", time: "1900" }, { t: "方案", time: "1910" }])).rule === 1);
  check("规则1 正：≥75% 叙事", R(F(["叙事", "叙事", "叙事", "背景"])).rule === 1);
  check("规则1 反：叙事 2/3 且缺时间", R(F(["叙事", "叙事", "背景"])).rule !== 1);
  // 2 论证图
  check("规则2 正：父为论点", R(F(["要点", "要点"], { parentType: "论点" })).rule === 2);
  check("规则2 正：子含反方观点", R(F(["背景", "反方观点"])).rule === 2);
  check("规则2 正：理由/证据 ≥50%", R(F(["理由", "证据", "背景", "方案"])).rule === 2);
  check("规则2 反：理由/证据 1/3", R(F(["理由", "背景", "方案"])).rule !== 2);
  // 3 对照
  check("规则3 正：父为对比且 ≥2 子", R(F(["分类", "分类"], { parentType: "对比" })).rule === 3);
  check("规则3 正：子间有「比」", R(F(["分类", "分类", "背景"], { edges: [[1, 0, "比"]] })).rule === 3);
  check("规则3 反：父为对比但只 1 子", R(F(["分类"], { parentType: "对比" })).rule !== 3);
  // 4 分层图
  check("规则4 正：3 子 2 条据/推/因", R(F(["定义", "命题", "背景"], { edges: [[1, 0, "据"], [2, 1, "推"]] })).rule === 4);
  check("规则4 反：3 子 1 条", R(F(["定义", "命题", "背景"], { edges: [[1, 0, "据"]] })).rule !== 4);
  check("规则4 反：2 子（<3）", R(F(["定义", "背景"], { edges: [[1, 0, "据"]] })).rule !== 4);
  // 5 链
  check("规则5 正：步骤/推导/前提/结论 ≥60%", R(F(["步骤", "步骤", "推导", "背景", "方案"])).rule === 5);
  check("规则5 反：1/2", R(F(["步骤", "背景"])).rule !== 5);
  // 6 网格
  check("规则6 正：6 叶无关系", R(F(["分类", "分类", "分类", "分类", "分类", "分类"])).rule === 6);
  check("规则6 反：有子有子节点", R(F(["分类", "分类", "分类", "分类", "分类", { t: "分类", has: true }])).rule !== 6);
  check("规则6 反：彼此有关系", R(F(["分类", "分类", "分类", "分类", "分类", "分类"], { edges: [[0, 1, "例"]] })).rule !== 6);
  check("规则6 反：5 项", R(F(["分类", "分类", "分类", "分类", "分类"])).rule !== 6);
  // 7 其余
  check("规则7 正：其余为大纲树", R(F(["背景", "方案"])).pattern === "tree" && R(F(["背景", "方案"])).rule === 7);
  check("规则7 反：命中前序规则即不落 7", R(F(["叙事"])).rule !== 7);
  // 顺序
  check("按序取第一个：时间 + 论点 → 时间线（1 先于 2）", R(F([{ t: "理由", time: "1900" }, { t: "证据", time: "1901" }], { parentType: "论点" })).rule === 1);
  // 优先级
  const f = F(["步骤", "步骤", "步骤"], { hint: "grid", manual: "compare" });
  check("手动 > 提示 > 规则", P.selectPattern(f).how === "manual" && P.selectPattern({ ...f, manual: null }).how === "hint" && P.selectPattern({ ...f, manual: null, patternHint: null }).pattern === "chain");
  check("提示前提不成立（{对照} 1 子）→ 规则", P.selectPattern(F(["步骤"], { hint: "compare" })).how === "rule");
  check("groupFacts：父对比 + 「比」边取自图", (() => { const s = sample(); const fa = P.groupFacts(s, "D", s.children.D); return fa.parentType === "对比" && fa.siblingEdges.length === 1 && fa.kids[0].hasChildren; })());
  // 材料级
  check("materialLabel：论证型 / 证明型 / 叙事型 / 混合型 / 空图说明型", P.materialLabel([{ type: "论点" }, { type: "理由" }, { type: "证据" }]).key === "argument"
    && P.materialLabel([{ type: "命题" }, { type: "引理" }, { type: "结论" }]).key === "proof"
    && P.materialLabel([{ type: "叙事" }, { type: "案例" }, { type: "其他" }]).key === "narrative"
    && P.materialLabel([{ type: "论点" }, { type: "命题" }, { type: "叙事" }, { type: "背景" }]).key === "mixed"
    && P.materialLabel([]).key === "expository");
}

console.log("---- ⑦ S5 版式迟定一次 ----");
{
  const sel = (p, how = "rule") => ({ pattern: p, how, rule: how === "rule" ? 7 : null });
  // 一个任务：开始按提示 chain；流式中规则在 tree/grid/chain 间摇摆；结束复核为 tree
  let e;
  const seq = [];
  const run = (prop, streaming) => { const r = P.lockPattern(e, prop, { streaming, jobId: "j1" }); e = r.entry; seq.push(r.selection.pattern); };
  run(sel("chain", "hint"), true);
  run(sel("tree"), true); run(sel("grid"), true); run(sel("chain"), true);
  run(sel("tree"), false);
  run(sel("grid"), false); run(sel("chain"), false);
  const changes = seq.filter((p, i) => i && p !== seq[i - 1]).length;
  check("一个任务内变更 ≤1 次，结束后锁定", changes <= 1 && e.locked && seq.join() === "chain,chain,chain,chain,tree,tree,tree", seq);
  run(sel("compare", "manual"), false);
  check("手动可随时覆盖锁", seq[seq.length - 1] === "compare" && e.how === "manual");
  // 新任务：沿用旧版式起步，再允许一次复核
  let e2 = { pattern: "tree", how: "rule", rule: 7, jobId: "j1", changes: 1, locked: true };
  const r1 = P.lockPattern(e2, sel("chain"), { streaming: true, jobId: "j2" });
  const r2 = P.lockPattern(r1.entry, sel("chain"), { streaming: false, jobId: "j2" });
  check("新任务：起步沿用旧版式，结束复核一次", r1.selection.pattern === "tree" && r2.selection.pattern === "chain" && r2.entry.changes === 1 && r2.entry.locked);
  // 经 layoutGraph：组节点 streaming → open；锁表回传
  let s = sample();
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [{ ...s.nodes.E2, state: "streaming", jobId: "jx", patternHint: "chain" }, mk("E2a", "E2", "背景", "a")] });
  let locks = {};
  const pats = [];
  const step = (st) => { const d = L.layoutGraph(st, { locks }); locks = d.locks; pats.push(d.groups.E2 && d.groups.E2.selected); return d; };
  step(s);
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [mk("E2b", "E2", "背景", "b")] }); step(s);
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [{ ...s.nodes.E2, patternHint: null }] }); step(s); // 提示消失，规则会给 tree
  s = G.applyDelta(s, { mapId: "m1", kind: "states", states: [{ id: "E2", state: "open" }] }); step(s);
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [mk("E2c", "E2", "步骤", "c"), mk("E2d", "E2", "步骤", "d"), mk("E2e", "E2", "步骤", "e"), mk("E2f", "E2", "步骤", "f")] }); step(s); // 规则此时为 chain，但已锁
  const ch = pats.filter((p, i) => i && p !== pats[i - 1]).length;
  check("layoutGraph + locks：任务内变更 ≤1，结束后不再随规则漂移", ch <= 1 && pats[0] === "chain" && pats[1] === "chain" && pats[2] === "chain" && pats[3] === "tree" && pats[4] === "tree", pats);
  check("无 locks 时不锁（纯选择）", L.layoutGraph(s).groups.E2.selected === "chain" && L.layoutGraph(s).locks === undefined);
}

console.log("---- 框架扩展面（registerPattern / absorb / ctx.rel / places 校验） ----");
{
  // 一个最小 absorb 版式：每个子一栏，栏头 + 孙逐行；子间「比」关系由版式消化
  const cols = {
    key: "compare",
    absorb: true,
    layout(h, kids, ctx) {
      const places = [], items = [], edges = [];
      let x = 0;
      for (const k of kids) {
        let y = 0, w = k.w;
        places.push({ id: k.id, x, y }); y += k.h + 8;
        for (const c of k.cells ?? []) { places.push({ id: c.id, x, y }); y += c.h + 8; w = Math.max(w, c.w); }
        items.push({ id: "LN:" + k.id, kind: "lane", x, y: 0, w, h: y, nid: k.id });
        x += w + 56;
      }
      for (const e of ctx.siblingEdges) if (e.code === "比") edges.push(ctx.rel(e.from, e.to, e.code));
      return ctx.frame(h, { w: x - 56, h: Math.max(...items.map((i) => i.h)), items, places, edges });
    },
  };
  const builtinCompare = stable(L.layoutGraph(sample()));
  L.registerPattern(cols);
  const d = L.layoutGraph(sample());
  check("registerPattern 生效：D 组按 compare 渲染、无 fallback", d.groups.D.pattern === "compare" && d.groups.D.fallbackFrom === null && d.groups.D.framed);
  check("absorb：孙卡由父版式摆放、被吸收组记 absorbedBy", d.groups.D1.absorbedBy === "D" && d.groups.D1.kids.join() === "D1a,D1b" && d.byId.D1a && d.byId["LN:D1"]);
  check("ctx.rel 登记已消化关系（数据方向键）", d.consumed.includes("D2|D1|比") && d.edges.some((e) => e.kind === "rel" && e.code === "比" && e.group === "D"));
  check("absorb 布局仍不重叠", overlapIssues(d).length === 0 && onGrid(d));
  // S2 在 absorb 下：改 D2b 标题只重算其链
  const cache = L.createLayoutCache();
  const s0 = sample();
  const d0 = L.layoutGraph(s0, { cache });
  const s1 = G.applyDelta(s0, { mapId: "m1", kind: "nodes", nodes: [{ ...s0.nodes.D2b, title: "小数无限不循环（含 π）" }] });
  const d1 = L.layoutGraph(s1, { cache });
  check("absorb 下增量 ≡ 全量", stable(d1) === stable(L.layoutGraph(s1)));
  check("absorb 下链外子树不变（A/B/C/E）", ["A", "B", "C", "E"].every((id) => subtreeRel(d0, s0, id) === subtreeRel(d1, s1, id)));
  L.unregisterPattern("compare");
  check("unregister 后恢复内置 compare（T6 起不再回落 tree）", stable(L.layoutGraph(sample())) === builtinCompare && L.layoutGraph(sample()).groups.D.fallbackFrom === null);
  // 「据」关系画成 目标 → 本节点
  L.registerPattern({ key: "layered", layout(h, kids, ctx) {
    const places = []; let y = 0; for (const k of kids) { places.push({ id: k.id, x: 0, y }); y += k.h + 16; }
    const edges = ctx.siblingEdges.map((e) => ctx.rel(e.from, e.to, e.code));
    return ctx.frame(h, { w: Math.max(...kids.map((k) => k.w)), h: y - 16, items: [], places, edges });
  } });
  const s2 = G.setManualPattern(sample(), "B", "layered");
  const d2 = L.layoutGraph(s2);
  check("ctx.rel：「据」反转为 目标→本节点；未消化的跨组关系不在 consumed", d2.edges.some((e) => e.code === "据" && e.from === "B1" && e.to === "B2") && d2.consumed.includes("B2|B1|据") && !d2.consumed.includes("C4|B|据"));
  L.unregisterPattern("layered");
  // 版式漏摆子块 → 抛错（开发期即暴露）
  L.registerPattern({ key: "grid", layout(h, kids, ctx) { return ctx.frame(h, { w: 10, h: 10, items: [], places: kids.slice(1).map((k) => ({ id: k.id, x: 0, y: 0 })), edges: [] }); } });
  let threw = false;
  try { L.layoutGraph(G.setManualPattern(sample(), "E", "grid")); } catch (e) { threw = /not placed/.test(e.message); }
  check("places 漏摆子块抛错", threw);
  L.unregisterPattern("grid");
}

console.log("---- ⑧ 性能：2,000 节点单组变化重排（10 次中位） ----");
{
  let s = G.createGraph(bigLoad());
  const nodeCount = Object.keys(s.nodes).length;
  const cache = L.createLayoutCache();
  const d0 = L.layoutGraph(s, { cache });
  const visible = cards(d0).length;
  // 预热
  for (let i = 0; i < 5; i++) { s = G.applyDelta(s, { mapId: "big", kind: "nodes", nodes: [mk(`w${i}`, "t3.4.6", "例证", "预热 " + i)] }); L.layoutGraph(s, { cache }); }
  const times = [];
  let last;
  for (let i = 0; i < 10; i++) {
    const grp = `t${i % 8}.${(i * 3) % 10}.${(i * 7) % 12}`;
    s = G.applyDelta(s, { mapId: "big", kind: "nodes", nodes: [mk(`n${i}`, grp, "例证", "新增 " + i)] });
    const t0 = process.hrtime.bigint();
    last = L.layoutGraph(s, { cache });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const med = (times[4] + times[5]) / 2;
  // 全量参考
  const tf0 = process.hrtime.bigint(); L.layoutGraph(s); const full = Number(process.hrtime.bigint() - tf0) / 1e6;
  console.log(`      节点 ${nodeCount}，可见卡片 ${visible}；单组变化重排 10 次中位 ${med.toFixed(2)}ms（min ${times[0].toFixed(2)} / max ${times[9].toFixed(2)}），重算块 ${last.stats.recomputed}/${last.stats.visited}；无缓存全量 ${full.toFixed(2)}ms`);
  check(`2,000+ 节点（${nodeCount}）单组变化重排中位 ${med.toFixed(2)}ms ≤ 16ms`, nodeCount >= 2000 && visible >= 2000 && med <= 16, times);
  check("增量只重算脏链（≤ 深度 + 新叶）", last.stats.recomputed <= 6, last.stats);
  check("大图增量 ≡ 全量", stable(last) === stable(L.layoutGraph(s)));
}

// ════════════════════════════════════════════════════════════
// T6：其余五个版式（timeline / layered / argument / compare / grid）
// ════════════════════════════════════════════════════════════
function t6Load() {
  ordSeq = 0;
  const types = ["理由", "证据", "反方观点", "反驳", "理由", "例证"];
  const times = ["约前 530", "1872", "1000", "前 300", "公元 2", "现代"];
  const gtypes = ["证据", "要点", "要点", "证据", "证据", "要点"];
  const nodes = [
    mk("Q", null, "背景", "旁组", { state: "open" }), mk("Q1", "Q", "要点", "q1"), mk("Q2", "Q", "要点", "q2"),
    mk("P", null, "分类", "T6 组", { state: "open" }),
  ];
  for (let i = 0; i < 6; i++) {
    nodes.push(mk(`k${i}`, "P", types[i], `子块 ${i} 的标题文字`, { time: times[i], state: "open" }));
    nodes.push(mk(`k${i}a`, `k${i}`, gtypes[i], `属性甲 ${i}`));
    nodes.push(mk(`k${i}b`, `k${i}`, gtypes[(i + 1) % 6], `属性乙 ${i} 稍长一点的文字内容`));
  }
  const edges = [
    { from: "k1", to: "k0", code: "据" }, { from: "k2", to: "k1", code: "推" }, { from: "k4", to: "k2", code: "因" },
    { from: "k3", to: "k2", code: "驳" }, { from: "k5", to: "k4", code: "比" }, { from: "k1", to: "k5", code: "比" },
  ];
  return { meta: { mapId: "t6", title: "T6" }, nodes, edges, view: { patterns: {}, collapsed: [] } };
}
const t6 = (pat) => G.setManualPattern(G.createGraph(t6Load()), "P", pat);
console.log("---- T6 ⑨ 五个新版式：不重叠 / 4px / 确定性 / S2 / 无回落 ----");
for (const pat of ["timeline", "layered", "argument", "compare", "grid"]) {
  const s = t6(pat);
  const d = L.layoutGraph(s);
  check(`${pat}：P 组按该版式渲染、带框、无回落`, d.groups.P.pattern === pat && d.groups.P.framed && d.groups.P.fallbackFrom === null && d.byId["F:P"].pattern === pat, d.groups.P);
  const iss = overlapIssues(d);
  check(`${pat}：卡片两两不重叠、卡片在框内`, iss.length === 0, iss.slice(0, 5));
  check(`${pat}：全部坐标 4px 网格整数、id 唯一、组内边端点在画面`, onGrid(d) && new Set(d.items.map((i) => i.id)).size === d.items.length && d.edges.every((e) => d.byId[e.from] && d.byId[e.to]));
  const ref = stable(d);
  let same = true;
  for (let i = 0; i < 100; i++) if (stable(L.layoutGraph(s)) !== ref) { same = false; break; }
  let sameFresh = true;
  for (let i = 0; i < 100; i++) if (stable(L.layoutGraph(t6(pat))) !== ref) { sameFresh = false; break; }
  check(`${pat}：×100 逐字节一致（含重新建图）`, same && sameFresh);
  // S2：深挖 k2 的子 k2a；链外子树（Q 组、非链上的兄弟；对照因孙级同行耦合只验 Q）刚性不变，重算 ≤ 链长 + 新叶
  const cache = L.createLayoutCache();
  const d0 = L.layoutGraph(s, { cache });
  const s1 = G.applyDelta(s, { mapId: "t6", kind: "nodes", nodes: [mk("k2a1", "k2a", "证据", "深挖一"), mk("k2a2", "k2a", "证据", "深挖二")], states: [{ id: "k2a", state: "open" }] });
  const d1 = L.layoutGraph(s1, { cache });
  const chain = new Set([ROOT, "k2a", ...G.ancestors(s1, "k2a")]);
  const outside = G.visibleIds(s).filter((id) => id !== ROOT && !chain.has(id) && (pat === "compare" ? !["k0", "k1", "k2", "k3", "k4", "k5"].includes(id) && !/^k\d[ab]$/.test(id) : true));
  const bad = outside.filter((id) => subtreeRel(d0, s, id) !== subtreeRel(d1, s1, id));
  check(`${pat}：S2 链外 ${outside.length} 棵子树相对坐标不变`, bad.length === 0, bad);
  check(`${pat}：S2 只重算脏链（${d1.stats.recomputed}）`, d1.stats.recomputed <= chain.size + 3, d1.stats);
  check(`${pat}：增量 ≡ 全量`, stable(d1) === stable(L.layoutGraph(s1)));
}

console.log("---- T6 ⑩ 时间线 ----");
{
  const s = t6("timeline");
  const d = L.layoutGraph(s);
  const ks = ["k0", "k1", "k2", "k3", "k4", "k5"];
  const xs = ks.map((k) => d.byId[k].x);
  check("按原文顺序从左到右（时间文本并不单调）", xs.every((x, i) => !i || x > xs[i - 1]), xs);
  check("每个子一个 date（text＝timeText）与 tick，一条 axis", ks.every((k, i) => d.byId["DT:" + k] && d.byId["DT:" + k].text === ["约前 530", "1872", "1000", "前 300", "公元 2", "现代"][i] && d.byId["TK:" + k] && d.byId["DT:" + k].kind === "date")
    && d.byId["AX:P"] && d.byId["AX:P"].kind === "axis" && d.items.filter((i) => i.kind === "axis" && i.nid === "P").length === 1);
  check("date 在子块上方、tick 对准子块锚点中线、axis 覆盖全部子块", ks.every((k) => d.byId["DT:" + k].y + d.byId["DT:" + k].h <= d.byId[k].y && d.byId["TK:" + k].x <= d.byId[k].x + d.byId[k].w / 2 + 4 && d.byId["TK:" + k].x + 4 >= d.byId[k].x)
    && d.byId["AX:P"].x <= d.byId.k0.x && d.byId["AX:P"].x + d.byId["AX:P"].w >= d.byId.k5.x + d.byId.k5.w);
  check("样张 A（叙事+时间）为时间线、4 个 date", d.byId["DT:A1"] === undefined && L.layoutGraph(sample()).items.filter((i) => i.kind === "date").length === 4);
  // LOD：>12 子时「另有 N 项」在末尾且无 date/tick
  ordSeq = 0;
  const nodes = [mk("T", null, "背景", "多事件", { state: "open", hint: "timeline" })];
  for (let i = 0; i < 15; i++) nodes.push(mk("T" + String(i).padStart(2, "0"), "T", "叙事", "事件 " + i, { time: String(1900 + i) }));
  const dl = L.layoutGraph(G.createGraph({ meta: { mapId: "tl", title: "TL" }, nodes, edges: [], view: null }));
  check("LOD：「另有 N 项」在最右、无 date/tick", dl.byId["MORE:T"].x > dl.byId.T06.x && !dl.byId["DT:MORE:T"] && !dl.byId["TK:MORE:T"] && dl.items.filter((i) => i.kind === "date").length === 7);
}

console.log("---- T6 ⑪ 论证图 ----");
{
  const d = L.layoutGraph(sample());
  const c3 = d.byId.C3, c4 = d.byId.C4;
  check("反驳 C4 位于其针对的反方 C3 下方（y 更大、水平居中对齐）", c4.y >= c3.y + c3.h + 4 && Math.abs((c4.x + c4.w / 2) - (c3.x + c3.w / 2)) <= 4, [c3, c4]);
  check("支持方在左、反方在右（C1 < C2 < C3）", d.byId.C1.x < d.byId.C2.x && d.byId.C2.x < d.byId.C3.x);
  check("论点居中在上（C 在框内水平居中、y 小于子块）", d.byId.C.y < d.byId.C1.y && Math.abs((d.byId.C.x + d.byId.C.w / 2) - (d.byId["F:C"].x + d.byId["F:C"].w / 2)) <= 4);
  const imp = d.edges.filter((e) => e.group === "C" && e.implicit);
  check("向上隐含线：C1/C2 → C 为「支」、C3 → C 为「驳」，implicit=true、未被消化", imp.length === 3 && imp.every((e) => e.to === "C" && e.kind === "rel")
    && imp.find((e) => e.from === "C3").code === "驳" && imp.find((e) => e.from === "C1").code === "支" && !d.consumed.some((k) => k.startsWith("C1|C|")));
  check("驳 关系（C4→C3）经 ctx.rel 消化；C4 据 B 是跨组关系，未消化", d.consumed.includes("C4|C3|驳") && !d.consumed.includes("C4|B|据") && d.edges.some((e) => e.kind === "rel" && e.from === "C4" && e.to === "C3" && !e.implicit));
  check("同版式嵌套并框：C1 下的证据无自己的框，在 F:C 内", !d.byId["F:C1"] && d.groups.C1.framed === false && d.groups.C1.pattern === "argument" && d.byId.C1a && d.byId.C1a.group === "C" && d.byId.C1a.y > d.byId.C1.y);
  check("tf 错开终点分位（0..1，互不相同）", (() => { const t = imp.map((e) => e.tf); return t.every((v) => v > 0 && v < 1) && new Set(t).size === t.length; })());
  // 多条反驳叠放 + 无目标反驳
  let s = sample();
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [mk("C5", "C", "反驳", "又一条反驳，文字相当长以致比反方更宽出一截来测试"), mk("C6", "C", "反驳", "无目标的反驳")], edges: [{ from: "C5", to: "C3", code: "驳" }] });
  const d2 = L.layoutGraph(s);
  check("同一反方下多条反驳向下叠放且不重叠；无目标反驳也不重叠", overlapIssues(d2).length === 0 && d2.byId.C5.y >= d2.byId.C4.y + d2.byId.C4.h + 4 && d2.byId.C5.y >= d2.byId.C3.y + d2.byId.C3.h + 4 && d2.byId.C6.y > d2.byId.C3.y, [d2.byId.C4, d2.byId.C5, d2.byId.C6]);
  // 只有反驳（无第一行）
  ordSeq = 0;
  const sr = G.createGraph({ meta: { mapId: "ar", title: "AR" }, nodes: [mk("R", null, "论点", "只有反驳", { state: "open", hint: "argument" }), mk("R1", "R", "反驳", "单独反驳")], edges: [], view: null });
  check("仅有反驳的论点组不抛错且不重叠", (() => { const dd = L.layoutGraph(sr); return overlapIssues(dd).length === 0 && !!dd.byId.R1; })());
}

console.log("---- T6 ⑫ 对照 ----");
{
  const d = L.layoutGraph(sample());
  check("同行同维度 y 对齐（D1a/D2a、D1b/D2b、栏头 D1/D2）", d.byId.D1a.y === d.byId.D2a.y && d.byId.D1b.y === d.byId.D2b.y && d.byId.D1.y === d.byId.D2.y && d.byId.D1b.y > d.byId.D1a.y && d.byId.D1a.y > d.byId.D1.y);
  check("栏左右排列、各一条 lane，栏间 vs（比）经 ctx.rel 消化", d.byId.D2.x > d.byId.D1.x + d.byId.D1.w && d.byId["LN:D1"] && d.byId["LN:D2"] && d.consumed.includes("D2|D1|比") && d.edges.some((e) => e.kind === "rel" && e.code === "比" && e.group === "D"));
  check("absorb：D1/D2 记 absorbedBy D，孙卡在 lane 内", d.groups.D1.absorbedBy === "D" && d.groups.D2.absorbedBy === "D" && inside(d.byId.D1a, d.byId["LN:D1"]) && inside(d.byId.D2b, d.byId["LN:D2"]) && inside(d.byId.D1, d.byId["LN:D1"]));
  // 行高不等（某格带子树/框）仍同行对齐
  let s = sample();
  s = G.applyDelta(s, { mapId: "m1", kind: "nodes", nodes: [mk("D1a1", "D1a", "要点", "子要点一"), mk("D1a2", "D1a", "要点", "子要点二"), mk("D1a3", "D1a", "要点", "子要点三")], states: [{ id: "D1a", state: "open" }] });
  const d2 = L.layoutGraph(s);
  check("某格长出子树后：D1a/D2a 仍同 y，下一行 D1b/D2b 同 y 且在其下方", d2.byId.D1a.y === d2.byId.D2a.y && d2.byId.D1b.y === d2.byId.D2b.y && d2.byId.D1b.y >= d2.byId.D1a1.y + d2.byId.D1a1.h && overlapIssues(d2).length === 0, [d2.byId.D1a, d2.byId.D2a, d2.byId.D1b, d2.byId.D2b]);
  // 三栏、行数不等
  const dt = L.layoutGraph(t6("compare"));
  check("六栏：同序号行 y 对齐（k*a 同 y、k*b 同 y），无孙的栏不影响", ["k0", "k1", "k2", "k3", "k4", "k5"].every((k) => dt.byId[k + "a"].y === dt.byId.k0a.y && dt.byId[k + "b"].y === dt.byId.k0b.y && dt.byId[k].y === dt.byId.k0.y));
  // 栏数不同的比较：加一个无孙的栏
  const s3 = G.applyDelta(sample(), { mapId: "m1", kind: "nodes", nodes: [mk("D3", "D", "分类", "第三类（无属性）")] });
  const d3 = L.layoutGraph(s3);
  check("带无孙栏：不抛错、不重叠、栏头同 y", overlapIssues(d3).length === 0 && d3.byId.D3.y === d3.byId.D1.y && onGrid(d3));
}

console.log("---- T6 ⑬ 网格 ----");
{
  const ok = [];
  for (const n of [2, 3, 4, 5, 7, 9, 10, 12]) {
    ordSeq = 0;
    const nodes = [mk("Gp", null, "分类", "网格组", { state: "open", hint: "grid" })];
    for (let i = 0; i < n; i++) nodes.push(mk("g" + String(i).padStart(2, "0"), "Gp", "要点", "格子 " + "字".repeat(1 + (i % 4) * 2)));
    const d = L.layoutGraph(G.createGraph({ meta: { mapId: "gr", title: "GR" }, nodes, edges: [], view: null }));
    const ids = nodes.slice(1).map((x) => x.id);
    const colsSeen = new Set(ids.map((i) => d.byId[i].x)).size;
    const want = Math.ceil(Math.sqrt(n));
    const stepOk = (() => { const xs = [...new Set(ids.map((i) => d.byId[i].x))].sort((a, b) => a - b); return xs.every((x, i) => !i || x - xs[i - 1] === xs[1] - xs[0]); })();
    const rowsOk = new Set(ids.map((i) => d.byId[i].y)).size === Math.ceil(n / want);
    ok.push([n, colsSeen === want && stepOk && rowsOk && d.groups.Gp.pattern === "grid" && overlapIssues(d).length === 0, colsSeen, want]);
  }
  check("列数 = ⌈√n⌉、列距相等、行数 = ⌈n/列⌉（n=2..12）", ok.every((r) => r[1]), ok.filter((r) => !r[1]));
  const d = L.layoutGraph(t6("grid"));
  check("原文顺序行优先：k0..k5 为 3 列 2 行", d.byId.k0.x < d.byId.k1.x && d.byId.k1.x < d.byId.k2.x && d.byId.k3.x === d.byId.k0.x && d.byId.k3.y > d.byId.k0.y && d.byId.k0.y === d.byId.k2.y);
}

console.log("---- T6 ⑭ 分层图 ----");
{
  const d = L.layoutGraph(G.setManualPattern(sample(), "B", "layered"));
  const y = (id) => d.byId[id].y;
  check("据/推/因 最长路自上而下（B1 < B2 < B3 < B5 < B6 的 y；B4 无前驱与 B1 同在第 0 层）", y("B1") < y("B2") && y("B2") < y("B3") && y("B3") < y("B5") && y("B5") < y("B6") && y("B4") === y("B1") && y("B4") < y("B5"));
  check("流边画成 前提→结论（「据」反转）且已消化", d.edges.some((e) => e.group === "B" && e.kind === "rel" && e.from === "B1" && e.to === "B2" && e.code === "据") && d.consumed.includes("B2|B1|据"));
  check("多边汇入同一卡片时 tf 错开（B5 有 B3、B4 两入边）", (() => { const t = d.edges.filter((e) => e.group === "B" && e.to === "B5").map((e) => e.tf); return t.length === 2 && t[0] !== t[1] && t.every((v) => v > 0 && v < 1); })());
  // 重心法：下层按前驱中心排序
  ordSeq = 0;
  const nodes = [mk("Y", null, "命题", "重心", { state: "open", hint: "layered" }),
    mk("X1", "Y", "前提", "前提一前提一前提一前提一"), mk("X2", "Y", "前提", "前提二"), mk("X3", "Y", "前提", "前提三"),
    mk("Z1", "Y", "推导", "推出一"), mk("Z2", "Y", "推导", "推出二")];
  const edges = [{ from: "Z1", to: "X3", code: "据" }, { from: "Z2", to: "X1", code: "据" }];
  const db = L.layoutGraph(G.createGraph({ meta: { mapId: "bc", title: "BC" }, nodes, edges, view: null }));
  check("重心法：Z2（前驱 X1 在左）排到 Z1（前驱 X3 在右）左侧；无前驱的 X2 仍在第 0 层", db.byId.Z2.x < db.byId.Z1.x && db.byId.X2.y === db.byId.X1.y && db.byId.Z1.y > db.byId.X1.y);
  // 有环：a→b→c→a
  const cyc = () => {
    ordSeq = 0;
    return G.createGraph({ meta: { mapId: "cy", title: "CY" }, nodes: [mk("Cy", null, "命题", "环", { state: "open", hint: "layered" }), mk("a", "Cy", "推导", "甲"), mk("b", "Cy", "推导", "乙"), mk("c", "Cy", "推导", "丙"), mk("e", "Cy", "推导", "丁"), mk("sf", "Cy", "推导", "自环")],
      edges: [{ from: "a", to: "b", code: "推" }, { from: "b", to: "c", code: "推" }, { from: "c", to: "a", code: "推" }, { from: "c", to: "e", code: "因" }, { from: "sf", to: "sf", code: "推" }], view: null });
  };
  const dc = L.layoutGraph(cyc());
  const ref = stable(dc);
  let same = true;
  for (let i = 0; i < 100; i++) if (stable(L.layoutGraph(cyc())) !== ref) { same = false; break; }
  check("有环：不抛错、×100 确定性、按原文顺序断环（a 在 b 上、b 在 c 上，回边 c→a 仍画出）", same && dc.byId.a.y < dc.byId.b.y && dc.byId.b.y < dc.byId.c.y && dc.byId.e.y > dc.byId.c.y
    && dc.edges.some((e) => e.kind === "rel" && e.from === "c" && e.to === "a") && overlapIssues(dc).length === 0 && onGrid(dc));
  check("有环：自环不画、不消化", !dc.edges.some((e) => e.from === "sf" && e.to === "sf") && !dc.consumed.includes("sf|sf|推"));
  // 全环（无源点）
  ordSeq = 0;
  const full = G.createGraph({ meta: { mapId: "f", title: "F" }, nodes: [mk("F", null, "命题", "全环", { state: "open", hint: "layered" }), mk("f1", "F", "推导", "1"), mk("f2", "F", "推导", "2"), mk("f3", "F", "推导", "3")],
    edges: [{ from: "f1", to: "f2", code: "推" }, { from: "f2", to: "f3", code: "推" }, { from: "f3", to: "f1", code: "推" }], view: null });
  const df = L.layoutGraph(full);
  check("全环（无源点）：f1<f2<f3 层序", df.byId.f1.y < df.byId.f2.y && df.byId.f2.y < df.byId.f3.y);
}

console.log("---- T6 ⑮ 性能：新版式 ----");
{
  const pats = ["timeline", "grid", "argument", "layered", "compare"];
  const load = bigLoad();
  for (const n of load.nodes) {
    const m = /^t\d+\.(\d+)$/.exec(n.id);
    if (m) n.patternHint = pats[Number(m[1]) % 5];
  }
  load.meta = { mapId: "big6", title: "大图 T6" };
  let s = G.createGraph(load);
  const nodeCount = Object.keys(s.nodes).length;
  const cache = L.createLayoutCache();
  const d0 = L.layoutGraph(s, { cache });
  check("2,000+ 节点图：新版式组均按版式渲染", ["timeline", "grid", "argument", "layered", "compare"].every((p) => Object.values(d0.groups).some((g) => g.pattern === p && g.fallbackFrom === null)) && overlapIssues(d0).length === 0 && onGrid(d0));
  for (let i = 0; i < 5; i++) { s = G.applyDelta(s, { mapId: "big6", kind: "nodes", nodes: [mk(`w${i}`, "t3.4.6", "例证", "预热 " + i)] }); L.layoutGraph(s, { cache }); }
  const times = [];
  let last;
  for (let i = 0; i < 10; i++) {
    // 变化落在 timeline / grid / argument / layered / compare 各组的某个小节里
    const sec = `t${i % 8}.${i % 5 === 0 ? 0 : i % 5 === 1 ? 1 : i % 5 === 2 ? 2 : i % 5 === 3 ? 3 : 4}`;
    const grp = `${sec}.${(i * 7) % 12}`;
    s = G.applyDelta(s, { mapId: "big6", kind: "nodes", nodes: [mk(`n${i}`, grp, "例证", "新增 " + i)] });
    const t0 = process.hrtime.bigint();
    last = L.layoutGraph(s, { cache });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const med = (times[4] + times[5]) / 2;
  console.log(`      节点 ${nodeCount}（五种新版式混排）；单组变化重排 10 次中位 ${med.toFixed(2)}ms（min ${times[0].toFixed(2)} / max ${times[9].toFixed(2)}），重算块 ${last.stats.recomputed}/${last.stats.visited}`);
  check(`2,000+ 节点（${nodeCount}）新版式混排单组重排中位 ${med.toFixed(2)}ms ≤ 16ms`, nodeCount >= 2000 && med <= 16, times);
  check("新版式增量只重算脏链；增量 ≡ 全量", last.stats.recomputed <= 8 && stable(last) === stable(L.layoutGraph(s)), last.stats);
  // 单组 2,000 子（LOD 展开）：每个版式一次全量布局，防二次复杂度
  const flat = (pat) => {
    ordSeq = 0;
    const nodes = [mk("Fl", null, "分类", "平铺", { state: "open", hint: pat })];
    const edges = [];
    for (let i = 0; i < 2000; i++) {
      nodes.push(mk("f" + String(i).padStart(4, "0"), "Fl", i % 7 === 3 ? "反驳" : i % 11 === 5 ? "反方观点" : "要点", "项 " + i, { time: String(1000 + i), state: "floor" }));
      if (i) edges.push({ from: "f" + String(i).padStart(4, "0"), to: "f" + String(i - 1 - (i % 3)).padStart(4, "0"), code: i % 3 ? "据" : "比" });
    }
    return G.createGraph({ meta: { mapId: "fl", title: "FL" }, nodes, edges, view: null });
  };
  const flatTimes = {};
  for (const p of pats) {
    const fs = flat(p);
    const t0 = process.hrtime.bigint();
    const dd = L.layoutGraph(fs, { lodExpanded: ["Fl"] });
    flatTimes[p] = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!dd.byId.f1999) flatTimes[p] = Infinity;
  }
  console.log(`      单组 2,000 子全量布局（ms）：${pats.map((p) => `${p} ${flatTimes[p].toFixed(1)}`).join(" / ")}`);
  check("单组 2,000 子（含关系边）各版式全量布局均 ≤ 200ms（无二次复杂度）", pats.every((p) => flatTimes[p] <= 200), flatTimes);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
