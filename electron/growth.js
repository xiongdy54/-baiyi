"use strict";
// v48.85（D129，§4.2-22 GrowthReadModel / §4.17 / §6.6.1）：M13 成长反馈——记忆层事件判定纯函数模块。
// 设计稿：docs/design/GROWTH-FEEDBACK-D129.md §3.2（本文件是其唯一实现居所）。
//
// 纪律（§3.2 硬性）：
//  - 无 IO、无时钟读取（now 一律注入）、无随机；输入＝证据行数组 + 参数对象；输出＝普通对象。
//  - 本模块为**零依赖纯模块**：不引入 electron、不引入 db（node 直跑可测，tests/growth.test.cjs）。
//  - 判定口径（首达/跨越/康复、阈值、tier、投放面）**只在本文件**；复习提示、会话汇总、仪表盘三个
//    消费端一律经 IPC 消费本模块输出，禁止任何组件自行实现口径（§4.2-22，同 §4.2-20 精神）。
//
// 取消项登记（§6.6.1 序 13/14，用户 2026-09-15 判定，**禁加回**）：
//  - "consolidate-21d"（单卡巩固 21 天）：普通卡数次成功复习即达——频率高、区分度低，不产任何事件。
//  - "learning-graduate"（学习步毕业 Learning → Review）：每张新卡必经、零信息量，不产任何事件。
//  两者不是 GrowthEventType 枚举成员；deriveCardEvents 内显式跳过（见函数内注释）。
//
// 阈值定稿值（D129 登记，随设计稿 §3.2/§7-G4；改值须先改文档，实现不得另调）：
//  - 巩固（consolidated）≡ fsrs.state==="review" 且 stability > 21 天——与 stats:overview 漏斗「已巩固」同口径（禁止第二套）。
//  - material 样本门槛：活跃卡 ≥8；覆盖率两档：首达 ≥50%（half「过半」）、=100%（full「全覆盖」）。
//  - group 组大小 ≥2。
//  - leech-recovery 稳定阈值 = 21 天（与「已巩固」同阈值）。
//  - retention-60 / retention-180：after.stability 首达 60 / 180。
//
// 证据行形状（由 electron/db.js 聚合出口映射后传入；node 测试按同形状手工构造）：
//  - card：mapCardRow 输出 + docTitle（本模块只读以下字段：id / frontMarkdown / noteText / siblingKey /
//    knowledgePointId / libraryItemId / docTitle / domain / fsrs / leech / status / contextRef / logs）。
//  - log：{ reviewSeq:number, reviewedAt:number, before:object|null, after:object|null, leechBefore:object|null }
//    —— before/after 为 fsrs_before_json / fsrs_after_json 的防御性解析结果；**缺快照（null）的 v22 前旧日志
//    不参与任何判定**（§3.2）。review_seq 升序由调用方保证，模块内另做防御性排序。
//  - 挂起卡（leech.suspended）与归档卡（status==="archived"）不计入组/材料样本（§6.2 N-8、P-12）；
//    已删卡（is_deleted=1）由 SQL 层过滤，不进入本模块。

// ---------- 常量（§6.6.1 分级总表 → 机读） ----------

// 事件类型封闭枚举 + 固定表序（§6.6.1 序 1–12；同级排序、折叠留显均按此序）。
// 序 13/14 为取消项（见文件头），不是枚举成员。
const TYPE_ORDER = [
  "transfer-first",      // L0（GF-2，阻塞于缺口 G1，本期不产出）
  "application-first",   // L0（GF-2）
  "kp-strong",           // L0（GF-2）
  "kp-functional",       // L0（GF-2）
  "structure-link",      // L1（GF-2）
  "domain-entry",        // L1（GF-2）
  "material",            // L2（GF-1）
  "group",               // L2（GF-1）
  "leech-recovery",      // L2（GF-1）
  "relearning-recovery", // L2（GF-1）
  "retention-180",       // L2（GF-1）
  "retention-60"         // L3（GF-1，仅汇总）
];

// tier 即提示优先级（§4.17-5：L0 能力=0 / L1 结构=1 / L2 建制=2 / L3 次要=3）。
const TIER_BY_TYPE = {
  "transfer-first": 0, "application-first": 0, "kp-strong": 0, "kp-functional": 0,
  "structure-link": 1, "domain-entry": 1,
  "material": 2, "group": 2, "leech-recovery": 2, "relearning-recovery": 2, "retention-180": 2,
  "retention-60": 3
};

// 投放面（§6.6.1 投放面列的机读形式；L3 = ["summary"] 仅会话汇总，永不进提示条）。
const SURFACE_BY_TYPE = (() => {
  const m = {};
  for (const t of TYPE_ORDER) m[t] = ["toast", "summary"];
  m["retention-60"] = ["summary"];
  return m;
})();

// 阈值定稿值（D129；见文件头说明）。
const THRESHOLDS = Object.freeze({
  consolidatedStabilityDays: 21, // 巩固：stability > 21（漏斗同源）
  retention60Days: 60,
  retention180Days: 180,
  materialSampleMin: 8,
  materialHalfRatio: 0.5,
  materialFullRatio: 1,
  groupMinSize: 2,
  leechRecoveryStabilityDays: 21
});

// ---------- 通用底座 ----------

// firstCrossings(series, threshold)：任意 (实体, 维度) 的时间序列的首达记录（§3.2 通用底座）。
// 输入 series = [{seq, at, value}]（seq=review_seq，at=reviewed_at，value=指标值）；
// 输出 = [{seq, at}]：value 首次越过阈值（>=）的序列点。
//  - 按 seq 升序扫描；「值掉回阈值下方」即重新武装（armed）——
//    日志被撤销删除 = 序列自然回退 = 事件自动消失（§4.17-6②，静默）；
//    重评再跨越产生新 triggerSeq（真实的重做，§4.17-6②）。
//  - 阈值判定一律 value >= threshold（首达语义）。
function firstCrossings(series, threshold) {
  const pts = (series || [])
    .filter((p) => p && Number.isFinite(p.seq) && Number.isFinite(p.value))
    .sort((a, b) => a.seq - b.seq);
  const out = [];
  let armed = true; // 初始视为未达成（序列之前无证据）
  for (const p of pts) {
    if (p.value >= threshold) {
      if (armed) { out.push({ seq: p.seq, at: p.at }); armed = false; }
    } else {
      armed = true;
    }
  }
  return out;
}

// 命中对象（§3.1 GrowthEventHit 的普通对象形式；key = `${type}:${entityId}:${dimension}`，§4.17-6①）。
function makeHit({ type, entityId, entityLabel, dimension, triggerSeq, triggerAt, evidence }) {
  return {
    key: `${type}:${entityId}:${dimension}`,
    type,
    tier: TIER_BY_TYPE[type],
    entityId: String(entityId),
    entityLabel: String(entityLabel ?? ""),
    dimension: String(dimension),
    triggerSeq: Number(triggerSeq),
    triggerAt: Number(triggerAt),
    surface: [...SURFACE_BY_TYPE[type]],
    evidence: evidence && typeof evidence === "object" ? evidence : {}
  };
}

// 确定性全序：tier 升序 → §6.6.1 表序 → 实体 id 字典序 → 维度字典序 → triggerSeq 升序 → key 字典序。
// （前三键为契约规定的排序（§4.17-6④/§6.6.1）；后三键只为同键并列时仍可重算、可测试——不改变契约序。）
// 注意：实体 id 用原生字符串比较（禁 localeCompare——平台相关，破坏 P-14 纯度断言）。
function compareHits(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const ta = TYPE_ORDER.indexOf(a.type), tb = TYPE_ORDER.indexOf(b.type);
  if (ta !== tb) return ta - tb;
  if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
  if (a.dimension !== b.dimension) return a.dimension < b.dimension ? -1 : 1;
  if (a.triggerSeq !== b.triggerSeq) return a.triggerSeq - b.triggerSeq;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

// 活跃卡判据（组/材料样本与 Territory 聚合共用；§3.2）：非归档、非挂起。
// （已删卡由 SQL 层 is_deleted=0 过滤；损坏行由 db 聚合出口按 damaged 跳过——与 computeTodayQueue 同口径。）
function isActiveCard(card) {
  return Boolean(card && card.id && card.status !== "archived" && !(card.leech && card.leech.suspended));
}

// 卡正面摘要（≤40 字，同 deferReason 截断先例，§3.1 entityLabel 约定）。
function frontSummary(card) {
  return String((card && (card.frontMarkdown || card.noteText)) || "").slice(0, 40);
}

// 单卡证据链基底（§3.1 evidence；跳转原文锚有则给）。
function cardEvidence(card, extra) {
  const ev = {
    cardIds: [card.id],
    cardFronts: [frontSummary(card)]
  };
  if (card.libraryItemId) ev.libraryItemId = card.libraryItemId;
  if (card.docTitle) ev.docTitle = card.docTitle;
  if (card.contextRef && typeof card.contextRef === "object" && card.contextRef.documentId) {
    ev.documentId = card.contextRef.documentId;
  }
  return Object.assign(ev, extra || {});
}

// consolidated 判定子函数（口径唯一）：state==="review" 且 stability > 21（D129，漏斗同源——禁止第二套）。
function isConsolidated(fsrs) {
  return Boolean(
    fsrs && typeof fsrs === "object" &&
    fsrs.state === "review" &&
    Number(fsrs.stability) > THRESHOLDS.consolidatedStabilityDays
  );
}

// 某成员卡在给定 seq 时刻的状态重放：取其 ≤seq 的最新可读 after 快照的 state；首条快照之前视为 "new"。
// 例外：全无可读快照的卡（v22 前旧历史，无法定位时刻）按当前状态恒定参与——其当前状态此后不再变化
// （再评分即产生快照，退出该分支），故与「per-grade 并 ≡ 窗口重算」的一致性（N-9）不冲突。
// （重放只依赖日志快照——缺快照的旧日志不推进状态，宁可少报不可误报。）
function memberStateAt(card, seq) {
  const logs = (card.logs || []).filter((l) => l && Number.isFinite(l.reviewSeq)).sort((a, b) => a.reviewSeq - b.reviewSeq);
  if (!logs.length || !logs.some((l) => l.after && typeof l.after === "object")) {
    const cur = card.fsrs && typeof card.fsrs === "object" ? card.fsrs : null;
    return cur && typeof cur.state === "string" ? cur.state : "new";
  }
  let st = "new";
  for (const l of logs) {
    if (l.reviewSeq > seq) break;
    if (l.after && typeof l.after === "object" && typeof l.after.state === "string") st = l.after.state;
  }
  return st;
}

// ---------- 单卡事件（§3.2 deriveCardEvents） ----------

// deriveCardEvents(card, logs, now)：单卡行 + 该卡全部日志（按 review_seq 升序）→ 该卡的首达命中集。
// 产出类型：retention-180 / retention-60 / leech-recovery / relearning-recovery（GF-1 记忆层全部单卡事件）。
// now 参数按 §3.2 统一签名保留（当前口径全部由日志快照驱动，不依赖时钟；预留 GF-2 复用）。
function deriveCardEvents(card, logs, now) {
  void now;
  if (!card || !card.id || !Array.isArray(logs)) return [];
  const all = logs.filter((l) => l && Number.isFinite(l.reviewSeq));
  // 可用日志 = after 快照可解析（缺快照的 v22 前旧日志不参与判定，§3.2）
  const usable = all.filter((l) => l.after && typeof l.after === "object");
  const hits = [];
  const base = () => cardEvidence(card);

  // —— retention-60 / retention-180（§6.6.1 序 11/12）——
  // 口径：after.stability 首次 ≥60 / ≥180（D129）。同一条日志同时跨两档只报 180——
  // 两键同卡同日时由 pickTopEvent 兜底（60 落 others，§3.2）。
  const retentionSeries = usable
    .filter((l) => Number.isFinite(Number(l.after.stability)))
    .map((l) => ({ seq: l.reviewSeq, at: l.reviewedAt, value: Number(l.after.stability) }));
  const retentionDefs = [
    { type: "retention-180", threshold: THRESHOLDS.retention180Days },
    { type: "retention-60", threshold: THRESHOLDS.retention60Days }
  ];
  for (const def of retentionDefs) {
    for (const c of firstCrossings(retentionSeries, def.threshold)) {
      const trigger = usable.find((l) => l.reviewSeq === c.seq);
      hits.push(makeHit({
        type: def.type,
        entityId: card.id,
        entityLabel: frontSummary(card),
        dimension: def.type === "retention-60" ? "60" : "180",
        triggerSeq: c.seq,
        triggerAt: c.at,
        evidence: cardEvidence(card, {
          stabilityDays: trigger && Number.isFinite(Number(trigger.after.stability)) ? Number(trigger.after.stability) : undefined
        })
      }));
    }
  }

  // —— relearning-recovery（§6.6.1 序 10；D175 修订：每卡仅首次）——
  // 口径：存在日志 L 使 before.state==="relearning" && after.state==="review"，且为该卡**首次**成立。
  // D175（v49.1，用户 2026-10-15 裁定）：不再沿用 firstCrossings 的「掉回重新武装」——FSRS 里每次
  // 遗忘都会各走一遍 relearning→review，逐次计报会在难书上刷屏、稀释反馈成就感（§4.17-6①
  // 「每个 (事件类型, 实体, 维度) 只报一次」的字面语义；②「真实的重做」再触发只适用于
  // stability 阈值类事件的回落后再跨越，如 retention-60/180）。撤销回退语义不变：
  // 首条康复日志被撤销后，下一条康复自然成为「首次」（重放一致性 N-4/N-9）。
  const relearnSeries = all
    .filter((l) => l.before && typeof l.before === "object" && l.after && typeof l.after === "object")
    .sort((a, b) => a.reviewSeq - b.reviewSeq)
    .map((l) => ({
      seq: l.reviewSeq,
      at: l.reviewedAt,
      value: l.before.state === "relearning" && l.after.state === "review" ? 1 : 0
    }));
  const firstRecovery = relearnSeries.find((p) => p.value === 1); // 只取首次跨越，不再武装
  if (firstRecovery) {
    const trigger = all.find((l) => l.reviewSeq === firstRecovery.seq);
    hits.push(makeHit({
      type: "relearning-recovery",
      entityId: card.id,
      entityLabel: frontSummary(card),
      dimension: "recovery",
      triggerSeq: firstRecovery.seq,
      triggerAt: firstRecovery.at,
      evidence: cardEvidence(card, {
        lapses: trigger && Number.isFinite(Number(trigger.after.lapses)) ? Number(trigger.after.lapses) : undefined
      })
    }));
  }

  // —— leech-recovery（§6.6.1 序 9）——
  // 口径（D129）：历史上出现过 leech_before_json 非空（或该卡现挂 leech_json）∧
  // 其后某日志 after.state==="review" 且 after.stability ≥ 21（21d=与「已巩固」同阈值）首次成立。
  // 锚点 = 最早的 leech 证据日志；仅「现挂 leech_json」而无日志锚时，全部日志参与（锚 = −∞）。
  const leechMarkerSeqs = all.filter((l) => l.leechBefore != null).map((l) => l.reviewSeq);
  const hasLeechLog = leechMarkerSeqs.length > 0;
  const hasLeechNow = card.leech != null && typeof card.leech === "object";
  if (hasLeechLog || hasLeechNow) {
    let anchorSeq = -Infinity;
    if (hasLeechLog) anchorSeq = leechMarkerSeqs.reduce((m, s) => Math.min(m, s), Infinity);
    const leechSeries = usable
      .filter((l) => l.reviewSeq > anchorSeq)
      .map((l) => ({
        seq: l.reviewSeq,
        at: l.reviewedAt,
        value: l.after.state === "review" && Number(l.after.stability) >= THRESHOLDS.leechRecoveryStabilityDays ? 1 : 0
      }));
    for (const c of firstCrossings(leechSeries, 1)) {
      hits.push(makeHit({
        type: "leech-recovery",
        entityId: card.id,
        entityLabel: frontSummary(card),
        dimension: "recovery",
        triggerSeq: c.seq,
        triggerAt: c.at,
        evidence: base()
      }));
    }
  }

  // ===== 取消项（§6.6.1 序 13/14）——显式不产事件，禁加回（见文件头登记）=====
  // "learning-graduate"（before.state==="learning" && after.state==="review"）：学习步毕业，零信息量——不产事件。
  // "consolidate-21d"（stability 首过 21）：上面对 stability 的判定只挂 60/180 两档，21 天档不存在——不产事件。

  return hits.sort(compareHits);
}

// ---------- 组级事件（§3.2 deriveGroupEvents） ----------

// deriveGroupEvents(cardsWithLogs, now)：同组卡行（各卡带 logs）→ 组毕业命中。
// 口径（D129）：组成员 = 活跃卡（非挂起/非归档/未删），按 sibling_key（非 NULL，优先）或
// knowledge_point_id（非 NULL）分组，组大小 ≥2；「全组 fsrs.state==="review"」按重放序列求首达
// （组内任一成员日志时刻上，全体成员按各自最新可读快照均为 review）；dimension="review"。
// 触发时刻 = 跨越点的 review_seq（即组内造成全体达标的最新一条日志）。
// 重放语义保证与撤销/窗口重算一致（N-4/N-9）：成员日志被撤销 → 重放回退 → 事件消失。
function deriveGroupEvents(cardsWithLogs, now) {
  void now;
  const cards = (cardsWithLogs || []).filter(isActiveCard);
  const groups = new Map();
  for (const c of cards) {
    const key = c.siblingKey || c.knowledgePointId; // 双键并存时取 sibling_key（§3.2 字面序）
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const hits = [];
  for (const [key, members] of groups) {
    if (members.length < THRESHOLDS.groupMinSize) continue; // D129：组 ≥2
    const events = [];
    for (const m of members) {
      for (const l of m.logs || []) if (l && Number.isFinite(l.reviewSeq)) events.push(l);
    }
    events.sort((a, b) => a.reviewSeq - b.reviewSeq);
    const series = events.map((e) => ({
      seq: e.reviewSeq,
      at: e.reviewedAt,
      value: members.every((m) => memberStateAt(m, e.reviewSeq) === "review") ? 1 : 0
    }));
    for (const c of firstCrossings(series, 1)) {
      hits.push(makeHit({
        type: "group",
        entityId: String(key),
        entityLabel: String(members.length), // §3.1：组级 entityLabel = 组大小
        dimension: "review",
        triggerSeq: c.seq,
        triggerAt: c.at,
        evidence: {
          cardIds: members.map((m) => m.id),
          cardFronts: members.map(frontSummary),
          groupSize: members.length
        }
      }));
    }
  }
  return hits.sort(compareHits);
}

// ---------- 材料级事件（§3.2 deriveMaterialEvents） ----------

// deriveMaterialEvents(cardsWithLogs, now, params)：书/领域 → 活跃卡集（各卡带 logs）→ 材料级跨越命中。
// 口径（D129）：
//  - 覆盖率 = consolidated 卡数 / 活跃卡总数；consolidated ≡ isConsolidated(fsrs)（review 且 stability>21，漏斗同源）。
//  - 样本门槛：活跃卡 ≥8 才参与（不足不产事件、不入 Territory 行）。
//  - 阈值两档：首达 ≥50%（dimension="half"「过半」）、=100%（dimension="full"「全覆盖」）。
//  - 实体两键：书（libraryItemId，经 contextRef.documentId 归属——join 在 db 出口完成）与 UDC 主领域码（domain[0]）。
// 覆盖率按重放序列求首达（组级同语义）；params 为预留位（阈值定稿在本模块，不外放）。
function deriveMaterialEvents(cardsWithLogs, now, params) {
  void now;
  void params;
  const cards = (cardsWithLogs || []).filter(isActiveCard);
  const books = new Map();
  const domains = new Map();
  for (const c of cards) {
    // 主领域码 = domain[0]（与 stats:overview「主领域 = domain[0]」同口径）；无归属卡不参与书维、仍参与领域维（R9）
    const dom = Array.isArray(c.domain) && c.domain.length ? String(c.domain[0]) : null;
    if (c.libraryItemId) {
      const k = String(c.libraryItemId);
      if (!books.has(k)) books.set(k, []);
      books.get(k).push(c);
    }
    if (dom) {
      if (!domains.has(dom)) domains.set(dom, []);
      domains.get(dom).push(c);
    }
  }
  const hits = [];
  for (const [entityId, members] of books) hits.push(...materialCrossings(entityId, members, "book"));
  for (const [entityId, members] of domains) hits.push(...materialCrossings(entityId, members, "domain"));
  return hits.sort(compareHits);
}

// 单个材料（书或领域）的覆盖率首达命中。
function materialCrossings(entityId, members, kind) {
  const total = members.length;
  if (total < THRESHOLDS.materialSampleMin) return []; // D129：样本门槛 活跃卡 ≥8
  const events = [];
  for (const m of members) {
    for (const l of m.logs || []) if (l && Number.isFinite(l.reviewSeq)) events.push(l);
  }
  events.sort((a, b) => a.reviewSeq - b.reviewSeq);
  // 成员在某 seq 是否 consolidated（重放）：首条可读快照之前一律视为未巩固（new）——
  // **禁止**回退到当前状态：那会把「尚未发生」的巩固倒填进历史，把首达时刻前移（N-9 实测踩过）。
  // 例外：全无可读快照的卡（v22 前旧历史）按当前状态恒定参与（与 memberStateAt 同一妥协，见其注释）。
  const consolidatedAt = (card, seq) => {
    const logs = (card.logs || []).filter((l) => l && Number.isFinite(l.reviewSeq) && l.after && typeof l.after === "object")
      .sort((a, b) => a.reviewSeq - b.reviewSeq);
    if (!logs.length) {
      const cur = card.fsrs && typeof card.fsrs === "object" ? card.fsrs : null;
      return isConsolidated(cur) ? 1 : 0;
    }
    let snap = null;
    for (const l of logs) {
      if (l.reviewSeq > seq) break;
      snap = l.after;
    }
    return isConsolidated(snap) ? 1 : 0; // snap=null（首条快照之前）→ isConsolidated(null)=false
  };
  const series = events.map((e) => {
    let consolidated = 0;
    for (const m of members) consolidated += consolidatedAt(m, e.reviewSeq);
    return { seq: e.reviewSeq, at: e.reviewedAt, value: consolidated / total };
  });
  const label = kind === "book"
    ? String((members.find((m) => m.docTitle) || {}).docTitle || entityId)
    : String(entityId); // 领域维 entityLabel = UDC 主领域码（展示名由文案层映射）
  const evidence = kind === "book"
    ? { libraryItemId: String(entityId), docTitle: label }
    : {};
  const hits = [];
  const defs = [
    { dimension: "full", threshold: THRESHOLDS.materialFullRatio },
    { dimension: "half", threshold: THRESHOLDS.materialHalfRatio }
  ];
  for (const def of defs) {
    for (const c of firstCrossings(series, def.threshold)) {
      hits.push(makeHit({
        type: "material",
        entityId: String(entityId),
        entityLabel: label,
        dimension: def.dimension,
        triggerSeq: c.seq,
        triggerAt: c.at,
        evidence
      }));
    }
  }
  return hits;
}

// ---------- 选级 / 折叠（§3.2 pickTopEvent / foldSameDay） ----------

// pickTopEvent(hits)：单次评分产生的全部命中 → {toast, others}。
// toast 候选先按 surface 含 "toast" 过滤（L3 出局，§6.6.1 投放面列）；取 tier 最小值（L0 最高）；
// 同级按 §6.6.1 表序（compareHits 内固定 TYPE_ORDER）→ 实体 id 字典序；**至多 1 条**，
// 其余进 others（汇总兜底，不丢弃 §6.6.2「不丢弃」）。
function pickTopEvent(hits) {
  const all = (hits || []).filter((h) => h && h.type).sort(compareHits);
  const toastCandidates = all.filter((h) => Array.isArray(h.surface) && h.surface.includes("toast"));
  const toast = toastCandidates.length ? toastCandidates[0] : null;
  const others = toast ? all.filter((h) => h !== toast) : all;
  return { toast, others };
}

// foldSameDay(hits, dayStartOf)：命中集 + 学习日映射 → {visible, folded[]}。
// 口径（§4.17-6⑤/D129）：同一学习日内同 type 的 **L2** 事件——visible 留表序第一条，
// 其余折成 {type, count, dayStart, hits}（「今天另有 N 张卡进入长期维持」；count=折叠条数，
// hits=被折叠的完整命中——G-9 折叠行展开明细所需，为 §3.2 {type,count} 的超集）；
// L0/L1 不折叠（天然稀有）、L3 不折叠（仅汇总、照常列出）。学习日口径 = learningDayStartMs(ts, dayCutoffHour)
// （D23，统计口径专用）——由调用方注入映射函数（本模块不读设置，保持纯函数）。
function foldSameDay(hits, dayStartOf) {
  const dayOf = typeof dayStartOf === "function" ? dayStartOf : () => 0;
  const sorted = (hits || []).filter((h) => h && h.type).sort(compareHits);
  const visible = [];
  const folded = [];
  const seen = new Map(); // `${dayStart}\u0000${type}` → 该学习日该类型是否已有可见条
  for (const h of sorted) {
    if (h.tier === 2) {
      const day = dayOf(Number(h.triggerAt));
      const k = `${day}\u0000${h.type}`;
      if (seen.has(k)) {
        let entry = folded.find((f) => f.type === h.type && f.dayStart === day);
        if (!entry) {
          entry = { type: h.type, count: 0, dayStart: day, hits: [] };
          folded.push(entry);
        }
        entry.count += 1;
        entry.hits.push(h);
        continue;
      }
      seen.set(k, true);
    }
    visible.push(h);
  }
  folded.sort((a, b) => a.dayStart - b.dayStart || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  return { visible, folded };
}

// ---------- Territory 聚合（§3.2 buildTerritory） ----------

// buildTerritory(cardRows, now)：全量活跃卡行 → Territory 聚合（材料/领域巩固地图数据面，GF-1 形态）。
// 按书（libraryItemId）与 UDC 主领域码（domain[0]）两维聚合：
//   {total, new, learning, reviewing, consolidated, coverage, crossedHalf, crossedFull}；
// 状态四段 = new（fsrs 缺失或 state==="new"）/ learning（state=learning|relearning 等）/ 
//   reviewing（review 且 stability≤21）/ consolidated（review 且 stability>21，isConsolidated 口径唯一）；
// 与 deriveMaterialEvents 共用 isConsolidated（口径唯一，§3.2 硬性）。
// 样本门槛与 material 事件同源：活跃卡 <8 的材料不入行（P-13）。
// crossedHalf/crossedFull = **现状**覆盖率过半/全覆盖标记（§4.17-7③ 回落纪律：随现状自然消失，非历史档案）。
function buildTerritory(cardRows, now) {
  void now;
  const cards = (cardRows || []).filter(isActiveCard);
  const buckets = new Map(); // `${kind}:${id}` → 聚合行
  const ensure = (kind, id, label) => {
    const k = `${kind}:${id}`;
    if (!buckets.has(k)) buckets.set(k, { kind, id: String(id), label: String(label ?? ""), total: 0, new: 0, learning: 0, reviewing: 0, consolidated: 0 });
    return buckets.get(k);
  };
  for (const c of cards) {
    const dom = Array.isArray(c.domain) && c.domain.length ? String(c.domain[0]) : null;
    if (!c.libraryItemId && !dom) continue; // 两维都无法归属的卡不入地图
    const fsrs = c.fsrs && typeof c.fsrs === "object" ? c.fsrs : null;
    let seg;
    if (!fsrs || fsrs.state == null || fsrs.state === "new") seg = "new";
    else if (fsrs.state === "review") seg = isConsolidated(fsrs) ? "consolidated" : "reviewing";
    else seg = "learning"; // learning / relearning（及未知态）归「学习中」
    if (c.libraryItemId) {
      const row = ensure("book", c.libraryItemId, c.docTitle || c.libraryItemId);
      row.total++; row[seg]++;
    }
    if (dom) {
      const row = ensure("domain", dom, dom);
      row.total++; row[seg]++;
    }
  }
  const rows = [...buckets.values()]
    .filter((r) => r.total >= THRESHOLDS.materialSampleMin) // 与 material 事件同一样本门槛（D129）
    .map((r) => ({
      ...r,
      coverage: r.total ? r.consolidated / r.total : 0,
      crossedHalf: r.total ? r.consolidated / r.total >= THRESHOLDS.materialHalfRatio : false,
      crossedFull: r.total ? r.consolidated / r.total >= THRESHOLDS.materialFullRatio : false
    }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // total 降序 → id 字典序（确定性）
  return { rows };
}

// ---------- GF-2 扩展点（§3.5：签名与形状预留，实现阻塞于缺口 G1——**不实现**） ----------

// deriveKnowledgeEvents(k1RelationRows, kpStateRows, learningEventRows, now)：知识层（L0/L1）命中集。
// 输入三类行：knowledge_relations（K1，analogous_to 用户确认语义待核对——缺口 G3）、
// learner.db kp_states（L0–L4 + first_l3_at/first_l4_at）、learning_events；输出同 GrowthEventHit。
// **阻塞于缺口 G1**：L 级 ↔ 四态/学习事件/领域的映射表须先由总控修订 §4.17-5（本稿 §3.5 不自创第二套解释）；
// 契约修订前禁止实现（防止在失效数据面上造第二套事实）。签名与输出形状已锁，判定细则待契约修订后补入。
function deriveKnowledgeEvents(k1RelationRows, kpStateRows, learningEventRows, now) {
  void k1RelationRows;
  void kpStateRows;
  void learningEventRows;
  void now;
  throw new Error("deriveKnowledgeEvents：GF-2 阻塞于缺口 G1（§4.17-5 数据面已被 §4.20 取代，契约修订前不实现——设计稿 GROWTH-FEEDBACK-D129 §3.5/§7）");
}

module.exports = {
  // 底座与口径
  firstCrossings,
  isConsolidated,
  compareHits,
  // 事件派生（GF-1 记忆层）
  deriveCardEvents,
  deriveGroupEvents,
  deriveMaterialEvents,
  buildTerritory,
  // 选级 / 折叠
  pickTopEvent,
  foldSameDay,
  // GF-2 预留（不实现，见函数注释）
  deriveKnowledgeEvents,
  // 机读常量（§6.6.1 表序 / tier / 投放面 / D129 阈值定稿值）
  TYPE_ORDER,
  TIER_BY_TYPE,
  SURFACE_BY_TYPE,
  THRESHOLDS
};
