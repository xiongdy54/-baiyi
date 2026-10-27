// @runtime: electron
// D242 触控板惯性跨章回归：真实输入事件（webContents.sendInputEvent，带原生滚动）模拟两指滑动 + 惯性尾巴；
// 运行：node scripts/run-tests.mjs d242-reader-inertia
// 隔离：只创建临时 HTML 与合成章节，不打开应用，不读写用户数据。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutation-d242-'));
app.setPath('userData', path.join(dir, 'userdata'));
app.on('window-all-closed', () => {});
let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  const html = path.join(dir, 'test.html');
  fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
  win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: true, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
  await win.loadFile(html);
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../vendor/foliate-js/paginator.js')).href;
  const js = (code) => win.webContents.executeJavaScript(code);
  await js(`(async () => {
    await import(${JSON.stringify(moduleUrl)});
    window.wait = ms => new Promise(r => setTimeout(r, ms));
    window.setup = async (flow, paras) => {
      window.pag?.destroy(); window.pag?.remove();
      const pag = window.pag = document.createElement('foliate-paginator');
      pag.style.cssText = 'display:block;width:1000px;height:700px;--reader-turn-dur:160ms;--reader-turn-out:60ms;--reader-turn-shift:16px;';
      pag.setAttribute('margin', '48px'); pag.setAttribute('max-column-count', '1');
      pag.setAttribute('max-inline-size', '720px'); pag.setAttribute('flow', flow); pag.setAttribute('animated', '');
      document.body.append(pag);
      const body = i => '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-size:18px;line-height:1.7;margin:0}p{margin:0 0 1em}</style></head><body><h1 id="top">第'+i+'章</h1>' + Array.from({length:paras},(_,k)=>'<p>第'+i+'章第'+k+'段。用于测试触控板惯性滚动跨越章节时的行为：切到下一章后应停在章首，不被余下的惯性带走。</p>').join('') + '</body></html>';
      const urls = [0,1,2,3].map(i => URL.createObjectURL(new Blob([body(i)],{type:'text/html'})));
      pag.open({dir:'ltr',sections:urls.map(u=>({load:async()=>u}))});
      await pag.goTo({index:0}); await wait(200);
    };
    window.state = () => ({ index: pag.getContents()[0]?.index, start: Math.round(pag.start), end: Math.round(pag.end), viewSize: Math.round(pag.viewSize), page: pag.page, pages: pag.pages });
  })()`);
  // 方向标定：Chromium 输入事件 deltaY 为负＝内容向下滚（与 DOM WheelEvent.deltaY 相反）
  const send = (dy, dx = 0) => win.webContents.sendInputEvent({ type: 'mouseWheel', x: 500, y: 350, deltaX: -dx, deltaY: -dy, hasPreciseScrollingDeltas: true, canScroll: true });
  // 一次两指滑动：发力段（幅度上升）+ 惯性尾巴（指数衰减、16ms 一帧），模拟 macOS / 精确式触控板
  async function swipe({ peak = 60, tail = 100, decay = 0.955, frame = 16, jankAt = -1, jankMs = 0 } = {}) {
    for (const v of [8, 20, 38, peak]) { send(v); await sleep(frame); }
    let v = peak;
    for (let i = 0; i < tail && v >= 1; i++) {
      v *= decay;
      // 惯性尾巴里的自然抖动（±12%），检验「重新发力」判定不被抖动冒充
      const jitter = 1 + (i % 3 === 0 ? 0.12 : i % 3 === 1 ? -0.12 : 0);
      send(Math.max(1, Math.round(v * jitter)));
      // 卡顿在渲染进程里异步发生（发送方不停），排队的惯性事件随后集中到达
      if (i === jankAt) void js(`setTimeout(()=>{const t=performance.now();while(performance.now()-t<${jankMs}){}},0);0`);
      await sleep(frame);
    }
    await sleep(500);
  }
  const out = [];
  const check = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail });

  // ── 滚动模式：短章（约 3 屏）
  await js(`setup('scrolled', 24)`);
  let s = await js('state()');
  check('夹具：章节约三屏高', s.viewSize > 900 && s.viewSize < 3.5 * 700, s);
  // A：从章中发力，惯性滚到章尾——同一串惯性不换章（停在章尾）
  await swipe({ peak: 70, tail: 140, decay: 0.97 });
  s = await js('state()');
  check('A 章内惯性滚到章尾后停住、不换章', s.index === 0 && s.viewSize - s.end <= 2, s);
  // B：停在章尾后再次两指滑动——换到下一章，余下惯性被吸收，停在章首
  await sleep(300);
  await swipe({ peak: 80, tail: 140, decay: 0.975 });
  s = await js('state()');
  check('B 续滑换到下一章（不跳过第二章）', s.index === 1, s);
  check('B 换章后停在章首，不被惯性带走', s.start <= 2, s);
  // C：换章加载期间主线程卡顿（排队的惯性事件不得冒充新手势）
  await js(`pag.goTo({index:0, anchor:()=>1}).then(()=>wait(250))`);
  await sleep(300);
  await swipe({ peak: 80, tail: 140, decay: 0.975, jankAt: 3, jankMs: 320 });
  s = await js('state()');
  check('C 主线程卡顿时仍只换一章', s.index === 1, s);
  check('C 卡顿后仍停在章首', s.start <= 2, s);
  // D：惯性停下后，下一次滑动正常在新章内滚动
  await sleep(300);
  const before = s.start;
  await swipe({ peak: 30, tail: 20, decay: 0.9 });
  s = await js('state()');
  check('D 惯性结束后可正常在新章内滚动', s.index === 1 && s.start > before, s);
  // E：章首向上惯性回上一章，停在上一章末尾
  await js(`pag.goTo({index:1, anchor:()=>0}).then(()=>wait(250))`);
  await sleep(300);
  for (const v of [-8, -20, -38, -80]) { send(v); await sleep(16); }
  for (let v = 80, i = 0; i < 140 && v >= 1; i++) { v *= 0.975; send(-Math.max(1, Math.round(v))); await sleep(16); }
  await sleep(500);
  s = await js('state()');
  check('E 向上惯性只回到上一章', s.index === 0, s);
  check('E 回到上一章后停在章末', s.viewSize - s.end <= 2, s);

  // ── 分页模式：竖向惯性在章末页跨章，只进下一章首页
  await js(`setup('paginated', 24)`);
  await js(`pag.goTo({index:0, anchor:()=>1}).then(()=>wait(250))`);
  await sleep(300);
  await swipe({ peak: 80, tail: 140, decay: 0.975, jankAt: 3, jankMs: 320 });
  s = await js('state()');
  check('F 分页惯性跨章只进下一章', s.index === 1, s);
  check('F 分页跨章停在新章首页', s.page === 1, s);

  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${JSON.stringify(r.detail)}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`SUMMARY ${out.length - failed}/${out.length}`);
  win.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows 上 Electron 可能仍持有 userData 锁 */ }
  app.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  win?.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 同上 */ }
  app.exit(1);
});
