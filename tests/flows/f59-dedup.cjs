// F59 重复导入的去重纪律（真实库里 127 份冗余副本对应的行为，到底是谁放行的）
// @runtime: electron  @tier: 2  @gui: false  @id: F59  @timeout: 300
// 运行：npx electron tests/flows/f59-dedup.cjs
//
// 起因：F49 在真实库里量到 16 组重复 assets.hash、127 份冗余副本、161.6 MB 重复字节，
//       同一批字节最多被导入 23 次。既有流程只验「导入形状对不对」，没人问「同一个字节流导入两次会怎样」。
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F59",
  title: "重复导入去重纪律",
  angle: "同一字节流/同一书名重复导入：去重、复用、还是无节制增长",
  cites: ["§4.2", "§7.2", "§9.1 M2", "§6.1"],
  tier: 2,
  gui: false,
});

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f59"));
    app.setPath("userData", dir);
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    const dbFile = path.join(dir, "library.db");

    await runFlow(flow, async () => {
      flow.section("D1 同一 markdown 内容导入两次");
      const MD = "# 重复章\n\n这一段内容会被导入两次，用来观察系统是否有去重或提示。\n";
      const a = db.createFromPaste("F59 重复书", MD);
      const b = db.createFromPaste("F59 重复书", MD);
      const idA = a && (a.id || (a.item && a.item.id));
      const idB = b && (b.id || (b.item && b.item.id));
      flow.record("两次 createFromPaste 的返回 id", JSON.stringify([idA, idB]));
      const au1 = await audit(dbFile);
      const items = au1.rows("SELECT id, title, source_type FROM library_items WHERE is_deleted = 0");
      const docs = au1.count("documents");
      au1.close();
      flow.record("盘上活书目 / 文档数", `${items.length} / ${docs}`);
      flow.check(
        "同内容同标题重复导入：要么去重（1 本），要么明确另立（2 本）——但**必须可区分**，不得静默长成同标题双份",
        items.length !== 2 || new Set(items.map((r) => r.title)).size !== 1,
        "不产生无法区分的同标题双份",
        { 活书数: items.length, 标题集: [...new Set(items.map((r) => r.title))] }
      );

      flow.section("D2 同一图片字节建两次 asset（真实库 127 份冗余副本的机制）");
      const owner = idA;
      const mk = (kind) => db.createAssetForItem(String(owner), kind, "png", PNG);
      const r1 = mk("image-occlusion");
      const r2 = mk("image-occlusion");
      flow.record("两次 createAssetForItem 返回", JSON.stringify({ 一: r1 && (r1.id || r1.path), 二: r2 && (r2.id || r2.path) }).slice(0, 160));
      const au2 = await audit(dbFile);
      const rows = au2.rows("SELECT id, path, hash FROM assets");
      au2.close();
      const hashes = rows.map((r) => r.hash).filter(Boolean);
      const dupHashes = hashes.length - new Set(hashes).size;
      flow.record("assets 行数 / 重复 hash 数", `${rows.length} / ${dupHashes}`);
      const filesUnder = [];
      const walk = (d) => {
        for (const n of fs.readdirSync(d)) {
          const f = path.join(d, n);
          if (fs.statSync(f).isDirectory()) walk(f);
          else filesUnder.push(f);
        }
      };
      if (fs.existsSync(path.join(dir, "assets"))) walk(path.join(dir, "assets"));
      const byContent = new Map();
      for (const f of filesUnder) {
        const k = sha(fs.readFileSync(f));
        byContent.set(k, (byContent.get(k) || 0) + 1);
      }
      const physicalDupes = [...byContent.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
      flow.record("盘上物理文件数 / 内容重复份数", `${filesUnder.length} / ${physicalDupes}`);
      flow.check(
        "同一字节流第二次入库必须**复用**已有文件（不得长出第二份物理副本）",
        physicalDupes === 0,
        "0 份冗余",
        { 物理文件: filesUnder.length, 冗余副本: physicalDupes, 表内重复hash: dupHashes }
      );

      flow.section("D3 源码面：到底有没有人写过内容去重");
      const src = fs.readFileSync(dbPath, "utf8");
      const hashWrite = /hash\s*[:=]/.test(src) && /INSERT INTO assets/i.test(src);
      const dedupQuery = /WHERE\s+hash\s*=|ON\s+CONFLICT.*hash|GROUP BY\s+hash/i.test(src);
      const dedupByContent = /sha256|createHash|contentHash|hash\s*===|existing.*hash/i.test(src);
      flow.record("assets 表写 hash 列", hashWrite);
      flow.record("存在按 hash 查重的读路径", dedupQuery);
      flow.record("存在内容哈希去重逻辑", dedupByContent);
      flow.check(
        "既然 assets 有 hash 列，就必须有按 hash 去重/复用的一侧（有列无逻辑 = 死字段，与 D-TEST-50 同形）",
        !hashWrite || dedupQuery === true || dedupByContent === true,
        "有列就要有查重",
        { hashWrite, dedupQuery, dedupByContent }
      );

      flow.section("D4 备份会不会把冗余一起带走（体积放大到备份侧）");
      const bak = require(path.join(ROOT, "electron", "backup.js"));
      const backupDir = path.join(dir, "backups");
      db.persistNow();
      const created = await bak.createBackup({ label: "manual", backupDir, flush: () => db.persistNow() });
      if (created && created.file) {
        const size = fs.statSync(created.file).size;
        flow.record("备份包大小", `${(size / 1024).toFixed(1)} KB`);
        const au3 = await audit(dbFile);
        const n = au3.count("assets");
        au3.close();
        flow.record("包内应含的 asset 条目数", n);
        flow.check(
          "备份不得静默放大冗余：冗余副本数必须为 0（否则每次备份都再吃一遍重复字节）",
          physicalDupes === 0,
          "0 份冗余",
          { 冗余副本: physicalDupes, 备份KB: +(size / 1024).toFixed(1) }
        );
      } else {
        flow.check("createBackup 成功", false, "ok", created);
      }
    });
    setTimeout(() => app.exit(0), 200);
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.stack) || e));
    setTimeout(() => app.exit(1), 200);
  });
