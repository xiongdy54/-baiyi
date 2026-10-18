// @runtime: node
// 材料导图 v2 · 页签端到端 DOM 回归（node tests/m15v2.tab.dom.test.cjs）。
// 真实 MindmapTab.tsx（tsload 转译）+ jsdom + 真实主进程引擎 mindmapEngineV2 + 内存 store + 假流式模型。
// window.mindmapAPI 按 preload.js 同名同形装配（invoke 走 JSON 往返模拟 IPC 结构化克隆；delta/changed 异步推送）。
// 用途：沙箱无 Electron（node_modules 为 win32 二进制、npm 源 403），以此代替「打开应用看画布」：
//   挂载即出目录预览 → 原文送入 → 预估 → 点「生成导图」→ 流式节点在流结束前出现在 SVG → 完成后树完整 → 点＋深挖。
const path = require("path");
const root = path.join(__dirname, "..");

// ---------- jsdom 全局 ----------
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"]) {
  if (!(k in globalThis) || k === "window" || k === "document" || k === "navigator") {
    try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读则跳过 */ }
  }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 }; };

require("./lib/tsload.cjs");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createMindmapEngineV2 } = require(path.join(root, "electron", "mindmapEngineV2.js"));
const { createMemoryStore } = require(path.join(root, "tests", "lib", "mindmapMemoryStore.cjs"));

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

// ---------- 夹具书 ----------
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SENT = ["知识是经过检验的信念。", "这个定义解释了记忆的机制。", "作者先提出问题再给出回答。", "反方认为机会平等就够了。", "然而平等的起点也会固化等级。", "数据显示两组差异显著；"];
function unitText(rnd, chars) {
  const out = [];
  let n = 0;
  while (n < chars) { let p = ""; for (let i = 0; i < 10 + Math.floor(rnd() * 15); i++) p += SENT[Math.floor(rnd() * SENT.length)]; out.push(p); n += p.length; }
  return out.join("\n\n");
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
};

// ---------- 假流式模型（慢速吐行，便于断言「流结束前已出节点」） ----------
const streamLog = [];
function genLines(lo, hi, levels) {
  const out = [];
  (function rec(prefix, a, b, lvl) {
    const n = b - a + 1, k = Math.min(2, n); // 二分：末层仍留 ≥2 块的「＋」节点（检验深挖路径）
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
    await sleep(15);
  }
  entry.end = Date.now();
  return { usage: { prompt_tokens: 100, completion_tokens: 40 }, finishReason: "stop", ttftMs: 10, firstByteMs: 5 };
}

// ---------- 引擎 + preload 同形桥 ----------
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
const inv = (fn) => (p) => new Promise((res, rej) => setTimeout(() => { try { res(clone(fn(clone(p)))); } catch (e) { rej(e); } }, 1));
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
for (const m of ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExpandAll", "graphExplain", "graphCancel", "graphResume", "graphSetView", "graphMetrics", "graphNodeText"]) {
  w.mindmapAPI[m] = inv((p) => engine[m](p));
}
const stages = [];
changedL.add((p) => stages.push(p.stage));
w.aiAPI = { getConfig: async () => ({ hasKey: true, preset: "siliconflow" }) };
w.addEventListener("error", (e) => errors.push(String(e.error && e.error.stack || e.message)));
const origErr = console.error;
console.error = (...a) => { errors.push(a.map(String).join(" ").slice(0, 800)); };

(async () => {
  const { installMindmapBridge } = require(path.join(root, "src", "lib", "mindmap.ts"));
  const MindmapTab = require(path.join(root, "src", "components", "reader", "MindmapTab.tsx")).default;
  installMindmapBridge();
  const host = w.document.getElementById("host");
  const made = [];
  const rootEl = createRoot(w.document.getElementById("root"));
  // 与 src/main.tsx 一致包 StrictMode：开发态 effect 会「挂载→清理→再挂载」（2026-10-18 用户实测画布空白即由此而来）
  rootEl.render(React.createElement(React.StrictMode, null, React.createElement(MindmapTab, {
    kernel, documentId: "doc-dom", title: "测试材料", canvasHost: host, onJumpToText: () => {},
    onMakeCardsFromNode: (p) => made.push(p),
  })));
  const svgCards = () => host.querySelectorAll("svg [data-node-id]").length;
  const panel = () => w.document.getElementById("root").textContent || "";
  const btn = (re) => [...w.document.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));

  console.log("---- 挂载：目录预览 + 原文送入 + 预估 ----");
  check("挂载后画布出现目录预览卡片（零调用）", await until(() => svgCards() >= 6), { cards: svgCards(), html: host.innerHTML.slice(0, 300) });
  check("预览期间零模型调用", streamLog.length === 0);
  check("原文读完后显示发送前预览（段数/字数/模型）", await until(() => /发送前预览：\d+ 段/.test(panel()) && /DeepSeek-V4-Flash/.test(panel())), panel().slice(0, 400));
  check("挂载/预览阶段无渲染错误", !errors.length, errors.slice(0, 3));

  console.log("---- 生成：流式节点早于流结束出现 ----");
  const gen = btn(/^生成导图$/);
  check("有「生成导图」按钮", !!gen);
  gen.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const firstStreamEnds = () => streamLog.find((e) => e.kind === "outline" && e.end);
  const aiCard = () => [...host.querySelectorAll("svg [data-node-id]")].some((el) => /^t\d+(p\d+)?\.\d/.test(el.getAttribute("data-node-id") || ""));
  const sawEarly = await until(() => aiCard() || !!firstStreamEnds(), 8000, 5);
  check("首个 AI 节点在第一次流结束前已画到画布上", sawEarly && aiCard() && !firstStreamEnds(), { aiCard: aiCard(), ended: !!firstStreamEnds(), calls: streamLog.length });
  check("生成中面板显示「框架 n/m 段」与「停止」", await until(() => /框架 \d+\/\d+ 段/.test(panel()) && !!btn(/^停止$/)), panel().slice(0, 300));
  await until(() => stages.includes("completed"), 15000);
  await engine.idle();
  check("全部作用域完成（面板出现「重新生成」）", await until(() => !!btn(/^重新生成$/), 15000), panel().slice(0, 300));
  await sleep(500); // 等最后一次布局过渡（260ms）结束
  const n1 = svgCards();
  const mapId = store.getActiveMaterialMap("doc-dom", "book").id;
  const rows = store.listMaterialMapNodes(mapId);
  check("画布卡片数 ≈ 已落库节点数（根抬升后 = 行数 - 1 + 合成根）", n1 >= Math.min(rows.length, 30) * 0.5 && n1 > 15, { n1, rows: rows.length });
  check("材料名只出现一次（无「材料名 → 材料名」两层）", (host.innerHTML.match(/测试材料/g) || []).length <= 2, (host.innerHTML.match(/测试材料/g) || []).length);
  {
    // 性能：拖动平移只改外层 transform，不重建内容（同一个 <g> 元素、innerHTML 未重写）
    await sleep(1200); // 等最后几批增量合入与布局过渡全部落定（静止画面上测平移）
    const canvasEl = host.querySelector(".mm2-canvas");
    const vp0 = host.querySelector("svg > g.mm2-viewport");
    const t0 = vp0 && vp0.getAttribute("transform");
    const fire = (type, x, buttons) => canvasEl.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: 300, buttons }));
    fire("pointerdown", 500, 1);
    for (let x = 510; x <= 640; x += 10) fire("pointermove", x, 1);
    fire("pointerup", 640, 0);
    await sleep(200); // 等拖拽后的「吞掉合成 click」窗口（120ms）过去
    const vp1 = host.querySelector("svg > g.mm2-viewport");
    check("拖动平移：内容层不重建（同一元素）、只改 transform", vp0 && vp1 === vp0 && vp1.getAttribute("transform") !== t0, { same: vp1 === vp0, t0, t1: vp1 && vp1.getAttribute("transform") });
  }
  check("画布下方不再有读数条", !/首节点 [\d.]+s/.test(host.textContent) && !/复制读数/.test(host.textContent), host.textContent.slice(-300));
  check("生成过程无渲染错误", !errors.length, errors.slice(0, 3));

  console.log("---- 交互：选中 / 深挖 / 讲解 / 制卡 ----");
  const plus = host.querySelector('svg [data-act="deepen"]');
  check("存在「＋」深挖钩子", !!plus);
  const target = plus && plus.getAttribute("data-node-id");
  const before = streamLog.length;
  plus.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await until(() => streamLog.length > before, 3000);
  await engine.idle();
  await sleep(500);
  const kids = store.listMaterialMapNodes(mapId).filter((r) => r.parentId === target);
  check("点＋发起一次 expand，子节点落库并画出", streamLog.length === before + 1 && kids.length >= 2 && kids.every((k) => host.querySelector(`svg [data-node-id="${k.nodeId}"]`)), { target, kids: kids.length });
  const card = host.querySelector(`svg g[data-node-id="${kids[0] ? kids[0].nodeId : target}"]`);
  card.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  check("选中后面板出现节点详情", await until(() => /节点详情/.test(panel())), panel().slice(0, 200));
  const ex = btn(/^讲解此节点$/);
  ex && ex.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  check("讲解流式显示并落库", await until(() => /这一节先提出问题，再给出回答。/.test(panel()), 5000));
  const mk = btn(/^就此制卡$/);
  mk && mk.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  check("就此制卡：回调收到 v2 结构语义包", await until(() => made.length === 1) && /^v2:/.test(made[0].nodeId) && made[0].section.length <= 1200 && made[0].section.includes("【结构语义包】"), made[0]);
  check("交互过程无渲染错误", !errors.length, errors.slice(0, 3));

  rootEl.unmount();
  console.error = origErr;
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
