// D240 GUI 播种（一次性进程）：三张新卡 + 一条到期摘录，到期时刻交错（摘录 < 卡一 < 卡二 < 卡三）——
// 分开处理（默认）下复习页只推闪卡（卡一 → 卡二 → 卡三）；混合复习 + by-due 混编下队首＝摘录
const { app } = require("electron");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const now = Date.now();
  const fsrs = (due) => JSON.stringify({ state: "new", due, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const ids = {};
  [["c1", "卡一", 300000], ["c2", "卡二", 200000], ["c3", "卡三", 100000]].forEach(([k, name, ago]) => {
    ids[k] = db.createCard({ noteText: `D240 ${name}`, cardType: "qa", frontMarkdown: `D240 ${name}：题面？`, backMarkdown: `${name}答案`, priority: 50, fsrsJson: fsrs(now - ago) }).id;
  });
  const book = db.createFromPaste("D240 复习入场方向测试书", "正文：一段用于摘录的文字。");
  const x = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "D240 摘录：一段用于混合复习入场的文字",
    contextRef: { documentId: book.documentId, anchorText: "一段用于摘录的文字" }
  });
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [now - 400000, x.id]);
  ids.x = x.id;
  db.persistDb();
  console.log("SEEDED " + JSON.stringify(ids));
  app.quit();
});
