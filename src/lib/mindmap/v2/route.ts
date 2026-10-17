// 材料导图 v2 · 关系路由（MINDMAP-V2-IMPL-PLAN §5.1 route.ts；设计稿 §15.2 / §15.6 / §15.7）。
// 纯函数、确定性（无随机源、无 DOM、无时钟）。输入＝图状态 + 布局结果 Display（或 animate 插值帧）+ 显示策略。
//
// 规则：
// - 组内关系：Display.edges 中 kind 'rel' 的边（版式已排布、已登记 consumed），恒显示。
// - 跨组关系：数据关系中未被 Display.consumed 消化的那些。
//   · 端点提升：端点折叠 / 尚未生成 / 被 LOD 截断或收进摘要卡时，挂到最近的可见祖先卡片；
//     未到达的节点按路径式 id（X6，`t3.2.1` → `t3.2`）推断祖先。提升后两端相同则丢弃。
//   · ×N 合并：同一对可见端点、同画法方向、同码的多条关系合并为一条（count = N，orig 列出原关系）。
//   · 「据」画成目标 → 本节点（与 layout ctx.rel 同口径）。
// - 端点挂框：端点已展开成组框、且另一端不在该框内时，挂框边；组内父子之间（另一端在框内）仍连卡片。
// - 障碍：卡片（两端卡片除外）+ 不包含任一端点的组框；通道段中端点卡片 / 端点所挂的框本身也算障碍。
// - 几何（按序尝试，首个成功即用）：
//   1) 直连曲线（竖向 / 横向两种朝向），贝塞尔包围盒递归细分做精确碰撞（不依赖采样密度）；
//   2) 侧边通道（§15.6）：两端各自「逃逸」到一条无障碍的水平（或竖直）射线，经一条跨越两端整段跨度
//      都空着的竖直（或水平）通道相连；选通道时即按占用表做 4px 分道；
//   3) 压缩栅格加权 A*（坐标＝障碍净空线 + 空隙中线 + 端口线）兜底；
//   通道折线转角圆化（R=8）；最后对全部通道段做同轴 4px 分道（贪心，平移后精确复核不碰障碍）。
// - 显示策略：组内恒显；跨组仅 relAll 或与 hovered/selected 相连（hot）时画；hot＝accent 全亮，
//   relAll 下其余跨组淡色 0.55；关系透视（focus+selected）时非 hot 关系 0.15，focus 集＝自身 + 对端 + 祖先链。
//   默认只为可见边计算几何（geometry:'all' 可全算）。↗N＝每个可见端点上的跨组关系条数（按原关系计）。
// - 标签：hot 时显示关系名（×N 附后）、「比」常显 vs、zoom≥0.8 常显关系名，其余仅 N>1 时显示 ×N；
//   位置沿路径弧长在 0.5 附近择优，避开卡片与已放标签。

import type { GraphState, RelCode } from "./types";
import { ROOT_ID } from "./types";
import type { Display, DisplayItem, Rect } from "./layout";
import { textWidth } from "./measure";
import { frameChain } from "./animate";

// ───────────────────────── 线型表（§8.2：只用线型 / 端头区分，不用颜色） ─────────────────────────

export type MarkerKind = "arrow" | "bar" | "open" | "dot";

export interface RelStyle {
  name: string;
  /** stroke-dasharray（空串＝实线） */
  dash: string;
  /** 终点端头 */
  end: MarkerKind;
  /** 起点端头（仅「比」两端圆点） */
  start: MarkerKind | null;
  width: number;
}

export const REL_STYLE: Readonly<Record<RelCode, RelStyle>> = {
  支: { name: "支持", dash: "", end: "arrow", start: null, width: 1.25 },
  驳: { name: "反驳", dash: "", end: "bar", start: null, width: 1.25 },
  据: { name: "依据", dash: "5 3", end: "open", start: null, width: 1.25 },
  推: { name: "推出", dash: "", end: "arrow", start: null, width: 2 },
  因: { name: "导致", dash: "", end: "arrow", start: null, width: 1.75 },
  比: { name: "对比", dash: "", end: "dot", start: "dot", width: 1 },
  例: { name: "例示", dash: "1.5 3", end: "open", start: null, width: 1.25 },
  答: { name: "回答", dash: "8 3 2 3", end: "arrow", start: null, width: 1.25 },
};

export const ROUTE = {
  /** 碰撞判定外扩（线到障碍的最小距离） */
  MARGIN: 4,
  /** 通道净空（通道线到障碍的距离；端口外伸长度） */
  CLEAR: 6,
  /** sampleEdge 默认步长 */
  STEP: 6,
  /** 平行分道间距 */
  LANE: 4,
  /** 复核分道时单侧最多尝试的道数 */
  MAX_LANES: 64,
  /** 选通道时单侧最多尝试的道数（外侧无界空隙可一直向外分道） */
  MAX_LANE_STEPS: 1024,
  /** 通道转角半径 */
  RADIUS: 8,
  /** 端口在同一侧边上的错开步长 */
  PORT_STEP: 12,
  /** A*：转弯代价（以 8px 计）、共用通道代价与上限、启发式权重、最大展开数、两端附近纳入栅格的范围 */
  TURN: 4,
  SHARE: 0.1,
  SHARE_MAX: 0.5,
  WEIGHT: 2,
  MAX_EXPAND: 20000,
  LOCAL_PAD: 240,
  /** 上下逃逸水平线的分道平移步数（单侧） */
  SLIDE_STEPS: 6,
  /** 每对逃逸只考虑离中点最近的空隙数（单侧） */
  GAP_NEAR: 2,
  /** 侧边通道最多尝试的候选数 */
  MAX_CANDS: 512,
  /** 标签高度 / 水平内边距 / 字号 */
  LABEL_H: 18,
  LABEL_PAD: 8,
  LABEL_SIZE: 11,
  /** 缩放 ≥ 此值常显关系名 */
  LABEL_ZOOM: 0.8,
  /** relAll 下非高亮跨组关系、关系透视下非相关关系的不透明度 */
  DIM_CROSS: 0.55,
  DIM_FOCUS: 0.15,
} as const;

// ───────────────────────── 类型 ─────────────────────────

export type P2 = [number, number];

/** 路径段（绝对坐标）：直线 / 三次 / 二次贝塞尔 */
export type PathSeg =
  | { k: "L"; a: P2; b: P2 }
  | { k: "C"; a: P2; c0: P2; c1: P2; b: P2 }
  | { k: "Q"; a: P2; c: P2; b: P2 };

export interface RelPolicy {
  /** 「全部关系」开关 */
  relAll?: boolean;
  hovered?: string | null;
  selected?: string | null;
  /** 「关系透视」开关（需 selected） */
  focus?: boolean;
  /** 当前缩放（标签显示策略） */
  zoom?: number;
  /** LOD 收起的组（animate.lodFrames） */
  lodCollapsed?: Iterable<string>;
  /** 'visible'（默认）只为要画的边算几何；'all' 全算 */
  geometry?: "visible" | "all";
  /** 关系名（i18n）；默认 REL_STYLE[code].name */
  relName?: (code: RelCode) => string;
}

export interface RelRef {
  from: string;
  to: string;
  code: RelCode;
}

export interface RoutedLabel {
  /** 中心点 */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export type RouteHow = "direct" | "channel" | "search" | "blocked";

export interface RoutedEdge {
  /** 确定性唯一 id */
  id: string;
  kind: "intra" | "cross";
  /** 画法方向的可见端点（卡片 id）；箭头指向 to */
  from: string;
  to: string;
  code: RelCode;
  implicit: boolean;
  /** ×N */
  count: number;
  /** 原数据关系（数据方向；intra 的 implicit 边为空） */
  orig: RelRef[];
  /** 端点挂在组框上 */
  fromFrame: boolean;
  toFrame: boolean;
  hot: boolean;
  visible: boolean;
  opacity: number;
  /** SVG path d；未计算几何时为 null */
  d: string | null;
  /** 路径段（sampleEdge 由此密采样） */
  segs: PathSeg[];
  /** 通道路由时的正交折线（圆角前，已分道）；直连为 null */
  poly: P2[] | null;
  /** 几何来源；blocked＝三种方法都失败、退回直连（理论上不应出现；测试守护） */
  how: RouteHow | null;
  label: RoutedLabel | null;
}

export interface RouteStats {
  intra: number;
  cross: number;
  /** 合并前的跨组原关系数 */
  crossRaw: number;
  routed: number;
  direct: number;
  channel: number;
  search: number;
  blocked: number;
}

export interface RouteResult {
  edges: RoutedEdge[];
  byId: Record<string, RoutedEdge>;
  /** 可见卡片 id → 跨组关系条数（↗N；按原关系计） */
  crossCount: Record<string, number>;
  /** 关系透视集合（自身 + 对端 + 祖先链，含 ROOT_ID）；未开透视为 null */
  focus: Set<string> | null;
  policy: { relAll: boolean; hovered: string | null; selected: string | null; focus: boolean; zoom: number };
  stats: RouteStats;
}

// ───────────────────────── 障碍索引 ─────────────────────────

interface Obs {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  /** frame：所属组；card：自身 */
  nid: string;
  frame: boolean;
}

interface Ends {
  /** 不作为障碍的卡片 */
  skipA: string;
  skipB: string;
  /** 不作为障碍的组框（包含任一端点） */
  allowed: ReadonlySet<string>;
}

const RB = 64;
/** 桶登记外扩：查询外扩 m 须 ≤ 此值 */
const PADI = 8;

interface Bucket {
  list: Obs[];
  /** list 内障碍沿排序轴的最大长度（二分起点） */
  ext: number;
}

const idCmp = (a: Obs, b: Obs) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const skips = (o: Obs, en: Ends) => (o.frame ? en.allowed.has(o.nid) : o.id === en.skipA || o.id === en.skipB);

/** 行桶（按 y 分桶、桶内按 x 排序）+ 列桶（按 x 分桶、桶内按 y 排序）；轴对齐矩形查询 O(log n + k) */
class ObsIndex {
  readonly all: Obs[];
  readonly byX: Obs[];
  private rows = new Map<number, Bucket>();
  private cols = new Map<number, Bucket>();
  private tr: ObsIndex | null = null;
  constructor(list: Obs[]) {
    this.all = list;
    const push = (m: Map<number, Bucket>, k: number, o: Obs, ext: number) => {
      const b = m.get(k);
      if (b) {
        b.list.push(o);
        if (ext > b.ext) b.ext = ext;
      } else m.set(k, { list: [o], ext });
    };
    for (const o of list) {
      for (let j = Math.floor((o.y - PADI) / RB); j <= Math.floor((o.y + o.h + PADI) / RB); j++) push(this.rows, j, o, o.w);
      for (let i = Math.floor((o.x - PADI) / RB); i <= Math.floor((o.x + o.w + PADI) / RB); i++) push(this.cols, i, o, o.h);
    }
    for (const b of this.rows.values()) b.list.sort((a, c) => a.x - c.x || idCmp(a, c));
    for (const b of this.cols.values()) b.list.sort((a, c) => a.y - c.y || idCmp(a, c));
    this.byX = list.slice().sort((a, c) => a.x - c.x || idCmp(a, c));
  }
  /** 转置（x↔y）：横向通道复用竖向通道的代码 */
  transposed(): ObsIndex {
    if (!this.tr) {
      this.tr = new ObsIndex(this.all.map((o) => ({ ...o, x: o.y, y: o.x, w: o.h, h: o.w })));
      this.tr.tr = this;
    }
    return this.tr;
  }
  /** 矩形 [x0,x1]×[y0,y1] 外扩 m（开区间）是否碰到障碍；en=null：只看卡片且不排除任何卡片 */
  hit(x0: number, y0: number, x1: number, y1: number, m: number, en: Ends | null): boolean {
    const horiz = x1 - x0 >= y1 - y0;
    const map = horiz ? this.rows : this.cols;
    const k0 = Math.floor((horiz ? y0 : x0) / RB), k1 = Math.floor((horiz ? y1 : x1) / RB);
    const lo = horiz ? x0 : y0, hi = horiz ? x1 : y1;
    for (let k = k0; k <= k1; k++) {
      const b = map.get(k);
      if (!b) continue;
      const L = b.list;
      const from = lo - m - b.ext;
      let a = 0, z = L.length;
      while (a < z) {
        const mid = (a + z) >> 1;
        if ((horiz ? L[mid].x : L[mid].y) < from) a = mid + 1;
        else z = mid;
      }
      for (let i = a; i < L.length; i++) {
        const o = L[i];
        if ((horiz ? o.x : o.y) - m >= hi) break;
        if (x1 <= o.x - m || x0 >= o.x + o.w + m || y1 <= o.y - m || y0 >= o.y + o.h + m) continue;
        if (en === null) {
          if (!o.frame) return true;
          continue;
        }
        if (skips(o, en)) continue;
        return true;
      }
    }
    return false;
  }
  /** 从 (x,y) 向 +x 的射线：第一个障碍外扩边界的 x；起点即被挡返回 x；无障碍 +∞ */
  rayPos(x: number, y: number, m: number, en: Ends): number {
    const b = this.rows.get(Math.floor(y / RB));
    if (!b) return Infinity;
    let best = Infinity;
    for (const o of b.list) {
      if (o.x - m >= best) break;
      if (o.x + o.w + m <= x) continue;
      if (y <= o.y - m || y >= o.y + o.h + m || skips(o, en)) continue;
      if (o.x - m <= x) return x;
      best = o.x - m;
    }
    return best;
  }
  /** 向 −x 的射线 */
  rayNeg(x: number, y: number, m: number, en: Ends): number {
    const b = this.rows.get(Math.floor(y / RB));
    if (!b) return -Infinity;
    let best = -Infinity;
    for (const o of b.list) {
      if (o.x - m >= x) break;
      if (y <= o.y - m || y >= o.y + o.h + m || skips(o, en)) continue;
      const r = o.x + o.w + m;
      if (r >= x) return x;
      if (r > best) best = r;
    }
    return best;
  }
  /** 竖直通道：y∈[y0,y1] 整段都无障碍（净空 c）的 x 开区间（两端可为 ±∞），升序 */
  gapsX(y0: number, y1: number, c: number, en: Ends): [number, number][] {
    const out: [number, number][] = [];
    let cur = -Infinity;
    for (const o of this.byX) {
      if (y1 <= o.y - c || y0 >= o.y + o.h + c || skips(o, en)) continue;
      const a = o.x - c, b = o.x + o.w + c;
      if (a > cur) out.push([cur, a]);
      if (b > cur) cur = b;
    }
    out.push([cur, Infinity]);
    return out;
  }
}

const segHit = (I: ObsIndex, a: P2, b: P2, m: number, en: Ends | null) =>
  I.hit(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), m, en);

/** 贝塞尔碰撞：控制多边形包围盒无碰撞即整段无碰撞，否则二分细分，到 ≤1px 仍碰判定碰撞（保守、确定） */
function curveHit(I: ObsIndex, pts: P2[], m: number, en: Ends, depth = 0): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  if (!I.hit(x0, y0, x1, y1, m, en)) return false;
  if ((x1 - x0 <= 1 && y1 - y0 <= 1) || depth > 20) return true;
  const [l, r] = splitBezier(pts);
  return curveHit(I, l, m, en, depth + 1) || curveHit(I, r, m, en, depth + 1);
}

function splitBezier(p: P2[]): [P2[], P2[]] {
  const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (p.length === 3) {
    const a = mid(p[0], p[1]), b = mid(p[1], p[2]), c = mid(a, b);
    return [[p[0], a, c], [c, b, p[2]]];
  }
  const a = mid(p[0], p[1]), b = mid(p[1], p[2]), c = mid(p[2], p[3]);
  const d = mid(a, b), e = mid(b, c), f = mid(d, e);
  return [[p[0], a, d, f], [f, e, c, p[3]]];
}

function segsHit(I: ObsIndex, segs: readonly PathSeg[], m: number, en: Ends): boolean {
  for (const s of segs) {
    if (s.k === "L" ? segHit(I, s.a, s.b, m, en) : curveHit(I, s.k === "C" ? [s.a, s.c0, s.c1, s.b] : [s.a, s.c, s.b], m, en)) return true;
  }
  return false;
}

// ───────────────────────── 路径工具 ─────────────────────────

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (p: P2) => `${r1(p[0])},${r1(p[1])}`;

export function pathD(segs: readonly PathSeg[]): string {
  if (!segs.length) return "";
  let d = `M${fmt(segs[0].a)}`;
  for (const s of segs) {
    if (s.k === "L") d += `L${fmt(s.b)}`;
    else if (s.k === "C") d += `C${fmt(s.c0)} ${fmt(s.c1)} ${fmt(s.b)}`;
    else d += `Q${fmt(s.c)} ${fmt(s.b)}`;
  }
  return d;
}

function evalSeg(s: PathSeg, u: number): P2 {
  const v = 1 - u;
  if (s.k === "L") return [s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u];
  if (s.k === "Q") return [v * v * s.a[0] + 2 * v * u * s.c[0] + u * u * s.b[0], v * v * s.a[1] + 2 * v * u * s.c[1] + u * u * s.b[1]];
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [a * s.a[0] + b * s.c0[0] + c * s.c1[0] + d * s.b[0], a * s.a[1] + b * s.c0[1] + c * s.c1[1] + d * s.b[1]];
}

function segLen(s: PathSeg): number {
  if (s.k === "L") return Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  let L = 0;
  let prev = s.a;
  for (let i = 1; i <= 16; i++) {
    const p = evalSeg(s, i / 16);
    L += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return L;
}

/** 沿路径密采样（含两端），相邻点距离 ≤ step（曲线细分数按估计弧长 ×1.5 保守取） */
export function sampleEdge(e: { segs: readonly PathSeg[] }, step: number = ROUTE.STEP): P2[] {
  const out: P2[] = [];
  for (const s of e.segs) {
    if (!out.length) out.push(s.a);
    const n = Math.max(1, Math.ceil((segLen(s) * (s.k === "L" ? 1 : 1.5)) / step));
    for (let i = 1; i <= n; i++) out.push(evalSeg(s, i / n));
  }
  return out;
}

/** 正交折线 → 路径段（转角圆化为二次贝塞尔；圆弧落在两条邻段外扩矩形的并内） */
function polySegs(poly: readonly P2[], radius: number): PathSeg[] {
  const segs: PathSeg[] = [];
  let cur = poly[0];
  for (let i = 1; i < poly.length - 1; i++) {
    const p = poly[i], prev = poly[i - 1], nx = poly[i + 1];
    const l1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const l2 = Math.hypot(nx[0] - p[0], nx[1] - p[1]);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      if (p[0] !== cur[0] || p[1] !== cur[1]) segs.push({ k: "L", a: cur, b: p });
      cur = p;
      continue;
    }
    const a: P2 = [p[0] - ((p[0] - prev[0]) / l1) * r, p[1] - ((p[1] - prev[1]) / l1) * r];
    const b: P2 = [p[0] + ((nx[0] - p[0]) / l2) * r, p[1] + ((nx[1] - p[1]) / l2) * r];
    if (a[0] !== cur[0] || a[1] !== cur[1]) segs.push({ k: "L", a: cur, b: a });
    segs.push({ k: "Q", a, c: p, b });
    cur = b;
  }
  segs.push({ k: "L", a: cur, b: poly[poly.length - 1] });
  return segs;
}

function simplify(poly: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of poly) {
    const n = out.length;
    if (n && out[n - 1][0] === p[0] && out[n - 1][1] === p[1]) continue;
    if (n >= 2) {
      const a = out[n - 2], b = out[n - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
        out[n - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

const tp = (p: P2): P2 => [p[1], p[0]];

// ───────────────────────── 端口与占用 ─────────────────────────

type Side = "T" | "B" | "L" | "R";

interface EndRect extends Rect {
  /** 端口错开计数用的键（卡片或框的元素 id） */
  key: string;
  /** 端点挂框时为该组 id */
  frameOf: string | null;
}

/** 分道占用：轴（0 水平段，坐标为 y；1 竖直段，坐标为 x）+ 8px 坐标桶 */
class Lanes {
  private m = new Map<number, { c: number; lo: number; hi: number; e: string }[]>();
  free(axis: 0 | 1, c: number, lo: number, hi: number, self: string): boolean {
    const b = Math.floor(c / 8);
    for (let k = b - 1; k <= b + 1; k++) {
      const l = this.m.get(k * 2 + axis);
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const s = l[i];
        if (s.e === self || Math.abs(s.c - c) >= ROUTE.LANE) continue;
        if (Math.min(hi, s.hi) - Math.max(lo, s.lo) <= 0) continue;
        return false;
      }
    }
    return true;
  }
  add(axis: 0 | 1, c: number, lo: number, hi: number, e: string) {
    const k = Math.floor(c / 8) * 2 + axis;
    const l = this.m.get(k);
    const s = { c, lo, hi, e };
    if (l) l.push(s);
    else this.m.set(k, [s]);
  }
  usage(axis: 0 | 1, c: number): number {
    const l = this.m.get(Math.floor(c / 8) * 2 + axis);
    return l ? l.length : 0;
  }
}

interface Router {
  idx: ObsIndex;
  bounds: { w: number; h: number };
  ports: Map<string, number>;
  lanes: Lanes;
}

/** 端口沿边的位置（0, +12, −12, +24, …；离角 ≥8px） */
function portCoord(R: Router, r: EndRect, side: Side): number {
  const nth = R.ports.get(r.key + "|" + side) ?? 0;
  const off = nth === 0 ? 0 : (nth % 2 ? 1 : -1) * Math.ceil(nth / 2) * ROUTE.PORT_STEP;
  const horiz = side === "T" || side === "B";
  const lo = horiz ? r.x : r.y;
  const len = horiz ? r.w : r.h;
  const inset = Math.min(8, len / 2);
  return Math.round(Math.max(lo + inset, Math.min(lo + len - inset, lo + len / 2 + off)));
}
const claimPort = (R: Router, r: EndRect, side: Side) => {
  const k = r.key + "|" + side;
  R.ports.set(k, (R.ports.get(k) ?? 0) + 1);
};

/** 通道段用的严格判定：端点卡片与端点所挂的框也是障碍 */
function strictEnds(en: Ends, A: EndRect, B: EndRect): Ends {
  const allowed = new Set(en.allowed);
  if (A.frameOf) allowed.delete(A.frameOf);
  if (B.frameOf) allowed.delete(B.frameOf);
  return { skipA: "", skipB: "", allowed };
}

/** 折线复核：首末段（贴端点）用宽松判定，中间段用严格判定 */
function polyHit(I: ObsIndex, poly: readonly P2[], en: Ends, strict: Ends): boolean {
  const n = poly.length;
  for (let i = 0; i < n - 1; i++) {
    const edge = i === 0 || i === n - 2;
    if (segHit(I, poly[i], poly[i + 1], ROUTE.MARGIN, edge ? en : strict)) return true;
  }
  return false;
}

// ───────────────────────── 1) 直连曲线 ─────────────────────────

function directCurve(R: Router, a: EndRect, b: EndRect, vertical: boolean, tf: number | undefined): { segs: PathSeg[]; claims: [EndRect, Side][] } {
  const ac: P2 = [a.x + a.w / 2, a.y + a.h / 2], bc: P2 = [b.x + b.w / 2, b.y + b.h / 2];
  if (vertical) {
    const down = bc[1] > ac[1];
    const sa: Side = down ? "B" : "T", sb: Side = down ? "T" : "B";
    const s: P2 = [portCoord(R, a, sa), down ? a.y + a.h : a.y];
    const t: P2 = [tf != null ? b.x + b.w * tf : portCoord(R, b, sb), down ? b.y : b.y + b.h];
    const k = Math.max(24, Math.abs(t[1] - s[1]) / 2) * (down ? 1 : -1);
    return { segs: [{ k: "C", a: s, c0: [s[0], s[1] + k], c1: [t[0], t[1] - k], b: t }], claims: [[a, sa], [b, sb]] };
  }
  const right = bc[0] > ac[0];
  const sa: Side = right ? "R" : "L", sb: Side = right ? "L" : "R";
  const s: P2 = [right ? a.x + a.w : a.x, portCoord(R, a, sa)];
  const t: P2 = [right ? b.x : b.x + b.w, portCoord(R, b, sb)];
  const k = Math.max(32, Math.min(160, Math.abs(t[0] - s[0]) / 2)) * (right ? 1 : -1);
  return { segs: [{ k: "C", a: s, c0: [s[0] + k, s[1]], c1: [t[0] - k, t[1]], b: t }], claims: [[a, sa], [b, sb]] };
}

// ───────────────────────── 2) 侧边通道 ─────────────────────────

/** 逃逸：从端口出发到达水平线 y，在 (lo,hi) 内可自由水平移动（工作坐标系：通道竖直） */
interface Esc {
  y: number;
  lo: number;
  hi: number;
  /** 水平移动的起点 x */
  x0: number;
  /** 端口 → (x0,y) 的折线（工作坐标） */
  pre: P2[];
  /** 真实坐标系下的端口侧 */
  side: Side;
  cost: number;
  /** 上下逃逸：水平线可在 [ylo, yhi] 内平移（分道用）；左右逃逸为 null */
  slide: [number, number] | null;
}

/** 工作坐标系（t=true 时 x↔y 转置）下，端点的全部逃逸；rw＝工作坐标下的端点矩形 */
function escapes(R: Router, I: ObsIndex, r: EndRect, rw: Rect, t: boolean, en: Ends): Esc[] {
  const C = ROUTE.CLEAR, M = ROUTE.MARGIN;
  const out: Esc[] = [];
  const real: Record<Side, Side> = t ? { R: "B", L: "T", B: "R", T: "L" } : { R: "R", L: "L", B: "B", T: "T" };
  const pc = (s: Side) => portCoord(R, r, real[s]);
  for (const s of ["R", "L"] as Side[]) {
    const py = pc(s);
    const px = s === "R" ? rw.x + rw.w : rw.x;
    const qx = s === "R" ? px + C : px - C;
    if (I.hit(qx, py, qx, py, M, en)) continue;
    if (s === "R") {
      const hi = I.rayPos(qx, py, M, en);
      if (hi > qx) out.push({ y: py, lo: qx, hi, x0: px, pre: [[px, py]], side: real[s], cost: 0, slide: null });
    } else {
      const lo = I.rayNeg(qx, py, M, en);
      if (lo < qx) out.push({ y: py, lo, hi: qx, x0: px, pre: [[px, py]], side: real[s], cost: 0, slide: null });
    }
  }
  const It = I.transposed();
  for (const s of ["B", "T"] as Side[]) {
    const px = pc(s);
    const py = s === "B" ? rw.y + rw.h : rw.y;
    const qy = s === "B" ? py + C : py - C;
    if (I.hit(px, qy, px, qy, M, en)) continue;
    const lim = s === "B" ? It.rayPos(qy, px, M, en) : It.rayNeg(qy, px, M, en);
    // 竖直外伸可达范围（离下一个障碍保留 M+1）
    const far = Number.isFinite(lim) ? (s === "B" ? lim - 1 : lim + 1) : s === "B" ? qy + 64 : qy - 64;
    const levels = [qy];
    if (Math.abs(far - qy) > 2 * C) levels.push(Math.round((qy + far) / 2));
    for (const y of levels) {
      const lo = I.rayNeg(px, y, M, en), hi = I.rayPos(px, y, M, en);
      if (!(lo < px && hi > px)) continue;
      const slide: [number, number] = s === "B" ? [qy, far] : [far, qy];
      if (slide[0] > slide[1]) continue;
      out.push({ y, lo, hi, x0: px, pre: [[px, py], [px, y]], side: real[s], cost: Math.abs(y - py) + 8, slide });
    }
  }
  return out;
}

type Routed = { poly: P2[]; sa: Side; sb: Side };

function channelOriented(R: Router, A: EndRect, B: EndRect, en: Ends, strict: Ends, t: boolean, eid: string): Routed | null {
  const I = t ? R.idx.transposed() : R.idx;
  const aw: Rect = t ? { x: A.y, y: A.x, w: A.h, h: A.w } : A;
  const bw: Rect = t ? { x: B.y, y: B.x, w: B.h, h: B.w } : B;
  const ea = escapes(R, I, A, aw, t, strict);
  const eb = escapes(R, I, B, bw, t, strict);
  if (!ea.length || !eb.length) return null;
  let y0 = Infinity, y1 = -Infinity;
  for (const e of ea.concat(eb)) {
    if (e.y < y0) y0 = e.y;
    if (e.y > y1) y1 = e.y;
  }
  const gaps = I.gapsX(y0, y1, ROUTE.CLEAR, strict);
  interface Cand { cost: number; ord: number; a: Esc; b: Esc; lo: number; hi: number; u: number }
  const cands: Cand[] = [];
  let ord = 0;
  for (const a of ea)
    for (const b of eb) {
      const lo0 = Math.max(a.lo, b.lo), hi0 = Math.min(a.hi, b.hi);
      if (lo0 >= hi0) continue;
      const mid = (a.x0 + b.x0) / 2;
      // 只取离 mid 最近的若干空隙（二分定位，两侧各 GAP_NEAR 个）
      let gi = 0, gz = gaps.length;
      while (gi < gz) {
        const m = (gi + gz) >> 1;
        if (gaps[m][1] < mid) gi = m + 1;
        else gz = m;
      }
      const g0 = Math.max(0, gi - ROUTE.GAP_NEAR), g1 = Math.min(gaps.length - 1, gi + ROUTE.GAP_NEAR);
      // 两端可达范围之外的空隙再补首尾各一个（外侧无界空隙容量大）
      const pick: number[] = [];
      for (let k = g0; k <= g1; k++) pick.push(k);
      if (g0 > 0) pick.push(0);
      if (g1 < gaps.length - 1) pick.push(gaps.length - 1);
      for (const gk of pick) {
        const g = gaps[gk];
        const lo = Math.max(lo0, g[0]), hi = Math.min(hi0, g[1]);
        if (!(lo < hi)) continue;
        const ilo = Math.floor(lo) + 1, ihi = Math.ceil(hi) - 1;
        if (ilo > ihi) continue;
        const u = Math.round(Math.max(ilo, Math.min(ihi, mid)));
        const cost = Math.abs(u - a.x0) + Math.abs(u - b.x0) + Math.abs(a.y - b.y) + a.cost + b.cost;
        cands.push({ cost, ord: ord++, a, b, lo: ilo, hi: ihi, u });
      }
    }
  cands.sort((p, q) => p.cost - q.cost || p.ord - q.ord);
  const axisV: 0 | 1 = t ? 0 : 1;
  for (let i = 0; i < cands.length && i < ROUTE.MAX_CANDS; i++) {
    const c = cands[i];
    const vlo = Math.min(c.a.y, c.b.y), vhi = Math.max(c.a.y, c.b.y);
    let u: number | null = null;
    for (let k = 0; k <= ROUTE.MAX_LANE_STEPS; k++) {
      const up = c.u + k * ROUTE.LANE, dn = c.u - k * ROUTE.LANE;
      if (up > c.hi && dn < c.lo) break;
      if (up <= c.hi && (vhi - vlo < 1 || R.lanes.free(axisV, up, vlo, vhi, eid))) {
        u = up;
        break;
      }
      if (k && dn >= c.lo && R.lanes.free(axisV, dn, vlo, vhi, eid)) {
        u = dn;
        break;
      }
    }
    if (u == null) continue;
    const uu = u;
    // 上下逃逸的水平线若与他边同道，在可平移范围内另找一道（重算射线确认可达 u）
    const variants = (e: Esc): { y: number; pre: P2[] }[] => {
      const out: { y: number; pre: P2[] }[] = [{ y: e.y, pre: e.pre }];
      if (!e.slide) return out;
      for (let k = 1; k <= ROUTE.SLIDE_STEPS; k++) {
        for (const y of [e.y + k * ROUTE.LANE, e.y - k * ROUTE.LANE]) {
          if (y < e.slide[0] || y > e.slide[1]) continue;
          const a = Math.min(e.x0, uu), b = Math.max(e.x0, uu);
          if (I.rayNeg(e.x0, y, ROUTE.MARGIN, strict) >= a && a < e.x0) continue;
          if (I.rayPos(e.x0, y, ROUTE.MARGIN, strict) <= b && b > e.x0) continue;
          out.push({ y, pre: [e.pre[0], [e.x0, y]] });
        }
      }
      return out;
    };
    const va = variants(c.a), vb = variants(c.b);
    for (const a of va)
      for (const b of vb) {
        const pw: P2[] = [...a.pre, [uu, a.y], [uu, b.y], ...b.pre.slice().reverse()];
        const poly = simplify(t ? pw.map(tp) : pw);
        if (poly.length < 2 || !lanesFree(R.lanes, poly, eid) || polyHit(R.idx, poly, en, strict)) continue;
        return { poly, sa: c.a.side, sb: c.b.side };
      }
  }
  return null;
}

// ───────────────────────── 3) 压缩栅格 A*（兜底） ─────────────────────────

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const SIDE_DIR: Record<Side, number> = { R: 0, B: 1, L: 2, T: 3 };
const SIDES: Side[] = ["R", "B", "L", "T"];

/** 堆（f 小优先；同 f 按插入序，保证确定性） */
class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  private sq: number[] = [];
  private n = 0;
  get size() {
    return this.ids.length;
  }
  private less(i: number, j: number) {
    return this.fs[i] < this.fs[j] || (this.fs[i] === this.fs[j] && this.sq[i] < this.sq[j]);
  }
  private swap(i: number, j: number) {
    const a = this.ids, f = this.fs, s = this.sq;
    [a[i], a[j]] = [a[j], a[i]];
    [f[i], f[j]] = [f[j], f[i]];
    [s[i], s[j]] = [s[j], s[i]];
  }
  push(id: number, f: number) {
    let i = this.ids.length;
    this.ids.push(id);
    this.fs.push(f);
    this.sq.push(this.n++);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    this.swap(0, this.ids.length - 1);
    this.ids.pop();
    this.fs.pop();
    this.sq.pop();
    let i = 0;
    const n = this.ids.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

function axisCoords(vals: number[]): { cs: number[]; mid: Uint8Array } {
  const v = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const u: number[] = [];
  for (const x of v) if (!u.length || x - u[u.length - 1] > 0.5) u.push(x);
  const cs: number[] = [];
  const flags: number[] = [];
  for (let i = 0; i < u.length; i++) {
    cs.push(u[i]);
    flags.push(0);
    if (i + 1 < u.length && u[i + 1] - u[i] >= 4 * ROUTE.LANE) {
      cs.push(Math.round((u[i] + u[i + 1]) / 2));
      flags.push(1);
    }
  }
  return { cs, mid: Uint8Array.from(flags) };
}

interface Port {
  p: P2;
  q: P2;
  side: Side;
}

function astar(R: Router, A: EndRect, B: EndRect, strict: Ends, pad: number, eid: string): Routed | null {
  const C = ROUTE.CLEAR, M = ROUTE.MARGIN;
  const I = R.idx;
  const portOf = (r: EndRect, s: Side): Port | null => {
    const c = portCoord(R, r, s);
    let p: P2, q: P2;
    if (s === "R") { p = [r.x + r.w, c]; q = [r.x + r.w + C, c]; }
    else if (s === "L") { p = [r.x, c]; q = [r.x - C, c]; }
    else if (s === "B") { p = [c, r.y + r.h]; q = [c, r.y + r.h + C]; }
    else { p = [c, r.y]; q = [c, r.y - C]; }
    return I.hit(q[0], q[1], q[0], q[1], M, strict) ? null : { p, q, side: s };
  };
  const srcs: Port[] = [];
  const dsts: Port[] = [];
  for (const s of SIDES) {
    const a = portOf(A, s);
    if (a) srcs.push(a);
    const b = portOf(B, s);
    if (b) dsts.push(b);
  }
  if (!srcs.length || !dsts.length) return null;
  const xsRaw: number[] = [-128, R.bounds.w + 128], ysRaw: number[] = [-128, R.bounds.h + 128];
  for (const r of [A, B]) {
    for (const o of I.all) {
      if (o.x > r.x + r.w + pad || o.x + o.w < r.x - pad || o.y > r.y + r.h + pad || o.y + o.h < r.y - pad) continue;
      xsRaw.push(o.x - C, o.x + o.w + C);
      ysRaw.push(o.y - C, o.y + o.h + C);
    }
  }
  const ya0 = Math.min(A.y, B.y), ya1 = Math.max(A.y + A.h, B.y + B.h);
  const xa0 = Math.min(A.x, B.x), xa1 = Math.max(A.x + A.w, B.x + B.w);
  for (const g of I.gapsX(ya0, ya1, C, strict)) xsRaw.push(g[0], g[1], (g[0] + g[1]) / 2);
  for (const g of I.transposed().gapsX(xa0, xa1, C, strict)) ysRaw.push(g[0], g[1], (g[0] + g[1]) / 2);
  for (const p of [...srcs, ...dsts]) {
    xsRaw.push(p.q[0]);
    ysRaw.push(p.q[1]);
  }
  // 已占用的通道线旁补充分道线（±4k），使搜索结果同样满足 4px 分道
  const addLanes = (raw: number[], axis: 0 | 1) => {
    const n = raw.length;
    for (let i = 0; i < n; i++) {
      const c = raw[i];
      if (!Number.isFinite(c)) continue;
      const u = R.lanes.usage(axis, c);
      for (let k = 1; k <= Math.min(u + 1, 16) && u > 0; k++) raw.push(c + k * ROUTE.LANE, c - k * ROUTE.LANE);
    }
  };
  addLanes(xsRaw, 1);
  addLanes(ysRaw, 0);
  const X = axisCoords(xsRaw), Y = axisCoords(ysRaw);
  const xs = X.cs, ys = Y.cs;
  const cols = xs.length, rows = ys.length;
  const find = (arr: number[], v: number) => {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (Math.abs(arr[m] - v) <= 0.5) return m;
      if (arr[m] < v) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  };
  const free = new Map<number, boolean>();
  const isFree = (c: number): boolean => {
    let v = free.get(c);
    if (v === undefined) {
      const x = xs[c % cols], y = ys[(c / cols) | 0];
      v = !I.hit(x, y, x, y, M, strict);
      free.set(c, v);
    }
    return v;
  };
  const segOk = new Map<number, boolean>();
  const segFree = (c: number, d: number): boolean => {
    const horiz = d === 0 || d === 2;
    const a = d === 2 ? c - 1 : d === 3 ? c - cols : c;
    const k = a * 2 + (horiz ? 0 : 1);
    let v = segOk.get(k);
    if (v === undefined) {
      const i = a % cols, j = (a / cols) | 0;
      v =
        !segHit(I, [xs[i], ys[j]], horiz ? [xs[i + 1], ys[j]] : [xs[i], ys[j + 1]], M, strict) &&
        (horiz ? R.lanes.free(0, ys[j], xs[i], xs[i + 1], eid) : R.lanes.free(1, xs[i], ys[j], ys[j + 1], eid));
      segOk.set(k, v);
    }
    return v;
  };
  const goal = new Map<number, Port>();
  for (const d of dsts) {
    const i = find(xs, d.q[0]), j = find(ys, d.q[1]);
    if (i >= 0 && j >= 0 && !goal.has(j * cols + i)) goal.set(j * cols + i, d);
  }
  if (!goal.size) return null;
  const G = 8;
  const tx = B.x + B.w / 2, ty = B.y + B.h / 2;
  const hOf = (c: number) => (ROUTE.WEIGHT * (Math.abs(xs[c % cols] - tx) + Math.abs(ys[(c / cols) | 0] - ty))) / G;
  const share = (u: number) => Math.min(ROUTE.SHARE_MAX, u * ROUTE.SHARE);
  const colCost = xs.map((x, i) => 1 + share(R.lanes.usage(1, x)) + (X.mid[i] ? 0 : 0.1));
  const rowCost = ys.map((y, j) => 1 + share(R.lanes.usage(0, y)) + (Y.mid[j] ? 0 : 0.1));
  const gScore = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new Heap();
  srcs.forEach((s, si) => {
    const i = find(xs, s.q[0]), j = find(ys, s.q[1]);
    if (i < 0 || j < 0) return;
    const c = j * cols + i;
    if (!isFree(c)) return;
    const st = c * 4 + SIDE_DIR[s.side];
    gScore.set(st, 1);
    parent.set(st, -2 - si);
    heap.push(st, 1 + hOf(c));
  });
  let expand = 0;
  let found = -1;
  while (heap.size) {
    const st = heap.pop();
    if (closed.has(st)) continue;
    closed.add(st);
    const c = st >> 2, dir = st & 3;
    if (goal.has(c)) {
      found = st;
      break;
    }
    if (++expand > ROUTE.MAX_EXPAND) return null;
    const ci = c % cols, cj = (c - ci) / cols;
    const gc = gScore.get(st) as number;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((dir + 2) & 3)) continue;
      const ni = ci + DX[nd], nj = cj + DY[nd];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nc = nj * cols + ni;
      if (!isFree(nc) || !segFree(c, nd)) continue;
      const len = nd & 1 ? Math.abs(ys[nj] - ys[cj]) : Math.abs(xs[ni] - xs[ci]);
      const ng = gc + (len / G) * (nd & 1 ? colCost[ci] : rowCost[cj]) + (nd !== dir ? ROUTE.TURN : 0);
      const ns = nc * 4 + nd;
      if (ng < (gScore.get(ns) ?? Infinity)) {
        gScore.set(ns, ng);
        parent.set(ns, st);
        heap.push(ns, ng + hOf(nc));
      }
    }
  }
  if (found < 0) return null;
  const chain: number[] = [];
  let st = found;
  let src: Port;
  for (;;) {
    chain.push(st);
    const p = parent.get(st) as number;
    if (p <= -2) {
      src = srcs[-2 - p];
      break;
    }
    st = p;
  }
  chain.reverse();
  const dst = goal.get(found >> 2) as Port;
  const poly: P2[] = [src.p];
  for (const s of chain) {
    const c = s >> 2;
    poly.push([xs[c % cols], ys[(c / cols) | 0]]);
  }
  poly.push(dst.p);
  return { poly: simplify(poly), sa: src.side, sb: dst.side };
}

// ───────────────────────── 主入口 ─────────────────────────

/** 节点 id 的父：已到达取 parentId（顶层 → ROOT_ID）；未到达按路径式 id 推断（X6） */
function parentGuess(state: GraphState, id: string): string | null {
  if (id === ROOT_ID) return null;
  const n = state.nodes[id];
  if (n) return n.parentId ?? ROOT_ID;
  const i = id.lastIndexOf(".");
  return i > 0 ? id.slice(0, i) : null;
}

export function routeRelations(state: GraphState, display: Display, policy: RelPolicy = {}): RouteResult {
  const relAll = !!policy.relAll;
  const hovered = policy.hovered ?? null;
  const selected = policy.selected ?? null;
  const focusOn = !!policy.focus && !!selected;
  const zoom = policy.zoom ?? 1;
  const allGeom = policy.geometry === "all";
  const relName = policy.relName ?? ((c: RelCode) => REL_STYLE[c].name);
  const lod = new Set(policy.lodCollapsed ?? []);
  const byId = display.byId;

  // 端点提升
  const repMemo = new Map<string, string | null>();
  const rep = (id: string): string | null => {
    const m = repMemo.get(id);
    if (m !== undefined) return m;
    let x: string | null = id;
    let guard = 0;
    while (x && guard++ < 4096) {
      const it: DisplayItem | undefined = byId[x];
      if (it && it.kind === "card") break;
      x = parentGuess(state, x);
    }
    if (x && lod.size) {
      // 收进摘要卡：提升到最外层收起组
      const chain = frameChain(display, x);
      for (let i = chain.length - 1; i >= 0; i--) {
        if (lod.has(chain[i]) && chain[i] !== x) {
          x = chain[i];
          break;
        }
      }
    }
    const out = x && byId[x] && byId[x].kind === "card" ? x : null;
    repMemo.set(id, out);
    return out;
  };
  const lodHiddenCard = (id: string): boolean => {
    if (!lod.size) return false;
    const chain = frameChain(display, id);
    return chain.some((g) => lod.has(g) && g !== id);
  };

  // 框链（包含端点的组框）
  const chainMemo = new Map<string, string[]>();
  const chainOf = (id: string) => {
    let c = chainMemo.get(id);
    if (!c) {
      c = frameChain(display, id);
      chainMemo.set(id, c);
    }
    return c;
  };
  const hasFrame = (id: string) => !!byId["F:" + id];

  // 收集边
  interface Pending {
    id: string;
    kind: "intra" | "cross";
    from: string;
    to: string;
    code: RelCode;
    implicit: boolean;
    orig: RelRef[];
    tf?: number;
  }
  const pending: Pending[] = [];
  let intraN = 0;
  for (const e of display.edges) {
    if (e.kind !== "rel" || !e.code) continue;
    if (!byId[e.from] || !byId[e.to]) continue;
    if (lodHiddenCard(e.from) || lodHiddenCard(e.to)) continue;
    const orig: RelRef[] = e.implicit ? [] : [e.code === "据" ? { from: e.to, to: e.from, code: e.code } : { from: e.from, to: e.to, code: e.code }];
    const p: Pending = { id: `i:${e.group}:${e.from}>${e.to}:${e.code}${e.implicit ? ":imp" : ""}`, kind: "intra", from: e.from, to: e.to, code: e.code, implicit: !!e.implicit, orig };
    if (e.tf != null) p.tf = e.tf;
    pending.push(p);
    intraN++;
  }
  const consumed = new Set(display.consumed);
  const merged = new Map<string, Pending>();
  let crossRaw = 0;
  const outKeys = Object.keys(state.outEdges).sort();
  for (const k of outKeys) {
    for (const e of state.outEdges[k] ?? []) {
      if (consumed.has(e.from + "|" + e.to + "|" + e.code)) continue;
      const a = rep(e.from), b = rep(e.to);
      if (!a || !b || a === b) continue;
      const [df, dt] = e.code === "据" ? [b, a] : [a, b];
      const key = `x:${df}>${dt}:${e.code}`;
      crossRaw++;
      const m = merged.get(key);
      if (m) m.orig.push({ from: e.from, to: e.to, code: e.code });
      else merged.set(key, { id: key, kind: "cross", from: df, to: dt, code: e.code, implicit: false, orig: [{ from: e.from, to: e.to, code: e.code }] });
    }
  }
  const crossList = [...merged.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  pending.push(...crossList);

  // ↗N
  const crossCount: Record<string, number> = {};
  for (const c of crossList) {
    crossCount[c.from] = (crossCount[c.from] ?? 0) + c.orig.length;
    crossCount[c.to] = (crossCount[c.to] ?? 0) + c.orig.length;
  }

  // 显示策略
  const touches = (p: Pending, x: string | null) => !!x && (p.from === x || p.to === x || p.orig.some((o) => o.from === x || o.to === x));
  const isHot = (p: Pending) => touches(p, hovered) || touches(p, selected);
  let focus: Set<string> | null = null;
  if (focusOn && selected) {
    focus = new Set([selected, ROOT_ID]);
    for (let a = parentGuess(state, selected), g = 0; a && g < 4096; a = parentGuess(state, a), g++) focus.add(a);
    for (const p of pending) {
      if (!touches(p, selected)) continue;
      focus.add(p.from);
      focus.add(p.to);
      for (const o of p.orig) {
        focus.add(o.from);
        focus.add(o.to);
      }
    }
  }

  // 障碍
  const obs: Obs[] = [];
  for (const it of display.items) {
    if (it.kind === "card" || it.kind === "more" || it.kind === "frame") {
      if (lod.size && lodHiddenCard(it.id) && it.kind !== "frame") continue;
      obs.push({ x: it.x, y: it.y, w: it.w, h: it.h, id: it.id, nid: it.nid, frame: it.kind === "frame" });
    }
  }
  const R: Router = { idx: new ObsIndex(obs), bounds: display.bounds, ports: new Map(), lanes: new Lanes() };
  const idx = R.idx;

  const edges: RoutedEdge[] = [];
  const ends = new Map<string, { en: Ends; strict: Ends }>();
  const stats: RouteStats = { intra: intraN, cross: crossList.length, crossRaw, routed: 0, direct: 0, channel: 0, search: 0, blocked: 0 };
  for (const p of pending) {
    const hot = isHot(p);
    const visible = p.kind === "intra" || relAll || hot;
    let opacity = 1;
    if (p.kind === "cross" && !hot) opacity = ROUTE.DIM_CROSS;
    if (focusOn && !hot) opacity = ROUTE.DIM_FOCUS;
    const fromFrame = hasFrame(p.from) && !chainOf(p.to).includes(p.from);
    const toFrame = hasFrame(p.to) && !chainOf(p.from).includes(p.to);
    const out: RoutedEdge = {
      id: p.id, kind: p.kind, from: p.from, to: p.to, code: p.code, implicit: p.implicit, count: Math.max(1, p.orig.length),
      orig: p.orig, fromFrame, toFrame, hot, visible, opacity, d: null, segs: [], poly: null, how: null, label: null,
    };
    edges.push(out);
    if (!visible && !allGeom) continue;
    const ia = fromFrame ? byId["F:" + p.from] : byId[p.from];
    const ib = toFrame ? byId["F:" + p.to] : byId[p.to];
    const A: EndRect = { x: ia.x, y: ia.y, w: ia.w, h: ia.h, key: ia.id, frameOf: fromFrame ? p.from : null };
    const B: EndRect = { x: ib.x, y: ib.y, w: ib.w, h: ib.h, key: ib.id, frameOf: toFrame ? p.to : null };
    const allowed = new Set<string>([...chainOf(p.from), ...chainOf(p.to)]);
    if (fromFrame) allowed.add(p.from);
    if (toFrame) allowed.add(p.to);
    const en: Ends = { skipA: p.from, skipB: p.to, allowed };
    const strict = strictEnds(en, A, B);
    ends.set(out.id, { en, strict });
    stats.routed++;
    // 1) 直连
    const ac = [A.x + A.w / 2, A.y + A.h / 2], bc = [B.x + B.w / 2, B.y + B.h / 2];
    const dx = bc[0] - ac[0], dy = bc[1] - ac[1];
    const vSep = B.y >= A.y + A.h || B.y + B.h <= A.y;
    const hSep = B.x >= A.x + A.w || B.x + B.w <= A.x;
    const order: boolean[] = [];
    if (vSep && (Math.abs(dy) > Math.abs(dx) * 0.6 || !hSep)) order.push(true);
    if (hSep) order.push(false);
    if (vSep && !order.includes(true)) order.push(true);
    for (const vert of order) {
      const g = directCurve(R, A, B, vert, p.tf);
      if (segsHit(idx, g.segs, ROUTE.MARGIN, en)) continue;
      for (const [r, s] of g.claims) claimPort(R, r, s);
      out.segs = g.segs;
      out.how = "direct";
      stats.direct++;
      break;
    }
    if (out.how) continue;
    // 2) 侧边通道 → 3) 栅格搜索
    let res = channelOriented(R, A, B, en, strict, Math.abs(dx) > Math.abs(dy), out.id) ?? channelOriented(R, A, B, en, strict, !(Math.abs(dx) > Math.abs(dy)), out.id);
    let how: RouteHow = "channel";
    if (!res) {
      how = "search";
      res = astar(R, A, B, strict, ROUTE.LOCAL_PAD, out.id) ?? astar(R, A, B, strict, Math.max(display.bounds.w, display.bounds.h), out.id);
      if (res && polyHit(idx, res.poly, en, strict)) res = null;
    }
    if (res) {
      claimPort(R, A, res.sa);
      claimPort(R, B, res.sb);
      out.poly = res.poly;
      out.how = how;
      registerLanes(R.lanes, res.poly, out.id);
      if (how === "channel") stats.channel++;
      else stats.search++;
    } else {
      const g = directCurve(R, A, B, order[0] ?? true, p.tf);
      out.segs = g.segs;
      out.how = "blocked";
      stats.blocked++;
    }
  }

  // 3') 分道复核：通道折线的中间段与他边同轴重叠且 <4px 时平移
  assignLanes(edges, idx, ends);
  for (const e of edges) {
    if (e.poly) e.segs = polySegs(e.poly, ROUTE.RADIUS);
    if (e.segs.length) e.d = pathD(e.segs);
  }

  // 4) 标签
  const labels: RoutedLabel[] = [];
  for (const e of edges) {
    if (!e.d || !e.visible) continue;
    const name = relName(e.code);
    let text = "";
    if (e.hot || zoom >= ROUTE.LABEL_ZOOM) text = e.code === "比" && !e.hot ? "vs" : name;
    else if (e.code === "比") text = "vs";
    if (e.count > 1) text = text ? `${text} ×${e.count}` : `×${e.count}`;
    if (!text) continue;
    e.label = placeLabel(e.segs, text, idx, labels);
    labels.push(e.label);
  }

  const out: Record<string, RoutedEdge> = {};
  for (const e of edges) out[e.id] = e;
  return { edges, byId: out, crossCount, focus, policy: { relAll, hovered, selected, focus: focusOn, zoom }, stats };
}

// ───────────────────────── 分道 ─────────────────────────

function segAxis(a: P2, b: P2): { axis: 0 | 1; c: number; lo: number; hi: number } {
  const axis: 0 | 1 = a[1] === b[1] ? 0 : 1;
  return axis === 0
    ? { axis, c: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) }
    : { axis, c: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) };
}

/** 中间段全部满足 4px 分道 */
function lanesFree(L: Lanes, poly: readonly P2[], id: string): boolean {
  for (let i = 1; i < poly.length - 2; i++) {
    const s = segAxis(poly[i], poly[i + 1]);
    if (!L.free(s.axis, s.c, s.lo, s.hi, id)) return false;
  }
  return true;
}

/** 登记中间段（首末段贴端口，不参与分道） */
function registerLanes(L: Lanes, poly: readonly P2[], id: string) {
  for (let i = 1; i < poly.length - 2; i++) {
    const s = segAxis(poly[i], poly[i + 1]);
    L.add(s.axis, s.c, s.lo, s.hi, id);
  }
}

function assignLanes(edges: RoutedEdge[], idx: ObsIndex, ends: ReadonlyMap<string, { en: Ends; strict: Ends }>) {
  const L = new Lanes();
  for (const e of edges) {
    if (!e.poly) continue;
    const { en, strict } = ends.get(e.id) as { en: Ends; strict: Ends };
    const poly = e.poly.map((p) => [p[0], p[1]] as P2);
    for (let i = 1; i < poly.length - 2; i++) {
      const s = segAxis(poly[i], poly[i + 1]);
      if (L.free(s.axis, s.c, s.lo, s.hi, e.id)) continue;
      let done = false;
      for (let k = 1; k <= 2 * ROUTE.MAX_LANES && !done; k++) {
        const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ROUTE.LANE;
        if (!L.free(s.axis, s.c + off, s.lo, s.hi, e.id)) continue;
        const a: P2 = s.axis === 0 ? [poly[i][0], poly[i][1] + off] : [poly[i][0] + off, poly[i][1]];
        const b: P2 = s.axis === 0 ? [poly[i + 1][0], poly[i + 1][1] + off] : [poly[i + 1][0] + off, poly[i + 1][1]];
        const trial = poly.slice();
        trial[i] = a;
        trial[i + 1] = b;
        // 首末段至少保留净空的一半，且邻段 / 本段不碰障碍
        const first = Math.hypot(trial[1][0] - trial[0][0], trial[1][1] - trial[0][1]);
        const lastN = trial.length - 1;
        const last = Math.hypot(trial[lastN][0] - trial[lastN - 1][0], trial[lastN][1] - trial[lastN - 1][1]);
        if (first < ROUTE.CLEAR / 2 || last < ROUTE.CLEAR / 2) continue;
        let bad = false;
        for (let j = Math.max(0, i - 1); j <= Math.min(trial.length - 2, i + 1) && !bad; j++) {
          const edge = j === 0 || j === trial.length - 2;
          if (segHit(idx, trial[j], trial[j + 1], ROUTE.MARGIN, edge ? en : strict)) bad = true;
        }
        if (bad) continue;
        poly[i] = a;
        poly[i + 1] = b;
        done = true;
      }
    }
    for (let i = 1; i < poly.length - 2; i++) {
      const s = segAxis(poly[i], poly[i + 1]);
      L.add(s.axis, s.c, s.lo, s.hi, e.id);
    }
    e.poly = poly;
  }
}

// ───────────────────────── 标签 ─────────────────────────

function placeLabel(segs: readonly PathSeg[], text: string, idx: ObsIndex, placed: readonly RoutedLabel[]): RoutedLabel {
  const w = Math.ceil(textWidth(text, ROUTE.LABEL_SIZE) + ROUTE.LABEL_PAD * 2);
  const h = ROUTE.LABEL_H;
  const lens = segs.map(segLen);
  const total = lens.reduce((a, b) => a + b, 0);
  const at = (f: number): P2 => {
    let t = total * f;
    for (let i = 0; i < segs.length; i++) {
      if (t <= lens[i] || i === segs.length - 1) return evalSeg(segs[i], lens[i] ? Math.min(1, t / lens[i]) : 0);
      t -= lens[i];
    }
    return segs[0].a;
  };
  const clashes = (cx: number, cy: number): boolean => {
    if (idx.hit(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 0, null)) return true;
    for (const l of placed) if (Math.abs(l.x - cx) * 2 < l.w + w && Math.abs(l.y - cy) * 2 < l.h + h) return true;
    return false;
  };
  for (const f of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
    const p = at(f);
    if (!clashes(p[0], p[1])) return { x: r1(p[0]), y: r1(p[1]), w, h, text };
  }
  const p = at(0.5);
  return { x: r1(p[0]), y: r1(p[1]), w, h, text };
}
