// D232 GUI 播种（一次性进程）：两张新卡 + 一条到期摘录，到期时刻交错（卡甲 < 摘录 < 卡乙），
// 配合 by-due 混编得到确定序：卡甲 → 摘录 → 卡乙
const { app } = require("electron");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const now = Date.now();
  const fsrs = (due) => JSON.stringify({ state: "new", due, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const a = db.createCard({ noteText: "D232 卡甲", cardType: "qa", frontMarkdown: "D232 卡甲：题面？", backMarkdown: "卡甲答案", priority: 50, fsrsJson: fsrs(now - 300000) });
  const b = db.createCard({ noteText: "D232 卡乙", cardType: "qa", frontMarkdown: "D232 卡乙：题面？", backMarkdown: "卡乙答案", priority: 50, fsrsJson: fsrs(now - 100000) });
  const book = db.createFromPaste("D232 混合复习测试书", "正文：一段用于摘录的文字。");
  const x = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "D232 摘录：一段用于混合复习的文字",
    contextRef: { documentId: book.documentId, anchorText: "一段用于摘录的文字" }
  });
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [now - 200000, x.id]);
  db.persistDb();
  console.log("SEEDED " + JSON.stringify({ a: a.id, b: b.id, x: x.id }));
  app.quit();
});
