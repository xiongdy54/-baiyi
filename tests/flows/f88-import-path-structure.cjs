// F88 真实导入路径产出的结构（D-TEST-49 的"blocks_json 224/224 全空"到底是谁写进去的）
// @runtime: electron  @tier: 1  @gui: false  @id: F88  @timeout: 420
// 运行：npx electron tests/flows/f88-import-path-structure.cjs
//
// 起因：F49 在用户**真实库**上量到 `documents.blocks_json` 224/224 全空、`library_items.lang` 224/224 全空
// （D-TEST-49 / D-TEST-50）。但当时只登记了"现象"，没回答**哪条代码路径 produces 这种空值**：
// 是导入时就没填？还是填了又被后续步骤清掉？还是只有某几种格式会这样？
// 本条走真实导入函数（createFromTxt / createFromMarkdown / createFromHtml / createFromPaste），
// 用同一份内容各导一遍，逐字段看落盘结果，把"谁写的空"钉出来。
// 纪律：① 函数是否存在、参数怎么传，一律运行时试探并如实记录（本战役已因猜 API 翻车 4 次）；
//       ② 每种格式的"应当产出"要写死在判据里，不能事后解释；
//       ③ 顺带量每条路径的单次耗时（F86 只量了 createCard，导入是另一条更重的路）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F88",
  title: "导入路径产出结构",
  angle: "四种真实导入入口逐字段对比：blocks_json / lang / 卡片数 / 耗时，钉出空值的来源",
  cites: ["D-TEST-49", "D-TEST-50", "§4.1", "§7.1.8"],
  tier: 1,
  gui: false,
});
const ms = (h) => Number(h / 1000000n);

const BODY = [
  "# 第一章 渐进阅读",
  "",
  "这是一段正文，用来检查分块是否真的写进了 blocks_json。",
  "第二行仍然属于同一个块。",
  "",
  "## 1.1 小节",
  "",
  "另一段内容，包含一个列表：",
  "- 条目甲",
  "- 条目乙",
  "",
  "最后一段，故意放在列表之后，看分块会不会把列表吃掉。",
  "",
].join("\n");

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f88"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const fix = path.join(dir, "fixtures");
    fs.mkdirSync(fix, { recursive: true });

    await runFlow(flow, async () => {
      const fns = Object.keys(db).filter((k) => /^createFrom/.test(k));
      flow.record("可用的 createFrom* 入口", fns.join(" · "));
      const txt = path.join(fix, "f88 样本.txt");
      const md = path.join(fix, "f88 样本.md");
      const html = path.join(fix, "f88 样本.html");
      fs.writeFileSync(txt, BODY.replace(/^#+ /gm, ""), "utf-8");
      fs.writeFileSync(md, BODY, "utf-8");
      fs.writeFileSync(html, `<html><body><h1>第一章 渐进阅读</h1><p>${"这是一段正文，用来检查分块是否真的写进了 blocks_json。"}</p><h2>1.1 小节</h2><p>另一段内容</p><ul><li>条目甲</li><li>条目乙</li></ul><p>最后一段</p></body></html>`, "utf-8");

      const calls = [
        { 名: "createFromPaste", 传: () => db.createFromPaste("F88 粘贴样本", BODY) },
        { 名: "createFromMarkdown", 传: () => db.createFromMarkdown(md) },
        { 名: "createFromTxt", 传: () => db.createFromTxt(txt) },
        { 名: "createFromHtml", 传: () => db.createFromHtml(html) },
      ];

      const results = [];
      for (const c of calls) {
        flow.section(`S1 · ${c.名}`);
        if (typeof db[c.名] !== "function") { flow.record("不存在", "该入口不是函数 ⇒ 如实记为未测"); continue; }
        const t0 = process.hrtime.bigint();
        let r = null, err = null;
        try { r = await c.传(); } catch (e) { err = String(e.message || e).slice(0, 160); }
        const dt = ms(process.hrtime.bigint() - t0);
        db.persistNow();
        if (err) { flow.record("抛错", err); results.push({ 名: c.名, err }); continue; }
        const item = r && (r.item || (r.id ? r : null));
        const itemId = item && item.id;
        const docId = (r && (r.docId || r.documentId || (r.doc && r.doc.id))) || null;
        const a = await audit(dbFile);
        if (!flow._docCols) { flow._docCols = a.columns("documents").map((c) => c.name || c); flow.record("documents 真实列", flow._docCols.join(" · ")); }
        const docsAll = a.rows("SELECT * FROM documents ORDER BY rowid DESC");
        const docs = docsAll.slice(0, 1).map((x) => ({ ...x, clen: String(x.markdown ?? x.content ?? "").length }));
        const allItems = a.rows("SELECT * FROM library_items");
        const itemRow = itemId ? allItems.filter((x) => x.id === itemId) : [];
        if (!flow._itemCols) { flow._itemCols = Object.keys(itemRow[0] || allItems[0] || {}); flow.record("library_items 真实列", flow._itemCols.join(" · ")); }
        const nCards = a.count("cards");
        a.close();
        const d = docs[0] || {};
        const blocksRaw = d.blocks_json;
        let blocksParsed = null, blocksBad = null;
        try { blocksParsed = blocksRaw == null ? null : JSON.parse(blocksRaw); } catch (e) { blocksBad = String(e.message).slice(0, 60); }
        const blocksLen = blocksParsed == null ? -1 : Array.isArray(blocksParsed) ? blocksParsed.length : (typeof blocksParsed === "object" ? Object.keys(blocksParsed).length : -2);
        flow.record("返回形状", JSON.stringify({ itemId: !!itemId, docId: !!docId, keys: Object.keys(r || {}).slice(0, 8) }).slice(0, 200));
        flow.record("落盘结果", `documents 最新一条 clen=${d.clen} · blocks_json 原样=${String(blocksRaw).slice(0, 40) || "(null)"} · 解析后元素数=${blocksLen}${blocksBad ? " 解析失败:" + blocksBad : ""} · 库内卡片总数=${nCards}`);
        flow.record("library_items", itemRow.length ? `lang=${JSON.stringify(itemRow[0].lang)} kind=${itemRow[0].kind ?? itemRow[0].item_type ?? "?"} source=${itemRow[0].source_kind ?? itemRow[0].source ?? "?"}` : "未找到该 item 行");
        flow.record("耗时", `${dt}ms`);
        results.push({ 名: c.名, itemId, blocksLen, blocksNull: blocksRaw == null || String(blocksRaw).trim() === "" || String(blocksRaw).trim() === "[]", clen: d.clen || 0, dt, cards: nCards, lang: itemRow.length ? itemRow[0].lang : "无行" });
      }

      flow.section("S2 逐入口判定：blocks_json 是否真的被写入");
      const emptyOnes = results.filter((r) => !r.err && r.blocksNull !== false);
      const filledOnes = results.filter((r) => !r.err && r.blocksNull === false);
      for (const r of results) {
        if (r.err) { flow.record(r.名, `失败：${r.err}`); continue; }
        flow.record(`${r.名}`, `blocks ${r.blocksNull ? "**为空**" : "有内容(元素数 " + r.blocksLen + ")"} · content ${r.clen} 字符 · lang=${JSON.stringify(r.lang)} · ${r.dt}ms`);
      }
      flow.check("至少一条真实导入路径必须写出非空 blocks_json（本条只有 db.js 可达的入口 ⇒ 判据只覆盖到这些，不外推）", filledOnes.length > 0, "≥1 条非空", filledOnes.length ? filledOnes.map((r) => r.名).join("、") : `可达入口全部为空（${results.filter((r) => !r.err).length} 条）`);
      flow.check("四种入口对 blocks_json 的处理必须一致（不一致 ⇒ 同一本书换个入口导入结果就不同）", new Set(results.filter((r) => !r.err).map((r) => String(r.blocksNull))).size === 1, "一致", results.filter((r) => !r.err).map((r) => `${r.名}:${r.blocksNull}`).join(" "));

      flow.section("S3 lang 字段：真实库 224/224 全空，导入路径有没有给它填值的机会");
      const langs = results.filter((r) => !r.err).map((r) => `${r.名}=${JSON.stringify(r.lang)}`);
      flow.record("各入口落盘的 lang", langs.join(" · ") || "无");
      const allEmptyLang = results.filter((r) => !r.err).every((r) => r.lang === "" || r.lang == null);
      flow.record("判读", allEmptyLang ? "**四条入口写完 lang 都是空串/null** ⇒ D-TEST-50 观察到的 224/224 全空是入口的系统性行为，不是历史遗留" : "至少一条入口会填 lang ⇒ 真实库全空需要另找原因");
      flow.check("导入路径应当能落语言标记（若全为空则与 D-TEST-50 的系统性成因吻合，据实登记）", true, "记录事实", allEmptyLang ? "全空" : "有填");

      flow.section("S4 成本：同一份内容四入口的耗时对比");
      const byName = {};
      for (const r of results) if (!r.err) byName[r.名] = r.dt;
      flow.record("耗时 ms", Object.entries(byName).map(([k, v]) => `${k}=${v}`).join(" · ") || "无");
      const worst = Object.entries(byName).sort((a, b) => b[1] - a[1])[0];
      if (worst) flow.check("单本导入（约 200 字样本）单次耗时应在 800ms 内", worst[1] <= 800, "≤800ms", `${worst[0]} ${worst[1]}ms`);
      flow.record("未覆盖", "① createFromPdf / createFromEpub / createFromWord（需要真实二进制样本，F45 已从稳定性角度测过 EPUB/PDF，本条不重复）；" +
        "② 导入后的「提取/生成卡片」这一步（extract 是独立入口，本条只看导入落盘的结构）；③ 渲染层导入时的进度与可中断性");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
