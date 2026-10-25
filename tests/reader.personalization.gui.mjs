// D130 R3 阅读个性化——GUI 回归（CDP 驱动真实应用，自启自关；node tests/reader.personalization.gui.mjs）
// @runtime: electron  @gui: true  @id: READER-PERSONALIZATION-D130
// 依据：docs/design/READER-PERSONALIZATION-D130.md §8.2（A–I 九组断言）+ §4（data-* 探针面）。
// 骨架与隔离同 tests/reader.paging.gui.mjs：自启自关、M7_TEST_USERDATA 指向 tests/tmp-personalization-userdata
// （先清空，绝不触碰真实库 §7.3）、fixture EPUB/PDF 现场构造（确定性）。
// 注意：跑前先 npm run build（GUI 套件纪律）；须先关闭应用（§7.1.8）。
// 探针清单（§4 各项 data-*）：data-reader-row / data-reader-theme-save / data-reader-theme-option /
//   data-reader-theme-name-input / data-reader-theme-manage-list / data-reader-setting / data-reader-tap-hint。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9241";
const USER_DATA = path.join(ROOT, "tests", "tmp-personalization-userdata");
const EPUB_PATH = path.join(ROOT, "tests", "tmp-personalization-fixture.epub");
const PDF_PATH = path.join(ROOT, "tests", "tmp-personalization-fixture.pdf");

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

// 夹具：5 章 EPUB（每章大量段落保证分页多页——F 组 16 次跨章翻页与 B 组 margin 几何都依赖）
async function buildEpubFixture() {
  const zip = new JSZip();
  const para = (tag, n) => Array.from({ length: n }, (_, i) =>
    `<p>${tag}第${i}段。间隔重复记忆法通过安排复习时间来对抗遗忘曲线，每一次提取练习都会加强记忆痕迹的强度，并且让下一次复习的间隔变得更长，从而用更少的复习次数获得更牢固的长期记忆。这是经过一百多年认知科学实验反复验证的结论。</p>`).join("\n");
  const chapter = (i) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i}章</title></head><body>
<h1>第${i}章 标题</h1>
${para(`第${i}章正文。`, 40)}
</body></html>`;
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid"><metadata><dc:identifier id="uid">urn:uuid:personalization-fixture</dc:identifier><dc:title>FSRSTEST-personalization</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-10-12T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[1, 2, 3, 4, 5].map((i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${[1, 2, 3, 4, 5].map((i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${[1, 2, 3, 4, 5].map((i) => `<li><a href="c${i}.xhtml">第${i}章</a></li>`).join("")}</ol></nav></body></html>`);
  for (const i of [1, 2, 3, 4, 5]) zip.file(`OEBPS/c${i}.xhtml`, chapter(i));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(EPUB_PATH, buf);
}

// 夹具：3 页未压缩 PDF（xref 偏移现场计算；pdf.js 对最小结构宽容）
function buildPdfFixture() {
  const pages = ["Personalization Page 1", "Personalization Page 2", "Personalization Page 3"];
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count ${pages.length} >>`);
  pages.forEach((_, i) => objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + i} 0 R /Resources << /Font << /F1 9 0 R >> >> >>`));
  pages.forEach((text) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  fs.writeFileSync(PDF_PATH, Buffer.from(pdf, "latin1"));
}

// ---------- 页面内帮手（eval 片段） ----------
// foliate-paginator 在 foliate-view 的 shadow 里；iframe frameElement 的 getRootNode().host 即它
const JS_PAGINATOR = `(() => {
  try {
    const c = window.__readerKernel?.__getContents?.()[0];
    if (!c) return null;
    let el = c.doc.defaultView.frameElement;
    for (let i = 0; el && i < 6; i++) {
      if (String(el.tagName).toUpperCase() === "FOLIATE-PAGINATOR") return { tag: el.tagName, el };
      el = el.parentElement || (el.getRootNode && el.getRootNode().host);
    }
    return null;
  } catch (e) { return { err: String(e) }; }
})()`;
// 打开「阅读设置」弹层并返回面板在场与否（探针的挂载点）。
// D130 实跑修正（R3 T7）：React 18 对 click 的 DOM 提交是**异步**的——同一次 eval 内
// click 后立即 querySelector 拿不到面板（首跑 A4/B3/C3/D0/E1–E4 全数落此坑）；
// 且菜单已开时再点按钮是「收起」（toggle），D3 类连续断言会把自己刚开的菜单关掉。
// 故：幂等（已开不点）+ await 提交窗口；调用方一律 `await ${JS_OPEN_SETTINGS_MENU}`。
const JS_OPEN_SETTINGS_MENU = `(async () => {
  if (!document.querySelector('[data-tool-menu-panel="settings"]')) {
    document.querySelector('[data-tool-menu-btn="settings"]')?.click();
    await new Promise((r) => setTimeout(r, 250));
  }
  return !!document.querySelector('[data-tool-menu-panel="settings"]');
})()`;

// D130 R3 P2：两本测试书同题（落库 title 去扩展名，卡片 DOM 无扩展名文本），标题前缀匹配 +
// DOM 序不确定——改为经 libraryAPI 的落盘名精确匹配后缀定位条目，再点对应 data-entry 卡片（顺序无关）。
// EPUB 走 readEbookFile 的 original.epub 名；PDF 走 readPdfFile 有无字节判别（createFromPdf 落
// pdf-original 资产，readEbookFile 对它恒 null——D130 实跑修正，R3 T7）。
async function openBook(cdp, ext) {
  const id = await cdp.eval(`(async () => {
    const items = await window.libraryAPI.list();
    for (const it of items.filter((x) => (x.title || "").includes("FSRSTEST-personalization"))) {
      try {
        if (${JSON.stringify(ext)} === ".pdf") {
          const b = await window.libraryAPI.readPdfFile(it.id);
          if (b && b.length) return it.id;
          continue;
        }
        const f = await window.libraryAPI.readEbookFile(it.id);
        if (f && String(f.name || "").endsWith(${JSON.stringify(ext)})) return it.id;
      } catch { /* 下一候选 */ }
    }
    return null;
  })()`);
  const clicked = id ? await cdp.eval(`(() => { const b = document.querySelector('[data-entry="${id}"] .book-card'); b?.click(); return !!b; })()`) : false;
  await wait(4000);
  return Boolean(clicked);
}

async function seedSettings(cdp, settings) {
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", ${JSON.stringify(settings)})`);
  await cdp.eval(`location.reload()`);
  await wait(2500);
}

async function main() {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  await buildEpubFixture();
  buildPdfFixture();
  const out = openSync(path.join(ROOT, "tests", "reader.personalization.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  try {
    // 0. 造数（统一导入入口：EPUB + PDF）
    // D130 实跑修正（R3 T7）：PDF 必须走 libraryAPI.createFromPdf（sourceType="pdf" → App.loadReaderBook
    // 才给 engine:"pdf" 走 pdf.js 内核）。createFromBookFile 恒落 sourceType="ebook"，PDF 会进 foliate
    // 内核并抛「PDF support is not vendored」（首跑 E 组全数落此坑）。
    const seeded = await cdp.eval(`(async () => {
      try {
        const epub = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(EPUB_PATH)}, name: "FSRSTEST-personalization.epub", ext: "epub" });
        const pdf = await window.libraryAPI.createFromPdf({ path: ${JSON.stringify(PDF_PATH)}, name: "FSRSTEST-personalization.pdf" });
        return { ok: true, epub: epub && epub.id, pdf: pdf && pdf.id };
      } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
    })()`);
    check("0 造数（EPUB+PDF）", Boolean(seeded?.epub && seeded?.pdf), JSON.stringify(seeded));
    // 固定滚动模式基线（A/C 组需要；B 组自行改分页）
    await seedSettings(cdp, { mode: { flow: "scrolled" }, appearance: { theme: "paper", lineHeight: 2.0, maxInlineSize: 600 } });

    // ===== A 行距：iframe computed body line-height ≈ 2.0×fontSize；重启（reload）后保持 =====
    console.log("== A 行距 ==");
    await openBook(cdp, ".epub");
    check("A0 内核就绪", await cdp.eval(`!!window.__readerKernel`));
    const lh = await cdp.eval(`(() => {
      const c = window.__readerKernel.__getContents()[0];
      const cs = c.doc.defaultView.getComputedStyle(c.doc.body);
      return { lineHeight: parseFloat(cs.lineHeight), fontSize: parseFloat(cs.fontSize) };
    })()`);
    check("A1 行距 2.0 生效（line-height ≈ 2.0×fontSize）", Boolean(lh && Math.abs(lh.lineHeight - 2.0 * lh.fontSize) < 1.5), JSON.stringify(lh));
    // 重启不丢数据（§7.1.4）：reload 后重开书再断言（A3）
    await cdp.eval(`location.reload()`);
    await wait(2500);
    await openBook(cdp, ".epub");
    const lh2 = await cdp.eval(`(() => {
      const c = window.__readerKernel.__getContents()[0];
      const cs = c.doc.defaultView.getComputedStyle(c.doc.body);
      return { lineHeight: parseFloat(cs.lineHeight), fontSize: parseFloat(cs.fontSize) };
    })()`);
    check("A3 重启不丢数据（reload 后 line-height 仍 ≈ 2.0×fontSize）", Boolean(lh2 && Math.abs(lh2.lineHeight - 2.0 * lh2.fontSize) < 1.5), JSON.stringify(lh2));
    check("A4 快捷菜单行探针在场（data-reader-row=lineHeight）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; return !!document.querySelector('[data-reader-row="lineHeight"]'); })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(200);

    // ===== B 边距：分页模式 margin=80 → paginator --_margin computed=80px + 三行网格上下带 =====
    console.log("== B 边距 ==");
    await seedSettings(cdp, { mode: { flow: "paged" }, appearance: { theme: "paper", margin: 80 } });
    await openBook(cdp, ".epub");
    const bGeo = await cdp.eval(`(async () => {
      await new Promise((r) => setTimeout(r, 800));
      const pag = ${JS_PAGINATOR};
      if (!pag || !pag.el) return { err: "paginator 不可达" };
      // D130 实跑修正（R3 T7）：--_margin 定义在 closed shadow 的 #top 规则上（paginator.js #top 块），
      // 自定义属性只向下继承——宿主 foliate-paginator 上读恒为空串（首跑 B1 落此坑）；改走 #top（C2 同法）
      const fe = window.__readerKernel.__getContents()[0].doc.defaultView.frameElement;
      const chain = [];
      let computed = null;
      let el = fe;
      for (let i = 0; el && i < 6; i++) { chain.push({ h: Math.round(el.getBoundingClientRect().height), id: el.id || el.tagName }); if (el.id === "top") computed = getComputedStyle(el).getPropertyValue("--_margin").trim(); el = el.parentElement || (el.getRootNode && el.getRootNode().host); }
      const topRow = chain.find((x) => x.id === "top");
      const container = chain.find((x) => x.id === "container");
      return { computed, topRow: topRow && topRow.h, container: container && container.h };
    })()`);
    check("B1 --_margin computed = 80px（带 px 单位）", bGeo && bGeo.computed === "80px", JSON.stringify(bGeo));
    check("B2 #top 三行网格上下各 80（container = top-160）", Boolean(bGeo && bGeo.topRow && bGeo.container && Math.abs(bGeo.container - (bGeo.topRow - 160)) < 4), JSON.stringify(bGeo));
    check("B3 快捷菜单行探针在场（data-reader-row=margin，分页可用）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const row = document.querySelector('[data-reader-row="margin"]'); return !!row && !row.querySelector(".dd-btn:disabled"); })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await seedSettings(cdp, { mode: { flow: "scrolled" }, appearance: { theme: "paper", margin: 80 } });
    await openBook(cdp, ".epub");
    check("B4 滚动模式下边距控件为禁用态（title 说明在场）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const row = document.querySelector('[data-reader-row="margin"]'); if (!row) return false; const btn = row.querySelector(".dd-btn"); return !!btn && btn.disabled === true && (btn.title || "").length > 0; })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(200);

    // ===== C 版心：滚动模式 maxInlineSize=600 → foliate-paginator max-inline-size attribute=600px =====
    console.log("== C 版心 ==");
    await seedSettings(cdp, { mode: { flow: "scrolled" }, appearance: { theme: "paper", maxInlineSize: 600 } });
    await openBook(cdp, ".epub");
    const cGeo = await cdp.eval(`(async () => {
      await new Promise((r) => setTimeout(r, 800));
      const pag = ${JS_PAGINATOR};
      if (!pag || !pag.el) return { err: "paginator 不可达" };
      const attr = pag.el.getAttribute("max-inline-size");
      // C2（R3 修复）：paginator 为 attachShadow({mode:"closed"})，shadowRoot 恒 null——
      // 改用 B 组同款 frameElement→host 链量 computed --_max-inline-size（挂在 #top）；
      // iframe body computed max-width（滚动模式真正的正文容器约束）作旁证一并回报
      let mis = null, bodyMaxW = null;
      try {
        let el = window.__readerKernel.__getContents()[0].doc.defaultView.frameElement;
        for (let i = 0; el && i < 6; i++) {
          if (el.id === "top") { mis = parseFloat(getComputedStyle(el).getPropertyValue("--_max-inline-size")); break; }
          el = el.parentElement || (el.getRootNode && el.getRootNode().host);
        }
        bodyMaxW = parseFloat(getComputedStyle(window.__readerKernel.__getContents()[0].doc.body).maxWidth);
      } catch (e) { /* 链路结构变化时不阻塞主断言 */ }
      return { attr, mis, bodyMaxW };
    })()`);
    check("C1 max-inline-size attribute = 600px", cGeo && cGeo.attr === "600px", JSON.stringify(cGeo));
    check("C2 computed --_max-inline-size ≈ 600（closed shadow：frameElement→host 链替代 shadowRoot）", Boolean(cGeo && cGeo.mis != null && Math.abs(cGeo.mis - 600) < 2), JSON.stringify(cGeo));
    check("C3 快捷菜单行探针在场（data-reader-row=measure，滚动可用）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const row = document.querySelector('[data-reader-row="measure"]'); return !!row && !row.querySelector(".dd-btn:disabled"); })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(200);

    // ===== D 主题保存：custom 色 → 保存主题 → 命名 → 下拉条目；重启仍在；删除后消失；第 13 套被拒 =====
    console.log("== D 主题保存 ==");
    await seedSettings(cdp, { mode: { flow: "scrolled" }, appearance: { theme: "custom", bgColor: "#203040", fgColor: "#e0e8f0" } });
    await openBook(cdp, ".epub");
    check("D0 快捷菜单自定义行 + 保存按钮探针（data-reader-theme-save）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; return !!document.querySelector('[data-reader-theme-save]'); })()`));
    await cdp.eval(`document.querySelector('[data-reader-theme-save]')?.click()`);
    await wait(150);
    check("D1 命名输入框探针（data-reader-theme-name-input）", await cdp.eval(`!!document.querySelector('[data-reader-theme-name-input]')`));
    await cdp.eval(`(() => { const i = document.querySelector('[data-reader-theme-name-input]'); if (!i) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(i, "深海"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await cdp.eval(`(() => { const i = document.querySelector('[data-reader-theme-name-input]'); i && i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
    await wait(300);
    const savedId = await cdp.eval(`(async () => {
      const s = await window.settingsAPI.get("app", "readerSettings");
      const t = (s && s.customThemes) || [];
      return t.length === 1 ? t[0].id : null;
    })()`);
    check("D2 保存落库（customThemes 1 条）", Boolean(savedId), String(savedId));
    check("D3 下拉出现已存主题条目（data-reader-theme-option）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; document.querySelector('[data-reader-theme-dd] .dd-btn')?.click(); await new Promise((r) => setTimeout(r, 150)); return !!document.querySelector('[data-reader-theme-option="${savedId}"]'); })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    // 重启（reload）后仍在
    await cdp.eval(`location.reload()`);
    await wait(2500);
    await openBook(cdp, ".epub");
    check("D4 重启后主题仍在", await cdp.eval(`(async () => { const s = await window.settingsAPI.get("app", "readerSettings"); return ((s && s.customThemes) || []).some((t) => t.id === ${JSON.stringify(savedId)}); })()`));
    // 设置页管理列表：删除（就地二次确认）
    await cdp.eval(`(() => { const b = [...document.querySelectorAll(".icon-btn")].find((x) => (x.title || "") === "设置"); b?.click(); return true; })()`);
    await wait(800);
    check("D5 设置页管理列表探针（data-reader-theme-manage-list）", await cdp.eval(`!!document.querySelector('[data-reader-theme-manage-list]')`));
    check("D5b 设置页滑杆探针在场（data-reader-setting=lineHeight/margin/measure）", await cdp.eval(`!!document.querySelector('[data-reader-setting="lineHeight"]') && !!document.querySelector('[data-reader-setting="margin"]') && !!document.querySelector('[data-reader-setting="measure"]')`));
    await cdp.eval(`(() => { const row = document.querySelector('[data-reader-theme-manage-list] [data-reader-theme-id="${savedId}"]'); row?.querySelector('[data-reader-theme-delete]')?.click(); return true; })()`);
    await wait(150);
    check("D6 就地二次确认出现（确认删除 + 取消默认焦点）", await cdp.eval(`(async () => { const row = document.querySelector('[data-reader-theme-manage-list] [data-reader-theme-id="${savedId}"]'); if (!row) return false; const c = row.querySelector('[data-reader-theme-delete-confirm]'); return !!c && !!row.querySelector("button:focus"); })()`));
    await cdp.eval(`(() => { document.querySelector('[data-reader-theme-delete-confirm]')?.click(); return true; })()`);
    await wait(300);
    check("D7 删除后列表清空", await cdp.eval(`(async () => { const s = await window.settingsAPI.get("app", "readerSettings"); return ((s && s.customThemes) || []).length === 0; })()`));
    // 关设置（Escape → 模态 onClose）
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(300);
    // 第 13 套被拒：预置 12 条 → 保存按钮禁用
    const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `ct-seed${i}`, name: `种子主题 ${i}`, bgColor: "#112233", fgColor: "#445566", createdAt: Date.now() + i }));
    await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "custom", bgColor: "#203040", fgColor: "#e0e8f0" }, customThemes: ${JSON.stringify(twelve)} })`);
    await cdp.eval(`location.reload()`);
    await wait(2500);
    await openBook(cdp, ".epub");
    check("D8 第 13 套保存被拒（按钮禁用 + title 说明）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const b = document.querySelector('[data-reader-theme-save]'); return !!b && b.disabled === true && (b.title || "").includes("12"); })()`));
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(200);

    // ===== F 翻页：animated 两态 + reduce-motion 永不挂 + 两态各 16 次跨章翻页限时 settle =====
    console.log("== F 翻页 ==");
    await seedSettings(cdp, { mode: { flow: "paged" }, appearance: { theme: "paper", turnAnimated: true } });
    await openBook(cdp, ".epub");
    check("F1 开 → foliate-paginator hasAttribute(animated)=true", await cdp.eval(`(async () => { const pag = ${JS_PAGINATOR}; return !!pag && !!pag.el && pag.el.hasAttribute("animated"); })()`));
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
    check("F2 开态连续 16 次跨章翻页限时 settle 不锁死", stuck === 0, `STUCK=${stuck}`);
    await seedSettings(cdp, { mode: { flow: "paged" }, appearance: { theme: "paper", turnAnimated: false } });
    await openBook(cdp, ".epub");
    check("F3 关 → hasAttribute(animated)=false", await cdp.eval(`(async () => { const pag = ${JS_PAGINATOR}; return !!pag && !!pag.el && !pag.el.hasAttribute("animated"); })()`));
    stuck = 0;
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
    check("F4 关态连续 16 次跨章翻页限时 settle 不锁死", stuck === 0, `STUCK=${stuck}`);
    // reduce-motion：设置值仍为意愿（false），模拟 reduce 后即便 true 也不挂属性
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await seedSettings(cdp, { mode: { flow: "paged" }, appearance: { theme: "paper", turnAnimated: true } });
    await openBook(cdp, ".epub");
    check("F5 reduce-motion 下永不挂 animated（设置保留意愿）", await cdp.eval(`(async () => { const pag = ${JS_PAGINATOR}; return !!pag && !!pag.el && !pag.el.hasAttribute("animated"); })()`));
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await wait(200);

    // ===== G 热区提示：hover opacity 0→1→0；点击翻页行为不变 =====
    console.log("== G 热区提示 ==");
    const tapRect = await cdp.eval(`(() => { const r = document.querySelector(".reader-tap-left")?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`);
    check("G0 分页热区 + chevron 探针在场（data-reader-tap-hint=left）", Boolean(tapRect) && (await cdp.eval(`!!document.querySelector('[data-reader-tap-hint="left"]')`)));
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tapRect.x, y: tapRect.y });
    await wait(400);
    const hoverOp = await cdp.eval(`parseFloat(getComputedStyle(document.querySelector('[data-reader-tap-hint="left"]')).opacity)`);
    check("G1 hover 后 chevron opacity > 0.9", hoverOp > 0.9, hoverOp);
    const center = await cdp.eval(`(() => { const r = document.querySelector(".reader-engine-host")?.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y });
    await wait(400);
    const restOp = await cdp.eval(`parseFloat(getComputedStyle(document.querySelector('[data-reader-tap-hint="left"]')).opacity)`);
    check("G2 移出后 opacity < 0.05（rest 态）", restOp < 0.05, restOp);
    // D130 实跑修正（R3 T7）：点**右**热区（next）。左热区（prev）在书首（每次 seedSettings 的 reload
    // 都回书架重开，进度 700ms 防抖被 reload 掐断 → 复位到首页）上 prev 是 no-op，cfi 恒不变。
    // 设计 §8.2 只断言「点击热区翻页行为不变（cfi 推进）」，方向不限；hover 断言（G0–G2）仍走左热区。
    const tapRectR = await cdp.eval(`(() => { const r = document.querySelector(".reader-tap-right")?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`);
    const cfiBefore = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: tapRectR.x, y: tapRectR.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tapRectR.x, y: tapRectR.y, button: "left", clickCount: 1 });
    await wait(1200);
    check("G3 点击热区翻页行为不变（cfi 推进）", (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) !== cfiBefore);

    // ===== H 翻页键：←/→ cfi 推进；INPUT 聚焦下按键不翻页（焦点守卫） =====
    console.log("== H 翻页键 ==");
    const hBefore = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await wait(1200);
    check("H1 按 → 翻页（cfi 推进，命令条 reader.turnNext 接管）", (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) !== hBefore);
    const hBefore2 = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    await wait(1200);
    check("H2 按 ← 翻页（cfi 推进，reader.turnPrev）", (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) !== hBefore2);
    const hBefore3 = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    await cdp.eval(`(() => { const i = document.createElement("input"); i.id = "d130-focus-probe"; i.style.position = "fixed"; i.style.top = "8px"; i.style.left = "8px"; document.body.appendChild(i); i.focus(); return document.activeElement && document.activeElement.id; })()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await wait(800);
    check("H3 INPUT 聚焦下按键不翻页（焦点守卫）", (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) === hBefore3);
    await cdp.eval(`document.getElementById("d130-focus-probe")?.remove(); true`);
    // PageUp/PageDown/空格留壳层：抽检空格仍翻页
    const hBefore4 = await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await wait(1200);
    check("H4 空格翻页保留壳层（迁移前后一致）", (await cdp.eval(`window.__readerKernel.getCurrentLocation()?.cfi`)) !== hBefore4);

    // ===== E 两内核适用面：PDF 行禁用/隐藏、缩放在场；EPUB 反之；PDF 自定义主题只改容器底色 =====
    console.log("== E 两内核适用面 ==");
    // D130 实跑修正（R3 T7）：阅读器没有「返回」按钮（onBack 未在 Reader 渲染面出现，点了没反应
    // ——首跑 E 组停在 EPUB 内，E0 因 kernel 仍在而假绿）。改走 App 全局导航 .nav-item「书架」
    // （annotations.gui.mjs 既有先例）。
    const backToShelf = `(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`;
    await cdp.eval(backToShelf);
    await wait(1200);
    await openBook(cdp, ".pdf");
    check("E0 PDF 内核就绪", await cdp.eval(`!!window.__readerKernel`));
    check("E1 PDF：行距控件禁用 + title 说明", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const row = document.querySelector('[data-reader-row="lineHeight"]'); if (!row) return false; const btn = row.querySelector(".dd-btn"); return !!btn && btn.disabled === true && (btn.title || "").includes("固定版式"); })()`));
    check("E2 PDF：边距/版心行隐藏", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; return !document.querySelector('[data-reader-row="margin"]') && !document.querySelector('[data-reader-row="measure"]'); })()`));
    check("E3 PDF：缩放行在场（原位保留）", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; return !!document.querySelector('[data-reader-row="zoom"]'); })()`));
    check("E4 PDF：动画过渡控件禁用态", await cdp.eval(`(async () => { await ${JS_OPEN_SETTINGS_MENU}; const row = document.querySelector('[data-reader-row="turnAnimated"]'); if (!row) return false; const btn = row.querySelector(".dd-btn"); return !!btn && btn.disabled === true; })()`));
    // PDF 自定义主题：只改容器底色（fgColor 不适用——「Not verified」口径，断言只测 bgColor）
    await seedSettings(cdp, { mode: { flow: "paged" }, appearance: { theme: "custom", bgColor: "#203040", fgColor: "#e0e8f0" } });
    await openBook(cdp, ".pdf");
    check("E5 PDF 自定义主题：容器底色=bgColor（fgColor 不适用，Not verified）", await cdp.eval(`(() => { const host = document.querySelector(".reader-engine-host"); if (!host) return false; return getComputedStyle(host).backgroundColor === "rgb(32, 48, 64)"; })()`));
    await cdp.eval(backToShelf);
    await wait(1200);

    // ===== I 回归口径：控制台零错误 + D127 几何零漂移抽检 =====
    console.log("== I 回归口径 ==");
    const errs = [...new Set(cdp.consoleLog)].filter((l) =>
      !l.includes("ResizeObserver loop") && !l.includes("Security Warning") && !l.includes("This warning"));
    check("I1 全程无控制台错误/异常", errs.length === 0, JSON.stringify(errs.slice(0, 4)));
    await openBook(cdp, ".epub");
    const d127 = await cdp.eval(`(() => {
      const toggle = document.querySelector("[data-reader-sidebar-toggle]");
      const r = toggle && toggle.getBoundingClientRect();
      return { w: r && Math.round(r.width), h: r && Math.round(r.height) };
    })()`);
    check("I2 D127/D139 抽检：侧栏开关钮 40×24（顶部按钮带降到 24 档）", d127 && d127.w === 40 && d127.h === 24, JSON.stringify(d127));
    await cdp.eval(`document.querySelector("[data-reader-sidebar-toggle]")?.click(); true`);
    await wait(800);
    const d127b = await cdp.eval(`(() => {
      const tabs = document.querySelector("[data-sidebar-tabs]");
      const r = tabs && tabs.getBoundingClientRect();
      return { present: !!tabs, h: r && Math.round(r.height) };
    })()`);
    check("I3 D127 抽检：侧栏页签行在场且高度不为 0", Boolean(d127b && d127b.present && d127b.h > 0), JSON.stringify(d127b));
  } finally {
    // 清理测试书与夹具
    try {
      await cdp.eval(`(async () => {
        const items = await window.libraryAPI.list();
        for (const it of items.filter((x) => (x.title || "").includes("FSRSTEST"))) await window.libraryAPI.delete(it.id);
        return true;
      })()`);
    } catch {
      /* 清理失败不影响结论 */
    }
    fs.rmSync(EPUB_PATH, { force: true });
    fs.rmSync(PDF_PATH, { force: true });
  }

  await cdp.ws.close();
  killProc(electron);
  await wait(500);
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("脚本失败:", e);
  killProc(electron);
  process.exit(1);
});
