// D137（v48.92）：better-sqlite3 兼容原语层（设计稿 SQLITE3-MIGRATION-D137 §3.1 映射表的实施落点）。
// 两件事：
// ① `Database#run` 补齐——better-sqlite3 v12 移除了 `db.run`（实施时实测 v12.11.1 原型仅有
//    prepare/exec/pragma/…；设计稿映射表「db.run(sql, params) 同签名」基于 v11 形态）。
//    以本层在实例上补一个 run，三库既有调用点（db.js 225 处、learnerRefresh、legacyBackfill 注入面）
//    零改动。路由：无参调用 → `db.exec`（BEGIN/COMMIT/ROLLBACK/VACUUM/多语句 SCHEMA 走这里，
//    prepare 遇多语句会抛「more than one statement」）；带参调用 → `db.prepare(sql).run(params)`。
// ② undefined 绑定归一（设计稿 §3.1：sql.js 容忍 undefined，better-sqlite3 按名义语义抛
//    Invalid value；实测 v12.11.1 对数组内 undefined 静默放行，仍按设计稿显式归一为 null，杜绝散点）。
// 失败语义与 sql.js 时代一致：任何抛错向上传播（persist/checkpoint 失败 → IPC reject → persistNow 重试）。
const fs = require("fs");

function normParams(params) {
  if (params == null) return params;
  if (Array.isArray(params)) return params.map((v) => (v === undefined ? null : v));
  if (typeof params === "object") {
    const out = { ...params };
    for (const k of Object.keys(out)) if (out[k] === undefined) out[k] = null;
    return out;
  }
  return params;
}

function attachRun(db) {
  db.run = (sql, params) => {
    if (params === undefined || params === null) return db.exec(sql);
    const p = normParams(params);
    const stmt = db.prepare(sql);
    if (Array.isArray(p)) return p.length ? stmt.run(p) : stmt.run();
    return stmt.run(p);
  };
  return db;
}

// 三库统一打开 pragma（设计稿 §3.7）：WAL（标志持久在库头，重复设置幂等）+ synchronous=FULL
// （每次提交 fsync WAL；PRAGMA synchronous 实测返回 2＝FULL）+ busy_timeout 兜底外部工具短暂持锁。
function applyStandardPragmas(db) {
  db.pragma("journal_mode = wal");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 3000");
  return db;
}

// WAL sidecar 清理（设计稿 §3.4 写-ahead 语义登记③）：手工删库/换库必须同删 -wal/-shm
//（陈旧 WAL 配错配文件 = 损坏）。suffix 清单含 .tmp（sql.js 时代残留，启动清理语义保留）。
function rmDbFileAndSidecars(file) {
  for (const suffix of ["", "-wal", "-shm", ".tmp"]) {
    try { fs.rmSync(file + suffix, { force: true }); } catch { /* 尽力而为 */ }
  }
}

module.exports = { normParams, attachRun, applyStandardPragmas, rmDbFileAndSidecars };
