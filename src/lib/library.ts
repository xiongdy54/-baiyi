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
      // M6-3（v30，D27）统一导入入口
      pickImportFiles?: () => Promise<{ name: string; path: string }[] | null>;
      readFileBytes?: (filePath: string) => Promise<Uint8Array | null>;
      createFromHtml?: (payload: { path?: string; name?: string; title?: string; markdown: string }) => Promise<{ id: string; title: string } | null>;
      createFromBookFile?: (payload: { path: string; name?: string; ext?: string }) => Promise<{ id: string; title: string } | null>;
      readEbookFile?: (id: string) => Promise<{ bytes: Uint8Array; name: string } | null>;
      // v38（D35）：书籍语言属性（查词语言路由的书籍级信号）
      setItemLang?: (id: string, lang: string) => Promise<boolean>;
      // v45.1：书架悬停改名
      setItemTitle?: (id: string, title: string) => Promise<boolean>;
      /** D121 §1.1：书籍作者（空串=未知） */
      setItemAuthor?: (id: string, author: string) => Promise<boolean>;
      /** v48.22（D58 §6.8-2）：书级默认优先级（继承型摘录实时跟随） */
      setPriority?: (id: string, priority: number) => Promise<unknown>;
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
  /** 书籍语言（v38 D35）：BCP 主码（zh/en/ja…），空=未知；查词语言路由的书籍级信号 */
  lang?: string;
  /** 书级默认优先级（v48.22 D58 §6.8-2）：新建摘录继承；0-100，缺省 50 */
  priority?: number;
  /** 作者（D121 §1.1）：导入时取得到才有，空/缺=未知 */
  author?: string | null;
}

/** 书籍语言选项（与 dict.ts languageLabel 的语言名映射对齐；value 空=未知） */
export const BOOK_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "未知" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
  { value: "la", label: "拉丁语" },
];

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
  /** 作者（D121 §1.1）；未知为 null */
  author?: string | null;
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
  // M6-3（v30，D27）统一导入入口：多选对话框 + 类型路由所需的读取/建册
  async pickImportFiles(): Promise<{ name: string; path: string }[] | null> {
    return (await window.libraryAPI?.pickImportFiles?.()) ?? null;
  },
  async readFileBytes(filePath: string): Promise<Uint8Array | null> {
    return (await window.libraryAPI?.readFileBytes?.(filePath)) ?? null;
  },
  async createFromHtml(payload: { path?: string; name?: string; title?: string; markdown: string }): Promise<{ id: string; title: string } | null> {
    return (await window.libraryAPI?.createFromHtml?.(payload)) ?? null;
  },
  async createFromBookFile(payload: { path: string; name?: string; ext?: string }): Promise<{ id: string; title: string } | null> {
    return (await window.libraryAPI?.createFromBookFile?.(payload)) ?? null;
  },
  /** M6-3（v30）：被动兼容电子书（MOBI/AZW3/FB2/CBZ）原文件字节 + 文件名（扩展名保真供 foliate 分发） */
  async readEbookFile(itemId: string): Promise<{ bytes: Uint8Array; name: string } | null> {
    return (await window.libraryAPI?.readEbookFile?.(itemId)) ?? null;
  },
  async updateProgress(itemId: string, progress: ReadingProgress): Promise<void> {
    await window.libraryAPI?.updateProgress(itemId, progress);
  },
  async createFromPaste(title: string, markdown: string): Promise<{ id: string; title: string } | null> {
    if (!window.libraryAPI) return null;
    return await window.libraryAPI.createFromPaste(title, markdown);
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
  },
  // v38（D35）：设置书籍语言；空串=未知
  async setItemLang(id: string, lang: string): Promise<boolean> {
    return (await window.libraryAPI?.setItemLang?.(id, lang)) ?? false;
  },
  // v45.1：书架悬停改名（只改标题，不动封面/进度/文档）
  async setItemTitle(id: string, title: string): Promise<boolean> {
    return (await window.libraryAPI?.setItemTitle?.(id, title)) ?? false;
  },
  // D121 §1.1：设置书籍作者；空串=未知
  async setItemAuthor(id: string, author: string): Promise<boolean> {
    return (await window.libraryAPI?.setItemAuthor?.(id, author)) ?? false;
  },
  /** v48.22（D58 §6.8-2）：书级默认优先级——同时把该书下「继承型」摘录同步过去（用户单条改过的 'user' 不动） */
  async setPriority(id: string, priority: number): Promise<{ ok: boolean; priority?: number; followedExtracts?: number }> {
    return ((await window.libraryAPI?.setPriority?.(id, priority)) ?? { ok: false }) as {
      ok: boolean;
      priority?: number;
      followedExtracts?: number;
    };
  }
};

export function excerpt(markdown: string, max = 90): string {
  const t = markdown
    .replace(/[#>*`~[\]()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
