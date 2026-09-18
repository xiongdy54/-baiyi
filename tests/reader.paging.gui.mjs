// v37 阅读器分页布局 + 导航健壮性回归（CDP 驱动真实应用，自启自关；node tests/reader.paging.gui.mjs）
// 背景（2026-09-15 用户现场）：
//   ① 分页模式每页内容过少——adapter 曾以无单位数字设置 margin 属性，paginator 把它写进
//      CSS 变量 --_margin，minmax(48,1fr) 非法导致 grid-template-rows 整条失效、页面高度
//      塌缩到内容高度（实测 653px 视口只剩 318px 页面）。修复后行高应为 48/middle/48。
//   ② 跳转 Cover 后翻页/目录/滚轮全部失灵——翻页链路四处缺陷叠加：#turnPage 无 try/finally
//      （异常即永久 #locked）、跨章节 relocate 的 setSelectionTo 拿到已销毁文档节点必抛、
//      并发导航杀掉在途 iframe 加载后 load promise 永不 settle（#display → #turnPage 永久
//      挂起）、章节加载失败把 #index 清空令 #adjacentIndex 永久失效。
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-paging-userdata（先清空），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9239";
const USER_DATA = path.join(ROOT, "tests", "tmp-paging-userdata");
const EPUB_PATH = path.join(ROOT, "tests", "tmp-paging-fixture.epub");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function connectTarget(match, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await listTargets()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        let id = 0;
        const pending = new Map();
        const consoleLog = [];
        const fmt = (a) => (a.value ?? a.description ?? JSON.stringify(a)).toString();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
            return;
          }
          if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            consoleLog.push("EXC: " + (d.exception?.description || d.text).slice(0, 300));
          } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
            consoleLog.push("ERR: " + m.params.args.map(fmt).join(" ").slice(0, 300));
          }
        });
        const send = (method, params = {}) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          const exd = r.result?.exceptionDetails;
          if (exd) return "EXC: " + (exd.exception?.description || exd.text || JSON.stringify(exd)).slice(0, 300);
          const v = r.result?.result?.value;
          if (v === undefined) return "RAW:" + JSON.stringify(r).slice(0, 300);
          return v;
        };
        await send("Runtime.enable");
        return { ws, send, eval: evalJS, consoleLog, url: t.url };
      }
    } catch {
      /* 端口未就绪 */
    }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

// 夹具：5 章 EPUB，每章大量段落（保证分页多页），第一章首部一张图（模拟封面页）
async function buildFixtureFile() {
  const zip = new JSZip();
  const para = (tag, n) => Array.from({ length: n }, (_, i) =>
    `<p>${tag}第${i}段。间隔重复记忆法通过安排复习时间来对抗遗忘曲线，每一次提取练习都会加强记忆痕迹的强度，并且让下一次复习的间隔变得更长，从而用更少的复习次数获得更牢固的长期记忆。这是经过一百多年认知科学实验反复验证的结论。</p>`).join("\n");
  const chapter = (i) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i}章</title></head><body>
${i === 1 ? '<div class="coverbox"><img src="pic.png" alt="封面示意图"/></div>' : ""}
<h1>第${i}章 标题</h1>
${para(`第${i}章正文。`, 40)}
</body></html>`;
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid"><metadata><dc:identifier id="uid">urn:uuid:paging-fixture</dc:identifier><dc:title>FSRSTEST-paging</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-09-15T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/><item id="c4" href="c4.xhtml" media-type="application/xhtml+xml"/><item id="c5" href="c5.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="c4"/><itemref idref="c5"/></spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li><li><a href="c3.xhtml">第三章</a></li><li><a href="c4.xhtml">第四章</a></li><li><a href="c5.xhtml">第五章</a></li></ol></nav></body></html>`);
  for (const i of [1, 2, 3, 4, 5]) zip.file(`OEBPS/c${i}.xhtml`, chapter(i));
  zip.file("OEBPS/pic.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(EPUB_PATH, buf);
}

async function main() {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留 */
  }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  await buildFixtureFile();
  const out = openSync(path.join(ROOT, "tests", "reader.paging.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  try {
    // 0. 造数（统一导入入口）+ 固定为分页模式（用户现场口径）
    const seeded = await cdp.eval(`(async () => {
      try {
        const book = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(EPUB_PATH)}, name: "FSRSTEST-paging.epub", ext: "epub" });
        return { ok: true, id: book && book.id };
      } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
    })()`);
    check("0 造数", Boolean(seeded?.id), JSON.stringify(seeded));
    await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "paged" }, appearance: { theme: "paper" } })`);
    await cdp.eval(`location.reload()`);
    await wait(2500);

    // 1. 打开书
    await cdp.eval(`(() => { const b = [...document.querySelectorAll(".book-card")].find(x => x.textContent.includes("FSRSTEST-paging")); b?.click(); return !!b; })()`);
    await wait(4000);
    check("1 内核就绪（分页模式打开）", await cdp.eval(`!!window.__readerKernel`));

    // 2. 分页页面高度占满视口（margin 单位修复的核心断言）
    //    容差 0.75：上下各留 --_margin(48px)，>75% 即视为行高未塌缩（修复前仅 ~49%）
    const geo = await cdp.eval(`(async () => {
      await new Promise((r) => setTimeout(r, 800));
      const k = window.__readerKernel;
      const c = k.__getContents()[0];
      const fe = c.doc.defaultView.frameElement;
      const host = document.querySelector(".reader-engine-host").getBoundingClientRect();
      const chain = [];
      let el = fe;
      for (let i = 0; el && i < 6; i++) { chain.push({ h: Math.round(el.getBoundingClientRect().height), id: el.id || el.tagName }); el = el.parentElement || (el.getRootNode && el.getRootNode().host); }
      return { hostH: Math.round(host.height), chain };
    })()`);
    const topRow = geo?.chain?.find((x) => x.id === "top");
    const container = geo?.chain?.find((x) => x.id === "container");
    check("2a #top 三行网格上下各 48px（margin 带 px）", Boolean(topRow && container && Math.abs(container.h - (topRow.h - 96)) < 4), JSON.stringify(geo?.chain));
    check("2b 页面高度 ≥ 视口 75%（修复前仅 ~49%）", Boolean(container && geo && container.h >= geo.hostH * 0.75), container && geo && `${container.h}/${geo.hostH}`);

    // 3. 导航健壮性：连续跨章节翻页（next×12 + prev×4）全部限时 settle
    let stuck = 0;
    for (let i = 0; i < 12; i++) {
      const r = await cdp.eval(`Promise.race([window.__readerKernel.next().then(() => "ok"), new Promise((res) => setTimeout(() => res("STUCK"), 4000))])`);
      if (r !== "ok") stuck++;
      await wait(150);
    }
    for (let i = 0; i < 4; i++) {
      const r = await cdp.eval(`Promise.race([window.__readerKernel.prev().then(() => "ok"), new Promise((res) => setTimeout(() => res("STUCK"), 4000))])`);
      if (r !== "ok") stuck++;
      await wait(150);
    }
    check("3 连续 16 次跨章翻页无锁死", stuck === 0, `STUCK=${stuck}`);

    // 4. 目录跳回第一章（等价于用户"点 Cover"）后再翻页——修复前该路径可整体失灵
    const j = await cdp.eval(`Promise.race([window.__readerKernel.goTo({ href: "c1.xhtml" }).then(() => "ok"), new Promise((res) => setTimeout(() => res("STUCK"), 6000))])`);
    check("4a 目录跳第一章不挂起", j === "ok", j);
    const cfi1 = await cdp.eval(`(window.__readerKernel.getCurrentLocation()?.cfi || "")`);
    const nextOk = await cdp.eval(`Promise.race([window.__readerKernel.next().then(() => "ok"), new Promise((res) => setTimeout(() => res("STUCK"), 4000))])`);
    const cfi2 = await cdp.eval(`(window.__readerKernel.getCurrentLocation()?.cfi || "")`);
    check("4b 跳转后翻页推进且不锁死", nextOk === "ok" && Boolean(cfi1) && cfi1 !== cfi2, `${nextOk} | ${cfi1} → ${cfi2}`);

    // 5. 真实滚轮翻页（分页模式滚轮=翻页）
    const rect = await cdp.eval(`(() => { const r = document.querySelector(".reader-engine-host")?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : { x: 200, y: 200 }; })()`);
    await cdp.send("Page.enable");
    const cfiBefore = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    for (let i = 0; i < 6; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: rect.x, y: rect.y, deltaX: 0, deltaY: 240 });
      await wait(220);
    }
    await wait(1200);
    const wheelMoved = (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) !== cfiBefore;
    check("5 真实滚轮翻页推进", wheelMoved);

    // 6. 控制台错误清点（过滤良性 ResizeObserver 通知与 CSP 开发警告）
    const errs = [...new Set(cdp.consoleLog)].filter((l) =>
      !l.includes("ResizeObserver loop") && !l.includes("Security Warning") && !l.includes("This warning"));
    check("6 全程无控制台错误/异常", errs.length === 0, JSON.stringify(errs.slice(0, 4)));
    errs.slice(0, 6).forEach((e) => console.log("    [错误] " + e.split("\n")[0]));
  } finally {
    // 7. 清理测试书
    try {
      await cdp.eval(`(async () => {
        const items = await window.libraryAPI.list();
        for (const it of items.filter((x) => (x.title || "").includes("FSRSTEST"))) await window.libraryAPI.delete(it.id);
        return true;
      })()`);
    } catch { /* 清理失败不影响结论 */ }
    fs.rmSync(EPUB_PATH, { force: true });
  }

  await cdp.ws.close();
  electron?.kill();
  await wait(500);
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("脚本失败:", e);
  electron?.kill();
  process.exit(1);
});
