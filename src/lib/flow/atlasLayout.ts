// 结构全景（D254 v2）纯模块。设计 docs/design/STRUCTURE-ATLAS-D254.md §4。纯函数、确定性、无 DOM。
// 每个「组」按自己的版式排成一个矩形块，块再作为整体被父组按父组版式摆放（二维组合布局）。
import type { GraphState, RelCode } from "../mindmap/v2/types";
import { ROOT_ID } from "../mindmap/v2/types";
import { ancestors, childrenOf } from "../mindmap/v2/graph";
import { REL_STYLE } from "../mindmap/v2/route";
import type { FlowColors, FlowPattern } from "./types";
import { compareTable, parseTime, patternFor, textW, tierOf, wrapLabel } from "./layout";

// ---------------------------------------------------------------- §4.1 常量

export const AL = {
  // 字形
  PAD_X: 10, PAD_R: 10, PAD_Y: 4, // D254 修订：节点改为圆角「标签胶囊」，左右内边距对称 10
  META_H: 15, TIME_H: 15, MIN_W: 64,
  // 大纲 · 扇形树
  FAN_GAP: 72, FAN_PORT: 4, FAN_VGAP: 10, FAN_VGAP_BLOCK: 26,
  // 并列 · 网格
  GRID_TILE_W: 184, GRID_GX: 16, GRID_GY: 20, GRID_MAXCOLS: 4, HEAD_GAP: 16,
  // 论证
  ARG_GX: 28, ARG_GY: 64, ARG_COUNTER_GAP: 56, ARG_ZONE_PAD: 16, ARG_ROUNDS: 2,
  // 时间线
  TL_W_PER: 150, TL_W_MIN: 480, TL_W_MAX: 2400, TL_SLOT: 172, TL_MIN_DX: 28, TL_BREAK_K: 4, TL_BREAK_W: 72,
  TL_STEM: 30, TL_LANE_GAP: 12, TL_LANE_GAPX: 16, TL_LABEL_DX: 8, TL_DOT_R: 5, TL_HEAD_GAP: 40,
  // 步骤
  CH_R: 12, CH_ROW_MAX: 5, CH_GX: 40, CH_GY: 48, CH_LABEL_GAP: 10, CH_TURN: 40,
  // 因果
  LY_GX: 96, LY_GY: 18, LY_ROUNDS: 4,
  // 对照
  CMP_DIM_W: 96, CMP_COL_W: 200, CMP_GX: 12, CMP_ROW_PAD: 10, CMP_ROW_MIN: 32, CMP_MAX_DIMS: 6,
  // 规模
  MORE_MAX: 24, MORE_SHOW: 18, BIG_GROUP: 40, BUDGET: 160, HOP_CAP: 8,
} as const;

/** 全部时长（ms）。CSS 同名值写在 theme.css「结构全景」节，两处必须一致。 */
export const ATLAS_T = {
  MOVE: 420,                       // 一切几何移动 + 相机（同一时钟、同一曲线 --flow-ease）
  FADE_IN: 240, FADE_OUT: 160, REMOVE: 200,
  ENTER_DELAY: 180,                // 展开：新节点在既有节点开始移动后 180ms 出现
  ENTER_STEP: 18, ENTER_CAP: 200,  // 展开：同批新节点按序错开
  EDGE_DELAY: 120,                 // 边比两端节点晚出现
  BG_IN: 240, BG_OUT: 200, BG_OUT_DELAY: 120,
  HOP_BUTTON0: 60, HOP_BUTTON: 50, // 按钮进入：延迟 = 60 + hop × 50
  HOP_HANDOFF0: 300, HOP_HANDOFF: 60, // 交接进入：延迟 = 300 + hop × 60（hop ≥ 1）
  HOP_EXIT: 25, EXIT_DONE: 440,    // 退场：延迟 = (HOP_CAP − hop) × 25；440 后 onExited
  GHOST_LAYER_OUT: 160, GHOST_BLEND_OUT: 200, GHOST_REMOVE: 220,
  HANDOFF_RESET: 280,
  HOVER_DWELL: 250, HOVER_CLEAR: 200,
  CARD_DELAY_HANDOFF: 460, CARD_DELAY_BUTTON: 320,
  WHEEL_IDLE: 160, CULL_THROTTLE: 100, LAYOUT_THROTTLE: 250, LOCATE_TIMEOUT: 600,
  REDUCED: 120,
} as const;

export const CAM = { CENTER_Y: 0.45, ZOOM_MIN: 0.3, ZOOM_MAX: 1.8, ZOOM_STEP: 1.1, PAN_MARGIN: 160, CULL_PAD: 600, LOD_ZOOM: 0.5, DRAG_SLOP: 4 } as const;

// ---------------------------------------------------------------- §4.2 类型

export type GlyphKind = "root" | "claim" | "plate" | "tile" | "event" | "step" | "colhead" | "cell" | "more";
export interface Box { x: number; y: number; w: number; h: number }

/** 一个节点的文字标签（HTML 渲染）。x/y/w/h 是标签盒（块局部 → 展平后为世界坐标） */
export interface AGlyph extends Box {
  id: string;               // `g:${nodeId}`；「另 N 项」为 `more:${parentId}`
  nodeId: string | null;    // more 为 null
  parentId: string | null;
  kind: GlyphKind;
  lines: string[]; fs: number; lh: number; weight: number; tone: number;
  align: "left" | "center";
  color: string;
  meta: string;             // 类型字（「其他」/ 无类型时为 ""）；root 为「全文 · n 节」
  time: string | null;      // event：标题上方的时间
  num: number | null;       // step：序号（圆内数字由 deco 画，这里供读屏）
  kids: number;             // 子节点总数（>0 显示折叠钮）
  expanded: boolean;        // 子节点是否已展开显示
  head: boolean;            // 是展开中的组头（字重 +100、字号 +1，CSS 实现）
  counter: boolean;         // 反方观点 / 反驳 / 让步（斜纹竖条）
  example: boolean;         // 例证 / 案例（点状竖条）
  moreCount?: number;       // more：隐藏的项数
}

/** 边：path＝[x0,y0, c1x,c1y,c2x,c2y,x,y, …]（每段一个三次贝塞尔）；ribbon＝Sankey 流带（字段同 FlowShape） */
export type AGeom = { t: "path"; p: number[] } | { t: "ribbon"; L: number; xs: number; s0: number; s1: number; x1: number; t0: number; t1: number };
export interface AEdge {
  id: string;
  kind: "fan" | "rel" | "seq" | "axis";
  from: string | null;      // nodeId
  to: string | null;
  code: RelCode | null;
  geom: AGeom;
  color: string;
  colorB: string;           // 渐变终点色（与 color 相同即实色）
  w: number;                // 描边宽（ribbon 为 0）
  dash: string;             // "" 实线
  end: "arrow" | "bar" | "open" | "dot" | null;
  start: "dot" | null;
  opacity: number;          // 基础不透明度（隐含关系 0.55，轴 0.22，其余 1）
}

export type ADeco =
  | { k: "rect"; id: string; x: number; y: number; w: number; h: number; rx: number; fill: string; opacity: number }
  | { k: "circle"; id: string; cx: number; cy: number; r: number; fill: string; stroke: string; strokeW: number; opacity: number }
  | { k: "text"; id: string; x: number; y: number; text: string; fs: number; weight: number; fill: string; opacity: number; anchor: "start" | "middle" | "end"; mono: boolean };

/** 组的领地（悬停 / 焦点组淡色底） */
export interface AZone extends Box { id: string; pattern: FlowPattern; color: string }

export interface ABlock {
  w: number; h: number;
  anchor: Box;              // 组头标签盒（块局部）
  headId: string;           // 组头字形 id
  glyphs: AGlyph[]; edges: AEdge[]; decos: ADeco[]; zones: AZone[];
  /** 已被版式表达的图边（`${from}>${to}>${code}`），不再画成跨组关系 */
  consumed: string[];
}

export interface AtlasOpts {
  colors: FlowColors;
  rootTitle: string;
  expanded: ReadonlySet<string>;   // 展开显示子节点的节点（ROOT_ID 恒视为展开）
  showAll: ReadonlySet<string>;    // 子节点 > MORE_MAX 但用户点过「另 N 项」的组
  readingId: string | null;
  patternLabel: (p: FlowPattern) => string;    // p => T(PATTERN_LABEL[p])
  rootMeta: (n: number) => string;             // n => T("全文 · {n} 节", { n })
  moreLabel: (n: number) => string;            // n => T("另 {n} 项", { n })
  counterLabel: string;                         // T("反方一侧")
  otherLabel: string;                           // T("其他")
  /** 当前焦点节点：不截断文字（实机修订：选中节点必须完整可读） */
  focusId?: string | null;
}

export interface AtlasScene {
  w: number; h: number;
  glyphs: AGlyph[]; edges: AEdge[]; decos: ADeco[]; zones: AZone[];
  byId: Map<string, AGlyph>;        // glyph id → glyph
  byNode: Map<string, AGlyph>;      // nodeId → glyph
  consumed: Set<string>;
  patternOf: Map<string, FlowPattern>;  // 展开组 → 版式
}

// ---------------------------------------------------------------- §4.3 字形

interface KindStyle { fs: number; lh: number; weight: number; tone: number; maxW: number; lines: number; align: "left" | "center"; bar: boolean }
export const KIND_STYLE: Record<GlyphKind, KindStyle> = {
  root:    { fs: 20,   lh: 26, weight: 650, tone: 96, maxW: 360, lines: 2, align: "left",   bar: true },
  claim:   { fs: 15,   lh: 21, weight: 640, tone: 96, maxW: 260, lines: 3, align: "center", bar: false },
  plate:   { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 216, lines: 3, align: "left",   bar: true },
  tile:    { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 164, lines: 3, align: "left",   bar: false },
  event:   { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 176, lines: 3, align: "left",   bar: false },
  step:    { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 168, lines: 3, align: "center", bar: false },
  colhead: { fs: 14,   lh: 19, weight: 620, tone: 96, maxW: 200, lines: 2, align: "left",   bar: false },
  cell:    { fs: 12.5, lh: 18, weight: 420, tone: 84, maxW: 200, lines: 5, align: "left",   bar: false },
  more:    { fs: 12,   lh: 18, weight: 400, tone: 52, maxW: 160, lines: 1, align: "left",   bar: true },
};
const TYPE_HIDDEN = new Set(["", "其他"]);

export function makeGlyph(
  g: GraphState, o: AtlasOpts, nodeId: string, parentId: string | null, kind: GlyphKind, color: string,
  extra: { text?: string; num?: number; head?: boolean } = {},
): AGlyph {
  const st = KIND_STYLE[kind];
  const n = nodeId === ROOT_ID ? null : g.nodes[nodeId];
  const text = extra.text ?? (nodeId === ROOT_ID ? o.rootTitle : String(n?.title ?? ""));
  // D254 修订：文字永不省略——行数不设上限（宽度仍按 maxW 折行）；估宽留 4% + 2px 余量，避免真实字形比估算宽时被裁
  const maxW = st.maxW;
  const lines = wrapLabel(text, st.fs, maxW, 999);
  const padH = glyphPadH(kind);
  const textWmax = Math.max(0, ...lines.map((l) => textW(l, st.fs)));
  const tw = Math.ceil(textWmax * 1.04) + 2;
  const w = kind === "tile" ? Math.max(AL.GRID_TILE_W, tw + padH) : Math.max(AL.MIN_W, tw + padH);
  const kidsAll = childrenOf(g, nodeId).filter((k) => !!g.nodes[k]);
  const type = String(n?.type ?? "");
  const t = tierOf(type);
  const meta = nodeId === ROOT_ID ? o.rootMeta(kidsAll.length) : TYPE_HIDDEN.has(type) ? "" : type;
  const time = kind === "event" ? (n?.timeText ? String(n.timeText) : null) : null;
  const hasMetaRow = kind !== "cell" && kind !== "more" && (meta !== "" || kidsAll.length > 0);
  const h = lines.length * st.lh + AL.PAD_Y * 2 + (hasMetaRow ? AL.META_H : 0) + (time ? AL.TIME_H : 0);
  return {
    id: `g:${nodeId}`, nodeId, parentId, kind, x: 0, y: 0, w, h,
    lines, fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, align: st.align, color,
    meta, time, num: extra.num ?? null, kids: kind === "cell" && kidsAll.length === 0 ? 0 : kidsAll.length,
    expanded: false, head: !!extra.head, counter: t === "counter", example: t === 2,
  };
}

/** 字形左右内边距合计（与 theme.css「结构全景 · 字形」的 padding 一致）：表格单元格 / 栏名不加胶囊 */
export const glyphPadH = (kind: GlyphKind) => (kind === "cell" || kind === "colhead" ? 0 : AL.PAD_X + AL.PAD_R);

function moreGlyph(o: AtlasOpts, parentId: string, hidden: number, color: string): AGlyph {
  const st = KIND_STYLE.more, text = o.moreLabel(hidden);
  const w = Math.max(AL.MIN_W, Math.ceil(textW(text, st.fs)) + AL.PAD_X + AL.PAD_R);
  return {
    id: `more:${parentId}`, nodeId: null, parentId, kind: "more", x: 0, y: 0, w, h: st.lh + AL.PAD_Y * 2,
    lines: [text], fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, align: "left", color,
    meta: "", time: null, num: null, kids: 0, expanded: false, head: false, counter: false, example: false, moreCount: hidden,
  };
}

// ---------------------------------------------------------------- §4.4 块工具

const blank = (): ABlock => ({ w: 0, h: 0, anchor: { x: 0, y: 0, w: 0, h: 0 }, headId: "", glyphs: [], edges: [], decos: [], zones: [], consumed: [] });
const leaf = (gl: AGlyph): ABlock => ({ ...blank(), w: gl.w, h: gl.h, anchor: { x: 0, y: 0, w: gl.w, h: gl.h }, headId: gl.id, glyphs: [gl] });
/** 渐变只对「有面积」的包围盒成立：纯水平 / 纯垂直路径用 objectBoundingBox 渐变会整条不渲染（链条 / 论证竖线 / 时间轴）。 */
export const usableGradient = (color: string, colorB: string, box: Box): boolean => color !== colorB && box.w > 0.5 && box.h > 0.5;
const isBig = (b: ABlock) => b.glyphs.length > 1;

function moveGeom(ge: AGeom, dx: number, dy: number): AGeom {
  if (ge.t === "path") return { t: "path", p: ge.p.map((v, i) => (i % 2 ? v + dy : v + dx)) };
  return { t: "ribbon", L: ge.L + dx, xs: ge.xs + dx, x1: ge.x1 + dx, s0: ge.s0 + dy, s1: ge.s1 + dy, t0: ge.t0 + dy, t1: ge.t1 + dy };
}
function moveDeco(d: ADeco, dx: number, dy: number): ADeco {
  return d.k === "circle" ? { ...d, cx: d.cx + dx, cy: d.cy + dy } : { ...d, x: d.x + dx, y: d.y + dy };
}
/** 把子块 b 平移 (dx,dy) 后并入 out */
function put(out: ABlock, b: ABlock, dx: number, dy: number) {
  for (const gl of b.glyphs) out.glyphs.push({ ...gl, x: gl.x + dx, y: gl.y + dy });
  for (const e of b.edges) out.edges.push({ ...e, geom: moveGeom(e.geom, dx, dy) });
  for (const d of b.decos) out.decos.push(moveDeco(d, dx, dy));
  for (const z of b.zones) out.zones.push({ ...z, x: z.x + dx, y: z.y + dy });
  out.consumed.push(...b.consumed);
}
/** 块内所有元素整体平移（用于归一化左上角到 0,0） */
function shiftAll(out: ABlock, dx: number, dy: number) {
  if (!dx && !dy) return;
  const tmp = { ...blank(), glyphs: out.glyphs, edges: out.edges, decos: out.decos, zones: out.zones };
  out.glyphs = []; out.edges = []; out.decos = []; out.zones = [];
  const consumed = out.consumed; out.consumed = [];
  put(out, tmp, dx, dy);
  out.consumed = consumed;
  out.anchor = { ...out.anchor, x: out.anchor.x + dx, y: out.anchor.y + dy };
}
/** 世界坐标下块的锚点（子块被 put(dx,dy) 后） */
const anchorAt = (b: ABlock, dx: number, dy: number): Box => ({ x: b.anchor.x + dx, y: b.anchor.y + dy, w: b.anchor.w, h: b.anchor.h });
const relEdge = (id: string, from: string, to: string, code: RelCode, p: number[], color: string, colorB: string, opacity = 1): AEdge => {
  const st = REL_STYLE[code];
  return { id, kind: "rel", from, to, code, geom: { t: "path", p }, color, colorB, w: st.width + 0.25, dash: st.dash, end: st.end as AEdge["end"], start: st.start as AEdge["start"], opacity };
};
const ekey = (from: string, to: string, code: string) => `${from}>${to}>${code}`;

// ---------------------------------------------------------------- §4.5 组合

interface GroupIn {
  id: string; pattern: FlowPattern; head: AGlyph;
  kids: string[];          // 显示的子节点（已截断）
  blocks: ABlock[];        // 与 kids 一一对应
  more: ABlock | null;     // 「另 N 项」
  g: GraphState; o: AtlasOpts;
}
/** 版式 → 子节点字形 */
const ROLE: Record<FlowPattern, GlyphKind> = { tree: "plate", grid: "tile", argument: "plate", timeline: "event", chain: "step", layered: "plate", compare: "colhead" };

export function groupPattern(g: GraphState, id: string, kids: string[]): FlowPattern {
  if (kids.length < 2) return "tree";
  const p = patternFor(g, id, kids);
  if (kids.length > AL.BIG_GROUP && p !== "tree" && p !== "grid") return "grid";
  return p;
}

function buildBlock(g: GraphState, o: AtlasOpts, id: string, parentId: string | null, role: GlyphKind, color: string, num: number | null, patternOut: Map<string, FlowPattern>, text?: string): ABlock {
  const all = childrenOf(g, id).filter((k) => !!g.nodes[k]);
  const open = all.length > 0 && (id === ROOT_ID || o.expanded.has(id));
  const pattern = open ? groupPattern(g, id, all) : "tree";
  // 组头字形：论证组且自身是普通标签 → 升级为「主张」
  const kind: GlyphKind = open && pattern === "argument" && (role === "plate" || role === "tile") ? "claim" : role;
  const head = makeGlyph(g, o, id, parentId, kind, color, { num: num ?? undefined, head: open, text });
  head.expanded = open;
  if (!open) return leaf(head);
  patternOut.set(id, pattern);
  let kids = all, more: ABlock | null = null;
  if (all.length > AL.MORE_MAX && !o.showAll.has(id) && pattern !== "compare") {
    kids = all.slice(0, AL.MORE_SHOW);
    more = leaf(moreGlyph(o, id, all.length - AL.MORE_SHOW, o.colors.hairline));
  }
  if (pattern === "compare") return layoutCompare(g, o, id, head, all, patternOut);
  const childRole = ROLE[pattern];
  const blocks = kids.map((k, i) => buildBlock(g, o, k, id, childRole, o.colors.palette[i % 8], pattern === "chain" ? i + 1 : null, patternOut));
  const gi: GroupIn = { id, pattern, head, kids, blocks, more, g, o };
  switch (pattern) {
    case "grid": return layoutGrid(gi);
    case "argument": return layoutArgument(gi);
    case "timeline": return layoutTimeline(gi);
    case "chain": return layoutChain(gi);
    case "layered": return layoutLayered(gi);
    default: return layoutFan(gi);
  }
}

export function buildAtlas(g: GraphState, o: AtlasOpts): AtlasScene {
  const patternOf = new Map<string, FlowPattern>();
  const b = buildBlock(g, o, ROOT_ID, null, "root", o.colors.fg, null, patternOf);
  const byId = new Map<string, AGlyph>(), byNode = new Map<string, AGlyph>();
  for (const gl of b.glyphs) { byId.set(gl.id, gl); if (gl.nodeId) byNode.set(gl.nodeId, gl); }
  return { w: b.w, h: b.h, glyphs: b.glyphs, edges: b.edges, decos: b.decos, zones: b.zones, byId, byNode, consumed: new Set(b.consumed), patternOf };
}

/** 每个版式结尾都调用：登记领地、写 w/h/anchor/headId */
function finish(out: ABlock, gi: GroupIn, H: AGlyph) {
  // 归一化：最小 x/y 到 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const gl of out.glyphs) { minX = Math.min(minX, gl.x); minY = Math.min(minY, gl.y); maxX = Math.max(maxX, gl.x + gl.w); maxY = Math.max(maxY, gl.y + gl.h); }
  for (const d of out.decos) {
    const bx = d.k === "circle" ? [d.cx - d.r, d.cy - d.r, d.cx + d.r, d.cy + d.r] : d.k === "rect" ? [d.x, d.y, d.x + d.w, d.y + d.h] : [d.x - 24, d.y - d.fs, d.x + 24, d.y + 4];
    minX = Math.min(minX, bx[0]); minY = Math.min(minY, bx[1]); maxX = Math.max(maxX, bx[2]); maxY = Math.max(maxY, bx[3]);
  }
  out.anchor = { x: H.x, y: H.y, w: H.w, h: H.h };
  shiftAll(out, -minX, -minY);
  out.w = Math.ceil(maxX - minX); out.h = Math.ceil(maxY - minY);
  out.headId = H.id;
  out.zones.push({ id: gi.id, pattern: gi.pattern, color: H.color, x: 0, y: 0, w: out.w, h: out.h });
}

// ---------------------------------------------------------------- §4.6 七种版式

// ---- 4.6.1 大纲 · 扇形树 ----

function layoutFan(gi: GroupIn): ABlock {
  const out = blank();
  const list = gi.more ? [...gi.blocks, gi.more] : gi.blocks;
  const tops: number[] = [];
  let y = 0;
  list.forEach((b, i) => {
    if (i) y += isBig(b) || isBig(list[i - 1]) ? AL.FAN_VGAP_BLOCK : AL.FAN_VGAP;
    tops.push(y);
    y += b.h;
  });
  const ax = gi.head.w + AL.FAN_GAP;
  const mid = (i: number) => tops[i] + list[i].anchor.y + list[i].anchor.h / 2;
  let hy = Math.round((mid(0) + mid(list.length - 1)) / 2 - gi.head.h / 2);
  let ky = 0;
  if (hy < 0) { ky = -hy; hy = 0; }
  const H = { ...gi.head, x: 0, y: hy };
  out.glyphs.push(H);
  list.forEach((b, i) => put(out, b, ax, tops[i] + ky));
  // D254 修订：不再用 Sankey 流带（跨度大时被拉成喇叭 / 单子节点时像插了一块矩形）——
  // 改为从父节点右缘同一点发出的细曲线（经典整洁树的水平 S 形），在子节点左缘收束；颜色由父色渐变到子色
  const sx = H.x + H.w + AL.FAN_PORT, sy = hy + H.h / 2;
  list.forEach((b, i) => {
    const A = anchorAt(b, ax, tops[i] + ky);
    const toNode = i < gi.blocks.length ? gi.kids[i] : null;
    const color = i < gi.blocks.length ? b.glyphs[0].color : gi.o.colors.hairline;
    const ex = A.x - AL.FAN_PORT, ey = A.y + A.h / 2;
    const k = Math.max(24, Math.min(AL.FAN_GAP - 8, (ex - sx) * 0.5));
    out.edges.push({
      id: `fan:${gi.id}>${toNode ?? "more"}`, kind: "fan", from: gi.id, to: toNode, code: null,
      geom: { t: "path", p: [sx, sy, sx + k, sy, ex - k, ey, ex, ey] },
      color: H.color, colorB: color, w: 1.25, dash: toNode ? "" : "2 3", end: null, start: null, opacity: 0.55,
    });
  });
  finish(out, gi, H);
  return out;
}

// ---- 4.6.2 并列 · 网格 ----

function layoutGrid(gi: GroupIn): ABlock {
  const out = blank();
  const list = gi.more ? [...gi.blocks, gi.more] : gi.blocks;
  const n = list.length;
  const cols = n <= 3 ? n : Math.min(AL.GRID_MAXCOLS, Math.max(2, Math.round(Math.sqrt(n * 1.4))));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(AL.GRID_TILE_W, ...list.filter((_, i) => i % cols === c).map((b) => b.w)));
  const colX: number[] = [];
  colW.reduce((x, w, c) => ((colX[c] = x), x + w + AL.GRID_GX), 0);
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  out.decos.push({ k: "rect", id: `rule:${gi.id}`, x: 0, y: H.h + 5, w: 24, h: 1, rx: 0, fill: gi.o.colors.fg, opacity: 0.3 });
  let y = H.h + AL.HEAD_GAP;
  for (let r = 0; r * cols < n; r++) {
    const row = list.slice(r * cols, r * cols + cols);
    row.forEach((b, c) => put(out, b, colX[c], y));
    y += Math.max(...row.map((b) => b.h)) + AL.GRID_GY;
  }
  finish(out, gi, H);
  return out;
}

// ---- 4.6.3 论证 ----

const UP_OUT = new Set<RelCode>(["支", "例", "驳", "答", "推"]); // 本节点 —码→ 目标：目标是上级
type Up = { up: string; code: RelCode; implicit: boolean };

function layoutArgument(gi: GroupIn): ABlock {
  const { g, kids, blocks, o } = gi;
  const out = blank();
  const n = kids.length;
  const idx = new Map(kids.map((k, i) => [k, i] as const));
  const rk = (id: string) => { const t = tierOf(String(g.nodes[id]?.type ?? "")); return t === "counter" ? 1 : t; };
  // ① 上级（去重，保持出现顺序）
  const ups: Up[][] = kids.map((k) => {
    const list: Up[] = [];
    const add = (up: string, code: RelCode) => { if (up !== k && idx.has(up) && rk(up) <= rk(k) && !list.some((u) => u.up === up)) list.push({ up, code, implicit: false }); };
    for (const e of g.outEdges[k] ?? []) if (UP_OUT.has(e.code)) add(e.to, e.code);
    for (const e of g.inEdges[k] ?? []) if (e.code === "据") add(e.from, "据");
    return list;
  });
  // ② 分层：主张＝0；成员＝1 + max(上级层)；DFS 按原文顺序，遇环丢弃该条上级（它会作为跨组关系画出）
  const layer = new Array<number>(n).fill(0);
  const state = new Uint8Array(n);
  const visit = (i: number): number => {
    if (state[i] === 2) return layer[i];
    if (state[i] === 1) return -1;
    state[i] = 1;
    let L = 1;
    ups[i] = ups[i].filter((u) => { const lj = visit(idx.get(u.up)!); if (lj < 0) return false; L = Math.max(L, lj + 1); return true; });
    state[i] = 2;
    layer[i] = L;
    return L;
  };
  for (let i = 0; i < n; i++) visit(i);
  for (let i = 0; i < n; i++) if (!ups[i].length) ups[i].push({ up: gi.id, code: tierOf(String(g.nodes[kids[i]]?.type ?? "")) === "counter" ? "驳" : "支", implicit: true });
  // ③ 反方区：类型为反方且只挂主张；或全部上级都在反方区
  const counter = new Array<boolean>(n).fill(false);
  const byLayer = [...kids.keys()].sort((a, b) => layer[a] - layer[b] || a - b);
  for (const i of byLayer) {
    const explicit = ups[i].filter((u) => !u.implicit);
    counter[i] = (tierOf(String(g.nodes[kids[i]]?.type ?? "")) === "counter" && explicit.every((u) => counter[idx.get(u.up)!])) ||
      (explicit.length > 0 && explicit.every((u) => counter[idx.get(u.up)!]));
  }
  // ④ 层内顺序 + 横向落位（重心法；主区与反方区分开排，反方区整体在主区右侧）
  const maxL = Math.max(1, ...layer);
  const order: number[][][] = [[], []]; // [zone][layer] → 成员下标
  for (let z = 0; z < 2; z++) for (let L = 0; L <= maxL; L++) order[z][L] = [];
  for (let i = 0; i < n; i++) order[counter[i] ? 1 : 0][layer[i]].push(i);
  const lowers: number[][] = kids.map(() => []);
  for (let i = 0; i < n; i++) for (const u of ups[i]) if (!u.implicit) lowers[idx.get(u.up)!].push(i);
  const cx = new Array<number>(n).fill(0), px = new Array<number>(n).fill(0);
  const ac = (i: number) => blocks[i].anchor.x + blocks[i].anchor.w / 2;
  const place = () => {
    let zoneStart = 0;
    for (let z = 0; z < 2; z++) {
      let zoneRight = zoneStart;
      for (let L = 1; L <= maxL; L++) {
        let cur = zoneStart;
        for (const i of order[z][L]) {
          const us = ups[i].filter((u) => !u.implicit).map((u) => cx[idx.get(u.up)!]);
          const want = us.length ? us.reduce((a, b) => a + b, 0) / us.length - ac(i) : cur;
          px[i] = Math.round(Math.max(cur, want));
          cx[i] = px[i] + ac(i);
          cur = px[i] + blocks[i].w + AL.ARG_GX;
          zoneRight = Math.max(zoneRight, px[i] + blocks[i].w);
        }
      }
      zoneStart = zoneRight + AL.ARG_COUNTER_GAP;
    }
  };
  const bary = (list: number[], pick: (i: number) => number[]) =>
    list.map((i, k) => { const v = pick(i); return { i, k, b: v.length ? v.reduce((a, c) => a + c, 0) / v.length : Infinity }; })
      .sort((a, b) => (a.b === b.b ? a.k - b.k : a.b - b.b)).map((x) => x.i);
  place();
  for (let r = 0; r < AL.ARG_ROUNDS; r++) {
    for (let z = 0; z < 2; z++) for (let L = 2; L <= maxL; L++) order[z][L] = bary(order[z][L], (i) => ups[i].filter((u) => !u.implicit).map((u) => cx[idx.get(u.up)!]));
    place();
    for (let z = 0; z < 2; z++) for (let L = maxL - 1; L >= 1; L--) order[z][L] = bary(order[z][L], (i) => lowers[i].map((j) => cx[j]));
    place();
  }
  // ⑤ 纵向：层顶 = 上一层顶 + 上一层最高块 + ARG_GY
  const H0 = gi.head;
  const top: number[] = [0, H0.h + AL.ARG_GY];
  for (let L = 1; L < maxL; L++) {
    const hs = [...order[0][L], ...order[1][L]].map((i) => blocks[i].h);
    top[L + 1] = top[L] + (hs.length ? Math.max(...hs) : 0) + AL.ARG_GY;
  }
  // 主张水平居中于第 1 层主区（主区无第 1 层则居中于全部第 1 层）
  const L1 = order[0][1].length ? order[0][1] : order[1][1];
  const l1min = Math.min(...L1.map((i) => px[i])), l1max = Math.max(...L1.map((i) => px[i] + blocks[i].w));
  const H = { ...H0, x: Math.round((l1min + l1max) / 2 - H0.w / 2), y: 0 };
  out.glyphs.push(H);
  for (let i = 0; i < n; i++) put(out, blocks[i], px[i], top[layer[i]]);
  // ⑥ 边：自下（成员锚点上缘）而上（上级锚点下缘）；两端各自按对侧横坐标均分端口
  const A = (i: number) => anchorAt(blocks[i], px[i], top[layer[i]]);
  const upBox = (u: Up) => (u.up === gi.id ? { x: H.x, y: H.y, w: H.w, h: H.h } : A(idx.get(u.up)!));
  const inc = new Map<string, { i: number; u: Up }[]>();
  for (let i = 0; i < n; i++) for (const u of ups[i]) { const l = inc.get(u.up) ?? []; l.push({ i, u }); inc.set(u.up, l); }
  for (const [upId, list] of inc) {
    const B = upBox(list[0].u);
    list.sort((a, b) => A(a.i).x - A(b.i).x);
    list.forEach(({ i, u }, k) => {
      const S = A(i);
      const outs = ups[i];
      const ko = outs.indexOf(u);
      const x0 = S.x + S.w / 2 + (outs.length > 1 ? ((ko + 1) / (outs.length + 1) - 0.5) * S.w * 0.6 : 0);
      const x1 = B.x + B.w / 2 + (list.length > 1 ? ((k + 1) / (list.length + 1) - 0.5) * B.w * 0.6 : 0);
      const y0 = S.y - 2, y1 = B.y + B.h + 3, dy = y0 - y1;
      const color = blocks[i].glyphs[0].color, colorB = upId === gi.id ? H.color : blocks[idx.get(upId)!].glyphs[0].color;
      const ed = relEdge(`arg:${kids[i]}>${upId}`, kids[i], upId, u.code, [x0, y0, x0, y0 - dy * 0.45, x1, y1 + dy * 0.45, x1, y1], color, colorB, u.implicit ? 0.55 : 1);
      if (u.code === "驳") { ed.color = o.colors.counter; ed.colorB = o.colors.counter; }
      out.edges.push(ed);
      if (!u.implicit) out.consumed.push(u.code === "据" ? ekey(upId, kids[i], "据") : ekey(kids[i], upId, u.code));
    });
  }
  // ⑦ 反方区底色 + 区名
  const ci = kids.map((_, i) => i).filter((i) => counter[i]);
  if (ci.length) {
    const bx = ci.map((i) => [px[i], top[layer[i]], px[i] + blocks[i].w, top[layer[i]] + blocks[i].h]);
    const x0 = Math.min(...bx.map((b) => b[0])) - AL.ARG_ZONE_PAD, y0 = Math.min(...bx.map((b) => b[1])) - AL.ARG_ZONE_PAD - 14;
    const x1 = Math.max(...bx.map((b) => b[2])) + AL.ARG_ZONE_PAD, y1 = Math.max(...bx.map((b) => b[3])) + AL.ARG_ZONE_PAD;
    out.decos.push({ k: "rect", id: `cz:${gi.id}`, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rx: 12, fill: o.colors.counter, opacity: 0.05 });
    out.decos.push({ k: "text", id: `czt:${gi.id}`, x: x0 + 12, y: y0 + 16, text: o.counterLabel, fs: 10, weight: 500, fill: o.colors.counter, opacity: 0.8, anchor: "start", mono: false });
  }
  finish(out, gi, H);
  return out;
}

// ---- 4.6.4 时间线 ----

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

function layoutTimeline(gi: GroupIn): ABlock {
  const { g, kids, blocks, o } = gi;
  const out = blank();
  const n = kids.length;
  const raw = kids.map((k) => parseTime(g.nodes[k]?.timeText ? String(g.nodes[k].timeText) : null));
  const known = raw.filter((t): t is number => t != null);
  const prop = known.length >= Math.ceil((n * 2) / 3) && new Set(known).size >= 2;
  // 缺失时间：先前向填充再后向填充
  const tf = raw.slice();
  for (let i = 1; i < n; i++) if (tf[i] == null) tf[i] = tf[i - 1];
  for (let i = n - 2; i >= 0; i--) if (tf[i] == null) tf[i] = tf[i + 1];
  const order = kids.map((_, i) => i);
  if (prop) order.sort((a, b) => (tf[a] as number) - (tf[b] as number) || a - b);
  // 光点横坐标
  const xs: number[] = [0];
  const breaks = new Set<number>(); // 断层在 order[j] 与 order[j+1] 之间
  if (prop) {
    const gaps = order.slice(1).map((oi, j) => (tf[oi] as number) - (tf[order[j]] as number));
    const pos = gaps.filter((v) => v > 0).sort((a, b) => a - b);
    const med = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
    gaps.forEach((v, j) => { if (med > 0 && v > AL.TL_BREAK_K * med) breaks.add(j); });
    const W = Math.min(AL.TL_W_MAX, Math.max(AL.TL_W_MIN, n * AL.TL_W_PER));
    const span = gaps.reduce((s, v, j) => s + (breaks.has(j) ? 0 : v), 0);
    const k = span > 0 ? Math.max(0, W - breaks.size * AL.TL_BREAK_W) / span : 0;
    gaps.forEach((v, j) => xs.push(xs[j] + Math.max(AL.TL_MIN_DX, breaks.has(j) ? AL.TL_BREAK_W : v * k)));
  } else for (let j = 1; j < n; j++) xs.push(j * AL.TL_SLOT);
  // 泳道：偶数序上方、奇数序下方；同侧按「左缘 ≥ 上一个右缘 + 16」找最近一条
  type Lane = { right: number; h: number };
  const lanes: Record<"above" | "below", Lane[]> = { above: [], below: [] };
  const slot: { side: "above" | "below"; lane: number; left: number }[] = [];
  order.forEach((oi, j) => {
    const b = blocks[oi];
    const side = j % 2 === 0 ? "above" : "below";
    const left = xs[j] - AL.TL_LABEL_DX - b.anchor.x;
    const L = lanes[side];
    let li = L.findIndex((l) => l.right + AL.TL_LANE_GAPX <= left);
    if (li < 0) { li = L.length; L.push({ right: -Infinity, h: 0 }); }
    L[li].right = left + b.w;
    L[li].h = Math.max(L[li].h, b.h);
    slot[j] = { side, lane: li, left };
  });
  const sum = (L: Lane[], upto: number) => L.slice(0, upto).reduce((s, l) => s + l.h + AL.TL_LANE_GAP, 0);
  const axisY = AL.TL_STEM + sum(lanes.above, lanes.above.length);
  // 组头（轴左端）
  const H = { ...gi.head, x: -(gi.head.w + AL.TL_HEAD_GAP), y: Math.round(axisY - gi.head.h / 2) };
  out.glyphs.push(H);
  out.edges.push({ id: `ax:${gi.id}:lead`, kind: "axis", from: null, to: null, code: null, geom: { t: "path", p: [H.x + H.w + 8, axisY, H.x + H.w + 16, axisY, -20, axisY, -12, axisY] },
    color: o.colors.fg, colorB: o.colors.fg, w: 1, dash: "2 4", end: null, start: null, opacity: 0.18 });
  // 事件块 + 茎 + 光点
  order.forEach((oi, j) => {
    const b = blocks[oi], s = slot[j];
    // 上方：同一泳道的块底对齐（贴近轴）；下方：块顶对齐
    const y = s.side === "above" ? axisY - AL.TL_STEM - sum(lanes.above, s.lane) - b.h : axisY + AL.TL_STEM + sum(lanes.below, s.lane);
    put(out, b, s.left, y);
    const A = anchorAt(b, s.left, y);
    const color = b.glyphs[0].color;
    const yA = s.side === "above" ? A.y + A.h + 2 : A.y - 2;
    const yD = s.side === "above" ? axisY - AL.TL_DOT_R - 2 : axisY + AL.TL_DOT_R + 2;
    out.edges.push({ id: `stem:${kids[oi]}`, kind: "axis", from: kids[oi], to: null, code: null, geom: { t: "path", p: [xs[j], yD, xs[j], yD, xs[j], yA, xs[j], yA] },
      color: o.colors.fg, colorB: o.colors.fg, w: 1, dash: "", end: null, start: null, opacity: 0.25 });
    out.decos.push({ k: "circle", id: `dot:${kids[oi]}`, cx: xs[j], cy: axisY, r: kids[oi] === o.readingId ? 6.5 : AL.TL_DOT_R, fill: kids[oi] === o.readingId ? o.colors.accent : color, stroke: o.colors.bg, strokeW: 2, opacity: 1 });
  });
  // 轴：相邻光点之间一段；断层段虚线 + 「//」
  for (let j = 0; j + 1 < n; j++) {
    const br = breaks.has(j);
    const ca = blocks[order[j]].glyphs[0].color, cb = blocks[order[j + 1]].glyphs[0].color;
    out.edges.push({ id: `ax:${gi.id}:${j}`, kind: "axis", from: null, to: null, code: null,
      geom: { t: "path", p: [xs[j] + 7, axisY, xs[j] + 7, axisY, xs[j + 1] - 7, axisY, xs[j + 1] - 7, axisY] },
      color: ca, colorB: cb, w: 2, dash: br ? "2 5" : "", end: null, start: null, opacity: br ? 0.35 : 0.5 });
    if (br) out.decos.push({ k: "text", id: `brk:${gi.id}:${j}`, x: (xs[j] + xs[j + 1]) / 2, y: axisY + 4, text: "//", fs: 11, weight: 500, fill: o.colors.fg, opacity: 0.45, anchor: "middle", mono: true });
  }
  // 刻度（仅比例模式）：画在轴下 14px；离任一光点 < 22px 的刻度不写字
  if (prop) {
    const t0 = tf[order[0]] as number, t1 = tf[order[n - 1]] as number, range = Math.max(1e-6, t1 - t0);
    const step = NICE.find((s) => range / s <= 10) ?? 1000;
    for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) {
      for (let j = 0; j + 1 < n; j++) {
        const a = tf[order[j]] as number, b = tf[order[j + 1]] as number;
        if (breaks.has(j) || v < a || v > b || b <= a) continue;
        const x = Math.round(xs[j] + ((v - a) / (b - a)) * (xs[j + 1] - xs[j]));
        out.decos.push({ k: "rect", id: `tk:${gi.id}:${v}`, x, y: axisY + 3, w: 1, h: 4, rx: 0, fill: o.colors.fg, opacity: 0.3 });
        if (!xs.some((d) => Math.abs(d - x) < 22)) out.decos.push({ k: "text", id: `tkt:${gi.id}:${v}`, x, y: axisY + 18, text: String(v < 0 ? `前${-v}` : v), fs: 10, weight: 400, fill: o.colors.fg, opacity: 0.38, anchor: "middle", mono: true });
        break;
      }
    }
  }
  finish(out, gi, H);
  return out;
}

// ---- 4.6.5 步骤 ----

function layoutChain(gi: GroupIn): ABlock {
  const { blocks, kids, o } = gi;
  const out = blank();
  const R = AL.CH_R;
  const list = gi.more ? [...blocks, gi.more] : blocks;
  const sw = (b: ABlock) => Math.max(b.w, 2 * R);
  const rows: number[][] = [];
  for (let i = 0; i < list.length; i += AL.CH_ROW_MAX) rows.push(list.slice(i, i + AL.CH_ROW_MAX).map((_, k) => i + k));
  const rowW = rows.map((r) => r.reduce((s, i) => s + sw(list[i]), 0) + (r.length - 1) * AL.CH_GX);
  const maxW = Math.max(...rowW);
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  let y = H.h + AL.HEAD_GAP + 4;
  const disc: { cx: number; cy: number; row: number }[] = [];
  rows.forEach((r, ri) => {
    const dir = ri % 2 === 0 ? 1 : -1;
    let x = dir > 0 ? 0 : maxW;
    const cy = y + R, labelTop = y + 2 * R + AL.CH_LABEL_GAP;
    for (const i of r) {
      const b = list[i], w = sw(b);
      const c = dir > 0 ? x + w / 2 : x - w / 2;
      put(out, b, Math.round(c - (b.anchor.x + b.anchor.w / 2)), labelTop - b.anchor.y);
      disc[i] = { cx: Math.round(c), cy, row: ri };
      x += dir * (w + AL.CH_GX);
    }
    y = labelTop + Math.max(...r.map((i) => list[i].h)) + AL.CH_GY;
  });
  const steps = blocks.length; // 「另 N 项」没有圆点与箭头
  for (let i = 0; i < steps; i++) {
    const c = blocks[i].glyphs[0].color, d = disc[i];
    out.decos.push({ k: "circle", id: `disc:${kids[i]}`, cx: d.cx, cy: d.cy, r: R, fill: kids[i] === o.readingId ? o.colors.accent : c, stroke: o.colors.bg, strokeW: 2, opacity: 1 });
    out.decos.push({ k: "text", id: `dn:${kids[i]}`, x: d.cx, y: d.cy + 4, text: String(i + 1), fs: 11, weight: 650, fill: o.colors.bg, opacity: 1, anchor: "middle", mono: true });
    if (i + 1 >= steps) continue;
    const e = disc[i + 1], cb = blocks[i + 1].glyphs[0].color;
    let p: number[];
    if (e.row === d.row) {
      const s = e.cx > d.cx ? 1 : -1;
      const x0 = d.cx + s * (R + 3), x1 = e.cx - s * (R + 5);
      p = [x0, d.cy, x0 + (x1 - x0) / 3, d.cy, x1 - (x1 - x0) / 3, e.cy, x1, e.cy];
    } else {
      const s = d.row % 2 === 0 ? 1 : -1; // 偶数行在右端折返，奇数行在左端
      const xo = s > 0 ? Math.max(d.cx, e.cx) + R + AL.CH_TURN : Math.min(d.cx, e.cx) - R - AL.CH_TURN;
      p = [d.cx + s * (R + 3), d.cy, xo, d.cy, xo, e.cy, e.cx + s * (R + 5), e.cy];
    }
    out.edges.push({ id: `seq:${kids[i]}>${kids[i + 1]}`, kind: "seq", from: kids[i], to: kids[i + 1], code: null, geom: { t: "path", p },
      color: c, colorB: cb, w: 1.5, dash: "", end: "arrow", start: null, opacity: 1 });
  }
  finish(out, gi, H);
  return out;
}

// ---- 4.6.6 因果 ----

const FLOWC = new Set<RelCode>(["推", "因", "据"]);

function layoutLayered(gi: GroupIn): ABlock {
  const { g, kids, blocks } = gi;
  const out = blank();
  const n = kids.length;
  const idx = new Map(kids.map((k, i) => [k, i] as const));
  // 信息流向的边：A 推/因 B ＝ A→B；A 据 B ＝ B→A
  const fe: { a: number; b: number; code: RelCode; key: string }[] = [];
  for (const k of kids) for (const e of g.outEdges[k] ?? []) {
    if (!FLOWC.has(e.code) || !idx.has(e.to) || e.to === k) continue;
    const [a, b] = e.code === "据" ? [idx.get(e.to)!, idx.get(k)!] : [idx.get(k)!, idx.get(e.to)!];
    if (!fe.some((x) => x.a === a && x.b === b)) fe.push({ a, b, code: e.code, key: ekey(k, e.to, e.code) });
  }
  const preds: number[][] = kids.map(() => []), succs: number[][] = kids.map(() => []);
  // 最长路分层，DFS 按原文顺序断环（被断的边不参与分层、也不算已表达）
  const layer = new Array<number>(n).fill(0), st = new Uint8Array(n);
  const keep = new Set<number>();
  const inEdges = kids.map((_, b) => fe.map((e, ei) => ({ e, ei })).filter(({ e }) => e.b === b));
  const visit = (i: number): number => {
    if (st[i] === 2) return layer[i];
    if (st[i] === 1) return -1;
    st[i] = 1;
    let L = 0;
    for (const { e, ei } of inEdges[i]) { const la = visit(e.a); if (la < 0) continue; keep.add(ei); L = Math.max(L, la + 1); }
    st[i] = 2; layer[i] = L; return L;
  };
  for (let i = 0; i < n; i++) visit(i);
  fe.forEach((e, ei) => { if (keep.has(ei)) { preds[e.b].push(e.a); succs[e.a].push(e.b); } });
  const maxL = Math.max(0, ...layer);
  const cols: number[][] = Array.from({ length: maxL + 1 }, () => []);
  for (let i = 0; i < n; i++) cols[layer[i]].push(i);
  const pos = new Array<number>(n).fill(0);
  const reindex = () => cols.forEach((c) => c.forEach((i, k) => (pos[i] = k)));
  reindex();
  const sortBy = (c: number[], nb: (i: number) => number[]) =>
    c.map((i, k) => { const v = nb(i); return { i, k, b: v.length ? v.reduce((s, j) => s + pos[j], 0) / v.length : Infinity }; })
      .sort((a, b) => (a.b === b.b ? a.k - b.k : a.b - b.b)).map((x) => x.i);
  for (let r = 0; r < AL.LY_ROUNDS; r++) {
    if (r % 2 === 0) for (let L = 1; L <= maxL; L++) cols[L] = sortBy(cols[L], (i) => preds[i]);
    else for (let L = maxL - 1; L >= 0; L--) cols[L] = sortBy(cols[L], (i) => succs[i]);
    reindex();
  }
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  const y0 = H.h + AL.HEAD_GAP;
  const colX: number[] = [];
  cols.reduce((x, c, L) => ((colX[L] = x), x + Math.max(0, ...c.map((i) => blocks[i].w)) + AL.LY_GX), 0);
  const px = new Array<number>(n).fill(0), py = new Array<number>(n).fill(0);
  const mid = (i: number) => py[i] + blocks[i].anchor.y + blocks[i].anchor.h / 2;
  cols.forEach((c, L) => {
    let cur = y0;
    for (const i of c) {
      const ps = preds[i];
      const want = L > 0 && ps.length ? ps.reduce((s, j) => s + mid(j), 0) / ps.length - (blocks[i].anchor.y + blocks[i].anchor.h / 2) : cur;
      px[i] = colX[L];
      py[i] = Math.round(Math.max(cur, want));
      cur = py[i] + blocks[i].h + AL.LY_GY;
    }
  });
  for (let i = 0; i < n; i++) put(out, blocks[i], px[i], py[i]);
  const A = (i: number) => anchorAt(blocks[i], px[i], py[i]);
  // 端口：出边在源锚点右缘、入边在目标锚点左缘，按对侧纵坐标均分
  const outs = kids.map((_, i) => fe.filter((e, ei) => keep.has(ei) && e.a === i).sort((x, y) => A(x.b).y - A(y.b).y));
  const ins = kids.map((_, i) => fe.filter((e, ei) => keep.has(ei) && e.b === i).sort((x, y) => A(x.a).y - A(y.a).y));
  const at = (B: Box, k: number, m: number) => B.y + B.h / 2 + (m > 1 ? ((k + 1) / (m + 1) - 0.5) * B.h * 0.6 : 0);
  fe.forEach((e, ei) => {
    if (!keep.has(ei)) return;
    const S = A(e.a), T = A(e.b);
    const x0 = S.x + S.w + 3, x1 = T.x - 5;
    const y0 = at(S, outs[e.a].indexOf(e), outs[e.a].length), y1 = at(T, ins[e.b].indexOf(e), ins[e.b].length);
    const dx = Math.max(40, x1 - x0);
    out.edges.push(relEdge(`ly:${kids[e.a]}>${kids[e.b]}`, kids[e.a], kids[e.b], e.code, [x0, y0, x0 + dx * 0.5, y0, x1 - dx * 0.5, y1, x1, y1],
      blocks[e.a].glyphs[0].color, blocks[e.b].glyphs[0].color));
    out.consumed.push(e.key);
  });
  finish(out, gi, H);
  return out;
}

// ---- 4.6.7 对照 ----

function layoutCompare(g: GraphState, o: AtlasOpts, id: string, head0: AGlyph, members: string[], patternOut: Map<string, FlowPattern>): ABlock {
  const gi0: GroupIn = { id, pattern: "compare", head: head0, kids: members, blocks: [], more: null, g, o };
  const tb = compareTable(g, members, AL.CMP_MAX_DIMS);
  const out = blank();
  const colorOf = (j: number) => o.colors.palette[j % 8];
  // 栏头（成员）：字形只画名字；成员的子节点作为单元格，所以 kids 记 0、expanded 记 true
  const heads = members.map((m, j) => { const gl = makeGlyph(g, o, m, id, "colhead", colorOf(j)); gl.expanded = true; return leaf(gl); });
  if (!tb.dims.length) {
    // 没有可对齐的维度：退为并列网格，但成员各自照常展开
    const blocks = members.map((m, j) => buildBlock(g, o, m, id, "tile", colorOf(j), null, patternOut));
    return layoutGrid({ ...gi0, pattern: "grid", blocks });
  }
  const used = new Set<string>();
  const cell = (c: { id: string; text: string } | null, j: number) => {
    if (!c) return null;
    used.add(c.id);
    return buildBlock(g, o, c.id, members[j], "cell", colorOf(j), null, patternOut, tb.how === "named" ? c.text : undefined);
  };
  const grid: (ABlock | null)[][] = tb.dims.map((_, d) => members.map((_, j) => cell(tb.rows[j].cells[d], j)));
  // 「其他」行：每栏里未进表的子节点竖向叠放
  const rest = members.map((m, j) => childrenOf(g, m).filter((k) => g.nodes[k] && !used.has(k)).map((k) => buildBlock(g, o, k, m, "cell", colorOf(j), null, patternOut)));
  const hasRest = rest.some((l) => l.length);
  const colW = members.map((_, j) => Math.max(AL.CMP_COL_W, heads[j].w, ...grid.map((r) => r[j]?.w ?? 0), ...rest[j].map((b) => b.w)));
  const colX: number[] = [];
  colW.reduce((x, w, j) => ((colX[j] = x), x + w + AL.CMP_GX), AL.CMP_DIM_W);
  const tableW = colX[members.length - 1] + colW[members.length - 1];
  const H = { ...head0, x: 0, y: 0 };
  out.glyphs.push(H);
  let y = H.h + AL.HEAD_GAP;
  // 栏头行
  members.forEach((m, j) => {
    out.decos.push({ k: "rect", id: `band:${m}`, x: colX[j], y, w: colW[j], h: 4, rx: 1, fill: colorOf(j), opacity: 1 });
    put(out, heads[j], colX[j], y + 10);
  });
  const headH = Math.max(...heads.map((b) => b.h)) + 16;
  // 栏名之间的「比」
  for (let j = 0; j + 1 < members.length; j++) {
    const a = members[j], b = members[j + 1];
    const hit = (g.outEdges[a] ?? []).some((e) => e.to === b && e.code === "比") || (g.outEdges[b] ?? []).some((e) => e.to === a && e.code === "比");
    if (!hit) continue;
    const cy = y + 10 + heads[j].h / 2, xa = colX[j] + heads[j].w + 8, xb = colX[j + 1] - 6;
    if (xb - xa < 12) continue;
    out.edges.push(relEdge(`cmp:${a}>${b}`, a, b, "比", [xa, cy, xa + (xb - xa) / 3, cy, xb - (xb - xa) / 3, cy, xb, cy], colorOf(j), colorOf(j + 1)));
    out.consumed.push(ekey(a, b, "比"), ekey(b, a, "比"));
  }
  y += headH;
  // 维度行
  const rowsAll: { label: string; cells: (ABlock | ABlock[] | null)[] }[] = tb.dims.map((d, di) => ({ label: d.label, cells: grid[di] }));
  if (hasRest) rowsAll.push({ label: o.otherLabel, cells: rest });
  rowsAll.forEach((row, di) => {
    const hOf = (c: ABlock | ABlock[] | null) => (!c ? 0 : Array.isArray(c) ? c.reduce((s, b) => s + b.h + 6, -6) : c.h);
    const rh = Math.max(AL.CMP_ROW_MIN, ...row.cells.map(hOf)) + AL.CMP_ROW_PAD * 2;
    if (di % 2 === 1) out.decos.push({ k: "rect", id: `zebra:${id}:${di}`, x: 0, y, w: tableW, h: rh, rx: 4, fill: o.colors.fg, opacity: 0.03 });
    out.decos.push({ k: "text", id: `dim:${id}:${di}`, x: 4, y: y + AL.CMP_ROW_PAD + 13, text: row.label, fs: 11, weight: 500, fill: o.colors.fg, opacity: 0.52, anchor: "start", mono: false });
    row.cells.forEach((c, j) => {
      if (!c) return;
      if (Array.isArray(c)) { let cy = y + AL.CMP_ROW_PAD; for (const b of c) { put(out, b, colX[j], cy); cy += b.h + 6; } }
      else put(out, c, colX[j], y + AL.CMP_ROW_PAD);
    });
    y += rh;
    out.decos.push({ k: "rect", id: `hr:${id}:${di}`, x: 0, y: y - 1, w: tableW, h: 1, rx: 0, fill: o.colors.fg, opacity: 0.08 });
  });
  // 「比」配对口径：同一行的单元格之间的「比」已由表格表达
  if (tb.how === "paired") for (const r of tb.dims.keys()) {
    const ids = tb.rows.map((row) => row.cells[r]?.id).filter((x): x is string => !!x);
    for (const a of ids) for (const b of ids) if (a !== b) out.consumed.push(ekey(a, b, "比"));
  }
  patternOut.set(id, "compare");
  finish(out, gi0, H);
  return out;
}

// ---------------------------------------------------------------- §4.7 展开集

/** 根 → 焦点（含两端）；焦点未知 / 祖先链断 → [ROOT_ID] */
export function atlasChain(g: GraphState, focus: string): string[] {
  if (focus === ROOT_ID || !g.nodes[focus]) return [ROOT_ID];
  const anc = ancestors(g, focus);
  const top = anc.length ? anc[0] : focus;
  if (g.nodes[top]?.parentId != null) return [ROOT_ID];
  return [ROOT_ID, ...anc, focus];
}
const kidCount = (g: GraphState, id: string) => childrenOf(g, id).filter((k) => !!g.nodes[k]).length;

/** 默认展开：根→焦点路径 + 焦点；再广度优先展开浅层，直到可见节点数将超过 budget */
export function defaultExpanded(g: GraphState, focus: string, budget: number = AL.BUDGET): Set<string> {
  const s = new Set<string>(atlasChain(g, focus));
  let count = 1;
  for (const id of s) count += Math.min(kidCount(g, id), AL.MORE_MAX);
  const queue = childrenOf(g, ROOT_ID).filter((k) => !!g.nodes[k]);
  while (queue.length) {
    const id = queue.shift()!;
    const k = kidCount(g, id);
    if (!k) continue;
    if (!s.has(id)) {
      if (count + Math.min(k, AL.MORE_MAX) > budget) break;
      s.add(id);
      count += Math.min(k, AL.MORE_MAX);
    }
    for (const c of childrenOf(g, id)) if (g.nodes[c]) queue.push(c);
  }
  return s;
}
/** 聚焦某节点时：确保路径与它本身展开（返回新集合；未变化则返回原引用） */
export function expandFor(g: GraphState, prev: ReadonlySet<string>, focus: string): ReadonlySet<string> {
  const need = atlasChain(g, focus).filter((id) => kidCount(g, id) > 0 && !prev.has(id));
  if (!need.length) return prev;
  const s = new Set(prev);
  for (const id of need) s.add(id);
  return s;
}

// ---------------------------------------------------------------- §4.8 结构距离

/** 树上两节点的跳数（经最近公共祖先）；封顶 HOP_CAP */
export function hopFrom(g: GraphState, focus: string): (nodeId: string | null) => number {
  const chainF = atlasChain(g, focus);
  return (id) => {
    if (!id) return AL.HOP_CAP;
    const ch = atlasChain(g, id);
    let k = 0;
    while (k < ch.length && k < chainF.length && ch[k] === chainF[k]) k++;
    return Math.min(AL.HOP_CAP, ch.length - k + (chainF.length - k));
  };
}

// ---------------------------------------------------------------- §4.9 跨组关系

export interface AStrand { id: string; from: string; to: string; code: RelCode; p: number[]; color: string; colorB: string; w: number; dash: string; end: AEdge["end"]; start: AEdge["start"]; strong: boolean; viaRep: boolean; mid: { x: number; y: number } }

/** 只为「碰到 hot 集合」或 all=true 的边生成几何；端点不可见时连到最近的可见祖先（viaRep，画虚线） */
export function crossStrands(g: GraphState, sc: AtlasScene, o: { hot: ReadonlySet<string>; all: boolean; colors: FlowColors }): AStrand[] {
  const rep = (id: string): AGlyph | null => {
    if (sc.byNode.has(id)) return sc.byNode.get(id)!;
    for (const a of ancestors(g, id).reverse()) if (sc.byNode.has(a)) return sc.byNode.get(a)!;
    return sc.byNode.get(ROOT_ID) ?? null;
  };
  const out: AStrand[] = [];
  const seen = new Set<string>();
  for (const from of Object.keys(g.outEdges)) for (const e of g.outEdges[from] ?? []) {
    const key = ekey(e.from, e.to, e.code);
    if (seen.has(key) || sc.consumed.has(key) || e.from === e.to) continue;
    const strong = o.hot.has(e.from) || o.hot.has(e.to);
    if (!strong && !o.all) continue;
    const A = rep(e.from), B = rep(e.to);
    if (!A || !B || A === B) continue;
    seen.add(key);
    const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
    const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
    const sx = Math.sign(bx - ax) || 1, sy = Math.sign(by - ay) || 1;
    const p0 = horiz ? [sx > 0 ? A.x + A.w + 3 : A.x - 3, ay] : [ax, sy > 0 ? A.y + A.h + 3 : A.y - 3];
    const p3 = horiz ? [sx > 0 ? B.x - 5 : B.x + B.w + 5, by] : [bx, sy > 0 ? B.y - 5 : B.y + B.h + 5];
    const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const k = Math.min(220, Math.max(40, dist * 0.4));
    const c1 = horiz ? [p0[0] + sx * k, p0[1]] : [p0[0], p0[1] + sy * k];
    const c2 = horiz ? [p3[0] - sx * k, p3[1]] : [p3[0], p3[1] - sy * k];
    const st = REL_STYLE[e.code];
    const viaRep = A.nodeId !== e.from || B.nodeId !== e.to;
    const mid = { x: 0.125 * p0[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * p3[0], y: 0.125 * p0[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * p3[1] };
    out.push({ id: `x:${key}`, from: e.from, to: e.to, code: e.code, p: [...p0, ...c1, ...c2, ...p3],
      color: strong ? o.colors.accent : A.color, colorB: strong ? o.colors.accent : B.color,
      w: st.width + 0.25, dash: viaRep ? "3 4" : st.dash, end: st.end as AEdge["end"], start: st.start as AEdge["start"], strong, viaRep, mid });
  }
  return out.slice(0, o.all ? 400 : 60);
}

// ---------------------------------------------------------------- §4.10 空间导航

/** 从 from 字形出发，在 dir 方向 ±60° 扇区内找「距离 + 2×横向偏离」最小的字形（跳过 more） */
export function spatialNext(sc: AtlasScene, fromId: string, dir: "up" | "down" | "left" | "right"): AGlyph | null {
  const A = sc.byNode.get(fromId);
  if (!A) return null;
  const ax = A.x + A.w / 2, ay = A.y + A.h / 2;
  const [ux, uy] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  let best: AGlyph | null = null, bestS = Infinity;
  for (const B of sc.glyphs) {
    if (B === A || !B.nodeId) continue;
    const dx = B.x + B.w / 2 - ax, dy = B.y + B.h / 2 - ay;
    const along = dx * ux + dy * uy;
    if (along <= 4) continue;
    const across = Math.abs(dx * uy - dy * ux);
    if (across > along * Math.tan(Math.PI / 3)) continue;
    const s = along + 2 * across;
    if (s < bestS) { bestS = s; best = B; }
  }
  return best;
}

// ---------------------------------------------------------------- §4.11 快照映射

export interface DOMRectLike { left: number; top: number; width: number; height: number }
export interface FlowSnapshot { cut: string | null; readingId: string | null; items: Map<string, DOMRectLike>; bars: Map<string, DOMRectLike> }

/** 随文结构的图没有抬升材料根，全景抬升了：真实根 id → ROOT_ID */
export function normalizeSnapshot(s: FlowSnapshot, rootRealId: string | null): FlowSnapshot {
  if (!rootRealId) return s;
  const fix = (id: string) => (id === `n:${rootRealId}` ? `n:${ROOT_ID}` : id);
  return {
    cut: s.cut === rootRealId ? ROOT_ID : s.cut,
    readingId: s.readingId === rootRealId ? ROOT_ID : s.readingId,
    items: new Map([...s.items].map(([k, v]) => [fix(k), v] as const)),
    bars: new Map([...s.bars].map(([k, v]) => [k === rootRealId ? ROOT_ID : k, v] as const)),
  };
}
/** 快照里的行 → 全景字形 id 的映射（只认 `n:` 行） */
export const snapGlyphId = (itemId: string) => (itemId.startsWith("n:") ? `g:${itemId.slice(2)}` : null);
