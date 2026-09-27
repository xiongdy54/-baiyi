import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ExtractCardFace, { parseQuoteRanges } from "./ExtractCardFace";
import SelectionMenu, { ANNOT_COLORS, type AnnotColor, type AnnotMode } from "./SelectionMenu";
import SelectionPanels from "./SelectionPanels";
import AnnotationEditor from "./AnnotationEditor";
import AnnotationPanel, { type AnnotItem, type AnnotFilter } from "./reader/AnnotationPanel";
import { useAnnotationSettings, writeAnnotationSetting } from "../lib/annotationSettings";
import { cardsApi } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { readingWorkflow, undoApi, type DueTopic, type ExtractDetail } from "../lib/readingWorkflow";
import { extractSettings, fetchSessionQueue, type ExtractEngine, type Limits, type ScopeFilter } from "../lib/sessionQueue";
import { useSelectionActions } from "../lib/useSelectionActions";
import { createMultiHighlight } from "../lib/reader/multiHighlight";

/** 选区快照（卡面 onSelection 回调的载荷；null＝无选区） */
type FaceSelection = { rect: { x: number; y: number; width: number; height: number }; ranges: Array<{ start: number; end: number }>; text: string } | null;

interface Props {
  onOpen: (extractId: string) => void;
  onJumpToDoc?: (
    docId: string,
    anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number; pageIndex?: number },
    returnTo?: "review" | "queue" | "browse"
  ) => void;
  /** 本书范围（阅读器入口）；缺省＝全部到期摘录（顶栏「摘录」入口） */
  bookItemIds?: string[];
  /** 筛选牌组的上限覆写（§6.8-5：只收紧，不另开预算） */
  scopeLimits?: Record<string, number> | null;
  /** 顶部一行上下文（如「集中复习：《书名》」） */
  header?: string;
  onExit?: () => void;
  /**
   * 规格 §1.2：在摘录页就地另立子摘录——**当前摘录 id 与所选文字在本卡里的偏移由卡面采集**（它持有队列头与正文 DOM）。
   * App 拿到 parentExtractId / parentRange 后解析父摘录的 documentId 与 rootExtractId 再落库（唯一一处写 contextRef）。
   */
  onExtract?: (
    text: string,
    ctx: { parentExtractId: string; parentRange: Array<{ start: number; end: number }> }
  ) => void;
}

/** 面包屑折叠口径（用户 2026-09-25 修订，取代原「超 4 级」）：≤6 级全显示；>6 级才折叠 */
const CRUMB_FOLD_AT = 6;
/** 折叠时保留的末两级（形态：原文 › 第1层 › …N 级 › 末两级 › 当前） */
const CRUMB_KEEP_TAIL = 2;
/** 层级名＝该层正文首 10 字（规格 §1.2：8–12 字），超出省略 */
const CRUMB_NAME_LEN = 10;

/** 层级名：压掉换行、取首 N 字，超出补省略号 */
export function crumbName(text?: string | null): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > CRUMB_NAME_LEN ? `${t.slice(0, CRUMB_NAME_LEN)}…` : t;
}

/**
 * 面包屑的显示切分（纯函数，便于按口径复核）：
 * 全显示＝整条链；折叠＝首层 + 被隐藏的中间层 + 末两级。
 */
export function splitChain(chain: Array<{ id: string; text: string; depth: number }>) {
  const n = chain.length;
  if (n <= CRUMB_FOLD_AT) return { head: chain, hidden: [] as typeof chain, tail: [] as typeof chain };
  return {
    head: chain.slice(0, 1),
    hidden: chain.slice(1, n - CRUMB_KEEP_TAIL),
    tail: chain.slice(n - CRUMB_KEEP_TAIL)
  };
}

/**
 * 沉浸式摘录连续处理页（v48.22 / D58 §6.8）：一屏一条、连续推进，正文可就地编辑。
 * 与复习页共用同一张卡面组件；调度语义＝SuperMemo（下一条＝读后推进、推迟＝指定天数）。
 * 只消费 §4.2-26 的会话队列（禁止自行归并）。
 * 规格 §1.2 R13（面包屑）：左上角面包屑「原文 › 第1层 › … › 当前」——点任一层＝切到该层卡片
 * （查看态，只读、不推进调度、不改队列，出口＝「返回队列」）；>6 级折叠成「…N 级」，点开逐项可达。
 */
export default function ExtractReviewView({ onOpen, onJumpToDoc, bookItemIds, scopeLimits, header, onExit, onExtract }: Props) {
  const [items, setItems] = useState<DueTopic[]>([]);
  const [engine, setEngine] = useState<ExtractEngine>("sm19-default");
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  /** 面包屑层级链（自根到当前；随显示中的卡片变化） */
  const [chain, setChain] = useState<Array<{ id: string; text: string; depth: number }>>([]);
  /** 查看态：面包屑点开的某层卡片（不在队列里也照样渲染；null＝正常会话） */
  const [viewing, setViewing] = useState<ExtractDetail | null>(null);
  /**
   * 查看态的「要呈现的范围」（工单 ②）：来自子摘录 contextRef.parentRange（子卡「跳转原文」回父卡时）。
   * null＝用该层**自身**的 quote_range_json（面包屑逐级保持既有行为）。
   */
  const [viewRanges, setViewRanges] = useState<Array<{ start: number; end: number }> | null>(null);
  const [crumbOpen, setCrumbOpen] = useState(false);
  const crumbRef = useRef<HTMLDivElement | null>(null);
  /** 批 4 Task 10：卡面正文里的当前选区（菜单锚点与动作文本都取自它；无选区＝null） */
  const [faceSel, setFaceSel] = useState<FaceSelection>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  // 选区高亮＝CSS Custom Highlight API（宿主文档实例：本页正文就在宿主里，不碰 DOM——§3.3b）
  const multiHighlightRef = useRef<ReturnType<typeof createMultiHighlight> | null>(null);
  if (!multiHighlightRef.current) {
    multiHighlightRef.current = createMultiHighlight({
      currentDoc() {
        const sel = window.getSelection();
        return sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim() ? document : null;
      }
    });
  }


  /** 批 4 Task 11：正在编辑的批注（新建或点已有条目进入；null＝无浮层） */
  const [editing, setEditing] = useState<{
    id: string;
    kind: "highlight" | "extract";
    comment: string | null;
    color: string | null;
    quote: string;
    anchor: { x: number; y: number; width: number; height: number };
  } | null>(null);

  /** 批 4 Task 12：模式与色板取自设置键（与阅读器同一份读侧；改设置即时生效） */
  const annotSettings = useAnnotationSettings();
  const annotMode = annotSettings.annotateMode;
  const setAnnotMode = (m: AnnotMode) => void writeAnnotationSetting("annotateMode", m);
  const ANNOT_PALETTE: readonly AnnotColor[] = annotSettings.annotatePalette as readonly AnnotColor[];
  const annotFilter: AnnotFilter = annotSettings.annotationFilter;

  const scope = useMemo<ScopeFilter>(
    () => ({
      kinds: ["extract"],
      bookItemIds: bookItemIds && bookItemIds.length ? bookItemIds : undefined,
      limits: scopeLimits && Object.keys(scopeLimits).length ? (scopeLimits as Partial<Limits>) : undefined
    }),
    [bookItemIds, scopeLimits]
  );

  const refresh = useCallback(async () => {
    const [q, prefs] = await Promise.all([fetchSessionQueue({ scope }), extractSettings.read()]);
    setItems((q?.extracts ?? []) as DueTopic[]);
    setEngine(prefs.engine);
    setLoaded(true);
    // 撤销可用性：**空态也必须可达**（处理完最后一条后仍要能 Ctrl+Z / 点「撤销最近一次操作」）
    try {
      const info = await undoApi.info();
      setUndoAvailable(Boolean(info?.available));
    } catch {
      setUndoAvailable(false);
    }
    // 派生信息：这条摘录已经制过几张卡（按 contextRef.extractId 关联，§4.2-16 上下文引用）
    try {
      const all = await cardsApi.listAll();
      const counts: Record<string, number> = {};
      for (const c of all as Array<{ contextRef?: { extractId?: string } | null; isDeleted?: number }>) {
        const id = c?.contextRef?.extractId;
        if (id) counts[id] = (counts[id] || 0) + 1;
      }
      setCardCounts(counts);
    } catch {
      /* 计数是增强信息，失败不影响处理 */
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
    return eventBus.on("workflow/changed", () => void refresh());
  }, [refresh]);

  const current = items[0] || null;
  /** 面包屑描述的是**正在显示**的那张卡：会话态＝队列头；查看态＝被点开的那层 */
  const shown = viewing ?? current;
  const shownId = shown?.id ?? null;

  /** 批 4 Task 13/14：当前卡的注解清单（含纯高亮）；栏的出现条件＝≥1 条 */
  const [annots, setAnnots] = useState<AnnotItem[]>([]);
  const annotsFor = shown?.id ?? null;
  useEffect(() => {
    if (!annotsFor) {
      setAnnots([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const all = (await readingWorkflow.getAllTopics()) as unknown as Array<Record<string, unknown>>;
      if (cancelled) return;
      const rows = all.map((r) => ({
        id: String(r.id),
        kind: (r.kind === "highlight" ? "highlight" : "extract") as "highlight" | "extract",
        quote: String(r.contentMarkdown ?? ""),
        comment: (r.comment as string | null) ?? null,
        color: (r.annotationColor as string | null) ?? null,
        time: Number(r.createdAt ?? 0),
        parentId: String((r as { parentId?: unknown }).parentId ?? ""),
        hasRange: parseQuoteRanges(r.quoteRangeJson).length > 0
      }));
      // 段锚注解＝挂在本卡名下的子行（R33）；本卡自身的行另算（整卡批注）
      const children = rows
        .filter((r) => r.parentId === annotsFor)
        .sort((a, b) => a.time - b.time);
      // 整卡批注（R32/§5.4）＝**本卡自身**的批注文字：它是「本条是什么」的元批注，恒置顶。
      // 注意：本卡自身那一行**本身带 quoteRangeJson**（它就是一条摘录），不能按 hasRange 判——
      // 判据是「id === 当前卡」。
      const self = rows.find((r) => r.id === annotsFor);
      const wholeItem = self && self.comment
        ? [{
            id: self.id,
            kind: self.kind,
            quote: self.quote,
            comment: self.comment,
            color: self.color,
            time: self.time,
            anchorWhole: true
          }]
        : [];
      setAnnots([
        ...wholeItem,
        ...children.map((r) => ({ ...r, anchorWhole: false }))
      ]);
    };
    void load();
    const off = eventBus.on("workflow/changed", () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [annotsFor]);

  /** 批 4 Task 14：栏的出现条件＝当前卡 ≥1 条注解（出现即占位 280px） */
  const annotPanelVisible = annots.length > 0 && !viewing;

  /**
   * 批 4 Task 10（规格 §3 / §4）：摘录页的选区动作编排与阅读器复用同一个钩子。
   * 宿主注入面按摘录页的实际能力给：正文＝卡面（不是内核），故 selectionText/spans 取自卡面回调，
   * 定位锚用卡面正文的 documentId/extractId；图片挖空在摘录页不存在（不注入 focus）。
   */
  const sourceTextRef = useRef("");
  const selActions = useSelectionActions({
    selectionText: () => faceSel?.text ?? null,
    selectionSpans: () => faceSel?.ranges.map((r) => ({ text: "" })),
    contextRef: () => (shown?.contextRef ? { ...shown.contextRef } : null),
    sourceContext: () => ({
      documentId: shown?.contextRef?.documentId,
      extractId: shown?.contextRef?.extractId ?? undefined
    }),
    labels: { title: shown?.docTitle, sourceTitle: shown?.docTitle, section: undefined },
    ownerKey: () => shown?.contextRef?.documentId ?? "",
    itemId: null,
    sourceTextRef,
    bodyText: String(shown?.contentMarkdown ?? ""),
    lookupLocator: () => ({ cfi: null, pageIndex: null }),
    anchorText: () => shown?.contextRef?.anchorText ?? null,
    rememberAnchor: () => {
      /* 摘录页不落跳转锚：正文就是本条摘录本身，跳转目标由 contextRef 决定 */
    },
    clearSelection: () => {
      window.getSelection()?.removeAllRanges();
      multiHighlightRef.current?.clear();
      setFaceSel(null);
    },
    clearAnchor: () => {
      /* 摘录页无制卡锚点（正文即锚） */
    },
    occlusionSourceRef: { current: "engine" },
    showToast: (msg) => {
      setFlash(msg);
      window.setTimeout(() => setFlash(null), 1800);
    },
    // 摘录页的选区就是「卡面里选中的那段」：快照面由卡面 onSelection 提供（faceSel），
    // 但菜单/面板的点击会先触发卡面 mouseup——动作面点击已豁免（见 ExtractCardFace.onUp）。
    buildSourceAnchor: () => null,
    /** 规格 §3.4：摘录页的批注/高亮恒挂在**当前卡**上（parentRange＝所选区间） */
    annotateParent: () => {
      if (!shown?.id || !shown.contextRef?.documentId) return null;
      return {
        parentType: "extract" as const,
        parentId: shown.id,
        documentId: shown.contextRef.documentId,
        ranges: faceSel?.ranges
      };
    },
    focus: {
      get: () => null,
      close: () => {},
      setBusy: () => {}
    }
  });
  const { createAnnotation } = selActions;
  // 卡面选区变化：画/撤选区高亮（绘制层，不碰正文 DOM——§3.3b）
  useEffect(() => {
    const mh = multiHighlightRef.current;
    if (!mh) return;
    if (faceSel) mh.update("replace");
    else mh.clear();
  }, [faceSel]);

  /**
   * R38/R40：点色＝完成当前模式的动作（颜色不记）。
   * 摘录页按规格 §3.4 把批注/高亮挂在当前卡上（annotateParent 已在适配器里给定）；
   * 落库后**接着弹批注编辑浮层**（R40：写了批注 → 落带批注那条；没写 → 失焦即落无批注那条）。
   */
  async function handlePickColor(color: AnnotColor) {
    const sel = faceSel;
    if (!sel) return;
    multiHighlightRef.current?.clear();
    setFaceSel(null);
    window.getSelection()?.removeAllRanges();
    const newId = await createAnnotation(sel.text, undefined, color, annotMode);
    if (newId) {
      setEditing({
        id: newId,
        kind: annotMode,
        comment: null,
        color,
        quote: sel.text,
        anchor: sel.rect
      });
    }
  }

  // 层级链随显示中的卡片刷新（getExtractChain 自根到当前，封顶 20 级）
  useEffect(() => {
    if (!shownId) {
      setChain([]);
      return;
    }
    let cancelled = false;
    void readingWorkflow.getChain(shownId).then((c) => {
      if (!cancelled) setChain(Array.isArray(c) ? c : []);
    });
    return () => {
      cancelled = true;
    };
  }, [shownId]);

  // 队列头一变（处理完一条 / 撤销召回）就退出查看态：查看态只是「回看某层」，不驻留
  useEffect(() => {
    setViewing(null);
    setViewRanges(null);
    setCrumbOpen(false);
  }, [current?.id]);

  useEffect(() => {
    if (!crumbOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (crumbRef.current && !crumbRef.current.contains(e.target as Node)) setCrumbOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [crumbOpen]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, note?: string) => {
      if (!current || busy || viewing) return; // 查看态一律不写：不推进调度、不改队列
      setBusy(true);
      try {
        await fn();
        eventBus.emit("workflow/changed");
        await refresh();
        if (note) {
          setFlash(note);
          window.setTimeout(() => setFlash(null), 1800);
        }
      } finally {
        setBusy(false);
      }
    },
    [current, busy, refresh, viewing]
  );

  const advance = useCallback(() => run(() => readingWorkflow.advance(current!.id)), [current, run]);
  const undo = useCallback(async () => {
    if (viewing) return;
    const r = await undoApi.last();
    if (r.ok) {
      setFlash("已撤销最近一次操作");
      window.setTimeout(() => setFlash(null), 1800);
      await refresh();
    } else {
      setFlash(r.reason || "没有可撤销的操作");
      window.setTimeout(() => setFlash(null), 1800);
    }
  }, [refresh, viewing]);

  /** 查看态的唯一出口：回队列（同时清掉「要看的范围」，避免下次查看串档） */
  const closeViewing = useCallback(() => {
    setViewing(null);
    setViewRanges(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if (viewing) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeViewing();
        }
        return; // 查看态：空格/Z 都不作用（不推进调度、不改队列）
      }
      if (e.key === "Escape") {
        setCrumbOpen(false);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void advance();
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, undo, viewing, closeViewing]);

  /** 面包屑点某层：切到那张卡（查看态）。当前层不可点——渲染成 span，且这里再拦一道。
   *  不带「要看的范围」：高亮该层自身的 quote_range_json（既有行为，规格 §1.2 R13）。 */
  const openLevel = useCallback(
    async (id: string) => {
      setCrumbOpen(false);
      if (!id || id === shownId) return;
      const detail = await readingWorkflow.getTopic(id);
      if (detail) {
        setViewRanges(null);
        setViewing(detail);
      }
    },
    [shownId]
  );

  /**
   * 子摘录「跳转原文」（工单 ① / D62）：**父摘录卡片**，并把「本子摘录所引的那一段」居中高亮。
   * 父卡不必在队列里——getTopic 直接取回、走查看态（只读、不推进调度、不改队列）；
   * 范围来自子摘录 contextRef.parentRange（父卡坐标，无此键的老数据回退父卡自身区间）。
   */
  const openParentCard = useCallback(async (child: DueTopic): Promise<boolean> => {
    const parentId = child.contextRef?.parentExtractId;
    if (!parentId) return false;
    const detail = await readingWorkflow.getTopic(parentId);
    if (!detail) return false;
    setCrumbOpen(false);
    // 老数据（无 parentRange）＝查看方没带范围 → null，回退父卡自身区间（不退化成整卡无高亮）
    const brought = parseQuoteRanges(child.contextRef?.parentRange);
    setViewRanges(brought.length ? brought : null);
    setViewing(detail);
    return true;
  }, []);

  if (!loaded) return <div className="extract-page" />;

  if (!current && !viewing) {
    return (
      <div className="extract-page">
        <div className="review-count mono">0 条待处理</div>
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            {bookItemIds && bookItemIds.length
              ? "这本书没有待处理的摘录。在阅读时选中一段文字点「摘录」，新摘录会在下一个学习日进队。"
              : "队列是空的。在阅读时选中一段文字点「摘录」，它会在下一个学习日出现在这里。"}
          </p>
          {/* 空态也要能撤销上一次操作（用户要求 Ctrl+Z 配置好：处理完最后一条后撤销入口不得消失） */}
          {undoAvailable && (
            <button className="primary" data-undo-empty onClick={() => void undo()}>
              撤销最近一次操作（Z）
            </button>
          )}
          {onExit && (
            <button onClick={onExit} style={{ marginLeft: 8 }}>
              返回阅读
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- 面包屑（规格 §1.2 R13） ----------
  const { head, hidden, tail } = splitChain(chain);
  const levelNode = (n: { id: string; text: string; depth: number }) =>
    n.id === shownId ? (
      <span key={n.id} className="crumb-here" aria-current="page" title={`第${n.depth}层（当前）`}>
        {crumbName(n.text)}
      </span>
    ) : (
      <button key={n.id} type="button" className="crumb-item" onClick={() => void openLevel(n.id)} title={`第${n.depth}层：${n.text}`}>
        {crumbName(n.text)}
      </button>
    );
  // 每个层级项前都有一条「›」（形态：原文 › 第1层 › 第2层 › 当前）
  const parts: ReactNode[] = [<span key="doc" className="crumb-root">原文</span>];
  const pushLevel = (n: { id: string; text: string; depth: number }, keyPrefix = "") => {
    parts.push(<span key={`sep-${keyPrefix}${n.id}`} className="crumb-sep" aria-hidden="true">›</span>);
    parts.push(levelNode(n));
  };
  head.forEach((n) => pushLevel(n));
  if (hidden.length > 0) {
    parts.push(<span key="sep-more" className="crumb-sep" aria-hidden="true">›</span>);
    parts.push(
      <span key="more" className="dd crumb-more" ref={crumbRef}>
        <button
          type="button"
          className="crumb-more-btn"
          aria-haspopup="listbox"
          aria-expanded={crumbOpen}
          data-crumb-more
          onClick={() => setCrumbOpen((v) => !v)}
          title={`还有 ${hidden.length} 级被折叠，点开逐层可达`}
        >
          …{hidden.length} 级
        </button>
        {crumbOpen && (
          <span className="dd-menu dd-menu-left" role="listbox" aria-label="被折叠的层级">
            {hidden.map((n) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={false}
                className="dd-item crumb-menu-item"
                data-crumb-hidden
                onClick={() => void openLevel(n.id)}
              >
                <span className="mono n">第{n.depth}层</span>
                <span className="crumb-menu-name">{crumbName(n.text)}</span>
              </button>
            ))}
          </span>
        )}
      </span>
    );
    tail.forEach((n) => pushLevel(n, "tail-"));
  }

  return (
    <div className="extract-page" ref={pageRef} data-showing-extract-id={shownId ?? ""} data-viewing={viewing ? "1" : undefined}>
      <div className="extract-page-head">
        <div className="extract-crumbs" data-extract-crumbs>
          {parts}
        </div>
        <span className="review-count mono">{items.length} 条待处理</span>
        {header ? <span className="mono extract-page-header">{header}</span> : null}
        {flash ? <span className="extract-flash mono">{flash}</span> : null}
        <span className="extract-page-hint mono" data-page-hint>
          {viewing ? "查看态：只读 · 不推进调度 · Esc 返回队列" : "空格＝下一条 · Z＝撤销 · 正文可直接编辑"}
        </span>
        {viewing && (
          <button className="crumb-exit" data-crumb-exit onClick={closeViewing} title="回到摘录会话（Esc）">
            返回队列
          </button>
        )}
        {onExit && (
          <button className="extract-exit" onClick={onExit}>
            返回阅读
          </button>
        )}
      </div>

      <div className={`extract-page-cols${annotPanelVisible ? " with-annot" : ""}`} data-annot-cols={annotPanelVisible ? "1" : undefined}>
      {viewing ? (
        <ExtractCardFace
          key={viewing.id}
          extract={viewing}
          madeCardCount={cardCounts[viewing.id]}
          viewOnly
          // 调用方带了「要看的范围」（子摘录的 parentRange）就高亮它；否则高亮该层自身区间
          quoteRanges={viewRanges ?? parseQuoteRanges(viewing.quoteRangeJson)}
          handlers={{}}
        />
      ) : (
        <ExtractCardFace
          key={current!.id}
          extract={current!}
          madeCardCount={cardCounts[current!.id]}
          engine={engine}
          busy={busy}
          handlers={{
            onAdvance: () => void advance(),
            onPostpone: (days) => void run(() => readingWorkflow.postponeDays(current!.id, days), `已推迟 ${days} 天`),
            onPriority: (p) => void run(() => readingWorkflow.setPriority(current!.id, p), `优先级改为 ${p}`),
            onGraduate: () => void run(() => readingWorkflow.graduate(current!.id), "已毕业：不再推送，仍保留在卡片浏览器"),
            onEdit: (text) => void run(() => readingWorkflow.updateContent(current!.id, text), "正文已保存"),
            onExtract: onExtract
              ? (payload) => onExtract(payload.text, { parentExtractId: current!.id, parentRange: payload.ranges })
              : undefined,
            onOpenExtract: () => onOpen(current!.id),
            // 「跳转原文」按层级分流（规格 §1.2 D62）：有父摘录＝回父卡（查看态 + 高亮所引那段），
            // 根摘录＝跳源文档（逐字保持既有行为，含 returnTo="queue" 现场恢复语义）
            onJumpToSource: current!.contextRef?.parentExtractId
              ? () => {
                  void openParentCard(current!).then((ok) => {
                    if (!ok && onJumpToDoc && current!.contextRef?.documentId) {
                      // 父卡已被删/不可取回：退回源文档，不给一个死按钮
                      onJumpToDoc(
                        current!.contextRef!.documentId!,
                        { anchorText: current!.contextRef!.anchorText || current!.contentMarkdown, anchorRatio: current!.contextRef!.anchorRatio },
                        "queue"
                      );
                    }
                  });
                }
              : onJumpToDoc && current!.contextRef?.documentId
                ? () =>
                    onJumpToDoc(
                      current!.contextRef!.documentId!,
                      {
                        anchorText: current!.contextRef!.anchorText || current!.contentMarkdown,
                        anchorRatio: current!.contextRef!.anchorRatio
                      },
                      "queue"
                    )
                : undefined,
            onUndo: () => void undo(),
            // 批 4 Task 10：把正文里的选区报给外层（菜单锚点 + 五动作的取材）
            onSelection: setFaceSel
          }}
        />
      )}

      {/* 批 4 Task 13/14（规格 §5.3）：批注栏——出现条件＝当前卡 ≥1 条注解；出现即占位 280px */}
      {annotPanelVisible && (
        <AnnotationPanel
          items={annots}
          currentId={null}
          filter={annotFilter}
          onFilter={(f) => void writeAnnotationSetting("annotationFilter", f)}
          palette={ANNOT_PALETTE}
          onJump={(it) => {
            // 点条目 → 文中滚动到锚点并短暂强调（合成 EPUB 的「文中」＝本条正文里，故滚到卡面正文）
            document.querySelector(".extract-face-body")?.scrollIntoView({ block: "center", behavior: "smooth" });
            setEditing({
              id: it.id,
              kind: it.kind,
              comment: it.comment,
              color: it.color,
              quote: it.quote,
              anchor: { x: 0, y: 0, width: 0, height: 0 }
            });
          }}
          onEdit={(it, comment) => void selActions.saveAnnotationComment(it.id, comment)}
          onColor={(it, color) => void selActions.saveAnnotationColor(it.id, color)}
          onDelete={(it) => {
            // 整卡批注（锚在整卡）＝本卡自身：删它只清批注，不动用户的卡
            if (it.anchorWhole) void selActions.saveAnnotationComment(it.id, null);
            else void selActions.removeAnnotation(it.id);
          }}
        />
      )}
      </div>

      {/* 批 4 Task 10（规格 §3.3）：选区菜单——摘录页无图片挖空（卡面正文的图片能力属批 5） */}
      {faceSel && !viewing && (
        <SelectionMenu
          anchor={faceSel.rect}
          container={pageRef.current?.getBoundingClientRect() ?? null}
          mode={annotMode}
          onModeChange={setAnnotMode}
          colors={ANNOT_PALETTE}
          onPick={handlePickColor}
          actions={[
            { key: "manual", label: "制卡", onClick: () => selActions.actions.manual() },
            { key: "ai-cards", label: "AI 制卡", onClick: () => selActions.actions.aiCards() },
            { key: "explain", label: "AI 解释", onClick: () => selActions.actions.explain() },
            { key: "extract", label: "摘录", onClick: () => selActions.actions.extract() },
            { key: "lookup", label: "查词", onClick: () => selActions.actions.lookup() }
          ]}
        />
      )}

      {/* 批 4 Task 10：三个面板与阅读器共用同一份实现（SelectionPanels） */}
      <SelectionPanels sel={selActions} selectionText={faceSel?.text ?? null} elapsedSec={0} />

      {/* 批 4 Task 11（R37/R40）：批注编辑浮层——无保存/取消，失焦即落库；清空＝删批注 */}
      {editing && (
        <AnnotationEditor
          extractId={editing.id}
          kind={editing.kind}
          comment={editing.comment}
          color={editing.color}
          quote={editing.quote}
          anchor={editing.anchor}
          container={pageRef.current?.getBoundingClientRect() ?? null}
          palette={ANNOT_PALETTE}
          customEnabled={annotSettings.annotateCustomEnabled}
          onSaveComment={(c) => selActions.saveAnnotationComment(editing.id, c)}
          onSaveColor={async (c) => {
            await selActions.saveAnnotationColor(editing.id, c);
            // 浮层是受控的：落库后必须把本地态一并更新，否则色块显示停在旧色（实测）
            setEditing((prev) => (prev ? { ...prev, color: c } : prev));
          }}
          onDelete={async () => {
            await selActions.removeAnnotation(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
