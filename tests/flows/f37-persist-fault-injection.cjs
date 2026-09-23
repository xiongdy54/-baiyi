// F37 落盘故障注入层（跨模块不变量 · 「写库成功但落盘失败」的系统性普查）
// @runtime: electron  @tier: 1  @gui: false  @id: F37  @timeout: 420
// 运行：npx electron tests/flows/f37-persist-fault-injection.cjs   （或 node tests/flows/run.cjs --only F37）
//
// 为什么要有这一层：F35 证明「saveReview 的 persist 在 COMMIT 之后抛错」会造成一次呈现计入两条日志，
//   F34 证明「未来时间戳」会让调度器抛错砖死复习页，repro-restore-integrity 证明恢复换入有三处毁数据的
//   非原子写法。三件事同一个形状：**主路径全绿，故障路径无人测**。
//   既有 F01–F36 里没有任何一条注入过 IO 故障 —— 这类缺陷它们结构上就拦不住。
//
// 本层不针对某个函数，而是把 db.js 导出的**每一个 mutating 函数**过一遍同一套判据：
//   M1 异常必须传出（不得静默吞 —— 吞了 UI 就以为保存成功）
//   M2 内存态是否已被改写（决定 UI 提示的真实性：「尚未写入磁盘」对不对）
//   M3 失败后 library.db.tmp 是否残留（persist 的 finally 只关 fd，不清 tmp）
//   M4 补一次 persistNow 后，磁盘是否收敛到与内存一致（不留下永久分歧）
//   M5 【最严】失败瞬间内存态不得「只改了一半」—— 那才是真数据损坏
//
// 依据：§7.2 L874（每次落库即落盘，日记防抖为唯一例外）、§7.1.4（重启不丢数据）、
//       §4.4.9（成功边界 = COMMIT + persist + IPC）、§4.4.5（fsrs_json 八字段完整往返）。
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

      const origRename = fs.renameSync;
      const rows = [];
      for (const c of CASES) {
        const ctx = c.setup ? c.setup() : {};
        const before = (() => { try { return JSON.stringify(c.probe(db, ctx)); } catch { return "probe-err"; } })();
        const tmpPath = dbFile + ".tmp";
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* 清干净再测 */ }

        let threw = null;
        let injectHit = false;
        fs.renameSync = (from, to) => {
          if (String(to).endsWith("library.db")) { injectHit = true; throw new Error("ENOSPC (F37 injected)"); }
          return origRename(from, to);
        };
        try { c.mutate(db, ctx); } catch (e) { threw = e.message; }
        finally { fs.renameSync = origRename; }

        const afterFail = (() => { try { return JSON.stringify(c.probe(db, ctx)); } catch { return "probe-err"; } })();
        const tmpLeft = fs.existsSync(tmpPath);
        const tmpBytes = tmpLeft ? fs.statSync(tmpPath).size : 0;
        // 补一次成功落盘，看磁盘是否收敛到内存
        let converged = null;
        try { db.persistNow(); converged = true; } catch (e) { converged = "persistNow 仍失败: " + e.message; }
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }

        rows.push({ name: c.name, injectHit, threw, memoryChanged: before !== afterFail, before, afterFail, tmpLeft, tmpBytes, converged });
        console.log(`  ${c.name.padEnd(20)} 注入=${injectHit ? "y" : "n"} 抛错=${threw ? "y" : "n"} 内存已改=${before !== afterFail ? "y" : "n"} tmp残留=${tmpLeft ? `y(${tmpBytes}B)` : "n"} 补盘收敛=${converged === true ? "y" : "n"}`);
      }

      const injected = rows.filter((r) => r.injectHit);
      flow.check("F37-0 注入确实命中了 persist() 的落盘那一步（否则整层是空跑）",
        injected.length >= CASES.length - 3, `${CASES.length - 3}+`, injected.length);

      // M1 异常必须传出：静默吞掉的函数会让 UI 误报「已保存」
      const swallowed = injected.filter((r) => !r.threw);
      flow.check("F37-1 persist 失败必须传出异常（吞掉=UI 误报已保存）", swallowed.length === 0, "0 个静默", JSON.stringify(swallowed.map((x) => x.name)));
      if (swallowed.length) flow.record("F37-1 静默吞掉 persist 错误的函数", swallowed.map((x) => x.name).join(","));

      // M2 内存态已改但落盘失败 → 这就是 §4.4.9 的「COMMIT 与 persist 不是同一件事」
      const dirtyMem = injected.filter((r) => r.memoryChanged);
      flow.record("F37-2 落盘失败但内存已改写（UI 若提示「尚未写入磁盘」即为误导）", `${dirtyMem.length}/${injected.length}：${dirtyMem.map((x) => x.name).join(",")}`);
      flow.check("F37-2 这类函数必须让调用方有机会知道（返回值或抛错），不得既改内存又静默",
        dirtyMem.every((r) => r.threw), "全部抛错", JSON.stringify(dirtyMem.filter((r) => !r.threw).map((x) => x.name)));

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
