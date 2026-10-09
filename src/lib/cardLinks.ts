// D121 §1.2：卡片辨析链接（card_links）渲染层封装。
// 只是展示/溯源用结构数据：不参与 FSRS、不参与队列。API 缺失（浏览器预览等）时优雅降级。

export type CardLinkVerdict =
  | "missing-qualifier"
  | "one-wrong"
  | "duplicate"
  | "confusable"
  | "no-conflict"
  | "insufficient"
  | "manual";

export interface CardLinkOther {
  id: string;
  /** 对端卡题面（空白折叠，≤60 字） */
  front: string;
  docTitle: string | null;
}

export interface CardLink {
  id: string;
  cardA: string;
  /** 单卡辨析为 null */
  cardB: string | null;
  verdict: CardLinkVerdict | null;
  note: string;
  createdAt: number;
  updatedAt: number;
  /** 对端卡；单卡链接为 null */
  other: CardLinkOther | null;
}

export interface CardLinkInput {
  cardA: string;
  cardB: string | null;
  verdict: CardLinkVerdict;
  note?: string;
}

declare global {
  interface Window {
    cardLinksAPI?: {
      add: (input: CardLinkInput) => Promise<string>;
      update: (id: string, patch: { verdict: CardLinkVerdict; note?: string }) => Promise<boolean>;
      listForCard: (cardId: string) => Promise<CardLink[]>;
    };
  }
}

export const cardLinksApi = {
  /** 新增链接，返回 id；API 缺失返回 null。非法入参由主进程抛错（调用方自行 catch）。 */
  async add(input: CardLinkInput): Promise<string | null> {
    if (!window.cardLinksAPI) return null;
    return window.cardLinksAPI.add(input);
  },
  /** 更新同一链接（同一弹窗会话只写一条）；API 缺失或链接不存在返回 false。 */
  async update(id: string, patch: { verdict: CardLinkVerdict; note?: string }): Promise<boolean> {
    if (!window.cardLinksAPI) return false;
    return window.cardLinksAPI.update(id, patch);
  },
  /** 该卡作为 a 或 b 的未删除链接（对端已软删则不含）；API 缺失返回 []。 */
  async listForCard(cardId: string): Promise<CardLink[]> {
    if (!window.cardLinksAPI) return [];
    const r = await window.cardLinksAPI.listForCard(cardId);
    return Array.isArray(r) ? r : [];
  }
};
