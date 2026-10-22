// D111 GUI 量测种子（一次性进程）：1 书 + 600 卡（含标签/同源对/唯一词卡）
// 批量行走 execRawSql 多行 VALUES 拼接（500 行/批，内容为本脚本受控字面量，无注入面）。
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");
const COUNT = 600;

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("D111GUI 量测书", "正文内容：用于主进程过滤分页取数量测。");
  const now = Date.now();
  const BATCH = 500;
  for (let start = 0; start < COUNT; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, COUNT); i++) {
      const fsrs = JSON.stringify({ state: "new", due: now - 1000, lapses: 0 }).replace(/'/g, "''");
      const tags = i % 50 === 0 ? '["d111gui::标签组"]' : "[]";
      rows.push(
        `('d111gui-card-${i}', 'local-user', 'D111GUI 第 ${i} 张', 'qa', '[]', 0, 'D111GUI 题面 ${i}', '答 ${i}', '{"documentId":"${book.documentId}"}', ${30 + (i % 60)}, '${tags}', '[]', '${fsrs}', 'manual', ${now - i * 1000}, ${now - i * 1000}, 0, 0)`
      );
    }
    db.execRawSql(
      `INSERT INTO cards (id, user_id, note_text, card_type, cloze_ords, card_ord, front_markdown, back_markdown,
        context_ref_json, priority, tags_json, domain, fsrs_json, generated_by, created_at, updated_at, sync_version, is_deleted)
       VALUES ${rows.join(",")}`
    );
  }
  // 唯一词卡（主进程查询端到端用）+ 同源对（卡详情同源组区用）。
  // 三张的 due 落在过去：与批量卡的 due 同桶（到期升序稳定序），保证排序尾部＝批量卡最深一张「题面 599」。
  const PAST = 946684800000;
  db.createCard({ frontMarkdown: "D111GUI 唯一针脚 布 Johann", backMarkdown: "答", contextRef: { documentId: book.documentId }, fsrsJson: JSON.stringify({ state: "new", due: PAST, lapses: 0 }) });
  const sib1 = db.createCard({ frontMarkdown: "D111GUI 同源甲", backMarkdown: "答", contextRef: { documentId: book.documentId }, siblingKey: "d111gui-sib", fsrsJson: JSON.stringify({ state: "new", due: PAST, lapses: 0 }) });
  db.createCard({ frontMarkdown: "D111GUI 同源乙", backMarkdown: "答", contextRef: { documentId: book.documentId }, siblingKey: "d111gui-sib", fsrsJson: JSON.stringify({ state: "new", due: PAST, lapses: 0 }) });
  db.persistDb();
  console.log(`SEEDED ${JSON.stringify({ count: COUNT, bookId: book.itemId || book.libraryItemId || null, sib1: sib1.id })}`);
  app.quit();
});
