// @runtime: node
// 运行：node tests/lm-lex.test.cjs
// D124 §13.2：lmLex 用例（Porter / lexemeKey / tokenize / 覆盖率 / 覆盖带 / i+1 句子）
const assert = require("node:assert");
const path = require("node:path");
const lmLex = require(path.join(__dirname, "..", "electron", "lmLex.js"));

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label);
  n++;
}

// 1. Porter（官方用例）
const porterCases = [
  ["caresses", "caress"], ["ponies", "poni"], ["cats", "cat"], ["feed", "feed"],
  ["plastered", "plaster"], ["motoring", "motor"], ["sing", "sing"], ["hopping", "hop"],
  ["falling", "fall"], ["hissing", "hiss"], ["happy", "happi"], ["sky", "sky"],
  ["relational", "relat"], ["generalization", "gener"], ["connection", "connect"],
  ["connected", "connect"], ["connecting", "connect"], ["connections", "connect"],
  ["today", "todai"]
];
for (const [input, expected] of porterCases) {
  eq(lmLex.porterStem(input), expected, `porterStem(${input})`);
}

// 2. lexemeKey 英语
eq(lmLex.lexemeKey("Went", "en"), "go", "lexemeKey went→go");
eq(lmLex.lexemeKey("children", "en"), "child", "lexemeKey children→child");
eq(lmLex.lexemeKey("John's", "en"), "john", "lexemeKey John's→john");

// 3. NFKC
eq(lmLex.lexemeKey("ｶﾀｶﾅ", "ja"), "カタカナ", "lexemeKey NFKC 半角→全角");

// 4. tokenize 专名
const tk = lmLex.tokenize("I met John in Paris. He smiled.", "en");
const bySurface = {};
for (const t of tk) bySurface[t.surface] = t;
eq(bySurface.John.proper, true, "John proper");
eq(bySurface.Paris.proper, true, "Paris proper");
eq(bySurface.He.proper, false, "He 句首不判专名");
eq(bySurface.I.proper, false, "单字母词一律不判专名");

// 5. 纯数字丢弃
ok(!lmLex.tokenize("in 2024 we", "en").some((t) => t.surface === "2024"), "纯数字 token 被丢弃");

// 5a. 德语专名规则关闭
for (const t of lmLex.tokenize("Ich sehe den Hund im Garten.", "de")) {
  if (t.surface === "Hund" || t.surface === "Garten") eq(t.proper, false, `德语 ${t.surface} proper=false`);
}

// 5b. 大小写折叠按语言
eq(lmLex.lexemeKey("İstanbul", "tr"), "istanbul", "土耳其语 İ 折叠");
eq(lmLex.lexemeKey("Haus", "de"), "haus", "德语折叠");
eq(lmLex.lexemeKey("Москва", "ru"), "москва", "西里尔折叠");

// 5c. 法语省音
eq(lmLex.lexemeKey("l'homme", "fr"), "homme", "法语省音前缀");

// 5d. baseLang
eq(lmLex.baseLang("zh-TW"), "zh", "baseLang zh-TW");
eq(lmLex.baseLang("pt_BR"), "pt", "baseLang pt_BR");
eq(lmLex.baseLang("EN"), "en", "baseLang EN");

// 5e. 泰文分词（无空格文字可切分）
ok(lmLex.tokenize("ฉันชอบอ่านหนังสือ", "th").length >= 3, "泰文 Intl.Segmenter 切分 ≥3 token");

// 6. 覆盖率与覆盖带
eq(lmLex.unitCoverage([[1, 8], [2, 1], [3, 1]], 10, (id) => id === 1 || id === 2), 0.9, "unitCoverage 0.9");
eq(lmLex.bandOf(0.9), "intensive", "bandOf 0.9");
eq(lmLex.bandOf(0.95), "optimal", "bandOf 0.95");
eq(lmLex.bandOf(0.98), "easy", "bandOf 0.98");
eq(lmLex.bandOf(0.89), "hard", "bandOf 0.89");
eq(lmLex.bandOf(0.95, 0.01), "intensive", "bandOf 偏移后 0.95 需 0.96");
eq(lmLex.unitCoverage([], 0, () => false), 1, "tokenCount=0 → 1");

// 7. i+1 句子
const matKey = lmLex.lexemeKey("mat", "en");
const catKey = lmLex.lexemeKey("cat", "en");
const tk7 = lmLex.tokenize("the cat sat on the mat today", "en");
eq(lmLex.isIPlusOneSentence(tk7, (k) => k !== matKey, "en"), matKey, "恰好 1 个未知词");
eq(lmLex.isIPlusOneSentence(tk7, (k) => ![matKey, catKey].includes(k), "en"), null, "2 个未知词 → null");
eq(lmLex.isIPlusOneSentence(lmLex.tokenize("the cat sat down", "en"), () => true, "en"), null, "token 数不足 → null");
eq(
  lmLex.isIPlusOneSentence(lmLex.tokenize("the mat sat on the mat today", "en"), (k) => k !== matKey, "en"),
  matKey,
  "同一未知词出现两次算 1 个"
);

console.log(`${n} passed`);
