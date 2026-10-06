// D106 端到端（标签建议＝V4 展开式面板：展开/前缀高亮/两源计数/↑↓ 激活/Enter 语义/Esc 收回/「回车新建」提示行）
// @runtime: node  @tier: 2  @gui: true  @id: D106TAGSUGGEST  @timeout: 300
// 运行：npm run build 之后 `node tests/d106.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d106-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9244";
const USER_DATA = path.join(ROOT, "tests", "tmp-d106-userdata");
const MARK_A = "FSRSTEST D106：甲卡题面？";

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

const typeInto = async (cdp, sel, text) => {
  await cdp.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return "NOINPUT"; i.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); return "SET"; })()`);
  await wait(400);
};
const panel = (cdp) => cdp.eval(`(() => { const p = document.querySelector(".tag-suggest-v4"); if (!p) return "{}"; const rows = [...p.querySelectorAll(".tag-suggest-row")]; return JSON.stringify({ open: true, rows: rows.length, first: rows[0]?.textContent ?? "", active: p.querySelector(".tag-suggest-row.active")?.textContent ?? "", hit: !!p.querySelector(".tag-suggest-hit"), empty: p.querySelector('[data-testid="tag-suggest-empty"]')?.textContent ?? "" }); })()`);

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d106.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cardA = /SEEDED ([0-9a-f-]{36})/.exec(String(seeded))?.[1] ?? "";
  check("播种成功", cardA.length === 36, seeded.slice(-120));

  const out = openSync(path.join(ROOT, "tests", "d106.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 复习页 → 显示答案 → ＋标签（V4 场景：复习页快捷打标入口）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "复习"); b?.click(); return "nav"; })()`);
  await wait(2200);
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return "revealed"; })()`);
  await wait(700);
  await cdp.eval(`(() => { document.querySelector('[data-testid="review-tag-add"]')?.click(); return "opened"; })()`);
  await wait(400);

  // 1) 纯聚焦不展开（输入框空 → 无面板）
  let p = await panel(cdp);
  check("纯聚焦不展开面板（输入 ≥1 字才开）", String(p) === "{}", p);

  // 2) 输入「脑」→ 面板展开：候选含前缀 accent 高亮 + 两源计数 meta
  await typeInto(cdp, '[data-testid="review-tags"] .tag-input-box input', "脑");
  p = await panel(cdp);
  check("输入「脑」面板展开", String(p).includes('"open":true'), p);
  check("三候选在场且前缀 accent 高亮（.tag-suggest-hit）", String(p).includes('"rows":3') && String(p).includes('"hit":true'), p);
  check("计数 meta 行（卡 1）在场", String(p).includes("卡 1"), p);
  check("首项不预选（↑↓ 前无 active 行——Enter 语义保持新建）", String(p).includes('"active":""'), p);

  // 3) Enter 默认确认输入原文（新建「脑」chip，不吞候选）
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return "enter"; })()`);
  await wait(300);
  const chipAfterEnter = await cdp.eval(`(() => { const chips = [...document.querySelectorAll('[data-testid="review-tags"] .tag-chip')].map((x) => x.textContent.trim()); return JSON.stringify(chips); })()`);
  // 甲卡静态 chips = [脑科学, 脑科学::记忆]；Enter 新建后追加草稿 chip「脑」——若 Enter 被候选接管，这里不会有「脑」
  check("Enter＝确认输入原文（草稿 chip「脑」追加、静态两枚原样）", String(chipAfterEnter) === JSON.stringify(["脑科学", "脑科学::记忆", "脑"]), chipAfterEnter);

  // 4) 再输「脑」→ ↓ 激活到「脑海」（词表 localeCompare 序首位；乙卡标签、不在甲卡——采纳才可判别）→ Enter 采纳
  await typeInto(cdp, '[data-testid="review-tags"] .tag-input-box input', "脑");
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); i.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); return "down"; })()`);
  await wait(200);
  p = await panel(cdp);
  check("↑↓ 激活后 active 行在场（accent 左缘语言）", String(p).includes('"active":"') && String(p).includes("脑海"), p);
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return "enter"; })()`);
  await wait(300);
  const chipAfterActive = await cdp.eval(`(() => { const chips = [...document.querySelectorAll('[data-testid="review-tags"] .tag-chip')].map((x) => x.textContent.trim()); return JSON.stringify(chips); })()`);
  check("激活后 Enter＝采纳候选「脑海」入草稿", String(chipAfterActive).includes("脑海"), chipAfterActive);

  // 5) 无候选输入 →「回车新建」提示行
  await typeInto(cdp, '[data-testid="review-tags"] .tag-input-box input', "完全不存在的标签xx");
  p = await panel(cdp);
  check("无候选显示「回车新建」提示行", String(p).includes("回车新建"), p);
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return "esc"; })()`);
  await wait(400);
  p = await panel(cdp);
  check("Esc 收回面板", String(p) === "{}", p);

  // 6) 保存落库（走既有链路：草稿 chips = [脑, 脑海]）
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="review-tag-apply"]'); b?.click(); return "saved"; })()`);
  await wait(800);
  const saved = await cdp.eval(`(async () => { const c = await window.cardsAPI.get(${JSON.stringify(cardA)}); return JSON.stringify(c.tags); })()`);
  check("快捷打标落库＝草稿两枚（脑 + 脑海；既有链路零变更）", String(saved).includes("脑") && String(saved).includes("脑海"), saved);

  console.log(`\n==== d106.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  process.exit(1);
}
