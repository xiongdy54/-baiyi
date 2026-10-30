// C-09：CSP 指令集 + 构建期注入契约 + 权限处理器决策矩阵（纯逻辑）
// @runtime: electron-node
// 运行：node scripts/run-tests.mjs csp-policy
// 真实 Chromium 下的拦截效果见 csp-enforcement.test.cjs。
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

function loadPolicyModule() {
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
}

const { CSP_POLICY, CSP_DIRECTIVES, cspPlugin } = loadPolicyModule();
const directive = (name) => CSP_DIRECTIVES.find((d) => d.startsWith(`${name} `)) || "";

console.log("== 1 指令集 ==");
assert.strictEqual(directive("default-src"), "default-src 'self'");
assert.strictEqual(directive("script-src"), "script-src 'self' 'wasm-unsafe-eval'");
assert.ok(!/'unsafe-eval'/.test(CSP_POLICY), "script-src 不得包含 'unsafe-eval'");
assert.ok(directive("style-src").includes("'unsafe-inline'"), "style-src 需允许内联样式（React style 属性）");
assert.ok(directive("img-src").includes("bookasset:"), "img-src 需放行 bookasset:");
assert.ok(directive("img-src").includes("https:"), "img-src 需放行 https:（D-08 未答复，按报告默认）");
assert.ok(directive("media-src").includes("bookasset:"), "media-src 需放行 bookasset:");
assert.ok(directive("media-src").includes("https:"), "media-src 需放行 https:（在线词典真人发音）");
assert.ok(directive("connect-src").includes("pdfres:"), "connect-src 需放行 pdfres:（pdf.js 字体/CMap/WASM）");
assert.ok(directive("connect-src").includes("bookasset:"), "connect-src 需放行 bookasset:（正文图片转 dataURL）");
assert.ok(directive("font-src").includes("pdfres:"), "font-src 需放行 pdfres:");
assert.ok(directive("worker-src").includes("blob:"), "worker-src 需放行 blob:（测试态 pdf worker）");
assert.ok(directive("frame-src").includes("blob:"), "frame-src 需放行 blob:（foliate 正文 iframe）");
assert.strictEqual(directive("object-src"), "object-src 'none'");
assert.strictEqual(directive("base-uri"), "base-uri 'none'");
assert.strictEqual(directive("form-action"), "form-action 'none'");
console.log("  ✓ 12 条指令符合报告白名单");

console.log("== 2 构建期注入 ==");
const plugin = cspPlugin();
assert.strictEqual(plugin.name, "nutation-csp");
assert.strictEqual(plugin.apply, "build", "开发模式不得注入（Vite HMR 依赖内联脚本）");
const sample = '<!doctype html><html><head><meta charset="UTF-8"><script type="module" src="/src/main.tsx"></script></head></html>';
const injected = plugin.transformIndexHtml(sample);
assert.strictEqual((injected.match(/Content-Security-Policy/g) || []).length, 1, "必须恰好注入 1 个 meta");
assert.ok(injected.indexOf("Content-Security-Policy") < injected.indexOf("<script"), "meta 必须先于脚本");
assert.ok(injected.includes(`content="${CSP_POLICY}"`), "注入内容必须与唯一策略源一致");
for (const file of ["index.html", "workbench.html", "capture.html"]) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  assert.strictEqual(source.split("<head>").length - 1, 1, `${file} 必须恰好一个 <head> 注入点`);
}
console.log("  ✓ 三个入口均有唯一 <head>，注入位置先于脚本");

console.log("== 3 权限处理器决策矩阵 ==");
const { ALLOWED_PERMISSIONS, installPermissionHandlers } = require("../electron/permissions");
assert.deepStrictEqual([...ALLOWED_PERMISSIONS], ["clipboard-sanitized-write"]);
const handlers = {};
const warns = [];
installPermissionHandlers(
  {
    setPermissionRequestHandler: (fn) => {
      handlers.request = fn;
    },
    setPermissionCheckHandler: (fn) => {
      handlers.check = fn;
    }
  },
  (message) => warns.push(message)
);
const request = (permission) => new Promise((resolve) => handlers.request({}, permission, resolve));

(async () => {
  assert.strictEqual(await request("clipboard-sanitized-write"), true, "剪贴板写入必须放行");
  for (const permission of ["geolocation", "media", "notifications", "clipboard-read", "fullscreen"]) {
    assert.strictEqual(await request(permission), false, `${permission} 必须拒绝`);
  }
  assert.strictEqual(handlers.check({}, "clipboard-sanitized-write"), true);
  for (const permission of ["geolocation", "media", "notifications", "clipboard-read", "fullscreen"]) {
    assert.strictEqual(handlers.check({}, permission), false, `${permission} 检查必须拒绝`);
  }
  assert.ok(warns.some((m) => m.includes("geolocation")), "拒绝时需留 [perm] 警告");
  console.log("  ✓ 仅 clipboard-sanitized-write 放行，请求与检查两个入口一致");
  console.log("csp-policy ok");
})().catch((e) => {
  console.error("csp-policy FAIL:", e && e.message ? e.message : e);
  process.exit(1);
});
