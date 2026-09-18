// v40 M8-B AI 洞察回归测试（db 层，electron 直跑：npx electron tests/m8b.test.cjs，须先关应用）
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§4.13 + §9.1 M8-B + D37——Evidence Package 禁全库直发 / insight_runs 反馈永不写 mastery /
//       PMC 确认后才成事实 / journal-insight v1 播种 / 范围口径（自然日）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function daysAgoDate(n) {
  const d = new Date(Date.now() - n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m8b-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    console.log("== M8B-1 journal-insight v1 播种 ==");
    const tpl = db.getPromptTemplate("journal-insight");
    check("journal-insight v1 已播种", tpl && tpl.version === 1, true, tpl && tpl.version);
    check("含三层证据纪律（FACT/LEARNED/INFERENCE）", tpl && tpl.content.includes("FACT") && tpl.content.includes("LEARNED") && tpl.content.includes("INFERENCE"), true, tpl && tpl.content.slice(0, 60));
    check("含竞争解释与措辞禁令", tpl && tpl.content.includes("≥2 个互相竞争") && tpl.content.includes("禁止确定性结论"), true, true);
    check("含结构分支契约（structureConnection）", tpl && tpl.content.includes("structureConnection") && tpl.content.includes("disanalogy"), true, true);

    console.log("== M8B-2 Evidence Package：范围口径与草稿排除 ==");
    // 日记：今天一条、40 天前一条、草稿一条（草稿永不入包）。
    // 注意：日记文本须包含完整 KP label 子串（检索语义 = label ⊆ diary）。
    db.createJournalEntry({ contentMarkdown: "M8BTEST 今天在想 M8BTEST 负反馈调节 和 M8BTEST 恒温器 的相似之处", entryDate: daysAgoDate(0) });
    db.createJournalEntry({ contentMarkdown: "M8BTEST 一个月前记的 M8BTEST 控制论", entryDate: daysAgoDate(40) });
    db.saveJournalDraft("M8BTEST 未发送的草稿不该出现");
    const pkg30 = db.buildEvidencePackage({ rangeKind: "30d", tokenBudget: 12000 });
    check("30 天范围不含 40 天前的条目", pkg30.diarySpans.every((s) => s.text.includes("负反馈")), true, pkg30.diarySpans.map((s) => s.entryDate));
    check("草稿不入包（is_draft=0 过滤）", pkg30.diarySpans.every((s) => !s.text.includes("草稿")), true, "no draft");
    const pkgAll = db.buildEvidencePackage({ rangeKind: "all", tokenBudget: 12000 });
    check("all 范围含两条（草稿仍排除）", pkgAll.diarySpans.length === 2 && pkgAll.diarySpans.every((s) => !s.text.includes("草稿")), { n: 2 }, { n: pkgAll.diarySpans.length, dates: pkgAll.diarySpans.map((s) => s.entryDate) });
    const pkgCustom = db.buildEvidencePackage({ rangeKind: "custom", rangeFrom: daysAgoDate(45), rangeTo: daysAgoDate(35), tokenBudget: 12000 });
    check("自定义区间只含 40 天前条目", pkgCustom.diarySpans.length === 1 && pkgCustom.diarySpans[0].text.includes("控制论"), true, pkgCustom.diarySpans.map((s) => s.entryDate));

    console.log("== M8B-3 Evidence Package：日记 → KP → 子图 → 卡/摘录/来源 ==");
    const kp1 = db.createKnowledgePoint({ canonicalLabel: "M8BTEST 负反馈调节", aliases: ["negative feedback"] });
    const kp2 = db.createKnowledgePoint({ canonicalLabel: "M8BTEST 恒温器" });
    const kp3 = db.createKnowledgePoint({ canonicalLabel: "M8BTEST 无关知识点" });
    db.createKnowledgeRelation({ fromKnowledgePointId: kp1.id, toKnowledgePointId: kp2.id, relationType: "related_to" });
    // 命中卡：卡面含 KP label；未命中卡：无关内容
    db.createCard({ noteText: "m8b c1", cardType: "qa", frontMarkdown: "M8BTEST 负反馈调节的核心是什么", backMarkdown: "输出回抑制输入", priority: 50, tags: [] });
    db.createCard({ noteText: "m8b c2", cardType: "qa", frontMarkdown: "M8BTEST 毫不相关的问题", backMarkdown: "答案", priority: 50, tags: [] });
    // legacy knowledge_point_id 恰为 KP label → 命中
    db.createCard({ noteText: "m8b c3", cardType: "qa", frontMarkdown: "随便什么题面", backMarkdown: "答案", priority: 50, tags: [], knowledgePointId: "M8BTEST 负反馈调节" });
    // 命中摘录 + 来源
    const item = db.createFromPaste("M8BTEST 来源书", "控制论讲反馈机制");
    const doc = db.getDocument ? null : null; // documents 经 createFromPaste 建立
    db.createExtract({
      parentType: "doc", parentId: "x", documentId: item.documentId || item.documents?.[0] || null,
      contentMarkdown: "M8BTEST 负反馈调节是控制论的核心机制", priority: 50
    });
    const pkg = db.buildEvidencePackage({ rangeKind: "all", tokenBudget: 12000 });
    const seedIds = pkg.kpSubgraph.kps.map((k) => k.id);
    check("日记命中 seed KP（负反馈调节）", seedIds.includes(kp1.id), true, seedIds);
    check("一跳邻居 KP 入子图（恒温器）", seedIds.includes(kp2.id), true, seedIds);
    check("无关 KP 不入子图", !seedIds.includes(kp3.id), true, seedIds);
    check("关系边随子图入包", pkg.kpSubgraph.edges.length >= 1, true, pkg.kpSubgraph.edges.length);
    check("卡面命中卡入包（含 legacy 命中）", pkg.cards.some((c) => c.front.includes("负反馈")) && pkg.cards.some((c) => c.kpId === "M8BTEST 负反馈调节"), true, pkg.cards.length);
    check("无关卡不入包", !pkg.cards.some((c) => c.front.includes("毫不相关")), true, pkg.cards.map((c) => c.front));
    check("命中摘录入包", pkg.extracts.some((e) => e.text.includes("负反馈")), true, pkg.extracts.length);
    check("来源随命中摘录入包", pkg.sources.some((s) => s.title === "M8BTEST 来源书"), true, pkg.sources);
    check("groundingOrder 固定（§4.13-5）", eq(pkg.groundingOrder, ["user-materials", "confirmed-insights", "knowledge-graph", "general-authority", "model-prior"]), true, pkg.groundingOrder);
    check("grounded=true（未触发裁剪）", pkg.grounded === true, true, pkg.trimmed);

    console.log("== M8B-4 Evidence Package：token 预算裁剪（从后往前，日记恒保留） ==");
    // 制造超预算内容：40 张命中卡（每张长题面）→ used() 远超 2000 下限钳制
    for (let i = 0; i < 40; i++) {
      db.createCard({
        noteText: `m8b bulk ${i}`, cardType: "qa",
        frontMarkdown: `M8BTEST 负反馈调节 批量卡 ${i} ${"细节内容重复填充以推高token估算，反馈回路使得系统偏离目标值时输出被反向抑制。".repeat(4)}`,
        backMarkdown: "答案", priority: 50, tags: []
      });
    }
    const tiny = db.buildEvidencePackage({ rangeKind: "all", tokenBudget: 800 });
    check("超预算触发裁剪（grounded=false）", tiny.grounded === false, true, tiny.trimmed);
    check("日记 span 恒保留（grounding 最前）", tiny.diarySpans.length === 2, 2, tiny.diarySpans.length);
    check("裁剪到达卡配额下限（floor=10）且标记 trimmed.cards", tiny.cards.length === 10 && tiny.trimmed.cards === true, true, { cards: tiny.cards.length, trimmed: tiny.trimmed });

    console.log("== M8B-5 insight_runs：事实记录 + 反馈只写 runs（永不写 mastery） ==");
    const run = db.createInsightRun({ rangeKind: "30d", entryCount: pkg30.diarySpans.length, entryIds: pkg30.diarySpans.map((s) => s.entryId), evidencePackage: pkg30, promptScope: "journal-insight", promptVersion: 1 });
    check("run 创建为 running", run.status === "running", true, run.status);
    const output = { observation: ["M8BTEST 观察一条"], knowledgeLinks: [], interpretations: [{ claim: "一种可能的解释：M8BTEST", type: "hypothesis", evidence: ["日记原文片段"], confidence: "low" }], alternativeInterpretations: [{ claim: "另一种可能：只是巧合", evidence: [] }], questions: ["M8BTEST 追问？"], uncertainties: ["样本太少"] };
    const done = db.setInsightRunStatus(run.id, "done", { output, tokenUsed: pkg30.tokenEstimated, model: "glm-test", promptVersion: 1 });
    check("完成态 + output 落库", done.status === "done" && done.output.observation.length === 1, true, done.status);
    const f1 = db.setInsightRunFeedback(run.id, { utility: "useful" });
    const f2 = db.setInsightRunFeedback(run.id, { chosenInterpretation: 0 });
    check("反馈合并语义（分次写不互毁）", f2.feedback.utility === "useful" && f2.feedback.chosenInterpretation === 0, true, f2.feedback);
    const f3 = db.setInsightRunFeedback(run.id, { structureVerdict: "rejected:invalid" });
    check("结构定向反馈落表（§4.14-7）", f3.feedback.structureVerdict === "rejected:invalid", true, f3.feedback);
    const runBefore = db.getInsightRun(run.id);
    const card = db.createCard({ noteText: "m8b probe", cardType: "qa", frontMarkdown: "M8BTEST FSRS 探针", backMarkdown: "答案", priority: 50, tags: [] });
    const fsrsSnapshot = db.getCard(card.id).fsrs;
    db.setInsightRunFeedback(run.id, { utility: "irrelevant" });
    db.createInsightRun({ rangeKind: "7d", entryCount: 0, entryIds: [] });
    check("洞察写路径零改卡片 fsrs（§4.12 读侧只读不变量）", eq(db.getCard(card.id).fsrs, fsrsSnapshot), true, "fsrs 未动");
    const listed = db.listInsightRuns({});
    check("列表轻量视图（不含 evidence_package 全文）", listed.runs.every((r) => r.evidencePackage === null), true, "package elided");
    check("列表倒序", listed.runs[0].createdAt >= listed.runs[listed.runs.length - 1].createdAt, true, "desc");
    const full = db.listInsightRuns({ includePackage: true });
    check("includePackage 时可取回快照", full.runs.some((r) => r.evidencePackage && r.id === run.id), true, "package present");
    let threw = false;
    try { db.createInsightRun({ rangeKind: "forever" }); } catch { threw = true; }
    check("未知范围拒绝", threw, true, threw);

    console.log("== M8B-6 Personal Meaning 候选：确认后才成事实 ==");
    let err = null;
    try { db.createPersonalMeaningCandidate({ label: "", kind: "Value" }); } catch (e2) { err = e2; }
    check("空 label 拒绝", err instanceof Error, true, String(err));
    err = null;
    try { db.createPersonalMeaningCandidate({ label: "M8BTEST 自律", kind: "NotAKind" }); } catch (e2) { err = e2; }
    check("未知 kind 拒绝（封闭枚举）", err instanceof Error, true, String(err));
    const pmc = db.createPersonalMeaningCandidate({ label: "M8BTEST 自主性", kind: "Value", sourceInsightRunId: run.id, evidenceRefs: [{ diaryEntryId: pkg30.diarySpans[0].entryId }] });
    check("候选初始 proposed（AI 只提议）", pmc.status === "proposed", true, pmc.status);
    const acc = db.resolvePersonalMeaningCandidate(pmc.id, "accepted");
    check("用户确认后 accepted（成事实，仍只在本表内）", acc.status === "accepted", true, acc.status);
    const pmc2 = db.createPersonalMeaningCandidate({ label: "M8BTEST 探究欲", kind: "Interest" });
    db.resolvePersonalMeaningCandidate(pmc2.id, "rejected");
    const allPmc = db.listPersonalMeaningCandidates({});
    check("列表含决议后候选", allPmc.candidates.length === 2 && allPmc.candidates.some((c) => c.status === "rejected"), true, allPmc.candidates.map((c) => c.status));

    console.log(`\nM8B 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("M8B 测试异常：", err);
    app.exit(1);
  }
});
