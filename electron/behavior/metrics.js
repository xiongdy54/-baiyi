// BDI（D248）：指标注册表。唯一事实来源＝docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §9.1。
// 每个指标必填 id / unit / grain / source / coverageKey / definition / nullPolicy / estimatePolicy / additivity / version。
// 常量与阈值是产品假设，版本化；调用方不得偷偷改（改定义必须 bump METRICS_VERSION 与条目 version）。
"use strict";

const METRICS_VERSION = 1;

const NULL_UNCOVERED = "无支持/未覆盖=NULL；完整覆盖下确实无动作=0；除数 0=NULL（不返回 Infinity/NaN）";
const EST_NONE = "none";
const EST_LOWER_BOUND = "部分覆盖日默认 NULL，另报已观测下界";

/** 核心指标（daily_metrics.metric / 查询层派生） */
const METRICS = [
  {
    id: "ev:<type>", unit: "count|sum", grain: "day", source: "events", coverageKey: "events",
    definition: "事件计数（n）与 `num` 之和（sum）；`intentOnly` 事件只计意图",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "attn.active_ms", unit: "ms", grain: "day", source: "attn_spans", coverageKey: "attention",
    definition: "规范化 span 的 active 累计（单调时钟、idle 切分后）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_LOWER_BOUND, additivity: "additive_across_days", version: 1,
  },
  {
    id: "attn.idle_ms", unit: "ms", grain: "day", source: "attn_spans", coverageKey: "attention",
    definition: "规范化 span 的 idle 累计（lastInput+idleLimit 之后的部分）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "attn.self_ms", unit: "ms", grain: "day", source: "attn_spans", coverageKey: "attention",
    definition: "按 origin/initiative 分桶：self（active 来源）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "attn.pushed_ms", unit: "ms", grain: "day", source: "attn_spans", coverageKey: "attention",
    definition: "按 origin/initiative 分桶：pushed（队列/推荐/通知）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "attn.neutral_ms", unit: "ms", grain: "day", source: "attn_spans", coverageKey: "attention",
    definition: "按 origin/initiative 分桶：neutral（resume/unknown）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "review.answer_ms", unit: "ms", grain: "day", source: "review_logs", coverageKey: "review",
    definition: "有效 `review_logs.duration_ms`；负数/非有限/单次 >30min 不计有效时长，另报 invalid_count",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "review.think_ms", unit: "ms", grain: "day", source: "events:review.revealed", coverageKey: "review",
    definition: "`review.revealed.dur_ms`（单调时钟 think_ms）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "session.foreground_ms", unit: "ms", grain: "day", source: "app_sessions", coverageKey: "sessions",
    definition: "窗口焦点累计（跨学习日按交点切分）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "session.count", unit: "count", grain: "day", source: "app_sessions", coverageKey: "sessions",
    definition: "应用会话数（`app_sessions` 中与当日有交集的会话）",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "distinct_not_additive", version: 1,
  },
  {
    id: "deliberate_production", unit: "count", grain: "day", source: "events", coverageKey: "events",
    definition: "用户明确发起的摘录/批注/手动卡，按 op 去重；AI 确认每根 op 最多记 1，自动生成/导入/sync/unknown 不计",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "effort_min", unit: "min", grain: "day", source: "attn_spans+review_logs+events", coverageKey: "attention",
    definition: "attention 完整日 = active_min；无 attention 的历史期可提供 answer_min + 手动产出估算（extract 2min/annotation 1min/manualCard 3min），标 estimate",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: "历史仅 answer/产出证据时标 estimate；部分覆盖日默认 NULL", additivity: "additive_across_days", version: 1,
  },
  {
    id: "engaged", unit: "bool", grain: "day", source: "attn_spans+review_logs+events", coverageKey: "attention",
    definition: "active_min≥10 或可信 answer_min≥5 或 deliberate_production≥2；任一足量证据可为 1",
    nullPolicy: "未达阈值但有缺口=NULL；足够覆盖且未达=0；历史仅 answer 证据标 estimated",
    estimatePolicy: "仅 answer 证据时标 estimated", additivity: "per_day_flag", version: 1,
  },
  {
    id: "progress_chars", unit: "chars", grain: "day", source: "reading_events", coverageKey: "reading",
    definition: "相对「以前最高已记录位置」的正向推进；首条记录无 baseline→NULL；可能由跳转产生",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "additive_across_days", version: 1,
  },
  {
    id: "covered_chars", unit: "chars", grain: "day", source: "reading_events", coverageKey: "reading",
    definition: "观测位置并集下界；不是已读字数",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_LOWER_BOUND, additivity: "distinct_not_additive", version: 1,
  },
  {
    id: "consistency_8w", unit: "ratio", grain: "week", source: "daily_metrics:engaged", coverageKey: "events",
    definition: "最近 8 个完整 ISO 周，engaged≥2 天的周数/完整可判定周数；当前未完周不计",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "pass_rate_28", unit: "ratio", grain: "window", source: "review_logs", coverageKey: "review",
    definition: "`review_logs` 中当次 `fsrs_before_json.state` 明确为 Review 的有效评分，非 Again 占比；按主领域独占整数样本计算",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "pass_rate_lb_28", unit: "ratio", grain: "window", source: "review_logs", coverageKey: "review",
    definition: "同 `pass_rate_28` 的 Wilson 95% 下界；不把加权小数塞入二项公式",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "s_growth_med_28", unit: "ratio", grain: "window", source: "review_logs", coverageKey: "review",
    definition: "有效非 Again 且 `s_before>0`、配置/快照可解析的 `s_after/s_before` 中位数；不等于认知能力",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "share_28", unit: "ratio", grain: "window", source: "signal_daily", coverageKey: "events",
    definition: "同一来源/版本/基础层的证据占比；分母 0 → NULL；不跨 level 相加；只用于非负已归一证据",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "self_ratio_28", unit: "ratio", grain: "window", source: "attn_spans+events", coverageKey: "events",
    definition: "自我发起证据占（self+pushed）的比例；同一来源/版本/基础层",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
  {
    id: "depth_28", unit: "ratio", grain: "window", source: "attn_spans+events", coverageKey: "attention",
    definition: "同层深度代理（active 时长与产出组合）；不跨 level 相加；不宣称理解",
    nullPolicy: NULL_UNCOVERED, estimatePolicy: EST_NONE, additivity: "window_aggregate", version: 1,
  },
];

/** domain_day 的数值列＝该层日事实的唯一名称（维度/主键不是指标） */
const DOMAIN_COLUMNS = [
  { column: "active_ms", unit: "ms" },
  { column: "idle_ms", unit: "ms" },
  { column: "self_ms", unit: "ms" },
  { column: "pushed_ms", unit: "ms" },
  { column: "neutral_ms", unit: "ms" },
  { column: "read_ms", unit: "ms" },
  { column: "review_ms", unit: "ms" },
  { column: "xreview_ms", unit: "ms" },
  { column: "author_ms", unit: "ms" },
  { column: "browse_ms", unit: "ms" },
  { column: "other_ms", unit: "ms" },
  { column: "answer_ms", unit: "ms" },
  { column: "n_reviews", unit: "count" },
  { column: "n_again", unit: "count" },
  { column: "n_hard", unit: "count" },
  { column: "n_good", unit: "count" },
  { column: "n_easy", unit: "count" },
  { column: "n_new_reviewed", unit: "count" },
  { column: "n_extracts", unit: "count" },
  { column: "n_annotations", unit: "count" },
  { column: "n_cards_manual", unit: "count" },
  { column: "n_cards_ai_kept", unit: "count" },
  { column: "n_opens_self", unit: "count" },
  { column: "n_source_jumps", unit: "count" },
  { column: "n_explains", unit: "count" },
  { column: "n_queries", unit: "count" },
  { column: "n_skips", unit: "count" },
  { column: "n_defers", unit: "count" },
  { column: "n_deletes", unit: "count" },
  { column: "deliberate_production", unit: "count" },
  { column: "n_items", unit: "distinct" },
];

const METRIC_IDS = METRICS.map((m) => m.id);
const METRIC_SET = new Set(METRIC_IDS);

function getMetric(id) {
  return METRICS.find((m) => m.id === id) || null;
}

module.exports = { METRICS_VERSION, METRICS, METRIC_IDS, METRIC_SET, DOMAIN_COLUMNS, getMetric };
