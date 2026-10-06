// 手动图片挖空编辑器 GUI 端到端（D98/v48.57 R1；CDP 驱动真实应用，自启自关；node tests/occlusion-editor.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-occl-userdata（先清空，全新库，§7.3 同 m8 口径），
// 测试数据一律 FSRSTEST 前缀，进程结束前软删。
// 覆盖（设计 docs/design/IMAGE-OCCLUSION-MANUAL-EDITOR-D98.md §6 + 修订记录 R1）：
//   点击图片直进编辑器（无聚焦中间层）→ 三形状连续框选 → 区域列表删除/撤销
//   → 逐块拆卡落库（每卡自带单遮罩、答案=区域 label）→ 整图一卡（自定义题面）
//   → 共遮呈现（regionScope:"shared" + cardOrd）→ 裁剪应用后遮罩重映射 → AI 挖空 stub 导入 stagger。
// db/协议层由 tests/m5.test.cjs 锁定；阅读器入口冒烟由 tests/reader.engine.mjs 4c–4e 覆盖。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9235";
const MOCK_PORT = 9341;
const USER_DATA = path.join(ROOT, "tests", "tmp-occl-userdata");

// ---------- AI mock（同 d91-d92 口径：测试进程内 OpenAI 兼容 SSE，按 system 分流）----------
// window.aiAPI 是 contextBridge 冻结对象（页面内赋值静默失效），故在网络边缘打桩：
// 渲染层 → IPC → 主进程 chatStream → fetch 全真实代码路径。
const mock = { open: false, answers: {} };
const mockServer = http.createServer((req, res) => {
  if (req.method !== "POST" || !String(req.url).includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let sys = "";
    try {
      const j = JSON.parse(body);
      sys = String(j.messages?.[0]?.content || "");
    } catch { /* 视作 other */ }
    const full = String(sys.includes("遮挡") ? mock.answers.occlusion ?? "" : "");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const parts = full.match(/[\s\S]{1,40}/g) || [];
    let i = 0;
    mock.open = true;
    const timer = setInterval(() => {
      if (i < parts.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      } else {
        clearInterval(timer);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        mock.open = false;
      }
    }, 120);
    res.on("close", () => { clearInterval(timer); mock.open = false; });
  });
});
const mockListen = new Promise((r) => mockServer.listen(MOCK_PORT, "127.0.0.1", r));

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;
let cdp = null;
let seededBookId = null;
let origReaderSettings = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
    try {
      const t = (await listTargets()).find((x) => (x.url || "").includes("index.html"));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        });
        return {
          ws,
          eval: async (expr) => {
            const r = await new Promise((res) => {
              const mid = ++id;
              pending.set(mid, res);
              ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
            });
            if (r.result?.exceptionDetails) throw new Error("eval fail: " + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
            return r.result?.result?.value;
          },
          shot: async (file) => {
            const s = await new Promise((res) => {
              const mid = ++id;
              pending.set(mid, res);
              ws.send(JSON.stringify({ id: mid, method: "Page.captureScreenshot", params: { format: "png" } }));
            });
            fs.writeFileSync(file, Buffer.from(s.result.data, "base64"));
          }
        };
      }
    } catch {
      /* retry */
    }
    await wait(1500);
  }
  throw new Error("CDP 连接失败（应用未启动？）");
}

// 夹具 EPUB（与 reader.engine 同构：3 章 + 小图）
async function buildFixtureB64() {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:occl-fixture</dc:identifier><dc:title>挖空编辑验证</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/></spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a></li></ol></nav></body></html>`);
  const paras = Array.from({ length: 20 }, (_, i) => `<p>第1章第${i + 1}段，挖空编辑端到端验证文本。</p>`).join("");
  zip.file("OEBPS/pic.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAAoElEQVR42u3RAQ0AAAjDsDtCNjbvA5pMwZrM6nIWABZgARZgARZgAQYswAIswAIswAIMWIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgAQYswAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AAA7YAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAX4VwX94ghClYrF/gAAAABJRU5ErkJggg==", "base64"));
  zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章</h1>${paras}<p><img src="pic.png" alt="挖空夹具图" width="160" height="90"/></p></body></html>`);
  return zip.generateAsync({ type: "base64" });
}

const clickByText = (txt, sel = "button") => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(txt)}));
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;
const clickSidebarToggle = () => `(() => { const b = document.querySelector("[data-reader-sidebar-toggle]"); if (!b) return "no btn"; b.click(); return "clicked"; })()`;

/** 点击正文图片 → 编辑器直开（D98/R1：无聚焦中间层） */
async function openEditor() {
  await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const img = entry.doc.querySelector('img[alt="挖空夹具图"]');
    if (!img) return "no img";
    img.dispatchEvent(new entry.doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    return "clicked";
  })()`);
  await wait(900);
}
/** 在编辑器画布上按百分比拖矩形（遮罩/裁剪共用；椭圆=圆心拖） */
const dragOn = (fx0, fy0, fx1, fy1) => `(() => {
  const canvas = document.querySelector('[data-testid="occl-canvas"]');
  if (!canvas) return "no canvas";
  const r = canvas.getBoundingClientRect();
  const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(${fx0}, ${fy0}) }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...at(${(fx0 + fx1) / 2}, ${(fy0 + fy1) / 2}) }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...at(${fx1}, ${fy1}) }));
  return "drawn";
})()`;
/** 多边形：逐点 pointerdown，末次点回起点闭合 */
const drawPolygon = (pts) => `(() => {
  const canvas = document.querySelector('[data-testid="occl-canvas"]');
  if (!canvas) return "no canvas";
  const r = canvas.getBoundingClientRect();
  const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
  for (const [fx, fy] of ${JSON.stringify(pts)}) canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(fx, fy) }));
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(${pts[0][0]}, ${pts[0][1]}) }));
  return "polygon";
})()`;
/** 填写区域列表答案（按行序） */
async function fillLabels(labels) {
  await cdp.eval(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const rows = [...document.querySelectorAll('[data-testid="occl-mask-row"] input')];
    ${JSON.stringify(labels)}.forEach((v, i) => {
      if (!rows[i]) return;
      set.call(rows[i], v);
      rows[i].dispatchEvent(new Event("input", { bubbles: true }));
    });
    return rows.length;
  })()`);
}
const editorDiag = `JSON.stringify({
  open: Boolean(document.querySelector(".occlusion-editor-layer")),
  masks: document.querySelectorAll(".occlusion-editor-badge").length,
  rows: document.querySelectorAll('[data-testid="occl-mask-row"]').length,
  save: (document.querySelector('[data-testid="occl-save"]') || {}).textContent || "",
  saveDisabled: (document.querySelector('[data-testid="occl-save"]') || {}).disabled,
  ai: (document.querySelector('[data-testid="occl-ai"]') || {}).textContent || ""
})`;
async function saveEditor() {
  await cdp.eval(`document.querySelector('[data-testid="occl-save"]').click()`);
  await wait(1600);
}
async function occlCards() {
  return cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    return all
      .filter((x) => x.cardType === "imageOcclusion")
      .sort((a, b) => a.cardOrd - b.cardOrd)
      .map((c) => ({
        ord: c.cardOrd,
        front: c.frontMarkdown,
        back: c.backMarkdown,
        rects: (c.occlusionJson.rects || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
        nRects: (c.occlusionJson.rects || []).length,
        nShapes: (c.occlusionJson.shapes || []).length,
        kinds: (c.occlusionJson.shapes || []).map((s) => s.kind).join("/"),
        scope: c.occlusionJson.regionScope || "",
        asset: String((c.occlusionJson || {}).assetPath || ""),
        sib: c.siblingKey || ""
      }));
  })()`);
}

// ---------- 主流程 ----------
try {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留进程则忽略 */
  }
  await wait(800);
  await mockListen;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const out = openSync(path.join(ROOT, "tests", "occlusion-editor.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  cdp = await cdpConnect();
  await cdp.eval("1");
  await wait(1500);

  // 0. 造数 + 固定阅读设置 + 打开书
  const b64 = await buildFixtureB64();
  const seeded = await cdp.eval(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
    const book = await window.libraryAPI.createFromEpub({
      title: "FSRSTEST 挖空编辑验证书", markdown: "# 第一章\\n\\n第一章正文。",
      toc: [{ label: "第一章", href: "ch1.xhtml" }],
      coverDataUrl: null, epubData: bytes, sourceName: "FSRSTEST"
    });
    return book && book.id;
  })()`);
  seededBookId = seeded;
  check("0 造数（夹具书）", Boolean(seeded), String(seeded));
  origReaderSettings = await cdp.eval(`window.settingsAPI.get("app", "readerSettings")`);
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);
  await cdp.eval(`location.reload()`);
  await wait(2500);
  await cdp.eval(clickByText("FSRSTEST 挖空编辑验证书", ".book-card"));
  await wait(3000);
  const engineUp = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
  check("0.5 进入引擎视图", engineUp);

  // A. 点击图片直进编辑器（R1：无聚焦中间层；空画布、保存钮禁用）
  await openEditor();
  let ed = JSON.parse(await cdp.eval(editorDiag));
  const noFocus = await cdp.eval(`!document.querySelector(".image-focus-layer")`);
  check("A 点击图片直进编辑器（无聚焦层，空画布保存禁用）", ed.open && noFocus && ed.masks === 0 && ed.saveDisabled && ed.save.includes("创建卡片"), JSON.stringify(ed) + " noFocus=" + noFocus);
  await cdp.shot(path.join(ROOT, "tests", "tmp-occl-a-open.png"));

  // B. 三形状连续框选：矩形 / 椭圆（圆心拖） / 多边形（点回起点闭合）
  await cdp.eval(dragOn(0.2, 0.3, 0.65, 0.75));
  await wait(250);
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-ellipse"]').click()`);
  await cdp.eval(dragOn(0.05, 0.05, 0.18, 0.2));
  await wait(250);
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-polygon"]').click()`);
  await cdp.eval(drawPolygon([[0.7, 0.8], [0.92, 0.82], [0.85, 0.95]]));
  await wait(400);
  ed = JSON.parse(await cdp.eval(editorDiag));
  check("B 三形状连续框选（3 块 → 拆 3 卡）", ed.masks === 3 && ed.rows === 3 && ed.save.includes("创建 3 张卡片"), JSON.stringify(ed));

  // C. 列表删除第 3 块 → Ctrl+Z 撤销回来
  await cdp.eval(`document.querySelectorAll('[data-testid="occl-row-del"]')[2].click()`);
  await wait(250);
  const afterDel = JSON.parse(await cdp.eval(editorDiag));
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);
  const afterUndo = JSON.parse(await cdp.eval(editorDiag));
  check("C 删除→撤销（3→2→3）", afterDel.masks === 2 && afterUndo.masks === 3, JSON.stringify({ afterDel, afterUndo }));

  // C2. R2 撤销建模：画新遮罩本身可撤销（3→4→3）
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-rect"]').click()`);
  await cdp.eval(dragOn(0.35, 0.05, 0.55, 0.18));
  await wait(250);
  const afterDraw = JSON.parse(await cdp.eval(editorDiag));
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);
  const afterDrawUndo = JSON.parse(await cdp.eval(editorDiag));
  check("C2 画新遮罩→撤销（3→4→3）", afterDraw.masks === 4 && afterDrawUndo.masks === 3, JSON.stringify({ afterDraw, afterDrawUndo }));

  // C3. R2/R5 多边形点击级撤销：空白处点击＝起笔加点（一次点击＝一个撤销单元）
  //     坐标须落在空白区（R5 起点击已有遮罩＝选中而非加点）
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-polygon"]').click()`);
  await cdp.eval(dragOn(0.45, 0.12, 0.45, 0.12)); // 零距离按下＝一次点击加点（顶部空白带）
  await wait(250);
  // R3 补：圆点必须渲染为 HTML 层元素且有实际尺寸（曾误置于 SVG 命名空间内不渲染）
  const dotsAfter = await cdp.eval(`(() => {
    const d = document.querySelector(".occl-dot");
    return JSON.stringify({ n: document.querySelectorAll(".occl-dot").length, html: d instanceof HTMLSpanElement, w: d ? Math.round(d.getBoundingClientRect().width) : 0 });
  })()`);
  await cdp.shot(path.join(ROOT, "tests", "tmp-occl-c3-dot.png"));
  const afterC3 = JSON.parse(dotsAfter);
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);
  const dotsAfterUndo = await cdp.eval(`document.querySelectorAll(".occl-dot").length`);
  check("C3 多边形点击级撤销（草稿点 1→0，HTML 层渲染 12px 起点圆点）", afterC3.n === 1 && afterC3.html === true && afterC3.w === 12 && dotsAfterUndo === 0, dotsAfter + "->" + dotsAfterUndo);

  // C4. R3 右键闭环：顶部空白带 3 点 → 画布右键＝从当前点直连初始点收口（不点回起点）
  await cdp.eval(`(() => {
    const canvas = document.querySelector('[data-testid="occl-canvas"]');
    const at = (fx, fy) => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    for (const [fx, fy] of [[0.5, 0.06], [0.62, 0.12], [0.52, 0.22]]) canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(fx, fy) }));
    return "clicked3";
  })()`);
  await wait(250);
  // R4：草稿段全部虚线——2 段草稿连线 + 1 条跟随橡皮筋
  const rubberCount = await cdp.eval(`document.querySelectorAll('[data-testid="occl-canvas"] .occlusion-rubber').length`);
  check("C4a 草稿段虚线（2 段连线 + 1 跟随线）", rubberCount === 3, "count=" + rubberCount);
  await cdp.eval(`(() => {
    const canvas = document.querySelector('[data-testid="occl-canvas"]');
    canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return "rclick";
  })()`);
  await wait(300);
  const afterRclick = JSON.parse(await cdp.eval(editorDiag));
  const rubberAfter = await cdp.eval(`document.querySelectorAll('[data-testid="occl-canvas"] .occlusion-rubber').length`);
  check("C4 右键闭环（3 点 → 第 4 块遮罩，草稿虚线清空）", afterRclick.masks === 4 && afterRclick.rows === 4 && rubberAfter === 0, JSON.stringify(afterRclick) + " rubber=" + rubberAfter);
  // 回到 3 块基线，后续 D 场景断言不变
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);

  // C5. R5 拖拽引擎：左下空白画第 4 块 → 按住拖动（增量跟手，多点 move）→ 撤销回位
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-rect"]').click()`);
  await cdp.eval(dragOn(0.05, 0.25, 0.3, 0.45));
  await wait(250);

  await cdp.eval(`(() => {
    const canvas = document.querySelector('[data-testid="occl-canvas"]');
    const r = canvas.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(0.17, 0.35) }));
    for (const [fx, fy] of [[0.22, 0.38], [0.32, 0.44], [0.42, 0.5]]) canvas.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...at(fx, fy) }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...at(0.42, 0.5) }));
    return "dragged";
  })()`);
  await wait(250);
  const movedX = await cdp.eval(`document.querySelector(".occlusion-editor-mask.selected")?.getAttribute("x")`);
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);
  const undoneX = await cdp.eval(`document.querySelector(".occlusion-editor-mask.selected")?.getAttribute("x")`);
  check("C5 遮罩拖动移动（x 5→30）+ 撤销回位（→5）", Math.abs(Number(movedX) - 30) < 1.5 && Math.abs(Number(undoneX) - 5) < 1.5, movedX + "->" + undoneX);

  // C5b. R5 多边形工具点已有遮罩＝选中并出顶点圆点（不再误起新草稿）
  await cdp.eval(`document.querySelector('[data-testid="occl-tool-polygon"]').click()`);
  await cdp.eval(dragOn(0.8, 0.87, 0.8, 0.87)); // 零距离点击＝选中多边形遮罩
  await wait(250);
  const selDots = await cdp.eval(`document.querySelectorAll(".occl-dot").length`);
  const masksAfterSel = JSON.parse(await cdp.eval(editorDiag)).masks;
  check("C5b 多边形工具点击已有遮罩＝选中（3 顶点圆点，不新建草稿）", selDots === 3 && masksAfterSel === 4, selDots + " dots, masks=" + masksAfterSel);

  // C5c. R7 多边形拖动＝绝对平移（顶点不累计放大）：grab0=(80,87)，位移 (62,66)-(80,87)=(-18,-21)
  //      → bbox (70,80,22,15) 平移至 (52,59)，首顶点 (70,80)→(52,59)
  await cdp.eval(`(() => {
    const canvas = document.querySelector('[data-testid="occl-canvas"]');
    const r = canvas.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(0.8, 0.87) }));
    for (const [fx, fy] of [[0.7, 0.75], [0.62, 0.66]]) canvas.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...at(fx, fy) }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...at(0.62, 0.66) }));
    return "dragged";
  })()`);
  await wait(250);
  const polyPts = await cdp.eval(`document.querySelector(".occlusion-editor-mask.selected")?.getAttribute("points")`);
  const polyOk = Boolean(polyPts && polyPts.startsWith("52,59") && polyPts.includes("74,61") && polyPts.includes("67,74"));
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(250);
  const polyPtsBack = await cdp.eval(`document.querySelector(".occlusion-editor-mask.selected")?.getAttribute("points")`);
  check("C5c 多边形拖动＝绝对平移（首顶点 70,80→52,59，不放大）+ 撤销回位", polyOk && Boolean(polyPtsBack && polyPtsBack.startsWith("70,80")), pts(polyPts, polyPtsBack));
  function pts(a, b) { return "pts=" + a + " | back=" + b; }

  // 删除第 4 块，恢复 D 场景基线
  await cdp.eval(`document.querySelectorAll('[data-testid="occl-row-del"]')[3].click()`);
  await wait(250);

  // D. 逐块拆卡：填答案 → 保存 → 断言三卡
  await fillLabels(["FSRSTEST 海马体", "FSRSTEST 杏仁核", "FSRSTEST 前额叶"]);
  await saveEditor();
  const closedD = await cdp.eval(`!document.querySelector(".occlusion-editor-layer")`);
  const cardsD = await occlCards();
  check(
    "D 逐块拆卡落库（3 卡：各带单形状、答案=区域 label、同图同源、无 regionScope）",
    closedD && cardsD.length === 3 &&
      cardsD.every((c, i) =>
        c.ord === i && c.nRects === 1 && c.nShapes === 1 &&
        /^bookasset:/.test(c.asset) && c.sib.startsWith("img:") && !c.scope &&
        c.front === "图中遮挡区域对应的是什么？"
      ) &&
      cardsD[0].back === "FSRSTEST 海马体" && cardsD[1].back === "FSRSTEST 杏仁核" && cardsD[2].back === "FSRSTEST 前额叶",
    "closed=" + closedD + " | " + JSON.stringify(cardsD)
  );

  // E. 整图一卡 + 自定义题面：重进 → 画两块 → 切整图 → 保存 1 卡（全遮罩同遮同答）
  await openEditor();
  await cdp.eval(dragOn(0.1, 0.1, 0.4, 0.35));
  await wait(250);
  await cdp.eval(dragOn(0.5, 0.5, 0.85, 0.9));
  await wait(250);
  await cdp.eval(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    const ta = document.querySelector('[data-testid="occl-front"]');
    set.call(ta, "FSRSTEST 图片题面");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return 1;
  })()`);
  await cdp.eval(`document.querySelector('[data-testid="occl-mode-single"]').click()`);
  await wait(250);
  ed = JSON.parse(await cdp.eval(editorDiag));
  check("E1 整图一卡模式（保存钮显示 1 张）", ed.masks === 2 && ed.save.includes("创建 1 张卡片"), JSON.stringify(ed));
  await saveEditor();
  const cardsE = await occlCards().then((cs) => cs.filter((c) => c.front === "FSRSTEST 图片题面"));
  check(
    "E2 整图一卡落库（1 卡全遮罩 + 自定义题面 + 同遮同答）",
    cardsE.length === 1 && cardsE[0].nRects === 2 && cardsE[0].nShapes === 2 && cardsE[0].ord === 0 && !cardsE[0].scope,
    JSON.stringify(cardsE)
  );

  // F. 共遮呈现：重进 → 画两块 → 勾选共遮 → 保存（每卡全图区域 + regionScope:"shared"）
  await openEditor();
  await cdp.eval(dragOn(0.1, 0.1, 0.4, 0.35));
  await wait(250);
  await cdp.eval(dragOn(0.5, 0.5, 0.85, 0.9));
  await wait(250);
  await cdp.eval(`document.querySelector('[data-testid="occl-shared"]').click()`);
  await wait(150);
  await saveEditor();
  const cardsF = await occlCards().then((cs) => cs.filter((c) => c.scope === "shared"));
  check(
    "F 共遮呈现落库（2 卡共享全图区域 + cardOrd 单区 accent）",
    cardsF.length === 2 && cardsF.every((c, i) => c.ord === i && c.nRects === 2 && c.nShapes === 2 && c.scope === "shared"),
    JSON.stringify(cardsF)
  );

  // G. R1 裁剪：画一块遮罩（x 10-35，label 唯一）→ 裁剪保留左半（0-50）→ 遮罩重映射（x 20-70）→ 保存
  await openEditor();
  await cdp.eval(dragOn(0.1, 0.2, 0.35, 0.6));
  await wait(250);
  await fillLabels(["FSRSTEST 裁剪区"]);
  await cdp.eval(`document.querySelector('[data-testid="occl-crop"]').click()`);
  await wait(200);
  await cdp.eval(dragOn(0.0, 0.0, 0.5, 1.0));
  await wait(250);
  const cropBtn = await cdp.eval(`(() => { const b = document.querySelector('[data-testid="occl-crop-apply"]'); if (!b) return "no btn"; return "armed disabled=" + b.disabled; })()`);
  await cdp.eval(`document.querySelector('[data-testid="occl-crop-apply"]').click()`);
  await wait(600);
  ed = JSON.parse(await cdp.eval(editorDiag));
  check("G1 裁剪应用（遮罩重映射保留 1 块，编辑器回遮罩模式）", String(cropBtn) === "armed disabled=false" && ed.masks === 1 && ed.rows === 1, cropBtn + " | " + JSON.stringify(ed));
  await saveEditor();
  const cardsG = await occlCards().then((cs) => cs.filter((c) => c.back === "FSRSTEST 裁剪区"));
  check(
    "G2 裁剪后遮罩坐标重映射（x 10→20、w 25→50）且裁剪图入 assets",
    cardsG.length === 1 && cardsG[0].nRects === 1 && Math.abs(cardsG[0].rects[0].x - 20) < 1.5 && Math.abs(cardsG[0].rects[0].y - 20) < 1.5 && Math.abs(cardsG[0].rects[0].w - 50) < 1.5 && Math.abs(cardsG[0].rects[0].h - 40) < 1.5 && /^bookasset:/.test(cardsG[0].asset),
    JSON.stringify(cardsG)
  );

  // H. R1 AI 挖空建议层：AI 配置指向本地 mock（网络边缘打桩）→ AI 挖空 → regions 逐块导入为可编辑遮罩。
  //    注意 mock 答案须带 cards 数组——extractJson 校验 cards 在场（真实 card-occlusion 输出 cards+regions）。
  await openEditor();
  await cdp.eval(`(async () => JSON.stringify(await window.aiAPI.setConfig({ preset: "custom", baseUrl: "http://127.0.0.1:${MOCK_PORT}/v1", model: "mock-model", apiKey: "GUI-TEST-KEY" })))()`);
  mock.answers.occlusion = JSON.stringify({
    cards: [],
    regions: [
      { ord: 0, label: "FSRSTEST AI-1", x: 10, y: 10, w: 20, h: 20 },
      { ord: 1, label: "FSRSTEST AI-2", x: 40, y: 40, w: 20, h: 20 }
    ]
  });
  await cdp.eval(`document.querySelector('[data-testid="occl-ai"]').click()`);
  await wait(3000);
  ed = JSON.parse(await cdp.eval(editorDiag));
  const aiLabels = await cdp.eval(`[...document.querySelectorAll('[data-testid="occl-mask-row"] input')].map(i => i.value).join("/")`);
  check("H AI 建议导入（2 块带 label，保存钮 2 张）", ed.masks === 2 && ed.rows === 2 && ed.save.includes("创建 2 张卡片") && aiLabels === "FSRSTEST AI-1/FSRSTEST AI-2", JSON.stringify(ed) + " labels=" + aiLabels);
  // 撤销整批
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))`);
  await wait(300);
  const afterAiUndo = JSON.parse(await cdp.eval(editorDiag));
  check("H2 AI 批量导入可一次撤销", afterAiUndo.masks === 0, JSON.stringify(afterAiUndo));
  delete mock.answers.occlusion;
  await cdp.shot(path.join(ROOT, "tests", "tmp-occl-f-done.png"));

  // I. R8 回归：复习面不出现卡体内「显示答案」死按钮（翻面只走底栏一枚）
  await cdp.eval(`document.querySelector('[data-testid="occl-close"]').click()`);
  await wait(400);
  await cdp.eval(clickByText("复习", ".nav-item"));
  await wait(2200);
  const revealScan = await cdp.eval(`JSON.stringify({
    total: [...document.querySelectorAll("button")].filter(b => b.textContent.trim() === "显示答案").length,
    inBar: Boolean([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "显示答案" && b.closest(".stage-bar"))),
    barY: (() => { const b = document.querySelector(".stage-bar"); return b ? Math.round(b.getBoundingClientRect().y) : null; })(),
    hasCardImg: Boolean(document.querySelector(".occlusion-stage .occlusion-img"))
  })`);
  const scan = JSON.parse(revealScan);
  check(
    "I 复习面仅底栏一枚「显示答案」（卡体死按钮已移除，底栏位置固定）",
    scan.total === 1 && scan.inBar && typeof scan.barY === "number" && scan.hasCardImg,
    revealScan
  );

  // G. 清理（卡片 + 书 + 阅读设置恢复）
  const cleaned = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    for (const c of all) {
      const blob = (c.frontMarkdown || "") + (c.backMarkdown || "") + (c.noteText || "");
      if (blob.includes("FSRSTEST")) await window.cardsAPI.remove(c.id);
    }
    await window.libraryAPI.remove(${JSON.stringify(seeded)});
    return "cleaned";
  })()`);
  if (origReaderSettings) {
    await cdp.eval(`window.settingsAPI.set("app", "readerSettings", ${JSON.stringify(origReaderSettings)})`);
  }
  check("Z 测试数据清理", cleaned === "cleaned");
} catch (err) {
  check("套件异常", false, err && (err.stack || err.message));
} finally {
  try {
    if (cdp) {
      await cdp.eval(`(async () => {
        const all = await window.cardsAPI.listAll();
        for (const c of all) {
          const blob = (c.frontMarkdown || "") + (c.backMarkdown || "") + (c.noteText || "");
          if (blob.includes("FSRSTEST")) await window.cardsAPI.remove(c.id);
        }
        return "cleaned";
      })()`);
    }
  } catch {
    /* 连接已断就算了 */
  }
  await wait(800);
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  process.exit(fail === 0 ? 0 : 1);
}
