// 材料知识导图——渲染层类型化客户端（v48 批3，M15，D41/D42 / §4.19）。
// 与 journal.ts/memory.ts 同构：window.mindmapAPI 薄包装 + 主进程推送桥接为 EventBus `mindmap/changed`。

import { eventBus } from "./eventbus";

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
  charsExact?: number;
  estInputTokens?: number;
  estOutputTokens?: number;
  estCost?: number | null;
  currency?: string | null;
  hasPricing?: boolean;
  provider?: string;
  model?: string;
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

export interface MapIssue {
  nodeId: string;
  type: string;
  severity: string;
  repairScope: string;
  note?: string;
}

export interface MindmapGenerateResult {
  status: "completed" | "cancelled" | "failed" | "review_failed" | "failed_final" | "invalid";
  mapId?: string;
  nodeCount?: number;
  code?: string;
  error?: string;
  dropped?: unknown[];
  issues?: MapIssue[];
  summary?: string;
  runId?: string;
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
}

declare global {
  interface Window {
    mindmapAPI?: {
      preview: (params: MindmapCollectParams) => Promise<MapPreview>;
      generate: (params: MindmapCollectParams) => Promise<MindmapGenerateResult>;
      cancel: (runId: string) => Promise<boolean>;
      repairConfirm: (runId: string) => Promise<MindmapGenerateResult>;
      list: (documentId: string) => Promise<MaterialMapMeta[]>;
      get: (id: string) => Promise<MaterialMapMeta | null>;
      getActive: (documentId: string, scopeAnchor?: string) => Promise<MaterialMapMeta | null>;
      setActive: (id: string) => Promise<MaterialMapMeta | null>;
      remove: (id: string) => Promise<boolean>;
      runs: (documentId: string) => Promise<MapRunRecord[]>;
      learningStatus: (documentId: string, nodeIds: string[]) => Promise<Record<string, { cardCount: number; kpExists: boolean }>>;
      onChanged: (cb: (payload: { runId?: string; stage?: string; done?: number; total?: number; label?: string; mapId?: string }) => void) => () => void;
    };
  }
}

export const mindmapApi = {
  preview: (params: MindmapCollectParams) => window.mindmapAPI?.preview(params),
  generate: (params: MindmapCollectParams) => window.mindmapAPI?.generate(params),
  cancel: (runId: string) => window.mindmapAPI?.cancel(runId),
  repairConfirm: (runId: string) => window.mindmapAPI?.repairConfirm(runId),
  list: (documentId: string) => window.mindmapAPI?.list(documentId) ?? Promise.resolve([]),
  get: (id: string) => window.mindmapAPI?.get(id) ?? Promise.resolve(null),
  getActive: (documentId: string, scopeAnchor?: string) => window.mindmapAPI?.getActive(documentId, scopeAnchor) ?? Promise.resolve(null),
  setActive: (id: string) => window.mindmapAPI?.setActive(id) ?? Promise.resolve(null),
  remove: (id: string) => window.mindmapAPI?.remove(id) ?? Promise.resolve(false),
  runs: (documentId: string) => window.mindmapAPI?.runs(documentId) ?? Promise.resolve([]),
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
