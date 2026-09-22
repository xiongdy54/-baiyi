// F19 只读清单与分页边界矩阵（换角度：把所有「读」入口当对手喂垃圾参数）
// @runtime: electron  @tier: 2  @gui: false  @id: F19  @timeout: 300
// 运行：npx electron tests/flows/f19-read-api-boundary.cjs   （或 node tests/flows/run.cjs --only F19）
//
// 角度：写路径有 25+ 既有套件反复覆盖，读路径的入参边界几乎没人碰。
//       但用户手上的入口恰恰是读：搜索框打一个「%」、日记翻页翻到第 9999 页、
//       手改 settings 里的日期水位线、前端漏传一个参数——这些不该让页面变白屏。
//       这条不写死函数清单，而是**运行时自动发现** db.js 导出的读函数（list*/get*/compute*），
//       先探测良性调用形状，再用畸形参数矩阵打，逐项核对：不抛、形状合法、不越上限、
//       能分页的必须无重无漏、纯读函数一个字都不许改写磁盘。
//
// 依据：§7.1.3（边界输入不得穿透到崩溃）、§7.6（出错要兜底）、§7.2（读侧不得有写副作用）、
//       §4.2-20（队列唯一口径：同一数据两次读必须一致）、§6.5（日记按自然日归类，日期入参要能被兜住）、
//       §9.1 M15（清单上限，防一次性拉全表）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F19",
  title: "只读清单与分页边界矩阵",
  angle: "把所有读入口当对手：垃圾参数、翻页越界、读函数不得写盘",
  cites: ["§7.1.3", "§7.6", "§7.2", "§4.2-20", "§6.5", "§9.1 M15"],
  tier: 2,
  gui: false,
});

/** 首启动就非空的播种类读函数（§6.3.4 提示词按 scope 播种；只要求形状，不要求为空） */
const SEEDED_AT_BOOT = ["listPromptTemplates"];

/** 批次 A（D-TEST-11）点名的 9 个清单函数：入参归一的直接对象，不走基线探测的 args */
const BATCH_A_LIST_FAMILIES = [
  "listJournalEntries", "listJournalDates", "listJournalEntriesSince",
  "listKnowledgePoints", "listKnowledgeRelations", "listKnowledgeProposals",
  "listInsightRuns", "listMemoryRuns", "listPersonalMeaningCandidates",
];

/** 递归找非法数值（NaN/Infinity）与 undefined 泄漏 */
function findBadNumbers(v, trail, out, depth) {
  if (depth > 4 || out.length > 6) return out;
  if (typeof v === "number" && !Number.isFinite(v)) out.push(`${trail}=${v}`);
  else if (Array.isArray(v)) v.slice(0, 12).forEach((x, i) => findBadNumbers(x, `${trail}[${i}]`, out, depth + 1));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v).slice(0, 24)) findBadNumbers(x, `${trail}.${k}`, out, depth + 1);
  return out;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f19"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // 空库端：所有读函数必须先能被「零数据」调用而不炸（首启动用户看到的就是这个状态）
      const names = Object.keys(db).filter((n) => /^(list|get|compute)[A-Z]/.test(n) && typeof db[n] === "function");
      flow.section("Z1 自动发现读入口，空库端必须返回合法形状（首启动视图）");
      const baseline = [];
      const emptyBad = [];
      const skipped = [];
      for (const n of names) {
        let shape = null;
        let err = null;
        for (const args of [[], [{}]]) {
          try {
            const r = db[n](...args);
            shape = { args, kind: Array.isArray(r) ? "array" : r && typeof r === "object" ? "object" : typeof r };
            break;
          } catch (e) {
            err = String((e && e.message) || e);
          }
        }
        if (!shape) {
          skipped.push(`${n}(${err && /Cannot read|undefined|null/.test(err) ? "需位置参数" : "抛错"})`);
          continue;
        }
        baseline.push({ name: n, ...shape });
        try {
          const r = db[n](...shape.args);
          if (shape.kind === "array") {
            // 播种类（§6.3.4 提示词、§4.4.10 默认参数环境）首启动就不为空，只要求形状
            if (r.length !== 0 && !SEEDED_AT_BOOT.includes(n)) emptyBad.push(`${n}: 空库返回 ${r.length} 行`);
          } else if (shape.kind === "object") {
            const bad = findBadNumbers(r, n, [], 0);
            if (bad.length) emptyBad.push(`${n}: ${bad.join(" ")}`);
          }
        } catch (e) {
          emptyBad.push(`${n}: 二次调用抛错 ${String((e && e.message) || e).slice(0, 24)}`);
        }
      }
      flow.record("自动发现的读函数", `${baseline.length} 个可跑 / ${skipped.length} 个跳过`);
      flow.record("跳过清单", skipped.join(" ") || "（无）");
      flow.check("空库端全部读入口形状合法且不抛", emptyBad.length === 0, "全部合法", emptyBad);

      // 造真实数据，让后续矩阵有意义
      db.createFromPaste("F19 种子书", "# 第一章\n\n含 100% 全角 ＡＢＣ 与 半角 ABC 的正文。");
      const item = db.listItems().find((i) => /F19 种子书/.test(i.title));
      const doc = db.getDocument(item.id);
      const docId = doc?.id || null;
      db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "F19 摘录 100% ＡＢＣ", priority: 70 });
      for (let i = 0; i < 8; i++) {
        db.createCard({
          noteText: `F19 卡 ${i}`, cardType: "qa", frontMarkdown: `F19 问题 ${i}`, backMarkdown: `F19 答案 ${i}`,
          priority: 30 + i * 5, tags: [i % 2 ? "f19a" : "f19b"], siblingKey: "act:f19",
        });
      }
      for (let i = 0; i < 5; i++) db.createJournalEntry({ contentMarkdown: `F19 日记 ${i} 含 100% 与 ABC`, source: "app" });
      for (let i = 5; i < 7; i++) db.createJournalEntry({ contentMarkdown: `F19 日记 ${i} 没有百分号也没有下划线`, source: "app" });
      db.persistNow();

      // ---------- Z2 畸形参数矩阵 ----------
      flow.section("Z2 畸形/越界参数经真实读函数不得抛、不得越上限（§7.1.3）");
      const HOSTILE = [
        ["limit0", { limit: 0 }], ["limitNeg", { limit: -5 }], ["limitFrac", { limit: 1.5 }],
        ["limitStr", { limit: "3" }], ["limitNaN", { limit: "abc" }], ["limitInf", { limit: Infinity }],
        ["limitHuge", { limit: 1e9 }], ["limitNull", { limit: null }], ["limitTrue", { limit: true }],
        ["limitArr", { limit: [] }],
        ["offsetNeg", { offset: -1 }], ["offsetHuge", { offset: 1e9 }], ["offsetStr", { offset: "x" }],
        // 批次 A（D-TEST-11）新增三档：分数 offset 与两种「floor 后仍是 Infinity」的非有限 offset
        ["offsetFrac", { offset: 1.5 }], ["offsetInf", { offset: Infinity }], ["offset1e21", { offset: 1e21 }],
        ["qPct", { query: "%" }], ["qUnder", { query: "_" }], ["qBack", { query: "\\" }],
        ["qQuote", { query: "' OR 1=1--" }], ["qWide", { query: "ＡＢＣ" }], ["qHalf", { query: "ABC" }],
        ["qPctNum", { query: "100%" }], ["qSpace", { query: "   " }], ["qEmoji", { query: "🎯" }],
        ["fromBad", { from: "not-a-date" }], ["fromFeb", { from: "2026-13-45" }], ["reversed", { from: "2026-09-22", to: "2026-01-01" }],
        ["statusBad", { status: "不存在" }], ["unknownKey", { zzz: 1 }],
        ["allAtOnce", { limit: -1, offset: -1, query: "%_%", from: "x", to: null, status: "" }],
        ["scalarStr", "字符串"], ["scalarNum", 42], ["scalarArr", [1, 2]], ["scalarNull", null],
      ];
      const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
      const argsWith = (b, patch) => {
        if (!isPlain(patch)) return [patch]; // 整个参数被换成垃圾标量
        if (b.args.length && isPlain(b.args[0])) return b.args.map((a, i) => (i === 0 ? { ...a, ...patch } : a));
        return [patch];
      };
      const otherThrows = [];
      const fracThrows = [];
      const nullThrows = [];
      // 整参 null 的「族外残余」：矩阵打的是全部 43 个读函数，D-TEST-11 登记的范围只有清单 9 族，
      // 批次 A 也只收口那 9 族（§N 明写其它面记录在案、待单独批次）。残余单独一档，不许被顺手丢掉。
      const nullResidual = [];
      const D11_SCOPE = new Set(BATCH_A_LIST_FAMILIES);
      const oversize = [];
      const badShape = [];
      let calls = 0;
      const kindOf = (v) => (v === null || v === undefined ? "nil" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);
      for (const b of baseline) {
        // 基线形状就地重取：单行读函数在「有数据/无数据」之间本来就会 object↔null 切换，不该拿播种前的形状当尺子
        let baseKind;
        try {
          baseKind = kindOf(db[b.name](...b.args));
        } catch {
          baseKind = b.kind;
        }
        for (const [tag, patch] of HOSTILE) {
          const args = argsWith(b, patch);
          calls++;
          try {
            const r = db[b.name](...args);
            const kind = kindOf(r);
            if (baseKind === "array" && kind !== "array") badShape.push(`${b.name}/${tag}: 数组变成 ${kind}`);
            else if (baseKind === "object" && kind === "array") badShape.push(`${b.name}/${tag}: 对象变成数组`);
            if (kind === "array") {
              if (r.length > 5000) oversize.push(`${b.name}/${tag}: ${r.length} 行`);
              if (r.some((x) => x === null || x === undefined)) badShape.push(`${b.name}/${tag}: 数组里混入空元素`);
            }
          } catch (e) {
            const msg = `${b.name}/${tag}: ${String((e && e.message) || e).slice(0, 30)}`;
            (tag === "limitFrac" ? fracThrows : tag !== "scalarNull" ? otherThrows : D11_SCOPE.has(b.name) ? nullThrows : nullResidual).push(msg);
          }
        }
      }
      flow.record("矩阵调用次数", `${calls} 次（${baseline.length} 函数 × ${HOSTILE.length} 档）`);
      flow.check("分数 limit 必须归一为整数（现在直穿 SQL → datatype mismatch，整页白屏）", fracThrows.length === 0, "全部不抛", fracThrows);
      flow.check("显式传 null 必须等同于未传（默认值只兜 undefined，null 会绕过）", nullThrows.length === 0, "全部不抛", nullThrows);
      flow.record("整参 null 的族外残余（不在 D-TEST-11 登记范围、批次 A §N 也不修）", nullResidual.join(" ") || "（无）");
      flow.known(
        "清单 9 族之外的读函数整参传 null 仍抛（同类缺口，批次 A 只收口 9 族）",
        nullResidual.length === 0,
        "D-TEST-11",
        "全部不抛",
        nullResidual
      );
      flow.check("其余畸形参数不得让任何读函数抛异常", otherThrows.length === 0, "零抛错", otherThrows);
      flow.check("返回值形状不得随参数漂移", badShape.length === 0, "形状稳定", badShape);
      flow.check("单次读取不得越界（≤5000 行）", oversize.length === 0, "有上限", oversize);

      // ---------- Z3 能分页的必须无重无漏 ----------
      flow.section("Z3 翻页守恒：小页逐页取回必须与一次取全等值（无重无漏）");
      const paged = [];
      const notPaged = [];
      const wrong = [];
      // 有些清单返回 {total, rows/entries}，翻页真相在对象里的那个数组上
      const listOf = (r) => {
        if (Array.isArray(r)) return r;
        if (r && typeof r === "object") {
          const key = ["rows", "entries", "items", "list", "data", "cards", "points"].find((k) => Array.isArray(r[k]))
            || Object.keys(r).find((k) => Array.isArray(r[k]));
          if (key) return r[key];
        }
        return null;
      };
      const page = (b, limit, off) => listOf(db[b.name](...argsWith(b, { limit, offset: off })));
      for (const b of baseline) {
        let full;
        try {
          full = listOf(db[b.name](...b.args));
        } catch {
          continue;
        }
        if (!full || !full.length) continue;
        let p0, p1;
        try {
          p0 = page(b, 2, 0);
          p1 = page(b, 2, 2);
        } catch {
          continue;
        }
        const pagedWorks = p0 && p1 && p0.length === 2 && JSON.stringify(p0) !== JSON.stringify(p1);
        if (!pagedWorks) {
          notPaged.push(b.name);
          continue;
        }
        paged.push(b.name);
        const seen = new Set();
        const ids = [];
        let off = 0;
        for (let guard = 0; guard < 60; guard++) {
          const pg = page(b, 2, off);
          if (!pg || !pg.length) break;
          for (const row of pg) {
            const id = String(row.id ?? row.entryId ?? row.cardId ?? row.documentId ?? JSON.stringify(row).slice(0, 40));
            if (seen.has(id)) wrong.push(`${b.name}: 第 ${Math.floor(off / 2) + 1} 页出现重复行 ${id.slice(0, 24)}`);
            seen.add(id);
            ids.push(id);
          }
          off += pg.length;
          if (off >= full.length + 4) break;
        }
        if (ids.length !== full.length) wrong.push(`${b.name}: 翻页取回 ${ids.length} 行 ≠ 一次取全 ${full.length} 行`);
      }
      flow.record("支持分页的清单函数", `${paged.length} 个：${paged.join(" ") || "（无）"}`);
      flow.record("不分页（limit 被忽略）", notPaged.join(" ") || "（无）");
      flow.check("分页读取必须无重无漏", wrong.length === 0, "逐页 == 全量", wrong);

      // ---------- Z2b 批次 A 新增：清单族入参归一的等价语义（§K2-4） ----------
      flow.section("Z2b 分数/非有限 offset 与显式 null limit 的归一语义（批次 A / D-TEST-11，直接打 9 族）");
      const callOne = (name, patch) => {
        try {
          return { ok: true, out: JSON.stringify(db[name](patch)) };
        } catch (e) {
          return { ok: false, out: String((e && e.message) || e).slice(0, 44) };
        }
      };
      const normFail = [];
      let normChecked = 0;
      for (const name of BATCH_A_LIST_FAMILIES) {
        if (typeof db[name] !== "function") {
          normFail.push(`${name}: db 未导出`);
          continue;
        }
        normChecked++;
        // 分数入参的期望是 **floor**（1.5 → 1），不是回落默认值；非有限 offset 归零、超界收到 1e9。
        for (const [tag, patch, ref] of [
          ["limitFrac", { limit: 1.5 }, callOne(name, { limit: 1 })],
          ["limitNull", { limit: null }, callOne(name, {})],
          ["offsetFrac", { offset: 1.5 }, callOne(name, { offset: 1 })],
          ["offsetInf", { offset: Infinity }, callOne(name, { offset: 0 })],
          ["offsetOver", { offset: 1e21 }, callOne(name, { offset: 1e9 })],
        ]) {
          const got = callOne(name, patch);
          if (!got.ok) {
            normFail.push(`${name}/${tag} 抛错：${got.out}`);
            continue;
          }
          if (!ref.ok) {
            normFail.push(`${name}/${tag} 对照调用本身抛错：${ref.out}`);
            continue;
          }
          if (got.out !== ref.out) normFail.push(`${name}/${tag} 结果与对照不一致（归一语义漂了）`);
        }
      }
      flow.eq("9 族全部进矩阵（漏一族会让本断言自证为空）", normChecked, BATCH_A_LIST_FAMILIES.length);
      flow.check("分数/非有限/越界入参一律不抛，且归一结果与整数对照逐字节一致", normFail.length === 0, "全部一致", normFail);

      // ---------- Z4 搜索语义：转义已做，归一化未做 ----------
      flow.section("Z4 搜索语义：LIKE 通配符必须被转义，全角/半角与大小写的口径要一致（§6.5）");
      const all = db.listJournalEntries({}).total;
      const jp = db.listJournalEntries({ query: "100%" });
      const jp2 = db.listJournalEntries({ query: "%" });
      const jp3 = db.listJournalEntries({ query: "_" });
      flow.record("日记总数 / 搜 100% / 搜 % / 搜 _", `${all} / ${jp.total} / ${jp2.total} / ${jp3.total}`);
      flow.eq("种子数据确实入库（7 条日记）", all, 7);
      flow.eq("把 100% 当字面量搜，只命中含该串的 5 条", jp.total, 5);
      flow.eq("单个 % 不得退化成「匹配全部」，只能命中字面含百分号的 5 条", jp2.total, 5);
      flow.eq("单个 _ 不得匹配任何行（LIKE 通配符已被转义）", jp3.total, 0);
      const wide = db.listJournalEntries({ query: "ＡＢＣ" });
      const half = db.listJournalEntries({ query: "ABC" });
      flow.record("全角 ＡＢＣ 命中 / 半角 ABC 命中", `${wide.total} / ${half.total}`);
      flow.check("半角关键词能搜到（证明种子数据在库里，下一条不是空转）", half.total === 5, "5 行", half.total);
      flow.known("搜索词的归一化口径要与词典侧一致（NFKC 全半角，词典查询做、日记/知识库搜索不做）", wide.total === half.total, "D-TEST-10", "两侧命中一致", { 全角: wide.total, 半角: half.total });
      const kqBad = [];
      for (const q of ["'", "''", "--", ";DROP TABLE cards;--", "100%", "_", "%_%"]) {
        try {
          const r = db.listKnowledgePoints({ query: q });
          if (!Array.isArray(r.rows ?? r.items ?? Object.values(r)[0])) kqBad.push(`${q}: 形状异常`);
        } catch (e) {
          kqBad.push(`${q}: ${String((e && e.message) || e).slice(0, 24)}`);
        }
      }
      flow.check("知识库搜索面对注入型字符串不得出错也不得多删", kqBad.length === 0, "全部安全", kqBad);
      flow.eq("注入型查询不得清空数据（cards 行数守恒）", db.listAllCards().length, 8);

      // ---------- Z5 纯读不得碰磁盘 ----------
      flow.section("Z5 读函数一个字都不许改写磁盘（§7.2 只有写路径落盘）");
      db.persistNow();
      const before = { size: fs.statSync(dbFile).size, mtime: fs.statSync(dbFile).mtimeMs };
      for (const b of baseline) {
        try {
          db[b.name](...b.args);
          db[b.name](...b.args);
        } catch {
          /* 前面已判定 */
        }
      }
      const after = { size: fs.statSync(dbFile).size, mtime: fs.statSync(dbFile).mtimeMs };
      flow.eq("整轮只读扫描后文件大小不变", after.size, before.size);
      flow.eq("整轮只读扫描后文件 mtime 不变", after.mtime, before.mtime);

      // ---------- Z6 两次读数一致（墙钟字段允许毫秒抖动，其余必须等值） ----------
      flow.section("Z6 同一时刻两次读数：除墙钟字段外必须逐值一致（§4.2-20 队列唯一口径）");
      const CLOCK = new RegExp("(^|\\.)(now|at|timestamp|ts|generatedAt)$|Days\\[\\d+\\]\\.date$");
      const driftOf = (a, b, trail, out) => {
        if (out.length > 5) return out;
        if (a === b) return out;
        if (CLOCK.test(trail)) return out;
        if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 5) return out;
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) out.push(`${trail}.length: ${a.length} → ${b.length}`);
          for (let i = 0; i < Math.min(a.length, b.length, 60); i++) driftOf(a[i], b[i], `${trail}[${i}]`, out);
          return out;
        }
        if (a && b && typeof a === "object" && typeof b === "object") {
          for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) driftOf(a[k], b[k], `${trail}.${k}`, out);
          return out;
        }
        out.push(`${trail}: ${String(a).slice(0, 18)} → ${String(b).slice(0, 18)}`);
        return out;
      };
      for (const n of ["computeTodayQueue", "getStatsOverview", "listAllCards", "listDueExtracts", "listItems"]) {
        const d = driftOf(db[n](), db[n](), n, []);
        flow.record(`${n} 非时间差异`, d.length ? d.slice(0, 3).join("  ") : "（无）");
        flow.check(`${n}：非时间字段两次读数一致`, d.length === 0, "一致", d);
      }
      flow.check("统计里没有 NaN/Infinity", findBadNumbers(db.getStatsOverview(), "stats", [], 0).length === 0, "全是有限数", findBadNumbers(db.getStatsOverview(), "stats", [], 0));

      // ---------- Z7 阅读事件必须落进仪表盘的日桶 ----------
      flow.section("Z7 阅读历史日桶：读了多少字，图上就得有多少字（§6.2 仪表盘）");
      const seedItem = db.listItems().find((i) => /F19 种子书/.test(i.title));
      db.addReadingEvent(seedItem.id, 0);
      db.addReadingEvent(seedItem.id, 500);
      const rd = db.getStatsOverview().readingDays || [];
      const chars = rd.reduce((acc, x) => acc + (x.chars || 0), 0);
      flow.record("推进 500 字后 readingDays 合计", `${chars} 字（${rd.length} 个日桶，日桶键非日切对齐时恒为 0）`);
      flow.known("当日阅读的 500 字必须出现在阅读历史里", chars === 500, "D-TEST-12", "500 字", chars);
      const vol = (await audit(dbFile)).tables().length;
      flow.check("只读扫描后库仍然完好可开", vol > 20, ">20 张表", vol);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F19 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
