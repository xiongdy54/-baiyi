/**
 * 键盘目标分类（v49.56 / D227）：页面快捷键（复习 / 摘录 / 阅读）该不该响应某次按键。
 *
 * 旧口径把**所有** INPUT 都当成「正在打字」——焦点停在优先级滑块、复选框上时，空格 / 回车 / Z
 * 全部失效（用户实测：拖完滑块 Ctrl+Z 与空格都没反应）。新口径分两层：
 *
 * 1. `isTextEntryTarget`：真正在输入文字的地方（文本类 input、textarea、select、contentEditable）
 *    ——页面快捷键一律让路；
 * 2. `isNativeControlKey`：焦点在非文本控件上、且这个键正是该控件自己的原生操作键
 *    ——滑块的方向键 / Home / End / PageUp / PageDown（调值）、**键盘聚焦**（Tab 选中，`:focus-visible`）
 *    的按钮 / 链接 / 复选框 / 单选框的回车与空格（激活它自己）。鼠标点过之后焦点留在按钮上时，
 *    回车与空格仍归页面快捷键（SuperMemo 式连续处理的既有手感）。
 *
 * target 用 unknown：真实 KeyboardEvent 的 EventTarget 与测试投喂的字面量对象都能传进来。
 */

type KeyTargetLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  matches?: (sel: string) => boolean;
};

/** 不接受文字输入的 input 类型（其余类型——text/number/search/email/date… ——都算打字） */
const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);
/** 激活类 input：键盘聚焦时回车 / 空格属于控件本身 */
const ACTIVATABLE_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);
/** 激活类 ARIA 角色 */
const ACTIVATABLE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "switch", "tab", "option",
  "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem"
]);
/** 调值键（滑块 / 单选组 / role=slider 的原生语义） */
const VALUE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

function asTarget(t: unknown): KeyTargetLike | null {
  return t && typeof t === "object" ? (t as KeyTargetLike) : null;
}
function tagOf(t: KeyTargetLike): string {
  return String(t.tagName || "").toUpperCase();
}
function inputTypeOf(t: KeyTargetLike): string {
  const fromProp = typeof t.type === "string" ? t.type : "";
  const fromAttr = typeof t.getAttribute === "function" ? t.getAttribute("type") || "" : "";
  return String(fromProp || fromAttr || "text").toLowerCase();
}
function roleOf(t: KeyTargetLike): string {
  return typeof t.getAttribute === "function" ? String(t.getAttribute("role") || "").toLowerCase() : "";
}
/** 焦点是否经键盘到达（Tab / 方向键）。不支持 :focus-visible 的环境保守视为「否」（维持页面快捷键）。 */
function isKeyboardFocused(t: KeyTargetLike): boolean {
  if (typeof t.matches !== "function") return false;
  try {
    return t.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** 正在输入文字：文本类 input / textarea / select / contentEditable（页面快捷键一律让路） */
export function isTextEntryTarget(target: unknown): boolean {
  const t = asTarget(target);
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = tagOf(t);
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has(inputTypeOf(t));
  return false;
}

/** 该键属于焦点控件自己的原生操作（见文件头第 2 条）；纯文本输入目标由 isTextEntryTarget 另判 */
export function isNativeControlKey(e: { key?: string; target?: unknown }): boolean {
  const t = asTarget(e.target);
  if (!t) return false;
  const key = String(e.key || "");
  const tag = tagOf(t);
  const role = roleOf(t);
  const type = tag === "INPUT" ? inputTypeOf(t) : "";
  // 调值键：滑块 / role=slider / 单选（方向键在组内移动）——无论鼠标还是键盘聚焦都归控件
  if (VALUE_KEYS.has(key)) {
    if (type === "range" || role === "slider" || role === "spinbutton") return true;
    if ((type === "radio" || role === "radio") && key.startsWith("Arrow")) return true;
    return false;
  }
  if (key !== "Enter" && key !== " ") return false;
  // 激活键：只有键盘聚焦（Tab 选中）的可激活控件才归控件；滑块的回车 / 空格没有原生语义，归页面
  if (type === "range") return false;
  const activatable =
    tag === "BUTTON" ||
    tag === "SUMMARY" ||
    (tag === "A" && typeof t.hasAttribute === "function" && t.hasAttribute("href")) ||
    (tag === "INPUT" && ACTIVATABLE_INPUT_TYPES.has(type)) ||
    ACTIVATABLE_ROLES.has(role);
  if (!activatable) return false;
  // 链接只认回车（空格在链接上是滚动页面，不是激活）
  if ((tag === "A" || role === "link") && key === " ") return false;
  // 复选框 / 单选框的回车不切换（原生只认空格），回车归页面
  if ((type === "checkbox" || type === "radio") && key === "Enter") return false;
  return isKeyboardFocused(t);
}

/** 焦点在模态子树内（对话框 / aria-modal）：页面快捷键一律不命中（A-12 同口径） */
export function isInModal(target: unknown): boolean {
  const t = target as { closest?: (sel: string) => Element | null } | null | undefined;
  if (!t || typeof t.closest !== "function") return false;
  try {
    return Boolean(t.closest('[role="dialog"],[aria-modal="true"]'));
  } catch {
    return false;
  }
}
