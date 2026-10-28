// @runtime: electron-node
// D248 / T2：behavior.db 打开、pragma、DDL、迁移、损坏/版本过新降级、快照（§5.1–§5.3）。
// 运行：node scripts/run-tests.mjs behavior-db
// 隔离：每个场景 fs.mkdtempSync 临时目录，绝不触碰真实 userData。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));

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

const EXPECTED_TABLES = [
  "app_sessions", "archived_days", "attn_spans", "bdi_meta", "capture_intervals", "coverage_day",
  "daily_metrics", "dirty_days", "domain_day", "entity_domains", "events", "ipc_daily", "item_day", "signal_daily",
];

function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bdi-${tag}-`));
}
function tablesOf(conn) {
  return conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
}

(async () => {
  console.log("== A 新建库：DDL / pragma / meta / seq AUTOINCREMENT ==");
  {
    const dir = freshDir("db-create");
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    const db = await behaviorDb.open();
    const st = behaviorDb.getStatus();
    check("新建库打开成功", !!db && st.status === "ok", "ok", st);
    check("user_version = BDI_SCHEMA_VERSION(1)", behaviorDb.readUserVersion(db) === 1, 1, behaviorDb.readUserVersion(db));
    check("14 张表全部建成（与 §5.2 清单一致）", JSON.stringify(tablesOf(db)) === JSON.stringify(EXPECTED_TABLES), EXPECTED_TABLES, tablesOf(db));
    const p = (x) => db.pragma(x, { simple: true });
    check("journal_mode = wal", String(p("journal_mode")).toLowerCase() === "wal", "wal", p("journal_mode"));
    check("synchronous = FULL(2)", p("synchronous") === 2, 2, p("synchronous"));
    check("busy_timeout = 2000（BDI 独立连接）", p("busy_timeout") === 2000, 2000, p("busy_timeout"));
    check("auto_vacuum = INCREMENTAL(2)", p("auto_vacuum") === 2, 2, p("auto_vacuum"));
    check("journal_size_limit = 16MiB", p("journal_size_limit") === 16777216, 16777216, p("journal_size_limit"));
    check("wal_autocheckpoint = 1000", p("wal_autocheckpoint") === 1000, 1000, p("wal_autocheckpoint"));
    check("foreign_keys = OFF(0)", p("foreign_keys") === 0, 0, p("foreign_keys"));
    check("temp_store = FILE(1)", p("temp_store") === 1, 1, p("temp_store"));
    check("cache_size = -8000", p("cache_size") === -8000, -8000, p("cache_size"));

    behaviorDb.setMeta("data_epoch", "epoch-1");
    check("bdi_meta 写入/读回", behaviorDb.getMeta("data_epoch") === "epoch-1", "epoch-1", behaviorDb.getMeta("data_epoch"));
    check("缺失 meta 返回 fallback", behaviorDb.getMeta("nope", "fb") === "fb", "fb", behaviorDb.getMeta("nope", "fb"));

    const ins = db.prepare("INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (let i = 1; i <= 3; i++) ins.run(`uid-${i}`, i, i, "2026-10-28", -480, 4, "nav.view", "main", "s");
    const seqs = db.prepare("SELECT seq FROM events ORDER BY seq").all().map((r) => r.seq);
    check("seq 从 1 递增", JSON.stringify(seqs) === JSON.stringify([1, 2, 3]), [1, 2, 3], seqs);
    db.prepare("DELETE FROM events WHERE seq = 3").run();
    ins.run("uid-4", 4, 4, "2026-10-28", -480, 4, "nav.view", "main", "s");
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM events").get().m;
    check("删到最大行后 seq 不复用（AUTOINCREMENT）", maxSeq === 4, 4, maxSeq);

    console.log("== B 快照与关闭 ==");
    const snap = path.join(dir, "snapshot.db");
    await behaviorDb.snapshotTo(snap);
    const sconn = new Database(snap, { readonly: true });
    check("快照含已提交行（含 WAL 内容）", sconn.prepare("SELECT COUNT(*) AS n FROM events").get().n === 3, 3, sconn.prepare("SELECT COUNT(*) AS n FROM events").get().n);
    check("快照 user_version 一致", Number(sconn.pragma("user_version", { simple: true })) === 1, 1, sconn.pragma("user_version", { simple: true }));
    sconn.close();
    const closed = behaviorDb.close();
    check("关闭返回 checkpoint 结果", closed.closed === true && closed.checkpoint !== "error", "已关闭", closed);
    const wal = path.join(dir, "behavior.db-wal");
    check("关闭后 WAL 已合并（无 -wal 或为 0 字节）", !fs.existsSync(wal) || fs.statSync(wal).size === 0, "已合并", fs.existsSync(wal) ? fs.statSync(wal).size : "missing");
    check("关闭后 status=closed", behaviorDb.getStatus().status === "closed", "closed", behaviorDb.getStatus().status);
    cleanup(dir);
  }

  console.log("== C 重复打开幂等 ==");
  {
    const dir = freshDir("db-reopen");
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    let db = await behaviorDb.open();
    db.prepare("INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id) VALUES ('u1',1,1,'2026-10-28',-480,4,'nav.view','main','s')").run();
    behaviorDb.close();
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    db = await behaviorDb.open();
    check("重开后数据保留", db.prepare("SELECT COUNT(*) AS n FROM events").get().n === 1, 1, "丢失");
    check("重开不重复迁移（user_version 仍 1）", behaviorDb.readUserVersion(db) === 1, 1, behaviorDb.readUserVersion(db));
    check("重开表集合不变", JSON.stringify(tablesOf(db)) === JSON.stringify(EXPECTED_TABLES), "一致", tablesOf(db));
    behaviorDb.close();
    cleanup(dir);
  }

  console.log("== D 版本过新：停用、不迁移、不碰文件 ==");
  {
    const dir = freshDir("db-too-new");
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    const db = await behaviorDb.open();
    db.prepare("INSERT INTO bdi_meta (key,value) VALUES ('k','v')").run();
    behaviorDb.close();
    const file = path.join(dir, "behavior.db");
    const raw = new Database(file);
    raw.pragma("user_version = 99");
    raw.close();
    const before = fs.readFileSync(file);
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    const got = await behaviorDb.open();
    const st = behaviorDb.getStatus();
    check("版本过新返回 null（停用）", got === null, null, !!got);
    check("原因 = db_too_new", st.reason === "db_too_new", "db_too_new", st.reason);
    const probe = new Database(file, { readonly: true });
    const uv = Number(probe.pragma("user_version", { simple: true }));
    probe.close();
    check("文件未被迁移（user_version 仍 99）", uv === 99, 99, uv);
    check("文件字节未被改写", Buffer.compare(before, fs.readFileSync(file)) === 0, "字节一致", "存在差异");
    cleanup(dir);
  }

  console.log("== E 损坏库：停用并保留现场（不自动改名/新建） ==");
  {
    const dir = freshDir("db-corrupt");
    const file = path.join(dir, "behavior.db");
    const garbage = Buffer.from("this is not a sqlite database — BDI keeps the scene", "utf8");
    fs.writeFileSync(file, garbage);
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    const got = await behaviorDb.open();
    const st = behaviorDb.getStatus();
    check("损坏库返回 null（停用）", got === null, null, !!got);
    check("原因 = db_corrupt", st.reason === "db_corrupt", "db_corrupt", st.reason);
    check("现场字节未被覆盖", Buffer.compare(garbage, fs.readFileSync(file)) === 0, "字节一致", "被改写");
    check("目录内没有自动新建的副本", fs.readdirSync(dir).length === 1, 1, fs.readdirSync(dir));
    cleanup(dir);
  }

  console.log("== F 打开失败（路径不可用）：停用、不抛出 ==");
  {
    const dir = freshDir("db-open-fail");
    const blocked = path.join(dir, "blocked");
    fs.writeFileSync(blocked, "x");
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: blocked });
    let threw = null;
    let got = null;
    try { got = await behaviorDb.open(); } catch (e) { threw = e; }
    check("打开失败不抛出", threw === null, null, String(threw && threw.message));
    check("返回 null 且状态 disabled", got === null && behaviorDb.getStatus().status === "disabled", "disabled", behaviorDb.getStatus());
    check("失败原因可读", ["open_failed", "db_error"].includes(behaviorDb.getStatus().reason), "open_failed|db_error", behaviorDb.getStatus().reason);
    cleanup(dir);
  }

  console.log("== G 迁移失败回滚（事务 + user_version 不变） ==");
  {
    const dir = freshDir("db-migrate");
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: dir });
    const db = await behaviorDb.open();
    const bad = [{ version: 2, name: "bad", up(conn) { conn.exec("CREATE TABLE should_not_exist (a)"); throw new Error("boom"); } }];
    let threw = null;
    try { behaviorDb.runMigrations(db, bad); } catch (e) { threw = e; }
    check("失败迁移抛出", !!threw, "throw", "未抛");
    check("迁移失败后 user_version 仍 1", behaviorDb.readUserVersion(db) === 1, 1, behaviorDb.readUserVersion(db));
    check("失败迁移里的 DDL 已回滚（无 residue 表）", !tablesOf(db).includes("should_not_exist"), "无 residue", tablesOf(db));
    behaviorDb.close();
    cleanup(dir);
  }

  console.log(`\n==== behavior-db ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  behaviorDb.resetForTest();
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
