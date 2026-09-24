// F89 提取链路的幂等性与悬挂引用（重复提取同一份文档会不会长出双份卡）
// @runtime: electron  @tier: 1  @gui: false  @id: F89  @timeout: 420
// 运行：npx electron tests/flows/f89-extract-idempotency.cjs
//
// 为什么是这一条：渐进阅读的日常动作就是"改一改高亮 → 重新提取"。F88 把导入侧的结构量清了，
// 但明确留着"导入之后的提取/生成卡片"这一步没测。幂等性是这个链路最容易坏、
// 坏了又最难被发现的性质：多出来的重复卡不会报错，只会让用户复习到吐，
// 而删掉的段落留下的悬挂卡则安静地占着队列（D-TEST-49 已经量到真实库里有 70 条悬挂 KP）。
// 判据设计：
//   S2 同一份文档**连续提取两次** ⇒ 卡与块的数量不许变（幂等）
//   S3 追加一段后重新提取 ⇒ 只许多出那一段的量，旧卡不许翻倍
//   S4 删掉一段后重新提取 ⇒ 不许留下指向已消失块的卡（悬挂）
//   S5 正向对照 ⇒ 另建一份内容相同的独立文档，它**必须**长出自己的卡；
//      若 S2 的"幂等"是靠全局按内容去重实现的，S5 就会红——这样才分得清
//      "真的幂等"与"误把两本书当一本"。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F89",
  title: "提取链路幂等性",
  angle: "重复提取/增删段落后，卡片与块的数量与引用完整性",
  cites: ["§4.3", "§4.16", "D-TEST-49", "§7.1.8"],
  tier: 1,
  gui: false,
});

const DOC_A = ["# 甲书", "", "第一段内容，讲述渐进阅读的基本单位。", "", "第二段内容，讲述间隔重复的调度。", "", "第三段内容，讲述同源合并与burying。"].join("\n");
const DOC_B = ["# 乙书", "", "第一段内容，讲述渐进阅读的基本单位。", "", "第二段内容，讲述间隔重复的调度。", "", "第三段内容，讲述同源合并与burying。"].join("\n");

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f89"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const cands = Object.keys(db).filter((k) => /extract|reload|resync|reindex|generateCards|createCardsFrom|updateDoc/i.test(k));
      flow.record("提取相关导出", cands.join(" · ") || "无 ⇒ 本条不可测，如实收口");
      if (!cands.length) { flow.check("必须存在可直达的提取入口", false, "≥1 个", "0 个"); return; }
      const pick = cands.find((k) => /extract/i.test(k)) || cands[0];
      flow.record("选用入口", `${pick}（arity=${db[pick].length}）`);

      const counts = async () => {
        const a = await audit(dbFile);
        const out = {
          cards: a.count("cards"),
          docs: a.count("documents"),
          items: a.count("library_items"),
          docRows: a.rows("SELECT id, library_item_id, markdown, blocks_json, toc_json FROM documents"),
        };
        a.close();
        return out;
      };
      const call = async (arg) => {
        const fn = db[pick];
        try {
          if (fn.length <= 1) return { r: await fn(arg) };
          return { r: await fn(arg) };
        } catch (e) { return { err: String(e.message || e).slice(0, 160) }; }
      };

      const mk = (title, body) => {
        const it = db.createFromPaste(title, body);
        return it && (it.id || (it.item && it.item.id) || (it.documentId && it.id));
      };

      flow.section("S1 建两份文档并首次提取");
      const idA = mk("F89 甲书", DOC_A);
      const idB = mk("F89 乙书", DOC_B);
      db.persistNow();
      const c0 = await counts();
      flow.record("首次提取前", `cards=${c0.cards} docs=${c0.docs} items=${c0.items}`);
      const rA = await call(idA);
      const rB = await call(idB);
      db.persistNow();
      flow.record(`${pick}(甲) `, JSON.stringify(rA.err || { ok: true }).slice(0, 160));
      flow.record(`${pick}(乙) `, JSON.stringify(rB.err || { ok: true }).slice(0, 160));
      if (rA.err) { flow.record("入口签名不匹配", `调用 ${pick}(itemId) 抛错：${rA.err} ⇒ 需要 docId 或别的入参，本条如实记为未测`); return; }
      const c1 = await counts();
      flow.record("首次提取后", `cards=${c1.cards} docs=${c1.docs} items=${c1.items} · 甲的 blocks=${String((c1.docRows.find((d) => d.library_item_id === idA) || {}).blocks_json || "").slice(0, 30)}`);
      if (c1.cards === 0) { flow.record("判读", `${pick} 不直接产卡（提取只出块/候选，卡片由另一个入口确认）⇒ 幂等性改在块/候选层面判`); }

      flow.section("S2 幂等：同一份文档连续再提取两次，数量不许变化");
      await call(idA); await call(idA);
      db.persistNow();
      const c2 = await counts();
      flow.record("再提取两次后", `cards=${c2.cards}（上一轮 ${c1.cards}）· docs=${c2.docs} · 甲的 blocks 元素数=${(() => { try { const b = JSON.parse((c2.docRows.find((d) => d.library_item_id === idA) || {}).blocks_json || "[]"); return Array.isArray(b) ? b.length : -1; } catch { return -2; } })()}`);
      flow.check("S2 重复提取同一份文档不得增加卡片（幂等）", c2.cards === c1.cards, `${c1.cards} 张不变`, `${c2.cards} 张（差 ${c2.cards - c1.cards}）`);

      flow.section("S3 追加一段后重新提取，只许多出那一段的量");
      const docRowA = (await counts()).docRows.find((d) => d.library_item_id === idA);
      if (docRowA) {
        db.execRawSql("UPDATE documents SET markdown = ? WHERE id = ?", [docRowA.markdown + "\n\n第四段新增内容，用来验证增量提取。\n", docRowA.id]);
        db.persistNow();
        await call(idA);
        db.persistNow();
        const c3 = await counts();
        flow.record("追加后", `cards=${c3.cards}（S2 时 ${c2.cards}）· 增量 ${c3.cards - c2.cards}`);
        flow.check("S3 追加一段的增量必须远小于一轮全量（≤ 首轮甲书产出的一半，否则说明旧卡被重复生成）", c3.cards - c2.cards <= Math.max(1, Math.ceil((c1.cards || 1) / 2)), `≤${Math.max(1, Math.ceil((c1.cards || 1) / 2))}`, c3.cards - c2.cards);
      } else {
        flow.record("S3 未执行", "找不到甲书的 documents 行 ⇒ 无法追加，如实记为未测");
      }

      flow.section("S4 删除一段后重新提取，不许留下悬挂引用");
      const c4pre = await counts();
      const rowA2 = c4pre.docRows.find((d) => d.library_item_id === idA);
      if (rowA2) {
        const trimmed = String(rowA2.markdown || "").split("\n").slice(0, 5).join("\n");
        db.execRawSql("UPDATE documents SET markdown = ? WHERE id = ?", [trimmed, rowA2.id]);
        db.persistNow();
        await call(idA);
        db.persistNow();
        const a = await audit(dbFile);
        const cardsAll = a.rows("SELECT * FROM cards");
        const cards = cardsAll.filter((c) => (c.document_id ?? c.doc_id ?? c.sourceDocId) === rowA2.id);
        const docNow = a.rows("SELECT blocks_json FROM documents WHERE id = ?", [rowA2.id])[0];
        a.close();
        let blockIds = new Set();
        try { const b = JSON.parse((docNow && docNow.blocks_json) || "[]"); (Array.isArray(b) ? b : []).forEach((x) => blockIds.add(String(x && (x.id || x.blockId || "")))); } catch { /* 空列 */ }
        const dangling = blockIds.size > 0 ? cards.filter((c) => c.block_id && !blockIds.has(String(c.block_id))) : [];
        flow.record("裁剪后", `甲书卡片 ${cards.length} 张 · blocks_json 元素 ${blockIds.size} 个 · 指向已消失块的卡 ${dangling.length} 张`);
        if (blockIds.size === 0) flow.record("S4 判定边界", "blocks_json 是只写不读的死列（见 D-TEST-49 更正）⇒ 无法用它判悬挂，本格不作判定，改看卡片数是否随内容减少");
        else flow.check("S4 删掉的段落不应留下指向不存在块的卡", dangling.length === 0, "0 张悬挂", dangling.length);
      }

      flow.section("S5 正向对照：两份内容相同、标题不同的独立文档必须各自产卡");
      const c5 = await counts();
      flow.record("最终计数", `cards=${c5.cards} docs=${c5.docs} items=${c5.items}`);
      const perDoc = {};
      for (const d of c5.docRows) perDoc[d.library_item_id] = 0;
      const a2 = await audit(dbFile);
      const allCards = a2.rows("SELECT * FROM cards");
      const docIds = a2.rows("SELECT id, library_item_id FROM documents");
      if (!flow._cardCols) { flow._cardCols = Object.keys(allCards[0] || {}); flow.record("cards 真实列", flow._cardCols.join(" · ")); }
      a2.close();
      const byDoc = {};
      for (const c of allCards) { const k = c.document_id ?? c.doc_id ?? c.sourceDocId; byDoc[k] = (byDoc[k] || 0) + 1; }
      const docsOfA = docIds.filter((d) => d.library_item_id === idA).map((d) => d.id);
      const docsOfB = docIds.filter((d) => d.library_item_id === idB).map((d) => d.id);
      const nA = docsOfA.reduce((s, x) => s + (byDoc[x] || 0), 0);
      const nB = docsOfB.reduce((s, x) => s + (byDoc[x] || 0), 0);
      flow.record("甲/乙各自名下卡片", `甲=${nA} · 乙=${nB}（两份正文完全相同，只有标题不同）`);
      if (c1.cards > 0) {
        flow.check("S5 对照：内容相同的两份独立文档必须各自拥有卡片（若为 0 说明幂等是靠全局内容去重实现的，那是更严重的错）", nA > 0 && nB > 0 && nA === nB, "两侧都 >0 且相等", `甲=${nA} 乙=${nB}`);
      } else {
        flow.record("S5 判定", "本流程里提取不直接产卡 ⇒ 对照改为「两份文档的 blocks 是否各自独立」");
        const bA = c5.docRows.filter((d) => d.library_item_id === idA).length;
        const bB = c5.docRows.filter((d) => d.library_item_id === idB).length;
        flow.check("S5 对照：两份文档必须各自有 documents 行", bA > 0 && bB > 0, "各 ≥1 行", `甲=${bA} 乙=${bB}`);
      }
      flow.record("空跑自证", `全程卡片数 ${c0.cards}→${c5.cards}，始终为 0 ⇒ S2/S3/S4 的"数量未变"是**平凡成立**，不构成幂等性证据。真正的判定挪到 S6 在可达对象上做。`);

      flow.section("S6 可达层面的真幂等：重复 createExtract 三次，任务行数不许变");
      const listExtracts = async () => {
        const a3 = await audit(dbFile);
        const tabs = a3.rows("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
        const t = tabs.find((n) => /extract/i.test(n)) || null;
        const rows = t ? a3.rows(`SELECT * FROM "${t}"`) : [];
        a3.close();
        return { t, n: rows.length, tabs };
      };
      const e0 = await listExtracts();
      flow.record("提取相关表", e0.t || `未发现（表清单：${e0.tabs.join(" · ")}）`);
      await call(idA); await call(idA); await call(idA);
      db.persistNow();
      const e1 = await listExtracts();
      flow.record("重复调用前后", e0.t ? `表 ${e0.t}：${e0.n} 行 → ${e1.n} 行（差 ${e1.n - e0.n}）` : "无表可数");
      if (e0.t) {
        flow.check("S6 对同一文档重复 createExtract 三次不得新增任务行（幂等）", e1.n === e0.n, `${e0.n} 行不变`, `${e1.n} 行`);
        const dup = await (async () => {
          const a4 = await audit(dbFile);
          const rows = a4.rows(`SELECT * FROM "${e0.t}"`);
          a4.close();
          const seen = new Map();
          for (const r of rows) { const k = `${r.document_id ?? r.doc_id ?? "?"}|${r.item_id ?? r.library_item_id ?? "?"}`; seen.set(k, (seen.get(k) || 0) + 1); }
          return [...seen.entries()].filter(([, v]) => v > 1);
        })();
        flow.record("同文档/同材料多行", dup.length ? dup.map(([k, v]) => `${k}=${v} 行`).join(" ") : "无重复");
        flow.check("S6b 同一文档不应并存多条待提取任务", dup.length === 0, "0 组重复", dup.map(([k, v]) => `${k}:${v}`).join(" ") || "无");
      } else {
        flow.record("S6 判定", "createExtract 的产物不在任何独立表里 ⇒ 幂等性在 db.js 可达范围内无法判定，如实记为未测（不外推为通过）");
      }
      flow.record("未覆盖", "① 提取之后「确认生成卡片」的那一步（若与提取是两个入口，本条只测了前者）；" +
        "② 渲染层提取按钮的重复点击（防抖/禁用态）；③ 候选队列（proposals）层面的幂等；" +
        "④ kpExtractionCandidates / buildKpExtractionInput / applyKpExtraction 这条真正产卡的路（需要 AI 应答，本条未走）");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  });
