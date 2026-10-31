// 自定义强调色回归套件（v48.14）
// 背景：深色模式下自定义 accent 失效、全应用回落到 IKB 蓝。根因是 applyAccent 只写
//   documentElement，而 theme.css 的 `body.theme-dark { --accent: #5b7fe8 }` 声明在 body 上，
//   胜过从 :root 继承的值 —— 深色档不是回归，是一直存在（601aa93 差分实测同样失败）。
// 运行：node tests/accent.gui.mjs（CDP 驱动真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-accent-userdata（先清空），绝不触碰真实库（§7.3）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9520";
const USER_DATA = path.join(ROOT, "tests", "tmp-accent-userdata");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实际: ${String(actual).slice(0, 220)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const l = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const t = l.find((x) => (x.url || "").includes("index.html"));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) =>
          new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + String(r.exceptionDetails.exception?.description || "").slice(0, 200);
          return r.result?.result?.value;
        };
        await send("Page.enable");
        return { send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

// 量 body 上的实际生效值 + 一个真实渲染元素，避免只测 Token 不测落地
const SNAP = `(() => {
  const cs = getComputedStyle(document.body);
  const btn = document.querySelector(".btn.btn-primary");
  const nav = document.querySelector(".nav-item.active");
  return JSON.stringify({
    cls: document.body.className,
    accent: cs.getPropertyValue("--accent").trim(),
    accentOn: cs.getPropertyValue("--accent-on").trim(),
    soft: cs.getPropertyValue("--accent-soft").trim(),
    formAccent: cs.accentColor,
    btnBg: btn ? getComputedStyle(btn).backgroundColor : "none",
    navColor: nav ? getComputedStyle(nav).color : "none"
  });
})()`;

const rgb = (hex) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
const lum = (hex) => {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// settingsAPI 只写持久化、不触发 React state，所以每次改完都要 reload 才生效
async function apply(main, { accent, mode }) {
  if (accent !== undefined) await main.eval(`await window.settingsAPI.set("app","accentColor",${JSON.stringify(accent)});return 1`);
  if (mode !== undefined) await main.eval(`await window.settingsAPI.set("theme","mode",${JSON.stringify(mode)});return 1`);
  await main.eval(`location.reload();return 1`);
  await wait(5500);
  return JSON.parse(await main.eval("return " + SNAP));
}

const GREEN = "#1a9e5f";
const YELLOW = "#f2e000"; // 浅色 accent：用来验反白档必须翻成纯黑

try {
  killProc(electron);
  await wait(900);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const log = openSync(path.join(ROOT, "tests", "accent.gui.log"), "a");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    detached: process.platform !== "win32",
    cwd: ROOT, shell: true, stdio: ["ignore", log, log],
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const main = await connect();
  await wait(4500);

  console.log("\n[1] 浅色 + 自定义 accent（基线，改动前就正常）");
  let s = await apply(main, { accent: GREEN, mode: "light" });
  check("浅色 body --accent = 自定义色", s.accent === GREEN, JSON.stringify(s));
  check("浅色主按钮底色 = 自定义色", s.btnBg === rgb(GREEN), s.btnBg);
  check("浅色原生控件 accent-color = 自定义色", s.formAccent === rgb(GREEN), s.formAccent);

  console.log("\n[2] 深色 + 自定义 accent（本缺陷主场景）");
  s = await apply(main, { mode: "dark" });
  check("深色 body --accent = 自定义色（不是 #5b7fe8）", s.accent === GREEN, JSON.stringify(s));
  check("深色主按钮底色 = 自定义色", s.btnBg === rgb(GREEN), s.btnBg);
  check("深色导航高亮 = 自定义色", s.navColor === rgb(GREEN), s.navColor);
  check("深色原生控件 accent-color = 自定义色", s.formAccent === rgb(GREEN), s.formAccent);
  check("深色 accent-soft 由自定义色派生（16%）", s.soft.includes(GREEN), s.soft);

  console.log("\n[3] 深色下切换浅色再切回，自定义色必须存活");
  let l = await apply(main, { mode: "light" });
  check("切回浅色仍是自定义色", l.accent === GREEN && l.btnBg === rgb(GREEN), JSON.stringify(l));
  s = await apply(main, { mode: "dark" });
  check("再切深色仍是自定义色", s.accent === GREEN && s.btnBg === rgb(GREEN), JSON.stringify(s));

  console.log("\n[4] 浅色 accent 的反白档必须按底色亮度翻转（深色主题下同样生效）");
  s = await apply(main, { accent: YELLOW });
  check("浅黄 accent → accent-on 为纯黑", s.accentOn === "#0a0a0a", JSON.stringify(s));
  check("浅黄 accent 上黑字对比 ≥ 4.5:1", contrast(YELLOW, "#0a0a0a") >= 4.5, contrast(YELLOW, "#0a0a0a").toFixed(2));

  console.log("\n[5] 深色下用深色 accent → 反白档必须翻成纯白");
  const NAVY = "#1b2a6b";
  s = await apply(main, { accent: NAVY });
  check("深蓝 accent → accent-on 为纯白（压过深色的默认黑）", s.accentOn === "#ffffff", JSON.stringify(s));
  check("深蓝 accent 上白字对比 ≥ 4.5:1", contrast(NAVY, "#ffffff") >= 4.5, contrast(NAVY, "#ffffff").toFixed(2));

  console.log("\n[6] 恢复默认：两套主题都要回到各自默认档");
  s = await apply(main, { accent: "" });
  // v49.90 / D257：瑞士皮肤暗色改用品牌设计系统「夜读」，默认 accent 由 #3fa08a 改为 --ink #cfc9b6
  check("深色恢复默认 → #cfc9b6（夜读）", s.accent === "#cfc9b6" && s.btnBg === rgb("#cfc9b6"), JSON.stringify(s));
  l = await apply(main, { mode: "light" });
  check("浅色恢复默认 → #166a59", l.accent === "#166a59" && l.btnBg === rgb("#166a59"), JSON.stringify(l));

  console.log("\n[7] 主题切换瞬间顶栏不得作为独立 VT 命名组压住设置弹窗（v49.91 / D258）");
  await main.eval(`const b=document.querySelector('.icon-btn[title="设置"]'); b?.click(); return !!b`);
  await wait(3000);
  const before = await main.eval(`return JSON.stringify({
    open: !!document.querySelector('.settings-panel'),
    name: getComputedStyle(document.querySelector('.topbar')).viewTransitionName,
    vt: document.documentElement.dataset.themeVt || null
  })`);
  const beforeObj = JSON.parse(before);
  check("设置面板在场，顶栏平时保留独立快照名 topbar", beforeObj.open === true && beforeObj.name === "topbar", before);
  const during = await main.eval(`
    const b=[...document.querySelectorAll('.settings-panel .seg-tabs button')].find(x=>x.textContent.trim()==='深色');
    if(!b) return 'NO-DARK-BTN';
    b.click();
    return JSON.stringify({
      vt: document.documentElement.dataset.themeVt || null,
      name: getComputedStyle(document.querySelector('.topbar')).viewTransitionName
    });`);
  check("主题切换瞬间：data-theme-vt 在场且顶栏快照名取消（并入 root，不再压住弹窗）",
    /"vt":"1"/.test(during) && /"name":"none"/.test(during), during);
  await wait(2200);
  const after = await main.eval(`return JSON.stringify({
    vt: document.documentElement.dataset.themeVt || null,
    name: getComputedStyle(document.querySelector('.topbar')).viewTransitionName
  })`);
  // 主题落色本身由 [1]–[6] 的 reload 路径覆盖；本段只守「过渡期间顶栏快照名切换 + 标记清理」
  //（本机隐藏窗口下 VT 可能不结算，1.5s 兜底仍应把标记清掉，不能让断言绑在动画是否跑完上）。
  check("过渡结束后：标记清除、顶栏快照名恢复 topbar",
    /"vt":null/.test(after) && /"name":"topbar"/.test(after), after);

  console.log(`\nAccent GUI: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("异常", e);
  process.exit(1);
} finally {
  await wait(1000);
  killProc(electron);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* Windows 句柄未释放 */ }
}
