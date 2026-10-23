// C-13 恢复流程验收：learner.db 换库后让位重建 + 设备相关设置不随恢复覆盖
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/restore-flow.test.cjs（electron-ABI better-sqlite3）
// @runtime: electron-node
// 场景：备份来自「另一台机器」（旧设备键值），线上是本机（新设备键值 + learner.db + 侧车 +
//       上次恢复残留的 .pre-restore）→ restoreBackup 暂存 → applyPendingRestore 换入 →
//       断言 learner.db 全家让位且旧残留被清、设备键保持线上值、非设备键随备份恢复。
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const backup = require("../electron/backup");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实际: ${String(actual).slice(0, 300)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-flow-"));
const DATA = path.join(tmp, "data");
const BAK = path.join(tmp, "backups");
const readDbTag = (file) => {
  try {
    const d = new Database(file, { readonly: true });
    const row = d.prepare("SELECT tag FROM fixture_meta").get();
    d.close();
    return row ? row.tag : null;
  } catch (e) {
    return `打开失败:${e.message}`;
  }
};

function makeDb(file, tag) {
  const d = new Database(file);
  d.exec("CREATE TABLE IF NOT EXISTS fixture_meta (tag TEXT NOT NULL)");
  d.prepare("INSERT INTO fixture_meta (tag) VALUES (?)").run(tag);
  d.close();
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  // ① 「另一台机器」的现场：库 BACKUP-LIB + 旧设备键
  makeDb(path.join(DATA, "library.db"), "BACKUP-LIB");
  fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({
    app: { backupDir: "E:/old-machine", closeToTray: false, language: "en", globalShortcuts: { autoLaunch: false } },
    theme: {}
  }));
  const b = await backup.createBackup({ dataDir: DATA, backupDir: BAK, label: "manual", flush: () => {} });
  check("备份成功", b.ok === true, JSON.stringify(b));

  // ② 本机现场：新库 LIVE-LIB、learner.db + 侧车、线上设备键、旧 .pre-restore 残留
  fs.rmSync(path.join(DATA, "library.db"), { force: true });
  makeDb(path.join(DATA, "library.db"), "LIVE-LIB");
  makeDb(path.join(DATA, "learner.db"), "LEARNER-LIVE");
  fs.writeFileSync(path.join(DATA, "learner.db-wal"), "WAL-JUNK");
  fs.writeFileSync(path.join(DATA, "learner.db-shm"), "SHM-JUNK");
  fs.writeFileSync(path.join(DATA, "learner.db.pre-restore"), "STALE-PREVIOUS");
  fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({
    app: { backupDir: "D:/live-backups", closeToTray: true, language: "zh", globalShortcuts: { autoLaunch: true } },
    theme: {}
  }));

  // ③ 暂存 + 换入（真实启动路径：applyPendingRestore 在 initDb 之前、无库连接占用）
  const r = await backup.restoreBackup(b.file, { dataDir: DATA, skipSafety: true });
  check("restore 暂存成功", r.ok === true, JSON.stringify(r));
  const applied = backup.applyPendingRestore({ dataDir: DATA });
  check("applyPendingRestore ok", applied && applied.ok === true, JSON.stringify(applied));
  check("换入清单含 library.db / learner.db(reset) / settings.json",
    applied.restored.includes("library.db") && applied.restored.includes("learner.db(reset)") && applied.restored.includes("settings.json"),
    applied.restored);

  // ④ learner.db 全家让位，只保留一份 .pre-restore（旧残留已清）
  check("learner.db 已让位", !fs.existsSync(path.join(DATA, "learner.db")), fs.existsSync(path.join(DATA, "learner.db")));
  check("learner.db-wal / -shm 已让位",
    !fs.existsSync(path.join(DATA, "learner.db-wal")) && !fs.existsSync(path.join(DATA, "learner.db-shm")),
    [fs.existsSync(path.join(DATA, "learner.db-wal")), fs.existsSync(path.join(DATA, "learner.db-shm"))]);
  check("learner.db.pre-restore 存在", fs.existsSync(path.join(DATA, "learner.db.pre-restore")), fs.readdirSync(DATA));
  check("让位的主文件可读出 LEARNER-LIVE", readDbTag(path.join(DATA, "learner.db.pre-restore")) === "LEARNER-LIVE", readDbTag(path.join(DATA, "learner.db.pre-restore")));
  check("旧的 STALE .pre-restore 残留已被清（只保留一份）",
    !fs.readFileSync(path.join(DATA, "learner.db-wal.pre-restore")).includes("STALE") && fs.readFileSync(path.join(DATA, "learner.db-wal.pre-restore")).toString() === "WAL-JUNK",
    fs.readFileSync(path.join(DATA, "learner.db-wal.pre-restore")).toString());

  // ⑤ 库已换入备份内容
  check("library.db 换入为备份库", readDbTag(path.join(DATA, "library.db")) === "BACKUP-LIB", readDbTag(path.join(DATA, "library.db")));

  // ⑥ 设备键保持线上值；非设备键随备份恢复
  const s = JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf-8"));
  check("app.backupDir 保持线上值", s.app.backupDir === "D:/live-backups", s.app.backupDir);
  check("app.closeToTray 保持线上值", s.app.closeToTray === true, s.app.closeToTray);
  check("app.globalShortcuts.autoLaunch 保持线上值", s.app.globalShortcuts.autoLaunch === true, s.app.globalShortcuts.autoLaunch);
  check("非设备键 language 随备份恢复", s.app.language === "en", s.app.language);
  check("settings.json 无 .tmp 残留", !fs.existsSync(path.join(DATA, "settings.json.tmp")), fs.readdirSync(DATA));

  // ⑦ 标记与暂存区已清
  check("restore-pending.json 已清", !fs.existsSync(path.join(DATA, "restore-pending.json")), fs.existsSync(path.join(DATA, "restore-pending.json")));
  check("restore-staging 已清", !fs.existsSync(path.join(DATA, "restore-staging")), fs.readdirSync(DATA));

  console.log(`\n合计 ${pass + fail}：通过 ${pass} / 失败 ${fail}`);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("测试异常：", e); process.exit(1); });
