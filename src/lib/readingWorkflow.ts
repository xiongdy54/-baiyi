// ReadingWorkflowProvider — 渐进阅读流程抽象（文档§3.9）
// 默认实现：SuperMemo19 风格（priority 0-100 + 间隔递增 postpone）。
// 用户重设计流程时：新写一个 Provider 替换下方赋值，UI 不动。

declare global {
  interface Window {
    workflowAPI?: {
      create: (payload: unknown) => Promise<{ id: string }>;
      listDue: () => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      postpone: (id: string) => Promise<unknown>;
    };
  }
}

export interface DueTopic {
  id: string;
  contentMarkdown: string;
  priority: number;
  topicNextAt: number;
  intervalDays: number;
  docTitle: string;
  parentType: string;
  depth: number;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string; anchorRatio?: number } | null;
}

export interface ExtractDetail extends DueTopic {
  documentId: string;
  parentExtractId?: string;
  chain: string[];
  createdAt: number;
}

export interface ExtractInput {
  parentType: "document" | "extract";
  parentId: string;
  documentId: string;
  contentMarkdown: string;
  priority?: number;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string; anchorRatio?: number } | null;
}

export interface ReadingWorkflowProvider {
  name: string;
  create(input: ExtractInput): Promise<{ id: string }>;
  getDueTopics(): Promise<DueTopic[]>;
  getTopic(id: string): Promise<ExtractDetail | null>;
  postpone(id: string): Promise<void>;
  setPriority(id: string, priority: number): Promise<void>;
}

const sm19Provider: ReadingWorkflowProvider = {
  name: "sm19-default",
  async create(input) {
    if (!window.workflowAPI) throw new Error("API 不可用");
    return window.workflowAPI.create(input);
  },
  async getDueTopics() {
    if (!window.workflowAPI) return [];
    return (await window.workflowAPI.listDue()) as DueTopic[];
  },
  async getTopic(id) {
    if (!window.workflowAPI) return null;
    return (await window.workflowAPI.get(id)) as ExtractDetail | null;
  },
  async postpone(id) {
    await window.workflowAPI?.postpone(id);
  },
  async setPriority(_id, _priority) {
    // Phase 3+ 提供优先级编辑 UI
  }
};

export const readingWorkflow: ReadingWorkflowProvider = sm19Provider;
