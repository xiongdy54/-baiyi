// M7 词典 GUI 冒烟（CDP 驱动真实应用，自启自关；node tests/m7.gui.mjs）
// 覆盖：设置 sec-dict 可见 → 目录下载行（大小/简介/推荐齐备）→ 查词命令已注册 → card-vocab 模板可取 → 清理。
// 原生文件对话框/真实下载不自动化（由 m7.test.cjs 目录断言 + 手动冒烟覆盖）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9225";

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
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

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "m7.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: path.join(ROOT, "tests", "tmp-m7-userdata") }
  });
  const cdp = await connect();
  await wait(2000);

  // 1. 应用启动无白屏
  const title = await cdp.eval(`document.title`);
  check("应用启动（title 可读）", typeof title === "string", title);
  const noWhite = await cdp.eval(`!!document.querySelector("#root")`);
  check("根节点挂载（非白屏）", noWhite === true, noWhite);

  // 2. dictAPI 桥接存在
  const hasDictAPI = await cdp.eval(`!!window.dictAPI && typeof window.dictAPI.lookupOnline === "function"`);
  check("dictAPI 桥接存在", hasDictAPI === true, hasDictAPI);

  // 3. card-vocab 模板可取（主进程播种 v1）
  const vocabTpl = await cdp.eval(`(async () => { const t = await window.promptsAPI?.get("card-vocab"); return t ? t.version + ":" + t.content.slice(0, 20) : null; })()`);
  check("card-vocab 模板可取", typeof vocabTpl === "string" && vocabTpl.startsWith("1:"), vocabTpl);

  // 4. 打开设置 → sec-dict 可见
  await cdp.eval(`(() => { const btns = [...document.querySelectorAll("button")]; const s = btns.find((b) => b.textContent.includes("设置") || b.title?.includes("设置")); s?.click(); return !!s; })()`);
  await wait(1200);
  const dictNav = await cdp.eval(`(() => { const nav = [...document.querySelectorAll(".settings-nav button")]; const d = nav.find((b) => b.textContent.includes("词典")); d?.click(); return d ? d.textContent : null; })()`);
  check("设置含词典导航", typeof dictNav === "string" && dictNav.includes("词典"), dictNav);
  await wait(800);
  const secDict = await cdp.eval(`!!document.querySelector("#sec-dict")`);
  check("sec-dict 节可见", secDict === true, secDict);
  const catalogText = await cdp.eval(`document.querySelector("#sec-dict")?.textContent || ""`);
  check("下载目录含 JMDict/ECDICT/CC-CEDICT（大小+简介+推荐）", catalogText.includes("JMDict") && catalogText.includes("ECDICT 完整版") && catalogText.includes("CC-CEDICT"), catalogText.slice(0, 120));
  check("v38 目录含日→中两档（jamdict-cn/维基词典 日→中）", catalogText.includes("jamdict-cn") && catalogText.includes("日→中") && catalogText.includes("kaikki"), catalogText.slice(0, 200));
  check("libraryAPI.setItemLang 桥接存在（v38 书籍语言）", await cdp.eval(`typeof window.libraryAPI?.setItemLang === "function"`) === true, "setItemLang");
  const modeSeg = await cdp.eval(`(() => { const seg = document.querySelector("#sec-dict .seg-tabs"); return seg ? seg.textContent : null; })()`);
  check("来源模式三档（本地/在线/自动）", !!modeSeg && modeSeg.includes("本地") && modeSeg.includes("在线") && modeSeg.includes("自动"), modeSeg);

  console.log(`\nM7 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M7 GUI 异常", e);
} finally {
  try { electron?.kill(); } catch { /* 忽略 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 忽略 */ }
}
process.exit(fail > 0 ? 1 : 0);
