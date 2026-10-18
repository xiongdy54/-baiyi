// 沙箱用：以 Node 内置 node:sqlite 冒充 better-sqlite3，并给 electron 一个最小 app 桩，
// 使真实 electron/db.js 能在纯 node（Linux VM，无 win32 原生模块）里跑。只覆盖 db.js 用到的 API 子集：
//   new Database(file) / prepare(sql).run|get|all|iterate / exec / pragma(str, {simple}) / close / open / backup(简化)
// 用法：require("./lib/nodeSqliteShim.cjs").install({ userData })；之后 require("../electron/db.js")。
// 只供测试；生产仍是 better-sqlite3。语义差异：node:sqlite 不支持把数组当单参展开——这里统一展开。
"use strict";
const Module = require("module");
const fs = require("fs");
const path = require("path");

function install({ userData }) {
  // 抑制 node:sqlite 的 ExperimentalWarning 噪音
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...a));
  const { DatabaseSync } = require("node:sqlite");

  const bind = (args) => {
    if (args.length === 1 && Array.isArray(args[0])) return args[0].map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
    if (args.length === 1 && args[0] && typeof args[0] === "object" && !(args[0] instanceof Uint8Array)) {
      const o = {};
      for (const [k, v] of Object.entries(args[0])) o[k] = v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
      return [o];
    }
    return args.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  };

  class Statement {
    constructor(st) { this.st = st; try { st.setAllowBareNamedParameters?.(true); } catch { /* 旧版 */ } }
    run(...a) { const r = this.st.run(...bind(a)); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; }
    get(...a) { return this.st.get(...bind(a)); }
    all(...a) { return this.st.all(...bind(a)); }
    *iterate(...a) { for (const r of this.st.all(...bind(a))) yield r; }
  }
  class Database {
    constructor(file) {
      this.name = file;
      this.d = new DatabaseSync(file);
      this.open = true;
    }
    prepare(sql) { return new Statement(this.d.prepare(sql)); }
    exec(sql) { this.d.exec(sql); return this; }
    pragma(src, opts) {
      const rows = this.d.prepare("PRAGMA " + src).all();
      if (opts && opts.simple) { const r = rows[0]; return r ? r[Object.keys(r)[0]] : undefined; }
      return rows;
    }
    transaction(fn) { return (...a) => { this.d.exec("BEGIN"); try { const r = fn(...a); this.d.exec("COMMIT"); return r; } catch (e) { this.d.exec("ROLLBACK"); throw e; } }; }
    close() { if (this.open) { this.d.close(); this.open = false; } }
    async backup(dest) { this.d.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`); }
  }

  fs.mkdirSync(userData, { recursive: true });
  const paths = { userData, appData: userData, temp: path.join(userData, "tmp"), logs: path.join(userData, "logs"), documents: userData, home: userData };
  const app = {
    getPath: (k) => paths[k] || userData,
    setPath: (k, v) => { paths[k] = v; },
    isPackaged: false,
    getVersion: () => "0.0.0-test",
    getName: () => "incremental-reading-dev",
    whenReady: () => Promise.resolve(),
    on: () => {},
  };
  const electronStub = { app, ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] }, shell: {}, dialog: {}, nativeTheme: {} };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "better-sqlite3") return Database;
    if (request === "electron") return electronStub;
    return origLoad.call(this, request, parent, isMain);
  };
  return { Database, app };
}

module.exports = { install };
