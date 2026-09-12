// M1 端到端数据层验证（v15）— 与 tests/fsrs/db.test.cjs 同构：真实 electron/db.js + FSRSTEST 前缀 + 结束清理
// 运行：npx electron tests/m1.e2e.cjs（须先关闭应用，§7.1.8）
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  console.log(`  userData = ${app.getPath("userData")}`);
  const db = require(path.join(__dirname, "..", "electron", "db.js"));
  await db.initDb();

  console.log("== M1-E1 提示词播种（card-occlusion 新分支 + 首装模板修复） ==");
  const occ = db.getPromptTemplate("card-occlusion");
  check("card-occlusion v1 已播种", Boolean(occ) && occ.version === 1, "v1", occ && occ.version);
  check("card-occlusion 内容含区域百分比约定", occ && occ.content.includes("百分比"), "含『百分比』", occ && occ.content.slice(0, 0));
  const explain = db.getPromptTemplate("reader-explain");
  check("reader-explain 存在（按 scope 播种修复后）", Boolean(explain), "存在", explain && explain.scope);
  const leechTpl = db.getPromptTemplate("leech-rescue");
  check("leech-rescue 存在", Boolean(leechTpl), "存在", leechTpl && leechTpl.scope);

  console.log("== M1-E2 翻转问答=两张独立问答卡（v16 D18：无 reverse 卡类型） ==");
  const { id: itemId } = db.createFromPaste("FSRSTEST M1 载体书", "# 测试\nM1 端到端验证用书");
  // 模拟手动制卡「翻转问答」页签的行为：两张互为翻转的独立 qa 卡
  const { id: cardA } = db.createCard({
    noteText: "FSRSTEST 正向题面",
    cardType: "qa",
    frontMarkdown: "FSRSTEST 正向题面",
    backMarkdown: "正向答案",
    priority: 50,
    tags: []
  });
  const { id: cardB } = db.createCard({
    noteText: "FSRSTEST 反向题面",
    cardType: "qa",
    frontMarkdown: "FSRSTEST 反向题面",
    backMarkdown: "正向题面改写",
    priority: 50,
    tags: []
  });
  check("两张卡均为独立 qa 类型", db.getCard(cardA).cardType === "qa" && db.getCard(cardB).cardType === "qa", "qa/qa", [db.getCard(cardA).cardType, db.getCard(cardB).cardType]);
  check("两卡各自有独立 FSRS 状态", Boolean(db.getCard(cardA).fsrs?.due) && Boolean(db.getCard(cardB).fsrs?.due), "独立 due", [db.getCard(cardA).fsrs?.due, db.getCard(cardB).fsrs?.due]);
  const okUpdate = db.updateCard({ id: cardA, cardType: "qa", noteText: "FSRSTEST 正向题面改", frontMarkdown: "FSRSTEST 正向题面改", backMarkdown: "正向答案改", priority: 50, tags: [] });
  check("编辑 A 卡不影响 B 卡", okUpdate && db.getCard(cardB).frontMarkdown === "FSRSTEST 反向题面", "B 卡不变", db.getCard(cardB).frontMarkdown);

  console.log("== M1-E3 图片挖空卡（资产入库 + occlusionJson） ==");
  // 1x1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  let asset = null;
  try {
    asset = db.createAssetForItem(itemId, "image-occlusion", "png", png);
  } catch (err) {
    check("createAssetForItem 不抛错", false, "ok", err.message);
  }
  check("返回 bookasset URL", Boolean(asset && /^bookasset:\/\/[0-9a-f-]+\/occl-.+\.png$/.test(asset.assetPath)), "bookasset://<itemId>/occl-*.png", asset && asset.assetPath);
  const assetFile = path.join(app.getPath("userData"), "assets", asset.itemId, asset.filename);
  check("图片文件已落盘", fs.existsSync(assetFile), assetFile, fs.existsSync(assetFile));
  const { id: occCardId } = db.createCard({
    noteText: "FSRSTEST 遮挡卡",
    cardType: "imageOcclusion",
    frontMarkdown: "图中遮挡区域对应的是什么？",
    backMarkdown: "FSRSTEST 区域答案",
    cardOrd: 0,
    occlusionJson: { rects: [{ x: 10, y: 10, w: 30, h: 20, ord: 0 }], assetPath: asset.assetPath },
    priority: 50,
    tags: []
  });
  const occCard = db.getCard(occCardId);
  check("occlusionJson 往返", occCard.occlusionJson && occCard.occlusionJson.rects.length === 1 && occCard.occlusionJson.assetPath === asset.assetPath, "rects+assetPath", occCard.occlusionJson);
  check("cardOrd 落库", occCard.cardOrd === 0, 0, occCard.cardOrd);

  console.log("== M1-E4 到期队列包含新形式卡片 ==");
  const due = db.listDueCards().filter((c) => c.noteText.startsWith("FSRSTEST"));
  check("翻转问答的两张 qa 卡与 imageOcclusion 均入到期队列", due.some((c) => c.noteText.includes("正向题面")) && due.some((c) => c.noteText.includes("反向题面")) && due.some((c) => c.cardType === "imageOcclusion"), "三种都在", due.map((c) => c.cardType + ":" + c.noteText.slice(0, 12)));

  console.log("== 清理 FSRSTEST 数据 ==");
  db.deleteCard(cardA);
  db.deleteCard(cardB);
  db.deleteCard(occCardId);
  db.deleteItem(itemId);
  const remain = db.listAllCards().filter((c) => c.noteText.startsWith("FSRSTEST"));
  check("测试卡已清理", remain.length === 0, 0, remain.length);

  console.log(`\nM1 E2E 完成：${pass} 通过 / ${fail} 失败`);
  app.exit(fail > 0 ? 1 : 0);
});
