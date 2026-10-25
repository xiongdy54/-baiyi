// @runtime: electron-node
// C-40b（审计：业务核心与 Node/Electron 解耦）：纯净核心闸门——
// 对报告 C-40 证据 2 登记的「无 I/O」与「只依赖 crypto」模块逐文件扫描 require：
//   1) 禁止 I/O 与平台依赖：electron / fs / path / os / better-sqlite3 / sql.js /
//      child_process / worker_threads / http / https / net（含 node: 前缀形式）；
//   2) 相对路径 require 必须落在 CORE 清单内（传递闭包不自溢）；
//   3) 第三方包只允许 opencc-js / ts-fsrs（纯 JS，可随 WebView 复用）；
//   4) crypto / node:crypto 允许，但使用它的文件必须恰等于 NEEDS_CRYPTO_SHIM（移动端
//      要换成同步纯 JS 哈希——WebCrypto digest 是异步的，不能直接替）。
// 以后有人给核心模块加了 I/O，这个测试会失败（报告 C-40 步骤 2）。
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/core-purity.test.cjs
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ELECTRON_DIR = path.join(ROOT, "electron");

// 纯净核心清单（报告 C-40 证据 2；2026-10-25 实测核对：lmStrings 是 lmRecommend 的直接依赖、
// opencc-js 的实际落点（懒加载 require），报告清单遗漏——按实测补入「无 I/O」组，见进度账偏离）。
const CORE = [
  // —— 不依赖任何 I/O（23）——
  "annotationRange", "fsrsTime", "growth", "journalTime", "kpScopes", "legacyBackfill",
  "lmLevels", "lmLex", "lmParams", "lmText", "lmStrings", "memoryRetrieve",
  "mindmapBlocks", "mindmapCore", "mindmapOutline", "mindmapScheduler",
  "mindmapEngineV2", "mindmapV2Prompts", "pluginCore", "prompts", "statsTimeline",
  "udc", "aiNextExtract",
  // —— 只依赖 crypto（4）——
  "fsrsConfig", "kpNorm", "mindmapV2Core", "lmRecommend",
];
// 移动端需要替换为同步纯 JS 哈希的文件（报告 C-40 步骤 2 原文登记值）
const NEEDS_CRYPTO_SHIM = ["fsrsConfig", "kpNorm", "mindmapV2Core", "lmRecommend"];
// 核心禁区（报告 C-40 步骤 2a）
const FORBIDDEN = [
  "electron", "fs", "path", "os", "better-sqlite3", "sql.js",
  "child_process", "worker_threads", "http", "https", "net",
];
// 允许的第三方包（报告 C-40 步骤 2c）
const ALLOWED_THIRD_PARTY = ["opencc-js", "ts-fsrs"];

const stripNodePrefix = (spec) => (spec.startsWith("node:") ? spec.slice(5) : spec);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail || ""}`); }
}

// 逐文件提取全部 require("字面量")（含函数体内的惰性 require——lmStrings 的 opencc-js 即此形态）
function requiresOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

console.log("core-purity: 纯净核心闸门");

// 0) 清单完整性：CORE 与 NEEDS_CRYPTO_SHIM 的每个文件都必须存在
for (const name of [...new Set([...CORE, ...NEEDS_CRYPTO_SHIM])]) {
  check(`文件存在 electron/${name}.js`, fs.existsSync(path.join(ELECTRON_DIR, `${name}.js`)));
}
check(
  "NEEDS_CRYPTO_SHIM ⊆ CORE",
  NEEDS_CRYPTO_SHIM.every((n) => CORE.includes(n)),
  NEEDS_CRYPTO_SHIM.filter((n) => !CORE.includes(n)).join(", ")
);

// 1)-4) 逐文件扫描
const cryptoUsers = [];
for (const name of CORE) {
  const file = path.join(ELECTRON_DIR, `${name}.js`);
  const reqs = requiresOf(file);
  for (const spec of reqs) {
    if (spec.startsWith(".")) {
      // 相对路径：目标必须也在 CORE（传递闭包）
      const target = path.basename(spec).replace(/\.js$/, "");
      check(`${name}: 相对依赖 ./${target} ∈ CORE`, CORE.includes(target), `相对依赖越出核心闭包`);
    } else {
      const bare = stripNodePrefix(spec);
      if (bare === "crypto") {
        cryptoUsers.push(name);
        check(`${name}: crypto（node:${bare}）属登记豁免`, NEEDS_CRYPTO_SHIM.includes(name), `${name} 使用 crypto 但不在 NEEDS_CRYPTO_SHIM`);
      } else if (spec.startsWith("@") || spec.includes("/")) {
        // 带作用域或子路径的第三方（opencc-js 数据子包等）
        const top = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        check(`${name}: 第三方 ${spec} 在允许清单`, ALLOWED_THIRD_PARTY.includes(top), `第三方越出白名单`);
      } else {
        check(
          `${name}: ${spec}`,
          !FORBIDDEN.includes(bare) && ALLOWED_THIRD_PARTY.includes(spec),
          FORBIDDEN.includes(bare) ? `核心模块引入 I/O/平台依赖 ${spec}——业务核心被污染` : `第三方 ${spec} 不在允许清单（opencc-js/ts-fsrs）`
        );
      }
    }
  }
}

// 4) crypto 使用面恰好等于登记清单（双向）
check(
  "crypto 使用文件 == NEEDS_CRYPTO_SHIM",
  JSON.stringify([...new Set(cryptoUsers)].sort()) === JSON.stringify([...NEEDS_CRYPTO_SHIM].sort()),
  `实测使用 crypto：[${[...new Set(cryptoUsers)].sort().join(", ")}]，登记：[${[...NEEDS_CRYPTO_SHIM].sort().join(", ")}]`
);

console.log(`core-purity: ${pass} 通过 / ${fail} 失败（CORE ${CORE.length} 模块）`);
if (fail > 0) {
  console.error("FAIL 纯净核心被污染——移动端（D-05=A Capacitor）无法原样复用业务核心");
  process.exit(1);
}
process.exit(0);
