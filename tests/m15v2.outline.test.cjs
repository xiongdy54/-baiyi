// @runtime: node
// 材料导图 v2 行协议流式解析 + 逐行校验回归（node 直跑：node tests/m15v2.outline.test.cjs）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M2」；设计稿 §7、§8、§9.1–9.2。
const path = require("path");
const O = require(path.join(__dirname, "..", "electron", "mindmapOutline.js"));
const B = require(path.join(__dirname, "..", "electron", "mindmapBlocks.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 跑一遍：chunks 为字符串数组（逐次 push）或整串
function run(input, opts) {
  const nodes = [], drops = [], relEvents = [];
  const p = O.createLineParser(Object.assign({ scope: { blockFrom: 1, blockTo: 20 } }, opts || {}, {
    onNode: (n) => nodes.push(n), onDrop: (d) => drops.push(d), onRel: (r) => relEvents.push(r),
  }));
  for (const c of Array.isArray(input) ? input : [input]) p.push(c);
  const stats = p.end();
  return { nodes, drops, stats, relEvents, by: (k) => nodes.find((n) => n.path === k) };
}
const reasons = (r) => r.drops.map((d) => d.reason);

const SAMPLE = [
  "1 [问题] 优绩主义为何伤害所有人 @1-6 +",
  "1.1 [背景] 招生丑闻引出的追问 @1-3 .",
  "1.2 [论点] 赢家与输家同受其害 @4-6 +",
  "2 [论点] 输家：被羞辱的\"不配\" @7-19 + {论证}",
  "2.1 [理由] 失败被归为个人责任 @7-11 +",
  "2.2 [证据] 民调与死亡率数据 @12-15 .",
  "2.3 [反方观点] \"机会平等就够了\" @16-17 .",
  "2.4 [反驳] 平等起点也会固化等级 @18-19 . &驳2.3",
].join("\n") + "\n";

console.log("---- 1 常量 ----");
{
  check("TYPES 含 §8.1 全部 + 其他（26 项、无重复）", O.TYPES.length === 26 && new Set(O.TYPES).size === 26 && O.TYPES.includes("其他") && O.TYPES.includes("分情形") && O.TYPES.includes("反方观点"), O.TYPES);
  check("PATTERNS 七种", eq(O.PATTERNS, { 树: "tree", 链: "chain", 时间线: "timeline", 分层: "layered", 论证: "argument", 对照: "compare", 网格: "grid" }));
  check("REL_CODES 八类", eq(O.REL_CODES, ["支", "驳", "据", "推", "因", "比", "例", "答"]));
}

console.log("---- 2 基本解析（设计稿 §9.1 示例） ----");
{
  const r = run(SAMPLE, { scope: { blockFrom: 1, blockTo: 19 } });
  check("8 行全收", r.stats.accepted === 8 && r.stats.dropped === 0 && r.stats.lines === 8, r.stats);
  const n2 = r.by("2");
  check("字段完整", n2 && n2.parentPath === null && n2.type === "论点" && n2.title === "输家：被羞辱的\"不配\"" && n2.blockFrom === 7 && n2.blockTo === 19 && n2.more === true && n2.pattern === "argument" && n2.time === null && eq(n2.rels, []) && eq(n2.warnings, []), n2);
  check("子节点 parentPath / more=false", r.by("2.2").parentPath === "2" && r.by("2.2").more === false && r.by("2.2").pattern === null);
  check("关系 &驳2.3", eq(r.by("2.4").rels, [{ code: "驳", target: "2.3" }]));
  check("Stats 结构", eq(Object.keys(r.stats).sort(), ["accepted", "byReason", "clamped", "dropped", "lines", "relsDropped"]) && eq(Object.keys(r.stats.byReason).sort(), ["duplicate", "orphan", "out_of_scope", "truncated", "unparsable"]), r.stats);
  check("〈时间〉", run("1 [叙事] 攻占巴士底狱 〈1789年7月〉 @4-6 .\n").nodes[0].time === "1789年7月");
}

console.log("---- 3 流式：任意边界 push ----");
{
  const whole = run(SAMPLE, { scope: { blockFrom: 1, blockTo: 19 } });
  const chars = run(SAMPLE.split(""), { scope: { blockFrom: 1, blockTo: 19 } });
  check("逐 UTF-16 码元 push 与整段一致", eq(whole.nodes, chars.nodes) && eq(whole.stats, chars.stats));
  const astral = "1 [案例] 𠮷野家的故事 @1-2 .\n2 [案例] 第二个𠮷 @3 .";
  const a1 = run(astral), a2 = run(astral.split(""));
  check("代理对被拆开 push 也一致", eq(a1.nodes, a2.nodes) && a1.nodes[0].title === "𠮷野家的故事" && a1.stats.accepted === 2, a2.nodes);
  // 每行完整即刻回调
  const seen = [];
  const p = O.createLineParser({ scope: { blockFrom: 1, blockTo: 19 }, onNode: (n) => seen.push(n.path), onDrop: () => {} });
  p.push("1 [问题] 优绩主义为何伤害所有人 @1-6");
  check("行未完不回调", seen.length === 0);
  p.push(" +\n1.1 [背景] 招生");
  check("换行到达立即回调", eq(seen, ["1"]), seen);
  p.push("丑闻 @1-3 .\r\n");
  check("CRLF 行同样处理", eq(seen, ["1", "1.1"]), seen);
  const st = p.end();
  check("end 无残行", st.accepted === 2 && st.dropped === 0, st);
  // 随机切分多次
  let allSame = true;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 50; t++) {
    const parts = []; let i = 0;
    while (i < SAMPLE.length) { const k = 1 + Math.floor(rnd() * 9); parts.push(SAMPLE.slice(i, i + k)); i += k; }
    const rr = run(parts, { scope: { blockFrom: 1, blockTo: 19 } });
    if (!eq(rr.nodes, whole.nodes) || !eq(rr.stats, whole.stats)) allSame = false;
  }
  check("50 次随机切分结果一致", allSame);
  check("无结尾换行的完整末行在 end() 时接受", run("1 [问题] 标题甲 @1-3 +").stats.accepted === 1);
}

console.log("---- 4 容忍写法 ----");
{
  const r = run([
    "```text",
    "- 1 [论点] 列表符 @1-5 +",
    "* 1.1 [理由] 星号列表 @1-2 .",
    "    1.2 [理由] 缩进 @3 .   ",
    "\t2 【证据】 全角括号 @6–8 .",
    "3 [例证] 波浪号 @9~10 .",
    "4 [定义] 单块 @12 .",
    "5 [步骤] 全角连字与空格 @ 13 － 14 ＋ ｛链｝",
    "6.[步骤] 层级号后带点 @15 .",
    "```",
    "",
  ].join("\n"));
  check("代码围栏与空行不计入 lines，全部接受", r.stats.accepted === 8 && r.stats.dropped === 0 && r.stats.lines === 8, { s: r.stats, d: r.drops });
  check("- / * 前缀", r.by("1") && r.by("1.1") && r.by("1.1").title === "星号列表");
  check("缩进与行尾空白", r.by("1.2") && r.by("1.2").title === "缩进" && r.by("1.2").blockFrom === 3 && r.by("1.2").blockTo === 3);
  check("全角【】与 –", r.by("2").type === "证据" && r.by("2").blockFrom === 6 && r.by("2").blockTo === 8);
  check("~", r.by("3").blockFrom === 9 && r.by("3").blockTo === 10);
  check("@12 单块", r.by("4").blockFrom === 12 && r.by("4").blockTo === 12);
  check("全角 － ＋ ｛｝", r.by("5").blockTo === 14 && r.by("5").more === true && r.by("5").pattern === "chain", r.by("5"));
  check("层级号 6. 容忍", r.by("6") && r.by("6").path === "6");
  check("反转区间交换并警告", (() => { const x = run("1 [论点] 反转 @5-3 .\n").nodes[0]; return x.blockFrom === 3 && x.blockTo === 5 && x.warnings.includes("range_reversed"); })());
  check("标题内含 @ 与 + 仍可解析", (() => { const x = run("1 [推导] 邮箱a@b与N+1 @2-3 .\n").nodes[0]; return x && x.title === "邮箱a@b与N+1" && x.blockFrom === 2; })());
}

console.log("---- 5 丢弃理由 ----");
{
  const u = run("以下是结构：\n1 论点 缺括号 @1-2 .\n1 [论点] 缺标记 @1-2\n1 [论点] 缺区间 +\n0 [论点] 零号路径 @1 .\n1 [论点]  @1 .\n");
  check("unparsable：闲话/缺括号/缺标记/缺区间/0 段/空标题", u.stats.byReason.unparsable === 6 && u.stats.accepted === 0 && u.stats.dropped === 6 && reasons(u).every((x) => x === "unparsable"), u.stats);
  check("onDrop 带原始行", u.drops[0].raw === "以下是结构：", u.drops[0]);

  const o = run("1 [论点] 甲 @1-5 +\n2.1 [理由] 父不存在 @6 .\n1.1.1 [证据] 跳层 @1 .\n");
  check("orphan：父路径未出现 / 跳层", eq(reasons(o), ["orphan", "orphan"]) && o.stats.accepted === 1, o.drops);
  const od = run("1 [论点] 甲 @30-40 +\n1.1 [理由] 父被丢后代随之 orphan @31 .\n");
  check("父被丢弃 → 后代 orphan", eq(reasons(od), ["out_of_scope", "orphan"]), od.drops);

  const s = run("1 [论点] 甲 @5-10 +\n1.1 [理由] 无交集 @11-12 .\n1.2 [理由] 部分越界 @8-14 .\n2 [论点] 越出 scope @18-25 .\n3 [论点] 全在 scope 外 @21-22 .\n");
  check("out_of_scope：与父区间无交集", eq(reasons(s), ["out_of_scope", "out_of_scope"]), s.drops);
  check("钳制到父区间并 clamped++", s.by("1.2").blockFrom === 8 && s.by("1.2").blockTo === 10 && s.by("1.2").warnings.includes("clamped") && s.by("2").blockTo === 20 && s.stats.clamped === 2, s.stats);

  const d = run("1 [论点] 甲 @1-10 +\n1.1 [理由] 乙 @1-3 .\n1.2 [理由] 乙 @4-5 .\n1.3 [理由] 丙 @1-3 .\n1 [论点] 重复路径 @11 .\n2 [论点] 戊 @11-12 .\n2.1 [理由] 乙 @11 .\n1.4 [理由] 钳制后同区间 @0-3 .\n1.5 [理由] 甲子 @1-10 .\n");
  check("duplicate：同父同标题 / 同路径（后者丢）", eq(reasons(d), ["duplicate", "duplicate"]) && d.by("1.1").title === "乙", d.drops);
  check("同父同区间（含钳制后同区间）接受并标 same_range（OUTLINE_VERSION 2）", d.by("1.3") && d.by("1.3").warnings.includes("same_range") && d.by("1.4") && d.by("1.4").warnings.includes("same_range") && O.OUTLINE_VERSION === 2, d.drops);
  const dupAt = run("1 [反方观点] 御宅族系文化是日本文化的正统继承 @3 @5 .\n");
  check("标题尾部多余的 @区间 记号不进标题（2026-10-18 实测）", dupAt.by("1") && dupAt.by("1").title === "御宅族系文化是日本文化的正统继承" && dupAt.by("1").blockFrom === 5, dupAt.nodes && dupAt.nodes[0]);
  check("不同父的同标题不算重复", d.by("2.1") && d.by("2.1").title === "乙");
  check("子区间等于父区间不算重复（不同父）", d.by("1.5") && d.by("1.5").blockTo === 10, d.drops);

  const t = run(["1 [论点] 甲 @1-5 +\n", "1.1 [理由] 半截 @1-"]);
  check("truncated：end 时残行不完整", eq(reasons(t), ["truncated"]) && t.stats.byReason.truncated === 1 && t.stats.accepted === 1, t.stats);
  const t2 = run("1 [论点] 甲 @1-5 + {论");
  check("truncated：版式括号未闭合", eq(reasons(t2), ["truncated"]));
  check("accepted + dropped = lines", [u, o, s, d, t].every((r) => r.stats.accepted + r.stats.dropped === r.stats.lines));
}

console.log("---- 6 类型 / 版式 / 标题警告 ----");
{
  const r = run("1 [观点] 未知类型 @1 .\n2 [论点] 概述 @2 .\n3 [论点] 相关知识 @3 .\n4 [论点] 本章内容 @4 .\n5 [论点] 核心 @5 .\n6 [论点] 优绩主义的核心承诺 @6 .\n7 [论点] 未知版式 @7 + {星形}\n8 [论点] 这是一个明显超过二十个字的非常非常长的标题啊 @8 .\n");
  check("未知类型 → 其他 + warning", r.by("1").type === "其他" && r.by("1").warnings.includes("unknown_type:观点"), r.by("1"));
  check("空盒标题 warning 不丢", ["2", "3", "4", "5"].every((k) => r.by(k) && r.by(k).warnings.includes("empty_box_title")) && r.stats.accepted === 8);
  check("含『核心』的具体标题不误报", eq(r.by("6").warnings, []), r.by("6"));
  check("未知版式 → null + warning", r.by("7").pattern === null && r.by("7").warnings.includes("unknown_pattern:星形"));
  check("超长标题 warning 不丢", r.by("8").warnings.includes("title_long"));
  const all = run(Object.keys(O.PATTERNS).map((k, i) => `${i + 1} [分类] 版式${k} @${i + 1} + {${k}}`).join("\n") + "\n");
  check("七种版式全部映射", all.nodes.map((n) => n.pattern).join(",") === Object.values(O.PATTERNS).join(","));
}

console.log("---- 7 关系目标合法性 ----");
{
  const r = run([
    "1 [问题] 问 @1-4 +",
    "1.1 [论点] 甲 @1-2 .",
    "1.2 [论点] 乙 @3-4 . &比1.1 &答#k7",
    "2 [论点] 丙 @5-8 . &驳3 &支#k9 &答1 &比2 &例1.1",
    "3 [论点] 丁 @9 . &支1 &支1 &驳1.1 &比1.2 &例2 &因1",
    "4 [论点] 戊 @10 . &哈1 &支 1.1 &支x",
  ].join("\n") + "\n", { refs: new Set(["#k7"]) });
  check("非法关系只丢关系不丢节点", r.stats.accepted === 6 && r.stats.dropped === 0, r.stats);
  check("本次已出现路径 + refs 短号", eq(r.by("1.2").rels, [{ code: "比", target: "1.1" }, { code: "答", target: "#k7" }]), r.by("1.2").rels);
  check("前向引用不在 onNode 的 rels 里；未知短号/自指丢弃", eq(r.by("2").rels, [{ code: "答", target: "1" }, { code: "例", target: "1.1" }]), r.by("2").rels);
  check("前向引用 &驳3 在 3 被接受后经 onRel 补回", eq(r.relEvents, [{ from: "2", code: "驳", target: "3" }]), r.relEvents);
  check("每节点上限 3（含去重）", eq(r.by("3").rels, [{ code: "支", target: "1" }, { code: "驳", target: "1.1" }, { code: "比", target: "1.2" }]), r.by("3").rels);
  check("未知码 / 码后空格 / 非法目标", eq(r.by("4").rels, [{ code: "支", target: "1.1" }]), r.by("4").rels);
  // 2: &支#k9 未知 + &比2 自指 = 2（&驳3 前向已解析）；3: 重复1 + 超限2 = 3；4: &哈1 + &支x = 2
  check("relsDropped 计数", r.stats.relsDropped === 7, r.stats.relsDropped);
  check("refs 可传数组", eq(run("1 [论点] 甲 @1 . &答#k1\n", { refs: ["#k1"] }).nodes[0].rels, [{ code: "答", target: "#k1" }]));
  check("maxRelsPerNode 可配", run("1 [论点] 甲 @1 .\n2 [论点] 乙 @2 . &支1 &比1\n", { maxRelsPerNode: 1 }).nodes[1].rels.length === 1);
  const dd = run("1 [论点] 甲 @40 .\n2 [论点] 乙 @2 . &驳1\n");
  check("被丢弃的节点路径不可作为目标（挂起 → end 时丢弃）", eq(dd.nodes[0].rels, []) && dd.relEvents.length === 0 && dd.stats.relsDropped === 1, dd.stats);
}

console.log("---- 7b 关系前向引用（延迟解析） ----");
{
  const FWD = [
    "1 [问题] 问 @1-10 +",
    "1.1 [论点] 甲 @1-4 . &因1.2 &驳1.3 &支#k1",
    "1.2 [论点] 乙 @5-7 . &答1.1",
    "1.3 [论点] 丙 @8-10 . &比9 &支1.1",
    "2 [论点] 丁 @11 . &支1.2 &比1.2 &例1.1 &驳1",
  ].join("\n") + "\n";
  const opts = { refs: ["#k1"] };
  const r = run(FWD, opts);
  check("onNode.rels 只含已可解析关系", eq(r.by("1.1").rels, [{ code: "支", target: "#k1" }]) && eq(r.by("1.2").rels, [{ code: "答", target: "1.1" }]), r.nodes.map((n) => n.rels));
  check("前向引用目标出现后触发 onRel（按目标接受顺序）", eq(r.relEvents, [{ from: "1.1", code: "因", target: "1.2" }, { from: "1.1", code: "驳", target: "1.3" }]), r.relEvents);
  // 1.3: &比9 目标从未出现(挂起, 计入上限) + &支1.1 已解析；2: 支1.2 + 比1.2(同目标不同码) + 例1.1 = 3，驳1 超限
  check("上限 3 含挂起：1.1 有 因/驳(挂起)+支#k1 = 3", r.by("1.1").rels.length + r.relEvents.filter((e) => e.from === "1.1").length === 3);
  check("end 时未解析的挂起（&比9）丢弃并计入 relsDropped", r.stats.relsDropped === 2 && r.stats.accepted === 5, r.stats); // &比9 + 2 的 &驳1 超限
  // 同一目标、同一源、同一码的重复前向引用不重复回调
  const dup = run("1 [论点] 甲 @1 . &支2 &支2\n2 [论点] 乙 @2 .\n");
  check("重复前向引用去重", eq(dup.relEvents, [{ from: "1", code: "支", target: "2" }]) && dup.stats.relsDropped === 1, dup);
  // 目标被丢弃（重复路径/越界）→ end 时 relsDropped
  const lost = run("1 [论点] 甲 @1 . &支2 &驳3\n2 [论点] 乙 @50 .\n3 [论点] 丙 @3 .\n");
  check("前向引用目标被丢弃 → 不触发 onRel", eq(lost.relEvents, [{ from: "1", code: "驳", target: "3" }]) && lost.stats.relsDropped === 1, lost);
  check("自指、非法短号立即丢弃（不挂起）", (() => { const x = run("1 [论点] 甲 @1 . &支1 &答#zz\n"); return x.stats.relsDropped === 2 && x.relEvents.length === 0; })());
  // 逐字符 / 随机切分 与整段一致（含 onRel 序列）
  const chars = run(FWD.split(""), opts);
  check("逐字符 push 与整段一致（nodes / stats / onRel 序列）", eq(chars.nodes, r.nodes) && eq(chars.stats, r.stats) && eq(chars.relEvents, r.relEvents));
  let same = true, seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 30; t++) {
    const parts = []; let i = 0;
    while (i < FWD.length) { const k = 1 + Math.floor(rnd() * 9); parts.push(FWD.slice(i, i + k)); i += k; }
    const rr = run(parts, opts);
    if (!eq(rr.nodes, r.nodes) || !eq(rr.stats, r.stats) || !eq(rr.relEvents, r.relEvents)) same = false;
  }
  check("30 次随机切分一致", same);
  // expand：basePath 下前向引用同样映射为绝对路径
  const ex = run("1 [理由] 一 @7-8 . &驳2\n2 [反方观点] 二 @9 .\n", { scope: { blockFrom: 7, blockTo: 9 }, basePath: "2.4" });
  check("basePath 下 onRel 为绝对路径", eq(ex.relEvents, [{ from: "2.4.1", code: "驳", target: "2.4.2" }]), ex.relEvents);
}

console.log("---- 8 expand：basePath 相对 → 绝对 ----");
{
  const r = run("1 [理由] 子一 @7-11 + {链}\n1.1 [证据] 孙 @7-8 .\n2 [反方观点] 子二 @12-13 .\n3 [反驳] 子三 @14-15 . &驳2 &据1.1 &答#k2\n", { scope: { blockFrom: 7, blockTo: 15 }, basePath: "2.4", refs: new Set(["#k2"]) });
  check("路径映射", eq(r.nodes.map((n) => n.path), ["2.4.1", "2.4.1.1", "2.4.2", "2.4.3"]), r.nodes.map((n) => n.path));
  check("顶层 parentPath = basePath", r.by("2.4.1").parentPath === "2.4" && r.by("2.4.1.1").parentPath === "2.4.1");
  check("关系目标同样映射，短号不变", eq(r.by("2.4.3").rels, [{ code: "驳", target: "2.4.2" }, { code: "据", target: "2.4.1.1" }, { code: "答", target: "#k2" }]), r.by("2.4.3").rels);
  const s = run("1 [理由] 越界 @1-6 .\n2 [理由] 钳制 @14-30 .\n", { scope: { blockFrom: 7, blockTo: 15 }, basePath: "3" });
  check("expand 顶层以 scope 为父区间", eq(reasons(s), ["out_of_scope"]) && s.by("3.2").blockFrom === 14 && s.by("3.2").blockTo === 15 && s.stats.clamped === 1, s);
}

console.log("---- 9 isLocalFloor（§7 第 1 道门） ----");
{
  const para = (n) => "这是一个用来测试本地封顶规则的句子。".repeat(n); // 18 字/句
  const text = [para(10), para(20), para(3), para(4), para(4)].join("\n"); // 180 / 360 / 54 / 72 / 72
  const bl = B.segmentBlocks(text);
  check("测试块就绪", bl.length === 5 && B.blockTextLength(bl, 1, 1) === 180 && B.blockTextLength(bl, 2, 2) === 360, bl.map((b) => b.end - b.start));
  check("1 块且 <300 字 → 触底", O.isLocalFloor({ blockFrom: 1, blockTo: 1 }, bl, 1) === true);
  check("1 块但 ≥300 字 → 可深挖", O.isLocalFloor({ blockFrom: 2, blockTo: 2 }, bl, 1) === false);
  check("多块总长 <120 字 → 触底", O.isLocalFloor({ blockFrom: 3, blockTo: 3 }, bl, 1) === true && B.blockTextLength(bl, 4, 5) === 144 && O.isLocalFloor({ blockFrom: 4, blockTo: 5 }, bl, 1) === false);
  check("多块总长 ≥120 字 → 可深挖", O.isLocalFloor({ blockFrom: 1, blockTo: 3 }, bl, 2) === false);
  check("深度 ≥8 → 触底；7 不触底", O.isLocalFloor({ blockFrom: 1, blockTo: 5 }, bl, 8) === true && O.isLocalFloor({ blockFrom: 1, blockTo: 5 }, bl, 7) === false);
  check("区间超出块表按有效部分计", O.isLocalFloor({ blockFrom: 5, blockTo: 99 }, bl, 1) === true);
  // 第三条「单一引文/公式/图注」需块类型，M1 Block 无此信息，P0 不做（见源码注释）。
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
