// F55 兄弟矩形相交检：文字压到别人身上（现有"裁切检"的结构盲区）
// @runtime: node  @tier: 2  @gui: true  @id: F55  @timeout: 600
// 运行：先 npx electron tests/flows/f48b-seed.cjs，再 node tests/flows/f55-sibling-overlap.cjs
//
// 起因：F46-V1 在截图里看到「四十字长标题」把封面块撑破、标题最后一行被卡片下边界切半截，
//       并且标题整块**溢出到封面块之外压住下面的 meta 行**。
//       F44 的裁切检抓不到它——那条判据要求元素自己 overflow:hidden 且 scrollHeight>clientHeight，
//       而这里是**没有 overflow 约束的元素与兄弟元素的矩形相交**。本条专门量这一类。
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F55",
  title: "兄弟矩形相交检",
  angle: "两个非祖先关系的元素矩形相交 = 文字压在文字上（裁切检的结构盲区）",
  cites: ["§5.1", "§5.4", "§7.1.6"],
  tier: 2,
  gui: true,
});

const NAV = ["书架", "队列", "复习", "卡片", "日记", "数据"];

const PROBE = `
const chain = (el) => { const p=[]; let n=el; for(let i=0;i<4&&n;i++){ p.unshift(n.tagName.toLowerCase()+'.'+String(n.className||'').split(/\\s+/).filter(Boolean).slice(0,2).join('.')); n=n.parentElement; } return p.join('>'); };
const leaves=[];
for(const el of document.querySelectorAll('*')){
  const t=(el.innerText||'').trim();
  if(!t || t.length>80) continue;
  if(el.children.length>0) continue;                 // 只要叶子
  const b=el.getBoundingClientRect();
  if(b.width<2||b.height<2) continue;
  const cs=getComputedStyle(el);
  if(cs.opacity==='0'||cs.visibility==='hidden'||cs.display==='none') continue;
  leaves.push({el,b,cs,t});
}
const hits=[];
for(let i=0;i<leaves.length;i++) for(let j=i+1;j<leaves.length;j++){
  const A=leaves[i], B=leaves[j];
  if(A.el.contains(B.el)||B.el.contains(A.el)) continue;
  const ax=A.el.closest('[class*=modal],[role=dialog],[class*=menu],[class*=dropdown],[class*=tooltip]');
  const bx=B.el.closest('[class*=modal],[role=dialog],[class*=menu],[class*=dropdown],[class*=tooltip]');
  if(ax&&!bx) continue;    // 有意的浮层压内容，不算
  if(bx&&!ax) continue;
  const x=Math.max(0,Math.min(A.b.right,B.b.right)-Math.max(A.b.left,B.b.left));
  const y=Math.max(0,Math.min(A.b.bottom,B.b.bottom)-Math.max(A.b.top,B.b.top));
  const inter=x*y; if(inter<=0) continue;
  const smaller=Math.min(A.b.width*A.b.height,B.b.width*B.b.height);
  const ratio=inter/Math.max(1,smaller);
  if(ratio>0.25) hits.push({比率:+(ratio*100).toFixed(0),A:chain(A.el),B:chain(B.el),A文本:A.t.slice(0,14),B文本:B.t.slice(0,14)});
}
// 另外单量一类：标题溢出卡片下边界
const spills=[];
for(const card of document.querySelectorAll('.book-card,[class*=card]')){
  const cb=card.getBoundingClientRect();
  for(const el of card.querySelectorAll('*')){
    const t=(el.innerText||'').trim(); if(!t||el.children.length>0) continue;
    const b=el.getBoundingClientRect();
    if(b.bottom>cb.bottom+1 && b.top<cb.bottom) spills.push({溢出px:Math.round(b.bottom-cb.bottom),元素:chain(el),文本:t.slice(0,16)});
  }
}
return JSON.stringify({相交:hits.slice(0,8),相交总数:hits.length,溢出:spills.slice(0,6),溢出总数:spills.length});`;

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9860, fresh: false, logName: path.join(RESULTS_DIR, "f55.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱（不与其他流程抢 label）", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    flow.section("O1 六屏兄弟相交 / 溢出卡片边界");
    let worst = 0;
    let spillTotal = 0;
    for (const nav of NAV) {
      await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(nav)}); if(el) el.click(); return 1;`);
      await wait(2600);
      const r = await h.evaluate(PROBE);
      let j = {};
      try {
        j = JSON.parse(String(r.value || "{}"));
      } catch {
        flow.record(nav + " 读数失败", String(r.error).slice(0, 80));
        continue;
      }
      flow.record(`${nav} 相交`, `${j.相交总数} 对；样本 ${(j.相交 || []).slice(0, 2).map((x) => `${x.比率}%[${x.A文本}]+[${x.B文本}]`).join(" ")}`);
      for (const x of j.相交 || []) flow.record(`  相交@${nav}`, `重叠 ${x.比率}% · ${x.A} 「${x.A文本}」 × ${x.B} 「${x.B文本}」`);
      flow.record(`${nav} 溢出`, `${j.溢出总数} 处；样本 ${(j.溢出 || []).slice(0, 2).map((x) => `${x.溢出px}px[${x.文本}]`).join(" ")}`);
      for (const x of j.溢出 || []) flow.record(`  溢出@${nav}`, `${x.溢出px}px · ${x.元素} · 「${x.文本}」`);
      worst = Math.max(worst, j.相交总数 || 0);
      spillTotal += j.溢出总数 || 0;
    }

    flow.section("O2 判定");
    // 正向对照（F50 的教训：静态普查的 0 与"没测到"长得一样）：
    // 先造两个**必然相交**的文字块塞进 body，重跑同一份 PROBE，必须报出相交；报不出来说明判据本身是瞎的。
    const ctl = await h.evaluate(`
      const mk=(txt,x,y,w)=>{const d=document.createElement('div');d.id='f55-ctl-'+txt;d.textContent=txt;d.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:20px;z-index:99999;background:#fff;font-size:13px';document.body.appendChild(d);return d;};
      mk('F55CTLALPHA',100,100,200); mk('F55CTLBETA',140,106,200);
      return 1;`);
    flow.record("对照注入", ctl.value !== undefined ? "已注入两个固定定位重叠块" : String(ctl.error));
    const r2 = await h.evaluate(PROBE);
    const j2 = JSON.parse(String(r2.value || "{}"));
    const found = (j2.相交 || []).filter((x) => /F55CTL/.test(x.A文本 + x.B文本)).length;
    flow.record("对照是否被抓到", `抓到 ${found} 对（判据必须 >0，否则本流程的 0 全部无意义）`);
    const leafCount = await h.evaluate(`
      let n=0; for(const el of document.querySelectorAll('*')){ const t=(el.innerText||'').trim(); if(!t||t.length>80) continue; if(el.children.length>0) continue; const b=el.getBoundingClientRect(); if(b.width<2||b.height<2) continue; n++; } return n;`);
    flow.record("当前屏参与判定的叶子文字节点数", leafCount.value);
    await h.evaluate(`const a=document.getElementById('f55-ctl-F55CTLALPHA'),b=document.getElementById('f55-ctl-F55CTLBETA'); if(a)a.remove(); if(b)b.remove(); return 1;`);
    flow.check(
      "自检：判据必须能抓到人为构造的重叠（抓不到 ⇒ 本流程的绿不算数，需先修判据）",
      found > 0,
      ">0 对",
      { 抓到: found, 全树相交总数: j2.相交总数, 叶子节点数: leafCount.value }
    );
    flow.record("六屏里最脏的一屏相交对数", worst);
    flow.record("溢出卡片边界总处数", spillTotal);
    flow.check("不存在文字与文字矩形相交 >25% 的界面（重叠即缺陷）", worst === 0, "0 对", worst);
    flow.check("不存在文字溢出卡片下边界被裁的界面", spillTotal === 0, "0 处", spillTotal);
    await h.shot("f55-overlap-evidence");
  } finally {
    await shutdown(h);
  }
});
