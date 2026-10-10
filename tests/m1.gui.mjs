// M1 GUI 冒烟验证（CDP 驱动真实 UI，断言新功能 DOM 行为）— v16 版：翻转问答=两张独立卡
// 安全纪律：测试卡 due=2000 年保证排在用户真实卡之前；每次评分前断言当前卡含 FSRSTEST，
// 遇到非测试卡立即停止（跳过/评分都不触碰用户真实卡）。
// 前置：应用已以 --remote-debugging-port=9224 启动
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
const parseState = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const OLD = Date.parse("2000-01-01");

// 0) 清掉上轮可能残留的 FSRSTEST 数据
await evalJS(`(async () => {
  let n = 0;
  for (const c of await window.cardsAPI.listAll()) { if ((c.noteText || '').includes('FSRSTEST')) { await window.cardsAPI.remove(c.id); n++; } }
  for (const it of await window.libraryAPI.list()) { if ((it.title || '').includes('FSRSTEST')) { await window.libraryAPI.remove(it.id); n++; } }
  return 'cleaned ' + n;
})()`);

// 1) 建测试书（含 FSRSTEST 标记词的段落）并打开
// v25 起阅读器一律走内核（粘贴书合成 EPUB），断言改为 foliate 引擎视图
const bookTitle = "FSRSTEST M1 验证书";
const bookMd = "# 第一章\n\nFSRSTEST 中位数是把一组数据排序后位于中间位置的数，它对极端值不敏感。\n\n# 第二章\n\nFSRSTEST 勾股定理公式 a²+b²=c² 是几何学的基石。";
console.log("== G1 建书 + 打开阅读器 ==");
await evalJS(`(async () => { await window.libraryAPI.createFromPaste(${JSON.stringify(bookTitle)}, ${JSON.stringify(bookMd)}); return "ok"; })()`);
await evalJS("window.location.reload()");
await new Promise((r) => setTimeout(r, 2500));
const opened = await evalJS(`(async () => {
  const target = document.querySelector('.book-card[title*="FSRSTEST"]');
  if (!target) return 'BOOK NOT FOUND';
  target.click();
  await new Promise((r) => setTimeout(r, 3000));
  return 'reader=' + (document.querySelector('.reader-engine-host foliate-view') ? 'open' : 'closed');
})()`);
check("测试书打开进入阅读器", String(opened).includes("reader=open"), opened);

// 2) 选区菜单 5 按钮（引擎态：选区注入章节 iframe，pointerup 由内核中继）
// 粘贴书合成 EPUB 的首章为空章（markdown 以一级标题开头时），先按文本搜索定位到含标记词的章
console.log("== G2 选区菜单（图片挖空入口） ==");
await evalJS(`window.__readerKernel.goTo({ search: 'FSRSTEST 中位数' })`);
await new Promise((r) => setTimeout(r, 900));
const selOk = await evalJS(`(() => {
  const k = window.__readerKernel;
  const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
  if (!entry) return 'NO DOC';
  const doc = entry.doc;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const idx = (node.textContent || '').indexOf('FSRSTEST');
    if (idx >= 0) {
      const range = doc.createRange();
      range.setStart(node, idx); range.setEnd(node, idx + 8);
      const sel = doc.defaultView.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const frame = doc.defaultView.frameElement;
      const p = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p.left + 200, clientY: p.top + 120 }));
      return 'selected';
    }
  }
  return 'MARKER NOT FOUND';
})()`);
await new Promise((r) => setTimeout(r, 500));
// v48.41（D81）：菜单只留形式段控+调色排；动作行上移阅读器工具栏（data-sel-act）。
// 断言动作组文本集（语义＝「动作齐全」，不数色块）。
const menu = await evalJS(`[...document.querySelectorAll('[data-sel-act]')].map((b) => b.textContent.trim()).join('/')`);
check("阅读器工具栏动作组 6 项（含图片挖空）", String(menu).split("/").length === 6 && String(menu).includes("图片挖空"), String(selOk) + " | " + menu);

// 3) 手动制卡「翻转问答」→ 应创建两张互为翻转的独立 qa 卡（v16 D18）
// v25/M5：类型页签由 3 个扩为 4 个（新增「图片挖空」）
console.log("== G3 手动制卡 · 翻转问答 = 两张独立卡 ==");
const tabs = await evalJS(`(() => {
  [...document.querySelectorAll('[data-sel-act="manual"]')].find((b) => b.textContent === "制卡").click();
  return new Promise((res) => setTimeout(() => {
    res([...document.querySelectorAll('[data-card-dock] .wb-tabs button')].map((b) => b.textContent.trim()).join('/'));
  }, 300));
})()`);
check("手动制卡 tabs = 问答题/翻转问答/填空题/图片挖空", tabs === "问答题/翻转问答/填空题/图片挖空", tabs);
const saved = await evalJS(`(() => {
  [...document.querySelectorAll('[data-card-dock] .wb-tabs button')].find((b) => b.textContent === "翻转问答").click();
  return new Promise((res) => setTimeout(() => {
    const tas = [...document.querySelectorAll('[data-card-dock] textarea')];
    if (tas.length < 4) { res('FIELDS=' + tas.length); return; }
    // React 受控组件必须用原型原生 setter 赋值（直接 ta.value= 会被值追踪器去重，onChange 不触发）
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const set = (ta, v) => { nativeSetter.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); };
    set(tas[0], '统计: FSRSTEST 中位数是什么？');
    set(tas[1], '排序后中间的数');
    set(tas[2], '统计: FSRSTEST 排序后位于中间位置的数叫什么？');
    set(tas[3], '中位数');
    setTimeout(() => {
      const saveBtn = [...document.querySelectorAll('[data-card-dock] .form-actions button')].find((b) => b.textContent.trim() === '制卡');
      if (saveBtn.disabled) { res('BTN DISABLED'); return; }
      saveBtn.click();
      // 两张卡 = 两次落库（各含 lint + 相似检索 await），留足时间再查库
      setTimeout(async () => {
        const all = await window.cardsAPI.listAll();
        const pair = all.filter((c) => (c.noteText || '').includes('FSRSTEST'));
        res(JSON.stringify({ count: pair.length, types: pair.map((c) => c.cardType).join('/'), fronts: pair.map((c) => c.frontMarkdown).join('|') }));
      }, 2600);
    }, 150);
  }, 250));
})()`);
const savedParsed = parseState(saved);
check("翻转问答创建了两张独立卡", savedParsed.count === 2, saved);
check("两卡均为 qa 类型", savedParsed.types === "qa/qa", saved);
check("两卡题面互为翻转", String(savedParsed.fronts).includes("中位数是什么") && String(savedParsed.fronts).includes("叫什么"), saved);

// 4) 播种两张测试卡（due 2000 年，保证排在用户真实卡之前）：
//    ①普通 qa ②imageOcclusion；并断言复习端无「换面」类形态变化控件（v16 D18）
console.log("== G4 播种 + 复习（无方向徽标/换面按钮） ==");
const seeded = await evalJS(`(async () => {
  const OLD = ${OLD};
  await window.cardsAPI.create({ noteText: 'FSRSTEST 种子问答卡', cardType: 'qa', frontMarkdown: '统计: FSRSTEST 中位数是什么？', backMarkdown: '排序后中间的数', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: OLD, lapses: 0, reps: 0 }) });
  await window.cardsAPI.create({ noteText: 'FSRSTEST 种子遮挡卡', cardType: 'imageOcclusion', frontMarkdown: '图中遮挡区域对应的是什么？', backMarkdown: 'FSRSTEST 区域答案', cardOrd: 0, priority: 55, tags: [], occlusionJson: { rects: [{ x: 20, y: 20, w: 30, h: 25, ord: 0 }, { x: 60, y: 55, w: 25, h: 20, ord: 1 }], assetPath: 'bookasset://nonexistent/test.png' }, fsrsJson: JSON.stringify({ state: 'review', due: OLD + 1000, lapses: 0, stability: 3, difficulty: 5, reps: 1, lastReview: OLD }) });
  return 'seeded';
})()`);
check("播种 2 张测试卡", seeded === "seeded", seeded);

const revState = parseState(await evalJS(`(async () => {
  const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === "复习");
  nav.click();
  await new Promise((r) => setTimeout(r, 1500));
  const badge = document.querySelector('.review-direction') ? document.querySelector('.review-direction').textContent : null;
  const face = document.querySelector('.review-front') ? document.querySelector('.review-front').innerText : 'NO FACE';
  const btns = [...document.querySelectorAll('.review-meta button')].map((b) => b.textContent).join(',');
  return JSON.stringify({ badge, face: face.slice(0, 26), btns });
})()`));
check("进入复习显示种子问答卡", String(revState.face).includes("中位数是什么"), JSON.stringify(revState));
check("无方向徽标（v16 D18）", revState.badge === null, JSON.stringify(revState));
check("无换一面按钮（v16 D18）", !String(revState.btns).includes("换一面"), revState.btns);

// 5) 翻面 → 答案 + 评分
console.log("== G5 翻面与评分 ==");
const back = parseState(await evalJS(`(async () => {
  document.querySelector('.review-face').click();
  await new Promise((r) => setTimeout(r, 400));
  const b = document.querySelector('.review-back') ? document.querySelector('.review-back').innerText : 'NO BACK';
  const grades = [...document.querySelectorAll('.grade-row button')].map((x) => x.textContent).join('/');
  return JSON.stringify({ back: b.slice(0, 20), grades: grades.slice(0, 40) });
})()`));
check("翻面显示答案", String(back.back).includes("排序后中间的数"), JSON.stringify(back));
check("四档评分按钮出现", String(back.grades).includes("Again") && String(back.grades).includes("Easy"), back.grades);

// 安全评分：仅当当前卡含 FSRSTEST 时先翻面再点 Good
async function gradeIfFSRSTEST() {
  return evalJS(`(async () => {
    const faceEl = document.querySelector('.review-face');
    if (!faceEl || !faceEl.innerText.includes('FSRSTEST')) return 'SKIP: current is NOT FSRSTEST';
    if (!document.querySelector('.grade-row')) faceEl.click();
    await new Promise((r) => setTimeout(r, 400));
    const g = [...document.querySelectorAll('.grade-row button')].find((b) => b.textContent.startsWith('Good'));
    if (!g) return 'NO GRADE BUTTON';
    g.click();
    await new Promise((r) => setTimeout(r, 1500));
    return 'graded';
  })()`);
}

// 6) 评分 → 遮挡卡
// v25：遮挡块由 div.occlusion-rect 改为 SVG 形状层（OcclusionShapes）——
// 正面考察区 .occlusion-exam（accent 填充）、其余区域 .occlusion-hidden（ink 填充）；答案面无任何形状
console.log("== G6 图片挖空卡复习渲染 ==");
const g1 = await gradeIfFSRSTEST();
const occl = parseState(await evalJS(`(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const shapes = document.querySelectorAll('.occlusion-shape').length;
  const exam = document.querySelectorAll('.occlusion-shape.occlusion-exam').length;
  return JSON.stringify({ shapes, exam, g1: ${JSON.stringify(g1)} });
})()`));
check("评分后进入遮挡卡", occl.g1 === "graded" && occl.shapes === 2, JSON.stringify(occl));
check("遮挡卡翻面前全遮蔽（考察区恰 1 个 accent 块）", occl.exam === 1, JSON.stringify(occl));

const occlBack = parseState(await evalJS(`(async () => {
  document.querySelector('.btn.btn-primary') && document.querySelector('.btn.btn-primary').click();
  await new Promise((r) => setTimeout(r, 400));
  const shapes = document.querySelectorAll('.occlusion-shape').length;
  const b = document.querySelector('.review-back') ? document.querySelector('.review-back').innerText : 'NO BACK';
  return JSON.stringify({ shapes, back: b.slice(0, 20) });
})()`));
check("答案面=原始图片（无遮挡块）+ 答案文本", occlBack.shapes === 0 && String(occlBack.back).includes("区域答案"), JSON.stringify(occlBack));

// 7) 清理
console.log("== 清理 FSRSTEST 数据 ==");
const cleaned = await evalJS(`(async () => {
  let n = 0;
  for (const c of await window.cardsAPI.listAll()) { if ((c.noteText || '').includes('FSRSTEST')) { await window.cardsAPI.remove(c.id); n++; } }
  for (const it of await window.libraryAPI.list()) { if ((it.title || '').includes('FSRSTEST')) { await window.libraryAPI.remove(it.id); n++; } }
  return 'removed ' + n;
})()`);
check("FSRSTEST 数据已清理（≥4）", /removed ([4-9]|\d\d)/.test(String(cleaned)), cleaned);

console.log(`\nM1 GUI 冒烟：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
