// M16 面包屑 GUI 播种（一次性进程；先建库并造 3 / 6 / 8 三条**已到期**的层级链，再启动真实应用）
// 运行：npx electron tests/breadcrumb.gui.seed.cjs（由 tests/breadcrumb.gui.mjs 自动调用；隔离 userData）
// 口径（规格 §1.2 R13）：层级名＝该层正文首 10 字 ⇒ 每条链的层级正文都写成「<链>-<层>稿：…」，
// 前 10 字天然唯一，GUI 侧按「正文前 10 字 + …」独立复算期望值（不从链 API 反推）。
const { app } = require("electron");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const BOOK_TITLE = "面包屑 GUI 夹具书";
/** 第 level 层的正文（前 10 字唯一：链前缀 + 层号） */
const line = (chain, level, extra = "") => `${chain}-${level}稿：第${level}层的摘录正文样本${extra}`;
/** 把某段标记做成范围锚（相对本条正文的字符偏移） */
const rangeOf = (text, mark) => {
  const at = String(text).indexOf(mark);
  return at >= 0 ? [{ start: at, end: at + String(mark).length }] : null;
};

app.whenReady().then(async () => {
  if (process.env.M7_TEST_USERDATA) app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const book = db.createFromPaste(BOOK_TITLE, "正文内容：这一段用于验证摘录页的面包屑层级导航。");
  const ids = [];
  /** 建一层：parentType/parentId 按链层级给，contextRef 带层级身份（规格 §1.1） */
  const add = (parentType, parentId, text, priority, quoteRange, contextRef) => {
    const r = db.createExtract({
      parentType,
      parentId,
      documentId: book.documentId,
      contentMarkdown: text,
      priority,
      quoteRange,
      contextRef
    });
    if (!r || !r.id) throw new Error(`播种失败：${text.slice(0, 12)}`);
    ids.push(r.id);
    return r.id;
  };

  // ---------- 链甲：3 级（根 → 子 → 孙），孙＝队列头（优先级最低）----------
  // 根层正文刻意写长（>2500 字）：高亮段落在**正文中段**、远超一屏 ⇒ 落点「居中」才有可测的几何意义
  const PAD = "层叠的铺垫文字用来把高亮段推到卡面下方。";
  const A1TXT =
    line("甲3级", 1) +
    "上游铺垫：" +
    PAD.repeat(60) +
    "，其中 ROOTAHL 这段要被范围高亮标出。" +
    PAD.repeat(60) +
    "收尾：范围之后还有一点文字。";
  const A1 = add("document", book.documentId, A1TXT, 90, rangeOf(A1TXT, "ROOTAHL"), { documentId: book.documentId });
  const A2 = add("extract", A1, line("甲3级", 2), 90, null, { documentId: book.documentId, extractId: A1, parentExtractId: A1, rootExtractId: A1 });
  const A3 = add("extract", A2, line("甲3级", 3), 10, null, { documentId: book.documentId, extractId: A2, parentExtractId: A2, rootExtractId: A1 });

  // ---------- 链乙：6 级（边界内＝全显示）----------
  let parentB = book.documentId;
  let parentTypeB = "document";
  let rootB = "";
  for (let i = 1; i <= 6; i++) {
    const isLeaf = i === 6;
    const id = add(parentTypeB, parentB, line("乙6层", i), isLeaf ? 20 : 90, null, {
      documentId: book.documentId,
      ...(parentTypeB === "extract" ? { extractId: parentB, parentExtractId: parentB, rootExtractId: rootB || parentB } : {})
    });
    if (i === 1) rootB = id; // 链根 id（后续层继承它）
    parentB = id;
    parentTypeB = "extract";
  }

  // ---------- 链丙：8 级（>6 ⇒ 必须折叠；第 3 层带范围锚，供折叠项跳转后的落点断言）----------
  let parentC = book.documentId;
  let parentTypeC = "document";
  let rootC = "";
  for (let i = 1; i <= 8; i++) {
    const isLeaf = i === 8;
    const text = i === 3 ? line("丙8层", i, "，其中 PROP8L3HL 这段要被范围高亮标出。") : line("丙8层", i);
    const id = add(parentTypeC, parentC, text, isLeaf ? 30 : 90, i === 3 ? rangeOf(text, "PROP8L3HL") : null, {
      documentId: book.documentId,
      ...(parentTypeC === "extract" ? { extractId: parentC, parentExtractId: parentC, rootExtractId: rootC || parentC } : {})
    });
    if (i === 1) rootC = id;
    parentC = id;
    parentTypeC = "extract";
  }

  // 生产路径新摘录是**次日进队**；本测试要当日可见 ⇒ 显式置为已到期
  db.execRawSql(
    `UPDATE extracts SET topic_next_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
    [Date.now() - 60000, ...ids]
  );
  db.persistDb();
  console.log("SEEDED", JSON.stringify({ A1, A2, A3, rootB, rootC, count: ids.length }));
  app.quit();
});
