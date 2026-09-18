// 日记客户端（v36，M8-A，§6.5 / §4.2-21）——渲染层唯一入口。
// 写路径全部经主进程（sql.js 单实例）；主进程写入后推 `journal:changed`，此处桥接为 EventBus
// 事件（§4.2-1「EventBus 唯一事实通道」），日记页与将来的洞察页订阅它刷新。
import { eventBus } from "./eventbus";

export interface JournalEntry {
  id: string;
  /** 'YYYY-MM-DD' 自然日（不随学习日切点漂移，D34） */
  entryDate: string;
  contentMarkdown: string;
  source: string; // 'app' | 'capture'
  /** 未发送的快速记录草稿（全局至多一条） */
  isDraft: boolean;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
}

export interface JournalListFilter {
  from?: string;
  to?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface JournalListResult {
  entries: JournalEntry[];
  total: number;
}

export interface JournalDay {
  date: string;
  count: number;
  entries: JournalEntry[];
  /** 全局未发送草稿（其 entryDate 可能不是 date——跨日草稿） */
  draft: JournalEntry | null;
}

export interface ShortcutStatus {
  quickCapture: { enabled: boolean; accelerator: string; registered: boolean; error: string | null };
  addMaterial: { enabled: boolean; accelerator: string; registered: boolean; error: string | null };
  hideOnBlur: boolean;
  autoLaunch: boolean;
}

export interface JournalChangedPayload {
  kind: string;
  entryId: string | null;
  entryDate?: string | null;
}

declare global {
  interface Window {
    journalAPI?: {
      list: (filter?: JournalListFilter) => Promise<JournalListResult>;
      dates: (opts?: { limit?: number }) => Promise<{ entryDate: string; count: number }[]>;
      day: (date?: string) => Promise<JournalDay>;
      draft: () => Promise<JournalEntry | null>;
      create: (payload: { contentMarkdown: string; source?: string; entryDate?: string }) => Promise<JournalEntry>;
      update: (id: string, contentMarkdown: string) => Promise<JournalEntry | null>;
      remove: (id: string) => Promise<boolean>;
      draftSend: (contentMarkdown: string) => Promise<{ ok: boolean; entry: JournalEntry }>;
      flush: () => Promise<boolean>;
      onChanged: (callback: (payload: JournalChangedPayload) => void) => () => void;
    };
    shortcutsAPI?: {
      status: () => Promise<ShortcutStatus>;
      apply: () => Promise<ShortcutStatus>;
      toggleCapture: () => Promise<boolean>;
      hideCapture: () => Promise<boolean>;
      requestAddMaterial: () => Promise<boolean>;
      onOpenAddMaterial: (callback: () => void) => () => void;
    };
  }
}

// 浏览器直开（无 preload）时的空实现：不崩、不写假数据
const emptyResult: JournalListResult = { entries: [], total: 0 };

export const journalApi = {
  async list(filter: JournalListFilter = {}): Promise<JournalListResult> {
    if (!window.journalAPI) return emptyResult;
    return (await window.journalAPI.list(filter)) || emptyResult;
  },
  async dates(limit = 400): Promise<{ entryDate: string; count: number }[]> {
    if (!window.journalAPI) return [];
    return (await window.journalAPI.dates({ limit })) || [];
  },
  async day(date?: string): Promise<JournalDay> {
    if (!window.journalAPI) return { date: date || "", count: 0, entries: [], draft: null };
    return await window.journalAPI.day(date);
  },
  async draft(): Promise<JournalEntry | null> {
    if (!window.journalAPI) return null;
    return (await window.journalAPI.draft()) || null;
  },
  async create(contentMarkdown: string, payload: { source?: string; entryDate?: string } = {}) {
    if (!window.journalAPI) return null;
    return await window.journalAPI.create({ contentMarkdown, ...payload });
  },
  async update(id: string, contentMarkdown: string) {
    if (!window.journalAPI) return null;
    return await window.journalAPI.update(id, contentMarkdown);
  },
  async remove(id: string) {
    if (!window.journalAPI) return false;
    return await window.journalAPI.remove(id);
  },
  /** 发送未发送草稿（与快速记录窗口同一契约） */
  async draftSend(contentMarkdown: string): Promise<JournalEntry | null> {
    if (!window.journalAPI?.draftSend) return null;
    const res = await window.journalAPI.draftSend(contentMarkdown);
    return res?.entry || null;
  },
  async flush() {
    if (!window.journalAPI) return false;
    return await window.journalAPI.flush();
  }
};

// 主进程推送 → EventBus（只挂一次；`journal/changed` 已加入锁定事件表）
let bridgeInstalled = false;
export function installJournalBridge(): void {
  if (bridgeInstalled || typeof window === "undefined") return;
  if (!window.journalAPI?.onChanged) return;
  bridgeInstalled = true;
  window.journalAPI.onChanged((payload) => {
    eventBus.emit("journal/changed", payload);
  });
}

export const shortcutsApi = {
  async status(): Promise<ShortcutStatus | null> {
    if (!window.shortcutsAPI) return null;
    return await window.shortcutsAPI.status();
  },
  async apply(): Promise<ShortcutStatus | null> {
    if (!window.shortcutsAPI) return null;
    return await window.shortcutsAPI.apply();
  },
  async toggleCapture(): Promise<boolean> {
    if (!window.shortcutsAPI) return false;
    return await window.shortcutsAPI.toggleCapture();
  },
  async requestAddMaterial(): Promise<boolean> {
    if (!window.shortcutsAPI) return false;
    return await window.shortcutsAPI.requestAddMaterial();
  },
  onOpenAddMaterial(callback: () => void): () => void {
    if (!window.shortcutsAPI?.onOpenAddMaterial) return () => {};
    return window.shortcutsAPI.onOpenAddMaterial(callback);
  }
};

// ---------- 展示派生（渲染层职责；主进程只存事实） ----------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' → 本地自然日的展示日期（与主进程 journalDateOf 同口径） */
export function todayJournalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isTodayJournalDate(dateStr: string): boolean {
  return dateStr === todayJournalDate();
}

/** `09-14 周日`（withYear 时 `2026-09-14 周日`）——非法输入原样返回 */
export function journalDateLabel(dateStr: string, opts: { withYear?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return String(dateStr || "");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  const label = `${pad2(mo)}-${pad2(d)} 周${"日一二三四五六"[date.getDay()]}`;
  return opts.withYear ? `${y}-${label}` : label;
}

/** 时间戳 → `HH:mm`（mono 时间戳口径，§5.3） */
export function formatClock(ms: number): string {
  const d = new Date(Number(ms) || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
