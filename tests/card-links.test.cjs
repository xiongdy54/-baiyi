// D121 §1.2 card_links + §3.3 card-disambiguate v1 播种
// @runtime: node
// 运行：node tests/card-links.test.cjs
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cardlinks-test-"));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { getPath: () => tmp, isPackaged: false, getAppPath: () => ROOT } };
  return origLoad.call(this, request, ...rest);
};

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)}`); }
}
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

(async () => {
  try {
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const dbFile = path.join(tmp, "library.db");

    console.log("== A 建表 ==");
    const src = fs.readFileSync(path.join(ROOT, "electron", "db.js"), "utf8");
    check("A1 SCHEMA 含 card_links 建表（四标准列）", /CREATE TABLE IF NOT EXISTS card_links \(/.test(src) && /idx_card_links_a/.test(src) && /idx_card_links_b/.test(src));
    const mkCard = (front) => db.createCard({ cardType: "basic", frontMarkdown: front, backMarkdown: "答案", noteText: front, contextRef: null });
    const c1 = mkCard("优绩主义主张按什么分配社会回报与地位？");
    const c2 = mkCard("优绩社会实际上按什么分配\n  回报？");
    const c3 = mkCard("第三张卡");
    const id1 = c1.id, id2 = c2.id, id3 = c3.id;
    check("A2 夹具卡创建成功", id1 && id2 && id3, [c1, c2, c3]);

    console.log("== B add/update 校验 ==");
    check("B1 非法 verdict 抛错", throws(() => db.addCardLink({ cardA: id1, cardB: id2, verdict: "bogus" })) instanceof Error);
    check("B2 缺 verdict 抛错", throws(() => db.addCardLink({ cardA: id1, cardB: id2 })) instanceof Error);
    check("B3 cardB==cardA 抛错", throws(() => db.addCardLink({ cardA: id1, cardB: id1, verdict: "manual" })) instanceof Error);
    check("B4 cardA 空串抛错", throws(() => db.addCardLink({ cardA: "", cardB: id2, verdict: "manual" })) instanceof Error);
    check("B5 cardB 非字符串非 null 抛错", throws(() => db.addCardLink({ cardA: id1, cardB: 5, verdict: "manual" })) instanceof Error);
    for (const v of ["missing-qualifier", "one-wrong", "duplicate", "confusable", "no-conflict", "insufficient", "manual"]) {
      check(`B6 verdict ${v} 允许`, typeof db.addCardLink({ cardA: id3, cardB: null, verdict: v }) === "string");
    }
    const sizeBefore = fs.statSync(dbFile).size;
    const mtimeBefore = fs.statSync(dbFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const long = "字".repeat(800);
    const lid = db.addCardLink({ cardA: id1, cardB: id2, verdict: "missing-qualifier", note: long });
    check("B7 add 返回 id 字符串", typeof lid === "string" && lid.length > 0, lid);
    let links = db.listCardLinksForCard(id1);
    const mine = links.find((l) => l.id === lid);
    check("B8 note 截断 500", mine && mine.note.length === 500, mine && mine.note.length);

    console.log("== C persist ==");
    const st = fs.statSync(dbFile);
    check("C1 add 后 db 文件已落盘（体积或 mtime 变化）", st.size !== sizeBefore || st.mtimeMs !== mtimeBefore, { sizeBefore, size: st.size });
    const SQLInit = require("sql.js");
    const SQL = await SQLInit();
    const reopen = new SQL.Database(fs.readFileSync(dbFile));
    const rr = reopen.exec("SELECT verdict, user_id FROM card_links WHERE id = '" + lid + "'");
    check("C2 重开磁盘文件可读回该行", rr[0] && rr[0].values[0][0] === "missing-qualifier" && rr[0].values[0][1] === "local-user", rr);
    reopen.close();

    console.log("== D update ==");
    await new Promise((r) => setTimeout(r, 5));
    const upBefore = mine.updatedAt;
    check("D1 update 返回 true", db.updateCardLink(lid, { verdict: "one-wrong", note: "改了" }) === true);
    const after = db.listCardLinksForCard(id1).find((l) => l.id === lid);
    check("D2 update 生效且 updatedAt 增大", after.verdict === "one-wrong" && after.note === "改了" && after.updatedAt > upBefore, after);
    check("D3 update 非法 verdict 抛错", throws(() => db.updateCardLink(lid, { verdict: "x", note: "" })) instanceof Error);
    check("D4 update note 截断 500", db.updateCardLink(lid, { verdict: "manual", note: long }) && db.listCardLinksForCard(id1).find((l) => l.id === lid).note.length === 500);
    check("D5 update 不存在的 id 返回 false", db.updateCardLink("no-such", { verdict: "manual", note: "" }) === false);

    console.log("== E listForCard ==");
    const fromB = db.listCardLinksForCard(id2);
    const lb = fromB.find((l) => l.id === lid);
    check("E1 从 B 侧也能查到", !!lb, fromB);
    check("E2 B 侧 other 为 A（front 取 frontMarkdown）", lb && lb.other && lb.other.id === id1 && lb.other.front.startsWith("优绩主义主张"), lb && lb.other);
    const la = db.listCardLinksForCard(id1).find((l) => l.id === lid);
    check("E3 A 侧 other 为 B，front 空白折叠", la.other.id === id2 && la.other.front === "优绩社会实际上按什么分配 回报？", la.other);
    check("E4 字段齐全", la.cardA === id1 && la.cardB === id2 && typeof la.createdAt === "number" && "docTitle" in la.other, la);
    const longFront = mkCard("长".repeat(100));
    const lid2 = db.addCardLink({ cardA: id3, cardB: longFront.id, verdict: "duplicate", note: "" });
    const l2 = db.listCardLinksForCard(id3).find((l) => l.id === lid2);
    check("E5 front 截断 ≤60", l2.other.front.length === 60, l2.other.front.length);
    const single = db.listCardLinksForCard(id3).find((l) => l.cardB === null);
    check("E6 单卡链接 other=null", single && single.other === null, single);
    const order = db.listCardLinksForCard(id3).map((l) => l.updatedAt);
    check("E7 按 updated_at 倒序", order.every((v, i) => i === 0 || order[i - 1] >= v), order);
    check("E8 无链接返回 []", db.listCardLinksForCard("none").length === 0);

    console.log("== F 软删过滤 ==");
    const before = db.listCardLinksForCard(id1).some((l) => l.id === lid);
    db.deleteCard ? db.deleteCard(id2) : null;
    const stillThere = db.listCardLinksForCard(id1).some((l) => l.id === lid);
    check("F1 对端卡软删后该链接不返回", before === true && stillThere === false, { before, stillThere, hasDelete: !!db.deleteCard });
    db.addCardLink({ cardA: id1, cardB: id3, verdict: "manual", note: "" });
    check("F2 其它链接不受影响", db.listCardLinksForCard(id1).length >= 1);

    console.log("== G 播种 ==");
    db.ensurePromptTemplates();
    db.ensurePromptTemplates();
    const rowsOf = () => { const x = require(path.join(ROOT, "electron", "db.js")); return x.listPromptTemplates().filter((t) => t.scope === "card-disambiguate"); };
    let rows = rowsOf();
    const { CARD_DISAMBIGUATE_PROMPT } = require(path.join(ROOT, "electron", "prompts.js"));
    check("G1 两次 ensurePromptTemplates 后仅 1 行", rows.length === 1, rows.length);
    check("G2 v1/名称/内容", rows[0] && rows[0].version === 1 && rows[0].name === "卡片辨析 v1", rows[0]);
    const tpl = db.getPromptTemplate("card-disambiguate");
    check("G3 getPromptTemplate 可取", tpl && tpl.content === CARD_DISAMBIGUATE_PROMPT, !!tpl);
  } catch (e) {
    fail++;
    console.log("  ✗ 未捕获异常", e && e.stack || e);
  }
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
})();
