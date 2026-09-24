// F54 跨 frame 正文闸门：把「打开一本书能读到正文」做成真断言
// @runtime: node  @tier: 1  @gui: true  @id: F54  @timeout: 420
// 运行：node tests/flows/f54-reader-content-gate.cjs
//
// 为什么要这一条：F53-F1 已证——既有套件唯一的正文测量 `countOf("p")`（f01:158）是 light-DOM 查询，
// 而 foliate 把正文渲染在**闭式 shadow root 内的沙箱 iframe** 里（F53E 证：点开书时新增两个 file:// 执行上下文）。
// 所以「书能读」这一环从来没有被有效断言过，而且现有量法即使想断言也断言不了。
// 本条用正确的手法量：Page.getFrameTree 列出所有 frame → 每个 frame 建隔离世界 → 逐帧取 innerText。
// 这条既补闸门，也顺带判定 F53 那个「f48 沙箱空白」到底是产品缺陷还是播种产物。
"use strict";
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F54",
  title: "跨 frame 正文闸门",
  angle: "读者真正能看到的正文字符数（穿透沙箱 iframe），并断言关键句在场",
  cites: ["§6.2", "§7.1.4", "§7.1.6"],
  tier: 1,
  gui: true,
});

const SENT_A = "渐进阅读把长文切成可独立回忆的小块";
const SENT_B = "FSRS 是该模型的参数化实现";
const MD =
  "# 闸门章 一\n\n" + SENT_A + "，并为每个小块制作记忆卡片。这一段必须有 60 个字以上才好判断渲染是否真的发生了，" +
  "所以再补一句：如果阅读器空白，用户第一眼看到的就是白屏，这是最不该发生的失败。\n\n" +
  "# 闸门章 二\n\n" + SENT_B + "，它把复习时点交给数据驱动的参数估计，而不是固定的 easiness 因子。\n";

/** 列出所有 frame（含沙箱 iframe），逐帧建隔离世界取 innerText */
async function frameTexts(h) {
  const tree = await h.send("Page.getFrameTree");
  const frames = [];
  const walkTree = (node) => {
    const f = node.frame || node;
    frames.push({ id: f.id, url: String(f.url || "").slice(0, 60) });
    for (const c of node.childFrames || []) walkTree(c);
  };
  if (tree.result && tree.result.frameTree) walkTree(tree.result.frameTree);
  const out = [];
  for (const fr of frames) {
    let text = null;
    let err = null;
    try {
      const w = await h.send("Page.createIsolatedWorld", { frameId: fr.id, worldName: "f54-" + fr.id.slice(0, 8), grantUniveralAccess: true });
      const ctx = w.result && w.result.executionContextId;
      if (ctx == null) throw new Error("无 executionContextId");
      const r = await h.send("Runtime.evaluate", {
        contextId: ctx,
        expression: "JSON.stringify({n:(document.body?document.body.innerText:\"\").length, t:(document.body?document.body.innerText:\"\").replace(/\\s+/g,' ').slice(0,120), p:document.querySelectorAll('p').length})",
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.result && r.result.exceptionDetails) throw new Error(String(r.result.exceptionDetails.text || "").slice(0, 60));
      const j = JSON.parse((r.result && r.result.value) || "{}");
      text = j;
    } catch (e) {
      err = String((e && e.message) || e).slice(0, 80);
    }
    out.push({ ...fr, text, err });
  }
  return out;
}

runFlow(flow, async () => {
  const h = await launch({ label: "f54", port: 9840, fresh: true, logName: path.join(RESULTS_DIR, "f54.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("起一个新鲜沙箱（不与其他流程共用 label 目录）", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Page.enable");
    await h.send("Runtime.enable");
    await h.send("DOM.enable");

    flow.section("R1 用真实 IPC 建一本书");
    const created = await h.evaluate(
      `return window.libraryAPI.createFromPaste("F54 闸门书", ${JSON.stringify(MD)}).then(r=>JSON.stringify({ok:true,id:r&&(r.id||(r.item&&r.item.id))})).catch(e=>'ERR:'+String(e&&e.message||e))`
    );
    flow.record("createFromPaste", String(created.value || created.error));
    await wait(3000);

    flow.section("R2 书架有没有把这本新书显示出来（不导航 vs 导航后）");
    const shelf = (tag) =>
      h
        .evaluate(`return JSON.stringify({书卡数:document.querySelectorAll('.book-card').length,
          含新书:[...document.querySelectorAll('.book-card')].some(e=>/F54 闸门书/.test(e.innerText||'')),
          计数文案:(document.body.innerText.match(/\\d+\\s*本/)||['未见'])[0],
          空态文案:/书架还是空的/.test(document.body.innerText)});`)
        .then((r) => {
          const j = JSON.parse(String(r.value || "{}"));
          flow.record(tag, JSON.stringify(j));
          return j;
        });
    await shelf("建书后 +0s（不导航）");
    await wait(2500);
    const s5 = await shelf("建书后 +2.5s（不导航）");
    await wait(5000);
    const s10 = await shelf("建书后 +7.5s（不导航）");
    // 切走再切回
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='卡片'); if(el) el.click(); return 1;`);
    await wait(1800);
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2600);
    const sNav = await shelf("切到卡片页再切回之后");
    flow.check(
      "新建的书在**不导航**的情况下就该出现在书架上（否则首本书用户会看到「书架还是空的」）",
      s10.含新书 === true,
      "不导航即可见",
      { 不导航7秒: s10, 导航后才有: sNav.含新书 === true && s10.含新书 === false }
    );
    flow.record("若上面为红：这就是「首本书加完仍显示空书架」的复现证据", `${s5.空态文案 ? "空态文案仍在" : "空态已消失"} / 计数「${s10.计数文案}」`);

    const click = await h.evaluate(`
      const cards=[...document.querySelectorAll('.book-card')];
      const t=cards.find(e=>/F54 闸门书/.test(e.innerText||''))||cards[0];
      if(!t) return JSON.stringify({err:'no-card'});
      t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),卡片数:cards.length});`);
    flow.record("落点", String(click.value || click.error));
    const p = JSON.parse(String(click.value || "{}"));
    if (Number.isFinite(p.x)) {
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
      await wait(150);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
    }
    await wait(7000);

    flow.section("R3 逐 frame 取正文（这是 F01 量不到的那一层）");
    const fs1 = await frameTexts(h);
    flow.record("frame 数", fs1.length);
    for (const f of fs1) flow.record("frame", `${f.url || "(空 url)"} → ${f.err ? "读不到:" + f.err : `innerText ${f.text.n} 字 / p ${f.text.p}`}`);
    let total = fs1.reduce((a, f) => a + (f.text && f.text.n ? f.text.n : 0), 0);
    let allText = fs1.map((f) => (f.text && f.text.t ? f.text.t : "")).join(" ⎯ ");

    flow.section("R3b 兜底量法：DOM.getFlattenedDocument({pierce:true}) 一次拿全树");
    const flat = await h.send("DOM.getFlattenedDocument", { depth: -1, pierce: true, includePseudoElements: true });
    const nodes = (flat.result && flat.result.nodes) || [];
    const textNodes = nodes.filter((n) => n.nodeType === 3 && n.nodeValue && n.nodeValue.trim().length > 2);
    const joined = textNodes.map((n) => n.nodeValue.trim()).join(" ");
    const pCount = nodes.filter((n) => n.nodeName === "P").length;
    flow.record("pierce 全树", `节点 ${nodes.length} · 文本节点 ${textNodes.length} · 合计 ${joined.length} 字 · <p> ${pCount} 个`);
    flow.record("pierce 文本样本", joined.slice(0, 200));
    if (joined.length > total) {
      total = joined.length;
      allText = joined.slice(0, 4000);
    }
    flow.record("采用的正文合计", total + " 字");
    await h.shot("f54-reader-open");

    flow.section("R4 判定：正文到底渲染没有");
    flow.check("至少有一个 frame 的 innerText > 120 字（正文真渲染了）", total > 120, ">120 字", total);
    flow.check(`关键句 A 在场：「${SENT_A.slice(0, 12)}…」`, allText.includes(SENT_A.slice(0, 12)), "在场", allText.slice(0, 80));
    flow.check(`关键句 B 在场：「${SENT_B.slice(0, 12)}…」`, allText.includes(SENT_B.slice(0, 12)), "在场", allText.slice(80, 160));
    flow.check("正文里出现 <p> 段落节点（分页器确实建了 DOM）", fs1.some((f) => f.text && f.text.p > 0), "≥1 个 p", fs1.map((f) => (f.text ? f.text.p : -1)));

    flow.section("R5 与 light-DOM 对照（证明 F01 的量法为何永远是 0）");
    const light = await h.evaluate(`return JSON.stringify({p:document.querySelectorAll('p').length, innerText:document.body.innerText.length});`);
    flow.record("light-DOM 读数", String(light.value || light.error));
    const lj = JSON.parse(String(light.value || "{}"));
    flow.record(
      "结论",
      total > 120 && (lj.p || 0) === 0
        ? "正文确实渲染了（跨 frame 读到），而 light-DOM 的 p 计数为 0 ⇒ **F01 的 `countOf(\"p\")` 结构上永远读不到正文**，F53 的空白另有原因（f48 播种沙箱特有），产品渲染路径正常"
        : total > 120
          ? "正文渲染了且 light-DOM 也读得到 ⇒ F53 的空白纯属 f48 播种沙箱问题"
          : "跨 frame 也读不到正文 ⇒ **产品级缺陷**，需要立刻人工确认"
    );
    flow.check("本次差分必须给出可判读的结论（两条分支都算成立，只有读不到才红）", total > 120, "正文可读", { 跨frame: total, lightDOM_p: lj.p });
  } finally {
    await shutdown(h);
  }
});
