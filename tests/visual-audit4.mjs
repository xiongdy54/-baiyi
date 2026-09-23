// 视觉核查 v4 —— 用**真实键盘/鼠标事件**（CDP Input.dispatch*）判定复习页到底能不能答
// 为什么必须走 CDP：React 的 onKeyDown 挂在合成事件上，new KeyboardEvent + dispatchEvent
//   未必进得了 React 的监听链（本仓 GUI 套件的既有结论：hover 断言必须走 dispatchMouseEvent）。
//   v3 用合成事件测出「无按钮」，那是**取证方法不成立**，不能算产品缺陷。这里重测。
// 同时把阅读器版式几何改成不假设 iframe（foliate-js 在同文档内渲染，v3 因此全测成 null）。
// 运行：node tests/visual-audit4.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9315";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual4-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual4");
const MARK = "VIS4";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };

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
        let id = 0; const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || "").slice(0, 200);
          return r.result?.result?.value;
        };
        // 真键盘：keyDown + keyUp，code/key/text 都给全
        const key = async (k, code, text) => {
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: code === "Space" ? 32 : undefined, text: text ?? (k.length === 1 ? k : "") });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: code === "Space" ? 32 : undefined });
        };
        await send("Runtime.enable"); await send("Page.enable");
        await send("Input.enable").catch?.(() => {});
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
// 按钮清单表达式（直接内插，别再对 JSON.stringify(...) 做 slice —— 那样切错）
const BTN_EXPR = `[...document.querySelectorAll('button')].map(b=>({t:b.textContent.trim().slice(0,14),vis:b.offsetParent!==null&&b.getBoundingClientRect().height>0})).filter(x=>x.t)`;

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual4.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);
  const book = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书法十讲`)}, ${JSON.stringify(["中锋用笔是书法的基础，笔笔送到则骨力洞达，这是第一句应当完整可见的长句测试文本。", "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL))})))()`) || "{}");
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const c = asObj(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.create({
      noteText: ${JSON.stringify(`${MARK} 卡 ${i}`)}, cardType: "qa",
      frontMarkdown: "「中锋」指什么？", backMarkdown: "行笔时笔锋居于点画正中，不偏不倚。",
      priority: 50, tags: [], documentId: ${JSON.stringify(book.documentId || null)}
    })))()`) || "{}");
    if (c.id) ids.push(c.id);
  }
  console.log(`建册=${!!book.id} 建卡=${ids.length}`);
  await main.ev(`location.reload()`);
  await wait(5500);
  const gotoNav = async (t) => { await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); b?.click(); return !!b; })()`); await wait(2000); };

  // ── A. 复习页：先量初始态，再走真实交互链 ───────────────────────────────
  await gotoNav("复习");
  const s0 = asObj(await main.ev(`JSON.stringify({ body: document.body.innerText.replace(/\\s+/g," ").slice(0,140), btns: ${BTN_EXPR} })`) || "{}");
  await shot(main, "50-复习-初始");
  console.log(`\n[A] 初始  body="${s0.body}"\n     btns=${JSON.stringify(s0.btns)}`);

  // 1) 真鼠标点页面中央（很多实现是「点卡片翻面」）
  const vp = asObj(await main.ev(`JSON.stringify({w: innerWidth, h: innerHeight})`) || "{}");
  await main.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(vp.w * 0.4), y: Math.round(vp.h * 0.4), button: "left", clickCount: 1 });
  await main.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(vp.w * 0.4), y: Math.round(vp.h * 0.4), button: "left" });
  await wait(1200);
  const s1 = asObj(await main.ev(`JSON.stringify({ body: document.body.innerText.replace(/\\s+/g," ").slice(0,140), btns: ${BTN_EXPR} })`) || "{}");
  console.log(`[B] 真鼠标点正文后 btns=${JSON.stringify(s1.btns)}`);

  // 2) 真键盘 Space（Anki 式翻面）
  await main.key(" ", "Space", " ");
  await wait(1400);
  const s2 = asObj(await main.ev(`JSON.stringify({ body: document.body.innerText.replace(/\\s+/g," ").slice(0,180), btns: ${BTN_EXPR} })`) || "{}");
  await shot(main, "51-复习-真Space后");
  console.log(`[C] 真 Space 后 body="${s2.body}"\n     btns=${JSON.stringify(s2.btns)}`);

  // 3) 真键盘 1（Again 档）
  await main.key("1", "Digit1", "1");
  await wait(1600);
  const s3 = asObj(await main.ev(`JSON.stringify({ body: document.body.innerText.replace(/\\s+/g," ").slice(0,160), btns: ${BTN_EXPR} })`) || "{}");
  await shot(main, "52-复习-真1后");
  console.log(`[D] 真「1」后 body="${s3.body}"`);
  const q = asObj(await main.ev(`(async()=>{const r=await window.cardsAPI.todayQueue();return JSON.stringify({due:r.cards.length, deferred:(r.deferred||[]).length})})()`) || "{}");
  console.log(`     今日队列剩余=${JSON.stringify(q)}`);
  const logs = asObj(await main.ev(`(async()=>JSON.stringify((await window.cardsAPI.listAll()).length))()`) || "{}");
  console.log(`     库内卡片数=${JSON.stringify(logs)}（评分是否真落库看队列是否变少）`);

  const canReview = (s1.btns?.length || s2.btns?.length) > 0;
  console.log(`\n>>> 判读：复习页在真实输入下${canReview ? "**有**可点控件（v3 的「无按钮」是合成事件没进 React，取证方法不成立）" : "**仍无**可点控件 —— 核心复习流程真的没有交互面"}`);

  // ── B. 阅读器版式：不假设 iframe ────────────────────────────────────────
  await gotoNav("书架");
  await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(MARK)})); c?.click(); return !!c; })()`);
  await wait(6000);
  const measure = async (label) => asObj(await main.ev(`(() => {
    const toc = document.querySelector('[class*=toc]');
    const tr = toc ? toc.getBoundingClientRect() : null;
    // 找承载正文的滚动容器：排除导航/工具条后，取文字量最大的元素
    const all = [...document.querySelectorAll('div,section,main,article')];
    let best = null, bestLen = 0;
    for (const el of all) {
      const t = (el.innerText || "").trim();
      if (t.length > bestLen && t.length < 4000 && !el.className.toString().includes("nav")) { best = el; bestLen = t.length; }
    }
    const br = best ? best.getBoundingClientRect() : null;
    // 正文里第一句话的实际起点（用 Range 取首行矩形）
    let firstLineLeft = null, firstText = null;
    if (best) {
      const walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue.trim();
        if (v.length > 6) {
          const rg = document.createRange(); rg.selectNodeContents(n);
          const r0 = rg.getBoundingClientRect();
          firstLineLeft = Math.round(r0.left); firstText = v.slice(0, 30); break;
        }
      }
    }
    return JSON.stringify({
      label: ${JSON.stringify(label)},
      toc: tr ? { left: Math.round(tr.left), right: Math.round(tr.right), w: Math.round(tr.width) } : null,
      contentEl: br ? { cls: String(best.className).slice(0, 40), left: Math.round(br.left), right: Math.round(br.right), w: Math.round(br.width) } : null,
      firstLineLeft, firstText,
      viewportW: innerWidth,
      overlapPx: tr && br ? Math.round(tr.right - br.left) : null,
      textClippedLeft: firstLineLeft != null && tr ? firstLineLeft < tr.right : null,
    });
  })()`) || "{}");

  const m0 = await measure("目录关闭");
  console.log(`\n[E] 目录关闭: ${JSON.stringify(m0)}`);
  await shot(main, "53-阅读器-目录关闭");
  await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录")); b?.click(); return !!b; })()`);
  await wait(1600);
  const m1 = await measure("目录打开");
  console.log(`[F] 目录打开: ${JSON.stringify(m1)}`);
  await shot(main, "54-阅读器-目录打开");
  if (m1.overlapPx != null && m1.overlapPx > 1) {
    console.log(`\n>>> 判读：目录面板右缘越过正文容器左缘 ${m1.overlapPx}px，且正文首行 left=${m1.firstLineLeft} vs 面板 right=${m1.toc?.right} → textClippedLeft=${m1.textClippedLeft}。目录是盖在正文上而非推开布局。`);
  } else {
    console.log(`\n>>> 判读：正文容器未被目录覆盖（overlap=${m1.overlapPx}px）。v2 截图的裁切需另找原因。`);
  }
  fs.writeFileSync(path.join(SHOTS, "probe.json"), JSON.stringify({ s0, s1, s2, s3, q, m0, m1 }, null, 2));
  console.log(`截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
