// @runtime: electron
// 导图 v2 数据层回归（electron 直跑：npx electron tests/m15v2.db.test.cjs，须先关应用；沙箱无法运行，由用户在 Windows 跑）。
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库。
// 覆盖：① tests/m15v2.store.contract.cjs 同一份契约对真实 db ② 重启（closeDb → initDb）读回
// ③ 级联删除的物理性（直读库文件，行真的没了）④ 三 scope 播种版本 ⑤ 新表/新列存在 ⑥ 提示词内容 === prompts.js 常量。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { runStoreContract, N } = require(path.join(__dirname, "m15v2.store.contract.cjs"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m15v2-db-test-"));
  let ro = null;
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const P = require(path.join(ROOT, "electron", "prompts.js"));
    const Database = require("better-sqlite3");
    await db.initDb();
    const libFile = path.join(tmp, "library.db");
    const readRows = (sql, params = []) => {
      const h = new Database(libFile, { readonly: true });
      try { return h.prepare(sql).all(...params); } finally { h.close(); }
    };

    console.log("---- V2-DB1 store 契约（与内存实现同一份断言） ----");
    let steps = 0;
    try {
      steps = runStoreContract(db, assert);
    } catch (e) {
      console.log(`  ✗ 契约失败：${e && (e.stack || e.message)}`);
    }
    check("契约全部用例通过", steps >= 20, steps);

    console.log("---- V2-DB2 新表 / 新列 ----");
    {
      const tbl = (n) => readRows("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [n]).length === 1;
      check("material_map_nodes / material_map_edges 存在", tbl("material_map_nodes") && tbl("material_map_edges"));
      const idx = readRows("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name);
      check("索引齐全", ["idx_mmnodes_key", "idx_mmnodes_parent", "idx_mmedges_key", "idx_mmedges_to"].every((i) => idx.includes(i)), idx);
      const cols = (t) => readRows(`PRAGMA table_info(${t})`).map((r) => r.name);
      check("material_maps.view_json", cols("material_maps").includes("view_json"));
      check("material_map_calls 新列齐全", ["model", "ttfn_ms", "lines", "lines_dropped", "drop_json", "rels_dropped", "reasoning_chars", "trigger"].every((c) => cols("material_map_calls").includes(c)), cols("material_map_calls"));
    }

    console.log("---- V2-DB3 三 scope 播种（版本 1 / 内容 === prompts.js / situation_required=0） ----");
    {
      const want = [
        ["material-map-outline", "导图框架 v2", P.MATERIAL_MAP_OUTLINE_PROMPT, 2],
        ["material-map-expand", "导图深挖 v2", P.MATERIAL_MAP_EXPAND_PROMPT, 2],
        ["material-map-explain", "节点讲解 v1", P.MATERIAL_MAP_EXPLAIN_PROMPT, 1]
      ];
      for (const [scope, name, content, version] of want) {
        const row = db.getPromptTemplate(scope);
        check(`${scope}：已播种 v${version}「${name}」`, !!row && row.version === version && row.name === name, row && { v: row.version, n: row.name });
        check(`${scope}：content 逐字 === prompts.js 常量`, !!row && row.content === content);
        check(`${scope}：situation_required=0 且为默认`, !!row && Number(row.situation_required) === 0 && Number(row.is_default) === 1, row && { s: row.situation_required, d: row.is_default });
      }
      // 幂等：再次 initDb（下方重启段）不重复播种
    }

    console.log("---- V2-DB4 重启读回 + 级联删除物理性 ----");
    const doc = "restart-doc";
    const old = db.saveMaterialMap({ documentId: doc, structure: { title: "v1", nodes: [], edges: [] }, title: "v1" });
    const { mapId } = db.createMaterialMapV2({
      documentId: doc, title: "重启图", meta: { title: "重启图", blocksVersion: 1, model: "m" },
      skeleton: [N("t1", null, 1000, { blockStart: 1, blockEnd: 20 }), N("t2", null, 21000, { blockStart: 21, blockEnd: 40 })],
      provider: "zai", model: "m", modelConfigHash: "c", promptVersion: 1
    });
    db.commitMaterialMapJob({
      mapId, jobId: "job-r",
      upserts: [N("t1.1", "t1", 1001, { source: "ai", state: "floor", jobId: undefined, spans: [[1, 5]] })],
      states: [{ nodeId: "t1", state: "open" }],
      edges: [{ fromId: "t1.1", toId: "t2", code: "据" }],
      activate: true
    });
    db.setMaterialMapNodeExplain(mapId, "t1.1", { text: "讲解", model: "m", promptVersion: 1, at: 1 });
    db.setMaterialMapView(mapId, { patterns: { t1: "tree" }, collapsed: [] });
    const nodesBefore = db.listMaterialMapNodes(mapId);
    const edgesBefore = db.listMaterialMapEdges(mapId);
    db.closeDb();
    await db.initDb();
    check("重启后节点逐字段一致", JSON.stringify(db.listMaterialMapNodes(mapId)) === JSON.stringify(nodesBefore), db.listMaterialMapNodes(mapId));
    check("重启后边一致", JSON.stringify(db.listMaterialMapEdges(mapId)) === JSON.stringify(edgesBefore));
    const m = db.getMaterialMap(mapId);
    check("重启后版本行：v2 / 激活 / view / nodeCount", m.schemaVersion === 2 && m.isActive === true && m.nodeCount === 3 && JSON.stringify(m.view) === JSON.stringify({ patterns: { t1: "tree" }, collapsed: [] }), m);
    check("重启后旧 v1 版本已降为历史", db.getMaterialMap(old.id, { includeStructure: false }).isActive === false);
    check("重启后不重复播种提示词", readRows("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'material-map-outline'")[0].n === 1);
    check("删除前库内有 3 节点 1 边", readRows("SELECT COUNT(*) AS n FROM material_map_nodes WHERE map_id = ?", [mapId])[0].n === 3 && readRows("SELECT COUNT(*) AS n FROM material_map_edges WHERE map_id = ?", [mapId])[0].n === 1);
    check("deleteMaterialMap 返回 true", db.deleteMaterialMap(mapId) === true);
    check("物理删除：nodes 行 0", readRows("SELECT COUNT(*) AS n FROM material_map_nodes WHERE map_id = ?", [mapId])[0].n === 0);
    check("物理删除：edges 行 0", readRows("SELECT COUNT(*) AS n FROM material_map_edges WHERE map_id = ?", [mapId])[0].n === 0);
    check("删除后旧 v1 版本顺延激活", db.getActiveMaterialMap(doc, "book") && db.getActiveMaterialMap(doc, "book").id === old.id);

    console.log("---- V2-DB5 v1 兼容：v1 导图写读不受影响 ----");
    {
      const s = { title: "v1b", nodes: [{ id: "n1", parentId: null, title: "根", childIds: [], evidence: [] }], edges: [] };
      const saved = db.saveMaterialMap({ documentId: "v1-doc", structure: s, title: "v1b" });
      check("v1 saveMaterialMap：schemaVersion=1、结构完整", saved.schemaVersion === 1 && saved.structure.nodes.length === 1 && saved.nodeCount === 1, saved);
      check("v1 删除不报错、返回 true", db.deleteMaterialMap(saved.id) === true);
    }

    console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
    if (fail) {
      console.log("FAILED items exist");
      app.exit(1);
      return;
    }
    app.exit(0);
  } catch (err) {
    console.error("FATAL:", err && (err.stack || err.message));
    app.exit(1);
  } finally {
    try { if (ro) ro.close(); } catch { /* ignore */ }
  }
});
