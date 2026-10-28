// @runtime: electron-node
// D248 / T12：隐私——禁用零写、清除查询原文、保留期归档后删原始、导出 ZIP、清除全部（新 epoch + 空库）。（§11）
// 运行：node scripts/run-tests.mjs behavior-privacy
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");

const ROOT = path.join(__dirname, "..");
const behavior = require(path.join(ROOT, "electron", "behavior", "index.js"));
const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
const { uuid7 } = require(path.join(ROOT, "electron", "behavior", "uuid7.js"));

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-privacy-"));
  behavior.resetForTest();
  const st = await behavior.init({
    dataDir: dir,
    settings: () => ({ app: { behavior: { enabled: true, retentionDays: 90, recordQueryText: true } } }),
    appVersion: "1.0.0", os: "test", locale: "en", deviceId: "dev", windows: () => [],
  });
  check("init ok（记录查询原文开启）", st.status === "ok" && st.recordQueryText === true, "ok/true", st);

  console.log("== A 清除查询原文 ==");
  const batch = behavior.acceptBatch({
    generation: behavior.getGeneration(),
    events: [{ type: "dict.lookup", props: { lang: "en", source: "local", hit: true }, text: "secret-word" }],
  }, "main");
  check("带原文事件入队", batch.ok === true && batch.accepted === 1, 1, batch);
  behavior.flushSync();
  const bdb = behavior.getDb();
  check("原文已落库（开启时）", bdb.prepare("SELECT COUNT(*) AS n FROM events WHERE text IS NOT NULL").get().n === 1, 1, "0");
  const cleared = behavior.clearQueryText();
  check("clearQueryText 清空 text 并关闭开关", cleared.ok === true && bdb.prepare("SELECT COUNT(*) AS n FROM events WHERE text IS NOT NULL").get().n === 0 && behavior.getConfig().recordQueryText === false, "清零/关", cleared);
  check("计数仍在（只清原文不删事件）", bdb.prepare("SELECT COUNT(*) AS n FROM events WHERE type='dict.lookup'").get().n === 1, 1, "0");

  console.log("== B 保留期：先归档再删原始 ==");
  const oldUid = uuid7();
  bdb.prepare("INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(oldUid, 1, 1, "2020-01-01", -480, 4, "nav.view", "host", "s-old");
  const ret = behavior.enforceRetention();
  check("执行保留期（90 天）", ret.ok === true && ret.archivedDays >= 1, ">=1 天", ret);
  check("旧日写入 archived_days", bdb.prepare("SELECT 1 FROM archived_days WHERE day='2020-01-01'").get() !== undefined, "已归档", "缺");
  check("旧日原始事件已物理删除", bdb.prepare("SELECT COUNT(*) AS n FROM events WHERE day='2020-01-01'").get().n === 0, 0, "残留");
  check("保留期内数据不动", bdb.prepare("SELECT COUNT(*) AS n FROM events WHERE type='dict.lookup'").get().n === 1, 1, "误删");

  console.log("== C 导出（JSONL + ZIP，原文默认脱敏） ==");
  // 再写一条带原文的事件用于检验脱敏
  behavior.setBehaviorConfig({ enabled: true, retentionDays: 90, recordQueryText: true });
  behavior.acceptBatch({ generation: behavior.getGeneration(), events: [{ type: "dict.lookup", props: { lang: "en", source: "local", hit: true }, text: "again-secret" }] }, "main");
  behavior.flushSync();
  const dest = path.join(dir, "export.zip");
  const ex = await behavior.exportData(dest, { includeText: false });
  check("导出文件生成", ex.ok === true && fs.existsSync(dest) && fs.statSync(dest).size > 0, "zip", ex);
  const zip = await JSZip.loadAsync(fs.readFileSync(dest));
  check("ZIP 含 manifest/events/schema", !!zip.file("manifest.json") && !!zip.file("events.jsonl") && !!zip.file("schema.json"), "三件", Object.keys(zip.files));
  const evLines = (await zip.file("events.jsonl").async("string")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  check("导出默认脱敏（text 全 NULL）", evLines.every((r) => r.text === null), "全 NULL", evLines.filter((r) => r.text));
  check("导出行数与库内一致", evLines.length === bdb.prepare("SELECT COUNT(*) AS n FROM events").get().n, "一致", evLines.length);
  let exErr = null;
  try { await behavior.exportData(path.join(dir, "no-such-dir", "x.zip"), {}); } catch (e) { exErr = e; }
  check("导出失败如实抛错（不假成功）", !!exErr, "throw", "静默成功");

  console.log("== D 清除全部：generation 屏障 + 新 epoch + 空库 ==");
  const epochBefore = behavior.getPolicy().dataEpoch;
  const genBefore = behavior.getGeneration();
  const pg = await behavior.purgeAll();
  check("purge 成功", pg.ok === true, "ok", pg);
  check("generation 提升（旧队列拒收）", behavior.getGeneration() > genBefore, "递增", behavior.getGeneration());
  check("dataEpoch 换新", behavior.getPolicy().dataEpoch !== epochBefore && pg.epoch === behavior.getPolicy().dataEpoch, "新 epoch", { before: epochBefore, after: behavior.getPolicy().dataEpoch });
  check("analysisFloorTs = purgeTs", behavior.getPolicy().analysisFloorTs === pg.purgeTs, pg.purgeTs, behavior.getPolicy().analysisFloorTs);
  const db2 = behavior.getDb();
  const counts = ["events", "attn_spans", "app_sessions", "daily_metrics", "domain_day", "signal_daily", "entity_domains", "archived_days"].map((t) => db2.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  check("清空后各表 0 行", counts.every((n) => n === 0), "全 0", counts);
  check("清除后保持停用", behavior.getStatus().status === "disabled", "disabled", behavior.getStatus().status);
  check("停用后零写入", behavior.emit({ type: "nav.view", props: { from: "a", to: "b" } }).ok === false, false, true);
  const enabled = behavior.setEnabled(true);
  const sid = behavior.getSessions() && behavior.getSessions().getSessionId();
  const re = behavior.acceptBatch({ generation: behavior.getGeneration(), events: [{ type: "nav.view", props: { from: "shelf", to: "reader" } }] }, "main");
  check("明确重新开启后可采集", enabled.status === "ok" && !!sid && re.ok === true && re.accepted === 1, "ok", { status: enabled.status, sid, re });

  behavior.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  behavior.resetForTest();
  console.log(`\n==== behavior-privacy ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
