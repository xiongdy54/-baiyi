// M6-3（v30）HTML 导入 + 路由表测试
// @runtime: system-node
// 运行：node tests/m6-3.test.cjs
// HTML 转换依赖浏览器 DOM——测试用 jsdom（devDependency）构造全局 window/document/DOMParser，
// 再把 src/lib/htmlImport.ts 用 esbuild 打成 CJS 后 require（与 m5/m6-1 的「打包后测」模式一致）。
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ " + name); }
}
function section(name) { console.log(`== ${name} ==`); }

// ---------- jsdom 全局（必须在 require htmlImport bundle 之前） ----------
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.com/article" });
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;
global.Element = dom.window.Element;

// ---------- 打包 htmlImport（esbuild JS API；buildSync 不支持插件需求此处不需要插件） ----------
const bundlePath = path.join(__dirname, "m6-3.htmlimport.bundle.cjs");
require("esbuild").buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "lib", "htmlImport.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: bundlePath,
  logLevel: "silent"
});
const htmlImport = require("./m6-3.htmlimport.bundle.cjs");
const { kindForFilename } = require("./m6-3.kinds.bundle.cjs");

// ---------- 夹具 ----------
const ARTICLE_HTML = `<!doctype html>
<html><head>
<title>绩效拜物教的代价 - 某专栏</title>
<style>body { color: red; } .nav { display: none; }</style>
<script>window.track = function(){};</script>
</head><body>
<nav class="site-nav"><a href="/">首页</a><a href="/hot">热榜</a><a href="/about">关于我们</a></nav>
<article>
<h1>只要跑不死、就往死里跑</h1>
<p>绩效主义把人的价值简化为可量化的产出，张雪峰的离世让这个议题浮出水面。</p>
<p>当健康成为绩效的代价，我们需要重新追问：什么是有意义的工作节奏？</p>
<table><tr><th>指标</th><th>含义</th></tr><tr><td>KPI</td><td>关键绩效指标</td></tr></table>
</article>
<div class="sidebar">相关阅读：十本关于工作伦理的书</div>
<img src="/static/ad.png" alt="广告">
<script>console.log("tracking pixel");</script>
</body></html>`;

const PLAIN_HTML = `<!doctype html><html><head><title>纯列表页</title></head><body>
<div>第一节 古希腊哲学</div>
<div>第二节 中世纪哲学</div>
<div>第三节 近代哲学</div>
</body></html>`;

section("M6-3-1 HTML 正文提取（Readability 路径）");
const art = htmlImport.htmlToMarkdown(ARTICLE_HTML);
ok(art.via === "readability", "文章页走 Readability 正文提取");
ok(art.title.includes("绩效拜物教的代价") || art.title.includes("只要跑不死"), "标题提取（Readability title 或首 h1）");
ok(art.markdown.includes("绩效主义把人的价值简化为可量化的产出"), "正文段落完整保留");
ok(!art.markdown.includes("首页") && !art.markdown.includes("热榜") && !art.markdown.includes("相关阅读"), "导航与侧栏噪音剔除");
ok(!art.markdown.includes("color: red") && !art.markdown.includes("display: none"), "style 内容剔除（DOMPurify FORBID_TAGS）");
ok(!art.markdown.includes("tracking pixel"), "script 内容剔除");
ok(art.markdown.includes("| 指标 | 含义 |") && art.markdown.includes("| KPI | 关键绩效指标 |"), "表格转 GFM 管道表");
ok(art.markdown.includes("# 只要跑不死、就往死里跑"), "一级标题转 ATX（供合成管线章节切分）");

section("M6-3-2 回退链（Readability 无正文时）");
// Readability 对纯列表页也会保留内容（鲁棒），故用「body 仅含脚本」确定性地触发回退分支（实测 via=fallback）
const scriptOnly = htmlImport.htmlToMarkdown("<!doctype html><html><head><title>t</title></head><body><script>var x=1;</script></body></html>");
ok(scriptOnly.via === "fallback", "Readability 无正文 → 回退链（via=fallback）");
ok(scriptOnly.markdown === "", "回退链下纯脚本页得到空正文（不误取脚本内容）");
// 非文章页（列表/说明页）也必须有内容产出（Readability 或回退链均可，验收看结果不看路径）
const plain = htmlImport.htmlToMarkdown(PLAIN_HTML);
ok(plain.markdown.includes("第一节 古希腊哲学") && plain.markdown.includes("第三节 近代哲学"), "列表页正文全部保留（鲁棒：两条路径皆可）");
ok(plain.title === "纯列表页", "列表页标题取 <title>");
ok(htmlImport.htmlToMarkdown("").markdown === "", "空输入不抛错（空 markdown）");
let threw = false;
try { htmlImport.htmlToMarkdown("<html><body><p>无结构正文</p></body></html>"); } catch { threw = true; }
ok(!threw, "无结构 HTML 不抛错（回退链兜底）");

section("M6-3-3 HTML 字节解码（中文存档）");
const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>你好</p>", "utf8")]);
ok(htmlImport.decodeHtmlBytes(new Uint8Array(utf8Bom)).includes("你好"), "解码：UTF-8 BOM");
ok(htmlImport.decodeHtmlBytes(new Uint8Array(Buffer.from("<p>你好</p>", "utf8"))).includes("你好"), "解码：无 BOM 合法 UTF-8");
// GBK：中=D6D0 文=CEC4
ok(htmlImport.decodeHtmlBytes(new Uint8Array(Buffer.from([0x3c, 0x70, 0x3e, 0xd6, 0xd0, 0xce, 0xc4, 0x3c, 0x2f, 0x70, 0x3e]))).includes("中文"), "解码：GBK 回退（中文网页存档）");

section("M6-3-4 统一导入路由表（D27）");
ok(kindForFilename("book.epub") === "epub", "路由：.epub → epub");
ok(kindForFilename("page.html") === "html" && kindForFilename("page.HTM") === "html", "路由：.html/.htm（大小写不敏感）→ html");
ok(kindForFilename("notes.docx") === "word", "路由：.docx → word");
ok(kindForFilename("a.txt") === "txt" && kindForFilename("a.md") === "markdown" && kindForFilename("a.markdown") === "markdown", "路由：.txt/.md/.markdown");
ok(kindForFilename("paper.pdf") === "pdf", "路由：.pdf → pdf");
ok(
  ["a.mobi", "a.azw3", "a.azw", "a.fb2", "a.fbz", "a.cbz"].every((f) => kindForFilename(f) === "ebook"),
  "路由：MOBI/AZW3/AZW/FB2/FBZ/CBZ → ebook（被动兼容直读）"
);
ok(kindForFilename("archive.zip") === null && kindForFilename("noext") === null, "路由：未知类型返回 null（UI 报不支持）");

console.log(`\n==== M6-3 SUMMARY ${pass}/${pass + fail} ====`);
if (fail) {
  console.log("FAILURES:", failures.join(" | "));
  process.exit(1);
}
