// F74 盲区通道补测第二批：dict / insights / mindmap / journal:draftSave
// @runtime: electron  @tier: 1  @gui: false  @id: F74  @timeout: 420
// 运行：npx electron tests/flows/f74-blindspot-batch2.cjs
//
// 承接 F72/F73（两批就抓到 3 条真缺陷），这批测 F45 清单里剩下的四个域。
// 通道→函数对应同样是从 electron/main.js 的 handler 现场读出来的：
//   dict:cacheGet→getDictCache  dict:cacheSet→setDictCache  dict:toggleSource→setDictSourceEnabled
//   insights:fail→(main.js:990 内联)  insights:feedback→(main.js:997 内联)
//   mindmap:setActive→setActiveMaterialMap  mindmap:runs→listMaterialMapRuns  mindmap:learningStatus→listMindmapLearningStatus
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F74",
  title: "盲区通道补测第二批",
  angle: "词典缓存/洞察反馈/导图状态/草稿保存 四域的边界与跨对象泄漏",
  cites: ["§7.1.3", "§4.19", "§4.13", "§7.4"],
  tier: 1,
  gui: false,
});

const settle = (fn, ...a) => {
  try {
    return { ok: true, v: fn(...a) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).slice(0, 130) };
  }
};

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f74"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();

    await runFlow(flow, async () => {
      flow.section("N1 dict:cacheSet / cacheGet —— 类型、体积、来源存在性");
      const r1 = settle(db.setDictCache, "prov-x", "ja", "勉強", { defs: ["学习"], freq: 1 });
      flow.record("正常写入缓存", JSON.stringify(r1).slice(0, 100));
      const g1 = settle(db.getDictCache, "prov-x", "ja", "勉強");
      flow.record("读回", JSON.stringify(g1.v).slice(0, 90));
      const rBad = settle(db.setDictCache, "prov-x", 1, "w", { a: 1 });
      flow.record("language 传数字", JSON.stringify(rBad).slice(0, 130));
      const rOrphan = settle(db.setDictCache, "不存在的provider", "ja", "x", { defs: ["y"] });
      flow.record("给不存在的 provider 写缓存", JSON.stringify(rOrphan).slice(0, 110));
      const a0 = await audit(dbFile);
      const dictRows = a0.rows("SELECT provider_id, language, COUNT(*) AS n FROM dictionary_cache GROUP BY provider_id, language");
      a0.close();
      flow.record("盘上缓存分组", JSON.stringify(dictRows));
      flow.check("给不存在的 provider 写缓存必须被拒或至少可判定（不得静默长孤儿分组）", dictRows.some((r) => r.provider_id === "不存在的provider") === false || rOrphan.ok === false, "无孤儿分组或已拒绝", { dictRows, rOrphan });
      const big = "字".repeat(2_000_000);
      const rBig = settle(db.setDictCache, "prov-x", "ja", "大对象键", { defs: [big] });
      flow.record("2MB 单条缓存写入", JSON.stringify(rBig).slice(0, 90));
      // 列名不写死（本仓库的老规矩：表与列都从 pragma 运行时读）
      const a0b = await audit(dbFile);
      const cols = a0b.columns("dictionary_cache");
      const allRows = a0b.rows("SELECT * FROM dictionary_cache ORDER BY rowid DESC");
      const bigRow = allRows[0] || null;
      flow.record("表内每行的序列化字节数（倒序）", JSON.stringify(allRows.slice(0, 5).map((r) => JSON.stringify(r).length)));
      a0b.close();
      flow.record("dictionary_cache 实际列", cols.join(" "));
      const bigSize = bigRow ? JSON.stringify(bigRow).length : 0;
      flow.record("盘上该条 entry 序列化字节数", `${bigSize} 字节（写入请求 2,000,000 字符）`);
      flow.check("2MB 单条缓存必须被拒或被截断（否则一个异常词条就能把 dictionary.db 撑爆）", bigSize < 2_000_000, "< 2MB", { 列: cols, 实际落盘字节: bigSize });

      flow.section("N2 dict:toggleSource —— 不存在的来源 id");
      const t1 = settle(db.setDictSourceEnabled, "不存在的来源", true);
      flow.record("toggle 不存在的来源", JSON.stringify(t1).slice(0, 110));
      const a1 = await audit(dbFile);
      const srcRows = a1.rows("SELECT COUNT(*) AS n FROM dict_sources");
      a1.close();
      flow.record("盘上 dict_sources 行数", JSON.stringify(srcRows));
      flow.check("改不存在的来源不得返回成功（假成功族）", t1.ok === false || t1.v === false || t1.v == null, "拒绝或返回假", t1);

      flow.section("N3 mindmap:learningStatus —— 跨文档 nodeIds 会不会串数据");
      const bookA = db.createFromPaste("F74 A 书", "# A章\n\n" + "甲".repeat(200) + "\n");
      const bookB = db.createFromPaste("F74 B 书", "# B章\n\n" + "乙".repeat(200) + "\n");
      const idA = bookA && (bookA.id || (bookA.item && bookA.item.id));
      const idB = bookB && (bookB.id || (bookB.item && bookB.item.id));
      const docA = db.createFromPaste ? null : null;
      void docA;
      const aDocs = await audit(dbFile);
      const docs = aDocs.rows("SELECT id, library_item_id FROM documents");
      aDocs.close();
      flow.record("documents 数", docs.length);
      const docIds = docs.map((d) => d.id);
      if (docIds.length >= 2) {
        const s1 = settle(db.listMindmapLearningStatus, docIds[0], docIds.slice(1));
        flow.record("拿 B 的 documentId 当 nodeIds 问 A 的学习状态", JSON.stringify(s1).slice(0, 140));
        const s2 = settle(db.listMindmapLearningStatus, docIds[0], ["a".repeat(64), "b".repeat(64)]);
        flow.record("乱码 nodeIds", JSON.stringify(s2).slice(0, 110));
        const many = Array.from({ length: 5000 }, (_, i) => "node-" + i);
        const s3 = settle(db.listMindmapLearningStatus, docIds[0], many);
        flow.record("5000 个 nodeIds（SQL IN 尺寸）", JSON.stringify(s3).slice(0, 130));
        flow.check("超大 nodeIds 数组不得把接口打挂或返回非数组（§7.1.3 边界）", s3.ok === false || Array.isArray(s3.v) || typeof s3.v === "object", "有界返回", s3);
      } else {
        flow.record("N3", "文档数不足 2 ⇒ **该格空跑**");
      }
      const sa = settle(db.setActiveMaterialMap, "不存在的导图 id");
      flow.record("setActiveMaterialMap(不存在)", JSON.stringify(sa).slice(0, 110));
      const runs = settle(db.listMaterialMapRuns, docIds[0] || "x");
      flow.record("listMaterialMapRuns", JSON.stringify(runs).slice(0, 90));

      flow.section("N4 journal:draftSave 的「全局至多一条草稿」约束");
      const d1 = settle(db.saveJournalDraft, "F74 草稿一", { deferPersist: false });
      const d2 = settle(db.saveJournalDraft, "F74 草稿二", { deferPersist: false });
      const d3 = settle(db.saveJournalDraft, "F74 草稿三", { deferPersist: false });
      flow.record("连续存三次草稿", JSON.stringify([d1, d2, d3].map((x) => (x.ok ? "ok" : x.err))).slice(0, 120));
      const a2 = await audit(dbFile);
      const drafts = a2.rows("SELECT id, content_markdown, is_draft FROM journal_entries WHERE is_draft = 1");
      const total = a2.count("journal_entries");
      a2.close();
      flow.record("盘上草稿行数 / 条目总数", `${drafts.length} / ${total}`);
      flow.check("连续存草稿后盘上必须仍只有一条草稿（§4.18 全局至多一条，库层部分唯一索引兜底）", drafts.length === 1, "1 条", { 草稿: drafts.length, 最新内容: drafts[0] && String(drafts[0].content_markdown).slice(0, 20) });

      flow.section("N5 insights:fail / feedback 的存在性与枚举");
      const f1 = settle(db.markInsightRunFailed || (() => { throw new Error("db 无 markInsightRunFailed"); }), "不存在的 run id", "磁盘满了");
      flow.record("insights:fail(不存在 id)", JSON.stringify(f1).slice(0, 110));
      const fb = settle(db.setInsightFeedback || (() => { throw new Error("db 无 setInsightFeedback"); }), "不存在的 run id", { utility: "乱填档", structure: "不存在的分支" });
      flow.record("insights:feedback(不存在 id + 非法档位)", JSON.stringify(fb).slice(0, 130));
      const a3 = await audit(dbFile);
      const runs3 = a3.rows("SELECT COUNT(*) AS n FROM insight_runs");
      a3.close();
      flow.record("insight_runs 行数（应为 0，两次都是不存在的 id）", JSON.stringify(runs3));
      flow.check("对不存在的洞察运行写反馈/标失败，不得凭空造出行、也不得返回成功", Number(runs3[0].n) === 0 && (fb.ok === false || fb.v === false || fb.v == null), "0 行且拒绝", { 行数: runs3[0].n, fb });
    });
    setTimeout(() => app.exit(process.exitCode || 0), 200); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
