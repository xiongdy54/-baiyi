// v49.30（D204）：生成产物——esbuild 打包 src/lib/lensWindowFit.ts（主进程与渲染层共用同一份 fit 几何）；禁止手改，
// 新鲜度由 tests/lensWindowFit.artifact.test.cjs 把守。

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

// src/lib/lensWindowFit.ts
var lensWindowFit_exports = {};
__export(lensWindowFit_exports, {
  LENS_FLOOR: () => LENS_FLOOR,
  LENS_MAX_RATIO: () => LENS_MAX_RATIO,
  LENS_MIN_H: () => LENS_MIN_H,
  LENS_MIN_W: () => LENS_MIN_W,
  LENS_PAD_BOTTOM: () => LENS_PAD_BOTTOM,
  LENS_PAD_SIDE: () => LENS_PAD_SIDE,
  LENS_PAD_TOP: () => LENS_PAD_TOP,
  LENS_PAD_X: () => LENS_PAD_X,
  LENS_SEED_H: () => LENS_SEED_H,
  LENS_SEED_W: () => LENS_SEED_W,
  chooseFocus: () => chooseFocus,
  chooseFocusBinary: () => chooseFocusBinary,
  computeFit: () => computeFit,
  fitScale: () => fitScale,
  lensLimits: () => lensLimits,
  tierOf: () => tierOf
});
module.exports = __toCommonJS(lensWindowFit_exports);
var LENS_PAD_X = 32;
var LENS_PAD_TOP = 32;
var LENS_PAD_BOTTOM = 16;
var LENS_PAD_SIDE = 16;
var LENS_MIN_W = 360;
var LENS_MIN_H = 160;
var LENS_MAX_RATIO = 0.92;
var LENS_FLOOR = 0.62;
var LENS_SEED_W = 360;
var LENS_SEED_H = 248;
var EPS = 1e-9;
var FIT_TOLERANCE = 1.5;
function lensLimits(workArea) {
  return {
    maxW: Math.max(LENS_MIN_W, Math.floor(workArea.width * LENS_MAX_RATIO)),
    maxH: Math.max(LENS_MIN_H, Math.floor(workArea.height * LENS_MAX_RATIO))
  };
}
function fitScale(content, workArea) {
  const { maxW, maxH } = lensLimits(workArea);
  return Math.min(
    1,
    (maxW - LENS_PAD_X) / Math.max(1, content.w),
    (maxH - LENS_PAD_TOP - LENS_PAD_BOTTOM) / Math.max(1, content.h)
  );
}
function tierOf(scale, mode) {
  if (mode === "focus") return "focus";
  if (mode === "all") return scale >= 1 - EPS ? "100%" : "all";
  if (scale >= 1 - EPS) return "100%";
  if (scale >= LENS_FLOOR - EPS) return "scaled";
  return "focus";
}
function windowSize(content, scale, workArea) {
  const { maxW, maxH } = lensLimits(workArea);
  return {
    width: Math.min(maxW, Math.max(LENS_MIN_W, Math.floor(content.w * scale + LENS_PAD_X + EPS))),
    height: Math.min(maxH, Math.max(LENS_MIN_H, Math.floor(content.h * scale + LENS_PAD_TOP + LENS_PAD_BOTTOM + EPS)))
  };
}
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var finite = (n) => typeof n === "number" && Number.isFinite(n);
var usableRect = (r) => !!r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height) && r.width > 0 && r.height > 0;
function computeFit(input) {
  const workArea = input.workArea;
  const content = { w: Math.max(1, Math.round(input.content?.w || 0)), h: Math.max(1, Math.round(input.content?.h || 0)) };
  const raw = fitScale(content, workArea);
  const scale = input.mode === "focus" ? Math.max(LENS_FLOOR, raw) : raw;
  const win = windowSize(content, scale, workArea);
  const anchor = input.anchor && finite(input.anchor.x) && finite(input.anchor.y) ? input.anchor : null;
  const view = input.current && finite(input.current.scale) && input.current.scale > 0 ? { scale: input.current.scale, offsetX: finite(input.current.offsetX) ? input.current.offsetX : 0, offsetY: finite(input.current.offsetY) ? input.current.offsetY : 0 } : { scale: 1, offsetX: 0, offsetY: 0 };
  const bounds = usableRect(input.bounds) ? input.bounds : null;
  let desiredX = Math.round(workArea.x + (workArea.width - win.width) / 2);
  let desiredY = Math.round(workArea.y + (workArea.height - win.height) / 2);
  let oldAnchor = null;
  let anchorCx = 0;
  let anchorCy = 0;
  if (anchor) {
    anchorCx = anchor.x + anchor.w / 2;
    anchorCy = anchor.y + anchor.h / 2;
  }
  const screenAnchor = input.anchorScreen && finite(input.anchorScreen.x) && finite(input.anchorScreen.y) ? { x: input.anchorScreen.x, y: input.anchorScreen.y } : null;
  if (anchor && screenAnchor) {
    oldAnchor = screenAnchor;
    desiredX = Math.round(screenAnchor.x - LENS_PAD_SIDE - anchorCx * scale);
    desiredY = Math.round(screenAnchor.y - LENS_PAD_TOP - anchorCy * scale);
  } else if (bounds && anchor) {
    oldAnchor = {
      x: bounds.x + view.offsetX + anchorCx * view.scale,
      y: bounds.y + view.offsetY + anchorCy * view.scale
    };
    desiredX = Math.round(oldAnchor.x - LENS_PAD_SIDE - anchorCx * scale);
    desiredY = Math.round(oldAnchor.y - LENS_PAD_TOP - anchorCy * scale);
  }
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = Math.max(minX, workArea.x + workArea.width - win.width);
  const maxY = Math.max(minY, workArea.y + workArea.height - win.height);
  const x = clamp(desiredX, minX, maxX);
  const y = clamp(desiredY, minY, maxY);
  const clamped = Math.abs(x - desiredX) > 0.5 || Math.abs(y - desiredY) > 0.5;
  const newAnchor = oldAnchor ? { x: x + LENS_PAD_SIDE + anchorCx * scale, y: y + LENS_PAD_TOP + anchorCy * scale } : null;
  const contentFits = content.w * scale + LENS_PAD_X <= win.width + FIT_TOLERANCE && content.h * scale + LENS_PAD_TOP + LENS_PAD_BOTTOM <= win.height + FIT_TOLERANCE;
  return {
    scale,
    bounds: { x, y, width: win.width, height: win.height },
    workArea: { ...workArea },
    clamped,
    tier: tierOf(raw, input.mode),
    contentFits,
    window: win,
    desired: { x: desiredX, y: desiredY },
    anchorDrift: oldAnchor && newAnchor ? Number(Math.hypot(newAnchor.x - oldAnchor.x, newAnchor.y - oldAnchor.y).toFixed(2)) : 0
  };
}
function chooseFocus(input) {
  const total = Math.max(1, Math.floor(input.total));
  const floor = finite(input.floor) ? input.floor : LENS_FLOOR;
  if (total <= 1) {
    const content2 = input.measure(1, 0);
    const s = fitScale(content2, input.workArea);
    return { n: 1, more: 0, content: content2, scale: Math.max(floor, s), fits: s >= floor - EPS };
  }
  for (let n = total - 1; n >= 1; n--) {
    const content2 = input.measure(n, total - n);
    const s = fitScale(content2, input.workArea);
    if (s >= floor - EPS) return { n, more: total - n, content: content2, scale: s, fits: true };
  }
  const content = input.measure(1, total - 1);
  return { n: 1, more: total - 1, content, scale: floor, fits: false };
}
function chooseFocusBinary(input) {
  const total = Math.max(1, Math.floor(input.total));
  const floor = finite(input.floor) ? input.floor : LENS_FLOOR;
  if (total <= 1) {
    const content = input.measure(1, 0);
    const s = fitScale(content, input.workArea);
    return { n: 1, more: 0, content, scale: Math.max(floor, s), fits: s >= floor - EPS };
  }
  const fits = (content) => fitScale(content, input.workArea) >= floor - EPS;
  const top = input.measure(total - 1, 1);
  if (fits(top)) return { n: total - 1, more: 1, content: top, scale: fitScale(top, input.workArea), fits: true };
  const one = input.measure(1, total - 1);
  if (!fits(one)) return { n: 1, more: total - 1, content: one, scale: floor, fits: false };
  let lo = 1;
  let loContent = one;
  let hi = total - 1;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    const content = input.measure(mid, total - mid);
    if (fits(content)) {
      lo = mid;
      loContent = content;
    } else {
      hi = mid;
    }
  }
  return { n: lo, more: total - lo, content: loContent, scale: fitScale(loContent, input.workArea), fits: true };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LENS_FLOOR,
  LENS_MAX_RATIO,
  LENS_MIN_H,
  LENS_MIN_W,
  LENS_PAD_BOTTOM,
  LENS_PAD_SIDE,
  LENS_PAD_TOP,
  LENS_PAD_X,
  LENS_SEED_H,
  LENS_SEED_W,
  chooseFocus,
  chooseFocusBinary,
  computeFit,
  fitScale,
  lensLimits,
  tierOf
});
