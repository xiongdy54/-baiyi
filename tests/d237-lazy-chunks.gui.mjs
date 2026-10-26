// D237 端到端：按需装载的分块在真实应用里按时装上——
//   ① zh-CN 启动：语言词典 / 简繁转换器 / EPUB·HTML 导入管线 / 设置面板 / Mermaid 渲染器都不在启动时装载；
//   ② 点齿轮：设置面板分块按需装上并正常渲染；
//   ③ 设置里切 English：en 词典分块装上、界面即时变英文；切 繁體中文：cn2t 转换器装上、界面变繁体；
//   ④ 以 English 重载窗口：首帧就是英文（入口首绘前等待资源，不闪 zh-CN 原文）；
//   ⑤ 独立窗口（制卡台 / 结构图）同样先装 en 词典再首绘：界面英文、无 zh-CN 原文。
// @runtime: node  @tier: 2  @gui: true  @id: D237LAZY  @timeout: 240
// 运行：npm run build 之后 `node tests/d237-lazy-chunks.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d237-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9274";
const USER_DATA = path.join(ROOT, "tests", "tmp-d237-userdata");
const SANDBOX = process.platform === "linux" ? ["--no-sandbox"] : [];

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect(urlRe = /index\.html/) {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && urlRe.test(t.url));
      if (page) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        const scripts = [];
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          // 已解析的脚本（Debugger.enable 时补发既有脚本，之后实时推送）：file:// 下资源时间线不记脚本，改用它判定分块是否装载
          else if (m.method === "Debugger.scriptParsed" && m.params?.url) scripts.push(m.params.url);
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id; pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS, scripts };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

/** 已装载的 JS 分块（CDP 已解析脚本里的 dist/assets/*.js 文件名，去掉 hash） */
const loadedChunks = async (cdp) => {
  await wait(200); // 给 scriptParsed 事件一点到达时间
  return [...new Set(cdp.scripts.filter((u) => /\/assets\/[^/]+\.js$/.test(u)).map((u) => u.split("/").pop().replace(/-[\w-]{8}\.js$/, "")))];
};
async function waitFor(cdp, expr, ms = 8000) {
  const t0 = Date.now();
  let v = await cdp.eval(expr);
  while (v !== true && Date.now() - t0 < ms) { await wait(150); v = await cdp.eval(expr); }
  return v === true;
}
const gearTitle = (cdp) => cdp.eval(`document.querySelector(".topbar-right .icon-btn[data-ui='button-icon']")?.getAttribute("title") || ""`);
const pickLanguage = (cdp, v) => cdp.eval(`(() => { const sel = document.querySelector("#sec-language select"); if (!sel) return "NOSEL"; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(sel, ${JSON.stringify(v)}); sel.dispatchEvent(new Event("change", { bubbles: true })); return sel.value; })()`);

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(USER_DATA, "settings.json"), JSON.stringify({ app: { autoBackupEnabled: false } }));

  const out = openSync(path.join(ROOT, "tests", "d237-lazy-chunks.gui.log"), "w");
  electron = spawn("npx", ["electron", ...SANDBOX, ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await cdp.send("Debugger.enable");
  check("应用启动并进入主界面", await waitFor(cdp, `!!document.querySelector(".topbar-right")`, 20000), "未进入");
  await wait(1500);

  // ① zh-CN 启动：按需分块都没装
  const boot = await loadedChunks(cdp);
  const LAZY = ["cn2t", "en", "ja", "epub", "htmlImport", "SettingsPanel", "MermaidDiagramImpl"];
  check("启动时装载了主入口与共享块", boot.includes("main"), boot.join(","));
  check("zh-CN 启动不装任何按需分块（词典/转换器/导入管线/设置面板/Mermaid）", LAZY.every((n) => !boot.includes(n)), boot.filter((n) => LAZY.includes(n)).join(","));
  check("界面为简体中文（齿轮 title=设置）", (await gearTitle(cdp)) === "设置", await gearTitle(cdp));

  // ② 设置面板按需装载
  await cdp.eval(`(() => { const b = document.querySelector('.topbar-right [title="设置"]'); b?.click(); return !!b; })()`);
  check("点齿轮后设置面板渲染", await waitFor(cdp, `!!document.querySelector(".settings-panel #sec-language select")`), "未出现");
  check("设置面板分块此时才装载", (await loadedChunks(cdp)).includes("SettingsPanel"), (await loadedChunks(cdp)).join(","));

  // ③ 切 English → en 词典装上、界面即时英文
  check("语言下拉可选 English", (await pickLanguage(cdp, "en")) === "en", "选择失败");
  check("界面即时切换为英文（齿轮 title=Settings）", await waitFor(cdp, `document.querySelector(".topbar-right .icon-btn[data-ui='button-icon']")?.getAttribute("title") === "Settings"`), await gearTitle(cdp));
  const afterEn = await loadedChunks(cdp);
  check("en 词典分块按需装上（ja / cn2t 仍未装）", afterEn.includes("en") && !afterEn.includes("ja") && !afterEn.includes("cn2t"), afterEn.join(","));
  check("html lang 跟随为 en", (await cdp.eval(`document.documentElement.lang`)) === "en", await cdp.eval(`document.documentElement.lang`));

  // 切 繁體中文 → cn2t 转换器装上、界面繁体
  check("语言下拉可选 繁體中文", (await pickLanguage(cdp, "zh-TW")) === "zh-TW", "选择失败");
  check("界面即时切换为繁体（齿轮 title=設定）", await waitFor(cdp, `document.querySelector(".topbar-right .icon-btn[data-ui='button-icon']")?.getAttribute("title") === "設定"`, 10000), await gearTitle(cdp));
  check("cn2t 简→繁转换器分块按需装上", (await loadedChunks(cdp)).includes("cn2t"), (await loadedChunks(cdp)).join(","));

  // ④ 以 English 重载：首帧即英文（不闪 zh-CN 原文）
  await pickLanguage(cdp, "en");
  await waitFor(cdp, `document.querySelector(".topbar-right .icon-btn[data-ui='button-icon']")?.getAttribute("title") === "Settings"`);
  await wait(800); // 等 app.language 落盘
  const saved = await cdp.eval(`(async () => JSON.stringify([await window.settingsAPI.get("app", "language"), localStorage.getItem("ir.locale")]))()`);
  check("app.language 落盘为 en，localStorage 缓存同步", saved === JSON.stringify(["en", "en"]), saved);
  await cdp.send("Page.enable");
  // 记录 #root 第一次出现文字时的内容（新文档最早执行，先于应用脚本）
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__firstRootText = null; new MutationObserver((_, ob) => { const r = document.getElementById("root"); const t = r && r.textContent && r.textContent.trim(); if (t && window.__firstRootText === null) { window.__firstRootText = t.slice(0, 200); ob.disconnect(); } }).observe(document, { subtree: true, childList: true, characterData: true });`
  });
  cdp.scripts.length = 0; // 重载后只看新文档装了哪些分块
  await cdp.send("Page.reload", { ignoreCache: false });
  await wait(1000);
  check("重载后进入主界面", await waitFor(cdp, `!!document.querySelector(".topbar-right")`, 20000), "未进入");
  const first = await cdp.eval(`window.__firstRootText`);
  check("重载首帧就是英文（无 zh-CN 闪烁）", typeof first === "string" && /[A-Za-z]/.test(first) && !/正在启动|书架|设置/.test(first), first);
  check("重载后界面英文（齿轮 title=Settings）", (await gearTitle(cdp)) === "Settings", await gearTitle(cdp));
  const reloaded = await loadedChunks(cdp);
  check("重载后 en 词典随启动装载，ja / cn2t 不装", reloaded.includes("en") && !reloaded.includes("ja") && !reloaded.includes("cn2t"), reloaded.join(","));

  // ⑤ 独立窗口：入口首绘前 loadLocale（en 词典按需装上后才 render）
  const CJK = /[\u3400-\u9fff]/;
  const rootText = (w) => w.eval(`document.getElementById("root")?.textContent || ""`);
  await cdp.eval(`window.windowAPI.workbench("show").then(() => true)`);
  const wb = await connect(/workbench\.html/);
  check("制卡台窗口英文渲染（标题 = Workbench）", await waitFor(wb, `document.querySelector(".wbw-title")?.textContent === "Workbench"`, 15000), (await rootText(wb)).slice(0, 160));
  check("制卡台窗口 html lang = en", (await wb.eval(`document.documentElement.lang`)) === "en", await wb.eval(`document.documentElement.lang`));
  check("制卡台窗口无 zh-CN 原文", !CJK.test(await rootText(wb)), (await rootText(wb)).match(/.{0,20}[\u3400-\u9fff].{0,20}/)?.[0]);
  await wb.send("Debugger.enable");
  const wbChunks = await loadedChunks(wb);
  check("制卡台窗口装上 en 词典分块（ja / cn2t 不装）", wbChunks.includes("en") && !wbChunks.includes("ja") && !wbChunks.includes("cn2t"), wbChunks.join(","));
  // 结构图窗口无打开材料时面板不渲染（MindmapLens 以 documentId 门控）→ 查语言状态与分块
  await cdp.eval(`window.lensAPI.control("show").then(() => true)`);
  const lens = await connect(/lens\.html/);
  check("结构图窗口 html lang = en", await waitFor(lens, `document.documentElement.lang === "en"`, 15000), await lens.eval(`document.documentElement.lang`));
  await lens.send("Debugger.enable");
  const lensChunks = await loadedChunks(lens);
  check("结构图窗口装上 en 词典分块（ja / cn2t 不装）", lensChunks.includes("en") && !lensChunks.includes("ja") && !lensChunks.includes("cn2t"), lensChunks.join(","));
  try { wb.ws.close(); lens.ws.close(); } catch { /* 已断开 */ }

  console.log(`\n==== d237-lazy-chunks.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
