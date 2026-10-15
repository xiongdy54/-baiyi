// 皮肤引擎 v2 · 基线截图播种（一次性进程）：1 本粘贴书（可进 reader）
const { app } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(__dirname, "..", "electron", "db.js"));
  await db.initDb();
  const body = "# 基线样本\n\n" + "这是用于皮肤基线截图的正文段落。".repeat(120);
  db.createFromPaste("基线样本", body);
  db.persistDb();
  console.log("SEEDED");
  app.quit();
});
