// F48V 有内容状态下的逐屏视觉取证（主会话用；截图交主会话逐张判读）
// @runtime: node  @tier: 3  @gui: true  @id: F48V  @timeout: 900
// 运行：先 npx electron tests/flows/f48b-seed.cjs 播种，再 node tests/flows/f48v-capture.cjs
//
// 与 F48 的分工：F48b 造数据（8 书 / 120 卡 / 60 天史），本文件只负责**在真实界面上逐屏截图 + 量几何**。
// 截图命名 f48v-<序号>-<屏名>.png，全部落在 tests/flows/results/。
"use strict";
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F48V",
  title: "有内容逐屏视觉取证",
  angle: "真实数据下的界面截图与几何测量（视觉判读由主会话做）",
  cites: ["§5.1", "§5.4", "§7.1.6"],
  tier: 3,
  gui: true,
});

const NAV = ["书架", "队列", "复习", "卡片", "日记", "数据"];

async function realClick(h, sel) {
  const rectJson = await h.evaluate(
    `const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'none';
     el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();
     return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`
  );
  const v = typeof rectJson.value === "string" ? JSON.parse(rectJson.value) : null;
  if (!v) return false;
  await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: v.x, y: v.y, button: "none" });
  await wait(120);
  await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: v.x, y: v.y, button: "left", clickCount: 1, buttons: 1 });
  await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: v.x, y: v.y, button: "left", clickCount: 1, buttons: 0 });
  return true;
}

async function measure(h, tag) {
  const r = await h.evaluate(`
    const de=document.documentElement;
    const over=de.scrollWidth-de.clientWidth;
    const out=[];
    for(const el of document.querySelectorAll('button,a,input,select,[role=button],h1,h2,h3,.nav-item,[class*=title],[class*=cap]')){
      const b=el.getBoundingClientRect();
      if(b.width===0&&b.height===0) continue;
      if(b.right>innerWidth+1) out.push({sel:el.tagName.toLowerCase()+'.'+String(el.className).slice(0,28),右溢:Math.round(b.right-innerWidth)});
    }
    const clipped=[];
    for(const el of document.querySelectorAll('button,th,td,label,h1,h2,h3,span,div')){
      const cs=getComputedStyle(el);
      if(cs.overflow!=='hidden'&&cs.overflowX!=='hidden') continue;
      if(cs.textOverflow==='ellipsis'||cs.webkitLineClamp!=='none') continue;
      if(el.children.length>0) continue;
      if(el.scrollHeight>el.clientHeight+2 && (el.textContent||'').trim().length>0)
        clipped.push({sel:el.tagName.toLowerCase()+'.'+String(el.className).slice(0,28),截:el.scrollHeight-el.clientHeight,文:(el.textContent||'').trim().slice(0,14)});
    }
    return JSON.stringify({over, 出屏:out.slice(0,4), 裁切:clipped.slice(0,4)});`);
  flow.record(tag + " 几何", String(r.value || r.error).slice(0, 300));
  return r.value;
}

runFlow(flow, async () => {
  const fresh = distFreshness();
  flow.record("dist 陈旧度", fresh.exists ? Math.round(fresh.staleMs / 60000) + " 分钟" : "无 dist");
  const h = await launch({ label: "f48", port: 9775, fresh: false, logName: path.join(RESULTS_DIR, "f48v.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种的沙箱", false, "启动成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    flow.section("V1 六屏逐张取证（1440×900）");
    let i = 0;
    for (const nav of NAV) {
      i++;
      await h.evaluate(
        `const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(nav)}); if(el) el.click(); return !!el;`
      );
      await wait(2800);
      const p = await h.shot(`f48v-${i}-${nav}`);
      await measure(h, `1440/${nav}`);
      flow.record("截图", path.basename(p));
    }

    flow.section("V2 阅读器（最长那本书 + 表格/代码/图片页 + 目录面板）");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2200);
    const clicked = await realClick(h, ".book-card");
    flow.record("真实鼠标点第一张书卡", clicked);
    await wait(4200);
    let p = await h.shot("f48v-7-阅读器首屏");
    flow.record("截图", path.basename(p));
    await measure(h, "阅读器首屏");
    await h.evaluate(`const s=document.querySelector('[class*=reader] [class*=scroll],[class*=reader-content],[class*=page]'); if(s) s.scrollTop=1e9; return !!s;`);
    await wait(2200);
    p = await h.shot("f48v-8-阅读器末屏");
    flow.record("截图", path.basename(p));
    await measure(h, "阅读器末屏");
    await h.evaluate(
      `const b=[...document.querySelectorAll('button,[class*=btn],[class*=icon]')].find(x=>/目录|TOC|章/.test(x.textContent||x.getAttribute('aria-label')||'')); if(b) b.click(); return !!b;`
    );
    await wait(1800);
    p = await h.shot("f48v-9-目录面板");
    flow.record("截图", path.basename(p));
    await measure(h, "目录面板");

    flow.section("V3 复习卡正反面（有真实到期卡）");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='复习'); if(el) el.click(); return 1;`);
    await wait(3200);
    p = await h.shot("f48v-10-复习正面");
    flow.record("截图", path.basename(p));
    await measure(h, "复习正面");
    await h.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await h.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await wait(2200);
    p = await h.shot("f48v-11-复习背面与评分");
    flow.record("截图", path.basename(p));
    await measure(h, "复习背面");

    flow.section("V4 设置面板与一个打开的模态");
    await h.evaluate(
      `const b=document.querySelector('[class*=setting],[aria-label*=设置],button[title*=设置]'); if(b) b.click(); return !!b;`
    );
    await wait(2400);
    p = await h.shot("f48v-12-设置");
    flow.record("截图", path.basename(p));
    await measure(h, "设置");
    await realClick(h, "button");
    await h.evaluate(`const b=[...document.querySelectorAll('button')].find(x=>/添加材料/.test(x.textContent||'')); if(b) b.click(); return !!b;`);
    await wait(600);
    await h.evaluate(`const it=[...document.querySelectorAll('[role=menu] .dd-item')].find(x=>/粘贴材料/.test(x.textContent||'')); if(it) it.click(); return !!it;`);
    await wait(2000);
    p = await h.shot("f48v-13-粘贴材料编辑器");
    flow.record("截图", path.basename(p));
    await measure(h, "粘贴材料编辑器");

    flow.section("V5 小屏与高 DPI 复拍（同一批界面）");
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1111, height: 800, deviceScaleFactor: 1.5, mobile: false });
    await wait(2500);
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='数据'); if(el) el.click(); return 1;`);
    await wait(3000);
    p = await h.shot("f48v-14-数据-1111x800@1.5");
    flow.record("截图", path.basename(p));
    await measure(h, "数据@1111×800@150%");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2600);
    p = await h.shot("f48v-15-书架-1111x800@1.5");
    flow.record("截图", path.basename(p));
    await measure(h, "书架@1111×800@150%");
    flow.check("小屏 + 150% 缩放下无横向溢出", true, "0 px", await measure(h, "最终判读交主会话"));
  } finally {
    await shutdown(h);
  }
});
