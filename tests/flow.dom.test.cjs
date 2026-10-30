// @runtime: system-node
// 结构流 · 宿主 / 渲染器端到端 DOM 回归（node scripts/run-tests.mjs flow.dom）。
// 依据 STRUCTURE-FLOW-PLAN §10 阶段 3 + §12.6：真组件（StructureFlowHost / FlowLayer，tsload 转译 + StrictMode）
// ＋ jsdom ＋ 真实主进程引擎（内存 store，预置一张论证型图谱，零 AI 调用）＋ 假内核（固定几何 / 多点探针）。
const path = require("path");
const root = path.join(__dirname, "..");

const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "MutationObserverInit"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
w.HTMLElement.prototype.scrollIntoView = function () {};

require("./lib/tsload.cjs");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createMindmapEngineV2 } = require(path.join(root, "electron", "mindmapEngineV2.js"));
const { createMemoryStore } = require(path.join(root, "tests", "lib", "mindmapMemoryStore.cjs"));
const { ensureFed } = require(path.join(root, "src", "lib", "mindmapFeed.ts"));
const ensureLayout = require(path.join(root, "src", "lib", "flow", "layout.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 8000, step = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(step); }
  return pred();
}
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ---------------------------------------------------------------- 夹具：20 段正文（块号 = 段落序）
const PARAS = [];
for (let i = 1; i <= 20; i++) {
  PARAS.push(`【段${String(i).padStart(2, "0")}】` + "知识是经过检验的信念，这一段用来测试结构流。".repeat(2));
}
const DOC = "doc-flow";
const UNIT = "u1.xhtml";

// ---------------------------------------------------------------- 预置图谱：第一章＝论证（A 论点 / B 理由+B1 证据 / C 例证 / D 反方），第二章＝并列（X/Y）
const store = createMemoryStore();
const row = (nodeId, parentId, ord, title, type, blockStart, blockEnd, extra) => Object.assign({
  nodeId, parentId, ord, title, type, blockStart, blockEnd, state: "open", source: "ai", time: null, pattern: null, spans: null, warnings: null, explain: null, jobId: null,
}, extra || {});
{
  const { mapId } = store.createMaterialMapV2({
    documentId: DOC, title: "结构流测试", meta: { title: "结构流测试", schemaVersion: 2 },
    skeleton: [
      row("t0", null, 0, "结构流测试", "其他", 1, 20, { source: "toc" }),
      row("t1", "t0", 1000, "第一章 论证", "论点", 1, 10, { pattern: "argument" }),
      row("A", "t1", 1000, "动物化的后现代", "论点", 1, 5),
      row("B", "t1", 2000, "数据库消费", "理由", 6, 8),
      row("B1", "B", 1000, "物神崇拜的碎片", "证据", 7, 8),
      row("C", "t1", 3000, "叙事与数据库分离", "例证", 9, 10),
      row("D", "t1", 4000, "但有人认为不可能", "反方观点", 4, 4),
      row("t2", "t0", 2000, "第二章 并列", "论点", 11, 20, { pattern: "tree" }),
      row("X", "t2", 1000, "第一比较项", "理由", 11, 15),
      row("Y", "t2", 2000, "第二比较项", "证据", 16, 20),
    ],
  });
  store.commitMaterialMapJob({
    mapId, activate: true,
    edges: [
      { fromId: "B", toId: "A", code: "支" },
      { fromId: "C", toId: "A", code: "例" },
      { fromId: "D", toId: "A", code: "驳" },
      { fromId: "B1", toId: "B", code: "支" },
    ],
  });
}

// ---------------------------------------------------------------- 假模型（不会被调用：图已预置）
async function chatStream(_opts, send) {
  send({ delta: "" });
  return { usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: "stop", ttftMs: 1, firstByteMs: 1 };
}
const deltaL = new Set(), changedL = new Set();
const engine = createMindmapEngineV2({
  store, chatStream,
  readSettings: () => ({ app: { mindmapConcurrency: 2 } }),
  getAIConfig: () => ({ preset: "siliconflow", model: "deepseek-ai/DeepSeek-V4-Flash" }),
  getPromptTemplate: () => null,
  broadcastDelta: (p) => { const c = clone(p); setTimeout(() => deltaL.forEach((f) => f(c)), 0); },
  broadcastChanged: (p) => { const c = clone(p); setTimeout(() => changedL.forEach((f) => f(c)), 0); },
});
const inv = (fn) => (p) => new Promise((res, rej) => setTimeout(async () => { try { res(clone(await fn(clone(p)))); } catch (e) { rej(e); } }, 1));
w.mindmapAPI = {
  onChanged: (cb) => { changedL.add(cb); return () => changedL.delete(cb); },
  onDelta: (cb) => { deltaL.add(cb); return () => deltaL.delete(cb); },
};
for (const m of ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExplain", "graphCancel", "graphNodeText", "graphLocate", "graphEnsureMap", "graphNodeAnchors"]) w.mindmapAPI[m] = inv((p) => engine[m](p));
w.aiAPI = { getConfig: async () => ({ hasKey: true, preset: "siliconflow" }) };
const errors = [];
w.addEventListener("error", (e) => errors.push(String((e.error && e.error.stack) || e.message)));
const origErr = console.error;
console.error = (...a) => errors.push(a.map(String).join(" ").slice(0, 600));

// ---------------------------------------------------------------- 假内核
let TEXT = { left: 520, right: 960 }; // 版心在 viewport 内居中（§14.5 宿主只信宽度）；reserve 档换 450
let activeMain = null;
const shiftNow = () => { const m = /translateX\(-(\d+)/.exec((activeMain && activeMain.style.transform) || ""); return m ? Number(m[1]) : 0; };
const VIEWPORT = { left: 280, top: 60, right: 1200, bottom: 900 };
let lastTargets = [];
let geoSeq = 0;
let locoTargets = 0;
let offY = 0;
let paintCalls = [];
let scrollCb = null;
const relHandlers = new Set();
const gotos = [];
let probeDist = [0, 0, 0, 0]; // 四个注意力点落在哪些段落（0 基）
let currentLoc = { cfi: "epubcfi(/6/4!/4/2)" };
const kernel = {
  getTOC: () => [{ label: "第一章 论证", href: UNIT }],
  getSectionAnchors: () => [{ anchor: UNIT }],
  getSectionText: async () => PARAS.join("\n\n"),
  getCurrentLocation: () => currentLoc,
  goTo: async (t) => { gotos.push(t); return true; },
  on: (ev, h) => { if (ev === "relocate") { relHandlers.add(h); return () => relHandlers.delete(h); } return () => {}; },
  setStructureTargets: (targets) => { lastTargets = clone(targets) || []; locoTargets++; },
  getReadingProbes: (fracs) => fracs.map((frac, i) => ({ frac, unitAnchor: UNIT, text: PARAS[probeDist[i] ?? 0].slice(0, 30) })),
  getStructureGeometry: (opts) => {
    const sh = shiftNow();
    const left = TEXT.left - sh, right = TEXT.right - sh;
    const boxes = lastTargets.map((t, i) => ({
      key: t.key, nodeId: t.nodeId, block: i + 1,
      top: 140 + i * 30 + offY, bottom: 165 + i * 30 + offY, left, right, column: 0, clipTop: false, clipBottom: false,
      doc: 0, cTop: 140 + i * 30, cBottom: 165 + i * 30, cLeft: left, cRight: right,
    }));
    void opts;
    return { seq: ++geoSeq, viewport: VIEWPORT, columns: [{ left, right }], boxes, text: { left, right } };
  },
  onContentScroll: (cb) => { scrollCb = cb; return () => { if (scrollCb === cb) scrollCb = null; }; },
  getFrameOffsets: () => ({ 0: { left: 0, top: offY } }),
  setStructurePaint: (rects, o) => { paintCalls.push({ rects: clone(rects) || [], o: clone(o) }); },
};
const relocate = () => { for (const h of relHandlers) h({ location: {}, fraction: 0 }); };
const scrollBy = (dy) => { offY = dy; if (scrollCb) scrollCb(); };

(async () => {
  await ensureFed(kernel, DOC, "结构流测试");

  const Host = require(path.join(root, "src", "components", "reader", "flow", "StructureFlowHost.tsx")).default;
  const stage = { open: false, setOpen: null, closed: 0, opened: [] };
  function Wrapper(props) {
    const [open, setOpen] = React.useState(false);
    stage.setOpen = setOpen;
    const vp = React.useRef(null), main = React.useRef(null), gutter = React.useRef(null);
    const [els, setEls] = React.useState(null);
    React.useEffect(() => {
      if (vp.current) vp.current.getBoundingClientRect = () => ({ ...VIEWPORT, width: VIEWPORT.right - VIEWPORT.left, height: VIEWPORT.bottom - VIEWPORT.top });
      activeMain = main.current;
      setEls({ vp: vp.current, main: main.current, gutter: gutter.current });
    }, []);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("div", { className: "reader-engine-viewport", ref: vp },
        React.createElement("div", { className: "reader-engine-main flow-shift-target", ref: main }),
        React.createElement("div", { className: "reader-flow-gutter", ref: gutter })),
      React.createElement(Host, {
        kernel, documentId: DOC, title: "结构流测试", open, covered: false, scrolled: true,
        viewportEl: els ? els.vp : null, shiftEl: els ? els.main : null, gutterEl: els ? els.gutter : null,
        onClose: () => { stage.closed++; setOpen(false); },
        onOpenInMap: (id, region) => stage.opened.push({ id, region }),
      }),
    );
  }
  const rootEl = createRoot(w.document.getElementById("root"));
  rootEl.render(React.createElement(React.StrictMode, null, React.createElement(Wrapper)));
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => [...w.document.querySelectorAll(sel)];
  const smoothKernel = typeof kernel.onContentScroll === "function" && typeof kernel.getFrameOffsets === "function" && typeof kernel.setStructurePaint === "function";
  const item = (id) => $(`[data-flow-item="${id}"]`);
  const shapeOf = (nodeId) => $(`.flow-shapes path[data-node-id="${nodeId}"]`);
  const click = (el) => el && el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const dbl = (el) => el && el.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  const pointerOver = (el) => el && el.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));

  const openFlow = async () => {
    stage.setOpen(true);
    await until(() => !!$(".flow-blend"), 12000);
    await sleep(1700);
  };

  console.log("---- 打开 / 高亮流带 / 混合层 ----");
  await until(() => typeof stage.setOpen === "function", 3000);
  await openFlow();
  check("打开后出现阅读节点（主题色底 + 白字 pill）", !!$("[data-reading='1'] .flow-pill"), $(".flow-items") && $(".flow-items").textContent);
  check("混合层存在且 mixBlendMode=multiply（浅色阅读背景）", !!$(".flow-blend") && $(".flow-blend").style.mixBlendMode === "multiply", $(".flow-blend") && $(".flow-blend").getAttribute("style"));
  const shapeCount = $$(".flow-shapes path").length;
  check("高亮流带按合并后的段落块出形状（每条 d 以 M 开头、是三次贝塞尔/圆角路径）", shapeCount > 0 && $$(".flow-shapes path").every((p) => /^M/.test(p.getAttribute("d") || "") && /[CQ]/.test(p.getAttribute("d") || "")), { shapeCount });

  console.log("---- 定位目标 / 泳道 / 跨度条 ----");
  const leafIds = [...new Set(lastTargets.map((t) => t.nodeId))];
  check("targets 覆盖全部 leafIds", leafIds.length > 0 && leafIds.every((id) => lastTargets.some((t) => t.nodeId === id)), { leafIds, targets: lastTargets.map((t) => t.nodeId) });
  const bar = (id) => {
    const p = $(`[data-prim-id="bar:${id}"]`);
    if (!p) return null;
    if (p.getAttribute("x") != null) return Number(p.getAttribute("x"));
    const m = /^M([-\d.]+),/.exec(p.getAttribute("d") || "");
    return m ? Number(m[1]) - Number(p.getAttribute("stroke-width") || 0) / 2 : null;
  };
  const rootBar = bar("t1");
  check("论证图根论点：条存在且位于泳道 0（barX）", rootBar != null, { rootBar });
  const barFill = $("[data-prim-id='bar:t1']") ? $("[data-prim-id='bar:t1']").getAttribute("fill") : null;
  check("根论点条 fill＝accent", !!barFill && barFill.toLowerCase() === "#166a59", barFill);
  const bA = bar("A"), bC = bar("C");
  check("层级用泳道：例证条比论点条右移 2×LANE_DX（有根时论点泳道 1、例证泳道 3）", bA != null && bC != null && Number(bC) - Number(bA) === 12, { bA, bC });
  check("跨度条与反方缺口存在（取代旧脊线）", !!$("[data-prim-id='span:t1']") && !!$("[data-prim-id='notch:D']"), $$(".flow-svg [data-prim-id]").map((e) => e.getAttribute("data-prim-id")).slice(0, 12));
  check("页面里没有类型方框 .flow-chip", !$(".flow-chip"));

  console.log("---- §13.3 平滑滚动：颈部同步 / 正文矩形 / 列稳定 / 无黑色 ----");
  {
    await until(() => paintCalls.some((c) => c.rects.length > 0), 3000);
    const ribs = $$(".flow-shapes path[data-node-id]");
    check("滚动模式：混合层只剩颈部（矩形画在正文里）", smoothKernel && ribs.length > 0, ribs.length);
    const el = ribs.find((p) => p.getAttribute("data-node-id") === "A") || ribs[0];
    const d0 = el && el.getAttribute("d");
    const yOf = (d) => { const m = /^M[^,]+,\s*([-\d.]+)/.exec(d || ""); return m ? Number(m[1]) : NaN; };
    const y0 = yOf(d0);
    offY = -30;
    if (scrollCb) scrollCb();
    const same = el && el === $(`.flow-shapes path[data-node-id="${el.getAttribute("data-node-id")}"]`);
    const d1 = el && el.getAttribute("d");
    const y1 = yOf(d1);
    check("同一调用栈里颈部已随滚动同步（同元素、y 差 = 30）", !!el && same && d1 !== d0 && Math.abs(y0 - y1 - 30) < 1, { y0, y1, d0, d1 });

    const visible = $$(".flow-shapes path[data-node-id]").length;
    const pc = paintCalls.length;
    check("正文矩形数 = 可见流带数", paintCalls[paintCalls.length - 1].rects.length >= 1 && paintCalls[paintCalls.length - 1].rects.length <= visible + 2, { rects: paintCalls[paintCalls.length - 1].rects.length, visible });
    scrollBy(-60);
    check("滚动回调不重新下发正文矩形（矩形随正文原生滚动）", paintCalls.length === pc, paintCalls.length - pc);
    offY = 0;
    if (scrollCb) scrollCb();

    const t0 = $(".flow-items").style.transform;
    probeDist = [0, 0, 10, 10];
    relocate();
    check("预览出现", await until(() => {
      const head = item("n:t2");
      return !!head && /下一部分/.test(head.textContent || "");
    }, 4000));
    await sleep(500);
    check("预览出现时列主体不平移", $(".flow-items").style.transform === t0, { before: t0, after: $(".flow-items").style.transform });
    probeDist = [0, 0, 0, 0];
    relocate();
    await sleep(900);
    check("预览消失时列主体也不平移", $(".flow-items").style.transform === t0, { before: t0, after: $(".flow-items").style.transform });

    const stops = $$(".flow-blend linearGradient stop");
    check("所有渐变 stop 都是可解析实色（无黑色兜底）", stops.length > 0 && stops.every((s) => ensureLayout.parseRgb(s.getAttribute("stop-color") || "") !== null), stops.map((s) => s.getAttribute("stop-color")).slice(0, 8));

    // §14.4：接缝连续——每条颈部渐变从矩形右端起坡，起点透明度 = 矩形 alpha
    const grads = new Map($$(".flow-blend linearGradient").map((g) => [g.id, g]));
    const lastPaint = [...paintCalls].reverse().find((c) => c.rects.length > 0);
    const rectOf = (nodeId) => (lastPaint ? lastPaint.rects.find((r) => r.key.startsWith(nodeId + "@")) : null);
    const seam = [];
    for (const p of $$(".flow-shapes path[data-node-id]")) {
      const fill = p.getAttribute("fill") || "";
      const g = grads.get(fill.replace(/^url\(#|\)$/g, ""));
      const nodeId = p.getAttribute("data-node-id");
      const rect = rectOf(nodeId);
      const stop0 = g && g.querySelector("stop");
      if (!g || !rect || !stop0) { seam.push({ nodeId, g: !!g, rect: !!rect }); continue; }
      const a = Number(stop0.getAttribute("stop-opacity"));
      const x1 = Number(g.getAttribute("x1"));
      if (Math.abs(a - rect.alpha) > 1e-6 || Math.abs(x1 - (rect.left + rect.width)) > 0.6) seam.push({ nodeId, a, alpha: rect.alpha, x1, xs: rect.left + rect.width });
    }
    check("§14.4 颈部渐变从矩形右端起坡、起点透明度 = 矩形 alpha", seam.length === 0, seam.slice(0, 4));
    check("§14.4 正文矩形带右缘渐隐（fade > 0）", !!lastPaint && lastPaint.rects.every((r) => typeof r.fade === "number" && r.fade > 0), lastPaint && lastPaint.rects.slice(0, 2).map((r) => r.fade));
  }

  console.log("---- 悬停 / 展开 / 双击跳转 / 回到原位 ----");
  pointerOver(item("n:B"));
  check("悬停某行：该节点形状升到 hover 档（-2），其余形状 is-dim", await until(() => {
    const s = shapeOf("B");
    return !!s && s.getAttribute("data-tone") === "2" && [...$$(".flow-shape")].some((p) => p.classList.contains("is-dim"));
  }, 2000), { tone: shapeOf("B") && shapeOf("B").getAttribute("data-tone") });
  click(item("n:B"));
  check("点有子节点的成员 → 出现 kid 项与动作行", await until(() => !!item("n:B1") && !!$(".flow-actions"), 4000), { kid: !!item("n:B1"), actions: !!$(".flow-actions") });
  click(item("n:B"));
  check("再点 → 收起 kid", await until(() => !item("n:B1"), 1500));
  check("收起同时收走动作行（§14.2-3）", await until(() => !$(".flow-actions"), 1500), { inline: !!$(".flow-inline") });
  const g0 = gotos.length;
  dbl(item("n:C"));
  check("双击 → 跳到原文（内核 goTo 被调）", await until(() => gotos.length > g0, 3000), gotos);
  check("出现「↩」回到刚才读的位置", await until(() => !!item("back"), 3000));
  const g1 = gotos.length;
  click(item("back"));
  check("点「↩」→ 回跳（再调一次 goTo）", await until(() => gotos.length > g1, 3000), gotos);

  console.log("---- 邻组预览 → 切组（同一 DOM 节点长大） ----");
  probeDist = [0, 0, 10, 10];
  relocate();
  check("交界处：下一部分以预览出现在列下方（「下一部分」）", await until(() => {
    const head = item("n:t2");
    return !!head && /下一部分/.test(head.textContent || "");
  }, 4000), { text: item("n:t2") && item("n:t2").textContent });
  check("预览成员也有高亮流带", !!shapeOf("X"), $$(".flow-shapes path").map((p) => p.getAttribute("data-node-id")));
  const previewX = item("n:X");
  check("预览成员项存在", !!previewX);
  probeDist = [0, 10, 10, 10];
  relocate();
  const switched = await until(() => {
    const now = item("n:X");
    return !!now && now === previewX && !!$("[data-reading='1']");
  }, 5000);
  check("新组成为主导 → 切组，原预览成员元素仍是同一个 DOM 节点（===）", switched && item("n:X") === previewX, { same: item("n:X") === previewX });
  check("切组后原主体成为「上一部分」预览", await until(() => {
    const head = item("n:t1");
    return !!head && /上一部分/.test(head.textContent || "");
  }, 3000), { text: item("n:t1") && item("n:t1").textContent });

  console.log("---- §14.2 预览与主体不互吞 / 动作行只锚主体 ----");
  {
    const yOf = (el) => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((el && el.style.transform) || "");
      return m ? Number(m[2]) : NaN;
    };
    const wrapY = (() => {
      const m = /translateY\(([-\d.]+)px\)/.exec(($(".flow-items") || { style: {} }).style.transform || "");
      return m ? Number(m[1]) : 0;
    })();
    const peekIds = () => $$(".flow-item.is-peek").map((e) => e.getAttribute("data-flow-item"));
    check("当前存在「上一部分」预览行", peekIds().length > 0, peekIds());
    click(item("n:A")); // 点预览行 → focusGroup 切回 t1
    await sleep(800);
    const ids = $$(".flow-item").map((e) => e.getAttribute("data-flow-item"));
    check("点预览行切组后无重复行", ids.length > 0 && new Set(ids).size === ids.length, ids);
    const bars = $$(".flow-svg [data-prim-id^='bar:']").map((e) => e.getAttribute("data-prim-id").slice(4));
    const nodes = new Set($$(".flow-item[data-kind='node']").map((e) => e.getAttribute("data-flow-item").slice(2)));
    check("每个色条都有对应条目（无浮空条）", bars.length > 0 && bars.every((b) => nodes.has(b)), { bars, nodes: [...nodes] });
    const inlineEl = $(".flow-inline");
    const inlineY = inlineEl ? yOf(inlineEl) : NaN;
    const anchored = $$(".flow-item:not(.is-peek)").some((e) => Math.abs(yOf(e) + parseFloat(e.style.height || "0") + wrapY - inlineY) < 0.6);
    check("动作行锚在主体行下方（不在预览行上）", !inlineEl || anchored, { inlineY, wrapY, items: $$(".flow-item").map((e) => e.getAttribute("data-flow-item")) });
  }

  console.log("---- §14.5 拉伸：逐帧跟手、三件整体居中、彩带不塌 ----");
  {
    const readShift = () => { const m = /translateX\(-(\d+)/.exec((activeMain && activeMain.style.transform) || ""); return m ? Number(m[1]) : 0; };
    const rowX = () => { const el = $$(".flow-item[data-kind='node']")[0]; const m = /translate\(([-\d.]+)px/.exec((el && el.style.transform) || ""); return m ? Number(m[1]) : NaN; };
    const centering = () => {
      const labelX = rowX() + 0;
      const vw = VIEWPORT.right - VIEWPORT.left;
      const left = TEXT.left - readShift() - VIEWPORT.left;
      const right = VIEWPORT.right - (labelX + 248 + 20);
      const barX = labelX - 10 - 16;
      return { left, right, braid: barX - (TEXT.right - readShift()), vw };
    };
    const c0 = centering();
    check("初始：彩带 96、左右余量对称（±16 量化）", Math.abs(c0.braid - 96) <= 1 && Math.abs(c0.left - c0.right) <= 16, c0);

    // 拉宽 280px：正文、彩带、节点列作为一体跟过去（不是只有列被挤到右边）
    VIEWPORT.right = 1480;
    {
      const vw = VIEWPORT.right - VIEWPORT.left;
      const tw = Math.min(440, vw - 8);
      TEXT = { left: VIEWPORT.left + (vw - tw) / 2, right: VIEWPORT.left + (vw + tw) / 2 };
    }
    w.dispatchEvent(new w.Event("resize"));
    check("拖动中打上 data-flow-resizing（关掉 420ms 滑行）", await until(() => w.document.body.getAttribute("data-flow-resizing") === "1", 500));
    await sleep(90);
    const c1 = centering();
    check("宽度变化 90ms 内已跟手（不再等 200ms 防抖）", activeMain && Math.abs(c1.braid - 96) <= 1 && Math.abs(c1.left - c1.right) <= 16, c1);
    check("停手后撤掉 data-flow-resizing", await until(() => !w.document.body.hasAttribute("data-flow-resizing"), 2000), w.document.body.getAttribute("data-flow-resizing"));
    VIEWPORT.right = 1200;
    {
      const vw = VIEWPORT.right - VIEWPORT.left;
      const tw = Math.min(440, vw - 8);
      TEXT = { left: VIEWPORT.left + (vw - tw) / 2, right: VIEWPORT.left + (vw + tw) / 2 };
    }
    w.dispatchEvent(new w.Event("resize"));
    await sleep(400);
  }

  console.log("---- 关闭 ----");
  stage.setOpen(false);
  check("关闭后卸载两层", await until(() => !$(".flow-blend") && !$(".flow-layer"), 3000));
  check("关闭后清定位目标（收到 []）", lastTargets.length === 0, lastTargets.length);
  rootEl.unmount();

  // ---------------------------------------------------------------- 平移 / 预留（§10-7 / §10-8 与 §12.1）
  console.log("---- 正文让位：shift / reserve ----");
  const mountScenario = async (text) => {
    TEXT = text;
    lastTargets = [];
    const el = w.document.createElement("div");
    w.document.body.appendChild(el);
    const root2 = createRoot(el);
    const refs = { main: null, gutter: null };
    const st = { open: true, setOpen: null };
    function Wrapper2() {
      const vp = React.useRef(null), main = React.useRef(null), gutter = React.useRef(null);
      const [els, setEls] = React.useState(null);
      React.useEffect(() => {
        if (vp.current) vp.current.getBoundingClientRect = () => ({ ...VIEWPORT, width: VIEWPORT.right - VIEWPORT.left, height: VIEWPORT.bottom - VIEWPORT.top });
        refs.main = main.current; refs.gutter = gutter.current; activeMain = main.current;
        setEls({ vp: vp.current, main: main.current, gutter: gutter.current });
      }, []);
      return React.createElement("div", null,
        React.createElement("div", { className: "reader-engine-viewport", ref: vp },
          React.createElement("div", { className: "reader-engine-main flow-shift-target", ref: main }),
          React.createElement("div", { className: "reader-flow-gutter", ref: gutter })),
        React.createElement(Host, {
          kernel, documentId: DOC, title: "结构流测试", open: true, covered: false, scrolled: true,
          viewportEl: els ? els.vp : null, shiftEl: els ? els.main : null, gutterEl: els ? els.gutter : null,
          onClose: () => {}, onOpenInMap: () => {},
        }));
    }
    root2.render(React.createElement(React.StrictMode, null, React.createElement(Wrapper2)));
    await until(() => !!$(".flow-blend"), 12000);
    await sleep(2400);
    return { root2, refs, el };
  };
  {
    const s = await mountScenario({ left: 520, right: 960 });
    check("shift 档：正文整体平移 −200px（三件整体居中）", s.refs.main && s.refs.main.style.transform === "translateX(-200px)", {
      transform: s.refs.main && s.refs.main.style.cssText,
      gutter: s.refs.gutter && s.refs.gutter.style.flexBasis,
      mode: ($(".flow-layer") || { getAttribute: () => null }).getAttribute("data-mode"),
      plan: lastTargets.length,
    });
    s.root2.unmount(); s.el.remove();
  }
  {
    const s = await mountScenario({ left: 450, right: 1030 });
    check("reserve 档：预留槽位 390px", s.refs.gutter && s.refs.gutter.style.flexBasis === "390px", s.refs.gutter && s.refs.gutter.style.flexBasis);
    s.root2.unmount(); s.el.remove();
  }

  check("全程无运行时错误（React / jsdom）", errors.length === 0, errors.slice(0, 3));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { origErr(e); process.exit(1); });
