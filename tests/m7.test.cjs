// M7 词典回归测试（v32；v38 增语言路由与日→中解析器）：取词判定/规范化/语言路由/四卡快照/Context 分离/Manager 回退/缓存许可/目录分类/主进程解析器
// 运行：node tests/m7.test.cjs
// 重新打包：node_modules/.bin/esbuild src/lib/dict.ts src/lib/dictCatalog.ts --bundle --platform=node --format=cjs --outdir=tests/tmp-m7 --log-level=silent
//           node_modules/.bin/esbuild electron/dictStore.js --bundle --platform=node --format=cjs --external:electron --external:sql.js --outfile=tests/tmp-m7/dictStore.cjs --log-level=silent
//           （v38 起 dictStore 打包必须 --external:sql.js：内联会让 sql-wasm.wasm 相对 bundle 目录定位失败）
const dictMod = require("./tmp-m7/dict.js");
const catMod = require("./tmp-m7/dictCatalog.js");
const d = { ...dictMod, ...catMod };
// dictStore 纯解析函数（require("electron") 在 node 下解析为路径串，纯函数不受影响）
const store = require("./tmp-m7/dictStore.cjs");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
async function collect(gen) {
  const out = [];
  for await (const r of gen) out.push(r);
  return out;
}

console.log("== M7-1 取词判定（isVocabSelection） ==");
check("单个英文词可查", d.isVocabSelection("abandon") === true, true, d.isVocabSelection("abandon"));
check("日语活用形可查", d.isVocabSelection("見逃した") === true, true, d.isVocabSelection("見逃した"));
check("三词以内词组可查", d.isVocabSelection("look forward to") === true, true, d.isVocabSelection("look forward to"));
check("长句拒绝（走 AI 制卡）", d.isVocabSelection("this is a very long sentence with many words inside it") === false, false, true);
check("空串拒绝", d.isVocabSelection("   ") === false, false, true);

console.log("== M7-2 规范化与候选队列 ==");
check("英文小写去标点", d.normalizeWord("  Abandon, ") === "abandon", "abandon", d.normalizeWord("  Abandon, "));
check("running 候选含 run", d.wordCandidates("running").includes("run"), true, d.wordCandidates("running"));
check("純大小写变体不重复入队（v32 修复：Moral 不再二次查询）", !d.wordCandidates("Moral").includes("Moral"), true, d.wordCandidates("Moral"));
check("見逃した 候选含 見逃す", d.wordCandidates("見逃した").includes("見逃す"), true, d.wordCandidates("見逃した"));
check("食べました 候选含 食べる", d.wordCandidates("食べました").includes("食べる"), true, d.wordCandidates("食べました"));
check("队列确定性（两次一致）", JSON.stringify(d.wordCandidates("running")) === JSON.stringify(d.wordCandidates("running")), true, true);
check("原句抽取含选中词", d.extractSentence("彼はその小さな変化を見逃した。明日も頑張る。", "見逃した").includes("見逃した"), true, true);

console.log("== M7-2b 语言路由（v38 D35：纯汉字串消歧） ==");
check("假名词判 ja", d.guessLanguage("たべる") === "ja", "ja", d.guessLanguage("たべる"));
check("纯汉字无上下文判 zh（字面歧义回退既有行为）", d.guessLanguage("山") === "zh", "zh", d.guessLanguage("山"));
check("纯汉字 + 句中假名判 ja（核心场景：日文书选「山」）", d.guessLanguage("山", "あの山は高いです。") === "ja", "ja", d.guessLanguage("山", "あの山は高いです。"));
check("叠字记号 々 判 ja", d.guessLanguage("人々") === "ja", "ja", d.guessLanguage("人々"));
check("谚文判 ko", d.guessLanguage("사과") === "ko", "ko", d.guessLanguage("사과"));
check("拉丁判 en", d.guessLanguage("moral") === "en", "en", d.guessLanguage("moral"));
check("D35 链：面板手动切换最高", d.resolveLookupLanguage({ word: "山", sentence: "あの山だ。", manualHint: "en" }) === "en", "en", d.resolveLookupLanguage({ word: "山", sentence: "あの山だ。", manualHint: "en" }));
check("D35 链：manualHint=auto 视为未选", d.resolveLookupLanguage({ word: "山", manualHint: "auto" }) === "zh", "zh", d.resolveLookupLanguage({ word: "山", manualHint: "auto" }));
check("D35 链：词内假名 > 书籍语言", d.resolveLookupLanguage({ word: "たべる", bookLanguage: "zh" }) === "ja", "ja", d.resolveLookupLanguage({ word: "たべる", bookLanguage: "zh" }));
check("D35 链：句中假名 > 书籍语言", d.resolveLookupLanguage({ word: "山", sentence: "山が好きだ。", bookLanguage: "zh" }) === "ja", "ja", d.resolveLookupLanguage({ word: "山", sentence: "山が好きだ。", bookLanguage: "zh" }));
check("D35 链：书籍语言兜住无假名歧义", d.resolveLookupLanguage({ word: "山", sentence: "山下有路。", bookLanguage: "ja" }) === "ja", "ja", d.resolveLookupLanguage({ word: "山", sentence: "山下有路。", bookLanguage: "ja" }));
check("D35 链：中文书无假名信号仍 zh（中文书行为不变）", d.resolveLookupLanguage({ word: "山", sentence: "山下有路。", bookLanguage: "zh" }) === "zh", "zh", d.resolveLookupLanguage({ word: "山", sentence: "山下有路。", bookLanguage: "zh" }));
check("D35 链：全部无信号回退正则", d.resolveLookupLanguage({ word: "山" }) === "zh", "zh", d.resolveLookupLanguage({ word: "山" }));
const langHits = [
  { word: "山", language: "", sourceLanguage: "zh", definitions: ["shān"], source: "CC-CEDICT", normalizedWord: "山", capabilities: ["definition"] },
  { word: "山", language: "", sourceLanguage: "ja", definitions: ["山。"], source: "JMDict", normalizedWord: "山", capabilities: ["definition"] },
  { word: "山", language: "", sourceLanguage: "", definitions: ["unknown"], source: "StarDict", normalizedWord: "山", capabilities: ["definition"] },
];
check("pickLocalHit 精确语言优先（ja 命中 JMDict 不再被先入库的 CEDICT 抢走）", d.pickLocalHit(langHits, "ja").sourceLanguage === "ja", "ja", d.pickLocalHit(langHits, "ja"));
check("pickLocalHit zh 精确命中", d.pickLocalHit(langHits, "zh").sourceLanguage === "zh", "zh", d.pickLocalHit(langHits, "zh"));
check("pickLocalHit 无精确时取未知语言来源（通配，D35 链第二档）", d.pickLocalHit([langHits[0], langHits[2]], "ja").sourceLanguage === "", "空", d.pickLocalHit([langHits[0], langHits[2]], "ja"));
check("pickLocalHit 全为已知异语言时回退原序首条（D35 链第三档）", d.pickLocalHit([langHits[0], langHits[1]], "ko").sourceLanguage === "zh", "zh", d.pickLocalHit([langHits[0], langHits[1]], "ko"));
check("pickLocalHit 空命中集 = null", d.pickLocalHit([], "ja") === null, null, d.pickLocalHit([], "ja"));

console.log("== M7-3 四卡快照（buildVocabDrafts，D18 独立卡） ==");
const entry = {
  word: "abandon", reading: null, pronunciation: "/əˈbændən/", audio: "https://x/abandon.mp3",
  definitions: ["放弃；遗弃", "放纵"], partOfSpeech: ["v."], examples: ["He abandoned the plan."],
  source: "FreeDictionaryAPI", language: "en", normalizedWord: "abandon",
  capabilities: ["definition", "pronunciation", "audio", "partOfSpeech", "examples"],
};
const ctx = { documentId: "doc1", cfi: "epubcfi(/6/4)", anchorText: "he abandoned", selectedText: "abandoned", normalizedWord: "abandon", sentence: "He abandoned the plan." };
const drafts = d.buildVocabDrafts(entry, ctx);
check("产出 4 张卡", drafts.length === 4, 4, drafts.length);
check("四卡 kind 齐备", ["zh2foreign", "foreign2zh", "listening", "cloze"].every((k) => drafts.some((x) => x.kind === k)), true, drafts.map((x) => x.kind));
check("挖空卡含 {{c1::}}", drafts.find((x) => x.kind === "cloze").cloze.includes("{{c1::"), true, drafts.find((x) => x.kind === "cloze").cloze);
check("每卡自带原句 example", drafts.every((x) => (x.example || "").includes("abandon")), true, drafts.map((x) => x.example));

console.log("== M7-3b 卡面模板（v32 用户定稿句式） ==");
const zh2 = drafts.find((x) => x.kind === "zh2foreign");
const f2z = drafts.find((x) => x.kind === "foreign2zh");
const lis = drafts.find((x) => x.kind === "listening");
const clo = drafts.find((x) => x.kind === "cloze");
check("中→外 front=释义：…（请回忆英文拼写）", zh2.front === "释义：放弃；遗弃；放纵（请回忆英文拼写）", "释义：…（请回忆英文拼写）", zh2.front);
check("中→外 back=词+音标（/…/ 包裹）", zh2.back === "abandon /əˈbændən/", "abandon /əˈbændən/", zh2.back);
check("中→外 前缀=语言名标签（英语:）", zh2.contextPrefix === "英语:", "英语:", zh2.contextPrefix);
check("外→中 front=拼写：…（请回忆单词含义）且无音标泄漏", f2z.front === "拼写：abandon（请回忆单词含义）" && !f2z.front.includes("ə"), true, f2z.front);
check("外→中 back=音标段 + 释义段", f2z.back === "/əˈbændən/\n\n放弃；遗弃；放纵", true, f2z.back);
check("听音 front=发音：（请回忆英文拼写与单词含义）且无 🔊 字符（按钮由 CardFace 嵌入题面）", lis.front === "发音：（请回忆英文拼写与单词含义）" && !lis.front.includes("🔊"), true, lis.front);
check("听音 back=词音标行 + 空行释义段", lis.back === "abandon /əˈbændən/\n\n放弃；遗弃；放纵", true, lis.back);
check("挖空 back=词音标行 + 空行释义段", clo.back === "abandon /əˈbændən/\n\n放弃；遗弃；放纵", true, clo.back);
check("挖空 front=原句挖空 + 空行词义提示行（锁定唯一答案）", clo.front.includes("{{c1::abandoned}}") && clo.front.endsWith("（提示：放弃；遗弃；放纵）"), true, clo.front);
const garbage = d.buildVocabDrafts({ ...entry, partOfSpeech: ["j:93/n:7"] }, ctx);
check("ECDICT pos 频次码不入卡面", !garbage.some((x) => (x.front + x.back + x.contextPrefix).includes("j:93")), true, garbage.map((x) => x.front));
check("裸音标自动包 /…/", d.fmtPhonetic("'mɒrәl") === "/'mɒrәl/" && d.fmtPhonetic("/əˈbændən/") === "/əˈbændən/" && d.fmtPhonetic("") === "", true, d.fmtPhonetic("'mɒrәl"));
check("cueName 随语言变动（ja→日文/fr→法文/未知→外文）", d.cueName("ja") === "日文" && d.cueName("fr") === "法文" && d.cueName("xx") === "外文", true, d.cueName("ja"));
const jaEntry = { ...entry, word: "食べる", reading: "たべる", language: "ja", pronunciation: "たべる" };
const jaDrafts = d.buildVocabDrafts(jaEntry, ctx);
check("日语中→外 front=（请回忆日文拼写）back 带读法", jaDrafts.find((x) => x.kind === "zh2foreign").front.includes("请回忆日文拼写") && jaDrafts.find((x) => x.kind === "zh2foreign").back.includes("食べる（たべる）"), true, jaDrafts.map((x) => x.front));

console.log("== M7-4 Manager：auto 在线优先 + 回落本地 + 缓存许可 ==");
(async () => {
  const onlineEntry = { ...entry, source: "online-mock" };
  const localEntry = { ...entry, word: "abandon", source: "local-mock", capabilities: ["definition"] };
  const online = { id: "online", kind: "online", languages: ["en"], capabilities: ["definition", "pronunciation", "audio"], supportsCaching: true, cacheTTLms: 1000, license: "test", attributionRequired: false, lookup: async () => onlineEntry };
  const local = { id: "local", kind: "local", languages: ["en"], capabilities: ["definition"], supportsCaching: true, cacheTTLms: 1000, license: "test", attributionRequired: false, lookup: async () => localEntry };
  const m = new d.DictionaryManager({ mode: "auto", providers: [local, online] });
  const r1 = await m.lookup("abandon");
  check("auto 优先在线", r1.providerId === "online" && r1.fromCache === false, "online/false", r1);
  const r2 = await m.lookup("abandon");
  check("第二次命中缓存", r2.fromCache === true, true, r2.fromCache);
  // 在线失败回落本地
  const badOnline = { ...online, id: "bad", lookup: async () => { throw new Error("net down"); } };
  const m2 = new d.DictionaryManager({ mode: "auto", providers: [local, badOnline] });
  const r3 = await m2.lookup("abandon");
  check("在线失败回落本地", r3.providerId === "local", "local", r3.providerId);
  check("错误归一记录 provider", m2.errors.some((e) => e.providerId === "bad"), true, m2.errors);
  // 不可缓存 provider 不写缓存
  let writes = 0;
  const cache = { get: () => null, set: () => { writes++; } };
  const noCache = { ...online, id: "nocache", supportsCaching: false, lookup: async () => onlineEntry };
  const m3 = new d.DictionaryManager({ mode: "online", providers: [noCache], cache });
  await m3.lookup("abandon");
  await m3.lookup("abandon");
  check("supportsCaching=false 不写缓存", writes === 0, 0, writes);
  // local 模式不碰在线
  let onlineHit = 0;
  const counting = { ...online, lookup: async () => { onlineHit++; return onlineEntry; } };
  const m4 = new d.DictionaryManager({ mode: "local", providers: [local, counting] });
  await m4.lookup("abandon");
  check("local 模式不查在线", onlineHit === 0, 0, onlineHit);
  // 语言路由：日语在线源不为英文词白跑（Jisho 404 噪音——v32 修复）
  let jaHit = 0;
  const jaOnly = { id: "ja-only", kind: "online", languages: ["ja"], capabilities: ["definition"], supportsCaching: false, cacheTTLms: 1000, license: "t", attributionRequired: false, lookup: async () => { jaHit++; return onlineEntry; } };
  const m5 = new d.DictionaryManager({ mode: "auto", providers: [local, jaOnly] });
  await m5.lookup("abandon");
  check("英语词不路由到日语在线源", jaHit === 0, 0, jaHit);
  // 超时短路：超时的 Provider 本轮剩余候选不再重试
  let timeoutHits = 0;
  const slowProvider = { ...online, id: "slow", lookup: async () => { timeoutHits++; throw new Error("词典查询超时（12000ms）"); } };
  const m6 = new d.DictionaryManager({ mode: "online", providers: [slowProvider] });
  await m6.lookup("running").catch(() => {});
  check("超时后该 Provider 剩余候选短路（2 候选只打 1 次）", timeoutHits === 1, 1, timeoutHits);

  console.log("== M7-5 目录分类（大小/简介/推荐齐备） ==");
  const cat = d.DICT_CATALOG;
  check("可下载项=5（JMDict/ECDICT 完整/CC-CEDICT + v38 jamdict-cn/kaikki 日→中）", d.downloadableCatalog().length === 5, 5, d.downloadableCatalog().length);
  check("每项有大小/简介/推荐/license", cat.every((c) => c.estSizeLabel && c.desc && c.recommend && c.license && c.url !== undefined), true, false);
  check("朗道牛津类不提供下载（仅导入）", cat.filter((c) => c.suitable === "importOnly").length >= 1, ">=1", cat.filter((c) => c.suitable === "importOnly").length);
  check("FreeDict/WordNet 停靠后续批次（tar.xz/多文件解析未齐）", cat.filter((c) => c.suitable === "parked").length >= 3, ">=3", cat.filter((c) => c.suitable === "parked").length);
  check("Kaikki 仅在线档", cat.some((c) => c.id === "kaikki-note" && c.suitable === "onlineOnly"), true, true);
  check("JMDict 首选可下载", cat.some((c) => c.id === "jmdict-e" && c.suitable === "download" && c.recommendLevel === "首选"), true, true);
  check("ECDICT 完整版=sqlite 直链（实测 207MB）", cat.some((c) => c.id === "ecdict-full" && c.format === "ecdict-sqlite" && c.url.includes("ecdict-sqlite-28.zip")), true, true);
  check("JMDict=www.edrdg.org 直链（ftp.edrdg.org https 已实测不可达）", cat.some((c) => c.id === "jmdict-e" && c.url.startsWith("https://www.edrdg.org/")), true, true);
  check("jamdict-cn 日→中 sqlite 直链且标注 AI 翻译（v38 D35）", cat.some((c) => c.id === "jamdict-cn" && c.format === "jamdict-sqlite" && c.suitable === "download" && c.url.includes("jamdict_cn_deduplicated.zip") && c.desc.includes("AI 翻译") && c.license.includes("CC-BY-SA")), true, true);
  check("kaikki 日语卷用原始包 raw-wiktextract-data（官方分卷将下架，v38 D35）", cat.some((c) => c.id === "kaikki-zh-ja" && c.format === "kaikki-jsonl" && c.suitable === "download" && c.url.includes("raw-wiktextract-data.jsonl.gz") && c.license.includes("GFDL")), true, true);

  console.log("== M7-6 主进程解析器（dictStore；async generator 分片） ==");
  // CC-CEDICT：繁简双头词 + Set 去重 + 注释跳过；3 万行输入守卫 O(n²) 回归（some() 版本会跑数十秒）
  const cedictLines = ["# 注释行"];
  for (let i = 0; i < 30000; i++) cedictLines.push(`詞${i} 词${i} [ci2] /gloss ${i}/alt ${i}/`);
  cedictLines.push(`詞5 词5 [ci5] /dup/`); // 重复头词——Set 去重后总数不变
  const t0 = Date.now();
  const cedictRows = await collect(store.parseCedictText(cedictLines.join("\n")));
  check("CC-CEDICT 3 万行解析（应秒级，O(n²) 回归会超时）", cedictRows.length === 60000 && Date.now() - t0 < 15000, 60000, `${cedictRows.length} @ ${Date.now() - t0}ms`);
  check("CC-CEDICT 释义解析/拼音字段", cedictRows[0].headword === "詞0" && cedictRows[0].phonetic === "ci2" && cedictRows[0].html.includes("gloss 0"), true, cedictRows[0]);
  // ECDICT CSV：字段内逗号、双写引号、跨行字段（引号配平）
  const csvText = "word,phonetic,translation,pos\n" +
    'test,"/test/","n. 测试,试验\n[网络] 检验""专""用",n.\n' +
    "plain,,/ Plain /,v.";
  const csvRows = await collect(store.parseEcdictCsv(csvText));
  check("ECDICT CSV 引号内逗号/转义引号/跨行字段", csvRows.length === 2 && csvRows[0].html.includes("测试,试验") && csvRows[0].html.includes('检验"专"用') && csvRows[0].html.includes("[网络]") && csvRows[1].headword === "plain", true, csvRows);
  // JMdict XML：keb/reb 双头词 + gloss 提取
  const jmdictXml = `<?xml version="1.0"?><JMdict><entry><ent_seq>1</ent_seq><k_ele><keb>食べる</keb></k_ele><r_ele><reb>たべる</reb></r_ele><sense><pos>verb</pos><gloss>to eat</gloss></sense></entry></JMdict>`;
  const jmRows = await collect(store.parseJmdictXml(jmdictXml));
  check("JMdict keb/reb 双头词 + gloss", jmRows.length === 2 && jmRows[0].headword === "食べる" && jmRows[1].headword === "たべる" && jmRows[0].html === "to eat" && jmRows[0].pos === "verb", true, jmRows);

  console.log("== M7-6b v38 新解析器（kaikki JSONL / jamdict sqlite / gz 嗅探） ==");
  const os = require("os");
  const zlib = require("zlib");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m7-v38-"));
  try {
    const jsonlLines = [
      JSON.stringify({ word: "英語", lang_code: "ja", pos: "noun", senses: [{ glosses: ["英语。", "英文"] }, { glosses: ["英语。"] }], sounds: [{ tags: ["Heiban"], other: "えーご" }] }),
      JSON.stringify({ word: "apple", lang_code: "en", pos: "noun", senses: [{ glosses: ["苹果"] }] }),
      JSON.stringify({ word: "山", lang_code: "ja", pos: "noun", senses: [{ glosses: ["山。", "山峰"] }], forms: [{ form: "山", tags: ["canonical"], ruby: [["山", "やま"]] }] }),
      "not json 行跳过",
    ];
    const plainFile = path.join(tmpDir, "kaikki.jsonl");
    fs.writeFileSync(plainFile, jsonlLines.join("\n"));
    const gzFile = path.join(tmpDir, "raw.jsonl.gz");
    fs.writeFileSync(gzFile, zlib.gzipSync(Buffer.from(jsonlLines.join("\n"))));
    const kkRows = await collect(store.parseKaikkiJsonlFile(plainFile));
    check("kaikki 过滤 lang_code==ja 且同词头释义合并去重", kkRows.length === 2 && kkRows.find((r) => r.headword === "英語").html.split("\n").length === 2, 2, kkRows.map((r) => r.headword));
    check("kaikki 假名读音取 sounds.other / forms.ruby", kkRows.find((r) => r.headword === "英語").phonetic === "えーご" && kkRows.find((r) => r.headword === "山").phonetic === "やま", "えーご/やま", kkRows.map((r) => r.phonetic));
    check("kaikki 非日语与无释义行跳过", !kkRows.some((r) => r.headword === "apple"), true, kkRows.map((r) => r.headword));
    check("kaikki gzip 文件直接可解析（magic 探测）", (await collect(store.parseKaikkiJsonlFile(gzFile))).length === 2, 2, "gz rows");
    check("gz 嗅探识别 JSONL（kaikki 路由依据）", store.sniffGzHead(gzFile).includes('"lang_code"'), true, store.sniffGzHead(gzFile).slice(0, 40));
    const jmGz = path.join(tmpDir, "jmdict.gz");
    fs.writeFileSync(jmGz, zlib.gzipSync(Buffer.from('<?xml version="1.0"?><JMdict><entry></entry></JMdict>')));
    check("gz 嗅探识别 JMdict XML（非 JSONL 不误路由）", !store.sniffGzHead(jmGz).startsWith("{"), true, store.sniffGzHead(jmGz).slice(0, 40));
    // jamdict mini 夹具：现造 Entry/Kanji/Kana/Sense/SenseGloss 库（真实库 142MB zip，schema 于 2026-09-15 实测）
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    const jdb = new SQL.Database();
    jdb.run("CREATE TABLE Entry (idseq INTEGER PRIMARY KEY)");
    jdb.run("CREATE TABLE Kanji (ID INTEGER PRIMARY KEY, idseq INTEGER, text TEXT)");
    jdb.run("CREATE TABLE Kana (ID INTEGER PRIMARY KEY, idseq INTEGER, text TEXT)");
    jdb.run("CREATE TABLE Sense (ID INTEGER PRIMARY KEY, idseq INTEGER)");
    jdb.run("CREATE TABLE SenseGloss (sid INTEGER, lang TEXT, text TEXT)");
    jdb.run("INSERT INTO Entry VALUES (100)");
    jdb.run("INSERT INTO Kanji VALUES (1, 100, '山')");
    jdb.run("INSERT INTO Kana VALUES (1, 100, 'やま')");
    jdb.run("INSERT INTO Sense VALUES (10, 100)");
    jdb.run("INSERT INTO SenseGloss VALUES (10, 'chn', '山。'), (10, 'chn', '山峰'), (10, 'eng', 'mountain')");
    const jamBytes = Buffer.from(jdb.export());
    const jamRows = await collect(store.iterJamdictSqlite(jamBytes));
    const mt = jamRows.find((r) => r.headword === "山");
    const mk = jamRows.find((r) => r.headword === "やま");
    check("jamdict 汉字词头带假名读音、释义仅取 lang=chn", !!mt && mt.phonetic === "やま" && mt.html.includes("山。") && mt.html.includes("山峰") && !mt.html.includes("mountain"), true, mt);
    check("jamdict 假名词头独立成行（kana 查询可命中）", !!mk && mk.html.includes("山。"), true, mk);
    check("jamdict schema 探测=jamdict", (await store.detectSqliteKind(jamBytes)) === "jamdict", "jamdict", await store.detectSqliteKind(jamBytes));
    const edb = new SQL.Database();
    edb.run("CREATE TABLE t (word TEXT, translation TEXT)");
    check("ECDICT 形态 sqlite 探测非 jamdict（路由回退 ECDICT）", (await store.detectSqliteKind(Buffer.from(edb.export()))) === "unknown", "unknown", await store.detectSqliteKind(Buffer.from(edb.export())));
    jdb.close();
    edb.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("== M7-7 四卡勾选（buildVocabDrafts kinds 过滤，v32 用户需求） ==");
  const dAll = d.buildVocabDrafts(entry, ctx);
  check("缺省 kinds = 全 4 张", dAll.length === 4 && d.VOCAB_KINDS.length === 4, 4, dAll.length);
  const dSub = d.buildVocabDrafts(entry, ctx, ["listening", "zh2foreign"]);
  check("子集 2 张且保持全集顺序", dSub.length === 2 && dSub[0].kind === "zh2foreign" && dSub[1].kind === "listening", "zh2foreign→listening", dSub.map((x) => x.kind));
  const dNone = d.buildVocabDrafts(entry, ctx, []);
  check("空 kinds = 0 张（UI 置灰防御）", dNone.length === 0, 0, dNone.length);
  const dBad = d.buildVocabDrafts(entry, ctx, ["bogus", "cloze"]);
  check("非法值忽略 + 合法值保留", dBad.length === 1 && dBad[0].kind === "cloze", "cloze", dBad.map((x) => x.kind));
  check("VOCAB_KIND_LABEL 标签齐备", Object.keys(d.VOCAB_KIND_LABEL).length === 4 && d.VOCAB_KIND_LABEL.cloze === "原句挖空", true, d.VOCAB_KIND_LABEL);

  console.log(`\nM7: ${pass} 通过, ${fail} 失败`);
  // v38：sql.js wsm/流句柄在 Windows 上 teardown 需一拍——立即 process.exit 会打 libuv 关闭中句柄断言（噪音）
  setTimeout(() => process.exit(fail > 0 ? 1 : 0), 100);
})().catch((e) => { console.error("M7 异步段异常", e); process.exit(1); });
