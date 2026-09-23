// 端到端复现 + 截图取证：fsrs.lastReview 落在未来（时钟回拨/备份恢复）→ 复习页整应用崩
// 依据链：
//   src/components/ReviewView.tsx:118  useEffect 内裸调 fsrsEngine.preview(current.fsrs)
//   src/components/ReviewView.tsx:485  渲染期 previews?.items ?? fsrsEngine.preview(...)
//   ts-fsrs next_state: delta_t = utcDay(now) - utcDay(last_review) < 0 → throw FSRSValidationError
//   src/main.tsx:17  唯一的错误边界在根上 → 整应用换成「界面出现异常」
// 运行：node tests/fsrs/repro-future-lastreview.gui.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PORT = "9312";
const USER_DATA = path.join(ROOT, "tests", "tmp-repro-flr-userdata");
const OUT = path.join(ROOT, "tests", "tmp-repro-flr");
const DAY = 86_400_000;
const MARK = "REPROFLR";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });

async function targets() {
  return (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}
async function connect(match, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await targets()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0; const pending = new Map(); const errs = [];
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            errs.push((d.exception?.description || d.text || "").slice(0, 400));
          }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev, errs, label };
      }
    } catch { /* 未就绪 */ }
    await wait(1500);
  }
  throw new Error(`CDP 连接失败：${label}`);
}
const shot = async (p, name) => {
  const r = await p.send("Page.captureScreenshot", { format: "png" });
  if (r?.result?.data) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, "base64"));
};

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "repro-flr.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);

  // 1. 建材料 + 建卡
  const NL = String.fromCharCode(10);
  const bk = JSON.parse(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书`)}, ${JSON.stringify(["# 第一章", "", "这是一段用于复现的正文。"].join(NL))})))()`) || "{}");
  console.log(`1) 建册 ${bk.id ? "ok" : "FAIL " + JSON.stringify(bk).slice(0, 120)}`);
  const card = JSON.parse(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.create({
    noteText: ${JSON.stringify(`${MARK} 卡`)}, cardType: "qa",
    frontMarkdown: "问题：复现用", backMarkdown: "答案：复现用",
    priority: 50, tags: [], documentId: ${JSON.stringify(bk.documentId || null)}
  })))()`) || "{}");
  console.log(`2) 建卡 ${card.id ? card.id : "FAIL " + JSON.stringify(card).slice(0, 200)}`);
  if (!card.id) throw new Error("建卡失败，无法继续");

  const before = JSON.parse(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.get(${JSON.stringify(card.id)})))()`) || "{}");
  console.log(`3) 卡初始 fsrs = ${JSON.stringify(before.fsrs)}`);

  // 4. 用真实写入口把 lastReview 写成未来、due 写成过去（等价于「在错误时钟上复习过，随后改回」）
  const now = Date.now();
  const crafted = {
    state: "review", due: now - DAY, lapses: 0,
    stability: 20, difficulty: 5, reps: 6, learningSteps: 0,
    lastReview: now + 400 * DAY,
  };
  const rev = await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.review(${JSON.stringify(card.id)}, ${JSON.stringify(crafted)}, "Good", 1200, ${JSON.stringify(before.fsrs || null)})))()`);
  console.log(`4) 写入未来 lastReview（cards:review 是否照单全收）→ ${String(rev).slice(0, 200)}`);
  const after = JSON.parse(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.get(${JSON.stringify(card.id)})))()`) || "{}");
  console.log(`   落库 fsrs = ${JSON.stringify(after.fsrs)}`);
  const persisted = after.fsrs && Number(after.fsrs.lastReview) > now;
  console.log(`   主进程是否校验 lastReview≤now：${persisted ? "未校验，未来时间已落库" : "已拦截/改写"}`);

  // 5. 让它进今日队列，然后重载 → 打开复习页
  await main.ev(`location.reload()`);
  await wait(5000);
  const due = await main.ev(`(async()=>{const q=await window.cardsAPI.todayQueue();return JSON.stringify({n:(q.cards||[]).length, ids:(q.cards||[]).map(c=>c.id).slice(0,5)})})()`);
  console.log(`5) 今日队列 ${due}`);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="复习"); b?.click(); return !!b; })()`);
  await wait(4000);
  const state = await main.ev(`JSON.stringify({
    crashed: document.body.innerText.includes("界面出现异常"),
    crashMsg: (document.body.innerText.match(/界面出现异常[\\s\\S]{0,260}/)||[""])[0],
    reviewVisible: !!document.querySelector(".review-card,[class*=review]"),
    navVisible: !!document.querySelector(".nav-item"),
    bodyHead: document.body.innerText.slice(0,160)
  })`);
  await shot(main, "复习页崩溃现场");
  console.log(`6) 打开复习页后：${state}`);
  const s = JSON.parse(state || "{}");
  console.log(`\n   渲染期异常 ${main.errs.length} 条：`);
  for (const e of main.errs.slice(0, 4)) console.log("   " + e.replace(/\n/g, "\n   "));
  console.log(`\n   截图：${path.join(OUT, "复习页崩溃现场.png")}`);
  console.log(`\n== 结论 ==`);
  console.log(`   写入口未校验 lastReview 未来值：${persisted}`);
  console.log(`   整应用被根错误边界接管（导航栏消失）：${s.crashed === true && s.navVisible === false}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
