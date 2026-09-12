"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/occlusion.ts
var occlusion_exports = {};
__export(occlusion_exports, {
  clampPct: () => clampPct,
  isShapeUsable: () => isShapeUsable,
  normalizeShape: () => normalizeShape,
  occlusionShapes: () => occlusionShapes,
  pxShapeToPct: () => pxShapeToPct,
  shapeBBox: () => shapeBBox,
  shapeToSvg: () => shapeToSvg,
  shapesFromRects: () => shapesFromRects
});
module.exports = __toCommonJS(occlusion_exports);
var clampPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};
var round1 = (v) => Math.round(v * 10) / 10;
function shapeBBox(shape) {
  if (shape.kind === "ellipse") {
    const cx = clampPct(shape.cx);
    const cy = clampPct(shape.cy);
    const rx = Math.max(0, Number(shape.rx) || 0);
    const ry = Math.max(0, Number(shape.ry) || 0);
    const x2 = Math.max(0, cx - rx);
    const y2 = Math.max(0, cy - ry);
    return {
      x: round1(x2),
      y: round1(y2),
      w: round1(Math.min(100 - x2, rx * 2)),
      h: round1(Math.min(100 - y2, ry * 2))
    };
  }
  if (shape.kind === "polygon") {
    const pts = shape.points ?? [];
    if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = pts.map((p) => clampPct(p.x));
    const ys = pts.map((p) => clampPct(p.y));
    const x2 = Math.min(...xs);
    const y2 = Math.min(...ys);
    return { x: round1(x2), y: round1(y2), w: round1(Math.max(...xs) - x2), h: round1(Math.max(...ys) - y2) };
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
function isShapeUsable(shape) {
  if (shape.kind === "polygon") {
    const pts = shape.points ?? [];
    if (pts.length < 3) return false;
    const b2 = shapeBBox(shape);
    return b2.w >= 1 && b2.h >= 1;
  }
  const b = shapeBBox(shape);
  return b.w >= 1 && b.h >= 1;
}
function normalizeShape(shape) {
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
function pxShapeToPct(shape, dispW, dispH, ord = 0) {
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
function shapeToSvg(shape) {
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
function shapesFromRects(rects) {
  return (rects ?? []).map((raw, i) => {
    const r = raw ?? {};
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
function occlusionShapes(occlusion) {
  if (!occlusion) return [];
  const shapes = (occlusion.shapes ?? []).filter((s) => Boolean(s && s.kind));
  if (shapes.length > 0) return shapes;
  return shapesFromRects(occlusion.rects ?? []);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clampPct,
  isShapeUsable,
  normalizeShape,
  occlusionShapes,
  pxShapeToPct,
  shapeBBox,
  shapeToSvg,
  shapesFromRects
});
