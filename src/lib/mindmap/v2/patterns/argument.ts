// 版式：论证图（§15.3；论点 + 理由/证据/反方/反驳）。
// 几何：论点（父卡）居中在上；第一行从左到右＝支持方（非「反方观点」「反驳」的子，原文顺序），隔 24px 后是反方观点；
// 反驳（type「反驳」）挂在它 `驳` 指向的反方观点**下方**（y > 反方块底边，x 以反方锚点中线对齐）；
// 同一反方下多条反驳、或与其他反驳横向重叠时，按「天际线」向下叠放；无明确目标的反驳依次排在行尾下方。
// 向上指父的隐含支持/反驳线：每个第一行的子 → 论点，ctx.rel(..., implicit=true)（不登记消化），tf 错开终点。
// 「驳」关系（反驳 → 反方观点）经 ctx.rel 消化。
// 同版式嵌套（ctx.parentPattern === 'argument'，如理由下的证据）并入外层框：不调用 ctx.frame，论点居中置顶。
// 生长方向（S7）：块变大只推后面的兄弟向右、反驳行向下；居中只在顶层框（框内），不影响链外子树内部坐标。

import type { Block, BlockEdge, BlockItem, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const ARGUMENT = {
  /** 第一行块间距 */
  GX: 32,
  /** 支持方与反方之间额外间距 */
  SIDE_GAP: 24,
  /** 第一行与反驳行之间 */
  GY: 48,
  /** 叠放的反驳之间 */
  STACK_GAP: 24,
  /** 嵌套时论点卡到子块 */
  NEST_GY: 40,
} as const;

function layoutArgument(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const { GX, SIDE_GAP, GY, STACK_GAP, NEST_GY } = ARGUMENT;
  const sup: ChildBlock[] = [];
  const obj: ChildBlock[] = [];
  const reb: ChildBlock[] = [];
  for (const k of kids) {
    const t = k.node ? String(k.node.type) : "";
    if (t === "反方观点") obj.push(k);
    else if (t === "反驳") reb.push(k);
    else sup.push(k);
  }
  const row = [...sup, ...obj];
  const objIds = new Set(obj.map((o) => o.id));
  const byId = new Map<string, ChildBlock>(kids.map((k) => [k.id, k]));
  const px = new Map<string, number>();
  const places: Place[] = [];
  const edges: BlockEdge[] = [];
  const items: BlockItem[] = [];

  let x = 0;
  let rowH = 0;
  row.forEach((k, i) => {
    if (i && k === obj[0] && sup.length) x += SIDE_GAP;
    px.set(k.id, x);
    places.push({ id: k.id, x, y: 0 });
    x += k.w + GX;
    if (k.h > rowH) rowH = k.h;
  });
  let maxX = row.length ? x - GX : 0;

  // 反驳：天际线叠放
  const y0 = row.length ? rowH + GY : 0;
  const placedReb: { x0: number; x1: number; bottom: number }[] = [];
  let bodyH = rowH;
  for (const k of reb) {
    let tgt: string | null = null;
    for (const e of ctx.siblingEdges) {
      if (e.from === k.id && e.code === "驳" && objIds.has(e.to)) {
        tgt = e.to;
        break;
      }
    }
    let rx: number;
    if (tgt) {
      const tb = byId.get(tgt) as ChildBlock;
      rx = Math.max(0, ctx.g4((px.get(tgt) as number) + tb.anchor.x + tb.anchor.w / 2 - (k.anchor.x + k.anchor.w / 2)));
      edges.push(ctx.rel(k.id, tgt, "驳"));
    } else rx = maxX + (row.length || placedReb.length ? GX : 0);
    let ry = y0;
    for (const p of placedReb) if (rx < p.x1 + 4 && p.x0 < rx + k.w + 4 && p.bottom + STACK_GAP > ry) ry = p.bottom + STACK_GAP;
    places.push({ id: k.id, x: rx, y: ry });
    placedReb.push({ x0: rx, x1: rx + k.w, bottom: ry + k.h });
    if (rx + k.w > maxX) maxX = rx + k.w;
    if (ry + k.h > bodyH) bodyH = ry + k.h;
  }

  // 隐含的向上支持/反驳线
  const ups = row.filter((k) => k.kind === "node");
  ups.forEach((k, i) => {
    const e = ctx.rel(k.id, header.id, objIds.has(k.id) ? "驳" : "支", true);
    e.tf = (i + 1) / (ups.length + 1);
    edges.push(e);
  });

  const body = { w: maxX, h: bodyH, items, places, edges };
  if (ctx.parentPattern === ctx.key) {
    // 同版式嵌套：并入外层框，论点居中置顶
    const w = Math.max(header.w, body.w);
    const hx = ctx.g4((w - header.w) / 2);
    const bx = ctx.g4((w - body.w) / 2);
    const by = header.h + NEST_GY;
    return {
      w,
      h: by + body.h,
      anchor: { x: hx, y: 0, w: header.w, h: header.h },
      items: [],
      places: places.map((p) => ({ id: p.id, x: p.x + bx, y: p.y + by })),
      edges,
    };
  }
  return ctx.frame(header, body, { center: true });
}

export const argument: PatternDef = { key: "argument", layout: layoutArgument };
