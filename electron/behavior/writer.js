// BDI（D248 / T2）：写入器——1s/500 条批量事务、FULL 同步、限流、丢弃计数、span upsert。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.6（+ §5.2 DDL）。
// 纪律：校验先行（registry.validate）；一条毒数据不得让整批永久重试；禁用时零写入。
"use strict";
const { uuid7, isUuid } = require("./uuid7");
const registry = require("./registry");

const MAX_QUEUE = 5000;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 500;
const MAX_BATCH_BYTES = 512 * 1024;
const DROPPED_FLUSH_MS = 60 * 1000;

const EVENT_COLUMNS = [
  "uid", "ts", "recv_ts", "source_ts", "day", "tz_name", "tz_offset", "cutoff_hour", "clock_flags",
  "type", "v", "src", "render_id", "window_id", "session_id", "ctx_id", "presentation_id", "op_id",
  "actor", "surface", "origin", "entity_type", "entity_id", "library_item_id", "card_id", "extract_id",
  "kp_id", "doc_pos", "dur_ms", "num", "text", "props",
];
const INSERT_EVENT_SQL = `INSERT INTO events (${EVENT_COLUMNS.join(", ")}) VALUES (${EVENT_COLUMNS.map(() => "?").join(", ")})`;

const SPAN_COLUMNS = [
  "uid", "session_id", "render_id", "window_id", "src", "day", "start_ts", "end_ts", "surface",
  "entity_type", "entity_id", "library_item_id", "card_id", "extract_id", "ctx_id", "origin",
  "active_ms", "idle_ms", "mono_ms", "pos_ranges", "keys", "clicks", "scroll_px", "revision", "closed",
  "end_reason", "tz_name", "cutoff_hour", "clock_flags",
];
const UPSERT_SPAN_SQL = `INSERT INTO attn_spans (${SPAN_COLUMNS.join(", ")}) VALUES (${SPAN_COLUMNS.map(() => "?").join(", ")})
ON CONFLICT(uid) DO UPDATE SET
  ${SPAN_COLUMNS.filter((c) => c !== "uid").map((c) => `${c} = excluded.${c}`).join(", ")}
WHERE attn_spans.closed = 0 AND excluded.revision > attn_spans.revision`;

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 事件 → 绑定的列数组（缺省值在此归一，校验已在 push 时完成）。 */
function eventRow(e, newUid = uuid7) {
  const row = {};
  row.uid = e.uid || newUid();
  row.ts = e.ts;
  row.recv_ts = e.recv_ts;
  row.source_ts = e.source_ts ?? null;
  row.day = e.day;
  row.tz_name = e.tz_name ?? null;
  row.tz_offset = e.tz_offset;
  row.cutoff_hour = e.cutoff_hour;
  row.clock_flags = e.clock_flags ?? 0;
  row.type = e.type;
  row.v = e.v ?? 1;
  row.src = e.src;
  row.render_id = e.render_id ?? null;
  row.window_id = e.window_id ?? null;
  row.session_id = e.session_id;
  row.ctx_id = e.ctx_id ?? null;
  row.presentation_id = e.presentation_id ?? null;
  row.op_id = e.op_id ?? null;
  row.actor = e.actor ?? "unknown";
  row.surface = e.surface ?? null;
  row.origin = e.origin ?? null;
  row.entity_type = e.entity_type ?? null;
  row.entity_id = e.entity_id ?? null;
  row.library_item_id = e.library_item_id ?? null;
  row.card_id = e.card_id ?? null;
  row.extract_id = e.extract_id ?? null;
  row.kp_id = e.kp_id ?? null;
  row.doc_pos = e.doc_pos ?? null;
  row.dur_ms = e.dur_ms ?? null;
  row.num = e.num ?? null;
  row.text = e.text ?? null;
  row.props = JSON.stringify(e.props && isPlainObject(e.props) ? e.props : {});
  return EVENT_COLUMNS.map((c) => row[c]);
}

function spanRow(s) {
  const row = {
    uid: s.uid,
    session_id: s.session_id,
    render_id: s.render_id ?? null,
    window_id: s.window_id ?? null,
    src: s.src,
    day: s.day,
    start_ts: s.start_ts,
    end_ts: s.end_ts,
    surface: s.surface,
    entity_type: s.entity_type ?? null,
    entity_id: s.entity_id ?? null,
    library_item_id: s.library_item_id ?? null,
    card_id: s.card_id ?? null,
    extract_id: s.extract_id ?? null,
    ctx_id: s.ctx_id ?? null,
    origin: s.origin ?? null,
    active_ms: s.active_ms,
    idle_ms: s.idle_ms,
    mono_ms: s.mono_ms,
    pos_ranges: s.pos_ranges == null ? null : JSON.stringify(s.pos_ranges),
    keys: s.keys ?? 0,
    clicks: s.clicks ?? 0,
    scroll_px: s.scroll_px ?? 0,
    revision: s.revision ?? 1,
    closed: s.closed ? 1 : 0,
    end_reason: s.end_reason ?? null,
    tz_name: s.tz_name ?? null,
    cutoff_hour: s.cutoff_hour,
    clock_flags: s.clock_flags ?? 0,
  };
  return SPAN_COLUMNS.map((c) => row[c]);
}

/** span 的轻校验（不查库）：坏行直接拒收，不进队列。 */
function validateSpan(s) {
  if (!isPlainObject(s)) return { ok: false, code: "span_not_object" };
  if (!isUuid(s.uid)) return { ok: false, code: "span_uid_invalid" };
  if (typeof s.session_id !== "string" || s.session_id === "") return { ok: false, code: "span_session_missing" };
  if (!registry.SOURCES.includes(s.src)) return { ok: false, code: "span_src_unknown" };
  if (typeof s.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.day)) return { ok: false, code: "span_day_invalid" };
  for (const k of ["start_ts", "end_ts", "active_ms", "idle_ms"]) {
    if (!Number.isInteger(s[k]) || s[k] < 0) return { ok: false, code: "span_number_invalid" };
  }
  if (s.end_ts < s.start_ts) return { ok: false, code: "span_range_invalid" };
  if (typeof s.mono_ms !== "number" || !Number.isFinite(s.mono_ms) || s.mono_ms < 0) return { ok: false, code: "span_number_invalid" };
  if (typeof s.surface !== "string" || s.surface === "") return { ok: false, code: "span_surface_missing" };
  if (!Number.isInteger(s.revision) || s.revision < 1) return { ok: false, code: "span_revision_invalid" };
  if (!Number.isInteger(s.cutoff_hour) || s.cutoff_hour < 0 || s.cutoff_hour > 23) return { ok: false, code: "span_cutoff_invalid" };
  if (s.closed !== undefined && s.closed !== 0 && s.closed !== 1 && s.closed !== true && s.closed !== false) return { ok: false, code: "span_closed_invalid" };
  if (s.pos_ranges != null) {
    if (!Array.isArray(s.pos_ranges) || s.pos_ranges.length > 20) return { ok: false, code: "span_ranges_invalid" };
    for (const r of s.pos_ranges) {
      if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || !Number.isInteger(r[1])) return { ok: false, code: "span_ranges_invalid" };
    }
  }
  return { ok: true };
}

/**
 * 创建写入器。
 * opts: db(better-sqlite3 实例) / recordQueryText / maxQueue / flushIntervalMs / now / uuid / autoStart
 */
function createWriter(opts) {
  const db = opts.db;
  const maxQueue = Number.isInteger(opts.maxQueue) && opts.maxQueue > 0 ? opts.maxQueue : MAX_QUEUE;
  const flushIntervalMs = Number.isInteger(opts.flushIntervalMs) && opts.flushIntervalMs > 0 ? opts.flushIntervalMs : FLUSH_INTERVAL_MS;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const newUid = typeof opts.uuid === "function" ? opts.uuid : uuid7;
  let recordQueryText = opts.recordQueryText === true;

  let enabled = true;
  let queue = [];
  let queueBytes = 0;
  let timer = null;
  let droppedTimer = null;
  let scheduled = null;
  let rate = new Map();
  const counters = { written: 0, rejected: 0, flushes: 0, dropped: Object.create(null) };
  let lastFlushAt = null;
  let lastError = null;

  const insertEvent = db.prepare(INSERT_EVENT_SQL);
  const upsertSpan = db.prepare(UPSERT_SPAN_SQL);

  function drop(reason) {
    counters.dropped[reason] = (counters.dropped[reason] || 0) + 1;
  }

  function clearQueue() {
    queue = [];
    queueBytes = 0;
  }

  function rateLimited(type, ts) {
    const meta = registry.getEvent(type);
    const max = meta ? meta.maxPerMin : 60;
    const minute = Math.floor(ts / 60000);
    const cur = rate.get(type);
    if (!cur || cur.minute !== minute) {
      rate.set(type, { minute, count: 1 });
      return false;
    }
    if (cur.count >= max) return true;
    cur.count++;
    return false;
  }

  /** 达到 500 条阈值时在下一个事件循环冲刷（不在热路径同步落盘）。 */
  function scheduleFlush() {
    if (scheduled || !enabled) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      try { flushSync(); } catch { /* flushSync 内部已兜底 */ }
    });
    if (scheduled.unref) scheduled.unref();
  }

  /** 入队一条事件。校验失败/限流/溢出都只计数，不影响调用方。 */
  function push(event) {
    if (!enabled) return { ok: false, code: "disabled" };
    const v = registry.validate(event, { recordQueryText });
    if (!v.ok) {
      counters.rejected++;
      drop(`validate:${v.code}`);
      return { ok: false, code: v.code };
    }
    if (rateLimited(event.type, event.ts)) {
      drop("rate_limited");
      return { ok: false, code: "rate_limited" };
    }
    if (queue.length >= maxQueue) {
      const oldest = queue.shift();
      queueBytes -= oldest.bytes || 0;
      drop("queue_overflow");
    }
    if (!event.uid) event.uid = newUid(); // 一次生成、重试不换（§7.2）
    const bytes = 120 + (event.text ? event.text.length : 0) + JSON.stringify(event.props || {}).length;
    queue.push({ kind: "event", type: event.type, day: event.day, src: event.src, event, bytes });
    queueBytes += bytes;
    if (queue.length >= MAX_BATCH) scheduleFlush();
    return { ok: true, uid: event.uid };
  }

  /** 入队一条注意力 span（心跳复用同一 uid + 递增 revision）。 */
  function pushSpan(span) {
    if (!enabled) return { ok: false, code: "disabled" };
    const v = validateSpan(span);
    if (!v.ok) {
      counters.rejected++;
      drop(`validate:${v.code}`);
      return { ok: false, code: v.code };
    }
    if (queue.length >= maxQueue) {
      const oldest = queue.shift();
      queueBytes -= oldest.bytes || 0;
      drop("queue_overflow");
    }
    const bytes = 160;
    queue.push({ kind: "span", type: "attn.span", day: span.day, src: span.src, span, bytes });
    queueBytes += bytes;
    if (queue.length >= MAX_BATCH) scheduleFlush();
    return { ok: true, uid: span.uid };
  }

  /** 同步冲刷一批（≤500 条 / ≤512KiB），返回写入行数。 */
  function flushChunk() {
    if (!queue.length) return 0;
    const batch = [];
    let bytes = 0;
    while (queue.length && batch.length < MAX_BATCH && (batch.length === 0 || bytes + queue[0].bytes <= MAX_BATCH_BYTES)) {
      const item = queue.shift();
      bytes += item.bytes || 0;
      batch.push(item);
    }
    queueBytes = Math.max(0, queueBytes - bytes);
    const events = batch.filter((b) => b.kind === "event");
    const spans = batch.filter((b) => b.kind === "span");
    const tx = db.transaction(() => {
      for (const e of events) insertEvent.run(eventRow(e.event, newUid));
      for (const s of spans) upsertSpan.run(spanRow(s.span));
    });
    try {
      tx();
      counters.written += batch.length;
      lastFlushAt = now();
      return batch.length;
    } catch (e) {
      lastError = String((e && e.message) || e);
      // 约束错误：受限拆分逐行定位坏行，避免整批永久重试。
      if (/SQLITE_CONSTRAINT|constraint failed/i.test(lastError)) {
        let ok = 0;
        for (const item of batch) {
          try {
            if (item.kind === "event") insertEvent.run(eventRow(item.event, newUid));
            else upsertSpan.run(spanRow(item.span));
            ok++;
          } catch (err) {
            counters.rejected++;
            drop(`constraint:${item.type}`);
          }
        }
        counters.written += ok;
        lastFlushAt = now();
        return ok;
      }
      // IO/磁盘满：不逐行狂重试；本批计入丢弃，由上层降级（§7.6）。
      for (const item of batch) drop(`flush_error:${item.type}`);
      if (/SQLITE_FULL|disk|ENOSPC/i.test(lastError)) clearQueue();
      return 0;
    }
  }

  /** 同步冲刷全部队列（will-quit / 备份 / 导出前调用）。返回写入行数。 */
  function flushSync() {
    if (!enabled || !queue.length) return 0;
    let written = 0;
    while (queue.length) written += flushChunk();
    counters.flushes++;
    return written;
  }

  /** 把丢弃计数写回 bdi_meta（每 60s；测试可直接调用）。 */
  function flushDropped() {
    const reasons = Object.keys(counters.dropped);
    const totalNew = reasons.reduce((s, r) => s + counters.dropped[r], 0);
    if (!totalNew) return 0;
    try {
      const prevTotal = Number(db.prepare("SELECT value FROM bdi_meta WHERE key = 'dropped_total'").get()?.value || 0) || 0;
      let prevBy = {};
      try {
        prevBy = JSON.parse(String(db.prepare("SELECT value FROM bdi_meta WHERE key = 'dropped_by_reason_json'").get()?.value || "{}"));
      } catch { prevBy = {}; }
      if (!prevBy || typeof prevBy !== "object" || Array.isArray(prevBy)) prevBy = {};
      for (const r of reasons) prevBy[r] = (Number(prevBy[r]) || 0) + counters.dropped[r];
      const set = db.prepare("INSERT INTO bdi_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      db.transaction(() => {
        set.run("dropped_total", String(prevTotal + totalNew));
        set.run("dropped_by_reason_json", JSON.stringify(prevBy));
      })();
      for (const r of reasons) delete counters.dropped[r];
      return totalNew;
    } catch {
      return 0; // 诊断计数写失败不得影响业务
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      try { flushSync(); } catch { /* flushSync 内部已兜底 */ }
    }, flushIntervalMs);
    if (timer.unref) timer.unref();
    droppedTimer = setInterval(() => { flushDropped(); }, DROPPED_FLUSH_MS);
    if (droppedTimer.unref) droppedTimer.unref();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (droppedTimer) { clearInterval(droppedTimer); droppedTimer = null; }
  }

  function setEnabled(next) {
    enabled = next === true;
    if (!enabled) {
      clearQueue();
      rate = new Map();
    }
  }

  function setRecordQueryText(next) {
    recordQueryText = next === true;
  }

  function stats() {
    return {
      enabled,
      queued: queue.length,
      queuedBytes: queueBytes,
      written: counters.written,
      rejected: counters.rejected,
      flushes: counters.flushes,
      dropped: { ...counters.dropped },
      lastFlushAt,
      lastError,
    };
  }

  if (opts.autoStart !== false) start();

  return { push, pushSpan, flushSync, flushDropped, start, stop, setEnabled, setRecordQueryText, stats };
}

module.exports = {
  MAX_QUEUE,
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  MAX_BATCH_BYTES,
  DROPPED_FLUSH_MS,
  EVENT_COLUMNS,
  INSERT_EVENT_SQL,
  SPAN_COLUMNS,
  UPSERT_SPAN_SQL,
  eventRow,
  spanRow,
  validateSpan,
  createWriter,
};
