// D103 GUI 播种（一次性进程）：书 + 两级摘录树 + AI 卡（带批次/同源键）+ 同源手动卡 + 无锚手动卡
// 供卡详情「生成信息区 / 血缘树 / 同源组 / 重新生成入口」的 GUI 断言驱动
const { app } = require("electron");
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();

  const book = db.createFromPaste("D103 血缘夹具书", "正文内容：用于血缘树驱动的夹具书。");
  const root = db.createExtract({
    parentType: "document", parentId: book.documentId, documentId: book.documentId,
    contentMarkdown: "根摘录：光合作用的第一行\n不应出现的第二行",
    contextRef: { documentId: book.documentId, anchorText: "根摘录：光合作用的第一行" }
  });
  const child = db.createExtract({
    parentType: "extract", parentId: root.id, documentId: book.documentId,
    contentMarkdown: "子摘录：光反应发生在类囊体",
    contextRef: { documentId: book.documentId, parentExtractId: root.id, anchorText: "子摘录：光反应发生在类囊体", anchorRatio: 0.5 }
  });
  const tpl = db.listPromptTemplates().find((t) => t.scope === "card-generation");
  const batch = db.createAIGenBatch({
    scope: "card-generation", sourceText: "子摘录：光反应发生在类囊体",
    context: { title: "D103 血缘夹具书", model: "glm-test-model" },
    promptTemplateId: tpl ? tpl.id : null, result: { cards: [] }
  });
  const SIB = "src:d103doc:" + child.id;
  const fsrsPast = JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
  const ai = db.createCard({
    noteText: "FSRSTEST D103 光反应场所", cardType: "qa", frontMarkdown: "FSRSTEST D103：光反应的场所是？",
    backMarkdown: "类囊体薄膜", priority: 50, tags: [], fsrsJson: fsrsPast,
    generatedBy: "ai", genBatchId: batch.id, siblingKey: SIB,
    contextRef: { documentId: book.documentId, extractId: child.id, anchorText: "子摘录：光反应发生在类囊体" }
  }).id;
  const sib = db.createCard({
    noteText: "FSRSTEST D103 光反应原料", cardType: "qa", frontMarkdown: "FSRSTEST D103：光反应的原料是？",
    backMarkdown: "水和 ADP", priority: 50, tags: [], fsrsJson: fsrsPast,
    generatedBy: "manual", siblingKey: SIB,
    contextRef: { documentId: book.documentId, extractId: child.id, anchorText: "子摘录：光反应发生在类囊体" }
  }).id;
  const manualNoAnchor = db.createCard({
    noteText: "FSRSTEST D103 无锚手动卡", cardType: "qa", frontMarkdown: "FSRSTEST D103：无锚卡题面？",
    backMarkdown: "无锚", priority: 50, tags: [], fsrsJson: fsrsPast, generatedBy: "manual"
  }).id;
  db.addCardIssue({ cardId: ai, ruleId: "L17", severity: "info", message: "D103 标签超限提示", source: "lint" });
  db.persistDb();
  console.log("SEEDED", JSON.stringify({ ai, sib, manualNoAnchor, root: root.id, child: child.id, batch: batch.id }));
  app.quit();
});
