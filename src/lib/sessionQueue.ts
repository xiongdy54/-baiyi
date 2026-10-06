// v48.22（D58）：会话队列 / 每日上限 / 跨类撤销的渲染层客户端。
// 队列口径唯一在 db 侧（§4.2-26 computeSessionQueue）；本模块只做类型化封装与默认值，
// 禁止在组件内自行归并卡片与摘录（§4.2-26 口径唯一精神）。
import { settingsStore } from "./settings";
import type { DueTopic, ExtractEngine, ExtractStatusPatch } from "./readingWorkflow";

export type InterleaveMode = "quota-1-4" | "by-due";
export const INTERLEAVE_MODES: InterleaveMode[] = ["quota-1-4", "by-due"];

export interface Limits {
  newCardsPerDay: number;
  cardReviewsPerDay: number;
  newExtractsPerDay: number;
  extractReviewsPerDay: number;
  ignoreReviewLimitForNew: boolean;
}

export const LIMIT_DEFAULTS: Limits = {
  newCardsPerDay: 20,
  cardReviewsPerDay: 200,
  newExtractsPerDay: 10,
  extractReviewsPerDay: 50,
  ignoreReviewLimitForNew: false
};

export interface LimitsState {
  usage: { learningDayStart: number; newCards: number; cardReviews: number; newExtracts: number; extractReviews: number };
  limits: Limits;
  remaining: { newCards: number; cardReviews: number; newExtracts: number; extractReviews: number };
  newBlocked: boolean;
  learningDayStart: number;
}

/** 复习页顶栏三档计数（今日可用口径；口径唯一在 db 侧 computeCardCounts） */
export interface CardCounts {
  new: number;
  learning: number;
  review: number;
}

/** 取三档计数（同队列预算口径；scope 与队列同传，保证「还能刷多少」与队列一致） */
export async function fetchCardCounts(scope?: unknown): Promise<CardCounts> {
  const api = (window as unknown as { sessionAPI?: { counts?: (now?: number, opts?: unknown) => Promise<CardCounts> } }).sessionAPI;
  const r = await api?.counts?.(Date.now(), scope ? { scope } : {});
  return { new: Number(r?.new) || 0, learning: Number(r?.learning) || 0, review: Number(r?.review) || 0 };
}

export interface SessionItem {
  kind: "card" | "extract";
  id: string;
  card?: unknown;
  extract?: DueTopic;
}

export interface SessionQueue {
  items: SessionItem[];
  cards: Array<Record<string, unknown>>;
  extracts: DueTopic[];
  deferred: Array<Record<string, unknown>>;
  damaged: Array<Record<string, unknown>>;
  blocked: { cards: Array<Record<string, unknown>>; extracts: DueTopic[] };
  mergeIntoReview: boolean;
  interleave: InterleaveMode;
  scope: ScopeFilter | null;
  limits: Limits;
  usage: LimitsState["usage"];
  remaining: LimitsState["remaining"];
  newBlocked: boolean;
  now: number;
}

/** 复习范围（筛选牌组）：结构化过滤 + 可选上限覆写（§6.8-5） */
export interface ScopeFilter {
  bookItemIds?: string[];
  /** v48.61（D105）：标签条件（多值 OR、层级前缀语义同 §6.8-6 tag:；卡片行 tags_json / 摘录行 tag_json） */
  tags?: string[];
  /** v48.61（D105）：知识点条件（仅闪卡行命中；KnowledgeBase 归并族展开在主进程 applyScope） */
  kpIds?: string[];
  kinds?: Array<"card" | "extract">;
  limits?: Partial<Limits>;
}

declare global {
  interface Window {
    sessionAPI?: { queue: (now?: number, opts?: unknown) => Promise<unknown> };
  }
}

/** 会话队列（唯一入口；组件不得自行拼装卡片与摘录） */
export async function fetchSessionQueue(opts?: {
  now?: number;
  mergeIntoReview?: boolean;
  interleave?: InterleaveMode;
  scope?: ScopeFilter | null;
}): Promise<SessionQueue | null> {
  if (!window.sessionAPI) return null;
  const res = (await window.sessionAPI.queue(opts?.now, {
    mergeIntoReview: opts?.mergeIntoReview,
    interleave: opts?.interleave,
    scope: opts?.scope ?? null
  })) as SessionQueue;
  return res;
}

/** 摘要（复习页节奏提示：本轮还剩多少、被上限拦下多少） */
export function sessionSummary(q: SessionQueue | null): string {
  if (!q) return "";
  const blocked = q.blocked.cards.length + q.blocked.extracts.length;
  return `${q.items.length} 条待处理${blocked > 0 ? ` · ${blocked} 条未放行` : ""}`;
}

/** 每日上限状态（§6.8-5） */
export async function fetchLimitsState(now?: number): Promise<LimitsState | null> {
  if (!window.limitsAPI || !window.limitsAPI.state) return null;
  return (await window.limitsAPI.state(now)) as LimitsState;
}

/** 保存前校验（硬边界；主进程 settings:set 另有一道兜底拒写） */
export async function validateLimits(patch: Partial<Limits>): Promise<{ ok: boolean; errors: string[]; advisory: string[] }> {
  if (!window.limitsAPI || !window.limitsAPI.validate) return { ok: true, errors: [], advisory: [] };
  return (await window.limitsAPI.validate(patch)) as { ok: boolean; errors: string[]; advisory: string[] };
}

export const EXTRACT_ENGINE_LABEL: Record<ExtractEngine, string> = {
  "sm19-default": "SuperMemo 传统推送（默认）",
  "ai-next-extract": "AI 推送（实验功能 · 早期开发阶段）"
};

export const EXTRACT_STATUS_LABEL: Record<string, string> = {
  open: "待处理",
  reading: "在读",
  carded: "已制卡",
  consolidating: "巩固中",
  resolved: "已毕业",
  postponed: "已推迟",
  dismissed: "不再关心",
  archived: "已归档"
};

/** 摘录状态标签（未知状态按「待处理」显示，与队列口径一致） */
export function extractStatusLabel(status?: string | null): string {
  return EXTRACT_STATUS_LABEL[String(status || "open")] || EXTRACT_STATUS_LABEL.open;
}

/** 写回设置（摘录开关 / 上限）；limits 走主进程硬边界校验，失败会 reject */
export const extractSettings = {
  async read(): Promise<{ mergeIntoReview: boolean; interleave: InterleaveMode; engine: ExtractEngine }> {
    const layer = await settingsStore.get<Record<string, unknown>>("app", "extracts", {});
    const l = layer && typeof layer === "object" ? layer : {};
    return {
      mergeIntoReview: l.mergeIntoReview === true,
      interleave: INTERLEAVE_MODES.includes(l.interleave as InterleaveMode) ? (l.interleave as InterleaveMode) : "quota-1-4",
      engine: l.engine === "ai-next-extract" ? "ai-next-extract" : "sm19-default"
    };
  },
  async write(patch: { mergeIntoReview?: boolean; interleave?: InterleaveMode; engine?: ExtractEngine }): Promise<void> {
    const layer = await settingsStore.get<Record<string, unknown>>("app", "extracts", {});
    await settingsStore.set("app", "extracts", { ...(layer && typeof layer === "object" ? layer : {}), ...patch });
  },
  async readLimits(): Promise<Limits> {
    const raw = await settingsStore.get<Record<string, unknown>>("app", "limits", {});
    const l = raw && typeof raw === "object" ? raw : {};
    const pick = (k: keyof Limits) => {
      const v = Number((l as Record<string, unknown>)[k]);
      return Number.isInteger(v) && v >= 0 && v <= 9999 ? v : (LIMIT_DEFAULTS[k] as number);
    };
    return {
      newCardsPerDay: pick("newCardsPerDay"),
      cardReviewsPerDay: pick("cardReviewsPerDay"),
      newExtractsPerDay: pick("newExtractsPerDay"),
      extractReviewsPerDay: pick("extractReviewsPerDay"),
      ignoreReviewLimitForNew: (l as Record<string, unknown>).ignoreReviewLimitForNew === true
    };
  },
  async writeLimits(next: Limits): Promise<void> {
    await settingsStore.set("app", "limits", next);
  }
};

/** 毕业 / 召回（§6.8-2 动作映射） */
export async function graduateExtract(id: string): Promise<void> {
  await window.workflowAPI?.setStatus(id, "resolved", undefined, "graduate");
}

export async function ungraduateExtract(id: string): Promise<void> {
  await window.workflowAPI?.setStatus(id, "open", undefined, "ungraduate");
}

export type { ExtractStatusPatch, ExtractEngine };
