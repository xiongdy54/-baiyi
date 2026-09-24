// M16 摘录复习页 GUI 播种（一次性进程；先建库并造一条**已到期**摘录，再启动真实应用）
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("GUI 摘录测试书", "正文内容：这一段用于验证摘录复习页。");
  const r = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "GUI 摘录样本：这一段的含义值得单独回忆。",
    contextRef: { documentId: book.documentId, anchorText: "GUI 摘录样本" }
  });
  // 强制到期（生产路径新摘录是次日进队；本测试要当日可见）
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [Date.now() - 60000, r.id]);
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
