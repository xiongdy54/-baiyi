// F53D 用 CDP pierce 穿透闭式 shadow root，判定阅读器正文到底有没有渲染
// @runtime: node  @tier: 1  @gui: true  @id: F53D  @timeout: 300
// 运行：node tests/flows/f53d-pierce-probe.cjs
//
// 为什么要这一条：F53/F53C 用 light-DOM 探针读不到正文（textContent 只有工具条那 8 个字），
// 但 F44 已证 foliate-js 用**闭式 shadow root**（vendor/foliate-js/view.js:215），JS 侧看不见它。
// CDP 的 DOM.getDocument({pierce:true}) 走的是后端节点树，**闭式影子根也照穿**。
// 于是这条能一刀切开两种解释：① 正文渲染在闭式影子根里（产品没问题，是我的探针瞎）；② 真的没渲染（P0）。
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F53D",
  title: "pierce 穿透判定阅读器正文",
  angle: "闭式 shadow root 里的文本只有 CDP 后端树看得见",
  cites: ["§6.2", "§7.1.4"],
  tier: 1,
  gui: true,
});

function walk(node, out, depth) {
  out.nodes++;
  if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) {
    out.textLen += node.nodeValue.trim().length;
    if (out.samples.length < 6 && node.nodeValue.trim().length > 4) out.samples.push(node.nodeValue.trim().slice(0, 26));
  }
  if (node.nodeType === 1) {
    const nm = (node.nodeName || "").toLowerCase();
    if (nm === "p" || nm === "h1" || nm === "h2" || nm === "li" || nm === "td") out.blockTags++;
    if (node.shadowRoots && node.shadowRoots.length) out.shadowHosts++;
  }
  for (const c of node.children || []) walk(c, out, depth + 1);
  for (const c of node.pseudoElements || []) walk(c, out, depth + 1);
  return out;
}

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9800, fresh: false, logName: path.join(RESULTS_DIR, "f53d.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("DOM.enable");
    await h.send("Runtime.enable");

    const base = { nodes: 0, textLen: 0, blockTags: 0, shadowHosts: 0, samples: [] };
    const dump = async (tag) => {
      const doc = await h.send("DOM.getDocument", { depth: -1, pierce: true });
      const out = walk(doc.result.root, { ...base }, 0);
      flow.record(`pierce ${tag}`, `节点 ${out.nodes} · 文本 ${out.textLen} 字 · 段落级标签 ${out.blockTags} · 影子宿主 ${out.shadowHosts}`);
      if (out.samples.length) flow.record(`pierce ${tag} 文本样本`, out.samples.join(" ▏"));
      return out;
    };

    flow.section("P1 未点书时的基线");
    const b0 = await dump("书架基线");

    flow.section("P2 真实鼠标点开第一本书");
    const click = await h.evaluate(`
      const cards=[...document.querySelectorAll('.book-card')];
      if(!cards.length) return 'none';
      const t=cards[0]; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),n:cards.length,标题:(t.innerText||'').trim().slice(0,18)});`);
    flow.record("落点", String(click.value || click.error));
    const p = JSON.parse(String(click.value || "{}"));
    if (Number.isFinite(p.x)) {
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
      await wait(150);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
    }
    await wait(6000);
    const b1 = await dump("点开后");
    await h.shot("f53d-after-open");

    flow.section("P3 判定");
    flow.record("增量", JSON.stringify({ 节点: b1.nodes - b0.nodes, 文本字: b1.textLen - b0.textLen, 段落标签: b1.blockTags - b0.blockTags, 影子宿主: b1.shadowHosts - b0.shadowHosts }));
    const lightDom = await h.evaluate(`return JSON.stringify({innerText:document.body.innerText.length, p:document.querySelectorAll('p').length});`);
    flow.record("light-DOM 对照", String(lightDom.value || lightDom.error));
    const grew = b1.textLen - b0.textLen > 200 || b1.blockTags - b0.blockTags > 3;
    flow.check(
      "点开后 CDP 后端树里必须出现正文（出现 ⇒ 产品正常、light-DOM 探针瞎；不出现 ⇒ 正文真没渲染）",
      grew,
      "正文出现",
      { pierce文本增量: b1.textLen - b0.textLen, 段落标签增量: b1.blockTags - b0.blockTags, 影子宿主: b1.shadowHosts }
    );
  } finally {
    await shutdown(h);
  }
});
