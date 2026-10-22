// v41 K2-A AI 抽取归一与关系回归测试（db 层，electron 直跑：npx electron tests/k2a.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：D38 / §4.6「AI 抽取归一硬性规范」——三层确定性架构：同输入重复跑零新增；跨书 kp1 碰撞拆分；
//       normKey 命中自动归一；AI 新名撞已有强制转 link；目标越界降级；prerequisite 建环丢弃；
//       关系端点重解析；拒绝不重提；两 scope 播种 v1。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = require("path").resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k2a-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const norm = require(path.join(ROOT, "electron", "kpNorm.js"));
    await db.initDb();

    console.log("== K2A-1 纯函数层：规范化 / 簇键 / 指纹 ==");
    check("NFKC 全角折叠 + 去空白标点 + 小写", norm.normalizeKpLabel("　负反馈 调节（NFB）") === "负反馈调节nfb", true, norm.normalizeKpLabel("　负反馈 调节（NFB）"));
    check("中英同串归一一致", norm.normalizeKpLabel("Negative Feedback") === norm.normalizeKpLabel("negative feedback"), true, "same");
    check("簇键优先 batch", norm.kpClusterKeyFor({ genBatchId: "b1", documentId: "d1", knowledgePointId: "kp1" }) === "batch:b1:kp1", true, norm.kpClusterKeyFor({ genBatchId: "b1", documentId: "d1", knowledgePointId: "kp1" }));
    check("簇键回落 doc", norm.kpClusterKeyFor({ documentId: "d1", knowledgePointId: "kp1" }) === "doc:d1:kp1", true, "ok");
    check("簇键无锚 legacy", norm.kpClusterKeyFor({ knowledgePointId: "kp1" }) === "legacy:kp1", true, "ok");
    check("指纹稳定（同输入同指纹）", norm.kpProposalFingerprint("point", ["create", "abc"]) === norm.kpProposalFingerprint("point", ["create", "abc"]), true, "stable");
    check("编号识别：kp1/KP_2 为编号，具体概念不是", norm.isOpaqueClusterId("kp1") && norm.isOpaqueClusterId("KP_2") && !norm.isOpaqueClusterId("负反馈调节"), true, "ok");

    console.log("== K2A-2 两 scope 播种 v1 ==");
    const tplE = db.getPromptTemplate("knowledge-extraction");
    const tplR = db.getPromptTemplate("knowledge-relation");
    check("knowledge-extraction v1 播种", tplE && tplE.version === 1, true, tplE && tplE.version);
    check("含禁编造 id 与 clusterKey 回抄条款", tplE.content.includes("clusterKey 必须原样回抄") && tplE.content.includes("禁止编造任何 id"), true, true);
    check("knowledge-relation v1 播种 + 前置方向锚语", tplR && tplR.version === 1 && tplR.content.includes("A 是 B 的前置"), true, tplR && tplR.version);

    console.log("== K2A-3 簇列举：跨书 kp1 碰撞拆分与已归一判定 ==");
    const itemA = db.createFromPaste("K2ATEST 甲书", "甲书内容");
    const itemB = db.createFromPaste("K2ATEST 乙书", "乙书内容");
    const mk = (front, kp, extra = {}) => db.createCard({ noteText: front, cardType: "qa", frontMarkdown: front, backMarkdown: "答案", priority: 50, tags: [], knowledgePointId: kp, ...extra });
    mk("K2ATEST 甲书 kp1 卡", "kp1", { contextRef: { documentId: itemA.documentId } });
    mk("K2ATEST 乙书 kp1 卡", "kp1", { contextRef: { documentId: itemB.documentId } });
    mk("K2ATEST 批次卡", "kp2", { genBatchId: "batch-xyz", contextRef: { documentId: itemA.documentId } });
    let listing = db.listKpClusters();
    const keys = listing.clusters.map((c) => c.clusterKey);
    check("同书同 kp1 归一个簇、跨书拆两个簇", keys.includes(`doc:${itemA.documentId}:kp1`) && keys.includes(`doc:${itemB.documentId}:kp1`), true, keys);
    check("批次键优先（batch:batch-xyz:kp2）", keys.includes("batch:batch-xyz:kp2"), true, keys);
    check("三个簇均未归一", listing.totalUnnormalized === 3, 3, listing.totalUnnormalized);
    const kpA = db.createKnowledgePoint({ canonicalLabel: "K2ATEST 负反馈调节" });
    mk("K2ATEST 文本旧值卡", "K2ATEST 负反馈调节");
    listing = db.listKpClusters();
    const textCluster = listing.clusters.find((c) => c.legacyKey === "K2ATEST 负反馈调节");
    check("文本旧值 normKey 命中 KP → 已归一", textCluster && textCluster.normalized, true, textCluster && textCluster.normalized);

    console.log("== K2A-4 裁决器：create 提案 + 指纹幂等（重复跑零新增） ==");
    const rawCreate = JSON.stringify({
      items: [
        { clusterKey: `doc:${itemA.documentId}:kp1`, canonicalLabel: "K2ATEST 甲书概念", aliases: ["conceptA"], domain: ["51"], description: "甲书核心概念", action: "create", targetKpId: null, confidence: 4, evidence: "K2ATEST 甲书 kp1 卡" },
        { clusterKey: `doc:${itemB.documentId}:kp1`, canonicalLabel: "K2ATEST 乙书概念", aliases: [], domain: ["57"], description: "乙书核心概念", action: "create", targetKpId: null, confidence: 3, evidence: "K2ATEST 乙书 kp1 卡" }
      ]
    });
    let sum = db.applyKpExtraction(rawCreate, "");
    check("生成 2 条 create 提案（跨书不再是同一提案）", sum.created.length === 2, 2, sum.created);
    const props1 = db.listKnowledgeProposals({ status: "pending", proposalKind: "point" }).proposals.filter((p) => p.payload.aiAssisted);
    check("提案携带 clusters[] 簇证据", props1.length === 2 && props1.every((p) => Array.isArray(p.payload.clusters) && p.payload.clusters[0].cardIds.length === 1), true, props1.map((p) => p.payload.clusters));
    sum = db.applyKpExtraction(rawCreate, "");
    check("同输入重复跑：零新增（簇已归一跳过，提案数不变）", sum.created.length === 0 && sum.skipped.length === 2, true, sum);
    const propsAfter = db.listKnowledgeProposals({ status: "pending", proposalKind: "point" }).proposals.filter((p) => p.payload.aiAssisted);
    check("提案总数不变（幂等）", propsAfter.length === 2, 2, propsAfter.length);

    console.log("== K2A-5 裁决器：normKey 命中自动归一 / 编号不做别名 ==");
    const kpA2 = db.createKnowledgePoint({ canonicalLabel: "K2ATEST 反馈回路", aliases: ["feedback loop"] });
    // 造一个待归一簇：文本旧值走 n-gram 但 AI 输出归一化名恰好命中已有 KP
    mk("K2ATEST 回路卡", "K2ATEST funny 旧值", { genBatchId: "batch-loop" });
    const rawAuto = JSON.stringify({
      items: [{ clusterKey: "batch:batch-loop:K2ATEST funny 旧值", canonicalLabel: "Ｋ２ＡＴＥＳＴ 反馈回路", aliases: ["loop-alias"], domain: [], action: "link", targetKpId: kpA2.id, confidence: 5, evidence: "K2ATEST 回路卡" }]
    });
    sum = db.applyKpExtraction(rawAuto, "");
    check("normKey（全角折半角）命中已有 KP → 自动归一", sum.autoLinked.length === 1 && sum.autoLinked[0].targetKpId === kpA2.id, true, sum.autoLinked);
    const kpA2After = db.getKnowledgePoint(kpA2.id);
    check("确定性别名并入（AI 别名进 target）", kpA2After.aliases.includes("loop-alias"), true, kpA2After.aliases);
    check("编号旧值不做别名（funny 旧值非编号 → 并入）", kpA2After.aliases.includes("K2ATEST funny 旧值"), true, kpA2After.aliases);
    const autoProp = db.listKnowledgeProposals({ status: "accepted" }).proposals.find((p) => p.payload?.auto);
    check("自动归一落已接受提案留痕", Boolean(autoProp), true, "trail");
    const autoCluster = db.listKpClusters().clusters.find((c) => c.legacyKey === "K2ATEST funny 旧值");
    check("该簇转为已归一", autoCluster && autoCluster.normalized, true, autoCluster && autoCluster.normalized);

    console.log("== K2A-6 裁决器：目标越界降级 / 歧义转 pending ==");
    mk("K2ATEST 越界卡", "K2ATEST 越界旧值", { genBatchId: "batch-x1" });
    const rawInvalid = JSON.stringify({ items: [{ clusterKey: "batch:batch-x1:K2ATEST 越界旧值", canonicalLabel: "K2ATEST 越界概念", action: "link", targetKpId: "bogus-id-123", confidence: 4, evidence: "x" }] });
    sum = db.applyKpExtraction(rawInvalid, "");
    const invProp = db.listKnowledgeProposals({ status: "pending" }).proposals.find((p) => p.payload?.canonicalLabel === "K2ATEST 越界概念");
    check("AI 目标越界 → 降级 create 并标 targetInvalid", sum.created.length === 1 && invProp?.payload.targetInvalid === true, true, { created: sum.created.length, targetInvalid: invProp?.payload.targetInvalid });
    mk("K2ATEST 歧义卡", "K2ATEST 歧义旧值", { genBatchId: "batch-x2" });
    const rawConflict = JSON.stringify({ items: [{ clusterKey: "batch:batch-x2:K2ATEST 歧义旧值", canonicalLabel: "K2ATEST 反馈回路", action: "link", targetKpId: kpA.id, confidence: 3, evidence: "y" }] });
    const beforeConflict = db.listKnowledgeProposals({ status: "pending" }).proposals.length;
    sum = db.applyKpExtraction(rawConflict, "");
    check("新名撞已有 KP 但目标不同 → 记录冲突且只产生 pending", sum.conflicts.length === 1 && sum.autoLinked.length === 0, true, sum.conflicts);
    check("冲突不自动归一（正式表零写入）", db.listKnowledgeProposals({ status: "pending" }).proposals.length === beforeConflict + 1, true, "pending+1");

    console.log("== K2A-7 关系裁决：候选内建提案 / 建环丢弃 / 端点重解析 ==");
    mk("K2ATEST 关系甲", "K2ATEST 关系簇甲", { genBatchId: "batch-r1" });
    mk("K2ATEST 关系乙", "K2ATEST 关系簇乙", { genBatchId: "batch-r1" });
    const rawRel = JSON.stringify({
      items: [
        { clusterKey: "batch:batch-r1:K2ATEST 关系簇甲", canonicalLabel: "K2ATEST 关系概念甲", action: "create", confidence: 4, evidence: "K2ATEST 关系甲" }
      ],
      relations: []
    });
    // 先把甲建成正式 KP（走提案接受路径），乙保持簇
    sum = db.applyKpExtraction(rawRel, "");
    const propJia = db.listKnowledgeProposals({ status: "pending" }).proposals.find((p) => p.payload?.canonicalLabel === "K2ATEST 关系概念甲");
    const accJia = db.resolveKnowledgeProposal(propJia.id, true);
    const kpJia = accJia.applied;
    // 关系：KP 甲 → 簇乙（乙未归一 → pending resolved=false）＋ 自循环与编造 id 应被本地丢弃
    const rawRels = JSON.stringify({
      relations: [
        { fromRef: { kpId: kpJia.id }, toRef: { clusterKey: "batch:batch-r1:K2ATEST 关系簇乙" }, relationType: "related_to", confidence: 4, evidence: "K2ATEST 关系甲" },
        { fromRef: { kpId: kpJia.id }, toRef: { kpId: kpJia.id }, relationType: "related_to", confidence: 5, evidence: "self" },
        { fromRef: { kpId: "not-in-list" }, toRef: { kpId: kpJia.id }, relationType: "related_to", confidence: 4, evidence: "bogus" }
      ]
    });
    sum = db.applyKpExtraction("", rawRels);
    check("关系：KP→簇 建 pending（resolved=false）", sum.relations.length === 1 && sum.relations[0].resolved === false, true, sum.relations);
    check("自循环与编造 id 被本地丢弃（跳过 2）", sum.skipped.length === 2, 2, sum.skipped);
    const relProp = db.listKnowledgeProposals({ status: "pending", proposalKind: "relation" }).proposals[0];
    check("端点引用落 payload.fromRef/toRef", Boolean(relProp.payload.fromRef?.kpId) && Boolean(relProp.payload.toRef?.clusterKey), true, relProp.payload);
    let threw = null;
    try { db.resolveKnowledgeProposal(relProp.id, true); } catch (err) { threw = err; }
    check("端点未归一前接受 → 可读拒绝", threw instanceof Error && /尚未归一/.test(threw.message), true, threw && threw.message);
    // 乙走抽取 → create 提案；接受乙的提案 → 端点自动重解析 → 关系可接受
    sum = db.applyKpExtraction(JSON.stringify({ items: [{ clusterKey: "batch:batch-r1:K2ATEST 关系簇乙", canonicalLabel: "K2ATEST 关系概念乙", action: "create", confidence: 4, evidence: "K2ATEST 关系乙" }] }), "");
    const propYi = db.listKnowledgeProposals({ status: "pending" }).proposals.find((p) => p.payload?.canonicalLabel === "K2ATEST 关系概念乙");
    const accYi = db.resolveKnowledgeProposal(propYi.id, true);
    check("点提案接受时自动重解析关系端点", accYi.applied?.relationRefsResolved >= 1, true, accYi.applied);
    const relAfter = db.listKnowledgeProposals({ status: "pending", proposalKind: "relation" }).proposals.find((p) => p.id === relProp.id);
    check("关系提案端点已补 kpId", Boolean(relAfter.payload.fromKnowledgePointId && relAfter.payload.toKnowledgePointId), true, relAfter.payload);
    const accRel = db.resolveKnowledgeProposal(relProp.id, true);
    const kpYi = accYi.applied;
    check("关系接受 → 正式边建立", accRel.applied && accRel.applied.relationType === "related_to", true, accRel.applied);
    // 建环丢弃：甲→乙 已存在等价的 related_to… 用 prerequisite 反向验证
    db.createKnowledgeRelation({ fromKnowledgePointId: kpJia.id, toKnowledgePointId: kpYi.id, relationType: "prerequisite" });
    mk("K2ATEST 环丙", "K2ATEST 环卡", { genBatchId: "batch-r2" });
    const rawCycle = JSON.stringify({ relations: [{ fromRef: { kpId: kpYi.id }, toRef: { kpId: kpJia.id }, relationType: "prerequisite", confidence: 4, evidence: "cycle" }] });
    sum = db.applyKpExtraction("", rawCycle);
    check("prerequisite 建环 → 本地丢弃并留痕", sum.skipped.some((s) => /建环/.test(s.reason)), true, sum.skipped);

    console.log("== K2A-8 一键全接受 + 拒绝不重提 + 零 FSRS 影响 ==");
    const before = db.listKnowledgeProposals({ status: "pending" }).proposals.length;
    const all = db.acceptAllPendingKnowledgeProposals();
    check("一键全接受遍历 pending", all.total === before, before, all.total);
    check("全部接受成功（无失败）", all.failed.length === 0, 0, all.failed);
    check("接受后 pending 清零", db.listKnowledgeProposals({ status: "pending" }).proposals.length === 0, 0, db.listKnowledgeProposals({ status: "pending" }).proposals.length);
    // 拒绝不重提：造一条文本旧值提案 → 拒绝 → 再扫描不重现
    mk("K2ATEST 拒绝卡", "K2ATEST 被拒概念");
    db.buildKnowledgeMigrationSuggestions({ minSimilarity: 0.99 });
    const rejProp = db.listKnowledgeProposals({ status: "pending" }).proposals.find((p) => p.payload?.legacyKey === "K2ATEST 被拒概念");
    db.resolveKnowledgeProposal(rejProp.id, false);
    const rescan = db.buildKnowledgeMigrationSuggestions({ minSimilarity: 0.99 });
    check("拒绝后重扫不重提（指纹幂等）", rescan.created === 0, 0, rescan);
    const probe = mk("K2ATEST FSRS 探针", "K2ATEST 探针旧值");
    const fsrsBefore = db.getCard(probe.id).fsrs;
    db.applyKpExtraction(JSON.stringify({ items: [{ clusterKey: "legacy:K2ATEST 探针旧值", canonicalLabel: "K2ATEST 探针概念", action: "create", confidence: 3, evidence: "z" }] }), "");
    check("K2-A 写路径零改卡片 fsrs（§4.12 声明）", JSON.stringify(db.getCard(probe.id).fsrs) === JSON.stringify(fsrsBefore), true, "fsrs 未动");

    console.log(`\nK2A 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("K2A 测试异常：", err);
    app.exit(1);
  }
});
