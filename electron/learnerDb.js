// v48.80（D124 / 指导文档 §4.20）：学习者模型派生库 learner.db——独立 SQLite 文件，与主库完全隔离。
// v48.92（D137）：引擎自 sql.js 迁 better-sqlite3（原生 SQLite，WAL journal 原生落盘，设计稿
// SQLITE3-MIGRATION-D137 §3.2-1）。理由与 dictionary.db 相同：词项索引可达数十万行，入主库会拖慢
// 每次复习评分的 persist() checkpoint；且这里全部是**派生数据**，删除可由刷新管线完整重建，不进备份。
// 写入纪律（D137 新语义，GUIDE §7.2）：「每次落库即落盘」由 SQLite 事务提交 + synchronous=FULL 的
// WAL fsync 承担；写入后调用 save()＝显式 wal_checkpoint(TRUNCATE)（磁盘单文件 = 完整最新状态），
// 不走主库 persist()。
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const Database = require("better-sqlite3");
const lmParams = require("./lmParams");
const { normParams, attachRun, applyStandardPragmas, rmDbFileAndSidecars } = require("./sqliteCompat");

let db = null;
let dbFile = null;
let openPromise = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS lm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content_units (
  id TEXT PRIMARY KEY,               -- unit id 规则：documentId + '#' + ord
  library_item_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  heading_path_json TEXT NOT NULL DEFAULT '[]',
  md_from INTEGER, md_to INTEGER,     -- markdown 字符偏移 [from, to)；PDF 为 NULL
  page_from INTEGER, page_to INTEGER, -- 仅 PDF，0 起，闭区间
  plain_len INTEGER NOT NULL,
  head_text TEXT NOT NULL DEFAULT '', -- 单元纯文本前 40 字（空白压缩为单空格），用作跳转锚 anchorText
  lang TEXT NOT NULL DEFAULT '',
  is_exercise INTEGER NOT NULL DEFAULT 0,
  seg_version INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cu_item ON content_units(library_item_id, ord);
CREATE TABLE IF NOT EXISTS pdf_page_texts (
  library_item_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (library_item_id, page)
);
CREATE TABLE IF NOT EXISTS unit_progress (
  unit_id TEXT PRIMARY KEY,
  passes_json TEXT NOT NULL DEFAULT '[]', -- 每次通读的时间戳（升序，最多保留 20 个）
  last_pass_at INTEGER
);
CREATE TABLE IF NOT EXISTS pdf_high_water (library_item_id TEXT PRIMARY KEY, page INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS unit_kp_links (
  unit_id TEXT NOT NULL, kp_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- card|extract|lexical
  weight REAL NOT NULL,
  PRIMARY KEY (unit_id, kp_id, source)
);
CREATE INDEX IF NOT EXISTS idx_ukl_kp ON unit_kp_links(kp_id);
CREATE TABLE IF NOT EXISTS kp_states (
  kp_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,             -- 0..4
  score REAL NOT NULL,                -- 0..1，排序用
  confidence TEXT NOT NULL,           -- low|medium|high
  fading INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  first_l3_at INTEGER, first_l4_at INTEGER,
  computed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lexemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lang TEXT NOT NULL, key TEXT NOT NULL,
  sample TEXT NOT NULL,               -- 最常见的原形，用于展示
  total_count INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  is_stop INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lexemes_key ON lexemes(lang, key);
CREATE TABLE IF NOT EXISTS unit_lex (
  unit_id TEXT PRIMARY KEY, lang TEXT NOT NULL,
  lex_json TEXT NOT NULL,             -- [[lexemeId, count], ...] 按 lexemeId 升序
  token_count INTEGER NOT NULL,       -- 参与覆盖率计算的词例数（已排除数字与专名）
  lex_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lexeme_states (
  lexeme_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,                -- unknown|seen|learning|familiar|known
  source TEXT NOT NULL,               -- 判定命中的规则名（设计稿 §6.7）
  exposure_passes INTEGER NOT NULL, exposure_tokens INTEGER NOT NULL,
  lookups INTEGER NOT NULL, last_lookup_at INTEGER,
  computed_at INTEGER NOT NULL
);
`;

// D137（§3.1 映射表）：undefined→null 绑定归一在 sqliteCompat.js 一处兜底（杜绝散点）。

// WAL sidecar 清理改走 sqliteCompat.rmDbFileAndSidecars（含 .tmp 残留）。

function readMetaRaw(key) {
  try {
    const rows = allSync("SELECT value FROM lm_meta WHERE key = ?", [String(key)]);
    return rows.length ? String(rows[0].value) : null;
  } catch {
    return null; // 表还不存在 / 库损坏 → 视为缺失
  }
}

function allSync(sql, params = []) {
  return db.prepare(sql).all(normParams(params));
}

async function open() {
  if (db) return db;
  if (!openPromise) {
    openPromise = (async () => {
      dbFile = path.join(app.getPath("userData"), "learner.db");
      const existed = fs.existsSync(dbFile);
      db = attachRun(new Database(dbFile)); // 文件不存在即创建；崩溃恢复（WAL 回放）由 SQLite 打开时自动完成
      applyStandardPragmas(db);
      // D137 B6 修正：learner.db 是**派生可重建**数据（§4.20，删除后刷新管线全量重建、不进备份），
      // synchronous 降为 NORMAL——WAL 下 commit 不逐次 fsync（词项索引逐行写入曾是 fsync 风暴，
      // 实测把主进程阻塞 39s），持久性由 save() 的 checkpoint(TRUNCATE) 与「可重建」语义共同承担；
      // 主库/词典库仍 synchronous=FULL 不变。
      db.pragma("synchronous = NORMAL");
      // D137 §3.5：启动 quick_check 一次（结果仅入应用日志，不阻塞——损坏早暴露、零行为变更）
      try {
        const qc = db.pragma("quick_check", { simple: true });
        if (qc !== "ok") console.error(`[learnerDb] quick_check 异常：${qc}`);
      } catch (e) {
        console.error("[learnerDb] quick_check 失败：", e);
      }
      // 重建规则（设计稿 §5.2）：schema_version 不等于代码常量 → 关闭、删除文件（含 sidecar）、重新建表（全量重建）
      if (readMetaRaw("schema_version") !== String(lmParams.LEARNER_DB_SCHEMA)) {
        try {
          db.close();
        } catch {
          /* 忽略 */
        }
        db = null;
        rmDbFileAndSidecars(dbFile);
        db = attachRun(new Database(dbFile));
        applyStandardPragmas(db);
        db.pragma("synchronous = NORMAL"); // 同上：派生可重建库（D137 B6 修正）
      }
      db.exec(SCHEMA_SQL);
      // icu_version / lex_version 任一与当前不同 → 清空词项三表让词项索引重建
      // （不同 ICU 版本的 Intl.Segmenter 切词结果不同，例如 Node 22 把「読んだ」切成 読/ん/だ）
      const icu = String(process.versions.icu || "");
      if (readMetaRaw("icu_version") !== icu || readMetaRaw("lex_version") !== String(lmParams.LEX_VERSION)) {
        db.exec("DELETE FROM lexemes; DELETE FROM unit_lex; DELETE FROM lexeme_states;");
        setMetaSync("icu_version", icu);
        setMetaSync("lex_version", String(lmParams.LEX_VERSION));
      }
      setMetaSync("schema_version", String(lmParams.LEARNER_DB_SCHEMA));
      return db;
    })();
    openPromise.catch(() => {
      openPromise = null;
    });
  }
  return openPromise;
}

function setMetaSync(key, value) {
  db.run("INSERT INTO lm_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    String(key),
    String(value)
  ]);
}

// 落盘（D137 重定义）：SQLite 提交语义已保证持久（synchronous=FULL 的 WAL fsync）；
// save() ＝显式 wal_checkpoint(TRUNCATE)，使磁盘单文件 = 完整最新状态（外部读/拷库安全）。
// 失败 throw（与主库 persist 同纪律）；不涉及任何 tmp/rename（旧 tmp+fsync+rename 序列随 sql.js 退役）。
function save() {
  if (!db || !dbFile) return;
  const busy = db.pragma("wal_checkpoint(TRUNCATE)", { simple: true });
  if (Number(busy) !== 0) throw new Error("learner.db checkpoint 忙碌（busy=1）——稍后重试");
}

async function run(sql, params) {
  await open();
  db.run(sql, params || []);
}

/** D143（T3）：整表覆盖写的批量口。单事务内 DELETE + 预编译语句复用 INSERT，每 chunkSize 行
 *  setImmediate 让出主进程——根治「逐行 await run() 只走微任务、整个循环是一个连续宏任务」的
 *  +20s 单段阻塞（lexeme_states 14,252 行实测 0.5~0.9s；同 dictDb.insertRows 先例）。
 *  事务跨让出点保持打开：BEGIN IMMEDIATE / COMMIT / 失败显式 ROLLBACK（better-sqlite3 的
 *  db.transaction(fn) 不容纳 async 回调）。连接级可见性：learner.db 全进程唯一连接，事务在途
 *  期间本模块其它读写同走此连接（部分态可见窗口与改造前逐行 run 的逐条提交语义等价，无新增面）。 */
async function replaceBatch(deleteSql, insertSql, rows, { chunkSize = 1000 } = {}) {
  await open();
  db.run("BEGIN IMMEDIATE");
  let count = 0;
  try {
    if (deleteSql) db.run(deleteSql);
    const stmt = db.prepare(insertSql);
    for (const r of rows) {
      stmt.run(normParams(r));
      count += 1;
      if (count % chunkSize === 0) await new Promise((r2) => setImmediate(r2));
    }
    db.run("COMMIT");
  } catch (err) {
    try { db.run("ROLLBACK"); } catch { /* 忽略 */ }
    throw err;
  }
  return count;
}

async function all(sql, params) {
  await open();
  return allSync(sql, params || []);
}

async function getMeta(key) {
  await open();
  return readMetaRaw(key);
}

async function setMeta(key, value) {
  await open();
  setMetaSync(key, value);
}

/** 关闭并删除文件（「重建学习索引」按钮与测试用；下次刷新会完整重建） */
async function reset() {
  if (openPromise) {
    try {
      await openPromise;
    } catch {
      /* 忽略 */
    }
    openPromise = null;
  }
  if (db) {
    try {
      db.close();
    } catch {
      /* 忽略 */
    }
    db = null;
  }
  if (dbFile) {
    rmDbFileAndSidecars(dbFile);
  }
}

// D137：应用退出兜底 = checkpoint 后关闭（clean shutdown = WAL 自动合并 + 删 sidecar）；
// 正常路径刷新结束时已 save()。
async function saveOnQuit() {
  try {
    if (db) save();
  } catch {
    /* 退出期尽力而为 */
  }
}

// D137（v48.92）：显式关闭（main.js will-quit 调用）；连带清理 openPromise 以便测试内重开
function close() {
  if (openPromise) openPromise = null;
  if (db) {
    try {
      db.close(); // clean close：WAL 自动 checkpoint + 删 -wal/-shm
    } catch {
      /* 退出期尽力而为 */
    }
    db = null;
  }
}

// D137（§3.6）：在线快照到目标路径（db.backup 页拷贝，不阻塞写路径）——预留同法接口，
// learner.db 目前不进备份清单（派生数据，可整库重建）。
async function snapshotTo(destPath) {
  await open();
  await db.backup(destPath);
  return destPath;
}

module.exports = { open, save, run, replaceBatch, all, getMeta, setMeta, reset, saveOnQuit, close, snapshotTo };
