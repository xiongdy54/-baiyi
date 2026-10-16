// v48.51（D91 §6.2/§6.3）：CLP pack 注册表与回退链。
// pack 落在 electron/ste-profiles/*.json（只读资源、与 persist() 无关、零新增 IPC）——
// 渲染端经构建期静态导入持有（Vite/esbuild 都原生打包 JSON），node 测试经同一文件 fs 直读 + 打包本模块复用回退链。
// 法务红线（D91 §2.2/§8.3）：pack 全部规则文字人工撰写；"ASD-STE100" 只允许出现在 derivedFrom；
// 禁止运行时机器翻译规则文本。
import zhHansJson from "../../electron/ste-profiles/zh-Hans.json";
import enJson from "../../electron/ste-profiles/en.json";
import universalJson from "../../electron/ste-profiles/universal.json";
// v49.8（D182）：输出语言随界面语言（locale 唯一取值点）
import { getLocale } from "./i18n";

export interface SteProfile {
  lang: string;
  name: string;
  derivedFrom: string[];
  licenseNote: string;
  sentence: { maxChars?: number; maxWords?: number; maxClauses?: number; maxSentencesPerParagraph?: number; note?: string };
  voice: { preferActive?: boolean; agentUnknownNote?: string };
  lexicon?: string[];
  avoid?: Array<{ bad: string; why: string }>;
  rewriteExample?: Array<{ before: string; after: string }>;
  source?: string;
}

export const STE_PROFILES: Record<string, SteProfile> = {
  "zh-Hans": zhHansJson as SteProfile,
  en: enJson as SteProfile,
  universal: universalJson as SteProfile
};

/** P0 输出语言恒中文（=界面语言，已拍板）；v49.8（D182）起界面语言可切换，运行期取值走 steOutputLang()——
 *  常量保留为默认值（测试基线与 d91/m1/m5/m12 bundle 断言不受影响）。 */
export const STE_OUTPUT_LANG = "zh-Hans";

/** v49.8（D182）：输出语言随界面语言——zh-CN→zh-Hans / zh-TW→zh-Hant（剖面回落 zh-Hans 规则）/ en / ja */
export function steOutputLang(): string {
  try {
    const loc = getLocale();
    if (loc === "en") return "en";
    if (loc === "ja") return "ja";
    if (loc === "zh-TW") return "zh-Hant";
    return "zh-Hans";
  } catch {
    return STE_OUTPUT_LANG;
  }
}

/** 输出语言 → 人读名（模板 {{OUTPUT_LANG_NAME}} 槽位按界面语言替换用；v48.103 测试台候选，随界面语言取值） */
const STE_OUTPUT_LANG_NAMES: Record<string, string> = {
  "zh-Hans": "中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  pt: "Português",
  it: "Italiano"
};

/**
 * 界面语言（任意 BCP-47 写法）→ 输出语言人读名。回退链与 resolveProfile 同纪律：
 * 精确键 → zh-* 归并 zh-Hans → 基础语言键 → 缺省回**当前界面语言**的输出语言名（v49.8 / D182）。
 * 纯函数、可单测；'zh-TW'→繁體中文 / 'en-US'→English / 'fr'→随界面语言缺省。
 */
export function steOutputLangName(lang: string = steOutputLang()): string {
  const raw = String(lang ?? "").trim().toLowerCase();
  if (raw) {
    for (const key of Object.keys(STE_OUTPUT_LANG_NAMES)) {
      if (key.toLowerCase() === raw) return STE_OUTPUT_LANG_NAMES[key];
    }
    const base = raw.split(/[-_]/)[0];
    if (base === "zh") return raw.includes("hant") || raw.includes("tw") || raw.includes("hk") || raw.includes("mo") ? STE_OUTPUT_LANG_NAMES["zh-Hant"] : STE_OUTPUT_LANG_NAMES["zh-Hans"];
    if (STE_OUTPUT_LANG_NAMES[base]) return STE_OUTPUT_LANG_NAMES[base];
  }
  return STE_OUTPUT_LANG_NAMES[steOutputLang()] ?? "中文";
}

/**
 * 回退链（D91 §6.2）：精确 locale（zh-Hant-TW→zh-Hans）→ 基础语言（zh→zh-Hans 依赖注册表键）→ en → universal。
 * 纯函数、可单测；'zh-Hant-TW'→zh-Hans / 'fr'→en / ''→universal。
 */
export function resolveProfile(lang: string): SteProfile {
  const raw = String(lang ?? "").trim();
  if (raw) {
    const lower = raw.toLowerCase();
    // 基础语言归一：zh-* / zh_Hant 等按前缀并入基础键
    const base = lower.split(/[-_]/)[0];
    // 精确（大小写归一后与注册表键比对）
    for (const key of Object.keys(STE_PROFILES)) {
      if (key.toLowerCase() === lower) return STE_PROFILES[key];
    }
    // 简体/繁体变体都落 zh-Hans（P0 只有这一个中文 pack）
    if (base === "zh") return STE_PROFILES["zh-Hans"];
    // 其他语言先试 en（英语 pack 的规则蒸馏对印欧语言近似可用）
    if (STE_PROFILES[base]) return STE_PROFILES[base];
    return STE_PROFILES.en;
  }
  return STE_PROFILES.universal;
}

/** pack → prompt 注入块（pack 本身已按该语言人工撰写，这里只做格式化，不翻译规则文字） */
export function formatProfile(p: SteProfile): string {
  const lines: string[] = [`【${p.name}（${p.lang}）】`];
  const s = p.sentence ?? {};
  const sentenceBits = [
    s.maxChars ? `一句 ≤ ${s.maxChars} 字` : "",
    s.maxWords ? `一句 ≤ ${s.maxWords} words` : "",
    s.maxClauses ? `分句 ≤ ${s.maxClauses}` : "",
    s.maxSentencesPerParagraph ? `一段 ≤ ${s.maxSentencesPerParagraph} 句` : "",
    s.note ?? ""
  ].filter(Boolean);
  if (sentenceBits.length) lines.push(`- 句子：${sentenceBits.join("；")}`);
  if (p.voice?.preferActive !== undefined) {
    lines.push(`- 语态：${p.voice.preferActive ? "主动语态优先" : "不强制主动语态"}${p.voice.agentUnknownNote ? `；${p.voice.agentUnknownNote}` : ""}`);
  }
  for (const rule of p.lexicon ?? []) lines.push(`- 词汇：${rule}`);
  for (const a of p.avoid ?? []) lines.push(`- 避免：${a.bad}——${a.why}`);
  for (const ex of p.rewriteExample ?? []) lines.push(`- 改写示例：原「${ex.before}」→ 改「${ex.after}」`);
  return lines.join("\n");
}
