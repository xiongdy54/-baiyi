// D224：MarkdownEditor 同步脏标记回归——工具条插入图表后立即失焦/按 Esc，不能因 listener 的 200ms
// 防抖而被当成「无修改」丢掉。这里在 jsdom 里直接跑 createExtractEditor：命令后**同步**读取
// onDocChanged 计数，随后等 260ms 确认 listener 仍会按原语义上报（两条路径都在）。
// D230：打开即规范化的内部事务（标题补 id 等，addToHistory=false）不算修改——无修改提交必须是 null，
// 「改了又改回」也是 null；真实修改照常提交。
// @runtime: system-node  @tier: 2  @gui: false  @id: MDDIRTY  @timeout: 120
// 运行：node tests/markdown-editor-commit.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build } = require("esbuild");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdeditor-dirty-"));
  try {
    const target = path.join(ROOT, "src", "components", "editor", "MarkdownEditor.tsx");
    const rel = path.relative(tmp, target).replace(/\\/g, "/");
    const entry = path.join(tmp, "entry.ts");
    fs.writeFileSync(entry, `
import { createExtractEditor, MarkdownEditor } from ${JSON.stringify(rel)};
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import React, { createRef, act } from "react";
import { createRoot } from "react-dom/client";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** D230 引擎层：打开后（无任何用户操作）onDocChanged 计数；再在首块内插一个字确认真实修改仍会上报 */
export async function probeOpen(root, input) {
  let dirty = 0;
  const editor = createExtractEditor(root, input, { onDocChanged: () => { dirty += 1; } });
  await editor.create();
  await sleep(30);
  const afterOpen = dirty;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("X", 1));
  });
  const afterEdit = dirty;
  const md = editor.action(getMarkdown());
  editor.destroy();
  return { afterOpen, afterEdit, md };
}

function findButton(root, re) {
  return [...root.querySelectorAll("button")].find((x) =>
    re.test(x.getAttribute("title") || x.getAttribute("aria-label") || x.textContent || "")
  );
}
async function clickButton(btn) {
  await act(async () => {
    btn.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    btn.click();
  });
}

/** D230/D231 组件层。mode：
 *  untouched＝不操作直接 commit；revert＝插代码块再 Ctrl+Z 撤回后 commit；edit＝插代码块后 commit；
 *  unmountNow＝插代码块后**立即**卸载（不失焦、不等防抖）；strict＝StrictMode 下挂载不操作，看是否误提交，再插入后卸载 */
export async function runComponent(root, input, mode) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const ref = createRef();
  const r = createRoot(root);
  const el = React.createElement(MarkdownEditor, {
    ref, value: input, toolbar: true, commitOnUnmount: mode === "unmountNow" || mode === "strict",
    onCommit: (t) => { calls.push(t); }
  });
  await act(async () => { r.render(mode === "strict" ? React.createElement(React.StrictMode, null, el) : el); });
  await act(async () => { await sleep(600); });
  const out = { mode, calls, strictMountCalls: null, button: true };
  if (mode === "strict") out.strictMountCalls = calls.length;
  if (mode !== "untouched") {
    const b = findButton(root, /代码块/);
    if (!b) { out.button = false; await act(async () => { r.unmount(); }); return out; }
    await clickButton(b);
  }
  if (mode === "revert") {
    const pm = root.querySelector(".ProseMirror");
    await act(async () => {
      pm.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => { await sleep(300); });
  }
  if (mode === "untouched" || mode === "revert" || mode === "edit") {
    await act(async () => { ref.current.commit(); });
    await act(async () => { r.unmount(); });
    return out;
  }
  // unmountNow / strict：不经失焦与防抖，立即卸载
  await act(async () => { r.unmount(); });
  await sleep(120);
  return out;
}

export async function run(root) {
  let dirty = 0;
  let listener = "";
  const editor = createExtractEditor(root, "hello", {
    onDocChanged: () => { dirty += 1; },
    onMarkdownUpdated: (_ctx, md) => { listener = md; }
  });
  await editor.create();
  const dirtyBefore = dirty;
  const called = editor.action((ctx) => ctx.get(commandsCtx).call("InsertExtractMermaid"));
  const dirtyImmediately = dirty;
  const md = editor.action(getMarkdown());
  await new Promise((r) => setTimeout(r, 260));
  const listenerAfter = listener;
  editor.destroy();
  return { called, dirtyBefore, dirtyImmediately, md, listenerAfter };
}
`);
    const bundle = path.join(tmp, "bundle.cjs");
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      loader: { ".ts": "ts", ".tsx": "tsx", ".css": "empty", ".svg": "text", ".png": "dataurl" },
      define: { "import.meta.env.DEV": "false", "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
      jsx: "automatic",
      nodePaths: [path.join(ROOT, "node_modules")],
      logLevel: "silent"
    });

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: "http://localhost/"
    });
    const w = dom.window;
    for (const [k, v] of Object.entries({
      window: w, document: w.document, navigator: w.navigator,
      HTMLElement: w.HTMLElement, HTMLDivElement: w.HTMLDivElement, HTMLSpanElement: w.HTMLSpanElement,
      Element: w.Element, Text: w.Text, Node: w.Node, DocumentFragment: w.DocumentFragment,
      getComputedStyle: w.getComputedStyle.bind(w), getSelection: w.getSelection.bind(w),
      MutationObserver: w.MutationObserver, DOMParser: w.DOMParser, XMLSerializer: w.XMLSerializer,
      Range: w.Range, Selection: w.Selection,
      requestAnimationFrame: w.requestAnimationFrame.bind(w),
      cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
      addEventListener: w.addEventListener.bind(w), removeEventListener: w.removeEventListener.bind(w),
      dispatchEvent: w.dispatchEvent.bind(w), Event: w.Event, CustomEvent: w.CustomEvent,
      KeyboardEvent: w.KeyboardEvent, MouseEvent: w.MouseEvent,
      location: w.location, history: w.history, innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1
    })) {
      try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch { /* ignore */ }
    }

    const { run } = require(bundle);
    const r = await run(w.document.getElementById("root"));
    console.log("== D224 同步脏标记 ==");
    check("命令返回成功", r.called === true, r.called);
    check("命令后同步触发 onDocChanged（不依赖 200ms 防抖）", r.dirtyImmediately > r.dirtyBefore, JSON.stringify({ before: r.dirtyBefore, after: r.dirtyImmediately }));
    check("同步序列化已包含 mermaid 围栏", String(r.md).includes("```mermaid"), String(r.md).slice(0, 160));
    check("防抖 listener 仍按原语义上报（260ms 后）", String(r.listenerAfter).includes("```mermaid"), String(r.listenerAfter).slice(0, 160));

    const root = () => w.document.getElementById("root");
    const mod = require(bundle);
    console.log("== D230 打开即规范化不算修改（引擎层） ==");
    const openCases = [
      ["一级标题+正文", "# 标题\n\n正文"],
      ["多级标题+有序/无序列表", "## 二级\n\n- a\n- b\n\n1. x\n2. y\n\n### 三级"],
      ["同名标题（id 去重）", "# 重复\n\n# 重复"],
      ["任务列表+表格", "- [ ] 任务\n- [x] 完成\n\n| a | b |\n| - | - |\n| 1 | 2 |"],
      ["公式块+mermaid+高亮", "$$\nx^2\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\n==高亮=="]
    ];
    for (const [name, input] of openCases) {
      const p = await mod.probeOpen(root(), input);
      check(`${name}：打开后 onDocChanged=0`, p.afterOpen === 0, p.afterOpen);
      check(`${name}：首块插字仍同步上报`, p.afterEdit > p.afterOpen && String(p.md).includes("X"), JSON.stringify(p));
    }

    console.log("== D230 组件层提交语义 ==");
    const HEAD = "# 标题\n\n正文";
    const u = await mod.runComponent(root(), HEAD, "untouched");
    check("含标题正文无修改 commit → null（不误报保存）", u.calls.length === 1 && u.calls[0] === null, JSON.stringify(u.calls));
    const rv = await mod.runComponent(root(), HEAD, "revert");
    check("插入后 Ctrl+Z 撤回再 commit → null（等于打开时基线）", rv.button && rv.calls.length === 1 && rv.calls[0] === null, JSON.stringify(rv));
    const ed = await mod.runComponent(root(), HEAD, "edit");
    // 「代码块」把光标所在块（标题）转成代码块＝真实修改
    check("真实修改照常提交（标题块转为代码块）", ed.button && ed.calls.length === 1 && /```\n标题\n```/.test(String(ed.calls[0])), JSON.stringify(ed));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
  }
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("运行异常：", (e && e.stack) || e);
  process.exit(1);
});
