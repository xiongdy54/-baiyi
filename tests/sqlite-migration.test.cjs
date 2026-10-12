// @runtime: node（经 ELECTRON_RUN_AS_NODE 通道执行——D137 §3.9，仓库常驻 electron-ABI 二进制）
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/sqlite-migration.test.cjs
// D137（docs/design/SQLITE3-MIGRATION-D137.md §5）：better-sqlite3 迁移验收套件（按批次逐段扩写）。
// 隔离：临时 userData（electron app 模块桩），绝不触碰真实库。
//
// 本文件段落：
//   S1（B2）learnerDb：require/open/save/all/getMeta/setMeta/reset 冒烟；
//                    sql.js 导出格式旧库直接打开；schema_version 重建规则生效；
//                    sql.js 独立读卡器读 better-sqlite3 checkpoint 后的库文件；
//                    undefined→null 绑定归一。
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-migration-"));

// ---- electron 模块桩（ELECTRON_RUN_AS_NODE 下 require("electron") 返回路径字符串） ----
const electronId = require.resolve("electron");
const fakeApp = {
  getPath: (name) => {
    if (name === "userData") return tmpRoot;
    throw new Error(`fakeApp.getPath(${name}) 未实现`);
  },
  setPath: () => {},
  whenReady: () => Promise.resolve(),
  on: () => {},
  exit: (code) => process.exit(code || 0)
};
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: fakeApp, ipcMain: { handle: () => {} }, shell: { openPath: async () => "" } }
};

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

const isWALFile = (file) => {
  try {
    const buf = fs.readFileSync(file);
    return buf.length >= 20 && buf.subarray(0, 16).toString("latin1") === "SQLite format 3\u0000" && buf[18] === 2;
  } catch {
    return false;
  }
};

// sql.js 独立读卡器：读盘上库文件，返回 rows（D137 §2：多个既有套件以 sql.js 作独立复核通道，必须继续可用）
async function sqlJsReadRows(file, sql, params = []) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const raw = new SQL.Database(fs.readFileSync(file));
  const stmt = raw.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  raw.close();
  return rows;
}

async function sqlJsWriteDb(file, statements) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  for (const s of statements) raw.run(s);
  const buf = Buffer.from(raw.export());
  raw.close();
  fs.writeFileSync(file, buf);
}

async function sectionLearner() {
  console.log("== S1（B2）learnerDb 切换冒烟 ==");
  const learnerDb = require(path.join(ROOT, "electron", "learnerDb.js"));
  const lmParams = require(path.join(ROOT, "electron", "lmParams.js"));
  const learnerDbFile = path.join(tmpRoot, "learner.db");

  console.log("-- L1 sql.js 导出格式旧库直接打开（数据文件兼容，设计稿 §3.5）--");
  await sqlJsWriteDb(learnerDbFile, [
    "CREATE TABLE IF NOT EXISTS lm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS pdf_page_texts (library_item_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (library_item_id, page));",
    `INSERT INTO lm_meta VALUES ('schema_version', '${Number(lmParams.LEARNER_DB_SCHEMA)}');`,
    `INSERT INTO lm_meta VALUES ('icu_version', '${String(process.versions.icu || "")}');`,
    `INSERT INTO lm_meta VALUES ('lex_version', '${Number(lmParams.LEX_VERSION)}');`,
    "INSERT INTO pdf_page_texts VALUES ('item-1', 0, 'sql.js 写入的页文本');"
  ]);
  await learnerDb.open();
  const legacyPages = await learnerDb.all("SELECT text FROM pdf_page_texts WHERE library_item_id = ?", ["item-1"]);
  check("sql.js 写入的旧 learner.db 由 better-sqlite3 直接打开且数据完整", legacyPages.length === 1 && legacyPages[0].text === "sql.js 写入的页文本", 1, legacyPages);
  check("打开后 journal_mode=wal（库文件头 byte18=2，WAL 标志持久）", isWALFile(learnerDbFile), true, isWALFile(learnerDbFile));

  console.log("-- L2 run/all/getMeta/setMeta/save 冒烟 + undefined 归一 + checkpoint 单文件自足 --");
  await learnerDb.setMeta("smoke-key", "smoke-值");
  check("setMeta→getMeta 往返", (await learnerDb.getMeta("smoke-key")) === "smoke-值", "smoke-值", await learnerDb.getMeta("smoke-key"));
  // undefined→null 归一（D137 §3.1）：sql.js 容忍 undefined，better-sqlite3 名义上抛 Invalid value
  await learnerDb.run("CREATE TABLE IF NOT EXISTS smoke_null_t (a TEXT)");
  await learnerDb.run("INSERT INTO smoke_null_t (a) VALUES (?)", [undefined]);
  const undefRows = await learnerDb.all("SELECT a FROM smoke_null_t");
  check("undefined 绑定归一为 NULL（不抛 Invalid value）", undefRows.length === 1 && undefRows[0].a === null, null, undefRows);
  await learnerDb.save();
  const walFile = learnerDbFile + "-wal";
  check("save()=wal_checkpoint(TRUNCATE) 后 -wal 截断为 0 字节（磁盘单文件自足）", fs.existsSync(walFile) && fs.statSync(walFile).size === 0, 0, fs.existsSync(walFile) ? fs.statSync(walFile).size : "无 -wal");
  const readBack = await sqlJsReadRows(learnerDbFile, "SELECT value FROM lm_meta WHERE key = 'smoke-key'");
  check("sql.js 独立读卡器读 checkpoint 后的库（better-sqlite3 写 → sql.js 读）", readBack.length === 1 && readBack[0].value === "smoke-值", 1, readBack);

  console.log("-- L3 schema_version 重建规则（设计稿 §5.2，原样保留）--");
  await learnerDb.reset();
  // 造一个 schema_version 过期的旧库 + 一张重建后不应存在的杂表
  await sqlJsWriteDb(learnerDbFile, [
    "CREATE TABLE IF NOT EXISTS lm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS stale_table_from_old_version (x INTEGER);",
    "INSERT INTO lm_meta VALUES ('schema_version', '0');"
  ]);
  await learnerDb.open();
  const metaVer = await learnerDb.getMeta("schema_version");
  check("schema_version 不匹配 → 全量重建为当前值", metaVer === String(lmParams.LEARNER_DB_SCHEMA), String(lmParams.LEARNER_DB_SCHEMA), metaVer);
  let staleTable = [];
  try {
    staleTable = await learnerDb.all("SELECT name FROM sqlite_master WHERE name = 'stale_table_from_old_version'");
  } catch { /* 表不存在即通过 */ }
  check("重建后旧杂表消失", staleTable.length === 0, 0, staleTable);
  const units = await learnerDb.all("SELECT COUNT(*) AS n FROM content_units");
  check("重建后 SCHEMA 完整（content_units 可查）", units.length === 1, 1, units);

  console.log("-- L4 reset：文件与 sidecar 全清 --");
  await learnerDb.run("INSERT INTO pdf_page_texts (library_item_id, page, text) VALUES ('item-x', 0, 'x')");
  await learnerDb.reset();
  check("reset 后 learner.db 及 -wal/-shm/.tmp 全部清除", !fs.existsSync(learnerDbFile) && !fs.existsSync(learnerDbFile + "-wal") && !fs.existsSync(learnerDbFile + "-shm") && !fs.existsSync(learnerDbFile + ".tmp"), true, {
    db: fs.existsSync(learnerDbFile),
    wal: fs.existsSync(learnerDbFile + "-wal"),
    shm: fs.existsSync(learnerDbFile + "-shm")
  });
}

(async () => {
  try {
    await sectionLearner();
    await sectionDict();
    await sectionMainDb();
    await sectionBackup();
  } catch (e) {
    fail++;
    console.error("S CRASH:", e.stack || e.message);
  }
  console.log(`\nsqlite-migration：${pass} 通过 / ${fail} 失败`);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 尽力 */ }
  process.exitCode = fail > 0 ? 1 : 0;
})();

// ---------------- S4（B5）M2 备份快照化 + 恢复 sidecar 清理 + 重启不丢 ----------------

async function sectionBackup() {
  console.log("== S4（B5）M2 备份快照化 + 恢复 sidecar 清理 ==");
  const db = require(path.join(ROOT, "electron", "db.js"));
  const backup = require(path.join(ROOT, "electron", "backup.js"));
  const Database = require("better-sqlite3");
  const libFile = path.join(tmpRoot, "library.db");

  console.log("-- B1 不 checkpoint 直接快照：db.backup() 含最新提交（裸 readFileSync 缺尾对照）--");
  // 用第二连接直写制造「已提交、未 checkpoint」状态（db.js 每次写都自带 persist=checkpoint，
  // 业务 API 造不出缺尾态；这正是 M2 陷阱的机械演示）
  const raw = new Database(libFile);
  raw.pragma("busy_timeout = 3000");
  raw.exec("CREATE TABLE IF NOT EXISTS m2_probe (id TEXT PRIMARY KEY, tag TEXT)");
  raw.prepare("INSERT INTO m2_probe (id, tag) VALUES (?, ?)").run("m2-1", "uncheckpooint-commit");
  raw.close();
  const rawMiss = await sqlJsReadRows(libFile, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='m2_probe'");
  check("对照：裸读主文件缺尾（未 checkpoint 的提交不可见，连新表都看不到）", rawMiss[0].n === 0, 0, rawMiss);
  const snapPath = path.join(tmpRoot, "m2-snapshot.db");
  await db.snapshotTo(snapPath);
  const snap = new Database(snapPath, { readonly: true });
  const snapRows = snap.prepare("SELECT COUNT(*) AS n FROM m2_probe").get();
  const snapCards = snap.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get();
  snap.close();
  check("db.backup() 快照含最新提交（在线快照读穿 WAL）", snapRows.n === 1, 1, snapRows.n);
  check("快照同样含业务表全部数据", snapCards.n >= 1, ">=1", snapCards.n);

  console.log("-- B2 备份 → 毁数据 → 恢复换入（清 sidecar）→ 重启不丢 --");
  const BAK = path.join(tmpRoot, "backups");
  const r = await backup.createBackup({
    dataDir: tmpRoot,
    backupDir: BAK,
    flush: () => {},
    snapshotLibrary: (dest) => db.snapshotTo(dest),
    label: "manual",
    appVersion: "0.0.1"
  });
  check("快照化备份成功", r.ok === true, true, r);
  // 毁数据：关连接（模拟重启前的进程退出；生产上恢复本就要求重启后换入）→ 删库（换入前的目标现场）
  const dictDb = require(path.join(ROOT, "electron", "dictDb.js"));
  const learnerDb = require(path.join(ROOT, "electron", "learnerDb.js"));
  db.closeDb();
  dictDb.close();
  learnerDb.close();
  fs.rmSync(libFile, { force: true });
  // 模拟崩溃残留的陈旧 sidecar（恢复必须同删，否则配错配文件 = 损坏）
  fs.writeFileSync(libFile + "-wal", "stale-wal-garbage");
  fs.writeFileSync(libFile + "-shm", "stale-shm-garbage");
  const rr = await backup.restoreBackup(r.file, { dataDir: tmpRoot, stagingDir: path.join(tmpRoot, "restore-staging"), markerFile: path.join(tmpRoot, "restore-pending.json"), skipSafety: true });
  check("恢复请求成功且需重启", rr.ok === true && rr.needsRestart === true, true, rr);
  const applied = backup.applyPendingRestore({ dataDir: tmpRoot, dbFile: libFile, stagingDir: path.join(tmpRoot, "restore-staging"), markerFile: path.join(tmpRoot, "restore-pending.json") });
  check("applyPendingRestore 换入 library.db", Array.isArray(applied?.restored) && applied.restored.includes("library.db"), true, applied);
  check("恢复换入后目标目录无 -wal/-shm 残留（陈旧 sidecar 同删）", !fs.existsSync(libFile + "-wal") && !fs.existsSync(libFile + "-shm"), {
    wal: fs.existsSync(libFile + "-wal"),
    shm: fs.existsSync(libFile + "-shm")
  });
  // 重启（initDb 重开）→ 备份期数据完好
  await db.initDb();
  const cardsAfter = db.listAllCards();
  check("恢复后重启不丢（备份期卡片在场）", cardsAfter.some((c) => c.noteText === "D137 主库冒烟"), true, cardsAfter.length);
  check("重启后连接 pragma 仍为 WAL+FULL", (() => { const p = db.connPragmas(); return p.journalMode === "wal" && p.synchronous === 2; })(), true, db.connPragmas());
  const m2After = await sqlJsReadRows(libFile, "SELECT COUNT(*) AS n FROM m2_probe");
  check("快照期 m2_probe 行随备份恢复（页拷贝完整性）", m2After[0].n === 1, 1, m2After);
}

// ---------------- S3（B4）主库 db.js：四原语替换 + persist 重定义 + 崩溃恢复 ----------------

async function sectionMainDb() {
  console.log("== S3（B4）主库 db.js 切换 ==");
  const db = require(path.join(ROOT, "electron", "db.js"));
  const libFile = path.join(tmpRoot, "library.db");

  console.log("-- M1 打开与 pragma 实测（WAL + synchronous=FULL + busy_timeout）--");
  await db.initDb();
  const pm = db.connPragmas();
  check("journal_mode=wal", pm && pm.journalMode === "wal", "wal", pm && pm.journalMode);
  // SQLite synchronous 档位：0=OFF 1=NORMAL 2=FULL 3=EXTRA —— synchronous=FULL 实测值即 2
  check("synchronous=FULL（实测值 2）", pm && pm.synchronous === 2, 2, pm && pm.synchronous);
  check("busy_timeout=3000", pm && pm.busyTimeout === 3000, 3000, pm && pm.busyTimeout);
  check("library.db 文件头 byte18=2（WAL 标志持久）", isWALFile(libFile), true, isWALFile(libFile));

  console.log("-- M2 写入 → persist(checkpoint) → sql.js 独立读卡器读主文件（单文件自足）--");
  const card = db.createCard({ noteText: "D137 主库冒烟", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50, tags: [] });
  db.saveReview(card.id, { state: "review", due: Date.now() + 86400000, lapses: 0, stability: 3, difficulty: 5, reps: 1, lastReview: Date.now(), learningSteps: 0 }, "Good", 10, { state: "new", due: Date.now(), lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: 0 });
  const seen = await sqlJsReadRows(libFile, "SELECT COUNT(*) AS n FROM review_logs");
  check("评分落库 + checkpoint 后 sql.js 读主文件可见", seen[0].n === 1, 1, seen);

  console.log("-- M3 BLOB 往返（better-sqlite3 写文件 → sql.js 独立读，Buffer↔Uint8Array）--");
  const Database = require("better-sqlite3");
  const blobFile = path.join(tmpRoot, "blob-roundtrip.db");
  const bdb = new Database(blobFile);
  bdb.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)");
  const payload = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  bdb.prepare("INSERT INTO blobs (data) VALUES (?)").run(payload);
  bdb.close();
  const blobRows = await sqlJsReadRows(blobFile, "SELECT data FROM blobs");
  const round = Buffer.from(blobRows[0].data);
  check("BLOB 逐字节往返完整", Buffer.compare(round, payload) === 0, true, [...round]);

  console.log("-- M4 崩溃恢复（§5-2）：事务中途 process.exit → 重开回放至一致 --");
  const crashFile = path.join(tmpRoot, "crash-recovery.db");
  const cdb = new Database(crashFile);
  applyStandardPragmasSafe(cdb);
  cdb.exec("CREATE TABLE crash_t (id INTEGER PRIMARY KEY, tag TEXT)");
  cdb.prepare("INSERT INTO crash_t (tag) VALUES (?)").run("committed-before-crash");
  cdb.close();
  const childScript = `
    const Database = require("better-sqlite3");
    const d = new Database(${JSON.stringify(crashFile)});
    d.exec("BEGIN IMMEDIATE");
    d.prepare("INSERT INTO crash_t (tag) VALUES (?)").run("uncommitted-must-vanish");
    process.exit(1); // 模拟崩溃：未提交事务、不 close、WAL 留帧
  `;
  const { spawnSync } = require("child_process");
  const child = spawnSync(process.execPath, ["-e", childScript], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf-8",
    timeout: 60000
  });
  check("崩溃子进程确以非零退出（注入有效）", child.status !== 0, "!=0", child.status);
  const rec = new Database(crashFile);
  rec.pragma("busy_timeout = 3000");
  const rowsAfter = rec.prepare("SELECT tag FROM crash_t ORDER BY id").all();
  check("未提交事务消失（journal/WAL 回放至一致）", rowsAfter.length === 1 && rowsAfter[0].tag === "committed-before-crash", ["committed-before-crash"], rowsAfter.map((r) => r.tag));
  check("崩溃后 quick_check=ok", rec.pragma("quick_check", { simple: true }) === "ok", "ok", rec.pragma("quick_check", { simple: true }));
  rec.close();
}

function applyStandardPragmasSafe(d) {
  d.pragma("journal_mode = wal");
  d.pragma("synchronous = FULL");
  d.pragma("busy_timeout = 3000");
}

// ---------------- S2（B3）dictDb ----------------

async function sectionDict() {
  console.log("== S2（B3）dictDb 切换 ==");
  const dictDb = require(path.join(ROOT, "electron", "dictDb.js"));
  const dictDbFile = path.join(tmpRoot, "dictionary.db");

  console.log("-- D1 sql.js 导出格式旧 dictionary.db 直接打开（数据文件兼容）--");
  await sqlJsWriteDb(dictDbFile, [
    `CREATE TABLE IF NOT EXISTS dict_entries (
      source_id TEXT NOT NULL, headword TEXT NOT NULL, headword_norm TEXT NOT NULL,
      phonetic TEXT, pos TEXT, html TEXT, PRIMARY KEY (source_id, headword_norm));`,
    "CREATE INDEX IF NOT EXISTS idx_dict_entries_norm ON dict_entries(headword_norm);",
    "INSERT INTO dict_entries VALUES ('legacy-src', 'moral', 'moral', '/ˈmɔːrəl/', 'n./adj.', 'n. 道德');"
  ]);
  await dictDb.open();
  const legacyRows = await dictDb.lookup("MORAL"); // 大小写归一后命中旧行
  check("sql.js 写入的旧 dictionary.db 由 better-sqlite3 直接打开且可查", legacyRows.length === 1 && legacyRows[0].headword === "moral", 1, legacyRows);

  console.log("-- D2 countBySource / insertRows（async generator）/ lookup --");
  const n0 = await dictDb.countBySource("legacy-src");
  check("countBySource（原带参 exec → prepare().get()）", n0 === 1, 1, n0);
  function* genRows(n) {
    for (let i = 0; i < n; i++) yield { headword: `w${i}`, phonetic: `/p${i}/`, pos: "n.", html: `<p>def ${i}</p>` };
  }
  const ins = await dictDb.insertRows("smoke-src", genRows(2000));
  check("insertRows 计数正确（2000 行，未触 cap）", ins.count === 2000 && ins.capped === false, { count: 2000, capped: false }, ins);
  const hit = await dictDb.lookup("W1999");
  check("insert 后 lookup 命中（归一 + 字段完整）", hit.length === 1 && hit[0].phonetic === "/p1999/" && hit[0].html === "<p>def 1999</p>", 1, hit);
  const cntAfter = await dictDb.countBySource("smoke-src");
  check("countBySource 与写入行数一致", cntAfter === 2000, 2000, cntAfter);

  console.log("-- D3 事务原子性：导入中途抛错 → ROLLBACK → 零残留（F37 邻接语义）--");
  let midThrow = false;
  async function* badGen() {
    for (let i = 0; i < 3000; i++) {
      if (i === 2500) throw new Error("模拟导入中途失败（迭代器抛错）");
      yield { headword: `b${i}`, phonetic: "", pos: "", html: "" };
    }
  }
  try {
    await dictDb.insertRows("bad-src", badGen());
  } catch (e) {
    midThrow = true;
  }
  const badCnt = await dictDb.countBySource("bad-src");
  check("中途失败向上抛", midThrow, true, midThrow);
  check("失败事务 ROLLBACK：bad-src 零残留", badCnt === 0, 0, badCnt);

  console.log("-- D4 removeSource + VACUUM --");
  await dictDb.removeSource("smoke-src");
  check("removeSource 后计数归零", (await dictDb.countBySource("smoke-src")) === 0, 0, await dictDb.countBySource("smoke-src"));
  check("removeSource 后 lookup 为空", (await dictDb.lookup("w1")).length === 0, 0, await dictDb.lookup("w1").length);

  console.log("-- D5 大事务 10 万行：计时 vs 旧实现完整基线（±20% 内）+ 单文件自足 --");
  const big = () => genRows(100000);
  const t0 = Date.now();
  const bigIns = await dictDb.insertRows("big-src", big());
  const bs3Ms = Date.now() - t0;
  check("10 万行插入计数", bigIns.count === 100000, 100000, bigIns);
  // 基线 = 旧实现完整管线（sql.js 内存库 + 同构逐行变换 + 生成器迭代 + prepare/bind/step/reset +
  // 含 idx_dict_entries_norm 二级索引 + save()＝export 全量 + fsync + rename 原子替换）
  // ——新实现同期成本还含 checkpoint(TRUNCATE) 落盘。
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const sq = new SQL.Database();
  sq.run(`CREATE TABLE dict_entries (source_id TEXT NOT NULL, headword TEXT NOT NULL, headword_norm TEXT NOT NULL,
    phonetic TEXT, pos TEXT, html TEXT, PRIMARY KEY (source_id, headword_norm))`);
  sq.run("CREATE INDEX idx_dict_entries_norm ON dict_entries(headword_norm)");
  const baselineFile = path.join(tmpRoot, "dict-baseline.db");
  const st = sq.prepare("INSERT OR IGNORE INTO dict_entries VALUES (?,?,?,?,?,?)");
  const tb0 = Date.now();
  sq.run("BEGIN");
  function* baselineRows() {
    for (let i = 0; i < 100000; i++) yield { headword: `w${i}`, phonetic: `/p${i}/`, pos: "n.", html: `<p>def ${i}</p>` };
  }
  for (const r of baselineRows()) {
    st.bind([
      "big-src",
      String(r.headword),
      String(r.headword).normalize("NFKC").toLowerCase(),
      String(r.phonetic).slice(0, 120),
      String(r.pos).slice(0, 80),
      String(r.html).slice(0, 800),
    ]);
    st.step();
    st.reset();
  }
  sq.run("COMMIT");
  const buf = Buffer.from(sq.export());
  const fd = fs.openSync(baselineFile, "w");
  fs.writeSync(fd, buf);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(baselineFile, baselineFile + ".done");
  const sqlJsMs = Date.now() - tb0;
  st.free();
  sq.close();
  console.log(`    计时：better-sqlite3（含 checkpoint 落盘）=${bs3Ms}ms / 旧实现完整管线基线=${sqlJsMs}ms（比值 ${(bs3Ms / sqlJsMs).toFixed(3)}）`);
  check("10 万行导入计时不劣于基线 ±20%", bs3Ms <= sqlJsMs * 1.2, `<=${Math.round(sqlJsMs * 1.2)}ms`, `${bs3Ms}ms`);
  check("大事务 checkpoint 后主文件自足（sql.js 独立读卡器可数全 10 万行）", (await sqlJsReadRows(dictDbFile, "SELECT COUNT(*) AS n FROM dict_entries WHERE source_id = 'big-src'"))[0].n === 100000, 100000, "n");
}
