// @runtime: system-node
// 结构图（阅读透镜 v2「聚焦图谱」）端到端 DOM 回归（node tests/m15v2.lens.dom.test.cjs）。
// 真实 MindmapLens.tsx（tsload 转译，包 React.StrictMode）+ jsdom + 真实主进程引擎 + 内存 store + 假流式模型 + 假内核
// （getReadingProbe / relocate / goTo / getCurrentLocation / setStructureHighlights 记录）。
// 第五轮：透镜面板里放的不再是「裁出来的小图」，而是**与图谱页签同一套 MindmapCanvasV2 画完整结构图**。
// 第六轮（D194）：① 正在阅读的节点改成整卡主题色底 + 白字（不再只是描边）；② 父链截断——
//   以阅读节点的**直接父节点**为图的顶（更高层级的父节点不展示，想看就点「在完整图谱中打开」）；
//   ③ 「在完整图谱中打开」同时把透镜展示过的区域带过去，跳过去后短暂高亮定位。
// 覆盖：关闭时不渲染不读原文 → 打开 → 「这一节还没有细分的图谱」→ 生成这一节（只调用一次）→ 完整图谱画布：
//   阅读节点整卡标出且居中、顶卡＝截断点（父节点标题，更高层级不出现）、同一整体的成员都在图上、关系线带标签、头部标出结构类型 →
//   正文强调焦点段落 → 悬停节点强调它的段落 → 分叉默认收起（折叠徽标）→ 点击展开（走同一套生长动画：刚到达虚线描边）→
//   点击收起 → 单击＝选中（不跳正文）→ 回到正在读的段落 → 跳到原文（记下位置）→ 回到刚才读的位置 →
//   讲解可收起（把手在内容上方）→ 在完整图谱中打开（带当前节点 id + 透镜区域）→ 关闭清强调。
// 第七轮（D197）：面板搬进独立窗口——本套件就地把面板渲染出来（独立窗口的跨进程宿主与窗口行为
//   由 electron 侧承担），因此只断言「面板本体不再暴露摆放切换（data-mm2-host-toggle / data-host）」。
const path = require("path");
const root = path.join(__dirname, "..");

const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true }); } catch { /* 只读跳过 */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
w.HTMLElement.prototype.scrollIntoView = function () {};
// 画布要靠 getBoundingClientRect 算适配 / 居中 / reveal：jsdom 默认全 0 → 会和 MindmapCanvasV2 的「宿主无尺寸」守卫打架
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
  const kind = opts.maxTokens === 3000 ? "outline" : opts.maxTokens === 1500 ? "expand" : "explain";
  let raw;
  if (kind === "explain") {
    calls.push({ kind });
    raw = "这一步在说明：该段先提出问题，再给出回答。";
  } else {
    const user = opts.messages[1].content;
    const m = /【原文块号】\[(\d+)\](?:–\[(\d+)\])?/.exec(user);
    calls.push({ lo: Number(m[1]), hi: Number(m[2] || m[1]), kind });
    raw = genLines(Number(m[1]), Number(m[2] || m[1])).map((l) => l + "\n").join("");
  }
  for (let i = 0; i < raw.length; i += 10) { send({ delta: raw.slice(i, i + 10) }); await sleep(10); }
  return { usage: { prompt_tokens: 1, completion_tokens: 1 }, finishReason: "stop", ttftMs: 1, firstByteMs: 1 };
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
const inv = (fn) => (p) => new Promise((res, rej) => setTimeout(() => { try { res(clone(fn(clone(p)))); } catch (e) { rej(e); } }, 1));
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

(async () => {
  const { installMindmapBridge } = require(path.join(root, "src", "lib", "mindmap.ts"));
  const Lens = require(path.join(root, "src", "components", "reader", "MindmapLens.tsx")).default;
  installMindmapBridge();
  const opened = [];
  let closed = 0;
  let setOpen = null;
  let setVis = null;
  function Host() {
    const [open, so] = React.useState(false);
    // D199：独立窗口「关闭＝隐藏」，面板仍挂载 → visible 由宿主给出，收起时正文强调必须收回
    const [vis, sv] = React.useState(true);
    setOpen = so;
    setVis = sv;
    return React.createElement(Lens, { kernel, documentId: "doc-lens", title: "透镜测试", open, hidden: false, visible: vis, onClose: () => { closed++; so(false); }, onOpenInMap: (id, region) => opened.push({ id, region }) });
  }
  const rootEl = createRoot(w.document.getElementById("root"));
  rootEl.render(React.createElement(React.StrictMode, null, React.createElement(Host)));
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => [...w.document.querySelectorAll(sel)];
  const text = () => ($(".mm2-focus") || {}).textContent || "";
  const canvas = () => $(".mm2-focus-canvas");
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const dbl = (el) => el.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  const hover = (el) => el.dispatchEvent(new w.MouseEvent("pointermove", { bubbles: true }));
  const card = (id) => $(`.mm2-focus-canvas svg g[data-node-id="${id}"]`);
  const cards = () => $$(".mm2-focus-canvas svg [data-node-id]");
  const selId = () => ($(".mm2-focus-canvas svg [data-sel='1']") || { getAttribute: () => null }).getAttribute("data-node-id");
  const readId = () => ($(".mm2-focus-canvas svg [data-reading='1']") || { getAttribute: () => null }).getAttribute("data-node-id");
  const lastHl = () => highlights[highlights.length - 1] || [];

  console.log("---- 关闭态 / 打开 / 读原文 ----");
  await sleep(50);
  check("关闭时：不渲染面板、不读原文、未建版本", !$(".mm2-focus") && store.listMaterialMaps("doc-lens").length === 0);
  setOpen(true);
  check("工具栏打开后出现面板", await until(() => !!$(".mm2-focus")));
  check("读完原文后：「这一节还没有细分的图谱」+ 生成按钮", await until(() => /这一节还没有细分的图谱/.test(text()) && !!$(".mm2-focus-generate")));
  check("此时零调用、未建版本", calls.length === 0 && store.listMaterialMaps("doc-lens").length === 0);

  console.log("---- 生成这一节 → 完整图谱画布 ----");
  click($(".mm2-focus-generate"));
  await engine.idle();
  check("只调用一次（只分析所在章节）", await until(() => calls.length === 1) && calls[0].kind === "outline", calls);
  const active = store.getActiveMaterialMap("doc-lens", "book");
  check("建了一个 v2 版本并激活", active && active.schemaVersion === 2);
  // 骨架先落库、AI 子节点随后到达：等子节点真进了 store 再算期望（否则拿到的还是目录层级）
  await until(() => store.listMaterialMapNodes(active.id).some((r) => /\./.test(r.nodeId)), 8000);
  const loc1 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第2段】" });
  check("面板里是完整图谱画布：真正的 SVG 节点 + 连线，不是文字列表", await until(() => !!$(".mm2-focus-canvas svg.mm2-svg") && cards().length >= 3) && !$("ol") && !$(".mm2-lens-thread"), { cards: cards().length });
  check("阅读位置所在节点被标出（data-reading）", await until(() => readId() === loc1.nodeId, 8000), { read: readId(), want: loc1.nodeId });
  check("跟随阅读时它就是「选中」的那个", selId() === loc1.nodeId, { sel: selId(), want: loc1.nodeId });
  await engine.idle();
  await until(() => readId() === loc1.nodeId, 4000);
  const rows = store.listMaterialMapNodes(active.id);
  const fRow = rows.find((r) => r.nodeId === loc1.nodeId);
  const parentRow = rows.find((r) => r.nodeId === fRow.parentId);
  const svgIds = () => cards().map((c) => c.getAttribute("data-node-id"));
  const svgText = () => (($(".mm2-focus-canvas svg") || {}).textContent || "");
  const rootCard = () => card("@root");
  // 第六轮（D194）：父链截断——以阅读节点的**直接父节点**为图的顶；更高层级父节点（书根 / 目录 / 章）一律不展示
  check(
    "父链截断：以阅读节点的直接父节点为顶，更高层级的父节点不展示",
    await until(() => !card(fRow.parentId) && !svgIds().some((id) => id === "t0" || id === "t1" || id === "t3") && svgText().includes(parentRow.title), 8000),
    { parent: fRow.parentId, parentTitle: parentRow.title, ids: svgIds() },
  );
  check("顶卡承载截断点的标题（原树上它是普通节点，透镜里升格为顶）", await until(() => !!rootCard() && (rootCard().textContent || "").includes(parentRow.title), 6000), (rootCard() || {}).textContent);
  const sibs = rows.filter((r) => r.parentId === fRow.parentId);
  check("同一整体下的全部成员都画出来（与完整图谱同一排布）", sibs.length >= 2 && sibs.every((r) => !!card(r.nodeId)), { sibs: sibs.map((r) => r.nodeId), drawn: sibs.filter((r) => !!card(r.nodeId)).length });
  const relCount = () => $$(".mm2-focus-canvas svg [data-edge-id]").length;
  check("成员之间的关系连成关系线（带关系码 / 标签）", relCount() >= 1 && /支持|支/.test(svgText()), { edges: relCount() });
  check("头部标出结构类型（保留「图谱类型」）", !!$("[data-mm2-pattern]") && ($("[data-mm2-pattern]").textContent || "").length > 0, ($("[data-mm2-pattern]") || {}).textContent);
  check("详情区：跳到原文 + 在完整图谱中打开（不再重复节点标题）", /跳到原文/.test(text()) && /在完整图谱中打开/.test(text()) && !$(".mm2-focus-detail-title"));

  console.log("---- 正文强调 ----");
  const flat = (x) => String(x).replace(/\s+/g, "");
  check("焦点节点对应的段落在正文里强调（unit u1，首探针来自该段原文）", await until(() => lastHl().some((r) => r.tone === "focus" && r.unitAnchor === "u1.xhtml" && flat(TEXT["u1.xhtml"]).includes(flat(r.head)))), lastHl());
  const otherId = sibs.find((r) => r.nodeId !== loc1.nodeId).nodeId;
  hover(card(otherId));
  check("指针停在另一个节点上：它的段落也亮起（hover 档），焦点段保留", await until(() => lastHl().some((r) => r.tone === "hover") && lastHl().some((r) => r.tone === "focus")), lastHl());

  console.log("---- 分叉默认收起 / 点击展开（与完整图谱同一套生长动画） ----");
  // 把阅读位置挪到还没生成细分的第二章：它的节点还是目录层级的「第二章 论证」，
  // 直接父节点＝书根下的一层 → 透镜以它为顶（顶卡标题＝材料名）；「第一章 问题」有子节点 → 按规则默认收起（卡片上是「+N」徽标）
  relocate("u2.xhtml", "【乙第3段】");
  const locU2 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u2.xhtml", text: "【乙第3段】" });
  check("翻到未生成的第二章：提示生成", await until(() => /这一节还没有细分的图谱/.test(text()) && !!$(".mm2-focus-generate"), 6000), text().slice(0, 200));
  check("阅读节点标出换成第二章（截断点到书根下一层，顶卡标题＝材料名）", await until(() => readId() === locU2.nodeId && svgText().includes("透镜测试"), 8000), { read: readId(), want: locU2.nodeId });
  const foldCh1 = () => $(`.mm2-focus-canvas svg [data-act="unfold"][data-node-id="t2"]`);
  check("阅读位置之外的分叉默认收起（「第一章 问题」卡片上是「+3」折叠徽标）", await until(() => !!foldCh1() && !card("t2.1"), 6000), { fold: !!foldCh1(), ids: svgIds() });
  const n0 = cards().length;
  click(foldCh1());
  check("点击折叠徽标＝展开分叉：子节点画出来", await until(() => !!card("t2.1") && !!card("t2.2") && !!card("t2.3"), 4000) && cards().length > n0, { n0, now: cards().length });
  check("展开走完整图谱同一套生长动画（刚到达的节点是虚线描边）", $$(".mm2-focus-canvas svg rect[stroke-dasharray]").length >= 1, $$(".mm2-focus-canvas svg rect[stroke-dasharray]").length);
  click(card("t2"));
  check("点击节点＝收起它的分叉（子节点从图上退场）", await until(() => !card("t2.1") && !card("t2.2") && !card("t2.3"), 4000), { ids: svgIds() });
  click(card("t2"));
  check("再点节点＝又展开", await until(() => !!card("t2.1"), 4000));
  click(card("t2")); // 收回去
  await until(() => !card("t2.1"), 4000);
  click($("[data-mm2-follow]")); // 回到跟随，别把「浏览中」带进后面的断言
  await until(() => !$(".mm2-focus-mode.is-browsing"), 4000);
  // 第二章生成一份：只再调一次（outline）
  click($(".mm2-focus-generate"));
  await engine.idle();
  check("第二章只再调一次（outline）", await until(() => calls.filter((c) => c.kind === "outline").length === 2, 8000), calls);
  relocate("u1.xhtml", "【甲第2段】");
  await until(() => readId() === loc1.nodeId, 4000);

  console.log("---- 单击＝选中（不跳正文）/ 回到正在读的段落 ----");
  const g0 = gotos.length;
  click(card(otherId));
  check("单击成员：选中换成它、进入「浏览中」，正文不跳", await until(() => selId() === otherId, 4000) && /浏览中/.test(text()) && gotos.length === g0, { sel: selId(), otherId, gotos: gotos.slice(g0) });
  check("浏览中仍能看出「正在读」的那一点", readId() === loc1.nodeId, { read: readId(), want: loc1.nodeId });
  check("出现「回到正在读的段落」", !!$("[data-mm2-follow]"));
  click($("[data-mm2-follow]"));
  check("回到跟随：选中回到阅读位置（「浏览中」提示消失）", await until(() => selId() === loc1.nodeId, 4000) && !$(".mm2-focus-mode.is-browsing"));

  console.log("---- 阅读位置移动 → 跟随 ----");
  relocate("u1.xhtml", "  【甲第15段】  ");
  const loc2 = engine.graphLocate({ documentId: "doc-lens", unitAnchor: "u1.xhtml", text: "【甲第15段】" });
  check("翻到本章后部：阅读节点标出换成后部的要点", await until(() => readId() === loc2.nodeId, 4000) && loc2.nodeId !== loc1.nodeId, { read: readId(), want: loc2.nodeId });
  relocate("u1.xhtml", "【甲第2段】");
  await until(() => readId() === loc1.nodeId, 4000);

  console.log("---- 跳到原文 / 回到刚才读的位置 ----");
  const g1 = gotos.length;
  dbl(card(otherId));
  check("双击节点：跳到对应单元（href 跳转成功即不再整书搜索兜底）", await until(() => gotos.length >= g1 + 1, 4000) && gotos[g1].href === "u1.xhtml" && gotos.length === g1 + 1, gotos.slice(g1));
  check("跳之前记下了阅读位置：出现「回到刚才读的位置」", await until(() => !!$("[data-mm2-back]")));
  here = { cfi: "epubcfi(/6/4!/4/90)" };
  const g2 = gotos.length;
  click($("[data-mm2-back]"));
  check("点「回到刚才读的位置」回到跳转前的 cfi", await until(() => gotos.length === g2 + 1, 4000) && gotos[g2].cfi === "epubcfi(/6/4!/4/2)" && !$("[data-mm2-back]"), gotos.slice(g2));

  console.log("---- 「它在说什么」输出可收起 ----");
  await until(() => selId() === loc1.nodeId, 4000);
  const explainBtn = () => [...w.document.querySelectorAll(".mm2-focus-btn")].find((b) => /它在说什么/.test(b.textContent));
  check("有「它在说什么」按钮（AI 节点 + 有模型）", !!explainBtn());
  click(explainBtn());
  const clip = () => $(".mm2-focus-detail .wb-explain-clip");
  const toggle = () => $(".mm2-focus-detail .wb-explain-toggle");
  check("输出到达即展开：复用制卡台 AI 解释的收起骨架（.wb-explain-clip.is-open + .wb-explain-toggle，把手在正文上方、箭头朝上）", await until(() => !!clip() && clip().classList.contains("is-open") && !!toggle()) && !!toggle().querySelector(".is-flip") && clip().compareDocumentPosition(toggle()) & 2 /* 正文在把手之后 = 把手在上方 */, toggle().outerHTML.slice(0, 200));
  click(toggle());
  check("点把手收起：去掉 is-open、箭头翻回朝下", await until(() => !!clip() && !clip().classList.contains("is-open")) && !toggle().querySelector(".is-flip"));
  click(toggle());
  check("再点把手展开回来", await until(() => !!clip() && clip().classList.contains("is-open")) && !!toggle().querySelector(".is-flip"));

  console.log("---- 在完整图谱中打开 / 关闭 ----");
  await until(() => selId() === loc1.nodeId, 4000);
  click([...w.document.querySelectorAll(".mm2-focus-link")].find((b) => /在完整图谱中打开/.test(b.textContent)));
  check("「在完整图谱中打开」带上当前节点 id", opened.length === 1 && opened[0].id === loc1.nodeId, { opened, want: loc1.nodeId });
  // 第六轮（D194 需求③）：跳过去后要把透镜**展示过的那一片**在完整图谱里短暂框出来，便于定位 →
  // 区域＝顶节点（截断点）＋它下面所有没收起的后代；更高层的父节点不在里面
  check(
    "同时带上「透镜展示过的区域」（顶节点 + 未收起的后代），用于跳过去后高亮定位",
    Array.isArray(opened[0].region) && opened[0].region.includes(fRow.parentId) && opened[0].region.includes(loc1.nodeId) && sibs.every((r) => opened[0].region.includes(r.nodeId)) && !opened[0].region.includes("t0"),
    opened[0],
  );
  // 第七轮（D197）：面板搬进独立窗口，「浮窗 / 正文下方」摆放切换与自绘拖动 / 缩放退役——
  // 面板本体不再暴露摆放开关与 data-host（窗口的四边 / 边角缩放由系统原生承担）。
  check(
    "标出结构类型；面板已不含「浮窗 / 正文下方」摆放切换（改由独立窗口承载）",
    !!$("[data-mm2-pattern]") && !$("[data-mm2-host-toggle]") && $(".mm2-focus").getAttribute("data-host") === null,
    [($("[data-mm2-pattern]") || {}).textContent, $(".mm2-focus").getAttribute("data-host")]
  );
  // D199（用户 2026-10-19 实测）：独立窗口「关闭＝隐藏」时面板仍挂载，正文强调必须跟着收回。
  // 面板仍打开的前提下把窗口置为不可见，断言强调层收空；再呼出（visible=true）断言重新贴上。
  console.log("---- 窗口收起（关闭＝隐藏）时正文强调收回 ----");
  setVis(false);
  check("窗口不可见：正文强调收回（不再是焦点/悬停亮着）", await until(() => lastHl().length === 0, 4000) && !!$(".mm2-focus"), lastHl());
  setVis(true);
  check("窗口重新呼出：强调随面板回到正文（焦点段重新贴上）", await until(() => lastHl().some((r) => r.tone === "focus" && r.unitAnchor === "u1.xhtml"), 4000), lastHl());
  click($("[data-mm2-close]"));
  check("关闭：面板消失、正文强调清空", await until(() => !$(".mm2-focus")) && closed === 1 && lastHl().length === 0, lastHl());
  check("全程无渲染错误", !errors.length, errors.slice(0, 3));

  rootEl.unmount();
  console.error = origErr;
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
