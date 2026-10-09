// 数据页「一日时间轴」聚合纯函数测试
// @runtime: node
// 运行：node tests/stats-timeline.test.cjs
"use strict";
const path = require("path");
const T = require(path.join(__dirname, "..", "electron", "statsTimeline.js"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

const H = 3600_000, M = 60_000, DAY = 86400_000;
const D0 = new Date(2026, 9, 9).getTime(); // 本地 2026-10-09 00:00（避免依赖时区）

console.log("== 复习：间隔≤3 分钟并块，>3 分钟分块 ==");
{
  const ev = [
    T.reviewEvent(D0 + 9 * H, 8000, "Good", "card"),
    T.reviewEvent(D0 + 9 * H + 30_000, 6000, "Again", "card"),
    T.reviewEvent(D0 + 9 * H + 2 * M, 10_000, "Good", "extract"),
    T.reviewEvent(D0 + 9 * H + 20 * M, 5000, "Good", "card")
  ];
  const day = T.buildTimeline(ev, { dayStart0: D0, days: 1 }).days[0];
  const rv = day.blocks.filter((b) => b.kind === "review");
  check("两块", rv.length === 2, 2, rv.length);
  check("首块 3 次评分", rv[0].count === 3, 3, rv[0].count);
  check("首块含 1 次 Again", rv[0].again === 1, 1, rv[0].again);
  check("首块 卡片 2 / 摘录 1", rv[0].sub.card === 2 && rv[0].sub.extract === 1, "2/1", rv[0].sub);
  check("首块起点 = 首次评分 - 8s", rv[0].start === D0 + 9 * H - 8000, D0 + 9 * H - 8000, rv[0].start);
  check("总计 4 次", day.totals.review.count === 4, 4, day.totals.review.count);
}

console.log("== 作答耗时夹取：3 小时「开着没关」只算 180s ==");
{
  const e = T.reviewEvent(D0 + 12 * H, 3 * H, "Good", "card");
  check("区间长度 180s", e.t1 - e.t0 === 180_000, 180_000, e.t1 - e.t0);
  const e2 = T.reviewEvent(D0 + 12 * H, 0, "Good", "card");
  check("无耗时按 3s", e2.t1 - e2.t0 === 3000, 3000, e2.t1 - e2.t0);
}

console.log("== 阅读：5 分钟内并块，字数累加，书名取频次最高 ==");
{
  const ev = [
    T.readEvent(D0 + 20 * H, 300, "A书"),
    T.readEvent(D0 + 20 * H + 2 * M, 500, "A书"),
    T.readEvent(D0 + 20 * H + 12 * M, 200, "B书"), // 与上一个相隔 > 5 分钟 → 新块
    T.readEvent(D0 + 20 * H + 60 * M, 100, "A书")
  ];
  const day = T.buildTimeline(ev, { dayStart0: D0, days: 1 }).days[0];
  const rd = day.blocks.filter((b) => b.kind === "read");
  check("三块", rd.length === 3, 3, rd.length);
  check("首块字数 800", rd[0].chars === 800, 800, rd[0].chars);
  check("首块书名 A书", rd[0].titles[0] === "A书", "A书", rd[0].titles);
  check("阅读总字数 1100", day.totals.read.chars === 1100, 1100, day.totals.read.chars);
}

console.log("== 瞬时事件：单点块最短 30s；摘录高亮分计 ==");
{
  const ev = [
    T.pointEvent("extract", D0 + 10 * H, { hl: true }),
    T.pointEvent("extract", D0 + 10 * H + M),
    T.pointEvent("card", D0 + 15 * H),
    T.pointEvent("journal", D0 + 22 * H)
  ];
  const day = T.buildTimeline(ev, { dayStart0: D0, days: 1 }).days[0];
  const ex = day.blocks.find((b) => b.kind === "extract");
  check("摘录一块 2 条 含 1 高亮", ex.count === 2 && ex.hl === 1, "2/1", [ex.count, ex.hl]);
  const cd = day.blocks.find((b) => b.kind === "card");
  check("单点制卡块时长按 30s", cd.durationMs === T.MIN_SPAN_MS, T.MIN_SPAN_MS, cd.durationMs);
}

console.log("== 跨日归属与日界夹取 ==");
{
  const ev = [
    T.pointEvent("card", D0 + DAY - 1000),   // 当日最后 1s
    T.pointEvent("card", D0 + DAY + 1000),   // 次日
    T.readEvent(D0 + 5000, 100, "X")           // 当日 00:00:05，±15s 填充会越过日起点
  ];
  const r = T.buildTimeline(ev, { dayStart0: D0, days: 2 });
  check("两天", r.days.length === 2, 2, r.days.length);
  check("当日 1 张 / 次日 1 张", r.days[0].totals.card.count === 1 && r.days[1].totals.card.count === 1, "1/1", [r.days[0].totals.card.count, r.days[1].totals.card.count]);
  const rd = r.days[0].blocks.find((b) => b.kind === "read");
  check("阅读块起点被夹到日起点", rd.start === D0, D0, rd.start);
  check("块不越过日界", r.days[0].blocks.every((b) => b.start >= D0 && b.end <= D0 + DAY), true, null);
}

console.log("== 活跃时长 = 区间并集（不同类别重叠不重复计）==");
{
  // 阅读 [10:00-15s, 10:00+15s]；同刻复习(耗时10s)块不足 30s，按最短 30s 计 → [10:00-10s, 10:00+20s]；并集 [-15s, +20s]
  const ev = [T.readEvent(D0 + 10 * H, 10, "A"), T.reviewEvent(D0 + 10 * H, 10_000, "Good", "card")];
  const day = T.buildTimeline(ev, { dayStart0: D0, days: 1 }).days[0];
  check("并集 = 35s（重叠部分不重复计）", day.activeMs === 35_000, 35_000, day.activeMs);
}

console.log("== 空日 ==");
{
  const day = T.buildTimeline([], { dayStart0: D0, days: 1 }).days[0];
  check("无块 / 活跃 0 / first=null", day.blocks.length === 0 && day.activeMs === 0 && day.first === null, true, day);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
