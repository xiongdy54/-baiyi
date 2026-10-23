// C-10（审计）：数据库 schema 版本化 + 事务化迁移 + 迁移前快照。
// 版本号存 SQLite 内建 `PRAGMA user_version`；基线版本 1 = db.js initDb 现有全部 CREATE/ALTER/回填
// 执行完后的结构（该基线代码块已冻结，禁止再加 ALTER/CREATE）。之后每次结构变化写成 MIGRATIONS
// 的一项（版本 2、3…），每项在一个事务内执行并在同一事务内写 user_version。
"use strict";
const fs = require("fs");
const path = require("path");
const SCHEMA_VERSION = 3; // 每新增一个 MIGRATIONS 项就 +1，并与最后一项的 version 相等

// C-18a（审计）：due 表达式——只在「JSON 合法且 $.due 是数值」时取出，其余一律为 NULL
// （NULL = 交给 JS 精确判定，见 db.js 的 TODAY_QUEUE_DUE_SQL 快速路径）。
// 建索引与查询必须引用**同一个常量字符串**，SQLite 才能把查询表达式匹配到索引。
const DUE_EXPR = "(CASE WHEN json_valid(fsrs_json) AND json_type(fsrs_json, '$.due') IN ('integer','real') THEN json_extract(fsrs_json, '$.due') END)";

/** 未来的迁移写在这里：{ version: 4, name: "…", up(db) { db.exec("…") } }。禁止修改已发布的项。 */
const MIGRATIONS = [
  {
    version: 2,
    name: "app_meta",
    up(db) {
      db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    }
  },
  {
    // C-18a：复习队列到期筛选下推到 SQL 的表达式索引（cards.fsrs_json 的 $.due）。
    // 不要改成生成列——生成列会改变 SELECT c.* 的结果形状，影响 mapCardRow 与备份比对。
    version: 3,
    name: "idx_cards_due",
    up(db) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(is_deleted, ${DUE_EXPR})`);
    }
  }
];

class DbTooNewError extends Error {
  constructor(found) {
    super(`数据库版本 ${found} 高于本程序支持的 ${SCHEMA_VERSION}，请安装更新版本的 Nutation`);
    this.code = "DB_TOO_NEW";
    this.found = found;
  }
}

function readUserVersion(db) {
  return Number(db.pragma("user_version", { simple: true })) || 0;
}

function assertNotTooNew(db) {
  const v = readUserVersion(db);
  if (v > SCHEMA_VERSION) throw new DbTooNewError(v);
  return v;
}

async function snapshotBeforeMigration(db, userData, from, to) {
  const dir = path.join(userData, "backups", "pre-migration");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `library-v${from}-to-v${to}-${stamp}.db`);
  await db.backup(file);
  const olds = fs.readdirSync(dir).filter((f) => /^library-v\d+-to-v\d+-.*\.db$/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const o of olds.slice(3)) {
    if (path.join(dir, o.f) !== file) fs.rmSync(path.join(dir, o.f), { force: true });
  }
  return file;
}

/** 在基线（版本 1）完成后调用：依次执行 version > 当前 的迁移，每项一个事务。 */
function runMigrations(db) {
  let v = readUserVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version <= v) continue;
    if (m.version !== v + 1) throw new Error(`迁移版本不连续：当前 ${v}，下一项 ${m.version}`);
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
    v = m.version;
  }
  return v;
}

module.exports = { SCHEMA_VERSION, MIGRATIONS, DUE_EXPR, DbTooNewError, readUserVersion, assertNotTooNew, snapshotBeforeMigration, runMigrations };
