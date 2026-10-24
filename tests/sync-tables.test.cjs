// @runtime: electron
// C-38a：同步分类登记（electron/syncTables.js 唯一真源）的机器闸门。
// 运行：npx electron tests/sync-tables.test.cjs
// 覆盖（报告 C-38 步骤 5）：库内每张表恰好落在 SYNC/APPEND/LOCAL 之一；登记的名字都真实存在；
//   SYNC 表都有 id / sync_version / is_deleted 列；APPEND 表都有 id 列；
//   静态扫描 electron/*.js 的 DELETE FROM——SYNC/APPEND 表的物理删除必须出现在 PHYSICAL_DELETE_ALLOWLIST。
// 隔离：临时 userData（app.setPath），绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
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

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-tables-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const st = require(path.join(ROOT, "electron", "syncTables.js"));
    await db.initDb();

    // db.js 不导出原始连接——结构内省用第二个只读连接（WAL 下合法，bench-queue 同款）
    const conn = new Database(path.join(tmp, "library.db"));
    conn.pragma("busy_timeout = 5000");
    const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    const colsOf = (t) => conn.prepare("SELECT name FROM pragma_table_info(?)").all(t).map((r) => r.name);

    console.log("== T1 每张表恰好出现在 SYNC/APPEND/LOCAL 之一 ==");
    const SYNC = new Set(st.SYNC), APPEND = new Set(st.APPEND), LOCAL = new Set(st.LOCAL);
    const dup = tables.filter((t) => (SYNC.has(t) ? 1 : 0) + (APPEND.has(t) ? 1 : 0) + (LOCAL.has(t) ? 1 : 0) !== 1);
    check("库内每张表恰好登记一次（无遗漏、无重复登记）", dup.length === 0, "零重复/零遗漏", dup);
    // 反向：登记表里的每个名字都真实存在
    const ghost = [...SYNC, ...APPEND, ...LOCAL].filter((t) => !tables.includes(t));
    check("登记的名字都真实存在（无幽灵表）", ghost.length === 0, "零幽灵", ghost);

    console.log("== T2 SYNC 表要求 id + sync_version + is_deleted 列 ==");
    const syncMissing = {};
    for (const t of st.SYNC) {
      const cols = new Set(colsOf(t));
      const miss = ["id", "sync_version", "is_deleted"].filter((c) => !cols.has(c));
      if (miss.length) syncMissing[t] = miss;
    }
    check("SYNC 表都有 id/sync_version/is_deleted", Object.keys(syncMissing).length === 0, "零缺列", syncMissing);

    console.log("== T3 APPEND 表要求 id 列 ==");
    const appendMissing = st.APPEND.filter((t) => !colsOf(t).includes("id"));
    check("APPEND 表都有 id", appendMissing.length === 0, "零缺列", appendMissing);

    console.log("== T4 SYNC/APPEND 表的物理删除必须在 PHYSICAL_DELETE_ALLOWLIST ==");
    const allow = new Set(st.PHYSICAL_DELETE_ALLOWLIST.map((e) => e.table));
    const offenders = [];
    for (const f of fs.readdirSync(path.join(ROOT, "electron")).filter((f) => f.endsWith(".js"))) {
      const src = fs.readFileSync(path.join(ROOT, "electron", f), "utf8");
      for (const m of src.matchAll(/DELETE FROM\s+(\w+)/g)) {
        const t = m[1];
        if ((SYNC.has(t) || APPEND.has(t)) && !allow.has(t)) offenders.push(`${f}: ${t}`);
      }
    }
    check("SYNC/APPEND 表的物理删除全部在允许清单内", offenders.length === 0, "零越删", offenders);
    check("允许清单里的表名都真实存在于登记中（防拼写漂移）",
      st.PHYSICAL_DELETE_ALLOWLIST.every((e) => SYNC.has(e.table) || APPEND.has(e.table)),
      "全部 SYNC/APPEND", st.PHYSICAL_DELETE_ALLOWLIST.map((e) => e.table));

    console.log(`\n同步分类登记测试：${pass} 通过 / ${fail} 失败`);
    try { conn.close(); } catch { /* 忽略 */ }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* 清理失败无碍 */ }
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e.stack || e.message);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    process.exit(1);
  }
});
