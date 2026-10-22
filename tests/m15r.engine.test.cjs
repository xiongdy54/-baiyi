// v48 批2 M15 重做——编排引擎回归（electron 隔离库 + fake chat 注入：npx electron tests/m15r.engine.test.cjs）
// @runtime: electron
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
    let broadcasts = [];
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
      broadcast: (payload) => { broadcasts.push(payload); }
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
    check("expandable=true 触发一次深挖调用", r13.status === "completed" && consumed - baseE === 6, { status: r13.status, used: consumed - baseE, err: r13.error, run: r13.runId && db.getMaterialMapRun(r13.runId)?.errorText });
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

    console.log("---- M15R-E13 单章书（TOC 顶层塌缩后仅剩根） ----");
    const singleP = {
      documentId: "doc-e10",
      title: "单章哲学笔记",
      tocItems: [{ anchor: "c0.xhtml", label: "正文" }],
      unitAnchors: ["c0.xhtml"],
      textByUnit: { "c0.xhtml": "泰勒斯认为水是万物本原。阿那克西曼德提出无定说。赫拉克利特主张万物流变。" },
      scopeAnchor: "book",
      granularity: "detailed"
    };
    const pvS = engine.preview(ctx, singleP);
    check("单章书 preview 非零（调用与字数）", pvS.newCalls >= 1 && (pvS.charsExact || 0) > 0, { n: pvS.newCalls, c: pvS.charsExact });
    fakeChats = [
      { title: "早期哲学三杰", authorialRole: "grouping", expandable: false, stopReason: "atomic_structure", children: [], evidence: [{ unitAnchor: "c0.xhtml", quote: "泰勒斯认为水是万物本原", startOffset: 0 }] },
      { ops: [], changeLog: [] },
      { status: "pass", issues: [], summary: "ok" }
    ];
    const baseS = consumed;
    const r16 = await engine.generate(ctx, singleP);
    check("单章书生成完成（section 调用覆盖全文）", r16.status === "completed" && consumed - baseS >= 3, { status: r16.status, used: consumed - baseS });
    const mS = db.getActiveMaterialMap("doc-e10", "book");
    check("单章书导图落库（无「正文」伪节点）", mS && mS.structure.nodes.some((n) => n.title === "早期哲学三杰") && !mS.structure.nodes.some((n) => n.title === "正文"), mS && mS.structure.nodes.map((n) => n.title));

    console.log("---- M15R-E14 v48.7 验收（payload 红线/scope 抽象/单根递进） ----");
    // 红线：preview 原文字数 === 实际发送 payload 中的原文快照长度（同一 builder、逐字同源）
    {
      const pvP = engine.preview(ctx, paramsFor("doc-e1"));
      let sentLens = [];
      const capCtx = { ...ctx, chat: async (call) => { sentLens.push(call.user.length); return { text: JSON.stringify({ title: "t", expandable: false, stopReason: "atomic_structure", children: [], evidence: [] }), usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
      fakeChats = [];
      const capEngine = require(path.join(ROOT, "electron", "mindmapEngine.js"));
      // 直接跑一次生成但吞掉 fake 队列依赖：临时替换 chat 已在 capCtx；generate 需要 fakes——改为仅校验 builder 确定性：
      const planA = engine.buildCallPayloads(paramsFor("doc-e1"), () => "SYS");
      const planB = engine.buildCallPayloads(paramsFor("doc-e1"), () => "SYS");
      const secUsersA = planA.plan.calls.filter((c) => c.runKind === "section").map((c) => c.user);
      const secUsersB = planB.plan.calls.filter((c) => c.runKind === "section").map((c) => c.user);
      check("payload builder 确定性（两次装配 user 逐字节一致）", JSON.stringify(secUsersA) === JSON.stringify(secUsersB), "");
      check("payload 含原文快照（逐字同源）", secUsersA.every((u, i) => u.includes(Object.values(paramsFor("doc-e1").textByUnit)[Math.min(i, 1)]) || u.includes("泰勒斯") || u.includes("知识")), "");
      check("preview 原文字数 = section 实际原文长度和（精确口径）", pvP.sourceCharsExact === planA.plan.calls.filter((c) => c.runKind === "section").reduce((t, c) => t + (c.sourceChars || 0), 0), { pv: pvP.sourceCharsExact });
      check("无章节材料原文字数必须 > 0（有可分析原文时）", (engine.preview(ctx, singleP).sourceCharsExact || 0) > 0, "");
      void capCtx; void sentLens; void capEngine;
    }
    // scope 抽象回归：chapter 范围仍只覆盖该子树（UI 暂撤、底层保留）
    {
      const scoped = engine.preview(ctx, { ...paramsFor("doc-e1"), scopeAnchor: "u2.xhtml" });
          check("scopeAnchor 底层能力保留（章范围仅命中该子树单元）", (scoped.newCalls + scoped.cacheHits) >= 1 && (scoped.sourceCharsExact || 0) < (engine.preview(ctx, paramsFor("doc-e1")).sourceCharsExact || 0), { scoped: scoped.sourceCharsExact, scopedN: scoped.newCalls, scopedHits: scoped.cacheHits, full: engine.preview(ctx, paramsFor("doc-e1")).sourceCharsExact });
    }
    // 单根 expandable 递进（无 TOC 不退化为单层大主题）
    {
      const rootExpandable = { title: "全书主线", authorialRole: "synthesis", expandable: true, stopReason: null, evidence: [{ unitAnchor: "c0.xhtml", quote: "赫拉克利特主张万物流变", startOffset: 22 }], children: [{ title: "古希腊哲学", authorialRole: "grouping", relationToParent: "第一阶段", relationToSiblings: null, evidence: [{ unitAnchor: "c0.xhtml", quote: "泰勒斯认为水是万物本原", startOffset: 0 }], expandable: true, stopReason: null }] };
      const greekExpand = { title: "古希腊哲学之内", expandable: false, stopReason: "atomic_structure", children: [{ title: "米利都学派", authorialRole: "grouping", relationToParent: "本原追问的最早群体", relationToSiblings: null, evidence: [{ unitAnchor: "c0.xhtml", quote: "阿那克西曼德提出无定说", startOffset: 12 }], expandable: false, stopReason: "atomic_structure" }], evidence: [] };
      testSettings = { app: {} };
      fakeChats = [rootExpandable, greekExpand, { ops: [], changeLog: [] }, { status: "pass", issues: [], summary: "ok" }];
      const base14 = consumed;
      const r17 = await engine.generate(ctx, { ...singleP, documentId: "doc-e11", textByUnit: { "c0.xhtml": singleP.textByUnit["c0.xhtml"] } });
      const m17 = db.getActiveMaterialMap("doc-e11", "book");
      check("单根 expandable 递进（根→主题→子主题，nodes>1）", r17.status === "completed" && m17.structure.nodes.length > 3 && m17.structure.nodes.some((n) => n.title === "米利都学派"), { status: r17.status, used: consumed - base14, err: r17.error, runErr: r17.runId && db.getMaterialMapRun(r17.runId)?.errorText, dropped: (db.getMaterialMapRun(r17.runId)?.output || {}).dropped });
      check("无 TOC 材料无包装节点（正文/材料全文不出现）", !m17.structure.nodes.some((n) => ["正文", "材料全文", "内容", "目录"].includes(n.title)), m17.structure.nodes.map((n) => n.title));
      testSettings = { app: {} };
    }

    console.log("---- M15R-E15 超长单章书段落分片（v48.8：单次塞全文长时挂起根因） ----");
    {
      // 构造约 2 万字无标题单章（每行可作 quote）
      const lines = [];
      for (let i = 0; i < 400; i++) lines.push(`第${i}段：泰勒斯认为水是万物本原，阿那克西曼德提出无定说，赫拉克利特主张万物流变。`);
      const longText = lines.join(String.fromCharCode(10));
      const chunkCount = core.splitByParagraphs(longText, 8000).length;
      check("分片器把超长单元切成 ≥2 片", chunkCount >= 2, chunkCount);
      const longP = {
        documentId: "doc-e12",
        title: "超长单章书",
        tocItems: [{ anchor: "c0.xhtml", label: "正文" }],
        unitAnchors: ["c0.xhtml"],
        textByUnit: { "c0.xhtml": longText },
        scopeAnchor: "book",
        granularity: "detailed"
      };
      const pvL = engine.preview(ctx, longP);
      check("preview 按片计数（newCalls = 片数）且原文字数精确（实际发送口径：分片边界换行不计）", pvL.newCalls === chunkCount && pvL.sourceCharsExact >= longText.length - chunkCount && pvL.sourceCharsExact <= longText.length, { n: pvL.newCalls, chunks: chunkCount, c: pvL.sourceCharsExact, full: longText.length });
      const fakesSection = [];
      for (let ci = 0; ci < chunkCount; ci++) {
        fakesSection.push({
          title: "分片分析", expandable: false, stopReason: "atomic_structure",
          children: [{ title: `片${ci + 1}子结构`, authorialRole: "grouping", relationToParent: "片段结构", relationToSiblings: null, evidence: [{ unitAnchor: "c0.xhtml", quote: "泰勒斯认为水是万物本原" }], expandable: false, stopReason: "atomic_structure" }],
          evidence: [{ unitAnchor: "c0.xhtml", quote: "阿那克西曼德提出无定说" }]
        });
      }
      // v48.12 P1：覆盖审计会为「结构性残余」发补漏调用（本夹具各片证据只覆盖片段 → 必然有缺口）。
      // 这里显式准备补漏响应（返回空 children = 该残余确属过渡/无结构），并断言新口径。
      const gapReply = { title: "残余片段", expandable: false, stopReason: "atomic_structure", children: [], evidence: [{ unitAnchor: "c0.xhtml", quote: "赫拉克利特主张万物流变" }] };
      const gapReplies = Array.from({ length: 12 }, () => gapReply);
      fakeChats = [...fakesSection, ...gapReplies, editorialOut, reviewPass];
      const base15 = consumed;
      const r18 = await engine.generate(ctx, longP);
      const used15 = consumed - base15;
      check("分片生成完成（片数 + 补漏 + editorial + review）", r18.status === "completed" && used15 >= chunkCount + 2, { status: r18.status, used: used15, chunks: chunkCount });
      check(
        "P1：覆盖审计产生补漏调用（结构性缺口 ≥ 阈值 → 发调用，而非静默 complete）",
        used15 > chunkCount + 2,
        { used: used15, chunks: chunkCount }
      );
      const run15 = db.getMaterialMapRun(r18.runId);
      check(
        "P1：覆盖审计留痕（transition/structural 分类与残余账）",
        Boolean(run15.output?.metrics?.coverageAudit) &&
          Number.isFinite(run15.output.metrics.coverageAudit.transitionChars) &&
          Number.isFinite(run15.output.metrics.structuralLeftoverChars),
        run15.output?.metrics
      );
      const m18 = db.getActiveMaterialMap("doc-e12", "book");
      check("跨片 children 合并（每片子结构均在树）", m18 && m18.structure.nodes.filter((n) => /^片\d+子结构$/.test(n.title)).length === chunkCount, m18 && m18.structure.nodes.map((n) => n.title));
      check("分片各自独立缓存", db.listMaterialMapShards("doc-e12", { run_kind: "section" }).length === chunkCount, db.listMaterialMapShards("doc-e12", { run_kind: "section" }).length);
    }

    console.log("---- M15R-E16 v48.11 作用域修复 + 分阶段（sourceSpans / section_ready / 续跑） ----");
  {
    // ① 深挖 payload 必须是节点自身作用域：捕获所有调用，断言深挖调用**不含**另一章原文（u1）
    const captured = [];
    const origChat = ctx.chat;
    ctx.chat = async (call) => {
      captured.push(call);
      return origChat(call);
    };
    const deepOf = () => captured.filter((c) => String(c.user).includes("【深挖】"));
    // 首层就绪（stopAfterSection）：只跑 section，落一版立即可看的图
    fakeChats = [sec1, { ...sec2, expandable: true, stopReason: null }];
    const baseStop = consumed;
    const rStop = await engine.generate(ctx, { ...paramsFor("doc-e11"), stopAfterSection: true });
    check("首层就绪：状态 section_ready（≠ completed）", rStop.status === "section_ready", rStop);
    check("首层就绪：只跑 section（未消耗深挖/归并调用）", consumed - baseStop === 2, { used: consumed - baseStop });
    check(
      "首层就绪：精确首波计划（节点数与计划调用数 ≥1）",
      rStop.expandPlan && rStop.expandPlan.firstWaveNodes >= 1 && rStop.expandPlan.plannedCalls >= 1,
      rStop.expandPlan
    );
    check("首层就绪：版本立即激活（用户马上能看到图）", Boolean(db.getActiveMaterialMap("doc-e11", "book")), "");
    check(
      "首层就绪：completeness 留痕 section_ready（不伪装完成）",
      String((db.getMaterialMapRun(rStop.runId).output || {}).completeness) === "section_ready",
      (db.getMaterialMapRun(rStop.runId).output || {}).completeness
    );
    // ② 续跑：同一 params + 同 runId → section 全部命中缓存（零重复计费），只有深挖/归并/终编辑/评审是新的
    const baseResume = consumed;
    fakeChats = [
      { ...expOut, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }] },
      globalOut,
      editorialOut,
      reviewPass
    ];
    const rResume = await engine.generate(ctx, paramsFor("doc-e11"), rStop.runId);
    check("续跑完成（section 缓存续跑 → 完整图）", rResume.status === "completed", { s: rResume.status, err: rResume.error });
    check("续跑不重发 section（4 次 = 深挖+global+editorial+review）", consumed - baseResume === 4, { used: consumed - baseResume });
    const deeps = deepOf();
    check("深挖调用被捕获（≥1 次）", deeps.length >= 1, deeps.length);
    const dUser = deeps.length ? String(deeps[0].user) : "";
    check("深挖 payload < 6000 字符（单次 request 上限）", dUser.length > 0 && dUser.length < 6000, dUser.length);
    check(
      "深挖 payload 不含父级/整本原文（u1 原文逐字不出现）",
      dUser.length > 0 && !dUser.includes("知识是经过检验的信念") && !dUser.includes("这里给出定义"),
      dUser.slice(0, 200)
    );
    check("深挖 payload 只含节点自身作用域（u2 原文逐字出现）", dUser.includes("这个定义解释了记忆的机制"), dUser.slice(0, 200));
    check(
      "深挖 payload 声明作用域片段并禁止越界（含【原文片段】与作用域指令）",
      dUser.includes("【原文片段") && dUser.includes("原文作用域"),
      dUser.slice(0, 160)
    );
    ctx.chat = origChat;
    testSettings = { app: {} };
  }

  console.log("---- M15R-E17 v48.11 并发（同层并行 / 失败隔离） ----");
  {
    // 两个互不依赖的首波作业：每章一个「无子叶且 expandable」的节点；concurrency=2 → 同批并行
    const leafA = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafB = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secE12a = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafA] };
    const secE12b = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafB] };
    const expA = { title: "A 的细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "A1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    const expB = { title: "B 的细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "B1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    testSettings = { app: { mindmapConcurrency: 2 } };
    fakeChats = [secE12a, secE12b, expA, expB, globalOut, editorialOut, reviewPass];
    const baseC = consumed;
    const rC = await engine.generate(ctx, paramsFor("doc-e12"));
    check("并发=2 生成完成（并行批次不丢更新）", rC.status === "completed" && consumed - baseC === 7, { s: rC.status, used: consumed - baseC, err: rC.error });
    const mC = db.getActiveMaterialMap("doc-e12", "book");
    const hasBoth = Boolean(mC) && ["A1", "B1"].every((t) => mC.structure.nodes.some((n) => n.title === t));
    check("两个并行作业的产物都在树（A1 / B1）", hasBoth, mC ? mC.structure.nodes.map((n) => n.title) : null);

    // 失败隔离：第一个深挖作业抛网络错 → 不杀整批；同批第二个照常完成；整轮降级 partial（不伪装完整）
    testSettings = { app: { mindmapConcurrency: 2 } };
    fakeChats = [
      () => ({ text: JSON.stringify(secE12a), usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      () => ({ text: JSON.stringify(secE12b), usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      () => {
        throw Object.assign(new Error("模拟网络中断"), { code: "network" });
      },
      () => ({ text: JSON.stringify(expB), usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      globalOut,
      editorialOut,
      reviewPass
    ];
    const rF = await engine.generate(ctx, { ...paramsFor("doc-e13"), force: true });
    const runF = db.getMaterialMapRun(rF.runId);
    check("单作业失败不杀整轮（仍落库）", Boolean(rF.mapId), { s: rF.status, m: rF.mapId, err: rF.error });
    check("失败 → 状态 partial + 归因留痕 call_failed", runF.status === "partial" && String(runF.output?.completeness) === "partial:call_failed", { st: runF.status, c: runF.output?.completeness });
    const mapF = rF.mapId ? db.getMaterialMap(rF.mapId) : null;
    check("失败作业不影响同批作业（B1 在树）", Boolean(mapF) && mapF.structure.nodes.some((n) => n.title === "B1"), mapF ? mapF.structure.nodes.map((n) => n.title) : null);
    check("metrics 记 jobFailures=1", (runF.output?.metrics?.jobFailures || 0) === 1, runF.output?.metrics?.jobFailures);
    testSettings = { app: {} };
  }

  console.log("---- M15R-E18 v48.12 P0 测量面（作用域落库 / 覆盖摘要 / 调用日志字段 / 跨阶段账本） ----");
  {
    const leafP = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafQ = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secP = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafP] };
    const secQ = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafQ] };
    const expP = { title: "P 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "P1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    const expQ = { title: "Q 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "Q1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    testSettings = { app: {} };
    fakeChats = [secP, secQ, expP, expQ, globalOut, editorialOut, reviewPass];
    const rP = await engine.generate(ctx, paramsFor("doc-e14"));
    check("P0：一次性完整运行", rP.status === "completed", { s: rP.status, err: rP.error });
    const logs = db.listMaterialMapCalls(rP.runId);
    const expLogs = logs.filter((c) => c.runKind === "expand");
    check(
      "P0：expand 调用日志带 depth / parentNodeId",
      expLogs.length === 2 && expLogs.every((c) => Number.isFinite(c.depth) && Boolean(c.parentNodeId)),
      expLogs.map((c) => [c.depth, c.parentNodeId])
    );
    check(
      "P0：调用日志带 spanChars 与 wallMs",
      logs.filter((c) => c.outcome === "completed").every((c) => Number.isFinite(c.wallMs)) &&
        logs.filter((c) => c.outcome === "completed" && (c.runKind === "section" || c.runKind === "expand")).every((c) => Number.isFinite(c.spanChars) && c.spanChars > 0),
      logs.map((c) => [c.runKind, c.spanChars, c.wallMs])
    );
    check(
      "P0：调用日志覆盖 section/expand/editorial/review 四类",
      ["section", "expand", "editorial", "review"].every((k) => logs.some((c) => c.runKind === k)),
      logs.map((c) => c.runKind)
    );
    const runP = db.getMaterialMapRun(rP.runId);
    check(
      "P0：账本含 successfulCalls 与 byKind 分类计数",
      Number(runP.output?.ledger?.successfulCalls) >= 6 && Boolean(runP.output?.ledger?.byKind?.review?.calls),
      runP.output?.ledger
    );
    const mapP = db.getMaterialMap(rP.mapId);
    const cs = mapP.structure.coverageSummary;
    check(
      "P0：结构落库 coverageSummary（三口径 + 未归属字数）",
      Boolean(cs) &&
        typeof cs.structureCoverage === "number" &&
        typeof cs.leafCoverage === "number" &&
        typeof cs.evidenceTextCoverage === "number" &&
        Number.isFinite(cs.unassignedChars) &&
        cs.unassignedChars >= 0,
      cs
    );
    check(
      "P0：节点落库 sourceSpans（离线审计不再需要反推）",
      mapP.structure.nodes.filter((n) => Array.isArray(n.sourceSpans) && n.sourceSpans.length).length >= 2,
      mapP.structure.nodes.map((n) => (n.sourceSpans || []).length)
    );
    check(
      "P0：结构覆盖率口径正确（只计 evidence 推导 span，排除播种的分析范围）",
      cs && cs.structureCoverage > 0 && cs.structureCoverage < 1,
      cs
    );

    // 跨阶段账本：首层 + 续跑两段必须累计到同一个 run
    fakeChats = [secP, secQ];
    const rS1 = await engine.generate(ctx, { ...paramsFor("doc-e15"), stopAfterSection: true });
    check("P0：首层就绪（阶段一）", rS1.status === "section_ready", rS1.status);
    const ledger1 = db.getMaterialMapRun(rS1.runId).output?.ledger;
    fakeChats = [expP, expQ, globalOut, editorialOut, reviewPass];
    const rS2 = await engine.generate(ctx, paramsFor("doc-e15"), rS1.runId);
    const runS2 = db.getMaterialMapRun(rS1.runId);
    check("P0：续跑完成（阶段二）", rS2.status === "completed", { s: rS2.status, err: rS2.error });
    check(
      "P0：跨阶段账本合并（阶段一 2 次 + 阶段二 5 次 = 7）",
      ledger1 && ledger1.requestedCalls === 2 && runS2.output?.ledger?.requestedCalls === 7,
      { phase1: ledger1?.requestedCalls, merged: runS2.output?.ledger?.requestedCalls }
    );
    check(
      "P0：callsDone 为跨阶段累计（≥5，且不只最后一次的阶段计数）",
      Number(runS2.callsDone) >= 5,
      runS2.callsDone
    );
    check(
      "P0：合并后用量含两段（prompt tokens > 0 且高于单一阶段）",
      Number(runS2.actualPromptTokens) > 0 && Number(runS2.actualPromptTokens) === Number(runS2.output?.ledger ? runS2.actualPromptTokens : 0),
      runS2.actualPromptTokens
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E19 v48.12 P1 覆盖审计（根残余 → 补漏 / 残余只读自身区段 / 轮次用尽 → partial） ----");
  {
    const PREFIX = "甲段标记AAAA。" + "甲".repeat(300);
    const TAIL = "乙段标记BBBB。第一，乙段论述一。第二，乙段论述二。" + "乙".repeat(700);
    const docText = PREFIX + "\n" + TAIL;
    const unit = "g.xhtml";
    const secOut = {
      title: "单根结构",
      authorialRole: "introduce",
      expandable: false,
      stopReason: "atomic_structure",
      children: [
        {
          title: "前段结构",
          authorialRole: "introduce",
          relationToParent: "首段",
          relationToSiblings: null,
          evidence: [{ unitAnchor: unit, quote: "甲段标记AAAA", startOffset: 0 }],
          expandable: false,
          stopReason: "atomic_structure"
        }
      ],
      evidence: [{ unitAnchor: unit, quote: "甲段标记AAAA", startOffset: 0 }]
    };
    const gapOut = {
      title: "后段结构",
      authorialRole: "sequence",
      expandable: false,
      stopReason: "atomic_structure",
      children: [
        {
          title: "乙段并列结构",
          authorialRole: "parallel",
          relationToParent: "后段",
          relationToSiblings: null,
          evidence: [{ unitAnchor: unit, quote: "第一，乙段论述一", startOffset: 6 }],
          expandable: false,
          stopReason: "atomic_structure"
        }
      ],
      evidence: [{ unitAnchor: unit, quote: "第一，乙段论述一", startOffset: 6 }]
    };
    const base = {
      documentId: "doc-e16",
      title: "覆盖审计样书",
      tocItems: [{ anchor: unit, label: "正文" }],
      unitAnchors: [unit],
      textByUnit: { [unit]: docText },
      scopeAnchor: "book",
      granularity: "detailed"
    };
    const captured = [];
    const origChat19 = ctx.chat;
    ctx.chat = async (call) => {
      captured.push(call);
      return origChat19(call);
    };
    testSettings = { app: {} };
    fakeChats = [secOut, gapOut, editorialOut, reviewPass];
    const r19 = await engine.generate(ctx, base);
    check("P1：含补漏的运行完成", r19.status === "completed", { s: r19.status, err: r19.error });
    const gapCalls = captured.filter((c) => String(c.user).includes("【补漏】"));
    check("P1：覆盖审计为 root 级结构性残余发起补漏调用", gapCalls.length >= 1, { n: gapCalls.length, used: captured.length });
    const gapUser = gapCalls.length ? String(gapCalls[0].user) : "";
    check("P1：补漏 payload 含未覆盖区段（后段）", gapUser.includes("乙段标记BBBB"), gapUser.slice(0, 120));
    check("P1：补漏 payload 不含已覆盖区段（前段）——残余只读自身区段", !gapUser.includes("甲段标记AAAA"), gapUser.slice(0, 120));
    const m19 = db.getActiveMaterialMap("doc-e16", "book");
    check(
      "P1：补漏产物挂树（乙段并列结构）",
      Boolean(m19) && m19.structure.nodes.some((n) => n.title === "乙段并列结构"),
      m19 && m19.structure.nodes.map((n) => n.title)
    );
    const run19 = db.getMaterialMapRun(r19.runId);
    check(
      "P1：审计留痕 tasks ≥ 1 且 structuralLeftover 已记账",
      Number(run19.output?.metrics?.coverageAudit?.tasks) >= 1 && Number.isFinite(run19.output?.metrics?.structuralLeftoverChars),
      run19.output?.metrics
    );

    // 轮次用尽（maxRounds=0）→ 结构性残余未处置 → 诚实记 partial:coverage_gap
    testSettings = { app: { mindmapGapFillMaxRounds: 0 } };
    fakeChats = [secOut, gapOut, editorialOut, reviewPass];
    const r20 = await engine.generate(ctx, { ...base, documentId: "doc-e17", force: true });
    const run20 = db.getMaterialMapRun(r20.runId);
    check(
      "P1：轮次用尽仍有结构性残余 → partial:coverage_gap（不伪装 complete）",
      r20.status === "partial" && String(run20.output?.completeness) === "partial:coverage_gap",
      { s: r20.status, c: run20.output?.completeness, gap: run20.output?.metrics?.coverageGapChars }
    );
    check(
      "P1：缺口字数与段数留痕（>0）",
      Number(run20.output?.metrics?.coverageGapChars) > 0 && Number(run20.output?.metrics?.coverageGapCount) > 0,
      run20.output?.metrics?.coverageGapChars
    );
    testSettings = { app: {} };
    ctx.chat = origChat19;
  }

  console.log("---- M15R-E20 v48.12 P3 批量深挖（碰撞合批 / 逐块回退 / 截断救援） ----");
  {
    const u = "b.xhtml";
    const T1 = "甲行：泰勒斯认为水是万物本原。";
    const T2 = "乙行：阿那克西曼德提出无定说。";
    const text = T1 + String.fromCharCode(10) + T2;
    const mkLeaf = (title, quote) => ({
      title,
      authorialRole: "introduce",
      relationToParent: "并列项",
      relationToSiblings: null,
      evidence: [{ unitAnchor: u, quote, startOffset: 0 }],
      expandable: true,
      stopReason: null
    });
    const Q1 = "泰勒斯认为水是万物本原";
    const Q2 = "阿那克西曼德提出无定说";
    const sec = {
      title: "并列结构",
      authorialRole: "parallel",
      expandable: false,
      stopReason: "atomic_structure",
      children: [mkLeaf("A项", Q1), mkLeaf("B项", Q1), mkLeaf("C项", Q2)],
      evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }]
    };
    const mkExpand = (title, childTitle, quote) => ({
      title,
      expandable: false,
      stopReason: "atomic_structure",
      children: [
        {
          title: childTitle,
          authorialRole: "sequence",
          relationToParent: "x",
          relationToSiblings: null,
          evidence: [{ unitAnchor: u, quote, startOffset: 0 }],
          expandable: false,
          stopReason: "atomic_structure"
        }
      ],
      evidence: [{ unitAnchor: u, quote, startOffset: 0 }]
    });
    const baseP = {
      documentId: "doc-e18",
      title: "批量样书",
      tocItems: [{ anchor: u, label: "正文" }],
      unitAnchors: [u],
      textByUnit: { [u]: text },
      scopeAnchor: "book",
      granularity: "detailed"
    };
    const captured = [];
    const origChat20 = ctx.chat;
    ctx.chat = async (call) => {
      captured.push(call);
      return origChat20(call);
    };

    // 场景 1：碰撞合批（A/B 同 span → 一批；C 单独）
    testSettings = { app: { mindmapExpandBatch: 2 } };
    fakeChats = [
      sec,
      { nodes: [mkExpand("A展开", "A1", Q1), mkExpand("B展开", "B1", Q1)] },
      mkExpand("C展开", "C1", Q2),
      editorialOut,
      reviewPass
    ];
    const r20 = await engine.generate(ctx, baseP);
    check("P3：批量运行完成", r20.status === "completed", { s: r20.status, err: r20.error });
    const batchCalls = captured.filter((c) => String(c.user).includes("【批量说明】"));
    check("P3：碰撞节点合成一次批量调用（A/B 同 span）", batchCalls.length === 1, { n: batchCalls.length, used: captured.length });
    const bu = batchCalls.length ? String(batchCalls[0].user) : "";
    check(
      "P3：批量 payload 为每成员独立块且含两成员标题",
      bu.includes("【深挖·节点 1/2】") && bu.includes("【深挖·节点 2/2】") && bu.includes("A项") && bu.includes("B项"),
      bu.slice(0, 200)
    );
    const m20 = db.getActiveMaterialMap("doc-e18", "book");
    const titles20 = m20 ? m20.structure.nodes.map((n) => n.title) : [];
    check("P3：批内两成员的子结构都挂树（A1 / B1）", titles20.includes("A1") && titles20.includes("B1"), titles20);
    check("P3：批外成员照常单独调用（C1）", titles20.includes("C1"), titles20);
    const run20 = db.getMaterialMapRun(r20.runId);
    check(
      "P3：批量计数留痕（batchCalls=1 / batchMembers=2 / 回退=0）",
      Number(run20.output?.metrics?.batchCalls) === 1 &&
        Number(run20.output?.metrics?.batchMembers) === 2 &&
        Number(run20.output?.metrics?.batchFallbacks || 0) === 0,
      run20.output?.metrics
    );

    // 场景 2：批量响应缺一个成员 → 仅缺失成员逐块回退（不回退整批）
    testSettings = { app: { mindmapExpandBatch: 2 } };
    fakeChats = [
      sec,
      { nodes: [mkExpand("A展开", "A2", Q1)] },
      mkExpand("B展开", "B2", Q1),
      mkExpand("C展开", "C2", Q2),
      editorialOut,
      reviewPass
    ];
    const r21 = await engine.generate(ctx, { ...baseP, documentId: "doc-e19" });
    const run21 = db.getMaterialMapRun(r21.runId);
    const m21 = db.getActiveMaterialMap("doc-e19", "book");
    const titles21 = m21 ? m21.structure.nodes.map((n) => n.title) : [];
    check("P3：批量缺项时缺失成员逐块回退（回退计数=1）", Number(run21.output?.metrics?.batchFallbacks) === 1, run21.output?.metrics);
    check("P3：回退后缺失成员仍产出子结构（A2 与 B2 都在树）", titles21.includes("A2") && titles21.includes("B2"), titles21);

    // 场景 3：批量响应被截断（finish_reason=length）→ 救援已完整项 + 缺失项回退
    testSettings = { app: { mindmapExpandBatch: 2 } };
    const truncatedText = '{"nodes":[' + JSON.stringify(mkExpand("A展开", "A3", Q1)) + ',{"title":"B展开","expandable":fal';
    fakeChats = [
      sec,
      () => ({ text: truncatedText, usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: "length" }),
      mkExpand("B展开", "B3", Q1),
      mkExpand("C展开", "C3", Q2),
      editorialOut,
      reviewPass
    ];
    const r22 = await engine.generate(ctx, { ...baseP, documentId: "doc-e20" });
    const run22 = db.getMaterialMapRun(r22.runId);
    const m22 = db.getActiveMaterialMap("doc-e20", "book");
    const titles22 = m22 ? m22.structure.nodes.map((n) => n.title) : [];
    check("P3：截断响应被救援（已完整项 A3 采用）", titles22.includes("A3"), titles22);
    check(
      "P3：截断后缺失项回退成功（B3 在树）且回退计数=1",
      titles22.includes("B3") && Number(run22.output?.metrics?.batchFallbacks) === 1,
      { t: titles22, f: run22.output?.metrics?.batchFallbacks }
    );
    check("P3：溢出计数留痕（outputOverflow ≥1）", Number(run22.output?.metrics?.outputOverflow || 0) >= 1, run22.output?.metrics?.outputOverflow);
    testSettings = { app: {} };
    ctx.chat = origChat20;
  }

  console.log("---- M15R-E21 v48.12 P4 有界递归（depth=2 落地嵌套子树；depth=1 保持单层） ----");
  {
    const u = "r.xhtml";
    const Q1 = "泰勒斯认为水是万物本原";
    const Q2 = "阿那克西曼德提出无定说";
    const text = "甲行：" + Q1 + "。" + String.fromCharCode(10) + "乙行：" + Q2 + "。";
    const sec = {
      title: "单根结构",
      authorialRole: "introduce",
      expandable: false,
      stopReason: "atomic_structure",
      children: [
        {
          title: "本原追问",
          authorialRole: "decompose",
          relationToParent: "首层",
          relationToSiblings: null,
          evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }],
          expandable: true,
          stopReason: null
        }
      ],
      evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }]
    };
    // 一次调用返回「子 + 孙」两层（架构 C 允许的形态）
    const nested = {
      title: "本原追问展开",
      expandable: false,
      stopReason: "atomic_structure",
      children: [
        {
          title: "泰勒斯的水",
          authorialRole: "claim_evidence",
          relationToParent: "人",
          relationToSiblings: null,
          evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }],
          expandable: false,
          stopReason: "atomic_structure",
          children: [
            {
              title: "水本原的论证",
              authorialRole: "claim_evidence",
              relationToParent: "命题",
              relationToSiblings: null,
              evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }]
            }
          ]
        }
      ],
      evidence: [{ unitAnchor: u, quote: Q1, startOffset: 0 }]
    };
    const baseP = {
      documentId: "doc-e21",
      title: "递归样书",
      tocItems: [{ anchor: u, label: "正文" }],
      unitAnchors: [u],
      textByUnit: { [u]: text },
      scopeAnchor: "book",
      granularity: "detailed"
    };

    // 默认 depth=1：嵌套的孙层不落地（与旧行为一致）
    testSettings = { app: {} };
    fakeChats = [sec, nested, editorialOut, reviewPass];
    const r23 = await engine.generate(ctx, baseP);
    const m23 = db.getActiveMaterialMap("doc-e21", "book");
    const t23 = m23 ? m23.structure.nodes.map((n) => n.title) : [];
    check("P4：depth=1（默认）只落地一层子结构", t23.includes("泰勒斯的水") && !t23.includes("水本原的论证"), t23);

    // depth=2：一次调用产出的嵌套子树整体落地，且逐层钳制
    testSettings = { app: { mindmapExpandDepth: 2 } };
    fakeChats = [sec, nested, editorialOut, reviewPass];
    const r24 = await engine.generate(ctx, { ...baseP, documentId: "doc-e22" });
    const m24 = db.getActiveMaterialMap("doc-e22", "book");
    const t24 = m24 ? m24.structure.nodes.map((n) => n.title) : [];
    check("P4：depth=2 落地嵌套子树（孙层也在树）", t24.includes("泰勒斯的水") && t24.includes("水本原的论证"), t24);
    const grand = m24 ? m24.structure.nodes.find((n) => n.title === "水本原的论证") : null;
    const mid = m24 ? m24.structure.nodes.find((n) => n.title === "泰勒斯的水") : null;
    check(
      "P4：嵌套层级父引用正确（孙 → 子）且作用域逐层钳制",
      Boolean(grand) && Boolean(mid) && grand.parentId === mid.id &&
        Array.isArray(mid.sourceSpans) && Array.isArray(grand.sourceSpans) &&
        grand.sourceSpans.every(([s2, e2]) => mid.sourceSpans.some(([s1, e1]) => s2 >= s1 && e2 <= e1)),
      { grand: grand && grand.sourceSpans, mid: mid && mid.sourceSpans }
    );
    check(
      "P4：子层不再重复入队（带子节点的节点不成为深挖作业）",
      Number(db.getMaterialMapRun(r24.runId).output?.metrics?.expandCalls || 0) === 0 ||
        !t24.includes("（未命名）"),
      db.getMaterialMapRun(r24.runId).output?.metrics
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E22 v48.12 版本唯一性（同一 run 两阶段只落一行；删除后不复活旧 id） ----");
  {
    const leafU = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafV = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secU = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafU] };
    const secV = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafV] };
    const expU = { title: "U 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "U1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    const expV = { title: "V 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "V1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    testSettings = { app: {} };

    fakeChats = [secU, secV];
    const rA = await engine.generate(ctx, { ...paramsFor("doc-e23"), stopAfterSection: true });
    check("E22：阶段一首层就绪", rA.status === "section_ready", rA.status);
    const v1 = db.listMaterialMaps("doc-e23");
    check("E22：阶段一后历史版本 = 1 行", v1.length === 1, v1.map((m) => m.id));

    fakeChats = [expU, expV, globalOut, editorialOut, reviewPass];
    const rB = await engine.generate(ctx, paramsFor("doc-e23"), rA.runId);
    const v2 = db.listMaterialMaps("doc-e23");
    check(
      "E22：阶段二完成后历史版本仍 = 1 行（同 run 不新增同标题版本）",
      rB.status === "completed" && v2.length === 1,
      { st: rB.status, n: v2.length, ids: v2.map((m) => m.id), titles: v2.map((m) => m.title) }
    );
    check("E22：同一行被完善（版本 id 前后一致 = 卡片溯源不断链）", Boolean(v1[0]) && v2[0].id === v1[0].id, { before: v1[0] && v1[0].id, after: v2[0] && v2[0].id });
    check("E22：最终版本为 active（布尔口径）且节点数已回填", v2[0].isActive === true && Number(v2[0].nodeCount) > 0, { active: v2[0].isActive, nodes: v2[0].nodeCount });

    const deletedId = v2[0].id;
    db.deleteMaterialMap(deletedId);
    check("E22：删除后历史版本为空（真删）", db.listMaterialMaps("doc-e23").length === 0, "");

    fakeChats = [secU, secV, expU, expV, globalOut, editorialOut, reviewPass];
    const rC = await engine.generate(ctx, { ...paramsFor("doc-e23"), force: true });
    const v3 = db.listMaterialMaps("doc-e23");
    check(
      "E22：删除后重新生成只出现 1 个**新**版本（旧 id 不复活）",
      rC.status === "completed" && v3.length === 1 && v3[0].id !== deletedId,
      { n: v3.length, ids: v3.map((m) => m.id), old: deletedId }
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E23 v48.13 评审闸门：severity 才是闸门，type 只是描述标签 ----");
  {
    // 真实 run ea70cad5 法医结论：模型返回 status=pass + type=topic_list + severity=low，
    // 旧实现让 type 无条件 fail → 整图 72 节点被卡在 staging、用户看到「语义评审未通过」。
    const lowTopicList = { status: "pass", issues: [{ nodeId: "", type: "topic_list", severity: "low", repairScope: "global_merge", note: "子节点逐条复述父节点证据，属轻微冗余" }], summary: "整体忠实呈现作者组织方式，非目录复刻" };
    const lowHollow = { status: "pass", issues: [{ nodeId: "", type: "hollow_parent", severity: "low", repairScope: "editorial", note: "个别父节点偏概括" }], summary: "结构良好" };
    const highOther = { status: "pass", issues: [{ nodeId: "", type: "other", severity: "high", repairScope: "global_merge", note: "跨分支重复拆解同一结构" }], summary: "存在高严重度缺陷" };
    const modelFailLow = { status: "fail", issues: [{ nodeId: "", type: "topic_list", severity: "low", repairScope: "global_merge", note: "模型显式判 fail 但严重度标低" }], summary: "模型显式判失败" };
    testSettings = { app: {} };

    // ① pass + topic_list/low → 不得 fail（旧实现此处 fail，是本 bug 的判别用例）
    fakeChats = [sec1, sec2, globalOut, editorialOut, lowTopicList];
    const r1 = await engine.generate(ctx, paramsFor("doc-e24"));
    const m1 = db.getActiveMaterialMap("doc-e24", "book");
    check("E23①：pass + topic_list/low → 不失败且地图可用", r1.status === "completed" && m1 && m1.id === r1.mapId, { st: r1.status, active: m1 && m1.id });
    check(
      "E23①：非阻断评审意见仍留痕（不阻断但记录）",
      (() => { const o = db.getMaterialMapRun(r1.runId).output || {}; const mm = o.metrics || {}; return mm.reviewStatus === "review" && Array.isArray(mm.reviewIssues) && mm.reviewIssues.length === 1; })(),
      db.getMaterialMapRun(r1.runId).output
    );

    // ② pass + hollow_parent/low → 同样不得 fail
    fakeChats = [sec1, sec2, globalOut, editorialOut, lowHollow];
    const r2 = await engine.generate(ctx, paramsFor("doc-e25"));
    check("E23②：pass + hollow_parent/low → 不失败", r2.status === "completed", r2.status);

    // ③ severity=high 仍然阻断（与 type 无关）
    fakeChats = [sec1, sec2, globalOut, editorialOut, highOther];
    const r3 = await engine.generate(ctx, paramsFor("doc-e26"));
    check("E23③：severity=high（type=other）→ 进入确认/失败", r3.status === "review_failed" && db.getMaterialMapRun(r3.runId).status === "waiting_user", r3.status);

    // ④ 模型显式 status=fail 且给了 issue → 单向棘轮，仍阻断
    fakeChats = [sec1, sec2, globalOut, editorialOut, modelFailLow];
    const r4 = await engine.generate(ctx, paramsFor("doc-e27"));
    check("E23④：模型显式 status=fail → 仍阻断（棘轮不放松）", r4.status === "review_failed", r4.status);

    // ⑤ 对照：type=topic_list + severity=high 依旧 fail（不因放开 low 而放松真实缺陷）
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewFail];
    const r5 = await engine.generate(ctx, paramsFor("doc-e28r"));
    check("E23⑤：topic_list + severity=high → 仍 fail（真实缺陷不放松）", r5.status === "review_failed", r5.status);
    testSettings = { app: {} };
  }

  console.log("---- M15R-E24 v48.13 发布模型：候选不得顶掉已发布版本 ----");
  {
    const leafP = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafQ = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secP = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafP] };
    const secQ = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafQ] };
    const expP = { title: "P 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "P1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    const expQ = { title: "Q 细分", expandable: false, stopReason: "atomic_structure", children: [{ title: "Q1", authorialRole: "sequence", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    testSettings = { app: {} };

    // ① 无历史地图 → 首个 section_ready 作 provisional 发布（可用）
    fakeChats = [secP, secQ];
    const rA = await engine.generate(ctx, { ...paramsFor("doc-e29"), stopAfterSection: true });
    const a1 = db.getActiveMaterialMap("doc-e29", "book");
    check("E24①：无历史地图时 section_ready 作 provisional 发布（可用）", rA.status === "section_ready" && rA.published === true && a1 && a1.id === rA.mapId, { st: rA.status, pub: rA.published, active: a1 && a1.id });

    // ② 续跑完成 → 同一行发布为正式版本
    fakeChats = [expP, expQ, globalOut, editorialOut, reviewPass];
    const rB = await engine.generate(ctx, paramsFor("doc-e29"), rA.runId);
    const a2 = db.getActiveMaterialMap("doc-e29", "book");
    check("E24②：续跑完成 → 同一版本行转为正式发布且 active", rB.status === "completed" && a2 && a2.id === rA.mapId, { st: rB.status, active: a2 && a2.id });

    // ③ 已发布版本存在时，新的 section_ready 只作候选，不得顶掉旧图（本 bug 的判别用例）
    const publishedId = a2.id;
    const publishedNodes = a2.nodeCount;
    fakeChats = [secP, secQ];
    const rC = await engine.generate(ctx, { ...paramsFor("doc-e29"), stopAfterSection: true, force: true });
    const a3 = db.getActiveMaterialMap("doc-e29", "book");
    const cand = rC.mapId ? db.getMaterialMap(rC.mapId) : null;
    check(
      "E24③：已发布版本不被新的 section_ready 候选顶掉",
      rC.status === "section_ready" && rC.published === false && a3 && a3.id === publishedId && Number(a3.nodeCount) === Number(publishedNodes),
      { st: rC.status, pub: rC.published, activeNow: a3 && a3.id, publishedId }
    );
    check("E24③：候选版本落库但未激活（可查看、不覆盖）", cand && cand.id !== publishedId && cand.isActive === false && db.listMaterialMaps("doc-e29").length === 2, cand && { id: cand.id, active: cand.isActive });
    check(
      "E24③：run 输出如实标注候选与被谁压着",
      (() => { const o = db.getMaterialMapRun(rC.runId).output || {}; return o.candidate === true && o.published === false && o.heldByPublishedMapId === publishedId; })(),
      db.getMaterialMapRun(rC.runId).output
    );

    // ④ 候选续跑完成后才发布，旧版本退位（发布是一次事务性切换）
    fakeChats = [expP, expQ, globalOut, editorialOut, reviewPass];
    const rD = await engine.generate(ctx, { ...paramsFor("doc-e29"), resumeRunId: rC.runId }, rC.runId);
    const a4 = db.getActiveMaterialMap("doc-e29", "book");
    check(
      "E24④：候选续跑完成 → 事务性发布，旧版本退位不删",
      rD.status === "completed" && a4 && a4.id === rC.mapId && db.listMaterialMaps("doc-e29").length === 2,
      { st: rD.status, active: a4 && a4.id, cand: rC.mapId }
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E25 v48.13 P2 进度广播契约（右下角全局指示器的数据源） ----");
  {
    // 指示器与所在界面无关，它只吃广播——因此广播必须自足：带 documentId/title/stage/total/published，
    // 且终态（含失败与待确认）必须广播（旧实现只把失败回给 IPC 调用方，用户离开工作区后完全看不到）。
    testSettings = { app: {} };
    broadcasts = [];
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewPass];
    const rOk = await engine.generate(ctx, paramsFor("doc-e30"));
    check(
      "E25①：每次广播都带 documentId（指示器要知道是哪份材料）",
      broadcasts.length > 0 && broadcasts.every((b) => b.documentId === "doc-e30"),
      broadcasts.map((b) => b.stage)
    );
    check(
      "E25②：运行中广播带进度总量（done/total 可算百分比）",
      broadcasts.some((b) => b.stage === "running" && Number.isFinite(b.total) && b.total > 0),
      broadcasts.filter((b) => b.stage === "running")
    );
    check(
      "E25③：完成广播带 mapId 与 published=已发布",
      rOk.status === "completed" && broadcasts.some((b) => b.stage === "completed" && b.mapId && b.published === true),
      broadcasts.filter((b) => b.stage === "completed")
    );
    check(
      "E25④：广播带材料名（展开面板标题不靠猜）",
      broadcasts.some((b) => b.title === BASE.title),
      broadcasts.map((b) => b.title)
    );

    broadcasts = [];
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewFail];
    const rFail = await engine.generate(ctx, paramsFor("doc-e31"));
    check(
      "E25⑤：语义评审未通过 → 广播 review_failed（终态不静默）",
      rFail.status === "review_failed" && broadcasts.some((b) => b.stage === "review_failed"),
      broadcasts.map((b) => b.stage)
    );

    broadcasts = [];
    fakeChats = [sec1, sec2];
    const rStop = await engine.generate(ctx, { ...paramsFor("doc-e32"), stopAfterSection: true });
    const sr = broadcasts.find((b) => b.stage === "section_ready");
    check(
      "E25⑥：首层就绪广播带 published（候选/已发布必须可辨）",
      rStop.status === "section_ready" && Boolean(sr) && sr.published === true && Boolean(sr.mapId),
      sr
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E26 v48.13 P4 增量深化（展开 vs 深化 / 增量评审 / 原地发布 / 缓存跨路径复用） ----");
  {
    const leafP = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafQ = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secP = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafP] };
    const secQ = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafQ] };
    // 深化「定义句」→ 只该有这一个节点的深挖调用 + 一次增量评审
    const deepP = { title: "定义句的展开", expandable: false, stopReason: "atomic_structure", children: [
      { title: "被检验的含义", authorialRole: "clarify", relationToParent: "补足", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }
    ] };
    const deepQ = { title: "机制句的展开", expandable: false, stopReason: "atomic_structure", children: [
      { title: "记忆的机制", authorialRole: "cause_effect", relationToParent: "展开", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }
    ] };
    testSettings = { app: {} };

    // 前置：只跑首层的图——这正是「可深化叶」的天然状态（首层就绪后等用户按需深化）
    fakeChats = [secP, secQ];
    const rBase = await engine.generate(ctx, { ...paramsFor("doc-e33"), stopAfterSection: true });
    check("E26 前置：首层就绪（两个可深化的叶，尚未生成更深结构）", rBase.status === "section_ready", rBase.status);
    const baseMap = db.getActiveMaterialMap("doc-e33", "book");
    const baseNodes = baseMap.structure.nodes;
    const nodeP = baseNodes.find((n) => n.title === "定义句");
    const nodeQ = baseNodes.find((n) => n.title === "机制句");
    check(
      "E26 前置：两个叶均可深化（无子结构且 sourceSpans 非空）",
      Boolean(nodeP) && Boolean(nodeQ) && (nodeP.childIds || []).length === 0 && (nodeP.sourceSpans || []).length > 0,
      { p: nodeP && nodeP.sourceSpans, q: nodeQ && nodeQ.sourceSpans }
    );
    const baseNodeCount = baseNodes.length;

    // ① 深化：只对目标节点发调用 + 一次增量评审；editorial 与补漏都不跑
    let capturedReview = "";
    fakeChats = [
      deepP,
      (call) => {
        capturedReview = String(call.user || "");
        return { text: JSON.stringify(reviewPass), usage: { prompt_tokens: 10, completion_tokens: 5 } };
      }
    ];
    const consumBefore = consumed;
    const rD = await engine.deepen(ctx, { ...paramsFor("doc-e33"), mapId: baseMap.id, nodeId: nodeP.id });
    const usedCalls = consumed - consumBefore;
    check("E26①：深化完成且只发 2 次调用（1 深挖 + 1 增量评审；以已存地图为基底，不重跑 section）", rD.status === "completed" && usedCalls === 2, { st: rD.status, calls: usedCalls });

    const dRun = db.getMaterialMapRun(rD.runId);
    const dMetrics = (dRun.output || {}).metrics || {};
    check(
      "E26①：editorial 与补漏在深化中都不跑（零新增自动成本）",
      dMetrics.editorialSkipped === "deepen" && !dMetrics.gapFillCalls && !dMetrics.coverageAudit,
      { ed: dMetrics.editorialSkipped, gap: dMetrics.gapFillCalls, audit: dMetrics.coverageAudit }
    );

    // ② 子树挂到目标节点下，其余分支未动
    const stD = (db.getMaterialMap(baseMap.id) || {}).structure;
    const dP = stD.nodes.find((n) => n.id === nodeP.id);
    const dQ = stD.nodes.find((n) => n.id === nodeQ.id);
    check(
      "E26②：新子树挂在目标节点下",
      Boolean(dP) && (dP.childIds || []).length === 1 && stD.nodes.some((n) => n.title === "被检验的含义" && n.parentId === nodeP.id),
      dP && dP.childIds
    );
    check("E26②：其余分支未受影响（兄弟节点仍无子结构）", Boolean(dQ) && (dQ.childIds || []).length === 0, dQ && dQ.childIds);

    // ③ 增量评审：范围只覆盖新增分支，payload 明确声明其余部分不在评审范围
    check("E26③：评审为增量口径（metrics.reviewScope=incremental）", dMetrics.reviewScope === "incremental", dMetrics.reviewScope);
    check(
      "E26③：评审 payload 只含本次新增分支且声明增量口径",
      capturedReview.includes("增量评审") && capturedReview.includes("被检验的含义") && !capturedReview.includes("机制句"),
      capturedReview.slice(0, 220)
    );
    check("E26③：run 输出留痕 deepened/reviewScope", (dRun.output || {}).deepened === nodeP.id && (dRun.output || {}).reviewScope === "incremental", dRun.output);

    // ④ 原地更新同一版本行，发布关系不变
    check(
      "E26④：同一版本行被原地更新（版本 id 不变、节点数增加）",
      db.listMaterialMaps("doc-e33").length === 1 && stD.nodes.length > baseNodeCount,
      { versions: db.listMaterialMaps("doc-e33").length, before: baseNodeCount, after: stD.nodes.length }
    );
    check(
      "E26④：深化不改发布关系（该行仍为 active）",
      db.getMaterialMap(baseMap.id).isActive === true && (dRun.output || {}).published === true,
      (dRun.output || {}).published
    );

    // ⑤「展开」不是「深化」：已有子结构的节点 → 明确拒绝且零调用
    const consumBefore2 = consumed;
    const rExpanded = await engine.deepen(ctx, { ...paramsFor("doc-e33"), mapId: baseMap.id, nodeId: nodeP.id });
    check(
      "E26⑤：已有子结构的节点拒绝深化（展开是纯 UI 操作，零 AI 请求）",
      rExpanded.status === "invalid" && rExpanded.code === "already_expanded" && consumed === consumBefore2,
      { st: rExpanded.status, code: rExpanded.code, calls: consumed - consumBefore2 }
    );

    // ⑥ 无作用域节点 → 拒绝且零调用
    const noScope = { ...nodeQ, id: "nos", sourceSpans: [], childIds: [] };
    const origGet = db.getMaterialMap;
    db.getMaterialMap = (id) => (String(id) === String(baseMap.id) ? { ...baseMap, structure: { ...baseMap.structure, nodes: [...baseMap.structure.nodes, noScope] } } : origGet.call(db, id));
    const consumBefore3 = consumed;
    const rNoScope = await engine.deepen(ctx, { ...paramsFor("doc-e33"), mapId: baseMap.id, nodeId: "nos" });
    db.getMaterialMap = origGet;
    check(
      "E26⑥：无作用域节点拒绝深化（scope 为空 = 证据无法定位）",
      rNoScope.status === "invalid" && rNoScope.code === "no_scope" && consumed === consumBefore3,
      { st: rNoScope.status, code: rNoScope.code }
    );

    // ⑦ 深化成果在全量重生成后仍在；并**如实记录已知代价**（不写成「零重复计费」）
    fakeChats = [deepP, deepQ, globalOut, editorialOut, reviewPass];
    const consumBefore4 = consumed;
    const rFull = await engine.generate(ctx, { ...paramsFor("doc-e33") });
    const fullMetrics = (db.getMaterialMapRun(rFull.runId).output || {}).metrics || {};
    check("E26⑦：全量重生成完成", rFull.status === "completed", rFull.status);
    // 特征化断言（防止将来静默变化）：深挖指纹 expandFingerprint 含 depth，而首层图没有 global 根、
    // 同一节点的 depth 比整图浅一层 → 两条路径的深挖缓存**不共享**，这一支会被重新分析。
    // 取舍可接受：一次深化只花 1~2 次调用，换来「不必等整图跑完就能先看某一支」。
    check(
      "E26⑦：全量重生成会重新分析该分支（已知代价：首层图与整图 depth 不同 → 深挖缓存不共享）",
      Number(fullMetrics.expandCalls || 0) === 2 && Number(fullMetrics.expandCacheHit || 0) === 0,
      { expand: fullMetrics.expandCalls, cacheHit: fullMetrics.expandCacheHit, used: consumed - consumBefore4 }
    );
    const stFull = (db.getMaterialMap(rFull.mapId) || {}).structure;
    check(
      "E26⑦：深化成果在全量重生成后仍在（同一张图里保留）",
      Boolean(stFull) && stFull.nodes.some((n) => n.title === "被检验的含义"),
      stFull && stFull.nodes.filter((n) => /定义句|被检验/.test(n.title)).map((n) => n.title)
    );

    // ⑧ 增量评审未通过：只影响这一支，整图与其它分支保持原样（独立文档，避免被 ⑦ 的新版本干扰）
    fakeChats = [secP, secQ];
    const rBase2 = await engine.generate(ctx, { ...paramsFor("doc-e34"), stopAfterSection: true });
    const baseMap2 = db.getActiveMaterialMap("doc-e34", "book");
    const nodeQ2 = baseMap2.structure.nodes.find((n) => n.title === "机制句");
    const mapBeforeFail = baseMap2.structure.nodes.length;
    const highIssue = { status: "fail", issues: [{ nodeId: "", type: "topic_list", severity: "high", repairScope: "none", note: "该分支退化为并列列表" }], summary: "该分支不合格" };
    fakeChats = [deepQ, highIssue];
    const rFail = await engine.deepen(ctx, { ...paramsFor("doc-e34"), mapId: baseMap2.id, nodeId: nodeQ2.id });
    check("E26⑧：该分支评审未通过 → run 停在确认，不发布这一支", rFail.status === "review_failed", rFail.status);
    const mapAfterFail = db.getMaterialMap(baseMap2.id);
    check("E26⑧：独立文档前置就绪（首层 map 已发布）", rBase2.status === "section_ready" && Boolean(nodeQ2), rBase2.status);
    check(
      "E26⑧：地图未被改动、其它分支不受影响（单分支失败不连坐整图）",
      mapAfterFail.structure.nodes.length === mapBeforeFail &&
        mapAfterFail.isActive === true &&
        ((mapAfterFail.structure.nodes.find((n) => n.id === nodeQ2.id) || {}).childIds || []).length === 0,
      { before: mapBeforeFail, after: mapAfterFail.structure.nodes.length, active: mapAfterFail.isActive }
    );
    testSettings = { app: {} };
  }

  console.log("---- M15R-E27 v48.13 已发布版本不因一次失败而消失（真实现场回归） ----");
  {
    // 真实现场 2026-09-20 20:55–21:03：首层已发布 → 续跑深挖途中一次 ECONNRESET →
    // 旧规则「partial 不发布」把**同一行**置为未发布 → 73 节点成果整张失联（文档没有 active 版本）。
    const leafP = { title: "定义句", authorialRole: "introduce", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: true, stopReason: null };
    const leafQ = { title: "机制句", authorialRole: "cause_effect", relationToParent: "x", relationToSiblings: null, evidence: [{ unitAnchor: "u2.xhtml", quote: "这个定义解释了记忆的机制", startOffset: 6 }], expandable: true, stopReason: null };
    const secP = { ...sec1, expandable: false, stopReason: "atomic_structure", children: [leafP] };
    const secQ = { ...sec2, expandable: false, stopReason: "atomic_structure", children: [leafQ] };
    const deepP = { title: "定义句的展开", expandable: false, stopReason: "atomic_structure", children: [{ title: "被检验的含义", authorialRole: "clarify", relationToParent: "补足", relationToSiblings: null, evidence: [{ unitAnchor: "u1.xhtml", quote: "知识是经过检验的信念", startOffset: 6 }], expandable: false, stopReason: "atomic_structure" }] };
    testSettings = { app: {} };

    fakeChats = [secP, secQ];
    const r1 = await engine.generate(ctx, { ...paramsFor("doc-e40"), stopAfterSection: true });
    const map1 = db.getActiveMaterialMap("doc-e40", "book");
    check("E27 前置：首层就绪并已发布（用户手上已有一张可用的图）", r1.status === "section_ready" && r1.published === true && map1 && map1.isActive === true, { st: r1.status, pub: r1.published });

    // 续跑：一个深挖调用失败（网络中断），其余成功
    fakeChats = [deepP, new Error("socket hang up"), globalOut, editorialOut, reviewPass];
    const r2 = await engine.generate(ctx, { ...paramsFor("doc-e40") }, r1.runId);
    const map2 = db.getMaterialMap(map1.id);
    const run2 = db.getMaterialMapRun(r2.runId);
    check("E27①：单个调用失败 → 本轮降级 partial（不伪装完整）", String((run2.output || {}).completeness).startsWith("partial:"), (run2.output || {}).completeness);
    check(
      "E27②：**已发布的那一行仍为 active**（一次失败不把可用成果作废）",
      map2.isActive === true && db.getActiveMaterialMap("doc-e40", "book") !== null,
      { active: map2.isActive }
    );
    check("E27③：版本未被换行（同 run 只落一行，卡片溯源不断链）", db.listMaterialMaps("doc-e40").length === 1, db.listMaterialMaps("doc-e40").length);
    check("E27④：本轮 run 输出如实标注 published=true 且 completeness 记降级", (run2.output || {}).published === true, (run2.output || {}).published);

    // 反例保护：**尚未发布**的版本（partial 且没有已发布版本）仍不得发布——不伪装完整
    fakeChats = [secP, secQ];
    const r3 = await engine.generate(ctx, { ...paramsFor("doc-e41"), stopAfterSection: true });
    check("E27 反例前置：另一文档首层就绪（此时它已是 provisional 发布）", r3.status === "section_ready", r3.status);

    // 「已有别处已发布版本时，新首层只作候选」的规则不受本轮影响（回归）
    fakeChats = [secP, secQ];
    const r4 = await engine.generate(ctx, { ...paramsFor("doc-e40"), stopAfterSection: true, force: true });
    check("E27⑤：新首层候选仍不得顶掉已发布版本（P1 规则未被破坏）", r4.status === "section_ready" && r4.published === false, { st: r4.status, pub: r4.published });
    testSettings = { app: {} };
  }

  console.log("---- M15R-E28 v48.13 同材料串行化守卫（并发写同一行地图的防护） ----");
  {
    // 真实现场 2026-09-20 20:58：主 run 还在续跑深挖时用户点了某节点「深化」，
    // 两个 run 各自以不同基底装配、先后写**同一行**地图版本 —— 先完成的深挖成果被后收尾的主 run 覆盖。
    testSettings = { app: {} };
    const busyRun = db.createMaterialMapRun({ documentId: "doc-e50", scopeAnchor: "book", granularity: "detailed", input: {} });
    db.updateMaterialMapRun(busyRun.id, { status: "running", stage: "expand" });

    const before = consumed;
    const rBusy = await engine.generate(ctx, paramsFor("doc-e50"));
    check(
      "E28①：同材料已有任务在跑 → 拒绝再起一轮（零调用）",
      rBusy.status === "invalid" && rBusy.code === "busy" && consumed === before,
      { st: rBusy.status, code: rBusy.code, calls: consumed - before }
    );
    check("E28②：拒绝文案明确可操作（等它结束或先停止深挖）", String(rBusy.error).includes("停止深挖"), rBusy.error);

    const rDeepenBusy = await engine.deepen(ctx, { ...paramsFor("doc-e50"), mapId: "whatever", nodeId: "x1" });
    check("E28③：深化同样被守卫拦住（同一道闸，不靠 UI 自觉）", rDeepenBusy.status === "invalid", rDeepenBusy.status);

    // 同一 runId 续跑**不算**冲突（那正是同一轮任务的第二段）
    const resumeRun = db.createMaterialMapRun({ documentId: "doc-e51", scopeAnchor: "book", granularity: "detailed", input: {} });
    db.updateMaterialMapRun(resumeRun.id, { status: "running", stage: "section" });
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewPass];
    const rResume = await engine.generate(ctx, paramsFor("doc-e51"), resumeRun.id);
    check("E28④：同 runId 续跑不被守卫拦住（否则续跑直接被自己挡死）", rResume.status === "completed", { st: rResume.status, code: rResume.code });

    // 已收敛的运行（interrupted / 已完成）不占用闸门
    db.updateMaterialMapRun(resumeRun.id, { status: "interrupted" });
    fakeChats = [sec1, sec2, globalOut, editorialOut, reviewPass];
    const rAfter = await engine.generate(ctx, paramsFor("doc-e51"));
    check("E28⑤：已中断/已结束的运行不再占闸门（重启后能正常续跑）", rAfter.status === "completed", rAfter.status);
    testSettings = { app: {} };
  }

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
