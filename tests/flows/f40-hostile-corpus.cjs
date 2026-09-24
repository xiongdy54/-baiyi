// F40 敌意语料 · 资源面（「输入即 DoS」：时间 / 内存 / 递归深度 / 输出膨胀）
// @runtime: electron  @tier: 2  @gui: false  @id: F40  @timeout: 900
// 运行：npx electron tests/flows/f40-hostile-corpus.cjs   （或 node tests/flows/run.cjs --only F40）
//   F40_KEEP=1    收尾保留语料与大产物（默认删净 corpus 里 >1MB 的文件与整个 f40cache/）
//   F40_REGEN=1   强制重生成语料（默认按「文件名 + 字节数」命中缓存，重跑不再花那 10 秒）
//   F40_ONLY=epub,md,uni   只跑某几节（调试用）    F40_REPS=3  覆盖每项重复次数
//
// 角度：既有 37 条流程没有一条量过**代价**。
//   F16 管「内容能做什么」（脚本、协议、Key）；F30 管「字节→Markdown 的形状对不对」；
//   F02 管「进库之后长什么样」；F13 管「脏数据会不会让逻辑算错」；F10 管「合法规模下的耗时棘轮」。
//   没有人问过：一个 20KB 的文件能不能让导入转 40 秒？一层层套下去的 <div> 会不会把栈打穿、
//   用户随后看到什么？10000 个不闭合的 `$` 会不会把 markdown-it/KaTeX 拖进二次方？
//   这些问题的共同形状是：**输入本身即攻击载荷，而代价没有预算**。§7.5 只写了「不可信文件不得崩」，
//   没写「不得慢」。真实用户手里最像攻击的输入，恰恰是网上下的野 EPUB 与微信存档 .md。
//
// 判据（每项都有硬预算；实测值一律上报，不只报通过与否）：
//   B1 时间：同一管线段单次 ≤ 该项预算（best-of-N；第 1 次就炸穿预算 2.5 倍则不再烧机）
//   B2 内存：RSS 增量 ≤ 300MB，且不得出现进程级 OOM / 崩溃退出
//   B3 膨胀：产物正文 ≤ 50 000 标记（结构性炸弹）；解压比 ≤ 100:1（超过即须被拒绝）
//   B4 失败必须响：拒绝要抛错、带用户可读原因；**禁止「短了一大截却报告成功」**（静默截断）
//   B5 差分对照：每个敌意项旁边跑同尺寸的良性项（同一子进程机制、同一预算口径）；
//      敌意与良性代价相同就照实写「不是缺陷」；每次测量附 calibMs 负载探针，
//      用来证明两侧是在同样的机器压力下测的（本机同时有 run.cjs 长跑在抢 CPU）。
//
// 安全性：真正危险的一段（解压炸弹、5 万层嵌套、KaTeX 万层花括号、pdfjs）一律在**自 spawn 的
//   子进程**里跑（ELECTRON_RUN_AS_NODE，同 V8 版本），超时由 spawnSync({timeout}) 硬杀，只杀
//   自己起的 pid；子进程堆上限经 NODE_OPTIONS 收紧并回读 heap_limit 自证。不起 GUI。
//
// 依据：§7.5（不可信文件）、§7.1.3（边界输入不得穿透）、§9.1 M6/M6-1/M6-2/M6-3（导入面）、
//       §4.2（documents.markdown 是唯一正文真源）、§7.1.8（内存库 + 全量回写：一条巨型正文让此后
//       每一次写库都付全价——本项目自己登记的结构性风险，本层第一次把它与敌意输入连起来量）。
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const v8 = require("v8");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", ".."); // tests/flows → 仓库根
const FIX_DIR = path.join(__dirname, "fixtures", "f40");
const CORPUS_DIR = path.join(FIX_DIR, "corpus");
const CACHE_DIR = path.join(FIX_DIR, "f40cache");
const OUT_DIR = path.join(os.tmpdir(), "f40-child-out");

// ---------- 预算常量（本层自定的口径，集中在此便于评审） ----------
const BUD = {
  smallMs: 1500, // ≤200KB 输入在任一段管线的时间预算
  bigMs: 6000, // 1–4MB 合法载荷
  epubMs: 8000, // 整本 EPUB（逐章 turndown）
  docMs: 8000, // 落库 + 全量回写
  maxRssMB: 300, // 单次允许的 RSS 增量
  maxMarkers: 50000, // 结构性炸弹允许的产物标记数
  maxRatio: 100, // 解压后字节 / 压缩包字节
  maxDocBytes: 32 * 1024 * 1024, // 单本书正文允许进库的上限
};
const REPS = Math.max(1, Number(process.env.F40_REPS || 3));
const ONLY = (process.env.F40_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (sec) => !ONLY.length || ONLY.includes(sec);

// ==================================================================
// 0. 双形态入口在文件末尾分叉（必须如此：这里的表/常量都是 const，放在顶部会撞 TDZ；
//    且子进程分叉必须早于任何 require("electron")——run-as-node 下它只会回一个路径字符串）
// ==================================================================

// ==================================================================
// 1. 语料生成：纯字符串/字节运算，父子进程共用，确定性无随机
// ==================================================================
const ZH = "这是一段用来充当正文的中文句子，里面有序号 0123456789 与英文 mixed words。";
const rep = (s, n) => new Array(n + 1).join(s);
const CP = (n) => String.fromCodePoint(n);
const RLO = CP(0x202e), LRI = CP(0x2066), RLI = CP(0x2067), FSI = CP(0x2068), PDI = CP(0x2069);
const LSEP = CP(0x2028), PSEP = CP(0x2029), NUL = CP(0), ZWJ = CP(0x200d), ZWSP = CP(0x200b);
const hi = String.fromCharCode(0xd800), lo = String.fromCharCode(0xdc00); // 孤立半代理

/** markdown 正文（敌意 + 对照）：id → 生成函数 */
const MD = {
  // ---- 良性对照 ----
  "benign-doc": () => { let o = ""; for (let c = 1; c <= 8; c++) o += "# 第 " + c + " 章 绪论\n\n" + rep(ZH + "\n\n", 12) + "\n"; return o; },
  "benign-quotes-10k": () => rep("> 一层引用的普通段落。\n\n", 10000),
  "benign-list-5k": () => rep("- 一个正常的列表项\n", 5000),
  "benign-math-100": () => rep("句中公式 $x_{i}^{2}+\\frac{a}{b}$ 与行间公式\n\n$$\\int_0^1 x\\,dx = \\tfrac12$$\n\n", 100),
  "benign-inline-dollar": () => rep("成本 $5 与 $10 的差是 $3。", 4000),
  "benign-1mb-multiline": () => rep(ZH + "\n", 30000),
  "benign-brace-30": () => "$" + rep("{", 30) + "x" + rep("}", 30) + "$",
  "benign-table-200": () => "|" + rep(" 单元格 |", 200) + "\n|" + rep(" --- |", 200) + "\n|" + rep(" 值 |", 200) + "\n",
  // ---- 结构性炸弹（递归深度） ----
  "md-quote-10k": () => rep("> ", 10000) + "最深一层正文",
  "md-quote-20k": () => rep("> ", 20000) + "最深一层正文",
  "md-list-10k": () => rep("- ", 10000) + "最深一层正文",
  "md-em-50k": () => rep("*", 50000) + "x" + rep("_", 20000) + "y",
  "md-link-soup": () => rep("[x](", 20000),
  "md-reflinks-2k": () => rep("[1]", 2000) + "\n\n" + Array.from({ length: 2000 }, (_, i) => "[1]: https://example.com/" + i).join("\n"),
  "md-table-2000": () => "|" + rep(" 单元格 |", 2000) + "\n|" + rep(" --- |", 2000) + "\n|" + rep(" 值 |", 2000) + "\n",
  "md-one-line-1mb": () => rep("词", 500000),
  "md-one-line-4mb": () => rep("词", 2000000),
  "md-fence-unclosed": () => rep("正文与 <style>噪音</style>\n\n", 500) + "```" + rep("\n未闭合围栏内的正文段落", 5000),
  // ---- ReDoS / 数学 ----
  "md-dollar-10k": () => rep("$", 10000),
  "md-math-pairs-5k": () => rep("$$x$$", 5000),
  "md-katex-brace-10k": () => "$" + rep("{", 10000) + "x$",
  "md-katex-brace-3k": () => "$" + rep("{", 3000) + "x$",
  "md-katex-frac-20k": () => "$" + rep("\\frac", 20000) + "$",
  "md-katex-nested-frac": () => "$" + rep("\\frac{1}", 4000) + "{2}$",
  "md-mix-math-em": () => rep("$$\\frac{1}{2}$$**", 3000),
  // ---- Unicode / 数值 ----
  // 组合符 U+0301、RTL 覆盖 U+202E、双向隔离符 U+2066..2069、行/段分隔符 U+2028/9、
  // NUL U+0000、孤立代理对 —— 一律用 CP(n) 现搭，源码里不留隐形字符
  // （第一版把这些码位直接写进字面量，被工具链整段吃掉，语料静默退化成普通文本 —— 这本身就是本层要测的那类事）
  "uni-combining-1000": () => "a" + rep(CP(0x0301), 1000) + " 正文尾句。",
  "uni-combining-100x": () => rep("a" + rep(CP(0x0301), 100) + " ", 100),
  "uni-zwj-2000": () => rep("\u{1F468}" + ZWJ + "\u{1F469}" + ZWJ + "\u{1F467}" + ZWJ + "\u{1F466}" + "家庭", 2000),
  "uni-rlo-body": () => "前段 " + RLO + "gnitsirt 藏身" + PDI + " 后段正文。",
  "uni-bidi-isolates": () => "前段 " + LRI + "隐蔽内容" + PDI + " " + RLI + " " + FSI + " " + PDI + " 后段正文。",
  "uni-2028-2029": () => "行分隔" + LSEP + "与段分隔" + PSEP + "混在正文里。",
  "uni-surrogate-half": () => "前半 " + hi + " 后半 " + lo + " 各自孤立。",
  "uni-cjk-rtl-mixed": () => "中文句子里夹带 " + RLO + "עברית" + PDI + " 与 English 的混排行。" + rep(ZH, 20),
  "uni-nul-in-markdown": () => "前半段" + NUL + "中段" + NUL + "后半段",
  "num-200digit": () => rep("1234567890".repeat(20) + " ", 200) + " 以及 1e309 与 -0 与 NaN。",
  "num-json-tokens": () => rep('{"a":1e309,"b":-0,"c":NaN,"d":123456789012345678901234567890} ', 500),
  "benign-ascii-num": () => rep("1234567890 ", 2000) + " 普通数字串。",
};
function genMd(id) {
  const f = MD[id];
  if (!f) throw new Error("未知语料 id: " + id);
  return f();
}

/** HTML 正文（敌意 + 对照）：同一段可读正文，差别只在结构；每一项都配一个**等字节**的平铺对照
 *  （DOM 段用 jsdom 承载，绝对耗时含 jsdom 自身成本，所以判定只看「敌意 vs 等字节对照」的差） */
const HTML = {
  "html-nest-div-50k": () => "<html><head><title>五万层 div</title></head><body><article>" + rep("<div>", 50000) + rep(ZH, 6) + rep("</div>", 50000) + "</article></body></html>",
  "html-nest-bq-20k": () => "<html><head><title>两万层 blockquote</title></head><body><article>" + rep("<blockquote>", 20000) + rep(ZH, 6) + rep("</blockquote>", 20000) + "</article></body></html>",
  "html-nest-span-50k": () => "<html><head><title>五万层 span</title></head><body><article>" + rep("<span>", 50000) + rep(ZH, 6) + rep("</span>", 50000) + "</article></body></html>",
  "html-flat-p-9k": () => "<html><head><title>平铺段落</title></head><body><article>" + rep("<p>" + ZH.slice(0, 18) + "</p>", 9000) + "</article></body></html>",
  "html-entity-50k": () => "<html><head><title>实体海</title></head><body><article><p>" + rep("&times;", 50000) + rep(ZH, 4) + "</p></article></body></html>",
  "html-entity-half-open": () => "<html><head><title>半个实体</title></head><body><article><p>" + rep("&amp", 40000) + rep(ZH, 4) + "</p></article></body></html>",
  "html-ws-collapse-80k": () => "<html><head><title>空白坍缩</title></head><body><article><p>" + rep("  ", 40000) + "一个词" + rep(ZH, 4) + "</p></article></body></html>",
  "html-plain-350k": () => "<html><head><title>等长良性页</title></head><body><article><p>" + rep("填 充 一 段 与 实 体 海 等 长 的 普 通 中 文 正 文 ", 4700) + "</p></article></body></html>",
};
function genHtml(id) {
  const f = HTML[id];
  if (!f) throw new Error("未知 HTML 语料 id: " + id);
  return f();
}

// ---------- 手写 zip（jszip 造不出「说谎的中央目录」「重名条目」「zip-slip」，这几类必须自己拼字节） ----------
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crcUp(c, buf) {
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}
const crc32 = (buf) => (crcUp(0xffffffff, buf) ^ 0xffffffff) >>> 0;

/** 条目 → {rawLen, crc, comp, methodId}
 *  e.segments: [{data, times}] —— 用「同一片段重复 N 次 + 逐段 FULL_FLUSH 拼接」构造 200MB 级载荷，
 *  生成时只占一段的内存；末段必须 times=1（带结束块），否则流不完整。
 *  e.method="store" 用来做低解压比对照。 */
function entryPayload(e) {
  if (e.method === "store") {
    const buf = e.data || Buffer.concat((e.segments || []).map((s) => Buffer.concat(new Array(s.times || 1).fill(s.data))));
    return { rawLen: buf.length, crc: crc32(buf), comp: buf, methodId: 0 };
  }
  const segs = e.segments || [{ data: e.data || Buffer.alloc(0), times: 1 }];
  let rawLen = 0;
  let c = 0xffffffff;
  const compParts = [];
  segs.forEach((s, si) => {
    const times = s.times || 1;
    rawLen += s.data.length * times;
    for (let i = 0; i < times; i++) c = crcUp(c, s.data);
    const last = si === segs.length - 1;
    // 末段必须 Z_FINISH（写结束块），否则流不完整，jszip 报「uncompressed data size mismatch」；
    // 非末段用 Z_FULL_FLUSH（字节对齐 + 空 stored 块），逐段拼接后仍是合法 raw deflate 流
    const one = zlib.deflateRawSync(s.data, { level: 9, finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_FULL_FLUSH });
    for (let i = 0; i < times; i++) compParts.push(one);
  });
  return { rawLen, crc: (c ^ 0xffffffff) >>> 0, comp: Buffer.concat(compParts), methodId: 8 };
}

/** entries → zip Buffer；lieCd/lieLocal 用来做「中央目录撒谎」的差分 */
function buildZip(entries) {
  const body = [];
  const cd = [];
  let off = 0;
  for (const e of entries) {
    const nm = Buffer.from(e.name, "utf8");
    const { rawLen, crc, comp, methodId } = entryPayload(e);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志
    lh.writeUInt16LE(methodId, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // 1980-01-01，保证字节级确定性
    lh.writeUInt32LE(e.lieLocal && e.lieLocal.crc !== undefined ? e.lieLocal.crc : crc, 14);
    lh.writeUInt32LE(e.lieLocal && e.lieLocal.c !== undefined ? e.lieLocal.c : comp.length, 18);
    lh.writeUInt32LE(e.lieLocal && e.lieLocal.u !== undefined ? e.lieLocal.u : rawLen, 22);
    lh.writeUInt16LE(nm.length, 26);
    body.push(lh, nm, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(methodId, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(e.lieCd && e.lieCd.crc !== undefined ? e.lieCd.crc : crc, 16);
    ch.writeUInt32LE(e.lieCd && e.lieCd.c !== undefined ? e.lieCd.c : comp.length, 20);
    ch.writeUInt32LE(e.lieCd && e.lieCd.u !== undefined ? e.lieCd.u : rawLen, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    cd.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(body), cdBuf, eocd]);
}

/** 读自己写的 zip 的中央目录（自检用：证明「声明的解压体积」与「第三方解压器的实测」是同一件事） */
function readCd(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nl = buf.readUInt16LE(p + 28);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nl), usize: buf.readUInt32LE(p + 24), csize: buf.readUInt32LE(p + 20) });
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
function epubBytes(chapters, opts = {}) {
  const manifest = chapters.map((c, i) => `    <item id="c${i}" href="${c.href}" media-type="application/xhtml+xml"/>`).join("\n");
  const spine = chapters.map((_, i) => `    <itemref idref="c${i}"/>`).join("\n");
  const navLis = chapters.map((c, i) => `      <li><a href="${c.href}">${c.title || "第 " + (i + 1) + " 章"}</a></li>`).join("\n");
  const xhtml = (title, inner) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${inner}</body></html>`;
  const entries = [
    { name: "mimetype", data: Buffer.from("application/epub+zip"), method: "store" },
    {
      name: "META-INF/container.xml",
      data: Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', "utf8"),
    },
    {
      name: "OEBPS/content.opf",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:f40-${chapters.length}-${(opts.title || "").length}</dc:identifier><dc:title>${opts.title || "F40"}</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-09-10T00:00:00Z</meta></metadata>
  <manifest>
${manifest}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spine}
  </spine>
</package>`, "utf8"),
    },
    {
      name: "OEBPS/nav.xhtml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><ol>\n${navLis}\n</ol></nav></body></html>`, "utf8"),
    },
  ];
  for (const c of chapters) {
    const head = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${c.title || ""}</title></head><body>`, "utf8");
    const tail = Buffer.from("</body></html>", "utf8");
    const body = c.bodyBuf || Buffer.from(c.inner || "", "utf8");
    const segments = c.times ? [{ data: head, times: 1 }, { data: body, times: c.times }, { data: tail, times: 1 }] : [{ data: Buffer.concat([head, body, tail]), times: 1 }];
    entries.push({
      name: "OEBPS/" + c.href,
      segments,
      method: c.method,
      ...(c.lieCd ? { lieCd: c.lieCd } : {}),
      ...(c.lieLocal ? { lieLocal: c.lieLocal } : {}),
    });
  }
  // 额外条目（不进 manifest/spine）：用来造「5000 条目录项但只有 3 章是真书」的目录遍历成本
  for (const x of opts.extra || []) entries.push(x);
  return buildZip(entries);
}

/** docx：只放 [Content_Types].xml / _rels/.rels / word/document.xml，够 mammoth 走通 */
function docxBytes(bodyXml) {
  const B = (s) => Buffer.from(s, "utf8");
  return buildZip([
    { name: "[Content_Types].xml", data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: "_rels/.rels", data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: "word/document.xml", data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + bodyXml + "</w:body></w:document>") },
  ]);
}
const wP = (t) => "<w:p><w:r><w:t>" + t + "</w:t></w:r></w:p>";
const wTbl = (inner) => "<w:tbl><w:tr><w:tc>" + inner + "</w:tc></w:tr></w:tbl>";
function docxNested(n) { let s = wP("最深一格正文"); for (let i = 0; i < n; i++) s = wTbl(s); return wP("表前正文") + s + wP("表后正文"); }
function docxFlat(n) { let s = wP("表前正文"); for (let i = 0; i < n; i++) s += wTbl(wP("第 " + i + " 张平铺表格的一格正文")); return s + wP("表后正文"); }

/** 最小可用 PDF：每页一行文本；xref 偏移按真实字节算（pdfjs 严格些也能过） */
function pdfBytes(pages, textOf) {
  const objs = [];
  const head = "%PDF-1.4\n";
  const nFont = 3;
  const kids = [];
  for (let i = 0; i < pages; i++) kids.push((4 + i * 2) + " 0 R");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Count " + pages + " /Kids [" + kids.join(" ") + "] >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pages; i++) {
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 " + nFont + " 0 R >> >> /Contents " + (5 + i * 2) + " 0 R >>");
    const stream = "BT /F1 11 Tf 72 720 Td (" + textOf(i).replace(/[()\\]/g, "") + ") Tj ET";
    objs.push("<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream");
  }
  let out = head;
  const offsets = [0];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xrefAt = Buffer.byteLength(out);
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i <= objs.length; i++) out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}

// ==================================================================
// 2. 子进程：跑一段真实管线（解析器/合成器都是产品代码本体），量时间与内存
// ==================================================================
function corpusPath(name) { return path.join(CORPUS_DIR, name); }
function writeCorpus(name, buf) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  const p = corpusPath(name);
  try {
    if (!process.env.F40_REGEN && fs.existsSync(p) && fs.statSync(p).size === buf.length) return p; // 命中缓存
  } catch { /* 落到重写 */ }
  fs.writeFileSync(p, buf);
  return p;
}

/** 负载探针：固定微基准，用来判断「敌意项与良性项是不是在同样的机器压力下测的」 */
function calibrate() {
  const t = process.hrtime.bigint();
  let h = 2166136261;
  for (let i = 0; i < 2000000; i++) { h ^= i; h = Math.imul(h, 16777619); }
  if (h === 0) console.log("x");
  return Number(process.hrtime.bigint() - t) / 1e6;
}

function classifyErr(e) {
  const msg = String((e && e.message) || e || "");
  const name = (e && e.name) || "Error";
  if (/call stack size exceeded/i.test(msg)) return "stack-overflow(" + name + ")";
  if (/heap out of memory|out of memory|ARRAY_SIZE/i.test(msg)) return "OOM(" + name + ")";
  if (/CORRUPTED|corrupted|bad block|invalid distance|CRC/i.test(msg)) return "zip-corrupt(" + name + ")";
  if (/ENOENT|not found/i.test(msg)) return "not-found(" + name + ")";
  return name;
}

let DOM_READY = false;
function setupDom() {
  if (DOM_READY) return;
  const { JSDOM } = require(path.join(ROOT, "node_modules", "jsdom"));
  // pretendToBeVisual：epub-ts 顶层就取 window.requestAnimationFrame.bind(window)，
  // 默认 jsdom 不装 rAF → require 阶段直接 TypeError
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.com/", pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.DOMParser = dom.window.DOMParser;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.Blob = dom.window.Blob;
  global.FileReader = dom.window.FileReader;
  try { Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true }); } catch { /* 老 node 直接赋值即可 */ }
  DOM_READY = true;
}
function loadEngine(stage) {
  if (stage === "html") { setupDom(); return { html: require(path.join(CACHE_DIR, "f40-html.bundle.cjs")) }; }
  setupDom();
  const epub = require(path.join(CACHE_DIR, "f40-epub.bundle.cjs"));
  if (stage === "epub") return { epub };
  if (stage === "synth") return { epub };
  return { im: require(path.join(ROOT, "electron", "importers.js")), epub };
}

async function childEntry() {
  const spec = JSON.parse(fs.readFileSync(process.env.F40_SPEC_FILE, "utf8"));
  const res = { id: spec.id, stage: spec.stage, heapLimitMB: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576) };
  // 接住「无人认领」的 rejection / exception：产品代码里这一类是渲染层的静默黑洞
  // （await 的 promise 可能永不 settle → 导入框一直转），必须能被抓到而不是让子进程悄悄死掉
  const unhandled = [];
  let parseDone = false;
  const dumpHung = () => {
    try {
      const mm = process.memoryUsage();
      res.unhandled = unhandled;
      res.hungAfterRejection = true;
      res.parseMs = Number((process.hrtime.bigint() - tStart) / 1000000n);
      res.pipelineMs = res.parseMs;
      res.rssDeltaMB = m0 ? Number(((mm.rss - m0.rss) / 1048576).toFixed(1)) : 0;
      res.rssMB = Math.round(mm.rss / 1048576);
      fs.writeFileSync(process.env.F40_OUT, JSON.stringify(res));
    } catch { /* 尽力 */ }
    process.exit(0);
  };
  process.on("unhandledRejection", (e) => {
    unhandled.push(classifyErr(e) + ": " + String((e && e.message) || e).slice(0, 160));
    if (!parseDone) setTimeout(dumpHung, 1500); // await 的那条 promise 再不 settle —— 记为「悬挂」
  });
  process.on("uncaughtException", (e) => {
    unhandled.push("uncaught " + classifyErr(e) + ": " + String((e && e.message) || e).slice(0, 160));
    if (!parseDone) dumpHung();
  });
  res.calibMs = Number(calibrate().toFixed(1));
  const tStart = process.hrtime.bigint();
  const eng = loadEngine(spec.stage);
  const im = () => (eng.im || (eng.im = require(path.join(ROOT, "electron", "importers.js"))));
  const epub = () => eng.epub || (eng.epub = require(path.join(CACHE_DIR, "f40-epub.bundle.cjs")));

  let markdown = null;
  let meta = {};
  const m0 = process.memoryUsage();
  const t0 = process.hrtime.bigint();
  let err = null;
  try {
    switch (spec.stage) {
      case "epub": {
        const buf = fs.readFileSync(corpusPath(spec.file));
        meta.zipBytes = buf.length;
        const r = await epub().parseEpubBytes(spec.file, new Uint8Array(buf));
        markdown = r.markdown;
        meta.title = r.title;
        meta.toc = (r.toc || []).length;
        break;
      }
      case "html": {
        const html = genHtml(spec.gen);
        meta.inBytes = Buffer.byteLength(html);
        const r = eng.html.htmlToMarkdown(html);
        markdown = r.markdown;
        meta.via = r.via;
        meta.title = r.title;
        break;
      }
      case "word": {
        const buf = fs.readFileSync(corpusPath(spec.file));
        meta.inBytes = buf.length;
        const r = await im().wordToMarkdown(buf);
        markdown = r.markdown;
        meta.images = (r.images || []).length;
        break;
      }
      case "md": {
        const src = genMd(spec.gen);
        meta.inBytes = Buffer.byteLength(src);
        markdown = im().markdownFromText(src);
        break;
      }
      case "txt": {
        const src = genMd(spec.gen);
        meta.inBytes = Buffer.byteLength(src);
        markdown = im().txtToMarkdown(im().decodeTextBytes(Buffer.from(src, "utf8")).text);
        break;
      }
      case "pdf": {
        const buf = fs.readFileSync(corpusPath(spec.file));
        meta.inBytes = buf.length;
        const r = await im().pdfToMarkdown(buf);
        markdown = r.markdown;
        meta.pages = r.pages;
        meta.chapters = r.chapters;
        break;
      }
      case "synth": {
        markdown = genMd(spec.gen);
        meta.inBytes = Buffer.byteLength(markdown);
        break;
      }
      case "zipcheck": {
        // 语料自检：用第三方 unzip（jszip，epub-ts 内部用的就是它）把包过一遍，
        // 先证明「炸弹是真的」（解压后确有 N 字节）、谎言条目是否被察觉 —— 之后才有资格谈应用行为。
        const JSZip = require(path.join(ROOT, "node_modules", "jszip"));
        const buf = fs.readFileSync(corpusPath(spec.file));
        meta.zipBytes = buf.length;
        const z = await JSZip.loadAsync(buf);
        const list = Object.keys(z.files).filter((n) => !z.files[n].dir);
        meta.entries = list.length;
        res.entryCount = list.length;
        const f = z.file(spec.checkEntry);
        if (!f) throw new Error("自检失败：包里找不到 " + spec.checkEntry);
        meta.declared = (f._data && f._data.uncompressedSize) || 0;
        const u = await f.async("nodebuffer");
        res.outBytes = u.length;
        res.outChars = u.length;
        meta.entryBytes = u.length;
        meta.declaredVsReal = (f._data && f._data.uncompressedSize) + " vs " + u.length;
        markdown = null;
        break;
      }
      case "sleep": {
        await new Promise((r) => setTimeout(r, Number(spec.gen || 60000)));
        break;
      }
      default:
        throw new Error("未知 stage: " + spec.stage);
    }
  } catch (e) {
    err = e;
  }
  res.parseMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  parseDone = true;
  /** 产物标记数：正文 HTML 里的标签数（`<` 计数）——「输出膨胀」的可比口径 */
  const countMarkers = (mdText) => {
    const tr = process.hrtime.bigint();
    try {
      const body = epub().renderMarkdownToBodyHtml(mdText);
      res.htmlChars = body.length;
      res.markers = (body.match(/</g) || []).length;
      res.katexSpans = (body.match(/katex/g) || []).length;
    } catch (e) {
      res.error = res.error || { name: classifyErr(e), msg: String(e.message || e).slice(0, 200) };
    }
    res.renderMs = Number(process.hrtime.bigint() - tr) / 1e6;
  };
  if (markdown != null) {
    res.outChars = markdown.length;
    res.outBytes = Buffer.byteLength(markdown);
    res.outLines = markdown.split("\n").filter((l) => l.trim()).length;
    res.head = JSON.stringify(markdown.slice(0, 40));
    res.tail = JSON.stringify(markdown.slice(-40));
    if (spec.expectChars != null) res.shortBy = spec.expectChars - markdown.length;
    if (spec.saveMd) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, spec.saveMd), markdown, "utf8"); }
  }
  if (err) {
    res.error = { name: classifyErr(err), msg: String(err.message || err).slice(0, 220) };
  } else if (spec.chain) {
    // 第二段：解析产物 → 合成 EPUB（markdown-it + KaTeX + jszip），这才是「导入到能读」的完整代价
    if (spec.countMarkers) countMarkers(markdown);
    const t1 = process.hrtime.bigint();
    try {
      const r = await epub().buildSyntheticEpub(spec.title || "F40", markdown, { embedKatexCss: spec.katexCss !== false });
      res.synthMs = Number((process.hrtime.bigint() - t1) / 1000000n);
      res.synthBytes = r.bytes.length;
      res.chapters = r.toc.length;
    } catch (e) {
      res.synthMs = Number((process.hrtime.bigint() - t1) / 1000000n);
      res.error = { stage2: true, name: classifyErr(e), msg: String(e.message || e).slice(0, 220) };
    }
  } else if (spec.stage === "synth") {
    countMarkers(markdown);
    const t2 = process.hrtime.bigint();
    try {
      const r = await epub().buildSyntheticEpub(spec.title || "F40", markdown, {});
      res.synthMs = Number((process.hrtime.bigint() - t2) / 1000000n);
      res.synthBytes = r.bytes.length;
      res.chapters = r.toc.length;
    } catch (e) {
      res.synthMs = Number((process.hrtime.bigint() - t2) / 1000000n);
      res.error = res.error || { stage2: true, name: classifyErr(e), msg: String(e.message || e).slice(0, 220) };
    }
  }
  const m1 = process.memoryUsage();
  res.rssMB0 = Math.round(m0.rss / 1048576);
  res.rssMB = Math.round(m1.rss / 1048576);
  res.rssDeltaMB = Number(((m1.rss - m0.rss) / 1048576).toFixed(1));
  res.heapMB = Math.round(m1.heapUsed / 1048576);
  // 管线口径：解析 + （渲染或合成，取实际发生的那段）；renderMs 只作诊断，不与 synthMs 重复计入
  res.pipelineMs = Number(res.parseMs || 0) + Number(res.synthMs || 0) + (res.synthMs == null ? Number(res.renderMs || 0) : 0);
  res.meta = meta;
  res.inBytes = meta.inBytes != null ? meta.inBytes : meta.zipBytes;
  res.title = meta.title;
  res.via = meta.via;
  res.unhandled = unhandled;
  fs.writeFileSync(process.env.F40_OUT, JSON.stringify(res));
  process.exit(0);
}

// ==================================================================
// 3. 父进程：造语料 → 起子进程跑敌意输入 → 落库量代价 → 逐条对预算
// ==================================================================
const LEDGER = [];
const DB_DIRS = [];
let childSeq = 0;

async function parentEntry() {
  const { app } = require("electron");
  const { Flow, runFlow } = require("./lib/harness.cjs");
  const { bootFlowDb, audit, quit } = require("./lib/dbenv.cjs");
  const im = require(path.join(ROOT, "electron", "importers.js"));

  const flow = new Flow({
    id: "F40",
    title: "敌意语料资源面（输入即 DoS）",
    angle: "时间/内存/递归/膨胀的代价预算：既有 37 条只测对不对，没人测贵不贵",
    cites: ["§7.5", "§7.1.3", "§9.1 M6", "§9.1 M6-1", "§9.1 M6-2", "§9.1 M6-3", "§4.2", "§7.1.8"],
    tier: 2,
    gui: false,
  });

  // ---------- 子进程封装（超时 = 自 spawn 自硬杀，绝不影响其他 electron 进程） ----------
  // 引擎选择：jsdom 30 依赖 ESM-only 包（html-encoding-sniffer → @exodus/bytes），
  // Electron 31 内置的 node20 不支持 require(ESM) —— 所以 DOM 段必须用系统 node；
  // 找不到系统 node 时退回 ELECTRON_RUN_AS_NODE，并把 DOM 段如实标为「未测」。
  const RUNTIME = (() => {
    const probe = spawnSync("node", ["-v"], { encoding: "utf8", timeout: 15000, windowsHide: true });
    if (!probe.error && probe.status === 0 && /\d/.test(probe.stdout || "")) return { cmd: "node", label: "node " + probe.stdout.trim() };
    return { cmd: process.execPath, label: "electron-as-node (v8 " + process.versions.v8 + ")：jsdom 不可用" };
  })();
  function spawnChild(spec, hardMs) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const n = ++childSeq;
    const sf = path.join(OUT_DIR, "spec-" + spec.id + "-" + n + ".json");
    const outFile = path.join(OUT_DIR, "out-" + spec.id + "-" + n + ".json");
    fs.writeFileSync(sf, JSON.stringify(spec));
    try { fs.rmSync(outFile, { force: true }); } catch { /* 无 */ }
    const t0 = Date.now();
    const env = Object.assign({}, process.env, {
      F40_CHILD: "1",
      F40_SPEC_FILE: sf,
      F40_OUT: outFile,
      NODE_OPTIONS: "--max-old-space-size=2048",
    });
    if (RUNTIME.cmd !== "node") env.ELECTRON_RUN_AS_NODE = "1";
    const r = spawnSync(RUNTIME.cmd, [__filename], {
      cwd: ROOT,
      env,
      timeout: hardMs,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const wallMs = Date.now() - t0;
    let out = null;
    try { out = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch { /* 子进程没交付 */ }
    // Windows 下 spawnSync 的 timeout 实际发的是 SIGTERM（killSignal 被忽略），一律以 error.code 为准
    const timedOut = Boolean(r.error && r.error.code === "ETIMEDOUT") || (r.signal != null && r.status == null);
    const base = out || {};
    const res = Object.assign({}, base, { wallMs, exitCode: r.status, timedOut, stderr: base.fatal ? String(base.fatal).slice(0, 200) : String(r.stderr || "").replace(/\s+/g, " ").slice(-220) });
    // 口径：ms = 管线自身耗时（parse + render + synth），不含 ~400ms 的子进程启动与打包 require；
    // 硬超时/崩溃时拿不到分段值，退回 wallMs 并以预算硬顶为下限标注。
    res.ms = Number(base.pipelineMs || 0);
    if (!out) {
      res.ms = Math.max(wallMs, 0);
      res.rssDeltaMB = 0;      res.error = timedOut
        ? { name: "硬超时被父进程 SIGKILL", msg: "子进程在 " + hardMs + "ms 预算硬顶内没跑完（下面是父进程观察到的墙钟）" }
        : { name: "进程级崩溃（未交付结果）", msg: (res.exitCode === null ? "被信号 " + r.signal : "退出码 " + res.exitCode) + " | " + (res.stderr || "").slice(0, 160) };
      if (!timedOut) res.processCrash = true;
      if (timedOut) res.ms = hardMs;
    }
    // 「应用自己拒绝」≠「被我超时杀掉/崩溃」：只有产品代码抛出的可读错误才算 loud rejection
    res.appRejected = Boolean(res.error) && !res.timedOut && !res.processCrash;
    try { fs.rmSync(sf, { force: true }); fs.rmSync(outFile, { force: true }); } catch { /* 尽力 */ }
    return res;
  }

  /** best-of-N：并发长跑会污染计时，取最快一次（最保守的「不是别人的锅」口径） */
  function timedChild(item, reps) {
    const runs = [];
    const budgetMs = item.budgetMs || BUD.smallMs;
    for (let i = 0; i < reps; i++) {
      const r = spawnChild(item.spec, item.hardMs || budgetMs * 3 + 3000);
      runs.push(r);
      if (r.timedOut || r.processCrash) break;
      if (r.ms > budgetMs * 2.5) break; // 第一次就炸穿 2.5×，认定超支，不再烧机
    }
    const best = runs.reduce((a, b) => (!a || b.ms < a.ms ? b : a));
    const worst = runs.reduce((a, b) => (!a || (b.rssDeltaMB || 0) > (a.rssDeltaMB || 0) ? b : a));
    best.worstRssDeltaMB = worst.rssDeltaMB;
    best.reps = runs.length;
    best.allCalib = runs.map((x) => x.calibMs).join("/");
    return best;
  }

  const sizeOf = (id) => { try { return fs.statSync(corpusPath(id)).size; } catch { return null; } };
  /** 按输入字节数配时间预算：1.5s 基数 + 每 250KB 加 1s，封顶 12s（DOM 段含 jsdom 自身成本，
   *  不给尺寸项放宽就会把「大但合法」误判成炸弹；敌意项该炸的是 B3 膨胀比与 B4 静默截断，不是这条） */
  function prepItem(item) {
    if (item.inBytes == null) item.inBytes = item.spec.gen ? (item.spec.stage === "html" ? Buffer.byteLength(genHtml(item.spec.gen)) : Buffer.byteLength(genMd(item.spec.gen))) : sizeOf(item.spec.file);
    if (item.scale) item.budgetMs = Math.min(BUD.smallMs + Math.ceil(Math.max(0, item.inBytes || 0) / 250000) * 1000, 12000);
    if (!item.hardMs) item.hardMs = (item.budgetMs || BUD.smallMs) * 3 + 3000;
    return item;
  }

  /** 对一项做 B1/B2/B3/B4 判定并把量级写进台账 */
  function judge(item, r) {
    const msB = item.budgetMs || BUD.smallMs;
    const inB = item.inBytes != null ? item.inBytes : r.inBytes != null ? r.inBytes : sizeOf(item.spec.file || "") ;
    const ratio = inB && r.outBytes != null ? (r.outBytes / inB).toFixed(1) : (item.ratio || "-");
    flow.record(
      item.id + " 实测",
      `耗时 ${r.ms}ms(best-of-${r.reps}${r.timedOut ? "·硬超时被杀，为下限" : ""}${r.processCrash ? "·进程崩溃，取墙钟" : ""}；墙钟 ${r.wallMs}ms) ` +
        `parse=${r.parseMs == null ? "-" : r.parseMs}ms synth=${r.synthMs == null ? "-" : r.synthMs}ms · rssΔ ${r.rssDeltaMB}MB(峰值 ${r.rssMB || "-"}MB/堆上限 ${r.heapLimitMB || "-"}MB) · ` +
        `输入 ${inB == null ? "-" : inB}B → 产物 ${r.outChars == null ? "-" : r.outChars}ch/${r.outLines == null ? "-" : r.outLines}行(膨胀 ${ratio}:1) ` +
        `synthBytes=${r.synthBytes == null ? "-" : r.synthBytes} · calib ${r.allCalib || r.calibMs}ms` +
        (r.error ? ` · 错误[${r.error.name}]${r.error.msg ? " " + r.error.msg.slice(0, 90) : ""}` : "")
    );
    LEDGER.push({ id: item.id, ms: r.ms, rssMB: r.rssDeltaMB, outChars: r.outChars, outLines: r.outLines, ratio, budgetMs: msB, err: r.error && r.error.name, timedOut: !!r.timedOut, calib: r.calibMs, reps: r.reps });
    flow.check(`${item.id} B1 时间预算 ≤ ${msB}ms`, !r.processCrash && r.ms <= msB, "≤" + msB + "ms 且子进程存活", r.ms + "ms" + (r.timedOut ? "（硬超时）" : "") + (r.processCrash ? "（进程崩溃）" : ""));
    flow.check(`${item.id} B2 内存预算 ≤ ${BUD.maxRssMB}MB 且无进程级崩溃`, !r.processCrash && (r.worstRssDeltaMB || 0) <= BUD.maxRssMB, "≤" + BUD.maxRssMB + "MB", `rssΔ 最差 ${r.worstRssDeltaMB}MB · 退出码 ${r.exitCode}`);
    flow.check(`${item.id} B4 不得留下无人接手的 Promise 拒绝/未捕获异常`, !(r.unhandled && r.unhandled.length) && !r.hungAfterRejection, "零 unhandledRejection", (r.unhandled || []).join(" | ") + (r.hungAfterRejection ? "（await 的 promise 此后再没 settle → 导入框会一直转）" : ""));
    if (!r.error && r.ms > msB * 3) flow.record(item.id + " 慢但成功（无错误返回）", `用户会看到 ${Math.round(r.ms / 1000)} 秒无响应窗口，且没有任何进度/取消`);
    return r;
  }

  // ---------- 打包渲染层管线（epub.ts / htmlImport.ts 是渲染层代码，用 esbuild + jsdom 在 node 里跑真身） ----------
  async function buildBundles() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
    const rawPlugin = {
      name: "raw-css",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.isAbsolute(a.path.replace(/\?raw$/, "")) ? a.path.replace(/\?raw$/, "") : path.join(ROOT, "node_modules", a.path.replace(/\?raw$/, "")), namespace: "raw-file" }));
        build.onLoad({ filter: /.*/, namespace: "raw-file" }, async (a) => ({ contents: await fs.promises.readFile(a.path), loader: "text" }));
      },
    };
    const jobs = [
      { entry: "src/lib/epub.ts", out: "f40-epub.bundle.cjs", plugins: [rawPlugin] },
      { entry: "src/lib/htmlImport.ts", out: "f40-html.bundle.cjs" },
    ];
    for (const j of jobs) {
      const dest = path.join(CACHE_DIR, j.out);
      await esbuild.build({ entryPoints: [path.join(ROOT, j.entry)], bundle: true, platform: "node", format: "cjs", target: "node20", outfile: dest, logLevel: "silent", plugins: j.plugins });
    }
  }

  // ---------- 语料落盘（全部程序化生成；EPUB/DOCX/PDF 是真文件，md/html 由生成函数现场产出） ----------
  function buildCorpus() {
    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    const chapterMd = (n) => "<h1>第 " + n + " 章</h1>" + rep("<p>" + ZH + "</p>", 40);
    const files = {};
    // 良性基线：结构与合成器一致，正文用真实中英文
    files["benign-typical.epub"] = epubBytes([1, 2, 3].map((i) => ({ href: "c" + i + ".xhtml", title: "第 " + i + " 章", inner: chapterMd(i) })), { title: "良性基线" });
    // 良性大书：~1.5MB 正文（压缩后同量级于炸弹的压缩包）
    files["benign-1p5mb.epub"] = epubBytes([{ href: "c1.xhtml", title: "大章", inner: rep("<p>" + ZH + "</p>", 20000) }], { title: "良性 1.5MB" });
    // 解压炸弹：单章解压后 200MB（正好 1MB 的片段 × 200），压缩包只有几百 KB —— 「小输入 → 大输出」的正主
    const bombUnit = Buffer.from("<p>" + rep("填充句子用来把体积撑到一兆字节。", 22000) + "</p>\n", "utf8");
    const bombPart = bombUnit.length >= 1024 * 1024 ? bombUnit.subarray(0, 1024 * 1024) : Buffer.concat([bombUnit, Buffer.alloc(1024 * 1024 - bombUnit.length, 0x20)]);
    files["bomb-200mb.epub"] = epubBytes([{ href: "c1.xhtml", title: "炸弹章", inner: "", bodyBuf: bombPart, times: 200 }], { title: "炸弹" });
    // 低解压比对照：同样量级的解压后体积，但 STORE（≈1:1）——用来把「200MB 内容本身就慢」与「炸弹」分开
    const stored = Buffer.concat([Buffer.from("<p>", "utf8"), Buffer.from(rep("存 储 方 式 的 对 照 正 文 不 会 被 压 缩 。", 66000), "utf8"), Buffer.from("</p>\n", "utf8")]);
    files["stored-3mb.epub"] = epubBytes([{ href: "c1.xhtml", title: "对照章", inner: "", bodyBuf: stored, method: "store" }], { title: "低比对照" });
    // 5000 条目的包（4997 条与书无关，只是躺在目录里等着被遍历）：量「目录条目数」这一维的成本
    files["entries-5000.epub"] = epubBytes(
      [1, 2, 3].map((i) => ({ href: "c" + i + ".xhtml", title: "第 " + i + " 章", inner: chapterMd(i) })),
      { title: "多条目", extra: Array.from({ length: 4997 }, (_, i) => ({ name: "OEBPS/junk/" + i + ".bin", data: Buffer.from("junk" + i, "utf8"), method: "store" })) }
    );
    // 中央目录撒谎：声明解压后 400MB（真实 4KB）
    files["lie-up.epub"] = epubBytes([
      { href: "c1.xhtml", title: "撒谎章", inner: chapterMd(1), lieCd: { u: 400 * 1024 * 1024 } },
    ], { title: "撒谎向上" });
    // 中央目录 + 本地头一起撒谎「往小里说」：真实 6000B 声明 12B → 会不会静默截断
    const big = "<p>" + rep("这一段的真实长度远大于声明长度，用来检测静默截断。", 100) + "</p>";
    files["lie-down.epub"] = epubBytes([
      { href: "c1.xhtml", title: "截断章", inner: big, lieCd: { u: 12, c: 12 }, lieLocal: { u: 12, c: 12 } },
      { href: "c2.xhtml", title: "正常章", inner: chapterMd(2) },
    ], { title: "撒谎向下" });
    // 重名/重叠条目：第一个是真章节，第二个是劫持文本
    {
      const a = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>正章</title></head><body><p>' + rep("正版正文：用户买到的这本书的内容。", 60) + "</p></body></html>", "utf8");
      const b = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>劫持</title></head><body><p>' + rep("被覆盖的同名条目内容。", 60) + "</p></body></html>", "utf8");
      files["dupnames.epub"] = buildZip([
        { name: "mimetype", data: Buffer.from("application/epub+zip"), method: "store" },
        { name: "META-INF/container.xml", data: Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', "utf8") },
        { name: "OEBPS/content.opf", data: Buffer.from('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:f40-dup</dc:identifier><dc:title>重名</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="c0" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c0"/></spine></package>', "utf8") },
        { name: "OEBPS/c1.xhtml", data: a },
        { name: "OEBPS/c1.xhtml", data: b },
      ]);
    }
    // zip-slip：章节 href 里带 ../../，看它会不会被当路径写到数据目录外
    files["zipslip.epub"] = epubBytes([{ href: "../../../f40-escape.xhtml", title: "穿越章", inner: chapterMd(1) }], { title: "穿越" });
    // docx 深嵌套表 / 平铺表对照
    files["docx-nested-200.docx"] = docxBytes(docxNested(200));
    files["docx-flat-200.docx"] = docxBytes(docxFlat(200));
    // pdf：1500 页 vs 150 页
    files["pdf-1500p.pdf"] = pdfBytes(1500, (i) => "Page " + i + " body text for extraction cost measurement.");
    files["pdf-150p.pdf"] = pdfBytes(150, (i) => "Page " + i + " body text for extraction cost measurement.");
    const written = {};
    for (const [name, buf] of Object.entries(files)) {
      writeCorpus(name, buf);
      written[name] = buf.length;
    }
    return written;
  }

  // ---------- 落库段（父进程：db.js 需要 electron 的 app 路径，只能在主进程里跑） ----------
  let selfTest = null;
  const RESULTS = {};
  const mdResOf = (id) => RESULTS[id] || { ms: 0, error: { name: "未跑" } };
  let dbSeq = 0;
  async function runDbCase(item) {
    const src = item.gen ? genMd(item.gen) : String(item.markdown || "");
    const cleaned = item.rawMd ? src : im.markdownFromText(src);
    const cal0 = calibrate();
    const m0 = process.memoryUsage();
    const label = "f40-" + item.id + "-" + ++dbSeq;
    const env = await bootFlowDb(label);
    DB_DIRS.push(env.dir);
    const res = { id: item.id, inBytes: Buffer.byteLength(src), cleanBytes: Buffer.byteLength(cleaned), wantTitle: (item.title || "F40 " + item.id).trim() };
    const t0 = process.hrtime.bigint();
    let err = null;
    let created = null;
    try {
      created = env.db.createImportedDoc({
        title: item.title || "F40 " + item.id,
        markdown: cleaned,
        sourceType: item.source || "markdown",
        sourceName: item.sourceName || item.id + ".md",
        originalName: item.originalName || item.id + ".md",
        originalBuf: item.originalBuf || Buffer.from(src, "utf8"),
        images: item.images || [],
      });
    } catch (e) {
      err = e;
      res.error = { name: classifyErr(e), msg: String(e && e.message ? e.message : e).slice(0, 200) };
    }
    res.importMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!err) {
      const t1 = process.hrtime.bigint();
      env.db.persistNow();
      res.persistMs = Number(process.hrtime.bigint() - t1) / 1e6;
      const t2 = process.hrtime.bigint();
      env.db.createFromPaste("F40 二次写入探针", "极短正文。");
      res.tinyWriteMs = Number(process.hrtime.bigint() - t2) / 1e6;
    }
    const m1 = process.memoryUsage();
    res.rssDeltaMB = Number(((m1.rss - m0.rss) / 1048576).toFixed(1));
    res.calibMs = Number((cal0 + calibrate()).toFixed(1)) / 2;
    try { res.dbBytes = fs.statSync(env.dbFile).size; } catch { res.dbBytes = -1; }
    if (created) {
      const aud = await audit(env.dbFile);
      const row = aud.one("SELECT markdown FROM documents WHERE library_item_id = ?", [created.id]);
      const trow = aud.one("SELECT title, source_name FROM library_items WHERE id = ?", [created.id]);
      res.docCount = aud.count("documents");
      res.itemCount = aud.count("library_items");
      res.storedChars = row ? String(row.markdown || "").length : -1;
      res.storedBytes = row ? Buffer.byteLength(String(row.markdown || "")) : -1;
      res.fidelity = row ? String(row.markdown) === cleaned : false;
      res.titleStored = trow ? String(trow.title) : null;
      res.titleFidelity = trow ? String(trow.title) === res.wantTitle : false;
      res.sourceNameStored = trow ? String(trow.source_name) : null;
      res.assets = aud.rows("SELECT path FROM assets WHERE library_item_id = ?", [created.id]).map((r) => r.path);
      res.dbTitles = aud.rows("SELECT id, title FROM library_items WHERE is_deleted = 0").length;
      aud.close();
    }
    try { fs.rmSync(env.dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ }
    DB_DIRS.splice(DB_DIRS.indexOf(env.dir), 1);
    res.ms = Math.max(res.importMs || 0, 0) + Math.max(res.persistMs || 0, 0);
    return res;
  }
  function judgeDb(item, r) {
    const msB = item.budgetMs || BUD.docMs;
    flow.record(
      r.id + " 落库实测",
      `createImportedDoc ${r.importMs.toFixed(0)}ms + persist ${r.persistMs == null ? "-" : r.persistMs.toFixed(0)}ms · ` +
        `此后一次极短写入 ${r.tinyWriteMs == null ? "-" : r.tinyWriteMs.toFixed(0)}ms · 库文件 ${r.dbBytes}B · 输入 ${r.inBytes}B→正文 ${r.storedBytes}B · ` +
        `rssΔ ${r.rssDeltaMB}MB · calib ${r.calibMs}ms${r.error ? " · 错误[" + r.error.name + "] " + r.error.msg : ""}`
    );
    LEDGER.push({ id: r.id + "(落库)", ms: Math.round(r.ms), rssMB: r.rssDeltaMB, outBytes: r.storedBytes, budgetMs: msB, err: r.error && r.error.name, calib: r.calibMs });
    flow.check(`${r.id} B1 落库时间预算 ≤ ${msB}ms`, !r.error && r.ms <= msB, "≤" + msB + "ms", `${Math.round(r.ms)}ms${r.error ? " · 抛错" : ""}`);
    flow.check(`${r.id} B2 落库内存预算 ≤ ${BUD.maxRssMB}MB`, (r.rssDeltaMB || 0) <= BUD.maxRssMB, "≤" + BUD.maxRssMB + "MB", r.rssDeltaMB + "MB");
    if (item.expectFidelity !== false) flow.check(`${r.id} B4 正文逐字符往返（documents.markdown 是唯一真源，坏了没有第二份）`, r.fidelity === true, true, r.fidelity === false ? `库内 ${r.storedChars}ch vs 输入 ${cleanLen(item)}ch` : r.fidelity);
    return r;
  }
  const cleanLen = (item) => { const s = item.gen ? genMd(item.gen) : String(item.markdown || ""); return (item.rawMd ? s : im.markdownFromText(s)).length; };

  // ---------- 静态面：导入侧到底有没有「体积/深度」上限 ----------
  function capsAudit() {
    const srcs = ["electron/importers.js", "src/lib/epub.ts", "src/lib/htmlImport.ts", "electron/db.js", "electron/main.js"]
      .map((p) => ({ p, t: fs.readFileSync(path.join(ROOT, p), "utf8") }));
    const caps = [];
    for (const s of srcs) {
      for (const m of s.t.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*(MAX|LIMIT|CAP|BUDGET)[A-Z0-9_]*|[A-Z0-9_]*(MAX|LIMIT)[A-Z0-9_]*)\s*=\s*([^;\n]{1,40})/g)) {
        caps.push(s.p + ":" + m[1] + "=" + String(m[4] || "").trim());
      }
    }
    return caps;
  }

  const s = await runFlow(flow, async () => {
    // =============== S0 前置：语料 + 打包 ===============
    flow.section("S0 前置：渲染层管线打包（epub.ts / htmlImport.ts 真身）+ 语料落盘（>1MB 的收尾会删）");
    await buildBundles();
    const sizes = buildCorpus();
    flow.record("父进程/子进程引擎", `父 ${process.versions.electron ? "electron " + process.versions.electron : "node " + process.versions.node}（v8 ${process.versions.v8}）· 子 ${RUNTIME.label}`);
    flow.record("语料文件（字节）", Object.entries(sizes).map(([k, v]) => k + "=" + v).join(" "));
    flow.guard("esbuild 打包出的两个 bundle 存在（渲染层管线可在 node 里跑真身）", () => {
      const a = path.join(CACHE_DIR, "f40-epub.bundle.cjs"), b = path.join(CACHE_DIR, "f40-html.bundle.cjs");
      return fs.existsSync(a) && fs.existsSync(b) && fs.statSync(a).size > 10000 && fs.statSync(b).size > 10000;
    });
    flow.guard("语料落盘齐备", () => Object.keys(sizes).length > 8);
    flow.guard("子进程机制可用（ELECTRON_RUN_AS_NODE + 管线跑通）", () => {
      const r = spawnChild({ id: "selftest", stage: "synth", gen: "benign-math-100", title: "自检" }, 30000);
      selfTest = r;
      console.log("    [自检原始结果] " + JSON.stringify(r).slice(0, 900));
      return !r.processCrash && typeof r.renderMs === "number" && r.outBytes > 1000;
    });
    flow.record("子进程自检", `墙钟 ${selfTest.wallMs}ms · 管线 ${selfTest.ms}ms · heap 上限 ${selfTest.heapLimitMB}MB（NODE_OPTIONS 是否生效由此自证）· synth ${selfTest.synthMs}ms → ${selfTest.synthBytes}B EPUB`);
    flow.check("子进程侧 --max-old-space-size=2048 生效（危险输入被限制在受控堆里，不会拖垮整机）", selfTest.heapLimitMB > 1800 && selfTest.heapLimitMB < 2600, "≈2048MB", selfTest.heapLimitMB + "MB");
    {
      // B0：硬超时机制本身要自证 —— 这一层的「不拖垮机器」全押在它能杀得掉
      const to = spawnChild({ id: "timeout-selftest", stage: "sleep", gen: "60000" }, 3000);
      flow.record("硬超时自证（60s 的 sleep，预算 3s）", `墙钟 ${to.wallMs}ms · timedOut=${to.timedOut} · 信号 ${selfTest && to.error ? to.error.name : "-"}`);
      flow.check("B0 超时能杀掉自己起的子进程（不会把测试机挂住）", to.timedOut && to.wallMs < 12000, "3s 内被杀", `${to.wallMs}ms · ${JSON.stringify(to.error || {})}`);
    }

    // =============== S1 语料自检：先证明炸弹是真的 ===============
    flow.section("S1 语料自检（用 jszip——epub-ts 内部同一个解压器——验包：炸弹真有 200MB、谎话真在目录里）");
    const checks = [
      { name: "benign-typical.epub", entry: "OEBPS/c1.xhtml" },
      { name: "bomb-200mb.epub", entry: "OEBPS/c1.xhtml", minBytes: 199 * 1024 * 1024, ms: 60000 },
      { name: "stored-3mb.epub", entry: "OEBPS/c1.xhtml", minBytes: 3 * 1024 * 1024, ms: 30000 },
      { name: "lie-up.epub", entry: "OEBPS/c1.xhtml", ms: 30000, declaredMin: 300 * 1024 * 1024 },
      { name: "lie-down.epub", entry: "OEBPS/c1.xhtml", ms: 30000, declaredMax: 4096 },
      { name: "entries-5000.epub", entry: "OEBPS/c1.xhtml", minEntries: 5000, ms: 30000 },
    ];
    for (const c of checks) {
      const r = spawnChild({ id: "zip-" + c.name, stage: "zipcheck", file: c.name, checkEntry: c.entry }, c.ms || 20000);
      const cd = readCd(fs.readFileSync(corpusPath(c.name))).find((e) => e.name === "OEBPS/" + c.entry || e.name === c.entry);
      const ratio = r.inBytes && r.outBytes ? (r.outBytes / r.inBytes).toFixed(1) : "?";
      flow.record("自检 " + c.name, `包 ${r.inBytes}B → 解压 ${r.outBytes}B（比 ${ratio}:1）· 中央目录声明 ${cd ? cd.usize : "?"}B · 条目数 ${r.entryCount ?? "-"} · ${Math.round(r.ms)}ms${r.error ? " · 错误[" + r.error.name + "]" + (r.error.msg || "").slice(0, 70) : ""}`);
      const honest = !c.declaredMin && !c.declaredMax;
      if (honest) {
        flow.check(`语料 ${c.name} 中央目录自洽（声明的解压体积 == 第三方解压器实测）`, r.outBytes != null && cd && cd.usize === r.outBytes, "声明 == 实测", `声明 ${cd ? cd.usize : "-"}B / 实测 ${r.outBytes}B${r.error ? " / " + r.error.name + " " + (r.error.msg || "").slice(0, 50) : ""}`);
      } else {
        flow.check(`语料 ${c.name} 的谎报能被解压器察觉（jszip 报错，而非按声明值静默走）`, Boolean(r.error), "解压器抛错", r.error ? r.error.name + " " + (r.error.msg || "").slice(0, 60) : `未报错，实测 ${r.outBytes}B`);
        if (c.declaredMin) flow.check(`语料 ${c.name} 声明值确实被抬到 ≥${(c.declaredMin / 1048576).toFixed(0)}MB（真实 1.3KB）`, cd && cd.usize >= c.declaredMin, "声明 ≥300MB", `声明 ${cd ? cd.usize : "-"}B`);
        if (c.declaredMax) flow.check(`语料 ${c.name} 声明值确实被压到 ≤${c.declaredMax}B（真实 3.8KB）`, cd && cd.usize <= c.declaredMax, "声明 ≤4KB", `声明 ${cd ? cd.usize : "-"}B`);
      }
      if (c.minBytes) flow.check(`语料 ${c.name} 是真炸弹：解压后 ≥${(c.minBytes / 1048576).toFixed(0)}MB`, r.outBytes >= c.minBytes, "≥" + c.minBytes, r.outBytes);
      if (c.minEntries) flow.check(`语料 ${c.name} 确有 ≥${c.minEntries} 条目`, r.entryCount >= c.minEntries, "≥5000", r.entryCount);
    }
    flow.record("目录撒谎条目的下游表现（jszip 层）", "见下一节应用侧：lie-up / lie-down 交给 parseEpubBytes 之后是报错还是少字");

    // =============== S2 EPUB：解压炸弹 / 目录谎言 / 条目数 ===============
    flow.section("S2 EPUB 导入面（parseEpubBytes = @likecoin/epub-ts + DOMPurify + turndown）：解压炸弹与中央目录撒谎");
    const EPUB_ITEMS = [
      { id: "epub-良性基线-3章", note: "对照", spec: { stage: "epub", file: "benign-typical.epub" }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "epub-良性大书-1p5MB", note: "对照：与炸弹同压缩包量级、正常解压比", spec: { stage: "epub", file: "benign-1p5mb.epub" }, budgetMs: BUD.epubMs, hardMs: 40000 },
      { id: "epub-低比对照-3MB-STORE", note: "对照：同样 3MB 正文但 1:1 存储，切分「内容本身贵」与「炸弹」", spec: { stage: "epub", file: "stored-3mb.epub" }, budgetMs: BUD.epubMs, hardMs: 30000 },
      { id: "epub-解压炸弹-200MB", note: "敌意：包 ~数百KB → 解压 200MB", spec: { stage: "epub", file: "bomb-200mb.epub" }, budgetMs: BUD.epubMs, hardMs: 20000, bound: true },
      { id: "epub-五千条目", note: "敌意：4997 条与书无关的目录项", spec: { stage: "epub", file: "entries-5000.epub" }, budgetMs: BUD.epubMs, hardMs: 30000 },
      { id: "epub-目录谎称-400MB", note: "敌意：中央目录声明 400MB，真实 1.3KB", spec: { stage: "epub", file: "lie-up.epub" }, budgetMs: BUD.epubMs, hardMs: 30000 },
      { id: "epub-目录谎称-12B", note: "敌意：声明 12B，真实 3.8KB —— 静默截断探针", spec: { stage: "epub", file: "lie-down.epub" }, budgetMs: BUD.epubMs, hardMs: 30000, truncation: true },
      { id: "epub-重名条目", note: "敌意：两条 OEBPS/c1.xhtml，第一条正版第二条劫持", spec: { stage: "epub", file: "dupnames.epub" }, budgetMs: BUD.smallMs, hardMs: 20000, determinism: true },
      { id: "epub-穿越条目", note: "敌意：spine href = ../../../f40-escape.xhtml", spec: { stage: "epub", file: "zipslip.epub" }, budgetMs: BUD.smallMs, hardMs: 20000, zipslip: true },
    ];
    const epubRes = {};
    for (const item of (want("epub") ? EPUB_ITEMS : [])) {
      prepItem(item);
      const r = timedChild(item, item.reps || REPS);
      epubRes[item.id] = r;
      RESULTS[item.id] = r;
      judge(item, r);
      flow.record(item.id + " 解析摘要", `title=${JSON.stringify(r.title || "")} via=${r.via || "epub"} toc=${r.meta && r.meta.toc != null ? r.meta.toc : "-"} 章=产物 ${r.outChars}ch/${r.outLines}行`);
      if (item.bound) {
        const ratio = r.outBytes != null && r.inBytes ? r.outBytes / r.inBytes : null;
        flow.check(`${item.id} B3 必须存在显式上限：解压比 ≤${BUD.maxRatio}:1，或抛错拒绝`, Boolean(r.appRejected) || (ratio != null && ratio <= BUD.maxRatio), "拒绝或 ≤100:1", r.appRejected ? "应用主动拒绝（见错误名）" : r.timedOut ? "未取得产物：子进程被硬超时杀掉（= 用户看到的无响应）" : ratio == null ? "无产物、也无拒绝：" + (r.error ? r.error.name : "导入成功") : `解压比 ${ratio.toFixed(0)}:1 且导入成功`);
      }
      if (item.truncation) {
        const full = /远大于声明长度/.test(String(r.head || "")) || (r.outChars || 0) > 100;
        flow.check(`${item.id} B4 目录谎报必须「响」：要么拒绝要么产物完整，禁止少字却成功`, Boolean(r.appRejected) || full, "拒绝 或 产物含全文", r.appRejected ? "已拒绝 " + r.error.name : `无错误、产物 ${r.outChars}ch（正版该有 ~3800ch）· head=${r.head}`);
        flow.check(`${item.id} B4 同包内正常章（c2）内容不得被连坐丢失`, String(r.tail || "").includes("第") || (r.outChars || 0) > 200, "第二章正文仍在", `tail=${r.tail} 总 ${r.outChars}ch`);
      }
      if (item.determinism) {
        flow.record(`${item.id} 同名条目谁赢`, (r.outChars || 0) + "ch · head=" + r.head);
        const again = spawnChild(item.spec, item.hardMs || 20000);
        flow.check(`${item.id} 同名条目结果必须确定（两次一致）`, again.outChars === r.outChars, r.outChars, again.outChars);
      }
      if (item.zipslip) {
        const escapes = [path.join(ROOT, "f40-escape.xhtml"), path.join(app.getPath("userData"), "f40-escape.xhtml"), path.join(os.tmpdir(), "f40-escape.xhtml")].filter((p) => fs.existsSync(p));
        flow.check(`${item.id} 穿越条目不得在数据目录外落文件`, escapes.length === 0, "零落盘", escapes.join(" "));
      }
    }
    // 差分：炸弹 vs 同压缩包量级的良性书 vs 同解压体积的低比对照
    {
      const bomb = epubRes["epub-解压炸弹-200MB"], benign = epubRes["epub-良性大书-1p5MB"], stored = epubRes["epub-低比对照-3MB-STORE"];
      const perMB = (r) => (r && r.outBytes ? (r.ms / Math.max(1, r.outBytes / 1048576)) : null);
      flow.record("差分（每 MB 产物的耗时）", `炸弹 ${perMB(bomb) == null ? "无产物（" + (bomb && bomb.timedOut ? "硬超时" : bomb && bomb.error ? bomb.error.name : "?") + "）" : perMB(bomb).toFixed(0) + "ms/MB"} · 1.5MB 良性 ${perMB(benign) == null ? "-" : perMB(benign).toFixed(0) + "ms/MB"} · 3MB 低比 ${perMB(stored) == null ? "-" : perMB(stored).toFixed(0) + "ms/MB"}`);
      flow.record("差分（绝对耗时）", `炸弹 ≥${bomb ? bomb.ms : "-"}ms · 良性 1.5MB ${benign ? benign.ms : "-"}ms · 低比 3MB ${stored ? stored.ms : "-"}ms · 各自 calib ${bomb ? bomb.calibMs : "-"}/${benign ? benign.calibMs : "-"}/${stored ? stored.calibMs : "-"}ms（同一量级 = 同一机器负载，长跑并发抢 CPU 时该值一起抬高）`);
    }

    // =============== S3 递归嵌套：Readability / DOMPurify / turndown 都在这条路上递归 ===============
    flow.section("S3 递归深度：5 万层 div / 2 万层 blockquote / 实体海（DOMParser→Readability→DOMPurify→turndown）");
    const HTML_ITEMS = [
      { id: "html-平铺对照-9k个p", note: "对照：与嵌套项等字节", spec: { stage: "html", gen: "html-flat-p-9k" }, scale: true, hardMs: 30000 },
      { id: "html-等长对照-纯文本", note: "对照：与实体海等长", spec: { stage: "html", gen: "html-plain-350k" }, scale: true, hardMs: 30000 },
      { id: "html-嵌套-5万层div", note: "敌意", spec: { stage: "html", gen: "html-nest-div-50k" }, scale: true, hardMs: 30000 },
      { id: "html-嵌套-5万层span", note: "敌意：更深一层的等字节变体", spec: { stage: "html", gen: "html-nest-span-50k" }, scale: true, hardMs: 30000 },
      { id: "html-嵌套-2万层blockquote", note: "敌意", spec: { stage: "html", gen: "html-nest-bq-20k" }, scale: true, hardMs: 30000 },
      { id: "html-实体海-5万个times", note: "敌意：字符爆炸（解析后 5 万字符）", spec: { stage: "html", gen: "html-entity-50k" }, scale: true, hardMs: 30000 },
      { id: "html-半个实体-4万个", note: "敌意：&amp 不加分号，解析器逐字符找分号", spec: { stage: "html", gen: "html-entity-half-open" }, scale: true, hardMs: 30000 },
      { id: "html-空白坍缩-8万个空格", note: "敌意：turndown 的 \\s+ 正则", spec: { stage: "html", gen: "html-ws-collapse-80k" }, scale: true, hardMs: 30000 },
    ];
    const htmlRes = {};
    for (const item of (want("html") ? HTML_ITEMS : [])) {
      prepItem(item);
      const r = timedChild(item, item.reps || REPS);
      htmlRes[item.id] = r;
      RESULTS[item.id] = r;
      judge(item, r);
      if (!r.error) {
        flow.check(`${item.id} B4 正文不得静默消失（解析成功就必须带出可读正文）`, (r.outChars || 0) > 20 && /正文|句子里|一个词|填 充|×/.test(String(r.head) + String(r.tail)), "产物含正文", `out=${r.outChars}ch via=${r.via} head=${r.head}`);
      }
      flow.record(item.id + " 结构", `via=${r.via || "-"} title=${JSON.stringify(String(r.title || "").slice(0, 24))} 产物 ${r.outChars}ch（输入 ${r.inBytes}B）`);
    }
    if (want("html")) {
      const nest = htmlRes["html-嵌套-5万层div"], flat = htmlRes["html-平铺对照-9k个p"];
      flow.record("差分（嵌套 vs 平铺，等字节输入）", `嵌套 ${nest ? nest.ms : "-"}ms/rssΔ${nest ? nest.rssDeltaMB : "-"}MB/${nest && nest.error ? nest.error.name : "ok"} vs 平铺 ${flat ? flat.ms : "-"}ms/rssΔ${flat ? flat.rssDeltaMB : "-"}MB/${flat && flat.error ? flat.error.name : "ok"} · calib ${nest ? nest.calibMs : "-"}/${flat ? flat.calibMs : "-"}`);
    }

    // =============== S4 markdown：递归 + ReDoS + KaTeX，整条「导入到能读」链 ===============
    flow.section("S4 文档入口链（markdownFromText / mammoth / pdfjs → splitMarkdownChapters → markdown-it + KaTeX → 合成 EPUB）：递归、二次方、产物爆炸");
    const MD_ITEMS = [
      { id: "md-良性8章", note: "对照", spec: { stage: "md", gen: "benign-doc", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-良性一层引用1万", note: "对照：与嵌套引用同条目数", spec: { stage: "md", gen: "benign-quotes-10k", chain: true }, budgetMs: BUD.bigMs, hardMs: 30000 },
      { id: "md-良性正常公式100", note: "对照：与公式爆炸同类", spec: { stage: "md", gen: "benign-math-100", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-嵌套引用-1万层", note: "敌意", spec: { stage: "md", gen: "md-quote-10k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-嵌套引用-2万层", note: "敌意：深度翻倍，看是线性还是超线性", spec: { stage: "md", gen: "md-quote-20k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-嵌套列表-1万层", note: "敌意", spec: { stage: "md", gen: "md-list-10k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-强调星号-5万连打", note: "敌意", spec: { stage: "md", gen: "md-em-50k", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-链接汤-2万个", note: "敌意", spec: { stage: "md", gen: "md-link-soup", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-引用式链接-2千", note: "敌意：14 个链接状态 × N", spec: { stage: "md", gen: "md-reflinks-2k", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-管道表-2000列", note: "敌意", spec: { stage: "md", gen: "md-table-2000", chain: true }, scale: true, hardMs: 30000 },
      { id: "md-管道表-200列", note: "对照：列数 1/10", spec: { stage: "md", gen: "benign-table-200", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-单行1MB", note: "敌意：无空格单行长句", spec: { stage: "md", gen: "md-one-line-1mb", chain: true }, scale: true, hardMs: 30000 },
      { id: "md-多行1MB", note: "对照：等字节正常换行", spec: { stage: "md", gen: "benign-1mb-multiline", chain: true }, scale: true, hardMs: 30000 },
      { id: "md-未闭合围栏-1MB", note: "敌意：整篇被当代码", spec: { stage: "md", gen: "md-fence-unclosed", chain: true }, scale: true, hardMs: 30000 },
      { id: "md-美元符号-1万个不闭合", note: "敌意：正则路径", spec: { stage: "md", gen: "md-dollar-10k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-合法公式对-5千", note: "敌意：产物爆炸（每个公式一份 KaTeX HTML）", spec: { stage: "md", gen: "md-math-pairs-5k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-KaTeX花括号-1万层", note: "敌意：throwOnError:false 挡不住 RangeError", spec: { stage: "md", gen: "md-katex-brace-10k", chain: true, countMarkers: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-KaTeX花括号-3千层", note: "敌意：深度 1/3，看是否栈深悬崖", spec: { stage: "md", gen: "md-katex-brace-3k", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-KaTeX-frac-2万个", note: "敌意", spec: { stage: "md", gen: "md-katex-frac-20k", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-KaTeX-嵌套frac-4千", note: "敌意", spec: { stage: "md", gen: "md-katex-nested-frac", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "md-公式与强调混炸", note: "敌意", spec: { stage: "md", gen: "md-mix-math-em", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "txt-嵌套引用-1万层", note: "敌意：TXT 入口的同一份载荷", spec: { stage: "txt", gen: "md-quote-10k", chain: true }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "docx-嵌套表-200层", note: "敌意：表格套表格 200 层（mammoth 递归）", spec: { stage: "word", file: "docx-nested-200.docx" }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "docx-平铺表-200张", note: "对照：同样 200 张表但不嵌套", spec: { stage: "word", file: "docx-flat-200.docx" }, budgetMs: BUD.smallMs, hardMs: 20000 },
      { id: "pdf-1500页", note: "敌意：页数把 pdfToMarkdown 的逐页循环拉满", spec: { stage: "pdf", file: "pdf-1500p.pdf" }, budgetMs: BUD.epubMs, hardMs: 40000 },
      { id: "pdf-150页", note: "对照：页数 1/10", spec: { stage: "pdf", file: "pdf-150p.pdf" }, budgetMs: BUD.smallMs, hardMs: 20000 },
    ];
    for (const item of (want("md") ? MD_ITEMS : [])) {
      prepItem(item);
      const r = timedChild(item, item.reps || REPS);
      RESULTS[item.id] = r;
      judge(item, r);
      if (item.spec.countMarkers) {
        flow.check(`${item.id} B3 产物标记 ≤ ${BUD.maxMarkers}（输入 ${r.inBytes}B → HTML ${r.htmlChars || "-"}ch / ${r.markers || "-"} 个标记 / 合成 ${r.synthBytes || "-"}B）`, (r.markers == null || r.markers <= BUD.maxMarkers) && (r.synthBytes == null || r.synthBytes <= 8 * 1024 * 1024), "≤50000 标记且合成书 ≤8MB", `markers=${r.markers} htmlChars=${r.htmlChars} synthBytes=${r.synthBytes} chapters=${r.chapters}`);
      }
      flow.record(item.id + " 分段耗时", `markdownFromText ${r.parseMs}ms → 渲染 ${r.renderMs == null ? "-" : r.renderMs}ms → 合成 ${r.synthMs == null ? "-" : r.synthMs}ms（${r.chapters == null ? "-" : r.chapters} 章 / ${r.synthBytes == null ? "-" : r.synthBytes}B）· 清洗后 ${r.outChars}ch`);
      if (item.spec.gen && /katex|math|dollar|mix/.test(item.spec.gen)) {
        flow.check(`${item.id} B4 公式炸弹不得让整本书打不开（合成段不得抛未捕获错误）`, !(r.error && r.error.stage2), "合成段无未捕获错误", r.error ? `[${r.error.name}]${r.error.stage2 ? "(合成段)" : ""} ${r.error.msg}` : `产物 ${r.outChars}ch → 合成 ${r.synthBytes}B/${r.chapters}章`);
      }
    }
    if (want("md")) {
      const q1 = mdResOf("md-嵌套引用-1万层"), q2 = mdResOf("md-嵌套引用-2万层"), flat = mdResOf("md-良性一层引用1万");
      flow.record("差分（markdown-it 嵌套引用 1万 vs 2万 vs 平铺1万）", `1万=${q1.ms}ms/${q1.error ? q1.error.name : "ok"} · 2万=${q2.ms}ms/${q2.error ? q2.error.name : "ok"} · 平铺=${flat.ms}ms/${flat.error ? flat.error.name : "ok"} · calib ${q1.calibMs}/${q2.calibMs}/${flat.calibMs}`);
      flow.record("深度加倍的耗时倍率（>2.5 即超线性 = 有二次方项）", q1.ms > 0 ? (q2.ms / q1.ms).toFixed(2) + "×" : "-");
    }

    // =============== S5 落库与「此后每次写库的价」 ===============
    flow.section("S5 落库段（createImportedDoc + sql.js 全量回写）：敌意正文进了唯一真源之后，每次写都要付的价");
    const DB_ITEMS = [
      { id: "db-良性8章", note: "对照", gen: "benign-doc", budgetMs: 2000 },
      { id: "db-良性1MB多行", note: "对照：与单行项等字节", gen: "benign-1mb-multiline", budgetMs: 4000 },
      { id: "db-1MB单行", note: "敌意：无空格单行 50 万字", gen: "md-one-line-1mb", budgetMs: 4000 },
      { id: "db-6MB单行", note: "敌意：解压炸弹的「入库后」替身（200MB 太大不入库，量这一段代替）", gen: "md-one-line-4mb", budgetMs: BUD.docMs, reps: 2 },
      { id: "db-NUL正文", note: "敌意：正文里 U+0000", gen: "uni-nul-in-markdown", budgetMs: 2000, nulBody: true },
      { id: "db-孤立半代理", note: "敌意：正文里 \\\\uD800 / \\\\uDC00", gen: "uni-surrogate-half", budgetMs: 2000 },
      { id: "db-行段分隔符", note: "敌意：U+2028/U+2029 会被 JSON 序列化写进 blocks_json", gen: "uni-2028-2029", budgetMs: 2000 },
      { id: "db-组合符串", note: "敌意：100 个组合符 × 100 组", gen: "uni-combining-100x", budgetMs: 2000 },
      { id: "db-ZWJ家庭emoji", note: "敌意：4 个码位 1 个字素簇 × 2000", gen: "uni-zwj-2000", budgetMs: 2000 },
      { id: "db-200位数字", note: "敌意：纯数字长串", gen: "num-200digit", budgetMs: 2000 },
      { id: "db-JSON极端token", note: "敌意：正文里躺 1e309/-0/NaN 字面量", gen: "num-json-tokens", budgetMs: 2000 },
      { id: "db-RTL覆盖标题", note: "敌意：书名里的 U+202E（视觉伪装）", gen: "benign-doc", title: "白皮书" + RLO + ".pdf", budgetMs: 2000, rloTitle: true },
      { id: "db-半代理标题", note: "敌意：书名里的孤立半代理", gen: "benign-doc", title: "书" + hi + "名", budgetMs: 2000 },
      { id: "db-2028标题", note: "敌意：书名里的 U+2028", gen: "benign-doc", title: "书名" + LSEP + "换行", budgetMs: 2000 },
      { id: "db-NUL文件名", note: "敌意：originalName 里塞 U+0000 与穿越路径", gen: "benign-doc", originalName: "evil" + NUL + "../../outside.md", budgetMs: 2000, nulName: true },
    ];
    for (const item of (want("uni") ? DB_ITEMS : [])) {
      const runs = [];
      for (let i = 0; i < (item.reps || (item.gen && /4mb|1mb/.test(item.gen) ? 2 : 3)); i++) runs.push(await runDbCase(item));
      const best = runs.reduce((a, b) => (a.ms < b.ms ? a : b));
      const worst = runs.reduce((a, b) => (a.rssDeltaMB > b.rssDeltaMB ? a : b));
      best.worstRssDeltaMB = worst.rssDeltaMB;
      judgeDb(item, best);
      flow.record(item.id + " 写放大", `库文件 ${best.dbBytes}B（输入 ${best.inBytes}B）· 一次极短写入耗时 ${best.tinyWriteMs == null ? "-" : best.tinyWriteMs.toFixed(0)}ms · 文档行数 ${best.docCount}/${best.itemCount}`);
      if (item.nulBody) {
        flow.check(`${item.id} B4 正文里的 U+0000 不得让后半段凭空消失`, (best.storedChars || 0) === cleanLen(item), "库内字符数 == 输入字符数", `库内 ${best.storedChars}ch vs 输入 ${cleanLen(item)}ch · 保真 ${best.fidelity}`);
      }
      if (item.rloTitle) {
        flow.check(`${item.id} 书名里的 U+202E 必须被中和或标注（书架上「白皮书.pdf」会显示成「gpj.exe 白皮书」式伪装）`, !String(best.titleStored || "").includes(RLO), "不含 U+202E", JSON.stringify(best.titleStored));
        flow.record(item.id + " 观察", "落库保真 " + best.titleFidelity + "：说明主进程对书名只做 trim，方向覆盖符原样入库（与 txtToMarkdown 清 200B/200E/200F 的口径不一致）");
      }
      if (item.nulName) {
        flow.check(`${item.id} 文件名里的 U+0000 与 ../ 必须被净化后落盘`, (best.assets || []).length === 1 && !String(best.assets[0]).includes(NUL) && !String(best.assets[0]).includes(".."), "净化后的单文件名", JSON.stringify(best.assets));
      }
    }
    // NFC / NFD 同形书名：去重键会不会把两本书当一本
    if (want("uni")) {
      const env = await bootFlowDb("f40-nfc" + ++dbSeq);
      DB_DIRS.push(env.dir);
      const nfc = "報告 標題 文件";
      const nfd = nfc.normalize("NFD");
      const a = env.db.createImportedDoc({ title: nfc, markdown: genMd("benign-doc"), sourceType: "markdown", sourceName: "nfc.md", originalName: "nfc.md", originalBuf: Buffer.from("nfc"), images: [] });
      const b = env.db.createImportedDoc({ title: nfd, markdown: genMd("benign-doc"), sourceType: "markdown", sourceName: "nfd.md", originalName: "nfd.md", originalBuf: Buffer.from("nfd"), images: [] });
      const list = env.db.listItems().map((x) => x.title);
      flow.check("NFC/NFD 两种写法应视为同一书名（要么判重、要么明确是两本）", nfc !== nfd && list.length === 2, "两条独立书目 + 记录口径", `库里 ${list.length} 条；两 id ${a.id === b.id ? "相同（会互相覆盖）" : "不同"}`);
      flow.record("NFC/NFD 双书", `字符串相等？${nfc === nfd} · 长度 ${nfc.length}/${nfd.length} · 排序键相同？${nfc.localeCompare(nfd) === 0} → 书架上两本同名同形的书（去重/检索键由上层决定）`);
      const aud = await audit(env.dbFile);
      flow.check("NFC/NFD 两本书的正文与归属都完整（没有互相吞并）", aud.count("documents") === 2 && aud.count("library_items") === 2, "2/2", `${aud.count("documents")}/${aud.count("library_items")}`);
      aud.close();
      try { fs.rmSync(env.dir, { recursive: true, force: true }); } catch { /* 句柄 */ }
    }

    // =============== S6 上限普查与量级台账 ===============
    flow.section("S6 上限普查：导入面到底有没有人写过「体积/深度/条目数」的闸（源码静态面 + 上面的动态证据）");
    const caps = capsAudit();
    flow.record("全仓导入相关的大写上量常量", caps.join("  ·  ") || "（一个都没有）");
    const textCaps = caps.filter((c) => /TEXT|BYTES|CHAR|SIZE|DOC|MARKDOWN|DEPTH|ENTR/i.test(c));
    flow.check("正文侧存在显式的字节/字符上限（当前只有图片 10MB 一道闸）", textCaps.length > 0, "至少一条正文上限", textCaps.length ? textCaps.join(" ") : "只有 MAX_WORD_IMAGES_TOTAL_BYTES（图片），正文/解压体积/嵌套深度零上限");
    flow.check("解压侧存在体积上限（压缩包→解压后）", caps.some((c) => /UNZIP|INFLAT|ZIP|EPUB/i.test(c)), true, caps.filter((c) => /UNZIP|INFLAT|ZIP|EPUB/i.test(c)).join(" ") || "无");
    flow.check("HTML/EPUB 侧存在嵌套深度上限", caps.some((c) => /DEPTH|NEST/i.test(c)), true, caps.filter((c) => /DEPTH|NEST/i.test(c)).join(" ") || "无");
    {
      const bomb = RESULTS["epub-解压炸弹-200MB"] || {};
      const benign = RESULTS["epub-良性大书-1p5MB"] || {};
      flow.record("头条量级（炸弹 vs 良性）", `包 ${bomb.inBytes}B 的输入：良性 ${benign.inBytes}B→${benign.ms}ms；炸弹 ≥${bomb.ms}ms 仍未跑完（被父进程 ${bomb.ms}ms 硬顶杀掉），期间 rssΔ ${bomb.rssDeltaMB}MB`);
    }
    console.log("\n  ---- 量级台账（best-of-N · 单位 ms / MB / 字符） ----");
    for (const L of LEDGER) {
      console.log(`   ${String(L.id).padEnd(34)} 预算${String(L.budgetMs).padStart(6)} · 实测 ${String(L.ms).padStart(6)} · rssΔ ${String(L.rssMB == null ? "-" : L.rssMB).padStart(6)}MB · 产物 ${String(L.outChars == null ? L.outBytes : L.outChars).padStart(9)} · 膨胀 ${String(L.ratio).padStart(6)} · calib ${L.calib}ms · ${L.err ? "错误[" + L.err + "]" : "ok"}`);
    }
    flow.check("全部敌意项都在自己的硬顶内交付了结果（没有一项把子进程跑到无响应）", LEDGER.filter((L) => L.timedOut || L.err === "进程级崩溃（未交付结果）").length === 0, "零挂死", LEDGER.filter((L) => L.timedOut || L.err === "进程级崩溃（未交付结果）").map((L) => L.id + "(" + L.err + ")").join(" "));
    flow.record("超预算项数 / 总项数", LEDGER.filter((L) => L.ms > L.budgetMs).length + "/" + LEDGER.length + " → " + (LEDGER.filter((L) => L.ms > L.budgetMs).map((L) => L.id).join(" ") || "（无）"));
  });

  cleanup();
  quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
}

/** 收尾：megabyte 级产物一律删（仓内不留 >1MB 的生成物），bundle 缓存与子进程临时目录全清 */
function cleanup() {
  if (process.env.F40_KEEP) { console.log("F40_KEEP=1：保留语料与 bundle 缓存"); return; }
  let removed = 0;
  try {
    for (const dir of [CACHE_DIR]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) { try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); removed++; } catch { /* 句柄未放 */ } }
      try { fs.rmdirSync(dir); } catch { /* 非空 */ }
    }
    if (fs.existsSync(CORPUS_DIR)) {
      for (const f of fs.readdirSync(CORPUS_DIR)) {
        const p = path.join(CORPUS_DIR, f);
        try { if (fs.statSync(p).size > 1024 * 1024) { fs.rmSync(p, { force: true }); removed++; } } catch { /* 无 */ }
      }
    }
    for (const d of DB_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 句柄 */ } }
    try { fs.rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* 无 */ }
  } catch { /* 尽力 */ }
  console.log("F40 收尾：清掉 " + removed + " 个 megabyte 级/缓存产物（corpus 里 ≤1MB 的小语料保留，重跑即重建）");
}

// ==================================================================
// 9. 入口分叉（放在所有声明之后）
// ==================================================================
if (process.env.F40_CHILD) {
  childEntry().catch((e) => {
    try { fs.writeFileSync(process.env.F40_OUT, JSON.stringify({ fatal: String((e && e.stack) || e) })); } catch { /* 尽力 */ }
    process.exit(9);
  });
} else {
  parentEntry().catch((e) => {
    console.log("F40 顶层异常：" + (e && e.stack ? e.stack : e));
    try { cleanup(); } catch { /* 尽力 */ }
    process.exit(1);
  });
}






