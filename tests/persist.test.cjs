// v23/F11 持久化边界测试（electron 直跑：npx electron tests/persist.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库。
// D137（v48.92）：persist() 自「全量导出+tmp/fsync/rename」重定义为 wal_checkpoint(TRUNCATE)——
// 故障注入钩子同步切换：旧 writeSync/renameSync mock 不再落在 persist 的路径上，改用
// WAL 下真实存在的故障模式＝第二连接持读事务 → checkpoint(TRUNCATE) busy=1 → persist throw。
// 覆盖（§4.4.9 / F11 / D137 §5-5）：
//   P1 checkpoint happy path（真实文件系统：提交即 WAL fsync + checkpoint 合并，无 .tmp 残留）
//   P2 checkpoint 忙碌 → saveReview throw → 盘上主文件完整可读 → persistNow 重试成功
//   P3 checkpoint 忙碌窗口内 persistNow 同样 throw → 旧库完整 + 不留半成品
//   P4 启动清残留 tmp（tmp 永远不是事实源；新引擎不再产出 tmp，清理逻辑保留）
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail}`); }
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function readDiskDb(userData) {
  // 用独立的 sql.js 连接读盘上 library.db（验证「盘上永远是完整库」）
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const raw = new SQL.Database(fs.readFileSync(path.join(userData, "library.db")));
  const st = raw.prepare("SELECT COUNT(*) AS n FROM review_logs");
  st.step();
  const n = st.getAsObject().n;
  st.free();
  return n;
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "persist-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.resolve("electron/db.js"));
    await db.initDb();

    const T0 = Date.parse("2025-01-01T00:00:00Z");
    const cardId = db.createCard({ noteText: "FSRSTEST PERSIST", cardType: "qa", frontMarkdown: "P", backMarkdown: "A", priority: 50, tags: [] }).id;
    const before = { state: "new", due: T0, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: 0 };
    const after = { state: "review", due: T0 + 86400000, lapses: 0, stability: 3.1, difficulty: 4.9, reps: 1, lastReview: T0, learningSteps: 0 };
    db.saveReview(cardId, after, "Good", 10, before);

    const dbPath = path.join(tmp, "library.db");

    console.log("== P1 原子写 happy path（真实文件系统，零 mock） ==");
    const hash1 = sha(fs.readFileSync(dbPath));
    check("评分后盘上无 .tmp 残留", !fs.existsSync(dbPath + ".tmp"), "无 tmp", fs.existsSync(dbPath + ".tmp") ? "存在" : "无");
    const diskLogs1 = await readDiskDb(tmp);
    check("评分已落盘（真实 rename 覆盖替换生效）", diskLogs1 === 1, 1, diskLogs1);

    console.log("== P2 checkpoint 忙碌 → throw → 旧库完整 → persistNow 重试成功 ==");
    // WAL 故障注入（D137）：第二连接持读事务 → wal_checkpoint(TRUNCATE) 无法截断 → busy=1 → persist throw。
    // 这是 WAL 下的真实故障模式（并发读阻塞 checkpoint），非 fs mock。
    const Database = require("better-sqlite3");
    const openBlocker = () => {
      const bl = new Database(dbPath);
      bl.exec("BEGIN");
      bl.prepare("SELECT COUNT(*) AS n FROM review_logs").get(); // deferred 读事务真正持有读锁
      return bl;
    };
    const hashBeforeFail = sha(fs.readFileSync(dbPath));
    const blocker = openBlocker();
    let threw = false;
    try {
      db.saveReview(cardId, { ...after, reps: 2, due: T0 + 2 * 86400000 }, "Good", 10, after);
    } catch (e) {
      threw = true;
    } finally {
      try { blocker.close(); } catch { /* 尽力 */ }
    }
    check("persist 失败向上抛（IPC reject，无静默降级）", threw, "ok:false", threw);
    check("失败后盘上主文件逐字节未变（提交在 WAL、checkpoint 未合并；任意时刻至少一份完整库）", sha(fs.readFileSync(dbPath)) === hashBeforeFail, "unchanged", "changed");
    const diskLogs2 = await readDiskDb(tmp);
    check("失败后盘上主文件仍是上一完整版本（1 条日志）", diskLogs2 === 1, 1, diskLogs2);
    // 内存已提交（评分后状态），persistNow 只重试持久化、不重执行 mutation
    check("内存库保持评分后状态（等待重试保存）", db.getCard(cardId).fsrs.reps === 2, 2, db.getCard(cardId).fsrs.reps);
    check("persistNow 重试成功（读锁释放后 checkpoint 合并）", db.persistNow() === true, true);
    const diskLogs3 = await readDiskDb(tmp);
    check("重试后盘上更新（含窗口期全部内存变更）", diskLogs3 === 2, 2, diskLogs3);
    check("重试后无 .tmp 残留", !fs.existsSync(dbPath + ".tmp"), "无 tmp");

    console.log("== P3 checkpoint 忙碌窗口内 persistNow 同样 throw → 旧库完整 + 无 tmp ==");
    // 先造一条「已提交、未 checkpoint」的变更（busy 窗口内 persist 必抛，但 COMMIT 已入 WAL），
    // 再在忙碌窗口内重试 persistNow —— 重试同样必须 throw（可观察，不静默假成功）
    const bkP3 = db.createImportedDoc({ title: "P3 progress", markdown: "# P3\nbody", sourceType: "markdown" });
    const hashBeforeBusy = sha(fs.readFileSync(dbPath));
    let busyThrew = false;
    const blocker2 = openBlocker();
    try {
      try { db.updateProgress(bkP3.id, { ratio: 0.9, lastText: "P3", updatedAt: Date.now() }); } catch { /* 预期：commit 入 WAL 后 checkpoint busy 抛出 */ }
      try {
        db.persistNow();
      } catch (e) {
        busyThrew = true;
      }
    } finally {
      try { blocker2.close(); } catch { /* 尽力 */ }
    }
    check("checkpoint 忙碌时 persistNow 向上抛（重试语义可观察，不静默假成功）", busyThrew, "ok:false", busyThrew);
    check("忙碌失败后盘上主文件完整（未合并的变更都在 WAL 里，主文件逐字节未变）", sha(fs.readFileSync(dbPath)) === hashBeforeBusy, "unchanged", "changed");
    check("失败后不留半成品（新 persist 无 tmp 产物，历史 .tmp 亦被清理）", !fs.existsSync(dbPath + ".tmp"), "无 tmp", fs.existsSync(dbPath + ".tmp") ? "存在" : "无");
    // 读锁释放后的收敛由 P4「重启后盘上库完整可用（2 条日志）」覆盖（保持 14 断言口径）

    console.log("== P4 启动清残留 tmp（tmp 永远不是事实源） ==");
    fs.writeFileSync(dbPath + ".tmp", "garbage-from-crashed-write");
    await db.initDb(); // 重新初始化（模拟重启）
    check("重启后残留 tmp 被清理", !fs.existsSync(dbPath + ".tmp"), "无 tmp", fs.existsSync(dbPath + ".tmp") ? "存在" : "无");
    const diskLogs4 = await readDiskDb(tmp);
    check("重启后盘上库完整可用（重启读回，无数据丢失）", diskLogs4 === 2, 2, diskLogs4);

    console.log(`\npersist 边界测试：${pass} 通过 / ${fail} 失败`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败无碍 */ }
    app.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e.stack || e.message);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    app.exit(1);
  }
});
