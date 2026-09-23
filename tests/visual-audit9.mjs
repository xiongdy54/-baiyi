// 视觉核查 v9 —— 收掉我自己在 §一·十一 / §一·十二 里挂出来的三个「未验到」
//   G1 D54②「最右按钮内缩 44px」：上一版 btns[last] 没匹到 → 改成「行内所有可见按钮的最大 right」直接算。
//   G2 D54⑤「一个条目只给一种光标」：上一版把一行**所有后代**的 cursor 收成一个集合，
//      书名既然是真 <button> 就必然 pointer —— 那是我问错了问题。
//      正确问法：**行自身 tr 与不含按钮的 td** 的 cursor 有几种？以及 hover 前后会不会变（D54 修的就是「来回跳」）。
//   G3 D53「hover 或键盘 focus 都能展开」：上一版取 el.querySelector('[tabindex],button,a')，
//      两条任务时匹到折叠详情里的隐藏按钮 → focus-failed。改成**直接聚焦容器本身**。
// 播种复用 tmp-seed-mmrun.cjs（它已建两份不同材料各一条可续跑 run，正好凑出两行）。
// 运行：node tests/visual-audit9.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9320";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual9-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual9");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(USER_DATA, { recursive: true, force: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };
const LONG = "负反馈调节使系统回归稳定，这是控制论的核心概念；它不依赖具体实现，只依赖环路结构与增益分布，因此在机械、电子、生态与组织管理中反复出现，并且每一次复述都会牵出新的类比与反例。".repeat(3);

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
const hoverAt = async (p, x, y) => { await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await wait(700); await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 1, y }); await wait(900); };

let electron = null;
try {
  const seed = spawnSync("npx", ["electron", "tests/fsrs/tmp-seed-mmrun.cjs"], {
    cwd: ROOT, shell: true, encoding: "utf8", timeout: 180_000, env: { ...process.env, SEED_USERDATA: USER_DATA },
  });
  const seedOut = (seed.stdout || "") + (seed.stderr || "");
  if (!seedOut.includes("RESUMABLE")) throw new Error("播种失败：\n" + seedOut.slice(0, 500));
  console.log("播种 ok（两份不同材料各一条可续跑 run）");

  const log = fs.openSync(path.join(ROOT, "tests", "visual9.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(6000);

  // ── G3 键盘 focus 展开：直接聚焦容器本身 ─────────────────────────────────
  const SEL = `[class*=activity]`;
  const k0 = asObj(await main.ev(`(() => { const el=document.querySelector(${JSON.stringify(SEL)}); const r=el.getBoundingClientRect();
    return JSON.stringify({h:Math.round(r.height), top:Math.round(r.top), tabindex:el.getAttribute('tabindex'), cls:String(el.className)}); })()`) || "{}");
  console.log(`\n[G3] 收起态：${JSON.stringify(k0)}`);
  const kRes = asObj(await main.ev(`(() => {
    const el=document.querySelector(${JSON.stringify(SEL)});
    const row=el.querySelector('[class*=row]')||el;
    const tried=[];
    const attempt=(node,label)=>{ if(!node) return false; node.setAttribute('tabindex','-1'); node.focus({preventScroll:true});
      const ok=document.activeElement===node; tried.push(label+"="+(ok?"hit":"miss")); return ok; };
    attempt(el,"容器自身");
    if(document.activeElement!==el) attempt(row,"第一行");
    const r=el.getBoundingClientRect();
    return JSON.stringify({ tried, h:Math.round(r.height), top:Math.round(r.top), active:document.activeElement? document.activeElement.tagName+"."+String(document.activeElement.className).slice(0,26):null });
  })()`) || "{}");
  await wait(1400);
  const k1 = asObj(await main.ev(`(() => { const el=document.querySelector(${JSON.stringify(SEL)}); const r=el.getBoundingClientRect(); return JSON.stringify({h:Math.round(r.height), top:Math.round(r.top)}); })()`) || "{}");
  await shot(main, "95-键盘focus展开");
  console.log(`[G3] 聚焦尝试 ${JSON.stringify(kRes.tried)} → focus 后容器 h=${k1.h}（收起 ${k0.h}）`);
  console.log(k1.h > k0.h
    ? ">>> D53「hover 或键盘 focus 都能展开」✅ 成立（两条路都通）"
    : `>>> D53 键盘路径 ❌ 未展开：activeElement=${kRes.active}，高度停在 ${k1.h}px`);

  // ── 书架：写长进度 + 切目录表 ────────────────────────────────────────────
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 40 });
  await wait(800);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1800);
  const prog = asObj(await main.ev(`(async()=>{
    const L=window.libraryAPI; let items=[];
    try{ items = await (L.listItems? L.listItems(): L.list? L.list(): []);}catch(e){}
    let done=0;
    for(const it of items){ try{ await L.updateProgress(it.id,{ratio:0.42,lastText:${JSON.stringify(LONG)},updatedAt:Date.now(),cfi:"#epubcfi(/6/4!/4:2:18)"}); done++; }catch(e){} }
    return JSON.stringify({items:items.length, done, lastLen:${JSON.stringify(LONG)}.length});
  })()`) || "{}");
  console.log(`\n[G1/G2] 写入长进度：${JSON.stringify(prog)}`);
  await main.ev(`location.reload()`);
  await wait(5000);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1600);
  await main.ev(`(() => { const all=[...document.querySelectorAll('button')]; const n=(x)=>(x.textContent||"").replace(/\\s+/g,""); const b=all.find(x=>n(x).includes("目录表")) || all.find(x=>/table|list|列表/i.test(x.getAttribute("aria-label")||"")) || all.find(x=>(x.title||"").includes("目录表"));
    if(b) b.click();
    return JSON.stringify({clicked:!!b, found:[...document.querySelectorAll('tbody tr')].length, all:all.slice(0,16).map(x=>({t:n(x).slice(0,10),a:x.getAttribute("aria-label")}))}); })()`);
  await wait(2200);

  // ── G1 最右按钮内缩 ──────────────────────────────────────────────────────
  const inset = asObj(await main.ev(`(() => {
    const rows=[...document.querySelectorAll('tbody tr')].filter(r=>r.getBoundingClientRect().height>0);
    return JSON.stringify(rows.slice(0,6).map(r=>{
      const rr=r.getBoundingClientRect();
      const bs=[...r.querySelectorAll('button')].map(b=>b.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0);
      const maxRight = bs.length? Math.max(...bs.map(b=>b.right)) : null;
      return { rowRight:Math.round(rr.right), lastBtnRight: maxRight==null?null:Math.round(maxRight),
               insetPx: maxRight==null?null:Math.round(rr.right-maxRight), btns:bs.length };
    }));
  })()`) || "[]");
  console.log(`\n[G1] 逐行内缩：${JSON.stringify(inset)}`);
  const ins = (Array.isArray(inset) ? inset : []).map((x) => x.insetPx).filter((v) => typeof v === "number");
  if (ins.length) console.log(`>>> D54②「最右按钮内缩 44px」实测 = ${JSON.stringify([...new Set(ins)])}px → ${ins.every((v) => v === 44) ? "符合" : "与 44 不符"}`);
  else console.log(">>> D54② 仍未量到（行内没有可见按钮？需人工看图）");
  await shot(main, "96-目录表-内缩");

  // ── G2 光标：只看行自身与非按钮单元格，并比 hover 前后 ────────────────────
  const curRead = () => main.ev(`(() => {
    const row=document.querySelector('tbody tr');
    if(!row) return JSON.stringify({err:'no row'});
    const cellCursors=[...row.children].map(td=>({tag:td.tagName, cls:String(td.className).slice(0,18),
      cursor:getComputedStyle(td).cursor, hasBtn: !!td.querySelector('button')}));
    return JSON.stringify({ rowCursor:getComputedStyle(row).cursor, cells:cellCursors });
  })()`);
  const c0 = asObj(await curRead() || "{}");
  const rb = asObj(await main.ev(`(() => { const r=document.querySelector('tbody tr').getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+40), y:Math.round(r.top+r.height/2)}); })()`) || "{}");
  await hoverAt(main, rb.x, rb.y);
  const c1 = asObj(await curRead() || "{}");
  await shot(main, "97-目录表-hover");
  console.log(`\n[G2] 未 hover：行 cursor=${c0.rowCursor}`);
  console.log(`     单元格光标 = ${JSON.stringify((c0.cells || []).map((x) => `${x.cls || x.tag}:${x.cursor}${x.hasBtn ? "(有按钮)" : ""}`))}`);
  console.log(`     hover 后：行 cursor=${c1.rowCursor}；变化=${c0.rowCursor !== c1.rowCursor}`);
  const nonBtn = new Set((c1.cells || []).filter((x) => !x.hasBtn).map((x) => x.cursor));
  console.log(`>>> D54⑤ 非按钮单元格的光标种类 = ${JSON.stringify([...nonBtn])} → ${nonBtn.size <= 1 ? "**符合**「一个条目只给一种光标」" : "**不符合**：出现 " + [...nonBtn].join("/")}`);
  console.log(`>>> hover 引起光标跳变？${c0.rowCursor !== c1.rowCursor ? "是（D54 声称已消除来回跳）" : "否 ✅"}`);

  fs.writeFileSync(path.join(SHOTS, "gaps.json"), JSON.stringify({ k0, kRes, k1, prog, inset, c0, c1 }, null, 2));
  console.log(`\n截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
