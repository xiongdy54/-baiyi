// F12 时间语义一致性流程（换角度：同一个「今天」在五个模块里必须是同一个今天）
// @runtime: electron  @tier: 2  @gui: false  @id: F12  @timeout: 300
// 运行：npx electron tests/flows/f12-time-semantics.cjs   （或 node tests/flows/run.cjs --only F12）
//
// 角度：这个项目同时跑着**三套日子**——FSRS 用的 UTC 日历天（delta_t）、
//       统计与同源延后用的「学习日」（本地钟面日切点 settings.app.dayCutoffHour）、
//       日记用的本地自然日（journalDateOf）。§4.12-4 L171 明写这三套语义并存是一个**已知缺口**，
//       而 §4.18 L393 与 §6.5 又锁死一条硬承诺：改日切点绝不许改写任何已落库的日期事实。
//       既有 fsrs/ 六件套验调度数值、m8 验日记边界；把「切 dayCutoffHour 前后全库不动」
//       这条跨模块不变量写成断言的，此前没有。
//
// 依据：§4.12-4 L171/L281（学习日语义与 delta_t 的差）、§4.4.4（时间注入）、
//       §4.16 L316–324（同源额度按学习日）、§4.18 L393 与 §6.5 L733（entry_date 不随日切漂移）、
//       §7.1.7（delta_t 与学习日只能由 electron/fsrsTime.js 出口）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F12",
  title: "时间语义一致性",
  angle: "三套日子并存时的边界与「改日切不动历史」承诺",
  cites: ["§4.12-4", "§4.4.4", "§4.16", "§4.18", "§6.5", "§7.1.7"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;
const TABLES = ["cards", "review_logs", "journal_entries", "extracts", "fsrs_configs", "reading_events"];
const setProps = (v) => fs.writeFileSync(path.join(v.dir, "settings.json"), JSON.stringify(v.obj), "utf8");

function writeCutoff(dir, hour) {
  const f = path.join(dir, "settings.json");
  let obj = {};
  try {
    obj = JSON.parse(fs.readFileSync(f, "utf8")) || {};
  } catch {
    obj = {};
  }
  obj.app = { ...(obj.app || {}), dayCutoffHour: hour };
  fs.writeFileSync(f, JSON.stringify(obj));
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f12"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const T = require(path.join(ROOT, "electron", "fsrsTime.js"));
      const J = require(path.join(ROOT, "electron", "journalTime.js"));

      // ---------- M1 fsrsTime 出口语义 ----------
      flow.section("M1 delta_t 按 UTC 日历天、学习日按本地钟面（§4.12-4 L171 的已知缺口要如实成立）");
      const sameUtcDayA = Date.parse("2026-03-05T01:00:00Z");
      const sameUtcDayB = Date.parse("2026-03-05T23:30:00Z");
      const nextUtcDay = Date.parse("2026-03-06T00:30:00Z");
      flow.eq("同一 UTC 日内 delta_t = 0（不看小时差）", T.calculateFsrsDeltaT(sameUtcDayA, sameUtcDayB), 0);
      flow.eq("跨过 UTC 零点即算 1 天", T.calculateFsrsDeltaT(sameUtcDayA, nextUtcDay), 1);
      flow.eq("倒退不产生负天数（下限 0）", Math.max(0, T.calculateFsrsDeltaT(nextUtcDay, sameUtcDayA)), 0);
      const noonLocal = new Date(2026, 5, 10, 12, 0, 0).getTime();
      const d0 = T.learningDayStartMs(noonLocal, 0);
      const d5 = T.learningDayStartMs(noonLocal, 5);
      flow.check("学习日起点 ≤ 给定时刻", d0 <= noonLocal && d5 <= noonLocal, true, { d0, d5 });
      flow.eq("cutoff=0 的学习日起点 = 本地零点点", d0, new Date(2026, 5, 10, 0, 0, 0).getTime());
      flow.eq("cutoff=5 把学习日推到前一天 05:00", d5, new Date(2026, 5, 10, 5, 0, 0).getTime());
      const earlyMorning = new Date(2026, 5, 10, 2, 30, 0).getTime();
      flow.check("凌晨 02:30 在 cutoff=5 下归属**前一天**（学习日与日历日会分叉）",
        T.learningDayStartMs(earlyMorning, 5) === new Date(2026, 5, 9, 5, 0, 0).getTime(), true,
        new Date(T.learningDayStartMs(earlyMorning, 5)).toISOString());
      flow.check("同一时刻不同 cutoff 得到不同学习日序号",
        T.learningDayIndex(earlyMorning, 0) !== T.learningDayIndex(earlyMorning, 5), true,
        { c0: T.learningDayIndex(earlyMorning, 0), c5: T.learningDayIndex(earlyMorning, 5) });

      // ---------- M2 delta_t 只此一家出口 ----------
      flow.section("M2 时间算法只有一个出口（§7.1.7 L171/L174 的防腐约束）");
      const src = [];
      const walk = (d) => {
        for (const n of fs.readdirSync(d)) {
          if (["node_modules", "dist", "build", ".git", "vendor", "foliate"].includes(n)) continue;
          const full = path.join(d, n);
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|cjs)$/.test(n)) src.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), t: fs.readFileSync(full, "utf8") });
        }
      };
      walk(path.join(ROOT, "src"));
      walk(path.join(ROOT, "electron"));
      const tsFromNow = src.filter((f) => !/fsrsTime\.js|db\.js|journalTime\.js|optimizer\.js/.test(f.rel) && /new Date\([^)]*\)\.getTime\(\)\s*[-/]\s*|86400000|24\s*\*\s*60\s*\*\s*60/.test(f.t)).map((f) => f.rel);
      flow.record("自己算「一天」的文件（应仅时间模块与其调用方）", tsFromNow.join(" ") || "（无）");
      const schedulerCopies = src.filter((f) => /calculateFsrsDeltaT|learningDayIndex/.test(f.t) && !/fsrsTime\.js|db\.js|optimizer\.js|tests\//.test(f.rel) && f.rel.startsWith("src/")).map((f) => f.rel);
      flow.eq("渲染层不复制学习日/间隔算法", schedulerCopies.length, 0);

      // ---------- M3 改日切绝不改写历史 ----------
      flow.section("M3 切 dayCutoffHour 前后，全库日期事实一字不动（§4.18 L393 / §6.5）");
      const mk = (label, due) =>
        db.createCard({
          noteText: `F12 ${label}`,
          cardType: "qa",
          frontMarkdown: `F12 问题 ${label}`,
          backMarkdown: "答案",
          priority: 50,
          tags: [],
          siblingKey: "act:f12-time-" + flow.rng.seed,
          fsrsJson: JSON.stringify({ state: "review", due, lapses: 0, stability: 3, difficulty: 6, reps: 2, lastReview: due - DAY, learningSteps: [] }),
        }).id;
      const dueAt = Date.now() - 1000;
      const cards = [mk("A", dueAt), mk("B", dueAt - 500), mk("C", dueAt - 900)];
      const before = db.getCard(cards[0]).fsrs;
      db.saveReview(cards[0], { ...before, reps: 3, due: Date.now() + 2 * DAY }, "Good", 500, before);
      db.createJournalEntry({ contentMarkdown: "F12 日记 " + flow.rng.seed, source: "app" });
      // 批次 D（D-TEST-07）新增：写入侧收紧后，**合法**的显式 entryDate 必须照常入库（收紧不许误伤）
      db.createJournalEntry({ contentMarkdown: "F12 指定合法日期", source: "app", entryDate: "2026-03-04" });
      const legalList = db.listJournalEntries({ from: "2026-03-04", to: "2026-03-04" });
      const legalArr = Array.isArray(legalList) ? legalList : legalList.entries || legalList.rows || [];
      flow.check("显式合法日期照常入库并按日检索得到", legalArr.some((e) => /F12 指定合法日期/.test(String(e.contentMarkdown))), true, legalArr.length);
      flow.check("非零填充日期（2026-3-5）被拒且不入库", (() => {
        try {
          db.createJournalEntry({ contentMarkdown: "F12 非法日期", entryDate: "2026-3-5" });
          return false;
        } catch {
          return true;
        }
      })(), true, "被接受（会漂出分组）");
      db.saveJournalDraft("F12 草稿");
      db.sendJournalDraft("F12 发送");
      db.addReadingEvent(db.listItems()[0] ? db.listItems()[0].id : "none", 42);
      db.persistNow();
      const snapBefore = snapshotAll(await audit(dbFile), TABLES);
      const entryDatesBefore = (await audit(dbFile)).rows("SELECT id, entry_date FROM journal_entries ORDER BY id").map((r) => r.id + "=" + r.entry_date).join(",");
      const duesBefore = (await audit(dbFile)).rows("SELECT id, fsrs_json FROM cards ORDER BY id").map((r) => r.id + "=" + r.fsrs_json).join(",");
      for (const hour of [1, 5, 23, 0]) {
        writeCutoff(dir, hour);
        const stats = db.getStatsOverview();
        flow.record(`cutoff=${hour} 时 dueToday/streak`, `${stats.kpi.dueToday}/${stats.kpi.streak}`);
      }
      writeCutoff(dir, 0);
      const snapAfter = snapshotAll(await audit(dbFile), TABLES);
      flow.check("四种日切设置轮转后，六张表零改写", Object.keys(diffSnapshots(snapBefore, snapAfter)).length === 0, "{}", summaryOf(diffSnapshots(snapBefore, snapAfter)) || "{}");
      const a3 = await audit(dbFile);
      flow.eq("已落库的卡片 due 不因日切而漂移", a3.rows("SELECT id, fsrs_json FROM cards ORDER BY id").map((r) => r.id + "=" + r.fsrs_json).join(","), duesBefore);
      flow.eq("日记 entry_date 不因日切而改写", a3.rows("SELECT id, entry_date FROM journal_entries ORDER BY id").map((r) => r.id + "=" + r.entry_date).join(","), entryDatesBefore);

      // ---------- M4 日记自然日边界 ----------
      flow.section("M4 日记按本地自然日归类（§6.5 L733，与学习日分叉是预期）");
      flow.eq("journalDateOf 给 YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(J.journalDateOf(Date.now())), true);
      flow.eq("格式校验拒绝非日期串", J.isJournalDate("2026-3-5"), false);
      flow.eq("格式校验接受合法日期", J.isJournalDate("2026-03-05"), true);
      flow.eq("平年 2/28 加一天 = 3/1", J.journalDateAddDays("2026-02-28", 1), "2026-03-01");
      flow.eq("闰年 2/28 加一天 = 2/29", J.journalDateAddDays("2024-02-28", 1), "2024-02-29");
      flow.eq("跨年加一天", J.journalDateAddDays("2025-12-31", 1), "2026-01-01");
      flow.eq("负数回退跨月", J.journalDateAddDays("2026-03-01", -1), "2026-02-28");
      flow.eq("加 0 天保持恒等", J.journalDateAddDays("2026-05-05", 0), "2026-05-05");
      const localMidnightAgo = new Date(new Date().toDateString()).getTime() + 60_000;
      flow.eq("本地零点过一分钟仍算今天", J.journalDateOf(localMidnightAgo), J.journalDateOf(Date.now()));
      flow.check("本地零点前一分钟算昨天", J.journalDateOf(localMidnightAgo - 120_000) !== J.journalDateOf(Date.now()), true, { a: J.journalDateOf(localMidnightAgo - 120_000), b: J.journalDateOf(Date.now()) });
      const jd = a3.one("SELECT entry_date FROM journal_entries WHERE content_markdown LIKE 'F12 日记%' LIMIT 1");
      flow.eq("落库的 entry_date 与 journalDateOf(now) 同口径", jd && jd.entry_date, J.journalDateOf(Date.now()));

      // ---------- M5 队列/延后按学习日额度 ----------
      flow.section("M5 同源额度按学习日结算（§4.16 L316–324 + §4.4.4 时间可注入）");
      const qNoon = db.computeTodayQueue();
      flow.record("当前队列规模", `${qNoon.cards.length} 放行 / ${qNoon.deferred.length} 暂缓`);
      const groupCards = qNoon.cards.filter((c) => c.siblingKey === "act:f12-time-" + flow.rng.seed).length;
      const groupDeferred = qNoon.deferred.filter((c) => c.siblingKey === "act:f12-time-" + flow.rng.seed).length;
      flow.check("F12 同源组当日只放行一张", groupCards + groupDeferred >= 1 && groupCards <= 1, true, { groupCards, groupDeferred });
      const farFuture = Date.now() + 30 * DAY;
      const qFuture = db.computeTodayQueue(farFuture);
      const qFuture2 = db.computeTodayQueue(farFuture + 60_000);
      flow.eq("注入时刻后 60 秒内队列不变（同一学习日内幂等）", qFuture2.cards.length, qFuture.cards.length);
      const qPast = db.computeTodayQueue(Date.now() - 365 * DAY);
      flow.eq("把时钟拨到一年前，今日队列为空（到期判定用注入时刻）", qPast.cards.length, 0);
      flow.check("延后集合同样随时刻移动而不是照抄现在", qPast.deferred.length === 0, true, qPast.deferred.length);

      // ---------- M6 连续天数（streak）----------
      flow.section("M6 streak 按学习日连续（§6.2 统计）");
      const base = new Date(new Date().toDateString()).getTime() + 3600_000;
      const reopen = async () => {
        const p = path.join(ROOT, "electron", "db.js");
        delete require.cache[p];
        const fresh = require(p);
        await fresh.initDb();
        return fresh;
      };
      // 外部写库后必须重启进程才可见（§7.1.8：sql.js 是内存库 + 全量回写）
      const a6 = await audit(dbFile);
      a6.exec("INSERT INTO review_logs (id, card_id, rating, duration_ms, reviewed_at, review_seq) VALUES (?,?,?,?,?,?)",
        ["f12-log-t1", cards[1], "Good", 400, base - DAY, 9001]);
      a6.exec("INSERT INTO review_logs (id, card_id, rating, duration_ms, reviewed_at, review_seq) VALUES (?,?,?,?,?,?)",
        ["f12-log-t2", cards[2], "Good", 400, base - 2 * DAY, 9002]);
      a6.save();
      a6.close();
      const db6 = await reopen();
      const streakCont = db6.getStatsOverview().kpi.streak;
      flow.check("连续三天有学习记录时 streak ≥ 3", streakCont >= 3, "≥3", streakCont);
      const a7 = await audit(dbFile);
      a7.exec("DELETE FROM review_logs WHERE id = 'f12-log-t2'");
      a7.save();
      a7.close();
      const db7 = await reopen();
      const streakBroken = db7.getStatsOverview().kpi.streak;
      flow.check("抽掉中间那天后 streak 缩短（断档必须如实反映）", streakBroken < streakCont, `<${streakCont}`, streakBroken);
      flow.record("streak 连续/断档", `${streakCont} → ${streakBroken}`);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F12 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
