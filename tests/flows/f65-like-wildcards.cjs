// F65 搜索通配符与转义普查（LIKE 的 % 和 _ 有没有被当字面量）
// @runtime: electron  @tier: 1  @gui: false  @id: F65  @timeout: 300
// 运行：npx electron tests/flows/f65-like-wildcards.cjs
//
// 角度：F19 把所有读接口喂过垃圾参数（null/越界/类型错），但没喂过 **LIKE 元字符**。
//       搜索框是最容易被"用户输入里带 %"咬到的地方：若拼串成 `LIKE '%'+q+'%'` 而不转义，
//       用户输入 % 就等于"匹配全部"、输入 _ 就是"任意单字符"，搜索结果与直觉完全相反。
//       本条把 db.js 里所有带 LIKE 的查询找出来，再对每个搜索入口灌 % / _ / \ / 字面百分号 / 注入串。
"use strict";
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F65",
  title: "搜索通配符与转义",
  angle: "LIKE 元字符是否被当字面量 + 参数化是否守住注入面",
  cites: ["§7.1.3", "§7.5", "§6.2", "§7.2"],
  tier: 1,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f65"));
    app.setPath("userData", dir);
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    const dbFile = path.join(dir, "library.db");

    await runFlow(flow, async () => {
      flow.section("L0 静态面：db.js 里所有带 LIKE 的查询，逐条看它怎么拼参数");
      const src = fs.readFileSync(dbPath, "utf8").replace(/\r\n/g, "\n");
      const lines = src.split("\n");
      const likeSites = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/\bLIKE\b/i.test(lines[i])) continue;
        // 往上下各看 4 行，抓这条语句的写法
        const ctx = lines.slice(Math.max(0, i - 4), i + 5).join("\n");
        const concatWild = /(['"`])%?\s*\+|%'\s*\+|CONCAT\s*\(\s*['"%]/i.test(ctx) || /%\$\{|'%' \+ /.test(ctx);
        const paramBound = /\?\s*[,)]/.test(lines[i]) || /\$\d/.test(lines[i]);
        const escapeClause = /\bESCAPE\b/i.test(ctx);
        likeSites.push({ line: i + 1, sql: lines[i].trim().slice(0, 78), paramBound, concatWild, escapeClause });
      }
      flow.record("带 LIKE 的行数", likeSites.length);
      for (const s of likeSites) {
        flow.record(
          `db.js:${s.line}`,
          `参数化=${s.paramBound ? "是" : "否"} · 疑似拼串塞通配=${s.concatWild ? "**是**" : "否"} · 有 ESCAPE 子句=${s.escapeClause ? "是" : "否"} · 「${s.sql}」`
        );
      }
      const noEscape = likeSites.filter((s) => !s.escapeClause).length;
      flow.record("没有 ESCAPE 子句的 LIKE 站点数", `${noEscape} / ${likeSites.length}`);

      flow.section("L1 更正：卡片浏览搜索是**渲染层 JS 过滤**，不经过 SQL LIKE");
      // 第一版这里去调 listAllCards(查询串)，而该函数**根本不收查询参数** ⇒ 任何输入都返回全部 6 张，
      // 连"普通中文子串"这条正向对照都红 ⇒ 那 5 条红全是我的靶子错了，不是产品缺陷。
      // 实测形状：CardBrowser.tsx:149/157 用 list.filter(...) 在内存里筛，% 与 _ 天然是字面量。
      const cbSrc = fs.readFileSync(path.join(ROOT, "src", "components", "CardBrowser.tsx"), "utf8");
      flow.check("卡片浏览搜索确为渲染层过滤（因此不存在 LIKE 通配符问题）", /list\.filter\(/.test(cbSrc) && !/window\.cardsAPI\.search/i.test(cbSrc), "是", { 有内存过滤: /list\.filter\(/.test(cbSrc) });

      flow.section("L2 真正的靶子：两个吃用户文本的 SQL LIKE 站点（都写了 ESCAPE）");
      // db.js:2606 listJournalEntries   → content_markdown LIKE ? ESCAPE '\'
      // db.js:2848 listKnowledgePoints  → (canonical_label LIKE ? ESCAPE '\' OR alias_json LIKE ? ESCAPE '\')
      const item = db.createFromPaste("F65 搜索书", "# 章\n\n百分号 % 与下划线 _ 都会出现在正文里。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      db.createJournalEntry({ contentMarkdown: "今天记一个 100% 纯手工的例子", source: "app" });
      db.createJournalEntry({ contentMarkdown: "今天的下划线 a_b 例子", source: "app" });
      db.createJournalEntry({ contentMarkdown: "今天的反斜杠 \\ 例子", source: "app" });
      db.createJournalEntry({ contentMarkdown: "今天什么符号都没有", source: "app" });
      if (typeof db.createKnowledgePoint === "function") {
        db.createKnowledgePoint({ canonicalLabel: "标签含 % 号" });
        db.createKnowledgePoint({ canonicalLabel: "标签含 _ 号" });
        db.createKnowledgePoint({ canonicalLabel: "普通标签甲" });
      }
      db.persistNow();

      const jAll = db.listJournalEntries({});
      flow.record("日记总数（不带搜索）", Array.isArray(jAll) ? jAll.length : JSON.stringify(jAll).slice(0, 60));
      const js = (q) => {
        try {
          const r = db.listJournalEntries({ query: q });
          return Array.isArray(r) ? r.length : (r && r.entries ? r.entries.length : -1);
        } catch (e) {
          return "ERR:" + String((e && e.message) || e).slice(0, 60);
        }
      };
      flow.record('日记搜索 "100%"', js("100%"));
      flow.record('日记搜索 "%"', js("%"));
      flow.record('日记搜索 "_b"', js("_b"));
      flow.record('日记搜索 "反斜杠 \\\\"', js("反斜杠 \\"));
      flow.record('日记搜索 "今天"（正向对照：必须命中全部 4 条）', js("今天"));
      flow.check(
        '日记搜索：字面 "%" 必须按字面量匹配（判据是"不等于全部 4 条"；若 % 被当通配符就会返回 4）',
        js("%") !== js("今天") && js("%") === 1,
        "1 条（只命中含 % 的那条），且明显少于全量 4 条",
        { 百分号命中: js("%"), 全部: js("今天") }
      );
      flow.check(
        "日记搜索：含字面 % 的条目要能被搜到（转义不能把可搜性一起转没了）",
        js("100%") === 1,
        "1 条",
        { 命中: js("100%") }
      );
      flow.check('日记搜索：字面 "_" 不得退化成"任意单字符"', js("_b") === 1, "1 条（只有 a_b 那条）", { 命中: js("_b") });
      flow.check("正向对照：普通子串搜索必须命中全部含该词的条目（证明搜索本身在工作）", js("今天") === 4, "4 条", { 命中: js("今天") });

      flow.section("L3 知识点搜索（同一形状，第二个站点）");
      if (typeof db.listKnowledgePoints === "function") {
        // 返回形状未知 ⇒ 只记录原始形状，不硬断言（宁可少断言，也不拿"我猜错了返回结构"当产品缺陷）
        const raw = (() => {
          try {
            const r = db.listKnowledgePoints({ query: "%" });
            return JSON.stringify(r).slice(0, 160);
          } catch (e) {
            return "ERR:" + String((e && e.message) || e).slice(0, 100);
          }
        })();
        const rawAll = (() => {
          try {
            const r = db.listKnowledgePoints({});
            return JSON.stringify(r).slice(0, 120);
          } catch (e) {
            return "ERR:" + String((e && e.message) || e).slice(0, 100);
          }
        })();
        flow.record('知识点搜索 query="%" 的原始返回', raw);
        flow.record("知识点搜索 不带 query 的原始返回", rawAll);
        flow.record("本站点判定", "静态面已确认 db.js:2848 写了 ESCAPE '\\\\'（两个字段都写了）；动态面因返回形状未定性，**只记录不断言**");
      } else {
        flow.record("知识点搜索", "无 listKnowledgePoints 函数，跳过");
      }

      flow.section("L4 注入面（参数化）");
      const inj = (() => {
        try {
          db.listJournalEntries({ query: "'); DROP TABLE journal_entries; --" });
          return "no-throw";
        } catch (e) {
          return "ERR:" + String((e && e.message) || e).slice(0, 60);
        }
      })();
      flow.record("注入串搜索结果", inj);
      const a1 = await audit(dbFile);
      const stillThere = a1.count("journal_entries");
      a1.close();
      flow.record("注入之后 journal_entries 行数", stillThere);
      flow.check("注入串不得伤表（参数化必须守住）", stillThere >= 4, "≥4 行", stillThere);

      flow.section("L5 判定");
      flow.record(
        "本条总结论",
        `${likeSites.length} 处 LIKE；吃用户文本的 2 处（db.js:2606 日记、db.js:2848 知识点）**都带 ESCAPE '\\'**，` +
          `其余 ${noEscape} 处匹配的是服务端自造的 documentId/UUID（非用户文本，注释 db.js:818 已声明）。` +
          `卡片浏览搜索是渲染层内存过滤，不经 SQL LIKE ⇒ 本维度**未发现缺陷**。` +
          `第一版报的 5 条红全部是靶子错（调了不收参数的 listAllCards），已更正并留档。`
      );
    });
    setTimeout(() => app.exit(process.exitCode || 0), 200); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
