// @runtime: electron
// C-38b：同步触发器（electron/syncTriggers.js，每次启动幂等重建）。
// 运行：npx electron tests/sync-triggers.test.cjs
// 覆盖（报告 C-38 步骤 5）：插入 sync_version=0 / 改值 +1 且 updated_at 不变 / 无变化不递增 /
//   手写 +1 不重复递增 / recursive_triggers=ON 仍只 +1 / 删除写墓碑 / 同 id 重插撤销墓碑 /
//   review_logs 物理删除也写墓碑 / 重启重建幂等 / 新增列自动纳入"真变化"判断。
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-triggers-"));
  const dbFile = path.join(tmp, "library.db");
  let seed = null;
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    // 第二个连接直跑 SQL（WAL 下合法；bench-queue 同款）
    seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    const row = (sql, params = []) => seed.prepare(sql).get(...params);
    const tombstones = (tbl, rid) =>
      seed.prepare("SELECT COUNT(*) AS n FROM sync_tombstones WHERE tbl = ? AND row_id = ?").get(tbl, rid).n;

    console.log("== S1 插入 → sync_version = 0 ==");
    const ID = "sync-trig-card-1";
    seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, front_markdown, back_markdown, created_at, updated_at)
       VALUES (?, 'local-user', '笔记', '问', '答', 1000, 2000)`
    ).run(ID);
    check("新插入行 sync_version = 0", row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === 0, 0,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);
    const updatedAt0 = row("SELECT updated_at AS u FROM cards WHERE id = ?", [ID]).u;

    console.log("== S2 真变化 UPDATE → +1 且 updated_at 不变；同值再跑不变 ==");
    seed.exec("UPDATE cards SET priority = 60");
    check("改值后 sync_version = 1", row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === 1, 1,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);
    check("updated_at 不变（触发器绝不碰它）", row("SELECT updated_at AS u FROM cards WHERE id = ?", [ID]).u === updatedAt0,
      updatedAt0, row("SELECT updated_at AS u FROM cards WHERE id = ?", [ID]).u);
    seed.exec("UPDATE cards SET priority = 60");
    check("同值再 UPDATE 不递增（无真变化）", row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === 1, 1,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);

    console.log("== S3 业务语句手写 +1 → 不重复递增 ==");
    seed.exec("UPDATE cards SET priority = 70, sync_version = sync_version + 1");
    check("手写 +1 后恰为 2（触发器不补刀）", row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === 2, 2,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);

    console.log("== S4 PRAGMA recursive_triggers = ON 仍只 +1 ==");
    seed.pragma("recursive_triggers = ON");
    seed.exec("UPDATE cards SET priority = 80");
    check("递归触发器开启下仍只 +1（= 3）", row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === 3, 3,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);
    seed.pragma("recursive_triggers = OFF");

    console.log("== S5 DELETE → 墓碑；同 id 重插 → 墓碑消失 ==");
    seed.prepare("DELETE FROM cards WHERE id = ?").run(ID);
    check("删除后 sync_tombstones 有 ('cards', id)", tombstones("cards", ID) === 1, 1, tombstones("cards", ID));
    seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, front_markdown, back_markdown, created_at, updated_at)
       VALUES (?, 'local-user', '笔记', '问', '答', 1000, 2000)`
    ).run(ID);
    check("同 id 重新插入后墓碑被撤销", tombstones("cards", ID) === 0, 0, tombstones("cards", ID));

    console.log("== S6 review_logs（APPEND 表）物理删除也写墓碑 ==");
    const LOG = "sync-trig-log-1";
    seed.prepare("INSERT INTO review_logs (id, card_id, rating, reviewed_at) VALUES (?, ?, 'Good', 3000)").run(LOG, ID);
    check("APPEND 表插入不写墓碑", tombstones("review_logs", LOG) === 0, 0, tombstones("review_logs", LOG));
    seed.prepare("DELETE FROM review_logs WHERE id = ?").run(LOG);
    check("删除后 sync_tombstones 有 ('review_logs', id)", tombstones("review_logs", LOG) === 1, 1, tombstones("review_logs", LOG));

    console.log("== S7 重启重建幂等（先删后建，触发器数不变） ==");
    const triggerCount = () =>
      seed.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'").get().n;
    const before = triggerCount();
    check("首轮触发器已装且数量合理（SYNC+APPEND=28 表，ver 仅含 sync_version 表）", before >= 28, ">= 28", before);
    try { seed.close(); } catch { /* 忽略 */ }
    seed = null;
    db.closeDb();
    await db.initDb();
    seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    check("closeDb + initDb 后触发器数量不变（幂等重建）", triggerCount() === before, before, triggerCount());

    console.log("== S8 第二连接 ALTER 新列 → 重启后新列纳入真变化判断 ==");
    seed.exec("ALTER TABLE cards ADD COLUMN zz_test TEXT");
    const v0 = row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v;
    try { seed.close(); } catch { /* 忽略 */ }
    seed = null;
    db.closeDb();
    await db.initDb();
    seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    seed.prepare("UPDATE cards SET zz_test = 'x' WHERE id = ?").run(ID);
    check("重启后写新列也递增 sync_version（新列被纳入）",
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v === v0 + 1, v0 + 1,
      row("SELECT sync_version AS v FROM cards WHERE id = ?", [ID]).v);

    console.log(`\n同步触发器测试：${pass} 通过 / ${fail} 失败`);
    try { seed.close(); } catch { /* 忽略 */ }
    seed = null;
    db.closeDb();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* 清理失败无碍 */ }
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e.stack || e.message);
    try { if (seed) seed.close(); } catch { /* 忽略 */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    process.exit(1);
  }
});
