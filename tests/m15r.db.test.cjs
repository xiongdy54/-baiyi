// v48 批1 M15 重做——数据层回归（3 表 + 仓储；electron 直跑：npx electron tests/m15r.db.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§4.19-7 + D41-⑤——map 每版本一行且 active 互斥（失败永不触碰旧图）/
// shard 逻辑键含 provider+model+modelConfigHash（换模型不复用旧结果）/ run 留痕可审计。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m15r-db-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    console.log("---- M15R-DB1 material_maps 版本化与 active 互斥 ----");
    const structure1 = { title: "v1", nodes: [{ id: "n1", parentId: null, title: "根", childIds: [], evidence: [] }], edges: [] };
    const saved1 = db.saveMaterialMap({ documentId: "doc1", structure: structure1, title: "v1", promptVersion: 1, provider: "zai", model: "glm-test", modelConfigHash: "cfg1" });
    check("保存后即为 active", saved1.isActive === true, saved1.isActive);
    check("读回结构 JSON 完整", saved1.structure?.nodes?.length === 1 && saved1.structure.nodes[0].id === "n1", saved1.structure);
    const structure2 = { title: "v2", nodes: [{ id: "n2", parentId: null, title: "新根", childIds: [], evidence: [] }], edges: [] };
    const saved2 = db.saveMaterialMap({ documentId: "doc1", structure: structure2, title: "v2", promptVersion: 1, provider: "zai", model: "glm-test", modelConfigHash: "cfg1", nodeRemap: { n1: "n2" } });
    check("新版本置 active", saved2.isActive === true, saved2.isActive);
    const reread1 = db.getMaterialMap(saved1.id, { includeStructure: false });
    check("旧版本保留且退位（不删除）", reread1 && reread1.isActive === false, reread1 && reread1.isActive);
    const active = db.getActiveMaterialMap("doc1", "book");
    check("active 查询命中最新版本", active && active.id === saved2.id, active && active.id);
    check("active 查询带 nodeRemap", eq(active.nodeRemap, { n1: "n2" }), active.nodeRemap);
    // 失败版本（isActive=false）不触碰旧 active
    const failed = db.saveMaterialMap({ documentId: "doc1", structure: { title: "v3", nodes: [], edges: [] }, title: "v3", isActive: false });
    check("非激活保存不改 active", db.getActiveMaterialMap("doc1", "book").id === saved2.id, "");
    check("非激活版本同样留痕", db.listMaterialMaps("doc1").length === 3, db.listMaterialMaps("doc1").length);
    void failed;
    db.setActiveMaterialMap(saved1.id);
    check("setActiveMaterialMap 可切回旧版", db.getActiveMaterialMap("doc1", "book").id === saved1.id, "");
    db.setActiveMaterialMap(saved2.id);
    // scope 隔离
    db.saveMaterialMap({ documentId: "doc1", scopeAnchor: "s2.xhtml", scopeKind: "chapter", structure: { title: "章图", nodes: [], edges: [] } });
    check("不同 scope 互不挤占 active", db.getActiveMaterialMap("doc1", "book").id === saved2.id && db.getActiveMaterialMap("doc1", "s2.xhtml") !== null, "");
    db.deleteMaterialMap(saved1.id);
    check("软删除后列表不可见", db.listMaterialMaps("doc1").every((m) => m.id !== saved1.id), "");

    console.log("---- M15R-DB2 material_map_shards 缓存键（含模型三元组） ----");
    const baseKey = {
      documentId: "doc1", unitAnchor: "s1.xhtml", runKind: "section", granularity: "standard",
      promptScope: "material-map-section", promptVersion: 1, textHash: "t-hash-1",
      provider: "zai", model: "glm-test", modelConfigHash: "cfg1"
    };
    db.saveMaterialMapShard({ ...baseKey, content: { role: "introduce", text: "第一次" }, chars: 100, tokenUsed: 70 });
    const hit = db.getMaterialMapShard(baseKey);
    check("同键命中", hit && hit.content?.text === "第一次", hit && hit.content);
    db.saveMaterialMapShard({ ...baseKey, content: { role: "introduce", text: "升版覆盖" } });
    check("同键 upsert 覆盖（升版即失效语义）", db.getMaterialMapShard(baseKey).content.text === "升版覆盖", "");
    check("同键分片唯一（唯一索引）", db.listMaterialMapShards("doc1", { runKind: "section" }).length === 1, "");
    check("换 model 不命中（模型三元组入键）", db.getMaterialMapShard({ ...baseKey, model: "glm-other" }) === null, "");
    check("换 modelConfigHash 不命中", db.getMaterialMapShard({ ...baseKey, modelConfigHash: "cfg2" }) === null, "");
    check("换 promptVersion 不命中", db.getMaterialMapShard({ ...baseKey, promptVersion: 2 }) === null, "");
    check("换文本 hash 不命中（原文变更局部失效）", db.getMaterialMapShard({ ...baseKey, textHash: "t-hash-2" }) === null, "");
    check("换 granularity 不命中", db.getMaterialMapShard({ ...baseKey, granularity: "detailed" }) === null, "");
    const ok2 = db.saveMaterialMapShard({ ...baseKey, model: "glm-other", content: { ok: 1 } });
    check("不同模型各自成片", ok2 && db.listMaterialMapShards("doc1", { runKind: "section" }).length === 2, "");
    check("确定性主键（sha256 of 逻辑键）", ok2.id === crypto.createHash("sha256").update([
      "doc1", "s1.xhtml", "section", "standard", "material-map-section", "1", "t-hash-1", "zai", "glm-other", "cfg1"
    ].join("\u0001")).digest("hex"), ok2.id.slice(0, 12) + "…");

    console.log("---- M15R-DB3 material_map_runs 运行留痕 ----");
    const run = db.createMaterialMapRun({ documentId: "doc1", scopeAnchor: "book", scopeKind: "book", granularity: "standard", input: { scope: "book" } });
    check("run 初始 pending", run.status === "pending", run.status);
    db.updateMaterialMapRun(run.id, { status: "estimating", callsPlanned: 8, chars: 42000, estInputTokens: 29400, estOutputTokens: 8000, estCost: 0.35, currency: "CNY", provider: "zai", model: "glm-test", modelConfigHash: "cfg1", promptVersion: 1 });
    db.updateMaterialMapRun(run.id, { status: "running", callsDone: 3 });
    db.updateMaterialMapRun(run.id, { status: "completed", actualPromptTokens: 30123, actualCompletionTokens: 8455, actualCost: 0.38, output: { nodes: 12 } });
    const done = db.getMaterialMapRun(run.id);
    check("状态机推进完整", done.status === "completed" && done.callsDone === 3, done.status);
    check("预计与实际并存（预计/实际 对照）", done.estCost === 0.35 && done.actualCost === 0.38, [done.estCost, done.actualCost]);
    check("实际 usage 落库", done.actualPromptTokens === 30123 && done.actualCompletionTokens === 8455, done.actualPromptTokens);
    db.updateMaterialMapRun(run.id, { repairCount: 1, errorCode: "review_fail", errorText: "语义审查未过" });
    check("repair 计数与错误码留痕", db.getMaterialMapRun(run.id).repairCount === 1 && db.getMaterialMapRun(run.id).errorCode === "review_fail", "");
    check("run 列表倒序", db.listMaterialMapRuns("doc1")[0].id === run.id, "");
    const run2 = db.createMaterialMapRun({ documentId: "doc2", input: null });
    check("隔离按文档过滤", db.listMaterialMapRuns("doc1").every((r) => r.documentId === "doc1") && db.listMaterialMapRuns("doc2").length === 1, "");
    void run2;

    console.log("---- M15R-DB4 边界（零 FSRS / 零 knowledge 写入） ----");
    const logsBefore = JSON.stringify(db.listAllReviewLogs());
    const kpBefore = JSON.stringify(db.listKnowledgePoints());
    db.saveMaterialMap({ documentId: "docX", structure: { title: "t", nodes: [], edges: [] } });
    db.saveMaterialMapShard({ ...baseKey, documentId: "docX" });
    db.createMaterialMapRun({ documentId: "docX" });
    check("导图写路径零改 review_logs（FSRS 证据）", JSON.stringify(db.listAllReviewLogs()) === logsBefore, "");
    check("导图写路径零写 knowledge_points（用户知识图谱）", JSON.stringify(db.listKnowledgePoints()) === kpBefore, "");

    console.log("---- M15R-DB-P3 v48.13 重启续跑：被打断 ≠ 失败 ----");
    {
      // 造一条「应用被关闭时还在跑」的 run：状态 running 且 updated_at 已过期（对账阈值 30 分钟）
      const item = db.createFromPaste("续跑测试材料", "# 第一章"+String.fromCharCode(10)+"正文");
      const realDocId = item && item.documentId ? item.documentId : "doc-resume";
      const stale = db.createMaterialMapRun({ documentId: realDocId, scopeAnchor: "book", granularity: "detailed", input: { scope: "book" } });
      db.updateMaterialMapRun(stale.id, { status: "running", stage: "expand", callsDone: 7, chars: 1234 });
      // 把 updated_at 拨到 2 小时前（对账阈值默认 30 分钟）——真正走一遍启动对账路径
      db.execRawSql("UPDATE material_map_runs SET updated_at = ? WHERE id = ?", [Date.now() - 2 * 60 * 60 * 1000, stale.id]);
      const n = db.reconcileStaleMaterialMapRuns();
      check("对账收敛过期运行", n >= 1, ">=1", n);
      const after = db.getMaterialMapRun(stale.id);
      check("被打断的运行记为 interrupted（**不是**失败）", after.status === "interrupted" && after.errorCode === "interrupted", "interrupted", { s: after.status, c: after.errorCode });
      check("错误文案说明可继续且零重复计费", String(after.errorText).includes("继续生成零重复计费"), "含「继续生成零重复计费」", after.errorText);
      const resumable = db.listResumableMaterialMapRuns();
      const hit = resumable.find((r) => r.id === stale.id);
      check("可续跑列表含该 run（应用重启后可发现）", Boolean(hit), "含 stale", resumable.map((r) => [r.id, r.status]));
      check("可续跑列表带材料标题（指示器不必回查）", hit && hit.materialTitle === "续跑测试材料", "续跑测试材料", hit && hit.materialTitle);

      // section_ready 也属于「可继续」：首层就绪、深挖待续跑
      const ready = db.createMaterialMapRun({ documentId: realDocId, scopeAnchor: "book", granularity: "detailed", input: {} });
      db.updateMaterialMapRun(ready.id, { status: "section_ready", stage: "section_ready" });
      check("首层就绪的运行也在可续跑列表中", db.listResumableMaterialMapRuns().some((r) => r.id === ready.id && r.status === "section_ready"), "含 section_ready", db.listResumableMaterialMapRuns().map((r) => r.status));
      db.updateMaterialMapRun(ready.id, { status: "completed" });
      check("已完成的运行不出现在可续跑列表（不反复提示已完成的图）", !db.listResumableMaterialMapRuns().some((r) => r.id === ready.id), "不含 completed", db.listResumableMaterialMapRuns().map((r) => r.status));
    }

    console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
    if (fail) {
      console.log("FAILED items exist");
      app.exit(1);
      return;
    }
    app.exit(0);
  } catch (err) {
    console.error("FATAL:", err && (err.stack || err.message));
    app.exit(1);
  }
});
