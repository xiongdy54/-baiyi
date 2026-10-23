// @runtime: electron
// C-09：真实 Chromium 下 CSP 拦截 blob: iframe（EPUB 正文载体）内联脚本、放行同源脚本；
// 主文档动态内联脚本违规可被 securitypolicyviolation 捕获；权限处理器在 defaultSession 生效且不误伤剪贴板。
// 运行：node scripts/run-tests.mjs csp-enforcement
"use strict";
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CSP_POLICY } = (() => {
  const esbuild = require("esbuild");
  const out = path.join(__dirname, "tmp-c09", "cspPolicy.bundle.cjs");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "lib", "cspPolicy.ts")],
    bundle: true,
    write: true,
    outfile: out,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    logLevel: "silent"
  });
  return require(out);
})();
const { installPermissionHandlers } = require("../electron/permissions");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = (win, expr) => win.webContents.executeJavaScript(`(async()=>{${expr}})()`, true);

function writePage(dir, name, { csp, selfScript }) {
  const meta = csp ? `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">` : "";
  const script = selfScript ? '<script src="./self.js"></script>' : "";
  const file = path.join(dir, name);
  fs.writeFileSync(file, `<!doctype html><html><head>${meta}${script}</head><body><div id="ok">ok</div></body></html>`);
  return file;
}

const LISTEN = `window.__msgs = []; addEventListener("message", (e) => window.__msgs.push(e.data)); return "ok";`;

// 与 foliate 实际做法一致：同源 blob: iframe + allow-same-origin allow-scripts
const CHILD = `const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
  const html = '<!doctype html><html><body><script>parent.postMessage("PWNED","*")<\\/script></body></html>';
  iframe.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  document.body.appendChild(iframe);
  await new Promise((r) => setTimeout(r, 900));
  return JSON.stringify({
    msgs: window.__msgs,
    childHasScript: !!iframe.contentWindow?.document?.querySelector("script")
  });`;

const LATE_INLINE = `window.__viol = []; window.__lateRan = false;
  document.addEventListener("securitypolicyviolation", (e) => window.__viol.push(e.violatedDirective));
  const s = document.createElement("script");
  s.textContent = "window.__lateRan = true";
  document.head.appendChild(s);
  await new Promise((r) => setTimeout(r, 200));
  return JSON.stringify({ ran: window.__lateRan, viol: window.__viol });`;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  if (ok) console.log(`  ✓ ${name}`);
  else console.error(`  ✗ ${name}: ${detail}`);
}

async function main() {
  await app.whenReady();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nut-c09-test-"));
  fs.writeFileSync(path.join(dir, "self.js"), "window.__selfRan = 1;");
  const controlPath = writePage(dir, "control.html", { csp: false });
  const guardedPath = writePage(dir, "guarded.html", { csp: true, selfScript: true });

  const control = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await control.loadFile(controlPath);

  console.log("== 1 正向对照：无 CSP ==");
  await evalJs(control, LISTEN);
  const c1 = JSON.parse(await evalJs(control, CHILD));
  check("blob iframe 内联脚本会执行（对照非空转）", c1.msgs.includes("PWNED"), JSON.stringify(c1));
  check("动态内联脚本会执行（对照非空转）", JSON.parse(await evalJs(control, LATE_INLINE)).ran === true, "control");

  console.log("== 2 CSP：拦截与放行 ==");
  const guarded = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await guarded.loadFile(guardedPath);
  const selfRan = await evalJs(guarded, 'return window.__selfRan === 1');
  check("同源外部脚本照常执行（不误伤应用自身）", selfRan === true, String(selfRan));
  await evalJs(guarded, LISTEN);
  const c2 = JSON.parse(await evalJs(guarded, CHILD));
  check("blob iframe 内联脚本未执行", !c2.msgs.includes("PWNED"), JSON.stringify(c2));
  check("脚本标签仍在 DOM（CSP 拦截而非适配器删除）", c2.childHasScript === true, JSON.stringify(c2));
  const late = JSON.parse(await evalJs(guarded, LATE_INLINE));
  check("主文档动态内联脚本未执行", late.ran === false, JSON.stringify(late));
  check("securitypolicyviolation 可捕获 script-src", late.viol.some((d) => d.startsWith("script-src")), JSON.stringify(late));

  console.log("== 3 权限处理器（defaultSession 差分） ==");
  const permWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await permWin.loadFile(controlPath);
  const state = (win, name) => evalJs(win, `return navigator.permissions.query({name:"${name}"}).then(p => p.state)`);
  const names = ["notifications", "geolocation", "camera"];
  const before = {};
  for (const n of names) before[n] = await state(permWin, n);
  installPermissionHandlers(session.defaultSession);
  const after = {};
  for (const n of names) after[n] = await state(permWin, n);
  check("安装前至少一项非 denied（默认放行）", Object.values(before).some((s) => s !== "denied"), JSON.stringify(before));
  check("安装后三项全部 denied", Object.values(after).every((s) => s === "denied"), JSON.stringify(after));

  const clipWin = new BrowserWindow({ show: true, width: 320, height: 200, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await clipWin.loadFile(controlPath);
  clipWin.focus();
  await sleep(300);
  const clip = await evalJs(clipWin, 'return navigator.clipboard.writeText("nut-c09").then(() => "ok").catch(e => "err:" + e.name)');
  check("点击复制（clipboard.writeText）未被权限处理器误伤", clip === "ok", clip);

  clipWin.destroy();
  control.destroy();
  guarded.destroy();
  permWin.destroy();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 文件句柄晚释放时留给系统临时目录回收 */
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`csp-enforcement: ${checks.length - failed}/${checks.length} 通过`);
  process.exitCode = failed ? 1 : 0;
}

app.whenReady()
  .then(main)
  .catch((e) => {
    console.error("csp-enforcement FAIL:", e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
