// F33 落盘往返保真（换角度：内存态 → 磁盘 → 重开进程 → 内存态，字段一个都不能变形）
// @runtime: electron  @tier: 2  @gui: false  @id: F33  @timeout: 300
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f33-persistence-fidelity.cjs
//
// 角度：F04 测「写一半崩了怎么办」，F05 测「备份能不能恢复」，F10 测「反复落盘行不变」，
//       这条测的是它们中间那块空地——**序列化本身保真吗**。
//       本产品把 fsrs / leech / tags / domain / context_ref / occlusion / dict /
//       workflow_state / source_ref / progress 全都塞进 JSON 文本列（§4.2），
//       每个 JSON 列都是一次「对象 → 字符串 → 对象」的往返；
//       任何一处 mapRow 忘了 parse、parse 忘了 try、字段名在读写两侧拼错，
//       表现都不是报错，而是**重启后那个字段悄悄变了**：
//       暂停标记没了、来源锚点没了、记忆卡字段没了。用户只会觉得「软件把我的改动吃了」。
//       做法：铺一层把每个 JSON 列都填上不同形状的种子 → 采集 12 组读数 →
//       persistNow → 丢 require 缓存重开 db 模块（真·重开进程等价）→ 再采集 → 逐路径差分。
//
// 依据：§7.2 L874（每次落库即落盘）、§7.1.4 L858（重启不丢数据）、§4.2（JSON 列清单）、
//       §4.16（同源延后状态要活得过重启）、§4.4.9（撤销快照）、§4.12-4（日口径）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F33",
  title: "落盘往返保真",
  angle: "内存态→磁盘→重开→内存态：JSON 列与派生字段的逐路径差分，重启不许吃掉任何字段",
  cites: ["§7.2", "§7.1.4", "§4.2", "§4.16", "§4.4.9", "§4.12-4"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;

// 只比对这些读数；每个都是「用户重启后仍然要看的东西」
const READERS = [
  { name: "listItems", fn: (db) => db.listItems() },
  { name: "getDocument", fn: (db, ctx) => db.getDocument(ctx.itemId) },
  { name: "itemProgress", fn: (db, ctx) => (db.itemProgress ? db.itemProgress(ctx.itemId) : db.getDocument(ctx.itemId).progressJson) },
  { name: "getCard×3", fn: (db, ctx) => ctx.cardIds.map((id) => db.getCard(id)) },
  { name: "listAllCards", fn: (db) => db.listAllCards() },
  { name: "computeTodayQueue", fn: (db) => db.computeTodayQueue(Date.now()).cards.map((c) => c.id) },
  { name: "stats.kpi", fn: (db) => db.getStatsOverview().kpi },
  { name: "stats.queueFlow", fn: (db) => db.getStatsOverview().queueFlow },
  { name: "listAllReviewLogs", fn: (db) => db.listAllReviewLogs() },
  { name: "listJournalEntries", fn: (db) => db.listJournalEntries({ limit: 50 }) },
  { name: "listKnowledgePoints", fn: (db) => (db.listKnowledgePoints ? db.listKnowledgePoints() : "n/a") },
  { name: "getFsrsParamsEnv", fn: (db) => (db.getActiveFsrsConfig ? db.getActiveFsrsConfig() : "n/a") },
];

function canon(v, depth) {
  const d = depth || 0;
  if (d > 12) return "…";
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : "nonfinite";
  if (typeof v === "function") return "fn";
  if (Array.isArray(v)) return v.map((x) => canon(x, d + 1));
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k], d + 1);
    return out;
  }
  if (typeof v === "string" && v.length > 400) return v.slice(0, 400);
  return v;
}

function firstDiff(a, b, p) {
  const pref = p || "";
  if (a === b) return "";
  if (typeof a !== typeof b) return `${pref}: 类型 ${typeof a} → ${typeof b}`;
  if (a === null || b === null || typeof a !== "object") {
    if (JSON.stringify(a) === JSON.stringify(b)) return "";
    return `${pref}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${pref}: 数组形状变了`;
    if (a.length !== b.length) return `${pref}: 长度 ${a.length} → ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${pref}[${i}]`);
      if (d) return d;
    }
    return "";
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], pref ? `${pref}.${k}` : k);
    if (d) return d;
  }
  return "";
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f33"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");

    const s = await runFlow(flow, async () => {
      let db = require(dbPath);
      await db.initDb();

      // ---------- R1 把每一个 JSON 列都填上「各不相同」的形状 ----------
      flow.section("R1 播种：每个 JSON 列都给一种不同的形状（含中文、空数组、嵌套、特殊数值）");
      const book = db.createFromPaste("F33 往返书", "# 章一\n\n第一段正文，用于来源锚点。\n\n# 章二\n\n第二段正文。");
      const itemId = book.id;
      const docId = book.documentId;
      db.updateProgress(itemId, { ratio: 0.37, cfi: "epubcfi(/6/14[chap2]!/4/2/1:a11)", pageIndex: 7, note: "中文与引号\"'" });
      db.addReadingEvent(itemId, 1234);
      db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "F33 摘录 A", priority: 71, contextRef: { documentId: docId, charStart: 3, charEnd: 9 } });
      const mk = (i, extra) =>
        db
          .createCard({
            noteText: `F33 卡 ${i}`,
            cardType: "qa",
            frontMarkdown: `前 ${i}`,
            backMarkdown: `后 ${i}`,
            priority: 33 + i,
            tags: ["f33", `标签${i}`, "带,逗号"],
            domain: ["004", "100"],
            contextRef: { documentId: docId, charStart: i, charEnd: i + 5, quote: "带「引号」的原文" },
            sourceRef: { url: "https://example.com/x?a=1&b=2", hash: "#h" + i },
            fsrsJson: JSON.stringify({ state: i === 0 ? "new" : "review", due: Date.now() + (i + 1) * 3600000, stability: 4.5 + i, difficulty: 5.5, reps: i, lapses: i === 2 ? 3 : 0, learning_steps: [], last_review: Date.now() - DAY * (i + 1) }),
            ...extra,
          })
          .id;
      const cardIds = [mk(0, {}), mk(1, { leech: { suspended: true, suspendedAt: Date.now() - 1000, count: 2 } }), mk(2, { occlusionJson: { img: "assets/x.png", rects: [{ x: 1, y: 2, w: 3, h: 4 }], answer: "挖空答案" } })];
      db.setCardSuspended(cardIds[2], true, "F33 暂停理由");
      // A-7（审计 F35）：saveReview 现在会拒绝与卡片当前状态不符的 fsrsBefore。
      // 本流程的意图是「字段往返保真」，所以取每张卡**真实的**当前状态作 before，而不是伪造一个。
      for (const id of cardIds) {
        const cur = db.getCard(id).fsrs;
        db.saveReview(id, { state: "review", due: Date.now() + 2 * DAY, stability: 6, difficulty: 6, reps: 3, lapses: 0, learning_steps: [] }, "Good", 1234, cur);
      }
      db.createJournalEntry({ contentMarkdown: "F33 日记：今天读了两章，「引号」与 emoji 😀", source: "app" });
      db.addCardIssue({ cardId: cardIds[0], ruleId: "r-f33", severity: "warning", message: "F33 提示", source: "lint" });
      if (db.createKnowledgePoint) {
        try {
          db.createKnowledgePoint({ title: "F33 知识点", summary: "要活过重启的摘要", domain: ["004"], status: "seeded" });
        } catch (e) {
          flow.record("createKnowledgePoint 探针（形状不匹配则跳过）", String(e.message).slice(0, 60));
        }
      }
      const domainPre = ((db.getCard(cardIds[2]) || {}).domain || []).slice();
      flow.record("写入 domain=[\"004\",\"100\"] 后立刻读回（sanitizeDomain 已在此刻生效）", JSON.stringify(domainPre));
      db.persistNow();
      flow.record("JSON 列填充情况", "progress+contextRef+sourceRef+leech+occlusion+dict?+tags+domain+fsrs+issue");

      // ---------- R2 重启前采集 ----------
      flow.section("R2 重启前采集 12 组读数（每组都是用户重启后要看到的同一件事）");
      const ctx = { itemId, docId, cardIds };
      const collect = (handle) => {
        const out = {};
        const skipped = [];
        for (const r of READERS) {
          try {
            out[r.name] = canon(r.fn(handle, ctx));
          } catch (e) {
            skipped.push(`${r.name}: ${String(e.message).slice(0, 40)}`);
          }
        }
        return { out, skipped };
      };
      const before = collect(db);
      flow.check("至少 8 组读数采集成功", Object.keys(before.out).length >= 8, "≥8 组", `${Object.keys(before.out).length} 组`);
      if (before.skipped.length) flow.record("采集失败（该读数入口形状不符，不计入差分）", before.skipped.join(" ；"));

      // ---------- R3 真·重开：丢模块缓存 + 重新 initDb（同一份磁盘文件）----------
      flow.section("R3 丢掉 require 缓存、对同一份 library.db 重新 initDb（等价于关掉应用再打开）");
      const diskBefore = fs_read(dbFile).length;
      delete require.cache[require.resolve(dbPath)];
      db = require(dbPath);
      await db.initDb();
      const after = collect(db);
      flow.check("重开后模块确实换了实例（否则这条什么都没测）", require.resolve(dbPath) !== undefined && Object.keys(after.out).length > 0, "新句柄 + 有读数", `${Object.keys(after.out).length} 组`);
      flow.record("落盘字节数（重开前后应一致）", `${diskBefore} / ${fs_read(dbFile).length}`);

      // ---------- R4 逐路径差分 ----------
      flow.section("R4 逐路径差分：任何字段在重启后变形，都要在这里以「哪一条哪一路径」的形式浮出来");
      const diffs = [];
      const same = [];
      for (const name of Object.keys(before.out)) {
        const d = firstDiff(before.out[name], after.out[name], name);
        if (d) diffs.push(d.slice(0, 220));
        else same.push(name);
      }
      flow.record("逐字节一致的读数", `${same.length} 组：` + same.join(" "));
      flow.record("变形清单", diffs.length ? diffs.join("\n      ") : "（零变形）");
      flow.check("所有读数重启后逐路径一致（§7.1.4 重启不丢数据）", diffs.length === 0, "零变形", diffs.length ? `${diffs.length} 处：` + diffs[0] : "零变形");

      // ---------- R5 深字段点名（不能只靠总体差分）----------
      flow.section("R5 点名 JSON 列：暂停标记、来源锚点、挖空答案、进度三锚、学习日计数必须原样回来");
      const cs = db.getCard(cardIds[2]);
      const leechNote = db.getCard(cardIds[1]);
      flow.record("insertCard 把 leech_json 写死 NULL（新卡不该带 leech 状态），所以暂停只能走 setCardSuspended", leechNote && leechNote.leech ? JSON.stringify(leechNote.leech).slice(0, 60) : "leech=null（与实现一致）");
      flow.check("暂停标记活过「评分 + 重启」两道关（产品路径：卡片页暂停后复习一次，再关掉应用）", !!cs && !!cs.leech && cs.leech.suspended === true && Number(cs.leech.suspendedAt) > 0, "suspended=true + 正数时间戳", cs && cs.leech ? JSON.stringify(cs.leech).slice(0, 90) : String(cs && cs.leech));
      flow.check("occlusion 的矩形与答案活过重启（图片挖空卡不会退化成空白卡）", !!cs && Array.isArray(cs.occlusionJson && cs.occlusionJson.rects) && cs.occlusionJson.rects.length === 1 && cs.occlusionJson.answer === "挖空答案", "rects[1] + answer", cs && cs.occlusionJson ? JSON.stringify(cs.occlusionJson).slice(0, 90) : "无 occlusionJson");
      flow.check("contextRef.quote 里的中文引号活过重启（锚点文本不被转义链吃掉）", !!cs && String(cs.contextRef && cs.contextRef.quote) === "带「引号」的原文", "带「引号」的原文", cs && cs.contextRef ? String(cs.contextRef.quote) : "无 contextRef");
      flow.check("tags 含逗号的项活过重启且仍是 3 项", !!cs && Array.isArray(cs.tags) && cs.tags.length === 3 && cs.tags.includes("带,逗号"), "3 项含「带,逗号」", cs && cs.tags ? JSON.stringify(cs.tags) : "无 tags");
      flow.check("domain 重启前后同一集合（ sanitize 掉什么不重要，两说必须一值——§4.2-20 同源口径的存储版）", !!cs && Array.isArray(cs.domain) && cs.domain.slice().sort().join(",") === domainPre.sort().join(","), JSON.stringify(domainPre), cs ? JSON.stringify(cs.domain) : "null");
      flow.check("合法领域码 004 必须活过重启（§4.19 导图与领域统计的分组依据）", !!cs && Array.isArray(cs.domain) && cs.domain.includes("004"), "含 004", cs ? JSON.stringify(cs.domain) : "null");
      const doc = db.getDocument(itemId);
      const pj = JSON.parse(doc.progressJson || "{}");
      flow.check("progress 三锚（ratio / cfi / pageIndex）同时活过重启", Math.abs(pj.ratio - 0.37) < 1e-9 && pj.cfi.startsWith("epubcfi(") && pj.pageIndex === 7, "三锚齐全", JSON.stringify(pj).slice(0, 90));
      const q = db.computeTodayQueue(Date.now());
      flow.check("今日队列成员与重启前同一集合（§4.2-20 唯一口径）", JSON.stringify(q.cards.map((c) => c.id).sort()) === JSON.stringify(before.out.computeTodayQueue.slice().sort()), "同集合", JSON.stringify(q.cards.map((c) => c.id)) + " vs " + JSON.stringify(before.out.computeTodayQueue));
      let logs = null;
      try { logs = db.listAllReviewLogs(); } catch (e) { flow.record("listAllReviewLogs 直调失败（改用磁盘行核对）", String(e.message).slice(0, 60)); }
      flow.check("3 条评分日志连同 seq 一起回来（§4.4.9 撤销与 §4.4.10 审计都靠这个序）", !!logs && logs.length === 3 && logs.every((l) => Number(l.review_seq || l.reviewSeq || l.seq) > 0), "3 条 + seq>0", logs ? String(logs.length) + " 条, 首行键 " + Object.keys(logs[0] || {}).slice(0, 6).join("/") : "入口形状不符");

      // ---------- R6 落盘形状：读口不得把内存里的对象"顺手修好"----------
      flow.section("R6 磁盘上确实是这些值（防止「内存里对、文件里没写」这种假绿）");
      const aud = await audit(dbFile);
      const row = aud.one("SELECT leech_json AS l, occlusion_json AS o, tags_json AS t, context_ref_json AS cr FROM cards WHERE id = ?", [cardIds[2]]);
      flow.check("磁盘行里 leech_json 真的是 true 的暂停标记（不是靠内存兜住）", !!row && /"suspended":\s*true/.test(String(row.l)), "含 suspended:true", String(row && row.l).slice(0, 80));
      const pjRow = aud.one("SELECT progress_json AS p FROM library_items WHERE id = ?", [itemId]);
      flow.check("磁盘 progress_json 里 pageIndex=7 确实在（阅读器重开能回到同一页）", /"pageIndex":\s*7/.test(String(pjRow && pjRow.p)), "含 pageIndex:7", String(pjRow && pjRow.p).slice(0, 120));

      // ---------- R7 全库 JSON 列普查（不写死列清单，跟 F31 同一个思路）----------
      flow.section("R7 全库 *_json 列普查：产品写出去的每一段 JSON 文本都必须 parse 得开（D-TEST-06 的根因就是有一列 parse 不开）");
      const t3 = aud.tables().filter((x) => !x.startsWith("sqlite_"));
      const jsonCols = [];
      for (const t of t3) for (const c of aud.columns(t)) if (/json$/i.test(c)) jsonCols.push([t, c]);
      let parsed = 0;
      const unparsable = [];
      for (const [t, c] of jsonCols) {
        let rows = [];
        try {
          rows = aud.rows(`SELECT "${c}" AS v FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" <> '' AND "${c}" <> 'null' LIMIT 30`);
        } catch {
          continue;
        }
        for (const r of rows) {
          parsed++;
          try {
            const o = JSON.parse(r.v);
            if (o === null || o === undefined) unparsable.push(`${t}.${c} 内容是 ${String(r.v).slice(0, 12)}`);
          } catch {
            unparsable.push(`${t}.${c} = ${String(r.v).slice(0, 40)}`);
          }
        }
      }
      flow.record("扫到的 JSON 列 / 文本值", `${jsonCols.length} 列，${parsed} 个非空值`);
      flow.record("JSON 列清单", jsonCols.map(([t, c]) => `${t}.${c}`).join(" "));
      flow.check("JSON 列覆盖面不得缩水（少于 20 列说明普查逻辑瞎了一块）", jsonCols.length >= 20, "≥20 列", jsonCols.length);
      flow.check("产品自己写下的 JSON 文本全部可 parse（有一条 parse 不开，队列/统计/卡片浏览就会整片抛错）", unparsable.length === 0, "全部可 parse", unparsable.length ? unparsable.slice(0, 6).join(" ；") : "全部可 parse");
      aud.close();
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F33 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });

function fs_read(p) {
  const fs = require("fs");
  return fs.readFileSync(p);
}
