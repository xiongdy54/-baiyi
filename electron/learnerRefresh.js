// v48.80（D124 / 指导文档 §4.20 / 设计稿 §9）：学习者模型刷新管线。
// 六步（units → passes → links → kp → lex → save），后台、分块、单飞；每 200 个单元或 2000 个词项让出主进程。
// 边界：本模块对主库只读（db.learnerFacts / getDocument / resolveCardKpMap），写只进 learner.db 与
// learner_* 五张事实表；复习 / 摘录 / 制卡的 IPC 处理函数**绝不**调用本模块（设计稿 §0.1-5）。
const { app } = require("electron");
const lmParams = require("./lmParams");
const lmText = require("./lmText");
const lmLex = require("./lmLex");
const lmLevels = require("./lmLevels");
const lmRecommend = require("./lmRecommend");
const learnerDb = require("./learnerDb");
const { readSettings } = require("./settingsStore");
const { normalizeKpLabel } = require("./kpNorm");
const { UDC_LEAVES } = require("./udc");
const dbModule = require("./db");

const P = lmParams;
const DAY = P.DAY_MS;

let running = null;
let status = { indexing: false, phase: "", done: 0, total: 0, lastRefreshAt: 0, lastError: "" };
let extractPdfPages = null; // main 注入（PDF 页文本抽取），保持本模块可在测试里替换
// lex 步骤的内存缓存（设计稿 §9.1-5）：unitId → { coverage, learningCount, easeFit }；lang → lexStats
let lexUnitCache = new Map();
let lexStatsCache = new Map();
let lexStatsFinal = new Map(); // lexStats 终值（lang → §9.2 lexStats 形状），stepLex 填充

// ---------- 总开关与设置（设计稿 §11.6/§11.8） ----------

// 总开关唯一判断点（渲染层 learnerSettings.read().enabled 同口径）。注意：db.js 不能 require
// 本模块（会形成环形依赖），所以 db.js 里直接写 readSettings().app?.learner?.enabled !== false，
// 与本函数同口径——两边改动必须同步（设计稿 §11.8 实现约束）。
function learnerEnabled() {
  try {
    return readSettings().app?.learner?.enabled !== false;
  } catch {
    return true;
  }
}

function systemLocaleLang() {
  try {
    return lmLex.baseLang(app.getLocale() || "");
  } catch {
    return "";
  }
}

/** 主进程侧 app.learner 设置合法化（与渲染层 src/lib/learner.ts 同口径；每次调用重读，开关即时生效） */
function learnerSettings() {
  let layer = null;
  try {
    layer = readSettings().app?.learner;
  } catch {
    layer = null;
  }
  const l = layer && typeof layer === "object" ? layer : {};
  const enabled = l.enabled !== false;
  let nativeLangs = null;
  if (Array.isArray(l.nativeLangs)) {
    nativeLangs = [...new Set(l.nativeLangs.map((x) => lmLex.baseLang(String(x))).filter((x) => /^[a-z]{2,3}$/.test(x)))];
  }
  const recCount = Math.min(P.REC.MAX_COUNT, Math.max(P.REC.MIN_COUNT, Math.round(Number(l.recCount) || P.REC.DEFAULT_COUNT)));
  // 母语生效值：合法且非空用它；否则回落系统区域；再取不到为空数组（§11.6）
  const effectiveNativeLangs = nativeLangs && nativeLangs.length > 0 ? nativeLangs : (() => {
    const sys = systemLocaleLang();
    return /^[a-z]{2,3}$/.test(sys) ? [sys] : [];
  })();
  return { enabled, nativeLangs, nativeConfirmed: l.nativeConfirmed === true, recCount, effectiveNativeLangs, locale: learnerLocale() };
}

// 界面语言（设计稿 §11.9-2）：v1 恒 "zh"，全局 i18n 落地时只改这一个函数
function learnerLocale() {
  return "zh";
}

// ---------- 单飞与状态 ----------

function getStatus() {
  return { ...status, enabled: learnerEnabled() };
}

function init({ extractPdfPages: fn } = {}) {
  if (typeof fn === "function") extractPdfPages = fn;
}

const yieldNow = () => new Promise((r) => setImmediate(r));

async function refresh({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const startedAt = Date.now();
    status = { ...status, indexing: true, phase: "", done: 0, total: 0, lastError: "" };
    let anyStepRan = false;
    try {
      // 每步开始前检查开关（§11.8：关闭则在当前步骤结束后停止）
      const steps = [
        ["units", stepUnits],
        ["passes", stepPasses],
        ["links", stepLinks],
        ["kp", stepKp],
        ["lex", stepLex]
      ];
      for (const [phase, fn] of steps) {
        if (!learnerEnabled()) {
          status.phase = "stopped";
          break;
        }
        status.phase = phase;
        // eslint-disable-next-line no-await-in-loop
        await fn();
        anyStepRan = true;
      }
      if (!learnerEnabled()) {
        status.phase = "stopped";
      } else {
        status.phase = "save";
        await stepSave();
        anyStepRan = true;
      }
    } catch (err) {
      status.lastError = String((err && err.message) || err);
    } finally {
      running = null; // 单飞解锁（设计稿 §9.1：finally 里置空，否则后续刷新拿到旧 promise）
      status.indexing = false;
      // 总开关关闭导致的全程未启动＝真 no-op（不落盘，§13.5 的 mtime 断言）；
      // 中途停止则已完成的步骤照常落盘（设计稿 §9.1 失败处理）
      if (anyStepRan) {
        try {
          await learnerDb.save();
        } catch {
          /* 保底：失败不抛出刷新之外 */
        }
      }
    }
    return { ok: !status.lastError, ms: Date.now() - startedAt, error: status.lastError || undefined };
  })();
  return running;
}

// ---------- 共享读取 ----------

async function loadFacts(opts) {
  return dbModule.learnerFacts(opts);
}

function parseJsonSafe(text, fallback) {
  try {
    const v = text ? JSON.parse(text) : null;
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function parseContextRef(text) {
  const ref = parseJsonSafe(text, null);
  return ref && typeof ref === "object" ? ref : null;
}

/** 材料语言（设计稿 §6.2）：library_items.lang 永远优先，否则 detectLang 兜底（PDF 取前 3 页） */
function materialLangOf(mat, facts, pdfPagesOfSync) {
  const setLang = lmLex.baseLang(String(mat.lang || ""));
  if (setLang) return setLang;
  if (mat.sourceType === "pdf") {
    const pages = pdfPagesOfSync ? pdfPagesOfSync(mat.id) || [] : [];
    return lmText.detectLang(pages.slice(0, 3).join("\n"));
  }
  return "";
}

/** 预载 PDF 页文本（language 检测兜底用），返回同步取用器 */
async function preloadPdfPages() {
  const map = new Map();
  const rows = await learnerDb.all("SELECT DISTINCT library_item_id AS itemId FROM pdf_page_texts");
  for (const r of rows) {
    const pages = await learnerDb.all("SELECT text FROM pdf_page_texts WHERE library_item_id = ? ORDER BY page ASC", [String(r.itemId)]);
    map.set(String(r.itemId), pages.map((p) => String(p.text)));
  }
  return (itemId) => map.get(String(itemId)) || null;
}

async function getMarkdown(itemId) {
  const doc = dbModule.getDocument(String(itemId));
  return String((doc && doc.markdown) || "");
}

async function unitPlainOf(unitRow, mdCache) {
  if (unitRow.md_from != null && unitRow.md_to != null) {
    const item = unitRow.library_item_id;
    if (!mdCache.has(item)) mdCache.set(item, await getMarkdown(item));
    const md = mdCache.get(item) || "";
    return lmText.markdownToPlain(md.slice(Number(unitRow.md_from), Number(unitRow.md_to)));
  }
  const pages = await learnerDb.all(
    "SELECT text FROM pdf_page_texts WHERE library_item_id = ? AND page >= ? AND page <= ? ORDER BY page ASC",
    [unitRow.library_item_id, Number(unitRow.page_from) || 0, Number(unitRow.page_to) || 0]
  );
  return pages.map((p) => String(p.text)).join("\n");
}

async function unitsOfItem(itemId) {
  return learnerDb.all(
    "SELECT * FROM content_units WHERE library_item_id = ? ORDER BY ord ASC",
    [String(itemId)]
  );
}

// ---------- 第 1 步：内容单元索引 ----------

async function stepUnits() {
  await learnerDb.open();
  const facts = await loadFacts();
  const liveItems = new Set((facts.materials || []).map((m) => String(m.id)));
  const docByItem = new Map((facts.documents || []).map((d) => [String(d.libraryItemId), d]));

  // 先清理：材料已删（或不存在的）→ 其全部派生行删除
  const staleItems = (
    await learnerDb.all("SELECT DISTINCT library_item_id AS itemId FROM content_units")
  )
    .map((r) => String(r.itemId))
    .filter((id) => !liveItems.has(id));
  for (const itemId of staleItems) {
    await purgeItemRows(itemId);
  }

  // 判断哪些文档需要重新切分
  const unitMeta = new Map(
    (await learnerDb.all(
      "SELECT document_id AS documentId, MIN(indexed_at) AS indexedAt, MIN(seg_version) AS segVersion, COUNT(*) AS n FROM content_units GROUP BY document_id"
    )).map((r) => [String(r.documentId), r])
  );
  const docUnitCount = new Map();
  for (const [docId, r] of unitMeta) docUnitCount.set(docId, Number(r.n) || 0);

  let processed = 0;
  const total = (facts.materials || []).length;
  status.total = total;
  for (const mat of facts.materials || []) {
    processed += 1;
    status.done = processed;
    const itemId = String(mat.id);
    const doc = docByItem.get(itemId);
    if (!doc) continue;
    const isPdf = String(mat.sourceType) === "pdf";
    if (!isPdf && !doc.hasMarkdown) continue; // ebook 等（markdown 为空且非 PDF）不切分、不进入推荐
    const meta = unitMeta.get(String(doc.id));
    const needs =
      !meta ||
      Number(doc.updatedAt) > Number(meta.indexedAt) ||
      Number(meta.segVersion) !== P.SEG_VERSION;
    if (!needs) continue;

    if (isPdf) {
      const pageTexts = extractPdfPages ? await extractPdfPages(itemId) : null;
      await learnerDb.run("DELETE FROM pdf_page_texts WHERE library_item_id = ?", [itemId]);
      if (!pageTexts || pageTexts.length === 0) {
        await deleteDocUnits(String(doc.id));
        continue;
      }
      for (let i = 0; i < pageTexts.length; i++) {
        await learnerDb.run("INSERT OR REPLACE INTO pdf_page_texts (library_item_id, page, text) VALUES (?, ?, ?)", [
          itemId,
          i,
          String(pageTexts[i] || "")
        ]);
      }
      await deleteDocUnits(String(doc.id));
      const units = lmText.segmentPages(pageTexts);
      await insertUnits(doc.id, itemId, units, pageTexts, "");
    } else {
      const md = await getMarkdown(itemId);
      if (!md) continue;
      await deleteDocUnits(String(doc.id));
      const units = lmText.segmentMarkdown(md);
      await insertUnits(doc.id, itemId, units, null, md);
    }
    if (processed % 5 === 0) await yieldNow();
  }

  // 清理孤儿 unit_progress（切分后 id 不复存在的丢弃，设计稿 §6.1）
  await learnerDb.run("DELETE FROM unit_progress WHERE unit_id NOT IN (SELECT id FROM content_units)");
  // 清理已删材料的 PDF 页文本与高水位
  await learnerDb.run("DELETE FROM pdf_page_texts WHERE library_item_id NOT IN (SELECT id FROM content_units)");
  await learnerDb.run("DELETE FROM pdf_high_water WHERE library_item_id NOT IN (SELECT DISTINCT library_item_id FROM content_units)");
}

function unitHeadText(plain) {
  return String(plain || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

async function insertUnits(documentId, itemId, units, pageTexts, md) {
  const now = Date.now();
  for (const u of units) {
    let plain;
    if (pageTexts) {
      plain = pageTexts.slice(Number(u.pageFrom) || 0, (Number(u.pageTo) || 0) + 1).join("\n");
    } else {
      plain = lmText.markdownToPlain(md.slice(u.mdFrom, u.mdTo));
    }
    const id = `${documentId}#${u.ord}`;
    await learnerDb.run(
      `INSERT OR REPLACE INTO content_units
       (id, library_item_id, document_id, ord, title, heading_path_json, md_from, md_to, page_from, page_to, plain_len, head_text, lang, is_exercise, seg_version, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
      [
        id,
        itemId,
        documentId,
        Number(u.ord) || 0,
        String(u.title || ""),
        JSON.stringify(u.headingPath || []),
        u.mdFrom == null ? null : Number(u.mdFrom),
        u.mdTo == null ? null : Number(u.mdTo),
        u.pageFrom == null ? null : Number(u.pageFrom),
        u.pageTo == null ? null : Number(u.pageTo),
        Number(u.plainLen) || 0,
        unitHeadText(plain),
        u.isExercise ? 1 : 0,
        P.SEG_VERSION,
        now
      ]
    );
  }
}

async function deleteDocUnits(documentId) {
  // unit_lex 删除时按旧 lex_json 回减 lexemes 计数（设计稿 §6.2 词项索引「先清理」）
  const rows = await learnerDb.all(
    "SELECT u.id AS unitId, l.lex_json AS lexJson FROM content_units u LEFT JOIN unit_lex l ON l.unit_id = u.id WHERE u.document_id = ?",
    [String(documentId)]
  );
  for (const r of rows) {
    await decrementLexemes(r.lexJson);
  }
  await learnerDb.run("DELETE FROM unit_lex WHERE unit_id IN (SELECT id FROM content_units WHERE document_id = ?)", [String(documentId)]);
  await learnerDb.run("DELETE FROM unit_kp_links WHERE unit_id IN (SELECT id FROM content_units WHERE document_id = ?)", [String(documentId)]);
  await learnerDb.run("DELETE FROM content_units WHERE document_id = ?", [String(documentId)]);
}

async function purgeItemRows(itemId) {
  const rows = await learnerDb.all(
    "SELECT u.id AS unitId, l.lex_json AS lexJson FROM content_units u LEFT JOIN unit_lex l ON l.unit_id = u.id WHERE u.library_item_id = ?",
    [String(itemId)]
  );
  for (const r of rows) await decrementLexemes(r.lexJson);
  await learnerDb.run("DELETE FROM unit_lex WHERE unit_id IN (SELECT id FROM content_units WHERE library_item_id = ?)", [String(itemId)]);
  await learnerDb.run("DELETE FROM unit_kp_links WHERE unit_id IN (SELECT id FROM content_units WHERE library_item_id = ?)", [String(itemId)]);
  await learnerDb.run("DELETE FROM unit_progress WHERE unit_id IN (SELECT id FROM content_units WHERE library_item_id = ?)", [String(itemId)]);
  await learnerDb.run("DELETE FROM content_units WHERE library_item_id = ?", [String(itemId)]);
  await learnerDb.run("DELETE FROM pdf_page_texts WHERE library_item_id = ?", [String(itemId)]);
  await learnerDb.run("DELETE FROM pdf_high_water WHERE library_item_id = ?", [String(itemId)]);
}

async function decrementLexemes(lexJsonText) {
  const arr = parseJsonSafe(lexJsonText, []);
  if (!Array.isArray(arr)) return;
  for (const [lexemeId, count] of arr) {
    await learnerDb.run("UPDATE lexemes SET total_count = MAX(0, total_count - ?), unit_count = MAX(0, unit_count - 1) WHERE id = ?", [
      Number(count) || 0,
      Number(lexemeId) || 0
    ]);
  }
}

// ---------- 第 2 步：通读次数（设计稿 §6.4） ----------

async function stepPasses() {
  await learnerDb.open();
  const wm = Number(await learnerDb.getMeta("passes_watermark")) || 0;
  const facts = await loadFacts({ readingEventsAfter: wm, readingEventsTailBefore: wm });
  // 恢复备份后水位可能超前（§9.4）：清零水位并清空 unit_progress 全量重算
  if (wm > (Number(facts.readingEventsMax) || 0)) {
    await learnerDb.run("DELETE FROM unit_progress");
    await learnerDb.setMeta("passes_watermark", "0");
  }
  const curWm = Number(await learnerDb.getMeta("passes_watermark")) || 0;
  const docByItem = new Map((facts.documents || []).map((d) => [String(d.libraryItemId), d]));
  const byItem = new Map();
  for (const e of [...(facts.readingEventTail || []), ...(facts.readingEvents || [])]) {
    const item = String(e.itemId);
    if (!byItem.has(item)) byItem.set(item, []);
    byItem.get(item).push({ char_pos: Number(e.charPos) || 0, created_at: Number(e.createdAt) || 0 });
  }
  const mdLenCache = new Map();
  for (const [itemId, evs] of byItem) {
    const doc = docByItem.get(itemId);
    if (!doc) continue;
    const units = (await unitsOfItem(itemId)).filter((u) => u.md_to != null);
    if (units.length === 0) continue;
    if (!mdLenCache.has(itemId)) mdLenCache.set(itemId, Number(doc.markdownLen) || 0);
    const docLen = mdLenCache.get(itemId);
    evs.sort((a, b) => a.created_at - b.created_at);
    const map = lmLevels.computePasses(evs, units, docLen);
    for (const [unitId, tsArr] of map) {
      const row = (await learnerDb.all("SELECT passes_json FROM unit_progress WHERE unit_id = ?", [unitId]))[0];
      const old = parseJsonSafe(row ? row.passes_json : "[]", []);
      const merged = lmLevels.mergePassTimestamps(old, tsArr);
      await learnerDb.run(
        "INSERT INTO unit_progress (unit_id, passes_json, last_pass_at) VALUES (?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET passes_json = excluded.passes_json, last_pass_at = excluded.last_pass_at",
        [unitId, JSON.stringify(merged), merged.length ? merged[merged.length - 1] : null]
      );
    }
  }
  // 推进水位（水位之后的事件里的最大 created_at）
  let newWm = curWm;
  for (const e of facts.readingEvents || []) newWm = Math.max(newWm, Number(e.createdAt) || 0);
  if (newWm > curWm) await learnerDb.setMeta("passes_watermark", String(newWm));

  // PDF 高水位（设计稿 §6.4）
  const now = Date.now();
  for (const mat of facts.materials || []) {
    if (String(mat.sourceType) !== "pdf") continue;
    const itemId = String(mat.id);
    const hasUnits = (await learnerDb.all("SELECT COUNT(*) AS n FROM content_units WHERE library_item_id = ?", [itemId]))[0];
    if (!hasUnits || Number(hasUnits.n) === 0) continue;
    const prog = parseJsonSafe(mat.progressJson, null);
    const pageIndex = prog && Number.isInteger(Number(prog.pageIndex)) ? Number(prog.pageIndex) : null;
    if (pageIndex === null || pageIndex < 0) continue;
    const hwRow = (await learnerDb.all("SELECT page FROM pdf_high_water WHERE library_item_id = ?", [itemId]))[0];
    const maxPageRow = (await learnerDb.all("SELECT MAX(page) AS mp FROM pdf_page_texts WHERE library_item_id = ?", [itemId]))[0];
    if (!maxPageRow || maxPageRow.mp == null) continue; // 还没抽页文本
    const total = Number(maxPageRow.mp) + 1;
    const old = hwRow ? Number(hwRow.page) : null;
    if (old === null) {
      // 首次见到某 PDF 时只记 high water
      await learnerDb.run("INSERT INTO pdf_high_water (library_item_id, page, ts) VALUES (?, ?, ?) ON CONFLICT(library_item_id) DO UPDATE SET page = excluded.page, ts = excluded.ts", [itemId, pageIndex, now]);
      continue;
    }
    if (pageIndex > old) {
      const jump = pageIndex - old;
      if (jump <= P.PDF_JUMP_PAGES) {
        const atEnd = pageIndex >= total - 1;
        const units = (await unitsOfItem(itemId)).filter((u) => u.page_to != null);
        for (const u of units) {
          const pTo = Number(u.page_to);
          const hit = atEnd ? old <= pTo && pTo <= pageIndex : old <= pTo && pTo < pageIndex;
          if (hit) await addPass(u.id, now);
        }
      }
      // 差值 > 30 视为跳转：只更新 high water 不记通读
      await learnerDb.run("INSERT INTO pdf_high_water (library_item_id, page, ts) VALUES (?, ?, ?) ON CONFLICT(library_item_id) DO UPDATE SET page = excluded.page, ts = excluded.ts", [itemId, pageIndex, now]);
    }
  }

  // unit_reread 事件也记一次通读（时间戳 = 事件 ts；merge 去重保证幂等）
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "unit_reread" || !e.unit_id) continue;
    await addPass(String(e.unit_id), Number(e.ts) || now);
  }
}

async function addPass(unitId, ts) {
  if (!unitId) return;
  const row = (await learnerDb.all("SELECT passes_json FROM unit_progress WHERE unit_id = ?", [unitId]))[0];
  const merged = lmLevels.mergePassTimestamps(parseJsonSafe(row ? row.passes_json : "[]", []), [Number(ts) || 0]);
  await learnerDb.run(
    "INSERT INTO unit_progress (unit_id, passes_json, last_pass_at) VALUES (?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET passes_json = excluded.passes_json, last_pass_at = excluded.last_pass_at",
    [unitId, JSON.stringify(merged), merged.length ? merged[merged.length - 1] : null]
  );
}

// ---------- 第 3 步：单元 ↔ KP 链接（设计稿 §6.5） ----------

async function stepLinks() {
  await learnerDb.open();
  const facts = await loadFacts();
  const cardKp = dbModule.resolveCardKpMap();
  const docByDocId = new Map((facts.documents || []).map((d) => [String(d.id), d]));
  const extractDocMap = new Map();
  for (const e of facts.extracts || []) extractDocMap.set(String(e.id), String(e.documentId));

  // 单元文本与定位缓存
  const mdCache = new Map();
  const unitsByDoc = new Map();
  const unitPlainCache = new Map();
  const loadUnits = async (documentId) => {
    if (!unitsByDoc.has(documentId)) {
      const rows = await learnerDb.all("SELECT * FROM content_units WHERE document_id = ? ORDER BY ord ASC", [documentId]);
      unitsByDoc.set(documentId, rows);
    }
    return unitsByDoc.get(documentId);
  };
  const plainOf = async (u) => {
    if (!unitPlainCache.has(u.id)) unitPlainCache.set(u.id, await unitPlainOf(u, mdCache));
    return unitPlainCache.get(u.id);
  };

  const locateUnit = async (documentId, ref, itemIsPdf) => {
    if (!documentId) return null;
    const units = await loadUnits(String(documentId));
    if (units.length === 0) return null;
    const pageIndex = ref && Number.isInteger(Number(ref.pageIndex)) ? Number(ref.pageIndex) : null;
    if (pageIndex !== null && itemIsPdf) {
      const hit = units.find((u) => u.page_from != null && Number(u.page_from) <= pageIndex && pageIndex <= Number(u.page_to));
      if (hit) return hit;
    }
    const compress = (s) => String(s || "").replace(/\s+/g, " ").trim();
    if (ref && ref.anchorText) {
      const q = compress(ref.anchorText).slice(0, 40);
      if (q) {
        // (a) 在文档 markdown 中 indexOf
        const doc = docByDocId.get(String(documentId));
        if (doc && doc.libraryItemId) {
          if (!mdCache.has(doc.libraryItemId)) mdCache.set(doc.libraryItemId, await getMarkdown(doc.libraryItemId));
          const md = mdCache.get(doc.libraryItemId) || "";
          const p = md.indexOf(q);
          if (p >= 0) {
            const hit = units.find((u) => u.md_from != null && Number(u.md_from) <= p && p < Number(u.md_to));
            if (hit) return hit;
          }
        }
        // (b) 每个单元的纯文本（空白压缩）includes
        for (const u of units) {
          const plain = compress(await plainOf(u));
          if (plain && plain.includes(q)) return u;
        }
        // (c) q 取前 15 字重复 (b)
        const q15 = q.slice(0, 15);
        if (q15 && q15 !== q) {
          for (const u of units) {
            const plain = compress(await plainOf(u));
            if (plain && plain.includes(q15)) return u;
          }
        }
      }
    }
    // 第 2 步落空且有 anchorRatio
    if (ref && ref.anchorRatio != null) {
      const doc = docByDocId.get(String(documentId));
      if (doc && doc.libraryItemId) {
        if (!mdCache.has(doc.libraryItemId)) mdCache.set(doc.libraryItemId, await getMarkdown(doc.libraryItemId));
        const md = mdCache.get(doc.libraryItemId) || "";
        const p = Math.floor((Number(ref.anchorRatio) || 0) * md.length);
        const hit = units.find((u) => u.md_from != null && Number(u.md_from) <= p && p < Number(u.md_to));
        if (hit) return hit;
      }
    }
    return null;
  };

  const addLink = async (unitId, kpId, source, weight) => {
    if (!unitId || !kpId) return;
    await learnerDb.run(
      "INSERT OR IGNORE INTO unit_kp_links (unit_id, kp_id, source, weight) VALUES (?, ?, ?, ?)",
      [String(unitId), String(kpId), source, Number(weight) || 0]
    );
  };

  // 卡片 → 材料 / 单元（source=card）
  const pdfItems = new Set(
    (facts.materials || []).filter((m) => String(m.sourceType) === "pdf").map((m) => String(m.id))
  );
  for (const card of facts.cards || []) {
    const kpId = cardKp.get(String(card.id));
    if (!kpId) continue;
    const ref = parseContextRef(card.contextRefJson);
    let documentId = ref && ref.documentId ? String(ref.documentId) : null;
    if (!documentId && ref && ref.extractId) documentId = extractDocMap.get(String(ref.extractId)) || null;
    if (!documentId) continue;
    const item = docByDocId.get(String(documentId));
    if (!item) continue;
    const unit = await locateUnit(String(documentId), ref, pdfItems.has(String(item.libraryItemId)));
    if (unit) await addLink(unit.id, kpId, "card", 1.0);
  }

  // 摘录 → 单元（source=extract：摘录派生的卡片的 KP）
  const extractUnit = new Map();
  const cardsByExtract = new Map();
  for (const card of facts.cards || []) {
    const ref = parseContextRef(card.contextRefJson);
    if (ref && ref.extractId) {
      const exId = String(ref.extractId);
      if (!cardsByExtract.has(exId)) cardsByExtract.set(exId, []);
      cardsByExtract.get(exId).push(card);
    }
  }
  for (const ex of facts.extracts || []) {
    const exId = String(ex.id);
    const ref = parseContextRef(ex.contextRefJson);
    const unit = await locateUnit(String(ex.documentId), ref, pdfItems.has(String(ex.libraryItemId)));
    if (unit) extractUnit.set(exId, unit.id);
  }
  for (const [exId, cards] of cardsByExtract) {
    const unitId = extractUnit.get(exId);
    if (!unitId) continue;
    for (const card of cards) {
      const kpId = cardKp.get(String(card.id));
      if (kpId) await addLink(unitId, kpId, "extract", 1.0);
    }
  }

  // lexical 链接（设计稿 §6.5：label/alias 归一后长度达标，单元归一文本出现 ≥2 次或出现在标题里）
  const kps = facts.kps || [];
  const kpFpInput = kps
    .map((k) => `${k.id}:${k.updatedAt}`)
    .sort()
    .join("|");
  const kpFp = require("node:crypto").createHash("sha1").update(kpFpInput).digest("hex");
  const prevFp = await learnerDb.getMeta("kp_lexical_fp");
  const allUnits = await learnerDb.all("SELECT * FROM content_units ORDER BY document_id ASC, ord ASC");
  if (prevFp !== kpFp) {
    await learnerDb.run("DELETE FROM unit_kp_links WHERE source = 'lexical'");
  }
  const withLex = new Set(
    (await learnerDb.all("SELECT DISTINCT unit_id AS unitId FROM unit_kp_links WHERE source = 'lexical'")).map((r) => String(r.unitId))
  );
  // KP 候选（归一后长度达标）
  const hasIdeo = (s) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(s);
  const kpCandidates = [];
  for (const kp of kps) {
    const labels = [String(kp.label || ""), ...parseJsonSafe(kp.aliasJson, [])].filter(Boolean);
    const norms = new Set();
    for (const label of labels) {
      const norm = normalizeKpLabel(label);
      if (!norm) continue;
      const okLen = hasIdeo(norm) ? norm.length >= 2 : norm.length >= 6;
      if (okLen) norms.add(norm);
    }
    if (norms.size > 0) kpCandidates.push({ kpId: String(kp.id), domainId: kp.domainId ? String(kp.domainId) : null, norms: [...norms] });
  }
  let done = 0;
  for (const u of allUnits) {
    done += 1;
    if (prevFp === kpFp && withLex.has(String(u.id))) continue; // 指纹不变时只对新切分的单元跑 lexical
    const plain = await plainOf(u);
    const normText = normalizeKpLabel(plain);
    const normTitle = normalizeKpLabel(u.title);
    for (const cand of kpCandidates) {
      let count = 0;
      let inTitle = false;
      for (const norm of cand.norms) {
        if (normTitle.includes(norm)) inTitle = true;
        let idx = 0;
        while ((idx = normText.indexOf(norm, idx)) !== -1) {
          count += 1;
          idx += norm.length;
        }
      }
      if (count >= 2 || inTitle) {
        await addLink(u.id, cand.kpId, "lexical", Math.min(1, Math.max(count, inTitle ? 1 : 0) / 5) * 0.6);
      }
    }
    if (done % 200 === 0) await yieldNow(); // 每 200 个单元让出主进程
  }
  await learnerDb.setMeta("kp_lexical_fp", kpFp);
}

// ---------- 第 4 步：KP 等级（设计稿 §6.6） ----------

function gradeOfRating(rating) {
  const r = String(rating || "").toLowerCase();
  if (r === "again" || r === "1") return 1;
  if (r === "hard" || r === "2") return 2;
  if (r === "good" || r === "3") return 3;
  if (r === "easy" || r === "4") return 4;
  return 0;
}

async function stepKp() {
  await learnerDb.open();
  const facts = await loadFacts();
  const now = Date.now();
  const cardKp = dbModule.resolveCardKpMap();
  const decayCache = new Map();
  const decayOf = (configId) => {
    const key = String(configId || "");
    if (decayCache.has(key)) return decayCache.get(key);
    let decay = P.FSRS_DEFAULT_DECAY;
    const row = (facts.fsrsConfigs || []).find((c) => String(c.id) === key);
    if (row) {
      try {
        const w = JSON.parse(row.weightsJson || "null");
        if (Array.isArray(w) && w.length >= 21 && Number.isFinite(Number(w[20]))) decay = Number(w[20]);
      } catch {
        /* 解析失败用默认 */
      }
    }
    decayCache.set(key, decay);
    return decay;
  };

  // 卡片证据（按 KP 聚合）
  const reviewsByCard = new Map();
  for (const r of facts.reviewLogs || []) {
    const cid = String(r.cardId);
    if (!reviewsByCard.has(cid)) reviewsByCard.set(cid, []);
    reviewsByCard.get(cid).push(r);
  }
  const cardsByKp = new Map();
  const cardMaterial = new Map(); // cardId → libraryItemId
  const docByDocId = new Map((facts.documents || []).map((d) => [String(d.id), d]));
  for (const card of facts.cards || []) {
    const kpId = cardKp.get(String(card.id));
    if (!kpId) continue;
    if (!cardsByKp.has(kpId)) cardsByKp.set(kpId, []);
    cardsByKp.get(kpId).push(card);
    const ref = parseContextRef(card.contextRefJson);
    const documentId = ref && ref.documentId ? String(ref.documentId) : ref && ref.extractId ? String((facts.extracts || []).find((e) => e.id === ref.extractId)?.documentId || "") : "";
    const doc = docByDocId.get(documentId);
    if (doc) cardMaterial.set(String(card.id), String(doc.libraryItemId));
  }

  // 摘录 → KP（lexical 规则临时算，不存表；设计稿 §6.5）
  const extractKpIds = computeExtractKpIds(facts);
  const extractCountByKp = new Map();
  for (const ids of extractKpIds.values()) {
    for (const kpId of ids) extractCountByKp.set(kpId, (extractCountByKp.get(kpId) || 0) + 1);
  }

  // 有通读的链接单元数
  const unitPassCount = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, passes_json AS passesJson FROM unit_progress")).map((r) => [
      String(r.unitId),
      parseJsonSafe(r.passesJson, []).length
    ])
  );
  const links = await learnerDb.all("SELECT unit_id AS unitId, kp_id AS kpId FROM unit_kp_links");
  const passedUnitsByKp = new Map();
  for (const l of links) {
    if ((unitPassCount.get(String(l.unitId)) || 0) > 0) {
      passedUnitsByKp.set(String(l.kpId), (passedUnitsByKp.get(String(l.kpId)) || 0) + 1);
    }
  }

  // 近 90 天 self_explain（clear）计数
  const selfExplainClear = new Map();
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "self_explain") continue;
    const payload = parseJsonSafe(e.payloadJson, {});
    if (payload.selfRating !== "clear") continue;
    if (now - (Number(e.ts) || 0) > 90 * DAY) continue;
    const kpId = String(e.kp_id || "");
    selfExplainClear.set(kpId, (selfExplainClear.get(kpId) || 0) + 1);
  }

  const oldStates = new Map(
    (await learnerDb.all("SELECT kp_id AS kpId, first_l3_at AS firstL3At, first_l4_at AS firstL4At FROM kp_states")).map((r) => [
      String(r.kpId),
      r
    ])
  );
  const rows = [];
  for (const kp of facts.kps || []) {
    if (kp.mergedInto) continue; // 只算 active 根 KP（合并来源的卡已沿 merged_into 归到根）
    const kpId = String(kp.id);
    const cards = (cardsByKp.get(kpId) || []).map((card) => {
      const fsrs = parseJsonSafe(card.fsrsJson, null) || {};
      const lastReview = Number(fsrs.lastReview) || 0;
      const reps = Number(fsrs.reps) || 0;
      const reviews = reviewsByCard.get(String(card.id)) || [];
      let lapses30 = 0;
      const reviewDays = new Set();
      let lastRating = 0;
      for (const r of reviews) {
        const g = gradeOfRating(r.rating);
        if (g === 1 && now - (Number(r.reviewedAt) || 0) <= P.KP.LAPSE_WINDOW_DAYS * DAY) lapses30 += 1;
        const d = new Date(Number(r.reviewedAt) || 0);
        reviewDays.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        lastRating = g; // reviews 升序 ⇒ 末次覆盖
      }
      const R =
        reps >= 1 && lastReview
          ? lmLevels.retrievability((now - lastReview) / DAY, Number(fsrs.stability) || 0, decayOf(card.fsrsConfigId))
          : 0;
      return {
        cardType: String(card.cardType || "qa"),
        reviewed: reps >= 1 && Boolean(lastReview),
        R,
        S: Number(fsrs.stability) || 0,
        lapses30,
        lastRating,
        reviewDays,
        reviewCount: reviews.length
      };
    });
    const res = lmLevels.computeKpLevel({
      now,
      cards,
      extractCount: extractCountByKp.get(kpId) || 0,
      passedUnitCount: passedUnitsByKp.get(kpId) || 0,
      selfExplainClear90: selfExplainClear.get(kpId) || 0
    });
    const old = oldStates.get(kpId);
    rows.push({
      kpId,
      level: res.level,
      score: res.score,
      confidence: res.confidence,
      fading: res.fading ? 1 : 0,
      metricsJson: JSON.stringify(res.metrics),
      firstL3At: res.level >= 3 ? (old && old.firstL3At ? Number(old.firstL3At) : now) : old && old.firstL3At ? Number(old.firstL3At) : null,
      firstL4At: res.level >= 4 ? (old && old.firstL4At ? Number(old.firstL4At) : now) : old && old.firstL4At ? Number(old.firstL4At) : null,
      computedAt: now
    });
  }
  await learnerDb.run("DELETE FROM kp_states");
  for (const r of rows) {
    await learnerDb.run(
      "INSERT INTO kp_states (kp_id, level, score, confidence, fading, metrics_json, first_l3_at, first_l4_at, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [r.kpId, r.level, r.score, r.confidence, r.fading, r.metricsJson, r.firstL3At, r.firstL4At, r.computedAt]
    );
  }
}

/** 摘录 KP 匹配（lexical 规则：归一后 ≥2 次出现；设计稿 §6.5「摘录正文也用同一 lexical 规则」） */
function computeExtractKpIds(facts) {
  const hasIdeo = (s) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(s);
  const kps = (facts.kps || []).map((kp) => {
    const labels = [String(kp.label || ""), ...parseJsonSafe(kp.aliasJson, [])].filter(Boolean);
    const norms = new Set();
    for (const label of labels) {
      const norm = normalizeKpLabel(label);
      if (!norm) continue;
      if (hasIdeo(norm) ? norm.length >= 2 : norm.length >= 6) norms.add(norm);
    }
    return { kpId: String(kp.id), norms: [...norms] };
  });
  const out = new Map();
  for (const ex of facts.extracts || []) {
    const normText = normalizeKpLabel(String(ex.contentMarkdown || ""));
    if (!normText) continue;
    const ids = [];
    for (const cand of kps) {
      let count = 0;
      for (const norm of cand.norms) {
        let idx = 0;
        while ((idx = normText.indexOf(norm, idx)) !== -1) {
          count += 1;
          idx += norm.length;
        }
      }
      if (count >= 2) ids.push(cand.kpId);
    }
    out.set(String(ex.id), ids);
  }
  return out;
}

// ---------- 第 5 步：词项索引与状态（设计稿 §6.2/§6.7/§6.8，仅 language 轨道材料） ----------

async function stepLex() {
  await learnerDb.open();
  const facts = await loadFacts();
  const settings = learnerSettings();
  const trackRows = dbModule.listLearnerTracks();
  const usingProposals = trackRows.length === 0;
  const udcLabels = {};
  for (const l of UDC_LEAVES) udcLabels[l.code] = l.label;
  const cardUdcCounts = {};
  for (const card of facts.cards || []) {
    let dom = [];
    try {
      dom = card.domain ? JSON.parse(card.domain) : [];
    } catch {
      dom = [];
    }
    if (Array.isArray(dom) && dom[0]) cardUdcCounts[String(dom[0])] = (cardUdcCounts[String(dom[0])] || 0) + 1;
  }
  const pdfPagesOf = await preloadPdfPages();
  const matMeta = (facts.materials || []).map((m) => ({
    id: String(m.id),
    lang: materialLangOf(m, facts, pdfPagesOf),
    dominantUdc: dominantUdcOf(facts, String(m.id)),
    lexicalUdcCounts: {}
  }));
  const proposals = usingProposals
    ? lmRecommend.proposeTracks({ materials: matMeta, cardUdcCounts, nativeLangs: settings.effectiveNativeLangs, tracks: [], uiLocale: settings.locale, udcLabels })
    : [];
  const effTracks = usingProposals
    ? proposals.map((p) => ({ id: `proposal:${p.key}`, label: p.label, mode: p.mode, lang: p.lang, udcCodes: p.udcCodes, status: "active", pinned: false, priority: 3, source: "proposal" }))
    : trackRows;
  const overrides = new Map((facts.overrides || []).map((o) => [`${String(o.trackId)}:${String(o.libraryItemId)}`, Number(o.member)]));
  const materialLangMap = new Map(matMeta.map((m) => [m.id, m.lang]));
  const langMaterials = new Set(); // 属于任一 language 轨道的材料
  for (const t of effTracks) {
    if (t.mode !== "language" || !t.lang) continue;
    for (const m of facts.materials || []) {
      const lang = materialLangMap.get(String(m.id)) || "";
      if (lang !== String(t.lang).toLowerCase()) continue;
      if (
        lmRecommend.resolveMembership({ ...t, id: String(t.id) }, { id: String(m.id), lang, dominantUdc: null, lexicalUdcCounts: {} }, overrides)
      ) {
        langMaterials.add(String(m.id));
      }
    }
  }

  // 先清理：不再属于任何 language 轨道（或已删除）的材料 → unit_lex 删除并回减 lexemes
  const unitLexRows = await learnerDb.all("SELECT unit_id AS unitId, lex_json AS lexJson FROM unit_lex");
  for (const row of unitLexRows) {
    const unit = (await learnerDb.all("SELECT library_item_id AS itemId FROM content_units WHERE id = ?", [row.unitId]))[0];
    if (!unit || !langMaterials.has(String(unit.itemId))) {
      await decrementLexemes(row.lexJson);
      await learnerDb.run("DELETE FROM unit_lex WHERE unit_id = ?", [row.unitId]);
    }
  }

  // 索引新单元（§6.2 词项索引）
  const lexVersionRows = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, lex_version AS lexVersion FROM unit_lex")).map((r) => [String(r.unitId), Number(r.lexVersion)])
  );
  const langByItem = new Map([...langMaterials].map((itemId) => [itemId, materialLangMap.get(itemId) || ""]));
  const unitsToIndex = [];
  for (const itemId of [...langMaterials].sort()) {
    for (const u of await unitsOfItem(itemId)) {
      if (!lexVersionRows.has(String(u.id)) || lexVersionRows.get(String(u.id)) !== P.LEX_VERSION) unitsToIndex.push(u);
    }
  }
  const mdCache = new Map();
  let lexCount = 0;
  for (const u of unitsToIndex) {
    const lang = langByItem.get(String(u.library_item_id)) || "";
    const plain = await unitPlainOf(u, mdCache);
    await indexUnitLex(u, lang, plain);
    lexCount += 1;
    if (lexCount % 200 === 0) await yieldNow();
  }

  // 无停用词表语言的「频率替代」（§6.2）：每语言 total_count 前 50 现算
  const allLexemes = await learnerDb.all("SELECT * FROM lexemes ORDER BY id ASC");
  const freqStop = new Map(); // lang → Set(key)
  const lexemesByLang = new Map();
  for (const lex of allLexemes) {
    const lang = String(lex.lang);
    if (!lexemesByLang.has(lang)) lexemesByLang.set(lang, []);
    lexemesByLang.get(lang).push(lex);
  }
  for (const [lang, list] of lexemesByLang) {
    if (lmLex.HAS_STOPWORDS(lang)) continue;
    const top = list
      .slice()
      .sort((a, b) => Number(b.total_count) - Number(a.total_count) || Number(a.id) - Number(b.id))
      .slice(0, P.FREQ_STOP_TOP)
      .map((l) => String(l.key));
    freqStop.set(lang, new Set(top));
  }
  const isStopKey = (lang, key) => {
    const table = lmLex.STOPWORDS[lang];
    if (table && table.has(String(key))) return true;
    return (freqStop.get(lang) || new Set()).has(String(key));
  };

  // 词项状态（§6.7）
  const langLexemes = new Map(); // lang → Map(key → lexeme)
  for (const [lang, list] of lexemesByLang) {
    const m = new Map();
    for (const l of list) m.set(String(l.key), l);
    langLexemes.set(lang, m);
  }
  const unitPassCounts = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, passes_json AS passesJson FROM unit_progress")).map((r) => [
      String(r.unitId),
      parseJsonSafe(r.passesJson, []).length
    ])
  );
  const unitLexMap = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, lang, lex_json AS lexJson, token_count AS tokenCount FROM unit_lex")).map((r) => [
      String(r.unitId),
      r
    ])
  );
  // exposure（Σ 含该词的单元的通读次数 / Σ 次数×通读次数）
  const exposure = new Map(); // lexemeId → { passes, tokens }
  for (const [unitId, row] of unitLexMap) {
    const passes = unitPassCounts.get(unitId) || 0;
    if (passes === 0) continue;
    for (const [lexemeId, count] of parseJsonSafe(row.lexJson, [])) {
      const id = Number(lexemeId);
      if (!exposure.has(id)) exposure.set(id, { passes: 0, tokens: 0 });
      const e = exposure.get(id);
      e.passes += passes;
      e.tokens += (Number(count) || 0) * passes;
    }
  }
  // 查词事件 → 词项（句内重叠规则，§6.7）
  const lookupsByLexeme = new Map(); // lexemeId → [ts]
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "dict_lookup" || !e.lang) continue;
    const payload = parseJsonSafe(e.payloadJson, {});
    const lang = lmLex.baseLang(String(e.lang));
    const keys = lookupKeysForEvent(payload, lang);
    for (const key of keys) {
      const lex = (langLexemes.get(lang) || new Map()).get(key);
      if (!lex) continue;
      const id = Number(lex.id);
      if (!lookupsByLexeme.has(id)) lookupsByLexeme.set(id, []);
      lookupsByLexeme.get(id).push(Number(e.ts) || 0);
    }
  }
  // lexeme_mark → lastMark
  const lastMarkByLexeme = new Map(); // lexemeId → {mark, ts}
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "lexeme_mark" || !e.lang) continue;
    const payload = parseJsonSafe(e.payloadJson, {});
    const lang = lmLex.baseLang(String(e.lang));
    const ts = Number(e.ts) || 0;
    for (const key of (payload.keys || []).map(String)) {
      const lex = (langLexemes.get(lang) || new Map()).get(key);
      if (!lex) continue;
      const id = Number(lex.id);
      const prev = lastMarkByLexeme.get(id);
      if (!prev || ts > prev.ts) lastMarkByLexeme.set(id, { mark: payload.mark, ts });
    }
  }
  // 词汇卡 → 词项（同一词项多张词汇卡取 R 最低的一张；未复习视为 {R:0,S:0}，设计稿 §6.7）
  const vocabCardByLexeme = new Map(); // lexemeId → {R, S}
  const docItemByDocId = new Map((facts.documents || []).map((d) => [String(d.id), String(d.libraryItemId)]));
  const decayByConfig = new Map();
  const decayOfConfig = (configId) => {
    const key = String(configId || "");
    if (decayByConfig.has(key)) return decayByConfig.get(key);
    let decay = P.FSRS_DEFAULT_DECAY;
    const row = (facts.fsrsConfigs || []).find((c) => String(c.id) === key);
    if (row) {
      try {
        const w = JSON.parse(row.weightsJson || "null");
        if (Array.isArray(w) && w.length >= 21 && Number.isFinite(Number(w[20]))) decay = Number(w[20]);
      } catch {
        /* 解析失败用默认 */
      }
    }
    decayByConfig.set(key, decay);
    return decay;
  };
  const nowLex = Date.now();
  for (const card of facts.cards || []) {
    if (!card.dictJson) continue;
    const dict = parseJsonSafe(card.dictJson, null);
    if (!dict || !dict.word) continue;
    let lang = lmLex.baseLang(String(dict.language || ""));
    if (!lang) {
      const ref = parseContextRef(card.contextRefJson);
      const itemId = ref && ref.documentId ? docItemByDocId.get(String(ref.documentId)) : null;
      lang = (itemId && materialLangMap.get(itemId)) || "";
    }
    const key = lmLex.lexemeKey(String(dict.word), lang);
    const lex = (langLexemes.get(lang) || new Map()).get(key);
    if (!lex) continue;
    const fsrs = parseJsonSafe(card.fsrsJson, null) || {};
    const reps = Number(fsrs.reps) || 0;
    const lastReview = Number(fsrs.lastReview) || 0;
    const cand = {
      R: reps >= 1 && lastReview ? lmLevels.retrievability((nowLex - lastReview) / DAY, Number(fsrs.stability) || 0, decayOfConfig(card.fsrsConfigId)) : 0,
      S: Number(fsrs.stability) || 0
    };
    const id = Number(lex.id);
    const prev = vocabCardByLexeme.get(id);
    if (!prev || cand.R < prev.R) vocabCardByLexeme.set(id, cand);
  }
  // placement 已知词项
  const placementKnown = new Set(); // `${lang}:${key}`
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "placement" || !e.lang) continue;
    const payload = parseJsonSafe(e.payloadJson, {});
    const lang = lmLex.baseLang(String(e.lang));
    for (const key of [...(payload.knownKeys || []), ...(payload.extrapolatedKeys || [])].map(String)) {
      placementKnown.add(`${lang}:${key}`);
    }
  }
  const hasPlacementLang = new Set((facts.learningEvents || []).filter((e) => e.kind === "placement").map((e) => lmLex.baseLang(String(e.lang || ""))));

  // 逐词项计算状态（整表覆盖）。预取通读时间戳与 unit_lex→lexeme 倒排，避免逐词查询
  const unitPassTs = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, passes_json AS passesJson FROM unit_progress")).map((r) => [
      String(r.unitId),
      parseJsonSafe(r.passesJson, [])
    ])
  );
  const unitsByLexeme = new Map(); // lexemeId → [unitId]
  for (const [unitId, row] of unitLexMap) {
    for (const [lexemeId] of parseJsonSafe(row.lexJson, [])) {
      const id = Number(lexemeId);
      if (!unitsByLexeme.has(id)) unitsByLexeme.set(id, []);
      unitsByLexeme.get(id).push(unitId);
    }
  }
  // reel_done(clear) 事件 → lexemeId 集合（时间升序），供 passesAfter 统计
  const reelClearByLexeme = new Map(); // lexemeId → [ts]
  for (const e of facts.learningEvents || []) {
    if (e.kind !== "reel_done") continue;
    const payload = parseJsonSafe(e.payloadJson, {});
    if (payload.result !== "clear") continue;
    const lang = lmLex.baseLang(String(e.lang || ""));
    const ts = Number(e.ts) || 0;
    for (const key of (payload.keys || []).map(String)) {
      const lex = (langLexemes.get(lang) || new Map()).get(key);
      if (!lex) continue;
      const id = Number(lex.id);
      if (!reelClearByLexeme.has(id)) reelClearByLexeme.set(id, []);
      reelClearByLexeme.get(id).push(ts);
    }
  }
  const stateRows = [];
  for (const [lang, list] of lexemesByLang) {
    for (const lex of list) {
      const id = Number(lex.id);
      const exp = exposure.get(id) || { passes: 0, tokens: 0 };
      const lookupTimes = (lookupsByLexeme.get(id) || []).sort((a, b) => a - b);
      const card = vocabCardByLexeme.get(id) || null;
      const cardInput = card ? { R: card.R, S: card.S } : null;
      // passesAfterLastLookup：最后一次查词之后、含该词的通读次数 + 之后 reel_done(clear) 次数（§6.7）
      const lastLookup = lookupTimes.length ? Math.max(...lookupTimes) : null;
      let passesAfter = 0;
      if (lastLookup != null) {
        for (const unitId of unitsByLexeme.get(id) || []) {
          for (const ts of unitPassTs.get(unitId) || []) if (Number(ts) > lastLookup) passesAfter += 1;
        }
        for (const ts of reelClearByLexeme.get(id) || []) if (ts > lastLookup) passesAfter += 1;
      }
      const key = String(lex.key);
      const res = lmLevels.computeLexState({
        now: Date.now(),
        exposurePasses: exp.passes,
        exposureTokens: exp.tokens,
        lookupTimes,
        passesAfterLastLookup: passesAfter,
        lastMark: lastMarkByLexeme.get(id) || null,
        card: cardInput,
        placementKnown: placementKnown.has(`${lang}:${key}`)
      });
      stateRows.push({
        lexemeId: id,
        state: res.state,
        source: res.source,
        exposurePasses: exp.passes,
        exposureTokens: exp.tokens,
        lookups: lookupTimes.length,
        lastLookupAt: lastLookup,
        computedAt: Date.now()
      });
    }
  }
  await learnerDb.run("DELETE FROM lexeme_states");
  for (const r of stateRows) {
    await learnerDb.run(
      "INSERT INTO lexeme_states (lexeme_id, state, source, exposure_passes, exposure_tokens, lookups, last_lookup_at, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [r.lexemeId, r.state, r.source, r.exposurePasses, r.exposureTokens, r.lookups, r.lastLookupAt, r.computedAt]
    );
  }

  // 每单元 coverage / learningCount / easeFit（内存缓存，buildSnapshot 使用；设计稿 §9.1-5）
  lexUnitCache = new Map();
  lexStatsCache = new Map();
  const stateById = new Map(stateRows.map((r) => [Number(r.lexemeId), r]));
  for (const [lang, list] of lexemesByLang) {
    // 非停用词频次排名（total_count 降序，1 起；设计稿 §7.2 冷启动易读度）
    const nonStop = list.filter((l) => !isStopKey(lang, String(l.key)));
    const ranked = nonStop.slice().sort((a, b) => Number(b.total_count) - Number(a.total_count) || Number(a.id) - Number(b.id));
    const rankById = new Map(ranked.map((l, i) => [Number(l.id), i + 1]));
    const knownIds = new Set();
    const learningIds = new Set();
    const stopIds = new Set();
    const keyById = new Map();
    const stateKey = new Map(); // key → state
    for (const l of list) {
      keyById.set(Number(l.id), String(l.key));
      if (isStopKey(lang, String(l.key))) stopIds.add(Number(l.id));
      const st = stateById.get(Number(l.id));
      if (!st) continue;
      stateKey.set(String(l.key), st.state);
      if (st.state === "known" || st.state === "familiar") knownIds.add(Number(l.id));
      if (st.state === "learning") learningIds.add(Number(l.id));
    }
    lexStatsCache.set(lang, { rankById, nonStopTotal: ranked.length || 1, knownIds, learningIds, stopIds, keyById, stateKey, lexemes: list, lang });
  }
  for (const itemId of [...langMaterials].sort()) {
    const lang = materialLangMap.get(itemId) || "";
    const cache = lexStatsCache.get(lang);
    for (const u of await unitsOfItem(itemId)) {
      const row = unitLexMap.get(String(u.id));
      if (!row || !cache) continue;
      const lexArr = parseJsonSafe(row.lexJson, []);
      const tokenCount = Number(row.token_count) || 0;
      const isKnownId = (id) => cache.knownIds.has(Number(id)) || cache.stopIds.has(Number(id)); // 停用词计入分子（§6.2）
      const coverage = lmLex.unitCoverage(lexArr, tokenCount, isKnownId);
      const learningSet = new Set();
      let rankWeighted = 0;
      let tokenWeighted = 0;
      for (const [id, count] of lexArr) {
        const n = Number(count) || 0;
        if (cache.learningIds.has(Number(id))) learningSet.add(Number(id));
        if (cache.stopIds.has(Number(id))) continue;
        const rank = cache.rankById.get(Number(id)) || cache.nonStopTotal;
        rankWeighted += n * rank;
        tokenWeighted += n;
      }
      const avgRank = tokenWeighted > 0 ? rankWeighted / tokenWeighted : 0;
      const easeFit = clamp01(1 - avgRank / cache.nonStopTotal);
      lexUnitCache.set(String(u.id), { coverage, learningCount: learningSet.size, easeFit, lang });
    }
  }

  // mine_count:<lang>（设计稿 §8.2 K12：近 14 天通读过的单元里统计 i+1 句子，上限 50 即停）
  const now = Date.now();
  const mineCounts = new Map();
  for (const itemId of [...langMaterials].sort()) {
    const lang = materialLangMap.get(itemId) || "";
    if (!lang || mineCounts.has(lang)) continue;
    const cache = lexStatsCache.get(lang);
    if (!cache) continue;
    const isKnownKey = (key) => {
      const st = cache.stateKey.get(String(key));
      return st === "known" || st === "familiar" || isStopKey(lang, String(key));
    };
    let count = 0;
    for (const u of await unitsOfItem(itemId)) {
      if (!(unitPassTs.get(String(u.id)) || []).length) continue;
      const lastPass = await lastPassTsOf(u.id);
      if (!lastPass || now - lastPass > 14 * DAY) continue;
      const plain = await unitPlainOf(u, mdCache);
      for (const sentence of lmText.splitSentences(plain)) {
        const tokens = lmLex.tokenize(sentence.text, lang);
        if (lmLex.isIPlusOneSentence(tokens, isKnownKey, lang)) {
          count += 1;
          if (count >= 50) break;
        }
      }
      if (count >= 50) break;
    }
    mineCounts.set(lang, count);
    await learnerDb.setMeta(`mine_count:${lang}`, String(count));
  }

  // lexStats 终值缓存（buildSnapshot 直接使用；进程重启后由 buildLexStatsFromDb 兜底）
  lexStatsFinal = new Map();
  for (const [lang, cache] of lexStatsCache) {
    const learningList = cache.lexemes
      .filter((l) => cache.learningIds.has(Number(l.id)) && !cache.stopIds.has(Number(l.id)))
      .map((l) => ({ lex: l, st: stateById.get(Number(l.id)) || {} }));
    learningList.sort(
      (a, b) =>
        (Number(b.st.lastLookupAt) || 0) - (Number(a.st.lastLookupAt) || 0) ||
        Number(b.lex.total_count) - Number(a.lex.total_count) ||
        String(a.lex.key).localeCompare(String(b.lex.key))
    );
    let knownCount = 0;
    for (const l of cache.lexemes) {
      if (cache.stopIds.has(Number(l.id))) continue;
      const st = stateById.get(Number(l.id));
      if (st && (st.state === "known" || st.state === "familiar")) knownCount += 1;
    }
    lexStatsFinal.set(lang, {
      knownCount,
      totalLexemes: cache.lexemes.length,
      hasPlacement: hasPlacementLang.has(lang),
      learningTop: learningList.slice(0, 50).map(({ lex, st }) => ({
        key: String(lex.key),
        sample: String(lex.sample || lex.key),
        lastLookupAt: st.lastLookupAt || null,
        totalCount: Number(lex.total_count) || 0,
        unitCount: Number(lex.unit_count) || 0
      })),
      mineCount: mineCounts.get(lang) || 0
    });
  }
}

function clamp01(x) {
  return Math.min(1, Math.max(0, Number(x) || 0));
}
async function lastPassTsOf(unitId) {
  const row = (await learnerDb.all("SELECT last_pass_at AS lastPassAt FROM unit_progress WHERE unit_id = ?", [unitId]))[0];
  return row && row.lastPassAt ? Number(row.lastPassAt) : null;
}

/** 单元词项索引（§6.2）：tokenize → key 计数（专名不计）→ upsert lexemes → 写 unit_lex */
async function indexUnitLex(u, lang, plain) {
  const tokens = lmLex.tokenize(plain, lang);
  const counts = new Map(); // key → {count, samples: Map(surface→n)}
  let tokenCount = 0;
  for (const t of tokens) {
    if (t.proper) continue; // 专名不计入
    tokenCount += 1;
    const key = lmLex.lexemeKey(t.surface, lang);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, { count: 0, samples: new Map() });
    const c = counts.get(key);
    c.count += 1;
    c.samples.set(t.surface, (c.samples.get(t.surface) || 0) + 1);
  }
  const entries = [];
  for (const key of [...counts.keys()].sort()) {
    const c = counts.get(key);
    const existing = (await learnerDb.all("SELECT id FROM lexemes WHERE lang = ? AND key = ?", [lang, key]))[0];
    let lexemeId;
    if (existing) {
      lexemeId = Number(existing.id);
      await learnerDb.run("UPDATE lexemes SET total_count = total_count + ?, unit_count = unit_count + 1 WHERE id = ?", [c.count, lexemeId]);
    } else {
      await learnerDb.run("INSERT INTO lexemes (lang, key, sample, total_count, unit_count, is_stop) VALUES (?, ?, ?, ?, 1, 0)", [
        lang,
        key,
        key,
        c.count
      ]);
      const row = (await learnerDb.all("SELECT id FROM lexemes WHERE lang = ? AND key = ?", [lang, key]))[0];
      lexemeId = Number(row.id);
    }
    // sample 取该 key 出现最多的原形（仅当比当前更常见时不覆盖——简化为首批原形即可满足展示用途）
    entries.push([lexemeId, c.count]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  await learnerDb.run(
    "INSERT INTO unit_lex (unit_id, lang, lex_json, token_count, lex_version) VALUES (?, ?, ?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET lang = excluded.lang, lex_json = excluded.lex_json, token_count = excluded.token_count, lex_version = excluded.lex_version",
    [String(u.id), lang, JSON.stringify(entries), tokenCount, P.LEX_VERSION]
  );
}

/** 查词事件 → 词项 key（句内重叠规则，§6.7）：与 [offset, offset+len) 有重叠的 token 的 key；退回 lexemeKey(text) */
function lookupKeysForEvent(payload, lang) {
  const text = String(payload.text || "");
  const sentence = String(payload.sentence || "");
  const offset = Math.max(0, Math.floor(Number(payload.offset) || 0));
  if (sentence && text) {
    const tokens = lmLex.tokenize(sentence, lang);
    const hitKeys = new Set();
    for (const t of tokens) {
      if (t.proper) continue;
      if (t.start < offset + text.length && t.end > offset) {
        const key = lmLex.lexemeKey(t.surface, lang);
        if (key) hitKeys.add(key);
      }
    }
    if (hitKeys.size > 0) return [...hitKeys];
  }
  const key = lmLex.lexemeKey(text, lang);
  return key ? [key] : [];
}

// ---------- 第 6 步：落盘 ----------

async function stepSave() {
  await learnerDb.save();
  status.lastRefreshAt = Date.now();
}

// ---------- buildSnapshot（设计稿 §9.2） ----------

async function buildSnapshot() {
  const now = Date.now();
  const settings = learnerSettings();
  const facts = await loadFacts({ readingEventsAfter: now - 28 * DAY });
  const tracks = dbModule.listLearnerTracks();
  const overrides = (facts.overrides || []).map((o) => ({ trackId: String(o.trackId), libraryItemId: String(o.libraryItemId), member: Number(o.member) }));

  // 材料语言 / PDF 页文本兜底
  const pdfPagesOf = await preloadPdfPages();
  const materialLangCache = new Map();
  const langOfMaterial = async (mat) => {
    if (!materialLangCache.has(mat.id)) {
      materialLangCache.set(mat.id, materialLangOf(mat, facts, pdfPagesOf));
    }
    return materialLangCache.get(mat.id);
  };

  // 单元派生数据
  const unitRows = await learnerDb.all("SELECT * FROM content_units ORDER BY library_item_id ASC, ord ASC");
  const unitProgress = new Map(
    (await learnerDb.all("SELECT unit_id AS unitId, passes_json AS passesJson, last_pass_at AS lastPassAt FROM unit_progress")).map((r) => [
      String(r.unitId),
      { passes: parseJsonSafe(r.passesJson, []), lastPassAt: r.lastPassAt ? Number(r.lastPassAt) : null }
    ])
  );
  const linkRows = await learnerDb.all("SELECT unit_id AS unitId, kp_id AS kpId, weight FROM unit_kp_links");
  const linksByUnit = new Map();
  const linksByKp = new Map();
  for (const l of linkRows) {
    const uid = String(l.unitId);
    const kid = String(l.kpId);
    if (!linksByUnit.has(uid)) linksByUnit.set(uid, new Map());
    const m = linksByUnit.get(uid);
    m.set(kid, Math.max(m.get(kid) || 0, Number(l.weight) || 0));
    if (!linksByKp.has(kid)) linksByKp.set(kid, new Map());
    const km = linksByKp.get(kid);
    km.set(uid, Math.max(km.get(uid) || 0, Number(l.weight) || 0));
  }
  const mdLenByItem = new Map((facts.documents || []).map((d) => [String(d.libraryItemId), Number(d.markdownLen) || 0]));
  const units = [];
  for (const u of unitRows) {
    const prog = unitProgress.get(String(u.id)) || { passes: [], lastPassAt: null };
    const linkMap = linksByUnit.get(String(u.id)) || new Map();
    const cached = lexUnitCache.get(String(u.id)) || {};
    const itemId = String(u.library_item_id);
    let lang = cached.lang;
    if (!lang) {
      const mat = (facts.materials || []).find((m) => String(m.id) === itemId);
      lang = mat ? await langOfMaterial(mat) : "";
    }
    units.push({
      id: String(u.id),
      libraryItemId: itemId,
      documentId: String(u.document_id),
      ord: Number(u.ord) || 0,
      title: String(u.title || ""),
      headText: String(u.head_text || ""),
      plainLen: Number(u.plain_len) || 0,
      isExercise: Number(u.is_exercise) || 0,
      mdFrom: u.md_from == null ? null : Number(u.md_from),
      mdTo: u.md_to == null ? null : Number(u.md_to),
      pageFrom: u.page_from == null ? null : Number(u.page_from),
      pageTo: u.page_to == null ? null : Number(u.page_to),
      docLen: mdLenByItem.get(itemId) || 0,
      passes: prog.passes,
      kpLinks: [...linkMap.keys()].sort().map((kpId) => ({ kpId, weight: linkMap.get(kpId) })),
      coverage: cached.coverage,
      learningCount: cached.learningCount,
      easeFit: cached.easeFit,
      lang
    });
  }

  // 材料（dominantUdc / lexicalUdcCounts / lastPassAt）
  const lexicalUdcByItem = new Map();
  const kpById = new Map((facts.kps || []).map((k) => [String(k.id), k]));
  const unitById = new Map(unitRows.map((r) => [String(r.id), r]));
  const lexicalPairs = new Set(
    linkRows.filter((l) => l.source === "lexical").map((l) => `${String(l.unitId)}:${String(l.kpId)}`)
  );
  for (const [kid, unitMap] of linksByKp) {
    const kp = kpById.get(kid);
    if (!kp || !kp.domainId) continue;
    for (const uid of unitMap.keys()) {
      if (!lexicalPairs.has(`${uid}:${kid}`)) continue; // 只有 lexical 来源的链接才计入 lexical 信号（设计稿 §6.9）
      const unit = unitById.get(uid);
      if (!unit) continue;
      const item = String(unit.library_item_id);
      if (!lexicalUdcByItem.has(item)) lexicalUdcByItem.set(item, {});
      const counts = lexicalUdcByItem.get(item);
      counts[String(kp.domainId)] = (counts[String(kp.domainId)] || 0) + 1;
    }
  }
  const unitsByItemAgg = new Map();
  for (const u of units) {
    if (!unitsByItemAgg.has(u.libraryItemId)) unitsByItemAgg.set(u.libraryItemId, []);
    unitsByItemAgg.get(u.libraryItemId).push(u);
  }
  const materials = [];
  for (const mat of facts.materials || []) {
    const itemId = String(mat.id);
    let lastPassAt = null;
    for (const u of unitsByItemAgg.get(itemId) || []) if (u.passes.length) lastPassAt = Math.max(lastPassAt || 0, Math.max(...u.passes));
    materials.push({
      id: itemId,
      title: String(mat.title || ""),
      lang: await langOfMaterial(mat),
      priority: Number(mat.priority) || 50,
      sourceType: String(mat.sourceType || ""),
      dominantUdc: dominantUdcOf(facts, itemId),
      lexicalUdcCounts: lexicalUdcByItem.get(itemId) || {},
      lastPassAt: lastPassAt || null
    });
  }

  // KP 视图
  const cardKp = dbModule.resolveCardKpMap();
  const kpStates = new Map(
    (await learnerDb.all("SELECT * FROM kp_states")).map((r) => [String(r.kp_id), r])
  );
  const docByDocId = new Map((facts.documents || []).map((d) => [String(d.id), d]));
  const relationsByKp = new Map();
  for (const r of facts.relations || []) {
    for (const side of [String(r.fromId), String(r.toId)]) {
      if (!relationsByKp.has(side)) relationsByKp.set(side, []);
    }
    relationsByKp.get(String(r.fromId)).push({ otherId: String(r.toId), type: String(r.type) });
    relationsByKp.get(String(r.toId)).push({ otherId: String(r.fromId), type: String(r.type) });
  }
  const reviewsByCard = new Map();
  for (const r of facts.reviewLogs || []) {
    const cid = String(r.cardId);
    if (!reviewsByCard.has(cid)) reviewsByCard.set(cid, []);
    reviewsByCard.get(cid).push(r);
  }
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const kps = [];
  for (const kp of facts.kps || []) {
    const kpId = String(kp.id);
    if (kp.mergedInto) continue;
    const st = kpStates.get(kpId);
    const cards = (facts.cards || []).filter((c) => cardKp.get(String(c.id)) === kpId);
    const cardMaterialIds = [...new Set(cards.map((c) => {
      const ref = parseContextRef(c.contextRefJson);
      const documentId = ref && ref.documentId ? String(ref.documentId) : null;
      const doc = documentId ? docByDocId.get(documentId) : null;
      return doc ? String(doc.libraryItemId) : "";
    }).filter(Boolean))].sort();
    let lastReviewAt = null;
    let dueToday = false;
    let firstSourceCard = null;
    let hasApplicationCard = false;
    let hasAICard = false;
    for (const c of cards) {
      for (const r of reviewsByCard.get(String(c.id)) || []) lastReviewAt = Math.max(lastReviewAt || 0, Number(r.reviewedAt) || 0);
      const fsrs = parseJsonSafe(c.fsrsJson, null) || {};
      if (fsrs.due && Number(fsrs.due) <= endOfToday.getTime()) dueToday = true;
      const ref = parseContextRef(c.contextRefJson);
      if (!firstSourceCard && ref && (ref.anchorText || ref.anchorRatio != null || ref.pageIndex != null || ref.cfi)) {
        firstSourceCard = {
          documentId: ref.documentId ? String(ref.documentId) : null,
          anchor: {
            ...(ref.anchorText ? { anchorText: String(ref.anchorText) } : {}),
            ...(ref.anchorRatio != null ? { anchorRatio: Number(ref.anchorRatio) } : {}),
            ...(ref.pageIndex != null ? { pageIndex: Number(ref.pageIndex) } : {}),
            ...(ref.cfi ? { cfi: String(ref.cfi) } : {})
          }
        };
      }
      if (String(c.cardType) === "application") hasApplicationCard = true;
      if (String(c.generatedBy || "manual") !== "manual") hasAICard = true;
    }
    kps.push({
      id: kpId,
      label: String(kp.label || ""),
      domainId: kp.domainId ? String(kp.domainId) : null,
      level: st ? Number(st.level) || 0 : 0,
      score: st ? Number(st.score) || 0 : 0,
      fading: st ? Number(st.fading) === 1 : false,
      metrics: st ? parseJsonSafe(st.metrics_json, {}) : {},
      prereqIds: (facts.relations || [])
        .filter((r) => String(r.type) === "prerequisite" && String(r.toId) === kpId)
        .map((r) => String(r.fromId))
        .sort(),
      relations: relationsByKp.get(kpId) || [],
      cardMaterialIds,
      dueToday,
      lastReviewAt: lastReviewAt || null,
      firstSourceCard,
      hasApplicationCard,
      hasAICard
    });
  }

  // 摘录视图（全量未删；K3 到期口径在 lmRecommend 套用）
  const extractKpIds = computeExtractKpIds(facts);
  const extractsWithCard = new Set();
  for (const c of facts.cards || []) {
    const ref = parseContextRef(c.contextRefJson);
    if (ref && ref.extractId) extractsWithCard.add(String(ref.extractId));
  }
  const extracts = (facts.extracts || []).map((e) => {
    const ref = parseContextRef(e.contextRefJson) || {};
    return {
      id: String(e.id),
      libraryItemId: String(e.libraryItemId),
      documentId: String(e.documentId),
      status: String(e.status || "open"),
      priority: Number(e.priority) || 0,
      topicNextAt: Number(e.topicNextAt) || 0,
      processCount: Number(e.processCount) || 0,
      hasCard: extractsWithCard.has(String(e.id)),
      snippet: String(e.contentMarkdown || "").slice(0, 60),
      anchor: {
        ...(ref.anchorText ? { anchorText: String(ref.anchorText) } : {}),
        ...(ref.anchorRatio != null ? { anchorRatio: Number(ref.anchorRatio) } : {}),
        ...(ref.pageIndex != null ? { pageIndex: Number(ref.pageIndex) } : {}),
        ...(ref.cfi ? { cfi: String(ref.cfi) } : {})
      },
      kpIds: extractKpIds.get(String(e.id)) || []
    };
  });

  // lexStats（refresh 缓存优先，缺失时从 learner.db 兜底重算）
  const lexStats = lexStatsFinal.size > 0 ? buildLexStatsFromCache() : await buildLexStatsFromDb(facts);

  // 轨道活跃度（近 28 天每日 a_d；设计稿 §6.9）
  const activity = computeActivity(facts, materials, tracks, cardKp, docByDocId);

  // 反馈（近 90 天）
  const feedback = (facts.recFeedback || [])
    .filter((f) => now - (Number(f.ts) || 0) <= P.REC.FEEDBACK_WINDOW_DAYS * DAY)
    .map((f) => ({ itemKey: String(f.itemKey), kind: String(f.kind || ""), libraryItemId: f.libraryItemId ? String(f.libraryItemId) : undefined, action: String(f.action || ""), ts: Number(f.ts) || 0 }));

  // 事件（近 90 天）
  const events = (facts.learningEvents || [])
    .filter((e) => now - (Number(e.ts) || 0) <= P.REC.FEEDBACK_WINDOW_DAYS * DAY)
    .map((e) => ({ kind: String(e.kind || ""), ts: Number(e.ts) || 0, kpId: e.kp_id ? String(e.kp_id) : null, unitId: e.unit_id ? String(e.unit_id) : null, lang: String(e.lang || ""), payload: parseJsonSafe(e.payloadJson, {}) }));

  // 提议轨道
  const cardUdcCounts = {};
  for (const card of facts.cards || []) {
    let dom = [];
    try {
      dom = card.domain ? JSON.parse(card.domain) : [];
    } catch {
      dom = [];
    }
    if (Array.isArray(dom) && dom[0]) cardUdcCounts[String(dom[0])] = (cardUdcCounts[String(dom[0])] || 0) + 1;
  }
  const udcLabels = {};
  for (const l of UDC_LEAVES) udcLabels[l.code] = l.label;
  const proposals = lmRecommend.proposeTracks({
    materials: materials.map((m) => ({ id: m.id, lang: m.lang, dominantUdc: m.dominantUdc, lexicalUdcCounts: m.lexicalUdcCounts })),
    cardUdcCounts,
    nativeLangs: settings.effectiveNativeLangs,
    tracks,
    uiLocale: settings.locale,
    udcLabels
  });

  return {
    now,
    settings: { nativeLangs: settings.effectiveNativeLangs, recCount: settings.recCount, locale: settings.locale },
    tracks,
    proposals,
    overrides,
    materials,
    units,
    kps,
    extracts,
    lexStats,
    activity,
    feedback,
    lastRun: facts.latestRecRun,
    events,
    cardUdcCounts,
    extractOpTimes: facts.extractOpTimes || {},
    newCards: (facts.cards || [])
      .filter((c) => now - (Number(c.createdAt) || 0) <= P.REC.FEEDBACK_WINDOW_DAYS * DAY)
      .map((c) => {
        const ref = parseContextRef(c.contextRefJson) || {};
        return {
          extractId: ref.extractId ? String(ref.extractId) : null,
          kpId: cardKp.get(String(c.id)) || null,
          createdAt: Number(c.createdAt) || 0,
          isVocab: Boolean(c.dictJson)
        };
      }),
    recentRunKeys: facts.recentRunKeys || [],
    udcLabels
  };
}

function dominantUdcOf(facts, itemId) {
  const doc = (facts.documents || []).find((d) => String(d.libraryItemId) === String(itemId));
  if (!doc) return null;
  const counts = new Map();
  for (const card of facts.cards || []) {
    const ref = parseContextRef(card.contextRefJson);
    const documentId = ref && ref.documentId ? String(ref.documentId) : null;
    if (documentId !== String(doc.id)) continue;
    let dom = [];
    try {
      dom = card.domain ? JSON.parse(card.domain) : [];
    } catch {
      dom = [];
    }
    const leaf = Array.isArray(dom) && dom[0] ? String(dom[0]) : null;
    if (!leaf) continue;
    counts.set(leaf, (counts.get(leaf) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const leaf of [...counts.keys()].sort()) {
    if (counts.get(leaf) > bestN) {
      best = leaf;
      bestN = counts.get(leaf);
    }
  }
  return bestN >= 3 ? best : null; // ≥ 3 张卡才作数（设计稿 §6.9）
}

function buildLexStatsFromCache() {
  // refresh 的 lex 步骤已算好终值；缓存为空（如刚重启未刷新）时由调用方走 buildLexStatsFromDb
  const out = {};
  for (const [lang, stats] of lexStatsFinal) out[lang] = stats;
  return out;
}

async function buildLexStatsFromDb(facts) {
  // 兜底：进程重启后缓存为空时，从 learner.db 重建 lexStats（mineCount 读 lm_meta 缓存值）
  const out = {};
  const lexemes = await learnerDb.all("SELECT * FROM lexemes ORDER BY id ASC");
  const states = new Map((await learnerDb.all("SELECT * FROM lexeme_states")).map((r) => [Number(r.lexeme_id), r]));
  const byLang = new Map();
  for (const lex of lexemes) {
    const lang = String(lex.lang);
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(lex);
  }
  const freqStopByLang = new Map();
  for (const [lang, list] of byLang) {
    if (!lmLex.HAS_STOPWORDS(lang)) {
      const top = new Set(
        list
          .slice()
          .sort((a, b) => Number(b.total_count) - Number(a.total_count) || Number(a.id) - Number(b.id))
          .slice(0, P.FREQ_STOP_TOP)
          .map((l) => String(l.key))
      );
      freqStopByLang.set(lang, top);
    }
  }
  const isStop = (lang, key) => {
    const table = lmLex.STOPWORDS[lang];
    if (table && table.has(String(key))) return true;
    return (freqStopByLang.get(lang) || new Set()).has(String(key));
  };
  for (const [lang, list] of byLang) {
    const nonStop = list.filter((l) => !isStop(lang, String(l.key)));
    const learning = [];
    let knownCount = 0;
    for (const l of nonStop) {
      const st = states.get(Number(l.id));
      if (!st) continue;
      if (st.state === "known" || st.state === "familiar") knownCount += 1;
      if (st.state === "learning") learning.push(l);
    }
    learning.sort(
      (a, b) =>
        (Number((states.get(Number(b.id)) || {}).last_lookup_at) || 0) - (Number((states.get(Number(a.id)) || {}).last_lookup_at) || 0) ||
        Number(b.total_count) - Number(a.total_count) ||
        String(a.key).localeCompare(String(b.key))
    );
    out[lang] = {
      knownCount,
      totalLexemes: list.length,
      hasPlacement: (facts.learningEvents || []).some((e) => e.kind === "placement" && lmLex.baseLang(String(e.lang || "")) === lang),
      learningTop: learning.slice(0, 50).map((l) => ({
        key: String(l.key),
        sample: String(l.sample || l.key),
        lastLookupAt: Number((states.get(Number(l.id)) || {}).last_lookup_at) || null,
        totalCount: Number(l.total_count) || 0,
        unitCount: Number(l.unit_count) || 0
      })),
      mineCount: Number(await learnerDb.getMeta(`mine_count:${lang}`)) || 0
    };
  }
  return out;
}

/** 轨道活跃度（设计稿 §6.9）：a_d = 复习/20 + 阅读字数/5000 + 新建摘录 + 新建卡片/2 */
function computeActivity(facts, materials, tracks, cardKp, docByDocId) {
  const now = Date.now();
  const window = P.TRACK.WINDOW_DAYS * DAY;
  // 材料 → 轨道（复用 resolveMembership 的口径）
  const overrides = new Map((facts.overrides || []).map((o) => [`${String(o.trackId)}:${String(o.libraryItemId)}`, Number(o.member)]));
  const materialTrack = new Map();
  for (const m of materials) {
    for (const t of tracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (t.status !== "active") continue;
      if (lmRecommend.resolveMembership(t, m, overrides)) {
        materialTrack.set(m.id, t.id);
        break;
      }
    }
  }
  const kpTrack = new Map();
  for (const k of facts.kps || []) {
    if (!k.domainId) continue;
    for (const t of tracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (t.mode !== "language" && (t.udcCodes || []).includes(String(k.domainId))) {
        kpTrack.set(String(k.id), t.id);
        break;
      }
    }
  }
  const activity = {};
  const bump = (trackId, dayIdx, key, add) => {
    if (!trackId) return;
    if (!activity[trackId]) activity[trackId] = Array.from({ length: P.TRACK.WINDOW_DAYS }, () => ({ rev: 0, chars: 0, extracts: 0, cards: 0 }));
    activity[trackId][dayIdx][key] += add;
  };
  const dayIdxOf = (ts) => {
    const d = Math.floor((now - ts) / DAY);
    return d >= 0 && d < P.TRACK.WINDOW_DAYS ? d : -1;
  };
  // 复习次数（卡片所属材料归轨道；无材料按 KP；设计稿 §6.9）
  const cardById = new Map((facts.cards || []).map((c) => [String(c.id), c]));
  for (const r of facts.reviewLogs || []) {
    const idx = dayIdxOf(Number(r.reviewedAt) || 0);
    if (idx < 0) continue;
    const kpId = cardKp.get(String(r.cardId));
    // 卡片材料：借 cardMaterial（由 contextRef 反查）
    const card = cardById.get(String(r.cardId));
    const ref = card ? parseContextRef(card.contextRefJson) : null;
    const documentId = ref && ref.documentId ? String(ref.documentId) : null;
    const doc = documentId ? docByDocId.get(documentId) : null;
    const trackId = (doc && materialTrack.get(String(doc.libraryItemId))) || (kpId && kpTrack.get(kpId)) || null;
    bump(trackId, idx, "rev", 1);
  }
  // 阅读字数（相邻正增量 ≤ JUMP_CHARS；与 stats 同口径）
  const eventsByItem = new Map();
  for (const e of facts.readingEvents || []) {
    const item = String(e.itemId);
    if (!eventsByItem.has(item)) eventsByItem.set(item, []);
    eventsByItem.get(item).push({ pos: Number(e.charPos) || 0, ts: Number(e.createdAt) || 0 });
  }
  for (const [item, evs] of eventsByItem) {
    const trackId = materialTrack.get(item);
    if (!trackId) continue;
    evs.sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < evs.length; i++) {
      const step = evs[i].pos - evs[i - 1].pos;
      if (step <= 0 || step > P.JUMP_CHARS) continue;
      const idx = dayIdxOf(evs[i].ts);
      if (idx >= 0) bump(trackId, idx, "chars", step);
    }
  }
  // 新建摘录 / 新建卡片
  for (const e of facts.extracts || []) {
    const idx = dayIdxOf(Number(e.createdAt) || 0);
    if (idx < 0) continue;
    bump(materialTrack.get(String(e.libraryItemId)), idx, "extracts", 1);
  }
  for (const c of facts.cards || []) {
    const idx = dayIdxOf(Number(c.createdAt) || 0);
    if (idx < 0) continue;
    const ref = parseContextRef(c.contextRefJson);
    const documentId = ref && ref.documentId ? String(ref.documentId) : null;
    const doc = documentId ? docByDocId.get(documentId) : null;
    const kpId = cardKp.get(String(c.id));
    bump((doc && materialTrack.get(String(doc.libraryItemId))) || (kpId && kpTrack.get(kpId)) || null, idx, "cards", 1);
  }
  // 汇总为 a_d 数组（下标 0 = 今天）
  const out = {};
  for (const trackId of Object.keys(activity).sort()) {
    out[trackId] = activity[trackId].map((d) => d.rev / 20 + d.chars / 5000 + d.extracts + d.cards / 2);
  }
  return out;
}

// ---------- 面板辅助查询（learner:status 等使用；L2-5 起接线） ----------

async function statusForIpc() {
  return getStatus();
}

// ---------- learner:recommend 全流程（设计稿 §7.1） ----------

async function recommendFlow({ force = false } = {}) {
  const st = getStatus();
  // 首次索引 / 已在刷新：不等待，立即返回并在后台启动 refresh（面板每 1 秒轮询 status）
  if (st.indexing || st.lastRefreshAt === 0) {
    if (!st.indexing) void refresh({ force: true });
    return { ok: true, indexing: true, items: [], runId: null, generatedAt: null, candidateCount: 0, tracks: [], usingProposals: false };
  }
  if (force || Date.now() - st.lastRefreshAt > P.REC.STALE_MS) {
    const r = await refresh({ force });
    if (r && r.ok === false && status.lastRefreshAt === 0) {
      return { ok: false, indexing: false, items: [], runId: null, generatedAt: null, candidateCount: 0, tracks: [], usingProposals: false, error: r.error };
    }
  }
  const snapshot = await buildSnapshot();
  const result = lmRecommend.recommend(snapshot);
  // 自动判定完成 → 写 rec_feedback（action=done, auto=1，由调用方=本函数落库）
  const lastRunId = snapshot.lastRun ? snapshot.lastRun.id : null;
  for (const d of result.autoDone || []) {
    try {
      dbModule.addRecFeedback({ recRunId: lastRunId, itemKey: d.itemKey, kind: d.kind, libraryItemId: d.libraryItemId, action: "done", auto: true });
    } catch {
      /* 反馈写失败不阻塞推荐 */
    }
  }
  // 指纹未变则 saveRecRun 内部跳过写入，runId 取最近一条
  const saved = dbModule.saveRecRun(result.items, result.candidateCount, P.LM_VERSION);
  const tracks = buildTrackSummaries(snapshot, result.weights || {}, result.usingProposals, result.proposals || []);
  return {
    ok: true,
    indexing: false,
    runId: saved.id,
    generatedAt: Date.now(),
    items: result.items,
    candidateCount: result.candidateCount,
    tracks,
    usingProposals: result.usingProposals,
    byKind: result.byKind,
    error: status.lastError || undefined
  };
}

/** TrackSummary（设计稿 §11.1 辅助类型）：提议轨道转正时 id = "proposal:" + key */
function buildTrackSummaries(snapshot, weights, usingProposals, proposals) {
  const effTracks = usingProposals
    ? proposals.map((p) => ({
        id: `proposal:${p.key}`,
        label: p.label,
        mode: p.mode,
        lang: p.lang,
        udcCodes: p.udcCodes,
        status: "active",
        pinned: false,
        priority: 3,
        source: "proposal",
        isProposal: true
      }))
    : snapshot.tracks.map((t) => ({ ...t, isProposal: false }));
  const materialCount = new Map();
  const trackMaterials = new Map();
  for (const t of effTracks) trackMaterials.set(t.id, new Set());
  const overrides = new Map((snapshot.overrides || []).map((o) => [`${o.trackId}:${o.libraryItemId}`, o.member]));
  for (const m of snapshot.materials || []) {
    for (const t of effTracks.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (lmRecommend.resolveMembership(t, m, overrides)) {
        materialCount.set(t.id, (materialCount.get(t.id) || 0) + 1);
        trackMaterials.get(t.id).add(String(m.id));
        break;
      }
    }
  }
  const levelCountsByTrack = new Map();
  for (const t of effTracks) levelCountsByTrack.set(t.id, [0, 0, 0, 0, 0]);
  for (const kp of snapshot.kps || []) {
    for (const t of effTracks) {
      if (t.mode === "language") continue;
      const belongs =
        (kp.domainId && (t.udcCodes || []).includes(kp.domainId)) ||
        (kp.cardMaterialIds || []).some((mid) => trackMaterials.get(t.id).has(String(mid)));
      if (belongs) {
        const arr = levelCountsByTrack.get(t.id);
        arr[clamp01Level(kp.level)] += 1;
        break;
      }
    }
  }
  return effTracks.map((t) => ({
    ...t,
    weight: Number(weights[t.id]) || 0,
    materialCount: materialCount.get(t.id) || 0,
    kpCount: levelCountsByTrack.get(t.id).reduce((s, n) => s + n, 0),
    levelCounts: levelCountsByTrack.get(t.id)
  }));
}

function clamp01Level(level) {
  return Math.min(4, Math.max(0, Math.round(Number(level) || 0)));
}

// ---------- learner:kpLevels（设计稿 §11.7） ----------

async function kpLevelsFor({ kpIds } = {}) {
  const rows = await learnerDb.all("SELECT * FROM kp_states");
  const filter = Array.isArray(kpIds) && kpIds.length > 0 ? new Set(kpIds.map(String)) : null;
  const labels = new Map((dbModule.learnerFacts().kps || []).map((k) => [String(k.id), String(k.label || "")]));
  return rows
    .filter((r) => !filter || filter.has(String(r.kp_id)))
    .map((r) => ({
      kpId: String(r.kp_id),
      level: Number(r.level) || 0,
      label: labels.get(String(r.kp_id)) || String(r.kp_id),
      confidence: String(r.confidence || "low"),
      fading: Number(r.fading) === 1,
      metrics: parseJsonSafe(r.metrics_json, {})
    }));
}

// ---------- learner:unitText（单元文本 + learning 词位置） ----------

async function unitContext(unitId) {
  const unit = (await learnerDb.all("SELECT * FROM content_units WHERE id = ?", [String(unitId)]))[0];
  if (!unit) return null;
  const mdCache = new Map();
  const plain = await unitPlainOf(unit, mdCache);
  const mat = dbModule.learnerFacts().materials.find((m) => String(m.id) === String(unit.library_item_id));
  const anchor =
    unit.page_from != null
      ? { anchorText: String(unit.head_text || ""), pageIndex: Number(unit.page_from) }
      : {
          anchorText: String(unit.head_text || ""),
          anchorRatio: unit.md_from != null && unit.md_to != null && unit.md_to > 0 ? Number(unit.md_to) / Math.max(1, Number(unit.md_to)) : undefined
        };
  return { unit, plain, lang: String(unit.lang || ""), materialTitle: mat ? String(mat.title) : "", documentId: String(unit.document_id), anchor };
}

async function unitTextFor({ unitId } = {}) {
  const ctx = await unitContext(unitId);
  if (!ctx) return null;
  // learning 词位置：unit_lex × lexeme_states → learning lexeme 的 key 集，扫 token 命中
  const row = (await learnerDb.all("SELECT lex_json AS lexJson FROM unit_lex WHERE unit_id = ?", [String(unitId)]))[0];
  const learningSpans = [];
  if (row) {
    const learningIds = new Set(
      parseJsonSafe(row.lexJson, []).map(([id]) => Number(id))
    );
    const lexIds = parseJsonSafe(row.lexJson, []).map(([id]) => Number(id));
    const states = await learnerDb.all(
      `SELECT lexeme_id AS id FROM lexeme_states WHERE state = 'learning' AND lexeme_id IN (${lexIds.map(() => "?").join(",") || "NULL"})`,
      lexIds
    );
    learningIds.clear();
    for (const s of states) learningIds.add(Number(s.id));
    if (learningIds.size > 0) {
      // lexemeId → key
      const idRows = await learnerDb.all(
        `SELECT id, key FROM lexemes WHERE id IN (${lexIds.map(() => "?").join(",") || "NULL"})`,
        lexIds
      );
      const keyById = new Map(idRows.map((r) => [Number(r.id), String(r.key)]));
      const learningKeys = new Set([...learningIds].map((id) => keyById.get(id)).filter(Boolean));
      const tokens = lmLex.tokenize(ctx.plain, ctx.lang);
      for (const t of tokens) {
        if (t.proper) continue;
        const key = lmLex.lexemeKey(t.surface, ctx.lang);
        if (key && learningKeys.has(key)) learningSpans.push([t.start, t.end]);
      }
    }
  }
  return {
    unitId: String(unitId),
    title: String(ctx.unit.title || ""),
    material: ctx.materialTitle,
    text: ctx.plain,
    lang: ctx.lang,
    learningSpans: learningSpans.sort((a, b) => a[0] - b[0]),
    documentId: ctx.documentId,
    anchor: ctx.anchor
  };
}

// ---------- learner:contextReel（设计稿 §8.2 K11 / §11.1） ----------

async function contextReelFor({ lang: langRaw, key } = {}) {
  const lang = lmLex.baseLang(String(langRaw || ""));
  const target = String(key || "");
  if (!lang || !target) return null;
  const lexeme = (await learnerDb.all("SELECT * FROM lexemes WHERE lang = ? AND key = ?", [lang, target]))[0];
  if (!lexeme) return { word: target, sentences: [] };
  // 含该词项的单元：已通读优先（按最近通读降序），再未读
  const unitRows = await learnerDb.all(
    `SELECT u.*, p.passes_json AS passesJson, p.last_pass_at AS lastPassAt
     FROM unit_lex l
     JOIN content_units u ON u.id = l.unit_id
     LEFT JOIN unit_progress p ON p.unit_id = u.id
     WHERE l.lex_json LIKE ?`,
    [`[${Number(lexeme.id)},%`]
  );
  const sortReadFirst = (a, b) => {
    const ra = (parseJsonSafe(a.passesJson, []) || []).length > 0 ? 1 : 0;
    const rb = (parseJsonSafe(b.passesJson, []) || []).length > 0 ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return (Number(b.lastPassAt) || 0) - (Number(a.lastPassAt) || 0) || Number(a.ord) - Number(b.ord);
  };
  unitRows.sort(sortReadFirst);
  const facts = dbModule.learnerFacts();
  const titleByItem = new Map((facts.materials || []).map((m) => [String(m.id), String(m.title || "")]));
  const mdCache = new Map();
  const sentences = [];
  for (const u of unitRows) {
    if (sentences.length >= 5) break;
    const plain = await unitPlainOf(u, mdCache);
    let perUnit = 0;
    for (const sentence of lmText.splitSentences(plain)) {
      if (perUnit >= 2 || sentences.length >= 5) break;
      const tokens = lmLex.tokenize(sentence.text, lang);
      let hit = null;
      for (const t of tokens) {
        if (t.proper) continue;
        if (lmLex.lexemeKey(t.surface, lang) === target) {
          hit = t;
          break;
        }
      }
      if (!hit) continue;
      const item = String(u.library_item_id);
      const unit = u;
      sentences.push({
        text: sentence.text,
        start: hit.start,
        end: hit.end,
        unitId: String(u.id),
        material: titleByItem.get(item) || "",
        documentId: String(u.document_id),
        anchor:
          u.page_from != null
            ? { anchorText: String(u.head_text || ""), pageIndex: Number(u.page_from) }
            : { anchorText: String(u.head_text || ""), anchorRatio: unit.md_from != null && mdLenOf(facts, item) ? Number(u.md_from) / Math.max(1, mdLenOf(facts, item)) : undefined }
      });
      perUnit += 1;
    }
  }
  return { word: String(lexeme.sample || lexeme.key), sentences };
}

function mdLenOf(facts, itemId) {
  const doc = (facts.documents || []).find((d) => String(d.libraryItemId) === String(itemId));
  return Number(doc ? doc.markdownLen : 0) || 0;
}

// ---------- learner:sentenceMine（设计稿 §8.2 K12 / §11.1） ----------

async function sentenceMineFor({ trackId, limit = 10 } = {}) {
  const tracks = dbModule.listLearnerTracks();
  const track = tracks.find((t) => String(t.id) === String(trackId));
  const lang = track && track.mode === "language" ? String(track.lang) : "";
  if (!lang) return { items: [] };
  const cap = Math.min(50, Math.max(1, Number(limit) || 10));
  // 该语言全部 learning/seen 且 unit_count ≥ 2 的目标词
  const lexemes = await learnerDb.all("SELECT * FROM lexemes WHERE lang = ?", [lang]);
  const states = new Map((await learnerDb.all("SELECT * FROM lexeme_states")).map((r) => [Number(r.lexeme_id), r]));
  const candidates = new Map(); // key → {sample}
  for (const lex of lexemes) {
    const st = states.get(Number(lex.id));
    const state = st ? st.state : "unknown";
    if (state !== "learning" && state !== "seen") continue;
    if (Number(lex.unit_count) < 2) continue;
    if (isStopKeyFor(lang, String(lex.key))) continue;
    candidates.set(String(lex.key), String(lex.sample || lex.key));
  }
  // 近 14 天通读过的该语言单元 → 切句 → i+1 判定
  const now = Date.now();
  const items = [];
  const unitRows = await learnerDb.all(
    `SELECT u.*, p.passes_json AS passesJson FROM content_units u
     LEFT JOIN unit_progress p ON p.unit_id = u.id
     WHERE u.lang = ? ORDER BY u.library_item_id ASC, u.ord ASC`,
    [lang]
  );
  const knownStateByKey = new Map();
  for (const lex of lexemes) {
    const st = states.get(Number(lex.id));
    knownStateByKey.set(String(lex.key), st ? st.state : "unknown");
  }
  const isKnownKey = (key) => {
    const st = knownStateByKey.get(String(key));
    return st === "known" || st === "familiar" || isStopKeyFor(lang, String(key));
  };
  const facts = dbModule.learnerFacts();
  const titleByItem = new Map((facts.materials || []).map((m) => [String(m.id), String(m.title || "")]));
  const mdCache = new Map();
  for (const u of unitRows) {
    if (items.length >= cap) break;
    const passes = parseJsonSafe(u.passesJson, []);
    const lastPass = passes.length ? Math.max(...passes) : 0;
    if (!lastPass || now - lastPass > 14 * DAY) continue;
    const plain = await unitPlainOf(u, mdCache);
    for (const sentence of lmText.splitSentences(plain)) {
      if (items.length >= cap) break;
      const tokens = lmLex.tokenize(sentence.text, lang);
      const targetKey = lmLex.isIPlusOneSentence(tokens, isKnownKey, lang);
      if (!targetKey) continue;
      let hit = null;
      for (const t of tokens) {
        if (t.proper) continue;
        if (lmLex.lexemeKey(t.surface, lang) === targetKey) {
          hit = t;
          break;
        }
      }
      if (!hit) continue;
      const item = String(u.library_item_id);
      items.push({
        sentence: sentence.text,
        target: { key: targetKey, sample: candidates.get(targetKey) || targetKey, start: hit.start, end: hit.end },
        unitId: String(u.id),
        material: titleByItem.get(item) || "",
        documentId: String(u.document_id),
        anchor: {
          anchorText: sentence.text.replace(/\s+/g, " ").trim().slice(0, 40),
          ...(u.page_from != null ? { pageIndex: Number(u.page_from) } : u.md_from != null && mdLenOf(facts, item) ? { anchorRatio: Number(u.md_from) / Math.max(1, mdLenOf(facts, item)) } : {})
        }
      });
    }
  }
  return { items };
}

function isStopKeyFor(lang, key) {
  const table = lmLex.STOPWORDS[lmLex.baseLang(lang)];
  return Boolean(table && table.has(String(key)));
}

// ---------- learner:placementSample（设计稿 §11.4） ----------

const PLACEMENT_BANDS = [
  [1, 250],
  [251, 500],
  [501, 1000],
  [1001, 2000],
  [2001, 4000],
  [4001, 8000]
];

async function placementSampleFor({ lang: langRaw } = {}) {
  const lang = lmLex.baseLang(String(langRaw || ""));
  if (!lang) return { bands: [] };
  const lexemes = await learnerDb.all("SELECT * FROM lexemes WHERE lang = ? ORDER BY total_count DESC, id ASC", [lang]);
  // 非停用词项排名（1 起；表外语言按频率替代排除前 50）
  const nonStop = lexemes.filter((l) => !isStopKeyFor(lang, String(l.key)));
  const bands = [];
  for (const [from, to] of PLACEMENT_BANDS) {
    if (from > nonStop.length) break; // 超出词项总数的频段丢弃
    const candidates = nonStop.slice(from - 1, Math.min(to, nonStop.length));
    if (candidates.length === 0) continue;
    const seed = require("node:crypto").createHash("sha1").update(lang + String(from)).digest("hex");
    const picked = candidates
      .map((l) => ({ l, h: require("node:crypto").createHash("sha1").update(seed + String(l.key)).digest("hex") }))
      .sort((a, b) => a.h.localeCompare(b.h) || String(a.l.key).localeCompare(String(b.l.key)))
      .slice(0, 10)
      .map(({ l }) => ({ key: String(l.key), sample: String(l.sample || l.key) }));
    bands.push({ from, to, words: picked });
  }
  return { bands };
}

// ---------- learner:lexStats（设计稿 §11.1） ----------

async function lexStatsFor({ lang: langRaw } = {}) {
  const lang = lmLex.baseLang(String(langRaw || ""));
  if (!lang) return { knownCount: 0, familiarCount: 0, learningCount: 0, totalLexemes: 0, recentCoverage: null };
  const lexemes = await learnerDb.all("SELECT * FROM lexemes WHERE lang = ?", [lang]);
  const states = new Map((await learnerDb.all("SELECT * FROM lexeme_states")).map((r) => [Number(r.lexeme_id), r]));
  let knownCount = 0;
  let familiarCount = 0;
  let learningCount = 0;
  for (const lex of lexemes) {
    if (isStopKeyFor(lang, String(lex.key))) continue;
    const st = states.get(Number(lex.id));
    const state = st ? st.state : "unknown";
    if (state === "known") knownCount += 1;
    if (state === "familiar") familiarCount += 1;
    if (state === "learning") learningCount += 1;
  }
  // recentCoverage = 近 5 个通读单元覆盖率平均
  const unitRows = await learnerDb.all(
    `SELECT u.id AS id, p.last_pass_at AS lastPassAt FROM content_units u
     JOIN unit_lex l ON l.unit_id = u.id
     JOIN unit_progress p ON p.unit_id = u.id
     WHERE u.lang = ? ORDER BY p.last_pass_at DESC LIMIT 5`,
    [lang]
  );
  const coverages = [];
  for (const r of unitRows) {
    const cached = lexUnitCache.get(String(r.id));
    if (cached && typeof cached.coverage === "number") coverages.push(cached.coverage);
  }
  const recentCoverage = coverages.length ? coverages.reduce((s, c) => s + c, 0) / coverages.length : null;
  return { knownCount, familiarCount, learningCount, totalLexemes: lexemes.length, recentCoverage };
}

module.exports = {
  refresh,
  buildSnapshot,
  getStatus,
  statusForIpc,
  init,
  learnerEnabled,
  learnerSettings,
  learnerLocale,
  computeExtractKpIds,
  recommendFlow,
  buildTrackSummaries,
  kpLevelsFor,
  unitTextFor,
  contextReelFor,
  sentenceMineFor,
  placementSampleFor,
  lexStatsFor
};
