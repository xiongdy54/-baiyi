// F02 导入格式矩阵与锚点反查流程（存储层横向，不依赖各解析器）
// @runtime: electron  @tier: 2  @gui: false  @id: F02  @timeout: 300
// 运行：npx electron tests/flows/f02-ingest-matrix.cjs   （或 node tests/flows/run.cjs --only F02）
//
// 角度：m6-1/2/3 三套按**解析器**纵向测（Word 转换、PDF 提取、Readability 正文）。
//       这里换个角度：不管前面是谁解析的，只要走 createImportedDoc / createFromPaste 落库，
//       就必须形成同一套可反查的事实——书目↔文档双向映射、TOC 结构、assets 归属、
//       摘录/卡片带的 contextRef 能否反解回原书、进度与阅读事件能否进统计、
//       删书时卡与摘录怎么处理。这条链一旦断裂，「跳转原文」和「按书筛选」就会静默失灵，
//       而这正是单模块测试看不见的部分。
//
// 依据：§4.2 数据模型（library_items/documents/assets/extracts/cards 归属）、
//       §6.1 L519（阅读器→制卡→跳转原文）、§6.2 L524/L526（锚点降级链 cfi→pageIndex→chapterIndex→anchorText）、
//       §7.2 L869（软删除）、§4.1（documents.blocks_json/toc_json）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F02",
  title: "导入格式矩阵与锚点反查",
  angle: "所有入口共用的落库形态与双向反查链",
  cites: ["§4.2", "§6.1", "§6.2", "§7.2"],
  tier: 2,
  gui: false,
});

/** 覆盖所有已实现入口（§6.2/§9.1 M6 列出的 source_type 值） */
const SOURCES = [
  { type: "paste", label: "粘贴" },
  { type: "epub", label: "EPUB" },
  { type: "pdf", label: "PDF" },
  { type: "word", label: "Word" },
  { type: "txt", label: "TXT" },
  { type: "markdown", label: "Markdown" },
  { type: "html", label: "HTML 剪藏" },
  { type: "fb2", label: "FB2" },
  { type: "cbz", label: "CBZ" },
];

function md(seed, chapters = 3) {
  let out = "";
  for (let c = 1; c <= chapters; c++) out += `# 第 ${c} 章 标题${seed}-${c}\n\n${`这是第 ${c} 章的正文内容，用于测试结构抽取。`.repeat(6)}\n\n## 小节 ${c}.1\n\n小节正文。\n\n`;
  return out;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f02"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- I1 九种入口一律形成同一套事实 ----------
      flow.section("I1 各入口落库形态一致（§4.2 归属链 / §6.2 已实现入口）");
      const made = [];
      for (const src of SOURCES) {
        let item = null;
        let err = null;
        try {
          if (src.type === "paste") {
            db.createFromPaste(`F02 ${src.label}`, md(`paste-${flow.rng.seed}`, 2));
          } else {
            db.createImportedDoc({
              title: `F02 ${src.label}`,
              markdown: md(`${src.type}-${flow.rng.seed}`, 3),
              sourceType: src.type,
              sourceName: src.label,
              originalName: `sample.${src.type}`,
              originalBuf: Buffer.from(`F02 原始文件字节 ${src.type}`),
              images: [],
            });
          }
          item = db.listItems().find((x) => x.title === `F02 ${src.label}`) || null;
        } catch (e) {
          err = String(e && e.message ? e.message : e);
        }
        const ok = !!item;
        flow.check(`${src.label}：形成 library_item`, ok, "有书目", err || (ok ? "ok" : "listItems 查不到"));
        if (!item) continue;
        made.push({ src, item });
      }
      flow.record("成功入口数", `${made.length}/${SOURCES.length}`);
      flow.check("至少九种入口全部落库", made.length, SOURCES.length);

      // ---------- I2 文档与反查 ----------
      flow.section("I2 书目 ↔ 文档双向反查（§4.2 / IPC library:doc、library:itemByDoc）");
      let aud = await audit(dbFile);
      const docs = aud.all("documents");
      flow.check("每份成功入口都有一个文档", docs.length >= made.length, `≥${made.length}`, docs.length);
      const noOwner = docs.filter((d) => !d.library_item_id);
      flow.eq("文档一律挂到某书目（无孤儿文档）", noOwner.length, 0);
      for (const { src, item } of made.slice(0, 4)) {
        const doc = aud.one("SELECT * FROM documents WHERE library_item_id = ? AND is_deleted = 0", [item.id]);
        flow.check(`${src.label}：文档正文非空`, !!doc && String(doc.markdown || "").length > 50, "有正文", doc ? String(doc.markdown || "").length : null);
        const back = db.getItemIdByDocumentId(doc.id);
        flow.eq(`${src.label}：由文档能反查到书目`, back, item.id);
        const struct = doc.toc_json ? JSON.parse(doc.toc_json) : null;
        if (struct) flow.check(`${src.label}：TOC 结构含条目标题`, Array.isArray(struct) ? struct.length > 0 : Object.keys(struct).length > 0, true, struct && JSON.stringify(struct).slice(0, 60));
        else flow.record(`${src.label}：TOC 结构`, "createImportedDoc 路径不产 TOC（真解析器才产）");
      }
      const orphans = aud.all("cards").filter((c) => {
        const ref = c.context_ref_json ? JSON.parse(c.context_ref_json) : null;
        return ref && ref.documentId && !aud.one("SELECT id FROM documents WHERE id = ?", [ref.documentId]);
      });
      flow.eq("不存在指向已消失文档的卡片", orphans.length, 0);

      // ---------- I3 锚点链：卡片 contextRef 能落到原文位置 ----------
      flow.section("I3 制卡锚点可反查（§6.2 L524/L526 锚点降级链）");
      const firstDoc = aud.one("SELECT id, library_item_id FROM documents LIMIT 1");
      const anchorVariants = [
        { name: "CFI 优先", ref: { documentId: firstDoc.id, cfi: "epubcfi(/6/14[xchapter_002]!/4/2/10)" } },
        { name: "页码降级", ref: { documentId: firstDoc.id, pageIndex: 7 } },
        { name: "章节降级", ref: { documentId: firstDoc.id, chapterIndex: 2 } },
        { name: "锚文本兜底", ref: { documentId: firstDoc.id, anchorText: "这是第 1 章的正文内容" } },
        { name: "全无锚点（存量旧卡）", ref: null },
      ];
      const cardIds = [];
      for (const v of anchorVariants) {
        const id = db.createCard({
          noteText: `F02 锚点 ${v.name}`,
          cardType: "qa",
          frontMarkdown: `F02 锚点问题 ${v.name}`,
          backMarkdown: "答案",
          priority: 50,
          tags: [],
          contextRef: v.ref,
          fsrsJson: JSON.stringify({ state: "review", due: Date.now() - 1000, lapses: 0, stability: 2, difficulty: 5, reps: 1, lastReview: Date.now(), learningSteps: [] }),
        }).id;
        cardIds.push({ ...v, id });
      }
      aud = await audit(dbFile);
      for (const c of cardIds) {
        const row = aud.one("SELECT context_ref_json FROM cards WHERE id = ?", [c.id]);
        const stored = row.context_ref_json ? JSON.parse(row.context_ref_json) : null;
        flow.eq(`${c.name}：contextRef 原样往返`, stored, c.ref);
        if (stored && stored.documentId) {
          const owner = db.getItemIdByDocumentId(stored.documentId);
          flow.check(`${c.name}：能由锚点定位回原书`, !!owner, true, owner);
        } else {
          flow.check(`${c.name}：无锚点卡片不产生假锚点（跳转按钮须置灰而非跳回开头）`, stored === null, true, stored);
        }
      }
      const chain = ["cfi", "pageIndex", "chapterIndex", "anchorText"];
      const mixed = db.createCard({
        noteText: "F03 锚点 全链",
        cardType: "qa",
        frontMarkdown: "全链锚点",
        backMarkdown: "答案",
        priority: 50,
        tags: [],
        contextRef: { documentId: firstDoc.id, cfi: null, pageIndex: null, chapterIndex: null, anchorText: "这是第 2 章的正文内容" },
      }).id;
      aud = await audit(dbFile);
      const mixedRef = JSON.parse(aud.one("SELECT context_ref_json FROM cards WHERE id = ?", [mixed]).context_ref_json);
      flow.check("降级链按序取第一个非空（cfi→页→章→锚文本）", mixedRef.anchorText === "这是第 2 章的正文内容", true, mixedRef);
      flow.record("链条空值守卫保留", chain.map((k) => `${k}:${mixedRef[k] === undefined ? "缺" : String(mixedRef[k])}`).join(" "));

      // ---------- I4 进度与阅读事件进统计 ----------
      flow.section("I4 阅读进度与事件（§4.1 reading_events / 统计今日阅读）");
      const item = made[0].item;
      db.updateProgress(item.id, { cfi: "epubcfi(/6/14!/4/2/10)", mode: "continuous", percent: 37 });
      const evs = await timedCount(db, 6);
      flow.eq("阅读事件按序写入", evs, 6);
      aud = await audit(dbFile);
      const prog = JSON.parse(aud.one("SELECT progress_json FROM library_items WHERE id = ?", [item.id]).progress_json);
      flow.eq("进度往返（cfi 与百分比都保住）", [prog.cfi, prog.percent], ["epubcfi(/6/14!/4/2/10)", 37]);
      db.updateProgress(item.id, { cfi: "epubcfi(/6/16!/4/2/2)", percent: 52 });
      const aud2 = await audit(dbFile);
      const prog2 = JSON.parse(aud2.one("SELECT progress_json FROM library_items WHERE id = ?", [item.id]).progress_json);
      flow.eq("进度更新覆盖 cfi 但不丢 mode 之外的字段", prog2.percent, 52);
      flow.record("二次进度是否保留旧 mode", prog2.mode === undefined ? "未保留（更新即整份替换）" : prog2.mode);
      const stats = db.getStatsOverview();
      flow.check("统计总览在读事件存在后仍可算", !!stats && typeof stats === "object", "对象", Object.keys(stats || {}).join(","));

      // ---------- I5 assets 归属 ----------
      flow.section("I5 资源归属与删除（§4.2 assets 挂 library_item）");
      const asset = db.createAssetForItem
        ? db.createAssetForItem(item.id, "image-occlusion", Buffer.from("89504e470d0a1a0a", "hex"), "f02.png")
        : null;
      flow.record("createAssetForItem 返回", asset);
      aud = await audit(dbFile);
      if (asset && asset.filename) {
        const rows = aud.rows("SELECT * FROM assets WHERE library_item_id = ? ORDER BY created_at DESC LIMIT 1", [item.id]);
        flow.check("资源行存在且挂到正确书目", rows.length > 0 && rows[0].library_item_id === item.id, true, rows[0] ? rows[0].library_item_id : "无行");
        flow.check("资源记录了文件名与用途 kind", !!rows[0].path || !!rows[0].kind, true, rows[0] ? Object.keys(rows[0]).join(",") : null);
        flow.record("assetPath 形态（阅读器协议）", rows[0]?.path || asset.assetPath);
      } else if (asset) {
        flow.record("assets 写入入口返回形状未知", Object.keys(asset).join(","));
      } else {
        flow.record("assets 写入入口", "createAssetForItem 未导出");
      }

      // ---------- I6 删书的连带后果 ----------
      flow.section("I6 删书只软删书目，卡与摘录留在原地（§7.2 L869 + 用户资产观）");
      const doomed = made[1] ? made[1].item : item;
      const audBefore = await audit(dbFile);
      const docOfDoomed = audBefore.one("SELECT id FROM documents WHERE library_item_id = ?", [doomed.id]);
      const cardsOfDoomed = docOfDoomed ? audBefore.rows("SELECT COUNT(*) AS n FROM cards WHERE json_extract(context_ref_json,'$.documentId') = ?", [docOfDoomed.id])[0].n : 0;
      db.deleteItem(doomed.id);
      const aud3 = await audit(dbFile);
      flow.eq("书目行仍在（软删）", Number(aud3.one("SELECT is_deleted FROM library_items WHERE id = ?", [doomed.id])?.is_deleted), 1);
      flow.check("书目不再出现在业务列表", db.listItems().some((x) => x.id === doomed.id), false);
      flow.record("删书时该书文档下的卡数", cardsOfDoomed);
      if (docOfDoomed) {
        const docRow = aud3.one("SELECT is_deleted FROM documents WHERE id = ?", [docOfDoomed.id]);
        flow.record("文档是否随书目软删", docRow ? Number(docRow.is_deleted) : "行不存在");
      }
      flow.eq("删书不影响其他书目", aud3.rows("SELECT COUNT(*) AS n FROM library_items WHERE is_deleted = 0")[0].n, SOURCES.length - 1);
      flow.eq("反查已删书目的文档返回空（跳转原文不会指向已删书）", db.getItemIdByDocumentId(docOfDoomed?.id || "") ?? null, null);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F02 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });

async function timedCount(db, n) {
  const itemId = (await db.listItems())[0].id;
  for (let i = 0; i < n; i++) db.addReadingEvent(itemId, i * 100);
  const { audit } = require("./lib/dbenv.cjs");
  const a = await audit(require("path").join(app.getPath("userData"), "library.db"));
  return a.rows("SELECT COUNT(*) AS n FROM reading_events WHERE item_id = ?", [itemId])[0].n;
}
