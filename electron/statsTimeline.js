"use strict";
// 数据页「一日时间轴」纯函数（无 DB / 无 Electron 依赖，可 node 直跑单测）。
//
// 输入：已按「学习日」框定范围的行为事件（阅读 / 摘录 / 复习 / 制卡）；
// 输出：每个学习日的「时段块」——同类事件相隔不超过 GAP 即并成一块，像甘特图里的一根任务条。
//
// 口径（与 UI 文案一致，改这里必须同步 Timeline 组件的说明）：
//  - 事件先按其**结束时刻**归入学习日（日切点由调用方给定），再在日内合并，所以块不会跨日。
//  - 复习事件区间 = [评分时刻 - 作答耗时, 评分时刻]；耗时夹在 [3s, 180s]，防止「卡片开着人走了」撑出假长块。
//  - 阅读事件（滚动停止后 1s 上报的位置）区间 = 事件时刻 ±15s。
//  - 摘录 / 制卡是瞬时事件，区间为一个点；块的时长至少按 MIN_SPAN_MS 计。
//    （v48.114 / D159：journal（日记）维度随功能暂时移除——点事件产生方与 KINDS 同步摘除，重实装时回插。）
//  - 「活跃时长」= 全部块区间的并集（不同类别同时发生不重复计）。

const DAY_MS = 86400_000;

const KINDS = ["read", "extract", "review", "card"];

// 同类事件间隔不超过该值则并入同一块
const GAP_MS = {
  read: 5 * 60_000,
  extract: 4 * 60_000,
  review: 3 * 60_000,
  card: 4 * 60_000
};

const MIN_SPAN_MS = 30_000;
const REVIEW_DUR_MIN = 3_000;
const REVIEW_DUR_MAX = 180_000;
const READ_PAD_MS = 15_000;

/** 复习事件：评分时刻 ts、作答耗时 durationMs（可空）、评分 rating、sub = 'card' | 'extract' */
function reviewEvent(ts, durationMs, rating, sub) {
  const dur = Math.min(REVIEW_DUR_MAX, Math.max(REVIEW_DUR_MIN, Number(durationMs) || 0));
  return { kind: "review", t0: ts - dur, t1: ts, again: rating === "Again", sub: sub || "card" };
}

/** 阅读事件：位置上报时刻 ts、本次推进字数 chars（已由调用方按「相邻正增量」算好）、书名 title */
function readEvent(ts, chars, title) {
  return { kind: "read", t0: ts - READ_PAD_MS, t1: ts + READ_PAD_MS, chars: Math.max(0, Number(chars) || 0), title: title || null };
}

/** 瞬时事件（摘录 / 制卡 / 日记）。extra 可带 { hl:true }（纯高亮） */
function pointEvent(kind, ts, extra) {
  return { kind, t0: ts, t1: ts, ...(extra || {}) };
}

function newBlock(e) {
  return {
    kind: e.kind, start: e.t0, end: e.t1, count: 0, chars: 0, again: 0, hl: 0,
    sub: { card: 0, extract: 0 }, _titles: new Map()
  };
}

function absorb(b, e) {
  b.start = Math.min(b.start, e.t0);
  b.end = Math.max(b.end, e.t1);
  b.count += 1;
  b.chars += e.chars || 0;
  if (e.again) b.again += 1;
  if (e.hl) b.hl += 1;
  if (e.sub) b.sub[e.sub] = (b.sub[e.sub] || 0) + 1;
  if (e.title) b._titles.set(e.title, (b._titles.get(e.title) || 0) + 1);
}

function finalize(b, dayStart, dayEnd) {
  // 夹进学习日窗口（填充 ±15s 可能略超日界）
  const start = Math.max(dayStart, b.start);
  const end = Math.min(dayEnd, Math.max(start, b.end));
  const titles = [...b._titles.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => t);
  return {
    kind: b.kind, start, end,
    durationMs: Math.max(end - start, MIN_SPAN_MS),
    count: b.count, chars: b.chars, again: b.again, hl: b.hl,
    sub: b.sub, titles
  };
}

/** 区间并集总长 */
function unionMs(spans) {
  const s = spans.filter((x) => x[1] >= x[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [a, b] of s) {
    if (curS === null) { curS = a; curE = b; continue; }
    if (a <= curE) curE = Math.max(curE, b);
    else { total += curE - curS; curS = a; curE = b; }
  }
  if (curS !== null) total += curE - curS;
  return total;
}

/**
 * @param events  行为事件数组（reviewEvent / readEvent / pointEvent 产物）
 * @param opts    { dayStart0: 第一个学习日起点(ms), days: 天数 }
 * @returns       { days: [{ date, blocks, totals, activeMs, first, last, longestMs }] }
 */
function buildTimeline(events, opts) {
  const dayStart0 = Number(opts.dayStart0);
  const days = Math.max(1, Math.floor(Number(opts.days) || 1));
  const buckets = Array.from({ length: days }, () => []);
  for (const e of events) {
    const idx = Math.floor((e.t1 - dayStart0) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx].push(e);
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const dayStart = dayStart0 + i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const byKind = new Map();
    for (const e of buckets[i]) {
      if (!byKind.has(e.kind)) byKind.set(e.kind, []);
      byKind.get(e.kind).push(e);
    }
    const blocks = [];
    for (const kind of KINDS) {
      const list = (byKind.get(kind) || []).sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
      let cur = null;
      for (const e of list) {
        if (cur && e.t0 - cur.end <= GAP_MS[kind]) absorb(cur, e);
        else {
          if (cur) blocks.push(finalize(cur, dayStart, dayEnd));
          cur = newBlock(e);
          absorb(cur, e);
        }
      }
      if (cur) blocks.push(finalize(cur, dayStart, dayEnd));
    }
    blocks.sort((a, b) => a.start - b.start || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
    const totals = {};
    for (const k of KINDS) totals[k] = { blocks: 0, count: 0, ms: 0, chars: 0, again: 0 };
    for (const b of blocks) {
      const t = totals[b.kind];
      t.blocks += 1; t.count += b.count; t.ms += b.durationMs; t.chars += b.chars; t.again += b.again;
    }
    const spans = blocks.map((b) => [b.start, Math.max(b.end, b.start + b.durationMs)]);
    out.push({
      date: dayStart,
      blocks,
      totals,
      activeMs: unionMs(spans),
      first: blocks.length ? Math.min(...blocks.map((b) => b.start)) : null,
      last: blocks.length ? Math.max(...blocks.map((b) => b.end)) : null,
      longestMs: blocks.reduce((m, b) => (b.kind === "read" || b.kind === "review" ? Math.max(m, b.durationMs) : m), 0)
    });
  }
  return { days: out };
}

module.exports = {
  KINDS, GAP_MS, MIN_SPAN_MS,
  reviewEvent, readEvent, pointEvent, buildTimeline, unionMs
};
