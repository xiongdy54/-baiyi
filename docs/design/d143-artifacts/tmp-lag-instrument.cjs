// [DIAG-TEMP 测量件，非产品代码] 启动卡顿诊断：主进程注入式探针（NODE_OPTIONS=--require 挂载）
// 只加计时与打点，不改任何产品文件；每行带 epoch ms，便于与 CDP 侧时间线对齐。
// 用法（由 tests/tmp-lag-run.cjs 自动设置）：
//   NODE_OPTIONS=--require "C:/.../tests/tmp-lag-instrument.cjs"  electron .
"use strict";

const fsRaw = require("fs");
const pathRaw = require("path");

const T0 = Date.now();
const outLog = (line) => {
  try {
    process.stdout.write(`[LAG] ${line}\n`);
  } catch {
    /* 静默 */
  }
};
const ms = (t) => `${Date.now() - t}ms`;

// worker_threads（D117 backfillSidecars 的 zip 解析 worker）会继承 execArgv 从而再次加载本模块——
// 主进程探针只在主线程安装一次
try {
  if (require("worker_threads").isMainThread === false) {
    outLog(`skip worker-thread 注入（pid=${process.pid}）`);
    module.exports = {};
    return;
  }
} catch {
  /* 忽略 */
}

outLog(`proc.start epoch=${T0} pid=${process.pid} argv1=${String(process.argv[1] || "").slice(-40)}`);

/* ---------- 0. 自证存活：心跳 + 空洞检测（100ms 粒度，阈值 100ms） ---------- */
{
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    if (gap > 100) outLog(`hole ${last} -> ${now} (${gap}ms)`);
    last = now;
  }, 50).unref?.();
  setInterval(() => outLog(`alive @${Date.now()} (since proc.start ${Date.now() - T0}ms)`), 5000).unref?.();
}

/* ---------- 1. desktopCapturer.getSources ---------- */
try {
  const Module = require("module");
  const origLoad0 = Module._load;
  // 在 app 侧拿到 electron 导出后包 desktopCapturer（内部 preload 的 require 是 npm stub）
  let dcWrapped = false;
  Module._load = function (request, parent, isMain) {
    const out = origLoad0.apply(this, arguments);
    if (!dcWrapped && out && out.desktopCapturer && out.BrowserWindow && typeof out.desktopCapturer.getSources === "function") {
      dcWrapped = true;
      try {
        // Menu / protocol 先包（普通赋值，失败即跳过；不得影响后面的 desktopCapturer 探针）
        try {
          if (out.Menu && !out.Menu.__lagWrapped && typeof out.Menu.setApplicationMenu === "function") {
            const om = out.Menu.setApplicationMenu.bind(out.Menu);
            out.Menu.setApplicationMenu = (...a) => {
              const t = Date.now();
              const r = om(...a);
              const d = Date.now() - t;
              if (d >= 20) outLog(`Menu.setApplicationMenu ${d}ms`);
              return r;
            };
            out.Menu.__lagWrapped = true;
          }
        } catch (e) { outLog(`probe.fail Menu: ${e && e.message}`); }
        try {
          if (out.protocol && typeof out.protocol.handle === "function" && !out.protocol.__lagWrapped) {
            const oh = out.protocol.handle.bind(out.protocol);
            out.protocol.handle = (...a) => {
              const t = Date.now();
              const r = oh(...a);
              const d = Date.now() - t;
              if (d >= 20) outLog(`protocol.handle ${d}ms`);
              return r;
            };
            out.protocol.__lagWrapped = true;
          }
        } catch (e) { outLog(`probe.fail protocol: ${e && e.message}`); }
        const DC = out.desktopCapturer;
        const orig = DC.getSources.bind(DC);
        Object.defineProperty(DC, "getSources", {
          configurable: true,
          value: function (...args) {
            const t = Date.now();
            outLog(`enter desktopCapturer.getSources thumbnail=${JSON.stringify(args[0] && args[0].thumbnailSize)} epoch=${t}`);
            const r = orig(...args);
            if (r && typeof r.then === "function") {
              return r.then(
                (x) => {
                  outLog(`exit  desktopCapturer.getSources dur=${ms(t)} sources=${x && x.length} epoch=${Date.now()}`);
                  return x;
                },
                (e) => {
                  outLog(`exit  desktopCapturer.getSources dur=${ms(t)} ERR=${e && e.message}`);
                  throw e;
                }
              );
            }
            outLog(`exit  desktopCapturer.getSources (sync) dur=${ms(t)}`);
            return r;
          }
        });
        outLog("probe.ready desktopCapturer");
      } catch (e) {
        outLog(`probe.fail desktopCapturer: ${e && e.message}`);
      }
    }
    return out;
  };
} catch (e) {
  outLog(`probe.fail module-hook: ${e && e.message}`);
}

/* ---------- 2. better-sqlite3：>20ms 同步 SQL 跨度 ---------- */
try {
  const Database = require("better-sqlite3");
  const labelOf = (db) => {
    try {
      const n = String((db && db.name) || "");
      if (n.includes("learner.db")) return "learner.db";
      if (n.includes("library.db")) return "library.db";
      if (n.includes("dictionary.db")) return "dictionary.db";
      return n || "memory";
    } catch {
      return "?";
    }
  };
  for (const m of ["exec", "pragma"]) {
    const orig = Database.prototype[m];
    Database.prototype[m] = function (...args) {
      const t = Date.now();
      const out = orig.apply(this, args);
      const d = Date.now() - t;
      if (d >= 20) outLog(`sql.${m}${m === "pragma" ? "" : ""} ${d}ms [${labelOf(this)}] :: ${String(args[0]).replace(/\s+/g, " ").slice(0, 80)}`);
      return out;
    };
  }
  const proto = Object.getPrototypeOf(new Database(":memory:").prepare("SELECT 1"));
  for (const m of ["run", "get", "all", "iterate"]) {
    if (typeof proto[m] !== "function") continue;
    const orig = proto[m];
    proto[m] = function (...args) {
      const t = Date.now();
      const out = orig.apply(this, args);
      const d = Date.now() - t;
      if (d >= 20) outLog(`sql.${m} ${d}ms [${labelOf(this.database)}] :: ${String(this.source).replace(/\s+/g, " ").slice(0, 80)}`);
      return out;
    };
  }
  outLog("probe.ready better-sqlite3");
} catch (e) {
  outLog(`probe.fail better-sqlite3: ${e && e.message}`);
}

/* ---------- 3. fs 同步调用 >50ms ---------- */
{
  for (const m of ["readFileSync", "writeFileSync", "appendFileSync", "renameSync", "mkdirSync", "readdirSync", "statSync", "copyFileSync", "rmSync", "unlinkSync"]) {
    const orig = fsRaw[m];
    if (typeof orig !== "function") continue;
    fsRaw[m] = function (...a) {
      const t = Date.now();
      const r = orig.apply(this, a);
      const d = Date.now() - t;
      if (d >= 50) outLog(`fs.${m} ${d}ms :: ${String(a[0]).slice(0, 90)}`);
      return r;
    };
  }
  outLog("probe.ready fs");
}

/* ---------- 4. 模块导出包装（learnerRefresh 阶段 / db.initDb / backup / jszip / memoryTidy） ---------- */
try {
  const Module = require("module");
  const resolveOrNull = (request, parent) => {
    try {
      return Module._resolveFilename(request, parent);
    } catch {
      return null;
    }
  };
  const origLoad = Module._load;
  const wrappedFiles = new Set();

  const wrapExports = (mod, hooks) => {
    for (const [name, wrap] of Object.entries(hooks)) {
      const orig = mod.exports[name];
      if (typeof orig !== "function") continue;
      mod.exports[name] = wrap(orig);
    }
  };

  Module._load = function (request, parent, isMain) {
    const out = origLoad.apply(this, arguments);
    try {
      const resolved = parent && parent.filename ? resolveOrNull(request, parent) : null;
      const isElectronMod = resolved && /\\electron\\/.test(resolved);
      const isJszip = resolved && /node_modules[\\/]jszip[\\/]/.test(resolved);
      if (!resolved || (!isElectronMod && !isJszip)) return out;
      const base = pathRaw.basename(resolved);
      if (wrappedFiles.has(resolved)) return out;
      const mod = require.cache[resolved];
      if (!mod || !mod.exports) return out;

      if (base === "learnerRefresh.js") {
        wrappedFiles.add(resolved);
        const origRefresh = mod.exports.refresh;
        let phaseTimer = null;
        let lastPhase = "";
        mod.exports.refresh = function (...a) {
          const t = Date.now();
          outLog(`enter learnerRefresh.refresh epoch=${t} args=${JSON.stringify(a[0] || {})}`);
          phaseTimer = setInterval(() => {
            try {
              const st = mod.exports.getStatus ? mod.exports.getStatus() : null;
              const ph = st && st.phase;
              if (ph && ph !== lastPhase) {
                lastPhase = ph;
                outLog(`learnerRefresh.phase=${ph} @${Date.now()}`);
              }
            } catch { /* 忽略 */ }
          }, 5);
          phaseTimer.unref?.();
          const r = origRefresh.apply(this, a);
          if (r && typeof r.then === "function") {
            return r.then(
              (x) => {
                clearInterval(phaseTimer);
                outLog(`exit  learnerRefresh.refresh dur=${ms(t)} result=${JSON.stringify(x)} epoch=${Date.now()}`);
                return x;
              },
              (e) => {
                clearInterval(phaseTimer);
                outLog(`exit  learnerRefresh.refresh dur=${ms(t)} ERR=${e && e.message}`);
                throw e;
              }
            );
          }
          clearInterval(phaseTimer);
          outLog(`exit  learnerRefresh.refresh (sync) dur=${ms(t)}`);
          return r;
        };
        outLog("probe.ready learnerRefresh");
      } else if (base === "backup.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          backfillSidecars: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter backfillSidecars epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  backfillSidecars dur=${ms(t)} r=${JSON.stringify(x)}`); return x; },
              (e) => { outLog(`exit  backfillSidecars dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          },
          createBackup: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter createBackup epoch=${t} label=${(a[0] && a[0].label) || "?"}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  createBackup dur=${ms(t)} ok=${x && x.ok} skipped=${!!(x && x.skipped)} file=${pathRaw.basename(String((x && x.file) || ""))}`); return x; },
              (e) => { outLog(`exit  createBackup dur=${ms(t)} THROW=${e && e.message}`); throw e; }
            );
          },
          autoBackupIfNeeded: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter autoBackupIfNeeded epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  autoBackupIfNeeded dur=${ms(t)} r=${JSON.stringify(x)}`); return x; },
              (e) => { outLog(`exit  autoBackupIfNeeded dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          },
          listBackups: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            return Promise.resolve(r).then((x) => {
              const d = Date.now() - t;
              if (d >= 50) outLog(`listBackups dur=${d}ms n=${x && x.backups && x.backups.length}`);
              return x;
            });
          }
        });
        outLog("probe.ready backup");
      } else if (base === "quickCapture.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          init: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            outLog(`quickCapture.init ${d}ms`);
            return r;
          }
        });
      } else if (base === "workbenchWindow.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          init: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            if (d >= 20) outLog(`workbenchWindow.init ${d}ms`);
            return r;
          }
        });
      } else if (base === "tray.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          init: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            if (d >= 20) outLog(`tray.init ${d}ms`);
            return r;
          }
        });
      } else if (base === "pluginHost.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          init: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            if (d >= 20) outLog(`pluginHost.init ${d}ms`);
            return r;
          }
        });
      } else if (base === "db.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          initDb: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter initDb epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  initDb dur=${ms(t)}`); return x; },
              (e) => { outLog(`exit  initDb dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          },
          reconcileStaleMaterialMapRuns: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            outLog(`reconcileStaleMaterialMapRuns ${d}ms (n=${String(r).slice(0, 20)})`);
            return r;
          },
          persistDb: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            if (d >= 20) outLog(`persistDb ${d}ms`);
            return r;
          }
        });
        outLog("probe.ready db");
      } else if (base === "dictDb.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          open: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter dictDb.open epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  dictDb.open dur=${ms(t)}`); return x; },
              (e) => { outLog(`exit  dictDb.open dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          }
        });
        outLog("probe.ready dictDb");
      } else if (base === "learnerDb.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          open: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter learnerDb.open epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  learnerDb.open dur=${ms(t)}`); return x; },
              (e) => { outLog(`exit  learnerDb.open dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          },
          save: (orig) => function (...a) {
            const t = Date.now();
            const r = orig.apply(this, a);
            const d = Date.now() - t;
            if (d >= 20) outLog(`learnerDb.save ${d}ms`);
            return r;
          }
        });
        outLog("probe.ready learnerDb");
      } else if (base === "memoryTidy.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          startupBackfillIfDue: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter memoryTidy.startupBackfillIfDue epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  memoryTidy.startupBackfillIfDue dur=${ms(t)} r=${String(x).slice(0, 80)}`); return x; },
              (e) => { outLog(`exit  memoryTidy.startupBackfillIfDue dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          }
        });
        outLog("probe.ready memoryTidy");
      } else if (base === "screenCapture.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          warmup: (orig) => function (...a) {
            outLog(`screenCapture.warmup 注册 @${Date.now()}`);
            return orig.apply(this, a);
          }
        });
        outLog("probe.ready screenCapture");
      } else if (base === "legacyBackfill.js") {
        wrappedFiles.add(resolved);
        wrapExports(mod, {
          runLegacyBackfill: (orig) => function (...a) {
            const t = Date.now();
            outLog(`enter runLegacyBackfill epoch=${t}`);
            const r = orig.apply(this, a);
            return Promise.resolve(r).then(
              (x) => { outLog(`exit  runLegacyBackfill dur=${ms(t)} r=${JSON.stringify(x)}`); return x; },
              (e) => { outLog(`exit  runLegacyBackfill dur=${ms(t)} ERR=${e && e.message}`); throw e; }
            );
          }
        });
        outLog("probe.ready legacyBackfill");
      } else if (base === "jszip.js" || /node_modules[\\/]jszip[\\/]/.test(resolved)) {
        wrappedFiles.add(resolved);
        const JSZip = mod.exports;
        if (JSZip && JSZip.prototype && typeof JSZip.prototype.generateAsync === "function") {
          const orig = JSZip.prototype.generateAsync;
          JSZip.prototype.generateAsync = function (opts, onUpdate) {
            const t = Date.now();
            outLog(`enter JSZip.generateAsync epoch=${t} files=${this.files ? Object.keys(this.files).length : "?"}`);
            let lastLog = 0;
            const wrappedCb = (meta) => {
              const now = Date.now();
              if (now - lastLog >= 400) {
                lastLog = now;
                outLog(`jszip.progress ${meta && meta.percent ? Math.round(meta.percent * 10) / 10 : "?"}% cur=${String((meta && meta.currentFile) || "").slice(0, 40)}`);
              }
              if (typeof onUpdate === "function") onUpdate(meta);
            };
            const r = orig.call(this, opts, wrappedCb);
            return Promise.resolve(r).then((x) => {
              outLog(`exit  JSZip.generateAsync dur=${ms(t)} bytes=${x && x.length}`);
              return x;
            });
          };
          outLog("probe.ready jszip");
        }
      }
    } catch (e) {
      outLog(`probe.fail hook ${request}: ${e && e.message}`);
    }
    return out;
  };
} catch (e) {
  outLog(`probe.fail module-hooks: ${e && e.message}`);
}

outLog(`probe.done @${Date.now()}`);
