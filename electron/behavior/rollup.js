// BDI（D248 / T11）：派生层——日事实重算（daily_metrics / domain_day / item_day / signal_daily）。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §9.2 / §9.4。
// 纪律：每个脏日一个事务；增量结果必须与「清空后全量重建」逐键一致；问号日不补 0；DERIVE_VERSION 变化全量重建（归档日除外）。
"use strict";
const { learningDayStartMs } = require("../fsrsTime");

const DERIVE_VERSION = 1;
const ACTIVE_ORIGINS = new Set(["shelf", "search", "browse", "card_source", "link", "mindmap", "kp", "journal", "capture", "reader_toc", "workbench"]);
const PUSHED_ORIGINS = new Set(["queue", "recommend", "review_flow", "notification"]);
const SURFACES = ["read", "review", "xreview", "author", "browse", "other"];

function initiativeOf(origin) {
  if (ACTIVE_ORIGINS.has(origin)) return "self";
  if (PUSHED_ORIGINS.has(origin)) return "pushed";
  return "neutral";
}

function dayStart(day, cutoff) {
  const [y, m, d] = String(day).split("-").map((x) => Number(x));
  return learningDayStartMs(Date.UTC(y, m - 1, d, 12, 0, 0), cutoff);
}

function createRollup(opts) {
  const db = opts.db;
  const pull = opts.pull;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const cutoffHour = typeof opts.cutoffHour === "function" ? opts.cutoffHour : () => 4;
  const deriveVersion = Number.isInteger(opts.deriveVersion) ? opts.deriveVersion : DERIVE_VERSION;

  const domStmt = db.prepare("SELECT udc_json, udc_main FROM entity_domains WHERE entity_type = ? AND entity_id = ?");

  function domainOf(entityType, entityId) {
    if (!entityId) return [{ code: "_none", level: "none", w: 1 }];
    const row = domStmt.get(entityType, entityId);
    if (!row) return [{ code: "_none", level: "none", w: 1 }];
    try {
      const arr = JSON.parse(row.udc_json);
      if (Array.isArray(arr) && arr.length) return arr.map((x) => ({ code: String(x.code), level: String(x.level || "leaf"), w: Number(x.w) || 0 }));
    } catch { /* 坏行按 _none */ }
    return [{ code: "_none", level: "none", w: 1 }];
  }

  function entityOfEvent(e) {
    if (e.card_id) return ["card", e.card_id];
    if (e.extract_id) return ["extract", e.extract_id];
    if (e.entity_type && e.entity_id) return [e.entity_type, e.entity_id];
    if (e.library_item_id) return ["library_item", e.library_item_id];
    return [null, null];
  }
  function entityOfSpan(s) {
    if (s.card_id) return ["card", s.card_id];
    if (s.extract_id) return ["extract", s.extract_id];
    if (s.library_item_id) return ["library_item", s.library_item_id];
    return [null, null];
  }

  function blankDomainRow(udc, level) {
    return {
      udc, level, active_ms: 0, idle_ms: 0, self_ms: 0, pushed_ms: 0, neutral_ms: 0,
      read_ms: 0, review_ms: 0, xreview_ms: 0, author_ms: 0, browse_ms: 0, other_ms: 0,
      answer_ms: 0, n_reviews: 0, n_again: 0, n_hard: 0, n_good: 0, n_easy: 0, n_new_reviewed: 0,
      n_extracts: 0, n_annotations: 0, n_cards_manual: 0, n_cards_ai_kept: 0, n_opens_self: 0,
      n_source_jumps: 0, n_explains: 0, n_queries: 0, n_skips: 0, n_defers: 0, n_deletes: 0,
      deliberate_production: 0, n_items: 0,
    };
  }

  function ensureDomain(map, udc, level) {
    const key = `${udc}\u0000${level}`;
    let row = map.get(key);
    if (!row) { row = blankDomainRow(udc, level); map.set(key, row); }
    return row;
  }

  function addDomains(map, weights, fn) {
    for (const w of weights) fn(ensureDomain(map, w.code, w.level), w.w);
  }

  /** 拉取某日 review_logs / reading_events（按学习日切点）。 */
  function pullDay(table, day, timeCol) {
    const cutoff = cutoffHour();
    const start = dayStart(day, cutoff);
    let end = dayStart(day, cutoff);
    // 次日：跨月/年由 Date 推进后重新取整（DST 安全：直接用 learningDayStartMs）
    const d = new Date(start + 36 * 3600000);
    const nextYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    end = dayStart(nextYmd, cutoff);
    const out = [];
    let cursor = { ts: start - 1, rowid: 0 };
    for (;;) {
      const rows = pull({ table, mode: "time", cursor, limit: 500 });
      if (!rows.length) break;
      for (const r of rows) {
        const t = r[timeCol];
        if (t >= start && t < end) out.push(r);
      }
      cursor = { ts: rows[rows.length - 1][timeCol], rowid: rows[rows.length - 1]._rowid };
      if (rows.length < 500) break;
    }
    return out;
  }

  function computeDay(day) {
    const evs = db.prepare("SELECT * FROM events WHERE day = ?").all(day);
    const spans = db.prepare("SELECT * FROM attn_spans WHERE day = ?").all(day);
    const reviews = pullDay("review_logs", day, "reviewed_at");
    const reads = pullDay("reading_events", day, "created_at");
    const coverage = db.prepare("SELECT state FROM coverage_day WHERE day = ? AND metric_key = 'events'").get(day);
    const quality = coverage ? coverage.state : "unknown";

    const dom = new Map();
    const items = new Map();
    const metrics = new Map(); // metric|dimType|dimValue → {n,sum}
    const signals = new Map(); // signal|udc|level → {n,value}
    const addMetric = (metric, dimType, dimValue, n, sum = 0) => {
      const key = `${metric}\u0000${dimType}\u0000${dimValue}`;
      const cur = metrics.get(key) || { metric, dimType, dimValue, n: 0, sum: 0 };
      cur.n += n; cur.sum += sum;
      metrics.set(key, cur);
    };
    const addSignal = (id, udc, level, value = 1) => {
      const key = `${id}\u0000${udc}\u0000${level}`;
      const cur = signals.get(key) || { id, udc, level, n: 0, value: 0 };
      cur.n += 1; cur.value += value;
      signals.set(key, cur);
    };
    const itemRow = (itemId) => {
      let r = items.get(itemId);
      if (!r) {
        r = { day, library_item_id: itemId, active_ms: 0, self_ms: 0, pushed_ms: 0, n_opens: 0, n_extracts: 0, n_annotations: 0, n_cards: 0, n_reviews: 0, progress_chars: null, covered_chars: null, first_origin: null };
        items.set(itemId, r);
      }
      return r;
    };

    // ---- 事件计数（全部事件；intentOnly 只计意图） ----
    for (const e of evs) {
      addMetric(`ev:${e.type}`, "all", "*", 1, Number.isFinite(Number(e.num)) ? Number(e.num) : 0);
      const [etype, eid] = entityOfEvent(e);
      const weights = domainOf(etype, eid);
      const origin = e.origin || "unknown";
      const initiative = initiativeOf(origin);
      // 领域日：动作类计数（主领域只计整数）
      addDomains(dom, weights, (row, w) => {
        if (e.type === "extract.created") row.n_extracts += w >= 0.5 ? 1 : 0;
        if (e.type === "extract.op" && e.props && JSON.parse(e.props || "{}").annotation === true) row.n_annotations += w >= 0.5 ? 1 : 0;
        if (e.type === "card.created" && (JSON.parse(e.props || "{}").generatedBy === "manual")) row.n_cards_manual += w >= 0.5 ? 1 : 0;
        if (e.type === "library.opened" && initiative === "self") row.n_opens_self += w >= 0.5 ? 1 : 0;
        if (e.type === "review.source_opened") row.n_source_jumps += w >= 0.5 ? 1 : 0;
        if (e.type === "review.skipped") row.n_skips += w >= 0.5 ? 1 : 0;
        if (e.type === "review.undone") row.n_deletes += w >= 0.5 ? 1 : 0;
        if (e.type === "card.deleted" || e.type === "library.deleted") row.n_deletes += w >= 0.5 ? 1 : 0;
        if (e.type === "extract.op" && /^(postpone|postponeDays)$/.test(JSON.parse(e.props || "{}").op || "")) row.n_defers += w >= 0.5 ? 1 : 0;
        if (e.type === "ai.invoked" && ["explain", "ste", "translate"].includes(JSON.parse(e.props || "{}").feature)) row.n_explains += w >= 0.5 ? 1 : 0;
        if (e.type === "browse.queried" || e.type === "reader.searched" || e.type === "shelf.filtered") row.n_queries += w >= 0.5 ? 1 : 0;
      });
      // 信号
      const props = (() => { try { return JSON.parse(e.props || "{}"); } catch { return {}; } })();
      const pushSignal = (id) => addDomains(dom, weights, () => {});
      void pushSignal;
      const sigFor = (id) => {
        for (const w of weights) addSignal(id, w.code, w.level, 1 * w.w);
      };
      if (e.type === "library.opened" && initiative === "self") sigFor("open_active");
      if (e.type === "library.opened" && initiative === "pushed") sigFor("open_pushed");
      if (e.type === "extract.created") sigFor("extract_made");
      if (e.type === "extract.op" && props.annotation === true) sigFor("annotate");
      if (e.type === "card.created" && props.generatedBy === "manual") sigFor("card_manual");
      if (e.type === "review.source_opened") sigFor("source_jump");
      if (e.type === "ai.invoked" && ["explain", "ste", "translate"].includes(props.feature) && props.outcome === "ok") sigFor("explain_ask");
      if (e.type === "browse.queried" || e.type === "reader.searched" || e.type === "shelf.filtered") sigFor("query");
      if (e.type === "dict.lookup") sigFor("dict_lookup");
      if (e.type === "reader.finished") sigFor("finish_book");
      if (e.type === "journal.written" && props.via !== "draft_send") sigFor("journal_write");
      if (e.type === "mindmap.node_action") sigFor("mindmap_explore");
      if (e.type === "knowledge.viewed") sigFor("kp_view");
      if (e.type === "review.skipped") sigFor("skip");
      if (e.type === "extract.op" && /^(postpone|postponeDays)$/.test(props.op || "")) sigFor("extract_defer");
      if (e.type === "card.deleted") sigFor("card_delete");
      if (e.type === "library.deleted") sigFor("item_delete");
    }

    // ---- 注意力（规范化 span） ----
    let dayActive = 0;
    for (const s of spans) {
      const [etype, eid] = entityOfSpan(s);
      const weights = domainOf(etype, eid);
      const initiative = initiativeOf(s.origin || "unknown");
      const surface = SURFACES.includes(s.surface) ? s.surface : "other";
      addMetric("attn.active_ms", "all", "*", 1, s.active_ms);
      addMetric("attn.idle_ms", "all", "*", 1, s.idle_ms);
      addMetric("attn.active_ms", "surface", surface, 1, s.active_ms);
      dayActive += s.active_ms;
      addDomains(dom, weights, (row, w) => {
        row.active_ms += s.active_ms * w;
        row.idle_ms += s.idle_ms * w;
        if (initiative === "self") row.self_ms += s.active_ms * w;
        else if (initiative === "pushed") row.pushed_ms += s.active_ms * w;
        else row.neutral_ms += s.active_ms * w;
        row[`${surface}_ms`] += s.active_ms * w;
        if (initiative === "self") addSignal("dwell_active", row.udc, row.level, (s.active_ms / 60000) * w);
        if (initiative === "pushed") addSignal("dwell_pushed", row.udc, row.level, (s.active_ms / 60000) * w);
      });
      if (s.library_item_id) {
        const it = itemRow(s.library_item_id);
        it.active_ms += s.active_ms;
        if (initiative === "self") it.self_ms += s.active_ms;
        else if (initiative === "pushed") it.pushed_ms += s.active_ms;
        it.first_origin = it.first_origin || s.origin || null;
      }
    }
    addMetric("attn.self_ms", "all", "*", 1, spans.reduce((sum, s) => sum + (initiativeOf(s.origin || "unknown") === "self" ? s.active_ms : 0), 0));
    addMetric("attn.pushed_ms", "all", "*", 1, spans.reduce((sum, s) => sum + (initiativeOf(s.origin || "unknown") === "pushed" ? s.active_ms : 0), 0));

    // ---- review_logs（真源；按主领域整数计数，answer 按权重拆） ----
    let answerValid = 0;
    let nReviews = 0;
    for (const r of reviews) {
      const weights = domainOf("card", r.card_id);
      const main = weights[0];
      if (!main) continue;
      const dur = Number(r.duration_ms);
      if (Number.isFinite(dur) && dur >= 0 && dur <= 30 * 60000) {
        answerValid += dur;
        addMetric("review.answer_ms", "all", "*", 1, dur);
      }
      nReviews++;
      addDomains(dom, weights, (row, w) => {
        row.answer_ms += (Number.isFinite(dur) && dur >= 0 && dur <= 30 * 60000 ? dur : 0) * w;
      });
      const mainRow = ensureDomain(dom, main.code, main.level);
      mainRow.n_reviews += 1;
      if (r.rating === "again") mainRow.n_again += 1;
      else if (r.rating === "hard") mainRow.n_hard += 1;
      else if (r.rating === "good") mainRow.n_good += 1;
      else if (r.rating === "easy") mainRow.n_easy += 1;
      let st = null;
      try { st = JSON.parse(r.fsrs_before_json || "null"); } catch { st = null; }
      if (st && st.state === "new") mainRow.n_new_reviewed += 1;
      addSignal(main.code && main.level ? "extract_made" : "extract_made", main.code, main.level, 0); // 不把评分并入产出
    }

    // ---- reading_events ----
    for (const r of reads) {
      addSignal("query", "_none", "none", 0); // 不造信号；只做 item_day 进度
      const itemId = r.item_id;
      if (itemId) itemRow(itemId);
    }

    // 条目事件聚合
    for (const e of evs) {
      if (!e.library_item_id) continue;
      const it = itemRow(e.library_item_id);
      if (e.type === "library.opened") it.n_opens++;
      if (e.type === "extract.created") it.n_extracts++;
      if (e.type === "extract.op") { try { if (JSON.parse(e.props || "{}").annotation === true) it.n_annotations++; } catch { /* 坏行忽略 */ } }
      if (e.type === "card.created") it.n_cards++;
    }

    // 每日指标：engaged / deliberate_production / review 计数
    let deliberate = 0;
    for (const row of dom.values()) deliberate += row.deliberate_production;
    const evFor = (type) => evs.filter((e) => e.type === type).length;
    deliberate = evFor("extract.created") + evFor("card.created") + evFor("review.source_opened");
    const engaged = dayActive >= 10 * 60000 || answerValid >= 5 * 60000 || deliberate >= 2 ? 1 : 0;
    addMetric("engaged", "all", "*", 1, engaged);
    addMetric("deliberate_production", "all", "*", 1, deliberate);
    addMetric("session.count", "all", "*", 0, 0);

    return { day, dom, items, metrics, signals, quality, nReviews, answerValid };
  }

  function writeDay(computed) {
    const { day, dom, items, metrics, signals, quality } = computed;
    db.prepare("DELETE FROM daily_metrics WHERE day = ?").run(day);
    db.prepare("DELETE FROM domain_day WHERE day = ?").run(day);
    db.prepare("DELETE FROM item_day WHERE day = ?").run(day);
    db.prepare("DELETE FROM signal_daily WHERE day = ?").run(day);
    const mStmt = db.prepare("INSERT INTO daily_metrics (day, metric, dim_type, dim_value, n, sum, quality, rv) VALUES (?,?,?,?,?,?,?,?)");
    for (const m of metrics.values()) mStmt.run(day, m.metric, m.dimType, m.dimValue, m.n, m.sum, quality, deriveVersion);
    const dStmt = db.prepare(`INSERT INTO domain_day (day, udc, level, active_ms, idle_ms, self_ms, pushed_ms, neutral_ms,
      read_ms, review_ms, xreview_ms, author_ms, browse_ms, other_ms, answer_ms, n_reviews, n_again, n_hard, n_good, n_easy,
      n_new_reviewed, n_extracts, n_annotations, n_cards_manual, n_cards_ai_kept, n_opens_self, n_source_jumps, n_explains,
      n_queries, n_skips, n_defers, n_deletes, deliberate_production, n_items, quality, rv)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of dom.values()) {
      dStmt.run(day, r.udc, r.level, r.active_ms, r.idle_ms, r.self_ms, r.pushed_ms, r.neutral_ms,
        r.read_ms, r.review_ms, r.xreview_ms, r.author_ms, r.browse_ms, r.other_ms, r.answer_ms,
        r.n_reviews, r.n_again, r.n_hard, r.n_good, r.n_easy, r.n_new_reviewed, r.n_extracts, r.n_annotations,
        r.n_cards_manual, r.n_cards_ai_kept, r.n_opens_self, r.n_source_jumps, r.n_explains, r.n_queries,
        r.n_skips, r.n_defers, r.n_deletes, r.deliberate_production, r.n_items, quality, deriveVersion);
    }
    const iStmt = db.prepare(`INSERT INTO item_day (day, library_item_id, active_ms, self_ms, pushed_ms, n_opens,
      n_extracts, n_annotations, n_cards, n_reviews, progress_chars, covered_chars, first_origin, quality, rv)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of items.values()) {
      iStmt.run(day, r.library_item_id, r.active_ms, r.self_ms, r.pushed_ms, r.n_opens, r.n_extracts,
        r.n_annotations, r.n_cards, r.n_reviews, r.progress_chars, r.covered_chars, r.first_origin, quality, deriveVersion);
    }
    const sStmt = db.prepare("INSERT INTO signal_daily (day, signal_id, udc, level, n, value, quality, rv) VALUES (?,?,?,?,?,?,?,?)");
    for (const s of signals.values()) {
      if (!(s.value > 0)) continue;
      sStmt.run(day, s.id, s.udc, s.level, s.n, s.value, quality, deriveVersion);
    }
  }

  function metaGet(key) {
    try { return db.prepare("SELECT value FROM bdi_meta WHERE key = ?").get(key)?.value ?? null; } catch { return null; }
  }
  function metaSet(key, value) {
    db.prepare("INSERT INTO bdi_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  }

  function markDirtyDays() {
    const seq = Number(metaGet("rollup_seq_watermark")) || 0;
    const attn = Number(metaGet("rollup_attn_watermark")) || 0;
    const newDays = db.prepare("SELECT DISTINCT day FROM events WHERE seq > ?").all(seq);
    const newAttnDays = db.prepare("SELECT DISTINCT day FROM attn_spans WHERE id > ?").all(attn);
    const ins = db.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, 'rollup')");
    db.transaction(() => { for (const r of newDays) if (r.day) ins.run(r.day); for (const r of newAttnDays) if (r.day) ins.run(r.day); })();
    return { seq, attn };
  }

  /** 增量：脏日重算；返回处理的天数。 */
  function rollupIncremental() {
    const archived = new Set(db.prepare("SELECT day FROM archived_days").all().map((r) => r.day));
    const dirty = db.prepare("SELECT day FROM dirty_days").all().map((r) => r.day);
    const mark = markDirtyDays();
    const all = new Set([...dirty, ...db.prepare("SELECT day FROM dirty_days").all().map((r) => r.day)]);
    const days = [...all].filter((d) => !archived.has(d)).sort();
    for (const day of days) {
      db.transaction(() => { writeDay(computeDay(day)); db.prepare("DELETE FROM dirty_days WHERE day = ?").run(day); })();
    }
    metaSet("rollup_seq_watermark", String(db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get().m));
    metaSet("rollup_attn_watermark", String(db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM attn_spans").get().m));
    metaSet("derive_version", String(deriveVersion));
    metaSet("last_rollup_at", String(now()));
    void mark;
    return days.length;
  }

  /** DERIVE_VERSION 变化：清空非归档派生并全量重建（归档日保持旧版）。 */
  function ensureDeriveVersion() {
    const stored = Number(metaGet("derive_version"));
    if (stored === deriveVersion) return false;
    const archived = new Set(db.prepare("SELECT day FROM archived_days").all().map((r) => r.day));
    const days = [...new Set([
      ...db.prepare("SELECT DISTINCT day FROM events").all().map((r) => r.day),
      ...db.prepare("SELECT DISTINCT day FROM attn_spans").all().map((r) => r.day),
    ])].filter((d) => d && !archived.has(d));
    db.transaction(() => {
      if (stored !== null && stored !== undefined) {
        db.prepare("DELETE FROM daily_metrics").run();
        db.prepare("DELETE FROM domain_day").run();
        db.prepare("DELETE FROM item_day").run();
        db.prepare("DELETE FROM signal_daily").run();
      }
      const ins = db.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, 'derive')");
      for (const d of days) ins.run(d);
    })();
    return true;
  }

  return { refreshIncremental: rollupIncremental, ensureDeriveVersion, computeDay, deriveVersion };
}

module.exports = { DERIVE_VERSION, createRollup, initiativeOf };
