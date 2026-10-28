// @runtime: electron
// D248 / T10：bdiPull 只读投影白名单 + 领域归因（显式/继承/残差/lang/stale/dirty）（§8.1–§8.3）。
// 运行：npm run build 后 npx electron tests/behavior-domains.test.cjs（或 node scripts/run-tests.mjs behavior-domains）
// 隔离：app.setPath 临时 userData；绝不触碰真实库。
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-domains-"));
  app.setPath("userData", dir);
  const db = require(path.join(ROOT, "electron", "db.js"));
  const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
  const { createDomains } = require(path.join(ROOT, "electron", "behavior", "domains.js"));
  await db.initDb();

  console.log("== A 造数据 ==");
  const item = db.createFromPaste("BDI10 测试书", "# 第一章\n\n正文内容用于领域归因测试。");
  check("建书成功", !!item && !!item.id, "id", item);
  const docs = db.bdiPull({ table: "documents", mode: "scan", limit: 50 });
  const docId = docs[0]?.id;
  check("文档可经 bdiPull 读取", !!docId, "docId", docs);
  const mkCard = (over) => db.createCard({ noteText: "BDI10", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50, contextRef: { documentId: docId }, ...over });
  const c1 = mkCard({ domain: ["51"] });
  const c2 = mkCard({ domain: ["57"] });
  const c3 = mkCard({ domain: ["51"] });
  const kp = db.createKnowledgePoint({ canonicalLabel: "BDI10 KP", domainId: "53" });
  const c4 = mkCard({ knowledgePointId: kp.id });
  const ex = db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "摘录正文", kind: "extract" });
  const c5 = db.createCard({ noteText: "BDI10 ex", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50, contextRef: { documentId: docId, extractId: ex.id }, domain: ["54"] });
  const c6Ex = db.createCard({ noteText: "BDI10 inherit", cardType: "qa", frontMarkdown: "问", backMarkdown: "答", priority: 50, contextRef: { documentId: docId, extractId: ex.id } });
  const trackRes = db.saveLearnerTrack({ mode: "language", label: "英语", lang: "en" });
  check("语言学习轨道创建", trackRes.ok === true, "ok", trackRes);
  db.setTrackMaterial(trackRes.track.id, item.id, 1);

  console.log("== B bdiPull：白名单 / 非法参数 / 分页 / 查询计划 ==");
  const rows = db.bdiPull({ table: "cards", mode: "scan", limit: 50 });
  check("cards 投影非空", rows.length >= 6, ">=6", rows.length);
  const keys = Object.keys(rows[0]).sort();
  const allowed = ["_rowid", "id", "card_type", "domain", "extract_id", "document_id", "knowledge_point_id", "generated_by", "gen_batch_id", "created_at", "updated_at", "is_deleted", "fsrs_config_id"];
  check("cards 投影只含白名单列（无 title/author/正文）", keys.every((k) => allowed.includes(k)), allowed, keys);
  check("投影不带 title/author/front/back", !keys.includes("title") && !keys.includes("frontMarkdown") && !keys.includes("back_markdown"), "无正文列", keys);
  let threw = null;
  try { db.bdiPull({ table: "sqlite_master", mode: "scan" }); } catch (e) { threw = e; }
  check("非法 table 直接拒绝", !!threw, "throw", "未抛");
  threw = null;
  try { db.bdiPull({ table: "cards", mode: "weird" }); } catch (e) { threw = e; }
  check("非法 mode 直接拒绝", !!threw, "throw", "未抛");
  const byIds = db.bdiPull({ table: "cards", mode: "ids", ids: [c1.id, c2.id] });
  check("ids 模式按 id 取（≤200）", byIds.length === 2, 2, byIds.length);
  const page1 = db.bdiPull({ table: "cards", mode: "scan", cursor: 0, limit: 50 });
  const page2 = db.bdiPull({ table: "cards", mode: "scan", cursor: page1[page1.length - 1]._rowid, limit: 50 });
  check("scan 分页不重复（rowid 游标）", !page2.some((r) => page1.some((p) => p.id === r.id)), "无重复", "重复");
  const upd = db.bdiPull({ table: "cards", mode: "updated", cursor: { updatedAt: 0, rowid: 0 }, limit: 100 });
  check("updated 模式按 (updated_at,rowid) 取", upd.length >= 6, ">=6", upd.length);

  const conn = new Database(path.join(dir, "library.db"), { readonly: true });
  const plan = conn.prepare("EXPLAIN QUERY PLAN SELECT rowid AS _rowid, id FROM cards WHERE rowid > ? ORDER BY rowid LIMIT 50").all(0);
  conn.close();
  const planText = plan.map((p) => p.detail).join(" | ");
  console.log("  · EXPLAIN（cards scan）：", planText);
  check("cards scan 命中 rowid 主键（不扫正文）", /INTEGER PRIMARY KEY|rowid/i.test(planText), "rowid 计划", planText);

  console.log("== C 领域归因 ==");
  behaviorDb.configure({ dataDir: dir });
  await behaviorDb.open();
  const bdb = behaviorDb.getDb();
  const domains = createDomains({ db: bdb, pull: db.bdiPull, now: () => 1761609600000 });
  const r1 = domains.refreshAll();
  check("首轮写入实体归因", r1.written >= 6, ">=6", r1);
  const row = (type, id) => bdb.prepare("SELECT * FROM entity_domains WHERE entity_type = ? AND entity_id = ?").get(type, id);
  const parse = (r) => JSON.parse(r.udc_json);
  const card1 = row("card", c1.id);
  check("卡片显式领域→ main=51 / method=card_domain", card1 && card1.udc_main === "51" && card1.method === "card_domain" && card1.quality === "ok", "51/card_domain", card1);
  check("显式单领域权重和=1", card1 && Math.abs(parse(card1).reduce((s, x) => s + x.w, 0) - 1) < 1e-9, 1, card1 && parse(card1));
  const card4 = row("card", c4.id);
  check("无显式领域→ KP 种子（main=53 / method=kp）", card4 && card4.udc_main === "53" && card4.method === "kp", "53/kp", card4);
  const itemRow = row("library_item", item.id);
  check("条目直方图 main=51（3 卡显式：51×2 / 57×1）", itemRow && itemRow.udc_main === "51", "51", itemRow);
  check("条目权重和=1 且保留次领域 57", itemRow && Math.abs(parse(itemRow).reduce((s, x) => s + x.w, 0) - 1) < 1e-9 && parse(itemRow).some((x) => x.code === "57"), "1 + 57", itemRow && parse(itemRow));
  const exRow = row("extract", ex.id);
  check("摘录显式聚合 main=54 / method=extract_cards", exRow && exRow.udc_main === "54" && exRow.method === "extract_cards", "54/extract_cards", exRow);
  const inherit = row("card", c6Ex.id);
  check("摘录下无显式卡继承 54（method=extract_cards，不递归 item）", inherit && inherit.udc_main === "54" && inherit.method === "extract_cards", "54/extract_cards", inherit);
  const trackRow = row("track", trackRes.track.id);
  check("语言轨道→ lang:en（level=lang）", trackRow && trackRow.udc_main === "lang:en" && parse(trackRow)[0].level === "lang", "lang:en", trackRow);
  check("attribution_version 已记录", card1 && card1.attribution_version === 1, 1, card1 && card1.attribution_version);

  const r2 = domains.refreshAll();
  check("第二次刷新幂等（changed=0）", r2.changed === 0, 0, r2.changed);

  console.log("== D 变更 → dirty_days；软删 → stale ==");
  bdb.prepare("INSERT INTO events (uid,ts,recv_ts,day,tz_offset,cutoff_hour,type,src,session_id,card_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("u10", 1, 1, "2026-10-20", -480, 4, "review.shown", "host", "s", c1.id);
  const full = db.getCard(c1.id);
  db.updateCard({ ...full, domain: ["57"] });
  const r3 = domains.refreshAll();
  check("领域变更触发重算（changed≥1）", r3.changed >= 1, ">=1", r3.changed);
  const dirty = bdb.prepare("SELECT day FROM dirty_days WHERE day = '2026-10-20'").get();
  check("实体出现过的 day 被标 dirty", !!dirty, "2026-10-20", dirty);
  db.deleteCard(c2.id);
  domains.refreshAll();
  const stale = row("card", c2.id);
  check("软删实体保留最后已知并标 stale（不删除行）", stale && stale.stale === 1 && stale.quality === "stale", "stale", stale);

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-domains ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  app.exit(1);
});
