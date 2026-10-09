// 图表工具箱（数据页 v3 重设计）
//
// 与旧版 swiss.tsx 的根本区别——「按真实像素布局」：
//   旧版把图画在固定 viewBox（460×300 / 960×280）里再整体等比缩放：卡片宽了字跟着放大、窄了字跟着缩小，
//   文案位置全是写死的坐标，于是长标签/图注/图例必然顶出画框。
//   新版用 ResizeObserver 量出容器的真实宽度，所有图以 1 SVG 单位 = 1 CSS px 绘制：
//   字号恒定（11/12px），标签用 textW() 量过再放、放不下就 fit() 截断，标题/图例/脚注走 HTML 自动折行。
//   图元素颜色一律取自 theme.css 的 token（palette()），深浅色/皮肤自适应。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ───────────────────────── 配色 ─────────────────────────

export interface Pal {
  INK: string; PAPER: string; GREY1: string; GREY2: string; GREY3: string;
  TEXT2: string; GRID: string; AXIS: string; ACCENT: string;
  ON_DARK: string; ON_LIGHT: string;
  /** 类别色板：C[0] = 焦点色（随皮肤），C[1..5] = --chart-2..6（深浅色各一档，彼此明度接近） */
  C: string[];
}

const FALLBACK_C = ["#c98a2b", "#4b6cb7", "#c25b4a", "#7e5ba6", "#8a8f98"];

export function palette(): Pal {
  const cs = typeof document !== "undefined" ? getComputedStyle(document.body) : null;
  const v = (name: string, fb: string) => (cs && cs.getPropertyValue(name).trim()) || fb;
  const ACCENT = v("--accent", "#166a59");
  return {
    INK: v("--ink", "#0a0a0a"),
    PAPER: v("--paper", "#fafaf8"),
    GREY1: v("--grey-1", "#f0f0ee"),
    GREY2: v("--grey-2", "#d4d4d2"),
    GREY3: v("--grey-3", "#737373"),
    TEXT2: v("--text-secondary", "#525252"),
    GRID: v("--border-subtle", "#e0e0e0"),
    AXIS: v("--border-strong", "#a3a3a3"),
    ACCENT,
    ON_DARK: v("--overlay-text", "#f5f5f2"),
    ON_LIGHT: v("--overlay-ink", "#0a0a0a"),
    C: [ACCENT, ...FALLBACK_C.map((fb, i) => v(`--chart-${i + 2}`, fb))]
  };
}

function relLum(color: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return NaN;
  const n = m[1].length === 3 ? 1 : 2;
  const ch = (i: number) => parseInt(m[1].slice(i * n, (i + 1) * n).padEnd(2, m[1].slice(i * n, (i + 1) * n)), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(1)) + 0.0722 * lin(ch(2));
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** 色块内文字：按底色亮度在固定深/浅两色里挑对比更高的（底色不可解析时反白） */
export function textOn(bg: string, P: Pal): string {
  const l = relLum(bg);
  if (Number.isNaN(l)) return P.ON_DARK;
  return contrast(l, relLum(P.ON_DARK)) >= contrast(l, relLum(P.ON_LIGHT)) ? P.ON_DARK : P.ON_LIGHT;
}

// ───────────────────────── 文字测量 ─────────────────────────

let _ctx: CanvasRenderingContext2D | null | undefined;
let _family = "";
const _wCache = new Map<string, number>();

function measureCtx(): CanvasRenderingContext2D | null {
  if (_ctx !== undefined) return _ctx;
  _ctx = null;
  try {
    if (typeof document !== "undefined" && !/jsdom/i.test(navigator.userAgent)) {
      _ctx = document.createElement("canvas").getContext("2d");
      _family = getComputedStyle(document.body).fontFamily || "sans-serif";
    }
  } catch { _ctx = null; }
  return _ctx;
}

/** 无 canvas 时的估宽：CJK/全角 = 1em，数字 0.6em，大写 0.66em，其余 0.55em */
function estimateW(s: string, fs: number, weight: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x2e80 || (c >= 0x2010 && c <= 0x203a && c !== 0x2019)) w += 1;
    else if (c >= 48 && c <= 57) w += 0.6;
    else if (c >= 65 && c <= 90) w += 0.66;
    else if (c === 32) w += 0.3;
    else if (c === 46 || c === 44 || c === 58 || c === 105 || c === 108 || c === 124) w += 0.3;
    else w += 0.55;
  }
  return w * fs * (weight >= 600 ? 1.04 : 1);
}

export function textW(s: string, fs = 12, weight = 400): number {
  const key = `${fs}|${weight}|${s}`;
  const hit = _wCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = measureCtx();
  let w: number;
  if (ctx) {
    ctx.font = `${weight} ${fs}px ${_family}`;
    w = ctx.measureText(s).width;
  } else w = estimateW(s, fs, weight);
  if (_wCache.size > 4000) _wCache.clear();
  _wCache.set(key, w);
  return w;
}

/** 放不下就截断加省略号；maxW ≤ 0 返回空串 */
export function fit(s: string, maxW: number, fs = 12, weight = 400): string {
  if (maxW <= 0) return "";
  if (textW(s, fs, weight) <= maxW) return s;
  const chars = [...s];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textW(chars.slice(0, mid).join("") + "…", fs, weight) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : chars.slice(0, lo).join("") + "…";
}

// ───────────────────────── 数值 / 刻度 / 格式 ─────────────────────────

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

export function shortNum(n: number): string {
  if (n >= 100000) return `${Math.round(n / 10000)}万`;
  if (n >= 10000) return `${(Math.round(n / 1000) / 10).toFixed(1).replace(/\.0$/, "")}万`;
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "")}千`;
  return String(Math.round(n));
}

/** 向上取「好看」的数：1 / 2 / 2.5 / 5 / 10 × 10^k */
export function niceCeil(v: number, allowHalf = true): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : allowHalf && f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

/** 0..top 的等分刻度：步长取「好看」数，top = 刚好盖住 max 的步长整数倍（integer=true 时步长为整数） */
export function niceTicks(max: number, want = 4, integer = false): number[] {
  const raw = Math.max(max, integer ? 1 : 1e-9) / want;
  let step = niceCeil(raw, !integer);
  if (integer) step = Math.max(1, Math.ceil(step));
  const n = Math.max(1, Math.ceil(max / step - 1e-9));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(Math.round(i * step * 1000) / 1000);
  return out;
}

export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} 小时 ${mm} 分` : `${h} 小时`;
}

/** 分钟级时长：<1 分显示「不足 1 分」 */
export function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? "不足 1 分" : "0 分";
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

export const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];
export const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
export const mdw = (t: number) => `${md(t)} 周${WEEK_ZH[new Date(t).getDay()]}`;
export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 单调三次插值（Fritsch–Carlson）：平滑但不过冲，折线/面积用 */
export function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]} ${pts[0][1]}`;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h} ${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h} ${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]} ${pts[i + 1][1]}`;
  }
  return d;
}

// ───────────────────────── SVG 小元件 ─────────────────────────

export function Tx(p: {
  x: number; y: number; children: ReactNode; s?: number; w?: number; fill?: string;
  anchor?: "start" | "middle" | "end"; opacity?: number;
}) {
  return (
    <text x={p.x} y={p.y} fontSize={p.s ?? 11} fontWeight={p.w ?? 500} fill={p.fill ?? "currentColor"}
      textAnchor={p.anchor ?? "start"} opacity={p.opacity}>{p.children}</text>
  );
}

/** 横向网格线 + 左侧刻度字（y 轴）。baseline 画成轴色，其余发丝网格 */
export function YGrid({ ticks, y, x0, x1, P, fmt = fmtInt }: {
  ticks: number[]; y: (v: number) => number; x0: number; x1: number; P: Pal; fmt?: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={x0} x2={x1} y1={y(v)} y2={y(v)} stroke={i === 0 ? P.AXIS : P.GRID} strokeWidth={i === 0 ? 1 : 0.8} />
          <Tx x={x0 - 8} y={y(v) + 4} anchor="end" fill={P.GREY3}>{fmt(v)}</Tx>
        </g>
      ))}
    </g>
  );
}

// ───────────────────────── Chart 外框 ─────────────────────────

export interface LegendItem {
  label: string;
  color?: string;
  /** 空心（描边）色块 */
  hollow?: boolean;
  /** 5 档渐深色阶（热力图例）：label 忽略，两端文字用 from/to */
  ramp?: { from: string; to: string; color: string };
}

interface ChartProps {
  headline?: ReactNode;
  sub?: ReactNode;
  legend?: LegendItem[];
  foot?: ReactNode;
  height: number | ((w: number) => number);
  /** 用于 aria-label */
  label?: string;
  build: (w: number, P: Pal) => ReactNode;
  /** 容器宽度还没量出来时的占位高度 */
  minHeight?: number;
}

/** 响应式图表外框：量宽 → 以 1:1 像素绘制；HTML 标题/图例/脚注自动折行；自带悬浮提示（元素挂 data-tip，\n 分行） */
export function Chart({ headline, sub, legend, foot, height, label, build, minHeight }: ChartProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [tipW, setTipW] = useState(0);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setW(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => { if (tip && tipRef.current) setTipW(tipRef.current.offsetWidth); }, [tip]);
  useEffect(() => { setTip(null); }, [w]);

  const P = useMemo(() => palette(), [w, headline, sub]);
  const h = Math.ceil(typeof height === "function" ? height(Math.max(w, 1)) : height);

  const onMove = (e: React.MouseEvent) => {
    const t = (e.target as Element).closest?.("[data-tip]");
    const host = plotRef.current;
    if (!t || !host) { if (tip) setTip(null); return; }
    const r = host.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text: t.getAttribute("data-tip") || "" });
  };

  const left = tip ? Math.min(Math.max(tip.x, tipW / 2 + 4), Math.max(w - tipW / 2 - 4, tipW / 2 + 4)) : 0;
  const lines = tip ? tip.text.split("\n") : [];
  const ariaLabel = label ?? (typeof headline === "string" ? headline : undefined);

  return (
    <figure className="cx">
      {(headline || sub) && (
        <figcaption className="cx-head">
          {headline && <div className="cx-headline">{headline}</div>}
          {sub && <div className="cx-sub">{sub}</div>}
        </figcaption>
      )}
      {legend && legend.length > 0 && (
        <div className="cx-legend">
          {legend.map((it, i) =>
            it.ramp ? (
              <span className="cx-lg" key={i}>
                {it.ramp.from}
                {[0.18, 0.4, 0.62, 0.82, 1].map((o) => (
                  <i key={o} className="cx-lg-chip" style={{ background: it.ramp!.color, opacity: o }} />
                ))}
                {it.ramp.to}
              </span>
            ) : (
              <span className="cx-lg" key={i}>
                <i className="cx-lg-chip" style={it.hollow ? { border: `1.5px solid ${it.color}` } : { background: it.color }} />
                {it.label}
              </span>
            )
          )}
        </div>
      )}
      <div className="cx-plot" ref={plotRef} style={{ minHeight: w > 0 ? h : (minHeight ?? h) }} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
        {w > 0 && (
          <svg className="chart-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}
            {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})}>
            {build(w, P)}
          </svg>
        )}
        {tip && (
          <div className="cx-tip" ref={tipRef} style={{ left, top: tip.y }}>
            {lines.map((l, i) => (i === 0 ? <b key={i}>{l}</b> : <span key={i}>{l}</span>))}
          </div>
        )}
      </div>
      {foot && <div className="cx-foot">{foot}</div>}
    </figure>
  );
}

/** 空态：占位高度内居中一句话，不画假轴/假数据 */
export function Empty({ msg, height = 160 }: { msg: string; height?: number }) {
  return (
    <figure className="cx">
      <div className="cx-empty" style={{ height }}>{msg}</div>
    </figure>
  );
}
