// F58 同行元素底边/高度对齐检（封面墙与仪表盘面板组）
// @runtime: node  @tier: 2  @gui: true  @id: F58  @timeout: 420
// 运行：node tests/flows/f58-row-alignment.cjs
//
// 起因：D-TEST-64——真实封面墙上同一行 6 张卡底边参差不齐（封面按原比例 ⇒ 卡高由内容决定）。
// 这类缺陷 F55（相交检）与 F44（裁切检）都抓不到：既没有重叠也没有裁切，纯粹是**对齐**丢了。
// 本条专量"同一行同类型元素的底边/高度一致性"，并自带正向对照（F50 那次假绿的教训）。
"use strict";
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, connect, shutdown, wait, ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F58",
  title: "同行元素对齐检",
  angle: "同一行同类型卡片的底边/高度差（对齐丢失这一整类缺陷的第一个闸门）",
  cites: ["§5.1", "§5.4", "D51"],
  tier: 2,
  gui: true,
});

// 量一个容器家族：取同类子元素，按 top 分行（容差 6px），再比每行的底边极差与高度极差
const ALIGN = (selector) => `
const els=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{const b=e.getBoundingClientRect();return b.width>20&&b.height>20;});
const rows=[];
for(const e of els.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)){
  const b=e.getBoundingClientRect();
  const r=rows.find(x=>Math.abs(x.top-b.top)<=6);
  if(r){r.items.push(b); r.top=(r.top*r.items.length+b.top)/(r.items.length+1);}
  else rows.push({top:b.top,items:[b]});
}
const bad=[];
for(const r of rows){
  if(r.items.length<2) continue;
  const bottoms=r.items.map(x=>x.bottom), hs=r.items.map(x=>x.height);
  const dB=Math.round(Math.max(...bottoms)-Math.min(...bottoms));
  const dH=Math.round(Math.max(...hs)-Math.min(...hs));
  if(dB>8||dH>8) bad.push({该行卡片数:r.items.length,底边极差px:dB,高度极差px:dH});
}
return JSON.stringify({元素总数:els.length,行数:rows.length,不对齐行数:bad.length,明细:bad.slice(0,6)});`;

function report(tag, raw) {
  let j = {};
  try {
    j = JSON.parse(String(raw.value || "{}"));
  } catch {
    flow.record(tag + " 读数失败", String(raw.error).slice(0, 90));
    return null;
  }
  flow.record(tag, `元素 ${j.元素总数} · 行 ${j.行数} · 不对齐行 ${j.不对齐行数} · 明细 ${JSON.stringify(j.明细)}`);
  return j;
}

runFlow(flow, async () => {
  // F58_USERDATA=<目录> 时直接开那个目录（用来跑 F49 留下的**真实库副本**，
  // 因为合成播种的封面高度全一致，复现不了 D-TEST-64 的"真封面比例不一导致底边不齐"）。
  let h;
  const realDir = process.env.F58_USERDATA ? path.resolve(process.env.F58_USERDATA) : null;
  if (realDir && !fs.existsSync(path.join(realDir, "library.db"))) {
    flow.check("F58_USERDATA 指向的副本里有 library.db", false, "存在", realDir);
    return;
  }
  if (realDir) {
    flow.record("开的是真实库副本", realDir + "（副本在 tests/tmp-* 下，原件 %APPDATA% 不碰）");
    const fd = fs.openSync(path.join(RESULTS_DIR, "f58.app.log"), "a");
    const child = spawn(ELECTRON, [".", "--remote-debugging-port=9885"], {
      cwd: ROOT,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, M7_TEST_USERDATA: realDir },
    });
    const conn = await connect(9885, child, 120_000);
    h = { dir: realDir, child, ...conn };
  } else {
    h = await launch({ label: "f48", port: 9885, fresh: false, logName: path.join(RESULTS_DIR, "f58.app.log") });
  }
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱（f48 专用，不与 soak 抢目录）", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    flow.section("A0 正向对照：先证明这条检能抓到人为造成的不对齐");
    const ctl = await h.evaluate(`
      // D51 把图注画在封面之外 ⇒ 每张 .book-card 可能各自被一个 wrapper 包着，
      // 所以不能用「同一个父元素下有 2+ 张卡」来找同行；直接按 top 找同一行的两张卡。
      const els=[...document.querySelectorAll('.book-card')].filter(e=>{const b=e.getBoundingClientRect();return b.width>20&&b.height>20;});
      const sorted=els.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
      let pair=null;
      for(let i=0;i<sorted.length-1;i++){
        const A=sorted[i].getBoundingClientRect(), B=sorted[i+1].getBoundingClientRect();
        if(Math.abs(A.top-B.top)<=6){ pair=[sorted[i],sorted[i+1]]; break; }
      }
      if(!pair) return JSON.stringify({err:'no-same-row-pair', 卡数:els.length});
      const beforeH=Math.round(pair[0].getBoundingClientRect().height);
      pair[0].style.height=(beforeH+30)+'px';
      return JSON.stringify({注入:'把同一行第一张卡加高 30px', 原高:beforeH, 同行两张卡:pair[1].getBoundingClientRect().top-pair[0].getBoundingClientRect().top});`);
    flow.record("对照注入", String(ctl.value || ctl.error));
    const ctlRes = report("对照·注入后", await h.evaluate(ALIGN(".book-card")));
    await h.evaluate(`
      for(const k of document.querySelectorAll('.book-card')){ k.style.height=''; k.style.marginBottom=''; }
      return 1;`);
    flow.check(
      "自检：人为把一张卡加高 30px 后，本检必须报出不对齐（报不出 ⇒ 本流程的绿不算数）",
      !!ctlRes && (ctlRes.不对齐行数 || 0) > 0,
      ">0 行",
      ctlRes
    );

    flow.section("A1 真实形状下的封面墙");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2800);
    const shelf = report("书架 .book-card（只含封面块）", await h.evaluate(ALIGN(".book-card")));
    await h.shot("f58-shelf-alignment");

    flow.section("A1b 量**整格**（封面块 + 图注 + meta 行的共同父级）");
    // D51 把图注画在封面之外 ⇒ .book-card 只是封面块，书名与 meta 是它的**兄弟**。
    // 所以 A1 量 .book-card 对齐与否，跟用户看到的"这行齐不齐"不是同一件事。这里量共同父级。
    const cellSel = await h.evaluate(`
      const c=document.querySelector('.book-card');
      if(!c) return 'none';
      const p=c.parentElement;
      window.__f58cell = p;
      const cls=String(p.className||'').split(/\\s+/).filter(Boolean);
      return JSON.stringify({父标签:p.tagName.toLowerCase(), 父类:cls.slice(0,3), 祖父类:String(p.parentElement.className||'').split(/\\s+/).slice(0,3)});`);
    flow.record("格子父级形状", String(cellSel.value || cellSel.error));
    const cellAlign = await h.evaluate(`
      const cells=[...document.querySelectorAll('.book-card')].map(c=>c.closest('.shelf-item')||c.parentElement.parentElement||c.parentElement).filter(Boolean);
      const uniq=[...new Set(cells)].filter(e=>{const b=e.getBoundingClientRect();return b.width>20&&b.height>20;});
      const rows=[];
      for(const e of uniq.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)){
        const b=e.getBoundingClientRect();
        const r=rows.find(x=>Math.abs(x.top-b.top)<=6);
        if(r) r.items.push(b); else rows.push({top:b.top,items:[b]});
      }
      const bad=[];
      for(const r of rows){
        if(r.items.length<2) continue;
        const dB=Math.round(Math.max(...r.items.map(x=>x.bottom))-Math.min(...r.items.map(x=>x.bottom)));
        const dH=Math.round(Math.max(...r.items.map(x=>x.height))-Math.min(...r.items.map(x=>x.height)));
        if(dB>8||dH>8) bad.push({该行格数:r.items.length,整格底边极差px:dB,整格高度极差px:dH});
      }
      return JSON.stringify({格子数:uniq.length,行数:rows.length,不对齐行:bad.length,明细:bad.slice(0,6)});`);
    flow.record("书架 整格（封面+图注+meta）", String(cellAlign.value || cellAlign.error));

    flow.section("A2 其他同类型重复容器");
    const families = [
      ["仪表盘面板", "[class*=panel],[class*=card],[class*=widget]"],
      ["卡片浏览行", "tbody tr,[class*=row]"],
      ["顶栏导航项", ".nav-item"],
      ["设置分组", "[class*=section],[class*=group]"],
    ];
    const results = {};
    for (const [name, sel] of families) {
      const raw = await h.evaluate(`return (async()=>{const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(name.includes("仪表") ? "数据" : name.includes("卡片") ? "卡片" : name.includes("设置") ? "数据" : "书架")}); if(el) el.click(); await new Promise(r=>setTimeout(r,2200)); return 1;})()`);
      void raw;
      const j = report(name + " " + sel, await h.evaluate(ALIGN(sel)));
      if (j) results[name] = j.不对齐行数;
    }

    flow.section("A3 判定");
    flow.record("各家族不对齐行数", JSON.stringify(results));
    flow.check(
      "封面墙同一行卡片底边/高度差 ≤ 8px（D-TEST-64 的机检闸门）",
      !!shelf && (shelf.不对齐行数 || 0) === 0,
      "0 行",
      shelf
    );
  } finally {
    await shutdown(h);
  }
});
