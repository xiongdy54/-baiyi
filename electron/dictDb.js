// M7 词典词条库（v32）——独立 SQLite 文件 dictionary.db（sql.js），与主库 library.db 完全隔离。
// 理由：ECDICT 完整版可达数十万~百万词条，若入主库会让「每次卡片写入触发的 persist() 全量导出」
// 变成数百 MB 级，拖垮复习/制卡写路径（§7.1.8 的 sql.js 全量回写架构约束）。词条库只在导入/删除时落盘。
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

let db = null;
let dbFile = null;
let openPromise = null;

async function open() {
  if (db) return db;
  if (!openPromise) {
    openPromise = (async () => {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();
      dbFile = path.join(app.getPath("userData"), "dictionary.db");
      try {
        fs.rmSync(dbFile + ".tmp", { force: true });
      } catch { /* 忽略 */ }
      db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
      db.run(`CREATE TABLE IF NOT EXISTS dict_entries (
        source_id TEXT NOT NULL, headword TEXT NOT NULL, headword_norm TEXT NOT NULL,
        phonetic TEXT, pos TEXT, html TEXT,
        PRIMARY KEY (source_id, headword_norm)
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_dict_entries_norm ON dict_entries(headword_norm)");
      return db;
    })();
  }
  return openPromise;
}

// 原子落盘（与主库 persist 同纪律：tmp + fsync + rename）
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

/** 批量写入词条（接受数组或 async generator；事务 + 预编译语句；每 5000 行让出主进程并回调进度）。
 *  cap 是防失控保险（非目标裁剪量）：ECDICT 全量 340 万行（2026-09-14 实测）且 sqlite 行序非字母序——
 *  曾 cap 120 万把 moral 截在库外（用户实测查不到），cap 必须高于已知全量。 */
async function insertRows(sourceId, rows, cap = 3500000, onProgress = null) {
  await open();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO dict_entries (source_id, headword, headword_norm, phonetic, pos, html) VALUES (?,?,?,?,?,?)"
  );
  db.run("BEGIN");
  let count = 0;
  let capped = false;
  const yieldNow = () => new Promise((r) => setImmediate(r));
  try {
    // for await：同时兼容数组与 async generator（iterEcdictSqlite 流式产出，免整体物化）
    for await (const r of rows) {
      if (!r || !r.headword) continue;
      if (count >= cap) { capped = true; break; }
      stmt.bind([
        String(sourceId),
        String(r.headword),
        String(r.headword).normalize("NFKC").toLowerCase(),
        String(r.phonetic || "").slice(0, 120),
        String(r.pos || "").slice(0, 80),
        String(r.html || "").slice(0, 800),
      ]);
      stmt.step();
      stmt.reset();
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
    stmt.free();
    throw err;
  }
  stmt.free();
  if (onProgress) { try { onProgress(count); } catch { /* 忽略 */ } }
  save();
  return { count, capped };
}

/** 精确查询（norm 小写归一）；启用过滤由调用方按 dict_sources 完成 */
async function lookup(word) {
  await open();
  const norm = String(word || "").normalize("NFKC").toLowerCase();
  const stmt = db.prepare("SELECT source_id, headword, phonetic, pos, html FROM dict_entries WHERE headword_norm = ? LIMIT 20");
  stmt.bind([norm]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function removeSource(sourceId) {
  await open();
  db.run("DELETE FROM dict_entries WHERE source_id = ?", [String(sourceId)]);
  // DELETE 只留空闲页（实测 340 万词条删除后文件仍 950MB）——VACUUM 让落盘文件真正收缩
  try { db.run("VACUUM"); } catch { /* 老版本 sql.js 不支持时退化为仅逻辑删除 */ }
  save();
  return true;
}

async function countBySource(sourceId) {
  await open();
  const r = db.exec("SELECT COUNT(*) FROM dict_entries WHERE source_id = ?", [String(sourceId)]);
  return Number(r[0]?.values?.[0]?.[0] ?? 0);
}

// 应用退出时兜底落盘（正常路径导入后已 save）
async function saveOnQuit() {
  try {
    if (db) save();
  } catch { /* 退出期尽力而为 */ }
}

module.exports = { open, insertRows, lookup, removeSource, countBySource, saveOnQuit };
