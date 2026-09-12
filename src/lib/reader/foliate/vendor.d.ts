// vendor/foliate-js 为无类型纯 ESM JS 快照（MIT，见 vendor/foliate-js/MANIFEST.json）。
// 本目录（src/lib/reader/foliate/**）是全仓库唯一允许 import foliate-js 的地方。
// 仅声明 adapter 实际静态/动态引用的模块；升级快照后按「API 白名单」核对（MANIFEST 升级规程）。
declare module "*foliate-js/view.js" {
  export class View extends HTMLElement {
    book: unknown;
    renderer: unknown;
    lastLocation: unknown;
    isFixedLayout: boolean;
    open(book: unknown): Promise<void>;
    init(opts?: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    close(): void;
    goTo(target: unknown): Promise<{ index: number; anchor: unknown } | undefined>;
    goToFraction(frac: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    next(distance?: number): Promise<void>;
    select(target: unknown): Promise<void>;
    deselect(): void;
    getCFI(index: number, range?: Range): string;
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
    asyncSearch?: never;
    search(opts: {
      query: string;
      index?: number;
      /** 迭代过程不绘制搜索高亮（内核搜索定位不需要 overlay） */
      draw?: unknown;
    }): AsyncGenerator<
      | { cfi: string; excerpt: string }
      | { progress: number }
      | { index: number; subitems: { cfi: string; excerpt: string }[] }
      | "done",
      void,
      unknown
    >;
    clearSearch(): void;
    addEventListener(type: string, listener: (e: CustomEvent) => void, opts?: AddEventListenerOptions): void;
    removeEventListener(type: string, listener: (e: CustomEvent) => void, opts?: EventListenerOptions): void;
  }
  export const makeBook: (file: unknown) => Promise<unknown>;
}
declare module "*foliate-js/epubcfi.js" {
  export const isCFI: RegExp;
}
