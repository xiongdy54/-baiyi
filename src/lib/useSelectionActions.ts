// 选区五动作的唯一编排面（批 4 Task 7，R30）：摘录页与阅读器共用同一份实现。
// 本文件**不含任何 DOM 结构**——菜单/面板由宿主渲染，这里只管状态与动作。
// 抽出前这些实现在 Reader.tsx 内（闭包耦合内核/滚动容器/锚点）；抽出方式＝把它们真正
// 依赖的宿主能力收敛成 adapter（见 SelectionActionsAdapter），逐条替换调用，行为零改动。
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  cardGenerator,
  lintCard,
  cardsApi,
  createAcceptedCard,
  detectMaterialType,
  expandClozeDraft,
  burySourceTextLimit,
  siblingKeyFor,
  requestOcclusionResult,
  MATERIAL_ROUTES,
  type CardDraft,
  type CardGenMode,
  type OcclusionRegion
} from "./cards";
import { VOCAB_KIND_LABEL, buildVocabDrafts, isVocabSelection, type DictionaryEntry, type ReadingContext, type VocabKind } from "./dict";
import { buildReadingContext, loadDictSettings, lookupWord } from "./dictClient";
import { libraryApi } from "./library";
import { normalizeShape, shapeBBox, type OcclusionRect, type OcclusionShape } from "./occlusion";
import { eventBus } from "./eventbus";
import type { DictPanelState } from "../components/DictPanel";
import type { ImageFocusSubmit } from "../components/reader/ImageFocus";
import type { OcclusionEditorSubmit } from "../components/editor/OcclusionEditor";
import type { ManualCardPayload } from "../components/ManualCardEditor";
import { createManualCard } from "./manualCard";
import { normalizeTags } from "./tags";
import { routeExplainMode, type ExplainModePref } from "./explainRouter";
import type { ExtractSpan } from "./readingWorkflow";

/** 宿主注入面：钩子只从这些函数取值，不反向持有宿主 UI 状态 */
export interface SelectionActionsAdapter {
  /** 本次动作的目标文本（多段选择＝主进程拼接后的文本）；无选区返回 null */
  selectionText: () => string | null;
  /** 多段选择的原始采集物（单段宿主可返回 undefined） */
  selectionSpans: () => ExtractSpan[] | undefined;
  /** 多段累计的偏移区间（v48.38 / D78，摘录页）：落库时 ≥2 段才写入 contextRef.parentRange（单段路径逐字节不变）；须在 clearSelection 前取 */
  selectionRanges?: () => Array<{ start: number; end: number }> | null;
  /** 制卡用的 contextRef（含锚点覆盖与引擎 locator 降级），动作执行时求值 */
  contextRef: () => Record<string, unknown> | null;
  /** 当前阅读位置的事实源（只看 documentId / extractId 两个键） */
  sourceContext: () => { documentId?: string; extractId?: string };
  /** 提示词与面板上的来源标签：title＝解释侧栏用，sourceTitle/section＝制卡用 */
  labels: { title?: string; sourceTitle?: string; section?: string };
  /** assets 表归属键（本书/本文档） */
  ownerKey: () => string;
  /** 本书 id（查词语言路由的书籍级信号按它取） */
  itemId?: string | null;
  /** 本次制卡的完整源文本（短材料锚点键的长度门控输入） */
  sourceTextRef: MutableRefObject<string>;
  /** 正文全文（查词原句上下文的定位底本） */
  bodyText?: string;
  /** 查词定位：内核选区优先，回落到进入时的跳转锚 */
  lookupLocator: () => { cfi?: string | null; pageIndex?: number | null };
  /** 原句上下文的锚点兜底：内核选区锚点 > 制卡锚点 */
  anchorText: () => string | null;
  /** 选区锚点快照（跳转原文用） */
  rememberAnchor: (text: string) => void;
  /** 收菜单 + 清选区（引擎与 markdown 两分支语义不同，由宿主给） */
  clearSelection: () => void;
  /** 图片入口无文本选区：清掉残留锚点，避免把旧锚点挂到新卡上 */
  clearAnchor: () => void;
  /** 资源库选图入口：另清内核选区记录 */
  clearKernelSelection?: () => void;
  /** 建卡来源：engine=正文图片（可跳转）/ library=资源库选图（无定位锚） */
  occlusionSourceRef: MutableRefObject<"engine" | "library">;
  showToast: (msg: string) => void;
  /** 标记浮层「就此制卡」用的源锚装配（宿主持有内核选区几何） */
  buildSourceAnchor: (text: string) => Record<string, unknown> | null;
  /**
   * 批注/高亮的落库父级（规格 §3.4 两宿主不同）：
   * 阅读器＝按 sourceContext 分流（根摘录 anchor 到 document、子摘录 anchor 到父摘录）；
   * 摘录页＝**恒挂在当前卡上**（parentType:"extract"、parentId＝当前卡 id、parentRange＝所选区间）。
   * 不传则回落到阅读器口径。
   */
  annotateParent?: () => {
    parentType: "document" | "extract";
    parentId: string;
    documentId: string;
    /**
     * 追加到 contextRef 的层级身份键（与既有的「子摘录」同形）：
     * `{extractId, parentExtractId, rootExtractId, parentRange}`。
     * **父卡坐标下的引文范围必须走 `parentRange`**，不能当成本行自己的 `quoteRange`——
     * 后者是**本条正文**的坐标（落库按本条长度归一，父坐标会被当作越界整段丢掉，实测踩过）。
     */
    contextRefPatch?: Record<string, unknown>;
  } | null;
  /** 手动制卡浮层提交/取消后的一次性收尾（宿主清 contextRef 覆盖值） */
  onManualSettled?: () => void;
  /** 图片聚焦层（宿主状态）：动作从这里取聚焦图，并回写忙态/关闭 */
  focus: {
    get: () => { dataUrl: string; alt: string; contextText?: string } | null;
    close: () => void;
    setBusy: (busy: boolean) => void;
  };
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

/** AI 面板状态（原 Reader.tsx 内联类型，逐字搬入） */
export interface AiPanelState {
  kind: "explain" | "cards" | "occlusion";
  text: string;
  /** v48（M15，D41-⑥）：本批卡片来自哪个导图节点（就此制卡溯源） */
  mindmapNodeId?: string;
  /** v48.51（D91 §5.2）：解释面板携带的解读方式三态（auto=路由器解析；切换器显示用） */
  explainMode?: ExplainModePref;
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
}

export type SelectionActions = ReturnType<typeof useSelectionActions>;

export function useSelectionActions(adapter: SelectionActionsAdapter) {
  const { showToast, sourceTextRef, occlusionSourceRef } = adapter;
  // 动作是渲染期创建的普通函数（与抽出前一致）；回调里一律读最新的 adapter，避免快照过期
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const A = () => adapterRef.current;

  const [aiPanel, setAiPanel] = useState<AiPanelState | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // v48.60（D101 §1.4④）：批注标签继承初值——打开手动表单时从来源摘录读取（表单内可删）
  const [manualTagsInitial, setManualTagsInitial] = useState<string[]>([]);
  // v48.52（D92 §4）：右侧学习坞会话态——首次唤起后常驻挂载（收起≠关闭，dockEverOpened 只进不出）
  const [dockEverOpened, setDockEverOpened] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  /** v48.52（D92 §3.2）：显式页签选择；新 AI 内容到达时由派生 effect 覆盖（§6.3 内容派生规则） */
  const [dockTab, setDockTab] = useState<"explain" | "cards">("explain");
  /** v48.52（D92 §3.4）：手动暂态是否正占坞体（切页签时表单隐藏保活、manualOpen 不动） */
  const [manualActive, setManualActive] = useState(false);
  // v25：手动制卡的图片选区（从聚焦工具条「手动制卡」进入时携带；D98 起该链路不可达，P1 评估退役）
  const [manualImage, setManualImage] = useState<{
    dataUrl: string;
    alt: string;
    shape: OcclusionShape;
    rect: OcclusionRect;
  } | null>(null);
  // D98（v48.57 R1）：手动图片挖空编辑器会话态——点击正文图片直进（图片聚焦中间层退役）
  const [occlEditor, setOcclEditor] = useState<{
    image: { dataUrl: string; alt: string; contextText?: string };
    origin: { x: number; y: number; width: number; height: number } | null;
  } | null>(null);
  /** 手动制卡引用文本（选区文本，或标记浮层「就此制卡」给出的摘录文本） */
  const [manualQuote, setManualQuote] = useState<string | null>(null);
  // v48.51（D91 §5.3）：解读方式三态（auto=默认；显式选择会话内记忆，切回 auto 恢复自动）
  const [explainMode, setExplainMode] = useState<ExplainModePref>("auto");
  const explainModeRef = useRef<ExplainModePref>("auto");
  explainModeRef.current = explainMode;
  const [dictPanel, setDictPanel] = useState<DictPanelState | null>(null);
  const [dictReading, setDictReading] = useState<ReadingContext | null>(null);
  const [dictFields, setDictFields] = useState<Record<string, boolean>>({});
  const [dictBusy, setDictBusy] = useState(false);
  // v38（D35）：① 本次查词的手动语言切换（新选词重置；ref 供异步 lookup 读最新值，state 供面板高亮）
  const [dictManualLang, setDictManualLang] = useState<string | null>(null);
  const dictManualLangRef = useRef<string | null>(null);
  // ② 书籍语言属性（library_items.lang）——查词语言路由的书籍级信号（未标注为空，靠句子启发）
  const bookLangRef = useRef("");
  const itemIdForLang = adapter.itemId ?? "";
  useEffect(() => {
    let cancelled = false;
    bookLangRef.current = "";
    if (!itemIdForLang) return;
    void libraryApi.list().then((items) => {
      if (!cancelled) bookLangRef.current = items.find((it) => it.id === itemIdForLang)?.lang ?? "";
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [itemIdForLang]);

  function setDictManualLangBoth(lang: string | null) {
    dictManualLangRef.current = lang;
    setDictManualLang(lang);
  }

  // ---------- v48.52（D92 §3.3/§4）：学习坞收展与会话态 ----------
  /** 任何唤坞动作（工具栏 AI 解释/AI 制卡/制卡、追问、就此制卡）自动展开 */
  function wakeDock() {
    setDockEverOpened(true);
    setDockOpen(true);
  }
  /** 收起 ≠ 关闭：坞体滑出、状态保留（流式/草稿/计时继续），把手仍可展开 */
  function collapseDock() {
    setDockOpen(false);
  }
  function expandDock() {
    wakeDock();
  }
  /** 显式页签点击：停留所点页签并让手动暂态退场（表单隐藏保活，manualOpen 不动） */
  function changeDockTab(tab: "explain" | "cards") {
    setDockTab(tab);
    setManualActive(false);
  }
  // 内容派生（D92 §3.2/§7.5）：**显式点击 > 内容派生**——新内容到达时覆盖显式选择。
  // 「新内容到达」＝ aiPanel.kind 变化（含 null→kind）**或** startedAt 变化（同 kind 重跑：
  // 面板已在解释态时再点「AI 解释」仍是新内容，验收 §7.5 要求自动切回对应页签）；
  // 无新内容（完成态 startedAt=undefined、同 kind 流式增量）不打扰用户当前所在页签。
  const prevKindRef = useRef<AiPanelState["kind"] | null>(null);
  const prevStartRef = useRef<number | null>(null);
  useEffect(() => {
    const kind = aiPanel?.kind ?? null;
    const startedAt = typeof aiPanel?.startedAt === "number" ? aiPanel.startedAt : null;
    const kindChanged = kind !== prevKindRef.current;
    const newRun = startedAt !== null && startedAt !== prevStartRef.current;
    prevKindRef.current = kind;
    prevStartRef.current = startedAt;
    if (!kind || (!kindChanged && !newRun)) return;
    setDockEverOpened(true);
    setDockOpen(true);
    setDockTab(kind === "explain" ? "explain" : "cards");
    setManualActive(false);
  }, [aiPanel?.kind, aiPanel?.startedAt]);

  /** v25：选区提交前把整图落盘（assets 表）——卡片 occlusion_json 需要稳定的 assetPath */
  async function ensureImageAsset(dataUrl: string): Promise<string | null> {
    const ownerKey = A().ownerKey();
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
  }

  // ---------- 手动制卡（Phase 3：引用+可编辑副本模式；v16 翻转问答 = 制卡手段，产两张独立问答卡；
  // M5（v25）：与 AI 制卡同构的字段集——类型选择 / UDC 领域标签 / contextPrefix / 助记 / 知识点分组 / 日期标记，
  // 一律过 CardLintEngine + 相似检索；图片挖空手动卡由正文图片选区进入（front/back 可编辑） ----------

  /** v48.60（D101 §1.4④）：批注标签继承——读来源摘录（D61）的 tag_json 作为制卡标签初值。
   *  继承的是用户自己打的批注标签（非 AI 产出）；无来源摘录/坏 JSON 一律空（不猜）。 */
  function inheritedExtractTags(): Promise<string[]> {
    const extractId = A().sourceContext().extractId;
    if (!extractId) return Promise.resolve([]);
    return (window.workflowAPI?.get(extractId) as Promise<{ tagJson?: string | null } | undefined> | undefined)
      ?.then((ext) => {
        if (!ext?.tagJson) return [];
        try {
          const arr = JSON.parse(ext.tagJson);
          return normalizeTags(Array.isArray(arr) ? arr : []);
        } catch {
          return [];
        }
      })
      .catch(() => []) ?? Promise.resolve([]);
  }
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
    /** v48.60（D101）：用户标签（调用方已 normalize） */
    tags?: string[];
    occlusionJson?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; assetPath: string; shapes?: OcclusionShape[] | null; regionScope?: string } | null;
    cardOrd?: number;
    // v34（M12，§4.16）：同源组键——翻转对/同图卡由调用点显式给出；普通卡由 handleManualCard 预先推导
    siblingKey?: string | null;
  }): Promise<void> {
    const sourceRef = A().labels.sourceTitle ? { title: A().labels.sourceTitle } : null;
    const card = {
      noteText: p.front || p.cloze || "",
      cardType: p.cardType,
      frontMarkdown: p.front,
      backMarkdown: p.back,
      clozeOrds: [],
      cardOrd: p.cardOrd ?? 0,
      occlusionJson: p.occlusionJson ?? null,
      contextPrefix: p.contextPrefix || null,
      contextRef: A().contextRef(),
      mnemonic: p.mnemonic || null,
      sourceRef,
      dateStamp: p.dateStamp || null,
      priority: p.priority,
      tags: p.tags ?? [],
      domain: p.domain ?? [],
      knowledgePointId: p.knowledgePointId || null,
      siblingKey: p.siblingKey ?? null
    };
    await createManualCard({
      card,
      lint: {
        front: card.frontMarkdown,
        back: card.backMarkdown,
        cardType: card.cardType,
        cloze: p.cloze || null,
        contextPrefix: card.contextPrefix,
        sourceRef,
        dateStamp: card.dateStamp,
        knowledgePointId: card.knowledgePointId,
        occlusion: card.occlusionJson,
        tags: card.tags
      },
      similarity: { text: p.front || p.cloze || "" }
    });
  }

  async function handleManualCard(p: ManualCardPayload) {
    const meta = {
      contextPrefix: p.contextPrefix || null,
      domain: p.domain ?? [],
      mnemonic: p.mnemonic || null,
      knowledgePointId: p.knowledgePointId || null,
      dateStamp: p.dateStamp || null,
      priority: p.priority,
      // v48.60（D101）：表单终值（继承初值已以 chips 形式进表单，用户删了就是删了——提交层不再回填）
      tags: normalizeTags(p.tags ?? [])
    };
    // v34（M12，§4.16）：短材料锚点键——同一句/段的多次制卡（手动或 AI）互为同源，同日只放行一张
    const srcKey = siblingKeyFor({
      contextRef: A().contextRef(),
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
    const focused = A().focus.get();
    if (!focused) return;
    A().focus.setBusy(true);
    try {
      const assetPath = await ensureImageAsset(focused.dataUrl);
      if (!assetPath) return;
      const cropDataUrl = await cropImageDataUrl(focused.dataUrl, payload.bbox);
      // 图片入口无文本选区：清掉可能残留的锚点，避免把旧锚点挂到新卡上
      A().clearAnchor();
      // v35：正文图片链路——制卡来源=engine（图片锚点已由点击快照）
      occlusionSourceRef.current = "engine";
      const label = `[图片选区] ${focused.alt || "正文图片"}`;
      A().focus.close();
      wakeDock();
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
          title: A().labels.sourceTitle,
          section: A().labels.section,
          // v29 D26：选区 = AI 的完整图片范围，按制卡原则识别内容类型、自选考察方式，
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
      A().focus.setBusy(false);
    }
  }

  function submitRegionManual(payload: ImageFocusSubmit) {
    const focused = A().focus.get();
    if (!focused) return;
    A().focus.close();
    setManualImage({
      dataUrl: focused.dataUrl,
      alt: focused.alt,
      shape: normalizeShape({ ...payload.shape, ord: 0 }),
      rect: payload.bbox
    });
    setManualOpen(true);
  }

  // ---------- D98 手动图片挖空编辑器（v48.57 R1）：点击正文图片直进 → 多遮罩批量落库 ----------
  /** 直进编辑器：图片数据/锚点快照已由点击处理器备好（contextText 供 AI 建议层结合上下文出题） */
  function openOcclusionEditor(
    image: { dataUrl: string; alt: string; contextText?: string },
    origin?: { x: number; y: number; width: number; height: number }
  ) {
    A().clearKernelSelection?.();
    // 正文图片链路：制卡来源=engine（图片锚点已由点击快照，复习端可跳转原文）
    occlusionSourceRef.current = "engine";
    setOcclEditor({ image, origin: origin ?? null });
  }

  function closeOcclusionEditor() {
    setOcclEditor(null);
  }

  /** R1 AI 挖空建议层：直读 card-occlusion 提示词（requestOcclusionResult，零批次创建），
      返回归一化 regions 供编辑器导入为可编辑遮罩。AI 仅建议——不落库。 */
  async function runOcclusionSuggest(dataUrl: string): Promise<OcclusionRegion[]> {
    if (!occlEditor) return [];
    try {
      const { result } = await requestOcclusionResult(
        { dataUrl },
        {
          title: A().labels.sourceTitle,
          section: A().labels.section,
          contextText: occlEditor.image.contextText
        }
      );
      return result.regions ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg.includes("API Key")
        ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
        : `AI 挖空失败：${msg}`);
      return [];
    }
  }

  /** 批量落库：逐块拆卡（每卡自带单遮罩 / shared=全图区域+cardOrd 单区 accent）或整图一卡（同遮同答）。
      数据契约零变更——复用 occlusion_json 既有字段；同图多卡 siblingKey=图片资产（v34 同源同日埋葬）。
      R1：imageDataUrl=编辑器当前图（可能已经裁剪），资产以它落盘。 */
  async function submitOcclusionEditor(p: OcclusionEditorSubmit) {
    if (!occlEditor) return;
    const assetPath = await ensureImageAsset(p.imageDataUrl);
    if (!assetPath) {
      showToast("图片资产落盘失败，未创建卡片");
      return;
    }
    const shapes = p.masks.map((m, i) => normalizeShape({ ...m, ord: i }));
    if (shapes.length === 0) return;
    // rects 恒为形状包围盒（兼容旧渲染与 L11 校验），shapes 为精确轮廓
    const rects = shapes.map((s) => ({ ...shapeBBox(s), ord: s.ord }));
    const front = p.frontText.trim() || "图中遮挡区域对应的是什么？";
    const siblingKey = `img:${assetPath}`;
    if (p.mode === "single") {
      await createSingleCard({
        front,
        back: p.masks.map((m) => m.label).filter(Boolean).join("；"),
        cardType: "imageOcclusion",
        cardOrd: 0,
        siblingKey,
        occlusionJson: { assetPath, rects, shapes },
        priority: 50
      });
    } else {
      for (let i = 0; i < shapes.length; i++) {
        await createSingleCard({
          front,
          back: p.masks[i].label || `区域 ${i + 1}`,
          cardType: "imageOcclusion",
          cardOrd: i,
          siblingKey,
          occlusionJson: p.shared
            ? { assetPath, rects, shapes, regionScope: "shared" }
            : { assetPath, rects: [rects[i]], shapes: [shapes[i]] },
          priority: 50
        });
      }
    }
    eventBus.emit("cards/changed");
    setOcclEditor(null);
    showToast(p.mode === "single"
      ? "图片挖空卡已创建（复习正面遮挡全部区域）"
      : `已创建 ${shapes.length} 张图片挖空卡（复习正面遮挡各区域）`);
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
        { title: A().labels.sourceTitle, section: A().labels.section, webContext, documentId: A().sourceContext().documentId ?? null, focus: opts?.focus },
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
    const ownerKey = A().ownerKey();
    if (!ownerKey) {
      showToast("无法确定图片归属的书籍");
      return;
    }
    // 图片入口无文本选区：清掉可能残留的选区锚点，避免把旧锚点挂到新卡上
    A().clearAnchor();
    A().clearKernelSelection?.();
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
        { title: A().labels.sourceTitle, section: A().labels.section },
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
        ? { ...(A().contextRef() || {}), imageSource: "library" as const }
        : A().contextRef(),
      sourceRef: d.sourceRef || (A().labels.sourceTitle ? { title: A().labels.sourceTitle } : null),
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
      const results = await (await import("./ai")).aiGateway.websearch(text.slice(0, 120));
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
        `${A().labels.sourceTitle ?? ""}${A().labels.section ? " · " + A().labels.section : ""}`,
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
          title: A().labels.sourceTitle,
          section: A().labels.section,
          documentId: A().sourceContext().documentId ?? null,
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
    // v48.60（D101 §1.4④）：批注标签继承——草稿无标签时并入来源摘录的批注标签（用户事后可改）
    if (!d.tags || d.tags.length === 0) {
      const inherited = await inheritedExtractTags();
      if (inherited.length) d.tags = inherited;
    }
    // v30：建卡逻辑抽至 createAcceptedCard（与复习对比卡确认框共用）；per-blank 多空草稿在其内拆成每空一张
    // v34（M12）：sourceText 参与短材料锚点键的长度门控——同一句短材料的多角度卡同日只放行一张
    // v41（K2-A，D38）：genBatchId 落库 → 簇键 batch:<id>:<kp>，接受后后台顺带 AI 抽取归一
    const expandedCount = expandClozeDraft(d).length;
    const mmNodeId = aiPanel?.mindmapNodeId;
    await createAcceptedCard(d, {
      sourceTitle: A().labels.sourceTitle,
      contextRef: mmNodeId ? { ...(A().contextRef() || {}), mindmapNodeId: mmNodeId } : A().contextRef(),
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

  // ---------- AI 解释（Phase 12；v48.51/D91 解读方式三态 + 本地路由） ----------
  /**
   * v48.51（D91 §5.3 点击行为契约）：点击即执行（无条件）；方式解析 = 显式选择 > auto=本地路由器
   * （`routeExplainMode`，纯前端零请求）。`modeOverride` 供切换器「切换即重跑」（answer 清空重建，
   * requestId 配对已保证旧流不串扰新结果）；材料语言取书籍语言标记（缺省时由模型自检并在标记中报告）。
   */
  async function runExplain(text: string, question: string | null, modeOverride?: ExplainModePref) {
    const pref: ExplainModePref = modeOverride ?? explainModeRef.current;
    const ste = pref === "auto" ? routeExplainMode(text) === "ste" : pref === "ste";
    setAiPanel({
      kind: "explain",
      text,
      explainMode: pref,
      answer: question ? undefined : "",
      running: true,
      startedAt: Date.now(),
      thinking: 0
    });
    try {
      const answer = await cardGenerator.explain(
        text,
        `${A().labels.title ?? ""}${A().labels.section ? " · " + A().labels.section : ""}`,
        question,
        (acc) => setAiPanel((p) => (p && p.kind === "explain" ? { ...p, answer: acc, running: true } : p)),
        (thinkChars) => setAiPanel((p) => (p && p.kind === "explain" ? { ...p, thinking: thinkChars } : p)),
        ste ? { mode: "ste", matLang: bookLangRef.current || "" } : undefined
      );
      setAiPanel({ kind: "explain", text, explainMode: pref, answer, running: false, startedAt: undefined, thinking: undefined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "explain",
        text,
        explainMode: pref,
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

  /**
   * v48.51（D91 §5.3.1/§5.2）：解读方式切换（三态，显式选择会话内记忆）。
   * 解释面板在场时切换即重跑（清空答案按新方式重发，与现有追问同一交互语法）。
   */
  function changeExplainMode(m: ExplainModePref) {
    setExplainMode(m);
    explainModeRef.current = m;
    const p = aiPanel;
    if (p && p.kind === "explain") void runExplain(p.text, null, m);
  }

  // ---------- 摘录 ----------
  /**
   * v48.23（D61 §6.8-11）：多段不相邻选择时把原始 spans 一并交给工作流——主进程按 spans 优先
   * 装配 content_markdown 与 quote_range_json（一条批注、多段区间、多组矩形）。
   * 只在**真多段（≥2）**时传：单段路径保持既有载荷逐字节不变。
   */
  async function handleExtract(text: string, spans?: ExtractSpan[], opts?: { parentRange?: Array<{ start: number; end: number }> }) {
    await writeExtract(text, spans, opts);
  }

  /** 摘录/高亮落库的公共装配（kind 分族 + 批注色 + 批注文字；四条落库分支的唯一实现面） */
  async function writeExtract(
    text: string,
    spans?: ExtractSpan[],
    opts?: {
      kind?: "highlight" | "extract";
      color?: string | null;
      comment?: string | null;
      /** 多段累计的偏移区间（v48.38 / D78）：≥2 段才写入 contextRef.parentRange（单段路径逐字节不变） */
      parentRange?: Array<{ start: number; end: number }>;
    }
  ) {
    const { readingWorkflow } = await import("./readingWorkflow");
    // 需求2：摘录同样记录选区锚点（跳转原文用）
    A().rememberAnchor(text);
    const ctx = A().contextRef();
    const multi = spans && spans.length >= 2 ? spans : undefined;
    // v48.24 批3（§4 写入侧）：**根摘录**额外落 `sourceAnchor`（三条腿的容器形态）——文中留痕据此重画。
    // 子摘录（contextRef.extractId）锚在父卡文本里（parentRange），不写源锚。
    const sc = A().sourceContext();
    const sourceAnchor = sc.extractId ? null : A().buildSourceAnchor(text);
    const ctxWithAnchor = sourceAnchor ? { ...(ctx || {}), sourceAnchor } : ctx;
    // 多段落库锚（v48.38 / D78）：累计的偏移区间 ≥2 段才挂——单段/无累计路径 contextRef 逐字节不变
    const ctxWithRanges =
      opts?.parentRange && opts.parentRange.length >= 2 ? { ...ctxWithAnchor, parentRange: opts.parentRange } : ctxWithAnchor;
    const extra = {
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.color ? { annotationColor: opts.color } : {}),
      ...(opts?.comment ? { comment: opts.comment } : {})
    };
    // v48.40（D80）：宿主给定的落库父级**优先**——摘录页「摘录」动作与点色（createAnnotation）同规，
    // 恒挂当前卡（§3.4）。此前只认 sourceContext 两字段：contextRef 为 NULL 的老卡两字段皆空
    // ⇒ 静默不落库但 toast 照弹（用户实测「摘录了却在卡片页找不到」）；有 documentId 的卡则错挂源文档。
    // parentRange 以动作显式入参为准（actExtractSelection 先清选区后落库，annotateParent 闭包里的 faceSel 已为 null）。
    let created = false;
    const parent = A().annotateParent?.();
    if (parent) {
      const patched = {
        ...(ctxWithAnchor || {}),
        ...(parent.contextRefPatch || {}),
        ...(opts?.parentRange && opts.parentRange.length >= 2 ? { parentRange: opts.parentRange } : {})
      };
      await readingWorkflow.create({
        parentType: parent.parentType,
        parentId: parent.parentId,
        documentId: parent.documentId,
        contentMarkdown: text,
        contextRef: patched,
        spans: multi,
        ...extra
      });
      created = true;
    } else if (sc.extractId) {
      await readingWorkflow.create({
        parentType: "extract",
        parentId: sc.extractId,
        documentId: sc.documentId || "",
        contentMarkdown: text,
        contextRef: ctxWithRanges,
        spans: multi,
        ...extra
      });
      created = true;
    } else if (sc.documentId) {
      await readingWorkflow.create({
        parentType: "document",
        parentId: sc.documentId,
        documentId: sc.documentId,
        contentMarkdown: text,
        contextRef: ctxWithRanges,
        spans: multi,
        ...extra
      });
      created = true;
    }
    eventBus.emit("workflow/changed");
    showToast(created ? "已摘录进学习队列" : "此处没有可挂靠的来源，未创建摘录");
  }

  /**
   * R38/R40 点色落库（v48.43/D83）：点色＝按**模式**（highlight＝纯批注不进队列；extract＝摘录+高亮进队列）
   * 与**形式**（highlight 底色 / underline 下划线，`annotation_type`）落库；批注文字随选区菜单的批注框
   * 一次带上（空串/缺省＝无批注），**不再自动弹编辑浮层**（编辑走栏内条目/文中标记点击）。
   * 「摘录」也可由工具栏按钮发起（writeExtract 路径）。返回新条目 id。
   */
  async function createAnnotation(
    text: string,
    spans: ExtractSpan[] | undefined,
    color: string,
    mode: "highlight" | "extract",
    form: "highlight" | "underline",
    comment?: string | null
  ): Promise<string | null> {
    const { readingWorkflow } = await import("./readingWorkflow");
    A().rememberAnchor(text);
    const ctx = A().contextRef();
    const multi = spans && spans.length >= 2 ? spans : undefined;
    const sc = A().sourceContext();
    const sourceAnchor = sc.extractId ? null : A().buildSourceAnchor(text);
    const ctxWithAnchor = sourceAnchor ? { ...(ctx || {}), sourceAnchor } : ctx;
    const payload = {
      contentMarkdown: text,
      contextRef: ctxWithAnchor,
      spans: multi,
      kind: mode,
      annotationColor: color,
      annotationType: form,
      ...(comment ? { comment } : {})
    };
    let created: { id: string } | null = null;
    // 宿主给定的落库父级优先（摘录页恒挂当前卡；规格 §3.4 表）
    const parent = A().annotateParent?.();
    if (parent) {
      const patched = parent.contextRefPatch ? { ...(ctxWithAnchor || {}), ...parent.contextRefPatch } : ctxWithAnchor;
      created = await readingWorkflow.create({
        parentType: parent.parentType,
        parentId: parent.parentId,
        documentId: parent.documentId,
        ...payload,
        contextRef: patched
      });
    } else if (sc.extractId) {
      created = await readingWorkflow.create({
        parentType: "extract",
        parentId: sc.extractId,
        documentId: sc.documentId || "",
        ...payload
      });
    } else if (sc.documentId) {
      created = await readingWorkflow.create({
        parentType: "document",
        parentId: sc.documentId,
        documentId: sc.documentId,
        ...payload
      });
    }
    eventBus.emit("workflow/changed");
    return created?.id ?? null;
  }

  // ---------- M4 快捷键动作（§9.1 M4：与下方选区菜单按钮完全同源） ----------
  /** 摘录页的动作：只摘录，不弹制卡/解释面板 */
  async function extractSelection(text: string, spans?: ExtractSpan[]) {
    const parentRange = A().selectionRanges?.() ?? null;
    A().clearSelection();
    await handleExtract(text, spans, parentRange && parentRange.length >= 2 ? { parentRange } : undefined);
  }
  /**
   * v48.52（D92 §3.4 全局制卡）：**去除选区依赖**——无选区＝空表单自由制卡（manualQuote 置空）；
   * 有选区＝quote 预填（既有语义保留）。两种路径都唤坞（自动展开 + 手动暂态占坞体）。
   */
  function actManualCard() {
    const text = A().selectionText();
    if (text) {
      A().rememberAnchor(text);
      setManualQuote(text);
    } else {
      setManualQuote(null);
    }
    setManualOpen(true);
    setManualActive(true);
    wakeDock();
    A().clearSelection();
    // v48.60（D101）：继承初值异步补入（表单打开后 chips 到位即可，不阻塞开坞）
    setManualTagsInitial([]);
    void inheritedExtractTags().then((tags) => {
      if (tags.length) setManualTagsInitial(tags);
    });
  }
  function actAICards() {
    const t = A().selectionText();
    if (!t) return;
    A().rememberAnchor(t);
    A().clearSelection();
    wakeDock();
    void runAICards(t, undefined, aiModeRef.current);
  }
  function actAIExplain() {
    const t = A().selectionText();
    if (!t) return;
    A().clearSelection();
    wakeDock();
    void runExplain(t, null);
  }
  function actExtractSelection() {
    const t = A().selectionText();
    if (!t) return;
    const spans = A().selectionSpans();
    // 多段落库锚先采后清（v48.38 / D78）：clearSelection 会重置累计，≥2 段才随落库写入 parentRange
    const parentRange = A().selectionRanges?.() ?? null;
    A().clearSelection();
    void handleExtract(t, spans, parentRange && parentRange.length >= 2 ? { parentRange } : undefined);
  }

  // ---------- M7 查词（v32，D31）：选中单词 → DictPanel（原文即显→Loading→填充/错误），在线绝不阻塞 ----------
  /** 原句上下文：markdown 全文定位选中词前后各 ~120 字（引擎书无 markdown 时用锚点文本兜底） */
  function sentenceContext(raw: string): string {
    const body = String(A().bodyText ?? "");
    const idx = body ? body.indexOf(raw) : -1;
    if (idx >= 0) return body.slice(Math.max(0, idx - 120), idx + raw.length + 120);
    return A().anchorText() || raw;
  }
  async function runLookup(forceLocal = false, rawOverride?: string) {
    const raw = (rawOverride ?? A().selectionText() ?? "").trim();
    if (!raw || dictBusy) return;
    if (!rawOverride && !isVocabSelection(raw)) {
      showToast("所选过长，已走 AI 制卡更合适");
      return;
    }
    setDictBusy(true);
    const loc = A().lookupLocator();
    const reading = buildReadingContext({
      selectedText: raw,
      contextText: sentenceContext(raw),
      documentId: A().sourceContext().documentId ?? null,
      cfi: loc.cfi ?? null,
      pageIndex: loc.pageIndex ?? null,
      anchorText: A().anchorText() ?? raw.slice(0, 60),
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
        const { buildManager } = await import("./dictClient");
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
    const t = A().selectionText();
    if (!t) return;
    A().rememberAnchor(t);
    A().clearSelection();
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
        sourceRef: A().labels.sourceTitle ? { title: A().labels.sourceTitle } : { title: `词典:${entry.source}` },
        prioritySuggestion: 50,
        ruleNotes: ["R2", "R14", "R16"],
        warnings: [],
      };
      // v34（M12，§4.16）：单词四卡（D31 快照制）来自同一次查词 → 同锚点键互为同源，同日只放行一张；
      // sourceText=查词原词（恒 ≤ 阈值 → 必建键），同一词在同一位置重复制卡也会归入同组
      await createAcceptedCard(d, { sourceTitle: A().labels.sourceTitle ?? entry.source, contextRef: A().contextRef(), dictJson, sourceText: ctx.selectedText || entry.word });
      n += 1;
    }
    eventBus.emit("cards/changed");
    setDictPanel(null);
    showToast(`已创建 ${n} 张单词卡（${drafts.map((v) => VOCAB_KIND_LABEL[v.kind]).join("/")}）`);
  }

  // 制卡模式的按书记忆（settings.app.materialTypes）——与面板同源，宿主只读对齐
  const [aiMode, setAiMode] = useState<CardGenMode>("auto");
  const aiModeRef = useRef<CardGenMode>("auto");
  aiModeRef.current = aiMode;
  const materialKey = adapter.itemId || adapter.sourceContext().documentId || "";
  useEffect(() => {
    let cancelled = false;
    if (!materialKey) return;
    void (async () => {
      const { settingsStore } = await import("./settings");
      const map = await settingsStore.get<Record<string, CardGenMode>>("app", "materialTypes", {});
      if (!cancelled && map[materialKey]) setAiMode(map[materialKey]);
    })();
    return () => { cancelled = true; };
  }, [materialKey]);
  function changeAiMode(m: CardGenMode) {
    setAiMode(m);
    if (materialKey) {
      void import("./settings").then(async ({ settingsStore }) => {
        const map = await settingsStore.get<Record<string, CardGenMode>>("app", "materialTypes", {});
        if (map[materialKey] === m) return;
        void settingsStore.set("app", "materialTypes", { ...map, [materialKey]: m });
      });
    }
  }

  /** 手动制卡浮层关闭/提交后的收尾（宿主清 contextRef 覆盖值并把引用文本复位） */
  function closeManual() {
    setManualQuote(null);
    setManualOpen(false);
    setManualImage(null);
    setManualActive(false);
    A().onManualSettled?.();
  }

  return {
    // 面板与浮层状态（宿主渲染用）
    aiPanel,
    setAiPanel,
    manualOpen,
    manualImage,
    manualQuote,
    // v48.60（D101）：手动表单的标签初值（批注标签继承，可删）——宿主透传 ManualCardForm.initialTags
    manualTagsInitial,
    dictPanel,
    setDictPanel,
    dictReading,
    dictFields,
    dictBusy,
    dictManualLang,
    // v48.52（D92）：学习坞会话态（首次唤起后常驻挂载；收起≠关闭）
    dockEverOpened,
    dockOpen,
    dockTab,
    manualActive,
    changeDockTab,
    collapseDock,
    expandDock,
    // v48.51（D91）：解读方式三态（会话内记忆）与切换（面板在场时切换即重跑）
    explainMode,
    changeExplainMode,
    // 面板回调
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
    // 选区动作（菜单与快捷键同源）
    actions: {
      manual: actManualCard,
      aiCards: actAICards,
      explain: actAIExplain,
      extract: actExtractSelection,
      extractSelection,
      lookup: actLookupWord,
      occlusion: () => {
        A().clearSelection();
        wakeDock();
        void runOcclusionCards();
      }
    },
    // 批注（R38/R40：点色落库 + 摘录/高亮共面）
    createAnnotation,
    /** 批注文字落库（Task 11 AnnotationEditor）：null ＝ 清空＝删除批注（条目保留） */
    saveAnnotationComment: async (id: string, comment: string | null) => {
      const { readingWorkflow } = await import("./readingWorkflow");
      await readingWorkflow.updateAnnotations(id, { comment: comment ?? null });
      eventBus.emit("workflow/changed");
    },
    /** 批注颜色落库 */
    saveAnnotationColor: async (id: string, color: string) => {
      const { readingWorkflow } = await import("./readingWorkflow");
      await readingWorkflow.updateAnnotations(id, { annotationColor: color });
      eventBus.emit("workflow/changed");
    },
    /** 删除整条（高亮/摘录；UI 侧已含二次确认） */
    removeAnnotation: async (id: string) => {
      const { readingWorkflow } = await import("./readingWorkflow");
      await readingWorkflow.remove(id);
      eventBus.emit("workflow/changed");
    },
    writeExtract,
    // 浮层
    submitRegionCards,
    submitRegionManual,
    handleManualCard,
    // D98 手动图片挖空编辑器
    occlEditor,
    openOcclusionEditor,
    closeOcclusionEditor,
    submitOcclusionEditor,
    runOcclusionSuggest,
    startManualWith: (text: string) => {
      setManualQuote(text);
      setManualOpen(true);
      setManualActive(true);
      wakeDock();
      // v48.60（D101）：继承初值异步补入（同 actManualCard）
      setManualTagsInitial([]);
      void inheritedExtractTags().then((tags) => {
        if (tags.length) setManualTagsInitial(tags);
      });
    },
    closeManual
  };
}
