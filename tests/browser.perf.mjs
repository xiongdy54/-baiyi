// 浏览器性能量测（CDP 真机；node tests/browser.perf.mjs）
// 目的：为「行数窗口 vs 虚拟滚动」提供实测数字（规格 §H 要求「须先量测再替换」）
// 量什么：① 全量取数 IPC 往返；② 进入卡片页到首屏行出现；③ 输入筛选后的重绘；④ DOM 行数是否受窗口限制
// 规模（D110，用户 2026-10-07 指令）＝30 万卡 + 5 万摘录（终身使用量级）；环境变量可调小做快速冒烟
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9229";
const USER_DATA = path.join(ROOT, "tests", "tmp-perf-userdata");
const CARDS = Number(process.env.PERF_CARDS || 300000);
const EXTRACTS = Number(process.env.PERF_EXTRACTS || 50000);

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 200)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  for (let i = 0; i < 120; i++) {
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

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  execSync("npx electron tests/browser.perf.seed.cjs", {
    cwd: ROOT, shell: true, stdio: "ignore",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA, PERF_CARDS: String(CARDS), PERF_EXTRACTS: String(EXTRACTS) }
  });
  const out = openSync(path.join(ROOT, "tests", "browser.perf.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ① 全量取数 IPC 往返（客户端每次刷新都全量取，这是行数增长时最可能先爆的一环）
  const ipcMs = await cdp.eval(`(async () => { const t = performance.now(); const all = await window.cardsAPI.listAll(); return JSON.stringify({ ms: Math.round(performance.now() - t), n: all.length }); })()`);
  const ipc = JSON.parse(ipcMs || "{}");
  console.log(`    · 全量 listAll：${ipc.n} 行 / ${ipc.ms}ms`);
  check("全量取数与种子一致", Number(ipc.n) >= CARDS, CARDS, ipc.n);

  // ② 进入卡片页到首屏行出现
  const t0 = Date.now();
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  let rows = 0;
  for (let i = 0; i < 40; i++) {
    await wait(150);
    rows = Number(await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`)) || 0;
    if (rows > 0) break;
  }
  const firstPaintMs = Date.now() - t0;
  console.log(`    · 进入卡片页到首屏行出现：${firstPaintMs}ms（${rows} 行）`);
  check("首屏出现行", rows > 0, rows);

  // ③ DOM 行数受虚拟窗口限制（D110：可见行 + 2×12 冗余；视口 ~600px/40px ≈ 15 行 → 上限 80 从宽）
  check("DOM 行数受虚拟窗口限制（≤80 行，D110）", rows <= 80, `${rows} 行（库内 ${CARDS} 卡）`);

  // ③b D110 深滚动：滚到底后 DOM 行数仍有界，且最后一行内容真实出现在 DOM（spacer 高度与窗口换页正确）
  await cdp.eval(`(() => { const w = document.querySelector(".queue-wrap"); if (w) w.scrollTop = w.scrollHeight; return true; })()`);
  await wait(700);
  const deep = JSON.parse(String(await cdp.eval(`(() => {
    const rows2 = [...document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)")];
    const last = rows2[rows2.length - 1];
    return JSON.stringify({ n: rows2.length, lastText: last ? last.textContent.slice(0, 40) : "" });
  })()`)) || "{}");
  check("D110 滚到底：DOM 行数仍有界（≤80）", deep.n <= 80, deep.n);
  check("D110 滚到底：最后一行是库内最深卡（窗口换页正确）", String(deep.lastText).includes(`题面 ${CARDS - 1}`), deep.lastText);
  await cdp.eval(`(() => { const w = document.querySelector(".queue-wrap"); if (w) w.scrollTop = 0; return true; })()`);
  await wait(500);

  // ④ 输入筛选后的重绘耗时（防抖 300ms 后一次完整过滤 + 渲染；筛选词取唯一串——30 万行下
  //    「第 12」这类短前缀子串命中数千行会让「缩小结果集」断言失效）
  const filterMs = await cdp.eval(`(async () => {
    const inp = document.querySelector(".cb-toolbar .cb-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const t = performance.now();
    setter.call(inp, "第 ${CARDS - 1} 张");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    return Math.round(performance.now() - t);
  })()`);
  const filteredRows = Number(await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`)) || 0;
  console.log(`    · 输入筛选 → 重绘：${filterMs}ms（剩 ${filteredRows} 行）`);
  check("筛选后确实缩小结果集（非空转）", filteredRows > 0 && filteredRows < 80, `1..79`, filteredRows);

  // ⑤ 摘录表（500 条）切换与渲染——先清空查询（否则被上一步的筛选串污染，只剩空态行）
  const exMs = await cdp.eval(`(async () => {
    const inp = document.querySelector(".cb-toolbar .cb-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const t = performance.now();
    document.querySelector("[data-kind-extract]")?.click();
    await new Promise((r) => setTimeout(r, 400));
    return Math.round(performance.now() - t);
  })()`);
  const exRows = Number(await cdp.eval(`document.querySelectorAll("[data-extract-table] .cb-row:not(.cb-row-head)").length`)) || 0;
  console.log(`    · 切到摘录页并渲染：${exMs}ms（${exRows} 行 / 库内 ${EXTRACTS} 条）`);
  check("摘录表渲染且受虚拟窗口限制（非空态占位行）", exRows > 1 && exRows <= 80, `${exRows}（库内 ${EXTRACTS}）`);

  console.log(`\n==== browser.perf：${pass} 通过 / ${fail} 失败（库内 ${CARDS} 卡 + ${EXTRACTS} 摘录）====`);
} catch (e) {
  console.error("量测异常：", (e && e.stack) || e);
  fail++;
} finally {
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  process.exit(fail === 0 ? 0 : 1);
}
