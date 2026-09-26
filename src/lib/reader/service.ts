// 阅读模块组合根：业务代码从这里创建内核、取类型与阅读设置默认值。
// 依赖纪律（AI_DEVELOPMENT_GUIDE §7）：业务组件只允许 import 本模块与 ./kernel；
// foliate-js 由本目录经动态 import 惰性加载（仅在真正打开阅读引擎时进内存）。
import type {
  BookSource,
  ContentPointerUpInfo,
  ImageLocateHit,
  ImageLocateQuery,
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
import { READER_ENGINE_VERSION, PDF_ENGINE_VERSION } from "./foliate/version";

export type {
  BookSource,
  ContentPointerUpInfo,
  ImageLocateHit,
  ImageLocateQuery,
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
export { READER_ENGINE_VERSION, PDF_ENGINE_VERSION, DEFAULT_READER_SETTINGS, resolveAppearance };
export type { ReaderSettings };

/** 阅读引擎选择（v28 PDF 原生阅读）：默认 foliate（存量调用全部走此分支，零改动） */
export type ReaderEngineKind = "foliate" | "pdf";

/** 创建阅读内核（当前实现 = foliate 防腐 adapter / pdf.js 直读 adapter；业务代码只见 ReaderKernel 接口） */
export async function createKernel(host: HTMLElement, engine: ReaderEngineKind = "foliate"): Promise<ReaderKernel> {
  if (engine === "pdf") {
    const { createPdfKernel } = await import("./pdf/adapter");
    return createPdfKernel(host);
  }
  const { createFoliateKernel } = await import("./foliate/adapter");
  return createFoliateKernel(host);
}

// 制卡锚点（contextRef.locator）的统一构造：所有阅读入口（引擎/摘录/粘贴书）都用它产出可降级定位。
// foliate 系用 cfi+chapterIndex 双锚；PDF 系用 pageIndex+anchorText 双锚；anchorText 是文本级终极兜底，必须同时存。
// cfi 绑定特定文档结构（非永久 ID）；pageIndex 绑定 PDF 页序，重排版即失效——两者都依赖 anchorText 兜底。
export function buildLocator(input: {
  cfi?: string;
  chapterIndex?: number;
  pageIndex?: number;
  anchorText: string;
}): { cfi?: string; chapterIndex?: number; pageIndex?: number; anchorText: string; readerEngineVersion: string } {
  const version = input.pageIndex !== undefined ? PDF_ENGINE_VERSION : READER_ENGINE_VERSION;
  return {
    cfi: input.cfi || undefined,
    chapterIndex: input.chapterIndex,
    pageIndex: input.pageIndex,
    anchorText: input.anchorText,
    readerEngineVersion: version
  };
}

export type { ReaderAppearance as ReaderAppearanceSettings };
export type ReaderSelectionResult = ReaderSelection;
export type ReaderMode = ReaderModeConfig;
