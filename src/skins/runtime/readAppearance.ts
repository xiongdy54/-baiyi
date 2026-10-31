// C-31：窗口外观读取的唯一实现面——逻辑逐行搬自 App.tsx 初始化段（v49.0 / D170 皮肤预载 + D172 按皮肤
// 记忆 accent + D170 动效三态），主窗口 App.tsx 与三个独立窗口（lens / 制卡台 / 捕获，经 WindowSkin）
// 共用这一份实现。此前独立窗口只经 applyCaptureAppearance 读 theme.mode + app.accentColor 原键：
// 非默认皮肤下 accentBySkin 的记忆值、皮肤 CSS、动效三态类都同步不到（报告 C-31 证据）。
import { DEFAULT_SKIN_ID, loadSkin } from "../index";
import { motionClass, resolveMotion, type MotionSetting } from "./motionLevel";
import type { MotionLevel } from "../types";
import { applyAccent } from "../../lib/accentVar";
import { settingsStore } from "../../lib/settings";

export interface Appearance {
  mode: "light" | "dark";
  /** C-37：theme.mode 原始档（"light" | "dark" | "system"）——调用方据它决定是否挂系统深浅色监听、
   * 设置页高亮哪一档；未知值归一为 "system"（与 resolveThemeMode 的未知值语义一致：按系统解析）。 */
  modeSetting: "light" | "dark" | "system";
  skinId: string;
  accent: string;
  motion: MotionLevel;
  motionSetting: MotionSetting;
  /** App.tsx 状态水合用的原始读取值（报告接口之外的超集字段，避免主窗口二次读键）：app.accentColor 原键与 accentBySkin 全图 */
  accentLegacy: string;
  accentBySkin: Record<string, string>;
}

/** C-37：theme.mode → 落窗主题档。显式 "light"/"dark" 原样返回；"system" 与未知值按系统
 * prefers-color-scheme 解析（报告 C-37 修复步骤 2 逐字）。所有窗口的主题类都消费它的结果。 */
export function resolveThemeMode(mode: string): "light" | "dark" {
  if (mode === "dark" || mode === "light") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; // "system" 与未知值
}

/** 读取当前外观（theme.mode / app.skinId / accentColor / accentBySkin / motionLevel）；
 * 已保存皮肤 loadSkin 失败回落默认皮肤；按 D172 计算有效强调色。 */
export async function readAppearance(): Promise<Appearance> {
  const [m, s, a, abs, ml] = await Promise.all([
    settingsStore.get<string>("theme", "mode", "light"),
    settingsStore.get<string>("app", "skinId", DEFAULT_SKIN_ID),
    settingsStore.get<string>("app", "accentColor", ""),
    settingsStore.get<Record<string, string>>("app", "accentBySkin", {}),
    settingsStore.get<MotionSetting>("app", "motionLevel", "system")
  ]);
  // v49.0 / D170：预载已保存皮肤（避免闪默认皮）；加载失败回落默认
  let skin = DEFAULT_SKIN_ID;
  if (s && s !== DEFAULT_SKIN_ID) {
    try {
      await loadSkin(s);
      skin = s;
    } catch (err) {
      console.error("[skin] 已保存皮肤加载失败，回落默认", err);
      skin = DEFAULT_SKIN_ID;
    }
  }
  // v49.0 / D172：accent 按皮肤记忆——默认皮肤用原键，其他皮肤用 accentBySkin[skinId]
  const accent = skin === DEFAULT_SKIN_ID ? a : (abs || {})[skin] || "";
  const motionSetting: MotionSetting = ml === "off" ? "off" : "system";
  return {
    mode: resolveThemeMode(m),
    modeSetting: m === "dark" || m === "light" ? m : "system", // 未知值与 "system" 同归一（见 modeSetting 注）
    skinId: skin,
    accent,
    motion: resolveMotion(motionSetting),
    motionSetting,
    accentLegacy: a,
    accentBySkin: abs || {}
  };
}

/** 把外观一次性落到文档：body 主题双类 + 动效三态类（motion-full/reduced/off）+ --user-accent 三件套。
 * 主窗口 App.tsx 的 effect 与独立窗口 WindowSkin / applyCaptureAppearance 共用同一条落类规则。 */
export function applyAppearanceToDocument(ap: Appearance): void {
  document.body.classList.toggle("theme-dark", ap.mode === "dark");
  document.body.classList.toggle("theme-light", ap.mode !== "dark");
  document.body.classList.remove("motion-full", "motion-reduced", "motion-off");
  document.body.classList.add(motionClass(ap.motion));
  // 单一入口：自定义 accent 必须同步反白档 --accent-on（accentVar 自管）
  applyAccent(ap.accent);
}

/** v49.90 / D257：主题 / 皮肤切换的统一过渡入口（品牌临时设计系统 docs/05-themes.md「切换动效」+
 * docs/09-motion.md「主题切换」：整页交叉淡化 400ms、cubic-bezier(.4,0,.2,1)，取值照抄其 tokens.css
 * 的 --dur-theme / --ease-theme，本应用落为 theme.css 同名 Token）。update 必须**同步**落完所有外观变更
 * （body 主题类 / 皮肤 CSS / --user-accent；主窗口与 WindowSkin 各自用 flushSync 提交 React 状态）。
 * 降级＝立即应用、不垫 fallback 动画：不支持 View Transitions / 减少动态 / 应用动效关闭 /
 * 页面切换（data-vt）进行中。documentElement 带 data-theme-vt 期间由 theme.css 的 VT 规则接管。 */
let appearanceVtGen = 0;
export function runAppearanceTransition(update: () => void): void {
  const host = document as unknown as { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const root = document.documentElement;
  const reduced =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (
    typeof host.startViewTransition !== "function" ||
    reduced ||
    document.body?.classList.contains("motion-off") ||
    root.dataset.vt
  ) {
    update();
    return;
  }
  const my = ++appearanceVtGen;
  root.dataset.themeVt = "1";
  let vt: { finished: Promise<void> };
  try {
    vt = host.startViewTransition(update);
  } catch {
    if (appearanceVtGen === my) delete root.dataset.themeVt;
    update();
    return;
  }
  const cleanup = () => {
    if (appearanceVtGen === my) delete root.dataset.themeVt;
  };
  // 兜底：窗口被隐藏 / 遮挡时 Chromium 可能让 VT 的 finished 长期不结算——
  // 标记滞留会让后续页面切换误用主题档，故 1.5s 后强制摘除（正常路径 400ms 即结算）。
  const guard = window.setTimeout(cleanup, 1500);
  vt.finished
    .catch(() => { /* 跳过 / 失败路径同样结算，统一走 finally 清理 */ })
    .finally(() => {
      window.clearTimeout(guard);
      cleanup();
    });
}

/** 外观相关的设置键（app 域；theme 域整体相关）——WindowSkin 刷新的 scope/key 过滤规则 */
const APPEARANCE_APP_KEYS = ["skinId", "accentColor", "accentBySkin", "motionLevel"];

/** C-31：设置变更是否影响窗口外观——scope=theme 任意键，或 scope=app 且 key ∈ 外观四键。
 * （accent 写入在非默认皮肤下落 accentBySkin、默认皮肤落 accentColor，两者都在列。） */
export function isAppearanceSettingsChange(p: { scope: string; key: string }): boolean {
  if (p.scope === "theme") return true;
  return p.scope === "app" && APPEARANCE_APP_KEYS.includes(p.key);
}
