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
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

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

    console.log(`\n${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error("运行异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录 */ }
    app.exit(fail ? 1 : 0);
  }
});
