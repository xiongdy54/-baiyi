// 材料导图 v2 · 动画与稳定性（MINDMAP-V2-IMPL-PLAN §5.1 animate.ts；设计稿 §15.8 S3 / S4 / S8 与 LOD）。
// 纯函数、确定性、无 DOM、无时钟：时间一律由调用方传入（elapsed / now 毫秒）。
//
// 用法（组件层 rAF 循环）：
//   const tr = planTransition(prevShown, nextDisplay, { view, anchorId, reducedMotion });
//   每帧：const f = transitionFrame(tr, now - t0)；routeRelations(state, f.display, policy)；
//         buildCanvasSvg(f.display, routed, { view: f.view, opacity: f.opacity, leaving: f.leaving, ... })；
//   f.done 后停止 rAF。打断时把当前帧 f.display 作为下一次 planTransition 的 prev 即可（位置连续）。
//
// S3 锚点补偿：view 与锚点位置按同一缓动插值，缩放 k 不变时锚点屏幕位置整段恒定（不只终点）。
// S4 单调生长：monotoneFrames() 让流式任务范围内的组框只增不减；throttleStep() 把布局更新节流到 ≤4 次/秒。
// S8：新元素从父卡片位置淡入 + 位移（240ms），旧元素位移（260ms，ease-out），离场淡出（200ms）；
//     reducedMotion → 时长 0（transitionFrame(tr, 0) 即终态，frameCount = 1）。
// LOD：缩放 <0.5 时深层框收成摘要卡（lodFrames 给出收起的组，lodHidden 给出被隐藏的元素）；只换渲染粒度，不重排。

import type { GraphState } from "./types";
import { ROOT_ID } from "./types";
import type { Display, DisplayItem, Rect } from "./layout";

export const MOTION = {
  /** 旧元素位移 */
  move: 260,
  /** 新元素淡入 + 位移 */
  enter: 240,
  /** 离场淡出 */
  exit: 200,
  /** S4：布局更新最小间隔（≤4 次/秒） */
  throttle: 250,
} as const;

/** 一次过渡实际生效的动效时长（ms；C-32 A4 起来自 CSS Token，读不到时＝MOTION 常量） */
export interface MotionTiming {
  move: number;
  enter: number;
  exit: number;
}

/**
 * C-32 A4：动效时长读自主题 Token（--mm-move / --mm-enter / --mm-exit，见 src/theme.css 动效段），
 * 皮肤可覆盖——每次开始过渡（planTransition）读取一次，换肤后自然生效。
 * 单位：ms 或 s（CSS 产物压缩会把 260ms 归一成 .26s——必须按单位换算，否则过渡会被读成 0.26ms）；
 * 读不到 / 非法 / 无 DOM（node 测试）时回落 MOTION 常量。曲线 Token --mm-ease 由 CSS 消费；
 * 主进程 lensWindow.js 的 EASE（D204 窗口缓动）与其保持一致，两处注释互相指向。
 */
export function readMotion(): MotionTiming {
  try {
    const cs = typeof document !== "undefined" && typeof getComputedStyle === "function" && document.documentElement
      ? getComputedStyle(document.documentElement)
      : null;
    const num = (name: string, fallback: number): number => {
      if (!cs) return fallback;
      const raw = (cs.getPropertyValue(name) || "").trim();
      if (!raw) return fallback;
      const v = parseFloat(raw);
      if (!Number.isFinite(v) || v <= 0) return fallback;
      return /s$/i.test(raw) && !/ms$/i.test(raw) ? v * 1000 : v;
    };
    return { move: num("--mm-move", MOTION.move), enter: num("--mm-enter", MOTION.enter), exit: num("--mm-exit", MOTION.exit) };
  } catch {
    return { move: MOTION.move, enter: MOTION.enter, exit: MOTION.exit };
  }
}

/**
 * C-32 A5：应用动效三态解析（原 MindmapCanvasV2 的 prefersReducedMotion() 布尔值升级）。
 * body 含 motion-off → "off"（直接跳到终态）；含 motion-reduced → "reduced"（时长减半、只做透明度过渡）；
 * 否则看系统 prefers-reduced-motion（命中＝"off"，与既有行为一致）；都不是 → "full"。
 * body 类由主窗口 / 独立窗口的外观挂载点统一落（readAppearance → applyAppearanceToDocument，C-31）。
 */
export function motionPreference(): "off" | "reduced" | "full" {
  try {
    const cls = typeof document !== "undefined" && document.body ? document.body.classList : null;
    if (cls) {
      if (cls.contains("motion-off")) return "off";
      if (cls.contains("motion-reduced")) return "reduced";
    }
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "off" : "full";
  } catch {
    return "full";
  }
}

export const LOD = {
  /** 低于此缩放启用摘要卡 */
  zoom: 0.5,
  /** 低于此缩放连顶层框也收起 */
  deepZoom: 0.25,
  /** 「深层」：块层级 ≥ 此值，或嵌在别的框内 */
  level: 2,
} as const;

export interface View {
  tx: number;
  ty: number;
  k: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** 带不透明度的矩形（o 缺省为 1） */
export interface AnimRect extends Rect {
  o?: number;
}

export type LeavingItem = DisplayItem & { o: number };

// ───────────────────────── 基础插值 ─────────────────────────

export const easeOut = (p: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

const lerp = (a: number, b: number, e: number) => a + (b - a) * e;

/** 矩形（与不透明度）线性插值；e∈[0,1]，e≥1 精确等于 to */
export function interpolate(from: AnimRect, to: AnimRect, e: number): AnimRect {
  if (e >= 1) return { x: to.x, y: to.y, w: to.w, h: to.h, o: to.o ?? 1 };
  if (e <= 0) return { x: from.x, y: from.y, w: from.w, h: from.h, o: from.o ?? 1 };
  return {
    x: lerp(from.x, to.x, e),
    y: lerp(from.y, to.y, e),
    w: lerp(from.w, to.w, e),
    h: lerp(from.h, to.h, e),
    o: lerp(from.o ?? 1, to.o ?? 1, e),
  };
}

export function interpolateView(a: View, b: View, e: number): View {
  if (e >= 1) return { ...b };
  return { tx: lerp(a.tx, b.tx, e), ty: lerp(a.ty, b.ty, e), k: lerp(a.k, b.k, e) };
}

/** 画布坐标 → 屏幕坐标 */
export function screenOf(p: Pt, view: View): Pt {
  return { x: p.x * view.k + view.tx, y: p.y * view.k + view.ty };
}

/** S3：返回新视图，使 targetRect 左上角落在 anchorBefore（屏幕坐标）处；缩放不变 */
export function compensateView(anchorBefore: Pt, targetRect: Pt, view: View): View {
  return { tx: anchorBefore.x - targetRect.x * view.k, ty: anchorBefore.y - targetRect.y * view.k, k: view.k };
}

// ───────────────────────── 进入 / 离场 ─────────────────────────

/** 子 → 父（取自 Display.groups[*].kids；含 MORE: 项、吸收子组） */
export function parentMap(d: Display): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of Object.keys(d.groups).sort()) for (const k of d.groups[g].kids) out[k] = g;
  return out;
}

/**
 * 新元素的进入起点（S8「从父卡片长出」）：
 * - 卡片 / more：从最近的、prev 中存在的祖先卡片位置长出（右缘对齐父卡右缘、顶对齐），o=0；
 * - 组框 F:g：若 prev 有卡片 g（叶就地长成框，S6），从该卡片矩形长出；
 * - 其余装饰：原地淡入。
 */
export function enterRect(id: string, next: Display, prev: Display | null, parents?: Record<string, string>): AnimRect {
  const to = next.byId[id];
  if (!to) throw new Error(`enterRect: unknown item ${id}`);
  const fade: AnimRect = { x: to.x, y: to.y, w: to.w, h: to.h, o: 0 };
  if (!prev) return fade;
  if (to.kind === "frame") {
    const c = prev.byId[to.nid];
    return c ? { x: c.x, y: c.y, w: c.w, h: c.h, o: 0 } : fade;
  }
  if (to.kind === "card" || to.kind === "more") {
    const pm = parents ?? parentMap(next);
    let p: string | undefined = to.kind === "card" ? pm[to.id] : to.nid;
    let guard = 0;
    while (p && guard++ < 4096) {
      const pr = prev.byId[p];
      if (pr && pr.kind === "card") return { x: pr.x + pr.w - to.w, y: pr.y, w: to.w, h: to.h, o: 0 };
      p = pm[p];
    }
  }
  return fade;
}

export interface TransitionOptions {
  view: View;
  /** S3 锚点（用户操作的节点；流式整图时传根或当前聚焦节点）；null = 不补偿 */
  anchorId?: string | null;
  /** 旧开关（系统 prefers-reduced-motion 的旧语义＝瞬时）；与 motionMode 并存，true 视同 "off" */
  reducedMotion?: boolean;
  /** C-32 A5：应用动效三态——off＝直接跳终态；reduced＝时长减半、只做透明度过渡；full＝完整动画 */
  motionMode?: "off" | "reduced" | "full";
}

export interface Transition {
  to: Display;
  from: Record<string, AnimRect>;
  /** 新出现的元素 id（Display.items 顺序） */
  enter: string[];
  leaving: DisplayItem[];
  viewFrom: View;
  viewTo: View;
  /** 0 = 瞬时（reduced-motion 或首帧） */
  duration: number;
  /** C-32 A4：本过渡生效的时长档（planTransition 开始时读一次 CSS Token）；缺省＝MOTION 常量 */
  motion?: MotionTiming;
}

export function planTransition(prev: Display | null, next: Display, opts: TransitionOptions): Transition {
  const instant = !!opts.reducedMotion || opts.motionMode === "off" || !prev;
  const pm = parentMap(next);
  const from: Record<string, AnimRect> = {};
  const enter: string[] = [];
  if (opts.motionMode === "reduced" && !instant) {
    // C-32 A5「只做透明度过渡」：几何直接到终态（无位移），入场原地淡入（o=0）、离场原地淡出，视图不动；
    // 时长取 Token 三档最大值的一半。
    for (const it of next.items) {
      const p = prev ? prev.byId[it.id] : undefined;
      if (p) from[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h, o: 1 };
      else {
        from[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h, o: 0 };
        enter.push(it.id);
      }
    }
    const motion = readMotion();
    const duration = Math.ceil(Math.max(motion.move, motion.enter, motion.exit) / 2);
    return { to: next, from, enter, leaving: prev ? prev.items.filter((it) => !next.byId[it.id]) : [], viewFrom: { ...opts.view }, viewTo: { ...opts.view }, duration, motion };
  }
  for (const it of next.items) {
    const p = prev ? prev.byId[it.id] : undefined;
    if (p) from[it.id] = { x: p.x, y: p.y, w: p.w, h: p.h, o: 1 };
    else {
      from[it.id] = enterRect(it.id, next, prev, pm);
      enter.push(it.id);
    }
  }
  const leaving: DisplayItem[] = prev ? prev.items.filter((it) => !next.byId[it.id]) : [];
  let viewTo: View = { ...opts.view };
  const a = opts.anchorId;
  if (prev && a && prev.byId[a] && next.byId[a]) {
    viewTo = compensateView(screenOf(prev.byId[a], opts.view), next.byId[a], opts.view);
  }
  const motion = readMotion();
  const duration = instant ? 0 : Math.max(motion.move, motion.enter, motion.exit);
  return { to: next, from, enter, leaving, viewFrom: { ...opts.view }, viewTo, duration, motion };
}

export interface TransitionFrame {
  /** 插值后的 Display（几何为插值值；edges/groups/consumed 同终态），可直接交给 route / svg */
  display: Display;
  /** 元素 id → 不透明度（仅 <1 的项） */
  opacity: Record<string, number>;
  leaving: LeavingItem[];
  view: View;
  done: boolean;
}

export function transitionFrame(tr: Transition, elapsedMs: number): TransitionFrame {
  const D = tr.duration;
  const t = Math.max(0, elapsedMs);
  if (D <= 0 || t >= D) return { display: tr.to, opacity: {}, leaving: [], view: { ...tr.viewTo }, done: true };
  const M = tr.motion ?? MOTION; // C-32 A4：时长来自 planTransition 读取的 Token 档
  const eMove = easeOut(t / M.move);
  const eEnter = easeOut(t / M.enter);
  const eExit = easeOut(t / M.exit);
  const items: DisplayItem[] = [];
  const byId: Record<string, DisplayItem> = {};
  const opacity: Record<string, number> = {};
  const isEnter = new Set(tr.enter);
  let bw = tr.to.bounds.w;
  let bh = tr.to.bounds.h;
  for (const it of tr.to.items) {
    const r = interpolate(tr.from[it.id], { x: it.x, y: it.y, w: it.w, h: it.h, o: 1 }, isEnter.has(it.id) ? eEnter : eMove);
    const d: DisplayItem = { ...it, x: r.x, y: r.y, w: r.w, h: r.h };
    items.push(d);
    byId[d.id] = d;
    if ((r.o ?? 1) < 1) opacity[d.id] = r.o as number;
    if (r.x + r.w > bw) bw = r.x + r.w;
    if (r.y + r.h > bh) bh = r.y + r.h;
  }
  const leaving: LeavingItem[] = eExit >= 1 ? [] : tr.leaving.map((it) => ({ ...it, o: 1 - eExit }));
  const display: Display = { ...tr.to, items, byId, bounds: { w: bw, h: bh } };
  return { display, opacity, leaving, view: interpolateView(tr.viewFrom, tr.viewTo, eMove), done: false };
}

/** 一次过渡要画的帧数（含终帧）；reduced-motion 下为 1 */
export function frameCount(tr: Transition, fps = 60): number {
  return tr.duration <= 0 ? 1 : Math.ceil((tr.duration * fps) / 1000) + 1;
}

// ───────────────────────── S4：节流与单调生长 ─────────────────────────

export interface ThrottleState {
  /** 上次执行布局的时刻（ms）；null = 从未 */
  last: number | null;
}

/**
 * 布局更新节流（≤4 次/秒）：run=true 时立即布局；否则在 delay 毫秒后再调用一次（合并期间的全部 delta）。
 * 纯函数：返回新状态，不修改入参。
 */
export function throttleStep(st: ThrottleState, now: number, minMs: number = MOTION.throttle): { run: boolean; delay: number; state: ThrottleState } {
  if (st.last == null || now - st.last >= minMs) return { run: true, delay: 0, state: { last: now } };
  return { run: false, delay: minMs - (now - st.last), state: st };
}

export type FrameSizes = Readonly<Record<string, { w: number; h: number }>>;

/**
 * S4：流式任务范围内（active 为真的组）的组框只增不减。
 * 返回调整后的 Display（未变化时原样返回）与新的尺寸记录；离开 active 的组不再保留记录（任务结束后可收缩）。
 */
export function monotoneFrames(
  display: Display,
  prev: FrameSizes,
  active: ReadonlySet<string> | ((groupId: string) => boolean),
): { display: Display; sizes: FrameSizes } {
  const isActive = typeof active === "function" ? active : (g: string) => active.has(g);
  const sizes: Record<string, { w: number; h: number }> = {};
  let changed = false;
  const items = display.items.map((it) => {
    if (it.kind !== "frame" || !isActive(it.nid)) return it;
    const p = prev[it.nid];
    const w = p ? Math.max(p.w, it.w) : it.w;
    const h = p ? Math.max(p.h, it.h) : it.h;
    sizes[it.nid] = { w, h };
    if (w === it.w && h === it.h) return it;
    changed = true;
    return { ...it, w, h };
  });
  if (!changed) return { display, sizes };
  const byId: Record<string, DisplayItem> = {};
  let bw = display.bounds.w;
  let bh = display.bounds.h;
  for (const it of items) {
    byId[it.id] = it;
    if (it.x + it.w > bw) bw = it.x + it.w;
    if (it.y + it.h > bh) bh = it.y + it.h;
  }
  return { display: { ...display, items, byId, bounds: { w: bw, h: bh } }, sizes };
}

/** 流式生长范围：状态为 streaming 或 jobId 属于运行中任务的节点，及其全部祖先（含 ROOT_ID） */
export function growthScope(state: GraphState, runningJobs: Iterable<string> = []): Set<string> {
  const jobs = new Set(runningJobs);
  const out = new Set<string>();
  for (const id of Object.keys(state.nodes).sort()) {
    const n = state.nodes[id];
    if (n.state !== "streaming" && !(n.jobId && jobs.has(n.jobId))) continue;
    let cur: string | null = id;
    let guard = 0;
    while (cur && !out.has(cur) && guard++ < 4096) {
      out.add(cur);
      const nn: GraphState["nodes"][string] | undefined = state.nodes[cur];
      cur = nn ? nn.parentId : null;
    }
    out.add(ROOT_ID);
  }
  return out;
}

// ───────────────────────── 框链与 LOD ─────────────────────────

/** 元素外层组框所属组的链（内 → 外）；卡片 g 若自身成框，链首为 g；组框 F:g 的链从外层开始 */
export function frameChain(display: Display, itemId: string): string[] {
  const out: string[] = [];
  const it = display.byId[itemId];
  if (!it) return out;
  let g = it.group;
  let guard = 0;
  while (g && guard++ < 4096) {
    out.push(g);
    const f = display.byId["F:" + g];
    g = f ? f.group : null;
  }
  return out;
}

/**
 * LOD：返回应收成摘要卡的组 id（升序；只含最外层，被收起框内的框不再列出）。
 * zoom ≥ 0.5 → []；0.25 ≤ zoom < 0.5 → 深层框（块层级 ≥2 或嵌在别的框内）；zoom < 0.25 → 全部框。
 */
export function lodFrames(display: Display, zoom: number, opts: { zoom?: number; deepZoom?: number; level?: number } = {}): string[] {
  if (!(zoom < (opts.zoom ?? LOD.zoom))) return [];
  const all = zoom < (opts.deepZoom ?? LOD.deepZoom);
  const lvl = opts.level ?? LOD.level;
  const want = new Set<string>();
  for (const it of display.items) {
    if (it.kind === "frame" && (all || it.level >= lvl || it.group != null)) want.add(it.nid);
  }
  const out: string[] = [];
  for (const g of want) if (!frameChain(display, "F:" + g).some((o) => want.has(o))) out.push(g);
  return out.sort();
}

/** 被摘要卡隐藏的元素 id：收起框内除框本身与框头卡片外的全部元素 */
export function lodHidden(display: Display, collapsed: Iterable<string>): Set<string> {
  const cs = new Set(collapsed);
  const hidden = new Set<string>();
  if (!cs.size) return hidden;
  for (const it of display.items) {
    const chain = frameChain(display, it.id);
    // 框头卡片 g 与框 F:g 自身不因 g 收起而隐藏，只看更外层
    const own = it.kind === "frame" || (it.kind === "card" && chain[0] === it.id) ? (it.kind === "frame" ? null : it.id) : null;
    for (const g of chain) {
      if (g === own) continue;
      if (cs.has(g)) {
        hidden.add(it.id);
        break;
      }
    }
  }
  return hidden;
}

/** 摘要卡内容：组 → { 版式, 被收起的卡片数 } */
export function lodSummary(display: Display, collapsed: Iterable<string>): Record<string, { pattern: string; cards: number }> {
  const set = new Set(collapsed);
  const out: Record<string, { pattern: string; cards: number }> = {};
  for (const g of [...set].sort()) out[g] = { pattern: display.groups[g]?.pattern ?? "tree", cards: 0 };
  for (const it of display.items) {
    if (it.kind !== "card" && it.kind !== "more") continue;
    for (const g of frameChain(display, it.id)) {
      if (g === it.id) continue;
      if (set.has(g)) {
        out[g].cards++;
        break;
      }
    }
  }
  return out;
}
