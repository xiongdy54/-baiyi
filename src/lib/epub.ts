// EpubProvider — 按 AI_DEVELOPMENT_GUIDE.md §1/§附录B 锁定方案实现
// 解析: @likecoin/epub-ts；HTML→Markdown: turndown + DOMPurify（复用全局 Markdown 管线）
import ePub from "@likecoin/epub-ts";
import type { Book } from "@likecoin/epub-ts";
import TurndownService from "turndown";
import DOMPurify from "dompurify";

export interface EpubImportResult {
  title: string;
  markdown: string;
  toc: { title: string; href: string }[];
  coverDataUrl: string;
  epubData: Uint8Array;
  sourceName: string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});

function stripTags(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractCover(book: Book): Promise<string> {
  interface ManifestItem { id?: string; href?: string; properties?: string[] }
  const pkg = (
    book as unknown as {
      packaging?: { coverPath?: string; manifest?: Record<string, ManifestItem> };
    }
  ).packaging;

  const candidates: string[] = [];
  try {
    if (pkg?.coverPath) candidates.push(pkg.coverPath);
  } catch { /* ignore */ }
  try {
    for (const item of Object.values(pkg?.manifest ?? {})) {
      if ((item.properties ?? []).includes("cover-image")) candidates.push(item.href || "");
      if (item.id === "cover") candidates.push(item.href || "");
      if (/cover\.(jpe?g|png|gif|webp|svg)$/i.test(item.href || "")) candidates.push(item.href || "");
    }
  } catch { /* ignore */ }

  for (const p of [...new Set(candidates.filter(Boolean))]) {
    try {
      const resolved = book.resolve(p);
      const blob = await book.archive?.getBlob(resolved);
      if (blob && blob.size > 0) return await blobToDataUrl(blob);
    } catch { /* try next candidate */ }
  }
  return "";
}

export async function importEpubFile(): Promise<EpubImportResult | null> {
  if (!window.libraryAPI) throw new Error("API 不可用");
  const picked = await window.libraryAPI.pickEpub();
  if (!picked) return null;
  return parseEpubBytes(picked.name, picked.data as Uint8Array);
}

/** M6-3（v30，D27）：由字节解析 EPUB（统一导入入口的 epub 分支；原 importEpubFile 保留兼容） */
export async function parseEpubBytes(name: string, rawBytes: Uint8Array): Promise<EpubImportResult> {
  const picked = { name: name || "book.epub", data: rawBytes };
  const raw = picked.data as Uint8Array;
  const arrayBuffer = raw.buffer.slice(
    raw.byteOffset,
    raw.byteOffset + raw.byteLength
  ) as ArrayBuffer;

  const book: Book = ePub(arrayBuffer);
  await book.ready;

  const meta = await book.packaging?.metadata;
  const coverDataUrl = await extractCover(book);

  const nav = await book.loaded.navigation;
  const toc = (nav?.toc ?? []).map((t) => ({
    title: stripTags(t.label || ""),
    href: t.href || ""
  }));

  const spineItems = book.spine?.spineItems ?? [];
  let markdown = "";
  for (let i = 0; i < spineItems.length; i++) {
    const section = spineItems[i];
    await section.load(book.load.bind(book));
    try {
      const bodyHtml = section.document?.body?.innerHTML ?? "";
      const base = (section.href || "").split("/").pop();
      const tocItem = toc.find((t) => t.href.split("/").pop() === base);
      const chapterTitle = tocItem?.title || `第 ${i + 1} 章`;
      const cleanHtml = DOMPurify.sanitize(bodyHtml, {
        FORBID_TAGS: ["style", "script", "img", "link", "meta"],
        FORBID_ATTR: ["style", "class", "id"]
      });
      const chapterMd = turndown.turndown(cleanHtml).trim();
      markdown += `\n\n# ${chapterTitle}\n\n${chapterMd}`;
    } finally {
      section.unload();
    }
  }

  if (!markdown.trim()) {
    throw new Error("未能从这本书中提取到文本内容");
  }

  return {
    title: (meta?.title || picked.name.replace(/\.epub$/i, "")).trim(),
    markdown: markdown.trim(),
    toc,
    coverDataUrl,
    epubData: raw,
    sourceName: picked.name
  };
}

// ---------- 合成 EPUB（v20「一切皆书」）：粘贴书/摘录的 markdown 确定性转为 EPUB 字节，走统一阅读内核 ----------
// 确定性纪律：同 generatorVersion + 同输入必然产出字节级同构的章节结构——已存 CFI 永不因重新生成而错位。
// generatorVersion 变更 = 结构性变更（换解析器/章节化规则），旧锚点走「可降级恢复链」。
import MarkdownIt from "markdown-it";
import katex from "katex";
import JSZip from "jszip";
// KaTeX CSS 文本（Vite ?raw）：内嵌进合成书首页，公式排版无外部依赖
import katexCssText from "katex/dist/katex.min.css?raw";

/** djb2 确定性哈希（dc:identifier 生成禁用时间戳——合成书必须字节级可复现） */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const SYNTH_GENERATOR_VERSION = "syn-2"; // syn-2（v26）：增图片能力（opts.images→OEBPS/images/）；无图输入与 syn-1 结构逐字节同构

const synthMd: MarkdownIt = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** markdown → 正文 HTML（KaTeX 服务端渲染为自包含 HTML+CSS，无脚本；占位符法避免被 markdown 转义） */
export function renderMarkdownToBodyHtml(markdown: string): string {
  const mathSlots: string[] = [];
  const stash = (tex: string, display: boolean) => {
    const idx = mathSlots.push(
      katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" })
    ) - 1;
    return `@@KATEX${idx}@@`;
  };
  // $$…$$（display，含多行）先行；再行内 $…$
  const withSlots = markdown
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => stash(String(tex).trim(), true))
    .replace(/\$([^$\n]+?)\$/g, (_m, tex) => stash(String(tex).trim(), false));
  return synthMd.render(withSlots).replace(/@@KATEX(\d+)@@/g, (_m, i) => mathSlots[Number(i)] ?? "");
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SyntheticChapter {
  title: string;
  bodyHtml: string;
}

/** 按一级标题章节化（无一级标题 = 单章）；确定性：纯字符串运算 */
export function splitMarkdownChapters(markdown: string): SyntheticChapter[] {
  const lines = String(markdown || "").split("\n");
  const chapters: SyntheticChapter[] = [];
  let cur: SyntheticChapter = { title: "", bodyHtml: "" };
  let buf: string[] = [];
  const flush = () => {
    cur.bodyHtml = renderMarkdownToBodyHtml(buf.join("\n"));
    chapters.push(cur);
  };
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m) {
      flush();
      cur = { title: m[1].trim(), bodyHtml: "" };
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();
  if (chapters.length === 1 && !chapters[0].title) chapters[0].title = "正文";
  return chapters;
}

const xhtmlDoc = (title: string, bodyHtml: string, lang: string, extraStyle?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head><title>${escapeXml(title)}</title>
<meta charset="utf-8"/>
${extraStyle ? `<style>${extraStyle}</style>` : ""}
</head>
<body>
${bodyHtml}
</body></html>`;

/**
 * 生成合成 EPUB 字节 + 目录（供粘贴书/摘录进入统一阅读内核）。
 * KaTeX CSS 以 author style 内嵌首页（katex.min.css 体积可控且随书分发）。
 */
/** 合成书内嵌图片：filename 为 markdown 引用的相对名（img-0.png），bytes 为原始字节 */
export interface SynthImage {
  filename: string;
  bytes: Uint8Array;
  mediaType: string;
}

/** 章节 HTML 内 <img src> 重写：markdown 引用名 → EPUB 内部路径 images/<filename>（仅命中提供的文件名，其余原样） */
export function rewriteImgSrcs(bodyHtml: string, filenames: Set<string>): string {
  if (!filenames.size) return bodyHtml;
  return bodyHtml.replace(/(<img\b[^>]*?\ssrc=)("([^"]*)"|'([^']*)')/g, (m, head, _q, dq, sq) => {
    let src = (dq !== undefined ? dq : sq).trim();
    if (src.startsWith("./")) src = src.slice(2);
    if (!filenames.has(src)) return m;
    return `${head}"images/${src}"`;
  });
}

const imageExtMime: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp"
};

export function mediaTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return imageExtMime[ext] || "application/octet-stream";
}

/** 图片字节哈希后缀（仅有图时非空 → 无图 identifier 与 syn-1 恒等，CFI 稳定性不受影响） */
function imageHashSuffix(images: SynthImage[]): string {
  if (!images.length) return "";
  const parts = images.map((im) => {
    let h = 5381;
    for (let i = 0; i < im.bytes.length; i++) h = ((h << 5) + h + im.bytes[i]) >>> 0;
    return `${im.filename}:${h.toString(36)}`;
  });
  return "|imgs:" + parts.join(",");
}

export async function buildSyntheticEpub(
  title: string,
  markdown: string,
  opts?: { lang?: string; embedKatexCss?: boolean; images?: SynthImage[] }
): Promise<{ bytes: Uint8Array; toc: { label: string; href: string }[] }> {
  const lang = opts?.lang || "zh";
  const images = (opts?.images ?? []).filter((im) => im && im.filename && im.bytes && im.bytes.length > 0);
  const chapters = splitMarkdownChapters(markdown);
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  // 图片资源：文件名去重集合驱动 src 重写与 manifest 条目
  const imageNameSet = new Set(images.map((im) => im.filename));
  const manifestItems: string[] = [];
  const spineRefs: string[] = [];
  chapters.forEach((c, i) => {
    manifestItems.push(`    <item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`);
    spineRefs.push(`    <itemref idref="c${i}"/>`);
  });
  images.forEach((im, i) => {
    manifestItems.push(`    <item id="img${i}" href="images/${escapeXml(im.filename)}" media-type="${im.mediaType || mediaTypeForFilename(im.filename)}"/>`);
  });
  manifestItems.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:synthetic-${stableHash(title + " " + markdown + imageHashSuffix(images))}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2026-09-10T00:00:00Z</meta>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineRefs.join("\n")}
  </spine>
</package>`
  );
  const tocLis = chapters
    .map((c, i) => `      <li><a href="c${i}.xhtml">${escapeXml(c.title || `第 ${i + 1} 章`)}</a></li>`)
    .join("\n");
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head><body>
<nav epub:type="toc" id="toc"><ol>
${tocLis}
</ol></nav>
</body></html>`
  );
  const katexCss = opts?.embedKatexCss === false ? "" : katexCssText;
  chapters.forEach((c, i) => {
    const bodyHtml = imageNameSet.size ? rewriteImgSrcs(c.bodyHtml, imageNameSet) : c.bodyHtml;
    zip.file(`OEBPS/c${i}.xhtml`, xhtmlDoc(c.title || `第 ${i + 1} 章`, bodyHtml, lang, i === 0 ? katexCss : undefined));
  });
  // 图片字节落包（OEBPS/images/，与 manifest href 对应）
  images.forEach((im) => {
    zip.file(`OEBPS/images/${im.filename}`, im.bytes);
  });
  const bytes = await zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip" });
  const toc = chapters.map((c, i) => ({ label: c.title || `第 ${i + 1} 章`, href: `c${i}.xhtml` }));
  return { bytes, toc };
}
