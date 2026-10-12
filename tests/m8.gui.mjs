// v36（M8-A）日记与快速记录 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m8.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m8-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§9.1 M8-A 验收 ①–⑧；db/协议层由 tests/m8.test.cjs 锁定）：
//   导航「日记」→ 主窗口输入行提交一条 → 全局快捷键状态（两键）→ toggleCapture 弹出捕获窗口
//   → 捕获窗口输入即自动保存 → 不发送隐藏再呼出仍可续写 → 发送定格为一条且主窗口实时出现
//   → Ctrl+Alt+N 就地弹出「添加书籍」且不切视图 → 设置页 sec-global 冲突拒绝 → 重启不丢 → 清理
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-m8-userdata");
const MARK = "FSRSTEST M8";

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

// 连到指定页面目标（主窗口 index.html / 捕获窗口 capture.html）——多目标场景必须按 URL 区分，
// 否则会连到错误窗口（本批是应用内第一次出现第二个 BrowserWindow）
async function connectTarget(match, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await listTargets()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        });
        const send = (method, params = {}) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails)
            return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS, url: t.url };
      }
    } catch {
      /* 端口未就绪 */
    }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

function spawnApp() {
  const out = openSync(path.join(ROOT, "tests", "m8.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

// §J P0：markdown 编辑器（ProseMirror contenteditable）内容写入——聚焦后 selectAll+insertText
// （execCommand 走 beforeinput 管道，ProseMirror 原生处理；等价旧 textarea 的 setValue+input）
const setPM = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, ${JSON.stringify(value)});
  return true;
})()`;
// 设置受控 textarea/input 的值并触发 React onChange（原生 setter + input 事件，React 才能感知）
const setValue = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;

try {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留 */
  }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  fs.rmSync(path.join(ROOT, "tests", "m8.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 启动
  const booted = await main.eval(`!!document.querySelector("#root")`);
  check("应用启动（根节点挂载）", booted === true, booted);

  // 1. 导航「日记」存在并可切换
  const navLabels = await main.eval(`[...document.querySelectorAll(".nav-item")].map((b) => b.textContent.trim()).join("/")`);
  check("顶栏导航含「日记」（书架/摘录/复习/推荐/卡片/日记/数据；D125 增推荐页签，v48.93/D138 对齐）", navLabels === "书架/摘录/复习/推荐/卡片/日记/数据", navLabels);
  await main.eval(clickByText(".nav-item", "日记"));
  await wait(900);
  const journalMounted = await main.eval(`!!document.querySelector(".journal")`);
  check("日记页挂载", journalMounted === true, journalMounted);
  const emptyText = await main.eval(`document.querySelector(".journal-empty-text")?.textContent || ""`);
  check("空状态提示含全局快捷键（真实键位）", emptyText.includes("Ctrl+Alt+Space"), emptyText);

  // 2. 主窗口当日输入行：Enter 提交为一条
  const typed = await main.eval(setPM(".journal-composer .ProseMirror", `${MARK} 主窗口写下的一条`));
  check("输入行可写入", typed === true, typed);
  await wait(400); // 等 React 状态回流（PM onChange → setState），否则「记下」按钮仍持旧 disabled 态
  await main.eval(clickByText(".journal-composer .btn-primary", "记下"));
  await wait(1200);
  const afterCompose = await main.eval(`JSON.stringify({
    entries: document.querySelectorAll(".journal-entry:not(.journal-draft)").length,
    text: document.querySelector(".journal-entry-md")?.textContent || "",
    composerCleared: (document.querySelector(".journal-composer .ProseMirror")?.textContent || "") === ""
  })`);
  const ac = JSON.parse(afterCompose || "{}");
  check("提交后日记出现 1 条且内容正确", ac.entries === 1 && String(ac.text).includes("主窗口写下的一条"), afterCompose);
  check("提交后输入行已清空", ac.composerCleared === true, afterCompose);

  // 3. 全局快捷键组状态（两键都必须「注册成功或给出可读原因」，绝不静默失效）
  const st = JSON.parse(
    (await main.eval(`(async () => JSON.stringify(await window.shortcutsAPI.status()))()`)) || "{}"
  );
  check("快速记录默认键 = Ctrl+Alt+Space", st.quickCapture?.accelerator === "Ctrl+Alt+Space", JSON.stringify(st));
  check("添加材料默认键 = Ctrl+Alt+N", st.addMaterial?.accelerator === "Ctrl+Alt+N", JSON.stringify(st));
  const visible = (s) => s && (s.registered === true || (typeof s.error === "string" && s.error.length > 0));
  check("快速记录：注册成功或给出可读原因", visible(st.quickCapture), JSON.stringify(st.quickCapture));
  check("添加材料：注册成功或给出可读原因", visible(st.addMaterial), JSON.stringify(st.addMaterial));
  console.log(`  · 实测：快速记录 registered=${st.quickCapture?.registered} / 添加材料 registered=${st.addMaterial?.registered}`);

  // 4. toggleCapture（与全局快捷键同一入口）→ 捕获窗口出现
  const toggled = await main.eval(`(async () => await window.shortcutsAPI.toggleCapture())()`);
  check("toggleCapture 调用成功", toggled === true, toggled);
  const cap = await connectTarget((u) => u.includes("capture.html"), "捕获窗口", 30000);
  await wait(1200);
  const capShell = await cap.eval(`JSON.stringify({
    shell: !!document.querySelector(".cap-shell"),
    title: document.querySelector(".cap-title")?.textContent || "",
    meta: document.querySelector(".cap-meta")?.textContent || "",
    sendDisabled: !!document.querySelector(".cap-footer .btn-primary")?.disabled
  })`);
  const cs = JSON.parse(capShell || "{}");
  check("捕获窗口渲染（快速记录 + 当日 meta）", cs.shell === true && cs.title === "快速记录" && cs.meta.includes("今日已记 1 条"), capShell);
  check("空内容时「发送」置灰", cs.sendDisabled === true, capShell);

  // 5. 输入即自动保存（零点击）
  await cap.eval(`document.querySelector(".cap-editor-md .ProseMirror")?.focus()`);
  await cap.eval(setPM(".cap-editor-md .ProseMirror", `${MARK} 快速记录随想`));
  await wait(3600); // 防抖 1.2s + IPC + 主进程事件循环偶发空洞（D137 B6 实测 2000ms 才落「已保存」，2200ms 定点检查属时序竞态，v48.93/D137 放宽）
  const savedState = await cap.eval(`JSON.stringify({
    status: document.querySelector(".cap-status")?.textContent || "",
    dot: document.querySelector(".cap-dot")?.className || "",
    sendDisabled: !!document.querySelector(".cap-footer .btn-primary")?.disabled
  })`);
  const sv = JSON.parse(savedState || "{}");
  check("输入后自动保存（状态显示「已保存」）", String(sv.status).includes("已保存"), savedState);
  check("保存状态点变实心（accent）", String(sv.dot).includes("on"), savedState);
  check("有内容时「发送」可用", sv.sendDisabled === false, savedState);

  // 6. 主窗口日记页实时出现「草稿 · 未发送」（journal:changed 推送）
  await wait(600);
  const draftInMain = await main.eval(`JSON.stringify({
    draft: !!document.querySelector(".journal-draft"),
    label: document.querySelector(".journal-draft-label")?.textContent || "",
    text: document.querySelector(".journal-draft .journal-entry-md")?.textContent || "",
    composerHidden: !document.querySelector(".journal-composer"),
    sentCount: document.querySelectorAll(".journal-entry:not(.journal-draft)").length
  })`);
  const dm = JSON.parse(draftInMain || "{}");
  check("主窗口实时出现草稿行（含「草稿 · 未发送」标记）", dm.draft === true && String(dm.label).includes("草稿"), draftInMain);
  check("草稿内容与捕获窗口一致", String(dm.text).includes("快速记录随想"), draftInMain);
  check("有草稿时当日输入行收起（同日不出现两个输入口）", dm.composerHidden === true, draftInMain);
  check("草稿不计入已发送条数（仍 1 条）", dm.sentCount === 1, draftInMain);

  // 7. 不发送就隐藏 → 再呼出，内容仍在（草稿可续写）
  await main.eval(`(async () => await window.shortcutsAPI.hideCapture())()`);
  await wait(700);
  await main.eval(`(async () => await window.shortcutsAPI.toggleCapture())()`);
  await wait(1400);
  const resumed = await cap.eval(`document.querySelector(".cap-editor-md .ProseMirror")?.textContent || ""`);
  check("隐藏后重新呼出：草稿内容原样保留（可继续向下写）", resumed.includes("快速记录随想"), resumed);
  await cap.eval(setPM(".cap-editor-md .ProseMirror", `${MARK} 快速记录随想（续写并发送）`));
  await wait(1800);

  // 8. 发送 → 编辑器清空 + 提示 + 主窗口出现正式条目
  await cap.eval(`document.querySelector(".cap-footer .btn-primary")?.click()`);
  await wait(1400);
  const sentState = await cap.eval(`JSON.stringify({
    value: document.querySelector(".cap-editor-md .ProseMirror")?.textContent || "",
    toast: document.querySelector(".cap-toast")?.textContent || "",
    meta: document.querySelector(".cap-meta")?.textContent || ""
  })`);
  const ss = JSON.parse(sentState || "{}");
  check("发送后编辑器清空", ss.value === "", sentState);
  check("发送后给出「已记入 … 日记」回执", String(ss.toast).includes("已记入") && String(ss.toast).includes("日记"), sentState);
  check("发送后当日计数 +1（今日已记 2 条）", String(ss.meta).includes("今日已记 2 条"), sentState);
  await wait(700);
  const mainAfterSend = await main.eval(`JSON.stringify({
    sent: document.querySelectorAll(".journal-entry:not(.journal-draft)").length,
    draft: !!document.querySelector(".journal-draft"),
    text: [...document.querySelectorAll(".journal-entry-md")].map((x) => x.textContent).join(" | "),
    composerBack: !!document.querySelector(".journal-composer")
  })`);
  const ms = JSON.parse(mainAfterSend || "{}");
  check("主窗口实时出现已发送条目（共 2 条）", ms.sent === 2, mainAfterSend);
  check("发送后草稿行消失、输入行回来", ms.draft === false && ms.composerBack === true, mainAfterSend);
  check("发送内容含续写文本（发送定格的是最新内容）", String(ms.text).includes("续写并发送"), mainAfterSend);

  // 9. Ctrl+Alt+N 同一入口：就地弹出「添加书籍」，不切换视图
  const addReq = await main.eval(`(async () => await window.shortcutsAPI.requestAddMaterial())()`);
  check("requestAddMaterial 调用成功", addReq === true, addReq);
  await wait(900);
  const modalState = await main.eval(`JSON.stringify({
    modal: !!document.querySelector(".modal-panel"),
    heading: document.querySelector(".modal-panel h2")?.textContent || "",
    journalStillMounted: !!document.querySelector(".journal")
  })`);
  const mm = JSON.parse(modalState || "{}");
  check("弹出「添加书籍」模态", mm.modal === true && mm.heading === "添加书籍", modalState);
  check("弹模态不切换视图（日记页仍在，阅读/复习现场不被打断）", mm.journalStillMounted === true, modalState);
  await main.eval(`document.querySelector(".modal-close")?.click()`);
  await wait(500);

  // 10. 设置页「全局快捷键」：冲突键被拒（应用内 Ctrl+A = AI 解释）
  await main.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.title?.includes("设置")); b?.click(); return !!b; })()`);
  await wait(800);
  const secExists = await main.eval(`!!document.querySelector("#sec-global")`);
  check("设置页含「全局快捷键」区块", secExists === true, secExists);
  const secText = await main.eval(`document.querySelector("#sec-global")?.textContent || ""`);
  check("区块文案含两个默认键位", secText.includes("Ctrl+Alt+Space") && secText.includes("Ctrl+Alt+N"), secText.slice(0, 160));
  // 点击快速记录键位框 → 捕获 → 按下 Ctrl+A（与应用内「AI 解释」冲突）
  await main.eval(`(() => { const sec = document.querySelector("#sec-global"); const kb = sec.querySelectorAll(".kb-key")[0]; kb?.click(); return !!kb; })()`);
  await wait(300);
  await main.eval(`(() => {
    const ev = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return true;
  })()`);
  await wait(600);
  const conflictState = await main.eval(`JSON.stringify({
    conflict: document.querySelector("#sec-global .kb-conflict")?.textContent || "",
    keys: [...document.querySelectorAll("#sec-global .kb-key")].map((b) => b.textContent.trim())
  })`);
  const cf = JSON.parse(conflictState || "{}");
  check("与应用内键位冲突时给出提示且不保存", String(cf.conflict).includes("冲突"), conflictState);
  check("冲突键位未被写入（仍是 Ctrl+Alt+Space）", cf.keys?.[0] === "Ctrl+Alt+Space", conflictState);
  await main.eval(`document.querySelector(".modal-close")?.click()`);
  await wait(400);

  // 11. 重启不丢
  electron.kill();
  await wait(1500);
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 忽略 */
  }
  await wait(1000);
  electron = spawnApp();
  const main2 = await connectTarget((u) => u.includes("index.html"), "主窗口（重启后）");
  await wait(2500);
  await main2.eval(clickByText(".nav-item", "日记"));
  await wait(1200);
  const persisted = await main2.eval(`JSON.stringify({
    sent: document.querySelectorAll(".journal-entry:not(.journal-draft)").length,
    text: [...document.querySelectorAll(".journal-entry-md")].map((x) => x.textContent).join(" | "),
    draft: !!document.querySelector(".journal-draft")
  })`);
  const ps = JSON.parse(persisted || "{}");
  check("重启后日记条目仍在（2 条）", ps.sent === 2, persisted);
  check("重启后内容完整（含快速记录发送的那条）", String(ps.text).includes("续写并发送"), persisted);
  check("重启后无残留草稿（已发送）", ps.draft === false, persisted);

  // 12. 清理：删测试条目 + 复位设置（测试数据不留痕）
  const cleaned = await main2.eval(`(async () => {
    const res = await window.journalAPI.list({ limit: 500 });
    let n = 0;
    for (const e of res.entries) {
      if (String(e.contentMarkdown || "").includes(${JSON.stringify(MARK)})) { await window.journalAPI.remove(e.id); n++; }
    }
    await window.settingsAPI.set("app", "globalShortcuts", null);
    return n;
  })()`);
  check("测试条目清理完成（2 条）", cleaned === 2, cleaned);
  const leftAfter = await main2.eval(`(async () => (await window.journalAPI.list({ limit: 100 })).entries.length)()`);
  check("清理后日记为空", leftAfter === 0, leftAfter);

  console.log(`\nM8 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M8 GUI 异常", e);
} finally {
  try {
    electron?.kill();
  } catch {
    /* 忽略 */
  }
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 忽略 */
  }
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    /* 清理失败不掩盖结果 */
  }
}
process.exit(fail > 0 ? 1 : 0);
