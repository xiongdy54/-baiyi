// @runtime: node
// D121 T6：手动制卡预检纯逻辑（disambiguateUi）+ L18 判定（needsAttribution）单测。
// TS 源经 node:module.stripTypeScriptTypes 去类型后在 vm 内求值（export → 普通声明并收集）。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mod = require("node:module");
const assert = require("node:assert");

if (typeof mod.stripTypeScriptTypes !== "function") {
  console.log("SKIP: node:module.stripTypeScriptTypes unavailable");
  process.exit(0);
}

function load(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const js = mod.stripTypeScriptTypes(src, { mode: "strip" })
    .replace(/^export\s+(?:async\s+)?function\s+(\w+)/gm, (m, n) => m.replace("export ", "") + "\n/*EXP:" + n + "*/")
    .replace(/^export\s+(const|type|interface)\s/gm, "$1 ");
  const names = [...js.matchAll(/\/\*EXP:(\w+)\*\//g)].map((m) => m[1]);
  const ctx = vm.createContext({});
  vm.runInContext(js + "\nthis.__exports = {" + names.join(",") + "};", ctx);
  return ctx.__exports;
}

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const ui = load("src/lib/disambiguateUi.ts");
const { needsAttribution } = load("src/lib/disambiguateText.ts");
const { answerDiffers, manualPrecheckText, shouldRunPrecheck } = ui;

// ---- answerDiffers ----
ok(answerDiffers("才能、努力", "财富", 0.1) === true, "low jaccard -> differs");
ok(answerDiffers("才能、努力", "才能、努力、成绩", 0.6) === false, "high jaccard -> same");
ok(answerDiffers("a", "b", 0.3) === false, "boundary 0.3 is not < 0.3");
ok(answerDiffers("a", "b", 0.299) === true, "just below boundary");
ok(answerDiffers("", "财富", 0) === false, "empty new back (cloze) -> no verdict");
ok(answerDiffers("才能", "  ", 0) === false, "blank other back -> no verdict");
ok(answerDiffers(null, undefined, 0) === false, "nullish -> no verdict");

// ---- manualPrecheckText ----
eq(manualPrecheckText("qa", "  统计: 中位数是什么？ ", null), "统计: 中位数是什么？", "qa trims front");
eq(manualPrecheckText("reverse", "A 面题面", null), "A 面题面", "reverse uses A front");
eq(manualPrecheckText("cloze", "中位数是**位置**居中的数", "中位数是{{c1::位置}}居中的数"), "中位数是{{c1::位置}}居中的数", "cloze uses converted text");
eq(manualPrecheckText("cloze", "raw", undefined), "raw", "cloze falls back to raw front");
eq(manualPrecheckText("imageOcclusion", "x", null), null, "image occlusion skipped");
eq(manualPrecheckText("qa", "   ", null), null, "blank front -> no precheck");

// ---- shouldRunPrecheck（面板只出现一次） ----
ok(shouldRunPrecheck("问题", null) === true, "first time runs");
ok(shouldRunPrecheck("问题", "问题") === false, "unchanged front -> no re-check");
ok(shouldRunPrecheck("问题  一", "问题 一") === false, "whitespace-only change -> no re-check");
ok(shouldRunPrecheck("问题2", "问题") === true, "changed front -> re-check");
ok(shouldRunPrecheck(null, null) === false, "null text never runs");
ok(shouldRunPrecheck("", "x") === false, "empty text never runs");

// ---- L18：needsAttribution（lintCard 依赖 ./ai 等不可 import-free 加载，L18 即此函数的薄包装） ----
// 正例
ok(needsAttribution("人们认为优绩主义按什么分配？", "统计:") === true, "L18+ 人们认为 + 领域前缀");
ok(needsAttribution("他们批判什么制度？", "") === true, "L18+ 他们批判");
ok(needsAttribution("该学派主张按{{c1::才能}}分配", "") === true, "L18+ cloze front");
ok(needsAttribution("一些人声称什么？", "") === true, "L18+ 一些人声称");
ok(needsAttribution("某些人倡导什么？", "哲学:") === true, "L18+ 哲学 domain prefix");
ok(needsAttribution("其观点是什么？", "") === true, "L18+ 其观点");
ok(needsAttribution("有人提出什么？", "政治哲学：") === true, "L18+ fullwidth colon domain prefix");
// 反例
ok(needsAttribution("罗尔斯主张什么？", "") === false, "L18- named holder");
ok(needsAttribution("在桑德尔看来，优绩是什么？", "") === false, "L18- no opinion word");
ok(needsAttribution("文中的作者认为什么？", "") === false, "L18- R19 phrasing");
ok(needsAttribution("作者认为什么？", "桑德尔:") === false, "L18- person-name prefix");
ok(needsAttribution("{{c1::罗尔斯}}主张什么？", "") === false, "L18- cloze with named holder");
ok(needsAttribution("光合作用发生在哪里？", "生物:") === false, "L18- plain fact");
ok(needsAttribution(undefined, undefined) === false, "L18- nullish");

console.log(`d121-manual: ${n} assertions passed`);
