// BDI（D248 / T4）：IPC 诊断计数——channel → n/err/sum_ms/max_ms，60s 落 ipc_daily（§7.1 规则 9）。
// 纪律：只维护有界 Map；排除 behavior:*（避免自反馈）；ipc_daily 不是用户学习次数，不得当行为指标。
"use strict";

const FLUSH_MS = 60 * 1000;

function createIpcStats(opts) {
  const now = typeof opts?.now === "function" ? opts.now : Date.now;
  const intervalMs = Number.isInteger(opts?.flushIntervalMs) && opts.flushIntervalMs > 0 ? opts.flushIntervalMs : FLUSH_MS;
  const dayOf = typeof opts?.dayOf === "function" ? opts.dayOf : () => null;
  const buckets = new Map(); // channel → { n, err, sum, max }
  let timer = null;
  let db = null;
  let lastDay = null;

  function record(channel, ms, isError) {
    if (typeof channel !== "string" || channel.startsWith("behavior:")) return;
    let b = buckets.get(channel);
    if (!b) {
      b = { n: 0, err: 0, sum: 0, max: 0 };
      buckets.set(channel, b);
    }
    const v = Number.isFinite(ms) && ms >= 0 ? ms : 0;
    b.n++;
    if (isError) b.err++;
    b.sum += v;
    if (v > b.max) b.max = v;
  }

  const INSERT = `INSERT INTO ipc_daily (day, channel, n, err, sum_ms, max_ms) VALUES (?,?,?,?,?,?)
    ON CONFLICT(day, channel) DO UPDATE SET
      n = ipc_daily.n + excluded.n,
      err = ipc_daily.err + excluded.err,
      sum_ms = ipc_daily.sum_ms + excluded.sum_ms,
      max_ms = MAX(ipc_daily.max_ms, excluded.max_ms)`;

  /** 把当前计数写入指定学习日；reset=true 时清空内存桶。返回写入的 channel 数。 */
  function flushTo(conn, day, reset = true) {
    if (!conn || !day || buckets.size === 0) return 0;
    const stmt = conn.prepare(INSERT);
    const rows = [...buckets.entries()];
    conn.transaction(() => {
      for (const [channel, b] of rows) {
        if (b.n === 0) continue;
        stmt.run(day, channel, b.n, b.err, b.sum, b.max);
        if (reset) {
          b.n = 0;
          b.err = 0;
          b.sum = 0;
          b.max = 0;
        }
      }
    })();
    if (reset) {
      for (const [channel, b] of buckets) if (b.n === 0) buckets.delete(channel);
    }
    return rows.length;
  }

  /** 每分钟：跨学习日先切批（旧日先落，再换新日）。 */
  function tick() {
    if (!db) return 0;
    const day = dayOf();
    if (!day) return 0;
    if (lastDay === null) lastDay = day;
    if (day !== lastDay) {
      const written = flushTo(db, lastDay, true);
      lastDay = day;
      return written;
    }
    return flushTo(db, day, true);
  }

  function start(conn) {
    db = conn;
    lastDay = dayOf();
    if (timer) return;
    timer = setInterval(() => {
      try { tick(); } catch { /* 诊断计数失败不影响业务 */ }
    }, intervalMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (db) {
      try { if (lastDay) flushTo(db, lastDay, true); } catch { /* 退出期尽力而为 */ }
    }
    db = null;
  }

  function snapshot() {
    const out = {};
    for (const [channel, b] of buckets) out[channel] = { ...b };
    return out;
  }

  return { record, flushTo, tick, start, stop, snapshot };
}

module.exports = { FLUSH_MS, createIpcStats };
