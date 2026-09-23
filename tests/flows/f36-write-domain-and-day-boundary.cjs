// F36 写入口取值域与「今日」两条边界的口径（跨模块不变量 · 写入口 + 统计口径层）
// @runtime: electron  @tier: 2  @gui: false  @id: F36  @timeout: 240
// 运行：npx electron tests/flows/f36-write-domain-and-day-boundary.cjs
//
// 三条各自独立，都来自子代理报告，本轮逐条差分：
//   M1 优先级 0 写不进去（Number(x)||50 把 0 当假值）——UI 明写「0-100，越高越先复习」，
//      0 是广告过的合法取值。§6.4 的 R14「边缘 ≤30」也依赖低值可表达。
//   M2 ai_gen_batches 只写不读（全仓无 SELECT / 无 IPC / 无 preload 出口）——
//      §4.3-⑦ 与 §7.1.4 承诺「已付费生成的草稿不丢」，数据在库里但界面永远取不到。
//   M3 「今日」的两条边界：队列用 due<=now（§4.2-20），KPI 用 due<=today24（§4.16-6）。
//      子代理报成「两套口径未收口 → 仪表盘 > 队列」，**本轮实测判定这是有意区分而非缺陷**：
//      KPI 同样减了 computeSiblingDeferred，两边共用同一个延后函数。
//      真正的不变量应是「队列 ⊆ 今日到期」且差集恰为「now<due≤today24」那批，
//      本层把这条写成断言，替换掉 F34 里那条只在「全部卡都已到期」时才成立的弱断言。
//
// 依据：§6.4（R14 边缘≤30）、§4.2-20、§4.16-6、§4.3-⑦、§7.1.4、§7.2。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { bootFlowDb, reopenFlowDb, audit, quit } = require("./lib/dbenv.cjs");

const DAY = 86_400_000, HOUR = 3_600_000;
const flow = new Flow({
  id: "F36",
  title: "写入口取值域与「今日」两条边界的口径",
  angle: "优先级 0 能否落库 / ai_gen_batches 能否读回 / 队列与 KPI 的今日边界差是否自洽",
  cites: ["§6.4", "§4.2-20", "§4.16-6", "§4.3-⑦", "§7.1.4", "§7.2"],
  tier: 2,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const { db, dir, dbFile } = await bootFlowDb("f36");
    const s = await runFlow(flow, async () => {
      const NL = String.fromCharCode(10);
      const bk = db.createFromPaste("F36 材料", ["# 第一章", "", "写入口取值域审计用正文。"].join(NL));
      const mk = (i, prio) => db.createCard({
        noteText: `F36-K${i}-${prio}`, cardType: "qa", frontMarkdown: `问 ${i}`, backMarkdown: `答 ${i}`,
        priority: prio, tags: [], documentId: bk.documentId,
      });

      // ── M1 优先级取值域：0 必须能落库，且编辑别的字段时不许被回卷 ──────────
      const p0 = mk(1, 0);
      const got0 = db.getCard(p0.id).priority;
      flow.check("M1 优先级 0 应原样落库（UI 明写 0-100 合法）", got0 === 0, "0", got0);
      // 改文案（不动优先级）后，0 是否被静默改回 50
      db.updateCard({ ...db.getCard(p0.id), backMarkdown: "答 1 改" });
      const got0b = db.getCard(p0.id).priority;
      flow.check("M1b 只改文案不得顺手把优先级重置（§4.4.5 字段级更新）", got0b === 0, "0", got0b);
      // 对照：中间值与边界值
      const p30 = mk(2, 30), p100 = mk(3, 100), p1 = mk(4, 1);
      flow.eq("M1c 对照：30 / 100 / 1 三个合法值均原样落库",
        [db.getCard(p30.id).priority, db.getCard(p100.id).priority, db.getCard(p1.id).priority].join(","), "30,100,1");
      // 越界值必须被钳制而不是照收
      const pNeg = mk(5, -5), pBig = mk(6, 9999);
      flow.record("M1d 越界输入落库结果", `−5→${db.getCard(pNeg.id).priority} ; 9999→${db.getCard(pBig.id).priority}`);

      // ── M2 ai_gen_batches 可读回性 ───────────────────────────────────────
      const batch = db.createAIGenBatch({
        scope: "card-main", sourceText: "负反馈调节使系统回归稳定。",
        context: { documentId: bk.documentId }, promptTemplateId: null,
        result: { cards: [{ frontMarkdown: "问", backMarkdown: "答" }] },
      });
      const batchId = batch && (batch.id || batch);
      flow.record("M2a createAIGenBatch 返回", JSON.stringify(batch).slice(0, 90));
      const a = await audit(dbFile);
      const stored = a.one("SELECT id, scope, status, result_json FROM ai_gen_batches ORDER BY created_at DESC LIMIT 1");
      a.close();
      flow.check("M2b 批次确实写进了库（不是静默失败）", !!stored && !!stored.result_json, "有行且含 result_json", JSON.stringify(stored).slice(0, 120));
      // 仓储层有没有任何「读」出口
      const readers = ["listAIGenBatches", "getAIGenBatch", "listGenBatches", "readAIGenBatch", "fetchAIGenBatch", "getAIGenBatchById"];
      const present = readers.filter((n) => typeof db[n] === "function");
      flow.check("M2c 仓储层必须有读回批次的出口（§4.3-⑦ 已付费草稿不得找不回）", present.length > 0, "≥1 个读函数", `已导出：${present.join(",") || "无"}`);
      flow.record("M2d 状态更新函数存在", typeof db.setAIGenBatchStatus === "function" ? "有（只写）" : "无");
      // 关掉窗口 = 只有 batchId，能否凭 id 取回草稿？
      let recoverable = false;
      try { recoverable = !!(db.getCard && present.length && db[present[0]](batchId)); } catch { recoverable = false; }
      flow.check("M2e 凭 batchId 应能取回该批草稿（用户关窗后重找的唯一路径）", recoverable, "可取回", String(recoverable));

      // ── M3 「今日」两条边界的自洽性（判定子代理 B-7#3 是否成立）───────────
      const now = Date.now();
      const dayStart = now - (now % DAY); // 近似；真值由 db 内部 dayStartMs 决定，下面只用相对关系
      // 三组卡：已到期 / 今天稍后到期 / 明天到期
      const mkDue = (i, dueMs) => {
        const c = mk(i, 50);
        const cur = db.getCard(c.id);
        db.saveReview(c.id, {
          state: "review", due: dueMs, lapses: 0, stability: 20, difficulty: 5,
          reps: 3, learningSteps: 0, lastReview: dueMs - 20 * DAY,
        }, "Good", 3000, cur.fsrs);
        return c.id;
      };
      const idPast = mkDue(10, now - 2 * HOUR);
      const idLaterToday = mkDue(11, now + 3 * HOUR);
      const idTomorrow = mkDue(12, now + DAY + 2 * HOUR);
      db.persistNow();
      const db2 = await reopenFlowDb(dir);

      const q = db2.computeTodayQueue(now);
      const qIds = new Set(q.cards.map((c) => c.id));
      const kpi = db2.getStatsOverview().kpi;
      const dueToday = kpi.dueToday ?? null;
      flow.record("M3a 队列实发 / KPI 今日到期", `${q.cards.length} / ${dueToday}`);
      flow.check("M3b 已到期卡进队列", qIds.has(idPast), "在队列", qIds.has(idPast) ? "在" : "不在");
      flow.check("M3c 今天稍后才到期的卡**不**进当前队列（due<=now 语义）", !qIds.has(idLaterToday), "不在队列", qIds.has(idLaterToday) ? "在" : "不在");
      flow.check("M3d 明天到期的卡不进队列", !qIds.has(idTomorrow), "不在队列", qIds.has(idTomorrow) ? "在" : "不在");

      // 核心：队列 ⊆ 今日到期，且差集恰为「now<due≤today24」
      if (dueToday != null) {
        flow.check("M3e 队列 ⊆ 今日到期（§4.16-6 口径唯一的前提）", dueToday >= q.cards.length, `≥${q.cards.length}`, dueToday);
        const expectGap = qIds.has(idPast) && !qIds.has(idLaterToday) ? 1 : 0;
        flow.record("M3f 差集（今日到期但未进当前队列）", `${dueToday - q.cards.length}，其中「今天稍后到期」应有 ${expectGap} 张`);
        flow.check(
          "M3g 差集只由「now<due≤今日末」造成，不得来自别的口径分歧",
          dueToday - q.cards.length >= expectGap && dueToday - q.cards.length <= expectGap + 2,
          `${expectGap}~${expectGap + 2}`, String(dueToday - q.cards.length)
        );
        // 判定子代理结论
        console.log(`  · 判定：KPI 与队列**共用** computeSiblingDeferred（db.js:2199），` +
          `差异只在 due<=now vs due<=today24 —— 这是两个不同的问题（「现在能刷几张」vs「今天共有几张到期」），不是口径没收口。`);
      } else {
        flow.check("M3 KPI 暴露了今日到期字段", false, "有 dueToday", JSON.stringify(Object.keys(kpi)));
      }

      // ── M4 同源延后在两边是否用同一份判定 ────────────────────────────────
      const sib = [mk(20, 50), mk(21, 50), mk(22, 50)].map((c) => c.id);
      const a2 = await audit(dbFile);
      sib.forEach((id, i) => a2.exec("UPDATE cards SET sibling_key = ? WHERE id = ?", ["f36-g1", id]));
      a2.save(); a2.close();
      const db3 = await reopenFlowDb(dir);
      const q3 = db3.computeTodayQueue();
      const inQueue = sib.filter((id) => q3.cards.some((c) => c.id === id)).length;
      const inDeferred = sib.filter((id) => q3.deferred.some((c) => c.id === id)).length;
      flow.check("M4 同源三元组当前队列只放行一张，其余进 deferred 不静默消失（§4.16-7）",
        inQueue === 1 && inDeferred === 2, "1 放行 + 2 延后", `${inQueue} 放行 + ${inDeferred} 延后`);
      const kpi3 = db3.getStatsOverview().kpi;
      flow.record("M4b KPI 侧同源延后计数 siblingDeferred", kpi3.siblingDeferred ?? "(未暴露)");
    });

    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F36 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
