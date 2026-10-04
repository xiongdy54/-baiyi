import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ExtractCardFace, { ExtractActionsBar, parseQuoteRanges } from "./ExtractCardFace";
import SelectionMenu, { ANNOT_COLORS, type AnnotColor, type AnnotMenuMode, type AnnotMarkForm } from "./SelectionMenu";
import SelectionPanels from "./SelectionPanels";
import AnnotationEditor from "./AnnotationEditor";
import AnnotationPanel, { type AnnotItem, type AnnotFilter } from "./reader/AnnotationPanel";
import { useAnnotationSettings, writeAnnotationSetting } from "../lib/annotationSettings";
import { cardsApi } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { readingWorkflow, parseContextRef, undoApi, modifierFlagOf, readMultiSelectKey, type MultiSelectKey, type DueTopic, type ExtractDetail } from "../lib/readingWorkflow";
import { extractSettings, fetchSessionQueue, type ExtractEngine, type Limits, type ScopeFilter } from "../lib/sessionQueue";
import { useSelectionActions } from "../lib/useSelectionActions";
import { createMultiHighlight } from "../lib/reader/multiHighlight";
import { rectFromOffsets, type BodyAnnotationGroup } from "../lib/reader/bodyAnnotations";
import type { PopoverRect } from "../lib/popoverPlace";

/** 选区快照（卡面 onSelection 回调的载荷；null＝无选区） */
type FaceSelection = { rect: { x: number; y: number; width: number; height: number }; ranges: Array<{ start: number; end: number }>; text: string } | null;

interface Props {
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
  /** v48.47（D87）：点「已制卡 N 张」→ 宿主（App）跳卡片浏览器并按该摘录锚筛选 */
  onOpenAnchorCards?: (extractId: string) => void;
  /** v48.41（D81）：当前卡材料名上报（顶栏中间显示；无材料名时回调空串＝回落「摘录」字样） */
  onMaterialName?: (name: string) => void;
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
export default function ExtractReviewView({ onJumpToDoc, bookItemIds, scopeLimits, header, onExit, onExtract, onMaterialName, onOpenAnchorCards }: Props) {
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
  /** 批 4 Task 10：卡面正文里的当前选区（菜单锚点与动作文本都取自它；无选区＝null）。
   *  v48.38 / D78：ranges 为**累计后的多段区间**（Ctrl 加选），text 为各段 \n\n 拼接。 */
  const [faceSel, setFaceSel] = useState<FaceSelection>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  /** 多段集合（偏移区间，v48.38 / D78）：与阅读器同语义——无修饰＝替换、修饰＝按边界精确切换；不合并 */
  const multiRangesRef = useRef<Array<{ start: number; end: number }>>([]);
  /** 上一次**原始**采集的边界（幂等守卫用；与累计集合 multiRangesRef 不同——它是替换前的原始选区） */
  const lastRawRef = useRef<string | null>(null);
  /** 修饰键（settings.app.multiSelectKey，默认 Ctrl；与 Reader 同源同订阅） */
  const multiKeyRef = useRef<MultiSelectKey>("Ctrl");
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
  // 多段选择的修饰键（v48.38 / D78）：settings.app.multiSelectKey——与 Reader 同源同订阅（改动即时生效）
  useEffect(() => {
    let alive = true;
    void readMultiSelectKey().then((k) => {
      if (alive) multiKeyRef.current = k;
    });
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload && payload.scope === "app" && payload.key === "multiSelectKey") {
        void readMultiSelectKey().then((k) => {
          if (alive) multiKeyRef.current = k;
        });
      }
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 修饰键按住期（v48.40 / D80）：菜单**让路**不接管指针——与阅读器同规（Reader.tsx multiKeyHeld）。
   *  实测（cards.gui）：摘录页此前不让路，菜单按 R22 落在当前选区下方会盖住**下一段**的拖选起笔
   *  ——3 段连选时第二段被菜单吃掉，集合只剩 [甲,丙]。修饰键状态从指针事件取（与内核同一信号源）。 */
  const [multiKeyHeld, setMultiKeyHeld] = useState(false);
  useEffect(() => {
    const sync = (e: PointerEvent) => setMultiKeyHeld(modifierFlagOf(multiKeyRef.current, e));
    const reset = () => setMultiKeyHeld(false);
    document.addEventListener("pointerdown", sync, true);
    document.addEventListener("pointermove", sync, true);
    document.addEventListener("pointerup", sync, true);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("pointerdown", sync, true);
      document.removeEventListener("pointermove", sync, true);
      document.removeEventListener("pointerup", sync, true);
      window.removeEventListener("blur", reset);
    };
  }, []);


  /** 批 4 Task 11：正在编辑的批注（新建或点已有条目进入；null＝无浮层） */
  const [editing, setEditing] = useState<{
    id: string;
    kind: "highlight" | "extract";
    comment: string | null;
    color: string | null;
    quote: string;
    anchor: { x: number; y: number; width: number; height: number };
  } | null>(null);

  /** 批 4 Task 12：模式/形式与色板取自设置键（与阅读器同一份读侧；改设置即时生效） */
  const annotSettings = useAnnotationSettings();
  const annotMode = annotSettings.annotateMode;
  const setAnnotMode = (m: AnnotMenuMode) => void writeAnnotationSetting("annotateMode", m);
  const annotForm = annotSettings.annotateForm;
  const setAnnotForm = (f: AnnotMarkForm) => void writeAnnotationSetting("annotateForm", f);
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

  // v48.41（D81）：当前卡材料名上报顶栏（替代「摘录」字样；无材料名＝空串，顶栏回落原字样）
  const materialName = String(shown?.docTitle ?? "");
  const onMaterialNameRef = useRef(onMaterialName);
  onMaterialNameRef.current = onMaterialName;
  useEffect(() => {
    onMaterialNameRef.current?.(materialName);
  }, [materialName]);

  /** 批 4 Task 13/14：当前卡的注解清单（含纯高亮）；栏的出现条件＝≥1 条 */
  const [annots, setAnnots] = useState<AnnotItem[]>([]);
  /** 正文痕迹（段锚批注，按色分组；样张 `.q` 同规）——只喂给卡面的绘制层 */
  const [bodyGroups, setBodyGroups] = useState<BodyAnnotationGroup[]>([]);
  const annotsFor = shown?.id ?? null;
  /** 子条目的**父卡坐标区间**（id → ranges）：浮层锚点要按它算「所引那段」的矩形 */
  const rangesByIdRef = useRef<Record<string, Array<{ start: number; end: number }>>>({});
  useEffect(() => {
    if (!annotsFor) {
      setAnnots([]);
      setBodyGroups([]);
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
        annotationType: (r.annotationType as string | null) ?? null,
        time: Number(r.createdAt ?? 0),
        parentId: String((r as { parentId?: unknown }).parentId ?? ""),
        hasRange: parseQuoteRanges(r.quoteRangeJson).length > 0,
        // 正文痕迹用**父卡坐标**的区间：子注解的 quoteRangeJson 是「本条正文」坐标（整条即引文），
        // 拿它去画父卡正文会错位——父卡坐标在 contextRef.parentRange（与「跳转原文回父卡」同一来源）。
        // 注意：`listAll` 返回的是**已解析**的 contextRef（原始 JSON 键被剥掉，实测踩过）
        ranges: parseQuoteRanges(parseContextRef(r.contextRef ?? r.contextRefJson)?.parentRange)
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
      const nextRanges: Record<string, Array<{ start: number; end: number }>> = {};
      for (const r of children) if (r.ranges.length) nextRanges[r.id] = r.ranges;
      rangesByIdRef.current = nextRanges;
      setAnnots([
        ...wholeItem,
        ...children.map((r) => ({ ...r, anchorWhole: false }))
      ]);
      // 批 4 修正：正文痕迹＝挂在本卡上的**段锚**批注（按各自的批注色画；整卡批注不画，§5.4）
      // v48.41（D81）：下划线形式的批注按（色×形式）分组，画透明底+色线而非底色
      setBodyGroups(
        children
          .filter((r) => r.hasRange && r.ranges.length > 0)
          .map((r) => ({ color: r.color, underline: r.annotationType === "underline", ranges: r.ranges }))
      );
    };
    void load();
    const off = eventBus.on("workflow/changed", () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [annotsFor]);

  /**
   * 批注浮层的锚点（R37 修正）：**所引那段文字**在卡面里的视口矩形（与正文痕迹同一偏移口径）。
   * 无区间可算时（整卡批注、老数据）退回卡面矩形上沿——绝不把浮层丢到视口原点的 (0,0)。
   */
  function anchorForAnnotation(id: string, body: HTMLElement | null): PopoverRect {
    for (const r of rangesByIdRef.current[id] ?? []) {
      const rect = rectFromOffsets(body, r.start, r.end);
      if (rect) return rect;
    }
    const box = body?.getBoundingClientRect();
    if (box && box.width > 0) return { x: box.x + 12, y: box.y + 12, width: Math.min(box.width - 24, 360), height: 0 };
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * 批注轨常驻（v48.35 / D75，取代 2026-10-01「当前卡 ≥1 条注解才出现」裁定）：推进到无批注卡后
   * 轨与开关钮整根消失＝用户实测痛点；现在轨与钮恒在场——无批注时列表显示「（筛选后无条目）」空列提示，
   * 查看态也不再藏轨（查看卡的注解照常按 annotsFor 加载）。空态/加载态页面（无卡）仍无轨。
   */
  const annotPanelVisible = true;
  /**
   * 栏开合状态记忆（v48.35 / D75）：入 sessionStorage——跨换卡、跨查看态、跨「顶栏摘录」与
   * 「阅读器·复习摘录」两个入口持久（同挂本组件），应用重启后回到「开」。取代 v48.32 的组件内 useState。
   */
  const [annotOpen, setAnnotOpen] = useState(() => sessionStorage.getItem("extract.annotOpen") !== "0");
  useEffect(() => {
    sessionStorage.setItem("extract.annotOpen", annotOpen ? "1" : "0");
  }, [annotOpen]);

  /**
   * 批 4 Task 10（规格 §3 / §4）：摘录页的选区动作编排与阅读器复用同一个钩子。
   * 宿主注入面按摘录页的实际能力给：正文＝卡面（不是内核），故 selectionText/spans 取自卡面回调，
   * 定位锚用卡面正文的 documentId/extractId；图片挖空在摘录页不存在（不注入 focus）。
   */
  const sourceTextRef = useRef("");
  const selActions = useSelectionActions({
    selectionText: () => faceSel?.text ?? null,
    selectionSpans: () => faceSel?.ranges.map((r) => ({ text: "" })),
    // 多段累计的偏移区间（v48.38 / D78）：≥2 段随「摘录」落库写入 contextRef.parentRange
    selectionRanges: () => (faceSel?.ranges.length ? faceSel.ranges : null),
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
      multiRangesRef.current = [];
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
    /** 规格 §3.4：摘录页的批注/高亮/**摘录动作**恒挂在**当前卡**上；所选区间走 contextRef.parentRange
     *  （父卡坐标，与既有「子摘录」同一套语义）。
     *  v48.40（D80）：守卫放宽——老摘录的 contextRef 可能整体为 NULL（早期版本数据），
     *  documentId 回退到行原生 `document_id` 列（listDueExtracts 原样透传；能进队列的行必然
     *  INNER JOIN 过 documents ⇒ 该列必有效，不会造出挂不上 listAllExtracts JOIN 的孤儿行）。 */
    annotateParent: () => {
      if (!shown?.id) return null;
      const documentId = shown.contextRef?.documentId ?? shown.document_id ?? "";
      const rootId = String(shown.contextRef?.rootExtractId || shown.id);
      return {
        parentType: "extract" as const,
        parentId: shown.id,
        documentId,
        contextRefPatch: {
          extractId: shown.id,
          parentExtractId: shown.id,
          rootExtractId: rootId,
          ...(faceSel?.ranges?.length ? { parentRange: faceSel.ranges } : {})
        }
      };
    },
    focus: {
      get: () => null,
      close: () => {},
      setBusy: () => {}
    }
  });
  const { createAnnotation } = selActions;
  // 卡面选区高亮（v48.38 / D78）：由 handleFaceSelection 按集合动作（replace/append/remove）直接驱动，
  // 不再有「faceSel 一变就 replace」的兜底 effect——那会抹掉 Ctrl 加选的累计（多段选择的实现本体在这里）。
  /**
   * R38/R40：点色＝完成当前模式与形式的标注（颜色不记）。
   * 摘录页按规格 §3.4 把批注/高亮挂在当前卡上（annotateParent 已在适配器里给定）；
   * 落库后**接着弹批注编辑浮层**（R40：写了批注 → 落带批注那条；没写 → 失焦即落无批注那条）。
   */
  async function handlePickColor(color: AnnotColor, comment: string) {
    const sel = faceSel;
    if (!sel) return;
    // **先落库、后清选区**：adapter 的 annotateParent() 读的就是 faceSel 里的偏移，
    // 提前清掉会让落库区间退化成「整条正文」（[{0,len}]）——栏内条目与文中那段就对不上了（实测踩过）。
    // v48.43（D83）：批注文字随菜单批注框一次带上（空串＝无批注），**不再自动弹编辑浮层**
    //（编辑走栏内条目/文中标记点击，R37/R40 入口不变）。
    await createAnnotation(sel.text, undefined, color, annotMode, annotForm, comment || null);
    multiHighlightRef.current?.clear();
    multiRangesRef.current = [];
    setFaceSel(null);
    window.getSelection()?.removeAllRanges();
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
  /**
   * 优先级专用静默提交（v48.33 / D73）：与 run() 的差别＝不挂 busy（busy 态会把整排底栏按钮打成
   * disabled 又恢复＝用户实测的「整个底部栏闪一下」）、不发 flash note（「优先级改为…」toast 用户明示多余）、
   * 不广播 workflow/changed（优先级不涉批注与队列组成，省掉订阅方的两次全量重取）；
   * 仍走 setPriority + refresh() 保证卡面 meta 行与队列投影回流。
   */
  const commitPriority = useCallback(
    async (p: number) => {
      if (!current || viewing) return;
      try {
        await readingWorkflow.setPriority(current.id, p);
        await refresh();
      } catch {
        /* 与 run 同径：投影不回流即视为未生效，不弹错（滑块草稿由 ExtractActionsBar 回流判据兜底回落） */
      }
    },
    [current, refresh, viewing]
  );
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

  // 加载态：台架配方下页面根内居中 meta 文案（现状是空白页；无头带、无底栏）
  /**
   * 「原文」根节点跳转（v48.35 / D75）：与底栏「跳转原文」同语义（returnTo="queue" 存现场）。
   * 锚优先取**当前卡自身 contextRef**（anchorText/anchorRatio——根摘录由阅读器选取时记录）；
   * 子摘录没有文档级锚（它的位置是父卡坐标 parentRange），回退**链根摘录**的锚；
   * 两者皆无（较早版本创建、尚无锚体系的卡）→ flash 有界失败，不假装跳转。
   * 注意 ExtractContextRef 没有 cfi 字段（那是阅读器内核 locator 的载体），摘录只落文本锚+比例。
   */
  const jumpCrumbRoot = useCallback(async () => {
    if (!shown || !onJumpToDoc) return;
    const ref = shown.contextRef;
    if (!ref?.documentId) return;
    const fallbackText = String(shown.contentMarkdown ?? "");
    const hasOwn = !!(ref.anchorText || ref.anchorRatio != null);
    let anchor: { anchorText: string; anchorRatio?: number } | null = hasOwn
      ? { anchorText: ref.anchorText || fallbackText, anchorRatio: ref.anchorRatio }
      : null;
    if (!anchor) {
      const root = await readingWorkflow.getTopic(chain[0]?.id ?? "");
      const rc = root?.contextRef;
      if (rc?.documentId === ref.documentId && (rc.anchorText || rc.anchorRatio != null)) {
        anchor = { anchorText: rc.anchorText || fallbackText, anchorRatio: rc.anchorRatio };
      }
    }
    if (!anchor) {
      setFlash("该摘录没有跳转位置数据（较早版本创建）");
      window.setTimeout(() => setFlash(null), 1800);
      return;
    }
    onJumpToDoc(ref.documentId, anchor, "queue");
  }, [shown, chain, onJumpToDoc]);
  const canJumpRoot = !!onJumpToDoc && !!shown?.contextRef?.documentId;

  /**
   * 卡面选区采集（v48.38 / D78）：多段集合运算——与阅读器同语义（无修饰＝替换、修饰＝按边界精确切换、
   * 同段再选＝移出、不合并）。集合域是 **content_markdown 的字符偏移**（＝落库 parentRange 的第一事实），
   * 与主进程文本 span 代数分域（文本桥会丢精度且同文段不可消歧，见 D78）；高亮由本函数按动作驱动
   * multiHighlight，不再有「faceSel 一变就 replace」的兜底。载荷 text＝各段 \n\n 拼接，
   * 菜单与五动作/批注挂色零改动自动多段化。
   */
  const handleFaceSelection = useCallback(
    (payload: FaceSelection, modifier?: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
      if (!payload) {
        multiRangesRef.current = [];
        lastRawRef.current = null;
        multiHighlightRef.current?.clear();
        setFaceSel(null);
        return;
      }
      const withMod = modifierFlagOf(multiKeyRef.current, modifier ?? {});
      const rawKey = JSON.stringify(payload.ranges);
      // 幂等守卫（实测踩过）：不带修饰位且与上次上报同界 ＝ 重复采集（松开 Ctrl 的 keyup 会再采一次），
      // 不得重放 replace——否则 Ctrl 拖选的累计在松键瞬间被抹掉。带修饰位的上报不跳过（同段再选＝移出）。
      if (!withMod && lastRawRef.current === rawKey) return;
      lastRawRef.current = rawKey;
      const cur = multiRangesRef.current;
      const incoming = payload.ranges;
      let removed = false;
      let next: Array<{ start: number; end: number }>;
      if (!withMod) {
        next = incoming;
      } else {
        const inc = incoming[0];
        const hit = inc ? cur.findIndex((r) => r.start === inc.start && r.end === inc.end) : -1;
        if (inc && hit >= 0) {
          next = cur.filter((_, i) => i !== hit);
          removed = true;
        } else {
          next = [...cur, ...incoming];
        }
      }
      multiRangesRef.current = next;
      multiHighlightRef.current?.update(!withMod ? "replace" : removed ? "remove" : "append");
      const full = String(shown?.contentMarkdown ?? "");
      const text = next.map((r) => full.slice(Math.min(r.start, full.length), Math.min(r.end, full.length))).join("\n\n");
      setFaceSel(next.length && text.trim() ? { rect: payload.rect, ranges: next, text } : null);
    },
    [shown]
  );

  if (!loaded) {
    return (
      <div className="extract-page">
        <div className="empty-state"><p className="empty-text">加载中…</p></div>
      </div>
    );
  }

  if (!current && !viewing) {
    return (
      <div className="extract-page">
        {/* D88 §6.5：计数升级为预览 .pending 形态——8px accent 方点（纯装饰 .count-dot，不加 data 钩子）+ 数字 mono 600 */}
        <div className="review-count mono"><i className="count-dot" aria-hidden="true" /><b>0</b> 条待处理</div>
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
  // 「原文」根节点（v48.35/D75）：有跳转出口（onJumpToDoc + documentId）时渲染为按钮——点击跳源文档；
  // 无锚数据的旧卡点击后 flash 有界失败（见 jumpCrumbRoot），无出口时维持 span。
  const parts: ReactNode[] = [
    canJumpRoot ? (
      <button key="doc" type="button" className="crumb-root" onClick={() => void jumpCrumbRoot()} title="跳转到原文位置">
        原文
      </button>
    ) : (
      <span key="doc" className="crumb-root">原文</span>
    )
  ];
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

  /**
   * 会话态动作集（v2 §8.2）：**同一个 handlers 对象**同时喂给卡面与底栏（ExtractActionsBar），调用方零适配。
   * `onJumpToSource` 的分流判定用可选链——查看态下 current 可能为 null，对象构造期不得抛；
   * 其余闭包内的 `current!` 只在按钮被点击时求值（会话态必有 current）。
   */
  const faceHandlers = {
    onAdvance: () => void advance(),
    onPostpone: (days: number) => void run(() => readingWorkflow.postponeDays(current!.id, days), `已推迟 ${days} 天`),
    onPriority: (p: number) => void commitPriority(p),
    onGraduate: () => void run(() => readingWorkflow.graduate(current!.id), "已毕业：不再推送，仍保留在卡片浏览器"),
    onEdit: (text: string) => void run(() => readingWorkflow.updateContent(current!.id, text), "正文已保存"),
    // 「跳转原文」按层级分流（规格 §1.2 D62）：有父摘录＝回父卡（查看态 + 高亮所引那段），
    // 根摘录＝跳源文档（逐字保持既有行为，含 returnTo="queue" 现场恢复语义）
    onJumpToSource: current?.contextRef?.parentExtractId
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
      : onJumpToDoc && current?.contextRef?.documentId
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
    onSelection: handleFaceSelection
  };

  return (
    <div
      className="extract-page"
      ref={pageRef}
      data-showing-extract-id={shownId ?? ""}
      data-viewing={viewing ? "1" : undefined}
      data-annot-open={annotPanelVisible && annotOpen ? "1" : undefined}
      /* D88 §8.5：制卡面板（手动/AI 任一）在场——宽窗 ≥1520 时主列与底栏右移让位（CSS 条件）；
         窄窗 dock 为覆盖层，内容不动。 */
      data-dock-open={selActions.manualOpen || selActions.aiPanel ? "1" : undefined}
    >
      <div className={`extract-page-cols${annotPanelVisible ? " with-annot" : ""}`} data-annot-cols={annotPanelVisible ? "1" : undefined}>
      {/* 栏开关（v6/D73 造型还原，v48.42/D82 用户指令）：文字钮两态变文案，fixed 页面视口左上角
          (var(--sp-4), 顶栏48+var(--sp-3))——与批注栏头（全部/摘录/高亮 位置/时间）同一视觉行。 */}
      {annotPanelVisible && (
        <button
          className="annot-toggle bar-btn"
          data-annot-toggle
          aria-expanded={annotOpen}
          aria-controls="extract-annot-panel"
          title={annotOpen ? "收起批注栏" : "展开批注栏"}
          onClick={() => setAnnotOpen((v) => !v)}
        >
          {annotOpen ? "收起" : "展开"}
        </button>
      )}

      {/* 批注轨（v5/D72）：全高 sticky 左轨——贴窗左缘 x=0、上至页面顶；宽度 280↔0 滑动（.is-closed），
          两态持续挂载以承载动画；收起时 width:0 + visibility:hidden＝不留空轨、不可交互、不进可访问树。
          摘录页的栏只有注解列表（没有目录/图谱），故不设页签（用户 2026-10-01）。 */}
      {annotPanelVisible && (
        <div
          className={`extract-annot-rail${annotOpen ? "" : " is-closed"}`}
          id="extract-annot-panel"
          aria-hidden={!annotOpen}
        >
          <AnnotationPanel
            items={annots}
            currentId={null}
            filter={annotFilter}
            showCount={false}
            onFilter={(f) => void writeAnnotationSetting("annotationFilter", f)}
            palette={ANNOT_PALETTE}
            onJump={(it) => {
              // 点条目 → 文中滚动到锚点并短暂强调（合成 EPUB 的「文中」＝本条正文里，故滚到卡面正文）
              const body = document.querySelector(".extract-face-body") as HTMLElement | null;
              body?.scrollIntoView({ block: "center", behavior: "smooth" });
              setEditing({
                id: it.id,
                kind: it.kind,
                comment: it.comment,
                color: it.color,
                quote: it.quote,
                anchor: anchorForAnnotation(it.id, body)
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
        </div>
      )}

      {/* 主列（v5/D72）：头带 + 卡面同在 .extract-main——头带内列与卡面同盒（≤720 居中），
          面包屑左缘＝卡面左缘、最右元素右缘＝卡面右缘，两态（轨开/收）构造性成立。 */}
      <div className="extract-main">
        {/* 头带：全宽吸顶（sticky/满宽/--paper 底由共用规则给出）；内列 width:100% + ≤720 居中。
            className 首 token 必须仍是 extract-page-head（面包屑测试命中判据）。 */}
        <div className="extract-page-head">
          {/* v48.43（D83）工具栏上移为**首行**：模式/形式段控 + 动作钮（批注栏头同款样式）——
              与左侧批注栏头（收起/展开 全部/摘录/高亮 位置/时间）同一视觉行；
              面包屑+计数随之下移到动作行下方、正文上方。段控是持久偏好，无选区也可切。 */}
          <div className="extract-toolbar" data-extract-toolbar>
            <div className="seg-rail" role="group" aria-label="标注模式">
              <button type="button" className={annotMode === "highlight" ? "on" : undefined} data-annot-mode="highlight" onClick={() => setAnnotMode("highlight")}>高亮</button>
              <button type="button" className={annotMode === "extract" ? "on" : undefined} data-annot-mode="extract" onClick={() => setAnnotMode("extract")}>摘录+高亮</button>
            </div>
            <div className="seg-rail" role="group" aria-label="标记形式">
              <button type="button" className={annotForm === "highlight" ? "on" : undefined} data-annot-form="highlight" onClick={() => setAnnotForm("highlight")}>高亮</button>
              <button type="button" className={annotForm === "underline" ? "on" : undefined} data-annot-form="underline" onClick={() => setAnnotForm("underline")}>下划线</button>
            </div>
            <button type="button" className="btn-rail" data-sel-act="manual" disabled={!!viewing || !faceSel} title={faceSel && !viewing ? "就地制卡" : "先在正文选中文字"} onClick={() => selActions.actions.manual()}>制卡</button>
            <button type="button" className="btn-rail" data-sel-act="aiCards" disabled={!!viewing || !faceSel} title={faceSel && !viewing ? "AI 制卡" : "先在正文选中文字"} onClick={() => selActions.actions.aiCards()}>AI 制卡</button>
            <button type="button" className="btn-rail" data-sel-act="explain" disabled={!!viewing || !faceSel} title={faceSel && !viewing ? "AI 解释" : "先在正文选中文字"} onClick={() => selActions.actions.explain()}>AI 解释</button>
            <button type="button" className="btn-rail" data-sel-act="extract" disabled={!!viewing || !faceSel} title={faceSel && !viewing ? "摘录进学习队列" : "先在正文选中文字"} onClick={() => selActions.actions.extract()}>摘录</button>
            <button type="button" className="btn-rail" data-sel-act="lookup" disabled={!!viewing || !faceSel} title={faceSel && !viewing ? "查词" : "先在正文选中文字"} onClick={() => selActions.actions.lookup()}>查词</button>
          </div>
          <div className="extract-page-head-inner">
            <div className="extract-crumbs" data-extract-crumbs>
              {parts}
            </div>
            {header ? <span className="mono extract-page-header">{header}</span> : null}
            {flash ? <span className="extract-flash mono">{flash}</span> : null}
            {/* 快捷键提示：**仅会话态**（查看态的模式提示已搬到底栏，不重复表达） */}
            {!viewing && (
              <span className="extract-page-hint mono" data-page-hint>
                空格＝下一条 · Z＝撤销 · 正文可直接编辑
              </span>
            )}
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
            {/* 计数恒最右（v5/D72）：与面包屑同一行、右缘与卡面右缘对齐（用户裁定 ①）
                D88 §6.5：升级为预览 .pending 形态——8px accent 方点 + 数字 mono 600（外层 .review-count 类保留） */}
            <span className="review-count mono"><i className="count-dot" aria-hidden="true" /><b>{items.length}</b> 条待处理</span>
          </div>
        </div>

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
          bodyAnnotations={bodyGroups}
          handlers={faceHandlers}
        />
      )}
      </div>
      </div>

      {/* 底栏（v2）：与复习页共用 .stage-bar 几何；它是 .extract-page 的**最后一个流内子节点**
          ⇒ sticky bottom:0 钉底，任何窗口高度下自己与内容都不被裁；侧边栏开合也不影响它。
          会话态＝动作栏（ExtractActionsBar）；查看态＝只读模式提示（几何不跳，信息零丢失）。
          data-page-hint 在查看态落在这条提示上（会话态仍在头带），既有测试钩子保持不变。 */}
      {viewing ? (
        <div className="stage-bar extract-face-actions">
          <span className="bar-hint" data-page-hint>查看态：只读 · 不推进调度 · Esc 返回队列</span>
        </div>
      ) : (
        <ExtractActionsBar extract={current!} engine={engine} busy={busy} handlers={faceHandlers} />
      )}

      {/* 批 4 Task 10（规格 §3.3）：选区菜单——v48.42/D82 双段控（模式+形式）+ 色板；动作行移至 .extract-toolbar */}
      {faceSel && !viewing && (
        <SelectionMenu
          anchor={faceSel.rect}
          container={pageRef.current?.getBoundingClientRect() ?? null}
          colors={ANNOT_PALETTE}
          onPick={handlePickColor}
          byLocked={multiKeyHeld}
        />
      )}

      {/* 批 4 Task 10：三个面板与阅读器共用同一份实现（SelectionPanels）
          D88 §8：手动制卡/AI 两态在其中换渲染容器为右侧制卡面板 dock；头行 meta＝材料名 */}
      <SelectionPanels
        sel={selActions}
        selectionText={faceSel?.text ?? null}
        elapsedSec={0}
        dockMeta={current?.docTitle || viewing?.docTitle || undefined}
      />

      {/* 批 4 Task 11（R37/R40）：批注编辑浮层——无保存/取消，失焦即落库；清空＝删批注 */}
      {editing && (
        <AnnotationEditor
          extractId={editing.id}
          kind={editing.kind}
          comment={editing.comment}
          color={editing.color}
          anchor={editing.anchor}
          onOpenCards={onOpenAnchorCards ? () => onOpenAnchorCards(editing.id) : undefined}
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
