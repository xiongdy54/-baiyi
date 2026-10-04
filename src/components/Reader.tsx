import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cardsApi, parseCloze, type CardDraft } from "../lib/cards";
import { useSelectionActions } from "../lib/useSelectionActions";
import type { OcclusionRect, OcclusionShape } from "../lib/occlusion";
import { settingsStore } from "../lib/settings";
import { sanitizeDomain, udcLabel, UDC_LEAVES, UDC_MAX, UDC_OTHER } from "../lib/udc";
import { eventBus } from "../lib/eventbus";
import { readingStats } from "../lib/stats";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import ImageFocus, { type ImageFocusSubmit } from "./reader/ImageFocus";
import { useCommandActions } from "../lib/useCommands";
import ReaderEngine from "./reader/ReaderEngine";
import SelectionMenu, { ANNOT_COLORS, type AnnotColor, type AnnotMenuMode, type AnnotMarkForm } from "./SelectionMenu";
import SelectionPanels from "./SelectionPanels";
import AnnotationEditor from "./AnnotationEditor";
import { useAnnotationSettings, writeAnnotationSetting } from "../lib/annotationSettings";
import ReaderSidebar, { type ReaderTab } from "./reader/ReaderSidebar";
import ReaderExtractsPanel from "./reader/ReaderExtractsPanel";
import MindmapTab from "./reader/MindmapTab";
import type { AnnotSort } from "./reader/AnnotationPanel";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconAlert, IconClose } from "./icons";
import {
  DEFAULT_READER_SETTINGS,
  buildLocator,
  resolveAppearance,
  type ContentPointerDownInfo,
  type ContentPointerUpInfo,
  type ImageLocateHit,
  type ReaderAppearance,
  type ReaderDocMark,
  type ReaderImageRef,
  type ReaderKernel,
  type ReaderModeConfig,
  type ReaderRect,
  type ReaderSelection,
  type ReaderSettings,
  type ReaderTocItem,
  type RelocateInfo,
  type SourceAnchorGeometry
} from "../lib/reader/service";
// v48.24 批3（§4 文中留痕）：标记的数据面（哪些根摘录要画、浮层显示什么）——纯函数，零 DOM
import { aggregateCardCounts, buildAnnotationItems, buildDocMarks } from "../lib/reader/marks";
// v48.23（D61 §6.8-11）：多段选择的集合运算与修饰键——纯逻辑在 electron/annotationRange.js，
// 渲染层经主进程算（resolveSpanSet），本层不复制任何 span 归并/装配逻辑。
import {
  modifierFlagOf,
  readMultiSelectKey,
  resolveSpanSet,
  type ExtractSpan,
  type MultiSelectKey
} from "../lib/readingWorkflow";

interface Props {
  title: string;
  markdown: string;
  itemId?: string;
  initialRatio?: number;
  /** 上次进度的 CFI（文件书内核恢复定位用） */
  initialCfi?: string | null;
  /** v28 PDF 原生阅读：上次进度的页码（0 基），恢复时优先于 initialRatio */
  initialPageIndex?: number | null;
  contextLabel?: string;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string; anchorRatio?: number } | null;
  jumpAnchor?: {
    anchorText: string;
    anchorRatio?: number;
    cfi?: string;
    chapterIndex?: number;
    pageIndex?: number;
    /** v35 图片卡附带：原图定位线索 + 本卡区域（图内高亮/对照浮层） */
    imageAnchor?: { alt?: string; contextText?: string };
    occlusion?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: unknown; regionScope?: string; cardOrd?: number; assetPath?: string };
  } | null;
  /** 原书文件字节（存在即走阅读内核；粘贴书/摘录 R1b 合流） */
  book?: { bytes: Uint8Array; name: string; engine?: "foliate" | "pdf" } | null;
  sourceTitle?: string;
  onBack: () => void;
  onProgress?: (ratio: number, lastText: string, extra?: { cfi?: string; fraction?: number; pageIndex?: number }) => void;
  /** 阅读主题联动整个软件（v20.1）：暗夜→软件夜间模式，纸白/羊皮→浅色 */
  onSwitchAppTheme?: (mode: "light" | "dark") => void;
  /** v48.13（P2）：由全局活动指示器「打开导图」进入时置位——挂载后自动打开导图工作区 */
  openMindmapInitially?: boolean;
  /** 消费后通知 App 清除标记（避免返回正文再进出时重复弹出） */
  onMindmapOpened?: () => void;
  /** v48.13（P2）：要展示的导图版本 id（候选版本——不激活但仍应被看到） */
  openMindmapMapId?: string | null;
  /** v48.13（P3）：以同一 run 续跑（应用重启后发现未跑完的运行） */
  resumeRunId?: string | null;
  /** v48.22（D58 §6.8-8）：集中复习本书的摘录 / 闪卡（按书范围会话） */
  onReviewExtracts?: () => void;
  onReviewCards?: () => void;
}

/** v25：读取正文图片/选区图片的 dataURL（blob:/data:/bookasset: 同源可 fetch；超 12MB 拒绝） */
async function loadImageDataUrl(src: string): Promise<string | null> {
  try {
    if (!src) return null;
    if (src.startsWith("data:image/")) return src;
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size > 12 * 1024 * 1024) return null;
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("读取失败"));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** v25：按选区包围盒裁剪（AI 需要「只看选区内容」的图片；坐标以原图百分比给出） */
function cropImageDataUrl(dataUrl: string, bbox: OcclusionRect): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        reject(new Error("图片尺寸不可用"));
        return;
      }
      const sx = Math.max(0, Math.floor((bbox.x / 100) * w));
      const sy = Math.max(0, Math.floor((bbox.y / 100) * h));
      const sw = Math.max(1, Math.min(w - sx, Math.round((bbox.w / 100) * w)));
      const sh = Math.max(1, Math.min(h - sy, Math.round((bbox.h / 100) * h)));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("画布不可用"));
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

/** v25 手动制卡载荷（M5）：与 AI 制卡同构的字段集 + 图片选区 */

/**
 * 工具栏弹出组（D5-B）：按钮 + 面板。开合状态由宿主持有——两个组互斥、
 * 点外部/Esc 收起（见 Reader 的 mousedown/keydown effect），故这里不做内部开关。
 */
function ReaderToolMenu({
  id,
  label,
  open,
  onToggle,
  children
}: {
  id: "more" | "settings";
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dd" data-reader-tool-menu={id}>
      <button
        type="button"
        className="dd-btn"
        data-tool-menu-btn={id}
        aria-expanded={open}
        aria-controls={`reader-tool-menu-${id}`}
        onClick={onToggle}
      >
        {label}
        <IconChevronDown size={12} className="dd-caret" />
      </button>
      {open && (
        <div className="dd-menu reader-tool-menu" id={`reader-tool-menu-${id}`} data-tool-menu-panel={id}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function Reader({
  title,
  markdown,
  itemId,
  initialRatio = 0,
  initialCfi,
  initialPageIndex,
  contextLabel,
  contextRef,
  jumpAnchor,
  book,
  sourceTitle,
  onBack,
  onProgress,
  onSwitchAppTheme,
  openMindmapInitially,
  onMindmapOpened,
  openMindmapMapId,
  resumeRunId,
  onReviewExtracts,
  onReviewCards
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  /**
   * v48.23（D61 §6.8-11）：选区菜单状态扩为携带 `spans`（多段不相邻选择的原始采集物）。
   * `text` 恒为各段经主进程拼接后的文本——菜单与 5 个动作只读 text，故多段对所有动作自动生效。
   */
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    text: string;
    spans: ExtractSpan[];
    /** 选区包围盒（视口坐标）——菜单定位的锚点（R22 判据 4：不再用 pointerup 点） */
    rect: ReaderRect;
  } | null>(null);
  /** 多段选择集合（与主进程 updateSpanSet 同步的权威列表；DOM 顺序＝落库顺序） */
  const multiSpansRef = useRef<ExtractSpan[]>([]);
  /** 修饰键（settings.app.multiSelectKey；读侧归一，默认 Ctrl / macOS Meta） */
  const multiKeyRef = useRef<MultiSelectKey>("Ctrl");
  /**
   * 本次拖选手势**起手**的修饰位（v48.39 / D79）：`contentPointerDown` 上采样。
   * 加选/替换的判据＝起手或收尾（pointerup）任一时刻按住修饰键——真实用户收尾常先松修饰键
   * 再松鼠标，只看 pointerup 会把这次加选误判成「替换」、把已累计的集合抹成只剩最后一段。
   */
  const gestureModRef = useRef<ContentPointerDownInfo>({ x: 0, y: 0 });
  /** 选中态更新串行化：指针抬起是高频事件，主进程往返按序应用（避免两次拖选交错） */
  const spanQueueRef = useRef<Promise<void>>(Promise.resolve());
  // v25：图片聚焦（点选正文图片 → 上浮 + 周围模糊 + 选区工具条）
  const [focusImage, setFocusImage] = useState<{
    src: string;
    dataUrl: string;
    alt: string;
    rect: OcclusionRect;
    /** v29 图片周边文字上下文（D26）：AI 制卡结合上下文出题 */
    contextText?: string;
  } | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  /**
   * v48.13（P3）：续跑意图要在**挂载时快照**。
   * 原因：App 在 onMindmapOpened 里立刻清掉 view.resumeRunId（导航状态要干净），
   * 而真正用到它的是图谱页签里 MindmapTab 的挂载流程（要等收集完原文才续跑）——
   * 若直接读 prop，会读到已被清空的 null，续跑静默不发生。
   * v48.44（D84）：「打开导图」落点＝侧栏图谱页签（全屏 Overlay 工作区退役）。
   */
  const [resumeOnce] = useState<string | null>(resumeRunId ?? null);
  // v48.13（P2）：从右下角指示器进入时自动打开（只消费一次；标记即刻回执给 App 清除）
  useEffect(() => {
    if (!openMindmapInitially) return;
    setSidebarOpen(true);
    setSidebarTab("map");
    onMindmapOpened?.();
  }, [openMindmapInitially, onMindmapOpened]);
  const [toast, setToast] = useState<string | null>(null);
  // v25：showToast 上移到各交互回调之前（回调 deps 在渲染期求值，后置声明会触发 TDZ）
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const sourceTextRef = useRef("");
  const occlusionSourceRef = useRef<"engine" | "library">("engine");
  // 需求2：制卡时记录选区锚点（文本 + 当时刻度），随 contextRef 落库，供复习卡「跳转原文」
  const anchorRef = useRef<{ anchorText: string; anchorRatio: number } | null>(null);

  // ---------- 选区动作编排（批 4 Task 7，R30）：实现全在 src/lib/useSelectionActions.ts，
  // 这里只注入宿主能力（锚点/选区清理/图片聚焦）并接收状态与回调——Reader 不留动作实现副本。
  const selActions = useSelectionActions({
    selectionText: () => selection?.text ?? null,
    selectionSpans: () => selection?.spans,
    contextRef: () => enrichedContextRef(),
    sourceContext: () => ({ documentId: contextRef?.documentId, extractId: contextRef?.extractId }),
    labels: { title, sourceTitle, section: contextLabel },
    ownerKey: () => itemId || contextRef?.documentId || "",
    itemId,
    sourceTextRef,
    bodyText: markdown,
    lookupLocator: () => ({
      cfi: engineSelRef.current?.cfi ?? jumpAnchor?.cfi ?? null,
      pageIndex: engineSelRef.current?.pageIndex ?? jumpAnchor?.pageIndex ?? null
    }),
    anchorText: () => engineSelRef.current?.anchorText || anchorRef.current?.anchorText || null,
    rememberAnchor,
    clearSelection,
    clearAnchor: () => {
      anchorRef.current = null;
    },
    clearKernelSelection: () => {
      engineSelRef.current = null;
    },
    occlusionSourceRef,
    showToast,
    buildSourceAnchor,
    onManualSettled: () => {
      markCardRefOverrideRef.current = null;
    },
    focus: {
      get: () => focusImage,
      close: () => setFocusImage(null),
      setBusy: setFocusBusy
    }
  });
  const {
    aiPanel,
    setAiPanel,
    manualOpen,
    manualImage,
    manualQuote,
    dictPanel,
    setDictPanel,
    dictReading,
    dictFields,
    dictManualLang,
    acceptDraft,
    acceptOcclusionDraft,
    rejectAllDrafts,
    runExplain,
    runAICards,
    runOcclusionCards,
    searchAndRetry,
    runFollowUpCards,
    runExploration,
    acceptVocabCards,
    runLookup,
    setDictManualLangBoth,
    changeAiMode,
    aiMode,
    actions: selAct,
    submitRegionCards,
    submitRegionManual,
    handleManualCard,
    startManualWith,
    closeManual,
    createAnnotation
  } = selActions;

  // ---------- 阅读内核分支（v20：文件书走 foliate 内核；粘贴书/摘录 R1b 合流） ----------
  const engineMode = Boolean(book);
  /** v28 PDF 原生阅读：book.engine 决定内核实现（默认 foliate，存量书全走此分支） */
  const engineKind: "foliate" | "pdf" = book?.engine === "pdf" ? "pdf" : "foliate";
  // 引擎数据源必须按引用稳定（useMemo）：内联字面量会让 ReaderEngine 每次重渲染都销毁重建内核
  const engineSource = useMemo(
    () => (book ? { kind: "bytes" as const, bytes: book.bytes, name: book.name } : null),
    [book]
  );
  const kernelRef = useRef<ReaderKernel | null>(null);
  /** v48.14：引擎打开失败的可见错误态。此前 createKernel / k.open 抛出的异常
   * 没人接（未处理的 Promise rejection），界面只剩一片空白正文区，
   * 用户既不知道是书坏了还是软件挂了，也没有重试入口。 */
  const [engineError, setEngineError] = useState<string | null>(null);
  /** 重试计数：作为 ReaderEngine 的 key，改一次就重建一次内核 */
  const [engineRetry, setEngineRetry] = useState(0);
  // 换书（含换引擎格式）时清掉上一本的失败态，否则错误块会盖在新书上
  useEffect(() => {
    setEngineError(null);
  }, [engineSource]);
  // 引擎选区锚点：语义同 markdown 的 anchorRef——最后一次菜单动作的选区，保留到下一次覆盖
  const engineSelRef = useRef<ReaderSelection | null>(null);
  const engineChapterRef = useRef<number | undefined>(0);
  /** v48.24 批3（§4 写入侧）：与选区同时采集的源锚几何（PDF 页内百分比矩形；EPUB 为 null，cfi 在选区里）。
   *  必须在 `actXxx` 清选区**之前**采集——handleExtract 跑起来时选区已被 clearSelection 撤掉了 */
  const engineAnchorGeomRef = useRef<SourceAnchorGeometry | null>(null);
  // v35 正文图片锚点：点击正文图片时快照（当前 locator+章节+alt/周边文字），供图片卡 contextRef
  const imageAnchorRef = useRef<{
    locator: { cfi?: string; pageIndex?: number } | null;
    chapterIndex?: number;
    alt?: string;
    contextText?: string;
  } | null>(null);
  // v35 图片制卡来源：engine=正文图片（记图片锚点可跳转）/ library=资源库选图（图不在书中，无定位锚）
  const relocateTimerRef = useRef<number | null>(null);
  // v35 跳转图片卡：图内区域高亮叠加（宿主视口坐标，短暂显示）/ 原图对照浮层（定位失败或 PDF 系）
  const [imgOverlay, setImgOverlay] = useState<{ rect: ReaderRect; occlusion: NonNullable<Props["jumpAnchor"]>["occlusion"] } | null>(null);
  const [sourcePeek, setSourcePeek] = useState<{ occlusion: NonNullable<Props["jumpAnchor"]>["occlusion"] } | null>(null);
  // v48.24 批3（§4 文中留痕）：本文档的根摘录标记。
  // v48.45（D85，用户指令③）：**悬停浮层退役**（markHover 不再弹 MarkPopover）——
  // 点击标记＝唯一浮层入口（批注编辑浮层 AnnotationEditor，承接「已制卡 N 张」+「就此制卡」）。
  /** 批 4 Task 17：点标记 → 批注编辑浮层（形态唯一，与摘录页共用 AnnotationEditor） */
  const [markEditor, setMarkEditor] = useState<{
    id: string;
    kind: "highlight" | "extract";
    comment: string | null;
    color: string | null;
    anchor: ReaderRect;
  } | null>(null);
  const marksRef = useRef<ReaderDocMark[]>([]);
  /** 从浮层「就此制卡」进入时，本次制卡的 contextRef 覆盖值（挂到该摘录上——已制卡数按 extractId 派生） */
  const markCardRefOverrideRef = useRef<Record<string, unknown> | null>(null);
  /** 批注栏（D67 §3）：刚跳中的条目短时强调（不落库、不持久）＋导航有界失败的条目（中性态） */
  const [annotFocus, setAnnotFocus] = useState<string | null>(null);
  const [annotUnavailable, setAnnotUnavailable] = useState<Record<string, true>>({});
  const annotFocusTimerRef = useRef<number | null>(null);
  /** 内核标记文档序的版本号：安装/重画标记后 +1，侧栏注解栏据此重新取序 */
  const [marksOrderKey, setMarksOrderKey] = useState(0);
  /** 本文档的根注解条数（侧栏「摘录」页签与入口可用性的依据；与注解栏同一个 VM 口径） */
  const [docAnnotCount, setDocAnnotCount] = useState(0);
  /** 侧栏开合（v48.44/D84：入口恒可用——页签恒可点，不再按数据在场性自动收起） */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 工具栏两个弹出组（更多 / 阅读设置）：同刻只开一个，点外部/Esc 收起（D5-B） */
  const [toolMenu, setToolMenu] = useState<"more" | "settings" | null>(null);
  /** 批 4 Task 15：侧栏页签（**会话内**视图偏好，不落设置键——与 §5.3 栏内排序同规） */
  const [sidebarTab, setSidebarTab] = useState<ReaderTab>("toc");
  /** v48.45（D85）：注解排序（位置/时间）——栏头段控的会话内视图偏好，自 AnnotationPanel 提升受控 */
  const [annotSort, setAnnotSort] = useState<AnnotSort>("pos");
  /** v48.44（D84）：图谱页签画布的 portal 宿主（.reader-engine-main 内覆盖层；空＝不渲染画布） */
  const [mapLayerHost, setMapLayerHost] = useState<HTMLDivElement | null>(null);
  const [tocItems, setTocItems] = useState<ReaderTocItem[]>([]);
  const [tocActiveHref, setTocActiveHref] = useState<string | undefined>(undefined);

  /**
   * v48.44（D84）：原「图谱目录载入」（mindmapAPI.mapTree → 侧栏树形目录）随页签改版退役——
   * 图谱页签＝导图工作区面板（MindmapTab），节点跳转由画布选中/搜索承接；mapTree IPC 保留（仍有调用方）。
   *
   * 注解栏条目的「定位到该注解」（D67 §3）：只走内核 `goToMark(id)` 的精确锚
   * （EPUB＝该条 CFI；PDF＝pageIndex + rects），**不**回退 anchorText 文本搜索。
   * 成功＝栏内短时强调该条；有界失败＝该条显示中性「不可定位」，不假装跳转成功。
   */
  function jumpToMark(id: string) {
    clearReflowGuard();
    const k = kernelRef.current;
    if (!k?.goToMark) {
      setAnnotUnavailable((m) => ({ ...m, [id]: true }));
      return;
    }
    void k.goToMark(id).then((ok) => {
      if (!ok) {
        setAnnotUnavailable((m) => ({ ...m, [id]: true }));
        return;
      }
      setAnnotUnavailable((m) => {
        if (!m[id]) return m;
        const next = { ...m };
        delete next[id];
        return next;
      });
      setAnnotFocus(id);
      if (annotFocusTimerRef.current) window.clearTimeout(annotFocusTimerRef.current);
      annotFocusTimerRef.current = window.setTimeout(() => {
        annotFocusTimerRef.current = null;
        setAnnotFocus(null);
      }, 2500);
    });
  }

  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const readerSettingsRef = useRef(readerSettings);
  readerSettingsRef.current = readerSettings;


  // v29 选区菜单一击消失：菜单打开时，任何落在菜单/AI 面板/弹窗之外的 mousedown 立即关闭菜单。
  // （此前关闭只挂各 surface 的 pointerup——首点落在菜单/控制条等未跟踪元素时，文本选中已消失而菜单残留）
  // v48.23（D61 §6.8-11）：点菜单内不清空集合；点外面＝清空整组（高亮一并撤掉）。
  useEffect(() => {
    if (!selection) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" &&
        (t.closest(".selection-menu") || t.closest(".ai-panel") || t.closest(".modal-panel") || t.closest(".image-focus-layer") ||
          // v48.24 批3（§4 文中留痕）：标记浮层是「就此制卡」的动作面，点它不算点外面
          t.closest(".reader-mark-pop") ||
          // v48.23（§6.8-11）：正文内容区（PDF 文本层就落在宿主 DOM 里）不算「外面」——
          // 在那里按下鼠标常是「加选第二段」的起手，清集合会让多段选择在 PDF 上永远只剩最后一段。
          // foliate 的章节在 iframe 里，事件根本不冒泡到宿主，本项只影响 PDF 与宿主侧正文。
          t.closest(".reader-engine-host") ||
          // v48.41（D81）：工具栏选区动作组是动作面——点「摘录/制卡」时 mousedown 不得清集合与选区
          t.closest(".reader-sel-actions"))) return;
      clearMultiSelect();
      setSelection(null);
      engineSelRef.current = null;
    };
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocMouseDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // 多段选择的修饰键：settings.app.multiSelectKey（读侧归一；设置页改动即时生效）
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
  }, []);

  useEffect(() => {
    if (!engineMode) return;
    settingsStore
      .get<ReaderSettings>("app", "readerSettings", DEFAULT_READER_SETTINGS)
      .then((s) => {
        if (!s) return;
        setReaderSettings({
          mode: { ...DEFAULT_READER_SETTINGS.mode, ...s.mode },
          appearance: { ...DEFAULT_READER_SETTINGS.appearance, ...s.appearance }
        });
      })
      .catch(() => {});
  }, [engineMode]);

  const persistReaderSettings = (next: ReaderSettings) => {
    setReaderSettings(next);
    void settingsStore.set("app", "readerSettings", next);
  };

  const changeReaderMode = (mode: ReaderModeConfig) => {
    const next = { ...readerSettingsRef.current, mode };
    persistReaderSettings(next);
    void kernelRef.current?.setMode(mode);
  };
  const changeReaderTheme = (theme: ReaderAppearance["theme"]) => {
    const next = { ...readerSettingsRef.current, appearance: { ...readerSettingsRef.current.appearance, theme } };
    persistReaderSettings(next);
    kernelRef.current?.applyAppearance(resolveAppearance(next));
    // 整体换色（v20.1）：暗夜=软件夜间模式；纸白/羊皮=浅色；自定义不动软件主题
    if (theme === "dark") onSwitchAppTheme?.("dark");
    else if (theme === "paper" || theme === "sepia") onSwitchAppTheme?.("light");
  };
  // v29 PDF 专用缩放（foliate 引擎无此控件）
  const changeReaderZoom = (zoom: NonNullable<ReaderAppearance["zoom"]>) => {
    const next = { ...readerSettingsRef.current, appearance: { ...readerSettingsRef.current.appearance, zoom } };
    persistReaderSettings(next);
    kernelRef.current?.applyAppearance(resolveAppearance(next));
  };

  // 外观变量上提到滚动容器：控件/目录/背景统一随 --reader-* 变化（iframe 内由内核注入）
  useEffect(() => {
    if (!engineMode) return;
    const el = scrollRef.current;
    if (!el) return;
    const a = resolveAppearance(readerSettings);
    el.style.setProperty("--reader-bg", a.bgColor ?? "transparent");
    el.style.setProperty("--reader-fg", a.fgColor ?? "inherit");
    el.style.background = a.bgColor ?? "transparent";
  }, [engineMode, readerSettings]);

  /**
   * D2/§7（Task 7）：侧栏开合＝**布局变更**，不是用户翻页。
   * 布局引起的 relocate 不写进度（否则开一次侧栏就把进度挪一格）；PDF 数值缩放下还要把页内锚点
   * 一并还原（fit 模式由 pdf.js 自适应重算 scale，按契约只保当前页）。
   * 守卫是**瞬时**的（不落设置、不进数据库），三个确定性出口清除它：还原自己的 relocate 落地、
   * 兜底时限、或用户的下一次导航动作（turnPage / 各类跳转）。
   */
  type ReflowGuard = {
    restore?: () => void;
    restoring: boolean;
    clearTimer: number | null;
    /** 用户手势的即时出口：布局窗口里一旦有真实输入，就不再压制它的 relocate */
    endOnGesture: () => void;
  };
  const reflowGuardRef = useRef<ReflowGuard | null>(null);
  const clearReflowGuard = useCallback(() => {
    const g = reflowGuardRef.current;
    if (!g) return;
    if (g.clearTimer !== null) window.clearTimeout(g.clearTimer);
    window.removeEventListener("wheel", g.endOnGesture);
    window.removeEventListener("pointerdown", g.endOnGesture);
    window.removeEventListener("keydown", g.endOnGesture);
    reflowGuardRef.current = null;
  }, []);

  // 引擎进度：relocate 防抖落进度 + 阅读统计（charPos = fraction × 全书字符数近似，热力图口径不变）
  const handleEngineRelocate = useCallback(
    (info: RelocateInfo) => {
      const prevChapter = engineChapterRef.current;
      engineChapterRef.current = info.chapterIndex;
      // v48.23（D61 §6.8-11）：换章＝阅读内容变了，旧 Range 全部失效——
      // 先把多段集合与高亮清掉再收菜单（§6.8-11 的清理义务；滚动同章 relocate 不清）
      if (prevChapter !== undefined && info.chapterIndex !== undefined && prevChapter !== info.chapterIndex) {
        clearMultiSelect();
        setSelection(null);
      }
      setTocActiveHref(info.chapterHref);
      setImgOverlay(null); // v35：翻页/滚动即清除图内高亮（坐标系随视口失效）
      const guard = reflowGuardRef.current;
      if (guard) {
        // 布局变更期间的 relocate：撤掉可能已排队的进度写入，再决定是否做一次性还原
        if (relocateTimerRef.current) {
          window.clearTimeout(relocateTimerRef.current);
          relocateTimerRef.current = null;
        }
        if (!guard.restoring && guard.restore) {
          const run = guard.restore;
          guard.restore = undefined;
          guard.restoring = true;
          run();
        }
        // 抑制一直持续到守卫的**确定性出口**（用户手势 / 有界兜底）：reflow 与还原自己的
        // settle relocate 都属布局生成，一个都不写进度（早放行会让「开一次侧栏挪一格进度」漏进来）
        return;
      }
      if (relocateTimerRef.current) window.clearTimeout(relocateTimerRef.current);
      relocateTimerRef.current = window.setTimeout(() => {
        relocateTimerRef.current = null;
        if (itemId && onProgress) void readingStats.addEvent(itemId, Math.round(info.fraction * (markdown?.length || 0)));
        // v28 PDF 原生阅读：progress 携带页码锚点（pageIndex），foliate 系携带 cfi
        onProgress?.(info.fraction, "", { cfi: info.location.cfi, fraction: info.fraction, pageIndex: info.location.pageIndex });
      }, 700);
    },
    [itemId, markdown, onProgress, clearReflowGuard]
  );

  /** 侧栏开合（D5-B 入口）：先快照+布防，再改宽度——布局引起的 relocate 不写进度 */
  const toggleSidebar = useCallback(() => {
    const k = kernelRef.current;
    const zoom = readerSettingsRef.current.appearance.zoom;
    const cfi = k?.getCurrentLocation?.()?.cfi ?? null;
    // 数值缩放才需要页内锚点还原；fit 模式只保当前页（引擎自适应）
    const point = typeof zoom === "number" ? k?.captureViewPoint?.() ?? null : null;
    const restore = () => {
      if (point) k?.restoreViewPoint?.(point);
      else if (cfi) void k?.goTo?.({ cfi });
    };
    // 用户手势＝布局窗口结束（之后属于用户自己的导航，照常写进度）
    const endOnGesture = () => clearReflowGuard();
    const guard: ReflowGuard = { restore, restoring: false, clearTimer: null, endOnGesture };
    clearReflowGuard();
    reflowGuardRef.current = guard;
    window.addEventListener("wheel", endOnGesture, { passive: true });
    window.addEventListener("pointerdown", endOnGesture);
    window.addEventListener("keydown", endOnGesture);
    setSidebarOpen((v) => !v);
    if (point) {
      // PDF 数值缩放：宽度变化不产生 relocate（页码没变）⇒ 布局落地后自己还原（两帧足够）
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (reflowGuardRef.current !== guard || !guard.restore) return;
          guard.restore = undefined;
          guard.restoring = true;
          restore();
        })
      );
    }
    // 兜底（有界）：还原的 relocate 迟迟不来（引擎无 relocate / 位置本就未变）时也要收掉守卫，
    // 不让它长期压制用户后续的进度写入
    guard.clearTimer = window.setTimeout(() => clearReflowGuard(), 3000);
  }, [clearReflowGuard]);

  // 引擎选区：pointerup 时取选区语义数据并弹出菜单（坐标为宿主视口坐标，菜单用 fixed）
  // v48.23（D61 §6.8-11）：按住修饰键（app.multiSelectKey，默认 Ctrl）再选＝加选：
  // 集合运算与拼接文本一律交主进程（resolveSpanSet → electron/annotationRange.js），
  // 本层只负责采集「这一段」并画高亮；不带修饰键＝替换（普通拖选覆盖旧集合）。
  // v48.39（D79）：修饰键按**手势全程**判定——起手（gestureModRef，contentPointerDown 上采样）
  // 或收尾（pointerup）任一时刻按住＝加选。真实用户收尾常先松修饰键再松鼠标，只看 pointerup
  // 会把这次加选误判成替换、把已累计的集合抹成只剩最后一段（用户实测：先普通选一段再 Ctrl 补选失败）。
  const handleEnginePointerUp = useCallback((pos: ContentPointerUpInfo) => {
    const k = kernelRef.current;
    const sel = k?.getSelection() ?? null;
    if (!sel || !sel.text.trim()) {
      // 空白处点击/折叠选区：沿用旧语义收菜单，并把整组多段集合清掉（高亮一并撤）
      clearMultiSelect();
      engineAnchorGeomRef.current = null;
      setSelection(null);
      return;
    }
    engineSelRef.current = sel;
    // v48.24 批3（§4 写入侧）：源锚几何与选区同时采集（handleExtract 跑时选区已被清掉）
    engineAnchorGeomRef.current = k?.getSourceAnchor?.() ?? null;
    const geom = k?.getSelectionGeometry();
    const incoming: ExtractSpan = {
      text: sel.text,
      rects: geom ? [{ x: geom.x, y: geom.y, w: geom.width, h: geom.height }] : []
    };
    // v48.39（D79）：起手与收尾任一按住修饰键＝加选（手势全程判定；语义域见函数头注释）
    const withModifier =
      modifierFlagOf(multiKeyRef.current, gestureModRef.current) || modifierFlagOf(multiKeyRef.current, pos);
    // 串行化：两次拖选的往返按序应用，后者永远读到前者落定的集合
    spanQueueRef.current = spanQueueRef.current
      .then(async () => {
        const r = await resolveSpanSet(multiSpansRef.current, incoming, withModifier);
        if (r.action === "none") return; // 空白新选区：集合不动（内核 updateSpanSet 的语义）
        multiSpansRef.current = r.spans;
        kernelRef.current?.multiSelectHighlight?.(r.action);
        (window as unknown as { __readerMultiSpans?: ExtractSpan[] }).__readerMultiSpans = r.spans;
        setSelection({
          x: pos.x,
          y: pos.y,
          text: r.text,
          spans: r.spans,
          // 选区几何（视口坐标）优先；内核未给几何时退化为 pointerup 点（宽高 0）
          rect: geom ? { x: geom.x, y: geom.y, width: geom.width, height: geom.height } : { x: pos.x, y: pos.y, width: 0, height: 0 }
        });
      })
      .catch(() => {
        // 主进程往返失败（理论上不可达）：不静默改集合，避免菜单与库不一致
        showToast("多段选择暂不可用");
      });
  }, [showToast]);

  const handleEngineReady = useCallback((k: ReaderKernel) => {
    kernelRef.current = k;
    setEngineError(null);
    setTocItems(k.getTOC());
    void k.setMode(readerSettingsRef.current.mode);
    k.applyAppearance(resolveAppearance(readerSettingsRef.current));
    // 调试/测试钩子（L2 e2e 经此访问章节文档；引擎 iframe 对宿主跨源，contentDocument 不可用）
    (window as unknown as { __readerKernel?: ReaderKernel }).__readerKernel = k;
    // v48.24 批3（§4 文中留痕）：点中标记 → 批注编辑浮层（v48.45/D85：唯一浮层——
    // 悬停不再弹层；浮层内含聚合「已制卡 N 张」与「就此制卡」）。数据按 id 回查 marksRef。
    k.on("markClick", (info) => {
      if (!info.id || !info.rect) return;
      const m = marksRef.current.find((x) => x.id === info.id);
      if (m) {
        setMarkEditor({
          id: m.id,
          kind: m.kind === "highlight" ? "highlight" : "extract",
          comment: m.comment ?? null,
          color: m.color ?? null,
          anchor: info.rect
        });
      }
    });
    // 数据先到（marksRef 已填）而内核后到：这里补推一次；反之由标记 effect 自己推
    if (marksRef.current.length) k.setDocumentMarks?.(marksRef.current);
    // v48.39（D79）：多段选择按手势全程判定修饰键——拖选起手采样修饰位，pointerup 收尾时与之求或
    k.on("contentPointerDown", (pos) => {
      gestureModRef.current = pos;
    });
    // v35 图片卡跳转：跳转着陆后再找原图叠图内高亮；找不到/PDF 系 → 原图对照浮层
    if (jumpAnchor?.occlusion) window.setTimeout(() => void tryLocateJumpImage(), 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v35：从复习/浏览跳入的图片卡——内核 locateImage 找回正文原图（foliate 系），命中叠加本卡区域高亮
  const tryLocateJumpImage = useCallback(async () => {
    const occ = jumpAnchor?.occlusion;
    if (!occ) return;
    const k = kernelRef.current;
    const ia = jumpAnchor?.imageAnchor;
    let hit: ImageLocateHit | null = null;
    if (k?.locateImage && ia && (ia.alt || ia.contextText)) {
      try {
        hit = await k.locateImage({ alt: ia.alt, contextText: ia.contextText });
      } catch {
        hit = null;
      }
    }
    if (hit) setImgOverlay({ rect: hit.rect, occlusion: occ });
    else if (occ.assetPath) setSourcePeek({ occlusion: occ });
  }, [jumpAnchor]);

  // v35 图内高亮短暂显示：超时自清（翻页/滚动由 relocate 清）
  useEffect(() => {
    if (!imgOverlay) return;
    const t = window.setTimeout(() => setImgOverlay(null), 5000);
    return () => window.clearTimeout(t);
  }, [imgOverlay]);

  // v35 markdown 分支（无内核）图片定位：宿主 DOM 按 alt/周边文字找图
  const locateMarkdownImage = useCallback(async (occ: NonNullable<Props["jumpAnchor"]>["occlusion"]) => {
    if (!occ) return;
    const el = scrollRef.current;
    const ia = jumpAnchor?.imageAnchor;
    const alt = (ia?.alt || "").replace(/\s+/g, " ").trim();
    const ctxKey = (ia?.contextText || "").replace(/\s+/g, " ").trim().slice(0, 40);
    let hit: HTMLImageElement | null = null;
    if (el && (alt || ctxKey)) {
      let bestScore = 0;
      let best: HTMLImageElement | null = null;
      for (const img of Array.from(el.querySelectorAll("img")) as HTMLImageElement[]) {
        let score = 0;
        const imgAlt = (img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
        if (alt && imgAlt && (imgAlt === alt || imgAlt.includes(alt) || alt.includes(imgAlt))) score += 4;
        if (ctxKey) {
          const block = img.closest("p, li, figure, blockquote, div") || img.parentElement;
          const around = (block?.textContent || "").replace(/\s+/g, " ");
          if (around.includes(ctxKey)) score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          best = img;
        }
      }
      hit = best;
    }
    if (!hit) {
      if (occ.assetPath) setSourcePeek({ occlusion: occ });
      return;
    }
    const imgEl: HTMLImageElement = hit;
    imgEl.scrollIntoView({ block: "center" });
    await new Promise((r) => window.setTimeout(r, 350));
    const r = imgEl.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) {
      if (occ.assetPath) setSourcePeek({ occlusion: occ });
      return;
    }
    setImgOverlay({ rect: { x: r.left, y: r.top, width: r.width, height: r.height }, occlusion: occ });
  }, [jumpAnchor]);

  // v25 图片点选聚焦：正文图片点击 → 取字节为 dataURL → 进入聚焦覆盖层（选区工具条）
  // v29：携带图片周边文字上下文（D26），供 AI 制卡结合上下文出题
  const handleEngineImageClick = useCallback(
    async (img: ReaderImageRef) => {
      if (manualOpen || aiPanel || focusImage) return; // 弹层/聚焦在场时不重复进入
      const dataUrl = await loadImageDataUrl(img.src);
      if (!dataUrl) {
        showToast("无法读取这张图片的内容（可能来自外部链接）");
        return;
      }
      setSelection(null);
      engineSelRef.current = null;
      // v35 图片锚点快照：此刻的 locator+章节+alt/周边文字——图片卡 contextRef 的定位来源
      imageAnchorRef.current = {
        locator: kernelRef.current?.getCurrentLocation() ?? null,
        chapterIndex: engineChapterRef.current,
        alt: img.alt || undefined,
        contextText: img.contextText || undefined
      };
      setFocusImage({
        src: img.src,
        dataUrl,
        alt: img.alt,
        rect: { x: img.rect.x, y: img.rect.y, w: img.rect.width, h: img.rect.height },
        contextText: img.contextText
      });
    },
    [manualOpen, aiPanel, focusImage, showToast]
  );

  /** v25：选区提交前把整图落盘（assets 表）——卡片 occlusion_json 需要稳定的 assetPath */
  const ensureImageAsset = useCallback(
    async (dataUrl: string): Promise<string | null> => {
      const ownerKey = itemId || contextRef?.documentId || "";
      if (!ownerKey) {
        showToast("无法确定图片归属的书籍");
        return null;
      }
      const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
      if (!m) {
        showToast("图片数据不可用");
        return null;
      }
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const saved = await window.assetsAPI?.saveImage(ownerKey, ext, m[2]);
      if (!saved || (saved as { error?: string }).error || !saved.assetPath) {
        showToast((saved as { error?: string } | null)?.error || "图片保存失败");
        return null;
      }
      return saved.assetPath;
    },
    [itemId, contextRef, showToast]
  );

  const clearEngineSelection = () => {
    kernelRef.current?.deselect();
    setSelection(null);
  };

  // 翻页（v20.1）：内核 prev/next 自动跨章节；滚动/分页/对开三模式通用
  const turnPage = useCallback(async (dir: 1 | -1) => {
    const k = kernelRef.current;
    if (!k) return;
    // 用户主动翻页＝真实导航：先收掉布局守卫（否则紧接着的 relocate 会被当成布局变更而漏记进度）
    clearReflowGuard();
    if (dir === 1) await k.next();
    else await k.prev();
  }, []);

  useEffect(() => {
    if (!engineMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (manualOpen || aiPanel || focusImage) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        void turnPage(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
        e.preventDefault();
        void turnPage(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engineMode, manualOpen, aiPanel, focusImage, turnPage]);

  useEffect(
    () => () => {
      if (relocateTimerRef.current) window.clearTimeout(relocateTimerRef.current);
    },
    []
  );

  // 需求2：制卡时记录选区锚点（文本 + 当时刻度），随 contextRef 落库，供复习卡「跳转原文」
  // v34（M12）：本次制卡的完整源文本（短材料锚点键的长度门控输入，§4.16 item 5）
  function rememberAnchor(text: string) {
    sourceTextRef.current = text || "";
    const el = scrollRef.current;
    const denom = el ? el.scrollHeight - el.clientHeight : 0;
    anchorRef.current = {
      anchorText: text.slice(0, 60),
      anchorRatio: denom > 0 && el ? Math.min(1, el.scrollTop / denom) : 0
    };
  }

  function enrichedContextRef() {
    // v48.24 批3（§4）：从标记浮层「就此制卡」进入时，contextRef 直接取该摘录（挂 extractId，
    // 别串到「当前选区」——浮层出现时选区可能已经不在或换了地方）
    if (markCardRefOverrideRef.current) return markCardRefOverrideRef.current;
    // 引擎分支：可降级定位（foliate 系 cfi → chapterIndex → anchorText；PDF 系 pageIndex → anchorText），带引擎版本便于回归归因
    if (engineMode) {
      const sel = engineSelRef.current;
      if (sel) {
        return {
          ...(contextRef || {}),
          ...buildLocator({ cfi: sel.cfi, chapterIndex: engineChapterRef.current, pageIndex: sel.pageIndex, anchorText: sel.anchorText })
        };
      }
      // v35 图片卡：无文本选区但有图片锚点快照 → 以图片所在位置定位（alt/周边文字供阅读器找回原图）
      const imgA = imageAnchorRef.current;
      if (imgA) {
        const fallbackText = (imgA.contextText || imgA.alt || "").trim();
        return {
          ...(contextRef || {}),
          ...buildLocator({
            cfi: imgA.locator?.cfi,
            chapterIndex: imgA.chapterIndex,
            pageIndex: imgA.locator?.pageIndex,
            anchorText: fallbackText || "〔正文图片〕"
          }),
          imageSource: "engine" as const,
          imageAnchor: { alt: imgA.alt, contextText: imgA.contextText }
        };
      }
      return contextRef || null;
    }
    return anchorRef.current ? { ...(contextRef || {}), ...anchorRef.current } : contextRef || null;
  }


  // v48.23（D61 §6.8-11）：Esc 清空整个多段集合（含菜单与高亮；无集合时按旧行为只收菜单）
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (manualOpen || aiPanel) return; // 弹层自己处理 Esc
      clearMultiSelect();
      clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, manualOpen, aiPanel]);


  // AI 运行中每秒跳一次已等待秒数——让用户确信程序没有卡死（含补充制卡/询问 AI 期间）
  const [nowTick, setNowTick] = useState(Date.now());
  const anyFollowUp = (aiPanel?.followUpBusy?.length ?? 0) > 0;
  const anyExploration = (aiPanel?.explorations ?? []).some((e) => e.running);
  useEffect(() => {
    if (!aiPanel?.running && !anyFollowUp && !anyExploration) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [aiPanel?.running, anyFollowUp, anyExploration]);
  const elapsedSec = aiPanel?.running && aiPanel.startedAt ? Math.max(0, Math.round((nowTick - aiPanel.startedAt) / 1000)) : 0;

  // 恢复上次阅读位置
  useEffect(() => {
    if (engineMode) return; // 引擎模式由内核 initLocation/CFI 恢复
    if (restoredRef.current) return;
    restoredRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    // 优先锚点跳转（从复习卡「跳转原文」进入）：定位到含 anchorText 的块并高亮一下
    const anchor = jumpAnchor?.anchorText || contextRef?.anchorText;
    if (anchor) {
      requestAnimationFrame(() => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const idx = (node.textContent || "").indexOf(anchor.slice(0, 24));
          if (idx >= 0) {
            const range = document.createRange();
            range.setStart(node, idx);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            el.scrollTop += rect.top - el.getBoundingClientRect().top - el.clientHeight * 0.3;
            // 短暂高亮锚点块，帮助定位视线
            let block: HTMLElement | null = node.parentElement;
            while (block && !/^P$|^(H[1-3])$|^LI$|^BLOCKQUOTE$/.test(block.tagName)) block = block.parentElement;
            if (block) {
              // 走 Token：原写死 rgba(0,47,167,.08) 是浅色 IKB 的 8%，
              // 深色模式底色是 #101010，那点蓝几乎看不见（锚点定位提示失效）
              block.style.background = "var(--accent-soft)";
              window.setTimeout(() => (block!.style.background = ""), 1600);
            }
            return;
          }
        }
        // 找不到锚点文本时退回比例定位（v35：优先本卡制卡时的滚动比例，而非上次阅读进度）
        const fallback = jumpAnchor?.anchorRatio ?? initialRatio;
        if (fallback > 0) el.scrollTop = fallback * (el.scrollHeight - el.clientHeight);
        // v35：图片卡跳转（markdown 分支无内核）——正文 img 按 alt/周边文字找回，命中叠加图内高亮
        if (jumpAnchor?.occlusion) void locateMarkdownImage(jumpAnchor.occlusion);
      });
      return;
    }
    if (initialRatio <= 0) return;
    requestAnimationFrame(() => {
      el.scrollTop = initialRatio * (el.scrollHeight - el.clientHeight);
    });
  }, [initialRatio, markdown]);

  const saveProgress = useCallback(() => {
    if (engineMode) return; // 引擎模式进度由 kernel relocate 事件驱动，滚动比例无意义
    const el = scrollRef.current;
    if (!el || !onProgress) return;
    const denom = el.scrollHeight - el.clientHeight;
    const ratio = denom > 0 ? Math.min(1, el.scrollTop / denom) : 0;
    // 阅读字数统计：滚动停止时按"视口顶部对齐块"在 DOM 中的累计字符偏移记事件，
    // 当日字数 = 相邻事件正增量之和（往回滚不计；跳回重读不产生负增量）
    if (itemId) {
      const all = Array.from(el.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, blockquote"));
      let charPos = 0;
      for (let i = 0; i < all.length; i++) {
        const rect = all[i].getBoundingClientRect();
        if (rect.top >= -rect.height && rect.top < window.innerHeight * 0.4 && all[i].textContent?.trim()) {
          charPos = all.slice(0, i).reduce((acc, b) => acc + (b.textContent?.length || 0), 0);
          break;
        }
      }
      void readingStats.addEvent(itemId, charPos);
    }
    let lastText = "";
    const blocks2 = el.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, blockquote");
    for (const b of blocks2) {
      const rect = b.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight * 0.4 && b.textContent?.trim()) {
        lastText = b.textContent.trim().slice(0, 140);
        break;
      }
    }
    onProgress(ratio, lastText);
  }, [onProgress, itemId]);

  const saveProgressRef = useRef(saveProgress);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveProgressRef.current();
    };
  }, []);

  const handleScroll = useCallback(() => {
    setSelection(null);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(saveProgress, 700);
  }, [saveProgress]);

  function handleMouseUp() {
    const el = scrollRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || !sel.rangeCount || text.length === 0 || !el.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = el.getBoundingClientRect();
    // 菜单必须留在滚动容器内部：钳制上/下边界，避免浮到顶栏拖动区
    const menuW = 320;
    const x = Math.max(menuW / 2 + 8, Math.min(containerRect.width - menuW / 2 - 8, rect.left - containerRect.left + rect.width / 2));
    const y = Math.max(8, Math.min(containerRect.height - 96, rect.top - containerRect.top - 48));
    setSelection({
      x,
      y,
      text,
      // 粘贴书/摘录的 markdown 分支没有内核（不会走到多段选择），恒为单段
      spans: [{ text }],
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    });
  }

  /**
   * v48.23（D61 §6.8-11）：清空多段选择集合——权威列表、内核高亮、测试钩子三处一起清。
   * 调用点：点菜单外 / Esc / 菜单动作完成 / 换章（阅读内容变化）/ 空选区 pointerup。
   */
  function clearMultiSelect() {
    multiSpansRef.current = [];
    (window as unknown as { __readerMultiSpans?: ExtractSpan[] }).__readerMultiSpans = [];
    kernelRef.current?.clearMultiSelectHighlight?.();
  }

  function clearSelection() {
    if (engineMode) {
      kernelRef.current?.deselect();
      clearMultiSelect();
      setSelection(null);
      return;
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  // ---------- v48.24 批3（§4 文中留痕）：数据结构与绘制 ----------

  /**
   * 本文档要画的标记：数据面＝buildDocMarks（纯函数，吃 workflowAPI.listAll() 与按 extractId 派生的
   * 已制卡数），绘制面＝内核 setDocumentMarks（PDF 矩形层 / EPUB cfi→Range 高亮）。
   * 只在**真文档**上画：摘录阅读视图（contextRef.extractId）读的是合成 EPUB，画上去会张冠李戴。
   * 摘录/制卡一变就重算（workflow/changed、cards/changed），于是「刚摘完就出现留痕、刚制完卡计数+1」。
   */
  useEffect(() => {
    const documentId = contextRef?.documentId;
    if (!engineMode || !documentId || contextRef?.extractId) {
      marksRef.current = [];
      kernelRef.current?.setDocumentMarks?.([]);
      setDocAnnotCount(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [rows, cards] = await Promise.all([
          window.workflowAPI?.listAll?.() ?? Promise.resolve([]),
          cardsApi.listAll().catch(() => [])
        ]);
        if (cancelled) return;
        // v48.45（D85）：已制卡数＝**聚合口径**——该条摘录及其全部子孙摘录上的卡之和（用户点名：
        // 子摘录、子子摘录以及更下层的摘录产生的制卡都算进去）。先按直卡统计，再沿父→子邻接表聚合。
        const counts: Record<string, number> = {};
        for (const c of cards as Array<{ contextRef?: { extractId?: string } | null; isDeleted?: number }>) {
          const id = c?.contextRef?.extractId;
          if (id && !c.isDeleted) counts[id] = (counts[id] || 0) + 1;
        }
        const parentToChildren = new Map<string, string[]>();
        for (const r of rows as Array<{ id?: string; contextRef?: { parentExtractId?: string | null } | null }>) {
          const pid = r?.contextRef?.parentExtractId;
          if (pid && r?.id) {
            const list = parentToChildren.get(String(pid)) ?? [];
            list.push(String(r.id));
            parentToChildren.set(String(pid), list);
          }
        }
        const aggCounts = aggregateCardCounts(counts, parentToChildren);
        const marks = buildDocMarks(rows, documentId, engineKind, aggCounts);
        marksRef.current = marks;
        kernelRef.current?.setDocumentMarks?.(marks);
        // 文档序只能问内核（EPUB 的 CFI 只有引擎 resolve 得动）——装完标记通知侧栏重取
        setMarksOrderKey((v) => v + 1);
        // 侧栏「摘录」页签与入口可用性用同一个 VM 口径（含无锚老数据——它们也在栏里）
        setDocAnnotCount(buildAnnotationItems(rows, documentId, engineKind).length);
      } catch {
        /* 标记是增强信息：取不到就不画，阅读/制卡链路不受影响 */
      }
    };
    void load();
    const offWorkflow = eventBus.on("workflow/changed", () => void load());
    const offCards = eventBus.on("cards/changed", () => void load());
    // 主题/强调色一变，注入 iframe 的高亮字面值要重算——但**必须在主题真正落地之后**：
    // changeReaderTheme 是先 applyAppearance 再 onSwitchAppTheme，此刻 body 还是旧档，
    // 在 applyAppearance 里重算会拿到旧色（实测：切回纸白后 iframe 里仍是深色档的蓝）。
    // 统一挂到 theme/changed（App 在 setTheme 落定后发出）与 accentColor 变更上，重推一次标记。
    const offTheme = eventBus.on("theme/changed", () => kernelRef.current?.setDocumentMarks?.(marksRef.current));
    const offAccent = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.key === "accentColor") kernelRef.current?.setDocumentMarks?.(marksRef.current);
    });
    return () => {
      cancelled = true;
      offWorkflow();
      offCards();
      offTheme();
      offAccent();
    };
  }, [engineMode, engineKind, contextRef?.documentId, contextRef?.extractId]);

  /**
   * 源锚装配（§6.8-11 三条腿的容器形态，批3 写入侧）：摘录落 `contextRef.sourceAnchor`，
   * 文中留痕据此重画。rects 是**页内百分比**（内核在选区还活着时采集），cfi 表达 EPUB 位置；
   * anchorText + anchorRatio 是位置只记录不重找的兜底（与 Zotero 一致：不做模糊重锚定）。
   */
  function buildSourceAnchor(text: string): Record<string, unknown> | null {
    const documentId = contextRef?.documentId;
    if (!documentId) return null;
    const sel = engineSelRef.current;
    const geom = engineAnchorGeomRef.current;
    const loc = buildLocator({
      cfi: sel?.cfi,
      chapterIndex: sel ? engineChapterRef.current : undefined,
      pageIndex: geom?.pageIndex ?? sel?.pageIndex,
      anchorText: sel?.anchorText || text.slice(0, 60)
    });
    const el = scrollRef.current;
    const denom = el ? el.scrollHeight - el.clientHeight : 0;
    return {
      documentId,
      ...loc,
      ...(geom?.rects?.length ? { rects: geom.rects } : {}),
      anchorRatio: denom > 0 && el ? Math.min(1, el.scrollTop / denom) : 0,
      capturedAt: Date.now()
    };
  }

  /** 浮层「就此制卡」（§4）：复用既有手动制卡链（ManualCardEditor → createSingleCard），
   *  contextRef 挂到该摘录上（extractId）——「已制卡数」就是按它派生的。 */
  function startMarkCard(mark: ReaderDocMark) {
    const documentId = contextRef?.documentId;
    if (!documentId) return;
    markCardRefOverrideRef.current = {
      documentId,
      extractId: mark.id,
      ...buildLocator({ cfi: mark.cfi, pageIndex: mark.pageIndex, anchorText: mark.text.slice(0, 60) })
    };
    sourceTextRef.current = mark.text;
    const el = scrollRef.current;
    const denom = el ? el.scrollHeight - el.clientHeight : 0;
    anchorRef.current = {
      anchorText: mark.text.slice(0, 60),
      anchorRatio: denom > 0 && el ? Math.min(1, el.scrollTop / denom) : 0
    };
    startManualWith(mark.text);
  }

  // 批 4 Task 12：标注模式/形式与色板取自设置键（app.annotateMode / annotateForm / annotatePalette / annotateCustomEnabled）
  // ——模式（点色是否进队列）与形式（底色/下划线，v48.42/D82 拆独立键）持久记忆；改设置有 settings/changed 即时生效
  const annotSettings = useAnnotationSettings();
  const annotMode = annotSettings.annotateMode;
  const setAnnotMode = (m: AnnotMenuMode) => void writeAnnotationSetting("annotateMode", m);
  const annotForm = annotSettings.annotateForm;
  const setAnnotForm = (f: AnnotMarkForm) => void writeAnnotationSetting("annotateForm", f);
  const ANNOT_PALETTE: readonly AnnotColor[] = annotSettings.annotatePalette as readonly AnnotColor[];

  /**
   * 多段选择修饰键按住期（规格 §6.8-11 与 R22 的冲突调和）：菜单**让路**不接管指针。
   * 实测因果：两行菜单高 79px，按 R22 落在选区下方时会盖住下一行的拖选线
   * （multiselect.gui：菜单 y 195–274 盖住第二段 y=267）→ 不给让路则该套件 6 条判据全红；
   * 差分确认（把菜单临时改成 prefer="above" 复跑即 20/20）后定为「按住修饰键期间菜单不接指针」。
   */
  const [multiKeyHeld, setMultiKeyHeld] = useState(false);
  useEffect(() => {
    // 修饰键状态一律从**指针事件**取（与内核 modifierFlagOf 同一信号源）：
    // foliate 章节在 iframe 里，其 keyup 不转发到宿主（adapter 已注明），靠宿主 keydown/keyup
    // 跟踪会在「拖完松手」时卡在按住态——实测该残留态会让菜单永久不接指针、点不动「摘录」。
    // 指针事件则两处都有：宿主正文直接冒泡，iframe 内的由 adapter 中继。
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

  /**
   * R38/R40：点色＝完成当前模式与形式的标注（颜色不记）。
   * 高亮＝纯批注（不进队列）；摘录+高亮＝建 kind="extract" 的摘录（进队列）；形式＝底色/下划线（annotation_type）。
   * 随后弹 AnnotationEditor 写批注（Task 11 接；本轮只落库不带批注）。
   */
  async function handlePickColor(color: AnnotColor, comment: string) {
    if (!selection) return;
    const text = selection.text;
    const spans = selection.spans;
    clearSelection();
    // v48.43（D83）：批注文字随选区菜单批注框一次带上（空串＝无批注）；不弹编辑浮层
    await createAnnotation(text, spans, color, annotMode, annotForm, comment || null);
  }

  // 阅读场景快捷键（制卡 Ctrl+Z / AI 制卡 Ctrl+X / AI 解释 Ctrl+A / 摘录 Ctrl+S / 查词 Ctrl+D）：
  // 仅当存在活动选区且无手动制卡弹窗、无 AI 面板时可用（弹层开着不触发新动作）
  const readerShortcutReady = !!selection && !manualOpen && !aiPanel && !dictPanel;
  useCommandActions("reader", {
    "reader.makeCard": { when: () => readerShortcutReady, run: () => selAct.manual() },
    "reader.aiCards": { when: () => readerShortcutReady, run: () => selAct.aiCards() },
    "reader.aiExplain": { when: () => readerShortcutReady, run: () => selAct.explain() },
    "reader.extract": { when: () => readerShortcutReady, run: () => selAct.extract() },
    "reader.lookupWord": { when: () => readerShortcutReady, run: () => selAct.lookup() }
  });

  // v48.43（D83）：选区动作组＝模式/形式段控（批注栏头同款样式）＋动作钮（批注栏头同族无框）。
  // 段控是持久偏好（无选区也可切）；动作钮无选区 disabled（不可点无 🚫，暗色可读）。
  // 图片挖空＝正文图片选区流程入口。data-sel-act 钩子与摘录页工具栏同一套。
  const selActionsGroup = (
    <div className="reader-engine-controls-group reader-sel-actions" data-sel-actions>
      <div className="seg-rail" role="group" aria-label="标注模式">
        <button type="button" className={annotMode === "highlight" ? "on" : undefined} data-annot-mode="highlight" onClick={() => setAnnotMode("highlight")}>高亮</button>
        <button type="button" className={annotMode === "extract" ? "on" : undefined} data-annot-mode="extract" onClick={() => setAnnotMode("extract")}>摘录+高亮</button>
      </div>
      <div className="seg-rail" role="group" aria-label="标记形式">
        <button type="button" className={annotForm === "highlight" ? "on" : undefined} data-annot-form="highlight" onClick={() => setAnnotForm("highlight")}>高亮</button>
        <button type="button" className={annotForm === "underline" ? "on" : undefined} data-annot-form="underline" onClick={() => setAnnotForm("underline")}>下划线</button>
      </div>
      <button type="button" className="btn-rail" data-sel-act="manual" disabled={!selection} title={selection ? "就地制卡" : "先选中文字"} onClick={selAct.manual}>制卡</button>
      <button type="button" className="btn-rail" data-sel-act="aiCards" disabled={!selection} title={selection ? "AI 制卡" : "先选中文字"} onClick={selAct.aiCards}>AI 制卡</button>
      <button type="button" className="btn-rail" data-sel-act="explain" disabled={!selection} title={selection ? "AI 解释" : "先选中文字"} onClick={selAct.explain}>AI 解释</button>
      <button type="button" className="btn-rail" data-sel-act="extract" disabled={!selection} title={selection ? "摘录进学习队列" : "先选中文字"} onClick={selAct.extract}>摘录</button>
      <button type="button" className="btn-rail" data-sel-act="lookup" disabled={!selection} title={selection ? "查词" : "先选中文字"} onClick={selAct.lookup}>查词</button>
      <button type="button" className="btn-rail" data-sel-act="occlusion" disabled={!selection} title={selection ? "图片挖空" : "先选中文字"} onClick={selAct.occlusion}>图片挖空</button>
    </div>
  );

  /**
   * 侧栏可用性（v48.44/D84）：**恒可用**——三页签恒可点（空数据＝页签内空态），
   * 入口不再按「目录/注解/图谱任一在场」收缩（D2 口径作废）。
   */
  /** 工具栏弹出组：点外部（含正文/侧栏）或 Esc 收起；组内点击不算外部 */
  useEffect(() => {
    if (!toolMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest("[data-reader-tool-menu]")) return;
      setToolMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolMenu(null);
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [toolMenu]);

  return (
    <div className="reader-wrap">
      <div className={`reader-body${aiPanel ? " reader-body-shifted" : ""}`}>
        <div
          ref={scrollRef}
          className={`reader-scroll${engineMode ? " reader-scroll-engine" : ""}`}
          onMouseUp={engineMode ? undefined : handleMouseUp}
          onScroll={engineMode ? undefined : handleScroll}
        >
          {engineSource ? (
            <>
              {/* v48.45（D85）：开关钮＝摘录页同一枚（fixed 视口左上 16, 48+12，浮在轨顶）；
                  「更多」不再含导图（已并入侧栏图谱页签）；翻页组在「更多」左侧。 */}
              <button
                className="annot-toggle bar-btn"
                data-reader-sidebar-toggle
                aria-expanded={sidebarOpen}
                aria-controls="reader-sidebar"
                title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
                onClick={toggleSidebar}
              >
                {sidebarOpen ? "收起" : "展开"}
              </button>
              {/* v48.45（D85）：侧栏升级**全高左轨**——一行两格（轨 + 右列），与摘录批注轨同一形态：
                  贯通到顶、280↔0 滑动动画、展开时工具栏随右列整体右移。 */}
              <div className="reader-engine-layout">
                <div
                  className={`reader-side-rail${sidebarOpen ? "" : " is-closed"}`}
                  data-reader-side-rail
                  aria-hidden={!sidebarOpen}
                >
                  <ReaderSidebar
                    tocItems={tocItems}
                    activeHref={tocActiveHref}
                    onNavigate={(item) => {
                      void kernelRef.current?.goTo({ href: item.href });
                      setSidebarOpen(false);
                    }}
                    tab={sidebarTab}
                    onTabChange={setSidebarTab}
                    filter={annotSettings.annotationFilter}
                    onFilter={(f) => void writeAnnotationSetting("annotationFilter", f)}
                    sort={annotSort}
                    onSort={setAnnotSort}
                    extractsPanel={
                      /* 本文档没有注解＝页签内空态文案（页签仍可点，D84） */
                      docAnnotCount > 0 ? (
                      <ReaderExtractsPanel
                        documentId={contextRef?.documentId ?? null}
                        engine={engineKind}
                        orderKey={marksOrderKey}
                        getMarkOrder={() => kernelRef.current?.getMarkOrder?.() ?? []}
                        filter={annotSettings.annotationFilter}
                        onFilter={(f) => void writeAnnotationSetting("annotationFilter", f)}
                        sort={annotSort}
                        onSort={setAnnotSort}
                        palette={annotSettings.annotatePalette}
                        currentId={annotFocus}
                        unavailableIds={Object.keys(annotUnavailable)}
                        onJump={jumpToMark}
                        onEdit={(id, comment) => void selActions.saveAnnotationComment(id, comment)}
                        onColor={(id, color) => void selActions.saveAnnotationColor(id, color)}
                        onDelete={(id) => void selActions.removeAnnotation(id)}
                      />
                      ) : null
                    }
                    mapPanel={
                      /* v48.44（D84）：图谱页签＝导图工作区面板；画布经 portal 落在
                         .reader-engine-main 内的 .reader-map-layer 覆盖层（正文引擎不卸载）。
                         v48.45：轨收起时卸载（收集原文是重活，不在后台白跑）。 */
                      sidebarOpen && contextRef?.documentId && kernelRef.current ? (
                        <MindmapTab
                          kernel={kernelRef.current}
                          documentId={contextRef.documentId}
                          title={title || sourceTitle || "未命名材料"}
                          canvasHost={mapLayerHost}
                          initialMapId={openMindmapMapId || null}
                          initialResumeRunId={resumeOnce}
                          onJumpToText={() => setSidebarOpen(false)}
                          onMakeCardsFromNode={(payload) => {
                            // v48.5 批C：结构制卡——mode=card-structure（导图节点专用分支，对作者组织结构出题）
                            void runAICards(payload.section, undefined, "card-structure", { focus: payload.focus, mindmapNodeId: payload.nodeId });
                          }}
                        />
                      ) : undefined
                    }
                  />
                </div>
                <div className="reader-engine-col">
              <div className="reader-engine-controls">
                {selActionsGroup}
                <div className="reader-engine-controls-group">
                  {/* v48.44（D84）：翻页钮移到「更多」左侧 */}
                  <button className="btn btn-outline btn-sm reader-nav-btn" title="上一页（←）" aria-label="上一页" onClick={() => void turnPage(-1)}>
                    <IconChevronLeft />
                  </button>
                  <button className="btn btn-outline btn-sm reader-nav-btn" title="下一页（→ / 空格）" aria-label="下一页" onClick={() => void turnPage(1)}>
                    <IconChevronRight />
                  </button>
                  <span className="reader-engine-divider" aria-hidden="true" />
                  <ReaderToolMenu
                    id="more"
                    label="更多"
                    open={toolMenu === "more"}
                    onToggle={() => setToolMenu((v) => (v === "more" ? null : "more"))}
                  >
                    {/* v48.22（D58 §6.8-8）：集中复习本书的摘录 / 闪卡——按书范围会话，遵循共享每日预算 */}
                    <button
                      type="button"
                      className="dd-item"
                      data-review-extracts
                      disabled={!itemId || !onReviewExtracts}
                      title="集中复习本书的摘录（遵循每日上限）"
                      onClick={() => {
                        setToolMenu(null);
                        onReviewExtracts?.();
                      }}
                    >
                      复习摘录
                    </button>
                    <button
                      type="button"
                      className="dd-item"
                      data-review-cards
                      disabled={!itemId || !onReviewCards}
                      title="集中复习本书的闪卡（遵循每日上限）"
                      onClick={() => {
                        setToolMenu(null);
                        onReviewCards?.();
                      }}
                    >
                      复习闪卡
                    </button>
                  </ReaderToolMenu>
                  <ReaderToolMenu
                    id="settings"
                    label="阅读设置"
                    open={toolMenu === "settings"}
                    onToggle={() => setToolMenu((v) => (v === "settings" ? null : "settings"))}
                  >
                    <div className="reader-tool-menu-row">
                      <span className="reader-tool-menu-label mono">模式</span>
                      <Dropdown
                        title="阅读模式"
                        value={readerSettings.mode.flow === "scrolled" ? "scrolled" : readerSettings.mode.spread ? "spread" : "paged"}
                        options={[
                          { value: "scrolled", label: "滚动" },
                          { value: "paged", label: "分页" },
                          { value: "spread", label: "对开" }
                        ]}
                        onChange={(v) =>
                          changeReaderMode(
                            v === "scrolled" ? { flow: "scrolled" } : v === "spread" ? { flow: "paged", spread: true } : { flow: "paged" }
                          )
                        }
                      />
                    </div>
                    <div className="reader-tool-menu-row">
                      <span className="reader-tool-menu-label mono">主题</span>
                      <Dropdown
                        title="阅读主题"
                        value={readerSettings.appearance.theme}
                        options={[
                          { value: "paper", label: "纸白" },
                          { value: "sepia", label: "羊皮" },
                          { value: "dark", label: "暗夜" },
                          { value: "custom", label: "自定义" }
                        ]}
                        onChange={(t) => changeReaderTheme(t as ReaderAppearance["theme"])}
                      />
                    </div>
                    {engineKind === "pdf" && (
                      <div className="reader-tool-menu-row">
                        <span className="reader-tool-menu-label mono">缩放</span>
                        <Dropdown
                          title="缩放"
                          value={String(readerSettings.appearance.zoom ?? "page-width")}
                          options={[
                            { value: "page-width", label: "适应宽度" },
                            { value: "page-fit", label: "适应页面" },
                            { value: "50", label: "50%" },
                            { value: "75", label: "75%" },
                            { value: "100", label: "100%" },
                            { value: "125", label: "125%" },
                            { value: "150", label: "150%" },
                            { value: "200", label: "200%" }
                          ]}
                          onChange={(v) => changeReaderZoom(v === "page-width" || v === "page-fit" ? v : Number(v))}
                        />
                      </div>
                    )}
                  </ReaderToolMenu>
                </div>
              </div>
              <div className="reader-engine-viewport">
                {/* v48.45（D85）：侧栏已升为全高左轨（.reader-side-rail，在 layout 层），视口里只剩正文区；
                    翻页热区只覆盖正文区（.reader-engine-main）。 */}
                <div className="reader-engine-main">
                {engineError ? (
                  <div className="reader-engine-error" role="alert">
                    <p className="reader-engine-error-title">
                      这本书没能打开
                    </p>
                    <p className="reader-engine-error-msg mono">{engineError}</p>
                    <div className="reader-engine-error-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setEngineError(null);
                          setEngineRetry((n) => n + 1);
                        }}
                      >
                        重试
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setEngineError(null)}>
                        关闭提示
                      </button>
                    </div>
                    <p className="reader-engine-error-hint">
                      常见原因：文件格式不受支持、文件本身损坏，或导出时缺失资源。
                    </p>
                  </div>
                ) : (
                <ReaderEngine
                  key={engineRetry}
                  source={engineSource}
                  engine={engineKind}
                  initLocation={initialCfi ? { cfi: initialCfi } : initialPageIndex != null ? { pageIndex: initialPageIndex } : initialRatio > 0 ? { fraction: initialRatio } : null}
                  jump={jumpAnchor ? { cfi: jumpAnchor.cfi, pageIndex: jumpAnchor.pageIndex, chapterIndex: jumpAnchor.chapterIndex, anchorText: jumpAnchor.anchorText } : null}
                  onRelocate={handleEngineRelocate}
                  onLink={(info) => {
                    // 外链：adapter 已拦截默认行为，这里交系统浏览器；内链由内核自行精确跳转
                    if (!info.internal) void window.windowAPI?.openExternal(info.href);
                  }}
                  onContentPointerUp={handleEnginePointerUp}
                  onImageClick={(img) => void handleEngineImageClick(img)}
                  onReady={handleEngineReady}
                  onError={(msg) => setEngineError(msg)}
                />
                )}
                {readerSettings.mode.flow === "paged" && (
                  <>
                    <div className="reader-tap-zone reader-tap-left" title="上一页" onClick={() => void turnPage(-1)} />
                    <div className="reader-tap-zone reader-tap-right" title="下一页" onClick={() => void turnPage(1)} />
                  </>
                )}
                {/* v48.44（D84）：图谱页签画布的 portal 宿主——置于 .reader-engine-main 末位（z 5 高于
                    翻页热区 z 4 与错误面板），空时 display:none 不遮正文；画布经 MindmapTab portal 落入 */}
                <div className="reader-map-layer" data-reader-map-layer ref={setMapLayerHost} />
                </div>
              </div>
              </div>
              </div>
            </>
          ) : (
            <>
            {/* v48.41（D81）：markdown（粘贴书）分支的选区动作组——与引擎工具栏同一份，置顶常驻 */}
            <div className="reader-md-actions">{selActionsGroup}</div>
            <article className="reader-markdown">
              <h1 className="reader-title">{title}</h1>
              {contextLabel && <p className="reader-context">{contextLabel}</p>}
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {markdown}
              </ReactMarkdown>
            </article>
            </>
          )}

          {/* v35 图片卡跳转：图内区域高亮（宿主视口坐标，5 秒或翻页自清）+ 未命中时的原图对照浮层 */}
          {imgOverlay && imgOverlay.occlusion && (
            <div
              className="img-region-overlay"
              style={{ left: imgOverlay.rect.x, top: imgOverlay.rect.y, width: imgOverlay.rect.width, height: imgOverlay.rect.height }}
            >
              <OcclusionShapes
                occlusion={{
                  rects: imgOverlay.occlusion.rects,
                  shapes: (imgOverlay.occlusion.shapes as OcclusionShape[] | null | undefined) ?? null,
                  regionScope: imgOverlay.occlusion.regionScope
                }}
                cardOrd={imgOverlay.occlusion.cardOrd ?? 0}
              />
            </div>
          )}
          {sourcePeek && sourcePeek.occlusion?.assetPath && (
            <div className="source-peek">
              <div className="source-peek-head">
                <span>原图对照（未在正文中定位到该图）</span>
                <button className="source-peek-close" onClick={() => setSourcePeek(null)} title="关闭" aria-label="关闭"><IconClose size={16} /></button>
              </div>
              <div className="occlusion-stage source-peek-stage">
                <img src={sourcePeek.occlusion.assetPath} alt="" className="occlusion-img" />
                <OcclusionShapes
                  occlusion={{
                    rects: sourcePeek.occlusion.rects,
                    shapes: (sourcePeek.occlusion.shapes as OcclusionShape[] | null | undefined) ?? null,
                    regionScope: sourcePeek.occlusion.regionScope
                  }}
                  cardOrd={sourcePeek.occlusion.cardOrd ?? 0}
                />
              </div>
            </div>
          )}

          {selection && (
            <SelectionMenu
              anchor={selection.rect}
              container={scrollRef.current?.getBoundingClientRect() ?? null}
              colors={ANNOT_PALETTE}
              onPick={handlePickColor}
              byLocked={multiKeyHeld}
            />
          )}
        </div>

        <SelectionPanels sel={selActions} selectionText={selection?.text ?? null} nowTick={nowTick} elapsedSec={elapsedSec} />
      </div>

      {/* v25 图片聚焦覆盖层：位于阅读器最外层（fixed 全屏），点击模糊区域退出 */}
      {focusImage && (
        <ImageFocus
          image={{ src: focusImage.src, dataUrl: focusImage.dataUrl, alt: focusImage.alt }}
          origin={{ x: focusImage.rect.x, y: focusImage.rect.y, width: focusImage.rect.w, height: focusImage.rect.h }}
          busy={focusBusy}
          onClose={() => setFocusImage(null)}
          onSubmit={(kind, payload) => {
            if (kind === "ai") void submitRegionCards(payload);
            else submitRegionManual(payload);
          }}
        />
      )}

      {/* 批 4 Task 17 / v48.45（D85）：标记的批注编辑浮层＝**唯一浮层**（悬停浮层已退役）——
          批注改/删 + 聚合「已制卡 N 张」+「就此制卡」（走既有手动制卡链）；无保存/取消，失焦即落库。 */}
      {markEditor && (() => {
        const m = marksRef.current.find((x) => x.id === markEditor.id);
        if (!m) return null;
        return (
          <AnnotationEditor
            extractId={markEditor.id}
            kind={markEditor.kind}
            comment={markEditor.comment}
            color={markEditor.color}
            anchor={markEditor.anchor}
            palette={annotSettings.annotatePalette}
            customEnabled={annotSettings.annotateCustomEnabled}
            cardCount={m.cardCount}
            onMakeCard={() => startMarkCard(m)}
            onSaveComment={(c) => selActions.saveAnnotationComment(markEditor.id, c)}
            onSaveColor={async (c) => {
              await selActions.saveAnnotationColor(markEditor.id, c);
              setMarkEditor((prev) => (prev ? { ...prev, color: c } : prev));
            }}
            onDelete={async () => {
              await selActions.removeAnnotation(markEditor.id);
              setMarkEditor(null);
            }}
            onClose={() => setMarkEditor(null)}
          />
        );
      })()}

      {/* v48.44（D84）：全屏导图工作区退役——导图并入侧栏图谱页签（MindmapTab，见上方 mapPanel）。 */}

      {toast && <div className="reader-toast">{toast}</div>}
    </div>
  );
}
