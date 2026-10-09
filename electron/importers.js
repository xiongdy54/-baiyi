// M6-1（v26）导入格式扩展：Word(.docx，含内嵌图) / TXT / Markdown → markdown（主进程侧纯转换，不碰 DB）
// 规格：AI_DEVELOPMENT_GUIDE.md §9.1 M6-1。转换在主进程完成（mammoth/turndown 皆 Node 可用），
// 渲染层只经 IPC 传文件路径与接收结果；图片字节由 db 层落 assets（kind=image-content），读侧随合成 EPUB 内嵌。
const mammoth = require("mammoth");
const TurndownService = require("turndown");

// 单书内嵌图片总量上限（沿用 createAssetForItem 的 10MB 思路，按书计）
const MAX_WORD_IMAGES_TOTAL_BYTES = 10 * 1024 * 1024;

// mammoth 产出的 contentType → 资产扩展名（EMF/WMF 等浏览器不可渲染的格式直接跳过）
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
};

// turndown（主进程直跑，内部自带 domino DOM）；ATX 标题（# ）是合成管线 splitMarkdownChapters 的章节切分前提
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Word 表格 → GFM 管道表（mammoth 输出 <table>；turndown 默认不识别表格会拍平文本，此处直接按 DOM 结构转）
function tableToGfm(tableNode) {
  const rows = Array.from(tableNode.querySelectorAll("tr"));
  if (!rows.length) return "";
  const grid = rows.map((r) =>
    Array.from(r.querySelectorAll("th,td")).map((c) => {
      const t = String(c.textContent || "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
      return t || " ";
    })
  );
  const cols = Math.max(...grid.map((r) => r.length));
  const pad = (row) => {
    const a = row.slice();
    while (a.length < cols) a.push(" ");
    return a;
  };
  const lines = [];
  lines.push("| " + pad(grid[0]).join(" | ") + " |");
  lines.push("|" + new Array(cols).fill(" --- ").join("|") + "|");
  for (let i = 1; i < grid.length; i++) lines.push("| " + pad(grid[i]).join(" | ") + " |");
  return lines.join("\n");
}

turndown.addRule("gfmTable", {
  filter: (node) => node.nodeName === "TABLE",
  replacement: (_content, node) => "\n\n" + tableToGfm(node) + "\n\n",
});

/**
 * Word(.docx) → { markdown, images: [{filename, bytes(Buffer), mediaType}] }
 * 图片按出现序确定性命名 img-0.png…（synth 合成纪律：非随机）；markdown 引用名 = 资产文件名。
 */
async function wordToMarkdown(buf) {
  const images = [];
  let skippedImages = 0;
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const contentType = String(image.contentType || "").toLowerCase();
        const ext = MIME_TO_EXT[contentType];
        if (!ext) {
          skippedImages += 1;
          return { src: "" };
        }
        const bytes = await image.read(); // mammoth image.read() → Promise<Buffer>
        images.push({ filename: `img-${images.length}.${ext}`, bytes, mediaType: contentType });
        return { src: `img-${images.length - 1}.${ext}` };
      }),
    }
  );

  // 清掉未支持格式留下的空 <img src="">；turndown 收 HTML 出 markdown
  const html = String(result.value || "").replace(/<img\b[^>]*\bsrc=""[^>]*>/g, "");
  const markdown = turndown.turndown(html).trim();

  const total = images.reduce((n, im) => n + im.bytes.length, 0);
  if (total > MAX_WORD_IMAGES_TOTAL_BYTES) {
    throw new Error(`Word 文档内嵌图片总量 ${(total / 1024 / 1024).toFixed(1)}MB 超过 10MB 上限，请压缩后重试`);
  }
  return { markdown, images, messages: result.messages || [], skippedImages };
}

/**
 * 字节 → 文本（中文刚需：TXT 来源多为 GBK/UTF-16 网文与导出件）。
 * 顺序：UTF-8 BOM → UTF-16 LE/BE BOM → 严格 UTF-8 → GBK 回退 → latin1 兜底。
 */
function decodeTextBytes(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8-sig" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    try {
      return { text: new TextDecoder("gbk").decode(buf), encoding: "gbk" };
    } catch {
      return { text: buf.toString("latin1"), encoding: "latin1" };
    }
  }
}

/**
 * TXT → markdown：行归一化 + 每个非空行成段（中文材料「一行=一段」的主导形态）。
 * 若原文本身写有 # 标题等 markdown 语法，行内容原样保留 → 合成管线自然按一级标题章节化。
 */
function txtToMarkdown(text) {
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B\u200E\u200F]/g, "");
  const paras = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

/**
 * Markdown 导入：行尾/BOM 归一 + 非正文噪音清洗（v29）。
 * 微信文章等网页存档类 .md 常含网页 <style> 块与底栏 data-URI 图标：
 * - <style>/<script> 原始块：合成管线 html:false 会把它们当转义文本显示成大段代码；
 * - ![…](data:image/…) 数据图：多为 UI 图标（阅读/赞/分享），且使 documents.markdown 膨胀。
 * 清洗只针对这两类明确噪音，正文不做任何改写；粘贴路径不走本函数（保持直通）。
 */
/**
 * 批次 D（D-TEST-22）：清洗必须**围栏感知**。原来的三个全局正则没有上下文，
 * 用户 .md 里代码块内的 <style>/<script> 示例会被整段吃掉（F30 S3 实测），
 * 而 documents.markdown 是唯一正文真源、坏了没有第二份可回滚。
 * 围栏内原样保留；围栏外照旧清洗（不得因为加了围栏感知就放过正文噪音）。
 * 未闭合围栏 → 其后全文按代码保护（合理降级）。CommonMark 的缩进代码/列表内围栏不在此实现范围。
 */
function markdownFromText(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const cleanSegment = (s) =>
    s
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
      .replace(/!\[[^\]]*\]\(\s*data:image\/[^)]*\)/g, "")
      .replace(/\n{3,}/g, "\n\n");
  const lines = src.split("\n");
  const out = [];
  let buf = [];
  let fence = null; // 当前围栏字符（` 或 ~）
  const flush = () => {
    if (buf.length) {
      out.push(cleanSegment(buf.join("\n")));
      buf = [];
    }
  };
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m) {
        flush();
        fence = m[1][0];
        out.push(line);
      } else buf.push(line);
      continue;
    }
    out.push(line); // 围栏内：原样保留
    if (m && m[1][0] === fence) fence = null; // 闭合（允许更长围栏）
  }
  flush();
  return out.join("\n").trim();
}

/** 文件名 → 书名（去扩展名） */
function titleFromFilename(name) {
  return String(name || "").replace(/\.[^.]+$/, "").trim();
}

/**
 * D121 §1.1：DOCX 作者——读 docProps/core.xml 的 <dc:creator>。取不到（无 jszip / 无该文件 / 空值）一律返回 null，绝不猜。
 */
async function docxAuthor(buf) {
  try {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file("docProps/core.xml");
    if (!f) return null;
    const xml = await f.async("string");
    const m = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(xml);
    if (!m) return null;
    const v = m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .trim();
    return v || null;
  } catch {
    return null;
  }
}

module.exports = {
  docxAuthor,
  wordToMarkdown,
  decodeTextBytes,
  txtToMarkdown,
  markdownFromText,
  titleFromFilename,
  MAX_WORD_IMAGES_TOTAL_BYTES,
};

// ---------- PDF 基础文本导入（M6-2，v27：pdfjs-dist 主进程提纯文本 → 合成 EPUB；扫描版 OCR 不在本批） ----------
const path = require("path");
const CMAP_DIR = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "cmaps") + "/";
const FONTS_DIR = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const TERMINAL_PUNCT = /[。！？；：.!?;:]["»）)]?$/;
const isCJKChar = (ch) => !!ch && CJK_RE.test(ch);

/**
 * pdfjs 文本 item 序列 → 行。双信号：item.hasEOL 关行 + y 坐标变化关行。
 * 行结构：{ text, x（行左缘）, y（基线，向下递减）, h（最大字高）}
 */
function itemsToLines(items) {
  const lines = [];
  let cur = null;
  const close = () => {
    if (!cur || !cur.parts.length) { cur = null; return; }
    // 行内拼接：CJK 侧直接粘连（PDF 逐字 item 不插空格），ASCII 两侧按 item 间隙补空格
    let text = "";
    for (let i = 0; i < cur.parts.length; i++) {
      const part = cur.parts[i];
      if (i > 0) {
        const prev = cur.parts[i - 1];
        const gap = part.x - (prev.x + prev.w);
        const needSpace =
          gap > (cur.h || part.h || 10) * 0.15 &&
          !isCJKChar(prev.s.slice(-1)) && !isCJKChar(part.s.slice(0, 1)) &&
          !/\s$/.test(text) && !/^\s/.test(part.s);
        if (needSpace) text += " ";
      }
      text += part.s;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text) lines.push({ text, x: cur.x0, y: cur.y, h: cur.h });
    cur = null;
  };
  for (const it of items) {
    if (it.hasEOL && (!it.str || !it.str.trim())) { close(); continue; } // 纯换行哨兵 item
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const x = it.transform[4];
    const h = Math.abs(it.transform[3]) || it.height || 0;
    if (cur && Math.abs(cur.y - y) > Math.max(1.5, (cur.h || h) * 0.5)) close(); // y 变化 → 新行
    if (!cur) cur = { parts: [], x0: x, y, h: 0 };
    cur.parts.push({ s: it.str, x, w: it.width || 0 });
    cur.x0 = Math.min(cur.x0, x);
    cur.h = Math.max(cur.h, h);
    if (it.hasEOL) close();
  }
  close();
  return lines;
}

/** 字号启发式标题候选：行高 ≥ 1.35×全书行高下中位数且 ≤ 60 字符（同字号文档中位数自身抬升，天然不误判；偶数取下中位防上中位污染） */
function headingCandidates(lines) {
  if (!lines.length) return [];
  const hs = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
  const medianH = hs.length ? hs[Math.floor((hs.length - 1) / 2)] : 10;
  return lines.filter((l) => l.h >= medianH * 1.35 && l.text.length <= 60);
}

/**
 * 行序列 → 段落 markdown。
 * 段落切分：行距 > 1.6×中位行距，或下行左缘明显缩进（> 0.9×中位字高且上行贴左缘，中文首行缩进惯例）。
 * markHeadings=true 时按字号启发式挑出标题行并从段落中排除（供无大纲章节化用）。
 */
function linesToMarkdown(lines, headingSet = null) {
  if (!lines.length) return { paragraphs: [], headingLines: [] };
  const diffs = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  // 25 分位数估计正文行距（中位数会被标题大间距抬高导致全文粘连）
  const medianDiff = diffs.length ? diffs[Math.max(0, Math.floor(diffs.length * 0.25))] : 0;
  const hs = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
  const medianH = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
  const minX = Math.min(...lines.map((l) => l.x));



  const paragraphs = [];
  const headingLines = [];
  let buf = "";
  const flush = () => { if (buf.trim()) paragraphs.push(buf.trim()); buf = ""; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headingSet && headingSet.has(line)) { flush(); headingLines.push(line); continue; }
    if (i > 0) {
      const prev = lines[i - 1];
      const yGap = prev.y - line.y;
      const indented = line.x > minX + medianH * 0.9 && prev.x <= minX + medianH * 0.35;
      if (yGap > medianDiff * 1.6 || indented) {
        flush();
      } else if (buf && !isCJKChar(buf.slice(-1)) && !isCJKChar(line.text.slice(0, 1)) && !/\s$/.test(buf) && !/^\s/.test(line.text)) {
        buf += " "; // 跨行 ASCII 补空格
      }
    }
    buf += line.text;
  }
  flush();
  return { paragraphs, headingLines };
}

/** 跨页段落愈合拼接：任一侧边界为 CJK 直接粘连，否则补一个空格 */
function joinPageMarkdown(a, b) {
  const ta = a.replace(/\s+$/, "");
  const tb = b.replace(/^\s+/, "");
  if (!ta) return tb;
  if (!tb) return ta;
  if (isCJKChar(ta.slice(-1)) || isCJKChar(tb.slice(0, 1))) return ta + tb;
  return ta + " " + tb;
}

/** PDF 书签大纲 → [{title, level, pageIndex(0基)}]（named dest 先解析；单条失败跳过） */
async function pdfOutline(doc) {
  const out = [];
  const walk = async (entries, level) => {
    for (const e of entries || []) {
      try {
        let dest = e.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref) {
          const pageIndex = await doc.getPageIndex(ref);
          if (e.title && e.title.trim()) out.push({ title: e.title.trim(), level, pageIndex });
        }
      } catch { /* 单条解析失败不阻塞 */ }
      if (e.items && e.items.length) await walk(e.items, level + 1);
    }
  };
  try { await walk(await doc.getOutline(), 1); } catch { /* 大纲不可用 → 空 */ }
  return out;
}

/**
 * PDF → markdown（主进程入口，M6-2）。
 * 章节化优先级：① 书签大纲（level1→`# `、level2→`## `）② 字号启发式标题（无大纲时）③ 页数>8 按每 10 页分块。
 * 全部页面无文本层（扫描版）→ throw。
 */
async function pdfToMarkdown(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    cMapUrl: CMAP_DIR,
    cMapPacked: true,
    standardFontDataUrl: FONTS_DIR,
  }).promise;
  const pages = doc.numPages;

  const pageLines = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pageLines.push(itemsToLines(tc.items));
  }
  const emptyPages = pageLines.filter((l) => l.length === 0).length;
  if (emptyPages === pages) {
    throw new Error("未在该 PDF 中提取到文本层——可能是扫描版/图片型 PDF。扫描版 OCR 暂不支持，请使用带文字层的 PDF。");
  }

  const outline = await pdfOutline(doc);
  const useOutline = outline.length >= 1;
  // 字号标题候选按全书行高中位数计算（无大纲时）
  const flagged = useOutline ? [] : headingCandidates(pageLines.flat());
  const headingSet = new Set(flagged);
  const useHeadings = !useOutline && flagged.length >= 2;
  const pageMd = pageLines.map((lines) => linesToMarkdown(lines, headingSet));

  // 跨页段落愈合：上页末段不以终止标点结尾 → 移出本页，与下页首段合并
  const pageParts = pageMd.map((p) => p.paragraphs.slice());
  for (let i = 0; i < pages - 1; i++) {
    const cur = pageParts[i];
    if (!cur.length) continue;
    const last = cur[cur.length - 1];
    if (!TERMINAL_PUNCT.test(last) && pageParts[i + 1].length) {
      pageParts[i + 1][0] = joinPageMarkdown(last, pageParts[i + 1][0]);
      cur.pop();
    }
  }

  // 章节插入点：pageIndex → [{level, title}]
  const insertAt = new Map();
  const pushHeading = (pageIndex, level, title) => {
    const arr = insertAt.get(pageIndex) || [];
    arr.push({ level, title });
    insertAt.set(pageIndex, arr);
  };
  if (useOutline) {
    for (const o of outline) pushHeading(o.pageIndex, Math.min(o.level, 2), o.title);
  } else {
    if (useHeadings) {
      pageMd.forEach((p, i) => p.headingLines.forEach((h) => pushHeading(i, 1, h.text)));
    } else if (pages > 8) {
      for (let p = 0; p < pages; p += 10) {
        const end = Math.min(p + 10, pages);
        pushHeading(p, 1, end - p > 1 ? `第 ${p + 1}–${end} 页` : `第 ${p + 1} 页`);
      }
    }
  }

  const outLines = [];
  for (let i = 0; i < pages; i++) {
    for (const h of insertAt.get(i) || []) outLines.push(h.level === 1 ? `# ${h.title}` : `## ${h.title}`);
    for (const para of pageParts[i] || []) outLines.push(para);
  }
  const markdown = outLines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) throw new Error("未能从该 PDF 中提取到有效文本内容");
  const chapters = (markdown.match(/^# /gm) || []).length;
  return { markdown, pages, emptyPages, chapters, outlineUsed: useOutline };
}

module.exports.pdfToMarkdown = pdfToMarkdown;
module.exports.itemsToLines = itemsToLines;
module.exports.linesToMarkdown = linesToMarkdown;
module.exports.pdfOutline = pdfOutline;
module.exports.joinPageMarkdown = joinPageMarkdown;
module.exports.headingCandidates = headingCandidates;
