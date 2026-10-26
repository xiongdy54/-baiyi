// D103 批C 生成信息区 db 层回归（electron 直跑：npx electron tests/d103-geninfo.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §3.2 + GUIDE §6.8-6 行详情（D103）
// 覆盖：getCardGenInfo join（批次/模型快照/提示词版本/当时 card_issues）/ 缺卡 null / 手动卡批次为 null /
//       存量批次（context_json 无 model）如实返回 null / 只读（快照差分零写入）
"use strict";
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const ROOT = require("path").resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d103-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    const mkCard = (note, extra = {}) =>
      db.createCard({
        noteText: note, cardType: "qa", frontMarkdown: note + "？", backMarkdown: "答案",
        priority: 50, tags: [], fsrsJson: JSON.stringify({ state: "new", due: Date.now(), lapses: 0 }), ...extra
      }).id;

    console.log("== D103-G1 join 完整面（AI 卡 + 批次 + 模板 + issues） ==");
    const tpl = db.listPromptTemplates().find((t) => t.scope === "card-generation");
    check("播种模板存在（card-generation）", !!tpl, true, !!tpl);
    const batchId = db.createAIGenBatch({
      scope: "card-generation",
      sourceText: "D103 源文本",
      context: { title: "D103 书", model: "glm-test-model", webContextChars: 0 },
      promptTemplateId: tpl ? tpl.id : null,
      result: { cards: [] }
    }).id;
    const aiCard = mkCard("FSRSTEST D103 AI 卡", { generatedBy: "ai", genBatchId: batchId, contextRef: { documentId: "doc-x", extractId: "ext-x" } });
    db.addCardIssue({ cardId: aiCard, ruleId: "L17", severity: "info", message: "D103 标签超限提示", source: "lint" });
    db.addCardIssue({ cardId: aiCard, ruleId: "S1", severity: "warn", message: "D103 相似检索提示", source: "lint" });

    const info = db.getCardGenInfo(aiCard);
    check("返回非空且卡 id 对上", !!info && info.card.id === aiCard, aiCard, info && info.card.id);
    check("批次 id 对上", info.batch && info.batch.id === batchId, batchId, info.batch && info.batch.id);
    check("批次 scope 复用原值", info.batch && info.batch.scope === "card-generation", "card-generation", info.batch && info.batch.scope);
    check("模型快照读出 context_json.model", info.batch && info.batch.model === "glm-test-model", "glm-test-model", info.batch && info.batch.model);
    check("提示词模板 join 出 scope/名称/版本", info.template && info.template.scope === "card-generation" && info.template.version >= 1 && typeof info.template.name === "string", "card-generation/vN", info.template);
    check("card_issues 全量返回（含 open 两条）", Array.isArray(info.issues) && info.issues.length === 2, 2, info.issues.length);
    check("isDefault 布尔化", info.template && typeof info.template.isDefault === "boolean", "boolean", info.template && typeof info.template.isDefault);

    console.log("== D103-G2 空态与缺省 ==");
    const manualCard = mkCard("FSRSTEST D103 手动卡", { generatedBy: "manual" });
    const mi = db.getCardGenInfo(manualCard);
    check("手动卡：card 在、batch=null、template=null", mi && mi.card.id === manualCard && mi.batch === null && mi.template === null, "batch=null", mi && mi.batch);
    check("手动卡 issues 空数组", Array.isArray(mi.issues) && mi.issues.length === 0, 0, mi.issues.length);
    const ghost = db.getCardGenInfo("00000000-0000-0000-0000-00000000dead");
    check("幽灵 id → null（可判失败，不假成功）", ghost === null, null, ghost);
    const noBatch = db.getCardGenInfo(mkCard("FSRSTEST D103 无批次 AI 卡", { generatedBy: "ai" }));
    check("AI 卡无 genBatchId → batch=null 不抛", noBatch && noBatch.batch === null, null, noBatch && noBatch.batch);
    // 存量批次：context_json 无 model（v48.61 前的实况）→ model 如实 null
    const oldBatchId = db.createAIGenBatch({ scope: "card-generation", sourceText: "旧", context: { title: "旧" }, promptTemplateId: tpl ? tpl.id : null, result: { cards: [] } }).id;
    const oldCard = db.getCardGenInfo(mkCard("FSRSTEST D103 存量批次卡", { generatedBy: "ai", genBatchId: oldBatchId }));
    check("存量批次 model=null（如实显示「—」，不猜）", oldCard && oldCard.batch && oldCard.batch.model === null, null, oldCard && oldCard.batch && oldCard.batch.model);

    console.log("== D103-G3 只读（快照差分零写入） ==");
    // 持久化文件级快照差分：genInfo 前后字节一致（A-10 只读出口纪律）
    db.persistDb();
    const libPath = path.join(tmp, "library.db");
    const before = fs.readFileSync(libPath);
    db.getCardGenInfo(aiCard);
    db.persistDb();
    const after = fs.readFileSync(libPath);
    check("genInfo 前后库文件字节一致（零写路径）", before.equals(after), true, `${before.length}B vs ${after.length}B`);

    console.log(`\nD103-geninfo: ${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    // D239：异常也要算失败（原先异常冒出 + app.quit() → 退出码 0，崩溃被当成通过）
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败不阻塞 */ }
    app.exit(fail ? 1 : 0); // D239：app.quit() 恒以 0 退出，失败须经 app.exit(code) 上报
  }
});
