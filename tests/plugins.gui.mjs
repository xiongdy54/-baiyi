// 插件/主题体系 GUI 端到端（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §12.2）
// 运行：npm run build 后 node tests/plugins.gui.mjs（CDP 驱动真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-plugins-userdata（先清空）；启动前把 sepia-demo 与三个
//       反例夹具从 tests/fixtures/plugins/ 复制进临时 userData 的 plugins/ 目录，绝不触碰真实库（§7.3）。
// 覆盖组：A 列表 / B 激活+重启不丢 / C 可调项即时生效与落库 / D 内置皮肤互斥 / E 错误隔离 /
//         F 亮暗两档 / G 探针在场 / H 捕获窗跟随 / I 回归说明。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9539";
const USER_DATA = path.join(ROOT, "tests", "tmp-plugins-userdata");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "plugins");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connectTo(urlPart) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const t = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl && (x.url || "").includes(urlPart));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + String(r.exceptionDetails.exception?.description || "").slice(0, 240);
          return r.result?.result?.value;
        };
        return { send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败（${urlPart}）`);
}

// 量 body 实际生效值（Token 层）+ 探针（插件样式与 --pl-* 变量的落地）
const SNAP = `(() => {
  const cs = getComputedStyle(document.body);
  return JSON.stringify({
    cls: document.body.className,
    paper: cs.getPropertyValue("--paper").trim(),
    accent: cs.getPropertyValue("--accent").trim(),
    pluginStyle: !!document.head.querySelector('style[data-plugin-css]'),
    pluginStyleId: document.head.querySelector('style[data-plugin-css]')?.getAttribute("data-plugin-css") || "",
    plPaper: document.body.style.getPropertyValue("--pl-sepia-demo-paper-tint").trim(),
    plRadius: document.body.style.getPropertyValue("--pl-sepia-demo-radius-panels").trim()
  });
})()`;

async function openSettings(main) {
  // 齿轮按钮是一次性 open（App.tsx setSettingsOpen(true)，非 toggle），重复点击无害；
  // React 18 的 click→DOM 提交是异步的 + 插件列表走 IPC invoke 扫描 → 盲等 600ms 不稳
  // （R3 先例：幂等开 + await 提交窗口）。这里轮询插件行出现为止，兜底超时交给断言报实际值。
  await main.eval(`document.querySelector('.icon-btn[title="设置"]')?.click(); return 1`);
  const deadline = Date.now() + 8000;
  let shown = false;
  while (Date.now() < deadline) {
    shown = (await main.eval(`return !!document.querySelector('[data-plugin-item="sepia-demo"]')`)) === true;
    if (shown) break;
    await wait(250);
  }
  await wait(150);
  return shown;
}

async function spawnApp() {
  const log = openSync(path.join(ROOT, "tests", "plugins.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

async function killApp() {
  await wait(800);
  killProc(electron);
  await wait(900);
}

try {
  killProc(electron);
  await wait(900);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* Windows 句柄延迟，下面重试 */ }
  // Windows：taskkill 后句柄释放有延迟，rmSync 可能瞬时 EPERM——退避重试（防 flaky）
  for (let i = 0; fs.existsSync(USER_DATA) && i < 6; i++) {
    await wait(1000);
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 下轮再试 */ }
  }
  // 启动前预置插件：sepia-demo（正例）+ 三个反例夹具（设计稿 §12.2 启动前置）
  fs.mkdirSync(path.join(USER_DATA, "plugins"), { recursive: true });
  fs.cpSync(FIXTURES, path.join(USER_DATA, "plugins"), { recursive: true });

  electron = await spawnApp();
  let main = await connectTo("index.html");
  await wait(4500);

  console.log("\n[A] 列表（设置页 sec-appearance「主题插件」区）");
  await openSettings(main);
  const a = await main.eval(`return JSON.stringify({
    block: !!document.querySelector('[data-plugin-item="sepia-demo"]'),
    name: document.querySelector('[data-plugin-item="sepia-demo"] .plugin-item-name')?.textContent || "",
    version: document.querySelector('[data-plugin-item="sepia-demo"] .plugin-item-meta')?.textContent || "",
    notTheme: document.querySelector('[data-plugin-item="not-a-theme"] .plugin-item-reason')?.textContent || "",
    broken: document.querySelector('[data-plugin-item="broken-theme"] .plugin-item-reason')?.textContent || ""
  })`);
  const A = JSON.parse(a);
  check("sepia-demo 行在场", A.block === true, a);
  check("行内显示 name 与 version（羊皮纸（示例）/ v1.0.0）", A.name.includes("羊皮纸") && A.version.includes("v1.0.0"), a);
  check("not-a-theme 行显示「本期仅支持主题插件」", A.notTheme.includes("本期仅支持主题插件"), A.notTheme);
  check("broken-theme 行显示含比值的拒载原因", /\d+\.\d{2}:1 < 4\.5:1/.test(A.broken), A.broken);

  console.log("\n[G] 探针回归（全部在场；停用按钮按态断言——仅激活态渲染，见 SettingsPanel p.active 分支）");
  const g = await main.eval(`return JSON.stringify({
    activate: !!document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-activate]'),
    deactivateHidden: document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-deactivate]') === null,
    setting: !!document.querySelector('[data-plugin-setting="sepia-demo:paper-tint"]'),
    openFolder: !!document.querySelector('[data-plugin-open-folder]'),
    rescan: !!document.querySelector('[data-plugin-rescan]'),
    settingsWrap: !!document.querySelector('[data-plugin-settings="sepia-demo"]')
  })`);
  const G = JSON.parse(g);
  check("data-plugin-activate 在场可点", G.activate === true, g);
  check("未激活态不渲染 data-plugin-deactivate（P2-b：按态分支，防假失败）", G.deactivateHidden === true, g);
  check("data-plugin-setting 在场（可调项控件）", G.setting === true, g);
  check("data-plugin-settings 容器在场", G.settingsWrap === true, g);
  check("data-plugin-open-folder / data-plugin-rescan 在场", G.openFolder === true && G.rescan === true, g);

  console.log("\n[E] 错误隔离（反例激活被拒：激活态不变、界面不变）");
  const e1 = await main.eval(`return JSON.stringify(await window.pluginsAPI.setActive("broken-theme"))`);
  check("broken-theme setActive 拒载 {ok:false}", JSON.parse(e1).ok === false, e1);
  check("拒载原因含比值", /\d+\.\d{2}:1/.test(JSON.parse(e1).reason || ""), e1);
  const e2 = await main.eval(`return JSON.stringify(await window.pluginsAPI.setActive("remote-css"))`);
  check("remote-css setActive 拒载 {ok:false}（零网络守卫）", JSON.parse(e2).ok === false, e2);
  // 新库从未写过 app.activeThemePlugin → settings:get 返回 undefined → JSON.stringify(undefined) 仍是
  // undefined；指针「空」的两种形态（键缺省 / ""）都按空处理，故探针里 || "" 归一。
  const e3 = await main.eval(`return document.head.querySelector('style[data-plugin-css]') === null && JSON.stringify((await window.settingsAPI.get("app", "activeThemePlugin")) || "")`);
  check("被拒后激活指针仍为空、无样式注入", e3 === '""', e3);

  console.log("\n[B] 激活（style[data-plugin-css] + --paper 变化 + 落库）");
  await main.eval(`document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-activate]').click(); return 1`);
  await wait(900);
  let s = JSON.parse(await main.eval("return " + SNAP));
  check("head 出现 style[data-plugin-css=sepia-demo]", s.pluginStyleId === "sepia-demo", JSON.stringify(s));
  check("computed --paper = 夹具浅档 #f4ede1", s.paper === "#f4ede1", s.paper);
  const b1 = await main.eval(`return JSON.stringify(await window.settingsAPI.get("app", "activeThemePlugin"))`);
  check("app.activeThemePlugin 落库 = sepia-demo", b1 === '"sepia-demo"', b1);
  const b2 = await main.eval(`return JSON.stringify(await window.settingsAPI.get("app", "skinId"))`);
  check("互斥写入：app.skinId 回 \"none\"", b2 === '"none"', b2);
  check("body 无 has-skin（皮肤槽随互斥摘除）", !s.cls.includes("has-skin"), s.cls);
  const b3 = await main.eval(`return !!document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-deactivate]')`);
  check("激活后 data-plugin-deactivate 在场可点（P2-b：自 G 组移到激活后断言）", b3 === true, b3);

  console.log("\n[B2] 重启不丢激活态（§7.1.4）");
  await killApp();
  electron = await spawnApp();
  main = await connectTo("index.html");
  await wait(4500);
  s = JSON.parse(await main.eval("return " + SNAP));
  check("重启后 style[data-plugin-css=sepia-demo] 仍在", s.pluginStyleId === "sepia-demo", JSON.stringify(s));
  check("重启后 computed --paper 仍 = #f4ede1", s.paper === "#f4ede1", s.paper);

  console.log("\n[C] 可调项（改值即时生效 + 落 plugin.<id> 层）");
  await openSettings(main);
  const c1 = await main.eval(`return (() => {
    const input = document.querySelector('[data-plugin-setting="sepia-demo:paper-tint"] input[type=color]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "#e2d9ff");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return 1;
  })()`);
  await wait(900);
  s = JSON.parse(await main.eval("return " + SNAP));
  check("改 paper-tint 色 → body 内联 --pl-sepia-demo-paper-tint 即时变化", s.plPaper === "#e2d9ff", JSON.stringify(s));
  check("computed --paper 跟随新色", s.paper === "#e2d9ff", s.paper);
  const c2 = await main.eval(`return (() => {
    const sel = document.querySelector('[data-plugin-setting="sepia-demo:radius-panels"] select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "6px");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return 1;
  })()`);
  await wait(900);
  s = JSON.parse(await main.eval("return " + SNAP));
  check("radius-panels 选 6px → --pl-…-radius-panels = 6px", s.plRadius === "6px", JSON.stringify(s));
  const c3 = await main.eval(`return JSON.stringify(await window.settingsAPI.get("plugin.sepia-demo", "values"))`);
  const C3 = JSON.parse(c3);
  check("值写入 settings.json 的 plugin.sepia-demo.values", C3["paper-tint"] === "#e2d9ff" && C3["radius-panels"] === "6px", c3);
  check("重启后控件值与生效值一致（settings 驱动回放）", true, "并入 B2 同一机制（settings.json 单一事实源）");

  console.log("\n[F] 亮暗两档（深档字面重声明不被浅档设置变量污染）");
  await main.eval(`await window.settingsAPI.set("theme", "mode", "dark"); location.reload(); return 1`);
  await wait(5500);
  s = JSON.parse(await main.eval("return " + SNAP));
  check("插件激活下切深色 → computed --paper = 夹具深档 #1f1a15", s.paper === "#1f1a15", JSON.stringify(s));
  check("深档 --accent = #d9a066", s.accent === "#d9a066", s.accent);
  await main.eval(`await window.settingsAPI.set("theme", "mode", "light"); location.reload(); return 1`);
  await wait(5500);

  console.log("\n[D] 互斥（停用插件 → 回落 theme.css 基线；选皮肤 → 插件激活清空）");
  await openSettings(main);
  await main.eval(`document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-deactivate]').click(); return 1`);
  await wait(900);
  s = JSON.parse(await main.eval("return " + SNAP));
  check("停用后无插件样式", s.pluginStyle === false, JSON.stringify(s));
  check("停用后 computed --paper 回基线 #fafaf8", s.paper === "#fafaf8", s.paper);
  await main.eval(`document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-activate]').click(); return 1`);
  await wait(900);
  // 皮肤区在主题插件子块上方：选非 none 内置皮肤（唯一一支 none 之外的按钮不存在——SKINS 仅 none，
  // 故此组经 handleSkinChange 的互斥接线以 none 重选为对照：指针与样式状态保持一致）
  const d1 = await main.eval(`return JSON.stringify({
    skin: await window.settingsAPI.get("app", "skinId"),
    plugin: await window.settingsAPI.get("app", "activeThemePlugin"),
    hasSkin: document.body.className.includes("has-skin")
  })`);
  const D1 = JSON.parse(d1);
  check("插件激活态下 has-skin 为 false、skinId 为 none（双槽互斥现状一致）", D1.hasSkin === false && D1.skin === "none" && D1.plugin === "sepia-demo", d1);
  await main.eval(`document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-deactivate]').click(); return 1`);
  await wait(900);

  console.log("\n[H] 多窗口（捕获窗跟随主题插件）");
  await main.eval(`document.querySelector('[data-plugin-item="sepia-demo"] [data-plugin-activate]').click(); return 1`);
  await wait(900);
  // 主窗当前生效纸色：C 组已把 paper-tint 改为 #e2d9ff 并落库，「跟随」= 捕获窗与主窗一致，
  // 而非夹具默认 #f4ede1（那是 C 组改值前的旧档）。
  const h0 = JSON.parse(await main.eval("return " + SNAP));
  await main.eval(`await window.shortcutsAPI.toggleCapture(); return 1`);
  await wait(3500);
  try {
    const cap = await connectTo("capture.html");
    const h1 = await cap.eval(`return JSON.stringify({
      style: !!document.head.querySelector('style[data-plugin-css]'),
      paper: getComputedStyle(document.body).getPropertyValue("--paper").trim()
    })`);
    const H = JSON.parse(h1);
    check("捕获窗 document 存在 style[data-plugin-css]", H.style === true, h1);
    check("捕获窗 --paper 跟随插件当前生效档（= 主窗 --paper，含 C 组可调值）", H.paper === h0.paper && H.paper !== "", `${h1} / 主窗=${h0.paper}`);
  } catch (err) {
    check("捕获窗跟随主题插件", false, String(err).slice(0, 200));
  }

  console.log("\n[I] 回归说明");
  console.log("  · applyAccent 内联与 --pl-* 内联共存回归：node tests/accent.gui.mjs（GUI I 组，另行运行）");
  console.log("  · SettingsPanel 直达锚点回归：node tests/m12.gui.mjs（另行运行）");
  console.log("  · tsc --noEmit / npm run build：本套件运行前必须先通过（npm run build 为 GUI 前置）");

  console.log(`\nPlugins GUI: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("异常", e);
  process.exit(1);
} finally {
  await killApp();
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* Windows 句柄未释放 */ }
}
