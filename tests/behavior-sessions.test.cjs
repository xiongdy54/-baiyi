// @runtime: electron-node
// D248 / T3：会话——启动修复（crash_recovered）、窗口焦点累计与去抖、电源事件、结束回填、无事件 last_seen（§7.5）。
// 运行：node scripts/run-tests.mjs behavior-sessions
// 隔离：fs.mkdtempSync 临时目录 + 真实 behavior.db。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
const { createWriter } = require(path.join(ROOT, "electron", "behavior", "writer.js"));
const { createSessions } = require(path.join(ROOT, "electron", "behavior", "sessions.js"));
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

const T0 = 1761609600000;
let clock = T0;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-sessions-"));
  behaviorDb.resetForTest();
  behaviorDb.configure({ dataDir: dir });
  const db = await behaviorDb.open();
  const writer = createWriter({ db, autoStart: false });
  const emitted = [];
  let flushCalls = 0;
  const sessions = createSessions({
    db,
    settings: () => ({ app: { dayCutoffHour: 4 } }),
    now: () => clock,
    appVersion: "2.0.0",
    os: "test-os",
    locale: "zh-CN",
    dataEpoch: "epoch-test",
    deviceId: "dev-1",
    emit: (e) => { emitted.push(e); return writer.push(e); },
    flush: () => { flushCalls++; writer.flushSync(); },
    windows: () => [],
  });
  const rowOf = (id) => db.prepare("SELECT * FROM app_sessions WHERE id = ?").get(id);
  const lastByType = (type) => [...emitted].reverse().find((e) => e.type === type);
  const insertUnfinished = (id, startedAt, lastSeen) => db.prepare(`INSERT INTO app_sessions
    (id, data_epoch, device_id, started_at, ended_at, end_reason, clean_exit, last_seen_ts, app_version,
     catalog_version, os, locale, foreground_ms, active_ms, event_count)
    VALUES (?,?,?,?,NULL,NULL,0,?,?,?,?,?,0,0,0)`).run(id, "epoch-old", "dev-1", startedAt, lastSeen, "1.9.0", 1, "test-os", null);

  console.log("== A 首次 init：建会话 + app.started ==");
  const sid1 = sessions.init();
  const r1 = rowOf(sid1);
  check("会话行存在且未结束", !!r1 && r1.ended_at === null, "未结束", r1);
  check("started_at / last_seen_ts = 注入时钟", r1.started_at === T0 && r1.last_seen_ts === T0, T0, r1);
  check("data_epoch / device_id 落库", r1.data_epoch === "epoch-test" && r1.device_id === "dev-1", "epoch-test/dev-1", r1);
  check("app_version / catalog_version / os 落库", r1.app_version === "2.0.0" && r1.catalog_version === 1 && r1.os === "test-os", "2.0.0/1/test-os", r1);
  const started = lastByType("app.started");
  check("emit app.started（launchKind=cold）", !!started && started.props.launchKind === "cold" && started.session_id === sid1, "cold", started);
  check("首次启动不发 app.updated", !lastByType("app.updated"), "无", lastByType("app.updated"));
  check("bdi_meta.last_session_id 已登记", behaviorDb.getMeta("last_session_id") === sid1, sid1, behaviorDb.getMeta("last_session_id"));

  console.log("== B 窗口状态：去抖 + prevTs/durMs + 前台累计 ==");
  clock = T0 + 100;
  check("focus 事件发出", sessions.noteWindowState("main", "focus").ok === true, true, "未发");
  clock = T0 + 600;
  check("同状态 <1s 被去抖（不重复发）", sessions.noteWindowState("main", "focus") === null, null, "重复发");
  clock = T0 + 1600;
  check("同状态 ≥1s 可再次发出", sessions.noteWindowState("main", "focus").ok === true, true, "未发");
  const second = [...emitted].reverse().find((e) => e.type === "app.window_state");
  check("prevTs/durMs 按上一次状态点计算", second.props.prevTs === T0 + 100 && second.props.durMs === 1500, { prevTs: T0 + 100, durMs: 1500 }, second.props);
  clock = T0 + 2200;
  check("blur 事件发出", sessions.noteWindowState("main", "blur").ok === true, true, "未发");
  check("前台累计 = 首次 focus → blur 的整段（2100ms）", sessions.status().foregroundMs === 2100, 2100, sessions.status().foregroundMs);
  clock = T0 + 2300;
  check("第二个窗口独立去抖槽（lens focus 照发）", sessions.noteWindowState("lens", "focus").ok === true, true, "未发");

  console.log("== C 电源事件：先冲刷再 emit ==");
  const beforeFlush = flushCalls;
  clock = T0 + 2500;
  const p = sessions.notePower("suspend");
  check("emit app.power(suspend)", p.ok === true && lastByType("app.power").props.state === "suspend", "suspend", p);
  check("电源事件前调用 flush", flushCalls === beforeFlush + 1, beforeFlush + 1, flushCalls);
  check("挂起时关闭前台区间（lens 200ms 计入：2300→2500）", sessions.status().foregroundMs === 2300, 2300, sessions.status().foregroundMs);

  console.log("== D 结束会话：回填 active_ms / event_count / clean_exit ==");
  writer.pushSpan({
    uid: uuid7(), session_id: sid1, src: "host", day: "2026-10-28", start_ts: T0, end_ts: T0 + 2000,
    surface: "read", active_ms: 3000, idle_ms: 0, mono_ms: 3000, revision: 1, cutoff_hour: 4,
  });
  writer.flushSync();
  clock = T0 + 3000;
  const ended = sessions.end("quit");
  const r2 = rowOf(sid1);
  check("ended_at = 结束时时钟", r2.ended_at === T0 + 3000, T0 + 3000, r2.ended_at);
  check("end_reason = quit / clean_exit = 1", r2.end_reason === "quit" && r2.clean_exit === 1, "quit/1", r2);
  check("active_ms 回填为 span 之和", r2.active_ms === 3000, 3000, r2.active_ms);
  check("event_count 回填为已落库事件数", r2.event_count === db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get(sid1).n, "一致", r2.event_count);
  check("foreground_ms 落库", r2.foreground_ms === 2300, 2300, r2.foreground_ms);
  check("end 返回统计", ended.cleanExit === 1 && ended.activeMs === 3000, "clean/3000", ended);
  check("end 幂等（第二次返回 null）", sessions.end("quit") === null, null, "非 null");

  console.log("== E 崩溃修复：未结束会话 crash_recovered ==");
  const crashId = uuid7();
  insertUnfinished(crashId, T0 + 4000, T0 + 4005);
  db.prepare("INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(uuid7(), T0 + 4010, T0 + 4010, "2026-10-28", -480, 4, "nav.view", "main", crashId);
  const openUid = uuid7();
  db.prepare(`INSERT INTO attn_spans (uid,session_id,src,day,start_ts,end_ts,surface,active_ms,idle_ms,mono_ms,revision,closed,cutoff_hour)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`).run(openUid, crashId, "host", "2026-10-28", T0 + 4000, T0 + 4020, "read", 500, 0, 500, 1, 4);
  behaviorDb.setMeta("last_app_version", "1.9.0");
  clock = T0 + 5000;
  const sid2 = sessions.init();
  const rc = rowOf(crashId);
  check("旧会话已结束且原因 crash_recovered", rc.ended_at !== null && rc.end_reason === "crash_recovered", "crash_recovered", rc);
  check("ended_at = 最后已持久化证据（span end_ts）", rc.ended_at === T0 + 4020, T0 + 4020, rc.ended_at);
  check("ended_at ≥ started_at", rc.ended_at >= rc.started_at, true, rc);
  const span = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(openUid);
  check("遗留 open span 置 closed=1 / recovered", span.closed === 1 && span.end_reason === "recovered", "closed/recovered", span);
  check("新会话已建立（id 不同）", sid2 !== crashId && rowOf(sid2).ended_at === null, "新会话", sid2);
  check("版本变化补发 app.updated(1.9.0→2.0.0)", (() => { const u = lastByType("app.updated"); return !!u && u.props.fromVersion === "1.9.0" && u.props.toVersion === "2.0.0"; })(), "1.9.0→2.0.0", lastByType("app.updated"));

  console.log("== F 无事件会话：ended_at ≥ started_at ==");
  sessions.end("quit");
  const emptyId = uuid7();
  insertUnfinished(emptyId, 5000, 5000);
  clock = 5000;
  sessions.init();
  const re = rowOf(emptyId);
  check("无事件无 span 时 ended_at = started_at（不早于）", re.ended_at === 5000 && re.ended_at >= re.started_at, 5000, re);

  console.log("== G 无事件会话仍有 last_seen（30s touch） ==");
  const sid3 = sessions.getSessionId();
  clock = 5000 + 30000;
  sessions.touch();
  const r3 = rowOf(sid3);
  check("touch 更新 last_seen_ts", r3.last_seen_ts === 5000 + 30000, 5000 + 30000, r3.last_seen_ts);
  check("无事件会话 event_count = 0", r3.event_count === 0, 0, r3.event_count);
  sessions.end("quit");
  check("正常结束后 clean_exit=1", rowOf(sid3).clean_exit === 1, 1, rowOf(sid3).clean_exit);

  writer.stop();
  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  behaviorDb.resetForTest();
  console.log(`\n==== behavior-sessions ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
