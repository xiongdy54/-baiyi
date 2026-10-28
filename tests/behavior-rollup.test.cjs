// @runtime: electron
// D248 / T11：派生层——增量=全量、两次结果相同、多领域权重拆分 sum、问号日不补 0、DERIVE_VERSION 重建。
// 运行：npx electron tests/behavior-rollup.test.cjs（或 node scripts/run-tests.mjs behavior-rollup）
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-rollup-"));
  app.setPath("userData", dir);
  const db = require(path.join(ROOT, "electron", "db.js"));
  const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
  const { createRollup } = require(path.join(ROOT, "electron", "behavior", "rollup.js"));
  const fsrsTime = require(path.join(ROOT, "electron", "fsrsTime.js"));
  await db.initDb();
  behaviorDb.configure({ dataDir: dir });
  await behaviorDb.open();
  const bdb = behaviorDb.getDb();

  const now = Date.now();
  const day = (() => {
    const d = new Date(fsrsTime.learningDayStartMs(now, 4));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  console.log("== A 造数据（多领域权重 + 事件 + 评分） ==");
  const card = db.createCard({ noteText: "BDI11", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50, domain: ["51"] });
  const store = bdb.prepare(`INSERT INTO entity_domains (entity_type, entity_id, udc_json, udc_main, lang, method, quality, attribution_version, resolved_at, stale)
    VALUES ('card', ?, ?, '51', NULL, 'card_domain', 'ok', 1, ?, 0)`);
  store.run(card.id, JSON.stringify([{ code: "51", level: "leaf", w: 0.6 }, { code: "57", level: "leaf", w: 0.4 }]), now);
  const insEv = bdb.prepare(`INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id,card_id,origin,props)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insEv.run("r1", now, now, day, -480, 4, "nav.view", "host", "s1", null, "shelf", JSON.stringify({ from: "shelf", to: "reader" }));
  insEv.run("r2", now, now, day, -480, 4, "extract.created", "main", "s1", card.id, null, JSON.stringify({ via: "selection" }));
  const insSpan = bdb.prepare(`INSERT INTO attn_spans (uid,session_id,src,day,start_ts,end_ts,surface,active_ms,idle_ms,mono_ms,revision,closed,cutoff_hour,card_id,origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insSpan.run("s1", "sess", "main", day, now - 2000, now - 1000, "read", 1000, 0, 1000, 1, 1, 4, card.id, "shelf");
  insSpan.run("s2", "sess", "main", day, now - 1000, now, "read", 1000, 0, 1000, 1, 1, 4, card.id, "queue");
  db.saveReview(card.id, { state: "Review", due: now + 86400000, lapses: 0, reps: 1, lastReview: now, stability: 2, difficulty: 5, learningSteps: [] }, "good", 1000, null);

  const roll = createRollup({ db: bdb, pull: db.bdiPull, now: () => now, cutoffHour: () => 4 });
  const snap = () => JSON.stringify({
    dm: bdb.prepare("SELECT metric, dim_type, dim_value, n, sum FROM daily_metrics WHERE day = ? ORDER BY metric, dim_type, dim_value").all(day),
    dd: bdb.prepare("SELECT udc, level, active_ms, self_ms, pushed_ms, n_reviews, n_extracts FROM domain_day WHERE day = ? ORDER BY udc").all(day),
    sd: bdb.prepare("SELECT signal_id, udc, value FROM signal_daily WHERE day = ? ORDER BY signal_id, udc").all(day),
  });

  console.log("== B 首轮：多领域拆分与事件计数 ==");
  roll.refreshIncremental();
  const dd = bdb.prepare("SELECT * FROM domain_day WHERE day = ? ORDER BY udc").all(day);
  const split = (udc) => dd.find((r) => r.udc === udc);
  check("领域拆分：51 active=1200（0.6×2000）", split("51") && split("51").active_ms === 1200, 1200, split("51") && split("51").active_ms);
  check("领域拆分：57 active=800（0.4×2000）", split("57") && split("57").active_ms === 800, 800, split("57") && split("57").active_ms);
  check("多领域拆分之和 = 总 active（float 容差）", Math.abs(split("51").active_ms + split("57").active_ms - 2000) < 1e-6, 2000, split("51").active_ms + split("57").active_ms);
  check("self/pushed 分桶按来源加权（51：self 600 / pushed 600）", split("51").self_ms === 600 && split("51").pushed_ms === 600, { self: 600, pushed: 600 }, { self: split("51").self_ms, pushed: split("51").pushed_ms });
  const evm = bdb.prepare("SELECT n FROM daily_metrics WHERE day=? AND metric='ev:nav.view' AND dim_type='all'").get(day);
  check("事件计数 ev:nav.view = 1", evm && evm.n === 1, 1, evm);
  const rv = bdb.prepare("SELECT n_reviews FROM domain_day WHERE day=? AND udc='51'").get(day);
  check("评分数只计主领域（51: 1）", rv && rv.n_reviews === 1, 1, rv);
  check("answer_ms 按权重拆分（51=600）", split("51").answer_ms === 600, 600, split("51").answer_ms);
  check("deliberate_production 记录（extract 1 + card? ≥1）", bdb.prepare("SELECT sum FROM daily_metrics WHERE day=? AND metric='deliberate_production'").get(day).sum >= 1, ">=1", null);

  console.log("== C 两次运行结果相同（幂等） ==");
  const first = snap();
  roll.refreshIncremental();
  check("第二次刷新逐字段相同", snap() === first, "一致", "漂移");

  console.log("== D 增量 == 全量重建（非归档日） ==");
  bdb.transaction(() => {
    bdb.prepare("DELETE FROM daily_metrics").run();
    bdb.prepare("DELETE FROM domain_day").run();
    bdb.prepare("DELETE FROM item_day").run();
    bdb.prepare("DELETE FROM signal_daily").run();
    bdb.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, 'test')").run(day);
  })();
  roll.refreshIncremental();
  check("增量结果 = 清空后重建（逐键一致）", snap() === first, "一致", "不一致");

  console.log("== E DERIVE_VERSION 变化触发重建 ==");
  const roll2 = createRollup({ db: bdb, pull: db.bdiPull, now: () => now, cutoffHour: () => 4, deriveVersion: 2 });
  const rebuilt = roll2.ensureDeriveVersion();
  check("版本不同 → 清空非归档并标 dirty", rebuilt === true, true, rebuilt);
  roll2.refreshIncremental();
  const rv2 = bdb.prepare("SELECT DISTINCT rv FROM daily_metrics WHERE day=?").all(day);
  check("重建后派生行 rv=2", rv2.length === 1 && rv2[0].rv === 2, 2, rv2);

  console.log("== F 问号日不补 0 ==");
  const emptyDay = "2020-01-01";
  const zero = bdb.prepare("SELECT COUNT(*) AS n FROM daily_metrics WHERE day=?").get(emptyDay).n;
  check("无原始数据的日期不产生派生行", zero === 0, 0, zero);

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-rollup ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); app.exit(1); });
