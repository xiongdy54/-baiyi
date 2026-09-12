// v23/F11 持久化边界测试（electron 直跑：npx electron tests/persist.test.cjs，须先关应用）
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库。
// 覆盖（§4.4.9 / F11）：
//   P1 原子写 happy path（真实文件系统：tmp+fsync+rename 覆盖替换，无 .tmp 残留）
//   P2 writeSync 失败 → saveReview throw → 盘上旧库完整可读 → persistNow 重试成功
//   P3 renameSync 失败 → throw → 旧库完整 + tmp 残留（启动清理兜底）
//   P4 启动清残留 tmp（tmp 永远不是事实源）
//   P5 persist 失败窗口「任意时刻至少一份完整库」不变量
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
  const realWriteSync = fs.writeSync;
  const realRenameSync = fs.renameSync;
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

    console.log("== P2 writeSync 失败 → throw → 旧库完整 → persistNow 重试成功 ==");
    const hashBeforeFail = sha(fs.readFileSync(dbPath));
    let threw = false;
    fs.writeSync = () => { throw new Error("模拟 write 失败"); };
    try {
      db.saveReview(cardId, { ...after, reps: 2, due: T0 + 2 * 86400000 }, "Good", 10, after);
    } catch (e) {
      threw = true;
    } finally {
      fs.writeSync = realWriteSync;
    }
    check("persist 失败向上抛（IPC reject，无静默降级）", threw, "ok:false", threw);
    check("失败后盘上旧库逐字节未变（任意时刻至少一份完整库）", sha(fs.readFileSync(dbPath)) === hashBeforeFail, "unchanged", "changed");
    const diskLogs2 = await readDiskDb(tmp);
    check("失败后盘上仍是上一完整版本（1 条日志）", diskLogs2 === 1, 1, diskLogs2);
    // 内存已提交（评分后状态），persistNow 只重试持久化、不重执行 mutation
    check("内存库保持评分后状态（等待重试保存）", db.getCard(cardId).fsrs.reps === 2, 2, db.getCard(cardId).fsrs.reps);
    check("persistNow 重试成功", db.persistNow() === true, true);
    const diskLogs3 = await readDiskDb(tmp);
    check("重试后盘上更新（含窗口期全部内存变更）", diskLogs3 === 2, 2, diskLogs3);
    check("重试后无 .tmp 残留", !fs.existsSync(dbPath + ".tmp"), "无 tmp");

    console.log("== P3 renameSync 失败 → throw → 旧库完整 + tmp 残留 ==");
    const hashBeforeRenameFail = sha(fs.readFileSync(dbPath));
    let renameThrew = false;
    fs.renameSync = () => { throw new Error("模拟 rename 失败（Windows 文件锁）"); };
    try {
      db.persistNow();
    } catch (e) {
      renameThrew = true;
    } finally {
      fs.renameSync = realRenameSync;
    }
    check("rename 失败向上抛", renameThrew, "ok:false", renameThrew);
    check("rename 失败后盘上旧库完整", sha(fs.readFileSync(dbPath)) === hashBeforeRenameFail, "unchanged", "changed");
    check("rename 失败后 tmp 残留（属预期，启动清理兜底）", fs.existsSync(dbPath + ".tmp"), "存在", "不存在");

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
