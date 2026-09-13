// M6-3（v30）：HTML 文件导入转换（渲染层）
// 管线：DOMParser 解析 → @mozilla/readability 提取正文 → DOMPurify 清洗 → turndown（ATX + GFM 表格）→ markdown
// 回退链：Readability 返回 null（非文章页/结构异常）时整页 body 走同一 DOMPurify+turndown 管线，保证任意 HTML 可导入。
// 渲染层执行的理由：DOMParser/DOMPurify 是浏览器原生能力；主进程等价需 jsdom（不为单一功能引入运行时重依赖，
// jsdom 仅作测试 devDependency，见 tests/m6-3.test.cjs）。
// 规格：AI_DEVELOPMENT_GUIDE.md §9.1 M6-3。
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import DOMPurify from "dompurify";

// turndown（与 main-process importers.js 同配置：ATX 标题供合成管线章节切分）
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});

// word 导入的表格 GFM 规则同源实现（HTML 表格在文章里常见：词表/对照表）
function tableToGfm(tableNode: Element): string {
  const rows = Array.from(tableNode.querySelectorAll("tr"));
  if (!rows.length) return "";
  const grid = rows.map((r) =>
    Array.from(r.querySelectorAll("th,td")).map((c) => {
      const t = String(c.textContent || "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
      return t || " ";
    })
  );
  const cols = Math.max(...grid.map((r) => r.length));
  const pad = (row: string[]) => {
    const a = row.slice();
    while (a.length < cols) a.push(" ");
    return a;
  };
  const lines: string[] = [];
  lines.push("| " + pad(grid[0]).join(" | ") + " |");
  lines.push("|" + new Array(cols).fill(" --- ").join("|") + "|");
  for (let i = 1; i < grid.length; i++) lines.push("| " + pad(grid[i]).join(" | ") + " |");
  return lines.join("\n");
}

turndown.addRule("gfmTable", {
  filter: (node) => node.nodeName === "TABLE",
  replacement: (_content, node) => "\n\n" + tableToGfm(node as unknown as Element) + "\n\n"
});

/** 清洗配置：与 EPUB 导入同策略——剥脚本/样式/图片等非正文元素，禁 style/class/id 属性 */
const SANITIZE_CONFIG = {
  FORBID_TAGS: ["style", "script", "img", "link", "meta", "noscript", "iframe", "video", "audio", "form"],
  FORBID_ATTR: ["style", "class", "id", "onerror", "onload"]
};

export interface HtmlImportResult {
  title: string;
  markdown: string;
  /** 提取方式（诊断留痕）：readability=正文提取成功；fallback=整页回退 */
  via: "readability" | "fallback";
}

/** 由 html 文本提取书名：Readability 标题 → <title> → 首个一级标题 → 空 */
function deriveTitle(doc: Document, readTitle: string | null | undefined, markdown: string): string {
  const t = (readTitle || doc.title || "").trim();
  if (t) return t;
  const h1 = doc.querySelector("h1");
  if (h1?.textContent?.trim()) return h1.textContent.trim();
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : "";
}

/**
 * HTML 文件字节 → 文本（与主进程 decodeTextBytes 同策略：BOM → 严格 UTF-8 → GBK 回退）。
 * 渲染层 TextDecoder 走 Chromium full-ICU，GBK 可用；主进程那份走 Node 的 ICU。
 * 注意：HTML 常声明 charset（gb2312/gbk），严格 UTF-8 失败即 GBK 能覆盖绝大多数中文网页存档。
 */
export function decodeHtmlBytes(buf: Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("gbk").decode(buf);
    } catch {
      return new TextDecoder("utf-8").decode(buf);
    }
  }
}

/**
 * HTML 文件 → { title, markdown }（M6-3 主入口）。
 * 注意：调用方须在 DOM 可用的环境（渲染层）执行；纯函数化到「文本进、markdown 出」便于上下文理解。
 */
export function htmlToMarkdown(html: string): HtmlImportResult {
  const src = String(html || "");
  if (!src.trim()) return { title: "", markdown: "", via: "fallback" };
  const doc = new DOMParser().parseFromString(src, "text/html");

  // 回退链第 1 步：Readability 正文提取（article 结构）
  let markdown = "";
  let via: HtmlImportResult["via"] = "fallback";
  let readTitle: string | null = null;
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article && (article.content || "").trim()) {
      const cleanHtml = DOMPurify.sanitize(article.content || "", SANITIZE_CONFIG);
      markdown = turndown.turndown(cleanHtml).trim();
      readTitle = article.title || null;
      via = "readability";
    }
  } catch {
    /* 落到整页回退 */
  }

  // 回退链第 2 步：整页 body（非文章页：列表页/说明页等）
  if (!markdown) {
    const cleanHtml = DOMPurify.sanitize(doc.body?.innerHTML ?? "", SANITIZE_CONFIG);
    markdown = turndown.turndown(cleanHtml).trim();
    via = "fallback";
  }

  // 尾部空行收敛 + 连续空白压缩（与合成管线输入整洁度要求一致）
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
  return { title: deriveTitle(doc, readTitle, markdown), markdown, via };
}
