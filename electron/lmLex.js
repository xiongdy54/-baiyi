// D124 学习者模型 LM-1（设计稿 §6.2/§6.8）：分词、词项归一、停用词、覆盖率、i+1 句子判定。
// 纯函数、零 IO；依赖方向 lmText ← lmLex（§0.1-10）。全球化约束：任意语言都可用，
// 没有专门规则的语言走通用规则降级（不写死任何一种语言，Q1）。
const lmParams = require("./lmParams");

// 语言代码取 ISO 639-1 主子标签（zh-TW / zh-CN → zh；pt-BR → pt）
function baseLang(tag) {
  return String(tag ?? "").toLowerCase().split(/[-_]/)[0];
}

// 词之间不用空格分隔的文字（设计稿 §6.2 LANG_PROFILE.spaced）
const UNSPACED = new Set(["zh", "ja", "th", "lo", "km", "my", "bo"]);
// 能用「句中首字母大写」识别专名的语言（de 必须为 false——德语所有名词首字母大写）
const PROPER_BY_CAPS = new Set(["en", "fr", "es", "it", "pt", "nl", "sv", "da", "no", "nb", "nn", "ro", "ca", "pl", "cs", "id", "ms"]);

// 语言能力表（设计稿 §6.2）：cased 按文字判断（token 含 \p{Lu} 或 \p{Ll} 即有大小写），不列语言
const LANG_PROFILE = {
  get(lang) {
    const l = baseLang(lang);
    return {
      spaced: !UNSPACED.has(l),
      properByCaps: PROPER_BY_CAPS.has(l),
      stemmer: l === "en" ? "porter" : null,
      hasStopwordTable: l === "en" || l === "ja" || l === "zh"
    };
  }
};

// ---------- Porter 词干（tartarus.org/martin/PorterStemmer 官方参考实现：1980 原算法 +
// 官方两处修订：step 2 的 bli→ble、logi→log）；长度 ≤ 2 的词原样返回 ----------

function _cons(i, b) {
  const ch = b[i];
  if ("aeiou".includes(ch)) return false;
  if (ch === "y") return i === 0 ? true : !_cons(i - 1, b);
  return true;
}
function _m(b, k0, k) {
  // measure：C?(VC){m}V? 中的 m
  let n = 0;
  let i = k0;
  while (true) {
    if (i > k) return n;
    if (!_cons(i, b)) break;
    i++;
  }
  i++;
  while (true) {
    while (true) {
      if (i > k) return n;
      if (_cons(i, b)) break;
      i++;
    }
    i++;
    n++;
    while (true) {
      if (i > k) return n;
      if (!_cons(i, b)) break;
      i++;
    }
    i++;
  }
}
function _vowelinstem(b, k0, k) {
  for (let i = k0; i <= k; i++) if (!_cons(i, b)) return true;
  return false;
}
function _doublec(b, k) {
  if (k < 1) return false;
  if (b[k] !== b[k - 1]) return false;
  return _cons(k, b);
}
function _cvc(b, i) {
  if (i < 2 || !_cons(i, b) || _cons(i - 1, b) || !_cons(i - 2, b)) return false;
  const ch = b[i];
  if (ch === "w" || ch === "x" || ch === "y") return false;
  return true;
}

function porterStem(word) {
  const w = String(word ?? "");
  if (w.length <= 2) return w;
  let b = w.toLowerCase();
  let k = b.length - 1; // 词尾下标
  let j = 0; // ends() 命中时＝后缀前最后一个字符下标（stem 末尾，官方参考实现同语义）

  const ends = (s) => {
    const n = s.length;
    if (n > k + 1) return false;
    if (b.slice(k - n + 1, k + 1) !== s) return false;
    j = k - n;
    return true;
  };
  const setto = (s) => {
    b = b.slice(0, j + 1) + s;
    k = b.length - 1;
  };

  // step 1a
  if (b[k] === "s") {
    if (ends("sses")) k -= 2;
    else if (ends("ies")) setto("i");
    else if (b[k - 1] !== "s") k--;
  }
  // step 1b（eed 分支独占：不满足 m>0 时不再试 ed/ing）
  if (ends("eed")) {
    if (_m(b, 0, j) > 0) k--;
  } else if ((ends("ed") || ends("ing")) && _vowelinstem(b, 0, j)) {
    k = j;
    if (ends("at")) setto("ate");
    else if (ends("bl")) setto("ble");
    else if (ends("iz")) setto("ize");
    else if (_doublec(b, k)) {
      k--;
      if (b[k] === "l" || b[k] === "s" || b[k] === "z") k++;
    } else if (_m(b, 0, k) === 1 && _cvc(b, k)) setto("e");
  }
  // step 1c
  if (ends("y") && _vowelinstem(b, 0, j)) setto("i");

  // step 2（双段后缀，按官方顺序；含官方修订 bli→ble / logi→log）
  const step2 = [
    ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"],
    ["bli", "ble"], ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"],
    ["ization", "ize"], ["ation", "ate"], ["ator", "ate"], ["alism", "al"], ["iveness", "ive"],
    ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"],
    ["logi", "log"]
  ];
  for (const [suf, rep] of step2) {
    if (ends(suf)) {
      if (_m(b, 0, j) > 0) setto(rep);
      break;
    }
  }

  // step 3
  const step3 = [["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""]];
  for (const [suf, rep] of step3) {
    if (ends(suf)) {
      if (_m(b, 0, j) > 0) setto(rep);
      break;
    }
  }

  // step 4（m>1 删除后缀；ion 仅在前接 s/t 时删）
  const step4 = ["al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize"];
  for (const suf of step4) {
    if (ends(suf)) {
      if (suf === "ion" && !(j >= 0 && (b[j] === "s" || b[j] === "t"))) break;
      if (_m(b, 0, j) > 1) k = j;
      break;
    }
  }

  // step 5a（m 按含词尾 e 的整体计算，官方参考实现语义）
  if (b[k] === "e") {
    const a = _m(b, 0, k);
    if (a > 1 || (a === 1 && !_cvc(b, k - 1))) k--;
  }
  // step 5b
  if (_m(b, 0, k) > 1 && _doublec(b, k) && b[k] === "l") k--;

  return b.slice(0, k + 1);
}

// ---------- 英语不规则动词 / 复数（设计稿 §6.2 IRREGULAR，键全部小写） ----------
const IRREGULAR = {
  was: "be", were: "be", been: "be", am: "be", is: "be", are: "be",
  has: "have", had: "have", did: "do", done: "do", does: "do",
  went: "go", gone: "go", goes: "go", made: "make", took: "take", taken: "take",
  came: "come", saw: "see", seen: "see", got: "get", gotten: "get",
  gave: "give", given: "give", knew: "know", known: "know", thought: "think",
  told: "tell", found: "find", said: "say", left: "leave", felt: "feel",
  brought: "bring", began: "begin", begun: "begin", kept: "keep", held: "hold",
  wrote: "write", written: "write", stood: "stand", heard: "hear", meant: "mean",
  met: "meet", ran: "run", paid: "pay", sat: "sit", spoke: "speak", spoken: "speak",
  led: "lead", grew: "grow", grown: "grow", lost: "lose", fell: "fall", fallen: "fall",
  sent: "send", built: "build", understood: "understand", drew: "draw", drawn: "draw",
  broke: "break", broken: "break", spent: "spend", rose: "rise", risen: "rise",
  drove: "drive", driven: "drive", bought: "buy", wore: "wear", worn: "wear",
  chose: "choose", chosen: "choose",
  children: "child", men: "man", women: "woman", mice: "mouse", feet: "foot", teeth: "tooth"
};

// ---------- 停用词（设计稿 §6.2；按 lexemeKey 之前的小写原形比较） ----------
const STOPWORDS = {
  en: new Set(("a an the and or but if then else of to in on at by for with from as is are was were be been being am " +
    "do does did have has had i you he she it we they me him her us them my your his its our their this that these " +
    "those there here what which who whom whose when where why how not no yes so than too very can could will would " +
    "shall should may might must just also only about into over under again more most some any all each both few " +
    "other such own same up down out off").split(" ")),
  ja: new Set("の に は を た が で て と し れ さ ある いる も する から な こと として い や れる など なっ ない この ため その あっ よう また もの という あり まで られ なる へ か だ これ によって により おり より による ず なり られる において ば なかっ なく しかし について せ だっ できる それ う ので なお のみ でき き つ における および いう さらに でも ら たり ます ん です".split(" ")),
  zh: new Set("的 了 和 是 在 有 这 那 也 就 都 而 与 及 或 但 被 把 将 对 从 向 以 于 为 着 过 之 其 所 得 地 么 吗 呢 吧 啊 不 没 很 我 你 他 她 它 我们 你们 他们 这个 那个 一个 什么 因为 所以 如果 但是 可以 没有 自己 已经 还 又 再 才 就是 这样 那样".split(" "))
};
// 其他语言空集：没有停用词表的语言用「频率替代」（FREQ_STOP_TOP，§6.2），由调用方按 lexemes 计数现算
const HAS_STOPWORDS = (lang) => Boolean(STOPWORDS[baseLang(lang)]);

// ---------- 词项归一（设计稿 §6.2 lexemeKey） ----------

function hasCase(s) {
  return /\p{Lu}|\p{Ll}/u.test(s);
}

function lexemeKey(surface, lang) {
  let s = String(surface ?? "").normalize("NFKC");
  const l = baseLang(lang);
  if (hasCase(s)) s = s.toLocaleLowerCase(l || undefined); // 土耳其语 İ/I 依赖 locale，必须传 lang
  if (l === "en") {
    s = s.replace(/[’']s$/, "");
    if (IRREGULAR[s]) s = IRREGULAR[s];
    return porterStem(s);
  }
  // fr / it 等带省音的语言：去掉词首省音前缀（l'homme → homme）
  if (l === "fr" || l === "it") {
    s = s.replace(/^(l|d|j|m|n|s|t|c|qu)[’']/, "");
  }
  return s;
}

// ---------- 分词（设计稿 §6.2 tokenize） ----------

const SENTENCE_END_CHARS = new Set([".", "!", "?", "…", "。", "！", "？"]);

function _isSentenceStart(text, idx) {
  // 该词之前最近的非空白字符是 .!?…。！？ 或文本开头或换行
  for (let i = idx - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n") return true;
    if (/\s/.test(ch)) continue;
    return SENTENCE_END_CHARS.has(ch);
  }
  return true;
}

function _scriptOk(surface, l) {
  if (l === "ja") return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(surface);
  if (l === "zh") return /\p{Script=Han}/u.test(surface);
  if (l === "ko") return /\p{Script=Hangul}/u.test(surface);
  return /\p{L}/u.test(surface);
}

function tokenize(text, lang) {
  const src = String(text ?? "");
  const l = baseLang(lang);
  const out = [];
  const push = (surface, start, end) => {
    if (!surface) return;
    if (/^\p{N}+$/u.test(surface)) return; // 纯数字丢弃
    if (!_scriptOk(surface, l)) return; // 与材料语言主文字不同的段不计
    let proper = false;
    if (l && PROPER_BY_CAPS.has(l)) {
      // 仅 properByCaps 语言判专名：词长≥2、首字母大写、不是句首词（单字母一律 false）
      proper = surface.length >= 2 && /\p{Lu}/u.test(surface[0]) && !_isSentenceStart(src, start);
    }
    out.push({ surface, start, end, proper });
  };
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(l || "und", { granularity: "word" });
    for (const s of seg.segment(src)) {
      if (s.isWordLike) push(s.segment, s.index, s.index + s.segment.length);
    }
    return out;
  }
  // 极旧环境退化
  const re = /[\p{L}\p{M}]+/gu;
  let m;
  while ((m = re.exec(src)) !== null) push(m[0], m.index, m.index + m[0].length);
  return out;
}

// ---------- 覆盖率与覆盖带（设计稿 §6.8） ----------

function unitCoverage(lexArr, tokenCount, isKnownId) {
  const arr = Array.isArray(lexArr) ? lexArr : [];
  let known = 0;
  for (const [id, count] of arr) {
    if (isKnownId(Number(id))) known += Number(count) || 0;
  }
  if (!Number(tokenCount)) return 1;
  return known / Number(tokenCount);
}

function bandOf(coverage, shift = 0) {
  const c = Number(coverage) || 0;
  const s = Number(shift) || 0;
  const B = lmParams.BANDS;
  if (c >= B.EASY + s) return "easy";
  if (c >= B.OPTIMAL + s) return "optimal";
  if (c >= B.INTENSIVE + s) return "intensive";
  return "hard";
}

// ---------- i+1 句子判定（设计稿 §6.8）：未知的「不同 key」恰好 1 个才返回该 key ----------

function isIPlusOneSentence(tokens, isKnownKey, lang) {
  const l = baseLang(lang);
  const list = Array.isArray(tokens) ? tokens : [];
  if (list.length === 0) return null;
  // 长度门槛：无空格文字按句子纯文本长度 8–60 字；其他按 token 数 6–40（设计稿 §2.2-3）
  if (!LANG_PROFILE.get(l).spaced) {
    const first = list[0];
    const last = list[list.length - 1];
    const len = last.end - first.start;
    if (len < 8 || len > 60) return null;
  } else {
    if (list.length < 6 || list.length > 40) return null;
  }
  const unknownKeys = new Set();
  for (const t of list) {
    if (t.proper) continue; // 排除专名
    const key = lexemeKey(t.surface, l);
    if (!isKnownKey(key)) unknownKeys.add(key);
  }
  if (unknownKeys.size !== 1) return null; // 同一个未知词出现两次算 1 个
  return [...unknownKeys][0];
}

module.exports = {
  baseLang,
  LANG_PROFILE,
  tokenize,
  porterStem,
  IRREGULAR,
  lexemeKey,
  STOPWORDS,
  HAS_STOPWORDS,
  unitCoverage,
  bandOf,
  isIPlusOneSentence
};
