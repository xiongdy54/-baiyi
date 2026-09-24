// F53 阅读器空白差分：播种的书 vs 当场新建的书，同一个会话里对比
// @runtime: node  @tier: 1  @gui: true  @id: F53  @timeout: 600
// 运行：先 npx electron tests/flows/f48b-seed.cjs，再 node tests/flows/f53-reader-blank-probe.cjs
//
// 起因：F48V 的 f48v-7-阅读器首屏.png 里，阅读器**整页空白**（标题栏与工具条都在，正文一个字没有）。
// 这条流程只回答一个问题：那是**产品的缺陷**（点开任何书都白），还是**播种的产物**（只有绕过渲染层造的书白）。
// 手法：同一个应用会话里，先点播种书测三档等待时间，再当场 createFromPaste 一本新书点它测同样三档。
"use strict";
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F53",
  title: "阅读器空白差分",
  angle: "同一会话内对比「播种书」与「当场新建书」的正文渲染，区分产品缺陷与测试产物",
  cites: ["§6.2", "§7.1.4"],
  tier: 1,
  gui: true,
});

const MD =
  "# 差分章 一\n\n这一段必须出现在阅读器里。渐进阅读把长文切成可独立回忆的小块，" +
  "并为每个小块制作记忆卡片；如果阅读器空白，用户第一眼看到的就是白屏。\n\n" +
  "# 差分章 二\n\n间隔重复依据遗忘曲线安排复习时点，FSRS 是该模型的参数化实现。\n";

async function realClickAt(h, expr) {
  const r = await h.evaluate(expr);
  const v = typeof r.value === "string" ? JSON.parse(r.value) : null;
  if (!v || !Number.isFinite(v.x)) return { ok: false, raw: r.value || r.error };
  await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: v.x, y: v.y, button: "none" });
  await wait(150);
  await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: v.x, y: v.y, button: "left", clickCount: 1, buttons: 1 });
  await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: v.x, y: v.y, button: "left", clickCount: 1, buttons: 0 });
  return { ok: true, v };
}

const probe = (label) => `
  const root=document.querySelector('[class*=reader],[class*=Reader],iframe,webview');
  const paras=document.querySelectorAll('p,li,td,h1,h2,[class*=paragraph],[class*=page] > *');
  let inner=0, frameInfo='无 iframe';
  const fr=document.querySelector('iframe');
  if(fr){ try{ const d=fr.contentDocument; inner=d&&d.body?d.body.innerText.length:0; frameInfo='iframe innerText='+inner+' src='+(fr.src||'').slice(0,40); }catch(e){ frameInfo='iframe 跨源不可读'; } }
  return JSON.stringify({
    有阅读器容器: !!root,
    容器class: root?String(root.className).slice(0,40):null,
    整页文本长度: document.body.innerText.length,
    正文节点数: paras.length,
    ${JSON.stringify(label)}: true,
    frame: frameInfo,
    标题栏文本: (document.querySelector('[class*=title],[class*=doc-name],header')||{}).innerText ? String(document.querySelector('[class*=title],[class*=doc-name],header').innerText).slice(0,30) : null
  });`;

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9790, fresh: false, logName: path.join(RESULTS_DIR, "f53.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    // 差分开关：F53_EMULATE=1 才做 CDP 视口覆写。
    // 假设：reader-scroll-engine 按容器实测尺寸分页，被 setDeviceMetricsOverride 干扰后可能排出 0 页 ⇒ 白屏是**自动化产物**。
    flow.record("本次是否覆写视口", process.env.F53_EMULATE === "1" ? "是（F53_EMULATE=1）" : "否（用窗口真实尺寸）");
    if (process.env.F53_EMULATE === "1") {
      await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await wait(1200);
    } else {
      const realSize = await h.evaluate(`return JSON.stringify({innerWidth,innerHeight,deClient:[document.documentElement.clientWidth,document.documentElement.clientHeight]});`);
      flow.record("窗口真实尺寸", String(realSize.value || realSize.error));
      await wait(800);
    }

    flow.section("D1 盘上事实：播种的书到底有没有正文");
    const onDisk = await h.evaluate(
      `return window.libraryAPI.list ? window.libraryAPI.list().then(x=>JSON.stringify((x.items||x||[]).slice(0,3).map(i=>({id:i.id,t:i.title&&i.title.slice(0,16)})))).catch(e=>'ERR:'+e) : 'no list api;'`
    );
    flow.record("书目前 3 本", String(onDisk.value || onDisk.error));

    flow.section("D2 点「播种书」的第一张卡，三档等待时间各测一次");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2500);
    const c1 = await realClickAt(
      h,
      `const cards=[...document.querySelectorAll('.book-card')]; if(!cards.length) return 'none';
       const t=cards[0]; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
       return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`
    );
    flow.record("点击播种书结果", JSON.stringify(c1).slice(0, 90));
    await wait(3000);
    const p3 = await h.evaluate(probe("播种书@3s"));
    flow.record("播种书 @3s", String(p3.value || p3.error));
    await wait(3000);
    const p6 = await h.evaluate(probe("播种书@6s"));
    flow.record("播种书 @6s", String(p6.value || p6.error));
    await wait(4000);
    const p10 = await h.evaluate(probe("播种书@10s"));
    flow.record("播种书 @10s", String(p10.value || p10.error));
    await h.shot("f53-1-播种书");
    const seededHasText = JSON.parse(String(p10.value || "{}"));

    flow.section("D3 当场新建一本书，**先强制刷书架**（切到卡片页再切回），再点它");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2000);
    const created = await h.evaluate(
      `return window.libraryAPI.createFromPaste("F53 差分书 ${Date.now().toString(36)}", ${JSON.stringify(MD)})
        .then(r=>JSON.stringify({ok:true,id:r&&r.id||(r.item&&r.item.id)||null})).catch(e=>'ERR:'+String(e&&e.message||e))`
    );
    flow.record("createFromPaste 返回", String(created.value || created.error));
    await wait(2500);
    // 不导航，直接数书架上有没有它 —— 这条本身就是 F47-F-1（建书后书架不刷新）的判据
    const beforeNav = await h.evaluate(
      `return JSON.stringify({书卡数:document.querySelectorAll('.book-card').length,
        含新书:[...document.querySelectorAll('.book-card')].some(e=>/F53 差分书/.test(e.textContent||'')),
        计数文案:(document.body.innerText.match(/\\d+\\s*本/)||['未见'])[0]});`
    );
    flow.record("建书后**不导航**时的书架", String(beforeNav.value || beforeNav.error));
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='卡片'); if(el) el.click(); return 1;`);
    await wait(1800);
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2600);
    const afterNav = await h.evaluate(
      `return JSON.stringify({书卡数:document.querySelectorAll('.book-card').length,
        含新书:[...document.querySelectorAll('.book-card')].some(e=>/F53 差分书/.test(e.textContent||'')),
        计数文案:(document.body.innerText.match(/\\d+\\s*本/)||['未见'])[0]});`
    );
    flow.record("切走再切回之后的书架", String(afterNav.value || afterNav.error));
    flow.check(
      "粘贴建书成功后，书架**不导航**也应当立刻可见（F47-F-1 判据）",
      JSON.parse(String(afterNav.value || "{}")).含新书 === true && JSON.parse(String(beforeNav.value || "{}")).含新书 === true,
      "不导航即可见",
      { 不导航: JSON.parse(String(beforeNav.value || "{}")).含新书, 导航后: JSON.parse(String(afterNav.value || "{}")).含新书 }
    );
    const c2 = await realClickAt(
      h,
      `const cards=[...document.querySelectorAll('.book-card')];
       const t=cards.find(e=>/F53 差分书/.test(e.textContent||''));
       if(!t) return 'none'; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
       return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`
    );
    flow.record("点击新建书结果", JSON.stringify(c2).slice(0, 90));
    await wait(3000);
    const n3 = await h.evaluate(probe("新建书@3s"));
    flow.record("新建书 @3s", String(n3.value || n3.error));
    await wait(4000);
    const n7 = await h.evaluate(probe("新建书@7s"));
    flow.record("新建书 @7s", String(n7.value || n7.error));
    // 深查：影子根 / canvas / 分页引擎容器 / 阅读器容器 innerHTML 形状
    const deep = await h.evaluate(`
      const roots=[];
      const walk=(node)=>{ for(const el of node.querySelectorAll('*')){ if(el.shadowRoot){ roots.push(String(el.tagName).toLowerCase()+'.'+String(el.className).slice(0,24)); walk(el.shadowRoot);} } };
      walk(document);
      const rw=document.querySelector('.reader-wrap,[class*=reader]');
      const ifr=[...document.querySelectorAll('iframe,webview,canvas,[class*=foliate],[class*=page]')].map(e=>e.tagName.toLowerCase()+'.'+String(e.className).slice(0,20));
      return JSON.stringify({
        影子根: roots.slice(0,6),
        特殊容器: ifr.slice(0,8),
        阅读器容器innerHTML长度: rw? rw.innerHTML.length : -1,
        阅读器容器HTML头部: rw? rw.innerHTML.slice(0,220) : null,
        标题栏: (document.querySelector('[class*=topbar],[class*=reader-title],header')||{}).innerText || null
      });`);
    flow.record("深查阅读器 DOM", String(deep.value || deep.error).slice(0, 520));
    await h.shot("f53-2-新建书");
    const freshHasText = JSON.parse(String(n7.value || "{}"));

    flow.section("D4 判定");
    flow.record("播种书正文节点数 / 整页文本", `${seededHasText.正文节点数 ?? "?"} / ${seededHasText.整页文本长度 ?? "?"}`);
    flow.record("新建书正文节点数 / 整页文本", `${freshHasText.正文节点数 ?? "?"} / ${freshHasText.整页文本长度 ?? "?"}`);
    const seededBlank = (seededHasText.正文节点数 || 0) === 0 || (seededHasText.整页文本长度 || 0) < 120;
    const freshBlank = (freshHasText.正文节点数 || 0) === 0 || (freshHasText.整页文本长度 || 0) < 120;
    flow.check("阅读器对**当场新建**的书能出正文（若这条也红 = 产品级 P0）", !freshBlank, "有正文", freshHasText);
    flow.check("阅读器对**播种**的书能出正文（若只有这条红 = F48V 的空白是播种产物，不是产品缺陷）", !seededBlank, "有正文", seededHasText);
    flow.record(
      "差分结论",
      !freshBlank && !seededBlank
        ? "两者都有正文 ⇒ F48V 那次空白是**我的截图时机/点击落点**问题，产品无缺陷"
        : !freshBlank && seededBlank
          ? "只有播种书空白 ⇒ **播种产物**（db 层直造的书缺了渲染层要的东西）；顺带记一条：绕过渲染层写入的库形状不完整"
          : "两者都空白 ⇒ **产品级缺陷**，阅读器在真实数据下打不开正文"
    );
  } finally {
    await shutdown(h);
  }
});
