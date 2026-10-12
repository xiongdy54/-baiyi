// 外观解析：把用户设置（settings.theme.reader）解析为内核可直接应用的具体颜色/字体。
// 主题预设与自定义色都在这里归一，adapter 只认具体值。
import type { ReaderAppearance, ReaderTheme } from "../kernel";

/**
 * D130 R3：个性化扩展外观字段——宿主设置面（readerSettings.appearance）与 resolveAppearance
 * 输出共有。内核接口 ReaderAppearance（kernel.ts）保持不动，业务层经本类型读取扩展字段；
 * adapter 在外观写入面（applyRendererSettings）收窄消费（v48.24 起 adapter 内 cast 同一先例）。
 */
export interface ReaderAppearanceEx extends ReaderAppearance {
  /** 版心宽度 px（480–1200，默认 720＝vendor 默认＝存量零变化）：滚动模式的排版余白＝
   *  「页边距」在滚动模式的对应物（新增解释，设计稿 §4.3b）；分页列宽的上限。 */
  maxInlineSize?: number;
  /** 翻页滑动过渡（vendor paginator `animated` 布尔属性，默认关）；reduce-motion 下
   *  resolveAppearance 强制 false——存储保留意愿，生效面永不挂属性（设计稿 §4.4a）。 */
  turnAnimated?: boolean;
}

/** D130 R3：命名自定义主题（速记本语义：应用＝写 custom 档色值，**不回写**条目本身，避免别名漂移） */
export interface CustomThemeEntry {
  id: string;
  name: string;
  bgColor: string;
  fgColor: string;
  createdAt: number;
}

export interface ReaderSettings {
  mode: { flow: "scrolled" | "paged"; spread?: boolean };
  appearance: ReaderAppearanceEx;
  /** D130 R3：已保存的命名主题（≤12 套；读侧归一＝唯一安全边界，主进程写侧不做结构校验） */
  customThemes?: CustomThemeEntry[];
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: { flow: "scrolled" },
  appearance: { theme: "paper" },
  customThemes: []
};

const PRESETS: Record<Exclude<ReaderTheme, "custom">, { bg: string; fg: string }> = {
  paper: { bg: "#fafaf8", fg: "#1a1a1a" },
  sepia: { bg: "#f4ecd8", fg: "#5b4636" },
  dark: { bg: "#141414", fg: "#c9c9c9" }
};

// 多语言默认字体栈：中日韩 + 拉丁全覆盖（阅读器须支持各种语言）
export const DEFAULT_READER_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", Georgia, "Times New Roman", "Songti SC", SimSun, "Yu Mincho", "Hiragino Mincho ProN", serif';

// ---------- D130 R3：新增字段归一（写侧宽松、读侧钳制封闭非法值域，同 growthFeedback 双侧归一先例） ----------

export const CUSTOM_THEMES_MAX = 12;
export const MAX_INLINE_SIZE_MIN = 480;
export const MAX_INLINE_SIZE_MAX = 1200;
export const DEFAULT_MAX_INLINE_SIZE = 720;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** maxInlineSize：非数值或越界（<480 / >1200）→ 720；边界 480/1200 保留。 */
export function clampMaxInlineSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= MAX_INLINE_SIZE_MIN && v <= MAX_INLINE_SIZE_MAX
    ? v
    : DEFAULT_MAX_INLINE_SIZE;
}

/**
 * customThemes：非数组 → []；逐条清洗（id 非空串、name 非空串且截 24 字符、bgColor/fgColor 为
 * #rrggbb、createdAt 有限数值；非法条目丢弃）；id 重复保留首条；超 12 条**保新弃旧**
 * （按 createdAt 降序取前 12）。
 */
export function normalizeCustomThemes(v: unknown): CustomThemeEntry[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: CustomThemeEntry[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === "string" ? t.id.trim() : "";
    if (!id || seen.has(id)) continue;
    if (typeof t.name !== "string") continue;
    const name = t.name.trim().slice(0, 24);
    if (!name) continue;
    if (typeof t.bgColor !== "string" || !HEX6.test(t.bgColor)) continue;
    if (typeof t.fgColor !== "string" || !HEX6.test(t.fgColor)) continue;
    if (typeof t.createdAt !== "number" || !Number.isFinite(t.createdAt)) continue;
    seen.add(id);
    out.push({ id, name, bgColor: t.bgColor, fgColor: t.fgColor, createdAt: t.createdAt });
  }
  if (out.length <= CUSTOM_THEMES_MAX) return out;
  return out.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, CUSTOM_THEMES_MAX);
}

/** reduce-motion 生效判定（node 环境无 matchMedia → 恒 false，纯函数语义在单测中确定）。 */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * D130 R3：readerSettings 读侧统一归一口——合并既有「DEFAULT 兜底 + 逐字段展开」与新增字段钳制。
 * Reader.tsx 与 SettingsPanel.tsx 两处读侧同用（与 annotationSettings 读侧同一份归一的项目先例一致）。
 * 存量 settings（无新字段）解析结果与 D130 之前的展开逻辑逐字段相等（tests/reader.appearance.test.cjs 守护）。
 */
export function normalizeReaderSettings(s: unknown): ReaderSettings {
  const raw = (s && typeof s === "object" ? s : {}) as {
    mode?: Partial<ReaderSettings["mode"]>;
    appearance?: Partial<ReaderAppearanceEx>;
    customThemes?: unknown;
  };
  return {
    mode: { ...DEFAULT_READER_SETTINGS.mode, ...(raw.mode ?? {}) },
    appearance: {
      ...DEFAULT_READER_SETTINGS.appearance,
      ...(raw.appearance ?? {}),
      maxInlineSize: clampMaxInlineSize(raw.appearance?.maxInlineSize),
      turnAnimated: raw.appearance?.turnAnimated === true
    },
    customThemes: normalizeCustomThemes(raw.customThemes)
  };
}

export function resolveAppearance(s: ReaderSettings | null): ReaderAppearanceEx {
  const a = s?.appearance ?? DEFAULT_READER_SETTINGS.appearance;
  const preset = a.theme === "custom" ? null : PRESETS[a.theme];
  // v29 PDF 缩放：预设字符串或 50-300 百分比，非法值回退适应宽度
  const zoom = a.zoom === "page-width" || a.zoom === "page-fit" ? a.zoom
    : typeof a.zoom === "number" && a.zoom >= 50 && a.zoom <= 300 ? a.zoom
    : "page-width";
  return {
    theme: a.theme,
    fontFamily: a.fontFamily?.trim() || DEFAULT_READER_FONT_STACK,
    fontSize: a.fontSize && a.fontSize >= 10 && a.fontSize <= 40 ? a.fontSize : 17,
    lineHeight: a.lineHeight && a.lineHeight >= 1.2 && a.lineHeight <= 2.4 ? a.lineHeight : 1.7,
    bgColor: a.theme === "custom" && a.bgColor ? a.bgColor : preset?.bg ?? PRESETS.paper.bg,
    fgColor: a.theme === "custom" && a.fgColor ? a.fgColor : preset?.fg ?? PRESETS.paper.fg,
    // D130 修正：margin 钳制改 null 判等（旧 `a.margin &&` 的 falsy 写法令 0 失效→48）——
    // 本批新增 0–120 滑杆后 0 成为可设值，按 R3「看着能调、调了没反应＝硬缺陷」必须生效；
    // margin 此前无任何 UI 写入口，存量数据不受影响（除手工 settings.json 写过 0 的极端情形）
    margin: a.margin != null && a.margin >= 0 && a.margin <= 120 ? a.margin : 48,
    zoom,
    // D130 R3：版心宽度与翻页过渡（读侧钳制；reduce-motion 强制不挂 animated——设置项仍可改、存储保留意愿）
    maxInlineSize: clampMaxInlineSize(a.maxInlineSize),
    turnAnimated: a.turnAnimated === true && !prefersReducedMotion()
  };
}

/** 封面压扁修复：为滚动模式下的 svg[viewBox] 显式设定 aspect-ratio（Chromium 对百分比宽 svg 的
 *  height:auto 不能稳定从 viewBox 推导固有比，需 JS 逐个写入）。 */
export function fixSvgAspect(doc: Document) {
  for (const svg of Array.from(doc.querySelectorAll("svg"))) {
    const vb = svg.getAttribute("viewBox") || svg.getAttribute("viewbox");
    if (!vb) continue;
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      svg.style.aspectRatio = `${parts[2]} / ${parts[3]}`;
      svg.style.height = "auto";
    }
  }
}

/** 向章节 iframe 文档注入外观样式（每次 section 加载与外观变更时调用；flow 用于按模式微调媒体规则） */
export function injectAppearanceStyle(doc: Document, a: ReaderAppearance, flow?: "scrolled" | "paged") {
  const id = "kernel-appearance";
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = id;
    doc.head.appendChild(style);
  }
  style.textContent = [
    `html { font-family: ${JSON.stringify(a.fontFamily ?? "")} !important; font-size: ${a.fontSize}px !important; }`,
    `body { background: ${a.bgColor} !important; color: ${a.fgColor} !important; line-height: ${a.lineHeight} !important; }`,
    // ruby 注音随正文颜色（CJK 排版观察项，L1 日文夹具覆盖）
    "rt { color: inherit; }"
  ].join("\n");
}
