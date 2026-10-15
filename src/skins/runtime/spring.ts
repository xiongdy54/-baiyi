// 弹簧 → CSS linear() 缓动（v49.0 / D170；皮肤 JS 动效与 scripts/gen-spring.mjs 共用算法）
// 把弹簧参数（刚度/阻尼/质量）物理积分采样为 CSS linear() 缓动与建议时长。
// 弹簧尾巴很长但幅度极小，体感时长约为建议时长的 60%；只用于 transform/opacity，不用于颜色。
export function springEasing(stiffness: number, damping: number, mass = 1, points = 28, eps = 0.0015) {
  const dt = 1 / 1000;
  let x = 0, v = 0, t = 0, settle = 0;
  const xs: number[] = [];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt;
    xs.push(x);
    if (Math.abs(x - 1) > eps || Math.abs(v) > eps * 10) settle = t;
  }
  const n = Math.max(points, Math.round(settle / dt));
  const out = ["0"];
  for (let i = 1; i < points; i++) out.push(xs[Math.round((n * i) / points) - 1].toFixed(4));
  out.push("1");
  return { easing: `linear(${out.join(", ")})`, duration: Math.round(settle * 1000) };
}

/** CDS 四弹簧预设（§D170/AUTHORING §6）：按需取用 */
export const SPRING_PRESETS = {
  snappy: { stiffness: 320, damping: 28, mass: 1 },     // 弹层、下拉、对话框、折叠展开（500ms）
  bouncy: { stiffness: 600, damping: 30, mass: 1 },     // 按钮/开关/图标按压回弹（460ms）
  gentle: { stiffness: 380, damping: 18, mass: 1 },     // 愉悦反馈（800ms）
  heavySnap: { stiffness: 1200, damping: 80, mass: 0.1 } // 拖拽吸附、抽屉、分栏（460ms）
} as const;
