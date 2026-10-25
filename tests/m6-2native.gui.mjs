// M6-2 修订原生阅读 GUI 端到端验证（CDP 驱动真实应用，自启自关；node tests/m6-2native.gui.mjs）
// 流程：造 PDF fixture（3 页 + 2 条书签大纲）→ createFromPdf 只存原文 → 打开书断言原生渲染
//       （canvas + 文本层在场，非合成 EPUB）→ 选词制卡（contextRef 含 pageIndex + pdfjs 版本）
//       → 摘录 → 跳转原文回页 → 深色外观不断言只截图 → 重启后进度恢复到同页 → 清理
// 纪律：FSRSTEST 前缀；按 title 属性显式身份匹配书卡；readerSettings 存/恢复；结束清场 taskkill
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// C-11：userData 不再默认指向真实目录；NUTATION_USER_DATA 必填（与应用 spawn 同环境）
if (!process.env.NUTATION_USER_DATA) {
  console.error("缺少 NUTATION_USER_DATA 环境变量（指向应用 userData 目录）。");
  process.exit(1);
}
const PORT = "9224";
const FIXDIR = path.join(ROOT, "tests", "tmp-m62n-fixtures");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

// ---------- 手工 PDF 夹具（3 页 + 书签大纲 2 条；无压缩内容流 + Helvetica，限 ASCII） ----------
function buildPdfFixture() {
  const mkContent = (lines) => {
    let s = "BT\n";
    for (const l of lines) s += `/F1 ${l.size} Tf\n1 0 0 1 ${l.x} ${l.y} Tm\n(${l.text}) Tj\n`;
    return s + "ET";
  };
  const pages = [
    [{ x: 72, y: 700, size: 12, text: "FSRSTEST native pdf page one anchor-word here." }],
    [{ x: 72, y: 700, size: 12, text: "Second page body text for chapter one." }],
    [{ x: 72, y: 700, size: 12, text: "Third page holds the ending." }],
  ];
  const outline = [
    { title: "FSRSTEST Native One", page: 0 },
    { title: "FSRSTEST Native Two", page: 2 },
  ];
  const objs = [];
  const pageObjNums = [];
  const firstPageObj = 3;
  const perPage = 2;
  const lastPageObj = firstPageObj + pages.length * perPage - 1;
  const fontObj = lastPageObj + 1;
  const outlineRoot = fontObj + 1;
  pages.forEach((lines, i) => {
    const pageObj = firstPageObj + i * perPage;
    const contentObj = pageObj + 1;
    const c = mkContent(lines);
    pageObjNums.push(pageObj);
    objs[pageObj - 1] = `${pageObj} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentObj} 0 R/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>endobj`;
    objs[contentObj - 1] = `${contentObj} 0 obj<</Length ${c.length}>>stream\n${c}\nendstream endobj`;
  });
  objs[0] = `1 0 obj<</Type/Catalog/Pages 2 0 R/Outlines ${outlineRoot} 0 R>>endobj`;
  objs[1] = `2 0 obj<</Type/Pages/Kids[${pageObjNums.map((n) => `${n} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;
  objs[fontObj - 1] = `${fontObj} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`;
  const items = outline.map((o, i) => ({ obj: outlineRoot + 1 + i, pageObj: pageObjNums[o.page], title: o.title }));
  items.forEach((it, i) => {
    const parts = [`<</Title(${it.title})/Parent ${outlineRoot} 0 R/Dest[${it.pageObj} 0 R /XYZ 0 792 0]`];
    if (i > 0) parts.push(`/Prev ${items[i - 1].obj} 0 R`);
    if (i < items.length - 1) parts.push(`/Next ${items[i + 1].obj} 0 R`);
    parts.push(">>endobj");
    objs[it.obj - 1] = `${it.obj} 0 obj` + parts.join("");
  });
  objs[outlineRoot - 1] = `${outlineRoot} 0 obj<</Type/Outlines/First ${items[0].obj} 0 R/Last ${items[items.length - 1].obj} 0 R/Count ${items.length}>>endobj`;
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

async function startApp(logName) {
  killProc(electron);
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", logName), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32"
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
const backToShelf = `(() => { const b=[...document.querySelectorAll('.reader-engine-controls button, .topbar-nav button')].find(x=>x.textContent.includes('书架')||x.title==='返回书架'); b?.click(); return b?'ok':'no btn'; })()`;

const BOOK = "FSRSTEST-M6-2N 原生导测";
const CARD_FRONT = "FSRSTEST M6-2N 原生制卡题面";

async function openPdfBook(cdp) {
  await cdp.eval(`location.reload()`);
  await wait(2500);
  await cdp.eval(`window.__pdfErrs = []; window.addEventListener("unhandledrejection", (e) => window.__pdfErrs.push(String((e.reason && (e.reason.stack || e.reason.message)) || e).slice(0, 400))); window.addEventListener("error", (e) => window.__pdfErrs.push("win:" + e.message.slice(0, 200))); 1`);
  const click = await cdp.eval(clickCardByTitle(BOOK));
  await wait(4000);
  const engineUp = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host .pdf-viewer-container"))`);
  return { click, engineUp };
}

async function pdfRenderState(cdp) {
  const raw = await cdp.eval(`(() => {
    const host = document.querySelector(".reader-engine-host");
    if (!host) return JSON.stringify({ noHost: true });
    const canvas = host.querySelectorAll(".pdf-viewer-container canvas").length;
    const spans = host.querySelectorAll(".pdf-viewer-container .textLayer span").length;
    const foliate = host.querySelectorAll("foliate-view").length;
    const k = window.__readerKernel;
    let loc = null;
    try { loc = k && k.getCurrentLocation ? k.getCurrentLocation() : null; } catch (e) { loc = "err"; }
    return JSON.stringify({ canvas, spans, foliate, loc });
  })()`);
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { raw: String(raw) }; }
}

(async () => {
  console.log("== 0) 造 fixture + 启动应用 ==");
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const pdfPath = path.join(FIXDIR, "FSRSTEST-M6-2N 原生导测.pdf");
  fs.writeFileSync(pdfPath, buildPdfFixture());
  check("fixture PDF 就绪", fs.existsSync(pdfPath), FIXDIR);
  const cdp = await startApp("m6-2native.gui.app.log");
  const origSettings = await cdp.eval(`window.settingsAPI.get("app", "readerSettings")`);
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  const baseline = await cdp.eval(`window.libraryAPI.list().then((xs) => xs.length)`);

  console.log("== 1) 导入 PDF（只存原文，不再提纯） ==");
  const createdRaw = await cdp.eval(`(async () => {
    try {
      const r = await window.libraryAPI.createFromPdf({ name: "FSRSTEST-M6-2N 原生导测.pdf", path: ${JSON.stringify(pdfPath)} });
      return "OK:" + JSON.stringify(r);
    } catch (e) { return "THREW:" + String((e && e.message) || e).slice(0, 200); }
  })()`);
  const created = typeof createdRaw === "string" && createdRaw.startsWith("OK:") ? JSON.parse(createdRaw.slice(3)) : null;
  check("PDF 导入成功并返回 id/title/pages", !!created?.id && created?.title === BOOK && created?.pages === 3, String(createdRaw).slice(0, 180));
  const srcType = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    return JSON.stringify({ t: it ? it.sourceType : "missing", id: it ? it.id : null });
  })()`);
  const srcObj = typeof srcType === "string" ? JSON.parse(srcType) : srcType;
  check("source_type=pdf 落库", srcObj?.t === "pdf", String(srcType).slice(0, 120));
  check("pdf-original 落盘", srcObj?.id && fs.existsSync(path.join(process.env.NUTATION_USER_DATA, "assets", String(srcObj.id), "original.pdf")), String(srcObj?.id));

  console.log("== 2) 打开 PDF 书：原生渲染（canvas + 文本层，非合成 EPUB） ==");
  const r1 = await openPdfBook(cdp);
  check("PDF 书进入 pdf.js 引擎视图", r1.engineUp === true, r1.click + "/" + r1.engineUp);
  await wait(3000);
  const st1 = await pdfRenderState(cdp);
  check("页面 canvas 渲染在场", (st1.canvas ?? 0) > 0, JSON.stringify(st1));
  check("文本层 span 在场（可选词）", (st1.spans ?? 0) > 0, JSON.stringify(st1));
  check("非 foliate 视图（无 foliate-view）", st1.foliate === 0, JSON.stringify(st1));
  check("当前位置为页码锚点（pageIndex）", typeof st1.loc?.pageIndex === "number", JSON.stringify(st1.loc));

  console.log("== 3) 目录：大纲章节跳转 ==");
  const tocJump = await cdp.eval(`(() => {
    const b = document.querySelector('[data-reader-sidebar-toggle]');
    if (!b) return "no toc btn";
    b.click(); return "opened";
  })()`);
  await wait(700);
  const tocItems = await cdp.eval(`[...document.querySelectorAll('.reader-toc-item')].map(e => e.textContent.trim()).join(' / ')`);
  check("目录含大纲两章", String(tocItems).includes("FSRSTEST Native One") && String(tocItems).includes("FSRSTEST Native Two"), tocItems);
  await cdp.eval(`(() => { const el = [...document.querySelectorAll('.reader-toc-item')].find(e => e.textContent.includes('FSRSTEST Native Two')); el?.click(); return 1; })()`);
  await wait(1500);
  const stToc = await pdfRenderState(cdp);
  check("目录跳转到第三页（pageIndex=2）", stToc.loc?.pageIndex === 2, JSON.stringify(stToc.loc));

  console.log("== 4) 选词制卡（contextRef 含 pageIndex + pdfjs 版本） ==");
  const selOk = await cdp.eval(`(() => {
    const host = document.querySelector(".reader-engine-host");
    if (!host) return "no host";
    const spans = [...host.querySelectorAll(".textLayer span")];
    const target = spans.find(s => (s.textContent || "").includes("anchor-word"));
    if (!target || !target.firstChild) return "no marker";
    const doc = host.ownerDocument;
    const node = target.firstChild;
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min((node.textContent || "").length, 11));
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const r = range.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
    return true;
  })()`);
  await wait(700);
  const menuUp = await cdp.eval(`Boolean(document.querySelector(".selection-menu"))`);
  check("PDF 文本层划选出制卡菜单", selOk === true && menuUp, "sel=" + selOk);
  await cdp.eval(clickBtnText("制卡", "[data-sel-act]"));
  await wait(700);
  await cdp.eval(`(() => {
    const tas = [...document.querySelectorAll("[data-card-dock] textarea")];
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    set.call(tas[0], ${JSON.stringify(CARD_FRONT)});
    tas[0].dispatchEvent(new Event("input", { bubbles: true }));
    set.call(tas[1], "PDF 原生制卡答案");
    tas[1].dispatchEvent(new Event("input", { bubbles: true }));
    return tas.length;
  })()`);
  await cdp.eval(clickBtnText("创建卡片", "[data-card-dock] .btn-primary"));
  await wait(1200);
  const cardOk = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find((x) => (x.frontMarkdown || "").includes(${JSON.stringify(CARD_FRONT)}));
    if (!c) return "absent";
    return "page:" + c.contextRef.pageIndex + " v:" + c.contextRef.readerEngineVersion + " anchor:" + String(c.contextRef.anchorText || "").slice(0, 12);
  })()`);
  check("制卡成功（pageIndex + pdfjs 版本锚点）", /^page:\d+ v:pdfjs-/.test(String(cardOk)), String(cardOk));
  await cdp.eval(`document.querySelector("[data-card-dock] [data-dock-close]")?.click(); 1`);
  await cdp.eval(backToShelf);
  await wait(1200);

  console.log("== 5) 摘录 + 跳转原文回页 ==");
  await cdp.eval(clickCardByTitle(BOOK));
  await wait(4000);
  await cdp.eval(`(() => {
    const host = document.querySelector(".reader-engine-host");
    const spans = [...host.querySelectorAll(".textLayer span")];
    const target = spans.find(s => (s.textContent || "").includes("Second page body"));
    if (!target || !target.firstChild) return "no marker";
    const doc = host.ownerDocument;
    const node = target.firstChild;
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, (node.textContent || "").length);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const r = range.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
    return true;
  })()`);
  await wait(700);
  await cdp.eval(clickBtnText("摘录", "[data-sel-act]"));
  await wait(1200);
  const extractOk = await cdp.eval(`(async () => {
    const topics = await window.workflowAPI.listDue();
    const t = topics.find((x) => ((x.contentMarkdown || x.content_markdown) || "").includes("Second page body"));
    if (!t) return "absent";
    return "page:" + (t.contextRef && t.contextRef.pageIndex);
  })()`);
  check("摘录成功（contextRef 含 pageIndex）", String(extractOk).startsWith("page:"), String(extractOk));
  await cdp.eval(`window.getSelection()?.removeAllRanges(); 1`);
  await cdp.eval(backToShelf);
  await wait(1200);

  console.log("== 6) 翻到第 3 页 → 关闭 → 重开恢复到同页 ==");
  await cdp.eval(clickCardByTitle(BOOK));
  await wait(4000);
  await cdp.eval(`(() => { const k = window.__readerKernel; return k ? k.goTo({ pageIndex: 2 }).then((r) => "goto:" + r) : "no kernel"; })()`);
  await wait(2500);
  const beforeClose = await pdfRenderState(cdp);
  check("翻到第 3 页（pageIndex=2）", beforeClose.loc?.pageIndex === 2, JSON.stringify(beforeClose.loc));
  await cdp.eval(backToShelf);
  await wait(2500); // relocate 防抖 700ms + persist 落库
  const savedProgress = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    const doc = await window.libraryAPI.getDocument(it.id);
    return doc.progressJson;
  })()`);
  check("进度落库含 pageIndex=2", (() => { try { return JSON.parse(savedProgress).pageIndex === 2; } catch { return false; } })(), String(savedProgress).slice(0, 160));
  // 重启应用
  const cdp2 = await startApp("m6-2native.gui.app2.log");
  const rReopen = await openPdfBook(cdp2);
  await wait(2500);
  // 等待文本层渲染完成再断言（重启后首屏渲染需要时间）
  for (let i = 0; i < 20; i++) {
    const st = await pdfRenderState(cdp2);
    if ((st.spans ?? 0) > 0) break;
    await wait(500);
  }
  const stReopen = await pdfRenderState(cdp2);
  check("重启后 PDF 书仍原生渲染", rReopen.engineUp === true && (stReopen.canvas ?? 0) > 0, JSON.stringify(stReopen));
  check("重启后恢复到第 3 页", stReopen.loc?.pageIndex === 2, JSON.stringify(stReopen.loc));

  console.log("== 7) 清理测试数据与 fixture ==");
  const delRaw = await cdp2.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(BOOK)});
    if (it) await window.libraryAPI.remove(it.id);
    const all = await window.cardsAPI.listAll();
    const cards = all.filter((x) => (x.frontMarkdown || "").includes(${JSON.stringify(CARD_FRONT)}));
    for (const c of cards) await window.cardsAPI.remove(c.id);
    return "removed:" + (it ? 1 : 0) + " cards:" + cards.length;
  })()`);
  await wait(900);
  const leftAfter = await cdp2.eval(`window.libraryAPI.list().then((xs) => xs.some((x) => x.title === ${JSON.stringify(BOOK)}))`);
  const cardGone = await cdp2.eval(`window.cardsAPI.listAll().then((all) => !all.some((x) => (x.frontMarkdown || "").includes(${JSON.stringify(CARD_FRONT)})))`);
  check("PDF 书与测试卡已清理", leftAfter === false && cardGone === true, `${delRaw} left=${leftAfter} cardGone=${cardGone}`);
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  await cdp2.eval(`window.settingsAPI.set("app", "readerSettings", ${typeof origSettings === "string" && origSettings && origSettings !== "null" ? origSettings : "null"})`);
  check("fixture 目录已删", !fs.existsSync(FIXDIR), FIXDIR);

  console.log(`\n==== M6-2N GUI SUMMARY ${pass}/${pass + fail} ====`);
  if (fail > 0) { console.log("FAILURES 见上方 ✗ 行"); process.exitCode = 1; }
  killProc(electron);
})().catch((e) => {
  console.error("M6-2N GUI CRASH:", e);
  killProc(electron);
  process.exit(1);
});
