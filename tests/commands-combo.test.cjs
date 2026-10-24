// C-26 快捷键跨平台：物理键回落（keyFromCode）/ Mod 抽象（resolveMod）/ mac 显示（displayCombo）/ 默认键位 Alt 系守卫
// 运行：node tests/commands-combo.test.cjs（运行时自行 esbuild src/lib/commands.ts → tests/tmp-commands-combo）
// @runtime: system-node
// mac 分支注入：IS_MAC 在模块加载时求值一次 → require 前 defineProperty(globalThis.navigator)。
"use strict";
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "tmp-commands-combo", "commands.cjs");

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/commands.ts")],
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  outfile: OUT,
  logLevel: "silent"
});

// --- navigator 注入（IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || userAgent)） ---
const NAV_DESC = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function setNavigator(platform) {
  Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true, writable: true });
}
function freshRequire() {
  delete require.cache[OUT];
  return require(OUT);
}
function restoreNavigator() {
  if (NAV_DESC) Object.defineProperty(globalThis, "navigator", NAV_DESC);
  else delete globalThis.navigator;
}

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)}`); }
}
const combo = (mod, ev) => mod.eventToCombo({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...ev });

// ---------- 1) IS_MAC：Option 组合与非拉丁布局按物理键解释（报告 C-26 验收四断言） ----------
setNavigator("MacIntel");
const mac = freshRequire();

console.log("== 1) IS_MAC=true：物理键回落（报告 C-26 验收断言 1-4） ==");
check("Option+X（e.key=≈，code=KeyX）→ Alt+X", combo(mac, { key: "≈", code: "KeyX", altKey: true }) === "Alt+X", combo(mac, { key: "≈", code: "KeyX", altKey: true }));
check("俄语布局 Ctrl+X（e.key=ч，code=KeyX）→ Ctrl+X", combo(mac, { key: "ч", code: "KeyX", ctrlKey: true }) === "Ctrl+X", combo(mac, { key: "ч", code: "KeyX", ctrlKey: true }));
check("拉丁键 x 行为不变：Ctrl+x（code=KeyX）→ Ctrl+X", combo(mac, { key: "x", code: "KeyX", ctrlKey: true }) === "Ctrl+X", combo(mac, { key: "x", code: "KeyX", ctrlKey: true }));
check("空 key 仍返回 null（code 不救空 key）", combo(mac, { key: "", code: "KeyX" }) === null, combo(mac, { key: "", code: "KeyX" }));
check("Option+Shift+X 修饰键顺序固定 → Alt+Shift+X", combo(mac, { key: "≈", code: "KeyX", altKey: true, shiftKey: true }) === "Alt+Shift+X", combo(mac, { key: "≈", code: "KeyX", altKey: true, shiftKey: true }));
check("非字母数字物理键不回落：Option+Tab（code=Tab）→ Alt+Tab", combo(mac, { key: "Tab", code: "Tab", altKey: true }) === "Alt+Tab", combo(mac, { key: "Tab", code: "Tab", altKey: true }));

console.log("== 2) IS_MAC=true：Mod 抽象与 mac 显示 ==");
check("resolveMod：Mod+X → Meta+X", mac.resolveMod("Mod+X") === "Meta+X", mac.resolveMod("Mod+X"));
check("resolveMod：Shift+Mod+X → Shift+Meta+X（中部 Mod 也解析）", mac.resolveMod("Shift+Mod+X") === "Shift+Meta+X", mac.resolveMod("Shift+Mod+X"));
check("resolveMod：非 Mod 串原样", mac.resolveMod("Ctrl+X") === "Ctrl+X", mac.resolveMod("Ctrl+X"));
check("displayCombo：Meta → ⌘", mac.displayCombo("Meta+X") === "⌘+X", mac.displayCombo("Meta+X"));
check("displayCombo：Alt → ⌥", mac.displayCombo("Alt+X") === "⌥+X", mac.displayCombo("Alt+X"));
check("displayCombo：其他串原样", mac.displayCombo("Ctrl+X") === "Ctrl+X", mac.displayCombo("Ctrl+X"));
check("getBinding 默认值 Alt 系（resolveMod 对无 Mod 默认值是恒等）", mac.__testHooks.getBinding("reader.makeCard") === "Alt+Z", mac.__testHooks.getBinding("reader.makeCard"));

// ---------- 3) IS_MAC=false：非 mac 平台行为（Windows/Linux） ----------
restoreNavigator();
setNavigator("win32");
const win = freshRequire();

console.log("== 3) IS_MAC=false：非拉丁布局与回落边界 ==");
check("俄语布局 Ctrl+X（e.key=ч，code=KeyX）→ Ctrl+X（与平台无关）", combo(win, { key: "ч", code: "KeyX", ctrlKey: true }) === "Ctrl+X", combo(win, { key: "ч", code: "KeyX", ctrlKey: true }));
check("非 ASCII + Alt（e.key=≈，code=KeyX）→ Alt+X（非 mac 同样按物理键）", combo(win, { key: "≈", code: "KeyX", altKey: true }) === "Alt+X", combo(win, { key: "≈", code: "KeyX", altKey: true }));
check("拉丁键行为不变：Ctrl+x → Ctrl+X", combo(win, { key: "x", code: "KeyX", ctrlKey: true }) === "Ctrl+X", combo(win, { key: "x", code: "KeyX", ctrlKey: true }));
check("空 key 仍返回 null", combo(win, { key: "", code: "KeyX" }) === null, combo(win, { key: "", code: "KeyX" }));
check("数字物理键回落：俄语布局 Ctrl+1（code=Digit1）→ Ctrl+1", combo(win, { key: "ч", code: "Digit1", ctrlKey: true }) === "Ctrl+1", combo(win, { key: "ч", code: "Digit1", ctrlKey: true }));
check("code 缺省保持旧行为：Ctrl+ч → Ctrl+Ч（既有大写归一不变；合成事件无 code）", combo(win, { key: "ч", ctrlKey: true }) === "Ctrl+Ч", combo(win, { key: "ч", ctrlKey: true }));
check("resolveMod：Mod+X → Ctrl+X（非 mac）", win.resolveMod("Mod+X") === "Ctrl+X", win.resolveMod("Mod+X"));
check("displayCombo：非 mac 原样（Meta 不转 ⌘）", win.displayCombo("Meta+X") === "Meta+X", win.displayCombo("Meta+X"));

// ---------- 4) 默认键位守卫（D-03=B 清单逐条；review 侧不动） ----------
console.log("== 4) COMMANDS 默认键位 = D-03=B 清单（17 条逐条） ==");
const WANT = {
  "reader.makeCard": ["阅读", "Alt+Z"],
  "reader.aiCards": ["阅读", "Alt+C"],
  "reader.aiExplain": ["阅读", "Alt+E"],
  "reader.extract": ["阅读", "Alt+X"],
  "reader.lookupWord": ["阅读", "Alt+D"],
  "reader.turnPrev": ["阅读", "ArrowLeft"],
  "reader.turnNext": ["阅读", "ArrowRight"],
  "review.showAnswer": ["复习", "Space"],
  "review.again": ["复习", "1"],
  "review.hard": ["复习", "2"],
  "review.good": ["复习", "3"],
  "review.easy": ["复习", "4"],
  "review.undo": ["复习", "Z"],
  "review.markSuspend": ["复习", "Q"],
  "review.skip": ["复习", "W"],
  "review.delete": ["复习", "D"],
  "review.disambiguate": ["复习", "E"]
};
check("命令条数 = 17", win.COMMANDS.length === 17, win.COMMANDS.length);
for (const [id, [scene, key]] of Object.entries(WANT)) {
  const def = win.COMMANDS.find((c) => c.id === id);
  check(`${id} = ${key}（${scene}）`, !!def && def.scene === scene && def.defaultKey === key, def);
}

// ---------- 5) 全局快捷键默认值平台分支（Windows/Linux 保持 Ctrl+Alt+Space；mac 改 Cmd+Shift+Space） ----------
console.log("== 5) quickCapture 全局快捷键默认值（静态守卫） ==");
const qcSrc = fs.readFileSync(path.join(ROOT, "electron", "quickCapture.js"), "utf8");
check("默认值 = darwin ? Cmd+Shift+Space : Ctrl+Alt+Space（D-03=B）", qcSrc.includes('process.platform === "darwin" ? "Cmd+Shift+Space" : "Ctrl+Alt+Space"'), "未找到平台分支默认值");
const spSrc = fs.readFileSync(path.join(ROOT, "src", "components", "SettingsPanel.tsx"), "utf8");
check("设置页 DEFAULT_GLOBAL_SHORTCUTS 与主进程平台分支一致（IS_MAC ? Cmd+Shift+Space : Ctrl+Alt+Space）", spSrc.includes('IS_MAC ? "Cmd+Shift+Space" : "Ctrl+Alt+Space"'), "未找到设置页平台分支");

restoreNavigator();
console.log(`\n合计：通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
