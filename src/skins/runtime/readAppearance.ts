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
  skinId: string;
  accent: string;
  motion: MotionLevel;
  motionSetting: MotionSetting;
  /** App.tsx 状态水合用的原始读取值（报告接口之外的超集字段，避免主窗口二次读键）：app.accentColor 原键与 accentBySkin 全图 */
  accentLegacy: string;
  accentBySkin: Record<string, string>;
}

/** 读取当前外观（theme.mode / app.skinId / accentColor / accentBySkin / motionLevel）；
 * 已保存皮肤 loadSkin 失败回落默认皮肤；按 D172 计算有效强调色。 */
export async function readAppearance(): Promise<Appearance> {
  const [m, s, a, abs, ml] = await Promise.all([
    settingsStore.get<"light" | "dark">("theme", "mode", "light"),
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
    mode: m === "dark" ? "dark" : "light",
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

/** 外观相关的设置键（app 域；theme 域整体相关）——WindowSkin 刷新的 scope/key 过滤规则 */
const APPEARANCE_APP_KEYS = ["skinId", "accentColor", "accentBySkin", "motionLevel"];

/** C-31：设置变更是否影响窗口外观——scope=theme 任意键，或 scope=app 且 key ∈ 外观四键。
 * （accent 写入在非默认皮肤下落 accentBySkin、默认皮肤落 accentColor，两者都在列。） */
export function isAppearanceSettingsChange(p: { scope: string; key: string }): boolean {
  if (p.scope === "theme") return true;
  return p.scope === "app" && APPEARANCE_APP_KEYS.includes(p.key);
}
