// @runtime: node
// D227（v49.56）：键盘目标分类单测（src/lib/keyTarget.ts）——「在打字」只认文本输入；
// 滑块 / 复选框 / 按钮等非文本控件只让出它自己的原生键（滑块方向键、键盘聚焦按钮的回车与空格），
// 其余按键照常交给页面快捷键（用户实测：拖完优先级滑块后 Ctrl+Z / 空格 / 回车都没反应）。
// 运行：node scripts/run-tests.mjs key-target（直跑：node tests/key-target.test.cjs）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "keytarget-"));
const out = path.join(outDir, "keyTarget.cjs");
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "lib", "keyTarget.ts")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  outfile: out,
  logLevel: "silent"
});
const kt = require(out);

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)}`); }
}
/** 伪元素：tagName / type / role / href / 是否键盘聚焦（:focus-visible） */
function el(tagName, { type, role, href, kbd = false, ce = false, throwMatches = false } = {}) {
  const attrs = {};
  if (type !== undefined) attrs.type = type;
  if (role !== undefined) attrs.role = role;
  if (href !== undefined) attrs.href = href;
  return {
    tagName,
    type: tagName === "INPUT" ? (type ?? "text") : undefined,
    isContentEditable: ce,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    hasAttribute: (n) => n in attrs,
    matches: (sel) => {
      if (throwMatches) throw new Error("unsupported selector");
      return sel === ":focus-visible" ? kbd : false;
    }
  };
}

console.log("== K1 isTextEntryTarget：只有文本输入算「在打字」 ==");
check("文本 input（缺省 type）", kt.isTextEntryTarget(el("INPUT")) === true, null);
check("number input（优先级数字盒）仍算打字", kt.isTextEntryTarget(el("INPUT", { type: "number" })) === true, null);
check("search input 算打字", kt.isTextEntryTarget(el("INPUT", { type: "search" })) === true, null);
check("textarea 算打字", kt.isTextEntryTarget(el("TEXTAREA")) === true, null);
check("select 算打字（字母键是它的检索键）", kt.isTextEntryTarget(el("SELECT")) === true, null);
check("contentEditable 算打字", kt.isTextEntryTarget(el("DIV", { ce: true })) === true, null);
check("range 滑块不算打字（A2 根因）", kt.isTextEntryTarget(el("INPUT", { type: "range" })) === false, null);
check("checkbox 不算打字", kt.isTextEntryTarget(el("INPUT", { type: "checkbox" })) === false, null);
check("radio / button / color 不算打字", ["radio", "button", "color"].every((t) => kt.isTextEntryTarget(el("INPUT", { type: t })) === false), null);
check("button 元素不算打字", kt.isTextEntryTarget(el("BUTTON")) === false, null);
check("null / window 一类目标不算打字", kt.isTextEntryTarget(null) === false && kt.isTextEntryTarget({}) === false, null);
check("只有 tagName 的字面量 INPUT（F20 夹具形状）按文本处理", kt.isTextEntryTarget({ tagName: "INPUT" }) === true, null);

console.log("== K2 isNativeControlKey：控件自己的原生键 ==");
const range = el("INPUT", { type: "range" });
check("滑块 ← → ↑ ↓ Home End PageUp PageDown 归滑块", ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].every((k) => kt.isNativeControlKey({ key: k, target: range })), null);
check("滑块上的空格归页面（下一条）", kt.isNativeControlKey({ key: " ", target: range }) === false, null);
check("滑块上的回车归页面", kt.isNativeControlKey({ key: "Enter", target: range }) === false, null);
check("滑块上的 Z 归页面（撤销）", kt.isNativeControlKey({ key: "z", target: range }) === false, null);
check("输入法组字中的回车归输入法（isComposing）", kt.isNativeControlKey({ key: "Enter", target: range, isComposing: true }) === true, null);
check("输入法组字中的按键归输入法（keyCode 229）", kt.isNativeControlKey({ key: "Process", target: range, keyCode: 229 }) === true, null);
check("role=slider 的 Home 归控件", kt.isNativeControlKey({ key: "Home", target: el("DIV", { role: "slider" }) }) === true, null);
check("Tab 选中的按钮：回车归按钮（C1：不再执行「下一条」）", kt.isNativeControlKey({ key: "Enter", target: el("BUTTON", { kbd: true }) }) === true, null);
check("Tab 选中的按钮：空格归按钮", kt.isNativeControlKey({ key: " ", target: el("BUTTON", { kbd: true }) }) === true, null);
check("鼠标点过的按钮：回车 / 空格仍归页面（连续处理手感不变）", kt.isNativeControlKey({ key: "Enter", target: el("BUTTON") }) === false && kt.isNativeControlKey({ key: " ", target: el("BUTTON") }) === false, null);
check("按钮上的方向键不归按钮", kt.isNativeControlKey({ key: "ArrowLeft", target: el("BUTTON", { kbd: true }) }) === false, null);
check("键盘聚焦的链接：回车归链接、空格不归", kt.isNativeControlKey({ key: "Enter", target: el("A", { href: "#", kbd: true }) }) === true && kt.isNativeControlKey({ key: " ", target: el("A", { href: "#", kbd: true }) }) === false, null);
check("无 href 的 A 不是可激活控件", kt.isNativeControlKey({ key: "Enter", target: el("A", { kbd: true }) }) === false, null);
check("键盘聚焦的复选框：空格归复选框、回车归页面", kt.isNativeControlKey({ key: " ", target: el("INPUT", { type: "checkbox", kbd: true }) }) === true && kt.isNativeControlKey({ key: "Enter", target: el("INPUT", { type: "checkbox", kbd: true }) }) === false, null);
check("鼠标点过的复选框：空格归页面", kt.isNativeControlKey({ key: " ", target: el("INPUT", { type: "checkbox" }) }) === false, null);
check("单选框方向键归单选组", kt.isNativeControlKey({ key: "ArrowDown", target: el("INPUT", { type: "radio" }) }) === true, null);
check("role=button / menuitem 键盘聚焦时回车归控件", kt.isNativeControlKey({ key: "Enter", target: el("DIV", { role: "button", kbd: true }) }) === true && kt.isNativeControlKey({ key: "Enter", target: el("LI", { role: "menuitem", kbd: true }) }) === true, null);
check("普通 DIV 的回车不归控件", kt.isNativeControlKey({ key: "Enter", target: el("DIV", { kbd: true }) }) === false, null);
check(":focus-visible 不受支持（matches 抛错）时保守归页面", kt.isNativeControlKey({ key: "Enter", target: el("BUTTON", { throwMatches: true }) }) === false, null);
check("无 matches 的字面量目标归页面", kt.isNativeControlKey({ key: "Enter", target: { tagName: "BUTTON" } }) === false, null);
check("无目标不抛错", kt.isNativeControlKey({ key: "Enter" }) === false, null);

console.log("== K3 isInModal ==");
check("closest 命中对话框＝在模态内", kt.isInModal({ closest: () => ({}) }) === true, null);
check("closest 未命中＝不在模态内", kt.isInModal({ closest: () => null }) === false, null);
check("无 closest（window / 字面量）＝不在模态内", kt.isInModal({}) === false && kt.isInModal(null) === false, null);

try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* 临时目录留给系统 */ }
console.log(`\n==== key-target：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail > 0 ? 1 : 0);
