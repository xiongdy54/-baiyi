// F34 五十年地平线上的读侧口径与守恒（跨模块不变量 · 库级集成层）
// @runtime: electron  @tier: 2  @gui: false  @id: F34  @timeout: 600
// 运行：npx electron tests/flows/f34-fifty-year-horizon.cjs   （或 node tests/flows/run.cjs --only F34）
//
// 角度：tests/fsrs/fifty-year.test.cjs 已在**纯算法层**证明 50 年调度数值正确
//       （与官方 fsrs-rs 异源对照，stability 相对误差 ≤1.6e-6、50 年 JSON 往返零精度丢失）。
//       那一层看不到的是：把 50 年的时间戳与区间**灌进真库之后**，读侧口径、同源延后额度、
//       撤销回收、坏数据闸门、落盘往返、日桶分群是否还互相自洽。sql.js 是内存库 + 全量回写
//       （§7.1.8），50 年量级的 due 毫秒值（≈2.4e12）与 36501 天区间正是最容易在
//       「序列化 / 排序 / 日界」上出问题的地方。既有 F03 验单日主旅程守恒、F12 验三套日子边界、
//       F14 验月度史、F10 验规模；**五十年量级的读侧口径此前无人验过**。
//
// 依据（AI_DEVELOPMENT_GUIDE.md）：
//   §4.2-20 / §4.16 L316–324 今日队列唯一口径；延后另列不静默少卡；同源当日只放行一张
//   §4.4.5 fsrs_json 八字段完整往返；§4.4.9 撤销不变量集
//   §4.4.10 maximum_interval 属 scheduler_options，必须对结果成立
//   §4.12-4 学习日与 delta_t 并存；§7.2 落库即落盘、软删留痕
//   §7.1.4 重启不丢数据；批次 A（D-TEST-06/09/11）「一条坏数据不得让整页不可用」
"use strict";
const path = require("path");
const { app } = require("electron");
const { execSync } = require("child_process");
const { Flow, runFlow, makeRng, ROOT } = require("./lib/harness.cjs");
const { bootFlowDb, reopenFlowDb, audit, quit } = require("./lib/dbenv.cjs");

const DAY = 86_400_000, HOUR = 3_600_000;
const YEARS = 50;
const T_END = Date.now();
const T_START = T_END - Math.round(YEARS * 365.25 * DAY);
const FIELDS8 = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
const MAX_IVL = require(path.join(ROOT, "electron", "fsrsConfig.js")).DEFAULT_SCHEDULER_OPTIONS.maximumInterval;

const flow = new Flow({
  id: "F34",
  title: "50 年地平线上的读侧口径与守恒",
  angle: "把 50 年时间戳灌进真库后，队列口径 / 同源额度 / 撤销 / 坏数据闸门 / 落盘往返是否自洽",
  cites: ["§4.2-20", "§4.16", "§4.4.5", "§4.4.9", "§4.4.10", "§4.12-4", "§7.1.4", "§7.2"],
  tier: 2,
  gui: false,
});

const utcDay = (ms) => Math.floor(ms / DAY);
const validFsrs = (f) =>
  !!f && Number.isFinite(f.due) && Number.isFinite(f.stability) && f.stability > 0 &&
  Number.isFinite(f.difficulty) && f.difficulty >= 1 && f.difficulty <= 10 &&
  Number.isFinite(f.lapses) && f.lapses >= 0;

// 用真算法（ts-fsrs，与 §2 锁定版本同源）造一条 n 年跨度的真实复习史
function buildHistory(tsfs, S, gradeSeq, startMs) {
  const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
  const eng = fsrs(generatorParameters({ enable_fuzz: false }));
  const G = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy };
  let c = createEmptyCard(new Date(startMs));
  let at = startMs;
  const logs = [];
  for (const g of gradeSeq) {
    at = Math.max(at, c.due.getTime());
    const r = eng.repeat(c, new Date(at))[G[g]];
    logs.push({ rating: g, at, before: { ...c }, after: { ...r.card } });
    c = r.card;
    at = c.due.getTime() + Math.round((S() - 0.5) * 6 * HOUR);
  }
  return logs;
}

app
  .whenReady()
  .then(async () => {
    const { db: db0, dir, dbFile } = await bootFlowDb("f34");
    const s = await runFlow(flow, async () => {
      const tsfs = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
    // 应用侧调度器封装（A-1 的修复点）：就地打包，确保测的是最新源码
    execSync("npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.f34.bundle.cjs", { cwd: ROOT });
    const { fsrsEngine } = require(path.join(ROOT, "tests", "fsrs", "adapter.f34.bundle.cjs"));
      const rng = makeRng("f34");
      const rnd = rng.next;

      // ── 播种：8 份材料 × 25 张卡，其中 8 组同源三元组；每卡一条 1–50 年跨度的真史 ──
      const NL = String.fromCharCode(10);
      const itemIds = [];
      for (let b = 0; b < 8; b++) {
        const r = db0.createFromPaste(
          `F34 材料 ${b}`,
          ["# 第一章", "", `这是第 ${b} 份材料的正文，用于五十年地平线集成审计。`, "", "# 第二章", "", "重复即记忆之母。"].join(NL)
        );
        itemIds.push({ itemId: r.id, documentId: r.documentId });
      }
      const cards = [];
      for (let i = 0; i < 200; i++) {
        const grp = i < 24 ? `sib-${Math.floor(i / 3)}` : null; // 前 24 张组成 8 个同源三元组
        const owner = itemIds[i % itemIds.length];
        const c = db0.createCard({
          noteText: `F34-C${i}`,
          cardType: "qa",
          frontMarkdown: `问题 ${i}`,
          backMarkdown: `答案 ${i}`,
          priority: 30 + (i % 70),
          tags: [],
          siblingKey: grp,
          sourceRef: { itemId: owner.itemId, documentId: owner.documentId },
        });
        cards.push({ id: c.id, itemId: owner.itemId, siblingKey: grp, spanYears: 1 + (i % YEARS) });
      }
      db0.persistNow();
      flow.check("播种 200 张卡 / 8 份材料成功", cards.length === 200 && itemIds.length === 8, "200/8", `${cards.length}/${itemIds.length}`);

      // 把 50 年跨度的历史灌进去（audit 直写，再重启进程才可见 —— §7.1.8）
      const a1 = await audit(dbFile);
      let seq = 1;
      let logCount = 0;
      const finalStates = new Map();
      for (const card of cards) {
        const spanStart = T_END - Math.round(card.spanYears * 365.25 * DAY);
        const n = 6 + Math.floor(rnd() * 22);
        const seqR = [];
        for (let k = 0; k < n; k++) {
          const x = rnd();
          seqR.push(x < 0.12 ? "Again" : x < 0.24 ? "Hard" : x < 0.94 ? "Good" : "Easy");
        }
        const logs = buildHistory(tsfs, rnd, seqR, spanStart);
        for (const L of logs) {
          const at = Math.min(L.at, T_END - HOUR);
          a1.exec(
            "INSERT INTO review_logs (id, card_id, rating, duration_ms, reviewed_at, fsrs_before_json, fsrs_after_json, review_seq) VALUES (?,?,?,?,?,?,?,?)",
            [
              `f34-l-${seq}`, card.id, L.rating, 4000 + Math.floor(rnd() * 6000), at,
              JSON.stringify(L.before), JSON.stringify(L.after), seq,
            ]
          );
          seq++; logCount++;
        }
        const last = logs[logs.length - 1];
        if (last) {
          const st = {
            state: ["new", "learning", "review", "relearning"][last.after.state] || "review",
            due: Math.min(last.after.due.getTime(), T_END + 400 * DAY),
            lapses: last.after.lapses, stability: last.after.stability, difficulty: last.after.difficulty,
            reps: last.after.reps, learningSteps: last.after.learning_steps ?? 0,
            lastReview: last.at,
          };
          finalStates.set(card.id, st);
          a1.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(st), card.id]);
        }
      }
      a1.save();
      a1.close();
      flow.record("灌入 review_logs 行数", logCount);
      flow.check("50 年史料非平凡（每卡平均 >10 条复习记录）", logCount > 2000, ">2000", logCount);

      const db = await reopenFlowDb(dir);

      // ── M1 队列口径唯一：computeTodayQueue(now) == listDueCards(now)，且不静默少卡 ──
      let mismatch = 0, lostFromUniverse = 0, dueAfterNow = 0;
      const sampleDays = [];
      for (let k = 0; k < 60; k++) sampleDays.push(T_START + Math.round((k / 59) * (T_END - T_START)));
      for (const t of sampleDays) {
        const q = db.computeTodayQueue(t);
        const l = db.listDueCards(t);
        if (JSON.stringify(q.cards.map((c) => c.id)) !== JSON.stringify(l.map((c) => c.id))) mismatch++;
        for (const c of q.cards) if ((c.fsrs?.due ?? 0) > t) dueAfterNow++;
        // 不静默少卡：任何 due≤t 且未挂起未损坏的卡，必须出现在 cards ∪ deferred
        const universe = db.listAllCards().filter((c) => !c.damaged && !c.leech?.suspended && (c.fsrs?.due ?? 0) <= t);
        const shown = new Set([...q.cards, ...q.deferred].map((c) => c.id));
        for (const c of universe) if (!shown.has(c.id)) lostFromUniverse++;
      }
      flow.check("60 个跨 50 年的时间点上队列口径唯一（§4.2-20）", mismatch === 0, "0 个不一致", mismatch);
      flow.check("队列成员 due 恒 ≤ now", dueAfterNow === 0, "0", dueAfterNow);
      flow.check("到期卡不静默消失（cards ∪ deferred 全覆盖，§4.16-7）", lostFromUniverse === 0, "0 张丢失", lostFromUniverse);

      // ── M2 同源当日只放行一张 ──
      // 注意：buryEligible（db.js:1286）明确豁免 learning/relearning（其 due 由学习步决定，
      // 延后会破坏步进），所以断言只能覆盖 new/review 两态——这是契约的一部分，不是漏网。
      let sibViolation = 0, sibChecked = 0;
      for (const t of sampleDays) {
        const q = db.computeTodayQueue(t);
        const seen = new Set();
        for (const c of q.cards) {
          if (!c.siblingKey) continue;
          const st = c.fsrs?.state;
          if (st !== "new" && st !== "review") continue;
          sibChecked++;
          if (seen.has(c.siblingKey)) sibViolation++;
          seen.add(c.siblingKey);
        }
      }
      flow.check("同源组同一学习日只放行一张（§4.16，M12；learning/relearning 按契约豁免）", sibViolation === 0 && sibChecked > 0, "0 违规且样本>0", `${sibViolation} 违规 / ${sibChecked} 样本`);

      // ── M3 KPI 与队列同口径（§4.16-6「口径唯一」）──
      const qNow = db.computeTodayQueue();
      const kpi = db.getStatsOverview().kpi;
      const kpiDue = kpi.dueToday ?? kpi.due ?? null;
      flow.record("今日到期：队列 vs KPI", `${qNow.cards.length} vs ${kpiDue}`);
      if (kpiDue != null) {
        flow.check("仪表盘「今日到期」与今日队列实发同数（§4.16-6）", kpiDue === qNow.cards.length, `${qNow.cards.length}`, kpiDue);
      } else {
        flow.check("KPI 暴露了今日到期字段", false, "有 dueToday/due", JSON.stringify(Object.keys(db.getStatsOverview().kpi)));
      }

      // ── M4 撤销守恒：50 年量级时间戳上 before/after 必须逐字段复原 ──
      const target = cards.find((c) => finalStates.get(c.id)?.state === "review");
      if (target) {
        const before = db.getCard(target.id);
        const beforeFsrs = JSON.stringify(before.fsrs);
        const logsBefore = db.listAllReviewLogs().filter((r) => r.cardId === target.id).length;
        // 评分后的状态由调用方给出（渲染层用 fsrsEngine 算，§4.4.3 预览=落库）；
        // 本层只验「写进去再撤回来」是否逐字段复原，故直接构造一个合法的后置状态。
        const b = before.fsrs;
        db.saveReview(target.id, {
          state: "review", due: b.due + 30 * DAY, lapses: (b.lapses || 0) + 1,
          stability: (b.stability || 5) * 1.9, difficulty: Math.min(10, (b.difficulty || 5) + 0.1),
          reps: (b.reps || 0) + 1, learningSteps: 0, lastReview: b.due,
        }, "Good", 5000, b);
        const afterFsrs = JSON.stringify(db.getCard(target.id).fsrs);
        flow.check("评分后确实落库（撤销前置条件）", afterFsrs !== beforeFsrs, "已变化", "未变化");
        const u = db.undoLastReview();
        const rF = db.getCard(target.id).fsrs || {};
        const diffFields = FIELDS8.filter((k) => String(rF[k]) !== String(b[k]));
        flow.check("撤销把 fsrs_json 逐字段复原（§4.4.9）", u?.ok === true && diffFields.length === 0, "ok:true 且八字段全等", `差异字段 ${JSON.stringify(diffFields.map((k) => [k, b[k], rF[k]]))}`);
        const logsAfter = db.listAllReviewLogs().filter((r) => r.cardId === target.id).length;
        flow.eq("撤销删掉且只删掉那一条 review_log", logsAfter, logsBefore);
      } else {
        flow.check("存在 review 态样本卡用于撤销验证", false, "≥1", "0");
      }

      // ── M5 坏数据闸门：50 年轴上的两类非法值不得毒化读侧 ──
      const a2 = await audit(dbFile);
      // (a) lastReview 在未来（时钟回拨 / 从超前机器恢复备份后的存量形态）
      a2.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", [
        JSON.stringify({ state: "review", due: T_END - DAY, lapses: 0, stability: 20, difficulty: 5, reps: 6, learningSteps: 0, lastReview: T_END + 400 * DAY }),
        cards[100].id,
      ]);
      // (b) 形状合法但值域非法：stability 负、difficulty 越界
      a2.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", [
        JSON.stringify({ state: "review", due: T_END - DAY, lapses: 0, stability: -1, difficulty: 99, reps: 3, learningSteps: 0, lastReview: T_END - 3 * DAY }),
        cards[101].id,
      ]);
      a2.save();
      a2.close();
      const db2 = await reopenFlowDb(dir);
      let poisonThrow = null, poisonedInQueue = [];
      try {
        const q2 = db2.computeTodayQueue();
        poisonedInQueue = [cards[100].id, cards[101].id].filter((id) => q2.cards.some((c) => c.id === id));
        flow.record("坏数据行被标 damaged", JSON.stringify([cards[100].id, cards[101].id].map((id) => !!db2.getCard(id)?.damaged)));
      } catch (e) {
        poisonThrow = `${e.constructor?.name}: ${e.message}`;
      }
      flow.check("读侧遇到未来 lastReview / 越界 stability 不抛错（批次 A 承诺）", poisonThrow === null, "不抛", String(poisonThrow));
      flow.check(
        "值域非法的 fsrs_json 被 damaged 闸门挡在队列外（§4.4.5 + 批次 A）",
        poisonThrow === null && poisonedInQueue.length === 0,
        "0 张进队列", `${poisonedInQueue.length} 张进队列: ${JSON.stringify(poisonedInQueue)}`
      );
      // 调度器侧：A-1 的修复落在**应用封装**边界（src/lib/fsrs.ts 把未来的 lastReview 钳到 now），
      // 所以这里必须测应用侧的 fsrsEngine，而不是 ts-fsrs 原生 repeat ——
      // 后者抛错是第三方库的既定行为，不是本项目的契约。
      let gradeThrow = null;
      try {
        const f = db2.getCard(cards[100].id).fsrs;
        const out = fsrsEngine.next(f, "Good", T_END);
        if (!Number.isFinite(out.fsrsState.due)) throw new Error("due 非有限：" + out.fsrsState.due);
      } catch (e) { gradeThrow = `${e.constructor?.name}: ${e.message}`; }
      flow.check("未来 lastReview 的卡经**应用侧**调度器不抛异常且 due 有限（A-1 回归位）", gradeThrow === null, "不抛", String(gradeThrow));

      // ── M6 落盘往返：50 年量级时间戳与超远 due 必须原样回来 ──
      db2.persistNow();
      const db3 = await reopenFlowDb(dir);
      const snapBefore = new Map(cards.map((c) => [c.id, JSON.stringify(db2.getCard(c.id)?.fsrs || null)]));
      let drift = 0, vanished = 0;
      for (const c of cards) {
        const now = db3.getCard(c.id);
        if (!now) { vanished++; continue; }
        if (JSON.stringify(now.fsrs) !== snapBefore.get(c.id)) drift++;
      }
      flow.check("重启后 200 张卡一张不少（§7.1.4）", vanished === 0, "0", vanished);
      flow.check("八字段逐毫秒往返一致（§4.4.5，含 50 年量级时间戳）", drift === 0, "0 张漂移", drift);

      // ── M7 值域与上限：50 年史后的全库事实 ──
      const poisonIds = new Set([cards[100].id, cards[101].id]);
      const all = db3.listAllCards().filter((c) => !poisonIds.has(c.id)).map((c) => c.fsrs).filter(Boolean);
      const badRange = all.filter((f) => !validFsrs(f));
      const overCap = all.filter((f) => Number.isFinite(f.due) && (f.due - (f.lastReview || f.due)) / DAY > MAX_IVL);
      flow.check("全库 fsrs 值域合法（S>0 / 1≤D≤10 / 时间戳有限）", badRange.length === 0, "0 张非法", `${badRange.length} 张：${JSON.stringify(badRange.slice(0, 2))}`);
      flow.check(`无卡的（lastReview→due）跨度越过 maximum_interval(${MAX_IVL})`, overCap.length === 0, "0", overCap.length);
      const farFuture = all.filter((f) => f.due > T_END + 10 * 365.25 * DAY).length;
      flow.record("due 落在 10 年以后的卡数", farFuture);
      flow.record("最远 due 距今（年）", Math.round((Math.max(...all.map((f) => f.due)) - T_END) / (365.25 * DAY) * 10) / 10);

      // ── M8 日桶：50 年史在统计侧的分群不得撞桶 / 漏桶 ──
      const logs = db3.listAllReviewLogs();
      const days = new Set(logs.map((r) => utcDay(r.reviewedAt)));
      const stamped = logs.filter((r) => Number.isFinite(r.reviewedAt));
      const spanDays = utcDay(Math.max(...stamped.map((r) => r.reviewedAt))) - utcDay(Math.min(...stamped.map((r) => r.reviewedAt)));
      flow.check("全部 review_log 都带有限时间戳", stamped.length === logs.length, `${logs.length}`, stamped.length);
      flow.check("复习记录横跨 40 年以上（史料确实铺开）", spanDays > 40 * 365, ">14600 天", spanDays);
      flow.check("日桶数不超过记录数（无 NaN/undefined 键造成的并桶）", days.size <= logs.length && !days.has(NaN), "≤", `${days.size}/${logs.length}`);
      const pre1970 = logs.filter((r) => r.reviewedAt < 0).length;
      flow.check("无负时间戳混入（50 年前起点若用相对减法会翻车）", pre1970 === 0, "0", pre1970);

      // ── M9 软删留痕：删掉一本 50 年史的书，卡与日志不得被物理带走 ──
      const victim = itemIds[7];
      db3.deleteItem(victim.itemId);
      const db4 = await reopenFlowDb(dir);
      const victimCards = cards.filter((c) => c.itemId === victim.itemId).map((c) => c.id);
      const q4 = db4.computeTodayQueue();
      const stillQueued = victimCards.filter((id) => q4.cards.some((c) => c.id === id) || q4.deferred.some((c) => c.id === id));
      // deleteItem（db.js:848）只软删 library_items/documents/assets，不动 cards。
      // 「删书后其派生卡该不该继续进复习队列」文档里没有既定决策（§7.2 只讲留痕、
      // 批次 B 的 D-TEST-12/23 只覆盖阅读历史与统计侧），故本处**只记录不判红**，
      // 留给用户裁定；一旦定策，把下面这行换成 check() 即可。
      flow.record("删书后仍在今日队列的派生卡数（待裁定：是否应随书退出）", `${stillQueued.length}/${victimCards.length}`);
      flow.record("这些卡的来源书已软删，「跳转原文」按 App.tsx:310 静默无提示", stillQueued.length > 0 ? "是" : "否");
      const a3 = await audit(dbFile);
      const cnt = (sql, prm) => Number(a3.one(sql, prm)?.n ?? -1);
      const rows = cnt(`SELECT COUNT(*) AS n FROM cards WHERE id IN (${victimCards.map(() => "?").join(",")})`, victimCards);
      const logsKept = cnt("SELECT COUNT(*) AS n FROM review_logs WHERE card_id = ?", [victimCards[0]]);
      a3.close();
      flow.check("软删留痕：行仍在库里未被物理删除（§7.2 L869）", rows === victimCards.length, `${victimCards.length}`, rows);
      flow.record("被删书的卡仍保留复习史行数", logsKept);
    });

    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F34 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
