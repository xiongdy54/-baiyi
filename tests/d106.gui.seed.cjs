// D106 GUI 播种（一次性进程）：两张卡——甲带「脑科学」「脑科学::记忆」标签，乙无标签，供建议面板断言
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const fsrsPast = JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const a = db.createCard({
    noteText: "FSRSTEST D106 甲卡", cardType: "qa", frontMarkdown: "FSRSTEST D106：甲卡题面？",
    backMarkdown: "甲答", priority: 50, tags: ["脑科学", "脑科学::记忆"], fsrsJson: fsrsPast
  }).id;
  db.createCard({
    noteText: "FSRSTEST D106 乙卡", cardType: "qa", frontMarkdown: "FSRSTEST D106：乙卡题面？",
    backMarkdown: "乙答", priority: 50, tags: ["脑海"], fsrsJson: fsrsPast
  });
  db.persistDb();
  console.log("SEEDED", a);
  app.quit();
});
