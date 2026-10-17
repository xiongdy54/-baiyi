// @runtime: node
// 材料导图 v2 主进程纯核心回归（node 直跑：node tests/m15v2.core.test.cjs）。
// 依据：docs/design/MINDMAP-V2-IMPL-PLAN.md §6 T1 验收 ①–⑦（X1/X3/X6、§2、§4.5、§4.7、§5.3-7）。
const path = require("path");
const root = path.join(__dirname, "..", "electron");
const V = require(path.join(root, "mindmapV2Core.js"));
const B = require(path.join(root, "mindmapBlocks.js"));
const O = require(path.join(root, "mindmapOutline.js"));
const C = require(path.join(root, "mindmapCore.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const J = (x) => JSON.stringify(x);

// 确定性伪随机（测试数据生成用；被测模块本身无随机源）
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SENT = ["知识是经过检验的信念。", "这个定义解释了记忆的机制。", "作者先提出问题再给出回答。", "反方认为机会平等就够了。", "然而平等的起点也会固化等级。", "Short line.", "数据显示两组差异显著；"];
function para(rnd, n) { let s = ""; for (let i = 0; i < n; i++) s += SENT[Math.floor(rnd() * SENT.length)]; return s; }
function unitText(rnd, chars) {
  const lines = [];
  let len = 0;
  while (len < chars) {
    const r = rnd();
    const l = r < 0.15 ? `第${Math.floor(rnd() * 99)}节 小标题` : r < 0.25 ? "短句。" : para(rnd, 1 + Math.floor(rnd() * 60));
    lines.push(l);
    len += l.length + 1;
  }
  return lines.join(rnd() < 0.5 ? "\n" : "\n\n");
}
function linearOf(units, textByUnit) { return C.buildLinearization(units, new Map(Object.entries(textByUnit))); }

// ---------------------------------------------------------------- ①
console.log("---- ① segmentUnits：×100 逐字节一致、块号连续、unit 正确 ----");
{
  const rnd = lcg(7);
  const units = ["a.xhtml", "b.xhtml", "c.xhtml", "d.xhtml", "e.xhtml"];
  const tb = { "a.xhtml": unitText(rnd, 3000), "b.xhtml": "", "c.xhtml": "碎", "d.xhtml": unitText(rnd, 9000), "e.xhtml": unitText(rnd, 1500) };
  const lin = linearOf(units, tb);
  const first = J(B.segmentUnits(lin));
  let same = true;
  for (let i = 0; i < 100; i++) if (J(B.segmentUnits(lin)) !== first) same = false;
  check("100 次逐字节一致", same);
  const bs = B.segmentUnits(lin);
  check("块号 1..n 连续", bs.length > 10 && bs.every((b, i) => b.no === i + 1), bs.length);
  const unitOk = bs.every((b) => {
    const s = lin.unitBase[b.unit];
    const e = b.unit + 1 < units.length ? lin.unitBase[b.unit + 1] - 1 : lin.length;
    return b.start >= s && b.end <= e && b.start < b.end;
  });
  check("每块落在其 unit 的坐标区间内", unitOk);
  check("unit 单调不减、空单元无块", bs.every((b, i) => i === 0 || bs[i - 1].unit <= b.unit) && !bs.some((b) => b.unit === 1));
  // 与逐单元 segmentBlocks 平移等价（碎块不跨单元合并）
  const manual = [];
  units.forEach((u, i) => { for (const b of B.segmentBlocks(tb[u])) manual.push({ start: b.start + lin.unitBase[i], end: b.end + lin.unitBase[i], heading: b.heading, unit: i }); });
  check("≡ 每单元 segmentBlocks 后按 unitBase 平移", J(bs.map(({ no, ...r }) => r)) === J(manual));
  check("块文本＝单元文本切片", bs.every((b) => tb[units[b.unit]].includes(lin.text.slice(b.start, b.end))));
  check("单字单元独立成块（不并入邻单元）", bs.some((b) => b.unit === 2 && lin.text.slice(b.start, b.end) === "碎"));
  check("UNIT_BLOCKS_VERSION=1，原导出仍在", B.UNIT_BLOCKS_VERSION === 1 && B.BLOCKS_VERSION === 1 && typeof B.segmentBlocks === "function");
  // 增量：逐单元送入时块前缀稳定，extendUnitBlocks ≡ 全量
  let acc = [];
  let prefixStable = true;
  for (let k = 1; k <= units.length; k++) {
    const lk = linearOf(units.slice(0, k), tb);
    acc = V.extendUnitBlocks(acc, lk);
    if (J(acc) !== J(bs.filter((b) => b.unit < k))) prefixStable = false;
  }
  check("extendUnitBlocks 逐单元增量 ≡ segmentUnits 前缀", prefixStable && J(acc) === first);
  check("opts.fromUnit/startNo 增量", J(B.segmentUnits(lin, { fromUnit: 3, startNo: bs.find((b) => b.unit === 3).no })) === J(bs.filter((b) => b.unit >= 3)));
}

// ---------------------------------------------------------------- 夹具：目录书
function makeBook(seed) {
  const rnd = lcg(seed);
  const tocItems = [
    { anchor: "u0.xhtml", label: "前言" },
    { anchor: "u1.xhtml", label: "第一章 问题", children: [
      { anchor: "u2.xhtml", label: "1.1 背景" },
      { anchor: "u3.xhtml", label: "1.2 论证" },
      { anchor: "u3.xhtml#s2", label: "1.3 同单元并列" },
    ] },
    { anchor: "u4.xhtml", label: "第二章 巨章" },
    { anchor: "u7.xhtml", label: "第三章 短章" },
    { anchor: "u8.xhtml", label: "第四章 终章" },
  ];
  const units = ["u0.xhtml", "u1.xhtml", "u2.xhtml", "u3.xhtml", "u4.xhtml", "u5.xhtml", "u6.xhtml", "u7.xhtml", "u8.xhtml"];
  const sizes = [2500, 900, 5000, 4000, 9000, 9000, 9000, 200, 3000];
  const tb = {};
  units.forEach((u, i) => { tb[u] = unitText(rnd, sizes[i]); });
  tb["u7.xhtml"] = "第三章 短章\n" + "这一章只有很短的一段正文，用来检验作用域低于四百字时直接封顶、零调用。"; // <400 字
  return { title: "测试材料", tocItems, units, tb };
}

console.log("---- 骨架：复用 normalizeTocTree / 唯一归属 ----");
const book = makeBook(11);
const skel = V.buildSkeleton({ title: book.title, tocItems: book.tocItems, unitAnchors: book.units });
const fullLin = linearOf(book.units, book.tb);
const fullBlocks = B.segmentUnits(fullLin);
const fullScopes = V.planScopes(skel, fullBlocks, book.units.length);
{
  check("根 t0＝材料名、先序 id", skel.rootId === "t0" && skel.nodes[0].title === "测试材料" && skel.nodes.every((n, i) => n.nodeId === `t${i}`));
  const ch1 = skel.nodes.find((n) => n.title === "第一章 问题");
  check("父章节只拥有自身单元（子章节单元归子）", J(ch1.runs) === J([[1, 2]]), ch1.runs);
  const tie = skel.nodes.find((n) => n.title === "1.3 同单元并列");
  const s12 = skel.nodes.find((n) => n.title === "1.2 论证");
  check("同单元并列：文档序先者拥有，后者无原文", J(s12.runs) === J([[3, 4]]) && tie.runs.length === 0);
  const owned = new Map();
  for (const n of skel.nodes) for (const [a, b] of n.runs) for (let u = a; u < b; u++) owned.set(u, (owned.get(u) || 0) + 1);
  check("每单元至多一个拥有者（§15.1 唯一归属）", [...owned.values()].every((c) => c === 1) && owned.size === book.units.length);
  // 「正文」伪节点修复：顶层仅一项时塌缩为根
  const wrap = V.buildSkeleton({ title: "合成书", tocItems: [{ anchor: "x0.xhtml", label: "正文", children: [{ anchor: "x0.xhtml", label: "甲" }, { anchor: "x1.xhtml", label: "乙" }] }], unitAnchors: ["x0.xhtml", "x1.xhtml"] });
  check("「正文」包装层塌缩：根＝材料名、无「正文」节点", wrap.nodes[0].title === "合成书" && !wrap.nodes.some((n) => n.title === "正文") && wrap.nodes.length === 3);
  const noToc = V.buildSkeleton({ title: "无目录", tocItems: [], unitAnchors: ["a", "b"] });
  check("无目录：根拥有全部单元", noToc.nodes.length === 1 && J(noToc.nodes[0].runs) === J([[0, 2]]));
}

// ---------------------------------------------------------------- ②
console.log("---- ② 任意前缀送入：已放出作用域与全量规划一致 ----");
{
  let ok = true, mono = true, bad = null;
  let prev = [];
  for (let k = 0; k <= book.units.length; k++) {
    const lk = linearOf(book.units.slice(0, k), book.tb);
    const bk = B.segmentUnits(lk);
    const got = V.planScopes(skel, bk, k);
    const want = fullScopes.filter((s) => s.unitTo <= k);
    if (J(got) !== J(want)) { ok = false; bad = { k, got: got.map((s) => s.scopeId), want: want.map((s) => s.scopeId) }; }
    const ids = new Set(got.map((s) => s.scopeId));
    if (!prev.every((s) => ids.has(s.scopeId))) mono = false;
    prev = got;
  }
  check("每个前缀 k：planScopes ≡ 全量中单元段已送完者", ok, bad);
  check("放出集合单调增长", mono);
  // 多 seed
  let multi = true;
  for (const seed of [1, 2, 3, 4, 5]) {
    const bk0 = makeBook(seed);
    const sk = V.buildSkeleton({ title: bk0.title, tocItems: bk0.tocItems, unitAnchors: bk0.units });
    const full = V.planScopes(sk, B.segmentUnits(linearOf(bk0.units, bk0.tb)), bk0.units.length);
    for (let k = 0; k <= bk0.units.length; k++) {
      const got = V.planScopes(sk, B.segmentUnits(linearOf(bk0.units.slice(0, k), bk0.tb)), k);
      if (J(got) !== J(full.filter((s) => s.unitTo <= k))) multi = false;
    }
  }
  check("5 个随机材料逐前缀一致", multi);
  check("planScopes ×100 逐字节一致", Array.from({ length: 100 }, () => J(V.planScopes(skel, fullBlocks, 9))).every((x) => x === J(fullScopes)));
  // 骨架行：原文未送完的叶为 more，送完后按作用域判定
  const rows0 = V.skeletonRows(skel, [], 0);
  check("零原文时骨架行可画：叶 more / 父 open / 无原文 floor", rows0.find((r) => r.title === "1.2 论证").state === "more" && rows0.find((r) => r.nodeId === "t0").state === "open" && rows0.find((r) => r.title === "1.3 同单元并列").state === "floor" && rows0.every((r) => r.source === "toc" && r.blockStart === null));
}

// ---------------------------------------------------------------- ③
console.log("---- ③ <400 字 floor；>2 万字切 ≤1.2 万子作用域挂同一目录节点 ----");
{
  const short = skel.nodes.find((n) => n.title === "第三章 短章");
  const sShort = fullScopes.filter((s) => s.nodeId === short.nodeId);
  check("短章（<400 字）作用域 floor", sShort.length === 1 && sShort[0].floor && sShort[0].chars < 400, sShort);
  const rows = V.skeletonRows(skel, fullBlocks, 9, fullScopes);
  check("短章骨架行 state=floor（零调用）", rows.find((r) => r.nodeId === short.nodeId).state === "floor");
  check("其余叶 state=more", rows.find((r) => r.title === "1.1 背景").state === "more" && rows.find((r) => r.title === "第四章 终章").state === "more");
  const big = skel.nodes.find((n) => n.title === "第二章 巨章");
  const sBig = fullScopes.filter((s) => s.nodeId === big.nodeId);
  const bigBlocks = fullBlocks.filter((b) => b.unit >= 4 && b.unit < 7);
  const bigChars = bigBlocks.reduce((n, b) => n + b.end - b.start, 0);
  check("巨章 >2 万字", bigChars > 20000, bigChars);
  check("切成 ≥2 个子作用域、每个 ≤12000 字", sBig.length >= 2 && sBig.every((s) => s.chars <= 12000), sBig.map((s) => s.chars));
  check("子作用域挂同一目录节点、id＝节点id+p序", sBig.every((s, i) => s.nodeId === big.nodeId && s.scopeId === `${big.nodeId}p${i + 1}` && s.part === i + 1));
  check("子作用域按块边界首尾相接、覆盖整章", sBig[0].blockFrom === bigBlocks[0].no && sBig[sBig.length - 1].blockTo === bigBlocks[bigBlocks.length - 1].no && sBig.every((s, i) => i === 0 || s.blockFrom === sBig[i - 1].blockTo + 1));
  check("子作用域 chars 与块长一致", sBig.every((s) => s.chars === B.blockTextLength(fullBlocks, s.blockFrom, s.blockTo)));
  check("单作用域节点 scopeId=nodeId", fullScopes.filter((s) => s.nodeId !== big.nodeId).every((s) => s.scopeId === s.nodeId && s.part === 0));
  check("作用域 path＝根以下标题链", J(fullScopes.find((s) => s.nodeId === skel.nodes.find((n) => n.title === "1.1 背景").nodeId).path) === J(["第一章 问题", "1.1 背景"]));
  // 无目录长材料：根按块切
  const rnd = lcg(99);
  const tb = { a: unitText(rnd, 26000) };
  const sk = V.buildSkeleton({ title: "长文", tocItems: [], unitAnchors: ["a"] });
  const bl = B.segmentUnits(linearOf(["a"], tb));
  const sc = V.planScopes(sk, bl, 1);
  check("无目录 >2 万字：根下 ≥3 个 ≤1.2 万子作用域", sc.length >= 3 && sc.every((s) => s.nodeId === "t0" && s.chars <= 12000), sc.map((s) => s.chars));
}

// ---------------------------------------------------------------- 解析器→装配器 集成辅助
function runJob({ kind, target, basePath, levels, blocks, text, aliases, force, finishReason, aborted, refs }) {
  const asm = V.createJobAssembler({ kind, jobId: "j1", target, basePath, levels, blocks, aliases, force });
  const deltas = [];
  const parser = O.createLineParser({
    scope: { blockFrom: target.blockFrom, blockTo: target.blockTo },
    basePath, refs: refs || (aliases ? aliases.refSet : undefined),
    onNode: (n) => deltas.push(asm.onNode(n)),
    onRel: (r) => deltas.push(asm.onRel(r)),
  });
  parser.push(text);
  parser.end();
  return { res: asm.finish({ finishReason: finishReason || "stop", aborted }), deltas };
}
// 合成块：每块 200 字，块号 1..40
const synthBlocks = Array.from({ length: 40 }, (_, i) => ({ no: i + 1, start: i * 201, end: i * 201 + 200, heading: false, unit: 0 }));

// ---------------------------------------------------------------- ④
console.log("---- ④ 第 3 门：0/1 子 → floor 且唯一子丢 ----");
{
  const target = { nodeId: "t3.2", depth: 3, blockFrom: 10, blockTo: 15, hadChildren: false };
  const one = runJob({ kind: "expand", target, basePath: "t3.2", levels: 1, blocks: synthBlocks, text: "1 [理由] 唯一的理由 @10-15 +\n1.1 [证据] 其下证据 @10-12 .\n" });
  check("1 个直接子：目标 floor", one.res.targetState === "floor" && J(one.res.states) === J([{ nodeId: "t3.2", state: "floor" }]));
  check("唯一子及其后代被丢弃、不落库", J(one.res.discarded) === J(["t3.2.1", "t3.2.1.1"]) && one.res.upserts.length === 0 && one.res.edges.length === 0, one.res);
  const zero = runJob({ kind: "expand", target, basePath: "t3.2", levels: 1, blocks: synthBlocks, text: "坏行\n" });
  check("0 个子：目标 floor", zero.res.targetState === "floor" && zero.res.upserts.length === 0);
  const two = runJob({ kind: "expand", target, basePath: "t3.2", levels: 1, blocks: synthBlocks, text: "1 [理由] 理由甲 @10-12 .\n2 [理由] 理由乙 @13-15 +\n" });
  check("2 个子：目标 open、子节点路径式 id", two.res.targetState === "open" && J(two.res.upserts.map((r) => r.nodeId)) === J(["t3.2.1", "t3.2.2"]));
  check("子状态：'.'→floor、最末层 '+'→more", two.res.upserts[0].state === "floor" && two.res.upserts[1].state === "more");
  const forced = runJob({ kind: "expand", target: { ...target }, basePath: "t3.2", levels: 1, blocks: synthBlocks, text: "1 [理由] 唯一的理由 @10-15 .\n", force: true });
  check("force 跳过第 3 门：唯一子保留", forced.res.targetState === "open" && forced.res.upserts.length === 1);
  const rc = V.recheckAfterExpand({ nodeId: "x" }, [{ nodeId: "a", blockStart: 5, blockEnd: 5 }, { nodeId: "b", blockStart: 5, blockEnd: 5 }]);
  check("recheckAfterExpand：子覆盖同一块 → floor 并丢弃", rc.floor && J(rc.discard) === J(["a", "b"]));
  // 第 1、2 门
  check("nodeStateOf：'.' → floor", V.nodeStateOf({ blockFrom: 1, blockTo: 5, more: false }, synthBlocks, 2) === "floor");
  check("nodeStateOf：单块 <300 字 → floor（第 1 门）", V.nodeStateOf({ blockFrom: 3, blockTo: 3, more: true }, synthBlocks, 2) === "floor");
  check("nodeStateOf：深度 ≥8 → floor", V.nodeStateOf({ blockFrom: 1, blockTo: 5, more: true }, synthBlocks, 8) === "floor");
  check("nodeStateOf：多块 '+' → more", V.nodeStateOf({ blockFrom: 1, blockTo: 5, more: true }, synthBlocks, 2) === "more");
  const row = (state, a, b) => ({ nodeId: "n", state, blockStart: a, blockEnd: b });
  check("expandGate：floor 拒收；force 放行；第 1 门 force 也拒；无区间 no_text",
    V.expandGate(row("floor", 1, 5), synthBlocks, 2) === "floor" && V.expandGate(row("floor", 1, 5), synthBlocks, 2, { force: true }) === null &&
    V.expandGate(row("more", 3, 3), synthBlocks, 2, { force: true }) === "floor" && V.expandGate(row("more", null, null), synthBlocks, 2) === "no_text" &&
    V.expandGate(row("more", 30, 45), synthBlocks, 2) === "no_text");
  // 非最末层 '+' 叶 → floor
  const ol = runJob({ kind: "outline", target: { nodeId: "t5", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t5", levels: 2, blocks: synthBlocks,
    text: "1 [论点] 甲 @1-10 +\n1.1 [理由] 甲一 @1-5 +\n1.2 [理由] 甲二 @6-10 .\n2 [论点] 乙 @11-20 +\n" });
  const st = Object.fromEntries(ol.res.upserts.map((r) => [r.nodeId, r.state]));
  check("outline：有子→open、最末层 '+'→more、非最末层 '+' 无子→floor", st["t5.1"] === "open" && st["t5.1.1"] === "more" && st["t5.1.2"] === "floor" && st["t5.2"] === "floor", st);
  check("流式 delta：首节点即发、父 more→open 状态即时推送", ol.deltas[0].nodes[0].nodeId === "t5.1" && ol.deltas[0].states.some((s) => s.nodeId === "t5" && s.state === "open") && ol.deltas[1].states.some((s) => s.nodeId === "t5.1" && s.state === "open"));
  check("ord＝起始块*1000+序", ol.res.upserts.find((r) => r.nodeId === "t5.2").ord === 11 * 1000 + 1 && ol.res.upserts.find((r) => r.nodeId === "t5.1").ord === 1000);
  check("NodeRow 字段齐（§3.2）", J(Object.keys(ol.res.upserts[0])) === J(["nodeId", "parentId", "ord", "title", "type", "time", "pattern", "blockStart", "blockEnd", "spans", "state", "source", "warnings", "explain", "jobId"]));
  check("spans＝块区间码元坐标", J(ol.res.upserts[0].spans) === J([[0, 9 * 201 + 200]]));
  // 子作用域：顶层父 → 目录节点
  const sub = runJob({ kind: "outline", target: { nodeId: "t3", depth: 1, blockFrom: 21, blockTo: 40, hadChildren: true }, basePath: "t3p2", levels: 2, blocks: synthBlocks, text: "1 [论点] 丙 @21-30 .\n2 [论点] 丁 @31-40 .\n" });
  check("子作用域：id＝t3p2.N、parentId＝目录节点 t3", J(sub.res.upserts.map((r) => [r.nodeId, r.parentId])) === J([["t3p2.1", "t3"], ["t3p2.2", "t3"]]));
  // length 回标
  const tr = runJob({ kind: "outline", target: { nodeId: "t6", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t6", levels: 3, blocks: synthBlocks,
    text: "1 [论点] 甲 @1-10 +\n1.1 [理由] 甲一 @1-5 .\n2 [论点] 乙 @11-20 +\n2.1 [理由] 乙一 @11-14 .\n2.2 [理由] 乙二 @15", finishReason: "length" });
  const ts = Object.fromEntries(tr.res.upserts.map((r) => [r.nodeId, r.state]));
  check("length：最后接受行的祖先链与目标回标 more", ts["t6.2.1"] === "more" && ts["t6.2"] === "more" && tr.res.targetState === "more" && ts["t6.1"] === "open" && ts["t6.1.1"] === "floor", { ts, t: tr.res.targetState });
  check("length：截断链上不生成覆盖桩", !tr.res.stubs.some((s) => s.parentId === "t6" || s.parentId === "t6.2"));
  const ab = runJob({ kind: "expand", target: { nodeId: "t7", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t7", levels: 1, blocks: synthBlocks, text: "1 [理由] 唯一 @1-5 .\n", aborted: true });
  check("取消：已校验行照样落库、不过第 3 门、无桩", ab.res.upserts.length === 1 && ab.res.discarded.length === 0 && ab.res.stubs.length === 0 && ab.res.targetState === "open");
  const ab0 = runJob({ kind: "expand", target: { nodeId: "t7", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t7", levels: 1, blocks: synthBlocks, text: "", aborted: true });
  check("取消且无子：目标保持 more", ab0.res.targetState === "more");
}

// ---------------------------------------------------------------- ⑤
console.log("---- ⑤ 覆盖桩：仅父区间连续 ≥2 块未覆盖才生成 ----");
{
  const s1 = V.coverageStubs("p", { blockFrom: 1, blockTo: 10 }, [{ blockFrom: 1, blockTo: 4 }, { blockFrom: 6, blockTo: 10 }]);
  check("缺口 1 块：不生成", s1.length === 0, s1);
  const s2 = V.coverageStubs("p", { blockFrom: 1, blockTo: 10 }, [{ blockFrom: 1, blockTo: 3 }, { blockFrom: 6, blockTo: 8 }], { blocks: synthBlocks, jobId: "j" });
  check("缺口 4-5 与 9-10：两个桩", J(s2.map((s) => [s.nodeId, s.blockStart, s.blockEnd, s.title, s.state, s.source])) === J([["p.g4", 4, 5, "其余 2 段", "stub", "local"], ["p.g9", 9, 10, "其余 2 段", "stub", "local"]]), s2);
  check("首部缺口亦计", V.coverageStubs("p", { blockFrom: 1, blockTo: 10 }, [{ blockFrom: 4, blockTo: 10 }]).map((s) => s.blockStart + "-" + s.blockEnd).join() === "1-3");
  check("全覆盖：无桩", V.coverageStubs("p", { blockFrom: 1, blockTo: 10 }, [{ blockFrom: 1, blockTo: 10 }]).length === 0);
  const job = runJob({ kind: "outline", target: { nodeId: "t2", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t2", levels: 2, blocks: synthBlocks,
    text: "1 [问题] 甲 @1-8 +\n1.1 [背景] 甲一 @1-3 .\n1.2 [论点] 甲二 @6-8 .\n2 [论点] 乙 @10-17 .\n" });
  check("任务内：目标缺口 9（1 块）不桩、18-20 桩；子父 4-5 桩", J(job.res.stubs.map((s) => s.nodeId)) === J(["t2.g18", "t2.1.g4"]), job.res.stubs.map((s) => s.nodeId));
  check("桩落在 upserts 末尾、parentId 正确", job.res.upserts.slice(-2).every((r) => r.source === "local") && job.res.stubs[1].parentId === "t2.1");
}

// ---------------------------------------------------------------- ⑥
console.log("---- ⑥ v1 夹具适配：成树、状态正确 ----");
{
  // 结构形态取 tests/m15r.engine.test.cjs（BASE 两章 + sec1/sec2 + finalizeMap 落库字段）
  const textByUnit = { "u1.xhtml": "第一章正文。知识是经过检验的信念。这里给出定义。", "u2.xhtml": "第二章正文。这个定义解释了记忆的机制。机制说明在此。" };
  const lin = linearOf(["u1.xhtml", "u2.xhtml"], textByUnit);
  const L1 = textByUnit["u1.xhtml"].length;
  const u2 = L1 + 1;
  const structure = {
    version: 1, generatorVersion: "m15r-engine-3", title: "测试材料", rootNodeId: "root",
    nodes: [
      { id: "root", parentId: null, title: "测试材料", authorialRole: null, childIds: ["n1", "n4"], evidence: [], compositionalEvidence: [], flags: [], unitAnchors: [] },
      { id: "n1", parentId: "root", title: "概念建立", authorialRole: "introduce", centralQuestion: "什么是知识", mainMove: "给出定义", progression: "从直觉到严格定义", childIds: ["n2"], unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识是经过检验的信念", unitAnchor: "u1.xhtml", matchStart: 6, matchEnd: 16 }], flags: [], sourceSpans: [[0, L1]], spanOrigin: "toc", expandable: false, stopReason: "atomic_structure" },
      { id: "n2", parentId: "n1", title: "核心定义句", authorialRole: "introduce", relationToParent: "本节核心主张", childIds: ["n3"], unitAnchors: ["u1.xhtml"], evidence: [], flags: [], sourceSpans: [[6, 16]], spanOrigin: "evidence", expandable: false },
      { id: "n3", parentId: "n2", title: "定义的补足语", authorialRole: "distinguish", relationToParent: "定义的构成", childIds: [], unitAnchors: ["u1.xhtml"], evidence: [], flags: [], sourceSpans: [[16, 22]], spanOrigin: "evidence" },
      { id: "n4", parentId: "root", title: "机制解释", authorialRole: "cause_effect", centralQuestion: "如何运作", mainMove: "解释机制", childIds: ["n5"], unitAnchors: ["u2.xhtml"], evidence: [], flags: [], sourceSpans: [[u2, lin.length]], expandable: false },
      { id: "n5", parentId: "n4", title: "机制句", authorialRole: "cause_effect", relationToParent: "x", childIds: [], unitAnchors: ["u2.xhtml"], evidence: [], flags: [], sourceSpans: [[u2 + 6, u2 + 18]], expandable: true, stopReason: null },
      { id: "n6", parentId: "n4", title: "无作用域", authorialRole: "bogus", childIds: [], evidence: [], flags: [], sourceSpans: [], expandable: true },
      { id: "n7", parentId: "ghost", title: "孤儿", authorialRole: "summary", childIds: [], evidence: [], flags: [], sourceSpans: [[0, 5]], expandable: false },
    ],
    edges: [], summaryText: "x",
  };
  const blocks = B.segmentUnits(lin);
  const a = V.adaptV1Structure(structure, blocks);
  const byId = new Map(a.rows.map((r) => [r.nodeId, r]));
  const reach = (id) => { const g = new Set(); let c = byId.get(id); while (c && c.parentId != null && !g.has(c.nodeId)) { g.add(c.nodeId); c = byId.get(c.parentId); } return c && c.nodeId === "root"; };
  check("成树：单根、全部可达、无环", a.rootId === "root" && a.rows.filter((r) => r.parentId == null).length === 1 && a.rows.every((r) => r.nodeId === "root" || reach(r.nodeId)));
  check("孤儿挂根并加 warning", byId.get("n7").parentId === "root" && byId.get("n7").warnings.includes("v1_orphan"));
  check("状态：有 childIds→open", byId.get("n1").state === "open" && byId.get("n2").state === "open" && byId.get("n4").state === "open");
  check("状态：expandable!==false 且有区间→more", byId.get("n5").state === "more" && byId.get("n3").state === "more");
  check("状态：expandable=false / 无区间→floor", byId.get("n6").state === "floor" && byId.get("n7").state === "floor");
  check("类型映射 authorialRole→v2（越界→其他）", byId.get("n1").type === "引言" && byId.get("n4").type === "因果" && byId.get("n3").type === "对比" && byId.get("n6").type === "其他" && byId.get("n7").type === "总结");
  check("sourceSpans→相交块区间", byId.get("n1").blockStart === 1 && byId.get("n1").blockEnd === blocks.filter((b) => b.unit === 0).slice(-1)[0].no && byId.get("n5").blockStart === blocks.find((b) => b.unit === 1).no);
  check("合成 explain（零调用）", /核心问题：什么是知识/.test(byId.get("n1").explain.text) && /作者动作：给出定义/.test(byId.get("n1").explain.text) && byId.get("n6").explain === null);
  check("source=v1ext、childIds 顺序→ord", a.rows.every((r) => r.source === "v1ext") && byId.get("n1").ord === 0 && byId.get("n4").ord === 1);
  const noText = V.adaptV1Structure(structure);
  check("原文未送入：区间留空、状态不变", noText.rows.every((r) => r.blockStart === null) && J(noText.rows.map((r) => r.state)) === J(a.rows.map((r) => r.state)));
  check("v1 适配 ×100 逐字节一致", Array.from({ length: 100 }, () => J(V.adaptV1Structure(structure, blocks))).every((x) => x === J(a)));
  // 叠加 v2 深挖产物（parentId 指向 v1 节点）
  const extra = [{ nodeId: "n5.1", parentId: "n5", ord: 0, title: "甲", type: "步骤", state: "floor", source: "ai" }, { nodeId: "n5.2", parentId: "n5", ord: 1, title: "乙", type: "步骤", state: "floor", source: "ai" }];
  const ov = V.overlayRows(a.rows, extra);
  check("叠加：v1 more 节点获 v2 子后 open、子挂其下", ov.find((r) => r.nodeId === "n5").state === "open" && ov.filter((r) => r.parentId === "n5").length === 2);
  check("v1 structure_json 不被改写", structure.nodes[5].expandable === true && !("state" in structure.nodes[5]));
  // 语义包字段
  const cf = V.deriveCardFields({ row: byId.get("n1"), rows: a.rows, blocks, linear: lin, mapId: "m1" });
  check("语义包：mindmapNodeId=v2:mapId:nodeId、类型回映 authorialRole", cf.mindmapNodeId === "v2:m1:n1" && cf.authorialRole === "introduce" && cf.type === "引言");
  check("语义包：父链/子结构/证据≤3×≤60/unitAnchors 由块推出", cf.parentChain.length === 1 && cf.children[0].title === "核心定义句" && cf.evidence.length >= 1 && cf.evidence.length <= 3 && cf.evidence.every((e) => [...e].length <= 60) && J(cf.unitAnchors) === J(["u1.xhtml"]) && /核心问题/.test(cf.explainText));
  check("类型全表可回映（其他→null）", O.TYPES.every((t) => t === "其他" ? V.typeToV1Role(t) === null : C.AUTHORIAL_ROLES.includes(V.typeToV1Role(t))));
  check("v1 17 值全部有映射且落在 v2 类型表", C.AUTHORIAL_ROLES.every((r) => O.TYPES.includes(V.V1_ROLE_TO_TYPE[r])) && Object.keys(V.V1_ROLE_TO_TYPE).length === 17);
}

// ---------------------------------------------------------------- ⑦
console.log("---- ⑦ 别名表确定性（X6） ----");
{
  const rows = V.skeletonRows(skel, fullBlocks, 9, fullScopes);
  const target = skel.nodes.find((n) => n.title === "1.2 论证").nodeId;
  const c1 = V.outlineRefCandidates(rows, target);
  const t1 = V.buildAliasTable(c1);
  check("outline 清单：骨架目录、去根与目标、文档序", !c1.some((c) => c.nodeId === "t0" || c.nodeId === target) && c1[0].title === "前言" && c1.length === skel.nodes.length - 2);
  check("别名按清单顺序 #k1..#kN", t1.refs.every((r, i) => r.id === `#k${i + 1}` && t1.aliasToNode[r.id] === c1[i].nodeId) && t1.refSet.has("#k1"));
  check("同输入 ×100 逐字节一致", Array.from({ length: 100 }, () => { const t = V.buildAliasTable(V.outlineRefCandidates(rows, target)); return J([t.refs, t.aliasToNode, t.text]); }).every((x) => x === J([t1.refs, t1.aliasToNode, t1.text])));
  check("行序打乱不影响清单（按 ord/文档序）", J(V.outlineRefCandidates(rows.slice().reverse(), target)) === J(c1));
  check("重复 nodeId 去重、标题空白归一", J(V.buildAliasTable([{ nodeId: "a", title: " 甲\n乙 " }, { nodeId: "a", title: "x" }, { nodeId: "b", title: "丙" }]).refs) === J([{ id: "#k1", title: "甲 乙" }, { id: "#k2", title: "丙" }]));
  check("别名表文本＝提示词引用块（入缓存哈希）", t1.text.split("\n")[0] === `#k1 ${c1[0].title}`);
  // expand 清单：祖先 → 兄弟 → 已有关系 → 本章前两层
  const R = (nodeId, parentId, ord, title, source) => ({ nodeId, parentId, ord, title, source: source || "ai", state: "open" });
  const g = [R("t0", null, 0, "书", "toc"), R("t1", "t0", 1000, "第一章", "toc"), R("t1.1", "t1", 1000, "论点甲"), R("t1.1.1", "t1.1", 1000, "理由一"), R("t1.1.2", "t1.1", 3000, "理由二"),
    R("t1.1.1.1", "t1.1.1", 1000, "证据"), R("t1.2", "t1", 5000, "论点乙"), R("t1.2.1", "t1.2", 5000, "乙下"), R("t2", "t0", 9000, "第二章", "toc"), R("t2.1", "t2", 9000, "远处问题")];
  const edges = [{ fromId: "t2.1", toId: "t1.1.2", code: "答" }];
  const ec = V.expandRefCandidates(g, edges, "t1.1.2");
  check("expand 清单顺序：祖先→兄弟→关系→本章前两层，去目标", J(ec.map((c) => c.nodeId)) === J(["t1", "t1.1", "t1.1.1", "t2.1", "t1.2", "t1.2.1"]), ec.map((c) => c.nodeId));
  check("expand 清单不含目标后代", !V.expandRefCandidates(g, [], "t1.1").some((c) => c.nodeId.startsWith("t1.1.")));
  // 关系经别名表解析为边
  const al = V.buildAliasTable([{ nodeId: "t9.4", title: "旧制度为何陷入危机" }]);
  const rj = runJob({ kind: "outline", target: { nodeId: "t2", depth: 1, blockFrom: 1, blockTo: 20, hadChildren: false }, basePath: "t2", levels: 1, blocks: synthBlocks, aliases: al,
    text: "1 [问题] 甲 @1-10 . &答#k1 &支2\n2 [论点] 乙 @11-20 . &驳#k9\n" });
  check("关系：#k 经别名表→节点 id；前向路径解析；未知短号丢", J(rj.res.edges.map((e) => [e.fromId, e.toId, e.code])) === J([["t2.1", "t9.4", "答"], ["t2.1", "t2.2", "支"]]), rj.res.edges);
}

// ---------------------------------------------------------------- 缓存键
console.log("---- 缓存键（§4.5） ----");
{
  const base = { documentId: "d", kind: "outline", blockFrom: 3, blockTo: 40, promptScope: "material-map-outline", promptVersion: 1, userText: "U", provider: "p", model: "m", maxTokens: 3000 };
  const k = V.cacheKeyOf(base);
  check("outline unitAnchor=blk:from-to、granularity=v2", k.unitAnchor === "blk:3-40" && k.runKind === "outline" && k.granularity === "v2" && k.textHash === V.sha256("U"));
  check("expand unitAnchor 加 #nodeId", V.cacheKeyOf({ ...base, kind: "expand", nodeId: "t3.2" }).unitAnchor === "blk:3-40#t3.2");
  check("同输入键稳定", J(V.cacheKeyOf(base)) === J(k));
  check("用户消息（含别名表）/maxTokens/model/reasoningEffort 变化即变键",
    V.cacheKeyOf({ ...base, userText: "U2" }).textHash !== k.textHash && V.cacheKeyOf({ ...base, maxTokens: 1500 }).modelConfigHash !== k.modelConfigHash &&
    V.cacheKeyOf({ ...base, model: "m2" }).modelConfigHash !== k.modelConfigHash && V.cacheKeyOf({ ...base, reasoningEffort: "low" }).modelConfigHash !== k.modelConfigHash);
  check("modelConfigHash 含 ENGINE_VERSION/UNIT_BLOCKS_VERSION/OUTLINE_VERSION", k.modelConfigHash === V.sha256(JSON.stringify(["m", null, "m15v2-engine-1", 1, O.OUTLINE_VERSION, 3000])));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
