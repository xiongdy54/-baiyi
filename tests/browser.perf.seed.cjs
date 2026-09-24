// 浏览器性能量测的种子（一次性进程）：批量造 3000 卡 + 500 摘录
// 批量行走 execRawSql（createCard 每次 persist 整库导出，3000 次会拖到分钟级）
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

const CARDS = Number(process.env.PERF_CARDS || 3000);
const EXTRACTS = Number(process.env.PERF_EXTRACTS || 500);

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("性能量测书", "正文内容：用于浏览器性能量测。");
  const now = Date.now();
  for (let i = 0; i < CARDS; i++) {
    const fsrs = JSON.stringify({ state: "new", due: now - 1000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
    db.execRawSql(
      `INSERT INTO cards (id, user_id, note_text, card_type, cloze_ords, card_ord, front_markdown, back_markdown,
        context_ref_json, priority, tags_json, domain, fsrs_json, generated_by, created_at, updated_at, sync_version, is_deleted)
       VALUES (?, 'local-user', ?, 'qa', '[]', 0, ?, ?, ?, ?, '[]', '[]', ?, 'manual', ?, ?, 0, 0)`,
      [`perf-card-${i}`, `PERFCARD 第 ${i} 张`, `PERFCARD 题面 ${i}`, `答 ${i}`,
       JSON.stringify({ documentId: book.documentId }), 30 + (i % 60), fsrs, now - i * 1000, now - i * 1000]
    );
  }
  for (let i = 0; i < EXTRACTS; i++) {
    db.execRawSql(
      `INSERT INTO extracts (id, user_id, parent_type, parent_id, document_id, content_markdown, context_ref_json,
        priority, priority_source, topic_next_at, interval_days, a_factor, created_at, updated_at, sync_version, is_deleted)
       VALUES (?, 'local-user', 'document', ?, ?, ?, ?, ?, 'book', ?, 1, 1.6, ?, ?, 0, 0)`,
      [`perf-extract-${i}`, book.documentId, book.documentId, `PERF 摘录 ${i}：用于量测正文长度与渲染开销。`,
       JSON.stringify({ documentId: book.documentId, anchorText: `PERF 摘录 ${i}` }), 30 + (i % 60), now - 1000, now, now]
    );
  }
  db.persistDb();
  console.log(`SEEDED cards=${CARDS} extracts=${EXTRACTS}`);
  app.quit();
});
