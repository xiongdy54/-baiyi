// D226–D228 GUI 播种（一次性进程）：三条已到期摘录（同书、默认优先级 50），topic_next_at 递增保证确定序
const { app } = require("electron");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("D226 钉卡测试书", "正文：甲段。乙段。丙段。");
  const ids = [];
  for (const [i, t] of ["摘录甲：第一条", "摘录乙：第二条", "摘录丙：第三条"].entries()) {
    const r = db.createExtract({
      parentType: "document",
      parentId: book.documentId,
      documentId: book.documentId,
      contentMarkdown: t,
      contextRef: { documentId: book.documentId, anchorText: t }
    });
    db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [Date.now() - 600000 + i * 1000, r.id]);
    ids.push(r.id);
  }
  db.persistDb();
  console.log("SEEDED " + JSON.stringify(ids));
  app.quit();
});
