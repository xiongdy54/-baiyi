// @runtime: electron
// C-22：资产完整性契约——同图内容寻址去重（同书两次调用返回同一 filename、目录仅 1 份文件）、
// 插库失败不留孤儿（无新文件、无 .part、无悬空行）、孤儿文件扫描（dryRun 清单 / partOnly 只清
// .part / 全删）、软删父摘录拒建子摘录（createExtract 返回 false）。
// 运行：npx electron tests/assets-integrity.test.cjs（或 node scripts/run-tests.mjs assets-integrity）
// 隔离 userData（app.setPath + mkdtemp），绝不触碰真实库（C-11 口径）。
// 插库失败注入用第二个 better-sqlite3 连接建 BEFORE INSERT 触发器（RAISE(ABORT)）——
// addAssetRow 与 createAssetForItem 同模块，require.cache 换不掉内部引用；而报告给的另一方案
// 「先 DROP TABLE assets」会让查重 SELECT 先抛错、走不到「写文件后插库失败」的目标路径，故用触发器。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "electron", "db.js");

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "assets-integrity-"));
  app.setPath("userData", tmp);
  const db = require(DB_PATH);
  await db.initDb();
  let raw = null; // 第二连接（注入插库失败）
  try {
    const book = db.createFromPaste("C-22 测试书", "# 内容\n正文");
    const itemId = book.id;
    const dir = path.join(tmp, "assets", itemId);
    const files = () => fs.readdirSync(dir).sort();

    // ---- S1 去重：同一 Buffer 同一本书两次 → 同一 filename，目录只有 1 个文件 ----
    const bufA = Buffer.from("c22-fake-image-bytes-A");
    const r1 = db.createAssetForItem(itemId, "image-occlusion", "png", bufA);
    const r2 = db.createAssetForItem(itemId, "image-occlusion", "png", bufA);
    check("(1a) 两次调用返回同一 filename", r2.filename === r1.filename, r1.filename, r2.filename);
    check("(1b) assetPath 指向同一文件", r2.assetPath === r1.assetPath, r1.assetPath, r2.assetPath);
    check("(1c) 目录里只有 1 个文件", files().length === 1, 1, files().length);
    check("(1d) 复用文件字节与原 Buffer 一致", fs.readFileSync(path.join(dir, r1.filename)).equals(bufA) === true, true, false);

    // ---- S2 不同内容的图仍各自落盘（去重不过度合并）----
    const bufB = Buffer.from("c22-fake-image-bytes-B");
    const r3 = db.createAssetForItem(itemId, "image-occlusion", "png", bufB);
    check("(2a) 不同字节得到新文件、目录 2 个", r3.filename !== r1.filename && files().length === 2, 2, files().length);

    // ---- S3 插库失败：不留新文件、不留 .part、不留悬空行 ----
    const Database = require("better-sqlite3");
    raw = new Database(path.join(tmp, "library.db"));
    raw.exec("CREATE TRIGGER c22_fail_asset_insert BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT, 'c22-test: insert blocked'); END;");
    const bufC = Buffer.from("c22-fake-image-bytes-C");
    let threw = null;
    try {
      db.createAssetForItem(itemId, "image-occlusion", "png", bufC);
    } catch (e) {
      threw = e;
    }
    const afterFail = files();
    const rowCount = raw.prepare("SELECT COUNT(*) AS n FROM assets").get().n;
    check("(3a) 插库被拒后 createAssetForItem 抛错", Boolean(threw && String(threw.message).includes("c22-test")), "抛错含 c22-test", threw && threw.message);
    check("(3b) 目录没有新增文件、没有 .part", afterFail.length === 2 && !afterFail.some((f) => f.endsWith(".part")), "[2 个文件, 无 .part]", afterFail);
    check("(3c) assets 表没有悬空行", rowCount === 2, 2, rowCount);

    // 撤掉触发器后同图重试成功（清理路径没有把环境弄坏）
    raw.exec("DROP TRIGGER c22_fail_asset_insert;");
    raw.close();
    raw = null;
    const r4 = db.createAssetForItem(itemId, "image-occlusion", "png", bufC);
    check("(3d) 清障后同图重试成功、目录恰 3 个文件", Boolean(r4 && r4.filename) && files().length === 3, 3, files().length);

    // ---- S4 孤儿扫描：dryRun 清单 / partOnly 只清 .part / 全删 ----
    fs.writeFileSync(path.join(dir, "stray-occl.png"), "stray");
    fs.writeFileSync(path.join(dir, "occl-stale.part"), "part");
    const relStray = `${itemId}/stray-occl.png`;
    const relPart = `${itemId}/occl-stale.part`;
    const dry = db.sweepOrphanAssetFiles({ dryRun: true, minAgeMs: 0 });
    check("(4a) dryRun 列出无主文件与 .part", dry.orphans.includes(relStray) && dry.orphans.includes(relPart), [relStray, relPart], dry.orphans);
    check("(4b) 被引用的文件不进清单", !dry.orphans.some((o) => o.endsWith(r1.filename) || o.endsWith(r3.filename) || o.endsWith(r4.filename)), "不含已引用", dry.orphans);
    check("(4c) dryRun 不删任何文件", fs.existsSync(path.join(dir, "stray-occl.png")) && fs.existsSync(path.join(dir, "occl-stale.part")), "两个都在", "检查磁盘");
    const aged = db.sweepOrphanAssetFiles({ dryRun: true, minAgeMs: 3600_000 });
    check("(4d) 未到 minAgeMs 的无主文件不列（.part 不看年龄）", !aged.orphans.includes(relStray) && aged.orphans.includes(relPart), "无 stray、有 .part", aged.orphans);
    const partOnly = db.sweepOrphanAssetFiles({ dryRun: false, partOnly: true, minAgeMs: 0 });
    check("(4e) partOnly 只删 .part、无主文件保留", !fs.existsSync(path.join(dir, "occl-stale.part")) && fs.existsSync(path.join(dir, "stray-occl.png")), ".part 删、stray 留", "检查磁盘");
    check("(4f) partOnly 把其余孤儿登记为待决策", partOnly.keptForDecision.includes(relStray) && partOnly.removed.includes(relPart), "stray 留档、part 已删", partOnly);
    const full = db.sweepOrphanAssetFiles({ dryRun: false, minAgeMs: 0 });
    check("(4g) 全量模式删掉无主文件、目录回到 3 个", !fs.existsSync(path.join(dir, "stray-occl.png")) && files().length === 3, 3, files().length);
    check("(4h) 全量模式清单与删除一致", full.orphans.includes(relStray) && full.removed.includes(relStray) && full.keptForDecision.length === 0, [relStray, relStray, 0], [full.orphans, full.removed, full.keptForDecision.length]);

    // ---- S5 软删父摘录拒建子摘录 ----
    const book2 = db.createFromPaste("C-22 父子摘录书", "# 父子");
    const d2 = book2.documentId;
    const parent = db.createExtract({ parentType: "document", parentId: d2, documentId: d2, contentMarkdown: "父摘录正文" });
    check("(5a) 活文档上建根摘录成功", Boolean(parent && parent.id), "返回 id", parent);
    const childOk = db.createExtract({ parentType: "extract", parentId: parent.id, documentId: d2, contentMarkdown: "活父下的子摘录" });
    check("(5b) 活父摘录下建子摘录成功", Boolean(childOk && childOk.id), "返回 id", childOk);
    const del = db.deleteExtract(parent.id);
    check("(5c) 软删父摘录生效", Boolean(del && del.ok === true), "{ok:true}", del);
    const childAfterDel = db.createExtract({ parentType: "extract", parentId: parent.id, documentId: d2, contentMarkdown: "软删父下的子摘录" });
    check("(5d) 软删父摘录下建子摘录返回 false", childAfterDel === false, false, childAfterDel);
    const childGhost = db.createExtract({ parentType: "extract", parentId: "不存在的摘录id", documentId: d2, contentMarkdown: "幽灵父下的子摘录" });
    check("(5e) 幽灵父摘录下建子摘录返回 false", childGhost === false, false, childGhost);

    // ---- S6 制卡台自由截图（workbench-assets）同样去重 ----
    const w1 = db.createAssetForItem("workbench-assets", "image-occlusion", "png", bufA);
    const w2 = db.createAssetForItem("workbench-assets", "image-occlusion", "png", bufA);
    check("(6a) workbench 归属同图去重、目录 1 个文件", w2.filename === w1.filename && fs.readdirSync(path.join(tmp, "assets", "workbench-assets")).length === 1, w1.filename, w2.filename);
  } catch (e) {
    fail += 1;
    console.log(`  ✗ 场景执行异常：${(e && (e.stack || e.message)) || e}`);
  } finally {
    console.log(`\nassets-integrity: ${pass} 通过 / ${fail} 失败`);
    try {
      if (raw && raw.open) raw.close();
    } catch { /* 尽力 */ }
    try {
      db.closeDb();
    } catch { /* 尽力 */ }
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
    app.exit(fail > 0 ? 1 : 0);
  }
});
