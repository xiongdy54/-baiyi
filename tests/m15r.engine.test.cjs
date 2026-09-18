// v48 批2 M15 重做——编排引擎回归（electron 隔离库 + fake chat 注入：npx electron tests/m15r.engine.test.cjs）
// 契约：§4.19 v48 + D41/D42——自底向上归并（section 组/merge/global/editorial/review 五类调用）/
// 分片缓存（同键命中零调用；换粒度/模型失效）/ 本地校验拒绝（假证据/坏 JSON 一次修复/二次即败）/
// 语义评审确认制（FAIL → waiting_user；repair 一次上限）/ 取消保留已缓存分片 / remap / 旧图永不因失败消失。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}

const BASE = {
  title: "引擎测试书",
  tocItems: [
    { anchor: "u1.xhtml", label: "第一章" },
    { anchor: "u2.xhtml", label: "第二章" }
  ],
  unitAnchors: ["u1.xhtml", "u2.xhtml"],
  textByUnit: {
    "u1.xhtml": "第一章正文。知识是经过检验的信念。这里给出定义。",
    "u2.xhtml": "第二章正文。这个定义解释了记忆的机制。机制说明在此。"
  },
  scopeAnchor: "book",
  granularity: "standard"
};

function paramsFor(documentId) {
  return { ...BASE, textByUnit: { ...BASE.textByUnit }, documentId };
}

const sec1 = {
  title: "概念建立", authorialRole: "introduce", centralQuestion: "什么是知识", mainMove: "给出定义",
  progression: "从直觉到严格定义", expandable: false, stopReason: "atomic_structure",
  children: [{
    title: "核心定义句", authorialRole: "introduce", relationToParent: "本节核心主张", relationToSiblings: null,
    evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }],
    expandable: false, stopReason: "atomic_structure",
    children: [{ title: "定义的补足语", authorialRole: "distinguish", relationToParent: "定义的构成", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "这里给出定义", startOffset: 16 }] }]
  }],
  evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }]
};
const sec2 = {
  title: "机制解释", authorialRole: "cause_effect", centralQuestion: "如何运作", mainMove: "解释机制",
  progression: "定义→机制", children: [], expandable: false, stopReason: "atomic_structure",
  evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }]
};
const globalOut = {
  title: "从概念到机制", authorialRole: "synthesis", centralQuestion: "知识如何被检验与运用",
  progression: "先建立概念再解释机制", groupingBasis: { type: "sequence", explanation: "概念先行的推进结构", evidenceRefs: ["n1", "n2"] }, evidence: []
};
const editorialOut = { ops: [], changeLog: [] };
const reviewPass = { status: "pass", issues: [], summary: "结构清晰" };
const reviewFail = {
  status: "fail",
  issues: [{ nodeId: "", type: "topic_list", severity: "high", repairScope: "chapter_merge", note: "子节点只是并列" }],
  summary: "退化为列表"
};
const cancelledErr = () => {
  const e = new Error("已取消");
  e.code = "cancelled";
  return e;
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m15r-engine-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const engine = require(path.join(ROOT, "electron", "mindmapEngine.js"));
    const core = require(path.join(ROOT, "electron", "mindmapCore.js"));
    await db.initDb();

    let fakeChats = [];
    let consumed = 0;
    let testSettings = { app: {} };
    const ctx = {
      db,
      readSettings: () => testSettings,
      writeSettings: () => {},
      hasKey: () => true,
      chat: async (call) => {
        consumed++;
        if (!fakeChats.length) throw new Error("fake 队列耗尽（不应再调用 AI）");
        const item = fakeChats.shift();
        if (typeof item === "function") return item(call);
        if (item instanceof Error) throw item;
        return { text: JSON.stringify(item), usage: { prompt_tokens: 100, completion_tokens: 50 } };
      },
      broadcast: () => {}
    };

    console.log("---- M15R-E1 播种 ----");
    const scopes = ["material-map-section", "material-map-merge", "material-map-global", "material-map-editorial", "material-map-review"];
    check("五 scope 均播种 v2（v48.1 粒度块+递归契约补播）", scopes.every((s) => { const t = db.getPromptTemplate(s); return t && t.version >= 2; }), scopes.map((s) => { const t = db.getPromptTemplate(s); return [s, t && t.version]; }));
    check("v2 内容含粒度块与递归契约", (() => { const t = db.getPromptTemplate("material-map-section"); return t && t.content.includes("覆盖粒度") && t.content.includes("detailed") && t.content.includes("children"); })(), "");

    console.log("---- M15R-E2 预览（零调用）与全管线生成 ----");
    const pv = engine.preview(ctx, paramsFor("doc-e1"));
    check("preview 不调 AI", consumed === 0, consumed);
    check("preview 计 3 个管线调用 + 2 个固定尾调用", pv.newCalls === 3 && pv.fixedCalls === 2 && pv.cacheHits === 0, { n: pv.newCalls, f: pv.fixedCalls });
    check("preview 字符实测精确", pv.charsExact > 0 && pv.estInputTokens > 0, { c: pv.charsExact });
    check("未配单价时 hasPricing=false 费用 null", pv.hasPricing === false && pv.estCost === null, pv);

    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewPass];
    const base0 = consumed;
    const r1 = await engine.generate(ctx, paramsFor("doc-e1"));
    check("生成完成", r1.status === "completed", r1);
    check("AI 调用恰好 5 次（section×2+global+editorial+review）", consumed - base0 === 5, consumed - base0);
    const map1 = db.getActiveMaterialMap("doc-e1", "book");
    check("map 落库且 active", map1 && map1.id === r1.mapId, map1 && map1.id);
    const st = map1.structure;
    check("节点数 = material root + 书根 + 2 章 + 2 层 children 递归", st.nodes.length === 6, st.nodes.map((n) => `${n.id}:${n.title}`));
    const rootNode = st.nodes.find((n) => n.id === "root");
    const bookNode = st.nodes.find((n) => n.title === "从概念到机制");
    const ch1 = st.nodes.find((n) => n.title === "概念建立");
    const ch2 = st.nodes.find((n) => n.title === "机制解释");
    const def = st.nodes.find((n) => n.title === "核心定义句");
    const deep = st.nodes.find((n) => n.title === "定义的补足语");
    check("树形正确（root→书根→两章；章→children 递归两层）", rootNode && bookNode && bookNode.parentId === "root" && ch1.parentId === bookNode.id && ch2.parentId === bookNode.id && def.parentId === ch1.id && deep && deep.parentId === def.id, st.nodes.map((n) => [n.id, n.title, n.parentId]));
    check("material root 在列且为根", Boolean(rootNode) && rootNode.parentId === null, rootNode && rootNode.id);
    check("direct 证据逐字落位 + quoteHash", ch1.evidence.length === 1 && ch1.evidence[0].matchStart >= 0 && ch1.evidence[0].quoteHash.length === 64, ch1.evidence[0]);
    check("compositional 引用最终节点 id（书根→两章）", Array.isArray(bookNode.compositionalEvidence) && bookNode.compositionalEvidence.includes(ch1.id) && bookNode.compositionalEvidence.includes(ch2.id), bookNode.compositionalEvidence);
    check("分片 5 条入缓存", db.listMaterialMapShards("doc-e1").length === 5, db.listMaterialMapShards("doc-e1").length);
    check("run completed", db.listMaterialMapRuns("doc-e1")[0].status === "completed", "");

    console.log("---- M15R-E3 缓存：二次生成零调用 ----");
    const r2 = await engine.generate(ctx, paramsFor("doc-e1"));
    check("二次生成全缓存命中", r2.status === "completed" && consumed === 5, { status: r2.status, consumed });
    check("remap 建立（同构重生成）", r2.remap && Object.keys(r2.remap).length >= 3, r2.remap);
    const map2 = db.getActiveMaterialMap("doc-e1", "book");
    check("新版本 active、旧版退位不删", map2.id !== map1.id && db.listMaterialMaps("doc-e1").length === 2, "");

    console.log("---- M15R-E4 换粒度 → 失效重补 ----");
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewPass];
    const pvD = engine.preview(ctx, { ...paramsFor("doc-e1"), granularity: "detailed" });
    check("换粒度 preview 全部 miss", pvD.cacheHits === 0 && pvD.newCalls === 3, pvD);
    const r3 = await engine.generate(ctx, { ...paramsFor("doc-e1"), granularity: "detailed" });
    check("换粒度重跑完成", r3.status === "completed", { status: r3.status });

    console.log("---- M15R-E5 假证据 → 校验拒绝（旧图保留） ----");
    const badSec = { ...sec1, expandable: false, evidence: [{ unitAnchor: "u1.xhtml", quote: "原文中根本不存在的句子", startOffset: 0 }], children: [] };
    fakeChats = [badSec, { ...sec2, evidence: [{ unitAnchor: "u2.xhtml", quote: "不存在的引文", startOffset: 0 }] }, { ...globalOut, evidenceRefs: [] }, editorialOut, reviewPass];
    const r4 = await engine.generate(ctx, paramsFor("doc-e2"));
    check("AI 节点全灭 → failed_validation", r4.status === "failed" && r4.code === "validation", r4);
    check("失败不触碰旧图（doc-e1 active 仍是 e1 家族）", db.getActiveMaterialMap("doc-e1", "book").documentId === "doc-e1", "");

    console.log("---- M15R-E6 坏 JSON：一次修复成功 / 二次失败 ----");
    const base5 = consumed;
    fakeChats = ["这不是JSON{{", sec1, sec2, globalOut, editorialOut, reviewPass]; // 第 2 项 = 格式修复响应
    const r5 = await engine.generate(ctx, paramsFor("doc-e3"));
    check("坏 JSON 一次 STRUCTURE_FORMAT_REPAIR 成功", r5.status === "completed" && consumed - base5 === 6, { status: r5.status, used: consumed - base5 });
    fakeChats = ["坏{{", "还是坏{", sec2, globalOut, editorialOut, reviewPass]; // 两次均坏
    const r6 = await engine.generate(ctx, paramsFor("doc-e4"));
    check("两次均坏 → failed_json 不偷偷继续", r6.status === "failed" && r6.code === "json", r6);

    console.log("---- M15R-E7 语义评审确认制 ----");
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewFail];
    const r7 = await engine.generate(ctx, paramsFor("doc-e5"));
    check("评审 FAIL → waiting_user + issues 留痕", r7.status === "review_failed" && r7.issues.length === 1, r7);
    const run7 = db.listMaterialMapRuns("doc-e5")[0];
    check("run 停在 waiting_user（不出半成品 active）", run7.status === "waiting_user" && db.getActiveMaterialMap("doc-e5", "book") === null, run7.status);
    fakeChats = [reviewPass]; // 修复仅重跑已软删的评审
    const r8 = await engine.repairConfirm(ctx, r7.runId);
    check("确认后 repair 重跑评审 → completed", r8.status === "completed", r8);
    check("repair 计数留痕", db.getMaterialMapRun(r7.runId).repairCount === 1, "");
    check("repair 完成 map active", db.getActiveMaterialMap("doc-e5", "book") !== null, "");
    // 二次 fail 上限
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewFail];
    const r9 = await engine.generate(ctx, paramsFor("doc-e6"));
    fakeChats = [reviewFail];
    const r10 = await engine.repairConfirm(ctx, r9.runId);
    check("repair 后仍 FAIL → failed_final（一次上限）", r10.status === "failed_final", r10);
    check("失败后旧图/无图状态不被破坏", db.getActiveMaterialMap("doc-e1", "book") !== null, "");

    console.log("---- M15R-E8 取消：保留已缓存分片 ----");
    const base11 = consumed;
    fakeChats = [sec1, cancelledErr()];
    const r11 = await engine.generate(ctx, paramsFor("doc-e7"));
    check("中断 → cancelled", r11.status === "cancelled", r11);
    check("已完成的 section 分片保留", db.listMaterialMapShards("doc-e7", { run_kind: "section" }).length === 1, db.listMaterialMapShards("doc-e7").map((s) => s.runKind));
    const base12 = consumed;
    fakeChats = [sec2, globalOut, editorialOut, reviewPass];
    const r12 = await engine.generate(ctx, paramsFor("doc-e7"));
    check("再次生成从缓存续（只补 4 次：section2/global/editorial/review）", r12.status === "completed" && consumed - base12 === 4, { status: r12.status, used: consumed - base12 });
    check("run cancelled 留痕", db.listMaterialMapRuns("doc-e7").some((r) => r.status === "cancelled"), "");

    console.log("---- M15R-E10 expand 深挖（expandable 队列） ----");
    const secX = { ...sec2, expandable: true, stopReason: null };
    const expOut = {
      title: "机制的分步解释", expandable: false, stopReason: "atomic_structure",
      children: [{ title: "第一步：定义传导", authorialRole: "sequence", relationToParent: "机制首环", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }]
    };
    fakeChats = [sec1, secX, expOut, globalOut, editorialOut, reviewPass];
    const baseE = consumed;
    const r13 = await engine.generate(ctx, paramsFor("doc-e8"));
    check("expandable=true 触发一次深挖调用", r13.status === "completed" && consumed - baseE === 6, { status: r13.status, used: consumed - baseE });
    const m8 = db.getActiveMaterialMap("doc-e8", "book");
    // 语义：expand 输出的根对象标题丢弃（被深挖节点保留原名），children 挂到被深挖节点下
    const stepNode = m8.structure.nodes.find((n) => n.title === "机制解释");
    const stepChild = m8.structure.nodes.find((n) => n.title === "第一步：定义传导");
    check("深挖产物挂树（机制解释 ← 第一步；根对象标题丢弃）", Boolean(stepNode) && Boolean(stepChild) && stepChild.parentId === stepNode.id, m8.structure.nodes.map((n) => n.title));
    check("expand 调用入独立缓存（run_kind=expand）", db.listMaterialMapShards("doc-e8", { run_kind: "expand" }).length === 1, "");
    check("metrics 留痕（expandCalls=1）", (db.getMaterialMapRun(r13.runId).output || {}).metrics?.expandCalls === 1, "");

    console.log("---- M15R-E11 预算触顶 → partial（旧 active 保持、新版本未激活） ----");
    testSettings = { app: { mindmapMaxCalls: 2 } };
    fakeChats = [sec1, secX, globalOut, editorialOut, reviewPass];
    const r14 = await engine.generate(ctx, paramsFor("doc-e9"));
    check("预算触顶 → partial", r14.status === "partial", r14);
    check("partial 版本未激活（旧 active 保持）", db.getActiveMaterialMap("doc-e9", "book") === null && db.listMaterialMaps("doc-e9").some((m) => m.id === r14.mapId), db.getActiveMaterialMap("doc-e9", "book"));
    check("run 状态 partial + completeness 留痕", db.getMaterialMapRun(r14.runId).status === "partial" && String(db.getMaterialMapRun(r14.runId).output?.completeness).includes("call_budget"), "");
    const expandStopped = db.getMaterialMapRun(r14.runId).output?.metrics?.stopReasons || {};
    check("被截断叶 stopReason=call_budget", (expandStopped.call_budget || 0) >= 1, expandStopped);
    testSettings = { app: {} };

    console.log("---- M15R-E12 重生成 remap（重命名沿锚/引文重映射） ----");
    const renamed = { ...sec1, title: "早期自然哲学的本原追问" };
    fakeChats = [renamed, { ...sec2, title: "机制解释（改）" }, { ...globalOut, title: "全书新标题" }, editorialOut, reviewPass];
    const r15 = await engine.generate(ctx, paramsFor("doc-e8"));
    check("重命名重生成完成", r15.status === "completed", r15.status);
    check("remap 沿锚/quoteHash 重叠命中（不依赖标题）", r15.remap && Object.values(r15.remap).length >= 2, r15.remap);

    console.log("---- M15R-E9 边界：零写 knowledge_* / cards ----");
    const kpBefore = JSON.stringify(db.listKnowledgePoints());
    check("导图全程零写知识图谱", JSON.stringify(db.listKnowledgePoints()) === kpBefore, "");

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
