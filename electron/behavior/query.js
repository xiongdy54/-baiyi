// BDI（D248 / T11）：具名只读查询（禁止任意 SQL / 表名 / 列名 / 文件路径）。§10 + 附录 A。
"use strict";
const { METRICS_VERSION, METRICS, DOMAIN_COLUMNS } = require("./metrics");
const { CATALOG_VERSION } = require("./registry");
const { DERIVE_VERSION } = require("./rollup");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayIndex = (day) => {
  const [y, m, d] = String(day).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
const DAY_MS = 86400000;

/** 附录 A：runs 内部一律整数 day index；unknown 不能当休息日；isOpen 不是预测。 */
function buildRuns(rows, todayIndex, grace = 1) {
  const byDay = new Map(rows.map((r) => [dayIndex(r.day), r.engaged]));
  const engaged = rows.filter((r) => r.engaged === 1).map((r) => dayIndex(r.day)).sort((a, b) => a - b);
  const runs = [];
  let cur = null;
  for (const d of engaged) {
    let bridge = !!cur && d - cur.end - 1 <= grace;
    if (bridge) {
      for (let k = cur.end + 1; k < d; k++) {
        if (byDay.get(k) !== 0) { bridge = false; break; }
      }
    }
    if (bridge) { cur.end = d; cur.engagedDays++; }
    else { if (cur) runs.push(cur); cur = { start: d, end: d, engagedDays: 1 }; }
  }
  if (cur) runs.push(cur);
  for (const r of runs) {
    r.spanDays = r.end - r.start + 1;
    r.gapDays = r.spanDays - r.engagedDays;
    const completedGaps = Math.max(0, todayIndex - r.end - 1);
    r.isOpen = completedGaps <= grace;
    for (let k = r.end + 1; r.isOpen && k < todayIndex; k++) {
      if (byDay.get(k) !== 0) r.isOpen = false;
    }
    r.startDay = new Date(r.start * DAY_MS).toISOString().slice(0, 10);
    r.endDay = new Date(r.end * DAY_MS).toISOString().slice(0, 10);
  }
  return runs;
}

/** Wilson 95% 下界（整数样本；p 只在 [0,1]）。 */
function wilsonLower(success, total, z = 1.96) {
  if (!Number.isInteger(total) || total <= 0) return null;
  const p = success / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

function createQuery(opts) {
  const db = opts.db;
  const pull = opts.pull;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const todayDay = typeof opts.todayDay === "function" ? opts.todayDay : () => new Date().toISOString().slice(0, 10);

  function range(from, to) {
    if (!DAY_RE.test(String(from)) || !DAY_RE.test(String(to))) throw new Error("query：日期必须 YYYY-MM-DD");
    return db.prepare("SELECT * FROM daily_metrics WHERE day >= ? AND day <= ?").all(from, to);
  }

  const queries = {
    status() {
      return {
        catalogVersion: CATALOG_VERSION,
        metricsVersion: METRICS_VERSION,
        deriveVersion: DERIVE_VERSION,
        counts: {
          events: db.prepare("SELECT COUNT(*) AS n FROM events").get().n,
          spans: db.prepare("SELECT COUNT(*) AS n FROM attn_spans").get().n,
          daily: db.prepare("SELECT COUNT(*) AS n FROM daily_metrics").get().n,
          domains: db.prepare("SELECT COUNT(*) AS n FROM entity_domains").get().n,
        },
      };
    },
    metrics(params) {
      const p = params || {};
      const rows = range(p.from, p.to);
      return { version: METRICS_VERSION, from: p.from, to: p.to, rows };
    },
    domainDay(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const rows = db.prepare("SELECT * FROM domain_day WHERE day >= ? AND day <= ? ORDER BY day, udc").all(p.from, p.to);
      return { from: p.from, to: p.to, columns: DOMAIN_COLUMNS.map((c) => c.column), rows };
    },
    signals(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const ids = Array.isArray(p.ids) ? p.ids.map(String) : null;
      const rows = db.prepare("SELECT * FROM signal_daily WHERE day >= ? AND day <= ? ORDER BY day, signal_id").all(p.from, p.to)
        .filter((r) => !ids || ids.includes(r.signal_id));
      return { from: p.from, to: p.to, rows };
    },
    attentionByDomain(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const rows = db.prepare(`SELECT udc, level, SUM(active_ms) AS active_ms, SUM(idle_ms) AS idle_ms,
        SUM(self_ms) AS self_ms, SUM(pushed_ms) AS pushed_ms, SUM(neutral_ms) AS neutral_ms
        FROM domain_day WHERE day >= ? AND day <= ? GROUP BY udc, level ORDER BY active_ms DESC`).all(p.from, p.to);
      return { from: p.from, to: p.to, rows };
    },
    /** review.rated ↔ review_logs 一对一窗口匹配；ambiguous/missing 不猜（§7.1 / V1-1）。 */
    reviewContext(params) {
      const p = params || {};
      const cardId = p.cardId ? String(p.cardId) : null;
      if (!cardId) throw new Error("query.reviewContext 需要 cardId");
      const from = p.from || "0000-00-00";
      const to = p.to || "9999-99-99";
      const rated = db.prepare("SELECT * FROM events WHERE type = 'review.rated' AND card_id = ? AND day >= ? AND day <= ? ORDER BY ts")
        .all(cardId, from, to);
      const out = [];
      for (const ev of rated) {
        let props = {};
        try { props = JSON.parse(ev.props || "{}"); } catch { props = {}; }
        const dur = Number.isFinite(Number(props.durationMs)) ? Number(props.durationMs) : 0;
        const lo = Number(ev.ts) - Math.max(0, dur) - 2000;
        const hi = Number(ev.ts) + 2000;
        const hits = pull({ table: "review_logs", mode: "time", cursor: { ts: lo - 1, rowid: 0 }, limit: 500 })
          .filter((r) => r.card_id === cardId && r.reviewed_at >= lo && r.reviewed_at <= hi);
        out.push({
          tapEventUid: ev.uid,
          tapStartTs: props.tapStartTs ?? null,
          tapEndTs: props.tapEndTs ?? null,
          status: hits.length === 1 ? "matched" : hits.length > 1 ? "ambiguous" : "missing",
          reviewLogId: hits.length === 1 ? hits[0].id : null,
          candidates: hits.map((r) => r.id),
        });
      }
      const base = pull({ table: "review_logs", mode: "time", cursor: { ts: 0, rowid: 0 }, limit: 500 }).filter((r) => r.card_id === cardId);
      return { cardId, rows: out, baseReviewCount: base.length };
    },
    /** 覆盖充分度：请求窗口 / 实际观察 / 已知 / 未知 / 估算日（不悄悄裁缺失日）。 */
    dataSufficiency(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const all = db.prepare("SELECT day, state FROM coverage_day WHERE metric_key = 'events' AND day >= ? AND day <= ?").all(p.from, p.to);
      const known = all.filter((r) => r.state === "complete" || r.state === "partial");
      const unknown = all.filter((r) => r.state === "unknown");
      // 窗口内完全没有 coverage 行的日期也算 unknown（不假设完整）
      const seen = new Set(all.map((r) => r.day));
      let cursor = dayIndex(p.from);
      const end = dayIndex(p.to);
      for (; cursor <= end; cursor++) {
        const day = new Date(cursor * DAY_MS).toISOString().slice(0, 10);
        if (!seen.has(day)) unknown.push({ day, state: "unknown" });
      }
      return {
        requestedWindow: { from: p.from, to: p.to, days: end - dayIndex(p.from) + 1 },
        observedWindow: { from: known[0]?.day || null, to: known[known.length - 1]?.day || null },
        knownDays: known.length,
        unknownDays: unknown.length,
        estimateDays: all.filter((r) => r.state === "partial").length,
        reason: unknown.length ? "unknown_days" : null,
      };
    },
    /** 连续投入区间（整数 day index 内部，输出转日期）。 */
    runs(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const rows = db.prepare(`SELECT day, MAX(CASE WHEN metric = 'engaged' THEN sum ELSE 0 END) AS engaged
        FROM daily_metrics WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day`).all(p.from, p.to);
      const grace = Number.isInteger(p.grace) ? p.grace : 1;
      return { runs: buildRuns(rows, dayIndex(p.to), grace), leftCensored: true };
    },
    /** 按学习日衰减（半衰期 1..365）；raw 与 decayed 同单位。 */
    decayed(params) {
      const p = params || {};
      if (!DAY_RE.test(String(p.from)) || !DAY_RE.test(String(p.to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const halfLife = Math.max(1, Math.min(365, Number(p.halfLifeDays) || 30));
      const ids = Array.isArray(p.ids) ? p.ids.map(String) : null;
      const rows = db.prepare("SELECT day, signal_id, udc, level, value FROM signal_daily WHERE day >= ? AND day <= ?")
        .all(p.from, p.to).filter((r) => !ids || ids.includes(r.signal_id));
      const today = dayIndex(todayDay());
      const out = new Map();
      for (const r of rows) {
        const age = Math.max(0, today - dayIndex(r.day));
        const key = `${r.signal_id}\u0000${r.udc}\u0000${r.level}`;
        const cur = out.get(key) || { signal: r.signal_id, udc: r.udc, level: r.level, raw: 0, decayed: 0 };
        cur.raw += r.value;
        cur.decayed += r.value * Math.pow(0.5, age / halfLife);
        out.set(key, cur);
      }
      return { halfLifeDays: halfLife, rows: [...out.values()] };
    },
    /** pass_rate / lb（Review 态有效评分、主领域独占整数样本）。 */
    passRate(params) {
      const p = params || {};
      const from = p.from;
      const to = p.to;
      if (!DAY_RE.test(String(from)) || !DAY_RE.test(String(to))) throw new Error("query：日期必须 YYYY-MM-DD");
      const lo = dayIndex(from) * DAY_MS;
      const hi = (dayIndex(to) + 1) * DAY_MS;
      const rows = pull({ table: "review_logs", mode: "time", cursor: { ts: lo - 1, rowid: 0 }, limit: 500 })
        .filter((r) => r.reviewed_at >= lo && r.reviewed_at < hi);
      let total = 0;
      let pass = 0;
      for (const r of rows) {
        let st = null;
        try { st = JSON.parse(r.fsrs_before_json || "null"); } catch { st = null; }
        if (!st || st.state !== "Review") continue;
        if (p.udc) {
          const dom = db.prepare("SELECT udc_main FROM entity_domains WHERE entity_type = 'card' AND entity_id = ?").get(r.card_id);
          if (!dom || dom.udc_main !== p.udc) continue;
        }
        total++;
        if (r.rating !== "again") pass++;
      }
      return { total, pass, rate: total ? pass / total : null, lowerBound: wilsonLower(pass, total) };
    },
  };

  return { queries, buildRuns, wilsonLower, names: Object.keys(queries) };
}

module.exports = { createQuery, buildRuns, wilsonLower };
