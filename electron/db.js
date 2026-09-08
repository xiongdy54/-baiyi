// SQLite 仓储层（sql.js WASM 实现，接口与将来 better-sqlite3 原生版一致）
// 文档数据模型：LibraryItem + Document，全部带 userId/updatedAt/syncVersion/isDeleted
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const {
  CARD_GEN_PROMPT,
  CARD_FORMULA_PROMPT,
  CARD_SEQ_PROMPT,
  CARD_ENUM_PROMPT,
  CARD_MNEMONIC_PROMPT,
  CARD_CONTRAST_PROMPT,
  CARD_WORDING_PROMPT,
  CARD_BASIC_PROMPT,
  READER_EXPLAIN_PROMPT,
  LEECH_RESCUE_PROMPT
} = require("./prompts");
const { sanitizeDomain, domainFromPrefix } = require("./udc");

let db = null;
let dbFile = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  cover TEXT,
  progress_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  library_item_id TEXT NOT NULL,
  markdown TEXT NOT NULL,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  toc_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  library_item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS extracts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  context_ref_json TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  topic_next_at INTEGER NOT NULL,
  interval_days REAL NOT NULL DEFAULT 1,
  workflow_state_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_text TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'qa',
  cloze_ords TEXT NOT NULL DEFAULT '[]',
  card_ord INTEGER NOT NULL DEFAULT 0,
  front_markdown TEXT NOT NULL,
  back_markdown TEXT NOT NULL,
  context_prefix TEXT,
  context_ref_json TEXT,
  mnemonic TEXT,
  example TEXT,
  source_ref_json TEXT,
  date_stamp TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  tags_json TEXT NOT NULL DEFAULT '[]',
  knowledge_point_id TEXT,
  occlusion_json TEXT,
  fsrs_json TEXT,
  leech_json TEXT,
  generated_by TEXT NOT NULL DEFAULT 'manual',
  gen_batch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS card_issues (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'lint',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_gen_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_text TEXT NOT NULL,
  context_json TEXT,
  prompt_template_id TEXT,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  duration_ms INTEGER
);
CREATE TABLE IF NOT EXISTS reading_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  char_pos INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_skips (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  skipped_at INTEGER NOT NULL
);
`;

async function initDb() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  dbFile = path.join(app.getPath("userData"), "library.db");
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
  db.run(SCHEMA);
  try {
    db.run("ALTER TABLE library_items ADD COLUMN progress_json TEXT");
  } catch {
    /* 列已存在 */
  }
  // 统计管线 v1：cards.domain（JSON 数组字符串，如 '["51","32"]'，≤2 个、首个为主）
  try {
    db.run("ALTER TABLE cards ADD COLUMN domain TEXT");
  } catch {
    /* 列已存在 */
  }
  // 旧卡回填：按 context_prefix 关键词映射 UDC，匹配不到留 NULL（未分类），只回填一次
  try {
    const backfilled = queryAll("SELECT id, context_prefix FROM cards WHERE domain IS NULL AND is_deleted = 0 AND context_prefix IS NOT NULL");
    for (const row of backfilled) {
      const code = domainFromPrefix(row.context_prefix);
      if (code) db.run("UPDATE cards SET domain = ? WHERE id = ?", [JSON.stringify([code]), row.id]);
    }
  } catch { /* 表尚不存在等场景 */ }
  db.run("INSERT OR IGNORE INTO users (id, name, created_at) VALUES ('local-user', '本地用户', ?)", [
    Date.now()
  ]);
  // 修复历史 NULL fsrs_json 的卡片（一次性迁移，v10.2）
  try {
    db.run(
      "UPDATE cards SET fsrs_json = ? WHERE fsrs_json IS NULL AND is_deleted = 0",
      [JSON.stringify({ state: "new", due: Date.now(), lapses: 0 })]
    );
  } catch { /* 表尚不存在等场景 */ }
  // v12.3：extracts.context_ref_json（跳转原文锚点：anchorText/anchorRatio）
  try {
    db.run("ALTER TABLE extracts ADD COLUMN context_ref_json TEXT");
  } catch {
    /* 列已存在 */
  }
  ensurePromptTemplates();
  persist();
}

function persist() {
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

function listItems() {
  const stmt = db.prepare(`
    SELECT li.id, li.title, li.source_type AS sourceType, li.cover, li.progress_json AS progressJson,
           li.created_at AS createdAt, li.updated_at AS updatedAt, d.markdown
    FROM library_items li
    LEFT JOIN documents d ON d.library_item_id = li.id AND d.is_deleted = 0
    WHERE li.is_deleted = 0
    ORDER BY li.created_at DESC
  `);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function createFromPaste(title, markdown) {
  const cleanTitle = String(title || "").trim() || firstLine(markdown) || "未命名书籍";
  const itemId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO library_items (id, user_id, title, source_type, source_url, cover, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, 'paste', NULL, NULL, ?, ?, 0, 0)`,
    [itemId, cleanTitle, now, now]
  );
  db.run(
    `INSERT INTO documents (id, library_item_id, markdown, blocks_json, toc_json, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, ?, ?, '[]', NULL, ?, ?, 0, 0)`,
    [docId, itemId, String(markdown), now, now]
  );
  persist();
  return { id: itemId, title: cleanTitle };
}

function deleteItem(id) {
  const now = Date.now();
  db.run("UPDATE library_items SET is_deleted = 1, updated_at = ? WHERE id = ?", [now, id]);
  db.run("UPDATE documents SET is_deleted = 1, updated_at = ? WHERE library_item_id = ?", [now, id]);
  persist();
  return true;
}

function addAssetRow(itemId, kind, relPath, hash, now) {
  db.run(
    `INSERT INTO assets (id, library_item_id, kind, path, hash, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [crypto.randomUUID(), itemId, kind, relPath, hash, now, now]
  );
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function createFromEpub(title, markdown, toc, coverDataUrl, epubData, sourceName) {
  const cleanTitle = String(title || "").trim() || "未命名书籍";
  const itemId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const now = Date.now();

  const dir = path.join(app.getPath("userData"), "assets", itemId);
  fs.mkdirSync(dir, { recursive: true });
  let coverRel = null;

  if (coverDataUrl) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(String(coverDataUrl));
    if (m) {
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const buf = Buffer.from(m[2], "base64");
      fs.writeFileSync(path.join(dir, `cover.${ext}`), buf);
      coverRel = `cover.${ext}`;
      addAssetRow(itemId, "image-cover", coverRel, sha256(buf), now);
    }
  }

  if (epubData && epubData.length) {
    const buf = Buffer.from(epubData);
    fs.writeFileSync(path.join(dir, "original.epub"), buf);
    addAssetRow(itemId, "epub-original", "original.epub", sha256(buf), now);
  }

  db.run(
    `INSERT INTO library_items (id, user_id, title, source_type, source_url, cover, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, 'epub', ?, ?, ?, ?, 0, 0)`,
    [itemId, cleanTitle, sourceName || null, coverRel, now, now]
  );
  db.run(
    `INSERT INTO documents (id, library_item_id, markdown, blocks_json, toc_json, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, ?, ?, '[]', ?, ?, ?, 0, 0)`,
    [docId, itemId, String(markdown), JSON.stringify(toc || []), now, now]
  );
  persist();
  return { id: itemId, title: cleanTitle, cover: coverRel };
}

function firstLine(markdown) {
  const line = String(markdown || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.replace(/^#+\s*/, "").slice(0, 30);
}

// ---------- 卡片 / 制卡 / FSRS / Leech（Phase 3 + 13-16，v6/v8） ----------

function normalizeFsrs(json) {
  try {
    const p = json ? JSON.parse(json) : null;
    if (p && typeof p.due !== "undefined") return p;
  } catch { /* fallthrough */ }
  return { state: "new", due: Date.now(), lapses: 0 };
}

function mapCardRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    noteText: r.note_text,
    cardType: r.card_type,
    clozeOrds: JSON.parse(r.cloze_ords || "[]"),
    cardOrd: r.card_ord,
    frontMarkdown: r.front_markdown,
    backMarkdown: r.back_markdown,
    contextPrefix: r.context_prefix,
    contextRef: r.context_ref_json ? JSON.parse(r.context_ref_json) : null,
    mnemonic: r.mnemonic,
    example: r.example,
    sourceRef: r.source_ref_json ? JSON.parse(r.source_ref_json) : null,
    dateStamp: r.date_stamp,
    priority: r.priority,
    tags: JSON.parse(r.tags_json || "[]"),
    domain: r.domain ? JSON.parse(r.domain) : [],
    knowledgePointId: r.knowledge_point_id,
    occlusionJson: r.occlusion_json ? JSON.parse(r.occlusion_json) : null,
    fsrs: normalizeFsrs(r.fsrs_json),
    leech: r.leech_json ? JSON.parse(r.leech_json) : null,
    generatedBy: r.generated_by,
    genBatchId: r.gen_batch_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function insertCard(card) {
  const id = card.id || crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO cards (id, user_id, note_text, card_type, cloze_ords, card_ord, front_markdown, back_markdown,
      context_prefix, context_ref_json, mnemonic, example, source_ref_json, date_stamp, priority, tags_json, domain,
      knowledge_point_id, occlusion_json, fsrs_json, leech_json, generated_by, gen_batch_id,
      created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      card.noteText || "",
      card.cardType || "qa",
      JSON.stringify(card.clozeOrds || []),
      card.cardOrd || 0,
      card.frontMarkdown || "",
      card.backMarkdown || "",
      card.contextPrefix || null,
      card.contextRef ? JSON.stringify(card.contextRef) : null,
      card.mnemonic || null,
      card.example || null,
      card.sourceRef ? JSON.stringify(card.sourceRef) : null,
      card.dateStamp || null,
      Number(card.priority) || 50,
      JSON.stringify(card.tags || []),
      JSON.stringify(sanitizeDomain(card.domain || [])),
      card.knowledgePointId || null,
      card.occlusionJson ? JSON.stringify(card.occlusionJson) : null,
      card.fsrsJson || null,
      card.generatedBy || "manual",
      card.genBatchId || null,
      now,
      now
    ]
  );
  return id;
}

function createCard(card) {
  const id = insertCard({
    ...card,
    // 新卡初始 FSRS 状态：due=now 即立即到期（修复 NULL 导致的调度竞争）
    fsrsJson: card.fsrsJson || JSON.stringify({ state: "new", due: Date.now(), lapses: 0 })
  });
  persist();
  return { id };
}

function updateCard(card) {
  // §11.1（v11）：不传 fsrs/leech 时保留原值，禁止置 NULL（曾导致调度状态被清空重置为 new）
  const prev = getCard(card.id);
  db.run(
    `UPDATE cards SET note_text=?, card_type=?, cloze_ords=?, card_ord=?, front_markdown=?, back_markdown=?,
      context_prefix=?, context_ref_json=?, mnemonic=?, example=?, source_ref_json=?, date_stamp=?, priority=?,
      tags_json=?, domain=?, knowledge_point_id=?, occlusion_json=?, fsrs_json=?, leech_json=?, updated_at=? WHERE id=? AND is_deleted=0`,
    [
      card.noteText || "",
      card.cardType || "qa",
      JSON.stringify(card.clozeOrds || []),
      card.cardOrd || 0,
      card.frontMarkdown || "",
      card.backMarkdown || "",
      card.contextPrefix || null,
      card.contextRef ? JSON.stringify(card.contextRef) : null,
      card.mnemonic || null,
      card.example || null,
      card.sourceRef ? JSON.stringify(card.sourceRef) : null,
      card.dateStamp || null,
      Number(card.priority) || 50,
      JSON.stringify(card.tags || []),
      card.domain !== undefined ? JSON.stringify(sanitizeDomain(card.domain || [])) : (prev ? JSON.stringify(prev.domain || []) : "[]"),
      card.knowledge_point_id || card.knowledgePointId || null,
      card.occlusion_json || (card.occlusionJson ? JSON.stringify(card.occlusionJson) : null),
      card.fsrs_json || (card.fsrs ? JSON.stringify(card.fsrs) : null) || (prev ? JSON.stringify(prev.fsrs) : null),
      card.leech_json || (card.leech ? JSON.stringify(card.leech) : null) || (prev ? JSON.stringify(prev.leech) : null),
      Date.now(),
      card.id
    ]
  );
  persist();
  return true;
}

function getCard(id) {
  const rows = queryAll("SELECT * FROM cards WHERE id = ? AND is_deleted = 0", [id]);
  return mapCardRow(rows[0]);
}

function listDueCards() {
  const now = Date.now();
  const rows = queryAll(
    `SELECT c.*, li.title AS docTitle FROM cards c
     LEFT JOIN documents d ON d.id = json_extract(c.context_ref_json, '$.documentId')
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0
       AND (c.leech_json IS NULL OR json_extract(c.leech_json, '$.suspended') IS NOT 1)
     ORDER BY c.created_at ASC`
  );
  const mapped = rows.map(mapCardRow).map((r) => ({ ...r, docTitle: r.docTitle || (r.sourceRef && r.sourceRef.title) || null }));
  // 新卡（fsrs_json 为 NULL 视为 due=now）+ 到期 + 未挂起；§11.5（v11）due 升序、同 due 按优先级高在前
  return mapped
    .filter((c) => {
      if (c.leech?.suspended) return false;
      const due = c.fsrs?.due ?? now;
      return due <= now;
    })
    .sort((a, b) => {
      const da = a.fsrs?.due ?? now;
      const dbb = b.fsrs?.due ?? now;
      if (da !== dbb) return da - dbb;
      return (b.priority ?? 50) - (a.priority ?? 50);
    });
}

function listAllCards() {
  const rows = queryAll("SELECT * FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC");
  return rows.map(mapCardRow);
}

function deleteCard(id) {
  db.run("UPDATE cards SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), id]);
  db.run("UPDATE card_issues SET status = 'dismissed', resolved_at = ? WHERE card_id = ? AND status = 'open'", [Date.now(), id]);
  persist();
  return true;
}

function saveReview(cardId, fsrsState, rating, durationMs) {
  db.run(
    "INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms) VALUES (?, ?, ?, ?, ?)",
    [crypto.randomUUID(), cardId, rating, Date.now(), durationMs || null]
  );
  db.run("UPDATE cards SET fsrs_json = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(fsrsState),
    Date.now(),
    cardId
  ]);
  persist();
  return true;
}

// v12：优化器读取全部复习日志（按时间升序）
function listAllReviewLogs() {
  const rows = queryAll("SELECT card_id AS cardId, rating, reviewed_at AS reviewedAt FROM review_logs ORDER BY reviewed_at ASC");
  return rows;
}

function saveSkip(cardId) {
  db.run("INSERT INTO review_skips (id, card_id, skipped_at) VALUES (?, ?, ?)", [
    crypto.randomUUID(),
    cardId,
    Date.now()
  ]);
  persist();
  return true;
}

// 阅读进度事件：滚动停止后记一条字符位置；当日阅读字数 = 相邻事件正增量之和
function addReadingEvent(itemId, charPos) {
  db.run("INSERT INTO reading_events (id, item_id, char_pos, created_at) VALUES (?, ?, ?, ?)", [
    crypto.randomUUID(),
    String(itemId),
    Math.max(0, Math.round(Number(charPos) || 0)),
    Date.now()
  ]);
  persist();
  return true;
}

function setCardSuspended(cardId, suspended, reason) {
  const card = getCard(cardId);
  if (!card) return null;
  const leech = card.leech || {};
  leech.suspended = suspended;
  leech.suspendedAt = suspended ? Date.now() : null;
  if (reason) leech.reason = reason;
  db.run("UPDATE cards SET leech_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(leech), Date.now(), cardId]);
  persist();
  return true;
}

// §11.4（v11）：leech 标记字段级更新——只动 leech_json，绝不触碰 fsrs_json
function updateCardLeech(cardId, leechPatch) {
  const card = getCard(cardId);
  if (!card) return null;
  const leech = { ...(card.leech || {}), ...leechPatch };
  db.run("UPDATE cards SET leech_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(leech), Date.now(), cardId]);
  persist();
  return true;
}

function resolveLeech(cardId, resolution, updates) {
  const card = getCard(cardId);
  if (!card) return null;
  const leech = { isLeech: false, resolution, resolvedAt: Date.now() };
  db.run(
    `UPDATE cards SET leech_json=?, front_markdown=COALESCE(?, front_markdown), back_markdown=COALESCE(?, back_markdown),
      mnemonic=COALESCE(?, mnemonic), priority=COALESCE(?, priority), tags_json=?, fsrs_json=?,
      updated_at=? WHERE id=?`,
    [
      JSON.stringify(leech),
      updates?.frontMarkdown || null,
      updates?.backMarkdown || null,
      updates?.mnemonic || null,
      updates?.priority ?? null,
      JSON.stringify(updates?.tags || card.tags || []),
      JSON.stringify({ state: "new", due: Date.now(), lapses: 0 }),
      Date.now(),
      cardId
    ]
  );
  persist();
  return true;
}

function listLeechCards() {
  const rows = queryAll("SELECT * FROM cards WHERE is_deleted = 0");
  return rows.map(mapCardRow).filter((c) => c.leech?.isLeech || c.leech?.suspended);
}

function addCardIssue(issue) {
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO card_issues (id, card_id, rule_id, severity, message, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    [id, issue.cardId, issue.ruleId, issue.severity, issue.message, issue.source || "lint", Date.now()]
  );
  persist();
  return { id };
}

function listCardIssues(cardId) {
  return queryAll("SELECT * FROM card_issues WHERE card_id = ? ORDER BY created_at DESC", [cardId]);
}

function resolveCardIssue(id) {
  db.run("UPDATE card_issues SET status = 'fixed', resolved_at = ? WHERE id = ?", [Date.now(), id]);
  persist();
  return true;
}

function createAIGenBatch(batch) {
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO ai_gen_batches (id, user_id, scope, source_text, context_json, prompt_template_id, result_json, status, created_at) VALUES (?, 'local-user', ?, ?, ?, ?, ?, 'draft', ?)",
    [
      id,
      batch.scope,
      batch.sourceText || "",
      batch.context ? JSON.stringify(batch.context) : null,
      batch.promptTemplateId || null,
      batch.result ? JSON.stringify(batch.result) : null,
      Date.now()
    ]
  );
  persist();
  return { id };
}

function setAIGenBatchStatus(id, status) {
  db.run("UPDATE ai_gen_batches SET status = ? WHERE id = ?", [status, id]);
  persist();
  return true;
}

function ensurePromptTemplates() {
  const now = Date.now();
  // v3 播种：按 scope 查最新 version，低于目标版本才插入新版本（旧版本保留作留痕）
  // v2 变更：CARD_GEN_PROMPT 新增【领域标注】段与 domain 输出字段（UDC 受控清单）
  // v3 变更：R13 新增 hint 禁令——禁用 {{c1::答案::提示}} 第三段，禁止答案拆两半（正面曾泄漏半个答案）
  const TARGET_VERSION = 3;
  const seedV3 = (scope, name, content) => {
    const rows = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = ?", [scope]);
    if (Number(rows[0]?.v || 0) >= TARGET_VERSION) return;
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [crypto.randomUUID(), scope, name, content, TARGET_VERSION, now]
    );
  };
  seedV3("card-generation", "主制卡 v3", CARD_GEN_PROMPT);
  seedV3("card-formula", "公式分解 v3", CARD_FORMULA_PROMPT);
  seedV3("card-seq", "序列/背诵 v3", CARD_SEQ_PROMPT);
  seedV3("card-enum", "枚举拆解 v3", CARD_ENUM_PROMPT);
  seedV3("card-mnemonic", "助记双卡 v3", CARD_MNEMONIC_PROMPT);
  seedV3("card-contrast", "对比卡 v3", CARD_CONTRAST_PROMPT);
  seedV3("card-wording", "措辞优化 v3", CARD_WORDING_PROMPT);
  seedV3("card-basic", "前置知识卡 v3", CARD_BASIC_PROMPT);
  // v1 一次性播种（首次安装）
  const count = queryAll("SELECT COUNT(*) AS n FROM prompt_templates")[0].n;
  if (Number(count) === 0) {
    const seedV1 = (scope, name, content) => {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
        [crypto.randomUUID(), scope, name, content, now]
      );
    };
    db.run("DELETE FROM prompt_templates");
    seedV1("reader-explain", "阅读解释 v1", READER_EXPLAIN_PROMPT);
    seedV1("leech-rescue", "难点诊断 v1", LEECH_RESCUE_PROMPT);
    seedV3("card-generation", "主制卡 v3", CARD_GEN_PROMPT);
    seedV3("card-formula", "公式分解 v3", CARD_FORMULA_PROMPT);
    seedV3("card-seq", "序列/背诵 v3", CARD_SEQ_PROMPT);
    seedV3("card-enum", "枚举拆解 v3", CARD_ENUM_PROMPT);
    seedV3("card-mnemonic", "助记双卡 v3", CARD_MNEMONIC_PROMPT);
    seedV3("card-contrast", "对比卡 v3", CARD_CONTRAST_PROMPT);
    seedV3("card-wording", "措辞优化 v3", CARD_WORDING_PROMPT);
    seedV3("card-basic", "前置知识卡 v3", CARD_BASIC_PROMPT);
  }
}

function getPromptTemplate(scope) {
  const rows = queryAll(
    "SELECT * FROM prompt_templates WHERE scope = ? ORDER BY version DESC LIMIT 1",
    [scope]
  );
  return rows[0] || null;
}

function listPromptTemplates() {
  return queryAll("SELECT id, scope, name, version, is_default, created_at FROM prompt_templates ORDER BY scope, version DESC");
}

// 相似检索：n-gram + 归一化编辑距离（本地，接口的默认实现）
function ngrams(text, n) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, "");
  const out = new Set();
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

function similarity(a, b) {
  const A = ngrams(a, 2);
  const B = ngrams(b, 2);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function findSimilarCards(cardText, k = 3) {
  const all = queryAll("SELECT id, front_markdown, back_markdown FROM cards WHERE is_deleted = 0");
  return all
    .map((c) => ({
      cardId: c.id,
      score: similarity(cardText, c.front_markdown + " " + c.back_markdown),
      front: c.front_markdown
    }))
    .filter((r) => r.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- 阅读器 / 摘录队列（Phase 2） ----------

function getDocument(itemId) {
  const stmt = db.prepare(`
    SELECT li.title, li.progress_json AS progressJson, d.id AS documentId, d.markdown
    FROM library_items li
    JOIN documents d ON d.library_item_id = li.id AND d.is_deleted = 0
    WHERE li.id = ? AND li.is_deleted = 0
  `);
  stmt.bind([itemId]);
  let row = null;
  while (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

// v12.2：复习卡「跳转原文」——documentId 反查书架条目 id
function getItemIdByDocumentId(documentId) {
  const rows = queryAll(
    `SELECT li.id FROM documents d JOIN library_items li ON li.id = d.library_item_id
     WHERE d.id = ? AND d.is_deleted = 0 AND li.is_deleted = 0`,
    [documentId]
  );
  return rows[0]?.id || null;
}

function updateProgress(itemId, progress) {
  db.run("UPDATE library_items SET progress_json = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(progress ?? {}),
    Date.now(),
    itemId
  ]);
  persist();
  return true;
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function createExtract({ parentType, parentId, documentId, contentMarkdown, priority, contextRef }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO extracts (id, user_id, parent_type, parent_id, document_id, content_markdown, context_ref_json, priority, topic_next_at, interval_days, workflow_state_json, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, 0, 0)`,
    [
      id,
      String(parentType),
      String(parentId),
      String(documentId),
      String(contentMarkdown),
      contextRef ? JSON.stringify(contextRef) : null,
      Number(priority) || 50,
      now,
      now,
      now
    ]
  );
  persist();
  return { id };
}

function parentChain(extract) {
  const chain = [];
  let cursor = extract;
  while (cursor && cursor.parent_type === "extract" && chain.length < 5) {
    const rows = queryAll(
      "SELECT id, parent_type, parent_id, content_markdown FROM extracts WHERE id = ? AND is_deleted = 0",
      [cursor.parent_id]
    );
    if (rows.length === 0) break;
    cursor = rows[0];
    chain.unshift(String(cursor.content_markdown).slice(0, 40));
  }
  return chain;
}

function listDueExtracts() {
  const rows = queryAll(
    `SELECT e.id, e.parent_type, e.parent_id, e.document_id, e.content_markdown, e.context_ref_json, e.priority,
            e.topic_next_at AS topicNextAt, e.interval_days AS intervalDays, e.created_at AS createdAt,
            li.title AS docTitle
     FROM extracts e
     JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
     JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
     WHERE e.is_deleted = 0 AND e.topic_next_at <= ?
     ORDER BY e.priority ASC, e.topic_next_at ASC`,
    [Date.now()]
  );
  return rows.map((r) => ({
    ...r,
    contextRef: r.context_ref_json ? JSON.parse(r.context_ref_json) : null,
    depth: r.parent_type === "extract" ? parentChain(r).length + 1 : 1
  }));
}

function getExtract(id) {
  const rows = queryAll(
    `SELECT e.id, e.parent_type AS parentType, e.parent_id AS parentId,
            e.document_id AS documentId, e.content_markdown AS contentMarkdown,
            e.context_ref_json AS contextRefJson, e.priority, e.topic_next_at AS topicNextAt, e.interval_days AS intervalDays,
            e.created_at AS createdAt, li.title AS docTitle
     FROM extracts e
     JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
     JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
     WHERE e.id = ? AND e.is_deleted = 0`,
    [id]
  );
  if (rows.length === 0) return null;
  return { ...rows[0], chain: parentChain(rows[0]) };
}

function postponeExtract(id) {
  const rows = queryAll("SELECT interval_days AS intervalDays FROM extracts WHERE id = ? AND is_deleted = 0", [id]);
  if (rows.length === 0) return null;
  const intervalDays = Math.min((Number(rows[0].intervalDays) || 1) * 1.6, 180);
  const nextAt = Date.now() + Math.round(intervalDays * 86400000);
  db.run("UPDATE extracts SET interval_days = ?, topic_next_at = ?, updated_at = ? WHERE id = ?", [
    intervalDays,
    nextAt,
    Date.now(),
    id
  ]);
  persist();
  return { intervalDays, nextAt };
}

// ---------- 统计聚合（stats:overview，只读，不改任何调度状态） ----------

const { UDC_MAIN, UDC_LEAVES, UDC_OTHER } = require("./udc");

function dayStartMs(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getStatsOverview() {
  const now = Date.now();
  const today0 = dayStartMs(now);
  const today24 = today0 + 24 * 3600_000;

  // ---- KPI：今日到期 / 已完成 / 未完成 ----
  const cards = queryAll(
    `SELECT c.id, c.fsrs_json, c.leech_json, c.domain, c.source_ref_json, c.context_ref_json, c.created_at
     FROM cards c WHERE c.is_deleted = 0`
  );
  const active = cards.filter((c) => {
    try {
      const l = c.leech_json ? JSON.parse(c.leech_json) : null;
      if (l?.suspended) return false;
    } catch { /* 忽略损坏行 */ }
    return true;
  });
  const dueOf = (c) => {
    try {
      const f = JSON.parse(c.fsrs_json || "null");
      return typeof f?.due === "number" ? f.due : now;
    } catch {
      return now;
    }
  };
  const dueToday = active.filter((c) => dueOf(c) <= today24).length;
  const reviewedToday = queryAll("SELECT DISTINCT card_id FROM review_logs WHERE reviewed_at >= ?", [today0]).length;
  const completedToday = active.filter((c) => {
    if (dueOf(c) > today24) return false; // 不再被推送
    // 今日评过至少一次
    return queryAll("SELECT 1 FROM review_logs WHERE card_id = ? AND reviewed_at >= ? LIMIT 1", [c.id, today0]).length > 0;
  }).length;

  // ---- 今日时长 / 连续天数 ----
  const todayDur = queryAll("SELECT SUM(duration_ms) AS s FROM review_logs WHERE reviewed_at >= ?", [today0])[0]?.s || 0;
  const dayKeys = queryAll("SELECT DISTINCT reviewed_at FROM review_logs ORDER BY reviewed_at DESC").map((r) => dayStartMs(r.reviewed_at));
  let streak = 0;
  if (dayKeys.length > 0) {
    const cursor = dayKeys[0] === today0 ? today0 : today0 - 86400_000; // 今天没学则从昨天起算
    const set = new Set(dayKeys);
    let d = cursor;
    while (set.has(d)) {
      streak++;
      d -= 86400_000;
    }
  }

  // ---- 26 周热力（每日次数 + 时长）----
  const heatFrom = today0 - 181 * 86400_000;
  const heatRows = queryAll(
    "SELECT reviewed_at, duration_ms FROM review_logs WHERE reviewed_at >= ?",
    [heatFrom]
  );
  const heat = {};
  for (const r of heatRows) {
    const k = dayStartMs(r.reviewed_at);
    if (!heat[k]) heat[k] = { count: 0, ms: 0 };
    heat[k].count++;
    heat[k].ms += r.duration_ms || 0;
  }
  const heatDays = [];
  for (let d = heatFrom; d <= today0; d += 86400_000) {
    const h = heat[d] || { count: 0, ms: 0 };
    heatDays.push({ date: d, count: h.count, minutes: Math.round(h.ms / 60000) });
  }

  // ---- 领域分布（主领域 = domain[0]；按卡计数）----
  const domainCount = {};
  let unclassified = 0;
  for (const c of cards) {
    let d = [];
    try { d = c.domain ? JSON.parse(c.domain) : []; } catch { /* ignore */ }
    if (!d.length) { unclassified++; continue; }
    domainCount[d[0]] = (domainCount[d[0]] || 0) + 1;
  }
  const mainLabel = {};
  for (const m of UDC_MAIN) mainLabel[m.code] = m.label;
  const leafMain = {};
  for (const l of UDC_LEAVES) leafMain[l.code] = l.main;
  const domainMain = Object.entries(domainCount).map(([code, n]) => ({
    code,
    label: mainLabel[leafMain[code]] || "其他",
    leaf: (UDC_LEAVES.find((l) => l.code === code) || {}).label || code,
    count: n
  })).sort((a, b) => b.count - a.count);
  const domainDetail = Object.entries(domainCount).map(([code, n]) => ({
    code,
    label: (UDC_LEAVES.find((l) => l.code === code) || {}).label || (code === UDC_OTHER ? "其他" : code),
    count: n
  })).sort((a, b) => b.count - a.count);

  // ---- 评分构成（近 30 天）----
  const ratingRows = queryAll("SELECT rating, COUNT(*) AS n FROM review_logs WHERE reviewed_at >= ? GROUP BY rating", [now - 30 * 86400_000]);
  const ratings = ratingRows.map((r) => ({ rating: r.rating, count: r.n }));

  // ---- 答题时长（近 90 天，按主领域分箱 + 全体五数概括）----
  const durRows = queryAll(
    `SELECT rl.duration_ms AS d, c.domain FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id AND c.is_deleted = 0
     WHERE rl.reviewed_at >= ? AND rl.duration_ms IS NOT NULL AND rl.duration_ms > 0`,
    [now - 90 * 86400_000]
  );
  const quantile = (arr, q) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
  };
  const byField = {};
  for (const r of durRows) {
    let dom = [];
    try { dom = r.domain ? JSON.parse(r.domain) : []; } catch { /* ignore */ }
    const key = dom.length ? dom[0] : "none";
    (byField[key] = byField[key] || []).push(r.d);
  }
  const durationByField = Object.entries(byField).map(([code, arr]) => ({
    code,
    label: code === "none" ? "未分类" : ((UDC_LEAVES.find((l) => l.code === code) || {}).label || code),
    count: arr.length,
    min: Math.min(...arr),
    q1: Math.round(quantile(arr, 0.25)),
    median: Math.round(quantile(arr, 0.5)),
    q3: Math.round(quantile(arr, 0.75)),
    max: Math.max(...arr),
    outliers: arr.filter((v) => v > quantile(arr, 0.75) + 1.5 * (quantile(arr, 0.75) - quantile(arr, 0.25))).slice(0, 4)
  })).filter((f) => f.count >= 5).sort((a, b) => a.median - b.median);
  const allDur = durRows.map((r) => r.d);
  // 直方图：5 分钟一箱 × 12 箱（0–60 分钟），前端按小时轴展示
  const durationHist = {};
  for (const v of allDur) {
    const bin = Math.min(11, Math.floor(v / 300_000));
    durationHist[bin] = (durationHist[bin] || 0) + 1;
  }
  const durationBins = Array.from({ length: 12 }, (_, i) => durationHist[i] || 0);

  // ---- 卡片生命周期漏斗（近 90 天入队样本）----
  const funnelFrom = now - 90 * 86400_000;
  const cohort = cards.filter((c) => c.created_at >= funnelFrom);
  const funnel = { drafts: cohort.length, entered: cohort.length, firstLearned: 0, reviewing: 0, consolidated: 0 };
  for (const c of cohort) {
    try {
      const f = JSON.parse(c.fsrs_json || "{}");
      if (f.state === "review" || f.state === "relearning") funnel.firstLearned++;
      if (f.state === "review" && (f.stability ?? 0) > 21) { funnel.reviewing++; funnel.consolidated++; }
      else if (f.state === "review") funnel.reviewing++;
    } catch { /* ignore */ }
  }

  // ---- 新建卡来源（近 26 周，卡 → 书 × 主领域）----
  const srcFrom = now - 182 * 86400_000;
  const srcRows = queryAll(
    `SELECT c.id, c.domain, c.source_ref_json, c.context_ref_json, li.title AS bookTitle
     FROM cards c
     LEFT JOIN documents d ON d.id = json_extract(c.context_ref_json, '$.documentId')
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0 AND c.created_at >= ?`,
    [srcFrom]
  );
  const sourceCards = srcRows.map((r) => {
    let dom = [];
    try { dom = r.domain ? JSON.parse(r.domain) : []; } catch { /* ignore */ }
    let book = r.bookTitle;
    if (!book) {
      try { book = JSON.parse(r.source_ref_json || "null")?.title || null; } catch { book = null; }
    }
    return { book: book || "未知来源", domain: dom[0] || null };
  });

  // ---- 领域排名（近 6 个月，按月）----
  const rankRows = queryAll(
    `SELECT rl.reviewed_at, c.domain FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id AND c.is_deleted = 0
     WHERE rl.reviewed_at >= ?`,
    [now - 183 * 86400_000]
  );
  const monthMap = {};
  for (const r of rankRows) {
    let dom = [];
    try { dom = r.domain ? JSON.parse(r.domain) : []; } catch { /* ignore */ }
    const key = dom[0] || "none";
    const dt = new Date(r.reviewed_at);
    const mk = `${dt.getFullYear()}-${dt.getMonth() + 1}`;
    (monthMap[mk] = monthMap[mk] || {});
    monthMap[mk][key] = (monthMap[mk][key] || 0) + 1;
  }
  const monthKeys = Object.keys(monthMap).sort().slice(-6);
  const allCodes = new Set();
  for (const mk of monthKeys) for (const code of Object.keys(monthMap[mk])) allCodes.add(code);
  const domainRank = [...allCodes].map((code) => ({
    code,
    label: code === "none" ? "未分类" : ((UDC_LEAVES.find((l) => l.code === code) || {}).label || code),
    ranks: monthKeys.map((mk) => {
      const entries = Object.entries(monthMap[mk]).sort((a, b) => b[1] - a[1]);
      const idx = entries.findIndex(([c]) => c === code);
      return idx < 0 ? entries.length + 1 : idx + 1;
    })
  })).sort((a, b) => a.ranks[a.ranks.length - 1] - b.ranks[b.ranks.length - 1]);

  // ---- 月度队列水位（当月）----
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthNew = cards.filter((c) => c.created_at >= monthStart).length;
  const monthReviews = queryAll("SELECT COUNT(DISTINCT card_id) AS n FROM review_logs WHERE reviewed_at >= ?", [monthStart])[0]?.n || 0;
  const monthSkips = queryAll("SELECT COUNT(DISTINCT card_id) AS n FROM review_skips WHERE skipped_at >= ?", [monthStart])[0]?.n || 0;
  const queueFlow = { carriedOver: Math.max(0, dueToday - monthNew), overdue: 0, newCards: monthNew, completed: monthReviews, skipped: monthSkips, remaining: Math.max(0, dueToday - completedToday) };

  // ---- 阅读字数（近 45 天，相邻正增量之和）----
  const readFrom = now - 45 * 86400_000;
  const readRows = queryAll("SELECT item_id, char_pos, created_at FROM reading_events WHERE created_at >= ? ORDER BY created_at ASC", [readFrom]);
  const readByDay = {};
  const lastPos = {};
  for (const r of readRows) {
    const k = dayStartMs(r.created_at);
    const prev = lastPos[r.item_id] ?? r.char_pos;
    const delta = r.char_pos - prev;
    if (delta > 0) readByDay[k] = (readByDay[k] || 0) + delta;
    lastPos[r.item_id] = r.char_pos;
  }
  const readingDays = [];
  for (let d = readFrom; d <= today0; d += 86400_000) readingDays.push({ date: d, chars: readByDay[d] || 0 });

  // ---- 学习节律（近 90 天：星期×时段网格 + 时刻事件采样）----
  const rhythmRows = queryAll(
    "SELECT reviewed_at, rating FROM review_logs WHERE reviewed_at >= ?",
    [now - 90 * 86400_000]
  );
  const rhythmGrid = Array.from({ length: 7 }, () => Array(13).fill(0));
  const rhythmEvents = [];
  const RHYTHM_SAMPLE_MAX = 60;
  const rhythmStride = Math.max(1, Math.ceil(rhythmRows.length / RHYTHM_SAMPLE_MAX));
  rhythmRows.forEach((r, idx) => {
    const dt = new Date(r.reviewed_at);
    const weekday = (dt.getDay() + 6) % 7;
    const hour = dt.getHours();
    rhythmGrid[weekday][Math.min(12, Math.max(0, hour - 8))]++;
    if (idx % rhythmStride === 0 && rhythmEvents.length < RHYTHM_SAMPLE_MAX) {
      rhythmEvents.push({ hour, again: r.rating === "Again" });
    }
  });

  return {
    kpi: { dueToday, completedToday, pendingToday: Math.max(0, dueToday - completedToday), reviewedToday, streak, minutesToday: Math.round(todayDur / 60000) },
    heatDays,
    domainMain,
    domainDetail,
    unclassified,
    ratings,
    durationByField,
    durationBins,
    funnel,
    sourceCards,
    domainRank,
    queueFlow,
    readingDays,
    rhythmGrid,
    rhythmEvents
  };
}

module.exports = {
  initDb,
  listItems,
  createFromPaste,
  createFromEpub,
  deleteItem,
  getDocument,
  updateProgress,
  createExtract,
  listDueExtracts,
  getExtract,
  postponeExtract,
  createCard,
  updateCard,
  getCard,
  listDueCards,
  listAllCards,
  listAllReviewLogs,
  getItemIdByDocumentId,
  deleteCard,
  saveReview,
  saveSkip,
  addReadingEvent,
  getStatsOverview,
  setCardSuspended,
  updateCardLeech,
  resolveLeech,
  listLeechCards,
  addCardIssue,
  listCardIssues,
  resolveCardIssue,
  createAIGenBatch,
  setAIGenBatchStatus,
  ensurePromptTemplates,
  getPromptTemplate,
  listPromptTemplates,
  findSimilarCards
};
