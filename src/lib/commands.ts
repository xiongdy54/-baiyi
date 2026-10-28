// CommandRegistry — 动作注册 {id, title, when, keybinding}（§4.2-2，M4 落地）
//
// 数据流：默认键（下方 COMMANDS 锁定表，AI_DEVELOPMENT_GUIDE.md §9.1 M4）
//        → settings.app.keybindings 只存用户覆盖项（缺省 = 默认键）
//        → getBinding 取生效键。
// 分发：window keydown（capture）→ 规范化组合键 → 按 COMMANDS 顺序找「键位匹配 + when() 放行」
//       的已注册动作执行，命中即 preventDefault + stopPropagation（拦截 Ctrl+A/Ctrl+S 等原生命中）。
// 安全边界：输入焦点（文本类 input/textarea/select/contentEditable）内绝不劫持（编辑态 Ctrl+Z/Ctrl+A 保持原语义）；
//           非文本控件（滑块/复选框/按钮）只让出它自己的原生键（D227，src/lib/keyTarget.ts）；
//           e.repeat 忽略（长按不连发）；抑制集合非空时全部放行（设置弹窗/键位捕获期间）。
import { settingsStore } from "./settings";
import { t } from "./i18n";
import { isImeComposing } from "./ime";
import { isTextEntryTarget, isNativeControlKey, isInModal } from "./keyTarget";
import { track } from "./behavior/track";

export interface CommandDef {
  id: string;
  title: string;
  scene: "阅读" | "复习";
  defaultKey: string;
}

// M4 默认键位（用户锁定表）。阅读场景五键 v49.36 / D207（审计 C-26，决策 D-03=B）改 SuperMemo
// 习惯的 Alt 系：Ctrl/Cmd+Z/X/A/S 还给系统通用含义（撤销/剪切/全选/保存）；mac 上 Option+字母
// 经下方物理键回落识别（Option 组合会改写 e.key）。
export const COMMANDS: CommandDef[] = [
  { id: "reader.makeCard",    title: "制卡",       scene: "阅读", defaultKey: "Alt+Z" },
  { id: "reader.aiCards",     title: "AI 制卡",    scene: "阅读", defaultKey: "Alt+C" },
  { id: "reader.aiExplain",   title: "AI 解释",    scene: "阅读", defaultKey: "Alt+E" },
  { id: "reader.extract",     title: "摘录",       scene: "阅读", defaultKey: "Alt+X" },
  { id: "reader.lookupWord",  title: "查词",       scene: "阅读", defaultKey: "Alt+D" },
  // v48.90（D130 P4c）：翻页键入命令条——←/→ 从 Reader 壳层硬编码 keydown 迁入（可改键；
  // PageUp/PageDown/空格不进表：避免与滚动场景的空格语义冲突，且不在「可自定义」诉求内）
  { id: "reader.turnPrev",    title: "上一页",     scene: "阅读", defaultKey: "ArrowLeft" },
  { id: "reader.turnNext",    title: "下一页",     scene: "阅读", defaultKey: "ArrowRight" },
  { id: "review.showAnswer",  title: "显示答案",   scene: "复习", defaultKey: "Space" },
  { id: "review.again",       title: "评分 Again", scene: "复习", defaultKey: "1" },
  { id: "review.hard",        title: "评分 Hard",  scene: "复习", defaultKey: "2" },
  { id: "review.good",        title: "评分 Good",  scene: "复习", defaultKey: "3" },
  { id: "review.easy",        title: "评分 Easy",  scene: "复习", defaultKey: "4" },
  // v22 增补（用户需求：误评无撤回）：一步撤销最近一次可撤销的评分
  { id: "review.undo",        title: "撤销评分",   scene: "复习", defaultKey: "Z" },
  { id: "review.markSuspend", title: "标记并暂停", scene: "复习", defaultKey: "Q" },
  { id: "review.skip",        title: "跳过",       scene: "复习", defaultKey: "W" },
  { id: "review.delete",      title: "删除",       scene: "复习", defaultKey: "D" },
  // v48.77（D121 §3.1）：辨析 / 有疑问——打开卡片辨析弹窗（答案翻开前后均可用）
  { id: "review.disambiguate", title: "辨析",      scene: "复习", defaultKey: "E" }
];

const DEFS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export type ComboInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> & { code?: string };

// 审计 C-26 步骤 1：mac 检测（Option 组合改写 e.key、Cmd 习惯修饰键，均需按平台区分）
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

// 审计 C-26 步骤 1：KeyboardEvent.code → 物理键名（字母 / 数字），其余（布局相关符号、修饰键等）返回 null
function keyFromCode(code?: string): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return null;
}

// 纯修饰键/IME 过程键不构成键位
const PURE_MODIFIER = new Set([
  "Control", "Alt", "Shift", "Meta", "CapsLock", "NumLock", "ScrollLock",
  "Fn", "FnLock", "ContextMenu", "Process", "Unidentified", "Dead", "Compose",
  "OS", "Hyper", "Super", "Symbol", "SymbolLock"
]);

// 键盘事件 → 规范化组合键串（修饰符固定顺序 Ctrl/Alt/Shift/Meta；空格=Space；字母大写）。
// 该串同时是存储格式与设置页展示格式。纯修饰键返回 null。
export function eventToCombo(e: ComboInput): string | null {
  let key = e.key || "";
  // 批次 D（D-TEST-14）：key 为空（部分 IME 组合过程、少数键盘）会拼出 "Ctrl+" 这种残缺串——
  // 它匹配不到任何键，却能被 setOverride 写进设置并被 conflictWith 当一条占用。
  if (!key) return null;
  if (key === " ") key = "Space";
  // 审计 C-26 步骤 1：mac 的 Option 组合、以及非拉丁布局下的字母键，按物理键解释——
  // Option+X 在 mac 产出 e.key="≈"、俄语布局 Ctrl+X 产出 e.key="ч"，都匹配不到 Ctrl+X/Alt+X；
  // code 缺省（测试合成事件）或非字母数字物理键时保持 e.key 原样（行为不变）。
  const nonAscii = key.length === 1 && !/[\x20-\x7e]/.test(key);
  if ((nonAscii || (IS_MAC && e.altKey)) && keyFromCode(e.code)) key = keyFromCode(e.code)!;
  if (PURE_MODIFIER.has(key)) return null;
  if (key.length === 1 && key.toLowerCase() !== key.toUpperCase()) key = key.toUpperCase();
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  mods.push(key);
  return mods.join("+");
}

// ---------- 覆盖项持久化（settings.app.keybindings，只存非默认键位） ----------

let overrides: Record<string, string> = {};
let initPromise: Promise<void> | null = null;

export function init(): Promise<void> {
  if (!initPromise) {
    initPromise = settingsStore
      .get<Record<string, string>>("app", "keybindings", {})
      .then((v) => { overrides = v && typeof v === "object" ? { ...v } : {}; })
      .catch(() => { overrides = {}; });
  }
  return initPromise;
}

// 审计 C-26 步骤 2：Mod 抽象——键位串允许写 Mod+X，加载默认值与用户覆盖时统一解析
// （IS_MAC → Meta，否则 Ctrl）。解析只发生在 getBinding 出口，存储串保持写法原样。
export const resolveMod = (c: string): string => c.replace(/(^|\+)Mod(?=\+)/, "$1" + (IS_MAC ? "Meta" : "Ctrl"));

function getBinding(id: string): string {
  const def = DEFS_BY_ID.get(id);
  if (!def) return "";
  const o = overrides[id];
  return resolveMod(typeof o === "string" && o ? o : def.defaultKey);
}

/**
 * 生效键的**显示串**（给按钮 title 用；无绑定＝空串）。
 * 走 getBinding ⇒ 用户在设置里改了键位，界面提示跟着变（不许把「空格」写死在按钮上）。
 */
const KEY_LABEL: Record<string, string> = { Space: "空格", ArrowLeft: "←", ArrowRight: "→", Enter: "回车", Escape: "Esc" };
export function bindingHint(id: string): string {
  const combo = getBinding(id);
  if (!combo) return "";
  return combo
    .split("+")
    .map((part) => (KEY_LABEL[part] ? t(KEY_LABEL[part]) : part))
    .join("+");
}

// 审计 C-26 步骤 2：设置页显示键位用——mac 上把 Meta 显示为 ⌘、Alt 显示为 ⌥；其余平台原样。
// 只改显示，不改存储串与匹配串（存储 = 匹配同串，见 eventToCombo 注释）。
const MAC_DISPLAY_LABEL: Record<string, string> = { Meta: "⌘", Alt: "⌥" };
export function displayCombo(combo: string): string {
  if (!combo || !IS_MAC) return combo;
  return combo
    .split("+")
    .map((part) => MAC_DISPLAY_LABEL[part] ?? part)
    .join("+");
}

function getAllBindings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of COMMANDS) out[def.id] = getBinding(def.id);
  return out;
}

async function setOverride(id: string, combo: string | null): Promise<void> {
  if (!DEFS_BY_ID.has(id)) return;
  const next = { ...overrides };
  if (combo) next[id] = combo;
  else delete next[id];
  overrides = next;
  await settingsStore.set("app", "keybindings", next);
}

async function resetAll(): Promise<void> {
  overrides = {};
  await settingsStore.set("app", "keybindings", {});
}

// 冲突检测：combo 与 excludeId 之外某个命令的生效键相同时返回那个命令
function conflictWith(combo: string, excludeId: string): CommandDef | null {
  for (const def of COMMANDS) {
    if (def.id === excludeId) continue;
    if (getBinding(def.id) === combo) return def;
  }
  return null;
}

// 备份恢复等外部改动 settings 后同步覆盖缓存（settings/changed 由 settingsStore.set 广播）
async function refreshOverrides(scope: string, key: string): Promise<void> {
  if (scope !== "app" || key !== "keybindings") return;
  overrides = (await settingsStore.get<Record<string, string>>("app", "keybindings", {})) ?? {};
}

// ---------- 动作注册（各视图经 useCommands 挂载，ref 保证闭包最新） ----------

export type CommandAction = { when?: () => boolean; run: () => void };
type ActionSource = () => Record<string, CommandAction> | null;
const actionSources = new Map<string, ActionSource>();

export function setActionSource(owner: string, source: ActionSource | null): void {
  if (source) actionSources.set(owner, source);
  else actionSources.delete(owner);
}

// ---------- 全局分发 ----------

const suppressions = new Set<string>();
function pushSuppress(reason: string): void { suppressions.add(reason); }
function popSuppress(reason: string): void { suppressions.delete(reason); }

// 纯逻辑分发（供 install 与测试共用）：命中并执行返回 true
function dispatchKey(e: ComboInput & { repeat?: boolean; target?: unknown }): boolean {
  if (suppressions.size > 0) return false;
  // 批次 D（D-TEST-13）：本文件开头与指南 §9.1 M4 都把「输入焦点内绝不劫持」写成硬约束，
  // 但分发此前没有任何焦点判断——焦点在 INPUT/TEXTAREA/contentEditable 里时一律放行给原生行为。
  // target 用 unknown：真实 KeyboardEvent 的 EventTarget 与测试投喂的字面量对象都能传进来。
  // v49.56 / D227：「在打字」只认文本类 input / textarea / select / contentEditable（isTextEntryTarget）；
  // 滑块、复选框等非文本控件不再整体屏蔽快捷键——拖完优先级滑块后空格 / Z 照常生效，
  // 只把该控件自己的原生键（滑块方向键、键盘聚焦按钮的回车/空格）让给控件（isNativeControlKey）。
  if (isTextEntryTarget(e.target)) return false;
  // A-12（审计）：焦点在**模态子树内**时，页面命令一律不命中。
  // 背景：install() 把 keydown 挂在 window 的**捕获相**（第三参 true），模态组件自己写
  // stopPropagation 也来不及；而全仓只有设置模态调过 pushSuppress。
  // 实测：对比卡向导开着时按「1」，背后那张看不见的卡被评了分（reps 0→1、队列 3→2、本轮 0→1）。
  // 用 closest 判一次即覆盖全部 8 个模态，不必逐个模态接线。
  if (isInModal(e.target)) return false;
  if (e.repeat) return false;
  if (isNativeControlKey(e)) return false;
  const combo = eventToCombo(e);
  if (!combo) return false;
  for (const def of COMMANDS) {
    if (getBinding(def.id) !== combo) continue;
    for (const source of actionSources.values()) {
      const actions = source();
      const action = actions ? actions[def.id] : undefined;
      if (!action) continue;
      if (action.when && !action.when()) continue;
      // D248（T7）：快捷键命令调用（via=shortcut；命令面板/菜单等入口由各自埋点区分）
      track("cmd.invoked", { props: { commandId: def.id, via: "shortcut" } });
      action.run();
      return true;
    }
  }
  return false;
}

let installed = false;
function install(): void {
  if (installed || typeof window === "undefined") return;
  window.addEventListener(
    "keydown",
    (e) => {
      if (isImeComposing(e)) return; // 审计 C-27：输入法组字中的按键（Enter 确认候选词等）属于输入法，不进命令分发
      if (dispatchKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  installed = true;
}

// settings/changed 同步（动态 import，失败不影响注册表本身）
void Promise.resolve()
  .then(async () => {
    const { eventBus } = await import("./eventbus");
    eventBus.on("settings/changed", (p) => {
      const { scope, key } = (p ?? {}) as { scope?: string; key?: string };
      if (scope && key) void refreshOverrides(scope, key);
    });
  })
  .catch(() => { /* 事件同步可选 */ });

export const commandRegistry = {
  init,
  install,
  COMMANDS,
  getAllBindings,
  setOverride,
  resetAll,
  conflictWith,
  eventToCombo,
  setActionSource,
  pushSuppress,
  popSuppress
};

// 测试专用（不进公开 API 语义）：直接驱动分发逻辑
export const __testHooks = { dispatchKey, getBinding };
