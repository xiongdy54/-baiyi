// 版式：网格（§15.3；并列、同级、彼此无关的一组项）。
// 几何：列数 ⌈√n⌉（n＝已摆放块数，含 LOD「另有 N 项」），格宽 = 最宽子块、格高 = 最高子块，等宽等高，原文顺序行优先；置于轻框内。
// 无组内边。生长方向（S7）：子块变大只会让格变大，后面的格向右/向下移动。

import type { Block, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const GRID = { GAP: 16 } as const;

function layoutGrid(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const n = kids.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  let cw = 0;
  let ch = 0;
  for (const b of kids) {
    if (b.w > cw) cw = b.w;
    if (b.h > ch) ch = b.h;
  }
  const places: Place[] = kids.map((b, i) => ({ id: b.id, x: (i % cols) * (cw + GRID.GAP), y: Math.floor(i / cols) * (ch + GRID.GAP) }));
  const rows = Math.ceil(n / cols);
  return ctx.frame(header, { w: cols * (cw + GRID.GAP) - GRID.GAP, h: rows * (ch + GRID.GAP) - GRID.GAP, items: [], places, edges: [] });
}

export const grid: PatternDef = { key: "grid", layout: layoutGrid };
