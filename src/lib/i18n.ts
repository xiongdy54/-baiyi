// v49.8（D182）：多语言 i18n 核心——轻量自研，零 i18n 框架依赖。
// 契约（GUIDE §7.4 / D182）：
//  - **自然键制**：t() 以 zh-CN 原文为键，en/ja 词典手写（src/i18n/locales/），zh-TW = 运行时
//    opencc-js（cn→twp）+ 领域词覆盖表（zhTwOverrides）；缺译回落 zh-CN 原文。
//  - 插值 `{name}`；复数：词典值可为 { one, other }，按参数 n 取档（无 n 用 other）。
//  - `useT()`（useSyncExternalStore）＝React 消费口：语言切换时所有消费组件重渲染；
//    非渲染路径（渲染期被调用的字符串辅助模块）可直接用 t()。
//  - `app.language` 设置键（enum 四值，默认 zh-CN）；双侧归一：本文件 normalizeLocale 为渲染层读侧，
//    主进程写侧 normalizeLanguage（electron/main.js）同规。
//  - zh-CN 下 t() 恒等返回原文 ⇒ 存量 GUI 套件零回归（D182 ⑥）。
import { useSyncExternalStore } from "react";
import { settingsStore } from "./settings";
import { zhTwOverrides } from "../i18n/zhTwOverrides";

export type Locale = "zh-CN" | "zh-TW" | "en" | "ja";

export const DEFAULT_LOCALE: Locale = "zh-CN";

/** 语言切换器元数据（name 一律用该语言的自称，不做翻译——切换器惯例） */
export const LANGUAGES: ReadonlyArray<{ id: Locale; name: string; htmlLang: string }> = [
  { id: "zh-CN", name: "简体中文", htmlLang: "zh-Hans-CN" },
  { id: "zh-TW", name: "繁體中文", htmlLang: "zh-Hant-TW" },
  { id: "en", name: "English", htmlLang: "en" },
  { id: "ja", name: "日本語", htmlLang: "ja" }
];

const LOCALE_SET: ReadonlySet<string> = new Set(LANGUAGES.map((l) => l.id));

/** 非法值一律回落 zh-CN（与主进程写侧 normalizeLanguage 同规；F18 矩阵依据） */
export function normalizeLocale(v: unknown): Locale {
  return typeof v === "string" && LOCALE_SET.has(v) ? (v as Locale) : DEFAULT_LOCALE;
}

export function htmlLangOf(locale: Locale): string {
  return LANGUAGES.find((l) => l.id === locale)?.htmlLang ?? "zh-Hans-CN";
}

// ---------- 词典装载（en / ja 手写；zh-CN 恒等；zh-TW 运行时转换） ----------

import { en } from "../i18n/locales/en";
import { ja } from "../i18n/locales/ja";

/** 词典值：字符串；或复数对象（按参数 n 取 one/other，无 n 用 other） */
export type DictValue = string | { one: string; other: string };
type Dict = Record<string, DictValue>;

const DICTS: Record<"en" | "ja", Dict> = { en, ja };

// ---------- zh-TW：领域词覆盖 → opencc cn→twp（转换器惰性创建 + 结果缓存） ----------

type OpenCCModule = {
  Converter(options: { from: string; to: string }): (s: string) => string;
};

let openccConvert: ((s: string) => string) | null = null;
let openccFailed = false;
const zhTwCache = new Map<string, string>();

// opencc-js 是纯 ESM/CJS 双出口包；渲染层走 Vite 静态打包、esbuild 测试打包都能解析。
// import 顶层执行，Converter 惰性创建（数据装载 ~50ms 级）；简→繁失败静默回落原文。
import * as OpenCC from "opencc-js";

function getTwConverter(): ((s: string) => string) | null {
  if (!openccConvert && !openccFailed) {
    try {
      openccConvert = (OpenCC as unknown as OpenCCModule).Converter({ from: "cn", to: "twp" });
    } catch {
      openccFailed = true;
    }
  }
  return openccFailed ? null : openccConvert;
}

/** 领域词覆盖（简化字级，最长优先；只作用于 t() 的键，不碰用户数据） */
const OVERRIDE_KEYS = Object.keys(zhTwOverrides).sort((a, b) => b.length - a.length);

function toZhTw(s: string): string {
  const cached = zhTwCache.get(s);
  if (cached !== undefined) return cached;
  let out = s;
  for (const k of OVERRIDE_KEYS) {
    if (out.includes(k)) out = out.split(k).join(zhTwOverrides[k]);
  }
  const conv = getTwConverter();
  if (conv) {
    try {
      out = conv(out);
    } catch {
      /* 转换失败回落覆盖后文本 */
    }
  }
  zhTwCache.set(s, out);
  return out;
}

// ---------- 语言状态：模块级单例 + 订阅（useSyncExternalStore 消费） ----------

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

// localStorage 缓存：次窗口（制卡台）与重启首绘前先取缓存locale，避免慢设置 IPC 造成 zh-CN 闪烁；
// 权威值仍以 settings.json 的 app.language 为准（启动时 initLocale 覆写）。
const LS_CACHE_KEY = "ir.locale";

function readLocaleCache(): Locale | null {
  try {
    const v = window.localStorage.getItem(LS_CACHE_KEY);
    return v && LOCALE_SET.has(v) ? (v as Locale) : null;
  } catch {
    return null;
  }
}

function writeLocaleCache(v: Locale) {
  try {
    window.localStorage.setItem(LS_CACHE_KEY, v);
  } catch {
    /* 隐私模式等场景缓存失败无害 */
  }
}

// 模块装载即应用缓存（非 DOM 环境静默跳过）
{
  const cached = typeof window !== "undefined" ? readLocaleCache() : null;
  if (cached) currentLocale = cached;
}

function notify() {
  for (const fn of listeners) fn();
}

function applyDocumentLang() {
  try {
    document.documentElement.lang = htmlLangOf(currentLocale);
  } catch {
    /* 非 DOM 环境（node 测试）忽略 */
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

/** 启动时装载（App / 制卡台窗口首绘前调用；不落盘、不发通知；同步写 localStorage 缓存） */
export function initLocale(v: unknown): Locale {
  currentLocale = normalizeLocale(v);
  writeLocaleCache(currentLocale);
  applyDocumentLang();
  return currentLocale;
}

/** 切换语言：落盘（app.language）→ 更新状态 → 通知订阅者 → html lang 跟随 */
export async function setLocale(v: Locale): Promise<void> {
  const next = normalizeLocale(v);
  if (next === currentLocale) return;
  currentLocale = next;
  writeLocaleCache(next);
  applyDocumentLang();
  notify();
  try {
    await settingsStore.set("app", "language", next);
  } catch {
    /* 落盘失败不阻断本次会话的语言切换 */
  }
}

export function subscribeI18n(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- 翻译 ----------

export type TParams = Record<string, string | number | undefined>;
export type TFn = (key: string, params?: TParams) => string;

function interpolate(template: string, params: TParams | undefined): string {
  if (!params || !template.includes("{")) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

function lookupDict(locale: Locale, key: string, params: TParams | undefined): string {
  const dict = DICTS[locale as "en" | "ja"];
  const v = dict ? dict[key] : undefined;
  if (v === undefined) return key; // 缺译回落原文（zh-CN 键）
  if (typeof v === "string") return v;
  // 复数：n === 1 → one，否则 other（缺 n 用 other）
  return params && params.n === 1 ? v.one : v.other;
}

/** 翻译主入口：zh-CN 恒等返回键（经插值）；其余查词典、zh-TW 走转换 */
export function t(key: string, params?: TParams): string {
  let s: string;
  if (currentLocale === "zh-CN") s = key;
  else if (currentLocale === "zh-TW") s = toZhTw(key);
  else s = lookupDict(currentLocale, key, params);
  return interpolate(s, params);
}

/** React 消费口：订阅语言变化，切换时触发本组件重渲染（渲染路径一律用它） */
export function useT(): TFn {
  useSyncExternalStore(subscribeI18n, getLocale, getLocale);
  return t;
}

// ---------- 深转换包装（集中字符串模块的 zh-TW 形态：learnerStrings 等结构化对象） ----------

type DeepStringify<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => DeepStringify<R>
    : { [K in keyof T]: DeepStringify<T[K]> };

/** 把 zh 形态的字符串/函数树整体包装成 zh-TW 形态（结果惰性缓存） */
export function twDeep<T>(obj: T): DeepStringify<T> {
  const cache = new Map<unknown, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return toZhTw(v);
    if (typeof v === "function") {
      if (cache.has(v)) return cache.get(v);
      const wrapped = (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        return typeof r === "string" ? toZhTw(r) : r;
      };
      cache.set(v, wrapped);
      return wrapped;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) out[k] = walk((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return walk(obj) as DeepStringify<T>;
}
