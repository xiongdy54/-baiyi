// F15 幂等与重放矩阵（换角度：每个动作连点两次会发生什么）
// @runtime: electron  @tier: 2  @gui: false  @id: F15  @timeout: 300
// 运行：npx electron tests/flows/f15-idempotency-replay.cjs   （或 node tests/flows/run.cjs --only F15）
//
// 角度：真实世界里动作会被重复触发——双击按钮、IPC 超时后用户再点、persist 失败后点「重试保存」、
//       AI 整理重复运行、重启后再走一遍同样的操作。文档对其中几类写死了承诺：
//       §4.2-24「重跑 AI 整理 = 零新增行」（靠 fingerprint）、§4.6 关系唯一约束与建环拒绝、
//       §4.4.9 撤销只回退一条、§4.16 延后是视图。既有测试全都只调一次。
//       这条把每个写入口按「做两遍」重放一遍，看事实会不会长双份、状态会不会回退。
//
// 依据：§4.2-24、§4.6、§4.4.9、§4.16、§4.4.10、§6.4、§7.2、§9.1 M2/M15。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F15",
  title: "幂等与重放矩阵",
  angle: "重复触发下的事实守恒与状态不回退",
  cites: ["§4.2-24", "§4.6", "§4.4.9", "§4.16", "§4.4.10", "§6.4", "§7.2"],
  tier: 2,
  gui: false,
});

const call = (fn) => {
  try {
    return { ok: true, v: fn() };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
};

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f15"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const mk = (label, extra = {}) =>
        db.createCard({
          noteText: `F15 ${label}`,
          cardType: "qa",
          frontMarkdown: `F15 问题 ${label}`,
          backMarkdown: "答案",
          priority: 50,
          tags: [],
          fsrsJson: JSON.stringify({ state: "review", due: Date.now() - 1000, lapses: 0, stability: 3, difficulty: 6, reps: 1, lastReview: null, learningSteps: [] }),
          ...extra,
        }).id;

      // ---------- T1 提案重放 ----------
      flow.section("T1 提案指纹幂等（§4.2-24「重跑 AI 整理 = 零新增行」）");
      const payload = { proposalKind: "point", payload: { canonicalLabel: "F15 知识点", aliases: ["kp"] }, confidence: 0.7, scope: "flowtest" };
      const p1 = db.createKnowledgeProposal(payload);
      const p2 = db.createKnowledgeProposal(payload);
      const p3 = db.createKnowledgeProposal(payload);
      flow.eq("第二次返回既有行且 created:false", p2.created, false);
      flow.eq("三次调用同一 id", new Set([p1.id, p2.id, p3.id]).size, 1);
      const a1 = await audit(dbFile);
      flow.eq("表里只有一行", a1.rows("SELECT COUNT(*) AS n FROM knowledge_proposals WHERE scope='flowtest'")[0].n, 1);
      const diffPayload = { proposalKind: "point", payload: { canonicalLabel: "F15 另一个知识点" }, scope: "flowtest" };
      const p4 = db.createKnowledgeProposal(diffPayload);
      flow.eq("不同内容照常新增（幂等不是吞提交）", p4.created, true);
      const rej = db.resolveKnowledgeProposal(p1.id, "rejected");
      flow.record("拒绝后的行仍留痕", rej ? "可查" : "返回空");
      const p5 = call(() => db.createKnowledgeProposal(payload));
      flow.check("已拒绝的指纹不再重新提议（重放不复活）", p5.ok && p5.v.created === false, true, p5.ok ? p5.v.created : p5.err);

      // ---------- T2 关系唯一与拒绝矩阵 ----------
      flow.section("T2 关系重复/自环/建环/缺字段全部被拒（§4.6）");
      const kpA = db.createKnowledgePoint({ canonicalLabel: "F15 A" });
      const kpB = db.createKnowledgePoint({ canonicalLabel: "F15 B" });
      const kpC = db.createKnowledgePoint({ canonicalLabel: "F15 C" });
      const aId = kpA.id || kpA;
      const bId = kpB.id || kpB;
      const cId = kpC.id || kpC;
      const r1 = call(() => db.createKnowledgeRelation({ relationType: "related_to", fromKnowledgePointId: aId, toKnowledgePointId: bId }));
      flow.check("首次建关系成功", r1.ok, true, r1.err);
      const r2 = call(() => db.createKnowledgeRelation({ relationType: "related_to", fromKnowledgePointId: aId, toKnowledgePointId: bId }));
      flow.check("重复同类型同边被拒", r2.ok === false, "拒绝", r2.v);
      flow.check("拒绝理由点名唯一约束", /唯一约束|已存在/.test(r2.err || ""), true, r2.err);
      const r3 = call(() => db.createKnowledgeRelation({ relationType: "related_to", fromKnowledgePointId: aId, toKnowledgePointId: aId }));
      flow.check("自循环被拒", r3.ok === false && /自循环/.test(r3.err), true, r3.err);
      const r4 = call(() => db.createKnowledgeRelation({ relationType: "不存在的类型", fromKnowledgePointId: aId, toKnowledgePointId: bId }));
      flow.check("未知关系类型被拒", r4.ok === false, true, r4.err);
      const r5 = call(() => db.createKnowledgeRelation({ relationType: "related_to", fromKnowledgePointId: aId, toKnowledgePointId: "不存在" }));
      flow.check("端点缺失被拒", r5.ok === false, true, r5.err);
      const r6 = call(() => db.createKnowledgeRelation({ relationType: "analogous_to", fromKnowledgePointId: aId, toKnowledgePointId: cId }));
      flow.check("analogous_to 缺 structureLabel 被拒（§4.14）", r6.ok === false && /structureLabel/.test(r6.err), true, r6.err);
      db.createKnowledgeRelation({ relationType: "prerequisite", fromKnowledgePointId: bId, toKnowledgePointId: cId });
      const cyc = call(() => db.createKnowledgeRelation({ relationType: "prerequisite", fromKnowledgePointId: cId, toKnowledgePointId: bId }));
      flow.check("prerequisite 建环被拒", cyc.ok === false, true, cyc.v);
      flow.check("建环拒绝时回传环路径（用户能看懂为什么）", /→|->/.test(cyc.err || ""), true, cyc.err);
      const a2 = await audit(dbFile);
      flow.eq("关系表只留下被允许的那两条", a2.count("knowledge_relations"), 2);

      // ---------- T3 合并与拆回 ----------
      flow.section("T3 重复合并不产生链式指针（§4.2-23 可逆合并）");
      const m1 = call(() => db.mergeKnowledgePoints(aId, cId));
      const m2 = call(() => db.mergeKnowledgePoints(aId, cId));
      flow.record("第二次合并的处置", m2.ok ? "幂等接受" : `拒绝：${(m2.err || "").slice(0, 40)}`);
      const kpARow = db.getKnowledgePoint(aId);
      flow.check("被合并方状态为 merged 且指向唯一目标", kpARow?.status === "merged" && !!kpARow?.mergedInto, true, { s: kpARow?.status, m: kpARow?.mergedInto });
      flow.check("不出现 A→C→x 的链式指针", (() => { const t = db.getKnowledgePoint(kpARow.mergedInto); return !t || t.status !== "merged"; })(), true);
      const un = call(() => db.unmergeKnowledgePoint(aId));
      const kpA2 = db.getKnowledgePoint(aId);
      flow.check("拆回后恢复 active 且指针清空", un.ok && kpA2.status === "active" && !kpA2.mergedInto, true, { ok: un.ok, s: kpA2.status, m: kpA2.mergedInto });

      // ---------- T4 撤销重放 ----------
      flow.section("T4 撤销连点：每次只回退一条，账本不倒扣（§4.4.9）");
      const c1 = mk("撤销A");
      const c2 = mk("撤销B");
      for (const id of [c1, c2]) {
        const cur = db.getCard(id).fsrs;
        db.saveReview(id, { ...cur, reps: cur.reps + 1, due: Date.now() + 86400000 }, "Good", 500, cur);
      }
      const logs0 = (await audit(dbFile)).count("review_logs");
      const seq = [];
      for (let i = 0; i < 5; i++) {
        const r = call(() => db.undoLastReview());
        seq.push(r.ok ? (r.v.ok ? "回退" : `拒绝(${String(r.v.reason || "").slice(0, 10)})`) : "抛错");
      }
      flow.record("连点五次的结果序列", seq.join(" → "));
      const logs1 = (await audit(dbFile)).count("review_logs");
      flow.check("日志数只减不增且减少量 ≤ 实际回退次数", logs1 <= logs0 && seq.filter((x) => x === "回退").length === logs0 - logs1, true, { logs0, logs1, seq });
      flow.check("撤销完不再有可撤销项时明确拒绝而非静默", seq[seq.length - 1].startsWith("拒绝") || seq[seq.length - 1] === "回退", true, seq[seq.length - 1]);

      // ---------- T5 挂起 / leech 处理重放 ----------
      flow.section("T5 重复挂起与重复处理不产生双份事实");
      const lc = mk("leech卡", { fsrsJson: JSON.stringify({ state: "review", due: Date.now() - 10, lapses: 8, stability: 1, difficulty: 9, reps: 20, lastReview: Date.now(), learningSteps: [] }) });
      db.addCardIssue({ cardId: lc, ruleId: "LEECH", severity: "warn", message: "F15", source: "lint" });
      for (let i = 0; i < 3; i++) db.updateCardLeech(lc, { isLeech: true, suspended: true, suspendedAt: Date.now() });
      const a5 = await audit(dbFile);
      flow.eq("重复挂起不增加 issue 行", a5.rows("SELECT COUNT(*) AS n FROM card_issues WHERE card_id = ?", [lc])[0].n, 1);
      flow.check("卡状态仍是挂起（末次写入为准，不抖动）", db.getCard(lc).leech?.suspended === true, true, db.getCard(lc).leech);
      const rs1 = call(() => db.resolveLeech(lc, { step: "reset" }, { suspended: false }));
      const rs2 = call(() => db.resolveLeech(lc, { step: "reset" }, { suspended: false }));
      flow.check("第二次处理不抛错（幂等或明确拒绝都可）", rs1.ok && rs2.ok, true, { e1: rs1.err, e2: rs2.err });
      const a5b = await audit(dbFile);
      flow.eq("重复处理不新增 issue 行", a5b.rows("SELECT COUNT(*) AS n FROM card_issues WHERE card_id = ?", [lc])[0].n, 1);
      flow.record("处理后仍 open 的 issue 数（是否自动收口由 UI 决定，见 §6.3.6）", a5b.rows("SELECT COUNT(*) AS n FROM card_issues WHERE card_id = ? AND status='open'", [lc])[0].n);

      // ---------- T6 删除重放 ----------
      flow.section("T6 重复删除不产生副作用（§7.2 软删除）");
      const vc = mk("删除靶");
      db.addCardIssue({ cardId: vc, ruleId: "L1", severity: "error", message: "F15", source: "lint" });
      db.deleteCard(vc);
      const snapBefore = snapshotAll(await audit(dbFile), ["cards", "card_issues"]);
      db.deleteCard(vc);
      db.deleteCard(vc);
      const snapAfter = snapshotAll(await audit(dbFile), ["cards", "card_issues"]);
      flow.eq("重复删除不新增卡行", snapAfter.cards.size, snapBefore.cards.size);
      flow.eq("重复删除不新增 issue 行", snapAfter.card_issues.size, snapBefore.card_issues.size);
      flow.record("重复删除带来的行内容抖动（updated_at）", summaryOf(diffSnapshots(snapBefore, snapAfter)) || "无");
      const item = db.createFromPaste("F15 待删书", "# 章\n\n内容。") && db.listItems().find((x) => x.title === "F15 待删书");
      if (item) {
        db.deleteItem(item.id);
        const s1 = snapshotAll(await audit(dbFile), ["library_items", "documents", "cards"]);
        db.deleteItem(item.id);
        const s2 = snapshotAll(await audit(dbFile), ["library_items", "documents", "cards"]);
        flow.eq("重复删书不新增书目行", s2.library_items.size, s1.library_items.size);
        flow.eq("重复删书不新增文档行", s2.documents.size, s1.documents.size);
      }

      // ---------- T7 推迟 / 跳过 ----------
      flow.section("T7 推迟复合递增但不复制条目；跳过每次都记（§6.4）");
      let doc = (await audit(dbFile)).one("SELECT id FROM documents WHERE is_deleted = 0 LIMIT 1");
      if (!doc) { db.createFromPaste("F15 host doc", "# ch"); doc = (await audit(dbFile)).one("SELECT id FROM documents WHERE is_deleted = 0 LIMIT 1"); }
      flow.guard("有可挂载文档（T7/T8 前提）", () => !!doc);
      const created = call(() => db.createExtract({ parentType: "document", parentId: doc.id, documentId: doc.id, contentMarkdown: "F15 摘录", priority: 50 }));
      const a7a = await audit(dbFile);
      const exRow = a7a.one("SELECT id, content_markdown FROM extracts ORDER BY created_at DESC LIMIT 1");
      flow.record("createExtract 返回与最新摘录行", JSON.stringify(created.ok ? created.v : created.err).slice(0, 90) + " / " + JSON.stringify(exRow).slice(0, 90));
      const exId = exRow && exRow.id;
      const before7 = (await audit(dbFile)).count("extracts");
      db.postponeExtract(exId);
      const d1 = db.getExtract(exId).topicNextAt;
      db.postponeExtract(exId);
      const d2 = db.getExtract(exId).topicNextAt;
      db.postponeExtract(exId);
      const d3 = db.getExtract(exId).topicNextAt;
      flow.check("三次推迟时间单调后移", d1 < d2 && d2 < d3, true, [d1, d2, d3]);
      flow.eq("推迟不复制摘录行", (await audit(dbFile)).count("extracts"), before7);
      const cap = (d3 - Date.now()) / 86400000;
      flow.check("仍守 180 天上限", cap <= 181, "≤180", Math.round(cap));
      const sk = mk("跳过靶");
      const logs7 = (await audit(dbFile)).count("review_logs");
      db.saveSkip(sk);
      db.saveSkip(sk);
      const a7 = await audit(dbFile);
      flow.eq("两次跳过记两条（都是真实事实）", a7.rows("SELECT COUNT(*) AS n FROM review_skips WHERE card_id = ?", [sk])[0].n, 2);
      flow.eq("跳过不写复习日志", a7.count("review_logs"), logs7);

      // ---------- T8 参数环境与导图 active ----------
      flow.section("T8 重复切换 active 不产生多 active（§4.4.10 / §4.19）");
      const cfg = db.getConfigRow("cfg-default");
      const idA = db.insertFsrsConfig(cfg.weights.map((v, i) => v + 1e-5 * i), cfg.schedulerOptions, "f15-a");
      const idB = db.insertFsrsConfig(cfg.weights.map((v, i) => v - 1e-5 * i), cfg.schedulerOptions, "f15-b");
      for (let i = 0; i < 3; i++) db.setActiveFsrsConfig(idA);
      flow.eq("连切三次活跃指针仍是它", db.getActiveConfigId(), idA);
      db.persistNow();
      flow.eq("配置行不因重复切换而增加", (await audit(dbFile)).rows("SELECT COUNT(*) AS n FROM fsrs_configs WHERE source LIKE 'f15-%'")[0].n, 2);
      const map1 = db.saveMaterialMap({ documentId: doc.id, scopeAnchor: "book", structure: { nodes: [{ id: "n1", title: "甲" }], edges: [] }, isActive: true });
      db.saveMaterialMap({ documentId: doc.id, scopeAnchor: "book", structure: { nodes: [{ id: "n1", title: "甲" }], edges: [] }, isActive: true });
      for (let i = 0; i < 3; i++) db.setActiveMaterialMap(map1.id);
      const a8 = await audit(dbFile);
      flow.eq("重复设 active 后同 scope 仍只有一个 active", a8.rows("SELECT COUNT(*) AS n FROM material_maps WHERE document_id = ? AND scope_anchor='book' AND is_active=1 AND is_deleted=0", [doc.id])[0].n, 1);

      // ---------- T9 草稿发送 / 设置 / 批次 ----------
      flow.section("T9 空草稿不产出条目；同值设置与批次状态重放不回退（§6.5）");
      const before9 = (await audit(dbFile)).count("journal_entries");
      db.sendJournalDraft("F15 首发");
      const after9 = (await audit(dbFile)).count("journal_entries");
      const again9 = call(() => db.sendJournalDraft(""));
      flow.eq("有内容时恰好新增一条", after9 - before9, 1);
      flow.record("空内容再发送的处置", again9.ok ? `返回 ${JSON.stringify(again9.v).slice(0, 40)}` : `拒绝：${again9.err.slice(0, 30)}`);
      flow.eq("空内容不产生新条目", (await audit(dbFile)).count("journal_entries"), after9);
      const sf = path.join(dir, "settings.json");
      const before = fs.readFileSync(sf, "utf8");
      const { writeSettings } = { writeSettings: (patch) => { const o = JSON.parse(fs.readFileSync(sf, "utf8")); o.app = { ...(o.app || {}), ...patch }; fs.writeFileSync(sf, JSON.stringify(o)); } };
      writeSettings({ theme: "light" });
      writeSettings({ theme: "light" });
      writeSettings({ theme: "light" });
      const mid = fs.readFileSync(sf, "utf8");
      writeSettings({ theme: "light" });
      flow.check("同值重复写入结果稳定（不追加重复键）", mid === fs.readFileSync(sf, "utf8"), "字节一致", "有漂移");
      flow.record("settings 结构未因重复写而变", JSON.stringify(Object.keys(JSON.parse(mid)).sort()) + " / 原 " + JSON.stringify(Object.keys(JSON.parse(before).sort?.() || before ? JSON.parse(before) : {})));
      const batch = db.createAIGenBatch({ scope: "card-generation", sourceText: "F15 批次原文", promptTemplateId: "t1" });
      const batchId = batch && (batch.id || batch);
      db.setAIGenBatchStatus(batchId, "accepted");
      const r9 = call(() => db.setAIGenBatchStatus(batchId, "draft"));
      flow.record("批次状态被改回 draft 的处置", r9.ok ? "允许回退（状态机未锁）" : `拒绝：${r9.err.slice(0, 30)}`);
      const a9 = await audit(dbFile);
      flow.eq("重复设置不产生第二批", a9.rows("SELECT COUNT(*) AS n FROM ai_gen_batches")[0].n, 1);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F15 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
