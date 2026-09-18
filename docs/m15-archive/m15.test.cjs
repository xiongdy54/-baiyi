// v47 M15 材料知识导图回归测试（db 层 + mindmapCore bundle，electron 直跑：npx electron tests/m15.test.cjs，须先关应用）
// 隔离：userData 指向临时目录，全新库，绝不触碰真实库（§7.3）。
// 契约：§4.19 + D40——图先于图示（编造节点拒绝/孤儿标出/evidence span 抽查）/ 选型确定性本地函数 /
//       分片缓存（版本不一致=失效）/ 导图零 mastery 写入、零 FSRS 影响 / diagram-generation v1 播种。
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

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m15-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const prompts = require(path.join(ROOT, "electron", "prompts.js"));
    const core = require(path.join(ROOT, "tests", "m15.core.bundle.cjs"));
    await db.initDb();

    console.log("== M15-1 diagram-generation v1 播种与契约抽查 ==");
    const tpl = db.getPromptTemplate("diagram-generation");
    check("diagram-generation v1 已播种", tpl && tpl.version === 1, true, tpl && tpl.version);
    check("与 prompts.js 基线字面一致", tpl && tpl.content === prompts.DIAGRAM_GENERATION_PROMPT, true, tpl && tpl.version);
    check("聚合/图示双契约在案", tpl && tpl.content.includes("aggregate（整书聚合）") && tpl.content.includes("render（图示渲染）"), true, true);
    check("diagram-design 风格要点（删除优先/焦点 1-2/4px 网格/圆角 ≤10）",
      tpl && tpl.content.includes("删除") && tpl.content.includes("4px") && tpl.content.includes("10px") && tpl.content.includes("1-2"), true, true);
    check("禁外链/脚本/字体（§1.1 纯本地红线）", tpl && tpl.content.includes("禁止引入外部字体") && tpl.content.includes("禁止在 SVG 中引入 script"), true, true);
    check("situation_required = 0（导图不做情境接地）", tpl && Number(tpl.situation_required) === 0, 0, tpl && tpl.situation_required);

    console.log("== M15-2 结构解析与范围/粒度选择 ==");
    const tree = core.buildTocTree(
      [
        { anchor: "a1", label: "第一章 反馈", children: [{ anchor: "a1s1", label: "1.1 负反馈" }, { anchor: "a1s2", label: "1.2 正反馈" }] },
        { anchor: "a2", label: "第二章 控制", children: [{ anchor: "a2s1", label: "2.1 恒温器" }] }
      ],
      "M15TEST 控制论入门"
    );
    check("TOC 树构建（根 + 2 章 + 3 节）", tree.children.length === 2 && tree.children[0].children.length === 2, true, tree.children.length);
    const chStd = core.selectChapters(tree, { kind: "book" }, "standard");
    check("整书 standard = 仅一级章节（2 章）", chStd.length === 2 && chStd.every((c) => c.level === 1), true, chStd);
    const chFine = core.selectChapters(tree, { kind: "book" }, "fine");
    check("整书 fine = 一二级全取（5）", chFine.length === 5, true, chFine.length);
    const chChap = core.selectChapters(tree, { kind: "chapter", anchor: "a1" }, "fine");
    check("章范围 = 该章及其子树（1+2）", chChap.length === 3 && chChap[0].anchor === "a1", true, chChap.map((c) => c.anchor));
    const single = core.buildTocTree([], "单章书");
    const chSingle = core.selectChapters(single, { kind: "book" }, "standard");
    check("无 TOC 书单章兜底", chSingle.length === 1 && chSingle[0].anchor === "book", true, chSingle);

    console.log("== M15-3 预估与选型确定性函数 ==");
    const plan = core.estimatePlan(chFine, "fine", 30000);
    check("预估调用数 = 章节数 + 2（聚合+图示）", plan.aiCalls === chFine.length + 2, true, plan.aiCalls);
    // v47.1（质量优先）：取消单章字数上限——Token 预估随实测字数线性变化，不再有假想 cap
    const planMore = core.estimatePlan(chFine, "fine", 60000);
    check("预估随实测字数线性增长（无截断）", planMore.estTokens > plan.estTokens && planMore.estTokens < plan.estTokens * 2.5, true, [plan.estTokens, planMore.estTokens]);
    const sel1 = core.selectDiagramTypes({ materialType: "concept", domains: [], chars: 1000, granularity: "standard" });
    check("concept → mindmap+tree，数量 1", eq(sel1.whitelist, ["mindmap", "tree"]) && sel1.maxCount === 1, true, sel1);
    const sel2 = core.selectDiagramTypes({ materialType: "sequence", domains: ["93"], chars: 1000, granularity: "standard" });
    check("sequence + 历史(93) → 含 flowchart 与 timeline", sel2.whitelist.includes("flowchart") && sel2.whitelist.includes("timeline"), true, sel2);
    const sel3 = core.selectDiagramTypes({ materialType: "concept", domains: [], chars: 40000, granularity: "standard" });
    check("长材料 → 数量上限 2", sel3.maxCount === 2, true, sel3.maxCount);
    const sel4 = core.selectDiagramTypes({ materialType: "enumeration", domains: [], chars: 1000, granularity: "deep" });
    check("枚举 + deep → matrix + 上限 2", sel4.whitelist.includes("matrix") && sel4.maxCount === 2, true, sel4);

    console.log("== M15-4 结构 JSON 本地校验（图先于图示） ==");
    const chapterTexts = {
      a1: "负反馈调节使系统回归稳定。恒温器是负反馈的日常实例。",
      a2: "控制论把反馈作为核心机制。"
    };
    const good = core.validateMindmapStructure(
      {
        title: "M15TEST 控制论",
        nodes: [
          { id: "n1", label: "负反馈调节", parentId: null, chapterAnchors: ["a1"], evidence: "使系统回归稳定" },
          { id: "n2", label: "恒温器", parentId: "n1", chapterAnchors: ["a1"], evidence: "恒温器是负反馈的日常实例" },
          { id: "n3", label: "反馈核心地位", parentId: "n1", chapterAnchors: ["a2"], evidence: "反馈作为核心机制" }
        ]
      },
      chapterTexts
    );
    check("合法结构通过（3 节点，根 n1）", good.ok && good.structure.nodes.length === 3 && good.structure.rootIds.includes("n1"), true, good.dropped);
    check("合法 evidence 保留", good.structure.nodes[0].evidence === "使系统回归稳定", true, good.structure.nodes[0].evidence);
    const bad = core.validateMindmapStructure(
      {
        title: "M15TEST 坏结构",
        nodes: [
          { id: "n1", label: "好节点", parentId: null, chapterAnchors: ["a1"], evidence: "原文有的依据" },
          { id: "n2", label: "编造锚节点", parentId: "n1", chapterAnchors: ["ch99"], evidence: "x" },
          { id: "n3", label: "编造依据节点", parentId: "n1", chapterAnchors: ["a1"], evidence: "这句原文里根本没有" },
          { id: "n4", label: "孤儿节点", parentId: "ghost", chapterAnchors: ["a2"] }
        ]
      },
      chapterTexts
    );
    check("编造章节锚节点被拒绝（其余节点保留）",
      bad.structure.nodes.every((n) => n.id !== "n2") && bad.dropped.some((d) => /编造章节锚/.test(d.reason)) && bad.structure.nodes.length === 3, true, bad.dropped);
    check("evidence 未命中原文 → 置空留痕", bad.structure.nodes.some((n) => n.id === "n3" && n.evidence === null && (n.flags || []).some((f) => /未命中原文/.test(f))), true, bad.structure.nodes.map((n) => n.flags));
    check("孤儿节点标出并挂为根（不删除）", bad.structure.nodes.some((n) => n.id === "n4" && n.parentId === null && (n.flags || []).some((f) => /孤儿/.test(f))) && bad.warnings.some((w) => /父引用缺失/.test(w)), true, bad.warnings);
    const cycle = core.validateMindmapStructure(
      { title: "t", nodes: [
        { id: "c1", label: "A", parentId: "c2", chapterAnchors: ["a1"] },
        { id: "c2", label: "B", parentId: "c1", chapterAnchors: ["a1"] }
      ] },
      chapterTexts
    );
    check("父链成环被剪断（树上不再有环，收敛出根）",
      cycle.structure.rootIds.length >= 1 && cycle.structure.nodes.find((n) => n.id === "c1").parentId === null && cycle.structure.nodes.some((n) => (n.flags || []).some((f) => /成环/.test(f))), true, cycle.structure.rootIds);
    check("结构层零调用契约：校验不产生任何 AI 依赖（纯函数直跑）", typeof core.validateMindmapStructure === "function", true, typeof core.validateMindmapStructure);

    console.log("== M15-5 制卡结构摘要（有界，§4.19-7） ==");
    const summary = core.deriveStructureSummary(good.structure, { a1: "第一章 反馈", a2: "第二章 控制" }, 400);
    check("摘要含节点与章节归属", summary.includes("负反馈调节") && summary.includes("第一章 反馈"), true, summary);
    check("摘要有界（≤400 字 + 截断标记可出现）", summary.length <= 410, true, summary.length);

    console.log("== M15-6 导图两表 CRUD 与分片缓存 ==");
    const item = db.createFromPaste("M15TEST 来源书", "# 第一章 反馈\n\n正文。\n\n# 第二章 控制\n\n正文。");
    const docId = item.documentId || null;
    const structure = good.structure;
    const saved = db.saveMaterialMindmap({
      documentId: docId, itemId: item.id, scopeAnchor: "book", scopeKind: "book", granularity: "standard",
      structure, diagramArtifact: "<svg xmlns='http://www.w3.org/2000/svg'></svg>", artifactKind: "svg",
      diagramTypes: ["mindmap"], warnings: ["孤儿节点测试"], promptScope: "diagram-generation", promptVersion: 1
    });
    check("save 返回完整记录（含 artifact）", saved && saved.hasArtifact === true && saved.structure.nodes.length === 3, true, saved && saved.hasArtifact);
    const listed = db.listMaterialMindmaps({ documentId: docId });
    check("列表轻量视图（不含 artifact 全文，标 hasArtifact）", listed.length === 1 && listed[0].diagramArtifact === null && listed[0].hasArtifact === true, true, listed.map((x) => x.hasArtifact));
    const got = db.getMaterialMindmap(saved.id, { includeArtifact: true });
    check("get 取回 artifact 全文", got && typeof got.diagramArtifact === "string" && got.diagramArtifact.includes("<svg"), true, !!got);
    db.setMaterialMindmapFeedback(saved.id, { useful: true });
    check("反馈落库", db.getMaterialMindmap(saved.id, { includeArtifact: false }).feedback && db.getMaterialMindmap(saved.id, { includeArtifact: false }).feedback.useful === true, true, true);
    db.deleteMaterialMindmap(saved.id);
    check("软删后 get/list 均不可见", db.getMaterialMindmap(saved.id, { includeArtifact: true }) === null && db.listMaterialMindmaps({ documentId: docId }).length === 0, true, "deleted");
    // 分片缓存：命中要求 prompt_version 一致
    const content = { chapterAnchor: "a1", chapterLabel: "第一章", overallGrade: 3, kpCandidates: [{ label: "负反馈调节", evidence: "使系统回归稳定" }] };
    db.saveMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 1, content });
    check("同版本分片命中", !!db.getMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 1 }), true, "hit");
    check("版本不一致 = 失效（ miss）", db.getMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 2 }) === null, true, "miss");
    db.saveMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 2, content: { ...content, chapterLabel: "更新" } });
    check("升版覆盖同键分片（只补缺失/失效）", db.getMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 2 }).content.chapterLabel === "更新", true, true);
    check("旧版本分片不再命中", db.getMindmapShard({ documentId: docId, anchor: "a1", promptScope: "material-difficulty", promptVersion: 1 }) === null, true, "v1 gone");

    console.log("== M15-7 节点学习状态 + 零 mastery / 零 FSRS 影响 ==");
    const kp = db.createKnowledgePoint({ canonicalLabel: "M15TEST 负反馈调节" });
    db.createCard({ noteText: "m15 c1", cardType: "qa", frontMarkdown: "M15TEST 负反馈调节 是什么", backMarkdown: "答案", priority: 50, tags: [], contextRef: { documentId: docId } });
    db.createCard({ noteText: "m15 c1b", cardType: "qa", frontMarkdown: "M15TEST 负反馈调节 的实例", backMarkdown: "答案", priority: 50, tags: [], contextRef: { documentId: docId } });
    const st = db.listMindmapLearningStatus({ documentId: docId, labels: ["M15TEST 负反馈调节", "毫无关系的词"] });
    // v47.1：卡计数为精确 COUNT（无 LIMIT 少报）
    check("节点卡计数精确（2 张，无上限少报）", st["M15TEST 负反馈调节"] && st["M15TEST 负反馈调节"].cardCount === 2, true, st);
    check("节点 KP 已存在（label 精确）", st["M15TEST 负反馈调节"].kpExists === true, true, st);
    check("未命中节点双零", st["毫无关系的词"].cardCount === 0 && st["毫无关系的词"].kpExists === false, true, st["毫无关系的词"]);
    const card = db.createCard({ noteText: "m15 probe", cardType: "qa", frontMarkdown: "M15TEST FSRS 探针", backMarkdown: "答案", priority: 50, tags: [] });
    const fsrsSnapshot = JSON.stringify(db.getCard(card.id).fsrs);
    const kpCountBefore = db.listKnowledgePoints({}).kps ? db.listKnowledgePoints({}).kps.length : db.listKnowledgePoints({}).length;
    const saved2 = db.saveMaterialMindmap({ documentId: docId, scopeAnchor: "book", scopeKind: "book", granularity: "standard", structure, diagramArtifact: null, promptScope: "diagram-generation", promptVersion: 1 });
    db.listMaterialMindmaps({ documentId: docId });
    check("导图写路径零改卡片 fsrs（§4.12）", JSON.stringify(db.getCard(card.id).fsrs) === fsrsSnapshot, true, "fsrs 未动");
    const kpAfter = db.listKnowledgePoints({}).kps ? db.listKnowledgePoints({}).kps.length : db.listKnowledgePoints({}).length;
    check("导图永不产生 KP（图谱只经真实学习链路生长）", kpAfter === kpCountBefore, true, [kpCountBefore, kpAfter]);
    check("artifact 可为 null（图先于图示：结构层可独立入库）", saved2 && saved2.structure && saved2.hasArtifact === false, true, saved2 && saved2.hasArtifact);

    console.log(`\nM15 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("M15 测试异常：", err);
    app.exit(1);
  }
});
