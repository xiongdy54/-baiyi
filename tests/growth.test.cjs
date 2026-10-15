// M13 GF-1 成长反馈——记忆层纯函数口径矩阵（node 直跑，A2 产出）
// @runtime: node
// 运行：node tests/growth.test.cjs
// 依据：docs/design/GROWTH-FEEDBACK-D129.md §3.2（判定口径唯一居所 electron/growth.js）+ §6.1（断言清单 P-1…P-14）。
// 覆盖：首次语义 / 撤销回退 / 重评再触发 / 取消项 / relearning-recovery / leech-recovery / retention 双档 /
//       group 门槛与双键 / material 样本门槛与两档两维 / pickTopEvent 序 / foldSameDay / isConsolidated /
//       territory 聚合 / 纯度（同输入全等 + 零时钟零随机）。
// 测试内零网络零库：全部夹具为手工构造的证据行（形状见 electron/growth.js 文件头）。
"use strict";
const path = require("path");
const growth = require(path.join(__dirname, "..", "electron", "growth.js"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = 1_700_000_000_000; // 固定 now：纯函数不读时钟，全部注入

// ---- 夹具工厂（electron/growth.js 文件头的证据行形状）----
let seqCounter = 0;
function log(partial) {
  seqCounter += 1;
  return {
    reviewSeq: partial.reviewSeq ?? seqCounter,
    reviewedAt: partial.reviewedAt ?? NOW + seqCounter * 1000,
    before: partial.before ?? null,
    after: partial.after ?? null,
    leechBefore: partial.leechBefore ?? null
  };
}
function card(partial) {
  return {
    id: partial.id ?? `card-${++seqCounter}`,
    frontMarkdown: partial.frontMarkdown ?? "问",
    noteText: partial.noteText ?? "",
    siblingKey: partial.siblingKey ?? null,
    knowledgePointId: partial.knowledgePointId ?? null,
    libraryItemId: partial.libraryItemId ?? null,
    docTitle: partial.docTitle ?? null,
    domain: partial.domain ?? null,
    fsrs: partial.fsrs ?? null,
    leech: partial.leech ?? null,
    status: partial.status ?? null,
    contextRef: partial.contextRef ?? null,
    logs: partial.logs ?? []
  };
}
const fsrsOf = (state, stability) => ({ state, stability, due: NOW, lapses: 0, difficulty: 5, reps: 3, lastReview: NOW });
// 手工命中（pickTopEvent / foldSameDay 用；形状同 §3.1 GrowthEventHit）
function hit(type, entityId, extra) {
  const tier = growth.TIER_BY_TYPE[type];
  const dimension = extra?.dimension ?? "d";
  return {
    key: `${type}:${entityId}:${dimension}`,
    type, tier,
    entityId, entityLabel: extra?.entityLabel ?? "",
    dimension,
    triggerSeq: extra?.triggerSeq ?? 1,
    triggerAt: extra?.triggerAt ?? NOW,
    surface: [...growth.SURFACE_BY_TYPE[type]],
    evidence: extra?.evidence ?? {}
  };
}

// ---------------------------------------------------------------- P-1
console.log("== P-1 首次语义：[60,60,180] 档上只在跨档日志报一次，triggerSeq=跨档那条（§6.1） ==");
{
  const c = card({ id: "p1-card", logs: [
    log({ reviewSeq: 1, after: fsrsOf("review", 60) }),
    log({ reviewSeq: 2, after: fsrsOf("review", 60) }),
    log({ reviewSeq: 3, after: fsrsOf("review", 180) })
  ] });
  const hits = growth.deriveCardEvents(c, c.logs, NOW);
  const r60 = hits.filter((h) => h.type === "retention-60");
  const r180 = hits.filter((h) => h.type === "retention-180");
  check("retention-60 只在首次 ≥60 的日志报一次（seq=1）", r60.length === 1 && r60[0].triggerSeq === 1, { n: 1, seq: 1 }, { n: r60.length, seq: r60[0] && r60[0].triggerSeq });
  check("retention-180 只在跨档日志报一次（seq=3）", r180.length === 1 && r180[0].triggerSeq === 3, { n: 1, seq: 3 }, { n: r180.length, seq: r180[0] && r180[0].triggerSeq });
  check("60→60 未跨档不重复报", r60.every((h) => h.triggerSeq !== 2), true, r60.map((h) => h.triggerSeq));
  check("dimension 机读值：60 档=「60」/ 180 档=「180」", r60[0].dimension === "60" && r180[0].dimension === "180", ["60", "180"], [r60[0].dimension, r180[0].dimension]);
}

// ---------------------------------------------------------------- P-2
console.log("== P-2 撤销回退：删掉跨档日志重算 → retention-180 消失、retention-60 仍在（§4.17-6② 静默） ==");
{
  const c = card({ id: "p2-card", logs: [
    log({ reviewSeq: 1, after: fsrsOf("review", 60) }),
    log({ reviewSeq: 2, after: fsrsOf("review", 60) })
  ] });
  const hits = growth.deriveCardEvents(c, c.logs, NOW);
  check("跨档日志删除后 retention-180 命中消失", hits.every((h) => h.type !== "retention-180"), true, hits.map((h) => h.type));
  check("retention-60 命中仍在（静默回退，无「失去」事件）", hits.some((h) => h.type === "retention-60"), true, hits.map((h) => h.type));
}

// ---------------------------------------------------------------- P-3
console.log("== P-3 重评再触发：[180→回落30→180] 产生第二次命中，triggerSeq=最后一条（真实的重做） ==");
{
  const series = [
    { seq: 1, at: NOW + 1, value: 180 },
    { seq: 2, at: NOW + 2, value: 30 },
    { seq: 3, at: NOW + 3, value: 180 }
  ];
  const crossings = growth.firstCrossings(series, 180);
  check("回落再跨越产生两次命中", crossings.length === 2, 2, crossings.length);
  check("第二次命中 triggerSeq=最后一条", crossings[1].seq === 3, 3, crossings[1].seq);
  const c = card({ id: "p3-card", logs: series.map((p) => log({ reviewSeq: p.seq, after: fsrsOf("review", p.value) })) });
  const r180 = growth.deriveCardEvents(c, c.logs, NOW).filter((h) => h.type === "retention-180");
  check("deriveCardEvents 同语义：两条 retention-180，末条 triggerSeq=3", r180.length === 2 && r180[1].triggerSeq === 3, [1, 3], r180.map((h) => h.triggerSeq));
}

// ---------------------------------------------------------------- P-4
console.log("== P-4 取消项：学习步毕业不产事件；stability 首过 21 不产事件（§6.6.1 序 13/14，禁加回） ==");
{
  const grad = card({ id: "p4-a", logs: [
    log({ reviewSeq: 1, before: fsrsOf("learning", 1), after: fsrsOf("review", 3) }),
    log({ reviewSeq: 2, before: fsrsOf("review", 3), after: fsrsOf("review", 25) })
  ] });
  const hits = growth.deriveCardEvents(grad, grad.logs, NOW);
  check("学习步毕业（learning → review）不产任何事件", hits.length === 0, [], hits.map((h) => h.type));
  check("stability 首过 21（25）不产 consolidate-21d 类事件", hits.every((h) => !/consolidate/i.test(h.type)), true, hits.map((h) => h.type));
  check("取消项不是枚举成员", !growth.TYPE_ORDER.includes("consolidate-21d") && !growth.TYPE_ORDER.includes("learning-graduate"), true, growth.TYPE_ORDER);
  check("25 < 60 亦不误报 retention-60", hits.every((h) => h.type !== "retention-60"), true, hits.map((h) => h.type));
}

// ---------------------------------------------------------------- P-5
console.log("== P-5 relearning-recovery：relearning→review 命中一次；无快照旧日志不参与 ==");
{
  const c = card({ id: "p5-a", logs: [
    log({ reviewSeq: 1, before: null, after: null }),                                            // v22 前旧日志（缺快照）
    log({ reviewSeq: 2, before: fsrsOf("review", 10), after: fsrsOf("relearning", 2) }),         // 遗忘
    log({ reviewSeq: 3, before: fsrsOf("relearning", 2), after: fsrsOf("review", 12) })          // 康复
  ] });
  const hits = growth.deriveCardEvents(c, c.logs, NOW).filter((h) => h.type === "relearning-recovery");
  check("relearning→review 命中一次（seq=3）", hits.length === 1 && hits[0].triggerSeq === 3, { n: 1, seq: 3 }, { n: hits.length, seq: hits[0] && hits[0].triggerSeq });
  check("dimension=recovery", hits[0].dimension === "recovery", "recovery", hits[0].dimension);
  const old = card({ id: "p5-b", logs: [log({ reviewSeq: 1, before: null, after: null })] });
  check("无快照旧日志不参与判定（零命中）", growth.deriveCardEvents(old, old.logs, NOW).length === 0, [], growth.deriveCardEvents(old, old.logs, NOW).length);
  // D175（v49.1）：再次遗忘后的再度康复不重复计报——每卡仅首次（§4.17-6① 字面语义）
  const recurred = card({ id: "p5-c", logs: [
    log({ reviewSeq: 1, before: fsrsOf("review", 10), after: fsrsOf("relearning", 2) }),  // 遗忘①
    log({ reviewSeq: 2, before: fsrsOf("relearning", 2), after: fsrsOf("review", 12) }),  // 康复① → 报（seq=2）
    log({ reviewSeq: 3, before: fsrsOf("review", 12), after: fsrsOf("relearning", 2) }),  // 遗忘②
    log({ reviewSeq: 4, before: fsrsOf("relearning", 2), after: fsrsOf("review", 14) })   // 康复② → 不报
  ] });
  const recHits = growth.deriveCardEvents(recurred, recurred.logs, NOW).filter((h) => h.type === "relearning-recovery");
  check("再次遗忘后的再度康复不重复计报（仅 seq=2 首次）", recHits.length === 1 && recHits[0].triggerSeq === 2, { n: 1, seq: 2 }, { n: recHits.length, seq: recHits[0] && recHits[0].triggerSeq });
}

// ---------------------------------------------------------------- P-6
console.log("== P-6 leech-recovery：leech 历史 + 其后稳定 ≥21 首达命中；从未 leech 永不命中 ==");
{
  const leechSnap = { isLeech: true, lapses: 8, hitCount: 1 };
  const a = card({ id: "p6-a", leech: { isLeech: false, resolution: "resumed", resolvedAt: NOW }, logs: [
    log({ reviewSeq: 1, before: fsrsOf("review", 3), after: fsrsOf("review", 4), leechBefore: leechSnap }), // leech 标记
    log({ reviewSeq: 2, before: fsrsOf("review", 4), after: fsrsOf("review", 25) })                          // 消解后首次稳定
  ] });
  const hitsA = growth.deriveCardEvents(a, a.logs, NOW).filter((h) => h.type === "leech-recovery");
  check("leech 历史 + 其后 stability≥21 首达命中", hitsA.length === 1 && hitsA[0].triggerSeq === 2, { n: 1, seq: 2 }, { n: hitsA.length, seq: hitsA[0] && hitsA[0].triggerSeq });
  const b = card({ id: "p6-b", logs: [
    log({ reviewSeq: 1, before: fsrsOf("review", 3), after: fsrsOf("review", 4) }),
    log({ reviewSeq: 2, before: fsrsOf("review", 4), after: fsrsOf("review", 25) })
  ] });
  check("从未 leech 的卡永不命中", growth.deriveCardEvents(b, b.logs, NOW).every((h) => h.type !== "leech-recovery"), true, growth.deriveCardEvents(b, b.logs, NOW).map((h) => h.type));
  const c = card({ id: "p6-c", logs: [
    log({ reviewSeq: 1, before: fsrsOf("review", 3), after: fsrsOf("review", 4), leechBefore: leechSnap }),
    log({ reviewSeq: 2, before: fsrsOf("review", 4), after: fsrsOf("review", 20) }) // <21 不算稳定
  ] });
  check("其后未达 21 天阈值不命中", growth.deriveCardEvents(c, c.logs, NOW).every((h) => h.type !== "leech-recovery"), true, "无 leech-recovery");
}

// ---------------------------------------------------------------- P-7
console.log("== P-7 retention 双档同日：单条直越 180 → pickTop 只报 180，60 进 others（L3 不进 toast） ==");
{
  const c = card({ id: "p7-card", libraryItemId: "li-1", docTitle: "书", logs: [
    log({ reviewSeq: 1, before: fsrsOf("new", 0), after: fsrsOf("review", 200) })
  ] });
  const hits = growth.deriveCardEvents(c, c.logs, NOW);
  const { toast, others } = growth.pickTopEvent(hits);
  check("toast = retention-180（两档同跨取高档）", toast && toast.type === "retention-180", "retention-180", toast && toast.type);
  check("retention-60 进 others（不丢弃）", others.some((h) => h.type === "retention-60"), true, others.map((h) => h.type));
  check("L3 surface 不含 toast", growth.SURFACE_BY_TYPE["retention-60"].includes("toast") === false, false, growth.SURFACE_BY_TYPE["retention-60"]);
  check("证据链带 stabilityDays", toast.evidence.stabilityDays === 200, 200, toast.evidence.stabilityDays);
}

// ---------------------------------------------------------------- P-8
console.log("== P-8 group：组=2 全 review 命中；组=1 不命中；1 张 learning 不命中；sibling_key 与 knowledge_point_id 双键成立 ==");
{
  const mk = (id, key, state) => card({
    id, siblingKey: key, knowledgePointId: null,
    logs: [log({ after: fsrsOf(state, 10) })]
  });
  const g2 = [mk("g-a", "sg-1", "review"), mk("g-b", "sg-1", "review")];
  const h2 = growth.deriveGroupEvents(g2, NOW);
  check("组=2 卡全 review → 命中一次", h2.length === 1 && h2[0].type === "group", 1, h2.length);
  check("dimension=review，entityLabel=组大小", h2[0] && h2[0].dimension === "review" && h2[0].entityLabel === "2", ["review", "2"], h2[0] && [h2[0].dimension, h2[0].entityLabel]);
  const g1 = [mk("g-c", "sg-2", "review")];
  check("组=1 卡不命中（≥2 门槛）", growth.deriveGroupEvents(g1, NOW).length === 0, 0, growth.deriveGroupEvents(g1, NOW).length);
  const gMixed = [mk("g-d", "sg-3", "review"), mk("g-e", "sg-3", "learning")];
  check("组内 1 张 learning 不命中", growth.deriveGroupEvents(gMixed, NOW).length === 0, 0, growth.deriveGroupEvents(gMixed, NOW).length);
  const kp = [
    card({ id: "g-f", knowledgePointId: "kp-1", logs: [log({ after: fsrsOf("review", 10) })] }),
    card({ id: "g-g", knowledgePointId: "kp-1", logs: [log({ after: fsrsOf("review", 10) })] })
  ];
  const hKp = growth.deriveGroupEvents(kp, NOW);
  check("knowledge_point_id 分键同样成立", hKp.length === 1 && hKp[0].entityId === "kp-1", "kp-1", hKp[0] && hKp[0].entityId);
  check("重放触发时刻 = 组内造成全体达标的最新日志", h2[0].triggerSeq === Math.max(...g2.flatMap((m) => m.logs.map((l) => l.reviewSeq))), true, h2[0].triggerSeq);
}

// ---------------------------------------------------------------- P-9
console.log("== P-9 material：8 卡 4 巩固 → half；7 卡样本不命中；100% → full；书维与领域维独立 ==");
{
  const mkBook = (n, consolidated) => {
    const cards = [];
    for (let i = 0; i < n; i++) {
      const done = i < consolidated;
      cards.push(card({
        id: `m-${n}-${i}`,
        libraryItemId: "li-book",
        docTitle: "样本书",
        domain: ["004"],
        logs: [log({ after: done ? fsrsOf("review", 30) : fsrsOf("learning", 2) })]
      }));
    }
    return cards;
  };
  const half = growth.deriveMaterialEvents(mkBook(8, 4), NOW);
  check("8 卡 4 巩固（50%）→ half 命中", half.some((h) => h.dimension === "half"), true, half.map((h) => h.dimension));
  check("书维命中 entityId=libraryItemId", half.some((h) => h.entityId === "li-book"), true, half.map((h) => h.entityId));
  check("领域维独立命中（domain[0]=004）", half.some((h) => h.entityId === "004"), true, half.map((h) => h.entityId));
  check("7 卡样本（<8）任何覆盖率不命中", growth.deriveMaterialEvents(mkBook(7, 7), NOW).length === 0, 0, growth.deriveMaterialEvents(mkBook(7, 7), NOW).length);
  const full = growth.deriveMaterialEvents(mkBook(8, 8), NOW);
  check("100% → full 命中", full.some((h) => h.dimension === "full"), true, full.map((h) => h.dimension));
  const both = growth.deriveMaterialEvents(mkBook(8, 8), NOW);
  check("一次性从 0 跳到 100%：书维 half 与 full 都报（不同维度，各自首达）", both.filter((h) => h.dimension === "half" && h.entityId === "li-book").length === 1 && both.filter((h) => h.dimension === "full" && h.entityId === "li-book").length === 1, [1, 1], [both.filter((h) => h.dimension === "half" && h.entityId === "li-book").length, both.filter((h) => h.dimension === "full" && h.entityId === "li-book").length]);
}

// ---------------------------------------------------------------- P-10
console.log("== P-10 pickTopEvent 序：跨 tier 取高；同 tier 按表序；同表序按实体 id 字典序；L3 不进 toast；others 保留 ==");
{
  const hL3 = hit("retention-60", "c-1");
  const hGroup = hit("group", "sg-9");
  const hMaterialZ = hit("material", "zz-book", { dimension: "half" });
  const hMaterialA = hit("material", "aa-book", { dimension: "half" });
  const hR180 = hit("retention-180", "c-2");
  const hL0 = hit("kp-functional", "kp-1");
  const { toast, others } = growth.pickTopEvent([hL3, hGroup, hMaterialZ, hMaterialA, hR180, hL0]);
  check("跨 tier 取高（L0 命中 toast）", toast && toast.type === "kp-functional", "kp-functional", toast && toast.type);
  const noL0 = growth.pickTopEvent([hL3, hGroup, hMaterialZ, hMaterialA, hR180]);
  check("同级按表序（material 先于 group / retention-180）", noL0.toast && noL0.toast.type === "material", "material", noL0.toast && noL0.toast.type);
  const sameType = growth.pickTopEvent([hMaterialZ, hMaterialA]);
  check("同表序按实体 id 字典序（aa < zz）", sameType.toast && sameType.toast.entityId === "aa-book", "aa-book", sameType.toast && sameType.toast.entityId);
  check("L3 永不入 toast（surface 过滤）", growth.pickTopEvent([hL3]).toast === null, null, growth.pickTopEvent([hL3]).toast);
  check("others 保留被挤掉项（不丢弃，含 L3）", eq(others.map((h) => h.type), ["material", "material", "group", "retention-180", "retention-60"]), ["material", "material", "group", "retention-180", "retention-60"], others.map((h) => h.type));
}

// ---------------------------------------------------------------- P-11
console.log("== P-11 foldSameDay：同学习日同 type L2 → 首条可见+计数；跨学习日不折叠；L0 不折叠 ==");
{
  const DAY = 86_400_000;
  const dayOf = (ts) => Math.floor(ts / DAY) * DAY; // 测试用简化学习日映射（真实口径由调用方注入）
  const d1 = 50 * DAY, d2 = 51 * DAY;
  const m1 = hit("relearning-recovery", "c-1", { triggerAt: d1 + 3600_000 });
  const m2 = hit("relearning-recovery", "c-2", { triggerAt: d1 + 7200_000 });
  const m3 = hit("relearning-recovery", "c-3", { triggerAt: d2 + 3600_000 });
  const l0 = hit("kp-functional", "kp-1", { triggerAt: d1 + 4000_000 });
  const { visible, folded } = growth.foldSameDay([m3, m2, m1, l0], dayOf);
  check("同学习日同 type L2：首条可见（表序）", visible.some((h) => h.entityId === "c-1"), true, visible.map((h) => h.entityId));
  check("其余折成计数（count=1）", folded.length === 1 && folded[0].type === "relearning-recovery" && folded[0].count === 1, { type: "relearning-recovery", count: 1 }, folded.map((f) => ({ type: f.type, count: f.count })));
  check("被折叠命中完整保留在 folded（不丢弃）", folded[0].hits.length === 1 && folded[0].hits[0].entityId === "c-2", "c-2", folded[0].hits.map((h) => h.entityId));
  check("跨学习日不折叠（c-3 可见）", visible.some((h) => h.entityId === "c-3"), true, visible.map((h) => h.entityId));
  check("L0 假想命中不折叠（恒可见）", visible.some((h) => h.type === "kp-functional"), true, visible.map((h) => h.type));
  check("L3 不折叠（仅 L2 折叠，§6.6.1 投放面=汇总照常列出）", (() => {
    const l3a = hit("retention-60", "c-8", { triggerAt: d1 + 3600_000 });
    const l3b = hit("retention-60", "c-9", { triggerAt: d1 + 7200_000 });
    const r = growth.foldSameDay([l3a, l3b], dayOf);
    return r.visible.length === 2 && r.folded.length === 0;
  })(), true, "两条 L3 均可见");
}

// ---------------------------------------------------------------- P-12
console.log("== P-12 isConsolidated 口径唯一：与漏斗同值域（review ∧ stability>21）；挂起卡排除 ==");
{
  check("review + stability 21 → false（严格大于）", growth.isConsolidated(fsrsOf("review", 21)) === false, false, growth.isConsolidated(fsrsOf("review", 21)));
  check("review + stability 21.5 → true", growth.isConsolidated(fsrsOf("review", 21.5)) === true, true, growth.isConsolidated(fsrsOf("review", 21.5)));
  check("learning + stability 100 → false", growth.isConsolidated(fsrsOf("learning", 100)) === false, false, growth.isConsolidated(fsrsOf("learning", 100)));
  check("relearning + stability 100 → false", growth.isConsolidated(fsrsOf("relearning", 100)) === false, false, growth.isConsolidated(fsrsOf("relearning", 100)));
  check("fsrs 缺失 → false", growth.isConsolidated(null) === false, false, growth.isConsolidated(null));
  // 挂起卡排除：8 卡中 1 张已巩固卡被挂起 → 活跃样本 7 <8，任何覆盖率不命中（若误计入则 4/8=50% 会误报 half）
  const cards = [];
  for (let i = 0; i < 8; i++) {
    const done = i < 4;
    cards.push(card({
      id: `p12-${i}`, libraryItemId: "li-p12", docTitle: "挂起样本书", domain: ["004"],
      leech: i === 0 && done ? { isLeech: false, suspended: true } : null,
      logs: [log({ after: done ? fsrsOf("review", 30) : fsrsOf("learning", 2) })]
    }));
  }
  check("挂起卡不计入 material 样本（活跃 7<8 → 零命中）", growth.deriveMaterialEvents(cards, NOW).length === 0, 0, growth.deriveMaterialEvents(cards, NOW).length);
  const grp = [
    card({ id: "p12-g1", siblingKey: "sg-p12", logs: [log({ after: fsrsOf("review", 10) })] }),
    card({ id: "p12-g2", siblingKey: "sg-p12", leech: { isLeech: false, suspended: true }, logs: [log({ after: fsrsOf("review", 10) })] })
  ];
  check("挂起卡不计入 group 样本（组内活跃仅 1 <2 → 零命中）", growth.deriveGroupEvents(grp, NOW).length === 0, 0, growth.deriveGroupEvents(grp, NOW).length);
  const archived = [
    card({ id: "p12-a1", siblingKey: "sg-p12b", status: "archived", logs: [log({ after: fsrsOf("review", 10) })] }),
    card({ id: "p12-a2", siblingKey: "sg-p12b", logs: [log({ after: fsrsOf("review", 10) })] })
  ];
  check("归档卡不计入 group 样本", growth.deriveGroupEvents(archived, NOW).length === 0, 0, growth.deriveGroupEvents(archived, NOW).length);
}

// ---------------------------------------------------------------- P-13
console.log("== P-13 territory 聚合：四段计数之和=total；<8 样本的书被过滤；覆盖率=consolidated/total ==");
{
  const cards = [];
  const segs = ["new", "learning", "reviewing", "consolidated"];
  for (let i = 0; i < 8; i++) {
    const kind = segs[i % 4];
    cards.push(card({
      id: `t-${i}`, libraryItemId: "li-big", docTitle: "大书", domain: ["004"],
      fsrs: kind === "new" ? { state: "new", stability: 0 } :
            kind === "learning" ? fsrsOf("learning", 3) :
            kind === "reviewing" ? fsrsOf("review", 10) : fsrsOf("review", 30),
      logs: kind === "new" ? [] : [log({ after: fsrsOf(kind === "consolidated" ? "review" : kind, kind === "consolidated" ? 30 : kind === "reviewing" ? 10 : 3) })]
    }));
  }
  for (let i = 0; i < 5; i++) { // 小书只有 5 张活跃卡（<8 样本门槛）
    cards.push(card({
      id: `t-small-${i}`, libraryItemId: "li-small", docTitle: "小书", domain: null,
      fsrs: fsrsOf("review", 30), logs: [log({ after: fsrsOf("review", 30) })]
    }));
  }
  const { rows } = growth.buildTerritory(cards, NOW);
  const big = rows.find((r) => r.id === "li-big");
  check("大书行在场（8 卡达标）", Boolean(big), true, rows.map((r) => r.id));
  check("四段计数之和 = total", big && big.new + big.learning + big.reviewing + big.consolidated === big.total, true, big && { total: big.total, sum: big.new + big.learning + big.reviewing + big.consolidated });
  check("四段各 2（2 new / 2 learning / 2 reviewing / 2 consolidated）", big && big.new === 2 && big.learning === 2 && big.reviewing === 2 && big.consolidated === 2, [2, 2, 2, 2], big && [big.new, big.learning, big.reviewing, big.consolidated]);
  check("覆盖率 = consolidated/total", Math.abs(big.coverage - 0.25) < 1e-9, 0.25, big.coverage);
  check("未过半 → crossedHalf=false", big.crossedHalf === false, false, big.crossedHalf);
  check("小书（<8 样本）被过滤", !rows.some((r) => r.id === "li-small"), true, rows.map((r) => r.id));
  const fullCards = cards.filter((c) => c.libraryItemId === "li-big").map((c) => ({ ...c, fsrs: fsrsOf("review", 30) }));
  const fullRow = growth.buildTerritory(fullCards, NOW).rows.find((r) => r.id === "li-big");
  check("全覆盖 → crossedFull=true（现状标记）", fullRow && fullRow.crossedFull === true, true, fullRow && fullRow.crossedFull);
}

// ---------------------------------------------------------------- P-14
console.log("== P-14 纯度：同输入两次调用输出 JSON.stringify 全等；不读 Date.now / 无随机 ==");
{
  const mk = () => {
    const c = card({ id: "p14", libraryItemId: "li-14", docTitle: "纯度", domain: ["51"], siblingKey: "sg-14", logs: [
      log({ reviewSeq: 1, before: fsrsOf("learning", 1), after: fsrsOf("review", 70), leechBefore: { isLeech: true } }),
      log({ reviewSeq: 2, before: fsrsOf("review", 70), after: fsrsOf("relearning", 3) }),
      log({ reviewSeq: 3, before: fsrsOf("relearning", 3), after: fsrsOf("review", 90) })
    ] });
    return [c, card({ ...c, id: "p14-b", logs: c.logs.map((l) => ({ ...l })) })];
  };
  const pair = mk(); // 同一份夹具喂两次（log 工厂自增 seq，重复调用会造出不同输入）
  const a1 = growth.deriveCardEvents(pair[0], pair[0].logs, NOW);
  const a2 = growth.deriveCardEvents(pair[0], pair[0].logs, NOW);
  check("deriveCardEvents 同输入两次全等", eq(a1, a2), true, "全等");
  const g1 = growth.deriveGroupEvents(pair, NOW);
  const g2 = growth.deriveGroupEvents(pair.map((c) => ({ ...c, logs: c.logs.map((l) => ({ ...l })) })), NOW);
  check("deriveGroupEvents 同输入两次全等", eq(g1, g2), true, "全等");
  const m1 = growth.deriveMaterialEvents(pair, NOW, {});
  const m2 = growth.deriveMaterialEvents(pair.map((c) => ({ ...c, logs: c.logs.map((l) => ({ ...l })) })), NOW, {});
  check("deriveMaterialEvents 同输入两次全等", eq(m1, m2), true, "全等");
  const t1 = growth.buildTerritory(pair, NOW);
  const t2 = growth.buildTerritory(pair.map((c) => ({ ...c })), NOW);
  check("buildTerritory 同输入两次全等", eq(t1, t2), true, "全等");
  const p1 = growth.pickTopEvent(a1);
  const p2 = growth.pickTopEvent(a1.slice());
  check("pickTopEvent 同输入两次全等", eq(p1, p2), true, "全等");
  const f1 = growth.foldSameDay(a1, () => 0);
  const f2 = growth.foldSameDay(a1.slice(), () => 0);
  check("foldSameDay 同输入两次全等", eq(f1, f2), true, "全等");
  const src = require("fs").readFileSync(path.join(__dirname, "..", "electron", "growth.js"), "utf8");
  check("模块不读 Date.now()（now 全部注入）", !src.includes("Date.now"), true, "无 Date.now");
  check("模块无随机（Math.random）", !src.includes("Math.random"), true, "无 Math.random");
  check("模块无 IO（require 仅限零依赖：无 electron / ./db）", !/require\s*\(/.test(src), true, "零 require");
  check("GF-2 预留：deriveKnowledgeEvents 未实现（阻塞于 G1，调用即抛）", (() => {
    try { growth.deriveKnowledgeEvents([], [], [], NOW); return false; } catch (e) { return /G1/.test(String(e.message)); }
  })(), true, "throw(G1)");
}

console.log(`\n==== growth.test：${pass} 通过 / ${fail} 失败 ====`);
process.exitCode = fail === 0 ? 0 : 1;
