// F13 异常输入与数据卫生流程（换角度：把脏数据当对手）
// @runtime: electron  @tier: 2  @gui: false  @id: F13  @timeout: 300
// 运行：npx electron tests/flows/f13-adversarial-input.cjs   （或 node tests/flows/run.cjs --only F13）
//
// 角度：其余流程都喂「合法输入」。但这份库是用户的资产，它会经历旧版本残留、
//       手工改文件、磁盘写坏、AI 吐畸形 JSON、用户手改 settings.json。
//       §7.2 / §4.2-20 对这些有硬承诺：损坏行在队列与统计里**一致跳过**、
//       updateCard 不传 fsrs/leech 时**保留原值**（v12 修过的 F6）、权重非法**拒绝应用**、
//       设置非法**回落默认**。既有套件几乎没走过这些负向路径。
//
// 依据：§7.2 L869–874、§4.2-20 L145/L330、§7.4 L900、§4.16 额度矩阵、§6.5 L733、§4.18 L358、§7.5。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F13",
  title: "异常输入与数据卫生",
  angle: "脏数据、越界值、旧版本残留下的健壮性",
  cites: ["§7.2", "§4.2-20", "§7.4", "§4.16", "§6.5", "§4.18", "§7.5"],
  tier: 2,
  gui: false,
});

const now = () => Date.now();
function writeSettings(dir, patch) {
  const f = path.join(dir, "settings.json");
  let obj = {};
  try {
    obj = JSON.parse(fs.readFileSync(f, "utf8")) || {};
  } catch {
    obj = {};
  }
  for (const [k, v] of Object.entries(patch)) {
    const [scope, key] = k.split(".");
    obj[scope] = { ...(obj[scope] || {}), [key]: v };
  }
  fs.writeFileSync(f, JSON.stringify(obj));
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f13"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const dbPath = path.join(ROOT, "electron", "db.js");
      const open = async () => {
        delete require.cache[dbPath];
        const m = require(dbPath);
        await m.initDb();
        return m;
      };
      let db = await open();
      const J = require(path.join(ROOT, "electron", "journalTime.js"));
      const OPT = require(path.join(ROOT, "electron", "optimizer.js"));

      const mk = (label, extra = {}) =>
        db.createCard({
          noteText: `F13 ${label}`,
          cardType: "qa",
          frontMarkdown: `F13 问题 ${label}`,
          backMarkdown: `F13 答案 ${label}`,
          priority: 50,
          tags: [],
          fsrsJson: JSON.stringify({ state: "review", due: now() - 1000, lapses: 0, stability: 3, difficulty: 6, reps: 1, lastReview: now() - 86400000, learningSteps: [] }),
          ...extra,
        }).id;

      // ---------- P1 损坏 JSON ----------
      flow.section("P1 损坏 JSON 列：逐列矩阵（10 列）+ 致命列一致跳过 + 非致命列不得少卡");
      const okCard = mk("健康卡");
      // 逐列一张卡：损坏只发生在该列，读口的表现才能归因到那一列
      const badIds = {
        fsrs_json: mk("坏fsrs"),
        leech_json: mk("坏leech"),
        tags_json: mk("坏tags"),
        context_ref_json: mk("坏contextRef"),
        cloze_ords: mk("坏clozeOrds"),
        source_ref_json: mk("坏sourceRef"),
        domain: mk("坏domain"),
        occlusion_json: mk("坏occlusion"),
        dict_json: mk("坏dict"),
        memory_ref_json: mk("坏memoryRef"),
      };
      // ⚠️ 每档都必须是**真·解析失败**的文本：原 tags 档 '"不是数组"' 是合法 JSON（字符串），
      // 走不到 parse 抛错那条分支（批次 A §K2-6 要守的就是那条分支）。
      const corrupt = {
        fsrs_json: '{"state":"review", due:',
        leech_json: "not json at all",
        tags_json: '["未闭合',
        context_ref_json: "[1,2,",
        cloze_ords: "[0,",
        source_ref_json: "{title:",
        domain: '["51"',
        occlusion_json: '{"rects":[',
        dict_json: '{"word"',
        memory_ref_json: "{line:",
      };
      const restore = {
        fsrs_json: null, leech_json: null, tags_json: "[]", context_ref_json: null, cloze_ords: "[]",
        source_ref_json: null, domain: null, occlusion_json: null, dict_json: null, memory_ref_json: null,
      };
      /** 把库恢复到「只有 cols 这几列损坏」的状态并重开 db（cols 为空 = 全部干净） */
      async function setCorrupt(cols) {
        const a = await audit(dbFile);
        for (const c of Object.keys(corrupt)) a.exec(`UPDATE cards SET ${c} = ?`, [restore[c]]);
        for (const c of cols) a.exec(`UPDATE cards SET ${c} = ? WHERE id = ?`, [corrupt[c], badIds[c]]);
        a.save();
        a.close();
        return open();
      }
      const probeOut = {};
      const probe = (label) => {
        const out = {};
        for (const fn of ["computeTodayQueue", "getStatsOverview", "listAllCards"]) {
          try {
            out[fn] = db[fn]() && "ok";
          } catch (e) {
            out[fn] = "THROW:" + String((e && e.message) || e).slice(0, 34);
          }
        }
        flow.record(label, Object.entries(out).map(([k, v]) => `${k}=${v === "ok" ? "ok" : "崩"}`).join(" "));
        return out;
      };
      db = await setCorrupt(Object.keys(corrupt));
      const first = probe("十列同时损坏时");
      flow.check("损坏行不导致队列抛异常（§4.2-20 L330 承诺一致跳过）", first.computeTodayQueue === "ok", "ok", first.computeTodayQueue);
      flow.check("损坏行不导致统计抛异常", first.getStatsOverview === "ok", "ok", first.getStatsOverview);
      flow.check("损坏行不导致卡片浏览抛异常", first.listAllCards === "ok", "ok", first.listAllCards);
      // 逐列定位：到底是哪一列打断整块读（决定这是「一处漏兜底」还是「普遍不兜底」）
      const perCol = {};
      const colAllThree = {};
      for (const col of Object.keys(corrupt)) {
        db = await setCorrupt([col]);
        colAllThree[col] = probe(`只有 ${col} 损坏时`);
        perCol[col] = colAllThree[col].computeTodayQueue === "ok" ? "ok" : "崩";
        flow.record(`只有 ${col} 损坏时队列`, perCol[col]);
      }
      db = await setCorrupt([]);
      flow.check("fsrs_json 损坏确实被跳过（文档那半句成立）", perCol.fsrs_json === "ok", "ok", perCol.fsrs_json);
      const hardCols = Object.entries(perCol).filter(([, v]) => v === "崩").map(([c]) => c);
      flow.check(
        "其余 JSON 列损坏也必须跳过而不是打断整块读（§4.2-20 L330 承诺的是「一致跳过」）",
        hardCols.length === 0,
        "全部跳过",
        hardCols
      );
      // §K2-2 专测 SQL 层守卫：坏 JSON 打到 json_extract 上是 SQLite 抛 malformed JSON，
      // 只修 JS 层（mapCardRow）三处仍然全崩——这条断言就是为了拦住"只改一半"。
      const sqlCols = ["context_ref_json", "leech_json", "tags_json", "fsrs_json"];
      const sqlThrows = [];
      for (const col of sqlCols) {
        for (const [fn, got] of Object.entries(colAllThree[col])) {
          if (got !== "ok") sqlThrows.push(`${col}×${fn}：${got}`);
        }
      }
      flow.check("JSON 列损坏时队列/统计/卡片浏览的 SQL 路径一律不抛（json_valid 守卫）", sqlThrows.length === 0, "全部不抛", sqlThrows);
      db = await setCorrupt(["context_ref_json"]);
      const ctxCard = db.getCard(badIds.context_ref_json);
      flow.eq("损坏列名可观测（damagedColumns 记录 context_ref_json）", JSON.stringify(ctxCard.damagedColumns), JSON.stringify(["context_ref_json"]));
      flow.eq("来源引用损坏不是致命列 → damaged=false", ctxCard.damaged, false);
      flow.check("来源引用损坏的卡仍在卡片浏览里（有出口）", db.listAllCards().some((c) => c.id === badIds.context_ref_json), true, "该行不见了");
      // §K2-3 致命列（fsrs_json）：队列与统计同时缺席，但 getCard 仍取得到——先取干净态做对照
      const dbClean = await setCorrupt([]);
      const clean = { kpi: dbClean.getStatsOverview().kpi.dueToday, queue: dbClean.computeTodayQueue().cards.length };
      db = await setCorrupt(["fsrs_json"]);
      const fsrsQueue = db.computeTodayQueue();
      const fsrsKpi = db.getStatsOverview().kpi.dueToday;
      flow.eq("fsrs_json 损坏：队列少一张（与统计同口径）", fsrsQueue.cards.length, clean.queue - 1);
      flow.eq("fsrs_json 损坏：KPI 今日到期同步少一张", fsrsKpi, clean.kpi - 1);
      flow.check("fsrs_json 损坏的卡不在队列成员里", !fsrsQueue.cards.some((c) => c.id === badIds.fsrs_json), true, "仍在队列");
      flow.check("fsrs_json 损坏的卡经 computeTodayQueue().damaged 可见（静默但不隐形）", fsrsQueue.damaged.some((c) => c.id === badIds.fsrs_json), true, fsrsQueue.damaged.map((c) => c.id));
      flow.check("fsrs_json 损坏的卡仍能在卡片浏览取得到（可删、有出口）", !!db.getCard(badIds.fsrs_json) && db.listAllCards().some((c) => c.id === badIds.fsrs_json), true, "取不到 = 用户丢卡");
      // §K2-6 非致命列不得牵连可见性（否则 A2 被修成"任何一列坏就少一张卡"）
      db = await setCorrupt(["tags_json"]);
      const tagsQueue = db.computeTodayQueue();
      flow.check("仅 tags_json 损坏（非致命列）的卡必须仍出现在今日队列里", tagsQueue.cards.some((c) => c.id === badIds.tags_json), true, "被过度跳过：卡片从队列消失");
      flow.eq("仅非致命列损坏时 damaged 为空", tagsQueue.damaged.length, 0);
      flow.eq("损坏的 tags 回落空数组而不是抛", JSON.stringify(db.getCard(badIds.tags_json).tags), JSON.stringify([]));
      db = await setCorrupt([]);
      // 出口：脏行能不能被清掉从而自愈（用户视角：卡片浏览页也崩 = 没有出口）
      let recovered = "未测";
      try {
        for (const id of Object.values(badIds)) db.deleteCard(id);
        db.computeTodayQueue();
        db.getStatsOverview();
        db.listAllCards();
        recovered = "删掉脏行后三处恢复";
      } catch (e) {
        recovered = "deleteCard 也走不通：" + String((e && e.message) || e).slice(0, 40);
      }
      flow.record("自愈路径", recovered);
      flow.check("存在数据层自愈路径（deleteCard 本身不受脏行影响）", recovered === "删掉脏行后三处恢复", "删掉脏行后三处恢复", recovered);

      // ---------- P2 updateCard 保位 ----------
      flow.section("P2 updateCard 未传 fsrs/leech 时保留原值（§7.2 L871）");
      const p2 = mk("保位卡");
      const before2 = db.getCard(p2);
      db.updateCard({ id: p2, noteText: "F13 改过标题", cardType: "qa", frontMarkdown: "新题面", backMarkdown: "新答案", priority: 60, tags: ["x"] });
      const after2 = db.getCard(p2);
      flow.eq("fsrs 未被置 NULL", JSON.stringify(after2.fsrs), JSON.stringify(before2.fsrs));
      flow.eq("leech 原值保留", JSON.stringify(after2.leech), JSON.stringify(before2.leech));
      db.updateCard({ ...after2, fsrs: { ...after2.fsrs, reps: 99 } });
      flow.eq("显式传值确实会改（不是一味忽略入参）", db.getCard(p2).fsrs.reps, 99);

      // ---------- P3 越界值归一 ----------
      flow.section("P3 priority / tags / domain 越界值归一（Number()||默认）");
      for (const [name, v] of [["负数", -9999], ["超大", 1e9], ["字符串", "abc"], ["小数", 37.5], ["null", null], ["NaN", NaN]]) {
        let err = null;
        try {
          mk(`P3-${name}`, { priority: v, tags: name === "null" ? null : undefined, domain: name === "超大" ? "非数组" : undefined });
        } catch (e) {
          err = String((e && e.message) || e);
        }
        flow.check(`priority=${name} 不抛异常`, err === null, "不抛", err);
      }
      const rows3 = (await audit(dbFile)).rows("SELECT priority FROM cards WHERE front_markdown LIKE 'F13 问题 P3%'");
      flow.record("越界 priority 的落库值（A-9 修复后：钳进 [0,100]、非法类型回落 50、小数四舍五入）", rows3.map((r) => r.priority).join(","));
      // A-9（审计 F36）：原断言是「−9999 与 1e9 **未被钳制**」——那等于把缺陷写成预期。
      // 修复后的契约：越界值一律钳进 [0,100]；非法类型回落 50；小数四舍五入。
      const vals3 = rows3.map((r) => Number(r.priority));
      flow.check("越界 priority 一律钳进 [0,100]（不再原样入库 −9999 / 1e9）",
        vals3.length === 6 && vals3.every((v) => v >= 0 && v <= 100), "6 个值全在 [0,100]", JSON.stringify(vals3));
      flow.check("非法类型（abc / null / NaN）回落到默认 50",
        vals3.filter((v) => v === 50).length >= 3, "≥3 个 50", JSON.stringify(vals3));
      flow.check("小数 37.5 四舍五入为 38", vals3.includes(38), "含 38", JSON.stringify(vals3));
      flow.check("非法 tags/domain 读回形状安全", db.listAllCards().filter((c) => /P3-/.test(c.frontMarkdown || "")).every((c) => (Array.isArray(c.tags) || c.tags == null) && (Array.isArray(c.domain) || c.domain == null)), true, "形状异常");

      // ---------- P4 超长文本 ----------
      flow.section("P4 超长正文往返（sql.js 全量回写下的长度边界）");
      const big = "很长的正文。".repeat(200000);
      const p4 = mk("P4-超长", { frontMarkdown: big });
      flow.eq("1.2MB 题面字节级往返", (db.getCard(p4).frontMarkdown || "").length, big.length);
      flow.check("超长卡仍参与队列计算", (() => { try { db.computeTodayQueue(); return true; } catch { return false; } })(), true);
      flow.record("超长后库体积", `${Math.round(fs.statSync(dbFile).size / 1024)} KB`);

      // ---------- P5 非法日期 ----------
      flow.section("P5 日记非法日期与脏时间戳（§6.5 L733）");
      flow.eq("isJournalDate 拒绝 '2026-3-5'", J.isJournalDate("2026-3-5"), false);
      flow.eq("isJournalDate 拒绝空串", J.isJournalDate(""), false);
      flow.eq("isJournalDate 拒绝数字", J.isJournalDate(20260305), false);
      const p5errs = [];
      for (const v of ["2026-3-5", "abc", "2026-13-45", "2026-02-30", 12345678901234]) {
        try {
          db.createJournalEntry({ contentMarkdown: `F13 非法日期 ${v}`, source: "app", entryDate: v });
        } catch {
          p5errs.push(String(v));
        }
      }
      flow.record("非法 entry_date 被显式拒绝的", p5errs.join(" ") || "（全部被静默接受/回退）");
      const dates = (await audit(dbFile)).rows("SELECT entry_date FROM journal_entries").map((r) => r.entry_date);
      flow.check(
        "落库 entry_date 只能是合法日期串或空（isJournalDate 已存在却未用在写入路径）",
        dates.every((d) => d == null || J.isJournalDate(String(d))),
        "全部合法",
        dates
      );
      // 批次 D（D-TEST-07）新增：五档非法值必须**当场抛错且一行不落**（原来全部原样入库）
      flow.eq("五档非法 entryDate 全部当场抛错", JSON.stringify(p5errs), JSON.stringify(["2026-3-5", "abc", "2026-13-45", "2026-02-30", "12345678901234"]));
      flow.eq("被拒的日期一行都没进表", dates.length, 0);
      const st5 = db.getStatsOverview();
      flow.check("streak / 今日时长不被脏日期打成 NaN", Number.isFinite(st5.kpi.streak) && Number.isFinite(st5.kpi.minutesToday), true, { s: st5.kpi.streak, m: st5.kpi.minutesToday });

      // ---------- P6 非法权重 ----------
      flow.section("P6 FSRS 权重必须 21 维全有限数（§7.4 L900）");
      const good21 = db.getConfigRow("cfg-default").weights;
      const cfgBefore = (await audit(dbFile)).count("fsrs_configs");
      for (const [name, w] of [["20 维", good21.slice(0, 20)], ["22 维", [...good21, 0.1]], ["含 NaN", [...good21.slice(0, 20), NaN, 0.1]], ["含 Infinity", [...good21.slice(0, 20), Infinity, 0.1]], ["含字符串", [...good21.slice(0, 20), "0.4", 0.1]], ["非数组", null], ["undefined", undefined]]) {
        let rejected = false;
        let msg = "";
        try {
          OPT.applyWeights(db, w);
        } catch (e) {
          rejected = true;
          msg = String((e && e.message) || e).slice(0, 22);
        }
        flow.check(`权重${name} 被拒绝`, rejected, "抛错拒绝", msg || "未拒绝（会污染调度）");
      }
      flow.check("合法 21 维仍可应用", (() => { try { OPT.applyWeights(db, good21.map((v) => v + 1e-6)); return true; } catch { return false; } })(), true);
      flow.eq("非法与合法权重都未破坏配置表结构", (await audit(dbFile)).count("fsrs_configs") >= cfgBefore, true);

      // ---------- P7 非法设置矩阵 ----------
      flow.section("P7 设置非法值一律回落（§4.16 矩阵 / §4.12-4 / §4.4.10 兜底）");
      for (const c of [{ "app.dayCutoffHour": "abc" }, { "app.dayCutoffHour": -3 }, { "app.dayCutoffHour": 99 }, { "app.siblingBury": { enabled: "yes", perDay: 0, newCards: null, sourceTextLimit: -1 } }, { "app.siblingBury": { perDay: 99999 } }, { "app.fsrsConfigId": "不存在" }, { "app.fsrsConfigId": null }]) {
        let err = null;
        try {
          writeSettings(dir, c);
          db.computeTodayQueue();
          db.getStatsOverview();
          db.getActiveConfigId();
        } catch (e) {
          err = String((e && e.message) || e);
        }
        flow.check(`非法设置 ${Object.keys(c)[0]}=${JSON.stringify(Object.values(c)[0]).slice(0, 20)} 不致崩`, err === null, "不抛", err);
      }
      writeSettings(dir, { "app.siblingBury": { enabled: false } });
      mk("P7-组1", { siblingKey: "act:p7-group" });
      mk("P7-组2", { siblingKey: "act:p7-group" });
      flow.eq("关闭同源延后后组内两张都放行", db.computeTodayQueue().cards.filter((c) => c.siblingKey === "act:p7-group").length, 2);
      writeSettings(dir, { "app.siblingBury": { enabled: true } });
      flow.eq("打开后恢复只放行一张", db.computeTodayQueue().cards.filter((c) => c.siblingKey === "act:p7-group").length, 1);
      writeSettings(dir, { "app.siblingBury": null, "app.dayCutoffHour": 0 });
      const mem = require(path.join(ROOT, "electron", "memoryTidy.js"));
      const cfgWeird = mem.readMemoryConfig({ readSettings: () => ({ app: { memory: { enabled: "yes" } } }) });
      flow.check("memory.enabled 非法值归一为布尔", cfgWeird.enabled === true || cfgWeird.enabled === false, "布尔", cfgWeird.enabled);

      // ---------- P8 悬空引用 ----------
      flow.section("P8 悬空引用反查不得崩（跳转原文的降级底线）");
      const ghost = mk("P8-悬空", { contextRef: { documentId: "不存在的文档", cfi: "epubcfi(/6/9[ghost]!)" } });
      flow.eq("按不存在的文档反查书目返回空", db.getItemIdByDocumentId("不存在的文档") ?? null, null);
      flow.check("悬空锚点卡仍可读", !!db.getCard(ghost), true);
      let exErr = null;
      try {
        db.createExtract({ parentType: "document", parentId: "ghost-parent", documentId: "ghost-doc", contentMarkdown: "F13 悬空摘录", priority: 50 });
      } catch (e) {
        exErr = String((e && e.message) || e);
      }
      flow.record("悬空父级摘录的处置", exErr ? `拒绝：${exErr.slice(0, 36)}` : "接受（引用完整性由上层保证）");
      flow.check("摘录队列在悬空父级下不崩", (() => { try { db.listDueExtracts(); return true; } catch { return false; } })(), true);

      // ---------- P9 恶意 sibling_key 与协议串 ----------
      flow.section("P9 恶意 sibling_key 与协议样式字符串（§7.5 数据层不解释语义）");
      const nasty = ["act:" + "x".repeat(5000), "act:'; DROP TABLE cards;--", "act:" + "a:b:c".repeat(40), "act:​", "act:../etc/passwd"];
      for (const k of nasty) {
        let err = null;
        try {
          mk(`P9-${k.slice(4, 12)}`, { siblingKey: k });
        } catch (e) {
          err = String((e && e.message) || e);
        }
        flow.check(`sibling_key ${JSON.stringify(k.slice(0, 18))} 不抛`, err === null, "不抛", err);
      }
      const a9 = await audit(dbFile);
      flow.check("注入样式的键没有真的动到表结构（cards 仍可查）", a9.count("cards") > 0, true, a9.count("cards"));
      for (const url of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "bookasset://../../etc/passwd", "https://ok.example/a"]) {
        const itemId = db.listItems()[0] && db.listItems()[0].id;
        if (!itemId) break;
        db.updateCard ? null : null;
        const id = mk(`P9-url`, { sourceRef: { url }, contextRef: { documentId: "x", url } });
        flow.eq(`协议串 ${url.slice(0, 14)} 原样存取不解释`, JSON.parse(audit ? JSON.stringify(db.getCard(id).contextRef || {}) : "{}").url, url);
      }

      // ---------- P10 Unicode / 零宽 / CRLF ----------
      flow.section("P10 Unicode 边界（emoji / RTL / 零宽 / CRLF / 组合字符）");
      const uni = ["带 emoji 🎯 与 RTL ‮היום‬ 的题面", "零宽 ​﻿ 混入", "CRLF\r\n换行与制表\t", "组合字符 é（e+́）", "全角１２３ＡＢＣ", "半角ｱｲｳ", "上标²³ 与下标₁"];
      const ids = uni.map((t, i) => mk(`P10-${i}`, { frontMarkdown: t }));
      const back = ids.map((id) => db.getCard(id).frontMarkdown);
      flow.eq("逐条字节级往返（不被归一或吞字符）", back, uni);
      flow.check("含零宽/RTL 的卡参与队列不崩", (() => { try { return db.computeTodayQueue().cards.length >= 0; } catch { return false; } })(), true);
      const sim = db.findSimilarCards ? db.findSimilarCards("带 emoji 🎯 与 RTL", 3) : null;
      flow.record("相似检索在 Unicode 输入下可用", sim ? `返回 ${sim.length} 条` : "未导出");
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F13 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
