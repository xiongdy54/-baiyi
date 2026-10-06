// D105 端到端（筛选牌组条件构建器：标签/知识点条件 + 「知识点仅对闪卡」提示 + scope 落库 + 会话按条件过滤）
// @runtime: node  @tier: 2  @gui: true  @id: D105SCOPE  @timeout: 300
// 运行：npm run build 之后 `node tests/d105.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d105-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9243";
const USER_DATA = path.join(ROOT, "tests", "tmp-d105-userdata");
const TAG_MARK = "FSRSTEST D105：标签卡题面？";
const PLAIN_MARK = "FSRSTEST D105：无标签卡题面？";

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

const typeEnter = async (cdp, sel, text) => {
  await cdp.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return "NOINPUT"; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return "SET"; })()`);
  await wait(300);
};

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d105.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const ids = JSON.parse(/SEEDED (\{.*\})/.exec(String(seeded))?.[1] ?? "{}");
  check("播种成功（两卡 + KP）", !!ids.tagged && !!ids.plain && !!ids.kp, String(seeded).slice(-160));

  const out = openSync(path.join(ROOT, "tests", "d105.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(1800);

  // 1) 打开条件构建器 → 标签 chip
  check("条件构建器开关在场", (await cdp.eval(`(() => { const b = document.querySelector('[data-deck-builder-toggle]'); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`)) === "CLICKED", "无开关");
  await wait(400);
  const builder = await cdp.eval(`(() => JSON.stringify({ row: !!document.querySelector('[data-deck-builder]'), tagInput: !!document.querySelector('[data-deck-tags] .tag-input-box input'), kpBtn: !!document.querySelector('[data-deck-add-kp]'), bookBtn: !!document.querySelector('[data-deck-add-book]') }))()`);
  check("构建器行 + 标签输入 + ＋书/＋知识点 在场", String(builder).includes('"row":true') && String(builder).includes('"tagInput":true') && String(builder).includes('"kpBtn":true') && String(builder).includes('"bookBtn":true'), builder);
  await typeEnter(cdp, `[data-deck-tags] .tag-input-box input`, "考研");
  const chip = await cdp.eval(`(() => JSON.stringify({ chips: document.querySelectorAll('[data-deck-tags] .tag-chip').length }))()`);
  check("回车生成标签 chip", Number(/"chips":(\d+)/.exec(String(chip))?.[1] ?? 0) >= 1, chip);

  // 2) 知识点多选：检索（KnowledgeBase 口径）→ 勾选 → 「仅对闪卡生效」提示 → 移除
  await cdp.eval(`(() => { document.querySelector('[data-deck-add-kp]')?.click(); return "pop"; })()`);
  await wait(500);
  await typeEnter(cdp, `[data-deck-kp-search]`, "D105");
  await wait(800);
  const kpPick = await cdp.eval(`(() => { const rows = [...document.querySelectorAll('[data-deck-kp-pop] .cb-deck-pop-row')]; const hit = rows.find((r) => r.textContent.includes("D105 测试知识点")); if (!hit) return "NOHIT"; hit.querySelector('input').click(); return "PICKED"; })()`);
  await wait(400);
  const hint = await cdp.eval(`(() => JSON.stringify({ chip: !!document.querySelector('[data-deck-kp-chip]'), hint: document.querySelector('[data-deck-kp-hint]')?.textContent ?? "" }))()`);
  check("知识点候选经 KnowledgeBase 检索命中并勾选", kpPick === "PICKED", kpPick);
  check("知识点 chip 在场且「仅对闪卡生效」提示如实显示", String(hint).includes('"chip":true') && String(hint).includes("知识点条件仅对闪卡生效"), hint);
  await cdp.eval(`(() => { document.querySelector('[data-deck-kp-chip] .cb-deck-chip-x')?.click(); return "removed"; })()`);
  await wait(300);

  // 3) 保存 → scope 落库（tags=[考研]）→ 牌组 chip 显示「标签 1」
  await cdp.eval(`(() => { document.querySelector('[data-deck-save]')?.click(); return "saved"; })()`);
  await wait(600);
  const scopeVal = await cdp.eval(`(async () => { const scopes = await window.settingsAPI.get("app", "reviewScopes"); const s = (scopes ?? []).find((x) => (x.tags ?? []).includes("考研")); return JSON.stringify({ found: !!s, tags: s?.tags, kinds: s?.kinds }); })()`);
  check("scope 落库：tags=[考研]（从构建器转结构化）", String(scopeVal).includes('"found":true') && String(scopeVal).includes("考研"), scopeVal);
  const deckChip = await cdp.eval(`(() => { const b = document.querySelector('[data-deck-item] [data-deck-apply]'); return b ? b.textContent : "NONE"; })()`);
  check("已存牌组 chip 显示「标签 1」", String(deckChip).includes("标签 1"), deckChip);

  // 4) 会话过滤（db 级 e2e）：tags 条件只放行标签卡；kpIds 条件只放行持 KP 卡；无条件两卡都回
  const sessionRaw = String(await cdp.eval(`(async () => { const withTag = await window.sessionAPI.queue(undefined, { scope: { kinds: ["card"], tags: ["考研"] } }); const withKp = await window.sessionAPI.queue(undefined, { scope: { kinds: ["card"], kpIds: [${JSON.stringify(ids.kp)}] } }); const none = await window.sessionAPI.queue(undefined, { scope: { kinds: ["card"] } }); const front = (q) => q.items.map((it) => it.card?.noteText ?? "").join("|"); return JSON.stringify({ tag: front(withTag), kp: front(withKp), none: front(none) }); })()`));
  let session = { tag: "", kp: "", none: "" };
  try { session = JSON.parse(sessionRaw); } catch { /* 保持空态供断言报错 */ }
  check("会话按 tags 过滤：只回标签卡", session.tag.includes("标签卡") && !session.tag.includes("无标签卡"), sessionRaw);
  check("会话按 kpIds 过滤：只回持 KP 卡", session.kp.includes("标签卡") && !session.kp.includes("无标签卡"), sessionRaw);
  check("无条件 scope：两卡都回（不误伤）", session.none.includes("标签卡") && session.none.includes("无标签卡"), sessionRaw);

  // 5) 集中复习 e2e：按该 scope 进入复习页，队首是标签卡
  await cdp.eval(`(() => { document.querySelector('[data-deck-item] [data-deck-start]')?.click(); return "start"; })()`);
  await wait(2500);
  const review = await cdp.eval(`(() => JSON.stringify({ face: document.querySelector(".review-front")?.textContent ?? "", plain: document.body.textContent.includes(${JSON.stringify(PLAIN_MARK)}) }))()`);
  check("集中复习按 scope 过滤：队首为标签卡", String(review).includes(TAG_MARK.slice(8, 16)) || String(review).includes("标签卡"), review);
  check("未标记卡未进入会话", String(review).includes('"plain":false'), review);

  console.log(`\n==== d105.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  process.exit(1);
}
