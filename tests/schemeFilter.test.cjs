// D158 方案表格过滤纯函数回归（node 直跑：node tests/schemeFilter.test.cjs）
// 覆盖（OPUS 方案 v2 §8.4 U1–U8）：buildSchemeFilter 空条件 null / 多书 IN / `::` 层级前缀 /
//   多值 OR / 归并族命中 / 族未解析回退 / 条件 AND / 摘录行 kp 恒不命中 + 标签惰性解析
// 契约：GUIDE §6.8-5「表格侧语义」（D158）；标签分隔符＝项目约定 `::`（tags.ts TAG_SEP）
"use strict";
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";
const sf = require(path.join(ROOT, "tests", "schemeFilter.bundle.cjs"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

console.log("== D158-U1 buildSchemeFilter 空条件 ==");
check("全空 → null", sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: [], kpFamily: null }) === null, null, sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: [], kpFamily: null }));
check("仅书 → 非 null", sf.buildSchemeFilter({ bookItemIds: ["A"], tags: [], kpIds: [], kpFamily: null }) !== null, true, "non-null");
check("仅标签 → 非 null", sf.buildSchemeFilter({ bookItemIds: [], tags: ["英语"], kpIds: [], kpFamily: null }) !== null, true, "non-null");
check("仅知识点 → 非 null", sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: ["X"], kpFamily: null }) !== null, true, "non-null");
check("空白标签视为无标签（全空 → null）", sf.buildSchemeFilter({ bookItemIds: [], tags: ["", "  "], kpIds: [], kpFamily: null }) === null, null, sf.buildSchemeFilter({ bookItemIds: [], tags: ["", "  "], kpIds: [], kpFamily: null }));

console.log("== D158-U2 来源书多选 IN ==");
const fBooks = sf.buildSchemeFilter({ bookItemIds: ["A", "B"], tags: [], kpIds: [], kpFamily: null });
check("bookId=A ✓", sf.cardMatchesScheme(fBooks, { bookId: "A" }) === true, true, true);
check("bookId=B ✓", sf.cardMatchesScheme(fBooks, { bookId: "B" }) === true, true, true);
check("bookId=C ✗", sf.cardMatchesScheme(fBooks, { bookId: "C" }) === false, false, false);
check("bookId=null ✗", sf.cardMatchesScheme(fBooks, { bookId: null }) === false, false, false);

console.log("== D158-U3 标签层级前缀（`::` 边界）==");
const fTag = sf.buildSchemeFilter({ bookItemIds: [], tags: ["英语"], kpIds: [], kpFamily: null });
check("[英语::词汇] ✓（前缀命中）", sf.cardMatchesScheme(fTag, { bookId: null, tags: ["英语::词汇"] }) === true, true, true);
check("[英语] ✓（等值）", sf.cardMatchesScheme(fTag, { bookId: null, tags: ["英语"] }) === true, true, true);
check("[英语学] ✗（无边界）", sf.cardMatchesScheme(fTag, { bookId: null, tags: ["英语学"] }) === false, false, false);
check("[] ✗", sf.cardMatchesScheme(fTag, { bookId: null, tags: [] }) === false, false, false);
check("tags 缺省 ✗", sf.cardMatchesScheme(fTag, { bookId: null }) === false, false, false);

console.log("== D158-U4 标签多值 OR ==");
const fTags = sf.buildSchemeFilter({ bookItemIds: [], tags: ["英语", "数学"], kpIds: [], kpFamily: null });
check("[数学::代数] ✓（第二个标签命中）", sf.cardMatchesScheme(fTags, { bookId: null, tags: ["数学::代数"] }) === true, true, true);
check("[历史] ✗（都不命中）", sf.cardMatchesScheme(fTags, { bookId: null, tags: ["历史"] }) === false, false, false);

console.log("== D158-U5 知识点归并族 ==");
const fKp = sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: ["X"], kpFamily: new Set(["X", "Y"]) });
check("kpId=Y ✓（族成员）", sf.cardMatchesScheme(fKp, { bookId: null, kpId: "Y" }) === true, true, true);
check("kpId=Z ✗", sf.cardMatchesScheme(fKp, { bookId: null, kpId: "Z" }) === false, false, false);
check("未挂 kpId ✗", sf.cardMatchesScheme(fKp, { bookId: null }) === false, false, false);

console.log("== D158-U6 族未解析回退（kpFamily=null）==");
const fKpRaw = sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: ["X"], kpFamily: null });
check("kpId=X ✓（按所选 id 本身）", sf.cardMatchesScheme(fKpRaw, { bookId: null, kpId: "X" }) === true, true, true);
check("kpId=Y ✗（族未解析不扩大命中）", sf.cardMatchesScheme(fKpRaw, { bookId: null, kpId: "Y" }) === false, false, false);

console.log("== D158-U7 条件 AND ==");
const fAnd = sf.buildSchemeFilter({ bookItemIds: ["A"], tags: ["英语"], kpIds: [], kpFamily: null });
check("书A + [英语::词汇] ✓", sf.cardMatchesScheme(fAnd, { bookId: "A", tags: ["英语::词汇"] }) === true, true, true);
check("书A + 无标签 ✗", sf.cardMatchesScheme(fAnd, { bookId: "A", tags: [] }) === false, false, false);
check("书B + [英语] ✗", sf.cardMatchesScheme(fAnd, { bookId: "B", tags: ["英语"] }) === false, false, false);

console.log("== D158-U8 摘录行 ==");
const fKpOnly = sf.buildSchemeFilter({ bookItemIds: [], tags: [], kpIds: ["X"], kpFamily: new Set(["X", "Y"]) });
check("方案含知识点 → 摘录恒 ✗", sf.extractMatchesScheme(fKpOnly, "A", () => ["英语"]) === false, false, false);
const fEx = sf.buildSchemeFilter({ bookItemIds: ["A"], tags: ["英语"], kpIds: [], kpFamily: null });
check("书A + [英语] ✓", sf.extractMatchesScheme(fEx, "A", () => ["英语::阅读"]) === true, true, true);
check("书B ✗", sf.extractMatchesScheme(fEx, "B", () => ["英语"]) === false, false, false);
check("书A + [数学] ✗", sf.extractMatchesScheme(fEx, "A", () => ["数学"]) === false, false, false);
let getTagsCalls = 0;
const fNoTag = sf.buildSchemeFilter({ bookItemIds: ["A"], tags: [], kpIds: [], kpFamily: null });
sf.extractMatchesScheme(fNoTag, "A", () => { getTagsCalls += 1; return []; });
check("方案不含标签时 getTags 未被调用（惰性）", getTagsCalls === 0, 0, getTagsCalls);

console.log(`\n==== schemeFilter.test：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
