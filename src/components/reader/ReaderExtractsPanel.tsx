// 阅读器侧栏「注解」页签（D67 §3 / 样张 annotation-two-modes 对版）：本文档的**根摘录**清单，
// 形态＝与摘录页同一套批注栏（AnnotationPanel：筛选/排序/内联改批注/改色/二次确认删除）。
// 与摘录页的差别只有两处语义：①条目锚在**文档位置**上（整卡批注是摘录页的语义）；
// ②点条目走内核**精确 id 导航**（goToMark），不借 anchorText 文本搜索——老数据（无
// pageIndex+rects / 无 CFI）留在栏内、显示中性「不可定位」，不假称跳转成功。
import { useEffect, useMemo, useRef, useState } from "react";
import { eventBus } from "../../lib/eventbus";
import { readingWorkflow } from "../../lib/readingWorkflow";
import { buildAnnotationItems, type ReaderAnnotItem } from "../../lib/reader/marks";
import AnnotationPanel, { type AnnotFilter } from "./AnnotationPanel";

export default function ReaderExtractsPanel({
  documentId,
  engine,
  orderKey,
  getMarkOrder,
  filter,
  onFilter,
  palette,
  currentId,
  unavailableIds,
  onJump,
  onEdit,
  onColor,
  onDelete
}: {
  documentId: string | null;
  /** 引擎族：位置序策略不同（PDF 用数据面几何；EPUB 用内核文档序） */
  engine: "pdf" | "foliate";
  /** 内核文档序的版本号（安装/重画标记后 +1）——变了才重新取序 */
  orderKey: number;
  /** 内核文档序（EPUB：resolve 后的章节序 + Range 文档序） */
  getMarkOrder: () => string[];
  filter: AnnotFilter;
  onFilter: (f: AnnotFilter) => void;
  palette: readonly string[];
  /** 栏内高亮（刚跳过的条目，短时强调；不落库） */
  currentId?: string | null;
  /** 导航有界失败的条目 id（中性态显示，不假称成功） */
  unavailableIds?: readonly string[];
  /** 点条目：宿主走内核 goToMark(id) 精确导航 */
  onJump: (id: string) => void;
  onEdit: (id: string, comment: string | null) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const [items, setItems] = useState<ReaderAnnotItem[]>([]);
  const getOrderRef = useRef(getMarkOrder);
  getOrderRef.current = getMarkOrder;

  useEffect(() => {
    if (!documentId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const all = (await readingWorkflow.getAllTopics()) as unknown as Array<Record<string, unknown>>;
      if (cancelled) return;
      setItems(buildAnnotationItems(all, documentId, engine, getOrderRef.current()));
    };
    void load();
    const off = eventBus.on("workflow/changed", () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [documentId, engine, orderKey]);

  const shown = useMemo(() => {
    if (!unavailableIds?.length) return items;
    const bad = new Set(unavailableIds);
    return items.map((it) => (bad.has(it.id) ? { ...it, locatable: false } : it));
  }, [items, unavailableIds]);

  return (
    <AnnotationPanel
      items={shown}
      currentId={currentId ?? null}
      filter={filter}
      onFilter={onFilter}
      palette={palette}
      onJump={(it) => onJump(it.id)}
      onEdit={(it, comment) => onEdit(it.id, comment)}
      onColor={(it, color) => onColor(it.id, color)}
      onDelete={(it) => onDelete(it.id)}
      /* 栏宽由右侧栏给（280px 的栏内容宽 279）：面板随栏宽，不写死 280 */
      width="100%"
    />
  );
}
