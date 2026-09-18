// 用户记忆客户端（v45，M14-UM1，D39 / §4.18 + §6.7）——渲染层唯一入口。
// 记忆真源在主进程 <userData>/memory/ 文件树；本客户端只读状态、触发达开关/整理/补处理，
// 编排（防抖、分批、水位线、AI 调用）全部在主进程 memoryTidy（本批不改制卡链路，零检索零注入）。
import { eventBus } from "./eventbus";

export interface MemoryUsageStat {
  chars: number;
  tokens: number;
}

export interface MemoryTopicStat extends MemoryUsageStat {
  rel: string;
  domain: string;
  topic: string;
}

export interface MemoryUsage {
  core: MemoryUsageStat;
  index: MemoryUsageStat;
  topics: MemoryTopicStat[];
  totals: MemoryUsageStat;
}

export interface MemoryPendingStats {
  entryCount: number;
  truncated: boolean;
  oldestUpdatedAt: number | null;
  batchCount: number;
  estCalls: number;
  estTokens: number;
}

export interface MemoryStatus {
  enabled: boolean;
  introAcked: boolean;
  memoryDir: string;
  lastCoveredAt: number | null;
  tidyDebounceMinutes: number;
  backfillBatchEntries: number;
  inputTokenBudget: number;
  consolidateEveryRounds: number;
  injectBudget: number;
  usage: MemoryUsage;
  pending: MemoryPendingStats;
  backfill: { running: boolean; done: number; total: number };
  lastError: string | null;
  treeReady: boolean;
}

/** memory_runs 留痕（§4.18-14 护栏⑤：可审计、可复现） */
export interface MemoryRun {
  id: string;
  kind: "ingest" | "consolidate";
  trigger: "debounce" | "startup" | "manual" | "backfill";
  status: "running" | "success" | "failed";
  startedAt: number;
  finishedAt: number | null;
  promptScope: string | null;
  promptVersion: number | null;
  tokenUsed: number | null;
  input: { entryIds?: string[]; entryCount?: number; topicRels?: string[] } | null;
  output: { ops?: unknown[]; notes?: string } | null;
  applied: { index: number; op: string; status: string; reason?: string; target?: string }[] | null;
  errorText: string | null;
}

export interface MemoryChangedPayload {
  phase?: "ingest" | "consolidate" | "backfill";
  running?: boolean;
  done?: number;
  total?: number;
  processed?: number;
  aborted?: boolean;
  backfill: { running: boolean; done: number; total: number };
  lastError: string | null;
}

export interface MemoryRetrieveResult {
  ok: boolean;
  reason?: "disabled" | "no-key";
  block: string | null;
  hitTopics: string[];
  usedChars?: number;
  lifeDomains?: string[];
  signals?: number;
}

declare global {
  interface Window {
    memoryAPI?: {
      status: () => Promise<MemoryStatus>;
      setEnabled: (payload: { enabled: boolean; introAcked?: boolean }) => Promise<Record<string, unknown>>;
      backfillPreview: () => Promise<MemoryPendingStats>;
      backfillStart: () => Promise<{ ok: boolean; skipped?: string; done?: number }>;
      backfillCancel: () => Promise<boolean>;
      tidyNow: () => Promise<{ ok: boolean; skipped?: string; error?: string; ops?: number }>;
      openFolder: () => Promise<boolean>;
      openFile: (name: string) => Promise<boolean>;
      reset: () => Promise<{ created: string[] }>;
      retrieve: (payload: { documentId: string | null; title?: string; section?: string; text?: string }) => Promise<MemoryRetrieveResult>;
      onChanged: (callback: (payload: MemoryChangedPayload) => void) => () => void;
    };
  }
}

export const memoryApi = {
  async status(): Promise<MemoryStatus | null> {
    if (!window.memoryAPI) return null;
    return (await window.memoryAPI.status()) || null;
  },
  async setEnabled(payload: { enabled: boolean; introAcked?: boolean }): Promise<boolean> {
    if (!window.memoryAPI) return false;
    await window.memoryAPI.setEnabled(payload);
    return true;
  },
  async backfillPreview(): Promise<MemoryPendingStats | null> {
    if (!window.memoryAPI) return null;
    return (await window.memoryAPI.backfillPreview()) || null;
  },
  async backfillStart(): Promise<{ ok: boolean; skipped?: string } | null> {
    if (!window.memoryAPI) return null;
    return (await window.memoryAPI.backfillStart()) || null;
  },
  async backfillCancel(): Promise<boolean> {
    if (!window.memoryAPI) return false;
    return await window.memoryAPI.backfillCancel();
  },
  async tidyNow(): Promise<{ ok: boolean; skipped?: string; error?: string; ops?: number } | null> {
    if (!window.memoryAPI) return null;
    return (await window.memoryAPI.tidyNow()) || null;
  },
  async openFolder(): Promise<boolean> {
    if (!window.memoryAPI) return false;
    return await window.memoryAPI.openFolder();
  },
  async openFile(name: string): Promise<boolean> {
    if (!window.memoryAPI) return false;
    return await window.memoryAPI.openFile(name);
  },
  async reset(): Promise<boolean> {
    if (!window.memoryAPI) return false;
    await window.memoryAPI.reset();
    return true;
  },
  // v46（M14-UM2）：制卡记忆接地检索——返回 null = 记忆接口不可用（旧 preload/未重启）
  async retrieve(payload: { documentId: string | null; title?: string; section?: string; text?: string }): Promise<MemoryRetrieveResult | null> {
    if (!window.memoryAPI?.retrieve) return null;
    return (await window.memoryAPI.retrieve(payload)) || null;
  }
};

// 主进程进度推送 → EventBus（只挂一次；`memory/changed` 为 v45 新增锁定事件）
let bridgeInstalled = false;
export function installMemoryBridge(): void {
  if (bridgeInstalled || typeof window === "undefined") return;
  if (!window.memoryAPI?.onChanged) return;
  bridgeInstalled = true;
  window.memoryAPI.onChanged((payload) => {
    eventBus.emit("memory/changed", payload);
  });
}
