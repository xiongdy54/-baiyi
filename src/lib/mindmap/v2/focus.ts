// 材料导图 v2 · 聚焦图谱（阅读透镜 v2，用户 2026-10-18 第二轮反馈）。
// 纯函数、确定性、无 DOM：从完整图谱里裁出「以正在读的这一点为中心」的小图，并按窄面板排版。
//
// 裁剪规则（buildFocus）：
//   · 焦点 F＝阅读位置所在的最深节点（或用户在图里点选的节点）；
//   · 整体 W＝F 的父节点——「这一段属于哪个更大的整体」；W 以上只留标题链（crumbs），不进图；
//   · 成员＝W 的子（F 与它的同层兄弟），按原文顺序；超过 MAX_MEMBERS 时取以 F 为中心的窗口，
//     窗口外但与 F 有关系的成员也保留，其余折成「另 N 项」；
//   · F 的下一层（≤ MAX_KIDS）挂在 F 下面；
//   · 关系：一端落在图内（W / 成员 / F 的子）的全部关系边；另一端不在图内的，把对端作为「别处」节点
//     放进右列（≤ MAX_EXT，按「碰到 F > 碰到 F 的子 / W > 碰到其他成员」排序）。
// 排版规则（layoutFocus）：左列＝结构（W 在上，成员沿左侧树干排下来，F 的子缩进挂在 F 下）；
//   右侧＝关系：图内两点之间的关系画成卡片右侧的弧，通往别处的关系连到右列卡片。
//   左结构、右关系，两种线不混在一侧。全部坐标为整数 px。

import type { GraphState, PatternKey, RelCode, V2Edge, V2Node } from "./types";
import { charEm, fitText } from "./measure";
import { groupFacts, selectPattern, type PatternHow } from "./pattern";

export type FocusRole = "focus" | "whole" | "member" | "child" | "cell" | "external";

export interface FocusItem {
  id: string;
  node: V2Node;
  role: FocusRole;
  /** 与焦点直接相连（父子 / 关系）——其余成员淡显 */
  linked: boolean;
  /** 别处节点：它所在的整体（父节点标题）；图内节点为空 */
  context: string;
}

export interface FocusRel {
  from: string;
  to: string;
  code: RelCode;
  /** 两端都在左列（图内弧）；否则一端是右列别处节点 */
  internal: boolean;
  touchesFocus: boolean;
}

export interface FocusGap {
  /** 折叠的成员 id（原文顺序） */
  ids: string[];
  /** 排在哪个成员之后；null＝排在最前 */
  after: string | null;
}

export interface FocusModel {
  focusId: string;
  wholeId: string | null;
  /** W 以上的标题链（顶层 → W 的父），不含材料根 */
  crumbs: string[];
  items: FocusItem[];
  /** 成员序列（含 F），原文顺序；gaps 插在其间 */
  members: string[];
  gaps: FocusGap[];
  kids: string[];
  moreKids: number;
  rels: FocusRel[];
  /** 整体这一组的版式（AI 生成时给的 `{版式}` 提示 / 用户手动 / 规则推断）——决定聚焦图的排法与摆放位置 */
  pattern: PatternKey;
  patternHow: PatternHow;
  /** 对照版式：每个非焦点成员的子（栏内格），焦点成员的格即 kids */
  cells: Record<string, string[]>;
}

export const FOCUS = {
  MAX_MEMBERS: 7,
  MAX_KIDS: 5,
  MAX_EXT: 5,
  /** 只碰到其他成员（不碰焦点 / 焦点的子 / 整体）的别处节点上限 */
  MAX_WEAK_EXT: 2,
  /** 对照版式每栏的格数上限 */
  MAX_CELLS: 4,
} as const;

const titleOf = (n: V2Node | undefined) => (n ? String(n.title || "") : "");

/** 裁出聚焦小图；焦点不存在返回 null */
export function buildFocus(g: GraphState, focusId: string): FocusModel | null {
  const F = g.nodes[focusId];
  if (!F) return null;
  const W = F.parentId != null ? g.nodes[F.parentId] ?? null : null;
  const wholeId = W ? W.id : null;

  // W 以上的标题链（去掉材料根：parentId==null 的那一行就是材料标题卡）
  const crumbs: string[] = [];
  if (W) {
    let cur = W.parentId != null ? g.nodes[W.parentId] : undefined;
    let guard = 0;
    const up: string[] = [];
    while (cur && guard++ < 64) {
      if (cur.parentId != null) up.push(titleOf(cur));
      cur = cur.parentId != null ? g.nodes[cur.parentId] : undefined;
    }
    crumbs.push(...up.reverse());
  }

  const allMembers = W ? (g.children[W.id] ?? []).filter((id) => g.nodes[id]) : [F.id];
  const relOf = (id: string): V2Edge[] => [...(g.outEdges[id] ?? []), ...(g.inEdges[id] ?? [])];
  const fRels = relOf(F.id);
  const linkedToF = new Set<string>();
  for (const e of fRels) linkedToF.add(e.from === F.id ? e.to : e.from);

  // 成员窗口
  let members: string[] = allMembers.slice();
  const gaps: FocusGap[] = [];
  if (allMembers.length > FOCUS.MAX_MEMBERS) {
    const i = Math.max(0, allMembers.indexOf(F.id));
    let lo = Math.max(0, i - Math.floor((FOCUS.MAX_MEMBERS - 1) / 2));
    const hi = Math.min(allMembers.length, lo + FOCUS.MAX_MEMBERS);
    lo = Math.max(0, hi - FOCUS.MAX_MEMBERS);
    const keep = new Set(allMembers.slice(lo, hi));
    for (const id of allMembers) if (linkedToF.has(id)) keep.add(id);
    members = allMembers.filter((id) => keep.has(id));
    let run: string[] = [];
    let last: string | null = null;
    for (const id of allMembers) {
      if (keep.has(id)) {
        if (run.length) gaps.push({ ids: run, after: last });
        run = [];
        last = id;
      } else run.push(id);
    }
    if (run.length) gaps.push({ ids: run, after: last });
  }

  const allKids = (g.children[F.id] ?? []).filter((id) => g.nodes[id]);
  const kids = allKids.slice(0, FOCUS.MAX_KIDS);
  const moreKids = allKids.length - kids.length;

  const sel = W ? selectPattern(groupFacts(g, W.id, allMembers)) : { pattern: "tree" as PatternKey, how: "rule" as PatternHow };
  const cells: Record<string, string[]> = {};
  if (sel.pattern === "compare") {
    for (const id of members) if (id !== F.id) cells[id] = (g.children[id] ?? []).filter((c) => g.nodes[c]).slice(0, FOCUS.MAX_CELLS);
  }
  const cellIds = Object.values(cells).flat();

  const inside = new Set<string>([...members, ...kids, ...cellIds]);
  if (wholeId) inside.add(wholeId);

  // 关系：一端在图内；对端在图外 → 别处候选（按分数取前 MAX_EXT）
  const score = (id: string) => (id === F.id ? 3 : kids.includes(id) || id === wholeId ? 2 : 1);
  const underInside = (id: string) => {
    let cur = g.nodes[id];
    let guard = 0;
    while (cur && cur.parentId != null && guard++ < 64) {
      if (inside.has(cur.parentId) && cur.parentId !== wholeId) return true;
      cur = g.nodes[cur.parentId];
    }
    return false;
  };
  const seen = new Set<string>();
  const internal: FocusRel[] = [];
  const extCand = new Map<string, { best: number; ord: number; edges: V2Edge[] }>();
  for (const id of inside) {
    for (const e of relOf(id)) {
      const key = `${e.from}|${e.to}|${e.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = inside.has(e.from), b = inside.has(e.to);
      if (a && b) {
        if (e.from === e.to) continue;
        internal.push({ from: e.from, to: e.to, code: e.code, internal: true, touchesFocus: e.from === F.id || e.to === F.id });
        continue;
      }
      const other = a ? e.to : e.from;
      const on = a ? e.from : e.to;
      const on2 = g.nodes[other];
      if (!on2) continue;
      // 只碰到其他成员的关系：对端若就在图内某点的子树里（如另一成员自己的子），不算「别处」——不拉进来添乱
      if (score(on) === 1 && underInside(other)) continue;
      // 对端是图内节点的祖先（如 F 支持整章论点）：仍放右列——它确实是「别处」
      const c = extCand.get(other) ?? { best: 0, ord: on2.ord, edges: [] };
      c.best = Math.max(c.best, score(on));
      c.edges.push(e);
      extCand.set(other, c);
    }
  }
  let weak = 0;
  const ext = [...extCand.entries()]
    .sort((x, y) => y[1].best - x[1].best || x[1].ord - y[1].ord || (x[0] < y[0] ? -1 : 1))
    .filter(([, c]) => c.best >= 2 || weak++ < FOCUS.MAX_WEAK_EXT)
    .slice(0, FOCUS.MAX_EXT);
  const rels: FocusRel[] = internal.slice();
  for (const [, c] of ext)
    for (const e of c.edges) rels.push({ from: e.from, to: e.to, code: e.code, internal: false, touchesFocus: e.from === F.id || e.to === F.id });

  for (const r of rels) if (r.touchesFocus) linkedToF.add(r.from === F.id ? r.to : r.from);

  const items: FocusItem[] = [];
  if (W) items.push({ id: W.id, node: W, role: "whole", linked: true, context: "" });
  for (const id of members) {
    const n = g.nodes[id];
    items.push({ id, node: n, role: id === F.id ? "focus" : "member", linked: id === F.id || linkedToF.has(id), context: "" });
  }
  for (const id of kids) items.push({ id, node: g.nodes[id], role: "child", linked: true, context: "" });
  for (const id of cellIds) items.push({ id, node: g.nodes[id], role: "cell", linked: linkedToF.has(id), context: "" });
  for (const [id] of ext) {
    const n = g.nodes[id];
    const p = n.parentId != null ? g.nodes[n.parentId] : undefined;
    items.push({ id, node: n, role: "external", linked: linkedToF.has(id), context: p && p.parentId != null ? titleOf(p) : "" });
  }
  return { focusId: F.id, wholeId, crumbs, items, members, gaps, kids, moreKids, rels, pattern: sel.pattern, patternHow: sel.how, cells };
}

// ───────────────────────── 排版 ─────────────────────────

export const FOCUS_GEOM = {
  PAD: 12,
  /** 树干到卡片左缘 */
  ELBOW: 14,
  /** 成员卡与右列之间的关系通道 */
  GAP: 46,
  /** 无右列时给图内弧留的通道 */
  ARC_ROOM: 34,
  KID_INDENT: 18,
  VGAP: 8,
  padX: 10,
  padY: 7,
  metaSize: 11,
  metaH: 15,
} as const;

const SIZE: Record<FocusRole, { font: number; line: number; lines: number }> = {
  whole: { font: 13, line: 18, lines: 2 },
  focus: { font: 14, line: 20, lines: 3 },
  member: { font: 13, line: 18, lines: 2 },
  child: { font: 12, line: 17, lines: 2 },
  cell: { font: 12, line: 17, lines: 2 },
  external: { font: 12, line: 17, lines: 2 },
};

/** 按估宽断行（与 measure.ts 同口径），最后一行放不下加省略号 */
export function wrapText(text: string, size: number, maxW: number, maxLines: number): string[] {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return [""];
  const lines: string[] = [];
  let cur = "";
  let w = 0;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cw = charEm(ch.codePointAt(0) as number) * size;
    if (w + cw > maxW && cur) {
      lines.push(cur);
      if (lines.length === maxLines) {
        // 末行加省略号
        let last = lines[maxLines - 1];
        const ell = charEm(0x2026) * size;
        let lw = 0;
        for (const c of last) lw += charEm(c.codePointAt(0) as number) * size;
        while (last && lw + ell > maxW) {
          const arr = [...last];
          const c = arr.pop() as string;
          lw -= charEm(c.codePointAt(0) as number) * size;
          last = arr.join("");
        }
        lines[maxLines - 1] = last + "…";
        return lines;
      }
      cur = ch === " " ? "" : ch;
      w = ch === " " ? 0 : cw;
    } else {
      cur += ch;
      w += cw;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface FocusBox {
  id: string;
  role: FocusRole;
  linked: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  meta: string;
  lines: string[];
  font: number;
  line: number;
}

export interface FocusPath {
  key: string;
  kind: "tree" | "rel" | "seq";
  d: string;
  code?: RelCode;
  /** 关系的语义方向（数据 from → to；「据」已换成画法方向） */
  from?: string;
  to?: string;
  touchesFocus?: boolean;
  /** 关系码徽标位置 */
  lx?: number;
  ly?: number;
  /** 树线是否通往焦点（加重） */
  strong?: boolean;
}

export interface FocusGapBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

/** 排法家族：tree＝纵向树（窄高）；topdown＝论证图（论点在上、支持左下、反方右下）；
 *  flow＝横向流程（链 / 时间线 / 分层）；columns＝对照分栏。 */
export type FocusFamily = "tree" | "topdown" | "flow" | "columns";
/** 摆放：float＝浮窗（窄高的图）；dock＝正文下方（宽矮的图） */
export type FocusHost = "float" | "dock";

export interface FocusDecor {
  kind: "frame" | "axis" | "tick" | "label";
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
}

export interface FocusLayout {
  width: number;
  height: number;
  boxes: FocusBox[];
  paths: FocusPath[];
  gaps: FocusGapBox[];
  family: FocusFamily;
  host: FocusHost;
  decor: FocusDecor[];
}

export interface LayoutLabels {
  /** 节点类型显示名（已本地化）；返回空串＝不显示 */
  type: (n: V2Node) => string;
  /** 「另 N 项」 */
  more: (n: number) => string;
}

function layoutTree(m: FocusModel, width: number, labels: LayoutLabels): FocusLayout {
  const K = FOCUS_GEOM;
  const W = Math.max(260, Math.round(width));
  const byId = new Map(m.items.map((it) => [it.id, it]));
  const hasExt = m.items.some((it) => it.role === "external");
  const hasInternal = m.rels.some((r) => r.internal);
  const spineX = K.PAD + 4;
  const leftX = spineX + K.ELBOW;
  const extW = hasExt ? Math.max(112, Math.min(184, Math.round(W * 0.34))) : 0;
  const extX = W - K.PAD - extW;
  const right = hasExt ? extX - K.GAP : W - K.PAD - (hasInternal ? K.ARC_ROOM : 0);
  const boxes: FocusBox[] = [];
  const paths: FocusPath[] = [];
  const gapBoxes: FocusGapBox[] = [];
  const pos = new Map<string, FocusBox>();

  const mk = (it: FocusItem, x: number, y: number, w: number): FocusBox => {
    const sz = SIZE[it.role];
    const type = labels.type(it.node);
    const meta = fitText(it.role === "external" ? [it.context, type].filter(Boolean).join(" · ") : type, K.metaSize, w - K.padX * 2);
    const lines = wrapText(it.node.title, sz.font, w - K.padX * 2, sz.lines);
    const h = K.padY * 2 + (meta ? K.metaH : 0) + lines.length * sz.line;
    const b: FocusBox = { id: it.id, role: it.role, linked: it.linked, x, y, w, h, meta, lines, font: sz.font, line: sz.line };
    boxes.push(b);
    pos.set(it.id, b);
    return b;
  };

  let y = K.PAD;
  let trunkTop: number | null = null;
  const whole = m.wholeId ? byId.get(m.wholeId) : undefined;
  if (whole) {
    const b = mk(whole, spineX - 6, y, right - (spineX - 6));
    trunkTop = b.y + b.h;
    y += b.h + 12;
  }
  const elbows: { mid: number; strong: boolean; dashed?: boolean; key: string }[] = [];
  const gapAfter = new Map<string | null, FocusGap>();
  for (const gp of m.gaps) gapAfter.set(gp.after, gp);
  const placeGap = (gp: FocusGap | undefined) => {
    if (!gp) return;
    const h = 22;
    gapBoxes.push({ key: `gap:${gp.ids[0]}`, x: leftX, y, w: Math.min(right - leftX, 120), h, count: gp.ids.length });
    elbows.push({ mid: y + h / 2, strong: false, dashed: true, key: `gap:${gp.ids[0]}` });
    y += h + K.VGAP;
  };
  placeGap(gapAfter.get(null));
  for (const id of m.members) {
    const it = byId.get(id);
    if (!it) continue;
    const b = mk(it, leftX, y, right - leftX);
    elbows.push({ mid: b.y + Math.min(b.h / 2, 18), strong: it.role === "focus", key: id });
    y += b.h + K.VGAP;
    if (it.role === "focus" && (m.kids.length || m.moreKids)) {
      const kx = leftX + K.KID_INDENT;
      const kSpine = leftX + 8;
      const top = b.y + b.h;
      let lastMid = top;
      for (const kid of m.kids) {
        const kit = byId.get(kid);
        if (!kit) continue;
        const kb = mk(kit, kx, y, right - kx);
        const mid = kb.y + Math.min(kb.h / 2, 16);
        paths.push({ key: `kid:${kid}`, kind: "tree", d: `M${kSpine},${top} V${mid - 5} Q${kSpine},${mid} ${kSpine + 5},${mid} H${kx}`, strong: true });
        lastMid = mid;
        y += kb.h + 6;
      }
      if (m.moreKids) {
        const h = 20;
        gapBoxes.push({ key: `kids-more`, x: kx, y, w: Math.min(right - kx, 110), h, count: m.moreKids });
        const mid = y + h / 2;
        paths.push({ key: `kid:more`, kind: "tree", d: `M${kSpine},${lastMid} V${mid - 5} Q${kSpine},${mid} ${kSpine + 5},${mid} H${kx}`, strong: false });
        y += h + 6;
      }
      y += K.VGAP - 6;
    }
    placeGap(gapAfter.get(id));
  }
  // 树干 + 肘线（无整体时也画：成员仍是一组）
  if (elbows.length) {
    const top = trunkTop ?? elbows[0].mid;
    for (const e of elbows) {
      const d = e.mid - top < 6 ? `M${spineX},${top} V${e.mid} H${leftX}` : `M${spineX},${top} V${e.mid - 5} Q${spineX},${e.mid} ${spineX + 5},${e.mid} H${leftX}`;
      paths.push({ key: `trunk:${e.key}`, kind: "tree", d, strong: e.strong });
    }
  }
  const leftBottom = y;

  // 右列：别处节点，尽量与它连接的图内节点对齐
  const anchorY = (id: string) => {
    const b = pos.get(id);
    return b ? b.y + Math.min(b.h / 2, 18) : 0;
  };
  const exts = m.items.filter((it) => it.role === "external");
  const want = exts.map((it) => {
    const ys = m.rels.filter((r) => !r.internal && (r.from === it.id || r.to === it.id)).map((r) => anchorY(r.from === it.id ? r.to : r.from));
    return { it, y: ys.length ? Math.min(...ys) : K.PAD };
  });
  want.sort((a, b) => a.y - b.y || (a.it.id < b.it.id ? -1 : 1));
  let ey = K.PAD;
  for (const w of want) {
    const sz = SIZE.external;
    const type = labels.type(w.it.node);
    const meta = [w.it.context, type].filter(Boolean).join(" · ");
    const lines = wrapText(w.it.node.title, sz.font, extW - K.padX * 2, sz.lines);
    const h = K.padY * 2 + (meta ? K.metaH : 0) + lines.length * sz.line;
    const top = Math.max(ey, Math.round(w.y - Math.min(h / 2, 18)));
    mk(w.it, extX, top, extW);
    ey = top + h + K.VGAP;
  }

  // 关系线：三次贝塞尔；徽标沿曲线找不与已放徽标相撞的位置
  type Cubic = [number, number, number, number, number, number, number, number];
  const at = (c: Cubic, t: number): [number, number] => {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
  };
  const badges: [number, number][] = [];
  const BADGE = 17;
  const placeBadge = (c: Cubic): [number, number] => {
    let best: [number, number] = at(c, 0.5);
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
      const p = at(c, t);
      if (badges.every(([x, y]) => Math.abs(x - p[0]) >= BADGE || Math.abs(y - p[1]) >= BADGE)) {
        best = p;
        break;
      }
    }
    const r: [number, number] = [Math.round(best[0]), Math.round(best[1])];
    badges.push(r);
    return r;
  };
  const cubicD = (c: Cubic) => `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;
  const cardRight = (b: FocusBox) => b.x + b.w;
  const internals = m.rels.filter((r) => r.internal).map((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    return a && b ? { r, a, b, span: Math.abs(anchorY(r.from) - anchorY(r.to)) } : null;
  }).filter(Boolean) as { r: FocusRel; a: FocusBox; b: FocusBox; span: number }[];
  internals.sort((x, y2) => x.span - y2.span || (x.r.from < y2.r.from ? -1 : 1));
  const LANES = 3;
  const lanes: { y0: number; y1: number }[][] = Array.from({ length: LANES }, () => []);
  for (const it of internals) {
    const ya = anchorY(it.r.from), yb = anchorY(it.r.to);
    const y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
    let lane = lanes.findIndex((L) => L.every((sg) => sg.y1 < y0 - 2 || sg.y0 > y1 + 2));
    if (lane < 0) lane = LANES - 1;
    lanes[lane].push({ y0, y1 });
    const [from, to] = it.r.code === "据" ? [it.b, it.a] : [it.a, it.b];
    const x1 = cardRight(from), x2 = cardRight(to);
    const fy = anchorY(from.id), ty = anchorY(to.id);
    const cx = Math.max(x1, x2) + 16 + lane * 13;
    const c: Cubic = [x1, fy, cx, fy, cx, ty, x2 + 3, ty];
    const [lx, ly] = placeBadge(c);
    paths.push({ key: `rel:${it.r.from}|${it.r.to}|${it.r.code}`, kind: "rel", code: it.r.code, from: from.id, to: to.id, touchesFocus: it.r.touchesFocus, d: cubicD(c), lx, ly });
  }
  for (const r of m.rels) {
    if (r.internal) continue;
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) continue;
    const ext = a.role === "external" ? a : b;
    const inn = ext === a ? b : a;
    const yi = anchorY(inn.id), ye = anchorY(ext.id);
    const xi = cardRight(inn), xe = ext.x;
    const mx = (xi + xe) / 2;
    // 画法方向：数据 from → to（「据」反向）；箭头端由画法方向决定
    const [df, dt] = r.code === "据" ? [r.to, r.from] : [r.from, r.to];
    const forward = df === inn.id; // 箭头指向右列
    const c: Cubic = forward ? [xi, yi, mx, yi, mx, ye, xe - 3, ye] : [xe, ye, mx, ye, mx, yi, xi + 3, yi];
    const [lx, ly] = placeBadge(c);
    paths.push({ key: `rel:${r.from}|${r.to}|${r.code}`, kind: "rel", code: r.code, from: df, to: dt, touchesFocus: r.touchesFocus, d: cubicD(c), lx, ly });
  }

  const height = Math.max(leftBottom, ey, ...boxes.map((b) => b.y + b.h + K.VGAP)) + K.PAD - K.VGAP;
  return { width: W, height: Math.round(height), boxes, paths, gaps: gapBoxes, family: "tree", host: "float", decor: [] };
}

// ───────────────────────── 按版式选排法（阅读透镜 v2 第三轮，用户 2026-10-18） ─────────────────────────
// AI 生成图谱时已给每组附带 `{版式}` 提示（patternHint；无则规则推断，见 pattern.ts selectPattern）——
// 聚焦图沿用同一个参数决定「怎么排」和「放在哪」：窄高的（树 / 网格 / 论证）进浮窗，宽矮的（链 / 时间线 / 分层 / 对照）进正文下方。

export const FAMILY_OF: Record<PatternKey, FocusFamily> = {
  tree: "tree",
  grid: "tree",
  argument: "topdown",
  chain: "flow",
  timeline: "flow",
  layered: "flow",
  compare: "columns",
};
export const HOST_OF: Record<FocusFamily, FocusHost> = { tree: "float", topdown: "float", flow: "dock", columns: "dock" };

/** 论证图里放到右侧（反方一侧）的类型 */
const CON_TYPES: ReadonlySet<string> = new Set(["反方观点", "反驳", "让步"]);

type Cubic = [number, number, number, number, number, number, number, number];
const cubicAt = (c: Cubic, t: number): [number, number] => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
};
const cubicD = (c: Cubic) => `M${Math.round(c[0])},${Math.round(c[1])} C${Math.round(c[2])},${Math.round(c[3])} ${Math.round(c[4])},${Math.round(c[5])} ${Math.round(c[6])},${Math.round(c[7])}`;

interface Ctx {
  m: FocusModel;
  labels: LayoutLabels;
  boxes: FocusBox[];
  paths: FocusPath[];
  gaps: FocusGapBox[];
  decor: FocusDecor[];
  pos: Map<string, FocusBox>;
  byId: Map<string, FocusItem>;
  badges: [number, number][];
}

function newCtx(m: FocusModel, labels: LayoutLabels): Ctx {
  return { m, labels, boxes: [], paths: [], gaps: [], decor: [], pos: new Map(), byId: new Map(m.items.map((it) => [it.id, it])), badges: [] };
}

function metaOf(ctx: Ctx, it: FocusItem): string {
  const type = ctx.labels.type(it.node);
  if (it.role === "external") return [it.context, type].filter(Boolean).join(" · ");
  if (ctx.m.pattern === "timeline" && it.role !== "whole" && it.node.timeText) return [it.node.timeText, type].filter(Boolean).join(" · ");
  return type;
}

function sizeBox(ctx: Ctx, it: FocusItem, w: number): { h: number; meta: string; lines: string[] } {
  const K = FOCUS_GEOM;
  const sz = SIZE[it.role];
  const meta = fitText(metaOf(ctx, it), K.metaSize, w - K.padX * 2);
  const lines = wrapText(it.node.title, sz.font, w - K.padX * 2, sz.lines);
  return { h: K.padY * 2 + (meta ? K.metaH : 0) + lines.length * sz.line, meta, lines };
}

function put(ctx: Ctx, id: string, x: number, y: number, w: number): FocusBox | null {
  const it = ctx.byId.get(id);
  if (!it) return null;
  const sz = SIZE[it.role];
  const { h, meta, lines } = sizeBox(ctx, it, w);
  const b: FocusBox = { id, role: it.role, linked: it.linked, x: Math.round(x), y: Math.round(y), w: Math.round(w), h, meta, lines, font: sz.font, line: sz.line };
  ctx.boxes.push(b);
  ctx.pos.set(id, b);
  return b;
}

function placeAt(ctx: Ctx, cands: [number, number][]): [number, number] {
  let best = cands[0];
  for (const p of cands) {
    if (ctx.badges.every(([x, y]) => Math.abs(x - p[0]) >= 17 || Math.abs(y - p[1]) >= 17)) {
      best = p;
      break;
    }
  }
  const r: [number, number] = [Math.round(best[0]), Math.round(best[1])];
  ctx.badges.push(r);
  return r;
}
const T_CANDS = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8];
function placeBadge(ctx: Ctx, c: Cubic): [number, number] {
  return placeAt(ctx, T_CANDS.map((t) => cubicAt(c, t)));
}

const hits = (b: FocusBox, x: number, y: number) => x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1;
/** 曲线是否穿过除两端外的任何卡片 */
function crosses(ctx: Ctx, c: Cubic, a: FocusBox, b: FocusBox): boolean {
  for (let i = 1; i < 24; i++) {
    const [x, y] = cubicAt(c, i / 24);
    for (const o of ctx.boxes) if (o !== a && o !== b && hits(o, x, y)) return true;
  }
  return false;
}

/** 通用关系线：按两卡相对位置选端口（上下 / 左右）；同一行的两张卡走上方的弧；
 *  竖直方向会穿过中间卡片（如焦点下挂的子）时，改从侧面绕过那一列再落下去。 */
function routeRel(ctx: Ctx, r: FocusRel, lane: number, sameRowTop: number | null) {
  const [df, dt] = r.code === "据" ? [r.to, r.from] : [r.from, r.to];
  const a = ctx.pos.get(df), b = ctx.pos.get(dt);
  if (!a || !b) return;
  const key = `rel:${r.from}|${r.to}|${r.code}`;
  // 父卡与它下挂的子之间：结构线已经连着，只在子卡右上角挂关系码
  const na = ctx.byId.get(df)?.node, nb = ctx.byId.get(dt)?.node;
  const kid = na && nb ? (na.parentId === nb.id ? a : nb.parentId === na.id ? b : null) : null;
  if (kid && (kid.role === "child" || kid.role === "cell")) {
    const [lx, ly] = placeAt(ctx, [[kid.x + kid.w - 10, kid.y], [kid.x + kid.w - 28, kid.y]]);
    ctx.paths.push({ key, kind: "rel", code: r.code, from: df, to: dt, touchesFocus: r.touchesFocus, d: "", lx, ly });
    return;
  }
  let c: Cubic;
  if (sameRowTop != null && Math.abs(a.y - b.y) < 4) {
    const ax = a.x + a.w / 2 + (b.x > a.x ? 14 : -14), bx = b.x + b.w / 2 + (a.x > b.x ? 14 : -14);
    const top = Math.min(a.y, b.y);
    const cy = top - 18 - lane * 11;
    c = [ax, a.y, ax, cy, bx, cy, bx, b.y - 3];
  } else if (b.y >= a.y + a.h - 2 || a.y >= b.y + b.h - 2) {
    const down = b.y >= a.y + a.h - 2;
    const [up, lo] = down ? [a, b] : [b, a];
    const ax = up.x + up.w / 2, bx = lo.x + lo.w / 2, ay = up.y + up.h, by = lo.y;
    const my = (ay + by) / 2;
    const cc: Cubic = [ax, ay, ax, my, bx, my, bx, by];
    if (crosses(ctx, cc, a, b)) {
      // 从上方卡片右侧出，沿这一列右缘下去，越过列底再落到下方卡片
      const below = ctx.boxes.filter((o) => o !== a && o !== b && o.y >= up.y + up.h - 2 && o.y + o.h <= lo.y + 2 && o.x < up.x + up.w + 4 && o.x + o.w > up.x - 4);
      const laneX = Math.max(up.x + up.w, ...below.map((o) => o.x + o.w)) + 10 + (lane % 4) * 8;
      const sy = up.y + Math.min(up.h / 2, 18);
      const clear = Math.max(up.y + up.h, ...below.map((o) => o.y + o.h)) + 8;
      const ey = (clear + by) / 2;
      const seg = `M${Math.round(up.x + up.w)},${Math.round(sy)} H${Math.round(laneX - 6)} Q${Math.round(laneX)},${Math.round(sy)} ${Math.round(laneX)},${Math.round(sy + 6)} V${Math.round(clear)} C${Math.round(laneX)},${Math.round(ey)} ${Math.round(bx)},${Math.round(ey)} ${Math.round(bx)},${Math.round(by - 3)}`;
      // 箭头方向：画法总是从上到下；若语义方向向上，用反向路径（起点在下方卡片）
      const d = down ? seg : `M${Math.round(bx)},${Math.round(by)} C${Math.round(bx)},${Math.round(ey)} ${Math.round(laneX)},${Math.round(ey)} ${Math.round(laneX)},${Math.round(clear)} V${Math.round(sy + 6)} Q${Math.round(laneX)},${Math.round(sy)} ${Math.round(laneX - 6)},${Math.round(sy)} H${Math.round(up.x + up.w + 3)}`;
      const [lx, ly] = placeAt(ctx, [[laneX, (sy + clear) / 2], [laneX, sy + 22], [laneX, clear - 10], [(laneX + bx) / 2, ey]]);
      ctx.paths.push({ key, kind: "rel", code: r.code, from: df, to: dt, touchesFocus: r.touchesFocus, d, lx, ly });
      return;
    }
    c = down ? [ax, ay, ax, my, bx, my, bx, by - 3] : [bx, by, bx, my, ax, my, ax, ay + 3];
  } else {
    const right = b.x >= a.x;
    const ax = right ? a.x + a.w : a.x, bx = right ? b.x : b.x + b.w;
    const ay = a.y + Math.min(a.h / 2, 18), by = b.y + Math.min(b.h / 2, 18);
    const mx = (ax + bx) / 2;
    c = [ax, ay, mx, ay, mx, by, bx + (right ? -3 : 3), by];
  }
  const [lx, ly] = placeBadge(ctx, c);
  ctx.paths.push({ key, kind: "rel", code: r.code, from: df, to: dt, touchesFocus: r.touchesFocus, d: cubicD(c), lx, ly });
}

/** 别处节点排成最下面一行，尽量对齐它连接的图内卡片 */
function externalsRow(ctx: Ctx, top: number, left: number, w: number) {
  const exts = ctx.m.items.filter((it) => it.role === "external");
  if (!exts.length) return top;
  ctx.decor.push({ kind: "label", x: left, y: top + 4, text: "@others" });
  const y = top + 14;
  const want = exts.map((it) => {
    const xs = ctx.m.rels
      .filter((r) => !r.internal && (r.from === it.id || r.to === it.id))
      .map((r) => ctx.pos.get(r.from === it.id ? r.to : r.from))
      .filter(Boolean)
      .map((b) => (b as FocusBox).x + (b as FocusBox).w / 2);
    return { id: it.id, x: xs.length ? Math.min(...xs) - w / 2 : left };
  });
  want.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  let nx = left;
  let bottom = y;
  for (const it of want) {
    const x = Math.max(nx, Math.round(it.x));
    const b = put(ctx, it.id, x, y, w);
    if (b) {
      nx = b.x + b.w + 12;
      bottom = Math.max(bottom, b.y + b.h);
    }
  }
  return bottom;
}

function relsAll(ctx: Ctx, rowTop: Map<string, number>) {
  // 同一行的图内关系按跨度分泳道
  const lanes: { x0: number; x1: number; row: number }[][] = [[], [], []];
  const internals = ctx.m.rels.filter((r) => r.internal);
  internals.sort((p, q) => {
    const span = (r: FocusRel) => Math.abs((ctx.pos.get(r.from)?.x ?? 0) - (ctx.pos.get(r.to)?.x ?? 0));
    return span(p) - span(q) || (p.from < q.from ? -1 : 1);
  });
  for (const r of internals) {
    const a = ctx.pos.get(r.from), b = ctx.pos.get(r.to);
    if (!a || !b) continue;
    const ra = rowTop.get(r.from), rb = rowTop.get(r.to);
    const same = ra != null && ra === rb;
    let lane = 0;
    if (same) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      lane = lanes.findIndex((L) => L.every((s) => s.row !== ra || s.x1 < x0 + 4 || s.x0 > x1 - 4));
      if (lane < 0) lane = lanes.length - 1;
      lanes[lane].push({ x0, x1, row: ra as number });
    }
    routeRel(ctx, r, lane, same ? (ra as number) : null);
  }
  let k = 0;
  for (const r of ctx.m.rels) if (!r.internal) routeRel(ctx, r, k++, null);
}

function finish(ctx: Ctx, family: FocusFamily): FocusLayout {
  const P = 16;
  const right = Math.max(0, ...ctx.boxes.map((b) => b.x + b.w), ...ctx.gaps.map((g) => g.x + g.w), ...ctx.decor.map((d) => d.x + (d.w ?? 0)));
  const bottom = Math.max(0, ...ctx.boxes.map((b) => b.y + b.h), ...ctx.gaps.map((g) => g.y + g.h), ...ctx.decor.map((d) => d.y + (d.h ?? 0)));
  return { width: Math.round(right + P), height: Math.round(bottom + P), boxes: ctx.boxes, paths: ctx.paths, gaps: ctx.gaps, decor: ctx.decor, family, host: HOST_OF[family] };
}

/** 成员序列（含「另 N 项」占位），原文顺序 */
function sequence(m: FocusModel): ({ kind: "member"; id: string } | { kind: "gap"; gap: FocusGap })[] {
  const out: ({ kind: "member"; id: string } | { kind: "gap"; gap: FocusGap })[] = [];
  const after = new Map<string | null, FocusGap>();
  for (const g of m.gaps) after.set(g.after, g);
  const g0 = after.get(null);
  if (g0) out.push({ kind: "gap", gap: g0 });
  for (const id of m.members) {
    out.push({ kind: "member", id });
    const g = after.get(id);
    if (g) out.push({ kind: "gap", gap: g });
  }
  return out;
}

/** 卡片下挂一列子卡（焦点的下一层 / 对照栏内格） */
function hangColumn(ctx: Ctx, parent: FocusBox, ids: string[], more: number, w: number): number {
  const spine = parent.x + 8;
  const x = parent.x + 16;
  let y = parent.y + parent.h + 8;
  let lastMid = parent.y + parent.h;
  for (const id of ids) {
    const b = put(ctx, id, x, y, w - 16);
    if (!b) continue;
    const mid = b.y + Math.min(b.h / 2, 16);
    ctx.paths.push({ key: `kid:${id}`, kind: "tree", d: `M${spine},${lastMid} V${mid - 5} Q${spine},${mid} ${spine + 5},${mid} H${x}`, strong: parent.role === "focus" });
    lastMid = mid;
    y = b.y + b.h + 6;
  }
  if (more > 0) {
    const h = 20;
    ctx.gaps.push({ key: `more:${parent.id}`, x, y, w: Math.min(w - 16, 110), h, count: more });
    const mid = y + h / 2;
    ctx.paths.push({ key: `kid:more:${parent.id}`, kind: "tree", d: `M${spine},${lastMid} V${mid - 5} Q${spine},${mid} ${spine + 5},${mid} H${x}`, strong: false });
    y += h + 6;
  }
  return y;
}

/** 横向流程：链（先后箭头）/ 时间线（轴 + 时间刻度）/ 分层（只画关系） */
function layoutFlow(m: FocusModel, labels: LayoutLabels): FocusLayout {
  const ctx = newCtx(m, labels);
  const P = 16, CW = 172, GX = m.pattern === "chain" ? 40 : 24;
  const seq = sequence(m);
  const rowW = seq.reduce((s, x) => s + (x.kind === "gap" ? 64 : CW) + GX, -GX);
  const frameX = P, frameY = P;
  let y = frameY + 12;
  const whole = m.wholeId ? put(ctx, m.wholeId, frameX + 12, y, Math.min(Math.max(rowW, 260), 420)) : null;
  if (whole) y = whole.y + whole.h + 12;
  const hasArcs = m.rels.some((r) => r.internal && ctx.byId.get(r.from)?.role !== "child" && ctx.byId.get(r.to)?.role !== "child");
  if (hasArcs) y += 30;
  if (m.pattern === "timeline") y += 14;
  const rowY = y;
  const rowTop = new Map<string, number>();
  let x = frameX + 12;
  let bottom = rowY;
  const centers: { x: number; key: string; id: string | null }[] = [];
  let prev: { x: number; y: number; key: string } | null = null;
  for (const s of seq) {
    if (s.kind === "gap") {
      ctx.gaps.push({ key: `gap:${s.gap.ids[0]}`, x, y: rowY + 6, w: 64, h: 22, count: s.gap.ids.length });
      centers.push({ x: x + 32, key: `gap:${s.gap.ids[0]}`, id: null });
      if (prev && m.pattern === "chain") ctx.paths.push({ key: `seq:${prev.key}`, kind: "seq", d: `M${prev.x},${prev.y} H${x - 3}` });
      prev = { x: x + 64, y: rowY + 17, key: `gap:${s.gap.ids[0]}` };
      x += 64 + GX;
      continue;
    }
    const b = put(ctx, s.id, x, rowY, CW);
    if (!b) continue;
    rowTop.set(s.id, rowY);
    centers.push({ x: b.x + b.w / 2, key: s.id, id: s.id });
    const mid = b.y + Math.min(b.h / 2, 18);
    if (prev && m.pattern === "chain") ctx.paths.push({ key: `seq:${prev.key}`, kind: "seq", d: `M${prev.x},${prev.y} H${b.x - 3}` });
    prev = { x: b.x + b.w, y: mid, key: s.id };
    bottom = Math.max(bottom, b.y + b.h);
    if (s.id === m.focusId && (m.kids.length || m.moreKids)) bottom = Math.max(bottom, hangColumn(ctx, b, m.kids, m.moreKids, CW));
    x += CW + GX;
  }
  if (m.pattern === "timeline" && centers.length) {
    const ay = rowY - 10;
    const x0 = frameX + 12, x1 = x - GX;
    ctx.decor.push({ kind: "axis", x: x0, y: ay, w: x1 - x0, h: 0 });
    for (const c of centers) ctx.decor.push({ kind: "tick", x: Math.round(c.x), y: ay, text: c.id === m.focusId ? "focus" : "" });
  }
  const frameRight = Math.max(x - GX, whole ? whole.x + whole.w : 0) + 12;
  const frameBottom = bottom + 12;
  ctx.decor.unshift({ kind: "frame", x: frameX, y: frameY, w: frameRight - frameX, h: frameBottom - frameY });
  externalsRow(ctx, frameBottom + 18, frameX, CW);
  relsAll(ctx, rowTop);
  return finish(ctx, "flow");
}

/** 对照分栏：每个成员一栏，栏下挂它的子（属性 / 要点） */
function layoutColumns(m: FocusModel, labels: LayoutLabels): FocusLayout {
  const ctx = newCtx(m, labels);
  const P = 16, CW = 176, GX = 20;
  const seq = sequence(m);
  const frameX = P, frameY = P;
  let y = frameY + 12;
  const rowW = seq.reduce((s, x) => s + (x.kind === "gap" ? 64 : CW) + GX, -GX);
  const whole = m.wholeId ? put(ctx, m.wholeId, frameX + 12, y, Math.min(Math.max(rowW, 260), 420)) : null;
  if (whole) y = whole.y + whole.h + 12;
  if (m.rels.some((r) => r.internal && m.members.includes(r.from) && m.members.includes(r.to))) y += 30;
  const rowY = y;
  const rowTop = new Map<string, number>();
  let x = frameX + 12;
  let bottom = rowY;
  for (const s of seq) {
    if (s.kind === "gap") {
      ctx.gaps.push({ key: `gap:${s.gap.ids[0]}`, x, y: rowY + 6, w: 64, h: 22, count: s.gap.ids.length });
      x += 64 + GX;
      continue;
    }
    const b = put(ctx, s.id, x, rowY, CW);
    if (!b) continue;
    rowTop.set(s.id, rowY);
    bottom = Math.max(bottom, b.y + b.h);
    const isF = s.id === m.focusId;
    const ids = isF ? m.kids : m.cells[s.id] ?? [];
    if (ids.length || (isF && m.moreKids)) bottom = Math.max(bottom, hangColumn(ctx, b, ids, isF ? m.moreKids : 0, CW));
    x += CW + GX;
  }
  const frameRight = Math.max(x - GX, whole ? whole.x + whole.w : 0) + 12;
  const frameBottom = bottom + 12;
  ctx.decor.unshift({ kind: "frame", x: frameX, y: frameY, w: frameRight - frameX, h: frameBottom - frameY });
  externalsRow(ctx, frameBottom + 18, frameX, CW);
  relsAll(ctx, rowTop);
  return finish(ctx, "columns");
}

/** 论证图：论点（整体）在上；支持的一侧在左下，反方 / 反驳 / 让步在右下 */
function layoutTopdown(m: FocusModel, labels: LayoutLabels): FocusLayout {
  const ctx = newCtx(m, labels);
  const P = 16, CW = 220, GX = 72;
  const seq = sequence(m);
  const isCon = (id: string) => CON_TYPES.has(String(ctx.byId.get(id)?.node.type ?? ""));
  const pro = seq.filter((s) => s.kind === "gap" || !isCon(s.id));
  const con = seq.filter((s) => s.kind === "member" && isCon(s.id));
  const two = con.length > 0 && pro.some((s) => s.kind === "member");
  const totalW = two ? CW * 2 + GX : CW;
  let y = P;
  const wholeW = Math.min(300, totalW);
  const whole = m.wholeId ? put(ctx, m.wholeId, P + (totalW - wholeW) / 2, y, wholeW) : null;
  const top = whole ? whole.y + whole.h : y;
  const startY = top + 36;
  const cols = two ? [{ list: pro, x: P }, { list: con, x: P + CW + GX }] : [{ list: seq, x: P }];
  if (whole && two) ctx.decor.push({ kind: "label", x: P + CW + GX + 14, y: startY - 6, text: "@con" });
  for (const col of cols) {
    let cy = startY;
    const spine = col.x - 0;
    const mids: number[] = [];
    for (const s of col.list) {
      if (s.kind === "gap") {
        ctx.gaps.push({ key: `gap:${s.gap.ids[0]}`, x: col.x + 14, y: cy, w: 110, h: 22, count: s.gap.ids.length });
        mids.push(cy + 11);
        cy += 22 + 8;
        continue;
      }
      const b = put(ctx, s.id, col.x + 14, cy, CW - 14);
      if (!b) continue;
      mids.push(b.y + Math.min(b.h / 2, 18));
      cy = b.y + b.h + 8;
      if (s.id === m.focusId && (m.kids.length || m.moreKids)) cy = hangColumn(ctx, b, m.kids, m.moreKids, CW - 14) + 2;
    }
    if (!mids.length) continue;
    // 论点底部 → 本栏树干
    const wx = whole ? whole.x + whole.w / 2 : spine;
    const busY = top + 12;
    if (whole) ctx.paths.push({ key: `bus:${col.x}`, kind: "tree", d: `M${wx},${top} V${busY} H${spine + 4} Q${spine},${busY} ${spine},${busY + 4}`, strong: col.list.some((s) => s.kind === "member" && s.id === m.focusId) });
    for (let i = 0; i < mids.length; i++) {
      const mid = mids[i];
      const s = col.list[i];
      const strong = s.kind === "member" && s.id === m.focusId;
      ctx.paths.push({ key: `trunk:${col.x}:${i}`, kind: "tree", d: `M${spine},${whole ? busY + 4 : startY} V${mid - 5} Q${spine},${mid} ${spine + 5},${mid} H${col.x + 14}`, strong });
    }
  }
  const bottom = Math.max(top, ...ctx.boxes.map((b) => b.y + b.h), ...ctx.gaps.map((g) => g.y + g.h));
  externalsRow(ctx, bottom + 22, P, 168);
  relsAll(ctx, new Map());
  return finish(ctx, "topdown");
}

export interface FocusLayoutOptions {
  /** 强制排法（测试 / 用户手动切换）；缺省按版式 */
  family?: FocusFamily;
}

/** 聚焦图排版入口：按整体这一组的版式选排法；width 只约束纵向树（浮窗宽） */
export function layoutFocus(m: FocusModel, width: number, labels: LayoutLabels, opts: FocusLayoutOptions = {}): FocusLayout {
  const family = opts.family ?? FAMILY_OF[m.pattern] ?? "tree";
  if (family === "flow") return layoutFlow(m, labels);
  if (family === "columns") return layoutColumns(m, labels);
  if (family === "topdown") return layoutTopdown(m, labels);
  return layoutTree(m, width, labels);
}

/** 图中出现的全部节点 id（正文强调用） */
export function focusNodeIds(m: FocusModel): string[] {
  return m.items.map((it) => it.id);
}

