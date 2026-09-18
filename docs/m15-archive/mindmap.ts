// 材料知识导图客户端（v47，M15，D40 / §4.19）——渲染层唯一数据入口。
// AI 编排（章节抽取 material-difficulty ×N → 聚合 → 图示）在 MindMapPanel（同洞察/制卡管线惯例：
// 主进程不拼提示词）；本客户端只做两表 CRUD、分片缓存命中与节点学习状态查询。
import type { MindmapStructure } from "./mindmapCore";

export interface MindmapRecord {
  id: string;
  documentId: string;
  itemId: string | null;
  scopeAnchor: string;
  scopeKind: "book" | "chapter";
  granularity: string;
  structure: MindmapStructure | null;
  diagramArtifact: string | null;
  hasArtifact: boolean;
  artifactKind: string;
  diagramTypes: string[];
  warnings: string[];
  promptScope: string | null;
  promptVersion: number | null;
  model: string | null;
  tokenUsed: number | null;
  feedback: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface MindmapShard {
  id: string;
  documentId: string;
  anchor: string;
  kind: string;
  promptScope: string;
  promptVersion: number;
  content: {
    chapterAnchor: string;
    chapterLabel: string;
    difficultySummary?: string;
    overallGrade?: number | string;
    kpCandidates?: { label: string; evidence: string; domain?: string[] }[];
  } | null;
  model: string | null;
  tokenUsed: number | null;
  updatedAt: number;
}

export interface MindmapLearningStatus {
  [label: string]: { cardCount: number; kpExists: boolean };
}

export interface MindmapSavePayload {
  documentId: string;
  itemId?: string | null;
  scopeAnchor: string;
  scopeKind: "book" | "chapter";
  granularity: string;
  structure: MindmapStructure;
  diagramArtifact?: string | null;
  artifactKind?: string;
  diagramTypes?: string[];
  warnings?: string[];
  promptScope?: string;
  promptVersion?: number;
  model?: string | null;
  tokenUsed?: number | null;
}

declare global {
  interface Window {
    mindmapAPI?: {
      list: (opts: { documentId: string; limit?: number }) => Promise<MindmapRecord[]>;
      get: (id: string) => Promise<MindmapRecord | null>;
      remove: (id: string) => Promise<boolean>;
      save: (payload: MindmapSavePayload) => Promise<MindmapRecord | null>;
      setFeedback: (id: string, feedback: unknown) => Promise<MindmapRecord | null>;
      shardGet: (key: { documentId: string; anchor: string; kind?: string; promptScope: string; promptVersion: number }) => Promise<MindmapShard | null>;
      shardSave: (payload: { documentId: string; anchor: string; kind?: string; promptScope: string; promptVersion: number; content: unknown; model?: string | null; tokenUsed?: number | null }) => Promise<MindmapShard | null>;
      learningStatus: (payload: { documentId: string | null; labels: string[] }) => Promise<MindmapLearningStatus>;
    };
  }
}

export const mindmapApi = {
  async list(documentId: string, limit = 50): Promise<MindmapRecord[]> {
    if (!window.mindmapAPI || !documentId) return [];
    return (await window.mindmapAPI.list({ documentId, limit })) || [];
  },
  async get(id: string): Promise<MindmapRecord | null> {
    if (!window.mindmapAPI) return null;
    return (await window.mindmapAPI.get(id)) || null;
  },
  async remove(id: string): Promise<boolean> {
    if (!window.mindmapAPI) return false;
    return await window.mindmapAPI.remove(id);
  },
  async save(payload: MindmapSavePayload): Promise<MindmapRecord | null> {
    if (!window.mindmapAPI) return null;
    return (await window.mindmapAPI.save(payload)) || null;
  },
  async setFeedback(id: string, feedback: unknown): Promise<MindmapRecord | null> {
    if (!window.mindmapAPI) return null;
    return (await window.mindmapAPI.setFeedback(id, feedback)) || null;
  },
  async shardGet(key: { documentId: string; anchor: string; promptScope: string; promptVersion: number }): Promise<MindmapShard | null> {
    if (!window.mindmapAPI) return null;
    return (await window.mindmapAPI.shardGet(key)) || null;
  },
  async shardSave(payload: { documentId: string; anchor: string; promptScope: string; promptVersion: number; content: unknown; model?: string | null; tokenUsed?: number | null }): Promise<MindmapShard | null> {
    if (!window.mindmapAPI) return null;
    return (await window.mindmapAPI.shardSave(payload)) || null;
  },
  async learningStatus(documentId: string | null, labels: string[]): Promise<MindmapLearningStatus> {
    if (!window.mindmapAPI) return {};
    return (await window.mindmapAPI.learningStatus({ documentId, labels })) || {};
  }
};
