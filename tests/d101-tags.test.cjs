// D101 批A 标签系统纯函数回归（node 直跑：node tests/d101-tags.test.cjs）
// 覆盖：normalizeTag 规范矩阵 / tagPathMatches 层级边界 / applyTagDelta 并集加差集删 /
//       normalizeTags 去重 / parseCardQuery v2（tag:/type:/-tag:） / tagFilterMatches OR 语义 /
//       extractTagsOf 防御解析 / lintCard L17 超限提示（与 tags.ts 同源阈值）
// 契约：设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §1 + GUIDE §4.1/§6.3.4/§6.8-6（D101）
"use strict";
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";
const tags = require(path.join(ROOT, "tests", "d101-tags.bundle.cjs"));
const cardQuery = require(path.join(ROOT, "tests", "d101-cardquery.bundle.cjs"));
const cards = require(path.join(ROOT, "tests", "m1.cards.bundle.cjs"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("== D101-T1 normalizeTag 规范矩阵 ==");
check("普通标签", tags.normalizeTag("考研").ok === true && tags.normalizeTag("考研").tag === "考研", "考研", tags.normalizeTag("考研"));
check("层级标签", tags.normalizeTag("考研::英语").tag === "考研::英语", "考研::英语", tags.normalizeTag("考研::英语"));
check("首尾空白 strip", tags.normalizeTag("  考研  ").tag === "考研", "考研", tags.normalizeTag("  考研  "));
check("段首尾空白 strip", tags.normalizeTag("考研 :: 英语 ").tag === "考研::英语", "考研::英语", tags.normalizeTag("考研 :: 英语 "));
check("段内空白保留", tags.normalizeTag("错题 本").tag === "错题 本", "错题 本", tags.normalizeTag("错题 本"));
check("空串拒绝", tags.normalizeTag("").ok === false, false, tags.normalizeTag("").ok);
check("纯空白拒绝", tags.normalizeTag("   ").ok === false, false, tags.normalizeTag("   ").ok);
check("空段拒绝 a::", tags.normalizeTag("a::").ok === false, false, tags.normalizeTag("a::").ok);
check("空段拒绝 ::b", tags.normalizeTag("::b").ok === false, false, tags.normalizeTag("::b").ok);
check("连续分隔拒绝 a::::b", tags.normalizeTag("a::::b").ok === false, false, tags.normalizeTag("a::::b").ok);
check("段内半角冒号拒绝", tags.normalizeTag("a:b").ok === false, false, tags.normalizeTag("a:b").ok);
check("控制字符拒绝", tags.normalizeTag("a\u0007b").ok === false, false, tags.normalizeTag("a\u0007b").ok);
check("超 24 字拒绝", tags.normalizeTag("一二三四五六七八九十一二三四五六七八九十一二三四五").ok === false, false, tags.normalizeTag("一二三四五六七八九十一二三四五六七八九十一二三四五").ok);
check("恰好 24 字通过", tags.normalizeTag("一二三四五六七八九十一二三四五六七八九十一二三四").ok === true, true, tags.normalizeTag("一二三四五六七八九十一二三四五六七八九十一二三四").ok);
check("3 层通过", tags.normalizeTag("a::b::c").ok === true, true, tags.normalizeTag("a::b::c").ok);
check("4 层拒绝", tags.normalizeTag("a::b::c::d").ok === false, false, tags.normalizeTag("a::b::c::d").ok);

console.log("== D101-T2 tagPathMatches 层级边界（§1.5 核心语义） ==");
check("整串相等命中", tags.tagPathMatches("考研", "考研") === true, true, tags.tagPathMatches("考研", "考研"));
check("tag:考研 命中 考研::英语", tags.tagPathMatches("考研::英语", "考研") === true, true, tags.tagPathMatches("考研::英语", "考研"));
check("tag:考研 不命中 考研英语（非边界）", tags.tagPathMatches("考研英语", "考研") === false, false, tags.tagPathMatches("考研英语", "考研"));
check("大小写不敏感", tags.tagPathMatches("Kaoyan::English", "kaoyan") === true, true, tags.tagPathMatches("Kaoyan::English", "kaoyan"));
check("子层前缀不反向命中", tags.tagPathMatches("考研", "考研::英语") === false, false, tags.tagPathMatches("考研", "考研::英语"));
check("空 prefix 不命中", tags.tagPathMatches("考研", "") === false, false, tags.tagPathMatches("考研", ""));

console.log("== D101-T3 normalizeTags / applyTagDelta ==");
check("normalizeTags 去非法项", eq(tags.normalizeTags(["考研", "", "a:b", 42, "考研::英语"]), ["考研", "考研::英语"]), ["考研", "考研::英语"], tags.normalizeTags(["考研", "", "a:b", 42, "考研::英语"]));
check("normalizeTags 大小写不敏感去重保留首写法", eq(tags.normalizeTags(["Kaoyan", "kaoyan"]), ["Kaoyan"]), ["Kaoyan"], tags.normalizeTags(["Kaoyan", "kaoyan"]));
check("并集加：新标签入列", tags.applyTagDelta([], ["考研"], []).tags, ["考研"], tags.applyTagDelta([], ["考研"], []).tags);
check("并集加：已有该标签跳过（added=0）", (() => { const r = tags.applyTagDelta(["考研"], ["考研"], []); return r.tags.length === 1 && r.added === 0; })(), true, tags.applyTagDelta(["考研"], ["考研"], []));
check("并集加：大小写等价跳过且保留原写法", (() => { const r = tags.applyTagDelta(["Kaoyan"], ["kaoyan"], []); return r.added === 0 && eq(r.tags, ["Kaoyan"]); })(), true, tags.applyTagDelta(["Kaoyan"], ["kaoyan"], []));
check("差集删：删父级连子级（层级前缀语义）", (() => { const r = tags.applyTagDelta(["考研::英语", "口语"], [], ["考研"]); return eq(r.tags, ["口语"]) && r.removed === 1; })(), true, tags.applyTagDelta(["考研::英语", "口语"], [], ["考研"]));
check("删除不区分大小写", (() => { const r = tags.applyTagDelta(["Kaoyan"], [], ["kaoyan"]); return eq(r.tags, []) && r.removed === 1; })(), true, tags.applyTagDelta(["Kaoyan"], [], ["kaoyan"]));
check("NULL 当前值安全", tags.applyTagDelta(null, ["a"], []).tags, ["a"], tags.applyTagDelta(null, ["a"], []).tags);

console.log("== D101-T4 parseCardQuery v2（tag:/type:/-tag:） ==");
let q = cardQuery.parseCardQuery('tag:考研');
check("tag: 解析", eq(q.tag, ["考研"]), ["考研"], q.tag);
q = cardQuery.parseCardQuery('tag:"错题 本" -tag:待重读');
check("引号内空格保留", eq(q.tag, ["错题 本"]), ["错题 本"], q.tag);
check("-tag: 排除清单", eq(q.tagNeg, ["待重读"]), ["待重读"], q.tagNeg);
q = cardQuery.parseCardQuery('tag:考研 tag:口语');
check("多 tag token = OR 清单", eq(q.tag, ["考研", "口语"]), ["考研", "口语"], q.tag);
q = cardQuery.parseCardQuery('type:cloze');
check("type: 小写归一", q.type === "cloze", "cloze", q.type);
q = cardQuery.parseCardQuery('type:CLOZE kind:card');
check("type: 与 kind: 并存", q.type === "cloze" && q.kind === "card", { type: "cloze", kind: "card" }, { type: q.type, kind: q.kind });
q = cardQuery.parseCardQuery('-type:qa');
// v48.64（D108）v3：负号统一为 NOT 算子——-type: 由 v1/v2 的「落 exclude 不改义」升级为有效取反
check("-type: NOT 语义（leaf 包 not，扁平 type 不设）", q.type === undefined && q.ast?.t === "not" && q.ast?.kid?.leaf?.f === "type" && q.ast?.kid?.leaf?.value === "qa", true, q);

console.log("== D101-T5 tagFilterMatches（OR / 否定） ==");
q = cardQuery.parseCardQuery("tag:考研 tag:口语");
check("任一命中即过（OR）", cardQuery.tagFilterMatches(q, ["口语::发音"]) === true, true, null);
check("全不命中即拒", cardQuery.tagFilterMatches(q, ["听力"]) === false, false, null);
q = cardQuery.parseCardQuery("-tag:考研");
check("否定：命中即拒", cardQuery.tagFilterMatches(q, ["考研::英语"]) === false, false, null);
check("否定：不命中即过", cardQuery.tagFilterMatches(q, ["口语"]) === true, true, null);
q = cardQuery.parseCardQuery("tag:考研 -tag:考研::英语");
check("肯定+否定组合（否定按层级前缀精确匹配）", cardQuery.tagFilterMatches(q, ["考研::数学"]) === true && cardQuery.tagFilterMatches(q, ["考研::英语"]) === false, { a: true, b: false }, { a: cardQuery.tagFilterMatches(q, ["考研::数学"]), b: cardQuery.tagFilterMatches(q, ["考研::英语"]) });
check("否定不反向命中子级（考研::英语 ≠ tag:英语）", cardQuery.tagFilterMatches(cardQuery.parseCardQuery("-tag:英语"), ["考研::英语"]) === true, true, null);

console.log("== D101-T6 extractTagsOf 防御解析 ==");
check("正常数组", eq(cardQuery.extractTagsOf({ tagJson: '["a","b"]' }), ["a", "b"]), ["a", "b"], cardQuery.extractTagsOf({ tagJson: '["a","b"]' }));
check("坏 JSON 回落空", eq(cardQuery.extractTagsOf({ tagJson: "{bad" }), []), [], cardQuery.extractTagsOf({ tagJson: "{bad" }));
check("非数组回落空", eq(cardQuery.extractTagsOf({ tagJson: '"str"' }), []), [], cardQuery.extractTagsOf({ tagJson: '"str"' }));
check("null/缺失回落空", eq(cardQuery.extractTagsOf({}), []), [], cardQuery.extractTagsOf({}));
check("非串元素过滤", eq(cardQuery.extractTagsOf({ tagJson: '["a",42,null]' }), ["a"]), ["a"], cardQuery.extractTagsOf({ tagJson: '["a",42,null]' }));

console.log("== D101-T7 CardLint L17（与 tags.ts 同源阈值） ==");
let issues = cards.lintCard({ front: "front", back: "back", tags: Array.from({ length: 9 }, (_, i) => `t${i}`) });
check(">8 个标签 → L17 info", issues.some((i) => i.ruleId === "L17" && i.severity === "info"), true, issues.filter((i) => i.ruleId === "L17"));
issues = cards.lintCard({ front: "front", back: "back", tags: ["一二三四五六七八九十一二三四五六七八九十一二三四五"] });
check("单标签 >24 字 → L17", issues.some((i) => i.ruleId === "L17"), true, issues.filter((i) => i.ruleId === "L17"));
issues = cards.lintCard({ front: "front", back: "back", tags: ["a::b::c::d"] });
check("层级 >3 → L17", issues.some((i) => i.ruleId === "L17"), true, issues.filter((i) => i.ruleId === "L17"));
issues = cards.lintCard({ front: "front", back: "back", tags: ["考研", "考研::英语"] });
check("合规标签不触发 L17", !issues.some((i) => i.ruleId === "L17"), true, issues.filter((i) => i.ruleId === "L17"));
issues = cards.lintCard({ front: "front", back: "back" });
check("无标签不触发 L17", !issues.some((i) => i.ruleId === "L17"), true, issues.filter((i) => i.ruleId === "L17"));

console.log(`\nD101-tags 结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
