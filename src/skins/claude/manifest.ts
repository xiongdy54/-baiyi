// 雨林（Claude）皮肤清单 · v49.91 / D258（显示名「森林」→「雨林」；v49.90 / D257 显示名由「陶土」改「森林」，
// 亮色＝设计系统「米白」、暗色＝设计系统「森林」配色；v49.1 / D175 显示名去前缀；v49.0 / D173 建；
// v49.15 / D188 气质短标；v49.20 / D193 短标改「从容以赴」）
// 设计语言见 DESIGN.md；Token 两档与结构/动效规则见 claude.css。
import { SKIN_API_VERSION, type SkinManifest } from "../types";

export const claudeManifest: SkinManifest = {
  id: "claude",
  name: "雨林",
  description: "米白纸面、雨林绿强调、柔和阴影与弹簧动效",
  tagline: "从容以赴",
  apiVersion: SKIN_API_VERSION,
  modes: ["light", "dark"],
  chrome: "solid", // 不做背景装饰层（D173：无玻璃拟态、无氛围光）
  accentPolicy: "free",
  defaultAccent: { light: "#2e4a3a", dark: "#f3eedf" },
  preview: {
    light: ["#f4f1e8", "#fbf9f4", "#22302a", "#2e4a3a"],
    dark: ["#133b2b", "#184633", "#f3eedf", "#f3eedf"],
  },
  features: { viewTransitions: true, motion: "rich" },
  requiresChrome: 113, // linear()；View Transitions 不支持时由 changeView 自动降级
};
