// 阅读器注解面板数据面（D67 §3）的纯函数测试入口：只 import 纯函数，不碰 DOM/窗口。
// 位置序口径：PDF＝pageIndex + sourceAnchor.rects 首矩形几何；EPUB＝内核 resolve 出的文档序
// （getMarkOrder，不可解析的按稳定回退接在其后）；两者都不得借用 listAll 的 priority/到期序。
import { buildAnnotationItems } from "../src/lib/reader/marks";

type Result = { name: string; pass: boolean; detail?: string };

export async function run(): Promise<Result[]> {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: unknown) => {
    results.push({ name, pass, detail: detail == null ? "" : String(detail).slice(0, 300) });
  };
  const ids = (items: { id: string }[]) => items.map((i) => i.id).join(",");

  type Ctx = Record<string, unknown>;
  const row = (id: string, ctx: Ctx = {}, over: Record<string, unknown> = {}) => ({
    id,
    contentMarkdown: `正文-${id}`,
    comment: null,
    annotationColor: null,
    kind: "extract",
    createdAt: 1000,
    priority: 5,
    topicNextAt: 1,
    contextRef: { documentId: "doc-1", ...ctx },
    ...over
  });

  try {
    // ---- 行筛选：本文档的根摘录（排除他档、排除子摘录） ----
    const scope = buildAnnotationItems(
      [
        row("a-root", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] } }),
        row("x-other-doc", { sourceAnchor: { documentId: "doc-2", pageIndex: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] } }),
        row("c-child", { parentExtractId: "a-root", sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] } })
      ],
      "doc-1",
      "pdf"
    );
    check("只列本文档的根摘录", ids(scope) === "a-root", ids(scope));

    const kinds = buildAnnotationItems(
      [
        row("e-extract", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] } }, { comment: "写过的批注" }),
        row("h-highlight", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] } }, { kind: "highlight" })
      ],
      "doc-1",
      "pdf"
    );
    check(
      "摘录与纯高亮都在列且批注可空",
      kinds.length === 2 && kinds[0].kind === "extract" && kinds[0].comment === "写过的批注" && kinds[1].kind === "highlight" && kinds[1].comment === null,
      JSON.stringify(kinds.map((k) => [k.id, k.kind, k.comment]))
    );

    // ---- PDF 位置序：pageIndex → 首矩形 y → x ----
    const pdfOrder = buildAnnotationItems(
      [
        row("p-page2-y50", { sourceAnchor: { documentId: "doc-1", pageIndex: 2, rects: [{ x: 5, y: 50, w: 10, h: 4 }] } }),
        row("p-page0", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 5, y: 10, w: 10, h: 4 }] } }),
        row("p-page2-y10", { sourceAnchor: { documentId: "doc-1", pageIndex: 2, rects: [{ x: 5, y: 10, w: 10, h: 4 }] } })
      ],
      "doc-1",
      "pdf"
    );
    check("PDF 位置序＝页码 + 首矩形 y/x", ids(pdfOrder) === "p-page0,p-page2-y10,p-page2-y50", ids(pdfOrder));

    // 正对照：输入的 priority/到期序与位置序相反——位置序必须无视它们
    const priorityProbe = buildAnnotationItems(
      [
        row("late-priority999", { sourceAnchor: { documentId: "doc-1", pageIndex: 9, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } }, { priority: 999, topicNextAt: 1 }),
        row("early-priority1", { sourceAnchor: { documentId: "doc-1", pageIndex: 1, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } }, { priority: 1, topicNextAt: 99999 })
      ],
      "doc-1",
      "pdf"
    );
    check("位置序不借用 priority/到期序", ids(priorityProbe) === "early-priority1,late-priority999", ids(priorityProbe));

    // ---- 不可定位：仍在列、标中性态、稳定排在已定位之后 ----
    const pdfUnlocated = buildAnnotationItems(
      [
        row("old-no-rects", { pageIndex: 1 }, { annotationColor: "sky", comment: "老数据" }),
        row("anchored-b", { sourceAnchor: { documentId: "doc-1", pageIndex: 3, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } }),
        row("anchored-a", { sourceAnchor: { documentId: "doc-1", pageIndex: 2, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } })
      ],
      "doc-1",
      "pdf"
    );
    check(
      "PDF 无 rects 的老数据在列且排在已定位之后",
      ids(pdfUnlocated) === "anchored-a,anchored-b,old-no-rects" &&
        pdfUnlocated[2].locatable === false &&
        pdfUnlocated[0].locatable === true &&
        pdfUnlocated[2].comment === "老数据",
      JSON.stringify(pdfUnlocated.map((i) => [i.id, i.locatable]))
    );

    // ---- EPUB：位置序只认内核给出的可解析文档序；未解析的稳定排后 ----
    const epubOrder = buildAnnotationItems(
      [
        row("e1", { cfi: "epubcfi(/6/2)" }),
        row("e2", { cfi: "epubcfi(/6/4)" }),
        row("e3-stale", { cfi: "epubcfi(/6/999)" }),
        row("e4-no-cfi", { pageIndex: 0 })
      ],
      "doc-1",
      "foliate",
      ["e2", "e1", "ghost-not-in-rows"]
    );
    check(
      "EPUB 位置序＝内核文档序，未解析者稳定排后",
      ids(epubOrder) === "e2,e1,e3-stale,e4-no-cfi" &&
        epubOrder.find((i) => i.id === "e3-stale")?.locatable === true &&
        epubOrder.find((i) => i.id === "e4-no-cfi")?.locatable === false,
      JSON.stringify(epubOrder.map((i) => [i.id, i.locatable]))
    );

    const epubNoOrder = buildAnnotationItems(
      [row("e1", { cfi: "epubcfi(/6/2)" }), row("e2", { cfi: "epubcfi(/6/4)" })],
      "doc-1",
      "foliate"
    );
    check("EPUB 无内核文档序时保持稳定输入序", ids(epubNoOrder) === "e1,e2", ids(epubNoOrder));

    // ---- 时间与边界 ----
    const times = buildAnnotationItems(
      [
        row("t-with", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } }, { createdAt: 1712345678901 }),
        row("t-none", { sourceAnchor: { documentId: "doc-1", pageIndex: 0, rects: [{ x: 1, y: 1, w: 2, h: 2 }] } }, { createdAt: undefined })
      ],
      "doc-1",
      "pdf"
    );
    check("时间取 createdAt，缺省 0", times[0].time === 1712345678901 && times[1].time === 0, JSON.stringify(times.map((t) => t.time)));

    check("空文档 id 与坏行输入 → 空清单", buildAnnotationItems([row("a")], "", "pdf").length === 0 && buildAnnotationItems(null, "doc-1", "pdf").length === 0);
    return results;
  } catch (err) {
    check("buildAnnotationItems 可调用", false, err instanceof Error ? err.message : String(err));
    return results;
  }
}
