// D238 Mermaid 读态加固：图表源码提取 / 字体快照 / SVG 净化。
// @runtime: system-node  @tier: 2  @gui: false  @id: D238MERMAID  @timeout: 180
// 覆盖（jsdom + 真实 React 渲染 ReadMarkdown → MermaidDiagram → MermaidDiagramImpl → pele/lazy）：
//   A 源码提取：代码块 children 为多段（原始 HTML <pre><code class="language-mermaid"> 夹注释 / <mark>）时
//     按原文直接拼接（原 String(数组) 以逗号拼接 → 语法错误回落 / 画错）；空白包裹的 <pre> 照样拆壳；非 mermaid 代码块不变。
//   C SVG 净化：教程 33 种图型经组件渲染后与 pele 原始输出结构逐项相同（净化不伤正常图表）；
//     替身 pele 产出恶意 SVG（script / 事件属性 / javascript: 链接 / foreignObject / 远程 image / 整页 style）→ 全部剔除，
//     正常链接 / role 保留。
//   B 字体快照：多图同屏 + 父组件反复重渲染不再读计算样式；<head> 样式表 / <html> class 改字体 → 下一帧重绘为新字体；
//     无关属性变化不重绘；页面上已无图表时停止观察。
//   S 源码契约：dangerouslySetInnerHTML 之前必经 sanitizeSvg；ReadMarkdown 不再 String(children)。
const fs = require("fs");
const path = require("path");

const ROOT = fs.realpathSync(path.resolve(__dirname, ".."));
const TMP = path.join(ROOT, "tests", "tmp-d238");
let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await tick(15);
  }
  return !!fn();
}

/** 元素树清单：按文档顺序记录 标签 / 排序后的属性 / 直接文本（id 前缀归一，便于跨渲染比较） */
function inventory(root) {
  const norm = (v) => String(v).replace(/pele-\d+-|P-/g, "ID-");
  const out = [];
  const walk = (el) => {
    const attrs = [...el.attributes].map((a) => `${a.name}=${norm(a.value)}`).sort().join(" ");
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("");
    out.push(`${el.tagName}[${attrs}]${text ? "«" + text + "»" : ""}`);
    for (const c of el.children) walk(c);
  };
  walk(root);
  return out;
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const esbuild = require("esbuild");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  global.navigator = w.navigator;
  global.HTMLElement = w.HTMLElement;
  global.Element = w.Element;
  global.Node = w.Node;
  global.DocumentFragment = w.DocumentFragment;
  global.MutationObserver = w.MutationObserver;
  let cssReads = 0;
  global.getComputedStyle = (el, pseudo) => { cssReads++; return w.getComputedStyle(el, pseudo); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;

  const probe = [
    'import React, { useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    'import { flushSync } from "react-dom";',
    'import ReadMarkdown from "../../src/components/editor/ReadMarkdown";',
    'import MermaidDiagramImpl from "../../src/components/editor/MermaidDiagramImpl";',
    "let bump: (() => void) | null = null;",
    "function Many({ codes }: { codes: string[] }) { const [n, setN] = useState(0); bump = () => setN((x) => x + 1); return <div data-n={n}>{codes.map((c, i) => <MermaidDiagramImpl key={i} code={c} />)}</div>; }",
    "export function mountMd(el: HTMLElement, text: string) { const root = createRoot(el); flushSync(() => root.render(<ReadMarkdown text={text} />)); return root; }",
    "export function mountImpl(el: HTMLElement, code: string) { const root = createRoot(el); flushSync(() => root.render(<MermaidDiagramImpl code={code} />)); return root; }",
    "export function mountMany(el: HTMLElement, codes: string[]) { const root = createRoot(el); flushSync(() => root.render(<Many codes={codes} />)); return root; }",
    "export function rerender() { flushSync(() => bump && bump()); }"
  ].join("\n");
  const entry = path.join(TMP, "probe.tsx");
  fs.writeFileSync(entry, probe);
  const opts = { entryPoints: [entry], bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } };
  esbuild.buildSync({ ...opts, outfile: path.join(TMP, "probe.bundle.cjs") });
  // 替身 pele：render 原样返回测试给定的 SVG（验证净化层本身，而不是 pele 的转义）
  const fake = path.join(TMP, "fake-pele.mjs");
  fs.writeFileSync(fake, [
    'export const detectType = () => "flowchart";',
    "export const registered = () => true;",
    "export const load = () => Promise.resolve();",
    'export const render = () => ({ svg: globalThis.__FAKE_SVG__ || "<svg></svg>", type: "flowchart" });'
  ].join("\n"));
  esbuild.buildSync({ ...opts, outfile: path.join(TMP, "probe-fake.bundle.cjs"), alias: { "pele/lazy": fake } });
  const P = require(path.join(TMP, "probe.bundle.cjs"));

  const host = () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  };
  const settle = (el) => until(() => !el.querySelector(".mermaid-loading") && !!el.querySelector(".mermaid-diagram, .mermaid-fallback, pre"));

  // ---------------- A 源码提取 ----------------
  console.log("== A 图表源码提取（ReadMarkdown） ==");
  async function md(text) {
    const el = host();
    const root = P.mountMd(el, text);
    await settle(el);
    await tick(30);
    return { el, root };
  }
  {
    const { el, root } = await md("```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```");
    check("A1 普通 ```mermaid 围栏出图", !!el.querySelector(".mermaid-diagram svg") && !el.querySelector(".mermaid-fallback"), el.innerHTML.slice(0, 200));
    root.unmount(); el.remove();
  }
  {
    // 原始 HTML 代码块夹注释：净化删掉注释后剩两段相邻文本 → children = ["…A[甲", "乙] --> B[丙]"]
    const { el, root } = await md('<pre><code class="language-mermaid">flowchart TD\n  A[甲<!-- 注释 -->乙] --> B[丙]</code></pre>');
    const svg = el.querySelector(".mermaid-diagram svg");
    check("A2 代码块夹注释（多段文本）照样出图", !!svg && !el.querySelector(".mermaid-fallback"), el.innerHTML.slice(0, 240));
    check("A2b 两段直接相接：节点文字是「甲乙」（原 String(数组) 拼成「甲,乙」）", !!svg && svg.textContent.includes("甲乙") && !svg.textContent.includes("甲,乙"), svg && svg.textContent);
    root.unmount(); el.remove();
  }
  {
    // 行内元素：<mark> 是元素 → 原 String() 得 [object Object]
    const { el, root } = await md('<pre><code class="language-mermaid">flowchart TD\n  A[开始] --> B[<mark>高亮</mark>结束]</code></pre>');
    const svg = el.querySelector(".mermaid-diagram svg");
    check("A3 代码块夹 <mark> 行内元素：按原文出图（取元素内文字）", !!svg && svg.textContent.includes("高亮结束") && !el.textContent.includes("[object Object]"), el.innerHTML.slice(0, 240));
    root.unmount(); el.remove();
  }
  {
    const { el, root } = await md('<pre>\n<code class="language-mermaid">flowchart TD\n  A --> B</code>\n</pre>');
    check("A4 空白包裹的 <pre> 也拆壳（图表不嵌在 <pre> 里）", !!el.querySelector(".mermaid-diagram svg") && !el.querySelector("pre .mermaid-diagram"), el.innerHTML.slice(0, 240));
    root.unmount(); el.remove();
  }
  {
    const { el, root } = await md("```js\nconst a = [1, 2];\n```\n\n行内 `code` 不变");
    const pre = el.querySelector("pre > code.language-js");
    check("A5 非 mermaid 代码块原样（<pre><code class=language-js>）", !!pre && pre.textContent === "const a = [1, 2];\n" && !el.querySelector(".mermaid-diagram"), el.innerHTML.slice(0, 200));
    check("A5b 行内 code 原样", !!el.querySelector("p > code") && el.querySelector("p > code").textContent === "code", el.innerHTML.slice(0, 200));
    root.unmount(); el.remove();
  }

  // ---------------- C SVG 净化 ----------------
  console.log("== C SVG 净化 ==");
  const { render: peleRender } = await import("pele");
  const mdRaw = fs.readFileSync(path.join(ROOT, "docs", "tutorial", "使用教程.md"), "utf8").replace(/````[\s\S]*?````/g, "");
  const blocks = [...mdRaw.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  let same = 0;
  let firstDiff = null;
  const types = new Set();
  for (const code of blocks) {
    const el = host();
    const root = P.mountImpl(el, code);
    await settle(el);
    const got = el.querySelector(".mermaid-diagram svg");
    const rawOf = (prefix) => peleRender(code, { idPrefix: prefix, images: false });
    const invOf = (svg) => inventory(new w.DOMParser().parseFromString(svg, "image/svg+xml").documentElement);
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const raw = rawOf("P-");
    types.add(raw.type);
    const a = got ? inventory(got) : ["<无图>"];
    const b = invOf(raw.svg);
    // 个别图型（cynefin 手绘边）以 idPrefix 作抖动种子：前缀不同几何就不同——按组件实际用过的前缀（pele-N-）找回再比
    let ok = eq(a, b);
    for (let n = 1; !ok && n <= 400; n++) ok = eq(a, invOf(rawOf(`pele-${n}-`).svg));
    if (ok) same++;
    else if (!firstDiff) {
      const i = a.findIndex((x, k) => x !== b[k]);
      firstDiff = `${code.split("\n")[0]} #${i}: 组件=${a[i]} / 原始=${b[i]}`;
    }
    root.unmount(); el.remove();
  }
  check("C1 教程 33 种图型经净化后与 pele 原始输出结构逐项相同（不伤正常图表）", same === blocks.length && types.size === 33, `${same}/${blocks.length}（${types.size} 型）${firstDiff || ""}`);

  // 替身 pele：净化层本身
  const F = require(path.join(TMP, "probe-fake.bundle.cjs"));
  globalThis.__FAKE_SVG__ = [
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-roledescription="flowchart" onload="window.__pwn=1" class="pele">',
    "<script>window.__pwn=2</script>",
    "<style>body{display:none}</style>",
    '<a href="javascript:window.__pwn=3"><text x="1" y="1" onclick="window.__pwn=4">坏链接</text></a>',
    '<foreignObject width="10" height="10"><iframe src="https://evil.example/"></iframe><img src="x" onerror="window.__pwn=5"></foreignObject>',
    '<image href="https://evil.example/x.png" width="1" height="1"/>',
    '<animate attributeName="href" to="javascript:alert(1)"/>',
    '<a href="https://example.com/" rel="noopener"><text x="2" y="2" data-id="n1">好链接</text></a>',
    "</svg>"
  ].join("");
  {
    const el = host();
    const root = F.mountImpl(el, "flowchart TD\n  A");
    await settle(el);
    const box = el.querySelector(".mermaid-diagram");
    const all = box ? [...box.querySelectorAll("*")] : [];
    const tags = all.map((e) => e.tagName.toLowerCase());
    const attrs = all.flatMap((e) => [...e.attributes].map((a) => [a.name, a.value]));
    check("C2 有图（净化后仍插入页面）", !!box && !!box.querySelector("svg"), el.innerHTML.slice(0, 200));
    check("C3 <script> / <style> / <foreignObject>（含 iframe·img）/ 远程 <image> 全部剔除",
      !["script", "style", "foreignobject", "iframe", "img", "image"].some((t) => tags.includes(t)), tags.join(","));
    check("C4 无任何 on* 事件属性", !attrs.some(([n]) => /^on/i.test(n)), attrs.filter(([n]) => /^on/i.test(n)).join(";"));
    check("C5 无 javascript: 链接（含 <animate> 改写 href）", !attrs.some(([, v]) => /javascript:/i.test(v)) && !tags.includes("animate"), attrs.filter(([, v]) => /javascript:/i.test(v)).join(";"));
    const good = box && box.querySelector('a[href="https://example.com/"]');
    check("C6 正常链接保留 href 与 rel=noopener", !!good && good.getAttribute("rel") === "noopener" && good.textContent === "好链接", box && box.innerHTML.slice(0, 300));
    const svg = box && box.querySelector("svg");
    check("C7 根节点 role=img / aria-roledescription / class / data-* 保留", !!svg && svg.getAttribute("role") === "img" && svg.getAttribute("aria-roledescription") === "flowchart" && svg.getAttribute("class") === "pele" && !!box.querySelector('[data-id="n1"]'), svg && svg.outerHTML.slice(0, 200));
    root.unmount(); el.remove();
  }

  // ---------------- B 字体快照 ----------------
  console.log("== B 字体快照 ==");
  const style = document.createElement("style");
  style.textContent = 'body{--font-sans:"Base Sans",sans-serif;--font-mono:"Base Mono",monospace}';
  document.head.appendChild(style);
  await tick(40);
  const codes = ["flowchart TD\n  A[一] --> B[二]", "flowchart LR\n  C[三] --> D[四]", "pie\n  \"甲\" : 1\n  \"乙\" : 2"];
  const el = host();
  const root = P.mountMany(el, codes);
  await until(() => el.querySelectorAll(".mermaid-diagram svg").length === 3);
  await tick(60);
  const svgStyle = (i) => (el.querySelectorAll(".mermaid-diagram svg")[i]?.getAttribute("style") || "");
  check("B0 三张图都已出图，且用的是页面字体（Base Sans）", el.querySelectorAll(".mermaid-diagram svg").length === 3 && svgStyle(0).includes("Base Sans"), svgStyle(0).slice(-120));
  const reads0 = cssReads;
  for (let i = 0; i < 10; i++) P.rerender();
  await tick(60);
  check("B1 父组件重渲染 10 次 × 3 张图：不再读计算样式（原每图每次渲染一读 = 30 次）", cssReads === reads0, `新增 ${cssReads - reads0} 次`);
  const svgNode = el.querySelector(".mermaid-diagram svg");
  // 无关变化：<html> 上的无关属性 → 下一帧复核一次，字体没变 → 不重绘（SVG 节点不换）
  document.documentElement.setAttribute("data-probe", "1");
  await tick(80);
  check("B2 无关属性变化：至多复核一次、图表不重绘", cssReads - reads0 <= 1 && el.querySelector(".mermaid-diagram svg") === svgNode, `复核 ${cssReads - reads0} 次 / 换节点=${el.querySelector(".mermaid-diagram svg") !== svgNode}`);
  // <head> 样式表改字体（主题插件 / 皮肤同此路径）→ 下一帧重绘
  const reads1 = cssReads;
  const style2 = document.createElement("style");
  style2.textContent = 'body{--font-sans:"Plugin Sans",serif}';
  document.head.appendChild(style2);
  check("B3 <head> 注入样式表改字体 → 三张图都重绘为新字体", await until(() => [0, 1, 2].every((i) => svgStyle(i).includes("Plugin Sans"))), svgStyle(0).slice(-120));
  check("B3b 同一帧多处变化合并为一次复核", cssReads - reads1 <= 2, `复核 ${cssReads - reads1} 次`);
  // <html> class 切主题 → 字体随主题变
  const style3 = document.createElement("style");
  style3.textContent = 'html.probe-dark body{--font-sans:"Dark Sans",serif}';
  document.head.appendChild(style3);
  await tick(60);
  document.documentElement.classList.add("probe-dark");
  check("B4 <html> class 切换（主题）改字体 → 图表随之重绘", await until(() => svgStyle(1).includes("Dark Sans")), svgStyle(1).slice(-120));
  root.unmount();
  el.remove();
  await tick(40);
  const reads2 = cssReads;
  document.documentElement.classList.remove("probe-dark");
  style2.remove();
  await tick(80);
  check("B5 页面上已无图表：停止观察（DOM 变化不再触发读样式）", cssReads === reads2, `新增 ${cssReads - reads2} 次`);
  // 新图出现：重新实读（拿到当前字体，而非卸载前的旧快照）
  const el2 = host();
  const root2 = P.mountImpl(el2, codes[0]);
  await settle(el2);
  const st2 = el2.querySelector(".mermaid-diagram svg")?.getAttribute("style") || "";
  check("B6 重新出现的图表读到当前字体（Base Sans，非旧快照 Dark Sans）", st2.includes("Base Sans") && !st2.includes("Dark Sans"), st2.slice(-120));
  root2.unmount(); el2.remove();

  // ---------------- S 源码契约 ----------------
  console.log("== S 源码契约 ==");
  const impl = fs.readFileSync(path.join(ROOT, "src/components/editor/MermaidDiagramImpl.tsx"), "utf8");
  const rmd = fs.readFileSync(path.join(ROOT, "src/components/editor/ReadMarkdown.tsx"), "utf8");
  check("S1 渲染结果先经 sanitizeSvg 才进 dangerouslySetInnerHTML", /const svg = sanitizeSvg\(raw\)/.test(impl) && (impl.match(/dangerouslySetInnerHTML/g) || []).length === 1 && /__html: result\.svg/.test(impl), "契约缺失");
  check("S2 净化器不可用时回落源码（不插未净化标记）", /if \(!DOMPurify\.isSupported/.test(impl) && /"unsafe" in result/.test(impl), "缺失");
  check("S3 不再每次渲染 getComputedStyle：组件经 useSyncExternalStore 取快照", /useSyncExternalStore\(subscribeFonts, getFontsSnapshot\)/.test(impl) && !/const fonts = readAppFonts\(\)/.test(impl), "缺失");
  check("S4 ReadMarkdown 不再 String(children)", !/String\(children \?\?/.test(rmd) && /mermaidSource\(node, children\)/.test(rmd), "仍在");

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n==== d238-mermaid-hardening：${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
