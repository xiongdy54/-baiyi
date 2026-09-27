// 批 4 Task 16（规格 §5.2）：文中角标的**共用画法**——阅读器（PDF/EPUB）与摘录卡面
// 三处宿主全覆盖，避免三份实现漂移。
//
// 两条**硬约束**（样张实测，实现时不得再犯，规格 §5.2 原文）：
//   ① **颜色一律内联 `style.fill`**——不得写 `rect{fill:…}` 这类 CSS 规则：
//      CSS **会盖掉元素的 `fill` 属性**，角标会恒为同一色（实测踩过：恒为 IKB 蓝）。
//   ② **位置按 `getClientRects()[0]`（首行片段）**——不得挂在 inline 高亮元素内部用
//      `position:absolute; right:0; top:0`：inline 包含块会把绝对定位子元素放到**联合包围盒**
//      右上角，跨行高亮实测偏 **259px**。
// 另：**重画一律「清空 + 全量重建」**，禁增量打补丁（曾出现"形态残留"）。
//
// 角标形状：8×8 直角方块 + 右上角**缺角**（形状而非字符）；纯高亮与整卡**不画**（规格 §5.4）。

/** 角标边长（--sp-2 ＝ 8px）；缺角边长 */
export const BADGE_SIZE = 8;
export const BADGE_CUT = 4;

export interface BadgeTarget {
  /** 首行片段的右缘与顶缘（视口坐标；由调用方按 getClientRects()[0] 取） */
  right: number;
  top: number;
  /** 实色（--annot-* 求值结果或 #hex）；角标必须跟随该高亮色 */
  color: string;
}

/**
 * 在给定 svg 里画一批角标。
 * @param svg  宿主覆盖层 SVG（必须是可被 `textContent = ""` 清空的那种纯绘制层）
 * @param host 覆盖层参照元素（用于把视口坐标换算成 svg 本地坐标）
 * @param targets 每个要画角标的位置与颜色（**调用方已按 §5.4 过滤**：纯高亮/整卡不传）
 * @param offset 坐标换算偏移（svg 与 host 同尺寸时传 {left, top}；默认取 host 的 bounding rect）
 */
export function drawBadges(
  svg: SVGSVGElement,
  host: Element,
  targets: BadgeTarget[],
  offset?: { left: number; top: number }
): void {
  // 幂等：清空 + 全量重建（禁增量补丁）
  svg.textContent = "";
  const hostRect = host.getBoundingClientRect();
  const ox = offset?.left ?? hostRect.left;
  const oy = offset?.top ?? hostRect.top;
  for (const t of targets) {
    const x = t.right - ox - BADGE_SIZE;
    const y = t.top - oy;
    const rect = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(BADGE_SIZE));
    rect.setAttribute("height", String(BADGE_SIZE));
    // 硬约束 ①：内联 style.fill（CSS 会盖掉 fill 属性）
    rect.style.fill = t.color;
    rect.setAttribute("data-badge", "1");
    svg.appendChild(rect);
    // 右上角缺角：用宿主底色的小三角"咬"掉一角（形状而非字符）
    const notch = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "polygon");
    notch.setAttribute(
      "points",
      `${x + BADGE_SIZE},${y} ${x + BADGE_SIZE},${y + BADGE_CUT} ${x + BADGE_SIZE - BADGE_CUT},${y}`
    );
    notch.style.fill = "var(--paper)";
    notch.setAttribute("data-badge-notch", "1");
    svg.appendChild(notch);
  }
}

/** 清空角标（与 drawBadges 同一处口径） */
export function clearBadges(svg: SVGSVGElement): void {
  svg.textContent = "";
}
