// M7 词典 Provider 架构（v32，D31）——纯函数层，可被 esbuild 打包进 tests/m7.*.bundle.cjs
// 职责：DictionaryProvider 接口类型 + WordNormalizer + DictionaryManager（模式/优先级/超时/缓存/fallback）
//      + DictionaryEntry/ReadingContext 类型 + 四种单词卡快照组装（buildVocabDrafts）。
// 在线 HTTP 与本地文件 IO 在主进程 electron/dictStore.js 实现；本模块只保留可单元测试的纯逻辑，
// Manager 通过注入的 provider 对象工作（lookup(rawText, ctx)），因此 node 单测无需网络。

export type DictCapability =
  | "definition"
  | "pronunciation"
  | "audio"
  | "partOfSpeech"
  | "examples"
  | "synonyms"
  | "antonyms"
  | "etymology";

export type DictSourceMode = "local" | "online" | "auto";

export interface DictionaryEntry {
  word: string;
  reading?: string | null;
  pronunciation?: string | null;
  audio?: string | null;
  definitions: string[];
  partOfSpeech?: string[];
  examples?: string[];
  synonyms?: string[];
  antonyms?: string[];
  etymology?: string | null;
  source: string;
  language: string;
  normalizedWord: string;
  capabilities: DictCapability[];
}

export interface ReadingContext {
  documentId?: string | null;
  chapterId?: string | number | null;
  cfi?: string | null;
  pageIndex?: number | null;
  anchorText?: string | null;
  selectedText: string;
  normalizedWord: string;
  sentence: string;
}

export interface DictLookupContext {
  title?: string;
  languageHint?: string;
  /** 选区所在句（Reader 侧 extractSentence 产物）——语言路由的句级信号 */
  sentence?: string;
  /** 书籍语言属性（library_items.lang）——语言路由的书籍级信号 */
  bookLanguage?: string;
}

export interface DictionaryProvider {
  id: string;
  kind: "local" | "online" | "user";
  languages: string[];
  capabilities: DictCapability[];
  supportsCaching: boolean;
  cacheTTLms: number;
  license: string;
  attributionRequired: boolean;
  attributionText?: string;
  lookup: (rawText: string, ctx?: DictLookupContext) => Promise<DictionaryEntry | null>;
}

export interface DictCache {
  get: (providerId: string, language: string, normalizedWord: string) => { entry: DictionaryEntry; fetchedAt: number } | null;
  set: (providerId: string, language: string, normalizedWord: string, entry: DictionaryEntry) => void;
}

export class InMemoryDictCache implements DictCache {
  private map = new Map<string, { entry: DictionaryEntry; fetchedAt: number }>();
  get(providerId: string, language: string, normalizedWord: string) {
    const v = this.map.get(`${providerId}\u0000${language}\u0000${normalizedWord}`);
    return v ?? null;
  }
  set(providerId: string, language: string, normalizedWord: string, entry: DictionaryEntry) {
    this.map.set(`${providerId}\u0000${language}\u0000${normalizedWord}`, { entry, fetchedAt: Date.now() });
  }
}

/** 规范化：NFKC + 去首尾空白与包围标点；ASCII 部分小写（专有名词回退由候选队列覆盖） */
export function normalizeWord(raw: string): string {
  let t = String(raw ?? "").normalize("NFKC").trim();
  t = t.replace(/^[\s"'“”‘’«»‹›〈〉《》\(\[\{【]+/u, "").replace(/[\s"'“”‘’«»‹›〈〉《》\)\]\}】.,;:!?，。；：！？、]+$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  if (/^[\x00-\x7F]*$/.test(t)) t = t.toLowerCase();
  return t;
}

const EN_SUFFIX_RULES: [RegExp, (w: string) => string[]][] = [
  [/^(.*[^s])s$/, (w) => [w.slice(0, -1)]], // cats → cat（复数；running 误伤由 includes 兜底，见下）
  [/^(.*)ies$/, (w) => [`${w.slice(0, -3)}y`]], // studies → study
  [/^(.*[^aeiou])ed$/, (w) => [w.slice(0, -1), w.slice(0, -2)]], // walked → walk/walke
  [/^(.*[^aeiou])ing$/, (w) => [w.slice(0, -3), `${w.slice(0, -3)}e`]], // running → runn/rune
];

// 英文词形轻量还原：原形优先 + 常见双写/去 e 变体；保持确定性（同一输入同一队列）
export function englishStems(word: string): string[] {
  const out: string[] = [];
  const w = word.toLowerCase();
  if (/(.)\1ing$/.test(w)) {
    // running → run（双写辅音还原）
    out.push(w.replace(/(.)\1ing$/, "$1"));
  }
  for (const [re, fn] of EN_SUFFIX_RULES) {
    const m = w.match(re);
    if (m) for (const c of fn(w)) if (c && c !== w && !out.includes(c)) out.push(c);
  }
  if (w.endsWith("ing") && w.length > 5) {
    const stem = w.slice(0, -3);
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

// 日语活用微表（P2 接 MeCab/Kuromoji 前的轻量版）：ます/た/て 系 → 辞書形候选
const JA_TA_MAP: [RegExp, string][] = [
  [/した$/, "する"], [/きた$/, "くる"], [/した$/, "す"],
  [/った$/, "う"], [/った$/, "つ"], [/った$/, "る"],
  [/んだ$/, "ぬ"], [/んだ$/, "ぶ"], [/んだ$/, "む"],
  [/いた$/, "く"], [/いだ$/, "ぐ"],
  [/た$/, "る"], [/だ$/, "ぐ"],
];
const JA_MASU_MAP: [RegExp, string][] = [
  [/しました$/, "する"], [/きました$/, "くる"],
  [/ました$/, "る"], [/います$/, "いる"], [/きます$/, "く"],
  [/ぎます$/, "ぐ"], [/します$/, "す"], [/ちます$/, "つ"],
  [/にます$/, "ぬ"], [/びます$/, "ぶ"], [/みます$/, "む"], [/ります$/, "る"],
];
const JA_TE_MAP: [RegExp, string][] = [
  [/して$/, "する"], [/きて$/, "くる"],
  [/って$/, "う"], [/って$/, "つ"], [/って$/, "る"],
  [/んで$/, "ぬ"], [/んで$/, "ぶ"], [/んで$/, "む"],
  [/いて$/, "く"], [/いで$/, "ぐ"],
];

export function japaneseStems(word: string): string[] {
  const out: string[] = [];
  for (const table of [JA_MASU_MAP, JA_TA_MAP, JA_TE_MAP]) {
    for (const [re, dictEnd] of table) {
      if (!re.test(word)) continue;
      const stem = word.replace(re, "");
      if (!stem) continue;
      // 一段动词：食べまし+た → 食べる
      const ichidan = `${stem}る`;
      if (!out.includes(ichidan)) out.push(ichidan);
      // 五段/サ変：話し+た → 話す（用映射尾还原）
      const godan = `${stem}${dictEnd}`;
      if (godan !== ichidan && !out.includes(godan)) out.push(godan);
    }
  }
  // 見逃した → 見逃す 等「し→す」在上表已覆盖；ない形：食べない → 食べる
  const nai = word.match(/^(.*)ない$/);
  if (nai && nai[1]) {
    const c = `${nai[1]}る`;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** 候选查询队列：规范形 → 英语词干 → 日语词干（去重保序，确定性）。
 *  纯大小写差异的原串不入队（moral/Moral 同词，重复查询只会让超时/错误翻倍——v32 修复）。 */
export function wordCandidates(raw: string): string[] {
  const base = normalizeWord(raw);
  if (!base) return [];
  const out = [base];
  const push = (c: string) => {
    const t = c.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const s of englishStems(base)) push(s);
  for (const s of japaneseStems(base)) push(s);
  // 保留非大小写差异的原串（含标点/空格差异或非拉丁文字的原始形）
  const rawTrim = String(raw ?? "").normalize("NFKC").trim();
  if (rawTrim && rawTrim.toLowerCase() !== base.toLowerCase()) push(rawTrim);
  return out;
}

/** 取词判定（纯本地）：1–3 token、去空白后 1–30 字；句子级长选区拒绝（走既有 AI 制卡） */
export function isVocabSelection(text: string): boolean {
  const t = String(text ?? "").normalize("NFKC").trim();
  if (!t) return false;
  const compact = t.replace(/\s/g, "");
  if (compact.length < 1 || compact.length > 30) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length > 3) return false;
  // CJK 无空格长串视为词组（≤8 字才算词）
  if (tokens.length === 1 && /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(t) && compact.length > 8) return false;
  return true;
}

/** 从上下文中抽取含选中词的句子（中日英句末标点切分）；找不到返回选中文本本身 */
export function extractSentence(contextText: string, selectedText: string): string {
  const ctx = String(contextText ?? "");
  const sel = String(selectedText ?? "").trim();
  if (!ctx || !sel) return sel;
  const idx = ctx.indexOf(sel);
  const hay = idx >= 0 ? ctx : `${ctx} ${sel}`;
  const at = idx >= 0 ? idx : ctx.length + 1;
  const bounds = /[。！？!?；;\n]/;
  let start = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (bounds.test(hay[i])) {
      start = i + 1;
      break;
    }
  }
  let end = hay.length;
  for (let i = at + sel.length; i < hay.length; i++) {
    if (bounds.test(hay[i])) {
      end = i + 1;
      break;
    }
  }
  const s = hay.slice(start, end).trim();
  return s || sel;
}

export interface VocabDraft {
  kind: VocabKind;
  cardType: "qa" | "cloze";
  front: string;
  back: string;
  cloze?: string | null;
  contextPrefix: string;
  example: string | null;
}

/** 单词卡四形式（M7 勾选用）：kind 联合类型 + 全集 + 中文标签 */
export type VocabKind = "zh2foreign" | "foreign2zh" | "listening" | "cloze";
export const VOCAB_KINDS: VocabKind[] = ["zh2foreign", "foreign2zh", "listening", "cloze"];
export const VOCAB_KIND_LABEL: Record<VocabKind, string> = {
  zh2foreign: "中→外",
  foreign2zh: "外→中",
  listening: "听音",
  cloze: "原句挖空",
};

function escCloze(s: string): string {
  return s.replace(/[{}]/g, "");
}

/** 语言 → 规范前缀标签（R6 上下文前缀=领域/学科名，禁含答案内容词）；未知语言回退「词汇」 */
export function languageLabel(lang: string): string {
  const map: Record<string, string> = {
    en: "英语", ja: "日语", zh: "中文", ko: "韩语", fr: "法语",
    de: "德语", es: "西班牙语", ru: "俄语", la: "拉丁语",
  };
  return map[(lang || "").toLowerCase()] ?? "词汇";
}

/** 拼写提示语用的语言文字名（用户定稿句式「请回忆英文拼写」中的「英文」）：英语→英文…未知→外文 */
export function cueName(lang: string): string {
  const label = languageLabel(lang);
  if (label === "词汇") return "外文";
  return label === "中文" ? "中文" : label.replace(/语$/, "文");
}

/** 音标规范包裹：无音标→""；已带 / 或 [ →原样；否则包 /…/（ECDICT 音标常为 'mɒrәl 裸串） */
export function fmtPhonetic(p: string | null | undefined): string {
  const t = String(p ?? "").trim();
  if (!t) return "";
  if (t.startsWith("/") || t.startsWith("[")) return t;
  return `/${t}/`;
}

/**
 * 单词卡快照组装（纯函数，D18 合规：每张独立卡，各自独立 FSRS 调度；落库时各自快照文本）。
 * 卡面模板（v32 用户拍板句式；前缀=语言名标签，ECDICT pos 频次码「j:93/n:7」一律不入卡面）：
 *   ① 中→外 front `释义：<释义>（请回忆英文拼写）`（cue 随语言变：日文/法文…） back `词（读法） /音标/`
 *   ② 外→中 front `拼写：<词>（请回忆单词含义）` back `/音标/` + 空行 + 释义（front 不带音标——发音是回忆目标）
 *   ③ 听音 front `发音：（请回忆英文拼写与单词含义）`（无 🔊 字符——功能按钮由 CardFace 嵌入题面内；
 *      音频=TTS 默认/在线音频可切） back 同① + 空行释义
 *   ④ 原句挖空 front 原句挖空 + 空行 `（提示：<释义>）`——挖空答案不唯一，用词义锁定（调研结论：
 *      不引本地翻译引擎，词义即查词所得，纯本地零依赖；整句译文入可选池） back 同① + 空行释义
 * kinds：缺省=全部 4 种；传入子集则按全集顺序过滤（非法值忽略）。
 */
export function buildVocabDrafts(entry: DictionaryEntry, ctx: ReadingContext, kinds?: VocabKind[]): VocabDraft[] {
  const want = new Set<VocabKind>(
    (kinds ?? VOCAB_KINDS).filter((k): k is VocabKind => VOCAB_KINDS.includes(k))
  );
  const foreign = entry.word;
  const reading = entry.reading && entry.reading !== foreign ? `（${entry.reading}）` : "";
  const phon = fmtPhonetic(entry.pronunciation);
  const zh = entry.definitions.slice(0, 2).join("；") || "(暂无释义)";
  const sentence = ctx.sentence || ctx.selectedText;
  const clozeText = sentence.includes(ctx.selectedText)
    ? sentence.replace(ctx.selectedText, `{{c1::${escCloze(ctx.selectedText)}}}`)
    : `…{{c1::${escCloze(ctx.selectedText)}}}…（${sentence}）`;
  const prefix = `${languageLabel(entry.language)}:`;
  const cue = cueName(entry.language);
  const wordLine = `${foreign}${reading}${phon ? ` ${phon}` : ""}`;
  const all: VocabDraft[] = [
    {
      kind: "zh2foreign",
      cardType: "qa",
      front: `释义：${zh}（请回忆${cue}拼写）`,
      back: wordLine,
      cloze: null,
      contextPrefix: prefix,
      example: sentence,
    },
    {
      kind: "foreign2zh",
      cardType: "qa",
      front: `拼写：${foreign}（请回忆单词含义）`,
      back: [phon, zh].filter(Boolean).join("\n\n"),
      cloze: null,
      contextPrefix: prefix,
      example: sentence,
    },
    {
      kind: "listening",
      cardType: "qa",
      front: `发音：（请回忆${cue}拼写与单词含义）`,
      back: `${wordLine}\n\n${zh}`,
      cloze: null,
      contextPrefix: prefix,
      example: sentence,
    },
    {
      kind: "cloze",
      cardType: "cloze",
      front: `${clozeText}\n\n（提示：${zh}）`,
      back: `${wordLine}\n\n${zh}`,
      cloze: clozeText,
      contextPrefix: prefix,
      example: sentence,
    },
  ];
  return all.filter((d) => want.has(d.kind));
}

export interface DictLookupResult {
  entry: DictionaryEntry;
  providerId: string;
  fromCache: boolean;
}

function isFresh(cache: DictCache, provider: DictionaryProvider, language: string, word: string): DictLookupResult | null {
  if (!provider.supportsCaching) return null;
  const hit = cache.get(provider.id, language, word);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > provider.cacheTTLms) return null;
  return { entry: hit.entry, providerId: provider.id, fromCache: true };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`词典查询超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * DictionaryManager：local / online / auto 三档；auto=优先在线，失败/超时/无结果回落本地（v32 口径）。
 * 缓存写入遵守 supportsCaching；错误归一为 {providerId, message} 列表（调用方展示重试/切本地）。
 */
export class DictionaryManager {
  mode: DictSourceMode;
  providers: DictionaryProvider[];
  cache: DictCache;
  timeoutMs: number;
  errors: { providerId: string; message: string }[] = [];

  constructor(opts: { mode?: DictSourceMode; providers?: DictionaryProvider[]; cache?: DictCache; timeoutMs?: number } = {}) {
    this.mode = opts.mode ?? "auto";
    this.providers = opts.providers ?? [];
    this.cache = opts.cache ?? new InMemoryDictCache();
    this.timeoutMs = opts.timeoutMs ?? 12000;
  }

  orderedProviders(language?: string): DictionaryProvider[] {
    const byKind = (k: "online" | "other") => this.providers.filter((p) => (k === "online" ? p.kind === "online" : p.kind !== "online"));
    // 在线 Provider 按语言路由：Jisho 类日语源不再为英文词白跑（404 噪音）——v32 修复
    const langOk = (p: DictionaryProvider) => !language || p.languages.length === 0 || p.languages.includes(language);
    if (this.mode === "local") return byKind("other");
    if (this.mode === "online") return byKind("online").filter(langOk);
    // auto：在线优先（语言匹配者），其次本地/用户导入
    return [...byKind("online").filter(langOk), ...byKind("other")];
  }

  async lookup(rawText: string, ctx: DictLookupContext = {}): Promise<DictLookupResult> {
    this.errors = [];
    const candidates = wordCandidates(rawText);
    if (candidates.length === 0) throw new Error("未输入可查询的单词");
    // v38 D35：语言路由五级链；解析结果统一下发（Provider 内缓存键/语言标签与判定一致）
    const language = resolveLookupLanguage({
      word: candidates[0],
      sentence: ctx.sentence,
      bookLanguage: ctx.bookLanguage,
      manualHint: ctx.languageHint,
    });
    const providerCtx: DictLookupContext = { ...ctx, languageHint: language };
    for (const provider of this.orderedProviders(language)) {
      for (const cand of candidates) {
        const cached = isFresh(this.cache, provider, language, cand);
        if (cached) return cached;
        try {
          const entry = await withTimeout(provider.lookup(cand, providerCtx), this.timeoutMs);
          if (!entry) continue;
          const full: DictionaryEntry = { ...entry, normalizedWord: cand, language: entry.language || language };
          if (provider.supportsCaching) this.cache.set(provider.id, full.language, cand, full);
          return { entry: full, providerId: provider.id, fromCache: false };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.errors.push({ providerId: provider.id, message: msg });
          // 网络级超时 → 该 Provider 本轮剩余候选不再重试（12s × N 候选曾把回退拖到半分钟——v32 修复）
          if (msg.includes("超时")) break;
        }
      }
    }
    const detail = this.errors.length ? `（${this.errors.map((e) => `${e.providerId}: ${e.message}`).join("；")}）` : "";
    throw new Error(`未找到释义${detail}`);
  }
}

// 日语确定性信号：假名（平/片/半角片名 extending block）+ 々（U+3005 叠字）+ 〆（U+3006）。
// 中文文本不会出现假名；纯汉字串（如日语「山」）无法从字面区分中日，交给 resolveLookupLanguage 的上级信号。
const JA_SIGNAL_RE = /[\u3040-\u30ff\u3005\u3006]/;

function hasJapaneseSignal(text: string | null | undefined): boolean {
  return JA_SIGNAL_RE.test(String(text ?? ""));
}

/** 字面语言判定（词内 + 句级信号，v38 D35）：
 *  词含假名/日文记号 → ja；否则句含假名（选区所在句几乎必含假名才算日语句子）→ ja；
 *  再走原规则（汉字→zh、谚文→ko、兜底 en）。 */
export function guessLanguage(word: string, sentence?: string | null): string {
  if (hasJapaneseSignal(word)) return "ja";
  if (hasJapaneseSignal(sentence)) return "ja";
  if (/[\u4e00-\u9fa5]/.test(word)) return "zh";
  if (/[\uac00-\ud7af]/.test(word)) return "ko";
  return "en";
}

export interface LookupLanguageInput {
  word: string;
  sentence?: string | null;
  bookLanguage?: string | null;
  manualHint?: string | null;
}

/** D35 查词语言路由优先级链（高→低）：面板手动切换 > 词内假名/日文记号 > 句中假名 > 书籍语言属性 > 字面正则兜底。
 *  manualHint="auto"（或空）视为未手动选择；越局部的信号越可信，书籍语言只兜住无假名信号的字面歧义。 */
export function resolveLookupLanguage(input: LookupLanguageInput): string {
  const hint = String(input.manualHint ?? "").trim().toLowerCase();
  if (hint && hint !== "auto") return hint;
  if (hasJapaneseSignal(input.word)) return "ja";
  if (hasJapaneseSignal(input.sentence)) return "ja";
  const book = String(input.bookLanguage ?? "").trim().toLowerCase();
  if (book) return book;
  return guessLanguage(input.word);
}

export interface LocalHit extends DictionaryEntry {
  /** 命中来源的词典语言（dict_sources.lang；StarDict/DSL 手动导入等未知来源为空） */
  sourceLanguage?: string;
}

/** 本地多来源命中同一词头时的语言优先（v38 D35）：sourceLanguage 精确匹配 > 未知语言（空）> 原序。
 *  例：日语词「山」在 JMDict（ja）与 CC-CEDICT（zh）同时命中时优先 JMDict，不再受入库顺序摆布。 */
export function pickLocalHit(hits: LocalHit[], language?: string | null): LocalHit | null {
  if (!hits.length) return null;
  const lang = String(language ?? "").trim().toLowerCase();
  if (lang) {
    const exact = hits.find((h) => String(h.sourceLanguage ?? "").trim().toLowerCase() === lang);
    if (exact) return exact;
  }
  return hits.find((h) => !String(h.sourceLanguage ?? "").trim()) ?? hits[0];
}

/** 下载目录条目档位：download=可一键下载并建索引；importOnly=仅本地导入；parked=后续批次；onlineOnly=仅在线 */
export type DictSuitable = "download" | "importOnly" | "parked" | "onlineOnly";
