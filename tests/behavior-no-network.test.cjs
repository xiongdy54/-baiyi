// @runtime: electron-node
// D248 / T14：§11.6 零网络——静态扫描 electron/behavior/** 与 src/lib/behavior/**；
// 运行时加载全部行为模块时网络模块/网络 API 全部封锁（加载即抛）。
// 运行：node scripts/run-tests.mjs behavior-no-network
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const DIRS = ["electron/behavior", "src/lib/behavior"];
const EXTS = new Set([".js", ".ts"]);

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.has(path.extname(name))) acc.push(full);
  }
  return acc;
}

// 注释剥离：只扫代码（头部纪律注释里出现「不 require("electron")」等是允许的）
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const BANNED = [
  { re: /\brequire\s*\(\s*["'](?:node:)?(?:http|https|net|dgram|tls|dns)["']\s*\)/, label: "require(网络模块)" },
  { re: /\brequire\s*\(\s*["']electron["']\s*\)/, label: "require(electron)" },
  { re: /(?:^|[^.\w])fetch\s*\(/, label: "fetch()" },
  { re: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, label: "WebSocket" },
  { re: /\bsendBeacon\b/, label: "sendBeacon" },
  { re: /\b(?:axios|undici|got)\b/, label: "HTTP 客户端库" },
  { re: /\bnet\.(?:request|fetch|connect)\b/, label: "electron net" },
  { re: /\bhttps?\.(?:request|get)\b/, label: "http(s) 请求" },
];

(async () => {
  console.log("== A 静态扫描：BDI 目录不含任何网络入口 ==");
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
  check("扫描目录非空", files.length > 0, ">0 个文件", files.length);
  const hits = [];
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    for (const b of BANNED) {
      const m = code.match(b.re);
      if (m) hits.push(`${path.relative(ROOT, file)}: ${b.label} (${m[0].trim()})`);
    }
  }
  check("零网络：无 require(http/https/net/dgram/tls/dns|electron) / fetch / XHR / WebSocket / sendBeacon", hits.length === 0, "无命中", hits);

  console.log("== B 纪律标注：behavior.db 声明 LOCAL-ONLY（§12.3） ==");
  const dbHeader = fs.readFileSync(path.join(ROOT, "electron/behavior/behaviorDb.js"), "utf8").split("\n").slice(0, 8).join("\n");
  check("behaviorDb.js 文件头含 LOCAL-ONLY 与「不发起网络上传」", /LOCAL-ONLY/.test(dbHeader) && /不发起网络上传/.test(dbHeader), "头部声明", dbHeader.slice(0, 120));

  console.log("== C 运行时封锁：加载全部行为模块 + 纯函数入口不触碰网络 ==");
  const blocked = new Set(["http", "https", "net", "dgram", "tls", "dns", "electron"]);
  const origRequire = Module.prototype.require;
  const deny = (id) => {
    const base = String(id).replace(/^node:/, "");
    if (blocked.has(base)) throw new Error(`BDI 运行时尝试加载网络/宿主模块：${id}`);
  };
  // 全局网络 API 陷阱（任何调用都算违规）
  const boom = () => { throw new Error("BDI 运行时尝试网络访问"); };
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  globalThis.fetch = boom;
  globalThis.XMLHttpRequest = class { constructor() { boom(); } };
  globalThis.WebSocket = class { constructor() { boom(); } };
  Module.prototype.require = function (id) {
    deny(id);
    return origRequire.apply(this, arguments);
  };
  let loaded = 0;
  let loadError = null;
  try {
    for (const file of files.filter((f) => f.endsWith(".js"))) {
      require(file);
      loaded++;
    }
    const uuid7 = require(path.join(ROOT, "electron", "behavior", "uuid7.js"));
    const registry = require(path.join(ROOT, "electron", "behavior", "registry.js"));
    const metrics = require(path.join(ROOT, "electron", "behavior", "metrics.js"));
    const signals = require(path.join(ROOT, "electron", "behavior", "signals.js"));
    const policy = require(path.join(ROOT, "electron", "behavior", "policy.js"));
    check("uuid7 纯函数可用", /^[0-9a-f-]{36}$/.test(uuid7.uuid7()), "uuid v7", "格式不符");
    check("registry 目录可用", registry.EVENT_NAMES.length > 0, ">0 事件", registry.EVENT_NAMES.length);
    check("metrics/signals 注册表可用", metrics.METRIC_IDS.length > 0 && signals.SIGNAL_IDS.length > 0, "两个注册表均非空", `${metrics.METRIC_IDS.length}/${signals.SIGNAL_IDS.length}`);
    check("policy 归一可用", typeof policy.normalizeBehavior({}).enabled === "boolean", "返回 enabled", "形状不符");
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  } finally {
    Module.prototype.require = origRequire;
    globalThis.fetch = saved.fetch;
    globalThis.XMLHttpRequest = saved.XMLHttpRequest;
    globalThis.WebSocket = saved.WebSocket;
  }
  check("全部行为模块可在网络封锁下加载并运作", loadError === null, "无异常", loadError);
  check("已加载全部 .js 行为模块", loaded === files.filter((f) => f.endsWith(".js")).length, `${files.filter((f) => f.endsWith(".js")).length} 个`, loaded);

  console.log(`\n==== behavior-no-network ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
