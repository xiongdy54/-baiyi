// D104 GUI 播种（一次性进程）：一张当日到期卡，带助记/例子/来源三字段，供卡面信息密度开关断言
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const r = db.createCard({
    noteText: "FSRSTEST D104 三字段卡",
    cardType: "qa",
    frontMarkdown: "FSRSTEST D104：这张卡考什么？",
    backMarkdown: "考卡面信息密度",
    mnemonic: "联想：密度开关拨一拨",
    example: "例句：把不需要的字段关掉。",
    sourceRef: { title: "D104 夹具书", page: 3 },
    priority: 50,
    tags: [],
    fsrsJson: JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] })
  });
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
