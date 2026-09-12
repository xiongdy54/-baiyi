// M6-2（v27）PDF 基础文本导入测试：手工构造 PDF 夹具（pdfjs 真提取）+ CJK 重组纯函数
// 运行：node tests/m6-2.test.cjs（node 直跑）；规格：AI_DEVELOPMENT_GUIDE.md §9.1 M6-2
// 改动 electron/importers.js 的 PDF 段落后须保证本套件全绿
const path = require("path");
const fs = require("fs");

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ " + name); }
}
function section(name) { console.log(`== ${name} ==`); }

const importers = require("../electron/importers.js");

// ---------- 手工 PDF 夹具（无压缩内容流 + Helvetica + 可选书签大纲） ----------
// lines: [{x, y, size, text}]；outline: [{title, page(0基)}]（level1）；页 lines 为空 = 扫描版页
function buildPdf(pages, outline = []) {
  const objs = [];
  const pageObjNums = [];
  // 预排对象号：1 Catalog, 2 Pages, 5 Outlines, 9 Font；页从 3 开始（每页 2 个对象）
  const firstPageObj = 3;
  const perPage = 2;
  const lastPageObj = firstPageObj + pages.length * perPage - 1;
  const fontObj = lastPageObj + 1;
  const outlineRoot = fontObj + 1;
  const outlineFirst = outlineRoot + 1;

  const mkContent = (lines) => {
    let s = "BT\n";
    for (const l of lines) s += `/F1 ${l.size} Tf\n1 0 0 1 ${l.x} ${l.y} Tm\n(${String(l.text).replace(/([()\\])/g, "\\$1")}) Tj\n`;
    return s + "ET";
  };
  pages.forEach((lines, i) => {
    const pageObj = firstPageObj + i * perPage;
    const contentObj = pageObj + 1;
    const c = mkContent(lines);
    pageObjNums.push(pageObj);
    objs[pageObj - 1] = `${pageObj} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentObj} 0 R/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>endobj`;
    objs[contentObj - 1] = `${contentObj} 0 obj<</Length ${c.length}>>stream\n${c}\nendstream endobj`;
  });
  objs[0] = `1 0 obj<</Type/Catalog/Pages 2 0 R${outline.length ? `/Outlines ${outlineRoot} 0 R` : ""}>>endobj`;
  objs[1] = `2 0 obj<</Type/Pages/Kids[${pageObjNums.map((n) => `${n} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;
  objs[fontObj - 1] = `${fontObj} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`;
  if (outline.length) {
    const items = outline.map((o, i) => ({ obj: outlineFirst + i, pageObj: pageObjNums[o.page], title: o.title }));
    const count = items.length;
    items.forEach((it, i) => {
      const parts = [`<</Title(${it.title.replace(/([()\\])/g, "\\$1")})/Parent ${outlineRoot} 0 R/Dest[${it.pageObj} 0 R /XYZ 0 792 0]`];
      if (i > 0) parts.push(`/Prev ${items[i - 1].obj} 0 R`);
      if (i < count - 1) parts.push(`/Next ${items[i + 1].obj} 0 R`);
      parts.push(">>endobj");
      objs[it.obj - 1] = `${it.obj} 0 obj` + parts.join("");
    });
    const first = items[0].obj;
    const last = items[count - 1].obj;
    objs[outlineRoot - 1] = `${outlineRoot} 0 obj<</Type/Outlines/First ${first} 0 R/Last ${last} 0 R/Count ${count}>>endobj`;
  }
  const used = objs.filter(Boolean);
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of used) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xref = pdf.length;
  pdf += "xref\n0 " + (used.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${used.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const body = (y, text) => ({ x: 72, y, size: 10, text });

(async () => {
  // ---------- M6-2-1 书签大纲章节化（优先级①） ----------
  section("M6-2-1 书签大纲章节化（优先级①）");
  const pdfOutline2p = buildPdf(
    [
      [{ x: 72, y: 720, size: 18, text: "M6-2 PDF Fixture Title" }, body(690, "First paragraph line one."), body(678, "First paragraph line two."), body(650, "Second paragraph after gap.")],
      [body(720, "Page two body text."), body(708, "More body here.")],
    ],
    [{ title: "Chapter One", page: 0 }, { title: "Chapter Two", page: 1 }]
  );
  const r1 = await importers.pdfToMarkdown(pdfOutline2p);
  ok(r1.outlineUsed === true && r1.chapters === 2 && r1.pages === 2 && r1.emptyPages === 0, "大纲优先：2 章 / 2 页 / 无空页");
  ok(r1.markdown.includes("# Chapter One") && r1.markdown.includes("# Chapter Two"), "大纲标题转一级章节");
  ok(/# Chapter One\n\nM6-2 PDF Fixture Title\n\nFirst paragraph line one\. First paragraph line two\.\n\nSecond paragraph after gap\./.test(r1.markdown), "标题独立成段 + 行距段落切分正确（25 分位行距）");
  ok(r1.markdown.indexOf("Page two body text.") > r1.markdown.indexOf("# Chapter Two"), "第二页内容落位在其章节之后");
  ok(!/\n{3,}/.test(r1.markdown), "空行收敛（合成管线输入整洁）");

  // ---------- M6-2-2 字号启发式标题（优先级②，无大纲） ----------
  section("M6-2-2 字号启发式标题（优先级②，无大纲）");
  const pdfHeads = buildPdf([
    [{ x: 72, y: 720, size: 18, text: "First Big Heading" }, body(690, "Body under first heading."), body(678, "Continues here.")],
    [{ x: 72, y: 720, size: 18, text: "Second Big Heading" }, body(690, "Body under second heading.")],
  ]);
  const r2 = await importers.pdfToMarkdown(pdfHeads);
  ok(r2.outlineUsed === false && r2.chapters === 2, "无大纲时字号标题章节化（2 条启用）");
  ok(r2.markdown.includes("# First Big Heading") && r2.markdown.includes("# Second Big Heading"), "大字号短行判为标题");
  ok(!/Body under first heading\.[\s\S]*First Big Heading/.test(r2.markdown.replace(/^[\s\S]*?# First Big Heading/, "")), "标题行不重复出现在段落中");

  // ---------- M6-2-3 页分块（优先级③）与单章 ----------
  section("M6-2-3 页分块（优先级③）与单章回退");
  const manyPages = [];
  for (let i = 0; i < 12; i++) manyPages.push([body(720, `Page ${i + 1} body content.`)]);
  const r3 = await importers.pdfToMarkdown(buildPdf(manyPages));
  ok(r3.chapters === 2 && r3.markdown.includes("# 第 1–10 页") && r3.markdown.includes("# 第 11–12 页"), "12 页无大纲无标题 → 每 10 页分块（2 章）");
  const r3b = await importers.pdfToMarkdown(buildPdf([[body(720, "Short doc line.")], [body(720, "Second page.")]]));
  ok(r3b.chapters === 0 && r3b.markdown.includes("Short doc line.") && r3b.markdown.includes("Second page."), "≤8 页单章回退（不产生分块标题）");

  // ---------- M6-2-4 扫描版拒绝与空页统计 ----------
  section("M6-2-4 扫描版拒绝与空页统计");
  let scannedThrew = "";
  try {
    await importers.pdfToMarkdown(buildPdf([[{ x: 72, y: 700, size: 10, text: "" }]]));
  } catch (e) { scannedThrew = String(e.message); }
  ok(/扫描版/.test(scannedThrew), "全页无文本层（扫描版）→ 明确拒绝");
  const r4 = await importers.pdfToMarkdown(buildPdf([[body(720, "Only text page.")], []]));
  ok(r4.emptyPages === 1 && r4.pages === 2 && r4.markdown.includes("Only text page."), "部分页无文本 → 正常导入并统计 emptyPages");

  // ---------- M6-2-5 跨页段落愈合 ----------
  section("M6-2-5 跨页段落愈合");
  const r5 = await importers.pdfToMarkdown(buildPdf([
    [body(720, "This paragraph continues onto the next page without terminal punct")],
    [body(720, "and here it ends.")],
  ]));
  ok(/continues onto the next page without terminal punct and here it ends\./.test(r5.markdown), "ASCII 跨页段落以空格愈合");
  ok(!/punct\n\nand here/.test(r5.markdown), "愈合后不再被页界拆开");

  // ---------- M6-2-6 CJK 重组纯函数（pdf.js 之外的核心规则） ----------
  section("M6-2-6 CJK 重组纯函数（行内粘连 / 缩进分段 / 跨页无空格愈合）");
  const cjkLines = importers.itemsToLines([
    { str: "今天", transform: [10, 0, 0, 10, 72, 700], width: 20, height: 10, hasEOL: false },
    { str: "天气", transform: [10, 0, 0, 10, 92, 700], width: 20, height: 10, hasEOL: true },
    { str: "很好", transform: [10, 0, 0, 10, 72, 688], width: 20, height: 10, hasEOL: true },
  ]);
  ok(cjkLines.length === 2 && cjkLines[0].text === "今天天气" && cjkLines[1].text === "很好", "CJK 逐字 item 同行直接粘连（不插空格）");
  const latLines = importers.itemsToLines([
    { str: "hello", transform: [10, 0, 0, 10, 72, 700], width: 30, height: 10, hasEOL: false },
    { str: "world", transform: [10, 0, 0, 10, 112, 700], width: 30, height: 10, hasEOL: true },
  ]);
  ok(latLines.length === 1 && latLines[0].text === "hello world", "ASCII item 间隙 > 0.15 字高补空格");
  const md1 = importers.linesToMarkdown([
    { text: "第一段第一行。", x: 72, y: 700, h: 10 },
    { text: "第一段第二行，继续。", x: 72, y: 690, h: 10 },
    { text: "第二段首行缩进。", x: 90, y: 672, h: 10 },
    { text: "第二段次行贴左。", x: 72, y: 662, h: 10 },
  ]);
  ok(md1.paragraphs.length === 2, "缩进启发式分段（中文首行缩进惯例）");
  ok(md1.paragraphs[0] === "第一段第一行。第一段第二行，继续。", "段内 CJK 行直接粘连");
  ok(md1.paragraphs[1].startsWith("第二段首行缩进。"), "第二段落独立");
  ok(importers.joinPageMarkdown("跨页前半", "后半。") === "跨页前半后半。", "跨页愈合：CJK 侧无空格");
  ok(importers.joinPageMarkdown("continues", "here.") === "continues here.", "跨页愈合：ASCII 补空格");

  // ---------- M6-2-7 确定性（合成纪律） ----------
  section("M6-2-7 确定性");
  const ra = await importers.pdfToMarkdown(pdfOutline2p);
  const rb = await importers.pdfToMarkdown(pdfOutline2p);
  ok(ra.markdown === rb.markdown, "同一 PDF 两次转换 markdown 逐字符一致（无时间戳/随机因素）");

  // ---------- SUMMARY ----------
  console.log(`\n==== M6-2 SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) {
    console.log("FAILURES:", failures.join(" | "));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error("M6-2 TEST CRASH:", e);
  process.exit(1);
});
