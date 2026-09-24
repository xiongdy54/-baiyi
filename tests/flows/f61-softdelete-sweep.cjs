// F61 软删过滤完备性普查（is_deleted=0 漏在哪几条查询里，一次扫完）
// @runtime: node  @tier: 2  @gui: false  @id: F61  @timeout: 180
// 运行：node tests/flows/f61-softdelete-sweep.cjs
//
// 起因：这条家族已经确认了三个缺陷——D-TEST-23（reading_events 漏过滤）、
//       D-TEST-59（仪表盘「本月跳过 / 本月完成」漏过滤，实测 UI 报 8 而真值 4）、
//       D-TEST-55（已软删书下的 assets 永不回收）。
//       每一次都是"跑到那条查询才发现"。本条改成**静态普查**：
//       把 db.js 里所有引用了带 is_deleted 列的表的 SELECT，逐条问一句「有没有 is_deleted 过滤」。
//       判据故意保守：只报"引用了软删表却整条 SQL 里没有 is_deleted 字样"的，
//       并把每条的**上下文函数名 + 它是不是统计/清单类读口**一起交出来，由人判断。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F61",
  title: "软删过滤完备性普查",
  angle: "所有引用软删表的 SELECT 是否都带 is_deleted 过滤（把逐条撞见改成一次扫完）",
  cites: ["§7.2 L869", "§4.2-20", "§7.1.3"],
  tier: 2,
  gui: false,
});

// 带 is_deleted 列的表（运行时从 db.js 的 DDL 里读，不写死）
function softDeleteTables(src) {
  const set = new Set();
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(src))) {
    if (/is_deleted/i.test(m[2])) set.add(m[1]);
  }
  return set;
}

/** 找出每条 SQL 字符串字面量：模板串或普通引号串，且包含 SELECT */
function sqlLiterals(src) {
  const out = [];
  const re = /(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(src))) {
    const lit = m[1];
    if (!/\bSELECT\b/i.test(lit)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ sql: lit.replace(/^["`']|["`']$/g, ""), line, raw: lit });
  }
  return out;
}

/** 向上找最近的函数名（function xxx / const xxx = / xxx(...) {） */
function enclosingFn(src, line) {
  const lines = src.split("\n");
  for (let i = line - 1; i >= 0 && i > line - 60; i--) {
    const m = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|function)/);
    if (m) return m[1] || m[2];
    const m2 = lines[i].match(/^\s*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/);
    if (m2 && !/if|for|while|switch|catch|function/.test(m2[1])) return m2[1];
  }
  return "(未定位)";
}

runFlow(flow, async () => {
  const src = fs.readFileSync(path.join(ROOT, "electron", "db.js"), "utf8").replace(/\r\n/g, "\n");
  const tables = softDeleteTables(src);
  flow.check("从 DDL 运行时识别出软删表（不写死清单）", tables.size >= 3, "≥3 张", [...tables]);
  const lits = sqlLiterals(src);
  flow.record("db.js 里的 SELECT 字面量总数", lits.length);

  flow.section("S1 引用软删表却没有任何 is_deleted 字样的 SELECT");
  const suspects = [];
  for (const s of lits) {
    const touched = [...tables].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(s.sql));
    if (!touched.length) continue;
    if (/is_deleted/i.test(s.sql)) continue;
    // 排除：COUNT(*) 全表体检类、以及明显是迁移/DDL 的语句
    if (/ALTER|CREATE|PRAGMA|sqlite_master/i.test(s.sql)) continue;
    suspects.push({ ...s, touched });
  }
  flow.record("嫌疑查询数（引用软删表但无 is_deleted 字样）", suspects.length);
  const READ_KW = /overview|stats|kpi|list|count|queue|month|today|dashboard|heatmap|rank|domain|scope|batch|issue|journal|reading|extract/i;
  const grouped = new Map();
  for (const s of suspects) {
    const fn = enclosingFn(src, s.line);
    grouped.set(fn, (grouped.get(fn) || []).concat(s));
  }
  for (const [fn, arr] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const risky = READ_KW.test(fn);
    flow.record(
      `${risky ? "⚠ 读口" : "  其它"} ${fn}()`,
      `db.js:${arr.map((x) => x.line).join(",")} · 涉及表 ${[...new Set(arr.flatMap((x) => x.touched))].join("/")} · 片段「${arr[0].sql.replace(/\s+/g, " ").slice(0, 70)}」`
    );
  }

  flow.section("S1b 子表类：引用**没有软删位的子表**却没 JOIN 任何带 is_deleted 的父表");
  // 这一类正是 D-TEST-23 / D-TEST-59 的真实形状：review_logs / review_skips / reading_events 自己没有 is_deleted 列，
  // 正确写法是 JOIN 父表并带上 `父.is_deleted = 0`（见 db.js:2445、:2487 的修法）。
  // S1 只查"父表被裸引用"，结构上看不到这一类 ⇒ 第一版的召回率被 S2 的正向对照当场证伪。
  const ddlRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  const childTables = new Set();
  let dm;
  while ((dm = ddlRe.exec(src))) {
    if (/is_deleted/i.test(dm[2])) continue;
    if (/\b(card_id|item_id|document_id|library_item_id|knowledge_point_id)\b/i.test(dm[2])) childTables.add(dm[1]);
  }
  flow.record("识别出的子表（无软删位但有外键）", [...childTables].join(" "));
  const childSuspects = [];
  for (const s of lits) {
    const hitChild = [...childTables].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(s.sql));
    if (!hitChild.length) continue;
    if (/is_deleted/i.test(s.sql)) continue;
    const joinsParent = [...tables].some((t) => new RegExp(`\\b${t}\\b`, "i").test(s.sql));
    if (joinsParent) continue; // JOIN 了父表但没写过滤，交给 S1 判
    childSuspects.push({ ...s, hitChild });
  }
  flow.record("子表裸查询数（未 JOIN 父表且无 is_deleted）", childSuspects.length);
  const childGrouped = new Map();
  for (const s of childSuspects) {
    const fn = enclosingFn(src, s.line);
    childGrouped.set(fn, (childGrouped.get(fn) || []).concat(s));
  }
  for (const [fn, arr] of [...childGrouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    flow.record(
      `${READ_KW.test(fn) ? "⚠ 读口" : "  其它"} ${fn}()`,
      `db.js:${arr.map((x) => x.line).join(",")} · 子表 ${[...new Set(arr.flatMap((x) => x.hitChild))].join("/")} · 片段「${arr[0].sql.replace(/\s+/g, " ").slice(0, 76)}」`
    );
  }
  const childRisky = [...childGrouped.keys()].filter((k) => READ_KW.test(k));
  flow.record("其中属于统计/清单类读口的子表函数", childRisky.length ? childRisky.join(" ") : "无");

  flow.section("S2 已确认缺陷的那几条必须在名单里（正向对照，防止普查本身是瞎的）");
  // 对照要同时测召回与精确：
  //   getStatsOverview  —— D-TEST-59 未修 ⇒ **必须**在名单里（测召回）
  //   listReadingEvents —— D-TEST-23 已修（db.js:2487 已带 li.is_deleted = 0）⇒ **必须不在**名单里（测精确，
  //                       否则说明判据太松，把已修的和无害的一律报成嫌疑）
  const mustFind = [{ fn: "getStatsOverview", want: true, why: "D-TEST-59 未修" }];
  const mustNotFind = [{ fn: "listReadingEvents", want: false, why: "D-TEST-23 已修（JOIN 父表带过滤）" }];
  const allGroupedKeys = new Set([...grouped.keys(), ...childGrouped.keys()]);
  const inList = (fn) => allGroupedKeys.has(fn) || [...allGroupedKeys].some((k) => k.toLowerCase().includes(fn.slice(0, 8).toLowerCase()));
  for (const m of mustFind.concat(mustNotFind)) {
    const hit = inList(m.fn);
    flow.record(`${m.fn}（期望${m.want ? "在" : "不在"}名单｜${m.why}）`, hit ? "在名单里" : "不在名单里");
  }
  flow.check(
    "正向对照：未修的 D-TEST-59 必须被挑出（召回），已修的 D-TEST-23 必须不被挑出（精确）",
    mustFind.every((m) => inList(m.fn) === m.want) && mustNotFind.every((m) => inList(m.fn) === m.want),
    "召回与精确同时成立",
    { 应挑出: mustFind.map((m) => m.fn), 应放过: mustNotFind.map((m) => m.fn) }
  );
  // 正向对照：故意构造一条"引用软删表且无过滤"的语句，确认判据能把它挑出来
  const probe = { sql: "SELECT COUNT(*) AS n FROM review_skips JOIN cards ON cards.id = review_skips.card_id", line: 1 };
  const touchedProbe = [...tables].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(probe.sql));
  const caught = touchedProbe.length > 0 && !/is_deleted/i.test(probe.sql);
  flow.check("自检：人造一条无过滤的软删表查询，本普查的判据必须挑出它", caught === true, "能挑出", { 命中表: touchedProbe, 挑出: caught });

  flow.section("S3 判定");
  const riskyFns = [...grouped.keys()].filter((k) => READ_KW.test(k));
  flow.record("其中属于统计/清单类读口的函数数", riskyFns.length);
  flow.record("读口名单", riskyFns.slice(0, 20).join(" "));
  flow.check(
    "统计/清单类读口不得引用软删表而漏 is_deleted 过滤（本条按设计就是红的，逐条修完才转绿）",
    riskyFns.length === 0,
    "0 个",
    riskyFns.slice(0, 12)
  );
});
