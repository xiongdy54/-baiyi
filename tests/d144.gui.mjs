// v48.100（D144 #9）制卡台 IA 重设计行为冒烟：唤坞默认 IA / 双页签草稿保活 / 跨页签幽灵双向 /
// 解释板块发送自动展开（AI 未配置降级链）/ 解释内容区选区三按钮选单 + 把手与坞收展状态保留。
// @runtime: node  @tier: 2  @gui: true  @id: D144  @timeout: 300
// 运行：npm run build 之后 `node tests/d144.gui.mjs`（CDP 驱动 dist 真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d144-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 无需建书：书架页即挂自由制卡台宿主（FreeWorkbenchHost），坞入口＝顶栏「制卡台」按钮（workbench-entry）。
// 零网络：AI 未配置路径为确定性降级——发送后 catch 落「AI 服务尚未配置」错误面板（.ai-error），
// 该错误文本同时充当场景 5 选区三钮的选区素材（解释板块内容区内可选中文字）。
// 两窗口同步替代口径（交接包许可）：独立制卡台窗口（workbench.tsx）与主窗口共用同一
// SelectionPanels/CardDock 组件树——本套件在主窗口以 DOM testid 同构断言覆盖共享组件行为，
// 不另开第二窗口 CDP；窗口专属表现（引用后聚焦/光标落文末的窗口实例）不在本套件范围。
// 纪律：选择器全部取自方案 §10 DOM 契约（data-testid / aria / data-* 属性），禁断言类名与内联样式；
// 动效只断言终态（D120——不探测过渡中间帧）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9250";
const USER_DATA = path.join(ROOT, "tests", "tmp-d144-userdata");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

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

const parseState = (s) => { try { return JSON.parse(s); } catch { return {}; } };
// MarkdownEditor onChange 序列化值带尾随换行（PM textContent 无）——镜像/幽灵文本断言统一去尾随空白比对
const trimEnd = (s) => String(s ?? "").replace(/\s+$/, "");

// 手动首框＝紧凑档 Markdown 编辑器（ProseMirror contenteditable）：聚焦 + selectAll + insertText（d91-d92 同法）
const setPM = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "no-el";
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, ${JSON.stringify(value)});
  return "inserted";
})()`;
const clearPM = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "no-el";
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  return "cleared";
})()`;

// 受控 textarea（React 受控值——自由材料框 / composer 输入条）：原生 value setter + input 事件
const setTA = (sel, v) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "no-el";
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "set";
})()`;

// 解释板块内容区程序化选区（Range 覆盖错误/答案文本 + mouseup 派发）——三钮选单触发（§4.4 mouseup 后出现）
const selectInExplain = () => `(() => {
  const body = document.querySelector('[data-testid="wb-explain-body"]');
  if (!body) return "no-body";
  const el = body.querySelector(".ai-error") || body.querySelector(".ai-answer");
  if (!el) return "no-text-el";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if ((t.textContent || "").trim().length > 3) { node = t; break; }
  }
  if (!node) return "no-text-node";
  const r = document.createRange();
  r.setStart(node, 0);
  r.setEnd(node, Math.min(node.textContent.length, 24));
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  return "selected:" + r.toString().slice(0, 16);
})()`;

async function waitTrue(cdp, expr, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await cdp.eval(expr)) === true) return true;
    await wait(250);
  }
  return false;
}

const FRONT_PM = '[data-card-dock] [data-testid="wb-manual-body"] .ProseMirror';

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  const out = openSync(path.join(ROOT, "tests", "d144.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ---------- S1 唤坞与默认 IA（§2.1 / §4.1 默认态：手动制卡页签 + 解释板块收起） ----------
  console.log("== S1 唤坞与默认 IA ==");
  check("唤坞前坞未挂载（dockEverOpened 门控）", (await cdp.eval(`!!document.querySelector('[data-card-dock]')`)) === false, "不应在场");
  await cdp.eval(`document.querySelector('[data-testid="workbench-entry"]').click()`);
  await wait(800);
  const s1 = parseState(await cdp.eval(`JSON.stringify({
    dock: !!document.querySelector('[data-card-dock]'),
    collapsed: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed'),
    wbOpen: document.documentElement.dataset.wbOpen === '1',
    tabManual: document.querySelector('[data-testid="wb-tab-manual"]')?.getAttribute('aria-selected'),
    tabAi: document.querySelector('[data-testid="wb-tab-aicards"]')?.getAttribute('aria-selected'),
    tablist: !!document.querySelector('[data-testid="wb-cards-tabs"][role="tablist"]'),
    bodyManual: !!document.querySelector('[data-testid="wb-manual-body"] .ProseMirror'),
    aiBodyHidden: (document.querySelector('[data-wb-tabbody="aicards"]')?.style.display || '') === 'none',
    types: document.querySelectorAll('[data-testid="manual-types"] [role="tab"]').length,
    emptyCards: !!document.querySelector('[data-dock-empty="cards"]'),
    freeMounted: !!document.querySelector('[data-testid="wb-free-source"] textarea'),
    explain: !!document.querySelector('[data-testid="wb-explain"]'),
    explainBody: !!document.querySelector('[data-testid="wb-explain-body"]'),
    handleAbsent: !document.querySelector('[data-testid="wb-explain-toggle"]'),
    modeBtns: document.querySelectorAll('[data-testid="wb-mode-bar"] [data-mode]').length,
    composer: !!document.querySelector('[data-testid="wb-composer"] textarea')
  })`));
  check("唤坞：制卡台挂载且展开（无收起标记）+ 正文让位", s1.dock && s1.collapsed === null && s1.wbOpen, JSON.stringify(s1));
  check("默认手动制卡页签（显式点击 > 内容派生）", s1.tabManual === "true" && s1.tabAi === "false", JSON.stringify({ m: s1.tabManual, a: s1.tabAi }));
  check("页签条 role=tablist + 手动表单挂点常驻", s1.tablist && s1.bodyManual, JSON.stringify(s1));
  check("AI 制卡页签体保活（display:none 挂载）+ 自由材料框 + 制卡空态", s1.aiBodyHidden && s1.freeMounted && s1.emptyCards, JSON.stringify(s1));
  check("题型页签 4 枚（问答/翻转/填空/图片挖空）", s1.types === 4, s1.types);
  check("解释板块恒在坞底：内容槽 + 按钮行 4 钮 + 输入条；无内容默认收起把手不在场", s1.explain && s1.explainBody && s1.modeBtns === 4 && s1.composer && s1.handleAbsent, JSON.stringify(s1));

  // ---------- S2 双向草稿与页签保活（§4.1 内容无损：两页签体常驻挂载） ----------
  console.log("== S2 双向草稿与页签保活 ==");
  await cdp.eval(setPM(FRONT_PM, "D144 草稿基线"));
  await wait(400);
  const front0 = await cdp.eval(`document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || ''`);
  check("手动首框可输入（ProseMirror insertText）", front0 === "D144 草稿基线", front0);
  await cdp.eval(`document.querySelector('[data-testid="wb-tab-aicards"]').click()`);
  await wait(300);
  const s2a = parseState(await cdp.eval(`JSON.stringify({
    tabAi: document.querySelector('[data-testid="wb-tab-aicards"]')?.getAttribute('aria-selected'),
    pmMounted: !!document.querySelector(${JSON.stringify(FRONT_PM)}),
    manualHidden: (document.querySelector('[data-wb-tabbody="manual"]')?.style.display || '') === 'none'
  })`));
  check("切 AI 制卡页签：手动表单体保活（display:none 不卸载）", s2a.tabAi === "true" && s2a.pmMounted && s2a.manualHidden, JSON.stringify(s2a));
  const freeSet = await cdp.eval(setTA('[data-testid="wb-free-source"] textarea', "D144 自由材料"));
  const freeVal = await cdp.eval(`document.querySelector('[data-testid="wb-free-source"] textarea')?.value || ''`);
  check("自由材料框受控输入（原生 setter + input 事件）", freeSet === "set" && freeVal === "D144 自由材料", freeVal);
  await cdp.eval(`document.querySelector('[data-testid="wb-tab-manual"]').click()`);
  await wait(300);
  const frontBack = await cdp.eval(`document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || ''`);
  check("切回手动：草稿无损", frontBack === "D144 草稿基线", frontBack);
  await cdp.eval(`document.querySelector('[data-testid="wb-tab-aicards"]').click()`);
  await wait(300);
  const freeBack = await cdp.eval(`document.querySelector('[data-testid="wb-free-source"] textarea')?.value || ''`);
  check("AI 侧自由材料跨页签保留", freeBack === "D144 自由材料", freeBack);

  // ---------- S3 跨页签幽灵双向（§4.2：Alt+Enter / 点击接受；无损红线＝接受只写目标框） ----------
  console.log("== S3 跨页签幽灵双向 ==");
  await cdp.eval(setTA('[data-testid="wb-free-source"] textarea', ""));
  await wait(300);
  const ghostA = parseState(await cdp.eval(`JSON.stringify({
    ghost: !!document.querySelector('[data-testid="wb-free-source"] .wb-ghost'),
    text: document.querySelector('[data-testid="wb-free-source"] .wb-ghost-text')?.textContent || ''
  })`));
  check("手动侧有字 + AI 侧空 → 自由材料框出现幽灵（源＝手动首框全文）", ghostA.ghost && trimEnd(ghostA.text) === "D144 草稿基线", JSON.stringify(ghostA));
  await cdp.eval(`(() => {
    const ta = document.querySelector('[data-testid="wb-free-source"] textarea');
    if (!ta) return "no-el";
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    return "sent";
  })()`);
  await wait(400);
  const s3b = parseState(await cdp.eval(`JSON.stringify({
    free: document.querySelector('[data-testid="wb-free-source"] textarea')?.value || '',
    ghostGone: !document.querySelector('[data-testid="wb-free-source"] .wb-ghost')
  })`));
  check("Alt+Enter 接受：全文写入自由材料框且幽灵消失", trimEnd(s3b.free) === "D144 草稿基线" && s3b.ghostGone, JSON.stringify(s3b));
  const frontKept = await cdp.eval(`document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || ''`);
  check("无损红线：源框（手动首框）不被回写改动", frontKept === "D144 草稿基线", frontKept);
  await cdp.eval(`document.querySelector('[data-testid="wb-tab-manual"]').click()`);
  await wait(300);
  await cdp.eval(clearPM(FRONT_PM));
  await wait(400);
  const ghostB = parseState(await cdp.eval(`JSON.stringify({
    ghost: !!document.querySelector('[data-testid="wb-manual-body"] .wb-field .wb-ghost'),
    text: document.querySelector('[data-testid="wb-manual-body"] .wb-field .wb-ghost-text')?.textContent || ''
  })`));
  check("AI 侧有字 + 手动首框空 → 手动首框出现幽灵（反向同步）", ghostB.ghost && trimEnd(ghostB.text) === "D144 草稿基线", JSON.stringify(ghostB));
  await cdp.eval(`document.querySelector('[data-testid="wb-manual-body"] .wb-field .wb-ghost')?.click()`);
  await wait(400);
  const s3d = parseState(await cdp.eval(`JSON.stringify({
    front: document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || '',
    ghostGone: !document.querySelector('[data-testid="wb-manual-body"] .wb-field .wb-ghost'),
    free: document.querySelector('[data-testid="wb-free-source"] textarea')?.value || ''
  })`));
  check("点击幽灵接受：全文写入手动首框且幽灵消失", s3d.front === "D144 草稿基线" && s3d.ghostGone, JSON.stringify(s3d));
  check("无损红线：源框（自由材料）不被清写", trimEnd(s3d.free) === "D144 草稿基线", s3d.free);

  // ---------- S4 解释板块发送与自动展开（§4.3：按钮行双职 + composer 受控；AI 未配置降级链） ----------
  console.log("== S4 解释板块发送与自动展开 ==");
  const compSet = await cdp.eval(setTA('[data-testid="wb-composer"] textarea', "D144 解释请求"));
  const compVal = await cdp.eval(`document.querySelector('[data-testid="wb-composer"] textarea')?.value || ''`);
  check("composer 输入条受控输入", compSet === "set" && compVal === "D144 解释请求", compVal);
  await cdp.eval(`document.querySelector('[data-testid="wb-mode-bar"] [data-mode="ste"]').click()`);
  const errIn = await waitTrue(cdp, `!!document.querySelector('[data-testid="wb-explain-body"] .ai-error')`, 15000);
  const errText = await cdp.eval(`document.querySelector('[data-testid="wb-explain-body"] .ai-error')?.textContent || ''`);
  check("按所选方式发送：AI 未配置确定性降级（错误面板落解释内容区，零网络）", errIn && String(errText).includes("尚未配置"), errText);
  const s4 = parseState(await cdp.eval(`JSON.stringify({
    open: document.querySelector('[data-testid="wb-explain-toggle"]')?.getAttribute('aria-expanded'),
    stePressed: document.querySelector('[data-testid="wb-mode-bar"] [data-mode="ste"]')?.getAttribute('aria-pressed'),
    composerCleared: (document.querySelector('[data-testid="wb-composer"] textarea')?.value || '') === ''
  })`));
  check("composer 发送 → 解释板块自动展开（§4.3 发送路由）", s4.open === "true", JSON.stringify(s4));
  check("方式按钮行迁移当前方式（aria-pressed）+ 发送后输入条清空", s4.stePressed === "true" && s4.composerCleared, JSON.stringify(s4));

  // ---------- S5 解释内容区选区三按钮选单（§4.4）+ 把手/坞收展状态保留 ----------
  console.log("== S5 选区三按钮选单 + 收展状态保留 ==");
  const sel1 = await cdp.eval(selectInExplain());
  check("解释内容区程序化选区成功（触发素材＝降级错误文本）", String(sel1).startsWith("selected:"), sel1);
  await wait(200);
  const s5a = parseState(await cdp.eval(`JSON.stringify({
    trio: !!document.querySelector('.dock-trio'),
    acts: ["aiCards", "copy", "quote"].filter((a) => !!document.querySelector('[data-trio-act="' + a + '"]')).length,
    place: document.querySelector('.dock-trio')?.getAttribute('data-place') || ''
  })`));
  check("选区上方出现三按钮选单且含 AI 制卡/复制/引用 三钮（§4.4）", s5a.trio && s5a.acts === 3, JSON.stringify(s5a));
  check("选单定位锚合法（prefer above / 放不下翻 below）", s5a.place === "above" || s5a.place === "below", s5a.place);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await wait(250);
  const s5b = parseState(await cdp.eval(`JSON.stringify({
    trioGone: !document.querySelector('.dock-trio'),
    dockStillOpen: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed') === null
  })`));
  check("Esc 关闭选单＝单层语义：坞不被连锁收起", s5b.trioGone && s5b.dockStillOpen, JSON.stringify(s5b));
  await cdp.eval(selectInExplain());
  await wait(200);
  const trioBack = await cdp.eval(`!!document.querySelector('.dock-trio')`);
  check("选单可重复触发", trioBack === true, trioBack);
  await cdp.eval(`document.querySelector('[data-trio-act="quote"]').click()`);
  await wait(300);
  const s5d = parseState(await cdp.eval(`JSON.stringify({
    trioGone: !document.querySelector('.dock-trio'),
    composer: (document.querySelector('[data-testid="wb-composer"] textarea')?.value || '').slice(0, 40),
    open: document.querySelector('[data-testid="wb-explain-toggle"]')?.getAttribute('aria-expanded')
  })`));
  check("引用：输入条头部插入「> 引用块」且既有草稿保留其后", s5d.trioGone && s5d.composer.startsWith("> ") && s5d.composer.includes("尚未配置"), JSON.stringify(s5d));
  check("引用不自动开合解释板块（§4.4-c 板块保持原态）", s5d.open === "true", s5d.open);
  await cdp.eval(selectInExplain());
  await wait(200);
  await cdp.eval(`document.querySelector('[data-trio-act="copy"]').click()`);
  await wait(300);
  const s5e = parseState(await cdp.eval(`JSON.stringify({
    trioGone: !document.querySelector('.dock-trio'),
    tabManual: document.querySelector('[data-testid="wb-tab-manual"]')?.getAttribute('aria-selected'),
    front: document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || ''
  })`));
  check("复制：追加写入手动首框（既有输入保留 + 永不覆盖）", s5e.trioGone && s5e.front.includes("D144 草稿基线") && s5e.front.includes("尚未配置"), JSON.stringify(s5e));
  check("复制落点＝坞展开 + 切「手动制卡」页签", s5e.tabManual === "true", s5e.tabManual);
  await cdp.eval(`document.querySelector('[data-testid="wb-explain-toggle"]').click()`);
  await wait(400);
  const s5f = parseState(await cdp.eval(`JSON.stringify({
    open: document.querySelector('[data-testid="wb-explain-toggle"]')?.getAttribute('aria-expanded'),
    composerKept: (document.querySelector('[data-testid="wb-composer"] textarea')?.value || '').startsWith('> '),
    bodyKept: !!document.querySelector('[data-testid="wb-explain-body"] .ai-error')
  })`));
  check("把手收起：composer 引用草稿与内容区保留（状态不丢）", s5f.open === "false" && s5f.composerKept && s5f.bodyKept, JSON.stringify(s5f));
  await cdp.eval(`document.querySelector('[data-testid="wb-explain-toggle"]').click()`);
  await wait(400);
  const s5g = parseState(await cdp.eval(`JSON.stringify({
    open: document.querySelector('[data-testid="wb-explain-toggle"]')?.getAttribute('aria-expanded'),
    bodyKept: !!document.querySelector('[data-testid="wb-explain-body"] .ai-error')
  })`));
  check("把手再展开：内容保留", s5g.open === "true" && s5g.bodyKept, JSON.stringify(s5g));
  await cdp.eval(`(() => { const d = document.querySelector('[data-card-dock]'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'esc'; })()`);
  await wait(400);
  const s5h = parseState(await cdp.eval(`JSON.stringify({
    collapsed: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed') === '1',
    frontKept: (document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || '').includes('D144 草稿基线')
  })`));
  check("坞 Esc 收起（不卸载）：表单草稿保留", s5h.collapsed && s5h.frontKept, JSON.stringify(s5h));
  await cdp.eval(`document.querySelector('[data-testid="workbench-entry"]').click()`);
  await wait(500);
  const s5i = parseState(await cdp.eval(`JSON.stringify({
    open: document.querySelector('[data-card-dock]')?.getAttribute('data-dock-collapsed') === null,
    tabManual: document.querySelector('[data-testid="wb-tab-manual"]')?.getAttribute('aria-selected'),
    frontKept: (document.querySelector(${JSON.stringify(FRONT_PM)})?.textContent || '').includes('D144 草稿基线')
  })`));
  check("再展开：回默认手动页签且草稿无损（收起 ≠ 关闭）", s5i.open && s5i.tabManual === "true" && s5i.frontKept, JSON.stringify(s5i));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILED"}: ${pass} passed, ${fail} failed`);
} catch (err) {
  fail++;
  console.log("  ✗ 测试执行异常: " + (err && err.stack || err));
} finally {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exitCode = fail === 0 ? 0 : 1;
}
