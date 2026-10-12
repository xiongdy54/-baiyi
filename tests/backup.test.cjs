// M2 备份与恢复核心单元测试（无 Electron app，显式路径注入）
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs（D137 §3.9 通道，仓库常驻 electron-ABI 二进制）
// D137（v48.92）：夹具修复——D-TEST-85 的换入完整性校验（isIntactSqliteFile）要求真实 SQLite 字节，
// 旧夹具的 "SQLITE-FAKE-*" 文本字节在 HEAD 上即已触发「不是完整可读的 SQLite 文件」中止（既有红）。
// 改用 better-sqlite3 生成最小真库（fixture_meta.tag 承担内容断言），断言数量与强度不变。
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const backup = require("../electron/backup");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 200)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bktest-"));
const DATA = path.join(tmp, "data");
const BAK = path.join(tmp, "backups");
const P = {
  dataDir: DATA,
  dbFile: path.join(DATA, "library.db"),
  settingsFile: path.join(DATA, "settings.json"),
  aiConfigFile: path.join(DATA, "ai-config.json"),
  assetsDir: path.join(DATA, "assets"),
  stagingDir: path.join(DATA, "restore-staging"),
  markerFile: path.join(DATA, "restore-pending.json")
};

// 真实 SQLite 夹具：fixture_meta.tag = tag（恢复回环的内容断言依据）
function realSqliteBytes(tag) {
  const f = path.join(tmp, `fixture-${tag}.db`);
  try { fs.rmSync(f, { force: true }); } catch { /* 尽力 */ }
  const d = new Database(f);
  d.exec("CREATE TABLE IF NOT EXISTS fixture_meta (tag TEXT NOT NULL)");
  d.prepare("DELETE FROM fixture_meta").run();
  d.prepare("INSERT INTO fixture_meta (tag) VALUES (?)").run(tag);
  d.close();
  return fs.readFileSync(f);
}
const readFixtureTag = (file) => {
  try {
    const d = new Database(file, { readonly: true });
    const row = d.prepare("SELECT tag FROM fixture_meta").get();
    d.close();
    return row ? row.tag : null;
  } catch {
    return `非 SQLite 文件:${fs.readFileSync(file).length}B`;
  }
};

function seedData(tag) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.assetsDir, "item-1"), { recursive: true });
  fs.writeFileSync(P.dbFile, realSqliteBytes(tag));
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { theme: "dark", tag }, theme: {} }));
  fs.writeFileSync(P.aiConfigFile, JSON.stringify({ keys: { goat: "SECRET" } }));
  fs.writeFileSync(path.join(P.assetsDir, "item-1", "img.png"), Buffer.from([0x89, 0x50, tag.charCodeAt(0), 0x0d, 0x0a]));
  fs.writeFileSync(path.join(P.assetsDir, "item-1", "original.epub"), Buffer.from("PK-FAKE-EPUB-" + tag));
}

const counts = { items: 3, cards: 42, extracts: 7, assets: 2 };
const opts = () => ({ ...P, backupDir: BAK, counts, appVersion: "0.0.1" });

(async () => {
  console.log("== 1) 手动备份：默认不含 ai-config ==");
  seedData("A");
  let r = await backup.createBackup({ ...opts(), label: "manual", flush: () => {} });
  check("备份成功", r.ok === true, JSON.stringify(r));
  check("文件名带 manual 标签", /backup-manual-\d{8}-\d{6}\.zip$/.test(r.file || ""), r.file);
  check("无 .part 残留", !fs.existsSync(r.file + ".part"), r.file + ".part");
  let list = await backup.listBackups({ ...opts() });
  check("列表 1 条且有效", list.backups.length === 1 && list.backups[0].valid, JSON.stringify(list.backups));
  check("meta 记录 counts", list.backups[0].counts?.cards === 42, JSON.stringify(list.backups[0].counts));
  check("列表标记不含 Key", list.backups[0].includesAIConfig === false, list.backups[0].includesAIConfig);

  console.log("== 2) 勾选 Key 的备份 ==");
  r = await backup.createBackup({ ...opts(), label: "manual", includeAIConfig: true });
  check("备份成功", r.ok === true, JSON.stringify(r));
  list = await backup.listBackups({ ...opts() });
  const withKey = list.backups.find((b) => b.includesAIConfig);
  check("列表标记含 Key", !!withKey, JSON.stringify(list.backups.map((b) => b.includesAIConfig)));
  check("共 2 条备份且按时间倒序", list.backups.length === 2 && list.backups[0].createdAt >= list.backups[1].createdAt, list.backups.length);

  console.log("== 3) 恢复回环：改数据 → 恢复 → 标记 → 重启换入 ==");
  // 破坏当前数据：改库内容、删资产、改设置
  fs.writeFileSync(P.dbFile, Buffer.from("SQLITE-FAKE-DESTROYED", "utf-8"));
  fs.rmSync(path.join(P.assetsDir, "item-1", "img.png"), { force: true });
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { theme: "light" }, theme: {} }));
  const earliestBackup = list.backups[list.backups.length - 1].path; // 第 1 次备份（不含 Key）
  r = await backup.restoreBackup(earliestBackup, { ...opts(), flush: () => {} });
  check("恢复请求成功且需重启", r.ok === true && r.needsRestart === true, JSON.stringify(r));
  check("安全备份已创建（含 Key）", /backup-safety-/.test(r.safetyFile || ""), r.safetyFile);
  check("staging 已解包 library.db", fs.existsSync(path.join(P.stagingDir, "library.db")), P.stagingDir);
  check("staging 已解包 assets", fs.existsSync(path.join(P.stagingDir, "assets", "item-1", "img.png")), "assets/img.png");
  check("标记文件已写入", fs.existsSync(P.markerFile), P.markerFile);
  check("运行期 library.db 未被直接改动（sql.js 约束）", fs.readFileSync(P.dbFile, "utf-8").includes("DESTROYED"), "db unchanged");
  const applied = backup.applyPendingRestore({ ...P });
  check("applyPendingRestore 返回换入清单", Array.isArray(applied?.restored) && applied.restored.includes("library.db"), JSON.stringify(applied));
  check("换入后库内容恢复为备份版本", readFixtureTag(P.dbFile) === "A", readFixtureTag(P.dbFile));
  check("恢复换入后目标目录无 -wal/-shm 残留（D137 sidecar 清理）", !fs.existsSync(P.dbFile + "-wal") && !fs.existsSync(P.dbFile + "-shm"), {
    wal: fs.existsSync(P.dbFile + "-wal"),
    shm: fs.existsSync(P.dbFile + "-shm")
  });
  check("资产文件已恢复", fs.existsSync(path.join(P.assetsDir, "item-1", "img.png")), "img.png");
  check("settings.json 已恢复", JSON.parse(fs.readFileSync(P.settingsFile, "utf-8")).app.tag === "A", fs.readFileSync(P.settingsFile, "utf-8"));
  check("staging 与标记已清理", !fs.existsSync(P.stagingDir) && !fs.existsSync(P.markerFile), "cleanup");
  check("备份 zip 本身的 ai-config 未换入（该备份不含 Key）", JSON.parse(fs.readFileSync(P.aiConfigFile, "utf-8")).keys.goat === "SECRET", "ai-config untouched");

  console.log("== 4) 恢复保护：拒绝非本软件 zip ==");
  const badZip = path.join(BAK, "not-a-backup.zip");
  const JSZip = require("jszip");
  const z = new JSZip();
  z.file("random.txt", "hello");
  fs.writeFileSync(badZip, await z.generateAsync({ type: "nodebuffer" }));
  r = await backup.restoreBackup(badZip, { ...opts(), skipSafety: true });
  check("拒绝缺 backup-meta.json 的 zip", r.ok === false && /不是本软件/.test(r.error || ""), JSON.stringify(r));
  r = await backup.restoreBackup(path.join(BAK, "missing.zip"), { ...opts(), skipSafety: true });
  check("拒绝不存在的文件", r.ok === false && /不存在/.test(r.error || ""), JSON.stringify(r));
  // 路径穿越条目必须被剔除（library.db 用真实 SQLite 字节——换入完整性校验 D-TEST-85 会拦伪字节）
  const evil = new JSZip();
  evil.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1 }));
  evil.file("library.db", realSqliteBytes("EVIL"));
  evil.file("../escape.txt", Buffer.from("EVIL"));
  const evilZip = path.join(BAK, "evil.zip");
  fs.writeFileSync(evilZip, await evil.generateAsync({ type: "nodebuffer" }));
  r = await backup.restoreBackup(evilZip, { ...opts(), skipSafety: true });
  check("路径穿越 zip 恢复请求成功（穿越条目被剔除）", r.ok === true, JSON.stringify(r));
  backup.applyPendingRestore({ ...P });
  check("穿越文件未落在数据目录外", !fs.existsSync(path.join(tmp, "escape.txt")), path.join(tmp, "escape.txt"));
  check("合法条目仍换入", readFixtureTag(P.dbFile) === "EVIL", readFixtureTag(P.dbFile));

  console.log("== 5) 自动备份：每日一次 + 保留份数轮换 ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  seedData("B");
  const settingsKeep2 = { app: { autoBackupEnabled: true, autoBackupKeep: 2 } };
  const optsAuto = () => ({ ...P, backupDir: BAK, counts, settingsFile: path.join(DATA, "settings.json") });
  fs.writeFileSync(P.settingsFile, JSON.stringify(settingsKeep2));
  const days = [0, 1, 2, 3, 4].map((i) => new Date(Date.now() - i * 86400000));
  let last;
  // 按时间升序（最旧→今天）逐日启动：与真实时序一致——mtime 轮换才保留「最新两天」（今天在列），
  // 今天的 zip 在场后，「同日第二次启动」才走 already-today 短路（D-TEST-35 按 mtime 轮换的口径）。
  for (const d of [...days].reverse()) last = await backup.autoBackupIfNeeded({ ...optsAuto(), now: d, flush: () => {} });
  check("第 5 天（最早）备份成功", last?.ok === true && !last.skipped, JSON.stringify(last));
  check("同日第二次启动跳过", (await backup.autoBackupIfNeeded({ ...optsAuto(), now: days[0], flush: () => {} })).skipped === "already-today", "skip");
  let autos = fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-"));
  check("轮换后仅保留 2 份", autos.length === 2, JSON.stringify(autos));
  check("保留的是最新两天", autos.includes(`backup-auto-2026-${String(days[0].getMonth() + 1).padStart(2, "0")}-${String(days[0].getDate()).padStart(2, "0")}.zip`), JSON.stringify(autos));
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { autoBackupEnabled: false } }));
  check("关闭自动备份后不再执行", (await backup.autoBackupIfNeeded({ ...optsAuto(), now: new Date(), flush: () => {} })).skipped === "disabled", "disabled");
  fs.writeFileSync(P.settingsFile, JSON.stringify(settingsKeep2));

  console.log("== 6) 备份位置设置（backupDir 缺省解析） ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { backupDir: BAK } }));
  const dir = backup.getBackupDir({ ...P });
  check("读取 settings.app.backupDir", dir === BAK, dir);
  r = await backup.createBackup({ ...P, label: "manual", flush: () => {} });
  check("缺省备份位置生效", r.ok === true && r.file.startsWith(BAK), r.file);

  console.log("== 7) 中断残留清扫（D143 复审 M3）：旧 .snapshot-* 与非今日 .part 回收、当日 .part 保留 ==");
  const snapOld = path.join(BAK, ".snapshot-orphan");
  fs.mkdirSync(snapOld, { recursive: true });
  fs.writeFileSync(path.join(snapOld, "dictionary.db"), "SNAP-ORPHAN");
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  fs.utimesSync(snapOld, threeDaysAgo, threeDaysAgo); // 非今日 mtime（mkdtemp 名无日期，mtime 是唯一「今日」判据）
  const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const partOld = path.join(BAK, `backup-auto-${dayStr(threeDaysAgo)}.zip.part`);
  fs.writeFileSync(partOld, "PART-OLD");
  const partToday = path.join(BAK, `backup-auto-${dayStr(new Date())}.zip.part`);
  fs.writeFileSync(partToday, "PART-TODAY");
  const swept = backup.sweepBackupOrphans({ ...opts() });
  check("旧 .snapshot-* 与非今日 .part 被清扫（中断残留孤儿回收）", !fs.existsSync(snapOld) && !fs.existsSync(partOld), JSON.stringify(swept));
  check("当日 .part 不误删（可能是在途构建）", fs.existsSync(partToday), JSON.stringify({ kept: fs.existsSync(partToday), swept }));

  // 清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nM2 备份单元测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试异常：", err);
  process.exit(1);
});
