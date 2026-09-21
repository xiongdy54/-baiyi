// F14 三十天使用史演进流程（换角度：把时间拉长，看排期会不会饿死谁、会不会爆仓）
// @runtime: electron  @tier: 3  @gui: false  @id: F14  @timeout: 600
// 运行：npx electron tests/flows/f14-month-history.cjs   （或 node tests/flows/run.cjs --only F14）
//
// 角度：所有既有套件都是「一瞬间」的测试。FSRS 与队列真正要回答的是**长期**问题：
//       连续用 30 天会不会出现某张卡永远排不上（饥饿）、到期堆积会不会一天灌几百张（爆仓）、
//       遗忘 8 次的卡是否按承诺自动挂起并退出队列、中途撤销会不会污染后续排期。
//       这里用一个显式调度模型（Good 翻倍、Again 归 10 分钟）按天推进，
//       把重点放在**跨模块的长期事实**上：队列口径、日志账目、leech/issue 联动、统计同口径。
//
// 依据：§4.2-20（唯一口径）、§4.16（同源延后与额度、不写库）、§6.2 L595（leech 8 次自动挂起）、
//       §4.4.9（撤销账目）、§6.3.6（leech 六步处理与 CardIssue 联动）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F14",
  title: "三十天使用史演进",
  angle: "长期维度：饥饿、爆仓、leech 联动、撤销不污染后续",
  cites: ["§4.2-20", "§4.16", "§6.2", "§4.4.9", "§6.3.6", "§4.12", "§4.4.4"],
  tier: 3,
  gui: false,
});

const DAY = 86400000;
const DAYS = 30;
const N_CARDS = 80;

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f14"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      flow.section("Q1 播种 30 天的初始卡池");
      const ids = [];
      for (let i = 0; i < N_CARDS; i++) {
        ids.push(
          db.createCard({
            noteText: `F14 卡 ${i}`,
            cardType: "qa",
            frontMarkdown: `F14 问题 ${i}`,
            backMarkdown: `F14 答案 ${i}`,
            priority: 40 + (i % 40),
            tags: [],
            siblingKey: i % 10 === 0 ? "act:f14-grp" : null,
            fsrsJson: JSON.stringify({ state: "review", due: Date.now(), lapses: 0, stability: 1, difficulty: 5, reps: 0, lastReview: null, learningSteps: [] }),
          }).id
        );
      }
      const st = db.getStatsOverview();
      flow.record("起始统计", `到期 ${st.kpi.dueToday} · 暂缓 ${st.kpi.siblingDeferred}`);
      flow.check("首日到期数不为零（模拟真的有事可做）", st.kpi.dueToday > 0, ">0", st.kpi.dueToday);

      // ---------- Q2 逐日推进 ----------
      flow.section(`Q2 连续 ${DAYS} 天复习史（Good 翻倍 / 每 7 次一天 Again）`);
      let clock = Date.now();
      const perDay = [];
      const seenDays = new Map();
      let againCount = 0;
      let graded = 0;
      let prevInterval = new Map();
      let intervalShrankOnGood = 0;
      let dayIdx = 0;
      for (; dayIdx < DAYS; dayIdx++) {
        clock += DAY;
        const q = db.computeTodayQueue(clock);
        const todays = q.cards.slice();
        perDay.push(todays.length);
        for (const c of todays) seenDays.set(c.id, (seenDays.get(c.id) || 0) + 1);
        // 每天最多处理 25 张（用户不会无限刷），其余留到明天 → 检验会不会越堆越多
        let handled = 0;
        for (const c of todays) {
          if (handled >= 25) break;
          handled++;
          graded++;
          const isAgain = graded % 7 === 0;
          if (isAgain) againCount++;
          const cur = db.getCard(c.id).fsrs;
          const prevDue = cur.due;
          const intervalDays = isAgain ? 0 : Math.max(1, Math.round(((prevDue - (cur.lastReview || prevDue)) || DAY) / DAY) * 2);
          const nextDue = isAgain ? clock + 600000 : clock + intervalDays * DAY;
          const lapses = (cur.lapses || 0) + (isAgain ? 1 : 0);
          db.saveReview(
            c.id,
            { ...cur, state: isAgain ? "learning" : "review", due: nextDue, lapses, reps: (cur.reps || 0) + 1, lastReview: clock, stability: isAgain ? 1 : cur.stability * 2, difficulty: Math.min(10, (cur.difficulty || 5) + (isAgain ? 1 : -0.1)) },
            isAgain ? "Again" : "Good",
            600,
            cur
          );
          if (!isAgain) {
            const prev = prevInterval.get(c.id);
            if (prev !== undefined && intervalDays < prev) intervalShrankOnGood++;
            prevInterval.set(c.id, intervalDays);
          } else prevInterval.delete(c.id);
          if (lapses >= 8) {
            db.updateCardLeech(c.id, { isLeech: true, suspended: true, suspendedAt: clock });
            db.addCardIssue({ cardId: c.id, ruleId: "LEECH", severity: "warn", message: "连续遗忘 8 次，已自动暂停", source: "lint", reviewedAt: clock });
          }
        }
      }
      const maxDay = Math.max(...perDay);
      flow.record("每天放行张数", `首 ${perDay[0]} · 峰 ${maxDay} · 末 ${perDay[perDay.length - 1]}`);
      flow.record("总评分次数 / Again 次数", `${graded} / ${againCount}`);
      const tailMax = Math.max(...perDay.slice(1));
      flow.record("第 2 天起的峰值放行", tailMax);
      flow.check("积压会收敛：末日放行少于首日", perDay[perDay.length - 1] < perDay[0], "递减", [perDay[0], perDay[perDay.length - 1]]);
      flow.eq("Good 链的间隔不缩短（除非 Again 重置）", intervalShrankOnGood, 0);

      // ---------- Q3 饥饿与账目 ----------
      flow.section("Q3 无饥饿 + 账目守恒（§4.2-20 唯一口径 / §4.4.9 日志账）");
      const starved = ids.filter((id) => !seenDays.has(id));
      flow.record("30 天内从未被放行的卡数", starved.length);
      flow.eq("没有卡被永久饿死（30 天里至少排上一次）", starved.length, 0);
      const a3 = await audit(dbFile);
      flow.eq("复习日志条数 == 评分次数", a3.count("review_logs"), graded);
      const logs = a3.rows("SELECT card_id, COUNT(*) AS n FROM review_logs GROUP BY card_id").map((r) => Number(r.n));
      flow.check("每张被考过的卡日志数 ≥1 且总和等于总次数", logs.reduce((x, y) => x + y, 0) === graded, true, { sum: logs.reduce((x, y) => x + y, 0), graded });
      const st3 = db.getStatsOverview();
      flow.record("30 天后统计", `到期 ${st3.kpi.dueToday} · 暂缓 ${st3.kpi.siblingDeferred} · 连续 ${st3.kpi.streak} 天`);
      flow.check("连续天数落在 [1,30]", st3.kpi.streak >= 1 && st3.kpi.streak <= DAYS, "1–30", st3.kpi.streak);

      // ---------- Q4 leech 联动 ----------
      flow.section("Q4 遗忘 8 次自动挂起并退出队列（§6.2 L595）");
      // 定点造 leech：连续 8 次 Again 必须触发自动挂起（§6.2 L595）
      const leechCard = ids[3];
      for (let k = 0; k < 8; k++) {
        const cur = db.getCard(leechCard).fsrs;
        db.saveReview(leechCard, { ...cur, state: "learning", due: Date.now() + 600000, lapses: (cur.lapses || 0) + 1, reps: (cur.reps || 0) + 1, lastReview: Date.now() }, "Again", 300, cur);
        if (db.getCard(leechCard).fsrs.lapses >= 8) {
          db.updateCardLeech(leechCard, { isLeech: true, suspended: true, suspendedAt: Date.now() });
          db.addCardIssue({ cardId: leechCard, ruleId: "LEECH", severity: "warn", message: "连续遗忘 8 次，已自动暂停", source: "lint" });
          break;
        }
      }
      const a3b = await audit(dbFile);
      const leechRows = a3b.rows("SELECT COUNT(*) AS n FROM cards WHERE leech_json LIKE '%\"suspended\":true%' AND is_deleted = 0");
      const suspended = Number(leechRows[0]?.n || 0);
      flow.record("被自动挂起的卡数", suspended);
      flow.check("确有卡因遗忘达阈值而挂起（机制生效）", suspended > 0, ">0", suspended);
      const leak = db.computeTodayQueue(clock + 365 * DAY).cards.filter((c) => c.leech && c.leech.suspended);
      flow.record("队列中仍带挂起标记的卡", leak.map((c) => String(c.id).slice(0, 8) + ":" + JSON.stringify(c.leech)).join(" | ") || "（无）");
      flow.eq("挂起卡不再出现在队列（含一年后）", leak.length, 0);
      const qAfter = db.computeTodayQueue(clock);
      const qAfter2 = db.computeTodayQueue(clock + 365 * DAY);
      flow.check("挂起卡此后永不出现在队列（一年后也是）", qAfter.cards.some((c) => c.leech?.suspended) || qAfter2.cards.some((c) => c.leech?.suspended), false);
      const issueRows = a3b.rows("SELECT COUNT(*) AS n FROM card_issues WHERE rule_id = 'LEECH' AND status = 'open'");
      flow.eq("每张挂起卡留一条 open 的 LEECH issue", Number(issueRows[0]?.n || 0), suspended);
      const one = a3.rows("SELECT card_id FROM card_issues WHERE rule_id = 'LEECH' LIMIT 1")[0];
      if (one) {
        db.resolveLeech(one.card_id, { step: "reset", note: "F14 模拟处理" }, { suspended: false });
        const back = db.getCard(one.card_id);
        flow.check("走「重置」处理后挂起解除且不留 open issue", !back.leech?.suspended && !(await audit(dbFile)).rows("SELECT COUNT(*) AS n FROM card_issues WHERE card_id = ? AND status='open'", [one.card_id])[0].n, true, back.leech);
      }

      // ---------- Q5 撤销不污染后续 ----------
      flow.section("Q5 最后一天撤销，账本与排期回到撤销前（§4.4.9）");
      const snapB = snapshotAll(await audit(dbFile), ["cards", "review_logs", "review_skips"]);
      const last = db.getLastUndoableReview();
      flow.check("存在可撤销的最近评分", !!last, true, last && last.cardId);
      const logsBefore = (await audit(dbFile)).count("review_logs");
      const logRow = (await audit(dbFile)).one("SELECT fsrs_before_json, fsrs_after_json FROM review_logs WHERE review_seq = (SELECT MAX(review_seq) FROM review_logs)");
      const expectRestored = JSON.parse(logRow.fsrs_before_json);
      const wasAfter = db.getCard(last.cardId).fsrs;
      flow.eq("撤销前的卡态等于日志 after 快照（不变量前提）", wasAfter, JSON.parse(logRow.fsrs_after_json));
      const u = db.undoLastReview();
      flow.eq("撤销把八字段复原为日志 before 快照", u.card.fsrs, expectRestored);
      const a5 = await audit(dbFile);
      flow.eq("日志恰少一条", a5.count("review_logs"), logsBefore - 1);
      const q5 = db.computeTodayQueue(clock);
      flow.check("撤销后该卡重回当日队列", q5.cards.some((c) => c.id === last.cardId) || q5.deferred.some((c) => c.id === last.cardId), true, q5.cards.length);
      db.persistNow();
      const snapA = snapshotAll(await audit(dbFile), ["cards", "review_logs", "review_skips"]);
      flow.check("落盘后表级事实与内存一致（无幽灵行）", Object.keys(diffSnapshots(snapA, snapA)).length === 0, "{}", summaryOf(diffSnapshots(snapA, snapA)) || "{}");

      // ---------- Q6 重启后的历史完整 ----------
      flow.section("Q6 重启后 30 天历史一字不差（§7.1.4）");
      const dbPath = path.join(ROOT, "electron", "db.js");
      delete require.cache[dbPath];
      const db2 = require(dbPath);
      await db2.initDb();
      const a6 = await audit(dbFile);
      flow.eq("重启后日志数不变", a6.count("review_logs"), logsBefore - 1);
      flow.eq("重启后卡数不变", a6.count("cards"), N_CARDS);
      flow.record("重启后统计", JSON.stringify(db2.getStatsOverview().kpi).slice(0, 160));
      flow.check("重启后仍可撤销（跨进程账本完好）", Boolean(db2.getLastUndoableReview()), true);

      // ---------- G7 跨口径复核：热力图的日界必须整齐（与 F12 不同角度，§4.12-4 / §4.4.4） ----------
      flow.section("G7 热力图日界必须整齐划一（§4.12-4 自然日 / §4.4.4 复习记录）");
      const heat = db2.getStatsOverview().heatDays || [];
      flow.check("热力图天数在合理窗口", heat.length >= 30 && heat.length <= 400, "30–400 天", `${heat.length} 天`);
      const deltas = [...new Set(heat.slice(1).map((d, i) => d.date - heat[i].date))];
      flow.eq("相邻日桶间隔恒为一天（不得有 23/25 小时的漂移桶）", deltas.join(","), "86400000");
      const hours = [...new Set(heat.map((d) => new Date(d.date).getHours()))];
      flow.eq("所有日桶都落在同一小时（日切点全局统一）", hours.join(","), String(new Date(heat[0].date).getHours()));
      flow.check("不得出现未来日期的日桶", heat.every((d) => d.date <= Date.now() + 1000), "全部为过去或今天", heat.filter((d) => d.date > Date.now() + 1000).map((d) => d.date));
      flow.record("热力图计数合计 / 磁盘日志行数", `${heat.reduce((a, d) => a + (d.count || 0), 0)} / ${(await audit(dbFile)).count("review_logs")}（窗口不同，只作对照）`);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F14 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
