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
  check("封面保持 2:3 且直角", r.cardAspect === "2 / 3" && r.radius === "0px", JSON.stringify(r));
  check("卡面上不再有原生 <select>（旧版语言下拉）", r.nativeSelect === 0, r.nativeSelect);
  check("动作条 4 枚（重命名/语言/归入/删除）", r.acts === 4, r.acts);

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
      grips: document.querySelectorAll('.shelf-grip').length,
      hint: document.querySelector('.shelf-hint')?.textContent.trim(),
      dropdownValue: document.querySelector('.shelf-bar .dd-btn')?.textContent.trim(),
    });`));
  check("排序下拉列出四档", /手动顺序/.test(r.dropdownValue || "") === false && /标题/.test(r.dropdownValue || ""), r.dropdownValue);
  check("「标题」排序按字典序生效", r.after.join() === [...r.after].sort((a, b) => a.localeCompare(b, "zh")).join(), JSON.stringify(r.after));
  check("非手动顺序下把手与 draggable 全部撤场", r.draggable === 0 && r.grips === 0, JSON.stringify(r));
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
    return JSON.stringify({grips: document.querySelectorAll('.shelf-grip').length, draggable:[...document.querySelectorAll('.shelf-item')].filter(e=>e.getAttribute('draggable')==='true').length});`));
  check("切回手动顺序：把手回到 4 张卡上", r.grips === 4 && r.draggable === 4, JSON.stringify(r));

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
    return J(`const b=window.__S.items()[1]; return JSON.stringify({
      cls: b ? b.className : null, tip: b?.querySelector('.zone-tip')?.textContent || null,
      bar: b ? getComputedStyle(b, '::before').backgroundColor : null, items: window.__S.items().length });`, "zone");
  };
  await dragstart();
  const center = await dragover(0.5);
  const left = await dragover(0.04);
  const right = await dragover(0.97);
  check("中央区：zone-group + 浮出「成组」提示", /zone-group/.test(center.cls) && /成组/.test(center.tip || ""), JSON.stringify(center));
  check("左缘区：zone-before（画 accent 竖条，不提示成组）", /zone-before/.test(left.cls) && !left.tip, JSON.stringify(left));
  check("右缘区：zone-after", /zone-after/.test(right.cls) && !right.tip, JSON.stringify(right));

  await dragover(0.5);
  await fire(`const a=window.__S.items()[0], b=window.__S.items()[1];
    const [x,y]=window.__S.pt(b,0.5);
    window.__S.fire(b,'drop',x,y); window.__S.fire(a,'dragend'); return 1;`);
  await wait(700);
  r = JSON.parse(await page.eval(`
    ${PRELUDE}
    const f=window.__S.items().find(e=>e.querySelector('.f-face'));
    return JSON.stringify({
      folders: window.__S.folderCards().length,
      items: window.__S.items().length,
      count: window.__S.count(),
      renameInput: document.activeElement?.className,
      renameValue: document.activeElement?.value,
      tab: f?.querySelector('.f-tab')?.textContent,
      spines: f ? f.querySelectorAll('.f-spines i').length : 0,
      sum: f?.querySelector('.f-sum')?.textContent.replace(/\\s+/g,' ').trim(),
      roster: f ? f.querySelectorAll('.f-roster li').length : 0,
      rosterOpacity: f ? getComputedStyle(f.querySelector('.f-roster')).opacity : null,
    });`));
  check("松手即成文件夹：顶层少一格、多一张文件夹卡",
    r.folders === 1 && r.items === 3 && /^2 本 · 1 个文件夹$/.test(r.count || ""), JSON.stringify(r));
  check("合集面在场：FOLDER 标签页 + 2 条书脊 + 成员数与均值",
    r.tab === "FOLDER" && r.spines === 2 && /2\s*本/.test(r.sum || "") && /均值/.test(r.sum || ""), JSON.stringify(r));
  check("成组后立刻弹出就地命名输入框（不自动取名）",
    /cap-input/.test(r.renameInput || "") && /未命名/.test(r.renameValue || ""), JSON.stringify(r));
  check("成员名册列出 2 本书、静止时 opacity=0（hover 才现）",
    r.roster === 2 && r.rosterOpacity === "0", JSON.stringify(r));

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
      sum: f?.querySelector('.f-sum')?.textContent.replace(/\\s+/g,' ').trim(), items: window.__S.items().length});`, "moved-out");
  check("把书拖到「返回书架」= 移回书架，文件夹剩 1 本",
    r.folders === 1 && /1\s*本/.test(r.sum || ""), JSON.stringify(r));

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
      sum: f?.querySelector('.f-sum')?.textContent.replace(/\\s+/g,' ').trim(),
      spines: f ? f.querySelectorAll('.f-spines i').length : 0, count: window.__S.count()});`, "single-folder");
  check("单成员文件夹建好并可命名（书脊不铺满整张卡）",
    r.title === "单本夹" && /1\s*本/.test(r.sum || "") && r.spines === 1, JSON.stringify(r));

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

  console.log("\n[13] 全局纪律扫描：字号下限 / 圆角 / 硬编码焦点色");
  r = await J(`const small=[]; const rad=[];
    document.querySelectorAll('#root *').forEach(el=>{
      const cs=getComputedStyle(el);
      if (cs.display==='none' || cs.visibility==='hidden') return;
      const fs=parseFloat(cs.fontSize);
      if (fs && fs < 11) small.push((el.className||el.tagName)+'='+fs);
      if (cs.borderTopLeftRadius!=='0px') rad.push((el.className||el.tagName)+'='+cs.borderTopLeftRadius);
    });
    const shelf=document.querySelector('.bookshelf');
    return JSON.stringify({small, rad, container: getComputedStyle(shelf).containerType});`, "scan");
  check("书架里没有 < 11px 的文字", r.small.length === 0, JSON.stringify(r.small.slice(0, 6)));
  check("书架里没有非 0 圆角", r.rad.length === 0, JSON.stringify(r.rad.slice(0, 6)));
  check("容器查询宿主在场（工具条逐级退让依赖它）", /inline-size/.test(r.container || ""), r.container);

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
