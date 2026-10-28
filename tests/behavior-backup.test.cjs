// @runtime: electron-node
// D248 / T13：备份纳入 behavior.db（快照 + meta 跨库偏差）；恢复换入；旧包缺 BDI 隔离现有库；
//   早于 analysisFloorTs 的备份不还原行为库。（§12）
// 运行：node scripts/run-tests.mjs behavior-backup
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const JSZip = require("jszip");
const backup = require(path.join(__dirname, "..", "electron", "backup.js"));

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-backup-"));
const DATA = path.join(tmp, "data");
const BAK = path.join(tmp, "backups");
const P = {
  dataDir: DATA,
  dbFile: path.join(DATA, "library.db"),
  settingsFile: path.join(DATA, "settings.json"),
  aiConfigFile: path.join(DATA, "ai-config.json"),
  assetsDir: path.join(DATA, "assets"),
  memoryDir: path.join(DATA, "memory"),
  dictDbFile: path.join(DATA, "dictionary.db"),
  dictsDir: path.join(DATA, "dicts"),
  behaviorDbFile: path.join(DATA, "behavior.db"),
  behaviorPolicyFile: path.join(DATA, "behavior-policy.json"),
  stagingDir: path.join(DATA, "restore-staging"),
  markerFile: path.join(DATA, "restore-pending.json"),
};

function sqliteBytes(file, table, value) {
  try { fs.rmSync(file, { force: true }); } catch { /* 尽力 */ }
  const d = new Database(file);
  d.exec(`CREATE TABLE IF NOT EXISTS ${table} (tag TEXT)`);
  d.prepare(`INSERT INTO ${table}(tag) VALUES (?)`).run(value);
  d.close();
  return fs.readFileSync(file);
}
function bdiBytes(tag) {
  try { fs.rmSync(path.join(tmp, "bdi-fixture.db"), { force: true }); } catch { /* 尽力 */ }
  const f = path.join(tmp, "bdi-fixture.db");
  const d = new Database(f);
  d.exec("CREATE TABLE bdi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  d.prepare("INSERT INTO bdi_meta(key,value) VALUES ('data_epoch', ?)").run(tag);
  d.close();
  return fs.readFileSync(f);
}
const tagOf = (file, table) => {
  try {
    const d = new Database(file, { readonly: true });
    const r = d.prepare(`SELECT tag FROM ${table} LIMIT 1`).get();
    d.close();
    return r ? r.tag : null;
  } catch { return null; }
};
const epochOf = (file) => {
  try {
    const d = new Database(file, { readonly: true });
    const r = d.prepare("SELECT value FROM bdi_meta WHERE key='data_epoch'").get();
    d.close();
    return r ? r.value : null;
  } catch { return null; }
};
function seed(tag) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(P.dbFile, sqliteBytes(path.join(tmp, `lib-${tag}.db`), "fixture_meta", `lib-${tag}`));
  fs.writeFileSync(P.behaviorDbFile, bdiBytes(`epoch-${tag}`));
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: {}, theme: {} }));
}
const opts = (extra) => ({ ...P, backupDir: BAK, counts: { items: 1 }, appVersion: "0.0.1", ...extra });

(async () => {
  console.log("== A 备份包含 behavior.db 与跨库偏差 meta ==");
  seed("A");
  const snapBehavior = async (dest) => { fs.copyFileSync(P.behaviorDbFile, dest); };
  const r = await backup.createBackup(opts({ label: "manual", flush: () => {}, snapshotBehavior: snapBehavior }));
  check("备份成功", r.ok === true && !!r.file, "ok", r);
  const zip = await JSZip.loadAsync(fs.readFileSync(r.file));
  check("ZIP 含 behavior.db", !!zip.file("behavior.db"), "有", Object.keys(zip.files));
  const meta = JSON.parse(await zip.file("backup-meta.json").async("string"));
  check("meta.behavior.included=true 且带 snapshotAt", meta.behavior && meta.behavior.included === true && Number.isFinite(meta.behavior.snapshotAt), "included", meta.behavior);
  check("meta 记录 snapshotAtLibrary / snapshotAtBehavior / crossDbSkewMs", Number.isFinite(meta.snapshotAtLibrary) && Number.isFinite(meta.snapshotAtBehavior) && Number.isFinite(meta.crossDbSkewMs), "三字段", meta);

  console.log("== B 恢复：换入行为库并标 refresh ==");
  seed("B");
  const rr = await backup.restoreBackup(r.file, opts({ flush: () => {}, skipSafety: true }));
  check("恢复请求接受", rr.ok === true, "ok", rr);
  const applied = backup.applyPendingRestore(P);
  check("换入成功", applied.ok === true && applied.restored.includes("behavior.db"), "behavior.db", applied);
  check("行为库内容来自备份", epochOf(P.behaviorDbFile) === "epoch-A", "epoch-A", epochOf(P.behaviorDbFile));
  const d = new Database(P.behaviorDbFile, { readonly: true });
  const flag = d.prepare("SELECT value FROM bdi_meta WHERE key='restore_pending_refresh'").get();
  d.close();
  check("换入后标 restore_pending_refresh=1（强制重算）", flag && flag.value === "1", "1", flag);

  console.log("== C 旧包缺 BDI → 隔离现有库 + 新 dataEpoch ==");
  seed("C");
  fs.rmSync(P.behaviorDbFile, { force: true });
  const old = await backup.createBackup(opts({ label: "manual", flush: () => {} }));
  check("无行为库时备份仍成功（meta 标 missing）", old.ok === true, "ok", old);
  const oldMeta = JSON.parse(await (await JSZip.loadAsync(fs.readFileSync(old.file))).file("backup-meta.json").async("string"));
  check("meta.behavior.reason=missing", oldMeta.behavior && oldMeta.behavior.included === false && oldMeta.behavior.reason === "missing", "missing", oldMeta.behavior);
  fs.writeFileSync(P.behaviorDbFile, bdiBytes("epoch-LIVE"));
  fs.writeFileSync(P.behaviorPolicyFile, JSON.stringify({ dataEpoch: "epoch-LIVE", analysisFloorTs: 0 }));
  await backup.restoreBackup(old.file, opts({ flush: () => {}, skipSafety: true }));
  const applied2 = backup.applyPendingRestore(P);
  const isolated = fs.readdirSync(DATA).filter((f) => f.startsWith("behavior.db.pre-restore-"));
  check("现有行为库被隔离（不被旧主库混用）", isolated.length === 1 && applied2.restored.some((x) => x.includes("isolated")), isolated, applied2);
  check("隔离后起新 dataEpoch", JSON.parse(fs.readFileSync(P.behaviorPolicyFile, "utf8")).dataEpoch !== "epoch-LIVE", "新 epoch", "未变");

  console.log("== D 早于 analysisFloorTs 的备份不还原行为库 ==");
  seed("D");
  const oldNow = new Date(Date.now() - 3600000);
  const oldBackup = await backup.createBackup(opts({ label: "manual", flush: () => {}, snapshotBehavior: snapBehavior, now: oldNow }));
  fs.writeFileSync(P.behaviorPolicyFile, JSON.stringify({ dataEpoch: "epoch-D", analysisFloorTs: Date.now() }));
  const before = epochOf(P.behaviorDbFile);
  await backup.restoreBackup(oldBackup.file, opts({ flush: () => {}, skipSafety: true }));
  const applied3 = backup.applyPendingRestore(P);
  check("早于清除边界 → 跳过行为库还原", applied3.restored.includes("behavior.db(skipped-floor)"), "skipped-floor", applied3.restored);
  check("线上行为库保持原样", epochOf(P.behaviorDbFile) === before, before, epochOf(P.behaviorDbFile));

  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-backup ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
