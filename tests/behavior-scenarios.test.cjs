// @runtime: electron
// D248 / T15：合成场景与属性测试——附录 A 的 runs 日期算术逐项；随机数据上「增量 = 全量重建」；
// scripts/bdi-inspect.mjs 只读合法快照（哈希不变）且拒绝非行为库。
// 运行：node scripts/run-tests.mjs behavior-scenarios
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

// ---------- 附录 A：buildRuns（纯函数，整数 day index） ----------
console.log("== A 附录 A：runs 日期算术 ==");
const { buildRuns } = require(path.join(ROOT, "electron", "behavior", "query.js"));
{
  const rows = [
    { day: "2025-12-31", engaged: 1 },
    { day: "2026-01-01", engaged: 1 },
  ];
  const r = buildRuns(rows, 1);
  check("跨年连续日桥接为一个 run（整数 day index，不是字符串拼接）", r.length === 1 && r[0].spanDays === 2, { runs: 1, spanDays: 2 }, r);
  check("run 输出 startDay/endDay 字符串", r[0] && r[0].startDay === "2025-12-31" && r[0].endDay === "2026-01-01", ["2025-12-31", "2026-01-01"], [r[0].startDay, r[0].endDay]);

  const rest = buildRuns([
    { day: "2026-01-01", engaged: 1 },
    { day: "2026-01-02", engaged: 0 },
    { day: "2026-01-03", engaged: 1 },
  ], 0);
  check("明确休息日（engaged=0）可桥接", rest.length === 1 && rest[0].engagedDays === 2 && rest[0].gapDays === 1, { runs: 1, engaged: 2, gap: 1 }, rest);

  const unknown = buildRuns([
    { day: "2026-01-01", engaged: 1 },
    { day: "2026-01-03", engaged: 1 },
  ], 0);
  check("未知日（无行）不能当休息日 → 两段 run", unknown.length === 2, 2, unknown.length);

  check("byDay 用整数键：unknown 阻断后日期输出正确", unknown[0].endDay === "2026-01-01" && unknown[1].startDay === "2026-01-03", ["2026-01-01", "2026-01-03"], [unknown[0].endDay, unknown[1].startDay]);

  const idx = (day) => Date.UTC(...day.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) / 86400000;
  const openToday = buildRuns([{ day: "2026-01-03", engaged: 1 }], idx("2026-01-03"));
  check("run 结束于今天 → isOpen=true（不是预测）", openToday[0].isOpen === true, true, openToday[0] && openToday[0].isOpen);
  const closedOld = buildRuns([{ day: "2026-01-03", engaged: 1 }], idx("2026-01-06"));
  check("run 结束于 today-3、grace=1 → isOpen=false", closedOld[0].isOpen === false, false, closedOld[0] && closedOld[0].isOpen);
  const unknownTail = buildRuns([{ day: "2026-01-01", engaged: 1 }], idx("2026-01-05"), 3);
  check("尾部未知日让 isOpen=false（不把 unknown 当休息日）", unknownTail[0].isOpen === false, false, unknownTail[0] && unknownTail[0].isOpen);
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-scenarios-"));
  app.setPath("userData", dir);
  const db = require(path.join(ROOT, "electron", "db.js"));
  const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
  const { createRollup } = require(path.join(ROOT, "electron", "behavior", "rollup.js"));
  await db.initDb();
  behaviorDb.configure({ dataDir: dir });
  await behaviorDb.open();
  const bdb = behaviorDb.getDb();
  const roll = createRollup({ db: bdb, pull: db.bdiPull, now: () => Date.now(), cutoffHour: () => 4 });

  const DAYS = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
  const EV_TYPES = ["library.opened", "extract.created", "browse.queried", "dict.lookup", "ai.invoked", "reader.finished", "card.created"];
  const EV_PROPS = {
    "library.opened": { from: "shelf", to: "reader" },
    "extract.created": { via: "selection" },
    "browse.queried": { scope: "all" },
    "dict.lookup": { via: "selection" },
    "ai.invoked": { feature: "explain", outcome: "ok" },
    "reader.finished": { progressPct: 100 },
    "card.created": { generatedBy: "manual" },
  };
  const ORIGINS = ["self", "pushed", "unknown"];
  const SURFACES = ["read", "review", "browse", "other"];

  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const snapAll = () => JSON.stringify({
    dm: bdb.prepare("SELECT day, metric, dim_type, dim_value, n, sum, quality, rv FROM daily_metrics ORDER BY day, metric, dim_type, dim_value").all(),
    dd: bdb.prepare("SELECT * FROM domain_day ORDER BY day, udc, level").all(),
    id: bdb.prepare("SELECT * FROM item_day ORDER BY day, library_item_id").all(),
    sd: bdb.prepare("SELECT * FROM signal_daily ORDER BY day, signal_id, udc").all(),
  });
  const resetAll = () => bdb.transaction(() => {
    for (const t of ["events", "attn_spans", "entity_domains", "dirty_days", "daily_metrics", "domain_day", "item_day", "signal_daily"]) {
      bdb.prepare(`DELETE FROM ${t}`).run();
    }
    bdb.prepare("DELETE FROM bdi_meta WHERE key IN ('rollup_seq_watermark','rollup_attn_watermark','derive_version')").run();
  })();
  const markDirty = (days) => {
    const ins = bdb.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, 'scenario')");
    for (const d of days) ins.run(d);
  };

  console.log("== B 属性：随机数据上增量 = 全量重建（三次种子） ==");
  let dbSnapFile = null;
  for (let seed = 1; seed <= 3; seed++) {
    resetAll();
    const rnd = mulberry32(seed);
    const dataDays = DAYS.filter((_, i) => i !== (seed % DAYS.length));
    const emptyDay = DAYS[seed % DAYS.length];

    bdb.prepare(`INSERT INTO entity_domains (entity_type, entity_id, udc_json, udc_main, lang, method, quality, attribution_version, resolved_at, stale)
      VALUES ('card', 'cA', '[{"code":"51","level":"leaf","w":0.6},{"code":"57","level":"leaf","w":0.4}]', '51', NULL, 'card_domain', 'ok', 1, 0, 0)`).run();
    bdb.prepare(`INSERT INTO entity_domains (entity_type, entity_id, udc_json, udc_main, lang, method, quality, attribution_version, resolved_at, stale)
      VALUES ('card', 'cB', '[{"code":"72","level":"leaf","w":1}]', '72', NULL, 'card_domain', 'ok', 1, 0, 0)`).run();
    bdb.prepare(`INSERT INTO entity_domains (entity_type, entity_id, udc_json, udc_main, lang, method, quality, attribution_version, resolved_at, stale)
      VALUES ('library_item', 'i1', '[{"code":"51","level":"leaf","w":1}]', '51', NULL, 'item_udc', 'ok', 1, 0, 0)`).run();

    const insEv = bdb.prepare(`INSERT INTO events (uid, ts, recv_ts, day, tz_offset, cutoff_hour, type, src, session_id, card_id, entity_type, entity_id, library_item_id, origin, props)
      VALUES (?,?,?,?,0,4,?,?,?,?,?,?,?,?,?)`);
    const insSpan = bdb.prepare(`INSERT INTO attn_spans (uid, session_id, src, day, start_ts, end_ts, surface, library_item_id, card_id, origin, active_ms, idle_ms, mono_ms, revision, closed, cutoff_hour)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,4)`);
    let n = 0;
    for (const day of dataDays) {
      const ts = Date.parse(`${day}T12:00:00Z`);
      const nEv = 4 + Math.floor(rnd() * 6);
      for (let i = 0; i < nEv; i++) {
        const type = EV_TYPES[Math.floor(rnd() * EV_TYPES.length)];
        const onCard = rnd() < 0.5;
        const cardId = onCard ? (rnd() < 0.5 ? "cA" : rnd() < 0.5 ? "cB" : "cMissing") : null;
        const itemId = rnd() < 0.5 ? "i1" : null;
        n++;
        insEv.run(`s${seed}-e${n}`, ts + n, ts + n, day, type, "main", "sess", cardId, null, null, itemId, ORIGINS[Math.floor(rnd() * ORIGINS.length)], JSON.stringify(EV_PROPS[type]));
      }
      const nSp = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < nSp; i++) {
        const active = 1000 + Math.floor(rnd() * 9000);
        const onCard = rnd() < 0.5;
        n++;
        insSpan.run(`s${seed}-a${n}`, "sess", "main", day, ts + n * 10, ts + n * 10 + active, SURFACES[Math.floor(rnd() * SURFACES.length)],
          rnd() < 0.5 ? "i1" : null, onCard ? "cA" : null, ORIGINS[Math.floor(rnd() * ORIGINS.length)], active, Math.floor(rnd() * 1000), active);
      }
    }
    markDirty(dataDays);
    roll.refreshIncremental();
    const incremental = snapAll();
    check(`种子 ${seed}：增量派生非空`, JSON.parse(incremental).dm.length > 0, ">0", 0);

    bdb.transaction(() => {
      for (const t of ["daily_metrics", "domain_day", "item_day", "signal_daily"]) bdb.prepare(`DELETE FROM ${t}`).run();
      bdb.prepare("DELETE FROM dirty_days").run();
    })();
    markDirty(dataDays);
    roll.refreshIncremental();
    check(`种子 ${seed}：增量 = 清空后全量重建（逐键一致）`, snapAll() === incremental, "一致", "不一致");

    const emptyRows = bdb.prepare("SELECT COUNT(*) AS n FROM daily_metrics WHERE day = ?").get(emptyDay).n
      + bdb.prepare("SELECT COUNT(*) AS n FROM domain_day WHERE day = ?").get(emptyDay).n
      + bdb.prepare("SELECT COUNT(*) AS n FROM item_day WHERE day = ?").get(emptyDay).n;
    check(`种子 ${seed}：无原始数据的日子不产生派生行（不补 0）`, emptyRows === 0, 0, emptyRows);

    if (seed === 3) {
      dbSnapFile = path.join(dir, "behavior-inspect-snapshot.db");
      await behaviorDb.snapshotTo(dbSnapFile);
    }
  }

  console.log("== C bdi-inspect：只读合法快照 ==");
  const { inspectBehaviorDb } = await import(pathToFileURL(path.join(ROOT, "scripts", "bdi-inspect.mjs")).href);
  const hashOf = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const before = hashOf(dbSnapFile);
  const info = inspectBehaviorDb(dbSnapFile);
  const after = hashOf(dbSnapFile);
  check("合法快照：inspect ok 且 quick_check=ok", info.ok === true && info.integrity === "ok", { ok: true, integrity: "ok" }, { ok: info.ok, integrity: info.integrity, code: info.code });
  check("inspect 前后文件哈希不变（零写入）", before === after, before, after);
  check("inspect 行数与快照一致（events/attn_spans）", info.counts && info.counts.events === bdb.prepare("SELECT COUNT(*) AS n FROM events").get().n
    && info.counts.attn_spans === bdb.prepare("SELECT COUNT(*) AS n FROM attn_spans").get().n, "相等", info.counts);
  check("inspect 报 schemaVersion（user_version）", info.schemaVersion === behaviorDb.BDI_SCHEMA_VERSION, behaviorDb.BDI_SCHEMA_VERSION, info.schemaVersion);
  check("inspect 报事件日范围", info.range && /^\d{4}-\d{2}-\d{2}$/.test(String(info.range.firstDay)), "YYYY-MM-DD", info.range);

  const notBdi = path.join(dir, "not-bdi.db");
  const Database = require("better-sqlite3");
  const other = new Database(notBdi);
  other.exec("CREATE TABLE foo (x INTEGER)");
  other.close();
  const rejected = inspectBehaviorDb(notBdi);
  check("拒绝非行为库 SQLite 文件", rejected.ok === false && rejected.code === "not_bdi_db", { ok: false, code: "not_bdi_db" }, rejected);
  const missing = inspectBehaviorDb(path.join(dir, "nope.db"));
  check("不存在的文件返回 not_found（不抛）", missing.ok === false && missing.code === "not_found", "not_found", missing.code);

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-scenarios ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); app.exit(1); });
