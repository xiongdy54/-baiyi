// F77 并列卡片的复习顺序稳定性（同 due / 同 priority 时会不会每次刷新换序）
// @runtime: electron  @tier: 1  @gui: false  @id: F77  @timeout: 240
// 运行：npx electron tests/flows/f77-tie-order.cjs
//
// 角度：真实库里大量卡是同一天、同 priority 批量生成的（F49 实测 224 条 block 全空 ⇒ 同批）。
// 若排序对并列没有确定的 tie-break，用户每次回到队列都会看到不同顺序，且"刷完一批再进来"会重排。
// 本条不猜实现：同一份数据连取 5 次队列 + 3 次全表，比对 id 序列；
// 并配两个对照：① 造出确定不同的 due，顺序必须按 due 升序（证明比较器在跑）；
//                ② 交换两张卡的 due，顺序必须变（证明我的差分对顺序敏感，不是恒等比较）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F77",
  title: "并列卡片顺序稳定性",
  angle: "同 due / 同 priority 的卡在多次取队列时顺序是否确定（tie-break 缺失这一整类）",
  cites: ["§4.2", "§4.5"],
  tier: 1,
  gui: false,
});
const fsrsAt = (due) => ({ state: "review", due, reps: 5, lapses: 0, stability: 12, difficulty: 5, lastReview: due - 5 * 86400000, learningSteps: 0 });
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f77"));
    app.setPath("userData", dir);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const NOW = () => Date.now();
      const item = db.createFromPaste("F77 并列顺序书", "# 章\n\n为 tie-break 而造的场景。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const ids = [];
      const due0 = NOW() - 1000;
      for (let i = 0; i < 60; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F77 问 ${i}`, backMarkdown: `F77 答 ${i}`, cardType: "qa" });
        const id = c && (c.id || c.cardId);
        if (!id) continue;
        db.execRawSql("UPDATE cards SET fsrs_json = ?, priority = ? WHERE id = ?", [JSON.stringify(fsrsAt(due0)), 0, id]);
        ids.push(id);
      }
      db.persistNow();
      flow.record("造出的完全并列卡", `${ids.length} 张（due/priority/reps/stability/difficulty 全同，只有插入顺序不同）`);
      if (ids.length < 50) {
        flow.check("样本量足够（≥50 张并列卡）", false, "≥50", ids.length);
        return;
      }

      const queueIds = () => (db.computeTodayQueue().cards || []).map((c) => c.id);
      flow.section("S1 同一份数据连取 5 次队列，id 序列是否恒定");
      const runs = [];
      for (let k = 0; k < 5; k++) {
        runs.push(queueIds());
        await new Promise((r) => setImmediate(r));
      }
      const lens = runs.map((r) => r.length);
      flow.record("每次返回张数", lens.join(" · "));
      const base = runs[0];
      const driftIdx = runs.map((r, i) => (eq(r, base) ? -1 : i)).filter((i) => i > 0);
      if (driftIdx.length) {
        const bad = runs[driftIdx[0]];
        let firstDiff = -1;
        for (let i = 0; i < Math.max(bad.length, base.length); i++) if (bad[i] !== base[i]) { firstDiff = i; break; }
        flow.record("第 1 次与第 " + (driftIdx[0] + 1) + " 次差异", `首个不同位置 ${firstDiff}：${base[firstDiff]} → ${bad[firstDiff]}（同集合？${eq([...base].sort(), [...bad].sort()) ? "是，纯换序" : "否，成员也变了"}）`);
      }
      flow.check("并列卡的队列顺序必须逐次一致（否则用户每次进来都换序）", driftIdx.length === 0, "5 次完全相同", driftIdx.length ? `第 ${driftIdx.map((i) => i + 1).join(",")} 次与首次不同` : "一致");

      flow.section("S2 全表列举连取 3 次是否恒定");
      const all1 = (db.listAllCards() || []).map((c) => c.id);
      const all2 = (db.listAllCards() || []).map((c) => c.id);
      const all3 = (db.listAllCards() || []).map((c) => c.id);
      flow.record("全表张数 3 次", `${all1.length} · ${all2.length} · ${all3.length}`);
      flow.check("listAllCards 对并列数据应给出确定顺序", eq(all1, all2) && eq(all2, all3), "3 次相同", eq(all1, all2) && eq(all2, all3) ? "相同" : "不同");
      flow.record("并列时是否等于插入序", eq(all1, ids) ? "是（按 rowid/插入序，属可预期）" : "否（与插入序不同，需看是否稳定）");

      flow.section("S3 正向对照 A：把 due 改成互不相同，顺序必须严格按 due 升序");
      for (let i = 0; i < ids.length; i++) {
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(fsrsAt(due0 - (ids.length - i) * 1000)), ids[i]]);
      }
      db.persistNow();
      const q2 = (db.computeTodayQueue().cards || []).map((c) => c.id);
      const pos = new Map(q2.map((id, i) => [id, i]));
      let inversions = 0;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        if (pos.has(ids[i]) && pos.has(ids[j]) && pos.get(ids[i]) > pos.get(ids[j])) inversions++;
      }
      flow.record("注入的 due 递增序 vs 队列序 逆序对数", `${inversions}（队列返回 ${q2.length} 张，若被每日上限截断则只比可见部分）`);
      flow.check("对照 A：due 互不相同时队列必须按 due 升序（逆序对=0）", inversions === 0, "0", inversions);

      flow.section("S4 正向对照 B：交换头两张的 due，队列顺序必须变（证明本检对顺序敏感）");
      const before = queueIds();
      const dA = db.execRawSql("SELECT fsrs_json AS f FROM cards WHERE id = ?", [ids[0]]);
      const dB = db.execRawSql("SELECT fsrs_json AS f FROM cards WHERE id = ?", [ids[1]]);
      try {
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify({ ...fsrsAt(due0 - 999999), state: "review" }), ids[0]]);
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify({ ...fsrsAt(due0 - 1), state: "review" }), ids[1]]);
        db.persistNow();
        const after = queueIds();
        flow.record("交换前后首 6 位", `${before.slice(0, 6).map((x) => x.slice(0, 4)).join(",")} → ${after.slice(0, 6).map((x) => x.slice(0, 4)).join(",")}`);
        flow.check("对照 B：改动 due 后队列顺序必须改变（报不出来说明本检恒等）", !eq(before, after), "顺序变化", eq(before, after) ? "未变 ⇒ 本检不可信" : "已变");
        void dA; void dB;
      } catch (e) {
        flow.check("对照 B 可执行", false, "不抛", String(e.message).slice(0, 120));
      }

      flow.section("S5 评完 5 张再取队列：刚评过的卡不该立刻又出现");
      // 真实签名：saveReview(cardId, fsrsState, rating, durationMs, fsrsBefore)（db.js:1478）
      const q3 = queueIds();
      const logs0 = (db.listAllReviewLogs() || []).length;
      const served = q3.slice(0, 5);
      let applied = 0;
      for (const id of served) {
        const next = { state: "review", due: NOW() + 6 * 3600000, reps: 6, lapses: 0, stability: 13, difficulty: 5, lastReview: NOW(), learningSteps: 0 };
        try {
          db.saveReview(id, next, 3, 8000, fsrsAt(due0));
          applied++;
        } catch (e) {
          flow.record("saveReview 抛错", String(e.message).slice(0, 120));
          break;
        }
      }
      db.persistNow();
      const logs1 = (db.listAllReviewLogs() || []).length;
      flow.record("调用成功数 / 日志增量", `${applied} / ${logs1 - logs0}（${logs0} → ${logs1}）`);
      if (applied === 0 || logs1 <= logs0) {
        flow.check("闸门空转自检：复习必须真的写进库，否则 S5 的判定不作数", false, "≥1 张且日志增长", `applied=${applied} 日志增量=${logs1 - logs0}`);
        return;
      }
      const q4 = queueIds();
      const stillThere = served.filter((id) => q4.includes(id));
      flow.record("已评 5 张后仍在队列里的张数", `${stillThere.length}（队列 ${q3.length} → ${q4.length}）`);
      flow.check("刚评过的卡不应立刻又出现在队列里", stillThere.length === 0, "0 张", stillThere.slice(0, 5));
      // 我第一版在这里写错了判据：评过的卡属于 completedToday，不属于 deferred
      // （deferred 是同源burying 的出口）。正确的问法是：KPI 三个字段自己是否闭合，
      // 以及"待复习数"与"队列实发数"是否相等 —— 若相等，则 D-TEST-38 的差额与已评卡无关。
      const k = db.getStatsOverview().kpi;
      const servedNow = q4.length;
      flow.record("KPI 三字段", `dueToday=${k.dueToday} completedToday=${k.completedToday} pendingToday=${k.pendingToday} · 队列实发=${servedNow}`);
      flow.check("KPI 自洽：dueToday 应等于 completedToday + pendingToday", k.dueToday === k.completedToday + k.pendingToday,
        `${k.completedToday}+${k.pendingToday}`, k.dueToday);
      flow.check("差额定位判据：pendingToday 应等于队列实发数（相等 ⇒ D-TEST-38 的差额不是由已评卡造成的）", servedNow === k.pendingToday,
        `${k.pendingToday}`, servedNow);
      const a = (db.computeTodayQueue().deferred || []).map((d) => d.id);
      flow.record("deferred 清单条数（评后）", `${a.length}（评过的 5 张命中 ${served.filter((id) => a.includes(id)).length} 张）—— 记为事实：deferred 只承载同源burying，不承载『今日稍后』`);
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  });
