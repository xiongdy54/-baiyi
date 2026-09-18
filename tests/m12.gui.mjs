// M12 同源卡延后 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m12.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m12-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§9.1 M12 验收①②⑤⑥⑦；③④长选区/拆卡矩阵由 tests/m12.test.cjs 锁定）：
//   同句 3 卡 → 今日只出 1 张 + 复习页「同源暂缓」可展开（原因可读）→ 评分后会话收尾且兄弟卡未出现
//   → 延后卡 due/fsrs 逐字段零变化（不写 FSRS）→ 卡片浏览页「今日暂缓」页签 → 设置开关即时生效与持久化 → 清理
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9226";
const USER_DATA = path.join(ROOT, "tests", "tmp-m12-userdata");

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
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  const out = openSync(path.join(ROOT, "tests", "m12.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);

  // 0. 启动 + 建卡：同一句 3 张卡（同 siblingKey，FSRSTEST 前缀）
  const booted = await cdp.eval(`!!document.querySelector("#root")`);
  check("应用启动（根节点挂载）", booted === true, booted);
  const created = await cdp.eval(`(async () => {
    if (!window.cardsAPI) return null;
    const ids = [];
    for (const n of ["甲", "乙", "丙"]) {
      const r = await window.cardsAPI.create({ noteText: "FSRSTEST M12 同源" + n, cardType: "qa", frontMarkdown: "FSRSTEST M12 同源" + n, backMarkdown: "答案" + n, priority: 50, tags: [], siblingKey: "gui:src:m12" });
      ids.push(r.id);
    }
    return ids;
  })()`);
  check("3 张同源卡建卡成功", Array.isArray(created) && created.length === 3 && created.every(Boolean), created);

  // 1. 今日队列视图：1 放行 2 暂缓
  const q1 = await cdp.eval(`(async () => { const q = await window.cardsAPI.todayQueue(); return JSON.stringify({ n: q.cards.length, d: q.deferred.length, first: q.cards[0]?.frontMarkdown || "", reason: q.deferred[0]?.deferReason?.kind || "" }); })()`);
  const q1o = JSON.parse(q1 || "{}");
  check("今日队列只放行 1 张", q1o.n === 1, q1);
  check("其余 2 张进入同源暂缓", q1o.d === 2, q1);
  check("放行队首=规范序第一张", String(q1o.first || "").includes("甲"), q1o.first);

  // 2. 复习页：只出 1 张 + 「同源暂缓」可见可展开（原因可读）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "复习"); b?.click(); return !!b; })()`);
  await wait(1200);
  const faceText = await cdp.eval(`document.querySelector(".review-face")?.textContent || ""`);
  check("复习页只出同源组 1 张（甲）", faceText.includes("同源甲") && !faceText.includes("同源乙"), faceText.slice(0, 80));
  const deferBtn = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".review-deferred button")].find((x) => x.textContent.includes("同源暂缓")); b?.click(); return b ? b.textContent : null; })()`);
  check("「同源暂缓 2 张」按钮可见", typeof deferBtn === "string" && deferBtn.includes("2"), deferBtn);
  await wait(400);
  const reasonText = await cdp.eval(`document.querySelector(".deferred-list")?.textContent || ""`);
  check("延后原因可读（指向已放行卡）", reasonText.includes("同源") && reasonText.includes("甲"), reasonText.slice(0, 120));

  // 3. 评分 Good → 其余同源卡当日不再出现（会话收尾） + 延后卡 due/fsrs 零变化（不写 FSRS）
  //    qa 卡面翻面 = 整卡点击（CardFace qa 分支 onClick=onReveal，无「显示答案」按钮——那是 cloze/遮挡分支）
  const dueBefore = await cdp.eval(`(async () => { const all = await window.cardsAPI.listAll(); return JSON.stringify(all.filter((c) => c.siblingKey === "gui:src:m12" && c.frontMarkdown.includes("乙")).map((c) => c.fsrs)); })()`);
  const revealed = await cdp.eval(`(() => { const f = document.querySelector(".review-face"); f?.click(); return !!f; })()`);
  check("翻面成功（整卡点击）", revealed === true, revealed);
  await wait(600);
  const graded = await cdp.eval(`(() => { const b = document.querySelector(".grade-good"); b?.click(); return !!b; })()`);
  check("评分按钮在场（背面四档）", graded === true, graded);
  await wait(1500);
  const doneText = await cdp.eval(`document.body.textContent || ""`);
  check("评分后无下一张同源卡（会话收尾）", doneText.includes("已清空") || doneText.includes("休息"), doneText.slice(0, 150));
  check("收尾页仍展示同源暂缓 2 张", doneText.includes("同源暂缓"), doneText.slice(0, 150));
  const dueAfter = await cdp.eval(`(async () => { const all = await window.cardsAPI.listAll(); return JSON.stringify(all.filter((c) => c.siblingKey === "gui:src:m12" && c.frontMarkdown.includes("乙")).map((c) => c.fsrs)); })()`);
  check("核心不变量：被延后卡 fsrs_json/due 逐字段零变化", dueAfter === dueBefore, { before: dueBefore, after: dueAfter });
  const winnerReps = await cdp.eval(`(async () => { const all = await window.cardsAPI.listAll(); return JSON.stringify(all.filter((c) => c.frontMarkdown.includes("同源甲")).map((c) => [c.fsrs?.reps, c.fsrs?.state])); })()`);
  // 新卡首评 Good → learning 步进（enable_short_term，1m/10m）——调度器正确行为；步进卡不参与延后在此现场可见
  check("评分卡本身调度正常（reps=1、learning 步进，FSRS 功能未破坏）", winnerReps.includes("[1,\"learning\"]") || winnerReps.includes("[1,\"review\"]"), winnerReps);

  // 4. 卡片浏览页：「今日暂缓」页签与状态标记
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  await wait(1200);
  const deferTab = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".seg-tabs button")].find((x) => x.textContent.includes("今日暂缓")); return b ? b.textContent : null; })()`);
  check("卡片浏览页出现「今日暂缓 (2)」页签", typeof deferTab === "string" && deferBtn && deferTab.includes("2"), deferTab);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".seg-tabs button")].find((x) => x.textContent.includes("今日暂缓")); b?.click(); return !!b; })()`);
  await wait(600);
  const rows = await cdp.eval(`document.querySelectorAll(".cb-row:not(.cb-row-head)").length`);
  check("暂缓页签过滤出 2 张延后卡", rows === 2, rows);
  const marked = await cdp.eval(`document.querySelector(".cb-row:not(.cb-row-head)")?.textContent || ""`);
  check("状态列带「同源暂缓」标记", marked.includes("同源暂缓"), marked.slice(0, 100));

  // 5. 设置页：siblingBury 区块可见，总开关即时生效 + 持久化（顶栏设置 = icon-btn 仅 title，无文字）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("设置") || x.title?.includes("设置")); b?.click(); return !!b; })()`);
  await wait(1000);
  const modalOpen = await cdp.eval(`!!document.querySelector(".settings-nav")`);
  check("设置面板已打开", modalOpen === true, modalOpen);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".settings-nav button")].find((x) => x.textContent.includes("同源")); b?.click(); return !!b; })()`);
  await wait(600);
  const secVisible = await cdp.eval(`!!document.querySelector("#sec-siblingbury")`);
  check("设置含「同源卡延后」区块", secVisible === true, secVisible);
  const secText = await cdp.eval(`document.querySelector("#sec-siblingbury")?.textContent || ""`);
  check("区块含新卡/复习卡分开关与阈值", secText.includes("新卡同源延后") && secText.includes("复习卡同源延后") && secText.includes("短材料阈值"), secText.slice(0, 120));
  // 关闭总开关 → 队列立即全放行（即时生效，无需重启）；分两步断言：设置写入 与 队列响应
  await cdp.eval(`(() => { const sec = document.querySelector("#sec-siblingbury"); const seg = sec.querySelector(".seg-tabs"); const off = [...seg.querySelectorAll("button")].find((b) => b.textContent.trim() === "关"); off?.click(); return !!off; })()`);
  await wait(800);
  const offPersisted = await cdp.eval(`(async () => { const v = await window.settingsAPI.get("app", "siblingBury"); return JSON.stringify(v && v.enabled); })()`);
  check("点「关」后 enabled=false 已写入", offPersisted === "false", offPersisted);
  const qOff = await cdp.eval(`(async () => { const q = await window.cardsAPI.todayQueue(); return JSON.stringify({ n: q.cards.length, d: q.deferred.length }); })()`);
  check("总开关关 → 同组卡全部放行、零延后（即时生效）", qOff === '{"n":2,"d":0}' || (JSON.parse(qOff).n === 2 && JSON.parse(qOff).d === 0), qOff);
  // 重新开启（恢复默认行为），设置持久化由 settingsAPI 直读验证
  await cdp.eval(`(() => { const sec = document.querySelector("#sec-siblingbury"); const seg = sec.querySelector(".seg-tabs"); const on = [...seg.querySelectorAll("button")].find((b) => b.textContent.trim() === "开"); on?.click(); return !!on; })()`);
  await wait(800);
  const persisted = await cdp.eval(`(async () => { const v = await window.settingsAPI.get("app", "siblingBury"); return JSON.stringify(v); })()`);
  check("siblingBury 设置已持久化（enabled=true）", typeof persisted === "string" && persisted.includes('"enabled":true'), persisted);

  // 6. 清理：删卡 + 复位设置（测试数据不留痕）
  const cleaned = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    let n = 0;
    for (const c of all) if ((c.frontMarkdown || "").includes("FSRSTEST M12")) { await window.cardsAPI.remove(c.id); n++; }
    await window.settingsAPI.set("app", "siblingBury", null);
    return n;
  })()`);
  check("测试卡清理完成（3 张）", cleaned === 3, cleaned);

  console.log(`\nM12 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M12 GUI 异常", e);
} finally {
  try { electron?.kill(); } catch { /* 忽略 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 忽略 */ }
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败不掩盖结果 */ }
}
process.exit(fail > 0 ? 1 : 0);
