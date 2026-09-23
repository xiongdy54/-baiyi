// CommandRegistry — 动作注册 {id, title, when, keybinding}（§4.2-2，M4 落地）
//
// 数据流：默认键（下方 COMMANDS 锁定表，AI_DEVELOPMENT_GUIDE.md §9.1 M4）
//        → settings.app.keybindings 只存用户覆盖项（缺省 = 默认键）
//        → getBinding 取生效键。
// 分发：window keydown（capture）→ 规范化组合键 → 按 COMMANDS 顺序找「键位匹配 + when() 放行」
//       的已注册动作执行，命中即 preventDefault + stopPropagation（拦截 Ctrl+A/Ctrl+S 等原生命中）。
// 安全边界：输入焦点（input/textarea/contentEditable）内绝不劫持（编辑态 Ctrl+Z/Ctrl+A 保持原语义）；
//           e.repeat 忽略（长按不连发）；抑制集合非空时全部放行（设置弹窗/键位捕获期间）。
import { settingsStore } from "./settings";

export interface CommandDef {
  id: string;
  title: string;
  scene: "阅读" | "复习";
  defaultKey: string;
}

// M4 默认键位（用户锁定表）
export const COMMANDS: CommandDef[] = [
  { id: "reader.makeCard",    title: "制卡",       scene: "阅读", defaultKey: "Ctrl+Z" },
  { id: "reader.aiCards",     title: "AI 制卡",    scene: "阅读", defaultKey: "Ctrl+X" },
  { id: "reader.aiExplain",   title: "AI 解释",    scene: "阅读", defaultKey: "Ctrl+A" },
  { id: "reader.extract",     title: "摘录",       scene: "阅读", defaultKey: "Ctrl+S" },
  { id: "reader.lookupWord",  title: "查词",       scene: "阅读", defaultKey: "Ctrl+D" },
  { id: "review.showAnswer",  title: "显示答案",   scene: "复习", defaultKey: "Space" },
  { id: "review.again",       title: "评分 Again", scene: "复习", defaultKey: "1" },
  { id: "review.hard",        title: "评分 Hard",  scene: "复习", defaultKey: "2" },
  { id: "review.good",        title: "评分 Good",  scene: "复习", defaultKey: "3" },
  { id: "review.easy",        title: "评分 Easy",  scene: "复习", defaultKey: "4" },
  // v22 增补（用户需求：误评无撤回）：一步撤销最近一次可撤销的评分
  { id: "review.undo",        title: "撤销评分",   scene: "复习", defaultKey: "Z" },
  { id: "review.markSuspend", title: "标记并暂停", scene: "复习", defaultKey: "Q" },
  { id: "review.skip",        title: "跳过",       scene: "复习", defaultKey: "W" },
  { id: "review.delete",      title: "删除",       scene: "复习", defaultKey: "D" }
];

const DEFS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export type ComboInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

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

function getBinding(id: string): string {
  const def = DEFS_BY_ID.get(id);
  if (!def) return "";
  const o = overrides[id];
  return typeof o === "string" && o ? o : def.defaultKey;
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
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => Element | null } | null | undefined;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return false;
  // A-12（审计）：焦点在**模态子树内**时，页面命令一律不命中。
  // 背景：install() 把 keydown 挂在 window 的**捕获相**（第三参 true），模态组件自己写
  // stopPropagation 也来不及；而全仓只有设置模态调过 pushSuppress。
  // 实测：对比卡向导开着时按「1」，背后那张看不见的卡被评了分（reps 0→1、队列 3→2、本轮 0→1）。
  // 用 closest 判一次即覆盖全部 8 个模态，不必逐个模态接线。
  if (t && typeof t.closest === "function" && t.closest('[role="dialog"],[aria-modal="true"]')) return false;
  if (e.repeat) return false;
  const combo = eventToCombo(e);
  if (!combo) return false;
  for (const def of COMMANDS) {
    if (getBinding(def.id) !== combo) continue;
    for (const source of actionSources.values()) {
      const actions = source();
      const action = actions ? actions[def.id] : undefined;
      if (!action) continue;
      if (action.when && !action.when()) continue;
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
