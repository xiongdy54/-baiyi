// @runtime: node
// 材料导图 v2 原文块切分回归（node 直跑：node tests/m15v2.blocks.test.cjs）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M1」。
const path = require("path");
const B = require(path.join(__dirname, "..", "electron", "mindmapBlocks.js"));
const { segmentBlocks: seg, renderNumbered, blockRangeToSpan, blockTextLength } = B;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}
const txt = (l, b) => l.slice(b.start, b.end);

console.log("---- 1 基本不变量 ----");
{
  const lines = ["第一章 绪论", "这是第一段正文内容，长度足够超过二十个字符的下限要求。", "", "   第二段前有空白，也要去掉首尾空白字符，长度也要够长。   ", "小结", "最后一段话也需要足够长才能独立成块，所以这里多写一些字。"];
  const l = lines.join("\n");
  const bs = seg(l);
  check("块号从1连续", bs.every((b, i) => b.no === i + 1) && bs.length === 5, bs);
  check("start<end 且有序不重叠", bs.every((b, i) => b.start < b.end && (i === 0 || bs[i - 1].end <= b.start)), bs);
  check("文本已去首尾空白", bs.every((b) => txt(l, b) === txt(l, b).trim() && txt(l, b).length > 0), bs);
  check("标题标记", bs[0].heading && !bs[1].heading && bs[3].heading, bs);
  check("BLOCKS_VERSION=1", B.BLOCKS_VERSION === 1);
}

console.log("---- 2 长段切分 ----");
{
  const sent = "这是一个测试句子用来凑字数。";
  const l = sent.repeat(100); // 1400
  const bs = seg(l);
  check("中文长段各块≤600且多块", bs.length >= 3 && bs.every((b) => b.end - b.start <= 600), bs.map((b) => b.end - b.start));
  check("在句末标点处切开", bs.every((b) => /[。]$/.test(txt(l, b))), bs.map((b) => txt(l, b).slice(-2)));
  check("切片首尾相接覆盖全文", bs[0].start === 0 && bs[bs.length - 1].end === l.length && bs.every((b, i) => i === 0 || bs[i - 1].end === b.start));
  const en = "This is a sentence. ".repeat(80);
  const be = seg(en);
  check("英文 . 切开", be.length >= 3 && be.every((b) => b.end - b.start <= 600 && txt(en, b).endsWith(".")), be.map((b) => txt(en, b).slice(-3)));
  const mix = ("问题出现了吗！还是没有？也许有；" + "x".repeat(10)).repeat(60);
  check("！？；也作切点", seg(mix).every((b) => b.end - b.start <= 600));
  const noP = "字".repeat(1500);
  const bn = seg(noP);
  check("无标点硬切600", bn.length === 3 && bn[0].end - bn[0].start === 600 && bn[1].end - bn[1].start === 600 && bn[2].end - bn[2].start === 300, bn);
  const dec = "3.14159" + "数".repeat(700);
  check("小数点非句末(后无空白)不切", seg(dec)[0].end - seg(dec)[0].start === 600);
}

console.log("---- 3 碎块与标题 ----");
{
  const a = "短句。\n这是一个足够长的正文段落，长度超过二十个字符没有问题。";
  let bs = seg(a);
  check("碎块并入下一块", bs.length === 1 && txt(a, bs[0]) === a, bs);
  const b = "这是一个足够长的正文段落，长度超过二十个字符没有问题。\n尾巴。";
  bs = seg(b);
  check("末块碎块并入上一块", bs.length === 1 && txt(b, bs[0]) === b, bs);
  const c = "短句甲。\n短句乙。\n这是一个足够长的正文段落，长度超过二十个字符没有问题。";
  check("连续碎块链式并入", seg(c).length === 1);
  const d = "第一章\n短。\n另一段足够长的正文内容，用来确保能够独立成块的长度。\n结语";
  bs = seg(d);
  check("标题独立不被合并", bs[0].heading && txt(d, bs[0]) === "第一章" && bs[bs.length - 1].heading && txt(d, bs[bs.length - 1]) === "结语", bs);
  check("碎块并入下一块而非标题", bs.length === 3 && txt(d, bs[1]).startsWith("短。"), bs);
  const e = "这是一个很长很长很长很长的行但是以句号结尾所以不是标题。";
  check("以句末标点结尾的短行非标题", seg(e)[0].heading === false);
  check("自定义 headingMax", seg("abcdefgh", { headingMax: 5 })[0].heading === false);
}

console.log("---- 4 确定性 ----");
{
  const l = "标题\n" + "确定性测试的句子，内容较长。".repeat(120) + "\n短\n结尾标题";
  const first = JSON.stringify(seg(l));
  let same = true;
  for (let i = 0; i < 100; i++) if (JSON.stringify(seg(l)) !== first) same = false;
  check("100 次逐字节一致", same);
}

console.log("---- 5 渲染与区间 ----");
{
  const l = "标题一\n第一块有足够长的内容，包含的文字足够多。\n同一块继续的第二行内容也很长很长很长。";
  const bs = seg(l);
  const out = renderNumbered(l, bs, 1, bs.length);
  check("[n] 文本 格式", out.split("\n")[0] === "[1] 标题一" && out.split("\n")[1].startsWith("[2] "), out);
  const merged = "短。\n后面的文字足够长足够长足够长足够长。";
  check("块内换行换成空格", renderNumbered(merged, seg(merged), 1, 1) === "[1] 短。 后面的文字足够长足够长足够长足够长。");
  check("子区间渲染", renderNumbered(l, bs, 2, 2).startsWith("[2] ") && !renderNumbered(l, bs, 2, 2).includes("\n"));
  const sp = blockRangeToSpan(bs, 1, bs.length);
  check("blockRangeToSpan", sp[0] === bs[0].start && sp[1] === bs[bs.length - 1].end, sp);
  check("blockRangeToSpan 单块", JSON.stringify(blockRangeToSpan(bs, 2, 2)) === JSON.stringify([bs[1].start, bs[1].end]));
  check("blockTextLength", blockTextLength(bs, 1, bs.length) === bs.reduce((n, b) => n + b.end - b.start, 0) && blockTextLength(bs, 1, 1) === 3);
  check("越界/空区间安全", JSON.stringify(blockRangeToSpan(bs, 9, 10)) === "[0,0]" && blockTextLength(bs, 9, 10) === 0 && renderNumbered(l, bs, 9, 10) === "");
}

console.log("---- 6 边界 ----");
{
  check("空串→[]", seg("").length === 0);
  check("纯空白行→[]", seg("  \n\t\n\r\n   ").length === 0);
  check("非字符串→[]", seg(null).length === 0 && seg(undefined).length === 0);
  const w = "标题\r\n这是一段足够长的正文内容用于测试换行以及其他情况。\r\n\r\n另一段也要足够长才能独立成块而不被合并掉。\r\n";
  const bs = seg(w);
  check("CRLF：块文本不含 \\r", bs.length === 3 && bs.every((b) => !txt(w, b).includes("\r")), bs);
  const mg = "短。\r\n后面的文字足够长足够长足够长足够长。";
  check("CRLF 合并块：首尾无 \\r，渲染无 \\r/\\n", seg(mg).length === 1 && !renderNumbered(mg, seg(mg), 1, 1).match(/[\r\n]/));
  check("CRLF 渲染无 \\r", !renderNumbered(w, bs, 1, 3).includes("\r"));
  const emoji = "😀".repeat(400); // 800 码元，无标点
  const be = seg(emoji);
  let ok = be.length >= 2;
  for (const b of be) {
    const s = emoji.slice(b.start, b.end);
    const c0 = s.charCodeAt(0), c1 = s.charCodeAt(s.length - 1);
    if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (c1 >= 0xd800 && c1 <= 0xdbff) || b.end - b.start > 600) ok = false;
  }
  check("emoji 硬切不切坏代理对", ok, be);
  check("emoji 切分覆盖全文", be.reduce((n, b) => n + b.end - b.start, 0) === emoji.length);
  const emo2 = "a" + "😀".repeat(400) + "。";
  const b2 = seg(emo2);
  check("奇数偏移不切坏代理对", b2.every((b) => { const s = emo2.slice(b.start, b.end); const c = s.charCodeAt(0); return !(c >= 0xdc00 && c <= 0xdfff); }), b2);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (fail) process.exitCode = 1;
