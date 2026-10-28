// BDI（D248 / T2）：独立行为库 behavior.db——打开、pragma、版本化迁移、快照、关闭。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §5.1–§5.3。
// LOCAL-ONLY：不走应用同步、不发起网络上传（本地备份/导出由用户管理）。
// 纪律：纯 Node 可测（不 require("electron")）；打开失败/损坏/版本过新一律 disabled、不抛出（§5.1）。
"use strict";
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { attachRun, applyStandardPragmas } = require("../sqliteCompat");

const BDI_SCHEMA_VERSION = 1;

const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS bdi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  ts              INTEGER NOT NULL,
  recv_ts         INTEGER NOT NULL,
  source_ts       INTEGER,
  day             TEXT NOT NULL,
  tz_name         TEXT,
  tz_offset       INTEGER NOT NULL,
  cutoff_hour     INTEGER NOT NULL,
  clock_flags     INTEGER NOT NULL DEFAULT 0,
  type            TEXT NOT NULL,
  v               INTEGER NOT NULL DEFAULT 1,
  src             TEXT NOT NULL,
  render_id       TEXT,
  window_id       INTEGER,
  session_id      TEXT NOT NULL,
  ctx_id          TEXT,
  presentation_id TEXT,
  op_id           TEXT,
  actor           TEXT NOT NULL DEFAULT 'unknown',
  surface         TEXT,
  origin          TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  library_item_id TEXT,
  card_id         TEXT,
  extract_id      TEXT,
  kp_id           TEXT,
  doc_pos         INTEGER,
  dur_ms          INTEGER,
  num             REAL,
  text            TEXT,
  props           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ev_day_type ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_ev_entity   ON events(entity_type, entity_id, ts);
CREATE INDEX IF NOT EXISTS idx_ev_card     ON events(card_id, ts) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_item     ON events(library_item_id, ts) WHERE library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_ctx      ON events(ctx_id) WHERE ctx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_session  ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_ev_op       ON events(op_id) WHERE op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_pres     ON events(presentation_id) WHERE presentation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attn_spans (
  id              INTEGER PRIMARY KEY,
  uid             TEXT NOT NULL UNIQUE,
  session_id      TEXT NOT NULL,
  render_id       TEXT,
  window_id       INTEGER,
  src             TEXT NOT NULL,
  day             TEXT NOT NULL,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER NOT NULL,
  surface         TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  library_item_id TEXT,
  card_id         TEXT,
  extract_id      TEXT,
  ctx_id          TEXT,
  origin          TEXT,
  active_ms       INTEGER NOT NULL,
  idle_ms         INTEGER NOT NULL,
  mono_ms         REAL NOT NULL,
  pos_ranges      TEXT,
  keys            INTEGER NOT NULL DEFAULT 0,
  clicks          INTEGER NOT NULL DEFAULT 0,
  scroll_px       INTEGER NOT NULL DEFAULT 0,
  revision        INTEGER NOT NULL DEFAULT 1,
  closed          INTEGER NOT NULL DEFAULT 0,
  end_reason      TEXT,
  tz_name         TEXT,
  cutoff_hour     INTEGER NOT NULL,
  clock_flags     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attn_day    ON attn_spans(day);
CREATE INDEX IF NOT EXISTS idx_attn_entity ON attn_spans(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attn_item   ON attn_spans(library_item_id) WHERE library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attn_open   ON attn_spans(closed) WHERE closed = 0;
CREATE INDEX IF NOT EXISTS idx_attn_session ON attn_spans(session_id);

CREATE TABLE IF NOT EXISTS app_sessions (
  id              TEXT PRIMARY KEY,
  data_epoch      TEXT NOT NULL,
  device_id       TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  end_reason      TEXT,
  clean_exit      INTEGER NOT NULL DEFAULT 0,
  last_seen_ts    INTEGER NOT NULL,
  app_version     TEXT NOT NULL,
  catalog_version INTEGER NOT NULL,
  os              TEXT NOT NULL,
  locale          TEXT,
  foreground_ms   INTEGER NOT NULL DEFAULT 0,
  active_ms       INTEGER NOT NULL DEFAULT 0,
  event_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ipc_daily (
  day      TEXT NOT NULL,
  channel  TEXT NOT NULL,
  n        INTEGER NOT NULL,
  err      INTEGER NOT NULL,
  sum_ms   REAL NOT NULL,
  max_ms   REAL NOT NULL,
  PRIMARY KEY (day, channel)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS entity_domains (
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  udc_json            TEXT NOT NULL DEFAULT '[]',
  udc_main            TEXT,
  lang                TEXT,
  method              TEXT NOT NULL,
  quality             TEXT NOT NULL DEFAULT 'unknown',
  attribution_version INTEGER NOT NULL DEFAULT 1,
  resolved_at         INTEGER NOT NULL,
  stale               INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS daily_metrics (
  day       TEXT NOT NULL,
  metric    TEXT NOT NULL,
  dim_type  TEXT NOT NULL,
  dim_value TEXT NOT NULL,
  n         INTEGER NOT NULL,
  sum       REAL NOT NULL,
  quality   TEXT NOT NULL DEFAULT 'unknown',
  rv        INTEGER NOT NULL,
  PRIMARY KEY (day, metric, dim_type, dim_value)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS domain_day (
  day                 TEXT NOT NULL,
  udc                 TEXT NOT NULL,
  level               TEXT NOT NULL,
  active_ms           REAL NOT NULL DEFAULT 0,
  idle_ms             REAL NOT NULL DEFAULT 0,
  self_ms             REAL NOT NULL DEFAULT 0,
  pushed_ms           REAL NOT NULL DEFAULT 0,
  neutral_ms          REAL NOT NULL DEFAULT 0,
  read_ms             REAL NOT NULL DEFAULT 0,
  review_ms           REAL NOT NULL DEFAULT 0,
  xreview_ms          REAL NOT NULL DEFAULT 0,
  author_ms           REAL NOT NULL DEFAULT 0,
  browse_ms           REAL NOT NULL DEFAULT 0,
  other_ms            REAL NOT NULL DEFAULT 0,
  answer_ms           REAL NOT NULL DEFAULT 0,
  n_reviews           INTEGER NOT NULL DEFAULT 0,
  n_again             INTEGER NOT NULL DEFAULT 0,
  n_hard              INTEGER NOT NULL DEFAULT 0,
  n_good              INTEGER NOT NULL DEFAULT 0,
  n_easy              INTEGER NOT NULL DEFAULT 0,
  n_new_reviewed      INTEGER NOT NULL DEFAULT 0,
  n_extracts          INTEGER NOT NULL DEFAULT 0,
  n_annotations       INTEGER NOT NULL DEFAULT 0,
  n_cards_manual      INTEGER NOT NULL DEFAULT 0,
  n_cards_ai_kept     INTEGER NOT NULL DEFAULT 0,
  n_opens_self        INTEGER NOT NULL DEFAULT 0,
  n_source_jumps      INTEGER NOT NULL DEFAULT 0,
  n_explains          INTEGER NOT NULL DEFAULT 0,
  n_queries           INTEGER NOT NULL DEFAULT 0,
  n_skips             INTEGER NOT NULL DEFAULT 0,
  n_defers            INTEGER NOT NULL DEFAULT 0,
  n_deletes           INTEGER NOT NULL DEFAULT 0,
  deliberate_production REAL NOT NULL DEFAULT 0,
  n_items             INTEGER NOT NULL DEFAULT 0,
  quality             TEXT NOT NULL DEFAULT 'unknown',
  rv                  INTEGER NOT NULL,
  PRIMARY KEY (day, udc, level)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_dd_udc ON domain_day(udc, level, day);

CREATE TABLE IF NOT EXISTS item_day (
  day             TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  active_ms       REAL NOT NULL DEFAULT 0,
  self_ms         REAL NOT NULL DEFAULT 0,
  pushed_ms       REAL NOT NULL DEFAULT 0,
  n_opens         INTEGER NOT NULL DEFAULT 0,
  n_extracts      INTEGER NOT NULL DEFAULT 0,
  n_annotations   INTEGER NOT NULL DEFAULT 0,
  n_cards         INTEGER NOT NULL DEFAULT 0,
  n_reviews       INTEGER NOT NULL DEFAULT 0,
  progress_chars  REAL,
  covered_chars   REAL,
  first_origin    TEXT,
  quality         TEXT NOT NULL DEFAULT 'unknown',
  rv              INTEGER NOT NULL,
  PRIMARY KEY (day, library_item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS signal_daily (
  day       TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  udc       TEXT NOT NULL,
  level     TEXT NOT NULL,
  n         INTEGER NOT NULL,
  value     REAL NOT NULL,
  quality   TEXT NOT NULL DEFAULT 'unknown',
  rv        INTEGER NOT NULL,
  PRIMARY KEY (day, signal_id, udc, level)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS capture_intervals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_session_id  TEXT NOT NULL,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER,
  state           TEXT NOT NULL,
  reason          TEXT,
  catalog_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_start ON capture_intervals(start_ts);

CREATE TABLE IF NOT EXISTS coverage_day (
  day        TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  state      TEXT NOT NULL,
  lost_n     INTEGER NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, metric_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS archived_days (
  day                 TEXT PRIMARY KEY,
  archived_at         INTEGER NOT NULL,
  rv                  INTEGER NOT NULL,
  attribution_version INTEGER NOT NULL,
  valid               INTEGER NOT NULL DEFAULT 1,
  reason              TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS dirty_days (
  day    TEXT PRIMARY KEY,
  reason TEXT NOT NULL
) WITHOUT ROWID;
`;

const BDI_MIGRATIONS = [
  { version: 1, name: "baseline", up(db) { db.exec(BASELINE_SQL); } },
];

let DATA_DIR = null;
let db = null;
let dbFile = null;
let openPromise = null;
let state = { status: "uninitialized", reason: null, detail: null };

function dataDir() {
  if (!DATA_DIR) throw new Error("behaviorDb 尚未 configure：数据目录未知（纯 Node 宿主须先注入）");
  return DATA_DIR;
}
function configure({ dataDir: dir }) {
  DATA_DIR = dir;
}

function readUserVersion(conn) {
  return Number(conn.pragma("user_version", { simple: true })) || 0;
}

/** 只读探测版本；文件损坏返回 { corrupt: true }。文件不存在返回 0。 */
function probeUserVersion(file) {
  if (!fs.existsSync(file)) return { version: 0, corrupt: false };
  let conn = null;
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true });
    return { version: readUserVersion(conn), corrupt: false };
  } catch (e) {
    const code = String((e && e.code) || "");
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" || /not a database|malformed/i.test(String(e && e.message))) {
      return { version: 0, corrupt: true };
    }
    return { version: 0, corrupt: true };
  } finally {
    if (conn) { try { conn.close(); } catch { /* 已关闭 */ } }
  }
}

/** 依次执行 version > 当前 的迁移，每项一个事务并在同事务写 user_version（形状仿 schemaVersion.js）。 */
function runMigrations(conn, migrations = BDI_MIGRATIONS) {
  let v = readUserVersion(conn);
  for (const m of migrations) {
    if (m.version <= v) continue;
    if (m.version !== v + 1) throw new Error(`BDI 迁移版本不连续：当前 ${v}，下一项 ${m.version}`);
    const tx = conn.transaction(() => {
      m.up(conn);
      conn.pragma(`user_version = ${m.version}`);
    });
    tx();
    v = m.version;
  }
  return v;
}

function applyBdiPragmas(conn) {
  // 建表前设置 auto_vacuum（对已建表的库需 VACUUM 才生效；新建库即生效）
  if (!conn.prepare("SELECT name FROM sqlite_master LIMIT 1").get()) conn.pragma("auto_vacuum = INCREMENTAL");
  applyStandardPragmas(conn);
  conn.pragma("busy_timeout = 2000");
  conn.pragma("journal_size_limit = 16777216");
  conn.pragma("wal_autocheckpoint = 1000");
  conn.pragma("foreign_keys = OFF");
  conn.pragma("temp_store = FILE");
  conn.pragma("cache_size = -8000");
}

function classifyOpenError(e) {
  const code = String((e && e.code) || "");
  const msg = String((e && e.message) || e);
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" || /not a database|malformed/i.test(msg)) return { reason: "db_corrupt", detail: msg };
  if (/ENOSPC|disk full|database or disk is full/i.test(msg + code)) return { reason: "disk_full", detail: msg };
  if (/EACCES|EPERM|EROFS|ENOENT|ENOTDIR/i.test(msg + code) || /permission denied/i.test(msg)) return { reason: "open_failed", detail: msg };
  return { reason: "db_error", detail: msg };
}

function disable(reason, detail) {
  state = { status: "disabled", reason, detail: detail || null };
  return null;
}

/**
 * 打开行为库（幂等）。绝不抛出：失败/损坏/版本过新 → status=disabled，调用方按 no-op 处理。
 * 版本过新：只读探测后停用，不迁移、不碰文件（§5.1）。
 */
async function open() {
  if (db) return db;
  if (openPromise) return openPromise;
  openPromise = (async () => {
    const dir = dataDir();
    dbFile = path.join(dir, "behavior.db");
    const probe = probeUserVersion(dbFile);
    if (probe.corrupt) return disable("db_corrupt", "只读探测失败：文件损坏或不是 SQLite 库（保留现场，不自动改名/新建）");
    if (probe.version > BDI_SCHEMA_VERSION) return disable("db_too_new", `库版本 ${probe.version} 高于本程序支持的 ${BDI_SCHEMA_VERSION}`);
    try {
      db = attachRun(new Database(dbFile));
      applyBdiPragmas(db);
      runMigrations(db);
      state = { status: "ok", reason: null, detail: null };
      return db;
    } catch (e) {
      try { if (db) db.close(); } catch { /* 已关闭 */ }
      db = null;
      const c = classifyOpenError(e);
      return disable(c.reason, c.detail);
    }
  })();
  openPromise.catch(() => { openPromise = null; });
  return openPromise;
}

function getDb() {
  return db;
}

function getFile() {
  return dbFile;
}

function getStatus() {
  return {
    status: state.status,
    reason: state.reason,
    detail: state.detail,
    open: !!db,
    file: dbFile || (DATA_DIR ? path.join(DATA_DIR, "behavior.db") : null),
    schemaVersion: BDI_SCHEMA_VERSION,
    userVersion: db ? readUserVersion(db) : null,
  };
}

function getMeta(key, fallback = null) {
  if (!db) return fallback;
  try {
    const row = db.prepare("SELECT value FROM bdi_meta WHERE key = ?").get(String(key));
    return row ? String(row.value) : fallback;
  } catch {
    return fallback;
  }
}

function setMeta(key, value) {
  if (!db) return false;
  db.prepare("INSERT INTO bdi_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(key), String(value));
  return true;
}

/** 快照到目标文件（备份 / 导出用）。调用方须先 flushSync 队列。 */
async function snapshotTo(dest) {
  if (!db) throw new Error(`behaviorDb 不可用（${state.reason || state.status}）：无法快照`);
  await db.backup(dest);
  return dest;
}

/** checkpoint(TRUNCATE) → close；busy 不阻断关闭（返回 checkpoint 结果供诊断）。 */
function close() {
  if (!db) {
    state = { status: "closed", reason: state.reason, detail: state.detail };
    return { closed: true, checkpoint: null };
  }
  let checkpoint = null;
  try {
    checkpoint = db.pragma("wal_checkpoint(TRUNCATE)", { simple: true });
  } catch {
    checkpoint = "error";
  }
  try {
    db.close();
  } finally {
    db = null;
    openPromise = null;
    state = { status: "closed", reason: state.reason, detail: state.detail };
  }
  return { closed: true, checkpoint };
}

function resetForTest() {
  if (db) { try { db.close(); } catch { /* 已关闭 */ } }
  db = null;
  dbFile = null;
  openPromise = null;
  DATA_DIR = null;
  state = { status: "uninitialized", reason: null, detail: null };
}

module.exports = {
  BDI_SCHEMA_VERSION,
  BDI_MIGRATIONS,
  BASELINE_SQL,
  configure,
  open,
  close,
  getDb,
  getFile,
  getStatus,
  getMeta,
  setMeta,
  snapshotTo,
  readUserVersion,
  probeUserVersion,
  runMigrations,
  resetForTest,
};
