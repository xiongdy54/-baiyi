// 图片挖空区域几何（v25，M5/图片点选聚焦批次）：正文图片点选后由用户手绘区域，
// 支持矩形 / 椭圆（圆形选区）/ 多边形（多点连线）三类形状。
// 坐标系契约：对外（落库 occlusion_json、lint、复习渲染）一律为**相对图片尺寸的百分比 0-100**；
// 像素坐标只存在于选区交互期（ImageFocus 覆盖层内），由 pxShapeToPct 一次性换算。
// 形状与 rects 的关系：rects 恒为形状的包围盒（向下兼容旧渲染与 L11 校验），shapes 提供精确轮廓。

export type OcclusionShapeKind = "rect" | "ellipse" | "polygon";

export interface OcclusionPoint {
  x: number;
  y: number;
}

/** 落库形状（百分比坐标；字段按 kind 取用，JSON 友好——与既有 rects 的扁平风格一致） */
export interface OcclusionShape {
  ord: number;
  kind: OcclusionShapeKind;
  /** kind=rect */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** kind=ellipse：中心 + 半轴 */
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  /** kind=polygon：顶点序列（顺序即连线顺序） */
  points?: OcclusionPoint[];
}

export interface OcclusionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clampPct = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 形状包围盒（百分比；即写入 rects 的值）。多边形/椭圆按几何极值计算 */
export function shapeBBox(shape: OcclusionShape): OcclusionRect {
  if (shape.kind === "ellipse") {
    const cx = clampPct(shape.cx);
    const cy = clampPct(shape.cy);
    const rx = Math.max(0, Number(shape.rx) || 0);
    const ry = Math.max(0, Number(shape.ry) || 0);
    const x = Math.max(0, cx - rx);
    const y = Math.max(0, cy - ry);
    return {
      x: round1(x),
      y: round1(y),
      w: round1(Math.min(100 - x, rx * 2)),
      h: round1(Math.min(100 - y, ry * 2))
    };
  }
  if (shape.kind === "polygon") {
    const pts = shape.points ?? [];
    if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = pts.map((p) => clampPct(p.x));
    const ys = pts.map((p) => clampPct(p.y));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x: round1(x), y: round1(y), w: round1(Math.max(...xs) - x), h: round1(Math.max(...ys) - y) };
  }
  const x = clampPct(shape.x);
  const y = clampPct(shape.y);
  return {
    x: round1(x),
    y: round1(y),
    w: round1(Math.max(0, Math.min(100 - x, Number(shape.w) || 0))),
    h: round1(Math.max(0, Math.min(100 - y, Number(shape.h) || 0)))
  };
}

/** 形状是否可用（选区提交前置校验：杜绝零面积/退化的遮挡块导致卡片不可见） */
export function isShapeUsable(shape: OcclusionShape): boolean {
  if (shape.kind === "polygon") {
    const pts = shape.points ?? [];
    if (pts.length < 3) return false;
    const b = shapeBBox(shape);
    return b.w >= 1 && b.h >= 1;
  }
  const b = shapeBBox(shape);
  return b.w >= 1 && b.h >= 1;
}

/** 归一化（钳制越界、保留 1 位小数）：落库前的最后一道闸 */
export function normalizeShape(shape: OcclusionShape): OcclusionShape {
  if (shape.kind === "polygon") {
    return {
      ord: shape.ord,
      kind: "polygon",
      points: (shape.points ?? []).map((p) => ({ x: round1(clampPct(p.x)), y: round1(clampPct(p.y)) }))
    };
  }
  if (shape.kind === "ellipse") {
    const cx = clampPct(shape.cx);
    const cy = clampPct(shape.cy);
    return {
      ord: shape.ord,
      kind: "ellipse",
      cx: round1(cx),
      cy: round1(cy),
      // 半轴上限 = 中心到最近边界的距离（椭圆整体必须留在画面内）
      rx: round1(Math.max(0, Math.min(Math.min(cx, 100 - cx), Math.abs(Number(shape.rx) || 0)))),
      ry: round1(Math.max(0, Math.min(Math.min(cy, 100 - cy), Math.abs(Number(shape.ry) || 0))))
    };
  }
  return { ord: shape.ord, kind: "rect", ...shapeBBox(shape) };
}

// ---------- 像素 ↔ 百分比（选区交互层与几何层之间的唯一换算口） ----------

/** 选区交互层用的像素形状（坐标系 = 图片在屏幕上的显示框） */
export type PixelShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: OcclusionPoint[] };

/** 像素形状 → 百分比形状（dispW/dispH = 图片显示尺寸；结果已钳制） */
export function pxShapeToPct(shape: PixelShape, dispW: number, dispH: number, ord = 0): OcclusionShape {
  const sx = dispW > 0 ? 100 / dispW : 0;
  const sy = dispH > 0 ? 100 / dispH : 0;
  if (shape.kind === "polygon") {
    return normalizeShape({
      ord,
      kind: "polygon",
      points: shape.points.map((p) => ({ x: p.x * sx, y: p.y * sy }))
    });
  }
  if (shape.kind === "ellipse") {
    return normalizeShape({
      ord,
      kind: "ellipse",
      cx: shape.cx * sx,
      cy: shape.cy * sy,
      rx: Math.abs(shape.rx) * sx,
      ry: Math.abs(shape.ry) * sy
    });
  }
  const x = Math.min(shape.x, shape.x + shape.w);
  const y = Math.min(shape.y, shape.y + shape.h);
  return normalizeShape({
    ord,
    kind: "rect",
    x: x * sx,
    y: y * sy,
    w: Math.abs(shape.w) * sx,
    h: Math.abs(shape.h) * sy
  });
}

/** 形状 → SVG 图元描述（复习端/预览端共用的渲染口径；viewBox="0 0 100 100" + preserveAspectRatio="none"） */
export function shapeToSvg(shape: OcclusionShape): { tag: string; attrs: Record<string, string | number> } {
  const b = shapeBBox(shape);
  if (shape.kind === "ellipse") {
    return {
      tag: "ellipse",
      attrs: {
        cx: clampPct(shape.cx),
        cy: clampPct(shape.cy),
        rx: Math.max(0, Number(shape.rx) || 0),
        ry: Math.max(0, Number(shape.ry) || 0)
      }
    };
  }
  if (shape.kind === "polygon") {
    return {
      tag: "polygon",
      attrs: {
        points: (shape.points ?? []).map((p) => `${round1(clampPct(p.x))},${round1(clampPct(p.y))}`).join(" ")
      }
    };
  }
  return { tag: "rect", attrs: { x: b.x, y: b.y, width: b.w, height: b.h } };
}

/** 从旧数据（只有 rects）补出形状：存量遮挡卡渲染走同一条路径（rects 为宽松 JSON，逐项数值化） */
export function shapesFromRects(rects: unknown[]): OcclusionShape[] {
  return (rects ?? []).map((raw, i) => {
    const r = (raw ?? {}) as { x?: unknown; y?: unknown; w?: unknown; h?: unknown; ord?: unknown };
    const ord = Number(r.ord);
    return normalizeShape({
      ord: Number.isFinite(ord) ? ord : i,
      kind: "rect",
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      w: Number(r.w) || 0,
      h: Number(r.h) || 0
    });
  });
}

/** 卡片遮挡区域 → 形状列表（shapes 优先；仅有 rects 的存量卡自动降级为矩形形状） */
export function occlusionShapes(occlusion: {
  rects?: unknown[];
  shapes?: (OcclusionShape | null | undefined)[] | null;
} | null): OcclusionShape[] {
  if (!occlusion) return [];
  const shapes = (occlusion.shapes ?? []).filter((s): s is OcclusionShape => Boolean(s && s.kind));
  if (shapes.length > 0) return shapes;
  return shapesFromRects(occlusion.rects ?? []);
}
