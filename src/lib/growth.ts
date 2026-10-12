// v48.85（D129，B1）：M13 成长反馈渲染层封装——类型契约（设计稿 §3.1）+ `window.growthAPI` 声明（§3.4）
// + growthApi 取数封装（失败静默降级，主进程异常已降级 {enabled:false}）+ useGrowthOverview 防抖 hook（§5.3）。
// 纪律：本文件**零判定逻辑**——口径（首达/跨越/康复、阈值、tier、投放面）唯一居所是 electron/growth.js，
// 渲染层只消费其经 IPC 的输出（§4.2-22 口径唯一化）；文案在 growthStrings.ts（§6.6.1 唯一事实来源）。
import { useCallback, useEffect, useRef, useState } from "react";
import { eventBus } from "./eventbus";
import { settingsStore } from "./settings";
import { DEFAULT_GROWTH_FEEDBACK, normalizeGrowthFeedback } from "./growthSettings";

// 事件类型封闭枚举（§6.6.1 全表；GF-1 只产出 tier 2/3 行，L0/L1 为 GF-2 预留、判定阻塞于缺口 G1）。
// 取消项（"consolidate-21d" / "learning-graduate"）不是枚举成员——判定函数显式排除（electron/growth.js 头注释）。
export type GrowthEventType =
  | "transfer-first" | "application-first" | "kp-strong" | "kp-functional" // L0（GF-2）
  | "structure-link" | "domain-entry"                                       // L1（GF-2）
  | "material" | "group" | "leech-recovery" | "relearning-recovery" | "retention-180" // L2（GF-1）
  | "retention-60";                                                         // L3（GF-1，仅汇总）

// 证据链（可追溯，§4.17-4③/§4.17-7；跳转原文锚有则给）
export interface GrowthEventEvidence {
  cardIds?: string[];
  cardFronts?: string[];
  libraryItemId?: string;
  docTitle?: string;
  documentId?: string;
  anchorText?: string;
  groupSize?: number;
  stabilityDays?: number;
  lapses?: number;
}

// 命中对象（§3.1 GrowthEventHit；key = `${type}:${entityId}:${dimension}`，§4.17-6①）
export interface GrowthEventHit {
  key: string;
  type: GrowthEventType;
  tier: 0 | 1 | 2 | 3;               // 提示优先级 = tier（§4.17-5）
  entityId: string;
  entityLabel: string;               // 书名 / 卡正面摘要（≤40 字）/ 组大小
  dimension: string;                 // material: "half"|"full"；retention: "60"|"180"；其余见设计稿 §3.2
  triggerSeq: number;                // 触发跨越的 review_seq（防回灌的严格等值判据，§4.17-6③）
  triggerAt: number;                 // 该日志 reviewed_at
  surface: ("toast" | "summary")[];  // §6.6.1 投放面列的机读形式（L3 = ["summary"]）
  evidence: GrowthEventEvidence;
}

// L2 单日折叠条目（foldSameDay 输出；hits = 被折叠的完整命中，供 G-9 折叠行展开明细）
export interface GrowthFoldEntry {
  type: GrowthEventType;
  count: number;
  dayStart: number;
  hits: GrowthEventHit[];
}

export interface GrowthTotals { l0: number; l1: number; l2: number }

// Territory 聚合行（buildTerritory 输出；四段之和 = total，coverage = consolidated/total）
export interface GrowthTerritoryRow {
  kind: "book" | "domain";
  id: string;
  label: string;
  total: number;
  new: number;
  learning: number;
  reviewing: number;
  consolidated: number;
  coverage: number;
  crossedHalf: boolean;
  crossedFull: boolean;
}

// 三条只读通道的返回形状（§3.4；设置关闭/主进程异常 = {enabled:false} 降级形状——渲染层须按该形状静默零渲染）
export type GrowthAfterReviewResult =
  | { enabled: false }
  | { enabled: true; toast: GrowthEventHit | null; others: GrowthEventHit[] };

export type GrowthSessionSummaryResult =
  | { enabled: false }
  | { enabled: true; fromTs: number; hits: GrowthEventHit[]; folded: GrowthFoldEntry[] };

export type GrowthOverviewResult =
  | { enabled: false }
  | {
      enabled: true;
      now: number;
      cutoffHour: number;
      recentEvents: GrowthEventHit[];   // L0–L2 档案（triggerSeq 倒序，limit 截断）
      totals: GrowthTotals;
      territory: { rows: GrowthTerritoryRow[] };
      knowledge: null;                  // GF-2 预留（§3.5），契约修订前恒为 null
    };

export type GrowthOverviewEnabled = Extract<GrowthOverviewResult, { enabled: true }>;

// `window.growthAPI`（照 stats.ts 的 declare global 先例；preload 形态见 §3.4）
declare global {
  interface Window {
    growthAPI?: {
      afterReview: (cardId: string, now?: number) => Promise<unknown>;
      sessionSummary: (fromTs: number, now?: number) => Promise<unknown>;
      overview: (opts?: { limit?: number }, now?: number) => Promise<unknown>;
    };
  }
}

const DISABLED = { enabled: false } as const;

// limit 归一（取数封装与 useGrowthOverview 同规共用）：非有限值 → 默认 30，下限钳 1。
function normalizeOverviewLimit(opts?: { limit?: number }): number {
  return opts && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit as number)) : 30;
}

// overview 在途请求表（键见 growthApi.overview 注）：settle 即删，永不持有已完成/已失败条目。
const overviewInflight = new Map<string, Promise<GrowthOverviewResult>>();

// 取数封装：API 未注入 / IPC 抛错 → 一律返回 {enabled:false}（消费端按降级形状静默零渲染）。
// 调用方（评分路径）fire-and-forget 使用，本封装自身不抛（§4.17-3：派生失败绝不影响评分）。
export const growthApi = {
  async afterReview(cardId: string, now?: number): Promise<GrowthAfterReviewResult> {
    if (!window.growthAPI) return DISABLED;
    try {
      return (await window.growthAPI.afterReview(cardId, now)) as GrowthAfterReviewResult;
    } catch {
      return DISABLED;
    }
  },
  async sessionSummary(fromTs: number, now?: number): Promise<GrowthSessionSummaryResult> {
    if (!window.growthAPI) return DISABLED;
    try {
      return (await window.growthAPI.sessionSummary(fromTs, now)) as GrowthSessionSummaryResult;
    } catch {
      return DISABLED;
    }
  },
  // 在途共享（§8 R2 复审加固）：overview 是全库聚合，同一时刻多个调用方（双 widget 实例各自挂载）
  // 参数全同即共享同一在途 promise，不重复打 IPC。键 = 归一 limit + now（参数全同才是同一请求）；
  // 完成/失败即清在途引用——失败不缓存，下次调用重发。never-throws 契约不变（失败仍降级 DISABLED）。
  overview(opts?: { limit?: number }, now?: number): Promise<GrowthOverviewResult> {
    if (!window.growthAPI) return Promise.resolve(DISABLED);
    const key = `${normalizeOverviewLimit(opts)}|${now === undefined ? "" : now}`;
    const hit = overviewInflight.get(key);
    if (hit) return hit;
    const p = window.growthAPI.overview(opts, now).then(
      (r) => { overviewInflight.delete(key); return r as GrowthOverviewResult; },
      () => { overviewInflight.delete(key); return DISABLED; }
    );
    overviewInflight.set(key, p);
    return p;
  }
};

// 设置读侧（§5.1 零渲染零计算短路）：enabled=false 时评分路径**完全不调用** growth:afterReview。
// 每次调用现读（不缓存 promise）——设置切换后下一次评分即生效（G-5 开关即时生效断言依赖）。
export async function readGrowthFeedbackEnabled(): Promise<boolean> {
  try {
    const v = await settingsStore.get<unknown>("app", "growthFeedback", DEFAULT_GROWTH_FEEDBACK);
    return normalizeGrowthFeedback(v).enabled;
  } catch {
    return true; // 读不到按默认开（与写侧回落同规；IPC 失败不该吞掉提示能力）
  }
}

// ---------- useGrowthOverview（§5.3：模块级缓存 stale-while-revalidate + 事件驱动防抖刷新） ----------

// 防抖 ≥500ms（B1 验收）；取 §5.3 定稿 800ms——聚合视图防抖（§4.17-6⑥：不叠加 stats:overview 的
// 全量重算链，growth 数据独立缓存独立刷新）。
const GROWTH_OVERVIEW_DEBOUNCE_MS = 800;

// 模块级缓存（照 Dashboard dashCache 先例）：切页卸载/重挂首帧直接渲染上次数据，后台静默拉最新。
const growthOverviewCache: { data: GrowthOverviewEnabled | null } = { data: null };

export function useGrowthOverview(opts?: { limit?: number }): { data: GrowthOverviewEnabled | null } {
  const limit = normalizeOverviewLimit(opts);
  const [data, setDataState] = useState<GrowthOverviewEnabled | null>(growthOverviewCache.data);
  // 缓存写入收敛到 setData：enabled=false（设置关闭）时清缓存回落空态——关闭即零渲染（G-11 断言依赖）
  const setData = useCallback((d: GrowthOverviewEnabled | null) => {
    growthOverviewCache.data = d;
    setDataState(d);
  }, []);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;    // 卸载守卫：组件卸载后不发 setState（B1 验收，Dashboard 先例）
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const r = await growthApi.overview({ limit });
        if (!alive) return;
        if (r.enabled) setData(r);
        else setData(null); // 设置关闭 / 主进程降级：清缓存，widget 回落静态空态
      } catch {
        if (alive) setData(null);
      } finally {
        fetching = false;
      }
    };
    void load();
    // 事件驱动防抖刷新（cards/changed | library/changed → 800ms 合并；§5.3 数据获取节）
    const schedule = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void load();
      }, GROWTH_OVERVIEW_DEBOUNCE_MS);
    };
    const off1 = eventBus.on("cards/changed", schedule);
    const off2 = eventBus.on("library/changed", schedule);
    return () => {
      alive = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      off1();
      off2();
    };
  }, [limit, setData]);

  return { data };
}
