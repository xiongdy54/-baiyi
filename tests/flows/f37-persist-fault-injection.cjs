// F37 落盘故障注入层（跨模块不变量 · 「写库成功但落盘失败」的系统性普查）
// @runtime: electron  @tier: 1  @gui: false  @id: F37  @timeout: 420
// 运行：npx electron tests/flows/f37-persist-fault-injection.cjs   （或 node tests/flows/run.cjs --only F37）
//
// 为什么要有这一层：F35 证明「saveReview 的 persist 在 COMMIT 之后抛错」会造成一次呈现计入两条日志，
//   F34 证明「未来时间戳」会让调度器抛错砖死复习页，repro-restore-integrity 证明恢复换入有三处毁数据的
//   非原子写法。三件事同一个形状：**主路径全绿，故障路径无人测**。
//   既有 F01–F36 里没有任何一条注入过 IO 故障 —— 这类缺陷它们结构上就拦不住。
//
// 本层不针对某个函数，而是把 db.js 导出的**每一个 mutating 函数**过一遍同一套判据（C-17 新语义）：
//   M1 checkpoint busy 时业务写入必须**成功返回**（不抛错——数据在 COMMIT 已持久化，抛错＝UI 误报
//      「保存失败」→ 用户重试产生重复数据；失败只允许记日志延后合并）
//   M2 内存态必须已改写且同连接可读（提交真实可见，不是假成功）
//   M3 失败后 library.db.tmp 是否残留（persist 不再产出 tmp）
//   M4 补一次 persistNow（严格 checkpoint）后，磁盘是否收敛到与内存一致（不留下永久分歧）
//   M5 【最严】失败瞬间内存态不得「只改了一半」—— 那才是真数据损坏
//
// 依据：§7.2 L874（每次落库即落盘，日记防抖为唯一例外）、§7.1.4（重启不丢数据）、
//       §4.4.9（成功边界 = COMMIT + persist + IPC）、§4.4.5（fsrs_json 八字段完整往返）、C-17。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { bootFlowDb, reopenFlowDb, audit, quit } = require("./lib/dbenv.cjs");

const DAY = 86_400_000;
const flow = new Flow({
  id: "F37",
  title: "落盘故障注入普查",
  angle: "每个写库函数在 persist() 抛错时是否守住内存一致性与错误可见性",
  cites: ["§7.2", "§7.1.4", "§4.4.9", "§4.4.5"],
  tier: 1,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const { db, dir, dbFile } = await bootFlowDb("f37");
    const s = await runFlow(flow, async () => {
      const NL = String.fromCharCode(10);
      const bk = db.createFromPaste("F37 材料", ["# 第一章", "", "落盘故障注入用正文。"].join(NL));
      const mkCard = (i) => db.createCard({
        noteText: `F37-K${i}`, cardType: "qa", frontMarkdown: `问 ${i}`, backMarkdown: `答 ${i}`,
        priority: 50, tags: [], documentId: bk.documentId,
      });
      const k0 = mkCard(0);
      const ex = db.createExtract({ itemId: bk.id, documentId: bk.documentId, text: "负反馈调节使系统回归稳定。", priority: 50 });
      const je = db.createJournalEntry({ contentMarkdown: "F37 第一条日记。" });

      // 每个被测函数：setup（可选，取新对象）→ mutate(db) → probe（读回一个可比较的事实）
      const CASES = [
        { name: "createCard", setup: () => ({}), mutate: (d, c) => d.createCard({ noteText: "F37-new", cardType: "qa", frontMarkdown: "f", backMarkdown: "b", priority: 50, tags: [], documentId: bk.documentId }), probe: (d) => d.listAllCards().length },
        { name: "updateCard", setup: () => ({}), mutate: (d) => { const c = d.getCard(k0.id); d.updateCard({ ...c, backMarkdown: "改了答案" }); }, probe: (d) => d.getCard(k0.id).backMarkdown },
        { name: "deleteCard", setup: () => ({ id: mkCard(9).id }), mutate: (d, c) => d.deleteCard(c.id), probe: (d, c) => !!d.getCard(c.id) },
        { name: "saveReview", setup: () => ({}), mutate: (d) => { const f = d.getCard(k0.id).fsrs; d.saveReview(k0.id, { state: "review", due: f.due + 5 * DAY, lapses: 0, stability: (f.stability || 1) * 2, difficulty: f.difficulty || 5, reps: (f.reps || 0) + 1, learningSteps: 0, lastReview: f.due }, "Good", 3000, f); }, probe: (d) => d.listAllReviewLogs().length },
        { name: "undoLastReview", setup: () => ({}), mutate: (d) => { const f = d.getCard(k0.id).fsrs; d.saveReview(k0.id, { ...f, state: "review", due: f.due + 3 * DAY, reps: (f.reps || 0) + 1, lastReview: f.due }, "Good", 3000, f); d.undoLastReview(); }, probe: (d) => d.listAllReviewLogs().length },
        { name: "saveSkip", setup: () => ({}), mutate: (d) => d.saveSkip(k0.id), probe: (d) => (d.computeTodayQueue().deferred || []).length },
        { name: "addReadingEvent", setup: () => ({}), mutate: (d) => d.addReadingEvent(bk.id, 120), probe: (d) => d.getStatsOverview().kpi.reviewedToday ?? 0 },
        { name: "updateProgress", setup: () => ({}), mutate: (d) => d.updateProgress(bk.id, { ratio: 0.5, lastText: "F37 进度", updatedAt: Date.now() }), probe: (d) => (d.getItemIdByDocumentId(bk.documentId) ? 1 : 0) },
        { name: "postponeExtract", setup: () => ({}), mutate: (d) => d.postponeExtract(ex.id), probe: (d) => d.listDueExtracts().length },
        { name: "setCardSuspended", setup: () => ({}), mutate: (d) => d.setCardSuspended(k0.id, true, "f37"), probe: (d) => (d.getCard(k0.id).leech?.suspended ? 1 : 0) },
        { name: "addCardIssue", setup: () => ({}), mutate: (d) => d.addCardIssue({ cardId: k0.id, ruleId: "F37", severity: "warn", message: "m", source: "test" }), probe: (d) => d.listCardIssues().length },
        { name: "createJournalEntry", setup: () => ({}), mutate: (d) => d.createJournalEntry({ contentMarkdown: "F37 新日记。" }), probe: (d) => d.listJournalEntries({ limit: 500 }).total },
        { name: "deleteJournalEntry", setup: () => ({}), mutate: (d) => d.deleteJournalEntry(je.id), probe: (d) => d.listJournalEntries({ limit: 500 }).total },
        { name: "createMemoryRun", setup: () => ({}), mutate: (d) => d.createMemoryRun({ kind: "ingest", status: "running", summary: "f37" }), probe: (d) => d.listMemoryRuns(10).length },
        { name: "createAIGenBatch", setup: () => ({}), mutate: (d) => d.createAIGenBatch({ scope: "card-main", sourceText: "s", context: {}, promptTemplateId: null, result: { cards: [] } }), probe: () => "n/a（无读出口，见 A-10）" },
        { name: "createFromPaste", setup: () => ({}), mutate: (d) => d.createFromPaste("F37 新书", ["# 第一章", "", "新正文"].join(NL)), probe: (d) => d.listItems().length },
      ];

      // D137（v48.92）注入钩子切换：persist() 自「导出+tmp/rename」重定义为 wal_checkpoint(TRUNCATE)，
      // 旧 fs.renameSync mock 不再落在 persist 路径上。改用 WAL 下真实故障模式＝第二连接持读事务
      // → checkpoint(TRUNCATE) busy=1（与 tests/persist.test.cjs P2/P3 同法）。C-17 后 persist()
      // 不再抛错——注入命中改为捕获 persist 的「[db] checkpoint 失败」日志（只记日志、延后合并）。
      const openBlocker = () => {
        const Database = require("better-sqlite3");
        const bl = new Database(dbFile);
        bl.exec("BEGIN");
        bl.prepare("SELECT COUNT(*) AS n FROM cards").get(); // deferred 读事务真正持有读锁
        return bl;
      };
      const rows = [];
      for (const c of CASES) {
        const ctx = c.setup ? c.setup() : {};
        const before = (() => { try { return JSON.stringify(c.probe(db, ctx)); } catch { return "probe-err"; } })();
        const tmpPath = dbFile + ".tmp";
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* 清干净再测 */ }

        let threw = null;
        let injectHit = false;
        let ckLog = null;
        const origErr = console.error;
        console.error = (...a) => { const s = String(a && a[0] || ""); if (s.includes("[db] checkpoint")) ckLog = s; origErr(...a); };
        const blocker = openBlocker();
        try { c.mutate(db, ctx); } catch (e) { threw = e.message; }
        finally { console.error = origErr; try { blocker.close(); } catch { /* 尽力 */ } }
        if (ckLog) injectHit = true;

        const afterFail = (() => { try { return JSON.stringify(c.probe(db, ctx)); } catch { return "probe-err"; } })();
        const tmpLeft = fs.existsSync(tmpPath);
        const tmpBytes = tmpLeft ? fs.statSync(tmpPath).size : 0;
        // 补一次成功落盘，看磁盘是否收敛到内存（读锁已释放，严格 checkpoint 应成功）
        let converged = null;
        try { db.persistNow(); converged = true; } catch (e) { converged = "persistNow 仍失败: " + e.message; }
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }

        rows.push({ name: c.name, injectHit, threw, ckLogged: !!ckLog, memoryChanged: before !== afterFail, before, afterFail, tmpLeft, tmpBytes, converged });
        console.log(`  ${c.name.padEnd(20)} 注入=${injectHit ? "y" : "n"} 抛错=${threw ? "y" : "n"} 内存已改=${before !== afterFail ? "y" : "n"} tmp残留=${tmpLeft ? `y(${tmpBytes}B)` : "n"} 补盘收敛=${converged === true ? "y" : "n"}`);
      }

      const injected = rows.filter((r) => r.injectHit);
      flow.check("F37-0 注入确实命中了 persist() 的落盘那一步（否则整层是空跑）",
        injected.length >= CASES.length - 3, `${CASES.length - 3}+`, injected.length);

      // M1（C-17 新语义）：checkpoint busy 时业务写入必须成功返回——抛错＝把已提交的写入
      // 误报为失败（IPC reject → UI 显示保存失败 → 用户重试产生重复数据）
      const misreported = injected.filter((r) => r.threw);
      flow.check("F37-1 checkpoint busy 时业务写入必须成功返回（不误报失败，失败只记日志）", misreported.length === 0, "0 个抛错", JSON.stringify(misreported.map((x) => `${x.name}:${String(x.threw).slice(0, 60)}`)));
      if (misreported.length) flow.record("F37-1 checkpoint busy 时仍抛错的函数", misreported.map((x) => x.name).join(","));

      // M2 提交真实可见：写入返回成功的同时，数据必须真的已 COMMIT（同连接读回）。
      // probe 无法观察变更的用例（undo 净零 / saveSkip·postpone 的探测面不含本用例 / 无读出口）
      // 不算失败，单独记录（实测 16 例中 9 例可观察，阈值取 8 留 1 例裕量）。
      const dirtyMem = injected.filter((r) => r.memoryChanged);
      const blind = injected.filter((r) => !r.memoryChanged).map((x) => x.name);
      flow.record("F37-2 busy 窗口内提交已可见（memoryChanged）的用例", `${dirtyMem.length}/${injected.length}；probe 盲区：${blind.join(",") || "无"}`);
      flow.check("F37-2 写入不得是假成功（提交在 busy 窗口内同连接可读）", dirtyMem.length >= 8, "≥8", dirtyMem.length);

      // M3 tmp 残留
      const leaked = injected.filter((r) => r.tmpLeft);
      flow.check("F37-3 persist 失败后 library.db.tmp 不得残留（db.js:683-692 的 finally 只关 fd）",
        leaked.length === 0, "0 个残留", JSON.stringify(leaked.map((x) => `${x.name}:${x.tmpBytes}B`).slice(0, 8)));

      // M4 收敛性
      const notConv = rows.filter((r) => r.converged !== true);
      flow.check("F37-4 补一次 persistNow 后磁盘必须收敛到内存态（§7.1.4）", notConv.length === 0, "全部收敛", JSON.stringify(notConv.map((x) => `${x.name}:${x.converged}`).slice(0, 5)));

      // M5 最严：失败后重启，磁盘态必须自洽（不能出现「一半新一半旧」）
      db.persistNow();
      const db2 = await reopenFlowDb(dir);
      const a = await audit(dbFile);
      const counts = {
        // 必须与 listAllCards() 同口径：它过滤软删（db.js:1408 起），用裸 COUNT(*) 会比出假红
        cards: a.one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0")?.n ?? -1,
        logs: a.one("SELECT COUNT(*) AS n FROM review_logs")?.n ?? -1,
        items: a.one("SELECT COUNT(*) AS n FROM library_items")?.n ?? -1,
        journal: a.one("SELECT COUNT(*) AS n FROM journal_entries")?.n ?? -1,
      };
      a.close();
      const memCards = db2.listAllCards().length;
      const memLogs = db2.listAllReviewLogs().length;
      flow.eq("F37-5 重启后 cards 行数与内存一致（无半写）", memCards, counts.cards);
      flow.eq("F37-5b 重启后 review_logs 行数与内存一致（无半写）", memLogs, counts.logs);
      flow.record("F37-5c 磁盘事实计数", JSON.stringify(counts));

      // 附带：八字段往返在故障注入后仍须完整（§4.4.5）
      const FIELDS8 = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
      const f = db2.getCard(k0.id).fsrs || {};
      const missing = FIELDS8.filter((x) => f[x] === undefined);
      flow.check("F37-6 故障注入后 fsrs_json 八字段仍完整（§4.4.5）", missing.length === 0, "0 缺", JSON.stringify(missing));
    });

    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F37 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
