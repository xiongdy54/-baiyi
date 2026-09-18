// AI 洞察客户端（v40，M8-B，D37 / §4.2-24）——渲染层唯一入口（InsightEngine 编排面）。
// 编排在渲染层（同制卡管线 §4.3）：buildPackage → createRun → ai:chat 流式 → completeRun/failRun；
// 反馈只写 insight_runs（永不写 mastery）；Personal Meaning 候选确认后才成事实（§4.13-3）。
import { eventBus } from "./eventbus";

export interface InsightDiarySpan {
  entryId: string;
  entryDate: string;
  text: string;
  createdAt?: number;
}

export interface InsightKpNode {
  id: string;
  canonicalLabel: string;
  aliases: string[];
  domainId: string | null;
  description: string | null;
}

export interface InsightKpEdge {
  id: string;
  fromKnowledgePointId: string;
  toKnowledgePointId: string;
  relationType: string;
  confidence: number | null;
  source: string;
}

export interface EvidencePackage {
  diarySpans: InsightDiarySpan[];
  kpSubgraph: { kps: InsightKpNode[]; edges: InsightKpEdge[] };
  cards: { cardId: string; cardType: string; front: string; back: string; domain: string[]; kpId: string | null; documentId: string | null; priority: number }[];
  extracts: { extractId: string; documentId: string; text: string }[];
  sources: { documentId: string; title: string; sourceType: string }[];
  tokenBudget: number;
  tokenEstimated: number;
  grounded: boolean;
  trimmed: { edges: boolean; cards: boolean; extracts: boolean };
  groundingOrder: string[];
  range: { kind: string; from: string | null; to: string | null };
}

/** §4.13-2 输出结构（AI 严格 JSON；本地解析容错后落 output_json） */
export interface InsightOutput {
  observation?: string[];
  knowledgeLinks?: { knowledgePointId?: string; cardId?: string; extractId?: string; documentId?: string; diaryEntryId?: string; note?: string; confidence?: string }[];
  interpretations?: { claim: string; type?: "hypothesis"; evidence?: string[]; confidence?: string }[];
  alternativeInterpretations?: { claim: string; evidence?: string[] }[];
  questions?: string[];
  uncertainties?: string[];
  structureConnection?: {
    ownedStructure?: { knowledgePointIds?: string[]; structureLabel?: string };
    connectionMode?: "analogy" | "abstraction" | "combination";
    candidateDomain?: string;
    counterpartStructure?: string;
    slotMapping?: { fromKnowledgePointId?: string; fromLabel?: string; toLabel: string; relationType?: string; confidence?: string }[];
    whyThisDomain?: string;
    disanalogy?: string[];
    expectedEntryPoint?: string;
    falsifiableQuestions?: string[];
    uncertainties?: string[];
  };
}

export type InsightRangeKind = "7d" | "30d" | "all" | "custom";

export interface InsightRun {
  id: string;
  rangeKind: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  entryCount: number;
  entryIds: string[];
  evidencePackage: EvidencePackage | null;
  model: string | null;
  promptScope: string | null;
  promptVersion: number | null;
  output: InsightOutput | null;
  tokenUsed: number | null;
  feedback: InsightFeedback | null;
  status: "running" | "done" | "failed" | "cancelled";
  errorText: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InsightFeedback {
  /** 四档：有用 / 部分有用 / 无关 / 不确定（§4.11-5，只调 utility 永不写 mastery） */
  utility?: "useful" | "partially-useful" | "irrelevant" | "uncertain";
  /** 竞争解释二选（防确认偏误）：选中的解释下标 */
  chosenInterpretation?: number | null;
  /** 结构分支定向反馈（§4.14-7）：接受 / 拒绝（结构不成立｜不感兴趣｜太难） */
  structureVerdict?: "accepted" | "rejected:invalid" | "rejected:uninterested" | "rejected:too-hard" | null;
  note?: string;
}

export interface PersonalMeaningCandidate {
  id: string;
  label: string;
  kind: "Concept" | "Preference" | "Value" | "Interest" | "Experience" | "Question" | "Choice";
  sourceInsightRunId: string | null;
  evidenceRefs: { cardId?: string; extractId?: string; documentId?: string; diaryEntryId?: string }[] | null;
  note: string | null;
  status: "proposed" | "accepted" | "rejected" | "ignored";
  createdAt: number;
  updatedAt: number;
}

export interface InsightBuildOptions {
  rangeKind: InsightRangeKind;
  rangeFrom?: string;
  rangeTo?: string;
  tokenBudget?: number;
}

declare global {
  interface Window {
    insightsAPI?: {
      buildPackage: (opts: InsightBuildOptions) => Promise<EvidencePackage>;
      createRun: (payload: {
        rangeKind: string;
        rangeFrom?: string | null;
        rangeTo?: string | null;
        entryCount: number;
        entryIds: string[];
        evidencePackage: EvidencePackage;
        model?: string;
        promptScope?: string;
        promptVersion?: number;
      }) => Promise<InsightRun>;
      completeRun: (id: string, extra: { output: InsightOutput; tokenUsed?: number; model?: string; promptVersion?: number }) => Promise<InsightRun>;
      failRun: (id: string, errorText: string) => Promise<InsightRun>;
      getRun: (id: string) => Promise<InsightRun | null>;
      listRuns: (opts?: { limit?: number; includePackage?: boolean }) => Promise<{ runs: InsightRun[] }>;
      setFeedback: (id: string, feedback: InsightFeedback) => Promise<InsightRun>;
      deleteRun: (id: string) => Promise<boolean>;
      meaningList: (filter?: { status?: PersonalMeaningCandidate["status"] | "" }) => Promise<{ candidates: PersonalMeaningCandidate[] }>;
      meaningCreate: (payload: { label: string; kind: PersonalMeaningCandidate["kind"]; sourceInsightRunId?: string; evidenceRefs?: PersonalMeaningCandidate["evidenceRefs"]; note?: string }) => Promise<PersonalMeaningCandidate>;
      meaningResolve: (id: string, status: "accepted" | "rejected" | "ignored") => Promise<PersonalMeaningCandidate | null>;
      meaningDelete: (id: string) => Promise<boolean>;
      onChanged: (callback: () => void) => () => void;
    };
  }
}

export const insightsApi = {
  async buildPackage(opts: InsightBuildOptions): Promise<EvidencePackage | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.buildPackage(opts)) || null;
  },
  async createRun(payload: Parameters<NonNullable<Window["insightsAPI"]>["createRun"]>[0]): Promise<InsightRun | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.createRun(payload)) || null;
  },
  async completeRun(id: string, extra: Parameters<NonNullable<Window["insightsAPI"]>["completeRun"]>[1]): Promise<InsightRun | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.completeRun(id, extra)) || null;
  },
  async failRun(id: string, errorText: string): Promise<InsightRun | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.failRun(id, errorText)) || null;
  },
  async getRun(id: string): Promise<InsightRun | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.getRun(id)) || null;
  },
  async listRuns(opts: { limit?: number; includePackage?: boolean } = {}): Promise<InsightRun[]> {
    if (!window.insightsAPI) return [];
    return (await window.insightsAPI.listRuns(opts))?.runs || [];
  },
  async setFeedback(id: string, feedback: InsightFeedback): Promise<InsightRun | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.setFeedback(id, feedback)) || null;
  },
  async deleteRun(id: string): Promise<boolean> {
    if (!window.insightsAPI) return false;
    return await window.insightsAPI.deleteRun(id);
  },
  async meaningList(filter: { status?: PersonalMeaningCandidate["status"] | "" } = {}): Promise<PersonalMeaningCandidate[]> {
    if (!window.insightsAPI) return [];
    return (await window.insightsAPI.meaningList(filter))?.candidates || [];
  },
  async meaningCreate(payload: Parameters<NonNullable<Window["insightsAPI"]>["meaningCreate"]>[0]): Promise<PersonalMeaningCandidate | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.meaningCreate(payload)) || null;
  },
  async meaningResolve(id: string, status: "accepted" | "rejected" | "ignored"): Promise<PersonalMeaningCandidate | null> {
    if (!window.insightsAPI) return null;
    return (await window.insightsAPI.meaningResolve(id, status)) || null;
  },
  async meaningDelete(id: string): Promise<boolean> {
    if (!window.insightsAPI) return false;
    return await window.insightsAPI.meaningDelete(id);
  }
};

// 主进程推送 → EventBus（只挂一次；`insight/changed` 为 v40 新增锁定事件）
let bridgeInstalled = false;
export function installInsightBridge(): void {
  if (bridgeInstalled || typeof window === "undefined") return;
  if (!window.insightsAPI?.onChanged) return;
  bridgeInstalled = true;
  window.insightsAPI.onChanged(() => {
    eventBus.emit("insight/changed");
  });
}

/** 容错解析（同制卡管线 extractJson 的括号平衡思想，但不绑 cards schema）：取第一个顶层平衡 JSON 对象 */
export function parseInsightOutput(raw: string): InsightOutput {
  const text = String(raw ?? "");
  const candidates: string[] = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        candidates.push(text.slice(objStart, i + 1));
        objStart = -1;
      }
    }
  }
  let lastErr: unknown = null;
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand) as InsightOutput;
      if (!parsed || typeof parsed !== "object") throw new Error("AI 返回不是对象");
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`洞察输出解析失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** Evidence Package → 用户消息文本（禁全库直发的对照物：只发包内内容，ID 显式标出供引用） */
export function evidencePackageToMessages(pkg: EvidencePackage): { systemExtra: string; userText: string } {
  const lines: string[] = [];
  lines.push(`【洞察范围】${pkg.range.kind}${pkg.range.from ? `（${pkg.range.from} ~ ${pkg.range.to ?? "今天"}）` : ""} · 共 ${pkg.diarySpans.length} 条日记`);
  if (!pkg.grounded) {
    const t = pkg.trimmed;
    lines.push(`【预算裁剪提示】证据包超预算已裁剪（${[t.edges && "关系边", t.cards && "卡", t.extracts && "摘录"].filter(Boolean).join("、")}）——结论请更保守。`);
  }
  lines.push("", "【日记原文（FACT，禁止改写）】");
  for (const s of pkg.diarySpans) {
    lines.push(`- (diaryEntryId=${s.entryId} ${s.entryDate}) ${s.text}`);
  }
  lines.push("", "【已学知识子图（LEARNED，引用须用下列真实 ID）】");
  for (const kp of pkg.kpSubgraph.kps) {
    lines.push(`- (knowledgePointId=${kp.id}) ${kp.canonicalLabel}${kp.aliases?.length ? `（别名：${kp.aliases.join("、")}）` : ""}${kp.domainId ? ` [领域 ${kp.domainId}]` : ""}`);
  }
  for (const e of pkg.kpSubgraph.edges) {
    lines.push(`  · 关系 (relationId=${e.id}) ${e.fromKnowledgePointId} --${e.relationType}--> ${e.toKnowledgePointId}${e.source === "ai-inference" ? "（AI 提议，未经确认）" : ""}`);
  }
  if (pkg.cards.length) {
    lines.push("", "【相关卡片（LEARNED）】");
    for (const c of pkg.cards) {
      lines.push(`- (cardId=${c.cardId}${c.documentId ? ` documentId=${c.documentId}` : ""}) 正面：${(c.front || "").slice(0, 120)} | 背面：${(c.back || "").slice(0, 120)}`);
    }
  }
  if (pkg.extracts.length) {
    lines.push("", "【相关摘录（LEARNED）】");
    for (const ex of pkg.extracts) {
      lines.push(`- (extractId=${ex.extractId}${ex.documentId ? ` documentId=${ex.documentId}` : ""}) ${ex.text}`);
    }
  }
  if (pkg.sources.length) {
    lines.push("", "【来源（LEARNED）】");
    for (const s of pkg.sources) lines.push(`- (documentId=${s.documentId}) ${s.title}（${s.sourceType}）`);
  }
  lines.push("", "请按系统提示词输出 JSON 洞察。");
  return { systemExtra: "", userText: lines.join("\n") };
}
