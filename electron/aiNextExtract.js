// v48.22（M16 / §6.4.1 两段式 E1）：AI 推送引擎的**本地因子层**。
// 纯函数、零 IO、零随机源——同一输入必得同一输出（可逐字节断言）。
//
// 契约边界（务必如实告知用户，勿夸大）：
//  · 本模块只出**确定性排序 + 可验证的一句话理由**；
//  · §6.4.1 的「AI 对到期批重排并给解释」与 KP_frontier（知识前沿六因子）**均未接入**——
//    前者若在无 K4–K5 知识模型数据时硬做，就是没有依据的重排，违反本项目「AI 只提议、须有依据」的纪律；
//    故两者一并等 K4–K5 落地后按 E2 补齐（设置页已如实标注）。

const { validateExtractRerankOutput } = require("./kpScopes");

const DAY = 86400000;
const STALE_WINDOW_DAYS = 30;   // 逾期加成窗口：30 天封顶（本项目产品选择，无外部依据）
const POSTPONE_SATURATION = 10; // 推迟计数饱和点（之后不再加分）
const DIVERSITY_PENALTY = 0.35; // 同书连击的逐条降权系数

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 打分并排序（降序）。因子：
 *  userPriority = 1 − priority/100（优先级数字越小越优先，**原样尊重不反转**）
 *  dueBoost     = 1 + min(逾期天数, 30)/30（已到期越久越优先，最多 +100%）
 *  staleness    = 1 + min(postponeCount, 10)/20（搁置越久温和加分，防永久沉底）
 *  depthBonus   = 子摘录（更具体的最小单元）略优先
 *  diversity    = 同一本书的第 n 条按 1/(1 + 0.35n) 降权（防隧道）
 *  kpFactor     = E2（D124 / 设计稿 §9.5）可选的 KP 就绪度因子，0.85..1.30；opts.kpFactorOf 未传时恒 1（E1 行为逐字节不变）
 */
function scoreExtracts(items, nowTs, opts = {}) {
  const now = Number(nowTs) || Date.now();
  const list = Array.isArray(items) ? items : [];
  const scored = list.map((e) => {
    const priority = clamp(Number(e.priority) || 0, 0, 100);
    const dueAt = Number(e.topicNextAt) || now;
    const overdueDays = Math.max(0, (now - dueAt) / DAY);
    const postponeCount = Math.max(0, Number(e.postponeCount) || 0);
    const depth = Math.max(1, Number(e.depth) || 1);
    const userPriority = 1 - priority / 100;
    const dueBoost = 1 + Math.min(overdueDays, STALE_WINDOW_DAYS) / STALE_WINDOW_DAYS;
    const staleness = 1 + Math.min(postponeCount, POSTPONE_SATURATION) / 20;
    const depthBonus = depth > 1 ? 1.05 : 1;
    // E2：KP 就绪度因子（learnerRefresh 刷新后经 db.setKpFactorMap 注入；不传 opts 时与原实现逐字节一致）
    const kf = typeof opts.kpFactorOf === "function" ? Number(opts.kpFactorOf(e.id)) || 1 : 1;
    return {
      id: String(e.id),
      base: userPriority * dueBoost * staleness * depthBonus * kf,
      factors: { userPriority, dueBoost, staleness, depthBonus, kpFactor: kf, overdueDays, postponeCount, priority, depth },
      dueAt,
      libraryItemId: e.libraryItemId ?? null,
      item: e
    };
  });
  // 多样性：先按基础分降序，再对同书连击降权后重排（两步都无随机源）
  scored.sort((a, b) => b.base - a.base || a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  const seen = new Map();
  for (const it of scored) {
    const key = it.libraryItemId ? String(it.libraryItemId) : "none";
    const n = seen.get(key) || 0;
    it.diversityBurst = n;
    it.score = n === 0 ? it.base : it.base / (1 + DIVERSITY_PENALTY * n);
    seen.set(key, n + 1);
  }
  scored.sort((a, b) => b.score - a.score || a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  return scored;
}

/** 可验证的一句话理由：数字全部取自该条自身的因子，禁止编造 */
function explainExtract(entry) {
  const f = entry.factors;
  const bits = [
    `优先级 ${f.priority}`,
    f.overdueDays >= 1 ? `已逾期 ${Math.round(f.overdueDays)} 天` : "刚到期",
    f.postponeCount > 0 ? `已推迟 ${f.postponeCount} 次` : null,
    f.depth > 1 ? `第 ${f.depth} 层摘录` : null,
    entry.diversityBurst > 0 ? `同书第 ${entry.diversityBurst + 1} 条（已降权）` : null
  ].filter(Boolean);
  return `${bits.join(" · ")}｜得分 ${entry.score.toFixed(3)}`;
}

/** 对外出口：排序并附带理由（不改变调用方数据，返回浅包装）；opts 原样传给 scoreExtracts（E2 kpFactorOf） */
function rankExtracts(items, nowTs, opts = {}) {
  return scoreExtracts(items, nowTs, opts).map((entry) => ({
    ...entry.item,
    engineScore: Number(entry.score.toFixed(6)),
    engineReason: explainExtract(entry)
  }));
}

/** 候选指纹：用于判断缓存的 AI 重排是否还新鲜（候选集合或关键字段一变即失效） */
function rerankFingerprint(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((e) => `${e.id}:${e.priority}:${Number(e.topicNextAt) || 0}:${String(e.contentMarkdown ?? "").length}`)
    .sort()
    .join("|");
}

/**
 * E1 的 AI 层（§6.4.1 两段式）：把**本地序**交给模型重排并要一句理由，全部经本地裁决器过滤。
 * callAI 由调用方注入（主进程传真实网关、测试传假函数）⇒ 本函数本身仍是纯逻辑、可单测。
 * 任何失败（调用异常 / 输出不可解析 / 全员越界）**一律回退本地序**，并如实回报 issues。
 */
async function rankWithAI(items, nowTs, callAI) {
  const now = Number(nowTs) || Date.now();
  const local = rankExtracts(items, now);
  if (typeof callAI !== "function" || local.length === 0) {
    return { items: local, usedAI: false, issues: [{ code: "AI_UNAVAILABLE", message: "未提供 AI 调用或候选为空" }] };
  }
  const candidates = local.slice(0, 20).map((e) => ({
    id: e.id,
    text: String(e.contentMarkdown ?? "").slice(0, 160),
    priority: e.priority,
    sourceTitle: e.docTitle ?? "",
    overdueDays: Math.max(0, Math.round((now - (Number(e.topicNextAt) || now)) / DAY)),
    localScore: e.engineScore
  }));
  let raw = null;
  try {
    raw = await callAI({ candidates });
  } catch (err) {
    return { items: local, usedAI: false, issues: [{ code: "AI_CALL_FAILED", message: String((err && err.message) || err) }] };
  }
  const { value, issues } = validateExtractRerankOutput(raw, { candidates });
  if (!value) return { items: local, usedAI: false, issues };
  // AI 只重排「它看过的那 20 条」；没提到的按本地序追加（**不丢条**），超出 20 条的一律保持本地序
  const pos = new Map(value.order.map((o, i) => [o.id, i]));
  const aiReason = new Map(value.order.filter((o) => o.reason).map((o) => [o.id, o.reason]));
  const out = local
    .map((e, i) => ({ e, key: pos.has(e.id) ? pos.get(e.id) : Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ e }) =>
      aiReason.has(e.id) ? { ...e, aiReason: aiReason.get(e.id), engineReason: `AI：${aiReason.get(e.id)}｜${e.engineReason}` } : e
    );
  return { items: out, usedAI: true, issues };
}

module.exports = {
  scoreExtracts,
  explainExtract,
  rankExtracts,
  rankWithAI,
  rerankFingerprint,
  STALE_WINDOW_DAYS,
  DIVERSITY_PENALTY
};
