// 浮层放置（批 4 Task 8，规格 §3.1）：MarkPopover（批 3）与 SelectionMenu、AnnotationEditor
// 三处共用**同一份**实现——先渲染在视口外一帧 → useLayoutEffect 实测尺寸 → 这里算位置。
//
// 纯函数，零 DOM：输入锚点/容器/浮层尺寸，输出 {left, top, placement}（均为视口坐标，
// 因为浮层一律 position: fixed）。判据＝规格 §3.2 四条：
//   1) 菜单矩形不得与选区包围盒相交（不得盖住选中文字）；
//   2) 整体在容器内（含 8px 边距）；
//   3) 选区在容器上半 → 下方；下半 → 上方；
//   4) 定位锚点＝选区包围盒，不是 pointerup 坐标。

/** 视口留白：与 8px 网格同档（--sp-2），浮层不贴边 */
export const POPOVER_MARGIN = 8;

export interface PopoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopoverPlaceResult {
  left: number;
  top: number;
  /** 实际落位：below=锚点下方，above=锚点上方 */
  placement: "above" | "below";
}

export function placePopover({
  anchor,
  container,
  size,
  prefer = "auto"
}: {
  /** 锚点包围盒（视口坐标；用选区/标记的包围盒，不用 pointerup 点） */
  anchor: PopoverRect;
  /** 可用容器（视口坐标）；缺省＝整个视口 */
  container?: PopoverRect | null;
  /** 浮层实测尺寸 */
  size: { width: number; height: number };
  /** above=强制上方 / below=强制下方 / auto=按锚点在容器上或下半自动翻转 */
  prefer?: "above" | "below" | "auto";
}): PopoverPlaceResult {
  const box = container ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const m = POPOVER_MARGIN;
  const minLeft = box.x + m;
  const maxRight = box.x + box.width - m;
  const minTop = box.y + m;
  const maxBottom = box.y + box.height - m;

  // 左右：先按锚点左缘对齐，再夹进容器
  const left = Math.max(minLeft, Math.min(maxRight - size.width, anchor.x));

  // 上下：auto 判据＝锚点中心在容器中线之上 → below（菜单在选区下方）
  const anchorCenterY = anchor.y + anchor.height / 2;
  const containerMid = box.y + box.height / 2;
  let placement: "above" | "below" =
    prefer === "auto" ? (anchorCenterY < containerMid ? "below" : "above") : prefer;

  const belowTop = anchor.y + anchor.height + m;
  const aboveTop = anchor.y - size.height - m;
  const fitsBelow = belowTop + size.height <= maxBottom;
  const fitsAbove = aboveTop >= minTop;

  let top = placement === "below" ? belowTop : aboveTop;
  // 首选侧放不下 → 翻到另一侧；两侧都放不下 → 夹进容器
  if (placement === "below" && !fitsBelow) {
    if (fitsAbove) {
      placement = "above";
      top = aboveTop;
    } else {
      top = Math.max(minTop, Math.min(maxBottom - size.height, belowTop));
    }
  } else if (placement === "above" && !fitsAbove) {
    if (fitsBelow) {
      placement = "below";
      top = belowTop;
    } else {
      top = Math.max(minTop, Math.min(maxBottom - size.height, aboveTop));
    }
  }

  return { left, top, placement };
}
