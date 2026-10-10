// @runtime: node
// 运行：node tests/lm-levels.test.cjs
// D124 §13.3：lmLevels 用例（retrievability / KP 等级 / 词项状态 / computePasses）
const assert = require("node:assert");
const path = require("node:path");
const lmLevels = require(path.join(__dirname, "..", "electron", "lmLevels.js"));
const lmParams = require(path.join(__dirname, "..", "electron", "lmParams.js"));

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label);
  n++;
}

// 1. retrievability（§6.3 验算，误差 < 1e-9）
ok(Math.abs(lmLevels.retrievability(0, 10, 0.5) - 1) < 1e-9, "R(0,10,0.5)=1");
ok(Math.abs(lmLevels.retrievability(10, 10, 0.5) - 0.9) < 1e-9, "R(10,10,0.5)=0.9");
ok(Math.abs(lmLevels.retrievability(10, 10, 0.1542) - 0.9) < 1e-9, "R(10,10,0.1542)=0.9");
eq(lmLevels.retrievability(10, 0, 0.5), 0, "stability=0 → 0");

// 2. KP 等级
const card = (p) => ({
  cardType: p.cardType || "qa",
  reviewed: p.reviewed !== false,
  R: p.R ?? 0,
  S: p.S ?? 0,
  lapses30: p.lapses30 ?? 0,
  lastRating: p.lastRating ?? 0,
  reviewDays: p.reviewDays || new Set(),
  reviewCount: p.reviewCount ?? 0
});
const day = (s) => s;
eq(lmLevels.computeKpLevel({ cards: [], extractCount: 0, passedUnitCount: 0 }).level, 0, "L0：无任何证据");
eq(lmLevels.computeKpLevel({ cards: [], extractCount: 1, passedUnitCount: 0 }).level, 1, "L1：只有摘录");
eq(lmLevels.computeKpLevel({ cards: [card({ reviewed: false })], extractCount: 0, passedUnitCount: 0 }).level, 1, "L1：未复习的卡");
eq(lmLevels.computeKpLevel({ cards: [card({ R: 0.7 })], extractCount: 0, passedUnitCount: 0 }).level, 2, "L2：已复习 R=0.7");
eq(
  lmLevels.computeKpLevel({ cards: [card({ R: 0.9, S: 30 }), card({ R: 0.88, S: 25 })], extractCount: 0, passedUnitCount: 0 }).level,
  3,
  "L3：双卡 meanR=0.89 stableRatio=1"
);
eq(
  lmLevels.computeKpLevel({
    cards: [card({ R: 0.95, S: 90, cardType: "qa" }), card({ R: 0.95, S: 90, cardType: "cloze" }), card({ R: 0.95, S: 90, cardType: "qa" })],
    extractCount: 0,
    passedUnitCount: 0
  }).level,
  4,
  "L4：n≥3 且类型 ≥2"
);
eq(
  lmLevels.computeKpLevel({
    cards: [card({ R: 0.95, S: 90 }), card({ R: 0.95, S: 90 }), card({ R: 0.95, S: 90 })],
    extractCount: 0,
    passedUnitCount: 0,
    selfExplainClear90: 0
  }).level,
  3,
  "L3：全 qa 无应用卡无自我解释（不满足深度条件）"
);
eq(
  lmLevels.computeKpLevel({
    cards: [card({ R: 0.95, S: 90 }), card({ R: 0.95, S: 90 }), card({ R: 0.95, S: 90 })],
    extractCount: 0,
    passedUnitCount: 0,
    selfExplainClear90: 1
  }).level,
  4,
  "L4：自我解释补深度条件"
);
const fading = lmLevels.computeKpLevel({ cards: [card({ R: 0.6, S: 40 }), card({ R: 0.7, S: 40 })], extractCount: 0, passedUnitCount: 0 });
eq(fading.level, 2, "fading 例：L2");
eq(fading.fading, true, "fading 例：fading=1");
const high = lmLevels.computeKpLevel({
  cards: [card({ R: 0.9, S: 30, reviewDays: new Set([day("2026-10-01")]), reviewCount: 2 }), card({ R: 0.9, S: 30, reviewDays: new Set([day("2026-10-02")]), reviewCount: 2 }), card({ R: 0.9, S: 30, reviewDays: new Set([day("2026-10-03")]), reviewCount: 2 })]
});
eq(high.confidence, "high", "confidence high：3 卡 6 次 3 日");
eq(
  lmLevels.computeKpLevel({ cards: [card({ R: 0.9, S: 30, reviewCount: 3, reviewDays: new Set([day("2026-10-01")]) })] }).confidence,
  "medium",
  "confidence medium：1 卡 3 次"
);
eq(
  lmLevels.computeKpLevel({ cards: [card({ R: 0.9, S: 30, reviewCount: 1 })] }).confidence,
  "low",
  "confidence low：1 卡 1 次"
);

// 3. 词项状态（每条规则至少 1 正例 + 「标记后又查词 → 不走规则 1」反例）
const DAY = lmParams.DAY_MS;
const now = 1760000000000;
function lexState(p) {
  return lmLevels.computeLexState({ now, ...p });
}
eq(lexState({ lastMark: { mark: "known", ts: now - DAY } }).state, "known", "规则1 mark known");
eq(lexState({ lastMark: { mark: "unknown", ts: now - DAY } }).state, "learning", "规则1 mark unknown");
eq(lexState({ lastMark: { mark: "known", ts: now - 30 * DAY }, lookupTimes: [now - 40 * DAY] }).state, "known", "规则1：查词早于标记仍走 mark");
eq(lexState({ lastMark: { mark: "known", ts: now - 40 * DAY }, lookupTimes: [now - DAY] }).state, "learning", "反例：标记后又查词 → 不走规则1（走规则3 learning）");
eq(lexState({ card: { R: 0.9, S: 30 } }).state, "known", "规则2 card known");
eq(lexState({ card: { R: 0.5, S: 5 } }).state, "learning", "规则2 card learning");
eq(lexState({ lookupTimes: [now - 20 * DAY], passesAfterLastLookup: 6 }).state, "familiar", "规则3 lookup familiar");
eq(lexState({ lookupTimes: [now - 2 * DAY], passesAfterLastLookup: 1 }).state, "learning", "规则3 lookup learning");
eq(lexState({ placementKnown: true }).state, "known", "规则4 placement");
eq(lexState({ exposurePasses: 3, exposureTokens: 8 }).state, "familiar", "规则5 exposure");
eq(lexState({ exposurePasses: 1, exposureTokens: 2 }).state, "seen", "规则6 seen");
eq(lexState({}).state, "unknown", "规则7 none");

// 4. computePasses（全部 docLen=3000，单元 [0,1000)[1000,2000)[2000,3000)，事件间隔 1 分钟）
const UNITS3 = [
  { id: "u0", mdTo: 1000 },
  { id: "u1", mdTo: 2000 },
  { id: "u2", mdTo: 3000 }
];
const T0 = 1760000000000;
const ev = (pos, i) => ({ char_pos: pos, created_at: T0 + i * 60000 });
let m = lmLevels.computePasses([ev(0, 0), ev(900, 1), ev(1500, 2), ev(2600, 3)], UNITS3, 3000);
eq(m.get("u0")?.length, 1, "用例1：u0 一次通读");
eq(m.get("u1")?.length, 1, "用例1：u1 一次通读");
eq(m.get("u2")?.length ?? 0, 0, "用例1：u2 无通读");
m = lmLevels.computePasses([ev(0, 0), ev(900, 1), ev(1500, 2), ev(2600, 3), ev(2950, 4)], UNITS3, 3000);
eq(m.get("u2")?.length, 1, "用例2：末尾规则记 u2");
m = lmLevels.computePasses([ev(0, 0), ev(25000, 1)], UNITS3, 3000);
eq(m.size, 0, "用例3：char_pos > docLen 丢弃");
m = lmLevels.computePasses([ev(0, 0), ev(25000, 1)], [{ id: "u0", mdTo: 1000 }, { id: "u1", mdTo: 2000 }, { id: "u2", mdTo: 3000 }, { id: "u3", mdTo: 50000 }], 50000);
eq(m.size, 0, "用例4：步长 > JUMP_CHARS 跳过");
m = lmLevels.computePasses([ev(0, 0), ev(1500, 1), ev(0, 2 + 60), ev(1500, 3 + 60)], UNITS3, 3000);
// 第二个 session 从 index 2 起（间隔 60 分钟 > 30 分钟）
eq(m.get("u0")?.length, 2, "用例5：两个 session 各记一次");
m = lmLevels.computePasses([ev(1500, 0), ev(200, 1), ev(1200, 2)], UNITS3, 3000);
eq(m.get("u0")?.length, 1, "用例6：往回翻后前进仍记一次");
m = lmLevels.computePasses([ev(0, 0), ev(1500, 1), ev(200, 2), ev(1500, 3)], UNITS3, 3000);
eq(m.get("u0")?.length, 1, "用例7：同 session 重复跨过只记一次");

// mergePassTimestamps（去重、升序、保留最后 20 个）
const merged = lmLevels.mergePassTimestamps([5, 3, 3, 9], [7, 1]);
eq(JSON.stringify(merged), JSON.stringify([1, 3, 5, 7, 9]), "合并去重升序");
ok(lmLevels.mergePassTimestamps(Array.from({ length: 25 }, (_, i) => i + 1), []).length === 20, "保留最后 20 个");

console.log(`${n} passed`);
