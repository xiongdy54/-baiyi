// @runtime: node
// 运行：node tests/lm-recommend.test.cjs
// D124 §13.4：lmRecommend 用例（手写快照 fixture 覆盖提议 / 权重 / 生成器 / 打分 / 选取 / 理由 / 确定性）
const assert = require("node:assert");
const path = require("node:path");
const lmRecommend = require(path.join(__dirname, "..", "electron", "lmRecommend.js"));
const lmStrings = require(path.join(__dirname, "..", "electron", "lmStrings.js"));

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label);
  n++;
}

const DAY = 86400000;
const NOW = 1800000000000;

// 通用小工厂：一个 concept 轨道 + 1 份材料 + 单元
function kp(id, p = {}) {
  return {
    id,
    label: p.label || id,
    domainId: p.domainId || "57",
    level: p.level ?? 0,
    score: p.score ?? 0,
    fading: p.fading ?? false,
    metrics: p.metrics || { n: 0, meanR: 0, stableRatio: 0, longRatio: 0, lapses30Total: 0, types: [], hasDeep: false, distinctDays: 0, totalReviews: 0, extractCount: 0, passedUnitCount: 0 },
    prereqIds: p.prereqIds || [],
    relations: p.relations || [],
    cardMaterialIds: p.cardMaterialIds || [],
    dueToday: p.dueToday ?? false,
    lastReviewAt: p.lastReviewAt ?? 0,
    firstSourceCard: p.firstSourceCard ?? null,
    hasApplicationCard: p.hasApplicationCard ?? false,
    hasAICard: p.hasAICard ?? false
  };
}
function unit(id, libraryItemId, ord, p = {}) {
  return {
    id,
    libraryItemId,
    documentId: `doc-${libraryItemId}`,
    ord,
    title: p.title || `Unit ${ord}`,
    headText: p.headText || `head ${ord} of ${libraryItemId}`,
    plainLen: p.plainLen ?? 2000,
    isExercise: p.isExercise ?? 0,
    mdFrom: ord * 3000,
    mdTo: (ord + 1) * 3000,
    pageFrom: null,
    pageTo: null,
    docLen: p.docLen ?? 6000,
    passes: p.passes || [],
    kpLinks: p.kpLinks || [],
    coverage: p.coverage,
    learningCount: p.learningCount ?? 0,
    easeFit: p.easeFit,
    lang: p.lang || ""
  };
}
function material(id, p = {}) {
  return {
    id,
    title: p.title || `Book ${id}`,
    lang: p.lang || "",
    priority: p.priority ?? 50,
    sourceType: "markdown",
    dominantUdc: p.dominantUdc ?? null,
    lexicalUdcCounts: p.lexicalUdcCounts || {},
    lastPassAt: p.lastPassAt ?? null
  };
}
function baseSnapshot(p = {}) {
  return {
    now: NOW,
    settings: { nativeLangs: p.nativeLangs || ["zh"], recCount: p.recCount ?? 6, locale: p.locale || "zh" },
    tracks: p.tracks || [],
    proposals: p.proposals,
    overrides: p.overrides || [],
    materials: p.materials || [],
    units: p.units || [],
    kps: p.kps || [],
    extracts: p.extracts || [],
    lexStats: p.lexStats || {},
    activity: p.activity || {},
    feedback: p.feedback || [],
    lastRun: p.lastRun ?? null,
    events: p.events || [],
    cardUdcCounts: p.cardUdcCounts || {},
    extractOpTimes: p.extractOpTimes || {},
    newCards: p.newCards || [],
    recentRunKeys: p.recentRunKeys || [],
    udcLabels: p.udcLabels || {}
  };
}
const conceptTrack = (id, p = {}) => ({
  id,
  label: p.label || id,
  mode: "concept",
  lang: "",
  udcCodes: p.udcCodes || ["57"],
  status: p.status || "active",
  pinned: p.pinned ?? false,
  priority: p.priority ?? 3,
  source: "user"
});
const langTrack = (id, lang, p = {}) => ({
  id,
  label: p.label || id,
  mode: "language",
  lang,
  udcCodes: [],
  status: p.status || "active",
  pinned: p.pinned ?? false,
  priority: p.priority ?? 3,
  source: "user"
});

// 1. 没有落库轨道 → usingProposals=true，提议恰好 1 个 language(en) + 1 个 concept(udc 57)
{
  const snap = baseSnapshot({
    materials: [material("men", { lang: "en", title: "English Book" }), material("mzh", { lang: "zh", dominantUdc: "57", title: "Chinese Book" })],
    cardUdcCounts: { "57": 5 }
  });
  const r = lmRecommend.recommend(snap);
  eq(r.usingProposals, true, "无落库轨道 → usingProposals");
  eq(r.proposals.length, 2, "提议恰好 2 个");
  eq(r.proposals[0].key, "lang:en", "提议 1：language en");
  eq(r.proposals[0].mode, "language", "提议 1 mode");
  eq(r.proposals[1].key, "udc:57", "提议 2：udc 57");
  eq(r.proposals[1].mode, "concept", "udc 57 默认 concept（设计稿 §3.1）");
}

// 2. 轨道权重：活跃度 3:1 → 0.75/0.25；pinned → max(0.25, 0.3)=0.3，归一化后 ≈0.2857
{
  const t1 = { id: "t1", status: "active", pinned: false, priority: 3 };
  const t2 = { id: "t2", status: "active", pinned: false, priority: 3 };
  let w = lmRecommend.trackWeights([t1, t2], { t1: [3], t2: [1], __unassigned: [] });
  ok(Math.abs(w.weights.t1 - 0.75) < 1e-9 && Math.abs(w.weights.t2 - 0.25) < 1e-9, "权重 0.75/0.25");
  const t2p = { ...t2, pinned: true };
  w = lmRecommend.trackWeights([t1, t2p], { t1: [3], t2: [1] });
  ok(w.weights.t2 >= 0.28, `pinned 后 t2 权重 ≥ 0.28（实际 ${w.weights.t2}）`);
}

// 3. paused 轨道不出任何推荐
{
  const snap = baseSnapshot({
    tracks: [conceptTrack("tp", { status: "paused" })],
    materials: [material("m1", { dominantUdc: "57" })],
    units: [unit("m1-u0", "m1", 0, { passes: [NOW - 2 * DAY] }), unit("m1-u1", "m1", 1)]
  });
  const r = lmRecommend.recommend(snap);
  ok(r.items.every((it) => it.trackId !== "tp"), "paused 轨道无推荐");
}

// 4. concept 续读：下一单元先修 KP score=0.2 → 不出 K1，改出 K5（该 KP 有卡）
{
  const snap = baseSnapshot({
    tracks: [conceptTrack("tc")],
    materials: [material("m1", { dominantUdc: "57" })],
    units: [unit("m1-u0", "m1", 0, { passes: [NOW - 2 * DAY] }), unit("m1-u1", "m1", 1, { title: "Next Section", kpLinks: [{ kpId: "kB", weight: 1 }] })],
    kps: [
      kp("kB", { level: 2, score: 0.5, prereqIds: ["kA"], lastReviewAt: NOW - DAY, metrics: { n: 2, meanR: 0.9, stableRatio: 1, longRatio: 0.5, lapses30Total: 0, types: ["qa"], hasDeep: false, distinctDays: 2, totalReviews: 4, extractCount: 0, passedUnitCount: 1 } }),
      kp("kA", { level: 1, score: 0.2, lastReviewAt: NOW - 10 * DAY, metrics: { n: 1, meanR: 0.5, stableRatio: 0, longRatio: 0, lapses30Total: 0, types: ["qa"], hasDeep: false, distinctDays: 1, totalReviews: 2, extractCount: 0, passedUnitCount: 0 } })
    ]
  });
  const r = lmRecommend.recommend(snap);
  ok(!r.items.some((it) => it.kind === "continue" && it.libraryItemId === "m1"), "readiness<0.4 不出 K1");
  ok(r.items.some((it) => it.kind === "reinforce" && it.kpId === "kA"), "改出 K5 reinforce（kA 有卡）");
}

// 5. language：coverage 0.85 → 不出 K1/K2；coverage 0.96 → 出 K1 且理由含「最适合」
{
  const mk = (cov) =>
    baseSnapshot({
      tracks: [langTrack("tl", "en")],
      materials: [material("m2", { lang: "en" })],
      units: [unit("m2-u0", "m2", 0, { passes: [NOW - 2 * DAY] }), unit("m2-u1", "m2", 1, { title: "Next", coverage: cov, learningCount: 4 })]
    });
  const rLow = lmRecommend.recommend(mk(0.85));
  ok(!rLow.items.some((it) => (it.kind === "continue" || it.kind === "start") && it.libraryItemId === "m2"), "coverage 0.85（hard）被过滤");
  const rHigh = lmRecommend.recommend(mk(0.96));
  const cont = rHigh.items.find((it) => it.kind === "continue" && it.libraryItemId === "m2");
  ok(Boolean(cont), "coverage 0.96 出 K1");
  ok(cont && cont.reason.includes("最适合"), "理由含覆盖带名「最适合」");
}

// 6. K14：已知词 < 200 且无快测 → 结果第一项是 placement
{
  const snap = baseSnapshot({
    tracks: [langTrack("tl", "en")],
    materials: [material("m3", { lang: "en" })],
    units: [unit("m3-u0", "m3", 0)],
    lexStats: { en: { knownCount: 100, totalLexemes: 500, hasPlacement: false, learningTop: [], mineCount: 0 } }
  });
  const r = lmRecommend.recommend(snap);
  ok(r.items.length > 0 && r.items[0].kind === "placement", "placement 置顶");
}

// 7. 多样性：同一 kind ≤ 2；同一材料 ≤ 2
{
  const mats = ["a1", "a2", "a3"].map((id) => material(id, { dominantUdc: "57", title: `Book ${id}` }));
  const units = mats.flatMap((m, i) => [unit(`${m.id}-u0`, m.id, 0, { passes: [NOW - DAY - i * 1000] }), unit(`${m.id}-u1`, m.id, 1)]);
  const snap = baseSnapshot({ tracks: [conceptTrack("tc")], materials: mats, units });
  const r = lmRecommend.recommend(snap);
  const byKind = {};
  const byMat = {};
  for (const it of r.items) {
    byKind[it.kind] = (byKind[it.kind] || 0) + 1;
    if (it.libraryItemId) byMat[it.libraryItemId] = (byMat[it.libraryItemId] || 0) + 1;
  }
  for (const k of Object.keys(byKind)) ok(byKind[k] <= 2, `kind ${k} ≤ 2`);
  for (const k of Object.keys(byMat)) ok(byMat[k] <= 2, `material ${k} ≤ 2`);
}

// 8. 冷却：最近 1 天有 snooze 的 key 不出现；4 天前的 snooze 不影响
{
  const mk = (fb) =>
    baseSnapshot({
      tracks: [conceptTrack("tc")],
      materials: [material("m1", { dominantUdc: "57" })],
      units: [unit("m1-u0", "m1", 0, { passes: [NOW - 2 * DAY] }), unit("m1-u1", "m1", 1)],
      feedback: fb
    });
  const r1 = lmRecommend.recommend(mk([{ itemKey: "continue:m1", kind: "continue", action: "snooze", ts: NOW - DAY }])); 
  ok(!r1.items.some((it) => it.key === "continue:m1"), "1 天内 snooze → 不出现");
  const r2 = lmRecommend.recommend(mk([{ itemKey: "continue:m1", kind: "continue", action: "snooze", ts: NOW - 4 * DAY }])); 
  ok(r2.items.some((it) => it.key === "continue:m1"), "4 天前 snooze → 出现");
}

// 9. not_interested 材料：60 天内该材料不出 K1/K2
{
  const snap = baseSnapshot({
    tracks: [conceptTrack("tc")],
    materials: [material("m1", { dominantUdc: "57" })],
    units: [unit("m1-u0", "m1", 0, { passes: [NOW - 2 * DAY] }), unit("m1-u1", "m1", 1)],
    feedback: [{ itemKey: "continue:m1", kind: "continue", libraryItemId: "m1", action: "not_interested", ts: NOW - 10 * DAY }]
  });
  const r = lmRecommend.recommend(snap);
  ok(!r.items.some((it) => (it.kind === "continue" || it.kind === "start") && it.libraryItemId === "m1"), "not_interested 材料 60 天内无 K1/K2");
}

// 10 / 11 / 11a 的公共 fixture（全 ASCII 用户文本，保证 en 断言无汉字）
function richFixture(locale) {
  return baseSnapshot({
    locale,
    tracks: [
      conceptTrack("tc"),
      langTrack("tl", "en")
    ],
    materials: [
      material("m1", { dominantUdc: "57", title: "Thinking Book" }),
      material("m2", { lang: "en", title: "Easy English" })
    ],
    units: [
      unit("m1-u0", "m1", 0, { passes: [NOW - 2 * DAY], title: "Basics" }),
      unit("m1-u1", "m1", 1, { title: "Next Topic", kpLinks: [{ kpId: "kB", weight: 1 }] }),
      unit("m2-u0", "m2", 0, { passes: [NOW - 3 * DAY], lang: "en" }),
      unit("m2-u1", "m2", 1, { title: "Chapter Two", coverage: 0.96, learningCount: 6, lang: "en" }),
      unit("m2-u2", "m2", 2, { title: "Chapter Three", coverage: 0.85, learningCount: 9, lang: "en", passes: [NOW - 2 * DAY, NOW - 10 * DAY] })
    ],
    kps: [
      kp("kB", { level: 2, score: 0.5, lastReviewAt: NOW - DAY, label: "Derivative", metrics: { n: 2, meanR: 0.9, stableRatio: 1, longRatio: 0.5, lapses30Total: 0, types: ["qa"], hasDeep: false, distinctDays: 2, totalReviews: 4, extractCount: 0, passedUnitCount: 1 } }),
      kp("kC", { level: 3, score: 0.75, lastReviewAt: NOW - DAY, label: "Limit", relations: [{ otherId: "kB", type: "prerequisite" }], metrics: { n: 3, meanR: 0.92, stableRatio: 1, longRatio: 0.67, lapses30Total: 0, types: ["qa", "cloze"], hasDeep: false, distinctDays: 3, totalReviews: 8, extractCount: 0, passedUnitCount: 2 } })
    ],
    extracts: [
      { id: "e1", libraryItemId: "m1", documentId: "doc-m1", status: "reading", priority: 40, topicNextAt: NOW - 3 * DAY, processCount: 3, hasCard: false, snippet: "first pending extract text", anchor: { anchorText: "first pending extract text" } }
    ],
    lexStats: { en: { knownCount: 800, totalLexemes: 1200, hasPlacement: true, learningTop: [{ key: "wander", sample: "wander", lastLookupAt: NOW - DAY, totalCount: 5, unitCount: 3 }], mineCount: 4 } },
    activity: { tc: [2, 1], tl: [1] }
  });
}

// 10. 理由无编造数字：每个数字都在 facts 值中
{
  const r = lmRecommend.recommend(richFixture("zh"));
  ok(r.items.length > 0, "rich fixture 有推荐");
  for (const it of r.items) {
    const nums = String(it.reason).match(/\d+(\.\d+)?/g) || [];
    const hay = Object.values(it.facts || {}).map(String).join(" ");
    for (const num of nums) {
      ok(hay.includes(num), `理由数字 ${num}（${it.kind}）能在 facts 中找到`);
    }
  }
}

// 11. 确定性：同一快照跑两次结果完全相同
{
  const snap = richFixture("zh");
  const a = lmRecommend.recommend(snap);
  const b = lmRecommend.recommend(JSON.parse(JSON.stringify(snap)));
  eq(JSON.stringify(a.items), JSON.stringify(b.items), "同快照两次结果一致");
}

// 11a. 字符串表键一致；locale=en 理由无汉字；数字断言仍成立
{
  const keysOf = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, `${pre}${k}.`) : [`${pre}${k}`]));
  eq(JSON.stringify(keysOf(lmStrings.zh).sort()), JSON.stringify(keysOf(lmStrings.en).sort()), "zh/en 键集合一致");
  const r = lmRecommend.recommend(richFixture("en"));
  for (const it of r.items) {
    ok(!/\p{Script=Han}/u.test(it.reason), `en 理由无汉字（${it.kind}）`);
    const nums = String(it.reason).match(/\d+(\.\d+)?/g) || [];
    const hay = Object.values(it.facts || {}).map(String).join(" ");
    for (const num of nums) ok(hay.includes(num), `en 理由数字 ${num} 在 facts 中`);
  }
}

// 11b. 母语：nativeLangs=["ja"] → 提议 zh 不提议 ja；nativeLangs=[] → 两本都提议
{
  const mats = [material("mz", { lang: "zh", title: "Z Book" }), material("mj", { lang: "ja", title: "J Book" })];
  const r1 = lmRecommend.recommend(baseSnapshot({ nativeLangs: ["ja"], materials: mats }));
  ok(r1.proposals.some((p) => p.key === "lang:zh"), "提议 zh");
  ok(!r1.proposals.some((p) => p.key === "lang:ja"), "母语 ja 不提议");
  const r2 = lmRecommend.recommend(baseSnapshot({ nativeLangs: [], materials: mats }));
  ok(r2.proposals.some((p) => p.key === "lang:zh") && r2.proposals.some((p) => p.key === "lang:ja"), "母语生效值为空 → 两本都提议");
}

// 12. 自动完成：lastRun 中 continue 项的目标单元在展示后有通读 → autoDone 包含其 key
{
  const snap = richFixture("zh");
  snap.lastRun = {
    id: "run1",
    createdAt: NOW - DAY,
    items: [{ key: "continue:m1", kind: "continue", trackId: "tc", libraryItemId: "m1", unitId: "m1-u1" }]
  };
  const u1 = snap.units.find((u) => u.id === "m1-u1");
  u1.passes = [NOW - 3600 * 1000]; // 展示之后发生通读
  const r = lmRecommend.recommend(snap);
  ok(r.autoDone.some((d) => d.itemKey === "continue:m1" && d.kind === "continue"), "autoDone 包含 continue:m1");
}

console.log(`${n} passed`);
