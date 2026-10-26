// D237 打包体积：首屏预算 + 按需装载语义回归。
// @runtime: system-node  @tier: 2  @gui: false  @id: D237BUNDLE  @timeout: 300
// 运行：node tests/d237-bundle-budget.test.cjs（或 node scripts/run-tests.mjs d237；自带构建到临时目录，不读也不改 dist/）
// 覆盖：
//   A 语言资源按需装载（src/lib/i18n.ts）：zh-CN 零装载；未就绪时 t() 按缺译回落原文且不缓存半成品；
//     就绪后补发通知，且 useT 真实重渲染（jsdom + React——快照用译文版本号，不是 locale 字符串）；
//     连续切换只认最后一次；opencc cn2t 子入口与全量入口 cn→twp 对全部 t() 键逐字相同。
//   B 真实 Vite 构建（临时目录，不碰 dist/）：各窗口首屏静态闭包预算；opencc / en·ja 词典 / EPUB·HTML 导入管线 /
//     设置面板 / pele 图型模块均不在任何首屏闭包；Mermaid 首块 < 80kB 且图型按需分块；KaTeX 字体只产出 woff2。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const url = require("url");

const ROOT = fs.realpathSync(path.resolve(__dirname, ".."));
const TMP = path.join(ROOT, "tests", "tmp-d237");
let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const esbuild = require("esbuild");

  // ---------------- A 语言资源按需装载 ----------------
  console.log("== A 语言资源按需装载 ==");
  // jsdom 先行：i18n 读写 window.localStorage / document.documentElement.lang，React 需要 DOM
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const entry = path.join(TMP, "probe.tsx");
  fs.writeFileSync(entry, [
    'import React from "react";',
    'import { createRoot } from "react-dom/client";',
    'import { flushSync } from "react-dom";',
    'import * as i18n from "../../src/lib/i18n";',
    'function Probe() { const T = i18n.useT(); return <span id="probe">{T("书架")}</span>; }',
    "export function mount(el: HTMLElement) { const root = createRoot(el); flushSync(() => root.render(<Probe />)); return root; }",
    "export { i18n };"
  ].join("\n"));
  const bundle = path.join(TMP, "probe.bundle.cjs");
  esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: bundle, jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } });
  const { mount, i18n } = require(bundle);

  check("A0 zh-CN 恒就绪；en / ja / zh-TW 启动时都未装载", i18n.localeReady("zh-CN") && !i18n.localeReady("en") && !i18n.localeReady("ja") && !i18n.localeReady("zh-TW"),
    JSON.stringify(["zh-CN", "en", "ja", "zh-TW"].map((l) => i18n.localeReady(l))));
  check("A1 zh-CN 下 t() 恒等（无需任何资源）", i18n.t("设置") === "设置", i18n.t("设置"));

  // A2：首绘后才就绪的路径——initLocale 不等资源 → 先按原文渲染 → 就绪后补发通知 → useT 真实重渲染
  let notified = 0;
  const un = i18n.subscribeI18n(() => notified++);
  i18n.initLocale("ja");
  const root = mount(document.getElementById("root"));
  const before = document.getElementById("probe").textContent;
  check("A2 资源未就绪：t() 缺译回落 zh-CN 原文（不抛错）", before === "书架", before);
  await i18n.ensureLocaleResources("ja");
  await tick(30);
  const after = document.getElementById("probe").textContent;
  check("A3 资源就绪 → 补发通知（同一 locale）", notified >= 1, notified);
  check("A4 useT 组件随之重渲染为日文（快照＝译文版本号）", after === "ライブラリ", after);
  root.unmount();
  un();

  // A5：zh-TW 未就绪时只有覆盖表文本，且不缓存半成品——就绪后同一键拿到完整繁体
  i18n.initLocale("zh-TW");
  const twBefore = i18n.t("设置");
  await i18n.ensureLocaleResources("zh-TW");
  const twAfter = i18n.t("设置");
  check("A5 zh-TW 转换器就绪前不缓存未转换结果（设置 → 設定）", twBefore === "设置" && twAfter === "設定", `${twBefore} → ${twAfter}`);
  check("A6 覆盖表仍生效（材料导图 → 材料心智圖）", i18n.t("材料导图") === "材料心智圖", i18n.t("材料导图"));

  // A7：连续切换只认最后一次（en 尚未装载、先发起；随后切回 zh-CN 立即生效，en 装载完成也不得把语言切回去）
  i18n.initLocale("zh-CN");
  const p1 = i18n.setLocale("en");
  const p2 = i18n.setLocale("zh-CN");
  await Promise.all([p1, p2]);
  await tick();
  check("A7 连续切换 en→zh-CN：最终 zh-CN", i18n.getLocale() === "zh-CN", i18n.getLocale());
  const p3 = i18n.setLocale("ja");
  const p4 = i18n.setLocale("en");
  await Promise.all([p3, p4]);
  check("A8 连续切换 ja→en：最终 en 且 en 词典就绪", i18n.getLocale() === "en" && i18n.t("书架") === "Library", `${i18n.getLocale()} ${i18n.t("书架")}`);
  await i18n.setLocale("zh-CN");

  // A9：cn2t 子入口与全量入口 cn→twp 对全部 t() 键（+ 覆盖表值）逐字相同
  const full = await import("opencc-js");
  const cn2t = await import("opencc-js/cn2t");
  const cf = full.Converter({ from: "cn", to: "twp" });
  const cs = cn2t.Converter({ from: "cn", to: "twp" });
  const { extractKeys } = await import(url.pathToFileURL(path.join(ROOT, "scripts", "i18n-check.mjs")).href);
  const keys = [...extractKeys().keys()];
  const diff = keys.filter((k) => cf(k) !== cs(k));
  check(`A9 opencc cn2t ≡ 全量入口（${keys.length} 个 t() 键）`, keys.length > 1000 && diff.length === 0, diff.slice(0, 5).join(" | "));

  // ---------------- B 真实 Vite 构建 ----------------
  console.log("== B 构建产物预算（临时目录） ==");
  const outDir = path.join(os.tmpdir(), `d237-dist-${process.pid}`);
  const chunks = {};
  const vite = await import("vite");
  const t0 = Date.now();
  await vite.build({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.ts"),
    logLevel: "error",
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
    plugins: [{
      name: "d237-analyze",
      generateBundle(_o, b) {
        for (const [f, c] of Object.entries(b)) {
          if (c.type !== "chunk") continue;
          chunks[f] = { bytes: Buffer.byteLength(c.code), name: c.name, isEntry: c.isEntry, facade: c.facadeModuleId || "", imports: c.imports, dynamicImports: c.dynamicImports, mods: Object.keys(c.modules) };
        }
      }
    }]
  });
  console.log(`  （构建 ${((Date.now() - t0) / 1000).toFixed(1)}s，${Object.keys(chunks).length} 个 JS 块）`);
  const closure = (f, seen = new Set()) => { if (seen.has(f)) return seen; seen.add(f); for (const i of chunks[f].imports) closure(i, seen); return seen; };
  const entries = Object.entries(chunks).filter(([, c]) => c.isEntry);
  // 预算：D237 实测（main 1962 / workbench 1397 / lens 1073 / capture 931 kB）上留 ~15% 余量；D237 前为 4030 / 2908 / 2584 / 2442 kB
  const BUDGET = { main: 2300, workbench: 1650, lens: 1250, capture: 1100 };
  const FORBIDDEN = [
    [/node_modules[\\/]opencc-js[\\/]/, "opencc-js"],
    [/src[\\/]i18n[\\/]locales[\\/](en|ja)\.ts$/, "en/ja 词典"],
    [/node_modules[\\/]@likecoin[\\/]epub-ts[\\/]/, "@likecoin/epub-ts"],
    [/node_modules[\\/]@mozilla[\\/]readability[\\/]/, "@mozilla/readability"],
    [/node_modules[\\/]markdown-it[\\/]/, "markdown-it"],
    [/node_modules[\\/]jszip[\\/]/, "jszip"],
    [/node_modules[\\/]turndown[\\/]/, "turndown"],
    [/node_modules[\\/]pele[\\/]/, "pele"],
    [/src[\\/]components[\\/]SettingsPanel\.tsx$/, "SettingsPanel"],
    [/src[\\/]lib[\\/](epub|htmlImport)\.ts$/, "epub.ts / htmlImport.ts"]
  ];
  for (const [f, c] of entries) {
    const set = closure(f);
    let total = 0;
    const mods = [];
    for (const x of set) { total += chunks[x].bytes; mods.push(...chunks[x].mods); }
    const kb = Math.round(total / 1000);
    const budget = BUDGET[c.name];
    check(`B1 ${c.name} 窗口首屏 JS ${kb} kB ≤ 预算 ${budget} kB`, budget !== undefined && kb <= budget, kb);
    const hits = FORBIDDEN.filter(([re]) => mods.some((m) => re.test(m.split("?")[0]))).map(([, n]) => n);
    check(`B2 ${c.name} 首屏闭包不含按需模块`, hits.length === 0, hits.join(", "));
  }
  check("B3 四个窗口入口齐全", ["main", "capture", "workbench", "lens"].every((n) => entries.some(([, c]) => c.name === n)), entries.map(([, c]) => c.name).join(","));
  const allMods = Object.values(chunks).flatMap((c) => c.mods.map((m) => m.split("?")[0]));
  check("B4 opencc 只打包 cn2t 子入口（不含全量 full.js）", allMods.some((m) => /opencc-js[\\/]dist[\\/]esm[\\/]cn2t\.js$/.test(m)) && !allMods.some((m) => /opencc-js[\\/]dist[\\/]esm[\\/]full\.js$/.test(m)), allMods.filter((m) => m.includes("opencc")).join(","));
  const mer = Object.entries(chunks).find(([, c]) => c.mods.some((m) => /MermaidDiagramImpl\.tsx$/.test(m)));
  check("B5 Mermaid 渲染块存在且 < 80 kB（D237 前 701 kB）", !!mer && mer[1].bytes < 80000, mer ? mer[1].bytes : "缺");
  const flowChunk = Object.entries(chunks).find(([, c]) => c.mods.some((m) => /pele[\\/]dist[\\/]esm[\\/]chunks[\\/]PLTZDMI2\.js$/.test(m)));
  check("B6 pele flowchart 图型在独立的按需块（不在 Mermaid 首块里）", !!flowChunk && !!mer && flowChunk[0] !== mer[0] && !closure(mer[0]).has(flowChunk[0]), flowChunk ? flowChunk[0] : "缺");
  const assets = fs.readdirSync(path.join(outDir, "assets"));
  const katex = assets.filter((a) => a.startsWith("KaTeX_"));
  check("B7 KaTeX 字体不再产出 .ttf / .woff", katex.length > 0 && katex.every((a) => a.endsWith(".woff2")), katex.filter((a) => !a.endsWith(".woff2")).join(","));
  const css = assets.filter((a) => a.endsWith(".css")).map((a) => fs.readFileSync(path.join(outDir, "assets", a), "utf8")).join("\n");
  const faces = css.match(/@font-face\{[^}]*KaTeX[^}]*\}/g) || [];
  const badFaces = faces.filter((ff) => /format\(["']?(woff|truetype)["']?\)/.test(ff));
  check(`B8 KaTeX @font-face（${faces.length} 条）只引用 woff2`, faces.length >= 20 && badFaces.length === 0, badFaces[0] || faces.length);
  fs.rmSync(outDir, { recursive: true, force: true });

  // ---------------- 源码契约 ----------------
  console.log("== C 源码契约 ==");
  const i18nSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "i18n.ts"), "utf8");
  check("C0 i18n.ts 不再静态 import 词典与 opencc", !/^import .*(locales\/en|locales\/ja|opencc-js)/m.test(i18nSrc), "");
  const boot = ["main.tsx", "capture.tsx", "lens.tsx", "workbench.tsx"].map((f) => [f, fs.readFileSync(path.join(ROOT, "src", f), "utf8")]);
  check("C1 四个窗口入口首绘前都等待语言资源", boot.every(([, s]) => /ensureLocaleResources\(|loadLocale\(/.test(s)), boot.filter(([, s]) => !/ensureLocaleResources\(|loadLocale\(/.test(s)).map(([f]) => f).join(","));

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("运行异常：", (e && e.stack) || e);
  process.exit(1);
});
