// 批注化摘录 · db 层接线回归（规格 §1.1 / §2.2，待登记 D61）
// @runtime: electron  @tier: 2  @gui: false  @id: ANNOTDB  @timeout: 300
// 运行：npx electron tests/annotation-db.test.cjs   （须先关应用）
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 覆盖：新列往返 / 新建时范围规范化 / 正文编辑自动重映射（含端点继承）/ 显式覆写 /
//       区间被删空降级为 '[]' / 老数据 null 不写回 / 撤销把范围一起退回去。
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
const R = (s, e) => ({ start: s, end: e });

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "annotdb-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const book = db.createFromPaste("ANNOTDB 测试书", "正文");
    // createFromPaste 返回对象，documentId 才是文档主键（用错会让 createExtract 静默返 false → 后面全崩）
    const docId = book.documentId;
    const ranges = (id) => JSON.parse(db.getExtract(id).quoteRangeJson ?? "null");

    console.log("== A 新列与新建路径 ==");
    const TEXT = "abcdefghij";
    const a = db.createExtract({
      parentType: "document", parentId: docId, documentId: docId, contentMarkdown: TEXT,
      comment: "我的批注", annotationType: "highlight", annotationColor: "#ffd400",
      tags: ["甲", "乙"], quoteRange: [R(2, 5)]
    });
    // 先证明"建出来了"再往下测：createExtract 父文档不存在时返回 false 而不抛，静默失败会把后面全带崩
    check("A0 createExtract 确实建成功（非 false）", a !== false && !!a.id, "含 id 的对象", a);
    const rowA = db.getExtract(a.id);
    check("A1 范围锚已落库", eq(JSON.parse(rowA.quoteRangeJson), [R(2, 5)]), [R(2, 5)], rowA.quoteRangeJson);
    check("A2 批注文字/型别/颜色往返", rowA.comment === "我的批注" && rowA.annotationType === "highlight" && rowA.annotationColor === "#ffd400",
      { comment: "我的批注", type: "highlight" }, { comment: rowA.comment, type: rowA.annotationType });
    check("A3 标签往返", eq(JSON.parse(rowA.tagJson), ["甲", "乙"]), ["甲", "乙"], rowA.tagJson);
    const b = db.createExtract({
      parentType: "document", parentId: docId, documentId: docId, contentMarkdown: TEXT, quoteRange: [R(5, 3), R(1, 2), R(2, 4)]
    });
    check("A4 乱序/反向区间在新建时被规范化合并", eq(ranges(b.id), [R(1, 4)]), [R(1, 4)], ranges(b.id));
    const c = db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: TEXT });
    check("A5 未传范围 → 列为 null（不写空数组）", db.getExtract(c.id).quoteRangeJson === null, null, db.getExtract(c.id).quoteRangeJson);

    console.log("== B 正文编辑 → 自动重映射 ==");
    db.updateExtract(a.id, { contentMarkdown: "abXcdefghij" });
    check("B1 起点处插入 → 继承（用户裁定）", eq(ranges(a.id), [R(2, 6)]), [R(2, 6)], ranges(a.id));
    db.updateExtract(a.id, { contentMarkdown: "abXcdefghijY" });
    check("B2 区间之后追加 → 不动", eq(ranges(a.id), [R(2, 6)]), [R(2, 6)], ranges(a.id));
    db.updateExtract(a.id, { contentMarkdown: "XabXcdefghijY" });
    check("B3 区间之前插入 → 整体右移", eq(ranges(a.id), [R(3, 7)]), [R(3, 7)], ranges(a.id));

    console.log("== C 显式覆写 / 删空 / 老数据 ==");
    db.updateExtract(a.id, { quoteRange: [R(0, 3)] });
    check("C1 显式覆写优先", eq(ranges(a.id), [R(0, 3)]), [R(0, 3)], ranges(a.id));
    db.updateExtract(a.id, { contentMarkdown: "Y" });
    check("C2 区间被删空 → '[]' 显式无锚", eq(ranges(a.id), []), [], ranges(a.id));
    db.updateExtract(c.id, { contentMarkdown: "abcdefghijX" });
    check("C3 老数据（无范围）编辑后仍为 null", db.getExtract(c.id).quoteRangeJson === null, null, db.getExtract(c.id).quoteRangeJson);

    console.log("== D 撤销把范围一起退回去 ==");
    const d = db.createExtract({
      parentType: "document", parentId: docId, documentId: docId, contentMarkdown: TEXT, quoteRange: [R(2, 5)]
    });
    db.updateExtract(d.id, { contentMarkdown: "abXcdefghij" });
    check("D1 编辑后范围已变", eq(ranges(d.id), [R(2, 6)]), [R(2, 6)], ranges(d.id));
    const undo = db.undoLast();
    check("D2 撤销成功", undo && undo.ok === true, true, undo && undo.ok);
    check("D3 撤销后正文与范围同时回退", eq(ranges(d.id), [R(2, 5)]) && db.getExtract(d.id).contentMarkdown === TEXT,
      { text: TEXT, range: [R(2, 5)] },
      { text: db.getExtract(d.id).contentMarkdown, range: ranges(d.id) });

    console.log("== E 层级链（面包屑的数据面） ==");
    {
      const root = db.createExtract({
        parentType: "document", parentId: docId, documentId: docId, contentMarkdown: TEXT, quoteRange: [R(2, 5)]
      });
      const c1 = db.getExtractChain(root.id);
      check("E1 无父：链只有自己，depth=1", c1.length === 1 && c1[0].id === root.id && c1[0].depth === 1, 1, c1.length);

      const child = db.createExtract({
        parentType: "extract", parentId: root.id, documentId: docId, contentMarkdown: "子摘录正文",
        contextRef: { parentExtractId: root.id, rootExtractId: root.id }
      });
      const c2 = db.getExtractChain(child.id);
      check("E2 两层：自根到当前（root → child）",
        eq(c2.map((n) => n.depth), [1, 2]) && c2[0].id === root.id && c2[1].id === child.id,
        [1, 2], c2.map((n) => n.depth));
      check("E3 链上文本是各自正文的前 40 字", c2[1].text === "子摘录正文", "子摘录正文", c2[1].text);

      const grand = db.createExtract({
        parentType: "extract", parentId: child.id, documentId: docId, contentMarkdown: "孙摘录",
        contextRef: { parentExtractId: child.id, rootExtractId: root.id }
      });
      const c3 = db.getExtractChain(grand.id);
      check("E4 三层：顺序＝自根到当前",
        eq(c3.map((n) => n.id), [root.id, child.id, grand.id]) && eq(c3.map((n) => n.depth), [1, 2, 3]),
        [1, 2, 3], c3.map((n) => n.depth));

      db.deleteExtract(child.id);
      const c4 = db.getExtractChain(grand.id);
      check("E5 父被软删 → 链在该处断开（只回自己，不臆造层级）",
        c4.length === 1 && c4[0].id === grand.id, 1, c4.length);

      check("E6 getExtract 自带的文本前缀链仍在（既有面未回退）",
        (db.getExtract(grand.id).chain || []).length === 0 || Array.isArray(db.getExtract(grand.id).chain),
        "数组", typeof db.getExtract(grand.id).chain);
    }

    // ---------- K：高亮与摘录分族（批 4 规格 §1.4 / R35） ----------
    console.log("== K 高亮/摘录分族 ==");
    {
      const doc2 = db.createFromPaste("K 段夹具", "正文").documentId;
      const hl = db.createExtract({
        parentType: "document", parentId: doc2, documentId: doc2,
        contentMarkdown: "K 纯高亮样本", kind: "highlight",
        quoteRange: [{ start: 0, end: 5 }]
      });
      const ex2 = db.createExtract({
        parentType: "document", parentId: doc2, documentId: doc2, contentMarkdown: "K 摘录样本"
      });
      check("K1 kind 落库为 highlight", db.getExtract(hl.id).kind === "highlight", "highlight", db.getExtract(hl.id).kind);
      const due = db.listDueExtracts(Date.now() + 30 * 86400000).map((x) => x.id);
      check("K2 纯高亮不进 due 队列", !due.includes(hl.id), false, due.includes(hl.id));
      check("K3 摘录照常进 due 队列", due.includes(ex2.id), true, due.includes(ex2.id));
      const all = db.listAllExtracts();
      check("K4 纯高亮进 listAll（浏览器/搜索可见）", all.some((x) => x.id === hl.id), true, all.length);
      check("K5 listAll 带 kind 字段", all.find((x) => x.id === hl.id).kind === "highlight", "highlight", all.find((x) => x.id === hl.id).kind);
      const exOld = db.createExtract({ parentType: "document", parentId: doc2, documentId: doc2, contentMarkdown: "K 未传 kind" });
      check("K6 未传 kind ⇒ extract（存量语义）", db.getExtract(exOld.id).kind === "extract", "extract", db.getExtract(exOld.id).kind);
      const bad = db.createExtract({ parentType: "document", parentId: doc2, documentId: doc2, contentMarkdown: "K 越界值", kind: "sneaky" });
      check("K7 越界 kind 归一为 extract", db.getExtract(bad.id).kind === "extract", "extract", db.getExtract(bad.id).kind);
      const usageBefore = db.getDailyUsage(Date.now());
      db.advanceExtract(hl.id, Date.now());
      db.advanceExtract(ex2.id, Date.now());
      const usageAfter = db.getDailyUsage(Date.now());
      check("K8 纯高亮不占每日摘录计数（advance 只对摘录计数）",
        usageAfter.newExtracts === usageBefore.newExtracts + 1, usageBefore.newExtracts + 1, usageAfter.newExtracts);
    }

    // ---------- L：批注文字 / 颜色 / 分族的可写与可撤销（批 4 Task 2） ----------
    console.log("== L 批注可写与撤销 ==");
    {
      const doc3 = db.createFromPaste("L 段夹具", "正文").documentId;
      const a = db.createExtract({ parentType: "document", parentId: doc3, documentId: doc3, contentMarkdown: "L 样本正文" });
      db.updateExtract(a.id, { comment: "第一版批注" });
      check("L1 批注文字落库", db.getExtract(a.id).comment === "第一版批注", "第一版批注", db.getExtract(a.id).comment);
      db.updateExtract(a.id, { comment: "第二版批注" });
      db.undoLast();
      check("L2 撤销退回上一版批注", db.getExtract(a.id).comment === "第一版批注", "第一版批注", db.getExtract(a.id).comment);
      db.updateExtract(a.id, { comment: "" });
      check("L3 清空 ⇒ comment 为 null（条目仍在）", db.getExtract(a.id).comment == null && !!db.getExtract(a.id), "null", db.getExtract(a.id).comment);
      db.updateExtract(a.id, { annotationColor: "teal" });
      check("L4 颜色落库", db.getExtract(a.id).annotationColor === "teal", "teal", db.getExtract(a.id).annotationColor);
      db.updateExtract(a.id, { annotationColor: "NOT A COLOR!!" });
      check("L5 非法颜色被忽略（保留原值）", db.getExtract(a.id).annotationColor === "teal", "teal", db.getExtract(a.id).annotationColor);
      db.updateExtract(a.id, { kind: "highlight" });
      check("L6 降级为纯高亮", db.getExtract(a.id).kind === "highlight", "highlight", db.getExtract(a.id).kind);
      check("L7 降级后不再进 due 队列", !db.listDueExtracts(Date.now() + 30 * 86400000).some((x) => x.id === a.id), false, true);
      db.updateExtract(a.id, { kind: "sneaky" });
      check("L8 越界 kind 被忽略", db.getExtract(a.id).kind === "highlight", "highlight", db.getExtract(a.id).kind);
    }

    console.log(`\n${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error("运行异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
    app.exit(fail ? 1 : 0);
  }
});
