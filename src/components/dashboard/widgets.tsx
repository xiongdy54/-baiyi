// 统计组件注册表 — 数据选择（一数据多图型）与图型切换在这里集中定义
// 图表渲染全部来自 charts/charts.tsx（响应式像素布局）与 charts/Timeline.tsx（一日时间轴）。
// 兼容：老配置里存的旧 chart id 通过 ALIAS 映射到新图型，无需迁移设置；旧 id 若仍有对应图型则沿用同名 id。
import type { ReactNode } from "react";
import type { StatsOverview } from "../../lib/stats";
import {
  QueueProgress, StreakPanel, MinutesColumns,
  HeatCalendar, DailyColumns, WeekdayBars, CumulativeArea,
  TodayUnits, TodayRing,
  DomainBars, DomainTreemap, RatingBar,
  DurationHist, DurationRanges, FunnelBars, SourceBars,
  RhythmHours, RhythmGrid, RankBump, QueueLedger, DueForecast, ReadingHist
} from "../charts/charts";
import TimelineWidget from "../charts/Timeline";
// v48.85（D129 B4，§5.3）：成长反馈两 widget——Growth 层「成长记录」+ Territory 层「巩固疆域」。
// 自取数（useGrowthOverview 防抖 hook，Timeline 先例），不进 StatsOverview、不改 stats:overview 刷新链。
import GrowthEventsWidget from "./GrowthEventsWidget";
import TerritoryWidget from "./TerritoryWidget";
import { t } from "../../lib/i18n";

export type ChartMode = string; // 图型 id，如 "months" / "columns"

export interface WidgetDef {
  id: string;
  title: string;
  wide?: boolean;              // 建议通栏
  // v48.85（D129 §6.6.4/§5.3）：仪表盘四层归属（today=Activity 既有层；growth/capability/territory
  // 为成长反馈层）。缺省即 "today"——既有 12 组件定义未显式标注（本批禁改其定义，行为零变化）。
  layer?: "today" | "growth" | "capability" | "territory";
  // 从 overview 取本组件用到的数据键（设置页展示"可显示数据"用）
  dataKeys: string[];
  // dataKey → 显示名（缺省用 Dashboard 内置映射）
  dataLabels?: Record<string, string>;
  // dataKey → 该数据的可选图型（一个数据可切多种图）
  charts: Record<string, { id: ChartMode; label: string }[]>;
  defaultData: string;
  defaultChart: string;
  render: (o: StatsOverview, dataKey: string, chart: ChartMode, rnd: (i: number, k: number) => number) => ReactNode;
}

// 确定性伪随机（保留导出以兼容 Dashboard 的 render 签名）
export const rnd: Rng = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
type Rng = (i: number, k: number) => number;

// 旧图型 id → 新图型 id（老 settings 配置兼容；同 id 在不同组件下映射不同）
const ALIAS: Record<string, Record<string, string>> = {
  kpi: { numbers: "queuebar" },
  heatmap: { calendar: "months", barcode: "columns", "hairline-line": "cumulative", "hairline-area": "weekday" },
  today: { gauge: "units", dotfield: "divergence" },
  domains: { rows: "dots", rungs: "treemap" },
  ratings: { waffle: "ratingcol" },
  duration: { tickbox: "ranges", histogram: "freqpoly" },
  funnel: { hourglass: "unitfunnel" },
  sources: { colonnade: "sourcetree" },
  rhythm: { dotheat: "curves", radial: "clusters" },
  domainrank: { rankstrip: "slope" },
  queueflow: { waterfall: "ledger" },
  reading: { "hairline-area": "strips", "hairline-line": "rhist" }
};

// 把存量配置里的旧 chart id 归一化为新 id（找不到映射时原样返回）
export function normalizeChartId(widgetId: string, chartId: string): string {
  const a = ALIAS[widgetId];
  return (a && a[chartId]) || chartId;
}

// —— 领域分布的两种视图：UDC 主类汇总 / 二级明细 ——
function domainItems(o: StatsOverview, key: string): { label: string; count: number }[] {
  if (key === "domains-main") {
    const byMain = new Map<string, number>();
    for (const d of o.domainMain) byMain.set(d.label, (byMain.get(d.label) || 0) + d.count);
    const rows = [...byMain.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    if (o.unclassified > 0) rows.push({ label: t("未分类"), count: o.unclassified });
    return rows;
  }
  const rows = o.domainDetail.map((d) => ({ label: d.label, count: d.count }));
  if (o.unclassified > 0) rows.push({ label: t("未分类"), count: o.unclassified });
  return rows.sort((a, b) => b.count - a.count);
}

// —— 学习热力的时间范围档位（dataKey → 天数；heatDays 数据库固定给 26 周）——
const HEAT_RANGES: Record<string, number> = {
  "reviews-30d": 30, "reviews-60d": 60, "reviews-90d": 90,
  "reviews-120d": 120, "reviews-150d": 150, "reviews-26w": 182
};
const heatSlice = (o: StatsOverview, dk: string) =>
  o.heatDays.slice(-(HEAT_RANGES[dk] ?? 90)).map((d) => ({ date: d.date, value: d.count }));
const HEAT_KEYS = Object.keys(HEAT_RANGES);
// 图型 label 存 zh 键，渲染处（Dashboard chartOptions / 设置页）经 T() 翻译
const HEAT_CHARTS = [
  { id: "months", label: "日历热力" },
  { id: "columns", label: "日柱" },
  { id: "weekday", label: "星期剖面" },
  { id: "cumulative", label: "累计曲线" }
];

export const WIDGETS: WidgetDef[] = [
  {
    id: "kpi",
    title: "关键指标",
    dataKeys: ["kpi"],
    charts: {
      kpi: [
        { id: "queuebar", label: "今日进度" },
        { id: "streak", label: "连续学习" },
        { id: "minutes", label: "今日复习时长对照" }
      ]
    },
    defaultData: "kpi",
    defaultChart: "queuebar",
    render: (o, _dk, chart) => {
      const c = normalizeChartId("kpi", chart);
      if (c === "streak") return <StreakPanel streak={o.kpi.streak} heatDays={o.heatDays} />;
      if (c === "minutes") return <MinutesColumns kpi={o.kpi} heatDays={o.heatDays} />;
      return <QueueProgress kpi={o.kpi} />;
    }
  },
  {
    id: "timeline",
    title: "一日时间轴",
    wide: true,
    dataKeys: ["timeline-day", "timeline-week"],
    dataLabels: { "timeline-day": "单日明细", "timeline-week": "近 7 天" },
    charts: {
      "timeline-day": [{ id: "gantt", label: "甘特时间轴" }],
      "timeline-week": [{ id: "gantt", label: "甘特时间轴" }]
    },
    defaultData: "timeline-day",
    defaultChart: "gantt",
    render: (_o, dk) => <TimelineWidget mode={dk === "timeline-week" ? "week" : "day"} />
  },
  {
    id: "heatmap",
    title: "学习热力",
    wide: true,
    dataKeys: HEAT_KEYS,
    dataLabels: {
      "reviews-30d": "近 30 天", "reviews-60d": "近 60 天", "reviews-90d": "近 90 天",
      "reviews-120d": "近 120 天", "reviews-150d": "近 150 天", "reviews-26w": "近 26 周"
    },
    charts: Object.fromEntries(HEAT_KEYS.map((k) => [k, HEAT_CHARTS])),
    defaultData: "reviews-90d",
    defaultChart: "months",
    render: (o, dk, chart) => {
      const c = normalizeChartId("heatmap", chart);
      const days = heatSlice(o, dk);
      const empty = t("所选范围暂无复习记录");
      if (c === "columns") return <DailyColumns days={days} unit={t("张")} emptyMsg={empty} />;
      if (c === "weekday") return <WeekdayBars days={days} unit={t("张")} emptyMsg={empty} />;
      if (c === "cumulative") return <CumulativeArea days={days} unit={t("张")} emptyMsg={empty} />;
      return <HeatCalendar days={days} unit={t("张")} emptyMsg={empty} />;
    }
  },
  {
    id: "today",
    title: "今日完成度",
    dataKeys: ["today-progress"],
    charts: {
      "today-progress": [
        { id: "units", label: "方块格（1 格 = 1 张）" },
        { id: "divergence", label: "进度环" }
      ]
    },
    defaultData: "today-progress",
    defaultChart: "units",
    render: (o, _dk, chart) => (normalizeChartId("today", chart) === "divergence" ? <TodayRing kpi={o.kpi} /> : <TodayUnits kpi={o.kpi} />)
  },
  {
    id: "domains",
    title: "领域分布",
    dataKeys: ["domains-main", "domains-detail"],
    charts: {
      "domains-main": [{ id: "dots", label: "排行条形" }, { id: "treemap", label: "矩形树图" }],
      "domains-detail": [{ id: "dots", label: "排行条形" }, { id: "treemap", label: "矩形树图" }]
    },
    defaultData: "domains-main",
    defaultChart: "dots",
    render: (o, dk, chart) => {
      const items = domainItems(o, dk);
      return normalizeChartId("domains", chart) === "treemap"
        ? <DomainTreemap items={items} unit={t("卡")} />
        : <DomainBars items={items} unit={t("卡")} />;
    }
  },
  {
    id: "ratings",
    title: "评分构成",
    dataKeys: ["ratings-30d"],
    charts: { "ratings-30d": [{ id: "ratingcol", label: "占比条" }] },
    defaultData: "ratings-30d",
    defaultChart: "ratingcol",
    render: (o) => <RatingBar ratings={o.ratings} />
  },
  {
    id: "duration",
    title: "答题时长",
    dataKeys: ["duration-by-field", "duration-hist"],
    charts: {
      "duration-by-field": [{ id: "ranges", label: "领域对比" }],
      "duration-hist": [{ id: "freqpoly", label: "分布直方" }]
    },
    defaultData: "duration-hist",
    defaultChart: "freqpoly",
    render: (o, dk, chart) => {
      if (dk === "duration-by-field" || normalizeChartId("duration", chart) === "ranges") return <DurationRanges fields={o.durationByField} />;
      return <DurationHist bins={o.durationBins} medianMs={o.durationMedianMs} p90Ms={o.durationP90Ms} />;
    }
  },
  {
    id: "funnel",
    title: "卡片生命周期",
    dataKeys: ["funnel-90d"],
    charts: { "funnel-90d": [{ id: "unitfunnel", label: "逐级漏斗" }] },
    defaultData: "funnel-90d",
    defaultChart: "unitfunnel",
    render: (o) => <FunnelBars funnel={o.funnel} />
  },
  {
    id: "sources",
    title: "来源归属",
    wide: true,
    dataKeys: ["sources-26w"],
    charts: { "sources-26w": [{ id: "sourcetree", label: "领域 → 来源" }] },
    defaultData: "sources-26w",
    defaultChart: "sourcetree",
    render: (o) => <SourceBars books={o.sourceBooks} />
  },
  {
    id: "rhythm",
    title: "学习节律",
    dataKeys: ["rhythm-90d"],
    charts: {
      "rhythm-90d": [
        { id: "curves", label: "24 小时分布" },
        { id: "clusters", label: "星期 × 时段" }
      ]
    },
    defaultData: "rhythm-90d",
    defaultChart: "curves",
    render: (o, _dk, chart) => (normalizeChartId("rhythm", chart) === "clusters"
      ? <RhythmGrid grid={o.rhythmGrid || []} />
      : <RhythmHours hours={o.rhythmHours || []} />)
  },
  {
    id: "domainrank",
    title: "领域排名",
    dataKeys: ["domain-rank-6m"],
    charts: { "domain-rank-6m": [{ id: "slope", label: "月度名次" }] },
    defaultData: "domain-rank-6m",
    defaultChart: "slope",
    render: (o) => <RankBump rows={o.domainRank} months={o.domainRankMonths} />
  },
  {
    id: "queueflow",
    title: "队列水位",
    dataKeys: ["queue-month"],
    charts: { "queue-month": [{ id: "ledger", label: "本月进出" }, { id: "forecast", label: "到期预测" }] },
    defaultData: "queue-month",
    defaultChart: "ledger",
    render: (o, _dk, chart) => (normalizeChartId("queueflow", chart) === "forecast"
      ? <DueForecast overdue={o.queueFlow.overdue} forecast={o.dueForecast || []} />
      : <QueueLedger q={o.queueFlow} />)
  },
  {
    id: "reading",
    title: "阅读输入",
    dataKeys: ["reading-45d"],
    dataLabels: { "reading-45d": "近 12 周" },
    charts: {
      "reading-45d": [
        { id: "strips", label: "日历热力" },
        { id: "bars", label: "日柱" },
        { id: "rhist", label: "字数分布" }
      ]
    },
    defaultData: "reading-45d",
    defaultChart: "strips",
    render: (o, _dk, chart) => {
      const c = normalizeChartId("reading", chart);
      const all = o.readingDays.map((d) => ({ date: d.date, value: d.chars }));
      if (c === "rhist") return <ReadingHist days={all} />;
      if (c === "bars") return <DailyColumns days={all.slice(-60)} unit={t("字")} emptyMsg={t("近 60 天暂无阅读记录")} />;
      return <HeatCalendar days={all.slice(-84)} unit={t("字")} emptyMsg={t("近 12 周暂无阅读记录")} />;
    }
  },
  // —— v48.85（D129 B4，§5.3）：成长反馈两 widget（Growth / Territory 层）——
  // 自取数组件：render 忽略 overview 入参，数据经 useGrowthOverview() 独立缓存独立防抖刷新；
  // charts 单图型（无 dataKey 档位，设置页「可显示数据」面板不出现下拉）。
  {
    id: "growth-events",
    title: "成长记录",
    wide: true,
    layer: "growth",
    dataKeys: ["growth-recent"],
    charts: { "growth-recent": [{ id: "records", label: "时间线" }] },
    defaultData: "growth-recent",
    defaultChart: "records",
    render: () => <GrowthEventsWidget />
  },
  {
    id: "territory",
    title: "巩固疆域",
    layer: "territory",
    dataKeys: ["territory-map"],
    charts: { "territory-map": [{ id: "segments", label: "巩固地图" }] },
    defaultData: "territory-map",
    defaultChart: "segments",
    render: () => <TerritoryWidget />
  }
];

export function widgetById(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}
