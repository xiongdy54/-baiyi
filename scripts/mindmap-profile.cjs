#!/usr/bin/env node
/**
 * m15 材料知识导图 · 性能采样器（只读）
 *
 * 用途：在真实运行库上做性能与账本审计，输出①运行总表 ②调用会话聚类 ③逐次调用耗时
 *      ④按 run_kind 的 token/规模分布 ⑤分片内容里的分支结构统计 ⑥单次 Run 审计总账。
 * 纪律：**全程只读**——以 fs.readFileSync 载入 sql.js 内存库，绝不 persist()，绝不写文件、绝不改库。
 *
 * 用法：
 *   node scripts/mindmap-profile.cjs                 # 默认库 + 分片最多的文档
 *   node scripts/mindmap-profile.cjs --doc <id>      # 指定文档
 *   node scripts/mindmap-profile.cjs --db <path>     # 指定数据库文件
 *   node scripts/mindmap-profile.cjs --full          # 打印逐次调用全表（默认只打统计）
 *
 * 依据：docs/m15-v48.10-性能审计.md 的口径——分片表是「每次成功调用一条」的调用记录，
 *      run 行的 calls_done 只在作业边界写库，被中断时尾部调用会丢失，故两者都要看。
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = "incremental-reading-dev";

// ---------- 参数 ----------

function parseArgs(argv) {
  const out = { db: null, doc: null, full: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--doc") out.doc = argv[++i];
    else if (a === "--full") out.full = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function defaultDbPath() {
  const base =
    process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_DIR)
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", APP_DIR)
        : path.join(os.homedir(), ".config", APP_DIR);
  return path.join(base, "library.db");
}

function loadSqlJs() {
  const candidates = [path.join(REPO_ROOT, "node_modules", "sql.js"), "sql.js"];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* 尝试下一个 */
    }
  }
  throw new Error("未找到 sql.js（应先 npm install，或在本仓库根目录下运行本脚本）");
}

let core = null;
function loadCore() {
  if (core !== null) return core;
  try {
    core = require(path.join(REPO_ROOT, "electron", "mindmapCore.js"));
  } catch {
    core = undefined; // 缺 core 时降级为本地简化统计
  }
  return core;
}

// ---------- 小工具 ----------

const fmtTs = (ms) => (ms ? new Date(ms).toLocaleString("sv-SE") : "-");
const fmtClock = (ms) => (ms ? new Date(ms).toLocaleTimeString("sv-SE") : "-");
const hms = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};
const num = (v) => (v == null ? "-" : Number(v).toLocaleString("zh-CN"));

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
const minOf = (a) => (a.length ? Math.min(...a) : null);
const maxOf = (a) => (a.length ? Math.max(...a) : null);

function table(rows, headers) {
  if (!rows.length) return;
  const w = headers.map((h, i) => Math.max(strWidth(h), ...rows.map((r) => strWidth(String(r[i] ?? "")))));
  const line = (cells) => cells.map((c, i) => pad(String(c ?? ""), w[i])).join(" │ ");
  console.log(line(headers));
  console.log(w.map((x) => "─".repeat(x)).join("─┼─"));
  for (const r of rows) console.log(line(r));
}
// CJK 宽度粗略处理（只为对齐好看，不参与任何计算）
function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6b\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}
function pad(s, w) {
  const diff = w - strWidth(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

// ---------- 数据访问（只读） ----------

function query(db, sql, params) {
  const st = db.prepare(sql);
  if (params) st.bind(params);
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- 各段报告 ----------

function reportRuns(runs) {
  console.log("\n=== ① 运行总表（material_map_runs）===");
  table(
    runs.map((r) => [
      String(r.id).slice(0, 8),
      String(r.document_id).slice(0, 8),
      r.status,
      r.stage || "-",
      num(r.calls_planned),
      num(r.calls_done),
      num(r.chars),
      hms(r.updated_at - r.created_at),
      fmtTs(r.created_at),
    ]),
    ["run", "doc", "status", "stage", "计划", "完成", "chars", "墙钟", "开始"]
  );
  console.log("  注：calls_done 只在作业边界写库，被中断的尾部调用不会计入（见 ⑤ 账本缺口）。");
}

function reportClusters(shards) {
  console.log("\n=== ② 调用会话聚类（相邻分片间隔 > 5 分钟即切段；Δ 只统计段内，避免跨天间隔污染）===");
  const GAP = 5 * 60 * 1000;
  const clusters = [];
  let cur = null;
  for (const s of shards) {
    if (!cur || s.created_at - cur.end > GAP) {
      cur = { start: s.created_at, end: s.created_at, rows: [], deltas: [] };
      clusters.push(cur);
    } else {
      cur.deltas.push(s.created_at - cur.end); // 段内相邻分片的时间差 = 上一次调用的墙钟
    }
    cur.end = s.created_at;
    cur.rows.push(s);
  }
  table(
    clusters.map((c) => {
      const kinds = {};
      for (const r of c.rows) kinds[r.run_kind] = (kinds[r.run_kind] || 0) + 1;
      const callRows = c.rows.filter((r) => r.run_kind === "section" || r.run_kind === "expand" || r.run_kind === "gapfill");
      const chars = callRows.map((r) => r.chars).filter((x) => x != null);
      return [
        fmtTs(c.start),
        fmtClock(c.end),
        c.rows.length,
        Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(" "),
        hms(c.end - c.start),
        callRows.length ? hms(median(c.deltas)) : "-",
        callRows.length ? `${hms(minOf(c.deltas))}–${hms(maxOf(c.deltas))}` : "-",
        chars.length ? `${num(median(chars))}` : "-",
      ];
    }),
    ["开始", "结束", "分片数", "构成", "跨度", "间隔中位", "间隔范围", "chars中位"]
  );
  console.log("  读法：间隔中位 = 段内相邻分片落库时刻之差（≈ 上一次调用墙钟 + 本地开销）；");
  console.log("        chars 中位 只统计结构调用（section/expand/gapfill）。两者对照即可判断「耗时是否随输入规模变化」。");
  return clusters;
}

function reportTimeline(shards, opts, clusters) {
  const structural = shards.filter((s) => s.run_kind === "section" || s.run_kind === "expand" || s.run_kind === "gapfill");
  if (!structural.length) return;
  console.log("\n=== ③ 逐次调用（按落库时刻还原）===");
  const rows = [];
  for (const c of clusters || []) {
    let prev = null;
    for (const s of c.rows) {
      if (s.run_kind !== "section" && s.run_kind !== "expand" && s.run_kind !== "gapfill") continue;
      const d = prev == null ? null : s.created_at - prev;
      rows.push([
        fmtClock(s.created_at),
        s.run_kind,
        String(s.unit_anchor).slice(0, 20),
        num(s.chars),
        num(s.token_used),
        d == null ? "-" : (d / 1000).toFixed(1) + "s",
      ]);
      prev = s.created_at;
    }
  }
  if (opts.full) {
    table(rows, ["时刻", "类型", "锚", "chars", "token_used", "Δ"]);
  } else {
    console.log(`  （结构调用共 ${rows.length} 次；加 --full 打印逐次明细）`);
  }
  // 输入规模 vs 耗时：跨会话比较（段内 Δ，避免跨天间隔）
  const big = [];
  const small = [];
  for (const c of clusters || []) {
    let prev = null;
    for (const s of c.rows) {
      const isCall = s.run_kind === "section" || s.run_kind === "expand" || s.run_kind === "gapfill";
      if (!isCall) continue;
      if (prev != null) (s.chars > 20000 ? big : small).push(s.created_at - prev);
      prev = s.created_at;
    }
  }
  if (big.length && small.length) {
    console.log(
      `  输入规模 vs 耗时：超长输入 ${big.length} 次（chars>20000）Δ中位 ${hms(median(big))}；` +
        `常规输入 ${small.length} 次 Δ中位 ${hms(median(small))}` +
        `—— 两者接近即说明单次耗时由输出生成主导，与输入长度基本无关。`
    );
  }
}

function reportShardStats(shards) {
  console.log("\n=== ④ 分片统计（按 run_kind）===");
  const byKind = new Map();
  for (const s of shards) {
    if (!byKind.has(s.run_kind)) byKind.set(s.run_kind, []);
    byKind.get(s.run_kind).push(s);
  }
  const rows = [...byKind.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kind, list]) => {
      const chars = list.map((x) => x.chars || 0);
      const toks = list.map((x) => x.token_used || 0);
      return [
        kind,
        list.length,
        `${num(minOf(chars))}/${num(median(chars))}/${num(maxOf(chars))}`,
        `${num(minOf(toks))}/${num(median(toks))}/${num(maxOf(toks))}`,
        num(toks.reduce((a, b) => a + b, 0)),
      ];
    });
  table(rows, ["run_kind", "条数", "chars 小/中/大", "token 小/中/大", "token 合计"]);
  const zero = shards.filter((s) => !s.token_used).length;
  console.log(`  无 usage 的分片：${zero} / ${shards.length}（为 0 说明 provider 未回传 usage——需 include_usage）`);
}

function reportBranches(shards) {
  const rows = [];
  const stopReasons = new Map();
  for (const s of shards) {
    if (s.run_kind !== "section" && s.run_kind !== "expand") continue;
    const parsed = safeParseJson(s.content_json);
    const n0 = parsed && Array.isArray(parsed.nodes) ? parsed.nodes[0] : null;
    if (!n0) continue;
    const children = Array.isArray(n0.children) ? n0.children : [];
    const childExpandable = children.filter((c) => c && c.expandable === true).length;
    const key = String(n0.stopReason ?? (n0.stopReason === null ? "null" : "absent"));
    const bag = stopReasons.get(`${s.run_kind}:${key}`) || 0;
    stopReasons.set(`${s.run_kind}:${key}`, bag + 1);
    rows.push({
      kind: s.run_kind,
      anchor: s.unit_anchor,
      chars: s.chars,
      children: children.length,
      childExpandable,
      expandable: n0.expandable === true,
    });
  }
  if (!rows.length) return;
  console.log("\n=== ⑤ 分支结构（解析分片 content_json 的模型原始产出）===");
  for (const kind of ["expand", "section"]) {
    const list = rows.filter((r) => r.kind === kind);
    if (!list.length) continue;
    const kids = list.map((r) => r.children);
    const hist = new Map();
    for (const k of kids) hist.set(k, (hist.get(k) || 0) + 1);
    const expandableRate = ((list.filter((r) => r.expandable).length / list.length) * 100).toFixed(1);
    const childRate = (
      (list.reduce((a, r) => a + r.childExpandable, 0) / Math.max(1, list.reduce((a, r) => a + r.children, 0))) *
      100
    ).toFixed(1);
    console.log(
      `  ${kind}：${list.length} 次｜子节点 平均 ${(kids.reduce((a, b) => a + b, 0) / list.length).toFixed(2)}` +
        `（中位 ${median(kids)}，${minOf(kids)}–${maxOf(kids)}）｜本节点 expandable ${expandableRate}%` +
        `｜子节点中可继续展开 ${childRate}%｜零子节点 ${list.filter((r) => r.children === 0).length} 次`
    );
    console.log(`    子节点数分布：${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}→${v}`).join("  ")}`);
  }
  console.log(
    `  stopReason：${[...stopReasons.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  ") || "-"}`
  );
  console.log("  读法：expandable 比例越高、子节点越多，深挖队列增长越快（×分支 递推）。");
}

function reportLedger(db, runs, shards) {
  console.log("\n=== ⑥ 单次 Run 审计总账 ===");
  // 归属：先把分片按「同一文档、时间窗 ±60s」挂到 run；窗口重叠时取窗口更小者；挂不上的进缺口清单。
  const byRun = new Map(runs.map((r) => [r.id, []]));
  const unattributed = [];
  for (const s of shards) {
    const cands = runs.filter(
      (r) => r.document_id === s.document_id && s.created_at >= r.created_at - 60000 && s.created_at <= r.updated_at + 60000
    );
    if (!cands.length) {
      unattributed.push(s);
      continue;
    }
    cands.sort((a, b) => a.updated_at - a.created_at - (b.updated_at - b.created_at));
    byRun.get(cands[0].id).push(s);
  }
  const mapsByDoc = new Map();
  for (const m of query(db, "SELECT id, document_id, node_count, structure_json, created_at FROM material_maps WHERE is_deleted = 0")) {
    if (!mapsByDoc.has(m.document_id)) mapsByDoc.set(m.document_id, []);
    mapsByDoc.get(m.document_id).push(m);
  }
  const ledger = [];
  for (const r of runs) {
    const list = byRun.get(r.id) || [];
    const structural = list.filter((s) => s.run_kind === "section" || s.run_kind === "expand" || s.run_kind === "gapfill");
    const tok = list.reduce((a, s) => a + (s.token_used || 0), 0);
    const out = safeParseJson(r.output_json);
    const mapId = out && out.mapId ? out.mapId : null;
    const map = mapId ? query(db, "SELECT * FROM material_maps WHERE id = ?", [mapId])[0] : null;
    // 版本被真删（v48.5 批A：material_maps 真删、shards 保留缓存）时 map 取不到——按「已删除」标注，不要与「无图」混淆
    const mapCell = !mapId ? "-" : map ? num(map.node_count) : "已删除";
    let metrics = { nodeCount: "-", evidenceCoverage: "-", maxDepth: "-", duplicateNodeRate: "-", genericParentRate: "-" };
    if (map) {
      const structure = safeParseJson(map.structure_json);
      const c = loadCore();
      if (structure && c && typeof c.computeMapMetrics === "function") {
        const m = c.computeMapMetrics(structure);
        metrics = m;
      } else if (structure) {
        const nodes = structure.nodes || [];
        metrics = { nodeCount: nodes.length, evidenceCoverage: "-", maxDepth: "-", duplicateNodeRate: "-", genericParentRate: "-" };
      }
    }
    ledger.push([
      String(r.id).slice(0, 8),
      r.status,
      num(r.calls_planned),
      num(r.calls_done),
      num(structural.length),
      num(list.length),
      num(r.actual_prompt_tokens),
      num(r.actual_completion_tokens),
      num(tok),
      mapCell,
      metrics.nodeCount,
      metrics.evidenceCoverage,
      metrics.maxDepth,
      metrics.duplicateNodeRate,
      metrics.genericParentRate,
    ]);
  }
  table(ledger, [
    "run",
    "status",
    "计划",
    "calls_done",
    "窗口归属",
    "分片总数",
    "实际prompt",
    "实际compl",
    "分片token",
    "map节点",
    "指标节点",
    "证据覆盖",
    "最大深度",
    "重复率",
    "空盒率",
  ]);
  console.log(
    "  窗口归属 = 落在该 run 时间窗（±60s）内的分片数，是启发式归属，可能把续跑尾部算到前一轮——\n" +
      "  凡是「窗口归属 > calls_done」的行，差额就是该轮未被记账的调用。\n" +
      "  map节点 = 「已删除」表示该版本已被真删（v48.5 批A：material_maps 真删、shards 保留缓存），\n" +
      "  此时节点级质量指标不可从库中恢复，需用 golden fixture + 新运行重新测量。"
  );
  console.log(
    "  字段缺口（待 v48.11 遥测落地，现为不可得）：requestedCalls / cacheHits / retries / failed / cancelled /\n" +
      "  unknownOutcome / actualCost / coverageGapChars —— 这些必须由新的调用日志表提供。"
  );
  // 账本缺口
  const totalShards = shards.length;
  const sumDone = runs.reduce((a, r) => a + (r.calls_done || 0), 0);
  const sumStructural = shards.filter((s) => s.run_kind === "section" || s.run_kind === "expand").length;
  console.log("\n--- 账本缺口 ---");
  console.log(`  分片记录的结构调用（section+expand）：${sumStructural}`);
  console.log(`  run 行 calls_done 合计：${sumDone}   差额：${sumStructural - sumDone}`);
  console.log(`  完全挂不到任何 run 的分片：${unattributed.length}`);
  if (unattributed.length && unattributed.length <= 40) {
    table(
      unattributed.map((s) => [fmtTs(s.created_at), s.run_kind, String(s.unit_anchor).slice(0, 18), num(s.chars), num(s.token_used)]),
      ["时刻", "类型", "锚", "chars", "token"]
    );
  }
  console.log(`  全部文档分片总数：${totalShards}`);
}

// ---------- v48.12 三维指标（P0 测量面） ----------

function reportV4812(db, docId, runs, core) {
  console.log("\n=== ⑦ v48.12 指标（有效覆盖 / 单位成本 / 无意义与重复）===");
  if (!runs.length) return;
  const run = runs[runs.length - 1]; // 最近一次
  const calls = query(db, "SELECT * FROM material_map_calls WHERE run_id = ? ORDER BY created_at, rowid", [run.id]);
  const out = safeParseJson(run.output_json) || {};
  const mapId = out.mapId || null;
  const map = mapId ? query(db, "SELECT * FROM material_maps WHERE id = ?", [mapId])[0] : null;
  const structure = map ? safeParseJson(map.structure_json) : null;
  const nodes = (structure && structure.nodes) || [];
  const pct1 = (x) => (x * 100).toFixed(1) + "%";

  // 1) 覆盖三口径（优先读落库摘要）
  const cs = structure && structure.coverageSummary;
  if (cs) {
    console.log(
      `覆盖率：结构 ${pct1(cs.structureCoverage)} | 叶 ${pct1(cs.leafCoverage)} | 证据文本 ${pct1(cs.evidenceTextCoverage)} | 未归属 ${num(cs.unassignedChars)} 字 / 宇宙 ${num(cs.universeChars)} 字（${cs.linearizationVersion}）`
    );
  } else {
    console.log("覆盖率：structure.coverageSummary 缺失（该版本由 v48.12 之前的引擎生成）");
  }
  const withSpans = nodes.filter((n) => Array.isArray(n.sourceSpans) && n.sourceSpans.length).length;
  console.log(`节点：${nodes.length} | 落库含 sourceSpans 的节点：${withSpans}`);

  // 2) 零产出 expand 率（调用 → 分片内容的 children 数）
  const expCalls = calls.filter((c) => c.run_kind === "expand" && c.outcome === "completed");
  const shardByAnchor = new Map();
  const expShards = query(db, "SELECT unit_anchor, content_json FROM material_map_shards WHERE document_id = ? AND run_kind = 'expand'", [docId]);
  for (const sh of expShards) if (!shardByAnchor.has(sh.unit_anchor)) shardByAnchor.set(sh.unit_anchor, sh);
  let zero = 0;
  const childCounts = [];
  for (const c of expCalls) {
    const sh = shardByAnchor.get(c.node_anchor);
    let n = 0;
    if (sh && sh.content_json) {
      const content = safeParseJson(sh.content_json);
      const arr = content && Array.isArray(content.nodes) ? content.nodes : [content];
      n = ((arr[0] && arr[0].children) || []).length;
    }
    childCounts.push(n);
    if (n === 0) zero += 1;
  }
  if (expCalls.length) {
    console.log(`零产出深挖：${zero}/${expCalls.length} = ${((zero / expCalls.length) * 100).toFixed(0)}%（每节点子数：${childCounts.join(",")}）`);
  } else {
    console.log("零产出深挖：本次运行无 expand 调用");
  }

  // 3) 同 span 兄弟碰撞（用落库 sourceSpans，按父节点分组）
  const byParent = new Map();
  for (const n of nodes) {
    const k = n.parentId || "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  let groups = 0;
  let involved = 0;
  const detail = [];
  for (const [pid, kids] of byParent.entries()) {
    const byKey = new Map();
    for (const k of kids) {
      const spans = (k.sourceSpans || []).slice().sort((a, b) => a[0] - b[0]);
      const key = JSON.stringify(spans);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(k);
    }
    for (const [key, list] of byKey.entries()) {
      if (list.length > 1 && key !== "[]") {
        groups += 1;
        involved += list.length;
        detail.push(`父 ${pid} 上 ${list.length} 个节点共享 ${key.slice(0, 24)}`);
      }
    }
  }
  console.log(
    withSpans === 0
      ? "同 span 兄弟碰撞：无法判定（该版本未落库 sourceSpans；v48.12 起的运行可直接判定）"
      : `同 span 兄弟碰撞：${groups} 组 / 涉及 ${involved} 节点${detail.length ? "（" + detail.slice(0, 3).join("；") + "）" : ""}`
  );

  // 4) 结构质量（复用 core.computeMapMetrics）
  if (structure && core && typeof core.computeMapMetrics === "function") {
    const m = core.computeMapMetrics(structure);
    console.log(
      `结构质量：maxDepth ${m.maxDepth} | 分支因子 ${m.branchingFactor} | 重复标题率 ${m.duplicateNodeRate} | 空洞父率 ${m.genericParentRate} | 目录回声率 ${m.tocEchoRate} | 节点级证据覆盖率 ${m.evidenceCoverage}`
    );
  }

  // 5) 单位成本 + 账本（跨阶段合并后）
  const tokens = (Number(run.actual_prompt_tokens) || 0) + (Number(run.actual_completion_tokens) || 0);
  const wall = run.updated_at - run.created_at;
  const ledger = out.ledger || null;
  const reqs = ledger ? ledger.requestedCalls : calls.filter((c) => c.outcome && c.outcome !== "cache_hit").length;
  const succ = ledger ? (Number.isFinite(ledger.successfulCalls) ? ledger.successfulCalls : Object.values(ledger.byKind || {}).reduce((a, v) => a + (Number(v && v.calls) || 0), 0)) : null;
  console.log(
    `单位成本：${nodes.length ? num(Math.round(tokens / nodes.length)) : "-"} tok/节点 | ${nodes.length ? (wall / 1000 / nodes.length).toFixed(2) : "-"} s/节点 | 请求 ${reqs} 次 / 缓存命中 ${ledger ? ledger.cacheHits : "-"} / 重试 ${ledger ? ledger.retries : "-"} / 格式修复 ${ledger ? ledger.repairCalls : "-"} / 成功调用 ${succ == null ? "-" : succ}`
  );

  // 6) TTFT / 首字节
  const ttfts = calls.filter((c) => Number.isFinite(c.ttft_ms)).map((c) => c.ttft_ms);
  const firstBytes = calls.filter((c) => Number.isFinite(c.first_byte_ms)).map((c) => c.first_byte_ms);
  const walls = calls.filter((c) => Number.isFinite(c.wall_ms) && c.outcome === "completed").map((c) => c.wall_ms);
  if (ttfts.length) {
    console.log(
      `TTFT：n=${ttfts.length} 最小 ${hms(minOf(ttfts))} 中位 ${hms(median(ttfts))} 最大 ${hms(maxOf(ttfts))} | 单次墙钟中位 ${hms(median(walls))}`
    );
  } else {
    console.log("TTFT：无数据（该 run 由 v48.12 之前的引擎生成，或 provider 未回传内容流）");
  }
  if (firstBytes.length) console.log(`首字节：中位 ${hms(median(firstBytes))}（含握手/排队）`);

  // 7) depth/父节点 是否已落库（调用日志）
  const withDepth = calls.filter((c) => Number.isFinite(c.depth)).length;
  console.log(`调用日志：带 depth 的行 ${withDepth}/${calls.length} | 带 span_chars 的行 ${calls.filter((c) => Number.isFinite(c.span_chars)).length}`);
}

// ---------- 主流程 ----------

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log("用法：node scripts/mindmap-profile.cjs [--db <path>] [--doc <id>] [--full]");
    return;
  }
  const dbPath = opts.db || defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在：${dbPath}\n（可用 --db 指定；应用至少运行过一次才会生成）`);
    process.exitCode = 1;
    return;
  }
  const initSqlJs = loadSqlJs();
  const SQL = await initSqlJs();
  // 只读载入：把文件读进内存库，之后不再写回
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const runs = query(db, "SELECT * FROM material_map_runs WHERE is_deleted = 0 ORDER BY created_at");
  if (!runs.length) {
    console.log(`库中暂无导图运行记录：${dbPath}`);
    return;
  }
  const allShards = query(db, "SELECT * FROM material_map_shards WHERE is_deleted = 0 ORDER BY created_at");

  // 目标文档：默认分片最多者
  let docId = opts.doc;
  if (!docId) {
    const count = new Map();
    for (const s of allShards) count.set(s.document_id, (count.get(s.document_id) || 0) + 1);
    docId = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  const docRuns = runs.filter((r) => r.document_id === docId);
  const shards = allShards.filter((s) => s.document_id === docId);

  console.log(`数据库：${dbPath}`);
  console.log(`统计文档：${docId}（分片 ${shards.length} 条，运行 ${docRuns.length} 次）｜全库运行 ${runs.length} 次，分片 ${allShards.length} 条`);

  reportRuns(docRuns);
  const clusters = reportClusters(shards);
  reportTimeline(shards, opts, clusters);
  reportShardStats(shards);
  reportBranches(shards);
  reportLedger(db, docRuns, shards);
  reportV4812(db, docId, docRuns, loadCore());

  console.log("\n完成（全程只读，未对数据库写入任何内容）。");
}

main().catch((err) => {
  console.error("采样失败：", err && err.message ? err.message : err);
  process.exitCode = 1;
});
