// F63 可访问名称普查：图标按钮在屏幕阅读器里到底有没有名字
// @runtime: node  @tier: 2  @gui: true  @id: F63  @timeout: 420
// 运行：node tests/flows/f63-a11y-names.cjs
//
// 起因：f49-shelf.png / f48v-11 上那排动作条（✎ / Ⓐ+ / 📁+ / 🗑、以及 ‹ › 翻页、齿轮设置）
//       全是**只有图形没有文字**的控件。F44 量了焦点顺序与对比度，但没有一条量"可访问名称"。
//       没有名字的按钮对读屏用户等于不存在——这是 §7.1.6 的可达性承诺里最硬的一条。
// 判据按 W3C 的 accessible name 计算顺序近似：aria-labelledby > aria-label > 可见文字 > title > alt/input 关联 label > role=img 的 svg。
// 必带正向对照（本战役已四次靠它拦下自己的误报）。
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F63",
  title: "可访问名称普查",
  angle: "交互控件的可计算 accessible name 是否为空（读屏用户看得见什么）",
  cites: ["§7.1.6", "§5.2", "§5.4"],
  tier: 2,
  gui: true,
});

const NAV = ["书架", "队列", "复习", "卡片", "日记", "数据"];

const SWEEP = `
const INTERACTIVE = 'button,a[href],input,select,textarea,[role=button],[role=link],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[onclick]';
const nameOf = (el) => {
  const lb = el.getAttribute('aria-labelledby');
  if (lb) { const t = lb.split(/\\s+/).map(id=>{const n=document.getElementById(id);return n?n.textContent.trim():'';}).join(' ').trim(); if (t) return {名:t, 来源:'aria-labelledby'}; }
  const al = (el.getAttribute('aria-label')||'').trim();
  if (al) return {名:al, 来源:'aria-label'};
  const txt = (el.textContent||'').trim();
  if (txt) return {名:txt.slice(0,24), 来源:'可见文字'};
  const ti = (el.getAttribute('title')||'').trim();
  if (ti) return {名:ti.slice(0,24), 来源:'title'};
  const v = (el.value||'').trim();
  if (v) return {名:v.slice(0,24), 来源:'value'};
  if (el.tagName==='IMG'){ const a=(el.getAttribute('alt')||'').trim(); if(a) return {名:a.slice(0,24),来源:'alt'}; }
  const svg = el.querySelector && el.querySelector('svg');
  if (svg) { const t2 = svg.querySelector('title'); if (t2 && t2.textContent.trim()) return {名:t2.textContent.trim().slice(0,24), 来源:'svg>title'}; }
  const idd = el.id;
  if (idd) { const lab = document.querySelector('label[for="'+idd+'"]'); if (lab && lab.textContent.trim()) return {名:lab.textContent.trim().slice(0,24), 来源:'label[for]'}; }
  const wrap = el.closest('label');
  if (wrap && wrap.textContent.trim()) return {名:wrap.textContent.trim().slice(0,24), 来源:'label 包裹'};
  return {名:'', 来源:'(无)'};
};
const chain = (el) => { const p=[]; let n=el; for(let i=0;i<3&&n;i++){ p.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+'.'+String(n.className||'').split(/\\s+/).filter(Boolean).slice(0,2).join('.')); n=n.parentElement; } return p.join('>'); };
const out=[];
let total=0, visible=0;
for (const el of document.querySelectorAll(INTERACTIVE)) {
  total++;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  if (b.width<1||b.height<1||cs.display==='none'||cs.visibility==='hidden') continue;
  visible++;
  const n = nameOf(el);
  if (!n.名) out.push({链:chain(el), role:el.getAttribute('role')||el.tagName.toLowerCase(), 宽:Math.round(b.width), 高:Math.round(b.height), 内含svg: !!(el.querySelector&&el.querySelector('svg')), 内含img: !!(el.querySelector&&el.querySelector('img'))});
}
return JSON.stringify({交互控件总数:total, 可见控件数:visible, 无名数:out.length, 无名清单:out.slice(0,10)});`;

function merge(acc, j) {
  if (!j) return acc;
  acc.total += j.交互控件总数 || 0;
  acc.visible += j.可见控件数 || 0;
  acc.nameless += j.无名数 || 0;
  for (const x of j.无名清单 || []) acc.items.set(x.链, x);
  return acc;
}

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9910, fresh: false, logName: path.join(RESULTS_DIR, "f63.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    flow.section("N0 正向对照：造一个只有图没有名字的按钮，本检必须挑出来");
    const ctl = await h.evaluate(`
      const b=document.createElement('button'); b.id='f63-ctl-btn';
      b.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';
      b.style.cssText='position:fixed;left:10px;top:10px;width:28px;height:28px;z-index:99999;display:block';
      document.body.appendChild(b);
      const good=document.createElement('button'); good.id='f63-ctl-good'; good.setAttribute('aria-label','有名字的对照按钮');
      good.textContent=''; good.style.cssText='position:fixed;left:50px;top:10px;width:28px;height:28px;z-index:99999';
      document.body.appendChild(good);
      return 1;`);
    void ctl;
    const rc = await h.evaluate(SWEEP);
    const jc = JSON.parse(String(rc.value || "{}"));
    const caught = (jc.无名清单 || []).some((x) => /f63-ctl-btn/.test(x.链));
    const spared = !(jc.无名清单 || []).some((x) => /f63-ctl-good/.test(x.链));
    flow.record("对照结果", `无名按钮被挑出=${caught}；有 aria-label 的对照被放过=${spared}`);
    await h.evaluate(`const a=document.getElementById('f63-ctl-btn'),b=document.getElementById('f63-ctl-good'); if(a)a.remove(); if(b)b.remove(); return 1;`);
    flow.check("自检：判据必须挑出「只有图形无名字」的按钮，且放过有 aria-label 的按钮", caught === true && spared === true, "一抓一放都成立", { caught, spared });

    flow.section("N1 逐屏普查可访问名称");
    const acc = { total: 0, visible: 0, nameless: 0, items: new Map() };
    for (const nav of NAV) {
      await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(nav)}); if(el) el.click(); return 1;`);
      await wait(2600);
      const r = await h.evaluate(SWEEP);
      const j = JSON.parse(String(r.value || "{}"));
      flow.record(`${nav}`, `交互 ${j.交互控件总数} · 可见 ${j.可见控件数} · **无名 ${j.无名数}** · 样本 ${(j.无名清单 || []).slice(0, 3).map((x) => x.链 + `[${x.role} ${x.宽}×${x.高}]`).join(" ")}`);
      merge(acc, j);
    }

    flow.section("N2 悬停才出现的动作条（书架封面下方那排图标）");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2200);
    const pos = await h.evaluate(`
      const c=document.querySelector('.book-card'); if(!c) return 'no-card';
      const b=c.getBoundingClientRect();
      return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),w:Math.round(b.width),h:Math.round(b.height)});`);
    flow.record("封面卡中心", String(pos.value || pos.error));
    const pt = JSON.parse(String(pos.value || "{}"));
    // 必须走 CDP 真事件：本仓库已两次栽在合成 mouseenter 上（React 的 enter/leave 是从真 over/out 派生的）
    if (Number.isFinite(pt.x)) {
      for (const [dx, dy] of [[-6, -6], [0, 0], [5, 4], [0, 1]]) {
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x + dx, y: pt.y + dy, button: "none" });
        await wait(140);
      }
    }
    await wait(1400);
    const hov = await h.evaluate(`
      const bar=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0;});
      return JSON.stringify({当前可见交互数:bar.length, 有无深色动作条:!!document.querySelector('[class*=face-actions],[class*=card-actions],[class*=hover],[class*=actions]')});`);
    flow.record("悬停后控件数（用来判断动作条是否真的出现了）", String(hov.value || hov.error));
    const after = await h.evaluate(SWEEP);
    const ja = JSON.parse(String(after.value || "{}"));
    flow.record("悬停后", `可见 ${ja.可见控件数} · 无名 ${ja.无名数}`);
    for (const x of (ja.无名清单 || []).slice(0, 8)) flow.record("  无名控件", `${x.链} · role=${x.role} · ${x.宽}×${x.高} · 内含svg=${x.内含svg} 内含img=${x.内含img}`);
    merge(acc, ja);
    await h.shot("f63-a11y-shelf-hover");

    flow.section("N3 判定");
    flow.record("合计", `可见交互控件 ${acc.visible} 个，其中**无可访问名称 ${acc.nameless} 个**（${acc.visible ? ((acc.nameless / acc.visible) * 100).toFixed(1) : "0"}%）`);
    flow.record("去重后的无名控件种类", [...acc.items.keys()].slice(0, 20).join(" ⎯ "));
    flow.check("不得存在没有可访问名称的可见交互控件（读屏用户等于看不到这些按钮）", acc.nameless === 0, "0 个", { 无名: acc.nameless, 可见: acc.visible });
  } finally {
    await shutdown(h);
  }
});
