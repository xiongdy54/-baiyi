// M16 批注化摘录 · 面包屑 GUI 端到端（真键鼠 CDP，规格 §1.2 R13 / 契约 §6.8-11）
// @runtime: node  @tier: 2  @gui: true  @id: BREADCRUMB  @timeout: 300
// 运行：npm run build 之后 `node tests/breadcrumb.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关、可 taskkill electron）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-breadcrumb-userdata（先清空；播种植入夹具，绝不触碰真实库 §7.3）。
// 夹具（tests/breadcrumb.gui.seed.cjs）：链甲 3 级（孙＝队列头）· 链乙 6 级 · 链丙 8 级 + 各层范围锚。
// 断言链（本次口径：**≤6 级全显示；>6 级才折叠**，折叠只压缩占位、不减少可达性）：
//   ① 3 级链 → 面包屑 3 层且层级名＝该层正文首 10 字（超出省略）
//   ② 点第 1 级 → 切到根卡（查看态，只读不写调度）→ 点「返回队列」回到原卡
//   ③ 6 级链 → 全显示（**不是**「超 4 级就折叠」）· 8 级链 → 出现「…N 级」，N＝被隐藏层数 5
//   ④ 点「…N 级」列出被隐藏层级（项数＝N，每项＝层级序号 + 正文前若干字）→ 点其中一层真的切过去（可达性）
//   ⑤ 当前层不可点（不是按钮；真鼠标点它不改变当前卡）
//   ⑥ 摘录页「摘录」＝就地另立子摘录（parent_type=extract / parent_id=当前摘录），
//      contextRef 带 parentExtractId 与 rootExtractId（根摘录 rootExtractId＝自身 id）
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9233";
const USER_DATA = path.join(ROOT, "tests", "tmp-breadcrumb-userdata");
const BOOK_TITLE = "面包屑 GUI 夹具书";
/** 夹具层级正文的前缀（与 seed 同一写法）：层级名＝正文首 10 字 */
const A = (level) => `甲3级-${level}稿：`;
const B = (level) => `乙6层-${level}稿：`;
const C = (level) => `丙8层-${level}稿：`;
const NAME_LEN = 10; // 层级名取正文首 10 字（规格 §1.2 的 8–12 字区间内）

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
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
  // 1) 预播种（独立进程建库 + 造三条已到期的层级链）
  execSync("npx electron tests/breadcrumb.gui.seed.cjs", {
    cwd: ROOT, shell: true, stdio: "ignore",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  // 2) 启动真实应用（同一 userData）
  const out = openSync(path.join(ROOT, "tests", "breadcrumb.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 真鼠标点击工具（CDP Input；hover 先到位，与 multiselect.gui 同规）
  const clickAt = async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: 0 });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
    await wait(700);
  };
  /** 元素的视口中心坐标（找不到就返回空串） */
  const rectOf = (sel) => cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
  })()`);
  const clickSel = async (sel) => {
    const raw = await rectOf(sel);
    if (!String(raw).startsWith("{")) return false;
    const r = JSON.parse(String(raw));
    await clickAt(r.x, r.y);
    return true;
  };
  /** 摘录页现状：显示的是哪张卡、面包屑各段文本、动作是否存在 */
  const pageState = () => cdp.eval(`(() => {
    const page = document.querySelector(".extract-page");
    const crumbs = document.querySelector(".extract-crumbs");
    const face = document.querySelector(".extract-face");
    const marks = [...document.querySelectorAll(".extract-face-body .extract-quote-hl")].map((m) => m.textContent);
    return JSON.stringify({
      showing: page ? (page.getAttribute("data-showing-extract-id") || "") : null,
      viewing: page ? page.getAttribute("data-viewing") === "1" : null,
      faceId: face ? face.getAttribute("data-extract-id") : null,
      rootLabel: crumbs ? (crumbs.querySelector(".crumb-root")?.textContent || "") : "",
      items: crumbs ? [...crumbs.querySelectorAll(".crumb-item")].map((b) => b.textContent) : [],
      here: crumbs ? [...crumbs.querySelectorAll(".crumb-here")].map((s) => s.textContent) : [],
      hereTag: crumbs ? (crumbs.querySelector(".crumb-here")?.tagName || "") : "",
      seps: crumbs ? [...crumbs.querySelectorAll(".crumb-sep")].map((s) => s.textContent) : [],
      more: crumbs ? (crumbs.querySelector("[data-crumb-more]")?.textContent || "") : "",
      menuOpen: !!document.querySelector(".crumb-menu-item"),
      menuItems: [...document.querySelectorAll(".crumb-menu-item")].map((b) => b.textContent),
      body: (document.querySelector(".extract-face-body")?.textContent || "").slice(0, 200),
      hl: marks,
      actions: [...document.querySelectorAll(".extract-face-actions button")].map((b) => b.textContent.trim()),
      hint: document.querySelector("[data-page-hint]")?.textContent || ""
    });
  })()`);

  /** 夹具真值（从库侧独立取；层级名按「正文首 10 字 + …」在测试里独立复算，不从链 API 反推） */
  const rawRows = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    return JSON.stringify((all || []).map((e) => ({ id: e.id, md: e.contentMarkdown, pt: e.parentType, pid: e.parentId, ref: e.contextRef })));
  })()`);
  const rows = JSON.parse(String(rawRows) || "[]");
  const row = (prefix) => rows.find((r) => String(r.md || "").startsWith(prefix));
  const name = (row) => {
    const t = String((row && row.md) || "");
    return t.length > NAME_LEN ? `${t.slice(0, NAME_LEN)}…` : t;
  };
  const fx = {
    A1: row(A(1)), A2: row(A(2)), A3: row(A(3)),
    B6: row(B(6)), C3: row(C(3)), C7: row(C(7)), C8: row(C(8)),
    B: (i) => row(B(i)), C: (i) => row(C(i))
  };
  check("夹具播种到位（3 / 6 / 8 三条链共 17 条摘录）", rows.length === 17 && fx.A1 && fx.A3 && fx.B6 && fx.C8, `rows=${rows.length}`);

  // 3) 顶栏「摘录」进入沉浸式页（队列头＝链甲第 3 层）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return !!b; })()`);
  await wait(1800);
  let st = JSON.parse(String(await pageState()) || "{}");
  check("队列头＝链甲第 3 层（夹具优先级排好）", st.showing === fx.A3?.id, `showing=${st.showing} A3=${fx.A3?.id}`);

  // ---------- ① 3 级链：层级名＝各层正文前段 ----------
  const names3 = [name(fx.A1), name(fx.A2), name(fx.A3)];
  check("① 面包屑含「原文」起点", st.rootLabel === "原文", st.rootLabel);
  check("① 分隔符是「›」（Meta 档 --text-helper）", st.seps.length === 3 && st.seps.every((s) => s === "›"), JSON.stringify(st.seps));
  check("① 3 级链＝3 个层级名（全显示，不折叠）", st.items.length === 2 && st.here.length === 1 && st.more === "", JSON.stringify({ items: st.items, here: st.here, more: st.more }));
  check("① 层级名与各层正文前 10 字一致（超出省略）", JSON.stringify([...st.items, ...st.here]) === JSON.stringify(names3), JSON.stringify({ got: [...st.items, ...st.here], want: names3 }));

  // ---------- ⑥ 摘录页「摘录」＝就地另立子摘录（前置贯通）----------
  check("⑥ 卡面动作行含「摘录」", st.actions.includes("摘录"), JSON.stringify(st.actions));
  await clickSel("[data-extract-child]");
  await wait(1200);
  const childRow = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const kid = (all || []).filter((e) => e.parentType === "extract" && e.parentId === ${JSON.stringify(fx.A3?.id)});
    const p = (all || []).find((e) => e.id === ${JSON.stringify(fx.A1?.id)}) || {};
    const sib = (all || []).find((e) => e.id === ${JSON.stringify(fx.A2?.id)}) || {};
    return JSON.stringify({
      n: kid.length,
      child: kid[0] ? { md: kid[0].contentMarkdown, ref: kid[0].contextRef } : null,
      rootRefSelf: (p.contextRef || {}).rootExtractId === p.id,
      midRef: (sib.contextRef || {}).rootExtractId
    });
  })()`);
  const kid = JSON.parse(String(childRow) || "{}");
  check("⑥ 「摘录」落库一条子摘录（parent_type=extract / parent_id=当前摘录）", kid.n === 1, childRow);
  check("⑥ 子摘录文本＝卡面正文（无选区时取整条）", kid.child && String(kid.child.md) === String(fx.A3.md), JSON.stringify(kid.child && kid.child.md));
  check("⑥ contextRef 注入 parentExtractId＝当前摘录", kid.child && kid.child.ref && kid.child.ref.parentExtractId === fx.A3?.id, JSON.stringify(kid.child && kid.child.ref));
  check("⑥ contextRef 注入 rootExtractId＝链根（继承父的）", kid.child && kid.child.ref && kid.child.ref.rootExtractId === fx.A1?.id, JSON.stringify(kid.child && kid.child.ref));
  check("⑥ 根摘录 rootExtractId＝自身 id（根锚由 db 侧补）", kid.rootRefSelf === true && kid.midRef === fx.A1?.id, JSON.stringify(kid));

  // ---------- ② 点第 1 级 → 根卡（查看态）→ 「返回队列」回原卡 ----------
  const beforeView = await cdp.eval(`(async () => {
    const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } });
    const e = q.extracts[0];
    return JSON.stringify({ id: e?.id, pc: e?.processCount, ivl: e?.intervalDays, n: q.extracts.length });
  })()`);
  const bv = JSON.parse(String(beforeView) || "{}");
  const lvl1Clicked = await clickSel(".extract-crumbs .crumb-item");
  check("② 第 1 级是可点按钮（真鼠标命中）", lvl1Clicked === true, lvl1Clicked);
  await wait(1200);
  st = JSON.parse(String(await pageState()) || "{}");
  check("② 点第 1 级切到根卡（查看态）", st.viewing === true && st.showing === fx.A1?.id && st.faceId === fx.A1?.id, JSON.stringify({ viewing: st.viewing, showing: st.showing, faceId: st.faceId }));
  check("② 查看态正文＝根卡正文", String(st.body).startsWith(A(1)), st.body);
  check("② 落点：根卡范围锚在卡面上以高亮呈现", st.hl.length === 1 && st.hl[0] === "ROOTAHL", JSON.stringify(st.hl));
  check("② 查看态不出调度动作（不推进调度）", !st.actions.includes("下一条") && !st.actions.includes("毕业"), JSON.stringify(st.actions));
  // 落点几何（根层正文刻意写长 ⇒ 容器真可滚，量测不是空转）：高亮段在落点后必须在可视区内且靠近中部
  const geo = await cdp.eval(`(() => {
    const page = document.querySelector(".extract-page");
    const head = document.querySelector(".extract-page-head");
    const hl = document.querySelector(".extract-face-body .extract-quote-hl");
    if (!page || !hl || !head) return "";
    const pr = page.getBoundingClientRect();
    const hr = hl.getBoundingClientRect();
    const hd = head.getBoundingClientRect();
    const cs = getComputedStyle(head);
    // 命中测试：头行区里取一点，看它被头行盖住还是透出了正文（「吸顶无缝」的机器判据）
    const probe = (el) => (el ? String(el.className || el.tagName).split(" ")[0] : "none");
    const hitTop = probe(document.elementFromPoint(Math.round((pr.left + pr.right) / 2), Math.round(pr.top + 8)));
    const hitCrumb = probe(document.elementFromPoint(Math.round((hd.left + hd.right) / 2), Math.round(hd.top + 12)));
    return JSON.stringify({
      scrollable: Math.round(page.scrollHeight - page.clientHeight),
      scrollTop: Math.round(page.scrollTop),
      pageTop: Math.round(pr.top), pageBottom: Math.round(pr.bottom), pageH: Math.round(pr.height),
      headTop: Math.round(hd.top), headH: Math.round(hd.height),
      headPos: cs.position, headBg: cs.backgroundColor,
      hitTop, hitCrumb,
      hlTop: Math.round(hr.top), hlBottom: Math.round(hr.bottom),
      centerDelta: Math.round(Math.abs(hr.top + hr.height / 2 - (pr.top + pr.height / 2)))
    });
  })()`);
  const g = JSON.parse(String(geo) || "{}");
  check("② 正对照：卡面长于容器（滚动量 > 200px，量测非空转）", Number(g.scrollable) > 200 && Number(g.scrollTop) > 100, geo);
  check("② 面包屑吸顶且无缝（滚动后头行贴住容器顶、底色不透明、命中测试落在头行上）", g.headPos === "sticky" && Number(g.headTop) <= Number(g.pageTop) + 1 && String(g.headBg) !== "rgba(0, 0, 0, 0)" && /extract-page-head|extract-crumbs|review-count|extract-page-hint|crumb-/.test(String(g.hitTop)), geo);
  check("② 落点：高亮段落在可视区内（未滚出屏外）", Number(g.hlTop) >= Number(g.pageTop) - 2 && Number(g.hlBottom) <= Number(g.pageBottom) + 2, geo);
  check(`② 落点居中：高亮段中心与可视区中心差 ≤ 1/4 视高（实测 Δ=${g.centerDelta}px / 视高 ${g.pageH}px · 滚动量 ${g.scrollable}px）`, Number(g.centerDelta) <= Math.round(Number(g.pageH) / 4), geo);
  // 视觉留证：查看态（只读 + 高亮落点 + 吸顶面包屑 + 「返回队列」）
  try {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const data = shot?.result?.data;
    if (data) {
      fs.writeFileSync(path.join(ROOT, "tests", "tmp-breadcrumb-view.png"), Buffer.from(data, "base64"));
      console.log("  · 视觉留证：tests/tmp-breadcrumb-view.png");
    } else {
      console.log("  · 视觉留证失败：截图载荷为空");
    }
  } catch (e) {
    console.log("  · 视觉留证失败：" + String(e && e.message ? e.message : e).slice(0, 120));
  }
  check("② 查看态提示改为只读口径", String(st.hint).includes("查看态"), st.hint);
  const afterView = await cdp.eval(`(async () => {
    const q = await window.sessionAPI.queue(undefined, { scope: { kinds: ["extract"] } });
    const e = q.extracts[0];
    const d = await window.workflowAPI.get(${JSON.stringify(bv.id)});
    return JSON.stringify({ id: e?.id, pc: d?.processCount, ivl: d?.intervalDays, n: q.extracts.length });
  })()`);
  const av = JSON.parse(String(afterView) || "{}");
  check("② 查看态零写入：队列头 / 计数 / 间隔全不变", av.id === bv.id && av.n === bv.n && av.pc === bv.pc && av.ivl === bv.ivl, `before=${beforeView} after=${afterView}`);
  const backClicked = await clickSel("[data-crumb-exit]");
  check("② 「返回队列」出口在位可点", backClicked === true, backClicked);
  await wait(1200);
  st = JSON.parse(String(await pageState()) || "{}");
  check("② 返回队列后回到原卡（会话态，动作行回来）", st.viewing === false && st.showing === fx.A3?.id && st.actions.includes("下一条"), JSON.stringify({ viewing: st.viewing, showing: st.showing }));

  // ---------- ⑤ 当前层不可点 ----------
  check("⑤ 当前层不是按钮（span + aria-current，Tab 也不该停在这里）", st.hereTag === "SPAN" && st.here.length === 1 && st.here[0] === name(fx.A3), JSON.stringify({ hereTag: st.hereTag, here: st.here }));
  await clickSel(".extract-crumbs .crumb-here");
  await wait(900);
  const afterClickHere = JSON.parse(String(await pageState()) || "{}");
  check("⑤ 真鼠标点当前层：不改变当前卡、不进查看态", afterClickHere.showing === fx.A3?.id && afterClickHere.viewing === false, JSON.stringify({ showing: afterClickHere.showing, viewing: afterClickHere.viewing }));

  // 键盘可达：Tab 至少能停到面包屑里的某一层
  await cdp.eval(`(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); return true; })()`);
  let focusedCrumb = "";
  let tabPresses = 0;
  for (let i = 0; i < 30 && !focusedCrumb; i++) {
    tabPresses = i + 1;
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0 });
    await wait(120);
    focusedCrumb = await cdp.eval(`(() => { const a = document.activeElement; return a && a.closest && a.closest(".extract-crumbs") ? a.textContent : ""; })()`);
  }
  check("⑤ 键盘可达：Tab 能停在面包屑层级项上", Boolean(focusedCrumb), `按了 ${tabPresses} 次 Tab，落在：${focusedCrumb}`);

  // ---------- 前进到下一条（链乙 6 级）→ 边界：≤6 级全显示 ----------
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "下一条"); b?.click(); return !!b; })()`);
  await wait(2000);
  st = JSON.parse(String(await pageState()) || "{}");
  check("边界前置：队列头切到链乙第 6 层", st.showing === fx.B6?.id, `showing=${st.showing} B6=${fx.B6?.id}`);
  const names6 = [1, 2, 3, 4, 5, 6].map((i) => name(fx.B(i)));
  check("③ 6 级链全显示（6 个层级名，**不是**「超 4 级就折叠」）", st.items.length === 5 && st.here.length === 1 && st.more === "", JSON.stringify({ items: st.items, here: st.here, more: st.more }));
  check("③ 6 级链层级名逐层正确", JSON.stringify([...st.items, ...st.here]) === JSON.stringify(names6), JSON.stringify({ got: [...st.items, ...st.here], want: names6 }));

  // ---------- 前进到下一条（链丙 8 级）→ 折叠 ----------
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "下一条"); b?.click(); return !!b; })()`);
  await wait(2000);
  st = JSON.parse(String(await pageState()) || "{}");
  check("边界前置：队列头切到链丙第 8 层", st.showing === fx.C8?.id, `showing=${st.showing} C8=${fx.C8?.id}`);
  check("③ 8 级链出现折叠段「…5 级」（N＝8−1−2＝5 个被隐藏层级）", st.more === "…5 级", JSON.stringify({ more: st.more, items: st.items, here: st.here }));
  check("③ 折叠后首层 + 末两级 + 当前在列（可达性未被压缩掉）", JSON.stringify(st.items) === JSON.stringify([name(fx.C(1)), name(fx.C(7))]) && st.here.length === 1 && st.here[0] === name(fx.C(8)), JSON.stringify({ items: st.items, here: st.here }));

  // ---------- ④ 折叠段可点开 + 逐项可达 ----------
  const moreClicked = await clickSel("[data-crumb-more]");
  check("④ 折叠段是可点按钮（真鼠标命中）", moreClicked === true, moreClicked);
  await wait(800);
  st = JSON.parse(String(await pageState()) || "{}");
  check("④ 点折叠段列出被隐藏层级（项数＝N＝5）", st.menuOpen === true && st.menuItems.length === 5, JSON.stringify({ menuOpen: st.menuOpen, menuItems: st.menuItems }));
  const wantHidden = [2, 3, 4, 5, 6].map((i) => `第${i}层${name(fx.C(i))}`);
  check("④ 每项＝层级序号 + 正文前若干字（第2层…第6层）", JSON.stringify(st.menuItems) === JSON.stringify(wantHidden), JSON.stringify({ got: st.menuItems, want: wantHidden }));
  // 视觉留证（§7.3 视觉判读义务）：折叠列表展开时的整页截图，供人工核对面包屑与折叠菜单
  try {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const data = shot?.result?.data;
    if (data) {
      fs.writeFileSync(path.join(ROOT, "tests", "tmp-breadcrumb-crumb.png"), Buffer.from(data, "base64"));
      console.log("  · 视觉留证：tests/tmp-breadcrumb-crumb.png");
    } else {
      console.log("  · 视觉留证失败：截图载荷为空");
    }
  } catch (e) {
    console.log("  · 视觉留证失败：" + String(e && e.message ? e.message : e).slice(0, 120));
  }
  const hidClicked = await clickSel(`.crumb-menu-item:nth-child(2)`);
  check("④ 折叠列表里的项可点（真鼠标命中第 3 层）", hidClicked === true, hidClicked);
  await wait(1400);
  st = JSON.parse(String(await pageState()) || "{}");
  check("④ 点折叠项真的切到该层卡片（可达性硬要求）", st.viewing === true && st.showing === fx.C3?.id && st.faceId === fx.C3?.id, JSON.stringify({ viewing: st.viewing, showing: st.showing, faceId: st.faceId }));
  check("④ 切过去后正文＝该层正文、落点高亮在场", String(st.body).startsWith(C(3)) && st.hl[0] === "PROP8L3HL", JSON.stringify({ body: st.body.slice(0, 60), hl: st.hl }));
  check("④ 查看该层时面包屑显示它自己的链（当前层换位）", st.here.length === 1 && st.here[0] === name(fx.C3), JSON.stringify(st.here));
  await clickSel("[data-crumb-exit]");
  await wait(1200);
  st = JSON.parse(String(await pageState()) || "{}");
  check("④ 返回队列回到链丙第 8 层（查看态只有一个出口，语义不漂）", st.viewing === false && st.showing === fx.C8?.id, JSON.stringify({ viewing: st.viewing, showing: st.showing }));

  console.log(`\n==== breadcrumb.gui：${pass} 通过 / ${fail} 失败 ====`);
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
