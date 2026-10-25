// D215 端到端：卡面就地编辑「进入编辑即落焦点」——点开字段编辑器接管焦点、打字落文、Esc 提交退出且宿主面板不关
// @runtime: node  @tier: 2  @gui: true  @id: D215EF  @timeout: 300
// 运行：npm run build 之后 `node tests/d215.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d215-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9265";
const USER_DATA = path.join(ROOT, "tests", "tmp-d215-userdata");

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
          if (!r.result) return "NORESULT: " + JSON.stringify(r).slice(0, 300);
          if (r.result.result?.value === undefined) return "UDEF: " + JSON.stringify(r).slice(0, 400);
          return r.result.result.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

async function realClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d111.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  check("播种成功", /SEEDED \{/.test(String(seeded)), String(seeded).slice(-160));

  const out = openSync(path.join(ROOT, "tests", "d215.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(2200);
  for (let i = 0; i < 30; i++) {
    await wait(200);
    const n = Number(await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`)) || 0;
    if (n > 0) break;
  }
  await cdp.eval(`(() => { document.querySelector(".cb-table .cb-row:not(.cb-row-head)")?.click(); return "open"; })()`);
  await wait(1000);
  check("详情侧边面板打开", (await cdp.eval(`!!document.querySelector(".cb-detail")`)) === true, "面板未开");

  // ① 一击点开答案字段 → 编辑器挂载且立即接管焦点（修复前 activeElement=BODY）
  const p = JSON.parse(String(await cdp.eval(`(() => {
    const el = document.querySelector(".cb-detail .review-back-a .field-read");
    if (!el) return "{}";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + Math.min(r.height / 2, 12)) });
  })()`)) || "{}");
  check("答案字段读态在场", !!p.x, p);
  await realClick(cdp, p.x, p.y);
  await wait(1200);
  const st1 = JSON.parse(String(await cdp.eval(`(() => {
    const ed = [...document.querySelectorAll(".cb-detail .markdown-editor")];
    const pm = ed[ed.length - 1]?.querySelector(".ProseMirror") ?? null;
    return JSON.stringify({
      mounted: !!pm,
      focused: !!pm && (document.activeElement === pm || pm.contains(document.activeElement)),
      active: document.activeElement.tagName + "." + String(document.activeElement.className).slice(0, 40),
      paneOpen: !!document.querySelector(".cb-detail")
    });
  })()`)) || "{}");
  check("点击后编辑器挂载", st1.mounted === true, st1);
  check("编辑器立即接管焦点（activeElement 在 .ProseMirror 内）", st1.focused === true, st1);

  // ② 直接打字 → 落进正文（修复前打字全部落空）
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "改" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "改" });
  await wait(600);
  const st2 = JSON.parse(String(await cdp.eval(`(() => {
    const ed = [...document.querySelectorAll(".cb-detail .markdown-editor")];
    const pm = ed[ed.length - 1]?.querySelector(".ProseMirror");
    return JSON.stringify({ text: pm ? pm.textContent : null, paneOpen: !!document.querySelector(".cb-detail") });
  })()`)) || "{}");
  check("打字直接落进正文", String(st2.text || "").includes("改"), st2);

  // ③ Esc → 提交并退出编辑，且详情面板不被关掉（修复前 Esc 冒到 document 关整面板）
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait(900);
  const raw3 = await cdp.eval(`(() => JSON.stringify({
    editorGone: !document.querySelector(".cb-detail .markdown-editor"),
    readBack: !!document.querySelector(".cb-detail .review-back-a .field-read"),
    paneOpen: !!document.querySelector(".cb-detail"),
    committed: document.querySelector(".cb-detail .review-back-a .field-read")?.textContent ?? ""
  }))()`);
  console.log("  · Esc 后原始状态:", raw3);
  const st3 = typeof raw3 === "string" ? JSON.parse(raw3) : {};
  check("Esc 提交并退出编辑（读态回来）", st3.editorGone === true && st3.readBack === true, st3);
  check("Esc 后详情面板仍在（不再被整面板关闭）", st3.paneOpen === true, st3);
  check("修改已提交落库刷新（正文含新字）", String(st3.committed).includes("改"), st3.committed);

  console.log(`\n==== d215.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
