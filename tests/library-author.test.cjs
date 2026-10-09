// D121 §1.1 书籍作者字段：迁移 / setLibraryItemAuthor 规则 / 导入落库 / docxAuthor
// @runtime: node
// 运行：node tests/library-author.test.cjs
// 无 Electron：用 Module._load 桩住 require("electron")，userData 指向临时目录，绝不触碰真实库。
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "libauthor-test-"));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { getPath: () => tmp, isPackaged: false, getAppPath: () => ROOT } };
  return origLoad.call(this, request, ...rest);
};

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)}`); }
}

(async () => {
  try {
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    console.log("== A 迁移与读侧 ==");
    const paste = db.createFromPaste("作者测试书", "# 一\n\n正文");
    const row = () => db.listItems().find((i) => i.id === paste.id);
    check("A1 listItems 带出 author 且新书默认 NULL", row() && "author" in row() && row().author === null, row());
    check("A2 getDocument 带出 author", "author" in db.getDocument(paste.id), db.getDocument(paste.id));
    // 迁移幂等：再跑一次 initDb 不抛
    let again = true;
    try { await db.initDb(); } catch (e) { again = String(e); }
    check("A3 initDb 重复执行（列已存在）不抛", again === true, again);

    console.log("== B setLibraryItemAuthor ==");
    const id = db.listItems().find((i) => i.title === "作者测试书").id;
    const before = db.listItems().find((i) => i.id === id).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    check("B1 返回 true", db.setLibraryItemAuthor(id, "  桑德尔  ") === true);
    const r1 = db.listItems().find((i) => i.id === id);
    check("B2 trim 后落库", r1.author === "桑德尔", r1.author);
    check("B3 updated_at 更新", r1.updatedAt > before, { before, after: r1.updatedAt });
    db.setLibraryItemAuthor(id, "   ");
    check("B4 空白→NULL", db.listItems().find((i) => i.id === id).author === null);
    db.setLibraryItemAuthor(id, "甲");
    db.setLibraryItemAuthor(id, "");
    check("B5 空串→NULL", db.listItems().find((i) => i.id === id).author === null);
    let thrown = null;
    try { db.setLibraryItemAuthor(id, "x".repeat(201)); } catch (e) { thrown = e; }
    check("B6 >200 字拒绝（抛错）", thrown instanceof Error, String(thrown));
    check("B7 恰 200 字允许", db.setLibraryItemAuthor(id, "y".repeat(200)) === true && db.listItems().find((i) => i.id === id).author.length === 200);
    check("B8 不存在的 id 返回 false", db.setLibraryItemAuthor("no-such-id", "A") === false);
    check("B9 getDocument 同步看到 author", db.getDocument(id).author === "y".repeat(200));

    console.log("== C 导入落库 ==");
    const withA = db.createImportedDoc({ title: "带作者", markdown: "# t\n\nbody", sourceType: "txt", sourceName: "a.txt", originalName: "original.txt", originalBuf: Buffer.from("x"), images: [], author: "  卡尔·波普尔 " });
    check("C1 createImportedDoc 存 author（trim）", db.listItems().find((i) => i.id === withA.id).author === "卡尔·波普尔");
    const noA = db.createImportedDoc({ title: "无作者", markdown: "# t\n\nbody", sourceType: "txt", sourceName: "b.txt", originalName: "original.txt", originalBuf: Buffer.from("x"), images: [] });
    check("C2 缺省 author → NULL", db.listItems().find((i) => i.id === noA.id).author === null);
    const emptyA = db.createImportedDoc({ title: "空作者", markdown: "# t\n\nbody", sourceType: "pdf", sourceName: "c.pdf", originalName: "original.pdf", originalBuf: Buffer.from("x"), images: [], author: "   " });
    check("C3 空白 author → NULL", db.listItems().find((i) => i.id === emptyA.id).author === null);
    const epub = db.createFromEpub("EPUB 书", "# c\n\nbody", [], "", null, "e.epub", "作者甲、作者乙");
    check("C4 createFromEpub 存 author", db.listItems().find((i) => i.id === epub.id).author === "作者甲、作者乙");

    console.log("== D docxAuthor ==");
    const { docxAuthor } = require(path.join(ROOT, "electron", "importers.js"));
    let JSZip = null;
    try { JSZip = require(require.resolve("jszip", { paths: [ROOT] })); } catch { /* 不可用 */ }
    if (!JSZip) {
      console.log("  (跳过：jszip 不可用)");
    } else {
      const mk = async (coreXml) => {
        const z = new JSZip();
        z.file("[Content_Types].xml", "<Types/>");
        if (coreXml != null) z.file("docProps/core.xml", coreXml);
        return await z.generateAsync({ type: "nodebuffer" });
      };
      const core = (creator) => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="a" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title>${creator}</cp:coreProperties>`;
      check("D1 读到 dc:creator", (await docxAuthor(await mk(core("<dc:creator>张三</dc:creator>")))) === "张三");
      check("D2 trim + 实体解码", (await docxAuthor(await mk(core("<dc:creator> A &amp; B </dc:creator>")))) === "A & B");
      check("D3 空 creator → null", (await docxAuthor(await mk(core("<dc:creator>  </dc:creator>")))) === null);
      check("D4 无 creator → null", (await docxAuthor(await mk(core("")))) === null);
      check("D5 无 core.xml → null", (await docxAuthor(await mk(null))) === null);
      check("D6 非 zip 字节 → null（不抛）", (await docxAuthor(Buffer.from("not a zip"))) === null);
    }
  } catch (e) {
    fail++;
    console.log("  ✗ 未捕获异常", e && e.stack ? e.stack : e);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
