// M6-3 导入格式扩展收口 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m6-3.gui.mjs）
// 覆盖：HTML 建册 → 阅读（synth 路径正文可见）/ FB2 直读（内核渲染文本）/ CBZ 直读（pre-paginated 图片渲染）
//       → 重启不丢 → 清理。
// 边界说明：HTML→markdown 的**转换正确性**由 tests/m6-3.test.cjs（jsdom）覆盖；本测试经 IPC 建册验证
//   DB/书架/阅读器全链路（原生文件对话框无法自动化，D27 的按扩展名路由由 m6-3.test.cjs 路由表断言覆盖）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9224";
const FIXDIR = path.join(ROOT, "tests", "tmp-m63-fixtures");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

const ARTICLE_HTML = `<!doctype html>
<html><head><title>绩效与工作节奏</title>
<style>body { color: red; }</style><script>window.track=1;</script></head>
<body>
<nav><a href="/">首页</a><a href="/hot">热榜</a></nav>
<article>
<h1>只要跑不死、就往死里跑</h1>
<p>FSRSTEST 三体锚甲：绩效主义把人的价值简化为可量化的产出。</p>
<p>当健康成为绩效的代价，我们需要重新追问工作节奏。</p>
</article>
<div class="sidebar">相关阅读：十本关于工作伦理的书</div>
</body></html>`;

// HTML 转换在渲染层（DOMParser），本测试用与 htmlImport.ts 等价的期望结果直接建册
const HTML_MARKDOWN = `# 只要跑不死、就往死里跑\n\nFSRSTEST 三体锚甲：绩效主义把人的价值简化为可量化的产出。\n\n当健康成为绩效的代价，我们需要重新追问工作节奏。`;

const FB2_XML = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<body><section><title><p>第一章</p></title><p>FSRSTEST 三体锚乙：这是 FB2 夹具正文。</p></section></body>
</FictionBook>`;

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  );
}

async function buildFixtures() {
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const htmlPath = path.join(FIXDIR, "FSRSTEST-M6-3 网页存档.html");
  fs.writeFileSync(htmlPath, ARTICLE_HTML, "utf8");
  const fb2Path = path.join(FIXDIR, "FSRSTEST-M6-3 夹具书.fb2");
  fs.writeFileSync(fb2Path, FB2_XML, "utf8");
  const cbzPath = path.join(FIXDIR, "FSRSTEST-M6-3 漫画.cbz");
  const zip = new JSZip();
  zip.file("p1.png", tinyPng());
  zip.file("p2.png", tinyPng());
  fs.writeFileSync(cbzPath, await zip.generateAsync({ type: "nodebuffer" }));
  return { htmlPath, fb2Path, cbzPath };
}

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

async function startApp(logName) {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", logName), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false
  });
  const cdp = await connect();
  await wait(1500);
  return cdp;
}

const probeStateExpr = `(() => {
  const host = document.querySelector(".reader-engine-host");
  if (!host) return JSON.stringify({ noHost: true });
  const k = window.__readerKernel;
  const entries = k && k.__getContents ? k.__getContents() : [];
  const doc = (entries.find((x) => x.doc) || {}).doc || null;
  const text = doc ? (doc.body?.textContent || "").trim() : "";
  const fxl = host.querySelector("foliate-fxl");
  const r = fxl ? fxl.getBoundingClientRect() : null;
  const loc = k && k.getCurrentLocation ? k.getCurrentLocation() : null;
  return JSON.stringify({ text: text.slice(0, 120), entries: entries.length, loc, fxl: fxl ? { w: Math.round(r.width), h: Math.round(r.height) } : null });
})()`;
async function openBookProbeStateOnly(cdp) {
  const raw = await cdp.eval(probeStateExpr);
  try { return JSON.parse(raw); } catch { return { raw: String(raw) }; }
}

const clickCardByTitle = (title) => `(() => {
  const el = [...document.querySelectorAll('.book-card')].find(e => e.getAttribute('title') === ${JSON.stringify(title)});
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;

/** 打开书并读取引擎内渲染状态（文本/img/iframe 计数） */
async function openBookProbe(cdp, title) {
  await cdp.eval(`location.reload()`);
  await wait(2500);
  const click = await cdp.eval(clickCardByTitle(title));
  await wait(4000);
  const raw = await cdp.eval(`(() => {
    const host = document.querySelector(".reader-engine-host");
    if (!host) return JSON.stringify({ noHost: true });
    const k = window.__readerKernel;
    const entries = k && k.__getContents ? k.__getContents() : [];
    const doc = (entries.find((x) => x.doc) || {}).doc || null;
    const text = doc ? (doc.body?.textContent || "").trim() : "";
    const docImgs = doc ? doc.querySelectorAll("img").length : 0;
    const iframes = host.querySelectorAll("iframe").length;
    const hostImgs = host.querySelectorAll("img").length;
    const canvas = host.querySelectorAll("canvas").length;
    const fxl = host.querySelector("foliate-fxl");
    const fxlRect = fxl ? fxl.getBoundingClientRect() : null;
    const loc = k && k.getCurrentLocation ? k.getCurrentLocation() : null;
    return JSON.stringify({ text: text.slice(0, 120), docImgs, iframes, hostImgs, canvas, entries: entries.length, loc,
      fxl: fxl ? { w: Math.round(fxlRect.width), h: Math.round(fxlRect.height) } : null });
  })()`);
  return { click, state: (() => { try { return JSON.parse(raw); } catch { return { raw: String(raw) }; } })() };
}

(async () => {
  console.log("== 0) 造 fixture + 启动应用 ==");
  const fx = await buildFixtures();
  check("fixture 就绪（html/fb2/cbz）", fs.existsSync(fx.htmlPath) && fs.existsSync(fx.fb2Path) && fs.existsSync(fx.cbzPath), FIXDIR);
  const cdp = await startApp("m6-3.gui.app.log");

  console.log("== 1) 三格式建册（HTML / FB2 / CBZ） ==");
  const created = await cdp.eval(`(async () => {
    const out = {};
    try {
      out.html = await window.libraryAPI.createFromHtml({ path: ${JSON.stringify(fx.htmlPath)}, name: "FSRSTEST-M6-3 网页存档.html", title: "绩效与工作节奏", markdown: ${JSON.stringify(HTML_MARKDOWN)} });
    } catch (e) { out.html = "THREW:" + String(e.message).slice(0, 120); }
    try {
      out.fb2 = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(fx.fb2Path)}, name: "FSRSTEST-M6-3 夹具书.fb2", ext: "fb2" });
    } catch (e) { out.fb2 = "THREW:" + String(e.message).slice(0, 120); }
    try {
      out.cbz = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(fx.cbzPath)}, name: "FSRSTEST-M6-3 漫画.cbz", ext: "cbz" });
    } catch (e) { out.cbz = "THREW:" + String(e.message).slice(0, 120); }
    return JSON.stringify(out);
  })()`);
  const c = typeof created === "string" ? JSON.parse(created) : created;
  check("HTML 建册成功", !!c?.html?.id, JSON.stringify(c?.html));
  check("FB2 建册成功", !!c?.fb2?.id, JSON.stringify(c?.fb2));
  check("CBZ 建册成功", !!c?.cbz?.id, JSON.stringify(c?.cbz));

  const srcTypes = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const pick = (t) => xs.find((x) => x.title === t);
    return JSON.stringify({
      html: pick("绩效与工作节奏")?.sourceType,
      fb2: pick("FSRSTEST-M6-3 夹具书")?.sourceType,
      cbz: pick("FSRSTEST-M6-3 漫画")?.sourceType
    });
  })()`);
  const st = JSON.parse(srcTypes);
  check("source_type：html/ebook 落库", st.html === "html" && st.fb2 === "ebook" && st.cbz === "ebook", srcTypes);

  console.log("== 2) assets 落盘（原文件按类型/扩展名） ==");
  const ids = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const pick = (t) => xs.find((x) => x.title === t);
    return JSON.stringify({ html: pick("绩效与工作节奏")?.id, fb2: pick("FSRSTEST-M6-3 夹具书")?.id, cbz: pick("FSRSTEST-M6-3 漫画")?.id });
  })()`);
  const idObj = JSON.parse(ids);
  const UD = path.join(process.env.APPDATA, "incremental-reading-dev", "assets");
  check("html-original 落盘", fs.existsSync(path.join(UD, String(idObj.html), "original.html")), idObj.html);
  check("ebook-original 落盘且扩展名保真（.fb2/.cbz）",
    fs.existsSync(path.join(UD, String(idObj.fb2), "original.fb2")) && fs.existsSync(path.join(UD, String(idObj.cbz), "original.cbz")),
    `${idObj.fb2}/${idObj.cbz}`);

  console.log("== 3) HTML 阅读（synth 路径） ==");
  // syn-3（§9.4 空首章清理）后首章即正文章；保留目录跳转定位（按标题查找，结构无关）
  await cdp.eval(`location.reload()`);
  await wait(2500);
  await cdp.eval(clickCardByTitle("绩效与工作节奏"));
  await wait(4000);
  await cdp.eval(`(() => { document.querySelector('[data-reader-sidebar-toggle]')?.click(); return 1; })()`);
  await wait(700);
  await cdp.eval(`(() => { const el=[...document.querySelectorAll('.reader-toc-item')].find(e=>e.textContent.includes('只要跑不死')); el?.click(); return 1; })()`);
  await wait(1500);
  const htmlBook = await openBookProbeStateOnly(cdp);
  check("HTML 书进入阅读引擎且正文可见", htmlBook.text.includes("FSRSTEST 三体锚甲"), JSON.stringify(htmlBook).slice(0, 160));
  check("HTML 正文无导航噪音（导入层已提取）", !htmlBook.text.includes("热榜"), htmlBook.text.slice(0, 80));

  console.log("== 4) FB2 直读（foliate 内核按扩展名分发） ==");
  const fb2Book = await openBookProbe(cdp, "FSRSTEST-M6-3 夹具书");
  check("FB2 书打开且文本渲染", fb2Book.state.text.includes("FSRSTEST 三体锚乙"), JSON.stringify(fb2Book.state).slice(0, 160));

  console.log("== 5) CBZ 直读（pre-paginated 图片） ==");
  const cbzBook = await openBookProbe(cdp, "FSRSTEST-M6-3 漫画");
  // CBZ 走 foliate 固定布局渲染器；foliate-view 与 foliate-fxl 均为闭式 shadow DOM
  // （vendor/foliate-js 的 attachShadow({mode:'closed'})），容器与内部 iframe 图片对测试探针不可及——
  // 渲染画面属 L3 人工冒烟（另经截图确认）。此处断言内核可观测证据：打开有位置 + zip 内 2 张图各成一节。
  const cbzOpened = Boolean(cbzBook.state.loc) && (cbzBook.state.entries ?? 0) >= 2;
  check("CBZ 内核打开且 2 张图各成一节（渲染容器在闭式 shadow DOM）", cbzOpened, JSON.stringify(cbzBook.state).slice(0, 200));

  console.log("== 6) 重启 → 数据不丢 ==");
  const cdp2 = await startApp("m6-3.gui.app2.log");
  const after = await cdp2.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const titles = ["绩效与工作节奏", "FSRSTEST-M6-3 夹具书", "FSRSTEST-M6-3 漫画"];
    return JSON.stringify({ has: titles.every((t) => xs.some((x) => x.title === t)) });
  })()`);
  check("重启后三本书不丢", JSON.parse(after).has === true, after);

  console.log("== 7) 清理 ==");
  const titles4 = ["绩效与工作节奏", "FSRSTEST-M6-3 夹具书", "FSRSTEST-M6-3 漫画"];
  let delRaw = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    delRaw = await cdp2.eval(`(async () => {
      const titles = ${JSON.stringify(titles4)};
      const out = [];
      const xs = await window.libraryAPI.list();
      for (const t of titles) {
        const it = xs.find((x) => x.title === t);
        if (!it) { out.push(t + ":absent"); continue; }
        try { const ok = await window.libraryAPI.remove(it.id); out.push(t + ":" + (ok ? "removed" : "false")); }
        catch (e) { out.push(t + ":threw"); }
      }
      return JSON.stringify(out);
    })()`);
    await wait(800);
    const leftNow = await cdp2.eval(`(async () => {
      const xs = await window.libraryAPI.list();
      return ${JSON.stringify(titles4)}.filter((t) => xs.some((x) => x.title === t)).length;
    })()`);
    if (leftNow === 0) break;
  }
  const leftAfter = await cdp2.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const titles = ["绩效与工作节奏", "FSRSTEST-M6-3 夹具书", "FSRSTEST-M6-3 漫画"];
    return titles.filter((t) => xs.some((x) => x.title === t)).length;
  })()`);
  check("测试书已清理", leftAfter === 0, `${delRaw} left=${leftAfter}`);
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  check("fixture 目录已删", !fs.existsSync(FIXDIR), FIXDIR);

  console.log(`\n==== M6-3 GUI SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) { console.log("FAILURES 见上方 ✗ 行"); process.exitCode = 1; }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
})().catch((e) => {
  console.error("M6-3 GUI CRASH:", e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
  process.exit(1);
});
