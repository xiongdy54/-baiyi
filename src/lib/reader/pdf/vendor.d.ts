declare module "pdfjs-dist/build/pdf.mjs" {
  export const version: string;
  export const GlobalWorkerOptions: { workerSrc: string | string[] };
  export function getDocument(params: unknown): { promise: Promise<unknown> };
}
declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  export class EventBus {
    on(event: string, handler: (e: never) => void, opts?: unknown): void;
    off(event: string, handler: (e: never) => void): void;
    dispatch(event: string, data?: unknown): void;
  }
  export class PDFLinkService {
    constructor(opts: { eventBus: unknown });
    setViewer(viewer: unknown): void;
    setDocument(doc: unknown, baseUrl?: string | null): void;
  }
  export class PDFViewer {
    constructor(opts: Record<string, unknown>);
    container: HTMLElement;
    currentPageNumber: number;
    pagesCount: number;
    setDocument(doc: unknown): void;
    scrollPageIntoView(opts: { pageNumber: number }): void;
    /** 强制刷新可视页渲染队列（恢复打开落在非首屏页时用；官方 API，本地声明补齐） */
    update(): void;
    nextPage(): boolean;
    previousPage(): boolean;
    scrollMode: number;
    spreadMode: number;
  }
  export const RenderingStates: Record<string, number>;
  export const ScrollMode: { UNKNOWN: number; VERTICAL: number; HORIZONTAL: number; WRAPPED: number; PAGE: number };
  export const SpreadMode: { UNKNOWN: number; NONE: number; ODD: number; EVEN: number };
}
declare module "pdfjs-dist/web/pdf_viewer.css";
declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const url: string;
  export default url;
}
