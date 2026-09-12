// 阅读模块组合根：业务代码从这里创建内核、取类型与阅读设置默认值。
// 依赖纪律（AI_DEVELOPMENT_GUIDE §7）：业务组件只允许 import 本模块与 ./kernel；
// foliate-js 由本目录经动态 import 惰性加载（仅在真正打开阅读引擎时进内存）。
import type {
  BookSource,
  LinkInfo,
  ReaderAppearance,
  ReaderImageRef,
  ReaderKernel,
  ReaderLocation,
  ReaderModeConfig,
  ReaderRect,
  ReaderSelection,
  ReaderTocItem,
  ReaderTheme,
  RelocateInfo
} from "./kernel";
import { DEFAULT_READER_SETTINGS, resolveAppearance, type ReaderSettings } from "./foliate/appearance";
import { READER_ENGINE_VERSION } from "./foliate/version";

export type {
  BookSource,
  LinkInfo,
  ReaderAppearance,
  ReaderImageRef,
  ReaderKernel,
  ReaderLocation,
  ReaderModeConfig,
  ReaderRect,
  ReaderSelection,
  ReaderTocItem,
  ReaderTheme,
  RelocateInfo
};
export { READER_ENGINE_VERSION, DEFAULT_READER_SETTINGS, resolveAppearance };
export type { ReaderSettings };

/** 创建阅读内核（当前实现 = foliate 防腐 adapter；未来可经配置切换引擎实现） */
export async function createKernel(host: HTMLElement): Promise<ReaderKernel> {
  const { createFoliateKernel } = await import("./foliate/adapter");
  return createFoliateKernel(host);
}

// 制卡锚点（contextRef.locator）的统一构造：所有阅读入口（引擎/摘录/粘贴书）都用它产出四层可降级定位。
// cfi 绑定特定文档结构（非永久 ID），anchorText 是文本级终极兜底；两者必须同时存。
export function buildLocator(input: {
  cfi?: string;
  chapterIndex?: number;
  anchorText: string;
}): { cfi?: string; chapterIndex?: number; anchorText: string; readerEngineVersion: string } {
  return {
    cfi: input.cfi || undefined,
    chapterIndex: input.chapterIndex,
    anchorText: input.anchorText,
    readerEngineVersion: READER_ENGINE_VERSION
  };
}

export type { ReaderAppearance as ReaderAppearanceSettings };
export type ReaderSelectionResult = ReaderSelection;
export type ReaderMode = ReaderModeConfig;
