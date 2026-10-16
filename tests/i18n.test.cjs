// v49.8（D182）：i18n 核心行为 + 完整性闸门（node 直跑）。
// ① 行为：zh-CN 恒等 / 插值 / 复数 / 缺译回落 / zh-TW 转换（opencc） / 归一 / 切换订阅；
// ② 完整性：源码 t() 字面量键 × en/ja 词典比对（复用 scripts/i18n-check.mjs 同一实现）。
// 运行：node tests/i18n.test.cjs
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const url = require("url");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), `i18n-bundle-${process.pid}.cjs`);

const esbuild = require("esbuild");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src", "lib", "i18n.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT,
  logLevel: "silent",
  loader: { ".ts": "ts", ".tsx": "tsx" }
});
const i18n = require(OUT);

let pass = 0;
function eq(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
  } catch (e) {
    console.error(`FAIL ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
    process.exitCode = 1;
  }
}
function ok(name, cond) {
  if (cond) pass++;
  else {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
  }
}

// ---------- ① 行为 ----------
// 默认 zh-CN：恒等返回键（存量 GUI 套件零回归的根基）
eq("zh-CN 恒等", i18n.t("设置"), "设置");
eq("zh-CN 插值", i18n.t("共 {n} 张", { n: 24 }), "共 24 张");
eq("zh-CN 多参数", i18n.t("复习 · {title}", { title: "书名" }), "复习 · 书名");
eq("zh-CN 未知占位符保留", i18n.t("共 {n} 张"), "共 {n} 张");

// 缺译回落原文（en）
i18n.initLocale("en");
eq("en 已有键", i18n.t("书架"), "Library");
eq("en 缺键回落原文", i18n.t("完全不存在的一个键xyz"), "完全不存在的一个键xyz");
eq("en 插值走词典", i18n.t("复习 · {title}", { title: "B" }), "Review · B");

// 复数（en 张 = { one, other }）
eq("en 复数 one", i18n.t("张", { n: 1 }), "card");
eq("en 复数 other", i18n.t("张", { n: 5 }), "cards");
eq("en 复数缺 n 用 other", i18n.t("张"), "cards");

// 日文
i18n.initLocale("ja");
eq("ja 已有键", i18n.t("书架"), "ライブラリ");
eq("ja 缺键回落原文", i18n.t("不存在的日文键abc"), "不存在的日文键abc");

// zh-TW：opencc cn→twp + 领域词覆盖（断言只用覆盖表保证的词，opencc 词库项不作硬断言）
i18n.initLocale("zh-TW");
eq("zh-TW 覆盖表：材料导图", i18n.t("材料导图"), "材料心智圖");
eq("zh-TW 覆盖表：制卡", i18n.t("制卡"), "製卡");
ok("zh-TW opencc 就绪（设置→設定）", (() => { try { return i18n.t("设置") === "設定"; } catch { return false; } })());
// zh-TW 也插值
eq("zh-TW 插值", i18n.t("复习 · {title}", { title: "X" }), i18n.t("复习 · {title}").replace("{title}", "X"));

// 归一（与主进程写侧同规）
eq("normalizeLocale 合法", i18n.normalizeLocale("ja"), "ja");
eq("normalizeLocale 非法回落", i18n.normalizeLocale("zh"), "zh-CN");
eq("normalizeLocale 非字符串回落", i18n.normalizeLocale(42), "zh-CN");
eq("normalizeLocale undefined 回落", i18n.normalizeLocale(undefined), "zh-CN");

// 切换订阅（useSyncExternalStore 的 subscribe 面）
i18n.initLocale("zh-CN");
let notified = 0;
const un = i18n.subscribeI18n(() => notified++);
eq("subscribe 返回取消函数", typeof un, "function");
// setLocale 走 settingsStore（无 window.settingsAPI → memoryFallback，node 安全）
(async () => {
  await i18n.setLocale("en");
  eq("setLocale 生效", i18n.getLocale(), "en");
  ok("订阅者被通知", notified >= 1);
  await i18n.setLocale("zh-CN");
  eq("setLocale 回中文", i18n.getLocale(), "zh-CN");

  // ---------- ② 完整性闸门（与 scripts/i18n-check.mjs 同一实现） ----------
  const checkMod = await import(url.pathToFileURL(path.join(ROOT, "scripts", "i18n-check.mjs")).href);
  const check = checkMod.check();
  ok(`i18n 完整性：t() 键 ${check.total} 个，en 缺 ${check.missingEn.length}`, check.missingEn.length === 0);
  ok(`i18n 完整性：ja 缺 ${check.missingJa.length}`, check.missingJa.length === 0);
  for (const x of check.missingEn) console.error(`  [en 缺] ${x}`);
  for (const x of check.missingJa) console.error(`  [ja 缺] ${x}`);
  if (process.exitCode) {
    console.error(`\ni18n.test: FAILED`);
  } else {
    console.log(`i18n.test: ${pass} assertions passed（孤儿键：en ${check.orphansEn.length} / ja ${check.orphansJa.length}，仅提示）`);
  }
  try { fs.rmSync(OUT, { force: true }); } catch { /* 清理失败无害 */ }
})();
