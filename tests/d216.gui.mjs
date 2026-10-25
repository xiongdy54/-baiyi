// D216 端到端：闪卡优先级退役（P 列横杠 / 详情无优先级行）＋ 归档文案统一（详情「归档」+ title / 暂停调度 title）
// @runtime: node  @tier: 2  @gui: true  @id: D216PR  @timeout: 300
// 运行：npm run build 之后 `node tests/d216.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d216-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9266";
const USER_DATA = path.join(ROOT, "tests", "tmp-d216-userdata");

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
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d111.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  check("播种成功", /SEEDED \{/.test(String(seeded)), String(seeded).slice(-160));

  const out = openSync(path.join(ROOT, "tests", "d216.gui.log"), "w");
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

  // ① 闪卡表「优先」列恒显「—」（列保留、不显数值）
  const col = JSON.parse(String(await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)")].slice(0, 10);
    // 闪卡行第 8 格（grid 第 9 列）＝优先列（选/题面/类型/状态/到期/复习/遗忘/优先/来源）
    const vals = rows.map((r) => (r.children[7] || {}).textContent?.trim() ?? null);
    return JSON.stringify({ n: rows.length, allDash: vals.length > 0 && vals.every((v) => v === "—"), sample: vals.slice(0, 3) });
  })()`)) || "{}");
  check("闪卡表优先列恒显「—」", col.allDash === true, col);

  // ② 详情无「优先级」行 + 按钮文案与 title
  await cdp.eval(`(() => { document.querySelector(".cb-table .cb-row:not(.cb-row-head)")?.click(); return "open"; })()`);
  await wait(1000);
  const det = JSON.parse(String(await cdp.eval(`(() => {
    const pane = document.querySelector(".cb-detail");
    if (!pane) return "{}";
    const sus = [...pane.querySelectorAll("button")].find((b) => b.textContent.trim() === "暂停调度");
    const arch = [...pane.querySelectorAll("button")].find((b) => b.textContent.trim() === "归档");
    return JSON.stringify({
      pane: true,
      hasPriorityRow: [...pane.querySelectorAll(".cb-meta dt")].some((dt) => dt.textContent === "优先级"),
      hasNoLongerCare: [...pane.querySelectorAll("button")].some((b) => b.textContent.trim() === "不再关心"),
      suspendTitle: sus?.getAttribute("title") ?? null,
      archiveLabel: !!arch,
      archiveTitle: arch?.getAttribute("title") ?? null
    });
  })()`)) || "{}");
  check("详情面板打开", det.pane === true, det);
  check("详情 meta 无「优先级」行", det.hasPriorityRow === false, det);
  check("详情无「不再关心」按钮（统一为「归档」）", det.hasNoLongerCare === false && det.archiveLabel === true, det);
  check("「暂停调度」title 说明语义", String(det.suspendTitle || "").includes("不动复习进度"), det.suspendTitle);
  check("「归档」title 说明去向", String(det.archiveTitle || "").includes("已归档"), det.archiveTitle);

  // ③ 归档动作照常可用：点「归档」→ 状态行变已归档、按钮翻转为「恢复（解除归档）」→ 恢复回来
  await cdp.eval(`(() => { [...document.querySelectorAll(".cb-detail button")].find((b) => b.textContent.trim() === "归档")?.click(); return "arch"; })()`);
  await wait(1200);
  const afterArch = JSON.parse(String(await cdp.eval(`(() => {
    const pane = document.querySelector(".cb-detail");
    return JSON.stringify({
      status: [...pane.querySelectorAll(".cb-meta dd")].map((d) => d.textContent).find((t) => t && t.includes("归档")) ?? null,
      restoreBtn: [...pane.querySelectorAll("button")].some((b) => b.textContent.trim() === "恢复（解除归档）")
    });
  })()`)) || "{}");
  check("归档后状态显示「已归档」且按钮翻转", String(afterArch.status || "").includes("归档") && afterArch.restoreBtn === true, afterArch);
  await cdp.eval(`(() => { [...document.querySelectorAll(".cb-detail button")].find((b) => b.textContent.trim() === "恢复（解除归档）")?.click(); return "restore"; })()`);
  await wait(1200);
  const afterRestore = await cdp.eval(`(() => { const pane = document.querySelector(".cb-detail"); return JSON.stringify({ back: [...pane.querySelectorAll("button")].some((b) => b.textContent.trim() === "归档") }); })()`);
  check("恢复（解除归档）翻转回来", String(afterRestore).includes('"back":true'), afterRestore);

  // ④ D217：面板展开时条目表宽度不变 + 横向滚动（题面列不被半宽视口挤压）
  const measOpen = JSON.parse(String(await cdp.eval(`(() => {
    const wrap = document.querySelector(".queue-wrap");
    const table = document.querySelector(".cb-table");
    const front = table?.querySelector(".cb-row:not(.cb-row-head) .cb-front");
    return JSON.stringify({
      tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
      viewW: wrap ? Math.round(wrap.clientWidth) : 0,
      frontW: front ? Math.round(front.getBoundingClientRect().width) : 0,
      overflowX: wrap ? getComputedStyle(wrap).overflowX : null
    });
  })()`)) || "{}");
  check("面板展开时表格宽于半宽视口（出现横向滚动）", measOpen.tableW > measOpen.viewW + 100, measOpen);
  check("列表区横向可滚（scrollLeft 生效）", (await cdp.eval(`(() => { const w = document.querySelector(".queue-wrap"); w.scrollLeft = 300; return Math.round(w.scrollLeft); })()`)) >= 100, "scrollLeft 未生效");
  await cdp.eval(`(() => { document.querySelector(".queue-wrap").scrollLeft = 0; return 1; })()`);
  await wait(200);
  await cdp.eval(`(() => { document.querySelector('[data-testid="card-detail-close"]')?.click(); return 1; })()`);
  await wait(600);
  const measClosed = JSON.parse(String(await cdp.eval(`(() => {
    const wrap = document.querySelector(".queue-wrap");
    const table = document.querySelector(".cb-table");
    const front = table?.querySelector(".cb-row:not(.cb-row-head) .cb-front");
    return JSON.stringify({
      tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
      viewW: wrap ? Math.round(wrap.clientWidth) : 0,
      frontW: front ? Math.round(front.getBoundingClientRect().width) : 0
    });
  })()`)) || "{}");
  check("面板展开时表格宽度＝收起时宽度（条目宽度不变）", Math.abs(measOpen.tableW - measClosed.tableW) <= 2, { open: measOpen.tableW, closed: measClosed.tableW });
  check("题面列宽度不随面板展开变化", Math.abs(measOpen.frontW - measClosed.frontW) <= 2, { open: measOpen.frontW, closed: measClosed.frontW });

  console.log(`\n==== d216.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
