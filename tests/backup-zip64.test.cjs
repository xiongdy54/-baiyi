// C-12 大文件门控测试：备份/恢复流式化（yazl/yauzl，自动 ZIP64）在 >4GiB 条目下不坏、不吃内存。
// @runtime: electron-node
// 运行：默认跳过（避免普通全量测试写数 GB 磁盘）；NUT_BIG_TESTS=1 时运行——
//   NUT_BIG_TESTS=1 node scripts/run-tests.mjs backup-zip64
// 需要：临时盘 ≥6GB 可用空间（4.5GB 稀疏源文件实际占 0 字节，解包出的实体会真写盘）。
// 验收（报告 C-12）：4.5GB dictionary.db（>4GiB，触发 ZIP64）+ 小 library.db 走 createBackup →
// readBackupMeta 读回清单 → extractAll 解出比对大小；期间 process.memoryUsage().rss 峰值 < 500MB。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

if (!process.env.NUT_BIG_TESTS) {
  console.log("  - 跳过（大文件测试需 NUT_BIG_TESTS=1）");
  process.exit(0);
}

const backup = require("../electron/backup");
const { extractAll, readBackupMeta: readZipBackupMeta } = require("../electron/zipRead");
const Database = require("better-sqlite3");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 200)}`); }
}

const BIG = Math.floor(4.5 * 1024 ** 3); // 4831838208 > 4GiB（0xFFFFFFFF），强制 ZIP64

(async () => {
  // 磁盘空间预检：解包出的 4.5GB 实体 + 200MB 余量
  try {
    const st = fs.statfsSync(os.tmpdir());
    const free = st.bavail * st.bsize;
    if (free < BIG + 1.5 * 1024 ** 3) {
      console.log(`  - 跳过（临时盘可用空间 ${(free / 1024 ** 3).toFixed(1)}GB < 6GB）`);
      process.exit(0);
    }
  } catch { /* statfs 不可用就赌一把（本测试本就门控） */ }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bkzip64-"));
  const DATA = path.join(tmp, "data");
  const BAK = path.join(tmp, "backups");
  fs.mkdirSync(DATA, { recursive: true });
  const dbFile = path.join(DATA, "library.db");
  const d = new Database(dbFile);
  d.exec("CREATE TABLE fixture_meta (tag TEXT NOT NULL)");
  d.prepare("INSERT INTO fixture_meta (tag) VALUES (?)").run("ZIP64");
  d.close();
  // 4.5GB 稀疏文件（ftruncate 只写 EOF，不占实际磁盘）
  const bigFile = path.join(DATA, "dictionary.db");
  const fd = fs.openSync(bigFile, "w");
  fs.ftruncateSync(fd, BIG);
  fs.closeSync(fd);
  if (fs.statSync(bigFile).size !== BIG) throw new Error("稀疏文件造数失败");

  let peak = 0;
  const timer = setInterval(() => {
    try { peak = Math.max(peak, process.memoryUsage().rss); } catch { /* 忽略 */ }
  }, 50);

  console.log("== 1) createBackup：4.5GB 条目流式打包（ZIP64） ==");
  const t0 = Date.now();
  const r = await backup.createBackup({
    dataDir: DATA, dbFile, settingsFile: path.join(DATA, "settings.json"),
    aiConfigFile: path.join(DATA, "ai-config.json"), assetsDir: path.join(DATA, "assets"),
    memoryDir: path.join(DATA, "memory"), dictDbFile: bigFile, dictsDir: path.join(DATA, "dicts"),
    stagingDir: path.join(DATA, "restore-staging"), markerFile: path.join(DATA, "restore-pending.json"),
    backupDir: BAK, label: "manual", flush: () => {}
  });
  check("备份成功", r.ok === true, JSON.stringify(r));
  const zipFile = r.file;
  const zipSize = fs.statSync(zipFile).size;
  console.log(`  · 备份耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，zip ${zipSize} 字节（4.5GB 零被 DEFLATE）`);

  console.log("== 2) readBackupMeta：只读中央目录 ==");
  const meta = await readZipBackupMeta(zipFile);
  check("meta 可读回", !!meta && meta.app === "incremental-reading-dev", JSON.stringify(meta).slice(0, 120));
  const t1 = Date.now();
  const meta2 = await backup.readBackupMeta(zipFile);
  check("backup.readBackupMeta（sidecar/worker 路径）可读回", !!meta2, JSON.stringify(meta2).slice(0, 120));
  console.log(`  · meta 解析 ${Date.now() - t1}ms`);

  console.log("== 3) extractAll：流式解包并比对大小 ==");
  const outDir = path.join(tmp, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const t2 = Date.now();
  await extractAll(zipFile, outDir);
  console.log(`  · 解包耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  check("library.db 解出且大小一致", fs.statSync(path.join(outDir, "library.db")).size === fs.statSync(dbFile).size, "library.db");
  check("4.5GB dictionary.db 解出且大小一致（ZIP64 条目无截断）", fs.statSync(path.join(outDir, "dictionary.db")).size === BIG, BIG);

  clearInterval(timer);
  console.log(`  · RSS 峰值 ${(peak / 1024 / 1024).toFixed(0)} MB`);
  check("RSS 峰值 < 500 MB（内存占用与文件大小无关）", peak < 500 * 1024 * 1024, peak);

  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  console.log(`\nC-12 ZIP64 大文件测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试异常：", err);
  process.exit(1);
});
