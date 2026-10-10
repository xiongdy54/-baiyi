// D124 学习者模型 LM-1（设计稿 §6.3/§6.4/§6.6/§6.7）：掌握水平判定的纯函数层。
// retrievability / computeKpLevel（KP 五级）/ computeLexState（词项五态）/ computePasses（通读次数）。
// 零 IO；依赖方向 lmLex ← lmLevels（§0.1-10）。
const lmParams = require("./lmParams");

// ---------- FSRS 可提取率（设计稿 §6.3，公式照抄） ----------

function retrievability(elapsedDays, stability, decay) {
  if (!(stability > 0)) return 0;
  const d = -Math.abs(decay || lmParams.FSRS_DEFAULT_DECAY);
  const factor = Math.pow(0.9, 1 / d) - 1;
  return Math.pow(1 + factor * Math.max(0, elapsedDays) / stability, d);
}

// ---------- KP 掌握等级（设计稿 §6.6 computeKpLevel，从高到低第一个满足即结果） ----------

const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

function computeKpLevel(input) {
  const cards = Array.isArray(input.cards) ? input.cards : [];
  const extractCount = Number(input.extractCount) || 0;
  const passedUnitCount = Number(input.passedUnitCount) || 0;
  const selfExplainClear90 = Number(input.selfExplainClear90) || 0;
  const reviewed = cards.filter((c) => c.reviewed);
  const n = reviewed.length;
  const meanR = n > 0 ? reviewed.reduce((s, c) => s + (Number(c.R) || 0), 0) / n : 0;
  const stableRatio = n > 0 ? reviewed.filter((c) => (Number(c.S) || 0) >= lmParams.KP.STABLE_S).length / n : 0;
  const longRatio = n > 0 ? reviewed.filter((c) => (Number(c.S) || 0) >= lmParams.KP.LONG_S).length / n : 0;
  const lapses30Total = reviewed.reduce((s, c) => s + (Number(c.lapses30) || 0), 0);
  const types = new Set(reviewed.map((c) => String(c.cardType || "qa")));
  const hasDeep =
    reviewed.some((c) => c.cardType === "application" && (Number(c.lastRating) || 0) >= 3) || selfExplainClear90 >= 1;
  // distinctDays 按自然日去重（本地时区年月日）。v1 有意不用学习日切点 dayCutoffHour：
  // 这里只关心「是否跨天」，差几小时不影响判定（设计稿 §6.6）。
  const days = new Set();
  let totalReviews = 0;
  for (const c of reviewed) {
    totalReviews += Number(c.reviewCount) || 0;
    if (c.reviewDays) for (const d of c.reviewDays) days.add(String(d));
  }
  const distinctDays = days.size;

  let level = 0;
  if (
    n >= 2 &&
    meanR >= lmParams.KP.R_SOLID &&
    longRatio >= lmParams.KP.LONG_RATIO &&
    lapses30Total === 0 &&
    (hasDeep || (n >= 3 && types.size >= 2))
  ) {
    level = 4;
  } else if (n >= 1 && meanR >= lmParams.KP.R_CONSOL && stableRatio >= lmParams.KP.STABLE_RATIO) {
    level = 3;
  } else if (n >= 1) {
    level = 2;
  } else if (cards.length >= 1 || extractCount >= 1 || passedUnitCount >= 1) {
    level = 1;
  }

  const fading = n >= 1 && stableRatio >= lmParams.KP.STABLE_RATIO && meanR < lmParams.KP.R_FADING;
  let confidence = "low";
  if (n >= 3 && totalReviews >= 6 && distinctDays >= 3) confidence = "high";
  else if (n >= 1 && totalReviews >= 3) confidence = "medium";

  let score = 0;
  if (level === 1) score = 0.15;
  else if (level === 2) score = 0.3 + 0.2 * meanR;
  else if (level === 3) score = 0.6 + 0.2 * meanR;
  else if (level === 4) score = 0.85 + 0.15 * meanR;

  const metrics = {
    n,
    meanR: round3(meanR),
    stableRatio: round3(stableRatio),
    longRatio: round3(longRatio),
    lapses30Total,
    types: [...types],
    hasDeep,
    distinctDays,
    totalReviews,
    extractCount,
    passedUnitCount
  };
  return { level, score, confidence, fading, metrics };
}

// ---------- 词项状态（设计稿 §6.7 computeLexState，从上到下第一个命中即返回） ----------

function computeLexState(input) {
  const now = Number(input.now) || Date.now();
  const exposurePasses = Number(input.exposurePasses) || 0;
  const exposureTokens = Number(input.exposureTokens) || 0;
  const lookupTimes = (Array.isArray(input.lookupTimes) ? input.lookupTimes : []).map(Number).filter(Boolean);
  const passesAfterLastLookup = Number(input.passesAfterLastLookup) || 0;
  const lastMark = input.lastMark || null;
  const card = input.card || null;
  const placementKnown = Boolean(input.placementKnown);

  const lastLookupAt = lookupTimes.length > 0 ? Math.max(...lookupTimes) : null;

  // 1 mark：标记存在，且（没有查词，或最后一次查词早于标记）
  if (lastMark && (lastLookupAt === null || lastLookupAt < lastMark.ts)) {
    return lastMark.mark === "known"
      ? { state: "known", source: "mark" }
      : { state: "learning", source: "mark" };
  }
  // 2 card：词汇卡
  if (card) {
    return (Number(card.S) || 0) >= lmParams.LEX.CARD_KNOWN_S && (Number(card.R) || 0) >= lmParams.LEX.CARD_KNOWN_R
      ? { state: "known", source: "card" }
      : { state: "learning", source: "card" };
  }
  // 3 lookup：查过 → 反复接触后自然掌握
  if (lookupTimes.length > 0) {
    if (
      passesAfterLastLookup >= lmParams.LEX.POST_LOOKUP_PASSES &&
      now - lastLookupAt >= lmParams.LEX.POST_LOOKUP_DAYS * lmParams.DAY_MS
    ) {
      return { state: "familiar", source: "lookup" };
    }
    return { state: "learning", source: "lookup" };
  }
  // 4 placement：快测判定
  if (placementKnown) return { state: "known", source: "placement" };
  // 5 exposure：母语式附带习得（3 次以上通读里出现 8 次以上且从没查过）
  if (exposurePasses >= lmParams.LEX.FAMILIAR_PASSES && exposureTokens >= lmParams.LEX.FAMILIAR_TOKENS) {
    return { state: "familiar", source: "exposure" };
  }
  // 6 seen
  if (exposurePasses >= 1) return { state: "seen", source: "seen" };
  // 7 none
  return { state: "unknown", source: "none" };
}

// ---------- 通读次数（设计稿 §6.4 computePasses；非 PDF 材料专用） ----------

function computePasses(events, units, docLen) {
  const evs = (Array.isArray(events) ? events : [])
    .map((e) => ({ char_pos: Number(e.char_pos) || 0, created_at: Number(e.created_at) || 0 }))
    .filter((e) => e.char_pos <= Number(docLen)) // char_pos > docLen 直接丢弃（旧自渲染坐标系事件）
    .sort((a, b) => a.created_at - b.created_at);
  const us = (Array.isArray(units) ? units : [])
    .filter((u) => u && Number.isFinite(Number(u.mdTo)))
    .map((u) => ({ id: String(u.id), mdTo: Number(u.mdTo) }))
    .sort((a, b) => a.mdTo - b.mdTo);
  const result = new Map();
  if (us.length === 0 || evs.length < 2) return result;
  const last = us[us.length - 1];
  const record = (unitId, ts) => {
    if (!result.has(unitId)) result.set(unitId, []);
    result.get(unitId).push(ts);
  };
  // 相邻事件时间差 > SESSION_GAP_MS 切 session
  const sessions = [];
  let cur = [evs[0]];
  for (let i = 1; i < evs.length; i++) {
    if (evs[i].created_at - evs[i - 1].created_at > lmParams.SESSION_GAP_MS) {
      sessions.push(cur);
      cur = [evs[i]];
    } else {
      cur.push(evs[i]);
    }
  }
  sessions.push(cur);
  for (const session of sessions) {
    const passedInSession = new Set();
    for (let i = 1; i < session.length; i++) {
      const a = session[i - 1];
      const b = session[i];
      const step = b.char_pos - a.char_pos;
      if (step <= 0 || step > lmParams.JUMP_CHARS) continue; // 往回翻或目录跳转不算读
      for (const u of us) {
        if (a.char_pos < u.mdTo && b.char_pos >= u.mdTo && !passedInSession.has(u.id)) {
          record(u.id, b.created_at);
          passedInSession.add(u.id);
        }
      }
      // 末尾规则：读到全书的 97% 记最后一个单元（只在有效步长的事件对里生效）
      if (
        b.char_pos >= Number(docLen) * lmParams.END_RATIO &&
        !passedInSession.has(last.id) &&
        a.char_pos < last.mdTo
      ) {
        record(last.id, b.created_at);
        passedInSession.add(last.id);
      }
    }
  }
  return result;
}

// 合并通读时间戳（设计稿 §6.4）：去重、升序、只保留最后 20 个
function mergePassTimestamps(oldArr, additions) {
  const set = new Set((Array.isArray(oldArr) ? oldArr : []).map(Number).filter(Boolean));
  for (const ts of Array.isArray(additions) ? additions : []) set.add(Number(ts));
  const arr = [...set].sort((a, b) => a - b);
  return arr.slice(Math.max(0, arr.length - 20));
}

module.exports = { retrievability, computeKpLevel, computeLexState, computePasses, mergePassTimestamps, round3 };
