// @runtime: electron-node
// D248 / T2：写入器——批量阈值、定时冲刷、flushSync、禁用零写、限流、队列溢出、span upsert 终态、丢弃计数（§7.6）。
// 运行：node scripts/run-tests.mjs behavior-writer
// 隔离：fs.mkdtempSync 临时目录 + 真实 behavior.db，绝不触碰真实 userData。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
const { createWriter } = require(path.join(ROOT, "electron", "behavior", "writer.js"));
const { uuid7 } = require(path.join(ROOT, "electron", "behavior", "uuid7.js"));

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
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = 1761609600000; // 2026-10-28 00:00 UTC 附近（仅测试用固定值）
const mk = (over) => ({
  type: "reader.jumped",
  src: "main",
  session_id: "sess-1",
  ts: BASE,
  recv_ts: BASE,
  day: "2026-10-28",
  tz_offset: -480,
  cutoff_hour: 4,
  props: { method: "toc", fromPos: 0 },
  ...over,
});
const mkSpan = (over) => ({
  uid: uuid7(),
  session_id: "sess-1",
  src: "main",
  day: "2026-10-28",
  start_ts: BASE,
  end_ts: BASE + 1000,
  surface: "read",
  active_ms: 1000,
  idle_ms: 0,
  mono_ms: 1000,
  revision: 1,
  cutoff_hour: 4,
  ...over,
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-writer-"));
  behaviorDb.resetForTest();
  behaviorDb.configure({ dataDir: dir });
  const db = await behaviorDb.open();
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const evCount = () => count("events");
  const spCount = () => count("attn_spans");

  console.log("== A 基础入队与 flushSync ==");
  {
    const w = createWriter({ db, autoStart: false });
    const r = w.push(mk({ props: { method: "toc", fromPos: 7 }, op_id: "op-1" }));
    check("push 返回 ok 且生成 uid", r.ok === true && /^[0-9a-f-]{36}$/.test(r.uid), "ok+uid", r);
    check("入队不立即落库", evCount() === 0 && w.stats().queued === 1, "queued=1", { n: evCount(), q: w.stats().queued });
    const n = w.flushSync();
    check("flushSync 返回写入行数", n === 1, 1, n);
    check("落库 1 行", evCount() === 1, 1, evCount());
    const row = db.prepare("SELECT * FROM events WHERE uid = ?").get(r.uid);
    check("props 以 JSON 落库", JSON.parse(row.props).fromPos === 7, 7, row.props);
    check("actor 缺省 = unknown", row.actor === "unknown", "unknown", row.actor);
    check("v 缺省 = 1", row.v === 1, 1, row.v);
    check("clock_flags 缺省 = 0", row.clock_flags === 0, 0, row.clock_flags);
    w.stop();
  }

  console.log("== B 定时冲刷（1s 口径，测试压到 40ms） ==");
  {
    const w = createWriter({ db, autoStart: true, flushIntervalMs: 40 });
    w.push(mk({ ts: BASE + 60000, recv_ts: BASE + 60000, props: { method: "search" } }));
    check("定时器未到时不落库", evCount() === 1, 1, evCount());
    await sleep(120);
    check("定时冲刷后落库", evCount() === 2, 2, evCount());
    w.stop();
  }

  console.log("== C 500 条阈值：下一事件循环自动冲刷 ==");
  {
    const w = createWriter({ db, autoStart: false });
    for (let i = 0; i < 500; i++) {
      const r = w.push(mk({ ts: BASE + i * 60000, recv_ts: BASE + i * 60000 }));
      if (!r.ok) throw new Error(`push ${i} 失败：${r.code}`);
    }
    check("500 条全部入队（未同步落盘）", evCount() === 2, 2, evCount());
    await tick();
    await tick();
    check("阈值触发后在事件循环内冲刷", evCount() === 502, 502, evCount());
    check("队列已清空", w.stats().queued === 0, 0, w.stats().queued);
    w.stop();
  }

  console.log("== D 禁用：零写入 ==");
  {
    const before = evCount();
    const beforeSp = spCount();
    const w = createWriter({ db, autoStart: false });
    w.setEnabled(false);
    check("禁用后 push 返回 disabled", w.push(mk()).code === "disabled", "disabled", w.push(mk()));
    check("禁用后 pushSpan 返回 disabled", w.pushSpan(mkSpan()).code === "disabled", "disabled", w.pushSpan(mkSpan()));
    check("禁用后 flushSync 返回 0", w.flushSync() === 0, 0, "非 0");
    check("禁用后事件零写入", evCount() === before, before, evCount());
    check("禁用后 span 零写入", spCount() === beforeSp, beforeSp, spCount());
    w.setEnabled(true);
    check("重新启用后可写", w.push(mk({ ts: BASE + 10 * 60000 })).ok === true, true, "拒绝");
    w.flushSync();
    check("重新启用后落库", evCount() === before + 1, before + 1, evCount());
    w.stop();
  }

  console.log("== E 限流 maxPerMin ==");
  {
    const w = createWriter({ db, autoStart: false });
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 61; i++) {
      const r = w.push(mk({ type: "tray.action", props: { action: "show" } }));
      if (r.ok) ok++;
      else if (r.code === "rate_limited") limited++;
    }
    check("同一分钟第 61 条被限流（tray.action=60/min）", ok === 60 && limited === 1, { ok: 60, limited: 1 }, { ok, limited });
    w.flushSync();
    check("限流只丢 1 条（其余落库）", w.stats().dropped.rate_limited === 1, 1, w.stats().dropped);
    w.stop();
  }

  console.log("== F 队列溢出丢最旧 ==");
  {
    const w = createWriter({ db, autoStart: false, maxQueue: 5 });
    for (let i = 0; i < 7; i++) w.push(mk({ ts: BASE + (20 + i) * 60000, recv_ts: BASE + (20 + i) * 60000 }));
    check("溢出丢 2 条（队列上限 5）", w.stats().dropped.queue_overflow === 2, 2, w.stats().dropped);
    check("队列长度保持上限", w.stats().queued === 5, 5, w.stats().queued);
    w.flushSync();
    check("溢出后 flush 仍写 5 行", w.stats().written === 5, 5, w.stats().written);
    w.stop();
  }

  console.log("== G 校验拒绝（毒数据不进队列） ==");
  {
    const before = evCount();
    const w = createWriter({ db, autoStart: false });
    const r = w.push(mk({ type: "nope.nope" }));
    check("未知事件被拒", r.ok === false && r.code === "type_unknown", "type_unknown", r);
    check("拒绝计数 +1", w.stats().rejected === 1, 1, w.stats().rejected);
    check("毒数据零落库", evCount() === before, before, evCount());
    w.stop();
  }

  console.log("== H span upsert：revision 递增 + closed 终态 ==");
  {
    const w = createWriter({ db, autoStart: false });
    const uid = uuid7();
    w.pushSpan(mkSpan({ uid, revision: 1, active_ms: 1000 }));
    w.flushSync();
    let row = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(uid);
    check("首次 span 落库（revision 1 / active 1000 / closed 0）", row && row.active_ms === 1000 && row.revision === 1 && row.closed === 0, "1000/1/0", row);
    w.pushSpan(mkSpan({ uid, revision: 2, active_ms: 2000 }));
    w.flushSync();
    row = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(uid);
    check("心跳更新同一行（仍 1 行，active 2000）", spCount() === 1 && row.active_ms === 2000, "1 行 / 2000", { n: spCount(), row });
    w.pushSpan(mkSpan({ uid, revision: 3, active_ms: 3000, closed: 1, end_reason: "blur" }));
    w.flushSync();
    row = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(uid);
    check("closed=1 终态落库（active 3000 / end_reason blur）", row.closed === 1 && row.active_ms === 3000 && row.end_reason === "blur", "closed/3000/blur", row);
    w.pushSpan(mkSpan({ uid, revision: 4, active_ms: 4000 }));
    w.flushSync();
    row = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(uid);
    check("closed 后拒绝迟到心跳（active 仍 3000）", row.active_ms === 3000, 3000, row.active_ms);
    w.pushSpan(mkSpan({ uid, revision: 2, active_ms: 9999 }));
    w.flushSync();
    row = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(uid);
    check("低 revision 被拒（不倒退）", row.active_ms === 3000, 3000, row.active_ms);
    w.stop();
  }

  console.log("== I span 校验 ==");
  {
    const w = createWriter({ db, autoStart: false });
    check("revision 0 被拒", w.pushSpan(mkSpan({ revision: 0 })).code === "span_revision_invalid", "span_revision_invalid", w.pushSpan(mkSpan({ revision: 0 })));
    check("surface 空被拒", w.pushSpan(mkSpan({ surface: "" })).code === "span_surface_missing", "span_surface_missing", w.pushSpan(mkSpan({ surface: "" })));
    check("end<start 被拒", w.pushSpan(mkSpan({ start_ts: BASE + 10, end_ts: BASE })).code === "span_range_invalid", "span_range_invalid", "未拒");
    check("pos_ranges 嵌套非法被拒", w.pushSpan(mkSpan({ pos_ranges: [[1, 2, 3]] })).code === "span_ranges_invalid", "span_ranges_invalid", "未拒");
    w.stop();
  }

  console.log("== J 短文本开关 ==");
  {
    const w = createWriter({ db, autoStart: false, recordQueryText: false });
    check("关闭时 dict.lookup 的 text 被拒", w.push(mk({ type: "dict.lookup", props: { lang: "en", source: "local", hit: true }, text: "apple" })).code === "text_disabled", "text_disabled", "未拒");
    w.stop();
    const w2 = createWriter({ db, autoStart: false, recordQueryText: true });
    const r = w2.push(mk({ type: "dict.lookup", props: { lang: "en", source: "local", hit: true }, text: "apple" }));
    check("开启后短文本入队", r.ok === true, true, r);
    w2.flushSync();
    const row = db.prepare("SELECT text FROM events WHERE uid = ?").get(r.uid);
    check("text 原样落库（≤200）", row.text === "apple", "apple", row);
    check("开启后超长仍被拒", w2.push(mk({ type: "dict.lookup", props: { lang: "en", source: "local", hit: true }, text: "x".repeat(201) })).code === "text_too_long", "text_too_long", "未拒");
    w2.stop();
  }

  console.log("== K 丢弃计数落 bdi_meta（累计） ==");
  {
    const w = createWriter({ db, autoStart: false, maxQueue: 2 });
    w.push(mk({ type: "nope.nope" }));
    for (let i = 0; i < 3; i++) w.push(mk({ ts: BASE + (40 + i) * 60000 }));
    const n1 = w.flushDropped();
    check("flushDropped 返回新增条数", n1 >= 2, ">=2", n1);
    const total1 = Number(behaviorDb.getMeta("dropped_total"));
    check("dropped_total 已写入", total1 === n1, n1, total1);
    const by1 = JSON.parse(behaviorDb.getMeta("dropped_by_reason_json", "{}"));
    check("按原因计数含校验拒绝与溢出", by1["validate:type_unknown"] === 1 && by1.queue_overflow === 1, { v: 1, q: 1 }, by1);
    w.push(mk({ type: "nope.nope" }));
    const n2 = w.flushDropped();
    const total2 = Number(behaviorDb.getMeta("dropped_total"));
    check("累计语义（第二次只加新增）", total2 === total1 + n2, total1 + n2, total2);
    w.stop();
  }

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  behaviorDb.resetForTest();
  console.log(`\n==== behavior-writer ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
