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
  // 批 4 Task 18（R29）：`extractReader` 专用页退役 →「打开摘录」动作不再是动作集成员。
  // 契约变更：动作集去掉了「打开摘录」（其余不变）。
  check(
    "动作齐全（下一条/推迟/毕业/跳转原文；**不含**已退役的「打开摘录」）",
    ["下一条", "推迟", "毕业", "跳转原文"].every((t) => face.includes(t)) && !face.includes("打开摘录"),
    face.slice(0, 200)
  );
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
  // 归档出口（§6.4.2）：状态落 archived 且不再进到期队列；随后召回还原
  await cdp.eval(`(() => { document.querySelector("[data-sel-all-extracts]")?.click(); return true; })()`);
  await wait(700);
  const archClicked = await cdp.eval(`(() => { const btns = [...document.querySelectorAll("[data-batch-bar] button")]; const b2 = btns.find((x) => x.textContent.trim() === "归档"); b2?.click(); return !!b2; })()`);
  check("浏览器：「归档」按钮在位可点", archClicked === true, archClicked);
  await wait(1600);
  const archState = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } }); return JSON.stringify({ status: d?.status, inQueue: q.extracts.some((e) => e.id === ${JSON.stringify(b.id)}) }); })()`);
  const as = JSON.parse(archState || "{}");
  check("浏览器：归档后状态=archived 且不进到期队列", as.status === "archived" && as.inQueue === false, archState);
  // 还原（后续步骤依赖该摘录在到期队列里）
  await cdp.eval(`(() => { document.querySelector("[data-sel-all-extracts]")?.click(); return true; })()`);
  await wait(700);
  await cdp.eval(`(() => { const btns = [...document.querySelectorAll("[data-batch-bar] button")]; const b3 = btns.find((x) => x.textContent.trim() === "召回"); b3?.click(); return !!b3; })()`);
  await wait(1600);
  const restored = await cdp.eval(`(async () => (await window.workflowAPI.get(${JSON.stringify(b.id)}))?.status)()`);
  check("浏览器：归档后召回还原为 open（供后续步骤使用）", restored === "open", restored);
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

  // 11) 书架书级优先级（§6.8-2）：改一次书优先级 → 继承型摘录实时跟随
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1800);
  const openedPriority = await cdp.eval(`(() => { const btn = document.querySelector("[data-book-priority]"); btn?.click(); return !!btn; })()`);
  check("书架：书卡动作条有「优先级」入口", openedPriority === true, openedPriority);
  await wait(700);
  const picked30 = await cdp.eval(`(() => { const items = [...document.querySelectorAll(".dd-item")]; const b2 = items.find((x) => x.textContent.trim() === "优先级 30"); b2?.click(); return !!b2; })()`);
  check("书架：可选「优先级 30」", picked30 === true, picked30);
  await wait(1600);
  const libRow = await cdp.eval(`(async () => { const items = await window.libraryAPI.list(); const bk = items.find((x) => String(x.title || "").includes("GUI 摘录测试书")); return JSON.stringify({ p: bk?.priority }); })()`);
  check("书架：书级优先级已落库（=30）", JSON.parse(libRow || "{}").p === 30, libRow);
  const followedRow = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return JSON.stringify({ p: d?.priority, src: d?.prioritySource }); })()`);
  const fr = JSON.parse(followedRow || "{}");
  check("继承型摘录实时跟随到 30（priority_source=book）", fr.p === 30 && fr.src === "book", followedRow);

  // 12) 筛选牌组（§6.8-5）：保存当前筛选 → 列表可见 → 集中复习路由 → 删除
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  await wait(1600);
  await cdp.eval(`(() => {
    const inp = document.querySelector("[data-deck-name]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "GUI 牌组");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(500);
  // 上限覆写（§6.8-5）：摘录/日 = 1（0 默认 = 继承全局）
  await cdp.eval(`(() => {
    const inp = document.querySelector("[data-deck-cap-extracts]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "1");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(400);
  const savedDeck = await cdp.eval(`(() => { document.querySelector("[data-deck-save]")?.click(); return true; })()`);
  check("筛选牌组：保存按钮在位可点", savedDeck === true, savedDeck);
  await wait(1500);
  const deckStored = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "reviewScopes") || []))()`);
  check("筛选牌组：已落盘 settings.app.reviewScopes", String(deckStored).includes("GUI 牌组"), String(deckStored).slice(0, 160));
  check("筛选牌组：上限覆写随牌组落盘（摘录/日=1）", String(deckStored).includes('"extractReviewsPerDay":1'), String(deckStored).slice(0, 200));
  const cappedSession = await cdp.eval(`(async () => { const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"], limits: { extractReviewsPerDay: 1 } } }); return JSON.stringify({ lim: q.limits.extractReviewsPerDay, n: q.extracts.length }); })()`);
  const cs = JSON.parse(cappedSession || "{}");
  check("筛选牌组：会话按覆写上限截断（摘录/日=1 ⇒ 至多 1 条）", cs.lim === 1 && Number(cs.n) <= 1, cappedSession);
  const deckChip = await cdp.eval(`document.querySelector("[data-deck-item]")?.textContent || ""`);
  check("筛选牌组：列表出现该牌组", String(deckChip).includes("GUI 牌组"), deckChip);
  const startBtn = await cdp.eval(`(() => { const b = document.querySelector("[data-deck-start]"); b?.click(); return !!b; })()`);
  check("筛选牌组：「集中复习」按钮在位可点", startBtn === true, startBtn);
  await wait(1800);
  const inSession = await cdp.eval(`!!document.querySelector(".review-wrap") || !!document.querySelector(".extract-page")`);
  check("筛选牌组：集中复习已进入会话页（复习/摘录）", inSession === true, inSession);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  await wait(1500);
  const delBtn = await cdp.eval(`(() => { const b = document.querySelector("[data-deck-delete]"); b?.click(); return !!b; })()`);
  check("筛选牌组：删除按钮在位可点", delBtn === true, delBtn);
  await wait(1500);
  const afterDel = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "reviewScopes") || []))()`);
  check("筛选牌组：删除后已从设置里移除", !String(afterDel).includes("GUI 牌组"), String(afterDel).slice(0, 160));

  // 13) §H.1 跳转原文不写阅读进度（差分实测：往返 progress_json 逐字节相等）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1600);
  await cdp.eval(`(() => { const t = [...document.querySelectorAll(".book-card-title")][0]; t?.click(); return !!t; })()`);
  await wait(2800);
  check("真实阅读：书可正常打开（阅读器挂载）", (await cdp.eval(`!!document.querySelector(".reader-wrap")`)) === true, "未挂载");
  await cdp.eval(`(() => { const w = document.querySelector(".reader-wrap"); if (w) w.scrollTop = 600; w?.dispatchEvent(new Event("scroll", { bubbles: true })); return true; })()`);
  await wait(1600);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "返回"); b?.click(); return !!b; })()`);
  await wait(2000);
  const progressBaseline = await cdp.eval(`(async () => { const items = await window.libraryAPI.list(); const bk = items.find((x) => String(x.title || "").includes("GUI 摘录测试书")); return bk?.progressJson ?? null; })()`);
  check("真实阅读确实写入了进度（基线非空，防空转）", typeof progressBaseline === "string" && progressBaseline.length > 2, progressBaseline);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return !!b; })()`);
  await wait(1700);
  const jumpOk = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "跳转原文"); b?.click(); return !!b; })()`);
  check("跳转原文：按钮在位可点", jumpOk === true, jumpOk);
  await wait(2800);
  check("跳转原文：阅读器已打开（现场查看语义）", (await cdp.eval(`!!document.querySelector(".reader-wrap")`)) === true, "未打开");
  await cdp.eval(`(() => { const w = document.querySelector(".reader-wrap"); if (w) w.scrollTop = 1200; w?.dispatchEvent(new Event("scroll", { bubbles: true })); return true; })()`);
  await wait(1400);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "返回"); b?.click(); return !!b; })()`);
  await wait(2000);
  const progressAfter = await cdp.eval(`(async () => { const items = await window.libraryAPI.list(); const bk = items.find((x) => String(x.title || "").includes("GUI 摘录测试书")); return bk?.progressJson ?? null; })()`);
  check("跳转往返后 progress_json 逐字节相等（跳转不写进度，需求 ③）", progressAfter === progressBaseline, `before=${String(progressBaseline).slice(0, 80)} after=${String(progressAfter).slice(0, 80)}`);

  // 14) 合并复习（§6.8-3）：开关开启且摘录到期时，复习页用同一张摘录卡面就地处理
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "复习"); b?.click(); return !!b; })()`);
  await wait(2000);
  const mergedFace = await cdp.eval(`(() => { const w = document.querySelector(".review-wrap"); const f = document.querySelector(".extract-face"); return JSON.stringify({ wrap: !!w, face: !!f, text: (f?.textContent || "").slice(0, 60) }); })()`);
  const mf = JSON.parse(mergedFace || "{}");
  check("合并复习：复习页渲染出摘录卡面（不再跳过摘录条目）", mf.wrap === true && mf.face === true, mergedFace);
  check("合并复习：卡面内容为那条摘录", String(mf.text).includes("GUI 摘录样本"), mergedFace);

  // 15) 阅读器两个集中复习按钮（§6.8-8，需求 ⑦）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1600);
  await cdp.eval(`(() => { const t = [...document.querySelectorAll(".book-card-title")][0]; t?.click(); return !!t; })()`);
  await wait(2800);
  // D5-B：两个集中复习入口收进工具栏「更多」弹出组——先开组再取按钮
  const openMore = `(() => { if (!document.querySelector('[data-tool-menu-panel="more"]')) document.querySelector('[data-tool-menu-btn="more"]')?.click(); return 1; })()`;
  await cdp.eval(openMore);
  await wait(500);
  const btnExtract = await cdp.eval(`(() => { const b = document.querySelector("[data-review-extracts]"); const ok = b && !b.disabled; b?.click(); return ok; })()`);
  check("阅读器：「复习摘录」按钮在位可用", btnExtract === true, btnExtract);
  await wait(2000);
  const sessionPage = await cdp.eval(`(() => { const page = document.querySelector(".extract-page"); return JSON.stringify({ page: !!page, header: document.querySelector(".extract-page-header")?.textContent || "" }); })()`);
  const sp = JSON.parse(sessionPage || "{}");
  check("阅读器：进入本书摘录集中复习（页面 + 书名上下文）", sp.page === true && String(sp.header).includes("GUI 摘录测试书"), sessionPage);
  // 返回书架 → 再开书 → 「复习闪卡」
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1500);
  await cdp.eval(`(() => { const t = [...document.querySelectorAll(".book-card-title")][0]; t?.click(); return !!t; })()`);
  await wait(2800);
  await cdp.eval(openMore);
  await wait(500);
  const btnCards = await cdp.eval(`(() => { const b = document.querySelector("[data-review-cards]"); const ok = b && !b.disabled; b?.click(); return ok; })()`);
  check("阅读器：「复习闪卡」按钮在位可用", btnCards === true, btnCards);
  await wait(2000);
  const reviewScoped = await cdp.eval(`(() => { const w = document.querySelector(".review-wrap"); const title = document.querySelector(".topbar-title")?.textContent || ""; return JSON.stringify({ wrap: !!w, title }); })()`);
  const rs = JSON.parse(reviewScoped || "{}");
  check("阅读器：进入本书闪卡集中复习（复习页 + 标题带书名）", rs.wrap === true && String(rs.title).includes("GUI 摘录测试书"), reviewScoped);

  // 16) 摘录正文查找替换（O-8 裁定：仅选中项、纯文本）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return !!b; })()`);
  await wait(1600);
  await cdp.eval(`(() => { document.querySelector("[data-kind-extract]")?.click(); return true; })()`);
  await wait(1200);
  await cdp.eval(`(() => { document.querySelector("[data-sel-all-extracts]")?.click(); return true; })()`);
  await wait(900);
  const fill = (sel, val) => `(() => {
    const inp = document.querySelector("${sel}");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "${val}");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`;
  await cdp.eval(fill("[data-find-input]", "GUI 摘录样本"));
  await wait(400);
  await cdp.eval(fill("[data-replace-input]", "GUI 摘录样本·已替换"));
  await wait(400);
  const replaceClicked = await cdp.eval(`(() => { const b = document.querySelector("[data-find-replace]"); b?.click(); return !!b; })()`);
  check("查找替换：按钮在位可点", replaceClicked === true, replaceClicked);
  await wait(1800);
  const replacedText = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(b.id)}); return d?.contentMarkdown || ""; })()`);
  check("查找替换：正文已落库替换", String(replacedText).includes("已替换"), String(replacedText).slice(0, 80));

  // 17) 浏览器查询语法（§6.8-6）：负号排除 + kind: 字段切类别 + priority 比较
  const qFill = (val) => `(() => {
    const inp = document.querySelector(".cb-toolbar .cb-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "${val}");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`;
  await cdp.eval(`(() => { document.querySelector("[data-kind-card]")?.click(); return true; })()`);
  await wait(1000);
  await cdp.eval(qFill(""));
  await wait(900);
  const rowsBefore17 = await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`);
  check("查询语法：前置对照——闪卡表至少 3 行（防空转）", Number(rowsBefore17) >= 3, rowsBefore17);
  await cdp.eval(qFill("-乙"));
  await wait(1100);
  const rowsAfter17 = await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`);
  const hasYi = await cdp.eval(`document.body.textContent.includes("浏览器批量 乙")`);
  check("查询语法：-乙 缩小结果集", Number(rowsAfter17) < Number(rowsBefore17), `${rowsBefore17} → ${rowsAfter17}`);
  check("查询语法：-乙 后结果里没有该卡", hasYi === false, hasYi);
  await cdp.eval(qFill("kind:extract"));
  await wait(1200);
  const kindSwitch = await cdp.eval(`JSON.stringify({ table: !!document.querySelector("[data-extract-table]"), kindBtn: !!document.querySelector("[data-kind-extract].active") })`);
  const ks = JSON.parse(kindSwitch || "{}");
  check("查询语法：kind:extract 切到摘录页签并出表", ks.table === true && ks.kindBtn === true, kindSwitch);
  await cdp.eval(qFill("priority<=100"));
  await wait(1100);
  const priRows = await cdp.eval(`document.querySelectorAll(".cb-table .cb-row:not(.cb-row-head)").length`);
  check("查询语法：priority<=100 命中（不误伤）", Number(priRows) >= 1, priRows);
  await cdp.eval(qFill(""));

  // 18) AI 重排入口（E1 第二半）：切到实验引擎 → 「立即重排」在位；无 Key 时如实回报（不静默）
  await cdp.eval(`(() => { const b = document.querySelector('button[title="设置"]'); b?.click(); return !!b; })()`);
  await wait(1600);
  await cdp.eval(`(() => { const s = document.querySelector("#sec-extracts"); const dd = [...s.querySelectorAll("button")].find((x) => x.textContent.includes("SuperMemo 传统推送")); dd?.click(); return !!dd; })()`);
  await wait(700);
  const aiPicked = await cdp.eval(`(() => { const items = [...document.querySelectorAll(".dd-item")]; const b = items.find((x) => x.textContent.includes("AI 推送")); b?.click(); return !!b; })()`);
  check("设置：可切到实验引擎（AI 推送）", aiPicked === true, aiPicked);
  await wait(1400);
  const engineSaved = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "extracts") || {}))()`);
  check("设置：引擎已落盘 ai-next-extract", String(engineSaved).includes('"engine":"ai-next-extract"'), String(engineSaved).slice(0, 160));
  const rerankBtn = await cdp.eval(`(() => { const b = document.querySelector("[data-rerank-now]"); const ok = !!b; b?.click(); return ok; })()`);
  check("设置：实验引擎下出现「立即重排」按钮且可点", rerankBtn === true, rerankBtn);
  await wait(2000);
  const rerankNote = await cdp.eval(`(() => { const s = document.querySelector("#sec-extracts"); const ps = [...s.querySelectorAll("p")].map((p) => p.textContent); return ps.find((t) => t.includes("重排")) || ""; })()`);
  const honestOutcome = ["未能重排", "未采用", "已按 AI 重排"].some((k) => String(rerankNote).includes(k));
  check("设置：立即重排给出可读结果（无 Key 时如实回报，不静默）", honestOutcome, String(rerankNote).slice(0, 160));
  // 还原为默认引擎（后续无依赖，但保持状态干净）
  await cdp.eval(`(() => { const s = document.querySelector("#sec-extracts"); const dd = [...s.querySelectorAll("button")].find((x) => x.textContent.includes("AI 推送")); dd?.click(); return !!dd; })()`);
  await wait(700);
  await cdp.eval(`(() => { const items = [...document.querySelectorAll(".dd-item")]; const b = items.find((x) => x.textContent.includes("SuperMemo 传统推送")); b?.click(); return !!b; })()`);
  await wait(1200);

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
