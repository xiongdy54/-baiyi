// F29 全局序不变量（§4.4.9 的 review_seq：审计、撤销、成长判定都靠它，序一错全错）
// @runtime: electron  @tier: 2  @gui: false  @id: F29  @timeout: 240
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f29-global-sequence.cjs
//
// 角度：`db.js:1404` 自述一条硬不变量——「v23 起排序不变量 = review_seq（表内唯一、插入序单调；
//       **禁按 id/reviewed_at 排序**）」。它存在的理由正是墙钟不可信：NTP 校时、改时区、
//       恢复旧备份、双开进程，都会让 reviewed_at 不再单调；而 §4.4.10 的参数审计要按日志顺序
//       分段重放、§6.6.6 的「首次达成」也由这个序重算。
//       这条就干一件事：把「谁在按墙钟排日志」抓出来，并用一个时钟倒退的夹具
//       证明这不是纯洁癖——顺序错了，撤销面板撤销的就不是列表里最后那条。
//
// 依据：§4.4.9（排序不变量）、§4.4.10（审计按每条日志的 config 分段重放）、§4.2-20（队列同源）、
//       §6.6.6（首次达成由 review_seq 重算）、§7.2（数据完整性）、§7.1.4（重启不丢序）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F29",
  title: "全局序不变量",
  angle: "review_seq 唯一单调 + 任何按墙钟排日志的读口都抓出来（时钟倒退时的真实后果）",
  cites: ["§4.4.9", "§4.4.10", "§4.2-20", "§6.6.6", "§7.2", "§7.1.4"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;
const fsrsState = (over) => {
  const now = Date.now();
  return JSON.stringify({ state: "review", due: now, lapses: 0, stability: 6, difficulty: 5, reps: 3, lastReview: now - DAY, learningSteps: [], ...over });
};
const J = (v) => JSON.stringify(v);

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f29"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const mk = (tag) => db.createCard({ noteText: `F29 ${tag}`, cardType: "qa", frontMarkdown: `问 ${tag}`, backMarkdown: `答 ${tag}`, priority: 50, tags: ["f29"], fsrsJson: fsrsState({}) }).id;
      const rate = (id, rating) => { const c = db.getCard(id); return db.saveReview(id, { ...c.fsrs, due: Date.now() + DAY, reps: c.fsrs.reps + 1 }, rating, 700, c.fsrs); };

      // ---------- T1 序号本身的三条性质 ----------
      flow.section("T1 review_seq 必须唯一、单调、撤销后不留洞（表内 UNIQUE + MAX+1）");
      const ids = [mk("甲"), mk("乙"), mk("丙"), mk("丁")];
      for (const i of ids) rate(i, "Good");
      let rows = (await audit(dbFile)).all("review_logs").sort((a, b) => a.review_seq - b.review_seq);
      flow.check("每条日志都有序号且无重复", rows.every((r) => Number.isFinite(r.review_seq)) && new Set(rows.map((r) => r.review_seq)).size === rows.length, "唯一", rows.map((r) => r.review_seq));
      flow.check("序号严格连续（MAX+1 不留洞）", rows.map((r) => r.review_seq).join(",") === "1,2,3,4", "1,2,3,4", rows.map((r) => r.review_seq).join(","));
      const cardA = db.getCard(ids[0]);
      db.undoLastReview();
      rate(ids[1], "Easy");
      rows = (await audit(dbFile)).all("review_logs").sort((a, b) => a.review_seq - b.review_seq);
      flow.record("撤销一条后再评的序号序列", rows.map((r) => r.review_seq).join(","));
      flow.check("撤销留下的洞不能被复用（否则旧审计会张冠李戴）", !rows.some((r, i) => rows.slice(0, i).some((x) => x.review_seq === r.review_seq)) && rows.length === 4, "四条且无重号", rows.map((r) => r.review_seq).join(","));
      void cardA;

      // ---------- T2 静态不变量：谁在按墙钟排日志 ----------
      flow.section("T2 全仓对 review_logs 的排序只允许按 review_seq（db.js:1404 自述的禁令）");
      const offenders = [];
      const files = fs.readdirSync(path.join(ROOT, "electron")).filter((f) => f.endsWith(".js")).concat(fs.readdirSync(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => path.join("src", f)));
      for (const rel of files) {
        const p = rel.startsWith("src") ? path.join(ROOT, rel) : path.join(ROOT, "electron", rel);
        if (!fs.existsSync(p)) continue;
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          if (!/review_logs|FROM review_logs|rl\b/i.test(line)) return;
          const m = line.match(/ORDER BY\s+([^\n]*)/i);
          if (!m) return;
          if (/DISTINCT reviewed_at|dayStartMs/.test(line)) return; // 取「哪几天有过复习」是日期集合，不是全局序，不在本禁令内
          if (/reviewed_at|review_logs\.id|\brl\.id\b|\bORDER BY\s+\d/i.test(m[1]) && !/review_seq/.test(m[1])) offenders.push(`${rel}:${i + 1} → ${m[1].trim().slice(0, 44)}`);
        });
      }
      flow.record("扫过的文件数", String(files.length));
      flow.check("读日志清单的 ORDER BY 必须是 review_seq，按墙钟排即违反 §4.4.9", offenders.length === 0, "只按 seq", offenders);

      // ---------- T3 时钟倒退下的行为证据 ----------
      flow.section("T3 模拟校时/时区跳变：墙钟倒退后，日志清单的顺序必须仍是插入序（§4.4.9 的存在理由）");
      const realNow = Date.now;
      const id1 = mk("时钟倒退前");
      const id2 = mk("时钟倒退后");
      try {
        const T = realNow();
        Date.now = () => T + 9 * 60000;
        rate(id1, "Good");
        Date.now = () => T + 3 * 60000;
        rate(id2, "Again");
      } finally {
        Date.now = realNow;
      }
      const seqOrder = (await audit(dbFile)).all("review_logs").sort((a, b) => a.review_seq - b.review_seq).map((r) => r.card_id);
      const listed = db.listAllReviewLogs().map((r) => r.cardId);
      flow.record("插入序（seq）", seqOrder.slice(-2).join("→"));
      flow.record("listAllReviewLogs 给的序", listed.slice(-2).join("→"));
      flow.check("墙钟倒退时清单顺序仍须等于插入序（否则审计分段与「首次达成」判定都会错）", J(listed) === J(seqOrder), "两序一致", { 清单: listed.map((x) => seqOrder.indexOf(x)), 插入序: seqOrder.map((x, i) => i) });

      // ---------- T4 撤销面板撤销的必须是用户看到的最后一条 ----------
      flow.section("T4 撤销入口与日志清单对「最后一条」必须同认一条（§4.4.9 / §6.2 复习页）");
      const lastFromList = db.listAllReviewLogs()[db.listAllReviewLogs().length - 1];
      const undoable = db.getLastUndoableReview();
      flow.record("撤销面板指向", undoable ? `${undoable.cardId} ${undoable.rating} seq=${undoable.reviewSeq}` : "（无）");
      flow.record("清单末条指向", lastFromList ? `${lastFromList.cardId} ${lastFromList.rating} seq=${lastFromList.reviewSeq}` : "（空）");
      // 判据本身修过一处：原式比的是 undoable.logId ↔ lastFromList.logId，但 listAllReviewLogs
      // 根本不 SELECT 日志 id（只有 cardId/rating/reviewedAt/fsrsConfigId/reviewSeq），右侧会一路
      // 退化成 cardId → 即使两边真是同一条也恒假。改成本层想验的「同一条」：
      // review_seq（§4.4.9 表内唯一）相等 且 cardId 相等，判据只收紧不放宽。
      const sameRow = Boolean(
        undoable && lastFromList &&
          Number.isFinite(Number(undoable.reviewSeq)) &&
          String(undoable.reviewSeq) === String(lastFromList.reviewSeq) &&
          String(undoable.cardId) === String(lastFromList.cardId)
      );
      flow.check("面板要撤的那条必须就是清单里最后一条（不同则撤销的是用户没看的那张卡）", sameRow, "同一条", { 面板: undoable && `${undoable.cardId} seq=${undoable.reviewSeq}`, 清单: lastFromList && `${lastFromList.cardId} seq=${lastFromList.reviewSeq}` });

      // ---------- T5 迁移与重启对序号的处理 ----------
      flow.section("T5 存量回填与重启后继续递增（§7.1.4 重启不丢序、迁移幂等）");
      db.persistNow();
      const before5 = (await audit(dbFile)).all("review_logs").map((r) => r.review_seq).sort((a, b) => a - b).join(",");
      delete require.cache[path.join(ROOT, "electron", "db.js")];
      const db2 = require(path.join(ROOT, "electron", "db.js"));
      await db2.initDb();
      const after5 = (await audit(dbFile)).all("review_logs").map((r) => r.review_seq).sort((a, b) => a - b).join(",");
      flow.eq("重开库后序号一字不变（迁移回填幂等）", after5, before5);
      const c2 = db2.getCard(id1);
      db2.saveReview(id1, { ...c2.fsrs, due: Date.now() + DAY, reps: c2.fsrs.reps + 1 }, "Good", 700, c2.fsrs);
      db2.persistNow();
      const maxBefore = Math.max(...after5.split(",").map(Number));
      const next5 = (await audit(dbFile)).all("review_logs").map((r) => r.review_seq).sort((a, b) => a - b).pop();
      flow.check("重启后新日志的序号接在最大值之后（不撞 UNIQUE 索引）", Number(next5) > maxBefore, `>${maxBefore}`, next5);

      // ---------- T6 审计分段的顺序依赖 ----------
      flow.section("T6 参数审计按每条日志的 config 分段重放，段序由全局序决定（§4.4.10）");
      const cfgs = (await audit(dbFile)).all("review_logs").map((r) => r.fsrs_config_id || "NULL");
      flow.record("日志的 config 序列", cfgs.join(","));
      const segsFromSeq = (await audit(dbFile)).all("review_logs").sort((a, b) => a.review_seq - b.review_seq).map((r) => r.fsrs_config_id || "NULL")
        .filter((c, i, a) => i === 0 || a[i - 1] !== c).length;
      const segsFromList = db.listAllReviewLogs().map((r) => r.fsrsConfigId || "NULL")
        .filter((c, i, a) => i === 0 || a[i - 1] !== c).length;
      flow.record("分段数：按 seq vs 按清单", `${segsFromSeq} 段 vs ${segsFromList} 段`);
      flow.check("两种顺序算出的审计分段数一致（本夹具只有一种 config，故这条比 T3 弱；T3 才是决定性的）", segsFromList === segsFromSeq, "分段数一致", { seq: segsFromSeq, 清单: segsFromList });
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F29 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
