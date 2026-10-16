// 陶土（Claude）皮肤清单 · v49.1 / D175（显示名去前缀；v49.0 / D173 建；v49.15 / D188 气质短标）
// 设计语言见 DESIGN.md；Token 两档与结构/动效规则见 claude.css。
import { SKIN_API_VERSION, type SkinManifest } from "../types";

export const claudeManifest: SkinManifest = {
  id: "claude",
  name: "陶土",
  description: "暖奶油纸面、陶土强调色、柔和阴影与弹簧动效",
  tagline: "闲庭信步",
  apiVersion: SKIN_API_VERSION,
  modes: ["light", "dark"],
  chrome: "solid", // 不做背景装饰层（D173：无玻璃拟态、无氛围光）
  accentPolicy: "free",
  defaultAccent: { light: "#ae5630", dark: "#d97757" },
  preview: {
    light: ["#f5f5f3", "#ffffff", "#151515", "#d97757"],
    dark: ["#0b0b0a", "#1a1a19", "#f5f5f5", "#d97757"],
  },
  features: { viewTransitions: true, motion: "rich" },
  requiresChrome: 113, // linear()；View Transitions 不支持时由 changeView 自动降级
};
