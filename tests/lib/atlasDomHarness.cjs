// 结构全景 DOM 测试夹具（jsdom + 真实主进程引擎 + 内存 store + 假流式模型）。
// 由 tests/atlas.dom.test.cjs 与 tests/m15v2.tab.dom.test.cjs 共用（D254 §16.2/§16.3）。
const path = require("path");
const root = path.join(__dirname, "..", "..");

const { JSDOM } = require("jsdom");

function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SENT = ["知识是经过检验的信念。", "这个定义解释了记忆的机制。", "作者先提出问题再给出回答。", "反方认为机会平等就够了。", "然而平等的起点也会固化等级。", "数据显示两组差异显著；"];
function unitText(rnd, chars) {
  const out = [];
  let n = 0;
  while (n < chars) { let p = ""; for (let i = 0; i < 10 + Math.floor(rnd() * 15); i++) p += SENT[Math.floor(rnd() * SENT.length)]; out.push(p); n += p.length; }
  return out.join("\n\n");
}

function createHarness() {
  const dom = new JSDOM('<!doctype html><html><body><div id="toolbar"></div><div id="stage"></div><div id="host"></div><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"]) {
    if (!(k in globalThis) || k === "window" || k === "document" || k === "navigator") {
      try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读则跳过 */ }
    }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  // 设计 §16.2：舞台 1100×640（jsdom 没有布局，统一给所有元素同一矩形，供相机 / 卡片定位）
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 1100, height: 640, right: 1100, bottom: 640 }; };
  if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = () => {};

  require("./tsload.cjs");
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { createMindmapEngineV2 } = require(path.join(root, "electron", "mindmapEngineV2.js"));
  const { createMemoryStore } = require(path.join(root, "tests", "lib", "mindmapMemoryStore.cjs"));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(pred, ms = 8000, step = 20) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(step); }
    return pred();
  }

  const rnd = lcg(3);
  const TOC = [
    { label: "前言", href: "u0.xhtml" },
    { label: "第一章 问题", href: "u1.xhtml", subitems: [{ label: "1.1 背景", href: "u2.xhtml" }, { label: "1.2 论证", href: "u3.xhtml" }] },
    { label: "第二章 终章", href: "u4.xhtml" },
  ];
  const UNITS = ["u0.xhtml", "u1.xhtml", "u2.xhtml", "u3.xhtml", "u4.xhtml"];
  const TEXT = { "u0.xhtml": unitText(rnd, 1500), "u1.xhtml": unitText(rnd, 800), "u2.xhtml": unitText(rnd, 2500), "u3.xhtml": unitText(rnd, 3000), "u4.xhtml": unitText(rnd, 2000) };
  const kernel = {
    getTOC: () => TOC,
    getSectionAnchors: () => UNITS.map((anchor) => ({ anchor })),
    getSectionText: async (a) => { await sleep(5); return TEXT[a] || ""; },
    goTo: async () => true,
    getCurrentLocation: () => ({ href: "u1.xhtml" }),
    getReadingProbe: () => ({ unitAnchor: "u1.xhtml", text: "知识是经过检验的信念。" }),
  };

  const streamLog = [];
  function genLines(lo, hi, levels) {
    const out = [];
    (function rec(prefix, a, b, lvl) {
      const n = b - a + 1, k = Math.min(2, n);
      if (k < 2) return;
      let s = a;
      for (let i = 1; i <= k; i++) {
        const size = Math.floor(n / k) + (i <= n % k ? 1 : 0), from = s, to = s + size - 1;
        s = to + 1;
        const p = prefix ? `${prefix}.${i}` : String(i);
        const last = lvl >= levels, deeper = !last && size >= 2;
        out.push(`${p} [论点] 节${from}至${to} @${from}-${to} ${deeper ? "+" : last && size >= 2 ? "+" : "."}${i === 2 ? ` &支${prefix ? prefix + "." : ""}1` : ""}`);
        if (deeper) rec(p, from, to, lvl + 1);
      }
    })("", lo, hi, 1);
    return out;
  }
  async function chatStream(opts, send) {
    const user = opts.messages[1].content;
    const kind = opts.maxTokens === 3000 ? "outline" : opts.maxTokens === 1500 ? "expand" : "explain";
    const entry = { kind, start: Date.now(), end: null };
    streamLog.push(entry);
    let raw;
    if (kind === "explain") raw = "这一节先提出问题，再给出回答。";
    else {
      const m = /【原文块号】\[(\d+)\](?:–\[(\d+)\])?/.exec(user);
      const lv = /【目标层数】(\d+)/.exec(user);
      raw = genLines(Number(m[1]), Number(m[2] || m[1]), Number(lv[1])).map((l) => l + "\n").join("");
    }
    for (let i = 0; i < raw.length; i += 12) {
      if (opts.abortSignal && opts.abortSignal.aborted) { const e = new Error("cancelled"); e.code = "cancelled"; throw e; }
      send({ delta: raw.slice(i, i + 12) });
      await sleep(25);
    }
    entry.end = Date.now();
    return { usage: { prompt_tokens: 100, completion_tokens: 40 }, finishReason: "stop", ttftMs: 10, firstByteMs: 5 };
  }

  const store = createMemoryStore();
  const deltaL = new Set(), changedL = new Set();
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const engine = createMindmapEngineV2({
    store, chatStream,
    readSettings: () => ({ app: { mindmapConcurrency: 2 } }),
    getAIConfig: () => ({ preset: "siliconflow", model: "deepseek-ai/DeepSeek-V4-Flash" }),
    getPromptTemplate: () => null,
    broadcastDelta: (p) => { const c = clone(p); setTimeout(() => deltaL.forEach((f) => f(c)), 0); },
    broadcastChanged: (p) => { const c = clone(p); setTimeout(() => changedL.forEach((f) => f(c)), 0); },
  });
  const inv = (fn) => (p) => new Promise((res, rej) => setTimeout(async () => { try { res(clone(await fn(clone(p)))); } catch (e) { rej(e); } }, 1));
  const errors = [];
  w.mindmapAPI = {
    list: async (docId) => clone(store.listMaterialMaps(docId)),
    get: async (id) => clone(store.getMaterialMap(id)),
    getActive: async (docId) => clone(store.getActiveMaterialMap(docId, "book")),
    setActive: async (id) => clone(store.setActiveMaterialMap(id)),
    remove: async (id) => store.deleteMaterialMap(id),
    learningStatus: async () => ({}),
    onChanged: (cb) => { changedL.add(cb); return () => changedL.delete(cb); },
    onDelta: (cb) => { deltaL.add(cb); return () => deltaL.delete(cb); },
  };
  for (const m of ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExpandAll", "graphExplain", "graphCancel", "graphResume", "graphSetView", "graphMetrics", "graphNodeText", "graphLocate"]) {
    if (typeof engine[m] === "function") w.mindmapAPI[m] = inv((p) => engine[m](p));
  }
  const stages = [];
  changedL.add((p) => stages.push(p.stage));
  w.aiAPI = { getConfig: async () => ({ hasKey: true, preset: "siliconflow" }) };
  w.addEventListener("error", (e) => errors.push(String((e.error && e.error.stack) || e.message)));
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(" ").slice(0, 800)); };

  const { installMindmapBridge } = require(path.join(root, "src", "lib", "mindmap.ts"));
  installMindmapBridge();
  const MindmapTab = require(path.join(root, "src", "components", "reader", "MindmapTab.tsx")).default;

  const host = w.document.getElementById("stage");
  const toolbar = w.document.getElementById("toolbar");
  const made = [];
  const state = {
    entry: { seq: 1, origin: "button", nodeId: null, snapshot: null },
    open: true,
    exits: 0,
    exited: 0,
  };
  const rootEl = createRoot(w.document.getElementById("root"));
  let seq = 0;
  const render = (over = {}) => {
    seq++;
    rootEl.render(
      React.createElement(React.StrictMode, null, React.createElement(MindmapTab, {
        key: `mount-${seq}`,
        kernel,
        documentId: "doc-dom",
        title: "测试材料",
        stageHost: host,
        toolbarHost: toolbar,
        open: state.open,
        entry: state.entry,
        onExit: () => { state.exits++; if (!over.keepOpen) state.open = false; render(); },
        onExited: () => { state.exited++; },
        onMakeCardsFromNode: (p) => made.push(p),
        onJumpToText: () => {},
        ...over,
      })),
    );
  };
  const click = (el) => el && el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const key = (el, k, extra = {}) => el && el.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  const pointer = (el, type, x, y, buttons = 1) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons }));
  const stage = () => w.document.querySelector("#stage .atlas-stage");
  const agByNode = (id) => w.document.querySelector(`#stage .ag[data-node="${id}"]`);
  const focusAg = () => w.document.querySelector('#stage .ag[data-focus="1"]');
  const text = (el) => (el ? el.textContent || "" : "");
  const btn = (re) => [...w.document.querySelectorAll("button")].find((b) => re.test(text(b)));
  const restore = () => {
    rootEl.unmount();
    console.error = origErr;
  };
  return { w, React, rootEl, engine, store, streamLog, kernel, host, toolbar, made, errors, stages, state, render, click, key, pointer, stage, agByNode, focusAg, text, btn, sleep, until, restore, MindmapTab };
}

module.exports = { createHarness, lcg };
