// M6-2 PDF 基础文本导入 GUI 端到端验证（CDP 驱动真实应用，自启自关；node tests/m6-2.gui.mjs）
// 流程：造 PDF fixture（带书签大纲 3 页 + 扫描版 1 页）→ IPC 主进程转换建册（与 UI 按钮同链路）
//       → 扫描版拒绝断言 → assets 落盘 → 打开 PDF 书（目录跳章）断言正文渲染 → 选区制卡 → 重启不丢 → 清理
// 纪律：FSRSTEST 前缀；按 title 属性显式身份匹配书卡；readerSettings 存/恢复；结束清场 taskkill
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9224";
const FIXDIR = path.join(ROOT, "tests", "tmp-m62-fixtures");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

// ---------- 手工 PDF 夹具（与 tests/m6-2.test.cjs 同款构造） ----------
function buildPdf(pages, outline = []) {
  const objs = [];
  const pageObjNums = [];
  const firstPageObj = 3;
  const perPage = 2;
  const lastPageObj = firstPageObj + pages.length * perPage - 1;
  const fontObj = lastPageObj + 1;
  const outlineRoot = fontObj + 1;
  const mkContent = (lines) => {
    let s = "BT\n";
    for (const l of lines) s += `/F1 ${l.size} Tf\n1 0 0 1 ${l.x} ${l.y} Tm\n(${String(l.text).replace(/([()\\])/g, "\\$1")}) Tj\n`;
    return s + "ET";
  };
  pages.forEach((lines, i) => {
    const pageObj = firstPageObj + i * perPage;
    const contentObj = pageObj + 1;
    const c = mkContent(lines);
    pageObjNums.push(pageObj);
    objs[pageObj - 1] = `${pageObj} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentObj} 0 R/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>endobj`;
    objs[contentObj - 1] = `${contentObj} 0 obj<</Length ${c.length}>>stream\n${c}\nendstream endobj`;
  });
  objs[0] = `1 0 obj<</Type/Catalog/Pages 2 0 R${outline.length ? `/Outlines ${outlineRoot} 0 R` : ""}>>endobj`;
  objs[1] = `2 0 obj<</Type/Pages/Kids[${pageObjNums.map((n) => `${n} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;
  objs[fontObj - 1] = `${fontObj} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`;
  if (outline.length) {
    const items = outline.map((o, i) => ({ obj: outlineRoot + 1 + i, pageObj: pageObjNums[o.page], title: o.title }));
    const count = items.length;
    items.forEach((it, i) => {
      const parts = [`<</Title(${it.title.replace(/([()\\])/g, "\\$1")})/Parent ${outlineRoot} 0 R/Dest[${it.pageObj} 0 R /XYZ 0 792 0]`];
      if (i > 0) parts.push(`/Prev ${items[i - 1].obj} 0 R`);
      if (i < count - 1) parts.push(`/Next ${items[i + 1].obj} 0 R`);
      parts.push(">>endobj");
      objs[it.obj - 1] = `${it.obj} 0 obj` + parts.join("");
    });
    objs[outlineRoot - 1] = `${outlineRoot} 0 obj<</Type/Outlines/First ${items[0].obj} 0 R/Last ${items[count - 1].obj} 0 R/Count ${count}>>endobj`;
  }
  const used = objs.filter(Boolean);
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of used) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xref = pdf.length;
  pdf += "xref\n0 " + (used.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${used.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function buildFixtures() {
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const body = (y, text) => ({ x: 72, y, size: 10, text });
  const pdfPath = path.join(FIXDIR, "FSRSTEST-M6-2 导测.pdf");
  fs.writeFileSync(pdfPath, buildPdf(
    [
      [body(700, "FSRSTEST PDF anchor appears before the image zone.")],
      [body(700, "Chapter one deeper content for reading.")],
      [body(700, "Chapter two content ends here.")],
    ],
    [{ title: "FSRSTEST Chapter One", page: 0 }, { title: "FSRSTEST Chapter Two", page: 1 }]
  ));
  const scanPath = path.join(FIXDIR, "FSRSTEST-M6-2 扫描版.pdf");
  fs.writeFileSync(scanPath, buildPdf([[{ x: 72, y: 700, size: 10, text: "" }]]));
  return { pdfPath, scanPath };
}

// ---------- CDP ----------
async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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

async function startApp() {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "m6-2.gui.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false
  });
  const cdp = await connect();
  await wait(1500);
  return cdp;
}

const clickCardByTitle = (title) => `(() => {
  const el = [...document.querySelectorAll('.book-card')].find(e => e.getAttribute('title') === ${JSON.stringify(title)});
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;
const clickBtnText = (txt, sel) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(txt)}));
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;

async function openBookToChapter(cdp, title, navTitle) {
  await cdp.eval(`location.reload()`);
  await wait(2500);
  const click = await cdp.eval(clickCardByTitle(title));
  await wait(3000);
  const engineUp = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
  if (!engineUp) return { click, engineUp };
  // syn-3（§9.4 空首章清理）后无空首章；保留目录跳转定位（按标题查找，结构无关）
  await cdp.eval(`(() => { const b = document.querySelector('[data-reader-sidebar-toggle]'); b?.click(); return b ? 'ok' : 'no btn'; })()`);
  await wait(700);
  const jump = await cdp.eval(`(() => {
    const el = [...document.querySelectorAll('.reader-toc-item')].find(e => e.textContent.includes(${JSON.stringify(navTitle)}));
    if (!el) return "not found";
    el.click(); return "clicked";
  })()`);
  await wait(1500);
  return { click, engineUp, jump };
}

async function getReaderBodyText(cdp) {
  return cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    return entry ? entry.doc.body.textContent.slice(0, 400) : "no doc";
  })()`);
}

const BOOK = "FSRSTEST-M6-2 导测";

(async () => {
  console.log("== 0) 造 fixture + 启动应用 ==");
  const fx = buildFixtures();
  check("fixture 文件就绪（pdf + 扫描版）", fs.existsSync(fx.pdfPath) && fs.existsSync(fx.scanPath), FIXDIR);
  const cdp = await startApp();
  const origSettings = await cdp.eval(`window.settingsAPI.get("app", "readerSettings")`);
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  const baseline = await cdp.eval(`window.libraryAPI.list().then((xs) => xs.length)`);

  console.log("== 1) 导入 PDF（主进程转换 + 建册） ==");
  const createdRaw = await cdp.eval(`(async () => {
    const r = await window.libraryAPI.createFromPdf({ name: "FSRSTEST-M6-2 导测.pdf", path: ${JSON.stringify(fx.pdfPath)} });
    return JSON.stringify(r);
  })()`);
  const created = typeof createdRaw === "string" && createdRaw.startsWith("{") ? JSON.parse(createdRaw) : createdRaw;
  check("PDF 导入成功并返回 id/title", !!created?.id && created?.title === "FSRSTEST-M6-2 导测", String(createdRaw).slice(0, 160));

  const scanned = await cdp.eval(`(async () => {
    try {
      await window.libraryAPI.createFromPdf({ name: "FSRSTEST-M6-2 扫描版.pdf", path: ${JSON.stringify(fx.scanPath)} });
      return "imported-should-not-happen";
    } catch (e) {
      return String(e && e.message || e).slice(0, 120);
    }
  })()`);
  check("扫描版（无文本层）PDF 被拒绝且提示明确", /扫描版/.test(String(scanned)), scanned);

  const srcTypeRaw = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    return JSON.stringify({ t: it ? it.sourceType : "missing", n: xs.length });
  })()`);
  const srcType = typeof srcTypeRaw === "string" ? JSON.parse(srcTypeRaw).t : srcTypeRaw;
  check("source_type=pdf 落库", srcType === "pdf", srcType);

  console.log("== 2) assets 落盘 ==");
  const itemIdRaw = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    return it ? it.id : "missing";
  })()`);
  const itemId = itemIdRaw;
  check("pdf-original 落盘", itemId && fs.existsSync(path.join(process.env.APPDATA, "incremental-reading-dev", "assets", String(itemId), "original.pdf")), String(itemId));

  console.log("== 3) 打开 PDF 书：目录跳章 + 正文渲染 ==");
  const r1 = await openBookToChapter(cdp, BOOK, "FSRSTEST Chapter One");
  check("PDF 书进入 foliate 引擎视图", r1.engineUp === true, r1.click + "/" + r1.engineUp);
  check("目录含大纲章节且可跳转", r1.jump === "clicked", r1.jump);
  const text1 = await getReaderBodyText(cdp);
  check("第一章正文渲染（含 anchor 文本）", String(text1).includes("FSRSTEST PDF anchor"), JSON.stringify(text1).slice(0, 140));
  await cdp.eval(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button, .topbar-nav button')].find(x=>x.textContent.includes('书架')||x.title==='返回书架'); b?.click(); return b?'ok':'no btn'; })()`);
  await wait(1200);

  console.log("== 4) PDF 书选区制卡（contextRef 锚点落库） ==");
  await cdp.eval(clickCardByTitle(BOOK));
  await wait(3000);
  await cdp.eval(`(() => { document.querySelector('[data-reader-sidebar-toggle]')?.click(); return 1; })()`);
  await wait(700);
  await cdp.eval(`(() => { const el = [...document.querySelectorAll('.reader-toc-item')].find(e => e.textContent.includes('FSRSTEST Chapter One')); el?.click(); return 1; })()`);
  await wait(1500);
  const selOk = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const doc = entry.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf("FSRSTEST PDF anchor");
      if (idx >= 0) {
        const range = doc.createRange();
        range.setStart(node, idx); range.setEnd(node, idx + 16);
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
  check("PDF 书划选出制卡菜单", selOk === true && menuUp, "sel=" + selOk);
  await cdp.eval(clickBtnText("制卡", "[data-sel-act]"));
  await wait(700);
  await cdp.eval(`(() => {
    const tas = [...document.querySelectorAll("[data-card-dock] textarea")];
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    set.call(tas[0], "FSRSTEST M6-2 PDF 制卡题面");
    tas[0].dispatchEvent(new Event("input", { bubbles: true }));
    set.call(tas[1], "PDF 导入材料制卡答案");
    tas[1].dispatchEvent(new Event("input", { bubbles: true }));
    return tas.length;
  })()`);
  await cdp.eval(clickBtnText("制卡", "[data-card-dock] .wb-foot .btn-primary"));
  await wait(1200);
  const cardOk = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find((x) => (x.frontMarkdown || "").includes("FSRSTEST M6-2 PDF 制卡题面"));
    if (!c) return "absent";
    return "cfi:" + Boolean(c.contextRef && c.contextRef.cfi) + " v:" + Boolean(c.contextRef && c.contextRef.readerEngineVersion);
  })()`);
  check("PDF 选区制卡成功（CFI + 引擎版本锚点）", String(cardOk).startsWith("cfi:true"), String(cardOk));
  await cdp.eval(`document.querySelector("[data-card-dock] [data-dock-close]")?.click(); 1`);

  console.log("== 5) 重启应用 → 数据不丢、正文仍渲染 ==");
  const cdp2 = await startApp();
  const after = await cdp2.eval(`window.libraryAPI.list().then((xs) => xs.some((x) => x.title === ${JSON.stringify(BOOK)}))`);
  check("重启后 PDF 书不丢", after === true, String(after));
  const r3 = await openBookToChapter(cdp2, BOOK, "FSRSTEST Chapter One");
  const text3 = await getReaderBodyText(cdp2);
  check("重启后 PDF 正文仍渲染", r3.engineUp === true && String(text3).includes("FSRSTEST PDF anchor"), JSON.stringify(text3).slice(0, 120));
  const cardAfter = await cdp2.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    return all.some((x) => (x.frontMarkdown || "").includes("FSRSTEST M6-2 PDF 制卡题面"));
  })()`);
  check("重启后制卡记录仍在", cardAfter === true, String(cardAfter));

  console.log("== 6) 清理测试数据与 fixture ==");
  const delRaw = await cdp2.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    if (it) await window.libraryAPI.remove(it.id);
    const all = await window.cardsAPI.listAll();
    const cards = all.filter((x) => (x.frontMarkdown || "").includes("FSRSTEST M6-2 PDF 制卡题面"));
    for (const c of cards) await window.cardsAPI.remove(c.id);
    return "removed:" + (it ? 1 : 0) + " cards:" + cards.length;
  })()`);
  await wait(900);
  const leftAfter = await cdp2.eval(`window.libraryAPI.list().then((xs) => xs.some((x) => x.title === ${JSON.stringify(BOOK)}))`);
  const cardGone = await cdp2.eval(`window.cardsAPI.listAll().then((all) => !all.some((x) => (x.frontMarkdown || "").includes("FSRSTEST M6-2 PDF 制卡题面")))`);
  check("PDF 书与测试卡已清理", leftAfter === false && cardGone === true, `${delRaw} left=${leftAfter} cardGone=${cardGone}`);
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  await cdp2.eval(`window.settingsAPI.set("app", "readerSettings", ${typeof origSettings === "string" && origSettings && origSettings !== "null" ? origSettings : "null"})`);
  check("fixture 目录已删", !fs.existsSync(FIXDIR), FIXDIR);

  console.log(`\n==== M6-2 GUI SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) { console.log("FAILURES 见上方 ✗ 行"); process.exitCode = 1; }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
})().catch((e) => {
  console.error("M6-2 GUI CRASH:", e);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* */ }
  process.exit(1);
});
