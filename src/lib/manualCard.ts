import { cardsApi, lintCard, similaritySearch } from "./cards";
import type { OcclusionShape } from "./occlusion";

/** 手动建卡写入面（字段名照 `CardRecord`；写库时恒记 generatedBy="manual"） */
export interface CardUpsert {
  noteText: string;
  cardType: string;
  frontMarkdown: string;
  backMarkdown: string;
  clozeOrds: number[];
  cardOrd: number;
  occlusionJson: {
    rects: { x: number; y: number; w: number; h: number; ord: number }[];
    assetPath: string;
    shapes?: OcclusionShape[] | null;
  } | null;
  contextPrefix: string | null;
  contextRef: Record<string, unknown> | null;
  mnemonic: string | null;
  sourceRef: { title?: string } | null;
  dateStamp: string | null;
  priority: number;
  tags: string[];
  domain: string[];
  knowledgePointId: string | null;
  siblingKey: string | null;
}

export type CardLintInput = NonNullable<Parameters<typeof lintCard>[0]>;

export interface ManualCardInput {
  card: CardUpsert;
  lint: CardLintInput;
  /** 相似检索：缺省用 card.frontMarkdown 查、取前 2 条（与既有建卡链一致） */
  similarity?: { text?: string; k?: number };
}

/** 手动建卡三步：lint → 写库 → 逐条 addIssue → 相似检索记 S1。
 *  抽自 `Reader.tsx` 的 `createSingleCard`，三步顺序与文案原样未改。 */
export async function createManualCard(input: ManualCardInput): Promise<{ id: string }> {
  const { card, lint } = input;
  const issues = lintCard(lint);
  const created = await cardsApi.create({ ...card, generatedBy: "manual" });
  for (const issue of issues) {
    await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
  }
  const similar = await similaritySearch.findSimilar(
    input.similarity?.text ?? card.frontMarkdown,
    input.similarity?.k ?? 2
  );
  if (similar.length > 0) {
    await cardsApi.addIssue({
      cardId: created.id,
      ruleId: "S1",
      severity: "warn",
      message: `与已有卡相似（${Math.round(similar[0].score * 100)}%）：「${similar[0].front.slice(0, 30)}…」`,
      source: "lint"
    });
  }
  return created;
}
