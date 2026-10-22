// v43 K2-B 回归测试（db 层，electron 直跑：npx electron tests/k2b.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§6.3.11 余下 4 scope 播种 v1（三要素：判定锚语 + evidence 引用要求 + 封闭选项清单）；
//       §6.3.12 KnowledgeLint K4/K7/K8 报告型检查；§4.6 出层契约裁决 + 离散度守门；
//       零 FSRS 影响（本批不触 FSRS 调度字段）。
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k2b-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const prompts = require(path.join(ROOT, "electron", "prompts.js"));
    const scopes = require(path.join(ROOT, "electron", "kpScopes.js"));
    await db.initDb();

    console.log("== K2B-1 四 scope 播种 v1（三要素齐备） ==");
    const md = db.getPromptTemplate("material-difficulty");
    const kp_ = db.getPromptTemplate("knowledge-probe");
    const fe = db.getPromptTemplate("frontier-explain");
    const sa = db.getPromptTemplate("structure-analogy");
    check("material-difficulty v1 播种且与基线字面一致", !!md && md.version === 1 && md.content === prompts.MATERIAL_DIFFICULTY_PROMPT, true, md && md.version);
    check("knowledge-probe v1 播种且与基线字面一致", !!kp_ && kp_.version === 1 && kp_.content === prompts.KNOWLEDGE_PROBE_PROMPT, true, kp_ && kp_.version);
    check("frontier-explain v1 播种且与基线字面一致", !!fe && fe.version === 1 && fe.content === prompts.FRONTIER_EXPLAIN_PROMPT, true, fe && fe.version);
    check("structure-analogy v1 播种且与基线字面一致", !!sa && sa.version === 1 && sa.content === prompts.STRUCTURE_ANALOGY_PROMPT, true, sa && sa.version);
    // 三要素①判定锚语 ②evidence 引用要求 ③封闭选项清单（UDC 注入）
    check("material-difficulty：锚语 + evidence + UDC 注入 + 六维", md.content.includes("判定锚语") && md.content.includes("原文照抄") && md.content.includes("004 计算机·AI") && md.content.includes("transferDemand"), true, true);
    check("knowledge-probe：维度锚语 + evidence 强制 + 五维封闭 + 禁原题重问", kp_.content.includes("维度判定锚语") && kp_.content.includes("无 evidence 的探针禁止输出") && kp_.content.includes("conceptualUnderstanding") && kp_.content.includes("禁止改写或复用任何一张原卡的题面"), true, true);
    check("frontier-explain：四档锚语 + 禁编造扫描数字 + 结构驱动附映射与差异", fe.content.includes("判定锚语") && fe.content.includes("禁止编造任何扫描数字或统计数据") && fe.content.includes("too_hard") && fe.content.includes("disanalogy"), true, true);
    check("structure-analogy：手法三选一 + 相似度锚语 + 无依据降 uncertain", sa.content.includes("analogy") && sa.content.includes("abstraction") && sa.content.includes("combination") && sa.content.includes("判定锚语") && sa.content.includes("必须写 \"uncertain\""), true, true);
    check("幂等：重复 ensurePromptTemplates 不再插行", (db.ensurePromptTemplates(), db.listPromptTemplates().filter((t) => t.scope === "structure-analogy").length === 1), true, "idempotent");

    console.log("== K2B-2 material-difficulty 出层契约裁决 ==");
    const materialText = "K2BTEST 材料原文：负反馈调节使系统趋于稳定。K2BTEST 密度较高。";
    const mdGood = JSON.stringify({
      difficulty: {
        conceptualDifficulty: { grade: 3, anchor: "需要学科基础概念", evidence: "负反馈调节使系统趋于稳定" },
        languageDifficulty: { grade: 2, anchor: "偶有术语", evidence: "K2BTEST 材料原文" },
        prerequisiteDifficulty: { grade: 1, anchor: "无前置", evidence: "负反馈调节使系统趋于稳定" },
        density: { grade: 4, anchor: "句句有新信息", evidence: "K2BTEST 密度较高" },
        applicationDemand: { grade: 2, anchor: "能复述", evidence: "负反馈调节使系统趋于稳定" },
        transferDemand: { grade: 3, anchor: "跨情境类比", evidence: "负反馈调节使系统趋于稳定" }
      },
      overallGrade: 3,
      kpCandidates: [
        { label: "K2BTEST 负反馈", domain: ["57"], evidence: "负反馈调节使系统趋于稳定" },
        { label: "K2BTEST 无据候选", domain: ["51"], evidence: "" }
      ],
      prerequisiteGapHints: ["控制论基础"]
    });
    let r = scopes.validateMaterialDifficultyOutput(mdGood, { materialText });
    check("合法输出全量通过（六维档位保留）", r.value && r.value.difficulty.conceptualDifficulty.grade === 3 && r.value.overallGrade === 3, true, r);
    check("缺 evidence 的候选被丢弃（禁无据提名）", r.value.kpCandidates.length === 1 && r.issues.some((i) => i.code === "ITEM_DROPPED"), true, { n: r.value.kpCandidates.length, issues: r.issues });
    const mdBad = JSON.stringify({
      difficulty: { conceptualDifficulty: { grade: 9, anchor: "x", evidence: "负反馈调节使系统趋于稳定" }, languageDifficulty: { grade: 2, anchor: "x", evidence: "" } },
      overallGrade: "很高",
      kpCandidates: [{ label: "K2BTEST 越界域", domain: ["999"], evidence: "K2BTEST 材料原文" }]
    });
    r = scopes.validateMaterialDifficultyOutput(mdBad, { materialText });
    check("档位越界（9/非档字符串）→ 降 uncertain", r.value.difficulty.conceptualDifficulty.grade === "uncertain" && r.value.overallGrade === "uncertain" && r.issues.filter((i) => i.code === "ENUM_CLEARED").length >= 2, true, r.value);
    check("缺 evidence 维度降 uncertain（无依据降档）", r.value.difficulty.languageDifficulty.grade === "uncertain" && r.issues.some((i) => i.code === "DOWNGRADED_UNCERTAIN"), true, r.value.difficulty.languageDifficulty);
    check("domain 越界本地置 other（封闭清单）", JSON.stringify(r.value.kpCandidates[0].domain) === '["other"]', true, r.value.kpCandidates);
    r = scopes.validateMaterialDifficultyOutput("这不是JSON", { materialText });
    check("非 JSON 输出 → 整包拒绝", r.value === null && r.issues[0].code === "JSON_PARSE_FAILED", true, r);

    console.log("== K2B-3 knowledge-probe 出层契约裁决 ==");
    const probeInput = { kpIds: ["kp-real-1"], cardFronts: ["K2BTEST 原卡题面：什么是负反馈？"] };
    const probeGood = JSON.stringify({
      probes: [
        { dimension: "application", kpId: "kp-real-1", kpLabel: "K2BTEST 负反馈", situationQuestion: "K2BTEST 恒温器如何在不同季节维持室温？", idealAnswerPoints: ["比较设定值与实测值", "启动相反动作"], evidence: "负反馈调节" },
        { dimension: "transfer", kpId: "kp-fake-9", kpLabel: "x", situationQuestion: "题面", idealAnswerPoints: ["a"], evidence: "e" },
        { dimension: "metaphor", kpId: "kp-real-1", kpLabel: "x", situationQuestion: "题面", idealAnswerPoints: ["a"], evidence: "e" },
        { dimension: "recall", kpId: "kp-real-1", kpLabel: "x", situationQuestion: "什么是负反馈？", idealAnswerPoints: ["a"], evidence: "e" },
        { dimension: "recall", kpId: "kp-real-1", kpLabel: "x", situationQuestion: "另一题", idealAnswerPoints: [], evidence: "e" }
      ]
    });
    r = scopes.validateKnowledgeProbeOutput(probeGood, probeInput);
    check("合法探针保留（要点截断 cap 4）", r.value.probes.length === 1 && r.value.probes[0].idealAnswerPoints.length === 2, true, r.value);
    check("编造 kpId 丢弃（禁编造 ID）", r.issues.some((i) => i.code === "FABRICATED_ID"), true, r.issues);
    check("dimension 越界丢弃（封闭五维）", r.issues.some((i) => i.code === "ITEM_DROPPED" && /dimension/.test(i.message)), true, r.issues);
    check("原题重问丢弃（新情境硬性）", r.issues.some((i) => i.code === "DUPLICATE_ORIGINAL"), true, r.issues);
    check("无可判定要点丢弃", r.issues.filter((i) => i.code === "ITEM_DROPPED").length >= 2, true, r.issues);

    console.log("== K2B-4 frontier-explain 出层契约裁决 ==");
    const fePayload = { candidates: [{ id: "cand-1", title: "K2BTEST 候选书", prerequisiteReady: true, difficultyGrade: 3 }] };
    const feInput = { candidateIds: ["cand-1", "cand-2"], structureDrivenIds: ["cand-2"], structureKpIds: ["kp-real-1"], inputText: JSON.stringify(fePayload) };
    const feGood = JSON.stringify({
      explanations: [
        { candidateId: "cand-1", reason: "前置已就绪且难度适中", knowledgeCoverage: "覆盖 K2BTEST 负反馈", nextConcepts: ["K2BTEST 概念A"], expectedChallenge: "growth", evidence: "prerequisiteReady: true", uncertainties: [] }
      ]
    });
    r = scopes.validateFrontierExplainOutput(feGood, feInput);
    check("合法解释通过（四档锚内）", r.value.explanations.length === 1 && r.value.explanations[0].expectedChallenge === "growth", true, r);
    const feBad = JSON.stringify({
      explanations: [
        { candidateId: "cand-1", reason: "扫描了 7 份材料后发现 3 个缺口", knowledgeCoverage: "x", nextConcepts: [], expectedChallenge: "impossible", evidence: "", uncertainties: [] },
        { candidateId: "cand-fake", reason: "x", knowledgeCoverage: "x", nextConcepts: [], expectedChallenge: "growth", evidence: "e" },
        { candidateId: "cand-2", reason: "结构与你的负反馈结构对应", knowledgeCoverage: "x", nextConcepts: [], expectedChallenge: "growth", evidence: "e", structureMapping: [{ fromKpId: "kp-fake-9", toLabel: "稳态", relationType: "prerequisite" }], disanalogy: [] }
      ]
    });
    r = scopes.validateFrontierExplainOutput(feBad, feInput);
    check("禁编造数字：输入中不存在的数字 → 文本置空留痕", r.value.explanations[0].reason === null && r.issues.some((i) => i.code === "FABRICATED_NUMBER"), true, r.value.explanations[0]);
    check("challenge 越界（封闭四档）→ 置空", r.value.explanations[0].expectedChallenge === null && r.issues.some((i) => i.code === "ENUM_CLEARED"), true, r.value.explanations[0]);
    check("缺 evidence → 加注 uncertain", r.value.explanations[0].uncertainties.some((u) => /evidence 缺失/.test(u)) && r.issues.some((i) => i.code === "DOWNGRADED_UNCERTAIN"), true, r.value.explanations[0].uncertainties);
    check("编造 candidateId 丢弃", r.value.explanations.filter((e) => e.candidateId === "cand-fake").length === 0 && r.issues.some((i) => i.code === "FABRICATED_ID"), true, r.issues);
    const cand2 = r.value.explanations.find((e) => e.candidateId === "cand-2");
    check("结构驱动：编造槽位丢弃 → 映射为空（禁编造对应）", cand2 && cand2.structureMapping === null, true, cand2);
    check("结构驱动：缺主要差异留痕（disanalogy ≥1）", r.issues.some((i) => i.code === "MISSING_DISANALOGY"), true, r.issues);

    console.log("== K2B-5 structure-analogy 出层契约裁决 ==");
    const saInput = { ownedKpIds: ["kp-real-1", "kp-real-2"], domainCodes: ["51", "004"] };
    const saGood = JSON.stringify({
      connectionMode: "analogy", structureLabel: "K2BTEST 稳定结构", candidateDomain: "51",
      slotMapping: [{ fromKpId: "kp-real-1", toLabel: "K2BTEST 对应概念", relationType: "prerequisite", confidence: 4 }],
      similarityGrade: 4, evidence: "负反馈调节", disanalogy: ["K2BTEST 主要差异"], whyThisDomain: "x", falsifiableQuestions: ["q1"], uncertainties: []
    });
    r = scopes.validateStructureAnalogyOutput(saGood, saInput);
    check("合法结构类比通过（档位保留）", r.value && r.value.similarityGrade === 4 && r.value.slotMapping.length === 1 && r.issues.length === 0, true, r);
    const saBad = JSON.stringify({
      connectionMode: "metaphor", structureLabel: "x", candidateDomain: "999",
      slotMapping: [{ fromKpId: "kp-real-1", toLabel: "a", relationType: "related_to" }]
    });
    r = scopes.validateStructureAnalogyOutput(saBad, saInput);
    check("手法越界整包拒绝（封闭三选一）", r.value === null && r.issues[0].code === "ENUM_CLEARED", true, r);
    const saBad2 = JSON.stringify({
      connectionMode: "analogy", candidateDomain: "004",
      slotMapping: [{ fromKpId: "kp-fake-9", toLabel: "a", relationType: "related_to" }],
      similarityGrade: 2
    });
    r = scopes.validateStructureAnalogyOutput(saBad2, saInput);
    check("槽位全被丢弃 → 整包拒绝（无据不编造）", r.value === null && r.issues.some((i) => i.code === "FABRICATED_ID"), true, r);
    const saNoEv = JSON.stringify({
      connectionMode: "analogy", candidateDomain: "004",
      slotMapping: [{ fromKpId: "kp-real-1", toLabel: "a", relationType: "related_to" }],
      similarityGrade: 5, disanalogy: ["差异"]
    });
    r = scopes.validateStructureAnalogyOutput(saNoEv, saInput);
    check("缺 evidence → 相似度降 uncertain（宁 uncertain 不编造）", r.value.similarityGrade === "uncertain" && r.issues.some((i) => i.code === "DOWNGRADED_UNCERTAIN"), true, r.value);
    check("低档位留痕（≤2 → 结构不成立候选提示）", scopes.validateStructureAnalogyOutput(saGood.replace('"similarityGrade":4', '"similarityGrade":2'), saInput).issues.some((i) => i.code === "LOW_GRADE_HINT"), true, "hint");
    r = scopes.validateStructureAnalogyOutput(JSON.stringify({ result: null, uncertainties: ["结构不成立"] }), saInput);
    check("显式「不成立」是合法输出", r.value && r.value.result === null && r.issues.length === 0, true, r);

    console.log("== K2B-6 离散度守门 scopeDispersion ==");
    let d = scopes.scopeDispersion([{ similarityGrade: 4 }, { similarityGrade: 4 }, { similarityGrade: 4 }], ["similarityGrade"], 0.3);
    check("N 次全一致 → 不一致率 0 未超阈", d.maxRate === 0 && !d.over, true, d);
    d = scopes.scopeDispersion([{ similarityGrade: 4 }, { similarityGrade: 4 }, { similarityGrade: 2 }], ["similarityGrade"], 0.3);
    check("2/3 多数 → 不一致率 0.33 超阈", Math.abs(d.maxRate - 0.33) < 0.01 && d.over, true, d);
    d = scopes.scopeDispersion(
      [{ probes: [{ dimension: "application" }] }, { probes: [{ dimension: "transfer" }] }, { probes: [{ dimension: "application" }] }],
      ["probes[].dimension"], 0.3
    );
    check("数组路径展开统计（probes[].dimension）", Math.abs(d.maxRate - 0.33) < 0.01, true, d.fields);
    d = scopes.scopeDispersion([{ a: 1 }], ["a"], 0.3);
    check("单包不判离散（N<2 直接通过）", d.over === false && d.fields.length === 0, true, d);
    check("scope 字段表覆盖 4 scope", Object.keys(scopes.SCOPE_DISPERSION_FIELDS).length === 4, 4, Object.keys(scopes.SCOPE_DISPERSION_FIELDS));

    console.log("== K2B-7 KnowledgeLint K4/K7/K8 ==");
    const kpOk = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 领域一致", domainId: "51", aliases: [] });
    const kpBadDomain = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 域越界", domainId: "99x", aliases: [] });
    const kpMismatch = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 域不一致", domainId: "51", aliases: ["K2BTEST 别名锚"] });
    const kpBroad = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 过宽概念", domainId: "51", aliases: [] });
    const kpNarrow = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 孤立概念", domainId: "51", aliases: [] });
    const kpClean = db.createKnowledgePoint({ canonicalLabel: "K2BTEST 干净概念", domainId: "51", aliases: [] });
    const mk = (front, kpv, domain) => db.createCard({ noteText: front, cardType: "qa", frontMarkdown: front, backMarkdown: "答案", priority: 50, tags: [], knowledgePointId: kpv, domain: domain || ["51"] });
    mk("K2BTEST 一致卡1", "K2BTEST 领域一致");
    mk("K2BTEST 一致卡2", "K2BTEST 领域一致");
    mk("K2BTEST 一致卡3", "K2BTEST 别名锚", ["51"]); // 别名家族关联
    mk("K2BTEST 不一致卡", "K2BTEST 域不一致", ["32"]);
    mk("K2BTEST 过宽甲", "K2BTEST 过宽概念", ["51"]);
    mk("K2BTEST 过宽乙", "K2BTEST 过宽概念", ["8"]);
    mk("K2BTEST 过宽丙", "K2BTEST 过宽概念", ["61"]);
    mk("K2BTEST 干净甲", "K2BTEST 干净概念");
    mk("K2BTEST 干净乙", "K2BTEST 干净概念");
    db.createKnowledgeRelation({ fromKnowledgePointId: kpOk.id, toKnowledgePointId: kpClean.id, relationType: "related_to" });
    const issues = db.runKnowledgeLint();
    const byKp = (id) => issues.filter((i) => i.knowledgePointId === id);
    check("K4a：domain 不在受控清单 → warn", byKp(kpBadDomain.id).some((i) => i.ruleId === "K4" && i.severity === "warn" && /不在 UDC 受控清单/.test(i.message)), true, byKp(kpBadDomain.id));
    check("K4b：关联卡主类与 KP 主域不一致 → warn（别名家族关联可达）", byKp(kpMismatch.id).some((i) => i.ruleId === "K4" && i.severity === "warn" && /不一致/.test(i.message) && /3/.test(i.message)), true, byKp(kpMismatch.id));
    check("K4b：卡经别名值也能关联（一致 KP 无 K4）", byKp(kpOk.id).every((i) => i.ruleId !== "K4"), true, byKp(kpOk.id));
    check("K7：关联卡跨 3 个主类 → info 建议拆分", byKp(kpBroad.id).some((i) => i.ruleId === "K7" && i.severity === "info" && /过宽/.test(i.message)), true, byKp(kpBroad.id));
    check("K8：零关系边且零关联卡 → info 孤立概念", byKp(kpNarrow.id).some((i) => i.ruleId === "K8" && i.severity === "info"), true, byKp(kpNarrow.id));
    check("K8：有关系边或 ≥2 关联卡 → 不记", byKp(kpOk.id).every((i) => i.ruleId !== "K8") && byKp(kpClean.id).every((i) => i.ruleId !== "K8"), true, [byKp(kpOk.id), byKp(kpClean.id)]);
    check("干净 KP 无任何 issue", byKp(kpClean.id).length === 0, 0, byKp(kpClean.id));
    check("issue 形状齐备（ruleId/severity/kpLabel/message/detail）", issues.every((i) => i.ruleId && i.severity && i.knowledgePointId && i.kpLabel && i.message && i.detail), true, issues[0]);

    console.log("== K2B-8 零 FSRS 影响（本批不触 FSRS 调度字段） ==");
    const probeCard = mk("K2BTEST FSRS 探针卡", "K2BTEST 探针旧值");
    // 新卡 fsrs_json 为空时 normalizeFsrs 回退 {due: Date.now()}（读取侧动态值），故只比稳定字段——
    // 任何 FSRS 写路径都会产出带 stability/difficulty 的完整状态，state/lapses 签名必然改变。
    const fsrsSig = (f) => JSON.stringify({ state: f?.state ?? null, lapses: f?.lapses ?? null, stability: f?.stability ?? null, difficulty: f?.difficulty ?? null, reps: f?.reps ?? null });
    const fsrsBefore = fsrsSig(db.getCard(probeCard.id).fsrs);
    db.runKnowledgeLint();
    db.ensurePromptTemplates();
    scopes.validateMaterialDifficultyOutput(mdGood, { materialText });
    check("lint/播种/校验全链路零改卡片 fsrs（§4.12）", fsrsSig(db.getCard(probeCard.id).fsrs) === fsrsBefore, fsrsBefore, fsrsSig(db.getCard(probeCard.id).fsrs));
    check("本批零新增 AI 写路径（正式关系表与校验前一致）", db.listKnowledgeRelations({ kpId: kpOk.id }).relations.length === 1, 1, "relations 不变");

    console.log(`\nK2B 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("K2B 测试异常：", err);
    app.exit(1);
  }
});
