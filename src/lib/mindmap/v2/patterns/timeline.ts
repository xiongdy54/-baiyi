// 版式：时间线（§15.3；叙事、沿革、事件序列）。
// 几何：子块沿水平轴**按原文顺序**（S1，不按时间排序）从左到右排列，置于轻框内。
// 轴线在 y=24；每个子块上方一个时间标签（node.timeText，date 装饰）与一个刻度（tick，对准子块锚点中线）。
// LOD「另有 N 项」排在末尾，不画标签/刻度。无组内边（轴线本身表达先后）。
// 生长方向（S7）：某子块变宽/变高只把它后面的兄弟向右推；框只向右/向下长。

import type { Block, BlockItem, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const TIMELINE = {
  /** 子块之间的水平间距 */
  GX: 24,
  /** 子块顶部（标签 + 轴所占高度） */
  TOP: 40,
  AXIS_Y: 24,
  DATE_H: 20,
} as const;

function layoutTimeline(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const { GX, TOP, AXIS_Y, DATE_H } = TIMELINE;
  const places: Place[] = [];
  const items: BlockItem[] = [];
  let x = 0;
  let bodyH = 0;
  for (const b of kids) {
    let cw = b.w;
    if (b.kind === "node") {
      const text = (b.node && b.node.timeText ? b.node.timeText : "").trim();
      if (text) {
        const dw = ctx.r4(ctx.textWidth(text, ctx.CARD.labelSize));
        if (dw > cw) cw = dw;
        items.push({ id: "DT:" + b.id, kind: "date", x, y: 0, w: cw, h: DATE_H, nid: b.id, text });
      }
      const tx = ctx.g4(x + b.anchor.x + b.anchor.w / 2) - 2;
      items.push({ id: "TK:" + b.id, kind: "tick", x: Math.max(0, tx), y: AXIS_Y - 4, w: 4, h: 8, nid: b.id });
    }
    places.push({ id: b.id, x, y: TOP });
    if (TOP + b.h > bodyH) bodyH = TOP + b.h;
    x += cw + GX;
  }
  const w = Math.max(0, x - GX);
  items.push({ id: "AX:" + header.id, kind: "axis", x: 0, y: AXIS_Y, w, h: 0, nid: header.id });
  return ctx.frame(header, { w, h: bodyH, items, places, edges: [] });
}

export const timeline: PatternDef = { key: "timeline", layout: layoutTimeline };
