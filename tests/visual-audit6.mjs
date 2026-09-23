// 取证 A-12：模态打开时，全局快捷键是否真的会打到底下的卡
// 静态已确认的三点：
//   1) src/lib/commands.ts:168-179 install() 把 keydown 挂在 **window 的捕获相**（第三个参数 true）
//      → 模态内部就算写 stopPropagation 也来不及（捕获相先于目标相）。
//   2) dispatchKey:144 只看 suppressions；全仓只有 App.tsx:153（设置模态）与 SettingsPanel 会 push。
//   3) dispatchKey:148-149 有焦点守卫，但**只挡 INPUT / TEXTAREA / contentEditable**，
//      焦点落在按钮、div、body 上时照样放行。
// 本脚本量的是后果：模态开着按「1」，背后那张卡会不会被评分。
// 运行：node tests/visual-audit6.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9317";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual6-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual6");
const MARK = "VIS6";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };

async function connect(match, label, timeoutMs = 90000) {
  const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await list()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0; const pending = new Map();
        ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || "").slice(0, 200);
          return r.result?.result?.value;
        };
        const key = async (k, code) => {
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text: k });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev, key };
      }
    } catch { /* 未就绪 */ }
    await wait(1500);
  }
  throw new Error(`CDP 连接失败：${label}`);
}
const shot = async (p, n) => {
  const r = await p.send("Page.captureScreenshot", { format: "png" });
  if (r?.result?.data) fs.writeFileSync(path.join(SHOTS, `${n}.png`), Buffer.from(r.result.data, "base64"));
};

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual6.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);

  const bk = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书`)}, ${JSON.stringify(["# 第一章", "", "对比卡模态与快捷键泄漏取证用正文。"].join(NL))})))()`) || "{}");
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const c = asObj(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.create({
      noteText: ${JSON.stringify(`${MARK} K${i}`)}, cardType: "qa",
      frontMarkdown: "「对比取证」是什么？", backMarkdown: "用于验证模态打开时快捷键泄漏的卡。",
      priority: 50, tags: [], documentId: ${JSON.stringify(bk.documentId || null)}
    })))()`) || "{}");
    if (c.id) ids.push(c.id);
  }
  console.log(`建卡 ${ids.length} 张`);
  await main.ev(`location.reload()`);
  await wait(5500);
  const gotoNav = async (t) => { await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); b?.click(); return !!b; })()`); await wait(2200); };

  const snap = async (label) => asObj(await main.ev(`(async()=>{
    const q = await window.cardsAPI.todayQueue();
    const all = await window.cardsAPI.listAll();
    const mine = all.filter(c=>(c.noteText||"").startsWith(${JSON.stringify(MARK)}));
    return JSON.stringify({
      label: ${JSON.stringify(label)},
      queue: q.cards.length,
      repsSum: mine.reduce((a,c)=>a+(c.fsrs?.reps||0),0),
      dueSum: mine.reduce((a,c)=>a+((c.fsrs?.state==="review")?1:0),0),
      states: mine.map(c=>c.fsrs?.state+":"+ (c.fsrs?.reps||0)).join(","),
      activeEl: document.activeElement ? document.activeElement.tagName + "." + String(document.activeElement.className||"").slice(0,22) : null,
      modalOpen: !!document.querySelector('[role=dialog],[aria-modal="true"]'),
      roundCount: (document.body.innerText.match(/本轮\\s*(\\d+)\\s*张/)||[])[1] || null,
    });
  })()`) || "{}");

  await gotoNav("复习");
  const s0 = await snap("模态打开前");
  console.log(`\n[0] ${JSON.stringify(s0)}`);

  // 真键盘翻面，让四档按钮出现（dispatchKey 不看 showBack，但为了贴近真实操作先翻）
  await main.key(" ", "Space");
  await wait(1200);

  // 打开「对比卡」模态（真鼠标点击）
  const opened = await main.ev(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==="对比卡");
    if(!b) return "no-btn";
    const r=b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
  })()`);
  if (opened === "no-btn") { console.log("找不到「对比卡」按钮，终止"); throw new Error("no contrast button"); }
  const { x, y } = JSON.parse(opened);
  await main.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await main.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left" });
  await wait(2500);
  const s1 = await snap("对比卡模态打开后");
  await shot(main, "70-对比卡模态打开");
  console.log(`[1] ${JSON.stringify(s1)}`);

  // 模态开着，按真实「1」（Again 档）
  await main.key("1", "Digit1");
  await wait(2200);
  const s2 = await snap("模态开着按了 1 之后");
  await shot(main, "71-按1之后模态仍在");
  console.log(`[2] ${JSON.stringify(s2)}`);

  const leaked = s2.repsSum > s1.repsSum || s2.queue !== s1.queue || (s2.roundCount !== null && s1.roundCount !== null && s2.roundCount !== s1.roundCount);
  console.log(`\n>>> 判读：模态是否仍开着 = ${s2.modalOpen}`);
  console.log(`>>> 背后那张卡有没有被评分：reps 合计 ${s1.repsSum} → ${s2.repsSum}；队列 ${s1.queue} → ${s2.queue}；本轮计数 ${s1.roundCount} → ${s2.roundCount}`);
  console.log(leaked
    ? ">>> **A-12 成立**：模态打开、焦点不在输入框时，绑定键仍命中底下页面的命令 —— 用户在对比卡向导里按 1，背后那张看不见的卡就被评了分。"
    : ">>> **A-12 未复现**：按 1 没有影响背后的卡。需回查 action.when() 是否已经隐含了模态判断。");
  fs.writeFileSync(path.join(SHOTS, "leak.json"), JSON.stringify({ s0, s1, s2, leaked }, null, 2));
  console.log(`\n截图与取证：${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
