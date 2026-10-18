// @runtime: node
// 正文文本定位（阅读透镜 v2「正文强调」）：node tests/m15v2.textrange.test.cjs
// 首尾探针 → Range：空白不敏感、跨元素、跳过 script/style（注音与 canonical 同口径保留）、tail 缺失回落、找不到返回 null。
const path = require("path");
require("./lib/tsload.cjs");
const { JSDOM } = require("jsdom");
const TR = require(path.join(__dirname, "..", "src", "lib", "reader", "textRange.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 400)}`); }
}
const html = `<!doctype html><html><head><style>p{color:red}</style></head><body>
<h2>第一节　问题</h2>
<p>知识是经过   检验的信念。<em>这个定义</em>解释了记忆的机制。</p>
<script>var x = "知识是经过检验的信念";</script>
<p>作者先提出问题<ruby>再<rt>zai</rt></ruby>给出回答。反方认为机会平等就够了。</p>
<p>然而平等的起点也会固化等级。</p>
</body></html>`;
const doc = new JSDOM(html).window.document;
const idx = TR.buildTextIndex(doc.body);
check("索引跳过 script / style，注音与 canonical 同口径保留", !idx.flat.includes("varx") && !idx.flat.includes("color") && idx.flat.includes("再zai给"), idx.flat);
const r1 = TR.findTextRange(doc, doc.body, "知识是经过检验的信念。这个定义", "解释了记忆的机制。");
check("空白不敏感 + 跨元素：命中第一段整段", r1 && r1.toString().replace(/\s+/g, "") === "知识是经过检验的信念。这个定义解释了记忆的机制。", r1 && r1.toString());
const r2 = TR.findTextRange(doc, doc.body, "作者先提出问题再zai给出回答。", "然而平等的起点也会固化等级。");
check("跨段：从第二段段首到第三段段尾", r2 && r2.toString().replace(/\s+/g, "").startsWith("作者先提出问题") && r2.toString().trim().endsWith("固化等级。"), r2 && r2.toString());
const r3 = TR.findTextRange(doc, doc.body, "然而平等的起点", "（不存在的尾巴）");
check("尾探针找不到：退到首探针本身", r3 && r3.toString() === "然而平等的起点", r3 && r3.toString());
check("首探针找不到 → null", TR.findTextRange(doc, doc.body, "完全不在文中的一句话", "") === null);
check("首探针过短 → null", TR.findTextRange(doc, doc.body, "知", "") === null);
const sp = TR.findFlatSpan(idx, "反方认为", "就够了。", 0);
const sp2 = TR.findFlatSpan(idx, "知识是经过", "", sp[1]);
check("from 参数：在给定位置之后找", sp && sp2 === null, { sp, sp2 });

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
