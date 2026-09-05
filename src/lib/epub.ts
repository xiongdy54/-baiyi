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
