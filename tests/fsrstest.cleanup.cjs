// FSRSTEST 测试数据一次性清理（reader.engine.mjs 异常路径泄漏的存量回收，D85 第 1 项）。
// @runtime: electron  @tier: 2  @gui: false  @id: FSRSTEST-CLEANUP  @timeout: 60
// 运行前提：**真实应用已关闭**（sql.js 全量落盘，双进程互吞）；`npx electron tests/fsrstest.cleanup.cjs`
// 可用 FSRSTEST_USERDATA 指到别处做演练（缺省＝真实 userData，即 reader.engine 驱动的那个库）。
// 清理口径与该套件第 8 步一致：FSRSTEST 卡先删（cards:delete 同口径）→ `library:delete`（deleteItem
// 级联软删 item/documents/assets）；另扫一遍 FSRSTEST 摘录兜底（该套件本不造摘录，防旧泄漏）。
const { app } = require("electron");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  // 一次性脚本（electron tests/xx.cjs）的应用名不是 package.json 的 name ⇒ userData 默认落到
  // Roaming/Electron（实测踩过：跑完报 0 条）——必须显式指到真实应用的数据目录。
  app.setPath("userData", process.env.FSRSTEST_USERDATA
    ? path.resolve(process.env.FSRSTEST_USERDATA)
    : path.join(app.getPath("appData"), "incremental-reading-dev"));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();

  const removed = { cards: 0, extracts: 0, items: 0 };

  // 1) 卡：正文/背面/笔记含 FSRSTEST 的都算测试卡
  const listAllCards = db.listAllCards || db.listCards;
  const cards = (typeof listAllCards === "function" ? listAllCards.call(db) : []) || [];
  for (const c of cards) {
    const blob = `${c.frontMarkdown || ""}${c.backMarkdown || ""}${c.noteText || ""}`;
    if (blob.includes("FSRSTEST")) {
      if (db.deleteCard(String(c.id))) removed.cards++;
    }
  }

  // 2) 摘录：contentMarkdown 含 FSRSTEST 的兜底软删
  const extracts = (db.listAllExtracts?.() || []).filter((e) => !e.isDeleted);
  for (const e of extracts) {
    if (String(e.contentMarkdown || "").includes("FSRSTEST")) {
      if (db.deleteExtract(String(e.id))) removed.extracts++;
    }
  }

  // 3) 书目：标题以 FSRSTEST 开头的（引擎验证书 / 粘贴引擎验证书 …）
  const items = (db.listItems?.() || []).filter((it) => !it.isDeleted && String(it.title || "").startsWith("FSRSTEST"));
  for (const it of items) {
    if (db.deleteItem(String(it.id))) removed.items++;
    console.log(`  · 删书：${it.title} (${it.id})`);
  }

  db.persistDb();
  console.log(`FSRSTEST 清理完成：卡 ${removed.cards} · 摘录 ${removed.extracts} · 书目 ${removed.items}`);
  app.quit();
}).catch((e) => {
  console.error("CLEANUP FAILED:", e && (e.stack || e.message));
  app.quit(1);
});
