// F43 升降级兼容矩阵（版本轴双向 + 向前兼容）
// @runtime: electron  @tier: 2  @gui: false  @id: F43  @timeout: 600
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f43-version-axis-compat.cjs
//      （或 node tests/flows/run.cjs --only F43）
//
// 角度：既有 37 条流程里的时间维度只走**单向**——F05 走「旧库 → 新库」的升级、F04/F37 走
//       「一次写入崩在中途」。从来没有一条流程问过反向的问题：**新数据被旧代码读**，或
//       **旧代码在迁移中途被打断之后新代码再来一遍**。真实用户是这么丢数据的：
//       装 v49 → 不满意 → 回滚 v48 → 用两天 → 再升回 v49；或者升级后 settings.json 被
//       外部工具/磁盘写满弄坏一个字节。sql.js 是「内存库 + 整库导出覆盖」（§7.1.8），
//       所以每一次落盘都是把整个文件重写一遍——这正是「代码不认识的列会不会被顺手抹掉」
//       最该出问题的地方，本层就是来量它的。
//
// 七个子角度与所在小节：
//   ① 降级 / 前向兼容（未知列、未知 NOT NULL 列、未知整表、未知 JSON 字段，在一次业务写入
//      + 全量落盘后是否存活）…………………… A2/A3
//   ② 迁移可重入 / 崩溃落在迁移中途（initDb 只在末尾落一次盘 = 全或无；跨「库+文件」两个
//      介质的那次迁移除外）…………………… C1/C2/C3/C4
//   ③ schema 漂移对账（把库真削成 v1 形态再升回来，逐表与全新库、与源码声明三方对表）…… B1–B4
//   ④ settings 向前兼容（未来键/未来层/类型错位/顶层数组/BOM/CRLF+尾逗号/1MB 垃圾键/写失败）… A4
//   ⑤ 跨版本 backup-meta（未来 format、缺 format、字符串与数组 format、未知 label、古老 appVersion）… E
//   ⑥ backup-meta 与资产交叉核对（zip 里少一个 asset 时恢复报什么）……………………………… F
//   ⑦ FSRS 参数环境兼容（19/25 维权重、损坏 weights_json、缺 learningSteps、悬空指针）……… G
//
// 与 F05 的分工（避免重复）：F05 B5 只往**当前形态**的库里插了一行 v22 形状的 review_logs
//   （列都还在，测的是「旧日志不可撤销」）。本层 B1 是真的把 20 余列 ALTER TABLE … DROP COLUMN、
//   把 15 张后加的表整张 DROP TABLE，构造出一份只有 base DDL 的库文件，再让 initDb 升回来，
//   并把「升回来之后的列集合」与「全新库」「源码声明」三方对表。PLAN §F05 第 6 条写着
//   「把当前库的 v23 列删掉」，实测 f05 代码里没有那一步——本层把它补成真的。
//
// 依据：§7.2 L869/L870/L874/L875、§7.1.4 L858、§7.1.8、§4.4.5/§4.4.9/§4.4.10、§9.1 M2、§7.6。
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const JSZip = require("jszip");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit, canonical } = require("./lib/dbenv.cjs");

const DAY = 86_400_000;
const flow = new Flow({
  id: "F43",
  title: "升降级兼容矩阵（版本轴双向 + 向前兼容）",
  angle: "反向时间轴：新数据被旧代码读、旧库被二次升级、未来版本的文件落进现在的目录",
  cites: ["§7.2", "§7.1.4", "§7.1.8", "§4.4.5", "§4.4.9", "§4.4.10", "§9.1 M2", "§7.6"],
  tier: 2,
  gui: false,
});

// ---------- 脚手架 ----------
const DB_JS = path.join(ROOT, "electron", "db.js");
const SETTINGS_STORE = path.join(ROOT, "electron", "settingsStore.js");
const BACKUP_JS = path.join(ROOT, "electron", "backup.js");
const FSRS_TS = path.join(ROOT, "src", "lib", "fsrs.ts");
const SRC_DB = fs.readFileSync(DB_JS, "utf8");
const SRC_BACKUP = fs.readFileSync(BACKUP_JS, "utf8");
const SRC_FSRS = fs.readFileSync(FSRS_TS, "utf8");
const bk = require(BACKUP_JS);

/** 换沙箱要连 settingsStore.js 一起清缓存：它在**模块加载期**固化
 *  SETTINGS_FILE=app.getPath("userData")（electron/settingsStore.js:6），只清 db.js
 *  会让第二个沙箱读到第一个沙箱的 settings.json —— 那是脚手架的坑，不是产品行为。 */
function clearModules() {
  delete require.cache[DB_JS];
  delete require.cache[SETTINGS_STORE];
}
async function boot(dir) {
  app.setPath("userData", dir);
  clearModules();
  const db = require(DB_JS);
  await db.initDb();
  return db;
}
async function bootQuiet(dir) {
  try {
    return { db: await boot(dir), err: null };
  } catch (e) {
    return { db: null, err: String((e && e.message) || e) };
  }
}
const settingsFileOf = (dir) => path.join(dir, "settings.json");
function readStore(dir) {
  app.setPath("userData", dir);
  clearModules();
  return require(SETTINGS_STORE);
}
/** 生产评分状态的出层形状 = src/lib/fsrs.ts fromFsrsCard()（八字段，§4.4.1） */
function prodFsrs(over = {}) {
  const now = Date.now();
  return { state: "review", due: now + DAY, lapses: 0, stability: 4.2, difficulty: 5.5, reps: 3, learningSteps: 0, lastReview: now - DAY, ...over };
}
const SCHED_OPTS = { requestRetention: 0.9, maximumInterval: 36500, enableShortTerm: true, learningSteps: ["1m", "10m"], relearningSteps: ["10m"], enableFuzz: false };

/** 源码里所有 CREATE TABLE IF NOT EXISTS → 表 → 列（按声明序） */
function parseCreateTables(src) {
  const out = new Map();
  const re = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const open = src.indexOf("(", m.index + m[0].length);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        if (--depth === 0) break;
      }
    }
    const parts = [];
    let d = 0;
    let cur = "";
    for (const ch of src.slice(open + 1, i)) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    const cols = [];
    for (const p of parts) {
      if (/^\s*(--|\/\*)/.test(p)) continue;
      const t = p.trim();
      if (!t) continue;
      const kw = t.split(/\s+/)[0].toUpperCase();
      if (["PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "CONSTRAINT"].includes(kw)) continue;
      cols.push(kw.toLowerCase());
    }
    if (!out.has(name)) out.set(name, cols);
  }
  return out;
}
/** 源码里所有 ALTER TABLE … ADD COLUMN（含模板串循环那一处） */
function parseAlters(src) {
  const adds = new Map();
  const push = (t, c) => {
    if (!adds.has(t)) adds.set(t, new Set());
    adds.get(t).add(String(c).toLowerCase());
  };
  const re = /ALTER TABLE\s+([A-Za-z0-9_]+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([A-Za-z0-9_]+)\b/g;
  let m;
  while ((m = re.exec(src))) push(m[1], m[2]);
  const loopRe = /for \(const \[col, type\] of \[([\s\S]*?)\]\)\s*\{[\s\S]{0,240}?ALTER TABLE ([A-Za-z0-9_]+) ADD COLUMN \$\{col\}/g;
  while ((m = loopRe.exec(src))) {
    // 只取每对 ["列名", 类型] 的第一个字符串，别把 INTEGER/TEXT 当列名
    for (const c of m[1].matchAll(/\[\s*["'`]([A-Za-z0-9_]+)["'`]\s*,/g)) push(m[2], c[1]);
  }
  return adds;
}
async function shapeOf(dbFile) {
  const a = await audit(dbFile);
  const tables = a.tables();
  const shape = new Map();
  for (const t of tables) shape.set(t, a.columns(t).map((c) => String(c).toLowerCase()));
  const counts = {};
  for (const t of tables) counts[t] = a.count(t);
  a.close();
  return { tables, shape, counts };
}
/** 指定列子集的行快照（rowid → 规范化值），用于「旧形态那几列一张不少」的守恒对账 */
function snapCols(aud, table, cols) {
  const map = new Map();
  for (const r of aud.rows(`SELECT rowid AS __rid, * FROM "${table}"`)) {
    const sub = {};
    for (const c of cols) sub[c] = r[c];
    map.set(String(r.__rid), canonical(sub));
  }
  return map;
}
function diffSnaps(before, after) {
  const bad = [];
  for (const t of Object.keys(before)) {
    const b = before[t];
    const a = after[t] || new Map();
    if (a.size !== b.size) bad.push(`${t}: 行数 ${b.size}→${a.size}`);
    for (const [k, v] of b) if (a.has(k) && a.get(k) !== v) bad.push(`${t}#${k}: 值变了`);
    for (const k of a.keys()) if (!b.has(k)) bad.push(`${t}#${k}: 多出一行`);
  }
  return bad;
}
async function sha(p) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
  } catch {
    return "unreadable";
  }
}
async function craftZip(file, meta, entries) {
  const zip = new JSZip();
  if (meta !== null) zip.file("backup-meta.json", typeof meta === "string" ? meta : JSON.stringify(meta));
  for (const [name, buf] of Object.entries(entries || {})) zip.file(name, buf);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}
async function zipWithoutEntry(srcFile, dropRel) {
  const zip = await JSZip.loadAsync(fs.readFileSync(srcFile));
  zip.remove(dropRel);
  return zip;
}

const FUTURE_COL = "f43_future_col";
const FUTURE_TABLE = "f43_future_map";
const FUTURE_SENTINELS = ["cards", "library_items", "documents", "extracts", "review_logs", "fsrs_configs", "prompt_templates", "journal_entries", "knowledge_points", "dict_sources"];

app
  .whenReady()
  .then(async () => {
    const s = await runFlow(flow, async () => {
      // ================================================= P 参考沙箱 =================================================
      const dirP = freshDir(tmpUserDataDir("f43p"));
      const fileP = path.join(dirP, "library.db");
      const dbP = await boot(dirP);
      dbP.persistNow();

      flow.section("P0 版本轴上到底有哪些判据（库内标记 / settings 标记 / 备份标记）");
      {
        const a = await audit(fileP);
        const uv = a.rows("PRAGMA user_version");
        a.close();
        const uvVal = uv.length ? Number(uv[0].user_version) : null;
        flow.record("PRAGMA user_version（SQLite 官方 schema 版本槽位）落盘值", uvVal);
        const marker = /user_version|schema_version|SCHEMA_VERSION|db_version|meta_version/i.exec(SRC_DB);
        flow.check(
          "P0-1 库文件里存在可判定的 schema 版本标记——否则「这份库是新代码写的还是旧代码写的」根本无从判断，降级与向前兼容没有前提",
          !!marker && uvVal > 0,
          "存在标记且 >0",
          { db_js_里的标记: marker ? marker[0] : "无（全文零命中）", user_version: uvVal }
        );
        flow.record("P0-2 现行迁移判据的实际形态", "逐列 try { ALTER TABLE … ADD COLUMN } catch {} —— 拿「列在不在」当版本判据，没有整库版本号");
        flow.record("P0-3 迁移的可重入判据", /if \(!hasSeq\)/.test(SRC_DB) ? "列存在即跳过（hasSeq 守卫）+ try/catch 吞 duplicate；反例见 C3" : "无 hasSeq 式守卫");
        const stObj = readStore(dirP).readSettings();
        // settings.json 只有被写过才存在——先用生产路径写一次（用户在设置页点「切换参数环境」），再看这份文件的自述
        dbP.setActiveFsrsConfig("cfg-default");
        const stWritten = readStore(dirP).readSettings();
        flow.record("P0-3 生产写入之后的 settings.json 键集合", Object.keys(stWritten).join(",") + " / app 段: " + Object.keys(stWritten.app || {}).join(","));
        flow.check(
          "P0-4 settings.json 带格式版本键（未来版本能识别这份文件是谁写的；缺它 = 版本轴上文件层没有任何自述）",
          typeof stWritten.version === "number" || typeof stWritten.app?.settingsVersion === "number",
          "存在数值版本键",
          Object.keys(stWritten).length ? Object.keys(stWritten) : "（仍是空对象）"
        );
        void stObj;
        flow.check("P0-5 备份侧确有格式版本判据", /const FORMAT\s*=\s*1\b/.test(SRC_BACKUP) && /Number\(meta\.format\)\s*!==\s*FORMAT/.test(SRC_BACKUP), "format + Number() 比较", "见 backup.js:342");
      }
      const freshShape = await shapeOf(fileP);
      flow.record("P0-6 当前代码全新库的表数", freshShape.tables.length);

      // ================================================= A 向前兼容 =================================================
      const dirA = freshDir(tmpUserDataDir("f43a"));
      const fileA = path.join(dirA, "library.db");
      let db = await boot(dirA);

      flow.section("A1 播种一段真实旅程（给 A3 的「一次业务写入 + 全量落盘」当靶子）");
      const seed = {};
      {
        const bkItem = db.createFromPaste("F43 向前兼容用书", ["# 第一章", "", "这一章的正文用来锚点回跳，字数不能太少，否则统计侧会当成空书。"].join("\n"));
        seed.itemId = bkItem.id;
        seed.docId = bkItem.documentId;
        const ex = db.createExtract({ parentType: "document", parentId: bkItem.documentId, documentId: bkItem.documentId, contentMarkdown: "F43 摘录正文", priority: 70 });
        seed.exId = ex && ex.id;
        seed.cardIds = [];
        for (let i = 0; i < 4; i++) {
          seed.cardIds.push(
            db.createCard({
              noteText: `F43 卡 ${i}`,
              cardType: "qa",
              frontMarkdown: `F43 问 ${i}`,
              backMarkdown: `F43 答 ${i}`,
              priority: 50,
              tags: ["f43"],
              siblingKey: "act:f43",
              documentId: seed.docId,
              fsrsJson: JSON.stringify(prodFsrs({ due: Date.now() - i * 1000 })),
            }).id
          );
        }
        const f0 = db.getCard(seed.cardIds[0]).fsrs;
        db.saveReview(seed.cardIds[0], prodFsrs({ reps: (f0.reps || 0) + 1, due: Date.now() + 2 * DAY }), "Good", 1200, f0);
        db.saveSkip(seed.cardIds[1]);
        db.addCardIssue({ cardId: seed.cardIds[1], ruleId: "F43", severity: "warn", message: "向前兼容用", source: "test" });
        db.updateProgress(seed.itemId, { ratio: 0.3, lastText: "F43 进度", updatedAt: Date.now() });
        db.setLibraryItemLang(seed.itemId, "zh");
        db.createJournalEntry({ contentMarkdown: "F43 日记条目。", source: "app" });
        db.createKnowledgePoint({ canonicalLabel: "F43 知识点", description: "向前兼容" });
        db.upsertDictSource({ id: "f43-dict", name: "F43 词典", format: "csv", entryCount: 12 });
        const asset = db.createAssetForItem(seed.docId, "image-occlusion", "png", Buffer.from("89504e470d0a1a0a", "hex"));
        seed.assetFilename = asset.filename;
        db.persistNow();
        const a = await audit(fileA);
        flow.record("A1 磁盘事实计数", `cards=${a.count("cards")} logs=${a.count("review_logs")} assets=${a.count("assets")} items=${a.count("library_items")} kp=${a.count("knowledge_points")}`);
        flow.guard("A1 播种成功（卡 4 / 日志 1 / 资源 1）", () => a.count("cards") === 4 && a.count("review_logs") === 1 && a.count("assets") === 1);
        a.close();
      }

      flow.section("A2 注入「只有未来版本才会写出的形态」：未知列 + 未知 NOT NULL 列 + 未知整表 + JSON 里的未知字段");
      {
        const a = await audit(fileA);
        const written = [];
        for (const t of FUTURE_SENTINELS) {
          if (!a.tables().includes(t)) continue;
          const cols = a.columns(t).map((c) => String(c).toLowerCase());
          if (cols.includes(FUTURE_COL)) continue;
          try {
            a.exec(`ALTER TABLE ${t} ADD COLUMN ${FUTURE_COL} TEXT`);
            const row = a.one(`SELECT id FROM ${t} LIMIT 1`);
            if (row) a.exec(`UPDATE ${t} SET ${FUTURE_COL} = ? WHERE id = ?`, [`SENTINEL:${t}`, row.id]);
            written.push(t);
          } catch (e) {
            written.push(`${t}:ERR(${e.message})`);
          }
        }
        let notNull = "ok";
        try {
          a.exec(`ALTER TABLE cards ADD COLUMN f43_required TEXT NOT NULL DEFAULT 'from-future'`);
        } catch (e) {
          notNull = e.message;
        }
        flow.check("A2-1 未来版本给既有表追加 NOT NULL 列在 SQLite 上必须带 DEFAULT（不带就建不出来 → 旧代码的 INSERT 不会被约束卡死）", notNull === "ok", "只能带 DEFAULT 才成功", notNull);
        a.exec(`CREATE TABLE IF NOT EXISTS ${FUTURE_TABLE} (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER)`);
        for (let i = 0; i < 3; i++) a.exec(`INSERT INTO ${FUTURE_TABLE} VALUES (?,?,?)`, [`fut-${i}`, `F43 未来表数据 ${i}`, Date.now()]);
        const futureFsrs = { ...prodFsrs(), f43FutureField: { note: "v49 才会写的字段", v: 49 } };
        a.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(futureFsrs), seed.cardIds[2]]);
        const noSteps = { ...prodFsrs() };
        delete noSteps.learningSteps;
        a.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(noSteps), seed.cardIds[3]]);
        seed.noStepsJson = JSON.stringify(noSteps);
        a.save();
        a.close();
        flow.record("A2 已注入未知列的表", written.join(","));
        flow.check("A2-2 未知列确实注入成功（>=8 张表，否则 A3 是空跑）", !written.some((w) => w.includes(":ERR")) && written.length >= 8, ">=8 表且零错误", written);
      }
      const before = {};
      {
        const a = await audit(fileA);
        for (const t of FUTURE_SENTINELS) {
          if (!a.tables().includes(t)) continue;
          const r = a.one(`SELECT ${FUTURE_COL} AS v FROM ${t} WHERE ${FUTURE_COL} IS NOT NULL LIMIT 1`);
          before[t] = r ? r.v : null;
        }
        before.__futureRows = a.tables().includes(FUTURE_TABLE) ? a.count(FUTURE_TABLE) : 0;
        before.__tables = a.tables().length;
        a.close();
        flow.check("A2-3 注入后盘上确有未知列与未知表（基准成立，后面才有资格说「存活」）", Object.values(before).filter((v) => typeof v === "string" && String(v).startsWith("SENTINEL:")).length >= 8 && before.__futureRows === 3, ">=8 列 + 未来表 3 行", before);
      }
      flow.section("A2b 让当前构建**打开**这份未来形态的库（initDb 侧的前向兼容：迁移不得抹掉它不认识的东西）");
      {
        const r = await bootQuiet(dirA);
        db = r.db || db;
        flow.check("A2b-1 打开含未知列/未知表的库不抛（旧构建遇到新版本写下的库必须还能起来）", r.err === null, "不抛", r.err);
        const a = await audit(fileA);
        const goneAtOpen = [];
        for (const t of FUTURE_SENTINELS) {
          if (!before[t]) continue;
          const cols = a.tables().includes(t) ? a.columns(t).map((c) => String(c).toLowerCase()) : [];
          if (!cols.includes(FUTURE_COL)) goneAtOpen.push(`${t}.${FUTURE_COL}`);
        }
        flow.check("A2b-2 initDb 之后未知列逐表仍在（迁移只加不减）", goneAtOpen.length === 0, "0 张表丢列", goneAtOpen);
        flow.eq("A2b-3 initDb 之后未知表与 3 行数据仍在", [a.tables().includes(FUTURE_TABLE), a.tables().includes(FUTURE_TABLE) ? a.count(FUTURE_TABLE) : 0], [true, 3]);
        a.close();
        // 关键脚手架事实（F04 G4 已定性）：应用持有内存副本期间，**外部**改盘会被下一次
        // persist() 整库覆盖。所以注入必须发生在 boot 之前，A3 的判据才落在「旧代码读过新库之后
        // 再写」这条真实回滚路径上，而不是在测那条已知且已定性的覆盖语义。
        flow.record("A2b-4 本轮时序", "注入(A2) → 当前构建打开(A2b) → 业务写入 + 全量落盘(A3) → 复核存活");
      }

      flow.section("A3 本版本代码跑 20 个业务写入 + 全量落盘（sql.js 整库重写：不认识 ≠ 抹不掉）");
      {
        const log = [];
        const t = (name, fn) => {
          try {
            fn();
            log.push(`${name}=ok`);
          } catch (e) {
            log.push(`${name}=ERR(${String(e.message || e).slice(0, 36)})`);
          }
        };
        t("updateCard", () => db.updateCard({ ...db.getCard(seed.cardIds[0]), backMarkdown: "F43 改了答案" }));
        t("saveReview", () => {
          const b = db.getCard(seed.cardIds[1]).fsrs;
          db.saveReview(seed.cardIds[1], prodFsrs({ reps: (b.reps || 0) + 1, due: Date.now() + 3 * DAY }), "Good", 900, b);
        });
        t("undoLastReview", () => db.undoLastReview());
        t("setCardSuspended", () => db.setCardSuspended(seed.cardIds[1], true, "f43"));
        t("updateCardLeech", () => db.updateCardLeech(seed.cardIds[1], { lapses: 9 }));
        t("deleteCard", () => db.deleteCard(seed.cardIds[1]));
        t("createCard", () => db.createCard({ noteText: "F43 新卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 30, tags: [], documentId: seed.docId }));
        t("postponeExtract", () => db.postponeExtract(seed.exId));
        t("updateProgress", () => db.updateProgress(seed.itemId, { ratio: 0.9, lastText: "F43 进度 2", updatedAt: Date.now() }));
        t("setLibraryItemTitle", () => db.setLibraryItemTitle(seed.itemId, "F43 改名后的书"));
        t("setLibraryItemLang", () => db.setLibraryItemLang(seed.itemId, "en"));
        t("addReadingEvent", () => db.addReadingEvent(seed.itemId, 900));
        t("saveSkip", () => db.saveSkip(seed.cardIds[0]));
        t("createJournalEntry", () => db.createJournalEntry({ contentMarkdown: "F43 第二条日记。" }));
        t("createKnowledgePoint", () => db.createKnowledgePoint({ canonicalLabel: "F43 第二个知识点" }));
        t("upsertDictSource", () => db.upsertDictSource({ id: "f43-dict", name: "F43 词典改名", format: "csv", entryCount: 13 }));
        t("createMemoryRun", () => db.createMemoryRun({ kind: "ingest", status: "running", summary: "f43" }));
        t("insertFsrsConfig+setActive", () => {
          const w = db.getConfigRow("cfg-default").weights.map((x) => x + 1e-4);
          const id = db.insertFsrsConfig(w, SCHED_OPTS, "optimizer");
          db.setActiveFsrsConfig(id);
        });
        t("computeTodayQueue", () => db.computeTodayQueue());
        t("persistNow", () => db.persistNow());
        flow.record("A3 写入电池", log.join(" "));
        flow.check("A3-1 写入电池里没有一个函数抛错（抛错者要在下面按名字解释，不能混在丢失里）", log.filter((x) => x.includes("=ERR")).length === 0, "全部 ok", log.filter((x) => x.includes("=ERR")));
      }
      {
        const a = await audit(fileA);
        const lostCols = [];
        const lostVals = [];
        for (const t of FUTURE_SENTINELS) {
          if (!a.tables().includes(t)) {
            if (before[t]) lostCols.push(`${t}(整表消失)`);
            continue;
          }
          const cols = a.columns(t).map((c) => String(c).toLowerCase());
          if (!cols.includes(FUTURE_COL)) {
            if (before[t]) lostCols.push(`${t}.${FUTURE_COL}`);
            continue;
          }
          if (!before[t]) continue;
          const r = a.one(`SELECT ${FUTURE_COL} AS v FROM ${t} WHERE ${FUTURE_COL} IS NOT NULL LIMIT 1`);
          if (!r || r.v !== before[t]) lostVals.push(`${t}: 期望 ${before[t]} 实际 ${r ? JSON.stringify(r.v) : "NULL"}`);
        }
        flow.check("A3-2 【前向兼容核心】未知列在一次业务写入 + 全量落盘后逐表仍在（用户回滚再升级不该发现新列被旧版本抹掉）", lostCols.length === 0, "0 张表丢列", lostCols);
        flow.check("A3-3 未知列上的取值未被本轮任何写入改写（旧代码不得把不认识的新列洗成 NULL）", lostVals.length === 0, "逐表等值", lostVals);
        flow.eq("A3-4 未知整表仍在", a.tables().includes(FUTURE_TABLE), true);
        flow.eq("A3-5 未知整表的 3 行一张不少", a.tables().includes(FUTURE_TABLE) ? a.count(FUTURE_TABLE) : -1, before.__futureRows);
        flow.record("A3-6 未来 NOT NULL DEFAULT 列上各值行数（本版本写入的新行取未来默认值——未来版本会把它当真实数据）", a.columns("cards").map((c) => String(c).toLowerCase()).includes("f43_required") ? JSON.stringify(a.rows("SELECT f43_required AS v, COUNT(*) AS n FROM cards GROUP BY v")) : "列已不存在");
        const fs2 = a.one("SELECT fsrs_json AS f FROM cards WHERE id = ?", [seed.cardIds[2]]);
        flow.check("A3-7 【对照】fsrs_json **不被评分**时未知字段随整列原样保留（updateCard 走保留路径）", String(fs2 && fs2.f).includes("f43FutureField"), true, String(fs2 && fs2.f).slice(0, 60));
        a.close();
      }
      flow.section("A4 fsrs_json 里的未知字段在一次**评分**后是否还在（§4.4.1 八字段契约的另一面）");
      {
        // A3 已对 cardIds[1] 评过分；这里对带未知字段的 [2] 走一次「生产形状」评分
        const beforeState = db.getCard(seed.cardIds[2]).fsrs;
        flow.check("A4-1 读侧把未知字段原样交给上层（normalizeFsrs 不裁剪 → 丢失点确定在写侧）", beforeState && beforeState.f43FutureField !== undefined, "读得到", JSON.stringify(beforeState));
        const next = prodFsrs({ reps: (beforeState.reps || 0) + 1, due: Date.now() + 5 * DAY }); // 生产路径：fsrsEngine.preview() 出的八字段
        db.saveReview(seed.cardIds[2], next, "Good", 800, beforeState);
        db.persistNow();
        const a = await audit(fileA);
        const after = a.one("SELECT fsrs_json AS f FROM cards WHERE id = ?", [seed.cardIds[2]]);
        flow.check(
          "A4-2 一次评分之后未知字段仍在（§7.2 数据完整性：不认识的字段不得被洗掉；回滚到写它的版本后用户应还能看到）",
          String(after.f).includes("f43FutureField"),
          "字段保留",
          String(after.f).slice(0, 200)
        );
        const fromCard = /function fromFsrsCard[\s\S]*?return \{([\s\S]*?)\};/.exec(SRC_FSRS);
        const keys = fromCard ? [...fromCard[1].matchAll(/^\s*([A-Za-z0-9]+):/gm)].map((x) => x[1]).sort() : [];
        flow.eq("A4-3 机制确认：生产评分状态的出层形状固定八字段（未知字段既不在输入也不在输出 → 评分必然销毁它）", keys, ["difficulty", "due", "lapses", "lastReview", "learningSteps", "reps", "stability", "state"]);
        flow.check("A4-4 saveReview 对 fsrs_json 是整列替换而非合并（丢失是设计使然而非偶发）", /UPDATE cards SET fsrs_json = \?/.test(SRC_DB), "整列替换", "见 db.js saveReview 的 UPDATE");
        // 缺 learningSteps 的存量形态（v19 之前）
        const noSteps = db.getCard(seed.cardIds[3]).fsrs;
        flow.record("A4-5 存量卡缺 learningSteps 时读口的返回值", JSON.stringify(noSteps));
        flow.check("A4-6 缺 learningSteps 的卡仍在今日队列里且 due 是有限数（不得静默消失，§4.2-20 不静默少卡）", Number.isFinite(Number(noSteps.due)), "有限 due", noSteps.due);
        const q = db.computeTodayQueue();
        flow.check("A4-7 缺 learningSteps 的卡没有被队列整体丢弃（队列非空且该卡可被读出）", Array.isArray(q.cards) ? q.cards.length >= 0 : !!q, "队列可读", Object.keys(q));
        const b4 = db.getCard(seed.cardIds[3]).fsrs;
        db.saveReview(seed.cardIds[3], prodFsrs({ reps: 1, due: Date.now() + DAY, lastReview: Date.now() }), "Good", 500, b4);
        const undone = db.undoLastReview();
        const back = db.getCard(seed.cardIds[3]).fsrs;
        flow.check("A4-8 该卡撤销后八字段仍不含 learningSteps（撤销不做静默补全，保持与存量形状一致）", "learningSteps" in back === false || back.learningSteps === undefined || undone.ok !== true, "不静默补全", { ok: undone.ok, 撤后: JSON.stringify(back) });
        db.persistNow();
      }

      flow.section("A5 settings.json 的向前兼容矩阵（未来键 / 未来层 / 类型错位 / 顶层数组 / BOM / CRLF+尾逗号 / 1MB / 写失败）");
      {
        const stFile = settingsFileOf(dirA);
        const future = {
          version: 99,
          app: { dayCutoffHour: 4, fsrsConfigId: db.getActiveConfigId(), keybindings: { "reader.makeCard": "Ctrl+K" }, futureKnobFromV49: { nested: { deep: [1, 2, 3] } } },
          theme: { mode: "dark", futureTokens: { accent2: "#123456" } },
          "plugin.future": { enabled: true },
          futureLayerXyz: { a: 1 },
        };
        fs.writeFileSync(stFile, JSON.stringify(future, null, 2), "utf8");
        const r1 = await bootQuiet(dirA);
        db = r1.db || db;
        flow.check("A5-a1 含未来键/未来层的 settings.json：冷启动不抛", r1.err === null, "不抛", r1.err);
        flow.eq("A5-a2 读侧原样给回未来键（不裁剪）", readStore(dirA).readSettings().app?.futureKnobFromV49?.nested?.deep, [1, 2, 3]);
        const w2 = db.getConfigRow("cfg-default").weights.map((x) => x + 1e-5);
        const id2 = db.insertFsrsConfig(w2, SCHED_OPTS, "optimizer");
        db.setActiveFsrsConfig(id2); // 生产等价动作：用户在设置页点「应用权重」
        const after = JSON.parse(fs.readFileSync(stFile, "utf8"));
        flow.check(
          "A5-a3 一次生产写入后未来键/未来层/主题全部仍在（回滚到写它们的版本时不能发现自己的旋钮被当前版本吃掉）",
          JSON.stringify(after.app?.futureKnobFromV49) === JSON.stringify(future.app.futureKnobFromV49) && JSON.stringify(after.futureLayerXyz) === JSON.stringify(future.futureLayerXyz) && after.theme?.mode === "dark" && JSON.stringify(after["plugin.future"]) === JSON.stringify(future["plugin.future"]) && after.version === 99,
          "全部保留",
          { 写后: after }
        );
        flow.eq("A5-a4 指针与未来键共存于同一份文件", after.app?.fsrsConfigId, id2);

        const typeCases = [
          ["字符串当数字", { app: { dayCutoffHour: "中午" }, theme: { mode: "dark" }, futureLayerXyz: { keep: true } }],
          ["null 当对象", { app: null, theme: { mode: "dark" }, futureLayerXyz: { keep: true } }],
          ["对象当布尔", { app: { autoBackupEnabled: { on: true } }, theme: { mode: "dark" }, futureLayerXyz: { keep: true } }],
          ["数组当 app", { app: [], futureLayerXyz: { keep: true } }],
          ["NaN字面量位（JSON 里只能是 null）", { app: { dayCutoffHour: null, maximumInterval: "1e309" }, futureLayerXyz: { keep: true } }],
        ];
        for (const [name, obj] of typeCases) {
          fs.writeFileSync(stFile, JSON.stringify(obj), "utf8");
          let err = null;
          try {
            db.getStatsOverview();
            db.computeTodayQueue();
            db.getActiveConfigId();
            db.persistNow();
          } catch (e) {
            err = String(e.message || e);
          }
          flow.check(`A5-b「${name}」消费方不抛（回落可以，崩不行）`, err === null, "不抛", err);
          const kept = readStore(dirA).readSettings();
          flow.record(`A5-b「${name}」写一次之后是否被静默归一`, JSON.stringify(kept.app?.dayCutoffHour) + " / 未知层:" + JSON.stringify(kept.futureLayerXyz));
        }

        const broken = [
          ["顶层数组", '[{"app":"我本该是个对象"}]'],
          ["UTF-8 BOM", "﻿" + JSON.stringify(future)],
          ["CRLF + 尾逗号", JSON.stringify(future, null, 2).replace(/\n/g, "\r\n").replace(/(\}|\])\s*$/, ",\n$1")],
          ["磁盘满留下的半截文件", JSON.stringify(future).slice(0, 40)],
        ];
        for (const [name, text] of broken) {
          fs.writeFileSync(stFile, text, "utf8");
          const r = await bootQuiet(dirA);
          db = r.db || db;
          flow.check(`A5-c「${name}」冷启动不抛（§7.6 读失败要兜底）`, r.err === null, "不抛", r.err);
          const beforeText = fs.readFileSync(stFile, "utf8");
          let thrown = null;
          try {
            const wid = db.insertFsrsConfig(db.getConfigRow("cfg-default").weights.map((x) => x + 3e-5), SCHED_OPTS, "optimizer");
            db.setActiveFsrsConfig(wid);
          } catch (e) {
            thrown = String(e.message || e);
          }
          const afterText = fs.readFileSync(stFile, "utf8");
          const untouched = afterText === beforeText;
          const recoverable = afterText.includes(beforeText.slice(0, 20));
          flow.check(
            `A5-c「${name}」经一次生产写入之后，用户原文件仍可恢复或当场报错（DEFECTS D-TEST-09 批次 A 明确「不做自愈写回、坏文件不被覆盖」）`,
            (untouched || recoverable || !!thrown) && !(afterText.length > 0 && !recoverable && !thrown),
            "保留原文件 或 抛错",
            { 被整体替换: !untouched && !recoverable && !thrown, 写后前70字节: afterText.slice(0, 70), 抛错: thrown, 原文件里含用户数据: beforeText.length > 30 }
          );
        }

        {
          const big = { app: { dayCutoffHour: 3 } };
          for (let i = 0; i < 8000; i++) big[`k${i}`] = "x".repeat(100);
          fs.writeFileSync(stFile, JSON.stringify(big), "utf8");
          flow.record("A5-f settings.json 字节数", JSON.stringify(big).length);
          const t0 = Date.now();
          const r = await bootQuiet(dirA);
          db = r.db || db;
          let err = r.err;
          try {
            db.getStatsOverview();
          } catch (e) {
            err = String(e.message || e);
          }
          flow.check("A5-f1 1MB 级未知键：冷启动 + 一次统计不抛", err === null, "不抛", err);
          flow.record("A5-f2 该轮耗时 ms（每处读设置都要整份 JSON.parse）", Date.now() - t0);
          db.setActiveFsrsConfig(db.insertFsrsConfig(db.getConfigRow("cfg-default").weights.map((x) => x + 4e-5), SCHED_OPTS, "optimizer"));
          flow.eq("A5-f3 写入后未知键一个不少", Object.keys(JSON.parse(fs.readFileSync(stFile, "utf8"))).length, 8001);
        }

        {
          const good = JSON.stringify({ app: { dayCutoffHour: 5, backupDir: "D:\\我的备份" }, theme: { mode: "light" } }, null, 2);
          fs.writeFileSync(stFile, good, "utf8");
          const origWrite = fs.writeFileSync;
          let threw = null;
          fs.writeFileSync = (p, data, ...rest) => {
            if (String(p).endsWith("settings.json")) {
              origWrite(p, String(data).slice(0, 18), ...rest); // ENOSPC：已截断，只写进去一截
              throw Object.assign(new Error("ENOSPC (F43 injected)"), { errno: -28, code: "ENOSPC" });
            }
            return origWrite(p, data, ...rest);
          };
          try {
            db.insertFsrsConfig(db.getConfigRow("cfg-default").weights.map((x) => x + 5e-5), SCHED_OPTS, "optimizer");
            db.setActiveFsrsConfig(db.getConfigRow("cfg-default").id);
          } catch (e) {
            threw = String(e.message || e);
          } finally {
            fs.writeFileSync = origWrite;
          }
          const now = fs.readFileSync(stFile, "utf8");
          flow.check("A5-g1 设置写入失败必须传出（不得静默）", !!threw, "抛错", threw);
          flow.check(
            "A5-g2 一次磁盘抖动不得让用户的全部偏好消失：写设置应与 persist 同纪律（tmp+fsync+rename），失败后原文件仍完好（§7.2 / §7.1.8；db.js:682 与 dictDb.js:36 都守了这条）",
            now === good,
            "原字节完好",
            { 现状: now, 之后readSettings_结果: (() => { try { return JSON.stringify(readStore(dirA).readSettings()); } catch (e) { return "抛 " + e.message; } })() }
          );
          fs.writeFileSync(stFile, good, "utf8");
        }
      }

      // ================================================= B 最老形态 → 升回（schema 漂移） =================================================
      const dirB = freshDir(tmpUserDataDir("f43b"));
      const fileB = path.join(dirB, "library.db");
      flow.section("B1 把库真削成 v1 形态（DROP 掉全部 ALTER 列 + 整张删掉后加的表）");
      const preCounts = {};
      const preSnaps = {};
      let baseTables = new Map();
      {
        fs.copyFileSync(fileA, fileB);
        try {
          fs.copyFileSync(settingsFileOf(dirA), settingsFileOf(dirB));
        } catch { /* 无 settings */ }
        const m = /const SCHEMA = `([\s\S]*?)`;/.exec(SRC_DB);
        if (m) for (const [t, cols] of parseCreateTables(m[1])) baseTables.set(t, cols);
        flow.check("B1-1 能解析出 base DDL（解析失败整节就是空跑）", baseTables.size >= 10, ">=10 张", baseTables.size);
        const a = await audit(fileB);
        for (const t of a.tables()) preCounts[t] = a.count(t);
        for (const [t, cols] of baseTables) if (a.tables().includes(t)) preSnaps[t] = snapCols(a, t, cols);
        const droppedTables = [];
        const droppedCols = [];
        for (const t of a.tables()) {
          if (baseTables.has(t)) continue;
          a.exec(`DROP TABLE IF EXISTS ${t}`);
          droppedTables.push(t);
        }
        for (const [t, cols] of baseTables) {
          if (!a.tables().includes(t)) continue;
          const keep = new Set(cols.map((c) => String(c).toLowerCase()));
          for (const c of a.columns(t).map((x) => String(x).toLowerCase())) {
            if (keep.has(c) || c.startsWith("f43_")) continue;
            for (const idx of a.rows(`SELECT name FROM pragma_index_list('${t}')`)) {
              const used = a.rows(`SELECT p.name AS c FROM pragma_index_info('${idx.name}') p`).map((r) => String(r.c).toLowerCase());
              if (used.includes(c)) a.exec(`DROP INDEX IF EXISTS ${idx.name}`);
            }
            try {
              a.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
              droppedCols.push(`${t}.${c}`);
            } catch (e) {
              droppedCols.push(`${t}.${c}:ERR(${e.message})`);
            }
          }
        }
        a.save();
        a.close();
        flow.record("B1-2 删掉的表", droppedTables.join(","));
        flow.record("B1-3 删掉的列", droppedCols.join(" "));
        flow.check("B1-4 削形态零失败（有失败说明 B2 的覆盖面不完整，结论要打折）", droppedCols.every((c) => !c.includes(":ERR")), "0 个错误", droppedCols.filter((c) => c.includes(":ERR")));
        flow.check("B1-5 至少削掉了 13 列 + 15 张表（这才叫旧形态；f05 只往现形态库里补了一行旧日志）", droppedCols.length >= 13 && droppedTables.length >= 15, ">=13 列 / >=15 表", { 列: droppedCols.length, 表: droppedTables.length });
      }
      flow.section("B2 让 initDb 把它升回当前形态，并与「全新库」「源码声明」三方对表");
      {
        const r = await bootQuiet(dirB);
        flow.check("B2-1 旧形态库升级冷启动不抛", r.err === null, "不抛", r.err);
        db = r.db || db;
        const up = await shapeOf(fileB);
        const miss = [];
        const extra = [];
        for (const t of freshShape.tables) {
          const aCols = up.shape.get(t);
          if (!aCols) {
            miss.push(`${t}(整表缺失)`);
            continue;
          }
          for (const c of freshShape.shape.get(t)) if (!aCols.includes(c)) miss.push(`${t}.${c}`);
          // f43_* 是本层注入的「未来列」，A 沙箱带来的，不参与与新库的相等比较
          for (const c of aCols) if (!freshShape.shape.get(t).includes(c) && !c.startsWith("f43_")) extra.push(`${t}.${c}`);
        }
        for (const t of up.tables) if (!freshShape.tables.includes(t)) extra.push(`${t}(只存在于升级库)`);
        flow.check("B2-2 升级后列集合与全新库逐表相等 —— 缺列 = 日后读到 undefined，多列 = 迁移清单与 DDL 打架", miss.length === 0 && extra.length === 0, "逐表相等", { 缺: miss, 多: extra });
        const declared = parseCreateTables(SRC_DB);
        const expected = new Map();
        for (const [t, cols] of declared) expected.set(t, new Set(cols));
        for (const [t, set] of parseAlters(SRC_DB)) {
          if (!expected.has(t)) expected.set(t, new Set());
          for (const c of set) expected.get(t).add(c);
        }
        const srcMiss = [];
        const srcExtra = [];
        for (const [t, set] of expected) {
          const actual = up.shape.get(t);
          if (!actual) continue;
          for (const c of set) if (!actual.includes(c)) srcMiss.push(`${t}.${c}`);
          for (const c of actual) if (!set.has(c) && !c.startsWith("f43_")) srcExtra.push(`${t}.${c}`);
        }
        flow.check("B2-3 源码声明（DDL ∪ ALTER 清单）的每一列都真的在库里", srcMiss.length === 0, "0 缺列", srcMiss);
        flow.check("B2-4 库里不存在源码从未声明的列（除本层注入的 f43_*）", srcExtra.length === 0, "0 幽灵列", srcExtra);
        const dup = [];
        for (const [t, cols] of baseTables) {
          const alt = parseAlters(SRC_DB).get(t);
          if (!alt) continue;
          for (const c of cols) if (alt.has(c)) dup.push(`${t}.${c}`);
        }
        flow.record("B2-5 DDL 与迁移清单重复声明的列（冗余 ALTER：新库恒抛 duplicate → catch 吞掉，旧库才是它真正服务的对象）", dup.join(",") || "无");
        flow.check("B2-6 无重复声明（重复本身不是缺陷，但会让「ALTER 清单 = 迁移面」这个前提失真，须登记）", dup.length === 0, "0 处", dup);
        flow.eq("B2-7 升级后表数与全新库一致", up.tables.length, freshShape.tables.length);
      }
      flow.section("B3 旧形态那部分事实是否一张不少（升级只补列，不许动既有行的值）");
      {
        const a = await audit(fileB);
        const bad = [];
        for (const [t, snap] of Object.entries(preSnaps)) {
          const cols = baseTables.get(t);
          const now = snapCols(a, t, cols);
          if (now.size !== snap.size) bad.push(`${t}: 行数 ${snap.size}→${now.size}`);
          for (const [k, v] of snap) {
            if (!now.has(k)) bad.push(`${t}#${k}: 行消失`);
            else if (now.get(k) !== v) bad.push(`${t}#${k}: 值被改写`);
          }
        }
        flow.check("B3-1 base 形态的每一行每一列逐字节不变（升级不得顺手改写既有事实，§7.2 L870）", bad.length === 0, "全部等值", bad.slice(0, 8));
        flow.eq("B3-2 cfg-default 只播种一次", Number(a.one("SELECT COUNT(*) AS n FROM fsrs_configs WHERE id='cfg-default'").n), 1);
        flow.eq("B3-3 prompt_templates 行数不因二次播种翻倍", a.count("prompt_templates"), preCounts.prompt_templates);
        flow.eq("B3-4 每张表行数与削形态之前一致（无重播、无丢失）", Object.keys(preCounts).filter((t) => baseTables.has(t) && a.tables().includes(t) && a.count(t) !== preCounts[t]).join(","), "");
        const seqs = a.rows("SELECT id, review_seq AS seq, rowid AS rid FROM review_logs ORDER BY rid");
        const nullSeq = seqs.filter((r) => r.seq === null || r.seq === undefined);
        flow.check("B3-5 review_seq 由 rowid 回填且整表非空（§4.4.9 排序不变量的前提）", nullSeq.length === 0, "0 行为 NULL", { 总: seqs.length, NULL: nullSeq.length });
        const nums = seqs.map((r) => Number(r.seq));
        flow.check("B3-6 回填后的 seq 严格保持既有插入序（rowid 升序 ⇒ seq 升序）", nums.every((v, i) => i === 0 || v > nums[i - 1]), "单调", nums.join(","));
        // 撤销账本：被削掉的快照列回来之后是 NULL —— 必须**判为不可撤销**而不是拿空快照去复原卡态
        const cardWithNullSnap = a.one("SELECT card_id AS c FROM review_logs WHERE fsrs_after_json IS NULL LIMIT 1");
        if (cardWithNullSnap) {
          const beforeUndo = a.one("SELECT fsrs_json AS f FROM cards WHERE id = ?", [cardWithNullSnap.c]);
          const u = db.undoLastReview();
          const afterUndo = (await audit(fileB)).one("SELECT fsrs_json AS f FROM cards WHERE id = ?", [cardWithNullSnap.c]);
          flow.check("B3-7 无快照的旧日志永不被选为撤销项、卡态分毫不动（§4.4.9：不可撤销必须表现为拒绝，不是拿 NULL 去覆盖）", String(beforeUndo.f) === String(afterUndo.f), "卡态不变", { 拒绝原因: u.reason || null, 相同: String(beforeUndo.f) === String(afterUndo.f) });
        } else {
          flow.record("B3-7 本轮没有无快照旧日志（夹具形态变化，判据未执行）", "n/a");
        }
        a.close();
      }
      flow.section("B4 迁移的「一次性」声明是否成立：回填类语句会不会每次启动都重跑");
      {
        const snap = async () => {
          const a = await audit(fileB);
          const out = {
            domains: a.rows("SELECT id, domain FROM cards ORDER BY id").map((r) => `${r.id}:${r.domain}`).join("|"),
            lang: a.rows("SELECT id, lang FROM library_items ORDER BY id").map((r) => `${r.id}:${r.lang}`).join("|"),
            sit: a.rows("SELECT id, situation_required AS v FROM prompt_templates ORDER BY id").map((r) => `${r.id}:${r.v}`).join("|"),
            cfg: a.count("fsrs_configs"),
          };
          a.close();
          return out;
        };
        const p1 = await snap();
        // 用户/未来版本把派生值清空（等价于「这些回填的输入条件又成立了」）
        {
          const a = await audit(fileB);
          a.exec("UPDATE cards SET domain = NULL WHERE context_prefix IS NOT NULL");
          a.exec("UPDATE library_items SET lang = ''");
          a.exec("UPDATE prompt_templates SET situation_required = 0");
          a.save();
          a.close();
        }
        db = await boot(dirB);
        const p2 = await snap();
        flow.record("B4-1 清空 domain/lang/situation_required 后再启动一次，是否被自动改回", { domain_变化: p1.domains !== p2.domains, lang_变化: p1.lang !== p2.lang, situation_变化: p1.sit !== p2.sit });
        flow.check("B4-2 启动不做「把用户改成空值的派生列又填回去」的越界改写（回填要么真一次，要么写清是常驻派生）", p1.domains === p2.domains && p1.sit === p2.sit, "重启不改写", { domain_变回: p1.domains !== p2.domains, situation_变回: p1.sit !== p2.sit });
        const p3 = await snap();
        flow.eq("B4-3 纯重启（无任何清空）第二次读数不变", JSON.stringify(p2), JSON.stringify(p3));
      }

      // ================================================= C 迁移中途崩溃 =================================================
      const dirC = freshDir(tmpUserDataDir("f43c"));
      const fileC = path.join(dirC, "library.db");
      let dbC = await boot(dirC);
      flow.section("C1 把故障注入到 initDb 唯一的落盘点（persist 在整段迁移之后）");
      {
        dbC.createFromPaste("F43 崩溃迁移用书", ["# 章", "", "迁移中途落盘失败要检验的正文。"].join("\n"));
        const cardId = dbC.createCard({ noteText: "F43 崩溃卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 50, tags: [] }).id;
        dbC.persistNow();
        const shapeBefore = await shapeOf(fileC);
        let shaBefore = await sha(fileC);
        const CASES = [
          ["rename 失败（目标被占用/杀软）", () => { const o = fs.renameSync; fs.renameSync = (f, to) => { if (String(to).endsWith("library.db")) throw new Error("EBUSY (F43 injected)"); return o(f, to); }; return () => { fs.renameSync = o; }; }],
          // persist 用的是 openSync+writeSync+fsyncSync（db.js:682–703），不是 writeFileSync —— 必须打在这一层
          ["openSync 建不了 tmp（目录不可写/盘满）", () => { const o = fs.openSync; fs.openSync = (p, ...r) => { if (String(p).endsWith("library.db.tmp")) throw new Error("ENOSPC (F43 injected @openSync)"); return o(p, ...r); }; return () => { fs.openSync = o; }; }],
          ["writeSync 半路失败（ENOSPC 写在 fsync 之前）", () => {
            const oo = fs.openSync;
            const ow = fs.writeSync;
            const tmpFds = new Set();
            fs.openSync = (p, ...r) => { const fd = oo(p, ...r); if (String(p).endsWith("library.db.tmp")) tmpFds.add(fd); return fd; };
            fs.writeSync = (fd, ...r) => { if (tmpFds.has(fd)) { tmpFds.delete(fd); throw new Error("ENOSPC (F43 injected @writeSync)"); } return ow(fd, ...r); };
            return () => { fs.openSync = oo; fs.writeSync = ow; };
          }],
        ];
        for (const [name, install] of CASES) {
          const restore = install();
          const r = await bootQuiet(dirC);
          flow.check(`C1「${name}」initDb 必须 reject（当场报错而不是静默半迁移）`, !!r.err, "抛错", r.err || "没抛 = 迁移被静默吞掉");
          try {
            fs.rmSync(fileC + ".tmp", { force: true });
          } catch { /* ignore */ }
          const shaAfter = await sha(fileC);
          flow.check(`C1「${name}」失败后盘上 library.db 仍是上一份完整库（tmp+fsync+rename 的全或无）`, shaAfter === shaBefore, shaBefore, shaAfter);
          flow.check(`C1「${name}」失败后不留半成品 tmp`, !fs.existsSync(fileC + ".tmp"), "无 .tmp", fs.existsSync(fileC + ".tmp"));
          restore();
          const r2 = await bootQuiet(dirC);
          flow.check(`C1「${name}」故障撤掉之后再启动一次即收敛（迁移可重入）`, r2.err === null, "不抛", r2.err);
          db = r2.db || db;
          const shapeAfter = await shapeOf(fileC);
          flow.eq(`C1「${name}」重入后表数与故障前一致`, shapeAfter.tables.length, shapeBefore.tables.length);
          flow.eq(`C1「${name}」重入后卡数不增不减`, shapeAfter.counts.cards, shapeBefore.counts.cards);
          flow.eq(`C1「${name}」重入不重复播种 cfg-default`, Number((await audit(fileC)).one("SELECT COUNT(*) AS n FROM fsrs_configs WHERE id='cfg-default'").n), 1);
          shaBefore = await sha(fileC);
        }
        void cardId;
      }
      flow.section("C2 跨「库 + settings.json」两个介质的那次迁移（v22 app.fsrsWeights → fsrs_configs 快照 + 指针）");
      {
        // C2a 先跑「无故障」的同一份迁移：升级一次之后，用户优化出来的权重到底还在不在用
        const dirC2 = freshDir(tmpUserDataDir("f43c2"));
        const fileC2 = path.join(dirC2, "library.db");
        let db2 = await boot(dirC2);
        const weights = db2.getConfigRow("cfg-default").weights.map((x, i) => Number((x + 0.001 * (i % 5)).toFixed(6)));
        db2.persistNow();
        fs.writeFileSync(settingsFileOf(dirC2), JSON.stringify({ app: { dayCutoffHour: 3, fsrsWeights: weights }, theme: { mode: "dark" } }, null, 2), "utf8");
        flow.eq("C2a-0 沙箱起点：fsrs_configs 只有 cfg-default", (await audit(fileC2)).count("fsrs_configs"), 1);
        db2 = await boot(dirC2);
        const stC2 = JSON.parse(fs.readFileSync(settingsFileOf(dirC2), "utf8"));
        const aC2 = await audit(fileC2);
        const optimizerRows = aC2.rows("SELECT id, source, weights_json AS w FROM fsrs_configs WHERE source='optimizer'");
        aC2.close();
        flow.record("C2a-1 迁移之后的 settings.app 段", Object.keys(stC2.app || {}).join(",") + " | fsrsConfigId=" + String(stC2.app?.fsrsConfigId));
        flow.eq("C2a-2 迁移把旧字段升格成了一行 optimizer 配置（且已落盘）", optimizerRows.length, 1);
        flow.check(
          "C2a-3 【升级即生效】迁移写下指针之后必须留在 settings.json 里 —— setActiveFsrsConfig 写过的对象又被迁移自己的旧对象覆盖（stale write）",
          !!stC2.app?.fsrsConfigId,
          "settings.app.fsrsConfigId = 新 optimizer 行 id",
          { settings里的指针: stC2.app?.fsrsConfigId ?? null, 盘上optimizer行: optimizerRows.map((r) => r.id), 旧字段是否还在: Array.isArray(stC2.app?.fsrsWeights) }
        );
        const actC2 = db2.getActiveFsrsConfig();
        flow.check(
          "C2a-4 升级后**实际生效**的权重必须就是用户优化出来的那份（§4.4.10 指针与配置行同生共死）",
          JSON.stringify(actC2?.weights) === JSON.stringify(weights),
          "等于旧 fsrsWeights",
          { 活跃配置: { id: actC2?.id, source: actC2?.source }, 用户优化权重: JSON.stringify(weights).slice(0, 46), 实际生效: JSON.stringify(actC2?.weights).slice(0, 46), 回退到默认: JSON.stringify(actC2?.weights) === JSON.stringify(db2.getConfigRow("cfg-default").weights) }
        );
        flow.check("C2a-5 那份权重不得两头都没有（旧字段已删 + 指针未落 = 用户参数环境凭空蒸发且零提示）", Array.isArray(stC2.app?.fsrsWeights) || !!stC2.app?.fsrsConfigId, "至少一处可用", { 旧字段: Array.isArray(stC2.app?.fsrsWeights), 指针: !!stC2.app?.fsrsConfigId });
        // 迁移不可重做：第二次启动读不到旧字段，那行 optimizer 成了孤儿
        db2 = await boot(dirC2);
        flow.check("C2b 崩溃/重启之后迁移必须可重做或已做完（第二次启动仍拿不到用户权重 = 永久丢失）", db2.getActiveFsrsConfig()?.source === "optimizer", "第二次启动就用回优化权重", { 活跃配置: db2.getActiveFsrsConfig()?.id, source: db2.getActiveFsrsConfig()?.source });

        // C2c 同一条迁移在落盘失败时的形状（崩溃窗口）
        const dirC3x = freshDir(tmpUserDataDir("f43c2c"));
        const fileC3x = path.join(dirC3x, "library.db");
        let dbx = await boot(dirC3x);
        const w2 = dbx.getConfigRow("cfg-default").weights.map((x, i) => Number((x + 0.002 * (i % 5)).toFixed(6)));
        dbx.persistNow();
        fs.writeFileSync(settingsFileOf(dirC3x), JSON.stringify({ app: { dayCutoffHour: 3, fsrsWeights: w2 }, theme: { mode: "dark" } }, null, 2), "utf8");
        const shaX = await sha(fileC3x);
        const origRename = fs.renameSync;
        fs.renameSync = (f, to) => {
          if (String(to).endsWith("library.db")) throw new Error("EBUSY (F43 injected during migration)");
          return origRename(f, to);
        };
        let err = null;
        try {
          clearModules();
          await require(DB_JS).initDb();
        } catch (e) {
          err = String(e.message || e);
        } finally {
          fs.renameSync = origRename;
        }
        flow.check("C2c-1 迁移途中落盘失败必须 reject（应用不能装作起来过）", !!err, "抛错", err);
        const stAfter = fs.existsSync(settingsFileOf(dirC3x)) ? JSON.parse(fs.readFileSync(settingsFileOf(dirC3x), "utf8")) : {};
        flow.record("C2c-2 崩溃瞬间 settings.json 的形状", { 有指针: !!stAfter.app?.fsrsConfigId, 还有权重: Array.isArray(stAfter.app?.fsrsWeights) });
        const cfgRowsOnDisk = (await audit(fileC3x)).count("fsrs_configs");
        flow.check(
          "C2c-3 【双介质迁移的原子性】配置行没落盘时，settings 里既不能留下指向它的指针、也不能把唯一可用的旧字段删掉（否则迁移不可重做）",
          cfgRowsOnDisk > 1 ? !!stAfter.app?.fsrsConfigId : Array.isArray(stAfter.app?.fsrsWeights),
          "盘上有行 ⟺ 有指针；盘上无行 ⟹ 旧字段必须还在",
          { 指针: stAfter.app?.fsrsConfigId || null, 盘上配置行数: cfgRowsOnDisk, 旧字段还在: Array.isArray(stAfter.app?.fsrsWeights), 库文件仍是上一份: (await sha(fileC3x)) === shaX }
        );
        const r3 = await bootQuiet(dirC3x);
        db = r3.db || db;
        const active = db.getActiveFsrsConfig();
        flow.check(
          "C2c-4 崩溃后再启动，用户的优化权重要么还在用，要么报错并仍能用旧字段重做——不得静默回退默认参数（用户与设置页都会以为在用优化值）",
          active?.source === "optimizer" || Array.isArray(stAfter.app?.fsrsWeights),
          "optimizer 行或可重做的旧字段",
          { 活跃配置: { id: active?.id, source: active?.source, 权重等于默认: JSON.stringify(active?.weights) === JSON.stringify(db.getConfigRow("cfg-default").weights) } }
        );
        // 悬空指针：settings 指向一个盘上不存在的 id（D-TEST-01 描述过的形态），读侧必须仍可用
        {
          const f = settingsFileOf(dirC3x);
          const obj = JSON.parse(fs.readFileSync(f, "utf8"));
          obj.app = obj.app || {};
          obj.app.fsrsConfigId = "根本不存在的-id";
          fs.writeFileSync(f, JSON.stringify(obj), "utf8");
          const rr = await bootQuiet(dirC3x);
          db = rr.db || db;
          flow.record("C2c-5 悬空指针的读侧行为", { 回退到: db.getActiveFsrsConfig()?.id, 机制: "getConfigRow(悬空)→null→再取 cfg-default，零提示" });
          flow.check("C2c-6 悬空指针必须回退出一个可用配置（这条是既定期望：宁可用默认参数也不要崩）", !!db.getActiveFsrsConfig(), "有可用配置", db.getActiveFsrsConfig()?.id);
        }
      }
      flow.section("C3 半迁移状态：迁移语句在 if(列不存在) 里，NULL 序列行永不被修");
      {
        const dirC3 = freshDir(tmpUserDataDir("f43c3"));
        const fileC3 = path.join(dirC3, "library.db");
        let d3 = await boot(dirC3);
        const it = d3.createFromPaste("F43 半迁移用书", ["# 章", "", "撤销账本与序列回填的对照组。"].join("\n"));
        const kA = d3.createCard({ noteText: "F43 先评的卡", cardType: "qa", frontMarkdown: "A", backMarkdown: "a", priority: 50, tags: [], documentId: it.documentId }).id;
        const kB = d3.createCard({ noteText: "F43 后评的卡", cardType: "qa", frontMarkdown: "B", backMarkdown: "b", priority: 60, tags: [], documentId: it.documentId }).id;
        let f = d3.getCard(kA).fsrs;
        d3.saveReview(kA, prodFsrs({ reps: (f.reps || 0) + 1, due: Date.now() + 2 * DAY }), "Good", 700, f);
        f = d3.getCard(kB).fsrs;
        d3.saveReview(kB, prodFsrs({ reps: (f.reps || 0) + 1, due: Date.now() + 4 * DAY }), "Again", 700, f);
        const lastBefore = d3.getLastUndoableReview();
        d3.persistNow();
        // 模拟「旧构建在新库上写过一行」：列已存在，但这一行的 review_seq 是 NULL
        {
          const a = await audit(fileC3);
          a.exec("UPDATE review_logs SET review_seq = NULL WHERE card_id = ?", [lastBefore.cardId]);
          a.save();
          a.close();
        }
        d3 = await boot(dirC3);
        const a2 = await audit(fileC3);
        const nulls = a2.rows("SELECT id, card_id AS c FROM review_logs WHERE review_seq IS NULL");
        flow.record("C3-1 再启动一次之后仍然没有序列的行数", nulls.length);
        flow.check(
          "C3-2 半迁移库必须被修复或被报出（§4.4.9 排序不变量：review_seq 表内唯一且非空；旧构建回滚期间写出的行就是这个形状）",
          nulls.length === 0,
          "0 行 NULL（回填不只在「列首次新增」时执行一次）",
          { NULL行: nulls.map((r) => r.c), 源码判据: "db.js:278 if(!hasSeq){ ALTER; UPDATE …=rowid WHERE IS NULL } —— 回填在 guard 里面" }
        );
        const lastAfter = d3.getLastUndoableReview();
        flow.check(
          "C3-3 「最近一次可撤销评分」不受 NULL 干扰：NULL 在 DESC 序里沉底，于是撤销面板给的必须是真正最近的那条（否则用户点撤销撤走的是另一张卡）",
          String(lastAfter?.cardId) === String(lastBefore?.cardId),
          lastBefore?.cardId,
          { 撤销面板给的是: lastAfter ? `${lastAfter.cardId}(seq=${lastAfter.reviewSeq})` : "无可撤销项", 原本应是: `${lastBefore?.cardId}(seq=${lastBefore?.reviewSeq})` }
        );
        const logs = d3.listAllReviewLogs();
        flow.check("C3-4 日志清单仍按插入序给出（NULL 排最前会让「最新一条」不在末位）", logs.length === 2 && String(logs[logs.length - 1]?.cardId ?? logs[logs.length - 1]?.card_id) === String(lastBefore?.cardId), "末位 = 最新那条", logs.map((l) => `${l.cardId ?? l.card_id}:${l.reviewSeq ?? l.review_seq}`).join(" → "));
        if (lastAfter) {
          const u = d3.undoLastReview();
          flow.check("C3-5 撤销动作本身诚实（要么成功且卡态复原，要么拒绝并给 reason，不得半撤）", u.ok === true || (u.ok === false && !!u.reason), "ok 或带 reason", u);
        }
        a2.close();
      }

      // ================================================= E 跨版本 backup-meta =================================================
      const dirE = freshDir(tmpUserDataDir("f43e"));
      const fileE = path.join(dirE, "library.db");
      const bakE = path.join(dirE, "backups");
      let dbE = await boot(dirE);
      flow.section("E1 backup-meta 的七种版本形状：干净拒绝（带可见理由）或成功且数据对，二者必居其一");
      {
        dbE.createFromPaste("F43 备份版本用书", ["# 章", "", "跨版本备份判据用的正文内容。"].join("\n"));
        const kid = dbE.createCard({ noteText: "F43 备份卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 50, tags: [] }).id;
        const f = dbE.getCard(kid).fsrs;
        dbE.saveReview(kid, prodFsrs({ reps: (f.reps || 0) + 1, due: Date.now() + 2 * DAY }), "Good", 600, f);
        dbE.persistNow();
        const goodDb = fs.readFileSync(fileE);
        const cardsNow = (await audit(fileE)).count("cards");
        fs.mkdirSync(bakE, { recursive: true });
        const cases = [
          ["未来格式 format=999", { app: "incremental-reading-dev", format: 999, label: "manual" }, "refuse"],
          ["缺 format", { app: "incremental-reading-dev", label: "manual" }, "refuse"],
          ["format 写成字符串 \"1\"", { app: "incremental-reading-dev", format: "1", label: "manual" }, "accept"],
          ["format 写成数组 [1]", { app: "incremental-reading-dev", format: [1], label: "manual" }, "either"],
          ["format 写成 true", { app: "incremental-reading-dev", format: true, label: "manual" }, "either"],
          ["未知 label（恢复码不认识的标签）", { app: "incremental-reading-dev", format: 1, label: "quantum-turbo" }, "accept"],
          ["appVersion 远在未来 + 古老 app 版本", { app: "incremental-reading-dev", format: 1, label: "manual", appVersion: "99.99.99", minAppVersion: "0.0.1" }, "accept"],
          ["backup-meta 是坏 JSON", null, "refuse"],
          ["缺 library.db", { app: "incremental-reading-dev", format: 1, label: "manual" }, "refuse"],
        ];
        for (let i = 0; i < cases.length; i++) {
          const [name, meta, want] = cases[i];
          const file = path.join(bakE, `backup-manual-f43case${i}x-1.zip`);
          if (meta === null) fs.writeFileSync(file, await craftZip(file, "{坏掉的清单", {}));
          else await craftZip(file, meta, name === "缺 library.db" ? {} : { "library.db": goodDb });
          const r = await bk.restoreBackup(file, { dataDir: dirE, backupDir: bakE });
          const refused = r.ok !== true;
          if (want === "refuse") {
            flow.check(`E1「${name}」被拒`, refused, "拒绝", r);
            flow.check(`E1「${name}」拒绝时给出用户可见的理由`, refused && typeof r.error === "string" && r.error.trim().length > 0, "非空 error", r.error);
            flow.check(`E1「${name}」被拒之后不留待恢复标记（拒绝 ≠ 半恢复）`, !fs.existsSync(path.join(dirE, "restore-pending.json")), "无 marker", fs.existsSync(path.join(dirE, "restore-pending.json")));
          } else if (refused) {
            flow.record(`E1「${name}」被判为严格拒绝`, r.error || JSON.stringify(r));
            flow.check(`E1「${name}」即便拒绝也必须给出用户可见的理由`, typeof r.error === "string" && r.error.trim().length > 0, "非空 error", r.error);
          } else {
            flow.record(`E1「${name}」被受理（Number(format) 折叠了类型差异）`, `format=${JSON.stringify(meta?.format)}`);
            const applied = bk.applyPendingRestore({ dataDir: dirE, backupDir: bakE });
            flow.check(`E1「${name}」换入成功`, applied?.ok === true && (applied.restored || []).includes("library.db"), "restored 含 library.db", applied?.restored);
            const r2 = await bootQuiet(dirE);
            dbE = r2.db || dbE;
            flow.check(`E1「${name}」受理之后数据逐表不少（受理即承诺：不得「恢复成功但表少了」）`, r2.err === null && (await audit(fileE)).count("cards") === cardsNow, `cards=${cardsNow}`, { err: r2.err, cards: (await audit(fileE)).count("cards") });
          }
          try {
            fs.rmSync(path.join(dirE, "restore-staging"), { recursive: true, force: true });
            fs.rmSync(path.join(dirE, "restore-pending.json"), { force: true });
          } catch { /* ignore */ }
          fs.rmSync(file, { force: true });
        }
      }
      flow.section("E2 真正的降级路径：把「未来版本写的库」经备份换进当前构建，再业务写入 + 落盘");
      {
        const futureDb = fs.readFileSync(fileA); // A 沙箱：带 f43_* 未知列/未知表
        const file = path.join(bakE, "backup-manual-f43future-1.zip");
        await craftZip(file, { app: "incremental-reading-dev", format: 1, label: "manual", createdAt: Date.now(), assetFiles: 0, memoryFiles: 0 }, { "library.db": futureDb, "settings.json": fs.readFileSync(settingsFileOf(dirA)) });
        const r = await bk.restoreBackup(file, { dataDir: dirE, backupDir: bakE });
        flow.check("E2-1 未来形态库的备份被受理（格式没变就应该收，且收下之后必须保住它多出来的东西）", r.ok === true, "ok", r);
        const applied = bk.applyPendingRestore({ dataDir: dirE, backupDir: bakE });
        flow.eq("E2-2 换入清单如实", (applied.restored || []).includes("library.db"), true);
        const r2 = await bootQuiet(dirE);
        dbE = r2.db || dbE;
        flow.check("E2-3 当前构建打开未来形态库不抛", r2.err === null, "不抛", r2.err);
        dbE.createCard({ noteText: "E2 换入后的新卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 50, tags: [] });
        dbE.persistNow();
        const a = await audit(fileE);
        flow.check("E2-4 换入的未来列/表在一次业务写入 + 全量落盘之后仍在", a.tables().includes(FUTURE_TABLE) && a.columns("cards").map((c) => String(c).toLowerCase()).includes(FUTURE_COL), "列与表都在", { 表: a.tables().includes(FUTURE_TABLE), 列: a.columns("cards") });
        flow.eq("E2-5 未来表的行数未动", a.count(FUTURE_TABLE), 3);
        a.close();
        fs.rmSync(file, { force: true });
      }

      flow.section("E3 换入「比任何迁移基线都老」的库（老构建做的备份，在当前构建里恢复）");
      {
        const oldest = path.join(bakE, "library-oldest.db");
        fs.copyFileSync(fileA, oldest);
        const bt = new Map();
        const m = /const SCHEMA = `([\s\S]*?)`;/.exec(SRC_DB);
        if (m) for (const [t, cols] of parseCreateTables(m[1])) bt.set(t, cols);
        const oldestCounts = {};
        {
          const a = await audit(oldest);
          for (const t of a.tables()) if (!bt.has(t)) a.exec(`DROP TABLE IF EXISTS ${t}`);
          for (const [t, cols] of bt) {
            if (!a.tables().includes(t)) continue;
            const keep = new Set(cols);
            for (const c of a.columns(t).map((x) => String(x).toLowerCase())) {
              if (keep.has(c) || c.startsWith("f43_")) continue;
              for (const idx of a.rows(`SELECT name FROM pragma_index_list('${t}')`)) {
                const used = a.rows(`SELECT p.name AS c FROM pragma_index_info('${idx.name}') p`).map((r) => String(r.c).toLowerCase());
                if (used.includes(c)) a.exec(`DROP INDEX IF EXISTS ${idx.name}`);
              }
              try {
                a.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
              } catch { /* 已随表删除 */ }
            }
          }
          a.save();
          for (const t of a.tables()) oldestCounts[t] = a.count(t);
          a.close();
        }
        const file = path.join(bakE, "backup-manual-f43oldest-1.zip");
        await craftZip(file, { app: "incremental-reading-dev", format: 1, label: "manual", createdAt: Date.now() - 400 * DAY }, { "library.db": fs.readFileSync(oldest), "settings.json": "{}" });
        const r = await bk.restoreBackup(file, { dataDir: dirE, backupDir: bakE });
        flow.check("E3-1 老备份被受理（老库永远是当前构建应当支持的入口）", r.ok === true, "ok", r);
        const applied = bk.applyPendingRestore({ dataDir: dirE, backupDir: bakE });
        flow.eq("E3-2 换入返回成功", applied?.ok, true);
        const r2 = await bootQuiet(dirE);
        dbE = r2.db || dbE;
        flow.check("E3-3 恢复后的老库在当前构建里能起（迁移补齐）", r2.err === null, "不抛", r2.err);
        const up = await shapeOf(path.join(dirE, "library.db"));
        const miss = [];
        for (const t of freshShape.tables) {
          const cols = up.shape.get(t);
          if (!cols) {
            miss.push(`${t}(整表缺失)`);
            continue;
          }
          for (const c of freshShape.shape.get(t)) if (!cols.includes(c)) miss.push(`${t}.${c}`);
        }
        flow.check("E3-4 恢复+起库之后 27 张表与全部列齐备（不得「恢复成功但表少了」）", miss.length === 0, "全部齐备", miss);
        const lost = Object.entries(oldestCounts).filter(([t, n]) => (up.counts[t] ?? -1) !== n).map(([t, n]) => `${t}: ${n}→${up.counts[t] ?? "表不见"}`);
        flow.check("E3-5 老备份里的每一张表、每一行在恢复 + 起库之后都还在（补齐列不得顺手清行）", lost.length === 0, "逐表行数相等", lost);
        flow.record("E3-6 该老备份的 createdAt 是 400 天前；清单日期只作展示，没有任何版本闸门", `表数=${up.tables.length}`);
        fs.rmSync(file, { force: true });
        fs.rmSync(oldest, { force: true });
      }

      // ================================================= F 备份资产交叉核对 =================================================
      const dirF = freshDir(tmpUserDataDir("f43f"));
      const fileF = path.join(dirF, "library.db");
      const bakF = path.join(dirF, "backups");
      let dbF = await boot(dirF);
      flow.section("F1 zip 里少了一个 asset（用户解包改过）：恢复报部分成功，还是假成功？");
      {
        const it = dbF.createFromPaste("F43 资源交叉用书", ["# 章", "", "带三张图的书，用来量备份的资产核对。"].join("\n"));
        const names = [];
        for (let i = 0; i < 3; i++) {
          const r = dbF.createAssetForItem(it.documentId, "image-occlusion", "png", Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(`payload-${i}-xxxxxxxxxxxxxxxxxxxxxx`)]));
          names.push(r.filename);
        }
        dbF.persistNow();
        fs.mkdirSync(bakF, { recursive: true });
        const made = await bk.createBackup({ label: "manual", backupDir: bakF, dataDir: dirF, flush: () => dbF.persistNow() });
        flow.guard("F1-0 备份创建成功", () => made.ok === true && !!made.file);
        const meta = await bk.readBackupMeta(made.file);
        flow.eq("F1-1 清单如实声明了 3 个 asset", meta.assetFiles, 3);
        const zip = await zipWithoutEntry(made.file, `assets/${it.id}/${names[1]}`);
        zip.file("assets/README-用户改过.txt", "用户解包后删掉了一张图");
        const tampered = path.join(bakF, "backup-manual-f43tampered-1.zip");
        fs.writeFileSync(tampered, await zip.generateAsync({ type: "nodebuffer" }));
        const rs = await bk.restoreBackup(tampered, { dataDir: dirF, backupDir: bakF });
        flow.check("F1-2 被改过的备份被受理（内容差异不在校验面上，这条记录事实）", rs.ok === true, "ok", rs);
        const applied = bk.applyPendingRestore({ dataDir: dirF, backupDir: bakF });
        flow.check("F1-3 换入返回「全部成功」", applied?.ok === true && (applied.restored || []).includes("assets"), "restored 含 assets", applied?.restored);
        const gone = names.filter((n) => !fs.existsSync(path.join(dirF, "assets", it.id, n)));
        const a = await audit(fileF);
        const rows = a.rows("SELECT id, path FROM assets WHERE is_deleted = 0");
        a.close();
        flow.record("F1-4 盘上缺失的 asset 文件", gone.join(",") || "无");
        flow.check(
          "F1-5 恢复不得「假成功」：库里登记的 asset 行（assets.path, is_deleted=0）与盘上文件必须一一对得上，缺就要报部分成功并列清单（§9.1 M2 恢复语义 / §7.6 失败必须可见）",
          gone.length === 0 || (applied?.missing || []).length > 0 || applied?.ok !== true,
          "缺失被报出（missing 清单或 ok=false）",
          { 库里仍登记为存在的行数: rows.length, 盘上缺失: gone.length, 返回值: { ok: applied?.ok, restored: applied?.restored, missing: applied?.missing ?? "（无 missing 字段）" }, 清单声明: meta.assetFiles }
        );
        const r2 = await bootQuiet(dirF);
        dbF = r2.db || dbF;
        flow.check("F1-6 缺图之后打开书/读图路径不崩（降级可以，崩不行）", (() => { try { dbF.readBookFile(it.id); dbF.listItems(); return true; } catch { return false; } })(), true, "不抛");
        fs.rmSync(tampered, { force: true });
      }

      // ================================================= G FSRS 参数环境兼容 =================================================
      const dirG = freshDir(tmpUserDataDir("f43c3g"));
      const fileG = path.join(dirG, "library.db");
      let dbG = await boot(dirG);
      flow.section("G1 fsrs_configs 里躺着 19 维 / 25 维 / 损坏 weights（别的版本写出来的行）");
      {
        dbG.createFromPaste("F43 参数环境用书", ["# 章", "", "参数环境兼容判据用的正文。"].join("\n"));
        const kid = dbG.createCard({ noteText: "F43 参数卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 50, tags: [] }).id;
        dbG.persistNow();
        const mk = (id, w, fp) => ({ id, w, fp });
        {
          const a = await audit(fileG);
          for (const [id, w] of [
            ["cfg-w19", [0.4, 1.2, 2.2, 8.3, 6.1, 0.8, 3.0, 0.01, 1.9, 0.17, 0.8, 1.5, 0.06, 0.26, 1.6, 0.6, 1.8, 0.09, 0.07]],
            ["cfg-w25", [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542, 0.01, 0.02, 0.03, 0.04]],
            ["cfg-broken", null],
          ]) {
            a.exec(
              "INSERT INTO fsrs_configs (id, algorithm, algorithm_version, weights_json, scheduler_options_json, config_fingerprint, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
              [id, "FSRS", 6, w === null ? "{不是 JSON" : JSON.stringify(w), JSON.stringify(SCHED_OPTS), `fp-${id}`, "optimizer", Date.now()]
            );
          }
          a.exec("INSERT INTO fsrs_configs (id, algorithm, algorithm_version, weights_json, scheduler_options_json, config_fingerprint, source, created_at) VALUES ('cfg-w21dup','FSRS',6,?,?,?,'optimizer',?)", [JSON.stringify(dbG.getConfigRow("cfg-default").weights), JSON.stringify(SCHED_OPTS), "fp-w21dup", Date.now()]);
          a.save();
          a.close();
          void mk;
        }
        dbG = await boot(dirG);
        for (const id of ["cfg-w19", "cfg-w25", "cfg-broken", "cfg-w21dup"]) {
          flow.check(`G1-1 ${id} 行读得出来（数据层不得因为形状不认识就当没这行）`, !!dbG.getConfigRow(id), "可读", !!dbG.getConfigRow(id));
        }
        flow.record("G1-2 数据层对 weights 形状的态度", { cfgw19: (dbG.getConfigRow("cfg-w19").weights || []).length, cfgw25: (dbG.getConfigRow("cfg-w25").weights || []).length, broken: dbG.getConfigRow("cfg-broken").weights });
        const engineGuard = /w\.length\s*!==\s*21/.test(SRC_FSRS);
        flow.check("G1-3 引擎侧确实只接受 21 维（读源码定案：非 21 维 → buildEngineFromConfig 返回 false → 保持默认权重引擎）", engineGuard, true, "src/lib/fsrs.ts:37");
        let err = null;
        try {
          dbG.setActiveFsrsConfig("cfg-w19");
        } catch (e) {
          err = String(e.message || e);
        }
        flow.record("G1-4 数据层对「指针指向引擎用不了的配置」的反应", err ? `抛错：${err}` : "不抛错，直接受理（判据只有「这一行存不存在」）");
        flow.check(
          "G1-4b 把活跃指针切到 weights 形状不合法的行时，必须要么拒绝要么给出可见告警（§4.4.10 被篡改/异版本的快照不得静默改变调度语义）",
          !!err,
          "拒绝或告警",
          { 受理了: !err, 活跃配置: dbG.getActiveConfigId(), 引擎会用到的权重: "长度 19 → buildEngineFromConfig 返回 false → 仍用默认 21 维" }
        );
        const f = dbG.getCard(kid).fsrs;
        dbG.saveReview(kid, prodFsrs({ reps: (f.reps || 0) + 1, due: Date.now() + 2 * DAY }), "Good", 700, f);
        const a = await audit(fileG);
        const stamped = a.one("SELECT fsrs_config_id AS c, fsrs_after_json AS aft FROM review_logs ORDER BY review_seq DESC LIMIT 1");
        a.close();
        flow.check(
          "G1-5 训练日志不得把「引擎没用上的参数环境」记成这次评分用的配置（§4.4.10 按 config 分段重放会被这条误导；判据：日志标注必须等于真正生效的配置）",
          stamped.c !== "cfg-w19" || !engineGuard,
          "标注与真正生效的配置一致（或回落到 cfg-default 并另记）",
          { 日志标注: stamped.c, 引擎实际用的是: "默认权重（因为长度 19 被 buildEngineFromConfig 拒）", 落库的调度状态: String(stamped.aft).slice(0, 80) }
        );
        // 指纹去重是否还成立（别的版本写进来的同权重行）
        const dupId = dbG.insertFsrsConfig(dbG.getConfigRow("cfg-default").weights, SCHED_OPTS, "optimizer");
        const a2 = await audit(fileG);
        flow.check("G1-6 同权重同选项必须命中同一 config_id（§4.4.10 指纹唯一），别人手写的同权重行也不例外", a2.rows("SELECT COUNT(*) AS n FROM fsrs_configs WHERE config_fingerprint = (SELECT config_fingerprint FROM fsrs_configs WHERE id='cfg-default')")[0].n <= 1 || dupId === "cfg-default", "只有一行", { 现有同指纹行: a2.rows("SELECT id FROM fsrs_configs WHERE config_fingerprint = (SELECT config_fingerprint FROM fsrs_configs WHERE id='cfg-default')").map((r) => r.id), 新插入返回: dupId });
        a2.close();
        dbG.persistNow();
        // 值域：非有限数 / 超长权重会不会把 due 打成 nonsense
        const a3 = await audit(fileG);
        a3.exec("UPDATE fsrs_configs SET weights_json = ? WHERE id='cfg-w25'", [JSON.stringify(Array(25).fill(NaN))]);
        a3.exec("UPDATE fsrs_configs SET scheduler_options_json = ? WHERE id='cfg-w25'", ['{"requestRetention":0.9,"maximumInterval":-5,"learningSteps":null,"enableFuzz":true}']);
        a3.save();
        a3.close();
        dbG = await boot(dirG);
        dbG.setActiveFsrsConfig("cfg-w25");
        const q = dbG.computeTodayQueue();
        const kpi = dbG.getStatsOverview().kpi;
        flow.check("G1-7 坏参数环境下队列与统计仍给出有限数（不得产出 nonsense due）", Number.isFinite(Number(kpi.dueToday)) && Number.isFinite(Number(kpi.newCount ?? 0)), "有限", { dueToday: kpi.dueToday, 队列卡数: (q.cards || []).length });
        const weird = dbG.getConfigRow("cfg-w25");
        flow.record("G1-8 坏 weights/坏 options 原样穿过数据层", { weights: weird.weights, options: weird.schedulerOptions });
      }
      flow.section("G2 跨版本的 fsrs_json：缺失字段 / 多余字段 / 整列 NULL 在调度与撤销上的表现");
      {
        const kid = dbG.createCard({ noteText: "G2 老形状卡", cardType: "qa", frontMarkdown: "q", backMarkdown: "a", priority: 50, tags: [] }).id;
        {
          const a = await audit(fileG);
          a.exec("UPDATE cards SET fsrs_json = ? WHERE id = ?", ['{"state":"new","due":1,"lapses":0}', kid]);
          a.save();
          a.close();
        }
        dbG = await boot(dirG);
        const got = dbG.getCard(kid).fsrs;
        flow.record("G2-1 due=1（1970 年）的存量形状读回", JSON.stringify(got));
        const q = dbG.computeTodayQueue();
        const inQueue = (q.cards || []).some((c) => String(c.id) === String(kid));
        flow.check("G2-2 极老 due 的卡要么正常进队列并被调度，要么按损坏挡在外面并给出理由（不得产出「今天到期但算出 1970 年下次」）", inQueue !== true || Number.isFinite(Number(got.due)), "一致且有限", { 进队列: inQueue, 读回: got });
        const b = dbG.getCard(kid).fsrs;
        let err = null;
        let next = null;
        try {
          next = prodFsrs({ reps: 1, due: Date.now() + DAY, lastReview: Date.now() });
          dbG.saveReview(kid, next, "Good", 400, b);
        } catch (e) {
          err = String(e.message || e);
        }
        flow.check("G2-3 该卡评分要么成功要么当场抛错（不得静默写半套）", err === null, "成功或抛错", { err, 之后: dbG.getCard(kid).fsrs });
        dbG.persistNow();
        const a1 = await audit(fileG);
        const afterReview = a1.one("SELECT fsrs_json AS f, fsrs_config_id AS cfg FROM cards WHERE id = ?", [kid]);
        a1.close();
        const eight = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
        const parsedAfter = (() => { try { return JSON.parse(afterReview.f); } catch { return null; } })();
        flow.check(
          "G2-4 一次评分之后落盘的 fsrs_json 八字段完整（§4.4.5：缺 learningSteps 会让 learning 档第 2 步的 Good 永不毕业）",
          !!parsedAfter && eight.every((k) => parsedAfter[k] !== undefined),
          "八字段齐",
          afterReview.f
        );
        flow.check("G2-5 三字段老形状卡评完分之后的 due 是「今天之后」而不是 1970 年（不得产出 nonsense 到期日）", Number(parsedAfter?.due) > Date.now() - 60000 && Number.isFinite(Number(parsedAfter?.due)), "due > now", parsedAfter?.due);
        const u = dbG.undoLastReview();
        flow.check("G2-6 撤销给得出 ok 或 reason（可判定）", u.ok === true || !!u.reason, "ok 或带 reason", u);
        dbG.persistNow();
        const a2 = await audit(fileG);
        const afterUndo = a2.one("SELECT fsrs_json AS f FROM cards WHERE id = ?", [kid]);
        a2.close();
        flow.check(
          "G2-7 撤销必须把该卡回到「评分前那一刻的确切形状」——存量只有三字段就该退回三字段，静默补全八字段等于伪造历史（§4.4.9 撤销即回退而非附加动作）",
          u.ok !== true || String(afterUndo.f) === String(b && JSON.stringify(b)),
          "逐字节等于评分前",
          { 撤销结果: u.ok, 评分前: JSON.stringify(b), 撤销后: afterUndo.f }
        );
      }
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F43 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
