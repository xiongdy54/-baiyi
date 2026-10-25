// D223 《使用教程》初始材料播种回归（幂等 / 可删除不复活 / 重启不重播 / lang 与内容完整）。
// @runtime: electron  @tier: 2  @gui: false  @id: TUTORIALSEED  @timeout: 180
// 运行：npx electron tests/tutorial-seed.test.cjs（须先关应用）
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tutorseed-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));

    console.log("== A 首启播种 ==");
    await db.initDb();
    const seeded1 = db.seedTutorialIfMissing();
    check("A0 首次播种返回 true", seeded1 === true, seeded1);
    const items = db.listItems();
    const tut = items.find((it) => it.title === "使用教程");
    check("A1 书架出现《使用教程》", !!tut, items.map((i) => i.title).join(","));
    check("A2 lang=zh / sourceType=paste", tut && tut.lang === "zh" && tut.sourceType === "paste", JSON.stringify(tut && { lang: tut.lang, sourceType: tut.sourceType }));
    const doc = db.getDocument(tut ? tut.id : "");
    const md = String((doc && doc.markdown) || "");
    // 「画图三步」演示用的四反引号块里有一个**字面** ```mermaid 行——剥掉后再数真围栏
    const fenceCount = (md.replace(/````[\s\S]*?````/g, "").match(/```mermaid/g) || []).length;
    check("A3 内容含 33 图型围栏与标题", fenceCount === 33 && md.includes("# 使用教程"), `mermaid 围栏 ${fenceCount} 个，长度 ${md.length}`);

    console.log("== B 幂等 ==");
    const seeded2 = db.seedTutorialIfMissing();
    check("B0 二次调用返回 false", seeded2 === false, seeded2);
    check("B1 不重复建书", db.listItems().filter((it) => it.title === "使用教程").length === 1, db.listItems().filter((it) => it.title === "使用教程").length);

    console.log("== C 删除后不复活 ==");
    db.deleteItem(tut.id);
    check("C0 删除成功", !db.listItems().some((it) => it.title === "使用教程"), db.listItems().map((i) => i.title).join(","));
    const seeded3 = db.seedTutorialIfMissing();
    check("C1 删除后播种不复活（标记不随书删）", seeded3 === false, seeded3);
    check("C2 书架仍无《使用教程》", !db.listItems().some((it) => it.title === "使用教程"), "");

    console.log("== D 重启模拟（同库重开不重播）==");
    db.closeDb();
    await db.initDb();
    const seeded4 = db.seedTutorialIfMissing();
    check("D0 重启后播种仍 false（标记已持久化）", seeded4 === false, seeded4);
    check("D1 书架仍无《使用教程》", !db.listItems().some((it) => it.title === "使用教程"), "");

    console.log("== E 独立新库照常播种 ==");
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "tutorseed-test2-"));
    try {
      await db.initDb({ dataDir: tmp2 });
      check("E0 另一新库播种 true", db.seedTutorialIfMissing() === true, "");
      check("E1 新库书架有《使用教程》", db.listItems().some((it) => it.title === "使用教程"), "");
    } finally {
      try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch { /* 临时目录 */ }
    }

    console.log(`\n${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error("运行异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
    app.exit(fail ? 1 : 0);
  }
});
