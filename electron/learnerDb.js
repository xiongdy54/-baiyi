// v48.80（D124 / 指导文档 §4.20）：学习者模型派生库 learner.db——独立 SQLite 文件（sql.js），与主库完全隔离。
// 理由与 dictionary.db 相同（§7.1.8 sql.js 全量回写约束）：词项索引可达数十万行，入主库会拖慢
// 每次复习评分的 persist() 落盘；且这里全部是**派生数据**，删除可由刷新管线完整重建，不进备份。
// 写入纪律：learner.db 写入后调用 save()（tmp + fsync + rename 原子写），不走主库 persist()
// （指导文档 §7.2 已登记例外）。
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const lmParams = require("./lmParams");

let db = null;
let dbFile = null;
let openPromise = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS lm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content_units (
  id TEXT PRIMARY KEY,               -- ${documentId}#${ord}
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

function readMetaRaw(key) {
  try {
    const rows = allSync("SELECT value FROM lm_meta WHERE key = ?", [String(key)]);
    return rows.length ? String(rows[0].value) : null;
  } catch {
    return null; // 表还不存在 / 库损坏 → 视为缺失
  }
}

function allSync(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function open() {
  if (db) return db;
  if (!openPromise) {
    openPromise = (async () => {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();
      dbFile = path.join(app.getPath("userData"), "learner.db");
      try {
        fs.rmSync(dbFile + ".tmp", { force: true });
      } catch {
        /* 忽略 */
      }
      const existed = fs.existsSync(dbFile);
      db = existed ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
      // 重建规则（设计稿 §5.2）：schema_version 不等于代码常量 → 关闭、删除文件、重新建表（全量重建）
      if (readMetaRaw("schema_version") !== String(lmParams.LEARNER_DB_SCHEMA)) {
        try {
          db.close();
        } catch {
          /* 忽略 */
        }
        try {
          fs.rmSync(dbFile, { force: true });
        } catch {
          /* 忽略 */
        }
        db = new SQL.Database();
      }
      db.run(SCHEMA_SQL);
      // icu_version / lex_version 任一与当前不同 → 清空词项三表让词项索引重建
      // （不同 ICU 版本的 Intl.Segmenter 切词结果不同，例如 Node 22 把「読んだ」切成 読/ん/だ）
      const icu = String(process.versions.icu || "");
      if (readMetaRaw("icu_version") !== icu || readMetaRaw("lex_version") !== String(lmParams.LEX_VERSION)) {
        db.run("DELETE FROM lexemes; DELETE FROM unit_lex; DELETE FROM lexeme_states;");
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

// 原子落盘（与主库 persist / dictDb.save 同纪律：tmp + fsync + rename）
function save() {
  if (!db || !dbFile) return;
  const tmp = dbFile + ".tmp";
  const buf = Buffer.from(db.export());
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dbFile);
}

async function run(sql, params) {
  await open();
  db.run(sql, params || []);
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
    try {
      fs.rmSync(dbFile, { force: true });
    } catch {
      /* 忽略 */
    }
  }
}

// 应用退出时兜底落盘（正常路径刷新结束时已 save）
async function saveOnQuit() {
  try {
    if (db) save();
  } catch {
    /* 退出期尽力而为 */
  }
}

module.exports = { open, save, run, all, getMeta, setMeta, reset, saveOnQuit };
