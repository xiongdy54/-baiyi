// 知识地基客户端（v40，K1，D37 / §4.2-23）——渲染层唯一入口。
// KnowledgeBase 口径唯一：一切 KP 检索（含洞察子图展开）必须走主进程 KnowledgeBase，
// 禁止组件自写查询绕过别名/合并语义；读侧零 FSRS 写（§4.12）。

export const KP_RELATION_TYPES = [
  "prerequisite",
  "part_of",
  "related_to",
  "contrasts_with",
  "example_of",
  "application_of",
  "generalization_of",
  "specialization_of",
  "analogous_to"
] as const;

export type KnowledgeRelationType = (typeof KP_RELATION_TYPES)[number];

export const KP_RELATION_LABELS: Record<KnowledgeRelationType, string> = {
  prerequisite: "前置",
  part_of: "属于",
  related_to: "相关",
  contrasts_with: "对比",
  example_of: "例证",
  application_of: "应用",
  generalization_of: "泛化",
  specialization_of: "特化",
  analogous_to: "结构类比"
};

export interface KnowledgePoint {
  id: string;
  canonicalLabel: string;
  description: string | null;
  domainId: string | null;
  parentKnowledgePointId: string | null;
  status: "active" | "merged" | "deprecated";
  mergedInto: string | null;
  aliases: string[];
  languageVariants: string[];
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeRelation {
  id: string;
  fromKnowledgePointId: string;
  toKnowledgePointId: string;
  relationType: KnowledgeRelationType;
  confidence: number | null;
  source: "user" | "ai-inference" | "imported" | "inferred";
  sourceRef: unknown;
  structureLabel: string | null;
  mapping: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeProposalPayload {
  action?: "link" | "create";
  legacyKey?: string;
  cardCount?: number;
  targetKpId?: string;
  targetLabel?: string;
  similarity?: number;
  canonicalLabel?: string;
  domainId?: string | null;
  description?: string | null;
  aliases?: string[];
  /** v41（K2-A）：簇证据（一个提案可聚合多个同名簇） */
  clusters?: { clusterKey: string; legacyKey: string; documentId: string | null; cardIds: string[]; cardCount: number }[];
  clusterKey?: string;
  /** v41：AI 输出与裁决痕迹 */
  aiAssisted?: boolean;
  targetInvalid?: boolean;
  confidence?: number;
  evidence?: string;
  /** v41：关系提案端点（未解析时为引用，解析后补 kpId） */
  fromRef?: { kpId?: string; clusterKey?: string; label?: string; normKey?: string };
  toRef?: { kpId?: string; clusterKey?: string; label?: string; normKey?: string };
  relationType?: KnowledgeRelationType;
  fromKnowledgePointId?: string | null;
  toKnowledgePointId?: string | null;
  sourceId?: string;
  targetId?: string;
}

export interface KnowledgeProposal {
  id: string;
  proposalKind: "point" | "relation" | "merge";
  payload: KnowledgeProposalPayload;
  status: "pending" | "accepted" | "rejected";
  confidence: number | null;
  scope: string;
  sourceRunId: string | null;
  fingerprint?: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface KnowledgePointFilter {
  query?: string;
  domainId?: string;
  status?: "active" | "merged" | "deprecated" | "";
  limit?: number;
  offset?: number;
}

export interface KnowledgePointListResult {
  points: KnowledgePoint[];
  total: number;
}

/** v41（K2-A，D38）：卡片簇（一次制卡动作在同一材料内产生的一组卡）——AI 整理的输入单位 */
export interface KpCluster {
  clusterKey: string;
  legacyKey: string;
  documentId: string | null;
  genBatchId: string | null;
  cardIds: string[];
  cardCount: number;
  samples: { cardId: string; cardType: string; front: string; contextPrefix: string | null; domain: string[] }[];
  normalized?: boolean;
}

export interface KpClusterListing {
  clusters: KpCluster[];
  unnormalized: KpCluster[];
  total: number;
  totalUnnormalized: number;
  totalCards: number;
}

/** AI 抽取裁决结果（主进程 applyKpExtraction 输出） */
export interface KpExtractionSummary {
  autoLinked: { clusterKeys: string[]; canonicalLabel: string; targetKpId: string; addedAliases: string[] }[];
  created: { proposalId: string; canonicalLabel: string; clusterKeys: string[] }[];
  linked: { proposalId: string; canonicalLabel: string; clusterKeys: string[]; targetKpId: string | null }[];
  relations: { proposalId: string; relationType: string; from: string; to: string; resolved: boolean }[];
  conflicts: { clusterKey: string; canonicalLabel: string; reason: string }[];
  skipped: { clusterKey?: string; relation?: boolean; reason: string }[];
  dedupSkipped: number;
}

export interface KpExtractPrepareResult {
  extractionInput: string;
  relationInput: string;
  clusterCount: number;
  candidateCount: number;
  clusterKeys: string[];
}

export interface KnowledgeExternalRef {
  id: string;
  knowledgePointId: string;
  refKind: "wikidata-qid" | "wikipedia-url" | "isbn" | "doi" | "custom";
  refValue: string;
  sourceLabel: string | null;
  createdAt: number;
}

/** v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查结果（只读非阻断；K2/K3/K5/K6 为写时校验/提案裁决形态） */
export interface KnowledgeLintIssue {
  ruleId: "K4" | "K7" | "K8";
  severity: "warn" | "info";
  knowledgePointId: string;
  kpLabel: string;
  message: string;
  detail: string;
}

declare global {
  interface Window {
    knowledgeAPI?: {
      listPoints: (filter?: KnowledgePointFilter) => Promise<KnowledgePointListResult>;
      /** D158：只读——所选知识点归并族的并集（含所选 id 本身） */
      resolveFamilies: (ids: string[]) => Promise<string[]>;
      getPoint: (id: string) => Promise<KnowledgePoint | null>;
      createPoint: (payload: Partial<KnowledgePoint> & { canonicalLabel: string }) => Promise<KnowledgePoint>;
      updatePoint: (id: string, patch: Partial<KnowledgePoint>) => Promise<KnowledgePoint | null>;
      mergePoints: (sourceId: string, targetId: string) => Promise<{ source: KnowledgePoint; target: KnowledgePoint }>;
      unmergePoint: (id: string) => Promise<KnowledgePoint>;
      listRelations: (filter?: { kpId?: string; relationType?: KnowledgeRelationType; limit?: number }) => Promise<{ relations: KnowledgeRelation[] }>;
      createRelation: (payload: {
        fromKnowledgePointId: string;
        toKnowledgePointId: string;
        relationType: KnowledgeRelationType;
        confidence?: number;
        source?: KnowledgeRelation["source"];
        structureLabel?: string;
        mapping?: unknown;
      }) => Promise<KnowledgeRelation>;
      deleteRelation: (id: string) => Promise<boolean>;
      listRefs: (kpId: string) => Promise<KnowledgeExternalRef[]>;
      createRef: (payload: { knowledgePointId: string; refKind: KnowledgeExternalRef["refKind"]; refValue: string; sourceLabel?: string }) => Promise<KnowledgeExternalRef>;
      deleteRef: (id: string) => Promise<boolean>;
      listProposals: (filter?: { status?: "pending" | "accepted" | "rejected" | ""; proposalKind?: KnowledgeProposal["proposalKind"] }) => Promise<{ proposals: KnowledgeProposal[] }>;
      resolveProposal: (id: string, accept: boolean, overridePayload?: Partial<KnowledgeProposal["payload"]>) => Promise<{ proposal: KnowledgeProposal; applied: unknown }>;
      migrationSuggestions: () => Promise<{ created: number; skipped: number; scanned: number }>;
      // v41（K2-A，D38）
      kpClusters: () => Promise<KpClusterListing>;
      kpExtractPrepare: (opts?: { clusterKeys?: string[]; sources?: { knowledgePointId: string; genBatchId?: string | null; documentId?: string | null }[] }) => Promise<KpExtractPrepareResult>;
      kpExtractApply: (rawExtraction: string, rawRelations: string) => Promise<KpExtractionSummary>;
      acceptAllPending: () => Promise<{ accepted: { id: string; kind: string; label: string }[]; failed: { id: string; error: string }[]; total: number }>;
      /** v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查 */
      lint: () => Promise<KnowledgeLintIssue[]>;
    };
  }
}

const emptyList: KnowledgePointListResult = { points: [], total: 0 };

export const knowledgeApi = {
  async listPoints(filter: KnowledgePointFilter = {}): Promise<KnowledgePointListResult> {
    if (!window.knowledgeAPI) return emptyList;
    return (await window.knowledgeAPI.listPoints(filter)) || emptyList;
  },
  async getPoint(id: string): Promise<KnowledgePoint | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.getPoint(id)) || null;
  },
  async createPoint(payload: Partial<KnowledgePoint> & { canonicalLabel: string }): Promise<KnowledgePoint | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.createPoint(payload)) || null;
  },
  async updatePoint(id: string, patch: Partial<KnowledgePoint>): Promise<KnowledgePoint | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.updatePoint(id, patch)) || null;
  },
  async mergePoints(sourceId: string, targetId: string) {
    if (!window.knowledgeAPI) return null;
    return await window.knowledgeAPI.mergePoints(sourceId, targetId);
  },
  async unmergePoint(id: string): Promise<KnowledgePoint | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.unmergePoint(id)) || null;
  },
  async listRelations(filter: { kpId?: string; relationType?: KnowledgeRelationType; limit?: number } = {}): Promise<KnowledgeRelation[]> {
    if (!window.knowledgeAPI) return [];
    return (await window.knowledgeAPI.listRelations(filter))?.relations || [];
  },
  async createRelation(payload: Parameters<NonNullable<Window["knowledgeAPI"]>["createRelation"]>[0]): Promise<KnowledgeRelation> {
    if (!window.knowledgeAPI) throw new Error("knowledgeAPI 不可用");
    return await window.knowledgeAPI.createRelation(payload);
  },
  async deleteRelation(id: string): Promise<boolean> {
    if (!window.knowledgeAPI) return false;
    return await window.knowledgeAPI.deleteRelation(id);
  },
  async listRefs(kpId: string): Promise<KnowledgeExternalRef[]> {
    if (!window.knowledgeAPI) return [];
    return (await window.knowledgeAPI.listRefs(kpId)) || [];
  },
  async createRef(payload: Parameters<NonNullable<Window["knowledgeAPI"]>["createRef"]>[0]): Promise<KnowledgeExternalRef | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.createRef(payload)) || null;
  },
  async deleteRef(id: string): Promise<boolean> {
    if (!window.knowledgeAPI) return false;
    return await window.knowledgeAPI.deleteRef(id);
  },
  async listProposals(filter: { status?: "pending" | "accepted" | "rejected" | ""; proposalKind?: KnowledgeProposal["proposalKind"] } = {}): Promise<KnowledgeProposal[]> {
    if (!window.knowledgeAPI) return [];
    return (await window.knowledgeAPI.listProposals(filter))?.proposals || [];
  },
  async resolveProposal(id: string, accept: boolean, overridePayload?: Partial<KnowledgeProposal["payload"]>) {
    if (!window.knowledgeAPI) return null;
    return await window.knowledgeAPI.resolveProposal(id, accept, overridePayload);
  },
  async migrationSuggestions(): Promise<{ created: number; skipped: number; scanned: number } | null> {
    if (!window.knowledgeAPI) return null;
    return (await window.knowledgeAPI.migrationSuggestions()) || null;
  },
  // ---- v41（K2-A，D38）：AI 抽取归一与关系 ----
  async kpClusters(): Promise<KpClusterListing | null> {
    if (!window.knowledgeAPI?.kpClusters) return null;
    return (await window.knowledgeAPI.kpClusters()) || null;
  },
  async kpExtractPrepare(opts: { clusterKeys?: string[]; sources?: { knowledgePointId: string; genBatchId?: string | null; documentId?: string | null }[] } = {}): Promise<KpExtractPrepareResult | null> {
    if (!window.knowledgeAPI?.kpExtractPrepare) return null;
    return (await window.knowledgeAPI.kpExtractPrepare(opts)) || null;
  },
  async kpExtractApply(rawExtraction: string, rawRelations: string): Promise<KpExtractionSummary | null> {
    if (!window.knowledgeAPI?.kpExtractApply) return null;
    return (await window.knowledgeAPI.kpExtractApply(rawExtraction, rawRelations)) || null;
  },
  async acceptAllPending() {
    if (!window.knowledgeAPI?.acceptAllPending) return null;
    return await window.knowledgeAPI.acceptAllPending();
  },
  // ---- v43（K2-B）：KnowledgeLint K4/K7/K8 ----
  async lint(): Promise<KnowledgeLintIssue[]> {
    if (!window.knowledgeAPI?.lint) return [];
    return (await window.knowledgeAPI.lint()) || [];
  }
};

/** 关系类型展示名（AI 来源加虚线语义由 UI 层处理） */
export function relationLabel(type: string): string {
  return KP_RELATION_LABELS[type as KnowledgeRelationType] || type;
}
