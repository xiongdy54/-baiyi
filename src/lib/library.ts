// LibrarySourceProvider 的本地实现（Phase 1：粘贴成书）
declare global {
  interface Window {
    libraryAPI?: {
      list: () => Promise<unknown[]>;
      createFromPaste: (title: string, markdown: string) => Promise<{ id: string; title: string } | null>;
      createFromEpub: (payload: unknown) => Promise<{ id: string; title: string; cover: string | null } | null>;
      pickEpub: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
      remove: (id: string) => Promise<boolean>;
      getDocument: (id: string) => Promise<unknown>;
      getItemIdByDocumentId: (docId: string) => Promise<string | null>;
      updateProgress: (id: string, progress: unknown) => Promise<boolean>;
      readBookFile: (id: string) => Promise<Uint8Array | null>;
      // M6-1（v26）：Word/TXT/Markdown 导入（pick 返回 {name,path}；create 在主进程转换+建册）
      pickWord?: () => Promise<{ name: string; path: string } | null>;
      pickTxt?: () => Promise<{ name: string; path: string } | null>;
      pickMarkdown?: () => Promise<{ name: string; path: string } | null>;
      pickPdf?: () => Promise<{ name: string; path: string } | null>;
      createFromWord?: (payload: { name: string; path: string }) => Promise<{ id: string; title: string } | null>;
      createFromTxt?: (payload: { name: string; path: string }) => Promise<{ id: string; title: string } | null>;
      createFromMarkdown?: (payload: { name: string; path: string }) => Promise<{ id: string; title: string } | null>;
      createFromPdf?: (payload: { name: string; path: string }) => Promise<{ id: string; title: string; pages?: number; emptyPages?: number } | null>;
      readContentImages?: (id: string) => Promise<{ filename: string; bytes: Uint8Array }[]>;
      // M6-2 修订（v28 PDF 原生阅读）：读 PDF 原文件字节给 pdf.js 内核打开
      readPdfFile?: (id: string) => Promise<Uint8Array | null>;
    };
  }
}

export interface LibraryItem {
  id: string;
  title: string;
  sourceType: string;
  cover: string | null;
  progressJson: string | null;
  createdAt: number;
  updatedAt: number;
  markdown?: string | null;
}

// Phase 2 阅读器将写入 progressJson{ lastText, chapterIndex, position }；
// 现在无进度时回退到书籍开头作为"上次阅读位置"的占位。
export function lastReadDisplay(item: LibraryItem): string {
  if (item.progressJson) {
    try {
      const p = JSON.parse(item.progressJson) as { lastText?: string };
      if (p.lastText) return p.lastText;
    } catch {
      /* fallthrough */
    }
  }
  return excerpt(item.markdown ?? "", 160);
}

export interface DocPayload {
  documentId: string;
  title: string;
  markdown: string;
  progressJson: string | null;
  /** 书籍来源类型：epub（有原书文件，走阅读内核）/ paste（粘贴快捕）等 */
  sourceType?: string;
}

export interface ReadingProgress {
  ratio: number;
  lastText: string;
  updatedAt: number;
  /** 阅读内核（v20）：结构级定位与全书比例，恢复时优先于 ratio */
  cfi?: string;
  fraction?: number;
  /** PDF 原生阅读（v28）：页码锚点（0 基），恢复时优先于 fraction */
  pageIndex?: number;
}

export const libraryApi = {
  async list(): Promise<LibraryItem[]> {
    if (!window.libraryAPI) return [];
    return (await window.libraryAPI.list()) as LibraryItem[];
  },
  async getDocument(itemId: string): Promise<DocPayload | null> {
    if (!window.libraryAPI) return null;
    return (await window.libraryAPI.getDocument(itemId)) as DocPayload | null;
  },
  async getItemIdByDocumentId(docId: string): Promise<string | null> {
    return (await window.libraryAPI?.getItemIdByDocumentId(docId)) ?? null;
  },
  /** 读取原书文件字节（EPUB 等文件书）；无原书返回 null（阅读内核据此分流） */
  async readBookFile(itemId: string): Promise<Uint8Array | null> {
    return (await window.libraryAPI?.readBookFile(itemId)) ?? null;
  },
  /** M6-2 修订（v28 PDF 原生阅读）：读取 PDF 原文件字节；无原文件返回 null */
  async readPdfFile(itemId: string): Promise<Uint8Array | null> {
    return (await window.libraryAPI?.readPdfFile?.(itemId)) ?? null;
  },
  async updateProgress(itemId: string, progress: ReadingProgress): Promise<void> {
    await window.libraryAPI?.updateProgress(itemId, progress);
  },
  async createFromPaste(title: string, markdown: string): Promise<boolean> {
    if (!window.libraryAPI) return false;
    return (await window.libraryAPI.createFromPaste(title, markdown)) !== null;
  },
  async createFromEpub(payload: unknown): Promise<boolean> {
    if (!window.libraryAPI) return false;
    return (await window.libraryAPI.createFromEpub(payload)) !== null;
  },
  // M6-1（v26）：Word/TXT/Markdown 导入——pick 返回 null 表示用户取消；create 失败抛错由调用方提示
  async pickImport(kind: "word" | "txt" | "markdown" | "pdf"): Promise<{ name: string; path: string } | null> {
    const api = window.libraryAPI;
    if (!api) return null;
    if (kind === "word") return (await api.pickWord?.()) ?? null;
    if (kind === "txt") return (await api.pickTxt?.()) ?? null;
    if (kind === "pdf") return (await api.pickPdf?.()) ?? null;
    return (await api.pickMarkdown?.()) ?? null;
  },
  async createImported(kind: "word" | "txt" | "markdown" | "pdf", picked: { name: string; path: string }): Promise<{ id: string; title: string; emptyPages?: number } | null> {
    const api = window.libraryAPI;
    if (!api) return null;
    const result =
      kind === "word"
        ? await api.createFromWord?.(picked)
        : kind === "txt"
          ? await api.createFromTxt?.(picked)
          : kind === "pdf"
            ? await api.createFromPdf?.(picked)
            : await api.createFromMarkdown?.(picked);
    return result ?? null;
  },
  /** M6-1（v26）：读取某本书的内嵌图字节（Word 导入时落 assets kind=image-content），随合成 EPUB 内嵌 */
  async readContentImages(itemId: string): Promise<{ filename: string; bytes: Uint8Array }[]> {
    return (await window.libraryAPI?.readContentImages?.(itemId)) ?? [];
  },
  async remove(id: string): Promise<boolean> {
    if (!window.libraryAPI) return false;
    return await window.libraryAPI.remove(id);
  }
};

export function excerpt(markdown: string, max = 90): string {
  const t = markdown
    .replace(/[#>*`~[\]()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
