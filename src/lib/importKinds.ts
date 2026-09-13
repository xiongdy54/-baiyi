// M6-3（v30，D27）：导入类型与扩展名路由表（纯函数，无依赖——单测友好）。
// 路由去向见 importRouter.ts：epub/html 渲染层解析；docx/txt/md/pdf 主进程转换；mobi 等原文件入库直读。
export type ImportKind = "epub" | "html" | "word" | "txt" | "markdown" | "pdf" | "ebook";

const EBOOK_EXTS = ["mobi", "azw3", "azw", "fb2", "fbz", "cbz"];

/** 扩展名 → 导入类型（未知返回 null，由 UI 报「不支持的文件类型」） */
export function kindForFilename(name: string): ImportKind | null {
  const ext = String(name || "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "epub") return "epub";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "docx") return "word";
  if (ext === "txt") return "txt";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "pdf") return "pdf";
  if (EBOOK_EXTS.includes(ext)) return "ebook";
  return null;
}
