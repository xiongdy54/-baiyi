// @runtime: electron
// D248 / T11：review.rated ↔ review_logs 窗口匹配——单候选 matched / 多候选 ambiguous / 无候选 missing；
//   撤销后不计数（基础评分数不因上下文缺失而少计）（§7.1 / V1-1）。
// 运行：npx electron tests/behavior-review-match.test.cjs（或 node scripts/run-tests.mjs behavior-review-match）
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-rmatch-"));
  app.setPath("userData", dir);
  const db = require(path.join(ROOT, "electron", "db.js"));
  const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
  const { createQuery } = require(path.join(ROOT, "electron", "behavior", "query.js"));
  await db.initDb();
  behaviorDb.configure({ dataDir: dir });
  await behaviorDb.open();
  const bdb = behaviorDb.getDb();

  const card = db.createCard({ noteText: "BDI-RM", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50 });
  const card2 = db.createCard({ noteText: "BDI-RM2", cardType: "qa", frontMarkdown: "问2", backMarkdown: "答2", priority: 50 });
  const insEv = bdb.prepare(`INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id,card_id,props)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const day = "2026-10-28";
  const q = createQuery({ db: bdb, pull: db.bdiPull, now: () => Date.now(), todayDay: () => day });

  console.log("== A matched：一次评分 + 一条日志 ==");
  const t = Date.now() - 5000;
  db.saveReview(card.id, { state: "Review", due: t + 86400000, lapses: 0, reps: 1, lastReview: t, stability: 2, difficulty: 5, learningSteps: [] }, "good", 1200, null);
  const log = db.bdiPull({ table: "review_logs", mode: "ids", ids: [card.id], limit: 50 });
  void log;
  // 从主库取刚写入的 reviewed_at
  const allLogs = db.bdiPull({ table: "review_logs", mode: "time", cursor: { ts: 0, rowid: 0 }, limit: 500 });
  const myLog = allLogs.find((r) => r.card_id === card.id);
  check("主库确有该评分日志", !!myLog, "存在", allLogs.length);
  insEv.run("ev1", myLog.reviewed_at, myLog.reviewed_at, day, -480, 4, "review.rated", "main", "s1", card.id, JSON.stringify({ tapStartTs: 10, tapEndTs: 20, tapSeq: 1, durationMs: 1200 }));
  const r1 = q.queries.reviewContext({ cardId: card.id, from: "2000-01-01", to: "2099-01-01" });
  check("单候选 → matched 且给 reviewLogId", r1.rows.length === 1 && r1.rows[0].status === "matched" && r1.rows[0].reviewLogId === myLog.id, "matched", r1.rows);
  check("基础评分数不受上下文影响（baseReviewCount=1）", r1.baseReviewCount === 1, 1, r1.baseReviewCount);

  console.log("== B ambiguous：窗口内两条日志 ==");
  // 再写一条同卡评分（reviewed_at 与上一条同毫秒附近），并把第二条的 tap 窗口覆盖两条
  const t2 = Date.now();
  const before2 = db.getCard(card.id).fsrs;
  db.saveReview(card.id, { state: "Review", due: t2 + 86400000, lapses: 0, reps: 2, lastReview: t2, stability: 2, difficulty: 5, learningSteps: [] }, "again", 1200, before2);
  const logs2 = db.bdiPull({ table: "review_logs", mode: "time", cursor: { ts: 0, rowid: 0 }, limit: 500 }).filter((r) => r.card_id === card.id);
  insEv.run("ev2", t2, t2, day, -480, 4, "review.rated", "main", "s1", card.id, JSON.stringify({ tapStartTs: 30, tapEndTs: 40, tapSeq: 2, durationMs: 60000 }));
  const r2 = q.queries.reviewContext({ cardId: card.id, from: "2000-01-01", to: "2099-01-01" });
  const amb = r2.rows.find((x) => x.tapEventUid === "ev2") || r2.rows[r2.rows.length - 1];
  check("窗口覆盖两条日志 → ambiguous（不猜）", amb && amb.status === "ambiguous" && amb.candidates.length === 2, "ambiguous", amb);

  console.log("== C missing：撤销后日志被物理删除 ==");
  const undo = db.undoLastReview();
  void undo;
  const r3 = q.queries.reviewContext({ cardId: card.id, from: "2000-01-01", to: "2099-01-01" });
  check("撤销后基础评分数按真源减少（2→1，不补造）", r3.baseReviewCount === 1, 1, r3.baseReviewCount);
  check("撤销后的评分事件不再指向已删除的日志", !r3.rows.some((x) => x.status === "matched" && x.reviewLogId === logs2[logs2.length - 1].id), "不指向已删日志", r3.rows);

  console.log("== D 不跨卡串日志 ==");
  const t3 = Date.now() + 1000;
  insEv.run("ev3", t3, t3, day, -480, 4, "review.rated", "main", "s1", card2.id, JSON.stringify({ tapStartTs: 50, tapEndTs: 60, tapSeq: 3, durationMs: 1000 }));
  const r4 = q.queries.reviewContext({ cardId: card2.id, from: "2000-01-01", to: "2099-01-01" });
  check("另一张卡无日志 → missing（不拿别人的行凑数）", r4.rows.length === 1 && r4.rows[0].status === "missing", "missing", r4.rows);

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-review-match ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); app.exit(1); });
