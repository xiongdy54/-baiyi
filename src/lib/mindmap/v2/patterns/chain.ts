// 版式：链（§15.3；步骤、推导、递进）。参考实现之二——演示「加框」版式的写法。
// 几何：子块纵向串联、左对齐，置于轻框内；框头＝父卡片（ctx.frame 负责框、框头与「版式 · 来源」标注）。
// 组内边：相邻子之间的先后箭头（kind 'seq'）；LOD「另有 N 项」不参与先后线。
// 生长方向：子块变高只把后面的子块向下推；框只向下/向右长（S7）。
// TODO(T6 可选)：流程类横向链——在本文件内按 ctx / header.node 的条件切换方向即可，框架无需改动。

import type { Block, BlockEdge, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const CHAIN = {
  /** 相邻子块纵向间距（容纳先后箭头） */
  GV: 28,
} as const;

function layoutChain(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const places: Place[] = [];
  const edges: BlockEdge[] = [];
  let y = 0;
  let w = 0;
  let prev: ChildBlock | null = null;
  for (const b of kids) {
    places.push({ id: b.id, x: 0, y });
    y += b.h + CHAIN.GV;
    if (b.w > w) w = b.w;
    if (b.kind === "node") {
      if (prev) edges.push({ kind: "seq", from: prev.id, to: b.id });
      prev = b;
    }
  }
  return ctx.frame(header, { w, h: y - CHAIN.GV, items: [], places, edges });
}

export const chain: PatternDef = { key: "chain", layout: layoutChain };
