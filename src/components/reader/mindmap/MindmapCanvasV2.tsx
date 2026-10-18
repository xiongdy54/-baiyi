// 材料导图 v2 · 结构画布（MINDMAP-V2-IMPL-PLAN §5.2 MindmapCanvasV2；设计稿 §15）。
// 管线：GraphState →（≤4 次/秒节流，S4）layoutGraph（增量缓存 S2 + S5 锁）→ monotoneFrames（流式组框只增不减）
//      → planTransition（S3 锚点补偿 / S8 进入离场）→ rAF：transitionFrame → lodFrames → routeRelations → buildCanvasSvg → <svg>.innerHTML。
// X5：buildCanvasSvg 已对帧内全部文本 / 属性严格 escapeXml，交互帧不过 DOMPurify（2,000 节点每帧太贵）；导出 SVG 才过 DOMPurify。
// 交互：data-node-id 选中 / 双击折叠；data-act="deepen" 深挖、"unfold" 折叠切换、"lod-expand" 展开省略项；
//      悬停 400ms 回调 onPrefetch（移开取消）；拖拽沿用 v1「位移超阈值才捕获指针」修复；滚轮绕光标缩放。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { GraphState, PatternKey, RelCode } from "../../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../../lib/mindmap/v2/types";
import { createLayoutCache, layoutGraph, type Display } from "../../../lib/mindmap/v2/layout";
import { routeRelations, REL_STYLE } from "../../../lib/mindmap/v2/route";
import { buildCanvasSvg, type SvgLabels } from "../../../lib/mindmap/v2/svg";
import {
  growthScope,
  lodFrames,
  monotoneFrames,
  planTransition,
  throttleStep,
  transitionFrame,
  type FrameSizes,
  type ThrottleState,
  type Transition,
  type View,
} from "../../../lib/mindmap/v2/animate";
import { HOW_NAMES, PATTERN_NAMES, type PatternHow, type PatternLocks } from "../../../lib/mindmap/v2/pattern";
import { useT } from "../../../lib/i18n";

export interface MindmapCanvasHandle {
  fit(): void;
  center(id: string): void;
  zoomBy(factor: number): void;
  /** 自包含静态 SVG（已过 DOMPurify） */
  exportSvg(): string;
}

export interface MindmapCanvasV2Props {
  graph: GraphState;
  rootTitle: string;
  selectedId: string | null;
  /** S3 锚点：用户刚操作的节点；整图生成中传 ROOT_ID 或当前选中 */
  anchorId: string | null;
  relAll: boolean;
  focus: boolean;
  onSelect: (id: string | null) => void;
  onDeepen: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  /** 悬停 400ms（X4 同意与配额由主进程判定） */
  onPrefetch?: (id: string) => void;
}

const ZMIN = 0.1;
const ZMAX = 2.5;
/** 适配窗口时的最低缩放（低于 0.5 走 LOD 摘要卡，0.35 仍能看清框标题） */
const FIT_MIN = 0.35;
const HOVER_PREFETCH_MS = 400;
const FRESH_MS = 1200;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

const MindmapCanvasV2 = forwardRef<MindmapCanvasHandle, MindmapCanvasV2Props>(function MindmapCanvasV2(props, ref) {
  const { graph, rootTitle, selectedId, anchorId, relAll, focus, onSelect, onDeepen, onToggleCollapse, onPrefetch } = props;
  const T = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 最新 props（rAF / 计时器回调里读）
  const live = useRef(props);
  live.current = props;

  const cacheRef = useRef(createLayoutCache());
  const locksRef = useRef<PatternLocks>({});
  const sizesRef = useRef<FrameSizes>({});
  const throttleRef = useRef<ThrottleState>({ last: null });
  const pendingRef = useRef<number | null>(null);
  const targetRef = useRef<Display | null>(null); // 最近一次布局终态
  const shownRef = useRef<Display | null>(null); // 当前帧（插值中）
  const trRef = useRef<{ tr: Transition; t0: number } | null>(null);
  const frameOpRef = useRef<{ opacity: Record<string, number>; leaving: ReturnType<typeof transitionFrame>["leaving"] }>({ opacity: {}, leaving: [] });
  const viewRef = useRef<View>({ tx: 24, ty: 24, k: 1 });
  const userMovedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const hoverRef = useRef<string | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const freshRef = useRef<{ ids: Set<string>; until: number }>({ ids: new Set(), until: 0 });
  const [lodExpanded, setLodExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const lodRef = useRef(lodExpanded);
  lodRef.current = lodExpanded;

  // i18n 文案（frameLabel 须跨调用同一引用以命中布局缓存）
  const frameLabel = useMemo(() => (p: PatternKey, how: PatternHow) => `${T(PATTERN_NAMES[p])} · ${T(HOW_NAMES[how])}`, [T]);
  const labels = useMemo<Partial<SvgLabels>>(
    () => ({
      deepen: T("深挖此节点"),
      floor: T("已触底：没有更深的结构"),
      streaming: T("正在生成"),
      unfold: (n: number) => T("展开 {n} 个子节点", { n }),
      more: (n: number) => T("另有 {n} 项", { n }),
      cross: (n: number) => T("{n} 条跨组关系，悬停或选中查看", { n }),
      stub: T("其余部分，可深挖"),
      summary: (p: string, n: number) => T("{p} · {n} 个子结构", { p, n }),
      patternName: (k: PatternKey) => T(PATTERN_NAMES[k] ?? k),
    }),
    [T],
  );
  const relName = useCallback((c: RelCode) => T(REL_STYLE[c]?.name ?? c), [T]);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const relNameRef = useRef(relName);
  relNameRef.current = relName;

  // ---------- 绘制 ----------
  const paint = useCallback(() => {
    const svg = svgRef.current;
    const d = shownRef.current;
    if (!svg) return;
    if (!d) {
      svg.innerHTML = "";
      return;
    }
    const p = live.current;
    const view = viewRef.current;
    const hovered = hoverRef.current;
    const lod = lodFrames(d, view.k);
    const routed = routeRelations(p.graph, d, {
      relAll: p.relAll,
      hovered,
      selected: p.selectedId,
      focus: p.focus && !!p.selectedId,
      zoom: view.k,
      lodCollapsed: lod,
      relName: relNameRef.current,
    });
    const fr = freshRef.current;
    const fresh = performance.now() < fr.until ? fr.ids : undefined;
    svg.innerHTML = buildCanvasSvg(
      d,
      routed,
      { view, selected: p.selectedId, hovered, opacity: frameOpRef.current.opacity, leaving: frameOpRef.current.leaving, fresh, lodCollapsed: lod },
      { fragment: true, graph: p.graph, rootTitle: p.rootTitle, labels: labelsRef.current, idPrefix: "mm2c-" },
    );
  }, []);

  const tick = useCallback(
    (now: number) => {
      rafRef.current = null;
      const cur = trRef.current;
      if (cur) {
        const f = transitionFrame(cur.tr, now - cur.t0);
        shownRef.current = f.display;
        viewRef.current = f.view;
        frameOpRef.current = { opacity: f.opacity, leaving: f.leaving };
        if (f.done) trRef.current = null;
      }
      paint();
      if (trRef.current) rafRef.current = requestAnimationFrame(tick);
    },
    [paint],
  );
  const requestPaint = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const fitTo = useCallback((d: Display | null) => {
    const box = boxRef.current;
    if (!box || !d) return;
    const r = box.getBoundingClientRect();
    const W = Math.max(1, r.width), H = Math.max(1, r.height);
    // 整图放得下就整图适配；放不下（书级导图常是窄高的长条，2026-10-18 实测 3604×16832）则按宽度适配、
    // 顶部对齐，缩放不低于 FIT_MIN（再小字就看不清了），纵向靠拖拽浏览。
    const kAll = Math.min(1, (W - 48) / Math.max(1, d.bounds.w), (H - 48) / Math.max(1, d.bounds.h));
    const kW = Math.min(1, (W - 48) / Math.max(1, d.bounds.w));
    const k = Math.max(ZMIN, kAll >= FIT_MIN ? kAll : Math.max(FIT_MIN, kW));
    const tx = d.bounds.w * k <= W ? Math.round((W - d.bounds.w * k) / 2) : 24;
    viewRef.current = { k, tx, ty: 24 };
  }, []);

  // ---------- 布局（节流） ----------
  const doLayout = useCallback(() => {
    pendingRef.current = null;
    const p = live.current;
    let d = layoutGraph(p.graph, { cache: cacheRef.current, locks: locksRef.current, lodExpanded: lodRef.current, frameLabel, rootTitle: p.rootTitle });
    if (d.locks) locksRef.current = d.locks;
    const scope = growthScope(p.graph);
    const mono = monotoneFrames(d, sizesRef.current, scope);
    d = mono.display;
    sizesRef.current = mono.sizes;
    const prev = shownRef.current;
    targetRef.current = d;
    if (!prev && !userMovedRef.current) {
      fitTo(d);
    }
    const tr = planTransition(prev, d, { view: viewRef.current, anchorId: p.anchorId, reducedMotion: prefersReducedMotion() });
    if (prev) {
      const enteredCards = tr.enter.filter((id) => d.byId[id] && d.byId[id].kind === "card");
      if (enteredCards.length) {
        freshRef.current = { ids: new Set(enteredCards), until: performance.now() + FRESH_MS };
        window.setTimeout(requestPaint, FRESH_MS + 20); // 到期后去掉「刚到达」描边
      }
    }
    trRef.current = { tr, t0: performance.now() };
    requestPaint();
  }, [fitTo, frameLabel, requestPaint]);

  const requestLayout = useCallback(() => {
    const step = throttleStep(throttleRef.current, performance.now());
    if (step.run) {
      throttleRef.current = step.state;
      if (pendingRef.current != null) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      doLayout();
    } else if (pendingRef.current == null) {
      pendingRef.current = window.setTimeout(() => {
        throttleRef.current = { last: performance.now() };
        doLayout();
      }, step.delay);
    }
  }, [doLayout]);

  // 换图（mapId 变化）：清缓存与视图
  const mapKey = graph.mapId;
  useEffect(() => {
    cacheRef.current = createLayoutCache();
    locksRef.current = {};
    sizesRef.current = {};
    shownRef.current = null;
    targetRef.current = null;
    trRef.current = null;
    userMovedRef.current = false;
    setLodExpanded(new Set());
  }, [mapKey]);

  useEffect(() => {
    requestLayout();
  }, [graph, rootTitle, lodExpanded, requestLayout]);

  useEffect(() => {
    requestPaint();
  }, [selectedId, relAll, focus, requestPaint]);

  // 清理时必须把句柄置空：React StrictMode 开发态会「挂载→清理→再挂载」，若只取消不置空，
  // requestPaint 见 rafRef 非空就以为已排帧，从此再不绘制（2026-10-18 用户实测：画布全程空白）。
  // 再挂载时补一次布局（清理可能吞掉了首帧）。
  useEffect(() => {
    requestLayout();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (pendingRef.current != null) window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
      if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
      throttleRef.current = { last: null };
    };
  }, [requestLayout]);

  // 容器尺寸变化（侧栏拖宽 / portal 宿主就位）：未手动移动过视图时重新适配
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!userMovedRef.current && targetRef.current) {
        fitTo(targetRef.current);
        requestPaint();
      }
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [fitTo, requestPaint]);

  // ---------- 命令式接口 ----------
  useImperativeHandle(
    ref,
    () => ({
      fit() {
        userMovedRef.current = false;
        trRef.current = null;
        if (targetRef.current) shownRef.current = targetRef.current;
        fitTo(targetRef.current);
        requestPaint();
      },
      center(id: string) {
        const d = targetRef.current;
        const box = boxRef.current;
        const it = d?.byId[id];
        if (!d || !box || !it) return;
        const r = box.getBoundingClientRect();
        const k = viewRef.current.k;
        viewRef.current = { k, tx: Math.round(r.width / 2 - (it.x + it.w / 2) * k), ty: Math.round(r.height / 2 - (it.y + it.h / 2) * k) };
        userMovedRef.current = true;
        requestPaint();
      },
      zoomBy(factor: number) {
        const box = boxRef.current;
        if (!box) return;
        const r = box.getBoundingClientRect();
        zoomAt(r.width / 2, r.height / 2, factor);
      },
      exportSvg() {
        const d = targetRef.current;
        if (!d) return "";
        const p = live.current;
        const routed = routeRelations(p.graph, d, { relAll: true, geometry: "all", relName: relNameRef.current });
        const raw = buildCanvasSvg(d, routed, {}, { static: true, graph: p.graph, rootTitle: p.rootTitle, labels: labelsRef.current, idPrefix: "mm2x-" });
        return DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitTo, requestPaint],
  );

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const v = viewRef.current;
    const k = Math.min(ZMAX, Math.max(ZMIN, v.k * factor));
    if (k === v.k) return;
    viewRef.current = { k, tx: cx - ((cx - v.tx) * k) / v.k, ty: cy - ((cy - v.ty) * k) / v.k };
    userMovedRef.current = true;
    requestPaint();
  };

  // 滚轮缩放：React 的 onWheel 是 passive，preventDefault 无效 → 原生监听
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 0.9 : 1.1);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 指针 ----------
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const target = e.target as Element;
    const act = target.closest?.("[data-act]") as Element | null;
    if (act) {
      const kind = act.getAttribute("data-act");
      const nid = act.getAttribute("data-node-id");
      if (kind === "deepen" && nid) {
        onDeepen(nid);
        return;
      }
      if (kind === "unfold" && nid) {
        onToggleCollapse(nid);
        return;
      }
      if (kind === "lod-expand") {
        const gid = act.getAttribute("data-group-id");
        if (gid) setLodExpanded((prev) => new Set(prev).add(gid));
        return;
      }
    }
    const el = target.closest?.("[data-node-id]") as Element | null;
    onSelect(el ? el.getAttribute("data-node-id") : null);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest?.("[data-node-id]") as Element | null;
    const id = el?.getAttribute("data-node-id");
    if (id && id !== ROOT_ID && (live.current.graph.children[id]?.length ?? 0) > 0) onToggleCollapse(id);
  };

  const setHover = (id: string | null) => {
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (id && id !== ROOT_ID && onPrefetch) {
      const n = live.current.graph.nodes[id];
      if (n && n.state === "more") {
        hoverTimer.current = window.setTimeout(() => {
          hoverTimer.current = null;
          if (hoverRef.current === id) live.current.onPrefetch?.(id);
        }, HOVER_PREFETCH_MS);
      }
    }
    requestPaint();
  };

  return (
    <div
      className="mindmap-canvas mm2-canvas"
      ref={boxRef}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, dragging: false };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d && e.buttons) {
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.dragging && Math.hypot(dx, dy) > 4) {
            d.dragging = true;
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* 已释放 */
            }
          }
          if (d.dragging) {
            e.preventDefault();
            viewRef.current = { ...viewRef.current, tx: d.tx + dx, ty: d.ty + dy };
            userMovedRef.current = true;
            requestPaint();
          }
          return;
        }
        const el = (e.target as Element).closest?.("[data-node-id]") as Element | null;
        setHover(el ? el.getAttribute("data-node-id") : null);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d?.dragging) {
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 120);
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      }}
    >
      <svg ref={svgRef} className="mm2-svg" width="100%" height="100%" aria-hidden="true" />
    </div>
  );
});

export default MindmapCanvasV2;
