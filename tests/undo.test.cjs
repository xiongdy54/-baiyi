// v22 撤销评分回归测试（db 层，electron 直跑：npx electron tests/undo.test.cjs，须先关应用）
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库。
// 覆盖：saveReview 快照落库 / getLastUndoableReview 选取 / undoLastReview 恢复快照+移除日志 /
//       无快照日志不可撤销 / 多卡撤销次序（后评先撤）/ leech 触发后撤销回退挂起与 issue / 已删卡不可撤销
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

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "undo-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    const T0 = Date.parse("2025-01-01T00:00:00Z");
    const mkCard = (note, extra = {}) =>
      db.createCard({ noteText: note, cardType: "qa", frontMarkdown: note, backMarkdown: "答案", priority: 50, tags: [], fsrsJson: JSON.stringify({ state: "new", due: Date.parse("2000-01-01"), lapses: 0, reps: 0 }), ...extra }).id;

    console.log("== U1 快照落库 + 撤销恢复 + 日志移除 ==");
    const before1 = { state: "review", due: T0 + 86400000, lapses: 2, stability: 3.2, difficulty: 5.1, reps: 6, lastReview: T0, learningSteps: [] };
    const after1 = { state: "review", due: T0 + 5 * 86400000, lapses: 2, stability: 4.8, difficulty: 4.9, reps: 7, lastReview: T0 + 1000, learningSteps: [] };
    const cardA = mkCard("FSRSTEST UNDO A");
    db.saveReview(cardA, after1, "Good", 1234, before1);
    check("评分后卡状态=after", eq(db.getCard(cardA).fsrs, after1), after1, db.getCard(cardA).fsrs);
    check("日志含 1 条", db.listAllReviewLogs().length === 1, 1, db.listAllReviewLogs().length);
    const last = db.getLastUndoableReview();
    check("getLastUndoableReview 命中该条", !!last && last.cardId === cardA && last.rating === "Good", { cardId: cardA, rating: "Good" }, last);
    const u1 = db.undoLastReview();
    check("撤销 ok 且卡状态恢复为 before（全字段含 learningSteps）", u1.ok === true && eq(u1.card.fsrs, before1), before1, u1.ok ? u1.card.fsrs : u1);
    check("日志已物理移除（训练输入自动干净）", db.listAllReviewLogs().length === 0, 0, db.listAllReviewLogs().length);
    check("撤销后无可撤销项", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());

    console.log("== U2 无快照日志不可撤销 ==");
    db.saveReview(cardA, after1, "Easy", 100); // 未传 fsrsBefore（模拟旧日志/旧调用）
    check("无快照 → getLastUndoableReview 为 null", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());
    const u2 = db.undoLastReview();
    check("无快照 → 撤销拒绝", u2.ok === false && typeof u2.reason === "string", "ok:false", u2);

    console.log("== U3 多卡撤销次序（后评先撤） ==");
    const X = mkCard("FSRSTEST UNDO X");
    const Y = mkCard("FSRSTEST UNDO Y");
    const beforeX = { state: "new", due: T0, lapses: 0, reps: 0, learningSteps: [600000, 6000000] };
    const beforeY = { state: "new", due: T0, lapses: 0, reps: 0, learningSteps: [600000] };
    db.saveReview(X, { ...beforeX, reps: 1 }, "Good", 10, beforeX);
    db.saveReview(Y, { ...beforeY, reps: 1 }, "Again", 20, beforeY);
    const u3a = db.undoLastReview();
    check("先撤销 Y（最新）", u3a.ok === true && u3a.card.id === Y && eq(u3a.card.fsrs, beforeY), Y, u3a.ok ? u3a.card.id : u3a);
    const u3b = db.undoLastReview();
    check("再撤销 X", u3b.ok === true && u3b.card.id === X && eq(u3b.card.fsrs, beforeX), X, u3b.ok ? u3b.card.id : u3b);
    check("全部撤销后无可撤销项", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());

    console.log("== U4 leech 触发后撤销 → 回退挂起与 issue ==");
    const Z = mkCard("FSRSTEST UNDO Z", { fsrsJson: JSON.stringify({ state: "review", due: T0, lapses: 7, stability: 1, difficulty: 9, reps: 20, lastReview: T0, learningSteps: [] }) });
    const beforeZ = db.getCard(Z).fsrs;
    const afterZ = { ...beforeZ, lapses: 8, reps: 21 };
    db.saveReview(Z, afterZ, "Again", 30, beforeZ);
    db.addCardIssue({ cardId: Z, ruleId: "LEECH", severity: "warn", message: "连续遗忘 8 次，已自动暂停", source: "lint" });
    db.updateCardLeech(Z, { isLeech: true, suspended: true, suspendedAt: Date.now() });
    check("撤销前卡已挂起", db.getCard(Z).leech?.suspended === true, true, db.getCard(Z).leech);
    const u4 = db.undoLastReview();
    check("撤销 ok 且 lapses 回退到 7", u4.ok === true && u4.card.fsrs.lapses === 7, 7, u4.ok ? u4.card.fsrs.lapses : u4);
    check("挂起已解除", !u4.card.leech?.suspended && !u4.card.leech?.isLeech, "无挂起", u4.ok ? u4.card.leech : u4);
    const openLeech = db.listCardIssues(Z).filter((i) => i.rule_id === "LEECH" && i.status === "open");
    check("本次 LEECH issue 已关闭", openLeech.length === 0, 0, openLeech.length);

    console.log("== U5 已删卡的日志不可撤销 ==");
    const W = mkCard("FSRSTEST UNDO W");
    db.saveReview(W, { state: "review", due: T0, lapses: 0, reps: 1 }, "Good", 5, { state: "new", due: T0, lapses: 0, reps: 0 });
    db.deleteCard(W);
    check("最新日志的卡已删 → 不可撤销", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());
    const u5 = db.undoLastReview();
    check("撤销拒绝", u5.ok === false, "ok:false", u5);

    console.log("== U6 卡状态被篡改后撤销拒绝（§4.4.9 after 一致性不变量） ==");
    const V = mkCard("FSRSTEST UNDO V");
    const beforeV = { state: "new", due: T0, lapses: 0, reps: 0, learningSteps: [] };
    const afterV = { state: "review", due: T0 + 86400000, lapses: 0, reps: 1, learningSteps: [] };
    db.saveReview(V, afterV, "Good", 10, beforeV);
    check("篡改前可撤销", db.getLastUndoableReview() !== null, "非 null", db.getLastUndoableReview());
    // 外部篡改：卡状态偏离该次评分结果（模拟另一处写库/异常）
    const tampered = { ...afterV, due: T0 + 99 * 86400000, stability: 42.0 };
    const cur = db.getCard(V);
    db.updateCard({ ...cur, fsrs: tampered });
    check("篡改后 getLastUndoableReview 为 null（不变量在选取层生效）", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());
    const u6 = db.undoLastReview();
    // 选取层已拦截 → 撤销入口同样拒绝（无候选）；双层防护任一生效即通过
    check("撤销拒绝", u6.ok === false, "ok:false", u6);

    console.log("== U7 F10：Good 评分后手动挂起 → 撤销不得误回退手动挂起 ==");
    const M = mkCard("FSRSTEST UNDO M");
    const beforeM = { state: "new", due: T0, lapses: 0, reps: 0, learningSteps: [] };
    db.saveReview(M, { ...beforeM, reps: 1, state: "review", due: T0 + 86400000 }, "Good", 10, beforeM);
    db.setCardSuspended(M, true, "manual-test");
    check("评分后手动挂起生效", db.getCard(M).leech?.suspended === true, true, db.getCard(M).leech);
    const u7 = db.undoLastReview();
    check("撤销 ok 且 fsrs 恢复", u7.ok === true && eq(u7.card.fsrs, beforeM), beforeM, u7.ok ? u7.card.fsrs : u7);
    check("手动挂起保持（不因撤销被误解除）", u7.card.leech?.suspended === true && u7.card.leech?.reason === "manual-test", { suspended: true, reason: "manual-test" }, u7.card.leech);

    console.log("== U8 v22 形态旧日志（无 after 快照）不可撤销 ==");
    const O = mkCard("FSRSTEST UNDO O");
    const beforeO = { state: "new", due: T0, lapses: 0, reps: 0, learningSteps: [] };
    db.saveReview(O, { ...beforeO, reps: 1 }, "Good", 10, beforeO);
    // 模拟 v22 时代日志：fsrs_after_json 为 NULL（该列 v23 才引入）
    db.execRawSql("UPDATE review_logs SET fsrs_after_json = NULL WHERE card_id = ?", [O]);
    check("无 after 快照 → 不可撤销", db.getLastUndoableReview() === null, null, db.getLastUndoableReview());
    const u8 = db.undoLastReview();
    check("撤销拒绝", u8.ok === false, "ok:false", u8);

    console.log("== U9 review_seq：表内唯一、插入序单调递增、撤销删除后允许复用（§4.4.9） ==");
    const K = mkCard("FSRSTEST UNDO K");
    const seqs1 = db.listAllReviewLogs().map((l) => l.reviewSeq);
    db.saveReview(K, { state: "review", due: T0 + 86400000, lapses: 0, reps: 1 }, "Good", 5, { state: "new", due: T0, lapses: 0, reps: 0 });
    const seqs2 = db.listAllReviewLogs().map((l) => l.reviewSeq);
    check("review_seq 严格递增（新评分取 MAX+1）", seqs2[seqs2.length - 1] > Math.max(...seqs1), `> ${Math.max(...seqs1)}`, seqs2[seqs2.length - 1]);
    const seqDeleted = seqs2[seqs2.length - 1];
    const u9 = db.undoLastReview();
    check("撤销最新评分 ok", u9.ok === true, "ok:true", u9.ok ? u9.card.id : u9);
    db.saveReview(K, { state: "review", due: T0 + 86400000, lapses: 0, reps: 1 }, "Good", 5, { state: "new", due: T0, lapses: 0, reps: 0 });
    const seqs3 = db.listAllReviewLogs().map((l) => l.reviewSeq);
    check("撤销后新评分复用被删序号（允许复用不变量）", seqs3[seqs3.length - 1] === seqDeleted, seqDeleted, seqs3[seqs3.length - 1]);
    check("全表 review_seq 无重复", new Set(seqs3).size === seqs3.length, seqs3.length, new Set(seqs3).size);

    console.log(`\n撤销评分测试：${pass} 通过 / ${fail} 失败`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败无碍 */ }
    app.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e.stack || e.message);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    app.exit(1);
  }
});
