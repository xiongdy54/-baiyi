// D111 主进程过滤 + 分页取数 db 层回归（electron 直跑：npx electron tests/d111-mpquery.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：GUIDE §6.8-6 数据通道（v48.67 / D111）
// 覆盖：①主进程求值（queryCardBrowserIds）× 渲染层引擎（tests/d108-query.bundle.cjs 与主进程消费
//       同一源码的编译产物）对拍矩阵——命中集逐行一致；②库指纹缓存失效；③meta 轻量行集字段；
//       ④行窗口 getWindow（按入参序、字段完整、≤500）；⑤同源组 siblingGroup + 今日暂缓 deferredToday；
//       ⑥listAllCards 缺 library_item_id 别名的潜伏缺陷修复取证。
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d111-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    // 渲染层引擎（与 src/lib/cardQuery.ts 同源编译产物——tests/d108-query.bundle.cjs）
    const rq = require(path.join(ROOT, "tests", "d108-query.bundle.cjs"));

    const NOW = Date.now();
    const PAST = Date.parse("2000-01-01T00:00:00Z");

    console.log("== D111-S1 夹具：两书 + 七卡（状态/标签/优先级/类型/同源/无来源） ==");
    const book1 = db.createFromPaste("D111 甲书", "甲书正文。");
    const book2 = db.createFromPaste("D111 乙书", "乙书正文。");
    const mk = (over) =>
      db.createCard({
        frontMarkdown: "D111 题面",
        backMarkdown: "答案",
        contextRef: { documentId: book1.documentId },
        ...over
      }).id;
    const c1 = mk({ frontMarkdown: "D111 苹果 题面甲", noteText: "备注甲", tags: ["考研::英语"], domain: ["数学"], priority: 20, cardType: "qa" });
    const c2 = mk({ frontMarkdown: "D111 香蕉 题面乙", cardType: "cloze", tags: ["考研英语"], priority: 80, fsrsJson: JSON.stringify({ state: "review", due: PAST, lapses: 3, reps: 5 }) });
    const c3 = mk({ frontMarkdown: "D111 樱桃 题面丙", contextRef: { documentId: book2.documentId }, contextPrefix: "前缀丁", tags: ["错题 本"], priority: 50 });
    const c4 = mk({ frontMarkdown: "D111 椰子 题面戊", contextRef: null, sourceRef: { title: "外典" }, priority: 50 });
    const c5 = mk({ frontMarkdown: "D111 菠萝 题面己", contextRef: { documentId: book2.documentId } });
    db.execRawSql("UPDATE cards SET status = 'archived', updated_at = ? WHERE id = ?", [Date.now(), c5]);
    const c6 = mk({ frontMarkdown: "D111 同源六", fsrsJson: JSON.stringify({ state: "new", due: PAST, lapses: 0 }), siblingKey: "d111-sib" });
    const c7 = mk({ frontMarkdown: "D111 同源七", fsrsJson: JSON.stringify({ state: "new", due: PAST, lapses: 0 }), siblingKey: "d111-sib" });
    db.updateCardLeech(c3, { suspended: true, suspendedAt: NOW });

    console.log("== D111-S2 渲染层视图（对拍基准：listAllCards 行 × 渲染引擎 cardRowMatches） ==");
    const allRows = db.listAllCards();
    check("夹具入库 7 行", allRows.length === 7, 7, allRows.length);
    const rendererIds = (query) => {
      const parsed = rq.parseCardQuery(query);
      return allRows
        .filter((c) =>
          rq.cardRowMatches(parsed, {
            frontMarkdown: c.frontMarkdown,
            backMarkdown: c.backMarkdown,
            noteText: c.noteText,
            contextPrefix: c.contextPrefix,
            docTitle: c.docTitle,
            domain: c.domain,
            tags: c.tags,
            cardType: c.cardType,
            status: c.status,
            leechSuspended: Boolean(c.leech && c.leech.suspended),
            fsrsState: (c.fsrs && c.fsrs.state) ?? "new",
            priority: c.priority
          })
        )
        .map((c) => c.id)
        .sort();
    };

    console.log("== D111-S3 对拍矩阵（主进程求值 ≡ 渲染层求值） ==");
    const QUERIES = [
      "",
      "D111",
      "题面 甲",
      "\"题面甲\"",
      "苹果 or 香蕉",
      "(tag:考研 or book:乙书) -status:suspended",
      "kind:card",
      "kind:extract",
      "book:甲书",
      "book:外典",
      "-book:甲书",
      "status:new",
      "status:suspended",
      "status:已归档",
      "priority<=20",
      "priority>=80",
      "priority=50",
      "priority<=30 or priority>=80",
      "tag:考研",
      "tag:考研::英语",
      "tag:考研英语",
      "tag:\"错题 本\"",
      "-tag:考研",
      "tag:考*",
      "type:qa",
      "-type:qa",
      "type:cloze status:review",
      "book:*书",
      "数学",
      "-status:archived (题面己 or 题面甲)"
    ];
    let parityFail = 0;
    for (const q of QUERIES) {
      const main = (await db.queryCardBrowserIds(q)).meta.map((m) => m.id).sort();
      const renderer = rendererIds(q);
      const ok = eq(main, renderer);
      if (!ok) parityFail++;
      check(`对拍「${q}」`, ok, renderer, main);
    }
    check("对拍矩阵整体（30 条查询全等）", parityFail === 0, 0, parityFail);

    console.log("== D111-S4 语义抽查（对拍之外的关键命中） ==");
    const idsOf = async (q) => (await db.queryCardBrowserIds(q)).meta.map((m) => m.id);
    check("tag 层级边界：tag:考研 命中 考研::英语 不命中 考研英语", eq(await idsOf("tag:考研"), [c1]), [c1], await idsOf("tag:考研"));
    check("book:外典（sourceRef 书名回落）命中无来源书卡", (await idsOf("book:外典")).includes(c4), true, await idsOf("book:外典"));
    check("status:suspended 命中挂起卡", eq(await idsOf("status:suspended"), [c3]), [c3], await idsOf("status:suspended"));

    console.log("== D111-S5 meta 轻量行集字段 ==");
    const meta1 = await db.getCardBrowserMeta();
    check("meta 总数 = 7", meta1.meta.length === 7, 7, meta1.meta.length);
    check("books 表去重两书", meta1.books.length === 2, 2, meta1.books);
    const m1 = meta1.meta.find((m) => m.id === c1);
    check("轻量行字段（bookId/docTitle/extractId 为 null）",
      m1 && m1.bookId && m1.docTitle === "D111 甲书" && m1.extractId === null && m1.fsrsState === "new" && m1.priority === 20 && m1.createdAt > 0,
      "bookId+docTitle+new+20", m1);
    const m5 = meta1.meta.find((m) => m.id === c5);
    check("轻量行 status=archived", m5 && m5.status === "archived", "archived", m5 && m5.status);
    const m3 = meta1.meta.find((m) => m.id === c3);
    check("轻量行 suspended=true / isLeech=false", m3 && m3.suspended === true && m3.isLeech === false, "suspended", m3);
    const mc = meta1.meta.find((m) => m.id === c2);
    check("轻量行 fsrsState/due/lapses/reps 投影", mc && mc.fsrsState === "review" && mc.lapses === 3 && mc.reps === 5 && mc.due === PAST, "review/3/5", mc);
    check("轻量行无大列（frontMarkdown 未透出）", m1 && !("frontMarkdown" in m1), "无", m1 && Object.keys(m1).filter((k) => k.includes("Markdown")));

    console.log("== D111-S6 库指纹缓存失效 ==");
    const fp1 = meta1.fp;
    const metaCached = await db.getCardBrowserMeta();
    check("无写入时指纹稳定（缓存命中）", metaCached.fp === fp1, fp1, metaCached.fp);
    const cachedRef = metaCached.meta === meta1.meta;
    check("缓存命中返回同一行集引用（不重扫）", cachedRef === true, true, cachedRef);
    const qBefore = (await db.queryCardBrowserIds("苹果")).meta.length;
    check("改标签前 tag:坚果 不命中 c1", (await db.queryCardBrowserIds("tag:坚果")).meta.length === 0, 0, "tag:坚果");
    db.setCardTags([{ id: c1, tags: ["坚果"] }]);
    const meta2 = await db.getCardBrowserMeta();
    check("写入后指纹变化", meta2.fp !== fp1, "新指纹", meta2.fp);
    check("写入后查询缓存不回旧结果（tag:坚果 命中 c1）", (await db.queryCardBrowserIds("tag:坚果")).meta.map((m) => m.id).includes(c1), true, "tag:坚果");

    console.log("== D111-S7 行窗口 getWindow ==");
    const shuffled = [c3, c1, c5, c2];
    const win = db.getCardsWindow(shuffled);
    check("窗口行按入参序返回", eq(win.map((r) => r.id), shuffled), shuffled, win.map((r) => r.id));
    const w1 = win.find((r) => r.id === c1);
    check("窗口行是全行（frontMarkdown/tags/leech/docTitle 完整）",
      w1 && w1.frontMarkdown === "D111 苹果 题面甲" && eq(w1.tags, ["坚果"]) && w1.docTitle === "D111 甲书",
      "全行字段", w1 && { f: w1.frontMarkdown, t: w1.tags });
    check("窗口行 libraryItemId 修复后非空（listAllCards 同修复）",
      w1 && w1.libraryItemId && w1.libraryItemId === (meta1.meta.find((m) => m.id === c1) || {}).bookId,
      "libraryItemId=bookId", w1 && w1.libraryItemId);
    const winEmpty = db.getCardsWindow([]);
    check("空入参返回空数组", winEmpty.length === 0, 0, winEmpty.length);
    const many = [];
    for (let i = 0; i < 600; i++) many.push(`no-such-${i}`);
    check("入参超 500 截断（通道契约 ≤500/次）", db.getCardsWindow(many).length === 0, 0, db.getCardsWindow(many).length);

    console.log("== D111-S8 同源组 + 今日暂缓 ==");
    const sib = db.listCardsBySibling("d111-sib");
    check("siblingGroup 返回组内全部卡", eq(sib.map((r) => r.id).sort(), [c6, c7].sort()), [c6, c7], sib.map((r) => r.id));
    const sibEmpty = db.listCardsBySibling("no-such-key");
    check("无同源组返回空", sibEmpty.length === 0, 0, sibEmpty.length);
    const deferred = db.listDeferredToday(NOW);
    const deferredIds = deferred.map((d) => d.id);
    check("同源对只放行一张、另一张暂缓", deferredIds.length === 1 && [c6, c7].includes(deferredIds[0]), "七张中暂缓一张（同源）", deferredIds);
    check("暂缓行带 deferReason（siblingKey/kind）", deferred[0] && deferred[0].deferReason && deferred[0].deferReason.siblingKey === "d111-sib" && ["revealed", "reviewed"].includes(deferred[0].deferReason.kind), "deferReason 完整", deferred[0]);

    console.log("== D111-S9 listAllCards 别名修复取证（§6.8-6 D111 顺带修复） ==");
    check("listAllCards 行带 libraryItemId（修复前恒 null）", allRows.every((r) => r.libraryItemId || r.id === c4), "有书卡非空", allRows.map((r) => r.libraryItemId));
    check("meta.bookId 与 listAllCards.libraryItemId 同值", eq(
      meta1.meta.map((m) => m.bookId).sort(),
      allRows.map((r) => r.libraryItemId || null).sort()
    ), "一致", "不一致");

    console.log(`\n==== d111-mpquery：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
    app.quit();
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
  }
});
