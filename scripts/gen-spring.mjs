#!/usr/bin/env node
// 弹簧曲线预计算（v49.0 / D170/D173）：把 CDS 四弹簧预设积分采样为 CSS linear() 缓动。
// 与 src/skins/runtime/spring.ts 共用同一算法（Node 24+ 原生 type stripping 直接 import .ts）；
// 产出即皮肤 CSS 里的 --ease-spring-* / --dur-spring-* Token 值。
// 用法：node scripts/gen-spring.mjs
import { springEasing, SPRING_PRESETS } from "../src/skins/runtime/spring.ts";

const LABELS = {
  snappy: ["--ease-spring-snappy", "--dur-spring-snappy", "弹层、下拉、对话框、折叠展开"],
  bouncy: ["--ease-spring-bouncy", "--dur-spring-bouncy", "按钮/开关/图标按压回弹"],
  gentle: ["--ease-spring-gentle", "--dur-spring-gentle", "愉悦反馈"],
  heavySnap: ["--ease-spring-heavy", "--dur-spring-heavy", "拖拽吸附、抽屉、分栏"],
};

console.log("/* CDS 四弹簧预设（node scripts/gen-spring.mjs 生成）——只用于 transform/opacity */");
for (const [key, preset] of Object.entries(SPRING_PRESETS)) {
  const { easing, duration } = springEasing(preset.stiffness, preset.damping, preset.mass);
  const [easeVar, durVar, usage] = LABELS[key];
  console.log(`\n/* ${key}（${preset.stiffness}/${preset.damping}/${preset.mass}）→ ${duration}ms · ${usage} */`);
  console.log(`${easeVar}: ${easing};`);
  console.log(`${durVar}: ${duration}ms;`);
}
