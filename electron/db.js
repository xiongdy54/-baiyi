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
  CARD_VOCAB_PROMPT,
  CARD_WORDING_PROMPT,
  CARD_BASIC_PROMPT,
  CARD_LITERATURE_PROMPT,
  CARD_OCCLUSION_PROMPT,
  CARD_OCCLUSION_PROMPT_V3,
  READER_EXPLAIN_PROMPT,
  LEECH_RESCUE_PROMPT,
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
  SITUATION_REQUIRED_SCOPES,
  situationRequiredFor
} = require("./prompts");
const { sanitizeDomain, domainFromPrefix } = require("./udc");
const { calculateFsrsDeltaT, learningDayStartMs } = require("./fsrsTime");
const { journalDateOf } = require("./journalTime");
// v41（K2-A，D38）：知识归一纯函数（规范化 / 批次簇键 / 提案幂等指纹）
const { normalizeKpLabel, kpClusterKeyFor, kpProposalFingerprint, isOpaqueClusterId } = require("./kpNorm");
const { readSettings, writeSettings } = require("./settingsStore");
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
`;

async function initDb() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  dbFile = path.join(app.getPath("userData"), "library.db");
  // v23/F11：启动清残留 tmp——tmp 永远不是事实源（rename 原子性保证 library.db
  // 要么是上一份完整版要么是新完整版，半写的 tmp 只是垃圾）
  try { fs.rmSync(dbFile + ".tmp", { force: true }); } catch { /* 忽略 */ }
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
  db.run(SCHEMA);
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
  ensurePromptTemplates();
  persist();
}

// v23/F11（§4.4.9）：原子持久化——同目录 tmp + fsync + rename 原子替换（Windows MOVEFILE_REPLACE_EXISTING）。
// 任一步失败 throw → IPC reject → UI 封锁评分并经 persistNow 重试；禁止静默降级为非原子覆盖写。
// tmp 永远不是事实源：rename 原子性保证 library.db 要么是上一份完整版要么是新完整版。
function persist() {
  const tmp = dbFile + ".tmp";
  const buf = Buffer.from(db.export());
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dbFile);
}

// v23：纯持久化重试（§4.4.9）——只重试当前内存库的持久化（重导出+原子替换），
// 绝不重新执行任何业务 mutation；供 UI「重试保存」在 persist 失败后调用
function persistNow() {
  persist();
  return true;
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
  const stmt = db.prepare(`
    SELECT li.id, li.title, li.source_type AS sourceType, li.cover, li.progress_json AS progressJson,
           li.lang, li.created_at AS createdAt, li.updated_at AS updatedAt, d.markdown
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

// v38（D35）：书籍语言属性（''=未知）。查词语言路由的书籍级信号；不参与其他逻辑。
function setLibraryItemLang(id, lang) {
  const t = String(lang ?? "").trim().toLowerCase();
  db.run("UPDATE library_items SET lang=?, updated_at=? WHERE id=? AND is_deleted=0", [t, Date.now(), String(id)]);
  persist();
  return true;
}

// v45.1（用户需求）：书架悬停改名——只改标题，不动封面/进度/文档等其余列
function setLibraryItemTitle(id, title) {
  const t = String(title ?? "").trim();
  if (!t) throw new Error("书名不能为空");
  if (t.length > 300) throw new Error("书名过长（至多 300 字符）");
  db.run("UPDATE library_items SET title=?, updated_at=? WHERE id=? AND is_deleted=0", [t, Date.now(), String(id)]);
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

// M1.1（v15）：图片挖空卡 —— 把渲染层传来的图片字节落盘 + 入 assets 表（kind=image-occlusion）。
// ownerKey 允许传 library item id 或 documentId（摘录阅读器场景只有 documentId），统一归一到 itemId。
function createAssetForItem(ownerKey, kind, ext, dataBuf) {
  let itemId = null;
  const rows = queryAll("SELECT id FROM library_items WHERE id = ? AND is_deleted = 0", [String(ownerKey)]);
  if (rows.length > 0) {
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

// M6-1（v26）：导入格式扩展 —— Word/TXT/Markdown 统一建册（照抄 createFromEpub 形状）。
// source_type ∈ word|txt|markdown；原文件落 assets kind=<sourceType>-original；内嵌图落 kind=image-content
// （文件名 img-N.ext 确定性命名，读侧 readContentImages 取回字节随合成 EPUB 内嵌，M2 备份自动覆盖）。
function createImportedDoc({ title, markdown, sourceType, sourceName, originalName, originalBuf, images }) {
  const cleanTitle = String(title || "").trim() || firstLine(markdown) || "未命名书籍";
  const itemId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const now = Date.now();
  const dir = path.join(app.getPath("userData"), "assets", itemId);
  fs.mkdirSync(dir, { recursive: true });

  if (originalBuf && originalBuf.length) {
    fs.writeFileSync(path.join(dir, originalName), originalBuf);
    addAssetRow(itemId, `${sourceType}-original`, originalName, sha256(originalBuf), now);
  }
  for (const im of images || []) {
    const buf = Buffer.isBuffer(im.bytes) ? im.bytes : Buffer.from(im.bytes);
    if (!buf.length) continue;
    if (!/^[\w.-]+$/.test(String(im.filename))) continue; // 文件名防穿越（导入器产出的 img-N.ext 恒命中）
    fs.writeFileSync(path.join(dir, im.filename), buf);
    addAssetRow(itemId, "image-content", im.filename, sha256(buf), now);
  }

  db.run(
    `INSERT INTO library_items (id, user_id, title, source_type, source_url, cover, created_at, updated_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, NULL, ?, ?, 0, 0)`,
    [itemId, cleanTitle, String(sourceType), sourceName || null, now, now]
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
    fsrsConfigId: r.fsrs_config_id || null,
    leech: r.leech_json ? JSON.parse(r.leech_json) : null,
    generatedBy: r.generated_by,
    genBatchId: r.gen_batch_id,
    dictJson: r.dict_json ? JSON.parse(r.dict_json) : null,
    // v46（M14-UM2，§4.18-10）：记忆溯源（{line, verified}；NULL=未用记忆）
    memoryRefJson: r.memory_ref_json ? JSON.parse(r.memory_ref_json) : null,
    siblingKey: r.sibling_key || null,
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
      Number(card.priority) || 50,
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
      Number(card.priority) || 50,
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

const TODAY_QUEUE_SQL = `SELECT c.*, li.title AS docTitle FROM cards c
     LEFT JOIN documents d ON d.id = json_extract(c.context_ref_json, '$.documentId')
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0
     ORDER BY c.created_at ASC`;

/**
 * 今日队列视图（§4.2-20）：到期筛选（新卡 fsrs_json NULL 视为 due=now）+ 挂起排除 +
 * 同源组额度 + 规范序排序一次算完。now 可注入（测试跨日场景，同 §4.4.4 preview/next 时间注入精神）。
 */
function computeTodayQueue(now = Date.now()) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const rows = queryAll(TODAY_QUEUE_SQL);
  const mapped = rows.map(mapCardRow).map((r) => ({ ...r, docTitle: r.docTitle || (r.sourceRef && r.sourceRef.title) || null }));
  const candidates = mapped.filter((c) => {
    if (c.leech?.suspended) return false;
    return (c.fsrs?.due ?? nowMs) <= nowMs;
  });
  const deferredMap = computeSiblingDeferred(candidates, nowMs);
  const cards = candidates.filter((c) => !deferredMap.has(c.id)).sort(queueMemberOrder);
  const deferred = candidates
    .filter((c) => deferredMap.has(c.id))
    .sort(queueMemberOrder)
    .map((c) => ({ ...c, deferReason: deferredMap.get(c.id) }));
  return { cards, deferred, now: nowMs };
}

function listDueCards(now) {
  // v34（M12 §4.2-20）：口径唯一——队列 = computeTodayQueue().cards（同源延后在此生效）；
  // 旧排序（due 升序、同 due 优先级高在前，§11.5）由 queueMemberOrder 保持。
  return computeTodayQueue(now).cards;
}

function listAllCards() {
  // v19：补 docTitle JOIN（同 listDueCards）——卡片浏览页需要展示来源书并按书筛选
  const rows = queryAll(
    `SELECT c.*, li.title AS docTitle FROM cards c
     LEFT JOIN documents d ON d.id = json_extract(c.context_ref_json, '$.documentId')
     LEFT JOIN library_items li ON li.id = d.library_item_id
     WHERE c.is_deleted = 0 ORDER BY c.created_at DESC`
  );
  return rows.map(mapCardRow).map((r) => ({ ...r, docTitle: r.docTitle || (r.sourceRef && r.sourceRef.title) || null }));
}

function deleteCard(id) {
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
  const now = Date.now();
  const seq = (queryAll("SELECT COALESCE(MAX(review_seq), 0) AS m FROM review_logs")[0]?.m || 0) + 1;
  db.run("BEGIN");
  try {
    db.run(
      "INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, fsrs_before_json, fsrs_after_json, leech_before_json, fsrs_config_id, fsrs_before_config_id, review_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        crypto.randomUUID(),
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
  db.run("BEGIN");
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

// v12：优化器读取全部复习日志（按时间升序）；v23 附带参数归属与插入序（audit/测试用）
function listAllReviewLogs() {
  const rows = queryAll("SELECT card_id AS cardId, rating, reviewed_at AS reviewedAt, fsrs_config_id AS fsrsConfigId, review_seq AS reviewSeq FROM review_logs ORDER BY reviewed_at ASC");
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
  // §4.4.9 规则表：resolveLeech 的 reset 路径重写了 FSRS 状态 → 写入当前活跃配置
  db.run(
    `UPDATE cards SET leech_json=?, front_markdown=COALESCE(?, front_markdown), back_markdown=COALESCE(?, back_markdown),
      mnemonic=COALESCE(?, mnemonic), priority=COALESCE(?, priority), tags_json=?, fsrs_json=?, fsrs_config_id=?,
      updated_at=? WHERE id=?`,
    [
      JSON.stringify(leech),
      updates?.frontMarkdown || null,
      updates?.backMarkdown || null,
      updates?.mnemonic || null,
      updates?.priority ?? null,
      JSON.stringify(updates?.tags || card.tags || []),
      JSON.stringify({ state: "new", due: Date.now(), lapses: 0 }),
      getActiveConfigId(),
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
  const TARGET_VERSION = 7;
  const seedScope = (scope, name, content) => {
    const rows = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = ?", [scope]);
    if (Number(rows[0]?.v || 0) >= TARGET_VERSION) return;
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      [crypto.randomUUID(), scope, name, content, TARGET_VERSION, situationRequiredFor(scope), now]
    );
  };
  seedScope("card-generation", "主制卡 v6", CARD_GEN_PROMPT);
  seedScope("card-formula", "公式分解 v6", CARD_FORMULA_PROMPT);
  seedScope("card-seq", "序列/背诵 v6", CARD_SEQ_PROMPT);
  seedScope("card-enum", "枚举拆解 v6", CARD_ENUM_PROMPT);
  // card-literature：专用文学模板（v31 修复死代码；v30 的序列占位行保留留痕）
  seedScope("card-literature", "文学/诗歌背诵 v6（专用模板）", CARD_LITERATURE_PROMPT);
  seedScope("card-mnemonic", "助记双卡 v6", CARD_MNEMONIC_PROMPT);
  seedScope("card-contrast", "对比卡 v6", CARD_CONTRAST_PROMPT);
  seedScope("card-wording", "措辞优化 v6", CARD_WORDING_PROMPT);
  seedScope("card-basic", "前置知识卡 v6", CARD_BASIC_PROMPT);
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
  const explainCount = queryAll("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'reader-explain'")[0]?.n || 0;
  if (Number(explainCount) === 0) {
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
      [crypto.randomUUID(), "reader-explain", "阅读解释 v1", READER_EXPLAIN_PROMPT, situationRequiredFor("reader-explain"), now]
    );
    db.run(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
      [crypto.randomUUID(), "leech-rescue", "难点诊断 v1", LEECH_RESCUE_PROMPT, situationRequiredFor("leech-rescue"), now]
    );
  }
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
    const MM_TARGET = 2;
    for (const [scope, name, content] of [
      ["material-map-section", "材料结构单元分析 v2", MATERIAL_MAP_SECTION_PROMPT],
      ["material-map-merge", "章节归并 v2", MATERIAL_MAP_MERGE_PROMPT],
      ["material-map-global", "全书归并 v2", MATERIAL_MAP_GLOBAL_PROMPT],
      ["material-map-editorial", "结构终编辑 v2", MATERIAL_MAP_EDITORIAL_PROMPT],
      ["material-map-review", "导图语义评审 v2", MATERIAL_MAP_REVIEW_PROMPT]
    ]) {
      const maxV = queryAll("SELECT MAX(version) AS v FROM prompt_templates WHERE scope = ?", [scope])[0]?.v || 0;
      if (Number(maxV) < MM_TARGET) {
        db.run(
          "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
          [crypto.randomUUID(), scope, name, content, MM_TARGET, situationRequiredFor(scope), now]
        );
      }
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
  db.run("UPDATE dict_sources SET enabled=?, updated_at=? WHERE id=?", [enabled ? 1 : 0, Date.now(), String(id)]);
  persist();
  return true;
}

function removeDictSource(id) {
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

function setDictCache(providerId, language, word, entry, version) {
  db.run("INSERT OR REPLACE INTO dictionary_cache (provider_id, language, normalized_word, result_json, fetched_at, version) VALUES (?,?,?,?,?,?)", [
    String(providerId), String(language), String(word), JSON.stringify(entry), Date.now(), version || null,
  ]);
  persist();
  return true;
}

// ---------- 阅读器 / 摘录队列（Phase 2） ----------

function getDocument(itemId) {
  const stmt = db.prepare(`
    SELECT li.title, li.progress_json AS progressJson, d.id AS documentId, d.markdown, li.source_type AS sourceType
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
    try {
      const mapped = mapCardRow(row);
      kpiCards.push({ ...mapped, docTitle: mapped.docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null });
    } catch { /* 忽略损坏行 */ }
  }
  const active = kpiCards.filter((c) => !c.leech?.suspended);
  const dueTodayCandidates = active.filter((c) => (c.fsrs?.due ?? now) <= today24);
  const kpiDeferred = computeSiblingDeferred(dueTodayCandidates, now);
  const dueToday = dueTodayCandidates.length - kpiDeferred.size;
  const siblingDeferred = kpiDeferred.size;
  const reviewedToday = queryAll("SELECT DISTINCT card_id FROM review_logs WHERE reviewed_at >= ?", [today0]).length;
  const completedToday = active.filter((c) => {
    if ((c.fsrs?.due ?? now) > today24) return false; // 不再被推送
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

  // ---- 卡片生命周期漏斗（近 90 天入队样本；v34 起复用 KPI 卡集，fsrs 已解析）----
  const funnelFrom = now - 90 * 86400_000;
  const cohort = kpiCards.filter((c) => c.createdAt >= funnelFrom);
  const funnel = { drafts: cohort.length, entered: cohort.length, firstLearned: 0, reviewing: 0, consolidated: 0 };
  for (const c of cohort) {
    const f = c.fsrs || {};
    if (f.state === "review" || f.state === "relearning") funnel.firstLearned++;
    if (f.state === "review" && (f.stability ?? 0) > 21) { funnel.reviewing++; funnel.consolidated++; }
    else if (f.state === "review") funnel.reviewing++;
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
  const monthNew = kpiCards.filter((c) => c.createdAt >= monthStart).length;
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
    kpi: { dueToday, completedToday, pendingToday: Math.max(0, dueToday - completedToday), reviewedToday, streak, minutesToday: Math.round(todayDur / 60000), siblingDeferred },
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

// 列表：{from,to} 日期闭区间（'YYYY-MM-DD'；含端点）、{query} 内容子串、{limit,offset} 分页。
// 排序固定 = `entry_date DESC, created_at ASC`（日期倒序 / 日组内正序，§6.5.3）；total=同条件总数（分页用）。
function listJournalEntries({ from, to, query, limit = 200, offset = 0 } = {}) {
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
  const q = String(query ?? "").trim();
  if (q) {
    where.push("content_markdown LIKE ? ESCAPE '\\'");
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const sqlWhere = where.join(" AND ");
  const total = queryAll(`SELECT COUNT(*) AS n FROM journal_entries WHERE ${sqlWhere}`, params)[0]?.n || 0;
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
  const rows = queryAll(
    `SELECT * FROM journal_entries WHERE ${sqlWhere} ORDER BY entry_date DESC, created_at ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { entries: rows.map(mapJournalRow), total };
}

// 有内容的日期清单（倒序）+ 每日条数（日记页日期分组与「今日已记 N 条」同源）
function listJournalDates({ limit = 400 } = {}) {
  const lim = Math.max(1, Math.min(4000, Number(limit) || 400));
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
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO journal_entries (id, user_id, entry_date, content_markdown, source, is_draft, created_at, updated_at, sent_at, sync_version, is_deleted)
     VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      String(entryDate || journalDateOf(created)),
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
  db.run("UPDATE journal_entries SET is_deleted = 1, is_draft = 0, updated_at = ? WHERE id = ?", [Date.now(), String(id)]);
  markJournalPersist(opts);
  return true;
}

// v45（M14-UM1，§4.18-11/-16）：水位线增量读取——`updated_at > since` 的已发送条目，时间正序
// （早期记忆珍贵，补处理先建早期处境）。since=null ⇒ 全部历史（首次开启窗口）。草稿永不入包（§4.18-11①）。
function listJournalEntriesSince({ sinceUpdatedAt = null, limit = 30 } = {}) {
  const lim = Math.max(1, Math.min(1000, Number(limit) || 30));
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
function listKnowledgePoints({ query, domainId, status, limit = 200, offset = 0 } = {}) {
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
  const q = String(query ?? "").trim();
  if (q) {
    where.push("(canonical_label LIKE ? ESCAPE '\\' OR alias_json LIKE ? ESCAPE '\\')");
    const pat = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(pat, pat);
  }
  const sqlWhere = where.join(" AND ");
  const total = queryAll(`SELECT COUNT(*) AS n FROM knowledge_points WHERE ${sqlWhere}`, params)[0]?.n || 0;
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
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

function listKnowledgeRelations({ kpId, relationType, limit = 500, offset = 0 } = {}) {
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
  const lim = Math.max(1, Math.min(2000, Number(limit) || 500));
  const off = Math.max(0, Number(offset) || 0);
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
  db.run("UPDATE knowledge_external_refs SET is_deleted = 1 WHERE id = ?", [String(id)]);
  persist();
  return true;
}

// ---------- 提案暂存（staging，§1.7） ----------

function listKnowledgeProposals({ status = "pending", proposalKind, limit = 200, offset = 0 } = {}) {
  const where = ["is_deleted = 0"];
  const params = [];
  if (status) { where.push("status = ?"); params.push(String(status)); }
  if (proposalKind) { where.push("proposal_kind = ?"); params.push(String(proposalKind)); }
  const sqlWhere = where.join(" AND ");
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
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
function listInsightRuns({ limit = 50, offset = 0, includePackage = false } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
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

function listMemoryRuns({ limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
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

function listPersonalMeaningCandidates({ status, limit = 200, offset = 0 } = {}) {
  const where = ["is_deleted = 0"];
  const params = [];
  if (status) { where.push("status = ?"); params.push(String(status)); }
  const sqlWhere = where.join(" AND ");
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
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

module.exports = {
  initDb,
  persistDb: persist,
  persistNow,
  getBackupCounts,
  listItems,
  createFromPaste,
  createFromEpub,
  createImportedDoc,
  deleteItem,
  getDocument,
  updateProgress,
  createExtract,
  listDueExtracts,
  getExtract,
  postponeExtract,
  getLastUndoableReview,
  undoLastReview,
  createCard,
  updateCard,
  getCard,
  listDueCards,
  computeTodayQueue,
  listAllCards,
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
  findSimilarCards,
  listDictSources,
  upsertDictSource,
  setDictSourceEnabled,
  removeDictSource,
  dictLangForFormat,
  setLibraryItemLang,
  setLibraryItemTitle,
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
  listMindmapLearningStatus
};
