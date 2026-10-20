// 结构图独立窗口的内核代理（v49.24 / D197，设计 docs/design/MINDMAP-V2-IMPL-PLAN.md §14）。
//
// 面板（MindmapLens）跑在结构图窗口，而正文与阅读内核住在主窗口——同一条 preload 桥把两端接起来：
//   · 同步取值（目录 / 单元锚 / 阅读位置探针 / 当前阅读位置）＝主窗口推送后本地缓存（getTOC 等必须同步返回）；
//   · 异步取值（区间原文）与跳转（goTo）＝带 id 的请求，主窗口回执；
//   · 正文强调（setStructureHighlights）与「在完整图谱中打开」＝单向命令，不等回执。
// 事件：主窗口推送「阅读位置」时按内核 on("relocate") 语义触发订阅者（面板据此重新定位）。
import type { ReaderLocation, ReaderStructureRegion, ReaderTocItem, RelocateInfo, SectionUnitInfo } from "./reader/kernel";
import type { LensKernel } from "../components/reader/MindmapLens";

/** 主窗口 → 结构图窗口的推送载荷 */
export type LensPush =
  | { kind: "context"; payload: { documentId: string | null; title: string; toc: ReaderTocItem[]; anchors: SectionUnitInfo[] } }
  | { kind: "reading"; payload: { probe: { unitAnchor: string; text: string } | null; location: ReaderLocation | null; fraction: number } };

/** 结构图窗口 → 主窗口的请求 / 命令 */
export type LensAsk =
  | { kind: "refresh" }
  | { kind: "sectionText"; id: number; payload: { anchor: string } }
  | { kind: "goto"; id: number; payload: { target: unknown } }
  | { kind: "highlights"; payload: ReaderStructureRegion[] }
  | { kind: "openInMap"; payload: { nodeId: string | null; region?: string[] } };

export interface LensWindowState {
  visible: boolean;
  pinned: boolean;
}

interface LensBridge {
  control: (action: "show" | "hide" | "toggle" | "pin") => Promise<LensWindowState>;
  ask: (payload: LensAsk) => void;
  onAsk: (cb: (payload: LensAsk) => void) => () => void;
  reply: (payload: { id: number; ok: boolean; value?: unknown }) => void;
  onReply: (cb: (payload: { id: number; ok: boolean; value?: unknown }) => void) => () => void;
  push: (payload: LensPush) => void;
  onPush: (cb: (payload: LensPush) => void) => () => void;
  onWindow: (cb: (payload: LensWindowState) => void) => () => void;
}

declare global {
  interface Window {
    lensAPI?: LensBridge;
  }
}

export interface LensKernelBridge {
  kernel: LensKernel;
  /** 收到主窗口推送：更新缓存；「阅读位置」推送同时触发 on("relocate") 订阅者 */
  applyPush: (payload: LensPush) => void;
  /** 窗口每次被呼出 / 首次加载：请主窗口补推一份上下文与阅读位置 */
  requestRefresh: () => void;
}

/** 请求回执超时（主窗口未就绪 / 已切走时不至于永久挂起） */
const ASK_TIMEOUT_MS = 8000;

export function createLensKernel(): LensKernelBridge {
  let toc: ReaderTocItem[] = [];
  let anchors: SectionUnitInfo[] = [];
  let probe: { unitAnchor: string; text: string } | null = null;
  let location: ReaderLocation | null = null;
  const relocateHandlers = new Set<(info: RelocateInfo) => void>();
  const pending = new Map<number, (res: { ok: boolean; value: unknown }) => void>();
  let seq = 0;

  const api = () => window.lensAPI;

  window.lensAPI?.onReply?.((payload) => {
    if (!payload) return;
    const resolve = pending.get(payload.id);
    if (!resolve) return;
    pending.delete(payload.id);
    resolve({ ok: !!payload.ok, value: payload.value });
  });

  function askWithReply(kind: string, payload: unknown): Promise<{ ok: boolean; value: unknown }> {
    const bridge = api();
    if (!bridge) return Promise.resolve({ ok: false, value: null });
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, value: null });
      }, ASK_TIMEOUT_MS);
      pending.set(id, (res) => {
        window.clearTimeout(timer);
        resolve(res);
      });
      bridge.ask({ kind, id, payload } as LensAsk);
    });
  }

  const kernel: LensKernel = {
    getTOC: () => toc,
    getSectionAnchors: () => anchors,
    getSectionText: async (anchor: string) => {
      const r = await askWithReply("sectionText", { anchor });
      return r.ok ? String(r.value ?? "") : "";
    },
    getReadingProbe: () => probe,
    getCurrentLocation: () => location,
    goTo: async (target) => {
      // 面板与正文分属两个渲染进程：跳转必须回到阅读窗口执行（那边的内核才有 foliate / pdf 引擎）
      const r = await askWithReply("goto", { target });
      return r.ok && r.value !== false;
    },
    setStructureHighlights: (regions) => api()?.ask({ kind: "highlights", payload: regions }),
    on: (event, handler) => {
      if (event !== "relocate") return () => {};
      relocateHandlers.add(handler);
      return () => relocateHandlers.delete(handler);
    },
  };

  const applyPush = (payload: LensPush) => {
    if (!payload) return;
    if (payload.kind === "context") {
      toc = payload.payload.toc ?? [];
      anchors = payload.payload.anchors ?? [];
      return;
    }
    if (payload.kind === "reading") {
      probe = payload.payload.probe ?? null;
      location = payload.payload.location ?? null;
      const info: RelocateInfo = { location: (location ?? {}) as ReaderLocation, fraction: Number(payload.payload.fraction) || 0 };
      for (const h of [...relocateHandlers]) {
        try {
          h(info);
        } catch {
          /* 订阅方异常不影响其余订阅者 */
        }
      }
    }
  };

  return { kernel, applyPush, requestRefresh: () => api()?.ask({ kind: "refresh" }) };
}
