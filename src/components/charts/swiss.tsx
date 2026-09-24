// 统计图表渲染器 — 瑞士国际主义风格，从零实现（原创代码，无模板来源）
// 视觉契约：一切直角、0.7px 发丝线、灰阶明度即数据、单一焦点色 --accent、
// "越大越细越小越粗"、SVG 文字 ≥11px、数字语义用等宽、颜色全部走 theme.css token（深浅色自适应）。
// 每个渲染器：纯函数，输入 overview 数据 → { viewBox, els }，由 ChartSvg 统一挂载。
import { createElement, type ReactNode } from "react";
import { udcLabel, UDC_MAIN } from "../../lib/udc";

// 主题色：从 CSS 变量实时取值（随深浅色切换自动更新）
function palette() {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    INK: v("--ink", "#0a0a0a"),
    PAPER: v("--paper", "#fafaf8"),
    GREY1: v("--grey-1", "#f0f0ee"),
    GREY2: v("--grey-2", "#d4d4d2"),
    GREY3: v("--grey-3", "#737373"),
    GRID: v("--border-subtle", "#e0e0e0"),
    ACCENT: v("--accent", "#002fa7"),
    SOFT: v("--accent-soft", "rgba(0,47,167,.08)"),
    /* 固定深/浅色：不随主题反转（:root 里的 --overlay-* 一档）。
       段内文字必须在任何主题下都与其底色反向，用会反转的 --ink/--paper 会算错。 */
    ON_DARK: v("--overlay-text", "#f5f5f2"),
    ON_LIGHT: v("--overlay-ink", "#0a0a0a")
  };
}

/* 段内/块内文字取色：按底色实际亮度，选与它对比更高的那一个固定色。
   原实现把反白硬编码成 "#ffffff"，而 --ink / --accent 在深色模式会提亮翻转，
   导致「遗忘 Again」等百分比标签压在近白底上不可见（深色下 ≈1.05:1）。
   本函数在浅色模式下的判定与原硬编码逐点一致，只修深色。 */
function relLum(color: string): number {
  const h = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return NaN; // 非 hex（rgba() / var() 等）→ 交回调用方保守处理
  const n = m[1].length === 3 ? 1 : 2;
  const chan = (i: number) => parseInt(h.slice(1 + i * n, 1 + (i + 1) * n), 16) / (n === 1 ? 15 : 255);
  const toLin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * toLin(chan(0)) + 0.7152 * toLin(chan(1)) + 0.0722 * toLin(chan(2));
}
function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
function textOn(bg: string, P: ReturnType<typeof palette>): string {
  const l = relLum(bg);
  if (Number.isNaN(l)) return P.ON_DARK; // 底色不可解析时退回原硬编码行为（反白）
  return contrast(l, relLum(P.ON_DARK)) >= contrast(l, relLum(P.ON_LIGHT)) ? P.ON_DARK : P.ON_LIGHT;
}

export type El = { tag: string; attrs: Record<string, string | number>; text?: string; title?: string };
type Box = { viewBox: string; els: El[] };

// 通用小工具 ────────────────────────────────────────────────
const T = (x: number, y: number, s: string, o: Record<string, string | number> = {}): El =>
  ({ tag: "text", attrs: { x, y, fontSize: 11, fill: "currentColor", ...o }, text: s });
const L = (x1: number, y1: number, x2: number, y2: number, stroke: string, w = 0.7, extra: Record<string, string | number> = {}): El =>
  ({ tag: "line", attrs: { x1, y1, x2, y2, stroke, strokeWidth: w, ...extra } });
const R = (x: number, y: number, w: number, h: number, fill: string, extra: Record<string, string | number> = {}): El =>
  ({ tag: "rect", attrs: { x, y, width: w, height: h, fill, ...extra } });
const fmt = (n: number) => n.toLocaleString("en-US");
const empty = (msg: string, w = 460, h = 300): Box => ({
  viewBox: `0 0 ${w} ${h}`,
  els: [T(w / 2, h / 2, msg, { textAnchor: "middle", fontWeight: 600, fill: "var(--text-helper)" })]
});
// 明度阶梯：按排名取灰（0 = 最重）。hero 位用焦点色。
function ladderShade(P: ReturnType<typeof palette>, rank: number, hero = true): string {
  if (hero && rank === 0) return P.ACCENT;
  return [P.INK, P.GREY3, P.GREY2, P.GREY2, P.GREY2][Math.min(rank, 4)] || P.GREY2;
}
// 把 "5千2" 类大数缩写为短标签
function shortNum(n: number): string {
  if (n >= 10000) return (Math.round(n / 1000) / 10).toFixed(1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "") + "千";
  return String(n);
}
const md = (t: number) => new Date(t);
const dayLabel = (t: number) => `${md(t).getMonth() + 1}/${md(t).getDate()}`;

// ══════════════════════ A. 关键指标（拆三图） ══════════════════════

// A1 队列构成 — 单条组成横条：完成段（焦点色）+ 未完成段（浅灰），上承发丝标尺
export function chartQueueBar(kpi: { completedToday: number; dueToday: number }): Box {
  const P = palette();
  const due = Math.max(kpi.dueToday, 0);
  if (!due) return empty("今日队列已清空 — 无到期卡片", 460, 170);
  const done = Math.min(kpi.completedToday, due);
  const left = due - done;
  const X0 = 20, W = 420, Y = 74, H = 26;
  const wDone = (done / due) * W;
  const els: El[] = [];
  // 标尺（0/50%/100% 刻度在条上方）
  els.push(L(X0, Y - 14, X0 + W, Y - 14, P.GRID));
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const x = X0 + f * W;
    els.push(L(x, Y - 14, x, Y - 9, P.GRID));
    els.push(T(x, Y - 20, `${Math.round(f * 100)}`, { textAnchor: f === 0 ? "start" : f === 1 ? "end" : "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  els.push(T(X0 + W, Y - 32, "%", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  // 组成条
  if (done > 0) els.push({ ...R(X0, Y, wDone, H, P.ACCENT), title: `已完成 ${done} 张` });
  if (left > 0) els.push({ ...R(X0 + wDone, Y, W - wDone, H, P.GREY2), title: `未完成 ${left} 张` });
  // 段上数值
  if (wDone > 34) els.push(T(X0 + wDone / 2, Y + H / 2 + 4, `${done}`, { textAnchor: "middle", fontWeight: 700, fill: textOn(P.ACCENT, P), fontSize: 12 }));
  if (W - wDone > 34) els.push(T(X0 + wDone + (W - wDone) / 2, Y + H / 2 + 4, `${left}`, { textAnchor: "middle", fontWeight: 700, fill: P.INK, fontSize: 12 }));
  // 图例
  els.push(R(X0, Y + H + 16, 10, 10, P.ACCENT));
  els.push(T(X0 + 16, Y + H + 25, `已完成 ${done} 张`, { fontWeight: 600 }));
  els.push(R(X0 + 110, Y + H + 16, 10, 10, P.GREY2));
  els.push(T(X0 + 126, Y + H + 25, `未完成 ${left} 张`, { fontWeight: 600, fill: P.GREY3 }));
  els.push(T(X0 + W, Y + H + 25, `今日到期 ${due} 张`, { textAnchor: "end", fontWeight: 700 }));
  return { viewBox: "0 0 460 170", els };
}

// A2 连续学习 — 里程碑标尺：一条横轨填到 streak，7/14/30/60/100 天立旗标
export function chartStreakRuler(streak: number): Box {
  const P = palette();
  const MILES = [7, 14, 30, 60, 100];
  const top = MILES.find((m) => m > streak) ?? Math.ceil((streak + 10) / 50) * 50;
  const X0 = 20, W = 420, Y = 96;
  const xOf = (d: number) => X0 + (d / top) * W;
  const els: El[] = [];
  // 大数字
  els.push(T(X0, 40, `${streak}`, { fontSize: 44, fontWeight: 200, letterSpacing: "-0.02em" }));
  els.push(T(X0 + (streak >= 100 ? 108 : streak >= 10 ? 62 : 34), 40, "天", { fontSize: 14, fontWeight: 400, fill: P.GREY3 }));
  els.push(T(X0 + W, 38, "连续学习", { textAnchor: "end", fontWeight: 600, fill: P.GREY3 }));
  els.push(T(X0 + W, 54, `下一里程碑 ${top} 天 · 还差 ${top - streak} 天`, { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  // 轨道
  els.push(L(X0, Y, X0 + W, Y, P.GREY2, 2));
  els.push(L(X0, Y, xOf(streak), Y, P.ACCENT, 2));
  // 刻度：量程容得下就逐日一刺（图注「一格 = 一天」才成立）；
  // 否则退回 1/14 等分，并把图注改成实际的天数跨度。
  // 原实现恒按 1/14 画刺却把图注写死成「一格 = 一天」——只有 top=14 时才对，
  // streak≤6 → top=7（一格 0.5 天）、streak 14–29 → top=30（一格 ≈2.1 天）、
  // streak≥100 → top=150（一格 ≈10.7 天），属于读数失真。
  const perDay = top <= 31;
  const tickCount = perDay ? top : 14;
  for (let k = 0; k <= tickCount; k++) {
    const x = X0 + (k / tickCount) * W;
    els.push(L(x, Y + 4, x, Y + (k % 7 === 0 ? 9 : 6), P.GREY2, 0.7));
  }
  // 里程碑旗标
  MILES.filter((m) => m <= top).forEach((m) => {
    const x = xOf(m), reached = streak >= m;
    els.push(L(x, Y - 16, x, Y + 16, reached ? P.ACCENT : P.GREY2, 0.9));
    els.push({ ...R(x - 3, Y - 26, 6, 6, reached ? P.ACCENT : P.GREY2), title: `${m} 天里程碑` });
    els.push(T(x, Y + 30, `${m}`, { textAnchor: "middle", fontWeight: 700, fill: reached ? P.INK : P.GREY3 }));
  });
  els.push(T(X0 + W / 2, 152, `${perDay ? "一格 = 一天" : `一格 ≈ ${(top / 14).toFixed(1)} 天`} · 蓝旗 = 已达成里程碑`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 170", els };
}

// A3 今日时长 — 点带分布：近 30 天每日学习分钟数摊在一条轴上，今天用方块标出
export function chartMinutesStrip(kpi: { minutesToday: number }, heatDays: { date: number; minutes: number }[]): Box {
  const P = palette();
  const tail = heatDays.slice(-30).filter((d) => d.date > 0);
  if (!tail.length) return empty("暂无学习时长记录", 460, 170);
  const X0 = 20, W = 420, Y = 92;
  const vmax = Math.max(5, ...tail.map((d) => d.minutes), kpi.minutesToday);
  const xOf = (v: number) => X0 + (Math.min(v, vmax) / vmax) * W;
  const els: El[] = [];
  // 轴
  els.push(L(X0, Y, X0 + W, Y, P.GRID));
  const step = vmax > 120 ? 60 : vmax > 50 ? 30 : 15;
  for (let v = 0; v <= vmax; v += step) {
    els.push(L(xOf(v), Y, xOf(v), Y - 5, P.GRID));
    els.push(T(xOf(v), Y + 16, `${v}分`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  // 历史日：空心圆点，抖动两行避免完全重叠
  tail.forEach((d, i) => {
    const dy = i % 2 === 0 ? -7 : 7;
    const isToday = i === tail.length - 1;
    if (isToday) {
      els.push({ ...R(xOf(d.minutes) - 5, Y - 5, 10, 10, P.ACCENT), title: `今天 — ${d.minutes} 分钟` });
    } else if (d.minutes > 0) {
      els.push({
        tag: "circle",
        attrs: { cx: xOf(d.minutes), cy: Y + dy, r: 3.4, fill: P.PAPER, stroke: P.GREY3, strokeWidth: 1.2 },
        title: `${dayLabel(d.date)} — ${d.minutes} 分钟`
      });
    }
  });
  // 中位数刺针
  const sorted = tail.map((d) => d.minutes).filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length) {
    const med = sorted[Math.floor(sorted.length / 2)];
    els.push(L(xOf(med), Y - 22, xOf(med), Y + 8, P.INK, 1, { strokeDasharray: "3 3" }));
    els.push(T(xOf(med) + 5, Y - 26, `中位 ${med}分`, { fontSize: 11, fontWeight: 700, fill: P.INK }));
  }
  // 今日读数
  els.push(T(X0, 34, `${kpi.minutesToday}`, { fontSize: 44, fontWeight: 200, letterSpacing: "-0.02em" }));
  els.push(T(X0 + (kpi.minutesToday >= 100 ? 108 : kpi.minutesToday >= 10 ? 62 : 34), 34, "分钟", { fontSize: 14, fontWeight: 400, fill: P.GREY3 }));
  els.push(T(X0 + W, 32, "今日学习时长", { textAnchor: "end", fontWeight: 600, fill: P.GREY3 }));
  els.push(T(X0 + W, 48, "对照近 30 天分布", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  els.push(T(X0 + W / 2, 152, "一空心点 = 过去一天 · 蓝方块 = 今天 · 虚线 = 中位", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 170", els };
}

// ══════════════════════ B. 学习热力（heatDays） ══════════════════════

// ─── 学习热力四图共用画框：960×280 · 基线 y=226 · 刻度行 y=246 · 图注行 y=266 · 内容 x∈[52,940] ───

// B1 日柱 — 白（周末空心）/ 墨（平日）/ 焦点色（前三高峰柱）
export function chartDailyColumns(days: { date: number; count: number }[]): Box {
  const P = palette();
  const tail = days.slice(-182);
  if (!tail.length || tail.every((d) => d.count === 0)) return empty("所选范围暂无复习记录", 960, 280);
  const W = 960, X0 = 52, X1 = 940, BASE = 226, TOP = 52;
  const vmax = Math.max(...tail.map((d) => d.count));
  const pitch = (X1 - X0) / tail.length;
  const bw = Math.max(2, Math.min(24, pitch - Math.max(2.4, pitch * 0.28)));
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const y = BASE - (k / 2) * (BASE - TOP);
    els.push(L(X0, y, X1, y, P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(X0 - 8, y + 4, String(Math.round((vmax * k) / 2)), { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  const vs = tail.map((d) => d.count);
  const topIdx: number[] = [];
  for (const i of [...vs.keys()].sort((a, b) => vs[b] - vs[a])) {
    if (vs[i] <= 0) break; // 降序排列，遇到零即全为零
    if (topIdx.every((t) => Math.abs(t - i) >= 6)) topIdx.push(i);
    if (topIdx.length === 3) break;
  }
  tail.forEach((d, i) => {
    const x = X0 + i * pitch + (pitch - bw) / 2;
    const h = (d.count / vmax) * (BASE - TOP);
    const peak = topIdx.includes(i);
    const weekend = [0, 6].includes(md(d.date).getDay());
    if (d.count > 0) {
      const hollow = weekend && !peak;
      els.push({
        ...(hollow ? R(x, BASE - h, bw, h, P.PAPER, { stroke: P.GREY3, strokeWidth: 1 }) : R(x, BASE - h, bw, h, peak ? P.ACCENT : P.INK)),
        title: `${dayLabel(d.date)} — ${d.count} 张`
      });
    } else {
      els.push(L(x + bw / 2, BASE, x + bw / 2, BASE - 3, P.GREY2, 1));
    }
    if (peak) els.push(T(x + bw / 2, BASE - h - 8, String(d.count), { textAnchor: "middle", fontWeight: 700, fill: P.ACCENT }));
  });
  // x 刻度：≤45 天标 3 个日期，更长标每月首日
  if (tail.length <= 45) {
    [0, Math.floor(tail.length / 2), tail.length - 1].forEach((i, k) => {
      const x = X0 + i * pitch + pitch / 2;
      els.push(T(x, 246, dayLabel(tail[i].date), { textAnchor: k === 0 ? "start" : k === 2 ? "end" : "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
    });
  } else {
    let lastM = -1;
    tail.forEach((d, i) => {
      const m = md(d.date).getMonth();
      if (m !== lastM) {
        lastM = m;
        const x = X0 + i * pitch + pitch / 2;
        els.push(L(x, BASE, x, BASE + 6, P.GREY2, 0.8));
        els.push(T(x, 246, `${m + 1}月`, { fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
      }
    });
  }
  els.push(T(X1, 266, "一柱 = 一天 · 空心 = 周末 · 蓝 = 高峰日", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: `0 0 ${W} 280`, els };
}

// B2 累计阶梯 — 所选范围累计张数阶梯线，与日柱共用画框
export function chartCumulativeStep(days: { date: number; count: number }[]): Box {
  const P = palette();
  const tail = days.slice(-182);
  if (!tail.length || tail.every((d) => d.count === 0)) return empty("所选范围暂无复习记录", 960, 280);
  const X0 = 52, X1 = 940, BASE = 226, TOP = 52;
  const cum: number[] = [];
  let acc = 0;
  for (const d of tail) { acc += d.count; cum.push(acc); }
  const vmax = cum[cum.length - 1];
  const xOf = (i: number) => X0 + (i / (tail.length - 1)) * (X1 - X0);
  const yOf = (v: number) => BASE - (v / vmax) * (BASE - TOP);
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const v = Math.round((vmax * k) / 2);
    els.push(L(X0, yOf(v), X1, yOf(v), P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(X0 - 8, yOf(v) + 4, shortNum(v), { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  // 阶梯 path（step-after）+ 轻面积
  let dPath = `M${xOf(0)} ${BASE}`;
  cum.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    dPath += ` L${x} ${y}`;
    if (i < cum.length - 1) dPath += ` L${xOf(i + 1)} ${y}`;
  });
  dPath += ` L${xOf(cum.length - 1)} ${BASE} Z`;
  els.push({ tag: "path", attrs: { d: dPath, fill: P.SOFT, stroke: "none" } });
  let dLine = "";
  cum.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    dLine += (i === 0 ? `M${x} ${y}` : ` L${x} ${y}`);
    if (i < cum.length - 1) dLine += ` L${x} ${y}`;
  });
  els.push({ tag: "path", attrs: { d: dLine, fill: "none", stroke: P.ACCENT, strokeWidth: 1.6 } });
  const lastX = xOf(cum.length - 1), lastY = yOf(vmax);
  els.push({ ...R(lastX - 4, lastY - 4, 8, 8, P.ACCENT), title: `累计 ${fmt(vmax)} 张` });
  els.push(T(lastX - 6, lastY - 10, `累计 ${shortNum(vmax)} 张`, { textAnchor: "end", fontSize: 12, fontWeight: 700, fill: P.ACCENT }));
  [0, Math.floor(tail.length / 2), tail.length - 1].forEach((i, k) => {
    els.push(T(xOf(i), 246, dayLabel(tail[i].date), { textAnchor: k === 0 ? "start" : k === 2 ? "end" : "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  els.push(T(X1, 266, `近 ${tail.length} 天累计 ${fmt(vmax)} 张 · 阶梯只上不降`, { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 280", els };
}

// B3 星期剖面 — 所选范围内各星期几的平均日复习量，7 根实心横条（宽卡画框）
export function chartWeekdayProfile(days: { date: number; count: number }[]): Box {
  const P = palette();
  const tail = days.slice(-182);
  if (!tail.length || tail.every((d) => d.count === 0)) return empty("所选范围暂无复习记录", 960, 280);
  const DAY = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const sum = Array(7).fill(0), n = Array(7).fill(0);
  for (const d of tail) { const w = (md(d.date).getDay() + 6) % 7; sum[w] += d.count; n[w]++; }
  const avg = sum.map((s, i) => (n[i] ? s / n[i] : 0));
  const vmax = Math.max(...avg, 0.5);
  const best = avg.indexOf(Math.max(...avg));
  const X0 = 72, X1 = 900, rowH = 24, Y0 = 56;
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const x = X0 + (k / 2) * (X1 - X0);
    els.push(L(x, Y0 - 8, x, 228, P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(x, Y0 - 14, (Math.round((vmax * k) / 2 * 10) / 10).toString(), { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  DAY.forEach((lab, i) => {
    const y = Y0 + i * rowH;
    const w = (avg[i] / vmax) * (X1 - X0);
    els.push(T(X0 - 12, y + rowH / 2 + 4, lab, { textAnchor: "end", fontWeight: i === best ? 700 : 600, fill: i === best ? P.INK : P.GREY3 }));
    if (avg[i] > 0.05) {
      els.push({ ...R(X0, y + 5, Math.max(w, 2), 14, i === best ? P.ACCENT : P.INK), title: `${lab} 平均 ${avg[i].toFixed(1)} 张/日` });
      els.push(T(X0 + Math.max(w, 2) + 8, y + rowH / 2 + 4, avg[i].toFixed(1), { fontWeight: 700, fill: i === best ? P.ACCENT : P.INK }));
    } else {
      els.push(T(X0 + 8, y + rowH / 2 + 4, "无记录", { fontWeight: 600, fill: P.GREY2 }));
    }
  });
  els.push(T(940, 266, "条长 = 该星期几的日均张数 · 蓝 = 最勤的一天", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 280", els };
}

// B4 月面板 — 按所选范围逐月小面板：面板均分整行宽度，范围越小单面板越宽、柱越宽
export function chartMonthMultiples(days: { date: number; count: number }[]): Box {
  const P = palette();
  const tail = days.slice(-182);
  if (!tail.length || tail.every((d) => d.count === 0)) return empty("所选范围暂无复习记录", 960, 280);
  const byMonth = new Map<string, { date: number; count: number }[]>();
  for (const d of tail) {
    const dt = md(d.date);
    const k = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(d);
  }
  const months = [...byMonth.entries()].slice(-6);
  const vmax = Math.max(...tail.map((d) => d.count));
  const GAP = 10;
  const PW = ((940 - 52) - (months.length - 1) * GAP) / months.length; // 均分整行，总宽恒定
  const startX = 52;
  const BASE = 226, hMax = 166;
  const els: El[] = [];
  let hero = 0, heroSum = -1;
  months.forEach(([, arr], i) => { const s = arr.reduce((a, d) => a + d.count, 0); if (s > heroSum) { heroSum = s; hero = i; } });
  months.forEach(([k, arr], i) => {
    const ox = startX + i * (PW + GAP);
    const [, m] = k.split("-").map(Number);
    els.push(T(ox, 42, `${m + 1}月`, { fontSize: 12, fontWeight: i === hero ? 700 : 600, fill: i === hero ? P.ACCENT : P.GREY3 }));
    els.push(L(ox, BASE, ox + PW, BASE, P.GRID, 0.8));
    const pitch = PW / Math.max(arr.length, 28);
    const barW = Math.max(1.4, Math.min(18, pitch - 1.6));
    arr.forEach((d, j) => {
      const x = ox + j * pitch + (pitch - barW) / 2;
      if (d.count > 0) {
        const h = Math.max(1.5, (d.count / vmax) * hMax);
        els.push({ ...R(x, BASE - h, barW, h, i === hero ? P.ACCENT : P.INK), title: `${dayLabel(d.date)} — ${d.count} 张` });
      } else {
        els.push(L(x + barW / 2, BASE, x + barW / 2, BASE - 2.5, P.GREY2, 1));
      }
    });
    const s = arr.reduce((a, d) => a + d.count, 0);
    els.push(T(ox, 246, `${s} 张`, { fontSize: 11, fontWeight: 700, fill: i === hero ? P.ACCENT : P.INK }));
  });
  els.push(T(940, 266, "一格 = 一个月 · 一细柱 = 一天 · 蓝 = 当月总量最高", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 280", els };
}

// ══════════════════════ C. 今日完成度（kpi） ══════════════════════

// C1 分段单位竖柱 — 一方块 = 一张卡，自下而上垒；超过 40 张按比例折算
export function chartUnitColumn(kpi: { completedToday: number; dueToday: number }): Box {
  const P = palette();
  const due = kpi.dueToday, done = Math.min(kpi.completedToday, due);
  if (!due) return empty("今日队列已清空 — 无到期卡片", 460, 300);
  const UNIT = due > 40 ? Math.ceil(due / 40) : 1;
  const blocks = Math.ceil(due / UNIT);
  const doneBlocks = Math.round(done / UNIT);
  const S = 14, GAP = 5, pitch = S + GAP;
  const perCol = Math.min(blocks, Math.floor(190 / pitch));
  const cols = Math.ceil(blocks / perCol);
  const X0 = 60, baseY = 256;
  const els: El[] = [];
  for (let b = 0; b < blocks; b++) {
    const col = Math.floor(b / perCol);
    const row = b % perCol;
    const x = X0 + col * pitch;
    const y = baseY - (row + 1) * pitch + GAP;
    const isDone = b < doneBlocks;
    els.push({
      ...(R(x, y, S, S, isDone ? P.ACCENT : P.GREY2)),
      title: isDone ? `已完成（${UNIT} 张/块）` : `未完成（${UNIT} 张/块）`
    });
  }
  // 基线与标注
  els.push(L(X0 - 6, baseY + 2, X0 + cols * pitch, baseY + 2, P.GRID, 0.9));
  els.push(T(X0, 36, `${done}`, { fontSize: 44, fontWeight: 200, fill: P.ACCENT, letterSpacing: "-0.02em" }));
  els.push(T(X0 + (done >= 100 ? 108 : done >= 10 ? 62 : 34), 36, `/ ${due} 张`, { fontSize: 14, fontWeight: 400, fill: P.GREY3 }));
  els.push(T(460 - 20, 34, "已完成 / 今日到期", { textAnchor: "end", fontWeight: 600, fill: P.GREY3 }));
  els.push(T(460 - 20, 54, `还剩 ${due - done} 张`, { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  els.push(T(230, 292, UNIT === 1 ? "一方块 = 一张卡 · 蓝 = 已完成" : `一方块 = ${UNIT} 张卡 · 蓝 = 已完成`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// C2 双向发散条 — 中轴左"已完成"、右"未完成"，一眼看配速
export function chartDivergingPair(kpi: { completedToday: number; dueToday: number }): Box {
  const P = palette();
  const due = kpi.dueToday, done = Math.min(kpi.completedToday, due);
  if (!due) return empty("今日队列已清空 — 无到期卡片", 460, 300);
  const left = due - done;
  const CX = 230, Y = 128, H = 30, Wmax = 170;
  const wDone = (done / due) * Wmax, wLeft = (left / due) * Wmax;
  const els: El[] = [];
  els.push(L(CX, Y - 42, CX, Y + H + 18, P.GRID, 0.9, { strokeDasharray: "3 3" }));
  els.push({ ...R(CX - wDone, Y, wDone, H, P.ACCENT), title: `已完成 ${done} 张` });
  els.push({ ...R(CX, Y, wLeft, H, P.GREY2), title: `未完成 ${left} 张` });
  els.push(T(CX - wDone / 2, Y + H / 2 + 4, `${done}`, { textAnchor: "middle", fontWeight: 700, fill: textOn(P.ACCENT, P), fontSize: 13 }));
  els.push(T(CX + wLeft / 2, Y + H / 2 + 4, `${left}`, { textAnchor: "middle", fontWeight: 700, fontSize: 13 }));
  els.push(T(CX - wDone / 2, Y - 12, "已完成", { textAnchor: "middle", fontWeight: 600, fill: P.ACCENT }));
  els.push(T(CX + wLeft / 2, Y - 12, "未完成", { textAnchor: "middle", fontWeight: 600, fill: P.GREY3 }));
  els.push(T(CX, Y + H + 36, `配速 ${due ? Math.round((done / due) * 100) : 0}%`, { textAnchor: "middle", fontWeight: 700, fontSize: 13 }));
  els.push(T(230, 52, "今日到期 " + due + " 张", { textAnchor: "middle", fontSize: 13, fontWeight: 600 }));
  els.push(T(230, 292, "左蓝 = 已完成 · 右灰 = 未完成 · 中轴虚线 = 分界", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ D. 领域分布 ══════════════════════

// D1 点图（克利夫兰）— 每行一个领域，方块落在共享数值轴上
export function chartDomainDots(items: { label: string; count: number }[], unit: string): Box {
  const P = palette();
  const D = items.slice(0, 9);
  if (!D.length) return empty("暂无分类数据 — 新制卡将自动带 UDC 领域", 460, 300);
  const X0 = 116, X1 = 400, rowH = Math.min(30, 226 / D.length), Y0 = 44;
  const vmax = D[0].count || 1;
  const xOf = (v: number) => X0 + (v / vmax) * (X1 - X0);
  const els: El[] = [];
  // 顶部数值刻度
  [0, 0.5, 1].forEach((f) => {
    const x = X0 + f * (X1 - X0);
    els.push(L(x, Y0 - 14, x, Y0 - 8, P.GRID));
    els.push(T(x, Y0 - 20, String(Math.round(vmax * f)), { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  D.forEach((d, i) => {
    const y = Y0 + i * rowH + rowH / 2;
    els.push(T(X0 - 10, y + 4, d.label.length <= 6 ? d.label : d.label.slice(0, 5) + "…", { textAnchor: "end", fontWeight: i === 0 ? 700 : 600, fill: i === 0 ? P.INK : P.GREY3 }));
    els.push(L(X0, y, X1, y, P.GRID, 0.6));
    els.push({ ...R(xOf(d.count) - 5, y - 5, 10, 10, ladderShade(P, i)), title: `${d.label} — ${d.count} ${unit}` });
    els.push(T(X1 + 12, y + 4, String(d.count), { fontWeight: 700, fill: i === 0 ? P.ACCENT : P.INK }));
  });
  els.push(T(230, 292, `一方块 = 按 ${unit} 数对齐 · 越靠右越多`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// D2 矩形树图 — 面积 = 卡量，二分割递归切分，第一名焦点色
export function chartDomainTreemap(items: { label: string; count: number }[], unit: string): Box {
  const P = palette();
  const D = items.slice(0, 9);
  if (!D.length) return empty("暂无分类数据", 460, 300);
  const total = D.reduce((a, d) => a + d.count, 0);
  if (!total) return empty("暂无分类数据", 460, 300);
  const W = 460, H = 300, X0 = 16, Y0 = 34, GW = W - 32, GH = H - Y0 - 40;
  type Rect = { x: number; y: number; w: number; h: number; item: (typeof D)[number]; rank: number };
  const rects: Rect[] = [];
  const split = (arr: typeof D, r: { x: number; y: number; w: number; h: number }, base: number, vertical: boolean) => {
    if (!arr.length) return;
    if (arr.length === 1) { rects.push({ ...r, item: arr[0], rank: base }); return; }
    const half = Math.ceil(arr.length / 2);
    const a = arr.slice(0, half), b = arr.slice(half);
    const sa = a.reduce((s, d) => s + d.count, 0), st = sa + b.reduce((s, d) => s + d.count, 0);
    const f = sa / st;
    if (vertical) {
      split(a, { x: r.x, y: r.y, w: r.w * f, h: r.h }, base, !vertical);
      split(b, { x: r.x + r.w * f, y: r.y, w: r.w * (1 - f), h: r.h }, base + half, !vertical);
    } else {
      split(a, { x: r.x, y: r.y, w: r.w, h: r.h * f }, base, !vertical);
      split(b, { x: r.x, y: r.y + r.h * f, w: r.w, h: r.h * (1 - f) }, base + half, !vertical);
    }
  };
  split([...D].sort((x, y) => y.count - x.count), { x: X0, y: Y0, w: GW, h: GH }, 0, true);
  const els: El[] = [];
  rects.forEach((rc) => {
    const pad = 1;
    const fill = ladderShade(P, rc.rank);
    els.push({
      ...R(rc.x + pad, rc.y + pad, Math.max(rc.w - 2 * pad, 1), Math.max(rc.h - 2 * pad, 1), fill, rc.rank === 0 ? {} : { fillOpacity: rc.rank <= 1 ? 0.85 : rc.rank <= 3 ? 0.6 : 0.35 }),
      title: `${rc.item.label} — ${rc.item.count} ${unit}（${Math.round((rc.item.count / total) * 100)}%）`
    });
    const wide = rc.w > 64 && rc.h > 40;
    if (wide) {
      const onAccent = rc.rank === 0;
      const on = textOn(fill, P);
      els.push(T(rc.x + 10, rc.y + 22, rc.item.label.length <= 5 ? rc.item.label : rc.item.label.slice(0, 4) + "…", { fontSize: 12, fontWeight: 700, fill: onAccent ? on : P.INK }));
      els.push(T(rc.x + 10, rc.y + 38, `${Math.round((rc.item.count / total) * 100)}%`, { fontSize: 11, fontWeight: 600, fill: onAccent ? on : P.GREY3 }));
    }
  });
  els.push(T(230, 292, `面积 = ${unit}数 · 面积越大占比越高`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: `0 0 ${W} ${H}`, els };
}

// ══════════════════════ E. 评分构成 ══════════════════════

// E1 百分比单柱 — 一根竖柱自上而下 轻松→通过→吃力→遗忘，图例同序，整体水平居中
export function chartRatingColumn(ratings: { rating: string; count: number }[]): Box {
  const P = palette();
  const total = ratings.reduce((a, r) => a + r.count, 0);
  if (!total) return empty("近 30 天暂无复习记录", 460, 300);
  const ORDER = ["Again", "Hard", "Good", "Easy"]; // 自下而上
  const ZH: Record<string, string> = { Again: "遗忘 Again", Hard: "吃力 Hard", Good: "通过 Good", Easy: "轻松 Easy" };
  const D = ORDER.map((name) => ({ name, pct: ((ratings.find((r) => r.rating === name)?.count || 0) / total) * 100 }));
  // Again = 墨黑（最需警惕），Good = 焦点色（主旋律）
  const SHADE = [P.INK, P.GREY3, P.ACCENT, P.GREY2];
  // 水平居中：柱 + 间距 + 图例整组落在卡片中轴上
  const CX = 135, W = 40, Y0 = 48, H = 190;
  const LEG_X = 235, LEG_Y0 = 76;
  const els: El[] = [];
  let y = Y0 + H;
  D.forEach((d, i) => {
    const h = (d.pct / 100) * H;
    y -= h;
    if (h > 0.5) els.push({ ...R(CX, y, W, h, SHADE[i]), title: `${ZH[d.name]} ${d.pct.toFixed(1)}%` });
    // D-TEST-81：柱内标签原来用 Math.round(d.pct)，而同一段的悬浮值（上一行）与右侧图例（下方）
    // 用 d.pct.toFixed(1) —— 同一张图里同一个量出现两种精度（67% 与 67.4% 并存），用户会以为
    // 是两个不同的量。统一到 toFixed(1)。
    if (h > 22) els.push(T(CX + W / 2, y + h / 2 + 4, `${d.pct.toFixed(1)}%`, { textAnchor: "middle", fontWeight: 700, fontSize: 12, fill: textOn(SHADE[i], P) }));
  });
  els.push(L(CX - 8, Y0 + H + 2, CX + W + 8, Y0 + H + 2, P.GRID, 0.9));
  els.push(T(CX + W / 2, Y0 + H + 20, "近 30 天", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  // 图例自上而下与柱段同序（轻松→通过→吃力→遗忘），垂直居中对齐柱身
  for (let i = D.length - 1; i >= 0; i--) {
    const d = D[i];
    const ly = LEG_Y0 + (D.length - 1 - i) * 40;
    els.push(R(LEG_X, ly - 9, 12, 12, SHADE[i]));
    els.push(T(LEG_X + 20, ly + 2, ZH[d.name], { fontWeight: 600 }));
    els.push(T(LEG_X + 20, ly + 18, `${d.pct.toFixed(1)}%`, { fontSize: 13, fontWeight: 700, fill: SHADE[i] === P.ACCENT ? P.ACCENT : P.INK }));
  }
  els.push(T(230, 292, "柱段 = 各评分占比 · 自下而上由难到易 · 图例与柱同序", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ F. 答题时长 ══════════════════════

// F1 浮动区间条 — 每领域一根横浮条（Q1–Q3），两端须须 = min–max，缺口 = 中位
export function chartFieldRanges(fields: { label: string; q1: number; median: number; q3: number; min: number; max: number; outliers: number[] }[]): Box {
  const P = palette();
  const G = fields.slice(0, 4);
  if (!G.length) return empty("答题时长样本不足（需 ≥5 次/领域）", 460, 300);
  const MS_H = 3600_000;
  const maxV = Math.max(...G.map((g) => Math.max(g.max, ...g.outliers))) / MS_H * 1.06;
  const X0 = 108, X1 = 420, rowH = Math.min(56, 220 / G.length), Y0 = 50;
  const xOf = (msv: number) => X0 + (msv / MS_H / maxV) * (X1 - X0);
  const hOf = (msv: number) => `${(Math.round((msv / MS_H) * 10) / 10).toString()}`;
  const els: El[] = [];
  [0, 0.5, 1].forEach((f) => {
    const x = X0 + f * (X1 - X0);
    els.push(L(x, Y0 - 16, x, Y0 - 10, P.GRID));
    els.push(T(x, Y0 - 22, `${Math.round(maxV * f)}时`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  G.forEach((g, i) => {
    const y = Y0 + i * rowH + rowH / 2;
    els.push(T(X0 - 10, y + 4, g.label.length <= 5 ? g.label : g.label.slice(0, 4) + "…", { textAnchor: "end", fontWeight: i === 0 ? 700 : 600, fill: i === 0 ? P.INK : P.GREY3 }));
    // 须
    els.push(L(xOf(g.min), y, xOf(g.max), y, P.GREY3, 1));
    [g.min, g.max].forEach((v) => els.push(L(xOf(v), y - 5, xOf(v), y + 5, P.GREY3, 1)));
    g.outliers.forEach((o) => els.push({
      ...R(xOf(o) - 2.5, y - 2.5, 5, 5, P.PAPER, { stroke: P.GREY3, strokeWidth: 1 }),
      title: `${g.label} 离群 — ${hOf(o)} 小时`
    }));
    // 浮条 Q1–Q3 + 中位缺口
    els.push({ ...R(xOf(g.q1), y - 9, Math.max(xOf(g.q3) - xOf(g.q1), 3), 18, ladderShade(P, i)), title: `${g.label} — 一半答题在 ${hOf(g.q1)}–${hOf(g.q3)} 小时` });
    els.push(L(xOf(g.median), y - 9, xOf(g.median), y + 9, P.PAPER, 2.4));
    els.push(T(X1 + 8, y + 4, `${hOf(g.median)}时`, { fontWeight: 700, fill: i === 0 ? P.ACCENT : P.INK }));
  });
  els.push(T(230, 292, "蓝条 = 中间一半答题 · 缺口 = 中位 · 须 = 全距", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// F2 频率多边形 — 5 分钟一箱的答题频数折线，峰顶标注，中位虚线
export function chartFreqPoly(bins: number[]): Box {
  const P = palette();
  const total = bins.reduce((a, b) => a + b, 0);
  if (!total) return empty("近 30 天暂无带时长的答题记录", 460, 300);
  const X0 = 46, X1 = 430, base = 232, top = 56, PW = (X1 - X0) / 12;
  const vmax = Math.max(...bins, 1);
  const xOf = (i: number) => X0 + i * PW + PW / 2;
  const yOf = (v: number) => base - (v / vmax) * (base - top);
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const y = base - (k / 2) * (base - top);
    els.push(L(X0 - 6, y, X1, y, P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(X0 - 12, y + 4, String(Math.round((vmax * k) / 2)), { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  // 折线 + 顶点方块
  const pts = bins.map((v, i) => `${xOf(i)} ${yOf(v)}`).join(" L ");
  els.push({ tag: "path", attrs: { d: `M${pts}`, fill: "none", stroke: P.INK, strokeWidth: 1.4 } });
  bins.forEach((v, i) => {
    if (v <= 0) return;
    els.push({ ...R(xOf(i) - 3.5, yOf(v) - 3.5, 7, 7, P.INK), title: `${i * 5}–${i * 5 + 5} 分钟 — ${v} 次` });
  });
  const pk = bins.indexOf(Math.max(...bins));
  if (bins[pk] > 0) {
    const pkY = Math.max(yOf(bins[pk]) - 12, top - 6);
    els.push(T(xOf(pk), pkY, `${Math.round((bins[pk] / total) * 100)}% 落在此档`, { textAnchor: "middle", fontWeight: 700, fill: P.ACCENT }));
    els.push({ ...R(xOf(pk) - 4, yOf(bins[pk]) - 4, 8, 8, P.ACCENT), title: `${pk * 5}–${pk * 5 + 5} 分钟` });
  }
  // 中位箱虚线
  let acc = 0, mbin = 0;
  for (let i = 0; i < 12; i++) { acc += bins[i]; if (acc >= total / 2) { mbin = i; break; } }
  els.push(L(xOf(mbin), base, xOf(mbin), top - 8, P.GREY3, 0.9, { strokeDasharray: "3 3" }));
  if (mbin !== pk) els.push(T(Math.min(xOf(mbin) + 5, X1 - 90), top + 14, "一半在此之内", { fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  // 轴
  els.push(L(X0 - 6, base, X1, base, P.GRID, 0.9));
  for (let e = 0; e <= 12; e += 2) {
    els.push(L(X0 + e * PW, base, X0 + e * PW, base + 5, P.GREY2, 0.8));
    els.push(T(X0 + e * PW, base + 19, `${e * 5}`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  els.push(T(X1, base + 34, "分钟", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  els.push(T(238, 292, "一方块 = 一个 5 分钟档 · 高度 = 答题次数", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ G. 卡片生命周期 ══════════════════════

// G1 方块漏斗 — 每阶段一行等值方块（1 块 = top/20 张），右侧接流转百分比
export function chartUnitFunnel(f: { drafts: number; entered: number; firstLearned: number; reviewing: number; consolidated: number }): Box {
  const P = palette();
  const STAGE: [string, number][] = [["AI 草稿", f.drafts], ["采纳入队", f.entered], ["完成首学", f.firstLearned], ["进入复习", f.reviewing], ["巩固掌握", f.consolidated]];
  const top = STAGE[0][1] || 1;
  const UNIT = Math.max(1, Math.ceil(top / 20));
  const rowH = 42, Y0 = 40, X0 = 20;
  const els: El[] = [];
  STAGE.forEach(([name, c], k) => {
    const y = Y0 + k * rowH;
    const n = Math.round(c / UNIT);
    els.push(T(X0, y + 12, name, { fontWeight: 700, fontSize: 12, fill: k === STAGE.length - 1 && c > 0 ? P.ACCENT : P.INK }));
    els.push(T(X0 + 74, y + 12, `${fmt(c)} 张`, { fontWeight: 600, fill: P.GREY3 }));
    for (let b = 0; b < n; b++) {
      els.push({
        ...R(X0 + 150 + b * 13, y + 3, 9, 9, ladderShade(P, STAGE.length - 1 - k, true)),
        title: `${name} — ${c} 张`
      });
    }
    if (k < STAGE.length - 1) {
      const next = STAGE[k + 1][1];
      const pct = c > 0 ? Math.round((next / c) * 100) : 0;
      els.push(T(440, y + 26, `${pct}% 流转`, { textAnchor: "end", fontSize: 11, fontWeight: 700, fill: pct >= 80 ? P.INK : P.GREY3 }));
      els.push(L(X0 + 150, y + rowH - 6, 446, y + rowH - 6, P.GRID, 0.6));
    }
  });
  els.push(T(230, Y0 + 5 * rowH + 16, `一块 ≈ ${UNIT} 张卡 · 每行右端 = 该阶段存量`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ H. 来源归属 ══════════════════════

// H1 归属树 — 领域枝 → 来源书叶，左侧发丝托架，计数右对齐
export function chartSourceTree(cards: { book: string; domain: string | null }[]): Box {
  const P = palette();
  if (!cards.length) return empty("近 26 周暂无新建卡", 960, 320);
  const MAIN_LABEL = Object.fromEntries(UDC_MAIN.map((m) => [m.code, m.label]));
  const sample = cards.slice(0, 60);
  const byDomain = new Map<string, Map<string, number>>();
  for (const c of sample) {
    const dLabel = c.domain ? (MAIN_LABEL[mainOf(c.domain)] || udcLabel(c.domain) || "未分类") : "未分类";
    if (!byDomain.has(dLabel)) byDomain.set(dLabel, new Map());
    const books = byDomain.get(dLabel)!;
    books.set(c.book, (books.get(c.book) || 0) + 1);
  }
  const domains = [...byDomain.entries()]
    .map(([d, books]) => ({ d, total: [...books.values()].reduce((a, b) => a + b, 0), books: [...books.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const rows: { indent: number; label: string; count: number; isDomain: boolean }[] = [];
  domains.forEach((dm) => {
    rows.push({ indent: 0, label: dm.d, count: dm.total, isDomain: true });
    dm.books.forEach(([b, n]) => rows.push({ indent: 1, label: b, count: n, isDomain: false }));
  });
  const rowH = Math.min(24, 268 / rows.length), Y0 = 44, X0 = 40;
  const els: El[] = [];
  rows.forEach((r, i) => {
    const y = Y0 + i * rowH;
    const x = X0 + r.indent * 26;
    if (r.isDomain) {
      els.push({ ...R(X0 - 14, y - 9, 4, rowH - 4, P.ACCENT), title: `${r.label} 共 ${r.count} 张` });
      els.push(T(x, y + 2, r.label, { fontWeight: 700, fontSize: 12, fill: P.INK }));
    } else {
      els.push(L(X0 - 10, y - 4, x - 8, y - 4, P.GRID, 0.6));
      els.push(L(x - 8, y - 4, x - 8, y + 8, P.GRID, 0.6));
      els.push(T(x, y + 4, r.label.length <= 16 ? r.label : r.label.slice(0, 15) + "…", { fontWeight: 600, fontSize: 11, fill: P.GREY3 }));
    }
    els.push(T(940, y + 2, `${r.count}`, { textAnchor: "end", fontWeight: r.isDomain ? 700 : 600, fontSize: r.isDomain ? 12 : 11, fill: r.isDomain ? P.INK : P.GREY3 }));
  });
  els.push(T(40, 28, "枝 = UDC 领域 · 叶 = 来源书（各取前三）", { fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  els.push(T(940, 28, "新建卡数", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 320", els };
}

function mainOf(leafCode: string): string {
  const leaf = UDC_MAIN.find(() => false);
  void leaf;
  const MAP: Record<string, string> = { "004": "0", "1": "1", "159.9": "1", "2": "2", "316": "3", "32": "3", "33": "3", "37": "3", "51": "5", "53": "5", "54": "5", "55": "5", "57": "5", "61": "6", "62": "6", "63": "6", "7": "7", "78": "7", "79": "7", "796": "7", "8": "8", "91": "9", "93": "9" };
  return MAP[leafCode] || "";
}

// ══════════════════════ I. 学习节律 ══════════════════════

// I1 多线时段谱 — 七条星期曲线（8–20 时），最忙一条焦点色
export function chartRhythmCurves(grid: number[][]): Box {
  const P = palette();
  const W = 460, H = 300, X0 = 46, X1 = 430, base = 244, top = 58;
  if (!grid.length || grid.every((row) => row.every((n) => !n))) return empty("近 90 天暂无复习记录", 460, 300);
  const vmax = Math.max(...grid.flat());
  const nCols = grid[0].length;
  const xOf = (j: number) => X0 + (j / (nCols - 1)) * (X1 - X0);
  const yOf = (v: number) => base - (v / vmax) * (base - top);
  const sums = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const heroDay = sums.indexOf(Math.max(...sums));
  const DAY = ["一", "二", "三", "四", "五", "六", "日"];
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const y = base - (k / 2) * (base - top);
    els.push(L(X0 - 4, y, X1, y, P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(X0 - 10, y + 4, String(Math.round((vmax * k) / 2)), { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  grid.forEach((row, i) => {
    const hero = i === heroDay;
    const dPath = row.map((v, j) => `${j === 0 ? "M" : " L"}${xOf(j)} ${yOf(v)}`).join("");
    els.push({ tag: "path", attrs: { d: dPath, fill: "none", stroke: hero ? P.ACCENT : P.GREY2, strokeWidth: hero ? 1.8 : 1 } });
    if (hero) {
      const pj = row.indexOf(Math.max(...row));
      els.push({ ...R(xOf(pj) - 4, yOf(row[pj]) - 4, 8, 8, P.ACCENT), title: `周${DAY[i]} ${8 + pj}:00 — ${row[pj]} 张` });
      els.push(T(Math.min(xOf(pj) + 8, X1 - 40), yOf(row[pj]) - 8, `周${DAY[i]} ${8 + pj}:00`, { fontWeight: 700, fill: P.ACCENT, fontSize: 11 }));
    }
  });
  els.push(L(X0 - 4, base, X1, base, P.GRID, 0.9));
  for (let j = 0; j < nCols; j += 2) {
    els.push(T(xOf(j), base + 18, `${8 + j}时`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  els.push(T(230, 292, `七线 = 七个星期 · 蓝线 = 最勤的周${DAY[heroDay]}`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: `0 0 ${W} ${H}`, els };
}

// I2 时刻点簇 — 采样复习事件按时刻落点，同刻向上堆叠；Again 空心
export function chartHourClusters(events: { hour: number; again: boolean }[]): Box {
  const P = palette();
  if (!events.length) return empty("近 30 天暂无复习事件", 460, 300);
  const X0 = 40, X1 = 430, base = 240;
  const xOf = (h: number) => X0 + (h / 23) * (X1 - X0);
  const stacks = new Map<number, number>();
  const S = 9;
  const els: El[] = [];
  events.forEach((e, i) => {
    const h = Math.max(0, Math.min(23, Math.floor(e.hour)));
    const lvl = stacks.get(h) || 0;
    stacks.set(h, lvl + 1);
    const x = xOf(h), y = base - 10 - lvl * (S + 3);
    els.push({
      ...R(x - S / 2, y - S / 2, S, S, e.again ? P.PAPER : P.INK, e.again ? { stroke: P.ACCENT, strokeWidth: 1.2 } : {}),
      title: `#${i + 1} — ${String(h).padStart(2, "0")}:00${e.again ? " · 评了 Again" : ""}`
    });
  });
  els.push(L(X0 - 6, base, X1, base, P.GRID, 0.9));
  [0, 6, 12, 18, 23].forEach((h) => {
    els.push(L(xOf(h), base, xOf(h), base + 5, P.GREY2, 0.8));
    els.push(T(xOf(h), base + 19, `${String(h).padStart(2, "0")}:00`, { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  els.push(R(120, 274, 9, 9, P.INK));
  els.push(T(136, 282, "通过", { fontWeight: 600 }));
  els.push(R(196, 274, 9, 9, P.PAPER, { stroke: P.ACCENT, strokeWidth: 1.2 }));
  els.push(T(212, 282, "评了 Again", { fontWeight: 600, fill: P.GREY3 }));
  els.push(T(X1, 282, `样本 ${events.length} 次`, { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ J. 领域排名 ══════════════════════

// J1 斜率图 — 每个领域一条折线跨 6 个月名次，末月第一焦点色
export function chartRankSlope(rows: { label: string; ranks: number[] }[]): Box {
  const P = palette();
  if (!rows.length) return empty("近 6 个月暂无领域复习数据", 460, 300);
  const sorted = [...rows].sort((a, b) => a.ranks[a.ranks.length - 1] - b.ranks[b.ranks.length - 1]).slice(0, 6);
  const nM = Math.max(...sorted.map((r) => r.ranks.length));
  const nR = Math.max(...sorted.flatMap((r) => r.ranks), 1);
  const now = new Date();
  const months: string[] = [];
  for (let k = nM - 1; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push(`${d.getMonth() + 1}月`);
  }
  const X0 = 96, X1 = 420, Y0 = 56, YB = 250;
  const xOf = (m: number) => X0 + (m / (nM - 1 || 1)) * (X1 - X0);
  const yOf = (rank: number) => Y0 + ((rank - 1) / (nR - 1 || 1)) * (YB - Y0);
  const els: El[] = [];
  months.forEach((m, k) => els.push(T(xOf(k), Y0 - 22, m, { textAnchor: "middle", fontWeight: 600, fill: P.GREY3 })));
  for (let r = 1; r <= nR; r++) {
    els.push(L(X0 - 6, yOf(r), X1, yOf(r), P.GRID, r === 1 ? 0.8 : 0.5));
    els.push(T(X0 - 12, yOf(r) + 4, String(r), { textAnchor: "end", fontWeight: 700, fontSize: 11, fill: r === 1 ? P.ACCENT : P.GREY3 }));
  }
  sorted.forEach((row, i) => {
    const last = i === 0;
    const dPath = row.ranks.map((r, m) => `${m === 0 ? "M" : " L"}${xOf(m)} ${yOf(r)}`).join("");
    els.push({ tag: "path", attrs: { d: dPath, fill: "none", stroke: last ? P.ACCENT : P.GREY2, strokeWidth: last ? 2 : 1.1 } });
    row.ranks.forEach((r, m) => {
      els.push({ ...R(xOf(m) - 3, yOf(r) - 3, 6, 6, last ? P.ACCENT : P.GREY3), title: `${row.label} — ${months[m]} 第 ${r} 名` });
    });
    const endR = row.ranks[row.ranks.length - 1];
    els.push(T(X1 + 6, yOf(endR) + 4, row.label.length <= 4 ? row.label : row.label.slice(0, 4), { fontWeight: last ? 700 : 600, fontSize: 11, fill: last ? P.ACCENT : P.GREY3 }));
  });
  els.push(T(230, 292, "一线 = 一个领域 · 越高名次越好 · 蓝 = 本月第一", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ K. 队列水位 ══════════════════════

// K1 进出账本 — 台账行 + 行内带符号横条（进为蓝向右、出为灰向左），数字右对齐
export function chartQueueLedger(q: { carriedOver: number; newCards: number; completed: number; skipped: number; remaining: number }): Box {
  const P = palette();
  const rows: [string, number, "in" | "out" | "stock"][] = [
    ["期初到期", q.carriedOver, "stock"],
    ["本月新建", q.newCards, "in"],
    ["本月完成", -q.completed, "out"],
    ["本月跳过", -q.skipped, "out"],
    ["月末剩余", q.remaining, "stock"]
  ];
  const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  const W = 460, X0 = 24, X1 = 356, rowH = 40, Y0 = 48;
  const CX = X0 + (X1 - X0) / 2;
  const halfW = (X1 - X0) / 2 - 6;
  const els: El[] = [];
  rows.forEach(([name, v, kind], i) => {
    const y = Y0 + i * rowH;
    // 行分割发丝线
    if (i > 0) els.push(L(X0, y - 8, X1 + 70, y - 8, P.GRID, 0.6));
    const isStock = kind === "stock";
    const w = (Math.abs(v) / maxAbs) * halfW;
    if (kind === "in") {
      els.push({ ...R(CX, y + 2, w, 16, P.ACCENT), title: `${name} +${v} 张` });
      els.push(T(CX + w + 6, y + 14, `+${v}`, { fontWeight: 700, fill: P.ACCENT }));
    } else if (kind === "out") {
      els.push({ ...R(CX - w, y + 2, w, 16, P.GREY2), title: `${name} ${v} 张` });
      els.push(T(CX - w - 6, y + 14, `${v}`, { textAnchor: "end", fontWeight: 700, fill: P.GREY3 }));
    } else {
      els.push({ ...R(CX - w / 2, y + 2, Math.max(w, 2), 16, P.INK), title: `${name} ${v} 张` });
      els.push(T(CX + w / 2 + 6, y + 14, `${v}`, { fontWeight: 700 }));
    }
    els.push(T(X0, y + 14, name, { fontWeight: isStock ? 700 : 600, fill: isStock ? P.INK : P.GREY3 }));
  });
  // 中轴
  els.push(L(CX, Y0 - 12, CX, Y0 + rows.length * rowH - 14, P.GRID, 0.8, { strokeDasharray: "2 3" }));
  els.push(T(X1 + 70, Y0 - 18, "张", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  els.push(T(230, 292, "中轴右蓝 = 进入 · 左灰 = 消化 · 黑 = 存量", { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 460 300", els };
}

// ══════════════════════ L. 阅读输入 ══════════════════════

// L1 周条密度带 — 一行 = 一周，一天 = 一段，墨色深浅 = 当日字数
export function chartReadingStrips(days: { date: number; chars: number }[]): Box {
  const P = palette();
  const tail = days.slice(-42);
  if (!tail.length || tail.every((d) => d.chars === 0)) return empty("近 42 天暂无阅读记录", 960, 280);
  const vmax = Math.max(...tail.map((d) => d.chars));
  const weeks: { date: number; chars: number }[][] = [];
  for (let i = 0; i < tail.length; i += 7) weeks.push(tail.slice(i, i + 7));
  const X0 = 60, W = 960, rowH = 30, Y0 = 52;
  const segW = (W - X0 - 120) / 7;
  const els: El[] = [];
  weeks.forEach((wk, wi) => {
    const y = Y0 + wi * rowH;
    const start = wk[0].date, end = wk[wk.length - 1].date;
    els.push(T(X0 - 10, y + 15, `${dayLabel(start)}`, { textAnchor: "end", fontWeight: 600, fontSize: 11, fill: P.GREY3 }));
    wk.forEach((d, di) => {
      const x = X0 + di * segW;
      const ink = d.chars / vmax;
      if (d.chars > 0) {
        els.push({
          ...R(x + 1, y + 4, segW - 2, 18, P.INK, { fillOpacity: 0.15 + ink * 0.85 }),
          title: `${dayLabel(d.date)} — ${fmt(d.chars)} 字`
        });
      } else {
        els.push(L(x + segW / 2, y + 4, x + segW / 2, y + 22, P.GRID, 1));
      }
    });
    const total = wk.reduce((a, d) => a + d.chars, 0);
    els.push(T(W - 20, y + 15, `${shortNum(total)} 字`, { textAnchor: "end", fontWeight: 700, fontSize: 11, fill: total > 0 ? P.INK : P.GREY2 }));
  });
  els.push(T(940, 266, "一横条 = 一周 · 一段 = 一天 · 越黑当日读得越多 · 右侧 = 周合计", { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 280", els };
}

// L2 字数分布直方 — 每日阅读字数分箱（宽卡画框），实心柱 + 峰档焦点色
export function chartReadingHist(days: { date: number; chars: number }[]): Box {
  const P = palette();
  const tail = days.slice(-42).map((d) => d.chars).filter((c) => c > 0);
  if (!tail.length) return empty("近 42 天暂无阅读记录", 960, 280);
  const CAPS = [1000, 2000, 3000, 5000, 8000, Infinity];
  const LABELS = ["<1千", "1–2千", "2–3千", "3–5千", "5–8千", ">8千"];
  const bins = Array(CAPS.length).fill(0);
  for (const c of tail) {
    const i = CAPS.findIndex((cap) => c < cap);
    bins[i < 0 ? CAPS.length - 1 : i]++;
  }
  const total = tail.length;
  const vmax = Math.max(...bins, 1);
  const PW = 130, BW = 90;
  const totalW = bins.length * PW;
  const X0 = 52 + ((940 - 52) - totalW) / 2;
  const BASE = 226, TOP = 56;
  const els: El[] = [];
  for (let k = 0; k <= 2; k++) {
    const y = BASE - (k / 2) * (BASE - TOP);
    els.push(L(X0 - 6, y, X0 + totalW, y, P.GRID, k === 0 ? 0.9 : 0.6));
    els.push(T(X0 - 12, y + 4, String(Math.round((vmax * k) / 2)), { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  }
  bins.forEach((v, i) => {
    const x = X0 + i * PW + (PW - BW) / 2;
    const h = (v / vmax) * (BASE - TOP);
    if (v > 0) {
      const peak = v === vmax;
      els.push({ ...R(x, BASE - h, BW, h, P.INK), title: `${LABELS[i]}字 — ${v} 天` });
      els.push(T(x + BW / 2, BASE - h - 8, `${Math.round((v / total) * 100)}%`, { textAnchor: "middle", fontWeight: 700, fill: peak ? P.ACCENT : P.INK }));
      if (peak) els.push(R(x, BASE - h, BW, 3, P.ACCENT));
    } else {
      els.push(T(x + BW / 2, BASE - 8, "0", { textAnchor: "middle", fontSize: 11, fill: P.GREY2 }));
    }
    els.push(T(x + BW / 2, 246, LABELS[i], { textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  });
  const sorted = [...tail].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  els.push(T(940, 266, `${total} 个阅读日 · 中位日读 ${shortNum(med)} 字 · 一柱 = 一档字数区间`, { textAnchor: "end", fontSize: 11, fontWeight: 600, fill: P.GREY3 }));
  return { viewBox: "0 0 960 280", els };
}

// ────────────────────────── 通用 SVG 挂载容器 ──────────────────────────
export function ChartSvg({ viewBox, els, maxHeight, label }: { viewBox: string; els: El[]; maxHeight?: number; label?: string }) {
  // role="img" 会把整个子树对读屏隐藏。此前无条件挂 role="img" 又没有可访问名，
  // 读屏用户从 15 个图表里得到的信息是 0。改为：给了 label 才用 img（并配 aria-label）；
  // 没给就不设 role，让 SVG 里已有的 <text> 数值节点正常暴露出来。
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: maxHeight || 320, width: "100%", display: "block" }} {...(label ? { role: "img", "aria-label": label } : {})}>
      {els.map((e, i) =>
        e.text !== undefined && e.text !== "" ? (
          <text key={i} {...(e.attrs as object)} fontFamily="inherit">{e.text}</text>
        ) : e.text === "" ? null
          : (
            <ElNode key={i} el={e} />
          )
      )}
    </svg>
  );
}

function ElNode({ el }: { el: El }) {
  const node = createElement(el.tag, el.attrs);
  if (el.title) {
    return (
      <g>
        {node}
        <title>{el.title}</title>
      </g>
    );
  }
  return node;
}
