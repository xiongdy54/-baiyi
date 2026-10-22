// v40 K1 知识地基回归测试（db 层，electron 直跑：npx electron tests/k1.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§4.6 + D37 + §4.2-23 KnowledgeBase——四表 / 唯一约束 / prerequisite 无环（K3 纯本地）/
//       merge 可回滚（merged_into + alias 并入还原）/ 生命周期 / 软删除 / 旧字段迁移只回填 proposals。
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k1-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    console.log("== K1-1 KP CRUD 与别名检索 ==");
    const kpA = db.createKnowledgePoint({ canonicalLabel: "K1TEST 负反馈调节", domainId: "51", aliases: ["negative feedback"] });
    check("新建 KP 返回 active + 别名数组", kpA.status === "active" && eq(kpA.aliases, ["negative feedback"]), ["active", ["negative feedback"]], [kpA.status, kpA.aliases]);
    const kpA2 = db.getKnowledgePoint(kpA.id);
    check("读回一致", kpA2.canonicalLabel === kpA.canonicalLabel && kpA2.domainId === "51", true, kpA2);
    const listed = db.listKnowledgePoints({ query: "负反馈" });
    check("label 子串命中", listed.points.some((p) => p.id === kpA.id), true, listed.total);
    const listedAlias = db.listKnowledgePoints({ query: "negative" });
    check("alias 子串命中（alias_json LIKE）", listedAlias.points.some((p) => p.id === kpA.id), true, listedAlias.total);
    const upd = db.updateKnowledgePoint(kpA.id, { description: "系统输出回抑制输入的调节", aliases: ["negative feedback", "反馈抑制"] });
    check("更新 label 外字段 + 追加别名", upd.aliases.length === 2 && upd.description.includes("回抑制"), true, upd.aliases);
    let threw = false;
    try { db.updateKnowledgePoint(kpA.id, { status: "merged" }); } catch { threw = true; }
    check("status 不得经 update 置 merged（合并独占路径）", threw, true, threw);

    console.log("== K1-2 关系边：枚举 / 自循环 / 唯一约束 / analogous_to 必带 structureLabel ==");
    const kpB = db.createKnowledgePoint({ canonicalLabel: "K1TEST 恒温器" });
    const kpC = db.createKnowledgePoint({ canonicalLabel: "K1TEST 控制论" });
    let e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpA.id, toKnowledgePointId: kpB.id, relationType: "smells_like" }); } catch (err) { e = err; }
    check("未知关系类型拒绝", e instanceof Error, true, String(e));
    e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpA.id, toKnowledgePointId: kpA.id, relationType: "related_to" }); } catch (err) { e = err; }
    check("自循环一律拒绝", e instanceof Error, true, String(e));
    const r1 = db.createKnowledgeRelation({ fromKnowledgePointId: kpA.id, toKnowledgePointId: kpB.id, relationType: "example_of", source: "user" });
    check("合法边创建", r1.relationType === "example_of", true, r1);
    e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpA.id, toKnowledgePointId: kpB.id, relationType: "example_of" }); } catch (err) { e = err; }
    check("唯一约束 (from,to,type) 拒绝重复", e instanceof Error, true, String(e));
    e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpC.id, toKnowledgePointId: kpB.id, relationType: "analogous_to" }); } catch (err) { e = err; }
    check("analogous_to 缺 structureLabel 拒绝", e instanceof Error, true, String(e));
    const rAna = db.createKnowledgeRelation({ fromKnowledgePointId: kpC.id, toKnowledgePointId: kpB.id, relationType: "analogous_to", structureLabel: "目标-测量-纠正回路" });
    check("带 structureLabel 的 analogous_to 可入库（v1 只建表不启用引擎）", rAna.structureLabel === "目标-测量-纠正回路", true, rAna.structureLabel);

    console.log("== K1-3 prerequisite 无环（KnowledgeLint K3 写时校验） ==");
    // A --prereq--> B（A 是 B 的前置）：A→B→C 链上再加 C→A 必成环
    const pAB = db.createKnowledgeRelation({ fromKnowledgePointId: kpA.id, toKnowledgePointId: kpB.id, relationType: "prerequisite" });
    const pBC = db.createKnowledgeRelation({ fromKnowledgePointId: kpB.id, toKnowledgePointId: kpC.id, relationType: "prerequisite" });
    check("前置链 A→B→C 建立成功", pAB.id && pBC.id, true, "ok");
    e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpC.id, toKnowledgePointId: kpA.id, relationType: "prerequisite" }); } catch (err) { e = err; }
    check("建环 C→A 被拒绝", e instanceof Error, true, String(e));
    check("拒绝信息含环路径", e && String(e.message).includes("→"), true, e && e.message);
    e = null;
    try { db.createKnowledgeRelation({ fromKnowledgePointId: kpC.id, toKnowledgePointId: kpA.id, relationType: "related_to" }); } catch (err) { e = err; }
    check("非 prerequisite 类型不做无环约束（同结构 related_to 可建）", e === null, true, String(e));

    console.log("== K1-4 合并 + 回滚（merged_into + alias 精确还原） ==");
    const kpD = db.createKnowledgePoint({ canonicalLabel: "K1TEST 负反馈机制", aliases: ["反馈机制"] });
    const targetAliasesBefore = db.getKnowledgePoint(kpA.id).aliases;
    const merged = db.mergeKnowledgePoints(kpD.id, kpA.id);
    check("merge 后 source=merged 且指向 target", merged.source.status === "merged" && merged.source.mergedInto === kpA.id, true, merged.source);
    const targetAfter = db.getKnowledgePoint(kpA.id);
    check("target 别名并入 source label + source aliases", targetAfter.aliases.includes("K1TEST 负反馈机制") && targetAfter.aliases.includes("反馈机制"), true, targetAfter.aliases);
    const relOfSource = db.listKnowledgeRelations({ kpId: kpD.id });
    // 合并不重写边：kpD 自己无边，但其族（并入 kpA）展开可见 kpA 的既有边——且边的端点仍指向 kpA（未被改写）
    check("族展开可见 target 既有边", relOfSource.relations.length === 3, 3, relOfSource.relations.length);
    check("边端点未被改写（仍指向 kpA，不指向 kpD）", relOfSource.relations.every((r) => r.fromKnowledgePointId !== kpD.id && r.toKnowledgePointId !== kpD.id), true, "no rewrite");
    const famA = db.resolveKpFamily(kpA.id);
    check("族解析包含 target 与 source", famA.includes(kpA.id) && famA.includes(kpD.id), true, famA);
    const back = db.unmergeKnowledgePoint(kpD.id);
    check("unmerge 后 source 恢复 active、指针清空", back.status === "active" && back.mergedInto === null, true, back);
    const targetRestored = db.getKnowledgePoint(kpA.id);
    check("回滚精确：target 别名还原为合并前集合", eq(targetRestored.aliases, targetAliasesBefore), targetAliasesBefore, targetRestored.aliases);
    e = null;
    try { db.mergeKnowledgePoints(kpD.id, kpD.id); } catch (err) { e = err; }
    check("不能合并到自身", e instanceof Error, true, String(e));

    console.log("== K1-5 生命周期与软删除 ==");
    const dep = db.updateKnowledgePoint(kpD.id, { status: "deprecated" });
    check("deprecated 合法", dep.status === "deprecated", true, dep.status);
    const activeOnly = db.listKnowledgePoints({ status: "active" });
    check("status 过滤不含 deprecated", !activeOnly.points.some((p) => p.id === kpD.id), true, activeOnly.points.length);
    e = null;
    try { db.mergeKnowledgePoints(kpD.id, kpC.id); } catch (err) { e = err; }
    check("deprecated KP 不可作为合并源", e instanceof Error, true, String(e));

    console.log("== K1-6 旧字段迁移：只回填 proposals，决议后才写正式表 ==");
    const legacyKey = "K1TEST 负反馈调节"; // 与 kpA label 精确相同 → link 提案
    const legacyNew = "K1TEST 从未见过的知识点"; // 无 KP → create 提案
    for (const key of [legacyKey, legacyNew]) {
      db.createCard({ noteText: "K1TEST 卡", cardType: "qa", frontMarkdown: "K1TEST 前置", backMarkdown: "K1TEST 答案", priority: 50, tags: [], knowledgePointId: key });
    }
    const sug = db.buildKnowledgeMigrationSuggestions({ minSimilarity: 0.9 });
    // v41（D38）语义：旧值 normKey 精确命中已有 KP → 该簇直接视为「已归一」，不再出提案
    check("扫描出 1 个旧字段值（精确命中的已归一，不出提案）", sug.scanned === 1, 1, sug.scanned);
    check("生成 1 条提案（仅无命中者）", sug.created === 1, 1, sug.created);
    const clusters = db.listKpClusters();
    check("精确命中的簇标记 normalized=true", clusters.clusters.some((c) => c.legacyKey === legacyKey && c.normalized), true, clusters.clusters.map((c) => [c.legacyKey, c.normalized]));
    const sug2 = db.buildKnowledgeMigrationSuggestions({});
    check("重复扫描不产生重复提案（幂等）", sug2.created === 0, 0, sug2.created);
    const props = db.listKnowledgeProposals({ status: "pending", proposalKind: "point" });
    const createProp = props.proposals.find((p) => p.payload.action === "create");
    check("无命中 → create 提案建议新建", createProp && createProp.payload.canonicalLabel === legacyNew, true, createProp && createProp.payload);
    check("create 提案携带簇证据（clusters[]）", createProp && Array.isArray(createProp.payload.clusters) && createProp.payload.clusters[0]?.cardCount === 1, true, createProp && createProp.payload.clusters);
    const accepted = db.resolveKnowledgeProposal(createProp.id, true);
    check("接受 create 提案 → 正式 KP 建立", accepted.applied && accepted.applied.canonicalLabel === legacyNew && accepted.proposal.status === "accepted", true, accepted.applied);
    // 拒绝路径：手工造一条 link 提案（n-gram 命中 kpA），拒绝后不重提（指纹幂等）
    const manualLink = db.createKnowledgeProposal({ proposalKind: "point", payload: { action: "link", legacyKey: "K1TEST 负反馈的调节机制", targetKpId: kpA.id, targetLabel: kpA.canonicalLabel, clusters: [] } });
    const rejected = db.resolveKnowledgeProposal(manualLink.id, false);
    check("拒绝 link 提案 → 标记 rejected、不动正式表", rejected.proposal.status === "rejected", true, rejected.proposal.status);
    const again = db.createKnowledgeProposal({ proposalKind: "point", payload: { action: "link", legacyKey: "K1TEST 负反馈的调节机制", targetKpId: kpA.id, targetLabel: kpA.canonicalLabel, clusters: [] } });
    check("同指纹提案拒绝后不再重提（created=false）", again.created === false && again.id === manualLink.id, true, { created: again.created, sameId: again.id === manualLink.id });

    console.log("== K1-7 提案通路：relation / merge 提案决议 ==");
    const relProp = db.createKnowledgeProposal({ proposalKind: "relation", payload: { fromKnowledgePointId: kpA.id, toKnowledgePointId: kpC.id, relationType: "part_of" } });
    const relResolved = db.resolveKnowledgeProposal(relProp.id, true);
    check("接受 relation 提案 → 正式边建立", relResolved.applied && relResolved.applied.relationType === "part_of", true, relResolved.applied);
    const kpE = db.createKnowledgePoint({ canonicalLabel: "K1TEST 待并入者" });
    const mergeProp = db.createKnowledgeProposal({ proposalKind: "merge", payload: { sourceId: kpE.id, targetId: kpC.id } });
    const mergeResolved = db.resolveKnowledgeProposal(mergeProp.id, true);
    check("接受 merge 提案 → 合并生效", mergeResolved.applied && mergeResolved.applied.source.status === "merged", true, mergeResolved.applied && mergeResolved.applied.source && mergeResolved.applied.source.status);
    db.unmergeKnowledgePoint(kpE.id);

    console.log("== K1-8 外部 ID grounding ==");
    db.createKnowledgeExternalRef({ knowledgePointId: kpA.id, refKind: "wikidata-qid", refValue: "Q123456" });
    db.createKnowledgeExternalRef({ knowledgePointId: kpA.id, refKind: "doi", refValue: "10.1000/k1test" });
    const refs = db.listKnowledgeExternalRefs(kpA.id);
    check("两条外部 ID 挂同一 KP", refs.length === 2, 2, refs.length);
    e = null;
    try { db.createKnowledgeExternalRef({ knowledgePointId: kpA.id, refKind: "orcid", refValue: "x" }); } catch (err) { e = err; }
    check("未知 ref_kind 拒绝", e instanceof Error, true, String(e));

    console.log("== K1-9 软删除与零 FSRS 影响（§4.12 读侧不变量） ==");
    const del = db.deleteKnowledgeRelation(pBC.id);
    check("被删边从列表消失（其余边不受影响）", del && !db.listKnowledgeRelations({ kpId: kpC.id }).relations.some((r) => r.id === pBC.id), true, "ok");
    const cardBefore = db.getCard(db.listAllCards().find((c) => c.frontMarkdown === "K1TEST 前置").id);
    db.createKnowledgePoint({ canonicalLabel: "K1TEST 无关新点" });
    const cardAfter = db.getCard(cardBefore.id);
    check("K1 写路径零改卡片 fsrs/due（读侧只读不变量）", eq(cardBefore.fsrs, cardAfter.fsrs), true, "fsrs 未动");

    console.log(`\nK1 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("K1 测试异常：", err);
    app.exit(1);
  }
});
