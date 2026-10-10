// v48.51/v48.52（D91 + D92）GUI 端到端：解读方式三态切换器/本地路由/事后建议 + 学习坞双页签/收起展开/全局制卡/草稿保活
// @runtime: node  @tier: 2  @gui: true  @id: D91D92  @timeout: 420
// 运行：npm run build 之后 `node tests/d91-d92.gui.mjs`（CDP 驱动 dist 真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d91d92-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 选区：粘贴书走 foliate 引擎（iframe）——spanRectInEpub 定位 + 真鼠标拖选（marks.gui 同法）；
//        夹具**无一级标题**（multiselect/marks 同规——多章 EPUB 在测试环境渲染为空，main 分支同样）。
// AI 桩：contextBridge 属性不可写（赋值静默失败、defineProperty 报 Cannot redefine——probe 实测），
//        故改在**网络边缘**打桩：测试进程起本地 mock HTTP 服务器（OpenAI 兼容 SSE），setConfig 指向它——
//        渲染层 → IPC → 主进程 chatStream → fetch 全真实代码路径，按 system 内容分流 ste/explain/occlusion。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9240";
const MOCK_PORT = 9340;
const USER_DATA = path.join(ROOT, "tests", "tmp-d91d92-userdata");
const BOOK = "FSRSTEST D91D92 验证书";
const P_MED = "中位数是把一组数据排序后位于中间位置的数。";
const P_NEG = "并非所有样本都没有缺陷，也不是每个缺陷都不可修复，但没有人能说它完全没有问题。";
const P_THM = "勾股定理是几何学的基石。";
// 夹具正文**无一级标题**（multiselect/marks 同规）——合成 EPUB 为单章，三段同屏可见；
// 带多级标题的多章 EPUB 在测试环境渲染为空白（main 分支同样，非本批引入）。
const BOOK_MD = `${P_MED}\n\n${P_NEG}\n\n${P_THM}`;
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const T0 = Date.now();
let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

// ---------- AI mock（测试进程内）：OpenAI 兼容 SSE，按 system 分流；mock.open/lastScope 供断言 ----------
const mock = { open: false, lastScope: "", answers: {}, history: [] };
const mockServer = http.createServer((req, res) => {
  if (req.method !== "POST" || !String(req.url).includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let sys = "";
    try {
      const j = JSON.parse(body);
      sys = String(j.messages?.[0]?.content || "");
    } catch { /* 视作 other */ }
    let scope = "other";
    // 注意：{{ANALYSIS_PROFILE}} 槽位在请求装配时已被 pack 内容替换——ste 模板按「简明解读」识别
    if (sys.includes("简明解读")) scope = "ste";
    else if (sys.includes("遮挡")) scope = "occlusion";
    else if (sys.includes("阅读助手")) scope = "explain";
    mock.lastScope = scope;
    mock.history.push(scope + "@" + ((Date.now() - T0) / 1000).toFixed(1) + "s:" + sys.slice(0, 14));
    const full = String(mock.answers[scope] ?? "");
    if (!full) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "GUI-TEST-MOCK 空answer" } }] }) + "\n\n");
      res.write("data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const parts = full.match(/[\s\S]{1,40}/g) || [];
    let i = 0;
    mock.open = true;
    const timer = setInterval(() => {
      if (i < parts.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      } else {
        clearInterval(timer);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        mock.open = false;
      }
    }, 300);
    res.on("close", () => { clearInterval(timer); mock.open = false; });
  });
});

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id; pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

// §J P0：制卡表单字段已统一为紧凑档 Markdown 编辑器（ProseMirror contenteditable）——
// 填写/读取改走 PM（聚焦 + selectAll + insertText；textContent 读回）
const setPM = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "no-el";
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, ${JSON.stringify(value)});
  return "inserted";
})()`;

const parseState = (s) => { try { return JSON.parse(s); } catch { return {}; } };

// ---------- 真鼠标拖选 / 点击（marks.gui 同法） ----------
function makeDrag(cdp) {
  return async (from, to) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: from.x + ((to.x - from.x) * i) / 6,
        y: from.y + ((to.y - from.y) * i) / 6,
        button: "left", buttons: 1
      });
      await wait(40);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
  };
}

/** foliate 引擎章节文档里目标文字的宿主坐标（marks.gui spanRectInEpub 同法） */
const spanRectInEpub = (mark) => `(() => {
  const k = window.__readerKernel;
  const entries = (k && k.__getContents ? k.__getContents() : []).filter((e) => e.doc && e.doc.defaultView && e.doc.defaultView.frameElement);
  for (const { doc } of entries) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf(${JSON.stringify(mark)});
      if (idx < 0) continue;
      const range = doc.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + ${mark.length});
      const rects = range.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) return "";
      const fr = doc.defaultView.frameElement.getBoundingClientRect();
      return JSON.stringify({ x1: fr.left + first.left + 2, x2: fr.left + last.right - 2, y: fr.top + first.top + first.height / 2, text: range.toString() });
    }
  }
  return "";
})()`;

/** 拖选目标段（iframe 内定位 + 真鼠标拖选）→ 选区菜单是否出现 */
async function selectParagraph(cdp, mark) {
  const geo = parseState(await cdp.eval(spanRectInEpub(mark)));
  if (typeof geo.x1 !== "number") return "TEXT NOT FOUND";
  await makeDrag(cdp)({ x: geo.x1, y: geo.y }, { x: geo.x2, y: geo.y });
  await wait(900);
  return (await cdp.eval(`!!document.querySelector('.selection-menu')`)) ? "menu" : "no-menu";
}

/** 点工具栏选区动作钮（.reader-sel-actions 是动作面，mousedown 不清选区——Reader.tsx:490） */
const clickAct = (act) => `(() => {
  const b = document.querySelector('[data-sel-act="${act}"]');
  if (!b) return 'NO BTN';
  if (b.disabled) return 'DISABLED';
  b.click();
  return 'clicked';
})()`;

/** 等待 AI 答案流式完成（mock.open 标记在途——.ai-streaming 在首个增量后即消失） */
async function waitAnswerDone(timeoutMs = 30000) {
  const t0 = Date.now();
  let seenOpen = false;
  while (Date.now() - t0 < timeoutMs) {
    if (mock.open) seenOpen = true;
    if (seenOpen && !mock.open) return "done";
    await wait(250);
  }
  return "timeout";
}

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  await new Promise((r) => mockServer.listen(MOCK_PORT, "127.0.0.1", r));

  const out = openSync(path.join(ROOT, "tests", "d91d92.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ---------- G0 建书 + 打开阅读器 + AI 配置指向本地 mock ----------
  console.log("== G0 建书 + 打开阅读器 + AI mock ==");
  await cdp.eval(`(async () => JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(BOOK)}, ${JSON.stringify(BOOK_MD)})))()`);
  // scrolled 模式（marks.gui 同法：分页模式下 foliate 在测试环境渲染为空，滚动模式正文落在章节文档）
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  await cdp.eval("window.location.reload()");
  await wait(3000);
  const opened = await cdp.eval(`(() => {
    const t = [...document.querySelectorAll(".book-card")].find((x) => (x.getAttribute("title") || "").includes("D91D92") || (x.textContent || "").includes("D91D92"));
    if (!t) return "BOOK NOT FOUND";
    t.click();
    return "clicked";
  })()`);
  check("测试书打开（book-card 点击）", opened === "clicked", opened);
  await wait(3000);
  const kernelOk = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    return !!(k && k.__getContents && k.__getContents().some((e) => e.doc && e.doc.defaultView));
  })()`);
  check("阅读内核就绪（foliate iframe 在场）", kernelOk === true, kernelOk);

  // AI 配置：custom 预设指向本地 mock（真实 IPC→主进程→fetch 链路；零外部网络）
  const cfgState = parseState(await cdp.eval(`(async () => JSON.stringify(await window.aiAPI.setConfig({ preset: "custom", baseUrl: "http://127.0.0.1:${MOCK_PORT}/v1", model: "mock-model", apiKey: "GUI-TEST-KEY" })))()`));
  check("AI 配置指向本地 mock 服务器", cfgState.baseUrl === `http://127.0.0.1:${MOCK_PORT}/v1` && cfgState.hasKey === true, JSON.stringify(cfgState));
  // G2 预置短答案（走真实分片流；G3/G4 会覆写为各自的金样例）
  mock.answers.explain = "通用解读的短直答：机制说明从略。";
  mock.answers.ste = "<!--ste:matLang=unknown-->\n<!--ste:points=3-->\n\n## 歧义点\n\n- long-nesting · 长句嵌套 ·「样本」→ 示例歧义点。\n\n## 简明改写\n\n改写后的句子。";

  // ---------- G1 D92：全局制卡（免选区）+ 草稿保活 + 空态常驻 ----------
  console.log("== G1 D92 全局制卡 + 草稿保活 + 空态 ==");
  check("学习坞未挂载（首次唤起前）", (await cdp.eval(`!!document.querySelector('[data-card-dock]')`)) === false, "不应在场");
  check("无选区点工具栏「制卡」可点（去 disabled）", String(await cdp.eval(clickAct("manual"))) === "clicked", "clicked");
  await wait(500);
  const g1a = parseState(await cdp.eval(`JSON.stringify({
    dock: !!document.querySelector('[data-card-dock]'),
    manualForm: !!document.querySelector('[data-card-dock] [data-testid="wb-manual"] .ProseMirror'),
    tabs: !!document.querySelector('[data-testid="dock-tabs"]'),
    // D123：推让改由 html[data-wb-open] 驱动（reader-body-shifted 退役）
    shifted: document.documentElement.dataset.wbOpen === '1'
  })`));
  check("制卡台挂载 + 手动区常驻（空表单可自由制卡）", g1a.dock && g1a.manualForm, JSON.stringify(g1a));
  check("AI 页签条在位（role=tablist）", g1a.tabs, g1a.tabs);
  check("展开时正文让位（html[data-wb-open]）", g1a.shifted === true, g1a.shifted);
  await cdp.eval(setPM('[data-card-dock] [data-testid="wb-manual"] .ProseMirror', 'FSRSTEST 草稿句子'));
  await wait(400); // 等 React 状态回流（PM onChange → 表单状态）
  // 草稿保活：手动区常驻（D123），切 AI 页签不影响表单，草稿仍在（§7.7）
  await cdp.eval(`document.querySelector('[data-testid="dock-tab-explain"]').click()`);
  await wait(300);
  const g1b = parseState(await cdp.eval(`JSON.stringify({
    manualVisible: !document.querySelector('[data-card-dock] [data-testid="wb-manual-body"], [data-card-dock] .wb-manual-body')?.hidden,
    manualMounted: !!document.querySelector('[data-card-dock] [data-testid="wb-manual"] .ProseMirror'),
    emptyExplain: !!document.querySelector('[data-dock-empty="explain"]')
  })`));
  check("切页签：手动区常驻不受影响 + 解释页签空态在场", g1b.manualVisible && g1b.manualMounted && g1b.emptyExplain, JSON.stringify(g1b));
  const draftBack = await cdp.eval(`document.querySelector('[data-card-dock] [data-testid="wb-manual"] .ProseMirror')?.textContent || ''`);
  check("切页签后手动表单草稿仍在", draftBack === "FSRSTEST 草稿句子", draftBack);
  // D123：Esc（焦点在制卡台内）= 收起整个制卡台，状态保留；再点顶栏「制卡台」展开
  await cdp.eval(`(() => { const d = document.querySelector('[data-card-dock]'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'esc'; })()`);
  await wait(400);
  const g1c0 = parseState(await cdp.eval(`JSON.stringify({ collapsed: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed') === '1' })`));
  check("Esc 收起制卡台（不卸载）", g1c0.collapsed === true, JSON.stringify(g1c0));
  await cdp.eval(`document.querySelector('[data-testid="workbench-entry"]').click()`);
  await wait(400);
  const g1c = parseState(await cdp.eval(`JSON.stringify({
    dock: !!document.querySelector('[data-card-dock]'),
    emptyExplain: !!document.querySelector('[data-dock-empty="explain"]'),
    emptyCards: !!document.querySelector('[data-dock-empty="cards"]'),
    switcherInEmpty: !!document.querySelector('[data-dock-empty="explain"] [data-testid="explain-mode"]'),
    pressed: document.querySelector('[data-testid="workbench-entry"]')?.getAttribute('aria-pressed')
  })`));
  check("顶栏按钮再展开：制卡台常驻 + 两页签空态在场（页签恒可点）", g1c.dock && g1c.emptyExplain && g1c.emptyCards, JSON.stringify(g1c));
  check("空态解释页签内含解读方式切换器（方式可先调）", g1c.switcherInEmpty === true, g1c.switcherInEmpty);
  check("顶栏「制卡台」按钮 aria-pressed=true", g1c.pressed === "true", g1c.pressed);
  // 空态页签切换（§7.2 两页签可点）
  await cdp.eval(`document.querySelector('[data-testid="dock-tab-cards"]').click()`);
  await wait(250);
  const cardsTabOn = await cdp.eval(`document.querySelector('[data-testid="dock-tab-cards"]')?.getAttribute('aria-selected')`);
  check("空态下切到制卡页签（aria-selected 生效）", cardsTabOn === "true", cardsTabOn);
  await cdp.eval(`document.querySelector('[data-testid="dock-tab-explain"]').click()`);
  await wait(250);

  // ---------- G2 D91：三态默认 + 显式选择 + 切换即重跑 ----------
  console.log("== G2 D91 解读方式切换器 ==");
  let selState = "";
  selState = await selectParagraph(cdp, P_MED);
  check("拖选中位数段（选区菜单出现）", selState === "menu", selState);
  check("点工具栏「AI 解释」发起请求", String(await cdp.eval(clickAct("explain"))) === "clicked", "clicked");
  await wait(700);
  const g2a = parseState(await cdp.eval(`JSON.stringify({
    mode: document.querySelector('[data-card-dock] [data-testid="explain-mode"]')?.getAttribute('data-value'),
    tab: document.querySelector('[data-testid="dock-tab-explain"]')?.getAttribute('aria-selected')
  })`));
  check("三态默认 auto（§8.11）+ 解释页签自动激活", g2a.mode === "auto" && g2a.tab === "true", JSON.stringify(g2a));
  check("auto 路由：短定义句落通用解读（reader-explain scope）", mock.lastScope === "explain", mock.lastScope);
  // 切简明 → 即重跑（ste scope）
  await cdp.eval(`document.querySelector('[data-card-dock] [data-testid="explain-mode"] .dd-btn')?.click()`);
  await wait(250);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('[data-card-dock] [data-testid="explain-mode"] .dd-item')].find((x) => x.textContent === '简明解读'); if (b) b.click(); return !!b; })()`);
  await wait(700);
  const g2b = parseState(await cdp.eval(`JSON.stringify({ mode: document.querySelector('[data-card-dock] [data-testid="explain-mode"]')?.getAttribute('data-value') })`));
  check("显式选简明解读：切换即重跑（reader-explain-ste scope）", g2b.mode === "ste" && mock.lastScope === "ste", JSON.stringify(g2b) + " scope=" + mock.lastScope);
  // 切回自动 → 重跑回通用（中位数句路由 general）
  await cdp.eval(`document.querySelector('[data-card-dock] [data-testid="explain-mode"] .dd-btn')?.click()`);
  await wait(250);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('[data-card-dock] [data-testid="explain-mode"] .dd-item')].find((x) => x.textContent === '自动'); if (b) b.click(); return !!b; })()`);
  await wait(700);
  const g2c = parseState(await cdp.eval(`JSON.stringify({ mode: document.querySelector('[data-card-dock] [data-testid="explain-mode"]')?.getAttribute('data-value') })`));
  check("切回自动：恢复路由（仍 reader-explain）", g2c.mode === "auto" && mock.lastScope === "explain", JSON.stringify(g2c) + " scope=" + mock.lastScope);

  // ---------- G3 D91：事后建议（ste marker 驱动，§8.10） ----------
  console.log("== G3 D91 事后建议 ==");
  mock.answers.ste = "<!--ste:matLang=unknown-->\n<!--ste:points=3-->\n<!--ste:readings=2-->\n\n## 歧义点\n\n- negation-stack · 否定叠加 ·「并非所有样本都没有缺陷」→ 多重否定叠加，读者需逐层翻转才能确定断言方向。\n\n## 简明改写\n\n一些样本有缺陷，但其中不少可以修复。\n\n## 多重解读\n\n（略）";
  selState = await selectParagraph(cdp, P_NEG);
  check("拖选否定段（选区菜单出现）", selState === "menu", selState);
  await cdp.eval(clickAct("explain"));
  await waitAnswerDone();
  const g3aState = parseState(await cdp.eval(`JSON.stringify({ ans: (document.querySelector('.ai-answer')?.textContent || ''), suggest: !!document.querySelector('[data-testid="explain-suggest"]') })`));
  check("否定叠加句 auto 路由进 ste（reader-explain-ste）", mock.lastScope === "ste", mock.lastScope);
  check("ste 结果含歧义点节（完整流程）", String(g3aState.ans).includes("歧义点") || String(g3aState.ans).includes("否定叠加"), "含歧义点", String(g3aState.ans).slice(0, 80));
  check("points=3：无事后建议行", g3aState.suggest === false, g3aState.suggest);
  // points=0 + 改写≈原文 → 建议行出现
  mock.answers.ste = "<!--ste:matLang=unknown-->\n<!--ste:points=0-->\n\n## 简明改写\n\n" + P_NEG + "\n\n（改写与原文一致，文本本身足够清晰。）";
  selState = await selectParagraph(cdp, P_NEG);
  check("拖选否定段（重选）", selState === "menu", selState);
  await cdp.eval(clickAct("explain"));
  await waitAnswerDone();
  const g3b = parseState(await cdp.eval(`JSON.stringify({ scope: "ste", suggest: !!document.querySelector('[data-testid="explain-suggest"]'), text: document.querySelector('[data-testid="explain-suggest"]')?.textContent || '' })`));
  check("ste 完成后 points=0 且改写≈原文 → 事后建议行出现", mock.lastScope === "ste" && g3b.suggest === true, JSON.stringify(g3b) + " scope=" + mock.lastScope);
  check("建议行文案在场", String(g3b.text).includes("通用解读"), g3b.text);
  // 点击建议 → 按通用解读重发（reader-explain scope）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="explain-suggest"] button')].find((x) => x.textContent.includes('通用解读')); if (b) b.click(); return !!b; })()`);
  await waitAnswerDone();
  const g3c = parseState(await cdp.eval(`JSON.stringify({ mode: document.querySelector('[data-card-dock] [data-testid="explain-mode"]')?.getAttribute('data-value'), suggest: !!document.querySelector('[data-testid="explain-suggest"]') })`));
  check("点建议 → 通用解读重发（reader-explain scope 请求产生）", mock.lastScope === "explain", "scope=" + mock.lastScope);
  check("建议行消失 + 切换器显式 general", g3c.suggest === false && g3c.mode === "general", JSON.stringify(g3c));

  // ---------- G4 收起 ≠ 关闭（流式状态保留）+ 让位联动（§7.3/§7.8） ----------
  console.log("== G4 收起/展开 + 状态保留 ==");
  mock.answers.explain = "这是通用解读的直答：样本缺陷是分布性的。机制说明如下，部分样本在出厂检测中可能带有轻微缺陷，这些缺陷多数可以修复。" + "补充说明：检测流程依序执行，修复后重新入库，统计口径保持一致，便于后续追查原因。".repeat(6);
  selState = await selectParagraph(cdp, P_MED);
  check("拖选中位数段（重选）", selState === "menu", selState);
  await cdp.eval(clickAct("explain"));
  await wait(1800); // 流式中（分片 300ms × ~30 段 ≈ 9s，此处 1.8s 时必然在途）
  const before = parseState(await cdp.eval(`JSON.stringify({ len: (document.querySelector('.ai-answer')?.textContent || '').length })`));
  check("流式进行中（收起前提）", mock.open === true && before.len > 0, `open=${mock.open} len=${before.len}`);
  await cdp.eval(`document.querySelector('[data-testid="workbench-entry"]').click()`);
  await wait(600);
  const g4a = parseState(await cdp.eval(`JSON.stringify({
    collapsed: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed') === '1',
    shifted: document.documentElement.dataset.wbOpen === '1',
    len: (document.querySelector('.ai-answer')?.textContent || '').length
  })`));
  check("收起：坞体出视口 + 正文让位取消（无把手）", g4a.collapsed && g4a.shifted === false, JSON.stringify(g4a));
  await wait(2000); // 收起期间流式继续（§7.3 核心承诺）
  await cdp.eval(`document.querySelector('[data-testid="workbench-entry"]').click()`);
  await wait(600);
  const g4b = parseState(await cdp.eval(`JSON.stringify({
    shifted: document.documentElement.dataset.wbOpen === '1',
    len: (document.querySelector('.ai-answer')?.textContent || '').length
  })`));
  check("展开：让位恢复", g4b.shifted === true, JSON.stringify(g4b));
  check("收起不丢状态：答案增量在继续（无重启）", g4b.len > before.len, `before=${before.len} after=${g4b.len}`);
  await waitAnswerDone();

  // ---------- G5 内容派生（§7.5） ----------
  console.log("== G5 活动页签内容派生 ==");
  await cdp.eval(`document.querySelector('[data-testid="dock-tab-cards"]').click()`);
  await wait(300);
  const g5a = await cdp.eval(`document.querySelector('[data-testid="dock-tab-cards"]')?.getAttribute('aria-selected')`);
  check("显式切到制卡页签（无新内容不回跳）", g5a === "true", g5a);
  selState = await selectParagraph(cdp, P_MED);
  check("拖选中位数段（重选）", selState === "menu", selState);
  await cdp.eval(clickAct("explain"));
  await wait(700);
  const g5b = parseState(await cdp.eval(`JSON.stringify({ explain: document.querySelector('[data-testid="dock-tab-explain"]')?.getAttribute('aria-selected'), cards: document.querySelector('[data-testid="dock-tab-cards"]')?.getAttribute('aria-selected') })`));
  check("新解释内容到达 → 自动切到解释页签", g5b.explain === "true" && g5b.cards === "false", JSON.stringify(g5b));
  await waitAnswerDone();
  selState = await selectParagraph(cdp, P_MED);
  check("拖选中位数段（重选）", selState === "menu", selState);
  await cdp.eval(clickAct("aiCards"));
  await wait(700);
  const g5c = parseState(await cdp.eval(`JSON.stringify({ cards: document.querySelector('[data-testid="dock-tab-cards"]')?.getAttribute('aria-selected') })`));
  check("点「AI 制卡」→ 自动切到制卡页签（mock 空answer 不影响派生）", g5c.cards === "true", JSON.stringify(g5c));

  // ---------- G6 occlusion 归属制卡页签（§7.9） ----------
  // assetsAPI 为 contextBridge 只读暴露（赋值静默失败）——原生选图对话框无法在 CDP 驱动；
  // 探测属性可写性，不可写则跳过（occlusion modal 路径由既有 m6 套件覆盖，坞内页签映射为 3 行条件渲染）。
  const assetsWritable = parseState(await cdp.eval(`JSON.stringify((function () {
    const d = Object.getOwnPropertyDescriptor(window.assetsAPI || {}, 'pickOcclusionImage');
    return { writable: !!d && (d.writable === true || !!d.set), has: !!window.assetsAPI };
  })())`));
  if (assetsWritable.writable) {
    console.log("== G6 AI 图片挖空归属 ==");
    await cdp.eval(`window.assetsAPI.pickOcclusionImage = async () => ({ itemId: 'stub', filename: 'stub.png', assetPath: 'stub://d91d92.png', dataUrl: ${JSON.stringify(TINY_PNG)} })`);
    mock.answers.occlusion = JSON.stringify({ cards: [{ cardType: "imageOcclusion", front: "图中遮挡区域对应的是什么？", back: "中位数示意图", ord: 0 }], regions: [{ ord: 0, label: "中位数", x: 10, y: 10, w: 40, h: 30 }] });
    selState = await selectParagraph(cdp, P_MED);
    check("拖选中位数段（重选）", selState === "menu", selState);
    await cdp.eval(clickAct("occlusion"));
    await wait(2500);
    const g6 = parseState(await cdp.eval(`JSON.stringify({
      cards: document.querySelector('[data-testid="dock-tab-cards"]')?.getAttribute('aria-selected'),
      badge: document.querySelector('[data-card-dock] .dock-badge')?.textContent || '',
      drafts: [...document.querySelectorAll('[data-card-dock] .ai-draft')].length
    })`));
    check("occlusion 面板落制卡页签 + 「图片挖空」徽章在场", g6.cards === "true" && String(g6.badge).includes("图片挖空"), JSON.stringify(g6));
    check("occlusion 草稿渲染（图片卡链路完整）", g6.drafts > 0, g6.drafts);
  } else {
    console.log("  - 跳过 G6（assetsAPI 为 contextBridge 只读暴露，原生选图对话框无法驱动；页签映射逻辑为 SelectionPanels 内 3 行条件渲染）");
  }

  console.log("MOCK HISTORY:", mock.history.join(" | ") || "(none)");
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILED"}: ${pass} passed, ${fail} failed`);
} catch (err) {
  fail++;
  console.log("  ✗ 测试执行异常: " + (err && err.stack || err));
  console.log("MOCK HISTORY:", mock.history.join(" | ") || "(none)");
} finally {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  try { mockServer.close(); } catch { /* 已关闭 */ }
  process.exitCode = fail === 0 ? 0 : 1;
}
