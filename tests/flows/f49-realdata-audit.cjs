// F49 真实库体检（换角度：不测夹具，测用户机器上那份库）
// @runtime: node  @tier: 2  @gui: false  @id: F49  @timeout: 300
// 运行：node tests/flows/f49-realdata-audit.cjs
//
// 角度：前面 48 条流程全部打在**合成数据**上（自己播种、自己清理）。
//       真实使用才会产生的长尾形状——2000-01-01 哨兵 due、被删书留下的资源字节、
//       同一本书导入 23 次、单条 47 分钟的复习计时、指向已不存在知识点的卡——
//       从来没有任何一条流程见过。本条把 tests/tmp-f49-realdata/ 里那份
//       「%APPDATA%\incremental-reading-dev 的副本」当对手。
//
// 硬约束：**只读**。dbenv.audit() 是内存里的 sql.js 句柄，除非显式调 save() 才回写；
//         本流程一次都不调 save()，且全程只碰副本，绝不碰 %APPDATA% 原件。
// 依据：§7.2（数据完整性/软删除）、§4.2-20（唯一口径）、§4.4.9（review_seq）、
//       §9.1 M2（备份清单）、§7.4（配置集中可审）。
// 不重复登记：F31 已机检的通用不变量（悬空 *_id、软删野值、时间戳区间、重复 id、
//       review_seq 唯一）在这里只报**真实库的实测计数**，形状本身不再当新发现。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F49",
  title: "真实库体检（生产数据长尾）",
  angle: "用户机器上那份库的形状，而不是夹具的形状",
  cites: ["§7.2", "§4.2-20", "§4.4.9", "§9.1 M2", "§7.4"],
  tier: 2,
  gui: false,
});

const COPY_DIR = path.join(ROOT, "tests", "tmp-f49-realdata");
const DB_FILE = path.join(COPY_DIR, "library.db");
const SETTINGS_FILE = path.join(COPY_DIR, "settings.json");

const DAY = 86400000;
const NOW = Date.now();
const Y2001 = 978307200000; // 2001-01-01T00:00:00Z
const YEAR_MS = 365 * DAY;

/** json_extract 的路径前缀（'$.'），拼字符串写死会被 shell 引号吃掉，这里显式构造 */
const DOLLAR = String.fromCharCode(36);
const jp = (k) => "'" + DOLLAR + "." + k + "'";
const jq = (col, k) => "json_extract(" + col + ", " + jp(k) + ")";

/** 计数并记录（record 用字符串，报告里形状可读） */
function tally(name, n, extra) {
  flow.record(name, String(n) + (extra ? " · " + extra : ""));
}

function existsFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}
function walkFiles(dir, base, out) {
  base = base || dir;
  out = out || [];
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else out.push({ rel: path.relative(base, full).split(path.sep).join("/"), full, size: sizeOf(full) });
  }
  return out;
}

runFlow(flow, async () => {
  // ================= 0 前置：副本存在且自证完整 =================
  flow.section("0 前置：审的是副本，不是原件");
  flow.guard("副本目录存在", () => fs.existsSync(COPY_DIR));
  flow.guard("副本 library.db 存在且 >1MB", () => sizeOf(DB_FILE) > 1048576);
  flow.guard("副本 settings.json 存在", () => existsFile(SETTINGS_FILE));
  flow.record("副本路径", path.relative(ROOT, COPY_DIR));
  flow.record("副本 db 体积", (sizeOf(DB_FILE) / 1048576).toFixed(2) + " MB");
  flow.record("副本目录总体积", (walkFiles(COPY_DIR).reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1) + " MB");
  // 副本必须是 sqlite 能开的（开不了 = 下面全部作废）
  let aud = null;
  try {
    aud = await audit(DB_FILE);
  } catch (e) {
    flow.check("副本可被 sql.js 打开", false, "可打开", String(e.message).slice(0, 80));
    return;
  }
  flow.check("副本可被 sql.js 打开（只读句柄，本流程不调 save）", !!aud, true, "opened");
  const qc = aud.rows("PRAGMA quick_check").map((r) => Object.values(r)[0]);
  flow.eq("quick_check 报告", String(qc[0]), "ok");

  const tables = aud.rows(
    "SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((r) => r.name);
  flow.check("表清单来自运行时 pragma（非硬编码）", tables.length > 10, ">10 张", tables.length);
  const colsOf = (t) => {
    try {
      return aud.rows("PRAGMA table_info(" + t + ")").map((r) => r.name);
    } catch {
      return [];
    }
  };
  const hasCol = (t, c) => colsOf(t).includes(c);
  /** 安全计数：列不存在时返回 null 而不是抛（真实库各表列不齐是常态） */
  const cnt = (sql, params) => {
    try {
      return Number((aud.one(sql, params || []) || {}).n || 0);
    } catch {
      return null;
    }
  };

  // ================= T1 表清单 + 行数（运行时发现） =================
  flow.section("T1 表清单与行数（全运行时发现，无硬编码）");
  const counts = {};
  for (const t of tables) counts[t] = aud.count(t);
  const withRows = tables.filter((t) => counts[t] > 0);
  const empty = tables.filter((t) => counts[t] === 0);
  flow.record("表总数 / 有行数 / 空表数", `${tables.length} / ${withRows.length} / ${empty.length}`);
  flow.record("每表行数", tables.map((t) => `${t}=${counts[t]}`).join(" "));
  flow.record("空表清单", empty.join(" ") || "（无空表）");
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  flow.record("全库总行数", String(totalRows));

  // ================= T2 标题长尾 =================
  flow.section("T2 标题长尾：长度分布 / 控制字符 / 双向与零宽 / 重复 / 纯空白");
  const items = aud.rows("SELECT id, title, is_deleted, source_type, lang, cover, created_at, updated_at FROM library_items");
  const T = items.map((r) => ({ id: String(r.id), t: r.title == null ? "" : String(r.title), d: Number(r.is_deleted || 0), st: String(r.source_type) }));
  const lens = T.map((x) => x.t.length).sort((a, b) => a - b);
  flow.record("标题数 / 最短 / 最长", `${T.length} / ${lens[0]} / ${lens[lens.length - 1]}`);
  flow.record("标题长度分桶 (1-40 / 41-80 / 81-200 / >200)", [
    T.filter((x) => x.t.length <= 40).length,
    T.filter((x) => x.t.length > 40 && x.t.length <= 80).length,
    T.filter((x) => x.t.length > 80 && x.t.length <= 200).length,
    T.filter((x) => x.t.length > 200).length,
  ].join(" / "));
  const SHAPE = {
    "含换行": /[\n\r]/,
    "含制表符": /\t/,
    "含 U+202E RTL 覆盖": "‮‬‪‫⁦⁩",
    "含 emoji": /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u,
    "含 RTL 书写系统字符": /[\u{0590}-\u{08FF}\u{FB1D}-\u{FDFF}]/u,
    "含零宽字符": "​‌‍﻿",
    "首尾留白": (s) => s !== s.trim(),
    "裸 . 或 ..": (s) => s === "." || s === "..",
    "纯空白但非空串": (s) => s.length > 0 && s.trim() === "",
    "空串": (s) => s === "",
    "NFKC 会改变形状": (s) => s.normalize("NFKC") !== s,
  };
  const shapeHit = {};
  for (const [name, test] of Object.entries(SHAPE)) {
    const pred =
      typeof test === "string"
        ? (s) => s.indexOf(test) >= 0 || [...test].some((ch) => s.includes(ch))
        : typeof test === "function"
          ? test
          : (s) => test.test(s);
    const hits = T.filter((x) => pred(x.t));
    shapeHit[name] = hits.length;
    tally(`标题·${name}`, hits.length, hits.length ? "样本 id " + hits.slice(0, 3).map((h) => h.id.slice(0, 8)).join(",") : "");
  }
  const dupGroups = {};
  for (const x of T) (dupGroups[x.t] = dupGroups[x.t] || []).push(x);
  const dups = Object.entries(dupGroups).filter(([, v]) => v.length > 1);
  flow.record("重复标题组数（含已删）", `${dups.length} 组 · 规模 ${dups.map(([, v]) => v.length).sort((a, b) => b - a).slice(0, 8).join(",")}`);
  const liveDup = dups.filter(([, v]) => v.some((x) => x.d === 0)).map(([, v]) => v.filter((x) => x.d === 0)).filter((v) => v.length > 1);
  flow.record("活书签名重复组数", `${liveDup.length} 组 · 规模 ${liveDup.map((v) => v.length).join(",") || "-"}`);
  // 同一套形状判据再扫一遍卡面/摘录/日记（长尾不一定落在标题上）
  const CORPUS = [
    ["cards.front_markdown", "SELECT front_markdown v FROM cards"],
    ["cards.back_markdown", "SELECT back_markdown v FROM cards"],
    ["cards.note_text", "SELECT note_text v FROM cards"],
    ["cards.sibling_key", "SELECT sibling_key v FROM cards WHERE sibling_key IS NOT NULL"],
    ["extracts.content_markdown", "SELECT content_markdown v FROM extracts"],
    ["journal_entries.content_markdown", "SELECT content_markdown v FROM journal_entries"],
    ["library_items.source_url", "SELECT source_url v FROM library_items WHERE source_url IS NOT NULL"],
  ];
  for (const [label, sql] of CORPUS) {
    let rows = [];
    try {
      rows = aud.rows(sql);
    } catch {
      flow.record(`扩展形状扫描 ${label}`, "列不存在，跳过");
      continue;
    }
    const s = {};
    let maxLen = 0;
    for (const r of rows) {
      const v = r.v == null ? "" : String(r.v);
      maxLen = Math.max(maxLen, v.length);
      for (const [name, test] of Object.entries(SHAPE)) {
        const pred =
          typeof test === "string" ? (x) => [...test].some((ch) => x.includes(ch)) : typeof test === "function" ? (x) => test(x) : (x) => test.test(x);
        if (pred(v)) s[name] = (s[name] || 0) + 1;
      }
    }
    flow.record(`扩展形状扫描 ${label}（n=${rows.length}, maxLen=${maxLen}）`, Object.keys(s).length ? JSON.stringify(s) : "全部为 0（无控制字符/无 RTL/无零宽/无 emoji）");
  }
  flow.check(
    "同一份库里的活书签名可区分（≥2 组同名 = 用户与界面都无法按标题定位）",
    liveDup.length === 0,
    "0 组同名",
    `${liveDup.length} 组，规模最大 ${liveDup.reduce((a, v) => Math.max(a, v.length), 0)} 本同名`
  );

  // ================= T3 FSRS 长尾 =================
  flow.section("T3 FSRS 长尾：字段缺失/越界 / due 哨兵与超期 / state 野值 / stability=0");
  const cardCols = colsOf("cards");
  flow.check("cards.fsrs_json 列存在", cardCols.includes("fsrs_json"), true, cardCols.includes("fsrs_json"));
  const CF = aud.rows("SELECT id, is_deleted, fsrs_json, knowledge_point_id, sibling_key, fsrs_config_id, created_at, updated_at, priority FROM cards");
  const parsed = [];
  let parseFail = 0;
  for (const r of CF) {
    try {
      const o = JSON.parse(String(r.fsrs_json));
      parsed.push({ id: String(r.id), del: Number(r.is_deleted || 0), o, row: r });
    } catch {
      parseFail++;
    }
  }
  flow.record("卡总数 / fsrs_json 解析失败数", `${CF.length} / ${parseFail}`);
  const FIELDS = ["state", "due", "stability", "difficulty", "reps", "lapses", "learningSteps", "lastReview"];
  for (const k of FIELDS) {
    const vals = parsed.map((p) => p.o[k]);
    const present = vals.filter((v) => v !== undefined);
    const nums = present.filter((v) => typeof v === "number");
    const strings = present.filter((v) => typeof v === "string");
    const nulls = present.filter((v) => v === null);
    const nan = nums.filter(Number.isNaN).length;
    const finite = nums.filter(Number.isFinite);
    tally(`fsrs.${k}`, `缺键 ${vals.length - present.length} · null ${nulls.length} · 字符串 ${strings.length} · 数值 ${nums.length} · NaN ${nan}`,
      finite.length ? `min=${finite.reduce((a, b) => (a < b ? a : b))} max=${finite.reduce((a, b) => (a > b ? a : b))}` : "");
  }
  const states = {};
  for (const p of parsed) states[String(p.o.state)] = (states[String(p.o.state)] || 0) + 1;
  flow.record("state 取值分布", JSON.stringify(states));
  const ENUM = ["new", "learning", "review", "relearning"];
  const wildState = Object.entries(states).filter(([k]) => !ENUM.includes(k));
  flow.check("state 全在枚举内（new/learning/review/relearning）", wildState.length === 0, "无野值", JSON.stringify(wildState));
  const stl = parsed.map((p) => ({ id: p.id, del: p.del, s: p.o.stability, d: p.o.difficulty, state: p.o.state }));
  const zeroS = stl.filter((x) => typeof x.s === "number" && x.s === 0);
  const zeroD = stl.filter((x) => typeof x.d === "number" && x.d === 0);
  flow.record("stability=0 的卡", `${zeroS.length} · state 分布 ${JSON.stringify(zeroS.reduce((a, x) => ((a[x.state] = (a[x.state] || 0) + 1), a), {}))}`);
  flow.record("difficulty=0 的卡", `${zeroD.length} · state 分布 ${JSON.stringify(zeroD.reduce((a, x) => ((a[x.state] = (a[x.state] || 0) + 1), a), {}))}`);
  flow.record("stability=0 样本 id", zeroS.slice(0, 5).map((x) => x.id.slice(0, 8)).join(",") || "（无）");
  flow.record("难度越界（非新卡 D∉[1,10]）", stl.filter((x) => x.state !== "new" && typeof x.d === "number" && (x.d < 1 || x.d > 10)).length);
  flow.record("稳定度越界（非新卡 S≤0）", stl.filter((x) => x.state !== "new" && typeof x.s === "number" && !(x.s > 0)).length);
  const dues = parsed.map((p) => ({ id: p.id, del: p.del, due: p.o.due, state: p.o.state })).filter((x) => typeof x.due === "number");
  const over5y = dues.filter((x) => x.due < NOW - 5 * YEAR_MS);
  const beyond2100 = dues.filter((x) => x.due > Date.UTC(2100, 0, 1));
  const preY2001 = dues.filter((x) => x.due < Y2001);
  flow.record("due 早于 2001-01-01（含已删卡）", `${preY2001.length} · 其中活卡 ${preY2001.filter((x) => x.del === 0).length}`);
  flow.record("due 超前 5 年 / 晚于 2100", `${dues.filter((x) => x.due > NOW + 5 * YEAR_MS).length} / ${beyond2100.length}`);
  flow.record("due 超期 5 年以上（全部）", over5y.length);
  const sentinel = preY2001.filter((x) => x.due >= 946684800000 && x.due < 946684805000);
  flow.record("due 落在 2000-01-01T00:00Z ±5s 的哨兵簇", `${sentinel.length} 张 · 具体值 ${[...new Set(sentinel.map((x) => x.due))].sort((a, b) => a - b).join(", ")}`);
  flow.record("哨兵簇 state 分布", JSON.stringify(sentinel.reduce((a, x) => ((a[x.state] = (a[x.state] || 0) + 1), a), {})));
  flow.record("哨兵簇 已删/未删", sentinel.reduce((a, x) => ((a["is_deleted=" + x.del] = (a["is_deleted=" + x.del] || 0) + 1), a), {})["is_deleted=1"] + " / " + (sentinel.reduce((a, x) => ((a["is_deleted=" + x.del] = (a["is_deleted=" + x.del] || 0) + 1), a), {})["is_deleted=0"] || 0));
  // 未登记的新缺陷：一律走 check（红 = 真实库确实踩到了），不占用 known 名额
  flow.check(
    "活卡里不得有 due 早于 2001 的哨兵值（哨兵一旦进活卡集就永远排在全队最前）",
    preY2001.filter((x) => x.del === 0).length === 0,
    "活卡 0 张",
    `活卡 ${preY2001.filter((x) => x.del === 0).length} 张（含已删全部 ${preY2001.length} 张）`
  );
  flow.record("lastReview 为 null 的卡", parsed.filter((p) => p.o.lastReview === null).length);
  flow.record("lastReview 在未来", parsed.filter((p) => typeof p.o.lastReview === "number" && p.o.lastReview > NOW).length);

  // ================= T4 悬空引用与孤儿（真实数据） =================
  flow.section("T4 悬空引用 / 孤儿 / 独苗兄弟组（真实库实测）");
  flow.record("review_logs → 不存在的卡", cnt("SELECT COUNT(*) n FROM review_logs WHERE card_id NOT IN (SELECT id FROM cards)"));
  flow.record("cards → documents 反查不到的 documentId", cnt(
    "SELECT COUNT(*) n FROM cards c WHERE json_valid(context_ref_json) AND " +
      "json_extract(context_ref_json, " + jp("documentId") + ") IS NOT NULL AND " +
      "json_extract(context_ref_json, " + jp("documentId") + ") NOT IN (SELECT id FROM documents)"
  ));
  flow.record("documents → 不存在的 library_item", cnt("SELECT COUNT(*) n FROM documents WHERE library_item_id NOT IN (SELECT id FROM library_items)"));
  flow.record("assets → 不存在的 library_item", cnt("SELECT COUNT(*) n FROM assets WHERE library_item_id NOT IN (SELECT id FROM library_items)"));
  flow.record("reading_events → 不存在的 item", cnt("SELECT COUNT(*) n FROM reading_events WHERE item_id NOT IN (SELECT id FROM library_items)"));
  flow.record("card_issues → 不存在的卡", cnt("SELECT COUNT(*) n FROM card_issues WHERE card_id NOT IN (SELECT id FROM cards)"));
  flow.record("extracts → 不存在的 document", cnt("SELECT COUNT(*) n FROM extracts WHERE document_id NOT IN (SELECT id FROM documents)"));
  flow.record("material_map_shards → 不存在的 document", cnt("SELECT COUNT(*) n FROM material_map_shards WHERE document_id NOT IN (SELECT id FROM documents)"));
  const kpLive = cnt(
    "SELECT COUNT(*) n FROM cards WHERE is_deleted=0 AND knowledge_point_id IS NOT NULL AND knowledge_point_id<>'' " +
      "AND knowledge_point_id NOT IN (SELECT id FROM knowledge_points)"
  );
  const kpAll = cnt(
    "SELECT COUNT(*) n FROM cards WHERE knowledge_point_id IS NOT NULL AND knowledge_point_id<>'' " +
      "AND knowledge_point_id NOT IN (SELECT id FROM knowledge_points)"
  );
  flow.record("knowledge_points 表行数 / 卡上引用的不同 kp 数", `${counts.knowledge_points} / ${aud.one("SELECT COUNT(DISTINCT knowledge_point_id) n FROM cards WHERE knowledge_point_id IS NOT NULL AND knowledge_point_id<>''").n}`);
  flow.record("cards.knowledge_point_id 悬空（全部 / 仅活卡）", `${kpAll} / ${kpLive}`);
  flow.check(
    "活卡的 knowledge_point_id 必须反查得到（否则知识视图与领域排名静默丢卡）",
    kpLive === 0,
    "0 张",
    `${kpLive} 张活卡指向不存在的知识点（占活卡 ${((kpLive / Math.max(1, counts.cards)) * 100).toFixed(0)}%）`
  );
  const cfgDang = cnt("SELECT COUNT(*) n FROM cards WHERE fsrs_config_id IS NOT NULL AND fsrs_config_id NOT IN (SELECT id FROM fsrs_configs)");
  flow.record("cards.fsrs_config_id 悬空（指向不存在的 config）", cfgDang);
  flow.record("cards.fsrs_config_id 为 NULL", cnt("SELECT COUNT(*) n FROM cards WHERE fsrs_config_id IS NULL"));
  const sibAll = aud.rows("SELECT sibling_key k, COUNT(*) c FROM cards WHERE sibling_key IS NOT NULL AND sibling_key<>'' GROUP BY 1");
  const sibLive = sibAll.filter((g) =>
    aud.one("SELECT COUNT(*) c FROM cards WHERE sibling_key=? AND is_deleted=0", [g.k]).c > 0
  );
  flow.record("兄弟组数（全部 / 含活卡的）", `${sibAll.length} / ${sibLive.length}`);
  const sizeHist = sibAll.reduce((m, g) => ((m[g.c] = (m[g.c] || 0) + 1), m), {});
  flow.record("兄弟组规模分布（全部）", Object.entries(sizeHist).map(([k, v]) => `${k}人组×${v}`).join(" ") || "-");
  flow.record("独苗兄弟组（组里恰好 1 张卡）", sibAll.filter((g) => Number(g.c) === 1).length + " · 其中活卡 " + sibAll.filter((g) => Number(g.c) === 1).filter((g) => aud.one("SELECT COUNT(*) c FROM cards WHERE sibling_key=? AND is_deleted=0", [g.k]).c > 0).length);
  flow.record("活卡是否有任何兄弟组", sibLive.length > 0 ? "有" : "无 —— 真实库里同源延后(siblingBury)对活卡是空转的");
  flow.record("独苗组 key 形状样本", sibAll.filter((g) => Number(g.c) === 1).slice(0, 4).map((g) => String(g.k).slice(0, 30)).join(" | ") || "（无）");
  flow.record("sibling_key 最长", Math.max(0, ...sibAll.map((g) => String(g.k).length)) + " 字符");

  // ================= T5 资源：表行 ↔ 盘上字节 双向对账 =================
  flow.section("T5 资源对账：行有盘无 / 盘有行无 / 删书留字节 / 同字节重复导入");
  const assets = aud.rows("SELECT id, library_item_id, kind, path, hash, is_deleted FROM assets");
  const itemDel = new Map(items.map((r) => [String(r.id), Number(r.is_deleted || 0)]));
  const rowSet = new Set(assets.map((a) => String(a.library_item_id) + "/" + String(a.path)));
  let rowNoFile = [];
  let fileNoRow = [];
  let bytesByKind = {};
  const assetsDir = path.join(COPY_DIR, "assets");
  for (const a of assets) {
    const p = path.join(assetsDir, String(a.library_item_id), String(a.path));
    const ok = existsFile(p);
    if (!ok) rowNoFile.push(String(a.id).slice(0, 8) + "|" + a.kind);
    if (ok) bytesByKind[a.kind] = (bytesByKind[a.kind] || 0) + sizeOf(p);
  }
  let diskFiles = walkFiles(assetsDir);
  for (const f of diskFiles) {
    const rel = f.rel.split("/");
    const key = rel.slice(-2).join("/");
    if (!rowSet.has(key)) fileNoRow.push(key);
  }
  flow.record("assets 行数 / 盘上文件数", `${assets.length} / ${diskFiles.length}`);
  flow.check("每条 assets 行都取得到盘上字节", rowNoFile.length === 0, "0 行缺文件", `${rowNoFile.length} 行缺：${rowNoFile.slice(0, 4).join(", ")}`);
  flow.check("盘上每个字节都有行认领（无主字节不会被备份也不会被清理）", fileNoRow.length === 0, "0 个无主文件", `${fileNoRow.length} 个：${fileNoRow.slice(0, 4).join(", ")}`);
  flow.record("path 列是否只存裸文件名", assets.every((a) => !/[\\/]/.test(String(a.path))) ? "是（拼接规则 assets/<item_id>/<path>）" : "否（存在带分隔符的 path）");
  const liveAssetRowsOnDeadItems = assets.filter((a) => Number(a.is_deleted) === 0 && itemDel.get(String(a.library_item_id)) === 1);
  flow.record("assets 软删位分布", JSON.stringify(assets.reduce((m, a) => ((m["is_deleted=" + a.is_deleted] = (m["is_deleted=" + a.is_deleted] || 0) + 1), m), {})));
  flow.record("活 assets 行数挂在已删书上", `${liveAssetRowsOnDeadItems.length} / ${assets.filter((a) => Number(a.is_deleted) === 0).length}`);
  const deadItemBytes = diskFiles.filter((f) => itemDel.get(f.rel.split("/")[0]) === 1).reduce((a, f) => a + f.size, 0);
  const liveItemBytes = diskFiles.filter((f) => itemDel.get(f.rel.split("/")[0]) === 0).reduce((a, f) => a + f.size, 0);
  flow.record("已删书占用字节 / 活书占用字节", `${(deadItemBytes / 1048576).toFixed(1)} MB / ${(liveItemBytes / 1048576).toFixed(1)} MB`);
  flow.record("已删书项数 / 总项数", `${items.filter((i) => Number(i.is_deleted) === 1).length} / ${items.length}`);
  // 同一份字节被导入多次（hash 相同）
  const byHash = {};
  for (const a of assets) {
    const h = String(a.hash || "");
    if (!h) continue;
    (byHash[h] = byHash[h] || []).push(a);
  }
  const dupHash = Object.entries(byHash).filter(([, v]) => v.length > 1);
  let redundant = 0;
  let redundantDup = 0;
  for (const [, v] of dupHash) {
    const sz = v.map((a) => sizeOf(path.join(assetsDir, String(a.library_item_id), String(a.path)))).sort((x, y) => y - x);
    redundant += sz.slice(1).reduce((x, y) => x + y, 0);
    redundantDup += sz.length - 1;
  }
  flow.record("内容重复组数 / 冗余份数 / 冗余字节", `${dupHash.length} 组 / ${redundantDup} 份 / ${(redundant / 1048576).toFixed(1)} MB`);
  flow.record("最大重复组规模", dupHash.length ? String(Math.max(...dupHash.map(([, v]) => v.length))) : "0");
  flow.record("hash 为空的 assets 行", assets.filter((a) => !a.hash).length);
  flow.known(
    "已删书的资源行应一并置软删位（备份按 item 过滤已生效，但库里的行仍在说谎）",
    liveAssetRowsOnDeadItems.length === 0,
    "D-TEST-18",
    "0 行",
    `${liveAssetRowsOnDeadItems.length} 行 is_deleted=0 而父书 is_deleted=1 · ${(deadItemBytes / 1048576).toFixed(1)} MB 字节留在盘上`
  );
  const kindNoFile = Object.keys(bytesByKind);
  flow.record("按 kind 的盘上字节", kindNoFile.map((k) => `${k}=${(bytesByKind[k] / 1048576).toFixed(1)}MB`).join(" "));

  // ================= T6 历史完整性 =================
  flow.section("T6 复习史完整性：review_seq / 未来时间戳 / 计时离群 / 快照缺失 / 日界对账");
  const RL = aud.rows("SELECT id, card_id, rating, reviewed_at, duration_ms, fsrs_before_json, fsrs_after_json, leech_before_json, fsrs_config_id, fsrs_before_config_id, review_seq FROM review_logs");
  const seqs = RL.map((r) => Number(r.review_seq)).filter(Number.isFinite).sort((a, b) => a - b);
  flow.record("review_logs 行数 / seq min / seq max / seq 去重后", `${RL.length} / ${seqs[0]} / ${seqs[seqs.length - 1]} / ${new Set(seqs).size}`);
  let gaps = 0;
  for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) gaps++;
  let dupsSeq = seqs.length - new Set(seqs).size;
  flow.record("review_seq 断号数 / 重号数", `${gaps} / ${dupsSeq}`);
  flow.check("review_seq 连续且唯一（§4.4.9 撤销定位靠它）", gaps === 0 && dupsSeq === 0, "0 断 0 重", `${gaps} 断 ${dupsSeq} 重`);
  flow.check("review_seq 从 1 起且无空洞（max 应等于行数）", seqs[seqs.length - 1] === RL.length, String(RL.length), String(seqs[seqs.length - 1]));
  flow.record("reviewed_at 为 0/null", RL.filter((r) => !r.reviewed_at || Number(r.reviewed_at) === 0).length);
  flow.record("reviewed_at 在未来", RL.filter((r) => Number(r.reviewed_at) > NOW).length);
  const ts = RL.map((r) => Number(r.reviewed_at)).sort((a, b) => a - b);
  flow.record("最早 / 最晚复习时间", `${new Date(ts[0]).toISOString().slice(0, 10)} → ${new Date(ts[ts.length - 1]).toISOString().slice(0, 10)}（${((ts[ts.length - 1] - ts[0]) / DAY).toFixed(1)} 天）`);
  const durs = RL.map((r) => Number(r.duration_ms)).filter(Number.isFinite);
  const dSorted = durs.slice().sort((a, b) => a - b);
  const pct = (p) => dSorted[Math.min(dSorted.length - 1, Math.floor(p * dSorted.length))];
  flow.record("duration_ms p50 / p95 / p99 / max（秒）", `${(pct(0.5) / 1000).toFixed(1)} / ${(pct(0.95) / 1000).toFixed(1)} / ${(pct(0.99) / 1000).toFixed(1)} / ${(dSorted[dSorted.length - 1] / 1000).toFixed(1)}`);
  for (const lim of [60000, 300000, 600000, 1800000]) {
    tally(`duration_ms > ${lim / 1000}s`, durs.filter((v) => v > lim).length);
  }
  flow.record("duration_ms 为 0/null", RL.filter((r) => !r.duration_ms || Number(r.duration_ms) === 0).length);
  const maxDur = Math.max(...durs);
  flow.record("最长单条复习（分钟）/ 其占今日总时长比", `${(maxDur / 60000).toFixed(1)} 分钟 · 见 KPI 影响`);
  flow.check(
    "单条复习计时必须有合理上限（离群值原样进 minutesToday 与 duration-hist）",
    durs.every((v) => v <= 30 * 60000),
    "全部 ≤30 分钟",
    `最大 ${(maxDur / 60000).toFixed(1)} 分钟；>10 分钟 ${durs.filter((v) => v > 600000).length} 条；>30 分钟 ${durs.filter((v) => v > 1800000).length} 条`
  );
  flow.record("fsrs_before_json 为空", RL.filter((r) => !r.fsrs_before_json || String(r.fsrs_before_json) === "").length);
  flow.record("fsrs_after_json 为空", RL.filter((r) => !r.fsrs_after_json || String(r.fsrs_after_json) === "").length);
  flow.record("leech_before_json 为空", RL.filter((r) => !r.leech_before_json || String(r.leech_before_json) === "").length);
  flow.record("fsrs_config_id / fsrs_before_config_id 为 NULL", `${RL.filter((r) => r.fsrs_config_id == null).length} / ${RL.filter((r) => r.fsrs_before_config_id == null).length}`);
  flow.record("rating 取值分布", JSON.stringify(RL.reduce((m, r) => ((m[String(r.rating)] = (m[String(r.rating)] || 0) + 1), m), {})));
  // lapses 全 0 是缺陷还是正常？逐条把 Again 打在「评分前的 state」上归因
  const againByBeforeState = {};
  let againNoSnapshot = 0;
  let lappable = 0;
  for (const r of RL) {
    if (String(r.rating) !== "Again") continue;
    let b = null;
    try {
      b = JSON.parse(String(r.fsrs_before_json));
    } catch {
      b = null;
    }
    if (!b || !b.state) {
      againNoSnapshot++;
      continue;
    }
    againByBeforeState[b.state] = (againByBeforeState[b.state] || 0) + 1;
    if (b.state === "review" || b.state === "relearning") lappable++;
  }
  const lapsesSum = parsed.reduce((a, p) => a + (typeof p.o.lapses === "number" ? p.o.lapses : 0), 0);
  flow.record("Again 评分按「评分前 state」归因", JSON.stringify(againByBeforeState) + " · 无快照 " + againNoSnapshot);
  flow.record("lapses 全库总和 / 应触发 lapse 的 Again 条数", `${lapsesSum} / ${lappable}`);
  flow.check(
    "lapses 总和为 0 只可能是「真实使用里确实没有 review 态卡被打 Again」—— 归因必须自洽",
    lapsesSum > 0 || lappable === 0,
    "自洽（有 lapse 或没有可 lapse 的 Again）",
    `lapses=${lapsesSum} 但可 lapse 的 Again=${lappable} 条`
  );
  const statesSeen = new Set(Object.keys(states));
  flow.record("从未出现过的 state（真实使用 + 本库）", ENUM.filter((s) => !statesSeen.has(s)).join(",") || "（无）");
  flow.record("relearningSteps 路径在真实库的覆盖率", ENUM.filter((s) => s === "relearning" && !statesSeen.has(s)).length ? "0%（全库 0 张卡进过 relearning，FSRS 重学习分支在生产数据里同样零覆盖）" : "有覆盖");

  // 日界对账：最近 30 天，复习计数 vs 阅读事件计数（日切点取**用户真实**的 dayCutoffHour）
  let cut = 0;
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    const v = Number(s && s.app && s.app.dayCutoffHour);
    cut = Number.isFinite(v) ? v : 0;
  } catch {
    cut = 0;
  }
  flow.record("日界对账使用的 dayCutoffHour（取自真实 settings.json）", String(cut));
  const dayBuckets = [];
  for (let i = 0; i < 30; i++) {
    const end = NOW - i * DAY + (12 - cut) * 3600000;
    const start = end - DAY;
    const rv = cnt("SELECT COUNT(*) n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?", [start, end]);
    const rd = cnt("SELECT COUNT(*) n FROM reading_events WHERE created_at >= ? AND created_at < ?", [start, end]);
    dayBuckets.push({ day: new Date(end).toISOString().slice(0, 10), rv, rd });
  }
  const sumRv = dayBuckets.reduce((a, b) => a + (b.rv || 0), 0);
  const sumRd = dayBuckets.reduce((a, b) => a + (b.rd || 0), 0);
  flow.record("近 30 天：复习条数合计 / 阅读事件条数合计", `${sumRv} / ${sumRd}`);
  flow.record("近 30 天：零复习天数 / 有复习但无阅读天数 / 有阅读但无复习天数",
    `${dayBuckets.filter((b) => b.rv === 0).length} / ${dayBuckets.filter((b) => b.rv > 0 && b.rd === 0).length} / ${dayBuckets.filter((b) => b.rd > 0 && b.rv === 0).length}`);
  flow.record("近 30 天日桶（日期:复习/阅读事件）", dayBuckets.map((b) => `${b.day.slice(5)}:${b.rv}/${b.rd}`).join(" "));
  const journal = hasCol("journal_entries", "entry_date") ? aud.rows("SELECT entry_date, created_at, is_deleted, is_draft FROM journal_entries") : [];
  flow.record("journal 条数 / 去重后的 entry_date 天数", `${journal.length} / ${new Set(journal.map((j) => String(j.entry_date))).size}`);
  flow.record("journal 日期串样本", journal.map((j) => String(j.entry_date)).join(",") || "（无）");
  flow.record("journal 日期与 created_at 自然日不一致的条数",
    journal.filter((j) => String(j.entry_date) !== new Date(Number(j.created_at) + (24 - cut) * 3600000).toISOString().slice(0, 10)).length);
  flow.record("有复习但当日既无阅读事件也无日记的天数", dayBuckets.filter((b) => b.rv > 0 && b.rd === 0 && !journal.some((j) => String(j.entry_date) === b.day)).length);

  // ================= T7 规模与体积（性能视角） =================
  flow.section("T7 规模事实：最大的正文 / 体积比 / 空页 / 残留文件");
  const docLens = hasCol("documents", "markdown")
    ? aud.rows("SELECT id, library_item_id, LENGTH(markdown) len, is_deleted FROM documents")
    : [];
  const sortedLens = docLens.map((r) => Number(r.len || 0)).sort((a, b) => a - b);
  flow.record("documents 行数 / 正文总字节 / 最大单篇", `${docLens.length} / ${(sortedLens.reduce((a, b) => a + b, 0) / 1048576).toFixed(2)} MB / ${(sortedLens[sortedLens.length - 1] / 1048576).toFixed(2)} MB`);
  flow.record("正文最大的 5 篇（字符）", sortedLens.slice(-5).reverse().join(", "));
  const biggestDoc = docLens.slice().sort((a, b) => Number(b.len) - Number(a.len))[0];
  flow.record("最大正文所属 item / 是否活书", `${String(biggestDoc.library_item_id).slice(0, 8)} · is_deleted=${biggestDoc.is_deleted}`);
  flow.record("正文为 0 字符的 documents（全部 / 活书）",
    `${docLens.filter((r) => Number(r.len || 0) === 0).length} / ${docLens.filter((r) => Number(r.len || 0) === 0 && Number(r.is_deleted) === 0).length}`);
  flow.record("0 字符正文按 source_type", JSON.stringify(
    docLens.filter((r) => Number(r.len || 0) === 0).reduce((m, r) => {
      const st = String(items.find((i) => String(i.id) === String(r.library_item_id))?.source_type);
      m[st] = (m[st] || 0) + 1;
      return m;
    }, {})
  ));
  const liveZero = docLens.filter((r) => Number(r.len || 0) === 0 && Number(r.is_deleted) === 0).map((r) => String(r.library_item_id));
  flow.record("活书且正文 0 字符的 item id", liveZero.map((s) => s.slice(0, 8)).join(",") || "（无）");
  flow.record("每本书的 documents 数（最大）", String(aud.one("SELECT MAX(c) n FROM (SELECT library_item_id, COUNT(*) c FROM documents GROUP BY 1)").n));
  if (hasCol("documents", "blocks_json")) {
    const bq = aud.one("SELECT COUNT(*) n, SUM(CASE WHEN blocks_json IS NULL OR LENGTH(blocks_json)<=2 THEN 1 ELSE 0 END) empty, SUM(LENGTH(blocks_json)) s, SUM(LENGTH(COALESCE(toc_json,''))) t FROM documents");
    flow.record("blocks_json 为空壳(≤2字符)的行数 / 总数", `${bq.empty} / ${bq.n}`);
    flow.record("blocks_json + toc_json 总字节", `${bq.s} + ${bq.t}`);
    flow.check(
      "documents.blocks_json 至少被真实使用写过一次（§4.2 承诺的分块结构若恒为空壳即死列）",
      Number(bq.empty) < Number(bq.n),
      "存在非空壳行",
      `${bq.empty}/${bq.n} 行是空壳（真实使用 0 行写入分块，全库 blocks_json 合计 ${bq.s} 字节）`
    );
    flow.record("toc_json 有值的行数 / 总数", `${Number(aud.one("SELECT COUNT(*) n FROM documents WHERE toc_json IS NOT NULL AND LENGTH(toc_json)>2").n)} / ${bq.n}`);
  }
  // 注：这条**不是**缺陷 —— F49B 已实测：这两本活书（source_type=pdf）在阅读器里正常渲染出正文，
  //     走的是「原文件直读」通道（main.js:329 v28 起 PDF 只存原文不跑提纯、main.js:311 ebook 同理），
  //     documents.markdown 对它们本来就不是正文真源。留在这里是为了说明：
  //     §4.2「documents.markdown 是唯一正文真源」这句话对 54/224 行不成立，检索/引用侧要按通道分流。
  flow.record(
    "活书且 documents.markdown 为 0 字符",
    `${liveZero.length} 本（id ${liveZero.map((s) => s.slice(0, 8)).join(",") || "-"}）· 均由 pdf/ebook 原文件直读通道渲染，F49B 实测正常出字`
  );
  flow.check(
    "0 字符正文必须全部落在原文件直读通道内（否则就是真的空册）",
    docLens
      .filter((r) => Number(r.len || 0) === 0)
      .every((r) => ["pdf", "ebook"].includes(String(items.find((i) => String(i.id) === String(r.library_item_id))?.source_type))),
    "全部为 pdf/ebook",
    "存在非直读通道的空册"
  );
  flow.check(
    "library_items.lang 至少被真实使用写过（词典 D35 优先级链第四位取它，全空 = 该档永不参与）",
    items.some((i) => String(i.lang || "").length > 0),
    "存在非空 lang",
    `${items.filter((i) => String(i.lang || "").length === 0).length}/${items.length} 行 lang 为空串`
  );
  if (hasCol("library_items", "lang")) {
    flow.record("library_items.lang 分布", JSON.stringify(items.reduce((m, r) => ((m[String(r.lang || "(空)")] = (m[String(r.lang || "(空)")] || 0) + 1), m), {})));
  }
  if (hasCol("library_items", "cover")) {
    flow.record("cover 有值的项数", items.filter((r) => r.cover && String(r.cover).length > 0).length);
  }
  flow.record("progress_json 为 NULL 的项数", cnt("SELECT COUNT(*) n FROM library_items WHERE progress_json IS NULL"));
  flow.record("progress_json 含 ratio:null 的项数", cnt("SELECT COUNT(*) n FROM library_items WHERE progress_json LIKE '%\"ratio\":null%'"));
  flow.record("progress_json 非法 JSON 的项数", cnt("SELECT COUNT(*) n FROM library_items WHERE progress_json IS NOT NULL AND NOT json_valid(progress_json)"));
  const cardText = aud.one("SELECT MAX(LENGTH(front_markdown)) f, MAX(LENGTH(back_markdown)) b, MAX(LENGTH(note_text)) n, MAX(LENGTH(COALESCE(occlusion_json,''))) o, MAX(LENGTH(COALESCE(context_ref_json,''))) c FROM cards");
  flow.record("卡文本最长字段（front/back/note/occlusion/contextRef）", Object.values(cardText).join(" / "));
  const perColBytes = tables.filter((t) => colsOf(t).length).map((t) => {
    const tc = colsOf(t);
    const expr = tc.map((c) => `SUM(LENGTH(COALESCE(CAST("${c}" AS BLOB),0)))`).join("+");
    let n = 0;
    try {
      n = Object.values(aud.one("SELECT " + expr + " s FROM " + t))[0] || 0;
    } catch {
      n = -1;
    }
    return { t, n: Number(n) };
  }).sort((a, b) => b.n - a.n);
  flow.record("按列聚合的数据字节 Top6", perColBytes.slice(0, 6).map((x) => `${x.t}=${(x.n / 1048576).toFixed(2)}MB`).join(" "));
  const dataBytes = perColBytes.reduce((a, b) => a + Math.max(0, b.n), 0);
  const fileSize = sizeOf(DB_FILE);
  const pc = Number((aud.rows("SELECT * FROM pragma_page_count()")[0] || {}).page_count || 0);
  const ps = Number((aud.rows("SELECT * FROM pragma_page_size()")[0] || {}).page_size || 0);
  flow.record("文件大小 / page_count*page_size", `${(fileSize / 1048576).toFixed(2)} MB / ${(pc * ps / 1048576).toFixed(2)} MB（${pc} 页 × ${ps}B）`);
  flow.record("表数据净字节 / 体积比（文件 ÷ 数据）", `${(dataBytes / 1048576).toFixed(2)} MB / ${(fileSize / Math.max(1, dataBytes)).toFixed(2)}×`);
  let freePages = null;
  for (const probe of ["SELECT * FROM pragma_freelist()", "PRAGMA freelist_count", "PRAGMA page_free_count"]) {
    try {
      const r = aud.rows(probe)[0];
      if (r) {
        freePages = Number(Object.values(r)[0]);
        flow.record("空页数取到所用的 pragma", probe);
        break;
      }
    } catch {
      /* 这个 sql.js 构建不支持该 pragma 的 prepare 路径 */
    }
  }
  flow.record("freelist 空页数（null = 此构建不支持，改用 文件大小-页×页数 恒等式推断）", String(freePages));
  flow.record("文件大小 - page_count*page_size（=0 说明文件没有尾随空洞）", String(fileSize - pc * ps));
  const leftovers = walkFiles(COPY_DIR).filter((f) => /\.(tmp|bak|wal|jwt|journal|backup-\d.*)$/i.test(path.basename(f.rel)) || /^library\.db\./.test(path.basename(f.rel)));
  flow.record("副本目录里 .tmp/残留文件数", leftovers.length + (leftovers.length ? " · " + leftovers.slice(0, 5).map((f) => f.rel).join(",") : ""));
  const backupFiles = fs.existsSync(path.join(COPY_DIR, "backups")) ? fs.readdirSync(path.join(COPY_DIR, "backups")) : [];
  flow.record("副本目录是否含 backups/", backupFiles.length ? backupFiles.join(",") : "否（本副本只带 library.db/settings.json/memory/assets）");

  // ================= T8 设置面现实核对 =================
  flow.section("T8 用户机器上的 settings.json ↔ 代码在读的键");
  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (e) {
    flow.check("副本 settings.json 可解析", false, "可解析", String(e.message).slice(0, 60));
  }
  const leaves = [];
  (function flat(o, p) {
    for (const [k, v] of Object.entries(o || {})) {
      const key = p ? p + "." + k : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key);
      else leaves.push({ key, kind: Array.isArray(v) ? "array[" + v.length + "]" : v === null ? "null" : typeof v });
    }
  })(settings, "");
  flow.record("顶层 scope", Object.keys(settings || {}).join(", "));
  flow.record("叶子键数 / 形状", `${leaves.length} · ` + leaves.map((l) => `${l.key}:${l.kind}`).join(" "));
  // 扫源码：键名字面量出现在 src/ 或 electron/ 里 = 代码在读
  const srcDirs = [path.join(ROOT, "src"), path.join(ROOT, "electron")];
  const srcText = [];
  (function readDir(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) readDir(full);
      else if (/\.(ts|tsx|js|cjs)$/.test(e.name)) srcText.push({ f: path.relative(ROOT, full), s: fs.readFileSync(full, "utf8") });
    }
  })(srcDirs[0]);
  (function readDir2(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) readDir2(full);
      else if (/\.(ts|tsx|js|cjs)$/.test(e.name)) srcText.push({ f: path.relative(ROOT, full), s: fs.readFileSync(full, "utf8") });
    }
  })(srcDirs[1]);
  flow.record("扫描的源文件数", String(srcText.length));
  const orphan = [];
  const orphanStrict = [];
  for (const l of leaves) {
    const last = l.key.split(".").slice(-1)[0];
    const esc = last.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    const loose = srcText.some((f) => new RegExp("\\b" + esc + "\\b").test(f.s));
    const strict = srcText.some((f) => new RegExp("[\"'`]" + esc + "[\"'`]|\\." + esc + "\\b|\\b" + esc + "\\s*:").test(f.s));
    if (!loose) orphan.push(l.key);
    if (!strict) orphanStrict.push(l.key);
  }
  flow.record("孤儿设置（宽松判据：任意词形出现）", orphan.length ? orphan.join(", ") : "（无）");
  flow.record("孤儿设置（严格判据：引号字面量 / .prop / key: 才算）", orphanStrict.length ? orphanStrict.join(", ") : "（无）");
  flow.check("用户 settings.json 里没有代码从不读的孤儿键（宽松判据）", orphan.length === 0, "0 个", orphan.join(", "));
  flow.check("用户 settings.json 里没有代码从不读的孤儿键（严格判据）", orphanStrict.length === 0, "0 个", orphanStrict.join(", "));
  flow.record("值为 null 的键（代码若按对象用会踩空）", leaves.filter((l) => l.kind === "null").map((l) => l.key).join(", ") || "（无）");
  // 代码在读、文件里没有的键
  const CALL_RE = /settingsStore\.get\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g;
  const READ_RE = /readSettings\(\)[\s\S]{0,80}?\.([A-Za-z][\w.]*)/g;
  const readKeys = new Set();
  for (const f of srcText) {
    let m;
    while ((m = CALL_RE.exec(f.s))) readKeys.add(m[1] + "." + m[2]);
    while ((m = READ_RE.exec(f.s))) readKeys.add("app." + m[1].split(".")[0]);
  }
  const have = new Set(leaves.map((l) => l.key));
  /** 文件里"有"这个键 = 它就是叶子，或它是某个对象的父前缀 */
  const presentInFile = (k) => have.has(k) || [...have].some((h) => h.startsWith(k + "."));
  const NOISE = /^(app|isArray|parse|Object|keys|length|value|default)$/;
  const missing = [...readKeys].filter((k) => !NOISE.test(k.split(".").slice(-1)[0]) && !presentInFile(k)).sort();
  flow.record("代码点名在读的键数（settingsStore.get 扫描，去噪后）", String([...readKeys].filter((k) => !NOISE.test(k.split(".").slice(-1)[0])).length));
  flow.record("代码在读但文件里没有的键（走默认值）", missing.length ? missing.join(", ") : "（无）");
  flow.record("其中从未被写过 = 用户从未改过这两项（正常）", missing.length + " 项；文件只登记偏离默认的值");
  // 与本次真实值直接相关的三项
  const app = (settings || {}).app || {};
  flow.record("app.dayCutoffHour 实际值 / 类型", `${JSON.stringify(app.dayCutoffHour)} · ${typeof app.dayCutoffHour}`);
  flow.record("app.fsrsConfigId 实际值 / 是否存在该行", `${JSON.stringify(app.fsrsConfigId)} / ${aud.one("SELECT COUNT(*) n FROM fsrs_configs WHERE id=?", [String(app.fsrsConfigId)]).n > 0}`);
  flow.record("app.memory.enabled 实际值 / 类型", `${JSON.stringify(app.memory && app.memory.enabled)} · ${typeof (app.memory && app.memory.enabled)}`);
  flow.record("app.siblingBury", JSON.stringify(app.siblingBury));
  flow.record("app.shelfOrder 项数 / 指向不存在的项", `${(app.shelfOrder || []).length} / ${(app.shelfOrder || []).filter((id) => !itemDel.has(String(id))).length}`);
  flow.record("app.shelfOrder 指向已删书的项数", `${(app.shelfOrder || []).filter((id) => itemDel.get(String(id)) === 1).length}`);
  flow.record("活书中未出现在 shelfOrder 的项数", `${items.filter((i) => Number(i.is_deleted) === 0 && !(app.shelfOrder || []).map(String).includes(String(i.id))).length}`);
  flow.record("dashboard.hiddenWidgets / configs 键数", `${JSON.stringify((settings || {}).dashboard?.hiddenWidgets)} / ${Object.keys(((settings || {}).dashboard || {}).configs || {}).length}`);
  flow.record("dictVocabKinds 的语言桶 / library_items.lang 取值", `${Object.keys(app.dictVocabKinds || {}).join(",")} / ${[...new Set(items.map((i) => String(i.lang || "")))].map((s) => s || "(空串)").join(",")}`);

  aud.close();
});
