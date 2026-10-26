// D232 端到端：混合复习（SuperMemo 式）——复习页里摘录与闪卡穿插时，撤销走统一链、摘录条目认空格/回车、
// 动作防连击、撤销标签随类别；设置页「复习方式」二选一（混编规则只在混合复习下出现）
// @runtime: node  @tier: 2  @gui: true  @id: D232MIX  @timeout: 300
// 运行：npm run build 之后 `node tests/d232-mixed-review.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d232-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9272";
const USER_DATA = path.join(ROOT, "tests", "tmp-d232-userdata");
const SANDBOX = process.platform === "linux" ? ["--no-sandbox"] : [];

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
async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: 0 });
  await wait(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
}
/** 真键盘（CDP Input）：modifiers 位 Alt=1 Ctrl=2 Meta=4 Shift=8 */
async function key(cdp, k, code, vk, modifiers = 0, autoRepeat = false) {
  // 回车 / 空格带 text（真键盘会产生字符事件——按钮的原生激活靠它；无修饰时才带）
  const text = modifiers === 0 ? (k === "Enter" ? "\r" : k === " " ? " " : undefined) : undefined;
  await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, autoRepeat, ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
}
const SPACE = [" ", "Space", 32];
const ENTER = ["Enter", "Enter", 13];
const Z = ["z", "KeyZ", 90];
const THREE = ["3", "Digit3", 51];
/** 复习页此刻显示什么：card＝闪卡（back＝背面评分行在场）；extract＝摘录卡面 */
const shown = async (cdp) => JSON.parse(String(await cdp.eval(`(() => {
  const w = document.querySelector(".review-wrap");
  if (!w) return JSON.stringify({ kind: "none" });
  const ex = w.querySelector(".extract-face");
  if (ex) return JSON.stringify({ kind: "extract", text: (ex.textContent || "").slice(0, 80) });
  const t = w.innerText || "";
  const which = t.includes("D232 卡甲") ? "A" : t.includes("D232 卡乙") ? "B" : null;
  // 加载中 / 过渡帧（还没有卡面文字）不算「显示了一张卡」
  if (!which) return JSON.stringify({ kind: "none" });
  return JSON.stringify({ kind: "card", which, back: !!w.querySelector(".grade-row") });
})()`)) || "{}");
const exDetail = async (cdp, id) => JSON.parse(String(await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(id)}); return JSON.stringify({ pc: d?.processCount, ivl: d?.intervalDays, p: d?.priority }); })()`)) || "{}");
const cardReps = async (cdp, id) => Number(await cdp.eval(`(async () => { const c = await window.cardsAPI.get(${JSON.stringify(id)}); const f = c?.fsrs ?? (c?.fsrsJson ? JSON.parse(c.fsrsJson) : null); return f?.reps ?? -1; })()`));
async function waitShown(cdp, pred, ms = 6000) {
  const t0 = Date.now();
  let s = await shown(cdp);
  while (!pred(s) && Date.now() - t0 < ms) { await wait(200); s = await shown(cdp); }
  return s;
}
const nav = (cdp, label) => cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
const blur = (cdp) => cdp.eval(`(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); return true; })()`);

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync(`npx electron ${SANDBOX.join(" ")} tests/d232-mixed-review.gui.seed.cjs`, {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const idsLine = String(seeded).split("\n").find((l) => l.startsWith("SEEDED "));
  check("播种成功（两张新卡 + 一条到期摘录）", !!idsLine, String(seeded).slice(-160));
  const { a: idA, x: idX } = JSON.parse(idsLine ? idsLine.slice(7) : "{}");

  const out = openSync(path.join(ROOT, "tests", "d232-mixed-review.gui.log"), "w");
  electron = spawn("npx", ["electron", ...SANDBOX, ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");
  // 混合复习 + 按到期时间混排（确定序：卡甲 → 摘录 → 卡乙）
  await cdp.eval(`(async () => { const cur = (await window.settingsAPI.get("app", "extracts")) || {}; await window.settingsAPI.set("app", "extracts", { ...cur, mergeIntoReview: true, interleave: "by-due" }); return true; })()`);
  await nav(cdp, "复习");
  const s0 = await waitShown(cdp, (s) => s.kind === "card", 10000);
  await wait(800); // 入场过渡走完再按键
  check("混合复习：队首是卡甲（正面）", s0.kind === "card" && s0.which === "A" && !s0.back, JSON.stringify(s0));

  // ① 评卡甲 → 轮到摘录；Z 撤销的是刚才的评分（统一链最近一项）→ 回到卡甲背面
  await key(cdp, ...SPACE);
  await waitShown(cdp, (s) => s.kind === "card" && s.back === true);
  await key(cdp, ...THREE);
  const s1 = await waitShown(cdp, (s) => s.kind === "extract");
  check("评完卡甲后推送摘录（同一会话穿插）", s1.kind === "extract" && String(s1.text).includes("D232 摘录"), JSON.stringify(s1));
  await key(cdp, ...Z);
  const s2 = await waitShown(cdp, (s) => s.kind === "card");
  check("摘录上按 Z＝撤销最近一次操作（卡甲评分）→ 回到卡甲背面", s2.kind === "card" && s2.which === "A" && s2.back === true, JSON.stringify(s2));
  check("卡甲评分已撤回（reps 回 0）", (await cardReps(cdp, idA)) === 0, await cardReps(cdp, idA));

  // ② 重评卡甲 → 摘录；空格＝下一条（读后推进）
  await key(cdp, ...THREE);
  await waitShown(cdp, (s) => s.kind === "extract");
  await blur(cdp);
  await key(cdp, ...SPACE);
  const s3 = await waitShown(cdp, (s) => s.kind === "card");
  const d3 = await exDetail(cdp, idX);
  check("摘录条目按空格＝下一条（process_count 0→1，换到卡乙）", Number(d3.pc) === 1 && s3.kind === "card" && s3.which === "B", `${JSON.stringify(d3)} ${JSON.stringify(s3)}`);
  if (Number(d3.pc) !== 1) {
    // 旧实现空格无反应：点「下一条」把流程推进下去，后续撤销顺序断言照常有效
    await cdp.eval(`(() => { const b = [...document.querySelectorAll(".review-wrap .extract-face-actions button")].find((x) => x.textContent.trim() === "下一条"); b?.click(); return !!b; })()`);
    await waitShown(cdp, (s) => s.kind === "card");
  }

  // ③ 卡乙正面时，「更多」里的撤销入口指向摘录操作（统一链最近一项是推进摘录）
  await cdp.eval(`(() => { const m = [...document.querySelectorAll(".review-bar button")].find((x) => x.textContent.trim().startsWith("更多")); m?.click(); return !!m; })()`);
  await wait(400);
  const undoLabel = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".review-bar .bar-pop button")].find((x) => x.textContent.startsWith("撤销")); return b ? b.textContent.trim() : null; })()`);
  check("撤销入口标签＝「撤销摘录操作」（不是「撤销评分」）", String(undoLabel).startsWith("撤销摘录操作"), undoLabel);
  await cdp.eval(`(() => { const m = [...document.querySelectorAll(".review-bar button")].find((x) => x.textContent.trim().startsWith("更多")); m?.click(); return true; })()`);
  await wait(300);
  await blur(cdp);

  // ④ Z 撤销的是摘录推进（不是卡甲评分）→ 摘录被召回并显示
  await key(cdp, ...Z);
  const s4 = await waitShown(cdp, (s) => s.kind === "extract");
  check("卡乙上按 Z＝撤销摘录推进 → 摘录重新显示", s4.kind === "extract", JSON.stringify(s4));
  check("摘录推进已撤回（process_count 回 0）", Number((await exDetail(cdp, idX)).pc) === 0, JSON.stringify(await exDetail(cdp, idX)));
  check("卡甲评分未被误撤（reps 仍为 1）", (await cardReps(cdp, idA)) === 1, await cardReps(cdp, idA));

  // ⑤ 连点两次「下一条」只推进一次（busy 守卫）
  const pre5 = await shown(cdp);
  check("前置：连点前当前条是摘录", pre5.kind === "extract", JSON.stringify(pre5));
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".review-wrap .extract-face-actions button")].find((x) => x.textContent.trim() === "下一条"); if (!b) return false; b.click(); b.click(); return true; })()`);
  await waitShown(cdp, (s) => s.kind === "card");
  await wait(800);
  check("连点两次「下一条」只推进一次（process_count＝1）", Number((await exDetail(cdp, idX)).pc) === 1, JSON.stringify(await exDetail(cdp, idX)));

  // ⑥ 回车也是下一条：先撤回推进，再按回车
  await blur(cdp);
  await key(cdp, ...Z);
  await waitShown(cdp, (s) => s.kind === "extract");
  await blur(cdp);
  await key(cdp, ...ENTER);
  const s6 = await waitShown(cdp, (s) => s.kind === "card");
  check("摘录条目按回车＝下一条", Number((await exDetail(cdp, idX)).pc) === 1 && s6.kind === "card", `${JSON.stringify(await exDetail(cdp, idX))} ${JSON.stringify(s6)}`);

  // ⑦ 设置页：「复习方式」二选一；混编规则只在混合复习下出现；切回分开处理后复习页只推闪卡
  await cdp.eval(`(() => { const b = document.querySelector('button[title="设置"]'); b?.click(); return !!b; })()`);
  await wait(1500);
  await cdp.eval(`(() => { document.querySelector("#sec-extracts")?.scrollIntoView(); return true; })()`);
  const seg = JSON.parse(String(await cdp.eval(`(() => {
    const g = document.querySelector("#sec-extracts [data-review-mode]");
    const btns = g ? [...g.querySelectorAll("button")] : [];
    return JSON.stringify({ labels: btns.map((b) => b.textContent.trim()), active: btns.filter((b) => b.classList.contains("active")).map((b) => b.textContent.trim()), interleave: !!document.querySelector("#sec-extracts [data-interleave-row]") });
  })()`)) || "{}");
  check("设置页「复习方式」两项：分开处理 / 混合复习（SuperMemo 式）", JSON.stringify(seg.labels) === JSON.stringify(["分开处理", "混合复习（SuperMemo 式）"]), JSON.stringify(seg));
  check("当前高亮＝混合复习，混编规则行在位", JSON.stringify(seg.active) === JSON.stringify(["混合复习（SuperMemo 式）"]) && seg.interleave === true, JSON.stringify(seg));
  await cdp.eval(`(() => { const b = document.querySelector('#sec-extracts [data-review-mode] [data-mode="separate"]'); b?.click(); return !!b; })()`);
  await wait(1200);
  const saved = await cdp.eval(`(async () => JSON.stringify((await window.settingsAPI.get("app", "extracts")) || {}))()`);
  const hidden = await cdp.eval(`!document.querySelector("#sec-extracts [data-interleave-row]")`);
  check("点「分开处理」落盘 mergeIntoReview=false，混编规则行隐藏", String(saved).includes('"mergeIntoReview":false') && hidden === true, `${saved} hidden=${hidden}`);

  console.log(`\n==== d232-mixed-review.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
