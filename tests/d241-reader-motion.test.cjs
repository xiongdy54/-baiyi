// @runtime: electron
// D241 阅读翻页动效 / 滚轮吸附 / 默认排版回归；运行：node scripts/run-tests.mjs d241-reader-motion
// 隔离：只创建临时 HTML 与合成章节，不打开应用，不读写用户数据。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutation-d241-'));
app.setPath('userData', path.join(dir, 'userdata'));
app.on('window-all-closed', () => {});
let win;
(async () => {
  await app.whenReady();
  const appearance = require('esbuild').buildSync({
    stdin: { contents: 'import {resolveAppearance, injectAppearanceStyle} from "./src/lib/reader/foliate/appearance"; window.appearanceTest = {resolveAppearance, injectAppearanceStyle};', resolveDir: path.resolve(__dirname, '..') },
    bundle: true, write: false, format: 'iife', platform: 'browser'
  }).outputFiles[0].text;
  const html = path.join(dir, 'test.html');
  fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
  win = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
  await win.loadFile(html);
  await win.webContents.executeJavaScript(appearance);
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../vendor/foliate-js/paginator.js')).href;
  const results = await win.webContents.executeJavaScript(`(async () => {
    await import(${JSON.stringify(moduleUrl)});
    const out = [], check = (name, pass, detail='') => out.push({name, pass: !!pass, detail});
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let pag, urls = [];
    async function setup(flow='paginated', rtl=false) {
      pag?.destroy(); pag?.remove(); urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
      pag = document.createElement('foliate-paginator');
      pag.style.cssText = 'display:block;width:1000px;height:700px;--reader-turn-dur:120ms;--reader-turn-out:40ms;--reader-turn-shift:16px;';
      pag.setAttribute('margin', '48px'); pag.setAttribute('max-column-count', '1');
      pag.setAttribute('max-inline-size', '720px'); pag.setAttribute('flow', flow); pag.setAttribute('animated', '');
      document.body.append(pag);
      const content = '<!doctype html><html lang="zh-CN" dir="'+(rtl?'rtl':'ltr')+'"><head><meta charset="utf-8"><style>body{font-size:18px;line-height:1.7}p{margin:0 0 1em}</style></head><body>'+ Array.from({length:90},(_,i)=>'<p>第'+i+'段。这是一段用于测试翻页、选区、章节跳转与流畅过渡的文字，确保每个章节具有多页内容。测试内容应当连续可读，不跳页不丢失位置。</p>').join('')+'</body></html>';
      urls = [0,1,2].map(() => URL.createObjectURL(new Blob([content],{type:'text/html'})));
      pag.open({dir:rtl?'rtl':'ltr',sections:urls.map(u=>({load:async()=>u}))});
      await pag.goTo({index:0}); await wait(160); return pag;
    }
    const anims = () => pag.getContents()[0].doc.defaultView.frameElement.getRootNode().getAnimations().filter(a => a.playState === 'running');
    const wheel = (x,y) => pag.dispatchEvent(new WheelEvent('wheel',{deltaX:x,deltaY:y,bubbles:true,cancelable:true}));
    await setup();
    check('分页夹具至少十页', pag.pages>10, pag.pages);
    let before=pag.page; await pag.next();
    check('章内翻页立即更新目标页', pag.page===before+1, pag.page);
    check('章内翻页使用合成层动画', anims().some(a=>a.effect.getKeyframes().some(k=>k.transform?.includes('translate'))));
    await wait(180); check('翻页后动画自然清理', anims().length===0, anims().length);
    before=pag.page; for(let i=0;i<4;i++){await pag.next();await wait(20)}
    check('连续翻页不丢键', pag.page===before+4, pag.page);
    await wait(180); before=pag.page;
    for(let i=0;i<7;i++){wheel(0,40);await wait(15)}
    await wait(180); check('竖向滚轮惯性一手势只翻一页',pag.page===before+1,pag.page);
    before=pag.page; wheel(0,40);await wait(180);
    check('停顿后下一次滚动可继续翻页',pag.page===before+1,pag.page);
    before=pag.page; wheel(pag.size*.72,0); await wait(180);
    check('大幅横滑从手势原点吸附一页而不跳页',pag.page===before+1,pag.page);
    before=pag.page; const origin=pag.start; wheel(8,0); await wait(20);
    check('小幅横滑跟手移动',pag.start>origin,pag.start-origin);
    await wait(320);check('不足阈值停手回弹原页',pag.page===before && Math.abs(pag.start-origin)<1,pag.start-origin);
    await pag.next();pag.removeAttribute('animated');
    check('关闭动效立即取消在途滑行',anims().length===0,anims().length);
    before=pag.page;await pag.next();
    check('关闭翻页动效仍正确翻页且无动画',pag.page===before+1 && anims().length===0);
    pag.setAttribute('animated','');await pag.goTo({index:1});
    check('跨章载入新章节并淡入',pag.getContents()[0].index===1 && anims().length>0);
    await wait(180);await pag.goTo({index:0});await wait(180);
    const navigating=pag.goTo({index:1});await wait(10);pag.removeAttribute('animated');await navigating;
    check('跨章途中关闭动效不会迟到重放入场',pag.getContents()[0].index===1 && anims().length===0);
    pag.setAttribute('animated','');await pag.goTo({index:0});await wait(180);await pag.prev();
    check('书首后退不进入空白页',pag.page===1 && pag.getContents()[0].index===0,pag.page);
    await pag.goTo({index:2,anchor:()=>1});await wait(180);before=pag.page;await pag.next();
    check('书尾前进不进入空白页或无效章节',pag.page===before && pag.getContents()[0].index===2,pag.page);
    await pag.snap(1,0); await wait(180);
    check('书尾触摸吸附不加载无效章节',pag.page===before && pag.getContents()[0].index===2,pag.page);
    await pag.goTo({index:1,anchor:()=>1});await wait(180);await pag.snap(1,0);
    check('触摸吸附跨章共用过渡且不落空白页',pag.getContents()[0].index===2 && pag.page===1 && anims().length>0,pag.page);
    await wait(180);
    await setup('paginated',true);before=pag.page;await pag.next();await wait(180);
    check('RTL 前进保持正确方向与页数',pag.page===before+1,pag.page);
    before=pag.page;wheel(-pag.size*.7,0);await wait(180);
    check('RTL 横滑吸附一页',pag.page===before+1,pag.page);
    await setup('scrolled'); let relocated=-1;pag.addEventListener('relocate',()=>relocated=pag.start);const start=pag.start;let turning=pag.next();await wait(45);
    check('滚动模式整屏翻页有中间位置',pag.start>start && pag.start<start+pag.size,pag.start);
    await turning; const step=pag.start-start;
    check('整屏翻页保留上下文重叠',step>pag.size*.5 && step<pag.size,step);
    check('整屏翻页 promise 在 relocate 更新后才完成',Math.abs(relocated-pag.start)<1 && pag.start>0,relocated);
    before=pag.start; turning=pag.next();await wait(30);wheel(0,2);const frozen=pag.start;await turning;await wait(180);
    check('用户滚轮立即接管缓动',Math.abs(pag.start-frozen)<1,pag.start-frozen);
    await pag.goTo({index:0,anchor:()=>0});await wait(180);before=pag.start;const first=pag.next();await wait(20);const second=pag.next();await Promise.all([first,second]);
    check('缓动中连续整屏前进不丢键',pag.start-before>pag.size*1.5,pag.start-before);
    await pag.goTo({index:0,anchor:()=>1});await wait(180);
    // First event after a pause is explicit continuation; subsequent inertia must not cross twice.
    wheel(0,60);await wait(100);for(let i=0;i<8;i++){wheel(0,12);await wait(10)}await wait(180);
    check('章界续读后惯性不连穿章节',pag.getContents()[0].index===1,pag.getContents()[0].index);
    const doc=pag.getContents()[0].doc;
    doc.documentElement.lang='ja';doc.body.innerHTML='<p id="default">読みやすい文章。</p><p id="publisher" style="text-align:left;margin-bottom:7px;font-family:Arial">Publisher</p><pre><code id="code">const x = 1;</code></pre>';
    appearanceTest.injectAppearanceStyle(doc,appearanceTest.resolveAppearance(null));
    const css=el=>doc.defaultView.getComputedStyle(doc.getElementById(el));
    check('日文默认字体使用地区字形',css('default').fontFamily.includes('CJK JP'),css('default').fontFamily);
    check('地区默认字体不覆盖代码等宽字体',css('code').fontFamily.includes('Mono'),css('code').fontFamily);
    check('出版方显式排版样式优先',css('publisher').fontFamily.includes('Arial') && css('publisher').marginBottom==='7px' && css('publisher').textAlign==='left');
    check('默认正文字号为18px',css('default').fontSize==='18px',css('default').fontSize);
    pag.destroy();pag.remove();urls.forEach(u=>URL.revokeObjectURL(u));
    return out;
  })()`);
  for (const r of results) console.log(`${r.pass?'PASS':'FAIL'} ${r.name} ${JSON.stringify(r.detail)}`);
  const failed = results.filter(r=>!r.pass).length;
  console.log(`SUMMARY ${results.length-failed}/${results.length}`);
  win.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows 上 Electron 可能仍持有 userData 锁，清理失败不得阻止退出 */ }
  app.exit(failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  win?.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 同上 */ }
  app.exit(1);
});
