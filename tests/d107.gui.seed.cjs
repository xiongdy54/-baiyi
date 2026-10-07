// D107 GUI 播种（一次性进程）：一张当日到期卡带「脑科学」标签，供标签总开关断言
const { app } = require("electron");
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const r = db.createCard({
    noteText: "FSRSTEST D107 开关驱动卡", cardType: "qa", frontMarkdown: "FSRSTEST D107：题面？",
    backMarkdown: "答案", priority: 50, tags: ["脑科学"],
    fsrsJson: JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] })
  });
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
