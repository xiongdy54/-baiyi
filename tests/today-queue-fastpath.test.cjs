// @runtime: electron
// C-18：复习队列快速路径（TODAY_QUEUE_DUE_SQL 到期超集）与全量参考实现（TODAY_QUEUE_SQL）逐 id 等价，
// 且快速路径命中 idx_cards_due 表达式索引；顺带钉住 C-18c 计数/分组专用接口的口径。
// 运行：npx electron tests/today-queue-fastpath.test.cjs（或 node scripts/run-tests.mjs today-queue-fastpath）
// 播种方式参照 tests/flows/f13-adversarial-input.cjs：第二连接直写库，覆盖损坏 fsrs_json 等对抗行。
// 隔离：临时 userData（app.setPath），绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const DAY = 24 * 3600 * 1000;

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "today-queue-fastpath-"));
  const dbFile = path.join(tmp, "library.db");
  let db = null;
  try {
    app.setPath("userData", tmp);
    db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    // ---- 播种（第二连接直写；WAL 提交后主连接立即可见） ----
    const seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    const seedNow = Date.now();
    const fsrs = (due) => JSON.stringify({ state: "review", due, stability: 5, difficulty: 5, reps: 2, lapses: 0, lastReview: seedNow - 5 * DAY });
    const ins = seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown, priority, tags_json,
        fsrs_json, leech_json, context_ref_json, knowledge_point_id, sibling_key, status, is_deleted, created_at, updated_at)
       VALUES (?, 'local-user', ?, 'qa', ?, ?, 50, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const row = (id, fsrsJson, extra = {}) => ins.run(
      id, `笔记-${id}`, `问题-${id}`, `答案-${id}`,
      fsrsJson,
      extra.leechJson ?? null,
      extra.contextRefJson ?? null,
      extra.kp ?? null,
      extra.siblingKey ?? null,
      extra.status ?? null,
      extra.deleted ?? 0,
      (extra.created ?? seedNow - 100000),
      (extra.created ?? seedNow - 100000)
    );
    let t = 0;
    const ts = () => seedNow - 100000 + t++;
    // 覆盖报告要求的全部形态：fsrs NULL / 非法 JSON / due 缺失 / due 字符串 / 已到期 / 未到期 /
    // leech 挂起 / 归档 / 已删除 / 同源组多卡
    row("due-past", fsrs(seedNow - DAY), { created: ts() });                       // 已到期
    row("future-12h", fsrs(seedNow + DAY / 2), { created: ts() });                 // 播种时未到期，+1 天后到期
    row("future-200d", fsrs(seedNow + 200 * DAY), { created: ts() });              // +400 天后才到期
    row("fsrs-null", null, { created: ts() });                                     // 新卡（fsrs NULL）
    row("due-missing", JSON.stringify({ state: "review", stability: 5, difficulty: 5 }), { created: ts() }); // due 缺失
    row("due-string", JSON.stringify({ state: "review", due: "soon", stability: 5, difficulty: 5 }), { created: ts() }); // due 是字符串
    row("bad-json", "{'broken': true", { created: ts() });                         // 非法 JSON（损坏）
    row("leech-hang", fsrs(seedNow - DAY), { leechJson: JSON.stringify({ suspended: true }), created: ts() }); // leech 挂起
    row("archived-1", fsrs(seedNow - DAY), { status: "archived", created: ts() }); // 归档
    row("deleted-1", fsrs(seedNow - DAY), { deleted: 1, created: ts() });          // 已删除
    row("sib-a", fsrs(seedNow - DAY), { siblingKey: "sib-1", created: ts() });     // 同源组（perDay=1：1 放行 1 延后）
    row("sib-b", fsrs(seedNow - DAY + 1000), { siblingKey: "sib-1", created: ts() });
    // C-18c 计数/分组接口的对照行
    row("cnt-a1", fsrs(seedNow - DAY), { contextRefJson: JSON.stringify({ extractId: "ext-1" }), created: ts() });
    row("cnt-a2", fsrs(seedNow - DAY), { contextRefJson: JSON.stringify({ extractId: "ext-1" }), created: ts() });
    row("cnt-b1", fsrs(seedNow - DAY), { contextRefJson: JSON.stringify({ extractId: "ext-2" }), created: ts() });
    row("cnt-del", fsrs(seedNow - DAY), { contextRefJson: JSON.stringify({ extractId: "ext-1" }), deleted: 1, created: ts() });
    row("cnt-bad", fsrs(seedNow - DAY), { contextRefJson: "not-json", created: ts() });
    row("cnt-none", fsrs(seedNow - DAY), { created: ts() });
    row("kp-1", fsrs(seedNow - DAY), { kp: "KP-1", created: ts() });
    row("kp-2", fsrs(seedNow - DAY), { kp: "KP-2", created: ts() });
    row("kp-empty", fsrs(seedNow - DAY), { kp: "", created: ts() });
    row("kp-del", fsrs(seedNow - DAY), { kp: "KP-1", deleted: 1, created: ts() });
    seed.close();

    // ---- S1 两条路径逐 id 等价（播种时刻 / +1 天 / +400 天三个 now） ----
    console.log("== S1 快速路径与全量参考实现等价 ==");
    const sig = (q) => q.cards.map((c) => c.id).join(",");
    const deferSig = (q) => q.deferred.map((c) => c.id + ":" + c.deferReason.kind).join(",");
    const shapeOk = (q, omitted) =>
      Array.isArray(q.cards) && Array.isArray(q.deferred) && Array.isArray(q.damaged) && q.damagedOmitted === omitted;
    for (const [label, now] of [["播种时刻", seedNow], ["+1 天", seedNow + DAY], ["+400 天", seedNow + 400 * DAY]]) {
      const full = db.computeTodayQueue(now);
      const fast = db.computeTodayQueue(now, { withDamaged: false });
      check(`S1[${label}] cards 逐 id 完全相同`, sig(full) === sig(fast), sig(full), sig(fast));
      check(`S1[${label}] deferred（id:kind）完全相同`, deferSig(full) === deferSig(fast), deferSig(full), deferSig(fast));
      check(`S1[${label}] 全量路径 damagedOmitted=false / 快速路径 true 且 damaged 为空`,
        shapeOk(full, false) && shapeOk(fast, true), "full{false} / fast{true, damaged=[]}",
        `full{${full.damagedOmitted}} / fast{${fast.damagedOmitted}, ${fast.damaged.length} 行}`);
    }

    // ---- S2 关键行为点（用 +1 天的 now 断言实际去留，防「两条路径一起错」的恒真等价） ----
    console.log("== S2 队列行为点（+1 天） ==");
    const now1 = seedNow + DAY;
    const q1 = db.computeTodayQueue(now1);
    const ids1 = new Set(q1.cards.map((c) => c.id));
    const deferredIds1 = new Set(q1.deferred.map((c) => c.id));
    check("S2-1 已到期卡在队列", ids1.has("due-past"), true, [...ids1]);
    check("S2-2 播种时未到期、现已到期的卡进入队列（+12h）", ids1.has("future-12h"), true, [...ids1]);
    check("S2-3 200 天后到期的卡仍不在队列", !ids1.has("future-200d"), false, [...ids1]);
    check("S2-4 fsrs NULL 新卡在队列（due 视为 map 时刻）", ids1.has("fsrs-null"), true, [...ids1]);
    check("S2-5 due 缺失行在队列（normalize 回落新卡）", ids1.has("due-missing"), true, [...ids1]);
    check("S2-6 due 为字符串的行不在队列（值域损坏链）", !ids1.has("due-string"), false, [...ids1]);
    check("S2-7 非法 fsrs JSON 行不在队列，但全量路径 damaged 可见",
      !ids1.has("bad-json") && q1.damaged.some((c) => c.id === "bad-json"), true,
      { cards: [...ids1], damaged: q1.damaged.map((c) => c.id) });
    check("S2-8 leech 挂起卡不在队列", !ids1.has("leech-hang"), false, [...ids1]);
    check("S2-9 归档卡不在队列", !ids1.has("archived-1"), false, [...ids1]);
    check("S2-10 已删除卡不在队列", !ids1.has("deleted-1"), false, [...ids1]);
    check("S2-11 同源组恰 1 张放行、1 张延后（perDay=1）",
      ids1.has("sib-a") && deferredIds1.has("sib-b") && !(ids1.has("sib-b") || deferredIds1.has("sib-a")),
      "sib-a 放行 / sib-b 延后", { cards: [...ids1], deferred: [...deferredIds1] });
    const fast1 = db.computeTodayQueue(now1, { withDamaged: false });
    check("S2-12 快速路径同源延后与全量一致（sib-b 延后）", fast1.deferred.some((c) => c.id === "sib-b"), true, fast1.deferred.map((c) => c.id));

    // ---- S3 EXPLAIN QUERY PLAN：快速路径命中 idx_cards_due ----
    console.log("== S3 索引命中 ==");
    const ro = new Database(dbFile, { readonly: true });
    const plan = ro.prepare("EXPLAIN QUERY PLAN " + db.TODAY_QUEUE_DUE_SQL).all(Date.now()).map((r) => r.detail).join(" | ");
    ro.close();
    console.log(`  查询计划：${plan}`);
    check("S3-1 EXPLAIN QUERY PLAN 包含 idx_cards_due", plan.includes("idx_cards_due"), "包含", plan);

    // ---- S4 C-18c 计数/分组接口口径 ----
    console.log("== S4 计数/分组专用接口 ==");
    const counts = db.countCardsByExtract();
    check("S4-1 countByExtract 按提取点聚合计数（非按卡 id 分组）",
      counts["ext-1"] === 2 && counts["ext-2"] === 1, { "ext-1": 2, "ext-2": 1 }, counts);
    check("S4-2 countByExtract 排除已删除与损坏 context_ref_json", counts["cnt-del"] === undefined && Object.keys(counts).length === 2, true, counts);
    const kpIds = db.listCardsWithKnowledgePoint().map((c) => c.id).sort();
    check("S4-3 listWithKnowledgePoint 只取非空 KP 的活卡", kpIds.join(",") === "kp-1,kp-2", "kp-1,kp-2", kpIds);

    console.log(`\ntoday-queue-fastpath：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) process.exitCode = 1;
  } catch (e) {
    console.error("测试失败：", e);
    process.exitCode = 1;
  } finally {
    try { if (db) db.closeDb(); } catch { /* 忽略 */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    app.exit(process.exitCode || 0);
  }
});
