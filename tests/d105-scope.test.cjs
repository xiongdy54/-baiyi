// D105 批E 筛选牌组快捷条件 db 层回归（electron 直跑：npx electron tests/d105-scope.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §3.4 + GUIDE §6.8-5/§4.2-26（D105）
// 覆盖：readReviewScopes 归一（tags/kpIds）/ applyScope 过滤矩阵（tags OR·层级前缀·大小写不敏感·两行 kind /
//       kpIds 仅闪卡 + KnowledgeBase 归并族展开 / AND 组合 / 无 scope 退化不变）/ 主进程 tagPathMatches
//       与渲染层 tags.ts 同语义对照 / extractScopeConditions 查询提取
"use strict";
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d105-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const queryBundle = require(path.join(ROOT, "tests", "d105-scope-query.bundle.cjs"));
    const tagsRef = require(path.join(ROOT, "tests", "tags.ref.bundle.cjs"));

    const NOW = Date.now();
    const PAST = Date.parse("2000-01-01T00:00:00Z");
    const fsrsPast = JSON.stringify({ state: "new", due: PAST, lapses: 0 });

    console.log("== D105-S1 readReviewScopes 归一（tags/kpIds） ==");
    const scopeId = "scope-d105-1";
    (function seedScopes() {
      const st = require(path.join(ROOT, "electron", "settingsStore.js"));
      const o = st.readSettings();
      o.app = { ...(o.app || {}), reviewScopes: [
        { id: scopeId, name: "D105 范围", bookItemIds: ["b1"], tags: ["考研::英语", "错题"], kpIds: ["kp-1", "kp-2"], kinds: ["card"], limits: null },
        { id: "s2", name: "旧格式", bookItemIds: ["b2"], kinds: ["card", "extract"] }, // v48.61 前的存量形状
        { id: "s3", name: "脏值", tags: "不是数组", kpIds: 42, kinds: [] }
      ] };
      st.writeSettings(o);
    })();
    const scopes = db.readReviewScopes();
    const s1 = scopes.find((s) => s.id === scopeId);
    check("tags/kpIds 原样归一保留", eq(s1 && { tags: s1.tags, kpIds: s1.kpIds }, { tags: ["考研::英语", "错题"], kpIds: ["kp-1", "kp-2"] }), { tags: ["考研::英语", "错题"], kpIds: ["kp-1", "kp-2"] }, s1);
    const s2 = scopes.find((s) => s.id === "s2");
    check("存量形状缺省 = 不限（向后兼容）", s2 && s2.tags.length === 0 && s2.kpIds.length === 0, "空数组", s2);
    const s3 = scopes.find((s) => s.id === "s3");
    check("脏值回落空数组（不抛）", s3 && Array.isArray(s3.tags) && s3.tags.length === 0 && Array.isArray(s3.kpIds), "空数组", s3);

    console.log("== D105-S2 夹具：两书 + 卡片（带标签/知识点）+ 摘录（带批注标签） ==");
    const book1 = db.createFromPaste("D105 甲书", "甲书正文。");
    const book2 = db.createFromPaste("D105 乙书", "乙书正文。");
    // 知识点：先建真实 KP 行（归并族展开测试的前提），卡上的 knowledge_point_id 直接持有 KP id
    const kpT = db.createKnowledgePoint({ canonicalLabel: "D105 目标知识点" });
    const kpS = db.createKnowledgePoint({ canonicalLabel: "D105 源知识点" });
    // 卡1 挂甲书（contextRef.documentId → library_items JOIN 派生 library_item_id）
    const c1 = db.createCard({ noteText: "FSRSTEST D105 卡1 考研英语", cardType: "qa", frontMarkdown: "卡1？", backMarkdown: "答", priority: 50, tags: ["考研::英语"], fsrsJson: fsrsPast, knowledgePointId: kpT.id, contextRef: { documentId: book1.documentId } }).id;
    const c2 = db.createCard({ noteText: "FSRSTEST D105 卡2 无标签", cardType: "qa", frontMarkdown: "卡2？", backMarkdown: "答", priority: 50, tags: [], fsrsJson: fsrsPast, contextRef: { documentId: book2.documentId } }).id;
    const c3 = db.createCard({ noteText: "FSRSTEST D105 卡3 大小写变体", cardType: "qa", frontMarkdown: "卡3？", backMarkdown: "答", priority: 50, tags: ["错题 本", "KaoYan"], fsrsJson: fsrsPast, contextRef: { documentId: book1.documentId }, knowledgePointId: kpS.id }).id;
    // 摘录：甲书一条带批注标签、乙书一条无标签（当日内到期）
    const e1 = db.createExtract({ parentType: "document", parentId: book1.documentId, documentId: book1.documentId, contentMarkdown: "D105 摘录甲 带批注标签", contextRef: { documentId: book1.documentId, anchorText: "D105 摘录甲" } }).id;
    db.execRawSql("UPDATE extracts SET tag_json = ?, topic_next_at = ? WHERE id = ?", [JSON.stringify(["考研::英语::真题"]), PAST, e1]);
    const e2 = db.createExtract({ parentType: "document", parentId: book2.documentId, documentId: book2.documentId, contentMarkdown: "D105 摘录乙 无标签", contextRef: { documentId: book2.documentId, anchorText: "D105 摘录乙" } }).id;
    db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE id = ?", [PAST, e2]);

    const queue = db.computeSessionQueue(NOW, {});
    const cardIds = () => queue.cards.map((c) => c.id);
    check("无 scope 退化：卡与今日队列同集合", eq(cardIds().sort(), db.computeTodayQueue(NOW).cards.map((c) => c.id).sort()), "口径一致", "f03 精神");

    console.log("== D105-S3 applyScope tags 过滤矩阵 ==");
    const run = (scope) => ({
      cards: db.computeSessionQueue(NOW, { scope }).cards.map((c) => c.id),
      extracts: db.computeSessionQueue(NOW, { scope, mergeIntoReview: true }).extracts.map((e) => e.id)
    });
    let r = run({ kinds: ["card", "extract"], tags: ["考研"] });
    check("tag:考研 层级前缀命中 卡1（考研::英语）", r.cards.includes(c1) && !r.cards.includes(c2), [c1], r.cards);
    check("tag:考研 摘录行命中（extracts.tag_json 层级子路径）", r.extracts.includes(e1) && !r.extracts.includes(e2), [e1], r.extracts);
    r = run({ kinds: ["card", "extract"], tags: ["考研::英语::真题"] });
    check("反向不命中：tag:考研::英语::真题 不命中卡1（前缀必须落在边界）", !r.cards.includes(c1), "不含 c1", r.cards);
    r = run({ kinds: ["card", "extract"], tags: ["考研英语"] });
    check("tag:考研英语 不命中 考研::英语（非 :: 边界前缀）", !r.cards.includes(c1) && !r.extracts.includes(e1), "空命中", r);
    r = run({ kinds: ["card", "extract"], tags: ["错题 本"] });
    check("含空格标签整串命中", r.cards.includes(c3), [c3], r.cards);
    r = run({ kinds: ["card", "extract"], tags: ["错题"] });
    check("段内空格是原子标签：tag:错题 不命中「错题 本」（:: 边界才展开）", !r.cards.includes(c3), "不含 c3", r.cards);
    r = run({ kinds: ["card", "extract"], tags: ["kaoyan"] });
    check("大小写折叠命中（NFKC + lower，tagKey 同规）", r.cards.includes(c3), [c3], r.cards);
    r = run({ kinds: ["card", "extract"], tags: ["考研", "kaoyan"] });
    check("tags 内多值 OR：任一命中即过", r.cards.includes(c1) && r.cards.includes(c3) && !r.cards.includes(c2), "c1+c3", r.cards);

    console.log("== D105-S4 主进程 tagPathMatches 与渲染层 tags.ts 同语义对照 ==");
    const cases = [["考研::英语", "考研"], ["考研::英语::真题", "考研::英语"], ["考研英语", "考研"], ["考研::英语", "考研::英语::x"], ["错题 本", "错题 本"], ["KaoYan", "kaoyan"]];
    const mismatch = cases.filter(([tag, prefix]) =>
      tagsRef.tagPathMatches(tag, prefix) !== (String(tag).normalize("NFKC").toLowerCase() === String(prefix).normalize("NFKC").toLowerCase() || String(tag).normalize("NFKC").toLowerCase().startsWith(String(prefix).normalize("NFKC").toLowerCase() + "::"))
    );
    check("对照矩阵零漂移（6 组含大小写/边界）", mismatch.length === 0, "零漂移", mismatch);

    console.log("== D105-S5 applyScope kpIds：仅闪卡行 + KnowledgeBase 归并族展开 ==");
    r = run({ kinds: ["card", "extract"], kpIds: [kpT.id] });
    check("kpIds 精确命中持卡行", r.cards.includes(c1) && !r.cards.includes(c2) && !r.cards.includes(c3), [c1], r.cards);
    check("kp 条件下摘录行不命中（摘录无 KP 字段）", r.extracts.length === 0, "空", r.extracts);
    // 归并：把源 KP 软合入目标 KP —— 卡3 持源 id，scope 选目标 id 也应命中（读取侧补语义）
    db.mergeKnowledgePoints(kpS.id, kpT.id);
    const kpSAfter = db.getKnowledgePoint(kpS.id);
    check("归并落库：源 KP status=merged 且 merged_into 指向目标", kpSAfter.status === "merged" && kpSAfter.mergedInto === kpT.id, "merged", kpSAfter);
    r = run({ kinds: ["card", "extract"], kpIds: [kpT.id] });
    check("合并不改写卡片列：选目标 id 命中持源 id 的卡（归并族展开）", r.cards.includes(c3), "c3 也命中", r.cards);
    r = run({ kinds: ["card", "extract"], kpIds: [kpS.id] });
    check("选被归并的源 id 同样命中全族（上溯 + 来源）", r.cards.includes(c1) && r.cards.includes(c3), "c1+c3", r.cards);
    r = run({ kinds: ["card", "extract"], kpIds: ["legacy-not-in-kp"] });
    check("不在 KP 表的 legacy 键按精确匹配透传", r.cards.length === 0, "空命中", r.cards);

    console.log("== D105-S6 条件间 AND + 语义不变量 ==");
    r = run({ kinds: ["card", "extract"], tags: ["考研"], kpIds: [kpT.id] });
    check("AND 组合：卡1 同持标签与 KP 才命中", r.cards.includes(c1) && !r.cards.includes(c3), [c1], r.cards);
    r = run({ kinds: ["card", "extract"], bookItemIds: ["不存在"], tags: ["考研"] });
    check("AND 组合：书条件收紧后为空", r.cards.length === 0 && r.extracts.length === 0, "空", r);
    const counts = db.computeCardCounts(NOW, { scope: { kinds: ["card"], tags: ["考研"] } });
    check("computeCardCounts 同一 applyScope（今日计数同口径）", counts.new === 1, 1, counts);
    r = run({ kinds: ["card"], tags: ["考研"] });
    check("kinds 收紧后摘录侧清空（既有语义不回退）", r.extracts.length === 0, "空", r.extracts);

    console.log("== D105-S7 extractScopeConditions 查询提取（「用当前查询创建」） ==");
    const ext = queryBundle.extractScopeConditions(`tag:考研 book:甲书 "普通短语" -tag:排除项`);
    check("提取 tag: 条件", eq(ext.tags, ["考研"]), ["考研"], ext.tags);
    check("提取 book: 书名子串", eq(ext.bookNames, ["甲书"]), ["甲书"], ext.bookNames);
    check("-tag: 负号如实丢弃（排除语义 scope v1 不承载）", !ext.tags.includes("排除项"), "不含", ext.tags);
    const ext2 = queryBundle.extractScopeConditions(`tag:"错题 本"`);
    check("引号含空格的 tag 提取", eq(ext2.tags, ["错题 本"]), ["错题 本"], ext2.tags);
    const ext3 = queryBundle.extractScopeConditions("无字段前缀文本");
    check("无字段前缀 → 空条件（保持现状语义）", eq(ext3, { tags: [], bookNames: [] }), { tags: [], bookNames: [] }, ext3);

    console.log(`\nD105-scope: ${pass} 通过 / ${fail} 失败`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败不阻塞 */ }
    app.quit();
  }
});
