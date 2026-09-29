// FakeKernel——ReaderKernel 的内存实现（L0 语义契约测试与业务单测替身）。
// 模拟一本「N 章、每章 title/paragraphs 文本」的书：open/goTo/next/prev/选区/事件全部确定性行为。
// 它定义并验证 Kernel 对业务承诺的语义；foliateAdapter 的同套语义测试见 tests/reader.kernel.cjs（L1）。
import type {
  BookSource,
  LinkInfo,
  ReaderAppearance,
  ReaderDocMark,
  ReaderImageRef,
  ReaderKernel,
  ReaderLocation,
  ReaderModeConfig,
  ReaderRect,
  ReaderSelection,
  ReaderTocItem,
  RelocateInfo
} from "../kernel";

export interface FakeBookSpec {
  /** 每章的纯文本（章与章之间用「第 N 章」标题行分隔亦可，直接按数组元素分章） */
  chapters: string[];
}

export function createFakeKernel(spec: FakeBookSpec): ReaderKernel & {
  /** 测试注入选区（模拟用户划选） */
  __setSelection(sel: ReaderSelection | null): void;
  __setSelectionGeometry(rect: ReaderRect | null): void;
  __emitLink(info: LinkInfo): void;
  /** 测试注入正文图片点击（v25） */
  __emitImageClick(image: ReaderImageRef): void;
} {
  const relocateHandlers = new Set<(i: RelocateInfo) => void>();
  const linkHandlers = new Set<(i: LinkInfo) => void>();
  const pointerHandlers = new Set<(p: { x: number; y: number }) => void>();
  const imageHandlers = new Set<(i: ReaderImageRef) => void>();

  let opened = false;
  let chapter = 0;
  let selection: ReaderSelection | null = null;
  let geometry: ReaderRect | null = null;
  let documentMarks: ReaderDocMark[] = [];
  let mode: ReaderModeConfig = { flow: "scrolled" };
  let appearance: ReaderAppearance | null = null;

  const toc: ReaderTocItem[] = spec.chapters.map((c, i) => {
    const firstLine = c.split("\n")[0] ?? "";
    return { label: firstLine.replace(/^第[一二三四五六七八九十\d]+章\s*/, "") || `第 ${i + 1} 章`, href: `chapter${i + 1}.xhtml` };
  });

  const emitRelocate = () => {
    const chapterText = spec.chapters[chapter] ?? "";
    const info: RelocateInfo = {
      location: { cfi: `fake:/6/${chapter * 4 + 2}`, fraction: (chapter + 0.5) / spec.chapters.length },
      fraction: (chapter + 0.5) / spec.chapters.length,
      chapterIndex: chapter,
      chapterHref: toc[chapter]?.href
    };
    void chapterText;
    relocateHandlers.forEach((h) => h(info));
  };

  const kernel: ReaderKernel & {
    __setSelection(sel: ReaderSelection | null): void;
    __setSelectionGeometry(rect: ReaderRect | null): void;
    __emitLink(info: LinkInfo): void;
    __emitImageClick(image: ReaderImageRef): void;
  } = {
    async open(source) {
      void source;
      opened = true;
      chapter = 0;
      emitRelocate();
    },
    async goTo(target) {
      if (!opened) return false;
      if ("chapterIndex" in target) {
        if (target.chapterIndex < 0 || target.chapterIndex >= spec.chapters.length) return false;
        chapter = target.chapterIndex;
        emitRelocate();
        return true;
      }
      if ("href" in target) {
        const idx = toc.findIndex((t) => t.href === target.href);
        if (idx < 0) return false;
        chapter = idx;
        emitRelocate();
        return true;
      }
      if ("search" in target) {
        const q = target.search.trim();
        const idx = spec.chapters.findIndex((c) => c.includes(q));
        if (idx < 0) return false;
        chapter = idx;
        emitRelocate();
        return true;
      }
      // cfi 形如 fake:/6/<chapter*4+2>——按同一算式解析回章节索引（PDF 系 pageIndex 在 fake 引擎不可达）
      const loc = target as { cfi?: string };
      const m = loc.cfi ? /^fake:\/6\/(\d+)$/.exec(loc.cfi) : null;
      if (!m) return false;
      const idx = (Number(m[1]) - 2) / 4;
      if (idx < 0 || idx >= spec.chapters.length) return false;
      chapter = idx;
      emitRelocate();
      return true;
    },
    async goToMark(id) {
      const mark = documentMarks.find((entry) => entry.id === id);
      if (!mark?.cfi) return false;
      return kernel.goTo({ cfi: mark.cfi });
    },
    // D67 §3：fake 无几何/章节 DOM，位置序＝有锚标记的**安装序**（只用来验语义：无锚的不在列）
    getMarkOrder() {
      return documentMarks.filter((mark) => mark.cfi || (mark.pageIndex != null && mark.rects?.length)).map((mark) => mark.id);
    },
    async next() {
      if (chapter >= spec.chapters.length - 1) return false;
      chapter += 1;
      emitRelocate();
      return true;
    },
    async prev() {
      if (chapter <= 0) return false;
      chapter -= 1;
      emitRelocate();
      return true;
    },
    async setMode(m) {
      mode = { ...m };
    },
    applyAppearance(a) {
      appearance = { ...a };
    },
    getTOC() {
      return toc.map((t) => ({ ...t }));
    },
    setDocumentMarks(marks) {
      documentMarks = marks.map((mark) => ({ ...mark, rects: mark.rects?.map((rect) => ({ ...rect })) }));
    },
    // v48 批1（M15 §4.19-4）：每章 = 一个提取单元（anchor 与目录 href 同域），文本 = 章原文
    getSectionAnchors() {
      return spec.chapters.map((_, i) => ({ anchor: `chapter${i + 1}.xhtml` }));
    },
    async getSectionText(startAnchor: string, endAnchor?: string) {
      const idxOf = (a: string) => {
        const m = /^chapter(\d+)\.xhtml$/.exec(String(a ?? ""));
        return m ? Number(m[1]) - 1 : -1;
      };
      const s = idxOf(startAnchor);
      if (s < 0 || s >= spec.chapters.length) return "";
      const e = endAnchor != null ? idxOf(endAnchor) : null;
      const last = e == null ? s : Math.max(s, Math.min(e - 1, spec.chapters.length - 1));
      const parts: string[] = [];
      for (let i = s; i <= last; i++) {
        parts.push((spec.chapters[i] ?? "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim());
      }
      return parts.join("\n");
    },
    getSelection() {
      return selection;
    },
    getSelectionGeometry() {
      return geometry;
    },
    deselect() {
      selection = null;
    },
    getCurrentLocation(): ReaderLocation | null {
      return opened ? { cfi: `fake:/6/${chapter * 4 + 2}`, fraction: (chapter + 0.5) / spec.chapters.length } : null;
    },
    destroy() {
      opened = false;
      documentMarks = [];
      relocateHandlers.clear();
      linkHandlers.clear();
      pointerHandlers.clear();
      imageHandlers.clear();
    },
    on(event, handler) {
      if (event === "relocate") {
        const h = handler as (i: RelocateInfo) => void;
        relocateHandlers.add(h);
        return () => relocateHandlers.delete(h);
      }
      if (event === "link") {
        const h = handler as (i: LinkInfo) => void;
        linkHandlers.add(h);
        return () => linkHandlers.delete(h);
      }
      if (event === "imageClick") {
        const h = handler as (i: ReaderImageRef) => void;
        imageHandlers.add(h);
        return () => imageHandlers.delete(h);
      }
      const h = handler as (p: { x: number; y: number }) => void;
      pointerHandlers.add(h);
      return () => pointerHandlers.delete(h);
    },
    __setSelection(sel) {
      selection = sel;
    },
    __setSelectionGeometry(rect) {
      geometry = rect;
    },
    __emitImageClick(image) {
      imageHandlers.forEach((h) => h(image));
    },
    __emitLink(info) {
      // 内链语义与真内核一致：命中目录 href 即导航（外链仅转发事件）
      if (info.internal && info.href) {
        const idx = toc.findIndex((t) => t.href === info.href);
        if (idx >= 0) {
          chapter = idx;
          emitRelocate();
        }
      }
      linkHandlers.forEach((h) => h(info));
    }
  };
  void mode;
  void appearance;
  void pointerHandlers;
  return kernel;
}
