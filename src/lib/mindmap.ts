// 材料知识导图——渲染层类型化客户端（v48 批3，M15，D41/D42 / §4.19）。
// 与 journal.ts/memory.ts 同构：window.mindmapAPI 薄包装 + 主进程推送桥接为 EventBus `mindmap/changed`。

import { eventBus } from "./eventbus";
import { t } from "./i18n";

export interface MapNodeRecord {
  id: string;
  parentId: string | null;
  title: string;
  authorialRole: string | null;
  centralQuestion?: string | null;
  mainMove?: string | null;
  progression?: string | null;
  relationToParent?: string | null;
  relationToSiblings?: string | null;
  groupingBasis?: { type: string; explanation: string; evidenceRefs?: string[] } | null;
  summary?: string | null;
  unitAnchors: string[];
  evidence: { id?: string; quote: string; unitAnchor?: string | null; matchStart?: number; matchEnd?: number; quoteHash?: string; positionAmbiguous?: boolean }[];
  compositionalEvidence?: string[];
  childIds: string[];
  flags?: string[];
  /** v48.12 P0 已落库：节点拥有的原文作用域（全文 UTF-16 一维坐标，多区间） */
  sourceSpans?: [number, number][] | null;
  spanOrigin?: string | null;
  /** 模型对本节点是否还有更深结构的判断（与 sourceSpans 一起决定「可深化」） */
  expandable?: boolean;
  stopReason?: string | null;
  residualChars?: number | null;
}

export interface MapStructure {
  version: number;
  generatorVersion: string;
  title: string;
  rootNodeId: string;
  nodes: MapNodeRecord[];
  edges: unknown[];
  /** 引擎落库时派生的有界结构摘要（≤1200 字；制卡整书把握直读） */
  summaryText?: string;
}

export interface MaterialMapMeta {
  id: string;
  documentId: string;
  scopeAnchor: string;
  scopeKind: string;
  granularity: string;
  title: string | null;
  nodeCount: number;
  promptVersion: number | null;
  generatorVersion: string | null;
  provider: string | null;
  model: string | null;
  nodeRemap: Record<string, string> | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  structure?: MapStructure | null;
}

export interface MapPreviewCall {
  runKind: string;
  label: string;
  chars: number;
  cached: boolean;
}

export interface MapPreview {
  error?: string;
  calls?: MapPreviewCall[];
  callsTotal?: number;
  newCalls?: number;
  cacheHits?: number;
  fixedCalls?: number;
  expandFirstWave?: number;
  budget?: number;
  sourceCharsExact?: number;
  charsExact?: number;
  estInputTokens?: number;
  estOutputTokens?: number;
  estCost?: number | null;
  currency?: string | null;
  hasPricing?: boolean;
  provider?: string;
  model?: string;
  /** v48.12：当前生效的深挖策略（batch/递归深度/原子启发式/单片上限/补漏轮次） */
  strategy?: {
    expandBatch: number;
    expandDepth: number;
    atomicHeuristic: boolean;
    maxPayloadChars: number;
    gapFillMaxRounds: number;
    gapMinChars: number;
  };
}

export interface MapRunRecord {
  id: string;
  documentId: string;
  status: string;
  stage: string | null;
  callsPlanned: number | null;
  callsDone: number | null;
  chars: number | null;
  estInputTokens: number | null;
  estOutputTokens: number | null;
  estCost: number | null;
  currency: string | null;
  actualPromptTokens: number | null;
  actualCompletionTokens: number | null;
  actualCost: number | null;
  repairCount: number;
  errorCode: string | null;
  errorText: string | null;
  createdAt: number;
}

/** v48.13 P3（D47）：可续跑的运行（应用重启后发现；`interrupted` = 被关闭打断，`section_ready` = 首层就绪待续跑） */
export interface ResumableMapRun {
  id: string;
  documentId: string;
  status: string;
  stage: string | null;
  scopeAnchor: string;
  granularity: string;
  callsDone: number | null;
  chars: number | null;
  /** 材料标题（主进程连表带出，指示器不必再回查） */
  materialTitle: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MapIssue {
  nodeId: string;
  type: string;
  severity: string;
  repairScope: string;
  note?: string;
}

/** 首波深挖计划（v48.11 §3.9 阶段 B：首层完成后**精确**给出的第 1 层计划） */
export interface MapExpandPlan {
  firstWaveNodes: number;
  plannedCalls: number;
  spanChars: number;
  maxPayloadChars?: number;
  expandDepth?: number;
}

export interface MindmapGenerateResult {
  // v48.11：新增 section_ready（首层就绪、深挖待续跑）与 partial（部分完成，含预算/失败归因）
  status:
    | "completed"
    | "section_ready"
    | "partial"
    | "cancelled"
    | "failed"
    | "review_failed"
    | "failed_final"
    | "invalid";
  expandPlan?: MapExpandPlan;
  mapId?: string;
  nodeCount?: number;
  code?: string;
  error?: string;
  dropped?: unknown[];
  issues?: MapIssue[];
  summary?: string;
  runId?: string;
}

/**
 * v48.13 P4（D46）增量深化参数。
 * 与生成共用收集参数（同一份 textByUnit / tocItems 才能保证作用域坐标系一致），
 * 另加「深化哪一个版本里的哪一个节点」。
 */
export interface MindmapDeepenParams extends MindmapCollectParams {
  /** 目标节点的 id（必须属于 mapId 指向的版本，且该节点**尚无子结构**） */
  nodeId: string;
  /** 要深化的地图版本 id（= 用户当前正在看的版本） */
  mapId: string;
  /** 只用于进度文案（如「深化 · 本原问题」） */
  deepenLabel?: string;
}

/** 收集给引擎的参数（文本由内核 getSectionText 实测，无截断——§4.19-2④） */
export interface MindmapCollectParams {
  documentId: string;
  title: string;
  tocItems: { anchor: string; label: string; children?: unknown[] }[];
  unitAnchors: string[];
  textByUnit: Record<string, string>;
  scopeAnchor: string;
  granularity: "overview" | "standard" | "detailed";
  force?: boolean;
  /** v48.11：只跑首层（首层就绪即落一版可看的图），深挖作为可续跑的第二阶段 */
  stopAfterSection?: boolean;
  /** v48.11：以同一个 run 续跑（section 全部命中缓存，从深挖继续） */
  resumeRunId?: string;
}

/**
 * v48.12 修复「就此制卡发全文」：按 §4.19-10 组装**有界结构语义包**
 * （本节点 → 父链 → 直接子结构 → 节点证据引文 → 材料级结构摘要，≤maxChars，**不携带章节原文**）。
 * card-structure 提示词的【输入块】契约就是本包；此前误把 collect.textByUnit 的原文当材料发出去，
 * 与提示词「你拿不到原文全文」直接矛盾，且把成本推高到 2400+1200 字。
 */
export function buildStructureCardPackage(node: MapNodeRecord, structure: MapStructure, maxChars = 1200): string {
  const byId = new Map((structure?.nodes || []).map((n) => [n.id, n]));
  const chain: string[] = [];
  let cur: MapNodeRecord | undefined = node.parentId ? byId.get(node.parentId) : undefined;
  const guard = new Set<string>([node.id]);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(`${cur.title}${cur.authorialRole ? `（${cur.authorialRole}）` : ""}`);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const kids = (node.childIds || [])
    .map((id) => byId.get(id))
    .filter((k): k is MapNodeRecord => Boolean(k))
    .map((k) => ({ title: k.title, authorialRole: k.authorialRole || null, relationToParent: k.relationToParent || null }));
  const pkg: Record<string, unknown> = {
    本节点: {
      title: node.title,
      authorialRole: node.authorialRole || null,
      centralQuestion: node.centralQuestion ?? null,
      mainMove: node.mainMove ?? null,
      progression: node.progression ?? null,
      relationToParent: node.relationToParent ?? null,
      groupingBasis: node.groupingBasis ?? null
    },
    父链: chain,
    直接子结构: kids,
    证据引文: (node.evidence || []).map((e) => e.quote).filter(Boolean).slice(0, 6),
    材料级结构摘要: structure?.summaryText || structure?.title || ""
  };
  let text = `【结构语义包】
${JSON.stringify(pkg, null, 1)}`;
  if (text.length > maxChars) {
    // 有界优先砍「摘要 → 证据条数」，**绝不回退去塞原文**
    pkg.证据引文 = (pkg.证据引文 as string[]).slice(0, 3);
    pkg.材料级结构摘要 = String(pkg.材料级结构摘要).slice(0, 240);
    text = `【结构语义包】
${JSON.stringify(pkg, null, 1)}`;
    if (text.length > maxChars) text = text.slice(0, maxChars);
  }
  return text;
}

declare global {
  interface Window {
    mindmapAPI?: {
      preview: (params: MindmapCollectParams) => Promise<MapPreview>;
      generate: (params: MindmapCollectParams) => Promise<MindmapGenerateResult>;
  /** v48.13 P4：增量深化——对**尚无更深结构**的节点按其 sourceSpans 继续分析（已有 children 的展开是纯 UI，不走这里） */
  deepen: (params: MindmapDeepenParams) => Promise<MindmapGenerateResult>;
      cancel: (runId: string) => Promise<boolean>;
      repairConfirm: (runId: string) => Promise<MindmapGenerateResult>;
      list: (documentId: string) => Promise<MaterialMapMeta[]>;
      get: (id: string) => Promise<MaterialMapMeta | null>;
      getActive: (documentId: string, scopeAnchor?: string) => Promise<MaterialMapMeta | null>;
      setActive: (id: string) => Promise<MaterialMapMeta | null>;
      remove: (id: string) => Promise<boolean>;
      runs: (documentId: string) => Promise<MapRunRecord[]>;
  /** v48.13 P3：可续跑运行（全局，不限文档） */
  pendingRuns: () => Promise<ResumableMapRun[]>;
      learningStatus: (documentId: string, nodeIds: string[]) => Promise<Record<string, { cardCount: number; kpExists: boolean }>>;
      onChanged: (cb: (payload: { runId?: string; stage?: string; done?: number; total?: number; label?: string; mapId?: string }) => void) => () => void;
    };
  }
}

export const mindmapApi = {
  preview: (params: MindmapCollectParams) => window.mindmapAPI?.preview(params),
  generate: (params: MindmapCollectParams) => window.mindmapAPI?.generate(params),
  deepen: (params: MindmapDeepenParams) => window.mindmapAPI?.deepen(params) ?? Promise.resolve({ status: "invalid" as const, error: t("深不可用") }),
  cancel: (runId: string) => window.mindmapAPI?.cancel(runId),
  repairConfirm: (runId: string) => window.mindmapAPI?.repairConfirm(runId),
  list: (documentId: string) => window.mindmapAPI?.list(documentId) ?? Promise.resolve([]),
  get: (id: string) => window.mindmapAPI?.get(id) ?? Promise.resolve(null),
  getActive: (documentId: string, scopeAnchor?: string) => window.mindmapAPI?.getActive(documentId, scopeAnchor) ?? Promise.resolve(null),
  setActive: (id: string) => window.mindmapAPI?.setActive(id) ?? Promise.resolve(null),
  remove: (id: string) => window.mindmapAPI?.remove(id) ?? Promise.resolve(false),
  runs: (documentId: string) => window.mindmapAPI?.runs(documentId) ?? Promise.resolve([]),
  pendingRuns: () => window.mindmapAPI?.pendingRuns() ?? Promise.resolve([]),
  learningStatus: (documentId: string, nodeIds: string[]) => window.mindmapAPI?.learningStatus(documentId, nodeIds) ?? Promise.resolve({}),
  onChanged: (cb: (payload: { runId?: string; stage?: string; done?: number; total?: number; label?: string; mapId?: string }) => void) =>
    window.mindmapAPI?.onChanged(cb) ?? (() => {})
};

/** App 级桥安装（App.tsx useEffect 一次）：主进程 mindmap:changed → EventBus mindmap/changed */
export function installMindmapBridge(): () => void {
  if (!window.mindmapAPI) return () => {};
  return window.mindmapAPI.onChanged((payload) => {
    eventBus.emit("mindmap/changed", payload);
  });
}
