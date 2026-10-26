// D226–D228 端到端：摘录页当前卡钉住（A1）+ 焦点在滑块上快捷键照常（A2）+ 摘录页按键口径（C1）
// @runtime: node  @tier: 2  @gui: true  @id: D226EK  @timeout: 300
// 运行：npm run build 之后 `node tests/d226-extract-keys.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d226-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 判据与排序方向无关：滑块先点 20% 再点 80%——无论「数字大优先」还是「数字小优先」，两次里总有一次
// 会让当前卡在队列里换位；钉住时两次都不换卡。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9271";
const USER_DATA = path.join(ROOT, "tests", "tmp-d226-userdata");
const SANDBOX = process.platform === "linux" ? ["--no-sandbox"] : [];

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
async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: 0 });
  await wait(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
}
/** 真键盘（CDP Input）：modifiers 位 Alt=1 Ctrl=2 Meta=4 Shift=8 */
async function key(cdp, k, code, vk, modifiers = 0, autoRepeat = false) {
  // 回车 / 空格带 text（真键盘会产生字符事件——按钮的原生激活靠它；无修饰时才带）
  const text = modifiers === 0 ? (k === "Enter" ? "\r" : k === " " ? " " : undefined) : undefined;
  await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, autoRepeat, ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
}
const SPACE = [" ", "Space", 32];
const ENTER = ["Enter", "Enter", 13];
const Z = ["z", "KeyZ", 90];
const shownId = (cdp) => cdp.eval(`document.querySelector(".extract-page")?.getAttribute("data-showing-extract-id") || ""`);
const detail = async (cdp, id) => JSON.parse(String(await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(id)}); return JSON.stringify({ p: d?.priority, pc: d?.processCount, ivl: d?.intervalDays, st: d?.status }); })()`)) || "{}");
const activeDesc = (cdp) => cdp.eval(`(() => { const a = document.activeElement; return a ? a.tagName + (a.type ? "[" + a.type + "]" : "") + (a.textContent ? ":" + a.textContent.trim().slice(0, 6) : "") : ""; })()`);
async function clickSlider(cdp, ratio) {
  const r = JSON.parse(String(await cdp.eval(`(() => { const s = document.querySelector('.prio-track input[type=range]'); if (!s) return "{}"; const b = s.getBoundingClientRect(); return JSON.stringify({ x: b.left, y: b.top + b.height / 2, w: b.width }); })()`)) || "{}");
  if (r.x == null) return false;
  await clickAt(cdp, r.x + r.w * ratio, r.y);
  await wait(1300); // 350ms 去抖提交 + 写库 + 刷新回流
  return true;
}

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync(`npx electron ${SANDBOX.join(" ")} tests/d226-extract-keys.gui.seed.cjs`, {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const idsLine = String(seeded).split("\n").find((l) => l.startsWith("SEEDED "));
  check("播种成功（三条到期摘录）", !!idsLine, String(seeded).slice(-160));
  const [idA, idB, idC] = JSON.parse(idsLine ? idsLine.slice(7) : "[]");

  const out = openSync(path.join(ROOT, "tests", "d226-extract-keys.gui.log"), "w");
  electron = spawn("npx", ["electron", ...SANDBOX, ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return !!b; })()`);
  for (let i = 0; i < 30; i++) { await wait(200); if (await shownId(cdp)) break; }
  await wait(1200); // 入场过渡（content-enter / 页面过渡）走完再量滑块坐标
  const first = await shownId(cdp);
  check("进入摘录页显示一张到期摘录", [idA, idB, idC].includes(first), first);

  // ---------- A1（D226）：改优先级不换卡 ----------
  await clickSlider(cdp, 0.2);
  const p20 = await detail(cdp, first);
  check("A1 点滑块 20%：优先级已落库", Number(p20.p) > 5 && Number(p20.p) < 35, JSON.stringify(p20));
  check("A1 点滑块 20% 后当前卡不变", (await shownId(cdp)) === first, await shownId(cdp));
  await clickSlider(cdp, 0.8);
  const p80 = await detail(cdp, first);
  check("A1 点滑块 80%：优先级已落库", Number(p80.p) > 65 && Number(p80.p) < 95, JSON.stringify(p80));
  check("A1 点滑块 80% 后当前卡不变（两个方向总有一次会让它换位）", (await shownId(cdp)) === first, await shownId(cdp));
  check("前置：焦点停在优先级滑块上", String(await activeDesc(cdp)).startsWith("INPUT[range]"), await activeDesc(cdp));

  // ---------- A2（D227）：焦点在滑块上，Ctrl+Z / 空格照常 ----------
  await key(cdp, ...Z, 2);
  await wait(1200);
  const pu = await detail(cdp, first);
  check("A2 焦点在滑块上 Ctrl+Z 撤销了最近一次改优先级（80→20 档）", Number(pu.p) === Number(p20.p), JSON.stringify(pu));
  check("A2 撤销改优先级后当前卡不变", (await shownId(cdp)) === first, await shownId(cdp));
  await key(cdp, ...SPACE);
  await wait(1500);
  const afterAdv = await shownId(cdp);
  const da = await detail(cdp, first);
  check("A2 焦点在滑块上按空格＝下一条（读后推进）", Number(da.pc) === 1 && afterAdv !== first && !!afterAdv, `${JSON.stringify(da)} shown=${afterAdv}`);

  // ---------- C1（D228）：修饰键 / 长按 / Tab 选中按钮 ----------
  await cdp.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
  await key(cdp, ...Z, 1); // Alt+Z（阅读「制卡」默认键）
  await wait(900);
  check("C1 Alt+Z 不触发撤销", Number((await detail(cdp, first)).pc) === 1, JSON.stringify(await detail(cdp, first)));
  await key(cdp, "Z", "KeyZ", 90, 2 | 8); // Ctrl+Shift+Z（重做习惯键）
  await wait(900);
  check("C1 Ctrl+Shift+Z 不触发撤销", Number((await detail(cdp, first)).pc) === 1, JSON.stringify(await detail(cdp, first)));
  await key(cdp, ...ENTER, 2); // Ctrl+Enter
  await wait(900);
  check("C1 Ctrl+回车不触发下一条", (await shownId(cdp)) === afterAdv && Number((await detail(cdp, afterAdv)).pc) === 0, await shownId(cdp));
  await key(cdp, ...SPACE, 8); // Shift+空格
  await wait(900);
  check("C1 Shift+空格不触发下一条", (await shownId(cdp)) === afterAdv && Number((await detail(cdp, afterAdv)).pc) === 0, await shownId(cdp));
  await key(cdp, ...SPACE, 0, true); // 长按连发
  await wait(900);
  check("C1 长按连发的空格不推进", (await shownId(cdp)) === afterAdv && Number((await detail(cdp, afterAdv)).pc) === 0, await shownId(cdp));

  // ---------- 撤销召回钉回（D226）----------
  await key(cdp, ...Z);
  await wait(1500);
  const du = await detail(cdp, first);
  check("Z 撤销「下一条」：摘录复原（process_count 回 0）", Number(du.pc) === 0, JSON.stringify(du));
  check("撤销召回的那条被钉为当前卡（无论它在新队列里排第几）", (await shownId(cdp)) === first, await shownId(cdp));

  // ---------- C1：Tab 选中「推迟」后回车＝推迟（不是下一条）----------
  await cdp.eval(`(() => { const n = document.querySelector('.extract-face-actions .bar-cluster input[type=number]'); n?.focus(); return !!n; })()`);
  await key(cdp, "Tab", "Tab", 9);
  await wait(300);
  const act = String(await activeDesc(cdp));
  check("前置：Tab 后焦点在「推迟」按钮上", /^BUTTON(\[\w+\])?:推迟/.test(act), act);
  await key(cdp, ...ENTER);
  await wait(1500);
  const dp = await detail(cdp, first);
  check("C1 Tab 选中「推迟」按回车＝推迟 7 天（不是下一条）", Number(dp.ivl) === 7 && Number(dp.pc) === 0, JSON.stringify(dp));

  console.log(`\n==== d226-extract-keys.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
