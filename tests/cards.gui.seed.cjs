// cards.gui 播种（一次性进程）：一张 **context_ref_json=NULL** 的老摘录卡（D80 缺陷①的最小复现数据）
// ——早期版本摘录没有 contextRef，队列头部至今都是这种卡；用户在它上面「摘录」曾静默不落库。
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("卡片页夹具书", "正文内容：这一段用于验证卡片页。");
  const r = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "老卡甲样本 是本次要选的第一段。\n\n老卡乙样本 是本次要选的第二段。\n\n老卡丙样本 是本次要选的第三段。",
    contextRef: { documentId: book.documentId, anchorText: "老卡甲样本" }
  });
  // 老数据形态：contextRef 整体为 NULL（document_id 列仍有效）+ 强制当日到期
  db.execRawSql("UPDATE extracts SET context_ref_json = NULL, topic_next_at = ? WHERE id = ?", [Date.now() - 60000, r.id]);
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
