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

  // ---------- 链丁：跳转语义（子卡「跳转原文」→ 父卡 + 高亮所引那段）----------
  // D1＝根，**不置为到期**（留在应用播种的「下一个学习日」）⇒ 父卡在队列里不可达，走查看态到达才有意义；
  // 正文刻意写长（引文在中段、远超一屏）⇒ 落点「居中」有可测的几何意义，且 D1 自身无范围锚
  // （高亮只可能来自子卡的 parentRange，防止拿父卡自身区间冒充）。
  const D1TARG = "D1TARG 这句是丁链子摘录所引的原文";
  const D1TXT =
    "丁链根-1稿：" +
    "上游铺垫：" +
    PAD.repeat(60) +
    "，其中 " +
    D1TARG +
    "。" +
    PAD.repeat(60) +
    "收尾：范围之后还有一点文字。";
  const D1 = add("document", book.documentId, D1TXT, 90, null, { documentId: book.documentId });
  // D2＝子卡（到期；优先级 40 ⇒ 排在乙6层 / 丙8层之后当队列头）。
  // 正文多行：第 2 段的引文句要能被真鼠标选中 ⇒ 偏移必须把 EditableText 落库口径里的 `<br>` 换行计进去，
  // 少算就会让 parentRange 停在第 1 段（GUI 侧用「切片＝选中文字」正向对照钉死这一点）。
  const D2PICK = "D2PICK这个短语";
  const D2TXT = line("丁4级", 2) + "\n\n" + "第二段：从这里 " + D2PICK + " 到那里，这段要被引。\n\n第三段：尾部不选。";
  const D2 = add("extract", D1, D2TXT, 40, null, {
    documentId: book.documentId,
    extractId: D1,
    parentExtractId: D1,
    rootExtractId: D1,
    parentRange: rangeOf(D1TXT, D1TARG)
  });

  // 生产路径新摘录是**次日进队**；本测试要当日可见 ⇒ 显式置为已到期。
  // 链丁的 D1 **刻意不在名单里**（父卡不可达场景），D2 在。
  const due = ids.filter((x) => x !== D1);
  db.execRawSql(
    `UPDATE extracts SET topic_next_at = ? WHERE id IN (${due.map(() => "?").join(",")})`,
    [Date.now() - 60000, ...due]
  );
  db.persistDb();
  console.log("SEEDED", JSON.stringify({ A1, A2, A3, rootB, rootC, D1, D2, D1TARG, D2PICK, count: ids.length, due: due.length }));
  app.quit();
});
