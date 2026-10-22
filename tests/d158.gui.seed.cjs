// D158 GUI 播种（一次性进程）：三本书 A/B/C + 五张卡（标签/知识点组合）+ KP X 归并入 Y + 两条摘录
// 供 d158.gui.mjs G1–G7 表格等式回归（OPUS 方案 v2 §8.5）
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const fsrsPast = JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const bookA = db.createFromPaste("D158 书A", "书A 正文：用于方案表格等式量测。");
  const bookB = db.createFromPaste("D158 书B", "书B 正文。");
  const bookC = db.createFromPaste("D158 书C", "书C 正文。");
  const kpX = db.createKnowledgePoint({ canonicalLabel: "D158 知识点X" });
  const kpY = db.createKnowledgePoint({ canonicalLabel: "D158 知识点Y" });
  db.mergeKnowledgePoints(String(kpX.id), String(kpY.id)); // X 并入 Y：族 = {Y, X}
  const mk = (front, book, tags, kpId) => db.createCard({
    noteText: front, cardType: "qa", frontMarkdown: front, backMarkdown: "答",
    priority: 50, tags, fsrsJson: fsrsPast, contextRef: { documentId: book.documentId },
    ...(kpId ? { knowledgePointId: kpId } : {})
  }).id;
  const a1 = mk("D158 A1 词汇卡", bookA, ["英语::词汇"], null);
  const a2 = mk("D158 A2 英语学卡", bookA, ["英语学"], null);
  const b1 = mk("D158 B1 英语卡", bookB, ["英语"], null);
  const b2 = mk("D158 B2 持KP卡", bookB, [], kpX.id);
  const c1 = mk("D158 C1 英语卡", bookC, ["英语"], null);
  const ea = db.createExtract({ parentType: "document", parentId: bookA.documentId, documentId: bookA.documentId, contentMarkdown: "D158 摘录EA（书A）", tags: ["英语"], priority: 50 });
  const ec = db.createExtract({ parentType: "document", parentId: bookC.documentId, documentId: bookC.documentId, contentMarkdown: "D158 摘录EC（书C）", tags: ["英语"], priority: 50 });
  db.persistDb();
  console.log("SEEDED", JSON.stringify({
    bookA: bookA.itemId || bookA.libraryItemId || null,
    bookB: bookB.itemId || bookB.libraryItemId || null,
    bookC: bookC.itemId || bookC.libraryItemId || null,
    a1, a2, b1, b2, c1, kpX: kpX.id, kpY: kpY.id, ea, ec
  }));
  app.quit();
});
