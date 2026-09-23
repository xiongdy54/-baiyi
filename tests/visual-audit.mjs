// 逐功能截图核查（视觉验证层）
// 用真实构建产物 + 真实 CDP 驱动 Electron 主窗口，逐页截图并采集控制台错误与 DOM 事实。
// 隔离：独立 userData 目录 + 独立调试端口，绝不触碰真实库（§7.3）。
// 不 taskkill 全局 electron.exe（会与并行会话互杀），只回收自己 spawn 的进程。
// 运行：node tests/visual-audit.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9311";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual-audit-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual-audit");
const MARK = "VISUALAUDIT";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });

const results = [];
const consoleErrors = [];

async function targets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
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
          if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
            consoleErrors.push(`[${label}] ${m.params.type}: ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)}`);
          }
          if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            consoleErrors.push(`[${label}] EXC: ${(d.exception?.description || d.text || "").slice(0, 240)}`);
          }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 200);
          return r.result?.result?.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev, label };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1500);
  }
  throw new Error(`CDP 连接失败：${label}`);
}
async function shot(page, name) {
  const r = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  if (!r?.result?.data) { console.log(`  ✗ 截图失败 ${name}`); return null; }
  const f = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.result.data, "base64"));
  return f;
}
function record(page, name, factsExpr) {
  const btnNav = (text) => page.ev(`(() => { const b=[...document.querySelectorAll('.nav-item,nav button,aside button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); b?.click(); return !!b; })()`);
  return { name, facts: factsExpr };
}

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual-audit.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log],
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4000);

  // ── 播种真实感数据：3 本书 + 摘录 + 卡片 ────────────────────────────────
  const NL = String.fromCharCode(10);
  const books = [
    ["控制论入门", ["# 第一章 反馈", "", "负反馈调节使系统回归稳定，这是控制论的核心概念。", "", "# 第二章 控制", "", "控制论把反馈作为核心机制来研究系统的调节。"].join(NL)],
    ["书法十讲", ["# 第一讲 用笔", "", "中锋用笔是书法的基础，笔笔送到则骨力洞达。", "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL)],
    ["日本語概説", ["# 第一章 音韻", "", "日本語の音韻体系は母音五つからなる。", "", "# 第二章 助詞", "", "助詞は文法関係を標示する重要な要素である。"].join(NL)],
  ];
  const seeded = [];
  for (const [title, md] of books) {
    const r = await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} ${title}`)}, ${JSON.stringify(md)})))()`);
    seeded.push(JSON.parse(r || "{}"));
  }
  console.log(`播种材料: ${seeded.map((s) => `${s.documentId || "?"}`).join(", ")}`);
  await main.ev(`location.reload()`);
  await wait(5000);

  const goto = async (text, ms = 1200) => {
    const ok = await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item, .nav-item *, nav button, aside .nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); const el=b?.closest('.nav-item')||b; el?.click(); return !!el; })()`);
    await wait(ms);
    return ok;
  };
  const facts = async (sel) => main.ev(`JSON.stringify({
    hash: location.hash, title: document.title,
    bodyLen: document.body.innerText.length,
    h1: [...document.querySelectorAll('h1,h2,.page-title')].slice(0,3).map(x=>x.textContent.trim()),
    mainSelPresent: ${JSON.stringify(sel)} ? !!document.querySelector(${JSON.stringify(sel)}) : null,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    emptyState: document.body.innerText.includes("暂无") || document.body.innerText.includes("没有"),
    btnCount: document.querySelectorAll("button").length,
    focusable: document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]").length
  })`);

  const PAGES = [
    ["01-书架", "书架", ".book-card"],
    ["02-今日队列", "队列", ".queue"],
    ["03-复习", "复习", null],
    ["04-卡片库", "卡片", ".card-browser"],
    ["05-日记", "日记", null],
    ["06-知识", "知识", null],
    ["07-仪表盘", "仪表盘", null],
    ["08-设置", "设置", null],
  ];
  const navTexts = await main.ev(`JSON.stringify([...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()))`);
  console.log(`导航项: ${navTexts}`);

  for (const [file, want, sel] of PAGES) {
    const texts = JSON.parse(navTexts || "[]");
    const hit = texts.find((t) => t.includes(want)) || want;
    const clicked = await goto(hit);
    const f = JSON.parse((await facts(sel)) || "{}");
    const png = await shot(main, file);
    results.push({ page: file, clicked, ...f, png: png ? path.basename(png) : null });
    console.log(`  ${file}: nav=${clicked} sel=${f.mainSelPresent} body=${f.bodyLen}h overflowX=${f.overflowX} btn=${f.btnCount}`);
  }

  // ── 阅读器：打开第一本书 ────────────────────────────────────────────────
  await goto("书架");
  const opened = await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(MARK)})); if(!c) return "no-card"; c.click(); return "clicked"; })()`);
  await wait(5000);
  results.push({ page: "10-阅读器", opened, facts: JSON.parse((await facts(".reader")) || "{}") });
  console.log(`  10-阅读器: opened=${opened} ${JSON.stringify(results.at(-1).facts)}`);
  await shot(main, "10-阅读器");

  // 阅读器工具条逐项核查（目录 / 模式 / 外观 / 导图）
  const toolbar = await main.ev(`JSON.stringify([...document.querySelectorAll('.reader-engine-controls button')].map(b=>b.textContent.trim()||b.getAttribute('aria-label')||b.title))`);
  console.log(`  阅读器工具条: ${toolbar}`);
  results.push({ page: "11-阅读器工具条", toolbar });
  for (const label of ["目录", "导图"]) {
    const clicked = await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(!b) return false; b.click(); return true; })()`);
    await wait(1800);
    const f = JSON.parse((await facts(null)) || "{}");
    await shot(main, `11-${label}`);
    results.push({ page: `11-${label}`, clicked, ...f });
    console.log(`  11-${label}: clicked=${clicked} h1=${JSON.stringify(f.h1)} btn=${f.btnCount}`);
    await main.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==="正文"); b?.click(); return !!b; })()`);
    await wait(1200);
  }

  // ── 添加书籍模态 + 焦点陷阱核查 ─────────────────────────────────────────
  const addClicked = await main.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes("添加")); if(!b) return false; b.click(); return true; })()`);
  await wait(1500);
  const modalFacts = await main.ev(`JSON.stringify({
    hasDialog: !!document.querySelector('[role=dialog],.modal,.dialog'),
    ariaModal: document.querySelector('[aria-modal="true"]')?.getAttribute("aria-modal") ?? null,
    activeInModal: (()=>{const a=document.activeElement;return a? a.tagName+"."+(a.className||"").toString().slice(0,30):null})(),
    inputs: document.querySelectorAll('input,textarea,select').length
  })`);
  await shot(main, "12-添加模态");
  results.push({ page: "12-添加模态", addClicked, modal: JSON.parse(modalFacts || "{}") });
  console.log(`  12-添加模态: ${modalFacts}`);
  await main.ev(`(() => { const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true}); document.dispatchEvent(e); window.dispatchEvent(e); return 1; })()`);
  await wait(800);

  // ── 右下角后台活动指示器（D53 契约）──────────────────────────────────────
  const act = await main.ev(`JSON.stringify({
    present: !!document.querySelector('.background-activity,[class*=activity]'),
    cls: document.querySelector('[class*=activity]')?.className ?? null,
    collapsedHeight: (()=>{const el=document.querySelector('[class*=activity]'); return el? el.getBoundingClientRect().height : null})(),
    text: document.querySelector('[class*=activity]')?.innerText?.slice(0,120) ?? null
  })`);
  await shot(main, "13-活动指示器");
  results.push({ page: "13-活动指示器", activity: JSON.parse(act || "{}") });
  console.log(`  13-活动指示器: ${act}`);

  console.log(`\n== 控制台错误/警告 ${consoleErrors.length} 条 ==`);
  for (const e of consoleErrors.slice(0, 25)) console.log("  " + e);
  fs.writeFileSync(path.join(SHOTS, "facts.json"), JSON.stringify({ results, consoleErrors }, null, 2));
  console.log(`\n截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) process.kill(electron.pid); } catch { /* 已退出 */ }
  try { spawn("taskkill", ["/PID", String(electron?.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
