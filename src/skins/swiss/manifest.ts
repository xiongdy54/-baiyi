// 默认皮肤（瑞士风）清单 · v49.0 / D170（v49.15 / D188：显示名去「（默认）」+ 气质短标）
// id 固定 "none"：兼容已持久化的 app.skinId 值与 D132 双槽互斥逻辑。
// 本皮肤不注册任何 CSS / 层组件——外观全部来自 theme.css（base 层）。
import { SKIN_API_VERSION, type SkinManifest } from "../types";

export const swissManifest: SkinManifest = {
  id: "none",
  name: "瑞士",
  description: "直角、零阴影、单一焦点色的瑞士国际主义风格",
  tagline: "轻装上阵",
  apiVersion: SKIN_API_VERSION,
  modes: ["light", "dark"],
  chrome: "solid",
  accentPolicy: "free",
  defaultAccent: { light: "#166a59", dark: "#3fa08a" },
  preview: {
    light: ["#fafaf8", "#f0f0ee", "#0a0a0a", "#166a59"],
    dark: ["#101010", "#1c1c1a", "#f5f5f2", "#3fa08a"],
  },
  features: { viewTransitions: true, motion: "subtle" },
};
