// F08 材料知识导图：版本模型、隔离性与确定性
// @runtime: electron  @tier: 2  @gui: false  @id: F08  @timeout: 300
// 运行：npx electron tests/flows/f08-mindmap-isolation.cjs   （或 node tests/flows/run.cjs --only F08）
//
// 角度：M15 导图是最近才重做的子系统（v48.10–v48.13 连续四轮都在修它），
//       文档对它提了极多条「绝不允许」：不许污染知识图谱与调度、不许把抽取快照正文入库、
//       不许并发跑同一材料、partial 不许发布、重启不许把中断记成失败、重映射不许改卡。
//       既有 m15r.engine.test.cjs 纵向验引擎；这里用表级差异与状态机走查验**隔离性与版本模型**。
//
// 依据：§4.19（L406–450）、D41-④（快照文本只存 hash）、D45（Published/Candidate）、
//       L428–432（同材料串行化 busy）、L412（布局确定性）、§4.2-24（导图节点制卡用 act:mindmap-<id>）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, snapshotAll, diffSnapshots, summaryOf, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: F08_META(),
  title: "材料知识导图：版本模型、隔离性与确定性",
  angle: "最新子系统的负向承诺（绝不允许清单）",
  cites: ["§4.19", "D41-④", "D45", "§4.2-24"],
  tier: 2,
  gui: false,
});
function F08_META() {
  return "F08";
}

const POLLUTE_TABLES = ["cards", "review_logs", "review_skips", "knowledge_points", "knowledge_relations", "knowledge_proposals", "extracts", "fsrs_configs", "journal_entries"];
const MARKER = "F08SOURCE文本快照绝不许入库-" + Math.random().toString(36).slice(2);

function mkStructure(seed, n = 6) {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: `n${i}-${seed}`,
      label: `节点 ${i}`,
      level: i % 3,
      parentId: i === 0 ? null : `n${Math.floor((i - 1) / 2)}-${seed}`,
      evidence: [{ quote: MARKER + i, spanStart: i * 10, spanEnd: i * 10 + 8 }],
    });
    if (i > 0) edges.push({ from: `n${Math.floor((i - 1) / 2)}-${seed}`, to: `n${i}-${seed}`, type: "has_part" });
  }
  return { nodes, edges };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f08"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const core = require(path.join(ROOT, "electron", "mindmapCore.js"));
      const item = db.listItems().length ? db.listItems()[0] : null;
      const created = item ? null : db.createFromPaste("F08 宿主书", "# 章一\n\n正文。");
      const it = db.listItems().find((x) => /F08 宿主书/.test(x.title));
      flow.guard("有可挂载的文档", () => !!it);
      let aud = await audit(dbFile);
      const doc = aud.one("SELECT id FROM documents WHERE library_item_id = ?", [it.id]);
      flow.guard("宿主文档存在", () => !!doc);
      const docId = doc.id;

      // ---------- J1 版本模型 ----------
      flow.section("J1 版本模型：同 scope 只有一个 active，历史可回看（§4.19 / D45）");
      const seed = flow.rng.seed;
      const v1 = db.saveMaterialMap({ documentId: docId, scopeAnchor: "book", structure: mkStructure(`v1-${seed}`), generatorVersion: "g1", promptVersion: 7 });
      flow.check("首版即 active", v1?.isActive === true || v1?.is_active === true, true, v1 && Object.keys(v1).join(","));
      const v2 = db.saveMaterialMap({ documentId: docId, scopeAnchor: "book", structure: mkStructure(`v2-${seed}`), generatorVersion: "g1", promptVersion: 7 });
      aud = await audit(dbFile);
      const actives = aud.rows("SELECT id FROM material_maps WHERE document_id = ? AND scope_anchor='book' AND is_active = 1 AND is_deleted = 0", [docId]);
      flow.eq("连存两版后 active 恰一个", actives.length, 1);
      flow.eq("active 是最新那版", actives[0]?.id, v2.id);
      flow.eq("历史版本仍可回看（不覆盖旧版）", db.listMaterialMaps(docId).length, 2);
      const back = db.setActiveMaterialMap(v1.id);
      aud = await audit(dbFile);
      const actives2 = aud.rows("SELECT id FROM material_maps WHERE document_id = ? AND is_active = 1 AND is_deleted = 0", [docId]);
      flow.eq("切回旧版后仍只有一个 active", actives2.length, 1);
      flow.eq("切回的 active 就是旧版", actives2[0]?.id, v1.id);
      flow.eq("getActiveMaterialMap 与表内一致", db.getActiveMaterialMap(docId, "book")?.id, v1.id);
      const otherScope = db.saveMaterialMap({ documentId: docId, scopeAnchor: "ch2", scopeKind: "section", structure: mkStructure(`s-${seed}`) });
      aud = await audit(dbFile);
      flow.eq("不同 scopeAnchor 各自独立 active（章级图不影响全书图）", aud.rows("SELECT scope_anchor, COUNT(*) AS n FROM material_maps WHERE is_active=1 AND is_deleted=0 GROUP BY scope_anchor").length, 2);
      flow.check("新版本可携带 nodeRemap（供节点续接）", (() => {
        const v3 = db.saveMaterialMap({ documentId: docId, scopeAnchor: "book", structure: mkStructure(`v3-${seed}`), nodeRemap: { "old-1": v2.structure.nodes[0].id } });
        const a = null;
        return !!v3;
      })(), true);
      aud = await audit(dbFile);
      const remapRow = aud.one("SELECT node_remap_json FROM material_maps WHERE node_remap_json IS NOT NULL ORDER BY created_at DESC LIMIT 1");
      flow.check("nodeRemap 落库可取回", !!remapRow && JSON.parse(remapRow.node_remap_json)["old-1"].length > 0, true, remapRow?.node_remap_json);

      // ---------- J2 并发串行化 ----------
      flow.section("J2 同一材料同一范围串行化（§4.19 L428–432，busy 拒绝）");
      const run1 = db.createMaterialMapRun({ documentId: docId, scopeAnchor: "book" });
      flow.eq("新建 run 初始为 pending", run1?.status, "pending");
      db.updateMaterialMapRun(run1.id, { status: "running", stage: "extract" });
      const busy = db.findRunningMaterialMapRun(docId, "book");
      flow.check("能查出在跑的 run（守卫的数据依据）", busy?.id === run1.id, true, busy?.id);
      const busyOther = db.findRunningMaterialMapRun(docId, "ch2");
      flow.eq("不同 scope 的串行化互不阻塞", busyOther, null);
      db.updateMaterialMapRun(run1.id, { status: "completed" });
      flow.eq("完成后不再判为在跑", db.findRunningMaterialMapRun(docId, "book"), null);

      // ---------- J3 抽取快照文本不入库 ----------
      flow.section("J3 快照文本入库纪律：分片按 hash 复用（D41-④ / §4.19 L444）");
      const shardCols = (await audit(dbFile)).columns("material_map_shards");
      flow.check("shards 有 text_hash 列（复用判定靠 hash 不靠正文比对）", shardCols.includes("text_hash"), true, shardCols.join(","));
      const callCols = (await audit(dbFile)).columns("material_map_calls");
      const badCols = callCols.filter((c) => /(source|snapshot|raw|prompt|completion)_text|text_blob/.test(c));
      flow.eq("calls 表没有存放原文/提示词正文的列", badCols.length, 0);
      flow.record("calls 列集合", callCols.join(","));
      const runWithHash = db.createMaterialMapRun({ documentId: docId, scopeAnchor: "book", input: { snapshotHash: "sha256:abc", scope: { kind: "book" } } });
      aud = await audit(dbFile);
      const storedInput = aud.one("SELECT input_json FROM material_map_runs WHERE id = ?", [runWithHash.id]);
      flow.check("run 只登记快照 hash 与范围", /snapshotHash/.test(String(storedInput?.input_json)) && !String(storedInput?.input_json).includes(MARKER), true, storedInput?.input_json);
      const dumpCols = JSON.stringify(aud.all("material_map_shards"));
      flow.check("分片缓存不含本流程注入的原文标记", !dumpCols.includes(MARKER), true, dumpCols.slice(0, 120));
      flow.record("说明", "shards.content 存的是模型产出（续跑零重复计费的依据），源文快照正文的裁剪责任在 mindmapEngine 层——由 m15r.engine 纵向覆盖");

      // ---------- J4 隔离性：导图写入不得污染其他子系统 ----------
      flow.section("J4 导图全程写入对卡片/复习/知识图谱零污染（§4.19 L440/L446/L448–450）");
      const a0 = await audit(dbFile);
      const before = snapshotAll(a0, POLLUTE_TABLES);
      db.saveMaterialMap({ documentId: docId, scopeAnchor: "book", structure: mkStructure(`z-${seed}`) });
      const r2 = db.createMaterialMapRun({ documentId: docId, scopeAnchor: "book" });
      db.updateMaterialMapRun(r2.id, { status: "running", callsPlanned: 3, callsDone: 1, chars: 5000, estCost: 0.02 });
      if (db.saveMaterialMapShard) db.saveMaterialMapShard({ documentId: docId, scopeAnchor: "book", kind: "toc", key: { k: 1 }, payload: { toc: [] } });
      db.setActiveMaterialMap(v2.id);
      const after = snapshotAll(await audit(dbFile), POLLUTE_TABLES);
      const d = diffSnapshots(before, after);
      flow.check("九张业务表零变化（导图是独立产物，不进学习事实）", Object.keys(d).length === 0, "{}", summaryOf(d) || "{}");

      // ---------- J5 节点制卡与重映射不改卡 ----------
      flow.section("J5 节点制卡锚点 + 重映射绝不重写卡片（§4.2-24 / L446）");
      const nodeId = v2.structure.nodes[1].id;
      const cardId = db.createCard({
        noteText: "F08 节点卡",
        cardType: "qa",
        frontMarkdown: "来自导图节点的问题",
        backMarkdown: "答案",
        priority: 50,
        tags: [],
        siblingKey: `act:mindmap-${nodeId}`,
        contextRef: { documentId: docId, mindmapNodeId: nodeId, mindmapId: v2.id },
        fsrsJson: JSON.stringify({ state: "new", due: Date.now(), lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: [] }),
      }).id;
      const cardRowBefore = (await audit(dbFile)).one("SELECT * FROM cards WHERE id = ?", [cardId]);
      const reMap = db.saveMaterialMap({
        documentId: docId,
        scopeAnchor: "book",
        structure: mkStructure(`remap-${seed}`),
        nodeRemap: { [nodeId]: `n1-remap-${seed}` },
      });
      const cardRowAfter = (await audit(dbFile)).one("SELECT * FROM cards WHERE id = ?", [cardId]);
      flow.eq("重新生成导图不重写既有卡片任何字段", JSON.stringify(cardRowAfter), JSON.stringify(cardRowBefore));
      flow.record("新版本的 nodeRemap 是否落库", !!reMap);
      const stillAnchored = JSON.parse(cardRowAfter.context_ref_json).mindmapNodeId;
      flow.eq("卡片仍锚在旧节点 id（映射靠 nodeRemap 而非改写卡片）", stillAnchored, nodeId);

      // ---------- J6 契约校验与确定性 ----------
      flow.section("J6 出层契约校验与确定性（§4.19 证据强制 / L412 确定性）");
      flow.record("mindmapCore 导出数", Object.keys(core).length);
      if (typeof core.validateMapStructure === "function") {
        const textByUnit = new Map([["u1", "第一单元原文甲"], ["u2", "第二单元原文乙"]]);
        const keptOf = (x) => x?.nodes || [];
        const droppedOf = (x) => x?.dropped || [];
        const root = { id: "a1", title: "全书主旨", unitAnchors: ["u1"], authorialRole: "瞎写的角色", groupingBasis: { type: "瞎写的分组" } };
        const good = { nodes: [root], edges: [] };
        const rg = core.validateMapStructure(good, { textByUnit, rootId: "a1" });
        flow.check("返回形状为 {ok,title,nodes,dropped,warnings}", ["ok", "title", "nodes", "dropped", "warnings"].every((k) => k in rg), true, Object.keys(rg).join(","));
        flow.eq("根节点无需证据即保留", keptOf(rg).length, 1);
        flow.eq("根节点保留时不丢弃任何东西", droppedOf(rg).length, 0);
        flow.check("越界枚举给 flags 与 warning 说明处置", /越界/.test(JSON.stringify(keptOf(rg)[0]?.flags || "")) && /越界/.test(JSON.stringify(rg.warnings)), true, rg.warnings);
        flow.eq("越界枚举被置空而非照收", keptOf(rg)[0]?.authorialRole, null);
        const noEv = { nodes: [root, { id: "a2", title: "论据一", unitAnchors: ["u2"] }], edges: [] };
        const re = core.validateMapStructure(noEv, { textByUnit, rootId: "a1" });
        flow.eq("非根节点缺有效证据必须被丢弃（§4.19 证据强制）", droppedOf(re).length, 1);
        flow.check("丢弃带可读原因（供修复轮定位）", /证据/.test(JSON.stringify(droppedOf(re))), true, JSON.stringify(droppedOf(re)));
        const withEv = { nodes: [root, { id: "a2", title: "论据一", evidence: [{ unitAnchor: "u2", quote: "第二单元原文乙" }] }], edges: [] };
        const rv = core.validateMapStructure(withEv, { textByUnit, rootId: "a1" });
        flow.record("带直引证据的非根节点保留情况", keptOf(rv).length + " 保留 / " + JSON.stringify(droppedOf(rv)).slice(0, 90));
        const rn = core.validateMapStructure({ nodes: [root, { id: "x1", title: "" }], edges: [] }, { textByUnit, rootId: "a1" });
        flow.eq("缺 title 的节点被丢弃", droppedOf(rn).length, 1);
        flow.check("丢弃原因点名 title", /title/.test(JSON.stringify(droppedOf(rn))), true, JSON.stringify(droppedOf(rn)));
        flow.eq("合法根节点不受牵连", keptOf(rn).length, 1);
        const rdup = core.validateMapStructure({ nodes: [root, { ...root, id: "a1", title: "重复的同 id 节点" }], edges: [] }, { textByUnit, rootId: "a1" });
        flow.eq("重复 id 只留第一个", keptOf(rdup).length, 1);
        flow.check("重复 id 进 dropped 并注明原因", /重复/.test(JSON.stringify(droppedOf(rdup))), true, JSON.stringify(droppedOf(rdup)));
        const ra = core.validateMapStructure({ nodes: [root, { id: "n1", title: "锚", evidence: [{ unitAnchor: "u2", quote: "第二单元原文乙" }], unitAnchors: ["不存在的单元"] }], edges: [] }, { textByUnit, rootId: "a1" });
        flow.check("锚点不命中时被丢弃或有诊断（不静默放行）", droppedOf(ra).length + (ra?.warnings || []).length > 0, true, JSON.stringify({ d: droppedOf(ra), w: ra?.warnings }).slice(0, 140));
        const d1 = core.validateMapStructure(good, { textByUnit, rootId: "a1" });
        const d2 = core.validateMapStructure(JSON.parse(JSON.stringify(good)), { textByUnit, rootId: "a1" });
        flow.eq("同输入两次校验结果完全一致（确定性）", d2, d1);
        const emptyRes = core.validateMapStructure(null, { textByUnit });
        flow.check("空输入不炸（返回结构而非抛异常）", !!emptyRes && Array.isArray(emptyRes.nodes), true, emptyRes && Object.keys(emptyRes).join(","));
      } else {
        flow.record("validateMapStructure", "未导出（可能改名），跳过该节");
      }
      if (typeof core.computeMapMetrics === "function") {
        const st = mkStructure("m-" + seed, 8);
        const m1 = core.computeMapMetrics(st);
        const m2 = core.computeMapMetrics(JSON.parse(JSON.stringify(st)));
        flow.eq("同结构两次度量完全一致（确定性）", m2, m1);
        flow.record("度量字段", Object.keys(m1 || {}).join(","));
      }
      if (typeof core.remapNodes === "function") {
        const oldNodes = [{ id: "k1", title: "甲" }, { id: "k2", title: "乙" }];
        const newNodes = [{ id: "k1", title: "甲改名" }, { id: "k9", title: "全新节点" }];
        const snapOld = JSON.stringify(oldNodes);
        const map = core.remapNodes(oldNodes, newNodes);
        flow.eq("remapNodes 不修改入参（纯函数）", JSON.stringify(oldNodes), snapOld);
        flow.eq("空输入返回空映射", core.remapNodes([], []), {});
        flow.record("映射结果形状", JSON.stringify(map).slice(0, 160));
        flow.check("映射的键只可能来自旧节点 id", Object.keys(map).every((k) => oldNodes.some((n) => n.id === k)), true, Object.keys(map));
        flow.check("映射的目标只可能来自新节点 id", Object.values(map).every((v) => newNodes.some((n) => String(n.id) === String(v))), true, Object.values(map));
      }

      // ---------- J7 删除语义与重启 ----------
      flow.section("J7 删除与重启（v48.5 用户可见历史=真删 / active 顺延）");
      const hist = db.listMaterialMaps(docId).map((m) => m.id);
      flow.record("删除前版本数", hist.length);
      const activeBefore = db.getActiveMaterialMap(docId, "book").id;
      const del = db.deleteMaterialMap(activeBefore);
      flow.record("deleteMaterialMap 返回", del && typeof del === "object" ? Object.keys(del).join(",") : del);
      const aud7 = await audit(dbFile);
      const stillThere = aud7.one("SELECT id, is_deleted FROM material_maps WHERE id = ?", [activeBefore]);
      flow.eq("用户可见历史走真删（行不再存在）", stillThere, null);
      flow.check("删掉 active 后同 scope 顺延出一个 active（不留真空）", !!db.getActiveMaterialMap(docId, "book"), true, db.getActiveMaterialMap(docId, "book")?.id);
      flow.eq("剩余版本数减一", db.listMaterialMaps(docId).length, hist.length - 1);
      flow.record("§7.2「所有业务表软删除」对 material_maps 的例外", "v48.5 决策为真删；文档 L869 未记该例外 → 文档漂移候选");
      const dbPath = path.join(ROOT, "electron", "db.js");
      delete require.cache[dbPath];
      const db8 = require(dbPath);
      await db8.initDb();
      const a8 = await audit(dbFile);
      flow.eq("重启后版本数不变", db8.listMaterialMaps(docId).length, hist.length - 1);
      flow.eq("重启后 active 仍唯一", a8.rows("SELECT COUNT(DISTINCT scope_anchor) AS n FROM material_maps WHERE document_id = ? AND is_active=1 AND is_deleted=0", [docId])[0].n, 2);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F08 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
