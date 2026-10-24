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
  LOD,
  monotoneFrames,
  planTransition,
  throttleStep,
  transitionFrame,
  type FrameSizes,
  type ThrottleState,
  type Transition,
  type View,
} from "../../../lib/mindmap/v2/animate";
import { perfEnd, perfFrame } from "../../../lib/mindmap/v2/perf";
import { HOW_NAMES, PATTERN_NAMES, type PatternHow, type PatternLocks } from "../../../lib/mindmap/v2/pattern";
import { useT } from "../../../lib/i18n";

export interface MindmapCanvasHandle {
  fit(): void;
  center(id: string): void;
  /** 定位并保证**可见**：缩放低于 LOD 阈值时深层节点被摘要卡隐藏，先抬到阈值再居中；返回是否命中（布局未就位 → false，调用方可重试） */
  reveal(id: string): boolean;
  zoomBy(factor: number): void;
  /** 自包含静态 SVG（已过 DOMPurify） */
  exportSvg(): string;
  /** 布局内容边界（100% 内容坐标；布局未就位＝null）。结构图纸片窗口用它算窗口尺寸。 */
  getBounds(): { w: number; h: number } | null;
  /** 节点在内容坐标系的矩形；不存在＝null。结构图纸片窗口用它把阅读节点换算成屏幕锚点。 */
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null;
  /** 宿主指定比例：k=s、内容原点贴容器左上（0,0）。结构图纸片窗口由窗口尺寸反推比例，不再让画布用 48px 内边距自行 fit。 */
  setViewScale(scale: number): void;
  /** 当前视图（内容坐标 → 容器坐标）：k、tx、ty。宿主算锚点屏幕位置用。 */
  getView(): { scale: number; tx: number; ty: number } | null;
  /** 显式恢复一次「画布自行适配」（完整图谱页签的默认行为）；之后的重排仍由 autoFit prop 决定。 */
  autoFit(): void;
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
  /** 给定后接管双击：不再折叠切换（阅读透镜用它＝双击跳到原文） */
  onNodeDoubleClick?: (id: string) => void;
  /** 指针进出节点（null＝离开画布）；阅读透镜用它把节点对应的段落也亮起来 */
  onHoverNode?: (id: string | null) => void;
  /** 阅读位置所在节点（阅读透镜）：整卡用主题色底 + 白字（与主节点同款），浏览别处时仍看得出读到哪 */
  readingId?: string | null;
  /** 短暂高亮的区域（阅读透镜「在完整图谱中打开」）：把这批节点整体框一个主题色高亮区，淡出（约 2.4s） */
  flashIds?: readonly string[] | null;
  /** 自动适配（默认 true＝完整图谱页签现状）；结构图纸片窗口传 false，由 setViewScale 决定比例。 */
  autoFit?: boolean;
  /** 每次布局内容边界变化（首次 / 尺寸变化）回调；结构图纸片窗口据此量 content。 */
  onLayout?: (bounds: { w: number; h: number }) => void;
  /** 每组最多显示的子节点数（D203 聚焦档）；超出由布局合成「另有 N 项」卡。 */
  maxChildren?: Readonly<Record<string, number>>;
  /** 显式全图：跳过 LOD 的 12 子项上限（结构图纸片窗口「展开全部」用）。 */
  noLod?: boolean;
  /** 点「另有 N 项」时接管（缺省＝LOD 展开）；结构图纸片窗口用它切到显式全图。 */
  onExpandAll?: () => void;
  /** D203 结构图纸片窗口的选中 / 悬停口径：选中＝整卡主题色（不是外圈），悬停描边 accent。完整图谱不传。 */
  lensStyle?: boolean;
  /** D204：false＝不做画布内视图锚点补偿（锚点由结构图窗口/宿主负责）。完整图谱默认 true。 */
  viewAnchor?: boolean;
  /** 顶卡类型行（透镜的截断点类型）；不传＝顶卡只显示标题（完整图谱现状）。 */
  rootType?: string;
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

function sameGeometry(a: Display, b: Display): boolean {
  if (a.items.length !== b.items.length || a.edges.length !== b.edges.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i], y = b.items[i];
    if (x.id !== y.id || x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.state !== y.state || x.count !== y.count || x.text !== y.text) return false;
  }
  return true;
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
  const trRef = useRef<{ tr: Transition; t0: number; epoch: number } | null>(null);
  /** C-32 A1：过渡上一帧的时刻（perfFrame 记相邻过渡帧间隔；无过渡/终帧时置空） */
  const transPrevRef = useRef<number | null>(null);
  /** 用户每次主动改视图（拖动 / 滚轮 / 适配 / 居中）+1；过渡动画只在规划后用户没动过视图时才接管视图（否则与拖动打架） */
  const viewEpochRef = useRef(0);
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
      collapse: (n: number) => T("收起 {n} 个子节点", { n }),
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
  // 性能（2026-10-18 实测：数万字材料的整图拖动卡顿）：内容层只在「内容相关输入」变化时重建
  // （帧几何 / 选中 / 悬停 / 开关 / LOD 档 / 关系标签缩放档 / 刚到达描边）；平移与同档缩放只改外层 <g> 的 transform，
  // 不再每个指针事件重做 路由 + SVG 串 + innerHTML。
  const contentKeyRef = useRef<unknown[] | null>(null);
  const paint = useCallback(() => {
    const svg = svgRef.current;
    const d = shownRef.current;
    if (!svg) return;
    if (!d) {
      svg.innerHTML = "";
      contentKeyRef.current = null;
      return;
    }
    const p = live.current;
    const view = viewRef.current;
    const hovered = hoverRef.current;
    const lod = lodFrames(d, view.k);
    const fr = freshRef.current;
    const freshOn = performance.now() < fr.until;
    const labelZoom = view.k >= 0.8 ? 1 : 0.5; // route 只用 zoom 判「≥0.8 常显关系名」
    const key = [d, p.graph, p.selectedId, hovered, p.relAll, p.focus, lod.join("|"), labelZoom, freshOn ? fr.ids : null, frameOpRef.current, p.rootTitle, p.readingId, p.flashIds, p.lensStyle, p.rootType];
    const prev = contentKeyRef.current;
    const same = !!prev && prev.length === key.length && prev.every((v, i) => v === key[i]);
    const vp = svg.firstElementChild as SVGGElement | null;
    const transform = `translate(${view.tx},${view.ty}) scale(${view.k})`;
    if (same && vp) {
      vp.setAttribute("transform", transform);
      return;
    }
    contentKeyRef.current = key;
    const routed = routeRelations(p.graph, d, {
      relAll: p.relAll,
      hovered,
      selected: p.selectedId,
      focus: p.focus && !!p.selectedId,
      zoom: labelZoom,
      lodCollapsed: lod,
      relName: relNameRef.current,
    });
    const inner = buildCanvasSvg(
      d,
      routed,
      { view: { tx: 0, ty: 0, k: 1 }, selected: p.selectedId, hovered, opacity: frameOpRef.current.opacity, leaving: frameOpRef.current.leaving, fresh: freshOn ? fr.ids : undefined, lodCollapsed: lod },
      { fragment: true, graph: p.graph, rootTitle: p.rootTitle, labels: labelsRef.current, idPrefix: "mm2c-", reading: p.readingId, flash: p.flashIds, lensStyle: p.lensStyle, rootType: p.rootType },
    );
    svg.innerHTML = `<g class="mm2-viewport" transform="${transform}">${inner}</g>`;
  }, []);

  const tick = useCallback(
    () => {
      rafRef.current = null;
      // 用 performance.now() 而非 rAF 回调时间戳：两者时基不保证一致（jsdom 下 rAF 时间戳恒小于 t0，过渡永不结束）
      const now = performance.now();
      const cur = trRef.current;
      if (cur) {
        const f = transitionFrame(cur.tr, now - cur.t0);
        shownRef.current = f.display;
        if (cur.epoch === viewEpochRef.current) viewRef.current = f.view;
        frameOpRef.current = { opacity: f.opacity, leaving: f.leaving };
        if (f.done) {
          trRef.current = null;
          transPrevRef.current = null;
          perfEnd(); // C-32 A1：过渡结束＝测量窗终点（perf 未开启时无操作）
        } else {
          const prev = transPrevRef.current;
          if (prev != null) perfFrame(now - prev); // C-32 A1：相邻过渡帧间隔
          transPrevRef.current = now;
        }
      } else {
        transPrevRef.current = null;
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
    let d = layoutGraph(p.graph, { cache: cacheRef.current, locks: locksRef.current, lodExpanded: lodRef.current, frameLabel, rootTitle: p.rootTitle, maxChildren: p.maxChildren, noLod: p.noLod });
    if (d.locks) locksRef.current = d.locks;
    const scope = growthScope(p.graph);
    const mono = monotoneFrames(d, sizesRef.current, scope);
    d = mono.display;
    sizesRef.current = mono.sizes;
    const prev = shownRef.current;
    const prevTarget = targetRef.current;
    targetRef.current = d;
    if (!prev && !userMovedRef.current) {
      // 结构图纸片窗口由宿主决定比例（setViewScale），画布不得用 48px 内边距抢先 fit；
      // 以 k=1、内容原点贴容器左上起步，宿主随后按窗口尺寸设比例。
      if (live.current.autoFit === false) viewRef.current = { k: 1, tx: 0, ty: 0 };
      else fitTo(d);
    }
    if (!prevTarget || prevTarget.bounds.w !== d.bounds.w || prevTarget.bounds.h !== d.bounds.h) {
      live.current.onLayout?.({ w: d.bounds.w, h: d.bounds.h });
    }
    // 几何未变（只是讲解 / 状态以外的字段 / 指标变了）：不起过渡动画，直接换帧
    if (prev && !trRef.current && sameGeometry(prev, d)) {
      shownRef.current = d;
      requestPaint();
      return;
    }
    const tr = planTransition(prev, d, { view: viewRef.current, anchorId: p.viewAnchor === false ? null : p.anchorId, reducedMotion: prefersReducedMotion() });
    if (prev) {
      const enteredCards = tr.enter.filter((id) => d.byId[id] && d.byId[id].kind === "card");
      if (enteredCards.length) {
        freshRef.current = { ids: new Set(enteredCards), until: performance.now() + FRESH_MS };
        window.setTimeout(requestPaint, FRESH_MS + 20); // 到期后去掉「刚到达」描边
      }
    }
    trRef.current = { tr, t0: performance.now(), epoch: viewEpochRef.current };
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
    if (trRef.current) perfEnd(); // C-32 A1：进行中的过渡被丢弃也视为测量窗结束
    trRef.current = null;
    userMovedRef.current = false;
    setLodExpanded(new Set());
  }, [mapKey]);

  const layoutOptsKey = JSON.stringify({ m: props.maxChildren ?? null, n: props.noLod === true });
  useEffect(() => {
    requestLayout();
  }, [graph, rootTitle, lodExpanded, layoutOptsKey, requestLayout]);

  useEffect(() => {
    requestPaint();
    // flashIds 也要进依赖：连着两次「在完整图谱中打开」可能选中同一个节点（selectedId 不变），
    // 只靠 selectedId 的重绘会漏掉第二次的高亮区。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, relAll, focus, props.flashIds, requestPaint]);

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
      if (!userMovedRef.current && targetRef.current && live.current.autoFit !== false) {
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
        viewEpochRef.current++;
        if (trRef.current) perfEnd(); // C-32 A1：进行中的过渡被丢弃也视为测量窗结束
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
        viewEpochRef.current++;
        requestPaint();
      },
      reveal(id: string) {
        const d = targetRef.current;
        const box = boxRef.current;
        const it = d?.byId[id];
        if (!d || !box || !it) return false; // 布局/画布未就位：调用方重试
        const r = box.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false; // 宿主还没有尺寸（浮窗/portal 未就位）
        // 低于 LOD.zoom 时「深层节点」被摘要卡吞掉、不绘制 → 先抬到阈值，否则居中到空处（用户实测：跳过来却看不到那个点）
        const k = Math.max(viewRef.current.k, LOD.zoom);
        viewRef.current = { k, tx: Math.round(r.width / 2 - (it.x + it.w / 2) * k), ty: Math.round(r.height / 2 - (it.y + it.h / 2) * k) };
        userMovedRef.current = true;
        viewEpochRef.current++;
        requestPaint();
        return true;
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
        const raw = buildCanvasSvg(d, routed, {}, { static: true, graph: p.graph, rootTitle: p.rootTitle, labels: labelsRef.current, idPrefix: "mm2x-", lensStyle: p.lensStyle, rootType: p.rootType });
        return DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
      },
      getBounds() {
        const d = targetRef.current;
        return d ? { w: d.bounds.w, h: d.bounds.h } : null;
      },
      getNodeRect(id: string) {
        const it = targetRef.current?.byId[id];
        return it ? { x: it.x, y: it.y, w: it.w, h: it.h } : null;
      },
      getView() {
        const v = viewRef.current;
        return { scale: v.k, tx: v.tx, ty: v.ty };
      },
      setViewScale(scale: number) {
        const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
        userMovedRef.current = true;
        viewEpochRef.current++;
        if (trRef.current) perfEnd(); // C-32 A1：进行中的过渡被丢弃也视为测量窗结束
        trRef.current = null;
        frameOpRef.current = { opacity: {}, leaving: [] };
        if (targetRef.current) shownRef.current = targetRef.current;
        viewRef.current = { k, tx: 0, ty: 0 };
        requestPaint();
      },
      autoFit() {
        userMovedRef.current = false;
        viewEpochRef.current++;
        if (trRef.current) perfEnd(); // C-32 A1：进行中的过渡被丢弃也视为测量窗结束
        trRef.current = null;
        frameOpRef.current = { opacity: {}, leaving: [] };
        if (targetRef.current) shownRef.current = targetRef.current;
        fitTo(targetRef.current);
        requestPaint();
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
        viewEpochRef.current++;
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
      if (kind === "collapse" && nid) {
        onToggleCollapse(nid);
        return;
      }
      if (kind === "lod-expand") {
        // 结构图纸片窗口：「另有 N 项」＝显式展开全部；完整图谱仍走 LOD 展开
        if (live.current.onExpandAll) {
          live.current.onExpandAll();
          return;
        }
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
    if (!id || id === ROOT_ID) return;
    const custom = live.current.onNodeDoubleClick;
    if (custom) {
      custom(id);
      return;
    }
    if ((live.current.graph.children[id]?.length ?? 0) > 0) onToggleCollapse(id);
  };

  const setHover = (id: string | null) => {
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    live.current.onHoverNode?.(id);
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
        viewEpochRef.current++;
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
