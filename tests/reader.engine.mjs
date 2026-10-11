// 阅读内核 L2 应用端到端（v20）：CDP 驱动真实应用（--remote-debugging-port=9224，脚本自启自关）。
// 只证明业务流安全（L1 已证 adapter 契约）：文件书/粘贴书/摘录进引擎、目录、外链拦截、
// 选区制卡 contextRef 四层（cfi/chapterIndex/anchorText/readerEngineVersion）、进度落库、跳原文。
// 测试数据一律 FSRSTEST 前缀；测试摘要摘录在进程结束后经 sql.js 软删（应用已关闭，§7.1.8）。
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(decodeURIComponent(path.dirname(new URL(import.meta.url).pathname)).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const PORT = "9224";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 160) });
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
};

// ---------- CDP 帮手 ----------
async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
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
            writeFileSync(file, Buffer.from(s.result.data, "base64"));
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

// ---------- 夹具 EPUB（与 L1 同构：3 章 + 内链 + 外链） ----------
async function buildFixtureB64() {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:l2-fixture</dc:identifier><dc:title>引擎验证</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-09-10T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a></li><li><a href="ch2.xhtml">第二章</a></li><li><a href="ch3.xhtml">第三章</a></li></ol></nav></body></html>`);
  const paras = (n, marker) => Array.from({ length: 24 }, (_, i) => `<p>第${n}章第${i + 1}段，阅读内核端到端验证文本。</p>`).join("") + `<p>${marker}</p>`;
  zip.file("OEBPS/pic.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAAoElEQVR42u3RAQ0AAAjDsDtCNjbvA5pMwZrM6nIWABZgARZgARZgAQYswAIswAIswAIMWIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgAQYswAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AAA7YAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAX4VwX94ghClYrF/gAAAABJRU5ErkJggg==", "base64"));
  zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章</h1>${paras(1, "第一章独有锚甲")}<p><img src="pic.png" alt="引擎夹具图" width="160" height="90"/></p><p>带<a href="probe://l2-ext">外部链接</a>与<a href="ch2.xhtml">内部跳转</a>。</p></body></html>`);
  zip.file("OEBPS/ch2.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章</h1>${paras(2, "第二章独有锚乙")}</body></html>`);
  zip.file("OEBPS/ch3.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第三章</title></head><body><h1>第三章</h1>${paras(3, "第三章独有锚丙")}</body></html>`);
  return zip.generateAsync({ type: "base64" });
}

const clickByText = (txt, sel = "button") => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(txt)}));
  if (!el) return "not found";
  el.click(); return "clicked";
})()`;
// v48.44（D84）：侧栏开关钮是「展开/收起」两态文案（D83 起），按 data 钩子点击而非文字匹配
// （此前 clickByText("侧栏", …) 在 D83 改两态文案后永远 not found——2a/2b/#7 空转失败）。
const clickSidebarToggle = () => `(() => { const b = document.querySelector("[data-reader-sidebar-toggle]"); if (!b) return "no btn"; b.click(); return "clicked"; })()`;

// ---------- 主流程 ----------
let electron = null;
let cdp = null;        // finally 兜底清理要用（v48.45/D85：异常路径不得再泄漏 FSRSTEST 书）
let seededIds = null; // 第 0 步拿到的两本书 id
let origReaderSettings = null;
try {
  // 清场：残留实例会占用 CDP 端口（Windows 下 node 退出不会带走 electron 子进程）
  try {
    (await import("node:child_process")).execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留进程则忽略 */
  }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "reader.engine.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false
  });
  cdp = await cdpConnect();
  await cdp.eval("1");
  await wait(1500);

  // 0. 造数：文件书 + 粘贴书
  const b64 = await buildFixtureB64();
  const seeded = await cdp.eval(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
    const md = "# 第一章\\n\\n第一章正文。\\n\\n# 第二章\\n\\n第二章正文。\\n\\n# 第三章\\n\\n第三章正文。";
    const book = await window.libraryAPI.createFromEpub({
      title: "FSRSTEST 引擎验证书", markdown: md,
      toc: [{ label: "第一章", href: "ch1.xhtml" }, { label: "第二章", href: "ch2.xhtml" }, { label: "第三章", href: "ch3.xhtml" }],
      coverDataUrl: null, epubData: bytes, sourceName: "FSRSTEST"
    });
    const paste = await window.libraryAPI.createFromPaste("FSRSTEST 粘贴引擎验证书", md);
    return { book: book && book.id, paste: paste && paste.id };
  })()`);
  seededIds = seeded;
  check("0 造数（文件书+粘贴书）", Boolean(seeded?.book && seeded?.paste), JSON.stringify(seeded));

  // 0.5 固定阅读设置为已知态（纸白+滚动），并在结束时恢复用户原设置
  origReaderSettings = await cdp.eval(`window.settingsAPI.get("app", "readerSettings")`);
  const origSettings = origReaderSettings;
  await cdp.eval(`window.settingsAPI.set("app", "readerSettings", { mode: { flow: "scrolled" }, appearance: { theme: "paper" } })`);

  // 1. 打开文件书 → 引擎视图
  await cdp.eval(`location.reload()`);
  await wait(2500);
  await cdp.eval(clickByText("FSRSTEST 引擎验证书", ".book-card"));
  await wait(3000);
  const engineUp = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
  check("1 文件书进入 foliate 引擎视图", engineUp);
  await cdp.shot("tmp-l2-1-engine.png");

  // 2. 目录侧栏
  await cdp.eval(clickSidebarToggle());
  await wait(600);
  const tocCount = await cdp.eval(`document.querySelectorAll(".reader-toc-item").length`);
  check("2a 目录侧栏渲染 3 章", tocCount >= 3, "n=" + tocCount);
  await cdp.eval(clickByText("第二章", ".reader-toc-item"));
  await wait(800);
  const tocClosed = await cdp.eval(`!document.querySelector(".reader-sidebar")`);
  check("2b 目录点击跳转并收起", tocClosed);
  await cdp.eval(clickSidebarToggle());
  await wait(400);
  await cdp.eval(clickByText("第一章", ".reader-toc-item"));
  await wait(800);

  // 2c. 翻页按钮（v20.1）：跨章节推进 + 边界
  await cdp.eval(clickByText("第一章", ".reader-toc-item"));
  await wait(800);
  await cdp.eval(clickSidebarToggle());
  await wait(400);
  const cfiBefore = await cdp.eval(`window.__readerKernel?.getCurrentLocation()?.cfi`);
  await cdp.eval(`(() => { const b = document.querySelector('.reader-engine-controls button[title*="下一页"]'); if (!b) return "no btn"; b.click(); return "clicked"; })()`);
  await wait(900);
  const cfiAfter = await cdp.eval(`window.__readerKernel?.getCurrentLocation()?.cfi`);
  check("2c 下一页按钮跨页推进（CFI 变化）", Boolean(cfiBefore && cfiAfter && cfiBefore !== cfiAfter), JSON.stringify({ b: cfiBefore && cfiBefore.slice(0, 22), a: cfiAfter && cfiAfter.slice(0, 22) }));

  // 3. 外链拦截：view 级事件注入（真实点击→事件检测已由 L1 S11 覆盖；此处零副作用）
  const extRes = await cdp.eval(`(() => {
    const view = document.querySelector(".reader-engine-host foliate-view");
    if (!view) return { err: "no view" };
    window.__extLog = [];
    window.__kernelLinkLog = [];
    window.windowAPI.openExternal = async (u) => { window.__extLog.push(u); return true; };
    window.__readerKernel.on("link", (i) => window.__kernelLinkLog.push(i));
    const ev = new CustomEvent("external-link", { cancelable: true, detail: { a: null, href_: "probe://l2-ext" } });
    const notPrevented = view.dispatchEvent(ev);
    return { notPrevented };
  })()`);
  await wait(500);
  const extLog = await cdp.eval(`window.__extLog`);
  const kernelLinkLog = await cdp.eval(`window.__kernelLinkLog`);
  check(
    "3 外链全链路：事件→adapter 拦截(preventDefault)→Kernel 事件→壳层",
    extRes && extRes.notPrevented === false && Array.isArray(kernelLinkLog) && kernelLinkLog.some((l) => l.internal === false && String(l.href).includes("l2-ext")),
    JSON.stringify({ notPrevented: extRes && extRes.notPrevented, kernelLinkLog })
  );

  // 4. 选区 → 制卡 → contextRef 四层
  const selOk = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const doc = entry.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf("第一章独有锚甲");
      if (idx >= 0) {
        const range = doc.createRange();
        range.setStart(node, idx); range.setEnd(node, idx + 7);
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
  await wait(600);
  const menuUp = await cdp.eval(`Boolean(document.querySelector(".selection-menu"))`);
  check("4a 划选出菜单（引擎选区服务）", selOk === true && menuUp, "sel=" + selOk);
  await cdp.shot("tmp-l2-4-menu.png");
  await cdp.eval(clickByText("制卡", "[data-sel-act]"));
  await wait(600);
  // v48.54-56（§J P0）：手动制卡字段已从 <textarea> 迁移为 Milkdown 编辑器（.ProseMirror contenteditable），
  // 旧「native setter + input 事件」取填法落空（tas[0] undefined → Illegal invocation，套件中断）。
  // 此处对齐新 DOM：聚焦 ProseMirror 根后 execCommand insertText（PM 经 beforeinput 事务接住）。
  const frontSet = await cdp.eval(`(() => {
    const eds = [...document.querySelectorAll("[data-card-dock] .ProseMirror")];
    if (eds.length < 2) return "editors=" + eds.length;
    eds[0].focus();
    document.execCommand("insertText", false, "FSRSTEST 引擎制卡题面");
    eds[1].focus();
    document.execCommand("insertText", false, "引擎制卡答案");
    return "filled=" + eds.length;
  })()`);
  await wait(300); // React 把 onChange 镜像反映到 canSave/按钮 disabled 态（无等待时点击落在禁用钮上）
  await cdp.eval(clickByText("制卡", "[data-card-dock] .wb-foot .btn-primary"));
  await wait(1000);
  const cardOk = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find(x => (x.frontMarkdown || "").includes("FSRSTEST 引擎制卡题面"));
    if (!c) return null;
    return { cfi: c.contextRef && c.contextRef.cfi, chapterIndex: c.contextRef && c.contextRef.chapterIndex, anchorText: c.contextRef && c.contextRef.anchorText, v: c.contextRef && c.contextRef.readerEngineVersion };
  })()`);
  check("4b 制卡 contextRef 四层（cfi/章索引/锚文本/引擎版本）", Boolean(cardOk && cardOk.cfi && cardOk.v), JSON.stringify(cardOk) + " | fill=" + frontSet);
  await cdp.eval(`(() => { document.querySelector("[data-card-dock] [data-dock-close]")?.click(); return 1; })()`);
  await wait(300);

  // 4c. D98/R1：正文图片点击直进挖空编辑器（图片聚焦层退役；空画布、保存钮禁用）
  const imgClick = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const img = entry.doc.querySelector('img[alt="引擎夹具图"]');
    if (!img) return "no img";
    img.dispatchEvent(new entry.doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    return "clicked";
  })()`);
  await wait(900);
  const edState = await cdp.eval(`JSON.stringify({
    editor: Boolean(document.querySelector(".occlusion-editor-layer")),
    noFocus: !document.querySelector(".image-focus-layer"),
    tools: [...document.querySelectorAll(".occl-seg .occl-tool")].map(e => e.textContent.trim()),
    masks: document.querySelectorAll(".occlusion-editor-badge").length,
    save: (document.querySelector('[data-testid="occl-save"]') || {}).textContent || "",
    saveDisabled: (document.querySelector('[data-testid="occl-save"]') || {}).disabled
  })`);
  const ed = JSON.parse(edState);
  check(
    "4c 图片点击直进挖空编辑器（无聚焦中间层 + 三工具 + 空画布保存禁用）",
    imgClick === "clicked" && ed.editor && ed.noFocus && ed.tools.length === 3 && ed.masks === 0 && ed.saveDisabled && ed.save.includes("创建卡片"),
    imgClick + " | " + edState
  );
  await cdp.shot("tmp-l2-4c-occl-editor.png");
  // 编辑器画布按百分比拖矩形（4d 复用）
  const drawEd = (x0, y0, x1, y1) => `(() => {
    const canvas = document.querySelector('[data-testid="occl-canvas"]');
    if (!canvas) return "no canvas";
    const r = canvas.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(${x0}, ${y0}) }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...at(${(x0 + x1) / 2}, ${(y0 + y1) / 2}) }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...at(${x1}, ${y1}) }));
    return "drawn";
  })()`;

  // 4d. 编辑器内连续框选两块遮罩（右栏列表同步 2 行）
  const d1 = await cdp.eval(drawEd(0.55, 0.05, 0.9, 0.25));
  await wait(250);
  const d2 = await cdp.eval(drawEd(0.05, 0.55, 0.45, 0.9));
  await wait(250);
  const rows2 = await cdp.eval(`document.querySelectorAll('[data-testid="occl-mask-row"]').length`);
  check("4d 编辑器内连续框选两块遮罩（列表 2 行）", d1 === "drawn" && d2 === "drawn" && rows2 === 2, d1 + " | " + d2 + " rows=" + rows2);

  // 4e. 填答案 → 批量落库断言：逐块拆卡两卡——各带单遮罩（rects/shapes 1、shapeOrd=cardOrd）、同图同源、无 regionScope
  await cdp.eval(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const rows = [...document.querySelectorAll('[data-testid="occl-mask-row"] input')];
    rows.forEach((input, i) => {
      set.call(input, "FSRSTEST 区域" + (i === 0 ? "一" : "二"));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return rows.length;
  })()`);
  await wait(200);
  await cdp.eval(`document.querySelector('[data-testid="occl-save"]').click()`);
  await wait(1500);
  const editorClosed = await cdp.eval(`!document.querySelector(".occlusion-editor-layer")`);
  const occCards = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    return all
      .filter((x) => x.cardType === "imageOcclusion" && (x.backMarkdown || "").startsWith("FSRSTEST 区域"))
      .sort((a, b) => a.cardOrd - b.cardOrd)
      .map((c) => ({
        ord: c.cardOrd,
        back: c.backMarkdown,
        rects: (c.occlusionJson.rects || []).length,
        shapes: (c.occlusionJson.shapes || []).length,
        shapeOrd: c.occlusionJson.shapes && c.occlusionJson.shapes[0] ? c.occlusionJson.shapes[0].ord : null,
        asset: String((c.occlusionJson || {}).assetPath || ""),
        sib: c.siblingKey || "",
        scope: c.occlusionJson.regionScope || ""
      }));
  })()`);
  check(
    "4e 挖空编辑批量落库（逐块拆卡两卡：各带单遮罩 + 同图同源）",
    editorClosed && occCards.length === 2 &&
      occCards.every((c, i) =>
        c.ord === i && c.rects === 1 && c.shapes === 1 && c.shapeOrd === i &&
        /^bookasset:/.test(c.asset) && c.sib.startsWith("img:") && !c.scope
      ) && occCards[0].back === "FSRSTEST 区域一" && occCards[1].back === "FSRSTEST 区域二",
    "closed=" + editorClosed + " | " + JSON.stringify(occCards)
  );

  // 4h. 填空题手动制卡（v25/F12 修复回归）：挖空标记必须写进 frontMarkdown——
  // 此前存的是未转换原文，复习端 parseCloze 找不到 ord，挖空从不遮蔽
  const z1 = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const entry = (k && k.__getContents ? k.__getContents() : []).find(x => x.doc);
    if (!entry) return "no doc";
    const doc = entry.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf("第一章独有锚甲");
      if (idx >= 0) {
        const range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 7);
        const sel = doc.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const frame = doc.defaultView.frameElement;
        const p = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
        node.parentElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: p.left + 200, clientY: p.top + 120 }));
        return "selected";
      }
    }
    return "marker not found";
  })()`);
  await wait(700);
  const z2 = await cdp.eval(`(() => {
    const btns = [...document.querySelectorAll("[data-sel-act]")];
    const t = btns.find(b => b.textContent.trim() === "制卡");
    if (!t) return "no menu: " + JSON.stringify(btns.map(b => b.textContent.trim()));
    t.click();
    return "menu-clicked";
  })()`);
  await wait(700);
  const z3 = await cdp.eval(`(() => {
    const tab = [...document.querySelectorAll("[data-card-dock] .wb-tabs button")].find(b => b.textContent.includes("填空题"));
    if (!tab) return "no tab";
    tab.click();
    return "tab-clicked";
  })()`);
  await wait(300);
  const z4 = await cdp.eval(`(() => {
    const ed = document.querySelector("[data-card-dock] .ProseMirror");
    if (!ed) return "no editor (dock=" + Boolean(document.querySelector("[data-card-dock]")) + ")";
    ed.focus();
    document.execCommand("insertText", false, "FSRSTEST 锚甲出现在**第一章**");
    return "filled";
  })()`);
  await wait(400);
  const z5 = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("[data-card-dock] .btn-primary")].find(x => x.textContent.includes("制卡"));
    if (!b) return "no create btn";
    if (b.disabled) return "create disabled";
    b.click();
    return "submitted";
  })()`);
  await wait(1300);
  const clozeCard = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find(x => (x.frontMarkdown || "").includes("FSRSTEST 锚甲"));
    return c ? { fm: c.frontMarkdown, note: c.noteText, type: c.cardType } : null;
  })()`);
  check(
    "4h 填空题挖空标记落库 frontMarkdown（F12 修复）",
    Boolean(clozeCard && String(clozeCard.fm).includes("{{c1::第一章}}")),
    [z1, z2, z3, z4, z5, JSON.stringify(clozeCard)].join(" | ")
  );

  // 5. 进度落库（relocate 防抖 700ms）
  const prog = await cdp.eval(`(async () => {
    const doc = await window.libraryAPI.getDocument(${JSON.stringify(seeded.book)});
    return doc.progressJson ? JSON.parse(doc.progressJson) : null;
  })()`);
  check("5 引擎进度落库（cfi+fraction）", Boolean(prog && prog.cfi != null && typeof prog.fraction === "number"), JSON.stringify(prog && { f: prog.fraction, c: prog.cfi && prog.cfi.slice(0, 20) }));

  // 5b. D2/§7（Task 7）：侧栏开合＝布局变更——不写进度、位置不漂；用户翻页照常写（正对照）
  const readProg = `(async () => { const doc = await window.libraryAPI.getDocument(${JSON.stringify(seeded.book)}); return doc.progressJson || ""; })()`;
  const readLoc = `JSON.stringify(window.__readerKernel?.getCurrentLocation?.() || {})`;
  const secOf = (cfi) => String(cfi || "").split("!")[0];
  await wait(1400); // 先让此前的用户动作把防抖进度落定，再把基线记下来
  const progBefore = String(await cdp.eval(readProg));
  const locBefore = JSON.parse(String(await cdp.eval(readLoc)) || "{}");
  const progPoll = `(async () => { const doc = await window.libraryAPI.getDocument(${JSON.stringify(seeded.book)}); return doc.progressJson || ""; })()`;
  await cdp.eval(`(() => { document.querySelector("[data-reader-sidebar-toggle]")?.click(); return 1; })()`);
  // 轮询记录首次变化出现在何时（自证：若真写了进度，能说出它在窗口内的哪一刻）
  let firstChangeMs = -1;
  for (let i = 0; i < 12; i++) {
    await wait(400);
    if (String(await cdp.eval(progPoll)) !== progBefore) { firstChangeMs = (i + 1) * 400; break; }
  }
  await wait(600);
  const progOpen = String(await cdp.eval(readProg));
  const locOpen = JSON.parse(String(await cdp.eval(readLoc)) || "{}");
  await cdp.eval(`(() => { document.querySelector("[data-reader-sidebar-toggle]")?.click(); return 1; })()`);
  await wait(2300);
  const progClosed = String(await cdp.eval(readProg));
  const locClosed = JSON.parse(String(await cdp.eval(readLoc)) || "{}");
  check(
    "5b 开合侧栏不写进度（布局变更 ≠ 用户翻页）",
    progBefore !== "" && progOpen === progBefore && progClosed === progBefore,
    JSON.stringify({ firstChangeMs, before: progBefore.slice(0, 70), open: progOpen.slice(0, 70), closed: progClosed.slice(0, 70) })
  );
  check(
    "5b2 开合侧栏后位置不漂（同章 CFI；CFI 仍可解析）",
    secOf(locBefore.cfi) === secOf(locClosed.cfi) && secOf(locOpen.cfi) === secOf(locBefore.cfi) && Boolean(locClosed.cfi),
    JSON.stringify({ before: locBefore.cfi, open: locOpen.cfi, closed: locClosed.cfi })
  );
  await cdp.eval(`(() => { const b = document.querySelector('.reader-engine-controls button[title*="下一页"]'); b?.click(); return !!b; })()`);
  await wait(2200);
  const progAfterTurn = String(await cdp.eval(readProg));
  check(
    "5b3 用户翻页照常写进度（正对照：守卫不吞真实导航）",
    progAfterTurn !== "" && progAfterTurn !== progClosed,
    JSON.stringify({ closed: progClosed.slice(0, 70), after: progAfterTurn.slice(0, 70) })
  );

  // 6. 复习卡跳转原文（存 cfi → 引擎直达；另造一张卡走文本搜索兜底路径不重复验证）
  await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    const c = all.find(x => (x.frontMarkdown || "").includes("FSRSTEST 引擎制卡题面"));
    await window.cardsAPI.update({ ...c, fsrs: { ...c.fsrs, due: 946684800000 } });
    return "due-set";
  })()`);
  await cdp.eval(clickByText("复习", ".nav-item"));
  await wait(2500);
  const jumpDiag = await cdp.eval(`JSON.stringify({
    hasCard: document.body.textContent.includes("FSRSTEST 引擎制卡题面"),
    count: (document.querySelector(".review-count") || {}).textContent || "",
    jumpBtn: Boolean(document.querySelector(".review-jump"))
  })`);
  console.log("[diag 6] " + jumpDiag);
  const jumpShown = Boolean(JSON.parse(jumpDiag).jumpBtn);
  if (jumpShown) {
    await cdp.eval(clickByText("跳转原文"));
    await wait(2500);
    const backInEngine = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
    check("6 复习卡跳转原文回到引擎视图", backInEngine);
  } else {
    check("6 复习卡跳转原文回到引擎视图", false, "复习页未出现测试卡（队列被其他到期卡占先？）");
  }

  // 7. 粘贴书合成进引擎
  await cdp.eval(clickByText("书架", ".nav-item"));
  await wait(1200);
  await cdp.eval(clickByText("FSRSTEST 粘贴引擎验证书", ".book-card"));
  await wait(3000);
  const pasteEngine = await cdp.eval(`Boolean(document.querySelector(".reader-engine-host foliate-view"))`);
  // v48.53（D93）着陆自愈回归 + syn-3（§9.4 空首章清理）：该粘贴书正文以一级标题开头——
  // syn-3 起合成不再产生空壳章、首屏直落正文；D93 自愈保留为异构格式/真实 EPUB 空节兜底
  const pasteFirstPaint = await cdp.eval(`(() => {
    const k = window.__readerKernel;
    const texts = (k && k.__getContents ? k.__getContents() : []).map((e) => (e.doc?.body?.textContent || "").trim()).filter(Boolean);
    return JSON.stringify({ visible: texts.length > 0, head: (texts[0] || "").slice(0, 20) });
  })()`);
  const firstPaint = JSON.parse(String(pasteFirstPaint) || "{}");
  check("7pre 粘贴书首屏正文可见（空壳章自愈，D93）", firstPaint.visible === true, pasteFirstPaint);
  await cdp.eval(clickSidebarToggle());
  await wait(500);
  const pasteToc = await cdp.eval(`document.querySelectorAll(".reader-toc-item").length`);
  check("7 粘贴书合成 EPUB 进引擎（目录 3 章）", pasteEngine && pasteToc >= 3, "toc=" + pasteToc);
  await cdp.shot("tmp-l2-7-paste.png");

  // 7b. 暗夜主题联动软件夜间模式（v20.1；主题下拉按 title 精确定位，栏内另有阅读模式下拉）
  await cdp.eval(clickSidebarToggle());
  await wait(400);
  // D5-B：模式/主题/缩放收进「阅读设置」弹出组——先开组，组内的 Dropdown 照旧
  // 点击与断言分两次 —— React 重渲染是异步的，同一个 eval 里「点完立刻查」必然读到旧 DOM
  await cdp.eval(`(() => { document.querySelector('[data-tool-menu-btn="settings"]')?.click(); return 1; })()`);
  await wait(500);
  const settingsOpen = await cdp.eval(`!!document.querySelector('[data-tool-menu-panel="settings"]')`);
  check("7bpre 阅读设置弹出组可开（工具栏 B 方案）", settingsOpen === true, String(settingsOpen));
  await cdp.eval(`(() => { document.querySelector('.reader-engine-controls .dd-btn[title="阅读主题"]')?.click(); return 1; })()`);
  await wait(300);
  await cdp.eval(`(() => { [...document.querySelectorAll(".dd-item")].find(e => e.textContent.trim() === "暗夜")?.click(); return 1; })()`);
  await wait(600);
  const darkLinked = await cdp.eval(`(async () => JSON.stringify({
    bodyDark: document.body.classList.contains("theme-dark"),
    bg: getComputedStyle(document.querySelector(".reader-scroll-engine")).backgroundColor,
    settings: await window.settingsAPI.get("app", "readerSettings"),
    ddLabel: document.querySelector('.reader-engine-controls .dd-btn[title="阅读主题"]')?.textContent.trim()
  }))()`);
  check("7b 暗夜主题联动软件夜间模式", Boolean(JSON.parse(darkLinked).bodyDark), darkLinked);
  await cdp.eval(clickByText("纸白", '.reader-engine-controls .dd-btn[title="阅读主题"]'));
  await wait(200);
  await cdp.eval(clickByText("纸白", ".dd-item"));
  await wait(400);

  // 7c. 阅读模式下拉：滚动→分页→对开三档可切换并落库（滚动/分页/对开收起进上级菜单）
  await cdp.eval(`(() => { document.querySelector('.reader-engine-controls .dd-btn[title="阅读模式"]')?.click(); return 1; })()`);
  await wait(300);
  await cdp.eval(clickByText("对开", ".dd-item"));
  await wait(800);
  const spreadSaved = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "readerSettings")))()`);
  check("7c 阅读模式下拉切对开并落库", (() => { try { const s = JSON.parse(spreadSaved); return s?.mode?.flow === "paged" && s?.mode?.spread === true; } catch { return false; } })(), spreadSaved);
  await cdp.eval(`(() => { document.querySelector('.reader-engine-controls .dd-btn[title="阅读模式"]')?.click(); return 1; })()`);
  await wait(300);
  await cdp.eval(clickByText("滚动", ".dd-item"));
  await wait(800);

  // 8. 清理（卡片+两本书 API 软删；摘要摘录留给进程外 sql.js 清理——本测试未创建摘录）
  const cleaned = await cdp.eval(`(async () => {
    const all = await window.cardsAPI.listAll();
    for (const c of all) {
      const blob = (c.frontMarkdown || "") + (c.backMarkdown || "") + (c.noteText || "");
      if (blob.includes("FSRSTEST")) await window.cardsAPI.remove(c.id);
    }
    await window.libraryAPI.remove(${JSON.stringify(seeded.book)});
    await window.libraryAPI.remove(${JSON.stringify(seeded.paste)});
    if (${JSON.stringify(origSettings)}) await window.settingsAPI.set("app", "readerSettings", ${JSON.stringify(origSettings)});
    return "cleaned";
  })()`);
  check("8 测试数据清理", cleaned === "cleaned");
} catch (err) {
  check("套件异常", false, err && (err.stack || err.message));
} finally {
  // v48.45（D85）：清理兜底——主流程第 8 步在异常路径会被整段跳过，FSRSTEST 书因此泄漏进真实书架
  //（用户实测）。这里只要 CDP 连接还活着、且拿到过两本书 id，就尽力把第 8 步再走一遍。
  try {
    if (cdp && seededIds && seededIds.book && seededIds.paste) {
      const cleaned = await cdp.eval(`(async () => {
        const all = await window.cardsAPI.listAll();
        for (const c of all) {
          const blob = (c.frontMarkdown || "") + (c.backMarkdown || "") + (c.noteText || "");
          if (blob.includes("FSRSTEST")) await window.cardsAPI.remove(c.id);
        }
        await window.libraryAPI.remove(${JSON.stringify("__BOOK__")});
        await window.libraryAPI.remove(${JSON.stringify("__PASTE__")});
        return "cleaned";
      })()`.replace('"__BOOK__"', JSON.stringify(String(seededIds.book))).replace('"__PASTE__"', JSON.stringify(String(seededIds.paste))));
      console.log("finally 清理兜底：" + cleaned);
      if (origReaderSettings) {
        try { await cdp.eval(`window.settingsAPI.set("app", "readerSettings", ${JSON.stringify(origReaderSettings)})`); } catch { /* 已断开就算了 */ }
      }
    } else {
      console.log("finally 清理兜底：CDP/造数 id 不可得，跳过（请用 tests/fsrstest.cleanup.cjs 回收）");
    }
  } catch (e) {
    console.log("finally 清理兜底失败：" + (e && e.message));
  }
  await new Promise((r) => setTimeout(r, 800));
  try {
    const { execSync } = await import("node:child_process");
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  console.log(`\n==== SUMMARY ${results.filter((r) => r.ok).length}/${results.length} ====`);
  for (const r of results) if (!r.ok) console.log("FAILED: " + r.name + " | " + r.detail);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
