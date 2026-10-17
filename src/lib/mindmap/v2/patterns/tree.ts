// 版式：大纲树（§15.3 默认版式；不加框）。参考实现之一——T6 新版式照此写法。
// 几何：父卡在左，子块纵向排在右侧（tidy tree 推广到「子块为任意矩形」）。
// 与原型的差异（稳定性优先，S7）：父卡与「第一个子块的锚点」中线对齐，而不是居中于全部子块——
// 这样任何子块变高只会把它后面的兄弟向下推，父卡与前面的兄弟不动；只有第一个子块的锚点下移时
// 父卡才随之下移（Δy ≥ 0）。居中对齐会让父卡与前面的兄弟在生长时上下漂移。
// 组内边：父 → 每个子的直角结构线（kind 'tree'；svg 层画「父右缘 → 中线 → 子左缘/框左缘」）。

import type { Block, BlockEdge, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const TREE = {
  /** 兄弟子块纵向间距 */
  GV: 20,
  /** 父卡右缘到子块左缘的水平距离（结构线走中间） */
  GX: 56,
} as const;

function layoutTree(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const X0 = header.w + TREE.GX;
  const ys: number[] = [];
  let y = 0;
  let maxW = 0;
  for (const b of kids) {
    ys.push(y);
    y += b.h + TREE.GV;
    if (b.w > maxW) maxW = b.w;
  }
  const first = kids[0];
  const mid0 = first.anchor.y + first.anchor.h / 2;
  const hy = ctx.g4(Math.max(0, mid0 - header.h / 2));
  const off = ctx.g4(Math.max(0, header.h / 2 - mid0));
  const places: Place[] = kids.map((b, i) => ({ id: b.id, x: X0, y: ys[i] + off }));
  const edges: BlockEdge[] = kids.map((b) => ({ kind: "tree", from: header.id, to: b.id }));
  return {
    w: X0 + maxW,
    h: Math.max(y - TREE.GV + off, hy + header.h),
    anchor: { x: 0, y: hy, w: header.w, h: header.h },
    items: [],
    places,
    edges,
  };
}

export const tree: PatternDef = { key: "tree", layout: layoutTree };
