// PDF 内核契约测试驱动（v28，L1 级）：在隐藏 BrowserWindow 页面里执行，经 esbuild 打包为 IIFE。
// 覆盖：打开 fixture PDF → 大纲 → 文本层选区取页码 → relocate → goTo(pageIndex) → search 往返 → next/prev 边界。
import { createPdfKernel } from "../src/lib/reader/pdf/adapter";
// 测试 bundle 下 CSS 以文本打进包（loader:text + url-text 插件复用 ?url 通道），运行时注入 <style>。
// 生产构建走 Vite 原生 CSS 管线，此处仅测试需要。
// eslint-disable-next-line import/no-unresolved
import pdfViewerCss from "pdfjs-dist/web/pdf_viewer.css?url";

const styleEl = document.createElement("style");
styleEl.textContent = pdfViewerCss;
document.head.appendChild(styleEl);

const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 12000, label = "condition") {
  const start = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      /* keep polling */
    }
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error("waitFor timeout: " + label);
    await wait(80);
  }
}

function makeRunner(log) {
  const results = [];
  const check = (name, pass, detail = "") => {
    results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
    log((pass ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };
  check.results = results;
  return check;
}

window.__pdfTest = {
  async runPdf(bytesB64, opts = {}) {
    const log = (m) => console.log("[pdf] " + m);
    const check = makeRunner(log);
    const host = document.getElementById("host");
    host.innerHTML = "";
    // 视口必须有尺寸：PDFViewer 按容器计算页宽，0 尺寸下文本层不排版
    host.style.position = "fixed";
    host.style.inset = "0";
    const kernel = createPdfKernel(host);
    window.__pdfKernel = kernel;
    const relocates = [];
    kernel.on("relocate", (info) => {
      relocates.push({ pageIndex: info.location.pageIndex, fraction: info.fraction });
    });
    try {
      await kernel.open({ kind: "bytes", bytes: b64ToBytes(bytesB64), name: "fixture.pdf" });
      check("P1 打开 fixture PDF（3 页）", true);
    } catch (e) {
      check("P1 打开 fixture PDF（3 页）", false, String((e && e.message || e)));
      return check.results;
    }

    // 文本层就绪：等 .textLayer span 出现
    try {
      await waitFor(() => {
        const spans = host.querySelectorAll(".textLayer span");
        return spans.length > 0 ? spans.length : null;
      }, 15000, "textlayer");
      check("P2 文本层渲染（span 在场，可选词）", true);
    } catch (e) {
      check("P2 文本层渲染（span 在场，可选词）", false, String((e && e.message || e)));
    }

    // canvas 在场（版面渲染）
    check("P3 页面 canvas 渲染", host.querySelectorAll("canvas").length > 0, "canvas=" + host.querySelectorAll("canvas").length);

    // 大纲
    const toc = kernel.getTOC();
    check("P4 大纲 2 条（label 带页码后缀）", toc.length === 2 && toc[0].label === "Chapter One ·第 1 页" && toc[1].label === "Chapter Two ·第 3 页", JSON.stringify(toc.map((t) => t.label)));

    // v48 批1（M15 §4.19-4）：提取单元契约——逐页单元 + canonical 文本形态
    try {
      const anchors = kernel.getSectionAnchors ? kernel.getSectionAnchors() : [];
      check("P4a 提取单元 = 逐页（3 单元）", anchors.length === 3, JSON.stringify(anchors));
      const t0 = await kernel.getSectionText("pdfpage:0");
      check("P4b 首页取文含锚词", t0.includes("anchor-marker") || t0.includes("page one"), t0.slice(0, 60));
      const t2 = await kernel.getSectionText("pdfpage:2");
      check("P4c 第三页取文含独有词", t2.includes("third-page-unique"), t2.slice(0, 60));
      const t01 = await kernel.getSectionText("pdfpage:0", "pdfpage:2");
      check("P4d [start,end) 跨页拼接不含第三页", t01.includes("Second page") && !t01.includes("third-page-unique"), t01.slice(0, 80));
      const d1 = await kernel.getSectionText("pdfpage:1");
      const d2 = await kernel.getSectionText("pdfpage:1");
      check("P4e 重复抽取确定性", d1 === d2, "len " + d1.length + "/" + d2.length);
    } catch (e) {
      check("P4a 提取单元 = 逐页（3 单元）", false, String((e && e.message) || e));
    }

    // 选区：在文本层用 Range 选词 → getSelection 取页码
    let selOk = false;
    let selDetail = "";
    try {
      const doc = host.ownerDocument;
      const spans = [...host.querySelectorAll(".textLayer span")];
      const target = spans.find((s) => (s.textContent || "").includes(opts.marker || "anchor"));
      if (target && target.firstChild) {
        const node = target.firstChild;
        const len = (node.textContent || "").length;
        const range = doc.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(len, (opts.marker || "anchor").length));
        const wsel = window.getSelection();
        wsel?.removeAllRanges();
        wsel?.addRange(range);
        // pointerup 由壳层触发；此处直接调 getSelection
        const sel = kernel.getSelection();
        selOk = !!sel && sel.text.length > 0 && sel.pageIndex === (opts.markerPage ?? 0) && sel.anchorText.length > 0;
        selDetail = JSON.stringify(sel);
        // 几何
        const geo = kernel.getSelectionGeometry();
        selOk = selOk && !!geo;
        wsel?.removeAllRanges();
      } else {
        selDetail = "marker span not found";
      }
    } catch (e) {
      selDetail = String((e && e.message || e));
    }
    check("P5 文本层选词 → 页码锚点 + 几何", selOk, selDetail);
    kernel.deselect();

    // goTo(pageIndex)：跳第二章所在页
    const before = kernel.getCurrentLocation()?.pageIndex;
    const okGoto = await kernel.goTo({ pageIndex: opts.gotoPage ?? 1 });
    await wait(600);
    const after = kernel.getCurrentLocation()?.pageIndex;
    check("P6 goTo(pageIndex) 跳页", okGoto === true && after === (opts.gotoPage ?? 1), `before=${before} after=${after}`);

    // relocate 上报过页码
    check("P7 relocate 上报 pageIndex", relocates.some((r) => r.pageIndex === (opts.gotoPage ?? 1)), JSON.stringify(relocates.slice(-3)));

    // search：找第三页独有词
    const okSearch = await kernel.goTo({ search: opts.searchWord || "third-page-unique" });
    await wait(400);
    const searchPage = kernel.getCurrentLocation()?.pageIndex;
    check("P8 文本搜索定位到目标页", okSearch === true && searchPage === (opts.searchPage ?? 2), `page=${searchPage}`);
    const okMiss = await kernel.goTo({ search: "zzz-no-such-word-zzz" });
    check("P9 搜索无命中返回 false", okMiss === false, String(okMiss));

    // next/prev 边界
    await kernel.goTo({ pageIndex: 0 });
    const prevAtFirst = await kernel.prev();
    check("P10 首页 prev 返回 false", prevAtFirst === false, String(prevAtFirst));
    await kernel.goTo({ pageIndex: 2 });
    const nextAtLast = await kernel.next();
    check("P11 末页 next 返回 false", nextAtLast === false, String(nextAtLast));
    const okNext = await (async () => { await kernel.goTo({ pageIndex: 0 }); return kernel.next(); })();
    check("P12 首页 next 前进", okNext === true && kernel.getCurrentLocation()?.pageIndex === 1, String(okNext));

    // foliate 系目标在 PDF 内核不可达
    const cfiGoto = await kernel.goTo({ cfi: "epubcfi(/6/2)" });
    check("P13 goTo(cfi) 返回 false（PDF 系无 CFI）", cfiGoto === false, String(cfiGoto));

    // D67：侧栏注解按精确 id 导航到所属 PDF 页，不伪称有已存的页内 y 坐标。
    const hasMarkNav = typeof kernel.setDocumentMarks === "function" && typeof kernel.goToMark === "function";
    check("P13pre PDF 内核支持按标记 id 导航", hasMarkNav);
    if (!hasMarkNav) {
      check("P13a 标记 id 导航到其 PDF 页", false, "goToMark/setDocumentMarks 缺失");
      check("P13b 目标标记自算几何落在对应页内容框内", false, "goToMark 缺失");
      check("P13c 未知标记 id 返回 false 且页码不变", false, "goToMark 缺失");
      check("P13d 无 pageIndex/rects 的标记返回 false", false, "goToMark 缺失");
    } else {
      kernel.setDocumentMarks([
        { id: "pdf-mark-page-one", text: "anchor-marker", pageIndex: 0, rects: [{ x: 12, y: 20, w: 18, h: 4 }], kind: "extract" },
        { id: "pdf-mark-page-three", text: "third-page-unique", pageIndex: 2, rects: [{ x: 8, y: 26, w: 24, h: 4 }], kind: "highlight" }
      ]);
      // L1 判 **adapter 自算几何**（内联 px，参考系＝容器视口；与 adapter 的 pageContentRect 同定义）。
      // 绘制落点另依赖 theme.css 的图层定位规则，而本夹具只加载 pdf_viewer.css——那半张契约
      // 由 L2（tests/marks.gui.mjs 实测 .pdf-mark-layer 矩形）覆盖，两层合起来才是「矩形落在页内」。
      const containerEl = document.querySelector(".pdf-viewer-container");
      const pageContentFrame = (pageEl) => {
        const cs = getComputedStyle(pageEl);
        const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
        const pr = pageEl.getBoundingClientRect();
        const cr = containerEl.getBoundingClientRect();
        return { left: pr.left - cr.left + bl, top: pr.top - cr.top + bt, width: Math.max(0, pr.width - bl - br), height: Math.max(0, pr.height - bt - bb) };
      };
      const markInlineFrame = (markId, pageIdx) => {
        const el = host.querySelector('.pdf-mark-layer [data-mark-id="' + markId + '"]');
        const pageEl = window.__pdfViewerDebug?.getPageView(pageIdx)?.div;
        const vals = el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height), display: el.style.display } : null;
        const frame = pageEl ? pageContentFrame(pageEl) : null;
        const inside = !!(vals && frame && vals.display === "block" &&
          [vals.left, vals.top, vals.width, vals.height].every(Number.isFinite) &&
          vals.width > 0 && vals.height > 0 &&
          vals.left >= frame.left - 1 && vals.left + vals.width <= frame.left + frame.width + 1 &&
          vals.top >= frame.top - 1 && vals.top + vals.height <= frame.top + frame.height + 1);
        return { inside, vals, frame };
      };
      const beforeMarkNav = kernel.getCurrentLocation()?.pageIndex;
      const markNav = await kernel.goToMark("pdf-mark-page-three");
      await waitFor(() => (markInlineFrame("pdf-mark-page-three", 2).inside ? true : null), 10000, "target mark laid out on its page").catch(() => null);
      const afterMarkNav = kernel.getCurrentLocation()?.pageIndex;
      const target = markInlineFrame("pdf-mark-page-three", 2);
      // 正对照：另一页的标记同时在场（证明几何不是常量、两页参考系不同）
      const offPage = markInlineFrame("pdf-mark-page-one", 0);
      check("P13a 标记 id 导航到其 PDF 页", markNav === true && afterMarkNav === 2 && beforeMarkNav !== 2, `before=${beforeMarkNav} after=${afterMarkNav}`);
      check("P13b 目标标记自算几何落在对应页内容框内", target.inside, JSON.stringify({
        target, offPage,
        layerCount: document.querySelectorAll(".pdf-mark-layer").length,
        markCount: document.querySelectorAll(".pdf-mark-layer .reader-doc-mark").length
      }));
      const beforeMissingMark = kernel.getCurrentLocation()?.pageIndex;
      const missingMark = await kernel.goToMark("missing-mark");
      check("P13c 未知标记 id 返回 false 且页码不变", missingMark === false && kernel.getCurrentLocation()?.pageIndex === beforeMissingMark, `before=${beforeMissingMark} after=${kernel.getCurrentLocation()?.pageIndex}`);
      kernel.setDocumentMarks([{ id: "pdf-mark-no-anchor", text: "no anchor", kind: "extract" }]);
      const unlocatedMark = await kernel.goToMark("pdf-mark-no-anchor");
      check("P13d 无 pageIndex/rects 的标记返回 false", unlocatedMark === false && kernel.getCurrentLocation()?.pageIndex === beforeMissingMark, `result=${unlocatedMark} page=${kernel.getCurrentLocation()?.pageIndex}`);
    }

    // v29 缩放：applyAppearance 的 zoom 映射 currentScale/currentScaleValue
    kernel.applyAppearance({ theme: "paper", zoom: 150 });
    await wait(400);
    const scale150 = window.__pdfViewerDebug ? window.__pdfViewerDebug.currentScale : null;
    check("P15a zoom=150 → currentScale 1.5", Math.abs(Number(scale150) - 1.5) < 0.01, String(scale150));
    kernel.applyAppearance({ theme: "paper", zoom: "page-width" });
    await wait(400);
    const scalePw = window.__pdfViewerDebug ? window.__pdfViewerDebug.currentScaleValue : null;
    check("P15b zoom=page-width → currentScaleValue 切换", scalePw === "page-width", String(scalePw));

    // D2/§7（Task 7）：侧栏开合＝容器变窄（这里用 host.right 收窄模拟）。
    // 数值缩放要保「正看着的页内那一点」；fit 模式按契约只保当前页（scale 由 pdf.js 自适应）。
    const hasViewPoint = typeof kernel.captureViewPoint === "function" && typeof kernel.restoreViewPoint === "function";
    check("P16pre 内核支持视口页内锚点快照/还原", hasViewPoint);
    const cont = document.querySelector(".pdf-viewer-container");
    if (!hasViewPoint) {
      check("P16a 数值缩放：变窄后页内锚点还原（≤2px）", false, "captureViewPoint/restoreViewPoint 缺失");
      check("P16b fit 模式：保 preset 与当前页", false, "captureViewPoint/restoreViewPoint 缺失");
    } else {
      kernel.applyAppearance({ theme: "paper", zoom: 150 });
      await wait(500);
      await kernel.goTo({ pageIndex: 0 });
      await wait(600);
      cont.scrollTop = 300; // 滚到页中部，让「页内那一点」真的需要被还原
      await wait(400);
      const pt = kernel.captureViewPoint();
      const pageBefore = kernel.getCurrentLocation()?.pageIndex;
      const scrollBefore = cont.scrollTop;
      host.style.right = "300px"; // 收窄正文区（等价于右侧栏占位）
      await wait(800);
      const drifted = kernel.captureViewPoint();
      // 正对照：变窄确实把页内锚点挪走了（不还原也能过的那种断言被排除）
      const driftY = pt && drifted ? Math.abs(drifted.y - pt.y) + Math.abs(drifted.x - pt.x) : 0;
      const restored = kernel.restoreViewPoint(pt);
      await wait(400);
      const scrollAfter = cont.scrollTop;
      const pageAfter = kernel.getCurrentLocation()?.pageIndex;
      check(
        "P16a 数值缩放：变窄漂移可见，还原后页内锚点回位（≤2px）",
        drifted !== null && driftY > 2 && restored === true && Math.abs(scrollAfter - scrollBefore) <= 2 && pageAfter === pageBefore,
        JSON.stringify({ pt, drifted, driftY, scrollBefore, scrollAfter, pageBefore, pageAfter })
      );
      // fit 模式：契约＝保 preset + 当前页不变（页宽**不**强制自适应：pdf.js 只在 window resize
      // 时重算 page-width/page-fit，容器变窄/变宽不触发——实测，故这里只如实记录页宽读数）
      kernel.applyAppearance({ theme: "paper", zoom: "page-width" });
      await wait(500);
      const contNarrow = cont.getBoundingClientRect().width;
      const wFitNarrow = document.querySelector(".pdf-viewer-container .page").getBoundingClientRect().width;
      host.style.right = ""; // 放开宽度（等价于关栏）
      await wait(800);
      const contWide = cont.getBoundingClientRect().width;
      const wFitWide = document.querySelector(".pdf-viewer-container .page").getBoundingClientRect().width;
      const scaleValue = window.__pdfViewerDebug ? window.__pdfViewerDebug.currentScaleValue : null;
      const pageFit = kernel.getCurrentLocation()?.pageIndex;
      check(
        "P16b fit 模式：容器确实变宽、preset 保留、当前页不变",
        scaleValue === "page-width" && pageFit === pageBefore && Math.abs(contWide - contNarrow) > 200,
        JSON.stringify({ scaleValue, pageFit, pageBefore, contNarrow, contWide, wFitNarrow, wFitWide })
      );
    }

    kernel.destroy();
    check("P14 destroy 后容器清空", host.querySelectorAll("canvas").length === 0, "canvas=" + host.querySelectorAll("canvas").length);
    return check.results;
  }
};
