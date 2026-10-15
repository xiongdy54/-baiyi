// 逐功能截图核查 v2 —— 带真实内容的一轮
// 与 v1 的差别：v1 只看到空库降级态（队列/复习/卡片全是空态），本轮先播种
//   「有到期卡 / 有摘录 / 有日记 / 有两本对照书」再逐页截图，才算真的验到界面。
// 差分设计：两本书 —— A 本正文以 `# ` 开头（会压出空首章），B 本以散文开头（不该有空首章）。
//   若 B 本首屏有正文而 A 本没有，就精确锁定「空白首屏 = 合成 EPUB 空首章」这一条，
//   而不是笼统说「阅读器不显示」。
// 隔离：独立 userData + 独立端口 9313；只回收自己 spawn 的 PID，绝不按镜像名批量杀。
// 运行：node tests/visual-audit2.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9313";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual2-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual2");
const MARK = "VIS2";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const results = [];
const consoleErrors = [];
// CDP returnByValue 有时给字符串、有时已经是对象，统一兜住
const asObj = (v) => {
  if (v && typeof v === "object") return v;
  try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; }
};

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
          if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            consoleErrors.push("EXC: " + (d.exception?.description || d.text || "").slice(0, 300));
          }
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
            consoleErrors.push("err: " + (m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
          }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 240);
          return r.result?.result?.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev, label };
      }
    } catch { /* 未就绪 */ }
    await wait(1500);
  }
  throw new Error(`CDP 连接失败：${label}`);
}
async function shot(page, name) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  if (r?.result?.data) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.result.data, "base64"));
}
const facts = (page) => page.ev(`JSON.stringify({
  bodyLen: document.body.innerText.length,
  navGone: !document.querySelector('.nav-item'),
  crashed: document.body.innerText.includes("界面出现异常"),
  h: [...document.querySelectorAll('h1,h2,h3,.page-title,.section-title')].slice(0,4).map(x=>x.textContent.trim()).filter(Boolean),
  cards: document.querySelectorAll('.book-card').length,
  btns: document.querySelectorAll('button').length,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  text: document.body.innerText.replace(/\\s+/g," ").slice(0,150)
})`);

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual2.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);

  // ── 播种 ────────────────────────────────────────────────────────────────
  // A 本：以一级标题开头（触发合成 EPUB 的空首章）
  const bookA = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} A 控制论`)}, ${JSON.stringify(["# 第一章 反馈", "", "负反馈调节使系统回归稳定，这是控制论的核心概念，也是本卷的起点。", "", "# 第二章 控制", "", "控制论把反馈作为核心机制来研究系统的调节与通信。"].join(NL))})))()`) || "{}");
  // B 本：以散文开头（不应出现空首章）——与 A 本构成差分
  const bookB = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} B 书法十讲`)}, ${JSON.stringify(["中锋用笔是书法的基础，笔笔送到则骨力洞达。", "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL))})))()`) || "{}");
  console.log(`播种 A=${bookA.id ? "ok" : "FAIL"} B=${bookB.id ? "ok" : "FAIL"}`);

  // 14 张卡：10 张新卡（立即到期）+ 4 张带同源键
  const cardIds = [];
  for (let i = 0; i < 14; i++) {
    const c = asObj(await main.ev(`(async()=>JSON.stringify(await window.cardsAPI.create({
      noteText: ${JSON.stringify(`${MARK} 卡 ${i}`)}, cardType: "qa",
      frontMarkdown: ${JSON.stringify(`「反馈」的定义是什么？（第 ${i} 题）`)},
      backMarkdown: ${JSON.stringify(`使系统输出反过来抑制偏差、令系统回归稳态的机制。`)},
      priority: 40 + i, tags: [], domain: ["控制论"],
      sourceRef: { itemId: ${JSON.stringify(bookA.itemId || null)}, documentId: ${JSON.stringify(bookA.documentId || null)} },
      siblingKey: ${JSON.stringify(i < 4 ? "vis2-g1" : null)}
    })))()`) || "{}");
    if (!c.id) { console.log(`  建卡失败 #${i}: ${JSON.stringify(c).slice(0,200)}`); break; }
    cardIds.push(c.id);
  }
  // 摘录 + 日记
  await main.ev(`(async()=>{ await window.workflowAPI.create({ itemId: ${JSON.stringify(bookA.itemId)}, documentId: ${JSON.stringify(bookA.documentId)}, text: "负反馈调节使系统回归稳定。", priority: 50 }); return 1; })()`);
  for (const t of ["今天把控制论第一章读完了，负反馈这个概念终于串起来了。", "练字两小时，中锋还是不稳。"]) {
    await main.ev(`(async()=>JSON.stringify(await window.journalAPI.create({ contentMarkdown: ${JSON.stringify(t)} })))()`);
  }
  console.log(`播种卡片 ${cardIds.length} 张`);
  await main.ev(`location.reload()`);
  await wait(5500);

  const gotoNav = async (text) => {
    const ok = await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!b) return false; b.click(); return true; })()`);
    await wait(1600);
    return ok;
  };

  // ── 逐页：带内容 ────────────────────────────────────────────────────────
  const PAGES = ["书架", "队列", "复习", "卡片", "日记", "数据"];
  for (const p of PAGES) {
    const clicked = await gotoNav(p);
    const f = asObj(await facts(main));
    await shot(main, `2${PAGES.indexOf(p)}-${p}`);
    results.push({ page: p, clicked, ...f });
    console.log(`  ${p}: nav=${clicked} body=${f.bodyLen} btn=${f.btns} overflowX=${f.overflowX} | ${f.text.slice(0, 60)}`);
  }

  // 齿轮进设置（一级导航里没有「设置」，v1 就是因此没验到）
  const gear = await main.ev(`(() => { const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/设置|settings/i.test(x.getAttribute('aria-label')||'')||x.querySelector('svg')); if(!b) return false; b.click(); return true; })()`);
  await wait(1800);
  const gf = asObj(await facts(main));
  await shot(main, "30-设置");
  results.push({ page: "设置(齿轮)", gear, ...gf });
  console.log(`  设置(齿轮): clicked=${gear} body=${gf.bodyLen} btn=${gf.btns} | ${gf.text.slice(0, 70)}`);
  await main.ev(`(() => { const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true}); document.dispatchEvent(e); return 1; })()`);
  await wait(1000);

  // ── 粘贴材料编辑器（v49.3/D177 两步入口：选单 → 粘贴材料）：焦点陷阱 + Escape ────
  await gotoNav("书架");
  const add = await main.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes("添加材料")); if(!b) return false; b.click(); return true; })()`);
  await wait(600);
  await main.ev(`(() => { const it=[...document.querySelectorAll('[role=menu] .dd-item')].find(x=>x.textContent.includes("粘贴材料")); if(it) it.click(); return !!it; })()`);
  await wait(1600);
  const m1 = asObj(await main.ev(`JSON.stringify({
    dialog: !!document.querySelector('[role=dialog],[aria-modal="true"],.modal'),
    ariaModal: document.querySelector('[aria-modal="true"]')?.getAttribute("aria-modal") ?? null,
    active: document.activeElement ? document.activeElement.tagName + "." + String(document.activeElement.className).slice(0,24) : null,
    inputs: document.querySelectorAll('input,textarea,select').length
  })`) || "{}");
  await shot(main, "31-粘贴材料编辑器");
  // Tab 十次，看焦点是否被关在模态里
  const trap = await main.ev(`(async()=>{
    const box=document.querySelector('[role=dialog],[aria-modal="true"],.modal');
    if(!box) return "no-dialog";
    for(let i=0;i<10;i++){
      const e=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
      (document.activeElement||document.body).dispatchEvent(e);
      await new Promise(r=>setTimeout(r,30));
    }
    return box.contains(document.activeElement) ? "in-modal" : "ESCAPED:"+(document.activeElement?.tagName||"?");
  })()`);
  results.push({ page: "粘贴材料编辑器", add, ...m1, trap });
  console.log(`  粘贴材料编辑器: opened=${add} dialog=${m1.dialog} ariaModal=${m1.ariaModal} active=${m1.active} Tab×10→${trap}`);
  await main.ev(`(() => { const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true}); document.dispatchEvent(e); return 1; })()`);
  await wait(1200);
  const closed = await main.ev(`!document.querySelector('[role=dialog],[aria-modal="true"]')`);
  console.log(`  Escape 能关掉模态：${closed}`);

  // ── 复习页：真实一张卡的正面 / 背面 ──────────────────────────────────────
  await gotoNav("复习");
  const front = asObj(await facts(main));
  await shot(main, "32-复习正面");
  const flipped = await main.ev(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/显示答案|翻面|答案|空格/.test(x.textContent));
    if(b){b.click(); return b.textContent.trim();}
    const e=new KeyboardEvent('keydown',{key:' ',bubbles:true}); (document.activeElement||document.body).dispatchEvent(e); return "space";
  })()`);
  await wait(1500);
  const back = asObj(await facts(main));
  await shot(main, "33-复习背面");
  results.push({ page: "复习正/背面", front, flipped, back });
  console.log(`  复习: 正面 body=${front.bodyLen} 翻面=${JSON.stringify(flipped)} 背面 body=${back.bodyLen} | ${back.text.slice(0,60)}`);

  // ── 阅读器差分：A 本（# 开头）vs B 本（散文开头）──────────────────────────
  const openBook = async (title) => {
    await gotoNav("书架");
    const r = await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(title)})); if(!c) return "no-card"; c.click(); return "clicked"; })()`);
    await wait(5000);
    const f = asObj(await facts(main));
    const toc = await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录")); b?.click(); return !!b; })()`);
    await wait(1200);
    const tocItems = await main.ev(`JSON.stringify([...document.querySelectorAll('.toc-item,[class*=toc] li,[class*=toc] button,a[class*=toc]')].map(x=>x.textContent.trim()).filter(Boolean).slice(0,8))`);
    const bodyText = await main.ev(`(() => { const el=document.querySelector('.reader-content,.reader-engine,[class*=reader] iframe'); if(el&&el.contentDocument) return el.contentDocument.body.innerText.replace(/\\s+/g,' ').slice(0,120); const c=[...document.querySelectorAll('[class*=reader]')].map(x=>x.innerText||'').sort((a,b)=>b.length-a.length)[0]; return (c||'').replace(/\\s+/g,' ').slice(0,120); })()`);
    return { r, f, toc, tocItems, bodyText };
  };
  const A = await openBook(`${MARK} A`);
  await shot(main, "34-阅读器A-标题开头");
  console.log(`  A 本(# 开头): ${JSON.stringify(A.tocItems)} 正文长度=${String(A.bodyText).length} 预览="${String(A.bodyText).slice(0, 40)}"`);
  await gotoNav("书架");
  const B = await openBook(`${MARK} B`);
  await shot(main, "35-阅读器B-散文开头");
  console.log(`  B 本(散文开头): ${JSON.stringify(B.tocItems)} 正文长度=${String(B.bodyText).length} 预览="${String(B.bodyText).slice(0, 40)}"`);
  results.push({ page: "阅读器差分", A: { toc: A.tocItems, len: String(A.bodyText).length }, B: { toc: B.tocItems, len: String(B.bodyText).length } });

  console.log(`\n== 控制台错误 ${consoleErrors.length} 条 ==`);
  for (const e of consoleErrors.slice(0, 20)) console.log("  " + e);
  fs.writeFileSync(path.join(SHOTS, "facts.json"), JSON.stringify({ results, consoleErrors }, null, 2));
  console.log(`\n截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
