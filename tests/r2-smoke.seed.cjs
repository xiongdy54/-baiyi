// R2 收尾审计 GUI 播种（一次性进程；仿 d106/extract seed 惯例）：
// 1 本书（书架非空，供 S3 stagger / S2 reader 进出）+ 1 条已到期摘录（供 S4 摘录两态）
// + 4 张已到期卡（供 S2.5 复习评分产生 review_logs → S5 数据页图表有数据）。
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("R2 冒烟书", "正文内容：这一段用于验证 R2 收尾冒烟。");
  const r = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "R2 冒烟摘录样本：这一段的含义值得单独回忆。",
    contextRef: { documentId: book.documentId, anchorText: "R2 冒烟摘录样本" }
  });
  // 强制到期（同 extract.gui.seed 惯例：生产路径新摘录次日进队，冒烟要当日可见）
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [Date.now() - 60000, r.id]);
  const fsrsPast = JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  // 8 本书：书架 stagger 断言需要 ≥2 张卡看出 30ms/张 分档（§10-R2 ×≤8 档）
  for (let i = 1; i <= 8; i++) {
    db.createFromPaste(`R2 冒烟书 ${i}`, `正文内容：第 ${i} 本，用于 R2 收尾冒烟。`);
  }
  for (let i = 1; i <= 4; i++) {
    db.createCard({
      noteText: `R2 冒烟卡 ${i}`, cardType: "qa", frontMarkdown: `R2 冒烟：第 ${i} 张题面？`,
      backMarkdown: `答 ${i}`, priority: 50, tags: [], fsrsJson: fsrsPast,
      contextRef: { documentId: book.documentId }
    });
  }
  db.persistDb();
  console.log("SEEDED", JSON.stringify({ book: book.documentId, extract: r.id }));
  app.quit();
});
