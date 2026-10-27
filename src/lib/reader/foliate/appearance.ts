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
  /** D241：翻页动效（存储字段）——"glide"＝滑行翻页 + 跨章淡入（默认）/ "none"＝瞬切。
   *  取代 D130 的 `turnAnimated` 存储字段：旧字段多为归一口顺手写入的 false（不代表用户意愿），
   *  故整体退役、读侧忽略；缺省一律按 "glide"。 */
  turnEffect?: TurnEffect;
  /** 翻页动效**生效值**（resolveAppearance 输出，不入存储）：turnEffect="glide" 且动效未被系统
   *  reduce-motion / 应用「动效」设置关闭时为 true → adapter 给 paginator 挂 `animated` 属性。 */
  turnAnimated?: boolean;
}

export type TurnEffect = "glide" | "none";

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

// 多语言默认字体栈：中日韩 + 拉丁全覆盖（阅读器须支持各种语言）。
// D241 排序原则：①自带优质拉丁字形的 CJK 宋体（思源/Noto Serif CJK）居首——中西文同一家族、
// 字重与 x 高度协调；②其后是拉丁书籍衬线（Iowan/Charter/Georgia），保证没有思源时西文不落进
// 系统宋体的拉丁字形；③最后才是各平台系统宋体/明朝体兜底。
export const DEFAULT_READER_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Source Han Serif", "Noto Serif SC", "Iowan Old Style", Charter, Georgia, "Times New Roman", "Songti SC", STSong, "Hiragino Mincho ProN", "Yu Mincho", SimSun, serif';
/** D241：默认正文字号（17 → 18：桌面阅读距离下 18px 衬线体更从容，720px 版心≈每行 40 个全角字） */
export const DEFAULT_READER_FONT_SIZE = 18;
/** 默认字体栈下按语言换用对应地区字形（日文用 JP 明朝、繁体用 TC/HK、韩文用 KR）——仅在用户未自定义字体时注入 */
const LANG_FONT_OVERRIDES: [string, string][] = [
  [':lang(ja)', '"Source Han Serif JP", "Noto Serif CJK JP", "Hiragino Mincho ProN", "Yu Mincho", "Iowan Old Style", Georgia, serif'],
  [':lang(zh-Hant), :lang(zh-TW), :lang(zh-HK), :lang(zh-MO)', '"Source Han Serif TC", "Noto Serif CJK TC", "Noto Serif CJK HK", "Songti TC", "Iowan Old Style", Georgia, PMingLiU, serif'],
  [':lang(ko)', '"Source Han Serif K", "Noto Serif CJK KR", "AppleMyungjo", "Iowan Old Style", Georgia, Batang, serif']
];

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

/** reduce-motion 生效判定（node 环境无 matchMedia → 恒 false，纯函数语义在单测中确定）。
 *  D241：同时尊重应用内「动效」设置——body 的 motion-off / motion-reduced 类（D170 三态，App 落类）。 */
function prefersReducedMotion(): boolean {
  try {
    if (typeof document !== "undefined" && document.body) {
      const cls = document.body.classList;
      if (cls.contains("motion-off") || cls.contains("motion-reduced")) return true;
    }
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** D241：翻页动效存储字段归一（缺省/非法 → "glide"） */
export function normalizeTurnEffect(v: unknown): TurnEffect {
  return v === "none" ? "none" : "glide";
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
  const appearance: ReaderAppearanceEx = {
    ...DEFAULT_READER_SETTINGS.appearance,
    ...(raw.appearance ?? {}),
    maxInlineSize: clampMaxInlineSize(raw.appearance?.maxInlineSize),
    turnEffect: normalizeTurnEffect(raw.appearance?.turnEffect)
  };
  // D241：旧存储字段 turnAnimated 退役（生效值只由 resolveAppearance 产出，不回写存储）
  delete appearance.turnAnimated;
  return {
    mode: { ...DEFAULT_READER_SETTINGS.mode, ...(raw.mode ?? {}) },
    appearance,
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
    fontSize: a.fontSize && a.fontSize >= 10 && a.fontSize <= 40 ? a.fontSize : DEFAULT_READER_FONT_SIZE,
    lineHeight: a.lineHeight && a.lineHeight >= 1.2 && a.lineHeight <= 2.4 ? a.lineHeight : 1.7,
    bgColor: a.theme === "custom" && a.bgColor ? a.bgColor : preset?.bg ?? PRESETS.paper.bg,
    fgColor: a.theme === "custom" && a.fgColor ? a.fgColor : preset?.fg ?? PRESETS.paper.fg,
    // D130 修正：margin 钳制改 null 判等（旧 `a.margin &&` 的 falsy 写法令 0 失效→48）——
    // 本批新增 0–120 滑杆后 0 成为可设值，按 R3「看着能调、调了没反应＝硬缺陷」必须生效；
    // margin 此前无任何 UI 写入口，存量数据不受影响（除手工 settings.json 写过 0 的极端情形）
    margin: a.margin != null && a.margin >= 0 && a.margin <= 120 ? a.margin : 48,
    zoom,
    // D130 R3：版心宽度（读侧钳制）。D241：翻页动效默认开（turnEffect 缺省 glide）；
    // reduce-motion / 应用动效关闭时强制不挂 animated——设置项仍可改、存储保留意愿
    maxInlineSize: clampMaxInlineSize(a.maxInlineSize),
    turnEffect: normalizeTurnEffect(a.turnEffect),
    turnAnimated: normalizeTurnEffect(a.turnEffect) === "glide" && !prefersReducedMotion()
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

/**
 * D241：字体栈清洗——旧实现把整串栈 JSON.stringify 成**一个**带引号的字体名
 * （`"\"Source Han Serif SC\", …"`），浏览器按单一（不存在的）字体名匹配失败，默认栈从未生效、
 * 正文一直落在系统默认字体上（中文无衬线 + 西文 Times 的混排）。改为逐项解析：已加引号的原样保留，
 * 通用族名（serif 等）保留关键字，其余逐项加引号；剔除可逃逸出声明的字符（; { } < > \）。
 */
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);
export function cssFontFamily(stack: string | undefined): string {
  const out: string[] = [];
  for (const part of String(stack ?? "").replace(/[;{}<>\\]/g, "").split(",")) {
    const name = part.trim().replace(/^(["'])(.*)\1$/, "$2").replace(/["']/g, "").trim();
    if (!name) continue;
    out.push(GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name));
  }
  return out.length ? out.join(", ") : "serif";
}

/**
 * D241：正文排版层——全部包在 :where() 里（特异度 0）：出版方 EPUB 自带的样式一律优先，
 * 只在书没有表态的地方（粘贴书 / TXT / Markdown / Word / HTML 合成书、简陋 EPUB）兜底成考究的默认值。
 * 颜色一律由 currentColor 派生（随阅读主题与自定义文字色自动成立）；圆角取宿主皮肤 Token 求值后的字面值。
 */
function proseCss(radius: string): string {
  const line = (pct: number) => `color-mix(in srgb, currentColor ${pct}%, transparent)`;
  return [
    // 渲染质量：灰度抗锯齿、字距对、常用连字、光学尺寸；中西文之间自动留白（text-autospace，Chromium 140+）
    ":where(html) { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: common-ligatures; font-optical-sizing: auto; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }",
    ":where(body) { text-autospace: normal; line-break: strict; overflow-wrap: break-word; }",
    // 段落：段间距 0.8em（≈半行，段落感清楚又不松散）；中日文两端对齐；行尾避免孤字
    ":where(p) { margin-block: 0 0.8em; }",
    ":where(p, li, dd, blockquote, figcaption) { text-wrap: pretty; }",
    ":where(p:lang(zh), p:lang(ja), p:lang(ko)) { text-align: justify; }",
    // 标题：紧行高、半粗、两行时平衡断行、不与下文分页
    ":where(h1, h2, h3, h4, h5, h6) { line-height: 1.4; font-weight: 600; letter-spacing: 0.01em; text-wrap: balance; break-after: avoid; margin-block: 1.9em 0.7em; }",
    ":where(h1) { font-size: 1.6em; line-height: 1.32; margin-block: 0.4em 1.2em; letter-spacing: 0.02em; }",
    ":where(h2) { font-size: 1.3em; }",
    ":where(h3) { font-size: 1.12em; }",
    ":where(h4, h5, h6) { font-size: 1em; }",
    ":where(h1, h2, h3, h4, h5, h6) + :where(h1, h2, h3, h4, h5, h6) { margin-block-start: 0.4em; }",
    // 引文：细竖线 + 退一级的墨色，不用斜体（中文无真斜体）
    `:where(blockquote) { margin: 1.3em 0; padding: 0.05em 0 0.05em 1.15em; border-inline-start: 2px solid ${line(16)}; color: ${line(74)}; }`,
    ":where(blockquote) :where(p:last-child) { margin-block-end: 0; }",
    // 列表
    ":where(ul, ol) { margin-block: 0 0.8em; padding-inline-start: 1.6em; }",
    ":where(li) { margin-block: 0.28em; }",
    `:where(li)::marker { color: ${line(45)}; }`,
    // 分隔线：短而轻
    `:where(hr) { border: 0; border-block-start: 1px solid ${line(16)}; width: 36%; margin: 2.4em auto; }`,
    // 链接：随正文色 + 细下划线
    `:where(a) { color: inherit; text-decoration-line: underline; text-decoration-thickness: 1px; text-decoration-color: ${line(32)}; text-underline-offset: 0.22em; }`,
    // 代码
    ":where(code, kbd, samp, pre) { font-family: \"JetBrains Mono\", \"Cascadia Code\", \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", \"Noto Sans Mono CJK SC\", monospace; font-size: 0.86em; font-variant-ligatures: none; }",
    `:where(:not(pre) > code) { padding: 0.1em 0.36em; border-radius: ${radius}; background: ${line(7)}; }`,
    `:where(pre) { margin: 1.2em 0; padding: 0.9em 1.1em; line-height: 1.6; border-radius: ${radius}; background: ${line(5)}; white-space: pre-wrap; overflow-wrap: anywhere; }`,
    ":where(pre code) { font-size: 1em; padding: 0; background: none; }",
    // 表格：横线表（无竖线），数字等宽对齐
    ":where(table) { border-collapse: collapse; margin: 1.3em 0; font-size: 0.92em; font-variant-numeric: tabular-nums; }",
    `:where(th, td) { padding: 0.5em 0.8em; border-block-end: 1px solid ${line(12)}; text-align: start; vertical-align: top; }`,
    `:where(th) { font-weight: 600; border-block-end-color: ${line(30)}; }`,
    // 图与图注
    ":where(figure) { margin: 1.6em 0; }",
    `:where(figcaption) { margin-block-start: 0.6em; font-size: 0.86em; line-height: 1.55; color: ${line(60)}; text-align: center; }`,
    // 上下标不撑开行距
    ":where(sup, sub) { line-height: 0; }"
  ].join("\n");
}

/** 宿主皮肤的小圆角 Token（--radius-xs）求值成字面值（iframe 里没有宿主 Token；默认瑞士皮肤＝0） */
function hostRadius(): string {
  try {
    if (typeof document === "undefined" || !document.body) return "0";
    const v = getComputedStyle(document.body).getPropertyValue("--radius-xs").trim();
    return /^[\d.]+(px|rem|em)?$/.test(v) ? v : "0";
  } catch {
    return "0";
  }
}

/** 向章节 iframe 文档注入外观样式（每次 section 加载与外观变更时调用；flow 用于按模式微调媒体规则） */
export function injectAppearanceStyle(doc: Document, a: ReaderAppearance, flow?: "scrolled" | "paged") {
  void flow;
  const id = "kernel-appearance";
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = id;
    doc.head.appendChild(style);
  }
  const family = cssFontFamily(a.fontFamily);
  const isDefaultStack = family === cssFontFamily(DEFAULT_READER_FONT_STACK);
  style.textContent = [
    proseCss(hostRadius()),
    `html { font-family: ${family} !important; font-size: ${a.fontSize}px !important; }`,
    // 默认栈下按语言换地区字形（用户自定义了字体则尊重用户，不覆盖）
    ...(isDefaultStack ? LANG_FONT_OVERRIDES.map(([sel, stack]) => `${sel.split(", ").map((lang) => `html${lang}`).join(", ")} { font-family: ${stack} !important; }`) : []),
    `body { background: ${a.bgColor} !important; color: ${a.fgColor} !important; line-height: ${a.lineHeight} !important; }`,
    // ruby 注音随正文颜色（CJK 排版观察项，L1 日文夹具覆盖）
    "rt { color: inherit; }"
  ].join("\n");
}
