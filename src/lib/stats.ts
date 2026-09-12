// 统计聚合 API 封装（stats:overview 一次返回全部图表数据；只读，不碰调度状态）
declare global {
  interface Window {
    statsAPI?: { overview: () => Promise<unknown> };
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
  durationBins: number[];
  funnel: { drafts: number; entered: number; firstLearned: number; reviewing: number; consolidated: number };
  sourceCards: { book: string; domain: string | null }[];
  domainRank: { code: string; label: string; ranks: number[] }[];
  queueFlow: { carriedOver: number; overdue: number; newCards: number; completed: number; skipped: number; remaining: number };
  readingDays: { date: number; chars: number }[];
  rhythmGrid: number[][];
  rhythmEvents: { hour: number; again: boolean }[];
}

export const statsApi = {
  async overview(): Promise<StatsOverview | null> {
    if (!window.statsAPI) return null;
    return (await window.statsAPI.overview()) as StatsOverview;
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
