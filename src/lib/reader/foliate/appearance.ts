// 外观解析：把用户设置（settings.theme.reader）解析为内核可直接应用的具体颜色/字体。
// 主题预设与自定义色都在这里归一，adapter 只认具体值。
import type { ReaderAppearance, ReaderTheme } from "../kernel";

export interface ReaderSettings {
  mode: { flow: "scrolled" | "paged"; spread?: boolean };
  appearance: ReaderAppearance;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: { flow: "scrolled" },
  appearance: { theme: "paper" }
};

const PRESETS: Record<Exclude<ReaderTheme, "custom">, { bg: string; fg: string }> = {
  paper: { bg: "#fafaf8", fg: "#1a1a1a" },
  sepia: { bg: "#f4ecd8", fg: "#5b4636" },
  dark: { bg: "#141414", fg: "#c9c9c9" }
};

// 多语言默认字体栈：中日韩 + 拉丁全覆盖（阅读器须支持各种语言）
export const DEFAULT_READER_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", Georgia, "Times New Roman", "Songti SC", SimSun, "Yu Mincho", "Hiragino Mincho ProN", serif';

export function resolveAppearance(s: ReaderSettings | null): ReaderAppearance {
  const a = s?.appearance ?? DEFAULT_READER_SETTINGS.appearance;
  const preset = a.theme === "custom" ? null : PRESETS[a.theme];
  return {
    theme: a.theme,
    fontFamily: a.fontFamily?.trim() || DEFAULT_READER_FONT_STACK,
    fontSize: a.fontSize && a.fontSize >= 10 && a.fontSize <= 40 ? a.fontSize : 17,
    lineHeight: a.lineHeight && a.lineHeight >= 1.2 && a.lineHeight <= 2.4 ? a.lineHeight : 1.7,
    bgColor: a.theme === "custom" && a.bgColor ? a.bgColor : preset?.bg ?? PRESETS.paper.bg,
    fgColor: a.theme === "custom" && a.fgColor ? a.fgColor : preset?.fg ?? PRESETS.paper.fg,
    margin: a.margin && a.margin >= 0 && a.margin <= 120 ? a.margin : 48
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
