#!/usr/bin/env node
// @runtime: system-node
// D223：《使用教程》独立 HTML 交付件生成器。
// 输入  electron/tutorial-zh.md（书架播种用的同一份母本——单一事实源）
// 输出  docs/tutorial/使用教程.html（零脚本、零外链、图表全部预渲染为内联 SVG 的单文件）
// 失败语义：任何一个 mermaid 围栏渲染失败即非零退出（教程例子的正确性由本脚本身做闸门）。
// 运行：node scripts/build-tutorial-html.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { render } from "pele";

const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
// github-slugger 是 ESM-first 包：CJS require 拿到的是 { default: Slugger }（带 __esModule 标记）
const GithubSlugger = require("github-slugger").default ?? require("github-slugger");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "electron", "tutorial-zh.md");
const OUT_DIR = path.join(ROOT, "docs", "tutorial");
const OUT = path.join(OUT_DIR, "使用教程.html");

const md = new MarkdownIt({ html: true, breaks: false, linkify: false });

// ==高亮== 行内规则（与 App 读态的 remarkMark 同语义；教程正文用到了它）
md.inline.ruler.before("emphasis", "irMark", (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x3d /* = */ || src.charCodeAt(pos + 1) !== 0x3d) return false;
  const end = src.indexOf("==", pos + 2);
  if (end < 0 || end === pos + 2) return false;
  const content = src.slice(pos + 2, end);
  if (/[=\n]/.test(content)) return false; // 保守：内容里再含等号/换行就不当标注
  if (!silent) {
    state.push("mark_open", "mark", 1);
    state.push("text", "", 0).content = content;
    state.push("mark_close", "mark", -1);
  }
  state.pos = end + 2;
  return true;
});

// ---------- 解析：收集标题（slug + TOC），渲染 fence（mermaid → 预渲染 SVG） ----------
const slugger = new GithubSlugger();
const toc = [];
let figSeq = 0;
let mermaidCount = 0;
let failure = null;

const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if ((t.info || "").trim() !== "mermaid") return defaultFence(tokens, idx, options, env, self);
  mermaidCount += 1;
  const source = t.content.replace(/\n$/, "");
  try {
    const { svg } = render(source, { idPrefix: `tut-${(figSeq += 1)}-` });
    return `<figure class="mm-fig"><div class="mm-svg">${svg}</div><figcaption>渲染效果（把上面代码里的文字换成你自己的）</figcaption></figure>\n`;
  } catch (e) {
    failure = `mermaid 围栏 #${mermaidCount} 渲染失败：${String(e && e.message).split("\n")[0]}\n---\n${source}`;
    return "";
  }
};

// 标题锚点：core 阶段给 h2/h3 设 id（默认渲染器会带上 attr），同时收集 TOC
md.core.ruler.push("ir_heading_ids", (state) => {
  const t = state.tokens;
  for (let i = 0; i < t.length; i++) {
    if (t[i].type === "heading_open" && (t[i].tag === "h2" || t[i].tag === "h3")) {
      const text = t[i + 1] && t[i + 1].type === "inline" ? t[i + 1].content : "";
      const id = slugger.slug(text);
      t[i].attrSet("id", id);
      toc.push({ level: Number(t[i].tag.slice(1)), text, id });
    }
  }
});

const srcMd = fs.readFileSync(SRC, "utf8");
let body = md.render(srcMd);
if (failure) {
  console.error(`[build-tutorial] ${failure}`);
  process.exit(1);
}

// 任务列表复选框（markdown-it 无 GFM；显示为符号即可，HTML 版不承载交互语义）
body = body
  .replace(/<li>\[ \] /g, '<li class="task"><span class="cb" aria-hidden="true">☐</span> ')
  .replace(/<li>\[[xX]\] /g, '<li class="task done"><span class="cb" aria-hidden="true">☑</span> ');

if (mermaidCount < 30) {
  console.error(`[build-tutorial] mermaid 围栏数量异常（${mermaidCount} < 30），疑似母本被截断`);
  process.exit(1);
}

// ---------- 独立壳：内联 CSS（浅/深自适应）、TOC、零脚本零外链 ----------
const tocHtml = toc
  .map((h) => `<a class="toc-${h.level}" href="#${h.id}">${h.text}</a>`)
  .join("\n");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>使用教程 · 渐进阅读学习软件</title>
<style>
  :root {
    --paper: #fafaf8; --grey-1: #f0f0ee; --grey-2: #d4d4d2; --grey-3: #737373; --ink: #0a0a0a;
    --text-primary: var(--ink); --text-secondary: #525252; --text-helper: var(--grey-3);
    --border-subtle: #e0e0e0; --border-strong: #a3a3a3; --accent: #166a59; --error: #b42318;
    --font-sans: "Inter", "Helvetica Neue", "Helvetica", "Arial", "Segoe UI Variable", "Segoe UI",
      system-ui, "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans SC",
      "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
    --font-mono: "JetBrains Mono", "IBM Plex Mono", "SF Mono", "Cascadia Code", Consolas,
      ui-monospace, monospace;
    /* pele 图表令牌（与 App 内 theme.css 同一映射；深浅各自取值） */
    --pele-bg: transparent; --pele-fg: var(--text-primary); --pele-muted: var(--text-secondary);
    --pele-line: var(--border-strong); --pele-border: var(--border-strong);
    --pele-surface: var(--grey-1); --pele-surface-alt: var(--grey-1);
    --pele-accent: var(--accent); --pele-error: var(--error); --pele-critical: var(--error);
    --pele-font: var(--font-sans); --pele-font-mono: var(--font-mono); --pele-radius: 0;
    --pele-series-1: #166a59; --pele-series-2: #c98a2b; --pele-series-3: #4b6cb7;
    --pele-series-4: #c25b4a; --pele-series-5: #7e5ba6; --pele-series-6: #8a8f98;
    --pele-series-7: #9fb0da; --pele-series-8: #b6a3d2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #101010; --grey-1: #1c1c1a; --grey-2: #33332f; --grey-3: #8a8a86; --ink: #f5f5f2;
      --text-secondary: #b5b5b0; --border-subtle: #2a2a27; --border-strong: #4a4a46;
      --accent: #3fa08a; --error: #f85149;
      --pele-series-1: #3fa08a; --pele-series-2: #e0a64a; --pele-series-3: #7c9be0;
      --pele-series-4: #e0806f; --pele-series-5: #a98bd4; --pele-series-6: #a3a8b0;
      --pele-series-7: #4a5f8f; --pele-series-8: #6a5788;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--text-primary);
    font-family: var(--font-sans); font-size: 15px; line-height: 1.75;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
  h1 { font-size: 34px; line-height: 1.25; letter-spacing: -0.01em; margin: 0 0 8px; }
  h2 { font-size: 24px; margin-top: 3em; padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle); }
  h3 { font-size: 18px; margin-top: 2.2em; }
  p { margin: 0.8em 0; }
  a { color: var(--accent); }
  mark { background: #fde68a55; padding: 0 2px; }
  hr { border: 0; border-top: 1px solid var(--border-subtle); margin: 3em 0; }
  blockquote { margin: 1em 0; padding: 4px 16px; border-left: 3px solid var(--grey-2); color: var(--text-secondary); }
  code { font-family: var(--font-mono); font-size: 0.92em; background: var(--grey-1); padding: 1px 5px; }
  pre { background: var(--grey-1); padding: 14px 16px; overflow-x: auto; line-height: 1.6; }
  pre code { background: none; padding: 0; font-size: 13px; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid var(--border-subtle); padding: 6px 14px; text-align: left; }
  th { background: var(--grey-1); }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.25em 0; }
  li.task { list-style: none; margin-left: -1.2em; }
  li.task.done { color: var(--text-secondary); text-decoration: line-through; }
  li.task .cb { font-size: 1.05em; margin-right: 6px; }
  summary { cursor: pointer; }
  /* 目录 */
  nav.toc {
    margin: 24px 0 8px; padding: 16px 20px; border: 1px solid var(--border-subtle); background: var(--grey-1);
    display: flex; flex-direction: column; gap: 2px;
  }
  nav.toc .toc-2 { font-weight: 600; margin-top: 8px; }
  nav.toc .toc-2:first-child { margin-top: 0; }
  nav.toc .toc-3 { padding-left: 20px; color: var(--text-secondary); text-decoration: none; }
  nav.toc a { text-decoration: none; color: inherit; }
  nav.toc a:hover { color: var(--accent); }
  /* 图表：源码块 + 渲染效果成对呈现 */
  figure.mm-fig { margin: 0 0 1.6em; padding: 18px 16px 10px; border: 1px solid var(--border-subtle); }
  figure.mm-fig .mm-svg { overflow-x: auto; }
  figure.mm-fig svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  figure.mm-fig figcaption {
    margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-subtle);
    font-size: 12.5px; color: var(--text-helper); text-align: center;
  }
  @media print {
    body { background: #fff; }
    nav.toc { display: none; }
    pre, figure.mm-fig { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
<nav class="toc" aria-label="目录">
${tocHtml}
</nav>
${body}
</main>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, "utf8");
console.log(`[build-tutorial] OK：${mermaidCount} 个 mermaid 图全部预渲染 → ${path.relative(ROOT, OUT)}（${Math.round(html.length / 1024)} KB）`);
