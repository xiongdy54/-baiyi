// 材料导图 v2 · 画布 SVG 生成（MINDMAP-V2-IMPL-PLAN §5.1 svg.ts；设计稿 §5 四态、§8.2、§15.2、§15.7、§15.8 LOD）。
// 纯函数：只读 Display（或 animate 插值帧）+ RouteResult + 帧状态，产出 SVG 字符串。
//
// X5（安全红线）：帧内所有文本与属性值一律经 escapeXml 严格转义后写入——不走 DOMPurify（2,000 节点每帧太贵）。
//     数值统一经 num() 输出（非有限数 → 0）；颜色只写 `var(--token)` 常量；导出模式的主题色值经白名单校验。
//     导出 `{ static: true }`：无动画元素、无 data-*、无交互态、自包含（根元素 style 内置 CSS 变量取值），可另行过 DOMPurify。
// 视觉：直角线是结构（tree / seq，--border-strong），曲线是关系（--text-secondary，线型 / 端头区分八类，不用颜色）；
//     与选中/悬停相连的关系、选中卡片 / 框为 accent；根卡为全图唯一 accent 填充。
// 交互钩子（非 static）：卡片 `data-node-id`；「＋」深挖 `data-act="deepen"`；折叠徽标 `data-act="unfold"`；
//     LOD「另有 N 项」`data-act="lod-expand" data-group-id`；组框 `data-frame-id`；关系线 `data-edge-id`。

import type { GraphState, PatternKey } from "./types";
import { ROOT_ID } from "./types";
import type { Display, DisplayItem, DisplayEdge } from "./layout";
import { CARD, fitText, titleRoom } from "./measure";
import { PATTERN_NAMES } from "./pattern";
import type { MarkerKind, RouteResult, RoutedEdge } from "./route";
import { REL_STYLE } from "./route";
import type { LeavingItem, View } from "./animate";
import { lodHidden, lodSummary } from "./animate";

// ───────────────────────── 转义与数值 ─────────────────────────

/** XML 文本 / 属性值严格转义（& < > " ' 与 XML 1.0 非法控制字符） */
export function escapeXml(s: unknown): string {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const num = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

// ───────────────────────── 主题 ─────────────────────────

export const THEME_VARS = [
  "paper", "ink", "text-secondary", "text-helper", "border-subtle", "border-strong", "accent", "accent-on", "accent-soft", "font-sans",
] as const;
export type ThemeVar = (typeof THEME_VARS)[number];

/** 导出模式默认取值（浅色 theme.css）；交互模式不内置，直接继承页面 CSS 变量 */
export const DEFAULT_THEME: Readonly<Record<ThemeVar, string>> = {
  paper: "#fafaf8",
  ink: "#0a0a0a",
  "text-secondary": "#525252",
  "text-helper": "#737373",
  "border-subtle": "#e0e0e0",
  "border-strong": "#a3a3a3",
  accent: "#166a59",
  "accent-on": "#ffffff",
  "accent-soft": "rgba(22,106,89,0.08)",
  "font-sans": '"Inter","Helvetica Neue",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif',
};

/** 主题值白名单：颜色函数 / hex / 字体名列表；含 ; { } < > url( expression 等一律丢弃回默认 */
function safeThemeValue(v: string): boolean {
  return /^[#a-zA-Z0-9(),.%\s"'_-]{1,200}$/.test(v) && !/url\s*\(|expression|javascript/i.test(v);
}

// ───────────────────────── 文案（i18n 由调用方传入） ─────────────────────────

export interface SvgLabels {
  deepen: string;
  floor: string;
  streaming: string;
  unfold: (n: number) => string;
  more: (n: number) => string;
  cross: (n: number) => string;
  stub: string;
  summary: (patternName: string, n: number) => string;
  patternName: (k: PatternKey) => string;
}

export const DEFAULT_LABELS: SvgLabels = {
  deepen: "深挖此节点",
  floor: "已触底：没有更深的结构",
  streaming: "正在生成",
  unfold: (n) => `展开 ${n} 个子节点`,
  more: (n) => `另有 ${n} 项`,
  cross: (n) => `${n} 条跨组关系，悬停或选中查看`,
  stub: "其余部分，可深挖",
  summary: (p, n) => `${p} · ${n} 个子结构`,
  patternName: (k) => PATTERN_NAMES[k] ?? k,
};

// ───────────────────────── 帧状态与选项 ─────────────────────────

export interface FrameState {
  /** 视口（static 忽略） */
  view?: View;
  selected?: string | null;
  hovered?: string | null;
  /** 元素 id → 不透明度（animate.transitionFrame().opacity） */
  opacity?: Readonly<Record<string, number>>;
  /** 离场中的元素（animate.transitionFrame().leaving） */
  leaving?: readonly LeavingItem[];
  /** 刚到达的节点（虚线 accent 描边提示） */
  fresh?: ReadonlySet<string> | readonly string[];
  /** LOD 收起的组（animate.lodFrames）；应与传给 routeRelations 的 lodCollapsed 一致 */
  lodCollapsed?: readonly string[];
}

export interface SvgOptions {
  /** 自包含导出：无动画、无 data-*、无交互态 */
  static?: boolean;
  /** 导出时内置的 CSS 变量取值（缺省用 DEFAULT_THEME）；交互模式忽略 */
  theme?: Partial<Record<ThemeVar, string>>;
  labels?: Partial<SvgLabels>;
  /** marker id 前缀（同页多画布时避免冲突） */
  idPrefix?: string;
  /** 导出留白 */
  pad?: number;
  /** 只返回 `<defs>` + 内容 `<g>`（组件写进既有 <svg>）；static 忽略 */
  fragment?: boolean;
  /** 卡片文字来源（标题 / 类型）；Display 只有几何。缺省时卡片无文字 */
  graph?: GraphState;
  /** 根卡标题；缺省 graph.meta.title（应与 layoutGraph 的 rootTitle 一致） */
  rootTitle?: string;
}

// ───────────────────────── 端头 ─────────────────────────

const MARKER_BODY: Record<MarkerKind, { body: string; refX: number }> = {
  arrow: { body: '<path d="M0,1 L9,5 L0,9 Z" fill="COL"/>', refX: 9 },
  open: { body: '<path d="M1,1 L9,5 L1,9" fill="none" stroke="COL" stroke-width="1.4"/>', refX: 9 },
  bar: { body: '<path d="M9,0 V10 M4,0 V10" stroke="COL" stroke-width="1.6"/>', refX: 9 },
  dot: { body: '<circle cx="5" cy="5" r="3" fill="COL"/>', refX: 5 },
};

function defs(pre: string): string {
  let s = "<defs>";
  const mk = (id: string, col: string, k: MarkerKind) =>
    `<marker id="${pre}${id}" viewBox="0 0 10 10" refX="${MARKER_BODY[k].refX}" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${MARKER_BODY[k].body.replace(/COL/g, col)}</marker>`;
  for (const k of Object.keys(MARKER_BODY) as MarkerKind[]) {
    s += mk(`m-${k}-n`, "var(--text-secondary)", k);
    s += mk(`m-${k}-a`, "var(--accent)", k);
  }
  s += mk("m-seq", "var(--border-strong)", "arrow");
  return s + "</defs>";
}

// ───────────────────────── 主入口 ─────────────────────────

export function buildCanvasSvg(display: Display, routed: RouteResult, frameState: FrameState = {}, opts: SvgOptions = {}): string {
  const st = !!opts.static;
  const L: SvgLabels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}) };
  const pre = escapeXml(opts.idPrefix ?? "mm2-");
  const selected = st ? null : frameState.selected ?? null;
  const hovered = st ? null : frameState.hovered ?? null;
  const opMap = st ? {} : frameState.opacity ?? {};
  const fresh = st ? new Set<string>() : new Set(frameState.fresh ?? []);
  const lodSet = frameState.lodCollapsed ?? [];
  const hidden = lodHidden(display, lodSet);
  const summary = lodSummary(display, lodSet);
  const focus = st ? null : routed.focus;
  const relAll = routed.policy.relAll;
  const by = display.byId;

  const dimOf = (nid: string) => (focus && !focus.has(nid) ? 0.35 : 1);
  const opOf = (id: string) => opMap[id] ?? 1;
  const attrOp = (o: number) => (o < 1 ? ` opacity="${num(Math.max(0, o))}"` : "");
  const data = (k: string, v: string) => (st ? "" : ` data-${k}="${escapeXml(v)}"`);

  const framesOut: string[] = [];
  const decoOut: string[] = [];
  const cardsOut: string[] = [];

  const drawItem = (d: DisplayItem, o: number) => {
    if (d.kind === "frame") {
      const sel = selected === d.nid;
      let g = `<g${data("frame-id", d.nid)}${attrOp(o * dimOf(d.nid))}>`;
      g += `<rect x="${num(d.x)}" y="${num(d.y)}" width="${num(d.w)}" height="${num(d.h)}" fill="var(--paper)" stroke="${sel ? "var(--accent)" : "var(--border-subtle)"}" stroke-width="1"/>`;
      if (d.text) g += `<text x="${num(d.x + d.w - 12)}" y="${num(d.y + 20)}" font-size="11" text-anchor="end" fill="var(--text-helper)">${escapeXml(d.text)}</text>`;
      const sm = summary[d.nid];
      if (sm) {
        const head = by[d.nid];
        const cy = head ? Math.min(d.y + d.h - 12, head.y + head.h + (d.y + d.h - head.y - head.h) / 2 + 4) : d.y + d.h / 2;
        g += `<text x="${num(d.x + d.w / 2)}" y="${num(cy)}" font-size="${CARD.titleSize}" text-anchor="middle" fill="var(--text-secondary)">${escapeXml(L.summary(L.patternName(sm.pattern as PatternKey), sm.cards))}</text>`;
      }
      framesOut.push(g + "</g>");
      return;
    }
    if (d.kind === "lane") {
      decoOut.push(`<rect x="${num(d.x)}" y="${num(d.y)}" width="${num(d.w)}" height="${num(d.h)}" fill="var(--ink)" fill-opacity="0.025" stroke="var(--border-subtle)"${attrOp(o * dimOf(d.nid))}/>`);
      return;
    }
    if (d.kind === "axis") {
      decoOut.push(`<line x1="${num(d.x)}" y1="${num(d.y + d.h / 2)}" x2="${num(d.x + d.w)}" y2="${num(d.y + d.h / 2)}" stroke="var(--border-strong)" stroke-width="1"${attrOp(o * dimOf(d.nid))}/>`);
      return;
    }
    if (d.kind === "tick") {
      decoOut.push(`<line x1="${num(d.x + d.w / 2)}" y1="${num(d.y)}" x2="${num(d.x + d.w / 2)}" y2="${num(d.y + d.h)}" stroke="var(--border-strong)" stroke-width="1"${attrOp(o * dimOf(d.nid))}/>`);
      return;
    }
    if (d.kind === "date") {
      decoOut.push(
        `<g${attrOp(o * dimOf(d.nid))}><circle cx="${num(d.x + d.w / 2)}" cy="${num(d.y + d.h - 4)}" r="3" fill="var(--ink)"/>` +
          `<text x="${num(d.x + d.w / 2)}" y="${num(d.y + 12)}" font-size="11" text-anchor="middle" fill="var(--text-secondary)">${escapeXml(d.text ?? "")}</text></g>`,
      );
      return;
    }
    if (d.kind === "label") {
      decoOut.push(`<text x="${num(d.x)}" y="${num(d.y + 12)}" font-size="11" fill="var(--text-secondary)"${attrOp(o * dimOf(d.nid))}>${escapeXml(d.text ?? "")}</text>`);
      return;
    }
    if (d.kind === "more") {
      const n = d.count ?? 0;
      let g = `<g transform="translate(${num(d.x)},${num(d.y)})"${data("act", "lod-expand")}${data("group-id", d.nid)}${attrOp(o * dimOf(d.nid))}>`;
      g += `<rect width="${num(d.w)}" height="${num(d.h)}" fill="var(--paper)" stroke="var(--border-strong)" stroke-dasharray="3 3"/>`;
      g += `<text x="12" y="${num(d.h / 2 + 4)}" font-size="12" fill="var(--text-secondary)">${escapeXml(fitText(L.more(n), 12, d.w - 16))}</text>`;
      cardsOut.push(g + "</g>");
      return;
    }
    if (d.kind === "card") cardsOut.push(cardSvg(d, o));
  };

  const cardSvg = (d: DisplayItem, o: number): string => {
    const isRoot = d.id === ROOT_ID || d.state === "root";
    const state = d.state ?? "floor";
    const sel = selected === d.id;
    const hov = hovered === d.id;
    const isFresh = fresh.has(d.id);
    const streaming = state === "streaming";
    const stroke = isRoot ? "var(--accent)" : sel || isFresh || streaming ? "var(--accent)" : hov ? "var(--ink)" : "var(--border-strong)";
    const dash = !isRoot && (isFresh || streaming) ? ' stroke-dasharray="4 3"' : "";
    let g = `<g transform="translate(${num(d.x)},${num(d.y)})"${data("node-id", d.id)}${attrOp(o * dimOf(d.id))}>`;
    g += `<rect width="${num(d.w)}" height="${num(d.h)}" fill="${isRoot ? "var(--accent)" : "var(--paper)"}" stroke="${stroke}" stroke-width="${sel ? 2 : 1}"${dash}/>`;
    const node = isRoot ? null : opts.graph?.nodes[d.id] ?? null;
    const title = isRoot ? opts.rootTitle ?? opts.graph?.meta?.title ?? "" : node ? node.title : "";
    if (isRoot) {
      g += `<text x="16" y="${num(d.h / 2 + 5)}" font-size="${CARD.rootSize}" font-weight="600" fill="var(--accent-on)">${escapeXml(fitText(title, CARD.rootSize * CARD.rootBold, titleRoom(d.w, true)))}</text>`;
    } else {
      const muted = state === "stub";
      g += `<text x="12" y="18" font-size="${CARD.typeSize}" fill="var(--text-secondary)">${escapeXml(fitText(node ? String(node.type ?? "") : "", CARD.typeSize, titleRoom(d.w)))}</text>`;
      g += `<text x="12" y="36" font-size="${CARD.titleSize}" fill="${muted ? "var(--text-secondary)" : "var(--ink)"}">${escapeXml(fitText(title, CARD.titleSize, titleRoom(d.w)))}</text>`;
    }
    const bx = d.w - 10, by_ = d.h / 2;
    if (!isRoot && (state === "more" || state === "stub")) {
      g += `<g transform="translate(${num(bx - 10)},${num(by_ - 10)})"${data("act", "deepen")}${data("node-id", d.id)}>` +
        `<rect width="20" height="20" fill="var(--paper)" stroke="var(--accent)"/><path d="M6 10H14M10 6V14" stroke="var(--accent)" stroke-width="1.5"/>` +
        `<title>${escapeXml(state === "stub" ? L.stub : L.deepen)}</title></g>`;
    } else if (!isRoot && state === "floor") {
      g += `<circle cx="${num(bx)}" cy="${num(by_)}" r="2.5" fill="var(--border-strong)"><title>${escapeXml(L.floor)}</title></circle>`;
    } else if (state === "collapsed") {
      const n = d.count ?? 0;
      const label = `+${n}`;
      const w = Math.max(28, label.length * 7 + 10);
      g += `<g transform="translate(${num(d.w - w / 2)},${num(by_ - 10)})"${data("act", "unfold")}${data("node-id", d.id)}>` +
        `<rect width="${num(w)}" height="20" fill="var(--ink)"/><text x="${num(w / 2)}" y="14" font-size="11" text-anchor="middle" fill="var(--paper)">${escapeXml(label)}</text>` +
        `<title>${escapeXml(L.unfold(n))}</title></g>`;
    } else if (streaming) {
      g += `<circle cx="${num(bx)}" cy="${num(by_)}" r="3" fill="var(--accent)">` +
        (st ? "" : `<animate attributeName="opacity" values="1;.2;1" dur="1s" repeatCount="indefinite"/>`) +
        `<title>${escapeXml(L.streaming)}</title></circle>`;
    }
    // ↗N（跨组关系默认不画线，只计数；hover/选中或「全部关系」时线已画出，不再显示计数）
    const cc = routed.crossCount[d.id] ?? 0;
    if (cc && !relAll && !sel && !hov) {
      const t = String(cc);
      const w = 22 + t.length * 7;
      g += `<g transform="translate(${num(d.w - w - 4)},-9)"><rect width="${num(w)}" height="18" fill="var(--paper)" stroke="var(--text-secondary)"/>` +
        `<path d="M5 13L12 6M7.5 6H12V10.5" fill="none" stroke="var(--text-secondary)" stroke-width="1.2"/>` +
        `<text x="${num(15 + (w - 15) / 2)}" y="13" font-size="11" text-anchor="middle" fill="var(--text-secondary)">${escapeXml(t)}</text>` +
        `<title>${escapeXml(L.cross(cc))}</title></g>`;
    }
    return g + "</g>";
  };

  // 元素（离场在前，便于被新元素覆盖）
  if (!st) for (const it of frameState.leaving ?? []) drawItem(it, it.o);
  for (const it of display.items) {
    if (hidden.has(it.id)) continue;
    drawItem(it, opOf(it.id));
  }

  // 结构线
  const structOut: string[] = [];
  for (const e of display.edges) {
    if (e.kind === "rel") continue;
    if (hidden.has(e.from) || hidden.has(e.to)) continue;
    const s = structEdge(display, e, opOf, dimOf, pre);
    if (s) structOut.push(s);
  }

  // 关系线 + 标签
  const relOut: string[] = [];
  const labelOut: string[] = [];
  for (const e of routed.edges) {
    if (!e.visible || !e.d) continue;
    const o = Math.min(opOf(e.from), opOf(e.to)) * e.opacity;
    relOut.push(relEdgeSvg(e, o, pre, data));
    if (e.label) {
      const lb = e.label;
      labelOut.push(
        `<g${attrOp(o)}><rect x="${num(lb.x - lb.w / 2)}" y="${num(lb.y - lb.h / 2)}" width="${num(lb.w)}" height="${num(lb.h)}" fill="var(--paper)"/>` +
          `<text x="${num(lb.x)}" y="${num(lb.y + 4)}" font-size="11" text-anchor="middle" fill="${e.hot ? "var(--accent)" : "var(--text-secondary)"}">${escapeXml(lb.text)}</text></g>`,
      );
    }
  }

  const body = framesOut.join("") + decoOut.join("") + structOut.join("") + relOut.join("") + cardsOut.join("") + labelOut.join("");

  if (st) {
    const pad = Math.max(0, opts.pad ?? 24);
    const w = Math.max(display.bounds.w + pad * 2, 320);
    const h = Math.max(display.bounds.h + pad * 2, 200);
    const theme: Record<string, string> = { ...DEFAULT_THEME };
    for (const [k, v] of Object.entries(opts.theme ?? {})) {
      if ((THEME_VARS as readonly string[]).includes(k) && typeof v === "string" && safeThemeValue(v)) theme[k] = v;
    }
    const style = THEME_VARS.map((k) => `--${k}:${theme[k]}`).join(";") + ";font-family:var(--font-sans)";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${num(-pad)} ${num(-pad)} ${num(w)} ${num(h)}" style="${escapeXml(style)}">` +
      defs(pre) +
      `<rect x="${num(-pad)}" y="${num(-pad)}" width="${num(w)}" height="${num(h)}" fill="var(--paper)"/>` +
      body +
      `</svg>`
    );
  }
  const v = frameState.view ?? { tx: 0, ty: 0, k: 1 };
  const inner = defs(pre) + `<g transform="translate(${num(v.tx)},${num(v.ty)}) scale(${num(v.k)})">${body}</g>`;
  if (opts.fragment) return inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="font-family:var(--font-sans)">${inner}</svg>`;
}

// ───────────────────────── 边 ─────────────────────────

function endBox(d: Display, id: string): DisplayItem | undefined {
  return d.byId["F:" + id] ?? d.byId[id];
}

function structEdge(
  d: Display,
  e: DisplayEdge,
  opOf: (id: string) => number,
  dimOf: (id: string) => number,
  pre: string,
): string {
  const a = d.byId[e.from], b = d.byId[e.to];
  if (!a || !b) return "";
  const o = Math.min(opOf(e.from), opOf(e.to)) * Math.min(dimOf(a.nid), dimOf(b.nid));
  const op = o < 1 ? ` opacity="${num(o)}"` : "";
  if (e.kind === "tree") {
    // 父卡右缘 → 中线 → 子卡（或子框）左缘，直角
    const f = d.byId["F:" + e.to];
    const sx = a.x + a.w, sy = a.y + a.h / 2;
    const tx = f ? f.x : b.x, ty = b.y + b.h / 2;
    const mx = tx > sx ? sx + Math.min(28, (tx - sx) / 2) : sx + 16;
    return `<path d="M${num(sx)},${num(sy)}H${num(mx)}V${num(ty)}H${num(tx)}" fill="none" stroke="var(--border-strong)" stroke-width="1"${op}/>`;
  }
  // seq：先后线（上块底 → 下块顶；横向重叠时竖直直线，否则直角折线）
  const A = endBox(d, e.from) as DisplayItem, B = endBox(d, e.to) as DisplayItem;
  const lo = Math.max(A.x, B.x), hi = Math.min(A.x + A.w, B.x + B.w);
  const mk = ` marker-end="url(#${pre}m-seq)"`;
  if (B.y >= A.y + A.h) {
    if (hi - lo >= 16) {
      const x = lo + Math.min(24, (hi - lo) / 2);
      return `<path d="M${num(x)},${num(A.y + A.h)}V${num(B.y - 1)}" fill="none" stroke="var(--border-strong)" stroke-width="1"${mk}${op}/>`;
    }
    const sx = A.x + A.w / 2, tx = B.x + B.w / 2, my = (A.y + A.h + B.y) / 2;
    return `<path d="M${num(sx)},${num(A.y + A.h)}V${num(my)}H${num(tx)}V${num(B.y - 1)}" fill="none" stroke="var(--border-strong)" stroke-width="1"${mk}${op}/>`;
  }
  // 横向链
  const sy = A.y + A.h / 2, ty = B.y + B.h / 2;
  const right = B.x >= A.x + A.w;
  const sx = right ? A.x + A.w : A.x, tx = right ? B.x - 1 : B.x + B.w + 1;
  const mx = (sx + tx) / 2;
  return `<path d="M${num(sx)},${num(sy)}H${num(mx)}V${num(ty)}H${num(tx)}" fill="none" stroke="var(--border-strong)" stroke-width="1"${mk}${op}/>`;
}

function relEdgeSvg(e: RoutedEdge, o: number, pre: string, data: (k: string, v: string) => string): string {
  const s = REL_STYLE[e.code];
  const col = e.hot ? "a" : "n";
  const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : "";
  const ms = s.start ? ` marker-start="url(#${pre}m-${s.start}-${col})"` : "";
  const width = s.width + (e.hot ? 0.5 : 0) - (e.implicit ? 0.25 : 0);
  return (
    `<path d="${escapeXml(e.d ?? "")}"${data("edge-id", e.id)} fill="none" stroke="${e.hot ? "var(--accent)" : "var(--text-secondary)"}" stroke-width="${num(width)}"${dash}${ms}` +
    ` marker-end="url(#${pre}m-${s.end}-${col})"${o < 1 ? ` opacity="${num(o)}"` : ""}/>`
  );
}
