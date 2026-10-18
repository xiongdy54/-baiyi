// @runtime: node
// 结构图（阅读透镜 v2「聚焦图谱」）端到端 DOM 回归（node tests/m15v2.lens.dom.test.cjs）。
// 真实 MindmapLens.tsx（tsload 转译，包 React.StrictMode）+ jsdom + 真实主进程引擎 + 内存 store + 假流式模型 + 假内核
// （getReadingProbe / relocate / goTo / getCurrentLocation / setStructureHighlights 记录）。覆盖：关闭时不渲染不读原文 →
// 打开 → 「这一节还没有细分的图谱」→ 生成这一节（只调用一次）→ 聚焦图：整体 + 成员 + 焦点＝阅读位置的最深节点、关系线 →
// 正文强调焦点段落 → 悬停节点强调它的段落 → 单击＝在图里换焦点（不跳正文）→ 回到正在读的段落 → 阅读位置移动后焦点跟随 →
// 跳到原文（记下位置）→ 回到刚才读的位置 → 在完整图谱中打开 → 关闭。
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
const highlights = [];
let probe = { unitAnchor: "u1.xhtml", text: "【甲第2段】" };
let here = { cfi: "epubcfi(/6/4!/4/2)" };
const kernel = {
  getTOC: () => TOC,
  getSectionAnchors: () => UNITS.map((anchor) => ({ anchor })),
  getSectionText: async (a) => { await sleep(3); return TEXT[a] || ""; },
  getReadingProbe: () => probe,
  getCurrentLocation: () => here,
  setStructureHighlights: (regions) => { highlights.push(JSON.parse(JSON.stringify(regions))); },
  goTo: async (t) => { gotos.push(t); return true; },
  on: (ev, h) => { if (ev === "relocate") { relocateHandlers.add(h); return () => relocateHandlers.delete(h); } return () => {}; },
};
const relocate = (unitAnchor, text) => { probe = { unitAnchor, text }; for (const h of relocateHandlers) h({ location: {}, fraction: 0 }); };

// ---------- 假流式模型（第 2 行带一条「支」关系指向第 1 行） ----------
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
for (const m of ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExplain", "graphCancel", "graphNodeText", "graphLocate", "graphEnsureMap", "graphNodeAnchors"]) w.mindmapAPI[m] = inv((p) => engine[m](p));
w.aiAPI = { getConfig: async () => ({ hasKey: true }) };
const errors = [];
const origErr = console.error;
console.error = (...a) => errors.push(a.map(String).join(" ").slice(0, 600));

(async () => {
  const { installMindmapBridge } = require(path.join(root, "src", "lib", "mindmap.ts"));
  const Lens = require(path.join(root, "src", "components", "reader", "MindmapLens.tsx")).default;
  installMindmapBridge();
  const opened = [];
  let closed = 0;
  let setOpen = null;
  function Host() {
    const [open, so] = React.useState(false);
    setOpen = so;
    return React.createElement(Lens, { kernel, documentId: "doc-lens", title: "透镜测试", open, hidden: false, onClose: () => { closed++; so(false); }, onOpenInMap: (id) => opened.push(id) });
  }
  const rootEl = createRoot(w.document.getElementById("root"));
  rootEl.render(React.createElement(React.StrictMode, null, React.createElement(Host)));
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => [...w.document.querySelectorAll(sel)];
  const text = () => ($(".mm2-focus") || {}).textContent || "";
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const dbl = (el) => el.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  const hover = (el) => el.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
  const focusCardId = () => ($(".mm2f-node.is-focus") || { getAttribute: () => null }).getAttribute("data-node-id");
  const lastHl = () => highlights[highlights.length - 1] || [];

  console.log("---- 关闭态 / 打开 / 读原文 ----");
  await sleep(50);
  check("关闭时：不渲染面板、不读原文、没有任何常驻细轨", !$(".mm2-focus") && !$(".mm2-lens-rail") && store.listMaterialMaps("doc-lens").length === 0);
  setOpen(true);
  check("工具栏打开后出现停靠面板", await until(() => !!$(".mm2-focus")));
  check("读完原文后：「这一节还没有细分的图谱」+ 生成按钮 + 所在章节标题", await until(() => /这一节还没有细分的图谱/.test(text()) && !!$(".mm2-focus-generate")) && /第一章 问题/.test(text()), text());
  check("此时零调用、未建版本", calls.length === 0 && store.listMaterialMaps("doc-lens").length === 0);

  console.log("---- 生成这一节 → 聚焦图 ----");
  click($(".mm2-focus-generate"));
  await engine.idle();
  check("只调用一次（只分析所在章节）", await until(() => calls.length === 1) && calls[0].kind === "outline", calls);
  const active = store.getActiveMaterialMap("doc-lens", "book");
  check("建了一个 v2 版本并激活", active && active.schemaVersion === 2);
  let loc1 = null;
  const locNow = () => (loc1 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第2段】" }));
  check("图里的焦点卡＝阅读位置所在的最深节点，并标「正在读」", await until(() => focusCardId() === locNow().nodeId, 8000) && !!$(".mm2f-node.is-focus.is-reading"), { now: focusCardId(), want: loc1.nodeId });
  await engine.idle();
  await until(() => focusCardId() === locNow().nodeId, 3000);
  console.log("    (calls so far: " + calls.length + ")");
  const rows = store.listMaterialMapNodes(active.id);
  const fRow = rows.find((r) => r.nodeId === loc1.nodeId);
  check("上方是它所属的整体（父节点）", !!$(`.mm2f-node.is-whole[data-node-id="${fRow.parentId}"]`), fRow.parentId);
  const sibs = rows.filter((r) => r.parentId === fRow.parentId);
  check("左侧树干串起同一整体下的全部成员", await until(() => $$(".mm2f-node.is-member, .mm2f-node.is-focus").length === sibs.length) && $$(".mm2f-tree-line").length >= sibs.length, { got: $$(".mm2f-node").length, sibs: sibs.length });
  check("成员之间的关系画成带码的关系线（「支」）", $$(".mm2f-rel").length >= 1 && /支/.test(($(".mm2f-rel-badge text") || {}).textContent || ""));
  check("是真正的图：SVG 节点 + 连线，不是文字列表", !!$("svg.mm2-focus-svg") && !$("ol") && !$(".mm2-lens-thread"));
  check("详情区：焦点标题 + 跳到原文 + 在完整图谱中打开", /跳到原文/.test(text()) && /在完整图谱中打开/.test(text()) && ($(".mm2-focus-detail-title") || {}).textContent === fRow.title);
  check("图例列出出现的关系", /支持/.test(($(".mm2-focus-legend") || {}).textContent || ""));

  console.log("---- 正文强调 ----");
  const flat = (x) => String(x).replace(/\s+/g, "");
  check("焦点节点对应的段落在正文里强调（unit u1，首探针来自该段原文）", await until(() => lastHl().some((r) => r.tone === "focus" && r.unitAnchor === "u1.xhtml" && flat(TEXT["u1.xhtml"]).includes(flat(r.head)))), lastHl());
  const other = $$(".mm2f-node.is-member")[0];
  const otherId = other.getAttribute("data-node-id");
  hover(other);
  check("指针停在另一个节点上：它的段落也亮起（hover 档），焦点段保留", await until(() => lastHl().some((r) => r.tone === "hover") && lastHl().some((r) => r.tone === "focus")), lastHl());

  console.log("---- 单击＝在图里查看（不跳正文）/ 回到正在读的段落 ----");
  const g0 = gotos.length;
  click(other);
  check("单击成员：焦点换成它、进入「浏览中」，正文不跳", await until(() => focusCardId() === otherId) && /浏览中/.test(text()) && gotos.length === g0, { f: focusCardId(), otherId, gotos: gotos.slice(g0) });
  check("浏览中仍能看出「正在读」的那一点", !!$(`.mm2f-node.is-reading[data-node-id="${loc1.nodeId}"]`));
  check("出现「回到正在读的段落」", !!$("[data-mm2-follow]"));
  click($("[data-mm2-follow]"));
  check("回到跟随：焦点回到阅读位置", await until(() => focusCardId() === loc1.nodeId) && /跟随阅读/.test(text()));

  console.log("---- 阅读位置移动 → 焦点跟随 ----");
  relocate("u1.xhtml", "  【甲第15段】  ");
  const loc2 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第15段】" });
  check("翻到本章后部：焦点换成后部的要点", await until(() => focusCardId() === loc2.nodeId, 3000) && loc2.nodeId !== loc1.nodeId, { now: focusCardId(), want: loc2.nodeId });
  relocate("u2.xhtml", "【乙第3段】");
  check("翻到未生成的第二章：提示生成", await until(() => /这一节还没有细分的图谱/.test(text()) && /第二章 论证/.test(text()), 3000), text());
  relocate("u1.xhtml", "【甲第2段】");
  await until(() => focusCardId() === loc1.nodeId, 3000);

  console.log("---- 跳到原文 / 回到刚才读的位置 ----");
  const node2 = $(`.mm2f-node[data-node-id="${otherId}"]`);
  const g1 = gotos.length;
  dbl(node2);
  check("双击节点：跳到对应单元并按原文片段定位", await until(() => gotos.length >= g1 + 2) && gotos[g1].href === "u1.xhtml" && typeof gotos[g1 + 1].search === "string", gotos.slice(g1));
  check("跳之前记下了阅读位置：出现「回到刚才读的位置」", await until(() => !!$("[data-mm2-back]")));
  here = { cfi: "epubcfi(/6/4!/4/90)" };
  const g2 = gotos.length;
  click($("[data-mm2-back]"));
  check("点「回到刚才读的位置」回到跳转前的 cfi", await until(() => gotos.length === g2 + 1) && gotos[g2].cfi === "epubcfi(/6/4!/4/2)" && !$("[data-mm2-back]"), gotos.slice(g2));

  console.log("---- 在完整图谱中打开 / 关闭 ----");
  await until(() => focusCardId() === loc1.nodeId, 3000);
  click([...w.document.querySelectorAll(".mm2-focus-link")].find((b) => /在完整图谱中打开/.test(b.textContent)));
  check("「在完整图谱中打开」带上焦点节点 id", opened.length === 1 && opened[0] === focusCardId(), opened);
  // 摆放：按版式自动（本夹具是「要点」树 → 浮窗）；可手动切到正文下方再切回
  check("按版式自动摆放：树形结构 → 浮窗，标出结构类型", $(".mm2-focus").getAttribute("data-host") === "float" && !!$("[data-mm2-pattern]"), [$(".mm2-focus").getAttribute("data-host"), ($("[data-mm2-pattern]") || {}).textContent]);
  click($("[data-mm2-host-toggle]"));
  check("手动切到正文下方", await until(() => $(".mm2-focus").getAttribute("data-host") === "dock"));
  click($("[data-mm2-host-toggle]"));
  check("再切回浮窗（回到自动）", await until(() => $(".mm2-focus").getAttribute("data-host") === "float") && w.localStorage.getItem("mm2.lens.host") === '"auto"', w.localStorage.getItem("mm2.lens.host"));
  click($("[data-mm2-close]"));
  check("关闭：面板消失、正文强调清空", await until(() => !$(".mm2-focus")) && closed === 1 && lastHl().length === 0, lastHl());
  check("全程无渲染错误", !errors.length, errors.slice(0, 3));

  rootEl.unmount();
  console.error = origErr;
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
