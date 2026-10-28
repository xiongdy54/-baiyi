// BDI（D248 / T11）：覆盖语义——capture_intervals → coverage_day（complete/partial/unknown/unsupported/archived）。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §9.3。
// 纪律：应用没运行不等于没在别处学习；本产品的 0 只表示「本应用内无已知动作」；缺数据不补 0。
"use strict";
const { learningDayStartMs } = require("../fsrsTime");

const KEYS = ["events", "attention", "review", "reading", "domains", "sessions", "ipc"];

function createCoverage(opts) {
  const db = opts.db;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const cutoffHour = typeof opts.cutoffHour === "function" ? opts.cutoffHour : () => 4;

  const upsert = db.prepare(`INSERT INTO coverage_day (day, metric_key, state, lost_n, flags_json)
    VALUES (?,?,?,?,?)
    ON CONFLICT(day, metric_key) DO UPDATE SET state = excluded.state, lost_n = excluded.lost_n, flags_json = excluded.flags_json`);

  function dayBounds(day) {
    const [y, m, d] = String(day).split("-").map(Number);
    const noon = Date.UTC(y, m - 1, d, 12, 0, 0);
    const start = learningDayStartMs(noon, cutoffHour());
    const nd = new Date(start + 36 * 3600000);
    const next = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-${String(nd.getDate()).padStart(2, "0")}`;
    const end = learningDayStartMs(Date.UTC(nd.getFullYear(), nd.getMonth(), nd.getDate(), 12, 0, 0), cutoffHour());
    return { start, end };
  }

  /** 重算某日覆盖：归档优先；无 interval → unknown；被 enabled interval 全覆盖 → complete；否则 partial。 */
  function computeDay(day) {
    const archived = db.prepare("SELECT 1 FROM archived_days WHERE day = ?").get(day);
    const { start, end } = dayBounds(day);
    const intervals = db.prepare("SELECT start_ts, end_ts, state FROM capture_intervals WHERE end_ts IS NULL OR (end_ts > ? AND start_ts < ?)")
      .all(start, end);
    const dropped = Number(db.prepare("SELECT COALESCE(SUM(n),0) AS n FROM ipc_daily WHERE day = ?").get(day)?.n || 0);
    const flags = [];
    let state;
    if (archived) {
      state = "archived";
    } else if (!intervals.length) {
      state = "unknown";
    } else {
      const enabled = intervals.filter((i) => i.state === "enabled");
      const covered = enabled.reduce((s, i) => s + Math.max(0, Math.min(end, i.end_ts || end) - Math.max(start, i.start_ts)), 0);
      const span = end - start;
      if (enabled.length === 0) {
        state = "partial";
        flags.push("disabled");
      } else if (covered >= span - 60000) {
        state = "complete";
      } else {
        state = "partial";
        flags.push("gap");
      }
      if (intervals.some((i) => i.state === "fault")) flags.push("fault");
    }
    if (dropped > 0) flags.push("ipc_dropped");
    db.transaction(() => {
      for (const key of KEYS) {
        // review/reading 能力跟随主库真源存在性：主库无数据也不判 unsupported（本应用内 0 是合法 0）
        upsert.run(day, key, state, dropped, JSON.stringify(flags));
      }
    })();
    return state;
  }

  function refreshDays(days) {
    const list = [...new Set(days.filter(Boolean))];
    for (const day of list) computeDay(day);
    return list.length;
  }

  return { computeDay, refreshDays, KEYS };
}

module.exports = { createCoverage, KEYS };
