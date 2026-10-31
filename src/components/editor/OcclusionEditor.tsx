// 手动图片挖空编辑器（D98，v48.57；R1 修订：点击正文图片直进、裁剪收编为编辑器内按钮、
// AI 挖空建议层、单行工具条、动效补齐）——全屏层内连续框选多块遮罩（矩形/椭圆/多边形），
// 选中/拖动/8 向手柄缩放/多边形顶点编辑/删除/撤销，右栏区域列表逐块填答案；
// 保存按制卡模式批量落库（逐块拆卡 / 整图一卡 × 共遮呈现）。
// 坐标契约与 src/lib/occlusion.ts 一致：遮罩状态一律为相对图片百分比 0-100，
// 覆盖层 viewBox="0 0 100 100" + preserveAspectRatio="none" 直接以百分比绘制（与复习端同口径），
// 像素坐标只在指针换算/手柄命中时出现。数据契约零变更：落库由 useSelectionActions.submitOcclusionEditor 承担。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  isShapeUsable,
  normalizeShape,
  shapeBBox,
  shapeToSvg,
  type OcclusionPoint,
  type OcclusionRect,
  type OcclusionShape
} from "../../lib/occlusion";
import type { OcclusionRegion } from "../../lib/cards";
import { settle } from "../../lib/press";
import { useT } from "../../lib/i18n";
import { isTextEntryTarget } from "../../lib/keyTarget";
import { isDialogStackTop, useDialogA11y } from "../../lib/dialogA11y";
import { useOverlayBackdrop } from "../../lib/overlayDismiss";
import { fitImage } from "../../lib/imageFit.mjs";

type Tool = "rect" | "ellipse" | "polygon";

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "rect", label: "矩形", title: "拖动框出矩形遮罩" },
  { id: "ellipse", label: "椭圆", title: "拖动框出椭圆遮罩（角到角）" },
  { id: "polygon", label: "多边形", title: "逐点连线；点回起点或右键闭合（≥3 点）" }
];

const CLOSE_HIT_PX = 12;
// v49.8（D182）：默认题面为运行期翻译（键 = zh 原文）
const DEFAULT_FRONT_KEY = "图中遮挡区域对应的是什么？";

/** 编辑态单块遮罩：形状 + 答案 label + 稳定 id（keyed 渲染/选中；落库前按序重排 ord） */
export interface EditorMask extends OcclusionShape {
  label: string;
  id: number;
}

/** 保存载荷（useSelectionActions.submitOcclusionEditor 消费；imageDataUrl=当前图，可能已经编辑器裁剪） */
export interface OcclusionEditorSubmit {
  imageDataUrl: string;
  masks: EditorMask[];
  mode: "split" | "single";
  shared: boolean;
  frontText: string;
}

interface Props {
  image: { dataUrl: string; alt?: string };
  /** 「AI 挖空」建议层：宿主编排面直读 card-occlusion（零批次），返回归一化 regions */
  onAISuggest?: (dataUrl: string) => Promise<OcclusionRegion[]>;
  /** 阅读器图片的显示框（编辑器 FLIP 承接起点；视口坐标） */
  origin?: { x: number; y: number; width: number; height: number } | null;
  onClose: () => void;
  /** 保存（落库在宿主编排面）；resolve 后宿主负责关闭；reject/失败时本组件保持打开 */
  onSubmit: (payload: OcclusionEditorSubmit) => Promise<void>;
}

/** 拖拽中的指针操作（ref 持有：down/move/up 可能落在同一批次，只读 state 会拿到过期闭包） */
type Drag =
  | { type: "draw-rect"; start: OcclusionPoint }
  | { type: "draw-ellipse"; start: OcclusionPoint }
  | { type: "crop"; start: OcclusionPoint }
  /** R5：move 用绝对定位——grab0=按下点、orig=原始包围盒，每次 move 从快照直接算目标位置
      （增量式 d.grab=p 在 React 批处理下会被后续事件改写，位移错乱冻结） */
  | { type: "move"; id: number; grab0: OcclusionPoint; orig: OcclusionRect; origPoints?: OcclusionPoint[] | null; snap: string; moved?: boolean }
  | { type: "resize"; id: number; handle: number; ob: OcclusionRect; snap: string; moved?: boolean }
  | { type: "vertex"; id: number; idx: number; snap: string; moved?: boolean };

/* 8 向手柄：角 4 + 边中 4（顺时针），光标按方位映射 */
const HANDLE_CURSORS = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];

/** 包围盒 8 手柄的百分比坐标（多边形返回顶点序列＝顶点即手柄） */
function handlePts(m: EditorMask): OcclusionPoint[] {
  if (m.kind === "polygon") return m.points ?? [];
  const b = shapeBBox(m);
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  const mx = b.x + b.w / 2, my = b.y + b.h / 2;
  return [
    { x: x0, y: y0 }, { x: mx, y: y0 }, { x: x1, y: y0 }, { x: x1, y: my },
    { x: x1, y: y1 }, { x: mx, y: y1 }, { x: x0, y: y1 }, { x: x0, y: my }
  ];
}

/** 命中测试（百分比坐标；矩形/椭圆/多边形；容差 0.4% 补偿描边宽度） */
function hitTest(m: EditorMask, p: OcclusionPoint): boolean {
  if (m.kind === "ellipse") {
    const rx = Math.max(0.0001, Number(m.rx) || 0) * 1.08;
    const ry = Math.max(0.0001, Number(m.ry) || 0) * 1.08;
    const dx = (p.x - (m.cx ?? 0)) / rx, dy = (p.y - (m.cy ?? 0)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (m.kind === "polygon") {
    let inside = false;
    const pts = m.points ?? [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i].y > p.y) !== (pts[j].y > p.y) &&
        p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
    }
    return inside;
  }
  const b = shapeBBox(m);
  return p.x >= b.x - 0.4 && p.x <= b.x + b.w + 0.4 && p.y >= b.y - 0.4 && p.y <= b.y + b.h + 0.4;
}

/** 按新包围盒重锚（拖手柄共用；多边形按旧包围盒比例缩放顶点。纯函数，R5 同上） */
function applyBBox(m: EditorMask, nb: OcclusionRect, ob: OcclusionRect): EditorMask {
  if (m.kind === "rect") {
    return { ...m, x: nb.x, y: nb.y, w: Math.max(1, nb.w), h: Math.max(1, nb.h) };
  }
  if (m.kind === "ellipse") {
    return { ...m, cx: nb.x + nb.w / 2, cy: nb.y + nb.h / 2, rx: Math.max(0.5, nb.w / 2), ry: Math.max(0.5, nb.h / 2) };
  }
  return {
    ...m,
    points: (m.points ?? []).map((p) => ({
      x: ob.w > 0 ? nb.x + ((p.x - ob.x) / ob.w) * nb.w : p.x,
      y: ob.h > 0 ? nb.y + ((p.y - ob.y) / ob.h) * nb.h : p.y
    }))
  };
}

/** R1 裁剪：把遮罩按新图片空间重映射（完全越界丢弃，其余 normalizeShape clamp 入界；ord 按序重排） */
function remapMasks(masks: EditorMask[], r: OcclusionRect): EditorMask[] {
  const out: EditorMask[] = [];
  for (const m of masks) {
    const b = shapeBBox(m);
    if (b.x + b.w < r.x || b.x > r.x + r.w || b.y + b.h < r.y || b.y > r.y + r.h) continue;
    let next: OcclusionShape;
    if (m.kind === "ellipse") {
      next = {
        kind: "ellipse", ord: 0,
        cx: ((m.cx ?? 0) - r.x) / r.w * 100, cy: ((m.cy ?? 0) - r.y) / r.h * 100,
        rx: (m.rx ?? 0) / r.w * 100, ry: (m.ry ?? 0) / r.h * 100
      };
    } else if (m.kind === "polygon") {
      next = {
        kind: "polygon", ord: 0,
        points: (m.points ?? []).map((p) => ({ x: (p.x - r.x) / r.w * 100, y: (p.y - r.y) / r.h * 100 }))
      };
    } else {
      next = { kind: "rect", ord: 0, x: ((m.x ?? 0) - r.x) / r.w * 100, y: ((m.y ?? 0) - r.y) / r.h * 100, w: ((m.w ?? 0) / r.w) * 100, h: ((m.h ?? 0) / r.h) * 100 };
    }
    const normalized = normalizeShape(next);
    if (normalized && isShapeUsable(normalized)) out.push({ ...normalized, label: m.label, id: m.id });
  }
  return out.map((m, i) => ({ ...m, ord: i }));
}

/** 裁剪压暗层路径：外框全图 + 裁剪框挖孔（evenodd）——预览永不实色填充，框内内容始终可见 */
function cropDimPath(r: OcclusionRect): string {
  return `M0 0 H100 V100 H0 Z M${r.x} ${r.y} h${r.w} v${r.h} h${-r.w} Z`;
}

/** 百分比形状 → SVG 图元（viewBox 0 0 100 100 同口径；vector-effect 由调用侧附加） */
function ShapeNode({ shape, className, style }: { shape: OcclusionShape; className: string; style?: React.CSSProperties }) {
  const { tag, attrs } = shapeToSvg(shape);
  const common = { className, vectorEffect: "non-scaling-stroke" as const, style };
  if (tag === "ellipse") return <ellipse {...(attrs as object)} {...common} />;
  if (tag === "polygon") return <polygon {...(attrs as object)} {...common} />;
  return <rect {...(attrs as object)} {...common} />;
}

export default function OcclusionEditor({ image, onAISuggest, origin, onClose, onSubmit }: Props) {
  const T = useT();
  const [tool, setTool] = useState<Tool>("rect");
  const [imgUrl, setImgUrl] = useState(image.dataUrl); // 当前图（「裁剪图片」应用后替换为裁剪图）
  const [masks, setMasks] = useState<EditorMask[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [draft, setDraft] = useState<OcclusionShape | null>(null);   // 遮罩绘制中的草稿
  // 多边形顶点以 ref 为真相源：逐点点击可能落在同一批次（合成事件/极快点击），
  // 只读 state 会拿到过期闭包导致后续点互相覆盖（与下方 dragRef 同理）
  const polyRef = useRef<OcclusionPoint[] | null>(null);
  const [poly, setPoly] = useState<OcclusionPoint[] | null>(null);
  const [hover, setHover] = useState<OcclusionPoint | null>(null);   // 多边形橡皮筋跟随点
  // R1 裁剪：cropMode=裁剪进行中；cropDraft=拖拽中的裁剪框；cropArmed=已画好待应用
  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState<OcclusionRect | null>(null);
  const [cropArmed, setCropArmed] = useState<OcclusionRect | null>(null);
  const [mode, setMode] = useState<"split" | "single">("split");
  const [shared, setShared] = useState(false);
  const [frontText, setFrontText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ghost, setGhost] = useState<EditorMask | null>(null);   // 删除退场动画的残影
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [fitBox, setFitBox] = useState({ w: 0, h: 0 });
  const [entered, setEntered] = useState(false);
  const [flyOrigin, setFlyOrigin] = useState<{ dx: number; dy: number; sx: number; sy: number } | null>(null);
  // 段控滑移指示条（state-changes 200ms）
  const segRef = useRef<HTMLDivElement>(null);
  const [segInd, setSegInd] = useState({ left: 0, width: 0 });

  const idRef = useRef(0);
  const layerRef = useDialogA11y<HTMLDivElement>(onClose, { escape: false });
  const stageRef = useRef<HTMLDivElement>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  // R2 撤销栈：快照＝遮罩列表 + 多边形草稿点（「单次点击/操作」为可撤销单元）
  const undoRef = useRef<string[]>([]);
  const [undoLen, setUndoLen] = useState(0);
  // 撤销快照基线（dirty 判定：遮罩或题面偏离基线即未保存）
  const baselineRef = useRef("");

  // 显示框尺寸（百分比↔像素换算、手柄命中与多边形闭合判定用）
  useLayoutEffect(() => {
    const el = imgBoxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // FLIP 承接：从阅读器图片原位置飞入（无 origin 时原地淡入）
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!origin || r.width < 8 || r.height < 8) {
      setEntered(true);
      return;
    }
    setFlyOrigin({
      dx: origin.x + origin.width / 2 - (r.left + r.width / 2),
      dy: origin.y + origin.height / 2 - (r.top + r.height / 2),
      sx: Math.max(0.05, origin.width / r.width),
      sy: Math.max(0.05, origin.height / r.height)
    });
    const t = window.setTimeout(() => setEntered(true), 20);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 段控指示条定位（编辑器挂载即可见，offsetLeft 可直测；换工具/窗口缩放时重放滑移）
  useLayoutEffect(() => {
    const place = () => {
      const seg = segRef.current;
      if (!seg) return;
      const btn = seg.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
      if (btn) setSegInd({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tool]);

  // R5： masks 的 ref 镜像——window 级拖拽监听器与撤销快照读取「当前值」而不依赖过期闭包
  const masksRef = useRef<EditorMask[]>(masks);
  masksRef.current = masks;

  const snap = useCallback(() => JSON.stringify(masksRef.current), []);
  // R2：撤销快照含多边形草稿点——撤销一次点击＝精确回退该点击（含它触发的默认事件）
  const snapState = useCallback(() => JSON.stringify({ m: masksRef.current, p: polyRef.current }), []);
  const pushUndoState = useCallback(() => {
    undoRef.current.push(snapState());
    if (undoRef.current.length > 50) undoRef.current.shift();
    setUndoLen(undoRef.current.length);
  }, [snapState]);
  const undo = useCallback(() => {
    const s = undoRef.current.pop();
    if (!s) return;
    setUndoLen(undoRef.current.length);
    const st = JSON.parse(s) as { m: EditorMask[]; p: OcclusionPoint[] | null };
    setMasks(st.m);
    polyRef.current = st.p;
    setPoly(st.p);
    setHover(null);
    setSelId((prev) => (st.m.some((m) => m.id === prev) ? prev : null));
  }, []);
  const dirty = (baselineRef.current ? snap() !== baselineRef.current : false) || frontText.trim() !== "";
  const requestClose = useCallback(() => {
    if (dirty) setConfirmOpen(true);
    else onClose();
  }, [dirty, onClose]);
  const backdrop = useOverlayBackdrop(layerRef, requestClose, {
    isBlank: (target, currentTarget) =>
      target === currentTarget ||
      (target instanceof Element && (
        target.classList.contains("occlusion-editor-main") ||
        target.classList.contains("occlusion-editor-stage")
      ))
  });
  // 首帧后记基线（空画布不算未保存改动）
  useEffect(() => {
    if (!baselineRef.current) baselineRef.current = JSON.stringify(masks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D256：图片按主区真实可用盒 contain；工具栏与题注在 flex 流内，不参与图片可用区。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || naturalSize.w <= 0 || naturalSize.h <= 0) {
      if (fitBox.w || fitBox.h) setFitBox({ w: 0, h: 0 });
      return;
    }
    const measure = () => {
      const caption = stage.querySelector<HTMLElement>(".image-focus-caption");
      const gap = parseFloat(getComputedStyle(stage).rowGap || "0") || 0;
      const captionH = caption ? caption.getBoundingClientRect().height + gap : 0;
      const fitted = fitImage(naturalSize.w, naturalSize.h, stage.clientWidth, stage.clientHeight - captionH, 1);
      setFitBox((prev) => (
        Math.abs(prev.w - fitted.width) < 0.5 && Math.abs(prev.h - fitted.height) < 0.5
          ? prev
          : { w: fitted.width, h: fitted.height }
      ));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    const caption = stage.querySelector<HTMLElement>(".image-focus-caption");
    if (caption) ro.observe(caption);
    return () => ro.disconnect();
  }, [naturalSize.w, naturalSize.h, image.alt]);

  const pushUndo = pushUndoState; // 兼容别名（R1 命名）

  const usable = masks.length > 0 && !saving;
  const cardCount = mode === "single" ? 1 : masks.length;

  // ---------- 指针换算（R5：不钳制 0-100——钳制会毒化拖拽增量（光标出图后 grab 被钳值污染，
  //            回移即回跳冻结）；越界钳制由 moveMask / normalizeShape 各自负责） ----------
  const toPct = useCallback((e: { clientX: number; clientY: number }): OcclusionPoint => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  }, []);
  const pxLen = (dxPct: number, dyPct: number) =>
    Math.hypot((dxPct / 100) * size.w, (dyPct / 100) * size.h);

  const nearHandle = useCallback((e: { clientX: number; clientY: number }): number => {
    const m = masks.find((x) => x.id === selId);
    if (!m || dragRef.current) return -1;
    const el = canvasRef.current;
    if (!el) return -1;
    const r = el.getBoundingClientRect();
    const pts = handlePts(m);
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(r.left + (pts[i].x / 100) * r.width - e.clientX, r.top + (pts[i].y / 100) * r.height - e.clientY) <= 8) return i;
    }
    return -1;
  }, [masks, selId]);

  const commitMask = useCallback((shape: OcclusionShape, label = ""): boolean => {
    const normalized = normalizeShape({ ...shape, ord: 0 });
    if (!normalized || !isShapeUsable(normalized)) return false;
    const id = ++idRef.current;
    setMasks((prev) => [...prev, { ...normalized, label, id }]);
    setSelId(id);
    return true;
  }, []);

  const deleteMask = useCallback((id: number) => {
    const m = masks.find((x) => x.id === id);
    if (!m) return;
    pushUndoState();
    // universal-patterns：退场比入场快（140ms ghost 残影，不阻塞状态更新）
    setGhost(m);
    window.setTimeout(() => setGhost((g) => (g && g.id === id ? null : g)), 150);
    setMasks((prev) => prev.filter((x) => x.id !== id));
    setSelId((prev) => (prev === id ? null : prev));
  }, [masks, pushUndoState]);

  // ---------- 拖拽引擎（R5）：move/up 挂 window——不依赖元素级 pointer capture，
  //            光标离开画布/图片事件不丢；处理器经 ref 读最新状态，无过期闭包 ----------
  const handleDragMove = useCallback((e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toPct(e);
    if (d.type === "crop") {
      setCropDraft({
        x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y)
      });
      return;
    }
    if (d.type === "draw-rect") {
      setDraft({
        kind: "rect", ord: 0,
        x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y)
      });
      return;
    }
    if (d.type === "draw-ellipse") {
      // R2：椭圆改角到角拖动（与矩形同语义）——最终形状＝拖动经过矩形区域的内切椭圆
      const x0 = Math.min(d.start.x, p.x), x1 = Math.max(d.start.x, p.x);
      const y0 = Math.min(d.start.y, p.y), y1 = Math.max(d.start.y, p.y);
      setDraft({ kind: "ellipse", ord: 0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 });
      return;
    }
    if (d.type === "move") {
      // R5：绝对定位——grab0/orig 为按下时快照，目标位置＝原始位置 + 光标总位移；
      // updater 纯函数（同输入同输出），React 批处理/重跑不漂移
      const dx = p.x - d.grab0.x, dy = p.y - d.grab0.y;
      const nx = Math.max(0, Math.min(100 - d.orig.w, d.orig.x + dx));
      const ny = Math.max(0, Math.min(100 - d.orig.h, d.orig.y + dy));
      d.moved = true;
      // R7：多边形＝原始顶点 + 钳制后位移（绝对平移）——applyBBox 的比例重映射假定顶点
      // 仍在原始 bbox 空间，逐事件套用会把已平移的位置再累加一次（多边形越拖越快）
      const tx = nx - d.orig.x, ty = ny - d.orig.y;
      setMasks((prev) => prev.map((m) => {
        if (m.id !== d.id) return m;
        if (m.kind === "polygon" && d.origPoints) {
          return { ...m, points: d.origPoints.map((q) => ({ x: q.x + tx, y: q.y + ty })) };
        }
        return applyBBox(m, { x: nx, y: ny, w: d.orig.w, h: d.orig.h }, d.orig);
      }));
      return;
    }
    if (d.type === "resize") {
      setMasks((prev) => prev.map((m) => {
        if (m.id !== d.id) return m;
        const b = d.ob;
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        if (d.handle === 0 || d.handle === 6 || d.handle === 7) x0 = p.x;
        if (d.handle === 2 || d.handle === 3 || d.handle === 4) x1 = p.x;
        if (d.handle === 0 || d.handle === 1 || d.handle === 2) y0 = p.y;
        if (d.handle === 4 || d.handle === 5 || d.handle === 6) y1 = p.y;
        const nx = Math.max(0, Math.min(100, Math.min(x0, x1)));
        const ny = Math.max(0, Math.min(100, Math.min(y0, y1)));
        d.moved = true;
        return applyBBox(m, {
          x: nx, y: ny,
          w: Math.max(1, Math.min(100 - nx, Math.abs(x1 - x0))),
          h: Math.max(1, Math.min(100 - ny, Math.abs(y1 - y0)))
        }, b);
      }));
      return;
    }
    // vertex
    d.moved = true;
    setMasks((prev) => prev.map((m) => {
      if (m.id !== d.id) return m;
      const pts = (m.points ?? []).map((pt, i) => (i === d.idx ? { x: p.x, y: p.y } : pt));
      return { ...m, points: pts };
    }));
  }, [toPct]);

  const handleDragUp = useCallback((e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const p = toPct(e);
    if (d.type === "crop") {
      setCropDraft(null);
      const r = normalizeShape({ kind: "rect", ord: 0, x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
      setCropArmed(r && isShapeUsable(r) ? shapeBBox(r) : null);
      return;
    }
    if (d.type === "draw-rect" || d.type === "draw-ellipse") {
      const finalized: OcclusionShape = d.type === "draw-rect"
        ? {
            kind: "rect", ord: 0,
            x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
            w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y)
          }
        : {
            // R2：椭圆＝拖动经过矩形区域的内切椭圆（角到角，与矩形同语义）
            kind: "ellipse", ord: 0,
            cx: (Math.min(d.start.x, p.x) + Math.max(d.start.x, p.x)) / 2,
            cy: (Math.min(d.start.y, p.y) + Math.max(d.start.y, p.y)) / 2,
            rx: Math.abs(p.x - d.start.x) / 2, ry: Math.abs(p.y - d.start.y) / 2
          };
      setDraft(null);
      pushUndoState(); // 撤销＝移除刚画的遮罩
      if (!commitMask(finalized)) {
        undoRef.current.pop();
        setUndoLen(undoRef.current.length);
      }
      return;
    }
    // move/resize/vertex：拖拽中真实移动过才入撤销栈（R5：up 时 masksRef 可能尚未随批处理
    // 队列刷新，状态比较会误判「无变化」——改为拖拽过程直接打 moved 标记，入栈 down 时快照）
    if (d.moved) {
      undoRef.current.push(d.snap);
      if (undoRef.current.length > 50) undoRef.current.shift();
      setUndoLen(undoRef.current.length);
    }
  }, [toPct, snapState, pushUndoState, commitMask]);

  const beginDrag = useCallback((d: Drag, e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = d;
    const move = (ev: PointerEvent) => handleDragMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      handleDragUp(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件/无活动指针环境（测试注入）下忽略 */
    }
  }, [handleDragMove, handleDragUp]);

  // ---------- 指针交互（R5：down 在画布上发起；move/up 由 window 监听器接管） ----------
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (saving || dragRef.current) return;
    setConfirmOpen(false);
    const p = toPct(e);
    if (cropMode) {
      // 裁剪模式：拖出新裁剪框（替换已 arm 的框）
      beginDrag({ type: "crop", start: p }, e);
      setCropArmed(null);
      setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === "polygon") {
      const cur = polyRef.current;
      // 闭合判定：≥3 点且点回起点（像素距离）——右键任意位置闭环见 onContextMenu
      if (cur && cur.length >= 3) {
        const d = pxLen(p.x - cur[0].x, p.y - cur[0].y);
        if (d <= CLOSE_HIT_PX) {
          closePolygonDraft();
          return;
        }
      }
      if (cur) {
        // 草稿进行中：点击＝加点（可穿过已有遮罩）
        pushUndoState(); // 每次点击（加点）都是可撤销单元：撤销＝移除这个点
        polyRef.current = [...cur, p];
        setPoly(polyRef.current);
        return;
      }
      // R5：草稿未开始——点已有遮罩＝选中并拖动/缩放（此前误起新草稿），点空白才起笔
      const hi = nearHandle(e);
      if (hi >= 0) {
        const m = masks.find((x) => x.id === selId);
        if (m) {
          beginDrag(m.kind === "polygon"
            ? { type: "vertex", id: m.id, idx: hi, snap: snapState() }
            : { type: "resize", id: m.id, handle: hi, ob: shapeBBox(m), snap: snapState() }, e);
          return;
        }
      }
      for (let i = masks.length - 1; i >= 0; i--) {
        if (hitTest(masks[i], p)) {
          setSelId(masks[i].id);
          beginDrag({ type: "move", id: masks[i].id, grab0: p, orig: shapeBBox(masks[i]), origPoints: masks[i].kind === "polygon" ? (masks[i].points ?? []).map((q) => ({ ...q })) : null, snap: snapState() }, e);
          return;
        }
      }
      setSelId(null);
      pushUndoState(); // 起笔入栈：撤销一次＝移除一个点
      polyRef.current = [p];
      setPoly(polyRef.current);
      return;
    }
    const hi = nearHandle(e);
    if (hi >= 0) {
      const m = masks.find((x) => x.id === selId);
      if (!m) return;
      beginDrag(m.kind === "polygon"
        ? { type: "vertex", id: m.id, idx: hi, snap: snapState() }
        : { type: "resize", id: m.id, handle: hi, ob: shapeBBox(m), snap: snapState() }, e);
      return;
    }
    for (let i = masks.length - 1; i >= 0; i--) {
      if (hitTest(masks[i], p)) {
        setSelId(masks[i].id);
        beginDrag({ type: "move", id: masks[i].id, grab0: p, orig: shapeBBox(masks[i]), origPoints: masks[i].kind === "polygon" ? (masks[i].points ?? []).map((q) => ({ ...q })) : null, snap: snapState() }, e);
        return;
      }
    }
    setSelId(null);
    if (tool === "rect") {
      beginDrag({ type: "draw-rect", start: p }, e);
      setDraft({ kind: "rect", ord: 0, x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      beginDrag({ type: "draw-ellipse", start: p }, e);
      setDraft({ kind: "ellipse", ord: 0, cx: p.x, cy: p.y, rx: 0, ry: 0 });
    }
  };

  // R5：画布上的 pointermove 只管「未拖拽」态（悬停/光标/草稿跟随）；拖拽中的 move/up 由 window 监听器接管
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) return;
    const p = toPct(e);
    if (polyRef.current) setHover(p);
    if (cropMode) return;
    const f = tool === "polygon" ? polyRef.current : null;
    if (f && f.length >= 3 && pxLen(p.x - f[0].x, p.y - f[0].y) <= CLOSE_HIT_PX) {
      e.currentTarget.style.cursor = "pointer";
      return;
    }
    const hi = nearHandle(e);
    e.currentTarget.style.cursor = hi >= 0 ? HANDLE_CURSORS[hi % 8] : "";
  };

  /** R3 闭环：把当前多边形草稿收口为遮罩（≥3 点）；撤销＝回到「差一点闭合」的草稿。
      两个入口共用：点回起点（像素 12px 内）/ 画布右键（从当前点直连初始点闭合）。 */
  const closePolygonDraft = useCallback(() => {
    const cur = polyRef.current;
    if (!cur || cur.length < 3) return;
    pushUndoState();
    if (commitMask({ kind: "polygon", ord: 0, points: cur })) {
      polyRef.current = null;
      setPoly(null);
      setHover(null);
    } else {
      undoRef.current.pop();
      setUndoLen(undoRef.current.length);
    }
  }, [commitMask, pushUndoState]);

  // R3 右键闭环：≥3 点时在画布任意处右键＝从当前点直连初始点收口
  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (cropMode || saving || tool !== "polygon") return;
    closePolygonDraft();
  };

  const switchTool = (t: Tool) => {
    setTool(t);
    polyRef.current = null;
    setPoly(null);
    setHover(null);
    setDraft(null);
    dragRef.current = null;
  };

  const exitCrop = useCallback(() => {
    setCropMode(false);
    setCropDraft(null);
    setCropArmed(null);
    dragRef.current = null;
  }, []);

  /** R1 裁剪应用：canvas 裁当前图 → 遮罩按新空间重映射 → 撤销栈清空（跨空间撤销无意义）。
      基线不动：裁剪本身计为未保存改动（关闭时进确认条），保存后随卡片落库。 */
  const applyCrop = useCallback(async () => {
    const r = cropArmed;
    if (!r) return;
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("图片解码失败"));
      img.src = imgUrl;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    const sx = Math.max(0, Math.floor((r.x / 100) * w));
    const sy = Math.max(0, Math.floor((r.y / 100) * h));
    const sw = Math.max(1, Math.min(w - sx, Math.round((r.w / 100) * w)));
    const sh = Math.max(1, Math.min(h - sy, Math.round((r.h / 100) * h)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    setImgUrl(canvas.toDataURL("image/png"));
    setMasks((prev) => remapMasks(prev, r));
    undoRef.current = [];
    setUndoLen(0);
    setSelId(null);
    exitCrop();
  }, [cropArmed, imgUrl, exitCrop]);

  /** R1 AI 挖空建议层：宿主直读 card-occlusion（零批次），regions 逐块 stagger 导入为可编辑遮罩。
      一次 Ctrl+Z 撤回整批。AI 仅建议——不自动落库。 */
  const runAI = useCallback(async () => {
    if (aiBusy || !onAISuggest) return;
    setAiBusy(true);
    try {
      const regions = await onAISuggest(imgUrl);
      if (regions.length > 0) {
        pushUndoState();
        regions.forEach((r, i) => {
          window.setTimeout(() => {
            commitMask({ kind: "rect", ord: 0, x: r.x, y: r.y, w: r.w, h: r.h }, r.label || "");
          }, i * 60);
        });
      }
    } catch {
      /* 宿主已 toast（API Key/网络），保持编辑器现状 */
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, onAISuggest, imgUrl, pushUndoState, commitMask]);

  // Esc 链：裁剪草稿 → 裁剪框 → 裁剪模式 → 多边形草稿 → 关闭确认 → 关闭；Del/Ctrl+Z/1-3 与输入态守卫
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isDialogStackTop(layerRef.current)) return;
      // D227：只有文本输入算「在打字」（滑块 / 复选框聚焦时 Del / Ctrl+Z / 1-3 照常可用）
      const typing = isTextEntryTarget(document.activeElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        if (cropDraft) { setCropDraft(null); dragRef.current = null; return; }
        if (cropArmed) { setCropArmed(null); return; }
        if (cropMode) { exitCrop(); return; }
        if (polyRef.current) { polyRef.current = null; setPoly(null); setHover(null); return; }
        if (confirmOpen) { setConfirmOpen(false); return; }
        requestClose();
        return;
      }
      if (typing || saving || cropMode) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selId != null) {
        e.preventDefault();
        deleteMask(selId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        switchTool(TOOLS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  async function save(e: React.MouseEvent<HTMLButtonElement>) {
    if (!masks.length || saving) return;
    settle(e.currentTarget);
    setSaving(true);
    try {
      await onSubmit({
        imageDataUrl: imgUrl,
        masks: masks.map((m, i) => ({ ...m, ord: i })),
        mode,
        shared,
        frontText
      });
    } catch {
      /* 落库失败：宿主已 toast，编辑器保持打开保住遮罩 */
    } finally {
      setSaving(false);
    }
  }

  const sel = masks.find((m) => m.id === selId) ?? null;
  const cropPreview = cropDraft ?? cropArmed;

  return (
    <div
      ref={layerRef}
      className={`occlusion-editor-layer${entered ? " occlusion-editor-in" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={T("图片挖空编辑器")}
      data-testid="occlusion-editor"
      {...backdrop}
    >
      <div className="occlusion-editor-main">
        {/* R1：单行紧凑工具条——随主区在流内定位（与右栏无覆盖可能），无提示文案 */}
        <div className="occlusion-editor-toolbar image-overlay-toolbar" role="toolbar" aria-label={T("挖空编辑工具")}>
          <div className={`occl-seg${cropMode ? " cropping" : ""}`} role="tablist" aria-label={T("遮罩形状")} ref={segRef}>
            <div className="occl-seg-ind" style={{ left: segInd.left, width: segInd.width }} />
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`occl-tool${tool === t.id ? " active" : ""}`}
                aria-pressed={tool === t.id}
                data-tool={t.id}
                data-testid={`occl-tool-${t.id}`}
                title={T(t.title)}
                onClick={() => switchTool(t.id)}
              >
                {T(t.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`btn btn-outline btn-sm${cropMode ? " occl-crop-active" : ""}`}
            aria-pressed={cropMode}
            data-testid="occl-crop"
            disabled={aiBusy || saving}
            title={T("裁剪图片：框选保留区域，遮罩随新图重映射")}
            onClick={() => (cropMode ? exitCrop() : setCropMode(true))}
          >
            {cropMode ? T("退出裁剪") : T("裁剪图片")}
          </button>
          <span className="occl-toolbar-div" />
          {cropMode ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="occl-crop-apply"
                disabled={!cropArmed}
                title={T("应用裁剪")}
                onClick={() => void applyCrop()}
              >
                {T("应用裁剪")}
              </button>
              <button type="button" className="btn btn-sm" data-testid="occl-crop-cancel" onClick={exitCrop}>
                {T("取消裁剪")}
              </button>
            </>
          ) : (
            <>
              {onAISuggest && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={aiBusy || saving || cropMode}
                  data-testid="occl-ai"
                  title={T("AI 识别适合挖空的区域，导入为可编辑遮罩建议")}
                  onClick={() => void runAI()}
                >
                  {aiBusy ? <><span className="occl-spin" />{T("AI 识别中…")}</> : T("AI 挖空")}
                </button>
              )}
              <button type="button" className="btn btn-outline btn-sm" disabled={undoLen === 0} data-testid="occl-undo" onClick={undo}>
                {T("撤销")}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm btn-danger"
                disabled={masks.length === 0}
                data-testid="occl-clear"
                onClick={() => {
                  if (!masks.length) return;
                  pushUndoState();
                  setMasks([]);
                  setSelId(null);
                }}
              >
                {T("清空")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!usable}
                data-testid="occl-save"
                onClick={(e) => void save(e)}
              >
                {saving ? T("保存中…") : masks.length ? T("创建 {n} 张卡片", { n: cardCount }) : T("创建卡片")}
              </button>
            </>
          )}
          <span className="occl-toolbar-div" />
          <button type="button" className="image-focus-close occl-close-inline" title={T("关闭（Esc）")} aria-label={T("关闭编辑器")} data-testid="occl-close" onClick={requestClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div
          className="occlusion-editor-stage"
          ref={stageRef}
          style={!entered && flyOrigin ? {
            transform: `translate(${flyOrigin.dx}px, ${flyOrigin.dy}px) scale(${flyOrigin.sx}, ${flyOrigin.sy})`,
            opacity: 0.35
          } : undefined}
        >
          <div className="occlusion-editor-imgbox" ref={imgBoxRef}>
            <img
              src={imgUrl}
              alt={image.alt || ""}
              draggable={false}
              style={fitBox.w > 0 ? { width: `${fitBox.w}px`, height: `${fitBox.h}px` } : { visibility: "hidden" }}
              onLoad={(e) => {
                const nw = e.currentTarget.naturalWidth;
                const nh = e.currentTarget.naturalHeight;
                if (nw > 0 && nh > 0) setNaturalSize({ w: nw, h: nh });
              }}
            />
            {/* 序号徽标：贴每块遮罩包围盒左上角（点击＝选中，与画布选中态双向同步） */}
            {masks.map((m, i) => {
              const b = shapeBBox(m);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`occlusion-editor-badge${m.id === selId ? " sel" : ""}`}
                  style={{ left: `${b.x}%`, top: `${b.y}%`, pointerEvents: cropMode ? "none" : undefined }}
                  title={T("区域 {n}", { n: i + 1 })}
                  onClick={() => setSelId(m.id)}
                >
                  {i + 1}
                </button>
              );
            })}
            <svg
              ref={canvasRef}
              className={`occlusion-editor-canvas tool-${cropMode ? "crop" : tool}`}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              data-testid="occl-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onContextMenu={onContextMenu}
              onPointerLeave={() => {
                // R5：拖拽由 window 监听器接管，光标出画布不再中断；仅清草稿跟随点
                setHover(null);
              }}
            >
              {masks.map((m) => (
                <ShapeNode key={m.id} shape={m} className={`occlusion-editor-mask${m.id === selId ? " selected" : ""}`} />
              ))}
              {ghost && <ShapeNode shape={ghost} className="occl-ghost" />}
              {draft && !cropMode && <ShapeNode shape={draft} className="occlusion-shape drafts" />}
              {/* R4：草稿段全部虚线（含 1→2、2→3）——此前 ≥3 点后改以实线草稿形状渲染，
                  1→2 段的虚线观感消失；统一虚线直至闭合，闭合后才转实线遮罩 */}
              {poly && poly.length >= 2 && poly.slice(0, -1).map((p, i) => {
                const q = poly[i + 1];
                return (
                  <line
                    key={`s${i}`}
                    className="occlusion-rubber"
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {/* 跟随橡皮筋：自第一个点起就有（R2 修复首段无虚线）；R3 补 non-scaling-stroke——
                  此前漏掉该属性，非均匀缩放把 2px 虚线放大成约 19px 粗虚线 */}
              {poly && poly.length >= 1 && (
                <line
                  className="occlusion-rubber"
                  x1={poly[poly.length - 1].x}
                  y1={poly[poly.length - 1].y}
                  x2={hover?.x ?? poly[poly.length - 1].x}
                  y2={hover?.y ?? poly[poly.length - 1].y}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* R1 裁剪预览：外部压暗 + accent 描边（挖孔 evenodd）——框内内容始终可见 */}
              {cropPreview && (
                <>
                  <path d={cropDimPath(cropPreview)} className="occl-crop-dim" fillRule="evenodd" />
                  <ShapeNode shape={{ kind: "rect", ord: 0, ...cropPreview }} className="occl-crop-rect" />
                </>
              )}
            </svg>
            {/* R3 补：手柄/顶点圆点必须挂在 imgbox（HTML 层）——此前误置于 SVG 命名空间内不渲染。
                pointer-events none，命中与拖拽仍走画布的像素级 nearHandle 逻辑；z 浮于画布之上 */}
            {sel && !cropMode && (sel.kind === "polygon"
              ? (sel.points ?? []).map((p, i) => (
                  <span
                    key={`v${i}`}
                    className={`occl-dot${i === 0 ? " first" : ""}`}
                    style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${i * 12}ms` }}
                  />
                ))
              : handlePts(sel).map((hp, i) => (
                  <span
                    key={`h${i}`}
                    className="occl-dot"
                    style={{ left: `${hp.x}%`, top: `${hp.y}%`, cursor: HANDLE_CURSORS[i % 8], animationDelay: `${i * 12}ms` }}
                  />
                )))}
            {poly && poly.map((p, i) => (
              <span
                key={`d${i}`}
                className={`occl-dot${i === 0 ? " first" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              />
            ))}
          </div>
          {image.alt && <p className="image-focus-caption">{image.alt}</p>}
        </div>
      </div>

      <aside className="occlusion-editor-rail" aria-label={T("遮罩区域列表")}>
        <div className="occlusion-editor-rail-label">{T("制卡模式")}</div>
        <div className="occlusion-editor-modes">
          <button
            type="button"
            className={`occl-tool occlusion-editor-mode${mode === "split" ? " active" : ""}`}
            aria-pressed={mode === "split"}
            data-testid="occl-mode-split"
            onClick={() => setMode("split")}
          >
            {T("逐块拆卡")}
          </button>
          <button
            type="button"
            className={`occl-tool occlusion-editor-mode${mode === "single" ? " active" : ""}`}
            aria-pressed={mode === "single"}
            data-testid="occl-mode-single"
            onClick={() => setMode("single")}
          >
            {T("整图一卡")}
          </button>
        </div>
        {mode === "split" && (
          <label className="occlusion-editor-check">
            <input type="checkbox" checked={shared} data-testid="occl-shared" onChange={(e) => setShared(e.target.checked)} />
            {T("共遮呈现（其余区域保持遮挡，Anki 风格）")}
          </label>
        )}
        <div className="occlusion-editor-rail-label">{T("题面（全部卡片共享）")}</div>
        <textarea
          className="occlusion-editor-input"
          rows={2}
          value={frontText}
          placeholder={T(DEFAULT_FRONT_KEY)}
          aria-label={T("题面")}
          data-testid="occl-front"
          onChange={(e) => setFrontText(e.target.value)}
        />
        <div className="occlusion-editor-rail-label">
          {T("遮罩区域")}
          <span className="occlusion-editor-rail-count mono" data-testid="occl-count">{masks.length ? T("{n} 块", { n: masks.length }) : ""}</span>
        </div>
        <div className="occlusion-editor-list">
          {masks.map((m, i) => (
            <div
              key={m.id}
              className={`occlusion-editor-row${m.id === selId ? " sel" : ""}`}
              data-testid="occl-mask-row"
              onClick={() => setSelId(m.id)}
            >
              <span className="occlusion-editor-row-num mono">{i + 1}</span>
              <input
                value={m.label}
                placeholder={T("区域 {n} 的答案", { n: i + 1 })}
                aria-label={T("区域 {n} 答案", { n: i + 1 })}
                onChange={(e) => {
                  const v = e.target.value;
                  setMasks((prev) => prev.map((x) => (x.id === m.id ? { ...x, label: v } : x)));
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="occlusion-editor-row-del"
                title={T("删除区域 {n}", { n: i + 1 })}
                aria-label={T("删除区域 {n}", { n: i + 1 })}
                data-testid="occl-row-del"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMask(m.id);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          ))}
          {masks.length === 0 && <p className="occlusion-editor-empty">{T("还没有遮罩——用顶部工具在图上框选。")}</p>}
        </div>
        <p className="occlusion-editor-count" data-testid="occl-note">
          {masks.length
            ? T("{n} 块遮罩 → {m} 张卡片；同图多卡互为同源（同日只放行一张）。", { n: masks.length, m: mode === "single" ? "1" : masks.length })
            : T("同图多卡互为同源（siblingKey=图片资产），落库走手动制卡链。")}
        </p>
      </aside>

      <div className={`occlusion-editor-confirm${confirmOpen ? " show" : ""}`} role="alertdialog" aria-label={T("未保存提示")}>
        <p>{T("有未保存的遮罩，关闭将丢弃")}</p>
        <button type="button" className="btn btn-sm" onClick={() => setConfirmOpen(false)}>{T("继续编辑")}</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onClose}>{T("丢弃并关闭")}</button>
      </div>
    </div>
  );
}
