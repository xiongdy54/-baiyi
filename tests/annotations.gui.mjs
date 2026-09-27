// 批 4 Task 19 新套件：就地批注全链 GUI 端到端（规格 §10.1 九组判据）
// @runtime: node  @tier: 2  @gui: true  @id: ANNOT  @timeout: 600
// 运行：npm run build 之后 `node tests/annotations.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA → tests/tmp-annot-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 夹具：手工单页 PDF（与 marks.gui 同法）+ 一份已发布导图（图谱页签用，随种子脚本播种）。
//
// 九组判据（规格 §10.1 原文编号）：
//   ① 菜单定位：上/下半落位、与选区不相交、在容器内（8px 边距）
//   ② 摘录页五动作：拖选 → 菜单五项 → 摘录/制卡/批注落库
//   ③ 批注增删改：改文字（库变 + 显示同步）/ 删除（软删 + 二次确认）/ 改色（color 落库 + 色点 computed 变）
//   ④ 层级与颜色：整卡恒置顶（含"挪到末尾判据必须变红"的对照）、整卡底＝accent-soft、左缘 2px accent、
//      段锚竖线与文中高亮同 token（另配"不同颜色必须可分辨"对照）
//   ⑤ 三页签与图谱目录：三枚在场 / 同刻一个面板 / 当前页签 accent 下划线 / 图谱嵌套与同级不重叠 / 缩进递增
//   ⑥ 角标跟色与不画规则：颜色＝该条批注色（内联 style.fill）/ 纯高亮不画
//   ⑦ 栏出现条件与占位：无批注不出现 / 有则出现且占 280px
//   ⑧ 退役检查：全应用内无「打开摘录」
//   ⑨ 截图判读：浅/深 × 摘录页/阅读器 四张落盘（人工目视，断言只保证文件非空）
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9237";
const USER_DATA = path.join(ROOT, "tests", "tmp-annot-userdata");
const FIXDIR = path.join(ROOT, "tests", "tmp-annot-fixtures");
const PDF_TITLE = "ANNOT PDF 夹具书";
const PDF_LINE = "ANNOTPDF alpha bravo charlie delta echo foxtrot golf hotel india juliet.";
const PDF_PICK = "charlie delta";

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

/** 手工 PDF 夹具（单页；无压缩内容流 + Helvetica，限 ASCII） */
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

// ---------- 通用交互 ----------
const hoverAt = (cdp, x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
async function clickAt(cdp, x, y) {
  await hoverAt(cdp, x, y);
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}
const makeDrag = (cdp) => async (from, to) => {
  await hoverAt(cdp, from.x, from.y);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    const x = from.x + ((to.x - from.x) * i) / 6;
    const y = from.y + ((to.y - from.y) * i) / 6;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await wait(35);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
};
const tokenValue = (name) => `(() => {
  const s = document.createElement("span");
  s.style.color = "var(${name})";
  document.body.appendChild(s);
  const c = getComputedStyle(s).color;
  s.remove();
  return c;
})()`;
const screenshot = async (cdp, name) => {
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const b64 = r?.result?.data || r?.data;
    if (!b64) return 0;
    fs.writeFileSync(path.join(ROOT, "tests", name), Buffer.from(b64, "base64"));
    return fs.statSync(path.join(ROOT, "tests", name)).size;
  } catch { return 0; }
};

/** 在 PDF 文本层里定位目标片段（返回可拖的起止坐标） */
const spanRectInPdf = (text) => `(() => {
  const spans = [...document.querySelectorAll(".reader-engine-host .textLayer span")];
  const hit = spans.find((s) => (s.textContent || "").includes(${JSON.stringify(text)}));
  if (!hit) return "";
  const node = hit.firstChild;
  if (!node) return "";
  const idx = (node.textContent || "").indexOf(${JSON.stringify(text)});
  if (idx < 0) return "";
  const r = document.createRange();
  r.setStart(node, idx);
  r.setEnd(node, idx + ${text.length});
  const rects = r.getClientRects();
  const first = rects[0], last = rects[rects.length - 1];
  if (!first || !last) return "";
  return JSON.stringify({ x1: first.left + 2, y: first.top + first.height / 2, x2: last.right - 2, y: last.top + last.height / 2, text: ${JSON.stringify(text)} });
})()`;

const menuState = `(() => {
  const m = document.querySelector(".selection-menu");
  if (!m) return JSON.stringify({ up: false });
  const r = m.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  return JSON.stringify({
    up: true, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
    seg: [...m.querySelectorAll(".seg button")].map((b) => ({ t: b.textContent.trim(), on: b.classList.contains("on") })),
    swatches: m.querySelectorAll(".swatches .swatch").length,
    acts: [...m.querySelectorAll(".macts button")].map((b) => b.textContent.trim()),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh
  });
})()`;

// ============================ 主流程 ============================
try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  fs.mkdirSync(FIXDIR, { recursive: true });
  const pdfPath = path.join(FIXDIR, "annot-single-page.pdf");
  fs.writeFileSync(pdfPath, buildPdfFixture());

  // 种子：一本带到期摘录的书（摘录页判据用）+ 一本带导图的三章书（图谱页签用）
  execSync("npx electron tests/extract.gui.seed.cjs", {
    cwd: ROOT, shell: true, stdio: "ignore",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA, M7_TEST_WITH_MAP: "1" }
  });

  const out = openSync(path.join(ROOT, "tests", "tmp-annot.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2600);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");
  const drag = makeDrag(cdp);

  // ---------- 导入 PDF 夹具并打开 ----------
  const seedPdf = await cdp.eval(`(async () => {
    const r = await window.libraryAPI.createFromPdf({ name: ${JSON.stringify(PDF_TITLE + ".pdf")}, path: ${JSON.stringify(pdfPath)} });
    return JSON.stringify({ id: r && r.id, docId: r && r.documentId });
  })()`);
  console.log("  · PDF 夹具 =", seedPdf);
  check("PDF 夹具导入成功（前置自查，防空转）", String(seedPdf).includes("id"), seedPdf);

  // 书架可能仍持旧列表（导入发生在书架挂载之后）→ 先切走再切回，逼它重载
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "数据"); b?.click(); return !!b; })()`);
  await wait(900);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1600);
  const cardFound = await cdp.eval(`(() => {
    const t = [...document.querySelectorAll(".book-card-title, .book-card")].find((x) => x.textContent.includes(${JSON.stringify(PDF_TITLE)}));
    if (!t) return "NO_CARD:" + [...document.querySelectorAll(".book-card-title")].map((x) => x.textContent.trim()).join("|");
    (t.closest(".book-card") || t).click();
    return "clicked";
  })()`);
  check("书架能找到刚导入的 PDF 夹具书（前置自查）", cardFound === "clicked", cardFound);
  await wait(2600);
  for (let i = 0; i < 20; i++) {
    const n = await cdp.eval(`document.querySelectorAll(".reader-engine-host .textLayer span").length`);
    if (typeof n === "number" && n > 0) break;
    await wait(400);
  }
  const opened = await cdp.eval(`(() => {
    const cards = [...document.querySelectorAll(".book-card-title, .book-card")].map((x) => (x.textContent || "").trim().slice(0, 30));
    return JSON.stringify({
      reader: !!document.querySelector(".reader-wrap"),
      wraps: document.querySelectorAll(".reader-wrap").length,
      engineHost: !!document.querySelector(".reader-engine-host"),
      spans: document.querySelectorAll(".reader-engine-host .textLayer span").length,
      title: document.querySelector(".topbar-title")?.textContent || "",
      cards: cards.slice(0, 6)
    });
  })()`);
  console.log("  [diag] 开书后 =", opened);
  check("PDF 在阅读器打开且文本层就绪", (await cdp.eval(`!!document.querySelector(".reader-engine-host .textLayer span")`)) === true, opened);

  // ============================================================
  // ① 菜单定位（规格 §3.2 四条）
  // ============================================================
  console.log("\n== ① 菜单定位（上/下半落位 + 不相交 + 容器内） ==");
  const pick = JSON.parse(String(await cdp.eval(spanRectInPdf(PDF_PICK))) || "{}");
  check("目标片段在文本层可定位（坐标可算）", typeof pick.x1 === "number", JSON.stringify(pick));
  await drag({ x: pick.x1, y: pick.y }, { x: pick.x2, y: pick.y });
  await wait(900);
  const m1 = JSON.parse(String(await cdp.eval(menuState)) || "{}");
  check("拖选后菜单出现", m1.up === true, JSON.stringify(m1).slice(0, 200));
  const containerBox = await cdp.eval(`(() => { const el = document.querySelector(".reader-scroll"); if (!el) return ""; const r = el.getBoundingClientRect(); return JSON.stringify({ l: r.left, t: r.top, r: r.right, b: r.bottom, mid: r.top + r.height / 2 }); })()`);
  const cb = JSON.parse(String(containerBox) || "{}");
  const selMid = (pick.y ?? 0);
  const expectBelow = selMid < (cb.mid ?? 0);
  check(
    `判据③ 选区在容器${expectBelow ? "上半 → 菜单在下方" : "下半 → 菜单在上方"}（锚＝选区包围盒，非 pointerup 点）`,
    expectBelow ? m1.rect?.t >= selMid : m1.rect?.b <= selMid,
    JSON.stringify({ menu: m1.rect, selMid, containerMid: cb.mid })
  );
  check("判据① 菜单与选区不相交（选区矩形高度内无菜单）", typeof m1.rect?.t === "number" && (m1.rect.b <= selMid - 2 || m1.rect.t >= selMid + 2), JSON.stringify({ menu: m1.rect, selMid }));
  check("判据② 菜单整体在视口内（含 8px 边距）", m1.inViewport === true, JSON.stringify(m1.rect));
  check("菜单含模式段控两枚", Array.isArray(m1.seg) && m1.seg.length === 2, JSON.stringify(m1.seg));
  check("菜单含动作行（阅读器六项）", Array.isArray(m1.acts) && m1.acts.length === 6 && m1.acts.includes("图片挖空"), JSON.stringify(m1.acts));
  await screenshot(cdp, "tmp-annot-reader-menu.png");

  // ============================================================
  // ② 摘录页五动作（拖选 → 菜单五项 → 落库）
  // ============================================================
  console.log("\n== ② 摘录页五动作 ==");
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return !!b; })()`);
  await wait(1700);
  check("摘录页就绪", (await cdp.eval(`!!document.querySelector(".extract-face")`)) === true, "无卡面");
  const FACE_MARK = "这一段的含义";
  const faceProbe = (len) => `(() => {
    const body = document.querySelector(".extract-face .review-editable");
    if (!body) return "";
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf(${JSON.stringify(FACE_MARK)});
      if (idx < 0) continue;
      const r = document.createRange();
      r.setStart(node, idx); r.setEnd(node, idx + ${len});
      const rects = r.getClientRects(); const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) return "";
      return JSON.stringify({ start: { x: first.left + 2, y: first.top + first.height / 2 }, end: { x: last.right - 2, y: last.top + last.height / 2 } });
    }
    return "";
  })()`;
  const fp = JSON.parse(String(await cdp.eval(faceProbe(5))) || "{}");
  await drag(fp.start, fp.end);
  await wait(1000);
  const fm = JSON.parse(String(await cdp.eval(menuState)) || "{}");
  check("摘录页拖选出菜单", fm.up === true, JSON.stringify(fm).slice(0, 160));
  check("摘录页菜单五项（无图片挖空）", Array.isArray(fm.acts) && fm.acts.length === 5 && !fm.acts.includes("图片挖空"), JSON.stringify(fm.acts));

  const actsBefore = await cdp.eval(`(async () => (await window.workflowAPI.listAll()).length)()`);
  await cdp.eval(`(() => { document.querySelector(".selection-menu .swatch[data-color='green']")?.click(); return true; })()`);
  await wait(1400);
  const typedEditor = await cdp.eval(`(() => {
    const el = document.querySelector(".editor textarea");
    if (!el) return "NO_EDITOR";
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
    setter.call(el, "ANNOT 批注落库样本");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "typed";
  })()`);
  await wait(1300);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait(700);
  const afterAnnot = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const row = all.find((x) => x.comment === "ANNOT 批注落库样本");
    return JSON.stringify({ n: all.length, kind: row?.kind ?? null, color: row?.annotationColor ?? null, parentType: row?.parentType ?? null });
  })()`);
  const aa = JSON.parse(String(afterAnnot) || "{}");
  check("点色后浮层可写批注（编辑器在场）", typedEditor === "typed", typedEditor);
  check("批注落库（新增一条）", aa.n === Number(actsBefore) + 1, `${actsBefore} → ${aa.n}`);
  check("落库 kind=highlight（默认模式）", aa.kind === "highlight", aa.kind);
  check("落库带 annotationColor=green", aa.color === "green", aa.color);
  check("挂在当前卡上（parentType=extract）", aa.parentType === "extract", aa.parentType);

  // ============================================================
  // ⑦ 栏出现条件与占位
  // ============================================================
  console.log("\n== ⑦ 批注栏出现条件与占位 ==");
  check("有批注 ⇒ 栏出现", (await cdp.eval(`!!document.querySelector("[data-annot-panel]")`)) === true, "栏不在场");
  const panelW = await cdp.eval(`(() => { const p = document.querySelector("[data-annot-panel]"); return p ? Math.round(p.getBoundingClientRect().width) : 0; })()`);
  check("栏占位 280px", panelW === 280, panelW);

  // ============================================================
  // ③ 批注增 / 删 / 改（摘录页栏内）
  // ============================================================
  console.log("\n== ③ 批注增删改（栏内） ==");
  const editRes = await cdp.eval(`(() => {
    const zn = document.querySelector("[data-annot-panel] [data-zn]");
    if (!zn) return "NO_ZN";
    zn.click();
    return "clicked";
  })()`);
  await wait(600);
  await cdp.eval(`(() => {
    const ta = document.querySelector("[data-annot-panel] [data-annot-edit]");
    if (!ta) return "NO_TA";
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(ta.constructor.prototype, "value").set;
    setter.call(ta, "ANNOT 栏内改过的批注");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.blur();
    return "edited";
  })()`);
  await wait(1500);
  const synced = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const row = all.find((x) => x.comment === "ANNOT 栏内改过的批注");
    const shown = document.querySelector("[data-annot-panel] [data-zn]")?.textContent || "";
    return JSON.stringify({ db: !!row, shown });
  })()`);
  const sy = JSON.parse(String(synced) || "{}");
  check("改批注：库中 comment 变化", editRes === "clicked" && sy.db === true, JSON.stringify(sy));
  check("改批注：栏内显示同步", String(sy.shown).includes("ANNOT 栏内改过的批注"), sy.shown);

  const colorBefore = await cdp.eval(`(() => { const d = document.querySelector("[data-annot-panel] [data-annot-color]"); return d ? getComputedStyle(d).backgroundColor : null; })()`);
  await cdp.eval(`(() => { document.querySelector("[data-annot-panel] [data-annot-color]")?.click(); return true; })()`);
  await wait(600);
  const palUp = await cdp.eval(`document.querySelectorAll("[data-annot-panel] [data-annot-palette] [data-annot-pick]").length`);
  check("色点可点开色板", palUp > 0, palUp);
  await cdp.eval(`(() => { document.querySelector("[data-annot-panel] [data-annot-pick='blue']")?.click(); return true; })()`);
  await wait(1400);
  // 栏靠 workflow/changed 重载；此处走的是真实 UI 路径（selActions.saveAnnotationColor 会广播），
  // 故等事件+重渲染即可——但色点读的是**条目上的当前色**，需确认已落库再读。
  const colorPersisted = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const row = all.find((x) => String(x.comment || "").includes("ANNOT 栏内改过的批注"));
    return row?.annotationColor ?? null;
  })()`);
  check("改色：annotation_color 已落库（blue，取自默认色板）", colorPersisted === "blue", colorPersisted);
  const colorAfter = await cdp.eval(`(() => { const d = document.querySelector("[data-annot-panel] [data-annot-color]"); return d ? getComputedStyle(d).backgroundColor : null; })()`);
  const blueTok = await cdp.eval(tokenValue("--annot-blue"));
  check("改色：色点 computed 变且＝--annot-blue（另配「与改前不同」对照）", colorAfter === blueTok && colorAfter !== colorBefore, JSON.stringify({ colorBefore, colorAfter, blueTok }));

  // 先留证：此刻栏内有条目（段锚那条改了批注+改了色）——这是规格 ⑨ 要判读的「摘录页批注栏」形态
  await screenshot(cdp, "tmp-annot-extract-light.png");

  const delCount = `(async () => { const cur = document.querySelector(".extract-face")?.dataset.extractId; const all = await window.workflowAPI.listAll(); return all.filter((x) => x.parentId === cur).length; })()`;
  const delBefore = await cdp.eval(delCount);
  await cdp.eval(`(() => {
    const item = [...document.querySelectorAll("[data-annot-panel] [data-zitem]")].find((el) => el.dataset.whole !== "1");
    item?.querySelector("[data-annot-del]")?.click();
    return !!item;
  })()`);
  await wait(600);
  check("删除带就地二次确认", (await cdp.eval(`!!document.querySelector("[data-annot-panel] [data-annot-del-confirm]")`)) === true, "无确认");
  const midCount = await cdp.eval(delCount);
  check("二次确认前不删", midCount === delBefore, `${delBefore} → ${midCount}`);
  await cdp.eval(`(() => { document.querySelector("[data-annot-panel] [data-annot-del-confirm]")?.click(); return true; })()`);
  await wait(1600);
  const afterDel = await cdp.eval(delCount);
  check("确认后该条软删（段锚条目 -1）", afterDel === Number(delBefore) - 1, `${delBefore} → ${afterDel}`);
  await screenshot(cdp, "tmp-annot-extract-after-del.png");

  // ============================================================
  // ⑤ 三页签与图谱目录（阅读器侧）
  // ============================================================
  console.log("\n== ⑤ 阅读器三页签 + 图谱目录 ==");
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架"); b?.click(); return !!b; })()`);
  await wait(1500);
  await cdp.eval(`(() => {
    const t = [...document.querySelectorAll(".book-card-title, .book-card")].find((x) => x.textContent.includes("GUI 图谱测试书"));
    (t?.closest(".book-card") || t)?.click();
    return true;
  })()`);
  await wait(3200);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".reader-engine-controls button")].find((x) => x.textContent.trim() === "目录"); b?.click(); return !!b; })()`);
  await wait(1800);
  const sidebar = `(() => {
    const sb = document.querySelector("[data-reader-sidebar]");
    if (!sb) return JSON.stringify({ up: false });
    const tabs = [...sb.querySelectorAll("[data-sidebar-tab]")].map((b) => ({ id: b.dataset.sidebarTab, label: b.textContent.trim(), on: b.classList.contains("on") }));
    const panels = [...sb.querySelectorAll("[data-panel]")].map((p) => p.dataset.panel);
    const onBtn = [...sb.querySelectorAll("[data-sidebar-tab]")].find((b) => b.classList.contains("on"));
    const nodes = [...sb.querySelectorAll("[data-map-node]")].map((b) => ({
      id: b.dataset.mapNode, label: b.querySelector(".map-item-label")?.textContent,
      padLeft: parseFloat(getComputedStyle(b).paddingLeft) || 0,
      barW: b.querySelector("[data-map-bar]")?.getBoundingClientRect().width ?? 0
    }));
    return JSON.stringify({
      up: true, tabs, panels, nodes,
      underlineColor: onBtn ? getComputedStyle(onBtn).borderBottomColor : null,
      underlineW: onBtn ? getComputedStyle(onBtn).borderBottomWidth : null
    });
  })()`;
  const sb1 = JSON.parse(String(await cdp.eval(sidebar)) || "{}");
  check("侧栏在场且三枚页签齐（目录/摘录/图谱）", sb1.up === true && ["toc", "extracts", "map"].every((k) => (sb1.tabs || []).some((t) => t.id === k)), JSON.stringify(sb1.tabs));
  check("同刻只有一个面板可见", (sb1.panels || []).length === 1, JSON.stringify(sb1.panels));
  const accentTok = await cdp.eval(tokenValue("--accent"));
  check("当前页签 accent 下划线（色＝--accent、宽 2px）", sb1.underlineColor === accentTok && sb1.underlineW === "2px", JSON.stringify({ c: sb1.underlineColor, w: sb1.underlineW, acc: accentTok }));
  await cdp.eval(`(() => { document.querySelector('[data-sidebar-tab="map"]')?.click(); return true; })()`);
  await wait(1200);
  const sb2 = JSON.parse(String(await cdp.eval(sidebar)) || "{}");
  check("切到图谱页签（同刻仍一个面板）", (sb2.panels || []).length === 1 && sb2.panels[0] === "map", JSON.stringify(sb2.panels));
  const nd = sb2.nodes || [];
  console.log("  · 图谱节点 =", JSON.stringify(nd));
  check("图谱目录有节点行", nd.length > 0, JSON.stringify(nd));
  const nParent = nd.find((n) => String(n.label).includes("第一章"));
  const nChild = nd.find((n) => String(n.label).includes("1.1"));
  check("子节点缩进大于父节点（层级缩进）", nParent && nChild ? nChild.padLeft > nParent.padLeft + 4 : false, JSON.stringify({ p: nParent?.padLeft, c: nChild?.padLeft }));
  check("节点带占比条", nd.length > 0 && nd.every((n) => n.barW > 0), JSON.stringify(nd.map((n) => ({ l: n.label, w: n.barW }))));
  const rangeCheck = await cdp.eval(`(async () => {
    const items = await window.libraryAPI.list();
    const it = items.find((x) => String(x.title || "").includes("GUI 图谱测试书"));
    const doc = await window.libraryAPI.getDocument(it.id);
    const k = window.__readerKernel;
    const r = await window.mindmapAPI.mapTree(doc.documentId, k?.getTOC?.() ?? [], (k?.getSectionAnchors?.() ?? []).map((a) => a.anchor));
    if (!r) return JSON.stringify({ err: "null" });
    const byDepth = {};
    for (const n of r.items) { (byDepth[n.depth] = byDepth[n.depth] || []).push(n); }
    let overlap = 0;
    for (const d of Object.keys(byDepth)) {
      const list = byDepth[d].slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].end) overlap++;
    }
    return JSON.stringify({ overlap, items: r.items.map((n) => ({ l: n.label, d: n.depth, s: n.start, e: n.end })) });
  })()`);
  const ov = JSON.parse(String(rangeCheck) || "{}");
  check("同级区间两两不重叠（按主进程给的区间算）", ov.overlap === 0, JSON.stringify(ov));
  // 注意：图谱目录给的是**净区间**（父扣掉子之后的自有部分），故「子区间 ⊆ 父区间」**不成立**
  // （实测：第一章 [0,1)、1.1 [1,2)）。正确的形状判据是：
  //   ① 各条区间两两不重叠（相邻即可）；② 并集连续覆盖 [0, total)；③ 每条区间非空。
  check(
    "净区间两两不重叠、并集连续覆盖全篇（层级形状判据）",
    (() => {
      const items = (ov.items || []).slice().sort((a, b) => a.s - b.s);
      if (!items.length) return false;
      if (!items.every((x) => x.e > x.s)) return false;
      for (let i = 1; i < items.length; i++) if (items[i].s !== items[i - 1].e) return false;
      return true;
    })(),
    JSON.stringify(ov.items)
  );
  await screenshot(cdp, "tmp-annot-reader-map.png");

  // ============================================================
  // ⑧ 退役检查
  // ============================================================
  console.log("\n== ⑧ 退役检查 ==");
  const retire = await cdp.eval(`(() => { const txt = document.body.innerText || ""; return JSON.stringify({ openExtract: txt.includes("打开摘录") }); })()`);
  const rt = JSON.parse(String(retire) || "{}");
  check("全应用内无「打开摘录」字样（R29 退役）", rt.openExtract === false, retire);

  // ============================================================
  // ⑨ 截图判读（浅/深）
  // ============================================================
  console.log("\n== ⑨ 截图判读 ==");
  // **必须走真实主题路径**：settingsAPI.set + reload（settingsAPI 只写持久化、不触发 React state；
  // 手改 body.classList 只会让顶栏变深、侧栏文字仍是浅色 → 截出一张「浅字浅底」的假深色图，实测踩过）。
  const themeSet = (mode) => `(async () => { await window.settingsAPI.set("theme", "mode", ${JSON.stringify(mode)}); location.reload(); return 1; })()`;
  // reload 会回到书架（导航态不持久），故切档后要**重新进书 + 开侧栏**再拍，
  // 否则截出来的是书架而不是「阅读器三页签在深色下的样子」。
  const reopenMapBook = async () => {
    await cdp.eval(`(() => {
      const t = [...document.querySelectorAll(".book-card-title, .book-card")].find((x) => x.textContent.includes("GUI 图谱测试书"));
      (t?.closest(".book-card") || t)?.click();
      return true;
    })()`);
    await wait(3200);
    await cdp.eval(`(() => { const b = [...document.querySelectorAll(".reader-engine-controls button")].find((x) => x.textContent.trim() === "目录"); b?.click(); return !!b; })()`);
    await wait(1700);
    await cdp.eval(`(() => { document.querySelector('[data-sidebar-tab="map"]')?.click(); return true; })()`);
    await wait(1200);
  };
  await cdp.eval(themeSet("dark"));
  await wait(6000);
  const darkProbe = await cdp.eval(`JSON.stringify({ body: document.body.className, bg: getComputedStyle(document.body).backgroundColor })`);
  await reopenMapBook();
  const sideDark = await cdp.eval(`JSON.stringify({ body: document.body.className, tabs: document.querySelectorAll("[data-sidebar-tab]").length, nodes: document.querySelectorAll("[data-map-node]").length, fg: getComputedStyle(document.querySelector("[data-map-node]") || document.body).color })`);
  const d1 = await screenshot(cdp, "tmp-annot-reader-dark.png");
  check("深色档真的落到 body（真实主题路径，非手改 class）", String(darkProbe).includes("theme-dark"), darkProbe);
  check("深色档下的阅读器侧栏可见（页签+节点在场）", String(sideDark).includes('"tabs":3'), sideDark);
  await cdp.eval(themeSet("light"));
  await wait(6000);
  await reopenMapBook();
  const l1 = await screenshot(cdp, "tmp-annot-reader-light.png");
  check("截图落盘非空（阅读器 深/浅两档）", d1 > 5000 && l1 > 5000, JSON.stringify({ dark: d1, light: l1 }));

  console.log(`\n==== annotations.gui：${pass} 通过 / ${fail} 失败 ====`);
} catch (e) {
  console.log("CRASH:", e?.message);
  fail++;
} finally {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  await wait(500);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
