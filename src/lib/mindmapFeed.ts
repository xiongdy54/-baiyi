// 材料导图 v2 · 原文送入（graphFeed）的进程内单例（2026-10-18 阅读透镜引入）。
// 图谱页签与阅读透镜都要把正文按文档顺序逐单元送进主进程常驻会话；两处各送一遍会交错乱序（主进程要求严格顺序，
// 乱序抛 out_of_order）。这里按「内核实例 + documentId」只跑一条送入流程，双方订阅同一份进度。
// 主进程会话有 LRU（3 份文档）：被挤出后 graphLocate 返回 ready:false，调用方 reset() 后重新 ensure 即可。
import type { ReaderTocItem, SectionUnitInfo } from "./reader/kernel";
import { mindmapV2Api } from "./mindmapV2";

export interface TocItem {
  anchor: string;
  label: string;
  children?: TocItem[];
}

/**
 * 原文送入只需要内核的取文能力（v49.24 / D197）：阅读窗口直传真实内核（结构上是它的超集），
 * 结构图独立窗口传经 preload 桥代理的 LensKernel（src/lib/lensBridge.ts）——同一份送入流程两处共用。
 */
export interface FeedKernel {
  getTOC(): ReaderTocItem[];
  getSectionAnchors?(): SectionUnitInfo[];
  getSectionText?(startAnchor: string, endAnchor?: string): Promise<string>;
}

export interface FeedState {
  done: number;
  total: number;
  /** 全部送完 */
  complete: boolean;
  /** 不支持取文（无章节单元）的材料 */
  unsupported: boolean;
  error?: string;
}

type Listener = (s: FeedState) => void;

interface Entry {
  state: FeedState;
  listeners: Set<Listener>;
  promise: Promise<FeedState> | null;
  toc: TocItem[];
}

const byKernel = new WeakMap<FeedKernel, Map<string, Entry>>();

export function flattenToc(items: { label: string; href: string; subitems?: { label: string; href: string; subitems?: unknown[] }[] }[]): TocItem[] {
  const walk = (list: { label: string; href: string; subitems?: unknown[] }[]): TocItem[] =>
    (list || [])
      .filter((t) => t.href)
      .map((t) => ({
        anchor: t.href,
        label: String(t.label || "").replace(/\s*·第 \d+ 页$/, ""),
        children: t.subitems ? walk(t.subitems as { label: string; href: string; subitems?: unknown[] }[]) : undefined,
      }));
  return walk(items || []);
}

function entryOf(kernel: FeedKernel, documentId: string): Entry {
  let m = byKernel.get(kernel);
  if (!m) byKernel.set(kernel, (m = new Map()));
  let e = m.get(documentId);
  if (!e) {
    e = { state: { done: 0, total: 0, complete: false, unsupported: false }, listeners: new Set(), promise: null, toc: [] };
    m.set(documentId, e);
  }
  return e;
}

function emit(e: Entry, s: FeedState) {
  e.state = s;
  for (const l of [...e.listeners]) {
    try {
      l(s);
    } catch {
      /* 订阅方异常不影响送入 */
    }
  }
}

/** 当前进度（未开始＝0/0） */
export function feedState(kernel: FeedKernel, documentId: string): FeedState {
  return entryOf(kernel, documentId).state;
}

/** 目录（ensureFed 首次运行后可用；页签本地画骨架预览用） */
export function feedToc(kernel: FeedKernel): TocItem[] {
  return flattenToc(kernel.getTOC());
}

export function subscribeFeed(kernel: FeedKernel, documentId: string, fn: Listener): () => void {
  const e = entryOf(kernel, documentId);
  e.listeners.add(fn);
  fn(e.state);
  return () => e.listeners.delete(fn);
}

/** 确保该文档原文已按顺序送入主进程（已在送 / 已送完则复用同一个 Promise） */
export function ensureFed(kernel: FeedKernel, documentId: string, title: string): Promise<FeedState> {
  const e = entryOf(kernel, documentId);
  if (e.promise) return e.promise;
  e.promise = (async () => {
    const anchors = kernel.getSectionAnchors?.() || [];
    if (!anchors.length || !kernel.getSectionText) {
      const s = { done: 0, total: 0, complete: false, unsupported: true };
      emit(e, s);
      return s;
    }
    e.toc = flattenToc(kernel.getTOC());
    const unitAnchors = anchors.map((a) => a.anchor);
    emit(e, { done: 0, total: anchors.length, complete: false, unsupported: false });
    for (let i = 0; i < anchors.length; i++) {
      let text = "";
      try {
        text = await kernel.getSectionText(anchors[i].anchor);
      } catch {
        text = "";
      }
      try {
        await mindmapV2Api.feed({ documentId, title, tocItems: e.toc, unitAnchors, index: i, text, last: i === anchors.length - 1 });
      } catch (err) {
        const s = { done: i, total: anchors.length, complete: false, unsupported: false, error: err instanceof Error ? err.message : String(err) };
        emit(e, s);
        e.promise = null; // 允许重试
        return s;
      }
      emit(e, { done: i + 1, total: anchors.length, complete: i === anchors.length - 1, unsupported: false });
    }
    return e.state;
  })();
  return e.promise;
}

/** 主进程会话被 LRU 挤出后：清掉本地「已送完」记录，下次 ensureFed 从第 0 个单元重送 */
export function resetFeed(kernel: FeedKernel, documentId: string): void {
  const e = entryOf(kernel, documentId);
  if (e.promise && !e.state.complete && !e.state.error) return; // 正在送：不打断
  e.promise = null;
  emit(e, { done: 0, total: 0, complete: false, unsupported: false });
}
