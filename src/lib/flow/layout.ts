// 结构流 v3.1 · 纯逻辑（STRUCTURE-FLOW-PLAN §5 + §12；常量 / 公式 / 参考代码即定稿）。
// 本文件不碰 DOM：坐标全部为主机 client 坐标或局部坐标（y 自 0 起，宿主加 dy）。
// 依赖只到 mindmap v2 的纯模块（graph / types / pattern）与阅读内核的几何类型。

import { childrenOf } from "../mindmap/v2/graph";
import type { GraphState } from "../mindmap/v2/types";
import { ROOT_ID } from "../mindmap/v2/types";
import { groupFacts, selectPattern } from "../mindmap/v2/pattern";
import type { ReaderParagraphBox, ReaderStructureGeometry, ReaderStructurePaintRect } from "../reader/kernel";
import type {
  FlowColors,
  FlowEnv,
  FlowItem,
  FlowMode,
  FlowPattern,
  FlowPlan,
  FlowPort,
  FlowPrim,
  FlowShape,
  FlowStrand,
  PatternLayout,
} from "./types";

// ---------------------------------------------------------------- §5.1 / §12.2 / §12.3 常量
export const FLOW = {
  LABEL_W: 248, LABEL_W_COMPACT: 176,
  BAR_MAX: 10, LABEL_GAP: 16, PAD_R: 20, INDENT: 0,
  BRAID_MIN: 64, BRAID_PREF: 96, BRAID_MAX: 160,
  MAX_SHIFT: 200, KEEP_LEFT: 40, SHIFT_STEP: 8, SHIFT_HYST: 16, TEXT_MIN: 480,
  HL_PAD_X: 6, HL_PAD_Y: 2, HL_R: 3, HL_MERGE_GAP: 28, HL_FADE_W: 140, // §14.4：矩形右端向内渐隐长度
  HEADER_FS: 11, HEADER_LH: 16, HEADER_GAP: 10, BACK_H: 22,
  ROW_PAD_Y: 4, ROW_GAP: 6, MORE_H: 20, META_W: 44,
  MAX_MEMBERS: 9, MIN_MEMBERS: 3, MAX_KIDS: 7,
  ACTIONS_H: 26, EXPLAIN_MAX_H: 168,
  STRETCH_MAX: 1.8, MIN_SLICE: 2, MAX_STRANDS: 12, STUB_ROWS: 4,
  COL_MARGIN_Y: 20,
  TL_DOT_R: 5, TL_DOT_R_READING: 6.5, TL_TIME_FS: 11, TL_TIME_LH: 15, TL_BREAK_K: 4,
  CH_R: 9,
  CMP_MAX: 4, CMP_GAP: 10, CMP_KIDS: 5,
  TURN_RESAMPLE_MS: 220, POLL_PAGED_MS: 200, TRACK_IDLE_MS: 160, RESIZE_IDLE_MS: 200, RELAYOUT_WAIT_MS: 280,
  // v3.1（§12.2 泳道 / 跨度条；§12.3.2 对照表）
  LANE_DX: 6, LANES: 4, GROUP_GAP: 10, SPAN_W: 2, SPAN_A: 0.35, NOTCH_W: 7, NOTCH_H: 2,
  CMP_NAME_W: 76, CMP_CELL_MIN: 84, CMP_CELL_MAX: 132, CMP_CELL_LINES: 4, CMP_HEAD_H: 22, CMP_ROW_PAD: 6, CMP_MAX_W: 540,
} as const;

// ---------------------------------------------------------------- §5.3 排布决策
const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;
export const blockW = (lw: number) => FLOW.BAR_MAX + FLOW.LABEL_GAP + lw + FLOW.PAD_R;
export const reserveW = (lw: number) => FLOW.BRAID_PREF + blockW(lw);

export function planColumn(env: FlowEnv, prev: FlowPlan | null): FlowPlan {
  const off: FlowPlan = { mode: "off", shift: 0, reserve: 0, barX: 0, labelX: 0, labelW: 0, right: 0 };
  if (!env.on) return off;
  const vp = env.viewport, vw = vp.right - vp.left;
  const maxShift = Math.max(0, Math.min(FLOW.MAX_SHIFT, env.textLeft - vp.left - FLOW.KEEP_LEFT));
  const make = (mode: FlowMode, shift: number, reserve: number, lw: number): FlowPlan => {
    const right = vp.right; // 槽位在视口内：列右缘始终＝视口右缘
    // §12.1 硬约束（plan.right ≤ viewport.right − 4）：把列整体再左收 4px，保证窗口最窄档也完整可见
    const barX = Math.round(Math.min(env.textRight - shift + FLOW.BRAID_PREF, right - 4 - blockW(lw)));
    const labelX = barX + FLOW.BAR_MAX + FLOW.LABEL_GAP;
    return { mode, shift, reserve, barX, labelX, labelW: lw, right: labelX + lw + FLOW.PAD_R };
  };
  const tryLw = (lw: number, tag: FlowMode): FlowPlan | null => {
    const bw = blockW(lw);
    const room = vp.right - env.textRight;
    const textW = Math.max(0, env.textRight - env.textLeft);
    // §14.5：正文 + 彩带 + 节点列三件一体、整体居中（居中位移只与块宽有关，与窗口宽无关）
    const total = textW + FLOW.BRAID_PREF + bw;
    const idealLeft = vp.left + (vw - total) / 2;
    let s = total <= vw - 8 ? Math.max(0, ceilTo(env.textLeft - idealLeft, FLOW.SHIFT_STEP)) : Infinity;
    // 居中放不下（或推不动）→ 退化为「够放就行」（BRAID_MIN，保留 64–96 弹性）
    if (!Number.isFinite(s) || s > maxShift) s = ceilTo(FLOW.BRAID_MIN + bw - room, FLOW.SHIFT_STEP);
    if (s <= 0) {
      const p = make(tag === "compact" ? "compact" : "inside", 0, 0, lw);
      return p.right > vp.right - 4 ? null : p; // §12.1 硬约束
    }
    if (prev && prev.reserve === 0 && prev.shift >= s && prev.shift - s < FLOW.SHIFT_HYST) s = prev.shift;
    if (s <= maxShift) {
      const p = make(tag === "compact" ? "compact" : "shift", s, 0, lw);
      return p.right > vp.right - 4 ? null : p;
    }
    if (vw - reserveW(lw) >= FLOW.TEXT_MIN) {
      const p = make(tag === "compact" ? "compact" : "reserve", 0, reserveW(lw), lw);
      // 预留后正文在剩余宽度内重排居中：宿主重排完成后会以新的 textRight 再算一次（此时 room 足够 → inside/compact 且 reserve 保持）
      return p.right > vp.right - 4 ? null : p;
    }
    return null;
  };
  const p = tryLw(FLOW.LABEL_W, "inside") ?? tryLw(FLOW.LABEL_W_COMPACT, "compact");
  if (p) return p;
  const barX = Math.round(Math.min(env.textRight + 16, vp.right - 24));
  return { mode: "whisper", shift: 0, reserve: 0, barX, labelX: barX + FLOW.BAR_MAX + 6, labelW: 0, right: barX + FLOW.BAR_MAX };
}

// ---------------------------------------------------------------- §5.3 文字折行（CJK＝1em，空格＝0.3em，其余＝0.56em）
const WIDE_RANGES: [number, number][] = [[0x2e80, 0x9fff], [0x3000, 0x303f], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xff00, 0xffef]];
const isWide = (c: string) => {
  const p = c.codePointAt(0) ?? 0;
  return WIDE_RANGES.some(([a, b]) => p >= a && p <= b);
};
export const charW = (c: string, fs: number) => (isWide(c) ? fs : c === " " ? fs * 0.3 : fs * 0.56);
const widthOf = (cs: string[], fs: number) => cs.reduce((a, c) => a + charW(c, fs), 0);
export function wrapLabel(text: string, fs: number, maxW: number, maxLines: number): string[] {
  const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  let i = 0;
  while (i < chars.length && lines.length < maxLines) {
    let w = 0, j = i, lastSpace = -1;
    while (j < chars.length && w + charW(chars[j], fs) <= maxW) {
      if (chars[j] === " ") lastSpace = j;
      w += charW(chars[j], fs);
      j++;
    }
    if (j < chars.length && lastSpace > i && chars[j] !== " " && !isWide(chars[j]) && !isWide(chars[j - 1])) j = lastSpace;
    if (j === i) j = i + 1;
    lines.push(chars.slice(i, j).join("").trim());
    i = j;
    while (chars[i] === " ") i++;
  }
  if (i < chars.length && lines.length) {
    const last = Array.from(lines[lines.length - 1]);
    while (last.length && widthOf(last, fs) + fs > maxW) last.pop();
    lines[lines.length - 1] = last.join("") + "…";
  }
  return lines.length ? lines : [""];
}
export const textW = (s: string, fs: number) => widthOf(Array.from(s), fs);

// ---------------------------------------------------------------- §5.4 角色层级与挂接
export type Tier = 0 | 1 | 2 | "counter";
const TIER: Record<string, Tier> = {
  论点: 0, 结论: 0, 命题: 0, 问题: 0, 方案: 0, 总结: 0,
  理由: 1, 证据: 1, 前提: 1, 定义: 1, 引理: 1, 推导: 1, 因果: 1, 背景: 1, 引言: 1, 分类: 1, 对比: 1, 步骤: 1, 分情形: 1, 叙事: 1, 其他: 1,
  例证: 2, 案例: 2,
  反方观点: "counter", 反驳: "counter", 让步: "counter",
};
export const tierOf = (type: string): Tier => TIER[type] ?? 1;
const rank = (t: Tier) => (t === "counter" ? 1 : t);

export interface TierStyle { bar: number; fs: number; lh: number; weight: number; tone: number }
export const TIER_STYLE: Record<"0" | "1" | "2" | "counter" | "compact", TierStyle> = {
  "0": { bar: 10, fs: 14, lh: 19, weight: 600, tone: 96 },
  "1": { bar: 6, fs: 13, lh: 18, weight: 450, tone: 86 },
  "2": { bar: 4, fs: 12, lh: 17, weight: 400, tone: 72 },
  counter: { bar: 6, fs: 13, lh: 18, weight: 450, tone: 86 },
  compact: { bar: 4, fs: 12, lh: 17, weight: 420, tone: 84 },
};
export const styleOf = (type: string): TierStyle => TIER_STYLE[String(tierOf(type)) as "0" | "1" | "2" | "counter"];

/** v3.1 §12.2：泳道样式（代替 TIER_STYLE 的条宽；TIER_STYLE 保留但不再用 bar 字段） */
export interface LaneStyle { barW: number; fs: number; lh: number; weight: number; tone: number }
export const LANE_STYLE: LaneStyle[] = [
  { barW: 5, fs: 14, lh: 19, weight: 600, tone: 96 },
  { barW: 4, fs: 13, lh: 18, weight: 500, tone: 90 },
  { barW: 4, fs: 13, lh: 18, weight: 450, tone: 84 },
  { barW: 3, fs: 12, lh: 17, weight: 400, tone: 72 },
];
/** 泳道＝语义深度（semanticNest 的 depth；论证图有根论点时 +1），封顶 3。
 *  类型为例证 / 案例的节点至少落在泳道 2（即使没找到上级），保证「例证低于论点」在任何情况下都成立。 */
export function laneOf(depth: number, type: string, hasRoot: boolean): number {
  let lane = depth + (hasRoot ? 1 : 0);
  if (tierOf(type) === 2) lane = Math.max(lane, hasRoot ? 3 : 2);
  return Math.min(FLOW.LANES - 1, lane);
}

const NEST_OUT = new Set(["支", "例", "因", "答", "驳"]); // 本节点 —码→ 目标：本节点是目标的下级
export function semanticNest(
  g: GraphState,
  members: string[],
): Map<string, { parent: string | null; depth: number; rel: "support" | "example" | "counter" | null }> {
  const set = new Set(members), pos = new Map(members.map((id, i) => [id, i] as const));
  const t = (id: string) => tierOf(String(g.nodes[id]?.type ?? ""));
  const parent = new Map<string, string | null>();
  for (const id of members) {
    const ti = t(id);
    if (ti === 0) {
      parent.set(id, null);
      continue;
    }
    const cands: string[] = [];
    for (const e of g.outEdges[id] ?? []) if (NEST_OUT.has(e.code) && set.has(e.to) && rank(t(e.to)) < rank(ti)) cands.push(e.to);
    for (const e of g.inEdges[id] ?? []) if (e.code === "据" && set.has(e.from) && rank(t(e.from)) < rank(ti)) cands.push(e.from); // 上级 —据→ 本节点
    let p: string | null = null;
    if (cands.length) p = cands.sort((a, b) => Math.abs(pos.get(a)! - pos.get(id)!) - Math.abs(pos.get(b)! - pos.get(id)!))[0];
    else
      for (let i = pos.get(id)! - 1; i >= 0; i--)
        if (rank(t(members[i])) < rank(ti)) {
          p = members[i];
          break;
        }
    parent.set(id, p);
  }
  // 环保护 + 深度（v3.1：深度上限 3）
  const out = new Map<string, { parent: string | null; depth: number; rel: "support" | "example" | "counter" | null }>();
  for (const id of members) {
    let d = 0, cur = parent.get(id) ?? null;
    const seen = new Set([id]);
    while (cur && !seen.has(cur) && d < 4) {
      seen.add(cur);
      d++;
      cur = parent.get(cur) ?? null;
    }
    const ti = t(id);
    const p = d > 3 || (cur && seen.has(cur)) ? null : parent.get(id) ?? null;
    out.set(id, { parent: p, depth: p ? Math.min(3, d) : 0, rel: !p ? null : ti === "counter" ? "counter" : ti === 2 ? "example" : "support" });
  }
  return out;
}

/** 深度优先、兄弟保持原文顺序 */
export function nestOrder(members: string[], nest: ReturnType<typeof semanticNest>): string[] {
  const kids = new Map<string | null, string[]>();
  for (const id of members) {
    const p = nest.get(id)?.parent ?? null;
    const l = kids.get(p) ?? [];
    l.push(id);
    kids.set(p, l);
  }
  const out: string[] = [];
  const walk = (p: string | null) => {
    for (const id of kids.get(p) ?? []) {
      out.push(id);
      walk(id);
    }
  };
  walk(null);
  for (const id of members) if (!out.includes(id)) out.push(id);
  return out;
}

// ---------------------------------------------------------------- §5.5.0 公共
export interface LayoutCtx {
  g: GraphState;
  plan: FlowPlan;
  colors: FlowColors;
  pattern: FlowPattern;
  cut: string;
  header: string;
  patternName: string;
  members: string[];
  /** 成员色（按完整成员表下标取色板，窗口滑动时颜色不变；阅读节点＝accent） */
  colorOf: Map<string, string>;
  /** §13.4.2：成员调色板色（忽略 accent）——展开子节点的颜色从它派生，避免一片绿 */
  paletteOf?: Map<string, string>;
  moreAbove: number;
  moreBelow: number;
  readingId: string | null;
  readingBlock: number | null;
  selectedId: string | null;
  expandedId: string | null;
  /** 选中项下方动作行高度（选中项在本版式中时插入） */
  inlineH: number;
  maxLines0: 1 | 2;
  canBack: boolean;
  /** 列可用高度（时间线比例排布要用） */
  availH: number;
  /** 对照表可用最大宽度（＝viewport.right − PAD_R − labelX，宿主传入） */
  maxW: number;
  /** 对照表当前页（宿主状态，换组时归 0） */
  cmpPage: number;
}

const newLayout = (): PatternLayout => ({ items: [], ports: [], prims: [], expressed: [], leafIds: [], height: 0, readingY: null });
const nodeOf = (c: LayoutCtx, id: string) => c.g.nodes[id];
const kidsOf = (c: LayoutCtx, id: string) => childrenOf(c.g, id).filter((k) => c.g.nodes[k]);
const edgeKey = (from: string, to: string, code: string) => `${from}>${to}>${code}`;
/** #rgb / #rrggbb / rgb() / rgba()（逗号或空格分隔）→ [r,g,b]；其它返回 null（§13.4.1） */
export function parseRgb(c: string): [number, number, number] | null {
  const s = String(c || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.round(Math.min(255, Math.max(0, Number(v))))) as [number, number, number];
  return null;
}
const mixHex = (a: string, b: string, pct: number): string | null => {
  const A = parseRgb(a), B = parseRgb(b);
  if (!A || !B) return null;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${A.map((v, i) => hex(v * (1 - pct / 100) + B[i] * (pct / 100))).join("")}`;
};
/** 永远返回实色：解析不了就用父色本身（绝不产出 color-mix()） */
export const kidColor = (parent: string, bg: string, j: number) => mixHex(parent, bg, [0, 22, 40][j % 3]) ?? parent;

/** 头部：返回下一行 y */
function pushHeader(c: LayoutCtx, out: PatternLayout, y: number): number {
  if (c.canBack) {
    out.items.push(item({ id: "back", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.BACK_H, lines: ["↩"], fs: 11, lh: 22, weight: 400, tone: 72 }));
    y += FLOW.BACK_H;
  }
  const lines = wrapLabel(c.header, FLOW.HEADER_FS, c.plan.labelW - FLOW.META_W, 2);
  out.items.push(
    item({
      id: "head", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: lines.length * FLOW.HEADER_LH,
      lines, fs: FLOW.HEADER_FS, lh: FLOW.HEADER_LH, weight: 500, tone: 52, meta: c.patternName,
    }),
  );
  return y + lines.length * FLOW.HEADER_LH + FLOW.HEADER_GAP;
}

function pushMore(c: LayoutCtx, out: PatternLayout, y: number, kind: "above" | "below"): number {
  const n = kind === "above" ? c.moreAbove : c.moreBelow;
  if (!n) return y;
  out.items.push(
    item({
      id: `more:${kind}`, nodeId: null, kind: "more", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.MORE_H,
      lines: [""], fs: 11, lh: FLOW.MORE_H, weight: 400, tone: 48, moreKind: kind, moreCount: n,
    }),
  );
  out.prims.push({ k: "rect", id: `morebar:${kind}`, x: c.plan.barX + 4, y: y + 4, w: 2, h: FLOW.MORE_H - 8, fill: c.colors.hairline, layer: "over" });
  return y + FLOW.MORE_H + FLOW.ROW_GAP;
}

/** 补齐 FlowItem 默认字段 */
function item(
  p: Partial<FlowItem> & Pick<FlowItem, "id" | "nodeId" | "kind" | "x" | "y" | "w" | "h" | "lines" | "fs" | "lh" | "weight" | "tone">,
): FlowItem {
  return { chip: null, meta: "", time: null, num: null, reading: false, selected: false, hasKids: false, expanded: false, ...p };
}

/** 行尾 meta：有子未展开→「+N」；否则通往图外的关系「支·2 驳·1」；都没有→类型名 */
function metaOf(c: LayoutCtx, id: string, shown: Set<string>, showType: boolean): string {
  const k = kidsOf(c, id).length;
  if (k && id !== c.expandedId) return `+${k}`;
  const cnt = new Map<string, number>();
  for (const e of c.g.outEdges[id] ?? []) if (!shown.has(e.to)) cnt.set(e.code, (cnt.get(e.code) ?? 0) + 1);
  for (const e of c.g.inEdges[id] ?? []) if (!shown.has(e.from)) cnt.set(e.code, (cnt.get(e.code) ?? 0) + 1);
  const rel = Array.from(cnt)
    .slice(0, 2)
    .map(([code, n]) => `${code}·${n}`)
    .join(" ");
  return rel || (showType ? String(nodeOf(c, id)?.type ?? "") : "");
}

const chipOf = (type: string): FlowItem["chip"] => {
  const t = tierOf(type);
  return { text: type, style: t === "counter" ? "counter" : t === 0 ? "solid" : "outline" };
};

// ---------------------------------------------------------------- §5.5.1 / §12.2 大纲树 / 网格 / 论证图 / 分层图
export function layoutTree(c: LayoutCtx, opt: { compact: boolean; claimRoot: boolean; layered: boolean; spans: boolean }): PatternLayout {
  const out = newLayout();
  const shown = new Set(c.members);
  // ---- 1. 层级 ----
  let nest = opt.compact
    ? new Map(c.members.map((id) => [id, { parent: null, depth: 0, rel: null }] as const))
    : semanticNest(c.g, c.members);
  let order = opt.compact ? c.members.slice() : nestOrder(c.members, nest);
  if (opt.layered) {
    const L = causalLayers(c.g, c.members);
    nest = L.nest;
    order = L.order;
  }
  const rootClaim = opt.claimRoot && c.cut !== ROOT_ID && !!c.g.nodes[c.cut];
  const base = rootClaim ? 1 : 0;
  // ---- 2. 预排（自然高度） ----
  type Pre = { id: string; kind: "node" | "kid"; depth: number; st: TierStyle; lines: string[]; natural: number; value: number; color: string; parentRow: string | null };
  const pre: Pre[] = [];
  const add = (id: string, kind: "node" | "kid", depth: number, color: string, parentRow: string | null) => {
    const n = nodeOf(c, id);
    const st = opt.compact ? TIER_STYLE.compact : styleOf(String(n.type ?? ""));
    const lw = c.plan.labelW - FLOW.META_W;
    const maxL = opt.compact || kind === "kid" ? 1 : c.maxLines0;
    const lines = wrapLabel(n.title, st.fs, lw, maxL);
    const v = n.blockStart != null && n.blockEnd != null ? Math.max(1, n.blockEnd - n.blockStart + 1) : 1;
    pre.push({ id, kind, depth, st, lines, natural: lines.length * st.lh + FLOW.ROW_PAD_Y * 2 + (id === c.selectedId ? c.inlineH : 0), value: v, color, parentRow });
  };
  for (const id of order) {
    const d = base + (nest.get(id)?.depth ?? 0);
    add(id, "node", d, c.colorOf.get(id)!, null);
    if (id === c.expandedId) kidsOf(c, id).slice(0, FLOW.MAX_KIDS).forEach((k, j) => add(k, "kid", d + 1, kidColor(c.paletteOf?.get(id) ?? c.colorOf.get(id)!, c.colors.bg, j), id));
  }
  // ---- 3. Sankey 拉伸（只给大纲树 / 网格；论证图与分层图按层级等高） ----
  let k = 0;
  if (!opt.claimRoot && !opt.layered) {
    const base0 = pre.reduce((a, p) => a + p.natural, 0), sumV = pre.reduce((a, p) => a + p.value, 0);
    const target = base0 * FLOW.STRETCH_MAX;
    const total = (kk: number) => pre.reduce((a, p) => a + Math.max(p.natural, p.value * kk), 0);
    let lo = 0, hi = target / Math.max(1, sumV);
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (total(mid) <= target) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  // ---- 4. 落位（v3.1：标签恒在 labelX；节点条按泳道右移） ----
  let y = 0;
  const bars = new Map<string, { x: number; y: number; w: number; h: number; color: string; lane: number }>();
  const hasRoot = rootClaim;
  if (hasRoot) {
    const n = c.g.nodes[c.cut], st = LANE_STYLE[0];
    if (c.canBack) {
      out.items.push(item({ id: "back", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.BACK_H, lines: ["↩"], fs: 11, lh: 22, weight: 400, tone: 72 }));
      y += FLOW.BACK_H;
    }
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, 2);
    const h = lines.length * st.lh + FLOW.ROW_PAD_Y * 2;
    out.items.push(
      item({
        id: `n:${c.cut}`, nodeId: c.cut, kind: "node", x: c.plan.labelX, y, w: c.plan.labelW, h, lines,
        fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, meta: String(n.type ?? "论点"), selected: c.cut === c.selectedId,
      }),
    );
    bars.set(c.cut, { x: c.plan.barX, y: y + 1, w: st.barW, h: h - 2, color: c.colors.accent, lane: 0 });
    out.prims.push({ k: "rect", id: `bar:${c.cut}`, x: c.plan.barX, y: y + 1, w: st.barW, h: h - 2, rx: 1.5, fill: c.colors.accent, layer: "over" });
    y += h + FLOW.ROW_GAP;
  } else y = pushHeader(c, out, y);
  y = pushMore(c, out, y, "above");
  let prevLane = -1;
  for (const p of pre) {
    const n = nodeOf(c, p.id);
    const depth = p.kind === "kid" ? (bars.get(p.parentRow!)?.lane ?? 0) + 1 - (hasRoot ? 1 : 0) : nest.get(p.id)?.depth ?? 0;
    const lane = laneOf(depth, String(n.type ?? ""), hasRoot);
    const st = LANE_STYLE[lane];
    if (prevLane >= 0 && lane === (hasRoot ? 1 : 0) && p.kind === "node") y += FLOW.GROUP_GAP; // 顶层组之间多留一点
    prevLane = lane;
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, p.kind === "kid" || opt.compact ? 1 : c.maxLines0);
    const labelH = lines.length * st.lh + FLOW.ROW_PAD_Y * 2;
    const h = Math.round(Math.max(labelH + (p.id === c.selectedId ? c.inlineH : 0), p.value * k));
    const reading = p.id === c.readingId;
    const t = tierOf(String(n.type ?? ""));
    out.items.push(
      item({
        id: `n:${p.id}`, nodeId: p.id, kind: p.kind, x: c.plan.labelX, y, w: c.plan.labelW, h: labelH,
        lines, fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone,
        meta: metaOf(c, p.id, shown, true), reading, selected: p.id === c.selectedId,
        hasKids: kidsOf(c, p.id).length > 0, expanded: p.id === c.expandedId,
        chip: t === "counter" ? { text: "⟂", style: "counter" } : null, lane,
      }),
    );
    const bx = c.plan.barX + lane * FLOW.LANE_DX, by = y + 1, bh = Math.max(2, labelH - 2);
    const bw = reading ? st.barW + 1 : st.barW;
    const expanded = p.id === c.expandedId && kidsOf(c, p.id).length > 0;
    if (t === 2 && !reading) {
      // 例证：点状条（圆头短线串）
      out.prims.push({ k: "path", id: `bar:${p.id}`, d: `M${bx + bw / 2},${by + 1.5} V${by + bh - 1.5}`, stroke: p.color, strokeW: bw, dash: "0 4.5", layer: "over" });
    } else {
      out.prims.push({ k: "rect", id: `bar:${p.id}`, x: bx, y: by, w: bw, h: bh, rx: 1.5, fill: reading ? c.colors.accent : p.color, hatch: t === "counter" && !reading, layer: "over" });
    }
    bars.set(p.id, { x: bx, y: by, w: bw, h: bh, color: p.color, lane });
    if (!expanded) {
      out.ports.push({ nodeId: p.id, x: bx, y0: by, y1: by + bh, color: p.color });
      out.leafIds.push(p.id);
    }
    if (reading) out.readingY = y + labelH / 2;
    y += h + FLOW.ROW_GAP;
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  // ---- 5. 跨度条：每个有下级（语义下级或展开的结构子节点）的节点，从自己条底延伸到最后一个下级条底 ----
  if (opt.spans) {
    const under = new Map<string, string[]>(); // 上级 → 直接下级（按 pre 顺序）
    for (const p of pre) {
      const up = p.kind === "kid" ? p.parentRow : nest.get(p.id)?.parent ?? (hasRoot ? c.cut : null);
      if (up && bars.has(up)) {
        const l = under.get(up) ?? [];
        l.push(p.id);
        under.set(up, l);
      }
    }
    const lastDesc = (id: string): string => {
      const l = under.get(id);
      return l && l.length ? lastDesc(l[l.length - 1]) : id;
    };
    for (const [up, list] of under) {
      const U = bars.get(up)!, L = bars.get(lastDesc(list[list.length - 1]))!;
      const sx = U.x + (U.w - FLOW.SPAN_W) / 2;
      out.prims.push({
        k: "rect", id: `span:${up}`, x: sx, y: U.y + U.h + 2, w: FLOW.SPAN_W, h: Math.max(0, L.y + L.h - (U.y + U.h + 2)),
        rx: 1, fill: U.color, opacity: FLOW.SPAN_A, layer: "under",
      });
      // 反方缺口：直接下级里的反方，在上级跨度条上画一道反方色横缺口，对准该反方条的中线
      for (const id of list)
        if (tierOf(String(nodeOf(c, id)?.type ?? "")) === "counter") {
          const B = bars.get(id)!;
          out.prims.push({
            k: "rect", id: `notch:${id}`, x: sx - (FLOW.NOTCH_W - FLOW.SPAN_W) / 2, y: B.y + B.h / 2 - FLOW.NOTCH_H / 2,
            w: FLOW.NOTCH_W, h: FLOW.NOTCH_H, fill: c.colors.counter, layer: "over",
          });
        }
      // 版式本身已表达的从属关系：不再画关系线
      for (const id of list) {
        for (const e of c.g.outEdges[id] ?? []) if (e.to === up) out.expressed.push(edgeKey(id, up, e.code));
        for (const e of c.g.inEdges[id] ?? []) if (e.from === up) out.expressed.push(edgeKey(up, id, e.code));
      }
    }
  }
  return out;
}

/** 分层图：沿「推 / 因（from→to）」「据（to→from）」求最长路径层号（≤3），按（层, 原文序）排 */
export function causalLayers(g: GraphState, members: string[]) {
  const set = new Set(members), pos = new Map(members.map((id, i) => [id, i] as const));
  const succ = new Map<string, string[]>(members.map((id) => [id, []]));
  for (const id of members)
    for (const e of g.outEdges[id] ?? []) {
      if (!set.has(e.to) || e.to === id) continue;
      if (e.code === "推" || e.code === "因") succ.get(id)!.push(e.to);
      else if (e.code === "据") succ.get(e.to)!.push(id);
    }
  const depth = new Map<string, number>(members.map((id) => [id, 0]));
  for (let pass = 0; pass < members.length; pass++) {
    // Bellman 式松弛，环自然被 ≤3 截住
    let changed = false;
    for (const a of members)
      for (const b of succ.get(a)!) {
        const d = Math.min(3, depth.get(a)! + 1);
        if (d > depth.get(b)!) {
          depth.set(b, d);
          changed = true;
        }
      }
    if (!changed) break;
  }
  const order = members.slice().sort((a, b) => depth.get(a)! - depth.get(b)! || pos.get(a)! - pos.get(b)!);
  const nest = new Map(members.map((id) => [id, { parent: null as string | null, depth: depth.get(id)!, rel: null as null }]));
  return { order, nest };
}

/** 展开的结构子节点列表（链 / 时间线共用；§5.5.2 末段） */
function pushKidList(c: LayoutCtx, out: PatternLayout, parentId: string, x: number, y: number, dotX?: number): number {
  const kids = kidsOf(c, parentId).slice(0, FLOW.MAX_KIDS);
  if (!kids.length) return y;
  const base = c.paletteOf?.get(parentId) ?? c.colorOf.get(parentId) ?? c.colors.palette[0];
  const dx = dotX ?? x - 7;
  kids.forEach((kid, j) => {
    const n = nodeOf(c, kid);
    const color = kidColor(base, c.colors.bg, j);
    const lines = wrapLabel(n.title, 12, c.plan.labelW - (x - c.plan.labelX) - FLOW.META_W, 1);
    out.items.push(item({ id: `n:${kid}`, nodeId: kid, kind: "kid", x, y, w: c.plan.labelW - (x - c.plan.labelX), h: 17, lines, fs: 12, lh: 17, weight: 400, tone: 84, selected: kid === c.selectedId }));
    out.prims.push({ k: "circle", id: `kd:${kid}`, cx: dx, cy: y + 8.5, r: 2.5, fill: color, layer: "over" });
    out.ports.push({ nodeId: kid, x: dx, y0: y + 4, y1: y + 13, color });
    out.leafIds.push(kid);
    y += 19;
  });
  return y;
}

// ---------------------------------------------------------------- §5.5.2 链
export function layoutChain(c: LayoutCtx): PatternLayout {
  const out = newLayout();
  const shown = new Set(c.members);
  let y = pushHeader(c, out, 0);
  y = pushMore(c, out, y, "above");
  const cx = c.plan.barX + FLOW.CH_R - 2;
  const marks: { id: string; cy: number; color: string }[] = [];
  const start = c.moreAbove; // 步骤号接续窗口外的序号
  c.members.forEach((id, i) => {
    const n = nodeOf(c, id), st = TIER_STYLE["1"];
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, c.maxLines0);
    const labelH = Math.max(FLOW.CH_R * 2 + 4, lines.length * st.lh + FLOW.ROW_PAD_Y * 2);
    const kids = id === c.expandedId ? kidsOf(c, id).slice(0, FLOW.MAX_KIDS) : [];
    const kidsH = kids.length * 19;
    const h = labelH + kidsH + (id === c.selectedId ? c.inlineH : 0);
    const color = c.colorOf.get(id)!, reading = id === c.readingId;
    out.items.push(
      item({
        id: `n:${id}`, nodeId: id, kind: "node", x: c.plan.labelX + 4, y, w: c.plan.labelW - 4, h: labelH,
        lines, fs: st.fs, lh: st.lh, weight: reading ? 600 : st.weight, tone: st.tone, num: start + i + 1,
        meta: metaOf(c, id, shown, true), reading, selected: id === c.selectedId, hasKids: kidsOf(c, id).length > 0, expanded: id === c.expandedId,
      }),
    );
    const cy = y + FLOW.ROW_PAD_Y + st.lh / 2;
    out.prims.push({ k: "circle", id: `step:${id}`, cx, cy, r: reading ? FLOW.CH_R + 1 : FLOW.CH_R, fill: color, stroke: c.colors.bg, strokeW: 2, layer: "over" });
    out.prims.push({ k: "text", id: `stepn:${id}`, x: cx, y: cy + 3.8, text: String(start + i + 1), fs: 11, weight: 600, fill: c.colors.bg, anchor: "middle", layer: "over" });
    if (!kids.length) {
      out.ports.push({ nodeId: id, x: cx - FLOW.CH_R - 1, y0: cy - 7, y1: cy + 7, color });
      out.leafIds.push(id);
    }
    marks.push({ id, cy, color });
    if (reading) out.readingY = cy;
    if (kids.length) pushKidList(c, out, id, c.plan.labelX + 12, y + labelH, cx);
    y += h + FLOW.ROW_GAP;
  });
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    out.prims.push({
      k: "path", id: `link:${a.id}`, d: `M${cx},${a.cy + FLOW.CH_R + 2} V${b.cy - FLOW.CH_R - 3}`, stroke: a.color, strokeW: 1.5,
      grad: { from: a.color, to: b.color, x1: cx, y1: a.cy, x2: cx, y2: b.cy }, endMark: "arrow", draw: true, layer: "under",
    });
    for (const e of c.g.outEdges[a.id] ?? []) if (e.to === b.id && !out.expressed.includes(edgeKey(a.id, b.id, e.code))) out.expressed.push(edgeKey(a.id, b.id, e.code));
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  return out;
}

// ---------------------------------------------------------------- §5.5.3 时间线
/** 解析时间文本为「年」（小数年）；失败 null */
export function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  const bc = /公元前|前|BC|B\.C\./i.test(s);
  let m = s.match(/(\d{1,2})世纪/);
  if (m) {
    const v = (Number(m[1]) - 1) * 100 + 50;
    return bc ? -v : v;
  }
  m = s.match(/(\d{1,4})年(?:(\d{1,2})月)?/) || s.match(/(\d{3,4})(?:[-./](\d{1,2}))?/);
  if (m) {
    const v = Number(m[1]) + (m[2] ? (Number(m[2]) - 0.5) / 12 : 0);
    return bc ? -v : v;
  }
  return null;
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

export function layoutTimeline(c: LayoutCtx): PatternLayout {
  const out = newLayout();
  const shown = new Set(c.members);
  let y = pushHeader(c, out, 0);
  y = pushMore(c, out, y, "above");
  const ax = c.plan.barX + FLOW.TL_DOT_R; // 轴 x
  const st = TIER_STYLE["1"];
  const pre = c.members.map((id) => {
    const n = nodeOf(c, id);
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, c.maxLines0);
    const hasT = !!(n.timeText && n.timeText.trim());
    const kids = id === c.expandedId ? kidsOf(c, id).slice(0, FLOW.MAX_KIDS) : [];
    const kidsH = kids.length * 19;
    const h = (hasT ? FLOW.TL_TIME_LH : 0) + lines.length * st.lh + FLOW.ROW_PAD_Y * 2 + kidsH + (id === c.selectedId ? c.inlineH : 0);
    return { id, n, lines, hasT, kids, h, kidsH, t: parseTime(n.timeText) };
  });
  const parsed = pre.filter((p) => p.t != null);
  const monotone = parsed.every((p, i) => i === 0 || p.t! >= parsed[i - 1].t!);
  const proportional = parsed.length >= Math.max(2, Math.ceil((pre.length * 2) / 3)) && monotone;
  // 比例位置：缺时间的项取前后插值；大断层压缩为 2× 中位间隔并记断层
  const ts: (number | null)[] = pre.map((p) => p.t);
  for (let i = 0; i < ts.length; i++)
    if (ts[i] == null) {
      const a = ts.slice(0, i).reverse().find((v) => v != null), b = ts.slice(i + 1).find((v) => v != null);
      ts[i] = a != null && b != null ? (a + b) / 2 : a ?? b ?? 0;
    }
  const gaps = ts.slice(1).map((v, i) => Math.max(0, v! - ts[i]!));
  const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
  const breaks = new Set<number>();
  const eff = gaps.map((g, i) => {
    if (proportional && g > FLOW.TL_BREAK_K * med) {
      breaks.add(i);
      return 2 * med;
    }
    return g;
  });
  const span = eff.reduce((a, b) => a + b, 0) || 1;
  // 竖向落位（单调、不重叠、总高 ≤ availH）
  const sumH = pre.reduce((a, p) => a + p.h, 0);
  const tail = c.moreBelow ? FLOW.MORE_H + FLOW.ROW_GAP : 0;
  const H_free = Math.max(0, c.availH - y - sumH - FLOW.ROW_GAP * Math.max(0, pre.length - 1) - tail);
  const H_use = proportional ? Math.min(H_free, sumH * 1.2) : 0;
  const y0 = y;
  let stack = 0, acc = 0;
  const dots: { id: string; cy: number; color: string; kids: string[] }[] = [];
  pre.forEach((p, i) => {
    const yi = y0 + stack + Math.round((acc / span) * H_use);
    stack += p.h + FLOW.ROW_GAP;
    if (i < eff.length) acc += eff[i];
    const color = c.colorOf.get(p.id)!, reading = p.id === c.readingId;
    const cy = yi + FLOW.ROW_PAD_Y + (p.hasT ? FLOW.TL_TIME_LH / 2 : st.lh / 2);
    out.items.push(
      item({
        id: `n:${p.id}`, nodeId: p.id, kind: "node", x: c.plan.labelX, y: yi, w: c.plan.labelW, h: p.h - (p.id === c.selectedId ? c.inlineH : 0),
        lines: p.lines, fs: st.fs, lh: st.lh, weight: reading ? 600 : st.weight, tone: st.tone, time: p.hasT ? p.n.timeText!.trim() : null,
        meta: metaOf(c, p.id, shown, false), reading, selected: p.id === c.selectedId, hasKids: kidsOf(c, p.id).length > 0, expanded: p.id === c.expandedId,
      }),
    );
    const r = reading ? FLOW.TL_DOT_R_READING : FLOW.TL_DOT_R;
    out.prims.push({ k: "circle", id: `dot:${p.id}`, cx: ax, cy, r, fill: color, stroke: c.colors.bg, strokeW: 2, layer: "over" });
    if (reading) out.prims.push({ k: "circle", id: `ring:${p.id}`, cx: ax, cy, r: 10, fill: "none", stroke: c.colors.accent, strokeW: 1.5, opacity: 0.5, layer: "over" });
    if (!p.kids.length) {
      out.ports.push({ nodeId: p.id, x: ax - FLOW.TL_DOT_R - 1, y0: cy - 4, y1: cy + 4, color });
      out.leafIds.push(p.id);
    }
    dots.push({ id: p.id, cy, color, kids: p.kids });
    if (reading) out.readingY = cy;
    if (p.kids.length) {
      // 子项圆点挂在轴右侧 12px 的细分支线上
      const ky = yi + (p.hasT ? FLOW.TL_TIME_LH : 0) + p.lines.length * st.lh + FLOW.ROW_PAD_Y;
      const bx = ax + 12;
      out.prims.push({ k: "path", id: `kbr:${p.id}`, d: `M${bx},${cy + FLOW.TL_DOT_R + 2} V${ky + p.kidsH - 10}`, stroke: color, strokeW: 1, opacity: 0.5, layer: "under" });
      pushKidList(c, out, p.id, bx + 8, ky, bx);
    }
    y = yi + p.h + FLOW.ROW_GAP; // 最后一项之后的 y（给「下方另 N 项」）
  });
  // 轴段（相邻光点之间，颜色渐变；断层段画虚线 + 「//」）
  for (let i = 0; i + 1 < dots.length; i++) {
    const a = dots[i], b = dots[i + 1];
    const brk = breaks.has(i);
    out.prims.push({
      k: "path", id: `axis:${a.id}`, d: `M${ax},${a.cy + FLOW.TL_DOT_R + 2} V${b.cy - FLOW.TL_DOT_R - 2}`, stroke: a.color, strokeW: 2, opacity: 0.7,
      grad: { from: a.color, to: b.color, x1: ax, y1: a.cy, x2: ax, y2: b.cy }, dash: brk ? "4 3" : undefined, draw: !brk, layer: "under",
    });
    if (brk) {
      const my = (a.cy + b.cy) / 2;
      out.prims.push({ k: "path", id: `brk:${a.id}`, d: `M${ax - 5},${my + 2} L${ax + 1},${my - 4} M${ax - 1},${my + 4} L${ax + 5},${my - 2}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.45, layer: "over" });
    }
  }
  // 刻度（比例模式）：取 NICE 步长使刻度 3–8 个；画在轴左侧 4px 短线
  if (proportional && dots.length >= 2) {
    const t0 = ts[0]!, t1 = ts[ts.length - 1]!, range = Math.max(1e-6, t1 - t0);
    const step = NICE.find((s) => range / s <= 8) ?? 1000;
    for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) {
      // 找 v 落在哪一段，线性插值 y（跳过断层段）
      for (let i = 0; i + 1 < dots.length; i++)
        if (!breaks.has(i) && v >= ts[i]! && v <= ts[i + 1]!) {
          const yy = dots[i].cy + ((v - ts[i]!) / Math.max(1e-6, ts[i + 1]! - ts[i]!)) * (dots[i + 1].cy - dots[i].cy);
          out.prims.push({ k: "path", id: `tick:${v}`, d: `M${ax - 9},${Math.round(yy)} H${ax - 5}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.3, layer: "under" });
          break;
        }
    }
  }
  // 阅读游标：阅读块在阅读节点块范围内的比例 → 本光点与下一光点之间
  const ri = dots.findIndex((d) => d.id === c.readingId);
  if (ri >= 0 && c.readingBlock != null) {
    const n = nodeOf(c, dots[ri].id);
    const p = n.blockStart != null && n.blockEnd != null ? Math.max(0, Math.min(1, (c.readingBlock - n.blockStart) / Math.max(1, n.blockEnd - n.blockStart + 1))) : 0;
    const ny = ri + 1 < dots.length ? dots[ri + 1].cy : dots[ri].cy + 24;
    const cy = dots[ri].cy + p * (ny - dots[ri].cy);
    out.prims.push({ k: "path", id: "now", d: `M${ax - 13},${cy - 4} L${ax - 8},${cy} L${ax - 13},${cy + 4} Z`, stroke: c.colors.accent, strokeW: 1, layer: "over" });
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  return out;
}

// ---------------------------------------------------------------- §12.3.1 对照表：维度提取
export interface CompareTable {
  dims: { key: string; label: string }[];
  rows: { id: string; cells: ({ id: string; text: string } | null)[] }[];
  how: "named" | "paired" | "ordinal";
}
const DIM_RE = /^\s*([^：:，,。\s]{1,8})\s*[：:]\s*(.+)$/;
export function compareTable(g: GraphState, members: string[], maxDims = 6): CompareTable {
  const kids = members.map((m) => childrenOf(g, m).filter((k) => g.nodes[k]));
  const all = kids.flat();
  // ① 命名维度：「维度：内容」，且至少一半子节点符合
  const parsed = new Map<string, { dim: string; text: string }>();
  for (const k of all) {
    const m = String(g.nodes[k].title).match(DIM_RE);
    if (m) parsed.set(k, { dim: m[1].trim(), text: m[2].trim() });
  }
  if (all.length && parsed.size >= all.length / 2) {
    const dims: string[] = [];
    for (const k of all) {
      const d = parsed.get(k)?.dim;
      if (d && !dims.includes(d)) dims.push(d);
    }
    const use = dims.slice(0, maxDims);
    return {
      how: "named",
      dims: use.map((d) => ({ key: d, label: d })),
      rows: members.map((m, i) => ({
        id: m,
        cells: use.map((d) => {
          const k = kids[i].find((x) => parsed.get(x)?.dim === d);
          return k ? { id: k, text: parsed.get(k)!.text } : null;
        }),
      })),
    };
  }
  // ② 配对：子节点之间的「比」关系把它们放进同一列；第一个对象的子节点定列序
  const slotOf = new Map<string, number>();
  let slots = 0;
  kids.forEach((list, i) =>
    list.forEach((k) => {
      if (slotOf.has(k)) return;
      let s = -1;
      for (const e of g.outEdges[k] ?? [])
        if (e.code === "比" && slotOf.has(e.to)) {
          s = slotOf.get(e.to)!;
          break;
        }
      if (s < 0)
        for (const e of g.inEdges[k] ?? [])
          if (e.code === "比" && slotOf.has(e.from)) {
            s = slotOf.get(e.from)!;
            break;
          }
      if (s < 0 || kids[i].some((o) => o !== k && slotOf.get(o) === s)) s = slots++;
      slotOf.set(k, s);
    }),
  );
  const paired = all.some((k) => (g.outEdges[k] ?? []).some((e) => e.code === "比"));
  const n = Math.min(maxDims, paired ? slots : Math.max(0, ...kids.map((l) => l.length)));
  const colKids = (j: number) => kids.map((list) => (paired ? list.find((k) => slotOf.get(k) === j) : list[j]));
  const dims = Array.from({ length: n }, (_, j) => {
    const types = colKids(j)
      .filter(Boolean)
      .map((k) => String(g.nodes[k!].type ?? ""));
    const same = types.length > 0 && types.every((t) => t === types[0]) && types[0] !== "其他";
    return { key: `d${j}`, label: same ? types[0] : String(j + 1) };
  });
  return {
    how: paired ? "paired" : "ordinal",
    dims,
    rows: members.map((m, i) => ({
      id: m,
      cells: dims.map((_, j) => {
        const k = colKids(j)[i];
        return k ? { id: k, text: String(g.nodes[k].title) } : null;
      }),
    })),
  };
}

// ---------------------------------------------------------------- §12.3.2 对照表布局
export function layoutCompareTable(c: LayoutCtx): PatternLayout & { cmpPages: number } {
  const out = newLayout();
  const T = compareTable(c.g, c.members);
  let y = pushHeader(c, out, 0);
  const x0 = c.plan.labelX;
  const W = Math.max(c.plan.labelW, Math.min(FLOW.CMP_MAX_W, c.maxW)); // 表可以比普通标签区宽，但不越出视口
  const room = W - FLOW.CMP_NAME_W;
  const perPage = Math.max(1, Math.floor(room / FLOW.CMP_CELL_MIN));
  const stacked = perPage < 2 && T.dims.length >= 2; // 只放得下 1 列：改「行内维度」式
  const pages = stacked ? 1 : Math.max(1, Math.ceil(T.dims.length / perPage));
  const page = Math.min(Math.max(0, c.cmpPage), pages - 1);
  const vis = stacked ? T.dims.map((_, j) => j) : T.dims.map((_, j) => j).slice(page * perPage, page * perPage + perPage);
  const cellW = stacked ? room : Math.min(FLOW.CMP_CELL_MAX, Math.floor(room / Math.max(1, vis.length)));
  // 表头
  if (!stacked) {
    vis.forEach((j, v) =>
      out.items.push(
        item({
          id: `dim:${T.dims[j].key}`, nodeId: null, kind: "head", x: x0 + FLOW.CMP_NAME_W + v * cellW, y,
          w: cellW - 8, h: FLOW.CMP_HEAD_H, lines: wrapLabel(T.dims[j].label, 11, cellW - 8, 1), fs: 11, lh: FLOW.CMP_HEAD_H, weight: 500, tone: 56,
        }),
      ),
    );
    if (pages > 1)
      out.items.push(
        item({
          id: "cmp:pager", nodeId: null, kind: "more", x: x0 + W - 64, y: y - FLOW.HEADER_GAP - 16, w: 64, h: 16,
          lines: [`${page + 1} / ${pages}`], fs: 11, lh: 16, weight: 400, tone: 56, meta: "pager",
        }),
      );
    y += FLOW.CMP_HEAD_H;
    out.prims.push({ k: "path", id: "cmp:headline", d: `M${x0},${y} H${x0 + W}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.18, layer: "under" });
    y += 4;
    // 隔列底色
    vis.forEach((j, v) => {
      if (v % 2 === 1)
        out.prims.push({ k: "rect", id: `band:${j}`, x: x0 + FLOW.CMP_NAME_W + v * cellW - 4, y: y - 4, w: cellW, h: 0, fill: c.colors.fg, opacity: 0.035, layer: "under" });
    });
  }
  const bandIds = out.prims.filter((p) => p.id.startsWith("band:")).map((p) => p.id);
  const yTop = y;
  T.rows.forEach((r, i) => {
    const n = nodeOf(c, r.id), color = c.colorOf.get(r.id)!, reading = r.id === c.readingId;
    const nameLines = wrapLabel(n.title, 13, FLOW.CMP_NAME_W - 8, 3);
    const cellLines = vis.map((j) => {
      const cell = r.cells[j];
      if (stacked) return cell ? wrapLabel(cell.text, 12, room - 8 - 40, 2) : ["—"];
      return cell ? wrapLabel(cell.text, 12, cellW - 10, FLOW.CMP_CELL_LINES) : ["—"];
    });
    const nameH = nameLines.length * 18;
    const cellsH = stacked ? cellLines.reduce((a, l) => a + l.length * 17 + 4, 0) : Math.max(...cellLines.map((l) => l.length * 17));
    const h = Math.max(nameH, stacked ? nameH + 4 + cellsH : cellsH) + FLOW.CMP_ROW_PAD * 2;
    out.items.push(
      item({
        id: `n:${r.id}`, nodeId: r.id, kind: "node", x: x0, y: y + FLOW.CMP_ROW_PAD, w: stacked ? W : FLOW.CMP_NAME_W - 4, h: nameH,
        lines: nameLines, fs: 13, lh: 18, weight: 600, tone: 92, reading, selected: r.id === c.selectedId, lane: 0,
      }),
    );
    let sy = y + FLOW.CMP_ROW_PAD + nameH + 4;
    vis.forEach((j, v) => {
      const cell = r.cells[j];
      if (stacked) {
        out.items.push(
          item({
            id: cell ? `n:${cell.id}` : `cell:${r.id}:${j}`, nodeId: cell?.id ?? null, kind: "kid", x: x0 + 40, y: sy, w: room - 48, h: cellLines[v].length * 17,
            lines: cellLines[v], fs: 12, lh: 17, weight: 400, tone: cell ? 80 : 30, time: null, meta: "",
          }),
        );
        out.items.push(item({ id: `dl:${r.id}:${j}`, nodeId: null, kind: "head", x: x0, y: sy, w: 36, h: 17, lines: [T.dims[j].label], fs: 11, lh: 17, weight: 500, tone: 50 }));
        sy += cellLines[v].length * 17 + 4;
      } else {
        out.items.push(
          item({
            id: cell ? `n:${cell.id}` : `cell:${r.id}:${j}`, nodeId: cell?.id ?? null, kind: "kid", x: x0 + FLOW.CMP_NAME_W + v * cellW, y: y + FLOW.CMP_ROW_PAD,
            w: cellW - 10, h: cellLines[v].length * 17, lines: cellLines[v], fs: 12, lh: 17, weight: 400, tone: cell ? 80 : 30,
          }),
        );
      }
    });
    const by = y + 2, bh = h - 4;
    out.prims.push({ k: "rect", id: `bar:${r.id}`, x: c.plan.barX, y: by, w: reading ? 6 : 5, h: bh, rx: 1.5, fill: reading ? c.colors.accent : color, layer: "over" });
    out.ports.push({ nodeId: r.id, x: c.plan.barX, y0: by, y1: by + bh, color });
    out.leafIds.push(r.id);
    if (reading) out.readingY = y + h / 2;
    y += h;
    if (i + 1 < T.rows.length) out.prims.push({ k: "path", id: `rowline:${r.id}`, d: `M${x0},${y} H${x0 + W}`, stroke: c.colors.fg, strokeW: 1, dash: "2 3", opacity: 0.12, layer: "under" });
  });
  // 隔列底色高度补齐到表底
  for (const id of bandIds) {
    const p = out.prims.find((q) => q.id === id) as Extract<FlowPrim, { k: "rect" }>;
    p.h = y - yTop + 4;
  }
  // 「比」关系已由「同列」表达
  for (const r of T.rows) for (const cell of r.cells) if (cell) for (const e of c.g.outEdges[cell.id] ?? []) if (e.code === "比") out.expressed.push(edgeKey(cell.id, e.to, "比"));
  for (const a of c.members) for (const b of c.members) out.expressed.push(edgeKey(a, b, "比"));
  if (c.selectedId && T.rows.some((r) => r.id === c.selectedId)) {
    out.inlineAt = { x: x0, y, w: W };
    y += c.inlineH; // 动作行放在表底
  }
  out.height = y;
  out.noStrands = true;
  return { ...out, cmpPages: pages };
}

// ---------------------------------------------------------------- §5.5.5 版式分派
export const PATTERN_LABEL: Record<FlowPattern, string> = { tree: "大纲", grid: "并列", argument: "论证", timeline: "时间线", chain: "步骤", layered: "因果", compare: "对照" };

export function patternFor(g: GraphState, cut: string, members: string[]): FlowPattern {
  const p = selectPattern(groupFacts(g, cut, members)).pattern; // 现有选择器：手动 > 模型提示 > 规则表
  if (p === "compare" && (members.length < 2 || members.length > FLOW.CMP_MAX)) return "tree";
  return p as FlowPattern;
}

export function layoutFor(c: LayoutCtx): PatternLayout {
  switch (c.pattern) {
    case "argument":
      return layoutTree(c, { compact: false, claimRoot: true, layered: false, spans: true });
    case "grid":
      return layoutTree(c, { compact: true, claimRoot: false, layered: false, spans: true });
    case "layered":
      return layoutTree(c, { compact: false, claimRoot: false, layered: true, spans: false });
    case "timeline":
      return layoutTimeline(c);
    case "chain":
      return layoutChain(c);
    case "compare":
      return layoutCompareTable(c);
    default:
      return layoutTree(c, { compact: false, claimRoot: false, layered: false, spans: true });
  }
}

/** 成员窗口 + 逐步收缩直到装下：maxMembers 从 9 降到 3，再降行数；对照版式不窗口化（成员 2–4） */
export function fitLayout(
  base: Omit<LayoutCtx, "members" | "moreAbove" | "moreBelow" | "maxLines0"> & { winStart?: number },
  all: string[],
  availH: number,
): PatternLayout & { members: string[] } {
  if (base.pattern === "compare" && all.length >= 2 && all.length <= FLOW.CMP_MAX) {
    const lay = layoutFor({ ...base, members: all, moreAbove: 0, moreBelow: 0, maxLines0: 2, availH });
    return { ...lay, members: all };
  }
  const ri = Math.max(0, all.indexOf(base.readingId ?? ""));
  const win = (max: number) => {
    const k = base.winStart;
    if (k != null && k >= 0 && k + max <= all.length) {
      const lo = k + (k > 0 ? 1 : 0), hi = k + max - 1 - (k + max < all.length ? 1 : 0);
      if (ri >= lo && ri <= hi) return { members: all.slice(k, k + max), moreAbove: k, moreBelow: all.length - k - max };
    }
    const start = Math.max(0, Math.min(ri - Math.floor((max - 1) / 2), all.length - max));
    const end = Math.min(all.length, start + max);
    return { members: all.slice(start, end), moreAbove: start, moreBelow: all.length - end };
  };
  let last: (PatternLayout & { members: string[] }) | null = null;
  for (const lines of [2, 1] as const)
    for (let max = Math.min(FLOW.MAX_MEMBERS, all.length); max >= Math.min(FLOW.MIN_MEMBERS, all.length); max--) {
      const w = win(max);
      const lay = layoutFor({ ...base, ...w, maxLines0: lines, availH } as LayoutCtx);
      last = { ...lay, members: w.members };
      if (lay.height <= availH) return last;
    }
  return last!;
}

// ---------------------------------------------------------------- §5.6 高亮流带
/** 统一形状：左段圆角矩形（文字高亮）→ 右缘不断开地弯成 Sankey 流带 → 节点 port。命令序列固定，CSS d 才能插值。 */
export function shapePath(s: Pick<FlowShape, "L" | "xs" | "s0" | "s1" | "x1" | "t0" | "t1">): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  const r = Math.max(0, Math.min(FLOW.HL_R, (s.s1 - s.s0) / 2, (s.xs - s.L) / 2));
  const xm = (s.xs + s.x1) / 2;
  return (
    `M${f(s.L + r)},${f(s.s0)}H${f(s.xs)}C${f(xm)},${f(s.s0)} ${f(xm)},${f(s.t0)} ${f(s.x1)},${f(s.t0)}` +
    `L${f(s.x1)},${f(s.t1)}C${f(xm)},${f(s.t1)} ${f(xm)},${f(s.s1)} ${f(s.xs)},${f(s.s1)}` +
    `H${f(s.L + r)}Q${f(s.L)},${f(s.s1)} ${f(s.L)},${f(s.s1 - r)}V${f(s.s0 + r)}Q${f(s.L)},${f(s.s0)} ${f(s.L + r)},${f(s.s0)}Z`
  );
}
/** 收在段落左端（开场的起点 / 关闭的终点）：零宽 */
export const collapseAtLeft = (s: FlowShape): FlowShape => ({ ...s, xs: s.L, x1: s.L, t0: s.s0, t1: s.s1 });
/** 收进节点 port（翻页 / 换组的离场终点、进场起点） */
export const collapseAtNode = (s: FlowShape): FlowShape => ({ ...s, L: s.x1, xs: s.x1, s0: s.t0, s1: s.t1 });
/** §13.3.3：收在段落右缘（滚动模式开场的起点 / 关闭的终点） */
export const collapseAtEdge = (s: FlowShape): FlowShape => ({ ...s, x1: s.xs, t0: s.s0, t1: s.s1 });

export interface MergedSpan { nodeId: string; doc: number; column: number; left: number; right: number; top: number; bottom: number }
/** §13.3.3：同节点、同章、同栏、相邻（间距 ≤ HL_MERGE_GAP）的段落合并成一块，再上下外扩（不与相邻块重叠） */
export function mergeSpans(boxes: ReaderParagraphBox[], keep: Set<string>): MergedSpan[] {
  const spans: MergedSpan[] = [];
  const sorted = boxes.filter((b) => keep.has(b.nodeId)).sort((a, b) => a.column - b.column || a.top - b.top);
  for (const b of sorted) {
    const last = spans[spans.length - 1];
    const doc = b.doc ?? -1;
    if (last && last.nodeId === b.nodeId && last.column === b.column && last.doc === doc && b.top - last.bottom <= FLOW.HL_MERGE_GAP) {
      last.bottom = Math.max(last.bottom, b.bottom);
      last.left = Math.min(last.left, b.left);
      last.right = Math.max(last.right, b.right);
    } else spans.push({ nodeId: b.nodeId, doc, column: b.column, left: b.left, right: b.right, top: b.top, bottom: b.bottom });
  }
  spans.forEach((s, i) => {
    const prev = spans[i - 1], next = spans[i + 1];
    s.top = Math.max(s.top - FLOW.HL_PAD_Y, prev && prev.column === s.column && prev.doc === s.doc ? prev.bottom + 1 : -Infinity);
    s.bottom = Math.min(s.bottom + FLOW.HL_PAD_Y, next && next.column === s.column && next.doc === s.doc ? next.top - 1 : Infinity);
    s.left -= FLOW.HL_PAD_X;
    s.right += FLOW.HL_PAD_X;
  });
  return spans;
}

export function buildShapes(
  geo: ReaderStructureGeometry,
  lay: PatternLayout,
  dy: number,
  o: {
    focusId: string | null;
    hoverId: string | null;
    readingId: string | null;
    colorOf: (id: string) => string;
    /** v3.1 §12.2：悬停节点的全部下级也提 focus 档；不在集合内的形状 is-dim */
    hoverSet?: Set<string>;
    /** v3.1 §12.3.2：悬停单元格（不在 ports 里）只出矩形段，不额外出流带 */
    extra?: { nodeId: string; color: string }[];
  },
): FlowShape[] {
  const ports = new Map(lay.ports.map((p) => [p.nodeId, { ...p, y0: p.y0 + dy, y1: p.y1 + dy }] as const));
  const extraSet = new Set((o.extra ?? []).map((e) => e.nodeId));
  const extraColor = new Map((o.extra ?? []).map((e) => [e.nodeId, e.color] as const));
  const rightCol = geo.columns.length - 1;
  const tone = (id: string): 0 | 1 | 2 => (id === o.hoverId ? 2 : o.hoverSet?.has(id) || id === o.focusId ? 1 : 0);
  // 1–2) 合并 + 外扩（§13.3.3 抽成 mergeSpans；滚动模式正文矩形用同一实现）
  const spans = mergeSpans(geo.boxes, new Set([...ports.keys(), ...extraSet]));
  // 3) 最右栏的块按 port 比例分配落点；其它栏只有高亮矩形（流带段退化）
  const out: FlowShape[] = [];
  let order = 0;
  const byNode = new Map<string, MergedSpan[]>();
  for (const s of spans) if (s.column === rightCol && !extraSet.has(s.nodeId)) {
    const l = byNode.get(s.nodeId) ?? [];
    l.push(s);
    byNode.set(s.nodeId, l);
  }
  for (const s of spans)
    if (s.column !== rightCol || extraSet.has(s.nodeId))
      out.push({
        id: `${s.nodeId}@${s.column}:${Math.round(s.top)}`, nodeId: s.nodeId, color: extraColor.get(s.nodeId) ?? o.colorOf(s.nodeId), L: s.left, xs: s.right, s0: s.top, s1: s.bottom,
        x1: s.right, t0: s.top, t1: s.bottom, tone: tone(s.nodeId), stub: "", ribbon: false, order: order++,
      });
  for (const p of lay.ports) {
    const list = byNode.get(p.nodeId);
    if (!list) continue;
    const port = ports.get(p.nodeId)!;
    const H = port.y1 - port.y0;
    const S = list.reduce((a, s) => a + (s.bottom - s.top), 0) || 1;
    const raw = list.map((s) => Math.max(FLOW.MIN_SLICE, H * ((s.bottom - s.top) / S)));
    const kk = H / raw.reduce((a, v) => a + v, 0);
    let t = port.y0;
    list.forEach((s, i) => {
      const h = raw[i] * kk;
      out.push({
        id: `${p.nodeId}#${i}`, nodeId: p.nodeId, color: port.color, L: s.left, xs: s.right, s0: s.top, s1: s.bottom,
        x1: port.x, t0: t, t1: t + h, tone: tone(p.nodeId), stub: "", ribbon: true, order: order++,
      });
      t += h;
    });
  }
  // 4) 看不见的近邻成员：从视口上 / 下缘伸出的楔形淡流（矩形段为零宽）
  const ri = lay.ports.findIndex((p) => p.nodeId === o.readingId);
  lay.ports.forEach((p, i) => {
    if (byNode.has(p.nodeId) || spans.some((s) => s.nodeId === p.nodeId)) return;
    if (ri >= 0 && Math.abs(i - ri) > FLOW.STUB_ROWS) return;
    const side = lay.sideOf?.[p.nodeId] ?? "here";
    if (side === "here") return;
    const port = ports.get(p.nodeId)!, yy = side === "above" ? geo.viewport.top : geo.viewport.bottom;
    const x0 = (geo.text?.right ?? geo.viewport.right) + FLOW.HL_PAD_X;
    const mid = (port.y0 + port.y1) / 2, hh = Math.max(2, (port.y1 - port.y0) * 0.4);
    out.push({
      id: `stub:${p.nodeId}`, nodeId: p.nodeId, color: port.color, L: x0, xs: x0, s0: yy, s1: yy, x1: port.x, t0: mid - hh / 2, t1: mid + hh / 2,
      tone: 0, stub: side, ribbon: true, order: order++,
    });
  });
  return out;
}

/** §13.3.3：文档坐标的几何 + 此刻的章节偏移 → 屏幕几何（裁到视口；与适配器原先的裁剪规则一致） */
export function geometryAt(geo: ReaderStructureGeometry, offs: Record<number, { left: number; top: number }>): ReaderStructureGeometry {
  const vp = geo.viewport;
  const boxes: ReaderParagraphBox[] = [];
  for (const b of geo.boxes) {
    const o = b.doc != null ? offs[b.doc] : undefined;
    if (!o || b.cTop == null || b.cBottom == null || b.cLeft == null || b.cRight == null) {
      boxes.push(b);
      continue;
    }
    const T0 = b.cTop + o.top, B0 = b.cBottom + o.top;
    const top = Math.max(T0, vp.top), bottom = Math.min(B0, vp.bottom);
    if (bottom - top < 6) continue;
    boxes.push({ ...b, left: b.cLeft + o.left, right: b.cRight + o.left, top, bottom, clipTop: T0 < vp.top, clipBottom: B0 > vp.bottom });
  }
  return { ...geo, boxes };
}

/** §13.3.3：只画「段落右缘 → 节点 port」那一段（矩形部分在正文里） */
export function neckPath(s: Pick<FlowShape, "xs" | "s0" | "s1" | "x1" | "t0" | "t1">): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  const xm = (s.xs + s.x1) / 2;
  return (
    `M${f(s.xs)},${f(s.s0)}C${f(xm)},${f(s.s0)} ${f(xm)},${f(s.t0)} ${f(s.x1)},${f(s.t0)}` +
    `L${f(s.x1)},${f(s.t1)}C${f(xm)},${f(s.t1)} ${f(xm)},${f(s.s1)} ${f(s.xs)},${f(s.s1)}Z`
  );
}

/** §13.3.3：正文里的段落高亮矩形（文档坐标；透明度与颈部渐变起点一致，接缝颜色连续） */
export function buildPaintRects(
  geo: ReaderStructureGeometry,
  _lay: PatternLayout,
  o: {
    hoverId: string | null;
    focusId: string | null;
    hoverSet?: Set<string>;
    colorOf: (id: string) => string;
    extra?: { nodeId: string; color: string }[];
    /** §14.4：port 色（与颈部同源；子节点色不在 colorOf 里，缺了会与彩带不同色） */
    portColorOf?: Map<string, string>;
    colors: FlowColors;
  },
): ReaderStructurePaintRect[] {
  const keep = new Set([..._lay.ports.map((p) => p.nodeId), ...(o.extra ?? []).map((e) => e.nodeId)]);
  const extraColor = new Map((o.extra ?? []).map((e) => [e.nodeId, e.color] as const));
  const content = geo.boxes
    .filter((b) => b.doc != null && b.cTop != null)
    .map((b) => ({ ...b, top: b.cTop!, bottom: b.cBottom!, left: b.cLeft!, right: b.cRight! }));
  const tone = (id: string): 0 | 1 | 2 => (id === o.hoverId ? 2 : o.hoverSet?.has(id) || id === o.focusId ? 1 : 0);
  return mergeSpans(content, keep).map((s) => {
    const t = tone(s.nodeId);
    const dim = !!o.hoverId && s.nodeId !== o.hoverId && t === 0; // 与 FlowLayer 的 is-dim 同一规则
    const raw = extraColor.get(s.nodeId) ?? o.portColorOf?.get(s.nodeId) ?? o.colorOf(s.nodeId);
    const color = parseRgb(raw) ? raw : o.colors.palette[0]; // §13.4.3：不可解析色一律退调色板第一色
    return {
      key: `${s.nodeId}@${s.doc}:${Math.round(s.top)}`, doc: s.doc!, left: s.left, top: s.top, width: s.right - s.left, height: s.bottom - s.top,
      color, alpha: o.colors.aHL[t] * (dim ? o.colors.aDim : 1), fade: FLOW.HL_FADE_W,
    };
  });
}
export function strandPath(s: Pick<FlowStrand, "xa" | "ya" | "xb" | "yb" | "bulge">): string {
  return `M${s.xa},${s.ya}C${s.xa - s.bulge},${s.ya} ${s.xb - s.bulge},${s.yb} ${s.xb},${s.yb}`;
}
export const collapseStrand = (s: FlowStrand): FlowStrand => ({ ...s, xb: s.xa, yb: s.ya, bulge: 0 });

export function buildStrands(g: GraphState, lay: PatternLayout, dy: number, o: { textRight: number; focusId: string | null; all: boolean }): FlowStrand[] {
  if (lay.noStrands) return [];
  const ports = new Map(lay.ports.map((p) => [p.nodeId, p] as const));
  const expressed = new Set(lay.expressed);
  const seen = new Set<string>();
  const list: { e: { from: string; to: string; code: string }; dy: number; hot: boolean }[] = [];
  const mid = (p: FlowPort) => (p.y0 + p.y1) / 2 + dy;
  for (const id of ports.keys())
    for (const e of g.outEdges[id] ?? []) {
      const key = `${e.from}>${e.to}>${e.code}`;
      if (e.from === e.to || !ports.has(e.to) || expressed.has(key) || seen.has(key)) continue;
      seen.add(key);
      list.push({ e, dy: Math.abs(mid(ports.get(e.from)!) - mid(ports.get(e.to)!)), hot: e.from === o.focusId || e.to === o.focusId });
    }
  list.sort((a, b) => Number(b.hot) - Number(a.hot) || a.dy - b.dy);
  return list.slice(0, o.all ? 16 : FLOW.MAX_STRANDS).map(({ e, dy: d, hot }, order) => {
    const reverse = e.code === "据"; // 「据」＝目标 → 本节点
    const A = ports.get(reverse ? e.to : e.from)!, B = ports.get(reverse ? e.from : e.to)!;
    const xa = A.x - 1, xb = B.x - 1;
    const room = Math.max(18, Math.min(xa, xb) - o.textRight - 16);
    return {
      id: `${e.from}>${e.to}>${e.code}`, from: e.from, to: e.to, code: e.code, xa, ya: mid(A), xb, yb: mid(B),
      bulge: Math.max(18, Math.min(18 + 0.28 * d, room)), colorA: A.color, colorB: B.color, strong: hot, reverse, order,
    };
  });
}

// ---------------------------------------------------------------- §13.2.1 列位置
export const COLUMN = { ABOVE_ROWS: 2, ABOVE_SLOT: 20 + 2 * 22 + 16 + 8 }; // 上方预览固定槽：标题 20 + 2 行 × 22 + 「另 N 项」16 + 间距 8 = 88（§14.3）

// ---------------------------------------------------------------- §13.1 注意力判定（取代 §12.4.2）
export const ATTN = {
  FRACS: [0.12, 0.38, 0.62, 0.88], W: [0.10, 0.50, 0.28, 0.12],
  SWITCH: 0.6, LEAVE: 0.25, HOLD: 0.5,
  ZOOM: 0.9, // 视口 ≥90% 权重落在当前组某个成员的子节点里 → 驻留后放大进该成员
  DWELL_MS: 600, NODE_DWELL_MS: 250, PEEK_MIN: 0.1,
};
export interface AttnSample { frac: number; nodeId: string | null; chain: string[] } // chain：根 → 节点（graphLocate 的 chain）
export interface AttnState { groupId: string | null; readingId: string | null; candGroup: string | null; candSince: number; candNode: string | null; nodeSince: number }
export interface AttnResult extends AttnState {
  peek: { groupId: string; side: "above" | "below" } | null;
  switched: "" | "down" | "up";
  /** 注意力样本落在某个成员的子节点里 → 返回该成员（宿主据此自动展开） */
  deepMember: string | null;
  /** 有候选组在等驻留：宿主应在这么多 ms 后（滚动已停时）再取一次样；null 表示不需要 */
  recheckMs: number | null;
}
/** 显示组：最深节点的父（顶层节点的父＝ROOT_ID） */
const groupOfChain = (chain: string[]) => (chain.length >= 2 ? chain[chain.length - 2] : ROOT_ID);
/** 上层组：显示组的父；chain 只有 1 个节点时为 null */
const upperOfChain = (chain: string[]) => (chain.length >= 3 ? chain[chain.length - 3] : chain.length === 2 ? ROOT_ID : null);
/** 样本是否归 G 显示：最深节点是 G 的成员，或是 G 某成员的子节点。G 的更深子孙不算——这正是旧版卡在顶层的根因 */
const belongs = (s: AttnSample, G: string) => !!s.nodeId && (groupOfChain(s.chain) === G || upperOfChain(s.chain) === G);
/** 样本在 G 下对应的成员 */
const memberIn = (s: AttnSample, G: string): string | null => {
  if (!s.nodeId) return null;
  if (groupOfChain(s.chain) === G) return s.chain[s.chain.length - 1];
  if (upperOfChain(s.chain) === G) return s.chain[s.chain.length - 2];
  return null;
};

export function decideAttention(samples: AttnSample[], prev: AttnState, now: number, o: { paged: boolean; idle: boolean }): AttnResult {
  const W = (f: number) => ATTN.W[ATTN.FRACS.indexOf(f)] ?? 0;
  const hit = samples.filter((s) => s.nodeId);
  const score = (G: string) => hit.reduce((a, s) => a + (belongs(s, G) ? W(s.frac) : 0), 0);
  const exact = (G: string) => hit.reduce((a, s) => a + (groupOfChain(s.chain) === G ? W(s.frac) : 0), 0);
  const upperOf = new Map<string, string | null>(); // 显示组 → 它的上层组（从样本 chain 推得）
  for (const s of hit) upperOf.set(groupOfChain(s.chain), upperOfChain(s.chain));
  const cands = [...upperOf.keys()].map((g) => [g, exact(g)] as const).sort((a, b) => b[1] - a[1]);
  const best = cands[0]?.[0] ?? null;
  const st: AttnState = { ...prev };
  const cur = prev.groupId;
  const curScore = cur ? score(cur) : 0;
  let recheckMs: number | null = null;
  /** 驻留：同一候选持续 need ms 且滚动已停才算数；翻页模式不等 */
  const dwell = (g: string, need: number): boolean => {
    if (o.paged) return true;
    if (prev.candGroup !== g) {
      st.candGroup = g;
      st.candSince = now;
      recheckMs = need;
      return false;
    }
    const left = need - (now - prev.candSince);
    if (left <= 0 && o.idle) return true;
    recheckMs = Math.max(0, left);
    return false;
  };
  if (!best) {
    /* 全部落空：保持现状 */
  } else if (!cur || curScore === 0) {
    st.groupId = best;
    st.candGroup = null;
  } else if (best === cur) st.candGroup = null;
  else {
    const bs = exact(best);
    const zoomIn = upperOf.get(best) === cur; // best 是 cur 的某个成员 → 放大
    if (zoomIn) {
      if (bs >= (cur === ROOT_ID ? ATTN.SWITCH : ATTN.ZOOM)) {
        if (dwell(best, ATTN.DWELL_MS)) st.groupId = best;
      } else st.candGroup = null;
    } else if (bs >= ATTN.SWITCH && curScore <= ATTN.LEAVE) st.groupId = best;
    else if (bs >= ATTN.HOLD && bs > curScore) {
      if (dwell(best, ATTN.DWELL_MS)) st.groupId = best;
    } else st.candGroup = null;
  }
  let switched: AttnResult["switched"] = "";
  if (st.groupId !== cur && cur && st.groupId) {
    const meanF = (G: string) => {
      const l = hit.filter((s) => belongs(s, G));
      return l.length ? l.reduce((a, s) => a + s.frac, 0) / l.length : 0.5;
    };
    switched = meanF(st.groupId) >= meanF(cur) ? "down" : "up";
    st.candGroup = null;
    recheckMs = null;
  }
  // 阅读节点：本组内离 38% 最近的样本对应的成员；节点变化需驻留（切组 / 翻页 / 首次不需要）
  const G = st.groupId;
  let node: string | null = null, deepMember: string | null = null;
  if (G) {
    const inG = hit.filter((s) => belongs(s, G)).sort((a, b) => Math.abs(a.frac - 0.38) - Math.abs(b.frac - 0.38));
    if (inG.length) {
      node = memberIn(inG[0], G);
      if (groupOfChain(inG[0].chain) !== G) deepMember = node;
    }
  }
  if (switched || !prev.readingId || o.paged) {
    st.readingId = node;
    st.candNode = null;
  } else if (node && node !== prev.readingId) {
    if (prev.candNode !== node) {
      st.candNode = node;
      st.nodeSince = now;
    } else if (now - prev.nodeSince >= ATTN.NODE_DWELL_MS) {
      st.readingId = node;
      st.candNode = null;
    }
  } else st.candNode = null;
  // 邻组预览：当前组之外、且不是当前组成员展开（上层组≠G）的组里得分最高、≥ PEEK_MIN 的那个
  let peek: AttnResult["peek"] = null;
  if (G) {
    const other = cands.find(([g, v]) => g !== G && upperOf.get(g) !== G && v >= ATTN.PEEK_MIN);
    if (other) {
      const mean = (l: AttnSample[]) => l.reduce((a, s) => a + s.frac, 0) / Math.max(1, l.length);
      const fO = mean(hit.filter((s) => groupOfChain(s.chain) === other[0]));
      const fG = mean(hit.filter((s) => belongs(s, G)));
      peek = { groupId: other[0], side: fO >= fG ? "below" : "above" };
    }
  }
  return { ...st, peek, switched, deepMember, recheckMs };
}

// ---------------------------------------------------------------- §12.4.4 邻组预览
export const PEEK = { MAX_ROWS: 4, SCALE: 0.86, TONE: 55, GAP: 18, ROW_H: 22 };

export function layoutPeek(c: LayoutCtx, groupId: string, side: "above" | "below", maxRows = PEEK.MAX_ROWS): PatternLayout {
  const out = newLayout();
  const title = groupId === ROOT_ID ? c.header : String(c.g.nodes[groupId]?.title ?? "");
  const kids = childrenOf(c.g, groupId).filter((k) => c.g.nodes[k]);
  const show = kids.slice(0, Math.max(0, maxRows));
  let y = 0;
  // 分隔：一条 24px 发丝线 + 下一部分标题（11px fg 45%）
  out.prims.push({ k: "rect", id: `peekline:${groupId}`, x: c.plan.labelX, y: y + 6, w: 24, h: 1, fill: c.colors.fg, opacity: 0.25, layer: "under" });
  out.items.push(
    item({
      id: `n:${groupId}`, nodeId: groupId, kind: "head", x: c.plan.labelX + 30, y, w: c.plan.labelW - 30, h: 14,
      lines: wrapLabel(title, 11, c.plan.labelW - 30, 1), fs: 11, lh: 14, weight: 500, tone: 45, meta: side === "below" ? "下一部分" : "上一部分", peek: true,
    }),
  );
  y += 20;
  show.forEach((id, i) => {
    const n = nodeOf(c, id), color = c.colorOf.get(id) ?? c.colors.palette[i % 8];
    const t = tierOf(String(n.type ?? "")), lane = t === 0 ? 0 : t === 2 ? 2 : 1;
    const st = LANE_STYLE[lane];
    out.items.push(
      item({
        id: `n:${id}`, nodeId: id, kind: "node", x: c.plan.labelX, y, w: c.plan.labelW, h: st.lh,
        lines: wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, 1), fs: st.fs, lh: st.lh, weight: st.weight, tone: PEEK.TONE, lane, peek: true,
      }),
    );
    const bx = c.plan.barX + lane * FLOW.LANE_DX;
    out.prims.push({ k: "rect", id: `bar:${id}`, x: bx, y: y + 2, w: 3, h: st.lh - 4, rx: 1.5, fill: color, opacity: 0.7, layer: "over" });
    out.ports.push({ nodeId: id, x: bx, y0: y + 2, y1: y + st.lh - 2, color });
    out.leafIds.push(id);
    y += PEEK.ROW_H;
  });
  if (kids.length > show.length) {
    out.items.push(
      item({ id: `more:peek:${groupId}`, nodeId: groupId, kind: "more", x: c.plan.labelX, y, w: c.plan.labelW, h: 16, lines: [""], fs: 11, lh: 16, weight: 400, tone: 40, moreKind: "kids", moreCount: kids.length - show.length }),
    );
    y += 16;
  }
  out.height = y;
  return out;
}
