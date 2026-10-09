// 卡片辨析核心（D121 §3.2-§3.4）单元测试——纯 node，无 electron
// @runtime: node  @tier: 1  @gui: false  @id: DISAMBIGUATE  @timeout: 60
// 运行：node tests/disambiguate-core.test.cjs
// 契约：打分公式 / 阈值 / 排除规则；输入布局；出层校验每条规则（含降级与默认值）；提示词原文关键句。
(async () => {
const core = await import(require("url").pathToFileURL(require("path").join(__dirname, "../src/lib/disambiguateCore.mjs")).href);
const {
  VERDICTS, VERDICT_LABELS, normalizeText, bigramJaccard,
  rankDisambiguationCandidates, buildDisambiguateInput, validateDisambiguateOutput
} = core;

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const is = (name, actual, expected) => check(name, eq(actual, expected), expected, actual);

console.log("== A 常量 ==");
is("A1 VERDICTS", VERDICTS, ["missing-qualifier", "one-wrong", "duplicate", "confusable", "no-conflict", "insufficient", "manual"]);
is("A2 VERDICT_LABELS 七条中文", [VERDICT_LABELS["missing-qualifier"], VERDICT_LABELS["one-wrong"], VERDICT_LABELS.duplicate, VERDICT_LABELS.confusable, VERDICT_LABELS["no-conflict"], VERDICT_LABELS.insufficient, VERDICT_LABELS.manual],
  ["两张都对，前提不同", "有一张可能有误", "重复，只是说法不同", "两个概念确实易混", "没有冲突", "依据不足，无法判断", "手动处理"]);

console.log("== B normalizeText / bigramJaccard ==");
is("B1 cloze 去语法", normalizeText("首都是{{c1::北京}}。"), "首都是北京");
is("B2 cloze 带提示", normalizeText("{{c2::Paris::city}} is big"), "paris is big");
is("B3 空白折叠 + 标点 + 小写", normalizeText("  Hello,\n\tWORLD！ （ok）  "), "hello world ok");
is("B4 null → 空串", normalizeText(null), "");
is("B5 同串 Jaccard=1", bigramJaccard("abcd", "abcd"), 1);
is("B6 abcd vs abce = 2/4", bigramJaccard("abcd", "abce"), 0.5);
is("B7 双空 → 0", bigramJaccard("", "。！"), 0);
is("B8 单字符各视为一个 gram（同）", bigramJaccard("a", "a"), 1);
is("B9 单字符不同 → 0", bigramJaccard("a", "b"), 0);
is("B10 cloze 渲染后与明文等价", bigramJaccard("{{c1::abcd}}", "abcd"), 1);

console.log("== C rankDisambiguationCandidates ==");
const mk = (id, front, back, extra = {}) => ({ id, cardType: "basic", frontMarkdown: front, noteText: "", backMarkdown: back, ...extra });
const base = mk("base", "abcd", "xy", { knowledgePointId: "kp1", genBatchId: "b1", domain: ["d"], sourceRef: { title: "T" } });
const all = [
  mk("c1", "abcd", "xy"),                                                         // .55+.2 = .75
  mk("c2", "abce", "zz"),                                                         // .5*.55 = .275
  mk("c3", "qqqq", "xy"),                                                         // .2
  mk("c4", "qqqq", "zz"),                                                         // 0 → 丢
  mk("c5", "qqqq", "xy"),                                                         // .2（与 c3 同分，后入）
  mk("c6", "abcd", "xy", { isDeleted: true }),                                    // 软删除 → 排除
  mk("c7", "abcd", "zz", { status: "archived" }),                                 // .55 archived
  mk("c8", "qqqq", "zz", { knowledgePointId: "kp1", genBatchId: "b1", domain: ["d", "e"], sourceRef: { title: "T" } }), // .15+.05+.05=.25
  base
];
const r = rankDisambiguationCandidates(base, all, 10);
is("C1 顺序（手算 .75/.55/.275/.25/.2/.2；同分保持输入序；排除自身/软删/<0.08）", r.map((x) => x.id), ["c1", "c7", "c2", "c8", "c3", "c5"]);
is("C2 分数三位小数", r.map((x) => x.score), [0.75, 0.55, 0.275, 0.25, 0.2, 0.2]);
is("C3 archived 标记", r.map((x) => x.archived), [false, true, false, false, false, false]);
is("C4 默认 k=5 截断", rankDisambiguationCandidates(base, all).map((x) => x.id), ["c1", "c7", "c2", "c8", "c3"]);
is("C5 k=2", rankDisambiguationCandidates(base, all, 2).map((x) => x.id), ["c1", "c7"]);
is("C6 阈值：score<0.08 全丢 → 空数组", rankDisambiguationCandidates(base, [mk("z", "qqqq", "zz")]), []);
is("C7 阈值：仅同书 0.05 仍丢", rankDisambiguationCandidates(base, [mk("z", "qqqq", "zz", { sourceRef: { title: "T" } })]), []);
is("C8 kp 相同但 batch/doc 都不同 → 无 0.15", rankDisambiguationCandidates(base, [mk("z", "qqqq", "zz", { knowledgePointId: "kp1", genBatchId: "b2", domain: ["d"] })]), []);
{
  const b2 = mk("b2", "abcd", "xy", { knowledgePointId: "kp1", genBatchId: "bX", contextRef: { documentId: "D" } });
  const rr = rankDisambiguationCandidates(b2, [mk("z", "qqqq", "zz", { knowledgePointId: "kp1", genBatchId: "b9", contextRef: { documentId: "D" } })]);
  is("C9 kp 同 + documentId 同 → 0.15 + 同书 0.05 = 0.2", rr, [{ id: "z", score: 0.2, archived: false }]);
}
{
  const rr = rankDisambiguationCandidates(base, [mk("z", "qqqq", "zz", { knowledgePointId: "", genBatchId: "b1", domain: ["d"], sourceRef: { title: "T" } })]);
  is("C10 空 knowledgePointId 不算同簇（只剩 domain+书=0.1）", rr, [{ id: "z", score: 0.1, archived: false }]);
}
{
  const bd = mk("bd", "qqqq", "zz", { domain: ["d"], contextRef: { documentId: "D1" }, sourceRef: { title: "A" } });
  const rr = rankDisambiguationCandidates(bd, [
    mk("same-doc", "abcd", "xy", { domain: ["d"], contextRef: { documentId: "D1" }, sourceRef: { title: "B" } }), // 同书(doc) .05 + domain .05 = .1 保留
    mk("x", "abcd", "xy", { domain: ["d"], contextRef: { documentId: "D2" }, sourceRef: { title: "A" } })          // documentId 均非空且不同 → 非同书；仅 domain .05 → 丢
  ]);
  is("C11 同书：documentId 优先于标题", rr, [{ id: "same-doc", score: 0.1, archived: false }]);
}
{
  const bt = mk("bt", "qqqq", "zz", { sourceRef: { title: "A" } });
  const rr = rankDisambiguationCandidates(bt, [
    mk("t1", "qqqq", "zz", { docTitle: "A" }),     // 同书（docTitle 回退）+ front 全同 .55 → .60
    mk("t2", "qqqq", "zz", { docTitle: "Other" })  // .55 + 0 + back 全同 .2 = .75?  见下
  ]);
  // front/back 都与 bt 相同：t1 = .55+.2+.05 = .8，t2 = .75
  is("C12 同书回退 sourceRef.title||docTitle", rr.map((x) => [x.id, x.score]), [["t1", 0.8], ["t2", 0.75]]);
}
{
  const bf = mk("bf", "{{c1::abcd}}", "");
  const rr = rankDisambiguationCandidates(bf, [mk("n", "", "", { noteText: "abcd" })]);
  is("C13 cloze 渲染 + noteText 回退，front 全同 → .55", rr.map((x) => x.score), [0.55]);
}
{
  const io = { id: "io", cardType: "imageOcclusion", frontMarkdown: "", noteText: "", backMarkdown: "abcd" };
  const rr = rankDisambiguationCandidates(io, [mk("n", "abcd", "other")]);
  is("C14 图片遮挡卡以 backMarkdown 作 front（back 项为 0）→ .55", rr.map((x) => x.score), [0.55]);
}
is("C15 非数组入参安全", rankDisambiguationCandidates(base, null), []);

console.log("== D buildDisambiguateInput ==");
const sideA = { prefix: "桑德尔：", front: "优绩主义主张什么？", back: "才能、努力", sourceTitle: "精英的暴政", author: "桑德尔", anchor: "第3章", original: "原文A" };
const sideB = { prefix: null, front: "优绩社会如何分配？", back: "财富", sourceTitle: "某书", author: null, anchor: null, original: null };
is("D1 双卡完整布局",
  buildDisambiguateInput({ a: sideA, b: sideB }),
  "【卡 A】\n问题：桑德尔：优绩主义主张什么？\n答案：才能、努力\n来源：《精英的暴政》 · 桑德尔 · 第3章\nA 的原文：原文A\n\n【卡 B】\n问题：优绩社会如何分配？\n答案：财富\n来源：《某书》\nB 的原文：（无原文记录）");
is("D2 单卡模式替换整块",
  buildDisambiguateInput({ a: sideA, b: null }),
  "【卡 A】\n问题：桑德尔：优绩主义主张什么？\n答案：才能、努力\n来源：《精英的暴政》 · 桑德尔 · 第3章\nA 的原文：原文A\n\n【模式】单卡：用户认为卡 A 本身问得不清，没有对照卡。");
check("D3 无书名 → 来源：未知", buildDisambiguateInput({ a: { front: "q", back: "a" }, b: null }).includes("\n来源：未知\n"), true, false);
check("D4 原文截断到 1500", buildDisambiguateInput({ a: { front: "q", back: "a", original: "x".repeat(3000) }, b: null }).includes("A 的原文：" + "x".repeat(1500) + "\n\n"), true, false);
check("D5 只有作者无书名 → 来源：未知", buildDisambiguateInput({ a: { front: "q", back: "a", author: "某人" }, b: null }).includes("来源：未知"), true, false);
check("D6 前缀以冒号结尾且 front 以冒号开头 → 不重复冒号", buildDisambiguateInput({ a: { prefix: "对照:", front: ":问？", back: "a" }, b: null }).includes("问题：对照:问？"), true, false);
check("D7 前缀为空 → 仅 front", buildDisambiguateInput({ a: { prefix: "", front: "问？", back: "a" }, b: null }).includes("问题：问？\n"), true, false);
check("D8 原文仅空白 → 无原文记录", buildDisambiguateInput({ a: { front: "q", back: "a", original: "  \n " }, b: null }).includes("A 的原文：（无原文记录）"), true, false);

console.log("== E validateDisambiguateOutput ==");
const cur = { A: { contextPrefix: "", front: "问A", back: "答A" }, B: { contextPrefix: "", front: "问B", back: "答B" } };
const O = { hasB: true, originA: "这是 卡A 的\n原文  内容", originB: "卡B原文内容", current: cur };
const J = (o) => JSON.stringify(o);
const base0 = { verdict: "missing-qualifier", explanation: "e", evidence: [], fixes: [], wrongCard: null, keepCard: null };
{
  const v = validateDisambiguateOutput("完全不是 JSON 的回答".repeat(30), O);
  check("E1 坏 JSON → insufficient + 原文前 150 字", v.verdict === "insufficient" && v.explanation.length === 150 && v.explanation.startsWith("完全不是") && eq(v.evidence, []) && eq(v.fixes, []), "insufficient/150", v);
}
{
  const v = validateDisambiguateOutput("好的，结果如下：\n```json\n" + J({ ...base0, explanation: "含 } 花括号 {x}" }) + "\n```\n以上。", O);
  check("E2 代码围栏 + 前后废话 + 字符串内花括号", v.verdict === "missing-qualifier" && v.explanation === "含 } 花括号 {x}", "parsed", v);
}
{
  const v = validateDisambiguateOutput("前面有 {不是json} 然后 " + J(base0), O);
  check("E3 先出现的无效花括号块被跳过", v.verdict === "missing-qualifier", "missing-qualifier", v.verdict);
}
is("E4 verdict 非枚举 → insufficient", validateDisambiguateOutput(J({ ...base0, verdict: "weird" }), O).verdict, "insufficient");
is("E5 verdict=manual 模型不得给 → insufficient", validateDisambiguateOutput(J({ ...base0, verdict: "manual" }), O).verdict, "insufficient");
is("E6 单卡 duplicate → insufficient", validateDisambiguateOutput(J({ ...base0, verdict: "duplicate" }), { ...O, hasB: false, current: { A: cur.A, B: null } }).verdict, "insufficient");
is("E7 单卡 confusable → insufficient", validateDisambiguateOutput(J({ ...base0, verdict: "confusable" }), { ...O, hasB: false, current: { A: cur.A, B: null } }).verdict, "insufficient");
is("E8 单卡 no-conflict 允许", validateDisambiguateOutput(J({ ...base0, verdict: "no-conflict" }), { ...O, hasB: false, current: { A: cur.A, B: null } }).verdict, "no-conflict");
{
  const v = validateDisambiguateOutput(J({ ...base0, evidence: [
    { card: "A", quote: "卡A 的 原文" },        // 空白归一后是子串
    { card: "A", quote: "编造的话" },            // 非子串
    { card: "B", quote: "卡B原文" },
    { card: "C", quote: "x" },                   // card 非法
    { card: "A" },                               // 无 quote
    { card: "A", quote: "   " }                  // 空 quote
  ] }), O);
  is("E9 evidence：空白归一子串 verified，不匹配 verified:false 但保留，非法丢弃",
    v.evidence, [{ card: "A", quote: "卡A 的 原文", verified: true }, { card: "A", quote: "编造的话", verified: false }, { card: "B", quote: "卡B原文", verified: true }]);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, evidence: [{ card: "A", quote: "卡A" }, { card: "B", quote: "卡B原文" }] }), { ...O, originA: null, originB: "" });
  is("E10 原文缺失（null/空串）→ 一律 verified:false", v.evidence.map((e) => e.verified), [false, false]);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, evidence: [{ card: "A", quote: "卡A" }, { card: "B", quote: "卡B" }] }), { ...O, hasB: false, current: { A: cur.A, B: null } });
  is("E11 单卡模式 evidence 的 B 丢弃", v.evidence.map((e) => e.card), ["A"]);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, fixes: [
    { card: "A", field: "front", after: "据桑德尔，问A" },     // 保留
    { card: "B", field: "contextPrefix", after: "实然：" },     // 保留
    { card: "A", field: "note", after: "x" },                    // field 非枚举
    { card: "C", field: "front", after: "x" },                   // card 非枚举
    { card: "A", field: "back", after: "" },                     // 空
    { card: "A", field: "back", after: "   " },                  // 全空白
    { card: "A", field: "back", after: "长".repeat(501) },       // >500
    { card: "A", field: "back", after: "答A" },                  // 与当前值相同
    { card: "B", field: "front", after: " 问B " },               // trim 后与当前值相同
    { card: "A", field: "front", after: 123 }                    // 非字符串
  ] }), O);
  is("E12 fixes 逐条丢弃规则", v.fixes, [{ card: "A", field: "front", after: "据桑德尔，问A" }, { card: "B", field: "contextPrefix", after: "实然：" }]);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, fixes: [{ card: "A", field: "back", after: "长".repeat(500) }] }), O);
  is("E13 after 恰好 500 字保留", v.fixes.length, 1);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, fixes: [{ card: "B", field: "front", after: "新B" }, { card: "A", field: "front", after: "新A" }] }), { ...O, hasB: false, current: { A: cur.A, B: null } });
  is("E14 单卡模式 fixes 只留 A", v.fixes, [{ card: "A", field: "front", after: "新A" }]);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, fixes: [{ card: "A", field: "front", after: "新A" }] }), { ...O, current: { A: { front: "旧" }, B: null } });
  is("E15 current 缺字段不崩（视为不同）", v.fixes.length, 1);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "one-wrong" }), O);
  check("E16 one-wrong 无 wrongCard → insufficient", v.verdict === "insufficient" && v.wrongCard === null, "insufficient", v);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "one-wrong", wrongCard: "Z" }), O);
  is("E17 one-wrong wrongCard 非枚举 → null → insufficient", v.verdict, "insufficient");
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "one-wrong", wrongCard: "B", fixes: [{ card: "B", field: "back", after: "新答案B" }] }), O);
  check("E18 one-wrong + wrongCard=B 保留 fixes", v.verdict === "one-wrong" && v.wrongCard === "B" && v.fixes.length === 1, "one-wrong/B/1", v);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "one-wrong", wrongCard: "B" }), { ...O, hasB: false, current: { A: cur.A, B: null } });
  is("E19 单卡 wrongCard=B 无效 → null → insufficient", v.verdict, "insufficient");
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "duplicate" }), O);
  check("E20 duplicate 无 keepCard → 默认 A", v.verdict === "duplicate" && v.keepCard === "A", "A", v);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "duplicate", keepCard: "B" }), O);
  is("E21 duplicate keepCard=B 保留", v.keepCard, "B");
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "duplicate", keepCard: "X" }), O);
  is("E22 keepCard 非枚举 → 默认 A", v.keepCard, "A");
}
{
  const v = validateDisambiguateOutput(J({ ...base0, explanation: "字".repeat(400) }), O);
  is("E23 explanation 截断 150", v.explanation.length, 150);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, explanation: 42 }), O);
  is("E24 explanation 非字符串 → 空串", v.explanation, "");
}
{
  const v = validateDisambiguateOutput(J({ ...base0, verdict: "no-conflict", fixes: [{ card: "A", field: "front", after: "新A" }] }), O);
  is("E25 no-conflict/confusable/insufficient 不带 fixes", v.fixes, []);
}
{
  const v = validateDisambiguateOutput(J({ ...base0, wrongCard: "A", keepCard: "B" }), O);
  is("E26 返回结构字段齐全", Object.keys(v), ["verdict", "explanation", "evidence", "fixes", "wrongCard", "keepCard"]);
}
is("E27 raw 为 null 不崩", validateDisambiguateOutput(null, O).verdict, "insufficient");
is("E28 JSON 为数组而非对象 → insufficient", validateDisambiguateOutput("[1,2]", O).verdict, "insufficient");

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
