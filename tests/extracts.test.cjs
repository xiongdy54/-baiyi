// v48.22 M16 批次 1 摘录调度内核回归测试（db 层，electron 直跑：npx electron tests/extracts.test.cjs，须先关应用）
// @runtime: electron  @tier: 2  @gui: false  @id: EXTRACTS  @timeout: 300
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§6.8-2（SM 调度语义）/ §6.8-4（双引擎无损）/ §6.8-7（撤销）/ §4.1（数据面）。规格 §J.2。
// 覆盖：次日进队 / 书优先级继承与实时跟随 / 读后推进 / 显式推迟 N 天 / ×a_factor 推迟与 180 天上限 /
//       单条优先级覆盖 / 毕业与排除式状态过滤 / 批量原子性与 SM 跳过条件 / 撤销（单条·批量·跨类顺序）/
//       引擎 A→B→A 往返逐字段无损 / review_seq 取全局计数器 / 每日用量派生
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DAY = 86400000;
const CUT = 0;

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "extracts-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    // 强制到期（测试构造：生产路径不提供该入口）
    const makeDue = (id, ts) => db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [ts ?? Date.now() - 1000, id]);
    const dayStart = (ts) => { const d = new Date(ts); d.setHours(CUT, 0, 0, 0); return d.getTime(); };
    const mkExtract = (docId, text, priority) =>
      db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: text, priority }).id;

    const bookA = db.createFromPaste("EXTRACTSTEST 甲书", "甲书正文");
    const bookB = db.createFromPaste("EXTRACTSTEST 乙书", "乙书正文");

    // ---------------------------------------------------------------- E1
    console.log("== E1 次日进队（§6.8-2，用户裁定 O-4） ==");
    const now0 = Date.now();
    const ex1 = mkExtract(bookA.documentId, "E1 摘录甲", undefined);
    const row1 = db.getExtract(ex1);
    const expectNext = dayStart(now0) + DAY;
    check("新建摘录 next_at = 下一个学习日切点", row1.topicNextAt === expectNext, expectNext, row1.topicNextAt);
    const dueNowList = db.listDueExtracts();
    check(
      "新建摘录当日不进到期队列",
      !dueNowList.some((e) => e.id === ex1),
      `未含 ex1（nextAt 距今 ${((row1.topicNextAt - Date.now()) / 60000).toFixed(1)} 分钟）`,
      `到期队列 ${dueNowList.length} 条：${dueNowList.map((e) => `${e.id === ex1 ? "◀ex1 " : ""}${e.topicNextAt}`).join(",")}`
    );
    check("新建摘录状态为 open", row1.status === "open", "open", row1.status);
    check("新建摘录 a_factor 默认 1.6（与旧 ×1.6 等值）", row1.aFactor === 1.6, 1.6, row1.aFactor);
    check("新建摘录 process_count/postpone_count 归零", row1.processCount === 0 && row1.postponeCount === 0, "0/0", `${row1.processCount}/${row1.postponeCount}`);
    makeDue(ex1);
    check("强制到期后进入队列", db.listDueExtracts().some((e) => e.id === ex1), true, false);

    // ---------------------------------------------------------------- E2
    console.log("== E2 书级优先级：继承 + 实时跟随 + 单条覆盖（§4.1 / G1） ==");
    check("书默认优先级 50", db.setLibraryItemPriority(bookA.id, 50).priority === 50, 50, null);
    const exInherit = mkExtract(bookA.documentId, "E2 继承书优先级", undefined);
    check("未指定时继承书的优先级", db.getExtract(exInherit).priority === 50, 50, db.getExtract(exInherit).priority);
    check("继承来源标记为 book", db.getExtract(exInherit).prioritySource === "book", "book", db.getExtract(exInherit).prioritySource);
    const follow = db.setLibraryItemPriority(bookA.id, 20);
    check("改书优先级后继承型摘录实时跟随", db.getExtract(exInherit).priority === 20, 20, db.getExtract(exInherit).priority);
    check("跟随条数上报", follow.followedExtracts >= 1, ">=1", follow.followedExtracts);
    const exOverride = mkExtract(bookA.documentId, "E2 单条覆盖", undefined);
    db.setExtractPriority(exOverride, 90);
    check("单条改优先级后 source=user", db.getExtract(exOverride).prioritySource === "user", "user", db.getExtract(exOverride).prioritySource);
    db.setLibraryItemPriority(bookA.id, 70);
    check("覆盖型摘录不跟随书改动", db.getExtract(exOverride).priority === 90, 90, db.getExtract(exOverride).priority);
    check("覆盖型改书优先级也不动 source", db.getExtract(exOverride).prioritySource === "user", "user", db.getExtract(exOverride).prioritySource);

    // ---------------------------------------------------------------- E3
    console.log("== E3 读后推进 advance（§6.8-2「下一条」） ==");
    const exAdv = mkExtract(bookB.documentId, "E3 推进", undefined);
    const t0 = Date.now();
    const a1 = db.advanceExtract(exAdv, t0);
    check("首次推进 interval = 1 × 1.6", Math.abs(a1.intervalDays - 1.6) < 1e-9, 1.6, a1.intervalDays);
    check("next_at = now + interval 天", a1.nextAt === t0 + Math.round(1.6 * DAY), t0 + Math.round(1.6 * DAY), a1.nextAt);
    check("process_count 递增到 1", db.getExtract(exAdv).processCount === 1, 1, db.getExtract(exAdv).processCount);
    check("状态 open → reading", db.getExtract(exAdv).status === "reading", "reading", db.getExtract(exAdv).status);
    const a2 = db.advanceExtract(exAdv, t0 + DAY);
    const a3 = db.advanceExtract(exAdv, t0 + 2 * DAY);
    check("推进间隔严格单调递增", a1.intervalDays < a2.intervalDays && a2.intervalDays < a3.intervalDays, "递增", [a1.intervalDays, a2.intervalDays, a3.intervalDays]);
    check("推进三次后 process_count = 3", db.getExtract(exAdv).processCount === 3, 3, db.getExtract(exAdv).processCount);
    check("推进不写 review_logs（§4.12 边界）", db.listAllReviewLogs().length === 0, 0, db.listAllReviewLogs().length);

    // ---------------------------------------------------------------- E4
    console.log("== E4 推迟两条路径：显式天数 与 ×a_factor（§6.8-2） ==");
    const exDays = mkExtract(bookB.documentId, "E4 显式推迟", undefined);
    const t1 = Date.now();
    const d1 = db.postponeExtractDays(exDays, 10);
    const rd = db.getExtract(exDays);
    check("显式推迟：interval_days = N（覆盖式）", rd.intervalDays === 10, 10, rd.intervalDays);
    check("显式推迟：next_at = now + N 天", d1.nextAt === t1 + 10 * DAY || Math.abs(d1.nextAt - (Date.now() + 10 * DAY)) < 50, "≈now+10d", d1.nextAt);
    check("显式推迟：postpone_count++", rd.postponeCount === 1, 1, rd.postponeCount);
    check("显式推迟：状态 postponed", rd.status === "postponed", "postponed", rd.status);
    const d0 = db.postponeExtractDays(exDays, 0);
    check("显式推迟下限 1 天（SM：至少比今天多 1 天）", d0.intervalDays === 1, 1, d0.intervalDays);
    const exFactor = mkExtract(bookB.documentId, "E4 倍率推迟", undefined);
    const f1 = db.postponeExtract(exFactor);
    check("×a_factor 推迟：1 → 1.6（与旧实现逐值等值）", f1.intervalDays === 1.6, 1.6, f1.intervalDays);
    db.execRawSql("UPDATE extracts SET interval_days = 150, a_factor = 1.6 WHERE id = ?", [exFactor]);
    const f2 = db.postponeExtract(exFactor);
    check("×a_factor 推迟封顶 180 天", f2.intervalDays === 180, 180, f2.intervalDays);
    const exCap = mkExtract(bookB.documentId, "E4 已封顶", undefined);
    db.execRawSql("UPDATE extracts SET interval_days = 180 WHERE id = ?", [exCap]);
    check("已到 180 天不再增长", db.postponeExtract(exCap).intervalDays === 180, 180, db.postponeExtract(exCap).intervalDays);

    // ---------------------------------------------------------------- E5
    console.log("== E5 毕业与排除式状态过滤（§6.4.2 前向兼容） ==");
    const exGrad = mkExtract(bookA.documentId, "E5 毕业", undefined);
    makeDue(exGrad);
    check("毕业前在到期队列", db.listDueExtracts().some((e) => e.id === exGrad), true, false);
    db.setExtractStatus(exGrad, "resolved", null, "graduate");
    check("毕业后不在到期队列", !db.listDueExtracts().some((e) => e.id === exGrad), false, true);
    const gradRow = db.getExtract(exGrad);
    check("毕业后行仍在（不删不归档）", Boolean(gradRow), true, gradRow);
    check("毕业写 graduatedAt", typeof JSON.parse(gradRow.statusDetailJson || "{}").graduatedAt === "number", true, gradRow.statusDetailJson);
    db.setExtractStatus(exGrad, "open", null, "ungraduate");
    check("召回后回到到期队列", db.listDueExtracts().some((e) => e.id === exGrad), true, false);
    const exUnknown = mkExtract(bookA.documentId, "E5 未知状态", undefined);
    makeDue(exUnknown);
    db.execRawSql("UPDATE extracts SET status = 'future-unknown-status' WHERE id = ?", [exUnknown]);
    check("未知状态按 open 对待（前向兼容：仍在队列）", db.listDueExtracts().some((e) => e.id === exUnknown), true, false);
    const exArchived = mkExtract(bookA.documentId, "E5 归档", undefined);
    makeDue(exArchived);
    db.setExtractStatus(exArchived, "archived");
    check("archived 排除出队列", !db.listDueExtracts().some((e) => e.id === exArchived), false, true);

    // ---------------------------------------------------------------- E6
    console.log("== E6 编辑正文与撤销 ==");
    const exEdit = mkExtract(bookA.documentId, "E6 原文", undefined);
    db.updateExtract(exEdit, { contentMarkdown: "E6 改后正文" });
    check("正文已改", db.getExtract(exEdit).contentMarkdown === "E6 改后正文", "E6 改后正文", db.getExtract(exEdit).contentMarkdown);
    const u1 = db.undoLast();
    check("撤销编辑：恢复旧正文", db.getExtract(exEdit).contentMarkdown === "E6 原文", "E6 原文", db.getExtract(exEdit).contentMarkdown);
    db.updateExtract(exEdit, { contentMarkdown: "E6 再来一次" });
    const againU = db.undoLast();
    check("撤销可重复（每次都能撤销最近一次）", againU.ok === true, true, againU);

    console.log("== E7 撤销：推迟 / 推进 / 毕业 / 删除 ==");
    const exU = mkExtract(bookB.documentId, "E7 撤销样本", undefined);
    const snapBefore = db.getExtract(exU);
    db.postponeExtractDays(exU, 30);
    db.undoLast();
    const afterUndoPostpone = db.getExtract(exU);
    check("撤销推迟：interval 复原", afterUndoPostpone.intervalDays === snapBefore.intervalDays, snapBefore.intervalDays, afterUndoPostpone.intervalDays);
    check("撤销推迟：postpone_count 复原", afterUndoPostpone.postponeCount === 0, 0, afterUndoPostpone.postponeCount);
    check("撤销推迟：状态复原", afterUndoPostpone.status === "open", "open", afterUndoPostpone.status);
    check("撤销推迟：next_at 复原", afterUndoPostpone.topicNextAt === snapBefore.topicNextAt, snapBefore.topicNextAt, afterUndoPostpone.topicNextAt);
    db.advanceExtract(exU);
    db.undoLast();
    const afterUndoAdvance = db.getExtract(exU);
    check("撤销推进：process_count 复原", afterUndoAdvance.processCount === 0, 0, afterUndoAdvance.processCount);
    check("撤销推进：interval 复原", afterUndoAdvance.intervalDays === 1, 1, afterUndoAdvance.intervalDays);
    db.setExtractStatus(exU, "resolved", null, "graduate");
    db.undoLast();
    check("撤销毕业：状态复原 open", db.getExtract(exU).status === "open", "open", db.getExtract(exU).status);
    db.setExtractPriority(exU, 12);
    db.undoLast();
    check("撤销改优先级：值复原", db.getExtract(exU).priority === snapBefore.priority, snapBefore.priority, db.getExtract(exU).priority);
    check("撤销改优先级：source 复原", db.getExtract(exU).prioritySource === "book", "book", db.getExtract(exU).prioritySource);
    db.deleteExtract(exU);
    check("删除后 getExtract 取不到（软删）", db.getExtract(exU) === null, null, db.getExtract(exU));
    db.undoLast();
    check("撤销删除：行复活", Boolean(db.getExtract(exU)), true, false);

    // ---------------------------------------------------------------- E8
    console.log("== E8 批量：单事务 + 单 batch_id + 整批回退 + SM 跳过条件 ==");
    const bIds = [0, 1, 2].map((i) => mkExtract(bookA.documentId, `E8 批量 ${i}`, undefined));
    const before8 = bIds.map((id) => db.getExtract(id).intervalDays);
    const rb = db.batchExtractOps("postponeDays", bIds, { days: 7 });
    check("批量推迟：命中 3 条", rb.count === 3, 3, rb.count);
    check("批量推迟：逐条 interval = 7", bIds.every((id) => db.getExtract(id).intervalDays === 7), 7, bIds.map((id) => db.getExtract(id).intervalDays));
    check("批量是一个 batch_id", typeof rb.batchId === "string" && rb.batchId.length > 0, true, rb.batchId);
    const ub = db.undoLast();
    check("撤销批量：一次回退整批", ub.ok === true && ub.count === 3, "ok/count=3", ub);
    check("撤销批量：三条全部复原", bIds.every((id, i) => db.getExtract(id).intervalDays === before8[i]), before8, bIds.map((id) => db.getExtract(id).intervalDays));
    const badBatch = db.batchExtractOps("postponeDays", [bIds[0], "no-such-id"], { days: 5 });
    check("批量含不存在条目：整批拒绝", badBatch.ok === false, false, badBatch);
    check("批量拒绝后首条未被改动", db.getExtract(bIds[0]).intervalDays === before8[0], before8[0], db.getExtract(bIds[0]).intervalDays);
    db.execRawSql("UPDATE extracts SET interval_days = 3000 WHERE id = ?", [bIds[0]]);
    const skipRes = db.batchExtractOps("postpone", bIds, null);
    check("批量推迟跳过条件：间隔 > 2500 天被跳过", skipRes.skipped.some((s) => s.id === bIds[0]), true, skipRes.skipped);
    check("批量推迟跳过条件：其余仍执行", skipRes.count === 2, 2, skipRes.count);
    db.undoLast();

    // ---------------------------------------------------------------- E9
    console.log("== E9 跨类撤销顺序（卡片评分 ↔ 摘录操作） ==");
    const before9 = { state: "new", due: Date.now() - 1000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] };
    const after9 = { ...before9, state: "review", reps: 1, lastReview: Date.now(), due: Date.now() + DAY };
    const cardId = db.createCard({
      noteText: "EXTRACTSTEST 跨类卡", cardType: "qa", frontMarkdown: "题", backMarkdown: "答",
      priority: 50, tags: [], fsrsJson: JSON.stringify(before9)
    }).id;
    const exCross = mkExtract(bookB.documentId, "E9 跨类摘录", undefined);
    db.saveReview(cardId, after9, "Good", 100, before9);
    db.postponeExtractDays(exCross, 5);
    const info1 = db.getUndoInfo();
    check("最近一次是摘录操作", info1.kind === "extract_op" && info1.opType === "postpone", "extract_op/postpone", info1);
    const cu1 = db.undoLast();
    check("先撤销摘录操作", cu1.ok === true && cu1.kind === "extract_op", true, cu1);
    check("摘录已复原", db.getExtract(exCross).intervalDays === 1, 1, db.getExtract(exCross).intervalDays);
    const info2 = db.getUndoInfo();
    check("再往前是卡片评分", info2.kind === "card_grade", "card_grade", info2);
    const cu2 = db.undoLast();
    check("再撤销卡片评分", cu2.ok === true, true, cu2);
    check("卡片回到新卡（reps 归零）", db.getCard(cardId).fsrs.reps === 0, 0, db.getCard(cardId).fsrs.reps);
    const nextInfo = db.getUndoInfo();
    check("再往前是更早的摘录操作（线性撤销栈，不跳序）", nextInfo.kind === "extract_op", "extract_op", nextInfo);
    let drained = null;
    for (let i = 0; i < 80; i++) {
      drained = db.undoLast();
      if (!drained.ok) break;
    }
    check("排空后如实返回 ok=false（不抛错、不误撤）", drained && drained.ok === false, false, drained);
    check("排空后 getUndoInfo 报不可用", db.getUndoInfo().available === false, false, db.getUndoInfo());

    // ---------------------------------------------------------------- E10
    console.log("== E10 review_seq 语义不变（与 op_journal 计数器相互独立） ==");
    const seqBefore = db.listAllReviewLogs().length;
    const before10 = { state: "new", due: Date.now() - 1000, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] };
    const after10 = { ...before10, state: "review", reps: 1, lastReview: Date.now(), due: Date.now() + DAY };
    const card2 = db.createCard({
      noteText: "EXTRACTSTEST 计数器卡", cardType: "qa", frontMarkdown: "题2", backMarkdown: "答2",
      priority: 50, tags: [], fsrsJson: JSON.stringify(before10)
    }).id;
    db.saveReview(card2, after10, "Good", 0, before10);
    check("评分写入日志", db.listAllReviewLogs().length === seqBefore + 1, seqBefore + 1, db.listAllReviewLogs().length);
    const seqs = db.listAllReviewLogs().map((l) => l.reviewSeq ?? l.review_seq);
    check("review_seq 严格单调（禁按 id/时间排序）", seqs.every((s, i) => i === 0 || Number(s) > Number(seqs[i - 1])), "严格递增", seqs);

    // ---------------------------------------------------------------- E11
    console.log("== E11 引擎切换 A→B→A 逐字段无损（§6.8-4） ==");
    const exSw = mkExtract(bookA.documentId, "E11 切换样本", undefined);
    makeDue(exSw);
    db.advanceExtract(exSw, Date.now());
    db.postponeExtract(exSw);
    const snapA = db.getExtract(exSw);
    const schedA = { nextAt: snapA.topicNextAt, intervalDays: snapA.intervalDays, aFactor: snapA.aFactor, postponeCount: snapA.postponeCount, processCount: snapA.processCount, priority: snapA.priority };
    const sw1 = db.switchExtractEngine("ai-next-extract");
    check("切到实验引擎成功且记录 from", sw1.ok === true && sw1.engine === "ai-next-extract" && sw1.from === "sm19-default", "ai/from-sm", sw1);
    check("冷启动计数（首次切到实验引擎）", sw1.coldStart >= 1, ">=1", sw1.coldStart);
    const bState = db.getExtract(exSw);
    check("切换后公共列 = 目标引擎子空间（冷启动＝当前投影）", bState.intervalDays === snapA.intervalDays, snapA.intervalDays, bState.intervalDays);
    const aiSub = JSON.parse(bState.engineStateJson || "{}")["ai-next-extract"];
    check("实验引擎子空间已建立", Boolean(aiSub), true, Object.keys(JSON.parse(bState.engineStateJson || "{}")));
    // 实验引擎期间独占写入：只动自己的子空间与公共列
    db.postponeExtractDays(exSw, 42);
    const aiAfter = JSON.parse(db.getExtract(exSw).engineStateJson || "{}");
    check("B 期间写入落在 B 子空间", aiAfter["ai-next-extract"].intervalDays === 42, 42, aiAfter["ai-next-extract"]?.intervalDays);
    check("B 期间 A 子空间保持冻结", eq(aiAfter["sm19-default"], schedA), schedA, aiAfter["sm19-default"]);
    const sw2 = db.switchExtractEngine("sm19-default", "ai-next-extract");
    check("切回 SM 引擎成功", sw2.ok === true && sw2.engine === "sm19-default", "sm19", sw2);
    const back = db.getExtract(exSw);
    const schedBack = { nextAt: back.topicNextAt, intervalDays: back.intervalDays, aFactor: back.aFactor, postponeCount: back.postponeCount, processCount: back.processCount, priority: back.priority };
    check("A→B→A 往返：A 调度状态逐字段等值", eq(schedBack, schedA), schedA, schedBack);
    const afterRound = JSON.parse(back.engineStateJson || "{}");
    check("往返后 A 子空间逐字段等值", eq(afterRound["sm19-default"], schedA), schedA, afterRound["sm19-default"]);
    check("往返后 B 子空间的既有值仍在（B 侧数据未丢）", afterRound["ai-next-extract"].intervalDays === 42, 42, afterRound["ai-next-extract"]?.intervalDays);

    // ---------------------------------------------------------------- E12
    console.log("== E12 每日用量派生（零新状态） ==");
    const usage = db.getDailyUsage();
    check("学习日起点 = 本地钟面切点", usage.learningDayStart === dayStart(Date.now()), dayStart(Date.now()), usage.learningDayStart);
    check("卡片复习数 ≥ 1（本测试写过日志）", usage.cardReviews >= 1, ">=1", usage.cardReviews);
    check("四类计数齐备且为数字", [usage.newCards, usage.cardReviews, usage.newExtracts, usage.extractReviews].every((n) => Number.isInteger(n)), "int×4", usage);
    check("摘录处理数 ≥ 1（本测试有过 advance/postpone）", usage.extractReviews >= 1, ">=1", usage.extractReviews);

    // ---------------------------------------------------------------- E13
    console.log("== E13 会话队列（§6.8-3）：退化 / 混编 / 零写库 ==");
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    const T = Date.now() + 3 * DAY; // 未来时刻：该学习日用量为 0，隔离前面用例写下的复习日志
    const NO_LIMITS = { newCardsPerDay: 0, cardReviewsPerDay: 0, newExtractsPerDay: 0, extractReviewsPerDay: 0, ignoreReviewLimitForNew: false };
    const setLimits = (patch) => {
      const all = settingsStore.readSettings();
      all.app = { ...(all.app || {}), limits: { ...NO_LIMITS, ...patch } };
      settingsStore.writeSettings(all);
    };
    setLimits({});
    const rawQ = db.computeTodayQueue(T);
    const degraded = db.computeSessionQueue(T, { mergeIntoReview: false });
    check("退化：关闭合并时 cards 与 computeTodayQueue().cards 逐 id 相等", eq(degraded.cards.map((c) => c.id), rawQ.cards.map((c) => c.id)), rawQ.cards.map((c) => c.id).join(","), degraded.cards.map((c) => c.id).join(","));
    check("退化：items 全为卡片", degraded.items.every((i) => i.kind === "card"), true, degraded.items.map((i) => i.kind).join(","));
    const e13Ids = [0, 1, 2, 3, 4].map((i) => mkExtract(bookB.documentId, `E13 摘录 ${i}`, undefined));
    e13Ids.forEach((id) => makeDue(id, T - 1000));
    const mergedQ = db.computeSessionQueue(T, { mergeIntoReview: true, interleave: "quota-1-4" });
    check("前置对照：本场景至少有 1 张卡与 1 条摘录（防止空转通过）", mergedQ.cards.length >= 1 && mergedQ.extracts.length >= 1, ">=1/>=1", `${mergedQ.cards.length}/${mergedQ.extracts.length}`);
    check("quota-1-4：条目总数 = 卡片数 + 摘录数（不丢条）", mergedQ.items.length === mergedQ.cards.length + mergedQ.extracts.length, mergedQ.cards.length + mergedQ.extracts.length, mergedQ.items.length);
    let seenCards = 0;
    let quotaOk = true;
    let tailStarted = false;
    for (const it of mergedQ.items) {
      if (it.kind === "card") {
        if (tailStarted) quotaOk = false;
        seenCards += 1;
        continue;
      }
      if (seenCards >= mergedQ.cards.length && mergedQ.cards.length > 0) { tailStarted = true; continue; }
      if (seenCards === 0 || seenCards % 4 !== 0) quotaOk = false;
    }
    check("quota-1-4：摘录只出现在第 4/8/… 张卡之后或卡片耗尽后的追加段", quotaOk, true, mergedQ.items.map((i) => i.kind).join(","));
    const byDue = db.computeSessionQueue(T, { mergeIntoReview: true, interleave: "by-due" });
    const times = byDue.items.map((it) => (it.kind === "card" ? Number(it.card.fsrs?.due ?? T) : Number(it.extract.topicNextAt)));
    check("by-due：条目按到期时间非递减", times.every((t, i) => i === 0 || t >= times[i - 1]), "非递减", times.join(","));
    const snapBefore13 = JSON.stringify(db.listAllCards().map((c) => [c.id, c.fsrs?.due, c.fsrs?.reps, c.priority])) + "|" + JSON.stringify(e13Ids.map((id) => { const e = db.getExtract(id); return [e.topicNextAt, e.intervalDays, e.postponeCount, e.processCount, e.priority, e.status]; }));
    db.computeSessionQueue(T, { mergeIntoReview: true, interleave: "quota-1-4" });
    db.computeSessionQueue(T, { mergeIntoReview: true, interleave: "by-due" });
    const snapAfter13 = JSON.stringify(db.listAllCards().map((c) => [c.id, c.fsrs?.due, c.fsrs?.reps, c.priority])) + "|" + JSON.stringify(e13Ids.map((id) => { const e = db.getExtract(id); return [e.topicNextAt, e.intervalDays, e.postponeCount, e.processCount, e.priority, e.status]; }));
    check("会话队列零写库（切换混编模式不改任何调度状态）", snapBefore13 === snapAfter13, "逐字段相等", snapBefore13 === snapAfter13 ? "相等" : "有变化");

    // ---------------------------------------------------------------- E14
    console.log("== E14 每日上限（§6.8-5）：余额截断 / 结构闸 / 硬边界 / 建议档 ==");
    setLimits({ newCardsPerDay: 1, cardReviewsPerDay: 100 });
    const lim1 = db.computeSessionQueue(T, { mergeIntoReview: false });
    const newServed = lim1.cards.filter((c) => (c.fsrs?.reps ?? 0) === 0).length;
    check("新卡额度 1 ⇒ 会话至多放 1 张新卡", newServed <= 1, "<=1", newServed);
    check("被截断的卡片在库内仍 due（零写库）", lim1.blocked.cards.every((c) => Number(c.fsrs?.due ?? 0) <= T), true, lim1.blocked.cards.length);
    setLimits({ newCardsPerDay: 0, cardReviewsPerDay: 1, ignoreReviewLimitForNew: false });
    const gateNow = Date.now();
    const gated = db.computeSessionQueue(gateNow, { mergeIntoReview: true });
    check("结构闸：总预算用尽 ⇒ 卡片零放行", gated.cards.length === 0, 0, gated.cards.length);
    check("结构闸：新摘录一并停发（未处理过的摘录不出现）", gated.extracts.every((e) => (Number(e.processCount) || 0) > 0), true, gated.extracts.length);
    setLimits({ newCardsPerDay: 0, cardReviewsPerDay: 1, ignoreReviewLimitForNew: true });
    const gated2 = db.computeSessionQueue(gateNow, { mergeIntoReview: true });
    check("ignore 开启：新卡可突破已用尽的总预算（Anki 同名语义）", gated2.cards.some((c) => (c.fsrs?.reps ?? 0) === 0), true, gated2.cards.length);
    const vBad = db.validateLimits({ newCardsPerDay: 20, cardReviewsPerDay: 50 });
    check("硬边界：复习上限 < 新上限×5 ⇒ 拒绝", vBad.ok === false && vBad.errors.length > 0, false, vBad.errors);
    const vOk = db.validateLimits({ newCardsPerDay: 20, cardReviewsPerDay: 100 });
    check("硬边界：×5 刚好通过", vOk.ok === true, true, vOk.errors);
    check("建议档：低于 ×10 给非阻断提示（有提示、无错误）", vOk.advisory.length > 0 && vOk.errors.length === 0, "有提示无错误", vOk.advisory);
    const vUn = db.validateLimits({ newCardsPerDay: 20, cardReviewsPerDay: 0 });
    check("0 = 不限制，不参与关系约束", vUn.ok === true, true, vUn.errors);

    // ---------------------------------------------------------------- E15
    console.log("== E15 复习范围（筛选牌组）：按书 / 按类别 / 只能收紧 ==");
    setLimits({});
    const allPool = db.computeSessionQueue(T, { mergeIntoReview: true });
    const scopedBook = db.computeSessionQueue(T, { mergeIntoReview: true, scope: { bookItemIds: [bookB.id] } });
    check("按书范围：卡片全部来自该书", scopedBook.cards.every((c) => c.libraryItemId === bookB.id), true, scopedBook.cards.map((c) => c.libraryItemId).join(","));
    check("按书范围：摘录全部来自该书", scopedBook.extracts.every((e) => e.libraryItemId === bookB.id), true, scopedBook.extracts.map((e) => e.libraryItemId).join(","));
    check("按书范围：范围外卡片一条不留", scopedBook.cards.length < allPool.cards.length, `<${allPool.cards.length}`, scopedBook.cards.length);
    const onlyExtract = db.computeSessionQueue(T, { mergeIntoReview: true, scope: { kinds: ["extract"] } });
    check("按类别范围：只出摘录", onlyExtract.items.length > 0 && onlyExtract.items.every((i) => i.kind === "extract"), true, onlyExtract.items.map((i) => i.kind).join(","));
    setLimits({ extractReviewsPerDay: 30 });
    const tighten = db.computeSessionQueue(T, { mergeIntoReview: true, scope: { limits: { extractReviewsPerDay: 3 } } });
    check("范围只能收紧：覆盖为更小值生效", tighten.limits.extractReviewsPerDay === 3, 3, tighten.limits.extractReviewsPerDay);
    const widen = db.computeSessionQueue(T, { mergeIntoReview: true, scope: { limits: { extractReviewsPerDay: 999 } } });
    check("范围不能放宽：取全局与范围的最小值", widen.limits.extractReviewsPerDay === 30, 30, widen.limits.extractReviewsPerDay);
    check("范围存储零 schema 变更（settings.app.reviewScopes 可读）", Array.isArray(db.readReviewScopes()), true, typeof db.readReviewScopes());

    console.log(`\n==== extracts.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
    app.quit();
    process.exitCode = fail === 0 ? 0 : 1;
  }
});
