// 正文图片点选聚焦（v25）：点击阅读材料中的图片 → 图片上浮居中、周围区域模糊聚焦视线；
// 顶部居中悬浮工具条提供三类区域选区（矩形 / 圆形 / 多点连线多边形），选区可提交 AI 制卡或手动制卡。
// 坐标系：选区状态一律以**相对图片的百分比**保存（与 occlusion_json 同口径），
// 仅在读取指针位置时做像素→百分比换算——落库/渲染/校验共用同一套百分比语义。
// 交互约定：点击模糊区域（图片外）退出聚焦；Esc 先清选区、无选区时退出；多边形点回起点闭合（≥3 点）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  clampPct,
  isShapeUsable,
  normalizeShape,
  shapeBBox,
  shapeToSvg,
  type OcclusionRect,
  type OcclusionShape,
  type OcclusionPoint
} from "../../lib/occlusion";

type Tool = "rect" | "ellipse" | "polygon";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "rect", label: "矩形选区", hint: "按住拖动框出矩形区域" },
  { id: "ellipse", label: "圆形选区", hint: "从圆心按住向外拖动，画出椭圆/圆形" },
  { id: "polygon", label: "多点连线选区", hint: "点击确定起点，继续点击连线，≥3 点后点回起点闭合" }
];

const CLOSE_HIT_PX = 12;

export interface ImageFocusSubmit {
  shape: OcclusionShape;
  bbox: OcclusionRect;
}

interface Props {
  image: { src: string; dataUrl: string; alt?: string };
  /** 原图在阅读器视口中的显示框（上浮动画起点；宽高用视口语义的 width/height） */
  origin: { x: number; y: number; width: number; height: number };
  busy?: boolean;
  onClose: () => void;
  onSubmit: (kind: "ai" | "manual", payload: ImageFocusSubmit) => void;
}

export default function ImageFocus({ image, origin, busy, onClose, onSubmit }: Props) {
  const [tool, setTool] = useState<Tool>("rect");
  const [shape, setShape] = useState<OcclusionShape | null>(null);
  const [draft, setDraft] = useState<OcclusionShape | null>(null);
  const [hover, setHover] = useState<OcclusionPoint | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // 小图放大：书里的插图常见只有一两百像素宽，原尺寸下无法精确框选——
  // 显示宽度下限 480px（最多放大 4 倍，保持纵横比）；百分比坐标与显示尺寸解耦，不影响落库数据
  const [displayWidth, setDisplayWidth] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  const [flyOrigin, setFlyOrigin] = useState<{ dx: number; dy: number; sx: number; sy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // 绘制中的选区用 ref 同步持有：pointerdown/move/up 可能落在同一批次（合成事件、极快拖拽），
  // 只读 state 会拿到过期闭包里的 null，导致抬手时选区被丢弃
  const draftRef = useRef<OcclusionShape | null>(null);
  const setDraftBoth = (next: OcclusionShape | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  // 显示框尺寸（百分比↔像素换算与多边形闭合判定用）
  useLayoutEffect(() => {
    const el = imgBoxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 上浮动画：从阅读器中的原位置飞入居中位置（FLIP）
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) {
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
  }, [origin]);

  const visible = draft ?? shape;

  const toPct = useCallback(
    (e: { clientX: number; clientY: number }): OcclusionPoint => {
      const box = imgBoxRef.current;
      if (!box) return { x: 0, y: 0 };
      const r = box.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
      return {
        x: clampPct(((e.clientX - r.left) / r.width) * 100),
        y: clampPct(((e.clientY - r.top) / r.height) * 100)
      };
    },
    []
  );

  const usable = useMemo(() => {
    if (!shape || !isShapeUsable(shape)) return false;
    const b = shapeBBox(shape);
    // 尺寸未测得时（图片尚未完成布局）以百分比门槛为准，避免误禁提交
    if (size.w <= 0 || size.h <= 0) return true;
    return (b.w / 100) * size.w >= 4 && (b.h / 100) * size.h >= 4;
  }, [shape, size]);

  const resetSelection = useCallback(() => {
    setShape(null);
    setDraftBoth(null);
    setHover(null);
    draggingRef.current = false;
  }, []);

  const switchTool = (t: Tool) => {
    setTool(t);
    resetSelection();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (draft || shape) resetSelection();
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft, shape, resetSelection, onClose]);

  // ---------- 指针交互：矩形/椭圆=按下拖动；多边形=逐点点击、点回起点闭合 ----------
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "polygon" || busy) return;
    const p = toPct(e);
    if (tool === "rect") setDraftBoth({ kind: "rect", ord: 0, x: p.x, y: p.y, w: 0, h: 0 });
    else setDraftBoth({ kind: "ellipse", ord: 0, cx: p.x, cy: p.y, rx: 0, ry: 0 });
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件/无指针环境（测试注入）下忽略 */
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toPct(e);
    if (tool === "polygon") {
      setHover(p);
      return;
    }
    if (!draggingRef.current) return;
    const d = draftRef.current;
    if (!d) return;
    if (d.kind === "rect") setDraftBoth({ ...d, w: p.x - (d.x ?? 0), h: p.y - (d.y ?? 0) });
    else if (d.kind === "ellipse") setDraftBoth({ ...d, rx: p.x - (d.cx ?? 0), ry: p.y - (d.cy ?? 0) });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const d = draftRef.current;
    if (!d) return;
    // 以抬手位置收尾：不依赖中间 move 事件（极快拖拽或合成事件可能一个 move 都没派发）
    const p = toPct(e);
    const finalized: OcclusionShape =
      d.kind === "rect"
        ? { ...d, w: p.x - (d.x ?? 0), h: p.y - (d.y ?? 0) }
        : d.kind === "ellipse"
          ? { ...d, rx: p.x - (d.cx ?? 0), ry: p.y - (d.cy ?? 0) }
          : d;
    const normalized = normalizeShape(finalized);
    setDraftBoth(null);
    setShape(isShapeUsable(normalized) ? normalized : null);
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon" || busy) return;
    const p = toPct(e);
    const current = draftRef.current;
    const pts = current?.kind === "polygon" ? current.points ?? [] : [];
    if (pts.length >= 3) {
      const first = pts[0];
      const dx = ((p.x - first.x) / 100) * size.w;
      const dy = ((p.y - first.y) / 100) * size.h;
      if (Math.hypot(dx, dy) <= CLOSE_HIT_PX) {
        const closed = normalizeShape({ kind: "polygon", ord: 0, points: pts });
        setDraftBoth(null);
        setHover(null);
        setShape(closed);
        return;
      }
    }
    setDraftBoth({ kind: "polygon", ord: 0, points: [...pts, p] });
  };

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? "";

  return (
    <div
      className={`image-focus-layer${entered ? " image-focus-in" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="图片聚焦选区"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="image-focus-toolbar" role="toolbar" aria-label="选区工具">
        <div className="image-focus-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`image-focus-tool${tool === t.id ? " active" : ""}`}
              aria-pressed={tool === t.id}
              onClick={() => switchTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="image-focus-hint">{activeHint}</span>
        <div className="image-focus-actions">
          {(shape || draft) && (
            <button type="button" className="btn btn-outline btn-sm" onClick={resetSelection}>
              清除选区
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={!usable || busy}
            onClick={() => shape && onSubmit("ai", { shape, bbox: shapeBBox(shape) })}
          >
            AI 制卡
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!usable || busy}
            onClick={() => shape && onSubmit("manual", { shape, bbox: shapeBBox(shape) })}
          >
            手动制卡
          </button>
        </div>
      </div>

      <div className="image-focus-stage" ref={stageRef} style={!entered && flyOrigin ? {
        transform: `translate(${flyOrigin.dx}px, ${flyOrigin.dy}px) scale(${flyOrigin.sx}, ${flyOrigin.sy})`,
        opacity: 0.35
      } : undefined}>
        <div className="image-focus-imgbox" ref={imgBoxRef}>
          <img
            src={image.dataUrl || image.src}
            alt={image.alt || ""}
            draggable={false}
            style={displayWidth ? { width: `${displayWidth}px`, height: "auto" } : undefined}
            onLoad={(e) => {
              const el = e.currentTarget;
              const nw = el.naturalWidth;
              if (!nw) return;
              const minW = 480;
              if (nw < minW) setDisplayWidth(Math.round(nw * Math.min(4, minW / nw)));
            }}
          />
          <svg
            className={`image-focus-canvas tool-${tool}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              // 指针移出画布且未抬手：放弃本次草稿（避免留下悬空预览）
              if (draggingRef.current) {
                draggingRef.current = false;
                setDraftBoth(null);
              }
              setHover(null);
            }}
            onClick={onSvgClick}
          >
            {visible && (
              <RenderShape shape={visible} className={draft ? "occlusion-shape drafts" : "occlusion-shape occlusion-exam"} />
            )}
            {tool === "polygon" && draft?.kind === "polygon" && hover && (
              <line
                className="occlusion-rubber"
                x1={(draft.points ?? [])[((draft.points ?? []).length) - 1]?.x ?? 0}
                y1={(draft.points ?? [])[((draft.points ?? []).length) - 1]?.y ?? 0}
                x2={hover.x}
                y2={hover.y}
              />
            )}
            {tool === "polygon" &&
              (draft?.points ?? []).map((p, i) => (
                <circle key={i} className={`occlusion-vertex${i === 0 ? " first" : ""}`} cx={p.x} cy={p.y} r={1.6} />
              ))}
          </svg>
        </div>
        {image.alt && <p className="image-focus-caption">{image.alt}</p>}
      </div>

      <button type="button" className="image-focus-close" title="退出聚焦（Esc）" aria-label="退出聚焦" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}

/** 百分比形状 → SVG 图元渲染（viewBox 0 0 100 100 + preserveAspectRatio=none，与复习端渲染同口径） */
function RenderShape({ shape, className }: { shape: OcclusionShape; className: string }) {
  const { tag, attrs } = shapeToSvg(shape);
  const common = { className, vectorEffect: "non-scaling-stroke" as const };
  if (tag === "ellipse") return <ellipse {...(attrs as object)} {...common} />;
  if (tag === "polygon") return <polygon {...(attrs as object)} {...common} />;
  return <rect {...(attrs as object)} {...common} />;
}
