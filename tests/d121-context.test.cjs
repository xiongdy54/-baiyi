// @runtime: node
// D121 T3：语境包纯函数单测（tocPath / selectionContext / disambiguateText）。
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
const eq = (a, b, msg) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg); n++; };

const { tocPathByHref, headingPathAt } = load("src/lib/reader/tocPath.ts");
const { paragraphContext } = load("src/lib/selectionContext.ts");
const { normalizeQualifier, needsAttribution, formatRelatedCardLine } = load("src/lib/disambiguateText.ts");

// ---- tocPathByHref ----
const toc = [
  { label: "第一部分", href: "p1.xhtml", subitems: [
    { label: "第一章", href: "c1.xhtml", subitems: [{ label: "1.1 节", href: "c1.xhtml#s1" }, { label: "1.2 节", href: "c1.xhtml#s2" }] },
    { label: "第二章", href: "c2.xhtml" }
  ] },
  { label: "附录", href: "app.xhtml" }
];
eq(tocPathByHref(toc, "app.xhtml"), ["附录"], "top-level exact");
eq(tocPathByHref(toc, "c1.xhtml#s2"), ["第一部分", "第一章", "1.2 节"], "nested exact with anchor");
eq(tocPathByHref(toc, "c2.xhtml#x"), ["第一部分", "第二章"], "anchor-stripped fallback match");
eq(tocPathByHref(toc, "c1.xhtml#zzz"), ["第一部分", "第一章", "1.1 节"], "anchor-stripped picks deepest");
eq(tocPathByHref(toc, "nope.xhtml"), [], "miss -> []");
eq(tocPathByHref(toc, undefined), [], "undefined href");
eq(tocPathByHref([], "a"), [], "empty toc");

// ---- headingPathAt ----
const md = "# 书\n\n## 第一章\n\n正文A\n\n### 1.1\n\n正文B\n\n## 第二章\n\n正文C\n\n```\n# 不是标题\n```\n";
eq(headingPathAt(md, md.indexOf("正文A")), ["书", "第一章"], "level stack h2");
eq(headingPathAt(md, md.indexOf("正文B")), ["书", "第一章", "1.1"], "level stack h3");
eq(headingPathAt(md, md.indexOf("正文C")), ["书", "第二章"], "pop on same-level heading");
eq(headingPathAt(md, md.length), ["书", "第二章"], "fenced # ignored");
eq(headingPathAt(md, 0), [], "index 0 -> none");
eq(headingPathAt("", 5), [], "empty md");
eq(headingPathAt("## A ##\n\ntext", 12), ["A"], "closing hashes trimmed");

// ---- paragraphContext ----
const body = "P1 一。\n\nP2 二。\n\nP3 三。\n\n目标选区文字\n\nP5 五。\n\nP6 六。";
let r = paragraphContext(body, "目标选区文字");
eq(r, { before: "P2 二。\nP3 三。", after: "P5 五。" }, "2 before / 1 after");
r = paragraphContext("目标\n\n后文", "目标");
eq(r, { before: "", after: "后文" }, "no before");
r = paragraphContext("前文\n\n目标", "目标");
eq(r, { before: "前文", after: "" }, "no after");
const longP = "长".repeat(500);
r = paragraphContext(`${longP}\n\n${longP}\n\nSEL\n\n${"后".repeat(900)}`, "SEL");
ok(r.before.length === 600, "before capped 600");
ok(r.before.endsWith("长"), "before keeps near end");
ok(r.after.length === 400, "after capped 400");
r = paragraphContext("甲  乙\n\n丙   丁  戊\n\n己", "丙 丁\n戊");
eq(r, { before: "甲 乙", after: "己" }, "whitespace-normalized locate fallback");
eq(paragraphContext(body, "不存在的句子"), null, "not found -> null");
eq(paragraphContext("", "x"), null, "empty body");
eq(paragraphContext("只有选区", "只有选区"), null, "no context at all -> null");
r = paragraphContext("a  b   c\n\nnext", "a b c");
eq(r, { before: "", after: "next" }, "multi-space body vs single-space selection");

// ---- normalizeQualifier ----
eq(normalizeQualifier({ stance: "reported", holder: "桑德尔", note: "转述" }), { stance: "reported", holder: "桑德尔", note: "转述" }, "valid");
eq(normalizeQualifier({ stance: "bogus", holder: "x" }), null, "invalid stance -> null");
eq(normalizeQualifier(null), null, "null");
eq(normalizeQualifier("author"), null, "string");
eq(normalizeQualifier([1]), null, "array");
eq(normalizeQualifier({ stance: "author", holder: 5, note: {} }), { stance: "author", holder: null, note: null }, "non-string holder/note -> null");
eq(normalizeQualifier({ stance: "unknown", holder: "", note: "  " }), { stance: "unknown", holder: null, note: null }, "empty -> null");
eq(normalizeQualifier({ stance: "criticized", holder: "甲".repeat(100), note: "n" }).holder.length, 60, "holder capped 60");
eq(normalizeQualifier({ stance: " Consensus ", holder: null, note: null }).stance, "consensus", "stance trimmed/lowercased");
eq(normalizeQualifier({ stance: "author", holder: "null", note: null }).holder, null, "literal 'null' string -> null");

// ---- needsAttribution ----
ok(needsAttribution("该学派主张按什么分配？", "") === true, "该学派主张 -> true");
ok(needsAttribution("作者认为成功主要取决于什么？", "") === true, "bare 作者认为 -> true");
ok(needsAttribution("有人主张什么？", "哲学:") === true, "有人主张 + domain prefix -> true");
ok(needsAttribution("材料中的作者认为成功取决于什么？", "") === false, "材料中的作者认为 -> false");
ok(needsAttribution("桑德尔：优绩主义主张什么？", "") === false, "named holder in front -> false");
ok(needsAttribution("桑德尔认为优绩暴政源于什么？", "") === false, "named subject -> false");
ok(needsAttribution("桑德尔认为优绩暴政源于什么？", "桑德尔·政治哲学:") === false, "prefix with · -> not domain -> false");
ok(needsAttribution("光合作用发生在哪里？", "") === false, "no opinion word -> false");
ok(needsAttribution("该观点的核心是什么？", "生物:") === true, "该 + 观点 -> true");
ok(needsAttribution("{{c1::该学派}}主张什么？", "") === true, "cloze syntax stripped");
ok(needsAttribution("该学派主张什么？", "罗尔斯正义论（上）:") === false, "long prefix with 括号 -> false");
ok(needsAttribution("", "") === false, "empty front");
ok(needsAttribution("有人主张什么？", "桑德尔:") === false, "person-name prefix -> attributed -> false");
ok(needsAttribution("有人主张什么？", "政治哲学:") === true, "discipline-suffix prefix -> domain -> true");
ok(needsAttribution("有人主张什么？", "社会思想:") === true, "社会思想 -> domain -> true");

// ---- formatRelatedCardLine ----
const line = formatRelatedCardLine({ cardType: "qa", frontMarkdown: "优绩主义主张按什么分配？", backMarkdown: "才能、努力", sourceRef: { title: "精英的傲慢", author: "桑德尔" } }, "忽略");
eq(line, "Q：优绩主义主张按什么分配？ ｜ A：才能、努力 ｜ 来源：《精英的傲慢》 · 桑德尔", "full line with author");
eq(formatRelatedCardLine({ cardType: "qa", frontMarkdown: "q", backMarkdown: "a" }, "书X"), "Q：q ｜ A：a ｜ 来源：《书X》", "docTitle fallback, no author");
eq(formatRelatedCardLine({ cardType: "qa", frontMarkdown: "q", backMarkdown: "a" }), "Q：q ｜ A：a ｜ 来源：《未知》", "unknown title");
const cl = formatRelatedCardLine({ cardType: "cloze", noteText: "{{c1::光合作用}}在叶绿体进行", frontMarkdown: "", backMarkdown: "" });
ok(cl.startsWith("Q：光合作用在叶绿体进行"), "cloze rendered");
const lq = formatRelatedCardLine({ cardType: "qa", frontMarkdown: "问".repeat(200), backMarkdown: "答".repeat(200) });
ok(lq.includes("问".repeat(80) + "…") && !lq.includes("问".repeat(81)), "front capped 80");
ok(lq.includes("答".repeat(60) + "…") && !lq.includes("答".repeat(61)), "back capped 60");

console.log(`d121-context: ${n} assertions passed`);
