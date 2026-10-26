// 数据层流程的环境脚手架：隔离 userData + 「外部审计读库」（sql.js 只读打开落盘文件）。
// 为什么用 sql.js 另开一份只读句柄：electron/db.js 是内存库 + 全量回写（§7.1.8），
// 业务 API 只暴露它想暴露的东西；跨模块不变量（零写库、软删除留痕、列齐全、回填正确）
// 必须看**表级原始行**才证得明。persist() 之后读盘，顺带证明「落库即落盘」属实。
// @runtime: shared
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, freshDir, tmpUserDataDir } = require("./harness.cjs");

let initSqlJs = null;
let sqlJsError = null;
try {
  // 与 electron/db.js:205 同一入口，避免绝对路径 require 在某些运行时下解析失败
  initSqlJs = require("sql.js");
  if (initSqlJs && initSqlJs.default) initSqlJs = initSqlJs.default;
} catch (e) {
  initSqlJs = null;
  sqlJsError = String(e && e.message ? e.message : e);
}

/** 在 electron 主进程里以隔离 userData 起一个全新库 */
async function bootFlowDb(label, { keep = false } = {}) {
  const { app } = require("electron");
  const dir = keep ? freshDir(tmpUserDataDir(label)) : freshDir(tmpUserDataDir(label));
  app.setPath("userData", dir);
  const dbPath = path.join(ROOT, "electron", "db.js");
  delete require.cache[dbPath];
  const db = require(dbPath);
  await db.initDb();
  return { db, dir, dbFile: path.join(dir, "library.db") };
}

/** 重新 require 一份 db.js（清缓存），用于「同一目录重启第二次 initDb」的迁移/幂等演练 */
async function reopenFlowDb(dir) {
  const dbPath = path.join(ROOT, "electron", "db.js");
  delete require.cache[dbPath];
  const db = require(dbPath);
  await db.initDb();
  return db;
}

function settingsFileOf(dir) {
  return path.join(dir, "settings.json");
}
function memoryDirOf(dir) {
  return path.join(dir, "memory");
}

/**
 * 只读打开落盘的 library.db。
 * @returns {Promise<{tables:string[], count:(t:string)=>number, all:(t:string)=>any[], one:(sql:string,p?:any[])=>any, rows:(sql:string,p?:any[])=>any[], exec:(sql:string,p?:any[])=>void, save:()=>void, close:()=>void}>}
 */
async function audit(dbFile) {
  if (!initSqlJs) throw new Error("sql.js 不可用，无法做表级审计：" + sqlJsError);
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
  });
  const raw = new SQL.Database(fs.readFileSync(dbFile));
  const api = {
    tables: () =>
      api
        .rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map((r) => r.name),
    columns: (t) => api.rows(`PRAGMA table_info(${t})`).map((r) => r.name),
    count: (t) => Number(api.rows(`SELECT COUNT(*) AS n FROM "${t}"`)[0]?.n || 0),
    all: (t) => api.rows(`SELECT * FROM "${t}"`),
    rows: (sql, params = []) => {
      const st = raw.prepare(sql);
      if (params.length) st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      st.free();
      return out;
    },
    one: (sql, params = []) => api.rows(sql, params)[0] || null,
    exec: (sql, params = []) => {
      raw.run(sql, params);
    },
    save: () => fs.writeFileSync(dbFile, Buffer.from(raw.export())),
    close: () => raw.close(),
  };
  return api;
}

/** 表级快照：table → { 主键(或整行 JSON) → 规范化行 } */
function snapshotAll(aud, tables) {
  const snap = {};
  for (const t of tables) {
    const rows = aud.all(t);
    const map = new Map();
    for (const r of rows) map.set(rowKey(r), canonical(r));
    snap[t] = map;
  }
  return snap;
}
function rowKey(r) {
  if (r.id !== undefined) return String(r.id);
  if (r.rowid !== undefined) return String(r.rowid);
  return canonical(r).slice(0, 120);
}
function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => `${k}:${canonical(v[k])}`).join(",") + "}";
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  return JSON.stringify(v);
}

/** 快照差异：只报变化，供「零写库」「撤销复原」类不变量使用 */
function diffSnapshots(before, after) {
  const report = {};
  const tables = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const t of tables) {
    const b = before[t] || new Map();
    const a = after[t] || new Map();
    const added = [...a.keys()].filter((k) => !b.has(k));
    const removed = [...b.keys()].filter((k) => !a.has(k));
    const changed = [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k));
    if (added.length || removed.length || changed.length) {
      report[t] = { added, removed, changed };
    }
  }
  return report;
}

function summaryOf(diff) {
  return Object.entries(diff)
    .map(([t, d]) => `${t}(+${d.added.length}/-${d.removed.length}/~${d.changed.length})`)
    .join(" ");
}

// D239：原先 app.quit() + 120ms 后 process.exit(code)——app.quit() 先走完退出流程、Electron 以 0 退出，
// 定时器根本来不及执行，于是所有流程无论成败退出码都是 0。改为 app.exit(code)：立即以给定码退出
// （不发 before-quit / will-quit——流程到这里已结束，库由各流程自行关闭，无需退出钩子）。
function quit(code) {
  const { app } = require("electron");
  app.exit(Number.isInteger(code) ? code : code ? 1 : 0);
}

module.exports = {
  bootFlowDb,
  reopenFlowDb,
  audit,
  snapshotAll,
  diffSnapshots,
  summaryOf,
  canonical,
  settingsFileOf,
  memoryDirOf,
  quit,
  hasSqlJs: () => !!initSqlJs,
};
