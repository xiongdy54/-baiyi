// @runtime: electron  @tier: 2  @gui: false  @id: D233  @timeout: 300
// 运行：npx electron tests/d233-priority-flip.test.cjs（须先关应用）
// v49.62 / D233：优先级方向统一为「数字越大越优先、越先推送」——schemaVersion v5 迁移（p → 100 − p）+ 推送序 DESC。
// 构造：新库上用真 API 造数据（书级默认 / 继承 / 单条覆盖 / 改优先级与推进的操作日志 / 两个引擎子空间）→
//       关库，用独立连接把所有优先级落点改写成「改版前方向」的值、user_version 打回 4（＝v49.61 及以前的库）→
//       按改版前口径（priority ASC）记下推送序 → 重开库触发迁移 → 逐项核对。
// 覆盖：M1 公共列 / 书级默认 / 引擎子空间 / 操作日志全部翻转，闪卡与学习轨道优先级不动；
//       M2 推送序与改版前逐条相同；M3 撤销改版前的「改优先级」写回翻转后的值；M4 切换推送引擎投影翻转后的值；
//       M5 迁移只跑一次；M6 extract-rerank 提示词 v2 为默认、口径＝数字越大越优先，v1 原文留痕。
// 隔离：临时 userData（app.setPath），绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 改版前方向的值（测试侧独立实现，按已知结构逐键改写；迁移侧是通用遍历）
const flip = (v) => (typeof v === "number" ? 100 - v : v);
function oldEngineState(text) {
  if (!text) return text;
  const o = JSON.parse(text);
  for (const k of ["sm19-default", "ai-next-extract"]) if (o[k] && typeof o[k].priority === "number") o[k].priority = flip(o[k].priority);
  return JSON.stringify(o);
}
function oldOp(text) {
  const o = JSON.parse(text);
  if (typeof o.priority === "number") o.priority = flip(o.priority);
  if (o.schedule && typeof o.schedule.priority === "number") o.schedule.priority = flip(o.schedule.priority);
  if (typeof o.engineStateJson === "string") o.engineStateJson = oldEngineState(o.engineStateJson);
  return JSON.stringify(o);
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d233-priority-"));
  const dbFile = path.join(tmp, "library.db");
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const schema = require(path.join(ROOT, "electron", "schemaVersion.js"));
    await db.initDb();
    check("前置：新库版本＝SCHEMA_VERSION＝5", schema.SCHEMA_VERSION === 5, 5, schema.SCHEMA_VERSION);

    // ---- 新库上造数据（全部是「越大越优先」口径的值）----
    const bookA = db.createFromPaste("D233 甲书", "甲书正文");
    const bookB = db.createFromPaste("D233 乙书", "乙书正文");
    db.setLibraryItemPriority(bookA.id, 80); // 甲书重要
    db.setLibraryItemPriority(bookB.id, 20); // 乙书次要
    const mk = (docId, text, priority) =>
      db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: text, priority }).id;
    const eA1 = mk(bookA.documentId, "甲书继承", undefined); // 80（book）
    const eA2 = mk(bookA.documentId, "甲书单条最优先", 90); // 90（user）
    const eB1 = mk(bookB.documentId, "乙书继承", undefined); // 20（book）
    const eB2 = mk(bookB.documentId, "乙书单条", 70); // 70 → 下面改成 40（留一条 set_priority 操作日志）
    const pastDue = Date.now() - 3600000;
    for (const id of [eA1, eA2, eB1, eB2]) db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [pastDue, id]);
    db.setExtractPriority(eB2, 40); // op: before.schedule.priority=70 → after.priority=40
    // 两个引擎子空间都落值（切到实验引擎再切回：源/目标子空间各冻结一份当前投影）
    db.switchExtractEngine("ai-next-extract", "sm19-default");
    db.switchExtractEngine("sm19-default", "ai-next-extract");
    const card = db.createCard({ noteText: "D233 卡", cardType: "qa", frontMarkdown: "D233 问", backMarkdown: "D233 答", priority: 30, tags: [], domain: [] });
    const cardId = typeof card === "string" ? card : card && card.id;
    const newWorld = {
      prio: Object.fromEntries([eA1, eA2, eB1, eB2].map((id) => [id, db.getExtract(id).priority])),
      books: { a: 80, b: 20 }
    };
    db.closeDb();

    // ---- 改写成改版前的库：所有优先级落点按旧方向、user_version=4 ----
    {
      const c = new Database(dbFile);
      try {
        c.transaction(() => {
          c.prepare("UPDATE extracts SET priority = 100 - priority").run();
          c.prepare("UPDATE library_items SET priority = 100 - priority").run();
          for (const r of c.prepare("SELECT id, engine_state_json AS s FROM extracts").all()) {
            if (r.s) c.prepare("UPDATE extracts SET engine_state_json = ? WHERE id = ?").run(oldEngineState(r.s), r.id);
          }
          for (const r of c.prepare("SELECT id, before_json AS b, after_json AS a FROM extract_ops").all()) {
            c.prepare("UPDATE extract_ops SET before_json = ?, after_json = ? WHERE id = ?").run(oldOp(r.b), oldOp(r.a), r.id);
          }
        })();
        c.pragma("user_version = 4");
      } finally { c.close(); }
    }
    const oldOrder = (() => {
      const c = new Database(dbFile, { readonly: true });
      try {
        return c.prepare(
          "SELECT id FROM extracts WHERE is_deleted = 0 AND topic_next_at <= ? ORDER BY priority ASC, topic_next_at ASC"
        ).all(Date.now()).map((r) => r.id);
      } finally { c.close(); }
    })();
    check("前置：改版前口径的推送序＝甲书单条 → 甲书继承 → 乙书单条 → 乙书继承", eq(oldOrder, [eA2, eA1, eB2, eB1]), [eA2, eA1, eB2, eB1], oldOrder);

    // ---- 重开库：触发 v5 迁移 ----
    await db.initDb();
    const raw = new Database(dbFile, { readonly: true });
    try {
      console.log("== M1 全部落点翻转 ==");
      check("user_version 升到 5", Number(raw.pragma("user_version", { simple: true })) === 5, 5, raw.pragma("user_version", { simple: true }));
      const prio = Object.fromEntries([eA1, eA2, eB1, eB2].map((id) => [id, db.getExtract(id).priority]));
      check("摘录公共列回到「越大越优先」的值", eq(prio, newWorld.prio), newWorld.prio, prio);
      const books = raw.prepare("SELECT id, priority FROM library_items WHERE id IN (?, ?)").all(bookA.id, bookB.id);
      const bk = Object.fromEntries(books.map((r) => [r.id === bookA.id ? "a" : "b", r.priority]));
      check("书级默认优先级翻转（甲 80 / 乙 20）", bk.a === newWorld.books.a && bk.b === newWorld.books.b, newWorld.books, bk);
      check("继承型摘录仍与书相等（同翻）", prio[eA1] === bk.a && prio[eB1] === bk.b, `${bk.a}/${bk.b}`, `${prio[eA1]}/${prio[eB1]}`);
      const states = raw.prepare("SELECT id, engine_state_json AS s FROM extracts WHERE id IN (?, ?, ?, ?)").all(eA1, eA2, eB1, eB2);
      const subOk = states.every((r) => {
        const o = JSON.parse(r.s || "{}");
        return ["sm19-default", "ai-next-extract"].every((k) => o[k] && o[k].priority === newWorld.prio[r.id]);
      });
      check("两个引擎子空间的 priority 同翻（＝公共列）", subOk, "全部相等", states.map((r) => [r.id.slice(0, 6), r.s && JSON.parse(r.s)["sm19-default"]?.priority, r.s && JSON.parse(r.s)["ai-next-extract"]?.priority]));
      const op = raw.prepare("SELECT before_json AS b, after_json AS a FROM extract_ops WHERE extract_id = ? AND op_type = 'set_priority'").get(eB2);
      const ob = JSON.parse(op.b), oa = JSON.parse(op.a);
      check("操作日志 before.schedule.priority＝70、after.priority＝40（翻回越大越优先）", ob.schedule.priority === 70 && oa.priority === 40, "70/40", `${ob.schedule.priority}/${oa.priority}`);
      check("操作日志 before 里嵌套的引擎子空间同翻", (() => { const s = JSON.parse(ob.engineStateJson || "null"); return !s || Object.values(s).every((v) => !v || typeof v !== "object" || v.priority === 70); })(), 70, ob.engineStateJson);
      const cardP = raw.prepare("SELECT priority FROM cards WHERE id = ?").get(cardId)?.priority;
      check("闪卡优先级不动（D216 已退役，不在本次翻转范围）", cardP === 30, 30, cardP);
    } finally { raw.close(); }

    console.log("== M2 推送序与改版前逐条相同 ==");
    const due = db.listDueExtracts().filter((e) => [eA1, eA2, eB1, eB2].includes(e.id)).map((e) => e.id);
    check("listDueExtracts（priority DESC）＝改版前序", eq(due, oldOrder), oldOrder, due);
    for (const interleave of ["quota-1-4", "by-due"]) {
      const sq = db.computeSessionQueue(Date.now(), { mergeIntoReview: true, interleave });
      const sqEx = (sq.items || []).filter((it) => it.kind === "extract").map((it) => it.id);
      // by-due：四条同一到期时刻 ⇒ 由优先级决胜（D233 补：此前只按 id 决胜）
      check(`会话队列（${interleave}）的摘录部分＝改版前序`, eq(sqEx, oldOrder), oldOrder, sqEx);
    }

    console.log("== M3 撤销改版前的操作写回翻转后的值 ==");
    const u = db.undoLast();
    check("撤销成功且是摘录操作", u && u.ok && u.kind === "extract_op", "ok extract_op", u);
    check("乙书单条撤回到 70（不是改版前口径的 30）", db.getExtract(eB2).priority === 70, 70, db.getExtract(eB2).priority);

    console.log("== M4 切换推送引擎：投影翻转后的值 ==");
    db.switchExtractEngine("ai-next-extract", "sm19-default");
    const afterSwitch = Object.fromEntries([eA1, eA2, eB1].map((id) => [id, db.getExtract(id).priority]));
    const expectSwitch = { [eA1]: 80, [eA2]: 90, [eB1]: 20 };
    check("切到实验引擎后公共列＝翻转后的值", eq(afterSwitch, expectSwitch), expectSwitch, afterSwitch);
    const aiOrder = db.listDueExtracts().filter((e) => [eA1, eA2, eB1].includes(e.id));
    const { rankExtracts } = require(path.join(ROOT, "electron", "aiNextExtract.js"));
    const ranked = rankExtracts(aiOrder, Date.now()).map((x) => x.id);
    check("实验引擎本地因子：越大越靠前（甲书单条 90 居首、乙书继承 20 垫底）", ranked[0] === eA2 && ranked[ranked.length - 1] === eB1, [eA2, "…", eB1], ranked);
    db.switchExtractEngine("sm19-default", "ai-next-extract");

    console.log("== M5 迁移只跑一次 ==");
    db.closeDb();
    await db.initDb();
    const again = Object.fromEntries([eA1, eA2, eB1].map((id) => [id, db.getExtract(id).priority]));
    check("再开库不再翻转", eq(again, expectSwitch), expectSwitch, again);

    console.log("== M6 extract-rerank 提示词 v2 ==");
    const tpl = db.getPromptTemplate("extract-rerank");
    check("默认模板是 v2", Number(tpl && tpl.version) === 2, 2, tpl && tpl.version);
    check("v2 口径＝数字越大越优先", String(tpl && tpl.content).includes("数字越大越优先") && !String(tpl && tpl.content).includes("数字越小越优先"), "越大越优先", String(tpl && tpl.content).slice(0, 80));
    const v1 = db.getPromptTemplateVersion ? db.getPromptTemplateVersion("extract-rerank", 1) : null;
    check("v1 原文留痕（数字越小越优先）", !db.getPromptTemplateVersion || String(v1 && v1.content).includes("数字越小越优先"), "留痕", v1 && String(v1.content).slice(0, 60));

    console.log(`\n==== d233-priority-flip.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
    console.log(`\n==== d233-priority-flip.test：${pass} 通过 / ${fail} 失败 ====`);
  } finally {
    try { require(path.join(ROOT, "electron", "db.js")).closeDb(); } catch { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    // app.quit() 会先于定时器以 0 退出（失败被报成通过），必须用 app.exit(code) 直接带码退出
    app.exit(fail === 0 ? 0 : 1);
  }
});
