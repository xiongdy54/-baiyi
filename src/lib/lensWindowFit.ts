// 结构图纸片窗口 · 尺寸分级与落位纯几何（v49.29 / D203）。
//
// 窗口 = 图谱 layout bounds + 固定留白；留白不参与缩放：
//   sFit = min(1, (maxW - 32) / contentW, (maxH - 48) / contentH)
//   winW = clamp(floor(contentW * s + 32), 360, maxW)
//   winH = clamp(floor(contentH * s + 48), 160, maxH)
// 分级：s >= 1 → 100%；0.62 ≤ s < 1 → scaled；s < 0.62 → focus（渲染层先按 N 试排）；
//       all 是显式全图，允许 s < 0.62。聚焦的 s 恒 ≥ 0.62（极小工作区允许画布平移）。
// 落位：以锚点（阅读节点 / 当前选中节点）中心的屏幕位置为不变量反算原点；贴边即钳制并标记 clamped。
// 本模块零 DOM / 零 Electron，主进程与渲染层共用同一份算法。

export const LENS_PAD_X = 32;
export const LENS_PAD_TOP = 32;
export const LENS_PAD_BOTTOM = 16;
/** 左 / 右单侧留白（LENS_PAD_X 的一半；落位公式用单侧） */
export const LENS_PAD_SIDE = 16;
export const LENS_MIN_W = 360;
export const LENS_MIN_H = 160;
export const LENS_MAX_RATIO = 0.92;
export const LENS_FLOOR = 0.62;
export const LENS_SEED_W = 360;
export const LENS_SEED_H = 248;

const EPS = 1e-9;
const FIT_TOLERANCE = 1.5;

export type FitMode = "fit" | "focus" | "all";
export type FitTier = "100%" | "scaled" | "focus" | "all";

export interface LensSize {
  w: number;
  h: number;
}

export interface LensRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 锚点矩形（内容坐标，100% 比例下，不含留白） */
export interface LensAnchor {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 当前画布视图：内容坐标 → 窗口局部坐标 = offset + content * scale */
export interface LensView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface LensFitInput {
  content: LensSize;
  workArea: LensRect;
  mode: FitMode;
  anchor?: LensAnchor | null;
  current?: LensView | null;
  /** 当前窗口 bounds（窗口坐标＝DIP）。省略＝在工作区居中。 */
  bounds?: LensRect | null;
  /**
   * D204：被点击节点中心在**旧布局**下的屏幕 DIP 位置。提供时优先用它反算新原点，
   * 保证展开/收起后该节点屏幕位置不动（用新布局的 anchor 矩形 × 新比例）。
   */
  anchorScreen?: { x: number; y: number } | null;
}

export interface LensFitResult {
  scale: number;
  bounds: LensRect;
  workArea: LensRect;
  /** 原点因贴边被钳制（锚点漂移可能 > 8px；调用方应据此标注「边缘钳制」） */
  clamped: boolean;
  tier: FitTier;
  /** 内容 × s + 留白是否装得进窗口。focus 在极小工作区可能为 false（允许画布平移）。 */
  contentFits: boolean;
  /** 目标窗口尺寸（未落位前；bounds.width/height 同值） */
  window: { width: number; height: number };
  /** 未钳制前的期望原点（诊断 / 锚点漂移计算） */
  desired: { x: number; y: number };
  /** 锚点中心的实际漂移（像素；无 bounds/anchor 时为 0） */
  anchorDrift: number;
}

export interface FocusChoice {
  n: number;
  more: number;
  content: LensSize;
  scale: number;
  /** 是否找到 s ≥ 0.62 的 N（false＝N=1 仍放不下，按 0.62 渲染并允许平移） */
  fits: boolean;
}

export function lensLimits(workArea: LensRect): { maxW: number; maxH: number } {
  return {
    maxW: Math.max(LENS_MIN_W, Math.floor(workArea.width * LENS_MAX_RATIO)),
    maxH: Math.max(LENS_MIN_H, Math.floor(workArea.height * LENS_MAX_RATIO)),
  };
}

/** 内容（100%）在给定工作区里能放下的最大比例（≤ 1，不受 0.62 可读下限约束） */
export function fitScale(content: LensSize, workArea: LensRect): number {
  const { maxW, maxH } = lensLimits(workArea);
  return Math.min(
    1,
    (maxW - LENS_PAD_X) / Math.max(1, content.w),
    (maxH - LENS_PAD_TOP - LENS_PAD_BOTTOM) / Math.max(1, content.h),
  );
}

export function tierOf(scale: number, mode: FitMode): FitTier {
  if (mode === "focus") return "focus";
  if (mode === "all") return scale >= 1 - EPS ? "100%" : "all";
  if (scale >= 1 - EPS) return "100%";
  if (scale >= LENS_FLOOR - EPS) return "scaled";
  return "focus";
}

function windowSize(content: LensSize, scale: number, workArea: LensRect): { width: number; height: number } {
  const { maxW, maxH } = lensLimits(workArea);
  return {
    width: Math.min(maxW, Math.max(LENS_MIN_W, Math.floor(content.w * scale + LENS_PAD_X + EPS))),
    height: Math.min(maxH, Math.max(LENS_MIN_H, Math.floor(content.h * scale + LENS_PAD_TOP + LENS_PAD_BOTTOM + EPS))),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const usableRect = (r: LensRect | null | undefined): r is LensRect =>
  !!r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height) && r.width > 0 && r.height > 0;

/**
 * 计算一次纸张窗口的缩放与 bounds。
 *
 * mode：
 *   · fit   —— 内容完整放下的比例；若 tier === "focus"，说明完整内容已低于可读下限，
 *              渲染层应先派生聚焦视图再发 mode:"focus"（主进程不应把这次结果直接落窗）。
 *   · focus —— 已聚焦的内容；s 强制 ≥ 0.62，放不下时窗口钳到工作区上限并允许画布平移。
 *   · all   —— 显式全图；允许 s < 0.62，窗口仍不超过 92% 工作区。
 */
export function computeFit(input: LensFitInput): LensFitResult {
  const workArea = input.workArea;
  const content = { w: Math.max(1, Math.round(input.content?.w || 0)), h: Math.max(1, Math.round(input.content?.h || 0)) };
  const raw = fitScale(content, workArea);
  const scale = input.mode === "focus" ? Math.max(LENS_FLOOR, raw) : raw;
  const win = windowSize(content, scale, workArea);

  const anchor = input.anchor && finite(input.anchor.x) && finite(input.anchor.y) ? input.anchor : null;
  const view = input.current && finite(input.current.scale) && input.current.scale > 0
    ? { scale: input.current.scale, offsetX: finite(input.current.offsetX) ? input.current.offsetX : 0, offsetY: finite(input.current.offsetY) ? input.current.offsetY : 0 }
    : { scale: 1, offsetX: 0, offsetY: 0 };
  const bounds = usableRect(input.bounds) ? input.bounds : null;

  let desiredX = Math.round(workArea.x + (workArea.width - win.width) / 2);
  let desiredY = Math.round(workArea.y + (workArea.height - win.height) / 2);
  let oldAnchor: { x: number; y: number } | null = null;
  let anchorCx = 0;
  let anchorCy = 0;
  if (anchor) {
    anchorCx = anchor.x + anchor.w / 2;
    anchorCy = anchor.y + anchor.h / 2;
  }
  const screenAnchor = input.anchorScreen && finite(input.anchorScreen.x) && finite(input.anchorScreen.y)
    ? { x: input.anchorScreen.x, y: input.anchorScreen.y }
    : null;
  if (anchor && screenAnchor) {
    // D204：旧屏幕位置由渲染层在改布局之前给出，主进程只用它 + 新布局矩形/新比例反算原点。
    oldAnchor = screenAnchor;
    desiredX = Math.round(screenAnchor.x - LENS_PAD_SIDE - anchorCx * scale);
    desiredY = Math.round(screenAnchor.y - LENS_PAD_TOP - anchorCy * scale);
  } else if (bounds && anchor) {
    oldAnchor = {
      x: bounds.x + view.offsetX + anchorCx * view.scale,
      y: bounds.y + view.offsetY + anchorCy * view.scale,
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
  // 漂移必须按**钳制后的实际原点**算：贴边时窗口被拉回工作区，锚点也就真的移了
  const newAnchor = oldAnchor
    ? { x: x + LENS_PAD_SIDE + anchorCx * scale, y: y + LENS_PAD_TOP + anchorCy * scale }
    : null;

  const contentFits =
    content.w * scale + LENS_PAD_X <= win.width + FIT_TOLERANCE &&
    content.h * scale + LENS_PAD_TOP + LENS_PAD_BOTTOM <= win.height + FIT_TOLERANCE;

  return {
    scale,
    bounds: { x, y, width: win.width, height: win.height },
    workArea: { ...workArea },
    clamped,
    tier: tierOf(raw, input.mode),
    contentFits,
    window: win,
    desired: { x: desiredX, y: desiredY },
    anchorDrift:
      oldAnchor && newAnchor
        ? Number(Math.hypot(newAnchor.x - oldAnchor.x, newAnchor.y - oldAnchor.y).toFixed(2))
        : 0,
  };
}

/**
 * 聚焦档：从「全部 − 1」往下试，取第一个按 ≥ 0.62 放得下的 N；
 * N 个子项 + 一张合成的「另有 N 项」卡。N=1 仍放不下时按 0.62 兜底（fits=false）。
 * measure 由渲染层提供（用真实 layout bounds 量 n 个子项 + more 卡）。
 * （C-32 A3 起渲染层改用 chooseFocusBinary——本函数保留作等价性测试的线性基准与回退实现。）
 */
export function chooseFocus(input: {
  total: number;
  measure: (visible: number, more: number) => LensSize;
  workArea: LensRect;
  floor?: number;
}): FocusChoice {
  const total = Math.max(1, Math.floor(input.total));
  const floor = finite(input.floor) ? input.floor : LENS_FLOOR;
  if (total <= 1) {
    const content = input.measure(1, 0);
    const s = fitScale(content, input.workArea);
    return { n: 1, more: 0, content, scale: Math.max(floor, s), fits: s >= floor - EPS };
  }
  for (let n = total - 1; n >= 1; n--) {
    const content = input.measure(n, total - n);
    const s = fitScale(content, input.workArea);
    if (s >= floor - EPS) return { n, more: total - n, content, scale: s, fits: true };
  }
  const content = input.measure(1, total - 1);
  return { n: 1, more: total - 1, content, scale: floor, fits: false };
}

/**
 * 聚焦档二分查找（审计 C-32 A3）：内容尺寸随 n 单调不减 ⇒ fitScale 随 n 单调不增 ⇒「放得下」是单调谓词，
 * 线性递减扫描（chooseFocus）可换成二分。测量次数：最好 1（top 直接放得下）、最坏 2 + ⌈log2(total−2)⌉。
 * 合入前置＝与 chooseFocus 的结果完全一致（n / more / content / fits / scale）；等价性测试在
 * tests/lensWindowFit.binary.test.cjs（现有 12 卡样张 + 50 张随机树的真实 layoutGraph 量测），任何不一致
 * 就保留线性版本并回报。
 */
export function chooseFocusBinary(input: {
  total: number;
  measure: (visible: number, more: number) => LensSize;
  workArea: LensRect;
  floor?: number;
}): FocusChoice {
  const total = Math.max(1, Math.floor(input.total));
  const floor = finite(input.floor) ? input.floor : LENS_FLOOR;
  if (total <= 1) {
    const content = input.measure(1, 0);
    const s = fitScale(content, input.workArea);
    return { n: 1, more: 0, content, scale: Math.max(floor, s), fits: s >= floor - EPS };
  }
  const fits = (content: LensSize) => fitScale(content, input.workArea) >= floor - EPS;
  // 快路径①：最多子项直接放得下（边界贴近 total 时线性本就只测一次）
  const top = input.measure(total - 1, 1);
  if (fits(top)) return { n: total - 1, more: 1, content: top, scale: fitScale(top, input.workArea), fits: true };
  // 快路径②：仅 1 项也放不下 → 与线性同款兜底
  const one = input.measure(1, total - 1);
  if (!fits(one)) return { n: 1, more: total - 1, content: one, scale: floor, fits: false };
  // 不变式：fits(1)=true、fits(total−1)=false → 边界 ∈ [1, total−2]；lo 恒 fits、hi 恒不 fits
  let lo = 1;
  let loContent = one;
  let hi = total - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
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
