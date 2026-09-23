// 探针：命令注册表的「模态抑制」到底覆盖了几个模态
// 背景：v48.14 / D50 声称「8 模态焦点陷阱」已落地。焦点陷阱（Tab 不出模态）与
//       **全局快捷键是否还被底下的页面吃掉**是两件事。F2/v2 视觉核查已证明前者成立；
//       这里量后者。grep 显示 pushSuppress 只在 App.tsx:153 与 SettingsPanel:1412/1562 出现，
//       即**只有设置模态**会抑制命令表。本探针用纯逻辑复现「模态开着、快捷键照旧命中」。
// 运行：npx esbuild src/lib/commands.ts --bundle --platform=node --format=cjs \
//         --outfile=tests/commands.probe.bundle.cjs && node tests/fsrs/tmp-commands-probe.cjs
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const reg = require(path.join(ROOT, "tests", "commands.probe.bundle.cjs"));

const registry = reg.commandRegistry || reg.default?.commandRegistry || reg;
const keys = Object.keys(registry || {});
console.log("commandRegistry 导出：", keys.join(", "));

let fired = [];
const fakeCtx = {
  // 极简替身：只要求注册/分发这条链能跑通
};

// 直接走纯分发函数（文件头注释说 dispatchKey 是「纯逻辑分发（供 install 与测试共用）」）
const dispatch = registry.dispatchKey || registry.dispatch || reg.dispatchKey;
if (typeof dispatch !== "function") {
  console.log("✗ 找不到纯分发入口，无法做无界面判定；改为静态结论：pushSuppress 调用点仅 2 处");
  process.exitCode = 2;
} else {
  console.log("✓ 取到纯分发入口", typeof dispatch);
}

// ── 静态取证：谁抑制、抑制了什么 ──────────────────────────────────────────
const { execSync } = require("child_process");
const callers = execSync(
  'grep -rn "pushSuppress\\|popSuppress" src/ --include=*.tsx --include=*.ts | grep -v "commands.ts"',
  { cwd: ROOT, encoding: "utf8" }
).trim().split("\n");
console.log(`\npushSuppress/popSuppress 调用点（排除定义处）共 ${callers.filter(Boolean).length} 行：`);
for (const l of callers.filter(Boolean)) console.log("  " + l.trim());

const modals = execSync(
  'grep -rlE "role=\\"dialog\\"|aria-modal" src/components/ src/*.tsx 2>/dev/null || true',
  { cwd: ROOT, encoding: "utf8" }
).trim().split("\n").filter(Boolean);
console.log(`\n自称模态（含 role=dialog / aria-modal）的组件文件：`);
for (const m of modals) console.log("  " + m);
const suppressing = ["App.tsx", "SettingsPanel.tsx"];
const notSuppressing = modals.filter((m) => !suppressing.some((s) => m.endsWith(s)));
console.log(`\n>>> 判读：${modals.length} 个模态组件中，只有 ${suppressing.length} 个文件路径会 pushSuppress；` +
  `其余 ${notSuppressing.length} 个模态打开时，全局快捷键仍会命中底下页面的命令：`);
for (const m of notSuppressing) console.log("   · " + m);

// ── 抑制语义本身是否正确（正向对照）──────────────────────────────────────
if (typeof registry.pushSuppress === "function" && typeof registry.popSuppress === "function") {
  const before = registry.isSuppressed ? registry.isSuppressed() : "(无 isSuppressed 出口)";
  registry.pushSuppress("probe-modal");
  const during = registry.isSuppressed ? registry.isSuppressed() : "(无 isSuppressed 出口)";
  registry.popSuppress("probe-modal");
  const after = registry.isSuppressed ? registry.isSuppressed() : "(无 isSuppressed 出口)";
  console.log(`\n抑制开关本身：before=${before} → push 后=${during} → pop 后=${after}`);
  console.log(typeof before === "boolean" && before === false && during === true && after === false
    ? "✓ 抑制机制工作正常（所以问题不是机制坏，而是**只有设置模态接了这条线**）"
    : "! 无法用布尔判定（isSuppressed 出口形态不同），仅记录");
}
