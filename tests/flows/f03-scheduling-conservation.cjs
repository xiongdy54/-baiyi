// F03 复习调度与数据守恒流程（跨模块不变量 · 表级只读盘审计）
// @runtime: electron  @tier: 1  @gui: false  @id: F03  @timeout: 300
// 运行：npx electron tests/flows/f03-scheduling-conservation.cjs   （或 node tests/flows/run.cjs --only F03）
//
// 角度：把用户「连续刷题」这条主旅程里每一步碰到的数据事实，用**表级快照差异 + 只读盘复核**钉住，
//       不看返回值看磁盘。既有 m12 / undo / fsrs 套件按模块纵向验证；本流程横向串联，
//       并额外做「写库函数逐个即时落盘矩阵」——§7.2 明写「每次落库即落盘，日记防抖是唯一例外」，
//       但既有测试只验证过日记那一侧（m8 验防抖），正向一侧从未逐个函数验过。
//
// 依据（AI_DEVELOPMENT_GUIDE.md）：
//   §4.4.5 L95/L164 fsrs_json 八字段完整往返
//   §4.4.9 L105/L172 撤销不变量集（最新 review_seq + before/after 齐 + 卡态等于 after 才可撤）
//   §4.2-20 L145/L330 今日队列唯一口径；延后另列，不静默少卡
//   §4.16 L316–324/L331 延后零写库；learning/挂起豁免；撤销后额度回收
//   §4.16 L326–329 sibling_key 确定性
//   §4.4.10 L106/L173 参数环境不可变 + 指纹去重 + 切指针不回改卡
//   §7.2 L869 软删除留痕；L874 落库即落盘（日记防抖为唯一例外）
//   §7.1.4 L858 启动 → 主流程 → 重启不丢数据
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const AUDIT_TABLES = ["cards", "review_logs", "review_skips", "card_issues", "fsrs_configs", "extracts", "library_items", "documents", "journal_entries", "knowledge_points", "reading_events"];
const FIELD8 = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
const REQ_TABLES = [
  "users", "library_items", "documents", "assets", "extracts", "cards", "card_issues",
  "ai_gen_batches", "prompt_templates", "review_logs", "reading_events", "review_skips",
  "fsrs_configs", "journal_entries", "knowledge_points", "knowledge_relations",
  "knowledge_proposals", "memory_runs", "material_maps", "material_map_runs",
];

const flow = new Flow({
  id: "F03",
  title: "复习调度与数据守恒",
  angle: "主旅程数据事实守恒（表级快照差异 + 只读盘审计）",
  cites: ["§4.4.5", "§4.4.9", "§4.4.10", "§4.2-20", "§4.16", "§7.2", "§7.1.4"],
  tier: 1,
  gui: false,
});

function fsrs(over = {}) {
  const now = Date.now();
  return {
    state: "review",
    due: now - 60000,
    lapses: 1,
    stability: 4.2,
    difficulty: 5.5,
    reps: 6,
    lastReview: now - 86400000,
    learningSteps: [],
    ...over,
  };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f03"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(__dirname, "..", "..", "electron", "db.js"));
      await db.initDb();
      const mk = (label, s, extra = {}) =>
        db.createCard({
          noteText: `FLOWTEST ${label}`,
          cardType: "qa",
          frontMarkdown: `FLOWTEST ${label} 问题`,
          backMarkdown: `FLOWTEST ${label} 答案`,
          priority: 50 + flow.rng.int(40),
          tags: [],
          fsrsJson: JSON.stringify(s),
          ...extra,
        }).id;

      // ---------- S1 冷启动 schema ----------
      flow.section("S1 冷启动 schema（§7.2 L869–870）");
      flow.guard("落盘文件已生成", () => fs.existsSync(dbFile));
      let aud = await audit(dbFile);
      const tables = aud.tables();
      flow.record("表数量", tables.length);
      const missing = REQ_TABLES.filter((t) => !tables.includes(t));
      flow.check("关键表齐全", missing.length === 0, "无缺失", missing);
      const cardCols = aud.columns("cards");
      flow.eq("cards.sibling_key 已迁移（§4.16 v34）", cardCols.includes("sibling_key"), true);
      const logCols = aud.columns("review_logs");
      const missingCols = ["fsrs_before_json", "fsrs_after_json", "leech_before_json", "fsrs_config_id", "fsrs_before_config_id", "review_seq"].filter((c) => !logCols.includes(c));
      flow.check("review_logs 快照列齐全（§4.4.9）", missingCols.length === 0, "无缺失", missingCols);
      flow.eq("cfg-default 恰好 1 行（§4.4.10 播种幂等）", aud.count("fsrs_configs"), 1);
      const cfgDef = db.getConfigRow("cfg-default");
      flow.eq("cfg-default 权重长度 21（§7.4 L900）", cfgDef?.weights?.length, 21);

      // ---------- S2 评分：八字段往返 ----------
      flow.section("S2 评分落库 fsrs_json 八字段往返（§4.4.5 L95/L164）");
      const probe = mk("PROBE", fsrs());
      const pBefore = db.getCard(probe).fsrs;
      const pAfter = { ...pBefore, due: Date.now() + 4 * 86400000, stability: 6.1, difficulty: 5.2, reps: 7, lastReview: Date.now() };
      db.saveReview(probe, pAfter, "Good", 1500, pBefore);
      const got = db.getCard(probe).fsrs;
      const missingFields = FIELD8.filter((f) => got[f] === undefined);
      flow.check("八字段无静默裁剪（§7.1.7 文档字段不许实现时裁剪）", missingFields.length === 0, "无缺失", missingFields);
      flow.eq("落库值 == 评分传入的 after", got, pAfter);
      aud = await audit(dbFile);
      const rawLog = aud.one("SELECT * FROM review_logs ORDER BY review_seq DESC LIMIT 1");
      flow.check("日志含 before/after 双快照", !!rawLog?.fsrs_before_json && !!rawLog?.fsrs_after_json, true, { b: !!rawLog?.fsrs_before_json, a: !!rawLog?.fsrs_after_json });
      flow.eq("日志 after == 卡表 fsrs_json（同一次评分两处一致）", JSON.parse(rawLog.fsrs_after_json), pAfter);
      flow.eq("日志记所用 config（可追溯）", rawLog.fsrs_config_id, "cfg-default");
      flow.eq("review_seq 稠密从 1 起", Number(rawLog.review_seq), 1);

      // ---------- S3 写库即时落盘矩阵 ----------
      flow.section("S3 写库函数逐个即时落盘矩阵（§7.2 L874「每次落库即落盘」）");
      const mutations = [
        ["createCard", () => mk("MUT-CARD", fsrs())],
        ["createFromPaste", () => db.createFromPaste("FLOWTEST 粘贴书", "# 标题\n\n正文内容足够长以便通过章节抽取。")],
        ["createExtract", () => {
          const items = db.listItems();
          const it = items.find((x) => x.title === "FLOWTEST 粘贴书") || items[0];
          const docId = aud0.one("SELECT id FROM documents WHERE library_item_id = ?", [it.id])?.id;
          return db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "FLOWTEST 摘录内容", priority: 60 });
        }],
        ["saveReview", () => db.saveReview(mk("MUT-REVIEW", fsrs()), { ...fsrs(), reps: 9 }, "Easy", 500, fsrs())],
        ["saveSkip", () => db.saveSkip(mk("MUT-SKIP", fsrs()))],
        ["updateCard", () => { const id = mk("MUT-UPD", fsrs()); return db.updateCard({ ...db.getCard(id), backMarkdown: "改过的答案" }); }],
        ["updateCardLeech", () => { const id = mk("MUT-LEECH", fsrs()); return db.updateCardLeech(id, { isLeech: true, suspended: true, suspendedAt: Date.now() }); }],
        ["addCardIssue", () => db.addCardIssue({ cardId: mk("MUT-ISSUE", fsrs()), ruleId: "L1", severity: "error", message: "flowtest", source: "lint" })],
        ["deleteCard", () => db.deleteCard(mk("MUT-DEL", fsrs()))],
        ["insertFsrsConfig", () => db.insertFsrsConfig(cfgDef.weights.map((v, i) => v + i * 1e-6), cfgDef.schedulerOptions, "flowtest-persist")],
        ["addReadingEvent", () => db.addReadingEvent(db.listItems()[0]?.id, 120)],
        ["createJournalEntry", () => db.createJournalEntry({ contentMarkdown: "FLOWTEST 日记一条", source: "app" })],
        ["createKnowledgePoint", () => db.createKnowledgePoint({ canonicalLabel: "FLOWTEST KP " + flow.rng.seed, domainId: null })],
      ];
      const aud0 = await audit(dbFile);
      const notFlushed = [];
      // 批次 C（D-TEST-01）落盘责任挪到 optimizer 边界后，insertFsrsConfig 成为**已登记的例外**：
      // 它的两个生产调用方（optimizer.applyWeights 与 initDb 迁移块）各自在边界上 persistNow，
      // 在 insertFsrsConfig 内部补 persist 反而会在 initDb 迁移途中动到还没就绪的落盘路径。
      const EXEMPT_PERSIST = /^insertFsrsConfig/;
      for (const [label, fn] of mutations) {
        let flushed = true;
        let err = null;
        try {
          db.persistNow(); // 基线：先把此前所有改动刷盘，隔离出「本次写入是否自己刷盘」
          const before = snapshotAll(await audit(dbFile), AUDIT_TABLES);
          fn();
          const after = snapshotAll(await audit(dbFile), AUDIT_TABLES);
          flushed = Object.keys(diffSnapshots(before, after)).length > 0;
        } catch (e) {
          err = String(e && e.message ? e.message : e);
          flushed = false;
        }
        if (!flushed) notFlushed.push(label + (err ? `(抛错:${err.slice(0, 60)})` : ""));
        console.log(`    ${flushed ? "✓" : "✗"} ${label} 即时落盘`);
      }
      // 批次 C（D-TEST-01）：这条从 known 降级为 check + 显式例外。
      // 规格 §C2 给的写法是「保留 known 只加 EXEMPT 过滤」，实测那样会以**意外转绿**反向报警
      // （notFlushed 里只剩 insertFsrsConfig 这一格，过滤后判据成立）→ 本层的闸门会直接判红。
      // 例外已在上面注释登记：insertFsrsConfig 的两个生产调用方各自在边界落盘，它本身不落盘是设计。
      flow.check(
        "全部写库函数即时落盘（日记防抖 + insertFsrsConfig 两条例外不在本表）",
        notFlushed.filter((l) => !EXEMPT_PERSIST.test(l)).length === 0,
        "除已登记例外外全部落盘",
        notFlushed
      );
      // 日记草稿的防抖例外必须**确实**是例外：saveJournalDraft 不得立即刷盘（§7.2 L874 / D34）
      const formal = async () => (await audit(dbFile)).rows("SELECT COUNT(*) AS n FROM journal_entries WHERE is_draft = 0")[0].n;
      db.persistNow();
      const dBefore = await formal();
      db.saveJournalDraft("FLOWTEST 未发送草稿" + flow.rng.seed);
      const dAfter = await formal();
      flow.eq("草稿不产生正式条目", dAfter, dBefore);
      db.sendJournalDraft("FLOWTEST 发送" + flow.rng.seed);
      flow.eq("发送后正式条目 +1（flush 语义生效）", await formal(), dBefore + 1);

      // ---------- S4 同源延后：队列视图、零写库、额度回收 ----------
      flow.section("S4 同源延后＝队列视图，零写库 + 额度回收（§4.16 L316–324/L331）");
      const n = 2 + flow.rng.int(3);
      flow.record("同源组规模", n);
      const gkey = `act:flowtest-${flow.rng.seed}`;
      const grp = [];
      for (let i = 0; i < n; i++) grp.push(mk(`GRP${i}`, fsrs({ due: Date.now() - i * 1000 }), { siblingKey: gkey }));
      const snapB = snapshotAll(await audit(dbFile), AUDIT_TABLES);
      const q1 = db.computeTodayQueue();
      const s3 = snapshotAll(await audit(dbFile), AUDIT_TABLES);
      flow.check("读队列对全部业务表零写入", Object.keys(diffSnapshots(snapB, s3)).length === 0, "{}", summaryOf(diffSnapshots(snapB, s3)) || "{}");
      let inQ = q1.cards.filter((c) => c.siblingKey === gkey);
      let def = q1.deferred.filter((c) => c.siblingKey === gkey);
      flow.eq("当日只放行 1 张", inQ.length, 1);
      flow.eq("其余全部显式列入 deferred（不静默少卡）", def.length, n - 1);
      flow.check("deferred 带可读原因对象（锚到兄弟卡）", def.every((d) => d.deferReason && (d.deferReason.siblingCardId || d.deferReason.kind)), "有原因", def.map((d) => d.deferReason));
      flow.eq("队列与 listDueCards 口径唯一", db.listDueCards().map((c) => c.id).join(","), q1.cards.map((c) => c.id).join(","));
      // 评掉放行的那张 → 额度耗尽
      const revealed = inQ[0].id;
      const rBefore = db.getCard(revealed).fsrs;
      db.saveReview(revealed, { ...rBefore, due: Date.now() + 3 * 86400000, reps: rBefore.reps + 1 }, "Good", 800, rBefore);
      const q2 = db.computeTodayQueue();
      flow.eq("评分后组内当日不再放行新卡", q2.cards.filter((c) => c.siblingKey === gkey).length, 0);
      flow.eq("全部转 deferred", q2.deferred.filter((c) => c.siblingKey === gkey).length, n - 1);
      // 撤销 → 额度回收
      const u1 = db.undoLastReview();
      flow.eq("撤销复原被评卡状态", u1.card.fsrs, rBefore);
      const q3 = db.computeTodayQueue();
      flow.eq("撤销后额度回收，重新放行 1 张", q3.cards.filter((c) => c.siblingKey === gkey).length, 1);
      // learning 卡豁免
      const learnId = mk("LEARN", { ...fsrs({ due: Date.now() - 10 }), state: "learning", learningSteps: [600000] }, { siblingKey: gkey });
      const q4 = db.computeTodayQueue();
      flow.check("learning 步进卡不参与延后（§4.16 豁免）", q4.cards.some((c) => c.id === learnId), true, q4.cards.map((c) => c.id).includes(learnId));
      // 挂起卡排除
      db.updateCardLeech(learnId, { isLeech: true, suspended: true, suspendedAt: Date.now() });
      const q5 = db.computeTodayQueue();
      flow.eq("挂起卡不进队列", q5.cards.some((c) => c.id === learnId), false);

      // ---------- S5 统计同口径 ----------
      flow.section("S5 统计与队列同口径（§4.2-20 L330）");
      const stats = db.getStatsOverview();
      const a5 = await audit(dbFile);
      const dayEnd = new Date(new Date().toDateString()).getTime() + 86400000;
      let rawTotal = 0;
      for (const r of a5.all("cards")) {
        if (r.is_deleted) continue;
        let f, l;
        try { f = r.fsrs_json ? JSON.parse(r.fsrs_json) : null; } catch { continue; }
        try { l = r.leech_json ? JSON.parse(r.leech_json) : null; } catch { l = null; }
        if (l?.suspended) continue;
        if ((f?.due ?? Date.now()) <= dayEnd) rawTotal++;
      }
      flow.record("kpi.dueToday", stats.kpi.dueToday);
      flow.record("kpi.siblingDeferred", stats.kpi.siblingDeferred);
      flow.eq("dueToday + siblingDeferred == 原始口径活跃到期数", stats.kpi.dueToday + stats.kpi.siblingDeferred, rawTotal);

      // ---------- S6 跳过与撤销的账目边界 ----------
      flow.section("S6 跳过与撤销账目（§4.4.9 L105 / §6.2 L537）");
      const logs0 = (await audit(dbFile)).count("review_logs");
      const skipTarget = mk("SKIP-ME", fsrs());
      db.persistNow();
      const a6 = await audit(dbFile);
      const s6b = snapshotAll(a6, ["cards", "review_logs", "review_skips"]);
      db.saveSkip(skipTarget);
      const s6a = snapshotAll(await audit(dbFile), ["cards", "review_logs", "review_skips"]);
      const d2 = diffSnapshots(s6b, s6a);
      flow.eq("跳过只动 review_skips", Object.keys(d2).sort().join(","), "review_skips");
      flow.eq("跳过新增恰 1 行", (d2.review_skips?.added || []).length, 1);
      flow.eq("跳过不改卡调度状态", (d2.cards?.changed || []).length, 0);
      flow.eq("跳过不写复习日志", a6.count("review_logs"), (await audit(dbFile)).count("review_logs"));

      const logs1 = (await audit(dbFile)).count("review_logs");
      const A = mk("UNDO-A", fsrs());
      const B = mk("UNDO-B", fsrs());
      const aBefore = db.getCard(A).fsrs;
      const bBefore = db.getCard(B).fsrs;
      db.saveReview(A, { ...aBefore, reps: aBefore.reps + 1, due: Date.now() + 86400000 }, "Good", 900, aBefore);
      db.saveReview(B, { ...bBefore, reps: bBefore.reps + 1, learningSteps: [600000] }, "Again", 700, bBefore);
      flow.eq("两评两日志", (await audit(dbFile)).count("review_logs"), logs1 + 2);
      const ua = db.undoLastReview();
      flow.eq("后评先撤（按 review_seq 而非 id/时间）", ua.card.id, B);
      flow.eq("撤销完整复原（含 learningSteps）", ua.card.fsrs, bBefore);
      const ub = db.undoLastReview();
      flow.eq("再撤到 A", ub.card.id, A);
      flow.eq("撤销物理删除日志（训练输入自动干净）", (await audit(dbFile)).count("review_logs"), logs1);
      const tam = mk("TAMPER", fsrs());
      const tB = db.getCard(tam).fsrs;
      const tA = { ...tB, reps: tB.reps + 1 };
      db.saveReview(tam, tA, "Easy", 400, tB);
      flow.eq("未篡改时可撤销", db.getLastUndoableReview()?.cardId, tam);
      db.updateCard({ ...db.getCard(tam), fsrs: { ...tA, due: tA.due + 7776000 } });
      flow.eq("卡被外部改写后不可撤销（§4.4.9 after 一致性）", db.getLastUndoableReview(), null);

      // ---------- S7 参数环境 ----------
      flow.section("S7 FSRS 参数环境不可变（§4.4.10 L106/L173）");
      const cfgBefore = (await audit(dbFile)).count("fsrs_configs");
      const w1 = cfgDef.weights.map((v, i) => v + i * 0.001 + flow.rng.next() * 0.01);
      const idA = db.insertFsrsConfig(w1, cfgDef.schedulerOptions, "flowtest");
      const idA2 = db.insertFsrsConfig(w1, cfgDef.schedulerOptions, "flowtest-dup");
      flow.check("同配置指纹去重", idA === idA2 && idA !== "cfg-default", "同一新 id", { idA, idA2 });
      db.persistNow();
      const cardsB = (await audit(dbFile)).all("cards");
      db.setActiveFsrsConfig(idA);
      flow.eq("切换只移动指针", db.getActiveConfigId(), idA);
      const cardsA2 = (await audit(dbFile)).all("cards");
      flow.eq("切参数环境绝不回改既有卡", JSON.stringify(cardsA2), JSON.stringify(cardsB));
      const cfgRows = (await audit(dbFile)).all("fsrs_configs");
      flow.eq("配置表只追加不改写（净增恰 1 行，重复指纹不增行）", cfgRows.length - cfgBefore, 1);
      const sFile = path.join(dir, "settings.json");
      const sObj = JSON.parse(fs.readFileSync(sFile, "utf8"));
      sObj.app = { ...(sObj.app || {}), fsrsConfigId: "不存在的配置" };
      fs.writeFileSync(sFile, JSON.stringify(sObj));
      flow.eq("悬空指针回退 cfg-default", db.getActiveConfigId(), "cfg-default");
      sObj.app.fsrsConfigId = "cfg-default";
      fs.writeFileSync(sFile, JSON.stringify(sObj));

      // ---------- S8 软删除 ----------
      flow.section("S8 软删除与关联收敛（§7.2 L869）");
      const victim = mk("DELETE-ME", fsrs());
      db.addCardIssue({ cardId: victim, ruleId: "L1", severity: "error", message: "flowtest", source: "lint" });
      db.deleteCard(victim);
      const a8 = await audit(dbFile);
      const vr = a8.one("SELECT is_deleted FROM cards WHERE id = ?", [victim]);
      flow.eq("删除后行仍在（is_deleted=1）", Number(vr?.is_deleted), 1);
      flow.eq("业务查询不再返回该卡", db.listAllCards().some((c) => c.id === victim), false);
      flow.eq("该卡 open issue 自动收口", a8.rows("SELECT COUNT(*) AS n FROM card_issues WHERE card_id = ? AND status='open'", [victim])[0].n, 0);

      // ---------- S9 重启不丢数据 ----------
      flow.section("S9 重启不丢数据 + 二次 initDb 幂等（§7.1.4 L858）");
      const idsBefore = db.listAllCards().map((c) => c.id).sort();
      const logsBefore = (await audit(dbFile)).count("review_logs");
      const cfgPreRestart = (await audit(dbFile)).count("fsrs_configs");
      flow.eq("无残留 library.db.tmp（启动时清理）", fs.existsSync(path.join(dir, "library.db.tmp")), false);
      const dbPath = path.join(__dirname, "..", "..", "electron", "db.js");
      delete require.cache[dbPath];
      const db2 = require(dbPath);
      await db2.initDb();
      flow.eq("第二次 initDb 卡集合一致", db2.listAllCards().map((c) => c.id).sort(), idsBefore);
      const a9 = await audit(dbFile);
      flow.eq("第二次 initDb 不重复播种参数环境", a9.count("fsrs_configs"), cfgPreRestart);
      flow.eq("第二次 initDb 不增不减复习日志", a9.count("review_logs"), logsBefore);
      flow.eq("第二次 initDb 后 cfg-default 仍可解析 21 权重", db2.getConfigRow("cfg-default").weights.length, 21);
      const undoableAfterRestart = db2.getLastUndoableReview();
      flow.check("重启后撤销语义仍可用（不因重启产生假可撤销项）", !undoableAfterRestart || a9.rows("SELECT * FROM review_logs").some((r) => String(r.card_id) === String(undoableAfterRestart.cardId)), true, undoableAfterRestart);
      flow.record("重启后表数量", a9.tables().length);

      // ---------- S10 应用优化权重后重启 ----------
      flow.section("S10 应用优化权重后重启仍生效（§4.4.10 D20 / §7.2 L874 / §7.1.4 L858）");
      const opt = require(path.join(__dirname, "..", "..", "electron", "optimizer.js"));
      const wApplied = cfgDef.weights.map((v, i) => v * (1 + (i % 3) * 1e-4));
      const res = opt.applyWeights(db2, wApplied);
      flow.check("applyWeights 返回 ok 且给出 configId", res?.ok === true && !!res.configId, "ok", res);
      flow.eq("应用后活跃指针指向新配置", db2.getActiveConfigId(), res?.configId);
      const onDiskIds = (await audit(dbFile)).rows("SELECT id FROM fsrs_configs").map((r) => r.id);
      flow.check(
        "新配置行当场落盘（指针与内容同生共死）",
        onDiskIds.includes(res.configId),
        "磁盘含该行",
        `磁盘 ${onDiskIds.length} 行，无新 id`
      );
      delete require.cache[dbPath];
      const db3 = require(dbPath);
      await db3.initDb();
      flow.check(
        "重启后仍在用刚应用的优化参数",
        db3.getActiveConfigId() === res.configId,
        res.configId,
        db3.getActiveConfigId()
      );
      // 批次 C（D-TEST-01）新增：幂等——同一权重集合连应用两次不得产生第二行、第二次不得报错
      const rowsBeforeIdem = (await audit(dbFile)).rows("SELECT id FROM fsrs_configs").length;
      let idemErr = null;
      let res2 = null;
      try {
        res2 = opt.applyWeights(db3, wApplied);
      } catch (e) {
        idemErr = String((e && e.message) || e).slice(0, 40);
      }
      const rowsAfterIdem = (await audit(dbFile)).rows("SELECT id FROM fsrs_configs").length;
      flow.eq("重复应用同一权重不报错", idemErr, null);
      flow.eq("重复应用同一权重不产生第二行（指纹去重仍生效）", rowsAfterIdem, rowsBeforeIdem);
      flow.eq("重复应用后指针仍指向那一行", res2 && res2.configId, res.configId);
      flow.record("重启后卡数", db3.listAllCards().length);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F03 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
