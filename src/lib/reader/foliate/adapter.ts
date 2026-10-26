// foliateAdapter——ReaderKernel 的 foliate-js 实现。
// 本目录（src/lib/reader/foliate/**）是全仓库唯一允许依赖 foliate-js 的地方；
// 业务代码一律经由 src/lib/reader/service.ts 创建/使用内核（见 AI_DEVELOPMENT_GUIDE §7 防腐层纪律）。
//
// 使用的 foliate API 白名单（升级 vendor 快照时逐项核对，详见 MANIFEST.json 升级规程）：
//   view.js: <foliate-view> 自定义元素；open/init/goTo/goToFraction/next/prev/search/clearSearch/
//            getCFI/resolveCFI/close；'relocate'|'load'|'link'|'external-link' 事件；renderer.setAttribute；
//            renderer.getContents() → [{doc, index}]；book.toc；book.sections[i].id
//   paginator.js: 属性 flow/gap/margin/max-column-count/max-inline-size/animated
//            （D130 R3：animated 不在 paginator observedAttributes，但两处消费点都是 hasAttribute
//             即时读取——setAttribute/removeAttribute 即刻影响下一次翻页，零 vendor 补丁）
import "../../../../vendor/foliate-js/view.js";
import type {
  BookSource,
  ContentPointerDownInfo,
  ContentPointerUpInfo,
  ImageLocateHit,
  ImageLocateQuery,
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
  ReaderStructureRegion,
  ReaderTocItem,
  RelocateInfo
} from "../kernel";
import { buildTextIndex, findFlatSpan, spanToRange } from "../textRange";
import { fixSvgAspect, injectAppearanceStyle, type ReaderAppearanceEx } from "./appearance";
import { getSelectionFromContents, getSelectionGeometryFromContents, pointerToHost } from "./selection";
import { createMultiHighlight, MULTI_HIGHLIGHT_NAME } from "../multiHighlight";
import { annotKey, annotSoft, annotSolid } from "../annotColor";
import { isTextEntryTarget, isNativeControlKey } from "../../keyTarget";

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
    removeAttribute(name: string): void;
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
  /** CFI → {章节索引, anchor}（anchor 是 Range 或 doc→Range 的函数）；文中留痕据此把 cfi 画成高亮 */
  resolveCFI?(cfi: string): { index: number; anchor: unknown };
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

/**
 * D121 §2.3 选区前后文：与 extractImageContext 同思路（块级容器 + 兄弟块），但以选区 Range 起点为准。
 * 选区所在块内位于选区之前/之后的文字各计 1 段（与 paragraphContext 对同段的处理一致），
 * 再向外补前 2 段 / 后 1 段有文本的兄弟块；before ≤600（远端截断）、after ≤400，段内空白归一。
 */
function extractSelectionContext(range: Range): { before: string; after: string } | null {
  try {
    const BEFORE_CAP = 600;
    const AFTER_CAP = 400;
    const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const startEl = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
    if (!startEl) return null;
    const block = startEl.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, div") || startEl;
    const pre = block.ownerDocument.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = block.ownerDocument.createRange();
    post.selectNodeContents(block);
    post.setStart(range.endContainer, range.endOffset);
    const before: string[] = [];
    const ownBefore = norm(pre.toString());
    if (ownBefore) before.unshift(ownBefore);
    let prev = block.previousElementSibling;
    while (prev && before.length < 2) {
      const t = norm(prev.textContent);
      if (t) before.unshift(t);
      prev = prev.previousElementSibling;
    }
    let after = norm(post.toString());
    if (!after) {
      let next = block.nextElementSibling;
      while (next && !after) {
        after = norm(next.textContent);
        next = next.nextElementSibling;
      }
    }
    let b = before.join("\n");
    if (b.length > BEFORE_CAP) b = b.slice(b.length - BEFORE_CAP);
    if (after.length > AFTER_CAP) after = after.slice(0, AFTER_CAP);
    return b || after ? { before: b, after } : null;
  } catch {
    return null;
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

  // C-09 纵深防御（真实拦截靠 CSP）：剔除 EPUB 文档里的脚本与内联事件处理器。
  // load 事件晚于文档解析——首屏内联 <script> 由 CSP 拦截，这里清理的是之后仍可触发的 on* 与再插入脚本。
  const stripActiveContent = (doc: Document): void => {
    try {
      doc.querySelectorAll("script").forEach((s) => s.remove());
      doc.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        }
      });
    } catch {
      /* 单点失败不阻断阅读 */
    }
  };

  const relocateHandlers = new Set<(info: RelocateInfo) => void>();
  const linkHandlers = new Set<(info: LinkInfo) => void>();
  const pointerHandlers = new Set<(pos: ContentPointerUpInfo) => void>();
  // v48.39（D79）：多段选择按手势全程判定修饰键——壳层要在拖选起手采样修饰位，故 pointerdown 一并中继
  const pointerDownHandlers = new Set<(pos: ContentPointerDownInfo) => void>();
  const imageHandlers = new Set<(image: ReaderImageRef) => void>();
  const docs = new Map<number, Document>();
  let lastRelocate: RelocateInfo | null = null;
  /** 阅读透镜探针：最近一次 relocate 的可见起点 Range 与章节下标（getReadingProbe 用） */
  let lastProbe: { range: Range | null; index: number } | null = null;
  let appearance: ReaderAppearance | null = null;
  let currentFlow: "scrolled" | "paged" = "scrolled";
  let pendingMode: ReaderModeConfig | null = null;
  // v48.23（D61 §6.8-11）：多段选择高亮——两个引擎共用的实现（见 ../multiHighlight.ts）。
  // iframe 文档拿不到宿主的 Token，故把 --hl-multi 的求值结果以字面值注入该文档的 <style>
  // （与外观注入同一做法；宿主侧则直接吃 src/theme.css 的 ::highlight(multi-select) 规则）。
  const multiHighlight = createMultiHighlight({
    currentDoc() {
      for (const { doc } of view.renderer?.getContents() ?? []) {
        const sel = doc.defaultView?.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim()) return doc;
      }
      return null;
    },
    styleFor() {
      const value = getComputedStyle(document.body).getPropertyValue("--hl-multi").trim();
      return `::highlight(${MULTI_HIGHLIGHT_NAME}){background-color:${value || "color-mix(in srgb, #166a59 22%, transparent)"};}`;
    }
  });

  // ---------- v48.24 批3（§4 文中留痕）：EPUB 的常驻标记（cfi → Range → CSS Custom Highlight） ----------
  // 与多段选择同一套做法（只画绘制层、不碰正文 DOM），只是高亮名与来源不同：
  // 多段＝当前选区（活对象，换章即清），标记＝落库的根摘录 cfi（换章后按 'load' 重画）。
  // iframe 拿不到宿主 Token，故同样把 --accent-soft 的求值结果以字面值注入该文档的 <style>。
  const MARK_HIGHLIGHT_NAME = "extract-mark";
  let docMarks: ReaderDocMark[] = [];
  /** 各章节文档当前的标记段（命中判定用；绘制与命中都不靠 pointer-events） */
  const markRanges = new Map<Document, { id: string; range: Range }[]>();
  const markStyles = new Map<Document, HTMLStyleElement>();
  /** 本档已注册的高亮名（按色分组；重画时先全撤再重建） */
  const registeredHighlightNames = new Map<Document, string[]>();
  let hoveredMarkId: string | null = null;
  const markHoverHandlers = new Set<(info: MarkPointerInfo) => void>();
  const markClickHandlers = new Set<(info: MarkPointerInfo) => void>();

  type HighlightWin = Window & {
    CSS?: { highlights?: { set(name: string, hl: unknown): void; delete(name: string): boolean; has?(name: string): boolean } };
    Highlight?: new (...ranges: Range[]) => unknown;
  };
  const winOf = (doc: Document) => (doc.defaultView ?? null) as HighlightWin | null;

  /** 把任意 CSS 颜色表达式在**宿主侧**求值成字面颜色（iframe 里没有那些 Token） */
  const evalColor = (css: string, fallback: string) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;width:0;height:0;display:none;background:${css};`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value && value !== "rgba(0, 0, 0, 0)" ? value : fallback;
  };
  /**
   * 按（色键×形式）分组的注入规则（批 4 修正，规格 §5.4「颜色对应」；v48.41/D81 增下划线形式）：
   * 底色形式＝该条批注色的透明档，与栏内竖线/色点/角标同色；
   * 下划线形式＝透明底 + 批注实色 2px 下划线（::highlight 允许 text-decoration）。
   * `::highlight` 一个注册名只能一种画法 ⇒ 按（色×形式）开多条规则（`extract-mark` 保给默认色，
   * 其余 `extract-mark-<色键>` / `-<色键>u`）——批 3 的既有断言（无色的标记走 `extract-mark`）不破。
   */
  const markKeyFor = (m: ReaderDocMark) => `${annotKey(m.color)}${m.annotationType === "underline" ? "|u" : ""}`;
  const markStyleCss = () => {
    const keys = new Set<string>(["default"]);
    for (const m of docMarks) keys.add(markKeyFor(m));
    return [...keys]
      .map((k) => {
        const underline = k.endsWith("|u");
        const bare = k.replace(/\|u$/, "");
        if (underline && bare !== "default") {
          // v48.45（D85）：下划线颜色必须**在宿主侧求成字面实色**再注入——annotSolid 对色板 id
          // 返回 var(--annot-*)，而这段 CSS 落在 foliate iframe 文档里（没有宿主 Token），
          // var 解不动 → IACVT 回落 currentColor（文字色＝黑），用户实测「下划线始终是黑色」。
          // 底色分支早就走 evalColor 求字面值，这里补齐同一道。
          const solid = evalColor(annotSolid(bare.startsWith("hex-") ? `#${bare.slice(4)}` : bare), "#166a59");
          return `::highlight(${highlightNameFor(k)}){background-color:transparent;text-decoration:underline;text-decoration-color:${solid};text-decoration-thickness:2px;text-underline-offset:3px;}`;
        }
        const soft = k === "default" ? "var(--accent-soft)" : annotSoft(bare.startsWith("hex-") ? `#${bare.slice(4)}` : bare);
        const value = evalColor(soft, "color-mix(in srgb, #166a59 8%, transparent)");
        return `::highlight(${highlightNameFor(k)}){background-color:${value};}`;
      })
      .join("\n");
  };
  const highlightNameFor = (key: string) => (key === "default" ? MARK_HIGHLIGHT_NAME : `${MARK_HIGHLIGHT_NAME}-${key.replace(/[^a-z0-9-]/gi, "")}`);
  /** 注入/更新该文档的标记高亮规则（主题切换后要重算：值派生自 --accent，两档不同） */
  const ensureMarkStyle = (doc: Document) => {
    const css = markStyleCss();
    let el = markStyles.get(doc);
    if (!el || !el.isConnected) {
      el = doc.createElement("style");
      el.setAttribute("data-reader-extract-mark", "1");
      (doc.head ?? doc.documentElement)?.appendChild(el);
      markStyles.set(doc, el);
    }
    if (el.textContent !== css) el.textContent = css;
  };

  const resolveMarkRange = (cfi: string, index: number, doc: Document): Range | null => {
    try {
      const res = view.resolveCFI?.(cfi);
      if (!res || Number(res.index) !== index) return null; // 这一段 cfi 不属于本篇文档
      const anchor = res.anchor;
      const range = typeof anchor === "function" ? (anchor as (d: Document) => Range)(doc) : (anchor as Range | undefined);
      return range && range.startContainer?.isConnected ? range : null;
    } catch {
      return null; // cfi 解不动（结构变了/非文本书）→ 静默跳过这一条，别的标记照画
    }
  };

  const paintMarksForDoc = (index: number) => {
    const doc = docs.get(index);
    if (!doc) return;
    const entries: { id: string; range: Range }[] = [];
    for (const mark of docMarks) {
      if (!mark.cfi) continue;
      const range = resolveMarkRange(mark.cfi, index, doc);
      if (range) entries.push({ id: mark.id, range });
    }
    markRanges.set(doc, entries);
    const win = winOf(doc);
    if (!win?.CSS?.highlights || typeof win.Highlight !== "function") return; // 环境不支持 → 静默降级（阅读不受影响）
    // 先撤掉本档此前注册过的全部色组（重画＝清空 + 全量重建，禁增量补丁）
    for (const name of registeredHighlightNames.get(doc) ?? []) win.CSS.highlights.delete(name);
    const byKey = new Map<string, Range[]>();
    for (const mark of docMarks) {
      if (!mark.cfi) continue;
      const hit = entries.find((e) => e.id === mark.id);
      if (!hit) continue;
      const k = markKeyFor(mark);
      byKey.set(k, [...(byKey.get(k) ?? []), hit.range]);
    }
    if (byKey.size === 0) {
      registeredHighlightNames.set(doc, []);
      return;
    }
    ensureMarkStyle(doc);
    const names: string[] = [];
    for (const [k, ranges] of byKey) {
      const name = highlightNameFor(k);
      win.CSS.highlights.set(name, new win.Highlight(...ranges));
      names.push(name);
    }
    registeredHighlightNames.set(doc, names);
  };
  const paintAllMarks = () => {
    for (const index of docs.keys()) paintMarksForDoc(index);
  };

  // ---------- 阅读透镜 v2：结构强调（图谱节点 ↔ 正文段落） ----------
  // 与标记同一套绘制层做法；名字独立（structure-focus / structure-hover），优先级低于摘录标记之下的选区、高于无。
  const STRUCT_NAMES = { focus: "structure-focus", hover: "structure-hover" } as const;
  let structRegions: ReaderStructureRegion[] = [];
  const structStyles = new Map<Document, HTMLStyleElement>();
  const structCss = () => {
    const focus = evalColor("color-mix(in srgb, var(--accent) 13%, transparent)", "rgba(22, 106, 89, 0.13)");
    const hover = evalColor("color-mix(in srgb, var(--accent) 26%, transparent)", "rgba(22, 106, 89, 0.26)");
    return `::highlight(${STRUCT_NAMES.focus}){background-color:${focus};}\n::highlight(${STRUCT_NAMES.hover}){background-color:${hover};}`;
  };
  const paintStructForDoc = (index: number) => {
    const doc = docs.get(index);
    if (!doc) return;
    const win = winOf(doc);
    if (!win?.CSS?.highlights || typeof win.Highlight !== "function") return;
    win.CSS.highlights.delete(STRUCT_NAMES.focus);
    win.CSS.highlights.delete(STRUCT_NAMES.hover);
    const mine = structRegions.filter((r) => resolveSectionIndex(r.unitAnchor) === index);
    if (!mine.length) return;
    let el = structStyles.get(doc);
    if (!el || !el.isConnected) {
      el = doc.createElement("style");
      el.setAttribute("data-reader-structure", "1");
      (doc.head ?? doc.documentElement)?.appendChild(el);
      structStyles.set(doc, el);
    }
    const css = structCss();
    if (el.textContent !== css) el.textContent = css;
    const root = (doc.body || doc.documentElement) as Node | null;
    if (!root) return;
    const idx = buildTextIndex(root);
    const by: Record<"focus" | "hover", Range[]> = { focus: [], hover: [] };
    for (const r of mine) {
      const span = findFlatSpan(idx, r.head, r.tail);
      const range = span ? spanToRange(doc, idx, span) : null;
      if (range) by[r.tone === "hover" ? "hover" : "focus"].push(range);
    }
    const HL = win.Highlight as new (...ranges: Range[]) => { priority?: number };
    if (by.focus.length) {
      const h = new HL(...by.focus);
      h.priority = -2;
      win.CSS.highlights.set(STRUCT_NAMES.focus, h);
    }
    if (by.hover.length) {
      const h = new HL(...by.hover);
      h.priority = -1;
      win.CSS.highlights.set(STRUCT_NAMES.hover, h);
    }
  };
  const paintAllStruct = () => {
    for (const index of docs.keys()) paintStructForDoc(index);
  };
  /** 主题切换后重算各文档的注入样式（值派生自 --accent，深浅两档不同） */
  const refreshMarkStyles = () => {
    markStyles.forEach((_, doc) => ensureMarkStyle(doc));
  };

  /**
   * D67 §3：注解栏「位置」序的引擎侧来源——各已加载文档按**章节序**，文档内按 Range 文档序。
   * CFI 字符串序不是文档序（不许拿它比较），只能在引擎里 resolve 后用 Range 比。
   */
  const collectMarkOrder = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const bySection = [...docs.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, doc] of bySection) {
      const entries = (markRanges.get(doc) ?? []).filter((e) => e.range.startContainer.isConnected);
      // Range 只能在同文档内比较（跨文档 throws）；同文档内按起点序＝文档序
      entries.sort((a, b) => {
        try {
          return a.range.compareBoundaryPoints(Range.START_TO_START, b.range);
        } catch {
          return 0; // 已分离/不可比的段保持现有序（稳定回退，不臆造先后）
        }
      });
      for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e.id);
      }
    }
    return out;
  };

  /** 该 id 当前可解析到的标记段（跨已加载文档；命中即证明目标位置可解析） */
  const hasResolvedMark = (id: string): boolean => {
    for (const entries of markRanges.values()) {
      const hit = entries.find((entry) => entry.id === id);
      if (hit && hit.range.startContainer.isConnected) return true;
    }
    return false;
  };

  /** 命中判定：标记不吃 pointer-events（正文照常可划选），改按各段 Range 的实时矩形自算 */
  const hitMarkIn = (doc: Document, clientX: number, clientY: number) => {
    const entries = markRanges.get(doc) ?? [];
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect() ?? null;
    for (let i = entries.length - 1; i >= 0; i--) {
      for (const r of Array.from(entries[i].range.getClientRects())) {
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return {
            id: entries[i].id,
            rect: { x: (frame?.left ?? 0) + r.left, y: (frame?.top ?? 0) + r.top, width: r.width, height: r.height }
          };
        }
      }
    }
    return null;
  };

  const on = (event: string, handler: Handler) => {
    view.addEventListener(event, handler as EventListener);
    return () => view.removeEventListener(event, handler as EventListener);
  };

  on("load", (e: CustomEvent) => {
    const { doc, index } = e.detail as { doc: Document; index: number };
    stripActiveContent(doc);
    docs.set(index, doc);
    if (appearance) injectAppearanceStyle(doc, appearance, currentFlow);
    if (currentFlow !== "paged") fixSvgAspect(doc);
    // iframe 内按键不会冒泡到宿主文档——转发给宿主（壳层的翻页/快捷键监听在宿主侧）
    doc.addEventListener("keydown", (ev: KeyboardEvent) => {
      // D227：与宿主同一口径（文本输入让路；控件原生键留给控件）
      if (isTextEntryTarget(ev.target) || isNativeControlKey(ev)) return;
      // repeat 随转发（D227）：宿主分发器忽略长按连发，转发丢了它＝在正文里按住键会连发命令
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ev.key, code: ev.code, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, metaKey: ev.metaKey, repeat: ev.repeat })
      );
    });
    // iframe 内的 pointer 事件不会冒泡到宿主文档——adapter 中继并换算为宿主坐标
    // （v48.23 / D61 §6.8-11：连同指针事件的修饰位一起转发——多段选择靠它判定「按住 Ctrl 加选」；
    //   iframe 内的 keyup 不会转发到宿主，故修饰键状态只能从指针事件本身取，不能靠宿主 keydown 跟踪）
    doc.addEventListener("pointerup", (ev: PointerEvent) => {
      const pos = pointerToHost(doc, ev.clientX, ev.clientY);
      pointerHandlers.forEach((h) =>
        h({ ...pos, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey })
      );
    });
    // v48.39（D79）：多段选择按手势全程判定修饰键（起手或收尾任一按住＝加选）——
    // pointerdown 与 pointerup 同构中继，壳层据此在拖选起手采样修饰位
    doc.addEventListener("pointerdown", (ev: PointerEvent) => {
      const pos = pointerToHost(doc, ev.clientX, ev.clientY);
      pointerDownHandlers.forEach((h) =>
        h({ ...pos, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey })
      );
    });
    // v48.24 批3（§4）：文中留痕的进入/离开与点击（只报翻转；坐标换算与选区同规）
    doc.addEventListener("mousemove", (ev: MouseEvent) => {
      if (markRanges.size === 0) return;
      const hit = hitMarkIn(doc, ev.clientX, ev.clientY);
      const id = hit?.id ?? null;
      if (id === hoveredMarkId) return;
      hoveredMarkId = id;
      markHoverHandlers.forEach((h) => h(hit ? { id: hit.id, rect: hit.rect } : { id: null, rect: null }));
    });
    doc.addEventListener("mouseleave", () => {
      if (hoveredMarkId === null) return;
      hoveredMarkId = null;
      markHoverHandlers.forEach((h) => h({ id: null, rect: null }));
    });
    // 捕获相位 + 阻止传播：点标记＝浮层，不让 foliate 的链接处理器顺手跳走（标记只读）
    doc.addEventListener(
      "click",
      (ev: MouseEvent) => {
        if (markRanges.size === 0) return;
        // 拖选收尾的 click 不算「点标记」：此刻选区仍未折叠＝本次是滑选手势，
        // 只出选区操作选单、不弹批注浮层（用户 2026-10-17：点高亮才弹浮层）
        const sel = doc.getSelection();
        if (sel && !sel.isCollapsed) return;
        const hit = hitMarkIn(doc, ev.clientX, ev.clientY);
        if (!hit) return;
        ev.preventDefault();
        ev.stopPropagation();
        markClickHandlers.forEach((h) => h({ id: hit.id, rect: hit.rect }));
      },
      true
    );
    paintMarksForDoc(index);
    paintStructForDoc(index);
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
      range?: Range;
    };
    const chapterIndex = d.section?.current ?? 0;
    lastProbe = { range: d.range ?? null, index: chapterIndex };
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
    // D130 R3（P3b）：版心宽度——滚动模式的排版余白（分页列宽的上限）；px 单位同上（v37 教训）。
    // paginator 文件头白名单已含 max-inline-size（scrolled 分支 columnWidth = maxInlineSize）。
    const ex = a as ReaderAppearanceEx | null;
    if (ex?.maxInlineSize != null) r.setAttribute("max-inline-size", `${ex.maxInlineSize}px`);
    // D130 R3（P4a）：翻页滑动过渡——vendor `animated` 布尔属性按值 toggle；
    // reduce-motion 已在 resolveAppearance 强制 false，这里照值执行（存储保留意愿、生效面永不挂）。
    if (ex) {
      if (ex.turnAnimated === true) r.setAttribute("animated", "");
      else r.removeAttribute("animated");
    }
  };

  const applyToHost = (a: ReaderAppearance) => {
    // ::part(filter)（paginator 的背景层）随文档底色，保证自定义背景贯穿整个视口
    host.style.setProperty("--reader-bg", a.bgColor ?? "transparent");
    host.style.setProperty("--reader-fg", a.fgColor ?? "inherit");
    host.style.background = a.bgColor ?? "transparent";
  };

  // v48.53（D93）：空壳节着陆自愈——粘贴书正文以一级标题开头时，splitMarkdownChapters 会
  // 先压入一个空壳章（spine[0] 正文为空，§9.4「粘贴书空首章」），init 无保存位置时恒落
  // spine 首节 → 首屏空白（滚动/resize 均无法唤出，任意显式 goTo 即恢复，实验实锤）。
  // 打开落点定案后探测当前节：body innerHTML 为空白则顺序前进到首个非空节。
  // 封面节含 <img> → innerHTML 非空不会误跳；CBZ/FB2 等异构节 createDocument 异常时
  // 静默放弃（回退旧行为，只损失自愈不损失正确性）。不改合成结构、零 CFI 影响。
  const isSectionEmpty = async (index: number): Promise<boolean | null> => {
    try {
      // book.sections 的本地最小类型只声明了 id/href（L44）——cast 取 createDocument，
      // 与本文件 L661 既有 cast 先例同法（合并时补的类型缺口，运行时行为零改动）
      const section = (view.book?.sections as { createDocument?: () => Promise<Document> }[] | undefined)?.[index];
      if (!section?.createDocument) return null;
      const doc = await section.createDocument();
      return String(doc?.body?.innerHTML ?? "").trim() === "";
    } catch {
      return null; // 异构格式探测失败 = 不判定为空
    }
  };
  const healEmptySectionLanding = async () => {
    try {
      const contents = (view.renderer?.getContents?.() ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const landed = contents[0];
      if (!landed || typeof landed.index !== "number") return;
      if ((await isSectionEmpty(landed.index)) !== true) return;
      const sections = view.book?.sections ?? [];
      let next = landed.index + 1;
      while (next < sections.length && (await isSectionEmpty(next)) === true) next += 1;
      if (next < sections.length) await view.goTo(next);
    } catch { /* 自愈失败不阻塞打开 */ }
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
      // 首屏闪烁修复：renderer 在 open 后才存在、首次排版在 init 里——必须在 init 之前把
      // 已知的模式/外观写进 renderer，否则 paginator 默认（分页+双栏=对开）先画一帧，
      // 随后 onReady 里的 setMode 才切回滚动。
      if (pendingMode || appearance) applyRendererSettings(appearance, pendingMode);
      if (init?.location?.cfi) {
        await view.init({ lastLocation: init.location.cfi });
      } else {
        await view.init({});
        if (init?.location?.fraction != null) await view.goToFraction(init.location.fraction);
      }
      // D93：落点为空壳章（含存量用户进度被旧 bug 卡在空章的情形）→ 前进到首个非空节
      await healEmptySectionLanding();
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
      pendingMode = mode;
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
      // 阅读主题联动软件主题（暗夜/纸白），accent 派生档跟着变——标记的注入色要重算
      refreshMarkStyles();
      structStyles.forEach((el) => {
        el.textContent = structCss();
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
    // 阅读透镜：可见起点所在段落的开头片段（段落粒度足够：主进程按块定位）
    getReadingProbe() {
      if (!lastProbe) return null;
      const sections = (view.book?.sections ?? []) as { id?: string; href?: string }[];
      const sec = sections[lastProbe.index];
      const unitAnchor = String(sec?.id ?? sec?.href ?? "");
      if (!unitAnchor) return null;
      let text = "";
      try {
        const node = lastProbe.range?.startContainer ?? null;
        const el = node ? ((node.nodeType === 3 ? node.parentElement : node) as Element | null) : null;
        const block = el?.closest?.("p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,td,th,figcaption,pre") ?? el;
        text = String(block?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      } catch {
        text = "";
      }
      return { unitAnchor, text };
    },

    setStructureHighlights(regions) {
      structRegions = Array.isArray(regions) ? regions.filter((r) => r && r.unitAnchor && r.head) : [];
      paintAllStruct();
    },

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

    // D121 §2.3：选区前后文（供 AI 制卡判断归属/前提）；iframe 对宿主跨源，只能在本 adapter 内取 DOM
    getSelectionContext(): { before: string; after: string } | null {
      const r = view.renderer;
      if (!r) return null;
      for (const { doc } of r.getContents()) {
        const sel = doc.defaultView?.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
        return extractSelectionContext(sel.getRangeAt(0));
      }
      return null;
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

    // v48.23（D61 §6.8-11）：多段选择高亮（CSS Custom Highlight API，不碰正文 DOM）
    multiSelectHighlight(action) {
      multiHighlight.update(action);
    },

    clearMultiSelectHighlight() {
      multiHighlight.clear();
    },

    // v48.24 批3（§4）：文中留痕——cfi → Range → CSS Custom Highlight（数据面由壳层给）
    setDocumentMarks(marks) {
      docMarks = Array.isArray(marks) ? marks : [];
      paintAllMarks();
    },

    // D67 §3：注解栏「位置」序——当前可解析标记的文档序（见 collectMarkOrder）
    getMarkOrder() {
      return collectMarkOrder();
    },

    // D67（§6.8-13）：侧栏注解按 id 导航——只认精确 id 与该条的 CFI；
    // 不承诺章节内像素位置，也不回退文本搜索。
    async goToMark(id: string) {
      const mark = docMarks.find((candidate) => candidate.id === id);
      const cfi = typeof mark?.cfi === "string" ? mark.cfi : "";
      if (!cfi) return false;
      let ok = false;
      try {
        ok = await kernel.goTo({ cfi });
      } catch {
        return false; // 坏 CFI 属存储边界输入：按契约失败，不上抛
      }
      if (!ok) return false;
      // 导航后目标必须解析成已加载章节的 Range（标记重画在 'load' 上完成）
      const deadline = Date.now() + 3000;
      for (;;) {
        if (hasResolvedMark(id)) return true;
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    },

    getCurrentLocation(): ReaderLocation | null {
      return lastRelocate?.location ?? null;
    },

    destroy() {
      // 高亮画在各章节文档上，销毁内核时一并撤掉（否则残影跟着下一个内核）
      multiHighlight.clear();
      markRanges.forEach((_, doc) => winOf(doc)?.CSS?.highlights?.delete(MARK_HIGHLIGHT_NAME));
      markRanges.clear();
      markStyles.clear();
      docMarks = [];
      docs.forEach((doc) => {
        const hl = winOf(doc)?.CSS?.highlights;
        hl?.delete(STRUCT_NAMES.focus);
        hl?.delete(STRUCT_NAMES.hover);
      });
      structRegions = [];
      structStyles.clear();
      hoveredMarkId = null;
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
      pointerDownHandlers.clear();
      imageHandlers.clear();
      markHoverHandlers.clear();
      markClickHandlers.clear();
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
      if (event === "markHover") {
        const h = handler as (info: MarkPointerInfo) => void;
        markHoverHandlers.add(h);
        return () => markHoverHandlers.delete(h);
      }
      if (event === "markClick") {
        const h = handler as (info: MarkPointerInfo) => void;
        markClickHandlers.add(h);
        return () => markClickHandlers.delete(h);
      }
      if (event === "contentPointerDown") {
        const h = handler as (pos: ContentPointerDownInfo) => void;
        pointerDownHandlers.add(h);
        return () => pointerDownHandlers.delete(h);
      }
      const h = handler as (pos: ContentPointerUpInfo) => void;
      pointerHandlers.add(h);
      return () => pointerHandlers.delete(h);
    }
  };

  // 测试钩子（非 Kernel 接口）：L1 契约测试需要直接操作章节 iframe 文档（注入选区/派发点击）
  (kernel as ReaderKernel & { __getContents(): { doc: Document; index: number }[] }).__getContents =
    () => view.renderer?.getContents() ?? [];

  return kernel;
}
