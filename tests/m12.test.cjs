// v34 M12 同源卡延后 Sibling Burying 回归测试（db 层，electron 直跑：npx electron tests/m12.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§4.16 + D33——延后是队列视图（不写 fsrs_json/不改 due/不写 review_logs），口径唯一（§4.2-20）。
// 覆盖：组额度规则（perDay/已评分消耗/步进卡豁免/挂起排除）/ 长选区不建组 / 开关矩阵 /
//       延后零写库不变量 / 撤销额度回收 / 跨日时间注入解封 / 统计同口径 / siblingKeyFor 键规则矩阵
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = require("path").resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m12-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    await db.initDb();

    const NOW = Date.now();
    const PAST_DUE = Date.parse("2000-01-01T00:00:00Z");
    // 新卡：due=过去（立即到期），state=new（fsrs 全字段，§4.4.1）
    const newFsrs = (due = PAST_DUE) => JSON.stringify({ state: "new", due, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
    // D239：规范序 = due → created_at → id。同一毫秒内连建的卡 created_at 相同，次序就退化成随机 id 序，
    // 「次日放行次序第 2 张」会随机失败（以前 app.quit() 退出码恒 0，把这种失败掩盖了）。
    // 建卡前等时钟走过上一张的毫秒，保证 created_at 严格递增、次序确定。
    let lastCreatedAt = 0;
    const mkCard = (note, extra = {}) => {
      while (Date.now() <= lastCreatedAt) { /* 自旋至多 1ms */ }
      lastCreatedAt = Date.now();
      return db.createCard({
        noteText: note, cardType: "qa", frontMarkdown: note, backMarkdown: "答案",
        priority: 50, tags: [], fsrsJson: newFsrs(), ...extra
      }).id;
    };

    function setBury(patch) {
      const cur = settingsStore.readSettings();
      cur.app = { ...(cur.app || {}), siblingBury: { enabled: true, newCards: true, reviewCards: true, perDay: 1, sourceTextLimit: 300, ...patch } };
      settingsStore.writeSettings(cur);
    }
    function clearBury() {
      const cur = settingsStore.readSettings();
      delete (cur.app || {}).siblingBury;
      settingsStore.writeSettings(cur);
    }

    console.log("== M12-1 同源 3 卡同组：今日只放行 1 张，延后不写库 ==");
    setBury({});
    const g1a = mkCard("FSRSTEST M12 同源甲", { siblingKey: "src:doc1:h1", priority: 50 });
    const g1b = mkCard("FSRSTEST M12 同源乙", { siblingKey: "src:doc1:h1", priority: 50 });
    const g1c = mkCard("FSRSTEST M12 同源丙", { siblingKey: "src:doc1:h1", priority: 50 });
    let q = db.computeTodayQueue(NOW);
    check("同组 3 张只放行 1 张", q.cards.length === 1, 1, q.cards.length);
    check("放行的是规范序队首（created_at 最早）", q.cards[0]?.id === g1a, g1a, q.cards[0]?.id);
    check("其余 2 张延后", q.deferred.length === 2, 2, q.deferred.length);
    check("延后原因 kind=revealed 且指向已放行卡", q.deferred.every((c) => c.deferReason?.kind === "revealed" && c.deferReason?.siblingCardId === g1a), { kind: "revealed", siblingCardId: g1a }, q.deferred.map((c) => c.deferReason));
    const fsrsBefore = [g1b, g1c].map((id) => db.getCard(id).fsrs);
    const dueBefore = [g1b, g1c].map((id) => db.getCard(id).fsrs.due);
    const logCountBefore = db.listAllReviewLogs().length;
    db.computeTodayQueue(NOW); db.computeTodayQueue(NOW); // 视图可重复计算，绝无副作用
    check("核心不变量：延后卡的 fsrs_json/due 逐字段零变化", eq([g1b, g1c].map((id) => db.getCard(id).fsrs), fsrsBefore) && eq([g1b, g1c].map((id) => db.getCard(id).fsrs.due), dueBefore), fsrsBefore, [g1b, g1c].map((id) => db.getCard(id).fsrs));
    check("延后不产生 review_logs", db.listAllReviewLogs().length === logCountBefore, logCountBefore, db.listAllReviewLogs().length);
    check("listDueCards 与 computeTodayQueue().cards 同一结果", eq(db.listDueCards(NOW), q.cards), true, "口径一致");

    console.log("== M12-2 答一张 → 全组当日不放行（kind=reviewed） ==");
    const winnerFsrs = db.getCard(g1a).fsrs;
    db.saveReview(g1a, { ...winnerFsrs, state: "review", due: NOW + 2 * 86400000, reps: 1, lastReview: NOW, learningSteps: [] }, "Good", 100, winnerFsrs);
    q = db.computeTodayQueue(NOW);
    check("评分后该组当日 0 张放行", q.cards.filter((c) => c.siblingKey === "src:doc1:h1").length === 0, 0, q.cards.filter((c) => c.siblingKey === "src:doc1:h1").length);
    check("2 张兄弟卡延后且原因 kind=reviewed", q.deferred.length === 2 && q.deferred.every((c) => c.deferReason?.kind === "reviewed" && c.deferReason?.siblingCardId === g1a), { n: 2, kind: "reviewed" }, q.deferred.map((c) => c.deferReason?.kind));
    check("被延后卡 fsrs 依旧零变化", eq([g1b, g1c].map((id) => db.getCard(id).fsrs), fsrsBefore), true, "fsrs 未动");

    console.log("== M12-3 撤销评分 → 额度自动回收，放行顺序稳定 ==");
    const u = db.undoLastReview();
    check("撤销成功", u.ok === true, true, u);
    q = db.computeTodayQueue(NOW);
    check("撤销后恢复 1 放 2 延", q.cards.length === 1 && q.deferred.length === 2, { cards: 1, deferred: 2 }, { cards: q.cards.length, deferred: q.deferred.length });
    check("放行顺序稳定：仍是首张", q.cards[0]?.id === g1a, g1a, q.cards[0]?.id);
    db.saveReview(g1a, { ...db.getCard(g1a).fsrs, state: "review", due: NOW + 2 * 86400000, reps: 1, lastReview: NOW }, "Good", 100, db.getCard(g1a).fsrs);

    console.log("== M12-4 跨日时间注入：次日额度重置，解封下一张 ==");
    const tomorrow = NOW + 25 * 3600000;
    q = db.computeTodayQueue(tomorrow);
    check("次日组内放行 1 张（次序第 2 张）", q.cards.length === 1 && q.cards[0]?.id === g1b, g1b, q.cards[0]?.id);
    check("次日仍延后最后一张", q.deferred.length === 1 && q.deferred[0]?.id === g1c, g1c, q.deferred[0]?.id);

    console.log("== M12-5 长选区不建组（siblingKey=NULL 全放行） ==");
    const m1 = mkCard("FSRSTEST M12 长选区1", {});
    const m2 = mkCard("FSRSTEST M12 长选区2", {});
    const m3 = mkCard("FSRSTEST M12 长选区3", {});
    q = db.computeTodayQueue(tomorrow);
    check("无键卡全部放行（3 张新卡 + 同源组 1 张）", q.cards.filter((c) => !c.siblingKey).length === 3, 3, q.cards.filter((c) => !c.siblingKey).length);
    check("无键卡不产生延后", q.deferred.every((c) => !!c.siblingKey), true, q.deferred.map((c) => c.siblingKey));

    console.log("== M12-6 perDay=2 与开关矩阵 ==");
    setBury({ perDay: 2 });
    const p1 = mkCard("FSRSTEST M12 额度甲", { siblingKey: "src:doc2:h2" });
    const p2 = mkCard("FSRSTEST M12 额度乙", { siblingKey: "src:doc2:h2" });
    const p3 = mkCard("FSRSTEST M12 额度丙", { siblingKey: "src:doc2:h2" });
    q = db.computeTodayQueue(tomorrow);
    check("perDay=2 → 放行 2 张", q.cards.filter((c) => c.siblingKey === "src:doc2:h2").length === 2, 2, q.cards.filter((c) => c.siblingKey === "src:doc2:h2").length);
    check("perDay=2 → 延后 1 张", q.deferred.filter((c) => c.siblingKey === "src:doc2:h2").length === 1, 1, q.deferred.filter((c) => c.siblingKey === "src:doc2:h2").length);
    setBury({ perDay: 1, enabled: false });
    q = db.computeTodayQueue(tomorrow);
    check("总开关关 → 零延后（v33 行为完全一致）", q.deferred.length === 0, 0, q.deferred.length);
    check("总开关关 → 同组卡全部在队列", q.cards.filter((c) => c.siblingKey === "src:doc2:h2").length === 3, 3, q.cards.filter((c) => c.siblingKey === "src:doc2:h2").length);
    setBury({ enabled: true, newCards: false });
    q = db.computeTodayQueue(tomorrow);
    check("newCards=false → 新卡组零延后", q.deferred.length === 0, 0, q.deferred.length);

    console.log("== M12-7 review 卡组 + reviewCards 开关 ==");
    const reviewFsrs = (due) => JSON.stringify({ state: "review", due, lapses: 1, stability: 3, difficulty: 5, reps: 3, lastReview: NOW - 86400000, learningSteps: [] });
    const r1 = mkCard("FSRSTEST M12 复习甲", { siblingKey: "src:doc3:h3", fsrsJson: reviewFsrs(PAST_DUE) });
    const r2 = mkCard("FSRSTEST M12 复习乙", { siblingKey: "src:doc3:h3", fsrsJson: reviewFsrs(PAST_DUE) });
    setBury({ enabled: true, newCards: true, reviewCards: true });
    q = db.computeTodayQueue(tomorrow);
    const rGroupCards = q.cards.filter((c) => c.siblingKey === "src:doc3:h3").length;
    const rGroupDef = q.deferred.filter((c) => c.siblingKey === "src:doc3:h3").length;
    check("复习卡组同样 1 放 1 延", rGroupCards === 1 && rGroupDef === 1, { cards: 1, deferred: 1 }, { cards: rGroupCards, deferred: rGroupDef });
    setBury({ enabled: true, newCards: true, reviewCards: false });
    q = db.computeTodayQueue(tomorrow);
    check("reviewCards=false → 复习卡组不延后", q.cards.filter((c) => c.siblingKey === "src:doc3:h3").length === 2, 2, q.cards.filter((c) => c.siblingKey === "src:doc3:h3").length);

    console.log("== M12-8 learning 步进卡豁免 + 评分消耗额度 ==");
    const learnFsrs = JSON.stringify({ state: "learning", due: PAST_DUE, lapses: 0, stability: 0, difficulty: 0, reps: 1, lastReview: NOW - 3600000, learningSteps: [600000, 6000000] });
    const l1 = mkCard("FSRSTEST M12 步进卡", { siblingKey: "src:doc4:h4", fsrsJson: learnFsrs });
    const l2 = mkCard("FSRSTEST M12 新卡弟", { siblingKey: "src:doc4:h4" });
    clearBury(); // 默认配置（全开 perDay=1）
    q = db.computeTodayQueue(NOW);
    check("步进中的卡不被延后", q.deferred.every((c) => c.id !== l1), true, q.deferred.map((c) => c.id));
    check("组内新卡被放行（步进卡不占放行名额但组内仅剩它）", q.cards.some((c) => c.id === l2), true, q.cards.map((c) => c.id));
    // 步进卡评分后（学习步也是真实考察）→ 同日额度被消耗 → 新卡弟延后
    const l1Before = db.getCard(l1).fsrs;
    db.saveReview(l1, { ...l1Before, due: NOW + 600000, reps: 2, lastReview: NOW }, "Good", 50, l1Before);
    q = db.computeTodayQueue(NOW);
    check("步进卡评分消耗额度 → 同组新卡当日延后", q.deferred.some((c) => c.id === l2) && q.deferred.find((c) => c.id === l2)?.deferReason?.kind === "reviewed", "l2 deferred(reviewed)", q.deferred.map((c) => [c.id, c.deferReason?.kind]));

    console.log("== M12-9 挂起卡不进队列也不占额度 ==");
    const s1 = mkCard("FSRSTEST M12 挂起卡", { siblingKey: "src:doc5:h5" });
    db.updateCardLeech(s1, { isLeech: true, suspended: true, suspendedAt: NOW });
    const s2 = mkCard("FSRSTEST M12 挂起弟弟", { siblingKey: "src:doc5:h5" });
    q = db.computeTodayQueue(NOW);
    check("挂起卡不在队列", q.cards.every((c) => c.id !== s1) && q.deferred.every((c) => c.id !== s1), true, "suspended excluded");
    check("挂起卡不占放行名额 → 同组唯一可放行卡正常出现", q.cards.some((c) => c.id === s2) && !q.deferred.some((c) => c.id === s2), true, { cards: q.cards.map((c) => c.id), deferred: q.deferred.map((c) => c.id) });

    console.log("== M12-10 统计同口径（getStatsOverview） ==");
    const overview = db.getStatsOverview();
    // 当前库同源组（真实 now、默认配置）：doc1 甲已评→乙丙延(reviewed)、doc2 3 新卡→1放2延、
    // doc3 2 复习卡→1放1延、doc4 步进卡已评→新卡弟延(reviewed)、doc5 挂起卡不计→弟正常放行
    check("kpi 含 siblingDeferred 字段", typeof overview.kpi.siblingDeferred === "number", "number", typeof overview.kpi.siblingDeferred);
    check("同源延后合计 = doc1:2 + doc2:2 + doc3:1 + doc4:1 = 6", overview.kpi.siblingDeferred === 6, 6, overview.kpi.siblingDeferred);
    // 口径不变量：dueToday + siblingDeferred == 未挂起且**已到期（≤ 同一 now）**的总数。
    // 注意（2026-09-25 修正）：原写法用「学习日末 today24」做窗口，与 KPI 的「已到期」窗口不是同一个，
    // 夹具里那张 due = NOW+10min 的学习卡在**凌晨时段**仍落在 today24 内 ⇒ 两侧恒差 1
    // （即 DEFECTS D-TEST-38 记录在案的双窗口差异，与时刻相关的低占空比闸门）。
    // 本断言的真正目的是「延后不得让卡从当日视图里消失」，故两侧一律取同一 now 窗口。
    const now2 = Date.now();
    const allCards = db.listAllCards().filter((c) => !c.leech?.suspended);
    const expectedWindow = allCards.filter((c) => (c.fsrs?.due ?? now2) <= now2).length;
    check("dueToday + siblingDeferred == 已到期总数（口径自洽，不静默少卡）", overview.kpi.dueToday + overview.kpi.siblingDeferred === expectedWindow, expectedWindow, { sum: overview.kpi.dueToday + overview.kpi.siblingDeferred, window: expectedWindow });

    console.log("== M12-11 siblingKeyFor 键规则矩阵（§4.16 item 5） ==");
    const cards = require(path.join(ROOT, "tests", "m12.cards.bundle.cjs"));
    const K = cards.siblingKeyFor;
    const genSeq = (() => { let i = 0; return () => `id-${++i}`; })();
    check("显式键最高优先（长文本+有锚点也让位）", K({ explicitKey: "act:flip-x", contextRef: { documentId: "d" }, sourceText: "很长".repeat(500), limit: 300 }) === "act:flip-x", "act:flip-x", K({ explicitKey: "act:flip-x", contextRef: { documentId: "d" }, sourceText: "很长".repeat(500), limit: 300 }));
    const shortKey1 = K({ contextRef: { documentId: "d1", extractId: "e1" }, sourceText: "一句话", limit: 300 });
    check("短材料 + extractId → src:<doc>:<extractId>", shortKey1 === "src:d1:e1", "src:d1:e1", shortKey1);
    const hashKey = K({ contextRef: { documentId: "d1", anchorText: "同一句锚点" }, sourceText: "一句话", limit: 300 });
    check("无 extractId → anchorText 哈希键且确定", hashKey === K({ contextRef: { documentId: "d1", anchorText: "同一句锚点" }, sourceText: "另一段调用", limit: 300 }) && hashKey.startsWith("src:d1:h"), true, hashKey);
    check("不同锚点 → 不同键", hashKey !== K({ contextRef: { documentId: "d1", anchorText: "另一句锚点" }, sourceText: "一句话", limit: 300 }), true, "distinct");
    check("长选区（>limit）不建键", K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(301), limit: 300 }) === null, null, K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(301), limit: 300 }));
    check("长选区但恰好等于 limit → 建键", K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(300), limit: 300 })?.startsWith("src:d1:"), true, "src:*");
    check("无锚点单卡 → null（不参与延后）", K({ sourceText: "一句话" }) === null, null, K({ sourceText: "一句话" }));
    const splitKey = K({ splitCount: 2, genId: genSeq });
    check("无锚点但 per-blank 拆卡 → act:split 键（结构性同源）", typeof splitKey === "string" && splitKey.startsWith("act:split-"), true, splitKey);
    check("缺省 limit=300", K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(300) })?.startsWith("src:d1:") && K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(301) }) === null, true, "default 300");
    check("非法 limit 回落 300", K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(301), limit: 0 }) === null && K({ contextRef: { documentId: "d1" }, sourceText: "字".repeat(300), limit: -5 })?.startsWith("src:"), true, "fallback 300");

    console.log(`\n==== M12 SUMMARY ${pass}/${pass + fail} ====`);
  } catch (e) {
    // D239：异常也要算失败（原先异常冒出 + app.quit() → 退出码 0，崩溃被当成通过）
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不掩盖结果 */ }
    app.exit(fail > 0 ? 1 : 0); // D239：app.quit() 恒以 0 退出，process.exitCode 不生效
  }
});
