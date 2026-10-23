// scripts/bench-queue.cjs —— 规模基准（审计附录 A）
// @runtime: electron
// 只在临时目录造数据，绝不触碰真实用户数据目录。
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const N = Math.max(1, parseInt(process.env.BENCH_N || "10000", 10));
const DUE_EVERY = Math.max(1, parseInt(process.env.BENCH_DUE_EVERY || "10", 10)); // 10 = 10% 到期
const DAY = 24 * 3600 * 1000;

const msSince = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
async function time(label, fn, extra) {
  const runs = [];
  let last;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    last = await fn();
    runs.push(msSince(t0));
  }
  const sorted = [...runs].sort((a, b) => a - b);
  console.log(`${label}：首次 ${runs[0].toFixed(1)} ms，中位 ${sorted[1].toFixed(1)} ms${extra ? "，" + extra(last) : ""}`);
  return last;
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nut-bench-"));
  let db = null;
  try {
    app.setPath("userData", tmp);
    db = require("../electron/db.js");
    await db.initDb();

    // 用第二个连接批量播种（WAL 模式：提交后主连接立即可见；比逐条走业务 API 快几个数量级）
    const Database = require("better-sqlite3");
    const dbFile = path.join(tmp, "library.db");
    const seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    const now = Date.now();
    const ins = seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown,
                          priority, tags_json, fsrs_json, created_at, updated_at)
       VALUES (?, 'local', ?, 'qa', ?, ?, 50, '["bench"]', ?, ?, ?)`
    );
    let t0 = process.hrtime.bigint();
    seed.transaction(() => {
      for (let i = 0; i < N; i++) {
        const due = i % DUE_EVERY === 0 ? now - DAY : now + (1 + (i % 365)) * DAY;
        const fsrs = { state: "review", due, stability: 10 + (i % 50), difficulty: 5, reps: 3, lapses: 0, lastReview: now - 5 * DAY };
        const created = now - (N - i) * 1000;
        ins.run(`bench-${i}`, `笔记 ${i}`, `问题 ${i} ` + "问".repeat(30), `答案 ${i} ` + "答".repeat(60),
          JSON.stringify(fsrs), created, created);
      }
    })();
    console.log(`播种 ${N} 张卡（每 ${DUE_EVERY} 张有 1 张到期）：${msSince(t0).toFixed(0)} ms`);

    // 写入开销（C-38 触发器上线后对比用）：真实改值，单事务
    const M = Math.min(2000, N);
    const upd = seed.prepare("UPDATE cards SET priority = ? WHERE id = ?");
    t0 = process.hrtime.bigint();
    seed.transaction(() => { for (let i = 0; i < M; i++) upd.run(51 + (i % 40), `bench-${i}`); })();
    console.log(`更新 ${M} 次（单事务）：${msSince(t0).toFixed(1)} ms`);
    seed.close();

    await time("computeTodayQueue(now)", () => db.computeTodayQueue(now), (q) => `到期 ${q.cards.length} 张`);
    // C-18 之前第二个参数被忽略，两行结果应当相同
    await time("computeTodayQueue(now, {withDamaged:false})", () => db.computeTodayQueue(now, { withDamaged: false }),
      (q) => `到期 ${q.cards.length} 张`);
    await time("listAllCards()", () => db.listAllCards(),
      (r) => `IPC 负载 ${(Buffer.byteLength(JSON.stringify(r)) / 1048576).toFixed(1)} MB`);
    // 按 COUNT+MAX(updated_at) 指纹缓存：只有"首次"是真实扫描
    await time("getCardBrowserMeta()", () => db.getCardBrowserMeta(), (r) => `${r.total} 行（第 2、3 次命中缓存）`);
    console.log(`主进程 RSS：${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);

    // C-18 之后：确认快速路径命中 idx_cards_due（db.js 未导出 TODAY_QUEUE_DUE_SQL 时自动跳过）
    if (db.TODAY_QUEUE_DUE_SQL) {
      const ro = new Database(dbFile, { readonly: true });
      const plan = ro.prepare("EXPLAIN QUERY PLAN " + db.TODAY_QUEUE_DUE_SQL).all(now).map((r) => r.detail).join(" | ");
      ro.close();
      console.log(`快速路径查询计划：${plan}`);
      console.log(plan.includes("idx_cards_due") ? "索引命中：是" : "索引命中：否（C-18a 未生效）");
    }

    // C-39 之后（可选）：BENCH_ANKI=1 时测导出耗时
    if (process.env.BENCH_ANKI === "1") {
      const anki = require("../electron/ankiExport.js");
      const outRoot = path.join(tmp, "anki-out");
      fs.mkdirSync(outRoot);
      t0 = process.hrtime.bigint();
      const r = await anki.writeExport({ cards: db.listAllCards(), userData: tmp, outRoot });
      console.log(`Anki 导出：${msSince(t0).toFixed(0)} ms，结果 ${JSON.stringify(r)}`);
    }
  } catch (e) {
    console.error("基准失败：", e);
    process.exitCode = 1;
  } finally {
    try { if (db) db.closeDb(); } catch { /* 忽略 */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    app.exit(process.exitCode || 0);
  }
});
