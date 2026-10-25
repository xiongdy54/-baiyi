// M13 GF-1 批次 B（呈现层）GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m13.gui.mjs）
// 跑前先 `npm run build`（GUI 套件约定，§7.3）；隔离：M7_TEST_USERDATA 指向 tests/tmp-m13-userdata
//（先清空，全新库），绝不触碰真实库（§7.3）。
// 依据：docs/design/GROWTH-FEEDBACK-D129.md §5（UI 契约）+ §6.3（断言清单 G-1…G-12）+ §8-R8（探针全
// data-*，文案断言只做 1 条冒烟）；模板照 tests/m12.gui.mjs（M7_TEST_USERDATA / 自启自关 / fetch+WebSocket CDP）。
// 覆盖：微反馈条出现与 aria / 几何不变 / 单槽替换与自动消失 / 证据展开暂停计时 / 设置开关零渲染 /
//       reduce 瞬时 / 会话成果汇总与表序 / 空命中零渲染 / L2 单日折叠展开 / 仪表盘两 widget（顺序、
//       行数、Territory aria、拖拽持久化）/ 关闭时静态空态 / 重启不丢。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9227";
const USER_DATA = path.join(ROOT, "tests", "tmp-m13-userdata");
const DAY = 86_400_000;

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${typeof actual === "object" && actual !== null ? JSON.stringify(actual) : String(actual)}`); }
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
          // CDP：awaitPromise 下的 promise 拒绝，exceptionDetails 挂在 result 内层（m12 模板的潜在盲区——
          // 本套件表达式更复杂，必须把它显出来，否则页面异常被静默成 undefined）
          const ed = r.exceptionDetails || (r.result && r.result.exceptionDetails);
          if (ed) return "EXC: " + ((ed.exception && ed.exception.description) || ed.text || JSON.stringify(ed)).slice(0, 400);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

async function launch() {
  const out = openSync(path.join(ROOT, "tests", "m13.gui.log"), "a");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

async function stop() {
  await wait(1200);
  killProc(electron);
}

const nav = (label) => `(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`;
// 页内 grade：翻面（qa 卡走底栏 data-reveal）→ 评分 Good（推荐档 .grade-good）
const gradeGood = `(async () => {
  const reveal = document.querySelector("[data-reveal]");
  if (reveal) { reveal.click(); await new Promise((r) => setTimeout(r, 450)); }
  const good = document.querySelector(".grade-good");
  if (!good) return "no-grade-btn";
  good.click();
  return "ok";
})()`;
const waitToast = async (cdp, timeoutMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await cdp.eval(`document.querySelectorAll("[data-growth-toast]").length`);
    if (n >= 1) return Date.now() - t0;
    await wait(150);
  }
  return -1;
};
const waitToastGone = async (cdp, timeoutMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await cdp.eval(`document.querySelectorAll("[data-growth-toast]").length`);
    if (n === 0) return Date.now() - t0;
    await wait(150);
  }
  return -1;
};
const rectOf = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
const near = (a, b, tol = 1) => a && b && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  await launch();
  const cdp = await connect();
  await wait(2500);

  // 0. 启动 + 种子：1 本书 22 卡（FSRSTEST-M13-* 显式 id＝确定性表序；A 组康复 7 / B 组长期 2 / C 组新卡 5 / D 组领域进入 8）
  const booted = await cdp.eval(`!!document.querySelector("#root")`);
  check("应用启动（根节点挂载）", booted === true, booted);
  const seeded = await cdp.eval(`(async () => {
    if (!window.libraryAPI || !window.cardsAPI) return null;
    const book = await window.libraryAPI.createFromPaste("FSRSTEST M13 成长样本书", "# M13\\n\\n正文。");
    if (!book || !book.documentId) return null;
    const now = Date.now();
    const DAYP = 86400000; // 页内常量（页面 eval 里拿不到 Node 侧的 DAY）
    const mk = (id, front, fsrs, priority) => window.cardsAPI.create({
      id, noteText: front + " 笔记", cardType: "qa", frontMarkdown: front, backMarkdown: "答案",
      priority, tags: [], contextRef: { documentId: book.documentId },
      fsrsJson: JSON.stringify(fsrs)
    });
    const learn = (due) => ({ state: "relearning", stability: 0.5, difficulty: 5, due, lapses: 1, reps: 1, lastReview: now - 120000, learningSteps: 0 });
    const review = (st, due) => ({ state: "review", stability: st, difficulty: 5, due, lapses: 0, reps: 2, lastReview: now - DAYP, learningSteps: 0 });
    const fresh = (due) => ({ state: "new", due, lapses: 0 });
    const ids = {};
    const failed = {};
    const mkSafe = async (id, front, fsrs, priority) => {
      try { const r = await mk(id, front, fsrs, priority); if (!r || !r.id) failed[id] = "blank"; }
      catch (e) { failed[id] = String(e && e.message).slice(0, 120); }
    };
    for (const [k, i] of [["A", 1], ["A", 2], ["A", 3]]) { const id = "FSRSTEST-M13-" + k + i; await mkSafe(id, "FSRSTEST M13 康复" + "一二三"[i - 1], learn(now - 60000), 90 - i); ids[id] = true; }
    for (const i of [4, 5, 6]) { const id = "FSRSTEST-M13-A" + i; await mkSafe(id, "FSRSTEST M13 康复" + "四五六"[i - 4], learn(now + DAYP), 10); ids[id] = true; }
    for (const [id, st] of [["FSRSTEST-M13-B1", 65], ["FSRSTEST-M13-B2", 58]]) { await mkSafe(id, "FSRSTEST M13 长期" + (st === 65 ? "甲" : "乙"), review(st, now + DAYP), 5); ids[id] = true; }
    for (let i = 1; i <= 5; i++) { const id = "FSRSTEST-M13-C" + i; await mkSafe(id, "FSRSTEST M13 新卡" + "一二三四五"[i - 1], fresh(now + DAYP), 1); ids[id] = true; }
    // A7＝无 contextRef 的备胎康复卡（不入 Territory 书维、不影响 G-7 表序），保证 G-5/G-6 评分时
    // 队列不至清空——收尾页分支会卸载微反馈条，单卡会话的 toast 会被收尾渲染竞态吞掉
    await mkSafe("FSRSTEST-M13-A7", "FSRSTEST M13 康复七", learn(now + DAYP), 1); ids["FSRSTEST-M13-A7"] = true;
    // D 组（v49.23 / D196）：8 张各带一个**不同 UDC 领域码**的卡，建后种一条巩固日志（review/30）
    // → 每条产一个 domain-entry（数据页「成长记录」的来源之一，8 条 = 2 页供 G-10 分页断言）；
    // 无 contextRef（不入 Territory 书维）；每个领域仅 1 张（<8 样本门槛 → 不入领域行）；
    // due 移入未来（不入今日队列）；日志先于会话起点（不入汇总窗口）；各材料累计 <50 张（不产 material）。
    const DOMAINS = ["004", "159.9", "316", "32", "33", "37", "51", "53"];
    for (let i = 1; i <= 8; i++) {
      const did = "FSRSTEST-M13-D" + i;
      const dfsrs = fresh(now - 60000);
      try {
        const r = await window.cardsAPI.create({ id: did, noteText: "FSRSTEST M13 领域" + i + " 笔记", cardType: "qa", frontMarkdown: "FSRSTEST M13 领域" + i, backMarkdown: "答案", priority: 1, tags: [], domain: [DOMAINS[i - 1]], fsrsJson: JSON.stringify(dfsrs) });
        if (!r || !r.id) failed[did] = "blank";
      } catch (e) { failed[did] = String(e && e.message).slice(0, 120); }
      ids[did] = true;
      try {
        await window.cardsAPI.review(did, review(30, now + 30 * DAYP), "good", 1000, dfsrs);
      } catch (e) { failed[did + "-review"] = String(e && e.message).slice(0, 120); }
    }
    const all = await window.cardsAPI.listAll();
    return { doc: book.documentId, n: Object.keys(ids).length, failed, inDb: all.filter((c) => c.id.startsWith("FSRSTEST-M13")).length };
  })()`);
  check("种子：1 本书 22 卡建卡成功（A1-A7/B1-B2/C1-C5 + D1-D8 领域进入）", seeded && seeded.n === 22 && seeded.inDb === 22 && Object.keys(seeded.failed || {}).length === 0, seeded);

  // 页内工具：注入评分（explicit after state；before=卡当前态，过 A-7 守卫）/ 改 due
  await cdp.eval(`(async () => {
    window.__m13inject = async (cardId, stability) => {
      try {
        const c = await window.cardsAPI.get(cardId);
        if (!c) return "no-card:" + cardId;
        const before = c.fsrs;
        const after = { state: "review", stability, difficulty: (before && before.difficulty) || 5, due: Date.now() + 30 * 86400000, lapses: (before && before.lapses) || 0, reps: ((before && before.reps) || 0) + 1, lastReview: Date.now(), learningSteps: 0 };
        await window.cardsAPI.review(cardId, after, "good", 1000, before);
        return true;
      } catch (e) { return "throw:" + String(e && e.message).slice(0, 120); }
    };
    window.__m13due = async (cardId) => {
      try {
        const c = await window.cardsAPI.get(cardId);
        if (!c) return "no-card:" + cardId;
        await window.cardsAPI.update({ ...c, fsrs: { ...(c.fsrs || {}), due: Date.now() - 60000 } });
        return true;
      } catch (e) { return "throw:" + String(e && e.message).slice(0, 120); }
    };
    return true;
  })()`);

  // 1. 进复习页（会话首卡 = A1；会话窗口起点 = 首卡渲染时刻）→ 注入 B1/B2（窗口内跨越）
  await cdp.eval(nav("复习"));
  await wait(1500);
  const injected = await cdp.eval(`(async () => ({ b1: await window.__m13inject("FSRSTEST-M13-B1", 200), b2: await window.__m13inject("FSRSTEST-M13-B2", 65) }))()`);
  check("会话窗口内注入 B1(st200→retention-180)/B2(st65→retention-60)", injected && injected.b1 === true && injected.b2 === true, injected);

  // G-2 前置快照：卡面（A1 正面，无提示条）+ 会话容器
  const R0 = await cdp.eval(rectOf(".review-front"));
  const S0 = await cdp.eval(rectOf(".review-session"));

  // G-1：评分 A1（relearning → Good → review）→ 微反馈条出现
  const graded1 = await cdp.eval(gradeGood);
  check("A1 翻面+评分 Good 成功", graded1 === "ok", graded1);
  const t1 = await waitToast(cdp, 4000);
  check("G-1: 评分后 .growth-toast 出现（≤4s）", t1 >= 0, t1);
  const toastInfo = await cdp.eval(`(() => { const el = document.querySelector("[data-growth-toast]"); if (!el) return null; return { role: el.getAttribute("role"), live: el.getAttribute("aria-live"), tier: el.getAttribute("data-growth-tier"), event: el.getAttribute("data-growth-event"), text: el.querySelector(".growth-toast-text")?.textContent || "" }; })()`);
  check("G-1: role=status + aria-live=polite + tier=2 + event=relearning-recovery",
    toastInfo && toastInfo.role === "status" && toastInfo.live === "polite" && toastInfo.tier === "2" && toastInfo.event === "relearning-recovery", toastInfo);
  check("G-1: 文案出自 growthStrings（冒烟 1 条）", toastInfo && toastInfo.text === "这张卡遗忘后又回来了", toastInfo && toastInfo.text);

  // G-2：提示条出现不改变卡面 / 会话容器几何（A1 无条 vs A2 有条——同款单行卡面）
  const R1 = await cdp.eval(rectOf(".review-front"));
  const S1 = await cdp.eval(rectOf(".review-session"));
  check("G-2: .review-front 几何不变（≤1px）", near(R0, R1), { R0, R1 });
  check("G-2: .review-session 几何不变（≤1px）", near(S0, S1), { S0, S1 });

  // G-4：点「证据」展开（aria 翻转 + detail 可见），展开期不自动消失（>5.5s 仍在）
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="growth-toast-expand"]'); if (!b) return null; b.click(); return true; })()`);
  await wait(450);
  const g4diag = await cdp.eval(`(() => { const t = document.querySelector("[data-growth-toast]"); const b = document.querySelector('[data-testid="growth-toast-expand"]'); const d = document.querySelector("[data-growth-detail]"); return { aria: b ? b.getAttribute("aria-expanded") : "no-btn", cls: d ? d.className : "no-detail", rows: d ? getComputedStyle(d).gridTemplateRows : "", h: d ? d.getBoundingClientRect().height : -1, toastH: t ? t.getBoundingClientRect().height : -1 }; })()`);
  check("G-4: 点证据后 aria-expanded=true", g4diag.aria === "true", g4diag);
  const detailH = g4diag.h;
  check("G-4: 展开后 [data-growth-detail] 可见（height>0）", detailH > 0, detailH);
  await wait(5600);
  const stillThere = await cdp.eval(`document.querySelectorAll("[data-growth-toast]").length`);
  check("G-4: 展开期暂停消失计时（5.6s 后仍在场）", stillThere === 1, stillThere);

  // G-2（评分栏）：提示条在场 vs 消失后，同卡（A2 背面）.grade-row 几何全等
  await cdp.eval(`(() => { const b = document.querySelector("[data-reveal]"); b?.click(); return true; })()`);
  await wait(450);
  const G1r = await cdp.eval(rectOf(".grade-row"));
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="growth-toast-expand"]'); b?.click(); return true; })()`);
  const gone1 = await waitToastGone(cdp, 6500);
  check("G-4: 收起后重新计时（≤6.5s 消失）", gone1 >= 0, gone1);
  const G2r = await cdp.eval(rectOf(".grade-row"));
  check("G-2: .grade-row 几何不变（提示条在场 vs 消失，≤1px）", near(G1r, G2r), { G1r, G2r });

  // G-3：连续命中单槽替换（A2 再评一条 → 至多 1 条）+ 自动消失 ≤6.5s
  const t3start = Date.now();
  const graded2 = await cdp.eval(gradeGood);
  check("A2 评分成功", graded2 === "ok", graded2);
  const t2 = await waitToast(cdp, 4000);
  check("G-3: 第二条命中出现（≤4s）", t2 >= 0, t2);
  const slotCount = await cdp.eval(`document.querySelectorAll("[data-growth-toast]").length`);
  check("G-3: 任意时刻 [data-growth-toast] 数 ≤1（单槽替换）", slotCount <= 1, slotCount);
  const gone2 = await waitToastGone(cdp, 7000);
  const dismissMs = gone2 >= 0 ? Date.now() - t3start : -1;
  check("G-3: 自动消失 ≤6.5s", dismissMs >= 0 && dismissMs <= 6800, dismissMs);

  // A3 评分（折叠计数第 3 条；会话在此收尾——C 组 due 明日不入队）
  const graded3 = await cdp.eval(gradeGood);
  check("A3 评分成功（会话收尾）", graded3 === "ok", graded3);
  await wait(1200);

  // G-7：收尾页 .growth-session 列出本轮全部命中（含 L3 retention-60），行序 = §6.6.1 表序
  let sess = null;
  for (let i = 0; i < 20; i++) {
    sess = await cdp.eval(`(() => { const s = document.querySelector("[data-growth-session]"); if (!s) return null; const rows = [...s.querySelectorAll(":scope .growth-session-list > li")]; return { total: rows.length, hits: rows.filter((r) => r.hasAttribute("data-growth-row")).map((r) => r.getAttribute("data-growth-event")), fold: rows.filter((r) => r.hasAttribute("data-growth-fold")).map((r) => r.querySelector("button")?.textContent || "") }; })()`);
    if (sess) break;
    await wait(300);
  }
  check("G-7: .growth-session 在场（本轮成果）", !!sess, sess);
  check("G-7: 可见命中 4 行 + 折叠 1 行（rr 被取显 1 条、L3 照常列出）", sess && sess.total === 5 && sess.hits.length === 4, sess);
  check("G-7: 行序 = §6.6.1 表序（relearning-recovery → retention-180 → retention-60 ×2）",
    sess && JSON.stringify(sess.hits) === JSON.stringify(["relearning-recovery", "retention-180", "retention-60", "retention-60"]), sess && sess.hits);
  check("G-9 前置: 折叠行文案含计数 2（今天另有 2 张卡进入长期维持）", sess && sess.fold.length === 1 && sess.fold[0].includes("2"), sess && sess.fold);

  // G-9：折叠行点击展开明细
  await cdp.eval(`(() => { const b = document.querySelector("[data-growth-fold] button"); if (!b) return null; b.click(); return true; })()`);
  await wait(450);
  const foldOpen = await cdp.eval(`(() => { const b = document.querySelector("[data-growth-fold] button"); return b ? b.getAttribute("aria-expanded") : "no-btn"; })()`);
  check("G-9: 折叠行 aria-expanded=true", foldOpen === "true", foldOpen);
  await wait(350);
  const foldH = await cdp.eval(`(() => { const d = document.querySelector("[data-growth-fold-list]"); return d ? d.getBoundingClientRect().height : -1; })()`);
  const foldRows = await cdp.eval(`document.querySelectorAll("[data-growth-fold-list] li[data-growth-row]").length`);
  check("G-9: 展开后明细可见且含 2 条被折叠命中", foldH > 0 && foldRows === 2, { foldH, foldRows });

  // G-5：设置关闭 → 评分后提示条永不出现（零渲染，读取路径短路）；重新开启恢复
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "growthFeedback", { enabled: false }); return true; })()`);
  const dueA4 = await cdp.eval(`(async () => await window.__m13due("FSRSTEST-M13-A4"))()`);
  await cdp.eval(nav("卡片"));
  await wait(900);
  await cdp.eval(nav("复习"));
  await wait(1500);
  const g4head = await cdp.eval(`(async () => { const q = await window.cardsAPI.todayQueue(); return JSON.stringify({ n: q.cards.length, first: q.cards[0] && q.cards[0].id }); })()`);
  const graded4 = await cdp.eval(gradeGood); // A4：设置关闭路径评分
  check("G-5 前置: A4 due 已改且为队首（A4 评分真实发生）", dueA4 === true && JSON.parse(g4head).first === "FSRSTEST-M13-A4" && graded4 === "ok", { dueA4, g4head, graded4 });
  const offToast = await waitToast(cdp, 2600);
  check("G-5: 关闭后评分（A4）无提示条（零渲染）", offToast === -1, offToast);
  const offSummary = await cdp.eval(`(() => { const done = document.body.textContent || ""; return { done: done.includes("休息") || done.includes("已清空"), sess: !!document.querySelector("[data-growth-session]") }; })()`);
  check("G-5: 关闭后收尾页汇总亦零渲染", offSummary.done === true && offSummary.sess === false, offSummary);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "growthFeedback", { enabled: true }); return true; })()`);
  const gfBack = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "growthFeedback")))()`);
  const dueA5 = await cdp.eval(`(async () => ({ a5: await window.__m13due("FSRSTEST-M13-A5"), a6: await window.__m13due("FSRSTEST-M13-A6") }))()`);
  await cdp.eval(nav("卡片"));
  await wait(900);
  await cdp.eval(nav("复习"));
  await wait(1500);
  const graded5 = await cdp.eval(gradeGood); // A5：重新开启后评分
  check("G-5 前置: 设置回读 enabled=true 且 A5/A6 入队、A5 评分真实发生",
    gfBack.includes('"enabled":true') && dueA5 && dueA5.a5 === true && dueA5.a6 === true && graded5 === "ok", { gfBack, dueA5, graded5 });
  const onToast = await waitToast(cdp, 4000);
  check("G-5: 重新开启后恢复（A5 评分出现提示条）", onToast >= 0, onToast);
  await waitToastGone(cdp, 6500);

  // G-6：reduce 档（CDP 仿真）——提示条无进场动画（computed animation-name = none），出现瞬时。
  // A7 仍在队（上一阶段已入队），A6 评分后不会立即进收尾页——否则收尾分支会把 toast 卸掉
  const dueA7 = await cdp.eval(`(async () => await window.__m13due("FSRSTEST-M13-A7"))()`);
  await cdp.eval(nav("卡片"));
  await wait(900);
  await cdp.eval(nav("复习"));
  await wait(1500);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const graded6 = await cdp.eval(gradeGood); // A6
  check("G-6 前置: A6 评分真实发生（A7 仍在队）", dueA7 === true && graded6 === "ok", { dueA7, graded6 });
  const t6 = await waitToast(cdp, 4000);
  const animName = t6 >= 0 ? await cdp.eval(`getComputedStyle(document.querySelector("[data-growth-toast]")).animationName`) : "no-toast";
  check("G-6: reduce 档提示条出现且 computed animation-name=none（无进场位移）", t6 >= 0 && animName === "none", { t6, animName });
  await cdp.eval(gradeGood); // A7：清空队列（reduce 下顺手评掉）
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await waitToastGone(cdp, 6500);

  // G-8：空命中会话零渲染（建一张普通新卡评分 → doneCount=1 无任何命中）
  await cdp.eval(`(async () => { await window.cardsAPI.create({ id: "FSRSTEST-M13-G8", noteText: "FSRSTEST M13 零命中 笔记", cardType: "qa", frontMarkdown: "FSRSTEST M13 零命中", backMarkdown: "答案", priority: 50, tags: [], fsrsJson: JSON.stringify({ state: "new", due: Date.now() - 60000, lapses: 0 }) }); return true; })()`);
  await cdp.eval(nav("卡片"));
  await wait(900);
  await cdp.eval(nav("复习"));
  await wait(1500);
  await cdp.eval(gradeGood); // G8 卡：new → learning，零命中
  await wait(1500);
  const emptySess = await cdp.eval(`(() => ({ sess: !!document.querySelector("[data-growth-session]"), empty: (document.body.textContent || "").includes("休息一下"), done: (document.querySelector(".review-count")?.textContent || "") } ))()`);
  check("G-8: 空命中会话不渲染 .growth-session（零 DOM，仅既有空态文案）",
    emptySess.sess === false && emptySess.empty === true && String(emptySess.done).startsWith("1"), emptySess);

  // G-10：仪表盘两 widget——在场、位于 today 之后、行数=档案预期、Territory aria 与种子一致
  await cdp.eval(nav("数据"));
  await wait(2000);
  const dash = await cdp.eval(`(() => {
    const el = document.querySelector('[data-widget="growth-events"]');
    const order = [...document.querySelectorAll("[data-widget]")].map((x) => x.getAttribute("data-widget"));
    const records = [...el.querySelectorAll("[data-growth-record]")];
    const trow = document.querySelector('[data-widget="territory"] [data-territory-row]');
    return {
      order,
      ge: order.includes("growth-events"), te: order.includes("territory"),
      rows: records.length,
      events: records.map((r) => r.getAttribute("data-growth-event")),
      pages: [...el.querySelectorAll(".growth-pager-btn")].map((b) => b.textContent.trim()),
      current: el.querySelector('[aria-current="page"]')?.textContent.trim() || "",
      aria: trow ? trow.querySelector(".territory-seg")?.getAttribute("aria-label") : "",
      pct: trow ? trow.querySelector(".territory-pct")?.textContent : ""
    };
  })()`);
  const idxToday = dash.order.indexOf("today");
  check("G-10: growth-events 与 territory 两 widget 在场", dash.ge && dash.te, dash.order);
  check("G-10: 默认序两 widget 紧跟 today 之后", dash.order.indexOf("growth-events") === idxToday + 1 && dash.order.indexOf("territory") === idxToday + 2, dash.order);
  check("G-10: 成长记录首页 6 行（每页 6 条，D195）", dash.rows === 6, dash.rows);
  check("G-10: 档案只含聚合/稀有型（domain-entry；material 因各材料累计 <50 张不产，D196）",
    dash.events.length > 0 && dash.events.every((e) => e === "domain-entry"), dash.events);
  check("G-10: 分页在场：共 2 页（8 条 / 6）且当前页 = 1", dash.pages.length === 2 && dash.current === "1", { pages: dash.pages, current: dash.current });
  // G-10（分页翻页）：点第 2 页 → 2 行
  await cdp.eval(`(() => { const el = document.querySelector('[data-widget="growth-events"]'); const b = [...el.querySelectorAll(".growth-pager-btn")].find((x) => x.textContent.trim() === "2"); if (!b) return false; b.click(); return true; })()`);
  await wait(300);
  const dashP2 = await cdp.eval(`(() => { const el = document.querySelector('[data-widget="growth-events"]'); return { rows: el.querySelectorAll("[data-growth-record]").length, current: el.querySelector('[aria-current="page"]')?.textContent.trim() || "" }; })()`);
  check("G-10: 点第 2 页 → 2 行且当前页 = 2", dashP2.rows === 2 && dashP2.current === "2", dashP2);
  check("G-10: Territory 分段条 aria 与种子一致（共 14：未学 5 · 学习中 0 · 长期复习 7 · 已巩固 2）",
    dash.aria === "共 14 张：未学 5 · 学习中 0 · 长期复习 7 · 已巩固 2", dash.aria);
  check("G-10: 覆盖率 = 2/14 → 14%", dash.pct === "14%", dash.pct);
  // G-10（拖拽不破）：键盘重排（Alt+←，与拖拽同一条 reorder + persistLayout 路径）→ dashboard.layout 持久化新序
  await cdp.eval(`(() => { const b = document.querySelector('[data-widget="growth-events"] .dash-widget-reorder'); if (!b) return false; b.focus(); b.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true })); return true; })()`);
  await wait(700);
  const layoutAfter = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("dashboard", "layout")))()`);
  let layoutObj = null;
  try { layoutObj = JSON.parse(layoutAfter); } catch { /* 保持 null */ }
  check("G-10: 重排 growth-events 后 settings dashboard.layout 持久化新序（layer 字段不破坏拖拽/重排）",
    layoutObj && Array.isArray(layoutObj.order) && layoutObj.order.indexOf("growth-events") >= 0 && layoutObj.order.indexOf("growth-events") < layoutObj.order.indexOf("today"), layoutAfter);

  // G-11：成长反馈关闭 → 两 widget 静态空态；window.growthAPI 直查 {enabled:false}（零派生）
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "growthFeedback", { enabled: false }); return true; })()`);
  await cdp.eval(nav("卡片"));
  await wait(900);
  await cdp.eval(nav("数据"));
  await wait(2000);
  const offDash = await cdp.eval(`(async () => {
    const rows = document.querySelectorAll('[data-widget="growth-events"] [data-growth-record]').length;
    const geEmpty = !!document.querySelector('[data-widget="growth-events"] .growth-empty');
    const teEmpty = !!document.querySelector('[data-widget="territory"] .growth-empty');
    const direct = await window.growthAPI.overview();
    return { rows, geEmpty, teEmpty, directEnabled: direct && direct.enabled };
  })()`);
  check("G-11: 关闭后两 widget 静态空态（0 行 + .growth-empty）", offDash.rows === 0 && offDash.geEmpty && offDash.teEmpty, offDash);
  check("G-11: window.growthAPI.overview() 直查返回 {enabled:false}", offDash.directEnabled === false, offDash);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "growthFeedback", { enabled: true }); return true; })()`);
  await wait(500);

  // G-12：重启不丢（同一 userData 重启；不删库）——档案行不变、设置项持久化。
  // Windows：taskkill 后单实例锁文件/端口释放有迟滞，多等再启；连接失败则再杀再试一轮
  await stop();
  await wait(2000);
  killProc(electron);
  await wait(1500);
  await launch();
  let cdp2 = null;
  try { cdp2 = await connect(); } catch { await stop(); await wait(1500); await launch(); cdp2 = await connect(); }
  await wait(2500);
  await cdp2.eval(nav("数据"));
  await wait(2200);
  const reboot = await cdp2.eval(`(async () => {
    const rows = document.querySelectorAll('[data-widget="growth-events"] [data-growth-record]').length;
    const order = [...document.querySelectorAll("[data-widget]")].map((el) => el.getAttribute("data-widget"));
    const gf = await window.settingsAPI.get("app", "growthFeedback");
    const layout = await window.settingsAPI.get("dashboard", "layout");
    return { rows, ge: order.includes("growth-events"), te: order.includes("territory"), gf, layoutOrder: layout && layout.order };
  })()`);
  check("G-12: 重启后成长记录首页 6 行（分页默认回到第 1 页，D195）", reboot.rows === 6, reboot.rows);
  check("G-12: 重启后两 widget 在场", reboot.ge && reboot.te, reboot);
  check("G-12: 设置项持久化（growthFeedback.enabled=true）", reboot.gf && reboot.gf.enabled === true, reboot.gf);
  check("G-12: 重排后的 dashboard.layout 持久化", reboot.layoutOrder && reboot.layoutOrder.indexOf("growth-events") < reboot.layoutOrder.indexOf("today"), reboot.layoutOrder);

  console.log(`\nM13 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M13 GUI 异常", e);
} finally {
  killProc(electron);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败不掩盖结果 */ }
}
process.exit(fail > 0 ? 1 : 0);
