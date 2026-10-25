// D111 端到端（主进程过滤 + 分页取数：meta 通道首屏 / 查询主进程求值 / 行窗口深滚动 / 详情模态 / book: JOIN 修复）
// @runtime: node  @tier: 2  @gui: true  @id: D111MP  @timeout: 300
// 运行：npm run build 之后 `node tests/d111.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d111-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9251";
const USER_DATA = path.join(ROOT, "tests", "tmp-d111-userdata");
const COUNT = 600;

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

const setSearch = async (cdp, text) => {
  await cdp.eval(`(() => {
    const i = document.querySelector(".cb-toolbar .cb-search");
    if (!i) return "NOINPUT";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return "SET";
  })()`);
};

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d111.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  check("播种成功（603 卡：600 批量 + 唯一词 + 同源对）", /SEEDED \{/.test(String(seeded)), String(seeded).slice(-160));

  const out = openSync(path.join(ROOT, "tests", "d111.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(2000);

  // ① meta 通道首屏（D111：全量 listAll 退役——首屏行来自 cards:listMeta 轻量行集 + 行窗口按需取）
  const meta = JSON.parse(String(await cdp.eval(`(async () => {
    const t = performance.now();
    const m = await window.cardsAPI.listMeta();
    return JSON.stringify({ ms: Math.round(performance.now() - t), total: m.total, fp: Boolean(m.fp), books: m.books.length });
  })()`)) || "{}");
  console.log(`    · cards:listMeta：${meta.total} 行 / ${meta.ms}ms / books=${meta.books}`);
  check("meta 通道总数与种子一致（603）", meta.total === COUNT + 3, COUNT + 3, meta.total);
  check("meta 通道带库指纹", meta.fp === true, true, meta.fp);
  let rows = 0;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    rows = Number(await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`)) || 0;
    if (rows > 0) break;
  }
  check("首屏出现行（行窗口按需取）", rows > 0, rows);
  check("DOM 行数受虚拟窗口限制（≤80，D110 不变量）", rows <= 80, rows);

  // ② 查询主进程求值（cards:queryIds 端到端：防抖 + IPC + 渲染层行窗口）
  await setSearch(cdp, "唯一针脚");
  await wait(1500);
  const uniqueRows = Number(await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`)) || 0;
  check("主进程查询：唯一词命中 1 行", uniqueRows === 1, 1, uniqueRows);
  const qIds = JSON.parse(String(await cdp.eval(`(async () => {
    const r = await window.cardsAPI.queryIds("book:量测书");
    return JSON.stringify({ n: r.meta.length });
  })()`)) || "{}");
  check("主进程查询：book:书名子串命中全部（JOIN docTitle 修复取证）", qIds.n === COUNT + 3, COUNT + 3, qIds.n);

  // ③ 清空查询 → 深滚动（行窗口换页经新通道仍正确，D110 不变量不回退）
  await setSearch(cdp, "");
  await wait(1200);
  await cdp.eval(`(() => { const w = document.querySelector(".queue-wrap"); if (w) w.scrollTop = w.scrollHeight; return true; })()`);
  await wait(900);
  const deep = JSON.parse(String(await cdp.eval(`(() => {
    const rows2 = [...document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)")];
    const last = rows2[rows2.length - 1];
    return JSON.stringify({ n: rows2.length, lastText: last ? last.textContent.slice(0, 40) : "" });
  })()`)) || "{}");
  check("滚到底：DOM 行数仍有界（≤80）", deep.n <= 80, deep.n);
  check("滚到底：最后一行是库内最深卡（题面 599）", String(deep.lastText).includes(`题面 ${COUNT - 1}`), deep.lastText);
  await cdp.eval(`(() => { const w = document.querySelector(".queue-wrap"); if (w) w.scrollTop = 0; return true; })()`);
  await wait(600);

  // ④ 行详情模态（详情行经行缓存/按需取——原全量 all.find 退役）
  const detailInfo = JSON.parse(String(await cdp.eval(`(async () => {
    const row = document.querySelector(".cb-table .cb-row:not(.cb-row-head)");
    if (!row) return "{}";
    row.click();
    await new Promise((r) => setTimeout(r, 800));
    const panel = document.querySelector('.modal-panel[aria-label="卡片详情"]');
    return JSON.stringify({ open: !!panel, text: panel ? panel.textContent.slice(0, 60) : "" });
  })()`)) || "{}");
  check("行详情模态打开（窗口行数据面）", detailInfo.open === true, detailInfo);
  check("详情含题面内容", String(detailInfo.text || "").includes("D111GUI"), detailInfo.text);
  await cdp.eval(`(() => { document.querySelector('.modal-panel[aria-label="卡片详情"] .modal-backdrop, .modal-backdrop')?.click(); return "close"; })()`);
  await wait(400);

  // ⑤ 桥面通道直证（F45 盲区对账：getWindow / siblingGroup / deferredToday 在测试代码可触达）
  const bridge = JSON.parse(String(await cdp.eval(`(async () => {
    const q = await window.cardsAPI.queryIds("唯一针脚");
    const id = q.meta[0] && q.meta[0].id;
    const winRows = id ? await window.cardsAPI.getWindow([id]) : [];
    const sib = await window.cardsAPI.siblingGroup("d111gui-sib");
    const def = await window.cardsAPI.deferredToday();
    return JSON.stringify({
      winRow: winRows[0] ? (winRows[0].frontMarkdown || "").slice(0, 20) : null,
      sibN: sib.length,
      defN: def.length,
      defReason: def[0] && def[0].deferReason ? def[0].deferReason.kind : null
    });
  })()`)) || "{}");
  check("cards:getWindow 经桥返回全行", String(bridge.winRow || "").includes("唯一针脚"), bridge.winRow);
  check("cards:siblingGroup 经桥返回同源对（2 张）", bridge.sibN === 2, 2, bridge.sibN);
  check("cards:deferredToday 经桥返回暂缓 id + 原因（同源对暂缓一张）", bridge.defN === 1 && (bridge.defReason === "revealed" || bridge.defReason === "reviewed"), bridge);

  console.log(`\n==== d111.gui：${pass} 通过 / ${fail} 失败 ====`);
} catch (e) {
  console.error("测试异常：", (e && e.stack) || e);
  fail++;
} finally {
  killProc(electron);
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  process.exit(fail === 0 ? 0 : 1);
}
