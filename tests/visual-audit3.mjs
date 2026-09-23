// 视觉核查 v3 —— 阅读器版式几何 + 真实复习卡
// 起因：v2 的 35-阅读器B-散文开头.png 里首行「中锋用笔是书法的基础…」被裁成「书法的基础…」，
//       正文左边缘看起来压在目录面板下面。这里用 getBoundingClientRect 把「遮挡」钉成数字，
//       而不是靠肉眼说"看起来被裁了"。
// 顺带补 v2 没验到的：带真实到期卡的复习页（v2 建卡载荷不对，卡片数 0，复习页一直是空态）。
// 运行：node tests/visual-audit3.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9314";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual3-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual3");
const MARK = "VIS3";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };
const errs = [];

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
          if (m.method === "Runtime.exceptionThrown") errs.push("EXC " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 200));
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || "").slice(0, 200);
          return r.result?.result?.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev };
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
  const log = fs.openSync(path.join(ROOT, "tests", "visual3.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);

  // 散文开头的书（避开 `#` 首行，让首章真有正文，才能看清遮挡）
  const book = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书法十讲`)}, ${JSON.stringify(["中锋用笔是书法的基础，笔笔送到则骨力洞达，这是第一句应当完整可见的长句。", "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL))})))()`) || "{}");
  console.log(`建册 ${book.id ? "ok" : "FAIL " + JSON.stringify(book).slice(0, 160)}`);

  // 真实到期卡（用 v2 里没试错的极简载荷）
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const c = asObj(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.create({
      noteText: ${JSON.stringify(`${MARK} 卡 ${i}`)}, cardType: "qa",
      frontMarkdown: ${JSON.stringify(`「中锋」指什么？`)}, backMarkdown: ${JSON.stringify(`行笔时笔锋居于点画正中，不偏不倚。`)},
      priority: 50, tags: [], documentId: ${JSON.stringify(book.documentId || null)}
    })))()`) || "{}");
    if (!c.id) { console.log(`  建卡失败 #${i}: ${JSON.stringify(c).slice(0, 200)}`); break; }
    ids.push(c.id);
  }
  console.log(`建卡 ${ids.length} 张`);
  await main.ev(`location.reload()`);
  await wait(5500);

  const gotoNav = async (t) => { await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); b?.click(); return !!b; })()`); await wait(1800); };

  // ── 复习页：真实卡的正/背面 ─────────────────────────────────────────────
  await gotoNav("复习");
  const revFront = asObj(await main.ev(`JSON.stringify({
    bodyLen: document.body.innerText.length,
    hasCard: !!document.querySelector('[class*=review-card],[class*=card-face],.review'),
    due: (document.body.innerText.match(/今日到期|张/) || []).length,
    text: document.body.innerText.replace(/\\s+/g," ").slice(0,180)
  })`) || "{}");
  await shot(main, "40-复习正面");
  console.log(`复习正面: ${JSON.stringify(revFront).slice(0, 260)}`);
  const revealed = await main.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/显示答案|答案/.test(x.textContent)); if(b){b.click(); return b.textContent.trim();} return null; })()`);
  await wait(1500);
  const revBack = asObj(await main.ev(`JSON.stringify({ text: document.body.innerText.replace(/\\s+/g," ").slice(0,220), btns: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/^(Again|再来|困难|Good|良好|Easy|简单|忘了|认识)/.test(t)).slice(0,10) })`) || "{}");
  await shot(main, "41-复习背面");
  console.log(`翻面=${JSON.stringify(revealed)} 背面: ${JSON.stringify(revBack).slice(0, 300)}`);

  // ── 阅读器版式几何：目录关闭 vs 打开 ─────────────────────────────────────
  await gotoNav("书架");
  await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(MARK)})); c?.click(); return !!c; })()`);
  await wait(5500);
  const closeToc = async () => main.ev(`(() => { const x=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="×"||b.getAttribute('aria-label')?.includes("关闭")); const panel=document.querySelector('[class*=toc]'); if(x&&panel&&panel.contains(x.closest('*')))x.click(); return !!document.querySelector('[class*=toc]'); })()`);

  const geom = async (label) => asObj(await main.ev(`(() => {
    const rd = document.querySelector('.reader-engine,.reader-content,[class*=reader-body],[class*=reader]');
    const toc = document.querySelector('[class*=toc]');
    const frame = document.querySelector('iframe');
    const fr = frame ? frame.getBoundingClientRect() : null;
    const rect = (el) => el ? (({left,right,top,bottom,width,height}) => ({left:Math.round(left),right:Math.round(right),top:Math.round(top),width:Math.round(width),height:Math.round(height)}))(el.getBoundingClientRect()) : null;
    let inner = null, scrollX = null, docW = null, viewW = null;
    try {
      const d = frame && frame.contentDocument;
      if (d) {
        const p = d.querySelector('p,h1,h2,section,div');
        inner = p ? { tag: p.tagName, text: (p.innerText||'').replace(/\\s+/g,' ').slice(0,40), left: Math.round(p.getBoundingClientRect().left) } : null;
        scrollX = Math.round(d.scrollingElement?.scrollLeft ?? d.documentElement?.scrollLeft ?? -1);
        docW = d.documentElement?.scrollWidth; viewW = d.documentElement?.clientWidth;
      }
    } catch (e) { inner = { err: String(e.message).slice(0,80) }; }
    return JSON.stringify({ label: ${JSON.stringify(label)}, tocPresent: !!toc, tocRect: rect(toc), frameRect: fr, inner, scrollX, docW, viewW, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 });
  })()`) || "{}");

  const closed = await geom("目录关闭");
  console.log(`\n目录关闭: ${JSON.stringify(closed)}`);
  await shot(main, "42-阅读器-目录关闭");
  await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录")); b?.click(); return !!b; })()`);
  await wait(1500);
  const open = await geom("目录打开");
  console.log(`目录打开: ${JSON.stringify(open)}`);
  await shot(main, "43-阅读器-目录打开");

  // 判定：目录打开时，正文容器/iframe 的左边缘被目录右边缘吃掉多少像素
  const overlap = (open.tocRect && open.frameRect) ? open.tocRect.right - open.frameRect.left : null;
  const overlapClosed = (closed.tocRect && closed.frameRect) ? closed.tocRect.right - closed.frameRect.left : null;
  console.log(`\niframe 左缘被目录覆盖量：关闭=${overlapClosed}px 打开=${overlap}px`);
  console.log(`iframe 内首元素：关闭=${JSON.stringify(closed.inner)} 打开=${JSON.stringify(open.inner)}`);
  console.log(`iframe 横向滚动/溢出：关闭 scrollX=${closed.scrollX} docW/viewW=${closed.docW}/${closed.viewW} ; 打开 scrollX=${open.scrollX} docW/viewW=${open.docW}/${open.viewW}`);
  if (overlap != null && overlap > 1) {
    console.log(`\n>>> 判读：目录面板与正文区左边缘重叠 ${overlap}px —— 面板是「盖」在正文上而不是推开布局，首行文字被裁。`);
  } else {
    console.log(`\n>>> 判读：目录与正文区无重叠（${overlap}px）——v2 截图里的裁切另有原因（可能是正文自身横向溢出或首行缩进），见 scrollX/docW。`);
  }
  fs.writeFileSync(path.join(SHOTS, "geom.json"), JSON.stringify({ closed, open, overlap, overlapClosed, errs: errs.slice(0, 20) }, null, 2));
  console.log(`\n渲染期异常 ${errs.length} 条`);
  for (const e of errs.slice(0, 8)) console.log("  " + e);
  console.log(`截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
