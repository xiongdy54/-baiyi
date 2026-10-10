// D124 学习者模型 LM-1（设计稿 §6.9/§7/§8）：推荐引擎纯函数层。
// 轨道提议 / 归属 / 权重 → 13 个候选生成器 → 加权和打分 → 轨道配额 + 多样性选取 → 理由文案。
// 零 IO、零随机源（同一快照结果恒等）；依赖方向 lmLevels ← lmRecommend，lmStrings 只被本模块使用（§0.1-10）。
const crypto = require("node:crypto");
const lmParams = require("./lmParams");
const lmLex = require("./lmLex");
const lmStrings = require("./lmStrings");

const P = lmParams;
const DAY = P.DAY_MS;

// ---------- 小工具 ----------

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
function clamp01(x) {
  return clamp(Number(x) || 0, 0, 1);
}
function round6(x) {
  return Math.round((Number(x) || 0) * 1e6) / 1e6;
}
function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}
function sortedKeys(map) {
  return [...map.keys()].sort();
}
function fmtTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? String(vars[k]) : ""));
}

// 阅读速度（设计稿 §8.2 K1）：zh ja ko 及无空格语言 400 字/分，其他 1000 字符/分
function isCjkLang(lang) {
  const l = String(lang || "").toLowerCase();
  return ["zh", "ja", "ko"].includes(l) || ["th", "lo", "km", "my", "bo"].includes(l);
}
function readMinutes(plainLen, lang) {
  const speed = isCjkLang(lang) ? P.READ_SPEED.cjk : P.READ_SPEED.other;
  return Math.ceil((Number(plainLen) || 0) / speed);
}

// ---------- UDC 叶子默认 mode（设计稿 §3.1） ----------
const UDC_DEFAULT_MODE = {
  "004": "procedural",
  "51": "procedural",
  "62": "procedural",
  "61": "factual",
  "32": "factual",
  "91": "factual",
  "8": "narrative"
};
function defaultModeForUdc(leaf) {
  return UDC_DEFAULT_MODE[String(leaf)] || "concept";
}

// ---------- 系统提议轨道（设计稿 §6.9 proposeTracks，纯函数） ----------
// input: { materials, cardUdcCounts, nativeLangs, tracks, uiLocale, udcLabels }
// materials: [{ id, lang, dominantUdc, lexicalUdcCounts }]

function materialAutoLeaves(m) {
  // 自动归属叶子：dominantUdc 命中，或 lexical 信号（不同 lexical KP ≥ 5）
  const out = new Set();
  if (m.dominantUdc) out.add(String(m.dominantUdc));
  const lex = m.lexicalUdcCounts || {};
  for (const leaf of Object.keys(lex).sort()) {
    if (Number(lex[leaf]) >= 5) out.add(leaf);
  }
  return out;
}

function proposeTracks(input) {
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const cardUdcCounts = input.cardUdcCounts || {};
  const nativeLangs = new Set((Array.isArray(input.nativeLangs) ? input.nativeLangs : []).map((l) => String(l).toLowerCase()));
  const tracks = Array.isArray(input.tracks) ? input.tracks : [];
  const uiLocale = input.uiLocale || "zh";
  const udcLabels = input.udcLabels || {};

  const proposals = [];
  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames([uiLocale], { type: "language" });
  } catch {
    displayNames = null;
  }
  const langName = (code) => {
    try {
      return (displayNames && displayNames.of(code)) || code;
    } catch {
      return code;
    }
  };

  // 已有轨道 → 不再提议同 lang 的 language / 含该叶子的非 language
  const hasLangTrack = new Set(tracks.filter((t) => t.mode === "language").map((t) => String(t.lang || "").toLowerCase()));
  const leavesInTracks = new Set();
  for (const t of tracks) {
    if (t.mode !== "language") for (const c of t.udcCodes || []) leavesInTracks.add(String(c));
  }

  // 语言提议：材料语言非空且不在母语生效值中，每种语言 ≥ 1 份材料
  const langCount = new Map();
  for (const m of materials) {
    const l = String(m.lang || "").toLowerCase();
    if (!l) continue;
    langCount.set(l, (langCount.get(l) || 0) + 1);
  }
  for (const l of [...langCount.keys()].sort()) {
    if (nativeLangs.has(l) || hasLangTrack.has(l)) continue;
    proposals.push({ key: `lang:${l}`, label: langName(l), mode: "language", lang: l, udcCodes: [] });
  }

  // UDC 叶子提议：卡片数 ≥ 5 或自动归属材料 ≥ 2
  const autoMaterialCount = new Map();
  for (const m of materials) {
    for (const leaf of materialAutoLeaves(m)) autoMaterialCount.set(leaf, (autoMaterialCount.get(leaf) || 0) + 1);
  }
  const leaves = new Set([...Object.keys(cardUdcCounts), ...autoMaterialCount.keys()]);
  for (const leaf of [...leaves].sort()) {
    if (leavesInTracks.has(leaf)) continue;
    const cardN = Number(cardUdcCounts[leaf]) || 0;
    const matN = Number(autoMaterialCount.get(leaf)) || 0;
    if (cardN < 5 && matN < 2) continue;
    proposals.push({
      key: `udc:${leaf}`,
      label: String(udcLabels[leaf] || leaf),
      mode: defaultModeForUdc(leaf),
      lang: "",
      udcCodes: [leaf]
    });
  }
  return proposals;
}

// ---------- 材料归属（设计稿 §6.9 resolveMembership，纯函数） ----------
// overrides: Map<`${trackId}:${libraryItemId}`, member(0|1)>

function resolveMembership(track, material, overrides) {
  const key = `${track.id}:${material.id}`;
  const ov = overrides ? overrides.get(key) : undefined;
  if (ov !== undefined) return ov === 1; // 人工覆盖：member=1 加入 / member=0 排除
  if (track.mode === "language") {
    return String(material.lang || "").toLowerCase() === String(track.lang || "").toLowerCase();
  }
  if (material.dominantUdc && (track.udcCodes || []).includes(String(material.dominantUdc))) return true;
  // 不足 3 张卡（dominantUdc 为空）时改用 lexical 信号：track 各叶子的 lexical KP 数之和 ≥ 5
  let lexSum = 0;
  const lex = material.lexicalUdcCounts || {};
  for (const leaf of track.udcCodes || []) lexSum += Number(lex[leaf]) || 0;
  return lexSum >= 5;
}

// ---------- 轨道权重（设计稿 §6.9） ----------
// activity: Record<trackId, number[]>（近 28 天每日 a_d，下标 0 = 今天）

function trackWeights(tracks, activity) {
  const act = {};
  for (const t of tracks) {
    const arr = (activity && activity[t.id]) || [];
    let sum = 0;
    for (let d = 0; d < arr.length; d++) {
      sum += (Number(arr[d]) || 0) * Math.pow(0.5, d / P.TRACK.HALF_LIFE_DAYS);
    }
    act[t.id] = sum;
  }
  const active = tracks.filter((t) => t.status === "active");
  const totalAct = active.reduce((s, t) => s + act[t.id], 0);
  const share = {};
  for (const t of tracks) {
    if (t.status !== "active" || active.length === 0) {
      share[t.id] = 0;
      continue;
    }
    share[t.id] = totalAct > 0 ? act[t.id] / totalAct : 1 / active.length;
  }
  const raw = {};
  for (const t of tracks) {
    if (t.status !== "active") {
      raw[t.id] = 0;
      continue;
    }
    let w = share[t.id] * ((Number(t.priority) || 3) / 3);
    if (t.pinned) w = Math.max(w, P.TRACK.PINNED_MIN_SHARE); // 冷启动加成：pinned 最低 0.3 份额
    raw[t.id] = w;
  }
  const total = Object.keys(raw).reduce((s, k) => s + raw[k], 0);
  const weights = {};
  for (const k of Object.keys(raw).sort()) {
    weights[k] = total > 0 ? raw[k] / total : 0;
  }
  return { weights, activity: act };
}

// ---------- 快照视图（不可变索引，供生成器查询） ----------

function buildView(snapshot) {
  const materialsById = new Map();
  for (const m of snapshot.materials || []) materialsById.set(String(m.id), m);
  const unitsById = new Map();
  const unitsByMaterial = new Map();
  for (const u of snapshot.units || []) {
    unitsById.set(String(u.id), u);
    const item = String(u.libraryItemId);
    if (!unitsByMaterial.has(item)) unitsByMaterial.set(item, []);
    unitsByMaterial.get(item).push(u);
  }
  for (const arr of unitsByMaterial.values()) arr.sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0));
  const kpsById = new Map();
  for (const k of snapshot.kps || []) kpsById.set(String(k.id), k);
  const extractsById = new Map();
  for (const e of snapshot.extracts || []) extractsById.set(String(e.id), e);
  const linkedKpIds = new Set(); // 有 unit_kp_links 的 KP
  for (const u of snapshot.units || []) {
    for (const l of u.kpLinks || []) linkedKpIds.add(String(l.kpId));
  }
  return { materialsById, unitsById, unitsByMaterial, kpsById, extractsById, linkedKpIds };
}

// ---------- 信号计算（设计稿 §7.2） ----------

function lastPassTsOfMaterial(view, itemId) {
  let last = 0;
  for (const u of view.unitsByMaterial.get(String(itemId)) || []) {
    for (const ts of u.passes || []) last = Math.max(last, Number(ts) || 0);
  }
  return last;
}

function noveltyOf(unit, view) {
  const links = unit.kpLinks || [];
  if (links.length === 0) {
    return (unit.passes || []).length > 0 ? 0.1 : 0.6; // 未读 0.6、已读 0.1
  }
  let low = 0;
  for (const l of links) {
    const kp = view.kpsById.get(String(l.kpId));
    if (kp && Number(kp.level) <= 1) low += 1;
  }
  return low / links.length;
}

function readinessOf(unit, view) {
  const weighted = new Map(); // kpId → weight
  for (const l of unit.kpLinks || []) {
    const kp = view.kpsById.get(String(l.kpId));
    for (const pre of (kp && kp.prereqIds) || []) {
      weighted.set(String(pre), Math.max(weighted.get(String(pre)) || 0, 1.0));
    }
  }
  // 同材料上一单元（ord−1）链接的 KP，权重 0.5
  const arr = view.unitsByMaterial.get(String(unit.libraryItemId)) || [];
  const idx = arr.findIndex((x) => String(x.id) === String(unit.id));
  if (idx > 0) {
    for (const l of arr[idx - 1].kpLinks || []) {
      weighted.set(String(l.kpId), Math.max(weighted.get(String(l.kpId)) || 0, 0.5));
    }
  }
  if (weighted.size === 0) return P.READINESS_EMPTY;
  let sum = 0;
  let total = 0;
  for (const kpId of sortedKeys(weighted)) {
    const w = weighted.get(kpId);
    const kp = view.kpsById.get(kpId);
    const score = kp ? Number(kp.score) || 0 : 0;
    sum += w * Math.min(1, score / P.READY_SCORE);
    total += w;
  }
  return total > 0 ? sum / total : P.READINESS_EMPTY;
}

function recyclingOf(unit) {
  return Math.min(1, (Number(unit.learningCount) || 0) / 20);
}

function momentumFromTs(now, ts) {
  if (!ts) return 0;
  const d = (now - ts) / DAY;
  if (d <= 3) return 1;
  if (d <= 14) return 0.5;
  return 0;
}
function materialMomentum(view, now, itemId) {
  return momentumFromTs(now, lastPassTsOfMaterial(view, itemId));
}
function kpMomentum(now, kp) {
  return momentumFromTs(now, Number(kp.lastReviewAt) || 0);
}

// ---------- 反馈分析（设计稿 §8.6 / §8.3） ----------

function analyzeFeedback(snapshot, tracks, trackOfMaterial) {
  const now = snapshot.now;
  const win = P.REC.FEEDBACK_WINDOW_DAYS * DAY;
  const rows = (snapshot.feedback || []).filter((f) => now - (Number(f.ts) || 0) <= win);
  // 反馈 → 轨道归属：先按最近一次 run 的 items 找 trackId，找不到按材料所属轨道
  const keyTrack = new Map();
  const lastRun = snapshot.lastRun;
  if (lastRun && Array.isArray(lastRun.items)) {
    for (const it of lastRun.items) keyTrack.set(String(it.key), String(it.trackId));
  }
  const trackOf = (itemId) => {
    for (const t of tracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (trackOfMaterial.get(String(itemId)) === t.id) return t.id;
    }
    return "";
  };
  const trackFor = (f) => {
    if (keyTrack.has(String(f.itemKey))) return keyTrack.get(String(f.itemKey));
    const itemId = f.libraryItemId ? String(f.libraryItemId) : "";
    if (itemId) return trackOf(itemId);
    return "";
  };
  const cooldown = new Map(); // itemKey → { until, action }
  const consider = (f, days) => {
    const until = (Number(f.ts) || 0) + days * DAY;
    const prev = cooldown.get(String(f.itemKey));
    if (!prev || until > prev.until) cooldown.set(String(f.itemKey), { until, action: f.action });
  };
  const kindNotInterested = new Map();
  const notInterestedMaterials = new Map(); // libraryItemId → until
  const trackNetRows = new Map(); // trackId → [{action, ts}]
  for (const f of rows) {
    const action = String(f.action || "");
    if (action === "done") consider(f, P.REC.DONE_COOLDOWN_H / 24);
    else if (action === "snooze") consider(f, P.REC.SNOOZE_DAYS);
    else if (action === "dismissed") consider(f, P.REC.DISMISS_DAYS);
    else if (action === "not_interested") {
      kindNotInterested.set(String(f.kind || ""), (kindNotInterested.get(String(f.kind || "")) || 0) + 1);
      if (f.libraryItemId) {
        const until = (Number(f.ts) || 0) + P.REC.NOT_INTERESTED_DAYS * DAY;
        const itemId = String(f.libraryItemId);
        notInterestedMaterials.set(itemId, Math.max(notInterestedMaterials.get(itemId) || 0, until));
      }
    } else if (action === "too_hard" || action === "too_easy") {
      const t = trackFor(f);
      if (t) {
        if (!trackNetRows.has(t)) trackNetRows.set(t, []);
        trackNetRows.get(t).push({ action, ts: Number(f.ts) || 0 });
      }
    }
  }
  // 每轨道近 20 条 too_hard/too_easy 的净值
  const trackNet = new Map();
  for (const t of sortedKeys(trackNetRows)) {
    const list = trackNetRows.get(t).sort((a, b) => b.ts - a.ts).slice(0, 20);
    let net = 0;
    for (const r of list) net += r.action === "too_hard" ? 1 : -1;
    trackNet.set(t, net);
  }
  const kindMultiplier = (kind) => {
    const c = kindNotInterested.get(String(kind)) || 0;
    return Math.max(P.REC.NOT_INTERESTED_FLOOR, Math.pow(P.REC.NOT_INTERESTED_DECAY, c));
  };
  return { cooldown, kindMultiplier, notInterestedMaterials, trackNet };
}

// ---------- 打分（设计稿 §8.3 加权和） ----------

function baseScore(f) {
  const W = P.REC.W;
  return W.fit * clamp01(f.fit) + W.value * clamp01(f.value) + W.urgency * clamp01(f.urgency) + W.momentum * clamp01(f.momentum) + W.priority * clamp01(f.priority);
}
function scoreCandidate(candidate, kindMultiplier) {
  const base = baseScore(candidate.f);
  const prior = P.REC.KIND_PRIOR[candidate.kind] ?? 1;
  return round6(base * prior * kindMultiplier);
}

// ---------- 生成器（设计稿 §8.2） ----------

// K14 placement（language，冷启动；不参与打分，直接占该轨道第一个名额）
function genPlacement(track, ctx) {
  if (track.mode !== "language" || !track.lang) return [];
  const st = ctx.snapshot.lexStats ? ctx.snapshot.lexStats[track.lang] : null;
  if (!st) return [];
  if (st.knownCount >= P.LEX.COLD_START_KNOWN || st.hasPlacement) return [];
  if ((Number(st.totalLexemes) || 0) < P.LEX.PLACEMENT_MIN_LEXEMES) return [];
  return [
    {
      key: `placement:${track.lang}`,
      kind: "placement",
      trackId: track.id,
      libraryItemId: undefined,
      kpId: undefined,
      facts: { minutes: 2 },
      f: { fit: 0, value: 0, urgency: 0, momentum: 0, priority: 0 },
      action: { type: "dialog", dialog: "placement", payload: { lang: track.lang } }
    }
  ];
}

// K1 continue（每份材料至多 1 个）
function genContinue(track, ctx) {
  const out = [];
  const now = ctx.snapshot.now;
  const isLang = track.mode === "language";
  const coldStart = isLang && ctx.coldStart(track);
  for (const m of ctx.materialsOf(track)) {
    const units = ctx.view.unitsByMaterial.get(String(m.id)) || [];
    const read = units.filter((u) => (u.passes || []).length > 0);
    if (read.length === 0) continue;
    const lastTs = Math.max(...read.map((u) => Math.max(...u.passes)));
    const d = (now - lastTs) / DAY;
    if (d > 60) continue; // 最近一次通读在 60 天内
    const maxReadOrd = Math.max(...read.map((u) => Number(u.ord) || 0));
    const target = units.find((u) => (Number(u.ord) || 0) > maxReadOrd);
    if (!target) continue;

    const novelty = noveltyOf(target, ctx.view);
    const readiness = readinessOf(target, ctx.view);
    // concept / procedural：先修未就绪 → 不出 K1，改出 K5 / K9（设计稿 §8.2 K1）
    if ((track.mode === "concept" || track.mode === "procedural") && readiness < P.READINESS_BLOCK) {
      out.push(...prereqBlockedAlternatives(track, ctx, target, readiness));
      continue;
    }
    let fit;
    let facts = { material: m.title, unitTitle: target.title, daysAgo: Math.floor(d), minutes: readMinutes(target.plainLen, m.lang) };
    let value;
    if (isLang) {
      const band = ctx.bandOf(track, Number(target.coverage) || 0);
      if (band === "hard" && !coldStart) continue; // hard 带过滤（冷启动轨道不过滤）
      fit = coldStart ? clamp01(target.easeFit ?? 0) : P.BAND_FIT[band];
      facts.coveragePct = Math.round((Number(target.coverage) || 0) * 100);
      facts.bandLabel = ctx.strings.bandNames[band];
      facts.learningCount = Number(target.learningCount) || 0;
      value = 0.5 + 0.5 * recyclingOf(target);
    } else {
      fit = conceptFit(track, ctx, readiness, novelty);
      const kpNames = topKpLabels(target, ctx, 2);
      if (kpNames.length > 0) facts.kpNames = kpNames.join(ctx.strings.kpNamesSep);
      value = 0.6 + 0.4 * novelty;
      if (track.mode === "narrative" || track.mode === "factual") value = 0.6;
    }
    const urgency = d < 1 ? 0 : d <= 7 ? d / 7 : d <= 30 ? 1 : 0.5;
    out.push({
      key: `continue:${m.id}`,
      kind: "continue",
      trackId: track.id,
      libraryItemId: String(m.id),
      unitId: String(target.id),
      facts,
      f: { fit, value, urgency, momentum: d <= 3 ? 1 : 0.5, priority: clamp01(1 - (Number(m.priority) || 0) / 100) },
      action: { type: "open-book", libraryItemId: String(m.id), hintUnitTitle: target.title }
    });
  }
  return out;
}

// K1 的先修未就绪替代项（K5 reinforce / K9 find-material）
function prereqBlockedAlternatives(track, ctx, target, readiness) {
  const now = ctx.snapshot.now;
  // 未就绪先修 KP：ready 不足的贡献者中 score 最低的（只看 prerequisite 前置，权重 1.0）
  let worst = null;
  let owner = null; // 要求该先修的 KP（单元链接的那一个）
  for (const l of target.kpLinks || []) {
    const kp = ctx.view.kpsById.get(String(l.kpId));
    for (const pre of (kp && kp.prereqIds) || []) {
      const p = ctx.view.kpsById.get(String(pre));
      if (!p) continue;
      const ready = Math.min(1, (Number(p.score) || 0) / P.READY_SCORE);
      if (ready >= 1) continue;
      if (!worst || (Number(p.score) || 0) < (Number(worst.score) || 0)) {
        worst = p;
        owner = kp;
      }
    }
  }
  if (!worst) return [];
  const facts = { kpName: worst.label, meanRPct: Math.round((Number(worst.metrics?.meanR) || 0) * 100), levelLabel: levelLabel(ctx.strings, worst), fading: worst.fading ? 1 : 0 };
  const f = { fit: 0.7, value: 1 - clamp01(Number(worst.metrics?.meanR) || 0), urgency: worst.fading ? 1 : 0.6, momentum: kpMomentum(now, worst), priority: 0.5 };
  if (worst.metrics && (Number(worst.metrics.n) || 0) > 0) {
    return [{ key: `reinforce:${worst.id}`, kind: "reinforce", trackId: track.id, kpId: String(worst.id), facts, f, action: reinforceAction(worst) }];
  }
  if (!ctx.view.linkedKpIds.has(String(worst.id))) {
    return [
      {
        key: `find:${worst.id}`,
        kind: "find-material",
        trackId: track.id,
        kpId: String(worst.id),
        facts: { prereqName: worst.label, kpName: owner ? owner.label : "" },
        f: { fit: 0.5, value: 0.5, urgency: 0.4, momentum: kpMomentum(now, worst), priority: 0.5 },
        action: { type: "copy-query", kpLabel: worst.label }
      }
    ];
  }
  return [];
}

function levelLabel(strings, kp) {
  const lv = clamp(Number(kp.level) || 0, 0, 4);
  return strings.levelNames[lv] + (kp.fading ? ` ${strings.fadingSuffix}` : "");
}

function reinforceAction(kp) {
  if (kp.dueToday) return { type: "review", scopeKpIds: [String(kp.id)] };
  const src = kp.firstSourceCard;
  if (src && src.documentId) return { type: "jump", documentId: String(src.documentId), anchor: src.anchor || {} };
  return { type: "review", scopeKpIds: [String(kp.id)] };
}

function topKpLabels(unit, ctx, n) {
  const links = (unit.kpLinks || [])
    .slice()
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0) || String(a.kpId).localeCompare(String(b.kpId)));
  const out = [];
  for (const l of links) {
    const kp = ctx.view.kpsById.get(String(l.kpId));
    if (kp && Number(kp.level) >= 1 && Number(kp.level) <= 3) {
      out.push(String(kp.label));
      if (out.length >= n) break;
    }
  }
  return out;
}

// 概念类挑战适配 fit（设计稿 §7.2）
function conceptFit(track, ctx, readiness, novelty) {
  const target = P.NOVELTY_TARGET - clamp((ctx.trackNet(track) * P.REC.NOVELTY_SHIFT_STEP) || 0, -P.REC.NOVELTY_SHIFT_MAX, P.REC.NOVELTY_SHIFT_MAX);
  const denom = Math.max(target, 1 - target);
  return clamp01(readiness * (1 - Math.abs(novelty - target) / denom));
}

// K2 start（每轨道至多 3 个候选）
function genStart(track, ctx) {
  const out = [];
  const isLang = track.mode === "language";
  const coldStart = isLang && ctx.coldStart(track);
  for (const m of ctx.materialsOf(track)) {
    const units = ctx.view.unitsByMaterial.get(String(m.id)) || [];
    if (units.length === 0) continue;
    if (units.some((u) => (u.passes || []).length > 0)) continue; // 所有单元都没有通读
    const target = units.find((u) => Number(u.plainLen) >= 300); // K2 首单元 ≥ 300 字（设计稿 §2.2-3 结构常数）
    if (!target) continue;
    const novelty = noveltyOf(target, ctx.view);
    const readiness = readinessOf(target, ctx.view);
    let fit;
    let facts = { material: m.title, unitTitle: target.title, minutes: readMinutes(target.plainLen, m.lang) };
    let value;
    if (isLang) {
      const band = ctx.bandOf(track, Number(target.coverage) || 0);
      if (band === "hard" && !coldStart) continue;
      fit = coldStart ? clamp01(target.easeFit ?? 0) : P.BAND_FIT[band];
      facts.coveragePct = Math.round((Number(target.coverage) || 0) * 100);
      facts.bandLabel = ctx.strings.bandNames[band];
      value = 0.4 + 0.6 * recyclingOf(target);
    } else {
      fit = conceptFit(track, ctx, readiness, novelty);
      value = 0.5 + 0.5 * novelty;
      if (track.mode === "narrative" || track.mode === "factual") value = 0.5;
    }
    out.push({
      key: `start:${m.id}`,
      kind: "start",
      trackId: track.id,
      libraryItemId: String(m.id),
      unitId: String(target.id),
      facts,
      f: { fit, value, urgency: 0.2, momentum: 0, priority: clamp01(1 - (Number(m.priority) || 0) / 100) },
      action: { type: "open-book", libraryItemId: String(m.id) }
    });
  }
  return out
    .sort((a, b) => scoreCandidate(b, 1) - scoreCandidate(a, 1) || a.key.localeCompare(b.key))
    .slice(0, 3);
}

// K3 extract-batch（每轨道至多 1 个；到期口径与 listDueExtracts 完全相同，由 refresh 组装进 snapshot.extracts）
function genExtractBatch(track, ctx) {
  const now = ctx.snapshot.now;
  const due = (ctx.snapshot.extracts || []).filter((e) => ctx.extractTrackOf(String(e.id)) === track.id);
  const n = due.length;
  if (n < 1) return [];
  const itemIds = [...new Set(due.map((e) => String(e.libraryItemId)))].sort();
  let maxOverdue = 0;
  for (const e of due) maxOverdue = Math.max(maxOverdue, Math.max(0, (now - (Number(e.topicNextAt) || now)) / DAY));
  const minPriority = Math.min(...due.map((e) => clamp(Number(e.priority) || 0, 0, 100)));
  const materialMomentumMax = Math.max(...itemIds.map((id) => materialMomentum(ctx.view, now, id)), 0);
  const sorted = due.slice().sort((a, b) => clamp(Number(a.priority) || 0, 0, 100) - clamp(Number(b.priority) || 0, 0, 100) || String(a.id).localeCompare(String(b.id)));
  return [
    {
      key: `extract-batch:${track.id}`,
      kind: "extract-batch",
      trackId: track.id,
      extractIds: due.map((e) => String(e.id)).sort(),
      facts: { count: n, maxOverdueDays: Math.floor(maxOverdue), topSnippet: String(sorted[0].snippet || "").slice(0, 30) },
      f: {
        fit: 0.8,
        value: Math.min(1, n / 10),
        urgency: Math.min(1, maxOverdue / 14),
        momentum: materialMomentumMax >= 1 ? 1 : 0.5,
        priority: clamp01(1 - minPriority / 100)
      },
      action: { type: "extract-session", bookItemIds: itemIds }
    }
  ];
}

// K4 extract-to-card（每轨道至多 2 个；priority 升序、process_count 降序）
function genExtractToCard(track, ctx) {
  const now = ctx.snapshot.now;
  const cand = (ctx.snapshot.extracts || [])
    .filter((e) => ctx.extractTrackOf(String(e.id)) === track.id)
    .filter((e) => String(e.status) === "reading" && (Number(e.processCount) || 0) >= 2 && !e.hasCard && (Number(e.priority) || 0) <= 50)
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || (Number(b.processCount) || 0) - (Number(a.processCount) || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 2);
  return cand.map((e) => ({
    key: `extract-to-card:${e.id}`,
    kind: "extract-to-card",
    trackId: track.id,
    libraryItemId: String(e.libraryItemId),
    extractIds: [String(e.id)],
    facts: {
      snippet: String(e.snippet || "").slice(0, 40),
      processCount: Number(e.processCount) || 0
    },
    f: {
      fit: 0.7,
      value: 0.5 + 0.1 * Math.min(5, Number(e.processCount) || 0),
      urgency: 0.3,
      momentum: materialMomentum(ctx.view, now, e.libraryItemId),
      priority: clamp01(1 - (Number(e.priority) || 0) / 100)
    },
    action: { type: "jump", documentId: String(e.documentId), anchor: e.anchor || {} }
  }));
}

// K5 reinforce（每轨道至多 2 个）
function genReinforce(track, ctx) {
  if (!["concept", "procedural", "factual"].includes(track.mode)) return [];
  const now = ctx.snapshot.now;
  const out = [];
  for (const kpId of sortedKeys(ctx.kpsOfTrack(track))) {
    const kp = ctx.view.kpsById.get(kpId);
    if (!kp) continue;
    const met = kp.metrics || {};
    const stuck = Number(kp.level) === 2 && (Number(met.n) || 0) >= 2 && (Number(met.meanR) || 0) < P.KP.STUCK_R && (Number(met.lapses30Total) || 0) >= P.KP.STUCK_LAPSES;
    if (!kp.fading && !stuck) continue;
    const facts = {
      kpName: kp.label,
      meanRPct: Math.round((Number(met.meanR) || 0) * 100),
      levelLabel: levelLabel(ctx.strings, kp),
      fading: kp.fading ? 1 : 0
    };
    out.push({
      key: `reinforce:${kp.id}`,
      kind: "reinforce",
      trackId: track.id,
      kpId: String(kp.id),
      facts,
      f: { fit: 0.7, value: 1 - clamp01(Number(met.meanR) || 0), urgency: kp.fading ? 1 : 0.6, momentum: kpMomentum(now, kp), priority: 0.5 },
      action: reinforceAction(kp)
    });
  }
  return out
    .sort((a, b) => scoreCandidate(b, 1) - scoreCandidate(a, 1) || a.key.localeCompare(b.key))
    .slice(0, 2);
}

// K6 cross-material（每轨道至多 1 个）
function genCrossMaterial(track, ctx) {
  if (!["concept", "procedural"].includes(track.mode)) return [];
  const now = ctx.snapshot.now;
  const eligible = [];
  for (const kpId of sortedKeys(ctx.kpsOfTrack(track))) {
    const kp = ctx.view.kpsById.get(kpId);
    if (!kp || (Number(kp.level) !== 2 && Number(kp.level) !== 3)) continue;
    const cardMats = new Set((kp.cardMaterialIds || []).map(String));
    // 链接该 KP（任意 source、weight ≥ 0.3）的单元：材料 ≠ KP 卡片所在材料，且未通读
    let bestUnit = null;
    for (const u of ctx.snapshot.units || []) {
      if (u.passes && u.passes.length > 0) continue;
      const link = (u.kpLinks || []).find((l) => String(l.kpId) === kpId);
      if (!link || (Number(link.weight) || 0) < 0.3) continue;
      if (cardMats.has(String(u.libraryItemId))) continue;
      if (!bestUnit || (Number(link.weight) || 0) > (Number((bestUnit.kpLinks || []).find((l) => String(l.kpId) === kpId)?.weight) || 0)) bestUnit = u;
    }
    if (!bestUnit) continue;
    eligible.push({ kp, unit: bestUnit });
  }
  if (eligible.length === 0) return [];
  eligible.sort((a, b) => kpMomentum(now, b.kp) - kpMomentum(now, a.kp) || (Number(a.kp.score) || 0) - (Number(b.kp.score) || 0) || String(a.kp.id).localeCompare(String(b.kp.id)));
  const { kp, unit } = eligible[0];
  const material = ctx.view.materialsById.get(String(unit.libraryItemId));
  return [
    {
      key: `cross:${kp.id}:${unit.id}`,
      kind: "cross-material",
      trackId: track.id,
      libraryItemId: String(unit.libraryItemId),
      unitId: String(unit.id),
      kpId: String(kp.id),
      facts: { kpName: kp.label, material: material ? material.title : "", unitTitle: unit.title },
      f: {
        fit: readinessOf(unit, ctx.view),
        value: 0.7,
        urgency: 0.2,
        momentum: kpMomentum(now, kp),
        priority: clamp01(1 - ((material && Number(material.priority)) || 0) / 100)
      },
      action: { type: "jumpUnit", unitId: String(unit.id) }
    }
  ];
}

// K7 self-explain（每轨道至多 1 个）
function genSelfExplain(track, ctx) {
  if (!["concept", "procedural"].includes(track.mode)) return [];
  const now = ctx.snapshot.now;
  const recent = new Set(
    (ctx.snapshot.events || [])
      .filter((e) => e.kind === "self_explain" && now - (Number(e.ts) || 0) <= 30 * DAY)
      .map((e) => String(e.kpId || ""))
  );
  for (const kpId of sortedKeys(ctx.kpsOfTrack(track))) {
    const kp = ctx.view.kpsById.get(kpId);
    if (!kp || Number(kp.level) !== 3) continue;
    if (recent.has(kpId)) continue;
    const rels = (kp.relations || []).filter((r) => r.type !== "analogous_to").sort((a, b) => String(a.otherId).localeCompare(String(b.otherId)));
    let picked = null;
    for (const r of rels) {
      const other = ctx.view.kpsById.get(String(r.otherId));
      if (other && Number(other.level) >= 2) {
        picked = { r, other };
        break;
      }
    }
    if (!picked) continue;
    return [
      {
        key: `self-explain:${kp.id}`,
        kind: "self-explain",
        trackId: track.id,
        kpId: String(kp.id),
        facts: { kpName: kp.label, relatedName: picked.other.label, relationLabel: ctx.strings.relationNames[picked.r.type] || picked.r.type },
        f: { fit: 0.8, value: 0.6, urgency: 0.3, momentum: kpMomentum(now, kp), priority: 0.5 },
        action: { type: "dialog", dialog: "self-explain", payload: { kpId: String(kp.id), relatedKpId: String(picked.other.id), relationType: String(picked.r.type) } }
      }
    ];
  }
  return [];
}

// K8 practice（procedural，每轨道至多 2 个：8a 习题单元 + 8b 应用题卡）
function genPractice(track, ctx) {
  if (track.mode !== "procedural") return [];
  const now = ctx.snapshot.now;
  const out = [];
  // 8a：is_exercise=1 的未通读单元，且链接的 KP 中有 L2–L3
  for (const u of ctx.snapshot.units || []) {
    if (!ctx.materialTrackOf(String(u.libraryItemId)).has(track.id)) continue;
    if (Number(u.isExercise) !== 1) continue;
    if ((u.passes || []).length > 0) continue;
    const hasL2L3 = (u.kpLinks || []).some((l) => {
      const kp = ctx.view.kpsById.get(String(l.kpId));
      return kp && (Number(kp.level) === 2 || Number(kp.level) === 3);
    });
    if (!hasL2L3) continue;
    out.push({
      key: `practice-unit:${u.id}`,
      kind: "practice",
      trackId: track.id,
      libraryItemId: String(u.libraryItemId),
      unitId: String(u.id),
      facts: { material: (ctx.view.materialsById.get(String(u.libraryItemId)) || {}).title || "", unitTitle: u.title },
      f: { fit: readinessOf(u, ctx.view), value: 0.8, urgency: 0.3, momentum: materialMomentum(ctx.view, now, u.libraryItemId), priority: 0.5 },
      action: { type: "jumpUnit", unitId: String(u.id) }
    });
  }
  // 8b：等级 L3、无应用卡、有 AI 制卡的 KP；近 30 天 rec_runs 出现过该 key 就不再出（冷却）
  const recentRunKeys = new Set(ctx.snapshot.recentRunKeys || []);
  for (const kpId of sortedKeys(ctx.kpsOfTrack(track))) {
    const kp = ctx.view.kpsById.get(kpId);
    if (!kp || Number(kp.level) !== 3 || kp.hasApplicationCard || !kp.hasAICard) continue;
    const key = `practice-card:${kp.id}`;
    if (recentRunKeys.has(key)) continue;
    const src = kp.firstSourceCard;
    out.push({
      key,
      kind: "practice",
      trackId: track.id,
      kpId: String(kp.id),
      facts: { kpName: kp.label },
      f: { fit: 0.7, value: 0.7, urgency: 0.3, momentum: kpMomentum(now, kp), priority: 0.5 },
      action:
        src && src.documentId
          ? { type: "jump", documentId: String(src.documentId), anchor: src.anchor || {} }
          : { type: "jumpUnit", unitId: "" }
    });
  }
  return out
    .sort((a, b) => scoreCandidate(b, 1) - scoreCandidate(a, 1) || a.key.localeCompare(b.key))
    .slice(0, 2);
}

// K9 find-material（全局至多 1 个）
function genFindMaterial(track, ctx) {
  if (!["concept", "procedural"].includes(track.mode)) return [];
  const now = ctx.snapshot.now;
  const out = [];
  for (const kpId of sortedKeys(ctx.kpsOfTrack(track))) {
    const kp = ctx.view.kpsById.get(kpId);
    if (!kp || Number(kp.level) < 2) continue;
    for (const preId of (kp.prereqIds || []).map(String).sort()) {
      const pre = ctx.view.kpsById.get(preId);
      if (!pre || Number(pre.level) > 1) continue;
      if (ctx.view.linkedKpIds.has(preId)) continue; // 前置没有任何 unit_kp_links
      out.push({
        key: `find:${pre.id}`,
        kind: "find-material",
        trackId: track.id,
        kpId: String(pre.id),
        facts: { prereqName: pre.label, kpName: kp.label },
        f: { fit: 0.5, value: 0.5, urgency: 0.4, momentum: kpMomentum(now, kp), priority: 0.5 },
        action: { type: "copy-query", kpLabel: pre.label }
      });
    }
  }
  return out
    .sort((a, b) => scoreCandidate(b, 1) - scoreCandidate(a, 1) || a.key.localeCompare(b.key))
    .slice(0, 1);
}

// K10 reread（language，每轨道至多 2 个）
function genReread(track, ctx) {
  if (track.mode !== "language" || !track.lang) return [];
  const now = ctx.snapshot.now;
  const out = [];
  for (const m of ctx.materialsOf(track)) {
    for (const u of ctx.view.unitsByMaterial.get(String(m.id)) || []) {
      const passes = (u.passes || []).map(Number).sort((a, b) => a - b);
      const c = passes.length;
      if (c < 1 || c > P.REREAD_MAX_PASSES - 1) continue; // c ≤ 5：读满 6 遍不再推
      if ((Number(u.learningCount) || 0) < P.REREAD_MIN_LEARNING) continue;
      const interval = P.REREAD_INTERVALS_DAYS[Math.min(c - 1, P.REREAD_INTERVALS_DAYS.length - 1)];
      const daysSince = (now - passes[c - 1]) / DAY;
      if (daysSince < interval) continue;
      out.push({
        key: `reread:${u.id}`,
        kind: "reread",
        trackId: track.id,
        libraryItemId: String(m.id),
        unitId: String(u.id),
        facts: { unitTitle: u.title, material: m.title, passCount: c, learningCount: Number(u.learningCount) || 0 },
        f: {
          fit: 0.9,
          value: recyclingOf(u),
          urgency: Math.min(1, (daysSince - interval) / 7),
          momentum: materialMomentum(ctx.view, now, m.id),
          priority: clamp01(1 - (Number(m.priority) || 0) / 100)
        },
        action: { type: "dialog", dialog: "unit-reader", payload: { unitId: String(u.id) } }
      });
    }
  }
  return out
    .sort((a, b) => scoreCandidate(b, 1) - scoreCandidate(a, 1) || a.key.localeCompare(b.key))
    .slice(0, 2);
}

// K11 context-reel（language，每轨道至多 1 个；生成器只用 unit_lex 计数判定可行性）
function genContextReel(track, ctx) {
  if (track.mode !== "language" || !track.lang) return [];
  const now = ctx.snapshot.now;
  const st = (ctx.snapshot.lexStats || {})[track.lang];
  if (!st || !Array.isArray(st.learningTop)) return [];
  // 目标词排序：最后查词时间降序（没查过的按 total_count 降序），确定性 tie-break 按 key
  const ordered = st.learningTop
    .slice()
    .sort(
      (a, b) =>
        (Number(b.lastLookupAt) || 0) - (Number(a.lastLookupAt) || 0) ||
        (Number(b.totalCount) || 0) - (Number(a.totalCount) || 0) ||
        String(a.key).localeCompare(String(b.key))
    );
  for (const w of ordered) {
    if ((Number(w.unitCount) || 0) < 2) continue; // ≥ 2 个不同单元
    if ((Number(w.totalCount) || 0) < 3) continue; // 共 ≥ 3 句（以出现次数近似，真实搜集在 learner:contextReel）
    const momentum = w.lastLookupAt && now - Number(w.lastLookupAt) <= 3 * DAY ? 1 : 0.5;
    return [
      {
        key: `reel:${track.lang}:${w.key}`,
        kind: "context-reel",
        trackId: track.id,
        facts: { word: w.sample, sentenceCount: Number(w.totalCount) || 0 },
        f: { fit: 0.9, value: 0.7, urgency: 0.4, momentum, priority: 0.5 },
        action: { type: "dialog", dialog: "context-reel", payload: { lang: track.lang, key: String(w.key) } }
      }
    ];
  }
  return [];
}

// K12 sentence-mine（language，每轨道至多 1 个，聚合）
function genSentenceMine(track, ctx) {
  if (track.mode !== "language" || !track.lang) return [];
  const st = (ctx.snapshot.lexStats || {})[track.lang];
  const mineCount = st ? Number(st.mineCount) || 0 : 0;
  if (mineCount < 3) return [];
  return [
    {
      key: `mine:${track.id}`,
      kind: "sentence-mine",
      trackId: track.id,
      facts: { count: mineCount },
      f: { fit: 0.9, value: Math.min(1, mineCount / 10), urgency: 0.3, momentum: 1, priority: 0.5 },
      action: { type: "dialog", dialog: "sentence-mine", payload: { trackId: String(track.id) } }
    }
  ];
}

const GENERATORS = [
  genPlacement,
  genContinue,
  genStart,
  genExtractBatch,
  genExtractToCard,
  genReinforce,
  genCrossMaterial,
  genSelfExplain,
  genPractice,
  genFindMaterial,
  genReread,
  genContextReel,
  genSentenceMine
];

// ---------- 标题与理由（设计稿 §11.9-3：explain(candidate, strings) / titleOf(candidate, strings)） ----------

function titleOf(candidate, strings) {
  const f = candidate.facts || {};
  const key = candidate.kind === "practice" ? (String(candidate.key).startsWith("practice-unit:") ? "practice-unit" : "practice-card") : candidate.kind;
  return fmtTemplate(strings.titles[key] || candidate.kind, f);
}

function explain(candidate, strings) {
  const f = candidate.facts || {};
  const kind = candidate.kind;
  if (kind === "continue") {
    if (f.coveragePct !== undefined) return fmtTemplate(strings.reasons.continueLanguage, f);
    if (f.kpNames) return fmtTemplate(strings.reasons.continueConcept, f);
    return fmtTemplate(strings.reasons.continueConceptPlain, f);
  }
  if (kind === "start") {
    if (f.coveragePct !== undefined) return fmtTemplate(strings.reasons.startLanguage, f);
    return fmtTemplate(strings.reasons.startConcept, f);
  }
  if (kind === "reinforce") {
    return fmtTemplate(f.fading ? strings.reasons.reinforceFading : strings.reasons.reinforceStuck, f);
  }
  if (kind === "practice") {
    const key = String(candidate.key).startsWith("practice-unit:") ? "practice-unit" : "practice-card";
    return fmtTemplate(strings.reasons[key], f);
  }
  return fmtTemplate(strings.reasons[kind] || "", f);
}

// ---------- 选取（设计稿 §8.4 轨道配额 + 多样性） ----------

function largestRemainderQuotas(n, weights, participatingIds) {
  const quotas = new Map();
  const ids = participatingIds.slice().sort();
  const raw = new Map();
  let baseSum = 0;
  for (const id of ids) {
    const exact = n * (Number(weights[id]) || 0);
    const base = Math.floor(exact);
    quotas.set(id, base);
    raw.set(id, exact - base);
    baseSum += base;
  }
  let remaining = n - baseSum;
  const order = ids.slice().sort((a, b) => (raw.get(b) || 0) - (raw.get(a) || 0) || a.localeCompare(b));
  for (const id of order) {
    if (remaining <= 0) break;
    quotas.set(id, quotas.get(id) + 1);
    remaining -= 1;
  }
  return quotas;
}

function select(candidates, tracks, weights, snapshot, hasEffective) {
  const n = clamp(Math.round(Number(snapshot.settings?.recCount) || P.REC.DEFAULT_COUNT), P.REC.MIN_COUNT, P.REC.MAX_COUNT);
  // __unassigned 不参与权重与配额分配（quota 0）；没有任何有效轨道（落库与提议都为空）时获得全部配额
  const participatingIds = hasEffective
    ? tracks.filter((t) => t.id !== "__unassigned" && (Number(weights[t.id]) || 0) > 0).map((t) => t.id)
    : ["__unassigned"];
  const quotas = largestRemainderQuotas(n, hasEffective ? weights : { __unassigned: 1 }, participatingIds);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  // 每个 weight>0 的 pinned 轨道至少 1
  const pinnedIds = participatingIds.filter((id) => trackById.get(id) && trackById.get(id).pinned).sort();
  for (const pid of pinnedIds) {
    if ((quotas.get(pid) || 0) >= 1) continue;
    // 从配额最大且 >1 的非 pinned 轨道挪 1 个名额（id 序，确定性）
    let donor = null;
    for (const id of participatingIds.slice().sort()) {
      if (pid === id) continue;
      const t = trackById.get(id);
      if (!t || t.pinned) continue;
      if ((quotas.get(id) || 0) > 1 && (!donor || (quotas.get(id) || 0) > (quotas.get(donor) || 0))) donor = id;
    }
    if (!donor) break;
    quotas.set(donor, quotas.get(donor) - 1);
    quotas.set(pid, 1);
  }

  const byTrack = new Map();
  for (const c of candidates) {
    const t = String(c.trackId);
    if (!byTrack.has(t)) byTrack.set(t, []);
    byTrack.get(t).push(c);
  }
  const selected = [];
  const selectedKeys = new Set();
  const kindCount = new Map();
  const materialCount = new Map();
  const globalKindCap = (kind) => (kind === "find-material" ? 1 : P.REC.MAX_PER_KIND);
  const canTake = (c) => {
    if (selectedKeys.has(c.key)) return false;
    if ((kindCount.get(c.kind) || 0) >= globalKindCap(c.kind)) return false;
    const itemId = c.libraryItemId ? String(c.libraryItemId) : null;
    if (itemId && (materialCount.get(itemId) || 0) >= P.REC.MAX_PER_MATERIAL) return false;
    return true;
  };
  const take = (c) => {
    selected.push(c);
    selectedKeys.add(c.key);
    kindCount.set(c.kind, (kindCount.get(c.kind) || 0) + 1);
    if (c.libraryItemId) materialCount.set(String(c.libraryItemId), (materialCount.get(String(c.libraryItemId)) || 0) + 1);
  };
  const byScore = (arr) =>
    arr.slice().sort((a, b) => {
      const ap = a.kind === "placement";
      const bp = b.kind === "placement";
      if (ap !== bp) return ap ? -1 : 1; // placement 直接占该轨道第一个名额
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      return sb - sa || String(a.key).localeCompare(String(b.key));
    });

  // placement 先占名额（计入所在轨道 quota）
  for (const t of tracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const arr = byTrack.get(t.id) || [];
    const placement = arr.find((c) => c.kind === "placement");
    if (placement && canTake(placement)) {
      take(placement);
      quotas.set(t.id, Math.max(0, (quotas.get(t.id) || 0) - 1));
    }
  }
  // 每轨道按 score 降序贪心选取
  const leftovers = [];
  for (const t of tracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const quota = quotas.get(t.id) || 0;
    const arr = byScore((byTrack.get(t.id) || []).filter((c) => c.kind !== "placement"));
    let got = 0;
    for (const c of arr) {
      if (got >= quota) break;
      if (!canTake(c)) continue;
      take(c);
      got += 1;
    }
    for (const c of arr.slice(got)) leftovers.push(c);
  }
  // 某轨道候选不够填满 quota → 剩余名额按 score 降序从所有轨道的剩余候选里补（仍守约束）
  let pool = byScore(leftovers);
  let short = n - selected.length;
  for (const c of pool) {
    if (short <= 0) break;
    if (!canTake(c)) continue;
    take(c);
    short -= 1;
  }
  return selected;
}

// ---------- 自动判定完成（设计稿 §8.6） ----------

function computeAutoDone(snapshot, view) {
  const run = snapshot.lastRun;
  if (!run || !Array.isArray(run.items) || run.items.length === 0) return [];
  const win = P.REC.AUTO_DONE_WINDOW_DAYS * DAY;
  if (snapshot.now - (Number(run.createdAt) || 0) > win) return [];
  const ts = Number(run.createdAt) || 0;
  const doneKeys = new Set(
    (snapshot.feedback || []).filter((f) => f.action === "done" && (Number(f.ts) || 0) > ts).map((f) => String(f.itemKey))
  );
  const events = snapshot.events || [];
  const newCards = snapshot.newCards || [];
  const opTimes = snapshot.extractOpTimes || {};
  const out = [];
  for (const item of run.items) {
    const key = String(item.key);
    if (doneKeys.has(key)) continue;
    const kind = String(item.kind || "");
    let hit = false;
    if (kind === "continue" || kind === "start" || kind === "cross-material" || kind === "practice") {
      if (kind === "practice" && key.startsWith("practice-card:")) {
        const kpId = key.slice("practice-card:".length);
        hit = newCards.some((c) => String(c.kpId) === kpId && (Number(c.createdAt) || 0) > ts);
      } else if (item.unitId) {
        const unit = view.unitsById.get(String(item.unitId));
        hit = Boolean(unit && (unit.passes || []).some((t) => Number(t) > ts));
      }
    } else if (kind === "extract-batch") {
      const ids = Array.isArray(item.extractIds) ? item.extractIds.map(String) : [];
      hit = ids.some((id) => (Number(opTimes[id]) || 0) > ts);
    } else if (kind === "extract-to-card") {
      const exId = key.slice("extract-to-card:".length);
      hit = newCards.some((c) => String(c.extractId) === exId && (Number(c.createdAt) || 0) > ts);
    } else if (kind === "reinforce") {
      const kp = item.kpId ? view.kpsById.get(String(item.kpId)) : null;
      hit = Boolean(kp && (Number(kp.lastReviewAt) || 0) > ts);
      if (!hit && item.unitId) {
        const unit = view.unitsById.get(String(item.unitId));
        hit = Boolean(unit && (unit.passes || []).some((t) => Number(t) > ts));
      }
    } else if (kind === "reread") {
      hit = events.some((e) => e.kind === "unit_reread" && String(e.unitId || "") === String(item.unitId || "") && (Number(e.ts) || 0) > ts);
    } else if (kind === "context-reel") {
      const lang = key.startsWith("reel:") ? key.split(":")[1] : "";
      hit = events.some((e) => e.kind === "reel_done" && String(e.lang || "") === lang && (Number(e.ts) || 0) > ts);
    } else if (kind === "self-explain") {
      hit = events.some((e) => e.kind === "self_explain" && String(e.kpId || "") === String(item.kpId || "") && (Number(e.ts) || 0) > ts);
    } else if (kind === "placement") {
      const lang = key.slice("placement:".length);
      hit = events.some((e) => e.kind === "placement" && String(e.lang || "") === lang && (Number(e.ts) || 0) > ts);
    } else if (kind === "sentence-mine") {
      hit =
        events.some((e) => e.kind === "lexeme_mark" && e.payload && e.payload.via === "mine" && (Number(e.ts) || 0) > ts) ||
        newCards.some((c) => c.isVocab && (Number(c.createdAt) || 0) > ts);
    }
    if (hit) out.push({ itemKey: key, kind, libraryItemId: item.libraryItemId ? String(item.libraryItemId) : undefined });
  }
  return out;
}

// ---------- 主入口 recommend(snapshot, opts) ----------

function recommend(snapshot) {
  const strings = lmStrings[snapshot.settings?.locale === "en" ? "en" : "zh"];
  const view = buildView(snapshot);
  const dbTracks = (snapshot.tracks || []).map((t) => ({ ...t }));
  const usingProposals = dbTracks.length === 0;
  // 有效轨道（落库 active；没有则把全部提议当隐式轨道使用，不落库）+ __unassigned
  const proposals = Array.isArray(snapshot.proposals) && snapshot.proposals.length > 0
    ? snapshot.proposals
    : proposeTracks({
        materials: snapshot.materials || [],
        cardUdcCounts: snapshot.cardUdcCounts || {},
        nativeLangs: snapshot.settings?.nativeLangs || [],
        tracks: dbTracks,
        uiLocale: snapshot.settings?.locale === "en" ? "en" : "zh",
        udcLabels: snapshot.udcLabels || {}
      });
  let effective;
  if (usingProposals) {
    effective = proposals.map((p) => ({
      id: `proposal:${p.key}`,
      label: p.label,
      mode: p.mode,
      lang: p.lang || "",
      udcCodes: p.udcCodes || [],
      status: "active",
      pinned: false,
      priority: 3,
      source: "proposal",
      isProposal: true
    }));
  } else {
    effective = dbTracks;
  }
  const allTracks = [...effective, { id: "__unassigned", label: "__unassigned", mode: "concept", lang: "", udcCodes: [], status: "active", pinned: false, priority: 3, source: "system" }];
  const effectiveIds = new Set(effective.map((t) => t.id));

  // 材料归属（含 __unassigned 兜底）
  const overrides = new Map();
  for (const o of snapshot.overrides || []) overrides.set(`${String(o.trackId)}:${String(o.libraryItemId)}`, Number(o.member));
  const trackOfMaterial = new Map();
  for (const m of snapshot.materials || []) {
    for (const t of effective.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (resolveMembership(t, m, overrides)) {
        trackOfMaterial.set(String(m.id), t.id);
        break;
      }
    }
  }
  const weightsOf = trackWeights(effective, snapshot.activity || {});
  const weights = weightsOf.weights;

  // 反馈分析（冷却 / not_interested / 每轨道 too_hard-too_easy 净值）
  const fb = analyzeFeedback(snapshot, effective, trackOfMaterial);
  const kpsOfTrackCache = new Map();
  const kpsOfTrack = (track) => {
    if (kpsOfTrackCache.has(track.id)) return kpsOfTrackCache.get(track.id);
    const out = new Map();
    if (track.mode === "language") {
      kpsOfTrackCache.set(track.id, out);
      return out; // 语言轨道不按 UDC/材料归属 KP
    }
    for (const kp of snapshot.kps || []) {
      let belongs = false;
      if (kp.domainId && track.udcCodes.includes(String(kp.domainId))) belongs = true;
      else {
        // 看它链接卡片的材料，取材料所属轨道中卡数最多的那个 → 简化：卡所在材料属本轨道即归属
        for (const mid of kp.cardMaterialIds || []) {
          if (trackOfMaterial.get(String(mid)) === track.id) {
            belongs = true;
            break;
          }
        }
      }
      if (belongs) out.set(String(kp.id), kp);
    }
    kpsOfTrackCache.set(track.id, out);
    return out;
  };
  const materialsOfTrackCache = new Map();
  const materialsOf = (track) => {
    if (materialsOfTrackCache.has(track.id)) return materialsOfTrackCache.get(track.id);
    const out = (snapshot.materials || []).filter((m) =>
      track.id === "__unassigned" ? !trackOfMaterial.has(String(m.id)) : trackOfMaterial.get(String(m.id)) === track.id
    );
    materialsOfTrackCache.set(track.id, out);
    return out;
  };
  const materialTrackSets = new Map(); // libraryItemId → Set(trackId)
  const materialTrackOf = (itemId) => {
    if (!materialTrackSets.has(itemId)) {
      const s = new Set();
      const tid = trackOfMaterial.get(itemId);
      if (tid) s.add(tid);
      materialTrackSets.set(itemId, s);
    }
    return materialTrackSets.get(itemId);
  };
  const extractTrackCache = new Map();
  const extractTrackOf = (extractId) => {
    if (extractTrackCache.has(extractId)) return extractTrackCache.get(extractId);
    const e = view.extractsById.get(extractId);
    const tid = e ? trackOfMaterial.get(String(e.libraryItemId)) || "__unassigned" : null;
    extractTrackCache.set(extractId, tid);
    return tid;
  };
  const coldStart = (track) => {
    if (!track.lang) return false;
    const st = (snapshot.lexStats || {})[track.lang];
    return Boolean(st && (Number(st.knownCount) || 0) < P.LEX.COLD_START_KNOWN && !st.hasPlacement);
  };
  const ctx = {
    snapshot,
    view,
    strings,
    materialsOf,
    kpsOfTrack,
    materialTrackOf,
    extractTrackOf,
    coldStart,
    notInterestedMaterials: fb.notInterestedMaterials,
    trackNet: (track) => fb.trackNet.get(track.id) || 0,
    bandOf: (track, coverage) => {
      const shift = clamp((fb.trackNet.get(track.id) || 0) * P.REC.BAND_SHIFT_STEP, -P.REC.BAND_SHIFT_MAX, P.REC.BAND_SHIFT_MAX);
      return require("./lmLex").bandOf(coverage, shift);
    }
  };

  // 1-3. 生成候选
  let candidates = [];
  for (const track of allTracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    // paused / archived 的轨道不生成（weight=0、不参与推荐）
    const w = track.id === "__unassigned" ? 1 : Number(weights[track.id]) || 0;
    if (track.status !== "active" || (w <= 0 && track.id !== "__unassigned")) continue;
    for (const gen of GENERATORS) candidates.push(...gen(track, ctx));
  }
  // 4. 应用过滤：冷却期内的 key、not_interested 的材料（K1/K2）、__unassigned 无轨道时的全量配额已在 select 处理
  candidates = candidates.filter((c) => {
    const cd = fb.cooldown.get(String(c.key));
    if (cd && snapshot.now < cd.until) return false;
    if ((c.kind === "continue" || c.kind === "start") && c.libraryItemId) {
      const until = fb.notInterestedMaterials.get(String(c.libraryItemId));
      if (until && snapshot.now < until) return false;
    }
    return true;
  });
  // 5. 打分（placement 不打分）
  for (const c of candidates) {
    c.score = c.kind === "placement" ? 0 : scoreCandidate(c, fb.kindMultiplier(c.kind));
  }
  // 6. 选取
  const selected = select(candidates, allTracks, weights, snapshot, !usingProposals || effective.length > 0);
  // 7. 组装 RecItem（标题 / 理由 / 动作）
  const items = selected.map((c) => {
    const track = allTracks.find((t) => t.id === c.trackId);
    const item = {
      key: c.key,
      kind: c.kind,
      trackId: c.trackId,
      trackLabel: track ? track.label : "",
      libraryItemId: c.libraryItemId,
      unitId: c.unitId,
      kpId: c.kpId,
      extractIds: c.extractIds,
      title: titleOf(c, strings),
      reason: explain(c, strings),
      score: c.score,
      facts: c.facts,
      action: finalizeAction(c, view, strings)
    };
    if (item.action && (item.action.type === "review" || item.action.type === "extract-session")) item.action.title = item.title;
    return item;
  });
  const byKind = {};
  for (const c of candidates.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))) {
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  }
  return {
    items,
    candidateCount: candidates.length,
    byKind,
    autoDone: computeAutoDone(snapshot, view),
    usingProposals,
    proposals,
    weights
  };
}

// 生成器的中间 action → 最终 RecAction（设计稿 §8.7）
function finalizeAction(c, view, strings) {
  const a = c.action || {};
  if (a.type === "jumpUnit") {
    const unit = view.unitsById.get(String(a.unitId || ""));
    if (!unit) return null;
    const anchor =
      unit.pageFrom != null
        ? { anchorText: unit.headText, pageIndex: Number(unit.pageFrom) }
        : { anchorText: unit.headText, anchorRatio: unit.docLen ? Number(unit.mdFrom) / Number(unit.docLen) : undefined };
    return { type: "jump", documentId: String(unit.documentId), anchor };
  }
  if (a.type === "copy-query") return { type: "copy-query", text: `${a.kpLabel}${strings.copyQuerySuffix}` };
  return a;
}

module.exports = {
  proposeTracks,
  resolveMembership,
  trackWeights,
  recommend,
  titleOf,
  explain,
  scoreCandidate,
  baseScore,
  computeAutoDone,
  defaultModeForUdc
};
