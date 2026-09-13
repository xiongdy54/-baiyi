// M6-3（v30，D27）：统一导入路由器——单入口多选，按文件扩展名自动路由到对应导入管线。
// 路由表（决策 D27）：epub/html 渲染层解析（需 DOM/DOMParser）；docx/txt/md/pdf 主进程转换（路径入参）；
// mobi/azw3/azw/fb2/fbz/cbz 原文件入库（foliate 内核直读，扩展名保真）。
// 批量语义：逐文件独立尝试，单个失败不中断整批；返回聚合结果供 UI 报告。
import { decodeHtmlBytes, htmlToMarkdown } from "./htmlImport";
import { parseEpubBytes } from "./epub";
import { libraryApi } from "./library";

import { kindForFilename, type ImportKind } from "./importKinds";
export { kindForFilename };
export type { ImportKind };

export interface ImportOutcome {
  name: string;
  ok: boolean;
  title?: string;
  error?: string;
}

export type PickedFile = { name: string; path: string };

/** 单文件导入（按扩展名路由）。不抛错——失败以 { ok:false, error } 返回，供批量聚合。 */
export async function importOne(picked: PickedFile): Promise<ImportOutcome> {
  const name = picked?.name || picked?.path || "";
  const kind = kindForFilename(name);
  if (!kind) {
    return { name, ok: false, error: "不支持的文件类型" };
  }
  try {
    if (kind === "epub") {
      const bytes = await libraryApi.readFileBytes(picked.path);
      if (!bytes) return { name, ok: false, error: "读取文件失败" };
      const parsed = await parseEpubBytes(name, bytes);
      const ok = await libraryApi.createFromEpub(parsed);
      return ok ? { name, ok: true, title: parsed.title } : { name, ok: false, error: "建册失败" };
    }
    if (kind === "html") {
      const bytes = await libraryApi.readFileBytes(picked.path);
      if (!bytes) return { name, ok: false, error: "读取文件失败" };
      const { title, markdown } = htmlToMarkdown(decodeHtmlBytes(bytes));
      if (!markdown.trim()) return { name, ok: false, error: "未能提取到正文内容" };
      const created = await libraryApi.createFromHtml({ path: picked.path, name, title, markdown });
      return created ? { name, ok: true, title: created.title } : { name, ok: false, error: "建册失败" };
    }
    if (kind === "ebook") {
      const created = await libraryApi.createFromBookFile({ path: picked.path, name });
      return created ? { name, ok: true, title: created.title } : { name, ok: false, error: "建册失败" };
    }
    // word / txt / markdown / pdf：主进程按路径读盘并转换
    const created = await libraryApi.createImported(kind, { name, path: picked.path });
    return created ? { name, ok: true, title: created.title } : { name, ok: false, error: "未能提取到内容" };
  } catch (err) {
    return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 批量导入：逐文件独立尝试（单失败不中断），onProgress 报「第 done/total 个」 */
export async function importMany(
  picked: PickedFile[],
  onProgress?: (done: number, total: number, current: string) => void
): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  const total = picked.length;
  for (let i = 0; i < total; i += 1) {
    onProgress?.(i, total, picked[i]?.name || "");
    out.push(await importOne(picked[i]));
    onProgress?.(i + 1, total, picked[i]?.name || "");
  }
  return out;
}
