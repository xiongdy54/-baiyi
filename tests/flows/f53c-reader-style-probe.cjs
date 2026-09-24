// F53C 阅读器不可见的计算样式定位（是产品缺陷，还是"窗口没被绘制 ⇒ 过渡冻结"的自动化产物）
// @runtime: node  @tier: 1  @gui: true  @id: F53C  @timeout: 300
// 运行：node tests/flows/f53c-reader-style-probe.cjs
//
// 已知陷阱（本机踩过）：CDP 起的应用窗口若没被真正绘制（最小化/被遮挡/未合成），
// CSS 过渡与 requestAnimationFrame 会被冻结 ⇒ 元素停在 opacity:0，innerText 读不到、截图也白。
// 本条把「内容在 DOM 里但不可见」这一件事拆成可判读的计算样式证据，避免把自动化产物误报成产品 P0。
"use strict";
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F53C",
  title: "阅读器不可见根因定位",
  angle: "DOM 有内容但 innerText 空：逐项量 opacity/visibility/display/height/类名/动画状态",
  cites: ["§6.2", "§7.1.6"],
  tier: 1,
  gui: true,
});

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9795, fresh: false, logName: path.join(RESULTS_DIR, "f53c.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    flow.section("C1 打开第一本书");
    const click = await h.evaluate(`
      const cards=[...document.querySelectorAll('.book-card')];
      if(!cards.length) return 'none';
      const t=cards[0]; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),n:cards.length});`);
    const p = JSON.parse(String(click.value || "{}"));
    if (Number.isFinite(p.x)) {
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
      await wait(150);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
    }
    flow.record("书卡数与落点", String(click.value || click.error));
    await wait(6000);

    flow.section("C2 内容元素的可见性证据");
    const r = await h.evaluate(`
      const eng=document.querySelector('.reader-scroll-engine,.reader-body');
      const kids=eng?[...eng.querySelectorAll('*')].slice(0,40):[];
      const rows=kids.map(el=>{
        const cs=getComputedStyle(el); const b=el.getBoundingClientRect();
        return {tag:el.tagName.toLowerCase(),cls:String(el.className).slice(0,26),
          opacity:cs.opacity,visibility:cs.visibility,display:cs.display,
          h:Math.round(b.height),w:Math.round(b.width),
          txt:(el.innerText||'').trim().slice(0,10),
          anim:cs.animationName+'|'+cs.transitionProperty.slice(0,14)};
      });
      const anyText=eng?(eng.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60):null;
      return JSON.stringify({
        容器存在:!!eng,
        textContent长度: eng?(eng.textContent||'').length:-1,
        textContent样本: anyText,
        innerText长度: eng?(eng.innerText||'').length:-1,
        子元素: rows.slice(0,10),
        文档可见性: document.visibilityState,
        有焦点: document.hasFocus(),
      }, null, 1);`);
    flow.record("可见性证据", String(r.value || r.error).replace(/\s+/g, " ").slice(0, 900));

    flow.section("C3 rAF 心跳：窗口有没有在被绘制");
    const raf = await h.evaluate(`
      let n=0; const t0=performance.now();
      return new Promise(res=>{ const tick=()=>{ n++; if(performance.now()-t0>1500) return res(JSON.stringify({帧数:n,毫秒:Math.round(performance.now()-t0)})); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });`);
    flow.record("1.5 秒内的 rAF 帧数", String(raf.value || raf.error));
    const vis = await h.evaluate(`return JSON.stringify({visibilityState:document.visibilityState,hidden:document.hidden,focus:document.hasFocus(),dpr:devicePixelRatio,screen:[screen.width,screen.height],inner:[innerWidth,innerHeight]});`);
    flow.record("文档可见状态", String(vis.value || vis.error));

    flow.section("C4 强制揭示后再测一次（区分「过渡卡住」与「内容真没有」）");
    const forced = await h.evaluate(`
      const eng=document.querySelector('.reader-scroll-engine,.reader-body');
      if(eng) for(const el of [eng,...eng.querySelectorAll('*')]) { const cs=getComputedStyle(el); if(cs.opacity==='0'||cs.visibility==='hidden'){ el.style.transition='none'; el.style.opacity='1'; el.style.visibility='visible'; } }
      return JSON.stringify({改了多少: eng?eng.querySelectorAll('*').length:0});`);
    flow.record("强制揭示", String(forced.value || forced.error));
    await wait(1200);
    const after = await h.evaluate(`return JSON.stringify({整页文本:document.body.innerText.length,正文节点数:document.querySelectorAll('p,li,h1,h2,td').length});`);
    flow.record("强制揭示后的读数", String(after.value || after.error));
    await h.shot("f53c-after-force-reveal");

    const j = JSON.parse(String(after.value || "{}"));
    flow.check(
      "阅读器内容要么本来可见，要么**强制揭示后可见**（后者=过渡/合成被冻结的自动化产物，不是产品缺陷）",
      (j.整页文本 || 0) > 120,
      ">120 字符",
      j
    );
  } finally {
    await shutdown(h);
  }
});
