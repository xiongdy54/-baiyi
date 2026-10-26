// C-10（审计）：数据库 schema 版本化 + 事务化迁移 + 迁移前快照。
// 版本号存 SQLite 内建 `PRAGMA user_version`；基线版本 1 = db.js initDb 现有全部 CREATE/ALTER/回填
// 执行完后的结构（该基线代码块已冻结，禁止再加 ALTER/CREATE）。之后每次结构变化写成 MIGRATIONS
// 的一项（版本 2、3…），每项在一个事务内执行并在同一事务内写 user_version。
"use strict";
const fs = require("fs");
const path = require("path");
const SCHEMA_VERSION = 5; // 每新增一个 MIGRATIONS 项就 +1，并与最后一项的 version 相等

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
  },
  {
    // C-38b（审计）：云同步预留——给缺字段的可变表补 sync_version + is_deleted，建删除墓碑表。
    // 新增的 is_deleted 列目前没有任何代码会置 1（不需要给这三张表的查询补过滤条件）；
    // sync_version 的递增由 electron/syncTriggers.js 的启动期触发器承担（每次启动幂等重建）。
    version: 4,
    name: "sync_prep",
    up(db) {
      const add = (t, c, type) => {
        const cols = db.prepare("SELECT name FROM pragma_table_info(?)").all(t).map((r) => r.name);
        if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
      };
      for (const t of ["card_issues", "ai_gen_batches", "material_map_edges"]) {
        add(t, "sync_version", "INTEGER NOT NULL DEFAULT 0");
        add(t, "is_deleted", "INTEGER NOT NULL DEFAULT 0");
      }
      db.exec(`CREATE TABLE IF NOT EXISTS sync_tombstones (
          tbl TEXT NOT NULL, row_id TEXT NOT NULL, deleted_at INTEGER NOT NULL,
          PRIMARY KEY (tbl, row_id)) WITHOUT ROWID`);
    }
  },
  {
    // v49.62 / D233（用户 2026-10-26 指令）：摘录与书的优先级方向统一为「数字越大越优先、越先推送」。
    // 存量值一律 p → 100 − p（不截断不取整，保序）：改前改后推送顺序逐条相同（旧 10＝很优先 ⇒ 新 90），
    // 默认 50 不变。覆盖面＝会把优先级读回来的全部落点——
    //  · extracts.priority（公共投影列）与 extracts.engine_state_json 各引擎子空间的 priority
    //    （漏翻子空间 ⇒ 切换推送引擎时会把旧方向的值投影回公共列）；
    //  · library_items.priority（书级默认；继承型摘录与之相等，同翻后仍相等）；
    //  · extract_ops.before_json / after_json 的 priority、schedule.priority 与嵌套 engineStateJson
    //    （漏翻 ⇒ 撤销一次改版前的操作会写回旧方向的值）。
    // 不动：cards.priority（闪卡优先级 D216 已退役，制卡提示词口径本就越大越重要）、
    // learner_tracks.priority（1..5，本就越大权重越高）。
    version: 5,
    name: "priority_direction_flip",
    up(db) {
      const flipNum = (v) => (typeof v === "number" && Number.isFinite(v) ? 100 - v : v);
      const flipEngineState = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
        for (const k of Object.keys(obj)) {
          const sub = obj[k];
          if (sub && typeof sub === "object" && !Array.isArray(sub) && "priority" in sub) sub.priority = flipNum(sub.priority);
        }
        return obj;
      };
      const flipEngineStateText = (text) => {
        if (typeof text !== "string" || text === "") return text;
        try {
          return JSON.stringify(flipEngineState(JSON.parse(text)));
        } catch {
          return text; // 坏 JSON 原样保留（读取侧 parseEngineState 本就按空子空间处理）
        }
      };
      const flipOpText = (text) => {
        let o;
        try {
          o = JSON.parse(text);
        } catch {
          return text;
        }
        if (!o || typeof o !== "object" || Array.isArray(o)) return text;
        if ("priority" in o) o.priority = flipNum(o.priority);
        if (o.schedule && typeof o.schedule === "object" && "priority" in o.schedule) o.schedule.priority = flipNum(o.schedule.priority);
        if (typeof o.engineStateJson === "string") o.engineStateJson = flipEngineStateText(o.engineStateJson);
        return JSON.stringify(o);
      };
      db.exec("UPDATE extracts SET priority = 100 - priority WHERE typeof(priority) IN ('integer','real')");
      db.exec("UPDATE library_items SET priority = 100 - priority WHERE typeof(priority) IN ('integer','real')");
      const states = db.prepare("SELECT id, engine_state_json AS s FROM extracts WHERE engine_state_json IS NOT NULL AND engine_state_json <> ''").all();
      const updState = db.prepare("UPDATE extracts SET engine_state_json = ? WHERE id = ?");
      for (const r of states) {
        const next = flipEngineStateText(r.s);
        if (next !== r.s) updState.run(next, r.id);
      }
      const ops = db.prepare("SELECT id, before_json AS b, after_json AS a FROM extract_ops").all();
      const updOp = db.prepare("UPDATE extract_ops SET before_json = ?, after_json = ? WHERE id = ?");
      for (const r of ops) {
        const b = flipOpText(r.b);
        const a = flipOpText(r.a);
        if (b !== r.b || a !== r.a) updOp.run(b, a, r.id);
      }
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
