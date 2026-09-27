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
      /** v48.23（D61 §6.8-11）：多段选择的集合运算（主进程算；见本文件 resolveSpanSet） */
      spanSet: (current: unknown, incoming: unknown, opts: unknown) => Promise<unknown>;
      chain: (id: string) => Promise<Array<{ id: string; text: string; depth: number }>>;
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
  contextRef?: ExtractContextRef | null;
}

/** 摘录/卡片的上下文引用（§4.2-16 上下文引用）。层级身份（规格 §1.1）：parentExtractId / rootExtractId */
export interface ExtractContextRef {
  documentId?: string;
  extractId?: string;
  anchorText?: string;
  anchorRatio?: number;
  /** 子摘录＝父摘录 id；根摘录无此键 */
  parentExtractId?: string;
  /** 根摘录＝自身 id；子摘录＝继承父的（缺省回退父 id） */
  rootExtractId?: string;
  /**
   * 子摘录在**父卡 `content_markdown`** 里的引文范围（`[{start,end},…]`，多段选择即多组；工单 ②）。
   * 子卡「跳转原文」回父卡时高亮的就是它（D62/R13）；无此键＝本批之前的老数据。
   */
  parentRange?: Array<{ start: number; end: number }>;
}

export interface ExtractDetail extends DueTopic {
  documentId: string;
  parentExtractId?: string;
  chain: string[];
  createdAt: number;
  /** db.getExtract 读回的是**原始 JSON 字符串**（contextRef 未解析），面包屑/查看态按需解析 */
  contextRefJson?: string | null;
  /** 同上：该条摘录自己的高亮范围（原始 JSON 字符串，null＝从未标过） */
  quoteRangeJson?: string | null;
}

/**
 * contextRef 的安全解析（db 读侧给的是 JSON 字符串；坏 JSON/空值一律 null，不抛）。
 * 面包屑落点与子摘录的 rootExtractId 继承都从它取（规格 §1.1）。
 */
export function parseContextRef(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface ExtractInput {
  parentType: "document" | "extract";
  parentId: string;
  documentId: string;
  contentMarkdown: string;
  priority?: number;
  contextRef?: ExtractContextRef | null;
  /**
   * v48.23（D61 §6.8-11）：多段不相邻选择的原始段（`{text, rects?}`，DOM 顺序即落库顺序）。
   * **渲染层只采集、不装配**——文本与 `quote_range_json` 由主进程 buildSpanPayload 算（spans 优先）。
   * 单段选择不传（既有路径逐字节不变）；≥2 段时传，落库为「一条批注、多段区间、多组矩形」。
   */
  spans?: ExtractSpan[];
  /** 批 4（规格 R35）：分族——`highlight`＝纯高亮（不进队列/不计上限）；缺省 ＝ `extract`（摘录） */
  kind?: "highlight" | "extract";
  /** 批 4（R8）：读者的批注文字（可空＝只标不评） */
  comment?: string | null;
  /** 批 4（R33）：批注色板 id（或 `#hex`），与文中高亮/角标同色 */
  annotationColor?: string | null;
  /**
   * 批 4 Task 10（规格 §3.4）：摘录页的批注/高亮锚在**当前卡正文**里的字符区间
   * （单段路径用；多段走 `spans`，由主进程装配，二者不同时给）。
   * 摘录页写批注时用它标出「批的是这句」；阅读器路径不传。
   */
  quoteRange?: Array<{ start: number; end: number }>;
}

/** 一段选区的原始采集物（rects = 宿主视口坐标的包围盒，可缺省） */
export interface ExtractSpan {
  text: string;
  rects?: { x: number; y: number; w: number; h: number }[];
}

/** spanSet 的返回：由主进程 updateSpanSet + buildSpanPayload 装配（text 与落库文本同源） */
export interface SpanSetResult {
  spans: ExtractSpan[];
  action: "replace" | "append" | "remove" | "none";
  text: string;
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
  /** v48.23（D61 §6.8-11）：层级链——自根到当前逐级 {id, text, depth}，面包屑点击用它拿 id */
  getChain(id: string): Promise<Array<{ id: string; text: string; depth: number }>>;
  /** 按算法推迟（间隔 × a_factor，封顶 180 天） */
  postpone(id: string): Promise<void>;
  /** 用户指定天数推迟（沉浸式页「推迟」按钮；覆盖式） */
  postponeDays(id: string, days: number): Promise<void>;
  /** 读后推进（「下一条」）：间隔 ×= a_factor，process_count++ */
  advance(id: string, now?: number): Promise<void>;
  /** 改正文（与闪卡一样可内联编辑） */
  updateContent(id: string, contentMarkdown: string): Promise<void>;
  /** 批 4（Task 3）：批注文字 / 颜色 / 分族可写（清空 comment 即删批注；主进程裁决归一） */
  updateAnnotations(id: string, patch: { comment?: string | null; annotationColor?: string | null; kind?: "highlight" | "extract" }): Promise<void>;
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

/**
 * 多段选择的集合运算（§6.8-11 / D61）：把「当前已积累的 spans + 本次新选区 + 修饰键」交给主进程，
 * 由 electron/annotationRange.js 的 `updateSpanSet` 决定 replace/append/remove，并给出拼接文本。
 * **渲染层不复制该逻辑**（沙箱 preload 不能 require 本地模块，模块共享的唯一正解＝过桥由主进程算）。
 */
export async function resolveSpanSet(
  current: ExtractSpan[],
  incoming: ExtractSpan,
  modifier: boolean
): Promise<SpanSetResult> {
  return (await call("spanSet", current, incoming, { modifier })) as SpanSetResult;
}

/** 多段选择的修饰键（§7.4 `app.multiSelectKey`）：默认 Ctrl，macOS 建议 Meta；非法值回落平台默认。 */
export const MULTI_SELECT_KEYS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
export type MultiSelectKey = (typeof MULTI_SELECT_KEYS)[number];
export const DEFAULT_MULTI_SELECT_KEY: MultiSelectKey =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Meta" : "Ctrl";

export async function readMultiSelectKey(): Promise<MultiSelectKey> {
  const v = await settingsStore.get<string>("app", "multiSelectKey", DEFAULT_MULTI_SELECT_KEY);
  return (MULTI_SELECT_KEYS as readonly string[]).includes(v) ? (v as MultiSelectKey) : DEFAULT_MULTI_SELECT_KEY;
}

/** 键名 → 指针事件的修饰位（contentPointerUp 载荷里的 ctrlKey/altKey/shiftKey/metaKey） */
export function modifierFlagOf(
  key: MultiSelectKey,
  ev: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }
): boolean {
  if (key === "Alt") return Boolean(ev.altKey);
  if (key === "Shift") return Boolean(ev.shiftKey);
  if (key === "Meta") return Boolean(ev.metaKey);
  return Boolean(ev.ctrlKey);
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
  async getChain(id) {
    if (!window.workflowAPI) return [];
    return (await window.workflowAPI.chain(id)) as Array<{ id: string; text: string; depth: number }>;
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
  async updateAnnotations(id, patch) {
    await call("update", id, patch);
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
