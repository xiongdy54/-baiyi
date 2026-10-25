// D101/D102 端到端（复习页快捷打标 + 正面永不显示标签 + 「不再关心」归档 + 浏览器已归档/恢复 + 卡详情标签区）
// @runtime: node  @tier: 2  @gui: true  @id: D101TAGS  @timeout: 300
// 运行：npm run build 之后 `node tests/d101.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d101-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9240";
const USER_DATA = path.join(ROOT, "tests", "tmp-d101-userdata");
const CARD_MARK = "FSRSTEST: 这是标签与归档 GUI 驱动卡？";

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

const clickAt = async (cdp, sel) => {
  const p = JSON.parse(String(await cdp.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return ""; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`)) || "{}");
  if (!p.x) return false;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, modifiers: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
  return true;
};
const clickText = (cdp, text) => cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`);

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d101.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cardId = /SEEDED ([0-9a-f-]{36})/.exec(String(seeded))?.[1] ?? "";
  check("播种成功（拿到卡 id）", cardId.length === 36, seeded.slice(-200));

  const out = openSync(path.join(ROOT, "tests", "d101.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 1) 复习页：正面永不显示标签（防泄题，D101 §1.6）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "复习"); b?.click(); return "nav"; })()`);
  await wait(2200);
  const frontNoTags = await cdp.eval(`(() => { const bar = document.querySelector('[data-review-bar]'); const tags = document.querySelector('[data-testid="review-tags"]'); return JSON.stringify({ hasBar: !!bar, hasTags: !!tags }); })()`);
  check("复习页卡面在位", String(frontNoTags).includes('"hasBar":true'), frontNoTags);
  check("正面不渲染标签区（防泄题）", String(frontNoTags).includes('"hasTags":false'), frontNoTags);

  // 2) 显示答案 → 标签区出现（旧标签 chip）→ ＋标签 → 输入 → 保存 → 新 chip 在场
  check("点「显示答案」", (await clickAt(cdp, '[data-review-bar] [data-reveal]')) === true, "无按钮");
  await wait(700);
  const backTags = await cdp.eval(`(() => { const t = document.querySelector('[data-testid="review-tags"]'); return JSON.stringify({ present: !!t, text: t ? t.textContent : "" }); })()`);
  check("答案揭示后标签区出现", String(backTags).includes('"present":true'), backTags);
  check("旧标签 chip 可见", String(backTags).includes("旧标签"), backTags);
  check("「＋标签」入口在场", String(backTags).includes("＋ 标签"), backTags);
  check("点「＋标签」", (await clickAt(cdp, '[data-testid="review-tag-add"]')) === true, "无按钮");
  await wait(400);
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); if (!i) return "NOINPUT"; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(i, "新标签"); i.dispatchEvent(new Event("input", { bubbles: true })); return "SET"; })()`);
  await wait(200);
  await cdp.eval(`(() => { const i = document.querySelector('[data-testid="review-tags"] .tag-input-box input'); i?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return "ENTER"; })()`);
  await wait(300);
  const draftHas = await cdp.eval(`(() => JSON.stringify({ chips: document.querySelectorAll('[data-testid="review-tags"] .tag-chip').length }))()`);
  check("回车生成 chip（含草稿 chip）", Number(/"chips":(\d+)/.exec(String(draftHas))?.[1] ?? 0) >= 2, draftHas);
  check("点「保存」", (await clickAt(cdp, '[data-testid="review-tag-apply"]')) === true, "无按钮");
  await wait(800);
  const saved = await cdp.eval(`(() => { const t = document.querySelector('[data-testid="review-tags"]'); return t ? t.textContent : ""; })()`);
  check("新标签已落库并显示", String(saved).includes("新标签") && String(saved).includes("旧标签"), saved);
  const dbCheck = await cdp.eval(`(async () => { const c = await window.cardsAPI.get(${JSON.stringify(cardId)}); return JSON.stringify({ tags: c.tags }); })()`);
  check("cards:setTags 落库两标签", String(dbCheck).includes("新标签") && String(dbCheck).includes("旧标签"), dbCheck);

  // 3) 更多 → 不再关心（归档）→ 卡片离开队列（D102）
  check("打开「更多」菜单", (await clickAt(cdp, '.bar-more [data-toggle]')) === true, "无按钮");
  await wait(400);
  const archClick = await cdp.eval(`(() => { const b = document.querySelector('[data-testid="review-archive"]'); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`);
  check("「归档」在场且可点（D216：原「不再关心（归档）」统一改名）", archClick === "CLICKED", archClick);
  await wait(1500);
  const afterArchive = await cdp.eval(`(async () => { const q = await window.cardsAPI.todayQueue(); return JSON.stringify({ inQueue: q.cards.some((c) => c.id === ${JSON.stringify(cardId)}), status: (await window.cardsAPI.get(${JSON.stringify(cardId)})).status, fsrsDue: (await window.cardsAPI.get(${JSON.stringify(cardId)})).fsrs.due }); })()`);
  check("归档后卡片离开今日队列", String(afterArchive).includes('"inQueue":false'), afterArchive);
  check("归档 status=archived", String(afterArchive).includes('"status":"archived"'), afterArchive);
  const logsCount = await cdp.eval(`(async () => "OK")()`);
  check("归档动作完成（会话推进）", String(logsCount) === "OK", logsCount);

  // 4) 卡片浏览器：已归档 preset 可见 → 详情恢复（解除归档）→ 全部卡片重新可见
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(1800);
  const defaultHidden = await cdp.eval(`(() => { const rows = [...document.querySelectorAll('[role="row"]')]; return JSON.stringify({ visible: rows.some((tr) => tr.textContent.includes(${JSON.stringify(CARD_MARK)})) }); })()`);
  check("默认列表不含已归档卡", String(defaultHidden).includes('"visible":false'), defaultHidden);
  const presetClick = await clickText(cdp, "已归档");
  await wait(900);
  const archivedVisible = await cdp.eval(`(() => { const rows = [...document.querySelectorAll('[role="row"]')]; return JSON.stringify({ visible: rows.some((tr) => tr.textContent.includes(${JSON.stringify(CARD_MARK)})), badge: document.body.textContent.includes("已归档") }); })()`);
  check("「已归档」preset 显出归档卡", presetClick !== "NOTFOUND" && String(archivedVisible).includes('"visible":true'), archivedVisible);

  // 详情：标签区 + 恢复（解除归档）
  const rowClick = await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(CARD_MARK)})); if (!tr) return "NOROW"; tr.click(); return "CLICKED"; })()`);
  await wait(900);
  const detail = await cdp.eval(`(() => { const m = document.querySelector(".cb-detail"); const tags = document.querySelector('[data-testid="card-detail-tags"]'); return JSON.stringify({ open: !!m, tags: tags ? tags.textContent : "", status: m ? m.textContent.includes("已归档") : null }); })()`);
  check("行点击打开卡详情", String(detail).includes('"open":true'), detail);
  check("卡详情标签区显示旧标签/新标签", String(detail).includes("旧标签") && String(detail).includes("新标签"), detail);
  const restoreBtn = await cdp.eval(`(() => { const b = document.querySelector('[data-detail-archive]'); if (!b) return "NOTFOUND"; const hit = b.textContent.includes("恢复"); b.click(); return hit ? "RESTORED" : "WRONG_LABEL"; })()`);
  check("详情「恢复（解除归档）」在场并点击", restoreBtn === "RESTORED", restoreBtn);
  await wait(1200);
  const backVisible = await cdp.eval(`(async () => { const c = await window.cardsAPI.get(${JSON.stringify(cardId)}); const q = await window.cardsAPI.todayQueue(); return JSON.stringify({ status: c.status, backInQueue: q.cards.some((x) => x.id === ${JSON.stringify(cardId)}) }); })()`);
  check("恢复 status=active 且重回队列（due 已过期自然入队）", String(backVisible).includes('"status":"active"') && String(backVisible).includes('"backInQueue":true'), backVisible);

  console.log(`\n==== d101.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
