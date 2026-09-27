// 文中留痕的数据面（v48.24 批3 §4）：**哪些摘录要在阅读器里画标记**、浮层要显示什么。
// 纯函数、零 DOM、零 IO：只吃 workflowAPI.listAll() 的行与「按 extractId 派生」的已制卡计数。
//
// 口径（规格 §4-3）：只画 `sourceAnchor.documentId` 等于当前文档的**根摘录**——
// 子摘录的锚在父卡文本里（`contextRef.parentRange`），不在文档上，回父卡查看态时另有高亮。
// 老数据（本批之前创建、还没有 sourceAnchor 的根摘录）退回 `contextRef` 顶层同义键：
// EPUB 有 cfi 就能画；PDF 没有 rects 画不了（只有 pageIndex + anchorText 的旧摘录不画，别硬凑）。
import type { ReaderDocMark } from "./kernel";

/** sourceAnchor（§6.8-11 三条腿的容器形态）；老数据没有它时退回 contextRef 顶层键 */
type AnchorLike = {
  documentId?: unknown;
  pageIndex?: unknown;
  rects?: unknown;
  cfi?: unknown;
};

type ExtractRow = {
  id?: unknown;
  contentMarkdown?: unknown;
  comment?: unknown;
  annotationColor?: unknown;
  kind?: unknown;
  contextRef?: (Record<string, unknown> & { sourceAnchor?: AnchorLike; parentExtractId?: unknown }) | null;
};

/** 百分比矩形（0-100，与 occlusion 同口径）：只收有限数、宽高为正的项；ord 按序重编 */
export function normalizeMarkRects(raw: unknown): { x: number; y: number; w: number; h: number; ord: number }[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: { x: number; y: number; w: number; h: number; ord: number }[] = [];
  for (const item of list) {
    const r = (item ?? {}) as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (![x, y, w, h].every((v) => Number.isFinite(v))) continue;
    if (w <= 0 || h <= 0) continue;
    out.push({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      w: Math.max(0, Math.min(100 - Math.max(0, x), w)),
      h: Math.max(0, Math.min(100 - Math.max(0, y), h)),
      ord: out.length
    });
  }
  return out;
}

/**
 * 本档案要画的标记清单（顺序＝落库顺序，与绘制无关）。
 * @param rows workflowAPI.listAll() 的原样行（contextRef 已解析）
 * @param documentId 当前阅读的文档 id
 * @param engine "pdf" 要有 pageIndex + rects；"foliate" 要有 cfi
 * @param cardCounts extractId → 已制卡数（壳层按 cards 的 contextRef.extractId 派生）
 */
export function buildDocMarks(
  rows: unknown,
  documentId: string,
  engine: "pdf" | "foliate",
  cardCounts: Record<string, number> = {}
): ReaderDocMark[] {
  if (!documentId) return [];
  const out: ReaderDocMark[] = [];
  for (const raw of Array.isArray(rows) ? (rows as ExtractRow[]) : []) {
    const id = String(raw?.id ?? "");
    const ctx = raw?.contextRef ?? null;
    if (!id || !ctx || typeof ctx !== "object") continue;
    // 子摘录（有父）锚在父卡文本里，不画在文档上
    if (ctx.parentExtractId) continue;
    const anchor: AnchorLike | null =
      ctx.sourceAnchor && typeof ctx.sourceAnchor === "object" ? (ctx.sourceAnchor as AnchorLike) : null;
    const anchorDoc = String(anchor?.documentId ?? ctx.documentId ?? "");
    if (!anchorDoc || anchorDoc !== documentId) continue;
    const text = String(raw?.contentMarkdown ?? "");
    if (!text.trim()) continue;
    const comment = raw?.comment != null && String(raw.comment).trim() ? String(raw.comment) : null;
    // 批 4 Task 16：角标跟色（§5.2 硬约束①）与分族（纯高亮不画角标，§5.4）
    const color = raw?.annotationColor != null && String(raw.annotationColor).trim() ? String(raw.annotationColor) : null;
    const kind: "highlight" | "extract" = raw?.kind === "highlight" ? "highlight" : "extract";
    if (engine === "pdf") {
      const pageIndex = Number(anchor?.pageIndex ?? ctx.pageIndex);
      const rects = normalizeMarkRects(anchor?.rects);
      if (!Number.isFinite(pageIndex) || pageIndex < 0 || rects.length === 0) continue;
      out.push({ id, text, comment, color, kind, cardCount: cardCounts[id] ?? 0, pageIndex, rects });
    } else {
      const cfi = String(anchor?.cfi ?? ctx.cfi ?? "");
      if (!cfi) continue;
      out.push({ id, text, comment, color, kind, cardCount: cardCounts[id] ?? 0, cfi });
    }
  }
  return out;
}
