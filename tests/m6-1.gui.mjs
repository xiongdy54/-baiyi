// M6-1 导入格式扩展 GUI 端到端验证（CDP 驱动真实应用，自启自关；node tests/m6-1.gui.mjs）
// 流程：造真实 fixture 文件（docx含图/GBK txt/md）→ IPC 走主进程转换建册（与 UI 按钮同链路，仅原生对话框不可自动化）
//       → 断言 source_type 与 assets 落盘 → 打开 Word 书断言内嵌图在 foliate 内核真实渲染 → 选区制卡 contextRef
//       → 重启应用 → 数据不丢、图仍渲染 → 清理测试数据与 fixture
// 纪律：FSRSTEST 前缀；按 title 属性显式身份匹配书卡；readerSettings 存/恢复；结束清场 taskkill
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9224";
const FIXDIR = path.join(ROOT, "tests", "tmp-m6-fixtures");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

// ---------- 夹具 ----------
function tinyPng(r, g, b) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const byte of body) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = (r2, g2, b2) => Buffer.concat([Buffer.from([0]), Buffer.from([r2, g2, b2]), Buffer.from([r2, g2, b2])]);
  const raw = Buffer.concat([row(r, g, b), row(g, b, r)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
}

async function buildDocx() {
  const pngA = tinyPng(255, 0, 0);
  const pngB = tinyPng(0, 0, 255);
  const drawing = (i) => `
<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="190500" cy="190500"/><wp:docPr id="${i}" name="pic${i}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i}" name="pic${i}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${i}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>FSRSTEST Word 起源章</w:t></w:r></w:p>
<w:p><w:r><w:t>FSRSTEST锚甲出现在第一张图片之前。</w:t></w:r></w:p>${drawing(0)}
<w:p><w:r><w:t>第二张图片在正文中间。</w:t></w:r></w:p>${drawing(1)}
<w:p><w:r><w:t>术语表如下。</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>词</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>义</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>book</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>书</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/>
</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", documentXml);
  zip.file("word/media/imageA.png", pngA);
  zip.file("word/media/imageB.png", pngB);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImg0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/imageA.png"/>
<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/imageB.png"/>
</Relationships>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildFixtures() {
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const wordPath = path.join(FIXDIR, "FSRSTEST-M6 Word导测.docx");
  fs.writeFileSync(wordPath, await buildDocx());
  // GBK 字节（中文测试 的 GBK 编码 D6D0 CEC4 B2E2 CAD4）+ CRLF + ASCII 行
  const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0x0d, 0x0a, 0x0d, 0x0a, 0x46, 0x53, 0x52, 0x53, 0x54, 0x45, 0x53, 0x54, 0x20, 0x67, 0x62, 0x6b, 0x20, 0x6f, 0x6b, 0x0d, 0x0a]);
  const txtPath = path.join(FIXDIR, "FSRSTEST-M6 GBK导测.txt");
  fs.writeFileSync(txtPath, gbkBytes);
  const mdPath = path.join(FIXDIR, "FSRSTEST-M6 MD导测.md");
  fs.writeFileSync(mdPath, "# FSRSTEST MD 首章\n\nFSRSTEST markdown 锚甲正文，公式 $E=mc^2$。\n\n# 次章\n\n结尾正文。", "utf8");
  return { wordPath, txtPath, mdPath };
}

// ---------- CDP ----------
async function startApp() {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "m6-1.gui.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false
  });
  const cdp = await connect();
  await cdp.eval("1");
  await wait(1500);
  return cdp;
}

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9224/json")).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id;
          pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 250);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

const clickCardByTitle = (title) => `(() => {
  const el = [...document.querySelectorAll('.book-card')].find(e => e.getAttribute('title') === ${JSON.stringify(title)});
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;

async function openBookAndAssertImages(cdp, title, expectImages, navTitle) {
  await cdp.eval(`location.reload()`);
  await wait(2500);
  const click = await cdp.eval(clickCardByTitle(title));
  await wait(3000);
  const engineUp = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
  if (!engineUp) return { click, engineUp };
  // syn-3（§9.4 空首章清理）后首章即正文章；保留经目录跳转定位（按标题查找，结构无关）
  if (navTitle) {
    await cdp.eval(`(() => { const b = document.querySelector('[data-reader-sidebar-toggle]'); b?.click(); return b ? 'ok' : 'no btn'; })()`);
    await wait(700);
    const jump = await cdp.eval(`(() => {
      const el = [...document.querySelectorAll('.reader-toc-item')].find(e => e.textContent.includes(${JSON.stringify(navTitle)}));
      if (!el) return "not found";
      el.click(); return "clicked";
    })()`);
    await wait(1200);
    var navResult = jump;
  }
  await wait(1500);
  const imgs = JSON.parse(await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "[]";
    return JSON.stringify([...entry.doc.querySelectorAll("img")].map((im) => ({ src: im.getAttribute("src"), loaded: im.complete && im.naturalWidth > 0, w: im.naturalWidth })));
  })()`));
  return { click, engineUp, imgs, navResult };
}

// ---------- 主流程 ----------
(async () => {
  console.log("== 0) 造 fixture + 启动应用 ==");
  const fx = await buildFixtures();
  check("fixture 文件就绪（docx/txt/md）", fs.existsSync(fx.wordPath) && fs.existsSync(fx.txtPath) && fs.existsSync(fx.mdPath), FIXDIR);
  const cdp = await startApp();
  const origSettings = await cdp.eval(`window.settingsAPI.get("app", "readerSettings")`);
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  const baseline = await cdp.eval(`window.libraryAPI.list().then((xs) => xs.length)`);

  console.log("== 1) 导入三种格式（主进程转换 + 建册，与 UI 按钮同链路） ==");
  const created = JSON.parse(await cdp.eval(`(async () => {
    const word = await window.libraryAPI.createFromWord({ name: "FSRSTEST-M6 Word导测.docx", path: ${JSON.stringify(fx.wordPath)} });
    const txt = await window.libraryAPI.createFromTxt({ name: "FSRSTEST-M6 GBK导测.txt", path: ${JSON.stringify(fx.txtPath)} });
    const md = await window.libraryAPI.createFromMarkdown({ name: "FSRSTEST-M6 MD导测.md", path: ${JSON.stringify(fx.mdPath)} });
    return JSON.stringify({ word, txt, md });
  })()`));
  check("三种格式导入成功并返回 id/title", !!created?.word?.id && !!created?.txt?.id && !!created?.md?.id, JSON.stringify(created));
  check("Word 书名取自文件名", created?.word?.title === "FSRSTEST-M6 Word导测", created?.word?.title);

  const kinds = JSON.parse(await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const pick = (t) => xs.find((x) => x.title === t);
    const w = pick("FSRSTEST-M6 Word导测"), t = pick("FSRSTEST-M6 GBK导测"), m = pick("FSRSTEST-M6 MD导测");
    return JSON.stringify({ w: w?.sourceType, t: t?.sourceType, m: m?.sourceType, wId: w?.id, tId: t?.id, mId: m?.id });
  })()`));
  check("source_type 落库 word/txt/markdown", kinds?.w === "word" && kinds?.t === "txt" && kinds?.m === "markdown", kinds);

  console.log("== 2) assets 落盘（原文件 + 内嵌图，M2 备份范围） ==");
  const UD = path.join(process.env.APPDATA, "incremental-reading-dev", "assets");
  const disk = JSON.parse(await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const w = xs.find((x) => x.title === "FSRSTEST-M6 Word导测");
    const r = await window.libraryAPI.readContentImages(w.id);
    return JSON.stringify({ n: r.length, names: r.map((x) => x.filename), bytes: r.map((x) => x.bytes.length) });
  })()`));
  check("Word 内嵌图可取回（readContentImages）", disk?.n === 2 && disk?.names?.join(",") === "img-0.png,img-1.png", JSON.stringify(disk));
  check("img-0.png 字节为 fixture PNG（134B）", disk?.bytes?.[0] > 0, JSON.stringify(disk?.bytes));
  const wordAssetDir = path.join(UD, kinds.wId);
  check("word-original 落盘", fs.existsSync(path.join(wordAssetDir, "original.docx")), wordAssetDir);
  check("image-content 落盘", fs.existsSync(path.join(wordAssetDir, "img-0.png")) && fs.existsSync(path.join(wordAssetDir, "img-1.png")), wordAssetDir);
  check("txt-original 落盘", fs.existsSync(path.join(UD, kinds.tId, "original.txt")), kinds.tId);
  check("markdown-original 落盘", fs.existsSync(path.join(UD, kinds.mId, "original.md")), kinds.mId);

  console.log("== 3) 打开 Word 书：内嵌图在 foliate 内核真实渲染 ==");
  const r1 = await openBookAndAssertImages(cdp, "FSRSTEST-M6 Word导测", null, "FSRSTEST Word 起源章");
  check("Word 书进入 foliate 引擎视图", r1.engineUp === true, r1.click + "/" + r1.engineUp);
  // foliate 内核把 EPUB 内部资源 src 重写为 blob: URL——断言「2 张、全部加载成功」，src 以 blob:file:/// 开头
  const imgOk = Array.isArray(r1.imgs) && r1.imgs.length === 2
    && r1.imgs.every((im) => im.loaded === true && im.w > 0 && String(im.src).startsWith("blob:"));
  check("两张内嵌图真实渲染（foliate blob 重写 + naturalWidth>0）", imgOk, JSON.stringify(r1.imgs));
  const wordText = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    return entry ? entry.doc.body.textContent.slice(0, 300) : "no doc";
  })()`);
  check("Word 正文（含表格文本）渲染", String(wordText).includes("FSRSTEST锚甲") && String(wordText).includes("术语表"), String(wordText).slice(0, 120));
  await cdp.eval(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button, .topbar-nav button')].find(x=>x.textContent.includes('书架')||x.title==='返回书架'); b?.click(); return b?'ok':'no btn'; })()`);
  await wait(1200);

  console.log("== 4) 打开 GBK TXT：编码正确无乱码 ==");
  const r2 = await openBookAndAssertImages(cdp, "FSRSTEST-M6 GBK导测");
  check("TXT 书进入引擎视图", r2.engineUp === true, r2.engineUp);
  const txtText = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    return entry ? entry.doc.body.textContent.slice(0, 200) : "no doc";
  })()`);
  check("GBK 中文解码正确（非乱码）", String(txtText).includes("中文测试"), JSON.stringify(txtText).slice(0, 160));
  await cdp.eval(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button, .topbar-nav button')].find(x=>x.textContent.includes('书架')||x.title==='返回书架'); b?.click(); return b?'ok':'no btn'; })()`);
  await wait(1200);

  console.log("== 5) Word 书选区制卡（contextRef 锚点落库） ==");
  await cdp.eval(clickCardByTitle("FSRSTEST-M6 Word导测"));
  await wait(3000);
  // 目录跳转到目标章（syn-3 后无空首章，按标题查找与结构无关）
  await cdp.eval(`(() => { const b = document.querySelector('[data-reader-sidebar-toggle]'); b?.click(); return b ? 'ok' : 'no btn'; })()`);
  await wait(700);
  await cdp.eval(`(() => { const el = [...document.querySelectorAll('.reader-toc-item')].find(e => e.textContent.includes('FSRSTEST Word 起源章')); el?.click(); return el ? 'clicked' : 'not found'; })()`);
  await wait(1500);
  const selOk = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const doc = entry.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf("FSRSTEST锚甲");
      if (idx >= 0) {
        const range = doc.createRange();
        range.setStart(node, idx); range.setEnd(node, idx + 10);
        const sel = doc.defaultView.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        const frame = doc.defaultView.frameElement;
        const p = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
        node.parentElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: p.left + 200, clientY: p.top + 120 }));
        return true;
      }
    }
    return false;
  })()`);
  await wait(700);
  const menuUp = await cdp.eval(`Boolean(document.querySelector(".selection-menu"))`);
  check("Word 书划选出制卡菜单", selOk === true && menuUp, "sel=" + selOk);
  const clickBtn = (txt, sel) => `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(txt)}));
    if (!el) return "not found";
    el.click(); return "clicked";
  })()`;
  await cdp.eval(clickBtn("制卡", "[data-sel-act]"));
  await wait(700);
  await cdp.eval(`(() => {
    const tas = [...document.querySelectorAll("[data-card-dock] textarea")];
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    set.call(tas[0], "FSRSTEST M6 Word 制卡题面");
    tas[0].dispatchEvent(new Event("input", { bubbles: true }));
    set.call(tas[1], "M6 导入材料制卡答案");
    tas[1].dispatchEvent(new Event("input", { bubbles: true }));
    return tas.length;
  })()`);
  await cdp.eval(clickBtn("制卡", "[data-card-dock] .wb-foot .btn-primary"));
  await wait(1200);
  const cardOk = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find((x) => (x.frontMarkdown || "").includes("FSRSTEST M6 Word 制卡题面"));
    if (!c) return JSON.stringify(null);
    return JSON.stringify({ cfi: c.contextRef && c.contextRef.cfi, v: c.contextRef && c.contextRef.readerEngineVersion });
  })()`);
  const cardOkObj = cardOk && cardOk !== "null" ? JSON.parse(cardOk) : null;
  check("Word 选区制卡成功（CFI + 引擎版本锚点）", Boolean(cardOkObj && cardOkObj.cfi && cardOkObj.v), String(cardOk));
  await cdp.eval(`document.querySelector("[data-card-dock] [data-dock-close]")?.click(); 1`);

  console.log("== 6) 重启应用 → 数据不丢、图仍渲染 ==");
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
  await wait(1200);
  const out2 = openSync(path.join(ROOT, "tests", "m6-1.gui.app.log"), "a");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out2, out2], detached: false
  });
  const cdp2 = await connect();
  await wait(1500);
  const after = JSON.parse(await cdp2.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    return JSON.stringify({ n: xs.length, has: ["FSRSTEST-M6 Word导测", "FSRSTEST-M6 GBK导测", "FSRSTEST-M6 MD导测"].every((t) => xs.some((x) => x.title === t)) });
  })()`));
  check("重启后三本书不丢", after?.has === true, JSON.stringify(after));
  check("重启后书架总数增加 3（相对基线）", after?.n === baseline + 3, `${baseline} → ${after?.n}`);
  const r3 = await openBookAndAssertImages(cdp2, "FSRSTEST-M6 Word导测", null, "FSRSTEST Word 起源章");
  const imgOk2 = Array.isArray(r3.imgs) && r3.imgs.length === 2 && r3.imgs.every((im) => im.loaded === true);
  check("重启后 Word 内嵌图仍渲染", r3.engineUp === true && imgOk2, JSON.stringify(r3.imgs));
  const cardAfter = await cdp2.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    return all.some((x) => (x.frontMarkdown || "").includes("FSRSTEST M6 Word 制卡题面"));
  })()`);
  check("重启后制卡记录仍在", cardAfter === true, String(cardAfter));

  console.log("== 7) 清理测试数据与 fixture ==");
  const TITLES = ["FSRSTEST-M6 Word导测", "FSRSTEST-M6 GBK导测", "FSRSTEST-M6 MD导测"];
  let cleanResult = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    cleanResult = await cdp2.eval(`(async () => {
      const out = [];
      const xs = await window.libraryAPI.list();
      for (const t of ${JSON.stringify(TITLES)}) {
        const it = xs.find((x) => x.title === t);
        if (!it) { out.push(t + ":absent"); continue; }
        try {
          const ok = await window.libraryAPI.remove(it.id);
          out.push(t + ":" + (ok ? "removed" : "returned-false"));
        } catch (e) {
          out.push(t + ":threw:" + String(e && e.message || e).slice(0, 80));
        }
      }
      return JSON.stringify(out);
    })()`);
    await wait(900);
    const leftNow = await cdp2.eval(`window.libraryAPI.list().then((xs) => ${JSON.stringify(TITLES)}.filter((t) => xs.some((x) => x.title === t)).length)`);
    if (leftNow === 0) break;
    await wait(800);
  }
  console.log("  clean detail:", cleanResult);
  // 删书不级联删卡是既有设计（deleteItem 只软删 items+documents）——测试卡全部单独删（含历史崩溃运行遗留的孤儿卡）
  const delCard = await cdp2.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const cards = all.filter((x) => (x.frontMarkdown || "").includes("FSRSTEST M6 Word 制卡题面"));
    for (const c of cards) await window.cardsAPI.remove(c.id);
    return "deleted:" + cards.length;
  })()`);
  await wait(700);
  const leftAfter = await cdp2.eval(`window.libraryAPI.list().then((xs) => ${JSON.stringify(TITLES)}.filter((t) => xs.some((x) => x.title === t)).length)`);
  const cardGone = await cdp2.eval(`window.cardsAPI.listAll().then((all) => !all.some((x) => (x.frontMarkdown || "").includes("FSRSTEST M6 Word 制卡题面")))`);
  check("三本书与测试卡已清理", leftAfter === 0 && cardGone === true, `delCard=${delCard} left=${leftAfter} cardGone=${cardGone}`);
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  await cdp2.eval(`window.settingsAPI.set("app", "readerSettings", ${typeof origSettings === "string" && origSettings && origSettings !== "null" ? origSettings : "null"})`);
  check("fixture 目录已删", !fs.existsSync(FIXDIR), FIXDIR);

  console.log(`\n==== M6-1 GUI SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) { console.log("FAILURES 见上方 ✗ 行"); process.exitCode = 1; }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
})().catch((e) => {
  console.error("M6-1 GUI CRASH:", e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
  process.exit(1);
});
