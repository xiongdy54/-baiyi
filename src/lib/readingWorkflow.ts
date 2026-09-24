// ReadingWorkflowProvider — 渐进阅读流程抽象（指南 §4.2-9）
// v48.22（D58/D59）：升级为**可切换推送引擎**——`name` 即持久化值（settings.app.extracts.engine）；
// 两个实现共享同一组写面，各自只在自己的私有子空间（extracts.engine_state_json）里记账，
// 切换＝换 Provider + 投影目标引擎的值到公共列（无损判据见指南 §6.8-4）。
// 渲染层只依赖本接口，不得感知具体引擎的内部状态。
import { settingsStore } from "./settings";

export type ExtractEngine = "sm19-default" | "ai-next-extract";
export const EXTRACT_ENGINES: ExtractEngine[] = ["sm19-default", "ai-next-extract"];
export const DEFAULT_EXTRACT_ENGINE: ExtractEngine = "sm19-default";

/** 摘录状态机 v1（指南 §6.4.2；未知状态运行时一律按 open 对待） */
export type ExtractStatus =
  | "open" | "reading" | "carded" | "consolidating" | "resolved" | "postponed" | "dismissed" | "archived";

export type ExtractStatusPatch =
  | "resolved" | "open" | "postponed" | "dismissed" | "archived" | "reading" | "carded" | "consolidating";

declare global {
  interface Window {
    workflowAPI?: {
      create: (payload: unknown) => Promise<{ id: string }>;
      listDue: () => Promise<unknown[]>;
      listAll: () => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      postpone: (id: string) => Promise<unknown>;
      postponeDays: (id: string, days: number) => Promise<unknown>;
      advance: (id: string, now?: number) => Promise<unknown>;
      update: (id: string, patch: unknown) => Promise<unknown>;
      setPriority: (id: string, priority: number) => Promise<unknown>;
      setStatus: (id: string, status: string, detail?: unknown, opType?: string) => Promise<unknown>;
      remove: (id: string) => Promise<unknown>;
      batch: (op: string, ids: string[], payload?: unknown) => Promise<unknown>;
      switchEngine: (to: string, from?: string) => Promise<unknown>;
      rerankNow: () => Promise<{ ok: boolean; usedAI?: boolean; count?: number; reason?: string; issues?: unknown[] }>;
    };
    limitsAPI?: {
      usage: (now?: number) => Promise<unknown>;
      state: (now?: number) => Promise<unknown>;
      validate: (patch: unknown) => Promise<unknown>;
    };
    undoAPI?: { last: () => Promise<unknown>; info: () => Promise<unknown> };
  }
}

export interface DueTopic {
  id: string;
  contentMarkdown: string;
  priority: number;
  topicNextAt: number;
  intervalDays: number;
  docTitle: string;
  parentType: string;
  depth: number;
  status?: ExtractStatus | string;
  aFactor?: number;
  postponeCount?: number;
  processCount?: number;
  prioritySource?: "book" | "user" | string;
  /** v48.22（D58 §6.8-6）：所属书架条目（按书范围会话与浏览器分组用） */
  libraryItemId?: string | null;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string; anchorRatio?: number } | null;
}

export interface ExtractDetail extends DueTopic {
  documentId: string;
  parentExtractId?: string;
  chain: string[];
  createdAt: number;
}

export interface ExtractInput {
  parentType: "document" | "extract";
  parentId: string;
  documentId: string;
  contentMarkdown: string;
  priority?: number;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string; anchorRatio?: number } | null;
}

export interface ExtractDailyUsage {
  learningDayStart: number;
  newCards: number;
  cardReviews: number;
  newExtracts: number;
  extractReviews: number;
}

/** 批量可用的操作（与 db.js BATCH_OPS 一致，禁自造第三套命名） */
export type ExtractBatchOp = "postpone" | "postponeDays" | "set_priority" | "set_status" | "delete";

export interface ReadingWorkflowProvider {
  /** 引擎标识＝持久化值（§4.2-9） */
  name: ExtractEngine;
  create(input: ExtractInput): Promise<{ id: string }>;
  getDueTopics(): Promise<DueTopic[]>;
  /** 全量摘录（浏览器统一数据源；含已毕业/已归档，便于管理与召回） */
  getAllTopics(): Promise<DueTopic[]>;
  getTopic(id: string): Promise<ExtractDetail | null>;
  /** 按算法推迟（间隔 × a_factor，封顶 180 天） */
  postpone(id: string): Promise<void>;
  /** 用户指定天数推迟（沉浸式页「推迟」按钮；覆盖式） */
  postponeDays(id: string, days: number): Promise<void>;
  /** 读后推进（「下一条」）：间隔 ×= a_factor，process_count++ */
  advance(id: string, now?: number): Promise<void>;
  /** 改正文（与闪卡一样可内联编辑） */
  updateContent(id: string, contentMarkdown: string): Promise<void>;
  setPriority(id: string, priority: number): Promise<void>;
  /** 状态变更：毕业（resolved）/ 召回（open）/ 搁置 / 归档 */
  setStatus(id: string, status: ExtractStatusPatch, detail?: Record<string, unknown>, opType?: string): Promise<void>;
  graduate(id: string): Promise<void>;
  ungraduate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  batch(op: ExtractBatchOp, ids: string[], payload?: { days?: number; priority?: number; status?: ExtractStatusPatch }): Promise<unknown>;
  /** 切换推送引擎（无损：私有子空间互不覆盖，往返逐字段等值） */
  switchEngine(to: ExtractEngine): Promise<void>;
  /** 引擎私有状态快照（serializeState，§4.2-9） */
  serializeState(): Promise<{ engine: ExtractEngine }>;
}

/** 生效引擎的读写口（settings.app.extracts.engine；非法值回落默认） */
export async function readExtractEngine(): Promise<ExtractEngine> {
  const layer = await settingsStore.get<Record<string, unknown>>("app", "extracts", {});
  const v = layer && typeof layer === "object" ? layer.engine : undefined;
  return typeof v === "string" && EXTRACT_ENGINES.includes(v as ExtractEngine)
    ? (v as ExtractEngine)
    : DEFAULT_EXTRACT_ENGINE;
}

function call<K extends keyof NonNullable<Window["workflowAPI"]>>(
  method: K,
  ...args: Parameters<NonNullable<Window["workflowAPI"]>[K]>
): Promise<unknown> {
  const api = window.workflowAPI;
  if (!api) throw new Error("API 不可用");
  return (api[method] as (...a: unknown[]) => Promise<unknown>)(...args);
}

const sm19Provider: ReadingWorkflowProvider = {
  name: "sm19-default",
  async create(input) {
    return (await call("create", input)) as { id: string };
  },
  async getDueTopics() {
    if (!window.workflowAPI) return [];
    return (await window.workflowAPI.listDue()) as DueTopic[];
  },
  async getAllTopics() {
    if (!window.workflowAPI) return [];
    return (await window.workflowAPI.listAll()) as DueTopic[];
  },
  async getTopic(id) {
    if (!window.workflowAPI) return null;
    return (await window.workflowAPI.get(id)) as ExtractDetail | null;
  },
  async postpone(id) {
    await window.workflowAPI?.postpone(id);
  },
  async postponeDays(id, days) {
    await call("postponeDays", id, days);
  },
  async advance(id, now) {
    await call("advance", id, now);
  },
  async updateContent(id, contentMarkdown) {
    await call("update", id, { contentMarkdown });
  },
  async setPriority(id, priority) {
    await call("setPriority", id, priority);
  },
  async setStatus(id, status, detail, opType) {
    await call("setStatus", id, status, detail, opType);
  },
  async graduate(id) {
    await call("setStatus", id, "resolved", undefined, "graduate");
  },
  async ungraduate(id) {
    await call("setStatus", id, "open", undefined, "ungraduate");
  },
  async remove(id) {
    await call("remove", id);
  },
  async batch(op, ids, payload) {
    return call("batch", op, ids, payload);
  },
  async switchEngine(to) {
    await call("switchEngine", to);
  },
  async serializeState() {
    return { engine: await readExtractEngine() };
  }
};

export const readingWorkflow: ReadingWorkflowProvider = sm19Provider;

/** 只读用量（§6.8-5；纯派生、零写路径） */
export async function getLimitsUsage(now?: number): Promise<ExtractDailyUsage | null> {
  if (!window.limitsAPI) return null;
  return (await window.limitsAPI.usage(now)) as ExtractDailyUsage;
}

/** 手动跑一次 AI 重排（E1；实验引擎生效时才有意义；无 Key 会如实返回 reason） */
export async function rerankExtractsNow(): Promise<{ ok: boolean; usedAI?: boolean; count?: number; reason?: string }> {
  if (!window.workflowAPI?.rerankNow) return { ok: false, reason: "API 不可用" };
  return (await window.workflowAPI.rerankNow()) as { ok: boolean; usedAI?: boolean; count?: number; reason?: string };
}

export interface UndoInfo {
  available: boolean;
  kind: "card_grade" | "extract_op" | null;
  rating?: string | null;
  opType?: string | null;
  count?: number;
  source?: "legacy";
}

/** 跨类撤销（§6.8-7）：Ctrl+Z 撤销最近一次操作——卡片评分或摘录操作由 journal 决定 */
export const undoApi = {
  async last(): Promise<{ ok: boolean; kind?: string; reason?: string; count?: number; opType?: string | null }> {
    if (!window.undoAPI) return { ok: false, reason: "API 不可用" };
    return (await window.undoAPI.last()) as { ok: boolean; kind?: string; reason?: string };
  },
  async info(): Promise<UndoInfo> {
    if (!window.undoAPI) return { available: false, kind: null };
    return (await window.undoAPI.info()) as UndoInfo;
  }
};
