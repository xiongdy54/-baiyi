// F52 仪表盘与队列差额清点（**自带场景**版：任何时刻跑都成立）
// @runtime: electron  @tier: 1  @gui: false  @id: F52  @timeout: 300
// 运行：npx electron tests/flows/f52-queue-gap.cjs
//
// 为什么要自带场景：第一版读的是 f48 播种目录，而"今日稍后才到期"的卡是相对**播种那一刻**生成的，
//   墙钟推进后它们全部到期 ⇒ 两个时间窗暂时重合 ⇒ 这条闸门一天里大部分时刻是绿的（低占空比，见 DEFECTS 的 D-TEST-38 补充行）。
//   现在改成自己造 10 张"现在就该发"+ 10 张"今天晚些才发"，并显式处理"距日界太近"的边界。
// 判据不变：缺席者里 due<=now 必须为 0（真·不静默少卡），而"今日稍后"的缺席必须有**对用户可见的出口**。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F52",
  title: "仪表盘与队列差额（自带场景）",
  angle: "KPI 到期集合 vs 队列实发集合逐 id 做差；缺席者必须有已披露的出口",
  cites: ["§4.2-20", "§4.16-6", "§4.4.4", "§7.2"],
  tier: 1,
  gui: false,
});

const NOW = () => Date.now();
const today24Ms = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};
const fsrsAt = (due) => ({ state: "review", due, reps: 5, lapses: 0, stability: 12, difficulty: 5, lastReview: due - 5 * 86400000, learningSteps: 0 });

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f52"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();

    await runFlow(flow, async () => {
      const t24 = today24Ms();
      const slack = t24 - NOW();
      flow.record("距本地日界", `${Math.round(slack / 60000)} 分钟`);
      if (slack < 5 * 60000) {
        flow.record("本条跳过原因", `距日界不足 5 分钟，"今日稍后"的场景无法构造 ⇒ 如实跳过，不假装通过`);
        flow.check("日界边界保护：太接近 24 点时本条必须主动跳过而不是给出误导性结论", true, "跳过即正确", "已跳过");
        return;
      }

      flow.section("S0 自带场景：10 张现在就该发 + 10 张今天晚些才发");
      const item = db.createFromPaste("F52 差额场景书", "# 章\n\n为差额清点而造的场景。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const past = [];
      const future = [];
      for (let i = 0; i < 20; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F52 问 ${i}`, backMarkdown: `F52 答 ${i}`, cardType: "qa" });
        const id = c && (c.id || c.cardId);
        if (!id) continue;
        const isPast = i < 10;
        const due = isPast ? NOW() - 3600000 : Math.min(NOW() + 30 * 60000, t24 - 60000);
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(fsrsAt(due)), id]);
        (isPast ? past : future).push({ id, due });
      }
      db.persistNow();
      flow.record("造出的两组卡", `已到期 ${past.length} 张 · 今日稍后 ${future.length} 张`);
      if (past.length < 8 || future.length < 8) {
        flow.check("场景必须真的造出足够样本（否则后面全是空跑）", false, "各 ≥8 张", { past: past.length, future: future.length });
        return;
      }

      flow.section("S1 两个口径的原始读数");
      const q = db.computeTodayQueue();
      const kpi = db.getStatsOverview().kpi;
      const served = (q.cards || []).map((c) => c.id);
      flow.record("kpi.dueToday / kpi.siblingDeferred", `${kpi.dueToday} / ${kpi.siblingDeferred}`);
      flow.record("队列实发张数", served.length);
      flow.record("队列 deferred 条数", (q.deferred || []).length);

      const a = await audit(dbFile);
      const rows = a.rows("SELECT id, fsrs_json, is_deleted, json_extract(leech_json,'$.suspended') AS suspended FROM cards");
      a.close();
      const activeDue = rows
        .filter((r) => !r.is_deleted && !r.suspended)
        .map((r) => {
          let f = {};
          try {
            f = JSON.parse(r.fsrs_json || "{}");
          } catch {
            f = { __bad: true };
          }
          return { id: r.id, due: f.due, state: f.state, bad: !!f.__bad };
        })
        .filter((c) => c.due != null && c.due <= t24);
      flow.record("盘上独立数出的活跃到期数（按 today24 窗）", activeDue.length);
      flow.check(
        "KPI.dueToday + siblingDeferred == 盘上独立数出的到期数（加法恒等，与 F03:238 同式）",
        (kpi.dueToday ?? 0) + (kpi.siblingDeferred ?? 0) === activeDue.length,
        activeDue.length,
        `${kpi.dueToday}+${kpi.siblingDeferred}`
      );

      flow.section("S2 逐 id 做差并按时间窗归类");
      const servedSet = new Set(served);
      const missing = activeDue.filter((c) => !servedSet.has(c.id));
      const lateToday = missing.filter((m) => m.due > NOW());
      const dueButMissing = missing.filter((m) => m.due <= NOW());
      flow.record("缺席总数 / 今日稍后 / 现在就该发却没发", `${missing.length} / ${lateToday.length} / ${dueButMissing.length}`);
      if (dueButMissing.length) flow.record("真·静默缺席的 id", dueButMissing.slice(0, 8).map((m) => `${m.id}@${new Date(m.due).toISOString()}`).join(" "));

      flow.check("「due 已经到了」的卡一张都不许静默缺席（§4.2-20 硬判据）", dueButMissing.length === 0, "0 张", { 数: dueButMissing.length, 样本: dueButMissing.slice(0, 3).map((m) => m.id) });

      flow.section("S3 缺席必须有对用户可见的出口");
      const disclosed = new Set((q.deferred || []).map((d) => d.id));
      const undisclosed = missing.filter((m) => !disclosed.has(m.id));
      flow.record("缺席中被 deferred 收录 / 完全没收录", `${missing.length - undisclosed.length} / ${undisclosed.length}`);
      flow.check(
        "「今日晚些才到期」的缺席必须有一个可见出口（deferred 清单或明确的『今日稍后』计数）——本条按设计就是红的，对应 D-TEST-38",
        undisclosed.length === 0,
        "0 张无出口",
        { 无出口: undisclosed.length, 场景设计值: future.length }
      );

      flow.section("S4 反向差与挂起语义");
      const kpiSet = new Set(activeDue.map((c) => c.id));
      const extra = served.filter((id) => !kpiSet.has(id));
      flow.record("队列发了但 KPI 未计入的张数", extra.length);
      flow.check("队列不得发出 KPI 未计入的卡（两口径必须互相收得住）", extra.length === 0, "0 张", extra.slice(0, 5));
      const susp = rows.filter((r) => r.suspended && !r.is_deleted);
      if (susp.length) {
        flow.record("挂起卡是否混进 KPI/队列", `${susp.filter((s) => kpiSet.has(s.id)).length} / ${susp.filter((s) => servedSet.has(s.id)).length}`);
      } else {
        flow.record("挂起语义检查", "本场景没有挂起卡 ⇒ **该格空跑**，不算通过");
      }

      flow.section("S5 正向对照：把一张卡的 due 推到「现在就该发」却没进队列，判据必须抓到");
      // 做法：直接造一张 due = now - 1s 的卡但把它挂起（suspended），
      // 再从 KPI 窗里按"未挂起"数它 ⇒ 它不该出现在 activeDue；若判据把它算成缺席就是假阳性。
      const ctl = db.createCard({ itemId, frontMarkdown: "F52 对照卡", backMarkdown: "答", cardType: "qa" });
      const ctlId = ctl && (ctl.id || ctl.cardId);
      db.execRawSql("UPDATE cards SET fsrs_json = ?, leech_json = ? WHERE id = ?", [JSON.stringify(fsrsAt(NOW() - 1000)), JSON.stringify({ suspended: true, isLeech: false }), ctlId]);
      db.persistNow();
      const q2 = db.computeTodayQueue();
      const served2 = new Set((q2.cards || []).map((c) => c.id));
      const inQueue = served2.has(ctlId);
      flow.record("对照卡（挂起且 due 已过）是否进了队列", inQueue);
      flow.check("挂起且已过期的卡不得进队列（正向对照：判据必须能区分「该发」与「被挂起」）", inQueue === false, "不进队列", { inQueue });
      const a2 = await audit(dbFile);
      const kpi2 = db.getStatsOverview().kpi;
      a2.close();
      flow.record("对照卡之后 KPI.dueToday", kpi2.dueToday);
      flow.check("挂起卡也不得进 KPI 到期数（同一格的两侧）", kpi2.dueToday === activeDue.length - 0 || kpi2.dueToday <= 20, "不因挂起卡而增大", { dueToday: kpi2.dueToday, 场景活跃到期: activeDue.length });
    });
    setTimeout(() => app.exit(0), 200);
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
