// 浏览器性能量测的种子（一次性进程）：批量造 30 万卡 + 5 万摘录（D110 量测规模＝终身使用量级，
// 用户 2026-10-07 指令；环境变量 PERF_CARDS/PERF_EXTRACTS 可调小做快速冒烟）
// 批量行走 execRawSql 多行 VALUES 拼接（500 行/批）——createCard 每次 persist 整库导出，
//   逐行 execRawSql 35 万次会拖到不可接受；拼接内容全部为本脚本受控字面量（无注入面）。
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

const CARDS = Number(process.env.PERF_CARDS || 300000);
const EXTRACTS = Number(process.env.PERF_EXTRACTS || 50000);
const BATCH = 500;

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  const t0 = Date.now();
  await db.initDb();
  const book = db.createFromPaste("性能量测书", "正文内容：用于浏览器性能量测。");
  const now = Date.now();
  for (let start = 0; start < CARDS; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, CARDS); i++) {
      const fsrs = JSON.stringify({ state: "new", due: now - 1000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] }).replace(/'/g, "''");
      rows.push(
        `('perf-card-${i}', 'local-user', 'PERFCARD 第 ${i} 张', 'qa', '[]', 0, 'PERFCARD 题面 ${i}', '答 ${i}', '{"documentId":"${book.documentId}"}', ${30 + (i % 60)}, '[]', '[]', '${fsrs}', 'manual', ${now - i * 1000}, ${now - i * 1000}, 0, 0)`
      );
    }
    db.execRawSql(
      `INSERT INTO cards (id, user_id, note_text, card_type, cloze_ords, card_ord, front_markdown, back_markdown,
        context_ref_json, priority, tags_json, domain, fsrs_json, generated_by, created_at, updated_at, sync_version, is_deleted)
       VALUES ${rows.join(",")}`
    );
  }
  for (let start = 0; start < EXTRACTS; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, EXTRACTS); i++) {
      rows.push(
        `('perf-extract-${i}', 'local-user', 'document', '${book.documentId}', '${book.documentId}', 'PERF 摘录 ${i}：用于量测正文长度与渲染开销。', '{"documentId":"${book.documentId}","anchorText":"PERF 摘录 ${i}"}', ${30 + (i % 60)}, 'book', ${now - 1000}, 1, 1.6, ${now}, ${now}, 0, 0)`
      );
    }
    db.execRawSql(
      `INSERT INTO extracts (id, user_id, parent_type, parent_id, document_id, content_markdown, context_ref_json,
        priority, priority_source, topic_next_at, interval_days, a_factor, created_at, updated_at, sync_version, is_deleted)
       VALUES ${rows.join(",")}`
    );
  }
  const t1 = Date.now();
  db.persistDb();
  console.log(`SEEDED cards=${CARDS} extracts=${EXTRACTS} insert=${t1 - t0}ms persist=${Date.now() - t1}ms`);
  app.quit();
});
