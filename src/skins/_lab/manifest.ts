// 引擎能力回归样本（仅 DEV 注册，v49.0 / D170 P6）
// 用一支不发布的实验皮肤把引擎全部扩展点跑一遍：透明 chrome + canvas 背景层、前景层庆祝、
// activate 生命周期（ui/* 订阅 + WAAPI 弹簧）、@property 色相动画、受控玻璃拟态（同屏 1 处）。
import { SKIN_API_VERSION, type SkinManifest } from "../types";

export const labManifest: SkinManifest = {
  id: "skin-lab",
  name: "引擎实验台（DEV）",
  description: "仅开发环境：透明 chrome + 柔光背景 + 庆祝前景 + 全动效钩子",
  apiVersion: SKIN_API_VERSION,
  modes: ["light", "dark"],
  chrome: "transparent",
  accentPolicy: "free",
  defaultAccent: { light: "#166a59", dark: "#3fa08a" },
  preview: { light: ["#fafaf8", "#dbe7e2", "#0a0a0a", "#166a59"], dark: ["#101010", "#202a27", "#f5f5f2", "#3fa08a"] },
  features: { viewTransitions: false, motion: "rich" },
};
