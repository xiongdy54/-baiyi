// @runtime: system-node  @gui: true  @id: READER-THEME-SYNC-D242
// D242 阅读主题整窗同步——GUI 回归（CDP 驱动真实应用，自启自关；node tests/d242-reader-theme-sync.gui.mjs）
// 依据：docs/design/READER-THEME-TYPE-INERTIA-D242.md。滚动 / 分页 / 对开 × 纸白 / 羊皮 / 暗夜 / 深色自定义：
// 经阅读设置面板真实点选主题后，整窗网格取样每个点的实际底色，必须落在「阅读底色 ↔ 文字色」这条色带上
// （此前暗夜下残留大片白、羊皮下顶栏仍是白）；顶栏 / 工具栏按钮 / 侧栏开关的底色与文字色逐项比对；
// 离开阅读器后应用 Token 复原。截图落 tests/tmp-d242-shots/（人工复核用）。
// 隔离同 reader.personalization.gui.mjs：M7_TEST_USERDATA 指向 tests/tmp-d242-theme-userdata（先清空）。
// 注意：跑前先 npm run build（GUI 套件纪律）；须先关闭应用（§7.1.8）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9242";
const USER_DATA = path.join(ROOT, "tests", "tmp-d242-theme-userdata");
const EPUB_PATH = path.join(ROOT, "tests", "tmp-d242-theme-fixture.epub");
const PDF_PATH = path.join(ROOT, "tests", "tmp-d242-theme-fixture.pdf");

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


const SHOTS = path.join(ROOT, "tests", "tmp-d242-shots");

// 整窗网格取样：每个点取最上层元素，沿祖先链找第一个不透明底色；返回不在阅读色带上的点
const JS_SCAN = (bg, fg) => `(() => {
  const parse = (s) => { s = s || ""; let m = /^color\\(srgb ([^)]+)\\)/.exec(s); if (m) { const [rgbPart, a] = m[1].split("/"); const p = rgbPart.trim().split(/\\s+/).map((v) => Number(v) * 255); return { r: p[0], g: p[1], b: p[2], a: a ? Number(a) : 1 }; } m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
  const B = hex(${JSON.stringify(bg)}), F = hex(${JSON.stringify(fg)});
  // 点到 B→F 线段的距离（RGB 欧氏）
  const off = (c) => { const d = [F.r - B.r, F.g - B.g, F.b - B.b], v = [c.r - B.r, c.g - B.g, c.b - B.b]; const L = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1; const t = Math.max(0, Math.min(1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / L)); return Math.hypot(v[0] - t * d[0], v[1] - t * d[1], v[2] - t * d[2]); };
  const effBg = (el) => { for (let e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return { c, e }; } return { c: parse(getComputedStyle(document.body).backgroundColor), e: document.body }; };
  const bad = [];
  let total = 0;
  for (let y = 6; y < innerHeight; y += 24) for (let x = 6; x < innerWidth; x += 24) {
    const el = document.elementFromPoint(x, y);
    if (!el) continue;
    total++;
    if (el.tagName === "IFRAME" || el.closest("foliate-view")) continue; // 正文 iframe 由内核注入另行断言
    const { c, e } = effBg(el);
    if (!c) continue;
    if (off(c) > 24) bad.push({ x, y, bg: getComputedStyle(e).backgroundColor, cls: String(e.className || e.tagName).slice(0, 60) });
  }
  const groups = {};
  for (const b of bad) groups[b.cls + " " + b.bg] = (groups[b.cls + " " + b.bg] || 0) + 1;
  return { total, bad: bad.length, groups };
})()`;

const JS_PARTS = `(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderBottomColor }; };
  const doc = window.__readerKernel?.__getContents?.()[0]?.doc;
  return {
    body: pick("body"), topbar: pick(".topbar"), navItem: pick(".topbar-nav .nav-item"), wb: pick(".topbar-wb"),
    wrap: pick(".reader-wrap"), readerBody: pick(".reader-body"), controls: pick(".reader-engine-controls"),
    ddBtn: pick(".reader-engine-controls .dd-btn"), toggle: pick(".annot-toggle"),
    iframeBody: doc ? doc.defaultView.getComputedStyle(doc.body).backgroundColor : null,
    // paginator 背景层（#top 的首个子元素；closed shadow 内，经 iframe 的祖先链拿到）
    pagBg: doc ? getComputedStyle(doc.defaultView.frameElement.parentElement.parentElement.parentElement.firstElementChild).backgroundColor : null,
    surface: document.body.classList.contains("reader-surface"), dark: document.body.classList.contains("theme-dark")
  };
})()`;

const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

async function pickTheme(cdp, key, customBg, customFg) {
  return cdp.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!document.querySelector('[data-tool-menu-panel="settings"]')) { document.querySelector('[data-tool-menu-btn="settings"]')?.click(); await sleep(300); }
    const dd = document.querySelector('[data-reader-theme-dd] .dd-btn');
    if (!dd) return "no-dd";
    dd.click(); await sleep(200);
    const labels = { paper: "纸白", sepia: "羊皮", dark: "暗夜", custom: "自定义" };
    const opt = [...document.querySelectorAll('[data-reader-theme-dd] .dd-item')].find((b) => b.textContent.trim() === labels[${JSON.stringify(key)}]);
    if (!opt) return "no-opt";
    opt.click(); await sleep(400);
    if (${JSON.stringify(key)} === "custom") {
      const inputs = document.querySelectorAll('[data-reader-row="customColors"] input[type=color]');
      const setVal = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      setVal(inputs[0], ${JSON.stringify(customBg || "")}); await sleep(200);
      setVal(inputs[1], ${JSON.stringify(customFg || "")}); await sleep(200);
    }
    // 关闭面板，避免浮层本身遮挡取样
    document.querySelector('[data-tool-menu-btn="settings"]')?.click();
    await sleep(900);
    return "ok";
  })()`);
}

async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
}

async function main() {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  await buildEpubFixture();
  const out = openSync(path.join(ROOT, "tests", "d242-reader-theme-sync.gui.log"), "w");
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
    await cdp.send("Page.enable");
    const seeded = await cdp.eval(`(async () => {
      try {
        const epub = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(EPUB_PATH)}, name: "FSRSTEST-personalization.epub", ext: "epub" });
        return { ok: true, epub: epub && epub.id };
      } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
    })()`);
    check("0 造数（EPUB）", Boolean(seeded?.epub), JSON.stringify(seeded));
    let before = null;
    const THEMES = [
      { key: "paper", bg: "#fafaf8", fg: "#1a1a1a", dark: false },
      { key: "sepia", bg: "#f4ecd8", fg: "#5b4636", dark: false },
      { key: "dark", bg: "#141414", fg: "#c9c9c9", dark: true },
      { key: "custom", bg: "#1f2a36", fg: "#d6dde6", dark: true }
    ];
    const RUNS = [
      { mode: { flow: "scrolled" }, skin: "none" },
      { mode: { flow: "paged" }, skin: "none" },
      { mode: { flow: "paged", spread: true }, skin: "none" },
      // 皮肤层自带表面色（卡片 / 浮层为白）：阅读主题同样要压过皮肤
      { mode: { flow: "scrolled" }, skin: "claude" }
    ];
    for (const { mode, skin } of RUNS) {
      const tag = (mode.spread ? "spread" : mode.flow) + (skin === "none" ? "" : "-" + skin);
      console.log(`== ${tag} ==`);
      await cdp.eval(`window.settingsAPI.set("app", "skinId", ${JSON.stringify(skin)})`);
      // 退出断言会先切纸白（应用浅色档）；基准必须是同一皮肤、同一明暗档的书架。
      await cdp.eval(`window.settingsAPI.set("theme", "mode", "light")`);
      await seedSettings(cdp, { mode, appearance: { theme: "paper" } });
      before = await cdp.eval(`getComputedStyle(document.querySelector(".topbar")).backgroundColor`); // 书架上（本皮肤）的顶栏底色
      await openBook(cdp, ".epub");
      check(`${tag} 内核就绪`, await cdp.eval(`!!window.__readerKernel`));
      for (const t of THEMES) {
        const picked = await pickTheme(cdp, t.key, t.bg, t.fg);
        check(`${tag}/${t.key} 经阅读设置点选主题`, picked === "ok", picked);
        await shot(cdp, `${tag}-${t.key}`);
        const parts = await cdp.eval(JS_PARTS);
        const want = rgb(t.bg);
        check(`${tag}/${t.key} body 挂 reader-surface`, parts?.surface === true, JSON.stringify(parts));
        check(`${tag}/${t.key} 应用明暗档跟随（dark=${t.dark}）`, parts?.dark === t.dark, JSON.stringify(parts?.dark));
        check(`${tag}/${t.key} 顶栏底色＝阅读底色`, parts?.topbar?.bg === want, parts?.topbar?.bg);
        check(`${tag}/${t.key} 阅读页外框底色＝阅读底色`, parts?.wrap?.bg === want && parts?.readerBody?.bg === want, JSON.stringify([parts?.wrap?.bg, parts?.readerBody?.bg]));
        check(`${tag}/${t.key} 正文 iframe 底色＝阅读底色`, parts?.iframeBody === want, parts?.iframeBody);
        check(`${tag}/${t.key} 内核背景层（页边 / 顶部留白）＝阅读底色`, parts?.pagBg === want, parts?.pagBg);
        // 文字色须落在「阅读底色 ↔ 文字色」色带上（次级文字是二者插值，允许）
        const near = (c, fgHex) => { let p; const m1 = /^color\(srgb ([^)/]+)/.exec(c || ""); if (m1) p = m1[1].trim().split(/\s+/).map((v) => Number(v) * 255); else { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return false; p = m[1].split(/[ ,]+/).map(Number); } const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const B = hx(t.bg), F = hx(fgHex); const d = F.map((v, i) => v - B[i]), v = p.map((x, i) => x - B[i]); const L = d.reduce((a, x) => a + x * x, 0) || 1; const k = Math.max(0, Math.min(1, v.reduce((a, x, i) => a + x * d[i], 0) / L)); return Math.hypot(...v.map((x, i) => x - k * d[i])) < 24 && k > 0.4; };
        check(`${tag}/${t.key} 顶栏导航与工具栏按钮文字色取阅读文字色族`, near(parts?.navItem?.fg, t.fg) && near(parts?.ddBtn?.fg, t.fg), JSON.stringify([parts?.navItem?.fg, parts?.ddBtn?.fg]));
        const scan = await cdp.eval(JS_SCAN(t.bg, t.fg));
        check(`${tag}/${t.key} 整窗取样无脱离阅读色带的区域`, scan && scan.bad === 0, JSON.stringify(scan));
      }
    }
    // 离开阅读器：应用 Token 复原（回到书架后 body 不再挂 reader-surface、无内联 --paper）
    await pickTheme(cdp, "paper");
    await cdp.eval(`(async () => { document.querySelector('.topbar-nav .nav-item')?.click(); await new Promise((r) => setTimeout(r, 1200)); return 1; })()`);
    const after = await cdp.eval(`({ surface: document.body.classList.contains("reader-surface"), inline: document.body.style.getPropertyValue("--paper"), topbar: getComputedStyle(document.querySelector(".topbar")).backgroundColor })`);
    check("离开阅读器后撤销 reader-surface 与内联 Token", after && after.surface === false && !after.inline, JSON.stringify(after));
    check("离开阅读器后顶栏回到应用主题底色", after && after.topbar === before, JSON.stringify([after?.topbar, before]));
    const errs = cdp.consoleLog.filter((l) => !/Autofill|DevTools|ResizeObserver loop/.test(l));
    check("无页面异常", errs.length === 0, errs.join(" | "));
  } finally {
    console.log(`\nSUMMARY ${pass}/${pass + fail}`);
    killProc(electron);
    await wait(600);
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.rmSync(EPUB_PATH, { force: true });
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  killProc(electron);
  process.exit(1);
});
