// 一日时间轴（甘特图）：把阅读 / 摘录 / 复习 / 制卡 / 日记摊在 24 小时轴上，
// 回答「我这一天的时间花在了哪里、什么时候在学」。
//  - 日视图：五条泳道（一类一道），每个时段块是一根任务条；今天会画「现在」游标；下方是时间分配汇总。
//  - 周视图：近 7 天各一行，五类叠成五条细轨，一眼看出作息规律；点某一天下钻到日视图。
// 数据口径见 electron/statsTimeline.js（同类事件相隔 ≤ 3~5 分钟并成一块；瞬时事件至少按 30 秒计，时长为估算）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { statsApi, TIMELINE_KINDS, type StatsTimeline, type TimelineBlock, type TimelineDay, type TimelineKind } from "../../lib/stats";
import { eventBus } from "../../lib/eventbus";
import { IconChevronLeft, IconChevronRight } from "../icons";
import { Chart, Empty, Tx, fit, fmtInt, fmtMin, hhmm, mdw, shortNum, textOn, textW, WEEK_ZH, type Pal } from "./kit";

const DAY = 86400_000;

export const KIND_META: Record<TimelineKind, { label: string; ci: number; unit: string }> = {
  read: { label: "阅读", ci: 2, unit: "字" },
  extract: { label: "摘录", ci: 1, unit: "条" },
  review: { label: "复习", ci: 0, unit: "次" },
  card: { label: "制卡", ci: 4, unit: "张" },
  journal: { label: "日记", ci: 5, unit: "条" }
};
const kindColor = (k: TimelineKind, P: Pal) => P.C[KIND_META[k].ci];
const kindVar = (k: TimelineKind) => (KIND_META[k].ci === 0 ? "var(--accent)" : `var(--chart-${KIND_META[k].ci + 1})`);

function blockTip(b: TimelineBlock): string {
  const m = KIND_META[b.kind];
  const lines = [`${m.label} · ${hhmm(b.start)}–${hhmm(b.end)}`];
  if (b.kind === "read") {
    lines.push(`约 ${fmtMin(b.durationMs)} · 读了 ${fmtInt(b.chars)} 字`);
    if (b.titles.length) lines.push(...b.titles.slice(0, 2).map((t) => `《${[...t].slice(0, 18).join("")}${[...t].length > 18 ? "…" : ""}》`));
  } else if (b.kind === "review") {
    lines.push(`约 ${fmtMin(b.durationMs)} · ${b.count} 次评分`);
    const parts = [] as string[];
    if (b.sub.card) parts.push(`卡片 ${b.sub.card}`);
    if (b.sub.extract) parts.push(`摘录 ${b.sub.extract}`);
    lines.push(parts.join(" · "));
    if (b.again) lines.push(`遗忘 ${b.again} 次`);
  } else if (b.kind === "extract") {
    lines.push(`摘录 ${b.count - b.hl} 条${b.hl ? ` · 高亮 ${b.hl} 处` : ""}`);
  } else if (b.kind === "card") {
    lines.push(`新建 ${b.count} 张卡`);
  } else {
    lines.push(`写了 ${b.count} 条日记`);
  }
  return lines.join("\n");
}

function blockLabel(b: TimelineBlock): string {
  switch (b.kind) {
    case "read": return b.chars > 0 ? `${shortNum(b.chars)}字` : "阅读";
    case "review": return `${b.count}次`;
    case "extract": return `${b.count}条`;
    case "card": return `${b.count}张`;
    default: return `${b.count}条`;
  }
}

const HOUR = 3600_000;
type Win = [number, number]; // 相对学习日起点的毫秒偏移 [起, 止]，整点对齐

/** 可见时间窗：聚焦=覆盖全部时段块 ±30 分钟（整点对齐，至少 6 小时）；全天=整个学习日 */
function focusWindow(days: TimelineDay[], focus: boolean): Win {
  const spans = days.filter((d) => d.first !== null && d.last !== null).map((d) => [d.first! - d.date, d.last! - d.date] as const);
  if (!focus || !spans.length) return [0, DAY];
  let a = Math.floor((Math.min(...spans.map((x) => x[0])) - 30 * 60_000) / HOUR) * HOUR;
  let b = Math.ceil((Math.max(...spans.map((x) => x[1])) + 30 * 60_000) / HOUR) * HOUR;
  a = Math.max(0, a); b = Math.min(DAY, b);
  if (b - a < 6 * HOUR) {
    const mid = (a + b) / 2;
    a = Math.max(0, Math.round((mid - 3 * HOUR) / HOUR) * HOUR);
    b = Math.min(DAY, a + 6 * HOUR);
    a = Math.max(0, b - 6 * HOUR);
  }
  return [a, b];
}

/** 轴刻度：按像素密度选整点间隔；startClock = 窗口起点的钟面小时 */
function axisTicks(plotW: number, win: Win, h0: number) {
  const span = (win[1] - win[0]) / HOUR;
  const startClock = h0 + win[0] / HOUR;
  const perH = plotW / span;
  const step = perH >= 42 ? 1 : perH >= 24 ? 2 : perH >= 15 ? 3 : 4;
  const out: { k: number; label: string }[] = [];
  for (let k = 0; k <= span + 1e-9; k += step) out.push({ k, label: `${String(Math.round(startClock + k) % 24).padStart(2, "0")}:00` });
  return { span, startClock, ticks: out };
}

function Toolbar(p: {
  title: string; sub?: string; canNext: boolean; onPrev: () => void; onNext: () => void; onToday: () => void; isToday: boolean;
  focus: boolean; onFocus: (v: boolean) => void;
}) {
  return (
    <div className="tl-bar">
      <div className="tl-nav">
        <button type="button" className="icon-btn" aria-label="上一段" onClick={p.onPrev}><IconChevronLeft size={16} /></button>
        <div className="tl-date"><b>{p.title}</b>{p.sub && <span>{p.sub}</span>}</div>
        <button type="button" className="icon-btn" aria-label="下一段" disabled={!p.canNext} onClick={p.onNext}><IconChevronRight size={16} /></button>
        <button type="button" className="btn btn-outline btn-sm" disabled={p.isToday} onClick={p.onToday}>回到今天</button>
      </div>
      <div className="seg-tabs seg-tabs-sm" role="group" aria-label="时间范围">
        <button type="button" className={p.focus ? "active" : ""} onClick={() => p.onFocus(true)}>聚焦活跃时段</button>
        <button type="button" className={p.focus ? "" : "active"} onClick={() => p.onFocus(false)}>全天 24 小时</button>
      </div>
    </div>
  );
}

// ───────────── 日视图 ─────────────

const LANE_H = 40, AXIS_H = 26, LABEL_W = 62;

function DayGantt({ day, now, cutoffClock, win }: { day: TimelineDay; now: number; cutoffClock: number; win: Win }) {
  const total = day.blocks.length;
  const first = day.first, last = day.last;
  const headline = total
    ? <><b className="cx-big">{fmtMin(day.activeMs)}</b> 活跃 <span className="cx-dim">{hhmm(first!)} – {hhmm(last!)} · 共 {total} 个时段{day.longestMs >= 60_000 ? ` · 最长一段 ${fmtMin(day.longestMs)}` : ""}</span></>
    : "这一天没有记录";
  return (
    <Chart
      headline={headline}
      legend={TIMELINE_KINDS.map((k) => ({ label: KIND_META[k].label, color: kindVar(k) }))}
      height={AXIS_H + TIMELINE_KINDS.length * LANE_H + 6}
      label={`一日时间轴 ${mdw(day.date)}`}
      build={(w, P) => {
        const X0 = LABEL_W, X1 = w - 6, PW = Math.max(X1 - X0, 40);
        const span = win[1] - win[0];
        const x = (t: number) => X0 + ((t - day.date - win[0]) / span) * PW;
        const { ticks, span: spanH, startClock } = axisTicks(PW, win, cutoffClock);
        const els: React.ReactNode[] = [];
        // 夜间底纹（钟面 22:00–06:00）
        for (let k = 0; k < Math.ceil(spanH); k++) {
          const clock = Math.floor(startClock + k) % 24;
          if (clock < 6 || clock >= 22) els.push(<rect key={`n${k}`} x={X0 + (k / spanH) * PW} y={AXIS_H} width={Math.min(PW / spanH, X0 + PW - (X0 + (k / spanH) * PW))} height={TIMELINE_KINDS.length * LANE_H} fill={P.GREY2} opacity={0.22} />);
        }
        // 泳道底
        TIMELINE_KINDS.forEach((k, i) => {
          const y = AXIS_H + i * LANE_H;
          if (i % 2 === 0) els.push(<rect key={`b${k}`} x={X0} y={y} width={PW} height={LANE_H} fill={P.GREY2} opacity={0.14} />);
          els.push(<line key={`s${k}`} x1={0} x2={X1} y1={y + LANE_H} y2={y + LANE_H} stroke={P.GRID} strokeWidth={0.8} />);
          const t = day.totals[k];
          els.push(<rect key={`c${k}`} x={0} y={y + LANE_H / 2 - 5} width={10} height={10} fill={kindColor(k, P)} />);
          els.push(<Tx key={`l${k}`} x={16} y={y + LANE_H / 2 + 4} s={12} w={650} fill={t.blocks ? P.INK : P.GREY3}>{KIND_META[k].label}</Tx>);
        });
        // 小时刻度
        ticks.forEach(({ k, label }, i) => {
          const gx = X0 + (k / spanH) * PW;
          els.push(<line key={`g${k}`} x1={gx} x2={gx} y1={AXIS_H - 4} y2={AXIS_H + TIMELINE_KINDS.length * LANE_H} stroke={P.GRID} strokeWidth={0.8} />);
          const anchor = i === 0 ? "start" : k >= spanH - 1e-9 ? "end" : "middle";
          els.push(<Tx key={`t${k}`} x={gx} y={14} anchor={anchor} fill={P.GREY3}>{label}</Tx>);
        });
        // 时段块
        day.blocks.forEach((b, i) => {
          const li = TIMELINE_KINDS.indexOf(b.kind);
          const bx = x(b.start), bw = Math.max(4, Math.min(x(b.start + b.durationMs), X0 + PW) - bx);
          const by = AXIS_H + li * LANE_H + 8, bh = LANE_H - 16, col = kindColor(b.kind, P);
          const lbl = blockLabel(b);
          els.push(
            <g key={`blk${i}`} className="cx-hit" data-tip={blockTip(b)}>
              <rect x={bx} y={by} width={bw} height={bh} fill={col} opacity={0.92} stroke={P.PAPER} strokeWidth={0.8} />
              {b.again > 0 && b.kind === "review" && <rect x={bx} y={by + bh - 3} width={Math.max(2, bw * Math.min(1, b.again / b.count))} height={3} fill={P.C[3]} />}
              {bw > textW(lbl, 11, 650) + 10 && <Tx x={bx + bw / 2} y={by + bh / 2 + 4} anchor="middle" w={650} fill={textOn(col, P)}>{lbl}</Tx>}
            </g>
          );
        });
        // 「现在」游标
        if (now >= day.date + win[0] && now <= day.date + win[1]) {
          const nx = x(now);
          els.push(<line key="now" x1={nx} x2={nx} y1={AXIS_H - 6} y2={AXIS_H + TIMELINE_KINDS.length * LANE_H} stroke={P.INK} strokeWidth={1.2} strokeDasharray="3 3" />);
          els.push(<rect key="nowd" x={nx - 3} y={AXIS_H - 9} width={6} height={6} fill={P.INK} />);
        }
        if (!total) els.push(<Tx key="empty" x={X0 + PW / 2} y={AXIS_H + (TIMELINE_KINDS.length * LANE_H) / 2 + 4} anchor="middle" s={12} w={600} fill={P.GREY3}>这一天没有阅读、摘录、复习或制卡记录</Tx>);
        return els;
      }}
    />
  );
}

/** 时间分配汇总：估算时长占比条 + 五类读数 */
function Allocation({ day }: { day: TimelineDay }) {
  const ms = TIMELINE_KINDS.map((k) => day.totals[k].ms);
  const sumMs = ms.reduce((a, b) => a + b, 0);
  if (!sumMs) return null;
  return (
    <Chart
      height={112}
      headline="时间怎么分配的"
      sub="按各类时段的估算时长占比；摘录 / 制卡 / 日记是瞬时动作，每段至少按 30 秒计"
      label="一日时间分配"
      build={(w, P) => {
        const els: React.ReactNode[] = [];
        let x = 0;
        TIMELINE_KINDS.forEach((k, i) => {
          if (!ms[i]) return;
          const sw = (ms[i] / sumMs) * w;
          const pct = Math.round((ms[i] / sumMs) * 100);
          els.push(
            <g key={k} className="cx-hit" data-tip={`${KIND_META[k].label}\n约 ${fmtMin(ms[i])} · ${pct}%`}>
              <rect x={x} y={0} width={Math.max(sw - 1, 1)} height={24} fill={kindColor(k, P)} />
              {sw > 44 && <Tx x={x + sw / 2} y={16} anchor="middle" w={700} fill={textOn(kindColor(k, P), P)}>{`${pct}%`}</Tx>}
            </g>
          );
          x += sw;
        });
        const colW = w / TIMELINE_KINDS.length;
        TIMELINE_KINDS.forEach((k, i) => {
          const t = day.totals[k], px = i * colW;
          const main = k === "read" || k === "review" ? fmtMin(t.ms) : `${fmtInt(t.count)} ${KIND_META[k].unit}`;
          const detail = k === "read" ? `${fmtInt(t.chars)} 字 · ${t.blocks} 段`
            : k === "review" ? `${fmtInt(t.count)} 次${t.again ? ` · 遗忘 ${t.again}` : ""}`
            : `${t.blocks} 段`;
          els.push(<rect key={`c${k}`} x={px} y={42} width={8} height={8} fill={kindColor(k, P)} />);
          els.push(<Tx key={`n${k}`} x={px + 13} y={50} s={11} fill={P.TEXT2}>{KIND_META[k].label}</Tx>);
          els.push(<Tx key={`m${k}`} x={px} y={74} s={t.count ? 17 : 15} w={650} fill={t.count ? P.INK : P.GREY3}>{fit(t.count ? main : "—", colW - 8, 17, 650)}</Tx>);
          els.push(<Tx key={`d${k}`} x={px} y={92} s={11} fill={P.GREY3}>{fit(t.count ? detail : "没有记录", colW - 8, 11)}</Tx>);
        });
        return els;
      }}
    />
  );
}

// ───────────── 周视图 ─────────────

function WeekGantt({ days, now, cutoffClock, win, onPick }: { days: TimelineDay[]; now: number; cutoffClock: number; win: Win; onPick: (date: number) => void }) {
  const ROW_H = 38, BAND = 5, GAP = 1;
  const activeDays = days.filter((d) => d.activeMs > 0);
  const avg = activeDays.length ? activeDays.reduce((a, d) => a + d.activeMs, 0) / days.length : 0;
  const busiest = days.reduce((a, d) => (d.activeMs > a.activeMs ? d : a), days[0]);
  return (
    <Chart
      headline={activeDays.length ? <>日均活跃 <b className="cx-big">{fmtMin(avg)}</b> <span className="cx-dim">最忙是 {mdw(busiest.date)}（{fmtMin(busiest.activeMs)}）</span></> : "近 7 天没有记录"}
      sub="每一行是一天，五条细轨依次为 阅读 · 摘录 · 复习 · 制卡 · 日记；点某一天可查看当天明细"
      legend={TIMELINE_KINDS.map((k) => ({ label: KIND_META[k].label, color: kindVar(k) }))}
      height={AXIS_H + days.length * ROW_H + 4}
      label="近 7 天时间轴"
      build={(w, P) => {
        const L = 78, R = 74, X0 = L, X1 = w - R, PW = Math.max(X1 - X0, 40);
        const { ticks, span: spanH, startClock } = axisTicks(PW, win, cutoffClock);
        const span = win[1] - win[0];
        const els: React.ReactNode[] = [];
        for (let k = 0; k < Math.ceil(spanH); k++) {
          const clock = Math.floor(startClock + k) % 24;
          if (clock < 6 || clock >= 22) els.push(<rect key={`n${k}`} x={X0 + (k / spanH) * PW} y={AXIS_H} width={Math.min(PW / spanH, X0 + PW - (X0 + (k / spanH) * PW))} height={days.length * ROW_H} fill={P.GREY2} opacity={0.22} />);
        }
        ticks.forEach(({ k, label }, i) => {
          const gx = X0 + (k / spanH) * PW;
          els.push(<line key={`g${k}`} x1={gx} x2={gx} y1={AXIS_H - 4} y2={AXIS_H + days.length * ROW_H} stroke={P.GRID} strokeWidth={0.8} />);
          els.push(<Tx key={`t${k}`} x={gx} y={14} anchor={i === 0 ? "start" : k >= spanH - 1e-9 ? "end" : "middle"} fill={P.GREY3}>{label}</Tx>);
        });
        days.forEach((d, r) => {
          const y = AXIS_H + r * ROW_H, isToday = now >= d.date && now < d.date + DAY;
          const wk = [0, 6].includes(new Date(d.date).getDay());
          els.push(
            <g key={`r${r}`} className="tl-row" onClick={() => onPick(d.date)} data-tip={`${mdw(d.date)}\n点击查看当天明细${d.activeMs ? `\n活跃 ${fmtMin(d.activeMs)}` : "\n没有记录"}`}>
              <rect x={0} y={y} width={w} height={ROW_H} fill="transparent" />
              <line x1={0} x2={w} y1={y + ROW_H} y2={y + ROW_H} stroke={P.GRID} strokeWidth={0.8} />
              <Tx x={0} y={y + ROW_H / 2 + 4} s={12} w={isToday ? 700 : 500} fill={isToday ? P.ACCENT : wk ? P.GREY3 : P.INK}>{`${d.date ? `${new Date(d.date).getMonth() + 1}/${new Date(d.date).getDate()}` : ""} 周${WEEK_ZH[new Date(d.date).getDay()]}`}</Tx>
              <Tx x={w} y={y + ROW_H / 2 + 4} s={12} w={650} anchor="end" fill={d.activeMs ? P.INK : P.GREY2}>{d.activeMs ? fmtMin(d.activeMs) : "—"}</Tx>
            </g>
          );
          d.blocks.forEach((b, i) => {
            const li = TIMELINE_KINDS.indexOf(b.kind);
            const bx = X0 + ((b.start - d.date - win[0]) / span) * PW, bw = Math.max(3, Math.min((b.durationMs / span) * PW, X0 + PW - (X0 + ((b.start - d.date - win[0]) / span) * PW)));
            els.push(
              <rect key={`b${r}-${i}`} x={bx} y={y + 3 + li * (BAND + GAP)} width={bw} height={BAND} fill={kindColor(b.kind, P)} className="cx-hit" data-tip={blockTip(b)} />
            );
          });
          if (isToday && now - d.date >= win[0] && now - d.date <= win[1]) {
            const nx = X0 + ((now - d.date - win[0]) / span) * PW;
            els.push(<line key={`now${r}`} x1={nx} x2={nx} y1={y + 1} y2={y + ROW_H - 1} stroke={P.INK} strokeWidth={1.2} strokeDasharray="3 3" />);
          }
        });
        return els;
      }}
    />
  );
}

// ───────────── 组件本体 ─────────────

export default function TimelineWidget({ mode }: { mode: "day" | "week" }) {
  const [offset, setOffset] = useState(0); // 距今天几个学习日（日视图=1 天，周视图=以该日结尾的 7 天）
  const [data, setData] = useState<StatsTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wk, setWk] = useState<"day" | "week">(mode);
  const [focus, setFocus] = useState(true);
  const seq = useRef(0);

  useEffect(() => { setWk(mode); setOffset(0); }, [mode]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await statsApi.timeline({ endDay: Date.now() - offset * DAY, days: wk === "week" ? 7 : 1 });
      if (my !== seq.current) return;
      if (!r) setErr("时间轴服务不可用");
      else { setData(r); setErr(null); }
    } catch (e) {
      if (my === seq.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [offset, wk]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const offs = [eventBus.on("cards/changed", load), eventBus.on("workflow/changed", load), eventBus.on("library/changed", load)];
    const timer = window.setInterval(() => { if (offset === 0 && !document.hidden) load(); }, 60_000);
    return () => { offs.forEach((f) => f()); window.clearInterval(timer); };
  }, [load, offset]);

  const win = useMemo(() => focusWindow(data?.days ?? [], focus), [data, focus]);
  const step = wk === "week" ? 7 : 1;
  const cutoffClock = data ? new Date(data.days[0].date).getHours() : 0;
  const title = useMemo(() => {
    if (!data) return "";
    const d = data.days;
    if (wk === "day") {
      const t = new Date(d[0].date);
      return `${t.getMonth() + 1}月${t.getDate()}日 周${WEEK_ZH[t.getDay()]}`;
    }
    const a = new Date(d[0].date), b = new Date(d[d.length - 1].date);
    return `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`;
  }, [data, wk]);

  if (err) return <Empty msg={err} height={200} />;
  if (!data) return <Empty msg="正在读取时间轴…" height={200} />;

  const pick = (date: number) => { setWk("day"); setOffset(Math.max(0, Math.round((Date.now() - date - DAY / 2) / DAY))); };

  return (
    <div className="tl">
      <Toolbar
        title={title}
        sub={offset === 0 ? (wk === "day" ? "今天" : "含今天") : offset === 1 && wk === "day" ? "昨天" : undefined}
        isToday={offset === 0}
        canNext={offset > 0}
        onPrev={() => setOffset((o) => o + step)}
        onNext={() => setOffset((o) => Math.max(0, o - step))}
        onToday={() => setOffset(0)}
        focus={focus}
        onFocus={setFocus}
      />
      {wk === "day"
        ? (<><DayGantt day={data.days[0]} now={data.now} cutoffClock={cutoffClock} win={win} /><Allocation day={data.days[0]} /></>)
        : <WeekGantt days={data.days} now={data.now} cutoffClock={cutoffClock} win={win} onPick={pick} />}
    </div>
  );
}
