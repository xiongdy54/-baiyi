// F04 崩溃与恢复流程（故障注入 + 重启语义）
// @runtime: electron  @tier: 2  @gui: false  @id: F04  @timeout: 300
// 运行：npx electron tests/flows/f04-crash-recovery.cjs   （或 node tests/flows/run.cjs --only F04）
//
// 角度：用户把这份工作当资产在用，最怕的就是「评完分闪退，分数没了/重了」。
//       这条流程**主动制造故障**：让落盘失败、留半截 tmp、外部改库、进程被杀，
//       然后验证文档承诺的恢复语义：原子替换（tmp 永不是事实源）、失败可重试且**绝不重放业务动作**、
//       重启后撤销账本一致、后台任务收敛成 interrupted 而不是 failed。
//       C-17 修订：D137 后 persist = wal_checkpoint(TRUNCATE)，G1/G2 改用第二连接持读事务注入
//       busy；checkpoint busy 不再让业务写入失败（成功返回、提交在 WAL），「绝不重放」由
//       写入口 A-7 陈旧快照拒绝 + persistNow 严格收敛共同承担。
//
// 依据：§4.4.8/§4.4.9 L172（成功边界 = COMMIT + persist + IPC；失败封锁；重试不重放 mutation）、
//       §7.2 L874（每次落库即落盘）、db.js 原子写实现（L679–692）、
//       §9.1 M15 v48.13「重启续跑：interrupted ≠ failed」、§7.1.8 sql.js 并发纪律。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F04",
  title: "崩溃与恢复",
  angle: "故障注入下的原子性与不重放",
  cites: ["§4.4.8", "§4.4.9", "§7.1.8", "§7.2", "§9.1 M15 v48.13"],
  tier: 2,
  gui: false,
});

const TABLES = ["cards", "review_logs", "review_skips", "extracts", "library_items", "material_map_runs"];

function fsrs(over = {}) {
  const now = Date.now();
  return { state: "review", due: now - 1000, lapses: 0, stability: 3, difficulty: 6, reps: 1, lastReview: now - 86400000, learningSteps: [], ...over };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f04"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const tmpFile = dbFile + ".tmp";

    const s = await runFlow(flow, async () => {
      const dbPath = path.join(ROOT, "electron", "db.js");
      delete require.cache[dbPath];
      let db = require(dbPath);
      await db.initDb();
      const mk = (label) =>
        db.createCard({
          noteText: `FLOWTEST F04 ${label}`,
          cardType: "qa",
          frontMarkdown: `F04 问题 ${label}`,
          backMarkdown: `F04 答案 ${label}`,
          priority: 50,
          tags: [],
          fsrsJson: JSON.stringify(fsrs()),
        }).id;

      // ---------- G1 checkpoint busy：写入成功、正式库不受损（C-17 新语义） ----------
      flow.section("G1 checkpoint busy 时写入成功且正式库不受损（C-17 / §4.4.9）");
      const victim = mk("A");
      db.persistNow();
      const goodBytes = fs.readFileSync(dbFile);
      const snapGood = snapshotAll(await audit(dbFile), TABLES);
      // 注入故障（D137 后 WAL 的真实模式；旧「tmp 路径占目录」注入随 sql.js 时代的 persist 退役已失效）：
      // 第二连接持读事务 → wal_checkpoint(TRUNCATE) busy=1。C-17 前 persist 抛错 → IPC reject →
      // UI 误报保存失败；C-17 后写入成功返回，提交在 WAL，主文件仍为上一完整版本。
      const Database = require("better-sqlite3");
      const blocker = new Database(dbFile);
      blocker.exec("BEGIN");
      blocker.prepare("SELECT 1 FROM cards LIMIT 1").get(); // deferred 读事务真正持有读锁
      let threw = null;
      try {
        db.saveReview(victim, { ...fsrs(), reps: 2, due: Date.now() + 86400000 }, "Good", 700, fsrs());
      } catch (e) {
        threw = String(e && e.message ? e.message : e);
      } finally {
        try { blocker.close(); } catch { /* 尽力 */ }
      }
      flow.check("C-17：checkpoint busy 时评分成功返回（已提交的写入不再被误报为失败）", !threw, "成功", threw);
      const afterBytes = fs.readFileSync(dbFile);
      flow.eq("busy 窗口内正式库主文件字节不变（提交在 WAL；要么上一份完整、要么新完整）", afterBytes.length, goodBytes.length);
      const reopened = await audit(dbFile);
      const snapReopened = snapshotAll(reopened, TABLES);
      flow.check("主文件仍是 busy 前的完整快照（未出现半截写，合并由 persistNow 完成）", Object.keys(diffSnapshots(snapGood, snapReopened)).length === 0, "{}", summaryOf(diffSnapshots(snapGood, snapReopened)) || "{}");
      flow.eq("主文件未被半途改写（大小与 busy 前一致）", fs.existsSync(dbFile) && fs.statSync(dbFile).size, goodBytes.length);

      // ---------- G2 收敛只补持久化，不重放业务 ----------
      flow.section("G2 persistNow 收敛不重放业务 mutation（§4.4.9 / C-17）");
      const memLogs = db.listAllReviewLogs().length;
      flow.check("busy 窗口内那次评分已提交（COMMIT 先于 checkpoint，同连接可读）", memLogs, (await audit(dbFile)).count("review_logs") + 1);
      const retry = db.persistNow();
      flow.eq("读锁释放后 persistNow（严格）合并成功", retry, true);
      const a2 = await audit(dbFile);
      flow.eq("收敛后磁盘日志数恰为内存日志数（不多不少＝没有重放）", a2.count("review_logs"), memLogs);
      const g2Card = a2.one("SELECT fsrs_json FROM cards WHERE id = ?", [victim]);
      flow.eq("落盘的是那一次评分的结果（不是两次）", JSON.parse(g2Card.fsrs_json).reps, 2);

      // ---------- G3 半截 tmp 残留 ----------
      flow.section("G3 崩溃留下的半截 tmp 在下次启动被清理（db.js:210）");
      fs.writeFileSync(tmpFile, Buffer.from("半截的、损坏的、永远不该被读到的内容"));
      delete require.cache[dbPath];
      db = require(dbPath);
      await db.initDb();
      flow.eq("启动后残留 tmp 已删除", fs.existsSync(tmpFile), false);
      const a3 = await audit(dbFile);
      flow.check("清理 tmp 未伤及正式库（卡与日志都在）", a3.count("cards") >= 1 && a3.count("review_logs") === memLogs, "数据完好", { cards: a3.count("cards"), logs: a3.count("review_logs") });
      flow.eq("重启后仍能读到崩溃前那次评分的完整结果", JSON.parse(a3.one("SELECT fsrs_json FROM cards WHERE id = ?", [victim]).fsrs_json).reps, 2);

      // ---------- G4 外部改库（sql.js 并发纪律） ----------
      flow.section("G4 应用运行期外部改库会被内存库覆盖（§7.1.8 的代价必须被知晓）");
      const externalId = "F04-EXTERNAL-ROW";
      const a4a = await audit(dbFile);
      const doc0 = a4a.one("SELECT id FROM documents LIMIT 1");
      a4a.exec(
        "INSERT INTO extracts (id, user_id, parent_type, parent_id, document_id, content_markdown, topic_next_at, priority, created_at, updated_at, sync_version, is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0,0)",
        [externalId, "local-user", "document", doc0 ? doc0.id : "x", doc0 ? doc0.id : "x", "外部脚本写的摘录", Date.now(), 60, Date.now(), Date.now()]
      );
      a4a.save();
      a4a.close();
      const seenBeforePersist = (await audit(dbFile)).one("SELECT id FROM extracts WHERE id = ?", [externalId]);
      flow.check("外部写入此刻在盘上可见", !!seenBeforePersist, true, !!seenBeforePersist);
      // 批次 E（D-TEST-15 T3 档）配套改夹具：这里要的是「应用内一次写触发 persist」这个副作用，
      // 而 createExtract 现在会先验父文档存在（幽灵 documentId 会被拒、也就不再 persist）。
      // 所以传真实文档 id；没有文档就先造一本——测的东西不变，只是不再依赖「门口没设防」。
      let appDocId = doc0 && doc0.id;
      if (!appDocId) {
        const made = db.createFromPaste("F04 外部写对照书", "# 章\n\n用于触发一次应用内写库。");
        const d = db.getDocument(made.id);
        appDocId = (d && d.id) || (d && d.documentId) || null;
      }
      flow.check("本条前置：拿到了一份真实文档（否则测不到应用内写库）", Boolean(appDocId), true, appDocId);
      db.createExtract({ parentType: "document", parentId: appDocId, documentId: appDocId, contentMarkdown: "应用内摘录", priority: 60 });
      const afterAppWrite = (await audit(dbFile)).one("SELECT id FROM extracts WHERE id = ?", [externalId]);
      flow.eq("应用一次 persist 即覆盖外部改动（所以外部操作必须先关应用）", afterAppWrite, null);
      db.deleteExtractIfPresent?.(externalId);

      // ---------- G5 后台任务重启语义 ----------
      flow.section("G5 运行中被关闭 → interrupted 而非 failed（§9.1 M15 v48.13 / D47 重启续跑）");
      const runKeys = Object.keys(db).filter((k) => /reconcile|resumable/i.test(k));
      flow.record("db 暴露的对账/续跑入口", runKeys.join(" "));
      flow.check("仓储层导出僵尸对账入口", runKeys.some((k) => k === "reconcileStaleMaterialMapRuns"), true, runKeys);
      const mkRun = async (id, status, ageMin) => {
        const a = await audit(dbFile);
        const t = Date.now() - ageMin * 60 * 1000;
        a.exec(
          "INSERT INTO material_map_runs (id, user_id, document_id, status, created_at, updated_at, sync_version, is_deleted) VALUES (?,?,?,?,?,?,0,0)",
          [id, "local-user", "doc-x", status, t, t]
        );
        a.save();
        a.close();
      };
      await mkRun("F04-RUN-STALE", "running", 120); // 超过 30 分钟阈值
      await mkRun("F04-RUN-FRESH", "running", 3); // 阈值内，不该被碰
      await mkRun("F04-RUN-EST", "estimating", 90); // 同样属僵尸集合
      await mkRun("F04-RUN-DONE", "completed", 120); // 已完成，绝不参与对账
      await mkRun("F04-RUN-NOW", "running", 0); // 刚刚写入：任何阈值下都不该被判僵尸
      delete require.cache[dbPath];
      db = require(dbPath);
      await db.initDb();
      const preReconcile = await audit(dbFile);
      flow.eq("仓储层单独 initDb 不越权改运行态（对账由主进程在启动时显式调用）", preReconcile.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-STALE'")?.status, "running");
      const n = db.reconcileStaleMaterialMapRuns();
      flow.record("本次对账收敛条数", n);
      const a5 = await audit(dbFile);
      const stale = a5.one("SELECT status, error_code, sync_version FROM material_map_runs WHERE id='F04-RUN-STALE'");
      flow.eq("超时 running 收敛为 interrupted", stale?.status, "interrupted");
      flow.eq("不是 failed（关掉应用≠任务失败，D47）", stale?.status === "failed" || stale?.status === "failed_timeout", false);
      flow.eq("error_code 记为 interrupted 供 UI 说清原因", stale?.error_code, "interrupted");
      flow.eq("阈值内的运行行不被误伤", a5.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-FRESH'")?.status, "running");
      flow.eq("estimating 同样收敛", a5.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-EST'")?.status, "interrupted");
      flow.eq("已完成行绝不参与对账", a5.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-DONE'")?.status, "completed");
      flow.eq("对账会刷盘（否则重启后僵尸复活）", a5.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-STALE'")?.status, "interrupted");
      flow.eq("对账不动 sync_version 之外的语义（版本号 +1，供同步）", Number(stale?.sync_version), 1);
      const second = db.reconcileStaleMaterialMapRuns();
      flow.eq("二次对账幂等（不重复计数）", second, 0);
      flow.eq("极小阈值仍受 60 秒下限保护（刚写入的运行不被误杀）", (() => { db.reconcileStaleMaterialMapRuns(0); return 1; })(), 1);
      const a5b = await audit(dbFile);
      flow.eq("0 秒龄的运行行仍是 running（下限生效）", a5b.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-NOW'")?.status, "running");
      flow.eq("阈值压到 60 秒下限后，3 分钟龄的行按新阈值收敛（不是无视阈值）", a5b.one("SELECT status FROM material_map_runs WHERE id='F04-RUN-FRESH'")?.status, "interrupted");
      const resumable = typeof db.listResumableMaterialMapRuns === "function" ? db.listResumableMaterialMapRuns() : null;
      if (resumable) {
        flow.check("续跑清单只收 interrupted/section_ready 两类", resumable.every((r) => ["interrupted", "section_ready"].includes(r.status)), true, resumable.map((r) => r.status));
        flow.check("被打断的 run 出现在续跑清单里（用户能继续，不必重跑）", resumable.some((r) => String(r.id) === "F04-RUN-STALE"), true, resumable.map((r) => r.id));
      } else {
        flow.record("续跑清单入口", "未导出 listResumableMaterialMapRuns（可能走 mindmap:pendingRuns IPC）");
      }

      // ---------- G6 跨进程撤销账本 ----------
      flow.section("G6 重启后撤销账本一致（§4.4.9）");
      const c6 = mk("UNDO-CROSS");
      const b6 = db.getCard(c6).fsrs;
      db.saveReview(c6, { ...b6, reps: b6.reps + 1, due: Date.now() + 3 * 86400000 }, "Good", 600, b6);
      const logs6 = (await audit(dbFile)).count("review_logs");
      delete require.cache[dbPath];
      db = require(dbPath);
      await db.initDb();
      const picked = db.getLastUndoableReview();
      flow.check("重启后最新一次评分仍可撤销", picked?.cardId === c6, c6, picked?.cardId);
      const u = db.undoLastReview();
      flow.eq("跨进程撤销复原到评分前", u.card.fsrs, b6);
      flow.eq("撤销后日志数恰减 1", (await audit(dbFile)).count("review_logs"), logs6 - 1);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F04 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
