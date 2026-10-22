// D101/D102 批A+批B db 层回归（electron 直跑：npx electron tests/d101-lifecycle.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §1/§2 + GUIDE §4.1/§4.2-20（D101/D102）
// 覆盖：归档排除式队列过滤（未知值仍入队）/ 归档零 FSRS 写入 / 与挂起正交 / 恢复回原 due /
//       今日到期统计同口径 / 队列≡listDueCards / setCardTags 终值写入与整批拒绝 / listCardTags 两源合并
"use strict";
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d101-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    const NOW = Date.now();
    const PAST_DUE = Date.parse("2000-01-01T00:00:00Z");
    const newFsrs = (due = PAST_DUE) => JSON.stringify({ state: "new", due, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] });
    const mkCard = (note, extra = {}) =>
      db.createCard({
        noteText: note, cardType: "qa", frontMarkdown: note, backMarkdown: "答案",
        priority: 50, tags: [], fsrsJson: newFsrs(), ...extra
      }).id;

    console.log("== D102-1 归档排除式队列过滤（§4.2-20 口径唯一） ==");
    const a1 = mkCard("FSRSTEST D102 甲");
    const a2 = mkCard("FSRSTEST D102 乙");
    let q = db.computeTodayQueue(NOW);
    check("未归档 2 张全部入队", q.cards.length === 2, 2, q.cards.length);
    const archR = db.batchCardOps("archive", [a1]);
    check("batchCardOps archive 成功", archR.ok === true && archR.count === 1, { ok: true, count: 1 }, archR);
    q = db.computeTodayQueue(NOW);
    check("归档后队列只剩 1 张", q.cards.length === 1 && q.cards[0].id === a2, a2, q.cards[0]?.id);
    check("listDueCards 与队列同口径（f03 断言语义）", eq(db.listDueCards(NOW), q.cards), true, "口径一致");
    const stats = db.getStatsOverview();
    check("今日到期统计同步减 1（kpi.dueToday）", stats.kpi.dueToday === 1, 1, stats.kpi.dueToday);

    console.log("== D102-2 未知 status 值视为 active（排除式防误杀） ==");
    db.execRawSql("UPDATE cards SET status = 'retired' WHERE id = ?", [a2]);
    q = db.computeTodayQueue(NOW);
    check("未知值 'retired' 仍入队（只精确排除 archived）", q.cards.some((c) => c.id === a2), true, q.cards.map((c) => c.id));

    console.log("== D102-3 归档零 FSRS 写入 / 与挂起正交 / 恢复回原 due ==");
    db.execRawSql("UPDATE cards SET status = NULL WHERE id = ?", [a2]);
    const fsrsBefore = db.getCard(a1).fsrs;
    const dueBefore = fsrsBefore.due;
    db.batchCardOps("suspend", [a1]);
    check("归档前先挂起：suspended=true", db.getCard(a1).leech?.suspended === true, true, db.getCard(a1).leech);
    db.batchCardOps("archive", [a1]);
    const archived = db.getCard(a1);
    check("归档零 FSRS 变化（八字段全等）", eq(archived.fsrs, fsrsBefore), fsrsBefore, archived.fsrs);
    check("归档保留挂起态（两轴正交）", archived.leech?.suspended === true, true, archived.leech);
    check("归档后 status=archived", archived.status === "archived", "archived", archived.status);
    check("归档不产生 review_logs", db.listAllReviewLogs().length === 0, 0, db.listAllReviewLogs().length);
    db.batchCardOps("restore", [a1]);
    const restored = db.getCard(a1);
    check("恢复 status=active", restored.status === "active", "active", restored.status);
    check("恢复后 due 原样（过期自然入队）", restored.fsrs.due === dueBefore, dueBefore, restored.fsrs.due);
    check("恢复保留挂起态（Leech 处置另行）", restored.leech?.suspended === true, true, restored.leech);
    const r2 = db.batchCardOps("restore", [a1]);
    check("重复恢复 idempotent", r2.ok === true, true, r2);

    console.log("== D102-4 归档卡被同源延后口径排除（不再挤占组额度） ==");
    const s1 = mkCard("FSRSTEST D102 同源一", { siblingKey: "src:d102:x" });
    const s2 = mkCard("FSRSTEST D102 同源二", { siblingKey: "src:d102:x" });
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    const cur = settingsStore.readSettings();
    cur.app = { ...(cur.app || {}), siblingBury: { enabled: true, newCards: true, reviewCards: true, perDay: 1, sourceTextLimit: 300 } };
    settingsStore.writeSettings(cur);
    let q2 = db.computeTodayQueue(NOW + 30 * 86400000);
    check("同源组先只放行 1 张", q2.cards.filter((c) => c.siblingKey === "src:d102:x").length === 1, 1, q2.cards.filter((c) => c.siblingKey === "src:d102:x").length);
    db.batchCardOps("archive", [s1]);
    q2 = db.computeTodayQueue(NOW + 30 * 86400000);
    check("放行卡归档后，兄弟卡立即解封入队", q2.cards.some((c) => c.id === s2), true, q2.cards.map((c) => c.id));

    console.log("== D101-5 setCardTags：终值写入 / 无变化跳过 / 整批拒绝 ==");
    const t1 = mkCard("FSRSTEST D101 标签甲");
    const t2 = mkCard("FSRSTEST D101 标签乙");
    const w1 = db.setCardTags([{ id: t1, tags: ["考研", "考研::英语"] }]);
    check("单卡写入", w1.ok === true && w1.count === 1, { ok: true, count: 1 }, w1);
    check("tags_json 落库", eq(db.getCard(t1).tags, ["考研", "考研::英语"]), ["考研", "考研::英语"], db.getCard(t1).tags);
    const w2 = db.setCardTags([{ id: t1, tags: ["考研", "考研::英语"] }]);
    check("同值重写不触碰行（count=0）", w2.ok === true && w2.count === 0, { ok: true, count: 0 }, w2);
    const w3 = db.setCardTags([{ id: t1, tags: ["考研"] }, { id: t2, tags: ["口语"] }]);
    check("批量两卡同事务", w3.ok === true && w3.count === 2, { ok: true, count: 2 }, w3);
    check("第二卡写入生效", eq(db.getCard(t2).tags, ["口语"]), ["口语"], db.getCard(t2).tags);
    const w4 = db.setCardTags([{ id: t1, tags: ["x"] }, { id: "00000000-0000-0000-0000-00000000dead", tags: ["y"] }]);
    check("缺卡整批拒绝（batchCardOps 同语义）", w4.ok === false, false, w4);
    check("拒绝后首卡未被改写", eq(db.getCard(t1).tags, ["考研"]), ["考研"], db.getCard(t1).tags);
    const w5 = db.setCardTags([]);
    check("空载荷拒绝", w5.ok === false, false, w5);
    const w6 = db.setCardTags([{ id: t1, tags: [42, null, "ok"] }]);
    check("非串元素过滤不抛", w6.ok === true && eq(db.getCard(t1).tags, ["ok"]), ["ok"], db.getCard(t1).tags);

    console.log("== D101-6 listCardTags：两源派生词表（只读） ==");
    // 卡片侧补一张「考研」标签卡（前节 w6 已把 t1 标签覆写为 ["ok"]）
    const t3 = mkCard("FSRSTEST D101 词表卡");
    db.setCardTags([{ id: t3, tags: ["考研"] }]);
    // 摘录侧：建文档 + 摘录（tag_json）
    const item = db.createFromPaste("FSRSTEST D101 词表材料", "正文内容足够长。".repeat(20));
    const ext = db.createExtract({ parentType: "document", parentId: item.documentId, documentId: item.documentId, contentMarkdown: "被批注的句子", priority: 50, tags: ["批注标签", "考研"] });
    check("摘录创建成功", Boolean(ext && ext.id), true, ext);
    const vocab = db.listCardTags();
    const kaoyan = vocab.find((t) => t.display === "考研");
    check("卡片+批注两源合并计数（考研 = 卡1 + 批注1）", kaoyan && kaoyan.cardCount === 1 && kaoyan.extractCount === 1, { cardCount: 1, extractCount: 1 }, kaoyan);
    check("纯批注标签入词表", vocab.some((t) => t.display === "批注标签" && t.extractCount === 1), true, vocab);
    check("词表按总频降序", vocab.length >= 2 && (vocab[0].cardCount + vocab[0].extractCount) >= (vocab[vocab.length - 1].cardCount + vocab[vocab.length - 1].extractCount), true, "有序");
    const beforeVocab = JSON.stringify(vocab);
    db.listCardTags();
    check("词表只读无副作用", JSON.stringify(db.listCardTags()) === beforeVocab, true, "幂等");

    console.log(`\nD101-lifecycle 结果: ${pass} 通过, ${fail} 失败`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败不阻断 */ }
    app.quit();
  }
});
