// F05 备份—恢复—升级生命周期流程
// @runtime: electron  @tier: 2  @gui: false  @id: F05  @timeout: 420
// 运行：npx electron tests/flows/f05-data-lifecycle.cjs   （或 node tests/flows/run.cjs --only F05）
//
// 角度：其他流程验证「这一刻正确」，这条验证「数据活得比这次会话长」。
//       备份/恢复是用户唯一的自救手段（§9.1 M2），而它的承诺面很宽：
//       整库 + assets + settings + memory 目录必须一起走（§4.18 L396 明写记忆必须进备份），
//       ai-config.json（加密 Key）必须**不**进默认备份（§7.6 L919 禁区），
//       恢复必须先自保、且只能在重启后换入（§7.1.8 sql.js 运行期禁换库），
//       旧版本库文件在新构建下要能被补列并保留全部事实（§7.2 L870）。
//
// 依据：§9.1 M2 验收、§7.2 L869/L870/L874/L875、§7.6 L919、§4.18 L396、
//       §4.4.9 L172（无快照的旧日志不可撤销）、§7.1.4 L858（重启不丢数据）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const JSZip = require("jszip");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit, canonical } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F05",
  title: "备份—恢复—升级生命周期",
  angle: "时间维度：数据跨会话/跨版本存活",
  cites: ["§9.1 M2", "§7.2", "§7.6", "§4.18", "§4.4.9", "§7.1.4"],
  tier: 2,
  gui: false,
});

const LIFE_TABLES = ["library_items", "documents", "extracts", "cards", "card_issues", "review_logs", "review_skips", "journal_entries", "prompt_templates", "fsrs_configs", "knowledge_points"];

function fsrsState(over = {}) {
  const now = Date.now();
  return { state: "review", due: now + 86400000, lapses: 0, stability: 3, difficulty: 6, reps: 2, lastReview: now, learningSteps: [], ...over };
}

function seed(db, dir, rng) {
  const itemId = db.createFromPaste("F05 粘贴书 " + rng.seed, "# 第一章\n\n内容甲乙丙。").id || db.listItems()[0].id;
  const item = db.listItems().find((i) => /F05 粘贴书/.test(i.title));
  const doc = db.getDocument(item.id) || null;
  const docId = doc?.id || null;
  const ex = db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "F05 摘录", priority: 70 });
  const cardIds = [];
  for (let i = 0; i < 3 + rng.int(3); i++) {
    cardIds.push(
      db.createCard({
        noteText: `F05 卡 ${i}`,
        cardType: "qa",
        frontMarkdown: `F05 问题 ${i}`,
        backMarkdown: `F05 答案 ${i}`,
        priority: 50,
        tags: ["f05"],
        siblingKey: "act:f05-" + rng.seed,
        fsrsJson: JSON.stringify(fsrsState({ due: Date.now() - i * 1000 })),
      }).id
    );
  }
  const before = db.getCard(cardIds[0]).fsrs;
  db.saveReview(cardIds[0], { ...before, reps: before.reps + 1, due: Date.now() + 2 * 86400000 }, "Good", 900, before);
  db.saveSkip(cardIds[1]);
  db.createJournalEntry({ contentMarkdown: "F05 日记 " + rng.seed, source: "app" });
  // settings.json 只有写过才存在，而备份按「存在才打包」——先制造真实形状
  db.setActiveFsrsConfig("cfg-default");
  // assets 与 memory 目录：备份必须带上（§4.18 L396 / §9.1 M2）
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "f05-asset.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  fs.mkdirSync(path.join(dir, "memory", "topics", "工作"), { recursive: true });
  fs.writeFileSync(path.join(dir, "memory", "core.md"), "# 核心记忆\n\n- F05 事实\n");
  fs.writeFileSync(path.join(dir, "memory", "topics", "工作", "f05.md"), "# 子主题\n\n- 处境 A\n");
  // 加密 Key 文件：默认备份绝不能含（§7.6 L919）
  fs.writeFileSync(path.join(dir, "ai-config.json"), JSON.stringify({ keys: { openai: "sk-SECRET-MUST-NOT-BACKUP" } }));
  db.persistNow();
  return { item, cardIds, ex, docId };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f05"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const backupDir = path.join(dir, "backups");

    const s = await runFlow(flow, async () => {
      let dbPath = path.join(ROOT, "electron", "db.js");
      delete require.cache[dbPath];
      let db = require(dbPath);
      await db.initDb();
      const bak = require(path.join(ROOT, "electron", "backup.js"));

      // ---------- B1 播种 + 备份清单 ----------
      flow.section("B1 备份内容清单（§9.1 M2 / §4.18 L396 / §7.6 L919）");
      const seeded = seed(db, dir, flow.rng);
      flow.guard("播种成功", () => seeded.cardIds.length >= 3);
      const preAud = await audit(dbFile);
      const preSnap = snapshotAll(preAud, LIFE_TABLES);
      flow.record("播种卡数", preSnap.cards.size);
      const created = await bak.createBackup({ label: "manual", backupDir, flush: () => db.persistNow() });
      flow.check("createBackup 成功", created.ok === true && !!created.file, "ok+file", created);
      flow.check("备份落在指定目录", created.file && fs.existsSync(created.file), true, created.file);
      const zip = await JSZip.loadAsync(fs.readFileSync(created.file));
      const entries = Object.keys(zip.files);
      flow.record("备份条目", entries.join(" "));
      for (const need of ["library.db", "settings.json", "backup-meta.json"]) {
        flow.check(`备份含 ${need}`, entries.includes(need), true, entries.includes(need));
      }
      flow.check("备份含 assets（§9.1 M2）", entries.some((e) => e.startsWith("assets/")), true, entries.filter((e) => e.startsWith("assets/")));
      flow.check("备份含 memory 目录（§4.18 L396 明写必须）", entries.some((e) => e.startsWith("memory/")), true, entries.filter((e) => e.startsWith("memory/")));
      flow.eq("默认备份绝不含 ai-config.json（§7.6 L919 禁区）", entries.some((e) => /ai-config/.test(e)), false);
      const meta = await bak.readBackupMeta(created.file);
      flow.eq("meta 标记本应用与格式版本", [meta?.app, meta?.format], ["incremental-reading-dev", 1]);
      flow.eq("meta 如实声明未勾选 AI 配置", meta?.includesAIConfig, false);
      flow.record("meta.counts（备份清单展示数据规模）", meta?.counts ?? "null（createBackup 需调用方传 counts）");
      flow.record("meta.assetFiles / memoryFiles", `${meta?.assetFiles} / ${meta?.memoryFiles}`);
      flow.eq("assets 计数与实际打包一致", meta?.assetFiles, 1);
      flow.eq("memory 计数与实际打包一致", meta?.memoryFiles, 2);
      const includeAi = await bak.createBackup({ label: "manual", backupDir, flush: () => db.persistNow(), includeAIConfig: true });
      const zipAi = await JSZip.loadAsync(fs.readFileSync(includeAi.file));
      flow.check("显式勾选才含 ai-config（勾选语义生效）", Object.keys(zipAi.files).some((e) => /ai-config/.test(e)), true, Object.keys(zipAi.files).filter((e) => /ai-config/.test(e)));
      fs.rmSync(includeAi.file, { force: true });

      // ---------- B2 破坏现场 → 恢复 → 逐行等值 ----------
      flow.section("B2 恢复后表级逐行等值（§7.1.4 L858 / §7.1.8 只能重启换入）");
      db.persistNow();
      const restored = await bak.restoreBackup(created.file, { backupDir });
      flow.check("restoreBackup 受理", restored.ok === true, "ok", restored);
      flow.check("恢复前自动生成 safety 备份（防误恢复本身）", fs.readdirSync(backupDir).some((f) => /^backup-safety-/.test(f)), true, fs.readdirSync(backupDir));
      flow.check("运行期不直接换库：只写 staging + marker（§7.1.8）", fs.existsSync(path.join(dir, "restore-staging", "library.db")) && fs.existsSync(path.join(dir, "restore-pending.json")), true, { staging: fs.existsSync(path.join(dir, "restore-staging")), marker: fs.existsSync(path.join(dir, "restore-pending.json")) });
      // 破坏现场（模拟用户误删/盘损）
      fs.rmSync(dbFile, { force: true });
      fs.rmSync(path.join(dir, "memory"), { recursive: true, force: true });
      fs.rmSync(path.join(dir, "assets"), { recursive: true, force: true });
      fs.writeFileSync(path.join(dir, "settings.json"), "{}");
      const applied = bak.applyPendingRestore();
      flow.check("applyPendingRestore 换入 library.db", Array.isArray(applied?.restored) && applied.restored.includes("library.db"), "restored 含 library.db", applied?.restored ?? applied);
      for (const part of ["assets", "memory", "settings.json"]) {
        flow.check(`换入清单含 ${part}`, applied?.restored?.includes(part), true, applied?.restored);
      }
      flow.eq("换入后绝不含 ai-config（未勾选就不该回来）", applied?.restored?.includes("ai-config.json"), false);
      flow.eq("换入后 pending 标记被清除", fs.existsSync(path.join(dir, "restore-pending.json")), false);
      delete require.cache[dbPath];
      db = require(dbPath);
      await db.initDb();
      const postSnap = snapshotAll(await audit(dbFile), LIFE_TABLES);
      const d = diffSnapshots(preSnap, postSnap);
      flow.check("恢复后关键表逐行等值（卡/日志/摘录/条目/配置全数回来）", Object.keys(d).length === 0, "{}", summaryOf(d) || "{}");
      flow.check("memory 目录随备份回来（§4.18 L396）", fs.existsSync(path.join(dir, "memory", "core.md")), true, fs.existsSync(path.join(dir, "memory", "core.md")));
      flow.check("assets 随备份回来", fs.existsSync(path.join(dir, "assets", "f05-asset.png")), true);
      flow.check("settings 随备份回来（app 段非空）", (() => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"))).length > 0; } catch { return false; } })(), true);
      flow.eq("恢复后卡数等于备份时卡数", postSnap.cards.size, preSnap.cards.size);

      // ---------- B3 路径穿越防护 ----------
      flow.section("B3 恶意 zip 不得写到 userData 之外（§9.1 M2 验收）");
      const evil = new JSZip();
      evil.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1, label: "manual", counts: {} }));
      evil.file("library.db", fs.readFileSync(dbFile));
      evil.file("../evil-outside.txt", "escaped");
      evil.file("assets/../../evil-asset.txt", "escaped");
      const evilFile = path.join(backupDir, "backup-manual-evilmalicious-000000.zip");
      fs.writeFileSync(evilFile, await evil.generateAsync({ type: "nodebuffer" }));
      const outside = path.join(path.dirname(dir), "evil-outside.txt");
      const outside2 = path.join(dir, "..", "evil-asset.txt");
      const ev = await bak.restoreBackup(evilFile, { backupDir });
      flow.check("穿越备份被拒绝或路径被钳制", ev.ok !== true || (!fs.existsSync(outside) && !fs.existsSync(outside2)), "拒绝/钳制", { result: ev, outside: fs.existsSync(outside), outside2: fs.existsSync(outside2) });
      flow.check("外部未落地任何逃逸文件", !fs.existsSync(outside) && !fs.existsSync(outside2), true, { outside: fs.existsSync(outside), outside2: fs.existsSync(outside2) });
      fs.rmSync(evilFile, { force: true });

      // ---------- B4 不完整/foreign 备份必须被拒 ----------
      flow.section("B4 损坏与非本应用备份被拒（恢复不能把好数据换没）");
      const goodBefore = (await audit(dbFile)).count("cards");
      const junk = new JSZip();
      junk.file("readme.txt", "不是备份");
      const junkFile = path.join(backupDir, "backup-manual-junkjunk-000000.zip");
      fs.writeFileSync(junkFile, await junk.generateAsync({ type: "nodebuffer" }));
      const r1 = await bak.restoreBackup(junkFile, { backupDir });
      flow.check("缺 backup-meta 的 zip 被拒", r1.ok !== true, "拒绝", r1);
      const foreign = new JSZip();
      foreign.file("backup-meta.json", JSON.stringify({ app: "some-other-app", format: 1 }));
      const foreignFile = path.join(backupDir, "backup-manual-foreign-000000.zip");
      fs.writeFileSync(foreignFile, await foreign.generateAsync({ type: "nodebuffer" }));
      const r2 = await bak.restoreBackup(foreignFile, { backupDir });
      flow.check("非本应用/格式版本不匹配的备份被拒", r2.ok !== true, "拒绝", r2);
      flow.eq("两次被拒后现场卡数不变（拒绝不等于半恢复）", (await audit(dbFile)).count("cards"), goodBefore);
      fs.rmSync(junkFile, { force: true });
      fs.rmSync(foreignFile, { force: true });

      // ---------- B5 旧形态库（v22 无快照日志）升级 ----------
      flow.section("B5 旧形态库升级：补列不丢事实、旧日志不可撤销（§4.4.9 L172 / §7.2 L870）");
      const oldAud = await audit(dbFile);
      const someCard = [...preSnap.cards.keys()][0];
      oldAud.exec(
        "INSERT INTO review_logs (id, card_id, rating, duration_ms, reviewed_at) VALUES (?,?,?,?,?)",
        ["legacy-log-1", someCard, "Good", 800, Date.now() - 90 * 86400000]
      );
      oldAud.exec("UPDATE review_logs SET fsrs_after_json = NULL, fsrs_before_json = NULL WHERE id = 'legacy-log-1'");
      oldAud.save();
      oldAud.close();
      delete require.cache[dbPath];
      db = require(dbPath);
      await db.initDb();
      const upAud = await audit(dbFile);
      const legacy = upAud.one("SELECT * FROM review_logs WHERE id = 'legacy-log-1'");
      flow.check("旧日志在新库中仍可读（升级不删历史）", !!legacy, true, !!legacy);
      flow.eq("旧日志快照列为空", legacy.fsrs_after_json, null);
      const picked = db.getLastUndoableReview();
      flow.check(
        "无快照的旧日志永不被选为可撤销项（§4.4.9 L172）",
        !picked || String(picked.logId ?? picked.id ?? "") !== "legacy-log-1",
        "不选中 legacy-log-1",
        picked ? { id: picked.logId ?? picked.id, cardId: picked.cardId } : null
      );
      const undo = db.undoLastReview();
      flow.check(
        "撤销不会顺带改动/删除旧日志（旧日志只读不回写）",
        !!(await audit(dbFile)).one("SELECT id FROM review_logs WHERE id='legacy-log-1'"),
        true,
        undo.ok
      );
      flow.eq("升级后卡数不减", (await audit(dbFile)).count("cards"), goodBefore);
      flow.eq("升级不重复播种 cfg-default", (await audit(dbFile)).rows("SELECT COUNT(*) AS n FROM fsrs_configs WHERE id='cfg-default'")[0].n, 1);
      const seqs = (await audit(dbFile)).rows("SELECT id, review_seq FROM review_logs ORDER BY review_seq").map((r) => Number(r.review_seq));
      flow.record("review_seq 序列（含外部注入的 NULL 序列行）", seqs.join(","));
      flow.check(
        "已有历史行序不被打乱（回填只发生在迁移时，不追改既有行）",
        seqs.filter((v) => v > 0).every((v, i, arr) => i === 0 || v > arr[i - 1]),
        true,
        seqs
      );

      // ---------- B6 轮换与按天去重 ----------
      flow.section("B6 自动备份按天去重与轮换（§9.1 M2）");
      const auto1 = await bak.createBackup({ label: "auto", backupDir, flush: () => db.persistNow() });
      const auto2 = await bak.createBackup({ label: "auto", backupDir, flush: () => db.persistNow() });
      flow.eq("同日第二次自动备份跳过（按天去重）", auto2.skipped === true, true);
      flow.check("自动备份文件名带日期", /^backup-auto-\d{4}-\d{2}-\d{2}\.zip$/.test(path.basename(auto1.file)), true, path.basename(auto1.file));
      for (let i = 0; i < 5; i++) {
        await bak.createBackup({ label: "auto", backupDir, now: new Date(Date.now() - (i + 1) * 86400000), flush: () => {} });
      }
      bak.rotateAutoBackups(backupDir, 3);
      const autos = fs.readdirSync(backupDir).filter((f) => /^backup-auto-/.test(f));
      flow.eq("轮换只保留最近 3 份自动备份", autos.length, 3);
      flow.check("手动备份不参与轮换（用户资产不被清理）", fs.readdirSync(backupDir).some((f) => /^backup-manual-/.test(f)), true);
      flow.record("backups 目录最终内容", fs.readdirSync(backupDir).join(" "));
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F05 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
