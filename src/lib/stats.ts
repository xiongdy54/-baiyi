// 统计聚合 API 封装（stats:overview 一次返回全部图表数据；只读，不碰调度状态）
declare global {
  interface Window {
    statsAPI?: {
      overview: () => Promise<unknown>;
      timeline?: (opts: { endDay?: number; days?: number }) => Promise<unknown>;
    };
    readingAPI?: { addEvent: (itemId: string, charPos: number) => Promise<boolean> };
  }
}

export interface StatsKpi {
  dueToday: number;
  completedToday: number;
  pendingToday: number;
  reviewedToday: number;
  streak: number;
  minutesToday: number;
}

export interface StatsOverview {
  kpi: StatsKpi;
  heatDays: { date: number; count: number; minutes: number }[];
  domainMain: { code: string; label: string; leaf: string; count: number }[];
  domainDetail: { code: string; label: string; count: number }[];
  unclassified: number;
  ratings: { rating: string; count: number }[];
  durationByField: {
    code: string; label: string; count: number;
    min: number; q1: number; median: number; q3: number; max: number;
    outliers: number[];
  }[];
  /** 5 秒一箱 × 12 箱（0–60 秒，末箱含 ≥55 秒）；已剔除 >10 分钟的「卡开着人走了」 */
  durationBins: number[];
  durationMedianMs: number;
  durationP90Ms: number;
  /** 近 90 天新建的卡：新建 ⊇ 已开始学 ⊇ 长期复习中 ⊇ 已巩固（稳定度 >21 天） */
  funnel: { drafts: number; entered: number; created: number; firstLearned: number; reviewing: number; consolidated: number };
  /** 近 26 周新建卡按「UDC 主类 × 来源书」库内聚合；main=null 即未分类 */
  sourceBooks: { book: string; main: string | null; count: number }[];
  /** counts/ranks 与 domainRankMonths 一一对应；rank=0 表示当月没有复习 */
  domainRank: { code: string; label: string; counts: number[]; ranks: number[] }[];
  domainRankMonths: { key: string; month: number }[];
  queueFlow: { carriedOver: number; overdue: number; newCards: number; completed: number; skipped: number; remaining: number };
  /** 未来 14 个学习日（含今天）每天到期的「已学过」的卡数；新卡不计 */
  dueForecast: number[];
  /** 近 90 天，最后一项是今天 */
  readingDays: { date: number; chars: number }[];
  /** 星期一…日 × 0–23 点 */
  rhythmGrid: number[][];
  rhythmHours: { count: number; again: number }[];
}

// ───────────── 一日时间轴（stats:timeline） ─────────────
export type TimelineKind = "read" | "extract" | "review" | "card" | "journal";

export interface TimelineBlock {
  kind: TimelineKind;
  start: number;
  end: number;
  /** 至少 30 秒（瞬时事件也要有可见宽度） */
  durationMs: number;
  count: number;
  chars: number;
  again: number;
  hl: number;
  sub: { card: number; extract: number };
  titles: string[];
}

export interface TimelineTotals { blocks: number; count: number; ms: number; chars: number; again: number }

export interface TimelineDay {
  /** 该学习日起点（ms） */
  date: number;
  blocks: TimelineBlock[];
  totals: Record<TimelineKind, TimelineTotals>;
  /** 全部块的并集时长 */
  activeMs: number;
  first: number | null;
  last: number | null;
  longestMs: number;
}

export interface StatsTimeline {
  now: number;
  cutoffHour: number;
  days: TimelineDay[];
}

export const TIMELINE_KINDS: TimelineKind[] = ["read", "extract", "review", "card", "journal"];

export const statsApi = {
  async overview(): Promise<StatsOverview | null> {
    if (!window.statsAPI) return null;
    return (await window.statsAPI.overview()) as StatsOverview;
  },
  /** endDay：任一落在目标学习日内的时间戳；days：含该日往前共几个学习日（1–31） */
  async timeline(opts: { endDay?: number; days?: number }): Promise<StatsTimeline | null> {
    if (!window.statsAPI?.timeline) return null;
    return (await window.statsAPI.timeline(opts)) as StatsTimeline;
  }
};

// 阅读进度事件上报（滚动停止 1s 后调用；去抖在调用方）
export const readingStats = {
  addEvent: async (itemId: string, charPos: number) => {
    if (!window.readingAPI) return;
    try {
      await window.readingAPI.addEvent(itemId, charPos);
    } catch {
      /* 统计埋点失败不影响阅读 */
    }
  }
};
