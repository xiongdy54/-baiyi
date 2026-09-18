// M7 查词客户端（v32，D31）——渲染层唯一查词入口：Manager + Provider 接线 + 设置读取。
// Provider 数据源：在线经主进程 dict:lookupOnline（net.fetch 代理）；本地经 dict:lookupLocal（SQLite 索引）。
import {
  DictionaryManager,
  InMemoryDictCache,
  VOCAB_KINDS,
  extractSentence,
  guessLanguage,
  normalizeWord,
  pickLocalHit,
  wordCandidates,
  type DictLookupResult,
  type DictSourceMode,
  type DictionaryEntry,
  type DictionaryProvider,
  type LocalHit,
  type ReadingContext,
  type VocabKind,
} from "./dict";
import { settingsStore } from "./settings";

declare global {
  interface Window {
    dictAPI?: {
      lookupOnline: (providerId: string, word: string) => Promise<DictionaryEntry | null>;
      lookupLocal: (word: string) => Promise<LocalHit[]>;
      sources: () => Promise<unknown[]>;
      toggleSource: (id: string, enabled: boolean) => Promise<boolean>;
      removeSource: (id: string) => Promise<boolean>;
      cacheGet: (providerId: string, language: string, word: string) => Promise<{ entry: DictionaryEntry; fetchedAt: number } | null>;
      cacheSet: (providerId: string, language: string, word: string, entry: DictionaryEntry) => Promise<boolean>;
      pickFile: () => Promise<{ name: string; path: string } | null>;
      importFile: (filePath: string) => Promise<{ id: string; name: string; format: string; count: number } | null>;
      download: (item: { id: string; url: string; mirrorUrl?: string; format: string; name: string }) => Promise<{ id: string; count: number; file: string; parsed: boolean }>;
      onDownloadProgress: (cb: (msg: { id: string; progress: number; state: string; count?: number }) => void) => () => void;
    };
  }
}

// v32 修复：Jisho 非官方 API 已下线（对任何词返回 404 页），在线日语查词移除——
// 日语由 JMDict 本地包（设置一键下载）承担。在线仅保留 Free Dictionary API（EN，需可直连或系统代理）。
export const ONLINE_PROVIDERS: { id: string; name: string; languages: string[] }[] = [
  { id: "free-dictionary-api", name: "Free Dictionary API", languages: ["en"] },
];

const sharedCache = new InMemoryDictCache();
// Free API 缓存 24h；本地词条库 30 天；署名经 UI 来源徽标满足（attributionRequired）
const PROVIDER_META: Record<string, { cacheTTLms: number; license: string; attributionRequired: boolean }> = {
  "free-dictionary-api": { cacheTTLms: 24 * 3600 * 1000, license: "CC-BY-SA（Wiktionary 数据）", attributionRequired: true },
  local: { cacheTTLms: 30 * 24 * 3600 * 1000, license: "以各本地词典版权为准", attributionRequired: true },
};

function onlineProvider(id: string, languages: string[]): DictionaryProvider {
  const meta = PROVIDER_META[id] ?? PROVIDER_META["free-dictionary-api"];
  const caps = ["definition", "pronunciation", "audio", "partOfSpeech", "examples"] as DictionaryProvider["capabilities"];
  return {
    id,
    kind: "online",
    languages,
    capabilities: caps,
    supportsCaching: true,
    cacheTTLms: meta.cacheTTLms,
    license: meta.license,
    attributionRequired: meta.attributionRequired,
    lookup: async (rawText, ctx) => {
      const cands = wordCandidates(rawText);
      for (const cand of cands) {
        const cached = await window.dictAPI?.cacheGet(id, ctx?.languageHint || guessLanguage(cand), cand);
        if (cached && Date.now() - cached.fetchedAt < meta.cacheTTLms) {
          return { ...cached.entry, normalizedWord: cand };
        }
        const hit = await window.dictAPI?.lookupOnline(id, cand);
        if (hit) {
          const full = { ...hit, normalizedWord: cand };
          void window.dictAPI?.cacheSet(id, full.language || guessLanguage(cand), cand, full).catch(() => {});
          return full;
        }
      }
      return null;
    },
  };
}

function localProvider(): DictionaryProvider {
  return {
    id: "local",
    kind: "local",
    languages: ["en", "ja", "zh"],
    capabilities: ["definition", "pronunciation"],
    supportsCaching: true,
    cacheTTLms: PROVIDER_META.local.cacheTTLms,
    license: PROVIDER_META.local.license,
    attributionRequired: true,
    lookup: async (rawText, ctx) => {
      const cands = wordCandidates(rawText);
      for (const cand of cands) {
        const hits = (await window.dictAPI?.lookupLocal(cand)) ?? [];
        // v38（D35）：多来源命中同一词头按来源语言优先（精确匹配 > 未知语言 > 原序），
        // 日语「山」不再被先入库的 CC-CEDICT 抢走命中
        const h = pickLocalHit(hits, ctx?.languageHint || guessLanguage(cand, ctx?.sentence));
        if (h) return { ...h, normalizedWord: cand };
      }
      return null;
    },
  };
}

export interface DictSettings {
  mode: DictSourceMode;
  popupFields: Record<string, boolean>;
}

export const DEFAULT_POPUP_FIELDS: Record<string, boolean> = {
  spelling: true,
  pronunciation: true,
  audio: true,
  definition: true,
  partOfSpeech: false,
  examples: false,
  synonyms: false,
  antonyms: false,
  etymology: false,
};

export async function loadDictSettings(): Promise<DictSettings> {
  const mode = await settingsStore.get<DictSourceMode>("app", "dictMode", "auto");
  const popupFields = await settingsStore.get<Record<string, boolean>>("app", "dictPopupFields", DEFAULT_POPUP_FIELDS);
  return {
    mode: mode === "local" || mode === "online" ? mode : "auto",
    popupFields: { ...DEFAULT_POPUP_FIELDS, ...(popupFields || {}) },
  };
}

// ---------- 单词卡四形式勾选（v32：按语言记忆，照抄 materialTypes 的读全 map→改→回写范式） ----------
const VOCAB_KINDS_MAP_KEY = "dictVocabKinds";

/** 读某语言上次勾选的卡片形式；从未用过/存了非法值 → 全 4 种（有效值按全集顺序去重） */
export async function loadVocabKinds(lang: string): Promise<VocabKind[]> {
  const map = await settingsStore.get<Record<string, VocabKind[]>>("app", VOCAB_KINDS_MAP_KEY, {});
  const saved = (map[lang] ?? []).filter((k) => VOCAB_KINDS.includes(k));
  if (saved.length === 0) return [...VOCAB_KINDS];
  return VOCAB_KINDS.filter((k) => saved.includes(k));
}

export async function saveVocabKinds(lang: string, kinds: VocabKind[]): Promise<void> {
  const valid = kinds.filter((k) => VOCAB_KINDS.includes(k));
  if (valid.length === 0) return; // 全不勾不落盘（UI 已禁止，防御）
  const map = await settingsStore.get<Record<string, VocabKind[]>>("app", VOCAB_KINDS_MAP_KEY, {});
  await settingsStore.set("app", VOCAB_KINDS_MAP_KEY, { ...map, [lang]: valid });
}

export function buildManager(mode: DictSourceMode): DictionaryManager {
  const providers: DictionaryProvider[] = [
    onlineProvider("free-dictionary-api", ["en"]),
    localProvider(),
  ];
  return new DictionaryManager({ mode, providers, cache: sharedCache, timeoutMs: 12000 });
}

export interface LookupWordOptions {
  /** 查词面板手动切换的语言（"auto"=未手动选择）；D35 优先级链最高位 */
  languageHint?: string;
  /** 书籍语言属性（library_items.lang）；D35 优先级链第四位 */
  bookLanguage?: string;
  /** 选区所在句；D35 优先级链第三位（句含假名→ja） */
  sentence?: string;
}

export async function lookupWord(rawText: string, opts: LookupWordOptions = {}): Promise<DictLookupResult & { mode: DictSourceMode }> {
  const { mode } = await loadDictSettings();
  const manager = buildManager(mode);
  const result = await manager.lookup(rawText, {
    languageHint: opts.languageHint,
    bookLanguage: opts.bookLanguage,
    sentence: opts.sentence,
  });
  return { ...result, mode };
}

export function buildReadingContext(opts: {
  selectedText: string;
  contextText?: string;
  documentId?: string | null;
  chapterId?: string | number | null;
  cfi?: string | null;
  pageIndex?: number | null;
  anchorText?: string | null;
}): ReadingContext {
  const normalized = normalizeWord(opts.selectedText);
  const sentence = extractSentence(opts.contextText || "", opts.selectedText);
  return {
    documentId: opts.documentId ?? null,
    chapterId: opts.chapterId ?? null,
    cfi: opts.cfi ?? null,
    pageIndex: opts.pageIndex ?? null,
    anchorText: opts.anchorText ?? null,
    selectedText: opts.selectedText,
    normalizedWord: normalized,
    sentence,
  };
}

/** 系统 TTS 朗读（AudioProvider 预留槽位的临时承载：接口形状对齐未来 AudioProvider，不写死播放器） */
export function speakText(text: string, lang?: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    else if (/[\u3040-\u30ff]/.test(text)) u.lang = "ja-JP";
    else if (/[\u4e00-\u9fa5]/.test(text)) u.lang = "zh-CN";
    else u.lang = "en-US";
    synth.speak(u);
  } catch { /* 无 TTS 能力时静默 */ }
}

/** 词典语言码 → TTS BCP-47 标签 */
export function ttsLangTag(lang: string): string {
  const map: Record<string, string> = {
    en: "en-US", ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", fr: "fr-FR",
    de: "de-DE", es: "es-ES", ru: "ru-RU", la: "it-IT",
  };
  return map[(lang || "").toLowerCase()] ?? "en-US";
}

/** 复习卡单词发音（v32 用户定稿：默认系统 TTS，设置 audioSource="online" 时优先在线真人音频、缺失回落 TTS） */
export async function playVocabAudio(d: { word?: string; audio?: string | null; language?: string | null }): Promise<void> {
  const mode = await settingsStore.get<"tts" | "online">("app", "dictAudioSource", "tts");
  if (mode === "online" && d.audio) {
    playAudioUrl(d.audio);
    return;
  }
  speakText(d.word ?? "", ttsLangTag(d.language ?? ""));
}

export function playAudioUrl(url: string): void {
  try {
    const a = new Audio(url);
    void a.play().catch(() => {});
  } catch { /* 忽略 */ }
}
