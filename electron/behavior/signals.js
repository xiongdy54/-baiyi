// BDI（D248）：信号注册表。唯一事实来源＝docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §9.4。
// 信号 = 某类可观测行为 × 过滤条件 × 数值函数 × 极性 × 单位；只交原料，不输出综合兴趣分（本期）。
// 计算在 rollup/signals 派生阶段（T11）使用本表；改过滤/单位/极性必须 bump SIGNALS_VERSION。
"use strict";

const SIGNALS_VERSION = 1;

/** polarity：+1 正向证据；-1 只表示「可能是休息/整理/重复材料」，不得自动解释为负面兴趣 */
const SIGNALS = [
  { id: "open_active", doc: "`library.opened`，self_initiated", unit: "count", polarity: 1, note: "去重打开次数" },
  { id: "open_pushed", doc: "`library.opened`，pushed", unit: "count", polarity: 1, note: "推送打开次数" },
  { id: "dwell_active", doc: "规范化 attention，self 来源", unit: "min", polarity: 1, note: "不加 answer 分钟" },
  { id: "dwell_pushed", doc: "规范化 attention，pushed 来源", unit: "min", polarity: 1, note: "不加 answer 分钟" },
  { id: "jump_purpose", doc: "`reader.jumped`，toc/search/link 等明确方法", unit: "count", polarity: 1, note: "op 次数；不证明理解" },
  { id: "extract_made", doc: "成功用户创建事件，实体/op 去重", unit: "count", polarity: 1, note: "次数，高亮与摘录不重复" },
  { id: "annotate", doc: "`extract.op` 且 `annotation=true`", unit: "count", polarity: 1, note: "次数" },
  { id: "card_manual", doc: "成功用户手动创建，非导入/后台", unit: "count", polarity: 1, note: "人工动作证据" },
  { id: "ai_accept", doc: "明确用户接纳操作", unit: "count", polarity: 1, note: "确认 op 次数；acceptedCardCount 另字段，不默认累成投入" },
  { id: "source_jump", doc: "`review.source_opened`", unit: "count", polarity: 1, note: "主动回源次数" },
  { id: "explain_ask", doc: "`ai.invoked`，explain/ste/translate，用户发起且成功", unit: "count", polarity: 1, note: "请求次数，失败/取消另计不混" },
  { id: "query", doc: "已提交的书架/阅读/浏览查询，过滤空串、同 op 去重", unit: "count", polarity: 1, note: "次数，关闭原文仍可计" },
  { id: "dict_lookup", doc: "`dict.lookup`", unit: "count", polarity: 1, note: "次数；不记词（默认）" },
  { id: "finish_book", doc: "`reader.finished`", unit: "count", polarity: 1, note: "到达末尾代理，一书一次" },
  { id: "journal_write", doc: "`journal.written`，排除 draft 自动保存", unit: "count", polarity: 1, note: "次数/字数" },
  { id: "mindmap_explore", doc: "`mindmap.node_action`", unit: "count", polarity: 1, note: "次数" },
  { id: "kp_view", doc: "`knowledge.viewed`", unit: "count", polarity: 1, note: "次数" },
  { id: "skip", doc: "有效成功动作（`review.skipped`）", unit: "count", polarity: -1, note: "可能是休息、整理、重复材料；**不自动解释为负面兴趣**" },
  { id: "extract_defer", doc: "有效成功动作（摘录推迟/延后）", unit: "count", polarity: -1, note: "可能是休息、整理、重复材料；**不自动解释为负面兴趣**" },
  { id: "card_delete", doc: "有效成功动作（卡片删除）", unit: "count", polarity: -1, note: "可能是整理、重复材料；**不自动解释为负面兴趣**" },
  { id: "item_delete", doc: "有效成功动作（材料删除）", unit: "count", polarity: -1, note: "可能是整理、重复材料；**不自动解释为负面兴趣**" },
];

const SIGNAL_IDS = SIGNALS.map((s) => s.id);
const SIGNAL_SET = new Set(SIGNAL_IDS);

module.exports = { SIGNALS_VERSION, SIGNALS, SIGNAL_IDS, SIGNAL_SET };
