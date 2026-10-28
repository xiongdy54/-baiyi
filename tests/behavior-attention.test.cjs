// @runtime: system-node
// D248 / T6：注意力状态机——精确 idle 切分、30s 心跳、5min 切段、跨学习日、调钟、hidden/blur、
//   <1s 丢弃、位置区间断点（§7.3 / §14 behavior-attention）。
// 运行：node scripts/run-tests.mjs behavior-attention
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), `bdi-attn-${process.pid}.cjs`);
esbuild.buildSync({
  stdin: {
    contents: [
      'export { createAttention, DEFAULT_IDLE_LIMITS } from "./src/lib/behavior/attention";',
      'export { learningDayIndex, learningDayStartMs, dayString } from "./src/lib/behavior/day";',
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: OUT, logLevel: "silent",
});
const { createAttention, DEFAULT_IDLE_LIMITS, learningDayIndex, learningDayStartMs, dayString } = require(OUT);
const fsrsTime = require(path.join(ROOT, "electron", "fsrsTime.js"));

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

const BASE = new Date(2026, 9, 28, 10, 0, 0, 0).getTime();
function rig(over = {}) {
  const state = { wall: BASE, mono: 0, visible: "visible", focused: true };
  const emitted = [];
  const doc = {
    get visibilityState() { return state.visible; },
    hasFocus: () => state.focused,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const a = createAttention({
    now: () => state.wall,
    mono: () => state.mono,
    doc,
    win: null,
    cutoffHour: 4,
    intervalMs: 999999,
    heartbeatMs: 999999,
    emitSpan: (s) => emitted.push(s),
    ...over,
  });
  return { state, emitted, doc, a };
}
const advance = (r, ms) => { r.state.mono += ms; r.state.wall += ms; };

console.log("== A day.ts 与 electron/fsrsTime.js 逐时点同口径 ==");
{
  const points = [];
  for (let d = 0; d < 400; d += 1) points.push(BASE + d * 86400000 + 7 * 3600000);
  const bad = [];
  for (const cutoff of [0, 4, 13, 23]) {
    for (const p of points) {
      if (learningDayIndex(p, cutoff) !== fsrsTime.learningDayIndex(p, cutoff)) bad.push(`idx/${cutoff}/${p}`);
      if (learningDayStartMs(p, cutoff) !== fsrsTime.learningDayStartMs(p, cutoff)) bad.push(`start/${cutoff}/${p}`);
    }
  }
  check("learningDayIndex / learningDayStartMs 与主进程逐点相同（cutoff 0/4/13/23 × 400 天）", bad.length === 0, "全等", bad.slice(0, 5));
  check("dayString 与起点本地日期一致", dayString(BASE, 4) === dayString(learningDayStartMs(BASE, 4), 0), "一致", "不一致");
}

console.log("== B 精确 idle 切分（reader 180s） ==");
{
  const r = rig();
  r.a.start();
  r.a.setContext({ surface: "read", entityType: "library_item", entityId: "book-1", libraryItemId: "book-1", ctxId: "ctx-1", origin: "shelf" });
  r.a.noteInput("key");
  advance(r, 60000);
  r.a.tick();
  let s = r.a._peekSpan();
  check("60s 时 active=60s / idle=0", s.active_ms === 60000 && s.idle_ms === 0, { a: 60000, i: 0 }, { a: s.active_ms, i: s.idle_ms });
  advance(r, 140000);
  r.a.tick();
  s = r.a._peekSpan();
  check("200s 时 active 封顶 180s、其余计 idle（20s）", s.active_ms === 180000 && s.idle_ms === 20000, { a: 180000, i: 20000 }, { a: s.active_ms, i: s.idle_ms });

  console.log("== C 心跳 revision 与 blur 终态 ==");
  advance(r, 30000);
  r.a.heartbeat();
  s = r.a._peekSpan();
  check("心跳片 closed=0 且 revision 递增", s.closed === 0 && s.revision === 1, "closed=0/rev=1", { closed: s.closed, rev: s.revision });
  r.state.focused = false;
  r.a.tick();
  const last = r.emitted[r.emitted.length - 1];
  check("失焦立即封段（end_reason=blur / closed=1）", last && last.end_reason === "blur" && last.closed === 1, "blur/1", last && { r: last.end_reason, c: last.closed });
  check("blur 段 active=180s / idle=50s", last.active_ms === 180000 && last.idle_ms === 50000, { a: 180000, i: 50000 }, { a: last.active_ms, i: last.idle_ms });
  check("span 公共字段（uid/ctx/day/pos_ranges null）", /^[0-9a-f-]{36}$/.test(last.uid) && last.ctx_id === "ctx-1" && /^\d{4}-\d{2}-\d{2}$/.test(last.day) && last.pos_ranges === null, "合法", last);

  console.log("== D 失焦后再输入才重开（不自动计时） ==");
  const before = r.emitted.length;
  advance(r, 10000);
  r.a.tick();
  check("无新输入时不产生新段", r.emitted.length === before, before, r.emitted.length);
  r.state.focused = true;
  r.a.noteInput("pointer");
  r.a.noteInput("poke");
  advance(r, 2000);
  r.a.tick();
  s = r.a._peekSpan();
  check("真实输入后重开并计 active（2s）", !!s && s.active_ms === 2000 && s.clicks === 1, { a: 2000, clicks: 1 }, s && { a: s.active_ms, c: s.clicks });
  r.a.stop("unload");
}

console.log("== E 5min 切段 ==");
{
  const r = rig();
  r.a.start();
  r.a.setContext({ surface: "review", entityType: "card", entityId: "c1", cardId: "c1", ctxId: "rv" });
  r.a.noteInput("key");
  for (let i = 0; i < 5; i++) { advance(r, 60000); r.a.noteInput("key"); r.a.tick(); }
  const split = r.emitted.filter((x) => x.end_reason === "split");
  check("到 5min 切段（end_reason=split）", split.length === 1, 1, split.length);
  check("切段段 active=300s（review 每 60s 有输入）", split[0] && split[0].active_ms === 300000, 300000, split[0] && split[0].active_ms);
  r.a.noteInput("key");
  advance(r, 1000);
  r.a.tick();
  check("切段后继续累计（新 uid 不同）", r.a._peekSpan() && r.a._peekSpan().uid !== split[0].uid, "不同 uid", "相同");
  r.a.stop("unload");
}

console.log("== F 跨学习日切段 ==");
{
  const lateNight = new Date(2026, 9, 28, 2, 0, 0).getTime(); // cutoff=4 → 属前一学习日
  const state = { wall: lateNight, mono: 0, visible: "visible", focused: true };
  const emitted = [];
  const doc = { get visibilityState() { return state.visible; }, hasFocus: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  const a = createAttention({ now: () => state.wall, mono: () => state.mono, doc, win: null, cutoffHour: 4, intervalMs: 999999, heartbeatMs: 999999, emitSpan: (s) => emitted.push(s) });
  a.start();
  a.setContext({ surface: "read", entityType: "library_item", entityId: "b2" });
  a.noteInput("key");
  state.mono += 3 * 3600000; state.wall += 3 * 3600000; // 02:00 → 05:00 跨 4 点切点
  a.tick();
  const cut = emitted.find((x) => x.end_reason === "day_cut");
  check("跨学习日切段（end_reason=day_cut）", !!cut, "day_cut", emitted.map((x) => x.end_reason));
  check("切段前的日标签是前一学习日", cut && cut.day === dayString(lateNight, 4), dayString(lateNight, 4), cut && cut.day);
  a.stop("unload");
}

console.log("== G 调钟：结束旧段并置 clock 标记 ==");
{
  const r = rig();
  r.a.start();
  r.a.setContext({ surface: "browse", entityType: "card", entityId: "c9" });
  r.a.noteInput("key");
  r.state.wall += 60000; // 单调钟只走 1s，墙钟跳 60s → 差 >5s
  r.state.mono += 1000;
  r.a.tick();
  const clocked = r.emitted.find((x) => x.end_reason === "clock");
  check("调钟封段（clock_flags 含 1）", !!clocked && (clocked.clock_flags & 1) === 1, "flag1", clocked && clocked.clock_flags);
  r.a.stop("unload");
}

console.log("== H hidden 封段与 <1s 丢弃 ==");
{
  const r = rig();
  r.a.start();
  r.a.setContext({ surface: "read", entityType: "library_item", entityId: "b3" });
  r.a.noteInput("key");
  advance(r, 5000);
  r.a.tick();
  r.state.visible = "hidden";
  r.a.tick();
  const hidden = r.emitted.find((x) => x.end_reason === "hidden");
  check("hidden 立即封段", !!hidden && hidden.closed === 1, "hidden", r.emitted.map((x) => x.end_reason));
  r.state.visible = "visible";
  r.a.noteInput("key");
  advance(r, 500);
  r.a.stop("unload");
  const tiny = r.emitted.filter((x) => x.mono_ms < 1000);
  check("<1s 段被丢弃（不落任何 span）", tiny.length === 0, 0, tiny.length);
}

console.log("== I 位置区间：显式跳转断点 / >5000 断开 / 上限 20 ==");
{
  const r = rig();
  r.a.start();
  r.a.setContext({ surface: "read", entityType: "library_item", entityId: "b4" });
  r.a.noteInput("key");
  r.a.notePosition(100);
  r.a.notePosition(200);
  r.a.notePosition(6000); // 5800 > 5000 → 新段
  r.a.notePosition(100, { jump: true }); // 显式跳转 → 新段
  let s = r.a._peekSpan();
  check("连续阅读合并为一段（[100,200]）", JSON.stringify(s.pos_ranges[0]) === JSON.stringify([100, 200]), [100, 200], s.pos_ranges[0]);
  check(">5000 断开成新段", JSON.stringify(s.pos_ranges[1]) === JSON.stringify([6000, 6000]), [6000, 6000], s.pos_ranges[1]);
  check("显式跳转即使距离小也断开", JSON.stringify(s.pos_ranges[2]) === JSON.stringify([100, 100]), [100, 100], s.pos_ranges[2]);
  for (let i = 0; i < 40; i++) r.a.notePosition(10000 + i * 9000);
  s = r.a._peekSpan();
  check("区间上限 20（保留已知部分，不下溢）", s.pos_ranges.length === 20, 20, s.pos_ranges.length);
  r.a.stop("unload");
}

check("默认 idle 阈值 reader 180s / review 90s / 其他 60s",
  DEFAULT_IDLE_LIMITS.read === 180000 && DEFAULT_IDLE_LIMITS.review === 90000 && DEFAULT_IDLE_LIMITS.other === 60000,
  { read: 180000, review: 90000, other: 60000 }, DEFAULT_IDLE_LIMITS);

try { fs.rmSync(OUT, { force: true }); } catch { /* 临时文件 */ }
console.log(`\n==== behavior-attention ${pass}/${pass + fail} 断言 ====`);
if (fail > 0) console.log(`  失败 ${fail} 项`);
process.exitCode = fail === 0 ? 0 : 1;
