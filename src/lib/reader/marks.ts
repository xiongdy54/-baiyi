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
  annotationType?: unknown;
  kind?: unknown;
  createdAt?: unknown;
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
 * @param cardCounts extractId → 已制卡数（**聚合口径**，v48.45/D85：自身 + 全部子孙摘录的卡；
 *        壳层按直卡数经 `aggregateCardCounts` 派生）
 */
/** 阅读器注解面板条目（D67 §3）：数据面只认 listAll 行，导航/绘制由内核另行负责。
 *  `anchorWhole` 恒 false——阅读器视角里每条都锚在文档位置上（整卡批注是摘录页的语义）。 */
export interface ReaderAnnotItem {
  id: string;
  kind: "highlight" | "extract";
  quote: string;
  comment: string | null;
  color: string | null;
  /** 生成时间（毫秒；取行 createdAt，缺失 0）——面板「时间」排序用 */
  time: number;
  anchorWhole: false;
  /** 有可解析的定位锚（EPUB：cfi；PDF：pageIndex + rects）——无锚行在栏内显示中性「不可定位」 */
  locatable: boolean;
}

/**
 * 注解面板的条目清单（顺序＝**位置序**，面板的「位置」排序直接用传入序）。
 * 位置序必须可复核，**不得**借用 listAll 的 priority/到期序：
 * - PDF：`pageIndex` → `sourceAnchor.rects` 首矩形 y → x；
 * - EPUB：`markOrder`＝内核 resolve 出的文档序（章节序 + Range 文档序，见 `getMarkOrder`），
 *   未在内核文档序里的（老 CFI 解不动 / 章节未加载）按稳定回退接在已定位之后。
 * 两侧的「位置不可解析」老数据都稳定排在已定位之后，仍可时间排序、仍显示「不可定位」中性态。
 */
export function buildAnnotationItems(
  rows: unknown,
  documentId: string,
  engine: "pdf" | "foliate",
  markOrder: readonly string[] = []
): ReaderAnnotItem[] {
  if (!documentId) return [];
  const located: { item: ReaderAnnotItem; key: number[] }[] = [];
  const later: ReaderAnnotItem[] = [];
  const epubRank = new Map<string, number>();
  markOrder.forEach((id, i) => {
    if (!epubRank.has(id)) epubRank.set(id, i);
  });

  for (const raw of Array.isArray(rows) ? (rows as ExtractRow[]) : []) {
    const id = String(raw?.id ?? "");
    const ctx = raw?.contextRef ?? null;
    if (!id || !ctx || typeof ctx !== "object") continue;
    // 子摘录的锚在父卡文本里，不在文档上（与 buildDocMarks 同规）
    if (ctx.parentExtractId) continue;
    const anchor: AnchorLike | null =
      ctx.sourceAnchor && typeof ctx.sourceAnchor === "object" ? (ctx.sourceAnchor as AnchorLike) : null;
    const anchorDoc = String(anchor?.documentId ?? ctx.documentId ?? "");
    if (!anchorDoc || anchorDoc !== documentId) continue;
    const createdAt = Number(raw?.createdAt);
    const item: ReaderAnnotItem = {
      id,
      kind: raw?.kind === "highlight" ? "highlight" : "extract",
      quote: String(raw?.contentMarkdown ?? ""),
      comment: raw?.comment != null && String(raw.comment).trim() ? String(raw.comment) : null,
      color: raw?.annotationColor != null && String(raw.annotationColor).trim() ? String(raw.annotationColor) : null,
      time: Number.isFinite(createdAt) ? createdAt : 0,
      anchorWhole: false,
      locatable: false
    };
    if (engine === "pdf") {
      const pageIndex = Number(anchor?.pageIndex ?? ctx.pageIndex);
      const rects = normalizeMarkRects(anchor?.rects);
      if (Number.isFinite(pageIndex) && pageIndex >= 0 && rects.length > 0) {
        item.locatable = true;
        located.push({ item, key: [pageIndex, rects[0].y, rects[0].x] });
      } else {
        later.push(item);
      }
    } else {
      if (String(anchor?.cfi ?? ctx.cfi ?? "")) item.locatable = true;
      const rank = epubRank.get(id);
      if (rank != null) located.push({ item, key: [rank] });
      else later.push(item);
    }
  }

  // 等键保持输入序（sort 稳定）；同位置多条按落库序，不引入任何时间/优先级判据
  located.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    }
    return 0;
  });
  return [...located.map((l) => l.item), ...later];
}

/**
 * 已制卡数的**聚合口径**（v48.45 / D85，用户点名）：`已制卡 N 张` 不只算这条高亮直接产生的卡，
 * 还要算它的摘录、子摘录、子子摘录…**全部后代**上的卡。输入＝按 `contextRef.extractId` 直卡的
 * 直卡数（extractId → 卡数）+ 父→子邻接表（摘录行的 `contextRef.parentExtractId`），输出＝
 * 每个摘录 id 的聚合卡数（自身直卡 + 全部后代的直卡）。记忆化 DFS、带访问集防环（脏数据不自旋）。
 */
export function aggregateCardCounts(
  counts: Record<string, number>,
  parentToChildren: ReadonlyMap<string, readonly string[]>
): Record<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const walk = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 环：只算已入栈节点的直卡，不再下钻
    visiting.add(id);
    let total = counts[id] ?? 0;
    for (const child of parentToChildren.get(id) ?? []) total += walk(child);
    visiting.delete(id);
    memo.set(id, total);
    return total;
  };
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(counts), ...parentToChildren.keys()])) out[id] = walk(id);
  return out;
}

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
    // v48.41（D81）：标记形式（underline＝透明底+色线；其余/旧数据＝底色）
    const annotationType: "highlight" | "underline" = raw?.annotationType === "underline" ? "underline" : "highlight";
    if (engine === "pdf") {
      const pageIndex = Number(anchor?.pageIndex ?? ctx.pageIndex);
      const rects = normalizeMarkRects(anchor?.rects);
      if (!Number.isFinite(pageIndex) || pageIndex < 0 || rects.length === 0) continue;
      out.push({ id, text, comment, color, kind, annotationType, cardCount: cardCounts[id] ?? 0, pageIndex, rects });
    } else {
      const cfi = String(anchor?.cfi ?? ctx.cfi ?? "");
      if (!cfi) continue;
      out.push({ id, text, comment, color, kind, annotationType, cardCount: cardCounts[id] ?? 0, cfi });
    }
  }
  return out;
}
