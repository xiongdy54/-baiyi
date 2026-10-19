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
// 取消项 / 退役项登记（**禁加回**）：
//  - "consolidate-21d"（单卡巩固 21 天，§6.6.1 序 13）：普通卡数次成功复习即达——频率高、区分度低，不产任何事件。
//  - "learning-graduate"（学习步毕业 Learning → Review，§6.6.1 序 14）：每张新卡必经、零信息量，不产任何事件。
//  - "group"（组级毕业，v49.23 / D196 退役）：原口径 =「当前 sibling_key / knowledge_point_id 组内全员达同一阶段」，
//    属**现状集合型**——新增同组卡即便「全员达标」不成立（重新武装）→ 事件重复触发且时点漂移；且「组」对用户不可见
//    （无法点开看是哪几张，无展示价值）。**整体移除**（不是 GrowthEventType 枚举成员）。
//  以上均不是 GrowthEventType 枚举成员；deriveCardEvents / 本文件不再产出。
//
// 阈值定稿值（D129 首次登记；v49.23 / D196 修订，随设计稿 GROWTH-SIGNALS-RESIGN §2；改值须先改文档，实现不得另调）：
//  - 巩固（consolidated）≡ fsrs.state==="review" 且 stability > 21 天——与 stats:overview 漏斗「已巩固」同口径（禁止第二套）。
//  - material（**重定义**）：某书 / 某领域**累计「曾进入长期记忆」的卡数**首达关口 N（N = 50, 100, 150, …，每 50 一档、无上限）。
//    「曾进入长期记忆」= 该卡存在某条可读日志其 after 满足 isConsolidated；历史上限锚定，**单调不减**（不随材料扩容漂移）。
//  - Territory 行样本门槛：活跃卡 ≥8（保留；**不再是 material 事件门槛**）。
//  - domain-entry（GF-1 简化版，v49.23 / D196）：某 UDC 主领域码**首次**出现「曾进入长期记忆」的卡。
//  - leech-recovery 稳定阈值 = 21 天（与「已巩固」同阈值）。
//  - retention-60 / retention-180：after.stability **首次**达 60 / 180（v49.23 / D196 改「只取首个跨档点」，不再重新武装）。
//  - 全记忆层事件一律 **P3 一次即永**（取序列首个跨档点；不掉回重新武装）——见 firstCrossing。
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

// 事件类型封闭枚举 + 固定表序（§6.6.1 分级总表序；同级排序、折叠留显均按此序）。
// 取消 / 退役项（learning-graduate / consolidate-21d / group）不是枚举成员（见文件头登记）。
const TYPE_ORDER = [
  "transfer-first",      // L0（GF-2，阻塞于缺口 G1，本期不产出）
  "application-first",   // L0（GF-2）
  "kp-strong",           // L0（GF-2）
  "kp-functional",       // L0（GF-2）
  "structure-link",      // L1（GF-2）
  "domain-entry",        // L1（GF-1 简化版已产出；GF-2 升级为 Frontier 口径）
  "material",            // L2（GF-1，累计巩固关口）
  "leech-recovery",      // L2（GF-1）
  "relearning-recovery", // L2（GF-1）
  "retention-180",       // L2（GF-1）
  "retention-60"         // L3（GF-1，仅汇总）
];

// tier 即提示优先级（§4.17-5：L0 能力=0 / L1 结构=1 / L2 建制=2 / L3 次要=3）。
const TIER_BY_TYPE = {
  "transfer-first": 0, "application-first": 0, "kp-strong": 0, "kp-functional": 0,
  "structure-link": 1, "domain-entry": 1,
  "material": 2, "leech-recovery": 2, "relearning-recovery": 2, "retention-180": 2,
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
  materialSampleMin: 8, // Territory 行样本门槛（保留；不再是 material 事件门槛）
  materialHalfRatio: 0.5, // Territory 现状标记 crossedHalf（保留；现状口径，非事件口径）
  materialFullRatio: 1,   // Territory 现状标记 crossedFull（保留；现状口径，非事件口径）
  materialStep: 50,     // v49.23（D196）：材料累计巩固关口步长——每 50 一档、无上限
  leechRecoveryStabilityDays: 21
});

// ---------- 通用底座 ----------

// firstCrossing(series, threshold)：任意 (实体, 维度) 时间序列的**首个**跨档点（§3.2 通用底座）。
// 输入 series = [{seq, at, value}]（seq=review_seq，at=reviewed_at，value=指标值）；输出 = {seq, at} | null。
// v49.23（D196）语义变更——**只取首个跨档点，不再「掉回阈值下方即重新武装」**（P3 一次即永）：
//  - 旧 armed 语义会让「值掉回阈值下、之后再次跨过」产生第二次命中（A2 反模式）；单卡 stability 类事件
//    掉回的真实来源常是「一次遗忘」，逐次重报会在难卡上重复刷同一条里程碑。
//  - 撤销回退语义不变：日志被物理删除 = 序列自然回退 = 若首个跨档点消失则顺延到下一个（§4.17-6②，静默）。
//  - 阈值判定一律 value >= threshold（首达语义）。
function firstCrossing(series, threshold) {
  const pts = (series || [])
    .filter((p) => p && Number.isFinite(p.seq) && Number.isFinite(p.value))
    .sort((a, b) => a.seq - b.seq);
  return pts.find((p) => p.value >= threshold) || null;
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

// 「曾进入长期记忆」的历史锚点（v49.23 / D196）：该卡**最早**一条 after 满足 isConsolidated 的可读日志。
// 无此类日志（含 v22 前无可读快照的旧卡）→ null（不贡献计数 / 锚点）——历史累计必须有真实评分时刻可锚，
// 故本口径不用旧的「按当前状态恒定参与」妥协（宁可少报不可误报）。
function everConsolidatedSeq(card) {
  const logs = (card.logs || [])
    .filter((l) => l && Number.isFinite(l.reviewSeq) && l.after && typeof l.after === "object")
    .sort((a, b) => a.reviewSeq - b.reviewSeq);
  for (const l of logs) if (isConsolidated(l.after)) return { seq: l.reviewSeq, at: l.reviewedAt };
  return null;
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
    const c = firstCrossing(retentionSeries, def.threshold); // 首次跨档（不再重新武装，D196）
    if (!c) continue;
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

  // —— relearning-recovery（每卡仅首次）——
  // 口径：存在日志 L 使 before.state==="relearning" && after.state==="review"，且为该卡**首次**成立。
  // D175（v49.1，用户 2026-10-15 裁定）：不再「掉回重新武装」——FSRS 里每次遗忘都会各走一遍
  // relearning→review，逐次计报会在难书上刷屏、稀释反馈成就感（§4.17-6①「每个 (事件类型, 实体, 维度)
  // 只报一次」的字面语义）。v49.23（D196）把同一原则推广到**全记忆层**（retention / leech / material 同样只取首达）。
  // 撤销回退语义不变：首条康复日志被撤销后，下一条康复自然成为「首次」（重放一致性 N-4/N-9）。
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
    const c = firstCrossing(leechSeries, 1); // 首次稳定（不再重新武装，D196）
    if (c) {
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

// ---------- 领域进入（GF-1 简化版，§3.2 deriveDomainEvents） ----------

// deriveDomainEvents(cardsWithLogs, now)：全量活跃卡行 → 每个 UDC 主领域码的首个「曾进入长期记忆」锚点。
// 口径（v49.23 / D196；GF-2 将把 domain-entry 升级为 Frontier 口径）：
//  某领域**首次**出现「曾进入长期记忆」的卡 → 一条 domain-entry（entity = 领域码，dimension = "entry"）。
//  - 「曾进入长期记忆」= 该卡存在某条可读日志其 after 满足 isConsolidated（review ∧ stability>21，漏斗同源）。
//  - 触发 = 该领域内**最早**的这类日志（argmin review_seq）；单调首次语义（一旦达成永不复报，P3）。
//  - 证据链 = 造成该首达的那张卡的 cardEvidence（可追溯到卡与来源，§4.17-7②）。
function deriveDomainEvents(cardsWithLogs, now) {
  void now;
  const cards = (cardsWithLogs || []).filter(isActiveCard);
  const first = new Map(); // domain → { seq, at, card }
  for (const c of cards) {
    const dom = Array.isArray(c.domain) && c.domain.length ? String(c.domain[0]) : null;
    if (!dom) continue;
    const a = everConsolidatedSeq(c);
    if (!a) continue;
    const cur = first.get(dom);
    if (!cur || a.seq < cur.seq) first.set(dom, { seq: a.seq, at: a.at, card: c });
  }
  const hits = [];
  for (const [dom, a] of first) {
    hits.push(makeHit({
      type: "domain-entry",
      entityId: dom,
      entityLabel: dom, // 展示名由文案层 udcLabel 映射
      dimension: "entry",
      triggerSeq: a.seq,
      triggerAt: a.at,
      evidence: cardEvidence(a.card)
    }));
  }
  return hits.sort(compareHits);
}

// ---------- 材料级事件（§3.2 deriveMaterialEvents） ----------

// deriveMaterialEvents(cardsWithLogs, now, params)：书 / 领域 → 活跃卡集 → **累计巩固关口**命中。
// 口径（v49.23 / D196，取代 D129 的「覆盖率过半 / 全覆盖」）：
//  - 关口 N = THRESHOLDS.materialStep 的整数倍（50, 100, 150, …, **无上限**）。
//  - 量 = 该材料**累计「曾进入长期记忆」的卡数**（每卡自其最早的达标日志起计入）；**单调不减**
//    → 每个关口恰好命中一次、不随材料扩容漂移、不重新武装（P2 单调性 / P3 一次即永）。
//  - 实体两键：书（libraryItemId，经 contextRef.documentId 归属——join 在 db 出口完成）与 UDC 主领域码（domain[0]）。
//  - dimension = `${kind}:${N}`（如 "book:150"）；params 为预留位（关口定稿在本模块，不外放）。
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

// 单个材料（书或领域）的「累计巩固关口」命中。
// 每个成员贡献一个历史锚点 = 其「曾进入长期记忆」的最早日志；按 seq 升序即为累计计数的到达顺序，
// 故第 N 个锚点就是「累计数首次达到 N」的那一刻（N = 50, 100, 150, …）。新增卡只会追加更晚的锚点，
// **不会重排已有锚点** → 历史关口不漂移。
function materialCrossings(entityId, members, kind) {
  const anchors = [];
  for (const m of members) {
    const a = everConsolidatedSeq(m);
    if (a) anchors.push(a);
  }
  if (!anchors.length) return [];
  anchors.sort((a, b) => a.seq - b.seq || a.at - b.at);
  const total = anchors.length;
  const label = kind === "book"
    ? String((members.find((m) => m.docTitle) || {}).docTitle || entityId)
    : String(entityId); // 领域维 entityLabel = UDC 主领域码（展示名由文案层映射）
  const evidence = kind === "book"
    ? { libraryItemId: String(entityId), docTitle: label }
    : {};
  const hits = [];
  for (let n = THRESHOLDS.materialStep; n <= total; n += THRESHOLDS.materialStep) {
    const a = anchors[n - 1];
    hits.push(makeHit({
      type: "material",
      entityId: String(entityId),
      entityLabel: label,
      dimension: `${kind}:${n}`,
      triggerSeq: a.seq,
      triggerAt: a.at,
      evidence
    }));
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
  firstCrossing,
  isConsolidated,
  compareHits,
  // 事件派生（GF-1 记忆层）
  deriveCardEvents,
  deriveDomainEvents,
  deriveMaterialEvents,
  buildTerritory,
  // 选级 / 折叠
  pickTopEvent,
  foldSameDay,
  // GF-2 预留（不实现，见函数注释）
  deriveKnowledgeEvents,
  // 机读常量（§6.6.1 表序 / tier / 投放面 / D196 阈值定稿值）
  TYPE_ORDER,
  TIER_BY_TYPE,
  SURFACE_BY_TYPE,
  THRESHOLDS
};
