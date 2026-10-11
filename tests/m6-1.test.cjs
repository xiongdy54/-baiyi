// M6-1（v26）导入格式扩展测试：Word(含内嵌图) / TXT 编码 / Markdown + 合成 EPUB 图片能力与确定性
// 运行：node tests/m6-1.test.cjs（node 直跑；epub.ts 每次运行前 esbuild 重打包，?raw CSS 以插件处理）
// 规格：AI_DEVELOPMENT_GUIDE.md §9.1 M6-1；改动 src/lib/epub.ts 或 electron/importers.js 后须保证本套件全绿
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ " + name); }
}
function section(name) { console.log(`== ${name} ==`); }

// ---------- epub.ts 打包（?raw 插件：katex/dist/katex.min.css?raw；buildSync 不支持插件 → 异步 API） ----------
const bundleOut = path.join(__dirname, "m6-1.epub.bundle.cjs");
async function buildEpubBundle() {
  await require("esbuild").build({
    entryPoints: [path.join(__dirname, "..", "src", "lib", "epub.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: bundleOut,
    logLevel: "silent",
    plugins: [{
      name: "raw-css",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => {
          const clean = args.path.replace(/\?raw$/, "");
          // 裸包名 → 工作区 node_modules（测试里唯一 ?raw 引用即 katex.min.css）
          const abs = path.isAbsolute(clean) ? clean : path.join(__dirname, "..", "node_modules", clean);
          return { path: abs, namespace: "raw-file" };
        });
        build.onLoad({ filter: /.*/, namespace: "raw-file" }, async (args) => ({
          contents: await fs.promises.readFile(args.path),
          loader: "text"
        }));
      }
    }]
  });
}
const importers = require("../electron/importers.js");
const JSZip = require("jszip");

// ---------- 夹具：确定性 PNG 与最小 docx ----------
function tinyPng(r, g, b) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const byte of body) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, r, g, b]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
}

const PNG_A = tinyPng(255, 0, 0);
const PNG_B = tinyPng(0, 0, 255);

function docxDocumentXml(extraImages = []) {
  const drawings = extraImages.map((im, i) => `
<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="${i + 1}" name="pic${i}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="pic${i}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${i}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 起源</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗结论</w:t></w:r><w:r><w:t>，正文段落。</w:t></w:r></w:p>${drawings}
<w:p><w:r><w:t>表格测试</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>词</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>义</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>book</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>书</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/>
</w:body></w:document>`;
}

async function buildDocx(images) {
  // images: [{ name, buf, contentType }]
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${images.map((im) => `<Default Extension="${im.name.split(".").pop()}" ContentType="${im.contentType}"/>`).join("\n")}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", docxDocumentXml(images.map((im, i) => ({ i, name: im.name }))));
  images.forEach((im) => zip.file(`word/media/${im.name}`, im.buf));
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${images.map((im, i) => `<Relationship Id="rIdImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`).join("\n")}
</Relationships>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await buildEpubBundle();
  const epub = require("./m6-1.epub.bundle.cjs");

  // ---------- M6-1-1 Word 导入（含内嵌图） ----------
  section("M6-1-1 Word 导入（含内嵌图 / 表格 / 编码守卫）");
  const docxBuf = await buildDocx([
    { name: "imageA.png", buf: PNG_A, contentType: "image/png" },
    { name: "imageB.png", buf: PNG_B, contentType: "image/png" }
  ]);
  const w1 = await importers.wordToMarkdown(docxBuf);
  ok(w1.markdown.includes("# 第一章 起源"), "Word：一级标题转 ATX（# ）供合成管线章节化");
  ok(w1.markdown.includes("**加粗结论**"), "Word：加粗转 ** **");
  ok(w1.markdown.includes("| 词 | 义 |") && w1.markdown.includes("| --- | --- |") && w1.markdown.includes("| book | 书 |"), "Word：表格转 GFM 管道表");
  ok(w1.markdown.includes("![](img-0.png)") && w1.markdown.includes("![](img-1.png)"), "Word：内嵌图按出现序确定性命名 img-0/img-1");
  ok(w1.images.length === 2, "Word：提取出 2 张图");
  ok(w1.images[0].filename === "img-0.png" && w1.images[0].mediaType === "image/png", "Word：图片文件名与 mediaType 正确");
  ok(Buffer.compare(Buffer.from(w1.images[0].bytes), PNG_A) === 0 && Buffer.compare(Buffer.from(w1.images[1].bytes), PNG_B) === 0, "Word：图片字节与原 docx 内字节一致");
  ok(w1.images.every((im) => im.bytes.length <= importers.MAX_WORD_IMAGES_TOTAL_BYTES), "Word：图片尺寸守卫字段在场");

  const w2 = await importers.wordToMarkdown(await buildDocx([
    { name: "meta.emf", buf: Buffer.from([1, 2, 3, 4]), contentType: "image/x-emf" },
    { name: "imageA.png", buf: PNG_A, contentType: "image/png" }
  ]));
  ok(w2.images.length === 1 && w2.images[0].filename === "img-0.png", "Word：不可渲染格式（EMF）跳过且不打乱序号");
  ok(!/\!\[\]\(\)/.test(w2.markdown) && !/<img\b/.test(w2.markdown), "Word：被跳过的图不留空引用");

  const bigBuf = Buffer.alloc(11 * 1024 * 1024, 7);
  let threwSize = false;
  try {
    await importers.wordToMarkdown(await buildDocx([{ name: "big.png", buf: bigBuf, contentType: "image/png" }]));
  } catch (e) {
    threwSize = /10MB/.test(String(e.message));
  }
  ok(threwSize, "Word：单书图片总量超 10MB 抛错中止");

  // ---------- M6-1-2 TXT / Markdown（编码检测 + 归一化） ----------
  section("M6-1-2 TXT / Markdown（编码检测 + 归一化）");
  const d1 = importers.decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好\n世界", "utf8")]));
  ok(d1.encoding === "utf-8-sig" && d1.text === "你好\n世界", "编码：UTF-8 BOM 识别并剥离");
  const d2 = importers.decodeTextBytes(Buffer.from("你好", "utf8"));
  ok(d2.encoding === "utf-8" && d2.text === "你好", "编码：无 BOM 合法 UTF-8 直解");
  const d3 = importers.decodeTextBytes(Buffer.from([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]));
  ok(d3.encoding === "utf-16le" && d3.text === "你好", "编码：UTF-16 LE BOM");
  const d4 = importers.decodeTextBytes(Buffer.from([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]));
  ok(d4.encoding === "utf-16be" && d4.text === "你好", "编码：UTF-16 BE BOM");
  const d5 = importers.decodeTextBytes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0xc4, 0xe3, 0xba, 0xc3]));
  ok(d5.encoding === "gbk" && d5.text === "中文,你好", "编码：无 BOM 非 UTF-8 回退 GBK（中文网文刚需）");
  const d6 = importers.decodeTextBytes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
  ok(d6.encoding === "gbk" && d6.text === "中文", "编码：严格 UTF-8 失败进 GBK 而非乱码");

  const t1 = importers.txtToMarkdown("第一段第一行\r\n\r\n第二段\r\n还是第二段\r\n");
  ok(t1 === "第一段第一行\n\n第二段\n\n还是第二段", "TXT：CRLF 归一 + 空行分段 + 每非空行成段");
  const t2 = importers.txtToMarkdown("# 手写标题\n\n正文行");
  ok(t2.includes("# 手写标题"), "TXT：原文本含 markdown 标记则原样保留（合成管线自然章节化）");
  const t3 = importers.txtToMarkdown("a\n\n\n\nb");
  ok(t3 === "a\n\nb", "TXT：连续空行收敛");
  const m1 = importers.markdownFromText("# 标题\r\n\r\n正文$E=mc^2$\r\n");
  ok(m1 === "# 标题\n\n正文$E=mc^2$", "MD：仅归一行尾，语法直通");
  ok(importers.titleFromFilename("三体 Ⅰ：面壁者.txt") === "三体 Ⅰ：面壁者", "文件名→书名：去扩展名");
  ok(importers.titleFromFilename("notes") === "notes", "文件名→书名：无扩展名原样");

  // ---------- v29 Markdown 噪音清洗（微信网页存档类） ----------
  section("v29 Markdown 噪音清理（微信网页存档类 .md）");
  const wechatMd = [
    "# 只要跑不死、就往死里跑",
    "<style>",
    "* { margin: 0; padding: 0; }",
    "body { font-family: 'PingFang SC'; }",
    "</style>",
    "",
    "正文第一段，讲绩效主义。",
    "",
    "![](data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E) 赞",
    "![](data:image/png;base64,AAAA) 分享"
  ].join("\n");
  const cleaned = importers.markdownFromText(wechatMd);
  ok(!cleaned.includes("<style>") && !cleaned.includes("margin: 0"), "清洗：style 块整体剔除");
  ok(!cleaned.includes("data:image"), "清洗：data-URI 图标行剔除");
  ok(cleaned.includes("# 只要跑不死、就往死里跑") && cleaned.includes("正文第一段"), "清洗：正文完整保留");
  ok(!cleaned.includes("script"), "清洗：script 块同样剔除（大小写不敏感）");
  const scriptMd = importers.markdownFromText("正文前<SCRIPT>var x=1;</SCRIPT>正文后");
  ok(scriptMd === "正文前正文后", "清洗：script 块（大写）剔除且不误伤正文");
  ok(importers.markdownFromText("普通段落 a\n\n普通段落 b").includes("data:") === false, "清洗：普通内容不受影响");

  // ---------- M6-1-3 合成 EPUB 图片能力（syn-3） ----------
  section("M6-1-3 合成 EPUB 图片能力（syn-3）");
  ok(epub.SYNTH_GENERATOR_VERSION === "syn-3", "syn 版本：syn-3（空首章清理，结构变更纪律 §7.1.11）");

  const mdPlain = "# 第一章\n\n正文段落，没有图片。";
  const s1 = await epub.buildSyntheticEpub("无图书", mdPlain);
  const s1b = await epub.buildSyntheticEpub("无图书", mdPlain);
  ok(Buffer.compare(s1.bytes, s1b.bytes) === 0, "合成：无图两次合成字节级一致（确定性纪律）");
  const z1 = await JSZip.loadAsync(s1.bytes);
  const opf1 = await z1.file("OEBPS/content.opf").async("string");
  ok(!opf1.includes('media-type="image/'), "合成：无图时 manifest 无图片条目（与 syn-1 结构同构）");
  ok(!z1.file("OEBPS/images/img-0.png"), "合成：无图时无 OEBPS/images/ 条目");

  // djb2 复刻（与 epub.ts stableHash 恒等）：无图 identifier 输入 = title + NUL + markdown
  function djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  ok(opf1.includes(`urn:uuid:synthetic-${djb2("无图书\u0000" + mdPlain)}`), "合成：无图 identifier 算法与 syn-1 恒等（syn-3 不改 identifier 输入）");

  const mdImgs = "# 第一章\n\n看图：![说明](img-0.png)\n\n# 第二章\n\n再看：![](img-1.png)";
  const imgA = new Uint8Array(PNG_A);
  const imgB = new Uint8Array(PNG_B);
  const s2 = await epub.buildSyntheticEpub("带图书", mdImgs, { images: [
    { filename: "img-0.png", bytes: imgA, mediaType: "image/png" },
    { filename: "img-1.png", bytes: imgB, mediaType: "image/png" }
  ] });
  const z2 = await JSZip.loadAsync(s2.bytes);
  const opf2 = await z2.file("OEBPS/content.opf").async("string");
  ok(opf2.includes('<item id="img0" href="images/img-0.png" media-type="image/png"/>'), "合成：manifest 图片条目（href=images/… media-type 正确）");
  ok(opf2.includes('<item id="img1" href="images/img-1.png" media-type="image/png"/>'), "合成：第二张图 manifest 条目");
  const zipImg = await z2.file("OEBPS/images/img-0.png").async("uint8array");
  ok(Buffer.compare(Buffer.from(zipImg), PNG_A) === 0, "合成：图片字节原样落包 OEBPS/images/");
  const ch0 = await z2.file("OEBPS/c0.xhtml").async("string");
  const ch1 = await z2.file("OEBPS/c1.xhtml").async("string");
  // syn-3：一级标题开头不再压空首章（§9.4「粘贴书合成 EPUB 的空首章」清理）——
  // c0=第一章（img-0），c1=第二章（img-1），无 c2；目录不再多一项
  ok(!z2.file("OEBPS/c2.xhtml"), "合成：一级标题开头无空首章（spine 只剩 2 章，目录去多项）");
  ok(ch0.includes('src="images/img-0.png"'), "合成：第一章 img src 重写为 EPUB 内部路径");
  ok(ch1.includes('src="images/img-1.png"'), "合成：第二章 img src 重写（跨章生效）");
  ok(!ch0.includes('src="img-0.png"'), "合成：旧相对引用不残留");
  const s2b = await epub.buildSyntheticEpub("带图书", mdImgs, { images: [
    { filename: "img-0.png", bytes: imgA, mediaType: "image/png" },
    { filename: "img-1.png", bytes: imgB, mediaType: "image/png" }
  ] });
  ok(Buffer.compare(s2.bytes, s2b.bytes) === 0, "合成：带图两次合成字节级一致");
  const s3 = await epub.buildSyntheticEpub("带图书", mdImgs, { images: [
    { filename: "img-0.png", bytes: imgB, mediaType: "image/png" },
    { filename: "img-1.png", bytes: imgA, mediaType: "image/png" }
  ] });
  ok(Buffer.compare(s2.bytes, s3.bytes) !== 0, "合成：同 markdown 不同图片字节 → 产物不同（identifier 折入图哈希）");
  const z3 = await JSZip.loadAsync(s1.bytes);
  ok(!(await z3.file("OEBPS/content.opf").async("string")).includes("|imgs:"), "合成：无图 identifier 不受图片后缀影响");

  const s4 = await epub.buildSyntheticEpub("带图书", mdImgs, { images: [{ filename: "img-0.png", bytes: imgA, mediaType: "image/png" }] });
  const opf4 = await (await JSZip.loadAsync(s4.bytes)).file("OEBPS/content.opf").async("string");
  ok(!opf4.includes(`urn:uuid:synthetic-${djb2("带图书\u0000" + mdImgs)}`), "合成：有图 identifier ≠ 无图 identifier（碰撞防护）");

  // ---------- M6-1-5 syn-3 空首章清理与存量结构映射（§9.4 / §7.1.11） ----------
  section("M6-1-5 syn-3 空首章清理与存量结构映射（§9.4 / §7.1.11）");
  // 旧算法复刻（syn-2 行为，含空壳首章）——仅用于机械锁定「新章索引 = 旧章索引 − 1」的结构映射，
  // 供存量粘贴书锚点降级链（§6.2）的后续运行时映射实现对照。
  const oldSplit = (markdown, fallbackTitle) => {
    const chapters = [];
    let cur = { title: "", bodyHtml: "" };
    let buf = [];
    const flush = () => { cur.bodyHtml = epub.renderMarkdownToBodyHtml(buf.join("\n")); chapters.push(cur); };
    for (const line of String(markdown || "").split("\n")) {
      const m = /^#\s+(.+)$/.exec(line.trim());
      if (m) { flush(); cur = { title: m[1].trim(), bodyHtml: "" }; buf = []; }
      else buf.push(line);
    }
    flush();
    if (chapters.length === 1 && !chapters[0].title) chapters[0].title = (fallbackTitle || "").trim() || "正文";
    return chapters;
  };
  // (a) 多章节、一级标题开头：空壳被删，新旧索引恒等映射 new[i] === old[i+1]
  const oldChapters = oldSplit(mdImgs);
  const newChapters = epub.splitMarkdownChapters(mdImgs);
  ok(oldChapters.length === 3 && oldChapters[0].title === "" && oldChapters[0].bodyHtml === "", "旧算法复刻：一级标题开头压出空壳首章（syn-2 行为基线）");
  ok(newChapters.length === oldChapters.length - 1, "syn-3：空壳首章被删（章数 − 1）");
  ok(newChapters.every((c, i) => c.title === oldChapters[i + 1].title && c.bodyHtml === oldChapters[i + 1].bodyHtml), "存量映射：新章 i = 旧章 i+1（chapterIndex 整体偏移 −1，旧 1 即新 0）");
  // (b) 无一级标题开头（散文/Word 正文先行）：新旧结构恒等，零 CFI 影响
  const mdProse = "这是没有一级标题的散文开头。\n\n第二段。";
  const oldProse = oldSplit(mdProse, "散文书");
  const newProse = epub.splitMarkdownChapters(mdProse, "散文书");
  ok(oldProse.length === 1 && newProse.length === 1 && newProse[0].title === oldProse[0].title && newProse[0].bodyHtml === oldProse[0].bodyHtml, "存量映射：无一级标题开头的书新旧结构恒等（零偏移、零 CFI 影响）");
  // (c) 只有一级标题（无更多章节）：目录恰 1 项、首章即正文
  const mdSingle = "# 只有一级标题\n\n正文一段，没有更多章节。";
  const s5 = await epub.buildSyntheticEpub("单章书", mdSingle);
  const z5 = await JSZip.loadAsync(s5.bytes);
  const nav5 = await z5.file("OEBPS/nav.xhtml").async("string");
  const c05 = await z5.file("OEBPS/c0.xhtml").async("string");
  ok((nav5.match(/<li>/g) || []).length === 1, "只有一级标题：目录恰 1 项（syn-2 为 2 项：空壳+正章）");
  ok(c05.includes("正文一段"), "只有一级标题：首章即正文（首屏不空白）");
  ok((await z5.file("OEBPS/content.opf").async("string")).includes('<itemref idref="c0"/>'), "只有一级标题：spine 首项即正章");
  // (d) 合法空章不误删：有标题的「# 前言」后紧跟下一标题
  const prefaceChapters = epub.splitMarkdownChapters("# 前言\n\n# 第一章\n\n第一章正文。");
  ok(prefaceChapters.length === 2 && prefaceChapters[0].title === "前言" && prefaceChapters[1].title === "第一章", "合法空章：有标题的「前言」章保留（判定条件含 title===\"\" 从严不误删）");
  // (e) 标题前有实际正文 → 隐式前言章保留（③ 有非空行不丢）
  const introChapters = epub.splitMarkdownChapters("开头散文段。\n\n# 第一章\n\n正文。");
  ok(introChapters.length === 2 && introChapters[0].title === "" && introChapters[0].bodyHtml.includes("开头散文段"), "标题前正文：保留为隐式前言章（有非空行不丢）");
  // (f) 纯空白行 + 一级标题：不产生空壳（空白不算内容）
  const wsChapters = epub.splitMarkdownChapters("\n\n# 第一章\n\n正文。");
  ok(wsChapters.length === 1 && wsChapters[0].title === "第一章", "纯空白行+标题：不产生空壳（空白不算内容）");
  // (g) 空 markdown：行为不变（单章回退材料名）
  const emptyChapters = epub.splitMarkdownChapters("", "空书");
  ok(emptyChapters.length === 1 && emptyChapters[0].title === "空书", "空 markdown：行为不变（单章回退材料名）");
  // (h) 多章合成 toc：首项即首个一级标题（去多项，c0 起步）
  const s6 = await epub.buildSyntheticEpub("多章书", "# 甲\n\n甲正文。\n\n# 乙\n\n乙正文。");
  ok(s6.toc.length === 2 && s6.toc[0].label === "甲" && s6.toc[0].href === "c0.xhtml" && s6.toc[1].label === "乙" && s6.toc[1].href === "c1.xhtml", "多章：toc 首项即首个一级标题（目录去多项）");

  // ---------- M6-1-4 src 重写与 mediaType 工具 ----------
  section("M6-1-4 rewriteImgSrcs / mediaTypeForFilename");
  const rw = epub.rewriteImgSrcs('<p><img src="img-0.png" alt="a"/><img src="./img-1.png"/><img src="other.png"/><img src=\'img-2.png\'/></p>',
    new Set(["img-0.png", "img-1.png", "img-2.png"]));
  ok(rw.includes('src="images/img-0.png"') && rw.includes('src="images/img-1.png"') && rw.includes('src="images/img-2.png"'), "src 重写：命中文件名（含 ./ 前缀与单引号）重写为 images/");
  ok(rw.includes('src="other.png"'), "src 重写：未命中文件名原样保留");
  ok(epub.rewriteImgSrcs("<p>x</p>", new Set(["img-0.png"])) === "<p>x</p>", "src 重写：无 img 原样");
  ok(epub.mediaTypeForFilename("a.png") === "image/png" && epub.mediaTypeForFilename("b.jpg") === "image/jpeg" && epub.mediaTypeForFilename("c.weird") === "application/octet-stream", "mediaType：扩展名映射与未知兜底");

  // ---------- SUMMARY ----------
  console.log(`\n==== M6-1 SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) {
    console.log("FAILURES:", failures.join(" | "));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error("M6-1 TEST CRASH:", e);
  process.exit(1);
});
