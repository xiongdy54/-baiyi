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
}

export interface ReadingProgress {
  ratio: number;
  lastText: string;
  updatedAt: number;
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
