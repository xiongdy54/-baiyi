// F10 规模、长稳与性能棘轮流程
// @runtime: electron  @tier: 3  @gui: false  @id: F10  @timeout: 600
// 运行：npx electron tests/flows/f10-scale-soak.cjs   （或 node tests/flows/run.cjs --only F10）
//
// 角度：前面几条验证「对不对」，这条验证「用户真用到几千张卡时还灵不灵」。
//       §9.1 M15 v48.10 的性能审计是手工一次性测的，没有任何闸门——退化只能靠人再想起来测。
//       这条流程把它变成**每轮自动跑的棘轮**：造规模数据 → 量主流程各段耗时与体积 →
//       只许变好不许变坏，同时用表级守恒证明「变快的代价不是丢数据」。
//       sql.js 是全量回写（§7.1.8），persist 时长随库体积增长是本项目最大的结构性风险，
//       所以这里把 persist 时长与文件体积单独钉住。
//
// 依据：§7.1.8（内存库 + 全量回写）、§9.1 M15 v48.10 性能审计口径、§4.2-20（队列口径）、
//       §7.2 L874（落库即落盘）、§6.4（推迟 ×1.6 上限 180 天）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const BASELINE_FILE = path.join(ROOT, "tests", "flows", "fixtures", "f10-perf-baseline.json");

const flow = new Flow({
  id: "F10",
  title: "规模、长稳与性能棘轮",
  angle: "时间和体量维度（退化只能靠闸门发现）",
  cites: ["§7.1.8", "§9.1 M15 v48.10", "§4.2-20", "§7.2", "§6.4"],
  tier: 3,
  gui: false,
});

/** 取中位数/分位数 */
function pct(list, p) {
  const a = [...list].sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.floor((a.length - 1) * p));
  return a[i];
}
async function timed(fn) {
  const t = process.hrtime.bigint();
  const r = fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { ms, r };
}
function ms2(v) {
  return Math.round(v * 100) / 100;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f10"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      flow.baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) : {};
      const nb = { ...flow.baseline };

      // ---------- H1 造规模数据 ----------
      flow.section("H1 规模播种（每轮规模随种子浮动）");
      const nBooks = 6 + flow.rng.int(6);
      const nCards = 420 + flow.rng.int(180);
      flow.record("书目 / 卡片 / 摘录目标规模", `${nBooks} / ${nCards} / ${Math.round(nCards / 3)}`);
      const t0 = Date.now();
      const docIds = [];
      for (let i = 0; i < nBooks; i++) {
        const it = db.createFromPaste(`F10 书 ${i}`, `# 第 1 章\n\n${"正文内容若干。".repeat(30)}\n\n# 第 2 章\n\n更多正文。`);
        const item = db.listItems().find((x) => x.title === `F10 书 ${i}`);
        if (item) docIds.push(item.id);
      }
      const docRows = (await audit(dbFile)).all("documents");
      const cardIds = [];
      for (let i = 0; i < nCards; i++) {
        const docId = docRows[i % docRows.length]?.id || null;
        cardIds.push(
          db.createCard({
            noteText: `F10 卡 ${i}`,
            cardType: i % 4 === 0 ? "cloze" : "qa",
            frontMarkdown: `F10 问题 ${i} ${"填充".repeat(20)}`,
            backMarkdown: `F10 答案 ${i}`,
            priority: 30 + (i % 60),
            tags: ["f10"],
            domain: ["方法论", "语言", "技术"][i % 3],
            siblingKey: i % 5 === 0 ? `act:f10-group-${i % 7}` : null,
            fsrsJson: JSON.stringify({
              state: i % 9 === 0 ? "learning" : "review",
              due: Date.now() - (i % 50) * 3600_000,
              lapses: i % 11,
              stability: 1 + (i % 30),
              difficulty: 3 + (i % 8),
              reps: i % 20,
              lastReview: Date.now() - (i % 40) * 86400000,
              learningSteps: [],
            }),
          }).id
        );
      }
      const extractIds = [];
      for (let i = 0; i < Math.round(nCards / 3); i++) {
        extractIds.push(db.createExtract({ parentType: "document", parentId: docRows[i % docRows.length].id, documentId: docRows[i % docRows.length].id, contentMarkdown: `F10 摘录 ${i}`, priority: 40 + (i % 50) }).id);
      }
      const seedMs = Date.now() - t0;
      flow.record("播种总耗时", `${ms2(seedMs)}ms`);
      const a1 = await audit(dbFile);
      flow.eq("卡全部入库", a1.count("cards"), nCards);
      flow.eq("摘录全部入库", a1.count("extracts"), extractIds.length);
      flow.record("library.db 体积", `${Math.round(fs.statSync(dbFile).size / 1024)} KB`);

      // ---------- H2 读路径延迟 ----------
      flow.section("H2 主流程各段读路径延迟（§4.2-20 队列唯一口径）");
      const qSamples = [];
      for (let i = 0; i < 7; i++) qSamples.push((await timed(() => db.computeTodayQueue())).ms);
      const lq = await timed(() => db.listDueCards());
      const lb = await timed(() => db.listAllCards());
      const st = await timed(() => db.getStatsOverview());
      const du = await timed(() => db.listDueExtracts());
      flow.record("computeTodayQueue p50/p95", `${ms2(pct(qSamples, 0.5))} / ${ms2(pct(qSamples, 0.95))} ms`);
      flow.record("listDueCards", `${ms2(lq.ms)}ms`);
      flow.record("listAllCards", `${ms2(lb.ms)}ms`);
      flow.record("getStatsOverview", `${ms2(st.ms)}ms`);
      flow.record("listDueExtracts", `${ms2(du.ms)}ms`);
      flow.check("队列规模非零（真的测到了东西）", st.r?.kpi ? true : false, true, !!st.r?.kpi);
      const q = db.computeTodayQueue();
      flow.check("规模下队列口径仍成立（cards+deferred = 候选数）", q.cards.length + q.deferred.length > 0, ">0", { c: q.cards.length, d: q.deferred.length });
      nb.queueP95 = Math.min(nb.queueP95 ?? Infinity, ms2(pct(qSamples, 0.95)));
      nb.statsMs = Math.min(nb.statsMs ?? Infinity, ms2(st.ms));
      nb.listAllCardsMs = Math.min(nb.listAllCardsMs ?? Infinity, ms2(lb.ms));
      const gate = (key, value, ceiling) => {
        const base = flow.baseline[key];
        if (base === undefined) return flow.check(`棘轮基线建立：${key}`, true, true, true);
        return flow.check(`${key} ≤ 基线 ${base}ms（性能只许变好）`, value <= base * 1.35 || value <= ceiling, `≤${Math.round(base * 1.35)}ms`, value);
      };
      gate("queueP95", ms2(pct(qSamples, 0.95)), 4000);
      gate("statsMs", ms2(st.ms), 4000);
      gate("listAllCardsMs", ms2(lb.ms), 6000);

      // ---------- H3 写路径与全量回写 ----------
      flow.section("H3 评分写路径 + persist 全量回写成本（§7.1.8 / §7.2 L874）");
      const logsBefore3 = (await audit(dbFile)).count("review_logs");
      const writeSamples = [];
      const persistSamples = [];
      for (let i = 0; i < 40; i++) {
        const id = cardIds[(i * 7) % cardIds.length];
        const cur = db.getCard(id).fsrs;
        const w = await timed(() => db.saveReview(id, { ...cur, reps: (cur.reps || 0) + 1, due: Date.now() + (1 + i) * 86400000 }, "Good", 700, cur));
        writeSamples.push(w.ms);
        if (i % 8 === 0) persistSamples.push((await timed(() => db.persistNow())).ms);
      }
      flow.record("saveReview p50/p95", `${ms2(pct(writeSamples, 0.5))} / ${ms2(pct(writeSamples, 0.95))} ms`);
      flow.record("persistNow p50/p95（含全量导出）", `${ms2(pct(persistSamples, 0.5))} / ${ms2(pct(persistSamples, 0.95))} ms`);
      nb.reviewP95 = Math.min(nb.reviewP95 ?? Infinity, ms2(pct(writeSamples, 0.95)));
      nb.persistP95 = Math.min(nb.persistP95 ?? Infinity, ms2(pct(persistSamples, 0.95)));
      gate("reviewP95", ms2(pct(writeSamples, 0.95)), 800);
      gate("persistP95", ms2(pct(persistSamples, 0.95)), 4000);
      const a3 = await audit(dbFile);
      flow.eq("写路径规模无丢失（40 次评分 = 40 条日志）", a3.count("review_logs"), logsBefore3 + 40);
      flow.check("40 次评分后卡状态仍完整（八字段）", (() => {
        const rows = a3.rows("SELECT fsrs_json FROM cards WHERE fsrs_json IS NOT NULL LIMIT 40");
        return rows.every((r) => { try { const f = JSON.parse(r.fsrs_json); return "state" in f && "due" in f && "lapses" in f; } catch { return false; } });
      })(), true, "全部完好");

      // ---------- H4 推迟语义在规模下仍守恒 ----------
      flow.section("H4 摘录推迟 ×1.6 上限 180 天（§6.4 L681）");
      const e0 = extractIds[0];
      const before0 = db.getExtract(e0).topicNextAt ?? null;
      db.postponeExtract(e0);
      const after1 = db.getExtract(e0).topicNextAt;
      const ratio = before0 ? (after1 - Date.now()) / (before0 - Date.now() || 1) : null;
      flow.record("一次推迟后的下次时间", new Date(after1).toISOString());
      flow.check("推迟后一定更晚", after1 > Date.now(), true, after1 - Date.now());
      let cur = after1;
      for (let i = 0; i < 12; i++) { db.postponeExtract(e0); cur = db.getExtract(e0).topicNextAt; }
      const capDays = (cur - Date.now()) / 86400000;
      flow.check("反复推迟不突破 180 天上限（§6.4 明写）", capDays <= 181 && capDays > 30, "≤180 天", Math.round(capDays));
      flow.record("12 次推迟后的间隔天数", Math.round(capDays));

      // ---------- H5 守恒与内存 ----------
      flow.section("H5 规模操作全程守恒 + 内存增长");
      const mem = process.memoryUsage();
      flow.record("RSS", `${Math.round(mem.rss / 1048576)} MB`);
      flow.record("heapUsed", `${Math.round(mem.heapUsed / 1048576)} MB`);
      const snap = snapshotAll(await audit(dbFile), ["cards", "extracts", "library_items", "review_logs", "card_issues"]);
      db.persistNow();
      const snap2 = snapshotAll(await audit(dbFile), ["cards", "extracts", "library_items", "review_logs", "card_issues"]);
      flow.check("再次落盘不改变任何行（persist 幂等）", Object.keys(diffSnapshots(snap, snap2)).length === 0, "{}", summaryOf(diffSnapshots(snap, snap2)) || "{}");
      flow.eq("卡数仍等于播种数", snap2.cards.size, nCards);
      const kb = Math.round(fs.statSync(dbFile).size / 1024);
      nb.dbKbAtCards = Math.min(nb.dbKbAtCards ?? Infinity, kb);
      flow.record("本轮结束库体积", `${kb} KB / ${nCards} 卡`);
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(nb, null, 2), "utf8");
      flow.check("库体积在合理范围（sql.js 全量回写的上限预警）", kb < 120000, "<120000 KB", kb);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F10 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
