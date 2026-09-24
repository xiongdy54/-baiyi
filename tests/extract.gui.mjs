// M16 摘录复习页 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/extract.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-extract-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§6.8 验收）：预播种一条到期摘录 → 顶栏「摘录」进入沉浸式页 → 卡面/正文/动作可见 →
//   正文就地编辑落库 → 下一条（读后推进 interval ×1.6 且不再出现）→ 撤销回退 → 推迟 N 天 → 毕业后不再推送
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-extract-userdata");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
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
  // 1) 预播种（独立进程建库 + 造一条已到期摘录）
  execSync("npx electron tests/extract.gui.seed.cjs", {
    cwd: ROOT, shell: true, stdio: "ignore",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  // 2) 启动真实应用（同一 userData）
  const out = openSync(path.join(ROOT, "tests", "extract.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);

  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 3) 顶栏「摘录」进入沉浸式页（原「队列」项，D58/O-6 改名）
  const navLabel = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return b ? b.textContent.trim() : null; })()`);
  check("顶栏存在「摘录」项（队列项已改名）", navLabel === "摘录", navLabel);
  await wait(1500);

  const face = await cdp.eval(`document.querySelector(".extract-face")?.textContent || ""`);
  check("沉浸式摘录页渲染出卡面", face.includes("GUI 摘录样本"), face.slice(0, 120));
  check("卡面显示来源书名", face.includes("GUI 摘录测试书"), face.slice(0, 120));
  check("动作齐全（下一条/推迟/毕业/打开摘录/跳转原文）", ["下一条", "推迟", "毕业", "打开摘录", "跳转原文"].every((t) => face.includes(t)), face.slice(0, 200));
  check("正文可编辑（EditableText 裸壳在位）", (await cdp.eval(`!!document.querySelector(".extract-face .review-editable")`)) === true, "无 .review-editable");

  // 4) 正文就地编辑 → 落库
  await cdp.eval(`(() => { const el = document.querySelector(".extract-face .review-editable"); el.focus(); el.innerText = "GUI 摘录样本（已编辑）"; el.blur(); return true; })()`);
  await wait(1200);
  const edited = await cdp.eval(`(async () => { const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } }); return q.extracts[0]?.contentMarkdown || ""; })()`);
  check("正文编辑落库（摘录内容已更新）", String(edited).includes("已编辑"), edited);

  // 5) 下一条 = 读后推进（interval ×1.6），且不再出现
  const before = await cdp.eval(`(async () => { const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } }); const e = q.extracts[0]; return JSON.stringify({ id: e?.id, ivl: e?.intervalDays, pc: e?.processCount }); })()`);
  const b = JSON.parse(before || "{}");
  await cdp.eval(`(() => { const btn = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "下一条"); btn?.click(); return !!btn; })()`);
  await wait(1500);
  const after = await cdp.eval(`(async () => { const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } }); const e = q.extracts[0]; const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return JSON.stringify({ remaining: q.extracts.length, ivl: d?.intervalDays, pc: d?.processCount }); })()`);
  const a = JSON.parse(after || "{}");
  check("推进后本条不再在到期队列", a.remaining === 0, after);
  check("interval = 1 × 1.6（SM 语义）", Math.abs(Number(a.ivl) - 1.6) < 1e-9, a.ivl);
  check("process_count 递增", Number(a.pc) === 1, a.pc);
  check("空态出现（0 条待处理）", String(await cdp.eval(`document.querySelector(".extract-page")?.textContent || ""`)).includes("0 条待处理"), "空态未出现");

  // 6) 撤销（空态路径：处理完最后一条后撤销入口必须仍在）
  const undoClicked = await cdp.eval(`(() => { const btn = document.querySelector("[data-undo-empty]"); btn?.click(); return !!btn; })()`);
  check("空态仍有撤销入口（需求：Ctrl+Z 必须配置好）", undoClicked === true, undoClicked);
  await wait(1800);
  const undone = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return JSON.stringify({ ivl: d?.intervalDays, pc: d?.processCount }); })()`);
  const u = JSON.parse(undone || "{}");
  check("撤销回退：interval 复原", Math.abs(Number(u.ivl) - 1) < 1e-9, u.ivl);
  check("撤销回退：process_count 复原", Number(u.pc) === 0, u.pc);
  check("撤销后卡面重新出现（队列已刷新）", (await cdp.eval(`!!document.querySelector(".extract-face")`)) === true, "未出现");

  // 7) 推迟 N 天（用「快捷推迟 3 天」）→ 状态 postponed
  const postponeClicked = await cdp.eval(`(() => { const btn = [...document.querySelectorAll(".extract-face-hints button")].find((x) => x.textContent.includes("3 天")); btn?.click(); return !!btn; })()`);
  check("快捷推迟按钮在位可点", postponeClicked === true, postponeClicked);
  await wait(1600);
  const postponed = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return JSON.stringify({ ivl: d?.intervalDays, status: d?.status, pc: d?.postponeCount }); })()`);
  const p = JSON.parse(postponed || "{}");
  check("显式推迟：interval = 3（覆盖式）", Number(p.ivl) === 3, p.ivl);
  check("显式推迟：状态 postponed", p.status === "postponed", p.status);
  check("显式推迟：postpone_count++", Number(p.pc) === 1, p.pc);

  // 8) 撤销推迟（把条目召回队列）→ 毕业 → 不再推送但行仍保留
  const recall = await cdp.eval(`(() => { const btn = document.querySelector("[data-undo-empty]"); btn?.click(); return !!btn; })()`);
  check("撤销推迟后条目回到队列", recall === true, recall);
  await wait(1800);
  check("召回后卡面重新出现", (await cdp.eval(`!!document.querySelector(".extract-face")`)) === true, "未出现");
  const gradClicked = await cdp.eval(`(() => { const btn = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "毕业"); btn?.click(); return !!btn; })()`);
  check("毕业按钮在位可点", gradClicked === true, gradClicked);
  await wait(1600);
  const grad = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } }); return JSON.stringify({ status: d?.status, remaining: q.extracts.length }); })()`);
  const g = JSON.parse(grad || "{}");
  check("毕业：状态 resolved", g.status === "resolved", g.status);
  check("毕业：不再进到期队列", Number(g.remaining) === 0, g.remaining);
  const stillThere = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return !!d; })()`);
  check("毕业：行仍保留（不删不归档）", stillThere === true, stillThere);

  // 9) 设置页：摘录复习区块 + 每日上限区块（硬边界经真实 UI 拒存）
  await cdp.eval(`(() => { const b = document.querySelector('button[title="设置"]'); b?.click(); return !!b; })()`);
  await wait(1500);
  const secs = await cdp.eval(`JSON.stringify({ ex: !!document.querySelector("#sec-extracts"), lim: !!document.querySelector("#sec-limits") })`);
  const so = JSON.parse(secs || "{}");
  check("设置页存在「摘录复习」区块", so.ex === true, secs);
  check("设置页存在「每日上限」区块", so.lim === true, secs);

  // 开启「并入复习队列」→ 落盘可见
  await cdp.eval(`(() => { const s = document.querySelector("#sec-extracts"); const b = [...s.querySelectorAll("button")].find((x) => x.textContent.trim() === "开"); b?.click(); return !!b; })()`);
  await wait(1200);
  const savedMerge = await cdp.eval(`(async () => { const v = await window.settingsAPI.get("app", "extracts"); return JSON.stringify(v || {}); })()`);
  check("并入复习队列开关落盘（mergeIntoReview=true）", String(savedMerge).includes('"mergeIntoReview":true'), savedMerge);

  // 硬边界：把复习上限设成 1（新卡上限默认 20 ⇒ 1 < 20×5）→ 必须被拒且不落盘
  const setNum = (idx, val) => `(() => {
    const s = document.querySelector("#sec-limits");
    const inp = s.querySelectorAll('input[type="number"]')[${idx}];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "${val}");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return !!inp;
  })()`;
  // 先设一个合法组合：新卡 20 / 复习 200（默认值即是）
  await cdp.eval(setNum(0, "20"));
  await wait(1000);
  const limitsBefore = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "limits") || {}))()`);
  // 再把复习上限改成 1（< 新卡上限 20 的 5 倍）→ 必须被拒且不落盘
  await cdp.eval(setNum(1, "1"));
  await wait(1500);
  const limitsAfter = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "limits") || {}))()`);
  const errText = await cdp.eval(`document.querySelector("#sec-limits .ai-test-err")?.textContent || ""`);
  check("硬边界：违规值被拒且未落盘", limitsBefore === limitsAfter, `before=${limitsBefore} after=${limitsAfter}`);
  check("硬边界：就地给出解释文案", String(errText).includes("5 倍"), errText);

  // 10) 卡片浏览器 2.0（§6.8-6）：统一数据源 + 摘录表 + 多选/全选 + 批量落库
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  await wait(1800);
  const created3 = await cdp.eval(`(async () => {
    const ids = [];
    for (const n of ["甲", "乙", "丙"]) {
      const r = await window.cardsAPI.create({ noteText: "EXTRACTSTEST BROWSER " + n, cardType: "qa", frontMarkdown: "浏览器批量 " + n, backMarkdown: "答" + n, priority: 50, tags: [] });
      ids.push(r?.id);
    }
    return ids;
  })()`);
  check("浏览器：建 3 张卡用于批量", Array.isArray(created3) && created3.length === 3 && created3.every(Boolean), created3);
  await cdp.eval(`(() => { document.querySelector("[data-kind-extract]")?.click(); return true; })()`);
  await wait(1300);
  const exTable = await cdp.eval(`document.querySelector("[data-extract-table]")?.textContent || ""`);
  check("浏览器：摘录类别渲染出摘录表（毕业后仍在浏览器可见 = 统一数据源）", String(exTable).includes("GUI 摘录样本"), String(exTable).slice(0, 140));
  await cdp.eval(`(() => { document.querySelector("[data-sel-all-extracts]")?.click(); return true; })()`);
  await wait(900);
  const selCount1 = await cdp.eval(`document.querySelector("[data-sel-count]")?.textContent || ""`);
  check("浏览器：全选摘录 → 选中计数可见", String(selCount1).includes("摘录 1"), selCount1);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("[data-batch-bar] button")].find((x) => x.textContent.trim() === "召回"); b?.click(); return !!b; })()`);
  await wait(1700);
  const recallNote = await cdp.eval(`document.querySelector("[data-batch-note]")?.textContent || ""`);
  check("浏览器：批量召回提示可见", String(recallNote).includes("已处理"), recallNote);
  const statusAfterRecall = await cdp.eval(`(async () => (await window.workflowAPI.get(${JSON.stringify(b.id)}))?.status)()`);
  check("浏览器：批量召回已落库（status=open）", statusAfterRecall === "open", statusAfterRecall);
  await cdp.eval(`(() => { document.querySelector("[data-kind-card]")?.click(); return true; })()`);
  await wait(1200);
  await cdp.eval(`(() => { document.querySelector("[data-sel-all-cards]")?.click(); return true; })()`);
  await wait(900);
  const selCount2 = await cdp.eval(`document.querySelector("[data-sel-count]")?.textContent || ""`);
  check("浏览器：全选闪卡 → 选中计数可见", String(selCount2).includes("闪卡"), selCount2);
  await cdp.eval(`(() => { const btns = [...document.querySelectorAll("[data-batch-bar] button")]; const b2 = btns.find((x) => x.textContent.trim() === "批量暂停"); b2?.click(); return !!b2; })()`);
  await wait(1800);
  const suspRes = await cdp.eval(`(async () => { const all = await window.cardsAPI.listAll(); const mine = all.filter((c) => String(c.noteText || "").includes("EXTRACTSTEST BROWSER")); return JSON.stringify({ total: mine.length, suspended: mine.filter((c) => c.leech?.suspended).length }); })()`);
  const sr = JSON.parse(suspRes || "{}");
  check("浏览器：批量暂停已落库（3 张全部挂起）", sr.suspended === 3 && sr.total === 3, suspRes);
  check("浏览器：批量后选中态被清空", String(await cdp.eval(`document.querySelector("[data-sel-count]")?.textContent || ""`)) === "", "未清空");

  console.log(`\n==== extract.gui：${pass} 通过 / ${fail} 失败 ====`);
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
