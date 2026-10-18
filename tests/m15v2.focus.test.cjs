// @runtime: node
// 聚焦图谱（阅读透镜 v2）纯函数回归：node tests/m15v2.focus.test.cjs
// buildFocus：整体 / 成员窗口 / 下一层 / 图内关系 / 别处节点（排序与上限）/ 标题链；
// layoutFocus：左列结构、右列别处、卡片不重叠、坐标整数、确定性。
const path = require("path");
require("./lib/tsload.cjs");
const V2 = path.join(__dirname, "..", "src", "lib", "mindmap", "v2");
const G = require(path.join(V2, "graph.ts"));
const Fo = require(path.join(V2, "focus.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}

let ord = 0;
const N = (id, parentId, title, type = "论点", source = "ai", bs = null, be = null) => ({
  id, parentId, ord: (ord += 1000), title, type, timeText: null, patternHint: null, blockStart: bs, blockEnd: be, spans: null, state: "open", source, warnings: null, jobId: null,
});
const nodes = [
  N("r", null, "测试书", "其他", "toc", 1, 200),
  N("c1", "r", "第一章 问题", "其他", "toc", 1, 100),
  N("c2", "r", "第二章 论证", "其他", "toc", 101, 200),
  N("c1.1", "c1", "一、市场的边界", "其他", "toc", 1, 60),
];
// c1.1 下 10 个 AI 成员
for (let i = 1; i <= 10; i++) nodes.push(N(`m${i}`, "c1.1", `要点${i}：一个相当长的标题用来测试断行是否正确工作，而且还要再长一些才会被截断`, i === 5 ? "证据" : "论点", "ai", i * 5, i * 5 + 4));
nodes.push(N("m5.1", "m5", "子点甲", "例证", "ai", 25, 26));
nodes.push(N("m5.2", "m5", "子点乙", "例证", "ai", 27, 29));
for (let i = 1; i <= 4; i++) nodes.push(N(`x${i}`, "c2", `别处${i}`, "结论", "ai", 100 + i * 10, 105 + i * 10));
const edges = [
  { from: "m5", to: "m4", code: "支" }, // 图内（窗口内）
  { from: "m5", to: "m10", code: "驳" }, // 窗口外但与 F 相连 → 保留
  { from: "m5", to: "x1", code: "推" }, // 别处，碰 F（3 分）
  { from: "m5.1", to: "x2", code: "例" }, // 别处，碰 F 的子（2 分）
  { from: "m2", to: "x3", code: "据" }, // 别处，碰其他成员（1 分）
  { from: "x4", to: "x3", code: "支" }, // 两端都在图外 → 不进
  { from: "m7", to: "m6", code: "比" }, // 图内，不碰 F
];
const g = G.createGraph({ meta: { title: "测试书" }, nodes, edges, view: null }, "map1");

const m = Fo.buildFocus(g, "m5");
check("焦点不存在 → null", Fo.buildFocus(g, "zzz") === null);
check("整体＝父节点", m.wholeId === "c1.1");
check("标题链去掉材料根：只剩「第一章」", JSON.stringify(m.crumbs) === JSON.stringify(["第一章 问题"]), m.crumbs);
check("成员窗口：7 个以 F 为中心 + 窗口外相连的 m10", m.members.includes("m5") && m.members.includes("m10") && m.members.length === 8 && !m.members.includes("m9"), m.members);
check("折叠段：窗口外不相连的成员折成「另 N 项」（前 m1、后 m9）", m.gaps.length === 2 && m.gaps[0].ids.join() === "m1" && m.gaps[0].after === null && m.gaps[1].ids.join() === "m9" && m.gaps[1].after === "m8", m.gaps);
check("下一层：F 的两个子", m.kids.join() === "m5.1,m5.2" && m.moreKids === 0);
const ext = m.items.filter((i) => i.role === "external").map((i) => i.id);
check("别处节点：按分数排序（碰 F > 碰子 > 碰成员），两端都在图外的不进", ext.join() === "x1,x2,x3", ext);
check("别处节点带所在整体标题", m.items.find((i) => i.id === "x1").context === "第二章 论证");
const relKeys = m.rels.map((r) => `${r.from}>${r.to}:${r.internal ? "in" : "ex"}`).sort();
check("关系：图内 3 条（支 / 驳 / 比）、别处 3 条", relKeys.filter((k) => k.endsWith(":in")).length === 3 && relKeys.filter((k) => k.endsWith(":ex")).length === 3 && !relKeys.some((k) => k.startsWith("x4")), relKeys);
check("相连标记：m4 / m10 与 F 相连，m6 不相连", m.items.find((i) => i.id === "m4").linked && m.items.find((i) => i.id === "m10").linked && !m.items.find((i) => i.id === "m6").linked);

const labels = { type: (n) => (n.source === "toc" || n.type === "其他" ? "" : n.type), more: (k) => `另 ${k} 项` };
const L1 = Fo.layoutFocus(m, 420, labels, { family: "tree" });
const L2 = Fo.layoutFocus(m, 420, labels, { family: "tree" });
check("确定性", JSON.stringify(L1) === JSON.stringify(L2));
const ints = L1.boxes.every((b) => [b.x, b.y, b.w, b.h].every(Number.isInteger));
check("坐标为整数", ints, L1.boxes.slice(0, 2));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let ov = null;
for (let i = 0; i < L1.boxes.length; i++) for (let j = i + 1; j < L1.boxes.length; j++) if (overlap(L1.boxes[i], L1.boxes[j])) ov = [L1.boxes[i].id, L1.boxes[j].id];
check("卡片互不重叠", !ov, ov);
check("全部卡片在画布宽度内", L1.boxes.every((b) => b.x >= 0 && b.x + b.w <= L1.width), L1.boxes.map((b) => [b.id, b.x, b.w]));
const B = (id) => L1.boxes.find((b) => b.id === id);
check("左结构右关系：别处卡片都在成员卡右侧", ["x1", "x2", "x3"].every((id) => B(id).x > B("m5").x + B("m5").w));
check("整体在最上、F 的子缩进挂在 F 下", B("c1.1").y < B("m2").y && B("m5.1").x > B("m5").x && B("m5.1").y > B("m5").y && B("m5.2").y > B("m5.1").y && B("m6").y > B("m5.2").y);
check("断行：长标题 ≤2 行并以省略号收尾（成员）", B("m2").lines.length === 2 && B("m2").lines[1].endsWith("…"), B("m2").lines);
check("树线：每个成员一条肘线 + 两条子线；关系线 6 条带码", L1.paths.filter((p) => p.kind === "tree").length === m.members.length + m.gaps.length + 2 && L1.paths.filter((p) => p.kind === "rel").length === 6, L1.paths.map((p) => p.key));
const ju = L1.paths.find((p) => p.code === "据");
check("「据」按画法方向反转（目标 → 本节点）", ju.from === "x3" && ju.to === "m2", ju);
check("折叠段占位框", L1.gaps.length === 2 && L1.gaps.every((x) => x.count === 1) && L1.gaps[0].y < B("m2").y);
const narrow = Fo.layoutFocus(m, 300, labels, { family: "tree" });
check("窄宽度仍不重叠", (() => { for (let i = 0; i < narrow.boxes.length; i++) for (let j = i + 1; j < narrow.boxes.length; j++) if (overlap(narrow.boxes[i], narrow.boxes[j])) return false; return true; })());

// 版式 → 排法 / 摆放
check("整体这一组的版式：子间有「比」→ 对照（规则推断）", m.pattern === "compare" && m.patternHow === "rule", { p: m.pattern, how: m.patternHow });
check("对照：非焦点成员带栏内格（m5 自己用 kids）", Array.isArray(m.cells.m4) && !("m5" in m.cells));
const noOverlap = (L) => { for (let i = 0; i < L.boxes.length; i++) for (let j = i + 1; j < L.boxes.length; j++) if (overlap(L.boxes[i], L.boxes[j])) return [L.boxes[i].id, L.boxes[j].id]; return null; };
for (const fam of ["tree", "topdown", "flow", "columns"]) {
  const L = Fo.layoutFocus(m, 420, labels, { family: fam });
  check(`排法 ${fam}：卡片不重叠、坐标整数、关系线齐全`, !noOverlap(L) && L.boxes.every((b) => [b.x, b.y, b.w, b.h].every(Number.isInteger)) && L.paths.filter((p) => p.kind === "rel").length === m.rels.length && L.family === fam, { ov: noOverlap(L), rels: L.paths.filter((p) => p.kind === "rel").length, want: m.rels.length });
}
const Lc = Fo.layoutFocus(m, 420, labels);
check("缺省按版式：对照 → 分栏、放在正文下方", Lc.family === "columns" && Lc.host === "dock");
check("分栏：焦点的子挂在焦点栏下", (() => { const f = Lc.boxes.find((b) => b.id === "m5"), k = Lc.boxes.find((b) => b.id === "m5.1"); return k.y > f.y && k.x > f.x && k.x < f.x + f.w; })());
check("别处节点在最下面一行", (() => { const ys = Lc.boxes.filter((b) => b.role === "external").map((b) => b.y); const ms = Lc.boxes.filter((b) => b.role !== "external").map((b) => b.y + b.h); return ys.length && Math.min(...ys) > Math.max(...ms); })());
// 时间线
ord = 0;
const tl = [N("r", null, "史", "其他", "toc", 1, 50), N("w", "r", "改革的经过", "叙事", "ai", 1, 40)];
for (let i = 1; i <= 4; i++) tl.push(Object.assign(N(`t${i}`, "w", `第${i}阶段`, "叙事", "ai", i * 8, i * 8 + 5), { timeText: `${1900 + i * 10}年` }));
const gt = G.createGraph({ meta: { title: "史" }, nodes: tl, edges: [{ from: "t2", to: "t3", code: "因" }], view: null }, "map2");
const mt = Fo.buildFocus(gt, "t2");
const Lt = Fo.layoutFocus(mt, 420, labels);
check("时间线：全部带时间 → 横排 + 时间轴 + 刻度、放在正文下方", mt.pattern === "timeline" && Lt.family === "flow" && Lt.host === "dock" && Lt.decor.some((d) => d.kind === "axis") && Lt.decor.filter((d) => d.kind === "tick").length === 4, Lt.decor);
check("时间线：卡片元信息带时间、从左到右按原文顺序", Lt.boxes.find((b) => b.id === "t1").meta.startsWith("1910年") && [1, 2, 3].every((i) => Lt.boxes.find((b) => b.id === `t${i}`).x < Lt.boxes.find((b) => b.id === `t${i + 1}`).x));
// 论证图
ord = 0;
const ar = [N("r", null, "书", "其他", "toc", 1, 50), N("w", "r", "机会平等不够", "论点", "ai", 1, 40), N("p1", "w", "起点不平等", "理由", "ai", 2, 9), N("p2", "w", "代际数据", "证据", "ai", 10, 19), N("c1", "w", "反方：规则相同即公平", "反方观点", "ai", 20, 29), N("c2", "w", "然而规则奖励的资源不均", "反驳", "ai", 30, 39)];
const ga = G.createGraph({ meta: { title: "书" }, nodes: ar, edges: [{ from: "c2", to: "c1", code: "驳" }], view: null }, "map3");
const ma = Fo.buildFocus(ga, "p1");
const La = Fo.layoutFocus(ma, 420, labels);
const A = (id) => La.boxes.find((b) => b.id === id);
check("论证图：父为论点 → 论点在上、支持在左、反方 / 反驳在右，放浮窗", ma.pattern === "argument" && La.family === "topdown" && La.host === "float" && A("w").y < A("p1").y && A("p1").x < A("c1").x && A("c2").x === A("c1").x && A("p2").x === A("p1").x && !noOverlap(La), La.boxes.map((b) => [b.id, b.x, b.y]));
check("树 / 网格放浮窗，链 / 分层放下方", Fo.HOST_OF[Fo.FAMILY_OF.tree] === "float" && Fo.HOST_OF[Fo.FAMILY_OF.grid] === "float" && Fo.HOST_OF[Fo.FAMILY_OF.chain] === "dock" && Fo.HOST_OF[Fo.FAMILY_OF.layered] === "dock");

// 顶层节点（父＝材料根）与根本身
const mTop = Fo.buildFocus(g, "c1");
check("父是材料根：整体＝材料根、标题链为空", mTop.wholeId === "r" && mTop.crumbs.length === 0 && mTop.members.join() === "c1,c2", mTop);
const mRoot = Fo.buildFocus(g, "r");
check("材料根本身：无整体，成员只有自己", mRoot.wholeId === null && mRoot.members.join() === "r");
const Lr = Fo.layoutFocus(mRoot, 360, labels);
check("无整体：按树排、放浮窗", mRoot.pattern === "tree" && Lr.host === "float");
check("无整体也能排版", Lr.boxes.length >= 1 && Lr.height > 0);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
