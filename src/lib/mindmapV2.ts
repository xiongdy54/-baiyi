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
  onDelta?: (cb: (payload: MindmapDelta) => void) => () => void;
}

function bridge(): V2Bridge | undefined {
  return (window as unknown as { mindmapAPI?: V2Bridge }).mindmapAPI;
}

const NO_BRIDGE = (): never => {
  throw new Error("mindmapAPI unavailable");
};

export const mindmapV2Api = {
  load: (p: string | { documentId: string } | { mapId: string }): Promise<GraphLoadResult> =>
    bridge()?.graphLoad(p) ?? Promise.resolve({ meta: null, nodes: [], edges: [], view: null, textReady: false }),
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
