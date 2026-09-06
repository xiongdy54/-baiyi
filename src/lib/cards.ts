// CardGeneratorProvider（文档§3.17）+ Cloze 解析 + CardLintEngine（§3.18/§8.4）
import { aiGateway } from "./ai";

declare global {
  interface Window {
    promptsAPI?: { get: (scope: string) => Promise<{ id: string; content: string } | null>; list: () => Promise<unknown[]> };
    cardsAPI?: {
      create: (card: unknown) => Promise<{ id: string }>;
      update: (card: unknown) => Promise<boolean>;
      get: (id: string) => Promise<unknown>;
      listDue: () => Promise<unknown[]>;
      listAll: () => Promise<unknown[]>;
      remove: (id: string) => Promise<boolean>;
      review: (cardId: string, fsrsState: unknown, rating: string, durationMs?: number) => Promise<boolean>;
      setSuspended: (id: string, suspended: boolean, reason?: string) => Promise<boolean>;
      updateLeech: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
      resolveLeech: (id: string, resolution: string, updates?: unknown) => Promise<boolean>;
      listLeech: () => Promise<unknown[]>;
    };
    issuesAPI?: {
      add: (issue: unknown) => Promise<{ id: string }>;
      list: (cardId: string) => Promise<unknown[]>;
      resolve: (id: string) => Promise<boolean>;
    };
    batchesAPI?: {
      create: (batch: unknown) => Promise<{ id: string }>;
      setStatus: (id: string, status: string) => Promise<boolean>;
    };
    similarityAPI?: { find: (text: string, k?: number) => Promise<{ cardId: string; score: number; front: string }[]> };
  }
}

// ---------- Cloze：Anki 语法解析 ----------
export interface ClozeParse {
  ords: number[];
  render: (hiddenOrd: number | null) => string;
}

export function parseCloze(text: string): ClozeParse {
  const re = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;
  const ords = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ords.add(Number(m[1]));
  return {
    ords: [...ords].sort((a, b) => a - b),
    render(hiddenOrd: number | null) {
      return text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_s, ordStr, content, hint) => {
        const ord = Number(ordStr);
        if (hiddenOrd !== null && ord === hiddenOrd) return hint ? `[${hint}]` : "[…]";
        return content;
      });
    }
  };
}

export function extractClozeAnswer(text: string, ord: number): string {
  const re = new RegExp(`\\{\\{c${ord}::(.*?)(?:::(.*?))?\\}\\}`);
  const m = re.exec(text);
  return m ? (m[2] ?? "") : "";
}

// ---------- CardGeneratorProvider ----------
export interface CardDraft {
  cardType: string;
  knowledgePointId?: string;
  contextPrefix?: string;
  front: string;
  back: string;
  cloze?: string | null;
  example?: string | null;
  mnemonic?: string | null;
  sourceRef?: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp?: string | null;
  prioritySuggestion?: number;
  ruleNotes?: string[];
  warnings?: string[];
}

export interface GenResult {
  knowledgePoints: { id: string; summary: string }[];
  blockReasons: string[];
  cards: CardDraft[];
}

export type CardGenMode = "auto" | "card-generation" | "card-formula" | "card-seq" | "card-enum" | "card-mnemonic" | "card-contrast" | "card-wording" | "card-basic";

// 模式自动路由（§8.2.3）
export function detectMode(text: string): CardGenMode {
  if (/[=\\]|\d\s*[+\-*/^]\s*\d|\$\\?/.test(text) && /(公式|方程|=\s*\S|\\frac|\\sum)/.test(text)) return "card-formula";
  if (/(步骤|流程|时间线|顺序|第一章.*第二章|首先.*然后.*最后)/.test(text)) return "card-seq";
  if (/(列出|有哪些|分别|包括以下|：[^\n]*、[^\n]*、)/.test(text)) return "card-enum";
  return "card-generation";
}

function extractJson(raw: string): GenResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效 JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as GenResult;
  if (!Array.isArray(parsed.cards)) throw new Error("AI 返回缺少 cards 数组");
  return parsed;
}

export const cardGenerator: {
  generateCards(
    sourceText: string,
    context: { title?: string; section?: string; sourceRef?: { title?: string } | null; existingCards?: string[]; userProfile?: string; webContext?: string },
    mode: CardGenMode,
    onProgress?: (chars: number) => void,
    onThinking?: (thinkChars: number) => void
  ): Promise<{ batchId: string; result: GenResult; templateId: string | null }>;
  explain(
    sourceText: string,
    context: string,
    question: string | null,
    onDelta?: (acc: string) => void,
    onThinking?: (thinkChars: number) => void
  ): Promise<string>;
} = {
  async generateCards(sourceText, context, mode, onProgress, onThinking) {
    const resolved = mode === "auto" ? detectMode(sourceText) : mode;
    const tpl = await window.promptsAPI?.get(resolved);
    if (!tpl) throw new Error("提示词模板缺失");
    const sys = tpl.content;
    const user = [
      `【材料】\n${sourceText}`,
      context.title ? `【来源】《${context.title}》${context.section ? " · " + context.section : ""}` : "",
      context.webContext ? `【联网检索到的事件背景（仅供理解，禁止编造来源）】\n${context.webContext}` : "",
      context.existingCards?.length ? `【用户已有卡片（注意 R10 联想与干扰提示）】\n${context.existingCards.slice(0, 10).join("\n")}` : "",
      context.userProfile ? `【用户画像（R9 个性化例子优先用）】\n${context.userProfile}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    let acc = "";
    const raw = await aiGateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      onProgress
        ? (a) => {
            acc = a;
            onProgress(a.length);
          }
        : undefined,
      0.4,
      onThinking
    );
    const result = extractJson(raw || acc);
    const batch = await window.batchesAPI?.create({
      scope: resolved,
      sourceText,
      context: {
        ...context,
        // 诊断留痕：确认联网背景是否真的进入了上下文
        webContextChars: context.webContext ? context.webContext.length : 0,
        webContextPreview: context.webContext ? context.webContext.slice(0, 200) : ""
      },
      promptTemplateId: tpl.id,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tpl.id };
  },

  async explain(sourceText, context, question, onDelta, onThinking) {
    const tpl = await window.promptsAPI?.get("reader-explain");
    const sys = tpl?.content || "你是阅读助手。";
    const user = `【选中文本】\n${sourceText}\n\n${context ? `【上下文】${context}` : ""}\n\n${question ? `【用户追问】${question}` : "请解释这段文字。"}`;
    return aiGateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      onDelta,
      0.7,
      onThinking
    );
  }
};

// ---------- CardLintEngine（§8.4，纯本地静态规则） ----------
export interface LintIssue {
  ruleId: string;
  severity: "error" | "warn" | "info";
  message: string;
}

const CHANGEABLE = /(统计|版本|价格|政策|截至|目前|当前|最新)/;

export function lintCard(draft: {
  front?: string;
  back?: string;
  cardType?: string;
  cloze?: string | null;
  contextPrefix?: string | null;
  sourceRef?: unknown;
  dateStamp?: string | null;
  knowledgePointId?: string | null;
  clusterSize?: number;
}): LintIssue[] {
  const issues: LintIssue[] = [];
  const front = draft.front || "";
  const back = draft.back || "";
  const cloze = draft.cloze || "";

  if (draft.cardType === "imageOcclusion" && !draft.front) {
    issues.push({ ruleId: "L11", severity: "error", message: "图像遮挡卡缺少图像" });
  }
  if (back.replace(/\s/g, "").length > 60) {
    issues.push({ ruleId: "L1", severity: "warn", message: "back 信息过载（>60字），考虑拆分（规则4 最小信息）" });
  }
  if (/^(是|否|对|错|正确|错误|true|false)\.?$/i.test(back.trim())) {
    issues.push({ ruleId: "L2", severity: "warn", message: "是否题（规则：避免判断题）" });
  }
  if (/(有哪些|列举|分别列出)/.test(front)) {
    issues.push({ ruleId: "L3", severity: "warn", message: "集合型问法（规则9 避免集合）" });
  }
  if (cloze) {
    const holes = cloze.match(/\{\{c\d+::/g);
    if (holes && holes.length > 2) {
      issues.push({ ruleId: "L9", severity: "warn", message: "单卡挖空 >2 处（规则4/5）" });
    }
  }
  if (!draft.contextPrefix) {
    issues.push({ ruleId: "L5", severity: "info", message: "缺 contextPrefix 上下文前缀（规则16）" });
  }
  if (!draft.sourceRef) {
    issues.push({ ruleId: "L6", severity: "info", message: "缺来源 sourceRef（规则18）" });
  }
  if (front.length > 80) {
    issues.push({ ruleId: "L10", severity: "warn", message: "front 过长（>80字），模式匹配风险（规则12）" });
  }
  if (draft.knowledgePointId && draft.clusterSize === 1) {
    issues.push({ ruleId: "L8", severity: "info", message: "孤儿卡（该知识点下仅此一张）" });
  }
  if (!draft.dateStamp && CHANGEABLE.test(front + back)) {
    issues.push({ ruleId: "L12", severity: "info", message: "易变内容建议加 dateStamp（规则19）" });
  }
  // L13 前缀泄题：contextPrefix 的内容词与答案重叠（文档 §8.4 v10）
  const frontClean = front.replace(/\s/g, "");
  const backClean = back.replace(/\s/g, "");
  const prefix = (draft.contextPrefix || "").replace(/[:：\s]/g, "");
  if (prefix && prefix.length >= 2) {
    if (backClean.includes(prefix) || frontClean.replace(prefix, "").includes(prefix)) {
      issues.push({
        ruleId: "L13",
        severity: "warn",
        message: "前缀泄题：前缀与答案/问题内容重复，会直接提示答案（规则16）"
      });
    }
  }
  // L14 实体全名疑似缩略（R16 v10.1）：单字「X 说/认为/…」式姓氏引用，或中间点名单侧缺失
  const text = frontClean + backClean;
  if (/[\u4e00-\u9fa5]{1}(?=(说|指出|认为|主张|提出|批评|表示|写道|在《))/.test(text) && !/[•·]|\(|（/.test(text.slice(0, 30))) {
    // 粗筛：出现「单字+言说动词」且上下文无全名结构 — 提示确认
    issues.push({
      ruleId: "L14",
      severity: "warn",
      message: "疑似人名缩略（R16）：请确认使用完整全名（如「迈克尔·杨」而非「杨」）"
    });
  }
  return issues;
}

// ---------- 相似检索（§3.19） ----------
export const similaritySearch = {
  async findSimilar(cardText: string, k = 3) {
    return (await window.similarityAPI?.find(cardText, k)) ?? [];
  }
};

// ---------- 卡片持久化封装 ----------
export const cardsApi = {
  create: async (card: unknown) => (await window.cardsAPI?.create(card)) ?? { id: "" },
  update: async (card: unknown) => (await window.cardsAPI?.update(card)) ?? false,
  get: async (id: string) => ((await window.cardsAPI?.get(id)) ?? null) as CardRecord | null,
  listDue: async () => ((await window.cardsAPI?.listDue()) ?? []) as (CardRecord & { docTitle?: string })[],
  listAll: async () => ((await window.cardsAPI?.listAll()) ?? []) as CardRecord[],
  remove: async (id: string) => (await window.cardsAPI?.remove(id)) ?? false,
  review: async (cardId: string, fsrsState: unknown, rating: string, durationMs?: number) => {
    await window.cardsAPI?.review(cardId, fsrsState, rating, durationMs);
  },
  setSuspended: async (id: string, suspended: boolean, reason?: string) =>
    (await window.cardsAPI?.setSuspended(id, suspended, reason)) ?? false,
  updateLeech: async (id: string, patch: Record<string, unknown>) =>
    (await window.cardsAPI?.updateLeech(id, patch)) ?? false,
  resolveLeech: async (id: string, resolution: string, updates?: unknown) =>
    (await window.cardsAPI?.resolveLeech(id, resolution, updates)) ?? false,
  listLeech: async () => ((await window.cardsAPI?.listLeech()) ?? []) as CardRecord[],
  addIssue: async (issue: unknown) => (await window.issuesAPI?.add(issue)) ?? { id: "" },
  listIssues: async (cardId: string) => ((await window.issuesAPI?.list(cardId)) ?? []) as CardIssueRecord[],
  resolveIssue: async (id: string) => (await window.issuesAPI?.resolve(id)) ?? false,
  setBatchStatus: async (id: string, status: string) => {
    await window.batchesAPI?.setStatus(id, status);
  }
};

export interface CardRecord {
  id: string;
  noteText: string;
  cardType: string;
  clozeOrds: number[];
  cardOrd: number;
  frontMarkdown: string;
  backMarkdown: string;
  contextPrefix: string | null;
  contextRef: { documentId?: string; extractId?: string } | null;
  mnemonic: string | null;
  example: string | null;
  sourceRef: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp: string | null;
  priority: number;
  tags: string[];
  knowledgePointId: string | null;
  occlusionJson: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; assetPath: string } | null;
  fsrs: { state?: string; due?: number; lapses?: number };
  leech: { isLeech?: boolean; suspended?: boolean; suspendedAt?: number | null; resolution?: string } | null;
  generatedBy: string;
  genBatchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CardIssueRecord {
  id: string;
  card_id: string;
  rule_id: string;
  severity: string;
  message: string;
  source: string;
  status: string;
}
