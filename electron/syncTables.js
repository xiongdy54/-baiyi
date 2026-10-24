"use strict";
/**
 * 主库每张表的同步分类（唯一真源）。新增表必须在这里登记，否则 tests/sync-tables.test.cjs 失败。
 *  SYNC  ：用户数据，可修改；要求 id TEXT 主键 + sync_version + is_deleted 列
 *  APPEND：只追加的事实日志（写入后不再修改）；要求 id TEXT 主键
 *  LOCAL ：设备本地（撤销栈、计数器、缓存、AI 调用账本、推荐快照、系统预置模板），永不同步
 * 标 ⚠D-07 的是初始分类，可在决策 D-07 中调整（调整只改本文件）。
 */
const SYNC = [
  "library_items", "documents", "assets", "extracts", "cards", "card_links", "card_issues",
  "learner_tracks", "track_materials", "learning_events", "journal_entries",
  "knowledge_points", "knowledge_relations", "knowledge_external_refs", "knowledge_proposals",
  "insight_runs", "personal_meaning_candidates", "memory_runs",                     // 后三项 ⚠D-07
  "material_maps", "material_map_nodes", "material_map_edges", "material_map_runs", // runs ⚠D-07
  "ai_gen_batches",                    // ⚠D-07（卡片"生成信息区"引用它）
];
const APPEND = ["review_logs", "reading_events", "review_skips", "fsrs_configs", "rec_feedback"];
const LOCAL = [
  "users",                                    // 单行 local-user；账户体系上线时再定
  "extract_ops", "op_counter", "op_journal",  // 撤销栈：只撤销本机操作
  "rec_runs",                                 // 推荐展示快照（保留 300 行）
  "dictionary_cache", "dict_sources",         // 词典文件只在本机（dict_sources.path 是本机绝对路径）
  "material_map_shards",                      // AI 分片缓存 ⚠D-07（同步可省另一台设备的 AI 费用）
  "material_map_calls",                       // AI 调用账本
  "prompt_templates",                         // 每台设备启动时按代码播种（随机 id），同步会重复
  "app_meta",                                 // C-10 新增；其中 fsrsConfigId 将来按"资料库设置"同步，见附录 B
  "sync_tombstones",                          // 本项新增
];
/** 只在本机有意义的列：将来同步时不传输，由接收方重新分配 */
const LOCAL_COLUMNS = { review_logs: ["review_seq"] };
/** 自然键：将来合并时按这些列识别"同一条"，而不是按 id */
const NATURAL_KEYS = {
  fsrs_configs: ["config_fingerprint"],
  track_materials: ["track_id", "library_item_id"],
  material_map_nodes: ["map_id", "node_id"],
  material_map_edges: ["map_id", "from_id", "to_id", "code"],
};
/** 允许物理删除的表（同步/追加表的其他物理删除一律禁止，tests/sync-tables 静态扫描）。删除会经触发器写入 sync_tombstones。 */
const PHYSICAL_DELETE_ALLOWLIST = [
  { table: "review_logs", fn: "undoLastReview", reason: "撤销评分＝回退（§4.4.9）" },
  { table: "material_maps", fn: "deleteMaterialMap", reason: "§7.2 已登记" },
  { table: "material_map_nodes", fn: "deleteMaterialMap", reason: "D192 随版本连带删除" },
  { table: "material_map_edges", fn: "deleteMaterialMap", reason: "D192 随版本连带删除" },
  // C-38a 执行时实测补充（报告清单遗漏）：createAssetForItem 的 rename 失败补偿路径会
  // `DELETE FROM assets`（db.js，C-22 语义）——删除的是刚写入、尚无文件对应的悬空行，
  // 行从未对用户可见；墓碑照写（同步引擎侧对从未传输过的行按 no-op 处理，属 D-07 范畴）。
  { table: "assets", fn: "createAssetForItem", reason: "C-22 rename 失败补偿——删无文件对应的悬空行" },
];
module.exports = { SYNC, APPEND, LOCAL, LOCAL_COLUMNS, NATURAL_KEYS, PHYSICAL_DELETE_ALLOWLIST };
