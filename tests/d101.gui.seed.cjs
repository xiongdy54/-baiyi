// D101/D102 GUI 播种（一次性进程）：一张当日到期的卡，带旧标签，供标签/归档 UI 驱动
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const r = db.createCard({
    noteText: "FSRSTEST D101 复习打标卡",
    cardType: "qa",
    frontMarkdown: "FSRSTEST: 这是标签与归档 GUI 驱动卡？",
    backMarkdown: "是的",
    priority: 50,
    tags: ["旧标签"],
    fsrsJson: JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] })
  });
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
