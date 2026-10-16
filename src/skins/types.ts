// 皮肤引擎 v2 · 类型契约（v49.0 / D170；D169 应用级不变量的承载接口）
// SKIN_API_VERSION：新增 data-ui 部件、ui/* 事件、清单字段时 +1（AUTHORING.md §4）
import type { ComponentType } from "react";

export const SKIN_API_VERSION = 3; // v49.15 / D188：清单新增 tagline

export type ColorMode = "light" | "dark";
export type MotionLevel = "full" | "reduced" | "off";

export interface SkinManifest {
  /** 小写字母/数字/短横线；默认皮肤固定为 "none"（兼容已持久化的值与 D132 互斥逻辑） */
  id: string;
  /** 设置页显示名 */
  name: string;
  description?: string;
  /** 设置页皮肤卡名称后的气质短标（D188）；缺省回落动效标签 */
  tagline?: string;
  apiVersion: number;
  /** 内置皮肤必须同时支持两档 */
  modes: ColorMode[];
  /** solid = body/顶栏保持实底；transparent = 清底色让背景层透出 */
  chrome: "solid" | "transparent";
  /** free = 用户可自定义强调色（按皮肤记忆，D172）；locked = 隐藏强调色设置 */
  accentPolicy: "free" | "locked";
  /** 该皮肤的默认强调色（设置页「恢复默认」显示用；真正生效值写在皮肤 CSS 里） */
  defaultAccent?: { light: string; dark: string };
  /** 设置页预览色块，3–5 个 */
  preview: { light: string[]; dark: string[] };
  features?: {
    /** 是否以 View Transitions 承载视图切换（body 类 skin-vt；动画由皮肤 CSS 覆盖 ::view-transition-*） */
    viewTransitions?: boolean;
    /** 动效强度声明，仅用于设置页标签 */
    motion?: "none" | "subtle" | "rich";
  };
  /** 依赖的最低 Chromium 版本；不满足时设置页置灰 */
  requiresChrome?: number;
}

export interface SkinLayerProps {
  mode: ColorMode;
  motion: MotionLevel;
}

export interface SkinRuntimeContext {
  getMode(): ColorMode;
  getMotion(): MotionLevel;
  body: HTMLElement;
  /** 皮肤停用时 abort；所有监听都应传入这个 signal */
  signal: AbortSignal;
  /** 订阅 ui/* 事件，返回取消函数（停用时也会自动取消） */
  onUiEvent<T = unknown>(type: string, handler: (payload: T) => void): () => void;
}

export interface SkinModule {
  /** 皮肤 CSS 文本（`import css from "./x.css?inline"`），宿主自动包裹 @layer skin */
  css?: string;
  Background?: ComponentType<SkinLayerProps>;
  Overlay?: ComponentType<SkinLayerProps>;
  activate?: (ctx: SkinRuntimeContext) => void | (() => void);
}

export interface SkinEntry {
  manifest: SkinManifest;
  load: () => Promise<SkinModule>;
}
