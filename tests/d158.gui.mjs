// D158 端到端（方案条件作用于表格：多书并集 / 标签前缀 / 知识点归并族 / 摘录行 / 追加即时生效与取消恢复）
// @runtime: node  @tier: 2  @gui: true  @id: D158SCHEME  @timeout: 300
// 运行：npm run build 之后 `node tests/d158.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d158-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 夹具（tests/d158.gui.seed.cjs）：书 A/B/C；卡 A1[英语::词汇] A2[英语学] B1[英语] B2(无标签,持KP X) C1[英语]；
//   KP X 已归并入 Y；摘录 EA（书A,英语）EC（书C,英语）。G1–G7 断言见各段（OPUS 方案 v2 §8.5）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9258";
const USER_DATA = path.join(ROOT, "tests", "tmp-d158-userdata");

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
const nav = async (cdp, name) => {
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(name)}); b?.click(); return !!b; })()`);
  await wait(1600);
};
// 闪卡表行文本（卡表 = .cb-table 且非摘录表）
const cardRows = (cdp) => cdp.eval(`(() => JSON.stringify([...document.querySelectorAll(".cb-table:not([data-extract-table]) .cb-row:not(.cb-row-head)")].map((r) => r.textContent)))()`);
const hasRow = (rowsJson, mark) => {
  const rows = JSON.parse(String(rowsJson || "[]"));
  return { hit: rows.some((t) => t.includes(mark)), rows };
};
// 工具行「来源书」下拉选书
const pickBook = async (cdp, title) => {
  await cdp.eval(`(() => { document.querySelector('.cb-toolbar .dd-btn[title="按来源书筛选"]')?.click(); return "open"; })()`);
  await wait(400);
  const r = await cdp.eval(`(() => { const it = [...document.querySelectorAll(".dd-menu .dd-item")].find((x) => x.textContent.includes(${JSON.stringify(title)})); if (!it) return "NOITEM"; it.click(); return "PICKED"; })()`);
  await wait(400);
  return r;
};
// 确保方案弹层打开（已开则不动——保存后弹层自动打开，盲目 toggle 会把它关上）
const ensurePopup = async (cdp) => {
  await cdp.eval(`(() => { if (!document.querySelector("[data-scheme-menu]")) document.querySelector("[data-scheme-toggle]")?.click(); return "t"; })()`);
  await wait(400);
};
// 打开创建面板（确保弹层开 → 新建）
const openEditor = async (cdp) => {
  await ensurePopup(cdp);
  await cdp.eval(`(() => { document.querySelector("[data-scheme-new]")?.click(); return "n"; })()`);
  await wait(400);
};
// 确保构建器展开（打开面板时已有条件会自动展开——盲目 toggle 会把它合上）
const ensureBuilder = async (cdp) => {
  await cdp.eval(`(() => { if (!document.querySelector("[data-deck-builder]")) document.querySelector("[data-deck-builder-toggle]")?.click(); return "b"; })()`);
  await wait(400);
};
// 删除「当前生效」的方案（is-active 行；删非生效行不会退出方案）
const deleteActiveScheme = async (cdp) => {
  await cdp.eval(`(() => { document.querySelector("[data-deck-item].is-active [data-deck-delete]")?.click(); return "d"; })()`);
  await wait(800);
};

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d158.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const ids = JSON.parse(/SEEDED (\{.*\})/.exec(String(seeded))?.[1] ?? "{}");
  check("播种成功（三书 + 五卡 + KP 对 + 两摘录）", !!ids.a1 && !!ids.b2 && !!ids.kpY && !!ids.ea, String(seeded).slice(-200));

  const out = openSync(path.join(ROOT, "tests", "d158.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  await nav(cdp, "卡片");
  await wait(1200);

  // G7 基线：无方案条件下行集 = 全量五卡
  const base = await cardRows(cdp);
  const baseN = JSON.parse(String(base || "[]")).length;
  check("G7 基线：无方案条件时五卡全在", baseN === 5 && ["A1", "A2", "B1", "B2", "C1"].every((m) => hasRow(base, `D158 ${m}`).hit), base);

  // G1：来源书 A（下拉）+ 追加来源书 B → 表格 = A1/A2/B1/B2，不含 C1（回归点：v48.111 下 B1/B2 缺失）
  check("G1 选书A（下拉）", (await pickBook(cdp, "D158 书A")) === "PICKED", "PICKED");
  await openEditor(cdp);
  await ensureBuilder(cdp);
  await cdp.eval(`(() => { document.querySelector("[data-deck-add-book]")?.click(); return "pop"; })()`);
  await wait(400);
  const pickB = await cdp.eval(`(() => { const row = [...document.querySelectorAll("[data-deck-book-pop] .cb-deck-pop-row")].find((x) => x.textContent.includes("D158 书B")); if (!row) return "NOROW"; row.querySelector("input").click(); return "PICKED"; })()`);
  await wait(300);
  check("G1 追加来源书 B 勾选", pickB === "PICKED", pickB);
  await cdp.eval(`(() => { document.querySelector("[data-deck-save]")?.click(); return "s"; })()`);
  await wait(1500);
  const g1 = await cardRows(cdp);
  check("G1 表格含 A1/A2/B1/B2", ["A1", "A2", "B1", "B2"].every((m) => hasRow(g1, `D158 ${m}`).hit), g1);
  check("G1 表格不含 C1（书C 被方案排除）", !hasRow(g1, "D158 C1").hit, g1);

  // G2：再存一个方案（书 A+B 沿用当前状态 + 标签「英语」）→ 表格只含 A1/B1
  await openEditor(cdp);
  await typeEnter(cdp, "[data-deck-tags] .tag-input-box input", "英语");
  await wait(400);
  await cdp.eval(`(() => { document.querySelector("[data-deck-save]")?.click(); return "s"; })()`);
  await wait(1500);
  const g2 = await cardRows(cdp);
  check("G2 表格只含 A1/B1（标签前缀 + 多书 AND）", hasRow(g2, "D158 A1").hit && hasRow(g2, "D158 B1").hit && !hasRow(g2, "D158 A2").hit && !hasRow(g2, "D158 B2").hit && !hasRow(g2, "D158 C1").hit, g2);

  // G3：G2 状态切「摘录」页签 → 摘录表只含 EA；工具行显示「· 已改动」
  await cdp.eval(`(() => { document.querySelector("[data-kind-extract]")?.click(); return "k"; })()`);
  await wait(1000);
  const exRows = await cdp.eval(`(() => JSON.stringify([...document.querySelectorAll("[data-extract-table] .cb-row:not(.cb-row-head)")].map((r) => r.textContent)))()`);
  check("G3 摘录表只含 EA（书A+英语）", hasRow(exRows, "D158 摘录EA").hit && !hasRow(exRows, "D158 摘录EC").hit, exRows);
  const toggleTxt = await cdp.eval(`(() => document.querySelector("[data-scheme-toggle]")?.textContent || "")()`);
  check("G3 工具行标「· 已改动」（页签偏离方案）", String(toggleTxt).includes("已改动"), toggleTxt);

  // G4：删除当前方案 → 新建仅知识点 Y 的方案 → 闪卡表含 B2（归并族展开）；摘录表为空
  await cdp.eval(`(() => { document.querySelector("[data-kind-card]")?.click(); return "k"; })()`);
  await wait(800);
  await ensurePopup(cdp);
  await deleteActiveScheme(cdp);
  await openEditor(cdp);
  await ensureBuilder(cdp);
  await cdp.eval(`(() => { document.querySelector("[data-deck-add-kp]")?.click(); return "pop"; })()`);
  await wait(500);
  await typeEnter(cdp, "[data-deck-kp-search]", "D158 知识点Y");
  await wait(900);
  const pickY = await cdp.eval(`(() => { const row = [...document.querySelectorAll("[data-deck-kp-pop] .cb-deck-pop-row")].find((x) => x.textContent.includes("D158 知识点Y")); if (!row) return "NOROW"; row.querySelector("input").click(); return "PICKED"; })()`);
  await wait(300);
  check("G4 知识点 Y 勾选", pickY === "PICKED", pickY);
  await cdp.eval(`(() => { document.querySelector("[data-deck-save]")?.click(); return "s"; })()`);
  await wait(1800);
  const g4 = await cardRows(cdp);
  check("G4 闪卡表含 B2（kpId X ∈ 归并族{Y,X}）且不含 A1", hasRow(g4, "D158 B2").hit && !hasRow(g4, "D158 A1").hit, g4);
  await cdp.eval(`(() => { document.querySelector("[data-kind-extract]")?.click(); return "k"; })()`);
  await wait(1000);
  const g4ex = await cdp.eval(`(() => JSON.stringify([...document.querySelectorAll("[data-extract-table] .cb-row:not(.cb-row-head)")].map((r) => r.textContent)))()`);
  check("G4 含知识点方案 → 摘录表为空（仅行内提示）", !String(g4ex).includes("D158 摘录EA") && !String(g4ex).includes("D158 摘录EC"), g4ex);

  // G5：退出 → 无方案时创建面板追加标签「英语」→ 行数立即减少；取消后恢复
  await cdp.eval(`(() => { document.querySelector("[data-kind-card]")?.click(); return "k"; })()`);
  await wait(800);
  await ensurePopup(cdp);
  await deleteActiveScheme(cdp);
  await openEditor(cdp);
  await ensureBuilder(cdp);
  await typeEnter(cdp, "[data-deck-tags] .tag-input-box input", "英语");
  await wait(600);
  const g5 = await cardRows(cdp);
  const g5n = JSON.parse(String(g5 || "[]")).length;
  check("G5 追加标签即时作用（行数 5→3：A1/B1/C1）", g5n === 3 && ["A1", "B1", "C1"].every((m) => hasRow(g5, `D158 ${m}`).hit), `${g5n} 行: ${g5}`);
  await cdp.eval(`(() => { document.querySelector("[data-scheme-cancel]")?.click(); return "c"; })()`);
  await wait(800);
  const g5r = await cardRows(cdp);
  check("G5 取消后行数恢复全量", JSON.parse(String(g5r || "[]")).length === baseN, g5r);

  // G6：任一方案生效（书A+标签英语）→「退出方案」→ 表格恢复全量
  await openEditor(cdp);
  await ensureBuilder(cdp);
  await typeEnter(cdp, "[data-deck-tags] .tag-input-box input", "英语");
  await wait(400);
  await cdp.eval(`(() => { document.querySelector("[data-deck-save]")?.click(); return "s"; })()`);
  await wait(1500);
  const g6narrow = JSON.parse(String(await cardRows(cdp) || "[]")).length;
  check("G6 方案生效时行集收窄（3 行）", g6narrow === 3, g6narrow);
  await cdp.eval(`(() => { document.querySelector("[data-scheme-exit]")?.click(); return "e"; })()`);
  await wait(800);
  const g6 = await cardRows(cdp);
  const afterExit = await cdp.eval(`(() => document.querySelector("[data-scheme-toggle]")?.textContent.trim() || "")()`);
  check("G6 退出方案后表格恢复全量", JSON.parse(String(g6 || "[]")).length === baseN, g6);
  check("G6 工具行恢复「筛选方案 N」", String(afterExit).startsWith("筛选方案"), afterExit);

  // G7 收尾：与开基线一致（无任何方案条件 ⇒ 与 v48.111 行集相同）
  const g7 = await cardRows(cdp);
  check("G7 终态与基线一致", JSON.parse(String(g7 || "[]")).length === baseN, g7);

  console.log(`\n==== d158.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("D158 GUI FAIL:", e?.message || e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(1);
}
