// @runtime: electron
// C-10：数据库 schema 版本化（PRAGMA user_version）+ 迁移前快照 + 「库比程序新」拒开。
// 运行：npx electron tests/schema-version.test.cjs
// 覆盖：全新库不快照且版本到位 / 库比程序新 → DB_TOO_NEW 且文件零字节变化 / 旧库升级前快照且快照可读 /
//       二次 initDb 不新增快照 / 连续 5 次旧库升级最多保留 3 份快照。
// 隔离：临时 userData（app.setPath），绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const snapshots = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => /^library-v\d+-to-v\d+-.*\.db$/.test(f)).sort();
  } catch {
    return [];
  }
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "schema-version-"));
  const dbFile = path.join(tmp, "library.db");
  const snapDir = path.join(tmp, "backups", "pre-migration");
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const schema = require(path.join(ROOT, "electron", "schemaVersion.js"));
    const readVersion = () => {
      const c = new Database(dbFile);
      try { return Number(c.pragma("user_version", { simple: true })) || 0; } finally { c.close(); }
    };
    const writeVersion = (v) => {
      const c = new Database(dbFile);
      try { c.pragma(`user_version = ${v}`); } finally { c.close(); }
    };

    console.log("== S1 全新库：版本到位、不快照 ==");
    await db.initDb();
    check("S1-1 新库 user_version === SCHEMA_VERSION", readVersion() === schema.SCHEMA_VERSION, schema.SCHEMA_VERSION, readVersion());
    check("S1-2 新库不产生迁移前快照（目录不存在或为空）", snapshots(snapDir).length === 0, "0 份", snapshots(snapDir));

    console.log("== S2 库比程序新：DB_TOO_NEW 且零写入 ==");
    db.closeDb();
    writeVersion(schema.SCHEMA_VERSION + 1);
    const shaBefore = sha256(dbFile);
    let thrown = null;
    try { await db.initDb(); } catch (e) { thrown = e; }
    check("S2-1 initDb 抛出 DB_TOO_NEW", !!thrown && thrown.code === "DB_TOO_NEW", "DB_TOO_NEW", thrown && { code: thrown.code, message: thrown.message });
    check("S2-2 拒绝打开时库文件逐字节不变", sha256(dbFile) === shaBefore, shaBefore, sha256(dbFile));
    check("S2-3 拒绝打开时新库也不产生快照", snapshots(snapDir).length === 0, "0 份", snapshots(snapDir));

    console.log("== S3 旧库升级：先快照，快照可读 ==");
    writeVersion(0);
    await db.initDb();
    const snaps3 = snapshots(snapDir);
    check("S3-1 旧库（v0）升级后版本到位", readVersion() === schema.SCHEMA_VERSION, schema.SCHEMA_VERSION, readVersion());
    check("S3-2 产生 1 份迁移前快照", snaps3.length === 1, 1, snaps3);
    let snapOk = false;
    let snapQc = null;
    try {
      const snapFile = path.join(snapDir, snaps3[0] || "");
      const c = new Database(snapFile, { readonly: true, fileMustExist: true });
      try { snapQc = c.pragma("quick_check", { simple: true }); } finally { c.close(); }
      snapOk = snaps3.length === 1 && snapQc === "ok";
    } catch (e) {
      snapQc = String(e && e.message);
    }
    check("S3-3 快照能被 better-sqlite3 打开且 quick_check = ok", snapOk, "ok", snapQc);

    console.log("== S4 二次 initDb：不新增快照 ==");
    await db.initDb();
    check("S4-1 版本仍为 SCHEMA_VERSION", readVersion() === schema.SCHEMA_VERSION, schema.SCHEMA_VERSION, readVersion());
    check("S4-2 快照数量仍为 1", snapshots(snapDir).length === 1, 1, snapshots(snapDir));

    console.log("== S5 连续 5 次旧库升级：最多保留 3 份快照 ==");
    for (let i = 0; i < 5; i++) {
      db.closeDb();
      writeVersion(0);
      await new Promise((r) => setTimeout(r, 5)); // 快照文件名含毫秒时间戳，避免同毫秒覆盖
      await db.initDb();
    }
    check("S5-1 快照目录最多 3 份（含本轮）", snapshots(snapDir).length <= 3, "≤3", snapshots(snapDir));
    check("S5-2 恰为 3 份（保留最近）", snapshots(snapDir).length === 3, 3, snapshots(snapDir));
    check("S5-3 每次升级后版本仍到位", readVersion() === schema.SCHEMA_VERSION, schema.SCHEMA_VERSION, readVersion());

    console.log(`\n==== schema-version.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
    const code = fail === 0 ? 0 : 1;
    app.exit(code); // D239：app.quit() 会先以 0 退出、定时器里的 process.exit 来不及执行——直接 app.exit(code)
  }
});
