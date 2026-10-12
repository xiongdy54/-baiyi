// SQLite 仓储层（v48.92 / D137 起：better-sqlite3 原生引擎，WAL journal 原生落盘；接口与 sql.js 时代一致）
// 落盘语义（§7.2 D137 登记）：「每次落库即落盘」由 SQLite 事务提交 + synchronous=FULL 的 WAL fsync 承担；
// persist() 重定义为显式 wal_checkpoint(TRUNCATE)（调用点全部保留），使磁盘单文件 = 完整最新状态。
// 文档数据模型：LibraryItem + Document，全部带 userId/updatedAt/syncVersion/isDeleted
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const annotationRange = require("./annotationRange");
const { app } = require("electron");
const Database = require("better-sqlite3");
const { attachRun, applyStandardPragmas, normParams } = require("./sqliteCompat");
const {
  CARD_GEN_PROMPT,
  CARD_FORMULA_PROMPT,
  CARD_SEQ_PROMPT,
  CARD_ENUM_PROMPT,
  CARD_MNEMONIC_PROMPT,
  CARD_CONTRAST_PROMPT,
  CARD_VOCAB_PROMPT,
  CARD_WORDING_PROMPT,
  CARD_BASIC_PROMPT,
  CARD_LITERATURE_PROMPT,
  CARD_OCCLUSION_PROMPT,
  CARD_OCCLUSION_PROMPT_V3,
  CARD_STRUCTURE_PROMPT,
  READER_EXPLAIN_PROMPT,
  LEECH_RESCUE_PROMPT,
  // v48.58（D99）：复习页「AI 判答」等价判定 scope
  REVIEW_ANSWER_JUDGE_PROMPT,
  JOURNAL_INSIGHT_PROMPT,
  KNOWLEDGE_EXTRACTION_PROMPT,
  KNOWLEDGE_RELATION_PROMPT,
  MATERIAL_DIFFICULTY_PROMPT,
  KNOWLEDGE_PROBE_PROMPT,
  FRONTIER_EXPLAIN_PROMPT,
  STRUCTURE_ANALOGY_PROMPT,
  USER_MEMORY_PROMPT,
  MATERIAL_MAP_SECTION_PROMPT,
  MATERIAL_MAP_MERGE_PROMPT,
  MATERIAL_MAP_GLOBAL_PROMPT,
  MATERIAL_MAP_EDITORIAL_PROMPT,
  MATERIAL_MAP_REVIEW_PROMPT,
  // v48.22（D58 / E1）：摘录重排 scope
  EXTRACT_RERANK_PROMPT,
  // v48.51（D91）：简明解读 scope；v48.74（D118）v1 原文冻结常量（全新库 v1 行留痕用）
  READER_EXPLAIN_STE_PROMPT,
  READER_EXPLAIN_STE_PROMPT_V1,
  // v48.74（D118）：通用解释模板 v2（追问四式）的 v1 原文冻结常量（READER_EXPLAIN_PROMPT 已在上方导入＝v2 现行文本）
  READER_EXPLAIN_PROMPT_V1,
  SITUATION_REQUIRED_SCOPES,
  situationRequiredFor,
  // D121 §3.3/§3.4：卡片辨析 scope card-disambiguate v1
  CARD_DISAMBIGUATE_PROMPT
} = require("./prompts");
const { sanitizeDomain, domainFromPrefix, UDC_MAIN, UDC_LEAVES, UDC_OTHER } = require("./udc");
const { calculateFsrsDeltaT, learningDayStartMs } = require("./fsrsTime");
const { journalDateOf, isJournalDate } = require("./journalTime");
// v41（K2-A，D38）：知识归一纯函数（规范化 / 批次簇键 / 提案幂等指纹）
const { normalizeKpLabel, kpClusterKeyFor, kpProposalFingerprint, isOpaqueClusterId } = require("./kpNorm");
const { readSettings, writeSettings } = require("./settingsStore");
// v48.22（D58 §6.4.1 E1）：实验推送引擎的本地因子层（纯函数，零 IO）
const { rankExtracts, rerankFingerprint } = require("./aiNextExtract");
const {
  DEFAULT_CONFIG_ID,
  ALGORITHM,
  ALGORITHM_VERSION,
  FSRS6_DEFAULT_WEIGHTS,
  DEFAULT_SCHEDULER_OPTIONS,
  configFingerprint
} = require("./fsrsConfig");

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
-- v48.22（D58）：摘录操作日志（append-only）。撤销＝恢复 before_json 确切前置状态 + 物理删除该行，
-- 镜像 review_logs 的撤销语义；批量共用一个 batch_id，整批按 seq 降序回退。
CREATE TABLE IF NOT EXISTS extract_ops (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  extract_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  batch_id TEXT,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- v48.22（D58）：全局操作序计数器（单行）。review_seq 与 extract_ops.seq 同取此值，
-- 使「最近一次操作是卡片评分还是摘录操作」可跨表比较；撤销删除尾条后序号不再复用。
CREATE TABLE IF NOT EXISTS op_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next INTEGER NOT NULL
);
-- v48.22（D58）：跨类撤销排序纯索引。载荷仍在 review_logs / extract_ops，本表只回答
-- 「最近一次操作是哪一类」；kind=card_grade 时 ref=review_logs.id，kind=extract_op 时
-- ref=extract_ops 单条 id 或批量共享的 batch_id。
CREATE TABLE IF NOT EXISTS op_journal (
  seq INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  undoable INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS fsrs_configs (
  id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,
  algorithm_version INTEGER NOT NULL,
  weights_json TEXT NOT NULL,
  scheduler_options_json TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- D121 §1.2：卡片辨析链接（展示/溯源用结构数据，不参与 FSRS 与队列；card_b 为 NULL = 单卡辨析）
CREATE TABLE IF NOT EXISTS card_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_a TEXT NOT NULL,
  card_b TEXT,
  kind TEXT NOT NULL DEFAULT 'disambiguated',
  verdict TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
-- v48.80（D124，§4.20）：学习轨道——用户在学的领域与处理方式
CREATE TABLE IF NOT EXISTS learner_tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  mode TEXT NOT NULL,                 -- language|concept|procedural|factual|narrative
  lang TEXT NOT NULL DEFAULT '',      -- 仅 language：ISO 639-1，如 en / ja / zh / ko / fr
  udc_codes_json TEXT NOT NULL DEFAULT '[]', -- 非 language：UDC 叶子编码数组
  status TEXT NOT NULL DEFAULT 'active',     -- active|paused|archived
  pinned INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 3,       -- 1..5，3=普通
  source TEXT NOT NULL DEFAULT 'user',       -- user|proposal（由提议一键采纳）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
-- 轨道↔材料的「人工覆盖」：只存用户手动加入(member=1)或排除(member=0)；自动归属不落表（设计稿 §6.9）
CREATE TABLE IF NOT EXISTS track_materials (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  member INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_materials_pair ON track_materials(track_id, library_item_id);
-- 学习事件（append-only 事实；kind 封闭枚举见设计稿 §5.3）
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  library_item_id TEXT,
  unit_id TEXT,
  kp_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_learning_events_kind_ts ON learning_events(kind, ts);
-- 推荐运行（只在推荐集合变化时写一行；保留最近 300 行，例外已在指导文档 §7.2 登记）
CREATE TABLE IF NOT EXISTS rec_runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  lm_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,          -- 推荐项 key 列表 sha1
  candidate_count INTEGER NOT NULL,
  items_json TEXT NOT NULL            -- 展示给用户的推荐项快照（RecItem[]）
);
CREATE INDEX IF NOT EXISTS idx_rec_runs_created ON rec_runs(created_at);
-- 推荐反馈（append-only 事实；action 封闭枚举见设计稿 §8.6）
CREATE TABLE IF NOT EXISTS rec_feedback (
  id TEXT PRIMARY KEY,
  rec_run_id TEXT,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  library_item_id TEXT,
  action TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,    -- 1=系统自动判定完成
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_key ON rec_feedback(item_key, ts);
`;

async function initDb() {
  // D137（§3.1）：better-sqlite3 同步构造直开文件（文件不存在即创建；崩溃恢复/WAL 回放由 SQLite
  // 打开时自动完成）——对外保持 async 签名，调用面零改动。
  // 重复调用（测试内「重启模拟」/ 幂等演练）＝先关旧连接再从文件重载：close 本身做 checkpoint，
  // 主文件自足后重开即与 sql.js 时代「每次 initDb 全量重读文件」语义一致（迁移/回填段随之重挂）。
  dbFile = path.join(app.getPath("userData"), "library.db");
  // D137 补（实测）：better-sqlite3 只创建**库文件**，不创建父目录——userData 目录不存在时
  // `new Database` 抛 "Cannot open database because the directory does not exist"。sql.js 时代
  // 落盘走 fs 写（自建目录）故无此约束；真实应用由 appLog.init 建 <userData>/logs 顺带保证父目录，
  // 但**种子脚本**（tests/*.gui.seed.cjs，直接 initDb、不经 appLog）在其套件先删 userData 后必崩——
  // 且该异常是 unhandled rejection，进程不退出 ⇒ 套件里 execSync 播种**永久挂死**（annotations 等
  // 12 个 seed 家族套件的表现）。此处自建目录：库层不假设调用方先建目录（对齐 sql.js 旧语义）。
  try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch { /* 已存在/无权限：交给下方 open 报错 */ }
  // v23/F11：启动清残留 tmp——tmp 永远不是事实源（sql.js 时代的原子替换残留，新引擎不再产出）
  try { fs.rmSync(dbFile + ".tmp", { force: true }); } catch { /* 忽略 */ }
  if (db && db.open) closeDb();
  db = attachRun(new Database(dbFile));
  applyStandardPragmas(db); // WAL + synchronous=FULL + busy_timeout（§3.7，WAL 标志持久在库头）
  // D137 §3.5：启动 quick_check 一次（结果仅入应用日志，不阻塞——损坏早暴露、零行为变更）
  try {
    const qc = db.pragma("quick_check", { simple: true });
    if (qc !== "ok") console.error(`[db] quick_check 异常：${qc}`);
  } catch (e) {
    console.error("[db] quick_check 失败：", e);
  }
  db.exec(SCHEMA);
  // D121 §1.2：card_links 索引（与其余索引同法放 initDb，IF NOT EXISTS 幂等）
  try {
    db.run("CREATE INDEX IF NOT EXISTS idx_card_links_a ON card_links(card_a)");
    db.run("CREATE INDEX IF NOT EXISTS idx_card_links_b ON card_links(card_b)");
  } catch { /* 忽略 */ }
  try {
    db.run("ALTER TABLE library_items ADD COLUMN progress_json TEXT");
  } catch {
    /* 列已存在 */
  }
  // v38（D35）：library_items.lang——书籍语言属性（空=未知）；查词语言路由的书籍级信号
  try {
    db.run("ALTER TABLE library_items ADD COLUMN lang TEXT NOT NULL DEFAULT ''");
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
  // v48.22（D58）：摘录复习改版的数据面——摘录状态机 / A-Factor / 计数 / 书级优先级 / 双引擎子空间
  for (const [col, type] of [
    ["status", "TEXT NOT NULL DEFAULT 'open'"],
    ["status_version", "INTEGER NOT NULL DEFAULT 1"],
    ["status_detail_json", "TEXT"],
    ["a_factor", "REAL NOT NULL DEFAULT 1.6"],
    ["postpone_count", "INTEGER NOT NULL DEFAULT 0"],
    ["process_count", "INTEGER NOT NULL DEFAULT 0"],
    ["priority_source", "TEXT NOT NULL DEFAULT 'book'"],
    ["engine_state_json", "TEXT"],
    // 批注化摘录（规格 docs/impl-spec/ANNOTATION-MULTISELECT.md §1.1）：批注文字 / 型别 / 色板 / 标签 /
    // 正文里的高亮范围锚（quote_range_json ＝ [{start,end},…]，多段选择即多区间）
    ["comment", "TEXT"],
    ["annotation_type", "TEXT"],
    ["annotation_color", "TEXT"],
    ["tag_json", "TEXT"],
    ["quote_range_json", "TEXT"],
    // v48.25 / 批 4（规格 INLINE-ANNOTATION §1.4，R35）：高亮与摘录**分族**——
    // 'highlight'＝纯高亮（不进队列/不计上限/不进 FSRS，但进浏览器与搜索）；
    // 'extract'＝摘录（现有语义不变）。存量行 NULL ⇒ 一律按摘录对待（零语义变更）。
    ["kind", "TEXT"]
  ]) {
    try {
      db.run(`ALTER TABLE extracts ADD COLUMN ${col} ${type}`);
    } catch {
      /* 列已存在 */
    }
  }
  // 存量回填：NULL 一律按摘录（幂等，重复执行无副作用）
  try {
    db.run("UPDATE extracts SET kind = 'extract' WHERE kind IS NULL OR kind = ''");
  } catch {
    /* 列不存在等异常不阻塞启动 */
  }
  try {
    // 书级默认优先级（默认 50 ＝与摘录默认同值，存量语义零变更）
    db.run("ALTER TABLE library_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 50");
  } catch {
    /* 列已存在 */
  }
  try {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_extract_ops_seq ON extract_ops(seq)");
    db.run("CREATE INDEX IF NOT EXISTS idx_extract_ops_batch ON extract_ops(batch_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_extract_ops_extract ON extract_ops(extract_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_extracts_topic_next ON extracts(topic_next_at)");
    db.run("CREATE INDEX IF NOT EXISTS idx_extracts_status ON extracts(status)");
  } catch { /* 表尚不存在等场景 */ }
  // v22：review_logs.fsrs_before_json（撤销评分——该次评分前的 FSRS 全字段快照；旧日志与未传快照的调用为 NULL，不可撤销）
  try {
    db.run("ALTER TABLE review_logs ADD COLUMN fsrs_before_json TEXT");
  } catch {
    /* 列已存在 */
  }
  // v23：FSRS 数据完整性加固列（§4.4.9/§4.4.10）
  try {
    db.run("ALTER TABLE review_logs ADD COLUMN fsrs_after_json TEXT"); // 评分后全字段快照（Undo 一致性校验/审计）
  } catch { /* 列已存在 */ }
  try {
    db.run("ALTER TABLE review_logs ADD COLUMN leech_before_json TEXT"); // 评分前 leech 快照（撤销精确恢复，F10）
  } catch { /* 列已存在 */ }
  try {
    db.run("ALTER TABLE review_logs ADD COLUMN fsrs_config_id TEXT"); // 本次评分所用参数配置
  } catch { /* 列已存在 */ }
  try {
    db.run("ALTER TABLE review_logs ADD COLUMN fsrs_before_config_id TEXT"); // 评分前状态归属配置（撤销恢复）
  } catch { /* 列已存在 */ }
  try {
    db.run("ALTER TABLE cards ADD COLUMN fsrs_config_id TEXT"); // 当前状态最近一次调度写入所用配置（§4.4.10 滚动语义）
  } catch { /* 列已存在 */ }
  try {
    // review_seq：全局插入序（§4.4.9 排序不变量）。存量回填=rowid（精确保留既有顺序），新写入事务内 MAX+1
    const hasSeq = queryAll("SELECT COUNT(*) AS n FROM pragma_table_info('review_logs') WHERE name='review_seq'")[0]?.n || 0;
    if (!hasSeq) {
      db.run("ALTER TABLE review_logs ADD COLUMN review_seq INTEGER");
      db.run("UPDATE review_logs SET review_seq = rowid WHERE review_seq IS NULL");
    }
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_review_logs_seq ON review_logs(review_seq)");
  } catch { /* 已迁移 */ }
  try {
    // v48.22（D58）：操作序计数器播种（op_journal / extract_ops 的 seq 来源，单行、必须存在）。
    // **与 review_logs.review_seq 相互独立**——跨类撤销排序靠 op_journal，不靠 review_seq，
    // 故这里不依赖 review_seq，起点固定为 1；INSERT OR IGNORE 保护已有行。
    const hasCounter = queryAll("SELECT COUNT(*) AS n FROM op_counter")[0]?.n || 0;
    if (!hasCounter) {
      db.run("INSERT OR IGNORE INTO op_counter (id, next) VALUES (1, 1)");
    }
  } catch { /* 表尚不存在等场景 */ }
  // v23（D20）：fsrs_configs 播种——无任何 config 行时插入 cfg-default（完整默认快照）
  try {
    const cfgCount = queryAll("SELECT COUNT(*) AS n FROM fsrs_configs")[0]?.n || 0;
    if (!cfgCount) {
      db.run(
        "INSERT INTO fsrs_configs (id, algorithm, algorithm_version, weights_json, scheduler_options_json, config_fingerprint, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          DEFAULT_CONFIG_ID,
          ALGORITHM,
          ALGORITHM_VERSION,
          JSON.stringify(FSRS6_DEFAULT_WEIGHTS),
          JSON.stringify(DEFAULT_SCHEDULER_OPTIONS),
          configFingerprint(FSRS6_DEFAULT_WEIGHTS, DEFAULT_SCHEDULER_OPTIONS),
          "default",
          Date.now()
        ]
      );
    }
  } catch { /* 表尚不存在等场景 */ }
  // v23（D20）：存量 settings.app.fsrsWeights 迁移——播种为 optimizer config 行并设指针后删除该字段（双事实源废除）
  try {
    const s0 = readSettings();
    if (Array.isArray(s0.app?.fsrsWeights) && s0.app.fsrsWeights.length === 21 && !s0.app?.fsrsConfigId) {
      const id = insertFsrsConfig(s0.app.fsrsWeights, DEFAULT_SCHEDULER_OPTIONS, "optimizer");
      setActiveFsrsConfig(id);
      delete s0.app.fsrsWeights;
      writeSettings(s0);
    }
  } catch { /* 迁移失败不阻塞启动（下次启动重试） */ }
  // v15 曾为翻转问答卡加过 cards.reverse_json 列；v16 起翻转问答改为「创建两张独立问答卡」
  // （用户决策 D18：禁止复习期形态变化的卡片，一切卡设计以 FSRS 为核心），列不再使用。
  // 已存在的列留在旧库中无碍（SQLite 容忍多余列，INSERT 显式命名列），新库不再建列。
  // v32（M7，D31）：词典表——dict_sources（来源登记，含留位四件套）+ dictionary_cache（在线缓存，受 Provider 许可约束）
  try {
    db.run(`CREATE TABLE IF NOT EXISTS dict_sources (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL,
      path TEXT, url TEXT, enabled INTEGER NOT NULL DEFAULT 1, entry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS dictionary_cache (
      provider_id TEXT NOT NULL, language TEXT NOT NULL, normalized_word TEXT NOT NULL,
      result_json TEXT NOT NULL, fetched_at INTEGER NOT NULL, version TEXT,
      PRIMARY KEY (provider_id, language, normalized_word)
    )`);
  } catch { /* 表已存在 */ }
  // v38（M7，D35）：dict_sources.lang——来源词典语言，本地多来源命中同一词头时语言优先的依据。
  // 存量行按 format 回填（幂等，新格式解析器在 dictStore.js 落库时 upsert 自带派生）。
  try {
    db.run("ALTER TABLE dict_sources ADD COLUMN lang TEXT NOT NULL DEFAULT ''");
  } catch { /* 列已存在 */ }
  try {
    for (const [fmt, lang] of Object.entries(DICT_FORMAT_LANG)) {
      db.run("UPDATE dict_sources SET lang=? WHERE lang='' AND format=?", [lang, fmt]);
    }
  } catch { /* 回填失败下次启动重试 */ }
  // v32（M7）：cards.dict_json（Entry 快照 + providerId + 查词版本；存量 NULL 前向兼容）
  try {
    db.run("ALTER TABLE cards ADD COLUMN dict_json TEXT");
  } catch {
    /* 列已存在 */
  }
  // v34（M12，D33/§4.16）：cards.sibling_key——同源组标识（同一制卡来源单元的多张卡共享）。
  // 只服务「今日队列视图」（computeTodayQueue），不参与 FSRS 调度；存量行 NULL=不参与延后，无回填。
  try {
    db.run("ALTER TABLE cards ADD COLUMN sibling_key TEXT");
  } catch {
    /* 列已存在 */
  }
  // v48.60（D102，§4.1）：cards.status——卡片生命周期（active/archived）。
  // NULL 视同 active（零回填）；只影响 TODAY_QUEUE_SQL 视图过滤，不改任何 FSRS 字段。
  try {
    db.run("ALTER TABLE cards ADD COLUMN status TEXT");
  } catch {
    /* 列已存在 */
  }
  // v36（M8-A，§4.1/§6.5.2，D34）：journal_entries——流式日记条目（第二输入通道）。
  // 口径：entry_date 为**自然日**（不随学习日切点漂移）；is_draft=1 为「未发送的快速记录草稿」。
  // 草稿全局至多一条由**部分唯一索引**在库层兜底（业务层仍先查后写，索引是防止竞态/脚本误写的护栏）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'app',
      is_draft INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sent_at INTEGER,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date, created_at)");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_single_draft ON journal_entries(is_draft) WHERE is_draft = 1");
  } catch { /* 表已存在 */ }
  // v40（K1，D37 / §4.6）：知识地基四表（KnowledgeBase §4.2-23）。
  // ① knowledge_points：KP 一等实体——不属于任何卡/书；canonical_label 非唯一事实，必须配 alias；
  //    合并=软删除 + merged_into 指向 + alias 并入（可回滚，mergeLog 记于被合并方 metadata_json）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_points (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canonical_label TEXT NOT NULL,
      description TEXT,
      domain_id TEXT,
      parent_knowledge_point_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      merged_into TEXT,
      alias_json TEXT NOT NULL DEFAULT '[]',
      language_variants_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_kp_label ON knowledge_points(canonical_label)");
    db.run("CREATE INDEX IF NOT EXISTS idx_kp_status ON knowledge_points(status, is_deleted)");
  } catch { /* 表已存在 */ }
  // ② knowledge_relations：知识关系边——relation_type 封闭 9 枚举；唯一 (from,to,type) 由业务层
  //    写时校验（sql.js 无部分索引外的友好约束路径，K3 环检测同在此处）；analogous_to 只建表不启用引擎（K9）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_relations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_knowledge_point_id TEXT NOT NULL,
      to_knowledge_point_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL,
      source TEXT NOT NULL DEFAULT 'user',
      source_ref_json TEXT,
      structure_label TEXT,
      mapping_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_krel_from ON knowledge_relations(from_knowledge_point_id, is_deleted)");
    db.run("CREATE INDEX IF NOT EXISTS idx_krel_to ON knowledge_relations(to_knowledge_point_id, is_deleted)");
  } catch { /* 表已存在 */ }
  // ③ knowledge_external_refs：外部 ID grounding（Wikidata QID / ISBN / DOI…），只作依据非事实源。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_external_refs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      ref_kind TEXT NOT NULL,
      ref_value TEXT NOT NULL,
      source_label TEXT,
      created_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_kref_kp ON knowledge_external_refs(knowledge_point_id, is_deleted)");
  } catch { /* 表已存在 */ }
  // ④ knowledge_proposals：AI/迁移提案暂存（staging，§1.7 草稿纪律）——确认后才入正式表；
  //    K1 阶段生产者只有手动与旧字段迁移回填，AI 生产者随 K2 接入。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_proposals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      proposal_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      confidence REAL,
      scope TEXT NOT NULL DEFAULT 'manual',
      source_run_id TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_kprop_status ON knowledge_proposals(status, proposal_kind, is_deleted)");
  } catch { /* 表已存在 */ }
  // v41（K2-A，D38）：knowledge_proposals.fingerprint——提案幂等键（sha1(kind+部件)；同键任何状态含已拒绝
  // 已存在即跳过，否决即事实）。存量行 NULL=无指纹（旧迁移提案），不参与去重。
  try {
    db.run("ALTER TABLE knowledge_proposals ADD COLUMN fingerprint TEXT");
    db.run("CREATE INDEX IF NOT EXISTS idx_kprop_fp ON knowledge_proposals(fingerprint, is_deleted)");
  } catch { /* 列已存在 */ }
  // v46（M14-UM2，D39 / §4.18-9 v44 原则制）：prompt_templates.situation_required——R20 scope 声明位
  // （提示词播种时随模板写入；注入管线只对 1 的 scope 装配【用户记忆】块）。存量行按注册表回填。
  try {
    db.run("ALTER TABLE prompt_templates ADD COLUMN situation_required INTEGER");
  } catch { /* 列已存在 */ }
  try {
    for (const [scope, val] of Object.entries(SITUATION_REQUIRED_SCOPES)) {
      db.run("UPDATE prompt_templates SET situation_required = ? WHERE scope = ?", [val ? 1 : 0, scope]);
    }
    db.run("UPDATE prompt_templates SET situation_required = 0 WHERE situation_required IS NULL");
  } catch { /* 回填失败不阻塞启动 */ }
  // v46（M14-UM2，§4.18-10）：cards.memory_ref_json——记忆溯源（{line, verified}；NULL=未用记忆）
  try {
    db.run("ALTER TABLE cards ADD COLUMN memory_ref_json TEXT");
  } catch { /* 列已存在 */ }
  // v40（M8-B，§4.13/§9.1 M8-B-4）：洞察运行记录（append-only 事实 + 反馈载体；永不写 mastery）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS insight_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      range_kind TEXT NOT NULL,
      range_from TEXT,
      range_to TEXT,
      entry_count INTEGER NOT NULL DEFAULT 0,
      entry_ids_json TEXT NOT NULL DEFAULT '[]',
      evidence_package_json TEXT,
      model TEXT,
      prompt_scope TEXT,
      prompt_version INTEGER,
      output_json TEXT,
      token_used INTEGER,
      feedback_json TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_iruns_created ON insight_runs(created_at, is_deleted)");
  } catch { /* 表已存在 */ }
  // v40（M8-B，§4.13-3 / D37）：Personal Meaning 第三图候选（独立候选表 + 确认状态机）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS personal_meaning_candidates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_insight_run_id TEXT,
      evidence_refs_json TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_pmc_status ON personal_meaning_candidates(status, is_deleted)");
  } catch { /* 表已存在 */ }
  // v45（M14-UM1，D39 / §4.18-11-14）：用户记忆整理运行留痕（append-only；护栏⑤「可审计、可复现」）。
  // 记忆真源是 memory/ 文件树（非 DB），本表只记每轮摄入/整理的事实：输入范围、AI 输出 ops、逐 op 执行结果。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS memory_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      prompt_scope TEXT,
      prompt_version INTEGER,
      model TEXT,
      token_used INTEGER,
      input_json TEXT,
      output_json TEXT,
      applied_json TEXT,
      error_text TEXT,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_mruns_started ON memory_runs(started_at, is_deleted)");
  } catch { /* 表已存在 */ }
  // v48 批1（M15 重做，D41-⑤ / §4.19-7）：材料知识导图数据层（3 表）。
  // map = 每版本一行（结构 JSON 内嵌节点+边+证据；SVG 只是视图，JSON 才是数据）；
  // shard = 分片缓存（逻辑键含 provider+model+modelConfigHash——换模型或关键生成参数不复用旧结果）；
  // run = 生成运行留痕（状态机 / 预计与实际 token 费用 / repair 次数 / 机读错误码）。
  // 抽取快照文本不入库（sql.js 全量落盘防库膨胀）——只存 snapshotHash/quoteHash（D41-④）。
  // M2 备份打包整库自动覆盖，无需登记（§8.1 D41；backup.js 无需改动）。
  try {
    db.run(`CREATE TABLE IF NOT EXISTS material_maps (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      scope_anchor TEXT NOT NULL DEFAULT 'book',
      scope_kind TEXT NOT NULL DEFAULT 'book',
      granularity TEXT NOT NULL DEFAULT 'standard',
      title TEXT,
      structure_json TEXT NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      source_revision_hash TEXT,
      prompt_version INTEGER,
      generator_version TEXT,
      provider TEXT,
      model TEXT,
      model_config_hash TEXT,
      node_remap_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_mmaps_doc ON material_maps(document_id, scope_anchor, is_deleted)");
    db.run("CREATE INDEX IF NOT EXISTS idx_mmaps_active ON material_maps(document_id, is_active, is_deleted)");
  } catch { /* 表已存在 */ }
  try {
    db.run(`CREATE TABLE IF NOT EXISTS material_map_shards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      unit_anchor TEXT NOT NULL,
      run_kind TEXT NOT NULL,
      granularity TEXT NOT NULL,
      prompt_scope TEXT NOT NULL,
      prompt_version INTEGER NOT NULL,
      text_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_config_hash TEXT NOT NULL,
      content_json TEXT NOT NULL,
      chars INTEGER,
      token_used INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mshards_key ON material_map_shards(
      document_id, unit_anchor, run_kind, granularity, prompt_scope, prompt_version,
      text_hash, provider, model, model_config_hash, is_deleted)`);
  } catch { /* 表已存在 */ }
  try {
    db.run(`CREATE TABLE IF NOT EXISTS material_map_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      scope_anchor TEXT,
      scope_kind TEXT,
      granularity TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      calls_planned INTEGER,
      calls_done INTEGER,
      chars INTEGER,
      est_input_tokens INTEGER,
      est_output_tokens INTEGER,
      est_cost REAL,
      currency TEXT,
      actual_prompt_tokens INTEGER,
      actual_completion_tokens INTEGER,
      actual_cost REAL,
      repair_count INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      model TEXT,
      model_config_hash TEXT,
      prompt_version INTEGER,
      error_code TEXT,
      error_text TEXT,
      input_json TEXT,
      output_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_mruns2_doc ON material_map_runs(document_id, created_at, is_deleted)");
  } catch { /* 表已存在 */ }
  // v48.11（D44 §3.8）：导图调用日志——**账本真源**是这里，不是分片表（分片是缓存，命中不落行）
  try {
    db.run(`CREATE TABLE IF NOT EXISTS material_map_calls (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      run_kind TEXT NOT NULL,
      node_anchor TEXT,
      span_hash TEXT,
      chars INTEGER,
      outcome TEXT NOT NULL,
      error_code TEXT,
      finish_reason TEXT,
      attempt INTEGER,
      wall_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      created_at INTEGER NOT NULL
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_mcalls_run ON material_map_calls(run_id, created_at)");
    // v48.12 P0：测量字段（守卫式 ALTER，存量库自动补齐）
    for (const [col, type] of [
      ["ttft_ms", "INTEGER"],
      ["first_byte_ms", "INTEGER"],
      ["depth", "INTEGER"],
      ["parent_node_id", "TEXT"],
      ["span_chars", "INTEGER"]
    ]) {
      try {
        db.run(`ALTER TABLE material_map_calls ADD COLUMN ${col} ${type}`);
      } catch {
        /* 列已存在 */
      }
    }
  } catch { /* 表已存在 */ }
  // D121 §1.1：书籍作者（可空；导入时取得到才填，绝不猜）
  try {
    db.run("ALTER TABLE library_items ADD COLUMN author TEXT");
  } catch {
    /* 列已存在 */
  }
  // §9.4 历史数据兼容（一次性版本化回填）：① v11 前新卡态卡片 fsrs_json 补 S/D 基线（createEmptyCard
  // 口径 0/0，§4.4.1「历史缺字段基线回填」）；② 存量 cloze 卡 hint 拆答案物化进 back_markdown（与渲染层
  // extractClozeAnswer(s) 拼接逐字符等价，tests/legacyBackfill.test.cjs 对拍）。判定/编排见 legacyBackfill.js：
  // 单事务 + 未匹配行零变更 + settings.app.legacyBackfillV1 标记幂等；数据落盘走本函数末尾 persist()。
  let legacyBackfillResult = null; // P1 时序：回填结果暂存，完成标记延到 persist() 成功之后才落盘
  try {
    const { runLegacyBackfill } = require("./legacyBackfill");
    const bf = runLegacyBackfill({ db, queryAll, readSettings, writeSettings, now: Date.now });
    if (bf.ran && (bf.fsrsFixed > 0 || bf.clozeFixed > 0)) {
      console.log(`[legacyBackfill] fsrs_json 补 S/D ${bf.fsrsFixed} 行；cloze hint 答案物化 ${bf.clozeFixed} 行`);
    }
    if (bf.ran) legacyBackfillResult = bf;
  } catch (e) {
    console.error("[legacyBackfill] 回填失败（不阻塞启动，下次启动重试）：", e);
  }
  ensurePromptTemplates();
  persist();
  // P1 时序：完成标记必须在 persist() 成功之后写（标记是重跑跳过的唯一安全网，先于数据落盘会在
  // 「标记已写、数据未持久化即崩溃」时把存量旧数据锁死在未回填态）——persist 抛错则此处不执行，
  // 标记不落盘，下次启动重跑可续（事务零残留；数据已持久化时重跑判定已合规 → 零写入 → 补标记）。
  if (legacyBackfillResult) {
    try {
      legacyBackfillResult.mark();
    } catch (e) {
      console.error("[legacyBackfill] 完成标记写入失败（下次启动重跑补记）：", e);
    }
  }
}

// v48.92（D137 §3.4）：persist() 重定义——sql.js 时代的「全量导出 + tmp/fsync/rename 原子替换」随
// 内存库退役；新语义 = 显式 `wal_checkpoint(TRUNCATE)`：把 WAL 合并回主文件并截断，使「磁盘上
// library.db 单文件 = 完整最新状态」这一既有外部假设继续成立（外部脚本、直接拷贝、旧工具链均安全）。
// 持久性本身由 SQLite 事务提交 + synchronous=FULL（每次提交 fsync WAL）承担，不再依赖本函数。
// 失败语义（F37/§4.4.9）：checkpoint 失败（如其他连接持读锁 busy=1、磁盘 I/O 错误）同样 throw →
// IPC reject → UI 封锁评分并经 persistNow 重试；调用点全部保留、零裁剪。
function persist() {
  const busy = db.pragma("wal_checkpoint(TRUNCATE)", { simple: true });
  if (Number(busy) !== 0) {
    throw new Error("persist 失败：wal_checkpoint(TRUNCATE) 忙碌（busy=1）——存在并发读，稍后重试");
  }
}

// v23：纯持久化重试（§4.4.9）——D137 后语义 = 重试 checkpoint（WAL 合并回主文件），
// 绝不重新执行任何业务 mutation；供 UI「重试保存」在 persist 失败后调用
function persistNow() {
  persist();
  return true;
}

// D137（v48.92）：应用退出时显式关闭连接——clean shutdown 下 SQLite 自动做 WAL checkpoint
// 并删除 -wal/-shm sidecar（等价一次 persist() + 文件自足收尾）；异常吞并（退出期尽力而为）
function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* 退出期尽力而为 */
    }
    db = null;
  }
}

// D137（§3.6）：在线快照到目标路径（db.backup 页拷贝，不阻塞写路径）——M2 备份改走此口
async function snapshotTo(destPath) {
  if (!db || !db.open) throw new Error("主库未打开，无法快照");
  await db.backup(destPath);
  return destPath;
}

// D137：连接级 pragma 读数（journal_mode/synchronous 实测口径，验收与诊断辅助；只读，零副作用）
function connPragmas() {
  if (!db || !db.open) return null;
  return {
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
    busyTimeout: Number(db.pragma("busy_timeout", { simple: true }))
  };
}

// ---------- FSRS 参数环境（v23，D20 / §4.4.10：不可变快照 + 活跃指针） ----------

// 读取某配置行（解析后的完整快照）；不存在返回 null
function getConfigRow(id) {
  const rows = queryAll("SELECT * FROM fsrs_configs WHERE id = ?", [id]);
  const r = rows[0];
  if (!r) return null;
  let weights = null;
  let schedulerOptions = null;
  try { weights = JSON.parse(r.weights_json); } catch { /* 损坏行按 null */ }
  try { schedulerOptions = JSON.parse(r.scheduler_options_json); } catch { /* 损坏行按 null */ }
  return {
    id: r.id,
    algorithm: r.algorithm,
    algorithmVersion: r.algorithm_version,
    weights,
    schedulerOptions,
    configFingerprint: r.config_fingerprint,
    source: r.source,
    createdAt: r.created_at
  };
}

// 活跃配置 = settings.app.fsrsConfigId 指针所指行（指针缺失/悬空回退 cfg-default）
function getActiveFsrsConfig() {
  const s = readSettings();
  const id = s.app?.fsrsConfigId;
  return (id && getConfigRow(id)) || getConfigRow(DEFAULT_CONFIG_ID);
}

function getActiveConfigId() {
  return getActiveFsrsConfig()?.id || DEFAULT_CONFIG_ID;
}

// 插入新配置（指纹去重：同一配置永远只有一个 config_id，§4.4.10）；返回 config id
function insertFsrsConfig(weights, schedulerOptions, source) {
  const fp = configFingerprint(weights, schedulerOptions);
  const existing = queryAll("SELECT id FROM fsrs_configs WHERE config_fingerprint = ?", [fp])[0];
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO fsrs_configs (id, algorithm, algorithm_version, weights_json, scheduler_options_json, config_fingerprint, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, ALGORITHM, ALGORITHM_VERSION, JSON.stringify(weights), JSON.stringify(schedulerOptions), fp, source, Date.now()]
  );
  return id;
}

// 移动活跃指针（切换配置只改变指针，绝不修改配置内容；§4.4.10 不可变约束）
function setActiveFsrsConfig(id) {
  if (!getConfigRow(id)) throw new Error(`FSRS 配置不存在: ${id}`);
  const s = readSettings();
  if (!s.app) s.app = {};
  s.app.fsrsConfigId = id;
  writeSettings(s);
  return id;
}

// M2 备份：备份/恢复前把内存库刷盘；getBackupCounts 供备份清单展示数据规模
function getBackupCounts() {
  const n = (sql) => Number(queryAll(sql)[0]?.n || 0);
  return {
    items: n("SELECT COUNT(*) AS n FROM library_items WHERE is_deleted = 0"),
    cards: n("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0"),
    extracts: n("SELECT COUNT(*) AS n FROM extracts WHERE is_deleted = 0"),
    assets: n("SELECT COUNT(*) AS n FROM assets WHERE is_deleted = 0")
  };
}

function listItems() {
  // D137：步进游标 → .all()（同 queryAll 映射）
  return db.prepare(`
    SELECT li.id, li.title, li.source_type AS sourceType, li.cover, li.progress_json AS progressJson,
           li.lang, li.priority, li.author, li.created_at AS createdAt, li.updated_at AS updatedAt, d.markdown
    FROM library_items li
    LEFT JOIN documents d ON d.library_item_id = li.id AND d.is_deleted = 0
    WHERE li.is_deleted = 0
    ORDER BY li.created_at DESC
  `).all();
}

// v38（D35）：书籍语言属性（''=未知）。查词语言路由的书籍级信号；不参与其他逻辑。
function setLibraryItemLang(id, lang) {
  const rawInput = String(lang ?? "");
  const raw = rawInput.trim();
  // D-TEST-75：原来只 trim+toLowerCase 后原样落盘——"not-a-lang"、"中文"、"EN"、"12" 都能写进
  // 这个字段，而它正是词典 D35 语言优先级链的**第四档取值来源**（解析出的脏值会直接进路由判断）。
  // 现在按 BCP-47 形状校验：空串允许（显式清空），纯空白按非法拒收（否则手滑一次就把语言清掉）。
  // 边界：形状校验拦不住"形似合法但不存在的码"（如 not-a-lang），那需要语言注册表 —— 主进程没有
  // 权威清单，与 D-TEST-77 同一情形，记为渲染层侧的后续项。
  if (rawInput !== "" && raw === "") return false;
  const t = raw.toLowerCase();
  // 子标签允许 1 个字符：BCP-47 的单字符子标签是合法的（如 en-US-x 的私有段 x），
  // 早先写成 {2,8} 会把这类合法值误拒 —— 形状校验要宽、存在性校验才该严（后者主进程做不了）。
  if (raw !== "" && !/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(t)) return false;
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("library_items", id)) return false;
  db.run("UPDATE library_items SET lang=?, updated_at=? WHERE id=? AND is_deleted=0", [t, Date.now(), String(id)]);
  persist();
  return true;
}

// v45.1（用户需求）：书架悬停改名——只改标题，不动封面/进度/文档等其余列
function setLibraryItemTitle(id, title) {
  const t = String(title ?? "").trim();
  if (!t) throw new Error("书名不能为空");
  if (t.length > 300) throw new Error("书名过长（至多 300 字符）");
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("library_items", id)) return false;
  db.run("UPDATE library_items SET title=?, updated_at=? WHERE id=? AND is_deleted=0", [t, Date.now(), String(id)]);
  persist();
  return true;
}

// D121 §1.1：书籍作者编辑——trim；空串→NULL；>200 字拒绝
function setLibraryItemAuthor(id, author) {
  const a = String(author ?? "").trim();
  if (a.length > 200) throw new Error("作者过长（至多 200 字符）");
  if (!rowExists("library_items", id)) return false;
  db.run("UPDATE library_items SET author=?, updated_at=? WHERE id=? AND is_deleted=0", [a || null, Date.now(), String(id)]);
  persist();
  return true;
}

// v46（M14-UM2，§4.18-6/7）：本书已有卡的 UDC 域分布——Stage A 宽召回的材料信号之一。
// 读侧只读；LIKE 匹配 context_ref_json 里的 documentId（UUID 无注入风险）。
function listCardDomainsForDocument(documentId) {
  const id = String(documentId || "");
  if (!id) return [];
  const rows = queryAll(
    "SELECT domain, context_ref_json FROM cards WHERE is_deleted = 0 AND domain IS NOT NULL AND context_ref_json LIKE ? LIMIT 2000",
    [`%${id}%`]
  );
  const out = [];
  for (const r of rows) {
    try {
      const ref = r.context_ref_json ? JSON.parse(r.context_ref_json) : null;
      if (!ref || ref.documentId !== id) continue;
      const dom = r.domain ? JSON.parse(r.domain) : [];
      for (const d of Array.isArray(dom) ? dom : []) if (d) out.push(String(d));
    } catch { /* 容忍坏行 */ }
  }
  return out;
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
  // v40：追加 documentId（增量字段，供洞察 Evidence Package 来源 JOIN 等使用；既有 {id,title} 不变）
  return { id: itemId, title: cleanTitle, documentId: docId };
}

function deleteItem(id) {
  // 批次 E（D-TEST-15 T1 档）：书目不存在或已软删时返回 false（重复删除第二次就是 false）。
  if (!rowExists("library_items", id)) return false;
  const now = Date.now();
  db.run("UPDATE library_items SET is_deleted = 1, updated_at = ? WHERE id = ?", [now, id]);
  db.run("UPDATE documents SET is_deleted = 1, updated_at = ? WHERE library_item_id = ?", [now, id]);
  // 批次 C（D-TEST-18）：资产行一并软删。字节保留在盘上（回收是显式清理的事，不在本批），
  // 但备份打包按 item 目录整份带走，标记后 backup.js 才能把它挡在备份外。
  db.run("UPDATE assets SET is_deleted = 1, updated_at = ? WHERE library_item_id = ?", [now, id]);
  persist();
  return true;
}

// 只读：已软删的书目 id（备份侧用来跳过它们的 assets 目录；缺省不传 = 行为与今天一致）
function listDeletedItemIds() {
  return queryAll("SELECT id FROM library_items WHERE is_deleted = 1").map((r) => String(r.id));
}

function addAssetRow(itemId, kind, relPath, hash, now) {
  db.run(
    `INSERT INTO assets (id, library_item_id, kind, path, hash, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [crypto.randomUUID(), itemId, kind, relPath, hash, now, now]
  );
}

// M1.1（v15）：图片挖空卡 —— 把渲染层传来的图片字节落盘 + 入 assets 表（kind=image-occlusion）。
// ownerKey 允许传 library item id 或 documentId（摘录阅读器场景只有 documentId），统一归一到 itemId。
const WORKBENCH_ASSET_OWNER = "workbench-assets";
function createAssetForItem(ownerKey, kind, ext, dataBuf) {
  let itemId = null;
  const rows = String(ownerKey) === WORKBENCH_ASSET_OWNER ? [] : queryAll("SELECT id FROM library_items WHERE id = ? AND is_deleted = 0", [String(ownerKey)]);
  if (String(ownerKey) === WORKBENCH_ASSET_OWNER) {
    // 制卡台自由截图（无归属书籍）：落到固定的 workbench-assets 资产目录
    itemId = WORKBENCH_ASSET_OWNER;
  } else if (rows.length > 0) {
    itemId = rows[0].id;
  } else {
    itemId = getItemIdByDocumentId(String(ownerKey));
  }
  if (!itemId) throw new Error(`找不到归属的书籍条目（${String(ownerKey).slice(0, 12)}…）；请从书架打开对应书籍后重试`);
  const buf = Buffer.isBuffer(dataBuf) ? dataBuf : Buffer.from(dataBuf);
  if (!buf.length) throw new Error("图片数据为空");
  if (buf.length > 10 * 1024 * 1024) throw new Error("图片超过 10MB，请压缩后再制卡");
  const dir = path.join(app.getPath("userData"), "assets", itemId);
  fs.mkdirSync(dir, { recursive: true });
  const cleanExt = ["png", "jpg", "jpeg", "gif", "webp"].includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : "png";
  const filename = `occl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${cleanExt}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  addAssetRow(itemId, kind || "image-occlusion", filename, sha256(buf), Date.now());
  persist();
  return { itemId, filename, assetPath: `bookasset://${itemId}/${filename}` };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// D121 §1.1：导入时的作者归一（trim；空→NULL；超 200 截断而非拒绝，导入不应因元数据失败）
function cleanImportAuthor(author) {
  const a = String(author ?? "").trim().slice(0, 200);
  return a || null;
}

function createFromEpub(title, markdown, toc, coverDataUrl, epubData, sourceName, author) {
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
    `INSERT INTO library_items (id, user_id, title, source_type, source_url, cover, author, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, 'epub', ?, ?, ?, ?, ?, 0, 0)`,
    [itemId, cleanTitle, sourceName || null, coverRel, cleanImportAuthor(author), now, now]
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

// M6-1（v26）：导入格式扩展 —— Word/TXT/Markdown 统一建册（照抄 createFromEpub 形状）。
// source_type ∈ word|txt|markdown；原文件落 assets kind=<sourceType>-original；内嵌图落 kind=image-content
// （文件名 img-N.ext 确定性命名，读侧 readContentImages 取回字节随合成 EPUB 内嵌，M2 备份自动覆盖）。
// 批次 C（D-TEST-17）：落盘文件名净化收在 **sink** 侧，不指望调用方传对。
// 用 split(/[\\/]/) 而不是 path.basename（Windows 反斜杠会穿透 basename）；
// 纯点名字必须拒（`..` 过了 basename 仍是 `..`，path.join(dir,"..") 就出目录了）。
function safeAssetFileName(name, fallback) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[^\w.()-]/g, "_");
  return base && !/^\.+$/.test(base) ? base : fallback;
}

function createImportedDoc({ title, markdown, sourceType, sourceName, originalName, originalBuf, images, author }) {
  const cleanTitle = String(title || "").trim() || firstLine(markdown) || "未命名书籍";
  const itemId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const now = Date.now();
  const dir = path.join(app.getPath("userData"), "assets", itemId);
  fs.mkdirSync(dir, { recursive: true });

  if (originalBuf && originalBuf.length) {
    // 写盘名与 assets.path 必须是同一个变量：读侧按 assets.path 取文件
    const safeName = safeAssetFileName(originalName, "original.bin");
    fs.writeFileSync(path.join(dir, safeName), originalBuf);
    addAssetRow(itemId, `${sourceType}-original`, safeName, sha256(originalBuf), now);
  }
  for (const im of images || []) {
    const buf = Buffer.isBuffer(im.bytes) ? im.bytes : Buffer.from(im.bytes);
    if (!buf.length) continue;
    if (!/^[\w.-]+$/.test(String(im.filename))) continue; // 文件名防穿越（导入器产出的 img-N.ext 恒命中）
    // 批次 C（D-TEST-17）：这道护栏漏了「合法却危险」的名字——`..` 过 [\w.-]+ 后
    // writeFileSync(dir/..) 抛 EISDIR，整本导入失败。同一套净化在这里再过一遍，纯点名字直接跳过。
    const safeImg = safeAssetFileName(im.filename, "");
    if (!safeImg) continue;
    fs.writeFileSync(path.join(dir, safeImg), buf);
    addAssetRow(itemId, "image-content", safeImg, sha256(buf), now);
  }

  db.run(
    `INSERT INTO library_items (id, user_id, title, source_type, source_url, cover, author, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, NULL, ?, ?, ?, 0, 0)`,
    [itemId, cleanTitle, String(sourceType), sourceName || null, cleanImportAuthor(author), now, now]
  );
  db.run(
    `INSERT INTO documents (id, library_item_id, markdown, blocks_json, toc_json, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, ?, ?, '[]', NULL, ?, ?, 0, 0)`,
    [docId, itemId, String(markdown), now, now]
  );
  persist();
  return { id: itemId, title: cleanTitle };
}

// M6-1（v26）：读侧取回内嵌图字节（合成 EPUB 时由 buildSyntheticEpub 落进 OEBPS/images/）
function readContentImages(itemId) {
  const rows = queryAll(
    "SELECT path FROM assets WHERE library_item_id = ? AND kind = 'image-content' AND is_deleted = 0 ORDER BY path",
    [String(itemId)]
  );
  const out = [];
  for (const r of rows) {
    if (!r.path) continue;
    try {
      out.push({
        filename: r.path,
        bytes: new Uint8Array(fs.readFileSync(path.join(app.getPath("userData"), "assets", String(itemId), r.path))),
      });
    } catch { /* 单图缺失不阻塞整本，合成时该 src 原样保留 */ }
  }
  return out;
}

// 阅读内核（v20）：读取书架条目的原书文件（assets 表 kind='epub-original' → assets/<itemId>/<path>）。
// 返回 Uint8Array 供 foliate 内核打开；无原书（如粘贴书）返回 null。
function readBookFile(itemId) {
  const row = queryAll(
    "SELECT path FROM assets WHERE library_item_id = ? AND kind = 'epub-original' AND is_deleted = 0 LIMIT 1",
    [String(itemId)]
  )[0];
  if (!row || !row.path) return null;
  try {
    const p = path.join(app.getPath("userData"), "assets", String(itemId), row.path);
    return new Uint8Array(fs.readFileSync(p));
  } catch {
    return null;
  }
}

// M6-2 修订（v28 PDF 原生阅读）：读取书架条目的 PDF 原文件（kind='pdf-original' → original.pdf），
// 供 pdf.js 内核直接打开；照抄 readBookFile 形状。
function readPdfFile(itemId) {
  const row = queryAll(
    "SELECT path FROM assets WHERE library_item_id = ? AND kind = 'pdf-original' AND is_deleted = 0 LIMIT 1",
    [String(itemId)]
  )[0];
  if (!row || !row.path) return null;
  try {
    const p = path.join(app.getPath("userData"), "assets", String(itemId), row.path);
    return new Uint8Array(fs.readFileSync(p));
  } catch {
    return null;
  }
}

// M6-3（v30）：被动兼容电子书（MOBI/AZW3/FB2/CBZ）直读——返回 {bytes, name}，
// name 为入库文件名（original.<ext>，扩展名保真：foliate makeBook 的 CBZ/FB2 判定依赖扩展名）。
function readEbookFile(itemId) {
  const row = queryAll(
    "SELECT path FROM assets WHERE library_item_id = ? AND kind = 'ebook-original' AND is_deleted = 0 LIMIT 1",
    [String(itemId)]
  )[0];
  if (!row || !row.path) return null;
  try {
    const p = path.join(app.getPath("userData"), "assets", String(itemId), row.path);
    return { bytes: new Uint8Array(fs.readFileSync(p)), name: String(row.path) };
  } catch {
    return null;
  }
}

// ---------- 卡片 / 制卡 / FSRS / Leech（Phase 3 + 13-16，v6/v8） ----------

function normalizeFsrs(json) {
  try {
    const p = json ? JSON.parse(json) : null;
    if (p && typeof p.due !== "undefined") return p;
  } catch { /* fallthrough */ }
  return { state: "new", due: Date.now(), lapses: 0 };
}

// 清单族统一入参归一（批次 A）：不得让分数/负数/字符串/NaN/±Infinity 直达 SQL 的 LIMIT/OFFSET。
// 语义沿用既有 `Number(x) || DEF`（0 / 空 / 非数 → 默认值，**不改这个语义**），
// 只补 Math.floor 保证整数——实测：limit 1.5 与 offset 1.5 都会让 sql.js 抛 datatype mismatch。
function clampLimit(limit, def, cap) {
  const n = Math.floor(Number(limit) || def);
  return Math.max(1, Math.min(cap, n)); // 有 cap 兜住 ±Infinity
}
function clampOffset(offset) {
  // ⚠️ 不能写成 Math.max(0, Math.floor(Number(offset) || 0))：Number(Infinity) 是 truthy，
  // Math.floor 后仍是 Infinity，Math.max(0, Infinity) 还是 Infinity → OFFSET Infinity 照样 datatype mismatch。
  // offset 没有 cap，必须显式判有限性并给上限。
  const n = Number(offset);
  return Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.floor(n))) : 0;
}

function mapCardRow(r) {
  if (!r) return null;
  // 批次 A：9 个 JSON 列文本损坏时回落空值并记录列名，绝不抛（"空"比"错"安全）。
  // 只有致命列（fsrs_json / leech_json = 调度与挂起状态无法判定）才把行标为 damaged。
  const bad = [];
  const j = (text, fallback, col) => {
    if (text === null || text === undefined || text === "") return fallback;
    try {
      const v = JSON.parse(text);
      return v === null || v === undefined ? fallback : v;
    } catch {
      bad.push(col);
      return fallback;
    }
  };
  let fsrsBad = false;
  if (r.fsrs_json) {
    try {
      const f = JSON.parse(r.fsrs_json);
      // A-2（审计 F34）：只验「能否 parse」不够。stability:-1 / difficulty:99 这类**形状合法但值域非法**
      // 的行会一路进队列，直到渲染层 fsrsEngine 抛 Invalid memory state 才炸，而唯一的错误边界在根上
      // → 整应用停止渲染。值域非法一律按损坏处理，走既有 damaged 降级链（卡片浏览仍看得到）。
      if (f === null || typeof f !== "object") {
        fsrsBad = true;
      } else {
        const lr = f.lastReview === null || f.lastReview === undefined ? null : Number(f.lastReview);
        const S = Number(f.stability), D = Number(f.difficulty), due = Number(f.due);
        // v48.22 修正（实测逼出）：**新卡豁免值域下界**——ts-fsrs 的新卡 S/D 恒为 0
        // （src/lib/fsrs.ts 明写「新卡的 S/D 合法为 0（首评前），不能无条件钳进 [1,10]」），
        // 而原判据不区分 state，会把这种合法新卡判成 damaged 并从队列**静默缺席**
        // （m12 夹具 17 条断言因此全红）。非新卡仍按原值域严格判定，F34 的保护不变。
        // isNewState 同源口径（P3 联动）：electron/legacyBackfill.js needsFsrsBaseline 的 S/D 回填判定
        // 用**同一表达式**，两处互为镜像——改一处必改另一处（漂移＝回填认新卡而本闸门认非新卡，
        // S/D=0 基线行会被判 damaged 从队列静默缺席）。
        const isNewState = f.state === "new" || f.state === undefined || f.state === null;
        const bad =
          (f.stability !== undefined && !(Number.isFinite(S) && (isNewState ? S >= 0 : S > 0))) ||
          (f.difficulty !== undefined && !(Number.isFinite(D) && D >= (isNewState ? 0 : 1) && D <= 10)) ||
          (f.due !== undefined && !Number.isFinite(due)) ||
          (lr !== null && !Number.isFinite(lr)) ||
          (f.lapses !== undefined && !(Number(f.lapses) >= 0)) ||
          (f.reps !== undefined && !(Number(f.reps) >= 0)) ||
          // 未来 lastReview（时钟回拨留下的存量形态）会让调度器算负 delta_t 直接抛错 → 视为损坏
          (lr !== null && lr > Date.now() + 24 * 3600 * 1000);
        if (bad) fsrsBad = true;
      }
    } catch {
      fsrsBad = true;
    }
  }
  const damagedColumns = fsrsBad ? ["fsrs_json", ...bad] : bad;
  return {
    id: r.id,
    noteText: r.note_text,
    cardType: r.card_type,
    clozeOrds: j(r.cloze_ords, [], "cloze_ords"),
    cardOrd: r.card_ord,
    frontMarkdown: r.front_markdown,
    backMarkdown: r.back_markdown,
    contextPrefix: r.context_prefix,
    contextRef: j(r.context_ref_json, null, "context_ref_json"),
    mnemonic: r.mnemonic,
    example: r.example,
    sourceRef: j(r.source_ref_json, null, "source_ref_json"),
    dateStamp: r.date_stamp,
    priority: r.priority,
    tags: j(r.tags_json, [], "tags_json"),
    domain: j(r.domain, [], "domain"),
    knowledgePointId: r.knowledge_point_id,
    occlusionJson: j(r.occlusion_json, null, "occlusion_json"),
    fsrs: normalizeFsrs(r.fsrs_json),
    fsrsConfigId: r.fsrs_config_id || null,
    leech: j(r.leech_json, null, "leech_json"),
    generatedBy: r.generated_by,
    genBatchId: r.gen_batch_id,
    dictJson: j(r.dict_json, null, "dict_json"),
    // v46（M14-UM2，§4.18-10）：记忆溯源（{line, verified}；NULL=未用记忆）
    memoryRefJson: j(r.memory_ref_json, null, "memory_ref_json"),
    siblingKey: r.sibling_key || null,
    // v48.60（D102，§4.1）：卡片生命周期（active/archived；NULL 视同 active）
    status: r.status || null,
    // v48.22（D58 §6.8-5）：卡片所属书（按书范围会话与浏览分组用；无来源卡为 null）
    libraryItemId: r.library_item_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    damaged: fsrsBad || damagedColumns.includes("leech_json"),
    damagedColumns
  };
}

// A-9（审计 F36）：原写法 `Number(x) || 50` 把**合法值 0** 当假值改成 50，
// 却同时放行 −5 / 9999 这类越界值（实测原样入库）。UI 明写「优先级（0-100，越高越先复习）」，
// 故归一为：有限数 → 四舍五入并钳进 [0,100]；非有限 → 回默认 50。
const PRIORITY_DEFAULT = 50;
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 100;
function normPriority(v) {
  // 只认「真正的数」与「非空数字字符串」。null / "" / [] / false 经 Number() 会变成 0，
  // 若直接采信就会被当成**合法的 0**，而 F13 的 P3 矩阵明确要求「非法类型回落 50」。
  let num;
  if (typeof v === "number") num = v;
  else if (typeof v === "string" && v.trim() !== "") num = Number(v);
  else return PRIORITY_DEFAULT;
  if (!Number.isFinite(num)) return PRIORITY_DEFAULT;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(num)));
}

function insertCard(card) {
  const id = card.id || crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO cards (id, user_id, note_text, card_type, cloze_ords, card_ord, front_markdown, back_markdown,
      context_prefix, context_ref_json, mnemonic, example, source_ref_json, date_stamp, priority, tags_json, domain,
      knowledge_point_id, occlusion_json, fsrs_json, fsrs_config_id, leech_json, generated_by, gen_batch_id,
      dict_json, memory_ref_json, sibling_key, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
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
      normPriority(card.priority),
      JSON.stringify(card.tags || []),
      JSON.stringify(sanitizeDomain(card.domain || [])),
      card.knowledgePointId || null,
      card.occlusionJson ? JSON.stringify(card.occlusionJson) : null,
      card.fsrsJson || null,
      // v23（§4.4.9 规则表）：createCard ✅ 写入当前活跃配置
      getActiveConfigId(),
      card.generatedBy || "manual",
      card.genBatchId || null,
      card.dictJson ? JSON.stringify(card.dictJson) : (card.dict_json || null),
      // v46（M14-UM2，§4.18-10）：记忆溯源（{line, verified}）
      card.memoryRefJson ? JSON.stringify(card.memoryRefJson) : null,
      // v34（M12）：同源组标识（§4.16）——只进队列视图，不进 FSRS
      card.siblingKey || null,
      now,
      now
    ]
  );
  return id;
}

function createCard(card) {
  // 批次 E（D-TEST-15 T3 档）：拒收「正文什么也没有」的空白卡。
  // 判据必须把 occlusionJson / clozeOrds / cloze 都算作"有内容"——图片挖空卡的 front 可能天然是空的
  // （src/lib/cards.ts:1072 传 occlusionJson、:1066 的 noteText 取 dd.front || cloze），拒宽了会误删合法卡。
  // **不抛错**：AI 批量制卡是多草稿循环 await 且没有逐卡 try/catch（Reader.tsx:1525-1546），
  // 抛错会中断整批；返回 false 让调用方零改动即可继续。
  const c = card || {};
  const hasContent =
    Boolean(String(c.frontMarkdown ?? "").trim()) ||
    Boolean(String(c.backMarkdown ?? "").trim()) ||
    Boolean(String(c.noteText ?? "").trim()) ||
    Boolean(c.occlusionJson || c.occlusion_json) ||
    (Array.isArray(c.clozeOrds) ? c.clozeOrds.length > 0 : Boolean(c.clozeOrds)) ||
    Boolean(c.cloze);
  if (!hasContent) return false;
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
  // 批次 E（D-TEST-15 T1 档）：卡不存在（或已软删）时 UPDATE 影响 0 行却仍然 return true 是假成功。
  // 复用上面已经取出的 prev，不额外查一次库；返回 false，调用方零改动。
  if (!prev) return false;
  db.run(
    `UPDATE cards SET note_text=?, card_type=?, cloze_ords=?, card_ord=?, front_markdown=?, back_markdown=?,
      context_prefix=?, context_ref_json=?, mnemonic=?, example=?, source_ref_json=?, date_stamp=?, priority=?,
      tags_json=?, domain=?, knowledge_point_id=?, occlusion_json=?, fsrs_json=?, leech_json=?, dict_json=?, updated_at=? WHERE id=? AND is_deleted=0`,
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
      normPriority(card.priority),
      JSON.stringify(card.tags || []),
      card.domain !== undefined ? JSON.stringify(sanitizeDomain(card.domain || [])) : (prev ? JSON.stringify(prev.domain || []) : "[]"),
      card.knowledge_point_id || card.knowledgePointId || null,
      card.occlusion_json || (card.occlusionJson ? JSON.stringify(card.occlusionJson) : null),
      card.fsrs_json || (card.fsrs ? JSON.stringify(card.fsrs) : null) || (prev ? JSON.stringify(prev.fsrs) : null),
      card.leech_json || (card.leech ? JSON.stringify(card.leech) : null) || (prev ? JSON.stringify(prev.leech) : null),
      card.dictJson ? JSON.stringify(card.dictJson) : (card.dict_json || (prev && prev.dictJson ? JSON.stringify(prev.dictJson) : null)),
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

// ---------- v34（M12，D33/§4.16）：同源卡延后 Sibling Burying —— 「今日队列」唯一口径（§4.2-20） ----------
// 延后是队列视图而非调度写入：不写 fsrs_json、不改 due、不写 review_logs、不触发 leech。
// 撤销评分物理删除 review_logs → 组内当日额度自动回收（无需 unbury 维护）。

// settings.app.siblingBury（缺省全开；非法值回落默认）
function siblingBuryConfig() {
  const sb = (readSettings().app || {}).siblingBury || {};
  const intIn = (v, dflt, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : dflt);
  return {
    enabled: sb.enabled !== false,
    newCards: sb.newCards !== false,
    reviewCards: sb.reviewCards !== false,
    perDay: intIn(sb.perDay, 1, 20),
    sourceTextLimit: intIn(sb.sourceTextLimit, 300, 1000000)
  };
}

// 延后资格：learning/relearning 步进中的卡不参与（其 due 由学习步决定，延后会破坏步进）；
// new / review 分别受两个开关控制（对齐 Anki Bury new / Bury review siblings）
function buryEligible(card, cfg) {
  const st = card.fsrs?.state;
  if (st === "learning" || st === "relearning") return false;
  if (st === "new") return cfg.enabled && cfg.newCards;
  if (st === "review") return cfg.enabled && cfg.reviewCards;
  return false;
}

// 组内规范序：due 升序 → priority 降序 → created_at 升序 → id（确定性；与既有队列序兼容）
function queueMemberOrder(a, b) {
  const da = a.fsrs?.due ?? 0;
  const db = b.fsrs?.due ?? 0;
  if (da !== db) return da - db;
  const pa = a.priority ?? 50;
  const pb = b.priority ?? 50;
  if (pa !== pb) return pb - pa;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * 同源延后核心（数据推导，无副作用）：输入已映射的当日候选卡列表，返回 Map(cardId → 延后原因)。
 * 规则（§4.16 item 4）：当日剩余额度 = perDay − 组内当日已评分卡数（同一卡当日多次评分只记一张）；
 * 剩余 > 0 → 规范序前「剩余」张放行、其余延后；剩余 ≤ 0 → 全组（未评分的）延后。
 * 关键：已评分的兄弟卡**即使 due 已被 FSRS 移入未来（不在候选集里）也消耗当日额度**——
 * 内容今天已被考察过，同日再考兄弟卡就是泄题；故组内当日评分按 review_logs ⋈ cards.sibling_key 全量统计。
 */
function computeSiblingDeferred(cards, now) {
  const deferred = new Map();
  const cfg = siblingBuryConfig();
  if (!cfg.enabled) return deferred;
  const day0 = dayStartMs(now);
  const day1 = day0 + 86400000;
  // 组内今日已评分卡（按 sibling_key 汇总；已删卡不计入——删除即该卡一切事实退出）
  const reviewedRows = queryAll(
    `SELECT DISTINCT r.card_id AS id, c.sibling_key AS key
     FROM review_logs r JOIN cards c ON c.id = r.card_id
     WHERE r.reviewed_at >= ? AND r.reviewed_at < ? AND c.is_deleted = 0 AND c.sibling_key IS NOT NULL`,
    [day0, day1]
  );
  const reviewedByKey = new Map();
  for (const row of reviewedRows) {
    if (!reviewedByKey.has(row.key)) reviewedByKey.set(row.key, new Set());
    reviewedByKey.get(row.key).add(row.id);
  }
  const groups = new Map();
  for (const c of cards) {
    if (!c.siblingKey) continue;
    if (!groups.has(c.siblingKey)) groups.set(c.siblingKey, []);
    groups.get(c.siblingKey).push(c);
  }
  for (const [key, members] of groups) {
    const reviewedIds = reviewedByKey.get(key) ?? new Set();
    const reviewedCount = reviewedIds.size;
    const remaining = cfg.perDay - reviewedCount;
    const revealable = members
      .filter((m) => buryEligible(m, cfg) && !reviewedIds.has(m.id))
      .sort(queueMemberOrder);
    const keep = Math.max(0, Math.min(remaining, revealable.length));
    if (keep >= revealable.length) continue;
    // 延后原因锚点：优先指向今日已评分的兄弟卡；额度未耗尽时指向本次放行的卡
    const reviewedAnchorId = reviewedIds.values().next().value ?? null;
    let reviewedFront = "";
    if (reviewedAnchorId) {
      const row = queryAll("SELECT front_markdown AS f, note_text AS n FROM cards WHERE id = ?", [reviewedAnchorId])[0];
      reviewedFront = String(row?.f || row?.n || "").slice(0, 40);
    }
    const revealedAnchor = keep > 0 ? revealable[keep - 1] : null;
    const kind = reviewedCount > 0 ? "reviewed" : "revealed";
    const anchorCardId = reviewedCount > 0 ? reviewedAnchorId : revealedAnchor?.id ?? null;
    const anchorFront = reviewedCount > 0 ? reviewedFront : String(revealedAnchor?.frontMarkdown || revealedAnchor?.noteText || "").slice(0, 40);
    for (let i = keep; i < revealable.length; i++) {
      deferred.set(revealable[i].id, {
        siblingKey: key,
        kind,
        siblingCardId: anchorCardId,
        siblingFront: anchorFront
      });
    }
  }
  return deferred;
}

const TODAY_QUEUE_SQL = `SELECT c.*, li.title AS docTitle, li.id AS library_item_id FROM cards c
     LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0
       AND COALESCE(c.status, 'active') != 'archived'
     ORDER BY c.created_at ASC`;

/**
 * 今日队列视图（§4.2-20）：到期筛选（新卡 fsrs_json NULL 视为 due=now）+ 挂起排除 +
 * 同源组额度 + 规范序排序一次算完。now 可注入（测试跨日场景，同 §4.4.4 preview/next 时间注入精神）。
 */
function computeTodayQueue(now = Date.now()) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const rows = queryAll(TODAY_QUEUE_SQL);
  // 批次 A（D-TEST-06）：调度/挂起状态无法判定的行（fsrs_json 或 leech_json 损坏）从队列缺席，
  // 但经 damaged 字段照常可见——卡片浏览与 getCard 仍给出口，用户不会以为卡丢了。
  const mapped = rows.map(mapCardRow);
  const damaged = mapped.filter((c) => c && c.damaged);
  const ok = mapped
    .filter((c) => c && !c.damaged)
    .map((r) => ({ ...r, docTitle: r.docTitle || (r.sourceRef && r.sourceRef.title) || null }));
  const candidates = ok.filter((c) => {
    if (c.leech?.suspended) return false;
    return (c.fsrs?.due ?? nowMs) <= nowMs;
  });
  const deferredMap = computeSiblingDeferred(candidates, nowMs);
  const cards = candidates.filter((c) => !deferredMap.has(c.id)).sort(queueMemberOrder);
  const deferred = candidates
    .filter((c) => deferredMap.has(c.id))
    .sort(queueMemberOrder)
    .map((c) => ({ ...c, deferReason: deferredMap.get(c.id) }));
  return { cards, deferred, damaged, now: nowMs };
}

function listDueCards(now) {
  // v34（M12 §4.2-20）：口径唯一——队列 = computeTodayQueue().cards（同源延后在此生效）；
  // 旧排序（due 升序、同 due 优先级高在前，§11.5）由 queueMemberOrder 保持。
  return computeTodayQueue(now).cards;
}

function listAllCards() {
  // v19：补 docTitle JOIN（同 listDueCards）——卡片浏览页需要展示来源书并按书筛选
  // v48.67（D111）：补 li.id AS library_item_id 别名（此前缺别名 ⇒ 卡片行 libraryItemId 恒 null，
  // 浏览器「按所属书筛选」对闪卡恒空）+ 修复 JOIN docTitle 被 mapCardRow 丢弃（逐字段构造不透传
  // SQL 别名列，最终 docTitle 恒为 sourceRef 回落 ⇒ 旧路径 book: 查询只匹配 sourceRef 书名）——
  // 两处都是潜伏缺陷，主进程/meta 通道自始使用 JOIN 值，修复后新旧通道命中集一致（d111 对拍闸门）。
  const rows = queryAll(
    `SELECT c.*, li.title AS docTitle, li.id AS library_item_id FROM cards c
     LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0 ORDER BY c.created_at DESC`
  );
  return rows.map(mapCardRowWithDocTitle);
}

// ===== v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数 =====
// 求值引擎＝cardQuery.bundle.cjs（src/lib/cardQuery.ts 的 esbuild 单源产物）——渲染层/主进程/测试
// 三方消费同一份编译产物，命中集逐行一致由构造保证；禁止手改产物（新鲜度 tests/d111-artifact.test.cjs 把守）。
// 缓存失效＝库指纹（COUNT(*) + MAX(updated_at)；cards 全部写路径触碰 updated_at 的既有纪律在此成为契约前提）。
const cardQueryCore = require("./cardQuery.bundle.cjs");

const BROWSER_QUERY_CACHE_MAX = 4;
let browserFp = null;
let browserBaseMeta = null; // 全库轻量行集（行对象与查询缓存子集共享引用）
const browserQueryCache = new Map(); // fp + "\u0000" + query → 轻量行子集（LRU）

function cardsFingerprint() {
  const r = queryAll("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS m FROM cards")[0];
  return `${r.n}:${r.m}`;
}

function safeParseObj(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function safeParseArr(text) {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 轻量行（无题面/答案/备注大列）。fsrs/leech 损坏回落 new/false（与 normalizeFsrs / mapCardRow 同口径）。 */
function cardMetaRow(r) {
  const fsrs = safeParseObj(r.fsrs_json);
  const leech = safeParseObj(r.leech_json);
  const cr = safeParseObj(r.context_ref_json);
  let docTitle = r.docTitle || null;
  if (!docTitle) {
    const sr = safeParseObj(r.source_ref_json);
    docTitle = sr && sr.title ? String(sr.title) : null; // 与 listAllCards 的 mapCardRow 修补同口径
  }
  return {
    id: r.id,
    bookId: r.library_item_id ?? null,
    docTitle,
    extractId: cr && cr.extractId ? String(cr.extractId) : null,
    priority: r.priority,
    status: r.status || null,
    cardType: r.card_type,
    fsrsState: fsrs && typeof fsrs.state === "string" ? fsrs.state : "new",
    suspended: Boolean(leech && leech.suspended),
    isLeech: Boolean(leech && leech.isLeech),
    due: fsrs && Number.isFinite(Number(fsrs.due)) ? Number(fsrs.due) : null,
    lapses: fsrs && Number.isFinite(Number(fsrs.lapses)) ? Number(fsrs.lapses) : 0,
    reps: fsrs && Number.isFinite(Number(fsrs.reps)) ? Number(fsrs.reps) : 0,
    mem: r.memory_ref_json ? 1 : 0,
    createdAt: r.created_at
  };
}

/** 求值行视图（喂 makeCardPredicates；tags/domain 惰性构造——无文本/tag 条件不花解析的钱） */
function evalViewOf(r, m) {
  const cached = {};
  return {
    frontMarkdown: r.front_markdown,
    backMarkdown: r.back_markdown,
    noteText: r.note_text,
    contextPrefix: r.context_prefix || "",
    cardType: m.cardType,
    status: m.status,
    priority: m.priority,
    fsrsState: m.fsrsState,
    leechSuspended: m.suspended,
    docTitle: r.docTitle || m.docTitle || "",
    get tags() {
      return (cached.tags ??= safeParseArr(r.tags_json));
    },
    get domain() {
      return (cached.domain ??= safeParseArr(r.domain));
    }
  };
}

/** 纯字段条件（无 text/tag leaf）在轻量行集上求值——行视图不携带内容列，makeCardPredicates 的
 *  惰性 hay/tags 在此分支永远不会被触达（调用方先用 hasTextOrTagLeaf 分流）。 */
function metaEvalView(m) {
  return {
    frontMarkdown: null,
    backMarkdown: null,
    noteText: null,
    contextPrefix: "",
    cardType: m.cardType,
    status: m.status,
    priority: m.priority,
    fsrsState: m.fsrsState,
    leechSuspended: m.suspended,
    docTitle: m.docTitle,
    tags: null,
    domain: null
  };
}

function hasTextOrTagLeaf(node) {
  if (!node) return false;
  if (node.t === "leaf") return node.leaf.f === "text" || node.leaf.f === "tag";
  if (node.t === "not") return hasTextOrTagLeaf(node.kid);
  return node.kids.some(hasTextOrTagLeaf);
}

const BROWSER_JOIN = `FROM cards c
  LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
  LEFT JOIN library_items li ON li.id = d.library_item_id
  WHERE c.is_deleted = 0`;

// D137：better-sqlite3 惰性迭代游标分块消费——30 万行全量物化会把主进程顶上 GB 级，
// 峰值内存必须钳在一个 chunk（await nextTick() 让出点语义与 sql.js 步进时代一致）
function nextTick() {
  return new Promise((res) => setImmediate(res));
}

async function scanCards(sql, params, handleRow) {
  let n = 0;
  const iter = db.prepare(sql).iterate(normParams(params));
  try {
    for (const row of iter) {
      handleRow(row);
      if (++n % 2000 === 0) await nextTick();
    }
  } finally {
    iter.return?.(); // 提前退出时关闭游标（等价旧 stmt.free()）
  }
  return n;
}

function packBooks(meta) {
  const books = [];
  const seen = new Set();
  for (const m of meta) {
    if (m.bookId && !seen.has(m.bookId)) {
      seen.add(m.bookId);
      books.push({ id: m.bookId, title: m.docTitle || "未知材料" });
    }
  }
  books.sort((a, b) => a.title.localeCompare(b.title));
  return books;
}

/** 全库轻量行集（cards:listMeta）。缓存命中毫秒级；失效按库指纹重建。 */
async function getCardBrowserMeta() {
  const fp = cardsFingerprint();
  if (browserBaseMeta && browserFp === fp) {
    return { fp, total: browserBaseMeta.length, meta: browserBaseMeta, books: packBooks(browserBaseMeta) };
  }
  const meta = [];
  await scanCards(
    `SELECT c.id, c.priority, c.status, c.card_type, c.fsrs_json, c.leech_json,
            c.memory_ref_json, c.context_ref_json, c.source_ref_json, c.created_at,
            li.id AS library_item_id, li.title AS docTitle
     ${BROWSER_JOIN}
     ORDER BY c.created_at DESC`,
    [],
    (r) => meta.push(cardMetaRow(r))
  );
  browserFp = fp;
  browserBaseMeta = meta;
  browserQueryCache.clear();
  return { fp, total: meta.length, meta, books: packBooks(meta) };
}

/** 查询求值（cards:queryIds）。按（库指纹, 查询串）LRU 缓存；纯字段条件走轻量行集，
 *  含文本/tag 条件才分块扫描内容列（求值引擎与渲染层同一份产物，命中集逐行一致）。 */
async function queryCardBrowserIds(query) {
  const q = String(query ?? "");
  const fp = cardsFingerprint();
  const key = fp + "\u0000" + q;
  if (browserQueryCache.has(key)) {
    const meta = browserQueryCache.get(key);
    browserQueryCache.delete(key);
    browserQueryCache.set(key, meta); // LRU 触达刷新
    return { fp, meta };
  }
  const parsed = cardQueryCore.parseCardQuery(q);
  let out;
  if (!parsed.ast) {
    out = (await getCardBrowserMeta()).meta;
  } else if (!hasTextOrTagLeaf(parsed.ast)) {
    const base = (await getCardBrowserMeta()).meta;
    out = base.filter((m) => cardQueryCore.cardRowMatches(parsed, metaEvalView(m)));
  } else {
    const meta = [];
    await scanCards(
      `SELECT c.id, c.priority, c.status, c.card_type, c.fsrs_json, c.leech_json,
              c.memory_ref_json, c.context_ref_json, c.source_ref_json, c.created_at,
              c.front_markdown, c.back_markdown, c.note_text, c.context_prefix, c.tags_json, c.domain,
              li.id AS library_item_id, li.title AS docTitle
       ${BROWSER_JOIN}
       ORDER BY c.created_at DESC`,
      [],
      (r) => {
        const m = cardMetaRow(r);
        if (cardQueryCore.cardRowMatches(parsed, evalViewOf(r, m))) meta.push(m);
      }
    );
    out = meta;
  }
  browserQueryCache.set(key, out);
  while (browserQueryCache.size > BROWSER_QUERY_CACHE_MAX) {
    browserQueryCache.delete(browserQueryCache.keys().next().value);
  }
  return { fp, meta: out };
}

const CARD_FULL_SELECT = `SELECT c.*, li.title AS docTitle, li.id AS library_item_id FROM cards c
  LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
  LEFT JOIN library_items li ON li.id = d.library_item_id`;

function withDocTitleFallback(r) {
  // mapCardRow 逐字段构造不透传 SQL 别名列（docTitle/library_item_id 需从原始行回补；
  // library_item_id 已在 mapCardRow 内消费，docTitle 在此回补——JOIN 书名优先、sourceRef 书名回落）
  const mapped = mapCardRow(r);
  return { ...mapped, docTitle: r.docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null };
}
const mapCardRowWithDocTitle = withDocTitleFallback;

/** 行窗口（cards:getWindow）：按 id 取全行，≤500/次，返回按入参 id 序排列。 */
function getCardsWindow(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 500);
  if (list.length === 0) return [];
  const byId = new Map();
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const rows = queryAll(`${CARD_FULL_SELECT} WHERE c.is_deleted = 0 AND c.id IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows) byId.set(r.id, r);
  }
  return list
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(withDocTitleFallback);
}

/** 卡详情同源组行（cards:siblingGroup）。 */
function listCardsBySibling(key) {
  const rows = queryAll(`${CARD_FULL_SELECT} WHERE c.is_deleted = 0 AND c.sibling_key = ? ORDER BY c.created_at DESC`, [
    String(key || "")
  ]);
  return rows.map(withDocTitleFallback);
}

/** 浏览器侧今日暂缓（cards:deferredToday）：调度语义唯一源仍是 computeTodayQueue（§4.16），
 *  这里只消除全量卡行的 IPC 传输——返回暂缓 id + 延后原因。 */
function listDeferredToday(now) {
  const n = Number(now);
  return computeTodayQueue(Number.isFinite(n) ? n : Date.now()).deferred.map((c) => ({ id: c.id, deferReason: c.deferReason }));
}

function deleteCard(id) {
  // 批次 E（D-TEST-15 T1 档）：卡不存在或已软删时返回 false（原来无条件 true = 假"已删除"）。
  if (!rowExists("cards", id)) return false;
  db.run("UPDATE cards SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), id]);
  db.run("UPDATE card_issues SET status = 'dismissed', resolved_at = ? WHERE card_id = ? AND status = 'open'", [Date.now(), id]);
  persist();
  return true;
}

// v23（§4.4.9）：评分落库事务化——BEGIN → 日志+卡状态 → COMMIT → persist（COMMIT 后持久化）。
// review 成功边界 = COMMIT + persist 成功 + IPC 成功；persist 失败 throw → IPC reject →
// UI 停留当前卡并经 persistNow 重试（内存已提交、禁止重复评分）；禁止自动 rollback。
// 快照集：before（v22）/after/leech_before/评分所用 config/评分前 config/review_seq。
function saveReview(cardId, fsrsState, rating, durationMs, fsrsBefore) {
  const card = getCard(cardId);
  if (!card) throw new Error("卡片不存在");
  // A-7（审计 F35）：写入口必须挡住「同一次呈现被计入两次」。
  // persist() 是在 COMMIT **之后**才调的（见本函数尾部），磁盘满/杀软占用会让它抛错，而那时行已提交；
  // 渲染层据此停在原卡，用户点「重试保存」清掉错误位后能再评一次 —— 它手里握的还是**评分前**快照，
  // 于是多出一条 review_logs，且 cards.fsrs.reps 与日志行数从此不再相等（实测 1 vs 2）。
  // review_logs 是 FSRS 参数优化的训练数据（§4.4.8），会被污染。
  // 判据取「卡态是否已前进」而非逐字段全等，避免把浮点表示差异误判成陈旧写。
  // A-1 的写侧校验**刻意不做**：§4.4.3 v20 明确支持「时间注入」（fsrsEngine.preview/next 可传显式 now），
  // M3 时间轴模拟正是靠它把历史推到未来数月（F14 的月桶模拟即此用法）。
  // 在这里拒绝未来 lastReview 会直接废掉那条文档化的能力（实测 F14/F34 双双崩）。
  // 生产路径不可能产出未来值（引擎已把未来 last_review 钳到 now），读侧另有 A-2 值域闸门兜底。
  if (fsrsBefore) {
    const cur = card.fsrs || {};
    const advanced =
      (Number(cur.reps) || 0) > (Number(fsrsBefore.reps) || 0) ||
      (Number(cur.lastReview) || 0) > (Number(fsrsBefore.lastReview) || 0);
    if (advanced) throw new Error("评分被拒：该卡的调度状态已前进（同一次呈现被重复提交）。请刷新后重试。");
  }
  const now = Date.now();
  // D137（§3.3 加固①）：BEGIN IMMEDIATE（原 saveReview 序列并入 withTransaction 同款语义：
  // COMMIT 后 persist，persist 失败时内存已提交、禁止重复评分、经 persistNow 重试）
  db.run("BEGIN IMMEDIATE");
  try {
    // review_seq 分配**保持原语义不变**（§4.4.9 排序不变量：表内唯一、插入序单调、撤销删除后允许复用）。
    // 注意：v48.22 起 op_journal 另用独立的 op_counter 计数器——跨类撤销排序靠 journal，
    // 不靠 review_seq，因此这里**不共享计数器**（共享会在 review_logs 里留下空洞，
    // 破坏「撤销只删最大 seq ⇒ 序号稠密」这一既有可测性质，F38-8j 即其代理断言）。
    const seq = (queryAll("SELECT COALESCE(MAX(review_seq), 0) AS m FROM review_logs")[0]?.m || 0) + 1;
    const logId = crypto.randomUUID();
    db.run(
      "INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, fsrs_before_json, fsrs_after_json, leech_before_json, fsrs_config_id, fsrs_before_config_id, review_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        logId,
        cardId,
        rating,
        now,
        durationMs || null,
        // v22：评分前 FSRS 全字段快照（未传则 NULL，该条不可撤销）
        fsrsBefore ? JSON.stringify(fsrsBefore) : null,
        // v23：评分后全字段快照（Undo 一致性校验 + 审计事实）
        JSON.stringify(fsrsState),
        // v23/F10：评分前 leech 快照（撤销时精确恢复，禁止以「当前挂起」推断）
        card.leech ? JSON.stringify(card.leech) : null,
        // v23/D20：本次评分所用参数配置 + 评分前状态归属
        getActiveConfigId(),
        card.fsrsConfigId || null,
        seq
      ]
    );
    // v48.22（D58）：跨类撤销排序索引（载荷仍在 review_logs，本表只排「最近一次操作是哪一类」）。
    // journal 的 seq 取独立计数器，**不复用 review_seq**——两者语义相互独立（见 nextOpSeq 注释）
    db.run("INSERT INTO op_journal (seq, kind, ref, undoable, created_at) VALUES (?, 'card_grade', ?, 1, ?)", [
      nextOpSeq(),
      logId,
      now
    ]);
    db.run("UPDATE cards SET fsrs_json = ?, fsrs_config_id = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(fsrsState),
      getActiveConfigId(),
      now,
      cardId
    ]);
    db.run("COMMIT");
  } catch (e) {
    try { db.run("ROLLBACK"); } catch { /* 回滚失败仅吞并，避免掩盖原异常 */ }
    throw e;
  }
  persist();
  return true;
}

// FSRS 持久化契约字段（§4.4.1）——Undo 一致性校验按此全字段逐项比较，禁止实现者自选范围
const FSRS_PERSIST_FIELDS = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];

// 单字段等值：数值/字符串用 ===；learningSteps 等数组/对象字段用 JSON 序列化比较
//（数组按引用比较永远不等——learningSteps:[] 曾致一致性校验恒假）
function fsrsFieldValueEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function fsrsStatesEqual(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  for (const k of FSRS_PERSIST_FIELDS) {
    if (!fsrsFieldValueEqual(a[k] ?? null, b[k] ?? null)) return false;
  }
  return true;
}

// v22/v23 撤销评分：最近一条「有评分前快照且有评分后快照且卡未删且卡当前状态==评分后状态」的日志。
// v23 起排序不变量 = review_seq（表内唯一、插入序单调；禁按 id/reviewed_at 排序）；
// 旧日志（v22 及以前，无 fsrs_after_json）与状态不一致的日志均按 §4.4.9 不可撤销（UI 不出现撤销按钮）。
function getLastUndoableReview() {
  const rows = queryAll(
    `SELECT r.id AS logId, r.card_id AS cardId, r.rating, r.reviewed_at AS reviewedAt, r.review_seq AS reviewSeq
     FROM review_logs r JOIN cards c ON c.id = r.card_id AND c.is_deleted = 0
     WHERE r.fsrs_before_json IS NOT NULL AND r.fsrs_after_json IS NOT NULL
     ORDER BY r.review_seq DESC LIMIT 1`
  );
  const log = rows[0];
  if (!log) return null;
  const card = getCard(log.cardId);
  if (!card) return null;
  let after;
  try {
    after = JSON.parse(queryAll("SELECT fsrs_after_json AS a FROM review_logs WHERE id = ?", [log.logId])[0]?.a || "");
  } catch {
    return null;
  }
  if (!fsrsStatesEqual(card.fsrs, after)) return null;
  return log;
}

// v23 撤销评分（§4.4.9：复习回退而非附加动作）——事务内恢复评分前确切状态：
// fsrs_json←before、fsrs_config_id←before_config_id；leech 回退仅在「本次评分触发」时执行
// （触发判定复现 ReviewView 条件：after.lapses≥8 且评分前非 leech——禁止以「当前 suspended」推断，F10）；
// 日志物理删除（review_logs 无软删，撤销即该次复习从未发生，优化器/统计自动干净）
function undoLastReview() {
  const log = getLastUndoableReview();
  if (!log) return { ok: false, reason: "没有可撤销的评分" };
  const card = getCard(log.cardId);
  if (!card) return { ok: false, reason: "卡片不存在" };
  const rows = queryAll(
    "SELECT fsrs_before_json AS snap, fsrs_after_json AS afterSnap, leech_before_json AS leechSnap, fsrs_before_config_id AS beforeCfg FROM review_logs WHERE id = ?",
    [log.logId]
  );
  let before;
  let after;
  let leechBefore;
  let beforeCfg;
  try {
    before = JSON.parse(rows[0]?.snap || "");
    after = JSON.parse(rows[0]?.afterSnap || "");
    leechBefore = rows[0]?.leechSnap ? JSON.parse(rows[0].leechSnap) : null;
    beforeCfg = rows[0]?.beforeCfg || null;
  } catch {
    return { ok: false, reason: "评分快照损坏，无法撤销" };
  }
  if (!before || typeof before !== "object") return { ok: false, reason: "评分前快照损坏，无法撤销" };
  // §4.4.9 不变量：卡当前 fsrs 必须与该日志评分后状态 8 字段全等才可撤销（防回退错版本）
  if (!fsrsStatesEqual(card.fsrs, after)) {
    return { ok: false, reason: "卡片当前状态与该次评分结果不一致，不可撤销" };
  }
  // leech 触发判定（复现复习端触发条件，评分时点数据）
  const triggeredLeech = (after?.lapses ?? 0) >= 8 && !(leechBefore && leechBefore.isLeech === true);
  db.run("BEGIN IMMEDIATE"); // D137（§3.3 加固①）：同 withTransaction
  try {
    db.run("UPDATE cards SET fsrs_json = ?, fsrs_config_id = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(before),
      beforeCfg,
      Date.now(),
      log.cardId
    ]);
    if (triggeredLeech) {
      db.run("UPDATE cards SET leech_json = ? WHERE id = ?", [
        leechBefore ? JSON.stringify(leechBefore) : null,
        log.cardId
      ]);
      db.run(
        "UPDATE card_issues SET status = 'dismissed', resolved_at = ? WHERE card_id = ? AND rule_id = 'LEECH' AND status = 'open'",
        [Date.now(), log.cardId]
      );
    }
    db.run("DELETE FROM review_logs WHERE id = ?", [log.logId]);
    db.run("COMMIT");
  } catch (e) {
    try { db.run("ROLLBACK"); } catch { /* 回滚失败仅吞并，避免掩盖原异常 */ }
    throw e;
  }
  persist();
  return { ok: true, card: getCard(log.cardId), rating: log.rating };
}

// v12：优化器读取全部复习日志；v23 附带参数归属与插入序（audit/测试用）
// 批次 B（D-TEST-21）：排序不变量 = review_seq（§4.4.9：表内唯一、插入序单调，禁按 id/reviewed_at 排序）。
// 墙钟一跳（NTP 校时 / 改时区 / 恢复旧备份）时按 reviewed_at 会给出错序，审计分段与「首次达成」随之偏。
function listAllReviewLogs() {
  const rows = queryAll("SELECT card_id AS cardId, rating, reviewed_at AS reviewedAt, fsrs_config_id AS fsrsConfigId, review_seq AS reviewSeq FROM review_logs ORDER BY review_seq ASC");
  return rows;
}

// v23：受限裸 SQL 出口——仅供测试（构造 v22 形态历史日志等）与一次性迁移脚本使用；
// 业务代码禁止绕过仓储层直接写库（§7.1 sql.js 并发纪律）
function execRawSql(sql, params = []) {
  db.run(sql, params);
  return true;
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
  // 批次 E（D-TEST-15 T1 档）：reading_events 自己没有软删位，校验挂在父表 library_items 上；
  // 任意 itemId 都能插事件的话，统计侧迟早出现无人认领的字数。返回 false 不抛错。
  if (!rowExists("library_items", itemId)) return false;
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
  // D-TEST-74：原来把任意 patch 原样合并落盘——实测 lapses:-999、hitCount:1e15、非布尔的 isLeech
  // 都能写进去，而下游是靠这些字段做判定（lapses >= 阈值 ⇒ 判为遗忘卡；hitCount 进统计），
  // 脏值会把判定整体带偏且无任何报错。对已知字段做值域校验，非法即拒绝。
  const patch = leechPatch && typeof leechPatch === "object" ? leechPatch : null;
  if (!patch) return null;
  const NUM_MAX = 1e6;
  const numOk = (v) => v === undefined || (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= NUM_MAX);
  const boolOk = (v) => v === undefined || typeof v === "boolean";
  if (!numOk(patch.lapses) || !numOk(patch.hitCount) || !boolOk(patch.isLeech) || !boolOk(patch.suspended)) return null;
  const leech = { ...(card.leech || {}), ...patch };
  db.run("UPDATE cards SET leech_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(leech), Date.now(), cardId]);
  persist();
  return true;
}

function resolveLeech(cardId, resolution, updates) {
  const card = getCard(cardId);
  if (!card) return null;
  const leech = { isLeech: false, resolution, resolvedAt: Date.now() };
  // A-3（审计）：原注释写「resolveLeech 的 reset 路径重写了 FSRS 状态」，但代码是**无条件**重写，
  // 而两个调用方传的是 "reworded"（改写后恢复）与 "resumed"（仅恢复·不重置）—— 都不该重置排期。
  // 结果：一张积累数月排期的卡，点「仅恢复」就回到新卡 / 复习次数清零 / due 变成现在，无确认无撤销。
  // 改为只在显式 "reset" 时重写 fsrs_json；其余路径保留原排期（这正是「不重置」的字面承诺）。
  const leechResetsSchedule = resolution === "reset";
  db.run(
    `UPDATE cards SET leech_json=?, front_markdown=COALESCE(?, front_markdown), back_markdown=COALESCE(?, back_markdown),
      mnemonic=COALESCE(?, mnemonic), priority=COALESCE(?, priority), tags_json=?` +
      (leechResetsSchedule ? ", fsrs_json=?, fsrs_config_id=?" : "") +
      `, updated_at=? WHERE id=?`,
    [
      JSON.stringify(leech),
      updates?.frontMarkdown || null,
      updates?.backMarkdown || null,
      updates?.mnemonic || null,
      updates?.priority ?? null,
      JSON.stringify(updates?.tags || card.tags || []),
      ...(leechResetsSchedule ? [JSON.stringify({ state: "new", due: Date.now(), lapses: 0 }), getActiveConfigId()] : []),
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
  // 批次 E（D-TEST-15 T3 档）：card_issues 没有软删位，父卡必须真实存在才收（幽灵父行会留下
  // 无人认领的待办）。返回 false 不抛错——lint 侧是批量写入。
  if (!rowExists("cards", issue && issue.cardId)) return false;
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

// D121 §1.2：card_links —— 卡片辨析链接（只读展示用，不参与 FSRS / 队列）
const CARD_LINK_VERDICTS = ["missing-qualifier", "one-wrong", "duplicate", "confusable", "no-conflict", "insufficient", "manual"];

function normalizeCardLinkVerdictNote(verdict, note) {
  if (typeof verdict !== "string" || !CARD_LINK_VERDICTS.includes(verdict)) throw new Error("cardLinks: verdict 非法");
  const n = note == null ? "" : String(note).slice(0, 500);
  return { verdict, note: n };
}

function addCardLink(input) {
  const p = input && typeof input === "object" ? input : {};
  const cardA = p.cardA;
  if (typeof cardA !== "string" || !cardA.trim()) throw new Error("cardLinks: cardA 必须是非空字符串");
  const cardB = p.cardB == null ? null : p.cardB;
  if (cardB !== null && (typeof cardB !== "string" || !cardB.trim())) throw new Error("cardLinks: cardB 必须是非空字符串或 null");
  if (cardB === cardA) throw new Error("cardLinks: cardB 不能等于 cardA");
  const { verdict, note } = normalizeCardLinkVerdictNote(p.verdict, p.note);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO card_links (id, user_id, card_a, card_b, kind, verdict, note, created_at, updated_at, sync_version, is_deleted) VALUES (?, 'local-user', ?, ?, 'disambiguated', ?, ?, ?, ?, 0, 0)",
    [id, cardA, cardB, verdict, note, now, now]
  );
  persist();
  return id;
}

function updateCardLink(id, patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  const { verdict, note } = normalizeCardLinkVerdictNote(p.verdict, p.note);
  if (!rowExists("card_links", id)) return false;
  db.run("UPDATE card_links SET verdict = ?, note = ?, updated_at = ?, sync_version = sync_version + 1 WHERE id = ? AND is_deleted = 0", [verdict, note, Date.now(), String(id)]);
  persist();
  return true;
}

function listCardLinksForCard(cardId) {
  const cid = String(cardId ?? "");
  if (!cid) return [];
  const links = queryAll(
    "SELECT * FROM card_links WHERE is_deleted = 0 AND (card_a = ? OR card_b = ?) ORDER BY updated_at DESC, created_at DESC",
    [cid, cid]
  );
  const out = [];
  for (const l of links) {
    let other = null;
    if (l.card_b != null) {
      const otherId = l.card_a === cid ? l.card_b : l.card_a;
      const r = queryAll(`${CARD_FULL_SELECT} WHERE c.id = ? AND c.is_deleted = 0`, [otherId])[0];
      if (!r) continue; // 对端不存在/已软删：不返回
      const m = withDocTitleFallback(r);
      const front = String(m.frontMarkdown || m.noteText || "").replace(/\s+/g, " ").trim().slice(0, 60);
      other = { id: otherId, front, docTitle: m.docTitle || null };
    }
    out.push({
      id: l.id,
      cardA: l.card_a,
      cardB: l.card_b ?? null,
      verdict: l.verdict ?? null,
      note: l.note ?? "",
      createdAt: l.created_at,
      updatedAt: l.updated_at,
      other
    });
  }
  return out;
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

// A-10（审计 F36）：ai_gen_batches 此前只有 INSERT/UPDATE —— 全仓零 SELECT、无 IPC、preload 无出口，
// 于是用户关掉生成窗口后，那批**已经花过钱**的草稿在库里却永远取不回来（违反 §4.3-⑦ 与 §7.1.4）。
// 补两个只读出口：按 id 取单条、按状态列最近若干条。
function mapAIGenBatchRow(r) {
  const j = (text, fallback) => {
    if (!text) return fallback;
    try { const v = JSON.parse(text); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
  };
  return {
    id: r.id,
    scope: r.scope,
    sourceText: r.source_text,
    context: j(r.context_json, null),
    promptTemplateId: r.prompt_template_id || null,
    result: j(r.result_json, null),
    status: r.status,
    createdAt: r.created_at,
  };
}

function getAIGenBatch(id) {
  const row = queryAll("SELECT * FROM ai_gen_batches WHERE id = ?", [String(id)])[0];
  return row ? mapAIGenBatchRow(row) : null;
}

function listAIGenBatches(opts = {}) {
  const lim = clampLimit(opts.limit, 50, 500);
  const status = opts.status ? String(opts.status) : null;
  const rows = status
    ? queryAll("SELECT * FROM ai_gen_batches WHERE status = ? ORDER BY created_at DESC LIMIT ?", [status, lim])
    : queryAll("SELECT * FROM ai_gen_batches ORDER BY created_at DESC LIMIT ?", [lim]);
  return rows.map(mapAIGenBatchRow);
}

function setAIGenBatchStatus(id, status) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在时不再返回真的「已删除 / 已保存」（该表没有软删位，rowExists 传 false）。
  if (!rowExists("ai_gen_batches", id, false)) return false;
  db.run("UPDATE ai_gen_batches SET status = ? WHERE id = ?", [status, id]);
  persist();
  return true;
}

// v48.61（D103，D94 设计稿 §3.2）：卡详情「生成信息区」只读 join——card + 生成批次 + 提示词 + 当时 CardLint 结果。
// 零写路径零 persist（A-10 只读出口纪律）；card 不存在返回 null。批次模型名为 generateCards 装配时
// 写入 context_json.model 的快照（v48.61 起才有），存量批次如实返回 null（前端显示「—」，不猜）。
function getCardGenInfo(cardId) {
  const card = getCard(String(cardId || ""));
  if (!card) return null;
  let batch = null;
  if (card.genBatchId) {
    const row = queryAll(
      "SELECT id, scope, context_json, prompt_template_id, status, created_at FROM ai_gen_batches WHERE id = ?",
      [String(card.genBatchId)]
    )[0];
    if (row) {
      let ctx = null;
      try {
        ctx = row.context_json ? JSON.parse(row.context_json) : null;
      } catch {
        ctx = null; // 坏 JSON 不抛：模型名缺失照常展示
      }
      batch = {
        id: row.id,
        scope: row.scope,
        status: row.status,
        createdAt: row.created_at,
        model: ctx && typeof ctx === "object" && ctx.model ? String(ctx.model) : null,
        promptTemplateId: row.prompt_template_id || null
      };
    }
  }
  let template = null;
  if (batch && batch.promptTemplateId) {
    const t = queryAll(
      "SELECT id, scope, name, version, is_default, created_at FROM prompt_templates WHERE id = ?",
      [String(batch.promptTemplateId)]
    )[0];
    if (t) {
      template = {
        id: t.id,
        scope: t.scope,
        name: t.name,
        version: t.version,
        isDefault: !!t.is_default,
        createdAt: t.created_at
      };
    }
  }
  const issues = listCardIssues(card.id);
  return { card, batch, template, issues };
}

function ensurePromptTemplates() {
  const now = Date.now();
  // 播种：按 scope 查最新 version，低于目标版本才插入新版本（旧版本保留作留痕）
  // v2 变更：CARD_GEN_PROMPT 新增【领域标注】段与 domain 输出字段（UDC 受控清单）
  // v3 变更：R13 新增 hint 禁令——禁用 {{c1::答案::提示}} 第三段，禁止答案拆两半（正面曾泄漏半个答案）
  // v4 变更（v30 D27）：R13 新增一卡多空两形态——clozeMode together（同答，缺省）/ per-blank（分答，系统自动拆卡）；
  //   输出 schema 增 clozeMode 字段；card-enum 注明组内挖空属同答
  // v5 变更（v30 D29）：R19 归属锚强制——论证/理论/学说/观点性内容一律带提出者锚（front 或 contextPrefix），
  //   内容与归属拆卡；card-occlusion v3 同步增归属锚条款
  // v6 变更（v31，M1 v4 候选经用户确认并回）：
  //   ① G9 退出红线取消（改为「值得记才做、可以少做但不做空」）；
  //   ② G5/G6/G7 完善（R18 数字克制改为无数值门槛的软引导——「≥2 个数字即不合格」经用户反馈过严已取消；
  //      R19 归属措辞可字面识别；R2/R5 合格线措辞，对齐本地 CardLint 新增的 L16 宽容度标注）；
  //   ③ card-literature 由序列模板占位改为**专用文学模板**（此前 CARD_LITERATURE_PROMPT 写了却无人引用，属死代码）。
  // 目标版本统一升到 6——v5 已被 v30 两批占用，存量库必须有更高版本号才会补播新内容。
  // v46（M14-UM2，§4.18-13）统一升到 7：组装 R20 记忆情境接地段（v6 基础文本不变，旧版本行留痕）。
  // v8（D121，v48.77）统一升到 8：R21 限定完整性（归属/应然实然/时空范围/框架口径四层）+ 输出字段 qualifier
  //   + 自检「限定排查」；请求装配新增【前后文】【相关已有卡】块（模板外注入）。旧版本行留痕。
  const TARGET_VERSION = 8;
  const seedScope = (scope, name, content) => {
    const rows = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = ?", [scope]);
    if (Number(rows[0]?.v || 0) >= TARGET_VERSION) return;
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      [crypto.randomUUID(), scope, name, content, TARGET_VERSION, situationRequiredFor(scope), now]
    );
  };
  seedScope("card-generation", "主制卡 v8", CARD_GEN_PROMPT);
  seedScope("card-formula", "公式分解 v8", CARD_FORMULA_PROMPT);
  seedScope("card-seq", "序列/背诵 v8", CARD_SEQ_PROMPT);
  seedScope("card-enum", "枚举拆解 v8", CARD_ENUM_PROMPT);
  // card-literature：专用文学模板（v31 修复死代码；v30 的序列占位行保留留痕）
  seedScope("card-literature", "文学/诗歌背诵 v8（专用模板）", CARD_LITERATURE_PROMPT);
  seedScope("card-mnemonic", "助记双卡 v8", CARD_MNEMONIC_PROMPT);
  seedScope("card-contrast", "对比卡 v8", CARD_CONTRAST_PROMPT);
  seedScope("card-wording", "措辞优化 v8", CARD_WORDING_PROMPT);
  seedScope("card-basic", "前置知识卡 v8", CARD_BASIC_PROMPT);
  // v32（M7，D31）：card-vocab 新 scope 首版 v1——既有 v6 目标版本不动，只增新 scope 行
  try {
    const vocabCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'card-vocab'")[0]?.n || 0;
    if (Number(vocabCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-vocab', '单词制卡 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), CARD_VOCAB_PROMPT, situationRequiredFor("card-vocab"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // M1.1（v15，D16）：card-occlusion 新分支播种（图片挖空生成链路）——新 scope，仅首次加入 v1
  const occCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'card-occlusion'")[0]?.n || 0;
  if (Number(occCount) === 0) {
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-occlusion', '图片挖空 v1', ?, 1, 1, ?, ?)",
      [crypto.randomUUID(), CARD_OCCLUSION_PROMPT, situationRequiredFor("card-occlusion"), now]
    );
  }
  // v29（D26）：card-occlusion v2——内容感知混合卡型（每卡自带 regions/qa 看图问答）。
  // 主软件直插候选版（用户真实书籍实测反馈即闭环输入，后续调优走测试台）；v1 留痕。
  // （v2 播种块已由 v3 取代：v29 时期播种过 v2 的库自然留痕；全新库直接 v1→v3）
  // v48.22（D58 §6.8-4，E1）：**新 scope** `extract-rerank` 首版 v1——摘录到期批的 AI 重排与解释。
  // 与制卡族 TARGET_VERSION 无关（不动它，避免整族重播）；出层契约见 kpScopes.validateExtractRerankOutput。
  try {
    const rerankCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'extract-rerank'")[0]?.n || 0;
    if (Number(rerankCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'extract-rerank', '摘录重排 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), EXTRACT_RERANK_PROMPT, situationRequiredFor("extract-rerank"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  const occMaxV = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = 'card-occlusion'")[0]?.v || 0;
  // v30（D29）：card-occlusion v3——增归属锚条款（论证/理论/学说/观点性内容标明提出者）。
  if (Number(occMaxV) < 3) {
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-occlusion', '图片制卡内容感知 v3（候选）', ?, 3, 1, ?, ?)",
      [crypto.randomUUID(), CARD_OCCLUSION_PROMPT_V3, situationRequiredFor("card-occlusion"), now]
    );
  }
  // v1 一次性播种（首次安装）：reader-explain / leech-rescue 只在此处加入
  // （v15 修正：原来按全表 count===0 判断，全新库上主制卡模板先播种导致此块永不执行、解释/诊断模板缺失）
  // v48.74（D118）：reader-explain v1 行改用冻结常量（原文留痕），v2 升版播种见下
  const explainCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'reader-explain'")[0]?.n || 0;
  if (Number(explainCount) === 0) {
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
      [crypto.randomUUID(), "reader-explain", "阅读解释 v1", READER_EXPLAIN_PROMPT_V1, situationRequiredFor("reader-explain"), now]
    );
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
      [crypto.randomUUID(), "leech-rescue", "难点诊断 v1", LEECH_RESCUE_PROMPT, situationRequiredFor("leech-rescue"), now]
    );
  }
  // v48.74（D118）：reader-explain v2——追问四式条款（四个追问按钮此前只有一句弱指引，模型自由发挥）。
  // 存量库按 MAX(version)<2 升版播种（reader-explain-ste v2 同款模式），v1 留痕。
  try {
    const explainMaxV = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = 'reader-explain'")[0]?.v || 0;
    if (Number(explainMaxV) < 2) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'reader-explain', '阅读解释 v2', ?, 2, 1, ?, ?)",
        [crypto.randomUUID(), READER_EXPLAIN_PROMPT, situationRequiredFor("reader-explain"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v40（M8-B，D37）：journal-insight 新 scope 首版 v1——洞察提示词（§4.13 三层证据 + 竞争解释 + 可选结构分支）。
  // 结构分支独立模板 structure-analogy 随 K2 提案管线播种；调优一律走测试台闭环（§7.4）。
  try {
    const insightCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'journal-insight'")[0]?.n || 0;
    if (Number(insightCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'journal-insight', '日记洞察 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), JOURNAL_INSIGHT_PROMPT, situationRequiredFor("journal-insight"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v48.58（D99 / §6.8-16）：review-answer-judge 新 scope 首版 v1——复习页「AI 判答」等价判定模板。
  // 与制卡族 TARGET_VERSION 无关（extract-rerank 同法：per-scope count==0 播种，存量库启动即补种）。
  try {
    const judgeCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'review-answer-judge'")[0]?.n || 0;
    if (Number(judgeCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'review-answer-judge', 'AI 判答 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), REVIEW_ANSWER_JUDGE_PROMPT, situationRequiredFor("review-answer-judge"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // D121（v48.77 / §3.3）：card-disambiguate 新 scope 首版 v1——卡片辨析 AI 诊断（点击才调用）。
  // 与制卡族 TARGET_VERSION 无关（同 review-answer-judge 法：per-scope count==0 播种）；situationRequiredFor 返回 0。
  try {
    const disCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'card-disambiguate'")[0]?.n || 0;
    if (Number(disCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-disambiguate', '卡片辨析 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), CARD_DISAMBIGUATE_PROMPT, situationRequiredFor("card-disambiguate"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v48.51（D91）：reader-explain-ste 新 scope 首版 v1——简明解读（双 pack 槽位模板，
  // pack 由渲染端按材料语言/输出语言注入，见 src/lib/steProfiles.ts）。零新增 IPC、零 schema 变更。
  // v48.74（D118）：v1 行用冻结的 READER_EXPLAIN_STE_PROMPT_V1（D91 原文留痕），全新库即 v1+v2 两行。
  try {
    const steCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'reader-explain-ste'")[0]?.n || 0;
    if (Number(steCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'reader-explain-ste', '简明解读 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), READER_EXPLAIN_STE_PROMPT_V1, situationRequiredFor("reader-explain-ste"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v48.74（D118）：reader-explain-ste v2——节标题语法硬约束（独占一行 + ## 前缀，禁止【】/粗体代替）。
  // 存量库按 MAX(version)<2 升版播种（card-occlusion v3 同款模式），v1 留痕；getPromptTemplate 按
  // is_default DESC, version DESC 取行 ⇒ v2 自然生效。
  try {
    const steMaxV = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = 'reader-explain-ste'")[0]?.v || 0;
    if (Number(steMaxV) < 2) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'reader-explain-ste', '简明解读 v2', ?, 2, 1, ?, ?)",
        [crypto.randomUUID(), READER_EXPLAIN_STE_PROMPT, situationRequiredFor("reader-explain-ste"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v41（K2-A，D38）：knowledge-extraction / knowledge-relation 两 scope 首版 v1（§6.3.11 播种记录）。
  // v43（K2-B）：余下 4 scope（material-difficulty / knowledge-probe / frontier-explain / structure-analogy）
  // 首版 v1——消费引擎分属 K3/K4-K5/K9，本批只定契约；出层校验＝electron/kpScopes.js，离散度守门随批落地。
  try {
    for (const [scope, name, content] of [
      ["knowledge-extraction", "知识点抽取归一 v1", KNOWLEDGE_EXTRACTION_PROMPT],
      ["knowledge-relation", "知识关系抽取 v1", KNOWLEDGE_RELATION_PROMPT],
      ["material-difficulty", "材料难度画像 v1", MATERIAL_DIFFICULTY_PROMPT],
      ["knowledge-probe", "维度探针 v1", KNOWLEDGE_PROBE_PROMPT],
      ["frontier-explain", "推荐解释 v1", FRONTIER_EXPLAIN_PROMPT],
      ["structure-analogy", "结构类比 v1", STRUCTURE_ANALOGY_PROMPT]
    ]) {
      const n = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = ?", [scope])[0]?.n || 0;
      if (Number(n) === 0) {
        db.run(
          "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
          [crypto.randomUUID(), scope, name, content, situationRequiredFor(scope), now]
        );
      }
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v48 批2（M15 重做，D41-③ / §4.19-3）：material-map-* 五 scope——四层管线（单元分析/归并/全书/终编辑）
  // + 语义评审。消费引擎 = electron/mindmapEngine.js；出层校验 = electron/mindmapCore.js validateMapStructure。
  // v48.1（用户实测「详细粒度粗略」）：粒度块传入提示词 + children 递归契约 + 短引文——升 v2 补播
  // （MAX(version) < 2 即插新行；存量 v1 留痕，读取取最高版）。
  try {
    // v48.5 批B：section 升 v3（expandable/stopReason 原子性判断 + children 单层化——深挖由系统逐节点接管）；
    // 其余四 scope 维持 v2。各 scope 按各自目标版本补播。
    const MM_TARGETS = { "material-map-section": 3, "material-map-merge": 2, "material-map-global": 2, "material-map-editorial": 2, "material-map-review": 2 };
    for (const [scope, name, content] of [
      ["material-map-section", "材料结构单元分析 v3", MATERIAL_MAP_SECTION_PROMPT],
      ["material-map-merge", "章节归并 v2", MATERIAL_MAP_MERGE_PROMPT],
      ["material-map-global", "全书归并 v2", MATERIAL_MAP_GLOBAL_PROMPT],
      ["material-map-editorial", "结构终编辑 v2", MATERIAL_MAP_EDITORIAL_PROMPT],
      ["material-map-review", "导图语义评审 v2", MATERIAL_MAP_REVIEW_PROMPT]
    ]) {
      const maxV = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = ?", [scope])[0]?.v || 0;
      if (Number(maxV) < (MM_TARGETS[scope] || 2)) {
        db.run(
          "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
          [crypto.randomUUID(), scope, name, content, MM_TARGETS[scope] || 2, situationRequiredFor(scope), now]
        );
      }
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v48.5 批C（用户制卡语义拍板）：card-structure 结构制卡分支 v1——导图节点「就此制卡」专用，
  // 对作者组织结构出题（不考原文事实细节），走统一制卡管线与确认面板；auto 路由不选它。
  try {
    const csCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'card-structure'")[0]?.n || 0;
    if (Number(csCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-structure', '结构制卡 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), CARD_STRUCTURE_PROMPT, situationRequiredFor("card-structure"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // v45（M14-UM1，D39 / §4.18-13）：user-memory 新 scope 首版 v1——摄入轮与整理轮共用的整理提示词
  // （新 scope 首版直播种，照 card-vocab / journal-insight 先例；调优一律走测试台闭环 §7.4）。
  try {
    const memCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'user-memory'")[0]?.n || 0;
    if (Number(memCount) === 0) {
      db.run(
        "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'user-memory', '用户记忆整理 v1', ?, 1, 1, ?, ?)",
        [crypto.randomUUID(), USER_MEMORY_PROMPT, situationRequiredFor("user-memory"), now]
      );
    }
  } catch { /* 播种失败不阻塞启动 */ }
  // 批次 E（D-TEST-02；语义由用户 2026-09-22 拍板为 ①「该 scope 的默认/启用版本」）：
  // 历史上每条播种 INSERT 都把 is_default 写死 1，同 scope 于是多行同时"默认"
  // （实例：card-occlusion v1 与 v3），该列不承载任何信息。这里做一次**幂等数据订正**：
  // 每个 scope 只有最高 version 保留 is_default=1，其余置 0。新库播种后立即收敛，
  // 存量库下次启动收敛。不改 schema、不删历史行；反向语句就是把该行的 0 改回 1。
  try {
    db.run(
      `UPDATE prompt_templates SET is_default = CASE WHEN version = (
           SELECT MAX(p2.version) FROM prompt_templates p2 WHERE p2.scope = prompt_templates.scope
         ) THEN 1 ELSE 0 END`
    );
  } catch { /* 订正失败下次启动重试 */ }
}

function getPromptTemplate(scope) {
  const rows = queryAll(
    "SELECT * FROM prompt_templates WHERE scope = ? ORDER BY is_default DESC, version DESC LIMIT 1",
    [scope]
  );
  return rows[0] || null;
}

// v48.74（D118）：按版本取模板行（只读）——升版播种测试核对留痕行（如 reader-explain-ste v1 原文冻结）
function getPromptTemplateVersion(scope, version) {
  const rows = queryAll(
    "SELECT * FROM prompt_templates WHERE scope = ? AND version = ? LIMIT 1",
    [scope, version]
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

// ---------- M7 词典（v32，D31）：来源登记 + 在线缓存（受 Provider 许可约束） ----------
// 词条本体存独立 dictionary.db（electron/dictDb.js）——大词典入主库会让每次 persist 全量导出
// 变成数百 MB 级，拖垮复习/制卡写路径；主库只存轻量的来源登记与在线缓存。

// v38（D35）：format → 词典语言（本地命中语言优先的唯一派生源；调用方也可显式传 src.lang 覆盖）。
// stardict/dsl 等手动导入的来源语言未知 → ''（通配，命中排序时空语言排在精确匹配之后）。
const DICT_FORMAT_LANG = {
  "jmdict-xml": "ja",
  "kaikki-jsonl": "ja",
  "jamdict-sqlite": "ja",
  "cedict": "zh",
  "ecdict-csv": "en",
  "ecdict-sqlite": "en",
};

function dictLangForFormat(format) {
  return DICT_FORMAT_LANG[String(format || "").toLowerCase()] || "";
}

function listDictSources() {
  try {
    return queryAll("SELECT * FROM dict_sources WHERE is_deleted = 0 ORDER BY created_at ASC");
  } catch {
    return [];
  }
}

function upsertDictSource(src) {
  const now = Date.now();
  const id = src.id || crypto.randomUUID();
  const lang = src.lang || dictLangForFormat(src.format);
  const rows = queryAll("SELECT id FROM dict_sources WHERE id = ?", [id]);
  if (rows.length === 0) {
    db.run(
      "INSERT INTO dict_sources (id, user_id, name, format, lang, path, url, enabled, entry_count, created_at, updated_at, sync_version, is_deleted) VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)",
      [id, src.name || "未命名词典", src.format || "unknown", lang, src.path || null, src.url || null, src.enabled === false ? 0 : 1, Number(src.entryCount) || 0, now, now]
    );
  } else {
    db.run(
      "UPDATE dict_sources SET name=?, format=?, lang=?, path=?, url=?, enabled=?, entry_count=?, updated_at=? WHERE id=?",
      [src.name || "未命名词典", src.format || "unknown", lang, src.path || null, src.url || null, src.enabled === false ? 0 : 1, Number(src.entryCount) || 0, now, id]
    );
  }
  persist();
  return { id };
}

function setDictSourceEnabled(id, enabled) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("dict_sources", id)) return false;
  db.run("UPDATE dict_sources SET enabled=?, updated_at=? WHERE id=?", [enabled ? 1 : 0, Date.now(), String(id)]);
  persist();
  return true;
}

function removeDictSource(id) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("dict_sources", id)) return false;
  db.run("UPDATE dict_sources SET is_deleted=1, updated_at=? WHERE id=?", [Date.now(), String(id)]);
  persist();
  return true;
}

function getDictCache(providerId, language, word) {
  try {
    const rows = queryAll("SELECT result_json, fetched_at, version FROM dictionary_cache WHERE provider_id=? AND language=? AND normalized_word=?", [String(providerId), String(language), String(word)]);
    if (!rows.length) return null;
    return { entry: JSON.parse(rows[0].result_json), fetchedAt: rows[0].fetched_at, version: rows[0].version };
  } catch {
    return null;
  }
}

// 单条词典缓存上限（D-TEST-78）：真实词条远小于此，超限一律拒收
const DICT_ENTRY_MAX_BYTES = 64 * 1024;

function setDictCache(providerId, language, word, entry, version) {
  // D-TEST-77 更正后按**实际可用的判据**修：provider 是渲染层对象（src/lib/dict.ts 的 provider.id），
  // 主进程没有它的权威清单 ⇒ 存在性校验属于渲染层，这里不做；但原来连格式都不看，
  // providerId 传 "不存在的provider" 照样落盘，长出一个没人认领的孤儿分组。
  // D-TEST-78：单条结果必须有上限——线上 dictionary.db 实测已 835 MB，一条异常 payload 能无上限撑大缓存。
  const pid = String(providerId ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pid)) return false;
  const lang = String(language ?? "").trim();
  if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(lang)) return false;
  if (!String(word ?? "").trim()) return false;
  let json;
  try {
    json = JSON.stringify(entry);
  } catch {
    return false;
  }
  if (json === undefined || Buffer.byteLength(json, "utf-8") > DICT_ENTRY_MAX_BYTES) return false;
  db.run("INSERT OR REPLACE INTO dictionary_cache (provider_id, language, normalized_word, result_json, fetched_at, version) VALUES (?,?,?,?,?,?)", [
    pid, lang, String(word), json, Date.now(), version || null,
  ]);
  persist();
  return true;
}

// ---------- 阅读器 / 摘录队列（Phase 2） ----------

function getDocument(itemId) {
  // D137：步进游标取单行 → .get()
  return db.prepare(`
    SELECT li.title, li.progress_json AS progressJson, d.id AS documentId, d.markdown, li.source_type AS sourceType, li.author
    FROM library_items li
    JOIN documents d ON d.library_item_id = li.id AND d.is_deleted = 0
    WHERE li.id = ? AND li.is_deleted = 0
  `).get([itemId]) || null;
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

// 批次 E（D-TEST-15）：内部助手——「针对既有行」的写入口先确认这一行真的还在。
// ⚠️ is_deleted 不是每张表都有（全库 27 张表里只有 17 张带软删位）：目标表有软删位时
// 必须连带过滤，否则会把「已软删的行」当成存在，等于白校验。
function rowExists(table, id, hasSoftDelete = true) {
  const sql = hasSoftDelete
    ? `SELECT 1 AS ok FROM "${table}" WHERE id = ? AND is_deleted = 0 LIMIT 1`
    : `SELECT 1 AS ok FROM "${table}" WHERE id = ? LIMIT 1`;
  return Boolean(queryAll(sql, [String(id)])[0]);
}

function updateProgress(itemId, progress) {
  // 批次 E（D-TEST-15 T1 档）：载荷形状与目标行存在性都要判，否则调用方拿到的 true 是假的
  // （阅读器/设置页据此显示「已保存」）。返回 false 而不是抛错——本函数是 fire-and-forget。
  // 形状判据只拒「非对象 / 数组 / null」：App.tsx:274 实传的是 {ratio,lastText,updatedAt,...extra}
  // 这类普通对象，拒宽了会静默丢掉用户的全部阅读进度。
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return false;
  if (!rowExists("library_items", itemId)) return false;
  db.run("UPDATE library_items SET progress_json = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(progress ?? {}),
    Date.now(),
    itemId
  ]);
  persist();
  return true;
}

function queryAll(sql, params = []) {
  // D137（§3.1 映射表）：prepare→bind→step→getAsObject→free 循环 → .all() 一处替换；
  // 207 处调用点零改动。undefined 绑定在 sqliteCompat.normParams 归一。
  return db.prepare(sql).all(normParams(params));
}

function createExtract({ parentType, parentId, documentId, contentMarkdown, priority, contextRef,
  comment, annotationType, annotationColor, tags, quoteRange, spans, kind }) {
  // 批次 E（D-TEST-15 T3 档）：extracts 是「挂在文档上的行」，父文档不存在就别插
  // （插进去就是日后没人踩得到的悬空行）。返回 false 不抛错，与 T1/T2 档一致。
  if (!rowExists("documents", documentId)) return false;
  // v48.23（D61 §6.8-11）：多段不相邻选择——渲染层只把 spans 原样过桥（不做归一），
  // 文本与区间都由 annotationRange 在这里装配（**spans 优先**，与单段路径同一实现面）。
  // 仅在 spans 真给出内容时启用，既有单段调用（不传 spans）逐字节不变。
  if (Array.isArray(spans) && spans.length > 0) {
    const payload = annotationRange.buildSpanPayload(spans);
    if (payload.text.trim()) {
      contentMarkdown = payload.text;
      quoteRange = payload.quoteRange;
    }
  }
  // 工单 ②（§6.8-11）：**子摘录的整条正文都是引文**——父卡里选中的那段就是子卡的全部内容，
  // 而单段选择不经过 spans 装配（渲染层只在 ≥2 段时传 spans）→ 这里补默认区间 [{0, len}]，
  // 修掉「单段子摘录无落点高亮」。只对 `parentType === "extract"` 成立；根摘录语义不变
  // （区间由选择跨度决定），且**显式传入的范围优先**（含 spans 装配出的多段区间）。
  if (String(parentType) === "extract" && !(Array.isArray(quoteRange) && quoteRange.length)) {
    quoteRange = [{ start: 0, end: String(contentMarkdown ?? "").length }];
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // v48.22（D58，§6.8-2）：**次日进队**——新摘录落下一个学习日切点（对齐 SM「只展示过去导入的文章」），
  // 存量行一律不动；该时刻同时是「新摘录」派生计数的锚点（首次处理日）
  const nextAt = dayStartMs(now) + DAY_MS;
  // 优先级继承（§4.1）：显式传入 → 用户指定；未传 → 跟随所属书的 library_items.priority
  const hasExplicit = priority !== undefined && priority !== null && priority !== "";
  const bookRow = queryAll(
    "SELECT li.priority AS p FROM documents d JOIN library_items li ON li.id = d.library_item_id WHERE d.id = ?",
    [documentId]
  )[0];
  const bookPriority = bookRow && Number.isFinite(Number(bookRow.p)) ? Number(bookRow.p) : PRIORITY_DEFAULT;
  const finalPriority = normPriority(hasExplicit ? priority : bookPriority);
  // 批注字段（§1.1）：标签与范围锚都规范化后再落；范围锚为空即"未标范围"（null），与"曾标过但被删空"（'[]'）区分
  const tagsJson = Array.isArray(tags) && tags.length ? JSON.stringify(tags.map(String)) : null;
  const rangeJson = Array.isArray(quoteRange) && quoteRange.length
    ? JSON.stringify(annotationRange.normalizeRanges(quoteRange, String(contentMarkdown).length))
    : null;
  // 层级身份（规格 §1.1 / §1.2）：**根摘录 rootExtractId ＝ 自身 id**——id 在这里才生成，故在落库前补；
  // 子摘录的 parentExtractId / rootExtractId 由调用方（渲染层写 contextRef 的唯一一处）注入，不在这里臆造。
  // 既有字段一律不动（原样往返）；只在「已有 contextRef 且缺 rootExtractId」时补一个键。
  const refJson = (() => {
    if (!contextRef || typeof contextRef !== "object" || Array.isArray(contextRef)) {
      return contextRef ? JSON.stringify(contextRef) : null;
    }
    if (String(parentType) === "document" && !contextRef.rootExtractId) {
      return JSON.stringify({ ...contextRef, rootExtractId: id });
    }
    return JSON.stringify(contextRef);
  })();
  db.run(
    `INSERT INTO extracts (id, user_id, parent_type, parent_id, document_id, content_markdown, context_ref_json, priority, priority_source, topic_next_at, interval_days, a_factor, workflow_state_json, comment, annotation_type, annotation_color, tag_json, quote_range_json, kind, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, 1, 1.6, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      String(parentType),
      String(parentId),
      String(documentId),
      String(contentMarkdown),
      refJson,
      finalPriority,
      hasExplicit ? "user" : "book",
      nextAt,
      comment != null && comment !== "" ? String(comment) : null,
      annotationType ? String(annotationType) : null,
      annotationColor ? String(annotationColor) : null,
      tagsJson,
      rangeJson,
      // 分族（R35）：只认白名单两值，其余一律按摘录（前向兼容）
      String(kind) === "highlight" ? "highlight" : "extract",
      now,
      now
    ]
  );
  persist();
  return { id, topicNextAt: nextAt, priority: finalPriority, prioritySource: hasExplicit ? "user" : "book" };
}

/** 摘录的层级链（面包屑用，§6.8-11）：自根到当前逐级 {id, text, depth}。
 *  与 parentChain 的分工：那个只回文本前缀（上下文前缀用）且封顶 5 级；
 *  本函数回 **id**（面包屑点击要切到那张卡）且封顶 20 级。 */
function getExtractChain(id) {
  const out = [];
  let cursorId = String(id);
  for (let i = 0; i < 20; i++) {
    const rows = queryAll(
      "SELECT id, parent_type, parent_id, content_markdown FROM extracts WHERE id = ? AND is_deleted = 0",
      [cursorId]
    );
    if (rows.length === 0) break;
    const row = rows[0];
    out.unshift({ id: String(row.id), text: String(row.content_markdown).slice(0, 40) });
    if (row.parent_type !== "extract") break;
    cursorId = String(row.parent_id);
  }
  return out.map((n, i) => ({ ...n, depth: i + 1 }));
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

function listDueExtracts(nowTs) {
  // v48.22（D58）：now 可注入（测试与跨日场景，同 §4.4.4 时间注入精神）；缺省取真实时间
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  const rows = queryAll(
    `SELECT e.id, e.parent_type, e.parent_id, e.document_id, e.content_markdown AS contentMarkdown, e.context_ref_json, e.priority,
            e.status, e.status_version AS statusVersion, e.status_detail_json AS statusDetailJson,
            e.a_factor AS aFactor, e.postpone_count AS postponeCount, e.process_count AS processCount,
            e.priority_source AS prioritySource, e.engine_state_json AS engineStateJson,
            e.comment, e.annotation_type AS annotationType, e.annotation_color AS annotationColor,
            e.tag_json AS tagJson, e.quote_range_json AS quoteRangeJson,
            COALESCE(e.kind,'extract') AS kind,
            e.topic_next_at AS topicNextAt, e.interval_days AS intervalDays, e.created_at AS createdAt,
            li.title AS docTitle, li.id AS libraryItemId
     FROM extracts e
     JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
     JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
     WHERE e.is_deleted = 0 AND COALESCE(e.kind,'extract') = 'extract' AND e.topic_next_at <= ?
       -- v48.22（D58，§6.4.2）：未知状态一律按 open 对待 ⇒ 必须写成**排除式**白名单；
       -- 写成包含式（status IN (...)）会把未知状态误排除，违反前向兼容
       AND COALESCE(e.status,'open') NOT IN ('resolved','dismissed','archived')
     ORDER BY e.priority ASC, e.topic_next_at ASC`,
    [now]
  );
  return rows.map((r) => ({
    ...r,
    contextRef: r.context_ref_json ? JSON.parse(r.context_ref_json) : null,
    depth: r.parent_type === "extract" ? parentChain(r).length + 1 : 1
  }));
}

/** 全量摘录（卡片浏览器用；**含已毕业/已归档/已推迟**，便于管理与召回——§6.8-6 统一数据源） */
function listAllExtracts() {
  const rows = queryAll(
    `SELECT e.id, e.parent_type AS parentType, e.parent_id AS parentId, e.document_id AS documentId,
            e.content_markdown AS contentMarkdown, e.context_ref_json AS contextRefJson,
            e.priority, e.priority_source AS prioritySource, e.status, e.status_version AS statusVersion,
            e.status_detail_json AS statusDetailJson, e.a_factor AS aFactor,
            e.postpone_count AS postponeCount, e.process_count AS processCount,
            e.engine_state_json AS engineStateJson,
            e.comment, e.annotation_type AS annotationType, e.annotation_color AS annotationColor,
            e.tag_json AS tagJson, e.quote_range_json AS quoteRangeJson,
            COALESCE(e.kind,'extract') AS kind,
            e.topic_next_at AS topicNextAt, e.interval_days AS intervalDays, e.created_at AS createdAt,
            li.title AS docTitle, li.id AS libraryItemId
     FROM extracts e
     JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
     JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
     WHERE e.is_deleted = 0
     ORDER BY e.priority ASC, e.topic_next_at ASC`
  );
  return rows.map((r) => {
    let contextRef = null;
    try {
      contextRef = r.contextRefJson ? JSON.parse(r.contextRefJson) : null;
    } catch {
      contextRef = null; // 坏 JSON 不抛：浏览器仍可展示行，只是没有跳转锚点
    }
    const { contextRefJson, ...rest } = r;
    return { ...rest, contextRef };
  });
}

function getExtract(id) {
  const rows = queryAll(
    `SELECT e.id, e.parent_type AS parentType, e.parent_id AS parentId,
            e.document_id AS documentId, e.content_markdown AS contentMarkdown,
            e.context_ref_json AS contextRefJson, e.priority, e.priority_source AS prioritySource,
            e.status, e.status_version AS statusVersion, e.status_detail_json AS statusDetailJson,
            e.a_factor AS aFactor, e.postpone_count AS postponeCount, e.process_count AS processCount,
            e.engine_state_json AS engineStateJson,
            e.comment, e.annotation_type AS annotationType, e.annotation_color AS annotationColor,
            e.tag_json AS tagJson, e.quote_range_json AS quoteRangeJson,
            COALESCE(e.kind,'extract') AS kind,
            e.topic_next_at AS topicNextAt, e.interval_days AS intervalDays, e.created_at AS createdAt,
            li.title AS docTitle
     FROM extracts e
     JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
     JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
     WHERE e.id = ? AND e.is_deleted = 0`,
    [id]
  );
  if (rows.length === 0) return null;
  return { ...rows[0], chain: parentChain(rows[0]) };
}

// ---------- v48.22（D58）：摘录调度内核（SM 语义 + 双引擎子空间 + 操作日志与撤销） ----------
// 契约：§6.8-2（SM 调度语义）/ §6.8-4（无损切换）/ §6.8-7（撤销）。规格：docs/impl-spec/EXTRACT-REVIEW-OVERHAUL.md

const ENGINE_SM = "sm19-default";
const ENGINE_AI = "ai-next-extract";
const ENGINES = [ENGINE_SM, ENGINE_AI];
const DEFAULT_A_FACTOR = 1.6;   // ＝旧 postponeExtract 的 ×1.6，存量行为零变更的锚点
const POSTPONE_CAP_DAYS = 180;
const DAY_MS = 86400000;
// 批量推迟的跳过条件（SM 文档口径；仅批量生效，单条不受限 —— §6.8-2）
const POSTPONE_SKIP = { maxIntervalDays: 2500, minAFactor: 1.01, maxPostponeCount: 250 };

function postponeSkipReason(row) {
  const cur = scheduleOfRow(row);
  if (cur.intervalDays > POSTPONE_SKIP.maxIntervalDays) return "间隔已超过 2500 天";
  if (cur.aFactor < POSTPONE_SKIP.minAFactor) return "A-Factor 低于 1.01";
  if (cur.postponeCount > POSTPONE_SKIP.maxPostponeCount) return "已推迟超过 250 次";
  return null;
}

// 生效引擎：显式参数优先；否则读 settings.app.extracts.engine（§6.8-1，默认 sm19-default）。
// 非法值一律回落默认——切换是幂等的设置写入，不引入第三套命名（§4.2-9）
function getActiveEngine(explicit) {
  if (ENGINES.includes(explicit)) return explicit;
  try {
    const v = readSettings().app?.extracts?.engine;
    return ENGINES.includes(v) ? v : ENGINE_SM;
  } catch {
    return ENGINE_SM;
  }
}

function setActiveEngineValue(engine) {
  const all = readSettings();
  const appLayer = all.app && typeof all.app === "object" && !Array.isArray(all.app) ? { ...all.app } : {};
  const exLayer = appLayer.extracts && typeof appLayer.extracts === "object" && !Array.isArray(appLayer.extracts)
    ? { ...appLayer.extracts }
    : {};
  exLayer.engine = engine;
  appLayer.extracts = exLayer;
  all.app = appLayer;
  writeSettings(all);
}

function parseEngineState(raw) {
  try {
    const o = JSON.parse(raw || "");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const EXTRACT_COLS = `id, parent_type AS parentType, parent_id AS parentId, document_id AS documentId,
  content_markdown AS contentMarkdown, context_ref_json AS contextRefJson,
  priority, priority_source AS prioritySource, status, status_version AS statusVersion,
  status_detail_json AS statusDetailJson, topic_next_at AS topicNextAt, interval_days AS intervalDays,
  a_factor AS aFactor, postpone_count AS postponeCount, process_count AS processCount,
  engine_state_json AS engineStateJson, created_at AS createdAt, updated_at AS updatedAt,
  comment, annotation_type AS annotationType, annotation_color AS annotationColor,
  tag_json AS tagJson, quote_range_json AS quoteRangeJson,
  COALESCE(kind,'extract') AS kind`;

/** 范围锚解析：坏 JSON / 非数组一律当"无区间"，绝不因脏数据抛（§2.2 末行：无锚要显式，不能瞎猜） */
function parseQuoteRanges(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function readExtractRow(id) {
  return queryAll(`SELECT ${EXTRACT_COLS} FROM extracts WHERE id = ? AND is_deleted = 0`, [id])[0] || null;
}

// 撤销删除时必须能读到已软删的行（否则「撤销＝取消软删」永远失败）
function readExtractRowAny(id) {
  return queryAll(`SELECT ${EXTRACT_COLS} FROM extracts WHERE id = ?`, [id])[0] || null;
}

/** 公共投影列（= 生效引擎的值）→ 调度状态对象 */
function scheduleOfRow(row) {
  return {
    nextAt: Number(row.topicNextAt) || 0,
    intervalDays: Number(row.intervalDays) || 1,
    aFactor: Number(row.aFactor) || DEFAULT_A_FACTOR,
    postponeCount: Number(row.postponeCount) || 0,
    processCount: Number(row.processCount) || 0,
    priority: Number(row.priority)
  };
}

/** 下一个操作序（op_journal / extract_ops 共用；与 review_logs.review_seq 相互独立）。
 *  必须在事务内调用；计数器缺失时以 1 兜底播种并回读。 */
function nextOpSeq() {
  const row = queryAll("SELECT next AS n FROM op_counter WHERE id = 1")[0];
  if (!row) {
    // 计数器缺失（异常库/迁移未跑）：以 1 兜底播一次，再回读。
    // 必须用 INSERT OR IGNORE —— OR REPLACE 会把已推进的 next 打回起点，造成 seq 重复
    db.run("INSERT OR IGNORE INTO op_counter (id, next) VALUES (1, 1)");
  }
  const cur = queryAll("SELECT next AS n FROM op_counter WHERE id = 1")[0];
  const seq = Number(cur?.n) || 1;
  db.run("UPDATE op_counter SET next = ? WHERE id = 1", [seq + 1]);
  return seq;
}

/** 调度写入：先更新生效引擎的私有子空间，再投影到公共列（§6.8-4 无损切换的载体） */
function writeExtractSchedule(id, patch, engine) {
  const row = readExtractRow(id);
  if (!row) return null;
  const eng = getActiveEngine(engine);
  const state = parseEngineState(row.engineStateJson);
  const merged = { ...scheduleOfRow(row), ...patch };
  state[eng] = merged;
  db.run(
    `UPDATE extracts SET topic_next_at = ?, interval_days = ?, priority = ?, postpone_count = ?,
       process_count = ?, a_factor = ?, engine_state_json = ?, updated_at = ? WHERE id = ?`,
    [
      merged.nextAt, merged.intervalDays, merged.priority, merged.postponeCount,
      merged.processCount, merged.aFactor, JSON.stringify(state), Date.now(), id
    ]
  );
  return merged;
}

function writeExtractStatus(id, status, detailPatch) {
  const row = readExtractRow(id);
  if (!row) return null;
  let detail = {};
  try {
    const parsed = JSON.parse(row.statusDetailJson || "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) detail = parsed;
  } catch { /* 坏 JSON 按空对象处理 */ }
  const nextDetail = { ...detail, ...(detailPatch || {}) };
  db.run("UPDATE extracts SET status = ?, status_version = 1, status_detail_json = ?, updated_at = ? WHERE id = ?", [
    String(status), JSON.stringify(nextDetail), Date.now(), id
  ]);
  return { status, detail: nextDetail };
}

/** 撤销用：摘录的可逆快照（含引擎子空间原文，保证逐字段可复原） */
function extractSnapshot(row) {
  return {
    contentMarkdown: row.contentMarkdown,
    status: row.status,
    statusDetailJson: row.statusDetailJson,
    prioritySource: row.prioritySource,
    isDeleted: 0,
    schedule: scheduleOfRow(row),
    engineStateJson: row.engineStateJson ?? null,
    // 撤销一次正文编辑必须把范围锚一起退回去，否则区间与文本对不上（§2.2）
    quoteRangeJson: row.quoteRangeJson ?? null,
    comment: row.comment ?? null,
    annotationColor: row.annotationColor ?? null,
    kind: row.kind ?? "extract"
  };
}

/** 写操作日志 + 跨类排序索引（同一事务内调用）。批量共用一个 batch_id，journal.ref 记 batch_id */
function logExtractOp(row, opType, before, after, batchId, skipJournal) {
  const seq = nextOpSeq();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO extract_ops (id, seq, extract_id, op_type, batch_id, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, seq, row.id, opType, batchId || null, JSON.stringify(before), JSON.stringify(after), now]
  );
  if (!skipJournal) {
    db.run("INSERT INTO op_journal (seq, kind, ref, undoable, created_at) VALUES (?, 'extract_op', ?, 1, ?)", [
      seq, batchId || id, now
    ]);
  }
  return { id, seq };
}

function withTransaction(fn) {
  // D137（§3.3）：保留手写 BEGIN → COMMIT / ROLLBACK（F38「撤销只删最大 seq ⇒ 序号稠密」等既有断言零改写）。
  // 加固①：BEGIN IMMEDIATE——单写者应用下杜绝 deferred→write 升级时的 SQLITE_BUSY 边角。
  // 加固②：COMMIT 失败显式 ROLLBACK 并 rethrow（与原 catch 对称，不留悬挂事务）。
  db.run("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const out = fn();
    db.run("COMMIT");
    committed = true;
    persist();
    return out;
  } catch (e) {
    if (!committed) {
      try { db.run("ROLLBACK"); } catch { /* 回滚失败仅吞并，避免掩盖原异常 */ }
    }
    throw e;
  }
}

/** 恢复一条摘录到快照（撤销的唯一写入口；不写日志、不写 journal） */
function restoreExtractSnapshot(snapshotRow, snap) {
  const s = snap.schedule || {};
  db.run(
    `UPDATE extracts SET content_markdown = ?, status = ?, status_detail_json = ?, priority = ?,
       priority_source = ?, topic_next_at = ?, interval_days = ?, postpone_count = ?, process_count = ?,
       a_factor = ?, engine_state_json = ?, quote_range_json = ?, is_deleted = 0, updated_at = ? WHERE id = ?`,
    [
      snap.contentMarkdown, snap.status, snap.statusDetailJson ?? null,
      Number(s.priority), snap.prioritySource,
      Number(s.nextAt) || 0, Number(s.intervalDays) || 1, Number(s.postponeCount) || 0,
      Number(s.processCount) || 0, Number(s.aFactor) || DEFAULT_A_FACTOR,
      snap.engineStateJson ?? null, snap.quoteRangeJson ?? null, Date.now(), snapshotRow.id
    ]
  );
  // 批 4（Task 2）：批注文字 / 颜色 / 分族逐字段复原；旧快照无这三键 ⇒ undefined，跳过不动现有值
  const annoSets = [];
  const annoArgs = [];
  if (snap.comment !== undefined) { annoSets.push("comment = ?"); annoArgs.push(snap.comment); }
  if (snap.annotationColor !== undefined) { annoSets.push("annotation_color = ?"); annoArgs.push(snap.annotationColor); }
  if (snap.kind !== undefined) { annoSets.push("kind = ?"); annoArgs.push(snap.kind); }
  if (annoSets.length) {
    db.run(`UPDATE extracts SET ${annoSets.join(", ")} WHERE id = ?`, [...annoArgs, snapshotRow.id]);
  }
}

/** 读后推进（§6.8-2「下一条」）：interval ×= a_factor；next_at = now + interval；process_count++ */
function advanceExtract(id, nowTs) {
  const row = readExtractRow(id);
  if (!row) return null;
  const now = Number(nowTs) || Date.now();
  const cur = scheduleOfRow(row);
  const intervalDays = cur.intervalDays * cur.aFactor;
  const next = {
    intervalDays,
    nextAt: now + Math.round(intervalDays * DAY_MS),
    processCount: cur.processCount + 1
  };
  const before = extractSnapshot(row);
  const statusPatch = row.status === "open" ? { status: "reading" } : {};
  const out = withTransaction(() => {
    const merged = writeExtractSchedule(id, next);
    const st = Object.keys(statusPatch).length ? writeExtractStatus(id, statusPatch.status) : { status: row.status };
    logExtractOp(row, "advance", before, { ...next, status: st.status }, null);
    return { ...merged, status: st.status };
  });
  return out;
}

/** 推迟（两条路径共用）：mode='days' 覆盖式指定天数；mode='factor' 乘 a_factor（封顶 180 天） */
function postponeExtractInternal(id, mode, days, nowTs) {
  const row = readExtractRow(id);
  if (!row) return null;
  const now = Number(nowTs) || Date.now();
  const cur = scheduleOfRow(row);
  let intervalDays;
  if (mode === "days") {
    const n = Number(days);
    // 契约：至少 1 天（对齐 SM「推迟后间隔至少比今天多 1 天」）
    intervalDays = Math.max(1, Math.min(Number.isFinite(n) ? n : 1, 36500));
  } else {
    intervalDays = Math.min(cur.intervalDays * cur.aFactor, POSTPONE_CAP_DAYS);
  }
  const next = {
    intervalDays,
    nextAt: now + Math.round(intervalDays * DAY_MS),
    postponeCount: cur.postponeCount + 1
  };
  const before = extractSnapshot(row);
  const out = withTransaction(() => {
    const merged = writeExtractSchedule(id, next);
    const st = writeExtractStatus(id, "postponed");
    logExtractOp(row, "postpone", before, { ...next, status: st.status, mode }, null);
    return { ...merged, status: st.status, mode };
  });
  return out;
}

/** 旧签名保留（×a_factor 路径）：既有调用方与 f10/f15 的 ×1.6 / 180 天上限断言不变 */
function postponeExtract(id) {
  const out = postponeExtractInternal(id, "factor", null);
  return out ? { intervalDays: out.intervalDays, nextAt: out.nextAt } : null;
}

/** 用户指定天数推迟（沉浸式页「推迟」按钮） */
function postponeExtractDays(id, days) {
  return postponeExtractInternal(id, "days", days);
}

function updateExtract(id, patch) {
  const row = readExtractRow(id);
  if (!row) return null;
  const p = patch || {};
  const hasContent = Object.prototype.hasOwnProperty.call(p, "contentMarkdown");
  const hasRange = Object.prototype.hasOwnProperty.call(p, "quoteRange");
  // 批 4（Task 2）：批注文字 / 颜色 / 分族可写（清空 comment 即删除批注；非法颜色与越界 kind 一律忽略）
  const hasComment = Object.prototype.hasOwnProperty.call(p, "comment");
  const hasColor = Object.prototype.hasOwnProperty.call(p, "annotationColor");
  const hasKind = Object.prototype.hasOwnProperty.call(p, "kind");
  if (!hasContent && !hasRange && !hasComment && !hasColor && !hasKind) return { ok: true, unchanged: true };
  const contentMarkdown = hasContent ? String(p.contentMarkdown ?? "") : row.contentMarkdown;
  if (contentMarkdown === row.contentMarkdown && !hasRange && !hasComment && !hasColor && !hasKind) return { ok: true, unchanged: true };
  const before = extractSnapshot(row);
  return withTransaction(() => {
    // 范围锚（规格 §2.2 / D61）：正文一变就按编辑脚本把区间重映射过去——
    // 锚的是"区间"不是"文字"，所以卡片怎么编辑都不会找不到原文。
    // null＝从未标过范围（老数据，不写回，免生 '[]' 噪音）；'[]'＝标过但被删空（§2.2 末行：显式无锚）。
    const prevRanges = parseQuoteRanges(row.quoteRangeJson);
    let nextRanges = prevRanges;
    if (hasContent && contentMarkdown !== row.contentMarkdown) {
      nextRanges = annotationRange.transformRanges(prevRanges, row.contentMarkdown, contentMarkdown).ranges;
    }
    if (hasRange) nextRanges = annotationRange.normalizeRanges(p.quoteRange, contentMarkdown.length);
    const writeRanges = row.quoteRangeJson != null || hasRange;
    const sets = ["content_markdown = ?", "updated_at = ?"];
    const args = [contentMarkdown, Date.now()];
    if (writeRanges) {
      sets.splice(1, 0, "quote_range_json = ?");
      args.splice(1, 0, JSON.stringify(nextRanges));
    }
    if (hasComment) {
      const v = p.comment == null || String(p.comment).trim() === "" ? null : String(p.comment);
      sets.push("comment = ?"); args.push(v);
    }
    if (hasColor && /^([a-z]{3,12}|#[0-9a-fA-F]{3,8})$/.test(String(p.annotationColor ?? ""))) {
      sets.push("annotation_color = ?"); args.push(String(p.annotationColor));
    }
    if (hasKind && (p.kind === "highlight" || p.kind === "extract")) {
      sets.push("kind = ?"); args.push(p.kind);
    }
    db.run(`UPDATE extracts SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    logExtractOp(
      row, "edit", before,
      {
        ...(writeRanges ? { quoteRange: nextRanges } : {}),
        contentMarkdown,
        ...(hasComment ? { comment: p.comment == null || String(p.comment).trim() === "" ? null : String(p.comment) } : {}),
        ...(hasColor ? { annotationColor: p.annotationColor } : {}),
        ...(hasKind ? { kind: p.kind } : {})
      },
      null
    );
    return writeRanges ? { ok: true, quoteRange: nextRanges } : { ok: true };
  });
}

/** 单条改优先级：置 priority_source='user'（此后不再跟随书级优先级，§4.1） */
function setExtractPriority(id, priority) {
  const row = readExtractRow(id);
  if (!row) return null;
  const value = normPriority(priority);
  if (value === row.priority && row.prioritySource === "user") return { ok: true, unchanged: true };
  const before = extractSnapshot(row);
  return withTransaction(() => {
    writeExtractSchedule(id, { priority: value });
    db.run("UPDATE extracts SET priority_source = 'user', updated_at = ? WHERE id = ?", [Date.now(), id]);
    logExtractOp(row, "set_priority", before, { priority: value, prioritySource: "user" }, null);
    return { ok: true, priority: value };
  });
}

/** 状态变更（毕业 / 召回 / 搁置 / 归档）。opType 由调用方语义决定，缺省 set_status */
function setExtractStatus(id, status, detailPatch, opType) {
  const row = readExtractRow(id);
  if (!row) return null;
  const detail = { ...(detailPatch || {}) };
  if (status === "resolved") detail.graduatedAt = detail.graduatedAt || Date.now();
  const before = extractSnapshot(row);
  return withTransaction(() => {
    const st = writeExtractStatus(id, status, detail);
    logExtractOp(row, opType || "set_status", before, { status, detail }, null);
    return { ok: true, status: st.status };
  });
}

function deleteExtract(id) {
  const row = readExtractRow(id);
  if (!row) return null;
  const before = extractSnapshot(row);
  return withTransaction(() => {
    db.run("UPDATE extracts SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), id]);
    logExtractOp(row, "delete", before, { isDeleted: 1 }, null);
    return { ok: true };
  });
}

/** 撤销分发：**只能撤销最近一次操作**；跳过不可撤销者（线性撤销栈语义） */
function undoLast() {
  for (let guard = 0; guard < 200; guard++) {
    const tail = queryAll("SELECT seq, kind, ref, undoable FROM op_journal ORDER BY seq DESC LIMIT 1")[0];
    if (!tail) break;
    if (tail.kind === "card_grade") {
      // 先摘掉排序索引条目，再走既有 undoLastReview（逐字复用）。两者不在同一事务内：
      // op_journal 只是排序索引、不是事实源，索引丢失时 getUndoInfo 会回退既有路径，属可接受的降级
      db.run("DELETE FROM op_journal WHERE seq = ?", [Number(tail.seq)]);
      const r = undoLastReview();
      if (r && r.ok) return r;
      // 该条不可撤销（前置快照缺失 / 状态已变）——继续向前找
      continue;
    }
    if (tail.kind === "extract_op") {
      const ops = opsForJournalRef(String(tail.ref));
      if (ops.length === 0) {
        db.run("DELETE FROM op_journal WHERE seq = ?", [Number(tail.seq)]);
        continue;
      }
      return withTransaction(() => {
        for (const op of ops) {
          const row = readExtractRowAny(op.extract_id);
          if (!row) continue;
          restoreExtractSnapshot(row, JSON.parse(op.before_json));
          db.run("DELETE FROM extract_ops WHERE id = ?", [op.id]);
        }
        db.run("DELETE FROM op_journal WHERE seq = ?", [Number(tail.seq)]);
        return { ok: true, kind: "extract_op", count: ops.length, opType: ops[0].op_type };
      });
    }
    db.run("DELETE FROM op_journal WHERE seq = ?", [Number(tail.seq)]);
  }
  return { ok: false, reason: "没有可撤销的操作" };
}

/** 撤销可用性（UI 用：Ctrl+Z 会撤销哪一类、撤什么） */
function getUndoInfo() {
  const tail = queryAll("SELECT seq, kind, ref FROM op_journal ORDER BY seq DESC LIMIT 1")[0];
  if (!tail) {
    const log = getLastUndoableReview();
    return log
      ? { available: true, kind: "card_grade", rating: log.rating, source: "legacy" }
      : { available: false, kind: null };
  }
  if (tail.kind === "card_grade") {
    const log = getLastUndoableReview();
    return { available: Boolean(log), kind: "card_grade", rating: log?.rating ?? null };
  }
  const ops = opsForJournalRef(String(tail.ref));
  return { available: ops.length > 0, kind: "extract_op", opType: ops[0]?.op_type ?? null, count: ops.length };
}

/** 批量摘录操作：单事务 + 单 batch_id + 单 journal 条目（Ctrl+Z 整批回退） */
const BATCH_OPS = ["postpone", "postponeDays", "set_priority", "set_status", "delete"];
function batchExtractOps(op, ids, payload) {
  if (!BATCH_OPS.includes(op)) return { ok: false, reason: `不支持的批量操作：${op}` };
  const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x);
  if (list.length === 0) return { ok: false, reason: "未选中任何条目" };
  const batchId = crypto.randomUUID();
  const now = Date.now();
  // 先做可读性检查（任一条不存在 → 整批不落库）
  const rows = [];
  for (const id of list) {
    const r = readExtractRow(id);
    if (!r) return { ok: false, reason: "存在已删除或不存在的条目，整批未执行" };
    rows.push(r);
  }
  return withTransaction(() => {
    let applied = 0;
    let lastSeq = 0;
    const skipped = [];
    for (const row of rows) {
      const cur = scheduleOfRow(row);
      const before = extractSnapshot(row);
      if (op === "postpone" || op === "postponeDays") {
        const reason = postponeSkipReason(row);
        if (reason) {
          skipped.push({ id: row.id, reason });
          continue;
        }
      }
      if (op === "postpone") {
        const intervalDays = Math.min(cur.intervalDays * cur.aFactor, POSTPONE_CAP_DAYS);
        writeExtractSchedule(row.id, { intervalDays, nextAt: now + Math.round(intervalDays * DAY_MS), postponeCount: cur.postponeCount + 1 });
        writeExtractStatus(row.id, "postponed");
        lastSeq = logExtractOp(row, "postpone", before, { intervalDays }, batchId, true).seq;
      } else if (op === "postponeDays") {
        const n = Math.max(1, Math.min(Number(payload && payload.days) || 1, 36500));
        writeExtractSchedule(row.id, { intervalDays: n, nextAt: now + Math.round(n * DAY_MS), postponeCount: cur.postponeCount + 1 });
        writeExtractStatus(row.id, "postponed");
        lastSeq = logExtractOp(row, "postpone", before, { intervalDays: n, mode: "days" }, batchId, true).seq;
      } else if (op === "set_priority") {
        const value = normPriority(payload && payload.priority);
        writeExtractSchedule(row.id, { priority: value });
        db.run("UPDATE extracts SET priority_source = 'user', updated_at = ? WHERE id = ?", [now, row.id]);
        lastSeq = logExtractOp(row, "set_priority", before, { priority: value, prioritySource: "user" }, batchId, true).seq;
      } else if (op === "set_status") {
        const status = String((payload && payload.status) || "open");
        writeExtractStatus(row.id, status, status === "resolved" ? { graduatedAt: now } : null);
        lastSeq = logExtractOp(row, "set_status", before, { status }, batchId, true).seq;
      } else if (op === "delete") {
        db.run("UPDATE extracts SET is_deleted = 1, updated_at = ? WHERE id = ?", [now, row.id]);
        lastSeq = logExtractOp(row, "delete", before, { isDeleted: 1 }, batchId, true).seq;
      }
      applied += 1;
    }
    // 整批一条 journal 条目（ref=batch_id）：Ctrl+Z 一次回退整批，且不留自愈型残留条目
    if (applied > 0) {
      db.run("INSERT INTO op_journal (seq, kind, ref, undoable, created_at) VALUES (?, 'extract_op', ?, 1, ?)", [
        lastSeq, batchId, now
      ]);
    }
    return { ok: true, count: applied, skipped, batchId };
  });
}

/** 卡片批量操作（v48.22 §6.8-6）：**单事务 + 单次 persist**，逐条列级写（不整行回写，避免 v32 式静默清列）。
 *  支持：suspend / resume / postpone(days) / delete / archive / restore（v48.60 D102）。
 *  **重置为新卡不在批内**——它要重写 fsrs 全字段，§4.4.1 下须单独评审（保持单卡路径不变）。
 *  卡片批量无 op_journal 撤销日志（§6.8-7 覆盖清单只含摘录批量与评分；v48.60 如实登记）。 */
const CARD_BATCH_OPS = ["suspend", "resume", "postpone", "delete", "archive", "restore"];
function batchCardOps(op, ids, payload) {
  if (!CARD_BATCH_OPS.includes(op)) return { ok: false, reason: `不支持的批量操作：${op}` };
  const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x);
  if (list.length === 0) return { ok: false, reason: "未选中任何条目" };
  const days = Math.max(1, Math.min(Number(payload && payload.days) || 1, 36500));
  const rows = [];
  for (const id of list) {
    const card = getCard(id);
    if (!card) return { ok: false, reason: "存在已删除或不存在的卡片，整批未执行" };
    rows.push(card);
  }
  return withTransaction(() => {
    const now = Date.now();
    let applied = 0;
    for (const card of rows) {
      if (op === "suspend" || op === "resume") {
        // 只动 leech_json（与 setCardSuspended 同列；§4.4.10：挂起/恢复不写 fsrs_config_id）
        const leech = { ...(card.leech || {}) };
        leech.suspended = op === "suspend";
        leech.suspendedAt = op === "suspend" ? now : null;
        db.run("UPDATE cards SET leech_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(leech), now, card.id]);
      } else if (op === "postpone") {
        // 只动 fsrs_json.due（其余字段原样保留；不写 fsrs_config_id，与单卡推迟同语义）
        const fsrs = { ...(card.fsrs || {}) };
        fsrs.due = now + days * DAY_MS;
        db.run("UPDATE cards SET fsrs_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(fsrs), now, card.id]);
      } else if (op === "delete") {
        db.run("UPDATE cards SET is_deleted = 1, updated_at = ? WHERE id = ?", [now, card.id]);
        db.run("UPDATE card_issues SET status = 'dismissed', resolved_at = ? WHERE card_id = ? AND status = 'open'", [now, card.id]);
      } else if (op === "archive" || op === "restore") {
        // v48.60（D102）：生命周期归档/恢复——只动 status 列；与 leech.suspended 正交不互碰；
        // **零 FSRS 写入**（fsrs_json 原样，恢复后按原 due 继续）；恢复显式落 'active'
        const value = op === "archive" ? "archived" : "active";
        db.run("UPDATE cards SET status = ?, updated_at = ? WHERE id = ?", [value, now, card.id]);
      }
      applied += 1;
    }
    return { ok: true, count: applied, days: op === "postpone" ? days : undefined };
  });
}

/** v48.60（D101，§4.1/设计稿 §1.4）：标签写入——渲染层用 src/lib/tags.ts（规则单一源）算好每卡终值，
 *  主进程只做存储：验证 id 存在 → 事务内逐卡拉平写 tags_json（字符串数组，形状校验）。
 *  无 op_journal 撤销日志（与卡片批量同域）；ids 长度 1 = 单卡（D80 先例）；缺卡 → 整批拒绝。 */
function setCardTags(items) {
  const list = (Array.isArray(items) ? items : []).filter(
    (it) => it && typeof it.id === "string" && it.id && Array.isArray(it.tags)
  );
  if (list.length === 0) return { ok: false, reason: "未选中任何卡片或载荷形状非法" };
  const rows = [];
  for (const it of list) {
    const card = getCard(it.id);
    if (!card) return { ok: false, reason: "存在已删除或不存在的卡片，整批未执行" };
    rows.push({ id: it.id, tags: it.tags.filter((t) => typeof t === "string") });
  }
  return withTransaction(() => {
    const now = Date.now();
    let applied = 0;
    for (const row of rows) {
      const cur = getCard(row.id);
      const before = JSON.stringify(Array.isArray(cur.tags) ? cur.tags : []);
      const after = JSON.stringify(row.tags);
      if (before === after) continue; // 无变化不触碰行
      db.run("UPDATE cards SET tags_json = ?, updated_at = ? WHERE id = ?", [after, now, row.id]);
      applied += 1;
    }
    // persist 由 withTransaction 在 COMMIT 后统一执行（与 batchCardOps 同模式；fn 内禁 persist）
    return { ok: true, count: applied };
  });
}

/** v48.60（D101，§1.3）：标签词表——cards.tags_json ∪ extracts.tag_json 派生（只读现算，零新表零缓存落盘）。
 *  大小写不敏感合并（NFKC 折叠键）；display 保留最近使用一方的写法；
 *  按总计数降序、同频按 display 排序（输入建议与计数展示用）。 */
function listCardTags() {
  const acc = new Map();
  const bump = (field) => (raw, lastUsedAt) => {
    if (!Array.isArray(raw)) return;
    for (const t of raw) {
      if (typeof t !== "string" || !t.trim()) continue;
      const key = t.normalize("NFKC").toLowerCase();
      if (!acc.has(key)) acc.set(key, { display: t, cardCount: 0, extractCount: 0, lastUsedAt: 0 });
      const e = acc.get(key);
      e[field] += 1;
      if (lastUsedAt > e.lastUsedAt) {
        e.lastUsedAt = lastUsedAt;
        e.display = t;
      }
    }
  };
  for (const r of queryAll("SELECT tags_json, updated_at FROM cards WHERE is_deleted = 0")) {
    let tags = null;
    try {
      tags = r.tags_json ? JSON.parse(r.tags_json) : null;
    } catch {
      tags = null;
    }
    bump("cardCount")(tags, Number(r.updated_at) || 0);
  }
  for (const r of queryAll("SELECT tag_json, updated_at FROM extracts WHERE is_deleted = 0")) {
    let tags = null;
    try {
      tags = r.tag_json ? JSON.parse(r.tag_json) : null;
    } catch {
      tags = null;
    }
    bump("extractCount")(tags, Number(r.updated_at) || 0);
  }
  return [...acc.values()].sort(
    (a, b) => b.cardCount + b.extractCount - (a.cardCount + a.extractCount) || a.display.localeCompare(b.display)
  );
}

/** 按 journal.ref 取回该次操作的 op 行（批量优先按 batch_id；单条按 id） */
function opsForJournalRef(ref) {
  const byBatch = queryAll("SELECT * FROM extract_ops WHERE batch_id = ? ORDER BY seq DESC", [ref]);
  if (byBatch.length > 0) return byBatch;
  return queryAll("SELECT * FROM extract_ops WHERE id = ?", [ref]);
}

/**
 * 引擎切换（§6.8-4）：源引擎子空间缺失时用当前投影冷启动播种（老库首切），
 * 目标引擎子空间缺失时同样以当前投影播种（coldStart），随后投影目标引擎的值到公共列，
 * 最后落 settings.app.extracts.engine（生效引擎的唯一真源）。
 */
function switchExtractEngine(to, from) {
  const target = getActiveEngine(to);
  const source = getActiveEngine(from);
  const rows = queryAll(`SELECT ${EXTRACT_COLS} FROM extracts WHERE is_deleted = 0`);
  let coldStart = 0;
  withTransaction(() => {
    for (const row of rows) {
      const state = parseEngineState(row.engineStateJson);
      const cur = scheduleOfRow(row);
      // 源引擎冷启动播种：子空间缺失（升版后首次切换）时把当前投影冻结进去，
      // 否则切走之后就再也回不到这套值——这是「无损」的关键一步
      if (!state[source]) state[source] = cur;
      let targetCold = false;
      if (!state[target]) {
        state[target] = cur;
        targetCold = true;
        coldStart += 1;
      }
      const t = state[target];
      db.run(
        `UPDATE extracts SET topic_next_at = ?, interval_days = ?, priority = ?, postpone_count = ?,
           process_count = ?, a_factor = ?, engine_state_json = ?, updated_at = ? WHERE id = ?`,
        [t.nextAt, t.intervalDays, t.priority, t.postponeCount, t.processCount, t.aFactor,
         JSON.stringify(state), Date.now(), row.id]
      );
    }
  });
  setActiveEngineValue(target);
  return { ok: true, engine: target, from: source, total: rows.length, coldStart };
}

/** 书级默认优先级（§4.1 / G1）：写库 + **实时跟随**该书下 priority_source='book' 的摘录 */
function setLibraryItemPriority(libraryItemId, priority) {
  if (!rowExists("library_items", libraryItemId)) return null;
  const value = normPriority(priority);
  const rows = queryAll(
    `SELECT e.id FROM extracts e JOIN documents d ON d.id = e.document_id
     WHERE d.library_item_id = ? AND e.is_deleted = 0 AND COALESCE(e.priority_source,'book') = 'book'`,
    [libraryItemId]
  );
  return withTransaction(() => {
    db.run("UPDATE library_items SET priority = ?, updated_at = ? WHERE id = ?", [value, Date.now(), libraryItemId]);
    for (const r of rows) writeExtractSchedule(r.id, { priority: value });
    return { ok: true, priority: value, followedExtracts: rows.length };
  });
}

/** 每日用量（派生，零新状态）：四类计数按学习日口径 */
function getDailyUsage(nowTs) {
  const now = Number(nowTs) || Date.now();
  const dayStart = dayStartMs(now);
  const cardReviews = queryAll(
    "SELECT COUNT(*) AS n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?",
    [dayStart, dayStart + DAY_MS]
  )[0]?.n || 0;
  // 新卡＝当日出现其首条复习日志的卡（reps 0→1 的派生口径）
  const newCards = queryAll(
    `SELECT COUNT(*) AS n FROM (
       SELECT card_id, MIN(reviewed_at) AS firstAt FROM review_logs GROUP BY card_id
     ) t WHERE t.firstAt >= ? AND t.firstAt < ?`,
    [dayStart, dayStart + DAY_MS]
  )[0]?.n || 0;
  // 摘录类计数只数**摘录**（kind='extract'）：纯高亮不进队列，自然也不该占每日上限（R35）
  const extractReviews = queryAll(
    `SELECT COUNT(*) AS n FROM extract_ops o JOIN extracts e ON e.id = o.extract_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.op_type IN ('advance','postpone','graduate')
       AND COALESCE(e.kind,'extract') = 'extract'`,
    [dayStart, dayStart + DAY_MS]
  )[0]?.n || 0;
  // 新摘录＝当日发生「首次处理」（该摘录最早一条 advance/postpone）的条数
  const newExtracts = queryAll(
    `SELECT COUNT(*) AS n FROM (
       SELECT MIN(o.seq) AS firstSeq FROM extract_ops o JOIN extracts e ON e.id = o.extract_id
       WHERE o.op_type IN ('advance','postpone') AND COALESCE(e.kind,'extract') = 'extract'
       GROUP BY o.extract_id
     ) f JOIN extract_ops o ON o.seq = f.firstSeq
     WHERE o.created_at >= ? AND o.created_at < ?`,
    [dayStart, dayStart + DAY_MS]
  )[0]?.n || 0;
  return {
    learningDayStart: dayStart,
    newCards,
    cardReviews,
    newExtracts,
    extractReviews
  };
}

// ---------- v48.22（D58）：每日上限（§6.8-5）与会话队列（§6.8-3） ----------

const LIMIT_DEFAULTS = { newCardsPerDay: 20, cardReviewsPerDay: 200, newExtractsPerDay: 10, extractReviewsPerDay: 50 };
const LIMIT_HARD_FACTOR = 5;      // 硬边界（用户 2026-09-24 裁定）：复习上限 ≥ 新上限 × 5
const LIMIT_ADVISORY_FACTOR = 10; // 建议档（Anki 文档口径「20 新卡 ≈ 200 复习/日」，非阻断）
const LIMIT_MAX = 9999;

/** 读上限（0 = 不限制；非法值回落默认；ignoreReviewLimitForNew 默认关） */
function readLimits() {
  const raw = (readSettings().app || {}).limits || {};
  const pick = (name) => {
    const v = Number(raw[name]);
    if (!Number.isInteger(v) || v < 0 || v > LIMIT_MAX) return LIMIT_DEFAULTS[name];
    return v;
  };
  return {
    newCardsPerDay: pick("newCardsPerDay"),
    cardReviewsPerDay: pick("cardReviewsPerDay"),
    newExtractsPerDay: pick("newExtractsPerDay"),
    extractReviewsPerDay: pick("extractReviewsPerDay"),
    ignoreReviewLimitForNew: raw.ignoreReviewLimitForNew === true
  };
}

/** 三层限幅的前两层（§6.8-5）：硬边界拒存 + 建议档提示；结构闸在会话队列里生效 */
function validateLimits(patch) {
  const merged = { ...readLimits(), ...(patch || {}) };
  const errors = [];
  const advisory = [];
  for (const name of Object.keys(LIMIT_DEFAULTS)) {
    const v = Number(merged[name]);
    if (!Number.isInteger(v) || v < 0 || v > LIMIT_MAX) {
      errors.push(`${name} 必须是 0（不限制）或 1–${LIMIT_MAX} 的整数`);
    }
  }
  const pair = (revName, newName, label) => {
    const rev = Number(merged[revName]);
    const nw = Number(merged[newName]);
    if (!Number.isInteger(rev) || !Number.isInteger(nw) || rev === 0 || nw === 0) return; // 0＝不限制，不参与关系约束
    if (rev < nw * LIMIT_HARD_FACTOR) {
      errors.push(`${label}复习上限不得低于${label}新上限的 ${LIMIT_HARD_FACTOR} 倍（当前 ${rev} < ${nw}×${LIMIT_HARD_FACTOR}）`);
    } else if (rev < nw * LIMIT_ADVISORY_FACTOR) {
      advisory.push(`${label}复习上限低于新上限的 ${LIMIT_ADVISORY_FACTOR} 倍，旧内容可能积压（Anki 官方经验：20 张新卡约带来 200 次复习/日）`);
    }
  };
  pair("cardReviewsPerDay", "newCardsPerDay", "卡片");
  pair("extractReviewsPerDay", "newExtractsPerDay", "摘录");
  return { ok: errors.length === 0, errors, advisory, limits: merged };
}

/** 用量 + 上限 + 余额（§6.8-5；纯派生、零写路径） */
function getLimitsState(nowTs) {
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  const usage = getDailyUsage(now);
  const limits = readLimits();
  const remaining = limitsRemaining(limits, usage);
  const newBlocked = !limits.ignoreReviewLimitForNew && remaining.cardReviews <= 0;
  return { usage, limits, remaining, newBlocked, learningDayStart: usage.learningDayStart };
}

function limitsRemaining(limits, usage) {
  const left = (cap, used) => (cap === 0 ? Infinity : Math.max(0, cap - used));
  return {
    newCards: left(limits.newCardsPerDay, usage.newCards),
    cardReviews: left(limits.cardReviewsPerDay, usage.cardReviews),
    newExtracts: left(limits.newExtractsPerDay, usage.newExtracts),
    extractReviews: left(limits.extractReviewsPerDay, usage.extractReviews)
  };
}

const INTERLEAVE_MODES = ["quota-1-4", "by-due"];
const DEFAULT_INTERLEAVE = "quota-1-4";
const EXTRACT_QUOTA_EVERY = 4; // SM 文档口径「limit the inflow of topics to 1:4 or less」

// ---------- v48.23（D61 §6.8-11）：多段选择的修饰键（§7.4 新键 app.multiSelectKey） ----------
// 取值域封闭（Ctrl/Alt/Shift/Meta）；主进程在读侧与 settings:set 写侧都归一（非法值不落盘）。
const MULTI_SELECT_KEYS = ["Ctrl", "Alt", "Shift", "Meta"];
const DEFAULT_MULTI_SELECT_KEY = "Ctrl"; // macOS 的建议值是 Meta（渲染层按平台取默认，这里只管合法性）

/** 归一多段选择修饰键：非枚举值一律回落默认（渲染层读侧与 settings:set 写侧共用） */
function normalizeMultiSelectKey(v) {
  return MULTI_SELECT_KEYS.includes(v) ? v : DEFAULT_MULTI_SELECT_KEY;
}

// ---------- 批 4（规格 §9.2）：就地批注的四个设置键 ----------
// 读侧归一（脏值不落盘、也不进渲染层）：枚举回落默认 / 数组净化去重限 8 / 色值 id 或 #hex。
const ANNOT_MODES = ["highlight", "extract"]; // v48.42（D82）：模式域回归（点色是否进队列）
const DEFAULT_ANNOT_MODE = "highlight";
const ANNOT_FORMS = ["highlight", "underline"]; // v48.42（D82）：标记形式域（v48.41/D81 引入下划线）
const DEFAULT_ANNOT_FORM = "highlight";
const ANNOTATION_FILTERS = ["all", "extract", "highlight"];
const DEFAULT_ANNOTATION_FILTER = "all";
/** 色板 id 值域（与渲染层 --annot-* Token 同名）；也接受 #hex 自定义色 */
const ANNOT_COLOR_IDS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"];
const ANNOT_PALETTE_MAX = 8;
/** 5 支默认色（D122：区分度最高的黄/红/绿/蓝/紫；§9.2 值域不变，仍可自定义） */
const DEFAULT_ANNOT_PALETTE = ["yellow", "red", "green", "blue", "purple"];

/** 归一标注模式：非枚举值回落默认 */
function normalizeAnnotateMode(v) {
  return ANNOT_MODES.includes(v) ? v : DEFAULT_ANNOT_MODE;
}

/** 归一标记形式：非枚举值回落 highlight（v48.42/D82） */
function normalizeAnnotateForm(v) {
  return ANNOT_FORMS.includes(v) ? v : DEFAULT_ANNOT_FORM;
}

/** 归一筛选：非枚举值回落 all */
function normalizeAnnotationFilter(v) {
  return ANNOTATION_FILTERS.includes(v) ? v : DEFAULT_ANNOTATION_FILTER;
}

/** 归一布尔（读侧与写侧共用）：非真值一律 false */
function normalizeAnnotateCustomEnabled(v) {
  return v === true || v === "true";
}

/**
 * 归一色板：逐项必须是色板 id 或 #hex；**有序去重**、截到上限 8；空/非法 ⇒ 回落默认 6 支。
 * 不抛错（脏数据不该让设置页打不开）。
 */
function normalizeAnnotatePalette(v) {
  const isColor = (x) =>
    (typeof x === "string" && ANNOT_COLOR_IDS.includes(x)) ||
    (typeof x === "string" && /^#[0-9a-fA-F]{3,8}$/.test(x));
  const list = Array.isArray(v) ? v.filter(isColor) : [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= ANNOT_PALETTE_MAX) break;
  }
  return out.length ? out : DEFAULT_ANNOT_PALETTE;
}

/** 读侧取四个键的当前值（渲染层经 settingsStore.get("app", …) 读；此处供主进程一致性检查与测试） */
function readAnnotationSettings() {
  const app = readSettings().app || {};
  return {
    annotateMode: normalizeAnnotateMode(app.annotateMode),
    annotateForm: normalizeAnnotateForm(app.annotateForm),
    annotatePalette: normalizeAnnotatePalette(app.annotatePalette),
    annotateCustomEnabled: app.annotateCustomEnabled === undefined ? true : normalizeAnnotateCustomEnabled(app.annotateCustomEnabled),
    annotationFilter: normalizeAnnotationFilter(app.annotationFilter)
  };
}

function readSessionPrefs() {
  const ex = (readSettings().app || {}).extracts || {};
  return {
    mergeIntoReview: ex.mergeIntoReview === true, // 默认关（用户裁定）
    interleave: INTERLEAVE_MODES.includes(ex.interleave) ? ex.interleave : DEFAULT_INTERLEAVE
  };
}

/** 复习范围（筛选牌组）：结构化过滤（书 / 标签 / 知识点 / 类别）+ 可选上限覆写。零 schema 变更（D51 先例）
 *  v48.61（D105，D94 设计稿 §3.4）：扩 tags[]（多值 OR、层级前缀语义同 §6.8-6 tag:）与 kpIds[]（仅闪卡行命中）；
 *  向后兼容——两字段缺省 = 不限。 */
function readReviewScopes() {
  const raw = (readSettings().app || {}).reviewScopes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object" && typeof s.id === "string" && s.id)
    .map((s) => ({
      id: String(s.id),
      name: String(s.name || "未命名范围"),
      bookItemIds: Array.isArray(s.bookItemIds) ? s.bookItemIds.map(String).filter(Boolean) : [],
      tags: Array.isArray(s.tags) ? s.tags.map(String).filter(Boolean) : [],
      kpIds: Array.isArray(s.kpIds) ? s.kpIds.map(String).filter(Boolean) : [],
      kinds: Array.isArray(s.kinds) ? s.kinds.filter((k) => k === "card" || k === "extract") : [],
      limits: s.limits && typeof s.limits === "object" ? s.limits : null
    }));
}

/** 范围只能**收紧**上限，不能另开预算（§6.8-5 关键取舍：范围互相重叠，各开配额会被多入口绕过） */
function limitsForScope(base, scope) {
  if (!scope || !scope.limits) return base;
  const out = { ...base };
  for (const name of Object.keys(LIMIT_DEFAULTS)) {
    const v = Number(scope.limits[name]);
    if (!Number.isInteger(v) || v < 0 || v > LIMIT_MAX) continue;
    if (out[name] === 0) out[name] = v;                    // 全局不限 ⇒ 用范围的收紧值
    else if (v !== 0) out[name] = Math.min(out[name], v);
  }
  if (scope.limits.ignoreReviewLimitForNew === true) out.ignoreReviewLimitForNew = true;
  return out;
}

// 主进程侧的标签**层级边界前缀**匹配（NFKC 折叠 + 小写 + `::` 边界）：`考研` 命中 `考研` 与 `考研::英语`、
// 不命中 `考研英语`。渲染层与主进程无法共享模块（foldSearch 同款约束），语义源 = src/lib/tags.ts 的
// tagPathMatches，一致性由 tests/d105-scope.test.cjs 对照矩阵锁定。
function scopeTagMatches(tags, prefix) {
  const p = String(prefix ?? "").normalize("NFKC").trim().toLowerCase();
  if (!p) return false;
  return (Array.isArray(tags) ? tags : []).some((t) => {
    const k = String(t ?? "").normalize("NFKC").trim().toLowerCase();
    return k === p || k.startsWith(p + "::");
  });
}

// 摘录行的 tag_json（原始 JSON 串）→ 字符串数组（坏 JSON / 非串元素丢弃，与渲染层 extractTagsOf 同规）
function extractRowTags(x) {
  if (typeof x.tagJson !== "string") return Array.isArray(x.tags) ? x.tags : [];
  try {
    const v = JSON.parse(x.tagJson);
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * KnowledgeBase 归并族展开（只读，D105）：所选 KP id → 匹配集 = 该 KP 所在归并族的全部成员
 * （沿 merged_into 上溯到 active 根 + 并入该根的全部来源；resolveKpFamily 同语义）。
 * 合并不改写卡片 knowledge_point_id（D38 契约），读取侧补语义；不在此表的 id（legacy 键）按精确匹配透传。
 */
function scopeKpFamilySet(kpIds) {
  const wanted = (Array.isArray(kpIds) ? kpIds : []).map(String).filter(Boolean);
  const out = new Set();
  if (wanted.length === 0) return out;
  const rows = queryAll("SELECT id, merged_into FROM knowledge_points WHERE is_deleted = 0");
  const parent = new Map();
  for (const r of rows) parent.set(String(r.id), r.merged_into ? String(r.merged_into) : null);
  const rootOf = (id) => {
    let cur = id;
    const seen = new Set();
    while (parent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = parent.get(cur);
      if (!p) break;
      cur = p;
    }
    return cur;
  };
  const byRoot = new Map();
  for (const id of parent.keys()) {
    const r = rootOf(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(id);
  }
  for (const id of wanted) {
    const members = byRoot.get(rootOf(id));
    if (members) for (const m of members) out.add(m);
    else out.add(id); // 不在 KP 表（legacy 键/已物理清理）→ 精确匹配
  }
  return out;
}

/** 范围过滤（书 / 标签 / 知识点 / 类别；无 scope 时原样返回）。条件间 AND；tags 内多值 OR */
function applyScope(items, scope, kind) {
  if (!scope) return items;
  let out = items;
  if (Array.isArray(scope.bookItemIds) && scope.bookItemIds.length > 0) {
    const allowed = new Set(scope.bookItemIds.map(String));
    out = out.filter((x) => allowed.has(String(x.libraryItemId ?? "")));
  }
  // v48.61（D105）：tags 多值 OR——卡片行匹配 cards.tags_json（mapCardRow 已解析数组）、
  // 摘录行匹配 extracts.tag_json（原始 JSON 串，extractRowTags 解析）
  if (Array.isArray(scope.tags) && scope.tags.length > 0) {
    out = out.filter((x) => {
      const tags = kind === "extract" ? extractRowTags(x) : Array.isArray(x.tags) ? x.tags : [];
      return scope.tags.some((t) => scopeTagMatches(tags, t));
    });
  }
  // v48.61（D105）：kpIds 仅闪卡行命中（摘录行无 KP 字段，不命中）；命中集经 KnowledgeBase 归并族展开
  if (Array.isArray(scope.kpIds) && scope.kpIds.length > 0) {
    const family = scopeKpFamilySet(scope.kpIds);
    out = out.filter((x) => kind === "card" && x.knowledgePointId != null && family.has(String(x.knowledgePointId)));
  }
  if (Array.isArray(scope.kinds) && scope.kinds.length > 0 && !scope.kinds.includes(kind)) out = [];
  return out;
}

/** AI 重排缓存（派生缓存、可重算；**不是调度真源**）：存 settings.app.extracts.aiRerank */
function readAiRerank() {
  try {
    const cache = readSettings().app?.extracts?.aiRerank;
    if (!cache || typeof cache !== "object") return null;
    if (typeof cache.fingerprint !== "string" || !Array.isArray(cache.order)) return null;
    const order = cache.order
      .filter((o) => o && typeof o.id === "string")
      .map((o) => ({ id: String(o.id), reason: typeof o.reason === "string" ? o.reason : "" }));
    if (order.length === 0) return null;
    return { fingerprint: cache.fingerprint, at: Number(cache.at) || 0, order };
  } catch {
    return null;
  }
}

/** 写入 AI 重排缓存（由主进程在 AI 调用成功后调用；指纹不匹配即视为失效） */
function saveAiRerank(fingerprint, order) {
  const all = readSettings();
  const appLayer = all.app && typeof all.app === "object" && !Array.isArray(all.app) ? { ...all.app } : {};
  const exLayer = appLayer.extracts && typeof appLayer.extracts === "object" && !Array.isArray(appLayer.extracts) ? { ...appLayer.extracts } : {};
  exLayer.aiRerank = {
    fingerprint: String(fingerprint),
    at: Date.now(),
    order: (Array.isArray(order) ? order : []).slice(0, 40).map((o) => ({ id: String(o.id), reason: String(o.reason ?? "").slice(0, 120) }))
  };
  appLayer.extracts = exLayer;
  all.app = appLayer;
  writeSettings(all);
  return exLayer.aiRerank;
}

/** 应用 AI 重排：只认指纹匹配的缓存；未提及的条目按本地序追加（不丢条） */
function applyAiRerank(items, cache) {
  if (!cache || cache.fingerprint !== rerankFingerprint(items)) return items;
  const pos = new Map(cache.order.map((o, i) => [o.id, i]));
  const reason = new Map(cache.order.filter((o) => o.reason).map((o) => [o.id, o.reason]));
  return items
    .map((e, i) => ({ e, key: pos.has(e.id) ? pos.get(e.id) : Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ e }) => (reason.has(e.id) ? { ...e, aiReason: reason.get(e.id), engineReason: `AI：${reason.get(e.id)}｜${e.engineReason}` } : e));
}

/**
 * 会话队列（§6.8-3）：卡片 ∪ 摘录的**唯一装配面**（§4.2-26）。
 * **只影响展示、零调度写入**——未放行的条目在库内仍 due（先例＝§4.16 同源延后）。
 * 退化保证：`scope` 为空且余额充足时，`cards` 与 `computeTodayQueue().cards` 逐 id 相等。
 */
/**
 * 复习页顶栏的**今日可用**三档计数（与 computeSessionQueue 同一预算口径，唯一真源在 db 侧）：
 * 未学习＝今天还会发的新卡（受 newCards 额度与结构闸约束）；学习中/待复习＝今天还会发的
 * learning/relearning 与 review 卡。额度用尽的部分**不计**——这三个数回答的是「今天还能刷多少」，
 * 不是「库里有多少」（用户 2026-10-01 选定）。
 */
function computeCardCounts(nowTs, opts) {
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  const o = opts || {};
  const scope = o.scope || null;
  const limits = limitsForScope(readLimits(), scope);
  const remaining = limitsRemaining(limits, getDailyUsage(now));
  const ignore = limits.ignoreReviewLimitForNew;
  const q = computeTodayQueue(now);
  let cardBudget = remaining.cardReviews;
  let newBudget = remaining.newCards;
  const out = { new: 0, learning: 0, review: 0 };
  for (const c of applyScope(q.cards, scope, "card")) {
    const reps = Number(c.fsrs && c.fsrs.reps) || 0;
    const state = String((c.fsrs && c.fsrs.state) || "new");
    if (reps === 0 || state === "new") {
      if (newBudget <= 0) continue;
      if (cardBudget <= 0 && !ignore) continue;
      newBudget -= 1;
      if (cardBudget > 0) cardBudget -= 1;
      out.new += 1;
      continue;
    }
    if (cardBudget <= 0) continue;
    cardBudget -= 1;
    if (state === "learning" || state === "relearning") out.learning += 1;
    else out.review += 1;
  }
  return out;
}

// v48.80（D124 / 设计稿 §9.5 E2）：KP 就绪度因子缓存（派生数据，learnerRefresh 刷新成功后写入；
// 读侧 computeSessionQueue 只在 app.learner.enabled !== false 时使用，否则一律因子 1）
let kpFactorMap = null;
function setKpFactorMap(map) {
  kpFactorMap = map instanceof Map ? map : null;
}

function computeSessionQueue(nowTs, opts) {
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  const o = opts || {};
  const prefs = readSessionPrefs();
  const mergeIntoReview = o.mergeIntoReview === undefined ? prefs.mergeIntoReview : o.mergeIntoReview === true;
  const interleave = INTERLEAVE_MODES.includes(o.interleave) ? o.interleave : prefs.interleave;
  const scope = o.scope || null;
  const limits = limitsForScope(readLimits(), scope);

  const usage = getDailyUsage(now);
  const remaining = limitsRemaining(limits, usage);
  const newBlocked = !limits.ignoreReviewLimitForNew && remaining.cardReviews <= 0;

  const q = computeTodayQueue(now);
  const isNewCard = (c) => (c.fsrs?.reps ?? 0) === 0 || (c.fsrs?.state ?? "new") === "new";
  const cards = [];
  const blockedCards = [];
  let cardBudget = remaining.cardReviews;              // 卡片作答总预算（新卡与复习卡共用）
  let newCardBudget = remaining.newCards;              // 其中「首次作答」的额度
  const ignore = limits.ignoreReviewLimitForNew;
  for (const c of applyScope(q.cards, scope, "card")) {
    if (isNewCard(c)) {
      // 新卡：受新卡额度约束；总预算用尽时**除 ignore 开启外一律停发**（结构闸，Anki 同名选项语义）
      if (newCardBudget <= 0) { blockedCards.push(c); continue; }
      if (cardBudget <= 0 && !ignore) { blockedCards.push(c); continue; }
      newCardBudget -= 1;
      if (cardBudget > 0) cardBudget -= 1;
      cards.push(c);
      continue;
    }
    if (cardBudget <= 0) { blockedCards.push(c); continue; }
    cardBudget -= 1;
    cards.push(c);
  }

  const extracts = [];
  const blockedExtracts = [];
  const sessionEngine = getActiveEngine(o.engine);
  if (mergeIntoReview || scope) {
    let due = applyScope(listDueExtracts(now), scope, "extract");
    // v48.22（D58/D59）：实验引擎生效时按**本地因子**重排（§6.4.1 两段式 E1，确定性、零 IO）；
    // 默认引擎保持 SQL 原序（priority ASC, topic_next_at ASC），存量行为零变更
    if (sessionEngine === ENGINE_AI) {
      // v48.80（D124 / 设计稿 §9.5 E2）：KP 就绪度因子——总开关关闭（lmOn=false）时一律因子 1（E1 原行为）。
      // 开关口径与 learnerRefresh.learnerEnabled() 同源（db.js 不能 require learnerRefresh，两边改动须同步）。
      const lmOn = readSettings().app?.learner?.enabled !== false;
      due = rankExtracts(due, now, {
        kpFactorOf: (id) => (lmOn && kpFactorMap && kpFactorMap.has(String(id)) ? kpFactorMap.get(String(id)) : 1)
      });
      // E1 的 AI 层：消费主进程写下的重排缓存（指纹不符＝候选已变 ⇒ 忽略，回退本地序）
      due = applyAiRerank(due, readAiRerank());
    }
    let extractBudget = remaining.extractReviews;
    let newExtractBudget = newBlocked ? 0 : remaining.newExtracts;
    for (const e of due) {
      if (extracts.length >= extractBudget) { blockedExtracts.push(e); continue; }
      if ((Number(e.processCount) || 0) === 0) {
        if (newExtractBudget <= 0) { blockedExtracts.push(e); continue; }
        newExtractBudget -= 1;
      }
      extracts.push(e);
    }
  }

  const items = [];
  if (!mergeIntoReview) {
    for (const c of cards) items.push({ kind: "card", id: c.id, card: c });
  } else if (interleave === "by-due") {
    const merged = [
      ...cards.map((c) => ({ kind: "card", id: c.id, sortAt: Number(c.fsrs?.due ?? now) || now, card: c })),
      ...extracts.map((e) => ({ kind: "extract", id: e.id, sortAt: Number(e.topicNextAt) || now, extract: e }))
    ].sort(
      (a, b) =>
        a.sortAt - b.sortAt ||
        (a.kind === b.kind ? 0 : a.kind === "card" ? -1 : 1) ||
        String(a.id).localeCompare(String(b.id))
    );
    for (const { sortAt, ...rest } of merged) items.push(rest);
  } else {
    // quota-1-4：每 4 张卡至多插 1 条摘录；卡片耗尽后按序追加（防「卡片不够就永远看不到摘录」死角）
    let ei = 0;
    cards.forEach((c, i) => {
      items.push({ kind: "card", id: c.id, card: c });
      if ((i + 1) % EXTRACT_QUOTA_EVERY === 0 && ei < extracts.length) {
        const e = extracts[ei++];
        items.push({ kind: "extract", id: e.id, extract: e });
      }
    });
    while (ei < extracts.length) {
      const e = extracts[ei++];
      items.push({ kind: "extract", id: e.id, extract: e });
    }
  }

  return {
    items, cards, extracts,
    deferred: q.deferred, damaged: q.damaged,
    blocked: { cards: blockedCards, extracts: blockedExtracts },
    mergeIntoReview, interleave, scope,
    limits, usage, remaining, newBlocked, now,
    engine: sessionEngine
  };
}

// ---------- 统计聚合（stats:overview，只读，不改任何调度状态） ----------
// （UDC 常量已随文件顶部 require("./udc") 导入）

// v23（D21/§4.4.8）：统计的「学习日」起点 = 本地钟面日切点（settings.app.dayCutoffHour，默认 0）。
// 仅统计口径使用；FSRS 调度/训练一律不受切点影响。
function getCutoffHour() {
  const n = Number(readSettings().app?.dayCutoffHour);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 0;
}

function dayStartMs(ts) {
  return learningDayStartMs(ts, getCutoffHour());
}

function getStatsOverview() {
  const now = Date.now();
  const today0 = dayStartMs(now);
  const today24 = today0 + 24 * 3600_000;

  // ---- KPI：今日到期 / 已完成 / 未完成 ----
  // v34（M12 §4.2-20）：与复习队列同一口径（computeSiblingDeferred）——被同源延后的卡不计入
  // 「今日到期」，另列 siblingDeferred「同源暂缓」；两者相加 = 旧口径 due ≤ today24 总数，不静默少卡。
  // 损坏行（fsrs/leech JSON 解析失败）在队列与统计中一致跳过，不再两处口径不同。
  const kpiCards = [];
  for (const row of queryAll(TODAY_QUEUE_SQL)) {
    const mapped = mapCardRow(row);
    // mapCardRow 已不抛（批次 A），原来的 try/catch 会变成永不触发的死代码；
    // 换成显式跳过 damaged 行，否则坏行会被算进 KPI（与 computeTodayQueue 同一口径）。
    if (!mapped || mapped.damaged) continue;
    kpiCards.push({ ...mapped, docTitle: mapped.docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null });
  }
  const active = kpiCards.filter((c) => !c.leech?.suspended);
  const dueTodayCandidates = active.filter((c) => (c.fsrs?.due ?? now) <= today24);
  const kpiDeferred = computeSiblingDeferred(dueTodayCandidates, now);
  const dueToday = dueTodayCandidates.length - kpiDeferred.size;
  const siblingDeferred = kpiDeferred.size;
  const reviewedToday = queryAll("SELECT DISTINCT card_id FROM review_logs WHERE reviewed_at >= ?", [today0]).length;
  // 一次取出今日评过的卡集合，代替原来「每张活卡一条 SELECT」的 N+1（口径不变）
  const reviewedTodaySet = new Set(queryAll("SELECT DISTINCT card_id FROM review_logs WHERE reviewed_at >= ?", [today0]).map((r) => r.card_id));
  const completedToday = active.filter((c) => {
    if ((c.fsrs?.due ?? now) > today24) return false; // 不再被推送
    return reviewedTodaySet.has(c.id); // 今日评过至少一次
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

  // ---- 领域分布（主领域 = domain[0]；按卡计数；v34 起复用 KPI 卡集，domain 已是解析后的数组）----
  const domainCount = {};
  let unclassified = 0;
  for (const c of kpiCards) {
    const d = Array.isArray(c.domain) ? c.domain : [];
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
  // 单卡作答耗时是「秒」量级：上限 10 分钟以内才计入——更长的几乎一定是「卡开着人走了」，
  // 留着会把箱线图量程撑到小时级、把真实的几秒几十秒挤成一条线。
  const durRows = queryAll(
    `SELECT rl.duration_ms AS d, c.domain FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id AND c.is_deleted = 0
     WHERE rl.reviewed_at >= ? AND rl.duration_ms IS NOT NULL AND rl.duration_ms > 0 AND rl.duration_ms <= 600000`,
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
  // 直方图：5 秒一箱 × 12 箱（0–60 秒；最后一箱含 ≥55 秒），前端按秒轴展示
  const durationHist = {};
  for (const v of allDur) {
    const bin = Math.min(11, Math.floor(v / 5_000));
    durationHist[bin] = (durationHist[bin] || 0) + 1;
  }
  const durationBins = Array.from({ length: 12 }, (_, i) => durationHist[i] || 0);
  const durationMedianMs = Math.round(quantile(allDur, 0.5));
  const durationP90Ms = Math.round(quantile(allDur, 0.9));

  // ---- 卡片生命周期漏斗（近 90 天新建的卡；v34 起复用 KPI 卡集，fsrs 已解析）----
  // 阶段单调递减：新建 ⊇ 已开始学（脱离 new）⊇ 进入长期复习（review/relearning）⊇ 已巩固（稳定度 > 21 天）。
  // 原口径把「AI 草稿」与「采纳入队」取同一个数（流转率恒 100%），且把仍在学习步里的卡
  // 漏出「已开始学」——这里改为真实可对账的四段；drafts/entered 字段保留以兼容旧读数。
  const funnelFrom = now - 90 * 86400_000;
  const cohort = kpiCards.filter((c) => c.createdAt >= funnelFrom);
  const funnel = { drafts: cohort.length, entered: cohort.length, created: cohort.length, firstLearned: 0, reviewing: 0, consolidated: 0 };
  for (const c of cohort) {
    const f = c.fsrs || {};
    const st = f.state;
    const started = st === "learning" || st === "review" || st === "relearning" || (f.reps ?? 0) > 0;
    if (started) funnel.firstLearned++;
    if (st === "review" || st === "relearning") funnel.reviewing++;
    if (st === "review" && (f.stability ?? 0) > 21) funnel.consolidated++;
  }

  // ---- 新建卡来源（近 26 周，卡 → 书 × 主领域；库内聚合，不把逐卡行送到渲染层）----
  const srcFrom = now - 182 * 86400_000;
  const srcRows = queryAll(
    `SELECT c.id, c.domain, c.source_ref_json, c.context_ref_json, li.title AS bookTitle
     FROM cards c
     LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0 AND c.created_at >= ?`,
    [srcFrom]
  );
  const srcAgg = new Map();
  const srcLeafMain = {};
  for (const l of UDC_LEAVES) srcLeafMain[l.code] = l.main;
  for (const r of srcRows) {
    let dom = [];
    try { dom = r.domain ? JSON.parse(r.domain) : []; } catch { /* ignore */ }
    let book = r.bookTitle;
    if (!book) {
      try { book = JSON.parse(r.source_ref_json || "null")?.title || null; } catch { book = null; }
    }
    // 领域归到 UDC 主类（叶 → 主类走 UDC_LEAVES 单一来源；原来渲染层另抄了一张写死的映射表）
    const main = dom[0] ? (srcLeafMain[dom[0]] ?? "") : "";
    const key = `${main}\u0000${book || "未知来源"}`;
    const cur = srcAgg.get(key);
    if (cur) cur.count++;
    else srcAgg.set(key, { book: book || "未知来源", main: main || null, count: 1 });
  }
  const sourceBooks = [...srcAgg.values()].sort((a, b) => b.count - a.count);

  // ---- 领域排名（近 6 个自然月，按月；月份轴连续，没复习的月份 rank=0）----
  // 原实现只取「有数据的月份」，而渲染层按「今天往前数 6 个月」打月份标签——中间有空月时
  // 标签与数据整体错位。现在后端直接给出连续月轴 domainRankMonths。
  const rankMonths = [];
  for (let k = 5; k >= 0; k--) {
    const dt = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - k, 1);
    rankMonths.push({ key: `${dt.getFullYear()}-${dt.getMonth() + 1}`, from: dt.getTime(), month: dt.getMonth() + 1 });
  }
  const rankRows = queryAll(
    `SELECT rl.reviewed_at, c.domain FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id AND c.is_deleted = 0
     WHERE rl.reviewed_at >= ?`,
    [rankMonths[0].from]
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
  const monthKeys = rankMonths.map((m) => m.key);
  const allCodes = new Set();
  for (const mk of monthKeys) for (const code of Object.keys(monthMap[mk] || {})) allCodes.add(code);
  const domainRank = [...allCodes].map((code) => ({
    code,
    label: code === "none" ? "未分类" : ((UDC_LEAVES.find((l) => l.code === code) || {}).label || code),
    counts: monthKeys.map((mk) => (monthMap[mk] || {})[code] || 0),
    ranks: monthKeys.map((mk) => {
      const entries = Object.entries(monthMap[mk] || {}).sort((a, b) => b[1] - a[1]);
      const idx = entries.findIndex(([c]) => c === code);
      return idx < 0 ? 0 : idx + 1; // 0 = 当月没有复习
    })
  })).sort((a, b) => {
    const la = a.ranks[a.ranks.length - 1] || 99, lb = b.ranks[b.ranks.length - 1] || 99;
    return la - lb || b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0);
  });
  const domainRankMonths = rankMonths.map((m) => ({ key: m.key, month: m.month }));

  // ---- 月度队列水位（当月）----
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthNew = kpiCards.filter((c) => c.createdAt >= monthStart).length;
  // D-TEST-59/69：这两条按 §7.2 L869「查询一律带 is_deleted = 0」应排除软删卡，原来漏了——
  // 删掉的卡只要当月中被复习/跳过一次，就仍被计进"已完成/已跳过"，月度队列水位因此虚高。
  // 照下方阅读字数那两条的既有写法 JOIN 父表过滤（review_logs/review_skips 自身没有软删位）。
  const monthReviews = queryAll("SELECT COUNT(DISTINCT r.card_id) AS n FROM review_logs r JOIN cards c ON c.id = r.card_id WHERE r.reviewed_at >= ? AND c.is_deleted = 0", [monthStart])[0]?.n || 0;
  const monthSkips = queryAll("SELECT COUNT(DISTINCT s.card_id) AS n FROM review_skips s JOIN cards c ON c.id = s.card_id WHERE s.skipped_at >= ? AND c.is_deleted = 0", [monthStart])[0]?.n || 0;
  // 到期预测：未来 14 个学习日每天到期的**已学过**的卡数（新卡无 due，不计）；早于今天起点的归「逾期」。
  // overdue 此前恒为 0（占位未实现），现按真实到期时刻统计。
  const dueForecast = Array(14).fill(0);
  let overdueCards = 0;
  for (const c of active) {
    const due = c.fsrs?.due;
    if (typeof due !== "number") continue;
    const idx = Math.floor((due - today0) / 86400_000);
    if (idx < 0) overdueCards++;
    else if (idx < 14) dueForecast[idx]++;
  }
  const queueFlow = { carriedOver: Math.max(0, dueToday - monthNew), overdue: overdueCards, newCards: monthNew, completed: monthReviews, skipped: monthSkips, remaining: Math.max(0, dueToday - completedToday) };

  // ---- 阅读字数（近 90 天**含今日** = 90 个日桶，相邻正增量之和）----
  // 批次 B（D-TEST-12）：桶轴必须与 readByDay 的键（dayStartMs）同一坐标系——
  // 原来用 now - 45·day（带当天毫秒）去取日切点键的表，恒取不到，图此恒为 0。
  // 批次 B（D-TEST-23）：JOIN 父表过滤已删书（§7.2 L869「查询一律带 is_deleted = 0」）；
  // reading_events 表本身没有软删位，绝不能写 re.is_deleted。
  const readFrom = today0 - 89 * 86400_000;
  const readRows = queryAll(
    `SELECT re.item_id, re.char_pos, re.created_at FROM reading_events re
     JOIN library_items li ON li.id = re.item_id AND li.is_deleted = 0
     WHERE re.created_at >= ? ORDER BY re.created_at ASC`,
    [readFrom]
  );
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
  // 星期 × 24 个整点（钟面时刻，不受学习日切点影响——节律看的是「几点」）。
  // 原来只开 8–20 点 13 列，早晚复习被夹到两端的列里，曲线端点凭空翘起。
  const rhythmGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const rhythmHours = Array.from({ length: 24 }, () => ({ count: 0, again: 0 }));
  for (const r of rhythmRows) {
    const dt = new Date(r.reviewed_at);
    const weekday = (dt.getDay() + 6) % 7;
    const hour = dt.getHours();
    rhythmGrid[weekday][hour]++;
    rhythmHours[hour].count++;
    if (r.rating === "Again") rhythmHours[hour].again++;
  }

  return {
    kpi: { dueToday, completedToday, pendingToday: Math.max(0, dueToday - completedToday), reviewedToday, streak, minutesToday: Math.round(todayDur / 60000), siblingDeferred },
    heatDays,
    domainMain,
    domainDetail,
    unclassified,
    ratings,
    durationByField,
    durationBins,
    durationMedianMs,
    durationP90Ms,
    funnel,
    sourceBooks,
    domainRank,
    domainRankMonths,
    queueFlow,
    dueForecast,
    readingDays,
    rhythmGrid,
    rhythmHours
  };
}

// ---------- 数据页「一日时间轴」（stats:timeline，只读） ----------
// 把阅读 / 摘录 / 复习 / 制卡 / 日记五类行为聚成「时段块」（口径见 statsTimeline.js 顶部注释）。
// opts: { endDay?: 任一落在目标学习日内的时间戳（缺省=现在）, days?: 1–31（缺省 1；含 endDay 往前共 days 个学习日） }
const statsTimeline = require("./statsTimeline");

function getStatsTimeline(opts) {
  const now = Date.now();
  const days = Math.min(31, Math.max(1, Math.floor(Number(opts?.days) || 1)));
  const endTs = Number.isFinite(Number(opts?.endDay)) && Number(opts?.endDay) > 0 ? Number(opts.endDay) : now;
  const endDay0 = dayStartMs(endTs);
  const start0 = endDay0 - (days - 1) * 86400_000;
  const to = endDay0 + 86400_000;
  const events = [];

  // 复习（卡片）
  for (const r of queryAll(
    `SELECT rl.reviewed_at, rl.duration_ms, rl.rating FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id AND c.is_deleted = 0
     WHERE rl.reviewed_at >= ? AND rl.reviewed_at < ?`,
    [start0, to]
  )) events.push(statsTimeline.reviewEvent(r.reviewed_at, r.duration_ms, r.rating, "card"));

  // 复习（摘录：读后推进 / 推迟 / 毕业；只数摘录，纯高亮不进队列）
  for (const r of queryAll(
    `SELECT o.created_at FROM extract_ops o JOIN extracts e ON e.id = o.extract_id AND e.is_deleted = 0
     WHERE o.created_at >= ? AND o.created_at < ? AND o.op_type IN ('advance','postpone','graduate')
       AND COALESCE(e.kind,'extract') = 'extract'`,
    [start0, to]
  )) events.push(statsTimeline.reviewEvent(r.created_at, 0, null, "extract"));

  // 阅读：与概览同口径（相邻位置的正增量），区间起点前的最后位置作基准
  const readRows = queryAll(
    `SELECT re.item_id, re.char_pos, re.created_at, li.title FROM reading_events re
     JOIN library_items li ON li.id = re.item_id AND li.is_deleted = 0
     WHERE re.created_at >= ? AND re.created_at < ? ORDER BY re.created_at ASC`,
    [start0, to]
  );
  const lastPos = {};
  for (const r of readRows) {
    if (lastPos[r.item_id] === undefined) {
      const prior = queryAll(
        "SELECT char_pos FROM reading_events WHERE item_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1",
        [r.item_id, start0]
      )[0];
      lastPos[r.item_id] = prior ? prior.char_pos : r.char_pos;
    }
    const delta = r.char_pos - lastPos[r.item_id];
    lastPos[r.item_id] = r.char_pos;
    events.push(statsTimeline.readEvent(r.created_at, delta > 0 ? delta : 0, r.title));
  }

  // 摘录（含纯高亮，块详情里分开计数）
  for (const r of queryAll(
    "SELECT created_at, kind FROM extracts WHERE is_deleted = 0 AND created_at >= ? AND created_at < ?",
    [start0, to]
  )) events.push(statsTimeline.pointEvent("extract", r.created_at, r.kind === "highlight" ? { hl: true } : undefined));

  // 制卡
  for (const r of queryAll(
    "SELECT created_at FROM cards WHERE is_deleted = 0 AND created_at >= ? AND created_at < ?",
    [start0, to]
  )) events.push(statsTimeline.pointEvent("card", r.created_at));

  // 日记（草稿不算，发送/保存后才是正式条目）
  for (const r of queryAll(
    "SELECT created_at FROM journal_entries WHERE is_deleted = 0 AND is_draft = 0 AND created_at >= ? AND created_at < ?",
    [start0, to]
  )) events.push(statsTimeline.pointEvent("journal", r.created_at));

  const built = statsTimeline.buildTimeline(events, { dayStart0: start0, days });
  return { now, cutoffHour: getCutoffHour(), ...built };
}

// ---------- v48.85（D129，§4.2-22 / §4.17）：成长反馈只读聚合出口（GrowthReadModel 数据面） ----------
// 分层仿 getStatsTimeline ↔ statsTimeline 先例：本文件只做取数与组装（全部 SELECT、零写路径、零新表，
// §4.17-3 只读不变量），事件判定口径一律在 electron/growth.js 纯函数模块——**禁止在此实现第二套口径**。
// 设计稿 docs/design/GROWTH-FEEDBACK-D129.md §3.3；测试 tests/m13.test.cjs（N-1…N-12）。
const growth = require("./growth");

// 设置读侧：`app.growthFeedback` 对象 {enabled}——**仅严格 false 为关**（含手改文件把整个值写成
// 布尔 false 的形态），缺失/非法/非对象一律回落开（§7.4 v48.85/D129；与 electron/main.js settings:set
// 写侧、src/lib/growthSettings.ts 读侧同规）。
// 关闭＝三出口短路返回 {enabled:false} 且不做任何查询（零渲染零计算，§6.6.2 硬性）。
function growthFeedbackEnabled() {
  const v = readSettings().app?.growthFeedback;
  if (v === false) return false;
  return !(v && typeof v === "object" && !Array.isArray(v) && v.enabled === false);
}

// 成长侧取数的卡行 join（R9：复用 TODAY_QUEUE_SQL 的同一 join 写法——contextRef.documentId → documents →
// library_items；无归属卡不参与书维聚合、仍参与领域维）。只取活跃未删卡；口径与今日队列视图一致。
const GROWTH_CARD_SQL = `SELECT c.*, li.title AS docTitle, li.id AS library_item_id FROM cards c
     LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0 AND COALESCE(c.status, 'active') != 'archived'`;

// review_logs 行 → growth.js 证据行：快照防御性解析，损坏/缺失一律 null（缺快照的 v22 前旧日志
// 不参与判定，§3.2；坏行容错与 mapCardRow/computeTodayQueue 同口径，N-7）。
function mapGrowthLogRow(r) {
  const j = (t) => {
    if (t === null || t === undefined || t === "") return null;
    try {
      const v = JSON.parse(t);
      return v && typeof v === "object" ? v : null;
    } catch { return null; }
  };
  return {
    id: r.id,
    cardId: r.card_id,
    reviewSeq: r.review_seq,
    reviewedAt: r.reviewed_at,
    before: j(r.fsrs_before_json),
    after: j(r.fsrs_after_json),
    leechBefore: j(r.leech_before_json)
  };
}

// 装载一批卡的证据行（卡行 + 各卡全部日志按 review_seq 升序）；fsrs/leech 损坏行按 damaged 跳过（N-7）。
function loadGrowthCardsWithLogs(extraWhere, params) {
  const rows = queryAll(
    `${GROWTH_CARD_SQL}${extraWhere ? ` AND (${extraWhere})` : ""}`,
    params || []
  );
  const byId = new Map();
  for (const r of rows) {
    const mapped = mapCardRow(r);
    if (!mapped || mapped.damaged) continue;
    // docTitle 回补（复审 P1 必修，同 withDocTitleFallback 先例 db.js:1930）：mapCardRow 逐字段构造
    // 不透传 SQL 别名列——GROWTH_CARD_SQL 的 JOIN 书名在此回补（sourceRef 书名回落），否则
    // material 书维 entityLabel/evidence.docTitle 与 Territory 书行 label（§3.1 entityLabel=书名）恒落 UUID。
    byId.set(mapped.id, {
      ...mapped,
      docTitle: r.docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null,
      logs: []
    });
  }
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 400) { // 分批 IN，避免超大集合单语句过长
    const chunk = ids.slice(i, i + 400);
    const ph = chunk.map(() => "?").join(",");
    for (const lr of queryAll(`SELECT * FROM review_logs WHERE card_id IN (${ph}) ORDER BY review_seq ASC`, chunk)) {
      const c = byId.get(lr.card_id);
      if (c) c.logs.push(mapGrowthLogRow(lr));
    }
  }
  return [...byId.values()];
}

// 把一份取数结果并入去重集合（同卡多次命中不同范围时只留一份）。
function mergeGrowthCards(target, extra) {
  for (const c of extra) if (!target.has(c.id)) target.set(c.id, c);
  return target;
}

// 窄范围派生（R2，§3.3）：afterReview 只取「刚评分的卡 + 同组卡 + 所属书/领域活跃卡集」，不触全库。
function loadGrowthAfterReviewScope(card) {
  const scope = new Map();
  const groupKey = card.siblingKey || card.knowledgePointId;
  if (groupKey) {
    mergeGrowthCards(scope, loadGrowthCardsWithLogs("c.sibling_key = ? OR c.knowledge_point_id = ?", [groupKey, groupKey]));
  }
  const dom = Array.isArray(card.domain) && card.domain.length ? String(card.domain[0]) : null;
  const clauses = [];
  const params = [];
  if (card.libraryItemId) { clauses.push("li.id = ?"); params.push(card.libraryItemId); }
  if (dom) { clauses.push("CASE WHEN json_valid(c.domain) THEN json_extract(c.domain, '$[0]') END = ?"); params.push(dom); }
  if (clauses.length) {
    mergeGrowthCards(scope, loadGrowthCardsWithLogs(clauses.join(" OR "), params));
  }
  return scope;
}

// 会话/档案路径的聚合范围：种子卡 ∪ 同组卡 ∪ 书/领域成员（与 afterReview 共用同一批 derive 函数，N-9 一致性）。
function loadGrowthAggregateScope(seedCards) {
  const scope = new Map();
  mergeGrowthCards(scope, seedCards);
  const groupKeys = new Set();
  const bookIds = new Set();
  const doms = new Set();
  for (const c of seedCards) {
    if (c.siblingKey) groupKeys.add(c.siblingKey);
    if (c.knowledgePointId) groupKeys.add(c.knowledgePointId);
    if (c.libraryItemId) bookIds.add(c.libraryItemId);
    if (Array.isArray(c.domain) && c.domain.length) doms.add(String(c.domain[0]));
  }
  if (groupKeys.size) {
    const keys = [...groupKeys];
    const ph = keys.map(() => "?").join(",");
    mergeGrowthCards(scope, loadGrowthCardsWithLogs(`c.sibling_key IN (${ph}) OR c.knowledge_point_id IN (${ph})`, [...keys, ...keys]));
  }
  const clauses = [];
  const params = [];
  if (bookIds.size) {
    const ids = [...bookIds];
    clauses.push(`li.id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (doms.size) {
    const ds = [...doms];
    clauses.push(`CASE WHEN json_valid(c.domain) THEN json_extract(c.domain, '$[0]') END IN (${ds.map(() => "?").join(",")})`);
    params.push(...ds);
  }
  if (clauses.length) mergeGrowthCards(scope, loadGrowthCardsWithLogs(clauses.join(" OR "), params));
  return scope;
}

// 对刚评分的卡派生全部记忆层命中并做防回灌过滤（§4.17-6③ / §3.2）：
// 取该卡最新一条日志的 review_seq 为 triggerSeq，只保留 triggerSeq === 该 seq 的命中——
// 存量历史跨越的 triggerSeq 更小，天然不命中（toast 只消费本出口，R4）。
function getGrowthAfterReview(cardId, now) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!growthFeedbackEnabled()) return { enabled: false }; // 零计算短路：不做任何查询
  const id = String(cardId || "");
  if (!id) return { enabled: true, toast: null, others: [] };
  const rows = queryAll(`${GROWTH_CARD_SQL} AND c.id = ?`, [id]);
  const mapped = rows.length ? mapCardRow(rows[0]) : null;
  if (!mapped || mapped.damaged) return { enabled: true, toast: null, others: [] };
  // docTitle 回补（复审 P1 必修，同 loadGrowthCardsWithLogs）：rows[0] 为原始行（JOIN docTitle 在场），
  // mapCardRow 输出不带该别名列——toast/汇总证据链 evidence.docTitle（§3.1 entityLabel=书名）依赖它。
  const card = {
    ...mapped,
    docTitle: rows[0].docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null,
    logs: queryAll("SELECT * FROM review_logs WHERE card_id = ? ORDER BY review_seq ASC", [id]).map(mapGrowthLogRow)
  };
  const latestSeq = card.logs.length ? card.logs[card.logs.length - 1].reviewSeq : 0;
  const keep = (hits) => hits.filter((h) => Number.isFinite(latestSeq) && h.triggerSeq === latestSeq);
  const hits = keep(growth.deriveCardEvents(card, card.logs, nowMs));
  const scope = loadGrowthAfterReviewScope(card);
  const members = [...scope.values()];
  if (members.length) {
    hits.push(...keep(growth.deriveGroupEvents(members, nowMs)));
    hits.push(...keep(growth.deriveMaterialEvents(members, nowMs)));
  }
  const picked = growth.pickTopEvent(hits);
  return { enabled: true, toast: picked.toast, others: picked.others };
}

// 会话成果汇总（§3.3）：窗口起点 fromTs（ms）→ {enabled, fromTs, hits, folded}。
// 窗口过滤按「触发日志 reviewed_at 落在窗口内」进行；派生一律喂**全量**日志（首达语义需要完整序列，
// 否则会把窗口内本已达成的状态误判成新首达——同防回灌一个道理）。
// hits = 表序可见命中（含 L3——汇总面照常列出）；folded = L2 单日折叠计数（含被折叠完整命中，供展开）。
function getGrowthSessionSummary(fromTs, now) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!growthFeedbackEnabled()) return { enabled: false };
  const from = Number(fromTs) || 0;
  const windowCardIds = queryAll(
    `SELECT DISTINCT r.card_id AS id FROM review_logs r
     JOIN cards c ON c.id = r.card_id
     WHERE r.reviewed_at >= ? AND c.is_deleted = 0 AND COALESCE(c.status, 'active') != 'archived'`,
    [from]
  ).map((r) => r.id);
  if (!windowCardIds.length) return { enabled: true, fromTs: from, hits: [], folded: [] };
  // 分批 IN（复审 P2b 采纳，同 loadGrowthCardsWithLogs 的 400 批先例）：超大窗口避免单语句过长
  const seed = new Map();
  for (let i = 0; i < windowCardIds.length; i += 400) {
    const chunk = windowCardIds.slice(i, i + 400);
    mergeGrowthCards(seed, loadGrowthCardsWithLogs(`c.id IN (${chunk.map(() => "?").join(",")})`, chunk));
  }
  if (!seed.size) return { enabled: true, fromTs: from, hits: [], folded: [] };
  const cards = [...loadGrowthAggregateScope([...seed.values()]).values()];
  const hits = [];
  for (const c of cards) hits.push(...growth.deriveCardEvents(c, c.logs, nowMs));
  hits.push(...growth.deriveGroupEvents(cards, nowMs));
  hits.push(...growth.deriveMaterialEvents(cards, nowMs));
  const inWindow = hits.filter((h) => h.triggerAt >= from);
  const folded = growth.foldSameDay(inWindow, (ts) => dayStartMs(ts)); // 学习日口径 = D23 切点（N-10）
  return { enabled: true, fromTs: from, hits: folded.visible, folded: folded.folded };
}

// 成长总览 / 档案（§3.3）：全库 derive → 近期 L0–L2 档案 + totals + Territory。
// 全库聚合**只**在仪表盘挂载时触发 + 事件驱动防抖刷新（§4.17-6⑥），不进评分路径、不做每评分全量重算。
function getGrowthOverview(opts, now) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const limit = Math.min(200, Math.max(1, Math.floor(Number(opts && opts.limit) || 30)));
  if (!growthFeedbackEnabled()) return { enabled: false };
  const cards = loadGrowthCardsWithLogs("", []);
  const hits = [];
  for (const c of cards) hits.push(...growth.deriveCardEvents(c, c.logs, nowMs));
  hits.push(...growth.deriveGroupEvents(cards, nowMs));
  hits.push(...growth.deriveMaterialEvents(cards, nowMs));
  // 档案只收录 L0–L2（§4.17-7①：Growth Records 不收 L3 与取消项）；按 triggerSeq 倒序（近期在前），limit 截断
  const archive = hits.filter((h) => h.tier <= 2);
  const recentEvents = [...archive].sort((a, b) => b.triggerSeq - a.triggerSeq).slice(0, limit);
  const totals = { l0: 0, l1: 0, l2: 0 };
  for (const h of archive) totals[`l${h.tier}`] += 1;
  return {
    enabled: true,
    now: nowMs,
    cutoffHour: getCutoffHour(),
    recentEvents,
    totals,
    territory: growth.buildTerritory(cards, nowMs),
    knowledge: null // GF-2 预留（§3.5）：阻塞于缺口 G1，契约修订前恒为 null
  };
}

// ---------- v36（M8-A，§6.5 / D34）：日记条目（第二输入通道） ----------
// 三条口径：① `entry_date` = **自然日**（journalTime.journalDateOf；不随学习日切点漂移）；
// ② `is_draft=1` = 「未发送的快速记录草稿」（全局至多一条，库层部分唯一索引兜底）；
// ③ 草稿输入中的自动保存走 `{deferPersist:true}` 节流，其余写入即时 persist（§7.2 唯一例外，理由见 D34）。

let journalPersistDirty = false;

function markJournalPersist(opts) {
  if (opts && opts.deferPersist) {
    journalPersistDirty = true;
    return;
  }
  persist();
}

// 节流落盘（quickCapture 定时调用；隐藏·发送·退出时强制调用）。无待落盘内容返回 false。
function flushJournalPersist() {
  if (!journalPersistDirty) return false;
  journalPersistDirty = false;
  persist();
  return true;
}

function mapJournalRow(r) {
  return {
    id: r.id,
    entryDate: r.entry_date,
    contentMarkdown: r.content_markdown,
    source: r.source,
    isDraft: !!r.is_draft,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at ?? null
  };
}

function getJournalEntry(id) {
  const rows = queryAll("SELECT * FROM journal_entries WHERE id = ? AND is_deleted = 0", [String(id)]);
  return rows.length ? mapJournalRow(rows[0]) : null;
}

// 当前未发送草稿（全局至多一条）；无则 null
function getJournalDraft() {
  const rows = queryAll("SELECT * FROM journal_entries WHERE is_draft = 1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1");
  return rows.length ? mapJournalRow(rows[0]) : null;
}

// 检索折叠（D-TEST-82/83/84）：NFKC 折叠全/半角与兼容字符、合成浊点，再 trim + ASCII 小写。
// 约定：查询侧与被查侧必须用**同一个** fold；渲染层（CardBrowser）用的是它的等价实现，
// 两侧行为一致由 F79 的"两条路径命中集必须相同"守着。
// 这是**匹配用**的折叠，不改用户可见文本——日记与卡片正文逐字不动。
function foldSearch(s) {
  return String(s ?? "").normalize("NFKC").trim().toLowerCase();
}

// 列表：{from,to} 日期闭区间（'YYYY-MM-DD'；含端点）、{query} 内容子串、{limit,offset} 分页。
// 排序固定 = `entry_date DESC, created_at ASC`（日期倒序 / 日组内正序，§6.5.3）；total=同条件总数（分页用）。
function listJournalEntries(opts) {
  const { from, to, query, limit = 200, offset = 0 } = opts ?? {};
  const where = ["is_deleted = 0"];
  const params = [];
  if (from) {
    where.push("entry_date >= ?");
    params.push(String(from));
  }
  if (to) {
    where.push("entry_date <= ?");
    params.push(String(to));
  }
  // D-TEST-82/83/84：改成**查询侧与被查侧用同一个 fold**。
  // 原来只在 SQL 侧把查询词 NFKC 归一、却不归一列里的正文，于是"分解浊点 / 半角片假名 / 全角数字"
  // 这些写法只要不是按同一种形状存的就永远搜不到；而渲染层又是另一套（只 toLowerCase），
  // 同一个词在卡片浏览与日记里给出不同结果。SQLite 没有 NFKC，所以折叠后匹配放到 JS 里做
  // （日记/知识点是数百行量级，与 CardBrowser 客户端过滤同量级）。
  const q = foldSearch(query);
  const sqlWhere = where.join(" AND ");
  const lim = clampLimit(limit, 200, 1000);
  const off = clampOffset(offset);
  if (q) {
    const all = queryAll(`SELECT * FROM journal_entries WHERE ${sqlWhere} ORDER BY entry_date DESC, created_at ASC, id ASC`, params);
    const hit = all.filter((r) => foldSearch(r.content_markdown).includes(q));
    return { entries: hit.slice(off, off + lim).map(mapJournalRow), total: hit.length };
  }
  const total = queryAll(`SELECT COUNT(*) AS n FROM journal_entries WHERE ${sqlWhere}`, params)[0]?.n || 0;
  const rows = queryAll(
    `SELECT * FROM journal_entries WHERE ${sqlWhere} ORDER BY entry_date DESC, created_at ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { entries: rows.map(mapJournalRow), total };
}

// 有内容的日期清单（倒序）+ 每日条数（日记页日期分组与「今日已记 N 条」同源）
function listJournalDates(opts) {
  const { limit = 400 } = opts ?? {};
  const lim = clampLimit(limit, 400, 4000);
  const rows = queryAll(
    `SELECT entry_date AS entryDate, COUNT(*) AS count FROM journal_entries WHERE is_deleted = 0
     GROUP BY entry_date ORDER BY entry_date DESC LIMIT ?`,
    [lim]
  );
  return rows.map((r) => ({ entryDate: r.entryDate, count: r.count }));
}

// 新建条目（日记页输入行=直接成为正式条目；快速记录草稿=isDraft:true）
function createJournalEntry({ contentMarkdown, source = "app", entryDate, isDraft = false, createdAt }, opts) {
  const content = String(contentMarkdown ?? "");
  if (!content.trim()) throw new Error("日记内容为空");
  const now = Date.now();
  const created = Number(createdAt) || now;
  // 批次 D（D-TEST-07，§6.5 自然日归类 + §7.2 数据完整性）：entry_date 只能是合法日历日。
  // isJournalDate 早就在 journalTime.js 里、本文件也早就 require 了它，只是写入前一直没调。
  // 收紧点：非零填充（"2026-3-5"）与不存在的日子（"2026-02-30"）从此拒写；不传时行为逐字节不变。
  const day = entryDate === undefined || entryDate === null || entryDate === "" ? journalDateOf(created) : String(entryDate);
  if (!isJournalDate(day)) throw new Error(`日记日期非法: ${day}`);
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO journal_entries (id, user_id, entry_date, content_markdown, source, is_draft, created_at, updated_at, sent_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      day,
      content,
      String(source),
      isDraft ? 1 : 0,
      created,
      now,
      isDraft ? null : now
    ]
  );
  markJournalPersist(opts);
  return getJournalEntry(id);
}

// 改内容（日记页编辑既有条目；草稿续写也走这里——is_draft / entry_date / created_at 一律不变）
function updateJournalEntry(id, contentMarkdown, opts) {
  const content = String(contentMarkdown ?? "");
  db.run("UPDATE journal_entries SET content_markdown = ?, updated_at = ? WHERE id = ? AND is_deleted = 0", [
    content,
    Date.now(),
    String(id)
  ]);
  markJournalPersist(opts);
  return getJournalEntry(id);
}

// 草稿续写（快速记录输入中，防抖调用）：无草稿则建（entry_date = 首字符自然日，跨日续写不改归属），
// 有则更新；**内容未变直接返回**（幂等，防抖期重复调用零成本）；空内容 = 不建 / 已有则丢弃（软删）。
function saveJournalDraft(contentMarkdown, opts) {
  const content = String(contentMarkdown ?? "");
  const existing = getJournalDraft();
  if (!content.trim()) {
    if (existing) deleteJournalEntry(existing.id);
    return null;
  }
  if (existing) {
    if (existing.contentMarkdown === content) return existing;
    return updateJournalEntry(existing.id, content, opts);
  }
  return createJournalEntry({ contentMarkdown: content, source: "capture", isDraft: true }, opts);
}

// 发送：草稿定格为日记里的一条（is_draft=0 + sent_at=now，entry_date 不变）。返回定格后的条目。
function sendJournalDraft(contentMarkdown) {
  const content = String(contentMarkdown ?? "");
  if (!content.trim()) throw new Error("日记内容为空");
  const draft = getJournalDraft();
  if (!draft) return createJournalEntry({ contentMarkdown: content, source: "capture" });
  const now = Date.now();
  db.run("UPDATE journal_entries SET content_markdown = ?, is_draft = 0, sent_at = ?, updated_at = ? WHERE id = ?", [
    content,
    now,
    now,
    draft.id
  ]);
  markJournalPersist({ deferPersist: false });
  return getJournalEntry(draft.id);
}

// 删除（软删）；草稿的「丢弃」复用同一条路径。软删同时清 is_draft 位（释放全局唯一草稿槽）。
function deleteJournalEntry(id, opts) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("journal_entries", id)) return false;
  db.run("UPDATE journal_entries SET is_deleted = 1, is_draft = 0, updated_at = ? WHERE id = ?", [Date.now(), String(id)]);
  markJournalPersist(opts);
  return true;
}

// v45（M14-UM1，§4.18-11/-16）：水位线增量读取——`updated_at > since` 的已发送条目，时间正序
// （早期记忆珍贵，补处理先建早期处境）。since=null ⇒ 全部历史（首次开启窗口）。草稿永不入包（§4.18-11①）。
function listJournalEntriesSince(opts) {
  const { sinceUpdatedAt = null, limit = 30 } = opts ?? {};
  const lim = clampLimit(limit, 30, 1000);
  const params = [];
  let where = "is_deleted = 0 AND is_draft = 0";
  if (sinceUpdatedAt != null && Number.isFinite(Number(sinceUpdatedAt))) {
    where += " AND updated_at > ?";
    params.push(Number(sinceUpdatedAt));
  }
  const rows = queryAll(
    `SELECT * FROM journal_entries WHERE ${where} ORDER BY updated_at ASC, created_at ASC, id ASC LIMIT ?`,
    [...params, lim]
  );
  return rows.map(mapJournalRow);
}

// ---------- v40（K1，D37 / §4.6）：知识地基 KnowledgeBase（§4.2-23） ----------
// 口径唯一：一切 KP 检索（含 M8-B Evidence Package 的子图展开）必须经本段；读侧零 FSRS 写。
// 关系方向约定：A --prerequisite--> B =「A 是 B 的前置」（学 B 须先会 A）；环检测沿出边 BFS。
// 合并语义（§4.6 item 8）：source 软合入 target——source.status='merged' + merged_into 指向 +
//   alias 并入 target；**不重写既有关系边**（edges 仍指向 source，读取侧经 resolveKpFamily 展开），
//   故 unmerge 可精确回滚（mergeLog 记于 source.metadata_json，还原 status/指针/被并入的 alias）。

const KP_RELATION_TYPES = [
  "prerequisite", "part_of", "related_to", "contrasts_with", "example_of",
  "application_of", "generalization_of", "specialization_of", "analogous_to"
];
const KP_REF_KINDS = ["wikidata-qid", "wikipedia-url", "isbn", "doi", "custom"];
const KP_MERGE_LOG_KEY = "k1MergeLog";

function parseJsonSafe(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

function mapKpRow(r) {
  return {
    id: r.id,
    canonicalLabel: r.canonical_label,
    description: r.description ?? null,
    domainId: r.domain_id ?? null,
    parentKnowledgePointId: r.parent_knowledge_point_id ?? null,
    status: r.status,
    mergedInto: r.merged_into ?? null,
    aliases: parseJsonSafe(r.alias_json, []),
    languageVariants: parseJsonSafe(r.language_variants_json, []),
    confidence: r.confidence ?? null,
    metadata: parseJsonSafe(r.metadata_json, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function mapKpRelationRow(r) {
  return {
    id: r.id,
    fromKnowledgePointId: r.from_knowledge_point_id,
    toKnowledgePointId: r.to_knowledge_point_id,
    relationType: r.relation_type,
    confidence: r.confidence ?? null,
    source: r.source,
    sourceRef: parseJsonSafe(r.source_ref_json, null),
    structureLabel: r.structure_label ?? null,
    mapping: parseJsonSafe(r.mapping_json, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function mapKpProposalRow(r) {
  return {
    id: r.id,
    proposalKind: r.proposal_kind,
    payload: parseJsonSafe(r.payload_json, {}),
    status: r.status,
    confidence: r.confidence ?? null,
    scope: r.scope,
    sourceRunId: r.source_run_id ?? null,
    fingerprint: r.fingerprint ?? null,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null
  };
}

function getKpRow(id) {
  return queryAll("SELECT * FROM knowledge_points WHERE id = ? AND is_deleted = 0", [String(id)])[0] || null;
}

// KP 族解析：id 本身若已被合并 → 顺 merged_into 链上溯到最终 active KP；返回该 active KP 及
// 全部已并入它的来源（含传递）；供关系检索与子图展开用（合并不重写边，读取侧补语义）。
function resolveKpFamily(id) {
  const start = getKpRow(String(id));
  if (!start) return [];
  let rootId = start.id;
  const seen = new Set([rootId]);
  while (true) {
    const row = getKpRow(rootId);
    if (!row || !row.merged_into || seen.has(row.merged_into)) break;
    const target = getKpRow(row.merged_into);
    if (!target) break;
    rootId = target.id;
    seen.add(rootId);
  }
  const family = [rootId];
  // 收尾：并入该 root 的来源（BFS 一层足够——source 必须 active 才能被合并，链深 ≤1）
  const inbound = queryAll(
    "SELECT id FROM knowledge_points WHERE merged_into = ? AND is_deleted = 0",
    [rootId]
  );
  for (const r of inbound) if (!family.includes(r.id)) family.push(r.id);
  return family;
}

// 列表：{query} 命中 canonical_label 或任一 alias（LIKE 子串）；{domainId}/{status} 过滤；
// 排序 = canonical_label 升序（管理面稳定序）；total=同条件总数。
function listKnowledgePoints(opts) {
  const { query, domainId, status, limit = 200, offset = 0 } = opts ?? {};
  const where = ["is_deleted = 0"];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(String(status));
  }
  if (domainId) {
    where.push("domain_id = ?");
    params.push(String(domainId));
  }
  // D-TEST-82/83：与 listJournalEntries 同一处理——查询侧与被查侧共用 foldSearch；
  // 只看 canonical_label 与 alias_json 两列（language_variants_json 仍不参与检索，见 F85 的登记）。
  const q = foldSearch(query);
  const sqlWhere = where.join(" AND ");
  const lim = clampLimit(limit, 200, 1000);
  const off = clampOffset(offset);
  if (q) {
    const all = queryAll(`SELECT * FROM knowledge_points WHERE ${sqlWhere} ORDER BY canonical_label ASC, id ASC`, params);
    const hit = all.filter((r) => foldSearch(r.canonical_label).includes(q) || foldSearch(r.alias_json).includes(q));
    return { points: hit.slice(off, off + lim).map(mapKpRow), total: hit.length };
  }
  const total = queryAll(`SELECT COUNT(*) AS n FROM knowledge_points WHERE ${sqlWhere}`, params)[0]?.n || 0;
  const rows = queryAll(
    `SELECT * FROM knowledge_points WHERE ${sqlWhere} ORDER BY canonical_label ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { points: rows.map(mapKpRow), total };
}

function getKnowledgePoint(id) {
  const row = getKpRow(String(id));
  return row ? mapKpRow(row) : null;
}

// 新建 KP（canonicalLabel 必填；alias 允许与既有 label 重复——§4.6「canonical_label 非唯一事实」）
function createKnowledgePoint(payload, opts) {
  const label = String(payload?.canonicalLabel ?? "").trim();
  if (!label) throw new Error("知识点名称为空");
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO knowledge_points (id, user_id, canonical_label, description, domain_id, parent_knowledge_point_id, status, merged_into, alias_json, language_variants_json, confidence, metadata_json, created_at, updated_at)
     VALUES (?, 'local-user', ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      label,
      payload.description ? String(payload.description) : null,
      payload.domainId ? String(payload.domainId) : null,
      payload.parentKnowledgePointId ? String(payload.parentKnowledgePointId) : null,
      JSON.stringify(Array.isArray(payload.aliases) ? payload.aliases.map(String) : []),
      JSON.stringify(Array.isArray(payload.languageVariants) ? payload.languageVariants.map(String) : []),
      Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      now,
      now
    ]
  );
  persist();
  return getKnowledgePoint(id);
}

// 更新（合并状态不经此路径改：status 只许 active↔deprecated，merged 由 merge/unmerge 独占）
function updateKnowledgePoint(id, patch, opts) {
  const row = getKpRow(String(id));
  if (!row) return null;
  const fields = [];
  const params = [];
  if (patch.canonicalLabel !== undefined) {
    const label = String(patch.canonicalLabel).trim();
    if (!label) throw new Error("知识点名称为空");
    fields.push("canonical_label = ?");
    params.push(label);
  }
  if (patch.description !== undefined) { fields.push("description = ?"); params.push(patch.description ? String(patch.description) : null); }
  if (patch.domainId !== undefined) { fields.push("domain_id = ?"); params.push(patch.domainId ? String(patch.domainId) : null); }
  if (patch.parentKnowledgePointId !== undefined) { fields.push("parent_knowledge_point_id = ?"); params.push(patch.parentKnowledgePointId ? String(patch.parentKnowledgePointId) : null); }
  if (patch.aliases !== undefined) {
    fields.push("alias_json = ?");
    params.push(JSON.stringify(Array.isArray(patch.aliases) ? patch.aliases.map(String) : []));
  }
  if (patch.languageVariants !== undefined) {
    fields.push("language_variants_json = ?");
    params.push(JSON.stringify(Array.isArray(patch.languageVariants) ? patch.languageVariants.map(String) : []));
  }
  if (patch.confidence !== undefined) {
    fields.push("confidence = ?");
    params.push(Number.isFinite(Number(patch.confidence)) ? Number(patch.confidence) : null);
  }
  if (patch.metadata !== undefined) { fields.push("metadata_json = ?"); params.push(patch.metadata ? JSON.stringify(patch.metadata) : null); }
  if (patch.status !== undefined) {
    if (!["active", "deprecated"].includes(patch.status)) throw new Error("status 只能改为 active/deprecated（合并走 merge/unmerge）");
    fields.push("status = ?");
    params.push(patch.status);
  }
  if (!fields.length) return getKnowledgePoint(id);
  fields.push("updated_at = ?");
  params.push(Date.now(), String(id));
  db.run(`UPDATE knowledge_points SET ${fields.join(", ")} WHERE id = ? AND is_deleted = 0`, params);
  persist();
  return getKnowledgePoint(id);
}

// 归一合并：source 并入 target（两者都必须 active 且不同）。返回 {source, target}。
function mergeKnowledgePoints(sourceId, targetId, opts) {
  const src = getKpRow(String(sourceId));
  const tgt = getKpRow(String(targetId));
  if (!src || !tgt) throw new Error("知识点不存在");
  if (src.id === tgt.id) throw new Error("不能合并到自身");
  if (src.status !== "active" || tgt.status !== "active") throw new Error("只有 active 状态的知识点可以合并");
  const now = Date.now();
  const tgtAliases = parseJsonSafe(tgt.alias_json, []);
  // 记录本次并入的 alias（source 自身 label + source aliases 中 target 原本没有的项），供 unmerge 精确还原
  const added = [];
  const candidates = [src.canonical_label, ...parseJsonSafe(src.alias_json, [])];
  for (const a of candidates) {
    if (a && !tgtAliases.includes(a)) { tgtAliases.push(a); added.push(a); }
  }
  const meta = parseJsonSafe(src.metadata_json, {}) || {};
  meta[KP_MERGE_LOG_KEY] = { mergedInto: tgt.id, addedAliases: added, mergedAt: now };
  db.run("UPDATE knowledge_points SET status = 'merged', merged_into = ?, metadata_json = ?, updated_at = ? WHERE id = ?", [
    tgt.id, JSON.stringify(meta), now, src.id
  ]);
  db.run("UPDATE knowledge_points SET alias_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(tgtAliases), now, tgt.id]);
  persist();
  return { source: getKnowledgePoint(src.id), target: getKnowledgePoint(tgt.id) };
}

// 合并回滚（精确还原：status/merged_into/被并入 target 的 alias）
function unmergeKnowledgePoint(sourceId, opts) {
  const src = getKpRow(String(sourceId));
  if (!src) throw new Error("知识点不存在");
  const meta = parseJsonSafe(src.metadata_json, {}) || {};
  const log = meta[KP_MERGE_LOG_KEY];
  if (src.status !== "merged" || !log) throw new Error("该知识点不在已合并状态");
  const tgt = getKpRow(log.mergedInto);
  if (tgt) {
    const removed = new Set(log.addedAliases || []);
    if (removed.size) {
      const kept = parseJsonSafe(tgt.alias_json, []).filter((a) => !removed.has(a));
      db.run("UPDATE knowledge_points SET alias_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(kept), Date.now(), tgt.id]);
    }
  }
  delete meta[KP_MERGE_LOG_KEY];
  db.run("UPDATE knowledge_points SET status = 'active', merged_into = NULL, metadata_json = ?, updated_at = ? WHERE id = ?", [
    Object.keys(meta).length ? JSON.stringify(meta) : null, Date.now(), src.id
  ]);
  persist();
  return getKnowledgePoint(src.id);
}

// ---------- 知识关系边 ----------

// prerequisite 无环校验（KnowledgeLint K3，纯本地写时）：新增/改向 A→B 会成环 ⇔ B 沿既有
// prerequisite 出边可达 A。只沿 prerequisite 方向走；analogous_to 等其余类型不参与（§4.6）。
function wouldCreatePrerequisiteCycle(fromId, toId) {
  if (fromId === toId) return { cycle: true, path: [fromId, toId, fromId] };
  const stack = [{ id: toId, path: [toId] }];
  const seen = new Set([toId]);
  while (stack.length) {
    const cur = stack.pop();
    const nexts = queryAll(
      "SELECT to_knowledge_point_id AS toId FROM knowledge_relations WHERE from_knowledge_point_id = ? AND relation_type = 'prerequisite' AND is_deleted = 0",
      [cur.id]
    );
    for (const n of nexts) {
      const path = [...cur.path, n.toId];
      if (n.toId === fromId) return { cycle: true, path: [fromId, ...path] };
      if (!seen.has(n.toId)) {
        seen.add(n.toId);
        stack.push({ id: n.toId, path });
      }
    }
  }
  return { cycle: false, path: [] };
}

function listKnowledgeRelations(opts) {
  const { kpId, relationType, limit = 500, offset = 0 } = opts ?? {};
  const where = ["is_deleted = 0"];
  const params = [];
  if (kpId) {
    // 合并不重写边：按 KP 族展开（该 KP + 全部并入它的来源）
    const family = resolveKpFamily(String(kpId));
    where.push(`(from_knowledge_point_id IN (${family.map(() => "?").join(",")}) OR to_knowledge_point_id IN (${family.map(() => "?").join(",")}))`);
    params.push(...family, ...family);
  }
  if (relationType) {
    where.push("relation_type = ?");
    params.push(String(relationType));
  }
  const sqlWhere = where.join(" AND ");
  const lim = clampLimit(limit, 500, 2000);
  const off = clampOffset(offset);
  const rows = queryAll(
    `SELECT * FROM knowledge_relations WHERE ${sqlWhere} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { relations: rows.map(mapKpRelationRow) };
}

function createKnowledgeRelation(payload, opts) {
  const type = String(payload?.relationType ?? "");
  if (!KP_RELATION_TYPES.includes(type)) throw new Error(`未知关系类型：${type || "(空)"}`);
  const fromId = String(payload?.fromKnowledgePointId ?? "");
  const toId = String(payload?.toKnowledgePointId ?? "");
  if (!getKpRow(fromId) || !getKpRow(toId)) throw new Error("关系端点的知识点不存在");
  if (fromId === toId) throw new Error("自循环关系一律拒绝（§4.6）");
  const dup = queryAll(
    "SELECT id FROM knowledge_relations WHERE from_knowledge_point_id = ? AND to_knowledge_point_id = ? AND relation_type = ? AND is_deleted = 0",
    [fromId, toId, type]
  );
  if (dup.length) throw new Error("同一对知识点之间已存在同类型关系（唯一约束 from,to,type）");
  if (type === "prerequisite") {
    const check = wouldCreatePrerequisiteCycle(fromId, toId);
    if (check.cycle) throw new Error(`prerequisite 建环被拒绝：${check.path.join(" → ")}`);
  }
  if (type === "analogous_to" && !String(payload?.structureLabel ?? "").trim()) {
    throw new Error("analogous_to 必须带 structureLabel（§4.14）");
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO knowledge_relations (id, user_id, from_knowledge_point_id, to_knowledge_point_id, relation_type, confidence, source, source_ref_json, structure_label, mapping_json, created_at, updated_at)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, fromId, toId, type,
      Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : null,
      String(payload?.source || "user"),
      payload?.sourceRef ? JSON.stringify(payload.sourceRef) : null,
      payload?.structureLabel ? String(payload.structureLabel) : null,
      payload?.mapping ? JSON.stringify(payload.mapping) : null,
      now, now
    ]
  );
  persist();
  const row = queryAll("SELECT * FROM knowledge_relations WHERE id = ?", [id])[0];
  return mapKpRelationRow(row);
}

function deleteKnowledgeRelation(id, opts) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("knowledge_relations", id)) return false;
  db.run("UPDATE knowledge_relations SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), String(id)]);
  persist();
  return true;
}

// ---------- 外部 ID grounding ----------

function listKnowledgeExternalRefs(kpId) {
  const rows = queryAll(
    "SELECT * FROM knowledge_external_refs WHERE knowledge_point_id = ? AND is_deleted = 0 ORDER BY created_at ASC",
    [String(kpId)]
  );
  return rows.map((r) => ({
    id: r.id,
    knowledgePointId: r.knowledge_point_id,
    refKind: r.ref_kind,
    refValue: r.ref_value,
    sourceLabel: r.source_label ?? null,
    createdAt: r.created_at
  }));
}

function createKnowledgeExternalRef(payload, opts) {
  const kpId = String(payload?.knowledgePointId ?? "");
  if (!getKpRow(kpId)) throw new Error("知识点不存在");
  const kind = String(payload?.refKind ?? "");
  if (!KP_REF_KINDS.includes(kind)) throw new Error(`未知外部 ID 类型：${kind || "(空)"}`);
  const value = String(payload?.refValue ?? "").trim();
  if (!value) throw new Error("外部 ID 值为空");
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO knowledge_external_refs (id, user_id, knowledge_point_id, ref_kind, ref_value, source_label, created_at) VALUES (?, 'local-user', ?, ?, ?, ?, ?)",
    [id, kpId, kind, value, payload?.sourceLabel ? String(payload.sourceLabel) : null, Date.now()]
  );
  persist();
  return { id, knowledgePointId: kpId, refKind: kind, refValue: value, sourceLabel: payload?.sourceLabel ?? null };
}

function deleteKnowledgeExternalRef(id, opts) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("knowledge_external_refs", id)) return false;
  db.run("UPDATE knowledge_external_refs SET is_deleted = 1 WHERE id = ?", [String(id)]);
  persist();
  return true;
}

// ---------- 提案暂存（staging，§1.7） ----------

function listKnowledgeProposals(opts) {
  const { status = "pending", proposalKind, limit = 200, offset = 0 } = opts ?? {};
  const where = ["is_deleted = 0"];
  const params = [];
  if (status) { where.push("status = ?"); params.push(String(status)); }
  if (proposalKind) { where.push("proposal_kind = ?"); params.push(String(proposalKind)); }
  const sqlWhere = where.join(" AND ");
  const lim = clampLimit(limit, 200, 1000);
  const off = clampOffset(offset);
  const rows = queryAll(
    `SELECT * FROM knowledge_proposals WHERE ${sqlWhere} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { proposals: rows.map(mapKpProposalRow) };
}

function createKnowledgeProposal(payload, opts) {
  const kind = String(payload?.proposalKind ?? "");
  if (!["point", "relation", "merge"].includes(kind)) throw new Error(`未知提案类型：${kind || "(空)"}`);
  if (!payload?.payload || typeof payload.payload !== "object") throw new Error("提案缺少 payload");
  // v41（K2-A，D38）：幂等键——同指纹（任何状态，含已拒绝）已存在即跳过，返回既有行（created:false）
  const fp = String(payload.fingerprint || "") || kpFingerprintFor(kind, payload.payload);
  if (fp) {
    const dup = queryAll("SELECT * FROM knowledge_proposals WHERE fingerprint = ? AND is_deleted = 0 LIMIT 1", [fp])[0];
    if (dup) return { ...mapKpProposalRow(dup), created: false };
  }
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO knowledge_proposals (id, user_id, proposal_kind, payload_json, status, confidence, scope, source_run_id, fingerprint, created_at)
     VALUES (?, 'local-user', ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [
      id,
      kind,
      JSON.stringify(payload.payload),
      Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : null,
      String(payload?.scope || "manual"),
      payload?.sourceRunId ? String(payload.sourceRunId) : null,
      fp || null,
      Date.now()
    ]
  );
  persist();
  return { ...mapKpProposalRow(queryAll("SELECT * FROM knowledge_proposals WHERE id = ?", [id])[0]), created: true };
}

// 提案指纹（v41，D38）：按提案类型取「与判定语义相关的部件」，与 AI 跑几次无关。
// point：动作 + 归一标签 + 涉及的簇键（排序，run 内顺序无关）；link 另含目标 KP。
// relation：两端点键（kpId | norm:标签 | cluster:簇键）+ 关系类型。merge：两端 KP id。
function kpFingerprintFor(kind, payload) {
  const p = payload || {};
  if (kind === "point") {
    const clusterKeys = (Array.isArray(p.clusters) ? p.clusters.map((c) => c?.clusterKey) : [p.clusterKey]).filter(Boolean).sort();
    const parts = [p.action || "create", normalizeKpLabel(p.canonicalLabel || p.legacyKey || ""), ...clusterKeys];
    if (p.action === "link" && p.targetKpId) parts.push(`target:${p.targetKpId}`);
    return kpProposalFingerprint("point", parts);
  }
  if (kind === "relation") {
    const endpointKey = (e) => {
      if (!e) return "?";
      if (e.kpId) return `kp:${e.kpId}`;
      if (e.knowledgePointId) return `kp:${e.knowledgePointId}`;
      if (e.clusterKey) return `cluster:${e.clusterKey}`;
      return `norm:${normalizeKpLabel(e.label || e.normKey || "")}`;
    };
    const from = endpointKey(p.fromRef) || (p.fromKnowledgePointId ? `kp:${p.fromKnowledgePointId}` : "?");
    const to = endpointKey(p.toRef) || (p.toKnowledgePointId ? `kp:${p.toKnowledgePointId}` : "?");
    return kpProposalFingerprint("relation", [from, to, p.relationType || ""]);
  }
  if (kind === "merge") return kpProposalFingerprint("merge", [p.sourceId || "", p.targetId || p.targetKpId || ""]);
  return "";
}

// 提案决议：accept=true 按 proposalKind 应用到正式表（失败 throw 整体回滚语义由调用方 IPC 拒绝承担），
// accept=false 仅标记 rejected。提案本身永不直接改 FSRS/LKM 证据。
// v40.1：overridePayload（可选）——UI 在接受前允许用户修订 payload（如把无语义的旧簇 ID「kp1」
// 改成正式名称），与库内 payload 浅合并后生效；决议行同时落修订后的 payload 留痕。
function resolveKnowledgeProposal(id, accept, overridePayload, opts) {
  const rows = queryAll("SELECT * FROM knowledge_proposals WHERE id = ? AND is_deleted = 0", [String(id)]);
  const prop = rows[0] ? mapKpProposalRow(rows[0]) : null;
  if (!prop) throw new Error("提案不存在");
  if (prop.status !== "pending") throw new Error("提案已决议");
  if (overridePayload && typeof overridePayload === "object") {
    prop.payload = { ...prop.payload, ...overridePayload };
    db.run("UPDATE knowledge_proposals SET payload_json = ? WHERE id = ?", [JSON.stringify(prop.payload), String(id)]);
  }
  let applied = null;
  if (accept) {
    if (prop.proposalKind === "point") {
      if (prop.payload.action === "link") {
        // link 提案（K1 迁移或 K2-A 语义归一）：目标 KP 确定存在 → 别名额并入（确定性），不新建
        applied = applyPointLinkProposal(prop.payload);
      } else {
        // create 提案：payload.domain 为数组（AI 输出形状）→ domainId 取首个；description 直传
        const domainId = prop.payload.domainId || (Array.isArray(prop.payload.domain) ? prop.payload.domain[0] : null);
        applied = createKnowledgePoint({ ...prop.payload, domainId });
      }
    } else if (prop.proposalKind === "relation") {
      let pl = prop.payload;
      if (!pl.fromKnowledgePointId || !pl.toKnowledgePointId) {
        const fixed = tryResolveRelationPayload(pl);
        if (!fixed) throw new Error("关系端点尚未归一（先接受对应的知识点提案，再重试本提案）");
        pl = fixed;
        db.run("UPDATE knowledge_proposals SET payload_json = ? WHERE id = ?", [JSON.stringify(pl), String(id)]);
      }
      applied = createKnowledgeRelation(pl);
    } else if (prop.proposalKind === "merge") {
      applied = mergeKnowledgePoints(prop.payload.sourceId, prop.payload.targetId);
    }
    // 点提案落地后：把等待该端点的 pending 关系提案补全（确定性重解析）
    if (prop.proposalKind === "point") {
      const n = resolvePendingRelationRefs();
      if (applied && typeof applied === "object") applied = { ...applied, relationRefsResolved: n };
    }
  }
  db.run("UPDATE knowledge_proposals SET status = ?, resolved_at = ? WHERE id = ?", [accept ? "accepted" : "rejected", Date.now(), String(id)]);
  persist();
  return { proposal: mapKpProposalRow(queryAll("SELECT * FROM knowledge_proposals WHERE id = ?", [String(id)])[0]), applied };
}

// ---------- v41（K2-A，D38 / §4.6「AI 抽取归一硬性规范」）：三层确定性架构的数据层 ----------
// 入层=本地规范化收敛（normKey）；中层=AI 封闭契约提案（渲染层编排，主进程不拼提示词）；
// 出层=本地裁决器（applyKpExtraction）——AI 跑几次结果不变由本段规则保证。

// 卡片簇列举：按批次簇键分组（batch>doc>legacy），并标注「已归一」（normKey 命中 active KP
// 或已有提案引用该簇——任何状态，含已拒绝=否决即事实）。AI 整理与本地迁移建议都从这里取输入。
function listKpClusters() {
  const cards = queryAll(
    `SELECT id, knowledge_point_id, gen_batch_id, context_ref_json, card_type, front_markdown, domain, context_prefix
     FROM cards WHERE is_deleted = 0 AND knowledge_point_id IS NOT NULL AND TRIM(knowledge_point_id) != '' LIMIT 5000`
  );
  const clusters = new Map();
  for (const c of cards) {
    const ref = parseJsonSafe(c.context_ref_json, null);
    const documentId = ref?.documentId || null;
    const clusterKey = kpClusterKeyFor({ genBatchId: c.gen_batch_id, documentId, knowledgePointId: c.knowledge_point_id });
    if (!clusterKey) continue;
    let cl = clusters.get(clusterKey);
    if (!cl) {
      cl = { clusterKey, legacyKey: String(c.knowledge_point_id), documentId, genBatchId: c.gen_batch_id || null, cardIds: [], cardCount: 0, samples: [] };
      clusters.set(clusterKey, cl);
    }
    cl.cardIds.push(c.id);
    cl.cardCount++;
    if (cl.samples.length < 3) {
      let dom = [];
      try { dom = c.domain ? JSON.parse(c.domain) : []; } catch { /* 容忍坏行 */ }
      cl.samples.push({ cardId: c.id, cardType: c.card_type, front: String(c.front_markdown || "").slice(0, 120), contextPrefix: c.context_prefix || null, domain: dom });
    }
  }
  // 「已归一」判定（确定性）
  const activeKps = queryAll("SELECT canonical_label, alias_json FROM knowledge_points WHERE status = 'active' AND is_deleted = 0");
  const normIndex = new Set();
  for (const kp of activeKps) {
    normIndex.add(normalizeKpLabel(kp.canonical_label));
    for (const a of parseJsonSafe(kp.alias_json, [])) normIndex.add(normalizeKpLabel(a));
  }
  const handled = new Set();
  for (const p of queryAll("SELECT payload_json FROM knowledge_proposals WHERE is_deleted = 0")) {
    const pl = parseJsonSafe(p.payload_json, {});
    if (pl?.legacyKey && !isOpaqueClusterId(pl.legacyKey)) handled.add(String(pl.legacyKey));
    if (pl?.clusterKey) handled.add(String(pl.clusterKey));
    for (const c of Array.isArray(pl?.clusters) ? pl.clusters : []) {
      if (c?.clusterKey) handled.add(String(c.clusterKey));
      if (c?.legacyKey && !isOpaqueClusterId(c.legacyKey)) handled.add(String(c.legacyKey));
    }
  }
  const all = [...clusters.values()].map((cl) => ({
    ...cl,
    normalized: normIndex.has(normalizeKpLabel(cl.legacyKey)) || handled.has(cl.clusterKey) || handled.has(String(cl.legacyKey))
  }));
  const unnormalized = all.filter((c) => !c.normalized);
  return { clusters: all, unnormalized, total: all.length, totalUnnormalized: unnormalized.length, totalCards: cards.length };
}

// 候选 KP 清单（cap 60，新的在前）——AI 的 link 目标只能从这份清单里选（禁止编造 ID）
function kpExtractionCandidates(limit = 60) {
  return queryAll(
    "SELECT id, canonical_label, alias_json, domain_id FROM knowledge_points WHERE status = 'active' AND is_deleted = 0 ORDER BY updated_at DESC LIMIT ?",
    [Math.max(1, Math.min(200, Number(limit) || 60))]
  ).map((r) => ({ id: r.id, canonicalLabel: r.canonical_label, aliases: parseJsonSafe(r.alias_json, []), domainId: r.domain_id ?? null }));
}

// AI 输入装配（主进程）：待归一簇 + 候选 KP 清单。可选按 clusterKeys / sources 过滤（制卡顺带路径）。
function buildKpExtractionInput({ clusterKeys, sources } = {}) {
  const { unnormalized } = listKpClusters();
  let pools = unnormalized;
  if (Array.isArray(clusterKeys) && clusterKeys.length) {
    const want = new Set(clusterKeys.map(String));
    pools = pools.filter((c) => want.has(c.clusterKey));
  } else if (Array.isArray(sources) && sources.length) {
    const want = new Set();
    for (const s of sources) {
      const key = kpClusterKeyFor({ genBatchId: s?.genBatchId, documentId: s?.documentId, knowledgePointId: s?.knowledgePointId });
      if (key) want.add(key);
    }
    pools = pools.filter((c) => want.has(c.clusterKey));
  }
  const clusters = pools.slice(0, 40); // 单次上限（代价与上下文控制）
  const candidates = kpExtractionCandidates(60);
  const docIds = [...new Set(clusters.map((c) => c.documentId).filter(Boolean))];
  const titleByDoc = new Map();
  if (docIds.length) {
    const ph = docIds.map(() => "?").join(",");
    for (const r of queryAll(`SELECT d.id AS documentId, li.title FROM documents d JOIN library_items li ON li.id = d.library_item_id WHERE d.id IN (${ph})`, docIds)) {
      titleByDoc.set(r.documentId, r.title);
    }
  }
  const lines = [];
  lines.push(`【待归一卡片簇】（每个簇 = 一次制卡动作在同一材料内产生的一组卡；clusterKey 必须原样回抄）`);
  if (clusters.length === 0) lines.push("（本次没有待归一的簇）");
  for (const cl of clusters) {
    lines.push(`- clusterKey=${cl.clusterKey}（${cl.cardCount} 张卡${cl.documentId && titleByDoc.get(cl.documentId) ? `，来自《${titleByDoc.get(cl.documentId)}》` : ""}）`);
    for (const s of cl.samples) {
      lines.push(`  · 卡面：${s.contextPrefix ? `${s.contextPrefix} ` : ""}${s.front}`);
    }
  }
  lines.push("");
  lines.push(`【已有知识点候选】（action="link" 时 targetKpId 只能从下列 id 原样选择；没有任何候选时只能 create/skip）`);
  if (candidates.length === 0) lines.push("（知识库还没有正式知识点）");
  for (const kp of candidates) {
    lines.push(`- id=${kp.id} 「${kp.canonicalLabel}」${kp.aliases.length ? `（别名：${kp.aliases.join("、")}）` : ""}${kp.domainId ? ` [领域 ${kp.domainId}]` : ""}`);
  }
  const extractionInput = lines.join("\n");
  // 关系输入：候选 KP + 本次新簇的建议位（AI 只能在这两类端点间连边）
  const relLines = [];
  relLines.push("【关系抽取输入】");
  relLines.push("可用端点 A（已有知识点，id 原样引用）：");
  if (candidates.length === 0) relLines.push("（无）");
  for (const kp of candidates) relLines.push(`- kpId=${kp.id} 「${kp.canonicalLabel}」`);
  relLines.push("可用端点 B（本次待归一簇，用 clusterKey 引用；它们将作为新知识点）：");
  if (clusters.length === 0) relLines.push("（无）");
  for (const cl of clusters) relLines.push(`- clusterKey=${cl.clusterKey}（${cl.samples[0]?.front || cl.legacyKey}）`);
  const relationInput = clusters.length ? relLines.join("\n") : "";
  return { extractionInput, relationInput, clusterCount: clusters.length, candidateCount: candidates.length, clusterKeys: clusters.map((c) => c.clusterKey) };
}

// 端点引用解析：kpId 必须命中候选；clusterKey 必须在本 run 的簇集合内；label 走 normKey 命中 active KP。
function resolveRelationEndpoint(ref, { candidateIds, runClusterKeys }) {
  if (!ref) return null;
  if (ref.kpId && candidateIds.has(String(ref.kpId))) return { kpId: String(ref.kpId) };
  if (ref.clusterKey && runClusterKeys.has(String(ref.clusterKey))) return { clusterKey: String(ref.clusterKey), label: ref.label ? String(ref.label) : "" };
  if (ref.label) {
    const norm = normalizeKpLabel(ref.label);
    for (const kp of queryAll("SELECT id, canonical_label, alias_json FROM knowledge_points WHERE status = 'active' AND is_deleted = 0")) {
      const keys = [normalizeKpLabel(kp.canonical_label), ...parseJsonSafe(kp.alias_json, []).map(normalizeKpLabel)];
      if (keys.includes(norm)) return { kpId: kp.id };
    }
    return { label: String(ref.label), normKey: norm };
  }
  return null;
}

// 已解析端点补 kpId（等待补全的 pending 关系提案在点提案被接受后调用）；返回更新后的 payload 或 null（仍未解析）。
// 簇引用且无 normKey 时，先反查「引用该簇的点提案」的 canonicalLabel 补 normKey（两种顺序都能收敛：
// 先建关系后抽簇 / 先抽簇后建关系）。
function tryResolveRelationPayload(payload) {
  const fix = (ref) => {
    if (!ref) return null;
    let r = ref;
    if (!r.kpId && !r.normKey && r.clusterKey) {
      for (const p of queryAll("SELECT payload_json FROM knowledge_proposals WHERE proposal_kind = 'point' AND is_deleted = 0")) {
        const pl = parseJsonSafe(p.payload_json, {});
        if ((Array.isArray(pl.clusters) ? pl.clusters : []).some((c) => c.clusterKey === r.clusterKey) && pl.canonicalLabel) {
          r = { ...r, label: pl.canonicalLabel, normKey: normalizeKpLabel(pl.canonicalLabel) };
          break;
        }
      }
    }
    if (r.kpId) return r;
    const norm = r.normKey || normalizeKpLabel(r.label || "");
    if (!norm) return null;
    for (const kp of queryAll("SELECT id, canonical_label, alias_json FROM knowledge_points WHERE status = 'active' AND is_deleted = 0")) {
      const keys = [normalizeKpLabel(kp.canonical_label), ...parseJsonSafe(kp.alias_json, []).map(normalizeKpLabel)];
      if (keys.includes(norm)) return { ...r, kpId: kp.id };
    }
    return null;
  };
  const from = fix(payload.fromRef) || (payload.fromKnowledgePointId ? { kpId: payload.fromKnowledgePointId } : null);
  const to = fix(payload.toRef) || (payload.toKnowledgePointId ? { kpId: payload.toKnowledgePointId } : null);
  if (!from?.kpId || !to?.kpId) return null;
  return { ...payload, fromRef: from, toRef: to, fromKnowledgePointId: from.kpId, toKnowledgePointId: to.kpId };
}

// 关系端点重解析（确定性）：点提案被接受 → 新 KP 落库 → 把 pending 关系提案里等待该端点的引用补全。
function resolvePendingRelationRefs() {
  let filled = 0;
  const rows = queryAll("SELECT * FROM knowledge_proposals WHERE proposal_kind = 'relation' AND status = 'pending' AND is_deleted = 0");
  for (const r of rows) {
    const pl = parseJsonSafe(r.payload_json, {});
    if (pl?.fromKnowledgePointId && pl?.toKnowledgePointId) continue;
    const fixed = tryResolveRelationPayload(pl);
    if (fixed) {
      db.run("UPDATE knowledge_proposals SET payload_json = ? WHERE id = ?", [JSON.stringify(fixed), r.id]);
      filled++;
    }
  }
  if (filled) persist();
  return filled;
}

// 点提案 link 落地（确定性别名并入）：canonicalLabel（AI 归一结果）+ 非编号 legacy 值 + AI 别名。
// 无语义簇编号（kp1）不做别名——跨书必然碰撞，做别名有害；「已归一」由提案记录本身承担。
function applyPointLinkProposal(payload) {
  const targetId = String(payload?.targetKpId || "");
  const tgt = getKpRow(targetId);
  if (!tgt) throw new Error("link 目标知识点不存在");
  const aliases = parseJsonSafe(tgt.alias_json, []);
  const added = [];
  const want = [payload.canonicalLabel, ...(Array.isArray(payload.aliases) ? payload.aliases : [])].filter(Boolean).map(String);
  for (const cl of Array.isArray(payload.clusters) ? payload.clusters : []) {
    if (cl?.legacyKey && !isOpaqueClusterId(cl.legacyKey)) want.push(String(cl.legacyKey));
  }
  if (payload.legacyKey && !payload.clusters && !isOpaqueClusterId(payload.legacyKey)) want.push(String(payload.legacyKey));
  for (const a of want) {
    if (!aliases.includes(a) && normalizeKpLabel(a) !== normalizeKpLabel(tgt.canonical_label)) {
      aliases.push(a);
      added.push(a);
    }
  }
  if (added.length) {
    db.run("UPDATE knowledge_points SET alias_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(aliases), Date.now(), tgt.id]);
  }
  return { target: getKnowledgePoint(tgt.id), addedAliases: added };
}

// 本地裁决器（出层）：吃 AI 原始输出（容忍杂质 JSON），产出确定性结果——
// 自动归一（normKey 精确命中）/ 强制转 link（AI 新名撞已有 KP）/ run 内同名簇合并为一条提案 /
// 目标歧义或越界转 pending / prerequisite 建环丢弃 / 指纹幂等（重复跑零新增）。
function applyKpExtraction(rawExtraction, rawRelations) {
  const { unnormalized } = listKpClusters();
  const clusterByKey = new Map(unnormalized.map((c) => [c.clusterKey, c]));
  const runClusterKeys = new Set(clusterByKey.keys());
  const candidates = kpExtractionCandidates(200);
  const candidateIds = new Set(candidates.map((c) => c.id));
  // normKey → KP 索引（AI 新名撞已有 → 强制转 link 的依据）
  const normIndex = new Map();
  for (const kp of queryAll("SELECT id, canonical_label, alias_json FROM knowledge_points WHERE status = 'active' AND is_deleted = 0")) {
    normIndex.set(normalizeKpLabel(kp.canonical_label), kp.id);
    for (const a of parseJsonSafe(kp.alias_json, [])) {
      const n = normalizeKpLabel(a);
      if (n && !normIndex.has(n)) normIndex.set(n, kp.id);
    }
  }
  const summary = { autoLinked: [], created: [], linked: [], relations: [], conflicts: [], skipped: [], rejectedDuplicate: 0, dedupSkipped: 0 };
  // ---- 抽取项裁决 ----
  const items = Array.isArray(parseJsonSafeLoose(rawExtraction)?.items) ? parseJsonSafeLoose(rawExtraction).items : [];
  // run 内按 normKey 聚合：同名的多个簇合成一条提案（clusters[]）
  const grouped = new Map(); // groupKey -> { action, normKey, canonicalLabel, aliases, domain, description, confidence, evidence, clusters[], targetKpId, autoLinkedKpId }
  for (const it of items) {
    const clusterKey = String(it?.clusterKey || "");
    const cl = clusterByKey.get(clusterKey);
    if (!cl) { summary.skipped.push({ clusterKey, reason: "簇不存在或已归一" }); continue; }
    const action = String(it?.action || "create");
    if (action === "skip") { summary.skipped.push({ clusterKey, reason: "AI 判定 skip" }); continue; }
    const label = String(it?.canonicalLabel || "").trim();
    const normKey = normalizeKpLabel(label);
    if (!normKey) { summary.skipped.push({ clusterKey, reason: "标签为空" }); continue; }
    const domain = sanitizeDomain(Array.isArray(it?.domain) ? it.domain : []);
    const aliases = (Array.isArray(it?.aliases) ? it.aliases : []).map(String).filter((a) => normalizeKpLabel(a) !== normKey).slice(0, 4);
    const confidence = Number.isFinite(Number(it?.confidence)) ? Number(it.confidence) : null;
    const evidence = it?.evidence ? String(it.evidence).slice(0, 200) : "";
    // 目标：AI 给的 id 必须命中候选清单，越界即失效（禁止编造 ID）
    let targetKpId = it?.targetKpId && candidateIds.has(String(it.targetKpId)) ? String(it.targetKpId) : null;
    const targetInvalid = Boolean(it?.targetKpId) && !targetKpId;
    const hitKpId = normIndex.get(normKey) || null;
    // 判定（D38 裁决规则）
    let finalAction = action;
    let finalTarget = targetKpId;
    if (hitKpId && targetKpId && hitKpId !== targetKpId) {
      // ① 新名撞已有 KP 且与 AI 目标不一致 → 歧义 → pending（不自动）
      summary.conflicts.push({ clusterKey, canonicalLabel: label, hitKpId, targetKpId, reason: "新名与已有知识点同名但 AI 目标不同" });
    } else if (hitKpId) {
      // ② normKey 精确命中（或 AI 目标与命中一致）→ 确定性自动归一
      grouped.set(`auto:${hitKpId}:${normKey}`, {
        autoLinkedKpId: hitKpId, action: "link", normKey, canonicalLabel: label, aliases, domain, confidence, evidence, clusters: [], targetKpId: hitKpId, targetInvalid
      });
      // 自动归一独立成组：必须 continue，否则会继续走下方 link/create 分组逻辑（簇证据丢失/重复提案）
      const autoG = grouped.get(`auto:${hitKpId}:${normKey}`);
      if (!autoG.clusters.some((c) => c.clusterKey === clusterKey)) {
        autoG.clusters.push({ clusterKey, legacyKey: cl.legacyKey, documentId: cl.documentId, cardIds: cl.cardIds, cardCount: cl.cardCount });
      }
      continue;
    } else if (targetKpId) {
      finalAction = "link";
    } else if (targetInvalid) {
      finalAction = "create"; // 目标越界 → 降级 create（本地裁定，不自动）
    }
    const key = finalAction === "link" ? `link:${finalTarget}:${normKey}` : `create:${normKey}`;
    const g = grouped.get(key) || {
      action: finalAction, normKey, canonicalLabel: label, aliases, domain, description: it?.description ? String(it.description).slice(0, 120) : null,
      confidence, evidence, clusters: [], targetKpId: finalAction === "link" ? finalTarget : null, targetInvalid, autoLinkedKpId: null
    };
    g.aliases = [...new Set([...g.aliases, ...aliases])].slice(0, 4);
    g.confidence = Math.max(Number(g.confidence) || 0, Number(confidence) || 0) || g.confidence;
    if (!g.clusters.some((c) => c.clusterKey === clusterKey)) {
      g.clusters.push({ clusterKey, legacyKey: cl.legacyKey, documentId: cl.documentId, cardIds: cl.cardIds, cardCount: cl.cardCount });
    }
    grouped.set(key, g);
  }
  // ---- 分组落地：自动归一直接写（确定性）；其余进提案（指纹幂等） ----
  for (const g of grouped.values()) {
    const clusters = g.clusters;
    if (g.autoLinkedKpId) {
      try {
        const res = applyPointLinkProposal({ targetKpId: g.autoLinkedKpId, canonicalLabel: g.canonicalLabel, aliases: g.aliases, clusters });
        const prop = createKnowledgeProposal({
          proposalKind: "point",
          scope: "ai-extraction",
          confidence: g.confidence,
          payload: { action: "link", auto: true, canonicalLabel: g.canonicalLabel, targetKpId: g.autoLinkedKpId, aliases: g.aliases, evidence: g.evidence, clusters }
        });
        // 自动归一免确认：落一条已接受提案留痕（指纹幂等，重复跑不新增）
        if (prop.created) {
          db.run("UPDATE knowledge_proposals SET status = 'accepted', resolved_at = ? WHERE id = ?", [Date.now(), prop.id]);
          persist();
        }
        summary.autoLinked.push({ clusterKeys: clusters.map((c) => c.clusterKey), canonicalLabel: g.canonicalLabel, targetKpId: g.autoLinkedKpId, addedAliases: res.addedAliases });
      } catch (err) {
        summary.skipped.push({ clusterKey: clusters[0]?.clusterKey || "", reason: `自动归一失败：${err.message}` });
      }
      continue;
    }
    const created = createKnowledgeProposal({
      proposalKind: "point",
      scope: "ai-extraction",
      confidence: g.confidence,
      payload: {
        action: g.action,
        canonicalLabel: g.canonicalLabel,
        aliases: g.aliases,
        domain: g.domain,
        description: g.description,
        targetKpId: g.targetKpId,
        evidence: g.evidence,
        targetInvalid: g.targetInvalid || undefined,
        aiAssisted: true,
        clusters
      }
    });
    if (created.created) {
      (g.action === "link" ? summary.linked : summary.created).push({ proposalId: created.id, canonicalLabel: g.canonicalLabel, clusterKeys: clusters.map((c) => c.clusterKey), targetKpId: g.targetKpId });
    } else {
      summary.dedupSkipped++;
    }
  }
  // ---- 关系项裁决 ----
  const relParsed = parseJsonSafeLoose(rawRelations);
  for (const rel of Array.isArray(relParsed?.relations) ? relParsed.relations : []) {
    const type = String(rel?.relationType || "");
    if (!KP_RELATION_TYPES.includes(type)) { summary.skipped.push({ relation: true, reason: `未知关系类型 ${type || "(空)"}` }); continue; }
    const from = resolveRelationEndpoint(rel?.fromRef || { kpId: rel?.fromKpId, clusterKey: rel?.fromClusterKey, label: rel?.fromLabel }, { candidateIds, runClusterKeys });
    const to = resolveRelationEndpoint(rel?.toRef || { kpId: rel?.toKpId, clusterKey: rel?.toClusterKey, label: rel?.toLabel }, { candidateIds, runClusterKeys });
    if (!from || !to) { summary.skipped.push({ relation: true, reason: "端点不在候选清单或簇集合内（禁编造）" }); continue; }
    if (from.kpId && to.kpId) {
      if (from.kpId === to.kpId) { summary.skipped.push({ relation: true, reason: "自循环" }); continue; }
      if (type === "prerequisite") {
        const check = wouldCreatePrerequisiteCycle(from.kpId, to.kpId);
        if (check.cycle) { summary.skipped.push({ relation: true, reason: `prerequisite 建环：${check.path.join(" → ")}` }); continue; }
      }
    }
    const payload = {
      relationType: type,
      fromRef: from,
      toRef: to,
      fromKnowledgePointId: from.kpId || null,
      toKnowledgePointId: to.kpId || null,
      confidence: Number.isFinite(Number(rel?.confidence)) ? Number(rel.confidence) : null,
      evidence: rel?.evidence ? String(rel.evidence).slice(0, 200) : "",
      aiAssisted: true
    };
    const created = createKnowledgeProposal({ proposalKind: "relation", scope: "ai-extraction", confidence: payload.confidence, payload });
    if (created.created) summary.relations.push({ proposalId: created.id, relationType: type, from: from.kpId || from.clusterKey || from.label, to: to.kpId || to.clusterKey || to.label, resolved: Boolean(from.kpId && to.kpId) });
    else summary.dedupSkipped++;
  }
  persist();
  return summary;
}

// 容错 JSON 解析（括号平衡扫描；取第一个顶层平衡对象——模型常在 JSON 前后附说明文字）
function parseJsonSafeLoose(raw) {
  const text = String(raw ?? "");
  if (!text.trim()) return null;
  const candidates = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) { candidates.push(text.slice(objStart, i + 1)); objStart = -1; }
    }
  }
  for (const cand of candidates) {
    try { return JSON.parse(cand); } catch { /* 继续 */ }
  }
  return null;
}

// 旧字段归一建议（§9.1 K1-2；v41 簇感知重写，D38）：从「未归一簇」里取**有语义的旧值**
// （非 kp1 这类编号；编号簇交给 AI 整理，本地 n-gram 对编号无意义），对每个簇找 active KP——
// 精确 label 命中或 n-gram 相似 ≥ minSimilarity → 'link' 提案；否则 → 'create' 提案。
// **只回填 proposals 不自动写正式表**；指纹幂等（已拒绝的不重提）。
function buildKnowledgeMigrationSuggestions({ minSimilarity = 0.5, limit = 200 } = {}) {
  const { unnormalized } = listKpClusters();
  const activeKps = queryAll("SELECT id, canonical_label FROM knowledge_points WHERE status = 'active' AND is_deleted = 0");
  let created = 0;
  let skipped = 0;
  let scanned = 0;
  for (const cl of unnormalized.slice(0, Math.max(1, Math.min(2000, Number(limit) || 200)))) {
    if (isOpaqueClusterId(cl.legacyKey)) { skipped++; continue; } // 无语义编号（kp1…）交给 AI 整理
    scanned++;
    let best = null;
    for (const kp of activeKps) {
      if (kp.canonical_label === cl.legacyKey) { best = { kp, score: 1 }; break; }
      const score = similarity(cl.legacyKey, kp.canonical_label);
      if (score >= (best?.score ?? minSimilarity)) best = { kp, score };
    }
    const payload = best
      ? { action: "link", legacyKey: cl.legacyKey, targetKpId: best.kp.id, targetLabel: best.kp.canonical_label, similarity: Number(best.score.toFixed(4)), clusters: [clusterPayloadOf(cl)] }
      : { action: "create", legacyKey: cl.legacyKey, canonicalLabel: cl.legacyKey, clusters: [clusterPayloadOf(cl)] };
    const res = createKnowledgeProposal({ proposalKind: "point", payload, confidence: best ? best.score : null, scope: "manual" });
    if (res.created) created++;
    else skipped++;
  }
  return { created, skipped, scanned };
}

function clusterPayloadOf(cl) {
  return { clusterKey: cl.clusterKey, legacyKey: cl.legacyKey, documentId: cl.documentId, cardIds: cl.cardIds, cardCount: cl.cardCount };
}


// 一键全接受（D38 确认方式）：顺序 point(create) → point(link) → relation → merge；
// 每条独立 try/catch，单条失败不中断；relation 在点全部落地后解析端点。
function acceptAllPendingKnowledgeProposals() {
  const order = { point: 0, relation: 1, merge: 2 };
  const rows = queryAll("SELECT * FROM knowledge_proposals WHERE status = 'pending' AND is_deleted = 0");
  rows.sort((a, b) => {
    const pa = mapKpProposalRow(a);
    const pb = mapKpProposalRow(b);
    const oa = (order[pa.proposalKind] ?? 9) + (pa.payload?.action === "link" ? 0.5 : 0);
    const ob = (order[pb.proposalKind] ?? 9) + (pb.payload?.action === "link" ? 0.5 : 0);
    if (oa !== ob) return oa - ob;
    return pa.createdAt - pb.createdAt;
  });
  const accepted = [];
  const failed = [];
  for (const r of rows) {
    try {
      const res = resolveKnowledgeProposal(r.id, true);
      accepted.push({ id: r.id, kind: res.proposal.proposalKind, label: res.proposal.payload?.canonicalLabel || res.proposal.payload?.relationType || "" });
    } catch (err) {
      failed.push({ id: r.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { accepted, failed, total: rows.length };
}



// ---------- v40（M8-B，§4.13 / §9.1 M8-B）：AI 洞察（InsightEngine §4.2-24 数据面） ----------
// 反馈只写 insight_runs.feedback_json（四档 + 竞争二选 + 结构定向反馈），只调 utility 权重、
// 永不写 mastery（§4.11-5）；洞察输出不入 FSRS 队列、不直接产 evidence（K7 只消费 demand 信号）。

const INSIGHT_RANGE_KINDS = ["7d", "30d", "all", "custom"];
const PMC_KINDS = ["Concept", "Preference", "Value", "Interest", "Experience", "Question", "Choice"];

function mapInsightRunRow(r) {
  return {
    id: r.id,
    rangeKind: r.range_kind,
    rangeFrom: r.range_from ?? null,
    rangeTo: r.range_to ?? null,
    entryCount: r.entry_count,
    entryIds: parseJsonSafe(r.entry_ids_json, []),
    evidencePackage: parseJsonSafe(r.evidence_package_json, null),
    model: r.model ?? null,
    promptScope: r.prompt_scope ?? null,
    promptVersion: r.prompt_version ?? null,
    output: parseJsonSafe(r.output_json, null),
    tokenUsed: r.token_used ?? null,
    feedback: parseJsonSafe(r.feedback_json, null),
    status: r.status,
    errorText: r.error_text ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// v43（K2-B，§6.3.12）：KnowledgeLint K4/K7/K8 报告型检查。
// K2（prerequisite 环）/K3（自循环）已随 K1 落地为写时校验（wouldCreatePrerequisiteCycle/createKnowledgeRelation），
// K5（低置信进候选池）/K6（疑似重复提议合并）已随 K2-A 落地为提案裁决形态；本批补齐报告型三条：
//   K4 warn：domain 不在受控清单 / KP 与关联卡 domain 主类不一致；
//   K7 info：concept 过宽（关联卡跨 ≥3 个 UDC 主类，建议拆分）；
//   K8 info：concept 过窄（零关系边且关联卡 ≤1 张，单例孤立，建议合并或挂靠）。
// 全部确定性启发式、非阻断；只读知识结构，不碰 FSRS 调度字段。卡→KP 关联走读取侧别名家族
// （cards.knowledge_point_id 的 legacy 值 ∈ canonical_label/alias/正式 id），与 K1/K2-A 同口径。
function runKnowledgeLint() {
  const issues = [];
  const kps = queryAll(
    "SELECT id, canonical_label, domain_id, alias_json, status, is_deleted FROM knowledge_points WHERE is_deleted = 0 AND status = 'active'"
  );
  if (!kps.length) return issues;
  // 关系边计数（两端都算持有）
  const relCount = {};
  for (const r of queryAll(
    `SELECT from_knowledge_point_id AS kpId FROM knowledge_relations WHERE is_deleted = 0
     UNION ALL SELECT to_knowledge_point_id AS kpId FROM knowledge_relations WHERE is_deleted = 0`
  )) {
    relCount[r.kpId] = (relCount[r.kpId] || 0) + 1;
  }
  // 关联卡（只取需要的三列；legacy 值 → KP 的映射按别名家族精确匹配）
  const cardRows = queryAll(
    "SELECT id, front_markdown, domain, knowledge_point_id FROM cards WHERE is_deleted = 0 AND knowledge_point_id IS NOT NULL AND knowledge_point_id != ''"
  );
  const cardsByKpValue = {};
  for (const c of cardRows) {
    const key = String(c.knowledge_point_id);
    (cardsByKpValue[key] = cardsByKpValue[key] || []).push(c);
  }
  const validCodes = new Set(UDC_LEAVES.map((l) => l.code));
  validCodes.add(UDC_OTHER);
  const leafMain = {};
  for (const l of UDC_LEAVES) leafMain[l.code] = l.main;
  const mainOf = (code) => leafMain[code] || (validCodes.has(code) && code !== UDC_OTHER ? code : null);

  for (const kp of kps) {
    const aliases = parseJsonSafe(kp.alias_json, []);
    const familyIds = resolveKpFamily(kp.id);
    const keySet = new Set([kp.canonical_label, ...(Array.isArray(aliases) ? aliases : []), ...familyIds].map((s) => String(s)));
    const linked = [];
    for (const key of keySet) {
      for (const c of cardsByKpValue[key] || []) {
        if (!linked.includes(c)) linked.push(c);
      }
    }

    // K4a：domain_id 不在受控清单
    const domainId = kp.domain_id ? String(kp.domain_id).trim() : "";
    if (domainId && !validCodes.has(domainId)) {
      issues.push({
        ruleId: "K4",
        severity: "warn",
        knowledgePointId: kp.id,
        kpLabel: kp.canonical_label,
        message: `领域「${domainId}」不在 UDC 受控清单`,
        detail: "请在知识点详情中改选受控领域编号"
      });
    }

    // K4b / K7：关联卡 domain 主类 vs KP 主域
    const kpMain = mainOf(domainId);
    if (kpMain) {
      const cardMains = [];
      let mismatched = 0;
      for (const c of linked) {
        let dom = [];
        try { dom = c.domain ? JSON.parse(c.domain) : []; } catch { dom = []; }
        if (!Array.isArray(dom) || !dom.length) continue;
        const m = mainOf(String(dom[0]).trim());
        if (!m) continue;
        if (!cardMains.includes(m)) cardMains.push(m);
        if (m !== kpMain) mismatched++;
      }
      if (mismatched > 0) {
        issues.push({
          ruleId: "K4",
          severity: "warn",
          knowledgePointId: kp.id,
          kpLabel: kp.canonical_label,
          message: `${mismatched} 张关联卡的领域（主类 ${cardMains.filter((m) => m !== kpMain).join("/")}）与知识点主域（${kpMain}）不一致`,
          detail: "领域不一致常意味着归属错位或概念过宽，建议核对 KP 归属"
        });
      }
      if (cardMains.length >= 3) {
        issues.push({
          ruleId: "K7",
          severity: "info",
          knowledgePointId: kp.id,
          kpLabel: kp.canonical_label,
          message: `关联卡跨 ${cardMains.length} 个 UDC 主类（${cardMains.join("/")}），概念可能过宽`,
          detail: "建议按主类拆分为更具体的概念"
        });
      }
    }

    // K8：单例孤立（零关系边且关联卡 ≤1）
    const rel = relCount[kp.id] || 0;
    if (rel === 0 && linked.length <= 1) {
      issues.push({
        ruleId: "K8",
        severity: "info",
        knowledgePointId: kp.id,
        kpLabel: kp.canonical_label,
        message: rel === 0 && linked.length === 0 ? "零关联卡、零关系边（孤立概念）" : "仅 1 张关联卡且无关系边（单例孤立）",
        detail: "建议与相邻概念合并，或补一张关联卡/关系边挂靠"
      });
    }
  }
  return issues;
}

function createInsightRun(payload, opts) {
  const kind = String(payload?.rangeKind ?? "");
  if (!INSIGHT_RANGE_KINDS.includes(kind)) throw new Error(`未知洞察范围：${kind || "(空)"}`);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO insight_runs (id, user_id, range_kind, range_from, range_to, entry_count, entry_ids_json, evidence_package_json, model, prompt_scope, prompt_version, status, created_at, updated_at)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [
      id,
      kind,
      payload?.rangeFrom ? String(payload.rangeFrom) : null,
      payload?.rangeTo ? String(payload.rangeTo) : null,
      Math.max(0, Number(payload?.entryCount) || 0),
      JSON.stringify(Array.isArray(payload?.entryIds) ? payload.entryIds.map(String) : []),
      payload?.evidencePackage ? JSON.stringify(payload.evidencePackage) : null,
      payload?.model ? String(payload.model) : null,
      payload?.promptScope ? String(payload.promptScope) : "journal-insight",
      Number.isFinite(Number(payload?.promptVersion)) ? Number(payload.promptVersion) : null,
      now, now
    ]
  );
  persist();
  return mapInsightRunRow(queryAll("SELECT * FROM insight_runs WHERE id = ?", [id])[0]);
}

function setInsightRunStatus(id, status, extra = {}) {
  const fields = ["status = ?", "updated_at = ?"];
  const params = [String(status), Date.now()];
  if (extra.output !== undefined) { fields.push("output_json = ?"); params.push(extra.output ? JSON.stringify(extra.output) : null); }
  if (extra.tokenUsed !== undefined) { fields.push("token_used = ?"); params.push(Number.isFinite(Number(extra.tokenUsed)) ? Number(extra.tokenUsed) : null); }
  if (extra.errorText !== undefined) { fields.push("error_text = ?"); params.push(extra.errorText ? String(extra.errorText) : null); }
  if (extra.model !== undefined) { fields.push("model = ?"); params.push(extra.model ? String(extra.model) : null); }
  if (extra.promptVersion !== undefined) { fields.push("prompt_version = ?"); params.push(Number.isFinite(Number(extra.promptVersion)) ? Number(extra.promptVersion) : null); }
  params.push(String(id));
  db.run(`UPDATE insight_runs SET ${fields.join(", ")} WHERE id = ?`, params);
  persist();
  return mapInsightRunRow(queryAll("SELECT * FROM insight_runs WHERE id = ?", [String(id)])[0]);
}

function getInsightRun(id) {
  const rows = queryAll("SELECT * FROM insight_runs WHERE id = ? AND is_deleted = 0", [String(id)]);
  return rows.length ? mapInsightRunRow(rows[0]) : null;
}

// 洞察历史（列表默认只回 runs 的轻量视图：不含 evidence_package 全文，防 UI 拉爆）
function listInsightRuns(opts) {
  const { limit = 50, offset = 0, includePackage = false } = opts ?? {};
  const lim = clampLimit(limit, 50, 500);
  const off = clampOffset(offset);
  const rows = queryAll(
    "SELECT * FROM insight_runs WHERE is_deleted = 0 ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?",
    [lim, off]
  );
  return {
    runs: rows.map((r) => {
      const m = mapInsightRunRow(r);
      if (!includePackage) m.evidencePackage = null;
      return m;
    })
  };
}

// 反馈写入（合并语义：保留已有字段，允许分次写四档 / 竞争二选 / 结构定向反馈）
function setInsightRunFeedback(id, feedback, opts) {
  const run = getInsightRun(String(id));
  if (!run) throw new Error("洞察记录不存在");
  const merged = { ...(run.feedback || {}), ...(feedback && typeof feedback === "object" ? feedback : {}) };
  db.run("UPDATE insight_runs SET feedback_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(merged), Date.now(), String(id)]);
  persist();
  return getInsightRun(String(id));
}

function deleteInsightRun(id, opts) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("insight_runs", id)) return false;
  db.run("UPDATE insight_runs SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), String(id)]);
  persist();
  return true;
}

// ---------- v45（M14-UM1，D39 / §4.18）：用户记忆整理运行留痕 ----------
// 记忆真源 = <userData>/memory/ 文件树（§4.18-2，本项目首个非 DB 真源）；本表只做运行事实留痕
// （§4.18-14 护栏⑤：可审计、可复现）。append-only：status 仅 running→success/failed 一途，不删不改。

function createMemoryRun({ kind, trigger, input = null } = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO memory_runs (id, user_id, kind, trigger, status, started_at, input_json, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, 'running', ?, ?, 0, 0)`,
    [id, String(kind), String(trigger), now, JSON.stringify(input ?? null)]
  );
  persist();
  return getMemoryRun(id);
}

function setMemoryRunStatus(id, status, { output = null, applied = null, model = null, tokenUsed = null, promptScope = null, promptVersion = null, errorText = null } = {}) {
  db.run(
    `UPDATE memory_runs SET status = ?, finished_at = ?, output_json = COALESCE(?, output_json),
     applied_json = COALESCE(?, applied_json), model = COALESCE(?, model), token_used = COALESCE(?, token_used),
     prompt_scope = COALESCE(?, prompt_scope), prompt_version = COALESCE(?, prompt_version),
     error_text = ?, sync_version = sync_version + 1 WHERE id = ? AND is_deleted = 0`,
    [
      String(status),
      Date.now(),
      output == null ? null : JSON.stringify(output),
      applied == null ? null : JSON.stringify(applied),
      model,
      Number.isFinite(Number(tokenUsed)) ? Number(tokenUsed) : null,
      promptScope,
      Number.isFinite(Number(promptVersion)) ? Number(promptVersion) : null,
      errorText,
      String(id)
    ]
  );
  persist();
  return getMemoryRun(String(id));
}

function mapMemoryRunRow(r) {
  return {
    id: r.id,
    kind: r.kind,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    promptScope: r.prompt_scope ?? null,
    promptVersion: r.prompt_version ?? null,
    model: r.model ?? null,
    tokenUsed: r.token_used ?? null,
    input: parseJsonSafe(r.input_json, null),
    output: parseJsonSafe(r.output_json, null),
    applied: parseJsonSafe(r.applied_json, null),
    errorText: r.error_text ?? null
  };
}

function getMemoryRun(id) {
  const rows = queryAll("SELECT * FROM memory_runs WHERE id = ? AND is_deleted = 0", [String(id)]);
  return rows.length ? mapMemoryRunRow(rows[0]) : null;
}

// 最近一次成功摄入轮（kind 任意；启动补跑判据「距上次成功 ≥12h」与防抖消选用）
function getLastMemoryRunSuccess() {
  const rows = queryAll(
    "SELECT * FROM memory_runs WHERE status = 'success' AND is_deleted = 0 ORDER BY started_at DESC LIMIT 1"
  );
  return rows.length ? mapMemoryRunRow(rows[0]) : null;
}

function listMemoryRuns(opts) {
  const { limit = 50 } = opts ?? {};
  const lim = clampLimit(limit, 50, 500);
  return queryAll(
    "SELECT * FROM memory_runs WHERE is_deleted = 0 ORDER BY started_at DESC, id ASC LIMIT ?",
    [lim]
  ).map(mapMemoryRunRow);
}

// ---------- Evidence Package 装配（InsightEngine.buildEvidencePackage，§4.13-5 / §4.2-24） ----------
// 结构冻结（D37）：{diarySpans[], kpSubgraph{kps, edges}, cards[], extracts[], sources[], tokenBudget,
// groundingOrder}。检索链：日记文本 → 命中 KP（label/alias 子串）→ 子图一跳 → 相关卡/摘录 → 来源；
// token 超限按 grounding 从后往前裁剪（先裁非 seed 边，再减卡/摘录配额），日记 span 恒保留并在
// UI 明示裁剪。v1 量级（个人库数百至数千卡）O(N×M) 子串匹配可接受。

// 粗估 token：CJK ≈ 0.7 token/字，ASCII ≈ 0.25 token/字符（向上取整；仅预算与裁剪用，非计费口径）
function estimateTokens(text) {
  const t = String(text || "");
  const cjk = (t.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return Math.ceil(cjk * 0.7 + (t.length - cjk) * 0.25);
}

function buildEvidencePackage({ rangeKind = "30d", rangeFrom, rangeTo, tokenBudget = 12000 } = {}) {
  const now = journalDateOf(Date.now());
  let from = rangeFrom ? String(rangeFrom) : null;
  let to = rangeTo ? String(rangeTo) : null;
  if (rangeKind === "7d") from = journalDateOf(Date.now() - 7 * 86400000);
  else if (rangeKind === "30d") from = journalDateOf(Date.now() - 30 * 86400000);
  else if (rangeKind === "all") { from = null; to = null; }
  // ① 日记 span（只取已发送条目；草稿不属于事实）
  const diaryWhere = ["is_deleted = 0", "is_draft = 0"];
  const diaryParams = [];
  if (from) { diaryWhere.push("entry_date >= ?"); diaryParams.push(from); }
  if (to) { diaryWhere.push("entry_date <= ?"); diaryParams.push(to); }
  const diaryRows = queryAll(
    `SELECT id, entry_date, content_markdown, created_at FROM journal_entries WHERE ${diaryWhere.join(" AND ")}
     ORDER BY entry_date DESC, created_at ASC LIMIT 400`,
    diaryParams
  );
  const diarySpans = diaryRows.map((r) => ({ entryId: r.id, entryDate: r.entry_date, text: r.content_markdown, createdAt: r.created_at }));
  const diaryText = diarySpans.map((s) => s.text).join("\n");
  // ② 日记 → KP（label/alias 子串命中）
  const activeKps = queryAll("SELECT * FROM knowledge_points WHERE status = 'active' AND is_deleted = 0");
  const seeds = [];
  for (const kp of activeKps) {
    const labels = [kp.canonical_label, ...parseJsonSafe(kp.alias_json, [])].filter(Boolean);
    if (labels.some((l) => l.length >= 2 && diaryText.includes(l))) seeds.push(kp);
  }
  // ③ 子图一跳（合并不重写边：按族展开）
  const seedIds = new Set();
  for (const s of seeds) for (const fid of resolveKpFamily(s.id)) seedIds.add(fid);
  const kps = seeds.map(mapKpRow);
  const edges = [];
  if (seedIds.size) {
    const idList = [...seedIds];
    const ph = idList.map(() => "?").join(",");
    const edgeRows = queryAll(
      `SELECT * FROM knowledge_relations WHERE is_deleted = 0
       AND (from_knowledge_point_id IN (${ph}) OR to_knowledge_point_id IN (${ph})) LIMIT 200`,
      [...idList, ...idList]
    );
    for (const r of edgeRows) {
      const m = mapKpRelationRow(r);
      if (!edges.some((e) => e.id === m.id)) edges.push(m);
      // 一跳邻居 KP 补入子图
      for (const nid of [m.fromKnowledgePointId, m.toKnowledgePointId]) {
        if (seedIds.has(nid) || kps.some((k) => k.id === nid)) continue;
        const row = getKpRow(nid);
        if (row && row.status === "active") { kps.push(mapKpRow(row)); seedIds.add(nid); }
      }
    }
  }
  // ④ 相关卡（seed label/alias 命中卡面，或 legacy knowledge_point_id 恰为 seed label/alias）
  const seedLabels = [];
  for (const kp of kps) seedLabels.push(kp.canonicalLabel, ...(kp.aliases || []));
  const uniqueLabels = [...new Set(seedLabels.filter((l) => l && l.length >= 2))];
  const cardRows = queryAll(
    "SELECT id, card_type, front_markdown, back_markdown, domain, knowledge_point_id, context_ref_json, priority FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 3000"
  );
  const matchedCards = [];
  for (const c of cardRows) {
    const face = `${c.front_markdown || ""} ${c.back_markdown || ""}`;
    const legacyHit = c.knowledge_point_id && uniqueLabels.includes(c.knowledge_point_id);
    const faceHit = uniqueLabels.some((l) => face.includes(l));
    if (legacyHit || faceHit) {
      let domain = [];
      try { domain = c.domain ? JSON.parse(c.domain) : []; } catch { /* 容忍坏行 */ }
      let documentId = null;
      try { documentId = parseJsonSafe(c.context_ref_json, null)?.documentId || null; } catch { /* 容忍坏行 */ }
      matchedCards.push({ cardId: c.id, cardType: c.card_type, front: c.front_markdown, back: c.back_markdown, domain, kpId: legacyHit ? c.knowledge_point_id : null, documentId, priority: c.priority });
    }
  }
  // ⑤ 相关摘录 → ⑥ 来源（matched 卡/摘录的 document 标题）
  const extractRows = queryAll(
    "SELECT id, document_id, content_markdown FROM extracts WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 2000"
  );
  const matchedExtracts = [];
  for (const ex of extractRows) {
    if (uniqueLabels.some((l) => (ex.content_markdown || "").includes(l))) {
      matchedExtracts.push({ extractId: ex.id, documentId: ex.document_id, text: (ex.content_markdown || "").slice(0, 400) });
    }
  }
  const docIds = [...new Set([...matchedCards.map((c) => c.documentId), ...matchedExtracts.map((e) => e.documentId)])].filter(Boolean);
  let sources = [];
  if (docIds.length) {
    const ph = docIds.map(() => "?").join(",");
    const srcRows = queryAll(
      `SELECT d.id AS documentId, li.title AS title, li.source_type AS sourceType
       FROM documents d JOIN library_items li ON li.id = d.library_item_id
       WHERE d.id IN (${ph}) AND d.is_deleted = 0 AND li.is_deleted = 0`,
      docIds
    );
    sources = srcRows.map((r) => ({ documentId: r.documentId, title: r.title, sourceType: r.sourceType }));
  }
  // ⑦ token 裁剪（grounding 从后往前：先裁一跳非 seed 边，再减卡、再减摘录；日记 span 恒保留）
  const budget = Math.max(2000, Number(tokenBudget) || 12000);
  const used = () =>
    estimateTokens(diaryText) +
    estimateTokens(JSON.stringify(kps) + JSON.stringify(edges)) +
    estimateTokens(JSON.stringify(matchedCards)) +
    estimateTokens(JSON.stringify(matchedExtracts)) +
    estimateTokens(JSON.stringify(sources));
  let trimmed = { edges: false, cards: false, extracts: false };
  while (used() > budget) {
    if (edges.length > seeds.length) { edges.splice(Math.floor(edges.length / 2), 1); trimmed.edges = true; continue; }
    if (matchedCards.length > 10) { matchedCards.length = Math.max(10, Math.floor(matchedCards.length * 0.7)); trimmed.cards = true; continue; }
    if (matchedExtracts.length > 5) { matchedExtracts.length = Math.max(5, Math.floor(matchedExtracts.length * 0.7)); trimmed.extracts = true; continue; }
    break; // 已到底线：宁可超预算也保用户材料（§4.13-5 grounding 优先级）
  }
  return {
    diarySpans,
    kpSubgraph: { kps, edges },
    cards: matchedCards,
    extracts: matchedExtracts,
    sources,
    tokenBudget: budget,
    tokenEstimated: used(),
    grounded: !Object.values(trimmed).some(Boolean),
    trimmed,
    groundingOrder: ["user-materials", "confirmed-insights", "knowledge-graph", "general-authority", "model-prior"],
    range: { kind: rangeKind, from: from || null, to: to || now }
  };
}

// ---------- Personal Meaning 第三图候选（§4.13-3 / D37 独立候选表） ----------

function mapPmcRow(r) {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    sourceInsightRunId: r.source_insight_run_id ?? null,
    evidenceRefs: parseJsonSafe(r.evidence_refs_json, null),
    note: r.note ?? null,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function listPersonalMeaningCandidates(opts) {
  const { status, limit = 200, offset = 0 } = opts ?? {};
  const where = ["is_deleted = 0"];
  const params = [];
  if (status) { where.push("status = ?"); params.push(String(status)); }
  const sqlWhere = where.join(" AND ");
  const lim = clampLimit(limit, 200, 1000);
  const off = clampOffset(offset);
  const rows = queryAll(
    `SELECT * FROM personal_meaning_candidates WHERE ${sqlWhere} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { candidates: rows.map(mapPmcRow) };
}

function createPersonalMeaningCandidate(payload, opts) {
  const label = String(payload?.label ?? "").trim();
  if (!label) throw new Error("Personal Meaning 候选标签为空");
  const kind = String(payload?.kind ?? "Concept");
  if (!PMC_KINDS.includes(kind)) throw new Error(`未知 Personal Meaning 类型：${kind}`);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO personal_meaning_candidates (id, user_id, label, kind, source_insight_run_id, evidence_refs_json, note, status, created_at, updated_at)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
    [
      id, label, kind,
      payload?.sourceInsightRunId ? String(payload.sourceInsightRunId) : null,
      payload?.evidenceRefs ? JSON.stringify(payload.evidenceRefs) : null,
      payload?.note ? String(payload.note) : null,
      now, now
    ]
  );
  persist();
  return mapPmcRow(queryAll("SELECT * FROM personal_meaning_candidates WHERE id = ?", [id])[0]);
}

// 决议：accepted（用户确认后才成事实）/ rejected / ignored；确认后仍只在本表内（第三图跨图边等 K 系列）
function resolvePersonalMeaningCandidate(id, status, opts) {
  if (!["accepted", "rejected", "ignored"].includes(String(status))) throw new Error("决议只许 accepted/rejected/ignored");
  db.run("UPDATE personal_meaning_candidates SET status = ?, updated_at = ? WHERE id = ? AND is_deleted = 0", [
    String(status), Date.now(), String(id)
  ]);
  persist();
  const rows = queryAll("SELECT * FROM personal_meaning_candidates WHERE id = ?", [String(id)]);
  return rows.length ? mapPmcRow(rows[0]) : null;
}

function deletePersonalMeaningCandidate(id, opts) {
  // 批次 E（D-TEST-15 T2 档）：目标行不存在或已软删时不再返回真的「已删除 / 已保存」。
  if (!rowExists("personal_meaning_candidates", id)) return false;
  db.run("UPDATE personal_meaning_candidates SET is_deleted = 1, updated_at = ? WHERE id = ?", [Date.now(), String(id)]);
  persist();
  return true;
}

// ============ v48 批1（M15 重做，D41-⑤ / §4.19-7）：材料知识导图仓储 ============
// map：每版本一行；激活切换=同 document+scope 下 isActive 互斥（新成功版本置 active，失败永不触碰旧图）。
// shard：确定性主键 = sha256(逻辑键)；upsert 语义（同键覆盖 → 旧版本即失效）。
// run：append-only 留痕，update 仅打补丁（状态机/进度/费用），不删不改写历史字段语义。

function materialMapShardId(key) {
  return crypto.createHash("sha256").update(key.join("\u0001")).digest("hex");
}

function mapMaterialMapRow(r, includeStructure) {
  const base = {
    id: r.id,
    documentId: r.document_id,
    scopeAnchor: r.scope_anchor,
    scopeKind: r.scope_kind,
    granularity: r.granularity,
    title: r.title,
    nodeCount: r.node_count,
    sourceRevisionHash: r.source_revision_hash,
    promptVersion: r.prompt_version,
    generatorVersion: r.generator_version,
    provider: r.provider,
    model: r.model,
    modelConfigHash: r.model_config_hash,
    nodeRemap: r.node_remap_json ? JSON.parse(r.node_remap_json) : null,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  if (includeStructure) {
    try {
      base.structure = JSON.parse(r.structure_json);
    } catch {
      base.structure = null;
    }
  }
  return base;
}

function saveMaterialMap({
  documentId,
  scopeAnchor = "book",
  scopeKind = "book",
  granularity = "standard",
  title = null,
  structure,
  sourceRevisionHash = null,
  promptVersion = null,
  generatorVersion = null,
  provider = null,
  model = null,
  modelConfigHash = null,
  nodeRemap = null,
  isActive = true
} = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const nodes = structure && Array.isArray(structure.nodes) ? structure.nodes : [];
  db.run(
    `INSERT INTO material_maps (id, user_id, document_id, scope_anchor, scope_kind, granularity, title,
      structure_json, node_count, source_revision_hash, prompt_version, generator_version,
      provider, model, model_config_hash, node_remap_json, is_active, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      String(documentId),
      String(scopeAnchor),
      String(scopeKind),
      String(granularity),
      title,
      JSON.stringify(structure ?? { nodes: [], edges: [] }),
      nodes.length,
      sourceRevisionHash,
      Number.isFinite(Number(promptVersion)) ? Number(promptVersion) : null,
      generatorVersion,
      provider,
      model,
      modelConfigHash,
      nodeRemap ? JSON.stringify(nodeRemap) : null,
      isActive ? 1 : 0,
      now,
      now
    ]
  );
  if (isActive) {
    db.run(
      "UPDATE material_maps SET is_active = 0, updated_at = ?, sync_version = sync_version + 1 WHERE document_id = ? AND scope_anchor = ? AND id != ? AND is_active = 1 AND is_deleted = 0",
      [now, String(documentId), String(scopeAnchor), id]
    );
  }
  persist();
  return getMaterialMap(id, { includeStructure: true });
}

function listMaterialMaps(documentId, opts = {}) {
  const rows = queryAll(
    "SELECT * FROM material_maps WHERE document_id = ? AND is_deleted = 0 ORDER BY created_at DESC, rowid DESC",
    [String(documentId)]
  );
  return rows.map((r) => mapMaterialMapRow(r, !!opts.includeStructure));
}

function getMaterialMap(id, opts = {}) {
  const rows = queryAll("SELECT * FROM material_maps WHERE id = ? AND is_deleted = 0", [String(id)]);
  return rows.length ? mapMaterialMapRow(rows[0], opts.includeStructure !== false) : null;
}

function getActiveMaterialMap(documentId, scopeAnchor) {
  const rows = queryAll(
    "SELECT * FROM material_maps WHERE document_id = ? AND scope_anchor = ? AND is_active = 1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1",
    [String(documentId), String(scopeAnchor || "book")]
  );
  return rows.length ? mapMaterialMapRow(rows[0], true) : null;
}

function setActiveMaterialMap(id) {
  const row = getMaterialMap(id, { includeStructure: false });
  if (!row) return null;
  const now = Date.now();
  db.run(
    "UPDATE material_maps SET is_active = 0, updated_at = ?, sync_version = sync_version + 1 WHERE document_id = ? AND scope_anchor = ? AND is_active = 1 AND is_deleted = 0",
    [now, row.documentId, row.scopeAnchor]
  );
  db.run("UPDATE material_maps SET is_active = 1, updated_at = ?, sync_version = sync_version + 1 WHERE id = ?", [now, String(id)]);
  persist();
  return getMaterialMap(id, { includeStructure: false });
}

// v48.5（用户反馈「想删掉错误版本的导图」）：用户可见历史 = 真删（DELETE 行）；
// material_map_shards 是缓存（用户不可见、重建可复用），保留不随删——与「已删除」语义分离。
// 删 active 时同一持久化轮内顺延（事务语义）：同 scope 最新剩余版本升 active；历史多 active 一并纠偏。
function deleteMaterialMap(id) {
  const rows = queryAll("SELECT document_id, scope_anchor, is_active FROM material_maps WHERE id = ?", [String(id)]);
  if (!rows.length) return false;
  const { document_id, scope_anchor, is_active } = rows[0];
  db.run("DELETE FROM material_maps WHERE id = ?", [String(id)]);
  if (is_active) {
    db.run(
      "UPDATE material_maps SET is_active = 0 WHERE document_id = ? AND scope_anchor = ? AND is_active = 1",
      [document_id, scope_anchor]
    );
    const next = queryAll(
      "SELECT id FROM material_maps WHERE document_id = ? AND scope_anchor = ? AND is_deleted = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1",
      [document_id, scope_anchor]
    );
    if (next.length) db.run("UPDATE material_maps SET is_active = 1 WHERE id = ?", [next[0].id]);
  }
  persist();
  return true;
}

/**
 * v48.12 修复「删掉的版本又出现」：同一个 run 的「首层就绪」与「深挖完成」两个阶段必须落在**同一行**版本上。
 * 此前两阶段各 INSERT 一行同标题版本 → 每次生成都在历史版本里留两条，删掉其中一条后另一条看起来就是「复活」。
 * 本函数按 id 就地更新（版本身份不变：nodeRemap / 卡片溯源沿用的就是这一行）。
 */
function updateMaterialMap(id, patch = {}) {
  const cur = queryAll("SELECT * FROM material_maps WHERE id = ? AND is_deleted = 0", [String(id)]);
  if (!cur.length) return null;
  const row = cur[0];
  const now = Date.now();
  const structure = patch.structure !== undefined ? patch.structure : JSON.parse(row.structure_json || "{}");
  const nodes = structure && Array.isArray(structure.nodes) ? structure.nodes : [];
  db.run(
    `UPDATE material_maps SET title = ?, structure_json = ?, node_count = ?, source_revision_hash = ?,
      prompt_version = ?, generator_version = ?, provider = ?, model = ?, model_config_hash = ?,
      node_remap_json = ?, is_active = ?, updated_at = ?, sync_version = sync_version + 1
     WHERE id = ?`,
    [
      patch.title !== undefined ? patch.title : row.title,
      JSON.stringify(structure ?? { nodes: [], edges: [] }),
      nodes.length,
      patch.sourceRevisionHash !== undefined ? patch.sourceRevisionHash : row.source_revision_hash,
      patch.promptVersion !== undefined ? patch.promptVersion : row.prompt_version,
      patch.generatorVersion !== undefined ? patch.generatorVersion : row.generator_version,
      patch.provider !== undefined ? patch.provider : row.provider,
      patch.model !== undefined ? patch.model : row.model,
      patch.modelConfigHash !== undefined ? patch.modelConfigHash : row.model_config_hash,
      patch.nodeRemap !== undefined ? (patch.nodeRemap ? JSON.stringify(patch.nodeRemap) : null) : row.node_remap_json,
      patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : row.is_active,
      now,
      String(id)
    ]
  );
  if (patch.isActive) {
    db.run(
      "UPDATE material_maps SET is_active = 0, updated_at = ?, sync_version = sync_version + 1 WHERE document_id = ? AND scope_anchor = ? AND id != ? AND is_active = 1 AND is_deleted = 0",
      [now, row.document_id, row.scope_anchor, String(id)]
    );
  }
  persist();
  return getMaterialMap(String(id), { includeStructure: true });
}

function saveMaterialMapShard({
  documentId,
  unitAnchor,
  runKind,
  granularity,
  promptScope,
  promptVersion,
  textHash,
  provider,
  model,
  modelConfigHash,
  content,
  chars = null,
  tokenUsed = null
} = {}) {
  const now = Date.now();
  const id = materialMapShardId([
    String(documentId), String(unitAnchor), String(runKind), String(granularity),
    String(promptScope), Number(promptVersion) || 0, String(textHash),
    String(provider), String(model), String(modelConfigHash)
  ]);
  const contentJson = JSON.stringify(content ?? null);
  const existing = queryAll("SELECT id FROM material_map_shards WHERE id = ?", [id]);
  if (existing.length) {
    db.run(
      `UPDATE material_map_shards SET content_json = ?, chars = COALESCE(?, chars), token_used = COALESCE(?, token_used),
       updated_at = ?, sync_version = sync_version + 1 WHERE id = ?`,
      [contentJson, Number.isFinite(Number(chars)) ? Number(chars) : null, Number.isFinite(Number(tokenUsed)) ? Number(tokenUsed) : null, now, id]
    );
  } else {
    db.run(
      `INSERT INTO material_map_shards (id, user_id, document_id, unit_anchor, run_kind, granularity, prompt_scope,
        prompt_version, text_hash, provider, model, model_config_hash, content_json, chars, token_used,
        created_at, updated_at, sync_version, is_deleted)
       VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        id, String(documentId), String(unitAnchor), String(runKind), String(granularity),
        String(promptScope), Number(promptVersion) || 0, String(textHash),
        String(provider), String(model), String(modelConfigHash),
        contentJson,
        Number.isFinite(Number(chars)) ? Number(chars) : null,
        Number.isFinite(Number(tokenUsed)) ? Number(tokenUsed) : null,
        now, now
      ]
    );
  }
  persist();
  return getMaterialMapShard({ documentId, unitAnchor, runKind, granularity, promptScope, promptVersion, textHash, provider, model, modelConfigHash });
}

function getMaterialMapShard(key = {}) {
  const id = materialMapShardId([
    String(key.documentId), String(key.unitAnchor), String(key.runKind), String(key.granularity),
    String(key.promptScope), Number(key.promptVersion) || 0, String(key.textHash),
    String(key.provider), String(key.model), String(key.modelConfigHash)
  ]);
  const rows = queryAll("SELECT * FROM material_map_shards WHERE id = ? AND is_deleted = 0", [id]);
  if (!rows.length) return null;
  const r = rows[0];
  let content = null;
  try {
    content = JSON.parse(r.content_json);
  } catch {
    content = null;
  }
  return {
    id: r.id,
    documentId: r.document_id,
    unitAnchor: r.unit_anchor,
    runKind: r.run_kind,
    granularity: r.granularity,
    promptScope: r.prompt_scope,
    promptVersion: r.prompt_version,
    textHash: r.text_hash,
    provider: r.provider,
    model: r.model,
    modelConfigHash: r.model_config_hash,
    content,
    chars: r.chars,
    tokenUsed: r.token_used,
    updatedAt: r.updated_at
  };
}

function listMaterialMapShards(documentId, filter = {}) {
  const conds = ["document_id = ?", "is_deleted = 0"];
  const args = [String(documentId)];
  for (const col of ["run_kind", "granularity", "prompt_scope", "provider", "model", "model_config_hash"]) {
    if (filter[col] != null) {
      conds.push(`${col} = ?`);
      args.push(String(filter[col]));
    }
  }
  if (filter.promptVersion != null) {
    conds.push("prompt_version = ?");
    args.push(Number(filter.promptVersion) || 0);
  }
  const rows = queryAll(`SELECT * FROM material_map_shards WHERE ${conds.join(" AND ")}`, args);
  return rows.map((r) => ({
    id: r.id,
    unitAnchor: r.unit_anchor,
    runKind: r.run_kind,
    granularity: r.granularity,
    promptScope: r.prompt_scope,
    promptVersion: r.prompt_version,
    textHash: r.text_hash,
    provider: r.provider,
    model: r.model,
    modelConfigHash: r.model_config_hash,
    chars: r.chars,
    tokenUsed: r.token_used,
    updatedAt: r.updated_at
  }));
}

function createMaterialMapRun({
  documentId,
  scopeAnchor = "book",
  scopeKind = "book",
  granularity = "standard",
  input = null
} = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO material_map_runs (id, user_id, document_id, scope_anchor, scope_kind, granularity, status, input_json, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, 'pending', ?, ?, ?, 0, 0)`,
    [id, String(documentId), String(scopeAnchor), String(scopeKind), String(granularity), JSON.stringify(input ?? null), now, now]
  );
  persist();
  return getMaterialMapRun(id);
}

const MMRUN_FIELDS = [
  "status", "stage", "calls_planned", "calls_done", "chars",
  "est_input_tokens", "est_output_tokens", "est_cost", "currency",
  "actual_prompt_tokens", "actual_completion_tokens", "actual_cost",
  "repair_count", "provider", "model", "model_config_hash", "prompt_version",
  "error_code", "error_text"
];
const MMRUN_JSON_FIELDS = new Set(["input_json", "output_json"]);
const MMRUNcamel = {
  status: "status", stage: "stage", callsPlanned: "calls_planned", callsDone: "calls_done",
  chars: "chars", estInputTokens: "est_input_tokens", estOutputTokens: "est_output_tokens",
  estCost: "est_cost", currency: "currency", actualPromptTokens: "actual_prompt_tokens",
  actualCompletionTokens: "actual_completion_tokens", actualCost: "actual_cost",
  repairCount: "repair_count", provider: "provider", model: "model",
  modelConfigHash: "model_config_hash", promptVersion: "prompt_version",
  errorCode: "error_code", errorText: "error_text", input: "input_json", output: "output_json"
};

function updateMaterialMapRun(id, patch = {}) {
  const sets = [];
  const args = [];
  for (const [camel, col] of Object.entries(MMRUNcamel)) {
    if (patch[camel] === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(MMRUN_JSON_FIELDS.has(col) ? JSON.stringify(patch[camel] ?? null) : patch[camel]);
  }
  if (!sets.length) return getMaterialMapRun(id);
  sets.push("updated_at = ?", "sync_version = sync_version + 1");
  args.push(Date.now(), String(id));
  db.run(`UPDATE material_map_runs SET ${sets.join(", ")} WHERE id = ?`, args);
  persist();
  return getMaterialMapRun(id);
}

function mapMaterialMapRunRow(r) {
  return {
    id: r.id,
    documentId: r.document_id,
    scopeAnchor: r.scope_anchor,
    scopeKind: r.scope_kind,
    granularity: r.granularity,
    status: r.status,
    stage: r.stage,
    callsPlanned: r.calls_planned,
    callsDone: r.calls_done,
    chars: r.chars,
    estInputTokens: r.est_input_tokens,
    estOutputTokens: r.est_output_tokens,
    estCost: r.est_cost,
    currency: r.currency,
    actualPromptTokens: r.actual_prompt_tokens,
    actualCompletionTokens: r.actual_completion_tokens,
    actualCost: r.actual_cost,
    repairCount: r.repair_count,
    provider: r.provider,
    model: r.model,
    modelConfigHash: r.model_config_hash,
    promptVersion: r.prompt_version,
    errorCode: r.error_code,
    errorText: r.error_text,
    input: r.input_json ? JSON.parse(r.input_json) : null,
    output: r.output_json ? JSON.parse(r.output_json) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function getMaterialMapRun(id) {
  const rows = queryAll("SELECT * FROM material_map_runs WHERE id = ? AND is_deleted = 0", [String(id)]);
  return rows.length ? mapMaterialMapRunRow(rows[0]) : null;
}

// v48 批5（M15，D41-⑥ / §4.19-10）：节点学习状态只读查询——已有 N 卡（context_ref_json.mindmapNodeId）
// + 知识点已存在（关联卡带 knowledge_point_id）。只读，永不影响地图结构/位置/组织关系。
function listMindmapLearningStatus(documentId, nodeIds) {
  const out = {};
  const ids = Array.isArray(nodeIds) ? nodeIds.slice(0, 500).map(String) : [];
  for (const nid of ids) {
    const needle = `%\"mindmapNodeId\":\"${nid}\"%`;
    const cardRows = queryAll(
      "SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0 AND context_ref_json LIKE ?",
      [needle]
    );
    const kpRows = queryAll(
      "SELECT COUNT(DISTINCT knowledge_point_id) AS n FROM cards WHERE is_deleted = 0 AND knowledge_point_id IS NOT NULL AND context_ref_json LIKE ?",
      [needle]
    );
    out[nid] = { cardCount: Number(cardRows[0]?.n || 0), kpExists: Number(kpRows[0]?.n || 0) > 0 };
  }
  return out;
}

function listMaterialMapRuns(documentId, limit = 20) {
  const rows = queryAll(
    "SELECT * FROM material_map_runs WHERE document_id = ? AND is_deleted = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?",
    [String(documentId), Math.max(1, Number(limit) || 20)]
  );
  return rows.map(mapMaterialMapRunRow);
}

// ---------- v48.11 调用日志与僵尸对账（§3.7/§3.8） ----------

/** 记录一次 AI 请求尝试（含缓存命中/失败/未知结果），作为 Run 审计总账的真源 */
function saveMaterialMapCall({
  runId,
  documentId,
  runKind = "other",
  nodeAnchor = "",
  spanHash = null,
  chars = null,
  outcome = "completed",
  errorCode = null,
  finishReason = null,
  attempt = 1,
  wallMs = null,
  ttftMs = null,
  firstByteMs = null,
  depth = null,
  parentNodeId = null,
  spanChars = null,
  promptTokens = null,
  completionTokens = null
} = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO material_map_calls (id, user_id, run_id, document_id, run_kind, node_anchor, span_hash, chars,
      outcome, error_code, finish_reason, attempt, wall_ms, ttft_ms, first_byte_ms, depth, parent_node_id, span_chars,
      prompt_tokens, completion_tokens, created_at)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(runId),
      String(documentId),
      String(runKind),
      String(nodeAnchor || ""),
      spanHash ? String(spanHash) : null,
      Number.isFinite(Number(chars)) ? Number(chars) : null,
      String(outcome),
      errorCode ? String(errorCode) : null,
      finishReason ? String(finishReason) : null,
      Number.isFinite(Number(attempt)) ? Number(attempt) : 1,
      Number.isFinite(Number(wallMs)) ? Number(wallMs) : null,
      Number.isFinite(Number(ttftMs)) ? Number(ttftMs) : null,
      Number.isFinite(Number(firstByteMs)) ? Number(firstByteMs) : null,
      Number.isFinite(Number(depth)) ? Number(depth) : null,
      parentNodeId ? String(parentNodeId) : null,
      Number.isFinite(Number(spanChars)) ? Number(spanChars) : null,
      Number.isFinite(Number(promptTokens)) ? Number(promptTokens) : null,
      Number.isFinite(Number(completionTokens)) ? Number(completionTokens) : null,
      now
    ]
  );
  persist();
  return id;
}

function listMaterialMapCalls(runId, limit = 2000) {
  return queryAll(
    "SELECT * FROM material_map_calls WHERE run_id = ? ORDER BY created_at, rowid LIMIT ?",
    [String(runId), Math.max(1, Number(limit) || 2000)]
  ).map((r) => ({
    id: r.id,
    runId: r.run_id,
    documentId: r.document_id,
    runKind: r.run_kind,
    nodeAnchor: r.node_anchor,
    spanHash: r.span_hash,
    chars: r.chars,
    outcome: r.outcome,
    errorCode: r.error_code,
    finishReason: r.finish_reason,
    attempt: r.attempt,
    wallMs: r.wall_ms,
    ttftMs: r.ttft_ms,
    firstByteMs: r.first_byte_ms,
    depth: r.depth,
    parentNodeId: r.parent_node_id,
    spanChars: r.span_chars,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    createdAt: r.created_at
  }));
}

/**
 * 启动对账：把超过阈值的 running/estimating/pending 运行收敛为 **interrupted**（防永久僵尸）。
 *
 * v48.13 P3（D47）：**不得把正常退出等价于任务失败**——此前收敛为 `failed_timeout`，
 * 于是「关掉应用」在账本上被记成超时失败，用户看到的也是失败。现改为 `interrupted`：
 * 语义是「被应用关闭打断」，已完成分片保留在缓存，续跑零重复计费，并且可被 P3 的
 * 「发现未完成 run 并继续」重新拾起（`listResumableMaterialMapRuns`）。
 */
function reconcileStaleMaterialMapRuns(maxAgeMs = 30 * 60 * 1000, opts = {}) {
  // A-8（审计）：`{ all: true }` = **无视年龄，全部收敛**。启动时必须用这个模式 ——
  // 应用刚起来，不可能有引擎挂在任何 running/estimating/pending 的 run 上，它们全是上个进程留下的孤儿。
  // 原来一律按「updated_at < now − 30min」收敛，于是硬杀（崩溃 / 断电 / 强杀）不到 30 分钟的 run
  // 仍停在 running：串行化守卫 findRunningMaterialMapRun（不看年龄）照旧拒绝新的生成请求，
  // 而可续跑清单只收 interrupted/section_ready → 该材料既不能重生、也不提示可续，最长锁死 30 分钟。
  // ⚠️ 刻意**不**复用 `maxAgeMs === 0` 表达这个语义：既有语义里 0 表示「极小阈值，受 60 秒下限保护」，
  // F04 G5 明确钉住那条（`reconcileStaleMaterialMapRuns(0)` 不得误杀 0 秒龄的运行行）。
  const all = opts.all === true;
  const cutoff = Date.now() - Math.max(60 * 1000, Number(maxAgeMs) || 0);
  const rows = all
    ? queryAll(
        "SELECT id FROM material_map_runs WHERE is_deleted = 0 AND status IN ('running','estimating','pending')"
      )
    : queryAll(
        "SELECT id FROM material_map_runs WHERE is_deleted = 0 AND status IN ('running','estimating','pending') AND updated_at < ?",
        [cutoff]
      );
  for (const r of rows) {
    db.run("UPDATE material_map_runs SET status = 'interrupted', error_code = 'interrupted', error_text = ?, updated_at = ?, sync_version = sync_version + 1 WHERE id = ?", [
      "运行被应用关闭打断（启动对账）；已完成分片保留在缓存，继续生成零重复计费",
      Date.now(),
      r.id
    ]);
  }
  if (rows.length) persist();
  return rows.length;
}

/**
 * v48.13：同一材料同一范围**是否已有一轮任务在跑**。
 *
 * 用途是给引擎加串行化守卫。真实现场（2026-09-20 20:58–21:03）：用户在主 run 还在续跑深挖时
 * 又点了某节点的「深化」，两个 run 各自以不同基底装配、先后写**同一行**地图版本——
 * 先完成的深挖成果被后收尾的主 run 覆盖，用户看到图忽大忽小。
 */
function findRunningMaterialMapRun(documentId, scopeAnchor = "book") {
  const rows = queryAll(
    "SELECT * FROM material_map_runs WHERE document_id = ? AND scope_anchor = ? AND is_deleted = 0 AND status IN ('running','estimating','pending') ORDER BY created_at DESC LIMIT 1",
    [String(documentId), String(scopeAnchor)]
  );
  return rows.length ? mapMaterialMapRunRow(rows[0]) : null;
}

/**
 * v48.13 P3（D47）：**可续跑的运行**——应用重启后自动发现，供全局指示器提示「可继续生成」。
 * 两类：① `interrupted`（被关闭打断）；② `section_ready`（首层就绪、深挖待续跑，本就是可继续状态）。
 * 带上材料标题，指示器不必再回查一次。
 */
function listResumableMaterialMapRuns(limit = 20) {
  const rows = queryAll(
    `SELECT r.*, i.title AS material_title
       FROM material_map_runs r
       LEFT JOIN documents d ON d.id = r.document_id AND d.is_deleted = 0
       LEFT JOIN library_items i ON i.id = d.library_item_id
      WHERE r.is_deleted = 0 AND r.status IN ('interrupted','section_ready')
      ORDER BY r.updated_at DESC
      LIMIT ?`,
    [Math.max(1, Number(limit) || 20)]
  );
  return rows.map((r) => ({ ...mapMaterialMapRunRow(r), materialTitle: r.material_title || null }));
}

// ---------- v48.80（D124 / 指导文档 §4.20）：学习者模型事实表读写面 ----------
// 边界（设计稿 §0.1-4/§14-1）：对 cards / review_logs / extracts / knowledge_* 一律只读；
// 本节只写 learner_tracks / track_materials / learning_events / rec_runs / rec_feedback 五张新表。

const TRACK_MODES = ["language", "concept", "procedural", "factual", "narrative"];
const REC_FEEDBACK_ACTIONS = ["opened", "done", "snooze", "dismissed", "not_interested", "too_hard", "too_easy"];
const learnerClamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

function mapTrackRow(r) {
  let udc = [];
  try {
    udc = JSON.parse(r.udc_codes_json || "[]");
  } catch {
    udc = [];
  }
  return {
    id: r.id,
    label: r.label,
    mode: r.mode,
    lang: r.lang || "",
    udcCodes: Array.isArray(udc) ? udc.map(String) : [],
    status: r.status || "active",
    pinned: Number(r.pinned) === 1,
    priority: Number(r.priority) || 3,
    source: r.source || "user",
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/** 轨道清单（闸门 f19 会以 () 与 ({}) 调用：必须无参可调、空库返回 []、不播种任何行） */
function listLearnerTracks() {
  if (!db) return [];
  return queryAll("SELECT * FROM learner_tracks WHERE is_deleted = 0 ORDER BY created_at ASC, id ASC").map(mapTrackRow);
}

function getLearnerTrackRow(id) {
  return queryAll("SELECT * FROM learner_tracks WHERE id = ? AND is_deleted = 0", [String(id)])[0] || null;
}

/** 新建 / 更新轨道（校验在设计稿 §11.1：mode 枚举 / language 必有 lang 且无 udc / 其他 mode 的 udc ∈ UDC 叶子∪other / priority 1..5 / label ≤40） */
function saveLearnerTrack(track) {
  const t = track && typeof track === "object" ? track : {};
  const mode = String(t.mode || "");
  if (!TRACK_MODES.includes(mode)) return { ok: false, error: "mode 非法" };
  const label = String(t.label ?? "").trim();
  if (!label || label.length > 40) return { ok: false, error: "名称须为 1–40 字" };
  let lang = String(t.lang ?? "").trim().toLowerCase();
  const udcCodes = Array.isArray(t.udcCodes) ? t.udcCodes.map((c) => String(c).trim()).filter(Boolean) : [];
  if (mode === "language") {
    if (!lang) return { ok: false, error: "language 轨道必须指定语言" };
    if (udcCodes.length > 0) return { ok: false, error: "language 轨道不带领域编码" };
  } else {
    lang = "";
    const valid = new Set(UDC_LEAVES.map((l) => l.code));
    valid.add(UDC_OTHER);
    for (const c of udcCodes) {
      if (!valid.has(c)) return { ok: false, error: `领域编码 ${c} 不在受控清单` };
    }
    if (udcCodes.length === 0) return { ok: false, error: "该处理方式至少要选一个领域编码" };
  }
  const status = ["active", "paused", "archived"].includes(t.status) ? t.status : "active";
  const pinned = t.pinned === true ? 1 : 0;
  const priority = Math.min(5, Math.max(1, Math.round(Number(t.priority) || 3)));
  const now = Date.now();
  const existing = t.id ? getLearnerTrackRow(String(t.id)) : null;
  if (existing) {
    db.run(
      "UPDATE learner_tracks SET label=?, mode=?, lang=?, udc_codes_json=?, status=?, pinned=?, priority=?, updated_at=?, sync_version=sync_version+1 WHERE id=? AND is_deleted=0",
      [label, mode, lang, JSON.stringify(udcCodes), status, pinned, priority, now, existing.id]
    );
    persist();
    return { ok: true, track: mapTrackRow(getLearnerTrackRow(existing.id)) };
  }
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO learner_tracks (id, user_id, label, mode, lang, udc_codes_json, status, pinned, priority, source, created_at, updated_at) VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, label, mode, lang, JSON.stringify(udcCodes), status, pinned, priority, t.source === "proposal" ? "proposal" : "user", now, now]
  );
  persist();
  return { ok: true, track: mapTrackRow(getLearnerTrackRow(id)) };
}

function deleteLearnerTrack(id) {
  if (!rowExists("learner_tracks", id)) return { ok: false, error: "轨道不存在" };
  db.run("UPDATE learner_tracks SET is_deleted=1, updated_at=?, sync_version=sync_version+1 WHERE id=?", [Date.now(), String(id)]);
  persist();
  return { ok: true };
}

/** 轨道↔材料人工覆盖：member=1 加入 / 0 排除 / null 删除覆盖（唯一索引 ⇒ 先查后改，含已软删行） */
function setTrackMaterial(trackId, libraryItemId, member) {
  const tid = String(trackId ?? "");
  const itemId = String(libraryItemId ?? "");
  if (!tid || !itemId) return { ok: false, error: "参数缺失" };
  const now = Date.now();
  const existing = queryAll(
    "SELECT id FROM track_materials WHERE track_id = ? AND library_item_id = ?",
    [tid, itemId]
  )[0];
  if (member === null || member === undefined) {
    if (!existing) return { ok: true }; // 本来就没有覆盖 ⇒ 幂等成功
    db.run("UPDATE track_materials SET is_deleted=1, updated_at=?, sync_version=sync_version+1 WHERE id=?", [now, existing.id]);
    persist();
    return { ok: true };
  }
  const m = Number(member) === 1 ? 1 : 0;
  if (existing) {
    db.run("UPDATE track_materials SET member=?, is_deleted=0, updated_at=?, sync_version=sync_version+1 WHERE id=?", [m, now, existing.id]);
  } else {
    db.run(
      "INSERT INTO track_materials (id, track_id, library_item_id, member, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), tid, itemId, m, now, now]
    );
  }
  persist();
  return { ok: true };
}

// 设计稿 §5.3：learning_events.kind 封闭枚举与 payload 形状（非法 kind/payload 拒绝；超长截断）
const LEARNING_EVENT_SPECS = {
  dict_lookup: {
    required: ["lang", "library_item_id"],
    payload(p) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      return {
        text: String(p.text ?? "").slice(0, 64),
        sentence: String(p.sentence ?? "").slice(0, 400),
        offset: Math.max(0, Math.floor(Number(p.offset) || 0))
      };
    }
  },
  lexeme_mark: {
    required: ["lang"],
    payload(p) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      if (p.mark !== "known" && p.mark !== "unknown") return null;
      if (p.via !== "mine") return null;
      const keys = (Array.isArray(p.keys) ? p.keys : []).map((k) => String(k)).filter(Boolean).slice(0, 200);
      if (keys.length === 0) return null;
      return { keys, mark: p.mark, via: "mine" };
    }
  },
  placement: {
    required: ["lang"],
    payload(p) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      const knownKeys = (Array.isArray(p.knownKeys) ? p.knownKeys : []).map(String).filter(Boolean).slice(0, 600);
      const extrapolatedKeys = (Array.isArray(p.extrapolatedKeys) ? p.extrapolatedKeys : []).map(String).filter(Boolean).slice(0, 8000);
      const bands = (Array.isArray(p.bands) ? p.bands : [])
        .filter((b) => b && typeof b === "object")
        .slice(0, 20)
        .map((b) => ({ from: Math.max(1, Math.floor(Number(b.from) || 1)), to: Math.max(1, Math.floor(Number(b.to) || 1)), ratio: learnerClamp01(Number(b.ratio) || 0) }));
      return { knownKeys, extrapolatedKeys, bands };
    }
  },
  unit_reread: {
    required: ["unit_id", "library_item_id", "lang"],
    payload() {
      return {};
    }
  },
  reel_done: {
    required: ["lang"],
    payload(p) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      if (p.result !== "clear" && p.result !== "unclear") return null;
      const keys = (Array.isArray(p.keys) ? p.keys : []).map((k) => String(k)).filter(Boolean).slice(0, 200);
      if (keys.length === 0) return null;
      return { keys, result: p.result };
    }
  },
  self_explain: {
    required: ["kp_id"],
    payload(p) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      if (!["clear", "partial", "stuck"].includes(p.selfRating)) return null;
      return {
        text: String(p.text ?? "").slice(0, 4000),
        relatedKpId: p.relatedKpId ? String(p.relatedKpId) : null,
        selfRating: p.selfRating
      };
    }
  }
};

function addLearningEvent(evt) {
  const e = evt && typeof evt === "object" ? evt : {};
  const kind = String(e.kind || "");
  const spec = LEARNING_EVENT_SPECS[kind];
  if (!spec) return { ok: false, error: `未知学习事件类型 ${kind}` };
  for (const f of spec.required) {
    const v = e[f];
    if (v === undefined || v === null || v === "") return { ok: false, error: `缺少必填字段 ${f}` };
  }
  const payload = spec.payload(e.payload);
  if (payload === null) return { ok: false, error: "payload 形状非法" };
  const id = crypto.randomUUID();
  const ts = Number(e.ts) || Date.now();
  db.run(
    "INSERT INTO learning_events (id, kind, ts, lang, library_item_id, unit_id, kp_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      kind,
      ts,
      String(e.lang ?? ""),
      e.library_item_id ? String(e.library_item_id) : null,
      e.unit_id ? String(e.unit_id) : null,
      e.kp_id ? String(e.kp_id) : null,
      JSON.stringify(payload)
    ]
  );
  persist();
  return { ok: true, id };
}

function addRecFeedback(fb) {
  const f = fb && typeof fb === "object" ? fb : {};
  const action = String(f.action || "");
  if (!REC_FEEDBACK_ACTIONS.includes(action)) return { ok: false, error: `非法反馈动作 ${action}` };
  const itemKey = String(f.itemKey || f.item_key || "");
  if (!itemKey) return { ok: false, error: "缺少 itemKey" };
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO rec_feedback (id, rec_run_id, item_key, kind, library_item_id, action, auto, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      f.recRunId ? String(f.recRunId) : null,
      itemKey,
      String(f.kind || ""),
      f.libraryItemId ? String(f.libraryItemId) : null,
      action,
      f.auto === true || Number(f.auto) === 1 ? 1 : 0,
      Number(f.ts) || Date.now()
    ]
  );
  persist();
  return { ok: true, id };
}

function mapRecRunRow(r, withItems) {
  let items = [];
  if (withItems) {
    try {
      items = JSON.parse(r.items_json || "[]");
    } catch {
      items = [];
    }
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    lmVersion: r.lm_version,
    fingerprint: r.fingerprint,
    candidateCount: r.candidate_count,
    ...(withItems ? { items } : {})
  };
}

function latestRecRun() {
  if (!db) return null;
  const r = queryAll("SELECT * FROM rec_runs ORDER BY created_at DESC, id DESC LIMIT 1")[0];
  return r ? mapRecRunRow(r, true) : null;
}

/** 写推荐运行：指纹与最近一条相同则跳过（只在推荐集合变化时写一行）；超出 300 行物理裁剪（§7.2 已登记例外） */
function saveRecRun(items, candidateCount, lmVersion) {
  const list = Array.isArray(items) ? items : [];
  const fingerprint = crypto
    .createHash("sha1")
    .update(list.map((it) => String(it && it.key)).join("\u0000"))
    .digest("hex");
  const latest = latestRecRun();
  if (latest && latest.fingerprint === fingerprint) {
    return { ok: true, id: latest.id, createdAt: latest.createdAt, changed: false };
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO rec_runs (id, created_at, lm_version, fingerprint, candidate_count, items_json) VALUES (?, ?, ?, ?, ?, ?)",
    [id, now, String(lmVersion || "LM-1"), fingerprint, Number(candidateCount) || 0, JSON.stringify(list)]
  );
  db.run(
    "DELETE FROM rec_runs WHERE id NOT IN (SELECT id FROM rec_runs ORDER BY created_at DESC, id DESC LIMIT 300)"
  );
  persist();
  return { ok: true, id, createdAt: now, changed: true };
}

/** 近 N 天 rec_runs 出现过的 item key（K8b 的 30 天冷却用，设计稿 §8.2） */
function listRecentRunKeys(days = 30) {
  if (!db) return [];
  const since = Date.now() - (Number(days) || 30) * 86400000;
  const rows = queryAll("SELECT items_json FROM rec_runs WHERE created_at >= ?", [since]);
  const out = new Set();
  for (const r of rows) {
    try {
      for (const it of JSON.parse(r.items_json || "[]") || []) out.add(String(it.key));
    } catch {
      /* 坏 JSON 跳过 */
    }
  }
  return [...out];
}

/**
 * 卡片 → 知识点（设计稿 §6.5 resolveCardKpMap，只读）。
 * 键索引＝active KP 的 {id, canonical_label, ...alias, ...家族 id}；卡候选键＝[原始值, 批次簇键]；
 * 命中多个时优先簇键的 → updated_at 最大 → id 字典序最小；结果沿 merged_into 走到根。
 */
function resolveCardKpMap() {
  if (!db) return new Map();
  const activeKps = queryAll(
    "SELECT id, canonical_label, alias_json, updated_at FROM knowledge_points WHERE is_deleted = 0 AND status = 'active'"
  );
  // parent/rootOf：照抄 scopeKpFamilySet 内部的写法（含 seen 防环），不改动 scopeKpFamilySet 本体
  const parent = new Map();
  for (const r of queryAll("SELECT id, merged_into FROM knowledge_points WHERE is_deleted = 0")) {
    parent.set(String(r.id), r.merged_into ? String(r.merged_into) : null);
  }
  const rootOf = (id) => {
    let cur = id;
    const seen = new Set();
    while (parent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = parent.get(cur);
      if (!p) break;
      cur = p;
    }
    return cur;
  };
  const keyMap = new Map();
  const addKey = (key, kpId, updatedAt) => {
    const k = String(key ?? "");
    if (!k) return;
    if (!keyMap.has(k)) keyMap.set(k, []);
    keyMap.get(k).push({ id: String(kpId), updatedAt: Number(updatedAt) || 0 });
  };
  for (const kp of activeKps) {
    let aliases = [];
    try {
      aliases = JSON.parse(kp.alias_json || "[]");
    } catch {
      aliases = [];
    }
    const family = resolveKpFamily(kp.id);
    const keys = new Set([String(kp.id), String(kp.canonical_label), ...aliases.map((a) => String(a)), ...family.map((f) => String(f))]);
    for (const key of keys) addKey(key, kp.id, kp.updated_at);
  }
  const cards = queryAll(
    "SELECT id, knowledge_point_id, gen_batch_id, context_ref_json, updated_at FROM cards WHERE is_deleted = 0 AND (status IS NULL OR status = 'active') AND knowledge_point_id IS NOT NULL AND knowledge_point_id != ''"
  );
  const out = new Map();
  for (const c of cards) {
    let documentId = null;
    try {
      const ref = c.context_ref_json ? JSON.parse(c.context_ref_json) : null;
      documentId = ref && ref.documentId ? String(ref.documentId) : null;
    } catch {
      documentId = null;
    }
    const clusterKey = kpClusterKeyFor({ genBatchId: c.gen_batch_id, documentId, knowledgePointId: c.knowledge_point_id });
    const clusterHits = clusterKey ? keyMap.get(clusterKey) || [] : [];
    const rawHits = keyMap.get(String(c.knowledge_point_id)) || [];
    const hits = clusterHits.length > 0 ? clusterHits : rawHits;
    if (hits.length === 0) continue;
    const pick = hits
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt || String(a.id).localeCompare(String(b.id)))[0];
    out.set(String(c.id), rootOf(pick.id));
  }
  return out;
}

/**
 * 学习者模型的一次性事实读取（设计稿 §9.2，只读不写）。
 * opts.readingEventsAfter：只取该水位之后的阅读事件（增量通读计算用；缺省取全量）。
 * opts.readingEventsTailBefore：每份材料在该时刻之前最后一条阅读事件（作为会话续算的第一对 a）。
 * 注意：extracts 返回**全部**未删摘录（K4 需要 reading 态的非到期行）；K3 的到期口径
 * （与 listDueExtracts 相同的 WHERE）由 learnerRefresh 在组装快照时套用。
 */
function learnerFacts(opts) {
  const o = opts || {};
  const after = Number(o.readingEventsAfter) || 0;
  const tailBefore = Number(o.readingEventsTailBefore) || 0;
  if (!db) {
    return {
      tracks: [], overrides: [], materials: [], documents: [], cards: [], reviewLogs: [], extracts: [],
      kps: [], relations: [], learningEvents: [], recFeedback: [], latestRecRun: null, recentRunKeys: [],
      readingEvents: [], readingEventTail: [], readingEventsMax: 0, extractOpTimes: {}, fsrsConfigs: []
    };
  }
  const extractOpTimes = {};
  for (const r of queryAll(
    "SELECT extract_id AS extractId, MAX(created_at) AS lastAt FROM extract_ops WHERE created_at > ? GROUP BY extract_id",
    [Date.now() - 90 * 86400000]
  )) {
    extractOpTimes[String(r.extractId)] = Number(r.lastAt) || 0;
  }
  return {
    tracks: queryAll("SELECT * FROM learner_tracks WHERE is_deleted = 0 ORDER BY created_at ASC, id ASC"),
    overrides: queryAll("SELECT track_id AS trackId, library_item_id AS libraryItemId, member FROM track_materials WHERE is_deleted = 0"),
    materials: queryAll("SELECT id, title, lang, priority, source_type AS sourceType, progress_json AS progressJson FROM library_items WHERE is_deleted = 0 ORDER BY created_at ASC, id ASC"),
    documents: queryAll(
      "SELECT id, library_item_id AS libraryItemId, updated_at AS updatedAt, (markdown IS NOT NULL AND markdown != '') AS hasMarkdown, LENGTH(COALESCE(markdown,'')) AS markdownLen FROM documents WHERE is_deleted = 0 ORDER BY id ASC"
    ),
    cards: queryAll(
      "SELECT id, card_type AS cardType, knowledge_point_id AS knowledgePointId, gen_batch_id AS genBatchId, context_ref_json AS contextRefJson, dict_json AS dictJson, domain, generated_by AS generatedBy, created_at AS createdAt, updated_at AS updatedAt, fsrs_json AS fsrsJson, fsrs_config_id AS fsrsConfigId FROM cards WHERE is_deleted = 0"
    ),
    reviewLogs: queryAll("SELECT card_id AS cardId, rating, reviewed_at AS reviewedAt FROM review_logs ORDER BY reviewed_at ASC"),
    extracts: queryAll(
      `SELECT e.id, d.library_item_id AS libraryItemId, e.document_id AS documentId, COALESCE(e.status,'open') AS status,
              e.priority, e.topic_next_at AS topicNextAt, e.process_count AS processCount,
              e.content_markdown AS contentMarkdown, e.context_ref_json AS contextRefJson,
              COALESCE(e.kind,'extract') AS kind
       FROM extracts e
       JOIN documents d ON d.id = e.document_id AND d.is_deleted = 0
       JOIN library_items li ON li.id = d.library_item_id AND li.is_deleted = 0
       WHERE e.is_deleted = 0 AND COALESCE(e.kind,'extract') = 'extract'
       ORDER BY e.priority ASC, e.topic_next_at ASC`
    ),
    kps: queryAll(
      "SELECT id, canonical_label AS label, domain_id AS domainId, alias_json AS aliasJson, merged_into AS mergedInto, updated_at AS updatedAt FROM knowledge_points WHERE is_deleted = 0 AND status = 'active' ORDER BY id ASC"
    ),
    relations: queryAll(
      "SELECT from_knowledge_point_id AS fromId, to_knowledge_point_id AS toId, relation_type AS type FROM knowledge_relations WHERE is_deleted = 0"
    ),
    learningEvents: queryAll(
      "SELECT id, kind, ts, lang, library_item_id AS libraryItemId, unit_id AS unitId, kp_id AS kpId, payload_json AS payloadJson FROM learning_events WHERE is_deleted = 0 ORDER BY ts ASC"
    ),
    recFeedback: queryAll(
      "SELECT rec_run_id AS recRunId, item_key AS itemKey, kind, library_item_id AS libraryItemId, action, auto, ts FROM rec_feedback ORDER BY ts ASC"
    ),
    latestRecRun: latestRecRun(),
    recentRunKeys: listRecentRunKeys(30),
    readingEvents: queryAll(
      "SELECT item_id AS itemId, char_pos AS charPos, created_at AS createdAt FROM reading_events WHERE created_at > ? ORDER BY created_at ASC",
      [after]
    ),
    readingEventTail: tailBefore
      ? queryAll(
          "SELECT item_id AS itemId, char_pos AS charPos, MAX(created_at) AS createdAt FROM reading_events WHERE created_at <= ? GROUP BY item_id",
          [tailBefore]
        )
      : [],
    readingEventsMax: Number(queryAll("SELECT MAX(created_at) AS m FROM reading_events")[0]?.m) || 0,
    extractOpTimes,
    fsrsConfigs: queryAll("SELECT id, weights_json AS weightsJson FROM fsrs_configs")
  };
}

module.exports = {
  foldSearch,
  initDb,
  persistDb: persist,
  persistNow,
  // D137（v48.92）：will-quit 显式关闭（clean shutdown = WAL 自动 checkpoint + 删 -wal/-shm）；
  // 在线快照（M2 备份经 db.backup 页拷贝）；连接级 pragma 读数（验收/诊断辅助，只读）
  closeDb,
  snapshotTo,
  connPragmas,
  getBackupCounts,
  listItems,
  createFromPaste,
  createFromEpub,
  createImportedDoc,
  deleteItem,
  listDeletedItemIds,
  getDocument,
  updateProgress,
  createExtract,
  listDueExtracts,
  listAllExtracts,
  // v48.23（D61 §6.8-11）：多段选择修饰键的写侧归一（settings:set 兜底，非法值不落盘）
  normalizeMultiSelectKey,
  // 批 4（规格 §9.2）：四个批注设置键的读/写侧归一
  normalizeAnnotateMode,
  normalizeAnnotateForm,
  normalizeAnnotationFilter,
  normalizeAnnotateCustomEnabled,
  normalizeAnnotatePalette,
  readAnnotationSettings,
  getExtract,
  getExtractChain,
  postponeExtract,
  // v48.22（D58）：摘录调度内核（SM 语义 + 双引擎子空间 + 操作日志与撤销）
  postponeExtractDays,
  advanceExtract,
  updateExtract,
  setExtractPriority,
  setExtractStatus,
  deleteExtract,
  batchExtractOps,
  batchCardOps,
  // v48.60（D101）：标签写入与词表（§4.1）
  setCardTags,
  listCardTags,
  switchExtractEngine,
  undoLast,
  getUndoInfo,
  getDailyUsage,
  // v48.22（D58）：每日上限与会话队列（§6.8-3/§6.8-5）
  getLimitsState,
  validateLimits,
  readLimits,
  readReviewScopes,
  readSessionPrefs,
  readAiRerank,
  saveAiRerank,
  getActiveExtractEngine: () => getActiveEngine(),
  computeSessionQueue,
  computeCardCounts,
  setLibraryItemPriority,
  getLastUndoableReview,
  undoLastReview,
  createCard,
  updateCard,
  getCard,
  // v48.61（D103）：生成信息区只读 join（card + 批次 + 提示词 + card_issues；零写路径）
  getCardGenInfo,
  listDueCards,
  computeTodayQueue,
  listAllCards,
  getCardBrowserMeta,
  queryCardBrowserIds,
  getCardsWindow,
  listCardsBySibling,
  listDeferredToday,
  readBookFile,
  readPdfFile,
  readEbookFile,
  readContentImages,
  // v36（M8-A）：日记条目 + 节流落盘
  getJournalEntry,
  getJournalDraft,
  listJournalEntries,
  listJournalDates,
  createJournalEntry,
  updateJournalEntry,
  saveJournalDraft,
  sendJournalDraft,
  deleteJournalEntry,
  flushJournalPersist,
  // v45（M14-UM1，D39）：用户记忆——水位线读取 + 整理运行留痕
  listJournalEntriesSince,
  createMemoryRun,
  setMemoryRunStatus,
  getMemoryRun,
  getLastMemoryRunSuccess,
  listMemoryRuns,
  listAllReviewLogs,
  getItemIdByDocumentId,
  deleteCard,
  saveReview,
  saveSkip,
  addReadingEvent,
  getStatsOverview,
  getStatsTimeline,
  // v48.85（D129，§4.2-22）：成长反馈只读聚合出口（GrowthReadModel 数据面；零写路径，§4.17-3）
  getGrowthAfterReview,
  getGrowthSessionSummary,
  getGrowthOverview,
  setCardSuspended,
  updateCardLeech,
  resolveLeech,
  listLeechCards,
  addCardIssue,
  listCardIssues,
  addCardLink,
  updateCardLink,
  listCardLinksForCard,
  resolveCardIssue,
  createAIGenBatch,
  getAIGenBatch,
  listAIGenBatches,
  setAIGenBatchStatus,
  ensurePromptTemplates,
  getPromptTemplate,
  getPromptTemplateVersion,
  listPromptTemplates,
  findSimilarCards,
  listDictSources,
  upsertDictSource,
  setDictSourceEnabled,
  removeDictSource,
  dictLangForFormat,
  setLibraryItemLang,
  setLibraryItemTitle,
  setLibraryItemAuthor,
  listCardDomainsForDocument,
  getDictCache,
  setDictCache,
  createAssetForItem,
  getActiveFsrsConfig,
  getActiveConfigId,
  insertFsrsConfig,
  setActiveFsrsConfig,
  getConfigRow,
  execRawSql,
  // v40（K1，D37）：知识地基 KnowledgeBase（§4.2-23）
  KP_RELATION_TYPES,
  listKnowledgePoints,
  getKnowledgePoint,
  createKnowledgePoint,
  updateKnowledgePoint,
  mergeKnowledgePoints,
  unmergeKnowledgePoint,
  resolveKpFamily,
  listKnowledgeRelations,
  createKnowledgeRelation,
  deleteKnowledgeRelation,
  listKnowledgeExternalRefs,
  createKnowledgeExternalRef,
  deleteKnowledgeExternalRef,
  listKnowledgeProposals,
  createKnowledgeProposal,
  resolveKnowledgeProposal,
  buildKnowledgeMigrationSuggestions,
  // v41（K2-A，D38）：AI 抽取归一与关系（三层确定性架构数据层）
  listKpClusters,
  kpExtractionCandidates,
  buildKpExtractionInput,
  applyKpExtraction,
  resolvePendingRelationRefs,
  acceptAllPendingKnowledgeProposals,
  kpFingerprintFor,
  // v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查（K2/K3/K5/K6 已随 K1/K2-A 落地）
  runKnowledgeLint,
  // v40（M8-B，§4.13）：洞察数据面 + Evidence Package + Personal Meaning 候选
  INSIGHT_RANGE_KINDS,
  PMC_KINDS,
  estimateTokens,
  buildEvidencePackage,
  createInsightRun,
  setInsightRunStatus,
  getInsightRun,
  listInsightRuns,
  setInsightRunFeedback,
  deleteInsightRun,
  listPersonalMeaningCandidates,
  createPersonalMeaningCandidate,
  resolvePersonalMeaningCandidate,
  deletePersonalMeaningCandidate,
  // v48 批1（M15 重做，D41-⑤ / §4.19-7）：材料知识导图数据层（3 表）
  saveMaterialMap,
  updateMaterialMap,
  listMaterialMaps,
  getMaterialMap,
  getActiveMaterialMap,
  setActiveMaterialMap,
  deleteMaterialMap,
  saveMaterialMapShard,
  getMaterialMapShard,
  listMaterialMapShards,
  createMaterialMapRun,
  updateMaterialMapRun,
  getMaterialMapRun,
  listMaterialMapRuns,
  saveMaterialMapCall,
  listMaterialMapCalls,
  reconcileStaleMaterialMapRuns,
  listResumableMaterialMapRuns,
  findRunningMaterialMapRun,
  listMindmapLearningStatus,
  // v48.80（D124 / §4.20）：学习者模型事实表读写面（对 cards/review_logs/extracts/knowledge_* 只读）
  listLearnerTracks,
  saveLearnerTrack,
  deleteLearnerTrack,
  setTrackMaterial,
  addLearningEvent,
  addRecFeedback,
  latestRecRun,
  saveRecRun,
  listRecentRunKeys,
  resolveCardKpMap,
  learnerFacts,
  // v48.80（D124 / §9.5 E2）：KP 就绪度因子缓存写入（learnerRefresh 调用）
  setKpFactorMap
};
