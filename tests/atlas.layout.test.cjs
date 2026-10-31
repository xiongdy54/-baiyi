// @runtime: node
// 结构全景（D254 v2）纯逻辑回归：docs/design/STRUCTURE-ATLAS-D254.md §16.1（19 条）。
const path = require("path");
require("./lib/tsload.cjs");
const root = path.join(__dirname, "..");
const A = require(path.join(root, "src", "lib", "flow", "atlasLayout.ts"));
const G = require(path.join(root, "src", "lib", "mindmap", "v2", "graph.ts"));
const L = require(path.join(root, "src", "lib", "flow", "layout.ts"));
const { ROOT_ID } = require(path.join(root, "src", "lib", "mindmap", "v2", "types.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 900)}`); }
}
const AL = A.AL;
const close = (a, b, eps = 1) => Math.abs(a - b) <= eps;

const node = (id, parentId, ord, title, type, extra) => Object.assign({
  id, parentId, ord, title, type, timeText: null, patternHint: null, blockStart: 1, blockEnd: 1, spans: null,
  state: "open", source: "ai", warnings: null, explain: null, jobId: null,
}, extra || {});
const graph = (nodes, edges) => G.createGraph({ meta: { title: "材料", mapId: "m1", schemaVersion: 2 }, nodes, edges, view: null }, "m1");
const edge = (from, to, code) => ({ from, to, code, origin: "text", weight: 1 });

// ---------------------------------------------------------------- 夹具（§16.1）
const nodes = [], edges = [];
const add = (n) => nodes.push(n);
add(node("A", null, 0, "A", "分类"));
add(node("a1", "A", 0, "a1", "其他", { blockStart: 1, blockEnd: 1 }));
add(node("a2", "A", 1, "a2", "其他", { blockStart: 2, blockEnd: 4 }));
add(node("a3", "A", 2, "a3", "其他", { blockStart: 5, blockEnd: 5 }));
add(node("B", null, 1, "B 论证", "论点", { patternHint: "argument" }));
add(node("b1", "B", 0, "b1 理由", "理由"));
add(node("b2", "B", 1, "b2 理由", "理由"));
add(node("b3", "B", 2, "b3 证据", "证据"));
add(node("b4", "B", 3, "b4 例证", "例证"));
add(node("b5", "B", 4, "b5 反方", "反方观点"));
add(node("b6", "B", 5, "b6 反驳", "反驳"));
edges.push(edge("b3", "b1", "支"), edge("b3", "b2", "支"), edge("b4", "b1", "例"), edge("b6", "b5", "驳"));
add(node("C", null, 2, "C 时间线", "叙事", { patternHint: "timeline" }));
["c1", "c2", "c3", "c4", "c5", "c6"].forEach((id, i) => add(node(id, "C", i, `事件${i + 1}`, "叙事", { timeText: ["1945年", "1949年", "1950年", "1958年", "1978年", "1992年"][i] })));
add(node("D", null, 3, "D 步骤", "步骤", { patternHint: "chain" }));
["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"].forEach((id, i) => add(node(id, "D", i, id, "步骤")));
add(node("E", null, 4, "E 因果", "因果", { patternHint: "layered" }));
["e1", "e2", "e3", "e4", "e5"].forEach((id, i) => add(node(id, "E", i, id, "因果")));
edges.push(edge("e1", "e3", "因"), edge("e2", "e3", "因"), edge("e3", "e4", "因"), edge("e4", "e5", "因"), edge("e2", "e5", "因"));
add(node("F", null, 5, "F 对照", "对比", { patternHint: "compare" }));
add(node("f1", "F", 0, "对象一", "其他"));
add(node("f2", "F", 1, "对象二", "其他"));
["目的", "路径", "姿态"].forEach((d, i) => {
  add(node(`f1${i}`, "f1", i, `${d}：甲${i}`, "其他"));
  add(node(`f2${i}`, "f2", i, `${d}：乙${i}`, "其他"));
});
add(node("G", null, 6, "G 并列", "分类", { patternHint: "grid" }));
["g1", "g2", "g3", "g4", "g5", "g6", "g7"].forEach((id, i) => add(node(id, "G", i, `并列${i + 1}`, "其他")));
add(node("H", null, 7, "H 大组", "其他"));
for (let i = 0; i < 50; i++) add(node(`h${i}`, "H", i, `项${i}`, "其他"));

const g = graph(nodes, edges);
const ALL = new Set(nodes.filter((n) => nodes.some((k) => k.parentId === n.id)).map((n) => n.id));
const COLORS = {
  dark: false, bg: "#fafaf8", fg: "#0a0a0a", accent: "#166a59", accentOn: "#ffffff", hairline: "#cccccc", counter: "#b5483b",
  palette: ["#6E7F2E", "#A9821C", "#A84A80", "#3E8A82", "#3F68A8", "#6F5FB0", "#A44836", "#B2662A"],
  aHL: [0.16, 0.26, 0.38], aEnd: [0.34, 0.52, 0.6], aDim: 0.3, strandA: 0.62,
};
const O = {
  colors: COLORS, rootTitle: "材料", expanded: ALL, showAll: new Set(), readingId: null,
  patternLabel: (p) => p, rootMeta: (n) => `全文 · ${n} 节`, moreLabel: (n) => `另 ${n} 项`, counterLabel: "反方一侧", otherLabel: "其他",
};
const sc = A.buildAtlas(g, O);
const gl = (id) => sc.byNode.get(id);

// ---------------------------------------------------------------- 1 确定性
console.log("---- 1 确定性 ----");
{
  const a = JSON.stringify(A.buildAtlas(g, O).glyphs) + JSON.stringify(A.buildAtlas(g, O).edges) + JSON.stringify(A.buildAtlas(g, O).decos);
  const b = JSON.stringify(A.buildAtlas(g, O).glyphs) + JSON.stringify(A.buildAtlas(g, O).edges) + JSON.stringify(A.buildAtlas(g, O).decos);
  check("同输入 buildAtlas 两次完全一致", a === b);
}

// ---------------------------------------------------------------- 2 不重叠
console.log("---- 2 字形不重叠 ----");
{
  const bad = [];
  for (let i = 0; i < sc.glyphs.length; i++) for (let j = i + 1; j < sc.glyphs.length; j++) {
    const a = sc.glyphs[i], b = sc.glyphs[j];
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 1 && h > 1) bad.push([a.id, b.id, w, h]);
  }
  check("任意两个字形盒交集面积为 0（1px 容差）", bad.length === 0, bad.slice(0, 5));
}

// ---------------------------------------------------------------- 3 每节点一字形 + more:H
console.log("---- 3 字形覆盖 / 另 N 项 ----");
{
  const hiddenByMore = new Set(nodes.filter((n) => n.parentId === "H").slice(AL.MORE_SHOW).map((n) => n.id));
  const visible = [ROOT_ID, ...nodes.filter((n) => n.parentId === null || (ALL.has(n.parentId) && !hiddenByMore.has(n.id))).map((n) => n.id)];
  const counts = new Map();
  for (const x of sc.glyphs) if (x.nodeId) counts.set(x.nodeId, (counts.get(x.nodeId) || 0) + 1);
  const missing = visible.filter((id) => !counts.has(id));
  const dup = [...counts].filter(([, n]) => n > 1);
  const more = sc.byId.get("more:H");
  check("每个可见节点恰好一个字形", missing.length === 0 && dup.length === 0, { missing, dup });
  check("more:H 存在且 moreCount = 50 − 18 = 32", !!more && more.moreCount === 32, more);
}

// ---------------------------------------------------------------- 4 版式识别
console.log("---- 4 patternOf ----");
{
  const want = { A: "tree", B: "argument", C: "timeline", D: "chain", E: "layered", F: "compare", G: "grid", H: "grid" };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, sc.patternOf.get(k)]));
  check("A→tree、B→argument、C→timeline、D→chain、E→layered、F→compare、G→grid、H→grid", Object.keys(want).every((k) => got[k] === want[k]), got);
}

// ---------------------------------------------------------------- 5 扇形流带
console.log("---- 5 扇形树枝（D254 修订：细曲线取代流带） ----");
{
  const fans = sc.edges.filter((e) => e.kind === "fan" && e.from === "A");
  const ga = gl("A");
  const allPath = fans.every((e) => e.geom.t === "path" && e.geom.p.length === 8);
  const sameStart = fans.every((e) => close(e.geom.p[0], ga.x + ga.w + A.AL.FAN_PORT, 0.5) && close(e.geom.p[1], ga.y + ga.h / 2, 0.5));
  const ends = fans.every((e) => { const t = gl(e.to); return close(e.geom.p[6], t.x - A.AL.FAN_PORT, 0.5) && close(e.geom.p[7], t.y + t.h / 2, 0.5); });
  check("3 条 fan 都是细曲线（path），不是流带", fans.length === 3 && allPath, fans.map((e) => e.geom.t));
  check("树枝从父节点右缘同一点发出", sameStart);
  check("树枝收束在子节点左缘中线", ends);
  check("没有任何 ribbon 几何", sc.edges.every((e) => e.geom.t !== "ribbon"));
}

// ---------------------------------------------------------------- 6 论证
console.log("---- 6 论证 ----");
{
  const argEdges = sc.edges.filter((e) => e.id.startsWith("arg:") && e.from === "b3");
  const b1 = gl("b1"), b2 = gl("b2"), b3 = gl("b3"), b5 = gl("b5"), b6 = gl("b6"), B = gl("B");
  const main = ["b1", "b2", "b3", "b4"].map(gl);
  const right = Math.max(...main.map((x) => x.x + x.w));
  const l1 = [b1, b2];
  const l1c = (Math.min(...l1.map((x) => x.x)) + Math.max(...l1.map((x) => x.x + x.w))) / 2;
  const cz = sc.decos.find((d) => d.id === "cz:B");
  check("b3 有两条 arg 边（到 b1、到 b2）", argEdges.length === 2 && argEdges.some((e) => e.to === "b1") && argEdges.some((e) => e.to === "b2"), argEdges.map((e) => e.id));
  check("B 字形 kind=claim，x 中心 ≈ 第 1 层主区中心（±1）", B.kind === "claim" && close(B.x + B.w / 2, l1c, 1), { kind: B.kind, cx: B.x + B.w / 2, want: l1c });
  check("b3 y > b1、b2 的 y", b3.y > b1.y && b3.y > b2.y, { b3: b3.y, b1: b1.y, b2: b2.y });
  check("b5、b6 的 x 都大于主区右缘 + ARG_COUNTER_GAP − 1", b5.x > right + AL.ARG_COUNTER_GAP - 1 && b6.x > right + AL.ARG_COUNTER_GAP - 1, { b5: b5.x, b6: b6.x, right });
  check("存在 cz:B 反方区 deco", !!cz, cz);
  check("consumed 含 b3>b1>支、b6>b5>驳", sc.consumed.has("b3>b1>支") && sc.consumed.has("b6>b5>驳"), [...sc.consumed].filter((k) => /^b/.test(k)));
}

// ---------------------------------------------------------------- 7 无环保护
console.log("---- 7 论证断环 ----");
{
  const cyc = graph(
    nodes.map((n) => ({ ...n })),
    [...edges, edge("b1", "b2", "支"), edge("b2", "b1", "支")],
  );
  let s2 = null, err = null;
  try { s2 = A.buildAtlas(cyc, O); } catch (e) { err = String(e && e.message); }
  check("加 b1⇄b2 后不抛错、不死循环", !!s2 && !err, err);
  check("被断开的那条不在 consumed", !!s2 && !s2.consumed.has("b2>b1>支"), s2 && [...s2.consumed].filter((k) => /^b[12]>b[12]>/.test(k)));
}

// ---------------------------------------------------------------- 8 时间线
console.log("---- 8 时间线 ----");
{
  const dot = (id) => sc.decos.find((d) => d.id === `dot:${id}`);
  const cx = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => dot(id).cx);
  const inc = cx.every((v, i) => i === 0 || v > cx[i - 1]);
  const gap = (a, b) => dot(b).cx - dot(a).cx;
  const above = ["c1", "c3", "c5"].every((id) => gl(id).y + gl(id).h < dot(id).cy);
  const below = ["c2", "c4", "c6"].every((id) => gl(id).y > dot(id).cy);
  check("6 个光点 cx 严格递增", inc, cx);
  check("1958→1978（20 年）间距 > 1945→1949（4 年）", gap("c4", "c5") > gap("c1", "c2"), { g20: gap("c4", "c5"), g4: gap("c1", "c2") });
  check("上方事件字形底 < 轴 y；下方字形顶 > 轴 y", above && below);
}

// ---------------------------------------------------------------- 9 时间线泳道公式
console.log("---- 9 时间线泳道公式 ----");
{
  const axisY = sc.decos.find((d) => d.k === "circle" && d.id.startsWith("dot:")).cy;
  const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const above = ids.filter((id) => gl(id).y + gl(id).h < axisY);
  const below = ids.filter((id) => gl(id).y > axisY);
  const dist = (id) => above.includes(id) ? axisY - (gl(id).y + gl(id).h) : gl(id).y - axisY;
  const lane0 = (list) => list.filter((id) => close(dist(id), AL.TL_STEM, 0.01));
  const ha = Math.max(0, ...lane0(above).map((id) => gl(id).h));
  const hb = Math.max(0, ...lane0(below).map((id) => gl(id).h));
  const allow = (list, h0) => list.every((id) => close(dist(id), AL.TL_STEM, 0.01) || close(dist(id), AL.TL_STEM + h0 + AL.TL_LANE_GAP, 0.01));
  check("上方块底到轴距离 = TL_STEM + Σ(前序泳道高 + 12)", above.length > 0 && allow(above, ha), above.map((id) => dist(id)));
  check("下方块顶到轴距离 = TL_STEM + Σ(前序泳道高 + 12)", below.length > 0 && allow(below, hb), below.map((id) => dist(id)));
}

// ---------------------------------------------------------------- 10 时间线断层
console.log("---- 10 断层压缩 ----");
{
  const times = ["1900", "1901", "1902", "1903", "2000", "2001"];
  const g2 = graph(nodes.map((n) => (n.parentId === "C" ? { ...n, timeText: times[Number(n.id.slice(1)) - 1] } : n)), edges);
  const s2 = A.buildAtlas(g2, O);
  const dot = (id) => s2.decos.find((d) => d.id === `dot:${id}`).cx;
  const brk = s2.decos.find((d) => d.id === "brk:C:3");
  check("存在 brk:C:3", !!brk, s2.decos.filter((d) => d.id && d.id.startsWith("brk:")).map((d) => d.id));
  check("第 4→5 段间距 = 72", close(dot("c5") - dot("c4"), AL.TL_BREAK_W, 0.01), dot("c5") - dot("c4"));
}

// ---------------------------------------------------------------- 11 步骤
console.log("---- 11 步骤蛇形 ----");
{
  const disc = (id) => sc.decos.find((d) => d.id === `disc:${id}`);
  const seqs = sc.edges.filter((e) => e.kind === "seq");
  const row1 = ["d1", "d2", "d3", "d4", "d5"].map((id) => disc(id).cx);
  const row2 = ["d6", "d7", "d8"].map((id) => disc(id).cx);
  const inc = row1.every((v, i) => i === 0 || v > row1[i - 1]);
  const dec = row2.every((v, i) => i === 0 || v < row2[i - 1]);
  const e = sc.edges.find((x) => x.id === "seq:d5>d6");
  const p = e.geom.p;
  const uTurn = p[2] === p[4] && p[2] > Math.max(...row1);
  check("8 个 disc、7 条 seq", sc.decos.filter((d) => d.id.startsWith("disc:")).length === 8 && seqs.length === 7, { disc: sc.decos.filter((d) => d.id.startsWith("disc:")).length, seq: seqs.length });
  check("第 1 行 5 个 cx 递增、第 2 行 3 个递减", inc && dec, { row1, row2 });
  check("seq:d5>d6 是 U 形（两个控制点同 x 且大于第 1 行最大 cx）", uTurn, p);
}

// ---------------------------------------------------------------- 12 因果
console.log("---- 12 因果分层 ----");
{
  const x = (id) => gl(id).x;
  const cols = [["e1", "e2"], ["e3"], ["e4"], ["e5"]].map((ids) => new Set(ids.map(x)).size === 1 ? x(ids[0]) : NaN);
  const ordered = cols.every((v, i) => !Number.isNaN(v) && (i === 0 || v > cols[i - 1]));
  const ly = sc.edges.filter((e) => e.id.startsWith("ly:"));
  const dir = ly.every((e) => e.geom.p[0] < e.geom.p[6]);
  const consumed = ["e1>e3>因", "e2>e3>因", "e3>e4>因", "e4>e5>因", "e2>e5>因"].every((k) => sc.consumed.has(k));
  check("列号 e1=e2=0、e3=1、e4=2、e5=3", ordered, cols);
  check("所有 ly 边起点 x < 终点 x", dir, ly.map((e) => [e.geom.p[0], e.geom.p[6]]));
  check("consumed 含全部 5 条", consumed);
}

// ---------------------------------------------------------------- 13 对照
console.log("---- 13 对照表 ----");
{
  const bands = sc.decos.filter((d) => d.id.startsWith("band:"));
  const dims = sc.decos.filter((d) => d.k === "text" && d.id.startsWith("dim:F:"));
  const prefix = ["f10", "f11", "f12", "f20", "f21", "f22"].filter((id) => gl(id) && gl(id).lines.join("").includes("目的："));
  check("2 个 band、3 个 dim 文字（目的/路径/姿态）", bands.length === 2 && dims.length === 3 && dims.map((d) => d.text).join() === "目的,路径,姿态", { bands: bands.length, dims: dims.map((d) => d.text) });
  check("单元格字形文字不含「目的：」前缀", prefix.length === 0, prefix);
}

// ---------------------------------------------------------------- 14 网格
console.log("---- 14 网格 ----");
{
  const tiles = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"].map(gl);
  const w = tiles.every((x) => x.w === AL.GRID_TILE_W);
  const cols = new Set(tiles.map((x) => x.x)).size;
  check("7 个瓷砖宽都是 184", w, tiles.map((x) => x.w));
  check("列数 3", cols === 3, cols);
}

// ---------------------------------------------------------------- 15 defaultExpanded
console.log("---- 15 默认展开 ----");
{
  const s = A.defaultExpanded(g, ROOT_ID, 20);
  const s2 = A.buildAtlas(g, { ...O, expanded: s });
  const small = s2.glyphs.length <= 20 + AL.MORE_MAX;
  const withFocus = A.defaultExpanded(g, "b3");
  check("budget 20：可见字形数 ≤ 20 + MORE_MAX", small, { glyphs: s2.glyphs.length, expanded: [...s].length });
  check("焦点 b3 时结果含 B", withFocus.has("B"), [...withFocus]);
}

// ---------------------------------------------------------------- 16 hopFrom
console.log("---- 16 结构距离 ----");
{
  const hop = A.hopFrom(g, "b3");
  const got = { b3: hop("b3"), b1: hop("b1"), B: hop("B"), A: hop("A"), ROOT: hop(ROOT_ID), c1: hop("c1") };
  check("b3→0、b1→2、B→1、A→3、ROOT→2、c1→4", got.b3 === 0 && got.b1 === 2 && got.B === 1 && got.A === 3 && got.ROOT === 2 && got.c1 === 4, got);
}

// ---------------------------------------------------------------- 17 crossStrands
console.log("---- 17 跨组关系 ----");
{
  const g2 = graph(nodes.map((n) => ({ ...n })), [...edges, edge("a1", "e3", "支")]);
  const s0 = A.buildAtlas(g2, O);
  const hot = new Set(["a1"]);
  const one = A.crossStrands(g2, s0, { hot, all: false, colors: COLORS });
  const none = A.crossStrands(g2, s0, { hot: new Set(), all: false, colors: COLORS });
  const noE = new Set(ALL);
  noE.delete("E");
  const s1 = A.buildAtlas(g2, { ...O, expanded: noE });
  const via = A.crossStrands(g2, s1, { hot, all: false, colors: COLORS });
  check("hot={a1} 时返回 1 条且 strong", one.length === 1 && one[0].strong && one[0].from === "a1" && one[0].to === "e3", one.map((x) => x.id));
  check("hot 空、all=false 时 0 条", none.length === 0, none.length);
  check("收起 E 后该边连到 E 的字形（viaRep）", via.length === 1 && via[0].viaRep && via[0].to === "e3", via.map((x) => ({ id: x.id, viaRep: x.viaRep })));
}

// ---------------------------------------------------------------- 18 spatialNext
console.log("---- 18 空间导航 ----");
{
  const right = A.spatialNext(sc, "b1", "right");
  const down = A.spatialNext(sc, "B", "down");
  check("从 b1 向右得到 b2", right && right.nodeId === "b2", right && right.nodeId);
  check("从 B 向下得到第 1 层中最近者", down && (down.nodeId === "b1" || down.nodeId === "b2"), down && down.nodeId);
}

// ---------------------------------------------------------------- 19 快照映射
console.log("---- 19 快照映射 ----");
{
  const snap = { cut: "r0", readingId: "r0", items: new Map([["n:r0", { left: 0, top: 0, width: 10, height: 10 }], ["n:b3", { left: 1, top: 1, width: 10, height: 10 }], ["head", { left: 2, top: 2, width: 4, height: 4 }]]), bars: new Map([["r0", { left: 0, top: 0, width: 1, height: 1 }]]) };
  const n = A.normalizeSnapshot(snap, "r0");
  check("真实根映射为 @root", n.cut === ROOT_ID && n.readingId === ROOT_ID && n.items.has(`n:${ROOT_ID}`) && n.bars.has(ROOT_ID));
  check("n:b3 → g:b3，head → null", A.snapGlyphId("n:b3") === "g:b3" && A.snapGlyphId("head") === null);
}

// ---------------------------------------------------------------- 20 实机修订：聚焦全文 / 零面积渐变回退
console.log("---- 20 聚焦全文 / 零面积渐变 ----");
{
  const longTitle = "这是一个非常长、需要完整显示的选中节点标题用于验证聚焦时不会被省略号截断，并且还要继续加长以保证未聚焦时确实会触发省略号。";
  const g3 = graph([node("R", null, 0, "材料", "其他"), node("L", "R", 0, longTitle, "理由")], []);
  const ex = new Set(["R"]);
  const plain = A.buildAtlas(g3, { ...O, expanded: ex });
  const focused = A.buildAtlas(g3, { ...O, expanded: ex, focusId: "L" });
  const a = plain.byNode.get("L"), b = focused.byNode.get("L");
  check("未聚焦：长标题同样完整显示（D254 修订：永不省略）", !!a && !a.lines.join("").includes("…") && a.lines.join("") === longTitle.replace(/\s+/g, ""), a && a.lines);
  check("聚焦：选中节点完整显示（无省略号）", !!b && !b.lines.join("").includes("…") && b.lines.join("").includes("并且还要继续加长以保证未聚焦时确实会触发省略号"), b && b.lines);
}
{
  const boxOf = (e) => {
    if (e.geom.t === "path") {
      const xs = e.geom.p.filter((_, i) => i % 2 === 0), ys = e.geom.p.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    const y0 = Math.min(e.geom.s0, e.geom.s1, e.geom.t0, e.geom.t1), y1 = Math.max(e.geom.s0, e.geom.s1, e.geom.t0, e.geom.t1);
    return { x: e.geom.L, y: y0, w: e.geom.x1 - e.geom.L, h: y1 - y0 };
  };
  {
    const padH = (g) => A.glyphPadH(g.kind);
    const bad = sc.glyphs.filter((g) => Math.max(0, ...g.lines.map((l) => L.textW(l, g.fs))) > g.w - padH(g) + 0.01);
    check("每个字形文字都放得进内容盒（CSS 不会再补省略号）", bad.length === 0, bad.slice(0, 6).map((g) => ({ id: g.id, kind: g.kind, w: g.w, lines: g.lines })));
  }
  const seq = sc.edges.find((e) => e.id === "seq:d1>d2");
  const ly = sc.edges.find((e) => e.id.startsWith("ly:"));
  check("纯水平链条边不满足渐变条件（回退实色，否则整条不画）", !!seq && !A.usableGradient(seq.color, seq.colorB, boxOf(seq)), seq && { c: seq.color, cb: seq.colorB, box: boxOf(seq) });
  check("S 形因果边有面积（仍可用渐变）", !!ly && A.usableGradient(ly.color, ly.colorB, boxOf(ly)), ly && { c: ly.color, cb: ly.colorB, box: boxOf(ly) });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
