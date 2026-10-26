// D224：MarkdownEditor 同步脏标记回归——工具条插入图表后立即失焦/按 Esc，不能因 listener 的 200ms
// 防抖而被当成「无修改」丢掉。这里在 jsdom 里直接跑 createExtractEditor：命令后**同步**读取
// onDocChanged 计数，随后等 260ms 确认 listener 仍会按原语义上报（两条路径都在）。
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
import { createExtractEditor } from ${JSON.stringify(rel)};
import { commandsCtx } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";

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
      loader: { ".ts": "ts", ".tsx": "tsx" },
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
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
  }
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("运行异常：", (e && e.stack) || e);
  process.exit(1);
});
