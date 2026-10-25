// D104 端到端（卡面信息密度三开关：复习背面 + 卡详情预览同生效；开关不改卡内数据）
// @runtime: node  @tier: 2  @gui: true  @id: D104EXTRAS  @timeout: 300
// 运行：npm run build 之后 `node tests/d104.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d104-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9242";
const USER_DATA = path.join(ROOT, "tests", "tmp-d104-userdata");
const MARK = "FSRSTEST D104：这张卡考什么？";

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

const nav = (cdp, label) => cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return "nav"; })()`);
const reveal = async (cdp) => {
  await cdp.eval(`(() => { const b = document.querySelector('[data-review-bar] [data-reveal]'); b?.click(); return "revealed"; })()`);
  await wait(700);
};
const extrasState = (cdp) => cdp.eval(`(() => { const w = document.querySelector('[data-testid="card-face-extras"]'); return JSON.stringify({ block: !!w, m: !!document.querySelector('[data-testid="card-extra-mnemonic"]'), e: !!document.querySelector('[data-testid="card-extra-example"]'), s: !!document.querySelector('[data-testid="card-extra-sourceRef"]') }); })()`);

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d104.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cardId = /SEEDED ([0-9a-f-]{36})/.exec(String(seeded))?.[1] ?? "";
  check("播种成功", cardId.length === 36, seeded.slice(-120));

  const out = openSync(path.join(ROOT, "tests", "d104.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 1) 复习页背面：三块全渲染（默认全开）
  await nav(cdp, "复习");
  await wait(2000);
  await reveal(cdp);
  let st = await extrasState(cdp);
  check("默认全开：复习背面三块全渲染", String(st).includes('"m":true') && String(st).includes('"e":true') && String(st).includes('"s":true'), st);

  // 2) 卡详情预览：同一组件同生效
  await nav(cdp, "卡片");
  await wait(1500);
  await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(MARK)})); tr?.click(); return "row"; })()`);
  await wait(900);
  let stDetail = await extrasState(cdp);
  check("默认全开：卡详情三块全渲染（同一组件继承）", String(stDetail).includes('"m":true') && String(stDetail).includes('"s":true'), stDetail);
  await cdp.eval(`(() => { document.querySelector('[data-testid="card-detail-close"]')?.click(); return "closed"; })()`);
  await wait(400);

  // 3) 设置页关掉 助记/例子（来源保留）——设置是顶栏图标按钮弹出的模态
  await cdp.eval(`(() => { const b = document.querySelector('.topbar-right [title="设置"]'); b?.click(); return "opened"; })()`);
  await wait(1200);
  const uncheck = await cdp.eval(`(() => { const m = document.querySelector('[data-cf-mnemonic]'); const e = document.querySelector('[data-cf-example]'); if (!m || !e) return "NOTFOUND"; if (m.checked) m.click(); if (e.checked) e.click(); return JSON.stringify({ m: m.checked, e: e.checked }); })()`);
  check("设置页三开关在场且可关", String(uncheck).includes('"m":false') && String(uncheck).includes('"e":false'), uncheck);
  await wait(500);
  const savedVal = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "cardFaceExtras")))()`);
  check("设置落库 {mnemonic:false, example:false, sourceRef:true}（写侧归一不吞合法关）",
    String(savedVal).includes('"mnemonic":false') && String(savedVal).includes('"example":false') && String(savedVal).includes('"sourceRef":true'), savedVal);

  // 4) 复习页背面：助记/例子块消失、来源块保留（视图切换即重挂载重读设置）
  await nav(cdp, "复习");
  await wait(2000);
  await reveal(cdp);
  st = await extrasState(cdp);
  check("关闭后复习背面：助记块不渲染", String(st).includes('"m":false'), st);
  check("关闭后复习背面：例子块不渲染", String(st).includes('"e":false'), st);
  check("关闭后复习背面：来源块保留", String(st).includes('"s":true'), st);

  // 5) 卡详情：同生效；卡内数据零改动
  await nav(cdp, "卡片");
  await wait(1500);
  await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(MARK)})); tr?.click(); return "row"; })()`);
  await wait(900);
  stDetail = await extrasState(cdp);
  check("关闭后卡详情：助记/例子不渲染、来源保留", String(stDetail).includes('"m":false') && String(stDetail).includes('"e":false') && String(stDetail).includes('"s":true'), stDetail);
  const cardIntact = await cdp.eval(`(async () => { const c = await window.cardsAPI.get(${JSON.stringify(cardId)}); return JSON.stringify({ m: c.mnemonic, e: c.example, s: c.sourceRef && c.sourceRef.title }); })()`);
  check("开关不改卡内数据（mnemonic/example/sourceRef 原样）",
    String(cardIntact).includes("联想：密度开关拨一拨") && String(cardIntact).includes("例句：把不需要的字段关掉。") && String(cardIntact).includes("D104 夹具书"), cardIntact);

  console.log(`\n==== d104.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
