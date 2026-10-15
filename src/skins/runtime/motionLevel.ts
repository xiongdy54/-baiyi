// 动效等级（v49.0 / D170）：应用内设置 × 系统 prefers-reduced-motion → 三态
// "system" 跟随系统（reduce → reduced）；"off" 用户显式关闭 → off。
// 结果由 App 写到 body 三态类（motion-full / motion-reduced / motion-off），SkinHost/皮肤 CSS 消费。
export type MotionSetting = "system" | "off";

export function resolveMotion(setting: MotionSetting): "full" | "reduced" | "off" {
  if (setting === "off") return "off";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

export function motionClass(level: "full" | "reduced" | "off"): string {
  return level === "full" ? "motion-full" : level === "reduced" ? "motion-reduced" : "motion-off";
}
