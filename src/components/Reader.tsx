import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cardGenerator, lintCard, cardsApi, similaritySearch, detectMaterialType, parseFollowUps, expandClozeDraft, parseCloze, createAcceptedCard, siblingKeyFor, burySourceTextLimit, MATERIAL_ROUTES, type CardDraft, type CardGenMode, type OcclusionRegion, type FollowUpGroup } from "../lib/cards";
import { VOCAB_KIND_LABEL, buildVocabDrafts, isVocabSelection, type DictionaryEntry, type ReadingContext, type VocabKind } from "../lib/dict";
import { buildReadingContext, loadDictSettings, lookupWord } from "../lib/dictClient";
import { libraryApi } from "../lib/library";
import { DictPanel, type DictPanelState } from "./DictPanel";
import { normalizeShape, type OcclusionRect, type OcclusionShape } from "../lib/occlusion";
import { settingsStore } from "../lib/settings";
import { MindmapWorkspace } from "./MindmapWorkspace";
import { sanitizeDomain, udcLabel, UDC_LEAVES, UDC_MAX, UDC_OTHER } from "../lib/udc";
import { eventBus } from "../lib/eventbus";
import { readingStats } from "../lib/stats";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import ImageFocus, { type ImageFocusSubmit } from "./reader/ImageFocus";
import { useCommandActions } from "../lib/useCommands";
import ReaderEngine from "./reader/ReaderEngine";
import MarkPopover from "./reader/MarkPopover";
import ManualCardEditor, { type ManualCardPayload } from "./ManualCardEditor";
import AIPanel from "./AIPanel";
import TocSidebar from "./reader/TocSidebar";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconAlert, IconClose } from "./icons";
import {
  DEFAULT_READER_SETTINGS,
  buildLocator,
  resolveAppearance,
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
import { buildDocMarks } from "../lib/reader/marks";
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

type SelectionAction = "manual" | "ai-cards" | null;

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
  const [selection, setSelection] = useState<{ x: number; y: number; text: string; spans: ExtractSpan[] } | null>(null);
  /** 多段选择集合（与主进程 updateSpanSet 同步的权威列表；DOM 顺序＝落库顺序） */
  const multiSpansRef = useRef<ExtractSpan[]>([]);
  /** 修饰键（settings.app.multiSelectKey；读侧归一，默认 Ctrl / macOS Meta） */
  const multiKeyRef = useRef<MultiSelectKey>("Ctrl");
  /** 选中态更新串行化：指针抬起是高频事件，主进程往返按序应用（避免两次拖选交错） */
  const spanQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [manualOpen, setManualOpen] = useState(false);
  // v25：手动制卡的图片选区（从聚焦工具条「手动制卡」进入时携带）
  const [manualImage, setManualImage] = useState<{
    dataUrl: string;
    alt: string;
    shape: OcclusionShape;
    rect: OcclusionRect;
  } | null>(null);
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
  // v48 批3（M15，D42）：全屏导图工作区（挂 Reader 外层的 Overlay，内核保活 → 返回正文天然原位）
  const [mindmapOpen, setMindmapOpen] = useState(false);
  /**
   * v48.13（P3）：续跑意图要在**挂载时快照**。
   * 原因：App 在 onMindmapOpened 里立刻清掉 view.resumeRunId（导航状态要干净），
   * 而真正用到它的是下面那个 MindmapWorkspace 的挂载流程（要等收集完原文才续跑）——
   * 若直接读 prop，会读到已被清空的 null，续跑静默不发生。
   */
  const [resumeOnce] = useState<string | null>(resumeRunId ?? null);
  // v48.13（P2）：从右下角指示器进入时自动打开（只消费一次；标记即刻回执给 App 清除）
  useEffect(() => {
    if (!openMindmapInitially) return;
    setMindmapOpen(true);
    onMindmapOpened?.();
  }, [openMindmapInitially, onMindmapOpened]);
  const [aiPanel, setAiPanel] = useState<{
    kind: "explain" | "cards" | "occlusion";
    text: string;
    /** v48（M15，D41-⑥）：本批卡片来自哪个导图节点（就此制卡溯源） */
    mindmapNodeId?: string;
    answer?: string;
    drafts?: CardDraft[];
    accepted?: Set<number>;
    blockReasons?: string[];
    batchId?: string;
    running: boolean;
    progress?: number;
    thinking?: number;
    startedAt?: number;
    searching?: boolean;
    searched?: boolean;
    error?: string;
    // M1.2：材料类型路由展示与手动覆盖
    mode?: CardGenMode;
    routeLabel?: string;
    routeForm?: string;
    // M1.1：图片挖空面板
    image?: { dataUrl: string; assetPath: string };
    regions?: OcclusionRegion[];
    // v16 递进补卡（「后续可补」注记 → 询问 AI / 直接制卡）
    kps?: { id: string; summary: string }[];
    supplemental?: Set<number>;
    followUpBusy?: string[];
    followUpStarted?: Record<string, number | undefined>;
    followUpErrors?: Record<string, string>;
    explorations?: {
      id: number;
      item: string;
      kpTitle: string;
      question: string;
      answer?: string;
      running: boolean;
      startedAt?: number;
      thinking?: number;
      error?: string;
    }[];
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // v25：showToast 上移到各交互回调之前（回调 deps 在渲染期求值，后置声明会触发 TDZ）
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);
  // M1.2：制卡模式（材料类型路由的手动覆盖；auto=本地识别）
  // v16：按书记忆——用户在某本书里手动选过材料类型，则该书后续制卡默认沿用（settings.app.materialTypes）
  const [aiMode, setAiMode] = useState<CardGenMode>("auto");
  const itemKey = itemId || contextRef?.documentId || "";
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = await settingsStore.get<Record<string, CardGenMode>>("app", "materialTypes", {});
      if (!cancelled && itemKey && map[itemKey]) setAiMode(map[itemKey]);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemKey]);
  function changeAiMode(m: CardGenMode) {
    setAiMode(m);
    if (itemKey) {
      void settingsStore.get<Record<string, CardGenMode>>("app", "materialTypes", {}).then((map) => {
        if (map[itemKey] === m) return;
        void settingsStore.set("app", "materialTypes", { ...map, [itemKey]: m });
      });
    }
  }

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
  const occlusionSourceRef = useRef<"engine" | "library">("engine");
  const relocateTimerRef = useRef<number | null>(null);
  // v35 跳转图片卡：图内区域高亮叠加（宿主视口坐标，短暂显示）/ 原图对照浮层（定位失败或 PDF 系）
  const [imgOverlay, setImgOverlay] = useState<{ rect: ReaderRect; occlusion: NonNullable<Props["jumpAnchor"]>["occlusion"] } | null>(null);
  const [sourcePeek, setSourcePeek] = useState<{ occlusion: NonNullable<Props["jumpAnchor"]>["occlusion"] } | null>(null);
  // v48.24 批3（§4 文中留痕）：本文档的根摘录标记 + 命中后的浮层（只读；编辑永远在卡片上进行）
  const [markPop, setMarkPop] = useState<{ id: string; rect: ReaderRect } | null>(null);
  const marksRef = useRef<ReaderDocMark[]>([]);
  /** 浮层被点住（钉住）后不再随 pointerleave 收起；点别处/Esc 解除 */
  const markPinnedRef = useRef(false);
  const markHideTimerRef = useRef<number | null>(null);
  /** 从浮层「就此制卡」进入时，本次制卡的 contextRef 覆盖值（挂到该摘录上——已制卡数按 extractId 派生） */
  const markCardRefOverrideRef = useRef<Record<string, unknown> | null>(null);
  const [markCardText, setMarkCardText] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocItems, setTocItems] = useState<ReaderTocItem[]>([]);
  const [tocActiveHref, setTocActiveHref] = useState<string | undefined>(undefined);
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
          t.closest(".reader-engine-host"))) return;
      clearMultiSelect();
      setSelection(null);
      engineSelRef.current = null;
    };
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocMouseDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

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
      if (relocateTimerRef.current) window.clearTimeout(relocateTimerRef.current);
      relocateTimerRef.current = window.setTimeout(() => {
        relocateTimerRef.current = null;
        if (itemId && onProgress) void readingStats.addEvent(itemId, Math.round(info.fraction * (markdown?.length || 0)));
        // v28 PDF 原生阅读：progress 携带页码锚点（pageIndex），foliate 系携带 cfi
        onProgress?.(info.fraction, "", { cfi: info.location.cfi, fraction: info.fraction, pageIndex: info.location.pageIndex });
      }, 700);
    },
    [itemId, markdown, onProgress]
  );

  // 引擎选区：pointerup 时取选区语义数据并弹出菜单（坐标为宿主视口坐标，菜单用 fixed）
  // v48.23（D61 §6.8-11）：按住修饰键（app.multiSelectKey，默认 Ctrl）再选＝加选：
  // 集合运算与拼接文本一律交主进程（resolveSpanSet → electron/annotationRange.js），
  // 本层只负责采集「这一段」并画高亮；不带修饰键＝替换（普通拖选覆盖旧集合）。
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
    const withModifier = modifierFlagOf(multiKeyRef.current, pos);
    // 串行化：两次拖选的往返按序应用，后者永远读到前者落定的集合
    spanQueueRef.current = spanQueueRef.current
      .then(async () => {
        const r = await resolveSpanSet(multiSpansRef.current, incoming, withModifier);
        if (r.action === "none") return; // 空白新选区：集合不动（内核 updateSpanSet 的语义）
        multiSpansRef.current = r.spans;
        kernelRef.current?.multiSelectHighlight?.(r.action);
        (window as unknown as { __readerMultiSpans?: ExtractSpan[] }).__readerMultiSpans = r.spans;
        setSelection({ x: pos.x, y: pos.y, text: r.text, spans: r.spans });
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
    // v48.24 批3（§4 文中留痕）：指针进出/点中标记 → 浮层。标记本身只读，
    // 这里只做「显示/延时收起/钉住」三件事；数据一律按 id 回查 marksRef（不信任事件带的内容）。
    k.on("markHover", (info) => {
      if (info.id && info.rect) {
        if (markHideTimerRef.current) {
          window.clearTimeout(markHideTimerRef.current);
          markHideTimerRef.current = null;
        }
        setMarkPop({ id: info.id, rect: info.rect });
      } else if (!markPinnedRef.current && markHideTimerRef.current === null) {
        // 留 240ms 让指针从标记走到浮层（浮层在标记下方 8px）
        markHideTimerRef.current = window.setTimeout(() => {
          markHideTimerRef.current = null;
          setMarkPop(null);
        }, 240);
      }
    });
    k.on("markClick", (info) => {
      if (!info.id || !info.rect) return;
      markPinnedRef.current = true;
      if (markHideTimerRef.current) {
        window.clearTimeout(markHideTimerRef.current);
        markHideTimerRef.current = null;
      }
      setMarkPop({ id: info.id, rect: info.rect });
    });
    // 数据先到（marksRef 已填）而内核后到：这里补推一次；反之由标记 effect 自己推
    if (marksRef.current.length) k.setDocumentMarks?.(marksRef.current);
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
  const anchorRef = useRef<{ anchorText: string; anchorRatio: number } | null>(null);
  // v34（M12）：本次制卡的完整源文本（短材料锚点键的长度门控输入，§4.16 item 5）
  const sourceTextRef = useRef("");
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
      spans: [{ text }]
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
  const closeMarkPop = useCallback(() => {
    markPinnedRef.current = false;
    if (markHideTimerRef.current) {
      window.clearTimeout(markHideTimerRef.current);
      markHideTimerRef.current = null;
    }
    setMarkPop(null);
  }, []);

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
        const counts: Record<string, number> = {};
        for (const c of cards as Array<{ contextRef?: { extractId?: string } | null; isDeleted?: number }>) {
          const id = c?.contextRef?.extractId;
          if (id && !c.isDeleted) counts[id] = (counts[id] || 0) + 1;
        }
        const marks = buildDocMarks(rows, documentId, engineKind, counts);
        marksRef.current = marks;
        kernelRef.current?.setDocumentMarks?.(marks);
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

  // 浮层的两条退出：点别处（含正文）/ Esc——钉住态一并解除
  useEffect(() => {
    if (!markPop) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest(".reader-mark-pop")) return;
      closeMarkPop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMarkPop();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [markPop, closeMarkPop]);

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
    setMarkCardText(mark.text);
    setManualOpen(true);
    closeMarkPop();
  }

  // ---------- 手动制卡（Phase 3：引用+可编辑副本模式；v16 翻转问答 = 制卡手段，产两张独立问答卡；
  // M5（v25）：与 AI 制卡同构的字段集——类型选择 / UDC 领域标签 / contextPrefix / 助记 / 知识点分组 / 日期标记，
  // 一律过 CardLintEngine + 相似检索；图片挖空手动卡由正文图片选区进入（front/back 可编辑） ----------
  async function createSingleCard(p: {
    front: string;
    back: string;
    cardType: string;
    cloze?: string;
    priority: number;
    contextPrefix?: string | null;
    domain?: string[];
    mnemonic?: string | null;
    knowledgePointId?: string | null;
    dateStamp?: string | null;
    occlusionJson?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; assetPath: string; shapes?: OcclusionShape[] | null } | null;
    cardOrd?: number;
    // v34（M12，§4.16）：同源组键——翻转对/同图卡由调用点显式给出；普通卡由 handleManualCard 预先推导
    siblingKey?: string | null;
  }): Promise<void> {
    const sourceRef = sourceTitle ? { title: sourceTitle } : null;
    const card = {
      noteText: p.front || p.cloze || "",
      cardType: p.cardType,
      frontMarkdown: p.front,
      backMarkdown: p.back,
      clozeOrds: [],
      cardOrd: p.cardOrd ?? 0,
      occlusionJson: p.occlusionJson ?? null,
      contextPrefix: p.contextPrefix || null,
      contextRef: enrichedContextRef(),
      mnemonic: p.mnemonic || null,
      sourceRef,
      dateStamp: p.dateStamp || null,
      priority: p.priority,
      tags: [],
      domain: p.domain ?? [],
      knowledgePointId: p.knowledgePointId || null,
      siblingKey: p.siblingKey ?? null,
      generatedBy: "manual"
    };
    const issues = lintCard({
      front: card.frontMarkdown,
      back: card.backMarkdown,
      cardType: card.cardType,
      cloze: p.cloze || null,
      contextPrefix: card.contextPrefix,
      sourceRef,
      dateStamp: card.dateStamp,
      knowledgePointId: card.knowledgePointId,
      occlusion: card.occlusionJson
    });
    const created = await cardsApi.create(card);
    for (const issue of issues) {
      await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
    }
    const similar = await similaritySearch.findSimilar(p.front || p.cloze || "", 2);
    if (similar.length > 0) {
      await cardsApi.addIssue({
        cardId: created.id,
        ruleId: "S1",
        severity: "warn",
        message: `与已有卡相似（${Math.round(similar[0].score * 100)}%）：「${similar[0].front.slice(0, 30)}…」`,
        source: "lint"
      });
    }
  }

  async function handleManualCard(p: ManualCardPayload) {
    const meta = {
      contextPrefix: p.contextPrefix || null,
      domain: p.domain ?? [],
      mnemonic: p.mnemonic || null,
      knowledgePointId: p.knowledgePointId || null,
      dateStamp: p.dateStamp || null,
      priority: p.priority
    };
    // v34（M12，§4.16）：短材料锚点键——同一句/段的多次制卡（手动或 AI）互为同源，同日只放行一张
    const srcKey = siblingKeyFor({
      contextRef: enrichedContextRef(),
      sourceText: sourceTextRef.current || null,
      limit: await burySourceTextLimit()
    });
    if (p.mode === "imageOcclusion") {
      if (!p.imageRegion) {
        showToast("缺少图片选区，无法创建图片挖空卡");
        return;
      }
      const assetPath = await ensureImageAsset(p.imageRegion.dataUrl);
      if (!assetPath) return;
      const shape = normalizeShape({ ...p.imageRegion.shape, ord: 0 });
      await createSingleCard({
        front: p.front.trim() || "图中遮挡区域对应的是什么？",
        back: p.back,
        cardType: "imageOcclusion",
        cardOrd: 0,
        // 同图多卡互为同源（结构性，与文本长度无关）：按图片资产分组
        siblingKey: `img:${assetPath}`,
        occlusionJson: {
          assetPath,
          rects: [{ x: p.imageRegion.rect.x, y: p.imageRegion.rect.y, w: p.imageRegion.rect.w, h: p.imageRegion.rect.h, ord: 0 }],
          shapes: [shape]
        },
        ...meta
      });
      eventBus.emit("cards/changed");
      setManualOpen(false);
      setManualImage(null);
      showToast("图片挖空卡已创建（复习正面遮挡所选区域）");
      return;
    }
    if (p.mode === "reverse") {
      // 翻转问答卡（D18）：互为翻转的两张独立 qa 卡，各自有独立 FSRS 调度状态
      // v34（M12）：翻转对互为同源（结构性，与文本长度无关）——同日只放行一张
      const flipKey = `act:flip-${crypto.randomUUID()}`;
      await createSingleCard({ front: p.front, back: p.back, cardType: "qa", siblingKey: flipKey, ...meta });
      await createSingleCard({
        front: p.reversePair?.bFront || p.back,
        back: p.reversePair?.bBack || p.front,
        cardType: "qa",
        siblingKey: flipKey,
        ...meta
      });
      eventBus.emit("cards/changed");
      setManualOpen(false);
      setManualImage(null);
      showToast("已创建 2 张互为翻转的独立卡片");
      return;
    }
    if (p.mode === "cloze") {
      const cloze = p.cloze || "";
      // F12（v25）修复：挖空卡必须把带 {{cN::}} 标记的文本存进 frontMarkdown——
      // 此前存的是未转换的原文，复习端 parseCloze 找不到挖空 ord，挖空从未遮蔽
      await createSingleCard({ front: cloze, back: p.back, cardType: "cloze", cloze, siblingKey: srcKey, ...meta });
      eventBus.emit("cards/changed");
      setManualOpen(false);
      setManualImage(null);
      showToast("卡片已创建，可在复习视图查看");
      return;
    }
    await createSingleCard({ front: p.front, back: p.back, cardType: "qa", siblingKey: srcKey, ...meta });
    eventBus.emit("cards/changed");
    setManualOpen(false);
    setManualImage(null);
    showToast("卡片已创建，可在复习视图查看");
  }

  // ---------- v25 图片选区提交（聚焦工具条 → AI 制卡 / 手动制卡） ----------
  async function submitRegionCards(payload: ImageFocusSubmit) {
    const focused = focusImage;
    if (!focused) return;
    setFocusBusy(true);
    try {
      const assetPath = await ensureImageAsset(focused.dataUrl);
      if (!assetPath) return;
      const cropDataUrl = await cropImageDataUrl(focused.dataUrl, payload.bbox);
      // 图片入口无文本选区：清掉可能残留的锚点，避免把旧锚点挂到新卡上
      anchorRef.current = null;
      // v35：正文图片链路——制卡来源=engine（图片锚点已由点击快照）
      occlusionSourceRef.current = "engine";
      const label = `[图片选区] ${focused.alt || "正文图片"}`;
      setFocusImage(null);
      setAiPanel({
        kind: "occlusion",
        text: label,
        image: { dataUrl: focused.dataUrl, assetPath },
        running: true,
        progress: 0,
        startedAt: Date.now(),
        thinking: 0
      });
      const { batchId, result } = await cardGenerator.generateOcclusionCards(
        { dataUrl: cropDataUrl, assetPath },
        {
          title: sourceTitle,
          section: contextLabel,
          // v29 D26：选区 = AI 的完整图片范围，按制卡原则识别内容类型、自选考察方式、
          // 产出多张混合卡（含一卡多挖空）；regions 为选区图百分比坐标（cards.ts 负责映射回全图）。
          focus: "用户已在你看到的这张图（选区裁剪）上圈定了制卡范围。请结合下方（如提供）图片周边文字上下文，识别图片内容类型与可测试点，按制卡原则自选考察方式，产出多张混合卡：单挖空遮挡卡、一卡多挖空遮挡卡（同卡多个区域同遮同答，如思维导图同分支的多个关键词）、看图问答卡（cardType=qa，正面图+题面文字）。遮挡必须留有可推断线索，禁止把整个选区作为单一遮挡（除非选区内确只有一个测试点）。所有 regions 坐标为这张选区图的百分比。",
          presetRegion: { rect: payload.bbox, shape: payload.shape },
          contextText: focused.contextText
        },
        (chars) => setAiPanel((p) => (p && p.kind === "occlusion" ? { ...p, progress: chars } : p)),
        (thinkChars) => setAiPanel((p) => (p && p.kind === "occlusion" ? { ...p, thinking: thinkChars } : p))
      );
      setAiPanel({
        kind: "occlusion",
        text: label,
        image: { dataUrl: focused.dataUrl, assetPath },
        running: false,
        progress: undefined,
        startedAt: undefined,
        thinking: undefined,
        drafts: result.cards,
        accepted: new Set<number>(),
        blockReasons: result.blockReasons,
        regions: result.regions,
        batchId
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "occlusion",
        text: `[图片选区] ${focused.alt || "正文图片"}`,
        image: undefined,
        running: false,
        startedAt: undefined,
        thinking: undefined,
        error: msg.includes("API Key")
          ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
          : msg
      });
    } finally {
      setFocusBusy(false);
    }
  }

  function submitRegionManual(payload: ImageFocusSubmit) {
    const focused = focusImage;
    if (!focused) return;
    setFocusImage(null);
    setManualImage({
      dataUrl: focused.dataUrl,
      alt: focused.alt,
      shape: normalizeShape({ ...payload.shape, ord: 0 }),
      rect: payload.bbox
    });
    setManualOpen(true);
  }

  // ---------- AI 制卡（Phase 13 主路径；M1.2 材料类型路由） ----------
  // v48（M15，D41-⑥）：opts.focus = 导图结构摘要（注入既有【本次制卡重点】槽，≤1200 字）；
  // opts.mindmapNodeId = 来源导图节点（卡片 context_ref 溯源 + act:mindmap-<nodeId> 同源兄弟键）。
  // 提示词与规则完全沿用既有管线（材料类型路由/确认面板/CardLint/S1/KP 归一），不另起炉灶。
  async function runAICards(text: string, webContext?: string, mode: CardGenMode = "auto", opts?: { focus?: string; mindmapNodeId?: string }) {
    // 本地材料类型识别：auto 时按文本路由到对应提示词分支（概念/公式/序列/枚举），类型可手动覆盖
    const route = detectMaterialType(text);
    const resolved: CardGenMode = mode === "auto" ? route.scope : mode;
    const shownRoute = mode === "auto" ? route : MATERIAL_ROUTES[resolved === "card-formula" ? "formula" : resolved === "card-seq" ? "sequence" : resolved === "card-enum" ? "enumeration" : resolved === "card-literature" ? "literature" : "concept"];
    setAiPanel({
      kind: "cards",
      text,
      running: true,
      progress: 0,
      startedAt: Date.now(),
      thinking: 0,
      searched: Boolean(webContext),
      mode,
      routeLabel: shownRoute.label,
      routeForm: shownRoute.defaultForm,
      mindmapNodeId: opts?.mindmapNodeId
    });
    try {
      const { batchId, result } = await cardGenerator.generateCards(
        text,
        { title: sourceTitle, section: contextLabel, webContext, documentId: contextRef?.documentId ?? null, focus: opts?.focus },
        resolved,
        (chars) => setAiPanel((p) => (p && p.kind === "cards" ? { ...p, progress: chars } : p)),
        (thinkChars) => setAiPanel((p) => (p && p.kind === "cards" ? { ...p, thinking: thinkChars } : p))
      );
      setAiPanel({
        kind: "cards",
        text,
        running: false,
        progress: undefined,
        startedAt: undefined,
        thinking: undefined,
        drafts: result.cards,
        accepted: new Set<number>(),
        blockReasons: result.blockReasons,
        batchId,
        searched: Boolean(webContext),
        mode,
        routeLabel: shownRoute.label,
        routeForm: shownRoute.defaultForm,
        kps: result.knowledgePoints,
        mindmapNodeId: opts?.mindmapNodeId,
        supplemental: new Set<number>(),
        followUpBusy: [],
        followUpStarted: {},
        followUpErrors: {},
        explorations: []
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "cards",
        text,
        running: false,
        startedAt: undefined,
        thinking: undefined,
        error: msg.includes("API Key")
          ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
          : msg,
        mode,
        routeLabel: shownRoute.label,
        routeForm: shownRoute.defaultForm
      });
    }
  }

  // ---------- M1.1 图片挖空（D16：GLM 多模态识别遮挡区域，不做手动遮挡编辑器） ----------
  async function runOcclusionCards() {
    const ownerKey = itemId || contextRef?.documentId || "";
    if (!ownerKey) {
      showToast("无法确定图片归属的书籍");
      return;
    }
    // 图片入口无文本选区：清掉可能残留的选区锚点，避免把旧锚点挂到新卡上
    anchorRef.current = null;
    engineSelRef.current = null;
    // v35：资源库选图——图不在书中正文里，只落 imageSource="library"（复习端隐藏跳转原文）
    occlusionSourceRef.current = "library";
    const picked = await window.assetsAPI?.pickOcclusionImage(ownerKey);
    if (!picked) return;
    setAiPanel({
      kind: "occlusion",
      text: `[图片] ${picked.filename}`,
      image: { dataUrl: picked.dataUrl, assetPath: picked.assetPath },
      running: true,
      progress: 0,
      startedAt: Date.now(),
      thinking: 0
    });
    try {
      const { batchId, result } = await cardGenerator.generateOcclusionCards(
        { dataUrl: picked.dataUrl, assetPath: picked.assetPath },
        { title: sourceTitle, section: contextLabel },
        (chars) => setAiPanel((p) => (p && p.kind === "occlusion" ? { ...p, progress: chars } : p)),
        (thinkChars) => setAiPanel((p) => (p && p.kind === "occlusion" ? { ...p, thinking: thinkChars } : p))
      );
      setAiPanel({
        kind: "occlusion",
        text: `[图片] ${picked.filename}`,
        image: { dataUrl: picked.dataUrl, assetPath: picked.assetPath },
        running: false,
        progress: undefined,
        startedAt: undefined,
        thinking: undefined,
        drafts: result.cards,
        accepted: new Set<number>(),
        blockReasons: result.blockReasons,
        regions: result.regions,
        batchId
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "occlusion",
        text: `[图片] ${picked.filename}`,
        image: undefined,
        running: false,
        startedAt: undefined,
        thinking: undefined,
        error: msg.includes("API Key")
          ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
          : msg
      });
    }
  }

  async function acceptOcclusionDraft(d: CardDraft, draftIndex: number) {
    if (!d.occlusion || (aiPanel?.accepted?.has(draftIndex) ?? true)) return;
    const ord = d.ord ?? d.occlusion.ord ?? 0;
    const card = {
      noteText: d.front || "图中遮挡区域对应的是什么？",
      cardType: "imageOcclusion",
      frontMarkdown: d.front || "图中遮挡区域对应的是什么？",
      backMarkdown: d.back || d.occlusion.label || "",
      clozeOrds: [],
      cardOrd: ord,
      // v25：形状（矩形/椭圆/多边形）随卡落库；rects 恒为包围盒（兼容旧渲染与 L11）
      // v30：regionScope 透传——"shared"=旧共享区域链路（单区高亮），缺省=每卡自带（全 accent）
      occlusionJson: {
        rects: d.occlusion.rects,
        assetPath: d.occlusion.assetPath,
        shapes: d.occlusion.shapes ?? null,
        regionScope: d.occlusion.regionScope
      },
      contextPrefix: d.contextPrefix || null,
      // v35：library=资源库选图（图不在书中）只落 documentId+imageSource，无定位锚——复习端隐藏跳转；
      // engine=正文图片走 enrichedContextRef（imageAnchorRef 快照 → 图片所在章节/页可跳转）
      contextRef: occlusionSourceRef.current === "library"
        ? { ...(contextRef || {}), imageSource: "library" as const }
        : enrichedContextRef(),
      sourceRef: d.sourceRef || (sourceTitle ? { title: sourceTitle } : null),
      dateStamp: d.dateStamp || null,
      priority: d.prioritySuggestion ?? 50,
      tags: [],
      domain: d.domain ?? [],
      knowledgePointId: d.knowledgePointId || null,
      // v34（M12，§4.16）：同图多卡互为同源（D26 同一次选区确认/同一图片资产），结构性、与文本长度无关
      siblingKey: `img:${d.occlusion.assetPath}`,
      generatedBy: "ai"
    };
    const issues = lintCard({
      front: card.frontMarkdown,
      back: card.backMarkdown,
      cardType: card.cardType,
      occlusion: {
        assetPath: card.occlusionJson.assetPath,
        rects: card.occlusionJson.rects,
        shapes: card.occlusionJson.shapes
      },
      contextPrefix: card.contextPrefix,
      sourceRef: card.sourceRef,
      dateStamp: card.dateStamp,
      knowledgePointId: card.knowledgePointId
    });
    const created = await cardsApi.create(card);
    for (const issue of issues) {
      await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
    }
    setAiPanel((p) =>
      p && p.drafts ? { ...p, accepted: new Set([...(p.accepted ?? []), draftIndex]) } : p
    );
    eventBus.emit("cards/changed");
    showToast("遮挡卡已接受，进 FSRS 队列");
  }

  // ---------- 联网补充事件背景后重试制卡 ----------
  async function searchAndRetry(text: string) {
    setAiPanel((p) => (p && p.kind === "cards" ? { ...p, searching: true } : p));
    try {
      const results = await (await import("../lib/ai")).aiGateway.websearch(text.slice(0, 120));
      const webContext = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
        .join("\n\n");
      if (!webContext) {
        setAiPanel((p) => (p && p.kind === "cards" ? { ...p, searching: false, error: "未检索到相关背景，建议手动补充来源后再制卡。" } : p));
        return;
      }
      await runAICards(text, webContext);
    } catch (err) {
      setAiPanel((p) =>
        p && p.kind === "cards"
          ? { ...p, searching: false, error: err instanceof Error ? err.message : String(err) }
          : p
      );
    }
  }

  // ---------- v16 递进补卡：知识点「后续可补」注记 → 询问 AI / 直接制卡 ----------
  const explorationSeqRef = useRef(0);

  function patchExploration(explId: number, patch: Partial<{ answer: string; running: boolean; startedAt?: number; thinking?: number; error?: string }>) {
    setAiPanel((p) =>
      p ? { ...p, explorations: (p.explorations ?? []).map((e) => (e.id === explId ? { ...e, ...patch } : e)) } : p
    );
  }

  // 询问 AI 相关内容：解释追加在面板最下方，解释末尾带「直接制卡」
  async function runExploration(item: string, kpTitle: string) {
    if (!aiPanel) return;
    const explId = ++explorationSeqRef.current;
    const question = `就这段文字中的知识点「${kpTitle}」，请解释与「${item}」直接相关的具体内容：若是原因/例子/联系类方向，给出可直接用于制卡的实质内容；若是某个出处、概念或典故，请解释它本身并说明与本段文字的联系。`;
    setAiPanel((p) =>
      p
        ? {
            ...p,
            explorations: [
              ...(p.explorations ?? []),
              { id: explId, item, kpTitle, question, answer: "", running: true, startedAt: Date.now(), thinking: 0 }
            ]
          }
        : p
    );
    try {
      const answer = await cardGenerator.explain(
        aiPanel.text,
        `${sourceTitle ?? ""}${contextLabel ? " · " + contextLabel : ""}`,
        question,
        (acc) => patchExploration(explId, { answer: acc }),
        (thinkChars) => patchExploration(explId, { thinking: thinkChars })
      );
      patchExploration(explId, { running: false, answer, startedAt: undefined, thinking: undefined });
    } catch (err) {
      patchExploration(explId, {
        running: false,
        startedAt: undefined,
        thinking: undefined,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // 直接制卡：以原选文为材料 +「本次制卡重点」指令 + 已有卡清单（防重复），
  // 生成 1-3 张补充卡追加到卡片清单末尾；contextRef 沿用同一次选区锚点（跳转原文同一位置）
  async function runFollowUpCards(item: string, kpTitle: string, hint?: string) {
    const panel = aiPanel;
    if (!panel || !panel.drafts) return;
    if ((panel.followUpBusy ?? []).includes(item)) return;
    setAiPanel((p) =>
      p
        ? {
            ...p,
            followUpBusy: [...(p.followUpBusy ?? []), item],
            followUpStarted: { ...(p.followUpStarted ?? {}), [item]: Date.now() },
            followUpErrors: { ...(p.followUpErrors ?? {}), [item]: "" }
          }
        : p
    );
    try {
      const focus = [
        `这是对同一段材料的补充制卡。知识点「${kpTitle}」的补充方向：「${item}」。`,
        "请只产 1-3 张该方向的补充卡，禁止与已有卡重复或换皮。",
        hint ? `可参考以下解释作为卡面素材（提炼为短答案，禁止照抄长句）：\n${hint.slice(0, 400)}` : ""
      ]
        .filter(Boolean)
        .join("\n");
      const { result } = await cardGenerator.generateCards(
        panel.text,
        {
          title: sourceTitle,
          section: contextLabel,
          documentId: contextRef?.documentId ?? null,
          existingCards: panel.drafts
            .map((d) => d.front || d.cloze || "")
            .filter(Boolean)
            .slice(0, 10),
          focus
        },
        "card-generation"
      );
      setAiPanel((p) => {
        if (!p || !p.drafts) return p;
        const start = p.drafts.length;
        const supplemental = new Set(p.supplemental ?? []);
        for (let k = 0; k < result.cards.length; k++) supplemental.add(start + k);
        return {
          ...p,
          drafts: [...p.drafts, ...result.cards],
          supplemental,
          followUpBusy: (p.followUpBusy ?? []).filter((x) => x !== item),
          followUpStarted: { ...(p.followUpStarted ?? {}), [item]: undefined }
        } as typeof p;
      });
      showToast("补充卡已生成，请确认后接受");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel((p) =>
        p
          ? {
              ...p,
              followUpBusy: (p.followUpBusy ?? []).filter((x) => x !== item),
              followUpStarted: { ...(p.followUpStarted ?? {}), [item]: undefined },
              followUpErrors: { ...(p.followUpErrors ?? {}), [item]: msg }
            }
          : p
      );
    }
  }

  async function acceptDraft(draft: CardDraft, draftIndex: number, edited?: Partial<CardDraft>) {
    if (aiPanel?.accepted?.has(draftIndex)) return; // 防重复入队
    const d = { ...draft, ...edited };
    // v30：建卡逻辑抽至 createAcceptedCard（与复习对比卡确认框共用）；per-blank 多空草稿在其内拆成每空一张
    // v34（M12）：sourceText 参与短材料锚点键的长度门控——同一句短材料的多角度卡同日只放行一张
    // v41（K2-A，D38）：genBatchId 落库 → 簇键 batch:<id>:<kp>，接受后后台顺带 AI 抽取归一
    const expandedCount = expandClozeDraft(d).length;
    const mmNodeId = aiPanel?.mindmapNodeId;
    await createAcceptedCard(d, {
      sourceTitle,
      contextRef: mmNodeId ? { ...enrichedContextRef(), mindmapNodeId: mmNodeId } : enrichedContextRef(),
      sourceText: aiPanel?.text ?? null,
      genBatchId: aiPanel?.batchId ?? null,
      // v48（M15，D41-⑥）：同一导图节点产出的多卡同日只放行一张（M12 同源延后语义）
      siblingKey: mmNodeId ? `act:mindmap-${mmNodeId}` : undefined
    });
    setAiPanel((p) =>
      p && p.drafts
        ? { ...p, accepted: new Set([...(p.accepted ?? []), draftIndex]) }
        : p
    );
    eventBus.emit("cards/changed");
    showToast(expandedCount > 1 ? `已接受，分答拆为 ${expandedCount} 张卡进 FSRS 队列` : "已接受，进 FSRS 队列");
  }

  async function rejectAllDrafts() {
    if (aiPanel?.batchId) await cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
    setAiPanel(null);
  }

  // ---------- AI 解释（Phase 12） ----------
  async function runExplain(text: string, question: string | null) {
    setAiPanel({ kind: "explain", text, answer: question ? undefined : "", running: true, startedAt: Date.now(), thinking: 0 });
    try {
      const answer = await cardGenerator.explain(
        text,
        `${title}${contextLabel ? " · " + contextLabel : ""}`,
        question,
        (acc) => setAiPanel((p) => (p && p.kind === "explain" ? { ...p, answer: acc, running: true } : p)),
        (thinkChars) => setAiPanel((p) => (p && p.kind === "explain" ? { ...p, thinking: thinkChars } : p))
      );
      setAiPanel({ kind: "explain", text, answer, running: false, startedAt: undefined, thinking: undefined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "explain",
        text,
        running: false,
        startedAt: undefined,
        thinking: undefined,
        error:
          msg.includes("API Key")
            ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
            : msg
      });
    }
  }

  // ---------- 摘录 ----------
  /**
   * v48.23（D61 §6.8-11）：多段不相邻选择时把原始 spans 一并交给工作流——主进程按 spans 优先
   * 装配 content_markdown 与 quote_range_json（一条批注、多段区间、多组矩形）。
   * 只在**真多段（≥2）**时传：单段路径保持既有载荷逐字节不变。
   */
  async function handleExtract(text: string, spans?: ExtractSpan[]) {
    const { readingWorkflow } = await import("../lib/readingWorkflow");
    // 需求2：摘录同样记录选区锚点（跳转原文用）
    rememberAnchor(text);
    const ctx = enrichedContextRef();
    const multi = spans && spans.length >= 2 ? spans : undefined;
    // v48.24 批3（§4 写入侧）：**根摘录**额外落 `sourceAnchor`（三条腿的容器形态）——文中留痕据此重画。
    // 子摘录（contextRef.extractId）锚在父卡文本里（parentRange），不写源锚。
    const sourceAnchor = contextRef?.extractId ? null : buildSourceAnchor(text);
    const ctxWithAnchor = sourceAnchor ? { ...(ctx || {}), sourceAnchor } : ctx;
    if (contextRef?.extractId) {
      await readingWorkflow.create({
        parentType: "extract",
        parentId: contextRef.extractId,
        documentId: contextRef.documentId || "",
        contentMarkdown: text,
        contextRef: ctxWithAnchor,
        spans: multi
      });
    } else if (contextRef?.documentId) {
      await readingWorkflow.create({
        parentType: "document",
        parentId: contextRef.documentId,
        documentId: contextRef.documentId,
        contentMarkdown: text,
        contextRef: ctxWithAnchor,
        spans: multi
      });
    }
    eventBus.emit("workflow/changed");
    showToast("已摘录进学习队列");
  }

  // ---------- M4 快捷键动作（§9.1 M4：与下方选区菜单按钮完全同源） ----------
  function actManualCard() {
    if (!selection) return;
    rememberAnchor(selection.text);
    setManualOpen(true);
    clearSelection();
  }
  function actAICards() {
    if (!selection) return;
    rememberAnchor(selection.text);
    const t = selection.text;
    clearSelection();
    void runAICards(t, undefined, aiMode);
  }
  function actAIExplain() {
    if (!selection) return;
    const t = selection.text;
    clearSelection();
    void runExplain(t, null);
  }
  function actExtractSelection() {
    if (!selection) return;
    const t = selection.text;
    const spans = selection.spans;
    clearSelection();
    void handleExtract(t, spans);
  }

  // ---------- M7 查词（v32，D31）：选中单词 → DictPanel（原文即显→Loading→填充/错误），在线绝不阻塞 ----------
  const [dictPanel, setDictPanel] = useState<DictPanelState | null>(null);
  const [dictReading, setDictReading] = useState<ReadingContext | null>(null);
  const [dictFields, setDictFields] = useState<Record<string, boolean>>({});
  const [dictBusy, setDictBusy] = useState(false);
  // v38（D35）：① 本次查词的手动语言切换（新选词重置；ref 供异步 lookup 读最新值，state 供面板高亮）
  const [dictManualLang, setDictManualLang] = useState<string | null>(null);
  const dictManualLangRef = useRef<string | null>(null);
  // ② 书籍语言属性（library_items.lang）——查词语言路由的书籍级信号（未标注为空，靠句子启发）
  const bookLangRef = useRef("");
  useEffect(() => {
    let cancelled = false;
    bookLangRef.current = "";
    void libraryApi.list().then((items) => {
      if (!cancelled) bookLangRef.current = items.find((it) => it.id === itemId)?.lang ?? "";
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [itemId]);
  function setDictManualLangBoth(lang: string | null) {
    dictManualLangRef.current = lang;
    setDictManualLang(lang);
  }
  // 原句上下文：markdown 全文定位选中词前后各 ~120 字（引擎书无 markdown 时用 anchorText 兜底）
  function sentenceContext(raw: string): string {
    const body = String(markdown || "");
    const idx = body ? body.indexOf(raw) : -1;
    if (idx >= 0) return body.slice(Math.max(0, idx - 120), idx + raw.length + 120);
    return engineSelRef.current?.anchorText || anchorRef.current?.anchorText || raw;
  }
  async function runLookup(forceLocal = false, rawOverride?: string) {
    const raw = (rawOverride ?? selection?.text ?? "").trim();
    if (!raw || dictBusy) return;
    if (!rawOverride && !isVocabSelection(raw)) {
      showToast("所选过长，已走 AI 制卡更合适");
      return;
    }
    setDictBusy(true);
    const reading = buildReadingContext({
      selectedText: raw,
      contextText: sentenceContext(raw),
      documentId: contextRef?.documentId ?? null,
      cfi: engineSelRef.current?.cfi ?? jumpAnchor?.cfi ?? null,
      pageIndex: engineSelRef.current?.pageIndex ?? jumpAnchor?.pageIndex ?? null,
      anchorText: engineSelRef.current?.anchorText ?? raw.slice(0, 60),
    });
    setDictReading(reading);
    setDictPanel({ selectedText: raw, sentence: reading.sentence, running: true, error: null });
    // v38（D35）：语言路由信号一次备齐——手动切换 > 书籍语言 > 句中假名 > 字面正则，由 resolveLookupLanguage 组合
    const langOpts = {
      languageHint: dictManualLangRef.current ?? undefined,
      bookLanguage: bookLangRef.current || undefined,
      sentence: reading.sentence,
    };
    try {
      const settings = await loadDictSettings();
      setDictFields(settings.popupFields);
      if (forceLocal) {
        const { buildManager } = await import("../lib/dictClient");
        const manager = buildManager("local");
        const result = await manager.lookup(raw, langOpts);
        setDictPanel({ selectedText: raw, sentence: reading.sentence, running: false, entry: result.entry, providerId: result.providerId, fromCache: result.fromCache, mode: "local" });
      } else {
        const result = await lookupWord(raw, langOpts);
        setDictPanel({ selectedText: raw, sentence: reading.sentence, running: false, entry: result.entry, providerId: result.providerId, fromCache: result.fromCache, mode: result.mode });
      }
    } catch (err) {
      setDictPanel({
        selectedText: raw,
        sentence: reading.sentence,
        running: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDictBusy(false);
    }
  }
  function actLookupWord() {
    if (!selection) return;
    rememberAnchor(selection.text);
    const t = selection.text;
    clearSelection();
    setDictManualLangBoth(null); // v38（D35）：新选词重置手动语言
    void runLookup(false, t);
  }
  // 一键制卡：勾选的快照卡（D18 独立卡）经 createAcceptedCard 入库（lint+S1 同 AI 链路）。
  // dictJson 随插入一次写入——cards:update 是全行 UPDATE，建卡后 partial update 曾把内容列清空（空白卡根因）。
  // 每张卡各自带 kind（听音/挖空等按钮入位由 CardFace 按它分流）；kinds=本次勾选清单（记忆用信息留存）。
  async function acceptVocabCards(entry: DictionaryEntry, ctx: ReadingContext, kinds: VocabKind[]) {
    const drafts = buildVocabDrafts(entry, ctx, kinds);
    let n = 0;
    for (const v of drafts) {
      const dictJson = { providerId: entry.source, word: entry.word, normalizedWord: entry.normalizedWord, language: entry.language, audio: entry.audio ?? null, kind: v.kind, kinds, snapshotAt: Date.now() };
      const d: CardDraft = {
        cardType: v.cardType,
        contextPrefix: v.contextPrefix,
        domain: ["8"],
        front: v.front,
        back: v.back,
        cloze: v.cloze ?? null,
        example: v.example,
        sourceRef: sourceTitle ? { title: sourceTitle } : { title: `词典:${entry.source}` },
        prioritySuggestion: 50,
        ruleNotes: ["R2", "R14", "R16"],
        warnings: [],
      };
      // v34（M12，§4.16）：单词四卡（D31 快照制）来自同一次查词 → 同锚点键互为同源，同日只放行一张；
      // sourceText=查词原词（恒 ≤ 阈值 → 必建键），同一词在同一位置重复制卡也会归入同组
      await createAcceptedCard(d, { sourceTitle: sourceTitle ?? entry.source, contextRef: enrichedContextRef(), dictJson, sourceText: ctx.selectedText || entry.word });
      n += 1;
    }
    eventBus.emit("cards/changed");
    setDictPanel(null);
    showToast(`已创建 ${n} 张单词卡（${drafts.map((v) => VOCAB_KIND_LABEL[v.kind]).join("/")}）`);
  }

  // 阅读场景快捷键（制卡 Ctrl+Z / AI 制卡 Ctrl+X / AI 解释 Ctrl+A / 摘录 Ctrl+S / 查词 Ctrl+D）：
  // 仅当存在活动选区且无手动制卡弹窗、无 AI 面板时可用（弹层开着不触发新动作）
  const readerShortcutReady = !!selection && !manualOpen && !aiPanel && !dictPanel;
  useCommandActions("reader", {
    "reader.makeCard": { when: () => readerShortcutReady, run: actManualCard },
    "reader.aiCards": { when: () => readerShortcutReady, run: actAICards },
    "reader.aiExplain": { when: () => readerShortcutReady, run: actAIExplain },
    "reader.extract": { when: () => readerShortcutReady, run: actExtractSelection },
    "reader.lookupWord": { when: () => readerShortcutReady, run: actLookupWord }
  });

  return (
    <div className="reader-wrap">
      {/* E-1（审计）：目录是 absolute 浮层，打开时正文必须让位，否则行首被压在面板下 */}
      <div className={`reader-body${aiPanel ? " reader-body-shifted" : ""}${tocOpen ? " reader-body-toc-open" : ""}`}>
        <div
          ref={scrollRef}
          className={`reader-scroll${engineMode ? " reader-scroll-engine" : ""}`}
          onMouseUp={engineMode ? undefined : handleMouseUp}
          onScroll={engineMode ? undefined : handleScroll}
        >
          {engineSource ? (
            <>
              <div className="reader-engine-controls">
                <div className="reader-engine-controls-group">
                  {/* v28 PDF 原生阅读：无大纲时目录按钮隐藏（getTOC 为空）；foliate 系恒有目录 */}
                  {(engineKind !== "pdf" || tocItems.length > 0) && (
                    <button className="btn btn-outline btn-sm" onClick={() => setTocOpen((v) => !v)}>
                      目录
                    </button>
                  )}
                  {/* v48 批3（M15，D42）：目录旁「导图」→ 全屏 Overlay 工作区（内核不销毁，正文返回原位） */}
                  <button className="btn btn-outline btn-sm" data-mindmap-entry disabled={!contextRef?.documentId} onClick={() => setMindmapOpen(true)}>
                    导图
                  </button>
                  {/* v48.22（D58 §6.8-8）：集中复习本书的摘录 / 闪卡——按书范围会话，遵循共享每日预算 */}
                  <button
                    className="btn btn-outline btn-sm"
                    data-review-extracts
                    disabled={!itemId || !onReviewExtracts}
                    title="集中复习本书的摘录（遵循每日上限）"
                    onClick={() => onReviewExtracts?.()}
                  >
                    复习摘录
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    data-review-cards
                    disabled={!itemId || !onReviewCards}
                    title="集中复习本书的闪卡（遵循每日上限）"
                    onClick={() => onReviewCards?.()}
                  >
                    复习闪卡
                  </button>
                  <span className="reader-engine-divider" aria-hidden="true" />
                  <button className="btn btn-outline btn-sm reader-nav-btn" title="上一页（←）" aria-label="上一页" onClick={() => void turnPage(-1)}>
                    <IconChevronLeft />
                  </button>
                  <button className="btn btn-outline btn-sm reader-nav-btn" title="下一页（→ / 空格）" aria-label="下一页" onClick={() => void turnPage(1)}>
                    <IconChevronRight />
                  </button>
                </div>
                <div className="reader-engine-controls-group">
                  <Dropdown
                    align="left"
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
                  <Dropdown
                    align="left"
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
                  {engineKind === "pdf" && (
                    <Dropdown
                      align="left"
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
                  )}
                </div>
              </div>
              <div className="reader-engine-viewport">
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
                {tocOpen && (
                  <TocSidebar
                    items={tocItems}
                    activeHref={tocActiveHref}
                    onNavigate={(item) => {
                      void kernelRef.current?.goTo({ href: item.href });
                      setTocOpen(false);
                    }}
                    onClose={() => setTocOpen(false)}
                  />
                )}
              </div>
            </>
          ) : (
            <article className="reader-markdown">
              <h1 className="reader-title">{title}</h1>
              {contextLabel && <p className="reader-context">{contextLabel}</p>}
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {markdown}
              </ReactMarkdown>
            </article>
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
            <div
              className="selection-menu"
              style={engineMode ? { position: "fixed", left: selection.x, top: Math.max(8, selection.y) } : { left: selection.x, top: Math.max(8, selection.y) }}
            >
              <button onClick={actManualCard}>制卡</button>
              <button onClick={actAICards}>AI 制卡</button>
              <button onClick={actAIExplain}>AI 解释</button>
              <button onClick={actExtractSelection}>摘录</button>
              <button onClick={actLookupWord}>查词</button>
              <button onClick={() => { clearSelection(); void runOcclusionCards(); }}>图片挖空</button>
            </div>
          )}
        </div>

        {manualOpen && (
          <ManualCardEditor
            quote={markCardText ?? selection?.text ?? ""}
            imageRegion={manualImage ?? undefined}
            onCancel={() => {
              markCardRefOverrideRef.current = null;
              setMarkCardText(null);
              setManualOpen(false);
              setManualImage(null);
            }}
            onSave={async (p) => {
              try {
                await handleManualCard(p);
              } finally {
                // v48.24 批3（§4）：标记浮层进来的 contextRef 覆盖值用完即清（别串给下一张卡）
                markCardRefOverrideRef.current = null;
                setMarkCardText(null);
              }
            }}
          />
        )}

        {dictPanel && (
          <DictPanel
            panel={dictPanel}
            reading={dictReading}
            popupFields={dictFields}
            manualLang={dictManualLang}
            onClose={() => setDictPanel(null)}
            onRetry={() => void runLookup(false, dictPanel.selectedText)}
            onUseLocal={() => void runLookup(true, dictPanel.selectedText)}
            // v38（D35）：面板语言切换——以对应语言重查（"auto"=清除手动选择走自动路由）
            onSelectLanguage={(lang) => {
              setDictManualLangBoth(lang === "auto" ? null : lang);
              void runLookup(false, dictPanel.selectedText);
            }}
            onMakeCards={(entry: DictionaryEntry, ctx: ReadingContext, kinds: VocabKind[]) => void acceptVocabCards(entry, ctx, kinds)}
          />
        )}

        {aiPanel && (
          <AIPanel
            panel={{ ...aiPanel, elapsedSec }}
            onClose={() => {
              if (
                (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") &&
                aiPanel.batchId &&
                aiPanel.drafts?.length
              ) {
                cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
              }
              setAiPanel(null);
            }}
            onAccept={(d, idx, edited) => {
              return acceptDraft(d, idx, edited);
            }}
            onAcceptOcclusion={(d, idx) => acceptOcclusionDraft(d, idx)}
            onEdit={(idx, patch) => {
              setAiPanel((p) => {
                if (!p || !p.drafts) return p;
                const next = [...p.drafts];
                next[idx] = { ...next[idx], ...patch };
                return { ...p, drafts: next };
              });
            }}
            onSplitReverse={(idx) => {
              // v16（D18）：「转翻转卡」= 拆为两张互为翻转的独立 qa 草稿（各自有独立 FSRS 调度）
              setAiPanel((p) => {
                if (!p || !p.drafts) return p;
                const d = p.drafts[idx];
                const a: CardDraft = { ...d, cardType: "qa", front: d.front, back: d.back };
                const b: CardDraft = {
                  ...d,
                  cardType: "qa",
                  front: (d.back || "").trim() || d.front,
                  back: d.front,
                  cloze: null
                };
                const next = [...p.drafts.slice(0, idx), a, b, ...p.drafts.slice(idx + 1)];
                // 拆分点之后的已接受/补充标记索引整体右移一位，保持对位
                const accepted = new Set([...(p.accepted ?? [])].map((k) => (k > idx ? k + 1 : k)));
                const supplemental = new Set([...(p.supplemental ?? [])].map((k) => (k > idx ? k + 1 : k)));
                return { ...p, drafts: next, accepted, supplemental };
              });
            }}
            onRejectAll={rejectAllDrafts}
            onExplain={(q) => runExplain(aiPanel.text, q)}
            onMakeCards={() => runAICards(aiPanel.text, undefined, aiMode)}
            onModeChange={(m) => changeAiMode(m)}
            mode={aiMode}
            onSearchBackground={() => searchAndRetry(aiPanel.text)}
            onFollowUpCards={(item, kpTitle, hint) => runFollowUpCards(item, kpTitle, hint)}
            onExploration={(item, kpTitle) => runExploration(item, kpTitle)}
            elapsedTick={nowTick}
          />
        )}
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

      {/* v48.24 批3（§4 文中留痕）：标记浮层——原文 + 批注 + 已制卡数 + 「就此制卡」。
          hover 出现、点标记钉住、点别处/Esc 收起；「就此制卡」走既有手动制卡链。 */}
      {markPop && (() => {
        const mark = marksRef.current.find((m) => m.id === markPop.id);
        if (!mark) return null;
        return (
          <MarkPopover
            mark={mark}
            anchor={markPop.rect}
            onMakeCard={() => startMarkCard(mark)}
            onClose={closeMarkPop}
            onKeepOpen={() => {
              if (markHideTimerRef.current) {
                window.clearTimeout(markHideTimerRef.current);
                markHideTimerRef.current = null;
              }
            }}
            onRelease={() => {
              if (markPinnedRef.current || markHideTimerRef.current !== null) return;
              markHideTimerRef.current = window.setTimeout(() => {
                markHideTimerRef.current = null;
                setMarkPop(null);
              }, 160);
            }}
          />
        );
      })()}

      {/* v48 批3（M15，D42）：全屏导图工作区——内核保活，「正文」返回即原位；节点制卡走既有 AI 制卡链路 */}
      {mindmapOpen && engineSource && contextRef?.documentId && kernelRef.current && (
        <MindmapWorkspace
          kernel={kernelRef.current}
          documentId={contextRef.documentId}
          title={title || sourceTitle || "未命名材料"}
          initialMapId={openMindmapMapId || null}
          initialResumeRunId={resumeOnce}
          onBack={() => setMindmapOpen(false)}
          onMakeCardsFromNode={(payload) => {
            setMindmapOpen(false);
            // v48.5 批C：结构制卡——mode=card-structure（导图节点专用分支，对作者组织结构出题）
            void runAICards(payload.section, undefined, "card-structure", { focus: payload.focus, mindmapNodeId: payload.nodeId });
          }}
        />
      )}

      {toast && <div className="reader-toast">{toast}</div>}
    </div>
  );
}
