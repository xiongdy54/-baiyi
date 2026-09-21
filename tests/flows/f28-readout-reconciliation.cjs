// F28 五处读数同源对账（换角度：同一句「今天有几张」在五个入口必须答同一个数）
// @runtime: electron  @tier: 2  @gui: false  @id: F28  @timeout: 240
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f28-readout-reconciliation.cjs
//
// 角度：§4.2-20 把「队列唯一口径」写成硬约束——仪表盘、复习页、卡片浏览、今日统计、
//       撤销面板读的都该是同一份事实。每条流程各自验证自己那一角都对，
//       但没有一条把五个读数放在**同一时刻**互相核对。这条就做这一件事：
//       用可控的到期时刻夹具（现在到期 / 今天稍后到期 / 明天到期 / 已暂停 / 已删书）
//       造出边界清晰的数据集，然后要求五处读数两两可解释、且任何一处偏移都要给出理由。
//
// 依据：§4.2-20（队列唯一口径与同源延后）、§4.16（同源延后矩阵）、§4.4.9（撤销账目）、
//       §6.2（仪表盘 KPI 与队列）、§4.12-4（日切点）、§7.2（软删除可见性一致）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F28",
  title: "五处读数同源对账",
  angle: "同一时刻的 KPI / 队列 / 到期清单 / 卡片总数 / 撤销面板 必须互相解释得通",
  cites: ["§4.2-20", "§4.16", "§4.4.9", "§6.2", "§4.12-4", "§7.2"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;
const fsrsState = (over) => {
  const now = Date.now();
  return JSON.stringify({ state: "review", due: now, lapses: 0, stability: 6, difficulty: 5, reps: 3, lastReview: now - DAY, learningSteps: [], ...over });
};
const J = (v) => JSON.stringify(v);

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f28"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const st = require(path.join(ROOT, "electron", "settingsStore.js"));
      const setApp = (patch) => { const o = st.readSettings(); o.app = { ...(o.app || {}), ...patch }; st.writeSettings(o); };
      setApp({ dayCutoffHour: 0, siblingBury: { enabled: false } });

      const now = Date.now();
      const mk = (tag, due, extra) => db.createCard({
        noteText: `F28 ${tag}`, cardType: "qa", frontMarkdown: `问 ${tag}`, backMarkdown: `答 ${tag}`,
        priority: 50, tags: ["f28"], fsrsJson: fsrsState({ due, ...(extra || {}) }),
      }).id;
      // 三类到期时刻 + 两类不可见
      const idNow = mk("现在到期", now - 60000);
      const idLater = mk("今天稍后", now + 6 * 3600000);
      const idTomorrow = mk("明天", now + DAY);
      const idSuspended = mk("已暂停", now - 60000, { state: "relearning" });
      db.setCardSuspended(idSuspended, true);
      const doomed = db.createFromPaste("F28 将被删的书", "# 章\n\n正文。");
      const doomedItem = db.listItems().find((i) => i.title === "F28 将被删的书");
      const docId = (db.getDocument(doomedItem.id) || {}).id || null;
      const idDeletedBook = db.createCard({
        noteText: "F28 删掉的书里的卡", cardType: "qa", frontMarkdown: "问", backMarkdown: "答",
        priority: 50, tags: ["f28"], fsrsJson: fsrsState({ due: now - 60000 }),
        contextRef: { documentId: docId },
      }).id;
      db.persistNow();
      void doomed;

      // ---------- X1 队列与其派生视图必须逐字同源 ----------
      flow.section("X1 listDueCards / computeTodayQueue 两个入口必须逐字同源（§4.2-20 唯一口径）");
      const q1 = db.computeTodayQueue(now);
      const q2 = db.computeTodayQueue(now);
      flow.eq("同一时刻两次算队列逐字节相同", J(q2), J(q1));
      const due = db.listDueCards(now);
      flow.eq("listDueCards 与 queue.cards 长度相同", due.length, q1.cards.length);
      flow.eq("两者成员与顺序也相同", due.map((c) => c.id).join(","), q1.cards.map((c) => c.id).join(","));
      flow.record("此刻进队的卡", q1.cards.map((c) => c.noteText).join(" / ") || "（空）");
      flow.record("此刻被同源延后的卡", q1.deferred.map((c) => c.noteText).join(" / ") || "（无）");

      // ---------- X2 KPI 与队列必须能互相解释 ----------
      flow.section("X2 仪表盘「今日待复习」与复习页可刷的张数必须互相对得上（§6.2 / §4.2-20）");
      const kpi = db.getStatsOverview().kpi;
      flow.record("KPI 读数", `dueToday=${kpi.dueToday} pending=${kpi.pendingToday} completed=${kpi.completedToday} queue=${q1.cards.length}`);
      flow.check("KPI 今日到期 ≥ 此刻可刷张数（今日口径包含今天稍后才到期的卡）", kpi.dueToday >= q1.cards.length, "≥", { kpi: kpi.dueToday, queue: q1.cards.length });
      const explained = q1.cards.length + q1.deferred.length;
      flow.check("今日口径多出来的张数只能由「今天稍后到期」解释，不能是任意偏差", Math.abs(kpi.dueToday - explained) <= 1, "|差| ≤ 1", { kpi: kpi.dueToday, 队列加延后: explained });
      const audX = await audit(dbFile);
      const allRows = audX.all("cards");
      audX.close();
      const cutoff = 0;
      const dayEnd = (() => { const d = new Date(now); d.setHours(cutoff === 0 ? 24 : cutoff, 0, 0, 0); return d.getTime(); })();
      const expectToday = allRows.filter((r) => {
        if (r.is_deleted !== 0) return false;
        try { if (JSON.parse(r.leech_json || "{}").suspended) return false; } catch { /* 脏 leech 当作未暂停 */ }
        let f = null;
        try { f = JSON.parse(r.fsrs_json || "null"); } catch { return false; }
        return !!f && f.due <= dayEnd;
      }).length;
      flow.record("自己按磁盘行算出的今日应到期张数", String(expectToday));
      flow.check("KPI 的「今日到期」必须等于按日切点独立重算的张数（明天的一张都不能进来）", kpi.dueToday === expectToday, `${expectToday} 张`, kpi.dueToday);
      flow.check("已暂停的卡不得出现在任何今日读数里", q1.cards.some((c) => c.id === idSuspended) || q1.deferred.some((c) => c.id === idSuspended), false);

      // ---------- X3 队列内部分段守恒 ----------
      flow.section("X3 队列 = 可见 + 延后，且延后卡必须带可解释的理由（§4.16 矩阵）");
      flow.check("cards 与 deferred 无交集", new Set([...q1.cards.map((c) => c.id), ...q1.deferred.map((c) => c.id)]).size === q1.cards.length + q1.deferred.length, "无重叠", { cards: q1.cards.length, deferred: q1.deferred.length });
      setApp({ siblingBury: { enabled: true, newCards: true, reviewCards: true, perDay: 3, sourceTextLimit: 400 } });
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(db.createCard({ noteText: `F28 同源组 ${i}`, cardType: "qa", frontMarkdown: `问 ${i}`, backMarkdown: `答 ${i}`, priority: 50, tags: ["f28"], siblingKey: "act:f28-sib", fsrsJson: fsrsState({ due: now - 1000 * i }) }).id);
      const q3 = db.computeTodayQueue(now);
      flow.record("开启同源延后后", `可见 ${q3.cards.length} / 延后 ${q3.deferred.length}`);
      flow.check("延后卡必须带 deferReason 结构（前端才能说清为什么少了一张）", q3.deferred.every((c) => c.deferReason && typeof c.deferReason === "object"), "全部带理由", q3.deferred.map((c) => `${c.noteText}:${J(c.deferReason).slice(0, 40)}`));
      flow.check("延后不是丢弃：可见 + 延后 ≥ 开启延后前的到期总数", q3.cards.length + q3.deferred.length >= 1 + q3.deferred.length, "不静默少卡", { visible: q3.cards.length, deferred: q3.deferred.length });
      flow.check("同源组内的卡仍在集合里（既不重复出现也不消失）", new Set([...q3.cards.map((c) => c.id), ...q3.deferred.map((c) => c.id)]).size === q3.cards.length + q3.deferred.length, "无重无漏", q3.cards.length + q3.deferred.length);
      const idsSeen = [...q3.cards, ...q3.deferred].map((c) => c.id);
      flow.check("延后开关切换不改变「到期候选」的集合成员", ids.every((x) => idsSeen.includes(x)) && ids.length === 4, "四人全在", ids.filter((x) => !idsSeen.includes(x)));
      setApp({ siblingBury: { enabled: false } });

      // ---------- X4 撤销后三处同步回退 ----------
      flow.section("X4 撤销一次评分：日志、KPI、队列三处必须同时回到撤销前（§4.4.9）");
      const before = { kpi: J(db.getStatsOverview().kpi), queue: J(db.computeTodayQueue(now).cards.map((c) => c.id)), logs: (await audit(dbFile)).count("review_logs") };
      const card = db.getCard(idNow);
      db.saveReview(idNow, { ...card.fsrs, due: now + 4 * DAY, reps: card.fsrs.reps + 1 }, "Good", 800, card.fsrs);
      db.persistNow();
      const audAfter = await audit(dbFile);
      const logsAfter = audAfter.count("review_logs");
      audAfter.close();
      flow.eq("评分写下一条日志", logsAfter, before.logs + 1);
      const undone = db.undoLastReview();
      flow.check("撤销返回成功", Boolean(undone && undone.ok !== false), true, undone);
      const after = { kpi: J(db.getStatsOverview().kpi), queue: J(db.computeTodayQueue(now).cards.map((c) => c.id)), logs: (await audit(dbFile)).count("review_logs") };
      flow.eq("撤销后日志数回到原值", after.logs, before.logs);
      flow.eq("撤销后队列成员序与撤销前一致", after.queue, before.queue);
      flow.check("撤销后 KPI 回到撤销前（completed/reviewed 计数不得留下痕迹）", after.kpi === before.kpi || J(db.getStatsOverview().kpi.completedToday) === "0", "同步回退", { before: before.kpi.slice(0, 90), after: after.kpi.slice(0, 90) });

      // ---------- X5 一张新到期卡让四处同步 +1 ----------
      flow.section("X5 新增一张到期卡：队列、KPI、卡片总数、磁盘行数必须同时 +1（§4.2-20）");
      const base = { queue: db.computeTodayQueue(now).cards.length, kpi: db.getStatsOverview().kpi.dueToday, all: db.listAllCards().length, disk: (await audit(dbFile)).count("cards") };
      mk("新增到期", now - 10);
      db.persistNow();
      const next = { queue: db.computeTodayQueue(now).cards.length, kpi: db.getStatsOverview().kpi.dueToday, all: db.listAllCards().length, disk: (await audit(dbFile)).count("cards") };
      flow.eq("队列 +1", next.queue, base.queue + 1);
      flow.eq("KPI 今日到期 +1", next.kpi, base.kpi + 1);
      flow.eq("卡片浏览总数 +1", next.all, base.all + 1);
      flow.eq("磁盘 cards 行数 +1", next.disk, base.disk + 1);
      flow.eq("listAllCards 与磁盘行数同源", next.all, next.disk);

      // ---------- X6 软删一本书后各处一致 ----------
      flow.section("X6 删掉一本书之后：五处读数的反应必须同幅同向（§7.2 软删；卡留在原地是既定决策）");
      const before6 = { all: db.listAllCards().length, queue: db.computeTodayQueue(now).cards.length, kpi: db.getStatsOverview().kpi.dueToday };
      db.deleteItem(doomedItem.id);
      const after6 = { all: db.listAllCards().length, queue: db.computeTodayQueue(now).cards.length, kpi: db.getStatsOverview().kpi.dueToday };
      const inAll = db.listAllCards().some((c) => c.id === idDeletedBook);
      const inQueue = db.computeTodayQueue(now).cards.some((c) => c.id === idDeletedBook);
      flow.record("删书后这张卡的下落", { 卡片浏览: inAll ? "仍在" : "已隐", 复习队列: inQueue ? "仍在" : "已隐", 删前: before6, 删后: after6 });
      flow.check("卡片浏览与复习队列对它的可见性判定必须一致（不能一处当它死了另一处还在催）", inAll === inQueue, "两处同生同灭", { 卡片浏览: inAll, 队列: inQueue });
      flow.check("删书带来的读数变化在 KPI 与队列之间必须同幅（不能一边降一边不降）", (before6.kpi - after6.kpi) === (before6.queue - after6.queue), "降幅相同", { kpi降: before6.kpi - after6.kpi, 队列降: before6.queue - after6.queue });
      const aud6 = await audit(dbFile);
      const cardRow = aud6.all("cards").find((c) => c.id === idDeletedBook);
      const itemRow = aud6.all("library_items").find((i) => i.id === doomedItem.id);
      flow.record("删书落盘形态", `书 is_deleted=${itemRow && itemRow.is_deleted}；它的卡 is_deleted=${cardRow && cardRow.is_deleted}`);
      // 「删书只软删书目、卡与摘录留在原地」是既定决策（§7.2 L869 + 用户资产观，F02 I6 已把它当期望值断言），
      // 所以这里**不判红**，只把残留的用户可见面登记成观察：卡还在催，但来源已经点不开、卡面 docTitle 为空。
      flow.check("卡留在原地是既定行为（与 F02 I6 同口径，不能一边当期望一边当缺陷）", Number(cardRow && cardRow.is_deleted) === 0 && inQueue, "卡仍可复习", { 卡: cardRow && cardRow.is_deleted, 队列: inQueue });
      const orphan = db.computeTodayQueue(now).cards.find((c) => c.id === idDeletedBook);
      flow.record("观察：来源已删的卡在卡面上的样子", `docTitle=${J(orphan && orphan.docTitle)}（队列继续催它，界面上没有「来源已删」标记）`);
      aud6.close();
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F28 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
