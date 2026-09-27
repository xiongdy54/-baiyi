// 阅读器侧栏「摘录」页签（批 4 Task 15，规格 §5.3）：本文档的摘录清单，点条目跳回原文锚点。
// 与摘录页的批注栏（AnnotationPanel）分属两处：这里列的是**本文档的根摘录**（阅读器视角），
// 栏内编辑/改色/删除属批注栏的职责，本面板只做「看 + 跳」。
import { useEffect, useState } from "react";
import { eventBus } from "../../lib/eventbus";
import { readingWorkflow } from "../../lib/readingWorkflow";

interface DocExtract {
  id: string;
  text: string;
  comment: string | null;
  color: string | null;
  kind: "highlight" | "extract";
  anchorText: string;
  pageIndex?: number;
  cfi?: string;
}

export default function ReaderExtractsPanel({
  documentId,
  onJump
}: {
  documentId: string | null;
  /** 点条目的落点：锚点文本/页码/CFI（由宿主交给引擎定位） */
  onJump: (anchorText: string, pageIndex?: number, cfi?: string) => void;
}) {
  const [items, setItems] = useState<DocExtract[]>([]);

  useEffect(() => {
    if (!documentId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const all = (await readingWorkflow.getAllTopics()) as unknown as Array<Record<string, unknown>>;
      if (cancelled) return;
      const mine = all
        .filter((r) => {
          const ctx = (r.contextRef ?? null) as { documentId?: string } | null;
          return String(ctx?.documentId ?? r.documentId ?? "") === documentId;
        })
        .map((r) => {
          const ctx = (r.contextRef ?? null) as { anchorText?: string; pageIndex?: number; cfi?: string } | null;
          return {
            id: String(r.id),
            text: String(r.contentMarkdown ?? ""),
            comment: (r.comment as string | null) ?? null,
            color: (r.annotationColor as string | null) ?? null,
            kind: (r.kind === "highlight" ? "highlight" : "extract") as "highlight" | "extract",
            anchorText: String(ctx?.anchorText ?? r.contentMarkdown ?? "").slice(0, 60),
            pageIndex: ctx?.pageIndex,
            cfi: ctx?.cfi
          };
        });
      setItems(mine);
    };
    void load();
    const off = eventBus.on("workflow/changed", () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [documentId]);

  return (
    <div className="reader-extracts" data-reader-extracts>
      {items.length === 0 && <p className="reader-toc-empty">本文档还没有摘录。</p>}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="reader-extract-item"
          data-reader-extract={it.id}
          onClick={() => onJump(it.anchorText, it.pageIndex, it.cfi)}
          title={it.text}
        >
          <span className={`mark-kind${it.kind === "extract" ? " k-extract filled" : " k-extract"}`} aria-hidden="true" />
          <span className="reader-extract-text">{it.text || it.anchorText || "(无正文)"}</span>
        </button>
      ))}
    </div>
  );
}
