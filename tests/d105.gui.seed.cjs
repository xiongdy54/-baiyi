// D105 GUI 播种（一次性进程）：两张到期卡（一带标签一裸）+ 一个 KP（卡片持 KP id），供条件构建器与会话过滤断言
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const fsrsPast = JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const kp = db.createKnowledgePoint({ canonicalLabel: "D105 测试知识点" });
  const tagged = db.createCard({
    noteText: "FSRSTEST D105 标签卡", cardType: "qa", frontMarkdown: "FSRSTEST D105：标签卡题面？",
    backMarkdown: "带考研标签", priority: 50, tags: ["考研::英语"], fsrsJson: fsrsPast, knowledgePointId: kp.id
  }).id;
  const plain = db.createCard({
    noteText: "FSRSTEST D105 无标签卡", cardType: "qa", frontMarkdown: "FSRSTEST D105：无标签卡题面？",
    backMarkdown: "裸卡", priority: 50, tags: [], fsrsJson: fsrsPast
  }).id;
  db.persistDb();
  console.log("SEEDED", JSON.stringify({ tagged, plain, kp: kp.id }));
  app.quit();
});
