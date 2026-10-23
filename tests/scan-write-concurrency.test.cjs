// @runtime: electron
// C-43：卡片浏览分块扫描期间，主数据库上的任何写入都会抛错——
// better-sqlite3 同一连接上有游标未关闭时只接受只读语句，写语句抛
// "This database connection is busy executing a query"。
// scanCards 改为「同步取有序 id → 按块主键取整行 → 块间让出」后，
// 任何时刻都不跨 await 持有游标，扫描期间的写入（评分、编辑自动保存、删除）不再失败。
// 运行：npx electron tests/scan-write-concurrency.test.cjs（或 node scripts/run-tests.mjs scan-write-concurrency）
// 隔离：userData 指向临时目录（app.setPath + mkdtemp），绝不触碰真实库（C-11 口径）。
// 播种用第二个 better-sqlite3 连接按附录 A 的 INSERT 语句批量写 6000 张卡（WAL：提交后主连接可见）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "electron", "db.js");

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scan-write-"));
  app.setPath("userData", tmp);
  const db = require(DB_PATH);
  await db.initDb();
  let seed = null;
  try {
    // ---- 播种：附录 A 同款 INSERT，6000 张卡，created_at 各不相同 ----
    const Database = require("better-sqlite3");
    const dbFile = path.join(tmp, "library.db");
    const DAY = 24 * 3600 * 1000;
    const N = 6000;
    seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    const now = Date.now();
    const ins = seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown,
                          priority, tags_json, fsrs_json, created_at, updated_at)
       VALUES (?, 'local', ?, 'qa', ?, ?, 50, '["bench"]', ?, ?, ?)`
    );
    seed.transaction(() => {
      for (let i = 0; i < N; i++) {
        const fsrs = { state: "review", due: now + (1 + (i % 365)) * DAY, stability: 10 + (i % 50), difficulty: 5, reps: 3, lapses: 0, lastReview: now - 5 * DAY };
        const created = now - (N - i) * 1000; // 各不相同 → created_at DESC 全序确定
        ins.run(`bench-${i}`, `笔记 ${i}`, `问题 ${i} ` + "问".repeat(30), `答案 ${i} ` + "答".repeat(60),
          JSON.stringify(fsrs), created, created);
      }
    })();
    seed.close();
    seed = null;

    // ---- S1 getCardBrowserMeta：不 await（同步部分执行到第一个让出点，旧实现的游标处于打开状态）----
    const p = db.getCardBrowserMeta();
    let delErr = null, delOk = null;
    try { delOk = db.deleteCard("bench-5"); } catch (e) { delErr = e; }
    check("(1a) 扫描期间 deleteCard 不抛错", delErr === null, null, delErr && (delErr.message || String(delErr)));
    check("(1b) deleteCard 返回 true", delOk === true, true, delOk);
    const r = await p;
    check("(1c) 扫描完成 total 为 6000 或 5999", r.total === 6000 || r.total === 5999, "6000|5999", r.total);

    // ---- S2 指纹变化后重算：total === 5999 且顺序与全序 SQL 完全一致 ----
    const r2 = await db.getCardBrowserMeta();
    check("(2a) 删除生效后重算 total === 5999", r2.total === 5999, 5999, r2.total);
    const ro = new Database(dbFile, { readonly: true });
    const expectIds = ro.prepare("SELECT id FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC").pluck().all();
    ro.close();
    const gotIds = r2.meta.map((m) => m.id);
    check("(2b) meta id 顺序与全序查询完全相同", JSON.stringify(gotIds) === JSON.stringify(expectIds), expectIds.length, gotIds.length);

    // ---- S3 queryCardBrowserIds（含文本条件 → 走分块扫描分支）：同样不 await 立即写入 ----
    const cardQueryCore = require(path.join(ROOT, "electron", "cardQuery.bundle.cjs"));
    const parsed = cardQueryCore.parseCardQuery("问题");
    const hasTextLeaf = (node) => !node ? false : node.t === "leaf"
      ? (node.leaf.f === "text" || node.leaf.f === "tag")
      : node.t === "not" ? hasTextLeaf(node.kid) : node.kids.some(hasTextLeaf);
    check("(3a) 查询「问题」确实走文本扫描分支", Boolean(parsed.ast) && hasTextLeaf(parsed.ast), true, false);
    const p3 = db.queryCardBrowserIds("问题");
    let delErr3 = null, delOk3 = null;
    try { delOk3 = db.deleteCard("bench-6"); } catch (e) { delErr3 = e; }
    check("(3b) 文本扫描期间 deleteCard 不抛错", delErr3 === null, null, delErr3 && (delErr3.message || String(delErr3)));
    check("(3c) deleteCard 返回 true", delOk3 === true, true, delOk3);
    const r3 = await p3;
    check("(3d) 文本扫描命中数合理（5997–5999）", r3.meta.length >= 5997 && r3.meta.length <= 5999, "5997–5999", r3.meta.length);

    // ---- S4 静态守卫：electron/*.js 不得出现跨 await 的 .iterate（带 // sync-iterate-ok 行内注释的除外）----
    const electronDir = path.join(ROOT, "electron");
    const offenders = [];
    for (const f of fs.readdirSync(electronDir).filter((x) => x.endsWith(".js"))) {
      const lines = fs.readFileSync(path.join(electronDir, f), "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (line.includes(".iterate(") && !line.includes("// sync-iterate-ok")) {
          offenders.push(`${f}:${idx + 1}`);
        }
      });
    }
    check("(4a) electron/*.js 无未标注的 .iterate(", offenders.length === 0, [], offenders);
  } catch (e) {
    fail += 1;
    console.log(`  ✗ 场景执行异常：${(e && (e.stack || e.message)) || e}`);
  } finally {
    console.log(`\nscan-write-concurrency: ${pass} 通过 / ${fail} 失败`);
    try {
      if (seed && seed.open) seed.close();
    } catch { /* 尽力 */ }
    try {
      db.closeDb();
    } catch { /* 尽力 */ }
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
    app.exit(fail > 0 ? 1 : 0);
  }
});
