// v48（M15 重做）材料知识导图 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m15r.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m15r-userdata（先清空），绝不触碰真实库（§7.3）。
// 覆盖（批 3/4 UI 契约；管线/缓存/校验由 m15r.engine / m15r.core / m15r.db 锁定）：
//   工具栏「导图」按钮（目录旁）→ 全屏工作区挂载（空态 + 文本提取）→ 无 Key 可读降级
//   （AI 未配置区块、无发送前预览按钮、不弹错误窗）→「正文」返回（内核保活，阅读器在场）
//   → 再入工作区（空态保持）。生成全流程与回看细节随批 7 真实 Key 冒烟。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9234";
const USER_DATA = path.join(ROOT, "tests", "tmp-m15r-userdata");
const MARK = "M15RGUITEST";

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

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
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) =>
          new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails)
            return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS, url: t.url };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

function spawnApp() {
  const out = openSync(path.join(ROOT, "tests", "m15r.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "tests", "m15r.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 建册（带 # 标题，合成 EPUB 有目录）并打开阅读器
  const created = await main.eval(`(async () => {
    const r = await window.libraryAPI.createFromPaste("${MARK} 控制论入门", "# 第一章 反馈\\n\\n负反馈调节使系统回归稳定，这是控制论的核心。\\n\\n# 第二章 控制\\n\\n控制论把反馈作为核心机制来研究系统。");
    return JSON.stringify(r);
  })()`);
  const book = JSON.parse(created || "{}");
  check("建册成功", !!book.id, created);
  await main.eval(`location.reload()`);
  await wait(3500);
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(700);
  const opened = await main.eval(`(() => { const c = [...document.querySelectorAll(".book-card")].find((x) => x.title?.includes("${MARK}")); c?.click(); return !!c; })()`);
  check("书架点击打开阅读器", opened === true, opened);
  await wait(3500);

  // 1. 工具栏「导图」按钮（目录旁）→ 全屏工作区挂载
  const btn = await main.eval(clickByText(".reader-engine-controls button", "导图"));
  check("工具栏含「导图」按钮（目录旁）", btn === true, btn);
  await wait(600);
  const collecting = await main.eval(`JSON.stringify({
    mounted: !!document.querySelector(".mindmap-workspace"),
    topTitle: document.body.textContent.includes("材料知识导图"),
    backBtn: [...document.querySelectorAll(".mindmap-top button")].some((x) => x.textContent.trim() === "正文")
  })`);
  const cm = JSON.parse(collecting || "{}");
  check("全屏工作区挂载（顶栏含正文返回）", cm.mounted === true && cm.topTitle === true && cm.backBtn === true, collecting);
  // 文本提取（本地、无截断）：等 collect 完成 → 空态
  await wait(2500);
  const emptyState = await main.eval(`JSON.stringify({
    empty: document.body.textContent.includes("尚未生成"),
    desc: document.body.textContent.includes("导图会根据这份材料本身的组织方式建立结构"),
    collecting: document.body.textContent.includes("正在提取原文") || document.body.textContent.includes("正在加载")
  })`);
  const es = JSON.parse(emptyState || "{}");
  check("文本提取完成后进入空态（尚未生成）", es.empty === true && es.desc === true, emptyState);
  check("无 Key 降级说明在场（不弹错误窗）", (await main.eval(`document.body.textContent.includes("配置 AI Key 后可生成新的材料知识导图")`)) === true, "");

  // 2. 无 Key：无「发送前预览」按钮（生成入口不可达 = 不会自动调用模型）；范围选择已撤（恒整份材料）
  const noPreviewBtn = await main.eval(`(() => { return ![...document.querySelectorAll(".mindmap-sidebar button")].some((x) => x.textContent.includes("发送前预览")); })()`);
  check("无 Key 时无发送前预览按钮（生成不可达）", noPreviewBtn === true, noPreviewBtn);
  const noScopeSelect = await main.eval(`(() => { return !document.querySelector(".mindmap-sidebar select"); })()`);
  check("范围下拉已撤（恒整份材料）", noScopeSelect === true, noScopeSelect);

  // 3. 「正文」返回：工作区关闭、阅读器在场（内核保活——阅读控制条与目录按钮仍在）
  const back = await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(600);
  const backState = await main.eval(`JSON.stringify({
    closed: !document.querySelector(".mindmap-workspace"),
    readerAlive: !!document.querySelector(".reader-engine-controls") && [...document.querySelectorAll(".reader-engine-controls button")].some((x) => x.textContent.includes("导图"))
  })`);
  const bs = JSON.parse(backState || "{}");
  check("「正文」返回阅读器（原位保持）", back === true && bs.closed === true && bs.readerAlive === true, backState);

  // 4. 再入工作区（空态保持、无残留）
  await main.eval(clickByText(".reader-engine-controls button", "导图"));
  await wait(1500);
  const reenter = await main.eval(`!!document.querySelector(".mindmap-workspace") && document.body.textContent.includes("尚未生成")`);
  check("再入工作区（空态保持）", reenter === true, reenter);
  await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(400);

  // 5. 清理
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(600);
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
} catch (err) {
  console.error("FATAL:", err && (err.message || err));
  fail++;
} finally {
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(600);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
}
