// D107 端到端（标签功能总开关：关＝四处入口消失且数据原样；开＝恢复；设置往返）
// @runtime: node  @tier: 2  @gui: true  @id: D107TAGSSWITCH  @timeout: 300
// 运行：npm run build 之后 `node tests/d107.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d107-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9245";
const USER_DATA = path.join(ROOT, "tests", "tmp-d107-userdata");
const MARK = "FSRSTEST D107：题面？";

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
const setSwitch = (cdp, on) => cdp.eval(`(() => { const b = document.querySelector(${JSON.stringify(on ? "[data-tags-on]" : "[data-tags-off]")}); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`);

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d107.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cardId = /SEEDED ([0-9a-f-]{36})/.exec(String(seeded))?.[1] ?? "";
  check("播种成功", cardId.length === 36, seeded.slice(-120));

  const out = openSync(path.join(ROOT, "tests", "d107.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 1) 基线（开）：复习页答案后标签区在场
  await nav(cdp, "复习");
  await wait(2000);
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return "revealed"; })()`);
  await wait(700);
  let rev = await cdp.eval(`(() => JSON.stringify({ tags: !!document.querySelector('[data-testid="review-tags"]') }))()`);
  check("默认开：复习页标签区在场", String(rev).includes('"tags":true'), rev);

  // 2) 设置页关闭标签功能
  await cdp.eval(`(() => { document.querySelector('.topbar-right [title="设置"]')?.click(); return "opened"; })()`);
  await wait(1000);
  check("关闭开关可点", (await setSwitch(cdp, false)) === "CLICKED", "开关钮");
  await wait(500);
  const savedVal = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "tagsEnabled")))()`);
  check("落库 tagsEnabled=false（写侧归一不吞合法关）", String(savedVal).includes("false"), savedVal);
  await cdp.eval(`(() => { document.querySelector(".modal-close")?.click(); return "closed"; })()`);
  await wait(500);

  // 3) 复习页：标签区与 ＋标签 消失
  await nav(cdp, "复习");
  await wait(2000);
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return "revealed"; })()`);
  await wait(700);
  rev = await cdp.eval(`(() => JSON.stringify({ tags: !!document.querySelector('[data-testid="review-tags"]'), add: !!document.querySelector('[data-testid="review-tag-add"]') }))()`);
  check("关闭后复习页标签区不渲染", String(rev).includes('"tags":false'), rev);
  check("关闭后「＋标签」入口不渲染", String(rev).includes('"add":false'), rev);

  // 4) 卡片浏览器：详情标签区消失；批量条无打标签按钮；构建器无标签条件
  await nav(cdp, "卡片");
  await wait(1500);
  await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(MARK)})); tr?.click(); return "row"; })()`);
  await wait(900);
  let det = await cdp.eval(`(() => JSON.stringify({ tags: !!document.querySelector('[data-testid="card-detail-tags"]') }))()`);
  check("关闭后卡详情标签区不渲染", String(det).includes('"tags":false'), det);
  await cdp.eval(`(() => { document.querySelector(".modal-close")?.click(); return "closed"; })()`);
  await wait(400);
  // Ctrl+点击选中行 → 批量动作条出现
  await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(MARK)})); const r = tr.getBoundingClientRect(); window.__d107row = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; return "pos"; })()`);
  const pos = JSON.parse(String(await cdp.eval(`JSON.stringify(window.__d107row)`)));
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1, modifiers: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", buttons: 0, clickCount: 1, modifiers: 2 });
  await wait(600);
  const batch = await cdp.eval(`(() => JSON.stringify({ bar: !!document.querySelector("[data-batch-tag-add]"), barAny: !!document.querySelector("[data-batch-archive-cards]") }))()`);
  check("关闭后批量条无「打标签」（批量条本身在场）", String(batch).includes('"bar":false') && String(batch).includes('"barAny":true'), batch);
  await cdp.eval(`(() => { document.querySelector('[data-deck-builder-toggle]')?.click(); return "opened"; })()`);
  await wait(400);
  const builder = await cdp.eval(`(() => JSON.stringify({ tagRow: !!document.querySelector("[data-deck-tags]"), kpBtn: !!document.querySelector("[data-deck-add-kp]") }))()`);
  check("关闭后构建器无标签条件（知识点入口仍在）", String(builder).includes('"tagRow":false') && String(builder).includes('"kpBtn":true'), builder);

  // 5) 数据零改动：卡上标签原样保留
  const data = await cdp.eval(`(async () => JSON.stringify((await window.cardsAPI.get(${JSON.stringify(cardId)})).tags))()`);
  check("已存标签数据原样（tags_json 不动）", String(data).includes("脑科学"), data);

  // 6) 重开 → 复习页标签区恢复
  await cdp.eval(`(() => { document.querySelector('.topbar-right [title="设置"]')?.click(); return "opened"; })()`);
  await wait(1000);
  check("重开开关可点", (await setSwitch(cdp, true)) === "CLICKED", "开关钮");
  await wait(400);
  await cdp.eval(`(() => { document.querySelector(".modal-close")?.click(); return "closed"; })()`);
  await nav(cdp, "复习");
  await wait(2000);
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return "revealed"; })()`);
  await wait(700);
  rev = await cdp.eval(`(() => JSON.stringify({ tags: !!document.querySelector('[data-testid="review-tags"]'), chip: document.querySelector('[data-testid="review-tags"]')?.textContent ?? "" }))()`);
  check("重开后标签区恢复且既有标签 chip 可见", String(rev).includes('"tags":true') && String(rev).includes("脑科学"), rev);

  console.log(`\n==== d107.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  process.exit(1);
}
