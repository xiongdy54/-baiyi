// pdfAdapter——ReaderKernel 的 pdf.js 实现（v28 PDF 原生阅读）。
// 本目录（src/lib/reader/pdf/**）是 pdf.js viewer 组件的唯一允许依赖点（防腐层纪律 §7.1.9 类比 foliate 豁免）。
// pdf.js = Mozilla Apache-2.0（渲染方案调研结论见 AI_DEVELOPMENT_GUIDE §9.1 M6-2，v28）。
//
// 使用的 pdfjs API 白名单（pdfjs-dist 6.3.289，升级时逐项核对）：
//   build/pdf.mjs: getDocument({data, cMapUrl, cMapPacked, standardFontDataUrl})/GlobalWorkerOptions/
//                  PDFDocumentProxy(numPages/getOutline/getDestination/getPageIndex/destroy)
//   web/pdf_viewer.mjs: EventBus/PDFViewer/PDFLinkService/ScrollMode/SpreadMode/RenderingStates
//   web/pdf_viewer.css: 文本层/注释层样式（import 进包；images/ 资源由 Vite 自动处理）
// 文本搜索定位不用 PDFFindController（其 find 事件状态机异步且难断言），用"逐页 getTextContent 全文扫描"确定性实现。
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import { EventBus, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import type {
  BookSource,
  ContentPointerDownInfo,
  ContentPointerUpInfo,
  LinkInfo,
  MarkPointerInfo,
  ReaderAppearance,
  ReaderDocMark,
  ReaderImageRef,
  ReaderKernel,
  ReaderLocation,
  ReaderModeConfig,
  ReaderRect,
  ReaderSelection,
  ReaderTocItem,
  RelocateInfo,
  SourceAnchorGeometry
} from "../kernel";
import { createMultiHighlight } from "../multiHighlight";
import { drawBadges } from "../badges";
import { annotSoft, annotSolid } from "../annotColor";
// 百分比换算的唯一实现面（v25 M5）：选区像素框 → 页内百分比走 pxShapeToPct，不另造一套换算
import { pxShapeToPct } from "../../occlusion";
import { PDF_ENGINE_VERSION } from "../foliate/version";

// 兼容层（pdf.js v6 要求 ES2025，Electron 31/Chromium 126 缺失，清单见 tests/pdf.compat.js）。
// 与 Array.prototype.at 之类的 polyfill 同性质：只补缺失方法，不改语义；Electron 升级后自动失效（if 守卫）。
if (typeof Promise !== "undefined" && typeof (Promise as unknown as { try?: unknown }).try !== "function") {
  (Promise as unknown as Record<string, unknown>).try = function <T, A extends unknown[]>(fn: (...args: A) => T | PromiseLike<T>, ...args: A): Promise<T> {
    return new Promise<T>((resolve) => resolve(fn(...args)));
  };
}
if (typeof Map !== "undefined" && typeof (Map.prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed !== "function") {
  (Map.prototype as unknown as Record<string, unknown>).getOrInsertComputed = function <K, V>(this: Map<K, V>, key: K, fn: (k: K) => V): V {
    if (this.has(key)) return this.get(key) as V;
    const v = fn(key);
    this.set(key, v);
    return v;
  };
}

// worker：Electron file 协议下走本地打包产物，不走网络。
// Vite 生产构建用 ?url 后缀（declare 见 vendor.d.ts）；esbuild 测试打包走下方 WORKER_URL 回退。
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
declare const WORKER_URL: string | undefined;

interface OutlineNode {
  title?: string;
  dest?: unknown;
  items?: OutlineNode[];
}

/** 大纲条目 → 页码（named dest 先解析；失败返回 null 由调用方跳过） */
async function outlineDestToPage(doc: { getDestination(d: string): Promise<unknown>; getPageIndex(ref: unknown): Promise<number> }, dest: unknown): Promise<number | null> {
  try {
    let d = dest;
    if (typeof d === "string") d = await doc.getDestination(d);
    const ref = Array.isArray(d) ? d[0] : null;
    if (!ref) return null;
    return await doc.getPageIndex(ref);
  } catch {
    return null;
  }
}

export function createPdfKernel(host: HTMLElement): ReaderKernel {
  const container = document.createElement("div");
  // pdf-loading 态：大书解析+首屏渲染需要数秒，期间显示加载提示（open 完成后移除，见下）
  container.className = "pdf-viewer-container pdf-loading";
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.overflow = "auto";
  const viewerEl = document.createElement("div");
  viewerEl.className = "pdfViewer";
  container.appendChild(viewerEl);
  host.appendChild(container);

  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container,
    viewer: viewerEl,
    eventBus,
    linkService,
    textLayerMode: 1, // TextLayerMode.ENABLE（pdf_viewer.mjs 未导出该常量，1 = 默认值）
    annotationMode: 2 // 注释层渲染（链接可点）；表单交互不需要
  });
  linkService.setViewer(viewer);

  type PdfDoc = {
    numPages: number;
    getOutline(): Promise<OutlineNode[] | null>;
    getDestination(d: string): Promise<unknown>;
    getPageIndex(ref: unknown): Promise<number>;
    getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str: string; hasEOL?: boolean }[] }> }>;
    destroy(): Promise<void>;
  };
  let doc: PdfDoc | null = null;
  let destroyed = false;
  let currentPage = 1; // 1 基（PDFViewer.currentPageNumber 同口径）
  let totalPages = 0;
  let lastEmittedPage = 0;

  const relocateHandlers = new Set<(info: RelocateInfo) => void>();
  const linkHandlers = new Set<(info: LinkInfo) => void>();
  const pointerHandlers = new Set<(pos: ContentPointerUpInfo) => void>();
  // v48.39（D79）：多段选择按手势全程判定修饰键——壳层要在拖选起手采样修饰位，故 pointerdown 一并中继
  const pointerDownHandlers = new Set<(pos: ContentPointerDownInfo) => void>();
  const imageHandlers = new Set<(image: ReaderImageRef) => void>();
  let appearance: ReaderAppearance | null = null;
  let darkFilterOn = false;
  // v48.23（D61 §6.8-11）：多段选择高亮——PDF 的选区在宿主文档里，::highlight(multi-select)
  // 规则直接来自 src/theme.css 的 --hl-multi Token（无需注入），故 styleFor 不传。
  const multiHighlight = createMultiHighlight({
    currentDoc() {
      const sel = window.getSelection();
      return sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim() ? document : null;
    }
  });

  // ---------- v48.24 批3（§4 文中留痕）：PDF 的只读标记层 ----------
  // 为什么不是塞进 `.page` 里：深色模式的反色滤镜挂在**整个 viewerEl** 上，塞进去的标记会被
  // invert + hue-rotate 连色相一起转掉（IKB 蓝会被转成另一个色相＝凭空第二个焦点色）。
  // 为什么挂在 host 而不是 container（滚动容器）：绝对定位在滚动容器里的层会**跟着内容一起滚**
  // （inset:0 的参考系是滚动内容原点，实测层顶边比容器视口高一个 scrollTop）——挂 host 上
  // 才能用「页矩形 − 容器视口矩形」直接换算。
  // 代价：位置要跟着滚动/缩放自己重算（syncMarks）；命中判定一律走自算矩形，标记不吃 pointer-events
  // （与 foliate 自带 Overlayer 同做法：pointer-events:none + 手工 hitTest），
  // 于是标记底下的正文照样可以划选/制卡——「只读」不挡路。
  const markLayer = document.createElement("div");
  markLayer.className = "pdf-mark-layer";
  host.appendChild(markLayer);
  // 批 4 Task 16（规格 §5.2）：角标绘制层（与标记层同规：不吃 pointer-events 的纯绘制层）。
  // 颜色一律内联 style.fill（见 src/lib/reader/badges.ts 的两条硬约束）。
  const badgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  badgeLayer.setAttribute("class", "pdf-badge-layer");
  badgeLayer.setAttribute("aria-hidden", "true");
  host.appendChild(badgeLayer);
  type MarkEntry = { mark: ReaderDocMark; ord: number; el: HTMLElement };
  let markEntries: MarkEntry[] = [];
  let docMarks: ReaderDocMark[] = [];
  let hoveredMarkId: string | null = null;
  let syncRaf = 0;

  /**
   * 页内容框（**百分比坐标的参考系**）：pdf.js 的 `.page` 带一圈透明边框（`--page-border`，
   * 默认 9px，实测随缩放 8.8px），canvas/文本层都从**内容框**起算。用边框盒当参考系会
   * 系统性偏移一个边框宽（实测 8.4px），采集与绘制必须同用这一个框。
   */
  const pageContentRect = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    return {
      left: r.left + bl,
      top: r.top + bt,
      width: Math.max(0, r.width - bl - br),
      height: Math.max(0, r.height - bt - bb)
    };
  };

  const layoutMarks = () => {
    if (markEntries.length === 0) return;
    const cRect = container.getBoundingClientRect();
    for (const e of markEntries) {
      const pageIdx = Number(e.mark.pageIndex);
      const rect = e.mark.rects?.[e.ord];
      const pageEl = Number.isFinite(pageIdx)
        ? (viewerEl.querySelector(`.page[data-page-number="${pageIdx + 1}"]`) as HTMLElement | null)
        : null;
      if (!pageEl || !rect) {
        e.el.style.display = "none";
        continue;
      }
      const p = pageContentRect(pageEl);
      if (!(p.width > 0)) {
        e.el.style.display = "none";
        continue;
      }
      // 页内百分比 → 像素：不做取整，浮点 px 让实测矩形与换算值对齐（几何断言才有意义）
      e.el.style.display = "block";
      e.el.style.left = `${p.left - cRect.left + (rect.x / 100) * p.width}px`;
      e.el.style.top = `${p.top - cRect.top + (rect.y / 100) * p.height}px`;
      e.el.style.width = `${Math.max(1, (rect.w / 100) * p.width)}px`;
      e.el.style.height = `${Math.max(1, (rect.h / 100) * p.height)}px`;
    }
    drawMarkBadges();
  };

  /**
   * 角标（批 4 Task 16 / §5.2）：只画**有批注的段锚摘录**（纯高亮与整卡不画，§5.4）；
   * 位置＝该标记首行矩形（PDF 标记本身就是一条 rect，即首行片段）的右上角；
   * 颜色＝该条的批注色（--annot-* 实色）——**内联 style.fill**，不写 CSS 规则。
   */
  const drawMarkBadges = () => {
    const hostRect = viewerEl.getBoundingClientRect();
    badgeLayer.setAttribute("width", String(hostRect.width));
    badgeLayer.setAttribute("height", String(hostRect.height));
    const targets: { right: number; top: number; color: string }[] = [];
    for (const e of markEntries) {
      if (!e.mark.comment) continue;
      if (e.mark.kind === "highlight") continue;
      if (e.el.style.display === "none" || e.ord !== 0) continue;
      const r = e.el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) continue;
      targets.push({ right: r.right, top: r.top, color: annotSolid(e.mark.color, "var(--annot-yellow)") });
    }
    drawBadges(badgeLayer, viewerEl, targets, { left: hostRect.left, top: hostRect.top });
  };

  const syncMarks = () => {
    if (syncRaf || markEntries.length === 0) return;
    syncRaf = window.requestAnimationFrame(() => {
      syncRaf = 0;
      layoutMarks();
    });
  };

  const rebuildMarks = () => {
    markLayer.textContent = "";
    markEntries = [];
    for (const mark of docMarks) {
      (mark.rects ?? []).forEach((_, i) => {
        const el = document.createElement("div");
        // v48.41（D81）：下划线形式＝透明底 + 底边 2px 批注实色线（.is-underline）；其余＝底色高亮
        const underline = mark.annotationType === "underline";
        el.className = `reader-doc-mark card-marked${underline ? " is-underline" : ""}`;
        el.dataset.markId = mark.id;
        if (mark.comment) el.dataset.hasComment = "1";
        // 批 4 修正（规格 §5.4「颜色对应」）：文中高亮＝**该条批注色**的透明档 + 同色左缘条，
        // 与栏内竖线/色点/角标同色。此前一律 accent，导致「角标跟色、高亮不跟色」自相矛盾。
        // 无 annotation_color（老数据/没选过色）回落 accent —— 保持批 3 既有观感与断言。
        el.style.background = underline ? "transparent" : annotSoft(mark.color);
        el.style.borderLeftColor = underline ? "transparent" : annotSolid(mark.color);
        el.style.borderBottomColor = annotSolid(mark.color);
        markLayer.appendChild(el);
        markEntries.push({ mark, ord: i, el });
      });
    }
    markLayer.dataset.count = String(markEntries.length);
    hoveredMarkId = null;
    layoutMarks();
  };

  const hitMark = (clientX: number, clientY: number): { id: string; rect: ReaderRect } | null => {
    for (let i = markEntries.length - 1; i >= 0; i--) {
      const el = markEntries[i].el;
      if (el.style.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return { id: markEntries[i].mark.id, rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
      }
    }
    return null;
  };

  const markHoverHandlers = new Set<(info: MarkPointerInfo) => void>();
  const markClickHandlers = new Set<(info: MarkPointerInfo) => void>();
  const onMarkMove = (ev: MouseEvent) => {
    if (markEntries.length === 0) return;
    const hit = hitMark(ev.clientX, ev.clientY);
    const id = hit?.id ?? null;
    if (id === hoveredMarkId) return; // 只报「进入/离开」的翻转，移动本身不刷事件
    hoveredMarkId = id;
    markHoverHandlers.forEach((h) => h(hit ? { id: hit.id, rect: hit.rect } : { id: null, rect: null }));
  };
  const onMarkLeave = () => {
    if (hoveredMarkId === null) return;
    hoveredMarkId = null;
    markHoverHandlers.forEach((h) => h({ id: null, rect: null }));
  };
  const onMarkClick = (ev: MouseEvent) => {
    if (markEntries.length === 0) return;
    const hit = hitMark(ev.clientX, ev.clientY);
    if (!hit) return;
    // 捕获相位处理 + 阻止传播：点标记＝浮层，不连带触发底下的链接/图片聚焦
    ev.preventDefault();
    ev.stopPropagation();
    markClickHandlers.forEach((h) => h({ id: hit.id, rect: hit.rect }));
  };
  container.addEventListener("mousemove", onMarkMove);
  container.addEventListener("mouseleave", onMarkLeave);
  container.addEventListener("click", onMarkClick, true);
  container.addEventListener("scroll", syncMarks, { passive: true });
  window.addEventListener("resize", syncMarks);
  eventBus.on("pagerendered", syncMarks);
  eventBus.on("scalechanging", syncMarks);
  eventBus.on("scalechanged", syncMarks);

  const fractionOf = (page1Based: number) => (totalPages > 0 ? Math.min(1, Math.max(0, page1Based / totalPages)) : 0);

  const emitRelocate = (page1Based: number) => {
    if (!doc) return;
    currentPage = Math.min(Math.max(1, page1Based), totalPages || 1);
    if (currentPage === lastEmittedPage) return;
    lastEmittedPage = currentPage;
    const info: RelocateInfo = {
      location: { pageIndex: currentPage - 1 },
      fraction: fractionOf(currentPage - 1) + (totalPages > 0 ? 1 / totalPages / 2 : 0),
      chapterIndex: undefined
    };
    relocateHandlers.forEach((h) => h(info));
  };

  // PDFViewer 的页码变化事件：pagechanging（翻页/跳转）+ updateviewarea（滚动跨页）
  eventBus.on("pagechanging", (evt: { pageNumber?: number }) => {
    if (typeof evt?.pageNumber === "number") emitRelocate(evt.pageNumber);
  });
  eventBus.on("updateviewarea", (evt: { location?: { pageNumber?: number } }) => {
    const p = evt?.location?.pageNumber;
    if (typeof p === "number") emitRelocate(p);
  });

  // 文本层 pointerup → 壳层取选区（与 foliate adapter 的中继同构；修饰位一并转发，多段选择判定用）
  viewerEl.addEventListener("pointerup", (ev: PointerEvent) => {
    pointerHandlers.forEach((h) =>
      h({ x: ev.clientX, y: ev.clientY, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey })
    );
  });
  // v48.39（D79）：多段选择按手势全程判定修饰键（起手或收尾任一按住＝加选）——
  // pointerdown 与 pointerup 同构中继，壳层据此在拖选起手采样修饰位
  viewerEl.addEventListener("pointerdown", (ev: PointerEvent) => {
    pointerDownHandlers.forEach((h) =>
      h({ x: ev.clientX, y: ev.clientY, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey })
    );
  });
  // 链接：annotation 层 <a> 点击拦截（外链走系统浏览器，内链按 dest 跳页）
  viewerEl.addEventListener("click", (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const a = target.closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      ev.preventDefault();
      linkHandlers.forEach((h) => h({ internal: false, href }));
    } else if (href.startsWith("#")) {
      ev.preventDefault();
      linkHandlers.forEach((h) => h({ internal: true, href }));
    }
  });
  // 图片点击：canvas 命中 → 快照 dataURL（壳层 loadImageDataUrl 支持 data: 直取，v25 链路复用）。
  // v29 上下文：PDF 无段落 DOM，降级取被点页的文本层文字（图注通常在同页，限长 ~600 字）。
  viewerEl.addEventListener("click", (ev: MouseEvent) => {
    if (imageHandlers.size === 0) return;
    const canvas = (ev.target as HTMLElement | null)?.closest?.("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const r = canvas.getBoundingClientRect();
      const pageDiv = canvas.closest(".page") as HTMLElement | null;
      const contextText = pageDiv
        ? (pageDiv.querySelector(".textLayer")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600) || undefined
        : undefined;
      const image: ReaderImageRef = {
        src: dataUrl,
        alt: "",
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        contextText
      };
      imageHandlers.forEach((h) => h(image));
    } catch {
      /* canvas 污染（tainted）时快照失败则静默跳过 */
    }
  });

  const applyAppearanceToHost = (a: ReaderAppearance) => {
    // 深色模式：canvas 反色滤镜（真机确认；不好则降级"PDF 仅纸白"，见 M6-2 v28 Non-Goals 外观条）
    darkFilterOn = a.theme === "dark";
    viewerEl.style.filter = darkFilterOn ? "invert(0.92) hue-rotate(180deg)" : "";
    host.style.setProperty("--reader-bg", a.bgColor ?? "transparent");
    host.style.setProperty("--reader-fg", a.fgColor ?? "inherit");
    host.style.background = a.bgColor ?? "transparent";
  };

  // v29 缩放：预设适应模式或百分比（zoom 已由 resolveAppearance 归一）
  const applyZoom = (a: ReaderAppearance) => {
    if (!doc) return;
    try {
      if (a.zoom === "page-width") viewer.currentScaleValue = "page-width";
      else if (a.zoom === "page-fit") viewer.currentScaleValue = "page-fit";
      else if (typeof a.zoom === "number") viewer.currentScale = a.zoom / 100;
    } catch {
      /* 缩放失败不阻塞阅读 */
    }
  };

  const kernel: ReaderKernel = {
    async open(source: BookSource, init?: { location?: ReaderLocation }) {
      try {
        // WORKER_URL="__INLINE__"（测试打包）：?url import 拿到的是 worker 文本 → Blob URL 喂给 pdf.js
        const raw = typeof WORKER_URL !== "undefined" && WORKER_URL ? WORKER_URL : (pdfWorkerUrl as unknown as string);
        GlobalWorkerOptions.workerSrc =
          raw === "__INLINE__"
            ? URL.createObjectURL(new Blob([(pdfWorkerUrl as unknown as string)], { type: "text/javascript" }))
            : raw;
      } catch {
        /* workerSrc 不可达时 open 会抛错（pdf.js v6 无主线程回退），由调用方提示 */
      }
      const loadingTask = getDocument({
        data: source.bytes.slice(),
        // cMap/标准字体走 pdfres:// 特权协议（main.js 注册，资源=public/pdfjs 构建时拷进 dist/pdfjs）。
        // 不能用 file:// URL：file:// 页面里 fetch/XHR file:// 子资源被 Chromium 拦截 → 字形数据加载
        // 全部失败 → 白轮廓无文字 + 重试风暴（Firefox 快是因为其内嵌 viewer 无此限制）。
        // 四类资源缺一不可：wasm=JPX/JBIG2 解码器（缺→封面图卡死渲染队列）、icc=色彩、cmap=CJK
        cMapUrl: "pdfres://cmaps/",
        cMapPacked: true,
        iccUrl: "pdfres://iccs/",
        standardFontDataUrl: "pdfres://standard_fonts/",
        wasmUrl: "pdfres://wasm/"
      } as never);
      doc = (await loadingTask.promise) as unknown as PdfDoc;
      console.log("[pdf-dbg] doc loaded, pages:", doc.numPages);
      totalPages = doc.numPages;
      linkService.setDocument(doc as never, null);
      console.log("[pdf-dbg] setDocument begin");
      viewer.setDocument(doc as never);
      console.log("[pdf-dbg] setDocument returned");
      console.log("[pdf-dbg] waiting pagesinit...");
      eventBus.on("pagerendered", (e: unknown) => console.log("[pdf-dbg] pagerendered:", JSON.stringify((e as { pageNumber?: number }).pageNumber)));
      eventBus.on("pageerror", (e: unknown) => console.log("[pdf-dbg] PAGE ERROR:", JSON.stringify((e as { message?: string }).message)));
      eventBus.on("error", (e: unknown) => console.log("[pdf-dbg] bus error:", JSON.stringify(e)));
      // 等待首屏渲染完成再定位（pagesinit 后 currentPageNumber 可写）
      await new Promise<void>((resolve) => {
        const onInit = () => {
          eventBus.off("pagesinit", onInit);
          resolve();
        };
        eventBus.on("pagesinit", onInit);
        window.setTimeout(() => {
          eventBus.off("pagesinit", onInit);
          resolve();
        }, 8000);
      });
      if (destroyed) return;
      const loc = init?.location;
      if (loc?.pageIndex != null) {
        viewer.currentPageNumber = Math.min(Math.max(1, loc.pageIndex + 1), totalPages);
      } else if (loc?.fraction != null && totalPages > 0) {
        viewer.currentPageNumber = Math.min(totalPages, Math.max(1, Math.round(loc.fraction * totalPages)));
      }
      try {
        viewer.scrollPageIntoView({ pageNumber: viewer.currentPageNumber });
        viewer.update();
        console.log("[pdf-dbg] scroll+update ok");
      } catch (e) {
        console.log("[pdf-dbg] scroll/update THREW:", String(e));
      }
      console.log("[pdf-dbg] pagesinit wait done");
      container.classList.remove("pdf-loading");
      // 调试钩子（__readerKernel 同模式）：暴露 viewer 内部渲染状态，供 L1/L2 探针与现场诊断
      (window as unknown as { __pdfViewerDebug?: unknown }).__pdfViewerDebug = viewer;
      currentPage = viewer.currentPageNumber;
      lastEmittedPage = 0;
      emitRelocate(currentPage);
    },

    async goTo(target) {
      if (!doc) return false;
      if ("pageIndex" in target && typeof target.pageIndex === "number") {
        const p = Math.min(Math.max(1, target.pageIndex + 1), totalPages);
        viewer.currentPageNumber = p;
        viewer.scrollPageIntoView({ pageNumber: p });
        return true;
      }
      // 目录 href：本 adapter 的 getTOC 产出 pdfpage:<0基页码>；foliate 系 href 在此不可达
      if ("href" in target && typeof target.href === "string") {
        const m = /^pdfpage:(\d+)$/.exec(target.href);
        if (m && totalPages > 0) {
          const p = Math.min(Math.max(1, Number(m[1]) + 1), totalPages);
          viewer.currentPageNumber = p;
          viewer.scrollPageIntoView({ pageNumber: p });
          return true;
        }
        return false;
      }
      if ("chapterIndex" in target || "cfi" in target) return false; // PDF 系无此概念
      if ("fraction" in target && typeof target.fraction === "number" && totalPages > 0) {
        viewer.currentPageNumber = Math.min(totalPages, Math.max(1, Math.round(target.fraction * totalPages)));
        viewer.scrollPageIntoView({ pageNumber: viewer.currentPageNumber });
        return true;
      }
      if ("search" in target) {
        const query = target.search.trim();
        if (!query || totalPages === 0) return false;
        // 确定性全文扫描：逐页 getTextContent 找首个包含 query 的页（归一化空白后匹配）
        const norm = (s: string) => s.replace(/\s+/g, " ");
        const nq = norm(query);
        for (let i = 1; i <= totalPages; i++) {
          try {
            const tc = await doc.getPage(i).then((p) => p.getTextContent());
            const text = norm(tc.items.map((it) => it.str).join(""));
            if (text.includes(nq)) {
              viewer.currentPageNumber = i;
              viewer.scrollPageIntoView({ pageNumber: i });
              return true;
            }
          } catch {
            /* 单页失败继续 */
          }
        }
        return false;
      }
      return false;
    },

    async next() {
      if (!doc) return false;
      const before = viewer.currentPageNumber;
      if (before >= totalPages) return false;
      viewer.nextPage();
      return viewer.currentPageNumber !== before;
    },

    async prev() {
      if (!doc) return false;
      const before = viewer.currentPageNumber;
      if (before <= 1) return false;
      viewer.previousPage();
      return viewer.currentPageNumber !== before;
    },

    async setMode(mode: ReaderModeConfig) {
      // 阅读模式映射：滚动→VERTICAL；分页单页→PAGE；分页对开→VERTICAL+ODD spread（pdf.js 对开即并排滚动）
      if (mode.flow === "scrolled") {
        viewer.scrollMode = ScrollMode.VERTICAL;
        viewer.spreadMode = SpreadMode.NONE;
      } else if (mode.spread) {
        viewer.scrollMode = ScrollMode.VERTICAL;
        viewer.spreadMode = SpreadMode.ODD;
      } else {
        viewer.scrollMode = ScrollMode.PAGE;
        viewer.spreadMode = SpreadMode.NONE;
      }
    },

    applyAppearance(a: ReaderAppearance) {
      appearance = a;
      applyAppearanceToHost(a);
      applyZoom(a);
    },

    getTOC(): ReaderTocItem[] {
      // 同步快照：open 完成时已缓存大纲（open 内异步填充，见下）
      return tocCache.map((t) => ({ ...t }));
    },

    // v48 批1（M15 §4.19-4）：提取单元 = 逐页（anchor = "pdfpage:<0基页码>"，与目录 href 同域）。
    getSectionAnchors() {
      if (!doc || totalPages <= 0) return [];
      return Array.from({ length: totalPages }, (_, i) => ({ anchor: `pdfpage:${i}` }));
    },

    async getSectionText(startAnchor: string, endAnchor?: string) {
      if (!doc || totalPages <= 0) return "";
      const parse = (a: string) => {
        const m = /^pdfpage:(\d+)$/.exec(String(a ?? ""));
        return m ? Number(m[1]) : null;
      };
      const s = parse(startAnchor);
      if (s == null || s < 0 || s >= totalPages) return "";
      const e = endAnchor != null ? parse(endAnchor) : null;
      // 上界无法解析 → 保守只取 start 页（与 foliate 侧同一保守策略）
      const last = e == null ? s : Math.max(s, Math.min(e - 1, totalPages - 1));
      // canonical 文本形态与 foliate 侧一致：块间（行）\n、行内空白折叠
      const pageText = async (p0: number) => {
        try {
          const tc = await doc!.getPage(p0 + 1).then((pg) => pg.getTextContent());
          return (tc.items as { str: string; hasEOL?: boolean }[])
            .map((it) => it.str + (it.hasEOL ? "\n" : ""))
            .join("")
            .replace(/[ \t\u00a0]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .replace(/\n{2,}/g, "\n")
            .trim();
        } catch {
          return "";
        }
      };
      const parts: string[] = [];
      for (let p = s; p <= last; p++) parts.push(await pageText(p));
      return parts.join("\n");
    },

    getSelection(): ReaderSelection | null {
      // 文本层选区：viewerEl 内的 window.getSelection（跨页选区取首个 range 所在页）
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      const range = sel.getRangeAt(0);
      const pageEl = (range.startContainer as Node).parentElement?.closest?.(".page") as HTMLElement | null;
      const pageNum = pageEl?.dataset?.pageNumber ? Number(pageEl.dataset.pageNumber) : viewer.currentPageNumber;
      const pageIndex = Math.max(0, (Number.isFinite(pageNum) ? pageNum : viewer.currentPageNumber) - 1);
      return { text, pageIndex, anchorText: text.slice(0, 60) };
    },

    // D121 §2.3：PDF 选区前后文——取选区所在页 text layer 文本，以选区文本定位后取其前 600 / 后 400 字
    // （页内近似「前 2 段 / 后 1 段」；无法定位则无前后文，不猜）
    getSelectionContext(): { before: string; after: string } | null {
      try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const selText = sel.toString().replace(/\s+/g, " ").trim();
        if (!selText) return null;
        const range = sel.getRangeAt(0);
        const pageEl = (range.startContainer as Node).parentElement?.closest?.(".page") as HTMLElement | null;
        const layer = pageEl?.querySelector(".textLayer") as HTMLElement | null;
        if (!layer) return null;
        const pageText = (layer.textContent || "").replace(/\s+/g, " ").trim();
        const at = pageText.indexOf(selText);
        if (at < 0) return null;
        const before = pageText.slice(Math.max(0, at - 600), at).trim();
        const after = pageText.slice(at + selText.length, at + selText.length + 400).trim();
        return before || after ? { before, after } : null;
      } catch {
        return null;
      }
    },

    getSelectionGeometry(): ReaderRect | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },

    deselect() {
      window.getSelection()?.removeAllRanges();
    },

    // v48.23（D61 §6.8-11）：多段选择高亮（CSS Custom Highlight API，不碰正文 DOM）
    multiSelectHighlight(action) {
      multiHighlight.update(action);
    },

    clearMultiSelectHighlight() {
      multiHighlight.clear();
      badgeLayer.textContent = "";
    },

    // v48.24 批3（§4）：文中留痕——文本层之上的矩形覆盖层（数据面由壳层给）
    setDocumentMarks(marks) {
      docMarks = Array.isArray(marks) ? marks : [];
      rebuildMarks();
      syncMarks();
    },

    // D67（§6.8-13）：侧栏注解按 id 导航——只认精确 id 与已存的页锚（pageIndex + rects）；
    // 不承诺恢复页内垂直位置，也不回退文本搜索。
    // 成功判据＝**到达所属页且该标记已按该页几何布局完成**（display 由 layoutMarks 置 block，
    // 而 layoutMarks 只在页内容框有宽度时才置 block）。绘制矩形的最终落点还依赖图层 CSS
    // （theme.css 的 .pdf-mark-layer/.reader-doc-mark），那是 L2（marks.gui.mjs）的几何断言面——
    // 本方法只判「条目在该页上」，不把 CSS 缺失/滚动未稳误判成导航失败。
    async goToMark(id: string) {
      const mark = docMarks.find((candidate) => candidate.id === id);
      const pageIndex = Number(mark?.pageIndex);
      if (!mark || !Number.isFinite(pageIndex) || pageIndex < 0 || !(mark.rects?.length)) return false;
      const ok = await kernel.goTo({ pageIndex });
      if (!ok) return false;
      // 等目标页渲染：pagerendered → syncMarks → layoutMarks 才会给该页的标记条目显形。
      const deadline = Date.now() + 10000;
      for (;;) {
        const pageEl = viewerEl.querySelector(`.page[data-page-number="${pageIndex + 1}"]`) as HTMLElement | null;
        const entry = markEntries.find((e) => e.mark.id === id);
        if (pageEl && entry && entry.el.style.display === "block") return true;
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      }
    },

    // v48.24 批3（§4，写入侧）：选区在**本页**里的百分比矩形——摘录 sourceAnchor.rects 的来源。
    // 参考系＝页**内容框**（见 pageContentRect，绘制侧同一个框）；换算复用 occlusion 的 pxShapeToPct
    // （唯一的像素↔百分比实现面，含钳制与一位小数归一）。
    getSourceAnchor(): SourceAnchorGeometry | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (range.collapsed) return null;
      const startEl = (range.startContainer as Node).parentElement?.closest?.(".page") as HTMLElement | null;
      const pageNum = Number(startEl?.dataset?.pageNumber);
      if (!startEl || !Number.isFinite(pageNum)) return null;
      const p = pageContentRect(startEl);
      if (!(p.width > 0) || !(p.height > 0)) return null;
      const rects: NonNullable<SourceAnchorGeometry["rects"]> = [];
      for (const r of Array.from(range.getClientRects())) {
        if (!(r.width > 0) || !(r.height > 0)) continue;
        // 跨页选区只收落在起始页内的矩形：sourceAnchor 的 rects 与 pageIndex 同页才自洽
        if (r.right < p.left + 1 || r.left > p.left + p.width - 1) continue;
        const s = pxShapeToPct(
          { kind: "rect", x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height },
          p.width,
          p.height,
          rects.length
        );
        rects.push({ x: Number(s.x) || 0, y: Number(s.y) || 0, w: Number(s.w) || 0, h: Number(s.h) || 0, ord: rects.length });
      }
      if (rects.length === 0) return null;
      return { pageIndex: pageNum - 1, rects };
    },

    getCurrentLocation(): ReaderLocation | null {
      if (!doc) return null;
      return { pageIndex: viewer.currentPageNumber - 1 };
    },

    // D2/§7（Task 7）：侧栏开合改变容器宽度 ⇒ 数值缩放下页内锚点会漂（pdf.js 只保比例，
    // 不保你正看着的那一点）。快照/还原都用**页内容框**参考系（与 sourceAnchor.rects 同一框）。
    captureViewPoint() {
      const pageEl = viewerEl.querySelector(`.page[data-page-number="${viewer.currentPageNumber}"]`) as HTMLElement | null;
      if (!pageEl) return null;
      const p = pageContentRect(pageEl);
      if (!(p.width > 0 && p.height > 0)) return null;
      const c = container.getBoundingClientRect();
      // 视口左上角落在页内容框里的点（可为负/超出页高——那是「页边留白/已滚过页首」的真实状态）
      return { pageIndex: viewer.currentPageNumber - 1, x: c.left - p.left, y: c.top - p.top };
    },

    restoreViewPoint(point) {
      const pageEl = viewerEl.querySelector(`.page[data-page-number="${point.pageIndex + 1}"]`) as HTMLElement | null;
      if (!pageEl) return false;
      const p = pageContentRect(pageEl);
      if (!(p.width > 0 && p.height > 0)) return false;
      const c = container.getBoundingClientRect();
      // 把该点推回视口左上角：scroll 与视口位移 1:1（横向同样处理，容器可横向滚动时才有意义）
      container.scrollTop += p.top + point.y - c.top;
      container.scrollLeft += p.left + point.x - c.left;
      return true;
    },

    destroy() {
      destroyed = true;
      // 高亮注册在宿主文档上，销毁内核时一并撤掉（否则残影跟着下一个内核）
      multiHighlight.clear();
      // 标记层与它的监听一并撤掉（滚动/缩放监听挂在 window/container 上，不撤会跟着下一个内核）
      container.removeEventListener("mousemove", onMarkMove);
      container.removeEventListener("mouseleave", onMarkLeave);
      container.removeEventListener("click", onMarkClick, true);
      container.removeEventListener("scroll", syncMarks);
      window.removeEventListener("resize", syncMarks);
      if (syncRaf) window.cancelAnimationFrame(syncRaf);
      syncRaf = 0;
      markLayer.remove();
      markEntries = [];
      docMarks = [];
      try {
        viewer.setDocument(null as never);
      } catch {
        /* ignore */
      }
      try {
        void doc?.destroy();
      } catch {
        /* ignore */
      }
      doc = null;
      container.remove();
    },

    on(event: string, handler: (info: never) => void): () => void {
      const set =
        event === "relocate" ? relocateHandlers
        : event === "link" ? linkHandlers
        : event === "contentPointerUp" ? pointerHandlers
        : event === "contentPointerDown" ? pointerDownHandlers
        : event === "imageClick" ? imageHandlers
        : event === "markHover" ? markHoverHandlers
        : event === "markClick" ? markClickHandlers
        : null;
      if (!set) throw new Error(`未知事件: ${event}`);
      set.add(handler as never);
      return () => {
        set.delete(handler as never);
      };
    }
  };

  // 大纲缓存（getTOC 同步接口）：open 完成后异步填充。
  // label 一律带页码后缀：部分 PDF 的大纲标题是程序生成的无意义名（实测有 l1/l2/l3），
  // 页码是唯一可靠信息；dest 解析失败的条目跳过（点击无反应不如不显示）。
  const tocCache: ReaderTocItem[] = [];
  const fillToc = async () => {
    tocCache.length = 0;
    if (!doc) return;
    try {
      const outline = await doc.getOutline();
      const walk = async (entries: OutlineNode[] | null | undefined): Promise<ReaderTocItem[]> => {
        const out: ReaderTocItem[] = [];
        for (const e of entries || []) {
          const page = e.dest != null ? await outlineDestToPage(doc as never, e.dest) : null;
          if (page == null) continue; // dest 解析失败 → 跳过
          const title = String(e.title || "").trim();
          const label = `${title || "未命名章节"} ·第 ${page + 1} 页`;
          out.push({ label, href: `pdfpage:${page}`, subitems: await walk(e.items) });
        }
        return out;
      };
      tocCache.push(...(await walk(outline)));
    } catch {
      /* 无大纲 → 空数组，目录按钮隐藏 */
    }
  };
  const origOpen = kernel.open.bind(kernel);
  kernel.open = async (source: BookSource, init?: { location?: ReaderLocation }) => {
    await origOpen(source, init);
    if (!destroyed) await fillToc();
  };

  void PDF_ENGINE_VERSION;
  return kernel;
}
