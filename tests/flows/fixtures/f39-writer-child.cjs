// F39 夹具（子进程）：以「同一 dataDir 上的第二个真实进程」的身份驱动应用自己的 electron/db.js。
// 由 ../f39-fs-environment-adversary.cjs 用 electron.exe spawn 多个实例（同一目录的不同路径拼写：
// 真身 / 目录联接 / \\?\ 前缀 / .. 绕行），每步往 F39_EVENTS 追加一行 JSON 供父进程握手，
// 最后由父进程**只读打开落盘的 library.db** 核对到底谁的行活了下来。
// 本夹具不做任何断言，只如实执行 + 上报；判红全在父流程（免得子进程里断言丢失）。
//
// 环境变量：
//   F39_MODE      lockonly = 只抢锁不上库（用于把住锁不放，测锁的键是什么）；writer = 走 db.js 写入
//   F39_ROOT      仓库根；F39_DIR userData（任意拼写）
//   F39_EVENTS    事件文件（append 行 JSON）
//   F39_TAG       本实例标记（A/B/H……）
//   F39_ROWS      首轮写入的卡行数
//   F39_TRY_LOCK  =1 完全照 electron/main.js:18-28 的形状：抢不到锁就 app.quit()，**但代码继续往下跑**
//   F39_LATE_AFTER 等到该标记 done 之后再进入迟到写（把竞态做成确定序，不受长跑 CPU 干扰）
//   F39_LATE_MS   迟到写前的额外等待
//   F39_MIN_LIFE_MS 最短存活
// @runtime: electron
"use strict";
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const ROOT = process.env.F39_ROOT;
const DIR = process.env.F39_DIR;
const EV = process.env.F39_EVENTS;
const TAG = String(process.env.F39_TAG || "X");
const MODE = String(process.env.F39_MODE || "writer");
const ROWS = Number(process.env.F39_ROWS || 0);
const TRY_LOCK = process.env.F39_TRY_LOCK === "1";
const LATE_AFTER = process.env.F39_LATE_AFTER || "";
const LATE_MS = Number(process.env.F39_LATE_MS || 1500);
const MIN_LIFE = Number(process.env.F39_MIN_LIFE_MS || 0);
const DB_PATH = path.join(ROOT, "electron", "db.js");

const t0 = Date.now();
function ev(o) {
  try {
    fs.appendFileSync(EV, JSON.stringify(Object.assign({ tag: TAG, pid: process.pid, ms: Date.now() - t0 }, o)) + "\n");
  } catch {
    /* 事件文件写不进就退回 stdout */
    process.stdout.write(JSON.stringify(o) + "\n");
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDone(otherTag, budgetMs) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    try {
      const lines = fs.readFileSync(EV, "utf8").split("\n");
      for (const l of lines) {
        if (!l.trim()) continue;
        let o;
        try { o = JSON.parse(l); } catch { continue; }
        if (o.ev === "done" && o.tag === otherTag) return true;
      }
    } catch { /* 还没人写 */ }
    await sleep(120);
  }
  return false;
}

// —— 与 electron/main.js:10-28 同一顺序：先 setPath，再抢单实例锁，抢不到 app.quit() ——
let lockGranted = null;
let lockError = null;
try {
  app.setPath("userData", DIR);
  if (TRY_LOCK) lockGranted = app.requestSingleInstanceLock();
  if (TRY_LOCK && !lockGranted) app.quit();
} catch (e) {
  lockError = String((e && e.message) || e);
}
const started = {
  ev: "started",
  mode: MODE,
  dirSet: DIR,
  dirEffective: (() => { try { return app.getPath("userData"); } catch (e) { return "ERR " + e.message; } })(),
  lockGranted,
  lockError,
};
ev(started);

// 安全网：userData 必须真的落在被测拼写上、且在系统临时目录内——否则本进程会去写**用户真实资料目录**，
// 立刻退出，绝不 require 任何会写盘的模块。
function inSandbox() {
  const os = require("os");
  const eff = String(started.dirEffective || "");
  const tmp = String(os.tmpdir());
  const norm = (s) => s.replace(/^\\\\\?\\/, "").replace(/[\\/.]+$/, "").toLowerCase();
  return norm(eff) === norm(DIR) && norm(eff).startsWith(norm(tmp));
}
if (!inSandbox()) {
  ev({ ev: "abort-unsafe-userdata", dirEffective: started.dirEffective });
  try { app.exit(3); } catch { process.exit(3); }
  throw new Error("拒绝在非沙箱 userData 上运行");
}

if (MODE === "lockonly") {
  // 只做「持锁不放」的哨兵：报完锁状态就活到 MIN_LIFE
  (async () => {
    const rest = Math.max(0, MIN_LIFE - (Date.now() - t0));
    await sleep(rest);
    ev({ ev: "done", mode: "lockonly", wrote: 0, wroteRows: [] });
    try { app.exit(0); } catch { process.exit(0); }
  })();
} else {
  app
    .whenReady()
    .then(async () => {
      ev({ ev: "ready", reachedWhenReady: true });
      const db = require(DB_PATH);
      const wroteRows = [];
      let initErr = null;
      try {
        await db.initDb();
      } catch (e) {
        initErr = String((e && e.message) || e);
      }
      ev({ ev: "initdb", initErr });
      const mk = (i) => {
        const label = `F39-${TAG}-${i}`;
        db.createCard({
          noteText: label,
          cardType: "qa",
          frontMarkdown: `问 ${label}`,
          backMarkdown: `答 ${label}`,
          priority: 50,
          tags: [],
        });
        wroteRows.push(label);
      };
      let writeErr = null;
      try {
        for (let i = 1; i <= ROWS; i++) mk(i);
      } catch (e) {
        writeErr = String((e && e.message) || e);
      }
      ev({ ev: "first-write", rows: wroteRows.slice(), writeErr });

      if (LATE_AFTER) {
        const got = await waitDone(LATE_AFTER, Number(process.env.F39_WAIT_MS || 60000));
        ev({ ev: "waited", target: LATE_AFTER, got });
        await sleep(LATE_MS);
        try {
          mk("LATE");
        } catch (e) {
          writeErr = (writeErr ? writeErr + " / " : "") + String((e && e.message) || e);
        }
      }
      let dbFile = path.join(DIR, "library.db");
      let size = null;
      try {
        db.persistNow();
      } catch (e) {
        writeErr = (writeErr ? writeErr + " / " : "") + "persistNow: " + String((e && e.message) || e);
      }
      try {
        size = fs.statSync(dbFile).size;
      } catch (e) {
        size = "NOFILE " + e.code;
      }
      const rest = Math.max(0, MIN_LIFE - (Date.now() - t0));
      await sleep(rest);
      ev({
        ev: "done",
        wrote: wroteRows.length,
        wroteRows,
        writeErr,
        initErr,
        sizeAfter: size,
        memoryCards: (() => { try { return db.listAllCards().length; } catch { return null; } })(),
        ok: !writeErr && !initErr,
      });
      try { app.exit(0); } catch { process.exit(0); }
    })
    .catch((e) => {
      ev({ ev: "crash", err: String((e && e.stack) || e).slice(0, 300) });
      process.exit(1);
    });
}
