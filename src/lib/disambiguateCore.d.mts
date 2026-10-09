// disambiguateCore.mjs 的类型声明（渲染层导入用；实现见同名 .mjs——主进程/测试/渲染层单一真源）
export type DisambiguateVerdict =
  | "missing-qualifier"
  | "one-wrong"
  | "duplicate"
  | "confusable"
  | "no-conflict"
  | "insufficient"
  | "manual";
export type DisambiguateCardSide = "A" | "B";
export type DisambiguateField = "contextPrefix" | "front" | "back";

export const VERDICTS: DisambiguateVerdict[];
export const VERDICT_LABELS: Record<DisambiguateVerdict, string>;

export interface DisambiguateCandidateCard {
  id: string;
  cardType?: string;
  frontMarkdown?: string | null;
  noteText?: string | null;
  backMarkdown?: string | null;
  knowledgePointId?: string | null;
  genBatchId?: string | null;
  domain?: string[] | null;
  contextRef?: { documentId?: string | null } | null;
  sourceRef?: { title?: string | null } | null;
  docTitle?: string | null;
  isDeleted?: boolean | number | null;
  status?: string | null;
}
export interface RankedCandidate {
  id: string;
  score: number;
  archived: boolean;
}

export function normalizeText(s: string | null | undefined): string;
export function bigramJaccard(a: string | null | undefined, b: string | null | undefined): number;
export function rankDisambiguationCandidates(
  base: DisambiguateCandidateCard,
  all: DisambiguateCandidateCard[],
  k?: number
): RankedCandidate[];

export interface DisambiguateSide {
  prefix?: string | null;
  front?: string | null;
  back?: string | null;
  sourceTitle?: string | null;
  author?: string | null;
  anchor?: string | null;
  original?: string | null;
}
export function buildDisambiguateInput(args: { a: DisambiguateSide; b: DisambiguateSide | null }): string;

export interface DisambiguateFieldValues {
  contextPrefix?: string | null;
  front?: string | null;
  back?: string | null;
}
export interface DisambiguateEvidence {
  card: DisambiguateCardSide;
  quote: string;
  verified: boolean;
}
export interface DisambiguateFix {
  card: DisambiguateCardSide;
  field: DisambiguateField;
  after: string;
}
export interface DisambiguateResult {
  verdict: DisambiguateVerdict;
  explanation: string;
  evidence: DisambiguateEvidence[];
  fixes: DisambiguateFix[];
  wrongCard: DisambiguateCardSide | null;
  keepCard: DisambiguateCardSide | null;
}
export function validateDisambiguateOutput(
  raw: string,
  opts: {
    hasB: boolean;
    originA: string | null;
    originB: string | null;
    current: { A: DisambiguateFieldValues; B: DisambiguateFieldValues | null };
  }
): DisambiguateResult;
