// M16 批 6（D61 §6.8-11）多段不相邻选择 GUI 端到端：真键鼠 Ctrl 加选两段 → 选区菜单 → 摘录 → 落库一条两段区间的批注
// @runtime: node  @tier: 2  @gui: true  @id: MULTISEL  @timeout: 300
// 运行：npm run build 之后 `node tests/multiselect.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关、可 taskkill electron）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-multiselect-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 断言链（§3 / §6.8-11）：真键鼠拖选第一段（无修饰键＝替换）→ 按住 Ctrl 拖选不相邻的第二段（＝加选）
//   → ① 集合长度 2；② 两段都进了 CSS Custom Highlight；③ 选区菜单出现且展示拼接文本；
//   ④ 点「摘录」落库：quote_range_json 有 2 段区间、各段区间文本＝两次选中的文字、content_markdown 按 \n\n 拼接。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9231";
const USER_DATA = path.join(ROOT, "tests", "tmp-multiselect-userdata");
const BOOK_TITLE = "多段选择 GUI 夹具书";
// 夹具正文（无一级标题 ⇒ 合成 EPUB 为单章，三段都在同屏可见范围内；
// 两个标记段之间隔着隔离段 ＝ 真不相邻）
const FIXTURE = [
  `甲组第一段：${"MULTISEL甲样本"} 是本次要选的第一段。`,
  "",
  `中间隔离段：${"MULTISEL隔离"} 不得进入集合。`,
  "",
  `乙组第三段：${"MULTISEL乙样本"} 是本次要选的第二段。`
].join("\n");
const MARK_A = "MULTISEL甲样本";
const MARK_B = "MULTISEL乙样本";

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
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

// CDP modifiers 位：Alt=1 Ctrl=2 Meta=4 Shift=8
const KEY_MOD = { ctrl: 2, alt: 1, shift: 8, meta: 4 };

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  // 启动真实应用（隔离 userData；夹具书在应用内经 libraryAPI.createFromPaste 建册）
  const out = openSync(path.join(ROOT, "tests", "multiselect.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 1) 建册（真 IPC 路径）→ 重载书架 → 打开该书
  const created = await cdp.eval(`(async () => JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(BOOK_TITLE)}, ${JSON.stringify(FIXTURE)})))()`);
  check("夹具书建册成功（createFromPaste）", String(created).includes(BOOK_TITLE), created);
  // 阅读设置固定为「滚动 + 纸白」（与 L2 同规：几何断言要可控；隔离库无需还原）
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  await cdp.eval(`location.reload()`);
  await wait(3000);
  const opened = await cdp.eval(`(() => { const t = [...document.querySelectorAll(".book-card-title")].find((x) => x.textContent.includes(${JSON.stringify(BOOK_TITLE)})); t?.click(); return !!t; })()`);
  check("从书架打开夹具书", opened === true, opened);
  await wait(3200);
  check("阅读器挂载（reader-wrap）", (await cdp.eval(`!!document.querySelector(".reader-wrap")`)) === true, "未挂载");
  const kernelOk = await cdp.eval(`(() => { const k = window.__readerKernel; return !!(k && k.__getContents && k.__getContents().some((e) => e.doc && e.doc.defaultView)); })()`);
  check("阅读内核就绪（章节文档可读）", kernelOk === true, kernelOk);

  // 2) 目标文字的宿主视口坐标（iframe 内 rect + frameElement rect）
  const probe = (mark) => `(() => {
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
        if (!first || !last || !first.height) return "EMPTY_RECT";
        const fr = doc.defaultView.frameElement.getBoundingClientRect();
        return JSON.stringify({
          start: { x: fr.left + first.left + 2, y: fr.top + first.top + first.height / 2 },
          end: { x: fr.left + last.right - 2, y: fr.top + last.top + last.height / 2 }
        });
      }
    }
    return "";
  })()`;
  const posA = await cdp.eval(probe(MARK_A));
  const posB = await cdp.eval(probe(MARK_B));
  check("两段目标文字都在同章可见处（坐标可计算）", typeof posA === "string" && posA.startsWith("{") && typeof posB === "string" && posB.startsWith("{"), `A=${posA} B=${posB}`);
  const A = JSON.parse(String(posA) || "{}");
  const B = JSON.parse(String(posB) || "{}");

  // 3) 真鼠标拖选（CDP Input）：第一段（无修饰键）→ 替换；第二段（按住 Ctrl）→ 加选
  const drag = async (from, to, modifiers = 0) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, modifiers });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 6; i++) {
      const x = from.x + ((to.x - from.x) * i) / 6;
      const y = from.y + ((to.y - from.y) * i) / 6;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers });
      await wait(40);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers });
  };
  const keyEvent = (type, modifiers) => cdp.send("Input.dispatchKeyEvent", {
    type, key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers
  });

  await drag(A.start, A.end, 0);
  await wait(900);
  const afterFirst = await cdp.eval(`JSON.stringify({ menu: !!document.querySelector(".selection-menu"), spans: (window.__readerMultiSpans || []).map((s) => s.text) })`);
  const f1 = JSON.parse(String(afterFirst) || "{}");
  check("第一段拖选后集合＝1 段（不带修饰键＝替换）", Array.isArray(f1.spans) && f1.spans.length === 1 && f1.spans[0] === MARK_A, afterFirst);
  check("第一段拖选后选区菜单出现", f1.menu === true, afterFirst);

  // 按住 Ctrl（真键盘事件 + 指针事件带 modifiers 位）再拖第二段
  await keyEvent("rawKeyDown", KEY_MOD.ctrl);
  await wait(120);
  await drag(B.start, B.end, KEY_MOD.ctrl);
  await keyEvent("keyUp", 0);
  await wait(1200);
  const afterSecond = await cdp.eval(`JSON.stringify({
    menu: !!document.querySelector(".selection-menu"),
    spans: (window.__readerMultiSpans || []).map((s) => s.text)
  })`);
  const f2 = JSON.parse(String(afterSecond) || "{}");
  check("按住 Ctrl 加选后集合＝2 段（不相邻两段同时进集合）", Array.isArray(f2.spans) && f2.spans.length === 2, afterSecond);
  check("集合内容＝两次选中的文字（顺序＝采集顺序）", Array.isArray(f2.spans) && f2.spans[0] === MARK_A && f2.spans[1] === MARK_B, afterSecond);
  check("加选后选区菜单仍在（不因第二次拖选而清空）", f2.menu === true, afterSecond);

  // CSS Custom Highlight API：两段都在高亮里（每段一个 Range，命名 multi-select）
  const hl = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entries = (k && k.__getContents ? k.__getContents() : []).filter((e) => e.doc && e.doc.defaultView && e.doc.defaultView.CSS && e.doc.defaultView.CSS.highlights);
    const out = { docs: entries.length, names: [], sizes: [], texts: [], styled: false };
    for (const { doc } of entries) {
      const registry = doc.defaultView.CSS.highlights;
      if (registry.has("multi-select")) {
        out.names.push("multi-select");
        const h = registry.get("multi-select");
        out.sizes.push(h && typeof h.size === "number" ? h.size : -1);
        if (h) out.texts.push([...h].map((r) => r.toString()));
      }
      const st = doc.querySelector("style[data-reader-multi-highlight]");
      if (st && /background-color/.test(st.textContent || "")) out.styled = true;
    }
    return JSON.stringify(out);
  })()`);
  const h = JSON.parse(String(hl) || "{}");
  check("CSS Custom Highlight 已注册 multi-select（不碰 DOM 的绘制层）", Array.isArray(h.names) && h.names.includes("multi-select"), hl);
  check("高亮含 2 个 Range 且文本＝两段选中文字", Array.isArray(h.sizes) && h.sizes.includes(2) && Array.isArray(h.texts) && h.texts.some((t) => t.length === 2 && t[0] === MARK_A && t[1] === MARK_B), hl);
  check("高亮颜色来自 Token（--hl-multi 求值后以字面值注入 iframe）", h.styled === true, hl);

  // 4) 真鼠标点「摘录」→ 落库
  const menuBtn = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll(".selection-menu button")].find((x) => x.textContent.trim() === "摘录");
    if (!b) return "";
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  check("选区菜单含「摘录」按钮", String(menuBtn).startsWith("{"), menuBtn);
  const mb = JSON.parse(String(menuBtn) || "{}");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mb.x, y: mb.y, modifiers: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: mb.x, y: mb.y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await wait(80);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: mb.x, y: mb.y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
  await wait(2000);

  const row = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const hit = (all || []).find((e) => String(e.contentMarkdown || "").includes(${JSON.stringify(MARK_A)}));
    if (!hit) return JSON.stringify({ found: false, n: (all || []).length });
    const md = String(hit.contentMarkdown || "");
    let ranges = null;
    try { ranges = JSON.parse(hit.quoteRangeJson || "null"); } catch { ranges = "PARSE_ERR"; }
    return JSON.stringify({
      found: true,
      md,
      ranges,
      slices: Array.isArray(ranges) ? ranges.map((r) => md.slice(r.start, r.end)) : null
    });
  })()`);
  const r = JSON.parse(String(row) || "{}");
  check("摘录已落库（含第一段文字的那一条）", r.found === true, row);
  check("quote_range_json 有 2 段区间", Array.isArray(r.ranges) && r.ranges.length === 2, row);
  check("各段区间对应的文本＝两次选中的文字", Array.isArray(r.slices) && r.slices[0] === MARK_A && r.slices[1] === MARK_B, JSON.stringify(r.slices));
  check("content_markdown＝两段按 \\n\\n 拼接", r.md === `${MARK_A}\n\n${MARK_B}`, JSON.stringify(r.md));

  // 5) 菜单动作完成后集合与高亮一并清空（不残留）
  const cleaned = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entries = (k && k.__getContents ? k.__getContents() : []).filter((e) => e.doc && e.doc.defaultView && e.doc.defaultView.CSS && e.doc.defaultView.CSS.highlights);
    const alive = entries.filter(({ doc }) => doc.defaultView.CSS.highlights.has("multi-select")).length;
    return JSON.stringify({ menu: !!document.querySelector(".selection-menu"), spans: (window.__readerMultiSpans || []).length, alive });
  })()`);
  const c = JSON.parse(String(cleaned) || "{}");
  check("摘录动作完成后：菜单收起、集合清空、高亮撤掉", c.menu === false && c.spans === 0 && c.alive === 0, cleaned);

  console.log(`\n==== multiselect.gui：${pass} 通过 / ${fail} 失败 ====`);
} catch (e) {
  console.error("测试异常：", (e && e.stack) || e);
  fail++;
} finally {
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  process.exit(fail === 0 ? 0 : 1);
}
