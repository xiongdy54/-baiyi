// M16 批 6（D61 §6.8-11）批 3 文中留痕 GUI 端到端：根摘录的 sourceAnchor → 阅读器里的**只读标记**
// @runtime: node  @tier: 2  @gui: true  @id: MARKS  @timeout: 420
// 运行：npm run build 之后 `node tests/marks.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关、可 taskkill electron）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-marks-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 断言链（§4）：
//   ① 写入侧：真鼠标拖选 → 摘录 → contextRef.sourceAnchor 落三条腿（PDF：pageIndex + 页内百分比 rects；
//      EPUB：cfi）+ documentId + anchorText + 引擎版本；
//   ② 绘制侧（PDF）：标记矩形 **＝页矩形 + rects 百分比**（几何正向对照，容差 2px），
//      并配「标记确实偏离页原点 ≥50px」与「拿容器原点当页原点会偏」两条对照——证明测量具备分辨力；
//   ③ 交互：hover 出浮层（原文 + 批注 + 已制卡数 + 「就此制卡」）→ 就此制卡走既有制卡链落库且挂 extractId
//      → 再 hover 计数变 1；带 comment 的标记有角标、浮层显示批注；
//   ④ 深浅两档可见性：标记背景非透明 + 左缘 2px accent（颜色＝Token 求值）+ 合成对比 >1.05
//      （负对照＝透明探针必须 ≈1.00）；
//   ⑤ EPUB 侧同一套：cfi → Range 的 ::highlight 在场、高亮文本＝所选、注入字面值随主题两档变化。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9236";
const USER_DATA = path.join(ROOT, "tests", "tmp-marks-userdata");
const FIXDIR = path.join(ROOT, "tests", "tmp-marks-fixtures");
const PDF_TITLE = "MARKGUI PDF 夹具书";
const EPUB_TITLE = "MARKGUI EPUB 夹具书";
const PDF_LINE = "MARKPDF alpha bravo charlie delta echo foxtrot golf hotel india juliet.";
const PDF_PICK = "charlie delta";
const EPUB_MARK = "MARKGUI甲样本";
const EPUB_FIXTURE = [
  `第一段：${EPUB_MARK} 是本次要摘的文字。`,
  "",
  "第二段：其余内容不得进入摘录。"
].join("\n");
const CARD_BACK = "MARKGUI 就此制卡的答案";

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

// ---------- 手工 PDF 夹具（单页；无压缩内容流 + Helvetica，限 ASCII） ----------
function buildPdfFixture() {
  const content = "BT\n/F1 12 Tf\n1 0 0 1 72 700 Tm\n(" + PDF_LINE + ") Tj\nET";
  const objs = [];
  objs[0] = "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj";
  objs[1] = "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj";
  objs[2] = "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj";
  objs[3] = `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`;
  objs[4] = "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj";
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xref = pdf.length;
  pdf += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ---------- CDP ----------
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

/** 真鼠标拖选（CDP Input；与 multiselect 同款） */
function makeDrag(cdp) {
  return async (from, to, modifiers = 0) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, modifiers });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 6; i++) {
      const x = from.x + ((to.x - from.x) * i) / 6;
      const y = from.y + ((to.y - from.y) * i) / 6;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers });
      await wait(40);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers });
  };
}

/** 真鼠标点击宿主坐标点 */
async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

/** 真鼠标移到某点（hover） */
const hoverAt = (cdp, x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });

/** 元素中心（宿主坐标）；不在场返回 null */
const centerOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "";
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})()`;

const clickCardByTitle = (title) => `(() => {
  const t = [...document.querySelectorAll(".book-card-title, .book-card")].find((x) => x.textContent.includes(${JSON.stringify(title)}));
  if (!t) return "not found";
  t.click();
  return "clicked";
})()`;

// PDF 文本层里某段子串的宿主坐标（拖选/命中用；片段必须落在同一个 span 里）
const spanRectInPdf = (needle) => `(() => {
  const host = document.querySelector(".reader-engine-host");
  if (!host) return "";
  for (const sp of [...host.querySelectorAll(".textLayer span")]) {
    const t = sp.textContent || "";
    const i = t.indexOf(${JSON.stringify(needle)});
    if (i < 0 || !sp.firstChild) continue;
    const doc = sp.ownerDocument;
    const range = doc.createRange();
    range.setStart(sp.firstChild, i);
    range.setEnd(sp.firstChild, i + ${needle.length});
    const r = range.getBoundingClientRect();
    return JSON.stringify({ x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2, text: range.toString(), span: t });
  }
  return "";
})()`;

// EPUB 章节里的目标文字（宿主坐标；与 multiselect 同款）
const spanRectInEpub = (mark, isHost = false) => `(() => {
  const k = window.__readerKernel;
  const entries = (k && k.__getContents ? k.__getContents() : []).filter((e) => e.doc && e.doc.defaultView && e.doc.defaultView.frameElement);
  for (const { doc } of entries) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf(${JSON.stringify(mark)});
      if (idx < 0) continue;
      const range = doc.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + ${mark.length});
      const rects = range.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) return "";
      const fr = doc.defaultView.frameElement.getBoundingClientRect();
      return JSON.stringify({
        x1: fr.left + first.left + 2, x2: fr.left + last.right - 2,
        y: fr.top + first.top + first.height / 2, text: range.toString()
      });
    }
  }
  return "";
})()`;

/** 取一条摘录（按原文子串找）并回 sourceAnchor 原样 */
const fetchExtract = (needle) => `(async () => {
  const all = await window.workflowAPI.listAll();
  const hit = (all || []).find((e) => String(e.contentMarkdown || "").includes(${JSON.stringify(needle)}));
  if (!hit) return JSON.stringify({ found: false, n: (all || []).length });
  const ref = hit.contextRef || {};
  return JSON.stringify({
    found: true, id: hit.id, text: hit.contentMarkdown, comment: hit.comment,
    documentId: ref.documentId, sourceAnchor: ref.sourceAnchor || null, parentExtractId: ref.parentExtractId || null
  });
})()`;

/** PDF 标记的几何实测（与 sourceAnchor.rects 的百分比做正向对照）。
 *  参考系＝页**内容框**：pdf.js 的 `.page` 带一圈透明边框（--page-border，实测 8.8px），
 *  canvas/文本层都从内容框起算——用边框盒会系统性偏一个边框宽。 */
const markGeometry = (markId, rectsJson) => `(() => {
  const page = document.querySelector(".pdf-viewer-container .page[data-page-number='1']");
  if (!page) return JSON.stringify({ err: "no page" });
  const cs = getComputedStyle(page);
  const br = page.getBoundingClientRect();
  const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
  const brw = parseFloat(cs.borderRightWidth) || 0, bbw = parseFloat(cs.borderBottomWidth) || 0;
  const p = { l: br.left + bl, t: br.top + bt, w: br.width - bl - brw, h: br.height - bt - bbw };
  const els = [...document.querySelectorAll('.pdf-mark-layer .reader-doc-mark[data-mark-id="' + ${JSON.stringify(markId)} + '"]')];
  if (!els.length) return JSON.stringify({ err: "no mark el", page: p });
  const rects = ${rectsJson};
  const measured = els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const hidden = els.filter((el) => el.style.display === "none").length;
  const out = { page: p, border: { l: bl, t: bt }, measured, expected: [], hidden, dExact: 0, dOrigin: 0 };
  measured.forEach((m, i) => {
    const rr = rects[i];
    if (!rr) return;
    const ex = { x: p.l + (rr.x / 100) * p.w, y: p.t + (rr.y / 100) * p.h, w: (rr.w / 100) * p.w, h: (rr.h / 100) * p.h };
    out.expected.push(ex);
    out.dExact = Math.max(out.dExact, Math.abs(m.x - ex.x), Math.abs(m.y - ex.y), Math.abs(m.w - ex.w), Math.abs(m.h - ex.h));
    // 对照：标记相对页内容框原点的位移（画在原点就会是 ~0，用它证明断言有分辨力）
    out.dOrigin = Math.max(out.dOrigin, Math.abs(m.x - p.l), Math.abs(m.y - p.t));
  });
  return JSON.stringify(out);
})()`;

/** 深浅两档可见性：标记背景非透明 + 左缘 2px accent + 合成对比（含透明负对照） */
const visibilityProbe = (markId) => `(() => {
  const parse = (s) => {
    let m = s.match(/rgba?\\(([^)]+)\\)/);
    if (m) { const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
    m = s.match(/color\\(srgb\\s+([^)]+)\\)/);
    if (m) { const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3).map((v) => Math.round(v * 255)), a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const contrastOver = (fg, bg) => { const a = lum(fg), b = lum(bg); const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };
  const paper = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 };
  const probeBg = (css) => { const d = document.createElement("div"); d.style.cssText = "position:absolute;width:0;height:0;display:none;background:" + css + ";"; document.body.appendChild(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return v; };
  const accent = probeBg("var(--accent)");
  const el = document.querySelector('.pdf-mark-layer .reader-doc-mark[data-mark-id="' + ${JSON.stringify(markId)} + '"]');
  const clear = document.querySelector(".pdf-mark-layer .mark-visibility-control") || (() => {
    const d = document.createElement("div"); d.className = "mark-visibility-control"; d.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;background:transparent;pointer-events:none;";
    document.querySelector(".pdf-mark-layer")?.appendChild(d); return d;
  })();
  const out = { theme: document.body.className, paper: getComputedStyle(document.body).backgroundColor, accent, hasMark: !!el };
  if (!el) return JSON.stringify(out);
  const cs = getComputedStyle(el);
  const bg = parse(cs.backgroundColor);
  out.bgRaw = cs.backgroundColor;
  out.alpha = bg ? bg.a : -1;
  out.borderLeftWidth = cs.borderLeftWidth;
  out.borderLeftColor = cs.borderLeftColor;
  if (bg && bg.a > 0) {
    const comp = bg.rgb.map((c, i) => Math.round(c * bg.a + paper.rgb[i] * (1 - bg.a)));
    out.composite = comp;
    out.contrast = contrastOver(comp, paper.rgb);
  } else { out.contrast = 1; }
  const ctrl = parse(getComputedStyle(clear).backgroundColor);
  out.controlContrast = ctrl && ctrl.a > 0 ? contrastOver(ctrl.rgb, paper.rgb) : 1;
  return JSON.stringify(out);
})()`;

/** 浮层内容（原文/批注/计数/按钮） */
const popoverState = `(() => {
  const el = document.querySelector(".reader-mark-pop");
  if (!el) return JSON.stringify({ open: false });
  const q = el.querySelector(".reader-mark-pop-quote");
  const c = el.querySelector(".reader-mark-pop-comment");
  const m = el.querySelector(".reader-mark-pop-meta");
  const btns = [...el.querySelectorAll("button")].map((b) => b.textContent.trim());
  const r = el.getBoundingClientRect();
  return JSON.stringify({
    open: true, quote: q ? q.textContent : null, comment: c ? c.textContent : null,
    meta: m ? m.textContent : null, buttons: btns,
    rect: { l: r.left, t: r.top, w: r.width, h: r.height }, vw: window.innerWidth, vh: window.innerHeight
  });
})()`;

const bookDocId = (title) => `(async () => {
  const xs = await window.libraryAPI.list();
  const it = xs.find((x) => x.title === ${JSON.stringify(title)});
  if (!it) return "";
  const doc = await window.libraryAPI.getDocument(it.id);
  return doc && doc.documentId ? doc.documentId : "";
})()`;

const screenshot = async (cdp, name) => {
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const b64 = r?.result?.data || r?.data;
    if (!b64) return false;
    fs.writeFileSync(path.join(ROOT, "tests", name), Buffer.from(b64, "base64"));
    return true;
  } catch { return false; }
};

/** 等到标记层里有元素被正确定位（display 不为 none） */
async function waitMarksLaidOut(cdp, minCount = 1, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await cdp.eval(`[...document.querySelectorAll(".pdf-mark-layer .reader-doc-mark")].filter((el) => el.style.display !== "none").length`);
    if (typeof n === "number" && n >= minCount) return n;
    await wait(250);
  }
  return await cdp.eval(`[...document.querySelectorAll(".pdf-mark-layer .reader-doc-mark")].filter((el) => el.style.display !== "none").length`);
}

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const pdfPath = path.join(FIXDIR, "MARKGUI.pdf");
  fs.writeFileSync(pdfPath, buildPdfFixture());
  check("fixture PDF 就绪", fs.existsSync(pdfPath), pdfPath);

  const out = openSync(path.join(ROOT, "tests", "marks.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await cdp.send("Page.enable");
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ================= A. PDF =================
  console.log("== A) PDF：写入 sourceAnchor → 矩形留痕 → 几何正向对照 ==");
  const createdRaw = await cdp.eval(`(async () => {
    try {
      const r = await window.libraryAPI.createFromPdf({ name: ${JSON.stringify(PDF_TITLE + ".pdf")}, path: ${JSON.stringify(pdfPath)} });
      return "OK:" + JSON.stringify(r);
    } catch (e) { return "THREW:" + String((e && e.message) || e).slice(0, 200); }
  })()`);
  const created = typeof createdRaw === "string" && createdRaw.startsWith("OK:") ? JSON.parse(createdRaw.slice(3)) : null;
  check("PDF 导入成功（单页）", !!created?.id && created?.pages === 1, String(createdRaw).slice(0, 200));
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  await cdp.eval(`location.reload()`);
  await wait(3000);
  const opened = await cdp.eval(clickCardByTitle(PDF_TITLE));
  await wait(4000);
  check("PDF 书进入 pdf.js 引擎视图", opened === "clicked" && (await cdp.eval(`!!document.querySelector(".reader-engine-host .pdf-viewer-container")`)) === true, opened);
  for (let i = 0; i < 20; i++) {
    const n = await cdp.eval(`document.querySelectorAll(".reader-engine-host .textLayer span").length`);
    if (typeof n === "number" && n > 0) break;
    await wait(400);
  }
  const pdfDocId = await cdp.eval(bookDocId(PDF_TITLE));
  check("取到本文档 documentId（后续 sourceAnchor 对照的基准）", typeof pdfDocId === "string" && pdfDocId.length > 10, pdfDocId);

  // 真鼠标拖选 mid-phrase
  const pick = JSON.parse(String(await cdp.eval(spanRectInPdf(PDF_PICK))) || "{}");
  check("目标片段在文本层可定位（坐标可算）", typeof pick.x1 === "number" && pick.text === PDF_PICK, JSON.stringify(pick));
  await makeDrag(cdp)({ x: pick.x1, y: pick.y }, { x: pick.x2, y: pick.y });
  await wait(900);
  check("真鼠标拖选后选区菜单出现", (await cdp.eval(`!!document.querySelector(".selection-menu")`)) === true, "无菜单");
  const btn = JSON.parse(String(await cdp.eval(centerOf(".selection-menu button:nth-child(4)"))) || "{}");
  check("选区菜单含「摘录」按钮（第 4 项）", typeof btn.x === "number", JSON.stringify(btn));
  await clickAt(cdp, btn.x, btn.y);
  await wait(1500);

  const exRaw = await cdp.eval(fetchExtract(PDF_PICK));
  const ex = JSON.parse(String(exRaw) || "{}");
  check("摘录已落库（含所选文字）", ex.found === true && ex.text === PDF_PICK, exRaw);
  check("sourceAnchor.documentId ＝ 本文档 id", ex.sourceAnchor?.documentId === pdfDocId, JSON.stringify(ex.sourceAnchor));
  check("sourceAnchor.pageIndex ＝ 0（单页书）", ex.sourceAnchor?.pageIndex === 0, JSON.stringify(ex.sourceAnchor));
  check(
    "sourceAnchor.rects 非空且全落在 0-100（页内百分比）",
    Array.isArray(ex.sourceAnchor?.rects) && ex.sourceAnchor.rects.length >= 1 &&
      ex.sourceAnchor.rects.every((r) => [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)),
    JSON.stringify(ex.sourceAnchor?.rects)
  );
  check(
    "sourceAnchor 三条腿齐（anchorText 命中 + 引擎版本 pdfjs-）",
    String(ex.sourceAnchor?.anchorText || "").includes(PDF_PICK) && /^pdfjs-/.test(String(ex.sourceAnchor?.readerEngineVersion || "")),
    JSON.stringify(ex.sourceAnchor)
  );

  const laid = await waitMarksLaidOut(cdp, 1);
  check("标记层画出该摘录的矩形（.reader-doc-mark）", typeof laid === "number" && laid >= 1, laid);
  const geo = JSON.parse(String(await cdp.eval(markGeometry(ex.id, JSON.stringify(ex.sourceAnchor?.rects ?? [])))) || "{}");
  check(
    "几何正向对照：标记矩形 ＝ 页矩形 + rects 百分比（最大偏差 ≤ 2px）",
    typeof geo.dExact === "number" && geo.dExact <= 2 && geo.measured?.length === (ex.sourceAnchor?.rects?.length ?? 0),
    JSON.stringify(geo)
  );
  check("对照：标记确实偏离页原点 ≥ 50px（画在原点也能过的那种断言被排除）", typeof geo.dOrigin === "number" && geo.dOrigin >= 50, JSON.stringify(geo));

  // hover → 浮层
  const mk = await cdp.eval(`(() => {
    const el = document.querySelector('.pdf-mark-layer .reader-doc-mark[data-mark-id="' + ${JSON.stringify(ex.id)} + '"]');
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  const mkp = JSON.parse(String(mk) || "{}");
  await hoverAt(cdp, mkp.x, mkp.y);
  await wait(500);
  let pop = JSON.parse(String(await cdp.eval(popoverState)) || "{}");
  check("hover 出浮层", pop.open === true, JSON.stringify(pop));
  check("浮层原文 ＝ 摘录正文", pop.quote === PDF_PICK, JSON.stringify(pop).slice(0, 300));
  check("浮层含「已制卡 0 张」", String(pop.meta || "").includes("已制卡 0 张"), pop.meta);
  check("浮层含「就此制卡」按钮", Array.isArray(pop.buttons) && pop.buttons.includes("就此制卡"), JSON.stringify(pop.buttons));
  check(
    "浮层在视口内（不越界）",
    pop.rect && pop.rect.l >= 0 && pop.rect.t >= 0 && pop.rect.l + pop.rect.w <= pop.vw && pop.rect.t + pop.rect.h <= pop.vh,
    JSON.stringify(pop.rect)
  );
  await screenshot(cdp, "tmp-marks-pdf-light-pop.png");

  // 就此制卡 → 既有制卡链落库
  const mkBtn = JSON.parse(String(await cdp.eval(`(() => {
    const b = [...document.querySelectorAll(".reader-mark-pop button")].find((x) => x.textContent.trim() === "就此制卡");
    if (!b) return "";
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`)) || "{}");
  check("「就此制卡」按钮可点（取到坐标）", typeof mkBtn.x === "number", JSON.stringify(mkBtn));
  await clickAt(cdp, mkBtn.x, mkBtn.y);
  await wait(600);
  const quoteInEditor = await cdp.eval(`(() => { const ta = document.querySelector(".modal-panel textarea"); return ta ? ta.value : ""; })()`);
  check("手动制卡面板打开且引用 ＝ 摘录正文", quoteInEditor === PDF_PICK, quoteInEditor);
  await cdp.eval(`(() => {
    const tas = [...document.querySelectorAll(".modal-panel textarea")];
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    if (tas[1]) { set.call(tas[1], ${JSON.stringify(CARD_BACK)}); tas[1].dispatchEvent(new Event("input", { bubbles: true })); }
    return tas.length;
  })()`);
  // 保存按钮用程序化点击：制卡面板是长表单，真鼠标点位会落在滚动视口之外
  // （m6-2native 同款做法）——本轮的「真键鼠」硬要求针对的是标记的 hover/点选
  const saveClicked = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll(".modal-panel button")].find((x) => x.textContent.trim() === "创建卡片");
    if (!b) return "no btn";
    if (b.disabled) return "disabled";
    b.click();
    return "clicked";
  })()`);
  check("保存按钮可点（创建卡片）", saveClicked === "clicked", saveClicked);
  await wait(1800);
  const cardRaw = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = (all || []).find((x) => (x.frontMarkdown || "").includes(${JSON.stringify(PDF_PICK)}));
    if (!c) return JSON.stringify({ found: false, n: (all || []).length });
    return JSON.stringify({ found: true, id: c.id, back: c.backMarkdown, extractId: c.contextRef ? c.contextRef.extractId : null, documentId: c.contextRef ? c.contextRef.documentId : null });
  })()`);
  const card = JSON.parse(String(cardRaw) || "{}");
  check("就此制卡落库（走既有 createSingleCard 链）", card.found === true && card.back === CARD_BACK, cardRaw);
  check("新卡挂在被点的摘录上（contextRef.extractId ＝ 摘录 id）", card.extractId === ex.id, cardRaw);

  await hoverAt(cdp, mkp.x, mkp.y);
  await wait(900);
  pop = JSON.parse(String(await cdp.eval(popoverState)) || "{}");
  check("制卡后计数刷新为「已制卡 1 张」", String(pop.meta || "").includes("已制卡 1 张"), pop.meta);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });
  await wait(400);

  // 带批注的标记（手写 rects 走 IPC：批注编辑 UI 属后续批次，这里只验证「有 comment 就角标 + 浮层显示」）
  const ipcRaw = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    const it = xs.find((x) => x.title === ${JSON.stringify(PDF_TITLE)});
    const doc = await window.libraryAPI.getDocument(it.id);
    const r = await window.workflowAPI.create({
      parentType: "document", parentId: doc.documentId, documentId: doc.documentId,
      contentMarkdown: "MARKGUI 手写批注条（第二条留痕）",
      comment: "MARKGUI 批注样本",
      contextRef: {
        documentId: doc.documentId,
        sourceAnchor: {
          documentId: doc.documentId, pageIndex: 0,
          rects: [{ x: 60, y: 40, w: 25, h: 3, ord: 0 }],
          anchorText: "MARKGUI 手写批注条", readerEngineVersion: "pdfjs-marks-test", capturedAt: Date.now()
        }
      }
    });
    return JSON.stringify(r);
  })()`);
  const ipcEx = JSON.parse(String(ipcRaw) || "{}");
  check("第二条根摘录（带批注 + 手写 rects）已落库", typeof ipcEx.id === "string" && ipcEx.id.length > 10, ipcRaw);
  // 回书架再重开：验证「持久化 → 重画」（marks 是打开书时按库重算的）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".reader-engine-controls button, .topbar-nav button")].find((x) => x.textContent.includes("书架") || x.title === "返回书架"); b?.click(); return 1; })()`);
  await wait(1200);
  await cdp.eval(clickCardByTitle(PDF_TITLE));
  await wait(4000);
  const laid2 = await waitMarksLaidOut(cdp, 2);
  check("重开书后两条标记都在场（持久化 → 重画）", typeof laid2 === "number" && laid2 >= 2, laid2);
  const geo2 = JSON.parse(String(await cdp.eval(markGeometry(ipcEx.id, JSON.stringify([{ x: 60, y: 40, w: 25, h: 3 }])))) || "{}");
  check(
    "第二条几何正向对照（手写 60%/40%/25%/3% → 像素，最大偏差 ≤ 2px）",
    typeof geo2.dExact === "number" && geo2.dExact <= 2 && geo2.measured?.length === 1,
    JSON.stringify(geo2)
  );
  const badge = await cdp.eval(`document.querySelectorAll('.pdf-mark-layer .reader-doc-mark[data-mark-id="' + ${JSON.stringify(ipcEx.id)} + '"][data-has-comment="1"]').length`);
  check("有批注的标记带角标（data-has-comment）", badge === 1, badge);
  const mk2 = JSON.parse(String(await cdp.eval(`(() => {
    const el = document.querySelector('.pdf-mark-layer .reader-doc-mark[data-mark-id="' + ${JSON.stringify(ipcEx.id)} + '"]');
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`)) || "{}");
  await hoverAt(cdp, mk2.x, mk2.y);
  await wait(500);
  pop = JSON.parse(String(await cdp.eval(popoverState)) || "{}");
  check("hover 带批注标记 → 浮层显示批注文字", pop.comment === "MARKGUI 批注样本", JSON.stringify(pop).slice(0, 300));

  // 标记层的两条承重路径：滚动跟随 / 缩放重算（位置都在 syncMarks 里按当前页矩形重算）
  const scrollBefore = await cdp.eval(`document.querySelector(".pdf-viewer-container").scrollTop`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 550, y: 400, deltaX: 0, deltaY: 180 });
  await wait(600);
  const scrollAfter = await cdp.eval(`document.querySelector(".pdf-viewer-container").scrollTop`);
  check("（自证）滚动确实发生（scrollTop 变大）", typeof scrollAfter === "number" && scrollAfter > (scrollBefore ?? 0) + 100, `${scrollBefore} → ${scrollAfter}`);
  const geoScroll = JSON.parse(String(await cdp.eval(markGeometry(ipcEx.id, JSON.stringify([{ x: 60, y: 40, w: 25, h: 3 }])))) || "{}");
  check("滚动后标记仍贴合文字（Δ ≤ 2px；层不吃滚动偏移）", typeof geoScroll.dExact === "number" && geoScroll.dExact <= 2, JSON.stringify(geoScroll).slice(0, 300));

  const wBefore = await cdp.eval(`document.querySelector(".pdf-viewer-container .page").getBoundingClientRect().width`);
  const zoomOpened = await cdp.eval(`(() => {
    const group = [...document.querySelectorAll(".reader-engine-controls .dd")];
    for (const g of group) {
      const b = g.querySelector("button");
      if (b && /适应宽度|适应页面|%/.test(b.textContent)) { b.click(); return "opened"; }
    }
    return "no dropdown";
  })()`);
  await wait(400);
  const zoomPick = await cdp.eval(`(() => {
    const it = [...document.querySelectorAll(".dd-menu .dd-item")].find((x) => x.textContent.includes("75%"));
    if (!it) return "no item";
    it.click(); return "clicked";
  })()`);
  await wait(1500);
  const wAfter = await cdp.eval(`document.querySelector(".pdf-viewer-container .page").getBoundingClientRect().width`);
  check("（自证）缩放确实生效（页宽变了）", zoomOpened === "opened" && zoomPick === "clicked" && Math.abs((wAfter ?? 0) - (wBefore ?? 0)) > 50, `${zoomOpened}/${zoomPick} ${wBefore} → ${wAfter}`);
  const geoZoom = JSON.parse(String(await cdp.eval(markGeometry(ipcEx.id, JSON.stringify([{ x: 60, y: 40, w: 25, h: 3 }])))) || "{}");
  check("缩放后标记仍按百分比贴合（Δ ≤ 2px；百分比与缩放无关，框随页重算）", typeof geoZoom.dExact === "number" && geoZoom.dExact <= 2, JSON.stringify(geoZoom).slice(0, 300));

  // 深浅两档：切到暗夜
  const visLight = JSON.parse(String(await cdp.eval(visibilityProbe(ipcEx.id))) || "{}");
  const themeToggle = await cdp.eval(`(() => {
    const group = [...document.querySelectorAll(".reader-engine-controls .dd")];
    for (const g of group) {
      const b = g.querySelector("button");
      if (b && /纸白|羊皮|暗夜|自定义/.test(b.textContent)) { b.click(); return "opened"; }
    }
    return "no dropdown";
  })()`);
  await wait(400);
  const darkPick = await cdp.eval(`(() => {
    const it = [...document.querySelectorAll(".dd-menu .dd-item")].find((x) => x.textContent.includes("暗夜"));
    if (!it) return "no item";
    it.click(); return "clicked";
  })()`);
  await wait(1200);
  check("阅读主题切到暗夜（软件主题随动）", themeToggle === "opened" && darkPick === "clicked" && (await cdp.eval(`document.body.classList.contains("theme-dark")`)) === true, `${themeToggle}/${darkPick}`);
  const visDark = JSON.parse(String(await cdp.eval(visibilityProbe(ipcEx.id))) || "{}");
  check("浅色档：标记背景非透明（bg alpha>0）", visLight.alpha > 0, JSON.stringify(visLight).slice(0, 300));
  check(
    "浅色档：左缘 2px accent（宽度 2px、颜色＝Token 求值的 --accent）",
    visLight.borderLeftWidth === "2px" && visLight.borderLeftColor === visLight.accent,
    JSON.stringify({ w: visLight.borderLeftWidth, c: visLight.borderLeftColor, accent: visLight.accent }).slice(0, 300)
  );
  check("浅色档：合成对比 > 1.05（负对照＝透明探针 ≈1.00）", visLight.contrast > 1.05 && visLight.controlContrast < 1.01, JSON.stringify({ c: visLight.contrast, ctrl: visLight.controlContrast, paper: visLight.paper }));
  check("深色档：标记背景非透明且颜色随主题换了档", visDark.theme?.includes("theme-dark") && visDark.alpha > 0 && visDark.bgRaw !== visLight.bgRaw, JSON.stringify({ light: visLight.bgRaw, dark: visDark.bgRaw }).slice(0, 300));
  check("深色档：合成对比 > 1.05（负对照＝透明探针 ≈1.00）", visDark.contrast > 1.05 && visDark.controlContrast < 1.01, JSON.stringify({ c: visDark.contrast, ctrl: visDark.controlContrast, paper: visDark.paper }));
  const darkGeo = JSON.parse(String(await cdp.eval(markGeometry(ipcEx.id, JSON.stringify([{ x: 60, y: 40, w: 25, h: 3 }])))) || "{}");
  check("深色档：几何不变（Δ ≤ 2px，标记层在反色滤镜之外不随主题漂）", typeof darkGeo.dExact === "number" && darkGeo.dExact <= 2, JSON.stringify(darkGeo).slice(0, 300));
  await screenshot(cdp, "tmp-marks-pdf-dark.png");
  await cdp.eval(`document.body.click()`);
  await wait(300);

  // 回书架
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".reader-engine-controls button, .topbar-nav button")].find((x) => x.textContent.includes("书架") || x.title === "返回书架"); b?.click(); return 1; })()`);
  await wait(1200);

  // ================= B. EPUB =================
  console.log("== B) EPUB：cfi → Range 的 ::highlight 留痕 ==");
  const epCreated = await cdp.eval(`(async () => JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(EPUB_TITLE)}, ${JSON.stringify(EPUB_FIXTURE)})))()`);
  check("EPUB 夹具书建册成功（createFromPaste）", String(epCreated).includes(EPUB_TITLE), epCreated);
  await cdp.eval(`location.reload()`);
  await wait(3000);
  const epOpened = await cdp.eval(clickCardByTitle(EPUB_TITLE));
  await wait(3200);
  const epKernelOk = await cdp.eval(`(() => { const k = window.__readerKernel; return !!(k && k.__getContents && k.__getContents().some((e) => e.doc && e.doc.defaultView)); })()`);
  check("EPUB 书打开且阅读内核就绪", epOpened === "clicked" && epKernelOk === true, `${epOpened}/${epKernelOk}`);
  const epDocId = await cdp.eval(bookDocId(EPUB_TITLE));
  const epSel = JSON.parse(String(await cdp.eval(spanRectInEpub(EPUB_MARK))) || "{}");
  check("EPUB 目标文字可定位（坐标可算）", typeof epSel.x1 === "number" && epSel.text === EPUB_MARK, JSON.stringify(epSel));
  await makeDrag(cdp)({ x: epSel.x1, y: epSel.y }, { x: epSel.x2, y: epSel.y });
  await wait(900);
  const epBtn = JSON.parse(String(await cdp.eval(centerOf(".selection-menu button:nth-child(4)"))) || "{}");
  check("EPUB 拖选后选区菜单出现", typeof epBtn.x === "number", JSON.stringify(epBtn));
  await clickAt(cdp, epBtn.x, epBtn.y);
  await wait(1500);
  const epExRaw = await cdp.eval(fetchExtract(EPUB_MARK));
  const epEx = JSON.parse(String(epExRaw) || "{}");
  check("EPUB 摘录已落库", epEx.found === true && epEx.text === EPUB_MARK, epExRaw);
  check("EPUB sourceAnchor 用 cfi（documentId 命中、无 rects）", epEx.sourceAnchor?.documentId === epDocId && typeof epEx.sourceAnchor?.cfi === "string" && !epEx.sourceAnchor?.rects, JSON.stringify(epEx.sourceAnchor));

  // 章节文档里的 extract-mark 高亮
  const hlState = `(() => {
    const k = window.__readerKernel;
    const out = { names: [], texts: [], styleText: "" };
    for (const { doc } of (k && k.__getContents ? k.__getContents() : [])) {
      if (!doc || !doc.defaultView || !doc.defaultView.CSS || !doc.defaultView.CSS.highlights) continue;
      if (doc.defaultView.CSS.highlights.has("extract-mark")) {
        out.names.push("extract-mark");
        out.texts.push([...doc.defaultView.CSS.highlights.get("extract-mark")].map((r) => r.toString()));
      }
      const st = doc.querySelector("style[data-reader-extract-mark]");
      if (st) out.styleText = st.textContent || "";
    }
    return JSON.stringify(out);
  })()`;
  const hl = JSON.parse(String(await cdp.eval(hlState)) || "{}");
  check("EPUB 注册了 extract-mark 高亮（绘制层，不碰正文 DOM）", Array.isArray(hl.names) && hl.names.includes("extract-mark"), JSON.stringify(hl).slice(0, 300));
  check("高亮文本 ＝ 所选文字", Array.isArray(hl.texts) && hl.texts.some((t) => t.length === 1 && t[0] === EPUB_MARK), JSON.stringify(hl.texts).slice(0, 300));
  check("注入的 ::highlight 规则带求值后的具体颜色（iframe 拿不到宿主 Token）", /::highlight\(extract-mark\)\{background-color:.+\}/.test(String(hl.styleText)), hl.styleText);

  // hover 命中（真鼠标移到高亮上）
  await hoverAt(cdp, (epSel.x1 + epSel.x2) / 2, epSel.y);
  await wait(600);
  let epPop = JSON.parse(String(await cdp.eval(popoverState)) || "{}");
  check("EPUB hover 出浮层且原文 ＝ 所选文字", epPop.open === true && epPop.quote === EPUB_MARK, JSON.stringify(epPop).slice(0, 300));
  await screenshot(cdp, "tmp-marks-epub-dark.png");

  // 两档：切回纸白 → 注入字面值应变浅档
  const backToPaper = await cdp.eval(`(() => {
    const group = [...document.querySelectorAll(".reader-engine-controls .dd")];
    for (const g of group) {
      const b = g.querySelector("button");
      if (b && /纸白|羊皮|暗夜|自定义/.test(b.textContent)) { b.click(); return "opened"; }
    }
    return "no dropdown";
  })()`);
  await wait(400);
  const paperPick = await cdp.eval(`(() => {
    const it = [...document.querySelectorAll(".dd-menu .dd-item")].find((x) => x.textContent.includes("纸白"));
    if (!it) return "no item";
    it.click(); return "clicked";
  })()`);
  await wait(1200);
  const hlLight = JSON.parse(String(await cdp.eval(hlState)) || "{}");
  check(
    "EPUB 切回纸白后注入色重算（深浅两档字面值不同）",
    backToPaper === "opened" && paperPick === "clicked" && !!hlLight.styleText && hlLight.styleText !== hl.styleText,
    JSON.stringify({ backToPaper, paperPick, dark: hl.styleText, light: hlLight.styleText }).slice(0, 400)
  );
  await hoverAt(cdp, (epSel.x1 + epSel.x2) / 2, epSel.y);
  await wait(600);
  epPop = JSON.parse(String(await cdp.eval(popoverState)) || "{}");
  check("切主题后高亮仍命中（浮层照常出现）", epPop.open === true && epPop.quote === EPUB_MARK, JSON.stringify(epPop).slice(0, 300));
  await screenshot(cdp, "tmp-marks-epub-light.png");

  // ================= C. 清理 =================
  console.log("== C) 清理 ==");
  const cleanup = await cdp.eval(`(async () => {
    const xs = await window.libraryAPI.list();
    for (const t of [${JSON.stringify(PDF_TITLE)}, ${JSON.stringify(EPUB_TITLE)}]) {
      const it = xs.find((x) => x.title === t);
      if (it) await window.libraryAPI.remove(it.id);
    }
    const all = await window.cardsAPI.listAll();
    for (const c of all) if ((c.frontMarkdown || "").includes(${JSON.stringify(PDF_PICK)})) await window.cardsAPI.remove(c.id);
    return "ok";
  })()`);
  check("测试数据已清理（书 + 卡）", cleanup === "ok", cleanup);

  console.log(`\n==== marks.gui：${pass} 通过 / ${fail} 失败 ====`);
} catch (e) {
  console.error("测试异常：", (e && e.stack) || e);
  fail++;
} finally {
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  try { fs.rmSync(FIXDIR, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  process.exit(fail === 0 ? 0 : 1);
}
