// @runtime: node
// 结构透镜（阅读透镜）端到端 DOM 回归（node tests/m15v2.lens.dom.test.cjs）。
// 真实 MindmapLens.tsx（tsload 转译，包 React.StrictMode）+ jsdom + 真实主进程引擎 + 内存 store + 假流式模型 + 假内核
// （getReadingProbe / relocate 事件 / goTo 记录）。覆盖：收起态只有结构轨 → 展开 → 读原文 → 「这一节还没有图谱」→
// 生成这一节（只调用一次）→ 要点之线出现、当前点正确 → 阅读位置移动后当前点跟随 → 点要点跳正文 → 在图谱中打开 → Esc 收起。
const path = require("path");
const root = path.join(__dirname, "..");

const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
w.HTMLElement.prototype.scrollIntoView = function () {};

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

// ---------- 夹具书：每段一句独特开头，便于探针定位 ----------
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SENT = ["知识是经过检验的信念。", "这个定义解释了记忆的机制。", "作者先提出问题再给出回答。", "反方认为机会平等就够了。", "然而平等的起点也会固化等级。"];
function unitText(rnd, tag, paras) {
  const out = [];
  for (let k = 0; k < paras; k++) {
    let p = `【${tag}第${k + 1}段】`;
    for (let i = 0; i < 12; i++) p += SENT[Math.floor(rnd() * SENT.length)];
    out.push(p);
  }
  return out.join("\n\n");
}
const rnd = lcg(9);
const TOC = [
  { label: "前言", href: "u0.xhtml" },
  { label: "第一章 问题", href: "u1.xhtml" },
  { label: "第二章 论证", href: "u2.xhtml" },
];
const UNITS = ["u0.xhtml", "u1.xhtml", "u2.xhtml"];
const TEXT = { "u0.xhtml": unitText(rnd, "前", 6), "u1.xhtml": unitText(rnd, "甲", 16), "u2.xhtml": unitText(rnd, "乙", 12) };

const relocateHandlers = new Set();
const gotos = [];
let probe = { unitAnchor: "u1.xhtml", text: "【甲第2段】" };
const kernel = {
  getTOC: () => TOC,
  getSectionAnchors: () => UNITS.map((anchor) => ({ anchor })),
  getSectionText: async (a) => { await sleep(3); return TEXT[a] || ""; },
  getReadingProbe: () => probe,
  goTo: async (t) => { gotos.push(t); return true; },
  on: (ev, h) => { if (ev === "relocate") { relocateHandlers.add(h); return () => relocateHandlers.delete(h); } return () => {}; },
};
const relocate = (unitAnchor, text) => { probe = { unitAnchor, text }; for (const h of relocateHandlers) h({ location: {}, fraction: 0 }); };

// ---------- 假流式模型 ----------
const calls = [];
function genLines(lo, hi) {
  const n = hi - lo + 1, k = Math.min(3, n), out = [];
  let s = lo;
  for (let i = 1; i <= k; i++) {
    const size = Math.floor(n / k) + (i <= n % k ? 1 : 0), from = s, to = s + size - 1;
    s = to + 1;
    out.push(`${i} [论点] 要点${from}到${to} @${from}-${to} ${size >= 2 ? "+" : "."}${i === 2 ? " &支1" : ""}`);
  }
  return out;
}
async function chatStream(opts, send) {
  const user = opts.messages[1].content;
  const m = /【原文块号】\[(\d+)\](?:–\[(\d+)\])?/.exec(user);
  calls.push({ lo: Number(m[1]), hi: Number(m[2] || m[1]), kind: opts.maxTokens === 3000 ? "outline" : "expand" });
  const raw = genLines(Number(m[1]), Number(m[2] || m[1])).map((l) => l + "\n").join("");
  for (let i = 0; i < raw.length; i += 10) { send({ delta: raw.slice(i, i + 10) }); await sleep(10); }
  return { usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: "stop", ttftMs: 1, firstByteMs: 1 };
}

const store = createMemoryStore();
const deltaL = new Set(), changedL = new Set();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const engine = createMindmapEngineV2({
  store, chatStream, readSettings: () => ({ app: {} }), getAIConfig: () => ({ model: "fake" }), getPromptTemplate: () => null,
  broadcastDelta: (p) => { const c = clone(p); setTimeout(() => deltaL.forEach((f) => f(c)), 0); },
  broadcastChanged: (p) => { const c = clone(p); setTimeout(() => changedL.forEach((f) => f(c)), 0); },
});
const inv = (fn) => (p) => new Promise((res, rej) => setTimeout(() => { try { res(clone(fn(clone(p)))); } catch (e) { rej(e); } }, 1));
w.mindmapAPI = {
  onChanged: (cb) => { changedL.add(cb); return () => changedL.delete(cb); },
  onDelta: (cb) => { deltaL.add(cb); return () => deltaL.delete(cb); },
};
for (const m of ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExplain", "graphCancel", "graphNodeText", "graphLocate", "graphEnsureMap"]) w.mindmapAPI[m] = inv((p) => engine[m](p));
w.aiAPI = { getConfig: async () => ({ hasKey: true }) };
const errors = [];
const origErr = console.error;
console.error = (...a) => errors.push(a.map(String).join(" ").slice(0, 600));

(async () => {
  const { installMindmapBridge } = require(path.join(root, "src", "lib", "mindmap.ts"));
  const Lens = require(path.join(root, "src", "components", "reader", "MindmapLens.tsx")).default;
  installMindmapBridge();
  const opened = [];
  const rootEl = createRoot(w.document.getElementById("root"));
  rootEl.render(React.createElement(React.StrictMode, null, React.createElement(Lens, {
    kernel, documentId: "doc-lens", title: "透镜测试", hidden: false, onOpenInMap: (id) => opened.push(id),
  })));
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => [...w.document.querySelectorAll(sel)];
  const text = () => ($(".mm2-lens") || {}).textContent || "";
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  console.log("---- 收起态 / 展开 / 读原文 ----");
  await sleep(50);
  check("收起态：只有结构轨，没有面板，也不读原文", !!$(".mm2-lens-rail") && !$(".mm2-lens") && store.listMaterialMaps("doc-lens").length === 0);
  click($(".mm2-lens-rail"));
  check("点结构轨展开面板", await until(() => !!$(".mm2-lens")));
  check("读完原文后：「这一节还没有图谱」+ 生成按钮 + 所在章节标题", await until(() => /这一节还没有图谱/.test(text()) && !!$(".mm2-lens-generate")) && /第一章 问题/.test(text()), text());
  check("此时零调用、未建版本", calls.length === 0 && store.listMaterialMaps("doc-lens").length === 0);

  console.log("---- 生成这一节 ----");
  click($(".mm2-lens-generate"));
  check("生成后出现要点之线（当前点高亮）", await until(() => !!$(".mm2-lens-item.is-current"), 8000), text());
  await engine.idle();
  check("只调用一次（只分析所在章节），且是第一章的块区间", calls.length === 1 && calls[0].kind === "outline", calls);
  const active = store.getActiveMaterialMap("doc-lens", "book");
  check("建了一个 v2 版本并激活", active && active.schemaVersion === 2);
  await until(() => $$(".mm2-lens-item").length >= 2, 3000);
  const cur1 = ($(".mm2-lens-item.is-current .mm2-lens-item-title") || {}).textContent;
  const loc1 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第2段】" });
  const want1 = store.listMaterialMapNodes(active.id).find((r) => r.nodeId === loc1.nodeId);
  check("当前点＝阅读位置所在的最深节点", want1 && cur1 === want1.title, { cur1, want: want1 && want1.title });
  check("珠子出现在线上", !!$(".mm2-lens-bead"));
  check("「深挖」按钮与当前点状态一致（more 才有）", !!$(".mm2-lens-item.is-current .mm2-lens-deepen") === (want1.state === "more"), want1.state);
  if (process.env.LENS_DUMP) { await sleep(400); require("fs").writeFileSync(process.env.LENS_DUMP, w.document.getElementById("root").innerHTML); }
  check("结构轨出现章节分段且已生成的一段为实", $$(".mm2-lens-rail-seg").length >= 2 && $$(".mm2-lens-rail-seg.is-done").length === 1 && !!$(".mm2-lens-rail-bead"));

  console.log("---- 阅读位置移动 → 当前点跟随 ----");
  relocate("u1.xhtml", "  【甲第15段】  ");
  const loc2 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第15段】" });
  const want2 = store.listMaterialMapNodes(active.id).find((r) => r.nodeId === loc2.nodeId);
  check("翻到本章后部：当前点换成后部的要点", await until(() => ($(".mm2-lens-item.is-current .mm2-lens-item-title") || {}).textContent === (want2 && want2.title), 3000) && want2.title !== cur1, { now: ($(".mm2-lens-item.is-current .mm2-lens-item-title") || {}).textContent, want2: want2 && want2.title });
  relocate("u2.xhtml", "【乙第3段】");
  check("翻到未生成的第二章：回到「这一节还没有图谱」", await until(() => /这一节还没有图谱/.test(text()) && /第二章 论证/.test(text()), 3000), text());
  relocate("u1.xhtml", "【甲第2段】");
  await until(() => !!$(".mm2-lens-item.is-current"), 3000);

  console.log("---- 跳正文 / 在图谱中打开 / 收起 ----");
  const other = $$(".mm2-lens-item:not(.is-current) .mm2-lens-item-btn")[0];
  const n0 = gotos.length;
  click(other);
  check("点同层另一要点：跳到对应单元并按原文片段定位", await until(() => gotos.length >= n0 + 2) && gotos[n0].href === "u1.xhtml" && typeof gotos[n0 + 1].search === "string" && gotos[n0 + 1].search.length >= 6, gotos.slice(n0));
  click([...w.document.querySelectorAll(".mm2-lens-link")].find((b) => /在图谱中打开/.test(b.textContent)));
  check("「在图谱中打开」带上当前节点 id", opened.length === 1 && opened[0] === loc1.nodeId, opened);
  w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  check("Esc 收起面板（结构轨保留）", await until(() => !$(".mm2-lens")) && !!$(".mm2-lens-rail"));
  check("全程无渲染错误", !errors.length, errors.slice(0, 3));

  rootEl.unmount();
  console.error = origErr;
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
