// F31 全库不变量体检（换角度：不测某个功能，测整张库的引用完整性）
// @runtime: electron  @tier: 2  @gui: false  @id: F31  @timeout: 300
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f31-db-invariants.cjs
//
// 角度：前面 30 条都是「沿着一条功能线往里看」，这条反过来：走完一段真实旅程后，
//       把整个库当一张图来体检——外键引用有没有落空、软删位有没有野值、
//       唯一约束有没有被绕过、时间戳有没有跑到未来。表间关系全靠约定维护
//       （sql.js 没开 FK），所以这类破损**不会有任何报错**，只会在很远的位置
//       以「卡片来源为空」「统计对不上」的形式浮出来。
//       这条不写死表清单：运行时从 pragma 里读表与列，凡是带 *_id 的引用列都反查父表。
//
// 口径（避免与既定决策打架）：
//   · 「父行不存在」= 真破损，判红。
//   · 「父行存在但已软删」= §6.2 既定行为（删书时卡与摘录留在原地），只记录不判红。
//   · 唯一例外：assets（材料字节）随书走 —— 见 D-TEST-18。
//
// 依据：§4.2 全表约定（软删除 is_deleted、id 为 UUID）、§4.1 唯一索引与指纹、
//       §7.2（数据完整性 / 软删除）、§4.2-20（同源读数）、§9.1 M15（引用完整性）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F31",
  title: "全库不变量体检",
  angle: "走完旅程后把整库当图体检：悬空引用、软删野值、唯一约束、未来时间戳",
  cites: ["§4.2", "§4.1", "§7.2", "§4.2-20", "§9.1 M15"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;
const fsrsState = (over) =>
  JSON.stringify({ state: "review", due: Date.now(), lapses: 0, stability: 5, difficulty: 6, reps: 2, lastReview: Date.now() - DAY, learningSteps: [], ...over });
// 引用列 → 父表（运行时只反查这里点名、且库里确实存在的表）
const PARENT_OF = {
  library_item_id: "library_items",
  document_id: "documents",
  card_id: "cards",
  item_id: "library_items",
  knowledge_point_id: "knowledge_points",
  source_id: "dict_sources",
};
// 多态引用：靠兄弟列决定父表（§4.2 extracts.parent_type）
const POLY = [{ table: "extracts", discriminator: "parent_type", column: "parent_id", map: { extract: "extracts", document: "documents", library_item: "library_items" } }];

function refScan(aud, tables, colsOf, mode) {
  // mode = "missing"：父行根本不存在（真破损）
  // mode = "softdeleted"：父行存在但 is_deleted=1（既定行为，看有多少）
  const hits = [];
  const checked = [];
  for (const t of tables) {
    if (t.startsWith("sqlite_") || t === "schema_migrations") continue;
    const selfSoft = colsOf(t).includes("is_deleted");
    for (const c of colsOf(t)) {
      const parent = PARENT_OF[c];
      if (!parent || !tables.includes(parent)) continue;
      const parentSoft = colsOf(parent).includes("is_deleted");
      // 子查询按模式切换：missing = 父行根本不存在；softdeleted = 父行存在但已软删
      const cond =
        mode === "missing"
          ? `NOT EXISTS (SELECT 1 FROM "${parent}" p WHERE p.id = t0."${c}")`
          : parentSoft
            ? `EXISTS (SELECT 1 FROM "${parent}" p WHERE p.id = t0."${c}" AND p.is_deleted = 1)`
            : `0`;
      const live = selfSoft ? `t0.is_deleted = 0 AND ` : ``;
      let n = 0;
      let samples = [];
      try {
        n = Number(aud.one(`SELECT COUNT(*) AS n FROM "${t}" t0 WHERE ${live}t0."${c}" IS NOT NULL AND t0."${c}" <> '' AND ${cond}`).n);
        if (n) samples = aud.rows(`SELECT t0."${c}" AS v FROM "${t}" t0 WHERE ${live}t0."${c}" IS NOT NULL AND t0."${c}" <> '' AND ${cond} LIMIT 2`).map((x) => String(x.v).slice(0, 8));
      } catch (e) {
        checked.push(`${t}.${c} 跳过(${String(e.message).slice(0, 24)})`);
        continue;
      }
      checked.push(`${t}.${c}→${parent}`);
      if (n) hits.push(`${t}.${c} 有 ${n} 行指向${mode === "missing" ? "不存在的" : "已软删的"} ${parent}${samples.length ? " 样本 " + samples.join("/") : ""}`);
    }
  }
  // 多态引用：按 parent_type 分发到不同父表
  for (const p of POLY) {
    if (!tables.includes(p.table)) continue;
    const rows = aud.rows(`SELECT "${p.discriminator}" AS d, COUNT(*) AS n FROM "${p.table}" GROUP BY 1 ORDER BY 2 DESC`);
    for (const r of rows) {
      const dt = String(r.d);
      const parent = p.map[dt];
      if (!parent || !tables.includes(parent)) {
        hits.push(`${p.table}.${p.discriminator}='${dt}' 有 ${r.n} 行（未在点名表内，无法反查 ${p.column}）`);
        continue;
      }
      const selfSoft = colsOf(p.table).includes("is_deleted") ? `${p.table}.is_deleted = 0 AND ` : ``;
      const sub =
        mode === "missing"
          ? `SELECT COUNT(*) AS n FROM "${p.table}" WHERE ${selfSoft}"${p.column}" IS NOT NULL AND "${p.column}" <> '' AND "${p.discriminator}" = ? AND "${p.column}" NOT IN (SELECT id FROM "${parent}")`
          : `SELECT COUNT(*) AS n FROM "${p.table}" WHERE ${selfSoft}"${p.column}" IS NOT NULL AND "${p.column}" <> '' AND "${p.discriminator}" = ? AND "${p.column}" IN (SELECT id FROM "${parent}" WHERE is_deleted = 1)`;
      let n = 0;
      try {
        n = Number(aud.one(sub, [dt]).n);
      } catch {
        continue;
      }
      checked.push(`${p.table}.${p.column}→${parent}(当 ${p.discriminator}='${dt}')`);
      if (n) hits.push(`${p.table}.${p.column} 有 ${n} 行（${p.discriminator}='${dt}'）指向${mode === "missing" ? "不存在的" : "已软删的"} ${parent}`);
    }
  }
  return { hits, checked };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f31"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- J1 播种一段真实旅程，让每张表都有活体数据 ----------
      flow.section("J1 播种一段真实旅程（导入 → 摘录 → 制卡 → 评分 → 日记 → 进度 → 资源）");
      const book = db.createFromPaste("F31 旅程书", "# 第一章\n\n渐进阅读的正文段落。\n\n# 第二章\n\n更多正文。");
      const item = db.listItems().find((i) => i.id === book.id) || db.listItems()[0];
      const doc = db.getDocument(item.id);
      const docId = doc && doc.documentId;
      flow.check("旅程种子确实拿到 documentId（getDocument 返回 documentId 而非 id）", typeof docId === "string" && docId.length > 10, "documentId 字符串", String(docId));
      db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "F31 摘录：结构决定阅读节奏", priority: 70 });
      const cardIds = [];
      for (let i = 0; i < 6; i++) {
        cardIds.push(
          db
            .createCard({
              noteText: `F31 卡 ${i}`,
              cardType: "qa",
              frontMarkdown: `问 ${i}`,
              backMarkdown: `答 ${i}`,
              priority: 40 + i,
              tags: ["f31"],
              siblingKey: i < 3 ? "act:f31" : null,
              fsrsJson: fsrsState({ due: Date.now() - (i + 1) * 1000 }),
              contextRef: { documentId: docId },
            })
            .id
        );
      }
      cardIds.forEach((id, i) => {
        const c = db.getCard(id);
        db.saveReview(id, { ...c.fsrs, due: Date.now() + DAY, reps: c.fsrs.reps + 1 }, i % 2 === 0 ? "Good" : "Again", 600, c.fsrs);
      });
      db.createJournalEntry({ contentMarkdown: "F31 日记：今天把两章读完了", source: "app" });
      db.addReadingEvent(item.id, 0);
      db.addReadingEvent(item.id, 800);
      db.addCardIssue({ cardId: cardIds[0], ruleId: "f31-audit", severity: "info", message: "F31 冲突观察", source: "lint" });
      db.addCardIssue({ cardId: cardIds[1], ruleId: "f31-audit", severity: "warning", message: "F31 将被连带收口的 issue", source: "lint" });
      db.createAssetForItem(item.id, "image-occlusion", "png", Buffer.from("89504e470d0a1a0a", "hex"));
      db.setCardSuspended(cardIds[5], true);
      db.persistNow();
      const charsSum = (o) => ((o && o.readingDays) || []).reduce((a, d) => a + (Number(d && d.chars) || 0), 0);
      const beforeChars = charsSum(db.getStatsOverview());

      const aud = await audit(dbFile);
      const tables = aud.tables();
      const colsOf = (t) => aud.columns(t).map((c) => (typeof c === "string" ? c : c.name));
      const withRows = tables.filter((t) => aud.count(t) > 0);
      flow.record("表覆盖", `${withRows.length} / ${tables.length} 张表有行`);
      flow.record("有数据的表", withRows.map((t) => `${t}=${aud.count(t)}`).join(" "));
      flow.check("旅程确实在多张表留下行（说明这条体检真的扫到了活体数据）", withRows.length >= 8, "≥8 张表", `${withRows.length} 张`);

      // ---------- J2 悬空引用（父行根本不存在）----------
      flow.section("J2 每个 *_id 引用列都必须指得到父表（sql.js 不开 FK，全靠约定维护）");
      const missing = refScan(aud, tables, colsOf, "missing");
      flow.record("反查过的引用列", `${missing.checked.length} 处：` + missing.checked.join(" "));
      flow.check("不得有指向不存在父行的活记录", missing.hits.length === 0, "零悬空", missing.hits.length ? missing.hits.join(" ；") : "零悬空");
      flow.check("引用列覆盖面足够（至少扫到 6 处跨表引用）", missing.checked.length >= 6, "≥6 处", missing.checked.length);

      // ---------- J3 软删位与唯一约束 ----------
      flow.section("J3 is_deleted 只能是 0/1；文档点名的唯一约束不得被绕过（§4.2 / §4.1 指纹去重）");
      const wild = [];
      let softCols = 0;
      for (const t of tables) {
        if (!colsOf(t).includes("is_deleted")) continue;
        softCols++;
        const bad = aud.rows(`SELECT is_deleted AS v, COUNT(*) AS n FROM "${t}" WHERE is_deleted IS NULL OR is_deleted NOT IN (0,1) GROUP BY 1`);
        if (bad.length) wild.push(`${t}: ${bad.map((b) => `${JSON.stringify(b.v)}×${b.n}`).join(" ")}`);
      }
      flow.record("带软删位的业务表数", String(softCols));
      flow.check("所有业务表的软删位都是合法值", wild.length === 0, "只有 0/1", wild.length ? wild.join(" ；") : "只有 0/1");
      const dupFingerprint = aud.rows("SELECT config_fingerprint AS f, COUNT(*) AS n FROM fsrs_configs GROUP BY 1 HAVING n > 1");
      flow.eq("同一 FSRS 参数指纹只能有一个 config 行（§4.1 指纹去重）", dupFingerprint.length, 0);
      const dupPk = [];
      let pkTables = 0;
      for (const t of tables) {
        if (!colsOf(t).includes("id")) continue;
        pkTables++;
        const n = Number(aud.one(`SELECT COUNT(*) AS n FROM (SELECT id, COUNT(*) AS c FROM "${t}" GROUP BY id HAVING c > 1)`).n || 0);
        if (n) dupPk.push(`${t}:${n}`);
      }
      flow.record("有 id 列、可查主键重复的表数", String(pkTables));
      flow.check("任何表都不得有重复 id（主键完整性）", dupPk.length === 0, "无重复", dupPk.join(" "));
      const dupSeq = aud.rows("SELECT review_seq AS s, COUNT(*) AS n FROM review_logs GROUP BY 1 HAVING n > 1");
      flow.eq("review_seq 全局唯一（§4.4.9 撤销定位靠它）", dupSeq.length, 0);

      // ---------- J4 时间戳合理性 ----------
      flow.section("J4 时间戳不得是 0/未来/离谱过去（§7.2 数据完整性、§4.12-4 学习日口径）");
      const now = Date.now();
      const timeBad = [];
      const timeCols = [];
      for (const t of tables) {
        for (const c of colsOf(t)) {
          if (!/(created_at|updated_at|_at|timestamp)$/.test(c)) continue;
          let n;
          try {
            n = Number(aud.one(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" <> 0 AND ("${c}" < 100000000000 OR "${c}" > ?)`, [now + DAY]).n);
          } catch {
            continue;
          }
          timeCols.push(`${t}.${c}`);
          if (n) {
            const sample = aud.rows(`SELECT "${c}" AS v FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" <> 0 AND ("${c}" < 100000000000 OR "${c}" > ?) LIMIT 2`, [now + DAY]).map((r) => r.v);
            timeBad.push(`${t}.${c} 有 ${n} 行不在合理区间，样本 ${sample.join("/")}`);
          }
        }
      }
      flow.record("扫过的时间戳列数", String(timeCols.length));
      flow.check("全部时间戳列都在合理区间（毫秒级、不早于 2001、不晚于明天）", timeBad.length === 0, "全部合理", timeBad.length ? timeBad.join(" ；") : "全部合理");

      // ---------- J5 删除动作之后 ----------
      flow.section("J5 删一本书 + 删一张卡：谁该跟着消失，谁按既定决策留在原地");
      const victim = item.id;
      const beforeCards = Number(aud.one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").n);
      db.deleteItem(victim);
      db.deleteCard(cardIds[1]);
      db.persistNow();
      const aud2 = await audit(dbFile);
      const assetRows = aud2.rows("SELECT is_deleted AS d, COUNT(*) AS n FROM assets GROUP BY 1");
      flow.record("assets 软删位分布", assetRows.map((r) => `${r.d}×${r.n}`).join(" ") || "（空表）");
      flow.check(
        "删书要把它的 assets 一并标记（否则备份与同步永久带着已删材料的字节）",
        assetRows.every((r) => Number(r.d) === 1),
        "全部标记",
        assetRows.map((r) => `is_deleted=${r.d}×${r.n}`).join(" ")
      );
      const stillAlive = db.getCard(cardIds[0]) ? true : false;
      flow.check("删书后这张书的卡仍可读（§6.2 既定决策：卡与摘录留在原地，与 F28 X6 同口径）", stillAlive === true, "getCard 仍返回", stillAlive);
      flow.check("deleteCard 确实把目标卡摘掉", db.getCard(cardIds[1]) === null, "getCard 返回 null", String(db.getCard(cardIds[1])));
      const afterCards = Number(aud2.one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").n);
      flow.eq("活卡数只少了被显式删除的那一张", beforeCards - afterCards, 1);
      const softDel = refScan(aud2, tables, colsOf, "softdeleted");
      flow.record("指向已软删父行的活记录", softDel.hits.length ? softDel.hits.join(" ；") : "（无）");
      const missingAfter = refScan(aud2, tables, colsOf, "missing");
      flow.check("删除动作不得制造出指向不存在父行的活记录", missingAfter.hits.length === 0, "零悬空", missingAfter.hits.length ? missingAfter.hits.join(" ；") : "零悬空");
      const issDeleted = aud2.rows("SELECT status AS s, COUNT(*) AS n FROM card_issues WHERE card_id = ? GROUP BY 1", [cardIds[1]]);
      const issAlive = aud2.rows("SELECT status AS s, COUNT(*) AS n FROM card_issues WHERE card_id = ? GROUP BY 1", [cardIds[0]]);
      flow.record("被删卡的 issue 状态", issDeleted.map((r) => `${r.s}×${r.n}`).join(" ") || "（无）");
      flow.record("存活卡的 issue 状态", issAlive.map((r) => `${r.s}×${r.n}`).join(" ") || "（无）");
      flow.check(
        "删卡时它的 open issue 一并置为 dismissed（deleteCard 承诺收口，不留幽灵待办）",
        issDeleted.length === 1 && issDeleted[0].s === "dismissed" && Number(issDeleted[0].n) === 1,
        "dismissed×1",
        issDeleted.map((r) => `${r.s}×${r.n}`).join(" ")
      );
      flow.check(
        "没被删的卡，其 issue 保持 open（收口不得越界）",
        issAlive.length === 1 && issAlive[0].s === "open",
        "open×1",
        issAlive.map((r) => `${r.s}×${r.n}`).join(" ")
      );
      const docSoft = aud2.rows("SELECT is_deleted AS d, COUNT(*) AS n FROM documents WHERE library_item_id = ? GROUP BY 1", [victim]);
      flow.check(
        "删书要把它的 documents 一并软删（deleteItem 承诺：正文随行、卡与摘录留在原地）",
        docSoft.length === 1 && Number(docSoft[0].d) === 1,
        "is_deleted=1",
        docSoft.map((r) => `is_deleted=${r.d}×${r.n}`).join(" ")
      );
      const evAfter = Number(aud2.one(`SELECT COUNT(*) AS n FROM reading_events WHERE item_id = ?`, [victim]).n);
      flow.record("删书后残留的阅读事件行数", String(evAfter));
      const afterChars = charsSum(db.getStatsOverview());
      flow.record("成长面板阅读字数（删书前 → 删书后）", `${beforeChars} → ${afterChars}`);
      // 批次 B（D-TEST-23）新增：只修日桶不加过滤，已删书的字节会立刻开始计入成长面板（互相掩盖）。
      // victim 的夹具是 addReadingEvent(0) → addReadingEvent(800)，按「相邻正增量之和」口径它就是 800 字。
      flow.eq("删书后该书的阅读字节必须从 readingDays 消失", beforeChars - afterChars, 800);
      flow.eq("删书后成长面板仍可读（不得因过滤而抛）", Number.isFinite(afterChars), true);
      // 统计侧的取数 SQL：getStatsOverview 的 readRows 完全不问 is_deleted —— §7.2 L869 要求「查询一律带 is_deleted = 0」
      const nOrphan = Number(
        aud2.one("SELECT COUNT(*) AS n FROM reading_events WHERE item_id IN (SELECT id FROM library_items WHERE is_deleted = 1)").n
      );
      flow.known(
        "阅读字数的取数集合里不得有已删书的事件（§7.2：查询一律带 is_deleted=0）",
        nOrphan === 0,
        "D-TEST-23",
        "0 行",
        `${nOrphan} 行`
      );

      // ---------- J6 context_ref 反查 ----------
      flow.section("J6 卡上的 context_ref_json 必须还能解析回来源（§4.2 上下文引用）");
      const ctx = aud2.rows("SELECT id, context_ref_json AS j FROM cards WHERE context_ref_json IS NOT NULL AND context_ref_json <> ''");
      let ctxBad = [];
      for (const r of ctx) {
        let o = null;
        try {
          o = JSON.parse(r.j);
        } catch {
          ctxBad.push(`${String(r.id).slice(0, 8)} 非 JSON`);
          continue;
        }
        const idOf = o && (o.documentId || o.libraryItemId || o.extractId);
        if (!idOf) continue;
        const tbl = o.documentId ? "documents" : o.extractId ? "extracts" : "library_items";
        const found = aud2.one(`SELECT COUNT(*) AS n FROM "${tbl}" WHERE id = ?`, [idOf]);
        if (!found || Number(found.n) === 0) ctxBad.push(`${String(r.id).slice(0, 8)} 的 ${tbl} 来源不存在`);
      }
      flow.record("带 context_ref 的卡数", String(ctx.length));
      flow.check("卡上记录的来源都反查得到", ctxBad.length === 0, "全部可反查", ctxBad.length ? ctxBad.join(" ；") : "全部可反查");
      aud2.close();
      aud.close();

      // ---------- J7 空库端 ----------
      flow.section("J7 新装库全表扫描（出厂状态不得自带野值）");
      delete require.cache[require.resolve(path.join(ROOT, "electron", "db.js"))];
      const dir2 = freshDir(tmpUserDataDir("f31-empty"));
      app.setPath("userData", dir2);
      const db2 = require(path.join(ROOT, "electron", "db.js"));
      await db2.initDb();
      db2.persistNow();
      const aud3 = await audit(path.join(dir2, "library.db"));
      // 出厂播种白名单：prompt_templates（内置提示词）、fsrs_configs（当前参数指纹）、
      // knowledge_domains（§4.19 内置领域树）、users（§4.2 所有业务行都挂 'local-user'，必须有这行）、
      // op_counter（v48.22 / D58 §4.1：全局操作序计数器，单行、必须存在，否则首写回落 MAX(review_seq)+1）
      const SEED_OK = /^prompt_templates$|^fsrs_configs$|^knowledge_domains$|^users$|^op_counter$/;
      const emptyBad = [];
      for (const t of aud3.tables()) {
        if (t.startsWith("sqlite_")) continue;
        if (aud3.count(t) !== 0 && !SEED_OK.test(t)) emptyBad.push(`${t} 出厂就有 ${aud3.count(t)} 行（播种白名单除外）`);
      }
      flow.check("除播种表外，新装库里没有预置数据", emptyBad.length === 0, "干净", emptyBad.length ? emptyBad.join(" ；") : "干净");
      flow.record("出厂播种表", aud3.tables().filter((t) => aud3.count(t) > 0).map((t) => `${t}=${aud3.count(t)}`).join(" ") || "（无）");
      const userRows = aud3.rows("SELECT id FROM users");
      flow.eq("users 出厂恰好 1 行（业务行的 user_id 全靠它）", Number(userRows.length), 1);
      flow.check(
        "该行 id 就是代码里写死的 'local-user'（§4.2：所有 INSERT 都绑定 'local-user'）",
        userRows.length === 1 && String(userRows[0].id) === "local-user",
        "id=local-user",
        userRows.map((r) => r.id).join(",")
      );
      flow.eq("新装库与旅程库表结构一致（建表不依赖数据）", aud3.tables().length, tables.length);
      aud3.close();
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F31 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
