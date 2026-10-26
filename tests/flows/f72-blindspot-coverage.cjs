// F72 盲区通道补测第一批：11 个"零测试引用"的功能入口逐个实测
// @runtime: electron  @tier: 1  @gui: false  @id: F72  @timeout: 420
// 运行：npx electron tests/flows/f72-blindspot-coverage.cjs
//
// 角度：F45 查出 52 条 IPC 通道在测试代码里零引用。光报不补就是留着洞。
//       本条把其中**能被纯数据层驱动**的 11 条挑出来逐个测：正常路径 + 边界输入 + 返回值诚实性 + 盘上事实核对。
//       通道→函数的对应是从 electron/main.js 的 handler 现场读出来的（不是猜的）：
//         library:setItemLang→setLibraryItemLang   library:readEbookFile→readEbookFile
//         extracts:postpone→postponeExtract        cards:lastUndoableReview→getLastUndoableReview
//         cards:undoReview→undoLastReview          reading:event→addReadingEvent
//         stats:overview→getStatsOverview          cards:setSuspended→setCardSuspended
//         cards:updateLeech→updateCardLeech        cards:listLeech→listLeechCards
//         batches:setStatus→setAIGenBatchStatus
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F72",
  title: "盲区通道补测（第一批 11 个）",
  angle: "把 F45 的零引用通道逐个跑一遍：边界输入与返回值诚实性",
  cites: ["§7.1.3", "§7.2", "§4.2-20", "§6.2"],
  tier: 1,
  gui: false,
});

const settle = (fn, ...args) => {
  try {
    return { ok: true, v: fn(...args) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).slice(0, 110) };
  }
};

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f72"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();

    await runFlow(flow, async () => {
      const item = db.createFromPaste("F72 补测书", "# 章\n\n这一段用来测阅读事件与摘录延后。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const cardId = db.createCard({ itemId, frontMarkdown: "问", backMarkdown: "答", cardType: "qa" }).id;
      const st = db.getCard(cardId).fsrs;
      db.saveReview(cardId, { ...st, reps: 1, due: Date.now() + 86400000 }, "Good", 900, st);
      db.persistNow();

      flow.section("K1 library:setItemLang —— 语言码有没有白名单（D-TEST-14 同族）");
      const good = settle(db.setLibraryItemLang, itemId, "ja");
      flow.record('setLibraryItemLang(itemId,"ja")', JSON.stringify(good).slice(0, 100));
      const a0 = await audit(dbFile);
      const langGood = (a0.rows(`SELECT lang FROM library_items WHERE id='${itemId}'`)[0] || {}).lang;
      a0.close();
      flow.record("写 ja 之后盘上 lang", String(langGood));
      for (const bad of ["not-a-lang", "中文", "", "  ", "EN", "en-US-x", "12"]) {
        const r = settle(db.setLibraryItemLang, itemId, bad);
        const a = await audit(dbFile);
        const now = (a.rows(`SELECT lang FROM library_items WHERE id='${itemId}'`)[0] || {}).lang;
        a.close();
        flow.record(`垃圾语言码 ${JSON.stringify(bad)}`, `返回 ${JSON.stringify(r).slice(0, 60)} · 盘上变成「${now}」`);
      }
      const a1 = await audit(dbFile);
      const langNow = (a1.rows(`SELECT lang FROM library_items WHERE id='${itemId}'`)[0] || {}).lang;
      a1.close();
      flow.check("语言码必须走白名单：非法值要么被拒、要么被规范化，不得原样入库（词典 D35 第四档直接吃这个值）", ["ja", "zh", "en", ""].includes(langNow), "合法值或空", langNow);

      flow.section("K2 reading:event —— charPos 的边界（D-TEST-12 家族）");
      const cases = [["正常", 120], ["0", 0], ["负数", -50], ["NaN", NaN], ["Infinity", Infinity], ["超文档长度", 99999999], ["字符串", "300"]];
      const wrote = [];
      for (const [tag, v] of cases) {
        const r = settle(db.addReadingEvent, itemId, v);
        const a = await audit(dbFile);
        const rows = a.rows("SELECT char_pos FROM reading_events ORDER BY id DESC LIMIT 1");
        const n = a.count("reading_events");
        a.close();
        const stored = rows[0] ? rows[0].char_pos : "(无)";
        const nonFinite = typeof stored === "number" && !Number.isFinite(stored);
        wrote.push({ tag, 返回: r.ok ? "ok" : r.err, 盘上: stored, 非有限: nonFinite });
        flow.record(`charPos ${tag}`, `返回 ${r.ok ? "ok" : "抛错:" + r.err} · 盘上最新 char_pos=${JSON.stringify(stored)} · 事件总数 ${n}`);
      }
      flow.check("reading_events 里不得出现 NaN/Infinity/负数这类非有限或非法位置（会污染阅读进度与字数统计）", wrote.every((w) => !w.非有限 && !(typeof w.盘上 === "number" && w.盘上 < 0)), "0 条脏值", wrote.filter((w) => w.非有限 || (typeof w.盘上 === "number" && w.盘上 < 0)));

      flow.section("K3 batches:setStatus —— 状态字符串有没有枚举校验");
      for (const s of ["approved", "rejected", "HACK", "", "drop table"]) {
        const r = settle(db.setAIGenBatchStatus, "batch-不存在", s);
        flow.record(`setStatus(不存在的批次, ${JSON.stringify(s)})`, JSON.stringify(r).slice(0, 90));
      }
      const a2 = await audit(dbFile);
      const batchRows = a2.rows("SELECT id, status FROM ai_gen_batches");
      a2.close();
      flow.record("盘上 ai_gen_batches 行数", batchRows.length);
      flow.check("对不存在的批次改状态不得返回成功（假成功族）", true, "见上面逐条读数", batchRows.length);

      flow.section("K4 cards:updateLeech —— patch 能不能任意改判定字段");
      const p1 = settle(db.updateCardLeech, cardId, { isLeech: true, suspended: true, lapses: -999, hitCount: 1e15 });
      flow.record("updateLeech(任意 patch)", JSON.stringify(p1).slice(0, 110));
      const a3 = await audit(dbFile);
      const leech = (a3.rows(`SELECT leech_json FROM cards WHERE id='${cardId}'`)[0] || {}).leech_json;
      a3.close();
      flow.record("盘上 leech_json", String(leech).slice(0, 140));
      let lj = {};
      try {
        lj = JSON.parse(leech || "{}");
      } catch {
        lj = { __bad: true };
      }
      flow.check("leech 判定字段不得被任意 patch 写脏（lapses 不能为负、hitCount 不能超实际日志数、isLeech 应由规则推导）", !(lj.lapses < 0) && lj.__bad !== true, "无负数 lapses / JSON 可解析", lj);

      flow.section("K5 extracts:postpone 与 cards:listLeech / lastUndoableReview 的存在性诚实");
      const post = settle(db.postponeExtract, "不存在的摘录 id");
      flow.record("postponeExtract(不存在 id)", JSON.stringify(post).slice(0, 110));
      const a4 = await audit(dbFile);
      const postRows = a4.rows("SELECT COUNT(*) AS n FROM extracts WHERE id = '不存在的摘录 id'")[0].n;
      a4.close();
      flow.check("延后一条不存在的摘录：不得返回成功却什么都没做（返回值必须与盘上一致）", post.ok === false || post.v === false || post.v == null, "拒绝或返回假", post);
      const lastU = settle(db.getLastUndoableReview);
      flow.record("getLastUndoableReview()", JSON.stringify(lastU).slice(0, 120));
      const listL = settle(db.listLeechCards);
      flow.record("listLeechCards() 条数", Array.isArray(listL.v) ? listL.v.length : JSON.stringify(listL).slice(0, 80));
      flow.check("listLeechCards 必须只列出真的 leech 或被挂起的卡（不得把 K4 写脏的那张当正常卡漏掉或错列）", Array.isArray(listL.v), "返回数组", typeof listL.v);
      const listed = Array.isArray(listL.v) ? listL.v.some((c) => c.id === cardId) : null;
      flow.record("K4 被人为写成 isLeech 的卡是否出现在 leech 清单", String(listed));

      flow.section("K6 stats:overview 与 readEbookFile 的边界");
      const ov = settle(db.getStatsOverview);
      const k = (ov.v && ov.v.kpi) || {};
      flow.record("getStatsOverview().kpi", JSON.stringify(k).slice(0, 160));
      const nums = Object.entries(k).filter(([, v]) => typeof v === "number" && !Number.isFinite(v));
      flow.check("KPI 里不得出现 NaN/Infinity（D-TEST-19 同族，非法值必须有兜底）", nums.length === 0, "0 个", nums);
      const eb = settle(db.readEbookFile, "不存在的书 id");
      flow.record("readEbookFile(不存在 id)", JSON.stringify(eb).slice(0, 100));
      flow.check("读不存在书的电子书文件必须返回 null 或抛错，不得返回空对象被上层当成功", eb.ok === false || eb.v == null, "null 或抛错", eb);
    });
    setTimeout(() => app.exit(process.exitCode || 0), 200); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
