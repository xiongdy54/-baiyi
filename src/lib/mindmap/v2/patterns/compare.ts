// 版式：对照（§15.3；A 对 B、分类对比）。声明 absorb：同时摆放子（栏头）与孙（栏内属性行）。
// 几何：每个子一栏（lane 装饰），栏内第 0 行是栏头卡，其后每个孙一行；**同一序号＝同一行**，
// 行内各栏的卡片锚点 y 对齐（同行＝同维度）。行高取该行各栏最大值，栏宽取该栏最宽块 + 24。
// 栏间 `vs`：子间「比」关系经 ctx.rel 消化成组内关系边（其余关系码不消化，交给路由层当跨组关系）。
// LOD「另有 N 项」（子级）排在最右，不带栏；孙级的「另有 N 项」作为该栏最后一行。
// 生长方向（S7）：某栏某行变高只把其后各行向下推；某栏变宽只把右侧各栏向右推。

import type { Block, BlockEdge, BlockItem, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const COMPARE = {
  /** 栏间距（容纳 vs） */
  GAP: 56,
  /** 栏内边距（栏宽 = 内容 + 2*PADX） */
  PADX: 12,
  PADY: 12,
  /** 栏头与第一行之间 */
  HEAD_GAP: 16,
  /** 行间距 */
  ROW_GAP: 8,
} as const;

function layoutCompare(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const { GAP, PADX, PADY, HEAD_GAP, ROW_GAP } = COMPARE;
  const cols = kids.filter((k) => k.kind === "node");
  const tail = kids.filter((k) => k.kind !== "node");
  const nRows = 1 + cols.reduce((m, c) => Math.max(m, c.cells ? c.cells.length : 0), 0);
  const cell = (c: ChildBlock, r: number): ChildBlock | null => (r === 0 ? c : c.cells && c.cells[r - 1] ? c.cells[r - 1] : null);

  // 行：锚点对齐线 A（锚点上方最大高度）与行高
  const rowTop: number[] = [];
  const rowAlign: number[] = [];
  let y = PADY;
  for (let r = 0; r < nRows; r++) {
    let a = 0;
    let below = 0;
    for (const c of cols) {
      const b = cell(c, r);
      if (!b) continue;
      if (b.anchor.y > a) a = b.anchor.y;
    }
    for (const c of cols) {
      const b = cell(c, r);
      if (!b) continue;
      const d = b.h - b.anchor.y;
      if (d > below) below = d;
    }
    rowTop.push(y);
    rowAlign.push(a);
    y += a + below + (r === 0 ? HEAD_GAP : ROW_GAP);
  }
  const laneH = y - (nRows === 1 ? HEAD_GAP : ROW_GAP) + PADY;

  const places: Place[] = [];
  const items: BlockItem[] = [];
  const edges: BlockEdge[] = [];
  let x = 0;
  for (const c of cols) {
    let inner = c.w;
    for (let r = 1; r < nRows; r++) {
      const b = cell(c, r);
      if (b && b.w > inner) inner = b.w;
    }
    const laneW = inner + 2 * PADX;
    items.push({ id: "LN:" + c.id, kind: "lane", x, y: 0, w: laneW, h: laneH, nid: c.id });
    for (let r = 0; r < nRows; r++) {
      const b = cell(c, r);
      if (!b) continue;
      places.push({ id: b.id, x: x + PADX, y: rowTop[r] + rowAlign[r] - b.anchor.y });
    }
    x += laneW + GAP;
  }
  for (const t of tail) {
    places.push({ id: t.id, x, y: PADY });
    x += t.w + GAP;
  }
  const w = Math.max(0, x - GAP);
  const colIds = new Set(cols.map((c) => c.id));
  for (const e of ctx.siblingEdges) {
    if (e.code === "比" && e.from !== e.to && colIds.has(e.from) && colIds.has(e.to)) edges.push(ctx.rel(e.from, e.to, e.code));
  }
  return ctx.frame(header, { w, h: laneH, items, places, edges });
}

export const compare: PatternDef = { key: "compare", absorb: true, layout: layoutCompare };
