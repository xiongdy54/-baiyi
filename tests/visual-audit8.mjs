// 视觉核查 v8 —— 验收 D54（书架目录表溢出与交互收口）自己声称的数字
// 为什么这一轮才做：前七轮另一个会话正在改 Bookshelf.tsx / shelf.ts / theme.css，
//   按约定我完全避开这块。现在他们已 `npm run build`（dist 比所有源码都新），
//   且 F01–F33 在新构建上重跑仍全绿，所以可以安全地对着**当前构建**验收 D54 的声明。
// D54 的可测声明（AI_DEVELOPMENT_GUIDE.md 头部 v48.18 段）：
//   ① 「900/1100/1280/1600 四视口 0 溢出」
//   ② 「最右按钮内缩 44px」
//   ③ 「撤除『打开』列与两处拖拽把手图形」
//   ④ 「点封面/书名开书、书名是真 <button> 带 aria-label」
//   ⑤ 「一个条目只给一种光标（卡片 pointer / 表行 grab）」
//   ⑥ 「悬停时书行副文本不被隐藏（进度条不上跳）」
// 溢出要真触发得让书**有阅读进度**（根因是 lastReadDisplay 有进度时直接返回 lastText 无长度上限），
// 所以先开一本长书产生进度，再回书架量表。
// 运行：node tests/visual-audit8.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9319";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual8-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual8");
const MARK = "VIS8";
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
  const log = fs.openSync(path.join(ROOT, "tests", "visual8.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);

  // 播种：一本长书（正文够长 → 有进度后 lastReadDisplay 会带出长句，正是溢出根因）+ 若干短书
  const longPara = "负反馈调节使系统回归稳定，这是控制论的核心概念；它不依赖具体实现，只依赖环路结构与增益分布，因此在机械、电子、生态与组织管理中反复出现。";
  const chapters = ["# 第一章 反馈", ""];
  for (let i = 0; i < 8; i++) chapters.push(longPara + NL + NL);
  chapters.push("# 第二章 控制", "", "控制论把反馈作为核心机制来研究系统的调节与通信。");
  const bk = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 长书`)}, ${JSON.stringify(chapters.join(NL))})))()`) || "{}");
  for (let i = 0; i < 5; i++) {
    await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 短书 ${i} —— 标题也刻意取长以便压测列宽`)}, ${JSON.stringify(["# 第一章", "", longPara].join(NL))})))()`);
  }
  console.log(`播种 ok=${!!bk.id}`);
  await main.ev(`location.reload()`);
  await wait(5200);

  // 打开长书并翻页，制造真实阅读进度
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1500);
  await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(`${MARK} 长书`)})); c?.click(); return !!c; })()`);
  await wait(5000);
  for (let i = 0; i < 6; i++) {
    await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("下一页")); b?.click(); return 1; })()`);
    await wait(900);
  }
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(2500);

  // ── 造真实阅读进度：D54 的根因是「有进度时 lastReadDisplay 直接返回 lastText 且无长度上限」，
  //    没有长 lastText 就等于没压到那条路径，量出来的 0 溢出是假绿。故显式写入超长 lastText。
  const LONG = "负反馈调节使系统回归稳定，这是控制论的核心概念；它不依赖具体实现，只依赖环路结构与增益分布，因此在机械、电子、生态与组织管理中反复出现，并且每一次复述都会牵出新的类比。".repeat(4);
  const LONG_JSON = JSON.stringify(LONG);
  const seeded = asObj(await main.ev(`(async()=>{
    const out={api:null, done:0, err:null};
    const L=window.libraryAPI||{};
    for (const n of ["updateProgress","setProgress","progress"]) if (typeof L[n]==="function") { out.api=n; break; }
    if (!out.api) { out.err = "libraryAPI 出口=" + Object.keys(L).join(","); return JSON.stringify(out); }
    let items=[];
    try { items = await (L.listItems? L.listItems() : L.list? L.list() : []); } catch(e) { out.err="list:"+e.message; }
    for (const it of (items||[])) {
      try { await L[out.api](it.id, { ratio: 0.42, lastText: ${LONG_JSON}, updatedAt: Date.now(), cfi: "#epubcfi(/6/4!/4:2:18)" }); out.done++; }
      catch(e) { out.err = (out.err||"") + " set:"+e.message; }
    }
    return JSON.stringify(out);
  })()`) || "{}");
  console.log(`写入长进度：${JSON.stringify(seeded)}`);
  await main.ev(`location.reload()`);
  await wait(5000);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1800);

  // 切到「目录表」视图
  const toTable = await main.ev(`(() => {
    const all=[...document.querySelectorAll('button')];
    const norm=(x)=>(x.textContent||"").replace(/\s+/g,"").trim();
    // D54 的视图切换是分段控件：按钮文字里可能夹着图标/空格/快捷键，先做去空白归一再比
    let b=all.find(x=>norm(x).includes("目录表")) ||
         all.find(x=>/table|list/i.test(x.getAttribute('aria-label')||"")) ||
         all.find(x=>(x.title||"").includes("目录表"));
    if(!b) return "no-toggle::" + JSON.stringify(all.map(x=>({t:norm(x), a:x.getAttribute('aria-label'), cls:String(x.className).slice(0,26)})).filter(o=>o.t||o.a).slice(0,18));
    b.click(); return "clicked:" + norm(b) + " / cls=" + String(b.className).slice(0,40);
  })()`);
  await wait(2200);
  console.log(`切视图：${toTable}`);

  // ── ① ② 四视口溢出与内缩 ────────────────────────────────────────────────
  const VIEWPORTS = [900, 1100, 1280, 1600];
  const geo = [];
  for (const w of VIEWPORTS) {
    await main.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait(1400);
    const g = asObj(await main.ev(`(() => {
      const de=document.documentElement;
      const table=document.querySelector('table,[class*=shelf-table],[class*=t-row],[class*=table]');
      const row=document.querySelector('tr,[class*=t-row],[class*=row]');
      const btns=row? [...row.querySelectorAll('button')] : [];
      const last=btns[btns.length-1];
      const rr=row?row.getBoundingClientRect():null, lr=last?last.getBoundingClientRect():null;
      return JSON.stringify({
        vw: window.innerWidth,
        docScrollW: de.scrollWidth, docClientW: de.clientWidth,
        docOverflow: de.scrollWidth - de.clientWidth,
        tableScrollW: table? table.scrollWidth : null, tableClientW: table? table.clientWidth : null,
        tableOverflow: table? table.scrollWidth - table.clientWidth : null,
        rowRight: rr?Math.round(rr.right):null, lastBtnRight: lr?Math.round(lr.right):null,
        inset: (rr&&lr)? Math.round(rr.right - last.getBoundingClientRect().right) : null,
        rows: row? 1 : 0,
      });
    })()`) || "{}");
    geo.push({ w, ...g });
    await shot(main, `90-视口${w}`);
    console.log(`  ${w}px: doc 溢出=${g.docOverflow}px 表溢出=${g.tableOverflow}px 最右按钮内缩=${g.inset}px`);
  }
  await main.send("Emulation.clearDeviceMetricsOverride");
  await wait(1200);

  const badOverflow = geo.filter((x) => (x.docOverflow ?? 0) > 0 || (x.tableOverflow ?? 0) > 0);
  console.log(`\n>>> D54①「四视口 0 溢出」：${badOverflow.length === 0 ? "**符合**" : "**不符合** —— " + JSON.stringify(badOverflow.map((b) => ({ w: b.w, doc: b.docOverflow, table: b.tableOverflow })))}`);
  const insets = geo.map((x) => x.inset).filter((v) => typeof v === "number");
  if (insets.length) console.log(`>>> D54②「最右按钮内缩 44px」：实测 ${JSON.stringify([...new Set(insets)])}px`);

  // ── ③④⑤ 结构与交互声明 ──────────────────────────────────────────────────
  const claims = asObj(await main.ev(`(() => {
    const rows=[...document.querySelectorAll('tr')];
    const headCells=[...(document.querySelector('tr th, thead')?.querySelectorAll('th,td')||[])].map(x=>x.textContent.trim());
    const titleBtn=document.querySelector('tbody tr button, tr [class*=t-title] button, tr button[class*=title]');
    const cursors=new Set();
    for (const r of rows.slice(0,8)) {
      const inner=[...r.querySelectorAll('*')];
      for (const el of inner) { const cs=getComputedStyle(el); if(cs.cursor && cs.cursor!=='default') cursors.add(cs.cursor); }
    }
    return JSON.stringify({
      rowCount: rows.length,
      headCells,
      hasOpenColumn: headCells.some(h=>h.includes("打开")),
      dragHandles: document.querySelectorAll('[class*=handle],[class*=grip],[aria-label*=拖]').length,
      titleIsButton: !!titleBtn && titleBtn.tagName === 'BUTTON',
      titleAria: titleBtn ? (titleBtn.getAttribute('aria-label')||null) : null,
      cursorsOnRows: [...cursors].join(","),
    });
  })()`) || "{}");
  console.log(`\n>>> D54③ 表头 = ${JSON.stringify(claims.headCells)}`);
  console.log(`    含「打开」列？${claims.hasOpenColumn}（应为 false）；拖拽把手节点数=${claims.dragHandles}（应为 0）`);
  console.log(`>>> D54④ 书名是真 <button>？${claims.titleIsButton}；aria-label=${JSON.stringify(claims.titleAria)}`);
  console.log(`>>> D54⑤ 行内出现的非 default 光标集合 = "${claims.cursorsOnRows}"（应只有一种，或 pointer+grab 分属卡片/表行）`);

  // ── ⑥ 悬停时副文本是否被隐藏（进度条上跳的根因）──────────────────────────
  const hoverTest = asObj(await main.ev(`(() => {
    const row=document.querySelector('tbody tr') || document.querySelector('tr');
    if(!row) return JSON.stringify({err:'no row'});
    const sub=row.querySelector('[class*=t-sub],[class*=sub]');
    const before = sub ? getComputedStyle(sub).whiteSpace + " / vis=" + (sub.offsetParent!==null) : null;
    return JSON.stringify({ before, subText: sub? sub.textContent.trim().slice(0,60):null, subLen: sub? sub.textContent.trim().length:0 });
  })()`) || "{}");
  console.log(`\n>>> D54⑥ 副文本 white-space/可见性 = ${hoverTest.before}；长度=${hoverTest.subLen}`);
  console.log(`    副文本前 60 字 = ${JSON.stringify(hoverTest.subText)}`);
  if (hoverTest.before && hoverTest.before.startsWith("nowrap")) {
    console.log("    ⚠️ 仍是 nowrap —— D54 声称改成「2 行截断」，需人工看图确认");
  } else {
    console.log("    ✅ 已不再是 nowrap（与 D54「改 2 行截断」一致）");
  }
  fs.writeFileSync(path.join(SHOTS, "d54.json"), JSON.stringify({ toTable, geo, claims, hoverTest }, null, 2));
  console.log(`\n截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
