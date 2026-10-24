// @runtime: system-node
// 材料导图 v2 · 真实 electron/db.js 回归（node tests/m15v2.realdb.test.cjs）。
// 沙箱跑不了 better-sqlite3（win32 原生模块），这里用 tests/lib/nodeSqliteShim.cjs 以 node:sqlite 冒充，
// 跑「真实 db.js 的 SQL」：① store 契约 C1–C7 ② 引擎 + 真实 db 端到端（含关系边落库、run 终态）。
// 由来：2026-10-18 用户实测——material_map_edges 的 INSERT 列数/占位符不符，凡含关系的任务整批回滚，
// 图上 0 条关系、run 记为 partial。内存 store 测试全绿却漏掉了它，所以 SQL 必须在真实 db 上跑。
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m15v2-realdb-"));
require("./lib/nodeSqliteShim.cjs").install({ userData: tmp });
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}

(async () => {
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  check("真实 db.js 在 node:sqlite 上 initDb 成功", true);

  console.log("---- ① store 契约（真实 SQL） ----");
  const { runStoreContract } = require(path.join(__dirname, "m15v2.store.contract.cjs"));
  try {
    const steps = runStoreContract(db, assert);
    check(`契约全部通过（${steps} 步）`, true);
  } catch (e) {
    check("契约全部通过", false, String(e && e.stack || e).slice(0, 600));
  }

  console.log("---- ② 关系边直写 ----");
  {
    const { mapId } = db.createMaterialMapV2({ documentId: "d-edge", title: "边", meta: { title: "边" }, skeleton: [
      { nodeId: "t0", parentId: null, ord: 0, title: "边", type: "其他", state: "open", source: "toc" },
      { nodeId: "t0.1", parentId: "t0", ord: 1000, title: "甲", type: "论点", state: "floor", source: "ai" },
      { nodeId: "t0.2", parentId: "t0", ord: 2000, title: "乙", type: "理由", state: "floor", source: "ai" },
    ] });
    let err = null;
    try { db.commitMaterialMapJob({ mapId, jobId: "j1", edges: [{ fromId: "t0.2", toId: "t0.1", code: "支" }] }); } catch (e) { err = String(e.message || e); }
    check("commitMaterialMapJob 写入关系边不抛错", !err, err);
    const es = db.listMaterialMapEdges(mapId);
    check("关系边读回", es.length === 1 && es[0].fromId === "t0.2" && es[0].toId === "t0.1" && es[0].code === "支" && es[0].jobId === "j1", es);
    db.commitMaterialMapJob({ mapId, jobId: "j2", edges: [{ fromId: "t0.2", toId: "t0.1", code: "支" }] });
    check("同 (from,to,code) 幂等", db.listMaterialMapEdges(mapId).length === 1);
  }

  console.log("---- ③ 引擎 + 真实 db 端到端 ----");
  {
    const { createMindmapEngineV2 } = require(path.join(ROOT, "electron", "mindmapEngineV2.js"));
    const changes = [];
    const chatStream = async (opts, send) => {
      const u = opts.messages[1].content;
      const m = /【原文块号】\[(\d+)\](?:–\[(\d+)\])?/.exec(u);
      const lo = Number(m[1]), hi = Number(m[2] || m[1]);
      const mid = Math.floor((lo + hi) / 2);
      const raw = `1 [论点] 前半 @${lo}-${mid} .\n2 [理由] 后半 @${mid + 1}-${hi} . &支1\n`;
      for (let i = 0; i < raw.length; i += 9) { send({ delta: raw.slice(i, i + 9) }); await new Promise((r) => setImmediate(r)); }
      return { usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: "stop", ttftMs: 1, firstByteMs: 1 };
    };
    const engine = createMindmapEngineV2({
      store: db, chatStream, readSettings: () => ({ app: {} }), getAIConfig: () => ({ model: "fake" }), getPromptTemplate: (s) => db.getPromptTemplate(s),
      broadcastChanged: (p) => changes.push(p), broadcastDelta: () => {},
    });
    const para = "知识是经过检验的信念，这个定义解释了记忆的机制，作者先提出问题再给出回答。".repeat(6);
    const text = (n) => Array.from({ length: n }, () => para).join("\n\n");
    const toc = [{ anchor: "a", label: "第一章" }, { anchor: "b", label: "第二章" }];
    engine.graphFeed({ documentId: "d-e2e", title: "端到端", tocItems: toc, unitAnchors: ["a", "b"], index: 0, text: text(6), last: false });
    engine.graphFeed({ documentId: "d-e2e", title: "端到端", tocItems: toc, unitAnchors: ["a", "b"], index: 1, text: text(5), last: true });
    const g = await engine.graphGenerate({ documentId: "d-e2e" });
    await engine.idle();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    const last = changes.filter((c) => c.runId === g.runId).pop();
    check("run 终态 completed（不再因边写入失败记 partial）", last && last.stage === "completed", last);
    const nodes = db.listMaterialMapNodes(g.mapId);
    const edges = db.listMaterialMapEdges(g.mapId);
    check("AI 节点落库", nodes.filter((n) => n.source === "ai").length === 4, nodes.length);
    check("每个作用域一条关系边落库", edges.length === 2 && edges.every((e) => e.code === "支"), edges);
    check("版本已激活", db.getMaterialMap(g.mapId).isActive);
    const calls = db.listMaterialMapCalls(g.runId);
    check("账本两行、新列读回", calls.length === 2 && calls.every((c) => c.model === "fake" && c.trigger === "auto" && c.lines === 2), calls[0]);
    const ld = engine.graphLoad({ documentId: "d-e2e" });
    check("graphLoad 读回节点与边", ld.nodes.length === nodes.length && ld.edges.length === 2);
  }

  try { db.closeDb && db.closeDb(); } catch { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
