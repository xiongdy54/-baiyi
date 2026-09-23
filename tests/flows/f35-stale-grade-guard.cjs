// F35 评分写入口的「已提交但报失败」与陈旧写防护（跨模块不变量 · 写入口契约层）
// @runtime: electron  @tier: 1  @gui: false  @id: F35  @timeout: 240
// 运行：npx electron tests/flows/f35-stale-grade-guard.cjs   （或 node tests/flows/run.cjs --only F35）
//
// 角度：§4.4.9 把「成功边界」定义为 COMMIT + persist + IPC 三者都成。既有 F03 验的是
//       「一次评分的表级事实守恒」，F34 验的是「撤销能否逐字段复原」——两者都建立在
//       **评分只发生一次** 这个前提上。本层专攻这个前提本身：
//       persist() 是在 db.run("COMMIT") **之后**才被调用的裸 fs 写（electron/db.js:682-693、:1465-1470），
//       磁盘满 / 杀软占用 / 只读挂载都会让它抛；此时行已经进了内存库并 COMMIT，
//       但 IPC 是 reject 的，于是渲染层走 setSaveError(true) 且**不推进到下一张卡**
//       （src/components/ReviewView.tsx:149-152），finally 又把 actionBusyRef 复位（:183-185）。
//       用户点「重试保存」只调 persistNow() + 清标志位（:427-435），既不推进也不重读卡态
//       → 同一张已评分的卡再次可评。
//       而 saveReview 的签名里**就带着 fsrsBefore**（撤销用的全字段快照），却从不拿它
//       与 card.fsrs 比对（:1432-1436 只读了 leech 与 fsrsConfigId）——陈旧写防护的输入齐备、
//       判断缺失。本层把这条链逐环钉成实测。
//
// 依据：§4.4.9（成功边界 / 撤销不变量集）、§4.4.5（fsrs_json 八字段往返）、
//       §7.1.4（重启不丢数据）、§7.2（落库即落盘）、§4.4.4（连续模式评分后不得重复出现）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { bootFlowDb, reopenFlowDb, audit, quit } = require("./lib/dbenv.cjs");

const DAY = 86_400_000;
const FIELDS8 = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];

const flow = new Flow({
  id: "F35",
  title: "评分写入口的已提交-报失败与陈旧写防护",
  angle: "persist 在 COMMIT 之后抛错时，同一次呈现会不会被计入两次",
  cites: ["§4.4.9", "§4.4.5", "§4.4.4", "§7.1.4", "§7.2"],
  tier: 1,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const { db, dir, dbFile } = await bootFlowDb("f35");
    const s = await runFlow(flow, async () => {
      const NL = String.fromCharCode(10);
      const bk = db.createFromPaste("F35 材料", ["# 第一章", "", "评分写入口审计用正文。"].join(NL));
      const mk = (i) => db.createCard({
        noteText: `F35-K${i}`, cardType: "qa", frontMarkdown: `问 ${i}`, backMarkdown: `答 ${i}`,
        priority: 50, tags: [], documentId: bk.documentId,
      });
      const logCount = (id) => db.listAllReviewLogs().filter((r) => r.cardId === id).length;
      const nextGood = (f, mult = 1.9) => ({
        state: "review", due: f.due + 20 * DAY, lapses: f.lapses || 0,
        stability: (f.stability || 1) * mult, difficulty: f.difficulty || 5,
        reps: (f.reps || 0) + 1, learningSteps: 0, lastReview: f.due,
      });

      // ── M1 前提取证：persist 抛错时，事务其实已经 COMMIT ──────────────────
      const k1 = mk(1);
      const f1 = db.getCard(k1.id).fsrs;
      const origRename = fs.renameSync;
      let threw = null;
      fs.renameSync = () => { throw new Error("ENOSPC (simulated by F35)"); };
      try {
        db.saveReview(k1.id, nextGood(f1), "Good", 3000, f1);
      } catch (e) { threw = e.message; } finally {
        fs.renameSync = origRename;
      }
      flow.check("M1a persist() 抛错会一路传出 saveReview（IPC 因此 reject）", threw !== null, "抛错", String(threw));
      const committed = logCount(k1.id);
      const fsrsAdvanced = JSON.stringify(db.getCard(k1.id).fsrs) !== JSON.stringify(f1);
      flow.check(
        "M1b persist 失败时评分**已经 COMMIT 进库**（这正是 §4.4.9 成功边界与 UI 提示的裂缝）",
        committed === 1 && fsrsAdvanced,
        "日志 1 条 + 卡态已推进", `日志 ${committed} 条 · 卡态推进=${fsrsAdvanced}`
      );
      flow.record("M1 UI 横幅文案", "「刚才的操作尚未写入磁盘，已停留在本卡」—— 实际：操作已 COMMIT，只是没落盘");

      // ── M2 渲染层据此停在原卡 → 同一张卡再次可评 ──────────────────────────
      // 「重试保存」只做 persistNow() + setSaveError(false)，不推进卡片（ReviewView.tsx:427-435）
      let retryErr = null;
      try { db.persistNow(); } catch (e) { retryErr = e.message; }
      flow.check("M2a 重试保存本身成功", retryErr === null, "成功", String(retryErr));
      const staleBefore = f1;                       // 渲染层手里仍握着**评分前**的快照
      const secondState = nextGood(staleBefore, 1.9);
      let dupAccepted = true;
      try { db.saveReview(k1.id, secondState, "Good", 3000, staleBefore); }
      catch (e) { dupAccepted = false; flow.record("M2b 第二次评分被拒原因", e.message.slice(0, 120)); }
      flow.check(
        "M2b 携带**陈旧 fsrsBefore** 的重复评分必须被写入口拒绝（§4.4.9 成功边界的唯一兜底）",
        dupAccepted === false,
        "拒绝", dupAccepted ? "接受：同一次呈现被计了两次" : "拒绝"
      );
      const logs2 = logCount(k1.id);
      flow.check("M2c 一次呈现只允许产生一条 review_logs", logs2 <= 1, "≤1", logs2);
      const reps2 = db.getCard(k1.id).fsrs.reps;
      // 注意 M2d 的实测形态：重复评分**没有**把 reps 顶到 2，而是被旧快照「回卷」成 1
      //（第二次评分的 fsrsState 是拿陈旧 f1 算出来的）。所以真正的守恒破口不是「虚增」，
      // 而是 reps 与 review_logs 行数从此不再相等 —— 统计侧与训练侧各说各话。
      flow.record("M2d reps 实测值", `${reps2}（日志 ${logs2} 条）`);
      flow.check("M2e cards.fsrs.reps 必须与 review_logs 行数一致（§4.4.5 事实守恒）", reps2 === logs2, `${logs2}`, `${reps2}`);

      // ── M3 幽灵日志：撤销只能撤最新一条，前一条成了无法归位的孤儿 ──────────
      const beforeUndo = db.getCard(k1.id).fsrs;
      const u = db.undoLastReview();
      const afterUndo = db.getCard(k1.id).fsrs;
      const orphan = logCount(k1.id);
      flow.record("M3 撤销后残留日志数", orphan);
      flow.check(
        "M3 撤销一次后卡态应回到**最初**（存在重复日志时只能回到中间态 = 事实链断裂）",
        JSON.stringify(afterUndo) === JSON.stringify(f1),
        "回到 f1", `差异字段 ${JSON.stringify(FIELDS8.filter((k) => String(afterUndo[k]) !== String(f1[k])).map((k) => [k, f1[k], afterUndo[k]]))}`
      );
      flow.check("M3b 撤销成功执行", u?.ok === true, "ok:true", JSON.stringify(u).slice(0, 80));
      void beforeUndo;

      // ── M4 正向对照：正常单次评分 + 撤销，必须逐字段复原 ───────────────────
      const k2 = mk(2);
      const f2 = db.getCard(k2.id).fsrs;
      db.saveReview(k2.id, nextGood(f2), "Good", 3000, f2);
      const u2 = db.undoLastReview();
      const r2 = db.getCard(k2.id).fsrs;
      const diff2 = FIELDS8.filter((k) => String(r2[k]) !== String(f2[k]));
      flow.check("M4 对照：单次评分后撤销应八字段全等复原（§4.4.9）", u2?.ok === true && diff2.length === 0, "八字段全等", JSON.stringify(diff2.map((k) => [k, f2[k], r2[k]])));
      flow.eq("M4b 对照：撤销删掉且只删掉那一条日志", logCount(k2.id), 0);

      // ── M5 陈旧写防护缺失的第二种触发：并发/重放 ───────────────────────────
      // 不依赖 UI：任何拿旧快照的重放（撤销后重放、双窗口、脚本迁移）都会静默改写卡态
      const k3 = mk(3);
      const f3 = db.getCard(k3.id).fsrs;
      db.saveReview(k3.id, nextGood(f3, 2.0), "Good", 3000, f3);
      const mid = db.getCard(k3.id).fsrs;
      // A-7 修复后：写入口**拒绝**陈旧重放。用例相应改为断言「被拒 + 卡态未被覆盖」。
      let replayRejected = false;
      let replayAfter = null;
      try {
        db.saveReview(k3.id, nextGood(f3, 50.0), "Easy", 3000, f3); // 同一个旧 before 再写一次
        replayAfter = db.getCard(k3.id).fsrs;
      } catch (e) {
        replayRejected = true;
      }
      flow.check(
        "M5 写入口应拒绝与当前卡态不符的 fsrsBefore（防重放/防双窗口互相覆盖）",
        replayRejected,
        "被拒",
        replayAfter ? `实际被接受，stability ${mid.stability.toFixed(2)} → ${replayAfter.stability.toFixed(2)}` : "未抛错"
      );
      flow.check(
        "M5b 被拒后卡态不得被旧快照覆盖",
        JSON.stringify(db.getCard(k3.id).fsrs) === JSON.stringify(mid),
        "卡态保持 mid",
        JSON.stringify(db.getCard(k3.id).fsrs)
      );

      // ── M6 落盘一致性：上述所有事实重启后必须原样回来 ──────────────────────
      db.persistNow();
      const db2 = await reopenFlowDb(dir);
      const a = await audit(dbFile);
      const diskLogs = Number(a.one("SELECT COUNT(*) AS n FROM review_logs")?.n || 0);
      a.close();
      const memLogs = db2.listAllReviewLogs().length;
      flow.eq("M6 重启后 review_logs 行数与内存一致（§7.1.4）", memLogs, diskLogs);
    });

    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F35 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
