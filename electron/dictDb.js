// M7 词典词条库（v32）——独立 SQLite 文件 dictionary.db，与主库 library.db 完全隔离。
// v48.92（D137）：引擎自 sql.js 迁 better-sqlite3（WAL journal 原生落盘，设计稿 SQLITE3-MIGRATION-D137
// §3.2-2）。历史理由保留：ECDICT 完整版可达数十万~百万词条，若入主库会让每次卡片写入触发的
// persist() checkpoint 摊上数百 MB 库的合并成本；词条库只在导入/删除时落盘。
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const Database = require("better-sqlite3");
const { attachRun, applyStandardPragmas, rmDbFileAndSidecars } = require("./sqliteCompat");

let db = null;
let dbFile = null;
let openPromise = null;

async function open() {
  if (db) return db;
  if (!openPromise) {
    openPromise = (async () => {
      dbFile = path.join(app.getPath("userData"), "dictionary.db");
      try {
        rmDbFileAndSidecars(dbFile + ".tmp");
      } catch { /* 忽略 */ }
      db = attachRun(new Database(dbFile)); // 文件不存在即创建；崩溃恢复（WAL 回放）由 SQLite 打开时自动完成
      applyStandardPragmas(db);
      // D137 §3.5：启动 quick_check 一次（结果仅入应用日志，不阻塞）
      try {
        const qc = db.pragma("quick_check", { simple: true });
        if (qc !== "ok") console.error(`[dictDb] quick_check 异常：${qc}`);
      } catch (e) {
        console.error("[dictDb] quick_check 失败：", e);
      }
      db.exec(`CREATE TABLE IF NOT EXISTS dict_entries (
        source_id TEXT NOT NULL, headword TEXT NOT NULL, headword_norm TEXT NOT NULL,
        phonetic TEXT, pos TEXT, html TEXT,
        PRIMARY KEY (source_id, headword_norm)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_dict_entries_norm ON dict_entries(headword_norm)");
      return db;
    })();
    openPromise.catch(() => {
      openPromise = null;
    });
  }
  return openPromise;
}

// 落盘（D137 重定义，与主库 persist 同语义）：SQLite 提交语义（synchronous=FULL 的 WAL fsync）
// 已保证持久；save() ＝显式 wal_checkpoint(TRUNCATE)，磁盘单文件 = 完整最新状态。失败 throw。
function save() {
  if (!db || !dbFile) return;
  const busy = db.pragma("wal_checkpoint(TRUNCATE)", { simple: true });
  if (Number(busy) !== 0) throw new Error("dictionary.db checkpoint 忙碌（busy=1）——稍后重试");
}

/** 批量写入词条（接受数组或 async generator；单个大事务 + 语句复用；每 5000 行让出主进程并回调进度）。
 *  cap 是防失控保险（非目标裁剪量）：ECDICT 全量 340 万行（2026-09-14 实测）且 sqlite 行序非字母序——
 *  曾 cap 120 万把 moral 截在库外（用户实测查不到），cap 必须高于已知全量。
 *  D137：事务保持「10 万行级单事务一次提交」（大事务只需一次 fsync，§3.7）——事务须跨 await 让出点，
 *  better-sqlite3 的 db.transaction(fn) 不容纳 async 回调，故沿用显式 BEGIN IMMEDIATE/COMMIT/ROLLBACK
 *  （§3.3 加固①②同款）；预编译语句对象天然可复用（无 bind/step/reset/free 循环）。 */
async function insertRows(sourceId, rows, cap = 3500000, onProgress = null) {
  await open();
  db.run("BEGIN IMMEDIATE");
  let count = 0;
  let capped = false;
  const yieldNow = () => new Promise((r) => setImmediate(r));
  try {
    // 语句对象循环复用（§3.1：无 bind/step/reset/free；better-sqlite3 语句天然可复用）
    const stmt = db.prepare("INSERT OR IGNORE INTO dict_entries (source_id, headword, headword_norm, phonetic, pos, html) VALUES (?,?,?,?,?,?)");
    // for await：同时兼容数组与 async generator（iterEcdictSqlite 流式产出，免整体物化）
    for await (const r of rows) {
      if (!r || !r.headword) continue;
      if (count >= cap) { capped = true; break; }
      stmt.run([
        String(sourceId),
        String(r.headword),
        String(r.headword).normalize("NFKC").toLowerCase(),
        String(r.phonetic || "").slice(0, 120),
        String(r.pos || "").slice(0, 80),
        String(r.html || "").slice(0, 800),
      ]);
      count++;
      // 大词典（数十万行）同步循环会堵死主进程（窗口无响应）——定期让出 + 上报进度
      if (count % 5000 === 0) {
        if (onProgress) { try { onProgress(count); } catch { /* 忽略 */ } }
        await yieldNow();
      }
    }
    db.run("COMMIT");
  } catch (err) {
    try { db.run("ROLLBACK"); } catch { /* 忽略 */ }
    throw err;
  }
  if (onProgress) { try { onProgress(count); } catch { /* 忽略 */ } }
  save();
  return { count, capped };
}

/** 精确查询（norm 小写归一）；启用过滤由调用方按 dict_sources 完成 */
async function lookup(word) {
  await open();
  const norm = String(word || "").normalize("NFKC").toLowerCase();
  return db.prepare("SELECT source_id, headword, phonetic, pos, html FROM dict_entries WHERE headword_norm = ? LIMIT 20").all([norm]);
}

async function removeSource(sourceId) {
  await open();
  db.run("DELETE FROM dict_entries WHERE source_id = ?", [String(sourceId)]);
  // DELETE 只留空闲页（实测 340 万词条删除后文件仍 950MB）——VACUUM 让落盘文件真正收缩
  //（better-sqlite3 的 .exec 不收参数；VACUUM 必须在事务外执行）
  try { db.exec("VACUUM"); } catch { /* 尽力而为：失败退化为仅逻辑删除 */ }
  save();
  return true;
}

async function countBySource(sourceId) {
  await open();
  // D137 §3.1 映射表：sql.js 带参 exec → prepare().get()
  const r = db.prepare("SELECT COUNT(*) AS n FROM dict_entries WHERE source_id = ?").get([String(sourceId)]);
  return Number(r?.n ?? 0);
}

// 应用退出时兜底落盘（正常路径导入后已 save；main.js will-quit 另有 close）
async function saveOnQuit() {
  try {
    if (db) save();
  } catch { /* 退出期尽力而为 */ }
}

// D137（v48.92）：显式关闭（main.js will-quit 调用）；clean close = WAL 自动 checkpoint + 删 sidecar
function close() {
  if (openPromise) openPromise = null;
  if (db) {
    try {
      db.close();
    } catch { /* 退出期尽力而为 */ }
    db = null;
  }
}

// D137（§3.6）：在线快照到目标路径（db.backup 页拷贝，不阻塞写路径；M2 备份 dictionary.db 改走此口）
async function snapshotTo(destPath) {
  await open();
  await db.backup(destPath);
  return destPath;
}

module.exports = { open, insertRows, lookup, removeSource, countBySource, saveOnQuit, close, snapshotTo };
