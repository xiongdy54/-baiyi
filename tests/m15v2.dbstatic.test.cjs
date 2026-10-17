// @runtime: node
// 导图 v2 数据层静态守护（node 直跑：node tests/m15v2.dbstatic.test.cjs）。
// 沙箱无法加载 better-sqlite3，这里只对 electron/db.js 源码做正则确认；真实库行为见 tests/m15v2.db.test.cjs（@runtime: electron）。
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "electron", "db.js"), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}
const has = (re) => re.test(src);
function fnBody(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const j = src.indexOf("\nfunction ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

console.log("---- 1 DDL ----");
{
  const nodes = (src.match(/CREATE TABLE IF NOT EXISTS material_map_nodes \(([\s\S]*?)\n    \)`\)/) || [])[1] || "";
  check("material_map_nodes 表存在", nodes.length > 0);
  for (const col of ["id TEXT PRIMARY KEY", "map_id TEXT NOT NULL", "node_id TEXT NOT NULL", "parent_id TEXT", "ord INTEGER NOT NULL", "title TEXT NOT NULL", "type TEXT NOT NULL",
    "time_text TEXT", "pattern_hint TEXT", "block_start INTEGER", "block_end INTEGER", "spans_json TEXT", "state TEXT NOT NULL", "source TEXT NOT NULL",
    "warnings_json TEXT", "explain_json TEXT", "job_id TEXT", "sync_version INTEGER NOT NULL DEFAULT 0", "is_deleted INTEGER NOT NULL DEFAULT 0"]) {
    check(`nodes 列：${col}`, nodes.includes(col));
  }
  check("idx_mmnodes_key 唯一索引 (map_id, node_id)", has(/CREATE UNIQUE INDEX IF NOT EXISTS idx_mmnodes_key ON material_map_nodes\(map_id, node_id\)/));
  check("idx_mmnodes_parent (map_id, parent_id, ord)", has(/idx_mmnodes_parent ON material_map_nodes\(map_id, parent_id, ord\)/));
  const edges = (src.match(/CREATE TABLE IF NOT EXISTS material_map_edges \(([\s\S]*?)\n    \)`\)/) || [])[1] || "";
  check("material_map_edges 表存在", edges.length > 0);
  for (const col of ["from_id TEXT NOT NULL", "to_id TEXT NOT NULL", "code TEXT NOT NULL", "origin TEXT NOT NULL DEFAULT 'text'", "job_id TEXT", "is_deleted INTEGER NOT NULL DEFAULT 0"]) {
    check(`edges 列：${col}`, edges.includes(col));
  }
  check("idx_mmedges_key 唯一索引 (map_id, from_id, to_id, code)", has(/idx_mmedges_key ON material_map_edges\(map_id, from_id, to_id, code\)/));
  check("idx_mmedges_to (map_id, to_id)", has(/idx_mmedges_to ON material_map_edges\(map_id, to_id\)/));
  check("两张新表建在 v48 导图建表段之后（material_map_calls 之后）", src.indexOf("CREATE TABLE IF NOT EXISTS material_map_nodes") > src.indexOf("CREATE TABLE IF NOT EXISTS material_map_calls"));
  check("material_maps.view_json 守卫式 ALTER", has(/ALTER TABLE material_maps ADD COLUMN view_json TEXT/));
}

console.log("---- 2 账本新列 ----");
{
  for (const col of ["model", "ttfn_ms", "lines", "lines_dropped", "drop_json", "rels_dropped", "reasoning_chars", "trigger"]) {
    check(`calls 补列循环含 "${col}"`, has(new RegExp(`\\["${col}", "(TEXT|INTEGER)"\\]`)));
  }
  check("补列走守卫式 ALTER（try/catch，列名加引号）", has(/ALTER TABLE material_map_calls ADD COLUMN "\$\{col\}"/));
  const save = fnBody("saveMaterialMapCall");
  check("saveMaterialMapCall 接收新字段", ["model", "ttfnMs", "lines", "linesDropped", "dropJson", "relsDropped", "reasoningChars", "trigger"].every((k) => new RegExp(`\\b${k}\\b`).test(save)));
  check('saveMaterialMapCall INSERT 含 "trigger" 引号列', /\n\s+model, ttfn_ms, lines, lines_dropped, drop_json, rels_dropped, reasoning_chars, "trigger"\)/.test(save));
  const list = fnBody("listMaterialMapCalls");
  check("listMaterialMapCalls 回读新字段", ["ttfnMs: r.ttfn_ms", "linesDropped: r.lines_dropped", "reasoningChars: r.reasoning_chars", "trigger: r.trigger"].every((s) => list.includes(s)));
}

console.log("---- 3 提示词三 scope 播种 ----");
{
  check("db.js 引入三常量", /MATERIAL_MAP_OUTLINE_PROMPT,\s*MATERIAL_MAP_EXPAND_PROMPT,\s*MATERIAL_MAP_EXPLAIN_PROMPT,/.test(src));
  for (const [scope, name, c] of [["material-map-outline", "导图框架 v1", "OUTLINE"], ["material-map-expand", "导图深挖 v1", "EXPAND"], ["material-map-explain", "节点讲解 v1", "EXPLAIN"]]) {
    check(`播种 ${scope}「${name}」`, has(new RegExp(`\\["${scope}", "${name}", MATERIAL_MAP_${c}_PROMPT\\]`)));
    check(`${scope} 目标版本 1`, has(new RegExp(`"${scope}": 1`)));
  }
  check("沿用「MAX(version) < 目标即插入」", /MM2_TARGETS\[scope\]\) \{[\s\S]{0,200}INSERT INTO prompt_templates/.test(src));
  check("situationRequiredFor 对三 scope 返回 0（不在 SITUATION_REQUIRED_SCOPES）", (() => {
    const P = require(path.join(__dirname, "..", "electron", "prompts.js"));
    return ["material-map-outline", "material-map-expand", "material-map-explain"].every((s) => P.situationRequiredFor(s) === 0);
  })());
}

console.log("---- 4 视图列与读取口 ----");
{
  const row = fnBody("mapMaterialMapRow");
  check("mapMaterialMapRow 返回 view 与 schemaVersion", /schemaVersion:/.test(row) && /view_json/.test(row));
}

console.log("---- 5 事务纪律 ----");
{
  check("commitMaterialMapJob 经 withTransaction", /function commitMaterialMapJob[\s\S]*?return withTransaction\(/.test(src));
  check("createMaterialMapV2 经 withTransaction 且 is_active=0 建行", /function createMaterialMapV2[\s\S]*?withTransaction\([\s\S]*?NULL, 0, \?, \?, 0, 0\)/.test(src));
  const del = fnBody("deleteMaterialMap");
  check("deleteMaterialMap 同事务级联删除 nodes/edges", /withTransaction\(/.test(del) && /DELETE FROM material_map_nodes WHERE map_id = \?/.test(del) && /DELETE FROM material_map_edges WHERE map_id = \?/.test(del));
  check("deleteMaterialMap v1 激活顺延逻辑保留", /UPDATE material_maps SET is_active = 1 WHERE id = \?/.test(del));
}

console.log("---- 6 导出名 ----");
{
  const exp = src.slice(src.lastIndexOf("module.exports"));
  for (const n of ["createMaterialMapV2", "commitMaterialMapJob", "listMaterialMapNodes", "listMaterialMapEdges", "setMaterialMapNodeExplain", "setMaterialMapView", "countMaterialMapCallsSince",
    "saveMaterialMapCall", "deleteMaterialMap", "getMaterialMap"]) {
    check(`导出 ${n}`, new RegExp(`\\n\\s+${n},?\\n`).test(exp));
    if (/^(create|commit|list|set|count)/.test(n) && n.endsWith("V2") || ["commitMaterialMapJob", "listMaterialMapNodes", "listMaterialMapEdges", "setMaterialMapNodeExplain", "setMaterialMapView", "countMaterialMapCallsSince"].includes(n)) {
      check(`函数定义 ${n}`, has(new RegExp(`\\nfunction ${n}\\(`)));
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
