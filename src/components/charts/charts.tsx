// 数据页图表（v3）：全部为「按真实像素布局」的响应式组件，外框/图例/脚注/提示由 kit.tsx 的 <Chart> 提供。
// 色彩：焦点色 = 皮肤 accent；类别色 P.C[1..5] 来自 theme.css 的 --chart-2..6；语义：遗忘=砖红、吃力=琥珀、通过=焦点色、轻松=靛蓝。
// 图元一律直角（瑞士风）；数据元素挂 data-tip，由 <Chart> 统一显示悬浮提示。
import { udcLabel, UDC_MAIN } from "../../lib/udc";
// v49.8（D182）：图表文案随界面语言
import { t } from "../../lib/i18n";
import { weekFull, weekMini } from "./kit";
import type { StatsOverview } from "../../lib/stats";
import {
  Chart, Empty, Tx, YGrid, fit, fmtDur, fmtInt, md, mdw, niceTicks, shortNum, smoothPath, textOn, textW, weekShort,
  type Pal
} from "./kit";

type Day = { date: number; value: number };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ═════════════════ A. 今日概览（kpi） ═════════════════

/** 今日进度：大数字 + 逐卡分格进度条 + 四项读数 */
export function QueueProgress({ kpi }: { kpi: StatsOverview["kpi"] }) {
  const due = Math.max(kpi.dueToday, 0);
  if (!due) return <Empty msg={t("今日队列已清空 — 没有到期的卡片")} height={150} />;
  const done = Math.min(kpi.completedToday, due);
  const pct = Math.round((done / due) * 100);
  return (
    <Chart
      height={168}
      label={t("今日已完成 {done} / {due} 张", { done, due })}
      build={(w, P) => {
        const els: React.ReactNode[] = [];
        const big = String(done);
        const bw = textW(big, 38, 700);
        els.push(<Tx key="n" x={0} y={38} s={38} w={700}>{big}</Tx>);
        els.push(<Tx key="d" x={bw + 8} y={38} s={14} w={500} fill={P.GREY3}>{t("/ {due} 张到期", { due })}</Tx>);
        els.push(<Tx key="p" x={w} y={38} s={14} w={700} anchor="end" fill={P.ACCENT}>{`${pct}%`}</Tx>);
        // 进度条：卡数不多时一张一格（间隙 2px），否则连续条
        const Y = 58, H = 14;
        const gap = 2, cell = (w - gap * (due - 1)) / due;
        if (due <= 90 && cell >= 4) {
          for (let i = 0; i < due; i++)
            els.push(<rect key={`c${i}`} x={i * (cell + gap)} y={Y} width={cell} height={H} fill={i < done ? P.ACCENT : P.GREY2} />);
        } else {
          els.push(<rect key="bg" x={0} y={Y} width={w} height={H} fill={P.GREY2} />);
          els.push(<rect key="fg" x={0} y={Y} width={(done / due) * w} height={H} fill={P.ACCENT} />);
        }
        const stats: [string, string, string][] = [
          [t("待完成"), String(kpi.pendingToday), t("张")],
          [t("今日已评"), String(kpi.reviewedToday), t("张")],
          [t("连续学习"), String(kpi.streak), t("天")],
          [t("今日时长"), String(kpi.minutesToday), t("分")]
        ];
        const colW = w / 4;
        stats.forEach(([lab, val, u], i) => {
          const x = i * colW;
          els.push(<line key={`l${i}`} x1={x} x2={x} y1={104} y2={152} stroke={P.GRID} strokeWidth={0.8} opacity={i === 0 ? 0 : 1} />);
          const px = x + (i === 0 ? 0 : 14);
          els.push(<Tx key={`a${i}`} x={px} y={112} fill={P.GREY3}>{fit(lab, colW - 18, 11)}</Tx>);
          els.push(<Tx key={`b${i}`} x={px} y={140} s={24} w={650}>{val}</Tx>);
          els.push(<Tx key={`u${i}`} x={px + textW(val, 24, 650) + 5} y={140} s={12} fill={P.GREY3}>{u}</Tx>);
        });
        return els;
      }}
    />
  );
}

/** 连续学习：近 28 天点阵 + 里程碑进度轨 */
export function StreakPanel({ streak, heatDays }: { streak: number; heatDays: StatsOverview["heatDays"] }) {
  const MILES = [7, 14, 30, 60, 100, 200, 365];
  const next = MILES.find((m) => m > streak) ?? Math.ceil((streak + 1) / 100) * 100;
  const tail = heatDays.slice(-28);
  const learned = tail.filter((d) => d.count > 0).length;
  return (
    <Chart
      height={150}
      label={t("连续学习 {streak} 天", { streak })}
      build={(w, P) => {
        const els: React.ReactNode[] = [];
        const nb = String(streak);
        els.push(<Tx key="n" x={0} y={38} s={38} w={700}>{nb}</Tx>);
        els.push(<Tx key="u" x={textW(nb, 38, 700) + 8} y={38} s={14} fill={P.GREY3}>{t("天连续学习")}</Tx>);
        els.push(<Tx key="r" x={w} y={36} anchor="end" fill={P.GREY3}>{fit(t("距 {next} 天里程碑还差 {diff} 天", { next, diff: next - streak }), w - textW(nb, 38, 700) - 110, 12)}</Tx>);
        // 近 28 天点阵：方格宽有 clamp 上限，内容总宽不足卡宽时整体居中
        const gap = 3, n = tail.length || 28;
        const cw = clamp((w - gap * (n - 1)) / n, 4, 30);
        const total = cw * n + gap * (n - 1);
        const dotX0 = Math.max(0, (w - total) / 2);
        tail.forEach((d, i) => {
          const x = dotX0 + i * (cw + gap);
          const today = i === tail.length - 1;
          els.push(
            <rect key={`d${i}`} x={x} y={58} width={cw} height={22} fill={d.count > 0 ? P.ACCENT : P.GREY2}
              stroke={today ? P.INK : "none"} strokeWidth={today ? 1.2 : 0} className="cx-hit"
              data-tip={`${mdw(d.date)}\n${d.count > 0 ? t("复习 {n} 张", { n: d.count }) : t("未学习")}`} />
          );
        });
        els.push(<Tx key="cap" x={0} y={98} fill={P.GREY3}>{t("近 28 天 · 学习 {n} 天", { n: learned })}</Tx>);
        // 里程碑轨
        const Y = 128, top = next;
        const x = (v: number) => (v / top) * w;
        els.push(<rect key="t0" x={0} y={Y - 2} width={w} height={4} fill={P.GREY2} />);
        els.push(<rect key="t1" x={0} y={Y - 2} width={x(streak)} height={4} fill={P.ACCENT} />);
        MILES.filter((m) => m <= top).forEach((m) => {
          const reached = streak >= m;
          const px = Math.min(x(m), w - 1);
          els.push(<rect key={`m${m}`} x={px - 3} y={Y - 3} width={6} height={6} fill={reached ? P.ACCENT : P.PAPER} stroke={reached ? P.ACCENT : P.AXIS} strokeWidth={1.2} />);
          els.push(<Tx key={`ml${m}`} x={px} y={Y + 18} anchor={m === top ? "end" : "middle"} fill={reached ? P.INK : P.GREY3} w={reached ? 650 : 500}>{`${m}`}</Tx>);
        });
        return els;
      }}
    />
  );
}

/** 今日时长对照：近 30 天每日学习分钟柱，今天高亮 + 中位虚线 */
export function MinutesColumns({ kpi, heatDays }: { kpi: { minutesToday: number }; heatDays: StatsOverview["heatDays"] }) {
  const tail = heatDays.slice(-30);
  if (!tail.length) return <Empty msg={t("暂无学习时长记录")} height={150} />;
  const nz = tail.map((d) => d.minutes).filter((v) => v > 0).sort((a, b) => a - b);
  const med = nz.length ? nz[Math.floor(nz.length / 2)] : 0;
  const vmax = Math.max(10, ...tail.map((d) => d.minutes));
  return (
    <Chart
      height={170}
      headline={<><b className="cx-big">{kpi.minutesToday}</b> {t("分钟")} <span className="cx-dim">{t("今日学习时长")}</span></>}
      sub={nz.length ? t("近 30 天有记录 {n} 天 · 中位 {med} 分 · 最长 {max} 分", { n: nz.length, med, max: Math.max(...nz) }) : t("近 30 天暂无记录")}
      build={(w, P) => {
        const X0 = 30, X1 = w, BASE = 140, TOP = 8;
        const ticks = niceTicks(vmax, 2, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / tail.length, bw = Math.max(2, pitch * 0.66);
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {tail.map((d, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2, isToday = i === tail.length - 1;
              const h = d.minutes > 0 ? Math.max(2, BASE - y(d.minutes)) : 0;
              return (
                <g key={i}>
                  {h > 0 && <rect x={x} y={BASE - h} width={bw} height={h} fill={isToday ? P.ACCENT : P.ACCENT} opacity={isToday ? 1 : 0.38} />}
                  <rect x={X0 + i * pitch} y={TOP} width={pitch} height={BASE - TOP} fill="transparent" className="cx-hit"
                    data-tip={`${isToday ? t("今天") : mdw(d.date)}\n${t("{n} 分钟 · 复习 {c} 张", { n: d.minutes, c: d.count })}`} />
                </g>
              );
            })}
            {med > 0 && <line x1={X0} x2={X1} y1={y(med)} y2={y(med)} stroke={P.INK} strokeWidth={1} strokeDasharray="4 4" />}
            {med > 0 && <Tx x={X0 + 6} y={y(med) - 5} w={650}>{t("中位 {med} 分", { med })}</Tx>}
            <Tx x={X0} y={160} fill={P.GREY3}>{md(tail[0].date)}</Tx>
            <Tx x={X1} y={160} anchor="end" fill={P.GREY3}>{t("今天")}</Tx>
          </g>
        );
      }}
    />
  );
}

// ═════════════════ B. 日历热力 / 日柱 / 星期 / 累计 ═════════════════

/** 周数 ≤ 6（约一个月内）改「一行一周」铺满宽度；更长的范围用「一列一周」的经典日历热力 */
function calGeom(w: number, cols: number) {
  if (cols <= 6) {
    const labelW = 44;
    const cw = clamp((w - labelW) / 7 - 4, 20, 110);
    return { rows: true, labelW, cw, ch: 28, gap: 4 };
  }
  const labelW = 24;
  const cw = clamp((w - labelW) / cols - 3, 10, 56);
  const ch = clamp(cw * 0.7, 12, 28);
  return { rows: false, labelW, cw, ch, gap: 3 };
}

/** 日历热力：列 = 周（周一起），行 = 星期；色阶 = 当日量的四分位 */
export function HeatCalendar({ days, unit, emptyMsg, legendTitle }: { days: Day[]; unit: string; emptyMsg: string; legendTitle?: string }) {
  const total = sum(days.map((d) => d.value));
  if (!days.length || total === 0) return <Empty msg={emptyMsg} height={170} />;
  const lead = (new Date(days[0].date).getDay() + 6) % 7;
  const cols = Math.ceil((lead + days.length) / 7);
  const active = days.filter((d) => d.value > 0).length;
  const best = days.reduce((a, b) => (b.value > a.value ? b : a));
  const nz = days.map((d) => d.value).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const lvl = (v: number) => (v <= 0 ? 0 : v > q3 ? 4 : v > q2 ? 3 : v > q1 ? 2 : 1);
  const OP = [0, 0.26, 0.5, 0.74, 1];
  return (
    <Chart
      headline={<><b className="cx-big">{fmtInt(total)}</b> {unit} <span className="cx-dim">{t("共 {n} 天", { n: days.length })}</span></>}
      sub={t("日均 {avg} · 活跃 {active}/{total} 天 · 最高 {date}（{val} {unit}）", { avg: (total / days.length).toFixed(1), active, total: days.length, date: md(best.date), val: fmtInt(best.value), unit })}
      legend={[{ label: "", ramp: { from: legendTitle ? t("少") : t("少"), to: t("多"), color: "var(--accent)" } }]}
      height={(w) => { const g = calGeom(w, cols); return g.rows ? 22 + cols * (g.ch + g.gap) : 22 + 7 * (g.ch + g.gap); }}
      build={(w, P) => {
        const g = calGeom(w, cols);
        const els: React.ReactNode[] = [];
        if (g.rows) {
          // 格宽有上限，日历内容总宽不足卡宽时整体居中（标签列同移）
          const ox = Math.max(0, (w - (g.labelW + 7 * (g.cw + g.gap) - g.gap)) / 2);
          [1, 2, 3, 4, 5, 6, 0].forEach((wd, c) => els.push(<Tx key={`h${c}`} x={ox + g.labelW + c * (g.cw + g.gap) + g.cw / 2} y={12} anchor="middle" fill={P.GREY3}>{weekMini(wd)}</Tx>));
          for (let r = 0; r < cols; r++) {
            const first = days[Math.max(0, r * 7 - lead)];
            els.push(<Tx key={`w${r}`} x={ox} y={22 + r * (g.ch + g.gap) + g.ch / 2 + 4} fill={P.GREY3}>{md(first.date)}</Tx>);
            for (let c = 0; c < 7; c++) {
              const idx = r * 7 + c - lead;
              if (idx < 0 || idx >= days.length) continue;
              const d = days[idx], L = lvl(d.value), today = idx === days.length - 1;
              const fill = L ? P.ACCENT : P.GREY2, op = L ? OP[L] : 0.45;
              els.push(
                <g key={`${r}-${c}`} className="cx-hit" data-tip={`${mdw(d.date)}\n${d.value > 0 ? `${fmtInt(d.value)} ${unit}` : t("无记录")}`}>
                  <rect x={ox + g.labelW + c * (g.cw + g.gap)} y={22 + r * (g.ch + g.gap)} width={g.cw} height={g.ch} fill={fill} opacity={op}
                    stroke={today ? P.INK : "none"} strokeWidth={today ? 1.4 : 0} />
                  <Tx x={ox + g.labelW + c * (g.cw + g.gap) + 7} y={22 + r * (g.ch + g.gap) + g.ch / 2 + 4} fill={L >= 3 ? textOn(P.ACCENT, P) : P.GREY3} opacity={0.9}>{new Date(d.date).getDate()}</Tx>
                  {d.value > 0 && g.cw >= 52 && <Tx x={ox + g.labelW + c * (g.cw + g.gap) + g.cw - 7} y={22 + r * (g.ch + g.gap) + g.ch / 2 + 4} anchor="end" w={650} fill={L >= 3 ? textOn(P.ACCENT, P) : P.INK}>{fmtInt(d.value)}</Tx>}
                </g>
              );
            }
          }
          return els;
        }
        // 列模式同样按内容总宽居中（月份标签与星期标签同移，间距判据不受常数平移影响）
        const ox = Math.max(0, (w - (g.labelW + cols * (g.cw + g.gap) - g.gap)) / 2);
        [1, -1, 3, -1, 5, -1, 0].forEach((wd, r) => {
          if (wd >= 0) els.push(<Tx key={`w${r}`} x={ox} y={22 + r * (g.ch + g.gap) + g.ch / 2 + 4} fill={P.GREY3}>{weekMini(wd)}</Tx>);
        });
        let lastMonth = -1, lastLabelX = -99;
        for (let c = 0; c < cols; c++) {
          const x = ox + g.labelW + c * (g.cw + g.gap);
          for (let r = 0; r < 7; r++) {
            const idx = c * 7 + r - lead;
            if (idx < 0 || idx >= days.length) continue;
            const d = days[idx], L = lvl(d.value), today = idx === days.length - 1;
            if (r === 0 || idx === 0) {
              const m = new Date(d.date).getMonth();
              if (m !== lastMonth && x - lastLabelX >= 30) {
                els.push(<Tx key={`m${c}`} x={x} y={12} fill={P.GREY3}>{t("{m}月", { m: m + 1 })}</Tx>);
                lastLabelX = x;
              }
              lastMonth = m;
            }
            els.push(
              <rect key={`${c}-${r}`} x={x} y={22 + r * (g.ch + g.gap)} width={g.cw} height={g.ch}
                fill={L ? P.ACCENT : P.GREY2} opacity={L ? OP[L] : 0.45}
                stroke={today ? P.INK : "none"} strokeWidth={today ? 1.4 : 0} className="cx-hit"
                data-tip={`${mdw(d.date)}\n${d.value > 0 ? `${fmtInt(d.value)} ${unit}` : t("无记录")}`} />
            );
          }
        }
        return els;
      }}
    />
  );
}

/** 日柱：每天一柱，周末淡一档，虚线 = 日均 */
export function DailyColumns({ days, unit, emptyMsg }: { days: Day[]; unit: string; emptyMsg: string }) {
  const total = sum(days.map((d) => d.value));
  if (!days.length || total === 0) return <Empty msg={emptyMsg} height={200} />;
  const avg = total / days.length;
  const peak = days.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <Chart
      headline={<><b className="cx-big">{fmtInt(total)}</b> {unit} <span className="cx-dim">{t("日均 {avg}", { avg: avg.toFixed(1) })}</span></>}
      sub={t("最高 {date}（{val} {unit}）· 浅色柱 = 周末", { date: md(peak.date), val: fmtInt(peak.value), unit })}
      height={230}
      build={(w, P) => {
        const X0 = 40, X1 = w, BASE = 196, TOP = 12;
        const ticks = niceTicks(peak.value, 4, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / days.length, bw = Math.max(1.5, Math.min(26, pitch * 0.68));
        const stepDays = Math.max(1, Math.ceil(64 / pitch));
        const lab = stepDays > 7 ? Math.ceil(stepDays / 7) * 7 : stepDays;
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {days.map((d, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2;
              const wk = [0, 6].includes(new Date(d.date).getDay());
              const h = d.value > 0 ? Math.max(2, BASE - y(d.value)) : 0;
              return (
                <g key={i}>
                  {h > 0 && <rect x={x} y={BASE - h} width={bw} height={h} fill={P.ACCENT} opacity={d === peak ? 1 : wk ? 0.34 : 0.7} />}
                  <rect x={X0 + i * pitch} y={TOP} width={Math.max(pitch, 1)} height={BASE - TOP} fill="transparent" className="cx-hit"
                    data-tip={`${mdw(d.date)}\n${fmtInt(d.value)} ${unit}`} />
                </g>
              );
            })}
            <line x1={X0} x2={X1} y1={y(avg)} y2={y(avg)} stroke={P.INK} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            {days.map((d, i) => {
              const cx = X0 + i * pitch + pitch / 2, lastX = X1 - pitch / 2;
              const isLast = i === days.length - 1;
              if (!isLast && (i % lab !== 0 || lastX - cx < 44 || cx - X0 < 14)) return null;
              return <Tx key={`x${i}`} x={cx} y={BASE + 18} anchor={isLast ? "end" : "middle"} fill={P.GREY3}>{md(d.date)}</Tx>;
            })}
          </g>
        );
      }}
    />
  );
}

/** 星期剖面：七根横条 = 该星期几的日均量 */
export function WeekdayBars({ days, unit, emptyMsg }: { days: Day[]; unit: string; emptyMsg: string }) {
  if (!days.length || days.every((d) => d.value === 0)) return <Empty msg={emptyMsg} height={200} />;
  const sums = Array(7).fill(0), n = Array(7).fill(0);
  for (const d of days) { const k = (new Date(d.date).getDay() + 6) % 7; sums[k] += d.value; n[k]++; }
  const avg = sums.map((s, i) => (n[i] ? s / n[i] : 0));
  const best = avg.indexOf(Math.max(...avg));
  const NAMES = [0, 1, 2, 3, 4, 5, 6].map(weekFull);
  const vmax = Math.max(...avg, 0.1);
  return (
    <Chart
      headline={<>{t("最勤的是")} <b className="cx-big">{NAMES[best]}</b> <span className="cx-dim">{t("日均 {avg} {unit}", { avg: avg[best].toFixed(1), unit })}</span></>}
      sub={t("按所选范围内每个星期几的日均量")}
      height={7 * 32 + 8}
      build={(w, P) => {
        const X0 = 44, rowH = 32, valW = 64, X1 = w - valW;
        return NAMES.map((nm, i) => {
          const y = i * rowH + 4, bw = Math.max(avg[i] > 0 ? 2 : 0, (avg[i] / vmax) * (X1 - X0));
          return (
            <g key={i} className="cx-hit" data-tip={`${nm}\n${t("日均 {avg} {unit}（{n} 天）", { avg: avg[i].toFixed(1), unit, n: n[i] })}`}>
              <rect x={0} y={y} width={w} height={rowH - 4} fill="transparent" />
              <Tx x={0} y={y + 16} fill={i === best ? P.INK : P.GREY3} w={i === best ? 700 : 500} s={12}>{nm}</Tx>
              <rect x={X0} y={y + 5} width={X1 - X0} height={12} fill={P.GREY2} opacity={0.35} />
              <rect x={X0} y={y + 5} width={bw} height={12} fill={P.ACCENT} opacity={i === best ? 1 : 0.5} />
              <Tx x={w} y={y + 16} anchor="end" w={i === best ? 700 : 600} s={12} fill={i === best ? P.ACCENT : P.INK}>{avg[i].toFixed(1)}</Tx>
            </g>
          );
        });
      }}
    />
  );
}

/** 累计曲线：面积 + 线，末端标注 */
export function CumulativeArea({ days, unit, emptyMsg }: { days: Day[]; unit: string; emptyMsg: string }) {
  const total = sum(days.map((d) => d.value));
  if (!days.length || total === 0) return <Empty msg={emptyMsg} height={200} />;
  const cum: number[] = [];
  let acc = 0;
  for (const d of days) { acc += d.value; cum.push(acc); }
  return (
    <Chart
      headline={<><b className="cx-big">{fmtInt(total)}</b> {unit} <span className="cx-dim">{t("近 {n} 天累计", { n: days.length })}</span></>}
      sub={t("曲线只升不降，越陡说明那段时间越勤")}
      height={230}
      build={(w, P) => {
        const X0 = 44, X1 = w - 8, BASE = 196, TOP = 12;
        const ticks = niceTicks(total, 4, true);
        const top = ticks[ticks.length - 1];
        const x = (i: number) => X0 + (days.length === 1 ? 0 : (i / (days.length - 1)) * (X1 - X0));
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pts = cum.map((v, i) => [x(i), y(v)] as [number, number]);
        const line = smoothPath(pts);
        const area = `${line} L${x(days.length - 1)} ${BASE} L${x(0)} ${BASE} Z`;
        const step = (X1 - X0) / Math.max(1, days.length - 1);
        const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (days.length - 1)));
        return (
          <g>
            <defs>
              <linearGradient id="cx-g-cum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={P.ACCENT} stopOpacity={0.34} />
                <stop offset="1" stopColor={P.ACCENT} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} fmt={shortNum} />
            <path d={area} fill="url(#cx-g-cum)" />
            <path d={line} fill="none" stroke={P.ACCENT} strokeWidth={2} />
            {days.map((d, i) => (
              <rect key={i} x={x(i) - step / 2} y={TOP} width={Math.max(step, 2)} height={BASE - TOP} fill="transparent" className="cx-hit"
                data-tip={`${mdw(d.date)}\n${t("当日 {v} {unit}", { v: fmtInt(d.value), unit })}\n${t("累计 {v} {unit}", { v: fmtInt(cum[i]), unit })}`} />
            ))}
            <rect x={x(days.length - 1) - 4} y={y(total) - 4} width={8} height={8} fill={P.ACCENT} />
            {labels.map((i, k) => (
              <Tx key={k} x={x(i)} y={BASE + 18} anchor={k === 0 ? "start" : k === labels.length - 1 ? "end" : "middle"} fill={P.GREY3}>{md(days[i].date)}</Tx>
            ))}
          </g>
        );
      }}
    />
  );
}

// ═════════════════ C. 今日完成度 ═════════════════

function unitGeom(w: number, due: number) {
  const per = due > 160 ? Math.ceil(due / 160) : 1;
  const blocks = Math.ceil(due / per);
  const s = clamp(Math.floor((w - 0) / Math.min(blocks, 40)) - 3, 10, 22);
  const cols = Math.max(1, Math.floor((w + 3) / (s + 3)));
  const rows = Math.ceil(blocks / cols);
  return { per, blocks, s, cols, rows };
}

/** 方块格：一格 = 一张卡（>160 张时按倍数折算），按阅读序从左到右填充 */
export function TodayUnits({ kpi }: { kpi: StatsOverview["kpi"] }) {
  const due = kpi.dueToday;
  if (!due) return <Empty msg={t("今日队列已清空 — 没有到期的卡片")} height={180} />;
  const done = Math.min(kpi.completedToday, due);
  return (
    <Chart
      headline={<><b className="cx-big">{done}</b> / {due} {t("张")} <span className="cx-dim">{t("还剩 {n} 张", { n: due - done })}</span></>}
      legend={[{ label: t("已完成"), color: "var(--accent)" }, { label: t("未完成"), color: "var(--grey-2)" }]}
      height={(w) => unitGeom(w, due).rows * (unitGeom(w, due).s + 3)}
      foot={due > 160 ? t("一格 = {n} 张卡", { n: unitGeom(600, due).per }) : undefined}
      build={(w, P) => {
        const g = unitGeom(w, due);
        const doneB = Math.round(done / g.per);
        // 方格尺寸有上限：单行放得下时整块居中；多行保持「按阅读序从左到右填充」的进度语义不居中
        const ox = g.blocks <= g.cols ? Math.max(0, (w - (g.blocks * (g.s + 3) - 3)) / 2) : 0;
        return Array.from({ length: g.blocks }, (_, b) => (
          <rect key={b} x={ox + (b % g.cols) * (g.s + 3)} y={Math.floor(b / g.cols) * (g.s + 3)} width={g.s} height={g.s}
            fill={b < doneB ? P.ACCENT : P.GREY2} opacity={b < doneB ? 1 : 0.8} className="cx-hit"
            data-tip={b < doneB ? t("已完成") : t("未完成")} />
        ));
      }}
    />
  );
}

/** 进度环 */
export function TodayRing({ kpi }: { kpi: StatsOverview["kpi"] }) {
  const due = kpi.dueToday;
  if (!due) return <Empty msg={t("今日队列已清空 — 没有到期的卡片")} height={180} />;
  const done = Math.min(kpi.completedToday, due);
  const frac = done / due;
  return (
    <Chart
      height={190}
      label={t("今日完成 {pct}%", { pct: Math.round(frac * 100) })}
      build={(w, P) => {
        const R = 74, SW = 16, cy = 95;
        const arc = (f: number) => {
          if (f >= 0.9999) return `M${cx} ${cy - R} A${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R}`;
          const a = f * Math.PI * 2 - Math.PI / 2;
          return `M${cx} ${cy - R} A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${cx + R * Math.cos(a)} ${cy + R * Math.sin(a)}`;
        };
        const rows: [string, string, string][] = [
          [t("已完成"), `${done}`, P.ACCENT], [t("未完成"), `${due - done}`, P.GREY3], [t("今日到期"), `${due}`, P.INK]
        ];
        // 圆环 + 右侧读数列作整组水平居中（此前环恒钉左缘，宽幅卡右半全空）。
        // 环视觉外径 = 2R+SW（描边居中于 r=R，两侧各出 SW/2）；读数列宽用 canvas 实测
        const ringW = 2 * R + SW;
        const colW = Math.max(
          ...rows.map(([l]) => textW(l, 11, 500)),
          ...rows.map(([, v]) => textW(v, 22, 650) + 5 + textW(t("张"), 12, 500))
        );
        const ox = Math.max(0, (w - (ringW + 28 + colW)) / 2);
        const cx = ox + ringW / 2, tx = ox + ringW + 28;
        return (
          <g>
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={P.GREY2} strokeWidth={SW} opacity={0.6} />
            {done > 0 && <path d={arc(frac)} fill="none" stroke={P.ACCENT} strokeWidth={SW} />}
            <Tx x={cx} y={cy + 8} anchor="middle" s={28} w={700}>{`${Math.round(frac * 100)}%`}</Tx>
            {rows.map(([l, v, c], i) => (
              <g key={l}>
                <Tx x={tx} y={52 + i * 42} fill={P.GREY3}>{l}</Tx>
                <Tx x={tx} y={76 + i * 42} s={22} w={650} fill={c}>{v}</Tx>
                <Tx x={tx + textW(v, 22, 650) + 5} y={76 + i * 42} s={12} fill={P.GREY3}>{t("张")}</Tx>
              </g>
            ))}
          </g>
        );
      }}
    />
  );
}

// ═════════════════ D. 领域分布 ═════════════════

type Item = { label: string; count: number };
function foldItems(items: Item[], max: number): Item[] {
  const s = [...items].filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  return [...head, { label: t("其他 {n} 类", { n: s.length - head.length }), count: sum(s.slice(max - 1).map((d) => d.count)) }];
}

/** 排行条形 */
export function DomainBars({ items, unit }: { items: Item[]; unit: string }) {
  const D = foldItems(items, 9);
  if (!D.length) return <Empty msg={t("暂无分类数据 — 新建的卡会自动带 UDC 领域")} height={200} />;
  const total = sum(D.map((d) => d.count));
  return (
    <Chart
      headline={<><b className="cx-big">{D[0].label}</b> <span className="cx-dim">{t("占 {pct}%", { pct: Math.round((D[0].count / total) * 100) })}</span></>}
      sub={t("共 {total} {unit} · {n} 个领域", { total: fmtInt(total), unit, n: D.length })}
      height={D.length * 30 + 4}
      build={(w, P) => {
        const labW = Math.min(112, Math.max(...D.map((d) => textW(d.label, 12, 600))) + 6);
        const valW = 78, X0 = labW + 8, X1 = w - valW;
        const vmax = D[0].count;
        return D.map((d, i) => {
          const y = i * 30 + 2, bw = Math.max(2, (d.count / vmax) * (X1 - X0));
          return (
            <g key={i} className="cx-hit" data-tip={`${d.label}\n${fmtInt(d.count)} ${unit}（${Math.round((d.count / total) * 100)}%）`}>
              <rect x={0} y={y} width={w} height={28} fill="transparent" />
              <Tx x={0} y={y + 18} s={12} w={i === 0 ? 700 : 500} fill={i === 0 ? P.INK : P.TEXT2}>{fit(d.label, labW, 12, i === 0 ? 700 : 500)}</Tx>
              <rect x={X0} y={y + 7} width={bw} height={14} fill={P.ACCENT} opacity={i === 0 ? 1 : 0.5} />
              <Tx x={X0 + bw + 8} y={y + 18} s={12} w={650}>{fmtInt(d.count)}</Tx>
              <Tx x={w} y={y + 18} anchor="end" fill={P.GREY3}>{`${Math.round((d.count / total) * 100)}%`}</Tx>
            </g>
          );
        });
      }}
    />
  );
}

/** squarify 矩形树图布局 */
function squarify(vals: number[], x: number, y: number, w: number, h: number) {
  const out: { i: number; x: number; y: number; w: number; h: number }[] = [];
  const order = vals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  let total = sum(order.map((o) => o.v));
  let rest = [...order];
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row: typeof order, side: number, scale: number) => {
    const s = sum(row.map((r) => r.v)) * scale;
    const mx = Math.max(...row.map((r) => r.v)) * scale, mn = Math.min(...row.map((r) => r.v)) * scale;
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(rw, rh);
    const scale = (rw * rh) / total;
    let row = [rest[0]], k = 1;
    while (k < rest.length && worst([...row, rest[k]], side, scale) <= worst(row, side, scale)) { row.push(rest[k]); k++; }
    const rowSum = sum(row.map((r) => r.v));
    const thick = (rowSum * scale) / side;
    let off = 0;
    for (const r of row) {
      const len = (r.v * scale) / thick;
      if (rw >= rh) out.push({ i: r.i, x: rx, y: ry + off, w: thick, h: len });
      else out.push({ i: r.i, x: rx + off, y: ry, w: len, h: thick });
      off += len;
    }
    if (rw >= rh) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
    total -= rowSum;
    rest = rest.slice(row.length);
    if (rw <= 0.5 || rh <= 0.5) break;
  }
  return out;
}

/** 矩形树图：面积 = 数量，每个领域一个类别色 */
export function DomainTreemap({ items, unit }: { items: Item[]; unit: string }) {
  const D = foldItems(items, 10);
  if (!D.length) return <Empty msg={t("暂无分类数据")} height={200} />;
  const total = sum(D.map((d) => d.count));
  return (
    <Chart
      headline={<><b className="cx-big">{D[0].label}</b> <span className="cx-dim">{t("占 {pct}%", { pct: Math.round((D[0].count / total) * 100) })}</span></>}
      sub={t("面积 = {unit}数 · 共 {total} {unit}", { unit, total: fmtInt(total) })}
      height={(w) => clamp(w * 0.5, 220, 300)}
      build={(w, P) => {
        const h = clamp(w * 0.5, 220, 300);
        const rects = squarify(D.map((d) => d.count), 0, 0, w, h);
        return rects.map((r) => {
          const d = D[r.i], fill = P.C[r.i % P.C.length], on = textOn(fill, P);
          const tw = r.w - 16;
          return (
            <g key={r.i} className="cx-hit" data-tip={`${d.label}\n${fmtInt(d.count)} ${unit}（${Math.round((d.count / total) * 100)}%）`}>
              <rect x={r.x + 1} y={r.y + 1} width={Math.max(r.w - 2, 1)} height={Math.max(r.h - 2, 1)} fill={fill} opacity={r.i < P.C.length ? 0.92 : 0.62} />
              {tw > 28 && r.h > 26 && <Tx x={r.x + 9} y={r.y + 20} s={12} w={650} fill={on}>{fit(d.label, tw, 12, 650)}</Tx>}
              {tw > 28 && r.h > 46 && <Tx x={r.x + 9} y={r.y + 37} s={11} fill={on} opacity={0.85}>{`${fmtInt(d.count)} · ${Math.round((d.count / total) * 100)}%`}</Tx>}
            </g>
          );
        });
      }}
    />
  );
}

// ═════════════════ E. 评分构成 ═════════════════

const RATING_ZH: Record<string, string> = { Again: "遗忘", Hard: "吃力", Good: "通过", Easy: "轻松" };

export function RatingBar({ ratings }: { ratings: StatsOverview["ratings"] }) {
  const total = sum(ratings.map((r) => r.count));
  if (!total) return <Empty msg={t("近 30 天暂无复习记录")} height={180} />;
  const cnt = (k: string) => ratings.find((r) => r.rating === k)?.count || 0;
  const ORDER = ["Again", "Hard", "Good", "Easy"];
  const success = Math.round(((total - cnt("Again")) / total) * 100);
  return (
    <Chart
      headline={<><b className="cx-big">{success}%</b> <span className="cx-dim">{t("回忆成功率（非遗忘）")}</span></>}
      sub={t("近 30 天共评分 {n} 次", { n: fmtInt(total) })}
      height={134}
      build={(w, P) => {
        const col = [P.C[3], P.C[1], P.ACCENT, P.C[2]]; // 遗忘=砖红 / 吃力=琥珀 / 通过=焦点色 / 轻松=靛蓝
        const els: React.ReactNode[] = [];
        let x = 0;
        ORDER.forEach((k, i) => {
          const c = cnt(k), sw = (c / total) * w;
          if (c > 0) {
            els.push(
              <g key={k} className="cx-hit" data-tip={`${t(RATING_ZH[k])} ${k}\n${t("{n} 次", { n: fmtInt(c) })} · ${((c / total) * 100).toFixed(1)}%`}>
                <rect x={x} y={0} width={Math.max(sw - 1, 1)} height={30} fill={col[i]} />
                {sw > 46 && <Tx x={x + sw / 2} y={20} anchor="middle" s={12} w={700} fill={textOn(col[i], P)}>{`${Math.round((c / total) * 100)}%`}</Tx>}
              </g>
            );
          }
          x += sw;
        });
        const colW = w / 4;
        ORDER.forEach((k, i) => {
          const c = cnt(k), px = i * colW;
          els.push(<rect key={`k${i}`} x={px} y={54} width={10} height={10} fill={col[i]} />);
          els.push(<Tx key={`n${i}`} x={px + 16} y={63} s={12} fill={P.TEXT2}>{fit(t(RATING_ZH[k]), colW - 20, 12)}</Tx>);
          els.push(<Tx key={`p${i}`} x={px} y={96} s={24} w={650}>{`${((c / total) * 100).toFixed(c / total >= 0.1 ? 0 : 1)}%`}</Tx>);
          els.push(<Tx key={`c${i}`} x={px} y={116} fill={P.GREY3}>{t("{n} 次", { n: fmtInt(c) })}</Tx>);
        });
        return els;
      }}
    />
  );
}

// ═════════════════ F. 答题时长（单卡作答耗时：秒级） ═════════════════

export function DurationHist({ bins, medianMs, p90Ms }: { bins: number[]; medianMs: number; p90Ms: number }) {
  const total = sum(bins);
  if (!total) return <Empty msg={t("近 90 天暂无带时长的答题记录")} height={200} />;
  const medBin = Math.min(11, Math.floor(medianMs / 5000));
  return (
    <Chart
      headline={<>{t("单卡中位")} <b className="cx-big">{fmtDur(medianMs)}</b></>}
      sub={t("90% 的卡在 {dur} 内答完 · 共 {n} 次（已剔除超过 10 分钟的）", { dur: fmtDur(p90Ms), n: fmtInt(total) })}
      height={210}
      build={(w, P) => {
        const X0 = 40, X1 = w, BASE = 176, TOP = 12;
        const vmax = Math.max(...bins);
        const ticks = niceTicks(vmax, 3, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / 12, bw = pitch * 0.76;
        const medX = X0 + (Math.min(medianMs, 60000) / 60000) * (X1 - X0);
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {bins.map((v, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2, h = v > 0 ? Math.max(2, BASE - y(v)) : 0;
              return (
                <g key={i} className="cx-hit" data-tip={`${i * 5}–${i === 11 ? "60+" : i * 5 + 5} ${t("秒")}\n${t("{n} 次", { n: fmtInt(v) })} · ${Math.round((v / total) * 100)}%`}>
                  <rect x={X0 + i * pitch} y={TOP} width={pitch} height={BASE - TOP} fill="transparent" />
                  {h > 0 && <rect x={x} y={BASE - h} width={bw} height={h} fill={P.ACCENT} opacity={i === medBin ? 1 : 0.5} />}
                </g>
              );
            })}
            <line x1={medX} x2={medX} y1={TOP - 4} y2={BASE} stroke={P.INK} strokeWidth={1} strokeDasharray="4 4" />
            <Tx x={medX + (medX > X1 - 90 ? -6 : 6)} y={TOP + 6} anchor={medX > X1 - 90 ? "end" : "start"} w={650}>{t("中位 {dur}", { dur: fmtDur(medianMs) })}</Tx>
            {[0, 2, 4, 6, 8, 10, 12].map((e) => (
              <Tx key={e} x={X0 + e * pitch} y={BASE + 18} anchor={e === 0 ? "start" : e === 12 ? "end" : "middle"} fill={P.GREY3}>{e === 12 ? t("60 秒+") : `${e * 5}`}</Tx>
            ))}
          </g>
        );
      }}
    />
  );
}

export function DurationRanges({ fields }: { fields: StatsOverview["durationByField"] }) {
  const G = fields.slice(0, 6);
  if (!G.length) return <Empty msg={t("答题时长样本不足（每个领域需 ≥5 次）")} height={200} />;
  // 须线只画到 Tukey 围栏（Q3 + 1.5×四分位距）以内：个别「想了很久」的极端值不该把整条轴撑到几百秒、
  // 让真正的差异挤成一条线。更长的在悬浮提示里给出。
  const whisk = G.map((g) => {
    const iqr = g.q3 - g.q1;
    return { lo: Math.max(g.min, g.q1 - 1.5 * iqr), hi: Math.min(g.max, g.q3 + 1.5 * iqr) };
  });
  const maxMs = Math.max(...whisk.map((w) => w.hi));
  return (
    <Chart
      headline={t("各领域作答耗时")}
      sub={t("色块 = 中间一半的答题 · 白线 = 中位 · 细线 = 常规范围（更长的未画出，悬浮可见）")}
      height={G.length * 40 + 36}
      build={(w, P) => {
        const labW = Math.min(108, Math.max(...G.map((g) => textW(g.label, 12, 600))) + 4);
        const X0 = labW + 10, X1 = w - 64;
        const ticks = niceTicks(maxMs / 1000, 4, true);
        const top = ticks[ticks.length - 1] * 1000;
        const x = (ms: number) => X0 + (Math.min(ms, top) / top) * (X1 - X0);
        return (
          <g>
            {ticks.map((tk, i) => (
              <g key={i}>
                <line x1={x(tk * 1000)} x2={x(tk * 1000)} y1={16} y2={G.length * 40 + 20} stroke={i === 0 ? P.AXIS : P.GRID} strokeWidth={0.8} />
                <Tx x={x(tk * 1000)} y={10} anchor={i === 0 ? "start" : "middle"} fill={P.GREY3}>{t("{n}秒", { n: tk })}</Tx>
              </g>
            ))}
            {G.map((g, i) => {
              const cy = 40 + i * 40, wk = whisk[i];
              return (
                <g key={g.code} className="cx-hit" data-tip={`${g.label}（${g.count} 次）\n中位 ${fmtDur(g.median)}\n中间一半 ${fmtDur(g.q1)} – ${fmtDur(g.q3)}\n范围 ${fmtDur(g.min)} – ${fmtDur(g.max)}`}>
                  <rect x={0} y={cy - 18} width={w} height={36} fill="transparent" />
                  <Tx x={0} y={cy + 4} s={12} w={i === 0 ? 700 : 500} fill={i === 0 ? P.INK : P.TEXT2}>{fit(g.label, labW, 12)}</Tx>
                  <line x1={x(wk.lo)} x2={x(wk.hi)} y1={cy} y2={cy} stroke={P.GREY3} strokeWidth={1} />
                  <line x1={x(wk.lo)} x2={x(wk.lo)} y1={cy - 5} y2={cy + 5} stroke={P.GREY3} strokeWidth={1} />
                  <line x1={x(wk.hi)} x2={x(wk.hi)} y1={cy - 5} y2={cy + 5} stroke={P.GREY3} strokeWidth={1} />
                  <rect x={x(g.q1)} y={cy - 8} width={Math.max(x(g.q3) - x(g.q1), 4)} height={16} fill={P.C[i % P.C.length]} opacity={0.88} />
                  <line x1={x(g.median)} x2={x(g.median)} y1={cy - 8} y2={cy + 8} stroke={P.PAPER} strokeWidth={2.2} />
                  <Tx x={w} y={cy + 4} anchor="end" w={650} s={12}>{fmtDur(g.median)}</Tx>
                </g>
              );
            })}
          </g>
        );
      }}
    />
  );
}

// ═════════════════ G. 卡片生命周期 ═════════════════

export function FunnelBars({ funnel }: { funnel: StatsOverview["funnel"] }) {
  const S: [string, number, string][] = [
    [t("新建"), funnel.created, t("近 90 天新建的卡")],
    [t("已开始学"), funnel.firstLearned, t("至少学过一次")],
    [t("长期复习中"), funnel.reviewing, t("进入间隔复习")],
    [t("已巩固"), funnel.consolidated, t("记忆稳定度 > 21 天")]
  ];
  if (!S[0][1]) return <Empty msg={t("近 90 天没有新建卡片")} height={200} />;
  const top = S[0][1];
  return (
    <Chart
      headline={<><b className="cx-big">{Math.round((S[3][1] / top) * 100)}%</b> <span className="cx-dim">{t("新建卡已巩固")}</span></>}
      sub={t("近 90 天新建 {n} 张，逐级筛选", { n: fmtInt(top) })}
      height={S.length * 48 + 4}
      build={(w, P) => {
        const labW = 82, valW = 88, X0 = labW + 8, X1 = w - valW;
        return S.map(([name, c, tip], i) => {
          const y = i * 48 + 2, bw = Math.max(c > 0 ? 3 : 0, (c / top) * (X1 - X0));
          const conv = i > 0 && S[i - 1][1] > 0 ? Math.round((c / S[i - 1][1]) * 100) : null;
          return (
            <g key={name} className="cx-hit" data-tip={`${name}\n${t("{n} 张", { n: fmtInt(c) })} · ${tip}${conv !== null ? `\n${t("较上一级 {pct}%", { pct: conv })}` : ""}`}>
              <rect x={0} y={y} width={w} height={44} fill="transparent" />
              <Tx x={0} y={y + 20} s={12} w={650}>{name}</Tx>
              <rect x={X0} y={y + 6} width={X1 - X0} height={22} fill={P.GREY2} opacity={0.3} />
              <rect x={X0} y={y + 6} width={bw} height={22} fill={P.ACCENT} opacity={1 - i * 0.2} />
              <Tx x={X0 + bw + 8} y={y + 22} s={12} w={650}>{fmtInt(c)}</Tx>
              {conv !== null && <Tx x={w} y={y + 22} anchor="end" fill={P.GREY3}>{t("转化 {pct}%", { pct: conv })}</Tx>}
              <Tx x={X0} y={y + 41} fill={P.GREY3}>{fit(tip, X1 - X0, 11)}</Tx>
            </g>
          );
        });
      }}
    />
  );
}

// ═════════════════ H. 来源归属 ═════════════════

export function SourceBars({ books }: { books: StatsOverview["sourceBooks"] }) {
  if (!books.length) return <Empty msg={t("近 26 周暂无新建卡")} height={200} />;
  const MAIN: Record<string, string> = Object.fromEntries(UDC_MAIN.map((m) => [m.code, m.label]));
  const groups = new Map<string, { label: string; total: number; books: { book: string; count: number }[] }>();
  for (const b of books) {
    const key = b.main ?? "";
    const g = groups.get(key) ?? { label: b.main ? MAIN[b.main] || udcLabel(b.main) : t("未分类"), total: 0, books: [] };
    g.total += b.count;
    g.books.push({ book: b.book, count: b.count });
    groups.set(key, g);
  }
  const G = [...groups.values()].sort((a, b) => b.total - a.total);
  const shown = G.slice(0, 5);
  const total = sum(G.map((g) => g.total));
  type Row = { head: boolean; label: string; count: number; gi: number };
  const rows: Row[] = [];
  shown.forEach((g, gi) => {
    rows.push({ head: true, label: g.label, count: g.total, gi });
    const bs = g.books.sort((a, b) => b.count - a.count);
    bs.slice(0, 3).forEach((b) => rows.push({ head: false, label: b.book, count: b.count, gi }));
    if (bs.length > 3) rows.push({ head: false, label: t("其余 {n} 个来源", { n: bs.length - 3 }), count: sum(bs.slice(3).map((b) => b.count)), gi });
  });
  if (G.length > shown.length) rows.push({ head: true, label: t("其他 {n} 个领域", { n: G.length - shown.length }), count: sum(G.slice(5).map((g) => g.total)), gi: 5 });
  return (
    <Chart
      headline={<><b className="cx-big">{fmtInt(total)}</b> {t("张")} <span className="cx-dim">{t("近 26 周新建")}</span></>}
      sub={t("按领域归组，缩进行是该领域下的来源书")}
      height={rows.reduce((a, r) => a + (r.head ? 30 : 24), 0) + 4}
      build={(w, P) => {
        const vmax = Math.max(...rows.filter((r) => r.head).map((r) => r.count)), valW = 48;
        const labMax = Math.max(...rows.map((r) => (r.head ? 0 : 20) + textW(r.label, r.head ? 12 : 11, r.head ? 700 : 500)));
        let y = 2;
        return rows.map((r, i) => {
          const rh = r.head ? 30 : 24, X0 = r.head ? 0 : 20, X1 = w - valW;
          const labW = Math.max(60, Math.min(labMax - X0 + 4, (X1 - X0) * 0.45));
          const bx = X0 + labW + 10, bw = Math.max(2, (r.count / vmax) * (w - valW - bx));
          const col = P.C[r.gi % P.C.length], cy = y;
          y += rh;
          return (
            <g key={i} className="cx-hit" data-tip={`${r.label}\n${t("{n} 张", { n: fmtInt(r.count) })}`}>
              <rect x={0} y={cy} width={w} height={rh} fill="transparent" />
              <Tx x={X0} y={cy + (r.head ? 20 : 16)} s={r.head ? 12 : 11} w={r.head ? 700 : 500} fill={r.head ? P.INK : P.TEXT2}>{fit(r.label, labW, r.head ? 12 : 11, r.head ? 700 : 500)}</Tx>
              <rect x={bx} y={cy + (r.head ? 9 : 8)} width={bw} height={r.head ? 12 : 8} fill={col} opacity={r.head ? 0.95 : 0.5} />
              <Tx x={w} y={cy + (r.head ? 20 : 16)} anchor="end" s={r.head ? 12 : 11} w={r.head ? 700 : 500} fill={r.head ? P.INK : P.GREY3}>{fmtInt(r.count)}</Tx>
            </g>
          );
        });
      }}
    />
  );
}

// ═════════════════ I. 学习节律 ═════════════════

/** 24 小时分布：每个整点的复习量，遗忘部分叠在上面 */
export function RhythmHours({ hours }: { hours: StatsOverview["rhythmHours"] }) {
  const total = sum(hours.map((h) => h.count));
  if (!total) return <Empty msg={t("近 90 天暂无复习记录")} height={200} />;
  const peak = hours.reduce((a, b, i) => (b.count > hours[a].count ? i : a), 0);
  return (
    <Chart
      headline={<>{t("最勤在")} <b className="cx-big">{String(peak).padStart(2, "0")}:00</b> <span className="cx-dim">{t("{pct}% 的复习发生在这一小时", { pct: Math.round((hours[peak].count / total) * 100) })}</span></>}
      sub={t("近 90 天 {n} 次评分，按钟面整点统计", { n: fmtInt(total) })}
      legend={[{ label: t("答对"), color: "var(--accent)" }, { label: t("遗忘 Again"), color: "var(--chart-4)" }]}
      height={210}
      build={(w, P) => {
        const X0 = 40, X1 = w, BASE = 176, TOP = 12;
        const ticks = niceTicks(Math.max(...hours.map((h) => h.count)), 3, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / 24, bw = pitch * 0.72;
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {hours.map((h, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2;
              const good = h.count - h.again;
              const hg = good > 0 ? Math.max(2, BASE - y(good)) : 0, ha = h.again > 0 ? Math.max(2, BASE - y(h.again)) : 0;
              return (
                <g key={i} className="cx-hit" data-tip={`${String(i).padStart(2, "0")}:00–${String(i + 1).padStart(2, "0")}:00\n${t("{n} 次评分", { n: fmtInt(h.count) })}\n${t("遗忘 {n} 次", { n: h.again })}${h.count ? t("（{pct}%）", { pct: Math.round((h.again / h.count) * 100) }) : ""}`}>
                  <rect x={X0 + i * pitch} y={TOP} width={pitch} height={BASE - TOP} fill="transparent" />
                  {hg > 0 && <rect x={x} y={BASE - hg} width={bw} height={hg} fill={P.ACCENT} opacity={i === peak ? 1 : 0.55} />}
                  {ha > 0 && <rect x={x} y={BASE - hg - ha - (hg > 0 ? 1 : 0)} width={bw} height={ha} fill={P.C[3]} opacity={0.9} />}
                </g>
              );
            })}
            {[0, 3, 6, 9, 12, 15, 18, 21].map((hh) => (
              <Tx key={hh} x={X0 + hh * pitch + pitch / 2} y={BASE + 18} anchor="middle" fill={P.GREY3}>{t("{hh}时", { hh })}</Tx>
            ))}
          </g>
        );
      }}
    />
  );
}

/** 星期 × 时段热力 */
export function RhythmGrid({ grid }: { grid: number[][] }) {
  const flat = grid.flat();
  const vmax = Math.max(0, ...flat);
  if (!vmax) return <Empty msg={t("近 90 天暂无复习记录")} height={200} />;
  const NAMES = [0, 1, 2, 3, 4, 5, 6].map(weekFull);
  const rowSum = grid.map(sum);
  const bd = rowSum.indexOf(Math.max(...rowSum));
  let bh = 0, bv = -1;
  for (let h = 0; h < 24; h++) { const v = sum(grid.map((r) => r[h])); if (v > bv) { bv = v; bh = h; } }
  return (
    <Chart
      headline={<>{NAMES[bd]} · <b className="cx-big">{String(bh).padStart(2, "0")}:00</b> <span className="cx-dim">{t("是你最常复习的时段")}</span></>}
      sub={t("近 90 天，行 = 星期，列 = 钟面整点；越深越多")}
      legend={[{ label: "", ramp: { from: t("少"), to: t("多"), color: "var(--accent)" } }]}
      height={(w) => 22 + 7 * (clamp((w - 36) / 24 - 2, 8, 26) + 2)}
      build={(w, P) => {
        const cw = clamp((w - 36) / 24 - 2, 8, 26), X0 = 36;
        // 格宽有上限，网格内容总宽不足卡宽时整体居中（星期标签同移）
        const ox = Math.max(0, (w - (X0 + 24 * (cw + 2) - 2)) / 2);
        const els: React.ReactNode[] = [];
        for (let h = 0; h < 24; h += 3) els.push(<Tx key={`h${h}`} x={ox + X0 + h * (cw + 2)} y={12} fill={P.GREY3}>{`${h}`}</Tx>);
        NAMES.forEach((nm, r) => {
          els.push(<Tx key={`n${r}`} x={ox} y={22 + r * (cw + 2) + cw / 2 + 4} fill={P.GREY3}>{weekMini(r + 1)}</Tx>);
          for (let h = 0; h < 24; h++) {
            const v = grid[r][h], f = v / vmax;
            els.push(
              <rect key={`${r}-${h}`} x={ox + X0 + h * (cw + 2)} y={22 + r * (cw + 2)} width={cw} height={cw}
                fill={v ? P.ACCENT : P.GREY2} opacity={v ? 0.16 + 0.84 * Math.sqrt(f) : 0.4} className="cx-hit"
                data-tip={`${nm} ${String(h).padStart(2, "0")}:00\n${t("{n} 次评分", { n: v })}`} />
            );
          }
        });
        return els;
      }}
    />
  );
}

// ═════════════════ J. 领域排名 ═════════════════

export function RankBump({ rows, months }: { rows: StatsOverview["domainRank"]; months: StatsOverview["domainRankMonths"] }) {
  const R = rows.filter((r) => r.ranks.some((x) => x > 0)).slice(0, 6);
  if (!R.length) return <Empty msg={t("近 6 个月暂无领域复习数据")} height={200} />;
  const maxRank = Math.max(...R.flatMap((r) => r.ranks), 1);
  const lead = R[0];
  return (
    <Chart
      headline={<>{t("本月第一")} <b className="cx-big">{lead.label}</b></>}
      sub={t("每条线是一个领域在各月复习量中的名次（1 = 最多）；断开 = 当月没复习")}
      height={Math.max(210, maxRank * 34 + 52)}
      build={(w, P) => {
        const endW = Math.min(112, Math.max(...R.map((r) => textW(r.label, 12, 600))) + 8);
        const X0 = 28, X1 = w - endW - 6, Y0 = 32;
        const n = months.length;
        const x = (i: number) => X0 + (n === 1 ? 0 : (i / (n - 1)) * (X1 - X0));
        const rowH = 34, y = (rank: number) => Y0 + (rank - 1) * rowH;
        const els: React.ReactNode[] = [];
        months.forEach((m, i) => els.push(<Tx key={`m${i}`} x={x(i)} y={12} anchor="middle" fill={P.GREY3}>{t("{m}月", { m: m.month })}</Tx>));
        for (let k = 1; k <= maxRank; k++) {
          els.push(<line key={`g${k}`} x1={X0} x2={X1} y1={y(k)} y2={y(k)} stroke={P.GRID} strokeWidth={0.8} />);
          els.push(<Tx key={`r${k}`} x={0} y={y(k) + 4} fill={k === 1 ? P.INK : P.GREY3} w={k === 1 ? 700 : 500}>{`${k}`}</Tx>);
        }
        R.forEach((r, ci) => {
          const col = P.C[ci % P.C.length];
          let d = "", pen = false;
          r.ranks.forEach((rk, i) => {
            if (rk <= 0) { pen = false; return; }
            d += `${pen ? " L" : "M"}${x(i)} ${y(rk)}`;
            pen = true;
          });
          els.push(<path key={`p${ci}`} d={d} fill="none" stroke={col} strokeWidth={ci === 0 ? 2.4 : 1.6} />);
          r.ranks.forEach((rk, i) => {
            if (rk <= 0) return;
            els.push(<rect key={`d${ci}-${i}`} x={x(i) - 4} y={y(rk) - 4} width={8} height={8} fill={col} className="cx-hit"
              data-tip={`${r.label} · ${t("{m}月", { m: months[i].month })}\n${t("第 {rk} 名 · {n} 次评分", { rk, n: r.counts[i] })}`} />);
          });
          const last = [...r.ranks].map((v, i) => [v, i] as const).filter(([v]) => v > 0).pop();
          if (last) els.push(<Tx key={`e${ci}`} x={x(n - 1) + 12} y={y(last[0]) + 4} w={ci === 0 ? 700 : 600} fill={col}>{fit(r.label, endW, 12, 600)}</Tx>);
        });
        return els;
      }}
    />
  );
}

// ═════════════════ K. 队列水位 ═════════════════

export function QueueLedger({ q }: { q: StatsOverview["queueFlow"] }) {
  const rows: [string, number, string, string][] = [
    [t("本月新建卡"), q.newCards, "var(--accent)", t("新进入队列的卡")],
    [t("本月复习过的卡"), q.completed, "var(--chart-3)", t("至少评过一次的不同卡片数")],
    [t("本月跳过"), q.skipped, "var(--grey-3)", t("被主动跳过的卡")],
    [t("当前逾期"), q.overdue, "var(--chart-4)", t("已过期还没复习的卡（需要优先清掉）")]
  ];
  const vmax = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Chart
      headline={<>{t("逾期")} <b className="cx-big" style={q.overdue > 0 ? { color: "var(--chart-4)" } : undefined}>{q.overdue}</b> {t("张")} <span className="cx-dim">{t("本月已复习 {n} 张", { n: fmtInt(q.completed) })}</span></>}
      sub={t("进多少、消化多少、还欠多少")}
      height={rows.length * 40 + 4}
      build={(w, P) => {
        const labW = Math.min(112, Math.max(...rows.map((r) => textW(r[0], 12, 600))) + 4), valW = 52, X0 = labW + 10, X1 = w - valW;
        const colors = [P.ACCENT, P.C[2], P.GREY3, P.C[3]];
        return rows.map(([name, v, , tip], i) => {
          const y = i * 40 + 2, bw = Math.max(v > 0 ? 3 : 0, (v / vmax) * (X1 - X0));
          return (
            <g key={name} className="cx-hit" data-tip={`${name}\n${t("{n} 张", { n: fmtInt(v) })}\n${tip}`}>
              <rect x={0} y={y} width={w} height={38} fill="transparent" />
              <Tx x={0} y={y + 23} s={12} w={600} fill={P.TEXT2}>{fit(name, labW, 12, 600)}</Tx>
              <rect x={X0} y={y + 10} width={X1 - X0} height={16} fill={P.GREY2} opacity={0.3} />
              <rect x={X0} y={y + 10} width={bw} height={16} fill={colors[i]} />
              <Tx x={w} y={y + 23} anchor="end" s={13} w={700}>{fmtInt(v)}</Tx>
            </g>
          );
        });
      }}
    />
  );
}

/** 到期预测：未来 14 天每天到期的老卡 + 已逾期 */
export function DueForecast({ overdue, forecast }: { overdue: number; forecast: number[] }) {
  const next7 = sum(forecast.slice(0, 7));
  const data = [overdue, ...forecast];
  const vmax = Math.max(...data, 1);
  if (data.every((v) => v === 0)) return <Empty msg={t("未来 14 天没有到期的卡片")} height={200} />;
  const peakI = forecast.reduce((a, b, i) => (b > forecast[a] ? i : a), 0);
  const base0 = new Date(); base0.setHours(0, 0, 0, 0);
  return (
    <Chart
      headline={<>{t("未来 7 天预计到期")} <b className="cx-big">{fmtInt(next7)}</b> {t("张")}</>}
      sub={t("峰值在{when}（{n} 张）· 只含已学过的卡，不含新卡", { when: peakI === 0 ? t("今天") : t("第 {n} 天", { n: peakI + 1 }), n: forecast[peakI] })}
      height={210}
      build={(w, P) => {
        const X0 = 36, X1 = w, BASE = 176, TOP = 18;
        const ticks = niceTicks(vmax, 3, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / data.length, bw = pitch * 0.7;
        const every = pitch < 34 ? 2 : 1;
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {data.map((v, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2, h = v > 0 ? Math.max(2, BASE - y(v)) : 0;
              const dt = new Date(base0.getTime() + (i - 1) * 86400000);
              const name = i === 0 ? t("已逾期") : i === 1 ? t("今天") : `${md(dt.getTime())} ${weekShort(dt.getDay())}`;
              return (
                <g key={i} className="cx-hit" data-tip={`${name}\n${t("{n} 张到期", { n: v })}`}>
                  <rect x={X0 + i * pitch} y={TOP} width={pitch} height={BASE - TOP} fill="transparent" />
                  {h > 0 && <rect x={x} y={BASE - h} width={bw} height={h} fill={i === 0 ? P.C[3] : P.ACCENT} opacity={i <= 1 ? 1 : 0.6} />}
                  {v > 0 && bw >= 14 && <Tx x={x + bw / 2} y={BASE - h - 5} anchor="middle" w={650}>{v}</Tx>}
                  {i % every === 0 && <Tx x={x + bw / 2} y={BASE + 18} anchor="middle" fill={i === 0 ? P.C[3] : P.GREY3}>{i === 0 ? t("逾期") : i === 1 ? t("今天") : i === 2 || dt.getDate() === 1 ? md(dt.getTime()) : String(dt.getDate())}</Tx>}
                </g>
              );
            })}
          </g>
        );
      }}
    />
  );
}

// ═════════════════ L. 阅读输入 ═════════════════

export function ReadingHist({ days }: { days: Day[] }) {
  const vals = days.map((d) => d.value).filter((v) => v > 0);
  if (!vals.length) return <Empty msg={t("暂无阅读记录")} height={200} />;
  const CAPS = [1000, 2000, 3000, 5000, 8000, Infinity];
  const LABELS = [t("<1千"), t("1–2千"), t("2–3千"), t("3–5千"), t("5–8千"), t("8千+")];
  const bins = Array(CAPS.length).fill(0);
  for (const c of vals) bins[CAPS.findIndex((cap) => c < cap)]++;
  const sorted = [...vals].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const peak = bins.indexOf(Math.max(...bins));
  return (
    <Chart
      headline={<>{t("中位每个阅读日读")} <b className="cx-big">{shortNum(med)}</b> {t("字")}</>}
      sub={t("共 {n} 个阅读日 · 一柱 = 一档日阅读字数", { n: vals.length })}
      height={200}
      build={(w, P) => {
        const X0 = 36, X1 = w, BASE = 166, TOP = 14;
        const ticks = niceTicks(Math.max(...bins), 3, true);
        const top = ticks[ticks.length - 1];
        const y = (v: number) => BASE - (v / top) * (BASE - TOP);
        const pitch = (X1 - X0) / bins.length, bw = Math.min(70, pitch * 0.62);
        return (
          <g>
            <YGrid ticks={ticks} y={y} x0={X0} x1={X1} P={P} />
            {bins.map((v, i) => {
              const x = X0 + i * pitch + (pitch - bw) / 2, h = v > 0 ? Math.max(2, BASE - y(v)) : 0;
              return (
                <g key={i} className="cx-hit" data-tip={`${t("日读 {n} 字", { n: LABELS[i] })}\n${t("{v} 天", { v })} · ${Math.round((v / vals.length) * 100)}%`}>
                  <rect x={X0 + i * pitch} y={TOP} width={pitch} height={BASE - TOP} fill="transparent" />
                  {h > 0 && <rect x={x} y={BASE - h} width={bw} height={h} fill={P.ACCENT} opacity={i === peak ? 1 : 0.5} />}
                  {v > 0 && <Tx x={x + bw / 2} y={BASE - h - 6} anchor="middle" w={650} fill={i === peak ? P.ACCENT : P.INK}>{`${Math.round((v / vals.length) * 100)}%`}</Tx>}
                  <Tx x={x + bw / 2} y={BASE + 18} anchor="middle" fill={P.GREY3}>{LABELS[i]}</Tx>
                </g>
              );
            })}
          </g>
        );
      }}
    />
  );
}

export type { Pal };
