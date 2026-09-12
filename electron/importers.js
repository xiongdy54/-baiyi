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

/** Markdown 导入：仅做行尾与 BOM 归一，语法直通（防注入由合成管线 html:false 保证） */
function markdownFromText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").trim();
}

/** 文件名 → 书名（去扩展名） */
function titleFromFilename(name) {
  return String(name || "").replace(/\.[^.]+$/, "").trim();
}

module.exports = {
  wordToMarkdown,
  decodeTextBytes,
  txtToMarkdown,
  markdownFromText,
  titleFromFilename,
  MAX_WORD_IMAGES_TOTAL_BYTES,
};
