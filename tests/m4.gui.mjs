// M4 快捷键 GUI 冒烟（CDP 驱动真实 UI）——阅读四键 / 复习五键 / 设置区块（键位捕获 + 冲突 + 恢复默认）
// 安全纪律（沿 M1/M2）：
//  - 全部测试数据带 FSRSTEST 前缀；复习区每次按键前断言当前卡面含 FSRSTEST，否则立即停手；
//  - Ctrl+X / Ctrl+A 会触达 AI 网关：先探测能否把 window.aiAPI 覆写为测试桩（零网络调用）；
//    不可覆写且用户已配置 Key 时跳过这两条键（绝不真实调用 AI）；
//  - Ctrl+S 产生的摘录无删除 API，残留在学习队列——测试完关闭应用后运行 tests/m4.cleanup.cjs 清库。
// 前置：应用已以 --remote-debugging-port=9224 启动（根目录执行：npx electron . --remote-debugging-port=9224）
const list = await (await fetch("http://127.0.0.1:9224/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 150)}`); }
}
async function evalJS(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 250);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseState = (s) => { try { return JSON.parse(s); } catch { return {}; } };
// 组合键派发（合成 KeyboardEvent 走 window capture 监听，与真实按键同链路；isTrusted 差异不影响分发逻辑）
const press = (init) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(init)})) || 'sent'`);

// v48.52：foliate 引擎内拖选（SELECT_GEO 报坐标 → CDP 真鼠标拖选 → 选区菜单确认）
async function runSelect() {
  const geo = parseState(await evalJS(SELECT_GEO));
  if (typeof geo.x1 !== "number") return "NO TEXT";
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geo.x1, y: geo.y });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: geo.x1, y: geo.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geo.x1 + ((geo.x2 - geo.x1) * i) / 6, y: geo.y, button: "left", buttons: 1 });
    await sleep(40);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geo.x2, y: geo.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(600);
  return (await evalJS(`!!document.querySelector('.selection-menu')`)) ? "menu" : "no-menu";
}

// 选区辅助：v48.52 起粘贴书走 foliate 引擎（iframe）——先报坐标（测试进程真鼠标拖选），见 runSelect()
const SELECT_GEO = `(() => {
  const mark = 'FSRSTEST';
  const k = window.__readerKernel;
  const entries = (k && k.__getContents ? k.__getContents() : []).filter((e) => e.doc && e.doc.defaultView && e.doc.defaultView.frameElement);
  for (const { doc } of entries) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || '').indexOf(mark);
      if (idx < 0) continue;
      const range = doc.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + mark.length);
      const rects = range.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) return '';
      const fr = doc.defaultView.frameElement.getBoundingClientRect();
      return JSON.stringify({ x1: fr.left + first.left + 2, x2: fr.left + last.right - 2, y: fr.top + first.top + first.height / 2 });
    }
  }
  return '';
})()`;

// 0) 清残留
console.log("== G0 清理残留 ==");
const g0 = parseState(await evalJS(`(async () => {
  let n = 0;
  for (const c of await window.cardsAPI.listAll()) { if ((c.noteText || '').includes('FSRSTEST')) { await window.cardsAPI.remove(c.id); n++; } }
  for (const it of await window.libraryAPI.list()) { if ((it.title || '').includes('FSRSTEST')) { await window.libraryAPI.remove(it.id); n++; } }
  return JSON.stringify({ cleaned: n });
})()`));
console.log(`  G0: ${JSON.stringify(g0)}`);

// 1) 建测试书并打开阅读器
console.log("== G1 建书 + 打开阅读器 ==");
// v48.52：夹具改单章无标题（multiselect/marks 同规——多章 EPUB 在测试环境渲染为空白，main 分支同样）
await evalJS(`window.libraryAPI.createFromPaste(${JSON.stringify("FSRSTEST M4 验证书")}, ${JSON.stringify("FSRSTEST 中位数是把一组数据排序后位于中间位置的数，它对极端值不敏感。\n\nFSRSTEST 勾股定理 a²+b²=c² 是几何学的基石。")})`);
await evalJS("window.location.reload()");
await sleep(2500);
const opened = await evalJS(`(async () => {
  const target = document.querySelector('.book-card[title*="FSRSTEST"]');
  if (!target) return 'BOOK NOT FOUND';
  target.click();
  await new Promise((r) => setTimeout(r, 1500));
  // v48.52：粘贴书走 foliate 引擎分支（markdown 分支才有 .reader-title）——改查 .reader-wrap
  return 'reader=' + (document.querySelector('.reader-wrap') ? 'open' : 'closed');
})()`);
check("测试书打开进入阅读器", String(opened).includes("reader=open"), opened);
// v48.52：等阅读内核就绪（foliate 章节文档可查）——拖选依赖内核内容
for (let i = 0; i < 20; i++) {
  const ok = await evalJS(`(() => { const k = window.__readerKernel; return !!(k && k.__getContents && k.__getContents().some((e) => e.doc && e.doc.defaultView && (e.doc.body?.textContent || '').includes('FSRSTEST'))); })()`);
  if (ok === true) break;
  await sleep(500);
}

// 1.5) AI 桩（必须在建书 reload 之后挂载——reload 会重置页面上下文）
console.log("== G1.5 AI 桩探测（防真实调用） ==");
const aiStubState = parseState(await evalJS(`(() => {
  let aiStub = 'fail';
  try {
    const fake = {
      getConfig: async () => null, setConfig: async () => false,
      test: async () => ({ ok: false, message: 'stub' }), listModels: async () => [], websearch: async () => [],
      onStream: (cb) => { window.__aiCb = cb; return () => {}; },
      chat: (rid) => { window.__aiCb && window.__aiCb(rid, { error: 'GUI-TEST-STUB' }); }
    };
    Object.defineProperty(window, 'aiAPI', { value: fake, configurable: true });
    aiStub = window.aiAPI === fake ? 'ok' : 'fail';
  } catch (e) { aiStub = 'fail:' + e.message; }
  return JSON.stringify({ aiStub });
})()`));
let AI_SKIP = false;
if (aiStubState.aiStub === "ok") {
  console.log("  aiAPI 已替换为测试桩（AI 面板会立即收到 stub 错误，零网络调用）");
} else {
  const hasKey = parseState(await evalJS(`(async () => { const c = await window.aiAPI.getConfig().catch(() => null); return JSON.stringify({ hasKey: Boolean(c && c.hasKey) }); })()`));
  AI_SKIP = hasKey.hasKey;
  console.log(`  ⚠ aiAPI 不可覆写（${aiStubState.aiStub}），用户 Key=${hasKey.hasKey ? "已配置" : "未配置"}` + (AI_SKIP ? "：Ctrl+X / Ctrl+A 跳过" : "：走未配置报错路径"));
}

// D114 守卫契约（Reader.tsx readerShortcutReady）：手动表单/AI 面板/词典面板任一在场时阅读快捷键让路
//（「弹层开着不触发新动作」）；制卡台手动表单无取消钮（D123）、AI 面板无「关闭」（仅全部拒绝可清）——
// 键与键之间以重载复位应用态（等价用户重启应用），各键从干净守卫态出发。
// reload 后 preload 重新暴露 aiAPI（contextBridge 属性不可 redefine），故每次复位后重探 AI 门：
// 桩可装或未配置 Key 才继续 AI 两键（绝不真实调用）。
async function aiGate() {
  const s = parseState(await evalJS(`(() => {
    try {
      const fake = { getConfig: async () => null, setConfig: async () => false, test: async () => ({ ok: false, message: 'stub' }), listModels: async () => [], websearch: async () => [], onStream: (cb) => { window.__aiCb = cb; return () => {}; }, chat: (rid) => { window.__aiCb && window.__aiCb(rid, { error: 'GUI-TEST-STUB' }); } };
      Object.defineProperty(window, 'aiAPI', { value: fake, configurable: true });
      return JSON.stringify({ ok: window.aiAPI === fake });
    } catch { return JSON.stringify({ ok: false }); }
  })()`));
  if (s.ok === true) return true;
  const hk = parseState(await evalJS(`(async () => { const c = await window.aiAPI.getConfig().catch(() => null); return JSON.stringify({ hasKey: Boolean(c && c.hasKey) }); })()`));
  return hk.hasKey === false;
}
async function resetReaderState() {
  await evalJS("window.location.reload()");
  await sleep(2500);
  await evalJS(`(async () => { const t = document.querySelector('.book-card[title*="FSRSTEST"]'); if (t) { t.click(); await new Promise((r) => setTimeout(r, 1500)); } return 'reopened'; })()`);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJS(`(() => { const k = window.__readerKernel; return !!(k && k.__getContents && k.__getContents().some((e) => e.doc && (e.doc.body?.textContent || '').includes('FSRSTEST'))); })()`);
    if (ok === true) break;
    await sleep(500);
  }
  return aiGate();
}

// 2) 阅读快捷键
console.log("== G2 阅读快捷键 Ctrl+Z / Ctrl+X / Ctrl+A / Ctrl+S ==");
let selResult = "";
let aiReady = !AI_SKIP;

// Ctrl+Z → 手动制卡面板（D88 P3：制卡语境 modal-panel → data-card-dock；D92 起坞头为页签条，
// 手动暂态以「＋制卡」active + 手动 tabbody 表单在场断言，不再有单一标题位）
selResult = await runSelect();
check("选区菜单出现", selResult === "menu", selResult);
await press({ key: "z", ctrlKey: true, bubbles: true, cancelable: true });
await sleep(500);
const modalH2 = await evalJS(`(() => {
  const dock = document.querySelector('[data-card-dock]');
  // D144 §10：qa 首框＝GrowField+MdField（ProseMirror），无 textarea
  const form = dock?.querySelector('[data-testid="wb-manual-body"] .ProseMirror');
  const open = document.documentElement.dataset.wbOpen === '1';
  return JSON.stringify({ dock: !!dock, form: !!form, open });
})()`);
check("Ctrl+Z 打开手动制卡面板（制卡台手动区）", JSON.parse(modalH2).dock && JSON.parse(modalH2).form && JSON.parse(modalH2).open === true, modalH2);
// D123：制卡台无「取消/关闭」钮——Esc（焦点在台内）收起
await evalJS(`(() => { const d = document.querySelector('[data-card-dock]'); d?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'closed'; })()`);
await sleep(300);
// 守卫复位（见 resetReaderState 注释）：手动表单在场时后续阅读键会让路——重载回到干净态并重探 AI 门
aiReady = await resetReaderState();

// Ctrl+X → AI 制卡面板（stub 报错或未配置 Key 的零网络报错；D144：AI 制卡页签自动激活）
if (aiReady) {
  selResult = await runSelect();
  check("选区菜单出现（重选）", selResult === "menu", selResult);
  await press({ key: "x", ctrlKey: true, bubbles: true, cancelable: true });
  await sleep(700);
  const aiPanel1 = parseState(await evalJS(`(() => {
    const tab = document.querySelector('[data-testid="wb-tab-aicards"]');
    const e = document.querySelector('.ai-error');
    return JSON.stringify({ tab: tab ? String(tab.getAttribute('aria-selected')) : 'NO TAB', err: e ? e.textContent.slice(0, 30) : '' });
  })()`));
  check("Ctrl+X 打开 AI 制卡面板（AI 制卡页签激活）", aiPanel1.tab === "true", JSON.stringify(aiPanel1));
  check("AI 制卡面板为 stub 报错（未真实调用）", String(aiPanel1.err).includes("GUI-TEST-STUB") || String(aiPanel1.err).includes("AI"), aiPanel1.err);
  await evalJS(`document.querySelector('[data-card-dock] [data-dock-close]') && document.querySelector('[data-card-dock] [data-dock-close]').click()`);
  await sleep(300);
} else {
  console.log("  - 跳过 Ctrl+X（AI 桩不可用且已配置 Key）");
}
aiReady = await resetReaderState();

// Ctrl+A → AI 解释面板（D144：解释板块内容到达自动展开）
if (aiReady) {
  selResult = await runSelect();
  check("选区菜单出现（重选）", selResult === "menu", selResult);
  await press({ key: "a", ctrlKey: true, bubbles: true, cancelable: true });
  await sleep(700);
  const aiPanel2 = parseState(await evalJS(`(() => {
    const open = document.querySelector('[data-testid="wb-explain-toggle"]')?.getAttribute('aria-expanded');
    const e = document.querySelector('.ai-error');
    return JSON.stringify({ open: open ? String(open) : 'NO HANDLE', err: e ? e.textContent.slice(0, 30) : '' });
  })()`));
  check("Ctrl+A 打开 AI 解释面板（解释板块自动展开）", aiPanel2.open === "true", JSON.stringify(aiPanel2));
  await evalJS(`document.querySelector('[data-card-dock] [data-dock-close]') && document.querySelector('[data-card-dock] [data-dock-close]').click()`);
  await sleep(300);
} else {
  console.log("  - 跳过 Ctrl+A（AI 桩不可用且已配置 Key）");
}
await resetReaderState();

// Ctrl+S → 摘录
selResult = await runSelect();
  check("选区菜单出现（重选）", selResult === "menu", selResult);
await press({ key: "s", ctrlKey: true, bubbles: true, cancelable: true });
await sleep(700);
const toast = await evalJS(`(() => { const t = document.querySelector('.reader-toast'); return t ? t.textContent : 'NO TOAST'; })()`);
check("Ctrl+S 摘录成功提示", String(toast).includes("已摘录进学习队列"), toast);
// D58 §6.8-2「次日进队」：新摘录 topic_next_at＝次日切点，当日 listDueExtracts（含
// workflowAPI.listDue）必不含它——改断言全量事实源 listAll（§6.8-6）验证落库成功
const extractInQueue = await evalJS(`(async () => {
  const all = await window.workflowAPI.listAll();
  return all.some((x) => JSON.stringify(x).includes('FSRSTEST'));
})()`);
check("摘录已入库（D58 次日进队，不进当日 listDue）", extractInQueue === true, extractInQueue);

// 3) 复习快捷键
console.log("== G3 复习快捷键 空格 / 1-4 / q / w / d ==");
const seeded = await evalJS(`(async () => {
  const OLD = Date.parse('2000-01-01');
  const mk = (i, front) => window.cardsAPI.create({ noteText: 'FSRSTEST M4-' + i, cardType: 'qa', frontMarkdown: front, backMarkdown: '答案' + i, priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: OLD + i * 1000, lapses: 0, reps: 0 }) });
  await mk(1, '统计: FSRSTEST 中位数是什么？');
  await mk(2, '统计: FSRSTEST 众数是什么？');
  await mk(3, '统计: FSRSTEST 平均数是什么？');
  await mk(4, '统计: FSRSTEST 方差是什么？');
  return 'seeded4';
})()`);
check("播种 4 张测试卡", seeded === "seeded4", seeded);

await evalJS("window.location.reload()");
await sleep(2500);
await evalJS(`(() => { const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === '复习'); nav && nav.click(); return 'nav'; })()`);
await sleep(1500);

// 卡面守卫：非 FSRSTEST 卡立即停手（绝不触碰用户真实卡）
async function guard(needle) {
  const r = await evalJS(`(() => {
    const f = document.querySelector('.review-front');
    if (!f) return 'NO FACE';
    return f.innerText.includes(${JSON.stringify(needle)}) ? 'ok' : 'FACE:' + f.innerText.slice(0, 30);
  })()`);
  return r === "ok";
}
const guard1 = await guard("中位数是什么");
check("复习页显示测试卡 M4-1", guard1, guard1);
if (!guard1) { console.log("  ✗ 卡面守卫失败，停止复习区测试"); process.exit(1); }

// 空格 → 翻面
await press({ key: " ", bubbles: true, cancelable: true });
await sleep(500);
const backShown = await evalJS(`(() => { const b = document.querySelector('.review-back'); const g = document.querySelector('.grade-row'); return JSON.stringify({ back: Boolean(b), grades: Boolean(g) }); })()`);
check("空格显示答案 + 评分按钮", parseState(backShown).back === true && parseState(backShown).grades === true, backShown);

// 3 → Good 评分 → 下一张 M4-2
await press({ key: "3", bubbles: true, cancelable: true });
await sleep(1800);
const g2ok = await guard("众数是什么");
check("评分 Good 后自动出 M4-2", g2ok, "front 应为众数");

// q → 标记并暂停（正面即可触发）→ M4-3
await press({ key: "q", bubbles: true, cancelable: true });
await sleep(1800);
const g3ok = await guard("平均数是什么");
check("q 标记并暂停后出 M4-3", g3ok, "front 应为平均数");
const bState = parseState(await evalJS(`(async () => {
  const all = await window.cardsAPI.listAll();
  const b = all.find((c) => (c.noteText || '') === 'FSRSTEST M4-2');
  return JSON.stringify({ suspended: Boolean(b && b.leech && b.leech.suspended) });
})()`));
check("M4-2 已暂停（leech.suspended）", bState.suspended === true, JSON.stringify(bState));

// w → 跳过（正面即可触发，due+10min）→ M4-4
await press({ key: "w", bubbles: true, cancelable: true });
await sleep(1800);
const g4ok = await guard("方差是什么");
check("w 跳过后出 M4-4", g4ok, "front 应为方差");
const cState = parseState(await evalJS(`(async () => {
  const all = await window.cardsAPI.listAll();
  const c = all.find((x) => (x.noteText || '') === 'FSRSTEST M4-3');
  return JSON.stringify({ due: c ? c.fsrs && c.fsrs.due : 0, now: Date.now() });
})()`));
check("M4-3 跳过后 due 在 10 分钟后", cState.due > cState.now + 9 * 60_000, JSON.stringify(cState));

// 空格 + 1（Again）→ 最后一张完成
await press({ key: " ", bubbles: true, cancelable: true });
await sleep(500);
await press({ key: "1", bubbles: true, cancelable: true });
await sleep(1800);
// 用户可能有真实到期卡（在 4 张测试卡之后出队），故此后不再派发任何按键（直到重载）。
  // 计数口径（复习页 Anki 式改版，2026-10-01）：收尾页 .review-head .review-count 显示「N 张已复习」
  //（今日口径，跨运行累计——断言 ≥3 而非 ==3）；会话中头部只有三档计数，无「本轮 N 张」。
const done1 = parseState(await evalJS(`(() => {
  const front = document.querySelector('.review-front');
  const cnt = document.querySelector('.review-head .review-count');
  const m = cnt ? cnt.textContent.match(/(\\d+) 张已复习/) : null;
  return JSON.stringify({
    doneCount: m ? parseInt(m[1], 10) : null,
    noTestCard: !front || !front.innerText.includes('FSRSTEST')
  });
})()`));
check("四张测试卡处理完（收尾计数≥3 或已离场，当前不再是测试卡）", (done1.doneCount === null || done1.doneCount >= 3) && done1.noTestCard === true, JSON.stringify(done1));

// d → 删除（先 stub confirm 自动确认）
await evalJS(`(async () => {
  await window.cardsAPI.create({ noteText: 'FSRSTEST M4-5', cardType: 'qa', frontMarkdown: '统计: FSRSTEST 标准差是什么？', backMarkdown: '答案5', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: Date.parse('2000-01-01'), lapses: 0, reps: 0 }) });
  return 'seeded5';
})()`);
await evalJS("window.location.reload()");
await sleep(2500);
await evalJS(`(() => { const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === '复习'); nav && nav.click(); return 'nav'; })()`);
await sleep(1500);
const guard5 = await guard("标准差是什么");
check("复习页显示测试卡 M4-5", guard5, guard5);
if (guard5) {
  await evalJS(`window.confirm = () => true; 'stubbed'`);
  await press({ key: "d", bubbles: true, cancelable: true });
  await sleep(1800);
  // M4-5 due 最老必在队首被删；之后出队的可能是用户真实卡——只断言卡已删 + 测试卡已离场，不再按键
  const afterD = parseState(await evalJS(`(async () => {
    const all = await window.cardsAPI.listAll();
    const e = all.find((c) => (c.noteText || '') === 'FSRSTEST M4-5');
    const front = document.querySelector('.review-front');
    return JSON.stringify({ removed: !e, movedOn: !front || !front.innerText.includes('标准差') });
  })()`));
  check("d 删除测试卡（confirm 已 stub）并前进", afterD.removed === true && afterD.movedOn === true, JSON.stringify(afterD));
}

// 3.5) 撤销评分（v22：z 键 / meta 行按钮）
console.log("== G3.5 撤销评分（z / 撤销按钮） ==");
await evalJS(`(async () => {
  await window.cardsAPI.create({ noteText: 'FSRSTEST M4-6', cardType: 'qa', frontMarkdown: '统计: FSRSTEST 进度差是什么？', backMarkdown: '答案6', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: Date.parse('2000-01-01'), lapses: 0, reps: 0 }) });
  return 'seeded6';
})()`);
// 收尾页无底栏（复习页 v2 改版）：若 M4-6 评分后队列即空，底栏「更多」不渲染，撤销按钮无从断言——
// 垫一张 M4-7（due 晚于 M4-6，出队顺序 M4-6 → M4-7）保证评分后仍在会话中（底栏在场）。
await evalJS(`(async () => {
  await window.cardsAPI.create({ noteText: 'FSRSTEST M4-7', cardType: 'qa', frontMarkdown: '统计: FSRSTEST 离散度是什么？', backMarkdown: '答案7', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: Date.parse('2000-01-02'), lapses: 0, reps: 0 }) });
  return 'seeded7';
})()`);
await evalJS("window.location.reload()");
await sleep(2500);
await evalJS(`(() => { const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === '复习'); nav && nav.click(); return 'nav'; })()`);
await sleep(1500);
const guard6 = await guard("进度差是什么");
check("复习页显示测试卡 M4-6", guard6, guard6);
if (guard6) {
  await press({ key: " ", bubbles: true, cancelable: true });
  await sleep(500);
  await press({ key: "3", bubbles: true, cancelable: true });
  await sleep(1800);
  // 撤销评分已搬进底栏「更多」（2026-10-01）：先开更多、再读弹层里的条目（点开与查询分两次 eval）
  await evalJS(`(() => {
    const m = [...document.querySelectorAll('.review-bar .bar-more button')].find((x) => x.textContent.trim().startsWith('更多'));
    m?.click();
    return m ? 1 : 0;
  })()`);
  await sleep(400);
  const undoBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('.review-bar .bar-pop button')].find((x) => x.textContent.startsWith('撤销评分'));
    return b ? b.textContent : 'NO UNDO BTN';
  })()`);
  const barDiag = await evalJS(`(() => {
    const bar = document.querySelector(".review-bar");
    const pop = document.querySelector(".review-bar .bar-pop");
    return JSON.stringify({
      bar: !!bar, pop: !!pop,
      barBtns: bar ? [...bar.querySelectorAll("button")].map((b) => b.textContent.trim()) : [],
      popBtns: pop ? [...pop.querySelectorAll("button")].map((b) => b.textContent.trim()) : []
    });
  })()`);
  check("评分后出现「撤销评分（Good）」按钮", String(undoBtn).includes("撤销评分") && String(undoBtn).includes("Good"), String(undoBtn) + " | " + String(barDiag));
  await press({ key: "Escape", bubbles: true, cancelable: true });
  await sleep(300);
  // 按 z 撤销：M4-6 回到当前位、背面展开可立即重评、FSRS 状态回 new
  await press({ key: "z", bubbles: true, cancelable: true });
  await sleep(1800);
  const undone = parseState(await evalJS(`(async () => {
    const front = document.querySelector('.review-front');
    const back = document.querySelector('.review-back');
    const grades = Boolean(document.querySelector('.grade-row'));
    const all = await window.cardsAPI.listAll();
    const m6 = all.find((c) => (c.noteText || '') === 'FSRSTEST M4-6');
    return JSON.stringify({
      currentIsM6: Boolean(front && front.innerText.includes('进度差')),
      backShown: Boolean(back && grades),
      fsrsState: m6 && m6.fsrs ? m6.fsrs.state : 'MISSING'
    });
  })()`));
  check("z 撤销后 M4-6 回到当前位且背面展开", undone.currentIsM6 === true && undone.backShown === true, JSON.stringify(undone));
  check("撤销后 FSRS 状态回到评分前（new）", undone.fsrsState === "new", "new", undone.fsrsState);
  // 再按按钮撤销路径不需要——清理阶段会移除该卡；将其评分收尾避免污染后续步骤
  await press({ key: "3", bubbles: true, cancelable: true });
  await sleep(1500);
}

// 4) 设置页快捷键区块（捕获 / 冲突 / 恢复）
console.log("== G4 设置页快捷键区块 ==");
await evalJS(`(() => { const gear = document.querySelector('[title=\"设置\"]'); gear && gear.click(); return 'settings'; })()`);
await sleep(600);
await evalJS(`(() => { const nav = [...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === '快捷键'); nav && nav.click(); return 'nav'; })()`);
await sleep(400);
// v48.70（D114）：「全局快捷键」并入 sec-shortcuts（子块根保留 id sec-global），.kb-row 计数作用域断言。
// 行数随决策演进：应用内 14→17（D121 +辨析 / D130 +上一页·下一页）；全局区 3→5（新增「随系统启动」「
// 关闭窗口收进托盘」两行，复用 kb-row 样式）→ 22；v48.114（D159）快速记录行随功能暂时移除 → 21
//（17 应用内 + 4 全局区：添加材料 / 制卡台 / 随系统启动 / 收进托盘）。
const kbRows = await evalJS(`document.querySelectorAll('#sec-shortcuts .kb-row').length`);
check("快捷键区块 21 行（17 应用内 + 4 全局区）", kbRows === 21, kbRows);

// 捕获：把「评分 Good」改为 8
const captureGood = parseState(await evalJS(`(async () => {
  const row = [...document.querySelectorAll('.kb-row')].find((r) => (r.querySelector('.kb-row-title') || {}).textContent === '评分 Good');
  if (!row) return 'NO ROW';
  row.querySelector('.kb-key').click();
  await new Promise((r2) => setTimeout(r2, 200));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true, cancelable: true }));
  await new Promise((r2) => setTimeout(r2, 300));
  return JSON.stringify({ key: row.querySelector('.kb-key').textContent });
})()`));
check("键位捕获：Good 改为 8", captureGood.key === "8", JSON.stringify(captureGood));

// 冲突：把「评分 Hard」也改成 8 → 拒绝保存并提示
const conflictHard = parseState(await evalJS(`(async () => {
  const row = [...document.querySelectorAll('.kb-row')].find((r) => (r.querySelector('.kb-row-title') || {}).textContent === '评分 Hard');
  if (!row) return 'NO ROW';
  row.querySelector('.kb-key').click();
  await new Promise((r2) => setTimeout(r2, 200));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true, cancelable: true }));
  await new Promise((r2) => setTimeout(r2, 300));
  const msg = row.querySelector('.kb-conflict');
  return JSON.stringify({ key: row.querySelector('.kb-key').textContent, conflict: msg ? msg.textContent : '' });
})()`));
check("冲突检测：Hard 改 8 被拒绝", conflictHard.key === "2" && String(conflictHard.conflict).includes("评分 Good"), JSON.stringify(conflictHard));

// 恢复：Good 恢复默认 3
const resetGood = parseState(await evalJS(`(async () => {
  const row = [...document.querySelectorAll('.kb-row')].find((r) => (r.querySelector('.kb-row-title') || {}).textContent === '评分 Good');
  if (!row) return 'NO ROW';
  row.querySelector('.kb-reset').click();
  await new Promise((r2) => setTimeout(r2, 400));
  return JSON.stringify({ key: row.querySelector('.kb-key').textContent, resetDisabled: row.querySelector('.kb-reset').disabled });
})()`));
check("恢复默认：Good 回到 3", resetGood.key === "3" && resetGood.resetDisabled === true, JSON.stringify(resetGood));

// 持久化核验：settings.app.keybindings 不再含覆盖
const persisted = parseState(await evalJS(`(async () => { const v = await window.settingsAPI.get('app', 'keybindings'); return JSON.stringify(v || {}); })()`));
check("覆盖项已清空（全部默认）", Object.keys(persisted).length === 0, JSON.stringify(persisted));

// 5) 清理（卡片与书；摘录需关库后由 tests/m4.cleanup.tmp.cjs 清理）
console.log("== G5 清理 FSRSTEST 卡片与书籍 ==");
const cleaned = await evalJS(`(async () => {
  let n = 0;
  for (const c of await window.cardsAPI.listAll()) { if ((c.noteText || '').includes('FSRSTEST')) { await window.cardsAPI.remove(c.id); n++; } }
  for (const it of await window.libraryAPI.list()) { if ((it.title || '').includes('FSRSTEST')) { await window.libraryAPI.remove(it.id); n++; } }
  return 'removed ' + n;
})()`);
check("FSRSTEST 卡片与书籍已清理（≥5）", /removed ([5-9]|\d\d)/.test(String(cleaned)), cleaned);

console.log(`\nM4 GUI 冒烟：${pass} 通过 / ${fail} 失败`);
console.log("⚠ 提醒：Ctrl+S 产生的 FSRSTEST 摘录需关应用后运行 tests/m4.cleanup.cjs 清库");
process.exit(fail > 0 ? 1 : 0);
