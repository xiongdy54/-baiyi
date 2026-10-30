// 结构流 · 宿主（STRUCTURE-FLOW-PLAN §6.2 / §6.4 / §8 / §12.1 / §12.4）。
// 职责：量视口与版心 → planColumn → 平移 / 预留 → 采样几何 → 组场景 → 编排动效 → portal 渲染。
// 本组件不新增窗口、preload 桥或 IPC；全部绘制在渲染层。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { ReaderKernel, ReaderStructureGeometry } from "../../../lib/reader/kernel";
import type { GraphState } from "../../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../../lib/mindmap/v2/types";
import { childrenOf } from "../../../lib/mindmap/v2/graph";
import { eventBus } from "../../../lib/eventbus";
import { useT } from "../../../lib/i18n";
import {
  COLUMN,
  FLOW,
  PATTERN_LABEL,
  PEEK,
  buildShapes,
  buildStrands,
  fitLayout,
  geometryAt,
  layoutPeek,
  patternFor,
  planColumn,
  shapePath,
  type LayoutCtx,
} from "../../../lib/flow/layout";
import type { FlowColors, FlowEnv, FlowItem, FlowMotion, FlowPattern, FlowPlan, FlowScene, PatternLayout } from "../../../lib/flow/types";
import FlowLayer, { GEN, type FlowEvent } from "./FlowLayer";
import { useStructureFlow, type StructureFlowData } from "./useStructureFlow";

export interface StructureFlowHostProps {
  kernel: ReaderKernel | null;
  documentId: string | null;
  title: string;
  open: boolean;
  /** 图谱页签画布正盖着正文（走关闭编排） */
  covered: boolean;
  /** 翻页模式（false＝滚动） */
  scrolled: boolean;
  viewportEl: HTMLElement | null;
  shiftEl: HTMLElement | null;
  gutterEl: HTMLElement | null;
  onClose: () => void;
  onOpenInMap: (nodeId: string | null, region?: string[]) => void;
}

type Stage = "closed" | "opening" | "open" | "closing";

const FALLBACK_COLORS: FlowColors = {
  dark: false,
  bg: "#fafaf8",
  fg: "#0a0a0a",
  accent: "#166a59",
  accentOn: "#ffffff",
  hairline: "#cccccc",
  counter: "#b5483b",
  palette: ["#6E7F2E", "#A9821C", "#A84A80", "#3E8A82", "#3F68A8", "#6F5FB0", "#A44836", "#B2662A"],
  aHL: [0.16, 0.26, 0.38],
  aEnd: [0.34, 0.52, 0.6],
  aDim: 0.3,
  strandA: 0.62,
};

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function luminance(color: string): number {
  const m = /rgba?\(\s*(\d+)[^\d]+(\d+)[^\d]+(\d+)/.exec(color);
  if (!m) return 1;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 用隐藏探针把主题 Token 解析成实色（var()/color-mix 不能直接进 SVG 渐变计算外的用途） */
function resolveColors(el: HTMLElement | null): FlowColors {
  const doc = el?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  const host = el ?? doc?.body ?? null;
  if (!doc || !host) return FALLBACK_COLORS;
  const probe = doc.createElement("span");
  probe.className = "flow-probe";
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0";
  host.appendChild(probe);
  const readColor = (expr: string, fallback: string) => {
    probe.style.color = "";
    probe.style.color = expr;
    const c = getComputedStyle(probe).color;
    // jsdom / 未装载皮肤时 var() 与 color-mix() 会原样返回，不能当作已解析的实色
    return c && !/var\(|color-mix\(/.test(c) && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" ? c : fallback;
  };
  try {
    const bg = readColor("var(--reader-bg, var(--paper))", FALLBACK_COLORS.bg);
    const dark = luminance(bg) < 0.4;
    if (dark) probe.setAttribute("data-dark", "1");
    const fg = readColor("var(--reader-fg, var(--ink))", dark ? "#f5f5f2" : "#0a0a0a");
    const accent = readColor("var(--accent)", FALLBACK_COLORS.accent);
    const accentOn = readColor("var(--accent-on, #fff)", "#ffffff");
    const hairline = readColor("color-mix(in srgb, var(--reader-fg, var(--ink)) 14%, var(--reader-bg, var(--paper)))", dark ? "#333333" : "#dddddd");
    const counter = readColor("var(--flow-counter)", dark ? "#E07A6A" : "#B5483B");
    const palette = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => readColor(`var(--flow-c${i})`, FALLBACK_COLORS.palette[i - 1]));
    const num = (name: string, d: number) => {
      const raw = (getComputedStyle(probe).getPropertyValue(name) || "").trim();
      const v = parseFloat(raw);
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    return {
      dark,
      bg,
      fg,
      accent,
      accentOn,
      hairline,
      counter,
      palette,
      aHL: [num("--flow-ahl-0", dark ? 0.2 : 0.16), num("--flow-ahl-1", dark ? 0.3 : 0.26), num("--flow-ahl-2", dark ? 0.42 : 0.38)],
      aEnd: [num("--flow-aend-0", dark ? 0.44 : 0.34), num("--flow-aend-1", dark ? 0.62 : 0.52), num("--flow-aend-2", dark ? 0.7 : 0.6)],
      aDim: num("--flow-adim", dark ? 0.32 : 0.3),
      strandA: num("--flow-strand-a", dark ? 0.72 : 0.62),
    };
  } finally {
    probe.remove();
  }
}


/** §14.5：只改了 transform 时，把几何按位移差解析平移（不重采 iframe 几何） */
function shiftOffsets(g: ReaderStructureGeometry, offs: Record<number, { left: number; top: number }> | null, dx: number) {
  const out: Record<number, { left: number; top: number }> = {};
  const docs = new Set<number>();
  for (const b of g.boxes) docs.add(b.doc ?? 0);
  for (const d of docs) {
    const o = offs?.[d];
    out[d] = { left: (o?.left ?? 0) - dx, top: o?.top ?? 0 };
  }
  return out;
}

const EMPTY_LAYOUT = (): PatternLayout => ({ items: [], ports: [], prims: [], expressed: [], leafIds: [], height: 0, readingY: null });

export default function StructureFlowHost(props: StructureFlowHostProps) {
  const { kernel, documentId, title, open, covered, scrolled, viewportEl, shiftEl, gutterEl, onClose, onOpenInMap } = props;
  const T = useT();
  const active = open && !covered && !!viewportEl;
  const data = useStructureFlow(kernel, documentId, title, active, { paged: !scrolled });

  const [stage, setStage] = useState<Stage>("closed");
  const stageRef = useRef<Stage>("closed");
  stageRef.current = stage;
  const [motion, setMotion] = useState<FlowMotion>("steady");
  const motionRef = useRef<FlowMotion>("steady");
  motionRef.current = motion;
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const [tracking, setTracking] = useState(false);
  const trackingRef = useRef(false);
  /** §8.8：正文平移期间高亮隐去（并阻止它拖在移动的文字后面） */
  const [shifting, setShifting] = useState(false);
  const [plan, setPlan] = useState<FlowPlan | null>(null);
  const planRef = useRef<FlowPlan | null>(null);
  const [geo, setGeo] = useState<ReaderStructureGeometry | null>(null);
  const geoRef = useRef<ReaderStructureGeometry | null>(null);
  const [cmpPage, setCmpPage] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [colorTick, setColorTick] = useState(0);
  /** §14.5：未预留时量到的正文档宽（px）；版心位置每次按当前视口现算 */
  const baseWRef = useRef<number | null>(null);
  /** §14.5：上次采样时的平移量——之后只改 transform 时，几何按差值解析校正 */
  const geoShiftRef = useRef(0);
  const sigRef = useRef("");
  const ticketRef = useRef(0);
  const openTimer = useRef<number | null>(null);
  const motionTimer = useRef<number | null>(null);
  const turnTimer = useRef<number | null>(null);
  const shiftTimer = useRef<number | null>(null);
  const relayoutCleanup = useRef<(() => void) | null>(null);
  const currentShift = useRef(0);
  const currentReserve = useRef(0);
  const lastRelocateAt = useRef(0);
  const lastSceneRef = useRef<FlowScene | null>(null);
  const hoverClear = useRef<number | null>(null);
  const lastPeekRef = useRef<StructureFlowData["peek"]>(null);
  const lastGroupRef = useRef<{ groupId: string | null; members: string[] }>({ groupId: null, members: [] });
  const anchorSigRef = useRef("");
  const bump = useCallback(() => setAnimKey((n) => n + 1), []);

  /** §13.3：滚动模式平滑彩带（矩形画在正文 iframe，混合层只画颈部） */
  const smooth = scrolled && !!kernel?.onContentScroll && !!kernel?.getFrameOffsets; // §15.1：矩形并入 SVG，不再需要 iframe 绘制通道
  const [frameTick, setFrameTick] = useState(0);
  /** §16.1.2：逐帧数据按代存（一代＝一个主体组下的完整结构图）；换代后旧代还要用它画 140ms */
  const framesRef = useRef(new Map<string, { lay: PatternLayout; dy: number; opts: Parameters<typeof buildShapes>[3] }>());
  const liveGenRef = useRef<string>("none");
  const neckEls = useRef(new Map<string, SVGPathElement>());
  /** §16.1.2：颈部元素按 `${genKey}|${id}` 注册（两代并存时互不覆盖）；工厂稳定，避免每帧 ref 往返 */
  const registerShape = useCallback((genKey: string, id: string, el: SVGPathElement | null) => {
    const key = `${genKey}|${id}`;
    if (el) neckEls.current.set(key, el);
    else neckEls.current.delete(key);
  }, []);
  const shapeSigRef = useRef("");
  /** §16.5：条目 DOM 缓存（同一 layout 只查一次） */
  const itemElCache = useRef<{ key: string; lay: PatternLayout; map: Map<string, { el: HTMLElement; mid: number }> } | null>(null);
  const settleUntil = useRef(0);
  /** §13.2.3：成员的窗口起点（按组粘滞，阅读节点在窗口内部时窗口不动） */
  const winRef = useRef(new Map<string, number>());

  const colors = useMemo(() => resolveColors(viewportEl), [viewportEl, colorTick]);

  // 主题 / 皮肤变化 → 重算颜色
  useEffect(() => {
    if (!viewportEl) return;
    const ob = new MutationObserver(() => setColorTick((n) => n + 1));
    ob.observe(viewportEl.ownerDocument.body, { attributes: true, attributeFilter: ["style", "class"] });
    const off = eventBus.on("settings/changed", () => setColorTick((n) => n + 1));
    return () => {
      ob.disconnect();
      off();
    };
  }, [viewportEl]);

  // ---------------------------------------------------------------- 环境与排布
  const readViewport = useCallback((): FlowEnv["viewport"] => {
    const vr = viewportEl?.getBoundingClientRect();
    if (!vr) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    return { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
  }, [viewportEl]);

  /** §14.5：版心＝「未预留时量到的宽度」在【当前】视口里居中——resize / 平移 / 预留都不再互相污染 */
  const baseTextNow = useCallback((vp: FlowEnv["viewport"]) => {
    const vw = Math.max(1, vp.right - vp.left);
    const w = Math.min(baseWRef.current ?? vw * 0.6, vw - 8);
    return { left: vp.left + (vw - w) / 2, right: vp.left + (vw + w) / 2 };
  }, []);
  const syncPlan = useCallback(() => {
    if (!viewportEl) return;
    const vp = readViewport();
    const base = baseTextNow(vp);
    const prev = planRef.current;
    const next = planColumn({ on: true, viewport: vp, textLeft: base.left, textRight: base.right }, prev);
    // 预留保持（§5.3）：决策用 baseText（未预留版心）；reserve 方案的 barX 再用重排后的实际 textRight 修正
    if (next.reserve > 0) {
      const bw = FLOW.BAR_MAX + FLOW.LABEL_GAP + next.labelW + FLOW.PAD_R;
      const actualRight = geoRef.current?.text?.right ?? base.right;
      next.barX = Math.round(Math.min(actualRight + FLOW.BRAID_PREF, vp.right - 4 - bw));
      next.labelX = next.barX + FLOW.BAR_MAX + FLOW.LABEL_GAP;
      next.right = next.labelX + next.labelW + FLOW.PAD_R;
    }
    planRef.current = next;
    setPlan((cur) => (cur && samePlan(cur, next) ? cur : next));
  }, [viewportEl, readViewport]);

  const applyShift = useCallback(
    (s: number) => {
      currentShift.current = s;
      if (shiftEl) shiftEl.style.transform = s ? `translateX(${-s}px)` : "";
    },
    [shiftEl],
  );
  const applyGutter = useCallback(
    (r: number) => {
      currentReserve.current = r;
      if (gutterEl) gutterEl.style.flexBasis = `${r}px`;
    },
    [gutterEl],
  );

  // ---------------------------------------------------------------- 几何采样
  const sampleGeometry = useCallback(
    (force = false): ReaderStructureGeometry | null => {
      if (!viewportEl || !kernel?.getStructureGeometry) return null;
      if (viewportEl.ownerDocument.visibilityState !== "visible") return geoRef.current;
      const raw = kernel.getStructureGeometry(smooth ? { all: true } : undefined);
      if (!raw) return null;
      // §15.2：裁剪视口＝可见阅读窗口（引擎容器可能比可见区高出几像素，彩带顶边不许越过阅读区上沿）
      const host = readViewport();
      const g =
        raw.viewport.top < host.top || raw.viewport.bottom > host.bottom
          ? { ...raw, viewport: { ...raw.viewport, top: Math.max(raw.viewport.top, host.top), bottom: Math.min(raw.viewport.bottom, host.bottom) } }
          : raw;
      const sig =
        JSON.stringify(g.boxes.map((b) => [b.nodeId, b.block, b.doc, b.top | 0, b.bottom | 0, (b.cTop ?? 0) | 0, b.left | 0])) + JSON.stringify(g.text);
      if (!force && sig === sigRef.current) return g;
      sigRef.current = sig;
      geoRef.current = g;
      setGeo(g);
      // §14.5：只在「未预留」时刷新版宽（平移是纯 transform，宽度不受影响；预留会重排，宽度不是版心的真值）
      if (g.text && (planRef.current?.reserve ?? 0) === 0) baseWRef.current = Math.max(0, g.text.right - g.text.left);
      geoShiftRef.current = planRef.current?.shift ?? 0;
      return g;
    },
    [viewportEl, kernel, smooth, readViewport],
  );

  /**
   * §16.5：读条目的【实际】位置（CSS 240ms 几何过渡途中，布局坐标与屏幕位置有差）。
   * 缓存：同一 layout 只查一次 DOM；所有 getBoundingClientRect 必须在 paintFrame 的任何写之前完成。
   */
  const readLiveShift = useCallback((gk: string) => {
    const F = framesRef.current.get(gk);
    if (!F) return undefined;
    const doc = viewportEl?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    const layer = doc?.querySelector(".flow-layer");
    if (!doc || !layer) return undefined;
    const root = Array.from(layer.querySelectorAll(".flow-gen[data-gen]")).find((el) => el.getAttribute("data-gen") === gk) ?? null;
    if (!root) return undefined;
    const cacheKey = gk + "|" + F.lay.items.length + "|" + F.dy;
    // 版式对象变了（窗口滑动 / 预览出现）→ mid 必须按新 layout 重算，否则补差会过冲
    if (itemElCache.current?.key !== cacheKey || itemElCache.current?.lay !== F.lay) {
      const byId = new Map<string, HTMLElement>();
      for (const el of Array.from(root.querySelectorAll("[data-flow-item]"))) byId.set(el.getAttribute("data-flow-item") ?? "", el as HTMLElement);
      const map = new Map<string, { el: HTMLElement; mid: number }>();
      for (const it of F.lay.items) {
        if (!it.nodeId || (it.kind !== "node" && it.kind !== "kid")) continue;
        if (map.has(it.nodeId) && it.peek) continue; // 主体优先于预览
        const el = byId.get(it.id);
        if (el) map.set(it.nodeId, { el, mid: it.y + F.dy + it.h / 2 });
      }
      itemElCache.current = { key: cacheKey, lay: F.lay, map };
    }
    const delta = new Map<string, number>();
    for (const [id, v] of itemElCache.current.map) {
      const r = v.el.getBoundingClientRect(); // .flow-layer 是 fixed inset:0，所以 client 坐标即层坐标
      if (r.width === 0 && r.height === 0) continue; // 无布局环境（jsdom）不做修正
      const d = r.top + r.height / 2 - v.mid; // 用中线：预览行有 scale(.86) 以 50% 为原点，中线不受影响
      if (Math.abs(d) > 0.5) delta.set(id, d);
    }
    return (id: string) => delta.get(id) ?? 0;
  }, [viewportEl]);

  /** §13.3.4 / §16.1.2：滚动逐帧——先读所有代的实际位置 → 纯计算 → 遍历【所有代】写 DOM（退场代也跟着正文滚） */
  const paintFrame = useCallback(() => {
    const base = geoRef.current;
    if (!smooth || !base || !kernel?.getFrameOffsets) return;
    const dx = (planRef.current?.shift ?? 0) - geoShiftRef.current;
    const g = geometryAt(base, shiftOffsets(base, kernel.getFrameOffsets(), dx));
    // ① 先【读】：当前代的标签实际位置（16.5），所有 getBoundingClientRect 集中在写之前
    const live = liveGenRef.current;
    const shiftOf = readLiveShift(live);
    // ② 再算 + 【写】
    for (const [gk, F] of framesRef.current) {
      const shapes = buildShapes(g, F.lay, F.dy, { ...F.opts, shiftOf: gk === live ? shiftOf : undefined });
      if (gk === live) {
        const sig = shapes.map((s) => s.id).join("|");
        // §15.5：形状集合变化时只补渲染一次，但【本帧仍然继续写已有元素】
        if (sig !== shapeSigRef.current) {
          shapeSigRef.current = sig;
          flushSync(() => setFrameTick((n) => n + 1)); // 只会重渲彩带层（16.6）
        }
      }
      for (const s of shapes) {
        const el = neckEls.current.get(`${gk}|${s.id}`);
        if (!el || !el.isConnected) continue;
        const d = shapePath(s);
        el.style.transition = "opacity 160ms var(--flow-ease)"; // 只关几何过渡，保留淡入淡出
        el.setAttribute("d", d);
        el.style.setProperty("d", `path("${d}")`);
      }
    }
  }, [smooth, kernel, readLiveShift]);

  const settleMotion = useCallback((ms = 900, next: FlowMotion = "steady") => {
    if (motionTimer.current != null) window.clearTimeout(motionTimer.current);
    motionTimer.current = window.setTimeout(() => {
      motionTimer.current = null;
      if (stageRef.current !== "closed") setMotion(next);
    }, ms);
  }, []);

  // ---------------------------------------------------------------- 正文让位（预留变化）
  const waitRelayout = useCallback(() => {
    relayoutCleanup.current?.();
    return new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        off();
        if (relayoutCleanup.current === fin) relayoutCleanup.current = null;
        resolve();
      };
      const off = kernel?.on("relocate", fin) ?? (() => {});
      relayoutCleanup.current = fin;
      window.setTimeout(fin, FLOW.RELAYOUT_WAIT_MS);
    });
  }, [kernel]);

  const changeReserve = useCallback(
    async (r: number) => {
      if (r === currentReserve.current) return;
      setMotion("turn");
      setArmed(false);
      bump();
      await sleep(180);
      if (shiftEl) shiftEl.style.opacity = "0";
      applyGutter(r);
      await waitRelayout();
      await nextFrame();
      sampleGeometry(true);
      syncPlan();
      if (shiftEl) shiftEl.style.opacity = "1";
      setMotion("turn");
      setArmed(true);
      bump();
      settleMotion(760);
    },
    [applyGutter, sampleGeometry, shiftEl, syncPlan, bump, settleMotion, waitRelayout],
  );

  // ---------------------------------------------------------------- 打开 / 关闭
  const waitRailClosed = useCallback(async () => {
    const rail = viewportEl?.ownerDocument.querySelector("[data-reader-side-rail]") as HTMLElement | null;
    if (!rail || rail.classList.contains("is-closed")) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        rail.removeEventListener("transitionend", on);
        resolve();
      };
      const on = (e: TransitionEvent) => {
        if (e.propertyName === "width") fin();
      };
      rail.addEventListener("transitionend", on);
      const dur = parseFloat(getComputedStyle(rail).transitionDuration || "0");
      const ms = (Number.isFinite(dur) ? dur * 1000 : 0) + 60;
      window.setTimeout(fin, Math.max(ms, 60));
    });
  }, [viewportEl]);

  const openSeq = useCallback(async () => {
    const ticket = ++ticketRef.current;
    setStage("opening");
    setMotion("open");
    setArmed(false);
    bump();
    await waitRailClosed();
    if (ticket !== ticketRef.current) return;
    sampleGeometry(true);
    syncPlan();
    await nextFrame();
    if (ticket !== ticketRef.current) return;
    const p = planRef.current;
    if (p && p.reserve > 0) await changeReserve(p.reserve);
    else if (p && p.shift > 0) {
      applyShift(p.shift);
      await sleep(420);
      if (ticket !== ticketRef.current) return;
      sampleGeometry(true);
      syncPlan();
    }
    setArmed(true);
    bump();
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      if (ticket !== ticketRef.current) return;
      setStage("open");
      setMotion("steady");
    }, 1500);
  }, [waitRailClosed, sampleGeometry, syncPlan, changeReserve, applyShift, bump]);

  const closeSeq = useCallback(async () => {
    const ticket = ++ticketRef.current;
    setStage("closing");
    setMotion("close");
    setArmed(true);
    bump();
    await sleep(480);
    if (ticket !== ticketRef.current) return;
    applyShift(0);
    applyGutter(0);
    if (shiftEl) shiftEl.style.opacity = "";
    setTracking(false);
    trackingRef.current = false;
    setGeo(null);
    geoRef.current = null;
    sigRef.current = "";
    setStage("closed");
    setMotion("steady");
  }, [applyShift, applyGutter, shiftEl, bump]);

  useEffect(() => {
    if (!viewportEl) return;
    if (open && !covered) {
      if (stageRef.current === "closed" || stageRef.current === "closing") void openSeq();
    } else if (stageRef.current === "opening" || stageRef.current === "open") {
      void closeSeq();
    }
  }, [open, covered, viewportEl, openSeq, closeSeq]);

  // 文档切换：清几何 / 版心 / 排布与正文让位，再按当前开关重新开场（旧文档的平移与槽宽不能带到新文档）
  const prevDocRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevDocRef.current;
    prevDocRef.current = documentId;
    if (prev == null || prev === documentId) return; // 首次挂载由开场流程负责，不在这里重来
    ticketRef.current++;
    baseWRef.current = null;
    sigRef.current = "";
    geoRef.current = null;
    setGeo(null);
    planRef.current = null;
    setPlan(null);
    applyShift(0);
    applyGutter(0);
    if (shiftEl) shiftEl.style.opacity = "";
    lastGroupRef.current = { groupId: null, members: [] };
    lastPeekRef.current = null;
    winRef.current.clear();
    neckEls.current.clear();
    shapeSigRef.current = "";
    framesRef.current.clear();
    liveGenRef.current = "none";
    itemElCache.current = null;
    setCmpPage(0);
    setMotion("steady");
    setArmed(false);
    setStage("closed");
    if (open && !covered) window.setTimeout(() => void openSeq(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => () => {
    ticketRef.current++;
    for (const t of [openTimer.current, motionTimer.current, turnTimer.current, shiftTimer.current]) if (t != null) window.clearTimeout(t);
    relayoutCleanup.current?.();
  }, []);

  // ---------------------------------------------------------------- 几何事件（翻页 / 滚动）
  const beginTurn = useCallback(() => {
    setMotion("turn");
    setArmed(false);
    bump();
    if (turnTimer.current != null) window.clearTimeout(turnTimer.current);
    turnTimer.current = window.setTimeout(() => {
      turnTimer.current = null;
      sampleGeometry(true);
      syncPlan();
      setArmed(true);
      bump();
      settleMotion(760);
    }, FLOW.TURN_RESAMPLE_MS);
  }, [sampleGeometry, syncPlan, bump, settleMotion]);

  const finishTrack = useCallback(() => {
    trackingRef.current = false;
    setTracking(false);
    setMotion("steady");
    sampleGeometry(true);
    bump();
  }, [sampleGeometry, bump]);

  const beginTrack = useCallback(() => {
    if (trackingRef.current) return;
    trackingRef.current = true;
    setTracking(true);
    setMotion("track");
    bump();
    const loop = () => {
      if (!trackingRef.current) return;
      sampleGeometry();
      if (performance.now() - lastRelocateAt.current >= FLOW.TRACK_IDLE_MS) {
        finishTrack();
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, [sampleGeometry, finishTrack, bump]);

  // §13.3.4：平滑滚动模式下正文 scroll 逐帧驱动（不再依赖 relocate 的 250ms 防抖）
  useEffect(() => {
    if (!smooth || !kernel?.onContentScroll || stage === "closed" || stage === "closing") return;
    let idle: number | null = null;
    const off = kernel.onContentScroll(() => {
      if (!trackingRef.current) {
        trackingRef.current = true;
        setTracking(true);
        setMotion("track");
      }
      paintFrame();
      if (idle != null) window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        idle = null;
        trackingRef.current = false;
        for (const el of neckEls.current.values()) el.style.transition = "";
        sampleGeometry(true); // 停下后刷新文档坐标（可能有新段落载入）；不做对齐
        setTracking(false);
        setMotion("steady");
      }, FLOW.TRACK_IDLE_MS);
    });
    return () => {
      off();
      if (idle != null) window.clearTimeout(idle);
    };
  }, [smooth, kernel, stage, paintFrame, sampleGeometry]);

  useEffect(() => {
    if (!viewportEl || !kernel) return;
    if (stage === "closed" || stage === "closing") return;
    const off = kernel.on("relocate", () => {
      lastRelocateAt.current = performance.now();
      if (smooth) {
        // 平滑模式：relocate 只做章节载入 / 跳转后的重采，不启动跟踪循环
        sampleGeometry(true);
        syncPlan();
        return;
      }
      if (scrolled) beginTrack();
      else beginTurn();
    });
    const kick = requestAnimationFrame(() => {
      sampleGeometry(true);
      syncPlan();
      bump();
    });
    return () => {
      off();
      cancelAnimationFrame(kick);
    };
  }, [stage, kernel, viewportEl, scrolled, smooth, beginTrack, beginTurn, sampleGeometry, syncPlan, bump]);

  // §14.5：缩放逐帧跟手——拖动中只读容器 + 纯计算（不重采 iframe 几何、不重排），停手后才采样与评估预留
  const resizingRef = useRef(false);
  useEffect(() => {
    if (!viewportEl) return;
    let idle: number | null = null;
    let raf = 0;
    const doc = viewportEl.ownerDocument;
    const onResize = () => {
      resizingRef.current = true;
      doc.body.setAttribute("data-flow-resizing", "1");
      if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; syncPlan(); });
      if (idle != null) window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        idle = null;
        resizingRef.current = false;
        doc.body.removeAttribute("data-flow-resizing");
        const p = planRef.current;
        if (p && p.reserve !== currentReserve.current) void changeReserve(p.reserve);
        sampleGeometry(true);
        syncPlan();
        bump();
      }, FLOW.RESIZE_IDLE_MS);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(viewportEl);
    window.addEventListener("resize", onResize);
    return () => {
      if (idle != null) window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      doc.body.removeAttribute("data-flow-resizing");
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [viewportEl, sampleGeometry, syncPlan, bump, changeReserve]);

  // 排布生效：打开完成后平移 / 预留的变化走 §8.8 编排
  useEffect(() => {
    if (stage !== "open" || !plan) return;
    if (plan.reserve !== currentReserve.current) {
      if (resizingRef.current) return; // 拖动中不重排；停手的 idle 会收口
      void changeReserve(plan.reserve);
      return;
    }
    if (plan.shift !== currentShift.current) {
      applyShift(plan.shift);
      if (shiftTimer.current != null) window.clearTimeout(shiftTimer.current);
      // §8.8：正文滑行期间高亮先隐去，落定后再从节点伸回——否则流带会拖在移动的文字后面
      if (!resizingRef.current) setShifting(true);
      shiftTimer.current = window.setTimeout(() => {
        shiftTimer.current = null;
        if (resizingRef.current) return;
        sampleGeometry(true);
        syncPlan();
        setShifting(false);
        beginTurn(); // 折叠到节点 → 220ms 后伸回（复刻 §8.3/§8.8 的「伸回」）
      }, 460);
    }
  }, [stage, plan, changeReserve, applyShift, sampleGeometry, syncPlan, beginTurn]);

  // ---------------------------------------------------------------- 组切换动效
  useEffect(() => {
    const gid = data.groupId;
    if (!gid) return;
    const prev = lastGroupRef.current;
    if (!data.graph) {
      lastGroupRef.current = { groupId: gid, members: [] };
      lastPeekRef.current = data.peek;
      return;
    }
    const members = childrenOf(data.graph, gid).filter((id) => data.graph!.nodes[id]);
    if (prev.groupId === gid) {
      lastGroupRef.current = { groupId: gid, members };
      lastPeekRef.current = data.peek; // 记录切换前的「旧预览组」
      return;
    }
    if (prev.groupId) {
      const sw = data.switchInfo;
      if (sw) {
        let m: FlowMotion;
        if (prev.members.includes(gid)) m = "zoom-in";
        else if (members.includes(prev.groupId)) m = "zoom-out";
        else if (lastPeekRef.current?.groupId === gid) m = sw.dir === "down" ? "conveyor-down" : "conveyor-up";
        else m = sw.dir === "down" ? "regroup-down" : "regroup-up";
        // §16.1.2：换代已由「一代一层」整体淡入淡出接管，不再 bump() 触发零件级重编排
        setMotion(m);
        setArmed(true);
        settleMotion(400);
      }
    }
    lastGroupRef.current = { groupId: gid, members };
    lastPeekRef.current = data.peek;
    setCmpPage(0);
  }, [data.groupId, data.graph, data.switchInfo, data.peek, settleMotion]);

  // ---------------------------------------------------------------- 场景（§16.6：layoutMemo 只跟布局输入，base 再叠加动效状态）
  const layoutMemo: Omit<FlowScene, "shapes" | "seq" | "motion" | "tracking" | "shifting" | "armed" | "smooth"> | null = useMemo(() => {
    if (!plan || !viewportEl) return null;
    const vp = geo?.viewport ?? readViewport();
    const top = vp.top + FLOW.COL_MARGIN_Y;
    const bottom = vp.bottom - FLOW.COL_MARGIN_Y;
    const avail = Math.max(80, bottom - top);
    const g = data.graph;
    const readingId = data.readingId && g?.nodes[data.readingId] ? data.readingId : null;
    const cut = data.groupId ?? (readingId ? g?.nodes[readingId]?.parentId ?? ROOT_ID : null);
    // §16.1：代键＝主体组；genKey 变＝换代（旧代整体退场、新代整体入场）
    const genKey = cut ?? "none";
    const all = g && cut ? childrenOf(g, cut).filter((id) => g.nodes[id]) : [];
    const pattern: FlowPattern = g && cut && all.length >= 2 ? patternFor(g, cut, all) : "tree";
    const patternName = T(PATTERN_LABEL[pattern]);
    const header = g && cut ? (cut === ROOT_ID ? String(title || g.meta?.title || "") : String(g.nodes[cut]?.title ?? "")) : String(title || "");
    const colorOf = new Map<string, string>(all.map((id, i) => [id, id === readingId ? colors.accent : colors.palette[i % 8]]));
    const sel = data.sel && g?.nodes[data.sel] ? data.sel : null;
    const explainOpen = !!(data.explainFor && data.explainFor === sel);
    const inlineH = sel ? FLOW.ACTIONS_H + (explainOpen ? Math.min(FLOW.EXPLAIN_MAX_H, Math.ceil((data.explainText.length * 12) / Math.max(1, plan.labelW || FLOW.LABEL_W_COMPACT)) * 18 + 12) : 0) : 0;
    const panel = !g || !all.length
      ? !data.hasKey && !g
        ? { kind: "nokey" as const, feedDone: data.feed.done, feedTotal: data.feed.total }
        : data.busy === "pending"
          ? { kind: "busy" as const, feedDone: data.feed.done, feedTotal: data.feed.total }
          : !g && !(data.feed.unsupported || data.feed.complete || data.feed.error)
            ? { kind: "feeding" as const, feedDone: data.feed.done, feedTotal: data.feed.total }
            : { kind: "empty" as const, feedDone: data.feed.done, feedTotal: data.feed.total }
      : { kind: "ok" as const, feedDone: data.feed.done, feedTotal: data.feed.total };

    const planCtx: FlowPlan = plan.labelW ? plan : { ...plan, labelW: FLOW.LABEL_W_COMPACT, labelX: plan.barX + FLOW.BAR_MAX + FLOW.LABEL_GAP };
    const fitBase: Omit<LayoutCtx, "members" | "moreAbove" | "moreBelow" | "maxLines0"> = {
      g: g ?? ({ nodes: {}, children: {}, outEdges: {}, inEdges: {} } as unknown as GraphState),
      plan: planCtx,
      colors,
      pattern,
      cut: cut ?? ROOT_ID,
      header,
      patternName,
      colorOf,
      paletteOf: new Map(all.map((id, i) => [id, colors.palette[i % 8]])),
      readingId,
      readingBlock: data.readingBlock,
      selectedId: sel,
      expandedId: data.expandedId,
      inlineH,
      canBack: !!data.backLoc,
      maxW: Math.max(160, vp.right - FLOW.PAD_R - planCtx.labelX),
      cmpPage,
      availH: avail,
    };
    let lay: PatternLayout & { members?: string[] };
    let mainHeight = 0;
    let aboveH = 0; // 上方预览实际高度（dy 只用上方槽的剩余部分）
    let mainAvail = Math.max(80, bottom - (top + COLUMN.ABOVE_SLOT));
    if (g && cut && all.length) {
      // §13.2：主体顶边固定；主体可用高度与预览有无无关 → 折叠结果稳定
      const mainTop = top + COLUMN.ABOVE_SLOT;
      mainAvail = Math.max(160, bottom - mainTop);
      const peekCtx = { ...fitBase, members: all, moreAbove: 0, moreBelow: 0, maxLines0: 2 as const, availH: mainAvail };
      const main = fitLayout({ ...fitBase, availH: mainAvail, winStart: winRef.current.get(cut) }, all, mainAvail);
      winRef.current.set(cut, Math.max(0, all.indexOf(main.members[0])));
      let above: PatternLayout | null = null;
      let below: PatternLayout | null = null;
      // §14.2-1：预览组与当前组相同时一律不画（同 id 会在合并时与主体互吞）
      const peek = data.peek && data.peek.groupId !== cut ? data.peek : null;
      if (peek?.side === "above") above = layoutPeek(peekCtx, peek.groupId, "above", COLUMN.ABOVE_ROWS);
      if (peek?.side === "below") {
        const room = bottom - (mainTop + main.height) - PEEK.GAP;
        const rows = Math.min(PEEK.MAX_ROWS, Math.floor((room - 20 - 16) / PEEK.ROW_H));
        if (rows >= 1) below = layoutPeek(peekCtx, peek.groupId, "below", rows);
      }
      mainHeight = main.height;
      // §14.3：上方槽按最坏高度（2 行 + 另 N 项）预留，预览底对齐到主体上方 8px，且永不越出列原点
      aboveH = above?.height ?? 0;
      lay = mergeLayouts(main, above, below, {
        mainOff: COLUMN.ABOVE_SLOT,
        aboveOff: above ? Math.max(0, COLUMN.ABOVE_SLOT - 8 - aboveH) : 0,
        belowOff: COLUMN.ABOVE_SLOT + main.height + PEEK.GAP,
      });
      lay.members = main.members;
    } else {
      lay = EMPTY_LAYOUT();
    }
    // 预览 / 主体概览的定位方向（流带 stub 用）
    const sideOf: Record<string, "above" | "below" | "here"> = {};
    if (g) for (const p of lay.ports) {
      const n = g.nodes[p.nodeId];
      sideOf[p.nodeId] = !n || data.readingBlock == null || n.blockStart == null || n.blockEnd == null
        ? "here"
        : n.blockEnd < data.readingBlock
          ? "above"
          : n.blockStart > data.readingBlock
            ? "below"
            : "here";
    }
    lay.sideOf = sideOf;

    // §13.2：列不平移——主体恒在 ABOVE_SLOT；§14.3：超高时只吃上方槽的【剩余】部分，永不越过视口顶
    let dy = top;
    if (mainHeight > mainAvail) dy = top - Math.min(Math.max(0, COLUMN.ABOVE_SLOT - 8 - aboveH), mainHeight - mainAvail);

    // 悬停集合：自己 + 全部下级（§12.2）
    const hoverSet = new Set<string>();
    if (data.hoverId && g) {
      hoverSet.add(data.hoverId);
      const walk = (id: string) => {
        for (const k of childrenOf(g, id)) {
          if (hoverSet.has(k)) continue;
          hoverSet.add(k);
          walk(k);
        }
      };
      walk(data.hoverId);
    }
    const extra = data.hoverId && g?.nodes[data.hoverId] && !lay.ports.some((p) => p.nodeId === data.hoverId)
      ? [{ nodeId: data.hoverId, color: colorOf.get(data.hoverId) ?? colors.palette[0] }]
      : [];
    const focusId = sel ?? readingId;
    const shapeOpts = { focusId, hoverId: data.hoverId, readingId, colorOf: (id: string) => colorOf.get(id) ?? colors.palette[0], hoverSet, extra };
    // §16.1.2：逐帧数据按代存（旧代退场期间还要拿它画彩带）
    framesRef.current.set(genKey, { lay, dy, opts: shapeOpts });
    liveGenRef.current = genKey;
    const textRight = geo?.text?.right ?? vp.right - 120;
    const strands = g && all.length ? buildStrands(g, lay, dy, { textRight, focusId, all: pattern === "layered" }) : [];
    return {
      mode: plan.mode,
      plan,
      viewport: vp,
      colors,
      pattern,
      patternName,
      dy,
      layout: lay,
      strands,
      genKey,
      switchDir: data.switchInfo?.dir ?? "down",
      inline: { forId: sel, explainOpen, explainText: data.explainText, explainBusy: data.explainBusy, status: data.status },
      hoverId: data.hoverId,
      focusId,
      canBack: !!data.backLoc,
      panel,
    };
  }, [
    plan, viewportEl, geo, data.graph, colors, title, T, cmpPage, data.readingBlock, data.status, data.hoverId, data.sel, data.expandedId,
    data.explainFor, data.explainText, data.explainBusy, data.groupId, data.readingId, data.peek, data.backLoc, data.feed, data.busy, data.hasKey,
    data.switchInfo, readViewport,
  ]);

  // §16.6：滚动开始/停止只改 tracking，不再重跑 fitLayout / mergeLayouts（lay 引用不变 → UpperGen 的 usePresence 不触发）
  const base: Omit<FlowScene, "shapes"> | null = useMemo(() => {
    if (!layoutMemo) return null;
    return {
      ...layoutMemo,
      seq: animKey,
      motion: layoutMemo.mode === "whisper" ? "steady" : motion,
      tracking,
      shifting,
      armed,
      smooth,
    };
  }, [layoutMemo, motion, tracking, shifting, armed, animKey, smooth]);

  // §16.5：停止滚动后也要跑完——代内几何过渡可能还没走完，收尾循环逐帧把彩带对齐条目实际位置
  useEffect(() => {
    if (!smooth) return;
    settleUntil.current = performance.now() + 240 + 40; // --flow-t-geo + 余量
    let raf = 0;
    const loop = () => {
      paintFrame();
      if (performance.now() < settleUntil.current) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [base, smooth, paintFrame]);

  // §16.1.2：换代后 GEN.REMOVE_MS + 40 毫秒清掉旧代的逐帧数据
  useEffect(() => {
    const t = window.setTimeout(() => {
      const live = liveGenRef.current;
      for (const k of [...framesRef.current.keys()]) if (k !== live) framesRef.current.delete(k);
    }, GEN.REMOVE_MS + 40);
    return () => window.clearTimeout(t);
  }, [layoutMemo?.genKey]);

  const scene: FlowScene | null = useMemo(() => {
    if (!base) return null;
    const geoNow = geoRef.current;
    const F = framesRef.current.get(base.genKey);
    const dx = (plan?.shift ?? 0) - geoShiftRef.current;
    const offs = geoNow ? (smooth && kernel?.getFrameOffsets ? kernel.getFrameOffsets() : null) : null;
    const gNow = geoNow ? geometryAt(geoNow, shiftOffsets(geoNow, offs, dx)) : null;
    const shapes = gNow && F && base.layout.items.length ? buildShapes(gNow, F.lay, F.dy, F.opts) : [];
    shapeSigRef.current = shapes.map((s) => s.id).join("|");
    return { ...base, shapes };
    // frameTick：颈部集合变化时强制重渲染一次（逐帧本身不走 React）
  }, [base, geo, frameTick, smooth, kernel]);

  lastSceneRef.current = scene;

  // 段落定位目标：全部 leaf + 预览成员 + 悬停单元格
  const anchorIds = useMemo(() => {
    if (!scene) return [] as string[];
    const ids = [...scene.layout.leafIds];
    if (scene.hoverId && !scene.layout.ports.some((p) => p.nodeId === scene.hoverId) && data.graph?.nodes[scene.hoverId]) ids.push(scene.hoverId);
    return [...new Set(ids)];
  }, [scene, data.graph]);
  useEffect(() => {
    if (!active) return;
    const sig = anchorIds.join("|");
    if (sig === anchorSigRef.current) return;
    anchorSigRef.current = sig;
    data.requestAnchors(anchorIds);
  }, [active, anchorIds, data]);

  // ---------------------------------------------------------------- 交互
  const handle = useCallback(
    (ev: FlowEvent) => {
      const sc = lastSceneRef.current;
      const focus = (data.sel && data.graph?.nodes[data.sel]) ? data.sel : data.readingId;
      const g = data.graph;
      switch (ev.kind) {
        case "hover":
          if (hoverClear.current != null) window.clearTimeout(hoverClear.current);
          if (ev.nodeId) data.setHoverId(ev.nodeId);
          else hoverClear.current = window.setTimeout(() => data.setHoverId(null), 200);
          break;
        case "click": {
          if (ev.peek && data.peek) {
            data.focusGroup(data.peek.groupId, ev.nodeId);
            break;
          }
          if (ev.nodeId === data.readingId) {
            data.setSel(null);
            break;
          }
          data.setSel(ev.nodeId);
          const kids = g ? childrenOf(g, ev.nodeId).filter((id) => g.nodes[id]) : [];
          const isMember = !!sc && sc.layout.items.some((i) => i.nodeId === ev.nodeId && i.kind === "node" && !i.peek);
          if (kids.length && isMember && sc?.pattern !== "compare") {
            const expanding = data.expandedId !== ev.nodeId;
            data.toggleExpand(ev.nodeId);
            setMotion(expanding ? "split" : "merge");
            setArmed(true);
            bump();
            settleMotion(700);
          }
          break;
        }
        case "dblclick":
          void data.jumpTo(ev.nodeId);
          break;
        case "more": {
          if (ev.moreKind === "kids") {
            onOpenInMap(ev.nodeId ?? null, sc?.layout.leafIds ?? []);
            break;
          }
          const members = sc?.layout.items.filter((i) => i.kind === "node" && !i.peek).map((i) => i.nodeId! ) ?? [];
          if (ev.moreKind === "above") data.setSel(members[0] ?? null);
          else data.setSel(members[members.length - 1] ?? null);
          break;
        }
        case "action": {
          switch (ev.name) {
            case "back":
              void data.goBack();
              break;
            case "jump":
              if (focus) void data.jumpTo(focus);
              break;
            case "explain":
              if (focus) void data.explain(focus);
              break;
            case "closeExplain":
              data.closeExplain();
              break;
            case "deepen":
              if (focus) void data.deepen(focus);
              break;
            case "generate":
              void data.generateHere();
              break;
            case "openInMap":
              onOpenInMap(focus, sc?.layout.leafIds ?? []);
              break;
            case "cmpPrev":
              setCmpPage((p) => Math.max(0, p - 1));
              break;
            case "cmpNext": {
              const pages = (sc?.layout as PatternLayout & { cmpPages?: number })?.cmpPages ?? 1;
              setCmpPage((p) => Math.min(pages - 1, p + 1)); // 由版式按实际页数钳制
              break;
            }
          }
          break;
        }
      }
    },
    [data, onOpenInMap, bump, settleMotion],
  );

  // Esc：关闭结构图（焦点不在输入框时）
  useEffect(() => {
    if (stage === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stage, onClose]);

  if (!scene || stage === "closed") return null;
  const doc = viewportEl?.ownerDocument ?? document;
  return createPortal(<FlowLayer scene={scene} onEvent={handle} registerShape={registerShape} />, doc.body);
}

function samePlan(a: FlowPlan, b: FlowPlan): boolean {
  return a.mode === b.mode && a.shift === b.shift && a.reserve === b.reserve && a.barX === b.barX && a.labelX === b.labelX && a.labelW === b.labelW;
}

/** §12.4.4：整列 = [上方预览] + 主体 + [下方预览]；合并时 key 重复保留主体那份 */
/** §13.2.4：整列 = [上方预览] + 主体 + [下方预览]；三个固定偏移，内部不再自行累加 */
function mergeLayouts(
  main: PatternLayout & { members?: string[] },
  above: PatternLayout | null,
  below: PatternLayout | null,
  off: { mainOff: number; aboveOff: number; belowOff: number },
): PatternLayout {
  const seen = new Set<string>();
  const seenPrim = new Set<string>();
  const items: FlowItem[] = [];
  const ports: PatternLayout["ports"] = [];
  const prims: PatternLayout["prims"] = [];
  const pushPart = (lay: PatternLayout | null, o: number, isMain: boolean) => {
    if (!lay) return;
    for (const it of lay.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push({ ...it, y: it.y + o, peek: isMain ? it.peek : true });
    }
    for (const p of lay.ports) {
      if (ports.some((x) => x.nodeId === p.nodeId)) continue;
      ports.push({ ...p, y0: p.y0 + o, y1: p.y1 + o });
    }
    for (const pr of lay.prims) {
      // §15.3-2：图元也按 id 去重（主体优先），否则预览被丢弃的条目会留下浮空的条 / 分隔线
      if (seenPrim.has(pr.id)) continue;
      seenPrim.add(pr.id);
      if (pr.k === "path" && pr.grad) {
        prims.push({ ...pr, off: (pr.off ?? 0) + o, grad: { ...pr.grad, y1: pr.grad.y1 + o, y2: pr.grad.y2 + o } });
      } else {
        prims.push({ ...pr, off: (pr.off ?? 0) + o });
      }
    }
  };
  // §14.2-1：主体优先——预览与主体撞 id 时保留主体（否则预览会吞掉主项，留下浮空的条/断掉的彩带）
  pushPart(main, off.mainOff, true);
  if (above) pushPart(above, off.aboveOff, false);
  if (below) pushPart(below, off.belowOff, false);
  const leafIds = [...new Set([...main.leafIds, ...(above?.leafIds ?? []), ...(below?.leafIds ?? [])])];
  return {
    items,
    ports,
    prims,
    expressed: [...main.expressed],
    leafIds,
    height: below ? off.belowOff + below.height : off.mainOff + main.height,
    readingY: main.readingY != null ? main.readingY + off.mainOff : null,
    parentOf: main.parentOf,
    noStrands: main.noStrands,
    inlineAt: main.inlineAt ? { ...main.inlineAt, y: main.inlineAt.y + off.mainOff } : undefined,
  };
}
