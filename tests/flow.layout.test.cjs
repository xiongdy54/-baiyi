// @runtime: node
// 结构流 v3.1 纯逻辑回归（node scripts/run-tests.mjs flow.layout；TS 经 tests/lib/tsload.cjs 转译）。
// 依据 docs/design/STRUCTURE-FLOW-PLAN.md §10 阶段 1 + §12.6 阶段 1 增补。
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
const close = (a, b, eps = 1) => Math.abs(a - b) <= eps;

const node = (id, parentId, ord, title, type, extra) => Object.assign({
  id, parentId, ord, title, type, timeText: null, patternHint: null, blockStart: 1, blockEnd: 4, spans: null,
  state: "open", source: "ai", warnings: null, explain: null, jobId: null,
}, extra || {});
const graph = (nodes, edges) => G.createGraph({ meta: { title: "材料", mapId: "m1", schemaVersion: 2 }, nodes, edges, view: null }, "m1");

// ---------------------------------------------------------------- §10-1 planColumn
console.log("---- planColumn ----");
{
  const vp = { left: 280, right: 1200, top: 60, bottom: 900 };
  const p1 = L.planColumn({ on: true, viewport: vp, textLeft: 420, textRight: 1000 }, null);
  check("放不下 + 平移不足 + 预留够 → reserve（390）", p1.mode === "reserve" && p1.reserve === 390, p1);
  const p2 = L.planColumn({ on: true, viewport: vp, textLeft: 560, textRight: 1000 }, null);
  check("平移可行 → shift 160", p2.mode === "shift" && p2.shift === 160, p2);
  const p3 = L.planColumn({ on: true, viewport: vp, textLeft: 420, textRight: 840 }, null);
  check("room 360 够 → inside", p3.mode === "inside" && p3.shift === 0 && p3.reserve === 0, p3);
  const vp2 = { left: 280, right: 1000, top: 60, bottom: 900 };
  const p4 = L.planColumn({ on: true, viewport: vp2, textLeft: 420, textRight: 900 }, null);
  check("窄视口 + 紧凑也放不下 → whisper", p4.mode === "whisper", p4);
  const p5 = L.planColumn({ on: true, viewport: vp, textLeft: 560, textRight: 1000 }, { shift: 168, reserve: 0, mode: "shift", barX: 0, labelX: 0, labelW: 0, right: 0 });
  check("滞回：need 160 与旧 168 差 <16 → 保持 168", p5.mode === "shift" && p5.shift === 168, p5);
  check("on=false → off", L.planColumn({ on: false, viewport: vp, textLeft: 420, textRight: 1000 }, null).mode === "off");
  check("硬约束：所有非 whisper 方案 plan.right ≤ viewport.right − 4", [p1, p2, p3, p5].every((p) => p.right <= vp.right - 4), [p1, p2, p3, p5].map((p) => p.right));
}

console.log("---- §12.1 宽度遍历（侧栏收起后的最小宽度保证） ----");
{
  let bad = [];
  let at1120 = null;
  for (let right = 640; right <= 1920; right += 40) {
    const vp = { left: 40, right, top: 60, bottom: 900 };
    const textLeft = 40 + (right - 40 - 680) / 2;
    const p = L.planColumn({ on: true, viewport: vp, textLeft, textRight: textLeft + 680 }, null);
    if (!(p.mode === "whisper" || p.right <= vp.right - 4)) bad.push({ right, p });
    if (right === 1120) at1120 = p;
  }
  check("每档：whisper 或完整可见（plan.right ≤ right − 4）", bad.length === 0, bad);
  check("1120 宽下不是 whisper（结构图必然完整可见）", !!at1120 && at1120.mode !== "whisper", at1120);
}

// ---------------------------------------------------------------- §10-2 wrapLabel
console.log("---- wrapLabel ----");
{
  const s = "这是一段用于测试折行的中文文字内容比较长需要换行";
  const lines = L.wrapLabel(s, 13, 100, 2);
  check("中文 13px 宽 100：每行 ≤7 字且不超宽", lines.length === 2 && lines.every((l) => L.textW(l, 13) <= 100) && [...lines[0]].length <= 7, lines);
  check("超出 maxLines 末尾加「…」", lines[lines.length - 1].endsWith("…"), lines);
  const en = "the quick brown fox jumps over the lazy dog";
  const ls = L.wrapLabel(en, 13, 80, 3);
  const words = en.split(" ");
  const body = ls.slice(0, -1).join(" ").split(/\s+/).filter(Boolean);
  const tw = ls[ls.length - 1].replace(/…/g, "").trim().split(/\s+/).filter(Boolean);
  check(
    "英文不在单词中间断行（末行省略以外）",
    ls.every((l) => L.textW(l, 13) <= 80) &&
      body.every((w) => words.includes(w)) &&
      tw.slice(0, -1).every((w) => words.includes(w)) &&
      words.some((w) => w.startsWith(tw[tw.length - 1] ?? "")),
    ls,
  );
  check("空串 → 至少一行", L.wrapLabel("", 13, 100, 2).length === 1);
}

// ---------------------------------------------------------------- §10-3 semanticNest / nestOrder + §12.2 laneOf
console.log("---- semanticNest / nestOrder / laneOf ----");
{
  const g = graph(
    [node("P", null, 0, "所属整体", "论点"), node("A", "P", 1000, "论点 A", "论点"), node("B", "P", 2000, "理由 B", "理由"), node("C", "P", 3000, "例证 C", "例证"), node("D", "P", 4000, "反方 D", "反方观点")],
    [{ from: "B", to: "A", code: "支" }, { from: "C", to: "A", code: "例" }, { from: "D", to: "A", code: "驳" }],
  );
  const nest = L.semanticNest(g, ["A", "B", "C", "D"]);
  check("A.depth=0（一级论点）", nest.get("A").depth === 0 && nest.get("A").parent === null);
  check("B/C/D 都挂 A，rel=support/example/counter", nest.get("B").parent === "A" && nest.get("B").rel === "support" && nest.get("C").rel === "example" && nest.get("D").rel === "counter", [...nest]);
  check("nestOrder = [A,B,C,D]", JSON.stringify(L.nestOrder(["A", "B", "C", "D"], nest)) === JSON.stringify(["A", "B", "C", "D"]));
  const g2 = graph([node("A2", null, 0, "论点", "论点"), node("C2", "A2", 1000, "例证", "例证")], []);
  const nest2 = L.semanticNest(g2, ["A2", "C2"]);
  check("无边时例证挂到前面最近的论点", nest2.get("C2").parent === "A2" && nest2.get("C2").depth === 1 && nest2.get("C2").rel === "example");
  check("laneOf：例证无上级也至少泳道 2；有根论点时至少 3", L.laneOf(0, "例证", false) === 2 && L.laneOf(0, "例证", true) === 3, [L.laneOf(0, "例证", false), L.laneOf(0, "例证", true)]);
  check("laneOf 封顶 3", L.laneOf(9, "理由", false) === 3);
}

// ---------------------------------------------------------------- §10-4 shapePath / strandPath
console.log("---- shapePath / strandPath 折叠态命令序列一致 ----");
{
  const s = { L: 400, xs: 860, s0: 100, s1: 160, x1: 980, t0: 120, t1: 150 };
  const strip = (d) => d.replace(/[-\d.]+/g, "");
  check("shapePath 以 M 开头、含 Q（矩形段圆角）", L.shapePath(s).startsWith("M") && L.shapePath(s).includes("Q"), L.shapePath(s));
  check("collapseAtLeft 命令序列相同", strip(L.shapePath(s)) === strip(L.shapePath(L.collapseAtLeft(s))));
  check("collapseAtNode 命令序列相同", strip(L.shapePath(s)) === strip(L.shapePath(L.collapseAtNode(s))));
  const st = { xa: 900, ya: 120, xb: 900, yb: 300, bulge: 60 };
  check("strandPath 折叠命令序列相同", strip(L.strandPath(st)) === strip(L.strandPath(L.collapseStrand(st))) && L.strandPath(st).startsWith("M"));
}

// ---------------------------------------------------------------- §10-5 buildShapes
console.log("---- buildShapes ----");
{
  const mkBox = (nodeId, column, top, bottom, left, right, key = nodeId) => ({ key, nodeId, block: top, top, bottom, left, right, column, clipTop: false, clipBottom: false });
  const geo = {
    seq: 1,
    viewport: { left: 0, top: 0, right: 1200, bottom: 900 },
    columns: [{ left: 100, right: 500 }, { left: 560, right: 1000 }],
    text: { left: 100, right: 1000 },
    boxes: [
      mkBox("a", 1, 100, 140, 560, 1000, "a1"),
      mkBox("a", 1, 160, 200, 560, 1000, "a2"), // 间距 20 ≤ 28 → 合并
      mkBox("a", 1, 240, 280, 560, 1000, "a3"), // 距合并块底 40 > 28 → 不合并
      mkBox("b", 0, 100, 140, 100, 500, "b1"),
    ],
  };
  const lay = { items: [], prims: [], expressed: [], leafIds: ["a", "b", "c"], height: 0, readingY: null, ports: [{ nodeId: "a", x: 800, y0: 50, y1: 150, color: "#f00" }, { nodeId: "b", x: 820, y0: 200, y1: 260, color: "#00f" }, { nodeId: "c", x: 840, y0: 300, y1: 340, color: "#0a0" }], sideOf: { c: "below" } };
  const shapes = L.buildShapes(geo, lay, 0, { focusId: null, hoverId: null, readingId: "a", colorOf: (id) => (id === "b" ? "#00f" : "#f00") });
  const ribbon = shapes.filter((s) => s.nodeId === "a" && s.ribbon);
  check("同节点相邻（间距 20）合并为一块：三个段落 → 两个 ribbon", ribbon.length === 2, ribbon.map((s) => [s.s0, s.s1]));
  check("流动落点依次相接、末块 t1=port.y1", close(ribbon[0].t1, ribbon[1].t0) && close(ribbon[1].t1, 150), ribbon.map((s) => [s.t0, s.t1]));
  const bShape = shapes.find((s) => s.nodeId === "b");
  check("非最右栏只有高亮矩形（ribbon=false）", !!bShape && bShape.ribbon === false && close(bShape.L, 94) && close(bShape.xs, 506), bShape);
  const stub = shapes.find((s) => s.nodeId === "c");
  check("看不见的近邻成员出 stub（侧＝below，零宽矩形段）", !!stub && stub.stub === "below" && close(stub.L, stub.xs) && close(stub.s0, 900), stub);
  check("stub 落在 port 中段", !!stub && close(stub.t0, 312) && close(stub.t1, 328), stub && [stub.t0, stub.t1]);
}

// ---------------------------------------------------------------- §10-6 buildStrands + §12.2 hoverSet / §12.3.2 extra
console.log("---- buildStrands / 悬停集合 / 悬停单元格 ----");
{
  const g = graph(
    [node("a", null, 0, "A", "论点"), node("b", null, 1000, "B", "理由"), node("c", null, 2000, "C", "证据"), node("d", null, 3000, "D", "例证")],
    [{ from: "a", to: "b", code: "支" }, { from: "c", to: "d", code: "据" }, { from: "b", to: "c", code: "比" }, { from: "a", to: "d", code: "例" }],
  );
  const ports = ["a", "b", "c", "d"].map((id, i) => ({ nodeId: id, x: 800 + i * 5, y0: 100 + i * 100, y1: 130 + i * 100, color: "#123" }));
  const lay = { items: [], prims: [], expressed: [], leafIds: ["a", "b", "c", "d"], height: 0, readingY: null, ports };
  const s1 = L.buildStrands(g, { ...lay, expressed: ["a>b>支"] }, 0, { textRight: 900, focusId: null, all: false });
  check("expressed 里的关系不再出线", s1.every((s) => s.id !== "a>b>支") && s1.length === 3, s1.map((s) => s.id));
  const rev = s1.find((s) => s.code === "据");
  check("「据」reverse：A 端＝目标（d），B 端＝本节点（c）", !!rev && rev.reverse && rev.from === "c" && rev.to === "d" && rev.xa === 814 && rev.xb === 809, rev);
  const many = graph(
    [node("a0", null, 0, "A0", "论点"), ...Array.from({ length: 14 }, (_, i) => node(`x${i}`, null, (i + 1) * 1000, `X${i}`, "理由"))],
    Array.from({ length: 14 }, (_, i) => ({ from: "a0", to: `x${i}`, code: "支" })),
  );
  const manyLay = { items: [], prims: [], expressed: [], leafIds: [], height: 0, readingY: null, ports: ["a0", ...Array.from({ length: 14 }, (_, i) => `x${i}`)].map((id, i) => ({ nodeId: id, x: 800, y0: i * 10, y1: i * 10 + 8, color: "#123" })) };
  const s2 = L.buildStrands(many, manyLay, 0, { textRight: 900, focusId: "x3", all: false });
  check(">12 截断且碰焦点者优先", s2.length === 12 && s2[0].id === "a0>x3>支", s2.map((s) => s.id));
  check("noStrands → 空", L.buildStrands(many, { ...manyLay, noStrands: true }, 0, { textRight: 900, focusId: null, all: true }).length === 0);

  const geo = { seq: 1, viewport: { left: 0, top: 0, right: 1200, bottom: 900 }, columns: [{ left: 100, right: 1000 }], text: { left: 100, right: 1000 }, boxes: [
    { key: "k", nodeId: "a", block: 1, top: 100, bottom: 140, left: 100, right: 1000, column: 0, clipTop: false, clipBottom: false },
    { key: "k2", nodeId: "extra", block: 2, top: 160, bottom: 200, left: 100, right: 1000, column: 0, clipTop: false, clipBottom: false },
  ] };
  const lay2 = { items: [], prims: [], expressed: [], leafIds: ["a"], height: 0, readingY: null, ports: [{ nodeId: "a", x: 800, y0: 100, y1: 140, color: "#f00" }] };
  const t0 = L.buildShapes(geo, lay2, 0, { focusId: null, hoverId: null, readingId: "a", colorOf: () => "#f00" });
  const t1 = L.buildShapes(geo, lay2, 0, { focusId: null, hoverId: "extra", readingId: "a", colorOf: () => "#f00", extra: [{ nodeId: "extra", color: "#00f" }] });
  check("悬停单元格：extra 节点只出矩形段、档位 hover(2)", t1.length === t0.length + 1 && t1.find((s) => s.nodeId === "extra").tone === 2 && t1.find((s) => s.nodeId === "extra").ribbon === false, t1.map((s) => [s.nodeId, s.tone, s.ribbon]));
  const t2 = L.buildShapes(geo, lay2, 0, { focusId: "a", hoverId: "a", readingId: "a", colorOf: () => "#f00", hoverSet: new Set(["a", "kid"]) });
  check("悬停集合 tone：自己 hover(2)、集合内 focus(1)", t2.every((s) => s.tone === 2), t2.map((s) => s.tone));
}

// ---------------------------------------------------------------- §12.6 compareTable 三种 how
console.log("---- compareTable ----");
{
  // 命名维度（§12.3.4 新示例三的数据）
  const g1 = graph(
    [node("A", null, 0, "短时记忆", "分类"), node("B", null, 1000, "长时记忆", "分类"),
      node("a1", "A", 1000, "容量：约七个组块", "定义"), node("a2", "A", 2000, "遗忘：不复述则数秒内消退", "因果"),
      node("b1", "B", 1000, "容量：几乎没有上限", "定义"), node("b2", "B", 2000, "遗忘：多源于提取失败", "因果")],
    [{ from: "b1", to: "a1", code: "比" }, { from: "b2", to: "a2", code: "比" }],
  );
  const T1 = L.compareTable(g1, ["A", "B"]);
  check("命名维度：dims=[容量,遗忘]", T1.how === "named" && T1.dims.map((d) => d.label).join() === "容量,遗忘", T1.dims);
  check("命名维度：两行各 2 格且内容去前缀", T1.rows.length === 2 && T1.rows[0].cells.map((c) => c.text).join() === "约七个组块,不复述则数秒内消退" && T1.rows[1].cells[0].text === "几乎没有上限", T1.rows);
  // 配对（旧示例三：无冒号、有 &比）
  const g2 = graph(
    [node("A", null, 0, "短时记忆", "分类"), node("B", null, 1000, "长时记忆", "分类"),
      node("a1", "A", 1000, "容量约七个组块", "定义"), node("a2", "A", 2000, "不复述则数秒内消退", "因果"),
      node("b1", "B", 1000, "容量几乎没有上限", "定义"), node("b2", "B", 2000, "遗忘多源于提取失败", "因果")],
    [{ from: "b1", to: "a1", code: "比" }, { from: "b2", to: "a2", code: "比" }],
  );
  const T2 = L.compareTable(g2, ["A", "B"]);
  check("配对：两列、表头取同列类型（定义/因果）", T2.how === "paired" && T2.dims.length === 2 && T2.dims.map((d) => d.label).join() === "定义,因果", T2.dims);
  check("配对：同列对应的子节点", T2.rows[0].cells[0].id === "a1" && T2.rows[1].cells[0].id === "b1" && T2.rows[1].cells[1].id === "b2", T2.rows);
  // 序号
  const g3 = graph(
    [node("A", null, 0, "甲", "分类"), node("B", null, 1000, "乙", "分类"),
      node("a1", "A", 1000, "甲一", "其他"), node("a2", "A", 2000, "甲二", "其他"),
      node("b1", "B", 1000, "乙一", "其他"), node("b2", "B", 2000, "乙二", "其他")],
    [],
  );
  const T3 = L.compareTable(g3, ["A", "B"]);
  check("序号：表头为 1 / 2", T3.how === "ordinal" && T3.dims.map((d) => d.label).join() === "1,2", T3.dims);
}

// ---------------------------------------------------------------- §12.6 decideAttention（7 例）
console.log("---- decideAttention ----");
{
  const st = (o) => ({ groupId: null, readingId: null, candGroup: null, candSince: 0, candNode: null, nodeSince: 0, ...o });
  const S = (frac, member, group) => ({ frac, nodeId: member || null, chain: member ? ["r", group, member] : [] });
  const all = (group, members) => L.ATTN.FRACS.map((f, i) => S(f, members[i], group));
  // 1 首次
  {
    const r = L.decideAttention(all("A", ["a0", "a1", "a2", "a3"]), st(), 0, { paged: false, idle: false });
    check("首次 4 样本都在 A → groupId=A、readingId=38% 样本成员", r.groupId === "A" && r.readingId === "a1", r);
  }
  // 2 交界不切 + 预览
  {
    const samples = [S(0.12, "a0", "A"), S(0.38, "a1", "A"), S(0.62, "b0", "B"), S(0.88, "b1", "B")];
    const r = L.decideAttention(samples, st({ groupId: "A", readingId: "a1" }), 0, { paged: false, idle: false });
    check("12/38 在 A、62/88 在 B → 不切，peek={B,below}", r.groupId === "A" && r.peek && r.peek.groupId === "B" && r.peek.side === "below" && r.switched === "", r);
  }
  // 3 立刻切（新组 0.90 / 旧组 0.10）
  {
    const samples = [S(0.12, "a0", "A"), S(0.38, "b0", "B"), S(0.62, "b1", "B"), S(0.88, "b2", "B")];
    const r = L.decideAttention(samples, st({ groupId: "A", readingId: "a0" }), 0, { paged: false, idle: false });
    check("B 0.90 ≥0.6、A 0.10 ≤0.25 → 立刻切、switched=down", r.groupId === "B" && r.switched === "down" && r.readingId === "b0", r);
  }
  // 4 0.78 / 0.22
  {
    const samples = [S(0.12, "a0", "A"), S(0.38, "b0", "B"), S(0.62, "b1", "B"), S(0.88, "a1", "A")];
    const r = L.decideAttention(samples, st({ groupId: "A", readingId: "a0" }), 0, { paged: false, idle: false });
    check("B 0.78 / A 0.22 → 立刻切", r.groupId === "B" && r.switched === "down", r);
  }
  // 5 0.50 / 0.50 不切
  {
    const samples = [S(0.12, "a0", "A"), S(0.38, "b0", "B"), S(0.62, "a1", "A"), S(0.88, "a2", "A")];
    const r = L.decideAttention(samples, st({ groupId: "A", readingId: "a0" }), 0, { paged: false, idle: false });
    check("B 0.50 / A 0.50 → 不切", r.groupId === "A" && r.switched === "", r);
  }
  // 6 更深一层仍算 A（节点切换需驻留 250ms）
  {
    const samples = L.ATTN.FRACS.map((f) => ({ frac: f, nodeId: "a2.1", chain: ["r", "A", "a2", "a2.1"] }));
    const prev = st({ groupId: "A", readingId: "a1" });
    const r1 = L.decideAttention(samples, prev, 0, { paged: false, idle: false });
    const r2 = L.decideAttention(samples, r1, 300, { paged: false, idle: false });
    check("样本在 A 成员的子节点 → 仍是 A；驻留后 readingId=a2（并给出 deepMember）", r1.groupId === "A" && r2.groupId === "A" && r2.readingId === "a2" && r2.switched === "" && r2.deepMember === "a2", { r1, r2 });
  }
  // 7 驻留
  {
    const samples = [S(0.12, "b0", "B"), S(0.38, "b1", "B"), S(0.62, "a0", "A"), S(0.88, "a1", "A")];
    const s0 = st({ groupId: "A", readingId: "a0", candGroup: null, candSince: 0 });
    const r1 = L.decideAttention(samples, s0, 100, { paged: false, idle: false });
    check("B 0.60 / A 0.40、非 idle → 不切（记候选）", r1.groupId === "A" && r1.candGroup === "B" && r1.candSince === 100, r1);
    const r2 = L.decideAttention(samples, r1, 700, { paged: false, idle: true });
    check("600ms 后 idle → 切", r2.groupId === "B" && r2.switched !== "", r2);
  }
  // §13.1 新增用例 8–13
  const S2 = (frac, chain) => ({ frac, nodeId: chain[chain.length - 1], chain });
  // 8 顶层不再卡住
  {
    const samples = L.ATTN.FRACS.map((f) => S2(f, ["c1", "s11", "p3"]));
    const r = L.decideAttention(samples, st({ groupId: ROOT_ID }), 0, { paged: false, idle: false });
    check("顶层不再卡住：立即下钻到 s11", r.groupId === "s11" && r.switched !== "", r);
  }
  // 9 顶层下钻要驻留
  {
    const samples = L.ATTN.FRACS.map((f) => S2(f, ["c1", "s11"]));
    const r1 = L.decideAttention(samples, st({ groupId: ROOT_ID }), 0, { paged: false, idle: false });
    check("顶层下钻需驻留：第一次不切、deepMember=c1、recheckMs=600", r1.groupId === ROOT_ID && r1.deepMember === "c1" && r1.recheckMs === 600, r1);
    const r2 = L.decideAttention(samples, r1, 650, { paged: false, idle: true });
    check("650ms + idle → 下钻到 c1", r2.groupId === "c1", r2);
  }
  // 10 深一层留在本组（并登记候选）
  {
    const samples = [S2(0.12, ["c1", "s11", "p2"]), S2(0.38, ["c1", "s11", "p3", "p3a"]), S2(0.62, ["c1", "s11", "p3", "p3a"]), S2(0.88, ["c1", "s11", "p3", "p3a"])];
    const r = L.decideAttention(samples, st({ groupId: "s11", readingId: null }), 0, { paged: false, idle: false });
    check("深一层：仍在本组 s11、readingId/deepMember=p3、候选=p3", r.groupId === "s11" && r.readingId === "p3" && r.deepMember === "p3" && r.candGroup === "p3", r);
  }
  // 11 放大
  {
    const prev = st({ groupId: "s11", readingId: "p3", candGroup: "p3", candSince: 0 });
    const samples = L.ATTN.FRACS.map((f) => S2(f, ["c1", "s11", "p3", "p3a"]));
    const r = L.decideAttention(samples, prev, 700, { paged: false, idle: true });
    check("放大：全部落在 p3a、驻留到点 → groupId=p3", r.groupId === "p3", r);
  }
  // 12 缩回
  {
    const samples = L.ATTN.FRACS.map((f) => S2(f, ["c1", "s11", "p4"]));
    const r = L.decideAttention(samples, st({ groupId: "p3", readingId: "p3a" }), 0, { paged: false, idle: false });
    check("缩回：旧组得分为 0 → 立即回 s11", r.groupId === "s11", r);
  }
  // 13 成员展开不当邻组
  {
    const samples = [S2(0.12, ["c1", "s11", "p2"]), S2(0.38, ["c1", "s11", "p2"]), S2(0.62, ["c1", "s11", "p3", "p3a"]), S2(0.88, ["c1", "s11", "p3", "p3a"])];
    const r = L.decideAttention(samples, st({ groupId: "s11", readingId: "p2" }), 0, { paged: false, idle: false });
    check("预览不把「成员展开」当邻组", r.peek === null, r);
  }
}

// ---------------------------------------------------------------- §13.4 颜色 / §13.2 粘滞 / §13.3 几何
console.log("---- §13.4 kidColor / §13.2 winStart / §13.3 geometryAt·buildPaintRects ----");
const COLORS = { dark: false, bg: "#fff", fg: "#111", accent: "#166a59", accentOn: "#fff", hairline: "#ccc", counter: "#b5483b", palette: ["#6E7F2E", "#A9821C", "#A84A80", "#3E8A82", "#3F68A8", "#6F5FB0", "#A44836", "#B2662A"], aHL: [0.16, 0.26, 0.38], aEnd: [0.34, 0.52, 0.6], aDim: 0.3, strandA: 0.62 };
const mkCtx = (g, cut, pattern, members, extra) => Object.assign({
  g, plan: { mode: "reserve", shift: 0, reserve: 390, barX: 700, labelX: 726, labelW: 248, right: 994 }, colors: COLORS, pattern, cut,
  header: String(g.nodes[cut]?.title ?? "材料"), patternName: L.PATTERN_LABEL[pattern], members,
  colorOf: new Map(members.map((id, i) => [id, i === 0 ? COLORS.accent : COLORS.palette[i % 8]])),
  paletteOf: new Map(members.map((id, i) => [id, COLORS.palette[i % 8]])),
  moreAbove: 0, moreBelow: 0, readingId: members[0] ?? null, readingBlock: null, selectedId: null, expandedId: null,
  inlineH: 0, maxLines0: 2, canBack: false, availH: 700, maxW: 520, cmpPage: 0,
}, extra || {});
{
  const c1 = L.kidColor("rgb(22, 106, 89)", "rgb(250, 250, 248)", 1);
  check("kidColor：rgb() → #rrggbb", /^#[0-9a-f]{6}$/i.test(c1) && !c1.includes("color-mix"), c1);
  const c2 = L.kidColor("rgb(22 106 89)", "#fafaf8", 2);
  check("kidColor：空格分隔 rgb() → #rrggbb", /^#[0-9a-f]{6}$/i.test(c2) && !c2.includes("color-mix"), c2);
  check("parseRgb：不可解析 → null", L.parseRgb("color-mix(in oklab, #123, #fff 20%)") === null);

  // fitLayout 粘滞
  const many = graph(
    [node("P", null, 0, "多", "其他"), ...Array.from({ length: 20 }, (_, i) => node(`m${i}`, "P", (i + 1) * 1000, `第${i}项`, "理由", { blockStart: i, blockEnd: i }))],
    [],
  );
  const all20 = Array.from({ length: 20 }, (_, i) => `m${i}`);
  const base = mkCtx(many, "P", "tree", all20, { readingId: "m10" });
  const first = L.fitLayout(base, all20, 700);
  const second = L.fitLayout({ ...base, readingId: "m11", winStart: 6 }, all20, 700);
  check("窗口粘滞：阅读节点在窗口内部时 members[0] 不变", first.members[0] === "m6" && second.members[0] === "m6", [first.members[0], second.members[0]]);

  // geometryAt
  const gbox = { key: "k", nodeId: "a", block: 1, top: 100, bottom: 160, left: 10, right: 100, column: 0, clipTop: false, clipBottom: false, doc: 0, cTop: 100, cBottom: 160, cLeft: 10, cRight: 100 };
  const g = { seq: 1, viewport: { left: 0, top: 0, right: 1200, bottom: 900 }, columns: [{ left: 10, right: 100 }], boxes: [gbox], text: { left: 10, right: 100 } };
  const ga1 = L.geometryAt(g, { 0: { left: 0, top: -50 } });
  check("geometryAt：偏移 -50 → top 50 / bottom 110", ga1.boxes[0].top === 50 && ga1.boxes[0].bottom === 110, ga1.boxes[0]);
  const ga2 = L.geometryAt(g, { 0: { left: 0, top: -200 } });
  check("geometryAt：完全移出视口 → 被裁掉", ga2.boxes.length === 0, ga2.boxes.length);

  // buildPaintRects 与 buildShapes 对齐
  const plan = { mode: "reserve", shift: 0, reserve: 390, barX: 700, labelX: 726, labelW: 248, right: 994 };
  const colors = COLORS;
  const ctx2 = mkCtx(graph([node("P", null, 0, "P", "其他"), node("a", "P", 1000, "A", "理由", { blockStart: 100, blockEnd: 160 })], []), "P", "tree", ["a"], { readingId: "a" });
  const layP = L.fitLayout(ctx2, ["a"], 700);
  const geoP = { seq: 2, viewport: { left: 0, top: 0, right: 1200, bottom: 900 }, columns: [{ left: 10, right: 100 }], boxes: [gbox, { ...gbox, key: "k2", top: 180, bottom: 220, cTop: 180, cBottom: 220 }], text: { left: 10, right: 100 } };
  const rects = L.buildPaintRects(geoP, layP, { hoverId: null, focusId: "a", colorOf: () => "#6E7F2E", colors });
  const shape = L.buildShapes(geoP, layP, 0, { hoverId: null, focusId: "a", readingId: "a", colorOf: () => "#6E7F2E" }).filter((s) => s.ribbon);
  check("buildPaintRects 与颈部对齐：left+width=xs、top=s0、top+height=s1", rects.length === 1 && shape.length === 1 && Math.abs(rects[0].left + rects[0].width - shape[0].xs) < 1 && Math.abs(rects[0].top - shape[0].s0) < 1 && Math.abs(rects[0].top + rects[0].height - shape[0].s1) < 1, { rects, shape: shape[0] });
}

// ---------------------------------------------------------------- §12.4.4 layoutPeek
console.log("---- layoutPeek ----");
{
  const g = graph([node("G", null, 0, "组", "论点"), node("k1", "G", 1000, "成员一", "理由"), node("k2", "G", 2000, "成员二", "例证")], []);
  const ctx = {
    g, plan: { mode: "reserve", shift: 0, reserve: 390, barX: 700, labelX: 726, labelW: 248, right: 994 },
    colors: { dark: false, bg: "#fff", fg: "#111", accent: "#166a59", accentOn: "#fff", hairline: "#ccc", counter: "#b5483b", palette: ["#6E7F2E"], aHL: [0.16, 0.26, 0.38], aEnd: [0.34, 0.52, 0.6], aDim: 0.3, strandA: 0.62 },
    pattern: "tree", cut: ROOT_ID, header: "材料", patternName: "大纲", members: [], colorOf: new Map(),
    moreAbove: 0, moreBelow: 0, readingId: null, readingBlock: null, selectedId: null, expandedId: null, inlineH: 0, maxLines0: 2, canBack: false, availH: 800, maxW: 500, cmpPage: 0,
  };
  const p = L.layoutPeek(ctx, "G", "below");
  check("预览：标题 + 成员 + 分隔线；成员标记 peek", p.items.filter((i) => i.peek).length === 3 && p.prims.some((x) => x.id === "peekline:G"), p.items.map((i) => i.id));
  check("预览：成员各有 port（流带落在细条上）", p.ports.length === 2 && p.leafIds.join() === "k1,k2");
  check("预览标题 meta=下一部分", p.items[0].meta === "下一部分", p.items[0].meta);
}

console.log("---- §14.3 上方槽 / 列顶留白 ----");
{
  check("ABOVE_SLOT 计入「另 N 项」= 88", L.COLUMN.ABOVE_SLOT === 88, L.COLUMN.ABOVE_SLOT);
  check("上方槽 ≥ 最坏预览高度（20 + 2×22 + 16）", L.COLUMN.ABOVE_SLOT - 8 >= 20 + 2 * 22 + 16, L.COLUMN.ABOVE_SLOT);
  check("COL_MARGIN_Y = 20", FLOW.COL_MARGIN_Y === 20, FLOW.COL_MARGIN_Y);
  // 3 个成员 → 2 行 + 「另 1 项」= 80，必须放得进 ABOVE_SLOT − 8
  const g = graph(
    [node("G", null, 0, "组", "论点"), node("k1", "G", 1000, "一", "理由"), node("k2", "G", 2000, "二", "理由"), node("k3", "G", 3000, "三", "理由")],
    [],
  );
  const ctx = {
    g, plan: { mode: "inside", shift: 0, reserve: 0, barX: 700, labelX: 726, labelW: 248, right: 994 }, colors: COLORS, pattern: "tree", cut: "G",
    header: "组", patternName: "大纲", members: ["k1", "k2", "k3"], colorOf: new Map([["k1", "#111"], ["k2", "#222"], ["k3", "#333"]]),
    paletteOf: new Map(), moreAbove: 0, moreBelow: 0, readingId: "k1", readingBlock: null, selectedId: null, expandedId: null,
    inlineH: 0, maxLines0: 2, canBack: false, availH: 800, maxW: 500, cmpPage: 0,
  };
  const p = L.layoutPeek(ctx, "G", "above", L.COLUMN.ABOVE_ROWS);
  check("2 行预览 + 另 1 项 的总高 ≤ 上方槽余量", p.height <= L.COLUMN.ABOVE_SLOT - 8, { h: p.height, slot: L.COLUMN.ABOVE_SLOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
