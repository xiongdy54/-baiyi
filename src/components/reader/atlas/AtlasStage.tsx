// 结构全景画布（D254 v2；docs/design/STRUCTURE-ATLAS-D254.md §5）。
// 相机 / 渲染 / 进出场 / 裁剪 / 悬停透视 / 键盘；所有几何来自 atlasLayout 的纯场景。
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { isImeComposing } from "../../../lib/ime";
import { useT } from "../../../lib/i18n";
import { motionPreference } from "../../../lib/mindmap/v2/animate";
import { ancestors } from "../../../lib/mindmap/v2/graph";
import type { GraphState } from "../../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../../lib/mindmap/v2/types";
import type { FlowColors } from "../../../lib/flow/types";
import { PATTERN_LABEL, shapePath } from "../../../lib/flow/layout";
import { usePresence, type Phase } from "../../../lib/flow/presence";
import {
  AL, ATLAS_T, CAM, atlasChain, buildAtlas, crossStrands, hopFrom, snapGlyphId, spatialNext, usableGradient,
  type AEdge, type AGlyph, type AtlasOpts, type AtlasScene, type FlowSnapshot,
} from "../../../lib/flow/atlasLayout";
import { eventBus } from "../../../lib/eventbus";
import { SvgRoot } from "../flow/FlowLayer";
import { resolveColors } from "../flow/StructureFlowHost";

export interface AtlasEntry { seq: number; origin: "button" | "flow" | "indicator"; nodeId: string | null; snapshot: FlowSnapshot | null }
export interface AtlasStageProps {
  graph: GraphState;                 // 已节流（§5.3）
  rootTitle: string;
  preview: boolean; loading: boolean; unsupported: boolean;
  focus: string;                     // 画布 id（材料根为 ROOT_ID）
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  onFocus: (id: string) => void;     // 聚焦（宿主负责 expandFor）
  onToggle: (id: string) => void;    // 折叠钮
  onShowAll: (parentId: string) => void;
  readingId: string | null;
  phase: "entering" | "open" | "exiting";
  entry: AtlasEntry | null;
  snapshot: FlowSnapshot | null;     // 已 normalize
  relAll: boolean;
  zoom: number; onZoom: (k: number) => void;
  centerSeq: number;
  card: ReactNode;                   // <AtlasCard/>；焦点为 ROOT 时 null
  onJump: (id: string) => void;      // 双击
  onExit: () => void;
  onExited: () => void;
  onGenerate?: () => void;
  onDeepen?: (id: string) => void;
  /** 点击已聚焦节点：重新打开节点卡（失焦关闭后） */
  onCardOpen?: () => void;
}

// ---------------------------------------------------------------- 几何格式化 / SVG 路径

const f1 = (v: number) => Math.round(v * 10) / 10;
function pathOf(p: number[]): string {
  let d = `M${f1(p[0] ?? 0)},${f1(p[1] ?? 0)}`;
  for (let i = 2; i + 5 < p.length; i += 6) d += `C${f1(p[i])},${f1(p[i + 1])} ${f1(p[i + 2])},${f1(p[i + 3])} ${f1(p[i + 4])},${f1(p[i + 5])}`;
  return d;
}
function geomBox(g: AEdge["geom"]): { x: number; y: number; w: number; h: number } {
  if (g.t === "path") {
    const xs = g.p.filter((_, i) => i % 2 === 0), ys = g.p.filter((_, i) => i % 2 === 1);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const y0 = Math.min(g.s0, g.s1, g.t0, g.t1), y1 = Math.max(g.s0, g.s1, g.t0, g.t1);
  return { x: g.L, y: y0, w: g.x1 - g.L, h: y1 - y0 };
}
function decoBox(d: AtlasScene["decos"][number]): { x: number; y: number; w: number; h: number } {
  if (d.k === "circle") return { x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 };
  if (d.k === "rect") return { x: d.x, y: d.y, w: d.w, h: d.h };
  return { x: d.x - 24, y: d.y - d.fs, w: 48, h: d.fs + 4 };
}

// ---------------------------------------------------------------- 字形（HTML）

interface GlyphDraw { gl: AGlyph; phase: Phase; x: number; y: number; w: number; opacity: number; delay: number; dim: boolean }

const GlyphRow = memo(
  function GlyphRow({ d, focus, readingId, T }: { d: GlyphDraw; focus: string; readingId: string | null; T: (k: string, p?: Record<string, string | number>) => string }) {
    const gl = d.gl;
    const reading = !!gl.nodeId && gl.nodeId === readingId;
    const style: CSSProperties = {
      transform: `translate(${d.x}px, ${d.y}px)`,
      width: d.w,
      height: gl.h,
      opacity: d.opacity,
      transitionDelay: `${d.delay}ms`,
      "--c": gl.color,
    } as unknown as CSSProperties;
    return (
      <div
        className="ag"
        data-ag={gl.id}
        data-node={gl.nodeId ?? undefined}
        data-kind={gl.kind}
        data-head={gl.head ? "1" : undefined}
        data-focus={gl.nodeId === focus ? "1" : undefined}
        data-reading={reading ? "1" : undefined}
        data-dim={d.dim ? "1" : undefined}
        data-counter={gl.counter ? "1" : undefined}
        data-example={gl.example ? "1" : undefined}
        data-align={gl.align}
        style={style}
        title={gl.lines.join("")}
      >
        {gl.time ? <span className="ag-time">{gl.time}</span> : null}
        <span className="ag-text" style={{ fontSize: gl.fs, lineHeight: `${gl.lh}px`, fontWeight: gl.weight }}>
          {gl.lines.map((l, i) => (
            <span key={i} className="ag-line">{reading ? <mark className="flow-pill">{l}</mark> : l}</span>
          ))}
        </span>
        {gl.meta || gl.kids > 0 ? (
          gl.kind !== "cell" && gl.kind !== "more" ? (
            <span className="ag-meta">
              <span className="ag-type">{gl.meta}</span>
              {gl.kids > 0 && gl.kind !== "colhead" ? (
                <button
                  type="button"
                  className="ag-fold"
                  data-atlas-act="fold"
                  aria-label={gl.expanded ? T("收起 {n} 个子节点", { n: gl.kids }) : T("展开 {n} 个子节点", { n: gl.kids })}
                >
                  {gl.expanded ? "−" : `+${gl.kids}`}
                </button>
              ) : null}
            </span>
          ) : null
        ) : null}
        {gl.kind === "cell" && gl.kids > 0 ? (
          <button type="button" className="ag-fold ag-fold-cell" data-atlas-act="fold" aria-label={gl.expanded ? T("收起 {n} 个子节点", { n: gl.kids }) : T("展开 {n} 个子节点", { n: gl.kids })}>
            {gl.expanded ? "−" : `+${gl.kids}`}
          </button>
        ) : null}
      </div>
    );
  },
  (a, b) => a.d.gl === b.d.gl && a.d.phase === b.d.phase && a.d.x === b.d.x && a.d.y === b.d.y && a.d.w === b.d.w && a.d.opacity === b.d.opacity && a.d.delay === b.d.delay && a.d.dim === b.d.dim && a.focus === b.focus && a.readingId === b.readingId && a.T === b.T,
);

// ---------------------------------------------------------------- 画布

const glyphKey = (g: AGlyph) =>
  `${g.kind}|${g.x}|${g.y}|${g.w}|${g.h}|${g.fs}|${g.lh}|${g.weight}|${g.tone}|${g.align}|${g.color}|${g.meta}|${g.time}|${g.num}|${g.kids}|${g.expanded ? 1 : 0}|${g.head ? 1 : 0}|${g.counter ? 1 : 0}|${g.example ? 1 : 0}|${g.moreCount ?? ""}|${g.parentId ?? ""}|${g.nodeId ?? ""}|${g.lines.join("\u0001")}`;

/** §15：未变字形沿用旧对象（几何 / 文字 / 状态全等才复用），memo 行才能整批跳过重渲染。 */
function useStableScene(scene: AtlasScene): AtlasScene {
  const cache = useRef(new Map<string, { key: string; gl: AGlyph }>());
  return useMemo(() => {
    const prev = cache.current;
    const next = new Map<string, { key: string; gl: AGlyph }>();
    let changed = false;
    const glyphs = scene.glyphs.map((g, i) => {
      const key = glyphKey(g);
      const old = prev.get(g.id);
      const gl = old && old.key === key ? old.gl : g;
      next.set(g.id, { key, gl });
      if (gl !== scene.glyphs[i]) changed = true;
      return gl;
    });
    cache.current = next;
    if (!changed) return scene;
    const byId = new Map<string, AGlyph>(), byNode = new Map<string, AGlyph>();
    for (const gl of glyphs) { byId.set(gl.id, gl); if (gl.nodeId) byNode.set(gl.nodeId, gl); }
    return { ...scene, glyphs, byId, byNode };
  }, [scene]);
}

type AnimMode = "handoff" | "button";
interface AnimState { key: string; mode: AnimMode; started: boolean; frame0: boolean; keep: ReadonlySet<string>; rect0: ReadonlyMap<string, { x: number; y: number; w: number }> }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function AtlasStage(props: AtlasStageProps) {
  const T = useT();
  const motionOff = useMemo(() => motionPreference() === "off", []);

  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const setStageNode = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  }, []);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const cardSlotRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan); // 只在镜头命令 / 落定同步时更新；拖动期间直接写 ref + transform
  const [panning, setPanning] = useState(false);
  const [camSnap, setCamSnap] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [colorTick, setColorTick] = useState(0);
  const [localCenter, setLocalCenter] = useState(0);
  const [anim, setAnim] = useState<AnimState | null>(null);
  const [ranks, setRanks] = useState<ReadonlyMap<string, { v: number; at: number }>>(() => new Map());
  const [edgeDelays, setEdgeDelays] = useState<ReadonlyMap<string, { v: number; at: number }>>(() => new Map());
  const [decoDelays, setDecoDelays] = useState<ReadonlyMap<string, { v: number; at: number }>>(() => new Map());

  const userMovedRef = useRef(false);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const skipZoomRef = useRef(false);
  const wheelTimer = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const hoverTimer = useRef<number | null>(null);
  const hoverClear = useRef<number | null>(null);
  const hoverTargetRef = useRef<string | null>(null);
  const animTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);
  const startedRef = useRef<string | null>(null);
  const raf1Ref = useRef(0);
  const raf2Ref = useRef(0);
  const mapIdRef = useRef<string | null | undefined>(undefined);
  const lastFocusRef = useRef<string | null>(null);
  const lastCenterRef = useRef(props.centerSeq);
  const lastPosRef = useRef("");
  const lastSizeRef = useRef("");
  const prevZoomRef = useRef(props.zoom);

  const g = props.graph;
  const colors = useMemo(() => resolveColors(stageEl), [stageEl, colorTick]);
  const rawScene = useMemo(
    () =>
      buildAtlas(g, {
        colors,
        rootTitle: props.rootTitle,
        expanded: props.expanded,
        showAll: props.showAll,
        readingId: props.readingId,
        patternLabel: (p) => T(PATTERN_LABEL[p]),
        rootMeta: (n) => T("全文 · {n} 节", { n }),
        moreLabel: (n) => T("另 {n} 项", { n }),
        counterLabel: T("反方一侧"),
        otherLabel: T("其他"),
        focusId: props.focus,
      } satisfies AtlasOpts),
    [g, colors, props.rootTitle, props.expanded, props.showAll, props.readingId, props.focus, T],
  );
  const scene = useStableScene(rawScene);
  const focusIn = scene.byNode.has(props.focus) ? props.focus : ROOT_ID;
  const hop = useMemo(() => hopFrom(g, focusIn), [g, focusIn]);
  const focusPath = useMemo(() => new Set(atlasChain(g, focusIn)), [g, focusIn]);

  // 主题 / 皮肤变化 → 重算颜色
  useEffect(() => {
    const doc = stageEl?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    const ob = new MutationObserver(() => setColorTick((n) => n + 1));
    ob.observe(doc.body, { attributes: true, attributeFilter: ["style", "class"] });
    const off = eventBus.on("settings/changed", () => setColorTick((n) => n + 1));
    return () => {
      ob.disconnect();
      off();
    };
  }, [stageEl]);

  // 舞台尺寸
  useLayoutEffect(() => {
    const el = stageEl;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === Math.max(1, r.width) && s.h === Math.max(1, r.height) ? s : { w: Math.max(1, r.width), h: Math.max(1, r.height) }));
    };
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    window.addEventListener("resize", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [stageEl]);

  const moveCamera = useCallback((p: { x: number; y: number }) => {
    panRef.current = p;
    setPan(p);
  }, []);

  const clampPan = useCallback(
    (p: { x: number; y: number }, k: number) => {
      if (!size.w) return p;
      const m = CAM.PAN_MARGIN, sw = scene.w * k, sh = scene.h * k;
      return { x: clamp(p.x, m - sw, size.w - m), y: clamp(p.y, m - sh, size.h - m) };
    },
    [scene.w, scene.h, size.w, size.h],
  );
  const centerPan = useCallback(
    (gl: AGlyph | undefined, k: number) => {
      if (!gl || !size.w) return { x: pan.x, y: pan.y };
      return { x: Math.round(size.w / 2 - k * (gl.x + gl.w / 2)), y: Math.round(size.h * CAM.CENTER_Y - k * (gl.y + gl.h / 2)) };
    },
    [size.w, size.h], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // §15：平移只改 .atlas-world 的 transform（不重渲 React 子树）——每次提交后用 ref 值兜底覆盖，
  // 让拖动 / 滚轮期间的直接写入不会被无关 state 更新冲掉。
  useLayoutEffect(() => {
    if (worldRef.current) worldRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${props.zoom})`;
  });

  // 颜色主题 / 舞台挂载后自动聚焦（键盘）
  useLayoutEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, [stageEl]);

  // ---------------------------------------------------------------- 进入动画（§5.6 b/c/f）
  const startAnim = useCallback(
    (key: string, mode: AnimMode) => {
      const gl = scene.byNode.get(focusIn) ?? scene.byNode.get(ROOT_ID);
      const k = mode === "handoff" ? 1 : props.zoom;
      if (mode === "handoff" && props.zoom !== 1) {
        skipZoomRef.current = true;
        props.onZoom(1);
      }
      if (gl && size.w) {
        moveCamera(clampPan(centerPan(gl, k), k));
      }
      userMovedRef.current = false;
      const keep = new Set<string>();
      const rect0 = new Map<string, { x: number; y: number; w: number }>();
      const stage = stageRef.current;
      if (mode === "handoff" && stage && props.snapshot) {
        const sr = stage.getBoundingClientRect();
        const target = gl ? clampPan(centerPan(gl, 1), 1) : { x: pan.x, y: pan.y };
        for (const [itemId, r] of props.snapshot.items) {
          const gid = snapGlyphId(itemId);
          if (!gid || !scene.byId.has(gid)) continue;
          rect0.set(gid, { x: r.left - sr.left - target.x, y: r.top - sr.top - target.y, w: r.width });
          keep.add(gid);
        }
      }
      setCamSnap(true);
      setAnim({ key, mode, started: false, frame0: mode === "handoff", keep, rect0 });
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => {
          setCamSnap(false);
          setAnim((a) => (a && a.key === key ? { ...a, frame0: false, started: true } : a));
        });
        raf2Ref.current = r2;
      });
      raf1Ref.current = r1;
      if (animTimer.current) window.clearTimeout(animTimer.current);
      const hold = mode === "handoff" ? ATLAS_T.HOP_HANDOFF0 + AL.HOP_CAP * ATLAS_T.HOP_HANDOFF + ATLAS_T.FADE_IN + 120 : ATLAS_T.HOP_BUTTON0 + AL.HOP_CAP * ATLAS_T.HOP_BUTTON + ATLAS_T.FADE_IN + 120;
      animTimer.current = window.setTimeout(() => {
        animTimer.current = null;
        setAnim((a) => (a && a.key === key ? null : a));
      }, hold);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, focusIn, props.zoom, props.snapshot, props.onZoom, size.w, size.h, clampPan, centerPan, moveCamera],
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(raf1Ref.current);
      cancelAnimationFrame(raf2Ref.current);
      if (animTimer.current) window.clearTimeout(animTimer.current);
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (hoverClear.current) window.clearTimeout(hoverClear.current);
      // StrictMode 会「挂载→清理→再挂载」：清掉入场守卫，重挂载时重播进场（否则动画停在首帧 opacity 0）
      startedRef.current = null;
    },
    [],
  );

  // 自动居中（§5.4）：焦点 / 居中序号 / 场景位置 / 舞台尺寸变化
  useLayoutEffect(() => {
    const gl = scene.byNode.get(focusIn);
    if (!gl || !size.w) return;
    const pos = `${gl.x},${gl.y},${gl.w},${gl.h}`;
    const centerNum = props.centerSeq + localCenter;
    const focusChanged = lastFocusRef.current !== focusIn;
    const centerChanged = lastCenterRef.current !== centerNum;
    const sizeChanged = lastSizeRef.current !== `${size.w}x${size.h}`;
    const moved = lastPosRef.current !== pos;
    lastFocusRef.current = focusIn;
    lastCenterRef.current = centerNum;
    lastPosRef.current = pos;
    lastSizeRef.current = `${size.w}x${size.h}`;
    if (focusChanged || centerChanged) userMovedRef.current = false;
    if (userMovedRef.current) return;
    if (!(focusChanged || centerChanged || sizeChanged || moved)) return;
    moveCamera(clampPan(centerPan(gl, props.zoom), props.zoom));
  }, [scene, focusIn, props.centerSeq, localCenter, size.w, size.h, props.zoom, clampPan, centerPan, moveCamera]);

  // 入场（按钮 / 交接）与换版本重播
  useLayoutEffect(() => {
    const entry = props.entry;
    const nodeCount = Object.keys(g.nodes).length;
    if (!entry || !size.w || (props.loading && nodeCount === 0)) return;
    if (entry.snapshot && !props.snapshot) return; // 等宿主把快照归一化后再播交接（子 layout effect 先于父 passive effect）
    const key = `e:${entry.seq}`;
    if (startedRef.current === key) return;
    startedRef.current = key;
    startAnim(key, entry.snapshot && props.snapshot && !motionOff ? "handoff" : "button");
  }, [props.entry, props.snapshot, props.loading, g.nodes, scene, size.w, motionOff, startAnim]);

  useLayoutEffect(() => {
    const id = g.mapId;
    if (mapIdRef.current === undefined) {
      mapIdRef.current = id;
      return;
    }
    if (mapIdRef.current === id) return;
    mapIdRef.current = id;
    if (!startedRef.current) return;
    if (!size.w) return;
    const key = `m:${id}:${Date.now()}`;
    startedRef.current = key;
    startAnim(key, "button");
  }, [g.mapId, size.w, startAnim]);

  // 缩放：绕锚点（滚轮＝指针 / 按钮＝舞台中心）保持视觉位置
  useLayoutEffect(() => {
    const prev = prevZoomRef.current;
    prevZoomRef.current = props.zoom;
    if (prev === props.zoom) return;
    if (skipZoomRef.current) {
      skipZoomRef.current = false;
      userMovedRef.current = false;
      return;
    }
    const a = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const ax = a?.x ?? size.w / 2, ay = a?.y ?? size.h / 2;
    const p0 = panRef.current;
    moveCamera(clampPan({ x: Math.round(ax - ((ax - p0.x) * props.zoom) / prev), y: Math.round(ay - ((ay - p0.y) * props.zoom) / prev) }, props.zoom));
    userMovedRef.current = true;
  }, [props.zoom, size.w, size.h, clampPan, moveCamera]);

  // 背景进场
  useEffect(() => {
    const bg = bgRef.current as (HTMLDivElement & { animate?: Element["animate"] }) | null;
    if (!bg || motionOff || typeof bg.animate !== "function") return;
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ATLAS_T.BG_IN, easing: "cubic-bezier(0,0,0.2,1)", fill: "backwards" });
  }, [motionOff]);

  // 退场（§5.6 e）
  useEffect(() => {
    if (props.phase !== "exiting") return;
    const bg = bgRef.current as (HTMLDivElement & { animate?: Element["animate"] }) | null;
    if (bg && !motionOff && typeof bg.animate === "function") {
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ATLAS_T.BG_OUT, delay: ATLAS_T.BG_OUT_DELAY, easing: "cubic-bezier(0.4,0,1,1)", fill: "forwards" });
    }
    const ms = motionOff ? 140 : ATLAS_T.EXIT_DONE;
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      props.onExited();
    }, ms);
    return () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    };
  }, [props.phase, motionOff, props.onExited]);

  // ---------------------------------------------------------------- 悬停透视（§5.7）
  const scheduleHover = useCallback(
    (id: string | null) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (hoverClear.current) window.clearTimeout(hoverClear.current);
      hoverTimer.current = null;
      hoverClear.current = null;
      if (id) {
        hoverTimer.current = window.setTimeout(() => {
          hoverTimer.current = null;
          setHoverId(id);
        }, ATLAS_T.HOVER_DWELL);
      } else {
        hoverClear.current = window.setTimeout(() => {
          hoverClear.current = null;
          setHoverId(null);
        }, ATLAS_T.HOVER_CLEAR);
      }
    },
    [],
  );

  const hoverKeep = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    const hg = scene.byNode.get(hoverId);
    if (hg?.parentId) set.add(hg.parentId);
    for (const c of g.children[hoverId] ?? []) if (scene.byNode.has(c)) set.add(c);
    const rep = (id: string): string => {
      if (scene.byNode.has(id)) return id;
      const an = ancestors(g, id);
      for (let i = an.length - 1; i >= 0; i--) if (scene.byNode.has(an[i])) return an[i];
      return ROOT_ID;
    };
    for (const e of g.outEdges[hoverId] ?? []) set.add(rep(e.to));
    for (const e of g.inEdges[hoverId] ?? []) set.add(rep(e.from));
    return set;
  }, [hoverId, g, scene]);

  useEffect(() => {
    if (hoverId && !scene.byNode.has(hoverId)) setHoverId(null);
  }, [hoverId, scene]);

  const touchesHover = useCallback(    (from: string | null, to: string | null) => {
      if (!hoverKeep) return true;
      const rep = (id: string): string => {
        if (scene.byNode.has(id)) return id;
        const an = ancestors(g, id);
        for (let i = an.length - 1; i >= 0; i--) if (scene.byNode.has(an[i])) return an[i];
        return ROOT_ID;
      };
      return (!!from && hoverKeep.has(rep(from))) || (!!to && hoverKeep.has(rep(to)));
    },
    [hoverKeep, g, scene],
  );
  const toneOf = useCallback(
    (from: string | null, to: string | null): 0 | 1 | 2 => {
      if (hoverKeep && touchesHover(from, to)) return 2;
      const onPath = (id: string | null) => !!id && (id === focusIn || focusPath.has(id));
      return onPath(from) || onPath(to) ? 1 : 0;
    },
    [hoverKeep, touchesHover, focusIn, focusPath],
  );

  // ---------------------------------------------------------------- presence / 延迟
  const glyphPresence = usePresence(scene.glyphs, ATLAS_T.REMOVE);
  const strands = useMemo(() => crossStrands(g, scene, { hot: new Set([focusIn, ...(hoverId ? [hoverId] : [])]), all: props.relAll, colors }), [g, scene, focusIn, hoverId, props.relAll, colors]);
  const strandEdges = useMemo<AEdge[]>(
    () => strands.map((s) => ({ id: s.id, kind: "rel", from: s.from, to: s.to, code: s.code, geom: { t: "path", p: s.p }, color: s.color, colorB: s.colorB, w: s.w, dash: s.dash, end: s.end, start: s.start, opacity: s.strong ? 1 : 0.75 })),
    [strands],
  );
  const edgesAll = useMemo(() => [...scene.edges, ...strandEdges], [scene, strandEdges]);
  const edgePresence = usePresence(edgesAll, ATLAS_T.REMOVE);
  const decoPresence = usePresence(scene.decos, ATLAS_T.REMOVE);

  // 进场批次签名（字符串按值比较）：effect 只在批次真正变化时跑一次，避免 usePresence 每帧新数组造成死循环
  const enterSigG = glyphPresence.filter((p) => p.phase === "enter").map((p) => `${p.item.id}@${p.item.x},${p.item.y}`).join("|");
  const enterSigE = edgePresence.filter((p) => p.phase === "enter").map((p) => p.item.id).join("|");
  const enterSigD = decoPresence.filter((p) => p.phase === "enter").map((p) => p.item.id).join("|");
  const glyphPresenceRef = useRef(glyphPresence);
  glyphPresenceRef.current = glyphPresence;
  const edgePresenceRef = useRef(edgePresence);
  edgePresenceRef.current = edgePresence;
  const decoPresenceRef = useRef(decoPresence);
  decoPresenceRef.current = decoPresence;

  useLayoutEffect(() => {
    if (!enterSigG) return;
    const now = performance.now();
    const ent = glyphPresenceRef.current.filter((p) => p.phase === "enter").map((p) => p.item).sort((a, b) => a.x + a.y - (b.x + b.y));
    setRanks((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const [k, v] of m) if (now - v.at > 2000) { m.delete(k); changed = true; }
      ent.forEach((gl, i) => {
        const v = Math.min(i * ATLAS_T.ENTER_STEP, ATLAS_T.ENTER_CAP);
        if (m.get(gl.id)?.v !== v) { m.set(gl.id, { v, at: now }); changed = true; }
      });
      return changed ? m : prev;
    });
  }, [enterSigG]);

  useLayoutEffect(() => {
    if (!enterSigE) return;
    const now = performance.now();
    const list = edgePresenceRef.current.filter((p) => p.phase === "enter").map((p) => p.item);
    setEdgeDelays((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const [k, v] of m) if (now - v.at > 2000) { m.delete(k); changed = true; }
      for (const e of list) {
        const g1 = e.from ? scene.byNode.get(e.from) : null, g2 = e.to ? scene.byNode.get(e.to) : null;
        const r = Math.max(g1 ? ranks.get(g1.id)?.v ?? 0 : 0, g2 ? ranks.get(g2.id)?.v ?? 0 : 0);
        const v = ATLAS_T.ENTER_DELAY + r + ATLAS_T.EDGE_DELAY;
        if (m.get(e.id)?.v !== v) { m.set(e.id, { v, at: now }); changed = true; }
      }
      return changed ? m : prev;
    });
  }, [enterSigE, ranks, scene]);

  useLayoutEffect(() => {
    if (!enterSigD) return;
    const now = performance.now();
    const list = decoPresenceRef.current.filter((p) => p.phase === "enter").map((p) => p.item);
    setDecoDelays((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const [k, v] of m) if (now - v.at > 2000) { m.delete(k); changed = true; }
      for (const d of list) {
        const parent = d.id.split(":")[1] ?? "";
        const pg = scene.byNode.get(parent);
        const v = ATLAS_T.ENTER_DELAY + (pg ? ranks.get(pg.id)?.v ?? 0 : 0);
        if (m.get(d.id)?.v !== v) { m.set(d.id, { v, at: now }); changed = true; }
      }
      return changed ? m : prev;
    });
  }, [enterSigD, ranks, scene]);

  const glyphDelay = useCallback(
    (gl: AGlyph) => {
      if (anim) {
        if (anim.mode === "handoff") return anim.keep.has(gl.id) ? 0 : ATLAS_T.HOP_HANDOFF0 + (hop(gl.nodeId) - 1) * ATLAS_T.HOP_HANDOFF;
        return ATLAS_T.HOP_BUTTON0 + hop(gl.nodeId) * ATLAS_T.HOP_BUTTON;
      }
      const r = ranks.get(gl.id);
      return r == null || performance.now() - r.at > 2000 ? 0 : ATLAS_T.ENTER_DELAY + r.v;
    },
    [anim, hop, ranks],
  );
  const exitDelayFor = useCallback((nodeId: string | null) => (AL.HOP_CAP - hop(nodeId)) * ATLAS_T.HOP_EXIT, [hop]);

  // ---------------------------------------------------------------- 裁剪窗口
  const win = useMemo(
    () =>
      size.w
        ? { x0: -pan.x / props.zoom - CAM.CULL_PAD, x1: (size.w - pan.x) / props.zoom + CAM.CULL_PAD, y0: -pan.y / props.zoom - CAM.CULL_PAD, y1: (size.h - pan.y) / props.zoom + CAM.CULL_PAD }
        : null,
    [pan, props.zoom, size.w, size.h],
  );
  const visible = useCallback(
    (b: { x: number; y: number; w: number; h: number }) => !win || (b.x < win.x1 && b.x + b.w > win.x0 && b.y < win.y1 && b.y + b.h > win.y0),
    [win],
  );

  // ---------------------------------------------------------------- 字形 draws
  const glyphDraws = useMemo<GlyphDraw[]>(() => {
    const out: GlyphDraw[] = [];
    for (const { item: gl, phase } of glyphPresence) {
      let x = gl.x, y = gl.y, w = gl.w, opacity = 1, delay = 0;
      const dim = !!hoverKeep && !!gl.nodeId && !hoverKeep.has(gl.nodeId);
      if (anim?.frame0 && anim.keep.has(gl.id)) {
        const r = anim.rect0.get(gl.id);
        if (r) { x = r.x; y = r.y; w = r.w; }
        opacity = 1;
        delay = 0;
      } else {
        if (anim) {
          opacity = anim.started ? 1 : 0;
          delay = glyphDelay(gl);
          if (anim.mode === "handoff" && anim.keep.has(gl.id) && anim.started) { opacity = 1; delay = 0; }
        } else if (phase === "enter") {
          opacity = 0;
          delay = 0;
          const p = gl.parentId ? scene.byNode.get(gl.parentId) : null;
          if (p) { x = p.x + (p.w - gl.w) / 2; y = p.y; }
        }
        if (phase === "exit") {
          opacity = 0;
          delay = 0;
          const p = gl.parentId ? scene.byNode.get(gl.parentId) : null;
          if (p) { x = p.x + (p.w - gl.w) / 2; y = p.y; }
        }
      }
      if (props.phase === "exiting") { opacity = 0; delay = exitDelayFor(gl.nodeId); }
      const d: GlyphDraw = { gl, phase, x, y, w, opacity: dim && opacity > 0.28 ? 0.28 : opacity, delay, dim };
      if (visible({ x: d.x, y: d.y, w: d.w, h: gl.h })) out.push(d);
    }
    return out;
  }, [glyphPresence, anim, scene, glyphDelay, exitDelayFor, hoverKeep, props.phase, visible]);

  // ---------------------------------------------------------------- 边 draws
  const edgeDraws = useMemo(() => {
    const out: { e: AEdge; phase: Phase; d: string; opacity: number; delay: number; dim: boolean; tone: 0 | 1 | 2; box: { x: number; y: number; w: number; h: number }; useGrad: boolean }[] = [];
    for (const { item: e, phase } of edgePresence) {
      const collapsed = phase === "enter" || phase === "exit" || (!!anim && !anim.started);
      const geom = e.geom;
      const d = geom.t === "ribbon" ? shapePath(collapsed ? { L: geom.L, xs: geom.xs, s0: geom.s0, s1: geom.s1, x1: geom.xs, t0: geom.s0, t1: geom.s1 } : geom) : pathOf(geom.p);
      // D254 修订：树枝只在「通向焦点路径」时加重（父在路径上不足以加重——否则路径节点的所有兄弟枝都会一起变粗）
      const onPath = (id: string | null) => !!id && (id === focusIn || focusPath.has(id));
      const tone: 0 | 1 | 2 = e.kind === "fan" ? (hoverKeep && touchesHover(e.from, e.to) && (e.from === hoverId || e.to === hoverId) ? 2 : onPath(e.to) || e.from === focusIn ? 1 : 0) : toneOf(e.from, e.to);
      let opacity = e.kind === "fan" && tone > 0 ? 0.95 : e.opacity;
      if (phase === "exit") opacity = 0;
      else if (anim) opacity = anim.started ? e.opacity : 0;
      else if (phase === "enter") opacity = 0;
      const dim = !!hoverKeep && !touchesHover(e.from, e.to);
      if (dim) opacity *= 0.28;
      let delay = 0;
      if (props.phase === "exiting") {
        opacity = 0;
        delay = exitDelayFor([e.from, e.to].filter(Boolean).sort((a, b) => hop(b) - hop(a))[0] ?? null);
      } else if (anim) {
        const g1 = e.from ? scene.byNode.get(e.from) : null, g2 = e.to ? scene.byNode.get(e.to) : null;
        delay = Math.max(g1 ? glyphDelay(g1) : 0, g2 ? glyphDelay(g2) : 0) + ATLAS_T.EDGE_DELAY;
      } else {
        const r = edgeDelays.get(e.id);
        delay = r == null || performance.now() - r.at > 2000 ? 0 : r.v;
      }
      const box = geomBox(geom);
      // 纯水平 / 纯垂直路径的 objectBoundingBox 渐变没有面积，浏览器会整条不画（链条 / 论证竖线 / 时间轴）
      const useGrad = usableGradient(e.color, e.colorB, box);
      if (visible(box)) out.push({ e, phase, d, opacity, delay, dim, tone, box, useGrad });
    }
    return out;
  }, [edgePresence, anim, props.phase, hoverKeep, hoverId, touchesHover, toneOf, focusIn, focusPath, exitDelayFor, hop, scene, glyphDelay, edgeDelays, visible]);

  // ---------------------------------------------------------------- deco draws
  const decoDraws = useMemo(() => {
    const out: { d: AtlasScene["decos"][number]; phase: Phase; ax: number; ay: number; opacity: number; delay: number; dim: boolean }[] = [];
    for (const { item: d, phase } of decoPresence) {
      const box = decoBox(d);
      let ax = d.k === "rect" ? d.x + d.w / 2 : d.k === "circle" ? d.cx : d.x;
      let ay = d.k === "rect" ? d.y + d.h / 2 : d.k === "circle" ? d.cy : d.y;
      const parent = d.id.split(":")[1] ?? "";
      const pg = scene.byNode.get(parent);
      let opacity = d.opacity, delay = 0;
      const dim = !!hoverKeep && !!parent && !hoverKeep.has(parent);
      if (anim) {
        opacity = anim.started ? d.opacity : 0;
        delay = pg ? glyphDelay(pg) : 0;
      } else if (phase === "enter") {
        opacity = 0;
        delay = 0;
        if (pg) { ax = pg.x + pg.w / 2; ay = pg.y + pg.h / 2; }
      }
      if (phase === "exit") {
        opacity = 0;
        delay = 0;
        if (pg) { ax = pg.x + pg.w / 2; ay = pg.y + pg.h / 2; }
      } else if (!anim) {
        const r = decoDelays.get(d.id);
        delay = r == null || performance.now() - r.at > 2000 ? 0 : r.v;
      }
      if (dim) opacity *= 0.28;
      if (props.phase === "exiting") { opacity = 0; delay = exitDelayFor(parent || null); }
      if (!visible({ x: ax - Math.max(box.w, 8) / 2, y: ay - Math.max(box.h, 8) / 2, w: Math.max(box.w, 8), h: Math.max(box.h, 8) })) continue;
      out.push({ d, phase, ax, ay, opacity, delay, dim });
    }
    return out;
  }, [decoPresence, anim, scene, hoverKeep, decoDelays, glyphDelay, exitDelayFor, props.phase, visible]);

  // 焦点组领地（§12）
  const zone = useMemo(() => {
    const zid = scene.patternOf.has(focusIn) ? focusIn : (focusIn === ROOT_ID ? ROOT_ID : scene.byNode.get(focusIn)?.parentId ?? ROOT_ID);
    return scene.zones.find((z) => z.id === zid) ?? null;
  }, [scene, focusIn]);

  // 节点卡定位（屏幕坐标，随相机 / 字形过渡逐帧重算）
  useLayoutEffect(() => {
    let alive = true;
    let raf = 0;
    let stable = 0;
    let last = "";
    const tick = () => {
      if (!alive) return;
      const stage = stageRef.current, slot = cardSlotRef.current;
      if (stage && slot) {
        const el = stage.querySelector<HTMLElement>('.ag[data-focus="1"]');
        if (el) {
          const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
          const gl = scene.byNode.get(focusIn);
          const w = Math.min(360, Math.max(280, r.width));
          let x = r.left - sr.left;
          if (gl?.align === "center") x = r.left - sr.left + r.width / 2 - w / 2;
          const first = slot.firstElementChild as HTMLElement | null;
          const ch = first ? first.offsetHeight : 0;
          let y = r.top - sr.top - ch - 8; // 默认在选中节点上方
          if (ch && y < 4) y = r.top - sr.top + r.height + 8; // 上方放不下才翻到下方
          const key = `${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${ch}`;
          slot.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          slot.style.width = `${Math.round(w)}px`;
          if (key === last) stable++;
          else { stable = 0; last = key; }
        }
      }
      if (stable < 10) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [props.card, scene, focusIn, pan, panning, props.zoom, anim, size.w, size.h]);

  // ---------------------------------------------------------------- 指针 / 滚轮 / 键盘
  const clampPanRef = useRef(clampPan);
  clampPanRef.current = clampPan;

  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const k = clamp(props.zoom * (e.deltaY > 0 ? 1 / CAM.ZOOM_STEP : CAM.ZOOM_STEP), CAM.ZOOM_MIN, CAM.ZOOM_MAX);
        if (k === props.zoom) return;
        const r = el.getBoundingClientRect();
        zoomAnchorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        userMovedRef.current = true;
        props.onZoom(k);
      } else {
        const p0 = panRef.current;
        const next = clampPanRef.current({ x: p0.x - (e.shiftKey ? e.deltaY : e.deltaX), y: p0.y - e.deltaY }, props.zoom);
        panRef.current = next;
        if (worldRef.current) worldRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${props.zoom})`;
        userMovedRef.current = true;
      }
      setPanning(true);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        wheelTimer.current = null;
        setPanning(false);
        setPan(panRef.current); // 滚轮停止后再同步裁剪窗口
      }, ATLAS_T.WHEEL_IDLE);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, [stageEl, props.zoom, props.onZoom]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest?.(".ag, .atlas-card, .atlas-card-slot, button, input, select, a")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, dragging: false };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && e.buttons) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.dragging && Math.hypot(dx, dy) > CAM.DRAG_SLOP) {
        d.dragging = true;
        setPanning(true);
        userMovedRef.current = true;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 已释放 */ }
      }
      if (d.dragging) {
        e.preventDefault();
        const next = clampPanRef.current({ x: d.px + dx, y: d.py + dy }, props.zoom);
        panRef.current = next;
        if (worldRef.current) worldRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${props.zoom})`;
      }
      return;
    }
    const el = (e.target as Element).closest?.(".ag") as Element | null;
    const id = el?.getAttribute("data-node") ?? null;
    if (id !== hoverTargetRef.current) {
      hoverTargetRef.current = id;
      scheduleHover(id);
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.dragging) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 120);
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setPan(panRef.current); // 拖动结束再同步裁剪窗口
    }
    setPanning(false);
  };
  const onPointerLeave = () => {
    hoverTargetRef.current = null;
    scheduleHover(null);
  };

  const onClick = (e: RMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const t = e.target as Element;
    const el = t.closest?.(".ag") as HTMLElement | null;
    if (!el) return;
    const gl = scene.byId.get(el.getAttribute("data-ag") || "");
    if (!gl) return;
    const act = t.closest?.('[data-atlas-act="fold"]');
    if (act) {
      if (gl.nodeId) props.onToggle(gl.nodeId);
      return;
    }
    if (gl.kind === "more" && gl.parentId) {
      props.onShowAll(gl.parentId);
      return;
    }
    if (!gl.nodeId) return;
    if (gl.nodeId === focusIn) {
      setLocalCenter((n) => n + 1);
      props.onCardOpen?.();
    } else props.onFocus(gl.nodeId);
  };
  const onDoubleClick = (e: RMouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest?.(".ag") as HTMLElement | null;
    if (!el) return;
    const gl = scene.byId.get(el.getAttribute("data-ag") || "");
    if (gl?.nodeId && gl.nodeId !== ROOT_ID) props.onJump(gl.nodeId);
  };

  const focusSearch = useCallback(() => {
    const doc = stageRef.current?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    doc?.querySelector<HTMLInputElement>(".atlas-toolbar [data-atlas-search]")?.focus();
  }, []);

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(e)) return;
    const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onExit();
      return;
    }
    if (e.key === "Enter") {
      const gl = scene.byNode.get(focusIn);
      if (!gl) return;
      if (gl.kids > 0) { e.preventDefault(); props.onToggle(focusIn); return; }
      const n = g.nodes[focusIn];
      if (n && (n.state === "more" || n.state === "stub")) { e.preventDefault(); props.onDeepen?.(focusIn); }
      return;
    }
    if (dir && e.altKey) {
      e.preventDefault();
      if (dir === "up") {
        const p = focusIn === ROOT_ID ? null : g.nodes[focusIn]?.parentId ?? ROOT_ID;
        if (p) props.onFocus(p);
      } else if (dir === "down") {
        const first = (g.children[focusIn] ?? []).find((c) => scene.byNode.has(c));
        if (first) props.onFocus(first);
      }
      return;
    }
    if (dir) {
      const next = spatialNext(scene, focusIn, dir);
      if (next?.nodeId) {
        e.preventDefault();
        props.onFocus(next.nodeId);
      }
      return;
    }
    if (e.key === "/" || ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F"))) {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      props.onZoom(clamp(props.zoom * CAM.ZOOM_STEP, CAM.ZOOM_MIN, CAM.ZOOM_MAX));
      return;
    }
    if (e.key === "-") {
      e.preventDefault();
      props.onZoom(clamp(props.zoom / CAM.ZOOM_STEP, CAM.ZOOM_MIN, CAM.ZOOM_MAX));
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      userMovedRef.current = false;
      props.onZoom(1);
      setLocalCenter((n) => n + 1);
    }
  };

  // window 级 Esc（冒泡阶段；输入中 / 菜单展开时不退出）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const doc = stageRef.current?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
      if (doc?.querySelector('.atlas-toolbar [aria-expanded="true"]')) return;
      props.onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onExit]);

  // ---------------------------------------------------------------- 空态（§5.9）
  const nodeCount = Object.keys(g.nodes).length;
  const stageEmpty = props.unsupported ? (
    <div className="atlas-empty-stage">{T("当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。")}</div>
  ) : props.loading && nodeCount === 0 ? (
    <div className="atlas-empty-stage">
      <i className="atlas-skel" style={{ width: 74 }} />
      <i className="atlas-skel" style={{ width: 128 }} />
      <i className="atlas-skel" style={{ width: 108 }} />
      <div>{T("正在加载…")}</div>
    </div>
  ) : !props.loading && !props.preview && nodeCount > 0 && (g.children[ROOT_ID]?.length ?? 0) === 0 ? (
    <div className="atlas-empty-stage">
      <div>{T("本节还没有结构")}</div>
      {props.onGenerate ? <button type="button" onClick={props.onGenerate}>{T("生成导图")}</button> : null}
    </div>
  ) : null;

  // ---------------------------------------------------------------- 渲染
  const ribbons = edgeDraws.filter((x) => x.e.geom.t === "ribbon");
  const paths = edgeDraws.filter((x) => x.e.geom.t === "path");

  return (
    <div
      className="atlas-stage"
      ref={setStageNode}
      tabIndex={0}
      role="region"
      aria-label={T("结构全景")}
      data-phase={props.phase}
      data-panning={panning || camSnap ? "1" : undefined}
      data-motion={motionOff ? "off" : undefined}
      data-frame0={anim?.frame0 ? "1" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div className="atlas-bg" ref={bgRef} />
      <div className="atlas-world" ref={worldRef} data-lod={props.zoom < CAM.LOD_ZOOM ? "1" : undefined} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${props.zoom})` }}>
        <SvgRoot className="atlas-svg" aria-hidden="true">
          <defs>
            {ribbons.map((ed, i) => (
              <linearGradient key={ed.e.id} id={`alg-${i}`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={ed.e.color} stopOpacity={colors.aHL[ed.tone]} />
                <stop offset="1" stopColor={ed.e.colorB} stopOpacity={colors.aEnd[ed.tone]} />
              </linearGradient>
            ))}
            {paths.map((ed, i) => {
              if (!ed.useGrad) return null;
              const a = ed.e.geom.t === "path" ? ed.e.geom.p : [];
              const sx = a[0] ?? 0, sy = a[1] ?? 0, ex = a[a.length - 2] ?? 0, ey = a[a.length - 1] ?? 0;
              const horiz = Math.abs(ex - sx) >= Math.abs(ey - sy);
              const swap = horiz ? ex < sx : ey < sy;
              return (
                <linearGradient key={`g-${ed.e.id}`} id={`als-${i}`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2={horiz ? "1" : "0"} y2={horiz ? "0" : "1"}>
                  <stop offset="0" stopColor={swap ? ed.e.colorB : ed.e.color} />
                  <stop offset="1" stopColor={swap ? ed.e.color : ed.e.colorB} />
                </linearGradient>
              );
            })}
            {paths.map((ed, i) =>
              ed.e.end ? (
                <marker key={`mke-${ed.e.id}`} id={`mke-${i}`} viewBox="0 0 5 5" refX={4.5} refY={2.5} markerWidth={6} markerHeight={6} markerUnits="userSpaceOnUse" orient="auto">
                  {ed.e.end === "arrow" ? <path d="M0,0 L5,2.5 L0,5 Z" fill={ed.e.colorB} /> : null}
                  {ed.e.end === "open" ? <path d="M0.6,0.6 L4.4,2.5 L0.6,4.4 Z" fill="none" stroke={ed.e.colorB} strokeWidth={1} /> : null}
                  {ed.e.end === "bar" ? <rect x={2} y={0} width={1.5} height={5} fill={ed.e.colorB} /> : null}
                  {ed.e.end === "dot" ? <circle cx={2.5} cy={2.5} r={2} fill={ed.e.colorB} /> : null}
                </marker>
              ) : null,
            )}
            {paths.map((ed, i) =>
              ed.e.start ? (
                <marker key={`mks-${ed.e.id}`} id={`mks-${i}`} viewBox="0 0 5 5" refX={0.5} refY={2.5} markerWidth={6} markerHeight={6} markerUnits="userSpaceOnUse" orient="auto">
                  <circle cx={2.5} cy={2.5} r={2} fill={ed.e.color} />
                </marker>
              ) : null,
            )}
          </defs>
          <g className="atlas-zones">
            {zone ? <rect className="atlas-zone" style={{ x: zone.x - 18, y: zone.y - 18, width: zone.w + 36, height: zone.h + 36, rx: 16, fill: zone.color, opacity: 0.05 } as unknown as CSSProperties} /> : null}
          </g>
          <g className="atlas-decos-under">
            {decoDraws.filter((x) => x.d.k === "rect" && x.d.opacity < 0.1).map((x) => {
              const d = x.d;
              if (d.k !== "rect") return null;
              return (
                <rect key={d.id} className="atlas-deco" style={{ x: x.ax - d.w / 2, y: x.ay - d.h / 2, width: d.w, height: d.h, rx: d.rx, fill: d.fill, opacity: x.opacity, transitionDelay: `${x.delay}ms` } as unknown as CSSProperties} />
              );
            })}
          </g>
          <g className="atlas-ribbons">
            {ribbons.map((ed, i) => (
              <path
                key={ed.e.id}
                className="atlas-ribbon"
                data-edge={ed.e.id}
                d={ed.d}
                fill={`url(#alg-${i})`}
                opacity={ed.opacity}
                style={{ d: `path("${ed.d}")`, transitionDelay: `${ed.delay}ms` } as unknown as CSSProperties}
              />
            ))}
          </g>
          <g className="atlas-edges">
            {paths.map((ed, i) => (
              <path
                key={ed.e.id}
                className="atlas-edge"
                data-edge={ed.e.id}
                data-kind={ed.e.kind}
                data-tone={ed.tone || undefined}
                d={ed.d}
                fill="none"
                stroke={ed.useGrad ? `url(#als-${i})` : ed.e.color}
                strokeWidth={ed.e.kind === "fan" && ed.tone > 0 ? 2 : ed.e.w}
                strokeDasharray={ed.e.dash || undefined}
                markerEnd={ed.e.end ? `url(#mke-${i})` : undefined}
                markerStart={ed.e.start ? `url(#mks-${i})` : undefined}
                opacity={ed.opacity}
                style={{ d: `path("${ed.d}")`, transitionDelay: `${ed.delay}ms` } as unknown as CSSProperties}
              />
            ))}
          </g>
          <g className="atlas-strands">
            {strands.map((s) => {
              const dim = !!hoverKeep && !touchesHover(s.from, s.to);
              if (!visible({ x: s.mid.x - 12, y: s.mid.y - 12, w: 24, h: 24 })) return null;
              const op = (anim ? (anim.started ? 1 : 0) : 1) * (dim ? 0.28 : 1) * (props.phase === "exiting" ? 0 : 1);
              return (
                <g key={`b-${s.id}`} opacity={op}>
                  <circle cx={s.mid.x} cy={s.mid.y} r={8} fill={colors.bg} stroke={s.strong ? colors.accent : s.color} strokeWidth={1} />
                  <text x={s.mid.x} y={s.mid.y + 3.5} textAnchor="middle" fontSize={10} fill={s.strong ? colors.accent : s.color}>{s.code}</text>
                </g>
              );
            })}
          </g>
          <g className="atlas-decos">
            {decoDraws.filter((x) => !(x.d.k === "rect" && x.d.opacity < 0.1)).map((x) => {
              const d = x.d;
              if (d.k === "rect") {
                return <rect key={d.id} className="atlas-deco" style={{ x: x.ax - d.w / 2, y: x.ay - d.h / 2, width: d.w, height: d.h, rx: d.rx, fill: d.fill, opacity: x.opacity, transitionDelay: `${x.delay}ms` } as unknown as CSSProperties} />;
              }
              if (d.k === "circle") {
                return <circle key={d.id} className="atlas-deco" style={{ cx: x.ax, cy: x.ay, r: d.r, fill: d.fill, stroke: d.stroke, strokeWidth: d.strokeW, opacity: x.opacity, transitionDelay: `${x.delay}ms` } as unknown as CSSProperties} />;
              }
              return (
                <text key={d.id} className="atlas-deco" x={x.ax} y={x.ay} fontSize={d.fs} fontWeight={d.weight} fill={d.fill} textAnchor={d.anchor} opacity={x.opacity} style={{ transitionDelay: `${x.delay}ms`, fontFamily: d.mono ? "var(--font-mono, inherit)" : undefined, fontVariantNumeric: d.mono ? "tabular-nums" : undefined }}>
                  {d.text}
                </text>
              );
            })}
          </g>
        </SvgRoot>
        <div className="atlas-glyphs">
          {glyphDraws.map((d) => (
            <GlyphRow key={d.gl.id} d={d} focus={focusIn} readingId={props.readingId} T={T} />
          ))}
        </div>
      </div>
      <div className="atlas-overlay">
        {props.card && focusIn !== ROOT_ID ? (
          <div className="atlas-card-slot" ref={cardSlotRef}>
            {props.card}
          </div>
        ) : null}
      </div>
      {stageEmpty}
    </div>
  );
}
