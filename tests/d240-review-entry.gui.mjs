// D240 端到端：复习页入场方向——从顶栏（或任何跨视图入口）进入复习页时，首张卡不再自播 stage-card-in
// （24px 自右往左），入场只由 §5.1 方向性页面过渡承担：书架/摘录→复习＝新页自右往左入（fwd），
// 推荐/卡片/数据→复习＝自左往右入（bwd）；页内换卡（评分推进 / 摘录下一条）stage-card-in 照常。
// @runtime: node  @tier: 2  @gui: true  @id: D240ENTRY  @timeout: 300
// 运行：npm run build 之后 `node tests/d240-review-entry.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关；
// Linux 无显示环境用 `xvfb-run -a node tests/d240-review-entry.gui.mjs`）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d240-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 口径（D106 先例「写了规则不等于生效」）：断言计算样式 animationName 与 document.getAnimations() 名单——
// 入场全程（过渡遮罩在场 data-vt 期间 + 揭幕后）首卡都不得出现 stage-card-in，方向位移只来自页面过渡。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9276";
const USER_DATA = path.join(ROOT, "tests", "tmp-d240-userdata");
const SANDBOX = process.platform === "linux" ? ["--no-sandbox"] : [];

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

const nav = (cdp, label) => cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
const CARD = ".review-flip";
const EXTRACT = ".extract-face";
/** 复习页快照：vt/dir＝过渡遮罩与方向；face＝卡面在场；mark＝页面根首卡标记；anim＝卡面计算 animationName；
    text＝卡面文字（认是哪一张）；names＝document.getAnimations() 在播动画名（含过渡伪元素上的方向位移） */
const probe = (sel) => `(() => {
  const root = document.documentElement;
  const wrap = document.querySelector(".review-wrap");
  const face = wrap ? wrap.querySelector(${JSON.stringify(sel)}) : null;
  const names = document.getAnimations().map((a) => a.animationName || "").filter(Boolean);
  return JSON.stringify({
    vt: root.dataset.vt || null,
    dir: root.dataset.vtDir || null,
    face: !!face,
    mark: !!(wrap && wrap.hasAttribute("data-first-card")),
    anim: face ? getComputedStyle(face).animationName : null,
    text: face ? (face.textContent || "").replace(/\\s+/g, " ").slice(0, 60) : "",
    names
  });
})()`;
const sample = async (cdp, sel) => JSON.parse(String(await cdp.eval(probe(sel))) || "{}");

/** 点顶栏进入复习页，连续采样到「卡面已出现且过渡已结算」：返回首个遮罩样本、首个卡面样本、揭幕后样本与全程动画名 */
async function enter(cdp, label, sel, timeout = 5000) {
  await nav(cdp, label);
  const t0 = Date.now();
  let first = null;
  let faceSample = null;
  const names = new Set();
  const anims = new Set();
  while (Date.now() - t0 < timeout) {
    const s = await sample(cdp, sel);
    (s.names || []).forEach((n) => names.add(n));
    if (s.face) anims.add(s.anim);
    if (!first && s.vt === "1") first = s;
    if (s.face && !faceSample) faceSample = s;
    if (faceSample && !s.vt) break;
    await wait(10);
  }
  await wait(400); // 揭幕后再等一个 --dur-stage（240ms）以上：闸门打开后不得迟到重放
  const after = await sample(cdp, sel);
  (after.names || []).forEach((n) => names.add(n));
  if (after.face) anims.add(after.anim);
  return { first: first || {}, faceSample: faceSample || {}, after, names: [...names], anims: [...anims] };
}
/** 等复习页出现指定文字的卡面 */
async function waitText(cdp, sel, needle, ms = 6000) {
  const t0 = Date.now();
  let s = await sample(cdp, sel);
  while (!(s.face && s.text.includes(needle)) && Date.now() - t0 < ms) { await wait(30); s = await sample(cdp, sel); }
  return s;
}
const leave = async (cdp, label) => { await nav(cdp, label); await wait(900); };

function assertEntry(tag, r, dir, needle) {
  check(`${tag}：页面过渡方向＝${dir}`, r.first.vt === "1" && r.first.dir === dir, JSON.stringify(r.first));
  check(`${tag}：首张卡面在场（${needle}）`, r.after.face === true && r.after.text.includes(needle), JSON.stringify(r.after));
  check(`${tag}：首卡出现即带页面根首卡标记 data-first-card`, r.faceSample.mark === true, JSON.stringify(r.faceSample));
  check(`${tag}：首卡全程不播 stage-card-in（计算样式恒 none）`, r.anims.length > 0 && r.anims.every((a) => a === "none"), JSON.stringify(r.anims));
  check(`${tag}：入场全程 getAnimations 无 stage-card-in`, !r.names.includes("stage-card-in"), JSON.stringify(r.names));
  check(`${tag}：揭幕后标记仍在、不迟到重放`, r.after.mark === true && r.after.anim === "none" && r.after.vt === null, JSON.stringify(r.after));
}

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync(`npx electron ${SANDBOX.join(" ")} tests/d240-review-entry.gui.seed.cjs`, {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const idsLine = String(seeded).split("\n").find((l) => l.startsWith("SEEDED "));
  check("播种成功（三张新卡 + 一条到期摘录）", !!idsLine, String(seeded).slice(-160));

  const out = openSync(path.join(ROOT, "tests", "d240-review-entry.gui.log"), "w");
  electron = spawn("npx", ["electron", ...SANDBOX, ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");
  // 前置：分开处理（默认）——复习页只推闪卡
  await cdp.eval(`(async () => { const cur = (await window.settingsAPI.get("app", "extracts")) || {}; await window.settingsAPI.set("app", "extracts", { ...cur, mergeIntoReview: false }); return true; })()`);
  await leave(cdp, "书架");

  // ① 书架(0) → 复习(2)：fwd，新页自右往左入；首卡不自播右滑
  const r1 = await enter(cdp, "复习", CARD);
  assertEntry("① 书架→复习", r1, "fwd", "D240 卡一");
  check("① 页面过渡位移在场（view-in-fwd）", r1.names.includes("view-in-fwd"), JSON.stringify(r1.names));

  // ② 页内换卡：显示答案 → 评「良好」→ 卡二 —— 标记当帧摘除，stage-card-in 照常（队列前进方向不变）
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return true; })()`);
  await wait(700);
  await cdp.eval(`(() => { document.querySelector(".grade.grade-good")?.click(); return true; })()`);
  const s2 = await waitText(cdp, CARD, "D240 卡二");
  check("② 评分后换到卡二", s2.face && s2.text.includes("D240 卡二"), JSON.stringify(s2));
  check("② 页内换卡：首卡标记已摘除", s2.mark === false, JSON.stringify(s2));
  check("② 页内换卡：新卡 stage-card-in 照常", s2.anim === "stage-card-in", JSON.stringify(s2));

  // ③ 数据(5) → 复习(2)：bwd，新页自左往右入；首卡（卡二）不自播右滑
  await leave(cdp, "数据");
  const r3 = await enter(cdp, "复习", CARD);
  assertEntry("③ 数据→复习", r3, "bwd", "D240 卡二");
  check("③ 页面过渡位移在场（view-in-bwd）", r3.names.includes("view-in-bwd"), JSON.stringify(r3.names));

  // ④ 卡片(4) → 复习(2)：bwd（另一条自右侧页签返回的路径）
  await leave(cdp, "卡片");
  const r4 = await enter(cdp, "复习", CARD);
  assertEntry("④ 卡片→复习", r4, "bwd", "D240 卡二");

  // ⑤ 混合复习：队首是摘录（与摘录页同一张卡面 .extract-face）——自数据页返回（bwd）首条同样不自播右滑
  await cdp.eval(`(async () => { const cur = (await window.settingsAPI.get("app", "extracts")) || {}; await window.settingsAPI.set("app", "extracts", { ...cur, mergeIntoReview: true, interleave: "by-due" }); return true; })()`);
  await leave(cdp, "数据");
  const r5 = await enter(cdp, "复习", EXTRACT);
  assertEntry("⑤ 混合复习 数据→复习（摘录首条）", r5, "bwd", "D240 摘录");

  // ⑥ 摘录「下一条」→ 卡二：页内换条，stage-card-in 照常
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".review-wrap button")].find((x) => x.textContent.trim() === "下一条"); b?.click(); return !!b; })()`);
  const s6 = await waitText(cdp, CARD, "D240 卡二");
  check("⑥ 摘录推进后换到卡二", s6.face && s6.text.includes("D240 卡二"), JSON.stringify(s6));
  check("⑥ 页内换条：首卡标记已摘除、新卡 stage-card-in 照常", s6.mark === false && s6.anim === "stage-card-in", JSON.stringify(s6));

  // ⑦ 书架(0) → 复习(2)：fwd 方向在混合复习下同样成立（首条＝卡二，摘录已推进）
  await leave(cdp, "书架");
  const r7 = await enter(cdp, "复习", CARD);
  assertEntry("⑦ 混合复习 书架→复习", r7, "fwd", "D240 卡二");

  console.log(`\n==== d240-review-entry.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
