// v48.85（D129，§7.4）：成长反馈总开关 `app.growthFeedback`（对象 {enabled}，bool 默认 true）。
// 语义：M13 成长反馈（复习页微反馈条 / 会话成果汇总 / 仪表盘成长组件）的总开关；
// 关闭即**零渲染零计算**——读取路径短路，不派生任何事件、不发任何 growth IPC（§4.17-3/§6.6.2）。
// 双侧归一：主进程 settings:set 写侧（electron/main.js，仅严格 false 为关、对象键逐字面量）
// 与这里（渲染层读侧）同规；数据零改动——关闭不动任何调度与日志事实。

export interface GrowthFeedbackSettings {
  enabled: boolean;
}

export const DEFAULT_GROWTH_FEEDBACK: GrowthFeedbackSettings = { enabled: true };

/** 读侧归一：仅严格 false 为关（含整个值被手写成布尔 false 的形态）；缺失/非法/非对象一律回落开（与写侧同规） */
export function normalizeGrowthFeedback(v: unknown): GrowthFeedbackSettings {
  if (v === false) return { enabled: false };
  const src = v && typeof v === "object" && !Array.isArray(v) ? (v as { enabled?: unknown }) : {};
  return { enabled: src.enabled !== false };
}
