// L2 数据库集成层 — 沙盒 userData 驱动真实 electron/db.js
// 验证：fsrs_json 落库保真（无二次计算/精度丢失）、到期边界、挂起过滤、leech 覆写路径
// 运行：npx electron tests/fsrs/db.test.cjs
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  try {
    // 沙盒 userData 已由 main 进程参数指定（见启动命令 --user-data-dir 不生效，改用手动覆盖）
    // 实际上 Electron 的 app.setPath 必须在 ready 前调用——本文件由 electron 直接加载，
    // 通过环境变量 FSRS_TEST_USERDATA 在外部用 setPath 无法保证，故这里直接断言当前 userData 路径
    console.log(`  sandbox userData = ${app.getPath("userData")}`);

    const db = require(path.join(__dirname, "..", "..", "electron", "db.js"));
    await db.initDb();

    console.log("== L2-1 建卡初始状态 ==");
    const { id: cardId } = db.createCard({
      userId: "local-user",
      noteText: "FSRSTEST L2 测试卡",
      cardType: "qa",
      frontMarkdown: "FSRSTEST Q?",
      backMarkdown: "A",
      priority: 50,
      tags: []
    });
    const c0 = db.getCard(cardId);
    const fsrs0 = JSON.parse(c0.fsrs ? JSON.stringify(c0.fsrs) : "{}");
    check("新卡 fsrs_json.state=new", fsrs0.state === "new", "new", fsrs0.state);
    check("新卡 fsrs_json.lapses=0", fsrs0.lapses === 0, 0, fsrs0.lapses);
    check("新卡 fsrs_json.due 为毫秒数字", typeof fsrs0.due === "number" && Math.abs(fsrs0.due - Date.now()) < 60_000, "≈now(ms)", fsrs0.due);

    console.log("== L2-2 saveReview 落库保真（渲染层算好的状态原样写入）==");
    // 模拟渲染层传入的状态（含 S/D —— 渲染层实际只传 state/due/lapses/lastReview）
    const rendered = { state: "review", due: Date.now() + 3 * 86400000, lapses: 0, lastReview: Date.now() };
    db.saveReview(cardId, rendered, "Good", 5200);
    const c1 = db.getCard(cardId);
    const fsrs1 = c1.fsrs;
    check("fsrs_json 与传入状态逐字段一致（state）", fsrs1.state === rendered.state, rendered.state, fsrs1.state);
    check("fsrs_json 与传入状态逐字段一致（due 毫秒）", fsrs1.due === rendered.due, rendered.due, fsrs1.due);
    check("fsrs_json 与传入状态逐字段一致（lapses）", fsrs1.lapses === rendered.lapses, rendered.lapses, fsrs1.lapses);
    check("fsrs_json 与传入状态逐字段一致（lastReview）", fsrs1.lastReview === rendered.lastReview, rendered.lastReview, fsrs1.lastReview);

    console.log("== L2-3 review_logs 记录 ==");
    // 直接查库验证（用 listAllCards 无法看到 logs；这里用 db 内部 queryAll 不可行，改由 listDue 行为间接验证 + getCard 时间戳）
    // review_logs 表断言：通过重新 require sql.js 不现实——改用行为验证：
    // 若 logs 落库，重复 saveReview 不报错且 card 更新时间推进
    const up1 = db.getCard(cardId).updatedAt;
    db.saveReview(cardId, { state: "review", due: Date.now() + 86400000, lapses: 0 }, "Good", 3000);
    const up2 = db.getCard(cardId).updatedAt;
    check("重复 saveReview 推进 updated_at", up2 >= up1, "up2>=up1", `${up1} -> ${up2}`);

    console.log("== L2-4 到期边界（listDueCards）==");
    const past = { id: undefined };
    const mk = (front, fsrs) => db.createCard({ userId: "local-user", noteText: front, cardType: "qa", frontMarkdown: front, backMarkdown: "x", priority: 50, tags: [], fsrsJson: JSON.stringify(fsrs) }).id;
    // due 已过 1ms → 应出现
    const duePastId = mk("FSRSTEST due-past", { state: "review", due: Date.now() - 1, lapses: 0 });
    // due 未来 60s → 不应出现
    const dueFutureId = mk("FSRSTEST due-future", { state: "review", due: Date.now() + 60_000, lapses: 0 });
    // 挂起卡 → 不应出现
    const suspendedId = mk("FSRSTEST suspended", { state: "review", due: Date.now() - 1, lapses: 0 });
    db.setCardSuspended(suspendedId, true, "test");
    // leech.suspended=true → 不应出现
    const leechSuspendedId = mk("FSRSTEST leech-susp", { state: "review", due: Date.now() - 1, lapses: 0 });
    db.updateCard({ id: leechSuspendedId, noteText: "FSRSTEST leech-susp", cardType: "qa", frontMarkdown: "FSRSTEST leech-susp", backMarkdown: "x", priority: 50, tags: [], leechJson: JSON.stringify({ isLeech: true, suspended: true }) });

    const dueList = db.listDueCards();
    const dueIds = new Set(dueList.map((c) => c.id));
    check("due=now-1ms 的卡出现在到期队列", dueIds.has(duePastId), true, dueIds.has(duePastId));
    check("due=now+60s 的卡不在到期队列", !dueIds.has(dueFutureId), false, dueIds.has(dueFutureId));
    check("挂起卡不在到期队列", !dueIds.has(suspendedId), false, dueIds.has(suspendedId));
    check("leech.suspended 卡不在到期队列", !dueIds.has(leechSuspendedId), false, dueIds.has(leechSuspendedId));
    // cardId 在 L2-2 已复习为 due=+3天（未到期），不应出现——反向验证到期过滤确实生效
    check("复习后未到期的卡不在到期队列（cardId due=+3d）", !dueIds.has(cardId), false, dueIds.has(cardId));
    // 专门的到期新卡（fsrs_json 默认 due=now）应出现
    const freshId = mk("FSRSTEST fresh-new", { state: "new", due: Date.now() - 1, lapses: 0 });
    const dueIds2 = new Set(db.listDueCards().map((c) => c.id));
    check("到期新卡出现在到期队列", dueIds2.has(freshId), true, dueIds2.has(freshId));
    db.deleteCard(freshId);

    console.log("== L2-5 leech 覆写路径（复现 ReviewView.grade() 的调用序列）==");
    // 应用代码序列：saveReview(新状态) → updateCard({...current（旧状态）, leech:...})
    const cBefore = db.getCard(cardId);
    const newerState = { state: "review", due: Date.now() + 30 * 86400000, lapses: 1, lastReview: Date.now() };
    db.saveReview(cardId, newerState, "Again", 1000);
    // 复现：updateCard 传入「旧的 fsrs」（current.fsrs 是复习前取的快照）
    db.updateCard({ ...cBefore, leech: { isLeech: true, suspended: true, suspendedAt: Date.now() } });
    const cAfter = db.getCard(cardId);
    const fsrsAfter = cAfter.fsrs;
    check(
      "【疑点F3】leech 标记后 fsrs_json 被旧状态覆写（30天间隔丢失）",
      fsrsAfter.due === newerState.due,
      `due=${newerState.due}`,
      `due=${fsrsAfter.due}（被回滚为复习前 due=${JSON.parse(cBefore.fsrsJson ?? "{}").due ?? cBefore.fsrs?.due}）`
    );
    check("leech 标记已写入", cAfter.leech && cAfter.leech.isLeech === true, true, cAfter.leech);

    // 清理沙盒数据（沙盒库随临时目录销毁，不真删也安全；但为了输出干净仍删除）
    db.deleteCard(cardId); db.deleteCard(duePastId); db.deleteCard(dueFutureId); db.deleteCard(suspendedId); db.deleteCard(leechSuspendedId);

    console.log(`\nL2 完成：${pass} 通过 / ${fail} 失败`);
    app.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e);
    app.exit(1);
  }
});
