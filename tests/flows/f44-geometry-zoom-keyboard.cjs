// F44 几何 · 缩放 · 键盘可达性实测
// @runtime: node  @id: F44  @tier: 3  @gui: true  @timeout: 900
// 运行：node tests/flows/f44-geometry-zoom-keyboard.cjs   （GUI 流程：真实应用 + CDP，需人工在场）
//
// 角度：既有 GUI 套件每条都在**一个窗口尺寸**上验**一个功能**的行为；
//       没有一条量过「布局与焦点系统在真实用户的显示器缩放档 / 键盘上会怎样」。
//       本条用 Emulation.setDeviceMetricsOverride 扫 8 组视口 × 5 档 deviceScaleFactor
//       （Windows 100%–200% 显示缩放的等价 CSS 视口；125% 缩放下的 1440×900 笔记本 = 1152×720 CSS），
//       在全部可达界面（6 个导航项 + 阅读器）上量：
//       ①横向溢出 ②无意截断 ③fixed/absolute 越界 ④触控/键盘目标尺寸 ⑤真实 Tab 键可达性
//       ⑥模态契约（焦点锁/Esc/焦点归还/背景滚动）⑦实盘计算对比度（含浅黄 accent 实验）⑧缩放极值。
//       断言全部来自**几何测量**；失败必带选择器链 + 矩形；每个失败复测两次再定性（CPU 争用环境）。
//
// 安全：独立 userData（label f44）+ 端口 9700 起（避开 soak 的 9620 段）+ 只 kill 自己的 PID；
//       端口冲突 / 应用提前退出 → 30 秒后重试一次，仍失败即按环境阻塞上报，绝不动别人的进程。
"use strict";
const fs = require("fs");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { launch, shutdown, wait, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F44",
  title: "几何·缩放·键盘可达性实测",
  angle: "视口×DPI 扫描 + 真实 Tab/Esc/Ctrl 键 + 实盘对比度（既有套件全部只测单一窗口尺寸）",
  cites: ["§5.1", "§5.4", "§5.5", "§7.1.6", "§4.2-2"],
  tier: 3,
  gui: true,
});

const SIZES = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [1111, 800],
  [960, 700],
  [820, 640],
  [700, 560],
  [560, 900],
];
const DSFS = [1, 1.25, 1.5, 1.75, 2]; // Windows 显示缩放 100/125/150/175/200%
const SCREENS = [
  { key: "shelf", label: "书架" },
  { key: "queue", label: "队列" },
  { key: "review", label: "复习" },
  { key: "browse", label: "卡片" },
  { key: "journal", label: "日记" },
  { key: "stats", label: "数据" },
];

const BOOK_A = "渐进阅读实用手册";
const MD_A =
  "# 第一章 渐进阅读\n\n渐进阅读的核心是把长文切成可处理的小块，并为每个小块制作记忆卡片。\n\n" +
  "# 第二章 间隔重复\n\n间隔重复依据遗忘曲线安排复习时点，FSRS 是该模型的参数化实现。\n\n" +
  "# 第三章 知识画像\n\n知识画像把卡片证据汇聚成掌握度估计，用于推荐下一步学习材料。\n";

const CJK200 = "渐进间隔重复复习卡片知识画像超长章节标题测试".repeat(10); // 200 个汉字
const LONGWORD = "pneumonoultramicroscopicsilicovolcanoconiosis".repeat(2) + "supercalifragilisticexpialidocious".repeat(2); // ≥120 latin，无空格
const STRESS_TITLE = "F44 压测书（超长章节·RTL·120字母单词）";
function buildStressMd() {
  const parts = [];
  parts.push("# " + CJK200 + "\n\n这一章的章节名有二百个汉字，用来顶破一切给标题留固定宽度的布局。\n");
  parts.push("# 章节含\u202e双向覆盖字符\u202c结尾\n\n标题里藏着 U+202E RTL override，双向算法会让行首跑到行尾去。\n");
  parts.push("# " + LONGWORD.slice(0, 120) + "\n\n正文里也塞一个超长单词：" + LONGWORD.slice(0, 120) + "，不换行就溢出。\n");
  for (let i = 1; i <= 60; i++) parts.push("# 短章" + i + "\n\n第" + i + "章正文，六十个短章节凑规模。\n");
  return parts.join("\n");
}

// ---------------- 页内测量代码（String.raw：反斜杠原样进页面；页面代码里不得出现 ` 与 ${） ----------------
const PAGE_UTIL = String.raw`
const R=(v)=>Math.round(v);
const chain=(el)=>{const parts=[];let n=el;for(let i=0;i<7&&n&&n.nodeType===1;i++){if(n===document.body){parts.unshift('body');break;}let s=n.tagName.toLowerCase();if(n.id){s+='#'+n.id;parts.unshift(s);break;}const cn=(typeof n.className==='string'?n.className.trim():'');const cls=cn.split(/\s+/).filter(Boolean).slice(0,2);if(cls.length)s+='.'+cls.join('.');const p=n.parentElement;if(p){const sib=Array.prototype.filter.call(p.children,(c)=>c.tagName===n.tagName);if(sib.length>1)s+=':nth('+(sib.indexOf(n)+1)+')';}parts.unshift(s);n=n.parentElement;}return parts.join('>');};
const vis=(el)=>{const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
const scrollAnc=(el,prop)=>{let n=el;while(n&&n.nodeType===1){const v=getComputedStyle(n)[prop];if(v==='auto'||v==='scroll')return n;n=n.parentElement;}return null;};
const pcol=(c)=>{if(!c)return null;const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);const a=p.length>3?p[3]:1;if(a<0.999)return null;return [p[0],p[1],p[2]];};
const lin=(v)=>{v=v/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
const lum=(rgb)=>0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]);
const ratio=(a,b)=>{const h=Math.max(lum(a),lum(b))+0.05,l=Math.min(lum(a),lum(b))+0.05;return +((h/l).toFixed(2));};
const bgOf=(el)=>{let n=el;while(n&&n.nodeType===1){const p=pcol(getComputedStyle(n).backgroundColor);if(p)return p;n=n.parentElement;}return [255,255,255];};
`;

const SCAN = PAGE_UTIL + String.raw`
const out={vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio};
const de=document.documentElement;
out.dw=de.scrollWidth;out.dcx=de.clientWidth;out.dh=de.scrollHeight;out.dcy=de.clientHeight;
// ① 右缘越界元素（祖先链无横向滚动容器 —— 合法滚动不算违规；overflow:hidden 的裁切祖先照样算）
const over=[];{for(const el of document.querySelectorAll('body *')){if(!vis(el))continue;const r=el.getBoundingClientRect();if(r.right>de.clientWidth+1&&r.width>2){
 if(scrollAnc(el.parentElement,'overflowX')||scrollAnc(el.parentElement,'overflowY'))continue;
 over.push({ch:chain(el),w:R(r.width),right:R(r.right),pos:getComputedStyle(el).position});}}
over.sort((a,b)=>b.w-a.w);out.over=over.slice(0,5);out.overCount=over.length;}
// ② 无意截断：限定按钮/标签/导航/标题/卡片标题/图注/hint；裁切但无 ellipsis 且无 line-clamp
const trunc=[];{const SEL='button, label, .nav-item, h1, h2, h3, h4, [class*="cap"], [class*="title"], [class*="empty-text"], [class*="form-hint"]';
const seen=new Set();
for(const el of document.querySelectorAll(SEL)){if(seen.has(el))continue;seen.add(el);if(!vis(el))continue;const cs=getComputedStyle(el);
 const hidX=cs.overflowX==='hidden'||cs.overflowX==='clip';const hidY=cs.overflowY==='hidden'||cs.overflowY==='clip';if(!hidX&&!hidY)continue;
 const clamp=cs.getPropertyValue('-webkit-line-clamp');
 const vCut=hidY&&el.scrollHeight>el.clientHeight+2;const hCut=hidX&&el.scrollWidth>el.clientWidth+2;
 if((vCut||hCut)&&cs.textOverflow!=='ellipsis'&&!clamp&&(el.textContent||'').trim().length>1){const r=el.getBoundingClientRect();
 trunc.push({ch:chain(el),rect:[R(r.width),R(r.height)],sh:el.scrollHeight,chh:el.clientHeight,sw:el.scrollWidth,cww:el.clientWidth,txt:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,22)});}}
out.trunc=trunc.slice(0,8);out.truncCount=trunc.length;}
// ③ fixed/absolute 越出可视区（祖先非滚动容器）
const clip=[];{for(const el of document.querySelectorAll('body *')){const cs=getComputedStyle(el);if(cs.position!=='fixed'&&cs.position!=='absolute')continue;if(!vis(el))continue;const r=el.getBoundingClientRect();if(r.right<=innerWidth+1&&r.bottom<=innerHeight+1)continue;
 if(scrollAnc(el.parentElement,'overflowY')||scrollAnc(el.parentElement,'overflowX'))continue;
 clip.push({ch:chain(el),pos:cs.position,rect:[R(r.left),R(r.top),R(r.width),R(r.height)],parentOvf:getComputedStyle(el.parentElement||document.body).overflow});}
clip.sort((a,b)=>(b.rect[2]*b.rect[3])-(a.rect[2]*a.rect[3]));out.clip=clip.slice(0,6);out.clipCount=clip.length;}
// ④ 触控/键盘目标 <24×24 CSS px
{let n=0;const samp=[];for(const el of document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])')){if(!vis(el))continue;const r=el.getBoundingClientRect();if(r.width<24||r.height<24){n++;if(samp.length<6)samp.push({ch:chain(el),size:[R(r.width),R(r.height)],txt:(el.textContent||'').trim().slice(0,10)});}}out.tiny=n;out.tinySamp=samp;}
// 导航六项可见性（产品的主动脉，任何尺寸掉出视口都算事故）
{const nv=[];for(const el of document.querySelectorAll('.nav-item')){const r=el.getBoundingClientRect();nv.push({t:(el.textContent||'').trim(),in:(r.right<=de.clientWidth+1&&r.left>=-1&&r.width>0),rect:[R(r.left),R(r.right)]});}out.navv=nv;}
// 导航文字换行（小屏 CJK 可逐字断行 → 按钮挤压后两行 = 视觉塌陷，rect 扫描看不见）
{const nw=[];for(const el of document.querySelectorAll('.nav-item')){const rg=document.createRange();rg.selectNodeContents(el);const rc=rg.getClientRects();const txt=(el.textContent||'').trim();if(txt&&rc.length>1){nw.push({t:txt,lines:rc.length,w:R(el.getBoundingClientRect().width)});}}out.navwrap=nw;}
// ⑦ 实盘对比度采样（computed color vs 首个不透明祖先背景）
{const S=[];
const addS=(role,el)=>{if(!el||!vis(el)){S.push({role,note:'no-el-or-hidden'});return;}const cs=getComputedStyle(el);const p=pcol(cs.color);const b=bgOf(el);const px=parseFloat(cs.fontSize);const large=px>=24||(px>=18.66&&parseInt(cs.fontWeight,10)>=700);S.push({role,fg:p?'rgb('+p.join(' ')+')':cs.color,bg:'rgb('+b.join(' ')+')',px,r:p?ratio(p,b):null,large,el:chain(el).slice(-80)});};
const pick=(sel)=>{for(const el of document.querySelectorAll(sel)){if(vis(el)&&(el.textContent||'').trim().length>4)return el;}return null;};
addS('body',pick('[class*="empty-text"], p, [class*="entry-body"], [class*="cap-title"], li, label'));
addS('secondary',document.querySelector('.nav-item'));
addS('helper',pick('[class*="topbar-title"], [class*="form-hint"]'));
{const dbs=[...document.querySelectorAll('button')].filter((b)=>b.disabled&&vis(b));addS('disabled',dbs[0]||null);}
out.contrast=S;}
// 影子/iframe 阅读正文可达性（foliate shadow root 是 closed 的 —— 探得到算赚，探不到记为覆盖缺口）
{out.frames=[];const probeIt=(hostDesc,f)=>{let ok=false,fr=null;try{const d=f.contentDocument;if(d&&d.documentElement){ok=true;let worst=null;for(const e2 of d.querySelectorAll('body *')){const b=e2.getBoundingClientRect();if(b.width>2&&b.right>d.documentElement.clientWidth+1&&(!worst||b.width>worst.w)){worst={tag:e2.tagName,w:R(b.width),right:R(b.right)};}}fr={sw:d.documentElement.scrollWidth,cw:d.documentElement.clientWidth,worst};}}catch(e){ok=false;}out.frames.push({host:String(hostDesc).slice(-40),srcStart:String(f.src||'').slice(0,20),reachable:ok,fr});};
for(const el of document.querySelectorAll('*')){if(el.shadowRoot){for(const f of el.shadowRoot.querySelectorAll('iframe'))probeIt(chain(el),f);}}
for(const f of document.querySelectorAll('iframe'))probeIt('light-dom',f);}
return out;`;

const ACT = String.raw`
const R=(v)=>Math.round(v);
const a=document.activeElement;if(!a)return null;const cs=getComputedStyle(a);const r=a.getBoundingClientRect();
const txt=((a.textContent||(a.value)||a.getAttribute&&a.getAttribute('aria-label')||a.title||'')+'').replace(/\s+/g,' ').trim().slice(0,14);
return {id:a.getAttribute?a.getAttribute('data-f44k'):null,tag:a.tagName,outline:cs.outlineWidth,ovs:cs.outlineStyle,fsz:cs.fontSize,fv:(a.matches&&a.matches(':focus-visible'))||false,rect:[R(r.left),R(r.top),R(r.width),R(r.height)],vw:innerWidth,vh:innerHeight,txt};`;

const TAG = String.raw`
const sel='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[role="button"]:not([disabled]),[tabindex]:not([tabindex="-1"])';
let i=0;const set=[];
for(const el of document.querySelectorAll(sel)){const cs=getComputedStyle(el);const r=el.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden')continue;if(r.width<=0||r.height<=0)continue;
el.setAttribute('data-f44k',String(i));
set.push({i:i,tag:el.tagName.toLowerCase(),cls:(typeof el.className==='string'?el.className.trim():'').split(/\s+/)[0]||'',txt:((el.textContent||el.value||el.getAttribute('aria-label')||el.title||'')+'').replace(/\s+/g,' ').trim().slice(0,12),rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]});i++;}
if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
return {count:i,set:set.slice(0,120)};`;

const MARKOPENER = String.raw`
const b=[...document.querySelectorAll('button')].find((x)=>/添加材料/.test(x.textContent||''));if(!b)return null;b.setAttribute('data-f44-open','1');const r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`;

const DIALOGINSIDE = String.raw`
const a=document.activeElement;if(!a)return 'none';if(a.hasAttribute&&a.hasAttribute('data-f44-open'))return 'opener';if(a.closest&&a.closest('[role="dialog"]'))return 'inside';if(a===document.body)return 'body';return 'outside:'+(a.tagName||'')+'.'+String(a.className).slice(0,18);`;

const BGSCROLL = String.raw`
const dlg=document.querySelector('[role="dialog"]');let best=null,bestA=-1;
for(const el of document.querySelectorAll('body *')){const cs=getComputedStyle(el);if(!/auto|scroll/.test(cs.overflowY))continue;if(el.scrollHeight<=el.clientHeight+4)continue;const r=el.getBoundingClientRect();if(r.width<160||r.height<120)continue;if(dlg&&dlg.contains(el))continue;const a2=r.width*r.height;if(a2>bestA){bestA=a2;best=el;}}
if(best){best.setAttribute('data-f44-sc','1');return JSON.stringify({found:true,scTop:best.scrollTop,docTop:document.documentElement.scrollTop});}
return JSON.stringify({found:false,scTop:null,docTop:document.documentElement.scrollTop});`;

const SCROLLPOS = String.raw`
const s=document.querySelector('[data-f44-sc]');return JSON.stringify({sc:s?s.scrollTop:null,doc:document.documentElement.scrollTop,body:document.body.scrollTop});`;

const MARKSET = String.raw`
const rows=[...document.querySelectorAll('input[type="color"]')];if(!rows.length)return JSON.stringify({ok:false,why:'color-input-missing'});const i=rows[0];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,'#ffe600');i.dispatchEvent(new Event('input',{bubbles:true}));return JSON.stringify({ok:true,val:i.value});`;

const ACCENTM = PAGE_UTIL + String.raw`
const S=[];const addS=(role,el)=>{if(!el||!vis(el)){S.push({role,note:'no-el'});return;}const cs=getComputedStyle(el);const p=pcol(cs.color);const b=bgOf(el);const px=parseFloat(cs.fontSize);const large=px>=24||(px>=18.66&&parseInt(cs.fontWeight,10)>=700);S.push({role,fg:p?'rgb('+p.join(' ')+')':cs.color,bg:'rgb('+b.join(' ')+')',px,r:p?ratio(p,b):null,large,el:chain(el).slice(-70)});};
addS('nav-active',document.querySelector('.nav-item.active'));
addS('nav-plain',document.querySelector('.nav-item:not(.active)'));
addS('btn-primary',(()=>{const b=[...document.querySelectorAll('.btn-primary')].find((x)=>!x.disabled&&vis(x));return b||null;})());
addS('body',(()=>{const e=[...document.querySelectorAll('p,[class*="empty-text"],label')].find((x)=>vis(x)&&(x.textContent||'').trim().length>4);return e||null;})());
const av=getComputedStyle(document.body).getPropertyValue('--accent').trim();
const aon=getComputedStyle(document.body).getPropertyValue('--accent-on').trim();
return JSON.stringify({accent:av,accentOn:aon,samples:S});`;

const NAVCOUNT = String.raw`
const R=(v)=>Math.round(v);
return [...document.querySelectorAll('.nav-item')].map((el)=>{const r=el.getBoundingClientRect();return (el.textContent||'').trim()+(r.right<=document.documentElement.clientWidth+1?':OK':':OUT@'+R(r.right));});`;

const FRAMEPROBE = String.raw`(function(){const de=document.documentElement;if(!document.body)return null;const o={href:String(location.href).slice(0,60),sw:de.scrollWidth,cw:de.clientWidth,off:[]};for(const el of document.querySelectorAll('body *')){const b=el.getBoundingClientRect();if(b.width>2&&b.right>de.clientWidth+1)o.off.push({tag:el.tagName,w:Math.round(b.width),right:Math.round(b.right)});}o.off.sort((a,b)=>b.w-a.w);return {href:o.href,sw:o.sw,cw:o.cw,off:o.off.slice(0,3)};})()`;

// ---------------- 主流程 ----------------
runFlow(flow, async () => {
  const fresh = distFreshness();
  flow.record("dist 构建 vs 最新源码", fresh.exists ? `dist 存在 · staleMs=${Math.round(fresh.staleMs || 0)}（>0 表示测的是旧构建）` : "dist 不存在（GUI 流程需先 npm run build）");
  flow.check("dist 产物在场", fresh.exists === true, true, fresh.exists);
  if (!fresh.exists) return;

  flow.section("K0 启动隔离实例（label f44 · 端口 9700 起）");
  let h = await launch({ label: "f44", port: 9700, fresh: true });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.record("首次启动被挡，30 秒后重试一次", h.reason || "未知");
    await wait(30000);
    h = await launch({ label: "f44", port: 9700, fresh: true });
  }
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("环境阻塞：隔离实例两次都起不来（不判产品缺陷，上报阻塞）", false, "可启动", h.reason || "未知");
    return;
  }
  const dir = h.dir;
  await wait(6000); // CPU 争用环境下给真实应用足够的首屏时间（§7.1.4 冷启动）

  try {
    const shotBudget = { n: 0 };
    const snap = async (name) => {
      if (!name || shotBudget.n >= 4) return;
      shotBudget.n++;
      try { await h.shot(name); } catch { /* 截图失败不影响断言 */ }
    };
    // 失败三选二定性：初测数据判红，失败才复测两遍（间歇噪声不判缺陷）
    const judge = async (name, initialOk, initialActual, remeasure, expected, shotName) => {
      if (initialOk) { flow.check(name, true, expected, "初测即过 · " + String(initialActual).slice(0, 80)); return; }
      const r2 = await remeasure();
      const r3 = r2.ok ? await remeasure() : { ok: false, actual: r2.actual };
      const fails = 1 + (r2.ok ? 0 : 1) + (r3.ok ? 0 : 1);
      if (fails >= 2) {
        flow.check(name, false, expected, String(initialActual).slice(0, 430) + ` · 含初测3次败${fails}次；复测: ${String(r2.actual).slice(0, 120)}`);
        await snap(shotName);
      } else {
        flow.record(name + "（初测败、复测2次均过 → 判间歇噪声，不判缺陷）", String(initialActual).slice(0, 220));
      }
    };

    // ---------- CDP 小工具 ----------
    const val = async (expr, dflt = null) => {
      const r = await h.evaluate(expr);
      if (r.error) { flow.record("evaluate 异常", String(r.error).slice(0, 180)); return dflt; }
      return r.value ?? dflt;
    };
    const setM = (w, hh, dsf) => h.send("Emulation.setDeviceMetricsOverride", { width: w, height: hh, deviceScaleFactor: dsf, mobile: false });
    const clearM = () => h.send("Emulation.clearDeviceMetricsOverride", {});
    const keyEvt = (type, o) => h.send("Input.dispatchKeyEvent", Object.assign({ type }, o));
    const pressTab = async (shift) => {
      const m = shift ? 8 : 0;
      await keyEvt("keyDown", { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: m });
      await keyEvt("keyUp", { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: m });
    };
    const pressEscape = async () => {
      await keyEvt("keyDown", { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await keyEvt("keyUp", { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    };
    const pressCtrl = async (minus) => {
      const o = minus
        ? { key: "-", code: "Minus", windowsVirtualKeyCode: 189, nativeVirtualKeyCode: 189, modifiers: 2 }
        : { key: "=", code: "Equal", windowsVirtualKeyCode: 187, nativeVirtualKeyCode: 187, modifiers: 2 };
      await keyEvt("keyDown", o);
      await keyEvt("keyUp", o);
    };
    const realClick = async (x, y) => {
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
      await wait(70);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
    };
    const clickElCenter = async (exprRect) => {
      const raw = await val(exprRect, "null");
      const p = JSON.parse(String(raw) || "null");
      if (!p || !Number.isFinite(p.x)) return { ok: false, p };
      await realClick(p.x, p.y);
      return { ok: true, p };
    };
    const NAVRECT = (label) => String.raw`
const b=[...document.querySelectorAll('.nav-item')].find((x)=>(x.textContent||'').trim()===${JSON.stringify(label)});if(!b)return null;const r=b.getBoundingClientRect();if(r.width<=0||r.right>innerWidth+1||r.bottom>innerHeight+1)return JSON.stringify({offscreen:true,x:Math.round(r.left),y:Math.round(r.top)});return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`;
    const navTo = async (label) => {
      await clearM();
      await wait(120);
      const raw = await val(NAVRECT(label), "null");
      const p = JSON.parse(String(raw) || "null");
      if (!p) return "nav-el-missing";
      if (p.offscreen) return "nav-offscreen@right=" + p.x;
      await realClick(p.x, p.y);
      await wait(1150);
      const active = await val(`const a=document.querySelector('.nav-item.active');return a?(a.textContent||'').trim():'none'`, "");
      return active === label ? "real-click" : "click-no-switch(active=" + active + ")";
    };
    // 非被测路径的快速导航（DOM click，只为刷数据视图）
    const navQuick = async (label) => {
      await val(`const b=[...document.querySelectorAll('.nav-item')].find((x)=>(x.textContent||'').trim()===${JSON.stringify(label)});if(b)b.click();return !!b;`, false);
      await wait(1100);
    };

    // 帧上下文收集（重放 Runtime.enable 拿既有 executionContext）
    const ctxs = [];
    h.ws.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.method === "Runtime.executionContextCreated") {
          const c = m.params.context;
          if (c && c.id && !(c.auxData && c.auxData.isDefault)) ctxs.push(c.id);
        }
      } catch { /* ignore */ }
    });

    // ---------- K1 播种 ----------
    flow.section("K1 播种：真实一本书 + 内容压测书（65 章：200汉字章节/RTL/120字母词/60短章）+ 一张卡");
    const seedA = await val(`const r=await window.libraryAPI.createFromPaste(${JSON.stringify(BOOK_A)}, ${JSON.stringify(MD_A)});return r&&r.id?'ok':'fail';`, "");
    await wait(1500);
    const seedB = await val(`const r=await window.libraryAPI.createFromPaste(${JSON.stringify(STRESS_TITLE)}, ${JSON.stringify(buildStressMd())});return r&&r.id?'ok':'fail';`, "");
    await wait(2400);
    flow.eq("两本书经 createFromPaste 落库", [seedA, seedB], ["ok", "ok"]);
    const madeCard = await val(`const api=window.cardsAPI||{};const name=['create','add','insert','createManual','save','createCard'].find((k)=>typeof api[k]==='function');if(!name)return 'no-bridge';const r=await api[name]({noteText:'F44 键盘卡',cardType:'qa',frontMarkdown:'Tab 键遍历会漏掉哪个控件？',backMarkdown:'由 F44 实测回答',priority:50,tags:[]});return r&&r.id?'ok':'no-id';`, "");
    flow.record("补种一张卡（让复习/卡片页不是空屏）", madeCard);
    // 补 10 本薄书：让书架滚动条真实存在（模态契约(d) 才有可验对象），也让小屏网格有挤压样本
    let fillers = "skipped";
    {
      const MD_F = "#  filler 章\n\n filler 正文。\n";
      const r = await val(`const names=[];for(let i=1;i<=10;i++){const t='F44 陪衬书'+i;const r=await window.libraryAPI.createFromPaste(t,${JSON.stringify(MD_F)});names.push(r&&r.id?'ok':'fail');}return names.join(',');`, "");
      fillers = String(r);
    }
    flow.record("陪衬书 10 本落库", fillers);
    await wait(2200);
    // 直连桥写入不发 library/changed —— 与 F01 同款处置：切一次屏逼书架重取
    await navQuick("卡片");
    await navQuick("书架");
    const shelfCards = await val(`return document.querySelectorAll('.book-card').length`, 0);
    flow.record("书架上可见的书卡数", shelfCards);
    flow.record("真实窗口内视口（clearDeviceMetricsOverride 之后基准）", await val(`return innerWidth+'×'+innerHeight+' dpr='+devicePixelRatio`, "?"));
    await wait(2000);
    const bodyText = String((await val(`return document.body.innerText.slice(0,200)`, "")) || "");
    flow.check("界面渲染（非白屏/崩溃页）", bodyText.length > 20 && !/A JavaScript error/.test(bodyText), ">20字符", bodyText.slice(0, 60));

    // ---------- K2 模态契约（真实鼠标 + 真实按键） ----------
    flow.section("K2 检6 模态契约：添加材料对话框（焦点锁 / Esc / 焦点归还 / 背景滚动）");
    flow.record("进入书架", await navTo("书架"));
    const opm = JSON.parse(String((await val(MARKOPENER, "null")) || "null") || "null");
    flow.check("「添加材料」按钮在场且可打点", !!opm && Number.isFinite(opm.x), "按钮中心", opm);
    const reopenModal = async () => {
      const o = JSON.parse(String((await val(MARKOPENER, "null")) || "null") || "null");
      if (!o) return false;
      await realClick(o.x, o.y);
      await wait(900);
      return (await val(`return document.querySelectorAll('[role="dialog"]').length`, 0)) === 1;
    };
    if (opm && Number.isFinite(opm.x)) {
      const openedM = await reopenModal();
      flow.check("真实鼠标点「添加材料」打开对话框", openedM === true, true, openedM);
      if (openedM) {
        // (a) Tab 焦点锁
        const trapHops = [];
        for (let i = 0; i < 15; i++) { await pressTab(false); trapHops.push(await val(DIALOGINSIDE, "eval-err")); }
        const escaped = trapHops.map((t, i) => (t === "inside" ? null : i + ":" + t)).filter(Boolean);
        await judge("模态(a) 打开期间真实 Tab×15 不落对话框之外（焦点锁）", escaped.length === 0, "逃逸=" + JSON.stringify(escaped).slice(0, 200), async () => {
          const hops = [];
          for (let i = 0; i < 12; i++) { await pressTab(false); hops.push(await val(DIALOGINSIDE, "eval-err")); }
          const bad = hops.filter((t) => t !== "inside");
          return { ok: bad.length === 0, actual: bad.length ? "逃逸 " + JSON.stringify(bad).slice(0, 160) : "复测12跳全在面板内" };
        }, "0 逃逸", "f44-trap-leak");
        // (d) 背景不可滚
        const bg = JSON.parse(String((await val(BGSCROLL, '{"found":false,"scTop":null,"docTop":0}')) || "{}"));
        await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(opm.x), y: 420, deltaX: 0, deltaY: 400, button: "none", buttons: 0 });
        await wait(250);
        await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(opm.x), y: 420, deltaX: 0, deltaY: 400, button: "none", buttons: 0 });
        await wait(450);
        const sp = JSON.parse(String((await val(SCROLLPOS, '{"sc":null,"doc":0,"body":0}')) || "{}"));
        flow.record("背景滚动容器在场？", bg.found ? "有（data-f44-sc，原 scrollTop=" + bg.scTop + "）" : "无 → 此检只覆盖文档级滚动，判弱证据");
        const bgOk = sp.doc === 0 && sp.body === 0 && (sp.sc === null || sp.sc === bg.scTop);
        await judge("模态(d) 打开期间背后文档/列表滚不动（真实滚轮事件）", bgOk, `wheel后 sc=${sp.sc}(原${bg.scTop}) doc=${sp.doc}`, async () => {
          const s2 = JSON.parse(String((await val(SCROLLPOS, '{"sc":null,"doc":0,"body":0}')) || "{}"));
          return { ok: s2.doc === 0 && (s2.sc === null || s2.sc === bg.scTop), actual: "复测 sc=" + s2.sc + " doc=" + s2.doc };
        }, "滚动位置不动", "f44-bgscroll");
        // (b) Esc 关闭
        await pressEscape();
        await wait(800);
        const stillOpen = await val(`return document.querySelectorAll('[role="dialog"]').length`, -1);
        await judge("模态(b) 真实 Esc 键关闭对话框", stillOpen === 0, "dialog数=" + stillOpen, async () => {
          const re = await reopenModal();
          await pressEscape(); await wait(700);
          const n = await val(`return document.querySelectorAll('[role="dialog"]').length`, -1);
          return { ok: re && n === 0, actual: "重开=" + re + " Esc后dialog=" + n };
        }, "0", "f44-esc");
        // (c) 焦点归还 opener —— 完整周期复测两遍（重开→Esc→查焦点）再定性
        const back = await val(`const a=document.activeElement;return a&&a.getAttribute?(a.getAttribute('data-f44-open')==='1'?('returned:'+(a.textContent||'').trim()):('not-opener:'+a.tagName+'.'+String(a.className).slice(0,20))):'?'`, "");
        await judge("模态(c) 关闭后焦点回到「添加材料」按钮（dialogA11y 契约第4条）", String(back).startsWith("returned"), back, async () => {
          const re = await reopenModal();
          if (!re) return { ok: false, actual: "重开对话框失败" };
          await pressEscape();
          await wait(800);
          const b2 = await val(`const a=document.activeElement;return a&&a.getAttribute?(a.getAttribute('data-f44-open')==='1'?('returned:'+(a.textContent||'').trim()):('not-opener:'+a.tagName+'.'+String(a.className).slice(0,20))):'?'`, "");
          return { ok: String(b2).startsWith("returned"), actual: "整周期复测=" + b2 };
        }, "returned:添加材料", "f44-focreturn");
      }
    }

    // ---------- K3 打开压测书 + 帧可达性 ----------
    flow.section("K3 真实鼠标打开压测书（200字章节名/RTL/120字母词）进阅读器");
    const cardRect = String.raw`
const cards=[...document.querySelectorAll('.book-card,[class*="book-card"]')];
const t=cards.find((e)=>(e.textContent||'').includes(${JSON.stringify(STRESS_TITLE.slice(0, 12))}))||cards[0];
if(!t)return null;t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),cls:String(t.className).slice(0,30)});`;
    const openedBk = await clickElCenter(cardRect);
    await wait(4200);
    const readerOn = await val(`return !!document.querySelector('.reader-wrap,[class*="reader-wrap"]')`, false);
    flow.check("真实鼠标点书卡进入阅读器", openedBk.ok === true && readerOn === true, true, { click: openedBk.p && openedBk.p.x + "," + openedBk.p.y, readerOn });
    ctxs.length = 0;
    await h.send("Runtime.enable");
    await wait(600);
    const frameRead = [];
    flow.record("非默认 executionContext 数（帧旁路基数）", ctxs.length);
    for (const cid of ctxs.slice(0, 12)) {
      try {
        const r = await h.send("Runtime.evaluate", { expression: "String(location.href).slice(0,80)", returnByValue: true, contextId: cid });
        const href = (r && r.result && r.result.result && r.result.result.value) || "";
        if (href && !/index\.html/.test(href)) {
          const p = await h.send("Runtime.evaluate", { expression: FRAMEPROBE, returnByValue: true, contextId: cid });
          const v = p && p.result && p.result.result && p.result.result.value;
          if (v) frameRead.push(v);
        }
      } catch { /* 帧可能已销毁 */ }
    }
    flow.record("EPUB 帧经 executionContext 读数（正文越界=⑫0字母单词布局事故的第一手证据）", JSON.stringify(frameRead).slice(0, 300));
    await pressEscape(); // 离开阅读器路径上的浮层（如有）；不离开视图
    await wait(300);

    // ---------- K4 键盘可达性（真实 Tab）逐屏 ----------
    flow.section("K4 检5 真实 Tab×40 键盘遍历：焦点不丢 / 覆盖全部可见控件 / :focus-visible 描边（1280×800）");
    const kbResults = [];
    for (const sc of SCREENS) {
      const nav = await navTo(sc.label);
      await setM(1280, 800, 1);
      await wait(320);
      const tag = await val(TAG, { count: 0, set: [] });
      const hops = [];
      for (let i = 0; i < 40; i++) {
        await pressTab(false);
        const a = await val(ACT, null);
        hops.push(a || { tag: "EVAL-ERR", id: null });
      }
      kbResults.push({ sc: sc.label, nav, tag, hops });
      await clearM();
    }
    for (const { sc, nav, tag, hops } of kbResults) {
      flow.record(`键盘遍历[${sc}]`, `导航=${nav} · 可见可聚焦=${tag.count} · 入列对比=${tag.set.length}`);
      const lost = hops.map((x, i) => (x.tag === "BODY" || x.tag === "HTML" || x.tag === "EVAL-ERR" ? i + ":" + x.tag : null)).filter((x) => x !== null);
      await judge(`[${sc}] 检5a Tab×40 途中焦点从未掉回 body（失焦=断链）`, lost.length === 0, "落点=" + JSON.stringify(lost).slice(0, 160), async () => {
        await setM(1280, 800, 1); await wait(240);
        const hs = [];
        for (let i = 0; i < 40; i++) { await pressTab(false); hs.push(await val(ACT, null)); }
        await clearM();
        const l = hs.map((x, i) => (!x || x.tag === "BODY" || x.tag === "HTML" ? i : null)).filter((x) => x !== null);
        return { ok: l.length === 0, actual: l.length ? "复测仍在第 " + l.join(",") + " 跳落空" : "复测40跳干净（判噪声）" };
      }, "0 次落 body", "f44-kb-" + sc);
      const reached = new Set(hops.filter((x) => x.id !== null && x.id !== undefined).map((x) => Number(x.id)));
      const missing = tag.set.filter((e) => !reached.has(e.i));
      const covOk = tag.count > 38 || missing.length === 0;
      await judge(`[${sc}] 检5b Tab×40 覆盖全部可见可聚焦控件（DOM 集 vs 到达集）`, covOk, `控件${tag.count}个 够不到${missing.length}个: ` + JSON.stringify(missing.slice(0, 6)).slice(0, 300), async () => {
        const t2 = await val(TAG, { count: 0, set: [] });
        const hs = [];
        for (let i = 0; i < 40; i++) { await pressTab(false); hs.push(await val(ACT, null)); }
        const r2 = new Set(hs.filter(Boolean).filter((x) => x.id !== null && x.id !== undefined).map((x) => Number(x.id)));
        const m2 = t2.set.filter((e) => !r2.has(e.i));
        return { ok: t2.count > 38 || m2.length === 0, actual: "复测 控件" + t2.count + " 够不到" + m2.length + (m2.length ? " " + JSON.stringify(m2.slice(0, 4)).slice(0, 200) : "") };
      }, "全覆盖（或>38控件需长循环，见 actual）", "f44-cov-" + sc);
      if (tag.count > 38) flow.record(`[${sc}] 检5b 附注`, "可见控件 " + tag.count + " > 40跳 遍历深度 → 判「不可证」而非「不可达」");      const head = hops.slice(0, 12).filter((x) => x.id !== null);
      const fvBad = head.filter((x) => x.fv !== true);
      const olBad = head.filter((x) => x.outline === "0px" || x.ovs === "none");
      await judge(`[${sc}] 检5c 真实 Tab 后 :focus-visible 描边真的渲染（fv 且 outline≠0px；element.focus() 会假绿，此用真实键）`, fvBad.length === 0 && olBad.length === 0, "fv缺=" + JSON.stringify(fvBad.slice(0, 3).map((x) => x.tag + "(" + x.txt + ")")).slice(0, 160) + " outline缺=" + JSON.stringify(olBad.slice(0, 3).map((x) => x.tag + ":" + x.outline)).slice(0, 140), async () => {
        await setM(1280, 800, 1); await wait(240);
        const bad = [];
        for (let i = 0; i < 40; i++) {
          await pressTab(false);
          const a = await val(ACT, null);
          if (a && a.id !== null && (a.outline === "0px" || a.ovs === "none" || a.fv !== true)) bad.push(i + ":" + a.tag + "(" + (a.txt || "") + ")fv=" + a.fv + "ol=" + a.outline);
        }
        await clearM();
        return { ok: bad.length === 0, actual: bad.length ? "复测40跳仍缺: " + bad.join(" ").slice(0, 220) : "复测40跳 fv=true 描边在（判噪声）" };
      }, "fv+outline 全过", "f44-fv-" + sc);
      const offv = hops.filter((x) => x.id !== null && x.rect && x.rect[0] + x.rect[2] > x.vw + 2);
      if (offv.length) flow.record(`[${sc}] 焦点停在视口外的跳（浏览器应自动滚动，不自动=缺陷）`, JSON.stringify(offv.slice(0, 2)).slice(0, 220));
    }
    // Shift+Tab 反向（书架）
    await navTo("书架");
    await wait(400);
    await val(`if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return 1;`, 1);
    const rev = [];
    for (let i = 0; i < 5; i++) { await pressTab(true); rev.push(await val(ACT, null)); }
    const revKeys = new Set(rev.filter(Boolean).map((x) => String(x.id) + ":" + x.txt));
    flow.check("Shift+Tab 反向遍历会移动焦点", revKeys.size >= 3, "≥3 个落点", JSON.stringify(revKeys).slice(0, 160));

    // ---------- K5 几何扫描 ----------
    flow.section("K5 检1-4 几何扫描：8 视口 × DSF（书架 5 档 / 其余 2 档）· 每点双测取交集（第二次即复测）");
    const sweepPts = {};
    for (const sc of [...SCREENS.map((s) => ({ key: s.key, label: s.label })), { key: "reader", label: null }]) {
      let how;
      if (sc.key === "reader") {
        await navTo("书架");
        await wait(900);
        const o = await clickElCenter(cardRect);
        await wait(3800);
        how = o.ok ? "real-click" : "click-fail";
      } else {
        how = await navTo(sc.label);
      }
      flow.record("进入界面[" + sc.key + "]", how);
      const pts = [];
      const dsfList = sc.key === "shelf" ? DSFS : [1, 1.25];
      for (const [w, hh] of SIZES) {
        for (const dsf of dsfList) {
          await setM(w, hh, dsf);
          await wait(260);
          const a = await val(SCAN, null);
          const b = await val(SCAN, null);
          pts.push({ w, hh, dsf, a, b });
        }
      }
      await clearM();
      sweepPts[sc.key] = pts;
    }
    const merged = (p) => {
      if (p._m) return p._m;
      const a = p.a || {}, b = p.b || {};
      const inter = (la, lb) => { const sb = new Set((lb || []).map((x) => x.ch)); return (la || []).filter((x) => sb.has(x.ch)); };
      p._m = {
        over: inter(a.over, b.over), trunc: inter(a.trunc, b.trunc), clip: inter(a.clip, b.clip),
        dw: Math.max(a.dw || 0, b.dw || 0), dcx: Math.max(a.dcx || 0, b.dcx || 0),
        tiny: Math.max(a.tiny || 0, b.tiny || 0), tinySamp: ((a.tinySamp || []).length ? a.tinySamp : b.tinySamp) || [],
        navv: b.navv || [], navwrap: b.navwrap || [], contrast: b.contrast || [], frames: b.frames || [],
        unstable: (a.overCount || 0) !== (b.overCount || 0) || (a.tiny || 0) !== (b.tiny || 0) || Math.abs((a.dw || 0) - (b.dw || 0)) > 1,
      };
      return p._m;
    };
    const vp = (p) => `${p.w}×${p.hh}@${p.dsf}`;
    const fmtList = (m, cat) => (m[cat] || []).slice(0, 3).map((x) => `${String(x.ch).slice(0, 66)} {${x.rect ? "rect=" + JSON.stringify(x.rect) : "w=" + x.w + ",right=" + x.right}}`).join(" ‖ ");
    const bad = (pts, cat) => pts.filter((p) => merged(p)[cat].length > 0 || (cat === "over" && merged(p).dw > merged(p).dcx + 1));
    const actualOf = (pts, cat) => {
      const bl = bad(pts, cat);
      if (!bl.length) return `全部${pts.length}扫描点双测交集干净`;
      return bl.slice(0, 4).map((p) => { const m = merged(p); const pg = m.dw > m.dcx + 1; return `[${vp(p)}]${pg ? `页${m.dw}>${m.dcx} ` : ""}` + (m[cat].length ? fmtList(m, cat) : "仅页级溢出"); }).join(" ; ").slice(0, 430);
    };
    const remeasureCat = (h2, pts, cat) => async () => {
      const targets = bad(pts, cat).slice(0, 2);
      let anyBad = false; const detail = [];
      for (const p of targets) {
        await setM(p.w, p.hh, p.dsf);
        await wait(280);
        const s1 = await val(SCAN, null); const s2 = await val(SCAN, null);
        const it = (la, lb) => { const sb = new Set((lb || []).map((x) => x.ch)); return (la || []).filter((x) => sb.has(x.ch)); };
        const aa = s1 || {}, bb = s2 || {};
        const list = it(aa[cat], bb[cat]);
        const pageBad = cat === "over" && Math.max(aa.dw || 0, bb.dw || 0) > Math.max(aa.dcx || 0, bb.dcx || 0) + 1;
        if (list.length || pageBad) { anyBad = true; detail.push(`[${vp(p)}]${pageBad ? `页${Math.max(aa.dw, bb.dw)}>${Math.max(aa.dcx, bb.dcx)} ` : ""}` + fmtList({ [cat]: list }, cat)); }
        await clearM();
      }
      return { ok: !anyBad, actual: anyBad ? detail.join(" ; ").slice(0, 260) : "复测两遍后消失 → 噪声候选" };
    };
    for (const key of Object.keys(sweepPts)) {
      const pts = sweepPts[key];
      flow.record(`[${key}] 双测不稳定点（噪声预警）`, pts.filter((p) => merged(p).unstable).map(vp).join(",") || "无");
      await judge(`[${key}] 检1 无横向页溢出、无「非滚动容器内」越界元素（${pts.length} 点）`, bad(pts, "over").length === 0, actualOf(pts, "over"), remeasureCat(null, pts, "over"), "0 违规", "f44-ovf-" + key);
      await judge(`[${key}] 检2 无「非 ellipsis 非 clamp」的文本裁切（隐藏 overflow 且 scrollHeight>clientHeight+2）`, bad(pts, "trunc").length === 0, actualOf(pts, "trunc"), remeasureCat(null, pts, "trunc"), "0 裁切", "f44-cut-" + key);
      await judge(`[${key}] 检3 fixed/absolute 元素不越可视区右缘/下缘`, bad(pts, "clip").length === 0, actualOf(pts, "clip"), remeasureCat(null, pts, "clip"), "0 越界", "f44-clip-" + key);
      flow.record(`[${key}] 检4 <24×24 交互控件数（dsf=1 各尺寸）`, pts.filter((p) => p.dsf === 1).map((p) => `${p.w}×${p.hh}:${merged(p).tiny}`).join(", "));
      const tsamp = merged(pts[0]).tinySamp;
      if (tsamp.length) flow.record(`[${key}] <24px 样本`, JSON.stringify(tsamp.map((x) => x.ch.slice(-44) + "=" + JSON.stringify(x.size))).slice(0, 320));
      if (key === "reader") {
        const fr = merged(pts.find((p) => p.dsf === 1) || pts[0]).frames;
        flow.record("阅读器帧可达性（foliate closed shadow · 覆盖缺口如实记）", JSON.stringify(fr).slice(0, 300));
        flow.record("阅读器越界元素明细", JSON.stringify(bad(pts, "over").slice(0, 3).map((p) => ({ at: vp(p), over: merged(p).over.slice(0, 2) }))).slice(0, 420));
      }
    }
    // 导航六项 × 全尺寸可见性
    const navViol = [];
    for (const key of Object.keys(sweepPts)) {
      for (const p of sweepPts[key]) {
        for (const nv of merged(p).navv) if (!nv.in) navViol.push(`${key}@${p.w}×${p.h}@${p.dsf}:${nv.t}${JSON.stringify(nv.rect)}`);
      }
    }
    await judge("导航「书架/队列/复习/卡片/日记/数据」六项在全部尺寸×全部屏都在视口内", navViol.length === 0, JSON.stringify(navViol).slice(0, 300), async () => {
      let badNow = [];
      for (const [w, hh] of [[560, 900], [700, 560], [820, 640]]) {
        await setM(w, hh, 1); await wait(260);
        const s = await val(NAVCOUNT, []);
        badNow = badNow.concat((s || []).filter((x) => /:OUT/.test(String(x))).map((x) => w + "×" + hh + " " + x));
        await clearM();
      }
      return { ok: badNow.length === 0, actual: badNow.length ? badNow.join(" | ").slice(0, 260) : "复测 560/700/820 宽全 OK" };
    }, "6×全尺寸在视口内", "f44-nav");
    // 导航文字单行性（CJK 逐字断行在窄屏把顶栏按钮压成两行 —— rect 扫描不可见，用 Range rects 抓）
    const wrapViol = [];
    for (const key of Object.keys(sweepPts)) {
      for (const p of sweepPts[key]) {
        for (const w of merged(p).navwrap) wrapViol.push(`${key}@${p.w}×${p.hh}@${p.dsf}:${w.t}=${w.lines}行(按钮宽${w.w}px)`);
      }
    }
    await judge("导航文字在全部尺寸×全部屏保持单行（换行=顶栏视觉塌陷）", wrapViol.length === 0, JSON.stringify(wrapViol).slice(0, 380), async () => {
      await navQuick("队列"); // 带 topbar-title 的屏才挤占导航宽度（书架不渲染标题）
      let wNow = [];
      for (const [w2, h2] of [[560, 900], [700, 560], [820, 640]]) {
        await setM(w2, h2, 1); await wait(260);
        const s = await val(String.raw`
const nw=[];for(const el of document.querySelectorAll('.nav-item')){const rg=document.createRange();rg.selectNodeContents(el);const rc=rg.getClientRects();if((el.textContent||'').trim()&&rc.length>1)nw.push((el.textContent||'').trim()+"×"+rc.length+"行@宽"+Math.round(el.getBoundingClientRect().width)+"px");}
return nw;`, []);
        wNow = wNow.concat((s || []).map((x) => w2 + "×" + h2 + " " + x));
        await clearM();
      }
      return { ok: wNow.length === 0, actual: wNow.length ? wNow.join(" | ").slice(0, 260) : "复测 560/700/820 全单行" };
    }, "全单行", "f44-navwrap");
    // 检4 阈值（最小视口主控件可命中）—— 真实测量先行，失败才复测定性
    const tinyMeas = async () => {
      await setM(560, 900, 1); await wait(260);
      const r = await val(String.raw`
const bad=[];for(const el of document.querySelectorAll('.nav-item, .btn-primary')){const b=el.getBoundingClientRect();if(b.width>0&&(b.height<24||b.width<24))bad.push((el.textContent||'').trim().slice(0,8)+':'+Math.round(b.width)+'x'+Math.round(b.height));}
return bad;`, []);
      await clearM();
      return { ok: !(r && r.length), actual: (r && r.length) ? r.join(",") : "主控件最小 24px 达标（小控件总数在 record）" };
    };
    const t1 = await tinyMeas();
    await judge("检4 阈值：560×900 下导航项与 .btn-primary 主控件仍可命中（≥24×24）", t1.ok, t1.actual, tinyMeas, "主控件≥24", "f44-tiny");

    // ---------- K6 对比度 ----------
    flow.section("K6 检7 实盘对比度（computed 前景/背景，非 token 推断）+ 浅黄 accent 实验");
    for (const key of Object.keys(sweepPts)) {
      const p1280 = sweepPts[key].find((p) => p.w === 1280 && p.dsf === 1);
      if (!p1280) continue;
      const S = merged(p1280).contrast;
      flow.record(`对比度[${key}]@1280×800`, JSON.stringify(S).slice(0, 420));
      const hard = S.filter((x) => x.r != null && ["body", "secondary"].includes(x.role));
      const fail = hard.filter((x) => x.r < (x.large ? 3 : 4.5));
      const dis = S.filter((x) => x.role === "disabled" && x.r != null);
      if (dis.length) flow.record(`[${key}] disabled 按钮前景/背景对（WCAG 1.4.3 豁免，只报不判）`, JSON.stringify(dis.map((x) => ({ r: x.r, fg: x.fg, bg: x.bg, el: x.el }))).slice(0, 260));
      await judge(`[${key}] 检7a body/secondary 文字对比度（body≥4.5:1，大字≥3:1）`, fail.length === 0, JSON.stringify(fail).slice(0, 300), async () => {
        const sc0 = SCREENS.find((s) => s.key === key);
        await navQuick(sc0 ? sc0.label : "书架");
        await setM(1280, 800, 1); await wait(320);
        const s = await val(SCAN, null);
        await clearM();
        const cs = ((s && s.contrast) || []).filter((x) => x.r != null && ["body", "secondary"].includes(x.role));
        const f = cs.filter((x) => x.r < (x.large ? 3 : 4.5));
        return { ok: f.length === 0, actual: f.length ? JSON.stringify(f).slice(0, 240) : "复测全过 " + JSON.stringify(cs.map((x) => x.role + "=" + x.r)) };
      }, "全部≥阈值", "f44-contrast-" + key);
      flow.record(`[${key}] helper 档观察值（12-13px 辅助文字，只报不判）`, JSON.stringify(S.filter((x) => x.role === "helper").map((x) => (x.r != null ? { r: x.r, fg: x.fg, bg: x.bg, px: x.px, el: x.el } : { note: x.note })).slice(0, 2)).slice(0, 260));
    }
    await navTo("书架");
    const setBtn = await clickElCenter(String.raw`const b=document.querySelector('.icon-btn[title="设置"]');if(!b)return null;const r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`);
    await wait(1100);
    const setOk = await val(`return document.querySelectorAll('[role="dialog"]').length`, 0);
    flow.check("真实鼠标能打开设置对话框（accent 实验的前置）", setBtn.ok === true && setOk === 1, 1, { click: setBtn.ok, dialogs: setOk });
    const setColor = JSON.parse(String((await val(MARKSET, '{"ok":false,"why":"eval-fail"}')) || "{}"));
    flow.record("设置强调色 #ffe600", JSON.stringify(setColor));
    await wait(1000);
    const am = JSON.parse(String((await val(ACCENTM, '{"accent":"","accentOn":"","samples":[]}')) || "{}"));
    flow.record("浅黄 accent 生效值 + 采样", JSON.stringify({ accent: am.accent, accentOn: am.accentOn, samples: (am.samples || []).map((s) => s.role + ":" + s.fg + " on " + s.bg + " =" + s.r) }).slice(0, 460));
    const amNav = (am.samples || []).find((s) => s.role === "nav-active");
    await judge("检7b 自定义浅 accent 下：当前导航项以 accent 原色作文字色，仍可读（≥4.5:1）", !amNav || amNav.r == null || amNav.r >= 4.5, (amNav && "nav-active=" + amNav.r + ":1 " + amNav.fg + " on " + amNav.bg) || "无样本", async () => {
      const m2 = JSON.parse(String((await val(ACCENTM, '{"samples":[]}')) || "{}"));
      const n2 = (m2.samples || []).find((s) => s.role === "nav-active") || { r: 99 };
      return { ok: n2.r == null || n2.r >= 4.5, actual: "复测 " + n2.r + ":1 (" + n2.fg + " on " + n2.bg + ")" };
    }, "≥4.5:1", "f44-accent");
    const amBtn = (am.samples || []).find((s) => s.role === "btn-primary");
    flow.check("检7c 浅 accent 上主按钮文字经 --accent-on 换黑后 ≥4.5:1（accentVar.ts 契约）", !amBtn || amBtn.r == null || amBtn.r >= 4.5, "≥4.5:1", amBtn ? amBtn.r + ":1 " + amBtn.fg + " on " + amBtn.bg : "no-btn");
    await val(String.raw`const b=[...document.querySelectorAll('button')].find((x)=>/恢复默认/.test(x.textContent||''));if(b)b.click();return !!b;`, false);
    await wait(800);
    await pressEscape();
    await wait(700);

    // ---------- K7 缩放极值 ----------
    flow.section("K7 检8 缩放极值：Ctrl+=/Ctrl+- 真实键 ×5/×5 + pageScaleFactor + 阅读器列内");
    await navTo("书架");
    await wait(800);
    await clickElCenter(cardRect);
    await wait(3600);
    const zoomProbe = String.raw`return JSON.stringify({iw:innerWidth,dw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,fsz:getComputedStyle(document.body).fontSize,dpr:devicePixelRatio,vv:window.visualViewport?Math.round(visualViewport.width):null});`;
    const zoomBase = await val(zoomProbe, "");
    for (let i = 0; i < 5; i++) { await pressCtrl(false); await wait(50); }
    await wait(500);
    const zoomUp = await val(zoomProbe, "");
    for (let i = 0; i < 5; i++) { await pressCtrl(true); await wait(50); }
    await wait(300);
    for (let i = 0; i < 5; i++) { await pressCtrl(false); await wait(50); }
    await wait(500);
    const zoomDn = await val(zoomProbe, "");
    flow.record("Ctrl+= ×5 → Ctrl+- ×5 → Ctrl+= ×5（innerWidth/scrollWidth/body字号）", `${zoomBase} → up ${zoomUp} → back ${zoomDn}`);
    const zoomDid = String(zoomBase) !== String(zoomUp) || String(zoomUp) !== String(zoomDn);
    await judge("检8a 应用自身对 Ctrl+=/Ctrl+- 有可见反应（缩放手段在场）", zoomDid, "5连按+5连按布局/字号零反应", async () => {
      await pressCtrl(false); await wait(160);
      const a1 = await val(zoomProbe, "");
      await pressCtrl(false); await wait(160);
      const a2 = await val(zoomProbe, "");
      return { ok: a1 !== a2, actual: "复测两按仍零反应（commands.ts 无缩放键位 · 菜单已摘 electron/main.js:1278）" };
    }, "有反应", "f44-zoomkeys");
    for (const ps of [1.25, 1.5]) {
      const psMeas = async () => {
        await h.send("Emulation.setPageScaleFactor", { factor: ps });
        await wait(350);
        const s = await val(SCAN, null);
        const s2 = await val(SCAN, null);
        const okv = !!s2 && s2.dw <= s2.dcx + 1 && !!s && s.dw <= s.dcx + 1;
        return { ok: okv, actual: "ps=" + ps + " 双测 scrollW=" + (s && s.dw) + "/" + (s2 && s2.dw) + " vs clientW=" + (s2 && s2.dcx) };
      };
      const r0 = await psMeas();
      flow.record(`pageScaleFactor=${ps} 全量读数`, JSON.stringify({ vw: r0.actual }).slice(0, 120));
      await judge(`检8b pageScaleFactor=${ps} 下无横向页溢出`, r0.ok, r0.actual, psMeas, "scrollW≤clientW+1", "f44-ps" + ps);
      await h.send("Emulation.setPageScaleFactor", { factor: 1 });
    }
    await setM(1920, 1080, 1);
    await wait(300);
    const rdScan = await val(SCAN, null);
    const rdCol = await val(String.raw`
const v=document.querySelector('.reader-engine-viewport,.reader-wrap');if(!v)return null;const r=v.getBoundingClientRect();const de=document.documentElement;
return JSON.stringify({w:Math.round(r.width),right:Math.round(r.right),fits:r.right<=de.clientWidth+1&&r.left>=-1});`, null);
    const rdOk = !!rdScan && rdScan.dw <= rdScan.dcx + 1 && !!rdCol && JSON.parse(rdCol).fits !== false;
    await judge("检8c 1920×1080 阅读器：正文容器在列内且无横向溢出", rdOk, `scrollW=${rdScan && rdScan.dw} vs ${rdScan && rdScan.dcx} · 容器 ${rdCol}`, async () => {
      const s = await val(SCAN, null);
      const c = await val(String.raw`
const v=document.querySelector('.reader-engine-viewport,.reader-wrap');if(!v)return null;const r=v.getBoundingClientRect();
return JSON.stringify({fits:r.right<=document.documentElement.clientWidth+1&&r.left>=-1});`, null);
      const ok = !!s && s.dw <= s.dcx + 1 && !!c && JSON.parse(c).fits !== false;
      return { ok, actual: "复测 scrollW=" + (s && s.dw) + " vs " + (s && s.dcx) + " · " + c };
    }, "容器在列内", "f44-reader-col");
    await clearM();

    // ---------- K8 收尾 ----------
    flow.section("K8 收尾");
    const alive = await val(`return !!document.querySelector('#root') && document.body.innerText.length>20`, false);
    flow.check("整条流程跑完界面仍存活（无崩溃白屏）", alive === true, true, alive);
    flow.record("检4/检7/帧可达性 的已知覆盖缺口", "foliate 正文在 closed shadow root（vendor/foliate-js/view.js:215），顶层 SCAN 探不到时以 executionContext 旁路读数（见 K3/K5 record）");
  } finally {
    try {
      await Promise.race([
        h.send("Emulation.clearDeviceMetricsOverride", {}),
        wait(1500),
      ]);
    } catch { /* ws 可能已关 */ }
    await shutdown(h);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄未释放 */ }
  }
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
