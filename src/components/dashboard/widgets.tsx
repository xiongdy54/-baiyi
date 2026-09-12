// 统计组件注册表 — 数据选择（一数据多图型）与图型切换在这里集中定义
// 图型渲染全部来自 charts/swiss.tsx（原创实现，瑞士国际主义风格）。
// 兼容：老配置里存的旧 chart id 通过 ALIAS 映射到新图型，无需迁移设置。
import type { ReactNode } from "react";
import type { StatsOverview } from "../../lib/stats";
import {
  ChartSvg, chartQueueBar, chartStreakRuler, chartMinutesStrip,
  chartDailyColumns, chartCumulativeStep, chartWeekdayProfile, chartMonthMultiples,
  chartUnitColumn, chartDivergingPair,
  chartDomainDots, chartDomainTreemap,
  chartRatingColumn,
  chartFieldRanges, chartFreqPoly,
  chartUnitFunnel,
  chartSourceTree,
  chartRhythmCurves, chartHourClusters,
  chartRankSlope,
  chartQueueLedger,
  chartReadingStrips, chartReadingHist
} from "../charts/swiss";

export type ChartMode = string; // 图型 id，如 "months" / "columns"

export interface WidgetDef {
  id: string;
  title: string;
  wide?: boolean;              // 建议通栏
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

// 确定性伪随机（保留导出以兼容 Dashboard 的 render 签名；新渲染器内部自带确定性 jitter）
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
    if (o.unclassified > 0) rows.push({ label: "未分类", count: o.unclassified });
    return rows;
  }
  const rows = o.domainDetail.map((d) => ({ label: d.label, count: d.count }));
  if (o.unclassified > 0) rows.push({ label: "未分类", count: o.unclassified });
  return rows.sort((a, b) => b.count - a.count);
}

// —— 学习热力的时间范围档位（dataKey → 天数；heatDays 数据库固定给 26 周）——
const HEAT_RANGES: Record<string, number> = {
  "reviews-30d": 30, "reviews-60d": 60, "reviews-90d": 90,
  "reviews-120d": 120, "reviews-150d": 150, "reviews-26w": 182
};
const heatSlice = (days: { date: number; count: number }[], dk: string) => days.slice(-(HEAT_RANGES[dk] ?? 90));
const HEAT_KEYS = Object.keys(HEAT_RANGES);
const HEAT_CHARTS = [
  { id: "months", label: "月面板" },
  { id: "columns", label: "日柱" },
  { id: "weekday", label: "星期剖面" },
  { id: "cumulative", label: "累计阶梯" }
];

export const WIDGETS: WidgetDef[] = [
  {
    id: "kpi",
    title: "关键指标",
    dataKeys: ["kpi"],
    charts: {
      kpi: [
        { id: "queuebar", label: "队列构成" },
        { id: "streak", label: "连续学习里程碑" },
        { id: "minutes", label: "今日时长对照" }
      ]
    },
    defaultData: "kpi",
    defaultChart: "queuebar",
    render: (o, _dk, chart) => {
      const c = (ALIAS.kpi as Record<string, string>)[chart] || chart;
      if (c === "streak") return <ChartSvg {...chartStreakRuler(o.kpi.streak)} maxHeight={180} />;
      if (c === "minutes") return <ChartSvg {...chartMinutesStrip(o.kpi, o.heatDays)} maxHeight={180} />;
      return <ChartSvg {...chartQueueBar(o.kpi)} maxHeight={180} />;
    }
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
      const c = (ALIAS.heatmap as Record<string, string>)[chart] || chart;
      const days = heatSlice(o.heatDays, dk);
      if (c === "columns") return <ChartSvg {...chartDailyColumns(days)} maxHeight={300} />;
      if (c === "weekday") return <ChartSvg {...chartWeekdayProfile(days)} maxHeight={300} />;
      if (c === "cumulative") return <ChartSvg {...chartCumulativeStep(days)} maxHeight={300} />;
      return <ChartSvg {...chartMonthMultiples(days)} maxHeight={300} />;
    }
  },
  {
    id: "today",
    title: "今日完成度",
    dataKeys: ["today-progress"],
    charts: {
      "today-progress": [
        { id: "units", label: "方块垒（1块=1张）" },
        { id: "divergence", label: "双向发散" }
      ]
    },
    defaultData: "today-progress",
    defaultChart: "units",
    render: (o, _dk, chart) => {
      const c = (ALIAS.today as Record<string, string>)[chart] || chart;
      return c === "divergence"
        ? <ChartSvg {...chartDivergingPair(o.kpi)} />
        : <ChartSvg {...chartUnitColumn(o.kpi)} />;
    }
  },
  {
    id: "domains",
    title: "领域分布",
    dataKeys: ["domains-main", "domains-detail"],
    charts: {
      "domains-main": [
        { id: "dots", label: "点行对齐" },
        { id: "treemap", label: "矩形树图" }
      ],
      "domains-detail": [
        { id: "dots", label: "点行对齐" },
        { id: "treemap", label: "矩形树图" }
      ]
    },
    defaultData: "domains-main",
    defaultChart: "dots",
    render: (o, dk, chart) => {
      const c = (ALIAS.domains as Record<string, string>)[chart] || chart;
      const items = domainItems(o, dk);
      return c === "treemap"
        ? <ChartSvg {...chartDomainTreemap(items, "卡")} />
        : <ChartSvg {...chartDomainDots(items, "卡")} />;
    }
  },
  {
    id: "ratings",
    title: "评分构成",
    dataKeys: ["ratings-30d"],
    charts: { "ratings-30d": [{ id: "ratingcol", label: "百分比单柱" }] },
    defaultData: "ratings-30d",
    defaultChart: "ratingcol",
    render: (o) => <ChartSvg {...chartRatingColumn(o.ratings)} />
  },
  {
    id: "duration",
    title: "答题时长",
    dataKeys: ["duration-by-field", "duration-hist"],
    charts: {
      "duration-by-field": [{ id: "ranges", label: "区间浮条" }],
      "duration-hist": [{ id: "freqpoly", label: "频率多边形" }]
    },
    defaultData: "duration-hist",
    defaultChart: "freqpoly",
    render: (o, dk, chart) => {
      const c = (ALIAS.duration as Record<string, string>)[chart] || chart;
      if (dk === "duration-by-field" || c === "ranges")
        return <ChartSvg {...chartFieldRanges(o.durationByField)} />;
      return <ChartSvg {...chartFreqPoly(o.durationBins)} />;
    }
  },
  {
    id: "funnel",
    title: "卡片生命周期",
    dataKeys: ["funnel-90d"],
    charts: { "funnel-90d": [{ id: "unitfunnel", label: "方块漏斗" }] },
    defaultData: "funnel-90d",
    defaultChart: "unitfunnel",
    render: (o) => <ChartSvg {...chartUnitFunnel(o.funnel)} />
  },
  {
    id: "sources",
    title: "来源归属",
    wide: true,
    dataKeys: ["sources-26w"],
    charts: { "sources-26w": [{ id: "sourcetree", label: "归属树" }] },
    defaultData: "sources-26w",
    defaultChart: "sourcetree",
    render: (o) => <ChartSvg {...chartSourceTree(o.sourceCards)} maxHeight={340} />
  },
  {
    id: "rhythm",
    title: "学习节律",
    dataKeys: ["rhythm-90d"],
    charts: {
      "rhythm-90d": [
        { id: "curves", label: "星期曲线谱" },
        { id: "clusters", label: "时刻点簇" }
      ]
    },
    defaultData: "rhythm-90d",
    defaultChart: "curves",
    render: (o, _dk, chart) => {
      const c = (ALIAS.rhythm as Record<string, string>)[chart] || chart;
      if (c === "clusters") {
        return <ChartSvg {...chartHourClusters(o.rhythmEvents || [])} />;
      }
      return <ChartSvg {...chartRhythmCurves(o.rhythmGrid || [])} />;
    }
  },
  {
    id: "domainrank",
    title: "领域排名",
    dataKeys: ["domain-rank-6m"],
    charts: { "domain-rank-6m": [{ id: "slope", label: "斜率排名" }] },
    defaultData: "domain-rank-6m",
    defaultChart: "slope",
    render: (o) => <ChartSvg {...chartRankSlope(o.domainRank.map((d) => ({ label: d.label, ranks: d.ranks })))} />
  },
  {
    id: "queueflow",
    title: "队列水位",
    dataKeys: ["queue-month"],
    charts: { "queue-month": [{ id: "ledger", label: "进出账本" }] },
    defaultData: "queue-month",
    defaultChart: "ledger",
    render: (o) => <ChartSvg {...chartQueueLedger(o.queueFlow)} />
  },
  {
    id: "reading",
    title: "阅读输入",
    dataKeys: ["reading-45d"],
    charts: {
      "reading-45d": [
        { id: "strips", label: "周条密度带（42天）" },
        { id: "rhist", label: "字数分布" }
      ]
    },
    defaultData: "reading-45d",
    defaultChart: "strips",
    render: (o, _dk, chart) => {
      const c = (ALIAS.reading as Record<string, string>)[chart] || chart;
      return c === "rhist"
        ? <ChartSvg {...chartReadingHist(o.readingDays)} />
        : <ChartSvg {...chartReadingStrips(o.readingDays)} maxHeight={300} />;
    }
  }
];

export function widgetById(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}
