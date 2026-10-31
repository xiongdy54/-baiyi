// 材料导图 v2 · 渲染层类型化客户端（D192 / MINDMAP-V2-IMPL-PLAN §4.2、§5.3-7；T4）。
// window.mindmapAPI 的 graph* 薄包装（preload 暴露 12 个 invoke + onDelta）；DTO 类型复用
// src/lib/mindmap/v2/types.ts（不重复定义）；buildStructureCardPackageV2 为纯函数（node 可测）。
// 流式增量由 installMindmapBridge 转成 EventBus `mindmap/delta`，组件订阅该事件，不直接用 onDelta。

import type { Delta, GraphLoad, GraphState, RunMetrics, V2Edge, V2Node, V2NodeState, V2View } from "./mindmap/v2/types";

export type { Delta, GraphLoad, GraphState, RunMetrics, V2Edge, V2Node, V2NodeState, V2View };

/** graphLoad 返回：无图时 meta 为 null（nodes/edges 为空） */
export interface GraphLoadResult extends Omit<GraphLoad, "meta"> {
  meta: GraphLoad["meta"] | null;
  textReady: boolean;
}

/** mindmap:delta 的完整载荷（types.Delta 的超集：引擎扩展字段 removed / runDone / jobDone 细节） */
export interface MindmapDelta extends Delta {
  removed?: string[];
  runDone?: { stage: string; deleted?: boolean };
  jobDone?: { ok: boolean; error?: string; finishReason?: string; cached?: boolean; aborted?: boolean; skipped?: string; activated?: boolean };
}

export interface GraphFeedParams {
  documentId: string;
  title: string;
  tocItems: { anchor: string; label: string; children?: unknown[] }[];
  unitAnchors: string[];
  index: number;
  text: string;
  last: boolean;
}
export interface GraphFeedResult { blocksReady: number; scopesReady: number }

export interface GraphEstimate {
  scopes: number;
  chars: number;
  estPromptTokens: number;
  estCompletionTokens: number;
  model: string;
  concurrency: number;
  textReady: boolean;
  floorScopes: number;
}

export interface GraphRunRef { runId: string; mapId: string }
export type GraphExpandTrigger = "click" | "prefetch" | "all";
export type GraphExpandSkipped = "floor" | "cached" | "quota" | "busy" | "disabled" | "no_text";
export interface GraphExpandResult { jobId?: string; skipped?: GraphExpandSkipped; waiting?: boolean }
export type GraphExplainResult = { jobId: string; waiting?: boolean; cached?: undefined } | { cached: true; explain: string | null; jobId?: undefined };
export interface GraphNodeText { text: string | null; unitAnchor: string | null }

/** graphLocate：阅读位置 → 图谱节点（阅读透镜） */
export interface GraphLocate {
  ready: boolean;
  mapId?: string | null;
  nodeId?: string | null;
  /** 根 → 节点 */
  chain?: string[];
  block?: number;
  totalBlocks?: number;
  complete?: boolean;
  /** 所在目录节点（目录骨架 id，与图里 source='toc' 行同 id） */
  scopeNodeId?: string | null;
  scopeTitles?: string[];
  scopeFloor?: boolean;
  scopeOutlined?: boolean;
}

/** graphNodeAnchors：节点 → 正文强调锚（每单元一段：首尾原文探针） */
export interface NodeAnchor { unitAnchor: string; head: string; tail: string; blockStart: number; blockEnd: number }

interface V2Bridge {
  graphLoad: (p: string | { documentId: string } | { mapId: string }) => Promise<GraphLoadResult>;
  graphFeed: (p: GraphFeedParams) => Promise<GraphFeedResult>;
  graphEstimate: (p: { documentId: string }) => Promise<GraphEstimate>;
  graphGenerate: (p: { documentId: string; title?: string; force?: boolean }) => Promise<GraphRunRef>;
  graphExpand: (p: { mapId: string; nodeId: string; trigger: GraphExpandTrigger; force?: boolean }) => Promise<GraphExpandResult>;
  graphExpandAll: (p: { mapId: string }) => Promise<{ runId: string; queued: number }>;
  graphExplain: (p: { mapId: string; nodeId: string }) => Promise<GraphExplainResult>;
  graphCancel: (p: { jobId?: string; runId?: string; mapId?: string }) => Promise<boolean>;
  graphResume: (p: { runId: string }) => Promise<{ queued: number }>;
  graphSetView: (p: { mapId: string; view: V2View }) => Promise<boolean>;
  graphMetrics: (p: { mapId: string }) => Promise<RunMetrics>;
  graphNodeText: (p: { mapId: string; nodeId: string }) => Promise<GraphNodeText>;
  graphLocate?: (p: { documentId: string; unitAnchor: string; text: string; mapId?: string }) => Promise<GraphLocate>;
  graphEnsureMap?: (p: { documentId: string; title?: string }) => Promise<{ mapId: string; created: boolean }>;
  graphNodeAnchors?: (p: { mapId: string; nodeIds: string[] }) => Promise<{ anchors: Record<string, NodeAnchor[]> }>;
  onDelta?: (cb: (payload: MindmapDelta) => void) => () => void;
}

function bridge(): V2Bridge | undefined {
  return (window as unknown as { mindmapAPI?: V2Bridge }).mindmapAPI;
}

const NO_BRIDGE = (): never => {
  throw new Error("mindmapAPI unavailable");
};

// 结构全景（D254）首帧必须有图：load 结果缓存 + peekLoad（同步读，不发起 IPC）
const loadCache = new Map<string, GraphLoadResult>();
export function peekLoad(arg: string | { documentId: string }): GraphLoadResult | null {
  return loadCache.get(typeof arg === "string" ? `map:${arg}` : String(arg.documentId)) ?? null;
}

export const mindmapV2Api = {
  load: (p: string | { documentId: string } | { mapId: string }): Promise<GraphLoadResult> => {
    const base = bridge()?.graphLoad(p) ?? Promise.resolve({ meta: null, nodes: [], edges: [], view: null, textReady: false });
    return base.then((r) => {
      if (r?.meta?.mapId) {
        loadCache.set(`map:${r.meta.mapId}`, r);
        if (typeof p !== "string" && "documentId" in p) loadCache.set(String(p.documentId), r);
      }
      return r;
    });
  },
  feed: (p: GraphFeedParams): Promise<GraphFeedResult> => bridge()?.graphFeed(p) ?? Promise.resolve({ blocksReady: 0, scopesReady: 0 }),
  estimate: (documentId: string): Promise<GraphEstimate> => bridge()?.graphEstimate({ documentId }) ?? NO_BRIDGE(),
  generate: (p: { documentId: string; title?: string; force?: boolean }): Promise<GraphRunRef> => bridge()?.graphGenerate(p) ?? NO_BRIDGE(),
  expand: (p: { mapId: string; nodeId: string; trigger: GraphExpandTrigger; force?: boolean }): Promise<GraphExpandResult> =>
    bridge()?.graphExpand(p) ?? Promise.resolve({ skipped: "disabled" as const }),
  expandAll: (mapId: string): Promise<{ runId: string; queued: number }> => bridge()?.graphExpandAll({ mapId }) ?? NO_BRIDGE(),
  explain: (mapId: string, nodeId: string): Promise<GraphExplainResult> => bridge()?.graphExplain({ mapId, nodeId }) ?? NO_BRIDGE(),
  cancel: (p: { jobId?: string; runId?: string; mapId?: string }): Promise<boolean> => bridge()?.graphCancel(p) ?? Promise.resolve(false),
  resume: (runId: string): Promise<{ queued: number }> => bridge()?.graphResume({ runId }) ?? Promise.resolve({ queued: 0 }),
  setView: (mapId: string, view: V2View): Promise<boolean> => bridge()?.graphSetView({ mapId, view }) ?? Promise.resolve(false),
  metrics: (mapId: string): Promise<RunMetrics | null> => bridge()?.graphMetrics({ mapId }) ?? Promise.resolve(null),
  nodeText: (mapId: string, nodeId: string): Promise<GraphNodeText> =>
    bridge()?.graphNodeText({ mapId, nodeId }) ?? Promise.resolve({ text: null, unitAnchor: null }),
  locate: (p: { documentId: string; unitAnchor: string; text: string; mapId?: string }): Promise<GraphLocate> =>
    bridge()?.graphLocate?.(p) ?? Promise.resolve({ ready: false }),
  ensureMap: (documentId: string, title?: string): Promise<{ mapId: string; created: boolean }> =>
    bridge()?.graphEnsureMap?.({ documentId, title }) ?? NO_BRIDGE(),
  nodeAnchors: (mapId: string, nodeIds: string[]): Promise<{ anchors: Record<string, NodeAnchor[]> }> =>
    bridge()?.graphNodeAnchors?.({ mapId, nodeIds }) ?? Promise.resolve({ anchors: {} }),
  /** 直连订阅（一般用 EventBus `mindmap/delta`；本方法供不经 EventBus 的场景） */
  onDelta: (cb: (payload: MindmapDelta) => void): (() => void) => bridge()?.onDelta?.(cb) ?? (() => {}),
};

// ---------- 结构语义包（§5.3-7） ----------

/** 与 electron/mindmapV2Core.js 的 TYPE_TO_V1_ROLE 同表（v2 类型 → v1 authorialRole；「其他」→ null） */
export const TYPE_TO_V1_ROLE: Readonly<Record<string, string | null>> = Object.freeze({
  论点: "claim_evidence", 理由: "claim_evidence", 证据: "claim_evidence", 例证: "example", 反方观点: "critique",
  反驳: "critique", 让步: "contrast", 结论: "synthesis", 命题: "claim_evidence", 前提: "claim_evidence",
  定义: "introduce", 引理: "claim_evidence", 推导: "sequence", 分情形: "decompose", 引言: "introduce",
  背景: "introduce", 问题: "question_answer", 方案: "problem_solution", 分类: "decompose", 对比: "contrast",
  因果: "cause_effect", 步骤: "sequence", 总结: "summary", 叙事: "sequence", 案例: "example", 其他: null,
});

export function typeToV1Role(type: string): string | null {
  return Object.prototype.hasOwnProperty.call(TYPE_TO_V1_ROLE, type) ? TYPE_TO_V1_ROLE[type] : null;
}

export interface StructureCardPackageV2 {
  /** 与 v1 buildStructureCardPackage 同形：`【结构语义包】\n<JSON>`，≤ maxChars，不携带章节原文长文 */
  text: string;
  /** "v2:" + mapId + ":" + nodeId（learningStatus 同 id） */
  mindmapNodeId: string;
  unitAnchors: string[];
  authorialRole: string | null;
}

export interface StructureCardPackageV2Opts {
  /** 缺省取 graph.mapId */
  mapId?: string;
  /** graphNodeText 取回的区间原文；证据从中截取（缺则无证据） */
  nodeText?: string | null;
  /** 块 unit 推出的锚点；缺则用 graphNodeText 的 unitAnchor（调用方传入 [unitAnchor]） */
  unitAnchors?: string[];
  maxChars?: number;
}

const EVIDENCE_MAX_SNIPPETS = 3;
const EVIDENCE_MAX_CHARS = 60;

function snippetsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const part of String(text).split(/\n+/)) {
    const s = part.replace(/\s+/g, " ").trim();
    if (!s) continue;
    out.push([...s].slice(0, EVIDENCE_MAX_CHARS).join(""));
    if (out.length >= EVIDENCE_MAX_SNIPPETS) break;
  }
  return out;
}

export function buildStructureCardPackageV2(node: V2Node, graph: GraphState, opts: StructureCardPackageV2Opts = {}): StructureCardPackageV2 {
  const maxChars = opts.maxChars ?? 1200;
  const mapId = opts.mapId ?? graph.mapId ?? "";
  const brief = (n: V2Node) => ({ title: n.title, type: n.type, authorialRole: typeToV1Role(n.type) });
  const chain: ReturnType<typeof brief>[] = [];
  const guard = new Set<string>([node.id]);
  let cur: V2Node | undefined = node.parentId ? graph.nodes[node.parentId] : undefined;
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(brief(cur));
    cur = cur.parentId ? graph.nodes[cur.parentId] : undefined;
  }
  const kids = (graph.children[node.id] || [])
    .map((id) => graph.nodes[id])
    .filter((k): k is V2Node => Boolean(k) && k.source !== "local")
    .map(brief);
  const explain = graph.explain[node.id] ?? node.explain ?? null;
  const unitAnchors = [...(opts.unitAnchors || [])];
  const mindmapNodeId = `v2:${mapId}:${node.id}`;
  const authorialRole = typeToV1Role(node.type);
  const pkg: Record<string, unknown> = {
    本节点: {
      title: node.title,
      type: node.type,
      authorialRole,
      作者动作: explain || null,
      mindmapNodeId,
      unitAnchors,
    },
    父链: chain,
    直接子结构: kids,
    证据引文: snippetsOf(opts.nodeText),
    材料级结构摘要: graph.meta?.title || "",
  };
  const render = () => `【结构语义包】\n${JSON.stringify(pkg, null, 1)}`;
  let text = render();
  if (text.length > maxChars) {
    // 有界优先砍：摘要 → 证据条数 → 子结构 → 作者动作长度；绝不回退去塞原文
    pkg.材料级结构摘要 = String(pkg.材料级结构摘要).slice(0, 120);
    pkg.证据引文 = (pkg.证据引文 as string[]).slice(0, 2);
    text = render();
  }
  if (text.length > maxChars) {
    pkg.直接子结构 = (pkg.直接子结构 as unknown[]).slice(0, 8);
    pkg.父链 = (pkg.父链 as unknown[]).slice(-4);
    pkg.证据引文 = [];
    text = render();
  }
  if (text.length > maxChars) {
    const me = pkg.本节点 as Record<string, unknown>;
    if (typeof me.作者动作 === "string") me.作者动作 = me.作者动作.slice(0, 300);
    pkg.直接子结构 = (pkg.直接子结构 as unknown[]).slice(0, 4);
    text = render();
  }
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return { text, mindmapNodeId, unitAnchors, authorialRole };
}

// ---------- 画布适配：材料根抬升（T8） ----------
// 主进程骨架 / v1 适配都有唯一的材料根行（parentId=null，标题＝材料名）；画布已有合成根卡（ROOT_ID，
// 标题取 meta.title），直接合入会出现「材料名 → 材料名」两层。渲染层统一把材料根行抬掉：
// 其子节点 parentId 改为 null（挂合成根），根行本身不进 GraphState；与根相连的关系、根的状态一并略去。
// 点击合成根卡时，调用方用返回的 rootId 映射回真实节点（详情 / 讲解 / 跳正文）。

/** 材料根行 id：parentId 为 null 的第一行（按 ord、id 稳定） */
export function findRootId(nodes: readonly V2Node[]): string | null {
  let best: V2Node | null = null;
  for (const n of nodes) {
    if (n.parentId != null) continue;
    if (!best || n.ord < best.ord || (n.ord === best.ord && n.id < best.id)) best = n;
  }
  return best ? best.id : null;
}

export function liftNodes(nodes: readonly V2Node[] | undefined, rootId: string | null): V2Node[] | undefined {
  if (!nodes) return undefined;
  if (!rootId) return nodes.slice();
  const out: V2Node[] = [];
  for (const n of nodes) {
    if (n.id === rootId) continue;
    out.push(n.parentId === rootId ? { ...n, parentId: null } : n);
  }
  return out;
}

export function liftDelta(d: MindmapDelta, rootId: string | null): MindmapDelta {
  if (!rootId) return d;
  return {
    ...d,
    nodes: liftNodes(d.nodes, rootId),
    states: d.states ? d.states.filter((s) => s.id !== rootId) : undefined,
    edges: d.edges ? d.edges.filter((e) => e.from !== rootId && e.to !== rootId) : undefined,
    removed: d.removed ? d.removed.filter((id) => id !== rootId) : undefined,
  };
}

/** graphLoad 结果 → 画布可用（根已抬升）；无图返回 null */
export function liftLoad(load: GraphLoadResult): { load: GraphLoad; rootId: string | null; rootNode: V2Node | null } | null {
  if (!load || !load.meta) return null;
  const rootId = findRootId(load.nodes);
  const rootNode = rootId ? load.nodes.find((n) => n.id === rootId) ?? null : null;
  return {
    load: {
      meta: load.meta,
      nodes: liftNodes(load.nodes, rootId) ?? [],
      edges: load.edges.filter((e) => e.from !== rootId && e.to !== rootId),
      view: load.view,
      textReady: load.textReady,
    },
    rootId,
    rootNode,
  };
}

/** 目录骨架预览（无图时 ≤300ms 本地画出，零调用）：目录树 → 只读 V2Node（id 前缀 `p`，state 'more'） */
export interface TocLike {
  anchor: string;
  label: string;
  children?: TocLike[];
}
export function tocPreviewNodes(toc: readonly TocLike[]): V2Node[] {
  const out: V2Node[] = [];
  let seq = 0;
  const walk = (list: readonly TocLike[], parentId: string | null) => {
    for (const t of list || []) {
      const id = `p${seq}`;
      out.push({
        id, parentId, ord: seq * 1000, title: String(t.label || "").trim() || "—", type: "其他", timeText: null, patternHint: null,
        blockStart: null, blockEnd: null, spans: null, state: "more", source: "toc", warnings: null, explain: null, jobId: null,
      });
      seq++;
      if (t.children && t.children.length) walk(t.children, id);
    }
  };
  walk(toc, null);
  return out;
}

// ---------- 诊断读数（2026-10-18 起界面不再显示读数条——用户：图谱空间紧张、这不是用户该关心的；
// 读数仍写入 material_map_runs.output_json.metrics 供调参；本组函数保留作诊断文本格式，字段与 RunMetrics 一一对应） ----------

export type TFn = (key: string, params?: Record<string, string | number>) => string;

/** RunMetrics 全部字段（顺序即复制文本顺序）；tests/m15v2.cardpkg.test.cjs 守护与引擎 RunMetrics 键集一致 */
export const METRICS_FIELDS = [
  "model", "startedAt", "ttfnMs", "firstTtftMs", "frameworkMs", "calls", "cacheHits", "promptTokens", "completionTokens",
  "reasoningChars", "lines", "linesDropped", "byReason", "relsDropped", "concurrencyNow", "rateLimitDowngrades",
] as const satisfies readonly (keyof RunMetrics)[];

export const DROP_REASON_LABEL: Readonly<Record<string, string>> = {
  unparsable: "无法解析", orphan: "无父节点", out_of_scope: "越界", duplicate: "重复", truncated: "截断",
};

export interface MetricsSegment {
  /** 本段展示的 RunMetrics 字段 */
  fields: (keyof RunMetrics)[];
  text: string;
}

const secs = (ms: number | null | undefined): string => (ms == null || !Number.isFinite(ms) ? "—" : `${(ms / 1000).toFixed(1)}s`);

export function metricsSegments(m: RunMetrics, T: TFn): MetricsSegment[] {
  const reasons = Object.keys(m.byReason || {})
    .filter((k) => (m.byReason[k] || 0) > 0)
    .sort()
    .map((k) => `${T(DROP_REASON_LABEL[k] || k)} ${m.byReason[k]}`)
    .join(" / ");
  return [
    { fields: ["model"], text: m.model || T("（跟随全局）") },
    { fields: ["ttfnMs"], text: T("首节点 {s}", { s: secs(m.ttfnMs) }) },
    { fields: ["firstTtftMs"], text: T("首字 {s}", { s: secs(m.firstTtftMs) }) },
    { fields: ["frameworkMs"], text: T("框架完成 {s}", { s: secs(m.frameworkMs) }) },
    { fields: ["calls", "cacheHits"], text: T("调用 {n}（缓存 {m}）", { n: m.calls, m: m.cacheHits }) },
    { fields: ["promptTokens", "completionTokens"], text: T("token 入 {a} / 出 {b}", { a: m.promptTokens, b: m.completionTokens }) },
    { fields: ["reasoningChars"], text: T("思考 {n} 字", { n: m.reasoningChars }) },
    {
      fields: ["lines", "linesDropped", "byReason"],
      text: T("丢弃行 {a}/{b}", { a: m.linesDropped, b: m.lines }) + (reasons ? `（${reasons}）` : ""),
    },
    { fields: ["relsDropped"], text: T("关系丢弃 {n}", { n: m.relsDropped }) },
    { fields: ["concurrencyNow", "rateLimitDowngrades"], text: T("并发 {c}（降档 {d}）", { c: m.concurrencyNow, d: m.rateLimitDowngrades }) },
  ];
}

/** 「复制读数」：多行纯文本（含开始时间），供用户贴回调参 */
export function metricsCopyText(m: RunMetrics, T: TFn): string {
  const lines = [T("材料导图实测读数")];
  lines.push(`${T("开始时间")}: ${Number.isFinite(m.startedAt) ? new Date(m.startedAt).toISOString() : "—"}`);
  for (const s of metricsSegments(m, T)) lines.push(s.text);
  return lines.join("\n");
}
