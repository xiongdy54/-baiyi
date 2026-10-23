"use strict";
// C-11：pinUserData 的目录解析纯函数（electron/userData.js）三条路径 + Windows 真实占用差分。
// @runtime: electron-node
// 直跑：node scripts/run-tests.mjs userData（runner 按 @runtime 分流到 electron-node）
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveUserData } = require("../electron/userData");

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "nutation-userdata-"));
const cleanup = (d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 系统临时目录兜底 */ } };

// 1) 开发版新装机：无旧目录 → 目标 Nutation-dev，未迁移
{
  const appData = mk();
  const r = resolveUserData({ appData, isPackaged: false });
  assert.strictEqual(r.dir, path.join(appData, "Nutation-dev"));
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.error, undefined);
  cleanup(appData);
}

// 2) 打包版新装机 → 目标 Nutation
{
  const appData = mk();
  const r = resolveUserData({ appData, isPackaged: true });
  assert.strictEqual(r.dir, path.join(appData, "Nutation"));
  assert.strictEqual(r.migrated, false);
  cleanup(appData);
}

// 3) 旧目录存在、目标不存在 → 整目录改名迁移，内容随目录走
{
  const appData = mk();
  const legacy = path.join(appData, "incremental-reading-dev");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "legacy-marker.txt"), "c11");
  const r = resolveUserData({ appData, isPackaged: false });
  assert.strictEqual(r.dir, path.join(appData, "Nutation-dev"));
  assert.strictEqual(r.migrated, true);
  assert.ok(!fs.existsSync(legacy), "旧目录已改名消失");
  assert.ok(fs.existsSync(path.join(r.dir, "legacy-marker.txt")), "数据随目录迁入");
  cleanup(appData);
}

// 4) 目标已存在（二次启动）→ 不再改名，直接用目标
{
  const appData = mk();
  fs.mkdirSync(path.join(appData, "Nutation-dev"), { recursive: true });
  fs.mkdirSync(path.join(appData, "incremental-reading-dev"), { recursive: true });
  let renameCalled = 0;
  const r = resolveUserData({
    appData, isPackaged: false,
    renameSync: () => { renameCalled++; },
  });
  assert.strictEqual(r.dir, path.join(appData, "Nutation-dev"));
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(renameCalled, 0, "目标存在时绝不改名");
  cleanup(appData);
}

// 5) 注入的 renameSync 抛 EBUSY → 回退旧目录并带出错误（绝不新建空目标目录）
{
  const appData = mk();
  const legacy = path.join(appData, "incremental-reading-dev");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "library.db"), "x");
  const r = resolveUserData({
    appData, isPackaged: false,
    renameSync: () => { const e = new Error("EBUSY: resource busy"); e.code = "EBUSY"; throw e; },
  });
  assert.strictEqual(r.dir, legacy, "迁移失败继续使用旧目录");
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.error.code, "EBUSY");
  assert.ok(!fs.existsSync(path.join(appData, "Nutation-dev")), "失败时不新建空目录");
  cleanup(appData);
}

// 6) Windows 真实占用差分：better-sqlite3 只读连接占住 legacy/library.db → renameSync 真实失败
//    回退旧目录；连接关闭后同一 rename 成功——证明失败确由占用引起。
{
  const appData = mk();
  const legacy = path.join(appData, "incremental-reading-dev");
  fs.mkdirSync(legacy, { recursive: true });
  const lib = path.join(legacy, "library.db");
  const Database = require("better-sqlite3");
  const db = new Database(lib);
  db.exec("CREATE TABLE t (x)");
  db.close();
  const lock = new Database(lib, { readonly: true });
  let threw = null;
  const r = resolveUserData({
    appData, isPackaged: false,
    renameSync: (a, b) => {
      try { fs.renameSync(a, b); } catch (e) { threw = e; throw e; }
    },
  });
  assert.ok(threw, "被占用时真实 rename 失败");
  assert.strictEqual(r.dir, legacy, "真实占用下回退旧目录");
  lock.close();
  // 释放后同名迁移应成功（非空转自检：若 rename 仍失败则本断言组无效）
  fs.renameSync(legacy, path.join(appData, "Nutation-dev"));
  assert.ok(!fs.existsSync(legacy));
  cleanup(appData);
}

console.log("userData ok");
