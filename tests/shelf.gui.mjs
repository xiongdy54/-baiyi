// 书架页重设计回归套件（v48.15 / D51）
// 覆盖：吸顶工具条（视图/密度/排序/主行动）、网格"右侧富余=0"几何口径、图注卡、
//       拖拽三区落点与键盘重排、文件夹全生命周期（成组/命名/名册/三条出路/移出/解散）、
//       顺序与文件夹持久化（settings.json 重启不丢）、空态不再重复主行动。
// 运行：node tests/shelf.gui.mjs（CDP 驱动真实应用，自启自关）
// 隔离：M7_TEST_USERDATA → tests/tmp-shelf-userdata（先清空），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9531";
const USER_DATA = path.join(ROOT, "tests", "tmp-shelf-userdata");
const SETTINGS = path.join(USER_DATA, "settings.json");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;
let page = null;   // 模块级：mustEnter 等辅助函数要用（先前写成 try 内的 const，调用处 ReferenceError）

async function connect() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const l = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
        .filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const t = l.find((x) => (x.url || "").includes("index.html"));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) =>
          new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          // CDP 把求值异常放在 result.exceptionDetails（不是顶层）——读错了就只能拿到 "[object Object]"，
          // 排查时看不到根因，这里两个位置都读并把描述带出来
          const ex = r.exceptionDetails || r.result?.exceptionDetails;
          if (ex) return "EXC:" + String(ex.exception?.description || ex.text || "").slice(0, 300);
          const v = r.result?.result?.value;
          return typeof v === "string" || v === undefined || typeof v === "number" || typeof v === "boolean"
            ? v : "OBJ:" + JSON.stringify(v)?.slice(0, 200);
        };
        await send("Page.enable");
        await send("Runtime.enable");
        return { send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

/* ------------------------------------------------------------------ 页内工具 */

// 页内公共helpers：一次注入，后面所有片段复用
const PRELUDE = `
  window.__S = {
    items: () => [...document.querySelectorAll('#root .bookshelf .shelf-item')],
    ids: () => window.__S.items().map(e => e.dataset.entry).join(','),
    bar: () => document.querySelector('.shelf-bar'),
    grid: () => document.querySelector('.bookshelf-grid'),
    seg: (label) => [...document.querySelectorAll('.shelf-seg')].find(s => s.previousElementSibling?.textContent === label),
    count: () => document.querySelector('.shelf-count')?.textContent.replace(/\\s+/g,' ').trim(),
    folderCards: () => [...document.querySelectorAll('.f-face')],
    // 合成一次真实的 HTML5 拖拽：DragEvent + 同一个 DataTransfer（Chromium 支持构造）
    drag: () => (window.__dt = window.__dt || new DataTransfer()),
    fire: (el, type, x, y) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__S.drag(), clientX: x, clientY: y });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    pt: (el, fx) => { const r = el.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * 0.5]; },
    // 找不到文件夹卡时不抛异常（否则后面的 JSON.parse 会拿到 EXC 串，报错看不出根因）
    folderCard: () => window.__S.items().find(e => e.querySelector('.f-face')) || null,
    enterFolder: () => { const f = window.__S.folderCard(); if (!f) return false; f.querySelector('.book-card').click(); return true; },
    backBtn: () => document.querySelector('.shelf-crumb .btn') || null,
    // React 受控输入：直接赋 .value 不会触发 onChange，必须走原生 setter + input 事件
    setValue: (el, v) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    },
  };
`;

const mustEnter = async (label) => {
  const ok = await page.eval(`${PRELUDE} return window.__S.enterFolder()`);
  check(`${label}：找得到文件夹卡`, ok === true, ok);
  await wait(650);
};

// 量"右侧富余"：容器内容宽 − 轨道总宽 − gap 合计（§5.3 验收口径）
const GEOM = `(() => {
  ${PRELUDE}
  const g = window.__S.grid(); if (!g) return JSON.stringify({ err: 'no grid' });
  const cs = getComputedStyle(g);
  const tracks = cs.gridTemplateColumns.split(' ').filter(Boolean);
  const box = g.getBoundingClientRect();
  const content = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gap = parseFloat(cs.columnGap) || 0;
  const used = tracks.reduce((s, t) => s + parseFloat(t), 0) + (tracks.length - 1) * gap;
  return JSON.stringify({
    inner: window.innerWidth, cols: tracks.length, track: Math.round(parseFloat(tracks[0] || 0)),
    content: Math.round(content), dead: +(content - used).toFixed(2),
    min: cs.getPropertyValue('--shelf-min').trim(),
    // 旧算法（定宽 200 + justify-content:start）在同一宽度下会余多少，留作对照
    oldDead: Math.round(Math.max(0, content - (Math.max(1, Math.floor((content + gap) / 224)) * 200 + (Math.max(1, Math.floor((content + gap) / 224)) - 1) * gap))),
  });
})()`;

/* ---------------------------------------------------------------------- 跑测 */

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(900);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const log = openSync(path.join(ROOT, "tests", "shelf.gui.log"), "a");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log],
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  page = await connect();
  await wait(4500);

  console.log("\n[1] 空库基线：工具条在场、空态不再重复主行动（§5.4）");
  let r = JSON.parse(await page.eval(`
    ${PRELUDE}
    return JSON.stringify({
      bar: !!window.__S.bar(),
      sticky: getComputedStyle(window.__S.bar()).position,
      z: getComputedStyle(window.__S.bar()).zIndex,
      groups: document.querySelectorAll('.shelf-bar .shelf-group').length,
      segs: document.querySelectorAll('.shelf-bar .shelf-seg').length,
      dropdown: !!document.querySelector('.shelf-bar .dd'),
      addBtn: document.querySelector('.shelf-bar .btn-primary')?.textContent.trim(),
      addBtnH: getComputedStyle(document.querySelector('.shelf-bar .btn-primary')).height,
      empty: !!document.querySelector('.empty-state'),
      emptyBtns: document.querySelectorAll('.empty-state button').length,
      emptyText: document.querySelector('.empty-text')?.textContent.replace(/\\s+/g,' ').trim().slice(0, 22),
      count: window.__S.count(),
    });`));
  check("吸顶工具条在场且 position:sticky", r.bar && r.sticky === "sticky", JSON.stringify(r));
  check("工具条 z-index = --z-sticky(200)", r.z === "200", r.z);
  check("工具条内三组控件（视图/密度/排序）", r.groups === 3, r.groups);
  check("视图与密度各一组分段按钮，排序走共享 Dropdown", r.segs === 2 && r.dropdown, JSON.stringify(r));
  check("主行动「添加材料」在工具条、32px 档", /添加材料/.test(r.addBtn || "") && r.addBtnH === "32px", JSON.stringify(r));
  check("空态在场且**没有任何按钮**（D51 用户指令）", r.empty && r.emptyBtns === 0, JSON.stringify(r));
  check("空态文案指过去工具条主行动", /添加材料/.test(r.emptyText || ""), r.emptyText);
  check("空库计数为 0 本", /^0 本$/.test(r.count || ""), r.count);

  console.log("\n[2] 造 4 本粘贴书：图注卡在场、卡面不再挂原生 select");
  // 直连 libraryAPI 建书（不走导入模态的文件对话框），再整页重载触发 Bookshelf 的挂载刷新——
  // 生产包里没有 /src/*.ts 可 import，拿 EventBus 走 IPC 推送又依赖主进程，reload 是最干净的路径
  await page.eval(`
    const mk = ['网格系统','字体设计指南','色彩艺术','字型散步'];
    for (const t of mk) await window.libraryAPI.createFromPaste(t + ' 夹具', '# ' + t + '\\n\\n' + '正文内容。'.repeat(40));
    return mk.length;`);
  await page.eval(`location.reload(); return 1`);
  await wait(6500);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const it = window.__S.items();
    const card = it[0]?.querySelector('.book-card');
    return JSON.stringify({
      items: it.length, count: window.__S.count(),
      hasCover: !!card?.querySelector('.book-card-cover'),
      capTitle: it[0]?.querySelector('.cap-title')?.textContent,
      capMeta: it[0]?.querySelector('.cap-meta')?.textContent.replace(/\\s+/g,' ').trim(),
      railH: it[0] ? getComputedStyle(it[0].querySelector('.cap-rail')).height : null,
      cardAspect: card ? getComputedStyle(card).aspectRatio : null,
      radius: card ? getComputedStyle(card).borderTopLeftRadius : null,
      nativeSelect: document.querySelectorAll('.book-card select').length,
      acts: it[0]?.querySelectorAll('.card-acts .act').length,
    });`));
  check("4 本书渲染为 4 个条目", r.items === 4, JSON.stringify(r));
  check("计数为「4 本」且只有一个「本」字（用户实测的 2本本 缺陷）", /^4 本$/.test(r.count || ""), r.count);
  check("图注卡在位：书名常驻 + meta 含百分比与日期", !!r.capTitle && /%/.test(r.capMeta || "") && /-/.test(r.capMeta || ""), JSON.stringify(r));
  check("进度轨高 2px（§5.3 半档写法）", r.railH === "2px", r.railH);
  check("封面保持 2:3、直角（v48.115/D161 第三轮：圆角只属于文件夹夹体）", r.cardAspect === "2 / 3" && r.radius === "0px", JSON.stringify(r));
  check("卡面上不再有原生 <select>（旧版语言下拉）", r.nativeSelect === 0, r.nativeSelect);
  // v48.22（D58 §6.8-2）：书卡动作条新增「优先」（书级默认优先级 Dropdown）；v48.77（D121 ⑥，
  // 提交 1d0c070）：再补「作者」（library_items.author + library:setItemAuthor 通道）→ 4 枚 → 6 枚
  check("动作条 6 枚（重命名/作者/语言/优先/归入/删除）", r.acts === 6, r.acts);

  console.log("\n[3] 网格几何：四个视口宽度下右侧富余必须为 0");
  const widths = [620, 900, 1100, 1600];
  let prevCols = 0;
  for (const w of widths) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait(420);
    const g = JSON.parse(await page.eval(`return ${GEOM}`));
    check(`视口 ${w}px：右侧富余 = 0（实测 ${g.dead}px；旧算法此处会余 ${g.oldDead}px）`,
      !!g.cols && Math.abs(g.dead) < 1.5, JSON.stringify(g));
    check(`视口 ${w}px：单列宽落在密度档下限之上（${g.track}px）`, g.track >= 150, JSON.stringify(g));
    if (w > 620) check(`视口 ${w}px：列数随宽度不减少（${prevCols} → ${g.cols}）`, g.cols >= prevCols, JSON.stringify(g));
    prevCols = g.cols;
  }
  await page.send("Emulation.clearDeviceMetricsOverride");
  await wait(500);

  console.log("\n[4] 视图切换：目录表只画横向 hairline，可切回封面墙");
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][1].click();
    return '1';`));
  await wait(700);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const td=document.querySelector('.shelf-table tbody td');
    const cs=td?getComputedStyle(td):null;
    return JSON.stringify({
      table: !!document.querySelector('.shelf-table'),
      rows: document.querySelectorAll('.shelf-table tbody tr').length,
      head: document.querySelector('.shelf-table')?.previousElementSibling === null,
      borderLeft: cs ? cs.borderLeftWidth : null,
      borderRight: cs ? cs.borderRightWidth : null,
      borderBottom: cs ? cs.borderBottomWidth : null,
      pressed: [...document.querySelectorAll('.shelf-bar .shelf-group')][0].querySelectorAll('button')[1].getAttribute('aria-pressed'),
    });`));
  check("切到目录表：表格在场且 4 行", r.table && r.rows === 4, JSON.stringify(r));
  check("表格只画横向 hairline（左右零边框、底部 1px；DPR 下允许 0.8px 取整）",
    r.borderLeft === "0px" && r.borderRight === "0px" && parseFloat(r.borderBottom) >= 0.75 && parseFloat(r.borderBottom) <= 1.25,
    JSON.stringify(r));
  check("分段按钮 aria-pressed 跟随视图切换", r.pressed === "true", r.pressed);
  await page.eval(`
    ${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][0].click(); return '1'`);
  await wait(600);
  r = JSON.parse(await page.eval(`return JSON.stringify({wall: !!document.querySelector('.bookshelf-grid')})`));
  check("能切回封面墙", r.wall, JSON.stringify(r));

  console.log("\n[4b] 目录表：不横向溢出 + 打开入口在书名/封面本身（v48.18 / D54）");
  const toTable = `${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][1].click(); return '1'`;
  const toWall = `${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][0].click(); return '1'`;
  await page.eval(toTable);
  await wait(700);
  // 夹具是「尚未开始」的新书，副文本天生一行——不注入长文本就测不到溢出（假绿）。
  // 按最长口径（lastReadDisplay 无上限 / 摘录 160 字）把副文本撑满再量。
  const injected = await page.eval(`
    ${PRELUDE}
    const subs=[...document.querySelectorAll('.shelf-table .t-sub')];
    subs.forEach((el) => { el.textContent = '这'.repeat(160); });
    return subs.length;`);
  check("[4b] 四行副文本已撑到最长口径", injected === 4, injected);
  for (const w of [900, 1100, 1280, 1600]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait(420);
    const t = JSON.parse(await page.eval(`return (() => {
      const box = document.querySelector('.bookshelf');
      const tb = document.querySelector('.shelf-table');
      const acts = [...document.querySelectorAll('.shelf-table .col-act .act')];
      const act = acts[acts.length - 1];   // 最右那枚（删除）——原先取第一枚，差值是假富余
      const sub = document.querySelector('.shelf-table .t-sub');
      const cs = sub ? getComputedStyle(sub) : null;
      return JSON.stringify({
        overflowX: box ? box.scrollWidth - box.clientWidth : -1,
        tableOverflow: tb ? Math.round(tb.scrollWidth - tb.clientWidth) : -1,
        actOverflows: act && box ? Math.round(act.getBoundingClientRect().right - box.getBoundingClientRect().right) : 9999,
        clamp: cs ? cs.webkitLineClamp : null,
        subOverflow: sub ? sub.scrollHeight - sub.clientHeight : -1
      });
    })()`));
    check(`目录表 @${w}px：撑满副文本也不产生横向滚动（容器 ${t.overflowX}px / 表 ${t.tableOverflow}px）`,
      t.overflowX <= 1 && t.tableOverflow <= 1, JSON.stringify(t));
    check(`目录表 @${w}px：最右动作按钮完整可见（超出容器右边界 ${t.actOverflows}px）`, t.actOverflows <= 1, JSON.stringify(t));
    if (w === 1280) check("副文本是 2 行截断而不是 nowrap 撑列（旧写法这里 clamp 为空且列被撑爆）",
      t.clamp === "2" && t.subOverflow >= 0, JSON.stringify(t));
  }
  // 差分自证（本文件的既有规矩，见 [3] 段的「旧算法此处会余 Npx」）：同一夹具、同一帧里把副文本
  // 改回旧写法（nowrap 不截断）量一次——旧写法必须真的溢出，否则上面那四条视口断言是空的。
  const oldWay = JSON.parse(await page.eval(`
    ${PRELUDE}
    const st = document.createElement('style');
    st.textContent = '.shelf-table .t-sub{white-space:nowrap;display:block;-webkit-line-clamp:unset;}';
    document.head.appendChild(st);
    const box = document.querySelector('.bookshelf');
    const tb = document.querySelector('.shelf-table');
    const out = JSON.stringify({ overflowX: box.scrollWidth - box.clientWidth, table: Math.round(tb.scrollWidth - tb.clientWidth) });
    st.remove();
    void box.scrollWidth;
    return out;`));
  check(`差分自证：旧写法（副文本 nowrap 不截断）在同一夹具下确实横向溢出（实测 ${oldWay.overflowX}px / 表 ${oldWay.table}px）`,
    oldWay.overflowX > 200 || oldWay.table > 200, JSON.stringify(oldWay));

  await page.send("Emulation.clearDeviceMetricsOverride");
  await wait(450);
  const struct = JSON.parse(await page.eval(`
    ${PRELUDE}
    const btn = document.querySelector('.shelf-table .t-open');
    return JSON.stringify({
      openCol: !!document.querySelector('.col-open'),
      gripCol: !!document.querySelector('.col-grip'),
      gripInCard: !!document.querySelector('.shelf-grip'),
      ths: document.querySelectorAll('.shelf-table thead th').length,
      tag: btn ? btn.tagName : null,
      type: btn ? btn.getAttribute('type') : null,
      label: btn ? btn.getAttribute('aria-label') : null,
      title: btn ? (btn.querySelector('.t-title').textContent || '').slice(0, 10) : null,
      tabIndex: btn ? btn.tabIndex : null
    });`));
  check("「打开」列与拖拽把手列都已撤除（卡片视图的 .shelf-grip 同样撤除），表头 7 列",
    struct.openCol === false && struct.gripCol === false && struct.gripInCard === false && struct.ths === 7,
    JSON.stringify(struct));
  check("书名本身是真可激活控件（<button type=button>、tabIndex 0、aria-label 带书名）",
    struct.tag === "BUTTON" && struct.type === "button" && struct.tabIndex === 0 &&
    !!struct.label && struct.label.indexOf("打开《") === 0 && struct.label.indexOf(struct.title) > 0,
    JSON.stringify(struct));
  // 真的点一次：会离开书架进阅读器，所以放在本段最后，随后导航回来恢复状态
  await page.eval(`return document.querySelector('.shelf-table .t-open').click() || '1'`);
  await wait(2400);
  const opened = JSON.parse(await page.eval(`return JSON.stringify({
    shelf: !!document.querySelector('.bookshelf'),
    reader: !!document.querySelector('.reader-engine-host, .reader-markdown, [class*="reader-"]')
  })`));
  check("点目录表的书名就开书（不再需要独立的「打开」按钮）",
    opened.shelf === false && opened.reader === true, JSON.stringify(opened));
  await page.eval(`return [...document.querySelectorAll('.topbar-nav .nav-item')][0].click() || '1'`);
  await wait(1400);
  await page.eval(toWall);
  await wait(650);
  const restored = JSON.parse(await page.eval(`return JSON.stringify({wall: !!document.querySelector('.bookshelf-grid')})`));
  check("回到书架并恢复封面墙（不打扰后续段落）", restored.wall === true, JSON.stringify(restored));
  // #1 回归：旧规则 `tr:hover .t-sub{display:none}` 没限定文件夹行，书行的那行文字会被整块藏掉，
  //    下面的进度条因此往上跳（实测 barTop 246 → 209）。真鼠标悬停量一次位移。
  await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][1].click(); return 1;`);
  await wait(700);
  const bar0 = JSON.parse(await page.eval(`
    const tr=[...document.querySelectorAll('.shelf-table tbody tr')].find(r=>!r.classList.contains('is-folder'));
    if(!tr) return 'NO-BOOK-ROW';
    window.__trb=tr;
    const bar=tr.querySelector('.bar'); const r=bar?bar.getBoundingClientRect():null;
    return JSON.stringify({h:Math.round(tr.getBoundingClientRect().height), barTop:r?Math.round(r.top):null});`));
  const pt = JSON.parse(await page.eval(`
    const r=window.__trb.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width*0.4), y:Math.round(r.top+r.height*0.5)});`));
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await wait(450);
  const bar1 = JSON.parse(await page.eval(`
    const tr=window.__trb; const bar=tr.querySelector('.bar'); const r=bar?bar.getBoundingClientRect():null;
    return JSON.stringify({h:Math.round(tr.getBoundingClientRect().height), barTop:r?Math.round(r.top):null,
      sub:getComputedStyle(tr.querySelector('.t-sub')).display});`));
  check("悬停书行时进度条不位移、行高不变、副文本不隐藏（#1）",
    bar0.barTop === bar1.barTop && bar0.h === bar1.h && bar1.sub !== "none", JSON.stringify([bar0, bar1]));
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 6, y: 6 });
  await wait(350);
  await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][0].click(); return 1;`);
  await wait(700);
  const backWall = JSON.parse(await page.eval(`return JSON.stringify({wall: !!document.querySelector('.bookshelf-grid')});`));
  check("量完 #1 后恢复封面墙（不给后续段落留脏状态）", backWall.wall === true, JSON.stringify(backWall));

  console.log("\n[5] 密度三档：只换一个 Token，列数随之变化");
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const dens=[...document.querySelectorAll('.shelf-bar .shelf-group')][1];
    const btns=[...dens.querySelectorAll('button')];
    const before=getComputedStyle(document.querySelector('.bookshelf')).getPropertyValue('--shelf-min').trim();
    btns[2].click();
    return JSON.stringify({before});`));
  await wait(500);
  const lg = JSON.parse(await page.eval(`return ${GEOM}`));
  await page.eval(`
    ${PRELUDE}
    const dens=[...document.querySelectorAll('.shelf-bar .shelf-group')][1];
    [...dens.querySelectorAll('button')][1].click();
    return 1`);
  await wait(500);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const dens=[...document.querySelectorAll('.shelf-bar .shelf-group')][1];
    return JSON.stringify({pressed:[...dens.querySelectorAll('button')].map(b=>b.getAttribute('aria-pressed')).join('/')});`));
  const md = JSON.parse(await page.eval(`return ${GEOM}`));
  check("标准档 --shelf-min = 200px", r.pressed.startsWith("false/true") && md.min === "200px", JSON.stringify({ ...r, ...md }));
  check("宽松档 = 248px 且列数不多于标准档", lg.min === "248px" && lg.cols <= md.cols, JSON.stringify({ lg, md }));

  console.log("\n[6] 排序：切「标题」后把手消失、按字典序；切回手动恢复");
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    document.querySelector('.shelf-bar .dd-btn').click();
    return '1'`));
  await wait(400);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const opts=[...document.querySelectorAll('.shelf-bar .dd-menu .dd-item')];
    const labels=opts.map(o=>o.textContent.trim());
    const first=window.__S.items().map(e=>e.querySelector('.cap-title').textContent);
    opts.find(o=>o.textContent.includes('标题')).click();
    return JSON.stringify({labels, before:first});`));
  await wait(600);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const after=window.__S.items().map(e=>e.querySelector('.cap-title').textContent);
    return JSON.stringify({
      after, draggable:[...document.querySelectorAll('.shelf-item')].filter(e=>e.getAttribute('draggable')==='true').length,
      grab: [...document.querySelectorAll('.shelf-item')].filter(e => getComputedStyle(e).cursor === 'grab').length,
      hint: document.querySelector('.shelf-hint')?.textContent.trim(),
      dropdownValue: document.querySelector('.shelf-bar .dd-btn')?.textContent.trim(),
    });`));
  check("排序下拉列出四档", /手动顺序/.test(r.dropdownValue || "") === false && /标题/.test(r.dropdownValue || ""), r.dropdownValue);
  check("「标题」排序按字典序生效", r.after.join() === [...r.after].sort((a, b) => a.localeCompare(b, "zh")).join(), JSON.stringify(r.after));
  check("非手动顺序下 draggable 与 grab 光标全部撤场", r.draggable === 0 && r.grab === 0, JSON.stringify(r));
  check("工具条写明拖拽已停用", /停用/.test(r.hint || ""), r.hint);
  await page.eval(`
    ${PRELUDE}
    document.querySelector('.shelf-bar .dd-btn').click(); return '1'`);
  await wait(350);
  await page.eval(`
    ${PRELUDE}
    ;[...document.querySelectorAll('.shelf-bar .dd-menu .dd-item')].find(o=>o.textContent.includes('手动')).click(); return '1'`);
  await wait(600);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    return JSON.stringify({grips: document.querySelectorAll('.shelf-grip').length, cur:[...new Set([...document.querySelectorAll('.shelf-item')].map(e=>getComputedStyle(e).cursor))].join(','), draggable:[...document.querySelectorAll('.shelf-item')].filter(e=>e.getAttribute('draggable')==='true').length});`));
  // v48.18 / D54：把手图形撤除了（它本来就没有任何处理器），可拖性改由 cursor: grab + 落点高亮承担
  check("切回手动顺序：4 张卡可拖、卡片光标统一 pointer、把手图形不再渲染",
    r.draggable === 4 && r.cur === "pointer" && r.grips === 0, JSON.stringify(r));

  console.log("\n[7] 键盘重排：聚焦卡片 Alt+→ 逐格移动，可连续按");
  const ids0 = await page.eval(`${PRELUDE} return window.__S.ids()`);
  await page.eval(`
    ${PRELUDE}
    window.__S.items()[0].querySelector('.book-card').focus();
    return document.activeElement.getAttribute('aria-label');`);
  const label0 = await page.eval(`${PRELUDE} return document.activeElement.getAttribute('aria-label')`);
  await page.eval(`${PRELUDE}
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true})); return 1`);
  await wait(520);
  const ids1 = await page.eval(`${PRELUDE} return window.__S.ids()`);
  const label1 = await page.eval(`${PRELUDE} return document.activeElement.getAttribute('aria-label')`);
  await page.eval(`${PRELUDE}
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true})); return 1`);
  await wait(520);
  const ids2 = await page.eval(`${PRELUDE} return window.__S.ids()`);
  const label2 = await page.eval(`${PRELUDE} return document.activeElement.getAttribute('aria-label')`);
  const a0 = ids0.split(",")[0];
  check("第一次 Alt+→ 生效：聚焦那张卡从第 1 格挪到第 2 格",
    ids1.split(",")[1] === a0 && ids1 !== ids0, `${ids0} → ${ids1}`);
  check("焦点跟着那张卡走（连按不丢焦点）",
    !!label0 && label0 === label1 && label1 === label2 && ids2.split(",")[2] === a0,
    `${label0} / ${label1} / ${label2} · ${ids2}`);

  console.log("\n[7b] 目录表视图的键盘重排：焦点要跟着行走（v48.18 修：原先硬查 .book-card，表里没有 → 连按不动）");
  await page.eval(toTable);
  await wait(700);
  const tids = () => page.eval(`return [...document.querySelectorAll('.shelf-table tbody tr')].map(x => x.dataset.entry).join(',')`);
  const t0 = await tids();
  await page.eval(`return document.querySelector('.shelf-table .t-open').focus() || '1'`);
  await wait(250);
  const tstep = async () => {
    await page.eval(`return document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true})) || '1'`);
    await wait(520);
    return {
      ids: await tids(),
      label: await page.eval(`return document.activeElement.getAttribute('aria-label') || 'NO-FOCUS:' + document.activeElement.tagName`)
    };
  };
  const s1 = await tstep();
  const s2 = await tstep();
  const moved = (t0 || "").split(",")[0];
  check("目录表 Alt+→ 生效：第一行挪到第二格", !!s1.ids && s1.ids !== t0 && s1.ids.split(",")[1] === moved, `${t0} → ${s1.ids}`);
  check("焦点跟着那一行走，第二次连按仍生效（原先就是这里坏的）",
    !!s1.label && s1.label.indexOf("打开《") === 0 && s1.label === s2.label && s2.ids.split(",")[2] === moved,
    `${s1.label} / ${s2.label} · ${s2.ids}`);
  await page.eval(toWall);
  await wait(650);

  // #3：右缘（zone-after）过去只画高亮不改顺序——reorderTo 压根没读 zone，只会 moveTo（插到之前），
  //     而「把第 1 本插到第 2 本之前」＝原地不动，用户看到的就是「拖不动，只有中间会成组」。
  const ord0 = await page.eval(`${PRELUDE} return window.__S.items().map(e=>e.querySelector('.cap-title').textContent).join(',');`);
  await page.eval(`${PRELUDE}
    const it=window.__S.items(); const dr=it[1].getBoundingClientRect(), sr=it[0].getBoundingClientRect();
    window.__ptA={sx:sr.left+sr.width/2, sy:sr.top+8, ax:dr.right-8, ay:dr.top+dr.height*0.5};
    const e=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window.__S.drag(),clientX:window.__ptA.sx,clientY:window.__ptA.sy});
    it[0].dispatchEvent(e); return 1;`);
  await wait(180);
  await page.eval(`${PRELUDE}
    const it=window.__S.items(); const p=window.__ptA;
    it[1].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.__S.drag(),clientX:p.ax,clientY:p.ay})); return 1;`);
  await wait(180);
  await page.eval(`${PRELUDE}
    const it=window.__S.items(); const p=window.__ptA;
    it[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:window.__S.drag(),clientX:p.ax,clientY:p.ay}));
    it[0].dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:window.__S.drag(),clientX:0,clientY:0})); return 1;`);
  await wait(900);
  const ord1 = await page.eval(`${PRELUDE} return window.__S.items().map(e=>e.querySelector('.cap-title').textContent).join(',');`);
  // #2：一个条目内部只允许一种光标。旧写法（卡片封面 pointer，而 2px 进度轨与图注 grab）
  //    会让两条光标夹着一根 2px 分界，鼠标停在边缘就在 pointer↔grab 之间反复翻。
  const cursorUniform = await page.eval(`${PRELUDE}
    const it=window.__S.items()[0];
    const picks=[it.querySelector('.book-card-cover'), it.querySelector('.cap-rail'), it.querySelector('.cap-title'), it];
    const vals=picks.map(e=>e?getComputedStyle(e).cursor:'MISSING');
    return JSON.stringify({vals, uniq:[...new Set(vals)].join(',')});`);
  const cu = JSON.parse(cursorUniform);
  check("卡片内部光标只有一个值（#2 不再来回跳）", cu.uniq === "pointer", JSON.stringify(cu));
  const rowCursor = await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][1].click(); return 1;`);
  await wait(700);
  const rc = JSON.parse(await page.eval(`
    const tr=document.querySelector('.shelf-table tbody tr');
    const vals=[getComputedStyle(tr).cursor, getComputedStyle(tr.querySelector('.col-num')).cursor, getComputedStyle(tr.querySelector('.t-open')).cursor];
    return JSON.stringify({row:vals[0], cell:vals[1], titleBtn:vals[2]});`));
  check("目录表行与单元格统一 grab、只有书名 button 是 pointer（表格靠空白处拖动）",
    rc.row === "grab" && rc.cell === "grab" && rc.titleBtn === "pointer", JSON.stringify(rc));
  await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][0].click(); return 1;`);
  await wait(700);

  check("右缘落点真的把这条挪到目标之后（#3「拖不动」）",
    ord1 !== ord0 && ord1.split(",")[1] === ord0.split(",")[0], `${ord0} → ${ord1}`);

  console.log("\n[8] 三区落点：中央＝归组、两侧＝重排，两种反馈不同形");
  // 页内 eval 返回值解析失败时打印原始串，别让整个套件因为一处 JSON.parse 崩掉
  const J = async (expr, label) => {
    const s = await page.eval(expr);
    try { return JSON.parse(s); } catch {
      console.log(`      · ${label} 未取到 JSON，原始返回：${String(s).slice(0, 300)}`);
      return { __raw: String(s) };
    }
  };
  const fire = (expr) => page.eval(`${PRELUDE}\n${expr}`);
  // 手势状态要先经 React flush 才读得到：dragstart / dragover / drop 必须分三个 tick 发，
  // 同一个 eval 里连着发，drop 的 handler 读到的还是上一轮的落点（实测踩过）
  const dragstart = async () => {
    await fire(`const a=window.__S.items()[0]; return window.__S.fire(a,'dragstart', ...window.__S.pt(a,0.5));`);
    await wait(400);
  };
  const dragover = async (fx) => {
    await fire(`const b=window.__S.items()[1]; const [x,y]=window.__S.pt(b,${fx}); window.__S.fire(b,'dragover',x,y); return 1;`);
    await wait(380);
    return J(`const b=window.__S.items()[1]; const f=b?.querySelector('.shelf-face');
      const pb=f?getComputedStyle(f,'::before'):null, pa=f?getComputedStyle(f,'::after'):null;
      const on = pb && pb.content.startsWith('"') ? pb : pa;
      return JSON.stringify({
      cls: b ? b.className : null, tip: b?.querySelector('.zone-tip')?.textContent || null,
      bar: on ? on.backgroundColor : null, barH: on ? on.height : null,
      faceH: f ? Math.round(f.getBoundingClientRect().height) : null,
      items: window.__S.items().length });`, "zone");
  };
  await dragstart();
  const center = await dragover(0.5);
  const left = await dragover(0.04);
  const right = await dragover(0.97);
  check("中央区：zone-group + 浮出「成组」提示", /zone-group/.test(center.cls) && /成组/.test(center.tip || ""), JSON.stringify(center));
  check("左缘区：zone-before（画 accent 竖条，不提示成组）", /zone-before/.test(left.cls) && !left.tip, JSON.stringify(left));
  check("右缘区：zone-after", /zone-after/.test(right.cls) && !right.tip, JSON.stringify(right));

  check("两侧竖条与高亮框同量度：条高 = 封面 + 进度轨那一块",
    !!left.faceH && Math.abs(parseFloat(left.barH) - left.faceH) <= 1 && Math.abs(parseFloat(right.barH) - right.faceH) <= 1,
    JSON.stringify({ left, right }));

  await dragover(0.5);
  // 高亮框必须罩住「封面 + 进度轨」整块（用户实测：框只到封面底、把 2px 轨落在框外，看着短一截）
  r = await J(`${PRELUDE}
    const it=window.__S.items()[1], face=it.querySelector('.shelf-face');
    const card=it.querySelector('.book-card'), rail=it.querySelector('.cap-rail');
    const fr=face.getBoundingClientRect(), cr=card.getBoundingClientRect(), rr=rail.getBoundingClientRect();
    const cs=getComputedStyle(face);
    return JSON.stringify({ faceH:Math.round(fr.height), cardH:Math.round(cr.height), railH:Math.round(rr.height),
      faceBottom:Math.round(fr.bottom), railBottom:Math.round(rr.bottom),
      outline:\`\${cs.outlineStyle} \${cs.outlineWidth} \${cs.outlineColor}\`,
      zone:/zone-group/.test(it.className) });`, "face-align");
  check("中央区处于 zone-group 且框画在 .shelf-face 上", r.zone === true && /solid/.test(r.outline) && /2px/.test(r.outline), JSON.stringify(r));
  check("高亮框高度 = 封面 + 进度轨，下沿落在轨下方（不再短一截）",
    r.faceH === r.cardH + r.railH && r.faceBottom === r.railBottom, JSON.stringify(r));

  await fire(`const a=window.__S.items()[0], b=window.__S.items()[1];
    const [x,y]=window.__S.pt(b,0.5);
    window.__S.fire(b,'drop',x,y); window.__S.fire(a,'dragend'); return 1;`);
  await wait(700);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const f=window.__S.items().find(e=>e.querySelector('.f-face'));
    const paper=f?.querySelector('.f-papers i')?.getBoundingClientRect();
    const pocket=f?.querySelector('.f-front')?.getBoundingClientRect();
    const face=f?.querySelector('.f-face');
    return JSON.stringify({
      folders: window.__S.folderCards().length,
      items: window.__S.items().length,
      count: window.__S.count(),
      renameInput: document.activeElement?.className,
      renameValue: document.activeElement?.value,
      tabShape: !!f?.querySelector('.f-face > .f-tab') && !!f?.querySelector('.f-face > .f-back'),
      papers: f ? f.querySelectorAll('.f-papers i').length : 0,
      faceText: face ? face.textContent.replace(/\s+/g,'') : null,
      faceImgs: face ? face.querySelectorAll('img').length : -1,
      cardLabel: f?.querySelector('.book-card')?.getAttribute('aria-label'),
      // 纸探出袋口的可见高度 与 伸进袋里的深度（「纸插在夹子里」的两条几何证据）
      show: paper && pocket ? Math.round(pocket.top - paper.top) : null,
      tuck: paper && pocket ? Math.round(paper.bottom - pocket.top) : null,
    });`));
  check("松手即成文件夹：顶层少一格、多一张文件夹卡",
    r.folders === 1 && r.items === 3 && /^2 本 · 1 个文件夹$/.test(r.count || ""), JSON.stringify(r));
  check("竖版文件夹图标在场：背板 + 外凸标签页 + 前袋 + 2 张白纸（一纸 = 一本书，v48.115/D161 第三轮）",
    r.tabShape === true && r.papers === 2, JSON.stringify(r));
  check("卡面零文字、无封面图（不显示书名/计数/均值）",
    r.faceText === "" && r.faceImgs === 0, JSON.stringify({ text: r.faceText, imgs: r.faceImgs }));
  check("aria-label 仍报成员数（卡面无文字不牺牲读屏）", /含 2 本/.test(r.cardLabel || ""), r.cardLabel);
  check("纸自袋口探出 ≥24px、下段伸进袋里 ≥8px（插在夹子里的深度线索）",
    (r.show ?? 0) >= 24 && (r.tuck ?? 0) >= 8, JSON.stringify({ show: r.show, tuck: r.tuck }));
  check("成组后立刻弹出就地命名输入框（不自动取名）",
    /cap-input/.test(r.renameInput || "") && /未命名/.test(r.renameValue || ""), JSON.stringify(r));

  r = await J(`${PRELUDE}
    const i=document.activeElement;
    if (!i.classList.contains('cap-input')) return JSON.stringify({skip:true});
    window.__S.setValue(i, '排印与网格');
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return JSON.stringify({ok:true});`, "rename");
  await wait(700);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const f=window.__S.items().find(e=>e.querySelector('.f-face'));
    return JSON.stringify({title: f?.querySelector('.cap-title')?.textContent, count: window.__S.count()});`));
  check("文件夹名可自定义并落在图注区", r.title === "排印与网格", JSON.stringify(r));

  console.log("\n[9] 进入文件夹与三条出路");
  await mustEnter("[9]");
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const back=window.__S.backBtn();
    return JSON.stringify({
      crumb: document.querySelector('.shelf-crumb')?.textContent.replace(/\\s+/g,' ').trim(),
      backText: back?.textContent.trim(), backIcon: !!back?.querySelector('svg'),
      backH: back ? getComputedStyle(back).height : null,
      items: window.__S.items().length, count: window.__S.count(),
    });`));
  check("进入后面包屑给出显式「返回书架」钮（带图标、32px 档）",
    /返回书架/.test(r.backText || "") && r.backIcon && r.backH === "32px", JSON.stringify(r));
  check("进入后只显示该夹成员、计数只报本层", r.items === 2 && r.count === "2 本", JSON.stringify(r));
  check("同行不再出现第二个纯文本「书架」小字（避免猜哪个是出口）",
    (r.crumb || "").split("书架").length === 2, r.crumb);
  await page.eval(`${PRELUDE} window.__S.backBtn().click(); return 1`);
  await wait(650);
  r = JSON.parse(await page.eval(`${PRELUDE} return JSON.stringify({crumb: !!window.__S.backBtn(), folders: window.__S.folderCards().length})`));
  check("出路① 返回钮：回到顶层且文件夹卡还在", !r.crumb && r.folders === 1, JSON.stringify(r));

  await mustEnter("出路② 前");
  await page.eval(`${PRELUDE} document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1`);
  await wait(650);
  check("出路② Esc：从文件夹退回顶层",
    (await page.eval(`${PRELUDE} return !!window.__S.backBtn()`)) === false, "crumb still shown");

  await mustEnter("出路③ 前");
  await page.eval(`${PRELUDE} [...document.querySelectorAll('.topbar-nav .nav-item')][0].click(); return 1`);
  await wait(750);
  check("出路③ 顶栏「书架」：已在书架时点它也能退出文件夹",
    (await page.eval(`${PRELUDE} return !!window.__S.backBtn()`)) === false, "crumb still shown");

  console.log("\n[10] 移出与解散：拖到返回钮 / 菜单，一本书都不该被删");
  await mustEnter("[10] 拖出前");
  await fire(`const it=window.__S.items()[0];
    return window.__S.fire(it,'dragstart', ...window.__S.pt(it,0.5));`);
  await fire(`const back=window.__S.backBtn();
    const [x,y]=window.__S.pt(back,0.5);
    return window.__S.fire(back,'dragover',x,y);`);
  r = await J(`${PRELUDE}
    const back=window.__S.backBtn();
    return JSON.stringify({ hot: back.className.includes('is-hot'), cls: back.className });`, "hot");
  check("拖到「返回书架」上：落点被接受且钮进入 is-hot 态", r.hot === true, JSON.stringify(r));
  await fire(`const back=window.__S.backBtn(), it=window.__S.items()[0];
    const [x,y]=window.__S.pt(back,0.5);
    window.__S.fire(back,'drop',x,y); window.__S.fire(it,'dragend'); return 1;`);
  await wait(700);
  await fire(`window.__S.backBtn()?.click(); return 1;`);
  await wait(700);
  r = await J(`${PRELUDE}
    const f=window.__S.folderCard();
    return JSON.stringify({folders: window.__S.folderCards().length,
      label: f?.querySelector('.book-card')?.getAttribute('aria-label'),
      papers: f ? f.querySelectorAll('.f-papers i').length : 0, items: window.__S.items().length});`, "moved-out");
  check("把书拖到「返回书架」= 移回书架，文件夹剩 1 本（一纸 = 一本书）",
    r.folders === 1 && /含 1 本/.test(r.label || "") && r.papers === 1, JSON.stringify(r));

  await fire(`const f=window.__S.folderCard();
    f.querySelector('.card-acts [aria-haspopup]').click(); return 1;`);
  await wait(450);
  r = await J(`${PRELUDE}
    const f=window.__S.folderCard();
    return JSON.stringify({menu:[...f.querySelectorAll('.dd-menu .dd-item')].map(b=>b.textContent.trim())});`, "folder-menu");
  check("文件夹菜单只有「全部移回书架」与「解散」，没有删除",
    r.menu?.some(t => /移回书架/.test(t)) && r.menu?.some(t => /解散/.test(t)) && !r.menu?.some(t => /删除/.test(t)), JSON.stringify(r));
  await fire(`const f=window.__S.folderCard();
    const item=f && [...f.querySelectorAll('.dd-menu .dd-item')].find(b=>b.textContent.includes('解散'));
    if (item) item.click(); return !!item;`);
  await wait(800);
  r = await J(`${PRELUDE}
    return JSON.stringify({folders: window.__S.folderCards().length, items: window.__S.items().length, count: window.__S.count()});`, "dissolved");
  check("解散后 4 本书全回到顶层、一本没少", r.folders === 0 && r.items === 4 && r.count === "4 本", JSON.stringify(r));

  console.log("\n[11] 动作条菜单路径（不依赖拖拽）：新建文件夹并放入");
  await fire(`const it=window.__S.items()[0];
    const btns=[...it.querySelectorAll('.card-acts [aria-haspopup]')];
    btns[btns.length-1].click(); return 1;`);
  await wait(450);
  r = await J(`${PRELUDE}
    const it=window.__S.items()[0];
    const rows=[...it.querySelectorAll('.dd-menu .dd-item')].map(b=>b.textContent.trim());
    const hit=[...it.querySelectorAll('.dd-menu .dd-item')].find(b=>b.textContent.includes('新建'));
    if (hit) hit.click();
    return JSON.stringify({rows, clicked: !!hit});`, "group-menu");
  check("书的归组菜单含「新建文件夹并放入」", r.rows?.some(t => /新建/.test(t)) && r.clicked, JSON.stringify(r));
  await wait(700);
  await fire(`const i=document.activeElement;
    if (i && i.classList.contains('cap-input')) { window.__S.setValue(i,'单本夹'); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }
    return !!(i && i.classList.contains('cap-input'));`);
  await wait(700);
  r = await J(`${PRELUDE}
    const f=window.__S.folderCard();
    return JSON.stringify({title: f?.querySelector('.cap-title')?.textContent,
      label: f?.querySelector('.book-card')?.getAttribute('aria-label'),
      papers: f ? f.querySelectorAll('.f-papers i').length : 0, count: window.__S.count()});`, "single-folder");
  check("单成员文件夹建好并可命名（一张纸居中探出袋口，卡面零文字）",
    r.title === "单本夹" && /含 1 本/.test(r.label || "") && r.papers === 1, JSON.stringify(r));

  console.log("\n[12] 持久化：settings.json 落 app.shelfOrder / shelfFolders，重启不丢");
  const ids = await page.eval(`${PRELUDE} return window.__S.ids()`);
  const st = fs.existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")).app || {} : {};
  check("settings.json 写入 app.shelfOrder", Array.isArray(st.shelfOrder) && st.shelfOrder.length > 0, JSON.stringify(st.shelfOrder || null));
  check("settings.json 写入 app.shelfFolders（含 name/items）",
    Array.isArray(st.shelfFolders) && st.shelfFolders.some(f => f.name === "单本夹" && Array.isArray(f.items)),
    JSON.stringify(st.shelfFolders || null));
  await page.eval(`location.reload(); return 1`);
  await wait(6500);
  r = await J(`${PRELUDE}
    return JSON.stringify({items: window.__S.items().length, folders: window.__S.folderCards().length,
      count: window.__S.count(), ids: window.__S.ids()});`, "after-reload");
  check("重启后书架条目、文件夹与顺序都还在", r.items === 4 && r.folders === 1 && r.ids === ids, JSON.stringify(r));
  check("重启后计数口径不变（3 本 · 1 个文件夹）", /^3 本 · 1 个文件夹$/.test(r.count || ""), r.count);

  console.log("\n[12b] 工具条状态记忆（#5）：视图 / 密度 / 排序要跨开书、返回与重载保持");
  await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][1].click(); return 1;`);
  await wait(700);
  await page.eval(`return document.querySelector('.shelf-table .t-open').click() || '1';`);
  await wait(2400);
  await page.eval(`return [...document.querySelectorAll('.topbar-nav .nav-item')][0].click() || '1';`);
  await wait(1700);
  const kept = JSON.parse(await page.eval(`return JSON.stringify({table: !!document.querySelector('.shelf-table'), grid: !!document.querySelector('.bookshelf-grid')});`));
  check("开一本书再返回书架，仍是目录表（不弹回封面墙）", kept.table === true && kept.grid === false, JSON.stringify(kept));
  await page.eval(`location.reload(); return 1;`);
  await wait(4800);
  const rl = JSON.parse(await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    return JSON.stringify({table: !!document.querySelector('.shelf-table'),
      pressed: seg ? [...seg.querySelectorAll('button')].map(b=>b.getAttribute('aria-pressed')).join(',') : null});`));
  check("整页重载后视图仍是目录表，且分段按钮 aria-pressed 对得上",
    rl.table === true && rl.pressed === "false,true", JSON.stringify(rl));
  await page.eval(`${PRELUDE}
    const seg=[...document.querySelectorAll('.shelf-bar .shelf-group')][0];
    [...seg.querySelectorAll('button')][0].click(); return 1;`);
  await wait(700);

  console.log("\n[13] 全局纪律扫描：字号下限 / 圆角 / 硬编码焦点色");
  r = await J(`const small=[]; const rad=[];
    // v48.115 / D161 第三轮圆角白名单：夹体三件 6px（表内缩略 3px）、纸片 ≤2px；书卡与书封缩略保持直角
    const allow=(el,r)=>(
      (r==='6px' && el.matches('.f-tab,.f-back,.f-front')) ||
      (r==='3px' && el.matches('.thumb .f-tab,.thumb .f-back,.thumb .f-front')) ||
      ((r==='2px'||r==='1px') && el.tagName==='I' && el.closest('.f-papers'))
    );
    document.querySelectorAll('#root *').forEach(el=>{
      const cs=getComputedStyle(el);
      if (cs.display==='none' || cs.visibility==='hidden') return;
      const fs=parseFloat(cs.fontSize);
      if (fs && fs < 11) small.push((el.className||el.tagName)+'='+fs);
      const br=cs.borderTopLeftRadius;
      if (br!=='0px' && !allow(el,br)) rad.push((el.className||el.tagName)+'='+br);
    });
    const shelf=document.querySelector('.bookshelf');
    return JSON.stringify({small, rad, container: getComputedStyle(shelf).containerType});`, "scan");
  check("书架里没有 < 11px 的文字", r.small.length === 0, JSON.stringify(r.small.slice(0, 6)));
  check("书架里没有白名单外圆角（夹体 6px、缩略 3px、纸片 ≤2px；书卡直角，v48.115/D161 第三轮）", r.rad.length === 0, JSON.stringify(r.rad.slice(0, 6)));
  check("容器查询宿主在场（工具条逐级退让依赖它）", /inline-size/.test(r.container || ""), r.container);

  console.log("\n[14] 封面墙三条交互缺陷回归（v48.20 / D56）");
  const bookCard = `window.__S.items().find(e=>e.querySelector('.book-card-cover'))`;
  const bookId = await page.eval(`${PRELUDE} return ${bookCard}.dataset.entry;`);

  // ① 卡内菜单：整体在滚动容器可视区内、选项全部可命中。
  //    改前 `.dd-menu`（更靠后、同权重）覆盖掉 `.dd-menu-up` 的 top:auto → top/bottom 双非 auto、
  //    盒高按约束解成 0，内容只朝下溢流再被 `.book-card{overflow:hidden}` 剪掉 → 10 个选项命中 0/10。
  await fire(`const card=${bookCard};
    card.querySelector('button[aria-label="书籍语言"]').click(); return 1;`);
  await wait(450);
  r = await J(`${PRELUDE}
    const menu=document.querySelector('.dd-menu');
    if(!menu) return JSON.stringify({err:'菜单没开'});
    const sr=menu.closest('.bookshelf').getBoundingClientRect(), mr=menu.getBoundingClientRect();
    const items=[...menu.querySelectorAll('.dd-item')];
    const hits=items.filter(el=>{ const b=el.getBoundingClientRect();
      return document.elementFromPoint(b.left+b.width/2, b.top+b.height/2)===el; }).length;
    return JSON.stringify({ cls:menu.className, items:items.length, hits,
      inShelf: mr.top>=sr.top-0.5 && mr.bottom<=sr.bottom+0.5 && mr.left>=sr.left-0.5 && mr.right<=sr.right+0.5,
      box:{top:Math.round(mr.top), bottom:Math.round(mr.bottom), left:Math.round(mr.left), right:Math.round(mr.right)}});`, "card-menu");
  check(`卡内菜单整体落在滚动容器可视区内（按可视区实测翻边：${r.cls}）`, r.inShelf === true, JSON.stringify(r));
  check(`卡内菜单 10 个选项全部可命中（${r.hits}/${r.items}）`, r.items === 10 && r.hits === r.items, JSON.stringify(r));
  await fire(`const jp=[...document.querySelectorAll('.dd-menu .dd-item')].find(b=>b.textContent.trim()==='日语');
    if (jp) jp.click(); return !!jp;`);
  await wait(700);
  const lang = await page.eval(`const list=await window.libraryAPI.list(); const it=list.find(i=>i.id==='${bookId}'); return it?(it.lang||''):'MISS';`);
  r = await J(`${PRELUDE}
    const it=window.__S.items().find(e=>e.dataset.entry==='${bookId}');
    return JSON.stringify({ menuOpen: !!document.querySelector('.dd-menu'),
      meta: it?.querySelector('.cap-meta')?.textContent.replace(/\\s+/g,' ').trim() });`, "lang-set");
  check(`真点选项生效：语言写库（${lang}）且菜单收起、图注同步`, lang === "ja" && r.menuOpen === false && /JA/.test(r.meta || ""), JSON.stringify({ lang, ...r }));

  // ② 拖到两卡之间的空白：dragover 要被接受、drop 要产生、顺序要真的变。
  //    改前空白命中 `.bookshelf-grid` 本身，而容器上没有任何拖拽处理器 → 不 preventDefault → 无 drop。
  const idsB = await page.eval(`${PRELUDE} return window.__S.ids()`);
  const gapPt = `const c0=window.__S.items()[0].querySelector('.shelf-face').getBoundingClientRect();
    const c1=window.__S.items()[1].querySelector('.shelf-face').getBoundingClientRect();
    return [(c0.right+c1.left)/2, c0.top+c0.height/2];`;
  await fire(`const a=window.__S.items()[3]; return window.__S.fire(a,'dragstart', ...window.__S.pt(a,0.5));`);
  await wait(420);
  const accepted = await fire(`${PRELUDE} const [x,y]=(()=>{${gapPt}})();
    return window.__S.fire(window.__S.grid(),'dragover',x,y);`);
  await wait(420);
  r = await J(`${PRELUDE} return JSON.stringify({ zones: window.__S.items().map(e=>(e.className.match(/zone-\\w+/)||[null])[0]) });`, "gap-zone");
  await fire(`const [x,y]=(()=>{${gapPt}})(); const a=window.__S.items()[3];
    window.__S.fire(window.__S.grid(),'drop',x,y); window.__S.fire(a,'dragend'); return 1;`);
  await wait(700);
  const idsA = await page.eval(`${PRELUDE} return window.__S.ids()`);
  const arrB = idsB.split(",");
  check("两卡之间空白处的 dragover 被接受（改前不被 accepted → 指针变禁止图标、松开不产生 drop）", accepted === true, accepted);
  check("空白处的落点高亮画在最近的一格上", r.zones?.filter(Boolean).length === 1, JSON.stringify(r));
  check("在空白处松手完成重排：第 4 条落到第 1、2 条之间",
    idsA === [arrB[0], arrB[3], arrB[1], arrB[2]].join(","), JSON.stringify({ before: idsB, after: idsA }));

  // ③ 拖/长按之后的动作条残留：显形判据是 `:focus-visible`，鼠标按下的焦点不算。
  //    改前焦点滞留在卡上（`div[tabindex=0]` + 拖拽吃掉 click）→ `:focus-within` 把 40px ink 条钉住。
  const cp = JSON.parse(await page.eval(`${PRELUDE}
    const c=window.__S.items()[0].querySelector('.book-card').getBoundingClientRect();
    return JSON.stringify({ x:Math.round(c.left+c.width/2), y:Math.round(c.top+c.height*0.4) });`));
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cp.x, y: cp.y });
  await wait(200);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cp.x, y: cp.y, button: "left", buttons: 1, clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cp.x + 14, y: cp.y + 8, button: "left", buttons: 1 });
  await wait(150);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 6, y: 300, button: "left", buttons: 1 });
  await wait(200);
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 6, y: 300, button: "left", buttons: 0, clickCount: 1 });
  await wait(500);
  r = await J(`${PRELUDE}
    const cards=window.__S.items().map(e=>e.querySelector('.book-card'));
    return JSON.stringify({
      op: window.__S.items().map(e=>getComputedStyle(e.querySelector('.card-acts')).opacity),
      focusWithin: cards.some(c=>c.matches(':focus-within')),
      focusVisible: cards.some(c=>c.matches(':focus-visible')) });`, "residue");
  check("拖/长按之后动作条不残留（焦点还在也不显形——改前 :focus-within 会把它钉在屏上）",
    r.op.every(v => v === "0") && r.focusVisible === false, JSON.stringify(r));

  // 键盘可达不回退：必须由**真实 Tab 键**把焦点送进卡片（程序化 focus() 的 `:focus-visible`
  // 取决于浏览器记录的输入模态，CDP 合成键不保证翻转它——实测会得到假红）。
  // 焦点可能落在卡本身（`.book-card:focus-visible`）或卡内按钮（`:has(:focus-visible)`），两条都算显形。
  let kbdHit = null;
  for (let i = 0; i < 30 && !kbdHit?.onCard; i++) {
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await wait(90);
    kbdHit = await J(`${PRELUDE}
      const el=document.activeElement, c=el?.closest?.('.book-card');
      return JSON.stringify({ onCard: !!c, active:(el?.className||el?.tagName||'').toString().slice(0,40),
        elFv: el ? el.matches(':focus-visible') : null,
        fv: c ? c.matches(':focus-visible') : null,
        hasFv: c ? c.matches(':has(:focus-visible)') : null,
        acts: c ? getComputedStyle(c.querySelector('.card-acts')).opacity : null });`, "kbd");
  }
  await wait(260); // 等 opacity 过渡走完（--dur 量级）
  const kbdSettled = kbdHit?.onCard ? await J(`${PRELUDE}
    const el=document.activeElement, c=el?.closest?.('.book-card');
    return JSON.stringify({ onCard: !!c, acts: c ? getComputedStyle(c.querySelector('.card-acts')).opacity : null });`, "kbd-settled") : null;
  check("键盘 Tab 走到卡片时动作条显形（`:focus-visible` 成立、opacity=1，键盘可达不回退）",
    kbdHit?.onCard === true && (kbdHit.elFv === true || kbdHit.fv === true || kbdHit.hasFv === true) && kbdSettled?.acts === "1",
    JSON.stringify({ kbdHit, kbdSettled }));

  console.log(`\nShelf GUI: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("异常", e);
  process.exit(1);
} finally {
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(1000);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* Windows 句柄未释放 */ }
}
