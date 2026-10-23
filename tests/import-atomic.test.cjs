// @runtime: electron
// C-47：导入必须原子——第二条 INSERT 失败时，不得留下"书架上有书、打开没有正文"的书目，也不得留下资产目录
"use strict";
const { app } = require("electron");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ud = fs.mkdtempSync(path.join(os.tmpdir(), "c47-"));
app.setPath("userData", ud);

app.whenReady().then(async () => {
  const Database = require("better-sqlite3");
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  // 用第二个连接装一个"documents 插入即失败"的触发器，模拟磁盘将满时第二条 INSERT 失败（SQLITE_FULL）
  const side = new Database(path.join(ud, "library.db"));
  side.exec("CREATE TRIGGER c47_fail BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'c47-injected'); END;");
  side.close();
  const cases = [
    ["createFromPaste", () => db.createFromPaste("C47-粘贴", "正文")],
    ["createFromEpub", () => db.createFromEpub("C47-EPUB", "正文", [], null, Buffer.from("PK"), "a.epub", null)],
    ["createImportedDoc", () => db.createImportedDoc({ title: "C47-Word", markdown: "正文", sourceType: "word", originalName: "a.docx", originalBuf: Buffer.from("x"), images: [] })],
  ];
  for (const [name, fn] of cases) assert.throws(fn, /c47-injected/, `${name} 必须把错误抛给调用方`);
  const titles = db.listItems().map((i) => i.title);
  for (const t of ["C47-粘贴", "C47-EPUB", "C47-Word"]) assert.ok(!titles.includes(t), `失败的导入不得留下书目：${t}`);
  const assetsDir = path.join(ud, "assets");
  assert.deepStrictEqual(fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [], [], "失败的导入不得留下资产目录");
  // 去掉触发器后，三种导入都正常成功且有正文
  const side2 = new Database(path.join(ud, "library.db"));
  side2.exec("DROP TRIGGER c47_fail;");
  side2.close();
  const a = db.createFromPaste("C47-粘贴-正常", "正文");
  const b = db.createFromEpub("C47-EPUB-正常", "正文", [], null, Buffer.from("PK"), "a.epub", null);
  const c = db.createImportedDoc({ title: "C47-Word-正常", markdown: "正文", sourceType: "word", originalName: "a.docx", originalBuf: Buffer.from("x"), images: [] });
  for (const it of [a, b, c]) assert.ok(db.getDocument(it.id), `正常导入必须有文档：${it.title}`);
  console.log("import-atomic: 通过（3 种导入 × 失败回滚 + 正常写入）");
  db.closeDb();
  fs.rmSync(ud, { recursive: true, force: true });
  app.exit(0);
}).catch((e) => { console.error("FAIL", e && e.message); app.exit(1); });
