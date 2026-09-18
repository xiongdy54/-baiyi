// foliateAdapter——ReaderKernel 的 foliate-js 实现。
// 本目录（src/lib/reader/foliate/**）是全仓库唯一允许依赖 foliate-js 的地方；
// 业务代码一律经由 src/lib/reader/service.ts 创建/使用内核（见 AI_DEVELOPMENT_GUIDE §7 防腐层纪律）。
//
// 使用的 foliate API 白名单（升级 vendor 快照时逐项核对，详见 MANIFEST.json 升级规程）：
//   view.js: <foliate-view> 自定义元素；open/init/goTo/goToFraction/next/prev/search/clearSearch/
//            getCFI/close；'relocate'|'load'|'link'|'external-link' 事件；renderer.setAttribute；
//            renderer.getContents() → [{doc, index}]；book.toc；book.sections[i].id
//   paginator.js: 属性 flow/gap/margin/max-column-count/max-inline-size
import "../../../../vendor/foliate-js/view.js";
import type {
  BookSource,
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
  RelocateInfo
} from "../kernel";
import { fixSvgAspect, injectAppearanceStyle } from "./appearance";
import { getSelectionFromContents, getSelectionGeometryFromContents, pointerToHost } from "./selection";

interface TocNode {
  label?: string;
  href?: string;
  subitems?: TocNode[];
}

type FoliateView = HTMLElement & {
  book: {
    toc?: TocNode[];
    sections: { id?: string; href?: string }[];
    dir?: string;
  } | null;
  renderer: {
    setAttribute(name: string, value: string): void;
    getContents(): { doc: Document; index: number }[];
  } | null;
  open(book: unknown): Promise<void>;
  init(opts?: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: unknown): Promise<{ index: number } | undefined>;
  goToFraction(frac: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  search(opts: { query: string; index?: number }): AsyncGenerator<unknown, void, unknown>;
  clearSearch(): void;
  deselect(): void;
  getCFI(index: number, range?: Range): string;
};

type Handler = (e: CustomEvent) => void;

/**
 * v29 图片周边文字上下文提取（D26）：从章节 DOM 取图片所属块之上 1 个块、之下 2 个块的
 * 文字（各限长 ~500 字）。供 AI 图片制卡结合上下文出题——与图片无关时由模型忽略。
 */
function extractImageContext(doc: Document, img: HTMLElement): string | undefined {
  try {
    const CAP = 500;
    const textOf = (el: Element | null | undefined) =>
      el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, CAP) : "";
    // 图片所属块：img 的最近块级容器（p/li/figure…），退化到直接父节点
    const block = img.closest("p, li, figure, blockquote, div") || img.parentElement;
    if (!block) return undefined;
    // 用户规格：上方 1 段 + 下方 2 段（下方首段常为图注）
    const parts: string[] = [];
    const above = block.previousElementSibling;
    if (above) { const t = textOf(above); if (t) parts.push(t); }
    // 块自身文字（图独立成块时通常为空；图文同块则捕获该段）
    const own = textOf(block);
    if (own) parts.push(own);
    let below = block.nextElementSibling;
    let belowCount = 0;
    while (below && belowCount < 2) {
      const t = textOf(below);
      if (t) { parts.push(t); belowCount++; }
      below = below.nextElementSibling;
    }
    const joined = parts.filter(Boolean).join("\n").trim();
    return joined ? joined.slice(0, 1500) : undefined;
  } catch {
    return undefined;
  }
}

export function createFoliateKernel(host: HTMLElement): ReaderKernel {
  const view = document.createElement("foliate-view") as unknown as FoliateView;
  view.style.display = "block";
  view.style.width = "100%";
  view.style.height = "100%";
  host.appendChild(view);

  const normWs = (s: string) => (s || "").replace(/\s+/g, " ").trim();

  // ---------- v48 批1（M15 §4.19-4）：提取单元（全格式通用能力，业务只经 ReaderKernel 可选方法使用） ----------
  // 单元锚归一：TOC href 可能带 #fragment，而文本区间以 spine section（整个文件）为界——
  // 去片段 + decodeURI 后与 section.id 对比（epub.js 的 section.id = item.href；fb2/mobi/comic 同域）。
  const baseOf = (h: unknown) => {
    const raw = String(h ?? "").split("#")[0];
    try {
      return decodeURI(raw);
    } catch {
      return raw;
    }
  };
  const resolveSectionIndex = (anchor: string): number => {
    const sections = view.book?.sections ?? [];
    const base = baseOf(anchor);
    let i = sections.findIndex((s) => baseOf((s as { id?: string })?.id) === base);
    if (i < 0) i = sections.findIndex((s) => baseOf((s as { href?: string })?.href) === base);
    if (i < 0) {
      // 兜底：部分格式的 book 自带 resolveHref（comic/fb2/mobi）；返回 {index} 或 [index, anchor]
      try {
        const r = (view.book as unknown as { resolveHref?: (h: string) => unknown })?.resolveHref?.(anchor);
        const idx = r && typeof r === "object" ? ((r as { index?: number }).index ?? (r as unknown as number[])[0]) : r;
        if (typeof idx === "number") i = idx;
      } catch {
        /* 保持 -1 */
      }
    }
    return i;
  };
  // canonical 文本抽取（与 PDF 侧同一形态约定）：块级边界 → \n，块内空白折叠；AI 引文与逐字校验共用此输出。
  const documentToText = (doc: Document): string => {
    try {
      const root = (doc.body || doc.documentElement) as Element | null;
      if (!root) return "";
      const clone = root.cloneNode(true) as Element;
      clone.querySelectorAll("script,style,noscript,template,svg,head").forEach((e) => e.remove());
      const owner = clone.ownerDocument ?? doc;
      clone
        .querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,br,tr,blockquote,pre,figcaption,dd,dt,section,article,aside,header,footer,table,ul,ol,hr")
        .forEach((e) => {
          try {
            e.after(owner.createTextNode("\n"));
          } catch {
            /* 单点失败不影响整体 */
          }
        });
      return (clone.textContent || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v\u00a0\u200b]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    } catch {
      return "";
    }
  };

  const relocateHandlers = new Set<(info: RelocateInfo) => void>();
  const linkHandlers = new Set<(info: LinkInfo) => void>();
  const pointerHandlers = new Set<(pos: { x: number; y: number }) => void>();
  const imageHandlers = new Set<(image: ReaderImageRef) => void>();
  const docs = new Map<number, Document>();
  let lastRelocate: RelocateInfo | null = null;
  let appearance: ReaderAppearance | null = null;
  let currentFlow: "scrolled" | "paged" = "scrolled";

  const on = (event: string, handler: Handler) => {
    view.addEventListener(event, handler as EventListener);
    return () => view.removeEventListener(event, handler as EventListener);
  };

  on("load", (e: CustomEvent) => {
    const { doc, index } = e.detail as { doc: Document; index: number };
    docs.set(index, doc);
    if (appearance) injectAppearanceStyle(doc, appearance, currentFlow);
    if (currentFlow !== "paged") fixSvgAspect(doc);
    // iframe 内按键不会冒泡到宿主文档——转发给宿主（壳层的翻页/快捷键监听在宿主侧）
    doc.addEventListener("keydown", (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ev.key, code: ev.code, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, metaKey: ev.metaKey })
      );
    });
    // iframe 内的 pointer 事件不会冒泡到宿主文档——adapter 中继并换算为宿主坐标
    doc.addEventListener("pointerup", (ev: PointerEvent) => {
      const pos = pointerToHost(doc, ev.clientX, ev.clientY);
      pointerHandlers.forEach((h) => h(pos));
    });
    // v25 图片点选：正文图片点击 → 语义化为 ReaderImageRef（src + 宿主坐标框）。
    // 链接内的图片让位给链接（foliate 自带的 click 处理器负责导航），不dual触发图片聚焦。
    doc.addEventListener("click", (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;
      const img = target.closest("img") as HTMLImageElement | null;
      if (!img || imageHandlers.size === 0) return;
      if (img.closest("a")) return;
      const r = img.getBoundingClientRect();
      const topLeft = pointerToHost(doc, r.left, r.top);
      const image: ReaderImageRef = {
        src: img.currentSrc || img.src || "",
        alt: img.getAttribute("alt") || "",
        rect: { x: topLeft.x, y: topLeft.y, width: r.width, height: r.height },
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        contextText: extractImageContext(doc, img)
      };
      if (!image.src) return;
      imageHandlers.forEach((h) => h(image));
    });
  });

  on("relocate", (e: CustomEvent) => {
    const d = e.detail as {
      cfi: string;
      fraction: number;
      section?: { current: number; total: number };
    };
    const chapterIndex = d.section?.current ?? 0;
    const info: RelocateInfo = {
      location: { cfi: d.cfi },
      fraction: typeof d.fraction === "number" ? d.fraction : 0,
      chapterIndex,
      chapterHref: view.book?.sections?.[chapterIndex]?.id
    };
    lastRelocate = info;
    relocateHandlers.forEach((h) => h(info));
  });

  // 外链：拦截默认行为（foliate 否则会 globalThis.open），交给壳层走系统浏览器
  on("external-link", (e: CustomEvent) => {
    e.preventDefault();
    const info: LinkInfo = { internal: false, href: String(e.detail?.href_ ?? "") };
    linkHandlers.forEach((h) => h(info));
  });
  // 内链：foliate 自行按 CFI/章节精确跳转，这里仅作为信息事件转发
  on("link", (e: CustomEvent) => {
    const info: LinkInfo = { internal: true, href: String(e.detail?.href ?? "") };
    linkHandlers.forEach((h) => h(info));
  });

  const applyRendererSettings = (a: ReaderAppearance | null, mode: ReaderModeConfig | null) => {
    const r = view.renderer;
    if (!r) return;
    if (mode) {
      r.setAttribute("flow", mode.flow === "scrolled" ? "scrolled" : "paginated");
      r.setAttribute("max-column-count", mode.flow === "paged" && mode.spread ? "2" : "1");
    }
    // v37：margin 必须带 px 单位——paginator 把属性值直接写进 CSS 变量 --_margin，
    // 无单位数字会让 minmax(var(--_margin),1fr) 整条 grid-template-rows 失效，
    // 分页模式页面高度塌缩到内容自适应高度且形成自锁回路（实测每页只剩 ~318px）
    if (a?.margin != null) r.setAttribute("margin", `${a.margin}px`);
  };

  const applyToHost = (a: ReaderAppearance) => {
    // ::part(filter)（paginator 的背景层）随文档底色，保证自定义背景贯穿整个视口
    host.style.setProperty("--reader-bg", a.bgColor ?? "transparent");
    host.style.setProperty("--reader-fg", a.fgColor ?? "inherit");
    host.style.background = a.bgColor ?? "transparent";
  };

  const kernel: ReaderKernel = {
    async open(source: BookSource, init?: { location?: ReaderLocation }) {
      // M6-3（v30）：MIME 按扩展名映射——foliate makeBook 用魔数分发 ZIP/MOBI，
      // 但 CBZ/FB2/FBZ 的判定依赖扩展名或 MIME，故文件名与 type 都要保真
      const fileName = source.name || "book.epub";
      const ext = fileName.split(".").pop()?.toLowerCase() || "epub";
      const MIME_BY_EXT: Record<string, string> = {
        epub: "application/epub+zip",
        cbz: "application/vnd.comicbook+zip",
        fb2: "application/x-fictionbook+xml",
        fbz: "application/x-zip-compressed-fb2",
        mobi: "application/x-mobipocket-ebook",
        azw: "application/vnd.amazon.ebook",
        azw3: "application/vnd.amazon.ebook"
      };
      const file = new File([source.bytes as unknown as BlobPart], fileName, {
        type: MIME_BY_EXT[ext] || "application/epub+zip"
      });
      await view.open(file);
      if (init?.location?.cfi) {
        await view.init({ lastLocation: init.location.cfi });
      } else {
        await view.init({});
        if (init?.location?.fraction != null) await view.goToFraction(init.location.fraction);
      }
    },

    async goTo(target) {
      if ("chapterIndex" in target) {
        return Boolean(await view.goTo(target.chapterIndex));
      }
      if ("href" in target) {
        return Boolean(await view.goTo(target.href));
      }
      if ("search" in target) {
        // 文本搜索定位（存量 anchorText 兜底链最后一环）：取首个命中即止，清掉搜索高亮
        let found: string | null = null;
        for await (const r of view.search({ query: target.search })) {
          if (r === "done") break;
          if (!r || typeof r !== "object") continue;
          const obj = r as { cfi?: string; subitems?: { cfi: string }[] };
          // 单章搜索产 {cfi}；整书搜索产 {index, subitems}——取首个命中即止
          if (obj.cfi) {
            found = obj.cfi;
            break;
          }
          if (obj.subitems?.length) {
            found = obj.subitems[0].cfi;
            break;
          }
        }
        view.clearSearch();
        if (!found) return false;
        return Boolean(await view.goTo(found));
      }
      // foliate 引擎只认 CFI/fraction：PDF 系的 {pageIndex} 在此分支不可达（ReaderEngine 按 engine 分流），
      // 但类型上联合 → 此处收窄：非 cfi/fraction 目标直接返回 false（由 search 兜底链继续）
      if (!("cfi" in target) && !("fraction" in target)) return false;
      const loc = target as { cfi?: string; fraction?: number };
      const ok = Boolean(await view.goTo(loc.cfi));
      if (!ok && loc.fraction != null) {
        await view.goToFraction(loc.fraction);
        return true;
      }
      return ok;
    },

    async next() {
      const before = kernel.getCurrentLocation()?.cfi;
      await view.next();
      return kernel.getCurrentLocation()?.cfi !== before;
    },

    async prev() {
      const before = kernel.getCurrentLocation()?.cfi;
      await view.prev();
      return kernel.getCurrentLocation()?.cfi !== before;
    },

    async setMode(mode) {
      currentFlow = mode.flow;
      docs.forEach((doc) => {
        if (appearance) injectAppearanceStyle(doc, appearance, currentFlow);
        if (currentFlow !== "paged") fixSvgAspect(doc);
      });
      applyRendererSettings(null, mode);
    },

    applyAppearance(a) {
      appearance = a;
      applyToHost(a);
      applyRendererSettings(a, null);
      docs.forEach((doc) => {
        injectAppearanceStyle(doc, a, currentFlow);
        if (currentFlow !== "paged") fixSvgAspect(doc);
      });
    },

    getTOC(): ReaderTocItem[] {
      const mapItem = (t: TocNode): ReaderTocItem => ({
        label: String(t.label ?? "").trim(),
        href: String(t.href ?? ""),
        subitems: Array.isArray(t.subitems) ? t.subitems.map(mapItem) : undefined
      });
      return (view.book?.toc ?? []).map(mapItem).filter((t) => t.href);
    },

    // v48 批1：提取单元清单（spine 顺序即文档序）。无 createDocument 的格式（如 CBZ 图片书）单元仍在列，
    // 但 getSectionText 取到空串——由业务预览层如实显示 0 字。
    getSectionAnchors() {
      const sections = (view.book?.sections ?? []) as { id?: string; href?: string }[];
      return sections
        .map((s) => ({ anchor: String(s?.id ?? s?.href ?? "") }))
        .filter((u) => u.anchor);
    },

    async getSectionText(startAnchor: string, endAnchor?: string) {
      const sections = (view.book?.sections ?? []) as { createDocument?: () => Promise<Document> }[];
      const i = resolveSectionIndex(startAnchor);
      if (i < 0 || i >= sections.length) return "";
      let last = i;
      if (endAnchor != null) {
        const j = resolveSectionIndex(endAnchor);
        // 上界无法解析 → 保守只取 start 单元（宁少取不误取；调用方按单元遍历不依赖跨区间）
        if (j >= 0) last = Math.max(i, j - 1);
      }
      const parts: string[] = [];
      for (let k = i; k <= last && k < sections.length; k++) {
        const make = sections[k]?.createDocument;
        if (typeof make !== "function") {
          parts.push("");
          continue;
        }
        try {
          parts.push(documentToText(await make.call(sections[k])));
        } catch {
          parts.push("");
        }
      }
      return parts.join("\n");
    },

    getSelection(): ReaderSelection | null {
      const r = view.renderer;
      if (!r) return null;
      return getSelectionFromContents(view, r.getContents());
    },

    // v35 正文图片定位：按 alt/周边文字在各章节 DOM 找回原图并滚到可见，返回宿主坐标框。
    // 引擎 iframe 对宿主跨源，DOM 操作只能在本 adapter 内做（kernel.locateImage 契约）。
    async locateImage(query: ImageLocateQuery): Promise<ImageLocateHit | null> {
      const alt = normWs(query.alt || "");
      const ctxKey = normWs(query.contextText || "").slice(0, 40);
      if (!alt && !ctxKey) return null;
      const candidates: { img: HTMLImageElement; doc: Document; score: number }[] = [];
      docs.forEach((doc) => {
        (Array.from(doc.querySelectorAll("img")) as HTMLImageElement[]).forEach((img) => {
          let score = 0;
          const imgAlt = normWs(img.getAttribute("alt") || "");
          if (alt && imgAlt && (imgAlt === alt || imgAlt.includes(alt) || alt.includes(imgAlt))) score += 4;
          if (ctxKey) {
            const around = normWs(extractImageContext(doc, img) || "");
            if (around && around.includes(ctxKey)) score += 2;
          }
          if (score > 0) candidates.push({ img, doc, score });
        });
      });
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      const { img, doc } = candidates[0];
      try {
        img.scrollIntoView({ block: "center" });
      } catch {
        return null;
      }
      // 等排版/滚动稳定后再取宿主坐标（分页模式下 foliate 会重排）
      await new Promise((r) => window.setTimeout(r, 400));
      const r = img.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return null;
      const topLeft = pointerToHost(doc, r.left, r.top);
      return { rect: { x: topLeft.x, y: topLeft.y, width: r.width, height: r.height } };
    },

    getSelectionGeometry(): ReaderRect | null {
      const r = view.renderer;
      if (!r) return null;
      return getSelectionGeometryFromContents(r.getContents());
    },

    deselect() {
      view.deselect();
    },

    getCurrentLocation(): ReaderLocation | null {
      return lastRelocate?.location ?? null;
    },

    destroy() {
      try {
        view.close();
      } catch {
        /* 已销毁则忽略 */
      }
      view.remove();
      docs.clear();
      relocateHandlers.clear();
      linkHandlers.clear();
      pointerHandlers.clear();
      imageHandlers.clear();
    },

    on(event, handler) {
      if (event === "relocate") {
        const h = handler as (info: RelocateInfo) => void;
        relocateHandlers.add(h);
        return () => relocateHandlers.delete(h);
      }
      if (event === "link") {
        const h = handler as (info: LinkInfo) => void;
        linkHandlers.add(h);
        return () => linkHandlers.delete(h);
      }
      if (event === "imageClick") {
        const h = handler as (image: ReaderImageRef) => void;
        imageHandlers.add(h);
        return () => imageHandlers.delete(h);
      }
      const h = handler as (pos: { x: number; y: number }) => void;
      pointerHandlers.add(h);
      return () => pointerHandlers.delete(h);
    }
  };

  // 测试钩子（非 Kernel 接口）：L1 契约测试需要直接操作章节 iframe 文档（注入选区/派发点击）
  (kernel as ReaderKernel & { __getContents(): { doc: Document; index: number }[] }).__getContents =
    () => view.renderer?.getContents() ?? [];

  return kernel;
}
