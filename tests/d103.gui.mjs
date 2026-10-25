// D103 端到端（卡详情：生成信息区 / 血缘树「查看卡片」/ 同源组 / 无锚空态 / 重新生成入口）
// @runtime: node  @tier: 2  @gui: true  @id: D103LINEAGE  @timeout: 300
// 运行：npm run build 之后 `node tests/d103.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d103-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9241";
const USER_DATA = path.join(ROOT, "tests", "tmp-d103-userdata");
const AI_MARK = "FSRSTEST D103：光反应的场所是？";
const SIB_MARK = "FSRSTEST D103：光反应的原料是？";
const NOANCHOR_MARK = "FSRSTEST D103：无锚卡题面？";

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

const clickText = (cdp, text) => cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`);
const openDetail = async (cdp, mark) => {
  await cdp.eval(`(() => { const tr = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes(${JSON.stringify(mark)})); if (!tr) return "NOROW"; tr.click(); return "CLICKED"; })()`);
  await wait(900);
};

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/d103.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const ids = JSON.parse(/SEEDED (\{.*\})/.exec(String(seeded))?.[1] ?? "{}");
  check("播种成功（AI 卡 + 同源卡 + 无锚卡）", !!ids.ai && !!ids.sib && !!ids.manualNoAnchor, String(seeded).slice(-200));

  const out = openSync(path.join(ROOT, "tests", "d103.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 卡片浏览器 → 打开 AI 卡详情
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(1800);
  await openDetail(cdp, AI_MARK);
  const detail = await cdp.eval(`(() => { const m = document.querySelector(".modal-panel"); return JSON.stringify({ open: !!m, text: m ? m.textContent.slice(0, 2000) : "" }); })()`);
  check("AI 卡详情打开", String(detail).includes('"open":true'), detail);

  // 1) 生成信息区：批次时间 + 模型快照 + 提示词 + 当时质检 + 重新生成入口
  const gen = await cdp.eval(`(() => { const g = document.querySelector('[data-testid="card-detail-geninfo"]'); if (!g) return "{}"; return JSON.stringify({ batch: document.querySelector('[data-testid="geninfo-batch"]')?.textContent ?? "", tpl: document.querySelector('[data-testid="geninfo-template"]')?.textContent ?? "", lint: document.querySelector('[data-testid="geninfo-lint"]')?.textContent ?? "", regen: !!document.querySelector('[data-testid="regen-cards"]') }); })()`);
  check("生成信息区在场", String(gen).includes("batch"), gen);
  check("批次行含模型快照 glm-test-model", String(gen).includes("glm-test-model"), gen);
  check("提示词行含 scope card-generation", String(gen).includes("card-generation"), gen);
  check("当时质检行含 L17 提示计数", String(gen).includes("1 条"), gen);
  check("「用当前提示词重新生成」按钮在场（AI 卡 + 有锚）", String(gen).includes('"regen":true'), gen);

  // 2) 血缘树：祖先链 + 本卡高亮 + D85 聚合计数
  const lin = await cdp.eval(`(() => { const l = document.querySelector('[data-testid="card-detail-lineage"]'); if (!l) return "{}"; const items = [...l.querySelectorAll(".cb-lineage-item")]; return JSON.stringify({ ids: items.length, rootText: items[0]?.textContent ?? "", current: l.querySelector(".cb-lineage-item.current")?.textContent ?? "", currentN: l.querySelectorAll(".cb-lineage-item.current").length }); })()`);
  check("血缘树区块在场", String(lin).includes('"ids"'), lin);
  check("祖先链含根摘录首行", String(lin).includes("根摘录：光合作用的第一行"), lin);
  check("本卡节点高亮且唯一", String(lin).includes('"currentN":1') && String(lin).includes("子摘录：光反应发生在类囊体"), lin);
  check("根节点聚合计数 = 2（D85 口径：子摘录两卡）", /根摘录[^]*?2/.test(String(lin).replace(/\\n/g, "")) || String(lin).includes("2"), lin);

  // 3) 「查看卡片」→ 锚点筛选条就地出现 + 详情关闭；清除后回落
  const viewClick = await cdp.eval(`(() => { const b = document.querySelector('[data-testid="card-detail-lineage"] [data-testid="lineage-view-cards"]'); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`);
  await wait(700);
  const anchorBar = await cdp.eval(`(() => JSON.stringify({ bar: !!document.querySelector('[data-anchor-filter-bar]'), count: document.querySelector('[data-anchor-filter-count]')?.textContent ?? "", detailClosed: !document.querySelector('[data-testid="card-detail-geninfo"]') }))()`);
  check("「查看卡片」点击成功", viewClick === "CLICKED", viewClick);
  check("锚点筛选条出现且计数 2 张（含全部子层级）", String(anchorBar).includes('"bar":true') && String(anchorBar).includes("已制卡 2"), anchorBar);
  check("打开锚点筛选时详情已关闭", String(anchorBar).includes('"detailClosed":true'), anchorBar);
  check("清除锚点筛选", (await clickText(cdp, "清除")) === "CLICKED", "清除钮");
  await wait(500);

  // 4) 同源组：两条同源卡 + 本卡高亮；点兄弟行切换详情
  await openDetail(cdp, AI_MARK);
  const sib = await cdp.eval(`(() => { const s = document.querySelector('[data-testid="card-detail-sibling"]'); if (!s) return "{}"; return JSON.stringify({ rows: s.querySelectorAll('[data-testid="sibling-row"]').length, current: s.querySelectorAll(".cb-sibling-item.current").length, text: s.textContent }); })()`);
  check("同源组区块在场且两行", String(sib).includes('"rows":2'), sib);
  check("本卡行高亮唯一", String(sib).includes('"current":1'), sib);
  check("组内含兄弟卡题面", String(sib).includes("光反应的原料是"), sib);
  const switchClick = await cdp.eval(`(() => { const rows = [...document.querySelectorAll('[data-testid="sibling-row"]')]; const other = rows.find((r) => !r.className.includes("current")); if (!other) return "NOTFOUND"; other.click(); return "CLICKED"; })()`);
  await wait(700);
  const switched = await cdp.eval(`(() => { const m = document.querySelector(".modal-panel"); return m ? (m.textContent.includes(${JSON.stringify(SIB_MARK)}) ? "SWITCHED" : "WRONG") : "CLOSED"; })()`);
  check("点兄弟行切换到该卡详情", switchClick === "CLICKED" && switched === "SWITCHED", switched);

  // 5) 手动卡：无生成信息区 / 无重新生成；无锚卡：空态「无来源锚」
  const manualGen = await cdp.eval(`(() => JSON.stringify({ gen: !!document.querySelector('[data-testid="card-detail-geninfo"]'), lineage: !!document.querySelector('[data-testid="card-detail-lineage"]'), empty: document.querySelector('[data-testid="card-detail-lineage-empty"]')?.textContent ?? "" }))()`);
  check("手动卡无生成信息区", String(manualGen).includes('"gen":false'), manualGen);
  await cdp.eval(`(() => { const b = document.querySelector(".modal-close"); b?.click(); return "closed"; })()`);
  await wait(500);
  await openDetail(cdp, NOANCHOR_MARK);
  const noAnchor = await cdp.eval(`(() => JSON.stringify({ empty: document.querySelector('[data-testid="card-detail-lineage-empty"]')?.textContent ?? "", gen: !!document.querySelector('[data-testid="card-detail-geninfo"]') }))()`);
  check("无锚卡显示「无来源锚」空态", String(noAnchor).includes("无来源锚"), noAnchor);
  check("无锚卡无生成信息区（AI 卡判定先行）", String(noAnchor).includes('"gen":false'), noAnchor);
  await cdp.eval(`(() => { const b = document.querySelector(".modal-close"); b?.click(); return "closed"; })()`);
  await wait(400);

  // 6) 重新生成：无 AI Key → 面板打开并如实报错，零新建卡
  await openDetail(cdp, AI_MARK);
  check("点「用当前提示词重新生成」", (await cdp.eval(`(() => { const b = document.querySelector('[data-testid="regen-cards"]'); if (!b) return "NOTFOUND"; b.click(); return "CLICKED"; })()`)) === "CLICKED", "无按钮");
  await wait(6000);
  const regen = await cdp.eval(`(() => { const m = [...document.querySelectorAll(".modal-panel")].find((x) => x.getAttribute("aria-label") === "用当前提示词重新生成"); if (!m) return "{}"; return JSON.stringify({ open: true, err: !!m.querySelector(".ai-draft-warnings"), errText: m.querySelector(".ai-draft-warnings")?.textContent ?? "" }); })()`);
  check("重新生成面板打开", String(regen).includes('"open":true'), regen);
  check("无 Key 如实报错（AI 服务尚未配置）", String(regen).includes('"err":true') && String(regen).includes("AI 服务尚未配置"), regen);
  await cdp.eval(`(() => { const m = [...document.querySelectorAll(".modal-panel")].find((x) => x.getAttribute("aria-label") === "用当前提示词重新生成"); m?.querySelector(".modal-close")?.click(); return "closed"; })()`);
  await wait(500);
  const noNewCards = await cdp.eval(`(async () => { const all = await window.cardsAPI.listAll(); return JSON.stringify({ count: all.filter((c) => c.noteText.startsWith("FSRSTEST")).length }); })()`);
  check("重新生成失败零新建卡（原卡原样）", String(noNewCards).includes('"count":3'), noNewCards);

  console.log(`\n==== d103.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
