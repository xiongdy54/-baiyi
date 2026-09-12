// M2 备份与恢复核心单元测试（无 Electron，显式路径注入）
// 运行：node tests/backup.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
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

function seedData(tag) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.assetsDir, "item-1"), { recursive: true });
  fs.writeFileSync(P.dbFile, Buffer.from(`SQLITE-FAKE-${tag}-${"x".repeat(1000)}`, "utf-8"));
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
  check("换入后库内容恢复为备份版本", fs.readFileSync(P.dbFile, "utf-8").includes("SQLITE-FAKE-A"), fs.readFileSync(P.dbFile, "utf-8").slice(0, 30));
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
  // 路径穿越条目必须被剔除
  const evil = new JSZip();
  evil.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1 }));
  evil.file("library.db", Buffer.from("EVIL"));
  evil.file("../escape.txt", Buffer.from("EVIL"));
  const evilZip = path.join(BAK, "evil.zip");
  fs.writeFileSync(evilZip, await evil.generateAsync({ type: "nodebuffer" }));
  r = await backup.restoreBackup(evilZip, { ...opts(), skipSafety: true });
  check("路径穿越 zip 恢复请求成功（穿越条目被剔除）", r.ok === true, JSON.stringify(r));
  backup.applyPendingRestore({ ...P });
  check("穿越文件未落在数据目录外", !fs.existsSync(path.join(tmp, "escape.txt")), path.join(tmp, "escape.txt"));
  check("合法条目仍换入", fs.readFileSync(P.dbFile, "utf-8") === "EVIL", "EVIL applied");

  console.log("== 5) 自动备份：每日一次 + 保留份数轮换 ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  seedData("B");
  const settingsKeep2 = { app: { autoBackupEnabled: true, autoBackupKeep: 2 } };
  const optsAuto = () => ({ ...P, backupDir: BAK, counts, settingsFile: path.join(DATA, "settings.json") });
  fs.writeFileSync(P.settingsFile, JSON.stringify(settingsKeep2));
  const days = [0, 1, 2, 3, 4].map((i) => new Date(Date.now() - i * 86400000));
  let last;
  for (const d of days) last = await backup.autoBackupIfNeeded({ ...optsAuto(), now: d, flush: () => {} });
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

  // 清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nM2 备份单元测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试异常：", err);
  process.exit(1);
});
