// M16 摘录复习页 GUI 播种（一次性进程；先建库并造一条**已到期**摘录，再启动真实应用）
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste("GUI 摘录测试书", "正文内容：这一段用于验证摘录复习页。");
  const r = db.createExtract({
    parentType: "document",
    parentId: book.documentId,
    documentId: book.documentId,
    contentMarkdown: "GUI 摘录样本：这一段的含义值得单独回忆。",
    contextRef: { documentId: book.documentId, anchorText: "GUI 摘录样本" }
  });
  // 强制到期（生产路径新摘录是次日进队；本测试要当日可见）
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [Date.now() - 60000, r.id]);

  // 批 4 Task 15：另建一本**三章**书 + 一份已发布导图，专供「图谱页签」验证。
  // 为什么另建：原始那本只有一章（单 spine 单元），验不出「嵌套 / 同级不重叠 / 缩进随层级」；
  // 且原始那本**故意不带导图**，用来验「无导图 ⇒ 不显示该页签」。
  // **按需**：只有 M7_TEST_WITH_MAP=1 时才建（extract.gui 假定库里只有一本书，
  // 多一本会打乱它的「本书」断言——实测 76/76 → 71/76）。图谱验收自己开这个开关。
  const treeBook = process.env.M7_TEST_WITH_MAP === "1" ? db.createFromPaste(
    "GUI 图谱测试书",
    "# 第一章\n\n第一章正文：图谱目录的嵌套与不重叠，要用多章书才验得出来。\n\n# 第二章\n\n第二章正文。\n\n# 第三章\n\n第三章正文。"
  ) : null;
  try {
    // 节点锚＝内核 TOC 的 href（合成书为 c0.xhtml / c1.xhtml …；带 OEBPS/ 前缀，实测为准）
    if (treeBook) db.saveMaterialMap({
      documentId: treeBook.documentId,
      scopeAnchor: "book",
      scopeKind: "book",
      granularity: "standard",
      title: "T15 图谱样本",
      structure: {
        nodes: [
          // v48.44（D84）：补**根节点**与 childIds——此前只播叶子壳（没有 id=root 的节点），
          // layoutMap 找不到根 ⇒ 画布恒为空 SVG（旧全屏工作区同样空白，只是此前无人断言画布内容）。
          { id: "root", parentId: null, title: "T15 材料根", childIds: ["n1", "n3"] },
          { id: "n1", parentId: "root", title: "第一章", anchor: "OEBPS/c0.xhtml", childIds: ["n2"] },
          { id: "n2", parentId: "n1", title: "1.1 小节", anchor: "OEBPS/c1.xhtml", childIds: [] },
          { id: "n3", parentId: "root", title: "第二章", anchor: "OEBPS/c2.xhtml", childIds: [] }
        ],
        edges: []
      },
      promptVersion: 1,
      provider: "zai",
      model: "glm-test",
      modelConfigHash: "cfg-seed",
      isActive: true
    });
  } catch (e) {
    console.log("MAP_SEED_SKIPPED", e && e.message);
  }
  db.persistDb();
  console.log("SEEDED", r.id);
  app.quit();
});
