// F78 落盘路径的极端环境（CJK 用户名 / 空格与符号 / 逼近 MAX_PATH 的超深目录）
// @runtime: electron  @tier: 1  @gui: false  @id: F78  @timeout: 420
// 运行：npx electron tests/flows/f78-hostile-paths.cjs        （驱动：为每个用例各起一个子进程）
//      F78_CASE=P2 npx electron tests/flows/f78-hostile-paths.cjs   （单跑一个用例）
//
// 为什么单独起子进程：同一进程里第二次 initDb() 会死锁（F71 实测踩过），
// 所以"四种路径 × 同一进程"根本不可行，只能一个用例一个进程。
// 分发视角：别人机器上的用户目录可能是 C:\Users\张三\…、C:\Users\John Smith\…，
// 也可能被 OneDrive/企业策略重定向到很深的路径。库文件、备份、临时文件都要在这些地方读写。
// 本条抓两件事：① 写不写得进去（失败必须报错，不能静默）；② **会不会写错地方**
// （路径构造失败后回退到 cwd 或别处 ⇒ 数据分裂，这是比"写不进"更糟的失效）。
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { ELECTRON } = require("./lib/guienv.cjs");

const CASES = {
  P1: { 名: "ASCII+空格", seg: ["John Smith", "App Data", "My Books"] },
  P2: { 名: "CJK 用户名", seg: ["张三", "应用数据", "渐进阅读"] },
  P3: { 名: "空格+CJK+符号混排", seg: ["李 四 (work)", "数据&目录#1", "备份 [auto]"] },
  P4: { 名: "逼近 MAX_PATH 的超深目录", seg: Array.from({ length: 18 }, (_, i) => `层级目录名称${i + 1}abcdefghijklmnop`) },
};

function snapshot(root) {
  const out = new Set();
  const walk = (d, depth) => {
    if (depth > 2) return;
    let list = [];
    try { list = fs.readdirSync(d); } catch { return; }
    for (const f of list) {
      if (/^(library|dictionary|memory|settings)\.db$|^settings\.json$|^\.tmp-/i.test(f)) out.add(path.join(d, f));
      if (depth < 2 && f === "data") { try { walk(path.join(d, f), depth + 1); } catch { /* 忽略 */ } }
    }
  };
  walk(root, 0);
  return out;
}

if (!process.env.F78_CASE) {
  // ── 驱动进程 ──────────────────────────────────────────────────
  const { Flow, runFlow } = require("./lib/harness.cjs");
  const flow = new Flow({ id: "F78", title: "极端落盘路径", angle: "CJK/空格/符号/超深目录下的读写，以及写错地方（数据分裂）检测", cites: ["§7.1.8", "§7.2"], tier: 1, gui: false });
  runFlow(flow, async () => {
    for (const [k, c] of Object.entries(CASES)) {
      const r = spawnSync(ELECTRON, [path.join(__dirname, "f78-hostile-paths.cjs")], {
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, F78_CASE: k },
        encoding: "utf-8",
        timeout: 120000,
      });
      const line = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("F78RESULT ")).pop();
      let j = null;
      try { j = JSON.parse(line.slice("F78RESULT ".length)); } catch { /* 子进程没吐结果 */ }
      flow.section(`${k} · ${c.名}`);
      if (!j) {
        flow.check(`${k} 子进程必须吐出一行结果`, false, "F78RESULT …", `stdout ${(r.stdout || "").slice(-160)} / stderr ${(r.stderr || "").slice(-160)} / status ${r.status}`);
        continue;
      }
      flow.record("目标目录", `${j.目录}（长度 ${j.目录长度}）`);
      flow.record("读数", `initDb=${j.initDb} 写库=${j.persist} 回读卡数=${j.cards} 库文件=${j.dbExists ? "在" : "不在"} 大小=${j.dbSize}  stray=${JSON.stringify(j.stray)}`);
      flow.check(`${k} initDb 要么成功、要么明确报错（不许静默半成功）`, j.initDb === "ok" || j.initDb === "throw", "ok 或 throw", j.initDb);
      flow.check(`${k} 库文件必须落在指定目录里`, j.dbExists === true, "在指定目录", j.dbExists ? "在" : `不在（initDb=${j.initDb} 错误=${String(j.err).slice(0, 90)}）`);
      flow.check(`${k} 指定目录之外不得出现第二个库文件（写错地方 ⇒ 数据分裂）`, (j.stray || []).length === 0, "0 个游离文件", JSON.stringify(j.stray));
      if (j.initDb === "ok") flow.check(`${k} 写入的卡必须能从同一目录读回`, j.cards >= 1, "≥1", j.cards);
    }
  }).then((s) => {
    // D239：驱动进程原先跑完就停在这里——Electron 主进程没开窗口也不会自行退出，只能等外层超时杀掉（退出码 124）。
    // 跑完即按结果如实退出（口径同 dbenv.quit）。
    require("electron").app.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
  });
  return;
}

// ── 用例子进程 ─────────────────────────────────────────────────
const { app } = require("electron");
const { ROOT, tmpUserDataDir } = require("./lib/harness.cjs");
const c = CASES[process.env.F78_CASE] || CASES.P1;
const base = path.join(os.tmpdir(), "incremental-reading-f78");
const dir = path.join(base, ...c.seg);
const strayBefore = new Set([...snapshot(ROOT), ...snapshot(path.dirname(tmpUserDataDir("x")))]);
const out = { 目录: dir, 目录长度: dir.length, initDb: "n/a", persist: "n/a", cards: -1, dbExists: false, dbSize: 0, stray: [], err: null };
const emit = () => { console.log("F78RESULT " + JSON.stringify(out)); app.exit(0); };

app.whenReady().then(async () => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { out.err = "mkdir " + e.message; emit(); return; }
  app.setPath("userData", dir);
  const dbPath = path.join(ROOT, "electron", "db.js");
  delete require.cache[dbPath];
  const db = require(dbPath);
  try {
    await db.initDb();
    out.initDb = "ok";
  } catch (e) {
    out.initDb = "throw";
    out.err = String(e.message).slice(0, 200);
  }
  try {
    if (out.initDb === "ok") {
      const it = db.createFromPaste("F78 路径书", "# 章\n\n为极端路径而造。\n");
      const itemId = it && (it.id || (it.item && it.item.id));
      db.createCard({ itemId, frontMarkdown: "F78 问", backMarkdown: "F78 答", cardType: "qa" });
      db.persistNow();
      out.persist = "ok";
    }
  } catch (e) {
    out.persist = "throw:" + String(e.message).slice(0, 120);
  }
  const dbFile = path.join(dir, "library.db");
  out.dbExists = fs.existsSync(dbFile);
  try { out.dbSize = out.dbExists ? fs.statSync(dbFile).size : 0; } catch { /* 忽略 */ }
  if (out.dbExists) {
    try {
      const { audit } = require("./lib/dbenv.cjs");
      const a = await audit(dbFile);
      out.cards = a.count("cards");
      a.close();
    } catch (e) { out.cards = -2; out.err = "audit " + String(e.message).slice(0, 120); }
  }
  const now = new Set([...snapshot(ROOT), ...snapshot(path.dirname(tmpUserDataDir("x")))]);
  out.stray = [...now].filter((p) => !strayBefore.has(p) && !path.resolve(p).startsWith(path.resolve(dir)));
  emit();
}).catch((e) => { out.err = "outer " + String(e.message).slice(0, 200); emit(); });
