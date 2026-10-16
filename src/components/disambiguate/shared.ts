// D121 §3 辨析弹窗共享的取数/展示小函数（无 React）
import type { CardRecord } from "../../lib/cards";
import { ORIGIN_MAX } from "../../lib/disambiguateUi";
import { t } from "../../lib/i18n";

export type CardWithTitle = CardRecord & { docTitle?: string };

export interface CardSource {
  title: string;
  author: string;
  /** 章节锚文本（contextRef.anchorText 前 30 字，折叠空白） */
  anchor: string;
}

export function sourceOf(card: CardWithTitle): CardSource {
  const title = String(card.sourceRef?.title || card.docTitle || "").trim();
  const author = String(card.sourceRef?.author || "").trim();
  const anchorRaw = String(card.contextRef?.anchorText || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(anchorRaw);
  const anchor = chars.length > 30 ? chars.slice(0, 30).join("") + "…" : anchorRaw;
  return { title, author, anchor };
}

/** 「《书名》· 作者」展示串；无书名 → 「来源未知」 */
export function sourceLabel(src: CardSource): string {
  if (!src.title) return t("来源未知");
  return t("《{title}》{author}", { title: src.title, author: src.author ? ` · ${src.author}` : "" });
}

/**
 * §3.2 原文：genBatchId → batchesAPI.get(id).sourceText（≤1500 字）；否则 contextRef.anchorText；都无 → null。
 * 取数失败按「无批次」回落到 anchorText。
 */
export async function loadOrigin(card: CardRecord): Promise<string | null> {
  if (card.genBatchId) {
    try {
      const b = await window.batchesAPI?.get?.(card.genBatchId);
      const t = typeof b?.sourceText === "string" ? b.sourceText.trim() : "";
      if (t) return Array.from(t).slice(0, ORIGIN_MAX).join("");
    } catch {
      /* 回落 anchorText */
    }
  }
  const anchor = String(card.contextRef?.anchorText || "").trim();
  return anchor ? Array.from(anchor).slice(0, ORIGIN_MAX).join("") : null;
}

export function isArchived(card: { status?: string | null }): boolean {
  return card.status === "archived";
}
