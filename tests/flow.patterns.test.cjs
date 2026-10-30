// @runtime: node
// 结构流 v3.1 · 七种版式回归（node scripts/run-tests.mjs flow.patterns）。
// 依据 STRUCTURE-FLOW-PLAN §9 验收样例 + §10 阶段 1 / §12.6。
const path = require("path");
require("./lib/tsload.cjs");
const root = path.join(__dirname, "..");
const L = require(path.join(root, "src", "lib", "flow", "layout.ts"));
const G = require(path.join(root, "src", "lib", "mindmap", "v2", "graph.ts"));
const { ROOT_ID } = require(path.join(root, "src", "lib", "mindmap", "v2", "types.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const FLOW = L.FLOW;
const node = (id, parentId, ord, title, type, extra) => Object.assign({
  id, parentId, ord, title, type, timeText: null, patternHint: null, blockStart: 1, blockEnd: 2, spans: null,
  state: "open", source: "ai", warnings: null, explain: null, jobId: null,
}, extra || {});
const graph = (nodes, edges) => G.createGraph({ meta: { title: "材料", mapId: "m1", schemaVersion: 2 }, nodes, edges: edges || [], view: null }, "m1");
const COLORS = { dark: false, bg: "#fff", fg: "#111", accent: "#166a59", accentOn: "#fff", hairline: "#ccc", counter: "#b5483b", palette: ["#6E7F2E", "#A9821C", "#A84A80", "#3E8A82", "#3F68A8", "#6F5FB0", "#A44836", "#B2662A"], aHL: [0.16, 0.26, 0.38], aEnd: [0.34, 0.52, 0.6], aDim: 0.3, strandA: 0.62 };
const PLAN = { mode: "reserve", shift: 0, reserve: 390, barX: 700, labelX: 726, labelW: 248, right: 994 };
const mkCtx = (g, cut, pattern, members, extra) => Object.assign({
  g, plan: PLAN, colors: COLORS, pattern, cut, header: String(g.nodes[cut]?.title ?? "材料"), patternName: L.PATTERN_LABEL[pattern],
  members, colorOf: new Map(members.map((id, i) => [id, i === 0 ? COLORS.accent : COLORS.palette[i % 8]])),
  moreAbove: 0, moreBelow: 0, readingId: members[0] ?? null, readingBlock: 2, selectedId: null, expandedId: null,
  inlineH: 0, maxLines0: 2, canBack: false, availH: 700, maxW: 520, cmpPage: 0,
}, extra || {});
const barPrim = (lay, id) => lay.prims.find((x) => x.id === `bar:${id}`);
const barX = (lay, id) => {
  const p = barPrim(lay, id);
  if (!p) return null;
  if (p.x != null) return p.x;
  const m = /^M([-\d.]+),/.exec(p.d || ""); // 例证点状条：cx − 半宽
  return m ? Number(m[1]) - (p.strokeW || 0) / 2 : null;
};
const barW = (lay, id) => {
  const p = barPrim(lay, id);
  return p ? (p.w != null ? p.w : p.strokeW) : null;
};
const item = (lay, id) => lay.items.find((i) => i.id === id);

// ---------------------------------------------------------------- 论证图（§9 第 1 行）
console.log("---- 论证图 ----");
{
  const g = graph(
    [node("P", null, 0, "从故事到数据库", "论点"), node("A", "P", 1000, "消费者面向数据库", "论点"), node("B", "P", 2000, "数据库消费", "理由"),
      node("C", "P", 3000, "叙事与数据库分离", "例证"), node("D", "P", 4000, "但有人认为不可能", "反方观点")],
    [{ from: "B", to: "A", code: "支" }, { from: "C", to: "A", code: "支" }, { from: "D", to: "A", code: "驳" }],
  );
  const members = ["A", "B", "C", "D"];
  check("版式＝论证图（规则 2：父为论点）", L.patternFor(g, "P", members) === "argument");
  const lay = L.fitLayout(mkCtx(g, "P", "argument", members), members, 700);
  check("根论点在顶（所属整体 P 成为根）", !!item(lay, "n:P") && item(lay, "n:P").meta === "论点" && barX(lay, "P") === PLAN.barX, item(lay, "n:P") && item(lay, "n:P").meta);
  check("根论点条为主题色实色", (() => { const p = lay.prims.find((x) => x.id === "bar:P"); return p && p.fill === COLORS.accent; })());
  check("层级用泳道：A 泳道 1、C 泳道 3，条 x 相差 2×LANE_DX", barX(lay, "A") === PLAN.barX + FLOW.LANE_DX && barX(lay, "C") === PLAN.barX + 3 * FLOW.LANE_DX && barX(lay, "C") - barX(lay, "A") === 2 * FLOW.LANE_DX, [barX(lay, "A"), barX(lay, "C")]);
  check("标签全部左对齐（同一 transform x；不缩进）", members.concat("P").every((id) => item(lay, `n:${id}`) && item(lay, `n:${id}`).x === PLAN.labelX));
  check("跨度条 + 反方缺口存在，旧的脊线 / 括弧 / 类型方框已删除", !!lay.prims.find((p) => p.id === "span:P") && !!lay.prims.find((p) => p.id === "notch:D") && !lay.prims.some((p) => /^(sp|tk|tkx|brk):/.test(p.id)));
  check("成员条 = 泳道 5/4/3/4（A 阅读 +1；C 例证 3；D 反方 4）", barW(lay, "A") === 5 && barW(lay, "B") === 4 && barW(lay, "C") === 3 && barW(lay, "D") === 4);
  check("例证不足时无类型方框：仅反方带 chip 标记", item(lay, "n:D").chip && item(lay, "n:D").chip.style === "counter" && !item(lay, "n:A").chip && !item(lay, "n:B").chip);
  check("A 的「支 / 驳」关系不再画关系线（版式已表达）", ["B>A>支", "C>A>支", "D>A>驳"].every((k) => lay.expressed.includes(k)) && lay.expressed.length === 3, lay.expressed);
  check("每个成员都是 leaf / port", lay.ports.length === 4 && lay.leafIds.join() === "A,B,C,D", lay.leafIds);
}

// ---------------------------------------------------------------- 时间线（§9 第 2 行）
console.log("---- 时间线 ----");
{
  const g = graph(
    [node("P", null, 0, "战后", "其他"), node("t1", "P", 1000, "日本投降", "叙事", { timeText: "1945年8月", blockStart: 1, blockEnd: 2 }),
      node("t2", "P", 2000, "新中国成立", "叙事", { timeText: "1949年", blockStart: 3, blockEnd: 4 }),
      node("t3", "P", 3000, "抗美援朝", "叙事", { timeText: "1950年", blockStart: 5, blockEnd: 6 }),
      node("t4", "P", 4000, "改革开放", "叙事", { timeText: "1978年", blockStart: 7, blockEnd: 8 })],
    [],
  );
  const members = ["t1", "t2", "t3", "t4"];
  check("版式＝时间线（规则 1：全部带时间）", L.patternFor(g, "P", members) === "timeline");
  const lay = L.fitLayout(mkCtx(g, "P", "timeline", members, { readingId: "t3", readingBlock: 5 }), members, 700);
  const ys = members.map((id) => item(lay, `n:${id}`).y);
  check("y 单调不重叠", ys.every((y, i) => i === 0 || y >= ys[i - 1] + item(lay, `n:${members[i - 1]}`).h));
  check("height ≤ availH", lay.height <= 700, lay.height);
  check("四个光点 + 三段轴（含一段断层虚线 + //）", lay.prims.filter((p) => p.id.startsWith("dot:")).length === 4 && lay.prims.filter((p) => p.id.startsWith("axis:")).length === 3 && lay.prims.some((p) => p.id.startsWith("brk:")));
  check("比例模式有刻度", lay.prims.some((p) => p.id.startsWith("tick:")));
  check("阅读游标 now 在轴左侧", !!lay.prims.find((p) => p.id === "now"));
  check("时间文字在标题上方（item.time）", members.every((id) => item(lay, `n:${id}`).time));
  check("流带收束成点：port 高度 8", lay.ports.length === 4 && lay.ports.every((p) => p.y1 - p.y0 === 8));
}

// ---------------------------------------------------------------- 链（§9 第 3 行）
console.log("---- 链 ----");
{
  const g = graph([node("P", null, 0, "操作", "其他"), node("s1", "P", 1000, "登录", "步骤"), node("s2", "P", 2000, "填表", "步骤"), node("s3", "P", 3000, "提交", "步骤"), node("s4", "P", 4000, "检查", "步骤")], []);
  const members = ["s1", "s2", "s3", "s4"];
  check("版式＝链（规则 5）", L.patternFor(g, "P", members) === "chain");
  const lay = L.fitLayout(mkCtx(g, "P", "chain", members), members, 700);
  check("编号圆 + 竖向箭头连线", lay.prims.filter((p) => p.id.startsWith("step:")).length === 4 && lay.prims.filter((p) => p.id.startsWith("link:")).length === 3 && lay.prims.filter((p) => p.id.startsWith("link:")).every((p) => p.endMark === "arrow"));
  check("步骤号 1..4 从窗口外接续", members.map((id) => item(lay, `n:${id}`).num).join() === "1,2,3,4");
  check("流带落在圆左侧（port 14 高）", lay.ports.length === 4 && lay.ports.every((p) => p.y1 - p.y0 === 14));
}

// ---------------------------------------------------------------- 分层图（§9 第 4 行）
console.log("---- 分层图 ----");
{
  const g = graph(
    [node("P", null, 0, "因果", "因果"), node("A", "P", 1000, "A", "因果"), node("B", "P", 2000, "B", "因果"), node("C", "P", 3000, "C", "因果"), node("D", "P", 4000, "D", "因果")],
    [{ from: "A", to: "B", code: "因" }, { from: "B", to: "C", code: "因" }, { from: "A", to: "D", code: "推" }],
  );
  const members = ["A", "B", "C", "D"];
  check("版式＝分层图（规则 4：因果边 ≥ n−1）", L.patternFor(g, "P", members) === "layered");
  const lay = L.fitLayout(mkCtx(g, "P", "layered", members), members, 700);
  check("层号 A=0、B=1、D=1、C=2 → 顺序 A、B、D、C", lay.items.filter((i) => i.nodeId).map((i) => i.nodeId).join() === "A,B,D,C", lay.items.filter((i) => i.nodeId).map((i) => i.nodeId));
  check("按层缩进（泳道）：A 0、B/D 1、C 2", barX(lay, "A") === PLAN.barX && barX(lay, "B") === PLAN.barX + FLOW.LANE_DX && barX(lay, "D") === PLAN.barX + FLOW.LANE_DX && barX(lay, "C") === PLAN.barX + 2 * FLOW.LANE_DX, [barX(lay, "A"), barX(lay, "B"), barX(lay, "C"), barX(lay, "D")]);
  check("因果靠关系线表达：不画跨度条、不吞关系", !lay.prims.some((p) => p.id.startsWith("span:")) && lay.expressed.length === 0);
  const strands = L.buildStrands(g, lay, 50, { textRight: 1000, focusId: null, all: true });
  check("三条关系线全部画出（分层图 all=true）", strands.length === 3, strands.map((s) => s.id));
}

// ---------------------------------------------------------------- 对照表（§12.3.2 / §12.6）
console.log("---- 对照表 ----");
{
  const g = graph(
    [node("P", null, 0, "两种消费观", "对比"), node("X", "P", 1000, "故事消费", "分类"), node("Y", "P", 2000, "数据库消费", "分类"),
      node("x1", "X", 1000, "目的：追问作品背后意义", "其他"), node("x2", "X", 2000, "路径：穿过作品抵达叙事", "其他"), node("x3", "X", 3000, "姿态：读者", "其他"),
      node("y1", "Y", 1000, "目的：即时取用情感素材", "其他"), node("y2", "Y", 2000, "路径：直接面向数据库", "其他"), node("y3", "Y", 3000, "姿态：动物化的消费者", "其他")],
    [{ from: "y1", to: "x1", code: "比" }, { from: "y2", to: "x2", code: "比" }, { from: "y3", to: "x3", code: "比" }],
  );
  const members = ["X", "Y"];
  check("版式＝对照（规则 3）", L.patternFor(g, "P", members) === "compare");
  const lay = L.fitLayout(mkCtx(g, "P", "compare", members, { selectedId: "X", inlineH: 26 }), members, 700);
  check("两行对象名（n:X / n:Y）", !!item(lay, "n:X") && !!item(lay, "n:Y") && item(lay, "n:X").lane === 0);
  check("表头维度数 = 3（目的 / 路径 / 姿态）", lay.items.filter((i) => i.id.startsWith("dim:")).length === 3 && lay.items.filter((i) => i.id.startsWith("dim:")).map((i) => i.lines[0]).join() === "目的,路径,姿态", lay.items.filter((i) => i.id.startsWith("dim:")).map((i) => i.lines[0]));
  check("单元格项带 nodeId（可悬停回正文）", !!item(lay, "n:x1") && item(lay, "n:x1").nodeId === "x1");
  check("行尾节点条 = 行高、port 两行、无关系线", lay.ports.length === 2 && lay.noStrands === true && (barPrim(lay, "X").h >= 24));
  check("选中成员时动作行固定在表底（inlineAt）", !!lay.inlineAt && lay.inlineAt.w >= PLAN.labelW);
  check("「比」关系已由同列表达", ["X>Y>比", "Y>X>比"].every((k) => lay.expressed.includes(k)));
  const wide = L.fitLayout(mkCtx(g, "P", "compare", members, { maxW: 300 }), members, 700);
  check("窄表宽：仍能排成表（收窄到可用宽度）", wide.items.filter((i) => i.id.startsWith("dim:")).length >= 1);
  const five = graph([node("P2", null, 0, "对比", "对比"), ...[1, 2, 3, 4, 5].map((i) => node(`m${i}`, "P2", i * 1000, `M${i}`, "分类", { blockStart: i, blockEnd: i }))], []);
  check("成员 >4 → 退回 tree（FLOW.CMP_MAX=4）", L.patternFor(five, "P2", ["m1", "m2", "m3", "m4", "m5"]) === "tree");
}

// ---------------------------------------------------------------- 网格 / 窗口 / parseTime
console.log("---- 网格 / 成员窗口 / parseTime ----");
{
  const g = graph([node("P", null, 0, "网格", "其他"), ...[1, 2, 3, 4, 5, 6].map((i) => node(`g${i}`, "P", i * 1000, `第${i}点`, "其他", { hasChildren: false, blockStart: i, blockEnd: i }))], []);
  const members = ["g1", "g2", "g3", "g4", "g5", "g6"];
  check("版式＝网格（规则 6）", L.patternFor(g, "P", members) === "grid");
  const lay = L.fitLayout(mkCtx(g, "P", "grid", members), members, 700);
  check("网格：单行标签、泳道 0、无跨度条", lay.items.every((i) => i.nodeId ? i.lines.length === 1 : true) && !lay.prims.some((p) => p.id.startsWith("span:")) && lay.items.filter((i) => i.nodeId).every((i) => i.lane === 0));

  const many = graph([node("P", null, 0, "多", "其他"), ...Array.from({ length: 12 }, (_, i) => node(`m${i}`, "P", (i + 1) * 1000, `第${i}项`, "理由", { blockStart: i, blockEnd: i }))], []);
  const all = Array.from({ length: 12 }, (_, i) => `m${i}`);
  const win = L.fitLayout(mkCtx(many, "P", "tree", all, { readingId: "m0" }), all, 400);
  check("窗口最多 9 个成员且包含阅读节点", win.members.length <= 9 && win.members.includes("m0"), win.members);

  check("parseTime：公元前221年 → −221", L.parseTime("公元前221年") === -221);
  check("parseTime：1945年8月 → 1945.625", Math.abs(L.parseTime("1945年8月") - 1945.625) < 1e-9);
  check("parseTime：19世纪 → 1850", L.parseTime("19世纪") === 1850);
  check("parseTime：2003-04 → 2003.29", Math.abs(L.parseTime("2003-04") - 2003.2916666666665) < 1e-6);
  check("parseTime：春天 → null", L.parseTime("春天") === null && L.parseTime(null) === null);
}

// ---------------------------------------------------------------- 分派完整性
console.log("---- layoutFor 分派 ----");
{
  const g = graph([node("P", null, 0, "材料", "其他"), node("k", "P", 1000, "唯一", "其他")], []);
  const lay = L.fitLayout(mkCtx(g, "P", "tree", ["k"], { readingId: "k" }), ["k"], 700);
  check("tree 基础列：头部 + 成员 + port", lay.items.some((i) => i.id === "head") && lay.ports.length === 1 && lay.readingY != null, lay.items.map((i) => i.id));
  check("fitLayout 返回值携带 members", lay.members.join() === "k");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
