// @runtime: node
// D121 T5：辨析弹窗纯逻辑单测（src/lib/disambiguateUi.ts）——diff 高亮分段 / 编辑落库语义 / 搜索 / 文案。
// TS 源经 node:module.stripTypeScriptTypes 去类型后在 vm 内求值（与 d121-context.test.cjs 同法）。
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
    .replace(/^export\s+const\s+(\w+)/gm, (m, n) => "const " + n + "\n/*EXPC:" + n + "*/")
    .replace(/^export\s+(type|interface)\s/gm, "$1 ");
  const names = [...js.matchAll(/\/\*EXP[C]?:(\w+)\*\//g)].map((m) => m[1]);
  const ctx = vm.createContext({});
  vm.runInContext(js + "\nthis.__exports = {" + names.join(",") + "};", ctx);
  return ctx.__exports;
}

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg); n++; };

const ui = load("src/lib/disambiguateUi.ts");

// ---- diffSegments ----
eq(ui.diffSegments("优绩主义主张按什么分配", "据桑德尔转述，优绩主义主张按什么分配"),
  { prefix: "", beforeMid: "", afterMid: "据桑德尔转述，", suffix: "优绩主义主张按什么分配" }, "pure insertion at head");
eq(ui.diffSegments("答案是才能", "答案是财富"),
  { prefix: "答案是", beforeMid: "才能", afterMid: "财富", suffix: "" }, "tail replacement");
eq(ui.diffSegments("甲乙丙丁", "甲X丁"),
  { prefix: "甲", beforeMid: "乙丙", afterMid: "X", suffix: "丁" }, "middle replacement");
eq(ui.diffSegments("abc", "abc"), { prefix: "abc", beforeMid: "", afterMid: "", suffix: "" }, "identical: all prefix, no overlap");
eq(ui.diffSegments("", "新"), { prefix: "", beforeMid: "", afterMid: "新", suffix: "" }, "empty before");
eq(ui.diffSegments("旧", ""), { prefix: "", beforeMid: "旧", afterMid: "", suffix: "" }, "empty after");
// 前后缀不得重叠：aaa → aa（前缀吃完较短串后，后缀不能再重复计入）
const ov = ui.diffSegments("aaa", "aa");
ok(ov.prefix.length + ov.suffix.length <= 2, "prefix+suffix never exceeds shorter side");
eq(ov.beforeMid, "a", "overlap case before mid");
// 代理对不被拆开
eq(ui.diffSegments("a😀b", "a😁b"), { prefix: "a", beforeMid: "😀", afterMid: "😁", suffix: "b" }, "surrogate pairs intact");
// 重组：prefix+beforeMid+suffix === before，prefix+afterMid+suffix === after
for (const [x, y] of [["优绩", "优绩主义"], ["hello world", "hello brave world"], ["", ""], ["同", "不同"]]) {
  const d = ui.diffSegments(x, y);
  ok(d.prefix + d.beforeMid + d.suffix === x && d.prefix + d.afterMid + d.suffix === y, `reassemble ${x}|${y}`);
}

// ---- fieldsOfCard / fieldsChanged ----
const qa = { contextPrefix: "政治哲学：", frontMarkdown: "优绩主义主张什么？", noteText: "优绩主义主张什么？", backMarkdown: "才能、努力", fsrs: { state: "review", due: 5 } };
eq(ui.fieldsOfCard(qa), { contextPrefix: "政治哲学：", front: "优绩主义主张什么？", back: "才能、努力" }, "fieldsOfCard qa");
eq(ui.fieldsOfCard({ frontMarkdown: "", noteText: "只有 note", backMarkdown: null, contextPrefix: null }), { contextPrefix: "", front: "只有 note", back: "" }, "fallback to noteText, nulls -> ''");
ok(!ui.fieldsChanged(ui.fieldsOfCard(qa), ui.fieldsOfCard(qa)), "unchanged");
ok(ui.fieldsChanged(ui.fieldsOfCard(qa), { ...ui.fieldsOfCard(qa), back: "财富" }), "back changed");
ok(ui.fieldsChanged(ui.fieldsOfCard(qa), { ...ui.fieldsOfCard(qa), contextPrefix: "" }), "prefix changed");

// ---- applyCardTextEdit ----
const f0 = ui.fieldsOfCard(qa);
let r = ui.applyCardTextEdit(qa, { ...f0, front: "据桑德尔转述，优绩主义主张什么？" });
eq([r.frontMarkdown, r.noteText, r.backMarkdown, r.contextPrefix], ["据桑德尔转述，优绩主义主张什么？", "据桑德尔转述，优绩主义主张什么？", "才能、努力", "政治哲学："], "front edit writes frontMarkdown+noteText only");
eq(r.fsrs, qa.fsrs, "fsrs untouched");
ok(qa.frontMarkdown === "优绩主义主张什么？", "input not mutated");
r = ui.applyCardTextEdit(qa, { ...f0, back: "财富" });
eq([r.frontMarkdown, r.noteText, r.backMarkdown], ["优绩主义主张什么？", "优绩主义主张什么？", "财富"], "back edit leaves front/noteText");
r = ui.applyCardTextEdit(qa, { ...f0, contextPrefix: "   " });
eq(r.contextPrefix, null, "blank prefix -> null");
r = ui.applyCardTextEdit(qa, { ...f0, contextPrefix: "实然：" });
eq(r.contextPrefix, "实然：", "prefix set");
// 图片卡：noteText 与 frontMarkdown 不同——未改 front 时 noteText 原样保留
const occ = { frontMarkdown: "看图问答", noteText: "legacy-note", backMarkdown: "答案", contextPrefix: null };
r = ui.applyCardTextEdit(occ, { ...ui.fieldsOfCard(occ), back: "新答案" });
eq([r.noteText, r.frontMarkdown, r.backMarkdown], ["legacy-note", "看图问答", "新答案"], "noteText kept when front unchanged");
// 挖空卡：front 为 cloze 原文
const cz = { frontMarkdown: "优绩主义主张按{{c1::才能}}分配", noteText: "优绩主义主张按{{c1::才能}}分配", backMarkdown: "", contextPrefix: null };
r = ui.applyCardTextEdit(cz, { ...ui.fieldsOfCard(cz), front: "据桑德尔，优绩主义主张按{{c1::才能}}分配" });
eq([r.frontMarkdown, r.noteText], ["据桑德尔，优绩主义主张按{{c1::才能}}分配", "据桑德尔，优绩主义主张按{{c1::才能}}分配"], "cloze raw text round-trip");

// ---- isBigFrontChange ----
ok(ui.isBigFrontChange(0.49) && !ui.isBigFrontChange(0.5) && !ui.isBigFrontChange(0.9), "big change threshold 0.5");

// ---- clipText ----
eq(ui.clipText("a{{c1::才能}}b  c\n d", 80), "a才能b c d", "cloze rendered + whitespace folded");
eq(ui.clipText("一二三四五", 3), "一二三…", "clip by code point");
eq(ui.clipText(null, 5), "", "null -> ''");

// ---- searchCards ----
const lib = [
  { id: "self", frontMarkdown: "优绩主义", backMarkdown: "x" },
  { id: "c1", frontMarkdown: "优绩主义主张什么", backMarkdown: "才能", sourceRef: { title: "精英的暴政" } },
  { id: "c2", frontMarkdown: "无关", backMarkdown: "财富 WEALTH", docTitle: "资本论" },
  { id: "c3", frontMarkdown: "删除", backMarkdown: "优绩", isDeleted: 1 },
  { id: "c4", frontMarkdown: "x", noteText: "仅 note 含 Rawls", backMarkdown: "" }
];
eq(ui.searchCards(lib, "优绩", "self").map((c) => c.id), ["c1"], "front hit; self and deleted excluded");
eq(ui.searchCards(lib, "wealth", "self").map((c) => c.id), ["c2"], "case-insensitive back hit");
eq(ui.searchCards(lib, "精英", "self").map((c) => c.id), ["c1"], "source title hit");
eq(ui.searchCards(lib, "资本论", "self").map((c) => c.id), ["c2"], "docTitle hit");
eq(ui.searchCards(lib, "rawls", "self").map((c) => c.id), ["c4"], "noteText hit");
eq(ui.searchCards(lib, "   ", "self"), [], "blank query -> []");
const many = Array.from({ length: 50 }, (_, i) => ({ id: "m" + i, frontMarkdown: "共同词" + i }));
eq(ui.searchCards(many, "共同词", "none").length, 20, "limit 20");
eq(ui.searchCards(many, "共同词", "none", 5).length, 5, "custom limit");

// ---- verdictHeading / duplicateArchiveSuggestion ----
const labels = { "missing-qualifier": "两张都对，前提不同", duplicate: "重复，只是说法不同", confusable: "两个概念确实易混", "no-conflict": "没有冲突", insufficient: "依据不足，无法判断", "one-wrong": "有一张可能有误" };
eq(ui.verdictHeading({ verdict: "one-wrong", wrongCard: "B" }, labels, false), "卡 B 可能有误", "one-wrong heading");
eq(ui.verdictHeading({ verdict: "missing-qualifier", wrongCard: null }, labels, false), "两张都对，前提不同", "mq heading");
eq(ui.verdictHeading({ verdict: "missing-qualifier", wrongCard: null }, labels, true), "问题缺少限定条件", "mq single heading");
eq(ui.verdictHeading({ verdict: "duplicate", wrongCard: null }, labels, false), "重复，只是说法不同", "duplicate heading");
eq(ui.verdictHeading({ verdict: "no-conflict", wrongCard: null }, labels, true), "没有冲突", "no-conflict heading");
eq([ui.duplicateArchiveSuggestion("A"), ui.duplicateArchiveSuggestion("B"), ui.duplicateArchiveSuggestion(null)], ["B", "A", "B"], "archive the non-kept card");

// ---- disambHintText / latestLink ----
eq(ui.disambHintText({ front: "优绩主义主张按什么分配社会回报与地位？这是一个很长很长很长的问题文本" }, "两张都对，前提不同"),
  "已与「优绩主义主张按什么分配社会回报与地位？这是一个很长很长很长的…」辨析 · 两张都对，前提不同", "hint with clip 30 + label");
eq(ui.disambHintText({ front: "短" }, null), "已与「短」辨析", "hint without verdict");
eq(ui.disambHintText(null, "手动处理"), "已辨析（单卡）", "single-card hint ignores label");
eq(ui.latestLink([{ id: 1, updatedAt: 5 }, { id: 2, updatedAt: 9 }, { id: 3, updatedAt: 7 }]).id, 2, "latest by updatedAt");
eq(ui.latestLink([{ id: 1, createdAt: 3 }, { id: 2, createdAt: 1 }]).id, 1, "fallback createdAt");
eq(ui.latestLink([]), null, "empty -> null");

// ---- constants ----
eq([ui.ORIGIN_MAX, ui.NOTE_MAX, ui.SEARCH_LIMIT, ui.BIG_CHANGE_SIMILARITY], [1500, 500, 20, 0.5], "constants");

console.log(`d121-ui-logic: ${n} assertions passed`);
