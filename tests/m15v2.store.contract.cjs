// @runtime: node
// 导图 v2 store 契约（IMPL-PLAN §3）：同一份断言同时锁定内存实现（tests/lib/mindmapMemoryStore.cjs）与真实库（electron/db.js）。
//   node tests/m15v2.store.contract.cjs                 —— 对内存 store 直跑
//   require(...).runStoreContract(store, assert)        —— tests/m15v2.db.test.cjs 对真实 db 复用
// 约束：只用 §3.2 公开 API 与 v1 的 saveMaterialMap / getMaterialMap / setActiveMaterialMap / deleteMaterialMap /
// saveMaterialMapCall / listMaterialMapCalls；每个用例自带唯一 documentId，可在非空库上重复运行；同步调用（db 为 better-sqlite3）。
const crypto = require("crypto");

const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

// 完整 NodeRow（缺省字段为 null）
function N(nodeId, parentId, ord, extra = {}) {
  return {
    nodeId, parentId, ord, title: extra.title ?? `T${nodeId}`, type: extra.type ?? "论点", time: null, pattern: null,
    blockStart: null, blockEnd: null, spans: null, state: "more", source: "toc", warnings: null, explain: null, jobId: null,
    ...extra
  };
}
// 上行用的部分行：不带 jobId 键（undefined → 由 commit 盖章）
const U = (nodeId, parentId, ord, extra = {}) => { const r = N(nodeId, parentId, ord, extra); if (!("jobId" in extra)) delete r.jobId; return r; };
const nodeIds = (rows) => rows.map((r) => r.nodeId);

function runStoreContract(store, assert) {
  let steps = 0;
  function step(name, fn) {
    fn();
    steps++;
    console.log(`  ✓ ${name}`);
  }
  const v2 = (doc, skeleton = [N("t1", null, 1000), N("t2", null, 5000)], extra = {}) =>
    store.createMaterialMapV2({
      documentId: doc, title: "导图", meta: { title: "导图", blocksVersion: 1, outlineVersion: 1, promptVersions: { outline: 1, expand: 1, explain: 1 }, model: "m-x" },
      skeleton, sourceRevisionHash: "rev1", provider: "zai", model: "m-x", modelConfigHash: "cfg", promptVersion: 1, ...extra
    });

  console.log("---- 契约 C1 createMaterialMapV2 ----");
  step("返回 { mapId }、不激活、v2 元信息、不含 nodes", () => {
    const doc = uid("c1");
    const r = v2(doc);
    assert.deepStrictEqual(Object.keys(r), ["mapId"]);
    const m = store.getMaterialMap(r.mapId);
    assert.strictEqual(m.isActive, false);
    assert.strictEqual(m.schemaVersion, 2);
    assert.strictEqual(m.documentId, doc);
    assert.strictEqual(m.generatorVersion, "m15v2-engine-1");
    assert.strictEqual(m.nodeCount, 2);
    assert.strictEqual(m.view, null);
    assert.strictEqual(m.structure.schemaVersion, 2);
    assert.strictEqual(m.structure.nodes, undefined);
    assert.deepStrictEqual(m.structure.promptVersions, { outline: 1, expand: 1, explain: 1 });
    assert.strictEqual(m.provider, "zai");
    assert.strictEqual(m.model, "m-x");
  });
  step("骨架节点入库，NodeRow 形态完整", () => {
    const r = v2(uid("c1"), [N("t1", null, 1000, { blockStart: 1, blockEnd: 9, spans: [[1, 9]], time: "1789", pattern: "tree", warnings: ["w"] })]);
    assert.deepStrictEqual(store.listMaterialMapNodes(r.mapId), [N("t1", null, 1000, { blockStart: 1, blockEnd: 9, spans: [[1, 9]], time: "1789", pattern: "tree", warnings: ["w"] })]);
  });
  step("v1 行 schemaVersion=1 且 view=null", () => {
    const m = store.saveMaterialMap({ documentId: uid("c1"), structure: { title: "v1", nodes: [], edges: [] } });
    assert.strictEqual(m.schemaVersion, 1);
    assert.strictEqual(m.view, null);
  });
  step("缺 documentId 抛错；骨架含非法行则整体回滚（无半成品版本）", () => {
    assert.throws(() => store.createMaterialMapV2({ title: "x", meta: {}, skeleton: [] }));
    const doc = uid("c1");
    assert.throws(() => v2(doc, [N("t1", null, 1000), N("t2", null, 2000, { state: "bogus" })]));
    assert.deepStrictEqual(store.listMaterialMaps(doc), []);
  });
  step("创建不激活：不触碰同文档旧激活版本", () => {
    const doc = uid("c1");
    const old = store.saveMaterialMap({ documentId: doc, structure: { title: "old", nodes: [], edges: [] } });
    v2(doc);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
  });

  console.log("---- 契约 C2 commitMaterialMapJob ----");
  step("upsert / states / edges 落库并返回 nodeCount；jobId 盖章", () => {
    const { mapId } = v2(uid("c2"));
    const out = store.commitMaterialMapJob({
      mapId, jobId: "job1",
      upserts: [U("t1.1", "t1", 1001, { source: "ai", state: "open" }), N("t1.2", "t1", 1002, { source: "ai", state: "floor", jobId: "other" })],
      states: [{ nodeId: "t1", state: "open" }, { nodeId: "ghost", state: "floor" }],
      edges: [{ fromId: "t1.2", toId: "t1.1", code: "驳" }]
    });
    assert.deepStrictEqual(out, { nodeCount: 4 });
    const rows = store.listMaterialMapNodes(mapId);
    const by = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
    assert.strictEqual(by["t1"].state, "open");
    assert.strictEqual(by["t1.1"].jobId, "job1");
    assert.strictEqual(by["t1.2"].jobId, "other");
    assert.strictEqual(by["ghost"], undefined);
    assert.deepStrictEqual(store.listMaterialMapEdges(mapId), [{ fromId: "t1.2", toId: "t1.1", code: "驳", origin: "text", jobId: "job1" }]);
    assert.strictEqual(store.getMaterialMap(mapId).nodeCount, 4);
  });
  step("upsert 以 (mapId,nodeId) 为键，undefined 字段保持原值（含 explain）", () => {
    const { mapId } = v2(uid("c2"));
    store.commitMaterialMapJob({ mapId, jobId: "j1", upserts: [N("t1.1", "t1", 1001, { source: "ai", state: "open", title: "旧标题", spans: [[1, 2]] })] });
    assert.strictEqual(store.setMaterialMapNodeExplain(mapId, "t1.1", { text: "讲解", model: "m", promptVersion: 1, at: 5 }), true);
    store.commitMaterialMapJob({ mapId, jobId: "j2", upserts: [{ nodeId: "t1.1", title: "新标题", state: "floor" }] });
    const n = store.listMaterialMapNodes(mapId).find((r) => r.nodeId === "t1.1");
    assert.strictEqual(n.title, "新标题");
    assert.strictEqual(n.state, "floor");
    assert.strictEqual(n.type, "论点");
    assert.deepStrictEqual(n.spans, [[1, 2]]);
    assert.deepStrictEqual(n.explain, { text: "讲解", model: "m", promptVersion: 1, at: 5 });
    assert.strictEqual(n.jobId, "j2");
    assert.strictEqual(store.listMaterialMapNodes(mapId).length, 3);
  });
  step("边按 (from,to,code) 幂等；origin 可更新", () => {
    const { mapId } = v2(uid("c2"));
    const e = { fromId: "t1", toId: "t2", code: "支" };
    store.commitMaterialMapJob({ mapId, jobId: "j1", edges: [e, e] });
    store.commitMaterialMapJob({ mapId, jobId: "j2", edges: [{ ...e, origin: "user" }, { fromId: "t1", toId: "t2", code: "因" }] });
    const es = store.listMaterialMapEdges(mapId);
    assert.strictEqual(es.length, 2);
    assert.deepStrictEqual(es[0], { fromId: "t1", toId: "t2", code: "支", origin: "user", jobId: "j2" });
  });
  step("原子：任一行非法则整体回滚（节点/边/node_count/激活均不变）", () => {
    const doc = uid("c2");
    const old = store.saveMaterialMap({ documentId: doc, structure: { title: "old", nodes: [], edges: [] } });
    const { mapId } = v2(doc);
    const before = store.listMaterialMapNodes(mapId);
    assert.throws(() => store.commitMaterialMapJob({
      mapId, jobId: "jx", activate: true,
      upserts: [N("t1.1", "t1", 1001, { source: "ai" }), N("t1.2", "t1", 1002, { source: "ai", state: "streaming" })],
      states: [{ nodeId: "t1", state: "open" }],
      edges: [{ fromId: "a", toId: "b", code: "支" }]
    }));
    assert.deepStrictEqual(store.listMaterialMapNodes(mapId), before);
    assert.deepStrictEqual(store.listMaterialMapEdges(mapId), []);
    assert.strictEqual(store.getMaterialMap(mapId).nodeCount, 2);
    assert.strictEqual(store.getMaterialMap(mapId).isActive, false);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
    assert.throws(() => store.commitMaterialMapJob({ mapId, upserts: [{ nodeId: "z", ord: 1, title: "x" }] }), undefined, "新行缺 type/state/source 必须抛");
    assert.throws(() => store.commitMaterialMapJob({ mapId, edges: [{ fromId: "a", toId: "b" }] }), undefined, "边缺 code 必须抛");
  });
  step("不存在的版本抛错", () => {
    assert.throws(() => store.commitMaterialMapJob({ mapId: "nope-" + uid("m"), upserts: [] }));
  });
  step("activate 缺省/false 不激活；true 才激活并使同文档旧激活版本降为历史", () => {
    const doc = uid("c2");
    const old = store.saveMaterialMap({ documentId: doc, structure: { title: "old", nodes: [], edges: [] } });
    const { mapId } = v2(doc);
    store.commitMaterialMapJob({ mapId, jobId: "j1", upserts: [N("t1.1", "t1", 1001, { source: "ai" })] });
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
    store.commitMaterialMapJob({ mapId, jobId: "j2", upserts: [], activate: false });
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
    store.commitMaterialMapJob({ mapId, jobId: "j3", upserts: [N("t1.2", "t1", 1002, { source: "ai" })], activate: true });
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, mapId);
    assert.strictEqual(store.getMaterialMap(old.id, { includeStructure: false }).isActive, false);
    assert.strictEqual(store.listMaterialMaps(doc).filter((m) => m.isActive).length, 1);
  });
  step("不同文档互不挤占激活", () => {
    const d1 = uid("c2"), d2 = uid("c2");
    const a = v2(d1), b = v2(d2);
    store.commitMaterialMapJob({ mapId: a.mapId, upserts: [], activate: true });
    store.commitMaterialMapJob({ mapId: b.mapId, upserts: [], activate: true });
    assert.strictEqual(store.getActiveMaterialMap(d1, "book").id, a.mapId);
    assert.strictEqual(store.getActiveMaterialMap(d2, "book").id, b.mapId);
  });
  step("setActiveMaterialMap 对 v1/v2 版本通用（版本区混排）", () => {
    const doc = uid("c2");
    const old = store.saveMaterialMap({ documentId: doc, structure: { title: "old", nodes: [], edges: [] } });
    const { mapId } = v2(doc);
    store.commitMaterialMapJob({ mapId, upserts: [], activate: true });
    store.setActiveMaterialMap(old.id);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
    store.setActiveMaterialMap(mapId);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, mapId);
    assert.deepStrictEqual(store.listMaterialMaps(doc).map((m) => m.schemaVersion).sort(), [1, 2]);
  });

  console.log("---- 契约 C3 读取顺序与形态 ----");
  step("listMaterialMapNodes：parent_id（NULL 在前）→ ord → nodeId", () => {
    const { mapId } = v2(uid("c3"), [N("b", null, 9000), N("a", null, 1000), N("a.2", "a", 1002), N("a.1", "a", 1001), N("c.1", "c", 5), N("c.1x", "c", 5)]);
    assert.deepStrictEqual(nodeIds(store.listMaterialMapNodes(mapId)), ["a", "b", "a.1", "a.2", "c.1", "c.1x"]);
  });
  step("空版本/不存在的版本返回空数组", () => {
    assert.deepStrictEqual(store.listMaterialMapNodes("nope-" + uid("m")), []);
    assert.deepStrictEqual(store.listMaterialMapEdges("nope-" + uid("m")), []);
  });

  console.log("---- 契约 C4 explain / view ----");
  step("setMaterialMapNodeExplain：存在 true / 不存在 false，读回一致", () => {
    const { mapId } = v2(uid("c4"));
    const ex = { text: "这一部分回答……", model: "m", promptVersion: 1, at: 123 };
    assert.strictEqual(store.setMaterialMapNodeExplain(mapId, "t2", ex), true);
    assert.deepStrictEqual(store.listMaterialMapNodes(mapId).find((n) => n.nodeId === "t2").explain, ex);
    assert.strictEqual(store.setMaterialMapNodeExplain(mapId, "ghost", ex), false);
    assert.strictEqual(store.setMaterialMapNodeExplain("nope-" + uid("m"), "t2", ex), false);
  });
  step("setMaterialMapView：读回 view；null 清空；版本不存在 false；不新建版本", () => {
    const doc = uid("c4");
    const { mapId } = v2(doc);
    const view = { patterns: { t1: "timeline" }, collapsed: ["t2"] };
    assert.strictEqual(store.setMaterialMapView(mapId, view), true);
    assert.deepStrictEqual(store.getMaterialMap(mapId).view, view);
    assert.deepStrictEqual(store.listMaterialMaps(doc).find((m) => m.id === mapId).view, view);
    assert.strictEqual(store.setMaterialMapView(mapId, null), true);
    assert.strictEqual(store.getMaterialMap(mapId).view, null);
    assert.strictEqual(store.setMaterialMapView("nope-" + uid("m"), view), false);
    assert.strictEqual(store.listMaterialMaps(doc).length, 1);
  });

  console.log("---- 契约 C5 删除级联 ----");
  step("deleteMaterialMap 物理删除该版本 nodes/edges，不触碰其它版本", () => {
    const doc = uid("c5");
    const a = v2(doc), b = v2(doc);
    for (const m of [a, b]) {
      store.commitMaterialMapJob({ mapId: m.mapId, jobId: "j", upserts: [N("t1.1", "t1", 1001, { source: "ai" })], edges: [{ fromId: "t1", toId: "t2", code: "支" }] });
    }
    assert.strictEqual(store.deleteMaterialMap(a.mapId), true);
    assert.strictEqual(store.getMaterialMap(a.mapId), null);
    assert.deepStrictEqual(store.listMaterialMapNodes(a.mapId), []);
    assert.deepStrictEqual(store.listMaterialMapEdges(a.mapId), []);
    assert.strictEqual(store.listMaterialMapNodes(b.mapId).length, 3);
    assert.strictEqual(store.listMaterialMapEdges(b.mapId).length, 1);
    assert.strictEqual(store.deleteMaterialMap(a.mapId), false);
  });
  step("删激活版本：同文档最新剩余版本顺延激活（沿用 v1 语义）", () => {
    const doc = uid("c5");
    const old = store.saveMaterialMap({ documentId: doc, structure: { title: "old", nodes: [], edges: [] } });
    const cur = v2(doc);
    store.commitMaterialMapJob({ mapId: cur.mapId, upserts: [], activate: true });
    assert.strictEqual(store.deleteMaterialMap(cur.mapId), true);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, old.id);
    assert.strictEqual(store.deleteMaterialMap(old.id), true);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book"), null);
  });
  step("删非激活版本不改变激活版本", () => {
    const doc = uid("c5");
    const a = v2(doc);
    store.commitMaterialMapJob({ mapId: a.mapId, upserts: [], activate: true });
    const b = v2(doc);
    assert.strictEqual(store.deleteMaterialMap(b.mapId), true);
    assert.strictEqual(store.getActiveMaterialMap(doc, "book").id, a.mapId);
  });

  console.log("---- 契约 C6 账本新列 ----");
  step("saveMaterialMapCall 新列读回一致（dropJson 对象入参被序列化为字符串）", () => {
    const doc = uid("c6"), run = uid("run");
    const id = store.saveMaterialMapCall({
      runId: run, documentId: doc, runKind: "outline", nodeAnchor: "blk:1-9", outcome: "completed", finishReason: "stop",
      wallMs: 1200, ttftMs: 300, depth: 2, chars: 5000, promptTokens: 100, completionTokens: 50,
      model: "glm-x", ttfnMs: 450, lines: 12, linesDropped: 1, dropJson: { badLevel: 1 }, relsDropped: 2, reasoningChars: 77, trigger: "click"
    });
    assert.strictEqual(typeof id, "string");
    const rows = store.listMaterialMapCalls(run);
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.model, "glm-x");
    assert.strictEqual(r.ttfnMs, 450);
    assert.strictEqual(r.lines, 12);
    assert.strictEqual(r.linesDropped, 1);
    assert.deepStrictEqual(JSON.parse(r.dropJson), { badLevel: 1 });
    assert.strictEqual(r.relsDropped, 2);
    assert.strictEqual(r.reasoningChars, 77);
    assert.strictEqual(r.trigger, "click");
    assert.strictEqual(r.runKind, "outline");
    assert.strictEqual(r.wallMs, 1200);
  });
  step("v1 风格调用（不传新列）新列读回 null", () => {
    const run = uid("run");
    store.saveMaterialMapCall({ runId: run, documentId: uid("c6"), runKind: "section" });
    const r = store.listMaterialMapCalls(run)[0];
    for (const k of ["model", "ttfnMs", "lines", "linesDropped", "dropJson", "relsDropped", "reasoningChars", "trigger"]) assert.strictEqual(r[k], null, k);
  });
  step("countMaterialMapCallsSince：按文档、trigger、sinceMs（绝对时间戳）", () => {
    const doc = uid("c6"), other = uid("c6"), run = uid("run");
    for (const trigger of ["click", "click", "prefetch", "auto"]) store.saveMaterialMapCall({ runId: run, documentId: doc, runKind: "expand", trigger });
    store.saveMaterialMapCall({ runId: run, documentId: other, runKind: "expand", trigger: "click" });
    assert.strictEqual(store.countMaterialMapCallsSince(doc, { trigger: "click", sinceMs: 0 }), 2);
    assert.strictEqual(store.countMaterialMapCallsSince(doc, { trigger: "prefetch", sinceMs: 0 }), 1);
    assert.strictEqual(store.countMaterialMapCallsSince(doc, { trigger: "all-none", sinceMs: 0 }), 0);
    assert.strictEqual(store.countMaterialMapCallsSince(doc, { trigger: "click", sinceMs: Date.now() + 3600e3 }), 0);
    assert.strictEqual(store.countMaterialMapCallsSince(doc, { sinceMs: 0 }), 4);
    assert.strictEqual(store.countMaterialMapCallsSince(uid("c6"), { trigger: "click", sinceMs: 0 }), 0);
  });

  return steps;
}

module.exports = { runStoreContract, N };

if (require.main === module) {
  const assert = require("assert");
  const path = require("path");
  const { createMemoryStore } = require(path.join(__dirname, "lib", "mindmapMemoryStore.cjs"));
  console.log("导图 v2 store 契约 × 内存实现");
  let n;
  try {
    n = runStoreContract(createMemoryStore(), assert);
  } catch (e) {
    console.log(`  ✗ ${e && e.stack ? e.stack : e}`);
    console.log("\nFAILED");
    process.exit(1);
  }
  console.log(`\n${n} passed, 0 failed`);
}
