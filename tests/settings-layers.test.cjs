// @runtime: electron-node
// C-38d：设置分层（electron/settingsLayers.js）——DEVICE_KEYS 唯一真源的机器闸门。
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/settings-layers.test.cjs
// 覆盖（报告 C-38 步骤 5）：DEVICE_KEYS 里每个键在 electron/ 或 src/ 中至少出现一次
//   （防止登记了已删除的键）；清单字面量（DEVICE_KEYS 接 " = ["）只在
//   electron/settingsLayers.js 出现（防止第二份清单漂移；本文件注释动态规避自命中）；
//   layerOf 分类面抽查。
"use strict";
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const st = require(path.join(ROOT, "electron", "settingsLayers.js"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

// 递归收集文本源文件（跳过 node_modules / 构建产物 / 测试结果）
const TEXT_EXT = new Set([".js", ".ts", ".tsx", ".cjs", ".mjs", ".jsx", ".md", ".json", ".css", ".html"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "release", "build", "coverage", ".results", "tmp"]);
function walkFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(path.join(dir, e.name), out);
    } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const electronFiles = walkFiles(path.join(ROOT, "electron"), []);
const srcFiles = walkFiles(path.join(ROOT, "src"), []);
const codeFiles = [...electronFiles, ...srcFiles];

console.log("== T1 DEVICE_KEYS 每个键在 electron/ 或 src/ 至少出现一次 ==");
const absent = [];
for (const key of st.DEVICE_KEYS) {
  const re = new RegExp("(^|[^A-Za-z0-9_])" + key + "([^A-Za-z0-9_]|$)");
  const hit = codeFiles.some((f) => re.test(fs.readFileSync(f, "utf8")));
  if (!hit) absent.push(key);
}
check("登记键全部真实存在", absent.length === 0, "零幽灵键", absent);

console.log("== T2 清单字面量只在 settingsLayers.js（防第二份清单漂移） ==");
// 字面量动态拼装——避免本测试源码自身命中扫描；扫描面 = 代码目录（docs 叙述性提及不算清单副本）
const LIT = "DEVICE_KEYS" + " = [";
const codeDirs = ["electron", "src", "scripts", "tests"].map((d) => path.join(ROOT, d));
const codeScan = codeDirs.flatMap((d) => walkFiles(d, []));
const withLiteral = codeScan.filter((f) => fs.readFileSync(f, "utf8").includes(LIT));
check("「" + LIT + "」只出现在 electron/settingsLayers.js",
  withLiteral.length === 1 && path.basename(withLiteral[0]) === "settingsLayers.js",
  ["electron/settingsLayers.js"], withLiteral.map((f) => path.relative(ROOT, f)));

console.log("== T3 layerOf 分类面抽查 ==");
check("backupDir → device", st.layerOf("backupDir") === "device", "device", st.layerOf("backupDir"));
check("closeToTray → device", st.layerOf("closeToTray") === "device", "device", st.layerOf("closeToTray"));
check("dayCutoffHour → library（学习偏好随资料库走）", st.layerOf("dayCutoffHour") === "library", "library", st.layerOf("dayCutoffHour"));
check("siblingBury → library", st.layerOf("siblingBury") === "library", "library", st.layerOf("siblingBury"));
check("未登记键回落 library（默认随同步走）", st.layerOf("someFutureKey") === "library", "library", st.layerOf("someFutureKey"));

console.log(`\n设置分层测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
