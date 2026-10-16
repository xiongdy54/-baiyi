// D125 顶栏「推荐」页签（模块名「下一步」）+ 设置页「实验功能」区块 GUI 回归（真应用 CDP，自启自关）
// @runtime: node  @tier: 2  @gui: true  @id: D125NEXTTAB  @timeout: 180
// 运行：npm run build 之后 `node tests/d125-next-tab.gui.mjs`（CDP 驱动 dist 上的真实应用，可 taskkill electron）
// 隔离：M7_TEST_USERDATA → tests/tmp-d125-userdata（先清空；默认设置启动，绝不触碰真实库 §7.3）。
// 断言链（D125，用户指令：页签第 4 位 / 关闭即消失并前滑补位 / 设置归入实验功能 / 导航不挤出画面外；页签文字「推荐」与其余两字签等长）：
//   ① 顶栏六签、顺序＝书架/摘录/复习/推荐/卡片/数据（「推荐」第 4 位；MOTION-DESIGN-SPEC §5.1 页序表同步；
//      v48.114/D159：「日记」页签随功能暂时移除，七签→六签）
//   ② 点「推荐」→ 页面挂载 learner 面板（learner-panel-card），顶栏标题＝下一步（模块全名）
//   ③ 设置左栏出现「实验功能」（D125：左栏 14 项 → 15 项；D114 立约文本记 13 项，DOM 实际计数 14——历史出入以实际为准）→ #sec-lab 内含 #sec-learner（自 sec-widgets 迁入）
//   ④ 正处「推荐」页时在设置里关闭学习者模型 → 页签经 .nav-collapse 收拢后卸载（回到六签）＋视图退回数据页
//   ⑤ 重新开启 → 页签回到第 4 位；关设置后点「推荐」面板恢复挂载
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9286";
const USER_DATA = path.join(ROOT, "tests", "tmp-d125-userdata");

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

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const out = openSync(path.join(ROOT, "tests", "d125-next-tab.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  const navTexts = () => cdp.eval(`[...document.querySelectorAll(".topbar-nav .nav-item")].map((b) => b.textContent.trim()).join(",")`);
  const navClick = (label) => cdp.eval(`(() => { const b = [...document.querySelectorAll(".topbar-nav .nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
  const title = () => cdp.eval(`document.querySelector(".topbar-title")?.textContent?.trim() || ""`);

  // ① 页签位次（第 4 位；窗口 minWidth 1120 下六签横排不换行——顺手量测高度恒定）
  const nav1 = await navTexts();
  check("① 顶栏六签、顺序正确（推荐第 4 位；D159 日记签移除）", nav1 === "书架,摘录,复习,推荐,卡片,数据", nav1);
  check("① 顶栏单行（nav 高度 = 单行高，无换行挤出）", (await cdp.eval(`document.querySelector(".topbar-nav").getBoundingClientRect().height`)) < 48, await cdp.eval(`document.querySelector(".topbar-nav").getBoundingClientRect().height`));

  // ② 进入「推荐」页
  check("② 点「推荐」可进", (await navClick("推荐")) === true, "未命中");
  await wait(1400);
  check("② 面板挂载（learner-panel-card）", (await cdp.eval(`!!document.querySelector(".learner-panel-card")`)) === true, "未挂载");
  check("② 顶栏标题＝下一步", (await title()) === "下一步", await title());

  // ③ 设置：实验功能区块与 learner 子块归属
  await cdp.eval(`(() => { [...document.querySelectorAll(".icon-btn")].find((b) => b.title === "设置")?.click(); return "open"; })()`);
  await wait(900);
  check("③ 设置左栏含「实验功能」", (await cdp.eval(`[...document.querySelectorAll(".settings-nav button")].some((b) => b.textContent.trim() === "实验功能")`)) === true, "左栏无该项");
  check("③ #sec-lab 内含 #sec-learner（迁入）", (await cdp.eval(`!!document.querySelector("#sec-lab #sec-learner")`)) === true, "不在 sec-lab");
  check("③ sec-widgets 不再含 learner 子块（迁出）", (await cdp.eval(`!document.querySelector("#sec-widgets #sec-learner")`)) === true, "仍留原地");
  check("③ 设置左栏共 15 项（D180 v49.6 增「软件更新」sec-updates，14→15）", (await cdp.eval(`document.querySelectorAll(".settings-nav button").length`)) === 15, await cdp.eval(`document.querySelectorAll(".settings-nav button").length`));

  // ④ 关闭学习者模型（仍在「下一步」页）：页签收拢卸载 + 视图退回数据页
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("#sec-learner .seg-tabs button")]; b[1]?.click(); return b.length; })()`);
  await wait(900); // > 收拢 200ms + 卸载定时 320ms
  const nav2 = await navTexts();
  check("④ 关闭后页签消失（回到五签）", nav2 === "书架,摘录,复习,卡片,数据", nav2);
  check("④ .nav-collapse 容器已卸载", (await cdp.eval(`!document.querySelector(".nav-collapse")`)) === true, "残留");
  check("④ 视图退回数据页（标题＝统计数据）", (await title()) === "统计数据", await title());
  check("④ learner 面板不再挂载", (await cdp.eval(`!document.querySelector(".learner-panel-card")`)) === true, "仍在");

  // ⑤ 重新开启：页签回到第 4 位；关设置后进「下一步」面板恢复
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("#sec-learner .seg-tabs button")]; b[0]?.click(); return b.length; })()`);
  await wait(900);
  const nav3 = await navTexts();
  check("⑤ 重开后页签回第 4 位", nav3 === "书架,摘录,复习,推荐,卡片,数据", nav3);
  await cdp.eval(`(() => { document.querySelector(".modal-close")?.click(); return "close"; })()`);
  await wait(700);
  check("⑤ 关设置后点「推荐」面板恢复挂载", (await navClick("推荐")) === true && await (async () => { await wait(1400); return cdp.eval(`!!document.querySelector(".learner-panel-card")`); })() === true, "面板未挂载");

  console.log(`\n==== d125-next-tab.gui：${pass} 通过 / ${fail} 失败 ====`);
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
